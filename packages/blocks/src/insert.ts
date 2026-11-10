// A block into a diagram, as plain YAML: its ids made unique with one suffix for all of them, its
// top-level entries put into the group asked for, and each entry marked with a comment
// "# from block: name@hash #n k=v", so a newer version of the block can be offered per instance.
// Nothing stays linked: the comment is all there is, and taking it away makes the entry the diagram's own.
import { isMap as isYamlMap, isScalar, isSeq, parseDocument, type Document, type Node, type Pair, type YAMLMap, type YAMLSeq } from 'yaml';
import { printPreserving, type DiagramType, type Path, type Point, type Reference } from '@cartography/core';
import { instantiate, valuesFor, type Block } from './block.ts';

type Schema = Record<string, any>;
const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keyOf = (p: Pair) => String(isScalar(p.key) ? p.key.value : p.key);

/** Keys that put an entry inside another one, and the collections they name. */
export const PARENT_KEYS: Record<string, string[]> = { in: ['groups', 'resources'], domain: ['domains'], schema: ['schemas'], catalog: ['catalogs'] };

/** Every schema that can apply at a path, anyOf and $ref spread out. */
function schemasAt(root: Schema, path: string[]): Schema[] {
  const spread = (s: Schema | undefined): Schema[] => {
    if (!s || typeof s !== 'object') return [];
    const ref = typeof s.$ref === 'string' ? /^#\/(definitions|\$defs)\/(.+)$/.exec(s.$ref) : null;
    if (ref) return spread(root[ref[1]!]?.[ref[2]!]);
    const alts = s.anyOf ?? s.oneOf;
    return alts ? alts.flatMap(spread) : [s];
  };
  let current = spread(root);
  for (const seg of path)
    current = current.flatMap((s) => (s.properties?.[seg] ? spread(s.properties[seg]) : s.additionalProperties && typeof s.additionalProperties === 'object' ? spread(s.additionalProperties) : []));
  return current;
}

/** The key that puts an entry of `collection` inside one of `parent` (in, domain…), if the type has one. */
export function parentKeyOf(type: DiagramType, collection: string, parent: string): string | undefined {
  const props = new Set(schemasAt(type.schema as Schema, [collection, '*']).flatMap((s) => Object.keys(s.properties ?? {})));
  return Object.entries({ ...PARENT_KEYS, ...type.refKeys }).find(([k, cols]) => props.has(k) && cols.includes(parent))?.[0];
}

/** Ids of every entry of the document's collections (what a new id must not be). */
export function takenIds(data: unknown): Set<string> {
  const out = new Set<string>();
  if (isMap(data)) for (const v of Object.values(data)) if (isMap(v)) for (const k of Object.keys(v)) out.add(k);
  return out;
}

/** Entry ids of a fragment, per collection. */
const fragmentIds = (data: Record<string, unknown>) => Object.entries(data).flatMap(([c, v]) => (isMap(v) ? Object.keys(v).map((id) => ({ c, id })) : []));

/**
 * Renames entries inside a fragment and every reference to them there, as the type declares its
 * references; ids not in `to` stay. Works on plain values: the fragment is not in a document yet.
 */
export function renameIn(type: DiagramType, data: Record<string, unknown>, to: Map<string, string>): Record<string, unknown> {
  const out = structuredClone(data);
  const refs: Reference[] = type.references?.({ type: type.id, ...out } as never) ?? [];
  const holder = (path: Path) => path.slice(0, -1).reduce<unknown>((v, seg) => (v && typeof v === 'object' ? (v as Record<string | number, unknown>)[seg] : undefined), out) as Record<string | number, unknown> | undefined;
  for (const r of [...refs].filter((r) => to.has(r.id)).sort((a, b) => b.start - a.start)) {
    const at = holder(r.path);
    const last = r.path.at(-1)!;
    if (!at) continue;
    if (r.key) {
      const map = at[last];
      const k = isMap(map) ? Object.keys(map)[0] : undefined;
      if (isMap(map) && k != null) at[last] = { [k.slice(0, r.start) + to.get(r.id)! + k.slice(r.start + r.id.length)]: map[k] };
    } else if (typeof at[last] === 'string') {
      const s = at[last] as string;
      at[last] = s.slice(0, r.start) + to.get(r.id)! + s.slice(r.start + r.id.length);
    }
  }
  for (const [c, v] of Object.entries(out)) if (isMap(v)) out[c] = Object.fromEntries(Object.entries(v).map(([k, x]) => [to.get(k) ?? k, x]));
  return out;
}

// ---------------------------------------------------------------- instances

export interface Instance {
  block: string;
  hash: string;
  /** Tells two instances of one block in a diagram apart: #1, #2… */
  no: number;
  params: Record<string, string>;
  /** Its entries and lines, in the order written: [collection, id] or [collection, index]. */
  members: Path[];
}

const MARK = /#\s*from block:\s*([A-Za-z0-9_-]+)@([0-9a-f]+)\s+#(\d+)((?:\s+[A-Za-z_][\w-]*=(?:"(?:[^"\\]|\\.)*"|\S+))*)/;

/** The comment text an inserted entry carries (without the "#"). */
export function markOf(block: string, hash: string, no: number, params: Record<string, string>): string {
  const ps = Object.entries(params).map(([k, v]) => ` ${k}=${/^[^\s"]+$/.test(v) ? v : JSON.stringify(v)}`);
  return ` from block: ${block}@${hash} #${no}${ps.join('')}`;
}

/** The instances of blocks in a diagram, found by the comments on their entries. */
export function findInstances(text: string): Instance[] {
  const doc = parseDocument(text);
  if (doc.errors.length || !isYamlMap(doc.contents)) return [];
  const lineEnd = (at: number) => {
    const i = text.indexOf('\n', at);
    return i < 0 ? text.length : i;
  };
  const found = new Map<string, Instance>();
  const see = (path: Path, from: number, to: number) => {
    // A block map's range takes its line break along: the next line is not its own.
    const m = MARK.exec(text.slice(from, text[to - 1] === '\n' ? to - 1 : lineEnd(to)));
    if (!m) return;
    const key = `${m[1]}#${m[3]}`;
    let inst = found.get(key);
    if (!inst) {
      const params: Record<string, string> = {};
      for (const p of m[4]!.matchAll(/([A-Za-z_][\w-]*)=("(?:[^"\\]|\\.)*"|\S+)/g)) params[p[1]!] = p[2]!.startsWith('"') ? (JSON.parse(p[2]!) as string) : p[2]!;
      found.set(key, (inst = { block: m[1]!, hash: m[2]!, no: Number(m[3]), params, members: [] }));
    }
    inst.members.push(path);
  };
  for (const pair of doc.contents.items) {
    const c = keyOf(pair);
    const v = pair.value;
    if (isYamlMap(v)) for (const p of v.items) see([c, keyOf(p)], (p.key as Node).range?.[0] ?? 0, (p.value as Node | null)?.range?.[1] ?? (p.key as Node).range?.[1] ?? 0);
    else if (isSeq(v)) v.items.forEach((item, i) => see([c, i], (item as Node).range?.[0] ?? 0, (item as Node).range?.[1] ?? 0));
  }
  return [...found.values()];
}

// ---------------------------------------------------------------- writing entries

/** A node for one line of YAML: flow maps, so the comment stays at the end of that line. */
function lineNode(doc: Document, value: unknown, mark: string, item: boolean): Node {
  if (item && isMap(value) && Object.keys(value).length === 1) {
    // "- a -> b: { label: SQL }": the item a map of one key, its value inline, the mark after it.
    const outer = doc.createNode(value) as YAMLMap;
    outer.flow = false;
    const inner = outer.items[0]!;
    const v = (inner.value && typeof inner.value === 'object' ? inner.value : doc.createNode(inner.value ?? null)) as Node & { flow?: boolean };
    if (isYamlMap(v) || isSeq(v)) v.flow = true;
    v.comment = mark;
    inner.value = v;
    return outer;
  }
  const n = doc.createNode(value ?? null, { flow: true }) as Node;
  n.comment = mark;
  return n;
}

export interface Fresh {
  /** The fragment as it goes in: parameters filled in, ids made unique, put into the group asked for. */
  data: Record<string, unknown>;
  /** Id as the block writes it (parameters filled in) → id in the diagram. */
  ids: Map<string, string>;
  /** "", or "-2" when the ids were taken: one suffix for all, so they stay recognisable as one set. */
  suffix: string;
  /** Entries without a parent in the block: the ones that went into `into`. */
  roots: Path[];
}

/** The block's fragment for this diagram (not written yet). */
export function freshFragment(type: DiagramType, block: Block, o: { values?: Record<string, string>; taken: Set<string>; suffix?: string; into?: { collection: string; id: string } }): Fresh {
  const data = instantiate(block, o.values);
  const ids = fragmentIds(data);
  let suffix = o.suffix;
  if (suffix == null) {
    suffix = '';
    if (ids.some((x) => o.taken.has(x.id))) for (let n = 2; ; n++) if (!ids.some((x) => o.taken.has(`${x.id}-${n}`))) { suffix = `-${n}`; break; }
  }
  const to = new Map(ids.map((x) => [x.id, x.id + suffix]));
  const out = suffix ? renameIn(type, data, to) : data;
  const roots: Path[] = [];
  const inside = new Set(to.values());
  for (const [c, v] of Object.entries(out)) {
    if (!isMap(v)) continue;
    const pks = Object.keys({ ...PARENT_KEYS, ...type.refKeys });
    for (const [id, e] of Object.entries(v)) {
      const parent = isMap(e) ? pks.map((k) => e[k]).find((x) => typeof x === 'string' && inside.has(x)) : undefined;
      if (parent) continue;
      roots.push([c, id]);
      const pk = o.into && parentKeyOf(type, c, o.into.collection);
      if (o.into && pk) v[id] = { ...(isMap(e) ? e : e == null ? {} : shorthandOf(type, c, e)), [pk]: o.into.id };
    }
  }
  return { data: out, ids: to, suffix, roots };
}

/** "internet" written as an entry's whole value is its kind; as a map it needs the key. */
function shorthandOf(type: DiagramType, collection: string, v: unknown): Record<string, unknown> {
  return type.shorthand?.(collection, v) ?? { kind: v };
}

export interface Inserted {
  text: string;
  instance: Instance;
  /** Id in the block → id in the diagram. */
  ids: Map<string, string>;
  /** Paths of the new entries and lines. */
  paths: Path[];
  /** Where each node and group goes, relative to the block's top-left (from its pins:), by id in the diagram. */
  pins: { nodes: Record<string, Point>; groups: Record<string, Point> };
}

/** Pins of the block, by the ids they got in the diagram. */
function pinsFor(block: Block, values: Record<string, string>, ids: Map<string, string>): Inserted['pins'] {
  const out: Inserted['pins'] = { nodes: {}, groups: {} };
  const fill = (s: string) => s.replace(/\$\{([A-Za-z_][\w-]*)\}/g, (all, p: string) => values[p] ?? all);
  for (const kind of ['nodes', 'groups'] as const)
    for (const [id, at] of Object.entries(block.pins?.[kind] ?? {})) {
      const real = ids.get(fill(id));
      if (real && at && typeof at.x === 'number' && typeof at.y === 'number') out[kind][real] = { x: at.x, y: at.y };
    }
  return out;
}

/** Writes a fragment's collections into the document; map entries before `before` (by collection) when given, else at the end. */
function write(doc: Document, data: Record<string, unknown>, mark: string, at?: { lists: Map<string, number> }): Path[] {
  const paths: Path[] = [];
  for (const [c, v] of Object.entries(data)) {
    const list = Array.isArray(v);
    if (!doc.has(c) || doc.get(c) == null) doc.set(c, doc.createNode(list ? [] : {}));
    const coll = doc.get(c, true);
    if (list && isSeq(coll)) {
      coll.flow = false;
      const start = at?.lists.get(c) ?? coll.items.length;
      (v as unknown[]).forEach((item, i) => {
        coll.items.splice(start + i, 0, lineNode(doc, item, mark, true));
        paths.push([c, start + i]);
      });
    } else if (!list && isYamlMap(coll) && isMap(v)) {
      coll.flow = false;
      for (const [id, e] of Object.entries(v)) {
        const pair = coll.items.find((p) => keyOf(p) === id);
        if (pair) pair.value = lineNode(doc, e, mark, false);
        else coll.items.push(doc.createPair(id, lineNode(doc, e, mark, false)) as Pair);
        paths.push([c, id]);
      }
    }
  }
  return paths;
}

/**
 * Inserts a block: parameters filled in (defaults for the rest), ids made unique, its top-level
 * entries into `into` when given. One text in, one text out: the editor makes it one undo step.
 */
export function insertBlock(text: string, type: DiagramType, block: Block, o: { values?: Record<string, string>; into?: { collection: string; id: string } } = {}): Inserted | { error: string } {
  if (block.type !== type.id) return { error: `${block.title} is a block for ${block.type} diagrams, this is a ${type.name} diagram` };
  const doc = parseDocument(text);
  if (doc.errors.length) return { error: 'Fix the YAML first: it does not parse' };
  const values = valuesFor(block, o.values);
  const fresh = freshFragment(type, block, { values, taken: takenIds(doc.toJS()), into: o.into });
  const no = Math.max(0, ...findInstances(text).filter((i) => i.block === block.name).map((i) => i.no)) + 1;
  const mark = markOf(block.name, block.hash, no, values);
  const paths = write(doc, fresh.data, mark);
  const next = printPreserving(text, doc);
  return { text: next, instance: { block: block.name, hash: block.hash, no, params: values, members: paths }, ids: fresh.ids, paths, pins: pinsFor(block, values, fresh.ids) };
}

export interface Updated {
  text: string;
  /** Entries the newer block no longer has (they go). */
  removed: string[];
  /** Entries it has that the instance did not. */
  added: string[];
  /** Lines from outside the instance to entries that go: they stay, pointing at nothing, for the author to mend. */
  dangling: number;
}

/**
 * Brings one instance up to a newer version of its block: its entries and lines are replaced by the
 * block's, with the same parameters, the same ids (suffix included) and in the same group; entries
 * the block no longer has go. Lines drawn from outside to the instance stay as they are.
 */
export function updateInstance(text: string, type: DiagramType, block: Block, instance: Instance): Updated | { error: string } {
  const doc = parseDocument(text);
  if (doc.errors.length) return { error: 'Fix the YAML first: it does not parse' };
  const data = doc.toJS() as Record<string, unknown>;
  const memberIds = new Set(instance.members.filter((p) => typeof p[1] === 'string').map((p) => String(p[1])));
  // The suffix it was given, from its ids and the block's.
  const plain = fragmentIds(instantiate(block, instance.params)).map((x) => x.id);
  const suffixes = plain.flatMap((id) => [...memberIds].filter((m) => m === id || (m.startsWith(id) && /^-\d+$/.test(m.slice(id.length)))).map((m) => m.slice(id.length)));
  const suffix = suffixes.sort((a, b) => suffixes.filter((x) => x === b).length - suffixes.filter((x) => x === a).length)[0] ?? '';
  // The group it was put in: a parent named by one of its entries that is not one of them.
  let into: { collection: string; id: string } | undefined;
  for (const p of instance.members) {
    const e = (data[String(p[0])] as Record<string, unknown> | undefined)?.[String(p[1])];
    if (typeof p[1] !== 'string' || !isMap(e)) continue;
    for (const [k, cols] of Object.entries({ ...PARENT_KEYS, ...type.refKeys })) {
      const v = e[k];
      const c = typeof v === 'string' && !memberIds.has(v) ? cols.find((x) => isMap(data[x]) && Object.hasOwn(data[x] as object, v)) : undefined;
      if (c) into = { collection: c, id: v as string };
    }
  }
  const taken = new Set([...takenIds(data)].filter((id) => !memberIds.has(id)));
  const fresh = freshFragment(type, block, { values: instance.params, taken, suffix, into });
  const clash = [...fresh.ids.values()].find((id) => taken.has(id));
  if (clash) return { error: `${clash} is taken by an entry outside this instance: rename that one first` };
  const freshIds = new Set(fresh.ids.values());
  const removed = [...memberIds].filter((id) => !freshIds.has(id));
  const added = [...freshIds].filter((id) => !memberIds.has(id));
  // Out with the members that go; lines go all, and the new ones come where the first of them was.
  const lists = new Map<string, number>();
  for (const p of [...instance.members].filter((p) => typeof p[1] === 'number').sort((a, b) => (b[1] as number) - (a[1] as number))) {
    doc.deleteIn(p);
    lists.set(String(p[0]), p[1] as number);
  }
  for (const p of instance.members) if (typeof p[1] === 'string' && removed.includes(p[1])) doc.deleteIn(p);
  write(doc, fresh.data, markOf(block.name, block.hash, instance.no, instance.params), { lists });
  // Entries that did not change keep their bytes, and so their old mark: it says the new version too.
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const next = printPreserving(text, doc).replace(new RegExp(`(# *from block: *${esc(block.name)}@)${esc(instance.hash)}( +#${instance.no}\\b)`, 'g'), `$1${block.hash}$2`);
  // Counted before: once the entries are gone, a line to them no longer reads as naming anything.
  const mine = new Set(instance.members.map((p) => JSON.stringify(p)));
  const gone = new Set(removed);
  const dangling = (type.references?.(data as never) ?? []).filter((r) => gone.has(r.id) && !mine.has(JSON.stringify(r.path.slice(0, 2)))).length;
  return { text: next, removed, added, dangling };
}

/** Instances whose block has changed since they were inserted. */
export const outdated = (text: string, blocks: Map<string, Block>) => findInstances(text).filter((i) => blocks.has(i.block) && blocks.get(i.block)!.hash !== i.hash);
