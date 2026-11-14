// Sketching fast, as text → text edits like the rest of the builder: a box connected from the selected
// one (Tab), a sibling beside it (Enter), a name typed over a box (with an optional kind prefix such
// as "fw: Edge firewall"), a kind changed, and boxes put into a group. The drawing's graph says where
// a box is (its group, what points at it); the YAML stays the source of truth.
import { parseDocument } from 'yaml';
import type { DiagramType, Graph, PaletteItem } from '@linework/core';
import { addEntry, connectEntries, drawnAs, fieldsFor, isEntryPath, kindKey, parentKey, renameEntry, setField } from './builder.ts';

type Path = (string | number)[];

/** What a sketch edit gives: the new text, and the entry it made or changed (to select once drawn). */
export interface Sketched {
  text: string;
  path: Path;
  /** Its id in the drawing, when the type draws it (a node, or a group). */
  id?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const initials = (s: string) =>
  norm(s)
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('');
/** Whether the letters of `q` appear in `s` in order ("fw" in "firewall"). */
const subsequence = (q: string, s: string) => {
  let i = 0;
  for (const c of s) if (c === q[i]) i++;
  return i === q.length;
};

/** How well a typed word names a kind: higher is better, 0 is not at all. */
function kindScore(q: string, item: PaletteItem): number {
  const word = norm(q).replace(/ /g, '');
  if (!word) return 0;
  const kind = norm(item.kind).replace(/ /g, '');
  const label = norm(item.label).replace(/ /g, '');
  const keys = (item.keywords ?? []).map((k) => norm(k).replace(/ /g, ''));
  if (word === kind || word === label) return 100;
  if (keys.includes(word)) return 90;
  if (initials(item.label) === word || initials(item.kind) === word) return 80;
  if (kind.startsWith(word) || label.startsWith(word)) return 70 - Math.min(20, kind.length - word.length);
  if (keys.some((k) => k.startsWith(word))) return 55;
  if (word.length >= 2 && (kind.includes(word) || label.includes(word))) return 45;
  if (word.length >= 2 && word[0] === kind[0] && subsequence(word, kind)) return 30 - Math.min(20, kind.length - word.length);
  return 0;
}

/** The kinds a typed word could mean, best first. */
export function matchKinds(query: string, items: readonly PaletteItem[], limit = 6): PaletteItem[] {
  return items
    .map((item, i) => ({ item, i, s: kindScore(query, item) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.item);
}

/** A typed name read for a kind prefix: "fw: Edge firewall" is a firewall named Edge firewall. */
export interface Typed {
  name: string;
  /** The word before the colon, when there is one that reads as a prefix. */
  query?: string;
  /** The kind it names, best match first. */
  kind?: PaletteItem;
}

/**
 * Reads "prefix: name". Only a short single word before the first colon counts, and only when it
 * names a kind: "Step 1: check" and "http://x" stay names as typed.
 */
export function readTyped(input: string, items: readonly PaletteItem[]): Typed {
  const m = /^\s*([A-Za-z][A-Za-z0-9-]{0,23})\s*:(?!\/\/)\s*(.*)$/s.exec(input);
  if (!m) return { name: input.trim() };
  const kind = matchKinds(m[1]!, items, 1)[0];
  return kind ? { name: m[2]!.trim(), query: m[1]!, kind } : { name: input.trim() };
}

/** Kinds a sketch starts with, in order of preference: a plain box says the least. */
const PLAIN = ['service', 'system', 'component', 'box', 'node', 'task', 'step', 'container', 'app', 'application', 'person', 'participant', 'topic', 'idea', 'table'];

/** The kinds that make shapes (not groups), as the type lists them. */
export const shapeKinds = (type: DiagramType) => type.palette.filter((p) => p.collection !== 'groups');
/** The kinds that make groups. */
export const groupKinds = (type: DiagramType) => type.palette.filter((p) => p.collection === 'groups' || p.collection === 'lanes');

/** The first box of a blank sheet: a plain one where the type has it. */
export function plainItem(type: DiagramType): PaletteItem | undefined {
  const shapes = shapeKinds(type);
  for (const k of PLAIN) {
    const hit = shapes.find((p) => p.kind === k);
    if (hit) return hit;
  }
  return shapes[0] ?? type.palette[0];
}

/** The group a sketch makes when nothing says which: a plain boundary where the type has one. */
export function plainGroup(type: DiagramType): PaletteItem | undefined {
  const groups = groupKinds(type);
  for (const k of ['boundary', 'group', 'system', 'resource-group', 'zone', 'area', 'domain', 'lane']) {
    const hit = groups.find((p) => p.kind === k);
    if (hit) return hit;
  }
  return groups[0];
}

/** The graph the type builds from a text, without drawing it: to go on from an edit before it is drawn. */
export function graphOf(text: string, type: DiagramType): Graph | undefined {
  try {
    const doc = parseDocument(text);
    return doc.errors.length ? undefined : type.build(doc.toJS() as never, { error() {}, warn() {} });
  } catch {
    return undefined;
  }
}

/** The palette item an element is, from its kind and collection; undefined when the palette has no such item. */
export function itemOf(type: DiagramType, graph: Graph, id: string): PaletteItem | undefined {
  const n = graph.nodes.find((x) => x.id === id);
  if (!n || !isEntryPath(n.path)) return undefined;
  const collection = String(n.path[0]);
  return type.palette.find((p) => p.collection === collection && p.kind === n.kind) ?? type.palette.find((p) => p.collection === collection);
}

/** The group an element is drawn in, as the parent an add takes (when its type can say so). */
function parentFor(type: DiagramType, graph: Graph, id: string, collection: string): { collection: string; id: string } | undefined {
  const n = graph.nodes.find((x) => x.id === id);
  const g = n?.parent ? graph.groups.find((x) => x.id === n.parent) : undefined;
  if (!g || g.path.length !== 2) return undefined;
  return parentKey(type, collection, String(g.path[0])) ? { collection: String(g.path[0]), id: String(g.path[1]) } : undefined;
}

/** The innermost group around all of `ids` that a group of `collection` can go in. */
function sharedParent(type: DiagramType, graph: Graph, ids: string[], collection: string): { collection: string; id: string } | undefined {
  const chain = (id: string) => {
    const out: string[] = [];
    for (let g = graph.nodes.find((x) => x.id === id)?.parent; g; g = graph.groups.find((x) => x.id === g)?.parent) out.push(g);
    return out;
  };
  const [first, ...rest] = ids.map(chain);
  const shared = (first ?? []).filter((g) => rest.every((c) => c.includes(g)));
  for (const id of shared) {
    const g = graph.groups.find((x) => x.id === id);
    if (g?.path.length === 2 && parentKey(type, collection, String(g.path[0]))) return { collection: String(g.path[0]), id: String(g.path[1]) };
  }
  return undefined;
}

/** Adds a box like `item`, in `parent`, connected from `from` when given (and the type can). */
function addFrom(text: string, type: DiagramType, item: PaletteItem, parent: { collection: string; id: string } | undefined, from: string | undefined): Sketched | undefined {
  const added = addEntry(text, type, item, parent);
  if (!added) return undefined;
  const drawn = drawnAs(added.text, type, added.path);
  let out = added.text;
  if (from && drawn) {
    const c = connectEntries(out, type, from, drawn.id);
    if ('text' in c) out = c.text;
  }
  return { text: out, path: added.path, ...(drawn ? { id: drawn.id } : {}) };
}

/** The first box on a blank sheet (or one more, unconnected, in `parent` when given). */
export function addFirst(text: string, type: DiagramType, item = plainItem(type), parent?: { collection: string; id: string }): Sketched | undefined {
  return item ? addFrom(text, type, item, parent, undefined) : undefined;
}

/** Tab: a new box connected from `from`, of the same kind, in the same group. */
export function addConnected(text: string, type: DiagramType, graph: Graph, from: string, item?: PaletteItem): Sketched | undefined {
  const it = item ?? itemOf(type, graph, from) ?? plainItem(type);
  if (!it) return undefined;
  return addFrom(text, type, it, parentFor(type, graph, from, it.collection), from);
}

/** Enter: a box beside `of`, in the same group, connected from what `of` is connected from (if one thing is). */
export function addSibling(text: string, type: DiagramType, graph: Graph, of: string, item?: PaletteItem): Sketched | undefined {
  const it = item ?? itemOf(type, graph, of) ?? plainItem(type);
  if (!it) return undefined;
  const sources = [...new Set(graph.edges.filter((e) => e.to.node === of && e.from.node !== of).map((e) => e.from.node))];
  const source = sources.length === 1 && graph.nodes.some((n) => n.id === sources[0] && isEntryPath(n.path)) ? sources[0] : undefined;
  return addFrom(text, type, it, parentFor(type, graph, of, it.collection), source);
}

/** The field an entry's name is written in (label, title, name), if it has one. */
function nameField(text: string, type: DiagramType, path: Path) {
  const f = fieldsFor(text, type, path).find((x) => x.kind === 'text' && ['label', 'title', 'name'].includes(x.key));
  return f && f.kind === 'text' ? f : undefined;
}

/** An id that reads as the name: "Orders API" → "orders-api". */
export const idFor = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/**
 * Names an entry: its label (or title, name). A type whose entries are their names renames them.
 * With `reid` (a box just made in a sketch), the id follows the name when that id is free, so the YAML
 * reads as the drawing does ("orders-api", not "service-3").
 */
export function nameEntry(text: string, type: DiagramType, path: Path, name: string, reid = false): Sketched | undefined {
  const to = name.trim();
  if (!to || !isEntryPath(path)) return undefined;
  const f = nameField(text, type, path);
  if (type.freeNames && !f?.value) {
    const renamed = renameEntry(text, type, path, to);
    return renamed != null ? { text: renamed, path: [...path.slice(0, -1), to] } : String(path.at(-1)) === to ? { text, path } : undefined;
  }
  if (!f) return undefined;
  let out = setField(text, type, path, f.key, to);
  if (out == null) return undefined;
  let at = path;
  const id = idFor(to);
  if (reid && id && id !== String(path.at(-1))) {
    const renamed = renameEntry(out, type, path, id);
    if (renamed != null) {
      out = renamed;
      at = [...path.slice(0, -1), id];
    }
  }
  return { text: out, path: at };
}

/** Changes what an entry is (a firewall, a key vault), keeping its name. */
export function setKind(text: string, type: DiagramType, path: Path, kind: string): string | undefined {
  if (!isEntryPath(path)) return undefined;
  const key = kindKey(type, String(path[0]), kind);
  if (!key) return undefined;
  // A box named after its kind ("Service") is renamed with it: it was never named by hand.
  const f = nameField(text, type, path);
  const was = type.palette.find((p) => p.collection === String(path[0]) && f?.value && p.label === f.value);
  const now = type.palette.find((p) => p.collection === String(path[0]) && p.kind === kind);
  const kinded = setField(text, type, path, key, kind);
  if (kinded == null || !f || !was || !now || type.freeNames) return kinded;
  return setField(kinded, type, path, f.key, now.label) ?? kinded;
}

/**
 * Puts nodes into a group: an existing one (`into`, a group's id in the drawing) or a new group of
 * `item`'s kind. The new group lands where the first node was (in its group, when that can hold it).
 */
export function groupInto(text: string, type: DiagramType, graph: Graph, nodes: string[], into: string | { item: PaletteItem; label?: string }): Sketched | undefined {
  let out = text;
  let target: { collection: string; id: string; path: Path; drawn?: string };
  if (typeof into === 'string') {
    const g = graph.groups.find((x) => x.id === into);
    if (!g || g.path.length !== 2) return undefined;
    target = { collection: String(g.path[0]), id: String(g.path[1]), path: g.path, drawn: g.id };
  } else {
    // The new group goes where all of them already are: in the innermost group that holds every one
    // (two cards in different subnets of one VNet: in the VNet), so nothing leaves the group it was in
    // for another. None holds them all: at the top.
    const outer = sharedParent(type, graph, nodes, into.item.collection);
    const added = addEntry(out, type, into.item, outer);
    if (!added) return undefined;
    out = added.text;
    if (into.label) out = setField(out, type, added.path, nameField(out, type, added.path)?.key ?? 'label', into.label) ?? out;
    target = { collection: into.item.collection, id: added.id, path: added.path, drawn: drawnAs(out, type, added.path)?.id };
  }
  let moved = 0;
  for (const id of nodes) {
    const n = graph.nodes.find((x) => x.id === id);
    if (!n || n.path.length !== 2) continue;
    const key = parentKey(type, String(n.path[0]), target.collection);
    if (!key) continue;
    const next = setField(out, type, n.path, key, target.id);
    if (next == null) continue;
    out = next;
    moved++;
  }
  if (!moved && typeof into === 'string') return undefined;
  return { text: out, path: target.path, ...(target.drawn ? { id: target.drawn } : {}) };
}
