// Builder edits as text → text functions on the YAML document, so comments, order and style stay,
// and every change is an ordinary edit in the editor (one undo history, two-way sync for free).
// Everything is driven by the type's JSON Schema and palette: a new type gets a builder without UI code.
import { isMap, isScalar, isSeq, parseDocument, YAMLMap, type Document, type Node, type Pair } from 'yaml';
import type { DiagramType, PaletteItem, Reference } from '@cartography/core';
import { printPreserving } from './yaml-print.ts';
import { iconNames } from '@cartography/icons';
import { schemasAt } from './complete.ts';

type Schema = Record<string, any>;
type Path = (string | number)[];

const FORMAT = { lineWidth: 0, flowCollectionPadding: true } as const;

/** Values that name another entry, by key, and the collections they can name. */
export const refKeys: Record<string, string[]> = {
  in: ['groups', 'resources'],
  domain: ['domains'],
  schema: ['schemas'],
  catalog: ['catalogs'],
  contract: ['contracts'],
};

const sources = new WeakMap<Document, string>();

function parse(text: string): Document | undefined {
  const doc = parseDocument(text);
  if (doc.errors.length) return undefined;
  sources.set(doc, text);
  return doc;
}

/** The edited document as text: only what changed is rewritten, the rest keeps its exact bytes. */
const str = (doc: Document) => {
  const src = sources.get(doc);
  return src == null ? doc.toString(FORMAT) : printPreserving(src, doc);
};

/** Ids in a collection, e.g. ids(text, 'nodes'). */
export function idsIn(text: string, collection: string): string[] {
  const doc = parse(text);
  const m = doc?.get(collection);
  return isMap(m) ? m.items.map((p) => String((p.key as { value?: unknown }).value)) : [];
}

function uniqueId(doc: Document, base: string): string {
  const taken = new Set<string>();
  const walk = (n: unknown) => {
    if (isMap(n)) for (const p of n.items) taken.add(String((p.key as { value?: unknown })?.value));
  };
  if (isMap(doc.contents)) for (const p of doc.contents.items) walk(p.value);
  const clean = base.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'item';
  if (!taken.has(clean)) return clean;
  for (let i = 2; ; i++) if (!taken.has(`${clean}-${i}`)) return `${clean}-${i}`;
}

/** Schemas of one entry in a collection, object branches only. */
function entrySchemas(type: DiagramType, collection: string): Schema[] {
  return schemasAt(type.schema as Schema, [collection, '*']).filter((s) => s.type === 'object' || s.properties);
}

/** The property whose enum holds a palette kind: kind for most, class for data products. */
function kindKey(type: DiagramType, collection: string, kind: string): string | undefined {
  for (const s of entrySchemas(type, collection))
    for (const [k, v] of Object.entries((s.properties ?? {}) as Record<string, Schema>))
      if ([v, ...(v.anyOf ?? [])].some((x: Schema) => Array.isArray(x.enum) && x.enum.includes(kind))) return k;
  return undefined;
}

/** The key that puts an entry of `collection` inside an entry of `parentCollection` (in, domain, schema…). */
export function parentKey(type: DiagramType, collection: string, parentCollection: string): string | undefined {
  const props = new Set(entrySchemas(type, collection).flatMap((s) => Object.keys(s.properties ?? {})));
  return Object.entries(refKeys).find(([k, cols]) => props.has(k) && cols.includes(parentCollection))?.[0];
}

export interface Added {
  text: string;
  id: string;
  path: Path;
}

/** Adds a palette item as a new entry, optionally inside a parent entry. */
function addEntryUnsafe(text: string, type: DiagramType, item: PaletteItem, parent?: { collection: string; id: string }): Added | undefined {
  const doc = parse(text);
  if (!doc) return undefined;
  const id = uniqueId(doc, item.kind);
  const value: Record<string, unknown> = {};
  const kk = kindKey(type, item.collection, item.kind);
  if (kk) value[kk] = item.kind;
  value.label = item.label;
  if (parent) {
    const pk = parentKey(type, item.collection, parent.collection);
    if (pk) value[pk] = parent.id;
  }
  if (!doc.has(item.collection) || doc.get(item.collection) == null) doc.set(item.collection, doc.createNode({}));
  const collection = doc.get(item.collection);
  if (!isMap(collection)) return undefined;
  if (collection.flow) collection.flow = false;
  collection.set(id, doc.createNode(value, { flow: true }));
  return { text: str(doc), id, path: [item.collection, id] };
}

/** An entry as a map, turning shorthand ("db: database") into its long form first. */
function entryMap(doc: Document, type: DiagramType, path: Path): YAMLMap | undefined {
  const node = doc.getIn(path, true);
  if (isMap(node)) return node;
  if (node != null && !isScalar(node)) return undefined;
  const scalar = isScalar(node) ? node.value : null;
  const collection = String(path[0]);
  const long: Record<string, unknown> = {};
  if (scalar != null && scalar !== '') {
    const kk = kindKey(type, collection, String(scalar));
    long[kk ?? 'label'] = scalar;
  }
  const map = doc.createNode(long, { flow: true }) as YAMLMap;
  doc.setIn(path, map);
  return map;
}

/** Sets (or with undefined/empty, removes) one field of an entry. */
function setFieldUnsafe(text: string, type: DiagramType, path: Path, key: string, value: unknown): string | undefined {
  const doc = parse(text);
  if (!doc) return undefined;
  const map = entryMap(doc, type, path);
  if (!map) return undefined;
  const empty = value === undefined || value === '' || (Array.isArray(value) && !value.length);
  if (empty) map.delete(key);
  else map.set(key, Array.isArray(value) ? doc.createNode(value, { flow: true }) : value);
  return str(doc);
}

/** The references to one entry, as the type declares them. */
function referencesTo(doc: Document, type: DiagramType, collection: string, id: string): Reference[] {
  if (!type.references) return [];
  return type.references(doc.toJS() as never).filter((r) => r.collection === collection && r.id === id);
}

/** Renames an entry and every reference to it, and nothing else (labels and other collections stay). */
function renameEntryUnsafe(text: string, type: DiagramType, path: Path, to: string): string | undefined {
  const doc = parse(text);
  const from = String(path.at(-1));
  if (!doc || !/^[A-Za-z0-9_-]+$/.test(to) || from === to || path.length !== 2) return undefined;
  const parentNode = doc.getIn(path.slice(0, -1));
  if (!isMap(parentNode) || parentNode.has(to)) return undefined;
  const pair = parentNode.items.find((p) => String((p.key as { value?: unknown }).value) === from);
  if (!pair) return undefined;
  const refs = referencesTo(doc, type, String(path[0]), from);
  (pair.key as { value: unknown }).value = to;
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

/** Deletes an entry and what only made sense with it: edges to it, list items naming it, `in:` keys. */
function deleteEntryUnsafe(text: string, type: DiagramType, path: Path): string | undefined {
  const doc = parse(text);
  if (!doc) return undefined;
  const isListItem = typeof path.at(-1) === 'number';
  const refs = isListItem || path.length !== 2 ? [] : referencesTo(doc, type, String(path[0]), String(path[1]));
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
  for (const r of cuts) {
    const node = doc.getIn(r.path, true);
    if (isScalar(node) && typeof node.value === 'string' && r.cut) node.value = (node.value.slice(0, r.cut[0]) + node.value.slice(r.cut[1])).trim();
  }
  for (const k of keys) doc.deleteIn(k);
  // List items last, highest index first, so earlier indexes stay valid.
  for (const p of [...items.values()].sort((a, b) => (b.at(-1) as number) - (a.at(-1) as number))) doc.deleteIn(p);
  doc.deleteIn(path);
  return str(doc);
}

/** Copies an entry under a new id next to it. */
function duplicateEntryUnsafe(text: string, path: Path): Added | undefined {
  const doc = parse(text);
  if (!doc || typeof path.at(-1) === 'number') return undefined;
  const parentNode = doc.getIn(path.slice(0, -1));
  const value = doc.getIn(path, true) as Node | undefined;
  if (!isMap(parentNode) || value === undefined) return undefined;
  const id = uniqueId(doc, String(path.at(-1)));
  const copy = doc.createNode(doc.getIn(path) ?? null, { flow: isMap(value) ? value.flow : undefined });
  const index = parentNode.items.findIndex((p) => String((p.key as { value?: unknown }).value) === String(path.at(-1)));
  parentNode.items.splice(index + 1, 0, doc.createPair(id, copy) as Pair);
  return { text: str(doc), id, path: [...path.slice(0, -1), id] };
}

// ---------------------------------------------------------------- inspector fields

export type Field =
  | { key: string; kind: 'text'; label: string; value: string; hint?: string }
  | { key: string; kind: 'number'; label: string; value: string; hint?: string }
  | { key: string; kind: 'select'; label: string; value: string; options: string[]; hint?: string; allowEmpty: boolean; labels?: Record<string, string> }
  | { key: string; kind: 'toggle'; label: string; value: boolean; hint?: string }
  | { key: string; kind: 'list'; label: string; value: string[]; options?: string[]; hint?: string }
  | { key: string; kind: 'yaml'; label: string; summary: string; hint?: string };

const titleCase = (k: string) => k.charAt(0).toUpperCase() + k.slice(1).replace(/-/g, ' ');
const ORDER = ['label', 'kind', 'class', 'caption', 'owner', 'in', 'domain', 'schema', 'catalog', 'version'];

/** The form for one entry: its current values, typed from the schema. */
export function fieldsFor(text: string, type: DiagramType, path: Path): Field[] {
  const doc = parse(text);
  if (!doc) return [];
  const node = doc.getIn(path, true) as Node | undefined;
  const raw: unknown = node && typeof (node as { toJSON?: unknown }).toJSON === 'function' ? (node as { toJSON(): unknown }).toJSON() : node;
  const collection = String(path[0]);
  const schemas = typeof path.at(-1) === 'number' ? [] : schemasAt(type.schema as Schema, [collection, '*']).filter((s) => s.properties);
  // Shorthand values read as their long form.
  let values: Record<string, unknown> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) values = raw as Record<string, unknown>;
  else if (raw != null && raw !== '') values = { [kindKey(type, collection, String(raw)) ?? 'label']: raw };

  const props = new Map<string, Schema>();
  for (const s of schemas) for (const [k, v] of Object.entries((s.properties ?? {}) as Record<string, Schema>)) if (!props.has(k)) props.set(k, v);
  const keys = [...props.keys()].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));

  const fields: Field[] = [];
  for (const key of keys) {
    const s = props.get(key)!;
    const alts: Schema[] = s.anyOf ?? [s];
    const v = values[key];
    const hint = s.description ?? alts.find((a) => a.description)?.description;
    const label = titleCase(key);
    const enumAlt = alts.find((a) => Array.isArray(a.enum));
    const refs = refKeys[key];
    if (enumAlt && !alts.some((a) => a.type === 'object')) {
      // Kinds read as their names ("Key Vault"), from the palette of this collection.
      const names = Object.fromEntries(type.palette.filter((p) => p.collection === collection).map((p) => [p.kind, p.label]));
      fields.push({ key, kind: 'select', label, value: v == null ? '' : String(v), options: enumAlt.enum.map(String), hint, allowEmpty: true, labels: names });
    } else if (key === 'icon' && alts.some((a) => a.type === 'string'))
      fields.push({ key, kind: 'select', label, value: v == null ? '' : String(v), options: iconNames(), hint, allowEmpty: true });
    else if (refs) {
      const options = refs.flatMap((c) => idsIn(text, c)).filter((id) => id !== path.at(-1));
      // Entries read as their labels ("rg-shop-prod"), the id stays what is written.
      const data = (doc.toJS() ?? {}) as Record<string, Record<string, unknown>>;
      const labels: Record<string, string> = {};
      for (const c of refs)
        for (const [id, e] of Object.entries(data[c] ?? {})) if (e && typeof e === 'object' && typeof (e as { label?: unknown }).label === 'string') labels[id] = (e as { label: string }).label;
      fields.push({ key, kind: 'select', label, value: v == null ? '' : String(v), options, hint, allowEmpty: true, labels });
    } else if (alts.some((a) => a.type === 'boolean')) fields.push({ key, kind: 'toggle', label, value: v === true, hint });
    else if (alts.some((a) => a.type === 'array') && (v == null || (Array.isArray(v) && v.every((x) => typeof x === 'string'))))
      fields.push({ key, kind: 'list', label, value: (v as string[] | undefined) ?? [], hint });
    else if (alts.some((a) => a.type === 'object' || a.type === 'array'))
      fields.push({ key, kind: 'yaml', label, summary: summary(v), hint });
    else if (alts.some((a) => a.type === 'integer' || a.type === 'number') && !alts.some((a) => a.type === 'string' || (Array.isArray(a.type) && a.type.includes('string'))))
      fields.push({ key, kind: 'number', label, value: v == null ? '' : String(v), hint });
    else fields.push({ key, kind: 'text', label, value: v == null ? '' : String(v), hint });
  }
  return fields;
}

function summary(v: unknown): string {
  if (v == null) return 'Not set';
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
  if (typeof v === 'object') {
    const keys = Object.keys(v as object);
    return keys.length ? keys.slice(0, 4).join(', ') + (keys.length > 4 ? ` +${keys.length - 4}` : '') : 'Empty';
  }
  return String(v);
}

// ---------------------------------------------------------------- connections

/** Connects two drawn elements the way their type says, or explains why not. */
function connectEntriesUnsafe(text: string, type: DiagramType, from: string, to: string): { text: string } | { error: string } {
  const doc = parse(text);
  if (!doc) return { error: 'Fix the problems in the YAML first' };
  const data = doc.toJS() as Record<string, unknown>;
  // Types decide about self links (an ERD table can point at itself); plain edges cannot.
  const plan = type.connect
    ? type.connect(data, from, to)
    : from === to
      ? 'Pick another element to connect to'
      : hasEdges(type)
        ? { path: ['edges'], value: `${from} -> ${to}` }
        : 'This diagram type has no connections';
  if (typeof plan === 'string') return { error: plan };

  // The entry that holds the list may still be shorthand ("alice: user").
  if (plan.path.length > 2) entryMap(doc, type, plan.path.slice(0, 2));
  const at = doc.getIn(plan.path, true);
  if (plan.key != null) {
    if (at == null) doc.setIn(plan.path, doc.createNode({}));
    const map = doc.getIn(plan.path, true);
    if (!isMap(map)) return { error: 'Cannot add it there: that part of the YAML is not a map' };
    if (map.has(plan.key)) return { error: `"${plan.key}" is already there` };
    map.set(plan.key, plan.value);
    return { text: str(doc) };
  }
  if (at == null) {
    doc.setIn(plan.path, doc.createNode([plan.value], { flow: plan.path.length > 1 }));
    return { text: str(doc) };
  }
  if (isScalar(at)) {
    // "member-of: sg-dev" becomes a list.
    if (at.value === plan.value) return { error: 'They are already connected' };
    doc.setIn(plan.path, doc.createNode([at.value, plan.value], { flow: true }));
    return { text: str(doc) };
  }
  if (!isSeq(at)) return { error: 'Cannot add it there: that part of the YAML is not a list' };
  const want = connectionKey(plan.value);
  if (at.items.some((i) => connectionKey((i as Node & { toJSON?(): unknown }).toJSON?.() ?? i) === want)) return { error: 'They are already connected' };
  at.add(doc.createNode(plan.value, { flow: true }));
  return { text: str(doc) };
}

/** What a list item connects, ignoring labels and ports: "a -> b: SQL" and "a -> b" are the same link. */
function connectionKey(v: unknown): string {
  const ends = (s: string) => {
    const m = /^\s*([\w.-]+)\s*(?:<->|-->|\.\.>|->|--)\s*([\w.-]+)\s*$/.exec(s);
    return m ? `${m[1]!.split('.')[0]}->${m[2]!.split('.')[0]}` : s.split('.')[0]!;
  };
  if (typeof v === 'string') return ends(v);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.from === 'string' && typeof o.to === 'string') return ends(`${o.from} -> ${o.to}`);
    if (typeof o.from === 'string') return o.from.split('.')[0]!;
    const keys = Object.keys(o);
    if (keys.length === 1) return ends(keys[0]!);
  }
  return JSON.stringify(v);
}

const hasEdges = (type: DiagramType) => !!(type.schema as Schema).properties?.edges;

// ---------------------------------------------------------------- edges

/** Long-form properties an edge in `edges:` can have (label, style, line, …). */
export function edgeFields(text: string, type: DiagramType, path: Path): Field[] {
  const doc = parse(text);
  if (!doc || path[0] !== 'edges' || typeof path[1] !== 'number') return [];
  const long = schemasAt(type.schema as Schema, ['edges', '-']).find((s) => s.properties?.from)?.properties as Record<string, Schema> | undefined;
  if (!long) return [];
  const values = edgeValues(doc.getIn(path));
  const fields: Field[] = [];
  for (const [key, s] of Object.entries(long)) {
    if (key === 'from' || key === 'to') continue;
    const v = values[key];
    const label = titleCase(key);
    if (Array.isArray(s.enum)) fields.push({ key, kind: 'select', label, value: v == null ? '' : String(v), options: s.enum.map(String), hint: s.description, allowEmpty: true });
    else if (s.type === 'boolean') fields.push({ key, kind: 'toggle', label, value: v === true, hint: s.description });
    else fields.push({ key, kind: 'text', label, value: v == null ? '' : String(v), hint: s.description });
  }
  return fields;
}

/** Any edge form ("a -> b", "a -> b: x", { "a -> b": {…} }, { from, to }) as its properties. */
function edgeValues(item: unknown): Record<string, unknown> {
  const plain = item && typeof (item as { toJSON?: unknown }).toJSON === 'function' ? (item as { toJSON(): unknown }).toJSON() : item;
  if (typeof plain === 'string') return {};
  if (plain && typeof plain === 'object') {
    const o = plain as Record<string, unknown>;
    if ('from' in o) return o;
    const [, v] = Object.entries(o)[0] ?? [];
    if (v && typeof v === 'object') return v as Record<string, unknown>;
    if (v != null) return { label: v };
  }
  return {};
}

/** Sets one property of an edge, rewriting shorthand into "a -> b: { … }" only when needed. */
function setEdgeFieldUnsafe(text: string, path: Path, key: string, value: unknown): string | undefined {
  const doc = parse(text);
  if (!doc) return undefined;
  const item = doc.getIn(path, true);
  const plain = item && typeof (item as { toJSON?: unknown }).toJSON === 'function' ? (item as { toJSON(): unknown }).toJSON() : item;
  const empty = value === undefined || value === '' || value === false;
  let arrow: string | undefined;
  let props: Record<string, unknown>;
  if (typeof plain === 'string') {
    arrow = plain;
    props = {};
  } else if (plain && typeof plain === 'object' && 'from' in (plain as object)) {
    const map = item as YAMLMap;
    if (empty) map.delete(key);
    else map.set(key, value);
    return str(doc);
  } else if (plain && typeof plain === 'object') {
    arrow = Object.keys(plain as object)[0];
    props = edgeValues(plain);
  } else return undefined;
  if (empty) delete props[key];
  else props[key] = value;
  const keys = Object.keys(props);
  // Back to the shortest form that says the same thing.
  const next = !keys.length ? arrow : keys.length === 1 && keys[0] === 'label' ? { [arrow!]: props.label } : { [arrow!]: props };
  const node = doc.createNode(next, { flow: true });
  if (isMap(node)) for (const p of node.items) if (isMap(p.value)) p.value.flow = true;
  if (isMap(node)) node.flow = false;
  doc.setIn(path, node);
  return str(doc);
}

export const addEntry = safe(addEntryUnsafe);
export const setField = safe(setFieldUnsafe);
export const renameEntry = safe(renameEntryUnsafe);
export const deleteEntry = safe(deleteEntryUnsafe);
export const duplicateEntry = safe(duplicateEntryUnsafe);
export const setEdgeField = safe(setEdgeFieldUnsafe);
export function connectEntries(...args: Parameters<typeof connectEntriesUnsafe>): ReturnType<typeof connectEntriesUnsafe> {
  try {
    return connectEntriesUnsafe(...args);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** A builder edit that fails (aliases, odd YAML) gives no text instead of an exception in a click handler. */
function safe<A extends unknown[], R>(f: (...a: A) => R): (...a: A) => R | undefined {
  return (...a) => {
    try {
      return f(...a);
    } catch (e) {
      console.warn('builder edit failed', e);
      return undefined;
    }
  };
}

/** Whether the value at a path is a single scalar (a one-item reference like "member-of: devs"). */
export function isScalarAt(text: string, path: Path): boolean {
  const doc = parse(text);
  return !!doc && isScalar(doc.getIn(path, true));
}
