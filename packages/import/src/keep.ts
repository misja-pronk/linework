// An import over the diagram an earlier import made: what the export speaks for follows it, what was
// written by hand stays, and so do comments and the order of things. Shared by the importers that read
// a folder again and again (access, github).
import { Document, isMap, isScalar, isSeq, parseDocument, type Node, type Scalar, type YAMLMap, type YAMLSeq } from 'yaml';

export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
export const str = (v: unknown): string | undefined => (v == null || typeof v === 'object' || String(v).trim() === '' ? undefined : String(v).trim());

export const equal = (a: unknown, b: unknown): boolean => {
  if (isObj(a) && isObj(b)) return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => k in b && equal(a[k], b[k]));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  return a === b;
};

export class Kept {
  /** The diagram as it was before this import, as plain data; empty for a new one. */
  readonly old: Obj;

  private constructor(
    readonly doc: Document,
    /** Nothing to keep: the diagram is new. */
    readonly fresh: boolean,
  ) {
    this.old = fresh ? {} : ((doc.toJS() ?? {}) as Obj);
  }

  /** The diagram an earlier import made, or a new one that starts with these keys. A text instead when the earlier one cannot be merged into. */
  static open(type: string, existing: string | undefined, start: Obj): Kept | string {
    if (!existing?.trim()) return new Kept(new Document({ type, ...start }), true);
    const doc = parseDocument(existing);
    if (doc.errors.length) return `The diagram cannot be read (${doc.errors[0]!.message.split('\n')[0]}): not changed`;
    if (!isMap(doc.contents) || doc.get('type') !== type) return `The diagram is not ${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type} diagram: not changed`;
    return new Kept(doc, false);
  }

  /** A collection as it was: id → entry, short forms (`alice: user`) as { [short]: value }. */
  before(collection: string, short = 'kind'): Record<string, Obj> {
    const c = this.old[collection];
    return isObj(c) ? Object.fromEntries(Object.entries(c).map(([id, v]) => [id, isObj(v) ? v : v == null ? {} : { [short]: v }])) : {};
  }

  private map(collection: string, make: boolean): YAMLMap | undefined {
    const root = this.doc.contents as YAMLMap;
    let m: unknown = root.get(collection, true);
    if (!isMap(m)) {
      if (!make) return undefined;
      m = this.doc.createNode({}) as YAMLMap;
      const pair = this.doc.createPair(collection, m);
      // A new section stands apart, the way the examples are written.
      (pair.key as Scalar).spaceBefore = true;
      root.add(pair);
    }
    return m as YAMLMap;
  }

  private flow(value: unknown): Node {
    const node = this.doc.createNode(value) as Node;
    const all = (n: unknown) => {
      if (isMap(n) || isSeq(n)) {
        n.flow = true;
        for (const item of n.items) all(isMap(n) ? (item as { value: unknown }).value : item);
      }
    };
    all(node);
    return node;
  }

  /**
   * One entry of a collection. New: as given, on one line (over several when it has one of the `block` keys). There already: the keys in `mine` follow
   * the import (set, or taken away when it has none); the others are only filled in where nothing is
   * written, so a label or caption changed by hand stays.
   */
  put(collection: string, id: string, value: Obj, mine: string[], block: string[] = []): void {
    const m = this.map(collection, true)!;
    const was = m.get(id, true);
    const fill = (entry: YAMLMap, key: string, v: unknown) => {
      if (block.includes(key) && Array.isArray(v) && v.length > 1 && v.every(isObj)) {
        // Several maps (the policies of a package): one a line.
        const node = this.doc.createNode([]) as YAMLSeq;
        for (const item of v) node.add(this.flow(item));
        entry.set(key, node);
      } else entry.set(key, isObj(v) || Array.isArray(v) ? this.flow(v) : v);
    };
    if (!isMap(was)) {
      // Nothing there, or a short form (`alice: user`): the whole entry.
      const short = was != null && isScalar(was) && was.value != null ? { kind: was.value } : {};
      const entry = this.doc.createNode({}) as YAMLMap;
      entry.flow = !block.some((k) => value[k] !== undefined);
      for (const [k, v] of Object.entries({ ...short, ...value })) if (v !== undefined) fill(entry, k, v);
      m.set(id, entry);
      return;
    }
    const old = (was.toJS(this.doc) ?? {}) as Obj;
    for (const key of mine) {
      if (value[key] === undefined) {
        if (key in old) was.delete(key);
      } else if (!equal(old[key], value[key])) fill(was, key, value[key]);
    }
    for (const [key, v] of Object.entries(value)) if (!mine.includes(key) && v !== undefined && !(key in old)) fill(was, key, v);
  }

  drop(collection: string, id: string): void {
    this.map(collection, false)?.delete(id);
  }

  /** A list at the top (assignments, edges), one item a line; left alone when it already says the same. */
  list(name: string, items: unknown[]): void {
    const root = this.doc.contents as YAMLMap;
    if (equal(this.old[name] ?? [], items)) return;
    if (!items.length) return void root.delete(name);
    const node = this.doc.createNode(items) as Node;
    if (isSeq(node)) for (const item of node.items) if (isMap(item)) item.flow = true;
    if (root.has(name)) root.set(name, node);
    else {
      const pair = this.doc.createPair(name, node);
      (pair.key as Scalar).spaceBefore = true;
      root.add(pair);
    }
  }

  /** Collections nothing is left in go. */
  tidy(collections: string[]): void {
    const root = this.doc.contents as YAMLMap;
    for (const name of collections) {
      const m = root.get(name, true);
      if (isMap(m) && !m.items.length) root.delete(name);
    }
  }

  text(): string {
    return this.doc.toString({ lineWidth: 0 }).split('\n').map(tight).join('\n');
  }
}

/** Lists the way the examples write them: [a, { from: b }], not [ a, { from: b } ]. Only on a line whose value is such a list or map. */
export function tight(line: string): string {
  const start = /^\s*(?:- )*(?:[\w.-]+: )?(?=[[{])/.exec(line)?.[0].length;
  if (start == null) return line;
  let out = line.slice(0, start);
  let quote = '';
  for (let i = start; i < line.length; i++) {
    const c = line[i]!;
    if (quote) quote = c === quote && !(quote === '"' && line[i - 1] === '\\') ? '' : quote;
    else if (c === '"' || c === "'") quote = c;
    else if (c === '#' && line[i - 1] === ' ') return out + line.slice(i);
    else if (c === ' ' && (line[i - 1] === '[' || line[i + 1] === ']')) continue;
    out += c;
  }
  return out;
}
