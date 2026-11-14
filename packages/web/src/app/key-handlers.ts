// The keys of the window and of the drawing, by the table in keys.ts (the sheet shows the same).
import { useEffect } from 'react';
import { is, shortcutFor } from '../keys.ts';
import { arrangeKey, type useCraftPrefs } from '../craft-actions.tsx';
import { nearestToward, type Direction } from '../craft.ts';
import type { Selection } from '../preview.tsx';
import type { View } from '../start.tsx';
import type { Drawing } from './drawing.ts';
import type { Edits } from './edits.ts';
import type { Modal } from './modals.ts';
import type { Navigation } from './navigation.ts';
import type { Pins } from './pins.ts';

const NUDGE = 8;

interface GlobalKeys {
  modal: Modal | undefined;
  setModal(m: Modal | undefined | ((m: Modal | undefined) => Modal | undefined)): void;
  presenting: boolean;
  present(): void;
  toggleAsk(): void;
  saveYaml(): void;
  openFile(): void;
  saveSvg(): void;
  savePng(): void;
  view: View;
  setView(v: View): void;
  /** In a session only the sheet shows: the keys that open other panes or views stay quiet. */
  session: boolean;
  toggleSession(): void;
  /** Back from a link followed (navigation.ts). */
  back(): void;
}

/** The regions F6 goes round, in order: each as its box and what in it takes the focus. */
const REGIONS: [string, string][] = [
  ['.topbar', '.view-switch button, button'],
  ['.workspace .shapes, .workspace .left-rail', '.outline [tabindex="0"], [role="tab"][aria-selected="true"], button'],
  ['.editor-pane', '.cm-content'],
  ['.preview', '.preview'],
  ['.canvas-tools', 'button'],
  ['.steps-strip', '.step-chip.active, .step-chip'],
  ['.workspace .side', 'input, select, textarea, [role="tab"][aria-selected="true"], button'],
  ['.statusbar', 'button'],
];

/** The window's keys: F6 round the regions, and those that work anywhere (⌘K, ⌘S, P…). */
export function useGlobalKeys(k: GlobalKeys) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // F6 goes round the regions, like panes in other apps: the top bar, the outline, the YAML, the
      // drawing, its toolbar, the steps, the properties and the status bar (those on screen).
      if (is(e, 'next-pane')) {
        const regions = REGIONS.map(([box, target]) => {
          const el = document.querySelector<HTMLElement>(box);
          const to = el && [...el.querySelectorAll<HTMLElement>(target)].find((x) => !!x.offsetParent && !(x as HTMLButtonElement).disabled);
          return el?.offsetParent && (to ?? (el.matches(target) ? el : undefined)) ? { el, to: to ?? el } : undefined;
        }).filter((x) => !!x);
        const now = document.activeElement;
        // The innermost region holding the focus (the toolbar is inside the drawing's pane).
        const at = regions.reduce((best, r, i) => (r.el.contains(now) && (best < 0 || regions[best]!.el.contains(r.el)) ? i : best), -1);
        regions[(at + (e.shiftKey ? regions.length - 1 : 1)) % regions.length]?.to.focus();
        return e.preventDefault();
      }
      // Keys from keys.ts: those with ⌘ (or F6) work while typing too; the others only outside text fields.
      const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select, .cm-content, [contenteditable="true"]');
      if (e.defaultPrevented) return;
      // ⌘A outside a text field and the drawing (a button in the status bar) would select the page's
      // words, the editor's chrome and all: it does nothing there.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'a' && !typing) return e.preventDefault();
      const id = shortcutFor(e, typing || k.modal || k.presenting ? ['anywhere'] : ['anywhere', 'not-typing']);
      if (!id || (k.modal && id !== 'palette') || k.presenting) return;
      if (k.session && ['present', 'ask', 'switch-view'].includes(id)) return;
      if (id === 'session') k.toggleSession();
      else if (id === 'sheet') k.setModal('shortcuts');
      else if (id === 'present') k.present();
      else if (id === 'palette') k.setModal((m) => (m === 'palette' ? undefined : 'palette'));
      else if (id === 'ask') k.toggleAsk();
      else if (id === 'save') k.saveYaml();
      else if (id === 'open') k.openFile();
      else if (id === 'export-svg') k.saveSvg();
      else if (id === 'export-png') k.savePng();
      else if (id === 'switch-view') k.setView(k.view === 'visual' ? 'code' : 'visual');
      else if (id === 'back') k.back();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
}

interface CanvasKeys {
  drawing: Drawing;
  selection: Selection[];
  selected: Selection | undefined;
  setSelection(s: Selection[]): void;
  select(s: Selection | undefined): void;
  selectMany(list: Selection[], add: boolean): void;
  edits: Edits;
  pinning: Pins;
  nav: Navigation;
  craft: ReturnType<typeof useCraftPrefs>;
  layers: { onKey(e: React.KeyboardEvent): boolean };
  undo(): void;
  redo(): void;
  addShape(): void;
  connect(): void;
  /** Sketching keys first (sketching.ts): in a session typing names and Tab adds; true when taken. */
  sketch(e: React.KeyboardEvent): boolean;
}

/** The drawing's keys that act on the selection from the outline too, as in Figma's layers. */
export const OUTLINE_KEYS = ['add', 'delete', 'duplicate', 'copy', 'paste'] as const;

/** The drawing's keys, when it has the focus itself. */
export function canvasKeys(c: CanvasKeys) {
  const { drawing, selection, selected, edits, pinning, nav } = c;
  const { result, drawn } = drawing;

  /** Tab order: elements, then groups, then lines. */
  const cycle = (dir: 1 | -1): boolean => {
    const g = result?.graph;
    if (!g) return false;
    const all: Selection[] = [
      ...g.nodes.map((n) => ({ kind: 'node' as const, id: n.id })),
      ...g.groups.filter((x) => result?.placed?.groups.has(x.id)).map((x) => ({ kind: 'group' as const, id: x.id })),
      ...g.edges.map((e) => ({ kind: 'edge' as const, id: e.id })),
    ];
    const i = selected ? all.findIndex((s) => s.kind === selected.kind && s.id === selected.id) : -1;
    const next = i + dir;
    if (next < 0 || next >= all.length) return false;
    c.select(all[next]);
    return true;
  };
  /** ⌥ arrows: the selection moves to the nearest element in that direction. */
  const focusToward = (dir: Direction) => {
    const pl = result?.placed;
    if (!pl) return;
    const from = selected && (selected.kind === 'node' ? pl.nodes.get(selected.id) : selected.kind === 'group' ? pl.groups.get(selected.id) : undefined);
    if (!from) return void cycle(1);
    const all: [string, typeof from][] = [...pl.nodes].filter(([id]) => id !== selected!.id);
    const id = nearestToward(from, all, dir);
    if (id) c.select({ kind: 'node', id });
  };

  /** `only`: from another list of the elements (the outline), the drawing's keys it leaves to the drawing; handled ones are prevented. */
  return (e: React.KeyboardEvent, only?: readonly string[]) => {
    if (only) {
      const id = shortcutFor(e, ['drawing']);
      if (!id || !only.includes(id)) return;
    } else if (e.target !== e.currentTarget || c.sketch(e)) return;
    const arrange = only ? undefined : arrangeKey(e);
    if (arrange) {
      pinning.arrangeSelection(arrange);
      return e.preventDefault();
    }
    // The drawing's keys, by the table in keys.ts (the sheet shows the same).
    const id = shortcutFor(e, drawn?.focus ? ['drawing', 'focus'] : ['drawing']);
    const step = e.shiftKey ? NUDGE * 5 : NUDGE;
    switch (id) {
      case 'undo': c.undo(); break;
      case 'redo': c.redo(); break;
      case 'duplicate': edits.duplicate(); break;
      case 'copy': edits.copy(); break;
      case 'paste': edits.paste(); break;
      case 'select-all': c.selectMany([...(result?.graph?.nodes ?? []).map((n) => ({ kind: 'node' as const, id: n.id }))], false); break;
      case 'delete': selection.length > 1 ? edits.removeAll() : edits.remove(); break;
      case 'escape': selection.length || !nav.focusOn ? c.setSelection([]) : nav.leaveFocus(); break;
      case 'focus': nav.focusOnSelection(); break;
      case 'focus-hops': nav.focusHops(e.key === '-' ? -1 : 1); break;
      case 'focus-direction': nav.focusDirection(); break;
      case 'lock': pinning.toggleLock(); break;
      case 'pin': pinning.togglePin(); break;
      case 'tidy': pinning.tidyLayout(); break;
      case 'grid':
      case 'minimap':
      case 'page': c.craft.toggle(id); break;
      case 'nearest': focusToward(e.key.slice(5).toLowerCase() as Direction); break;
      case 'step-by': nav.stepBy(e.key === ']' ? 1 : -1); break;
      case 'step': nav.addStepFromSelection(); break;
      case 'next-view': nav.nextView(); break;
      case 'nudge': pinning.nudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0); break;
      case 'cycle': if (!cycle(e.shiftKey ? -1 : 1)) return; break;
      case 'add': c.addShape(); break;
      case 'connect': if (selected?.kind !== 'node') return; c.connect(); break;
      case 'layers': if (!c.layers.onKey(e)) return; break;
      case 'edit':
        if (!selected) return;
        if (e.key === 'F2') (document.querySelector('.inspector-body > .field input') as HTMLInputElement | null)?.select();
        else (document.querySelector('.inspector input, .inspector select') as HTMLElement | null)?.focus();
        break;
      default: return;
    }
    e.preventDefault();
  };
}
