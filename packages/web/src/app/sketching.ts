// Sketching on the canvas: Tab adds a box connected from the selected one, Enter one beside it, and
// typing names it in place ("fw: Edge firewall" also picks the kind). Each step is an edit of the
// YAML (sketch.ts) and one undo step. Keys typed while the new box is still on its way to the screen
// are kept and go into its name, so a fast typist loses nothing.
import { useLayoutEffect, useRef, useState } from 'react';
import type { PaletteItem } from '@linework/core';
import { nearestToward, type Direction } from '../craft.ts';
import { is } from '../keys.ts';
import { isEntryPath, parentKey } from '../builder.ts';
import type { LabelExit, PreviewControl, Selection } from '../preview.tsx';
import { addConnected, addFirst, addSibling, graphOf, groupInto, groupKinds, nameEntry, plainGroup, plainItem, readTyped, setKind, shapeKinds, type Sketched } from '../sketch.ts';
import { t } from '../i18n/index.ts';
import type { Drawing } from './drawing.ts';
import type { Edits } from './edits.ts';
import type { Pins } from './pins.ts';
import type { SelectionState } from './selection.ts';
import type { Notify } from './toasts.tsx';

interface Props {
  drawing: Drawing;
  selection: SelectionState;
  pins: Pins;
  edits: Edits;
  previewControl: React.RefObject<PreviewControl | null>;
  textNow(): string;
  undo(): void;
  notify: Notify;
  /** In a session: plain typing names boxes, Tab and Enter add them (elsewhere only Tab while naming). */
  session: boolean;
  /** A box was added by a sketch key: the hint has been seen at work. */
  used(): void;
}

/** What waits for the next drawing: the entry to select (and name), and the keys typed meanwhile. */
interface Pending {
  path: string;
  name: boolean;
  fresh: boolean;
  typed: string;
  /** Enter or Tab pressed before the name editor was there: the name is in, as if typed into it. */
  then?: 'enter' | 'tab';
  /** Keys pressed after that: played once it is in (the next box's name, Enter for a sibling…). */
  after: Key[];
}

/** A key press as kept for later. */
interface Key {
  key: string;
  shiftKey: boolean;
}

export function useSketching({ drawing, selection: sel, pins: px, edits, previewControl, textNow, undo, notify, session, used }: Props) {
  const { result, current, type } = drawing;
  const { selection, selected, setSelected, setSelection } = sel;
  const pending = useRef<Pending>(null);
  /** Keys typed ahead of the drawing, to play in order once it has caught up. */
  const backlog = useRef<Key[]>([]);
  /** A selection was just set: keys wait one render, until it is the one they see. */
  const settling = useRef(false);
  /** What was selected before the last sketch add: Esc on the new box goes back to it. */
  const cameFrom = useRef<Selection>(undefined);
  const [tick, setTick] = useState(0);

  // Once the entry is drawn: selected, and its name editor open with whatever was typed meanwhile.
  // A layout effect, so the editor is there before the next key arrives.
  useLayoutEffect(() => {
    const p = pending.current;
    if (!p || !result?.graph || !current) return;
    const n = result.graph.nodes.find((x) => JSON.stringify(x.path) === p.path);
    const g = n ? undefined : result.graph.groups.find((x) => JSON.stringify(x.path) === p.path);
    if (!n && !g) return;
    pending.current = null;
    settling.current = true;
    const s: Selection = n ? { kind: 'node', id: n.id } : { kind: 'group', id: g!.id };
    setSelected(s);
    if (p.name && p.then) {
      backlog.current.push(...p.after);
      named(s, p.typed || undefined, p.then, { fresh: p.fresh, was: edits.labelOf(s) ?? '' });
    } else if (p.name) previewControl.current?.rename(s, { ...(p.typed ? { initial: p.typed } : {}), fresh: p.fresh });
  }, [result, current, tick]); // eslint-disable-line react-hooks/exhaustive-deps -- waits for the drawing, not for the setters

  // Keys typed ahead, played with this render's selection: into a box on its way they go at once; any
  // other key waits for the render after it, so the next one sees what it did.
  useLayoutEffect(() => {
    const q = backlog.current;
    if (settling.current) {
      settling.current = false;
      if (q.length) setTick((n) => n + 1);
      return;
    }
    if (!q.length || previewControl.current?.renaming() || (pending.current && !pending.current.name)) return;
    while (q.length) {
      const into = !!pending.current;
      // A key that acts on the drawing waits until the drawing is of the text as it is now.
      if (!into && !current) return;
      onKey({ ...q.shift()!, metaKey: false, ctrlKey: false, altKey: false });
      if (!into && q.length) return setTick((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the drawing, the selection or a tick moves on; onKey is this render's
  }, [tick, current, result, selection]);

  /** Applies a sketch edit, then selects (and names) what it made once drawn. */
  const commit = (r: Sketched | undefined, name: boolean, typed = '', fresh = true) => {
    if (!r) return void px.apply(undefined);
    cameFrom.current = selected;
    pending.current = { path: JSON.stringify(r.path), name, fresh, typed, after: [] };
    px.apply(r.text);
    setTick((n) => n + 1);
  };

  const graph = () => result?.graph;
  const nodeOf = (id: string) => graph()?.nodes.find((n) => n.id === id);

  /** The first box (nothing selected) or one in the selected group. */
  const first = (typed = '') => {
    if (!type || !edits.ready()) return;
    const g = selected?.kind === 'group' ? graph()?.groups.find((x) => x.id === selected.id) : undefined;
    const item = plainItem(type);
    const parent = g && item && g.path.length === 2 && parentKey(type, item.collection, String(g.path[0])) ? { collection: String(g.path[0]), id: String(g.path[1]) } : undefined;
    commit(addFirst(textNow(), type, item, parent), true, typed);
    used();
  };
  const tab = (from: string, text = textNow()) => {
    if (!type) return;
    const g = graphOf(text, type) ?? graph();
    if (!g?.nodes.some((n) => n.id === from)) return;
    commit(addConnected(text, type, g, from), true);
    used();
  };
  const sibling = (of: string) => {
    if (!type || !edits.ready()) return;
    commit(addSibling(textNow(), type, graph()!, of), true);
    used();
  };

  /** A name typed on an element is in: its kind first (from "fw:" or the list), then its name. */
  const named = (target: Selection, text: string | undefined, how: LabelExit, opts: { kind?: PaletteItem; fresh: boolean; was: string }) => {
    if (!type) return;
    // Esc on a box just made by Tab or Enter: it was not wanted after all.
    if (how === 'escape') {
      if (!opts.fresh) return;
      undo();
      return setSelected(cameFrom.current);
    }
    const path = target.kind === 'node' ? nodeOf(target.id)?.path : graph()?.groups.find((x) => x.id === target.id)?.path;
    if (!path || !isEntryPath(path)) return;
    const kinds = target.kind === 'group' ? groupKinds(type) : shapeKinds(type).filter((k) => k.collection === String(path[0]));
    const read = text == null ? { name: '' } : readTyped(text, kinds);
    const kind = opts.kind ?? ('kind' in read ? read.kind : undefined);
    let out = textNow();
    let at = path;
    if (kind && kind.kind !== nodeOf(target.id)?.kind) out = setKind(out, type, at, kind.kind) ?? out;
    const name = read.name;
    if (name && name !== opts.was) {
      const r = nameEntry(out, type, at, name, opts.fresh);
      if (r) {
        out = r.text;
        at = r.path;
      }
    }
    const changed = out !== textNow();
    if (changed) {
      px.apply(out);
      if (JSON.stringify(at) !== JSON.stringify(path)) {
        pending.current = { path: JSON.stringify(at), name: false, fresh: false, typed: '', after: [] };
        setTick((n) => n + 1);
      }
    }
    // Tab: on to a new box connected from this one, named next.
    if (how === 'tab' && target.kind === 'node') {
      const g = graphOf(out, type);
      const id = g?.nodes.find((n) => JSON.stringify(n.path) === JSON.stringify(at))?.id;
      if (id) tab(id, out);
    }
  };

  /** Changes the kind of the selected elements. */
  const kindTo = (item: PaletteItem, targets: Selection[] = selection) => {
    if (!type || !edits.ready()) return;
    let out = textNow();
    for (const s of targets) {
      const path = s.kind === 'node' ? nodeOf(s.id)?.path : undefined;
      if (path && isEntryPath(path) && String(path[0]) === item.collection) out = setKind(out, type, path, item.kind) ?? out;
    }
    if (out === textNow()) return notify(t('That kind does not fit what is selected'), { tone: 'error' });
    px.apply(out);
  };

  /** Puts the selected boxes into a group: one that is there, or a new one (named next). */
  const group = (into?: string) => {
    if (!type || !edits.ready()) return;
    const nodes = selection.filter((s) => s.kind === 'node').map((s) => s.id);
    if (!nodes.length) return notify(t('Select the boxes to group first'), { tone: 'error' });
    const item = plainGroup(type);
    if (!into && !item) return notify(t('This diagram type has no groups'), { tone: 'error' });
    const r = groupInto(textNow(), type, graph()!, nodes, into ?? { item: item! });
    if (!r) return notify(t('These cannot go in a group here'), { tone: 'error' });
    if (into) {
      px.apply(r.text);
      return setSelection(nodes.map((id) => ({ kind: 'node' as const, id })));
    }
    commit(r, true);
  };

  /** Shift+Tab: back to the box this one is connected from, else the one before it. */
  const back = () => {
    const g = graph();
    if (!g || selected?.kind !== 'node') return;
    const src = g.edges.find((e) => e.to.node === selected.id && e.from.node !== selected.id)?.from.node;
    const i = g.nodes.findIndex((n) => n.id === selected.id);
    const to = src ?? g.nodes[i - 1]?.id;
    if (to) setSelected({ kind: 'node', id: to });
  };
  const toward = (dir: Direction) => {
    const pl = result?.placed;
    if (!pl) return;
    const from = selected && (selected.kind === 'node' ? pl.nodes.get(selected.id) : selected.kind === 'group' ? pl.groups.get(selected.id) : undefined);
    if (!from) {
      const firstNode = result?.graph?.nodes[0];
      if (firstNode) setSelected({ kind: 'node', id: firstNode.id });
      return;
    }
    const id = nearestToward(from, [...pl.nodes].filter(([id]) => id !== selected!.id), dir);
    if (id) setSelected({ kind: 'node', id });
  };

  /**
   * The canvas's keys for sketching; true when the key was taken. Keys typed while a new box is on its
   * way are kept for its name (in the editor too: after Tab in a name, "a" is the next name's first
   * letter, not Add).
   */
  const onKey = (e: Pick<React.KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'> & { code?: string; preventDefault?(): void }): boolean => {
    const mod = e.metaKey || e.ctrlKey;
    const p = pending.current;
    if (p?.name && !mod) {
      if (p.then) return p.after.push({ key: e.key, shiftKey: e.shiftKey }), e.preventDefault?.(), true;
      if (e.key.length === 1) p.typed += e.key;
      else if (e.key === 'Backspace') p.typed = p.typed.slice(0, -1);
      else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) p.then = e.key === 'Tab' ? 'tab' : 'enter';
      else if (e.key === 'Escape') {
        // Not wanted after all: the add is undone once it is in.
        pending.current = null;
        undo();
        setSelected(cameFrom.current);
      } else if (e.key !== 'Tab') return false;
      e.preventDefault?.();
      return true;
    }
    // ⌘G groups the selected boxes, in the editor as in a session (the toolbar's Group).
    if (mod) {
      if (e.key.toLowerCase() === 'g' && !e.shiftKey && !e.altKey) {
        group();
        e.preventDefault?.();
        return true;
      }
      return false;
    }
    if (!session) return false;
    // ⇧1 and ⇧2 zoom (to fit, to the selection) rather than start a name with "!" or "@": only a name
    // already on its way (above) takes them.
    if (is({ ...e, code: e.code ?? '' }, 'fit') || is({ ...e, code: e.code ?? '' }, 'zoom-selection')) return false;
    const node = selected?.kind === 'node' ? selected.id : undefined;
    const take = () => (e.preventDefault?.(), true);
    switch (e.key) {
      case 'Tab':
        if (e.shiftKey) back();
        else if (node) tab(node);
        else first();
        return take();
      case 'Enter':
        if (e.shiftKey || e.altKey) return false;
        if (node) sibling(node);
        else if (selected?.kind === 'group') previewControl.current?.rename(selected);
        else first();
        return take();
      case 'F2':
        if (selected) previewControl.current?.rename(selected);
        return take();
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
        if (e.shiftKey) return false;
        toward(e.key.slice(5).toLowerCase() as Direction);
        return take();
      case 'Backspace':
      case 'Delete':
        if (selection.length > 1) edits.removeAll();
        else if (selected) edits.remove();
        return take();
      // Esc only ever lets go, never leaves: the selection, and with none, the keys go to End session
      // (↵ there ends it, Esc comes back).
      case 'Escape':
        if (selection.length) setSelection([]);
        else (document.querySelector('.session-end') as HTMLElement | null)?.focus({ preventScroll: true });
        return take();
    }
    // Plain typing: over the selected box its new name; on an empty selection, the first box of it.
    if (e.key.length === 1 && e.key !== ' ' && !e.altKey) {
      if (selected && selected.kind !== 'edge') {
        if (!previewControl.current?.rename(selected, { initial: e.key })) return false;
      } else if (!selection.length) first(e.key);
      else return false;
      return take();
    }
    return false;
  };

  /** The kinds a name can start with, for the element being named. */
  const kindsFor = (s: Selection): readonly PaletteItem[] | undefined => {
    if (!type) return undefined;
    if (s.kind === 'group') return groupKinds(type);
    const path = nodeOf(s.id)?.path;
    return path ? shapeKinds(type).filter((k) => k.collection === String(path[0])) : undefined;
  };

  return { onKey, named, kindsFor, kindTo, group, first, tab, sibling };
}
export type Sketching = ReturnType<typeof useSketching>;
