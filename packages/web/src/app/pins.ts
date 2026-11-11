// Where things stay: pins, locks and bent lines of the view drawn (the sidecar), changed as one undo
// step with the text when both change. Tidy, pin, lock, nudge and arrange.
import { packLayout, withViewPins, type LayoutSidecar, type Point } from '@cartography/core';
import { t, type Message } from '../i18n/index.ts';
import { arrange, type ArrangeOp } from '../craft.ts';
import type { EditorHandle } from '../editor.tsx';
import type { PreviewControl, Selection } from '../preview.tsx';
import type { Drawing } from './drawing.ts';
import type { Notify } from './toasts.tsx';

const count = (n: number, what: Message) => t(what, { count: n });

interface Props {
  drawing: Drawing;
  pins: LayoutSidecar | undefined;
  editor: React.RefObject<EditorHandle | null>;
  previewControl: React.RefObject<PreviewControl | null>;
  selection: Selection[];
  notify: Notify;
  /** Something was built: the first-visit hint has done its job. */
  acted(): void;
}

export function pinActions({ drawing, pins, editor, previewControl, selection, notify, acted }: Props) {
  const { drawn, result, vpins, drawnLayout, tracked, locked, current, pinCount, setFresh } = drawing;
  // A drawing of only some layers is not how the whole view is drawn: its note stays the whole one's.
  const layoutNote = () => (drawnLayout && !(drawn?.layers?.mode === 'only' && drawn.layers.active.length) ? packLayout(drawnLayout, tracked || !!drawnLayout.held) : vpins?.layout);
  /**
   * Pins with the note of the drawing they were set on, so the same placement is drawn under them
   * next time: without it the first pin could redraw everything else. Null when nothing is left to keep.
   */
  const noted = (out: LayoutSidecar): LayoutSidecar | null => {
    const note = layoutNote();
    const { layout: _, ...rest } = out;
    if (rest.nodes || rest.groups || rest.edges) return note ? { ...rest, layout: note } : rest;
    return tracked && note ? { version: 1, layout: note } : null;
  };
  /** The pins to save: all views kept, the one on screen with the note of the drawing as it is now. */
  const pinsToSave = () => (vpins && drawnLayout ? withViewPins(pins, drawn?.view, noted(vpins) ?? undefined) : pins);

  /** Applies a text edit (and optionally new pins) as one undo step. */
  const apply = (next: string | undefined, nextPins?: LayoutSidecar | null) => {
    if (next == null) return notify(t('That change did not work on this YAML: fix the problems in the editor, or make it there'), { tone: 'error' });
    editor.current?.replace(next, { pins: nextPins === undefined ? undefined : (withViewPins(pins, drawn?.view, nextPins) ?? null) });
    acted();
  };
  /** Changes only pins (of the view drawn), as one undo step. */
  const pinTo = (next: LayoutSidecar | null | undefined) => {
    editor.current?.pin(withViewPins(pins, drawn?.view, next));
    acted();
  };
  /** Pins with nodes (and groups) moved, or unpinned with undefined; null when nothing is pinned any more. */
  const withPins = (movedNodes: Record<string, Point | undefined>, movedGroups: Record<string, Point | undefined> = {}): LayoutSidecar | null => {
    const nodes = { ...(vpins?.nodes ?? {}) };
    const groups = { ...(vpins?.groups ?? {}) };
    const set = (target: Record<string, Point>, moved: Record<string, Point | undefined>) => {
      for (const [id, at] of Object.entries(moved)) {
        if (at) target[id] = at;
        else delete target[id];
      }
    };
    set(nodes, movedNodes);
    set(groups, movedGroups);
    // Bent lines and locks stay as they are; a lock without its pin goes (it would hold nothing).
    const out: LayoutSidecar = { version: 1, ...(vpins?.edges ? { edges: vpins.edges } : {}) };
    if (Object.keys(nodes).length) out.nodes = nodes;
    if (Object.keys(groups).length) out.groups = groups;
    const keep = (vpins?.locked ?? []).filter((id) => nodes[id] || groups[id]);
    if (keep.length) out.locked = keep;
    return noted(out);
  };
  /** Unpins everything and draws the view from scratch: the automatic layout for the diagram as it is now. */
  const resetLayout = () => {
    setFresh((n) => n + 1);
    // Positions that were asked for stay asked for: the note is filled in again with the next save.
    if (vpins) pinTo(tracked ? { version: 1, layout: { at: '' } } : null);
    else acted();
  };
  /**
   * Tidy: lays out afresh everything that is not pinned, around what is (pins, locks and bent lines
   * stay). The drawing before is forgotten, so the rest is placed as a new drawing would place it.
   */
  const tidyLayout = () => {
    previewControl.current?.fitNext();
    setFresh((n) => n + 1);
    if (!vpins) return void acted();
    const { layout: _, ...kept } = vpins;
    pinTo(kept.nodes || kept.groups || kept.edges ? kept : tracked ? { version: 1, layout: { at: '' } } : null);
    notify(pinCount ? count(pinCount, 'Tidied: {count} pinned element stayed, the rest is laid out afresh (⌘Z undoes it)|Tidied: {count} pinned elements stayed, the rest is laid out afresh (⌘Z undoes it)') : t('Tidied: laid out afresh'));
  };
  /** Tidy all: unpins everything and lays it out afresh, as one undo step. */
  const tidyAll = () => {
    previewControl.current?.fitNext();
    resetLayout();
    if (vpins) notify(pinCount ? count(pinCount, 'Unpinned {count} element and laid it all out afresh|Unpinned {count} elements and laid it all out afresh') : t('Laid it all out afresh'), { action: { label: t('Undo'), run: () => editor.current?.undo() } });
  };
  /** Pins the selected nodes and groups where they are, or unpins them when all are pinned: the layout places them again. */
  const togglePin = () => {
    const shift = result?.placed?.shift ?? { x: 0, y: 0 };
    const items = selection.filter((s) => s.kind !== 'edge' && (s.kind === 'node' ? result?.placed?.nodes.has(s.id) : result?.placed?.groups.has(s.id)));
    if (!items.length || !current) return;
    const isPinned = (s: Selection) => (s.kind === 'node' ? vpins?.nodes?.[s.id] : vpins?.groups?.[s.id]);
    const unpin = items.every(isPinned);
    if (unpin && items.some((s) => locked.has(s.id))) return notify(t('Locked: unlock it first (⇧⌘L)'));
    const at = (s: Selection) => {
      const b = (s.kind === 'node' ? result!.placed!.nodes : result!.placed!.groups).get(s.id)!;
      return unpin ? undefined : { x: Math.round(b.x + shift.x), y: Math.round(b.y + shift.y) };
    };
    pinTo(withPins(Object.fromEntries(items.filter((s) => s.kind === 'node').map((s) => [s.id, at(s)])), Object.fromEntries(items.filter((s) => s.kind === 'group').map((s) => [s.id, at(s)]))));
    notify(unpin ? count(items.length, 'Unpinned {count} element: the layout places it|Unpinned {count} elements: the layout places it') : count(items.length, 'Pinned {count} element: it stays where it is|Pinned {count} elements: it stays where it is'));
  };
  /** Pins with one line's bends set (or reset with undefined). */
  const withEdge = (id: string, via: Point[] | undefined): LayoutSidecar | null => {
    const e = result?.graph?.edges.find((x) => x.id === id);
    const edges = { ...(vpins?.edges ?? {}) };
    if (via?.length && e) edges[id] = { via, from: e.from.node, to: e.to.node };
    else delete edges[id];
    const out: LayoutSidecar = { ...(vpins ?? {}), version: 1, edges };
    if (!Object.keys(edges).length) delete out.edges;
    return noted(out);
  };
  /** Pins with one node (or group) moved or unpinned; null when nothing is pinned any more. */
  const withPin = (id: string, at: Point | undefined, group = false): LayoutSidecar | null => (group ? withPins({}, { [id]: at }) : withPins({ [id]: at }));
  /** A moved group carries everything inside, including elements and groups that have their own pins. */
  const moveGroupPins = (id: string, at: Point): LayoutSidecar | null => {
    const graph = result?.graph;
    const box = result?.placed?.groups.get(id);
    const shift = result?.placed?.shift ?? { x: 0, y: 0 };
    const next = withPin(id, at, true);
    if (!graph || !box || !next) return next;
    const dx = at.x - (box.x + shift.x);
    const dy = at.y - (box.y + shift.y);
    const inside = new Set<string>();
    const walk = (g: string) => graph.groups.filter((c) => c.parent === g).forEach((c) => (inside.add(c.id), walk(c.id)));
    walk(id);
    const move = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
    for (const n of graph.nodes) if (n.parent && (n.parent === id || inside.has(n.parent)) && next.nodes?.[n.id]) next.nodes[n.id] = move(next.nodes[n.id]!);
    for (const g of inside) if (next.groups?.[g]) next.groups[g] = move(next.groups[g]!);
    return next;
  };
  /** Unpins one element (from the inspector): its lock goes too, there is no place left to hold it at. */
  const unpinOne = (s: Selection) => {
    const next = withPin(s.id, undefined, s.kind === 'group');
    editor.current?.pin(withViewPins(pins, drawn?.view, next && { ...next, locked: next.locked?.filter((id) => id !== s.id) }));
  };
  /** Where the selected nodes go when `id` moves to `at`: all by the same distance. */
  const movedWith = (id: string, at: Point): Record<string, Point> => {
    const many = selection.length > 1 && selection.some((s) => s.kind === 'node' && s.id === id);
    const box = result?.placed?.nodes.get(id);
    const shift = result?.placed?.shift ?? { x: 0, y: 0 };
    if (!many || !box) return { [id]: at };
    const dx = at.x - (box.x + shift.x);
    const dy = at.y - (box.y + shift.y);
    const out: Record<string, Point> = {};
    for (const s of selection) {
      const b = s.kind === 'node' && !locked.has(s.id) ? result?.placed?.nodes.get(s.id) : undefined;
      if (b) out[s.id] = { x: Math.round(b.x + shift.x + dx), y: Math.round(b.y + shift.y + dy) };
    }
    out[id] = at;
    return out;
  };
  const nudge = (dx: number, dy: number) => {
    if (!current) return;
    const shift = result?.placed?.shift ?? { x: 0, y: 0 };
    const moved: Record<string, Point> = {};
    const groups: Record<string, Point> = {};
    for (const s of selection) {
      if (locked.has(s.id)) continue;
      const box = s.kind === 'node' ? result?.placed?.nodes.get(s.id) : s.kind === 'group' ? result?.placed?.groups.get(s.id) : undefined;
      if (box) (s.kind === 'group' ? groups : moved)[s.id] = { x: Math.round(box.x + shift.x + dx), y: Math.round(box.y + shift.y + dy) };
    }
    // A group moves with everything in it: what is pinned inside moves along.
    const graph = result?.graph;
    const inside = (id: string, g: string) => {
      for (let p = graph?.nodes.find((n) => n.id === id)?.parent ?? graph?.groups.find((x) => x.id === id)?.parent; p; p = graph?.groups.find((x) => x.id === p)?.parent) if (p === g) return true;
      return false;
    };
    const next = Object.keys(moved).length || Object.keys(groups).length ? withPins(moved, groups) : undefined;
    if (next && Object.keys(groups).length) {
      for (const [id, at] of Object.entries(next.nodes ?? {})) if (!moved[id] && Object.keys(groups).some((g) => inside(id, g))) next.nodes![id] = { x: at.x + dx, y: at.y + dy };
      for (const [id, at] of Object.entries(next.groups ?? {})) if (!groups[id] && Object.keys(groups).some((g) => inside(id, g))) next.groups![id] = { x: at.x + dx, y: at.y + dy };
    }
    if (next !== undefined) pinTo(next);
    else if (selection.some((s) => locked.has(s.id))) notify(t('Locked: unlock it first (⇧⌘L)'));
  };
  /** Aligns or distributes the selected shapes (locked ones stay put and others line up with them), as one undo step. */
  const arrangeSelection = (op: ArrangeOp) => {
    if (!current) return;
    const shift = result?.placed?.shift ?? { x: 0, y: 0 };
    const boxes = selection.flatMap((s) => {
      const b = s.kind === 'node' ? result?.placed?.nodes.get(s.id) : undefined;
      return b ? [[s.id, { ...b, x: b.x + shift.x, y: b.y + shift.y }] as [string, typeof b]] : [];
    });
    const need = op.startsWith('distribute') ? 3 : 2;
    if (boxes.length < need) return notify(t('Select {count} or more shapes first', { count: need }), { tone: 'error' });
    const moved = Object.fromEntries(Object.entries(arrange(boxes, op)).filter(([id]) => !locked.has(id)));
    if (!Object.keys(moved).length) return;
    // The ones already in line are pinned too: unpinned, the layout would push them out of the others' way.
    const stay = Object.fromEntries(boxes.filter(([id]) => !moved[id] && !vpins?.nodes?.[id]).map(([id, b]) => [id, { x: Math.round(b.x), y: Math.round(b.y) }]));
    pinTo(withPins({ ...stay, ...moved }));
  };
  /** Locks the selected nodes and groups where they are (pinning them), or unlocks them when all are locked. */
  const toggleLock = () => {
    const shift = result?.placed?.shift ?? { x: 0, y: 0 };
    const items = selection.filter((s) => s.kind !== 'edge' && (s.kind === 'node' ? result?.placed?.nodes.has(s.id) : result?.placed?.groups.has(s.id)));
    if (!items.length || !current) return;
    const unlock = items.every((s) => locked.has(s.id));
    const at = (s: Selection) => {
      const b = (s.kind === 'node' ? result?.placed?.nodes : result?.placed?.groups)!.get(s.id)!;
      return { x: Math.round(b.x + shift.x), y: Math.round(b.y + shift.y) };
    };
    const pinned = (s: Selection) => (s.kind === 'node' ? vpins?.nodes?.[s.id] : vpins?.groups?.[s.id]);
    const next = unlock ? withPins({}) : withPins(
      Object.fromEntries(items.filter((s) => s.kind === 'node' && !pinned(s)).map((s) => [s.id, at(s)])),
      Object.fromEntries(items.filter((s) => s.kind === 'group' && !pinned(s)).map((s) => [s.id, at(s)])),
    );
    const ids = new Set(items.map((s) => s.id));
    const list = unlock ? [...locked].filter((id) => !ids.has(id)) : [...new Set([...locked, ...ids])];
    const out: LayoutSidecar = { ...(next ?? { version: 1 }), locked: list };
    if (!list.length) delete out.locked;
    pinTo(noted(out));
    notify(unlock ? count(items.length, 'Unlocked {count} element|Unlocked {count} elements') : count(items.length, 'Locked {count} element: it stays where it is|Locked {count} elements: it stays where it is'));
  };
  return { pinsToSave, apply, pinTo, withPins, withEdge, withPin, moveGroupPins, unpinOne, movedWith, resetLayout, tidyLayout, tidyAll, togglePin, nudge, arrangeSelection, toggleLock };
}
export type Pins = ReturnType<typeof pinActions>;
