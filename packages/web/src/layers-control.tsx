// Layers in the editor: the diagram's `layers:` (a security view, a data view, phase 2) switched on
// and off without touching the YAML. One button in the canvas tools opens a small panel with a
// toggle per layer (several at once), Only / Faded, and the way back to the whole drawing; L opens it
// from the keyboard, 1–9 toggle, 0 shows everything, D switches Only and Faded. The chip under the
// tools says what is drawn, and when layers wait for something that wins: comparing, then a focus.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LayerMode } from '@cartography/core';
import type { RenderResult } from '@cartography/engine';
import { Icon } from './icon.tsx';
// The panel is a menu: its look first, then what is its own.
import './menu.css';
import './layers.css';
import { keyHint, shortcutFor } from './keys.ts';
import { t } from './i18n/index.ts';

type Info = NonNullable<RenderResult['layers']>;

/** What the editor asks for on top of the YAML, per document and view: names (none: the whole drawing) and how. */
interface Asked {
  doc: string;
  view?: string;
  names: string[];
  mode?: LayerMode;
}

export interface LayersOptions {
  layers?: string[];
  layerMode?: LayerMode;
}

export interface PaletteCommand {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon?: string;
  shortcut?: string;
  run(): void;
}

const title = (l: Info['list'][number]) => l.title ?? l.name;

/**
 * The layers asked for in this document and view. `options` goes to the render (before the drawing
 * exists); `ui(drawn, comparing)` gives the button, the chip, the palette's commands and the L key.
 */
export function useLayers(doc: string, view: string | undefined) {
  const [asked, setAsked] = useState<Asked>();
  const [open, setOpen] = useState(false);
  /** Which layers fade the rest, from the last drawing: the render is told the mode, so its memory is the right one. */
  const dims = useRef(new Set<string>());
  const mine = asked && asked.doc === doc && asked.view === view ? asked : undefined;
  const key = mine ? `${mine.names.join('+')}|${mine.mode ?? ''}` : undefined;
  // One object while the ask stays the same: the render runs again only when it changes.
  const options = useMemo<LayersOptions | undefined>(() => {
    if (!mine) return undefined;
    const mode = mine.mode ?? (mine.names.length && mine.names.every((n) => dims.current.has(n)) ? 'dim' : 'only');
    return { layers: mine.names, layerMode: mode };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key says when mine changed: one object while the ask stays the same
  }, [key]);
  const ui = (drawn: RenderResult | undefined, comparing: boolean) => layersUi({ doc, view, drawn, comparing, mine, setAsked, open, setOpen, dims: dims.current });
  return { options, ui };
}

function layersUi({ doc, view, drawn, comparing, mine, setAsked, open, setOpen, dims }: { doc: string; view?: string; drawn?: RenderResult; comparing: boolean; mine?: Asked; setAsked(a: Asked | undefined): void; open: boolean; setOpen(v: boolean): void; dims: Set<string> }) {
  const info = drawn?.layers;
  dims.clear();
  for (const l of info?.list ?? []) if (l.dim) dims.add(l.name);
  const list = info?.list ?? [];
  /** What is on now: drawn, or asked for and waiting (a focus wins). */
  const active = mine ? mine.names : info?.active.length ? info.active : (info?.waiting ?? []);
  const mode: LayerMode = mine?.mode ?? info?.mode ?? 'only';
  const set = (names: string[], m: LayerMode | undefined) => setAsked({ doc, view, names, ...(m ? { mode: m } : {}) });
  const toggle = (name: string) => set(active.includes(name) ? active.filter((n) => n !== name) : [...active, name].sort((a, b) => list.findIndex((l) => l.name === a) - list.findIndex((l) => l.name === b)), mine?.mode);
  const only = (name: string) => set([name], mine?.mode);
  /** Everything: no layer, whatever the view names. */
  const all = () => set([], undefined);
  const flipMode = () => set(active, mode === 'only' ? 'dim' : 'only');
  /** Back to what the YAML says (the view's own layers, or none). */
  const reset = () => setAsked(undefined);

  const commands: PaletteCommand[] = !list.length
    ? []
    : [
        ...list.map((l, i) => ({
          id: `layer-${l.name}`,
          group: t('Layers'),
          label: active.includes(l.name) ? t('Hide layer {name}', { name: title(l) }) : t('Show layer {name}', { name: title(l) }),
          hint: t('tagged {tags}; ⌥ in the panel shows it alone', { tags: l.tags.join(', ') }),
          icon: 'tag',
          ...(i < 9 ? { shortcut: `L ${i + 1}` } : {}),
          run: () => toggle(l.name),
        })),
        ...list.map((l) => ({ id: `layer-only-${l.name}`, group: t('Layers'), label: t('Only layer {name}', { name: title(l) }), hint: t('and no other'), icon: 'tag', run: () => only(l.name) })),
        { id: 'layers-all', group: t('Layers'), label: t('All layers'), hint: t('the whole drawing'), icon: 'tag', shortcut: 'L 0', run: all },
        { id: 'layers-mode', group: t('Layers'), label: mode === 'only' ? t('Layers: fade the rest in place') : t('Layers: only what is on them'), hint: t('keeps or changes the layout'), icon: 'tag', shortcut: 'L D', run: flipMode },
      ];

  const button = list.length ? (
    <LayersButton list={list} active={active} mode={mode} open={open} setOpen={setOpen} toggle={toggle} only={only} all={all} flipMode={flipMode} reset={mine ? reset : undefined} />
  ) : null;

  const why = comparing ? 'comparing' : info?.paused === 'focus' ? 'focus' : undefined;
  const chip = active.length && info ? <LayersChip list={list} active={active} mode={mode} info={info} why={why} onMode={flipMode} onLeave={all} onOpen={() => setOpen(true)} /> : null;

  /** L in the drawing: the panel, its first toggle in focus. */
  const onKey = (e: React.KeyboardEvent): boolean => {
    if (e.key.toLowerCase() !== 'l' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || !list.length) return false;
    setOpen(true);
    return true;
  };
  // Tags to complete from: every one in the file when it has layers, else those on what is drawn.
  const g = drawn?.graph;
  const tags = info?.tags ?? [...new Set([...(g?.nodes ?? []), ...(g?.groups ?? []), ...(g?.edges ?? [])].flatMap((x) => x.tags ?? []))].sort();
  return { info, active, mode, button, chip, commands, onKey, toggle, all, reset, tags };
}

interface ButtonProps {
  list: Info['list'];
  active: string[];
  mode: LayerMode;
  open: boolean;
  setOpen(v: boolean): void;
  toggle(name: string): void;
  only(name: string): void;
  all(): void;
  flipMode(): void;
  reset?: () => void;
}

function LayersButton({ list, active, mode, open, setOpen, toggle, only, all, flipMode, reset }: ButtonProps) {
  const el = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>('[role="menuitemcheckbox"]')?.focus();
    const outside = (e: PointerEvent) => !el.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('pointerdown', outside);
      if (before?.isConnected) before.focus?.();
    };
  }, [open, setOpen]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    // The panel's keys, from keys.ts (the "?" sheet lists them).
    const n = /^Digit([0-9])$/.exec(e.code)?.[1];
    const id = shortcutFor(e, ['layers-panel']);
    if (id === 'layers-close' || e.key === 'Tab') setOpen(false);
    else if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus();
    else if (id === 'layers-all') all();
    else if ((id === 'layer-toggle' || id === 'layer-only') && n && list[Number(n) - 1]) (id === 'layer-only' ? only : toggle)(list[Number(n) - 1]!.name);
    else if (id === 'layers-mode') flipMode();
    else return;
    if (e.key !== 'Tab') e.preventDefault();
    e.stopPropagation();
  };
  const label = active.length ? t('Layers: {count} on', { count: active.length }) : t('Layers');
  return (
    <div className="menu-anchor layers-control" ref={el}>
      <button className={active.length ? 'tool active' : 'tool'} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label={label} title={t('Layers: draw only what is tagged security, data, phase 2… ({key})', { key: keyHint('layers') })}>
        <Icon name="tag" /> <span className="tool-label">{t('Layers')}</span>
        {active.length > 0 && <span className="tool-count">{active.length}</span>}
        <kbd>L</kbd>
      </button>
      {open && (
        <div className="menu layers-panel" role="menu" aria-label={t('Layers')} ref={panel} onKeyDown={onKeyDown}>
          {list.map((l, i) => {
            const on = active.includes(l.name);
            return (
              <button
                key={l.name}
                role="menuitemcheckbox"
                aria-checked={on}
                className={on ? 'layer-toggle on' : 'layer-toggle'}
                onClick={(e) => (e.altKey ? only : toggle)(l.name)}
                title={l.caption ? t('{count} element tagged {tags}: {caption} (⌥-click: only this one)|{count} elements tagged {tags}: {caption} (⌥-click: only this one)', { count: l.count, tags: l.tags.join(', '), caption: l.caption }) : t('{count} element tagged {tags} (⌥-click: only this one)|{count} elements tagged {tags} (⌥-click: only this one)', { count: l.count, tags: l.tags.join(', ') })}
              >
                <span className="layer-switch" aria-hidden="true" />
                <span className="layer-name">{title(l)}</span>
                <span className="layer-tag">{l.name}</span>
                {l.count === 0 && (
                  <span className="layer-count" title={t('Nothing drawn here carries its tags')}>
                    {t('empty')}
                  </span>
                )}
                {i < 9 && <kbd>{i + 1}</kbd>}
              </button>
            );
          })}
          <div className="layers-mode" role="group" aria-label={t('The rest of the drawing')}>
            <button role="menuitemradio" aria-checked={mode === 'only'} className={mode === 'only' ? 'on' : ''} onClick={() => mode !== 'only' && flipMode()} title={t('Only the layers, laid out on their own (D)')}>
              {t('Only')}
            </button>
            <button role="menuitemradio" aria-checked={mode === 'dim'} className={mode === 'dim' ? 'on' : ''} onClick={() => mode !== 'dim' && flipMode()} title={t('Everything in its place, the rest faded (D)')}>
              {t('Fade the rest')}
            </button>
          </div>
          <button role="menuitem" className="layers-all" onClick={() => (all(), setOpen(false))}>
            <Icon name="eye" size={14} /> {t('Whole drawing')} <kbd>0</kbd>
          </button>
          {reset && (
            <button role="menuitem" className="layers-all" onClick={() => (reset(), setOpen(false))} title={t("The layers as the YAML says (the view's own, or none)")}>
              {t('As written')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface ChipProps {
  list: Info['list'];
  active: string[];
  mode: LayerMode;
  info: Info;
  /** What wins over the layers now, so they wait. */
  why?: 'comparing' | 'focus';
  onMode(): void;
  onLeave(): void;
  onOpen(): void;
}

function LayersChip({ list, active, mode, info, why, onMode, onLeave, onOpen }: ChipProps) {
  const names = active.map((n) => list.find((l) => l.name === n)).filter((l) => !!l).map(title);
  return (
    <div className={why ? 'focus-chip layers-chip waiting' : 'focus-chip layers-chip'} role="status" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
      <Icon name="tag" size={14} />
      <button className="layers-chip-name" onClick={onOpen} title={t('Change the layers (L)')}>
        {names.length === 1 ? t('Layer') : t('Layers')} <strong>{names.join(', ')}</strong>
      </button>
      {why ? (
        <span className="layers-chip-wait">{why === 'comparing' ? t('wait while comparing') : t('wait: the focus wins (Esc leaves it)')}</span>
      ) : (
        <>
          {mode === 'only' && (
            <span className="focus-chip-count" title={t('{kept} of {total} elements are drawn', { kept: info.kept, total: info.total })}>
              {t('{kept} of {total}', { kept: info.kept, total: info.total })}
            </span>
          )}
          <button className="tool" onClick={onMode} title={mode === 'only' ? t('Keep everything in its place and fade the rest (D in the panel)') : t('Draw only the layers, laid out on their own (D in the panel)')}>
            {mode === 'only' ? t('Only') : t('Faded rest')}
          </button>
        </>
      )}
      <button className="tool" onClick={onLeave} title={t('The whole drawing')} aria-label={t('The whole drawing')}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
