// Builder edits as text → text functions on the YAML document, so comments, order and style stay,
// and every change is an ordinary edit in the editor (one undo history, two-way sync for free).
// Everything is driven by the type's JSON Schema and palette: a new type gets a builder without UI code.
import { isMap, isScalar, isSeq, parseDocument, YAMLMap, type Document, type Node, type Pair } from 'yaml';
import type { DiagramType, PaletteItem } from '@cartography/core';
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

function parse(text: string): Document | undefined {
  const doc = parseDocument(text, { keepSourceTokens: false });
  return doc.errors.length ? undefined : doc;
}

const str = (doc: Document) => doc.toString(FORMAT);

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
export function addEntry(text: string, type: DiagramType, item: PaletteItem, parent?: { collection: string; id: string }): Added | undefined {
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
  if (!doc.has(item.collection)) doc.set(item.collection, doc.createNode({}));
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
export function setField(text: string, type: DiagramType, path: Path, key: string, value: unknown): string | undefined {
  const doc = parse(text);
  if (!doc) return undefined;
  const map = entryMap(doc, type, path);
  if (!map) return undefined;
  const empty = value === undefined || value === '' || (Array.isArray(value) && !value.length);
  if (empty) map.delete(key);
  else map.set(key, Array.isArray(value) ? doc.createNode(value, { flow: true }) : value);
  return str(doc);
}

/** Renames an entry and every reference to it: parent keys, edge ends, lists of ids. */
export function renameEntry(text: string, path: Path, to: string): string | undefined {
  const doc = parse(text);
  const from = String(path.at(-1));
  if (!doc || !/^[A-Za-z0-9_-]+$/.test(to) || from === to) return undefined;
  const parentNode = doc.getIn(path.slice(0, -1));
  if (!isMap(parentNode) || parentNode.has(to)) return undefined;
  const pair = parentNode.items.find((p) => String((p.key as { value?: unknown }).value) === from);
  if (!pair) return undefined;
  (pair.key as { value: unknown }).value = to;
  replaceRefs(doc.contents as Node, from, to, pair);
  return str(doc);
}

const ARROW = /^(\s*)([A-Za-z0-9_.-]+)(\s*(?:<->|-->|\.\.>|->|--)\s*)([A-Za-z0-9_.-]+)(\s*)$/;

function swapRef(s: string, from: string, to: string): string {
  if (s === from) return to;
  if (s.startsWith(`${from}.`)) return to + s.slice(from.length);
  const m = ARROW.exec(s);
  if (m) return m[1] + swapRef(m[2]!, from, to) + m[3] + swapRef(m[4]!, from, to) + m[5];
  // "who is role on scope" assignments.
  return s.replace(new RegExp(`(^|\\s)${from.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}(?=\\s|$)`, 'g'), `$1${to}`);
}

function replaceRefs(node: unknown, from: string, to: string, skip: Pair) {
  if (isMap(node)) {
    for (const p of node.items) {
      if (p === skip) continue;
      // Edge keys like "web -> db: label" carry ids in the key.
      if (isScalar(p.key) && typeof p.key.value === 'string' && ARROW.test(p.key.value)) p.key.value = swapRef(p.key.value, from, to);
      if (isScalar(p.value) && typeof p.value.value === 'string') p.value.value = swapRef(p.value.value, from, to);
      else replaceRefs(p.value, from, to, skip);
    }
  } else if (isSeq(node)) {
    for (const item of node.items) {
      if (isScalar(item) && typeof item.value === 'string') item.value = swapRef(item.value, from, to);
      else replaceRefs(item, from, to, skip);
    }
  }
}

const mentions = (s: string, id: string) => s === id || s.startsWith(`${id}.`) || (ARROW.test(s) && swapRef(s, id, '\u0000') !== s);

/** Deletes an entry, and the edges and list items that name it (they would only be errors). */
export function deleteEntry(text: string, path: Path): string | undefined {
  const doc = parse(text);
  if (!doc) return undefined;
  const id = String(path.at(-1));
  const isListItem = typeof path.at(-1) === 'number';
  doc.deleteIn(path);
  if (!isListItem) pruneRefs(doc.contents, id);
  return str(doc);
}

function pruneRefs(node: unknown, id: string) {
  if (isSeq(node)) {
    node.items = node.items.filter((item) => {
      if (isScalar(item) && typeof item.value === 'string') return !mentions(item.value, id);
      if (isMap(item) && item.items.length === 1 && isScalar(item.items[0]!.key)) return !mentions(String(item.items[0]!.key.value), id);
      if (isMap(item)) {
        const from = item.get('from');
        const to = item.get('to');
        if (from === id || to === id || (typeof from === 'string' && from.startsWith(`${id}.`))) return false;
      }
      pruneRefs(item, id);
      return true;
    });
  } else if (isMap(node)) {
    for (const p of [...node.items]) {
      // A parent key that names the deleted entry goes too: the child moves to the top level.
      if (isScalar(p.value) && p.value.value === id && isScalar(p.key) && String(p.key.value) in refKeys) node.delete(p.key);
      else pruneRefs(p.value, id);
    }
  }
}

/** Copies an entry under a new id next to it. */
export function duplicateEntry(text: string, path: Path): Added | undefined {
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
  | { key: string; kind: 'select'; label: string; value: string; options: string[]; hint?: string; allowEmpty: boolean }
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
    if (enumAlt && !alts.some((a) => a.type === 'object'))
      fields.push({ key, kind: 'select', label, value: v == null ? '' : String(v), options: enumAlt.enum.map(String), hint, allowEmpty: true });
    else if (key === 'icon' && alts.some((a) => a.type === 'string'))
      fields.push({ key, kind: 'select', label, value: v == null ? '' : String(v), options: iconNames(), hint, allowEmpty: true });
    else if (refs) {
      const options = refs.flatMap((c) => idsIn(text, c)).filter((id) => id !== path.at(-1));
      fields.push({ key, kind: 'select', label, value: v == null ? '' : String(v), options, hint, allowEmpty: true });
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
export function connectEntries(text: string, type: DiagramType, from: string, to: string): { text: string } | { error: string } {
  const doc = parse(text);
  if (!doc) return { error: 'Fix the problems in the YAML first' };
  if (from === to) return { error: 'Pick another element to connect to' };
  const data = doc.toJS() as Record<string, unknown>;
  const plan = type.connect ? type.connect(data, from, to) : hasEdges(type) ? { path: ['edges'], value: `${from} -> ${to}` } : 'This diagram type has no connections';
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
  const json = JSON.stringify(plan.value);
  if (at.items.some((i) => JSON.stringify((i as Node & { toJSON?(): unknown }).toJSON?.() ?? i) === json)) return { error: 'They are already connected' };
  at.add(doc.createNode(plan.value, { flow: true }));
  return { text: str(doc) };
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
export function setEdgeField(text: string, path: Path, key: string, value: unknown): string | undefined {
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
