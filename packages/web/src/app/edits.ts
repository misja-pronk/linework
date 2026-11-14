// Builder actions: edits of the YAML text (with pins where they move too), each one undo step in the
// editor's history. Add, delete, duplicate, copy and paste, rename, labels typed in place, drag (and
// into a group), connect. What an edit adds is selected once it is drawn.
import { useEffect, useState } from 'react';
import type { PaletteItem, Path, Point } from '@linework/core';
import { t } from '../i18n/index.ts';
import { typeName } from '../library.ts';
import type { EditorHandle } from '../editor.tsx';
import type { LabelTarget, Selection } from '../preview.tsx';
import { addEntry, connectEntries, copyEntries, deleteEntries, deleteEntry, drawnAs, duplicateEntry, edgeFields, editChainLine, fieldsFor, isChainLine, isEntryPath, isScalarAt, parentKey, pasteEntries, renameEntry, setEdgeField, setField, type Clip } from '../builder.ts';
import type { Drawing } from './drawing.ts';
import type { Pins } from './pins.ts';
import type { SelectionState, Select } from './selection.ts';
import type { Notify } from './toasts.tsx';
import { count, label } from './names.ts';

/** Copied entries, kept in memory: the page's own clipboard (the system one stays free for text). */
let clipboard: Clip | undefined;

/** Put the cursor in a field of the inspector once it shows this selection: on a busy machine that is more than one frame away. */
const toInspector = (sel: Selection, field: string, select = false, tries = 60) => {
  const el = document.querySelector(`.inspector[data-selection="${CSS.escape(`${sel.kind}:${sel.id}`)}"] ${field}`) as HTMLInputElement | null;
  if (el) return select ? el.select() : el.focus();
  if (tries > 0) requestAnimationFrame(() => toInspector(sel, field, select, tries - 1));
};

interface Props {
  drawing: Drawing;
  selection: SelectionState;
  select: Select;
  pins: Pins;
  editor: React.RefObject<EditorHandle | null>;
  textNow(): string;
  notify: Notify;
  showInspector(): void;
  /** The add popup over the drawing closes with an add. */
  closeAdding(): void;
}

export function useEdits({ drawing, selection: sel, select: sx, pins: px, editor, textNow, notify, showInspector, closeAdding }: Props) {
  const { result, current, type, vpins, entries, setDraft } = drawing;
  const { selection, selected, setSelection, setSelected } = sel;
  const { pathOf } = sx;
  const { apply, pinTo, withPins, withPin } = px;

  /** Builder actions use the drawing's paths, so they wait for a drawing of the current text. */
  const ready = () => {
    if (result?.graph && current) return true;
    notify(result?.graph ? t('One moment: the drawing is catching up with the text') : t('Fix the problems in the YAML first'), { tone: 'error' });
    return false;
  };
  const nodeName = (id: string) => {
    const n = result?.graph?.nodes.find((x) => x.id === id);
    return n ? label(n) : id;
  };

  const [pendingEdge, setPendingEdge] = useState<{ from: string; to: string; count: number }>();
  useEffect(() => {
    if (!pendingEdge || !result?.graph || !current) return;
    const edges = result.graph.edges;
    if (edges.length <= pendingEdge.count) return;
    const e = [...edges].reverse().find((x) => x.from.node === pendingEdge.from && x.to.node === pendingEdge.to);
    setPendingEdge(undefined);
    if (!e) return;
    setSelected({ kind: 'edge', id: e.id });
    showInspector();
    toInspector({ kind: 'edge', id: e.id }, '.field input:not([type="checkbox"])');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- waits for the drawing to catch up, not for the setters
  }, [pendingEdge, result, current]);

  /** After an add, select the new element once it is drawn (node or group, whatever its type makes it). */
  const [pendingPath, setPendingPath] = useState<string>();
  useEffect(() => {
    if (!pendingPath || !result?.graph || !current) return;
    const n = result.graph.nodes.find((x) => JSON.stringify(x.path) === pendingPath);
    const g = result.graph.groups.find((x) => JSON.stringify(x.path) === pendingPath);
    if (n || g) {
      setSelected(n ? { kind: 'node', id: n.id } : { kind: 'group', id: g!.id });
      showInspector();
      toInspector(n ? { kind: 'node', id: n.id } : { kind: 'group', id: g!.id }, '.inspector-body > .field input', true);
    }
    setPendingPath(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- waits for the drawing to catch up, not for the setters
  }, [pendingPath, result, current]);
  /** After a paste or a duplicate of several: select the copies once they are drawn. */
  const [pendingPaths, setPendingPaths] = useState<string[]>();
  useEffect(() => {
    if (!pendingPaths || !result?.graph || !current) return;
    const want = new Set(pendingPaths);
    setSelection([
      ...result.graph.nodes.filter((x) => want.has(JSON.stringify(x.path))).map((x) => ({ kind: 'node' as const, id: x.id })),
      ...result.graph.groups.filter((x) => want.has(JSON.stringify(x.path))).map((x) => ({ kind: 'group' as const, id: x.id })),
    ]);
    setPendingPaths(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- waits for the drawing to catch up, not for the setters
  }, [pendingPaths, result, current]);

  const add = (item: PaletteItem, parentGroup?: string | null, at?: Point) => {
    closeAdding();
    if (!type) return;
    const g = (parentGroup === undefined ? (selected?.kind === 'group' ? selected.id : undefined) : parentGroup) ?? undefined;
    const gp = g ? result?.graph?.groups.find((x) => x.id === g)?.path : undefined;
    // A selected element that can hold the new one (a capability, a manager) takes it in the same way as a group.
    const np = parentGroup === undefined && selected?.kind === 'node' ? result?.graph?.nodes.find((x) => x.id === selected.id)?.path : undefined;
    const holder = np && isEntryPath(np) && parentKey(type, item.collection, String(np[0])) ? { collection: String(np[0]), id: String(np.at(-1)) } : undefined;
    const parent = gp && gp.length === 2 && parentKey(type, item.collection, String(gp[0])) ? { collection: String(gp[0]), id: String(gp[1]) } : holder;
    const r = addEntry(textNow(), type, item, parent);
    if (!r) return apply(undefined);
    // Dropped at a point: it stays there, pinned as a node or, for a new group, by its top-left.
    const drawnAt = at && drawnAs(r.text, type, r.path);
    apply(r.text, at && drawnAt ? withPin(drawnAt.id, at, drawnAt.kind === 'group') : undefined);
    // The label is what people change first: selected and focused once it is drawn.
    setPendingPath(JSON.stringify(r.path));
  };

  /** Deletes the selection (or another element, e.g. a line from the inspector's connection list). */
  const remove = (s: Selection | undefined = selected) => {
    const path = pathOf(s);
    if (!path || !s || !type || !ready()) return;
    // One arrow of a chain ("a -> b -> c"): the chain is cut there, the rest of it stays.
    if (s.kind === 'edge' && isChainLine(textNow(), type, s.id)) {
      const next = editChainLine(textNow(), type, s.id);
      apply(next);
      if (next != null && s === selected) setSelected(undefined);
      return;
    }
    // A line that stands for part of something bigger (a policy, a list) is changed in the YAML.
    const deletable = isEntryPath(path) || typeof path.at(-1) === 'number' || (s.kind === 'edge' && isScalarAt(textNow(), path));
    if (!deletable) {
      notify(t('This one is part of a larger entry: change it in the YAML'), { tone: 'error' });
      const e = entries.find((x) => x.kind === s.kind && x.id === s.id);
      if (e) editor.current?.reveal(e.from, e.to);
      return;
    }
    const next = deleteEntry(textNow(), type, path);
    const pinned = s.kind === 'node' ? vpins?.nodes?.[s.id] : s.kind === 'group' ? vpins?.groups?.[s.id] : undefined;
    apply(next, pinned ? withPin(s.id, undefined, s.kind === 'group') : undefined);
    if (next != null && s === selected) setSelected(undefined);
  };

  const duplicate = () => {
    if (selection.length > 1) return paste(copy(false));
    const path = pathOf(selected);
    if (!path || !selected || path.length !== 2 || !ready()) return;
    const r = duplicateEntry(textNow(), path, type);
    if (!r) return apply(undefined);
    const box = result?.placed?.nodes.get(selected.id);
    const shift = result?.placed?.shift ?? { x: 0, y: 0 };
    apply(r.text, box ? withPin(r.id, { x: Math.round(box.x + shift.x + 24), y: Math.round(box.y + shift.y + 24) }) : undefined);
    setSelected({ kind: selected.kind, id: r.id });
  };

  /** Deletes everything selected as one step; parts of larger entries stay (they are changed in the YAML). */
  const removeAll = () => {
    if (!type || !ready()) return;
    const tx = textNow();
    const chain = selection.filter((s) => s.kind === 'edge' && isChainLine(tx, type, s.id));
    const rest = selection.filter((s) => !chain.includes(s));
    const paths = rest.map(pathOf).filter((p): p is Path => !!p && (isEntryPath(p) || typeof p.at(-1) === 'number' || isScalarAt(tx, p)));
    if (!paths.length && !chain.length) return notify(t('These are parts of larger entries: change them in the YAML'), { tone: 'error' });
    // Arrows of chains and whole list items go together, last written first, so the places of the
    // others stay right; an arrow in an item that goes anyway is left alone.
    const place = (p: Path | undefined) => (typeof p?.at(-1) === 'number' ? (p.at(-1) as number) : -1);
    const items = paths.filter((p) => place(p) >= 0);
    const ops = [...items.map((p) => ({ at: place(p), path: p, id: '' })), ...chain.map((s) => ({ at: place(pathOf(s)), path: undefined, id: s.id }))];
    ops.sort((a, b) => b.at - a.at || Number(!!b.path) - Number(!!a.path) || b.id.localeCompare(a.id, undefined, { numeric: true }));
    let next: string | undefined = tx;
    for (const op of ops) {
      if (next == null) break;
      if (op.path) next = deleteEntry(next, type, op.path);
      else if (!items.some((p) => place(p) === op.at)) next = editChainLine(next, type, op.id);
    }
    const others = paths.filter((p) => place(p) < 0);
    if (next != null && others.length) next = deleteEntries(next, type, others);
    const gone = (kind: 'node' | 'group') => Object.fromEntries(selection.filter((s) => s.kind === kind).map((s) => [s.id, undefined]));
    const unpinned = vpins && selection.some((s) => (s.kind === 'node' ? vpins.nodes?.[s.id] : s.kind === 'group' ? vpins.groups?.[s.id] : undefined));
    const nextPins = unpinned ? withPins(gone('node'), gone('group')) : undefined;
    apply(next, nextPins);
    if (next != null) {
      setSelection([]);
      if (paths.length < rest.length) notify(t('Deleted {count}; {kept} that are part of larger entries stayed', { count: paths.length + chain.length, kept: rest.length - paths.length }));
    }
  };

  /** Copies the selected entries (with the lines between them) to the app's clipboard. */
  const copy = (announce = true): Clip | undefined => {
    if (!type || !ready()) return undefined;
    const clip = copyEntries(textNow(), type, selection.map(pathOf).filter((p): p is Path => !!p));
    if (!clip) {
      if (announce) notify(t('Nothing to copy: select shapes or groups'), { tone: 'error' });
      return undefined;
    }
    clipboard = clip;
    if (announce) notify(count(clip.entries.length, 'Copied {count} element|Copied {count} elements'));
    return clip;
  };
  /** Pastes under new ids, selected afterwards, as one undo step. The copies are not pinned: the layout gives
   * them a free spot, where a fixed offset would put them over the originals or inside a group they are not in. */
  const paste = (clip: Clip | undefined = clipboard) => {
    if (!clip || !type || !ready()) return;
    if (clip.type !== type.id) return notify(t('That was copied from another kind of diagram ({type})', { type: typeName(clip.type) }), { tone: 'error' });
    const r = pasteEntries(textNow(), type, clip);
    if (!r) return apply(undefined);
    apply(r.text);
    setPendingPaths(r.paths.map((p) => JSON.stringify(p)));
  };

  // ------------------------------------------------------------ labels in place

  /** The label field of an entry: what the drawing shows as its name. */
  const labelField = (path: Path) => {
    const f = type && fieldsFor(textNow(), type, path).find((x) => x.kind === 'text' && ['label', 'title', 'name'].includes(x.key));
    return f && f.kind === 'text' ? f : undefined;
  };
  const labelOf = (lt: LabelTarget): string | undefined => {
    if (!type || !current) return undefined;
    if (lt.kind === 'title' || lt.kind === 'subtitle') return String((result?.graph as { title?: string; subtitle?: string } | undefined)?.[lt.kind] ?? '');
    const path = pathOf(lt as Selection);
    if (!path) return undefined;
    if (lt.kind === 'edge') {
      if (isChainLine(textNow(), type, lt.id)) return result?.graph?.edges.find((x) => x.id === lt.id)?.label ?? '';
      const f = path.length === 2 && path[0] === 'edges' && typeof path[1] === 'number' ? edgeFields(textNow(), type, path).find((x) => x.key === 'label') : undefined;
      return f?.kind === 'text' ? f.value : undefined;
    }
    if (!isEntryPath(path)) return undefined;
    const f = labelField(path);
    if (!f) return undefined;
    const n = lt.kind === 'node' ? result?.graph?.nodes.find((x) => x.id === lt.id) : undefined;
    const g = lt.kind === 'group' ? result?.graph?.groups.find((x) => x.id === lt.id) : undefined;
    return f.value || (n ? label(n) : g?.label) || '';
  };
  const onLabel = (lt: LabelTarget, value: string) => {
    if (!type || !ready()) return;
    if (lt.kind === 'title' || lt.kind === 'subtitle') return apply(setField(textNow(), type, [], lt.kind, value));
    const path = pathOf(lt as Selection);
    if (!path) return;
    if (lt.kind === 'edge') return apply(isChainLine(textNow(), type, lt.id) ? editChainLine(textNow(), type, lt.id, value) : setEdgeField(textNow(), path, 'label', value));
    const f = labelField(path);
    if (!f) return;
    // A step or a state is its name: typing another one renames it wherever it is written. Only a
    // name the YAML cannot hold as a key (a colon, an arrow) becomes a label on the entry.
    if (type.freeNames && !f.value && value.trim()) {
      const renamed = renameEntry(textNow(), type, path, value.trim());
      if (renamed != null) return apply(renamed);
    }
    apply(setField(textNow(), type, path, f.key, value));
  };

  const rename = (to: string): boolean => {
    const path = pathOf(selected);
    if (!path || !selected) return false;
    if (!type) return false;
    const next = renameEntry(textNow(), type, path, to);
    if (next == null) return false;
    const old = String(path.at(-1));
    const nodeId = selected.id.endsWith(old) ? selected.id.slice(0, -old.length) + to : selected.id;
    // Pins of the element and of what is drawn for it ("dev:policy:0") move to the new id.
    const rekey = (k: string) => (k === selected.id ? nodeId : k.startsWith(`${selected.id}:`) ? nodeId + k.slice(selected.id.length) : k);
    const moved = vpins?.nodes && Object.keys(vpins.nodes).some((k) => rekey(k) !== k);
    apply(next, moved ? { ...vpins, nodes: Object.fromEntries(Object.entries(vpins!.nodes!).map(([k, v]) => [rekey(k), v])) } : undefined);
    setSelected({ kind: selected.kind, id: nodeId });
    return true;
  };

  // ------------------------------------------------------------ dragging and connecting

  const move = (id: string, at: Point, done: boolean, group?: string | null) => {
    const moved = px.movedWith(id, at);
    if (!done) return setDraft({ nodes: moved });
    setDraft(undefined);
    const nextPins = withPins(moved);
    // Moving and changing group are one step: one undo puts both back.
    const reparented = group !== undefined ? reparent(id, group) : undefined;
    if (reparented) {
      apply(reparented.text, nextPins);
      notify(reparented.message);
    } else pinTo(nextPins);
  };

  /** The text with a node moved into a group (or out of all), if its type can say so. */
  const reparent = (id: string, group: string | null): { text: string; message: string } | undefined => {
    const path = pathOf({ kind: 'node', id });
    if (!type || !path || path.length !== 2) return undefined;
    const graph = result?.graph;
    const g = group ? graph?.groups.find((x) => x.id === group) : undefined;
    const parentId = graph?.nodes.find((n) => n.id === id)?.parent;
    const was = parentId ? graph?.groups.find((x) => x.id === parentId) : undefined;
    const key = parentKey(type, String(path[0]), String((g ?? was)?.path[0] ?? ''));
    if (!key || (g && g.path.length !== 2)) return undefined;
    const text = setField(textNow(), type, path, key, g ? String(g.path[1]) : undefined);
    return text == null ? undefined : { text, message: g ? t('Moved into {group}', { group: g.label }) : t('Moved out of its group') };
  };

  const connect = (from: string, to: string) => {
    if (!type || !ready()) return;
    const r = connectEntries(textNow(), type, from, to);
    if ('error' in r) return notify(r.error, { tone: 'error' });
    apply(r.text);
    notify(t('Connected {from} to {to}', { from: nodeName(from), to: nodeName(to) }));
    // The new line is selected once drawn, with its label ready to type.
    setPendingEdge({ from, to, count: result?.graph?.edges.length ?? 0 });
  };

  return { ready, nodeName, add, remove, duplicate, removeAll, copy, paste, labelOf, onLabel, rename, move, connect };
}
export type Edits = ReturnType<typeof useEdits>;
