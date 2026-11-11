// Renaming and deleting an entry by its YAML path, with everything that names it: lines, `in:`
// keys, steps, focus, views and threats. Text in, text out, so comments and order stay. The
// editor's builder and the path-based edits (edit.ts: MCP tools, proposals) share these.
import { isMap, isScalar, isSeq, parseDocument, type Document } from 'yaml';
import type { DiagramType, Reference } from './diagram-type.ts';
import { namesIn, placeRefsTo, placeSites, type PlaceSite } from './place-refs.ts';
import { printPreserving } from './yaml-print.ts';

type Path = (string | number)[];

const sources = new WeakMap<Document, string>();

function parse(text: string): Document | undefined {
  const doc = parseDocument(text);
  if (doc.errors.length) return undefined;
  sources.set(doc, text);
  return doc;
}

const str = (doc: Document) => printPreserving(sources.get(doc)!, doc);

/** The references to one entry, as the type declares them. */
function referencesTo(doc: Document, type: DiagramType, collection: string, id: string): Reference[] {
  if (!type.references) return [];
  return type.references(doc.toJS() as never).filter((r) => r.collection === collection && r.id === id);
}

/**
 * An entry of a collection, also one nested in an entry of the same collection (a state in a composite
 * state), or written in a list inside one as "- Name: { … }" (a capability inside its area).
 */
export const isEntryPath = (path: Path): boolean => {
  if (path.length < 2 || typeof path[0] !== 'string' || typeof path.at(-1) !== 'string') return false;
  for (let i = 1; i < path.length; ) {
    if (typeof path[i] !== 'string') return false;
    if (++i === path.length) return true;
    // On into the entry: its nested collection, or an item of the list it holds.
    if (path[i] !== path[0] && typeof path[i] !== 'number') return false;
    i++;
  }
  return false;
};

const ID = /^[A-Za-z0-9_-]+$/;
/** A name as a reader says it: words with spaces, and nothing YAML or an arrow would trip over. */
const NAME = /^[\p{L}\p{N}](?:[^:#>[\]{},&*!|'"%@`\\]*[^\s:#>[\]{},&*!|'"%@`\\-])?$/u;

/** Renames an entry and every reference to it, and nothing else (labels and other collections stay). */
export function renameEntryUnsafe(text: string, type: DiagramType, path: Path, to: string): string | undefined {
  const doc = parse(text);
  const from = String(path.at(-1));
  if (!doc || !(type.freeNames ? NAME : ID).test(to) || from === to || !isEntryPath(path)) return undefined;
  const parentNode = doc.getIn(path.slice(0, -1));
  const pair = isMap(parentNode) ? parentNode.items.find((p) => String((p.key as { value?: unknown }).value) === from) : undefined;
  const refs = referencesTo(doc, type, String(path[0]), from);
  if (isMap(parentNode) && parentNode.has(to)) return undefined;
  // A step that only the flow names has no entry: it is renamed where it is written. Its new name
  // must be new there too, or two steps would silently become one.
  if (type.freeNames ? referencesTo(doc, type, String(path[0]), to).length > 0 || (!pair && !refs.length) : !pair) return undefined;
  if (pair) (pair.key as { value: unknown }).value = to;
  renamePlaces(doc, type, from, to);
  // Later ids in the same string first, so earlier offsets stay right.
  for (const r of [...refs].sort((a, b) => b.start - a.start)) {
    const node = doc.getIn(r.path, true);
    if (r.key && isMap(node) && node.items.length === 1 && isScalar(node.items[0]!.key)) {
      const k = node.items[0]!.key;
      k.value = splice(String(k.value), r.start, from.length, to);
    } else if (isScalar(node) && typeof node.value === 'string') node.value = splice(node.value, r.start, from.length, to);
  }
  return str(doc);
}

const splice = (s: string, at: number, len: number, insert: string) => s.slice(0, at) + insert + s.slice(at + len);

/** Keys the type's schema defines itself (a journey's steps): those are its entries, not presentation. */
const ownsKey = (type: DiagramType) => {
  const props = (type.schema as { properties?: Record<string, unknown> }).properties ?? {};
  return (k: string) => k in props;
};

/** Steps, focus, views, threats and trust that name `from` (place-refs.ts) name `to` instead. */
function renamePlaces(doc: Document, type: DiagramType, from: string, to: string) {
  const refs = placeRefsTo(doc.toJS(), from, ownsKey(type)).sort((a, b) => b.start - a.start);
  for (const r of refs) {
    const node = doc.getIn(r.path, true);
    const holder = r.key != null ? (isMap(node) ? node.items.find((p) => isScalar(p.key) && String(p.key.value) === r.key)?.key : undefined) : node;
    if (isScalar(holder) && typeof holder.value === 'string') holder.value = splice(holder.value, r.start, from.length, to);
  }
}

/** Takes away every place-reference to what is gone: a step keeps its caption, a focus or list that names nothing any more goes. */
function dropPlaces(doc: Document, type: DiagramType, gone: Set<string>) {
  const owns = ownsKey(type);
  for (let guard = 0; guard < 1000; guard++) {
    const hit = placeSites(doc.toJS(), owns).find((s) => namesIn(s.text).some((n) => gone.has(n.id)));
    if (!hit) return;
    dropSite(doc, hit);
  }
}

function dropSite(doc: Document, s: PlaceSite) {
  if (s.key != null) {
    const map = doc.getIn(s.path, true);
    if (!isMap(map)) return;
    const value = map.get(s.key);
    map.delete(s.key);
    // A route step said its caption as the route's value: the step stays, with that caption.
    if (s.role === 'route' && typeof value === 'string' && value && !map.has('caption')) {
      if (!map.items.length) return void doc.setIn(s.path, value);
      map.set('caption', value);
    }
    return prune(doc, s.path);
  }
  // A threat about what is gone goes with it.
  const at = s.role === 'threat' ? s.path.slice(0, -1) : s.path;
  doc.deleteIn(at);
  if (at.at(-1) === 'on') {
    doc.deleteIn(at.slice(0, -1));
    return prune(doc, at.slice(0, -2));
  }
  prune(doc, at.slice(0, -1));
}

/** Containers left empty go, up to a view (which stays, drawing everything) or the top; a focus without `on` is no focus. */
function prune(doc: Document, path: Path) {
  for (let p = path; p.length && !(p[0] === 'views' && p.length <= 2); p = p.slice(0, -1)) {
    const n = doc.getIn(p, true);
    if (!((isMap(n) || isSeq(n)) && !n.items.length)) return;
    doc.deleteIn(p);
    if (p.at(-1) === 'on') {
      p = p.slice(0, -1);
      doc.deleteIn(p);
    }
  }
}

/** Deletes an entry and what only made sense with it: edges to it, list items naming it, `in:` keys. */
export function deleteEntryUnsafe(text: string, type: DiagramType, path: Path): string | undefined {
  const doc = parse(text);
  if (!doc) return undefined;
  const isListItem = typeof path.at(-1) === 'number';
  // With a composite state go the states inside it, and what names them.
  const inside = (v: unknown): string[] => {
    const nested = v && typeof v === 'object' ? (v as Record<string, unknown>)[String(path[0])] : undefined;
    return nested && typeof nested === 'object' && !Array.isArray(nested) ? Object.entries(nested).flatMap(([k, e]) => [k, ...inside(e)]) : [];
  };
  const entry = path.reduce<unknown>((v, seg) => (v && typeof v === 'object' ? (v as Record<string | number, unknown>)[seg] : undefined), doc.toJS());
  const gone = isListItem || !isEntryPath(path) ? [] : [String(path.at(-1)), ...inside(entry)];
  const refs = gone.flatMap((id) => referencesTo(doc, type, String(path[0]), id));
  const items = new Map<string, Path>();
  const keys: Path[] = [];
  const cuts: Reference[] = [];
  for (const r of refs) {
    const last = r.path.reduce<number>((at, seg, i) => (typeof seg === 'number' ? i : at), -1);
    const mode = r.onDelete ?? (last >= 0 ? 'item' : 'key');
    if (mode === 'item' && last >= 0) items.set(JSON.stringify(r.path.slice(0, last + 1)), r.path.slice(0, last + 1));
    else if (mode === 'cut') cuts.push(r);
    else keys.push(r.path);
  }
  // A chain that would be left with one name is no line any more: its item goes.
  const cutsAt = new Map<string, number>();
  for (const r of cuts) cutsAt.set(JSON.stringify(r.path), (cutsAt.get(JSON.stringify(r.path)) ?? 0) + 1);
  for (const r of cuts.splice(0)) {
    const last = r.path.reduce<number>((at, seg, i) => (typeof seg === 'number' ? i : at), -1);
    if (r.among != null && last >= 0 && r.among - cutsAt.get(JSON.stringify(r.path))! < 2) items.set(JSON.stringify(r.path.slice(0, last + 1)), r.path.slice(0, last + 1));
    else cuts.push(r);
  }
  // Later cuts in the same string first, so earlier offsets stay right.
  for (const r of cuts.sort((a, b) => (b.cut?.[0] ?? 0) - (a.cut?.[0] ?? 0))) {
    const node = doc.getIn(r.path, true);
    const holder = r.key && isMap(node) && node.items.length === 1 ? node.items[0]!.key : node;
    if (isScalar(holder) && typeof holder.value === 'string' && r.cut) holder.value = (holder.value.slice(0, r.cut[0]) + holder.value.slice(r.cut[1])).trim();
  }
  for (const k of keys) doc.deleteIn(k);
  // List items last, highest index first, so earlier indexes stay valid.
  for (const p of [...items.values()].sort((a, b) => (b.at(-1) as number) - (a.at(-1) as number))) doc.deleteIn(p);
  // A step that only the flow names has no entry of its own to take away.
  if (doc.hasIn(path)) {
    doc.deleteIn(path);
    // "- Name: { … }" taken out of a list leaves nothing of its item: the item goes too.
    const holder = doc.getIn(path.slice(0, -1), true);
    if (typeof path.at(-2) === 'number' && isMap(holder) && !holder.items.length) doc.deleteIn(path.slice(0, -1));
  }
  else if (!refs.length) return undefined;
  if (gone.length) dropPlaces(doc, type, new Set(gone));
  return str(doc);
}
