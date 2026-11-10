// What the code importers (compose, OpenAPI, AsyncAPI, workflows) make, written as YAML the way the
// examples are, and written again over an earlier import with keep.ts: an entry tagged `imported`
// follows the source (and goes when the source has it no more), anything else is yours. Lines and
// flow between imported entries follow the source; one that names something of yours stays.
import { Kept, isObj, type Obj } from './keep.ts';
import type { Warnings } from './text.ts';

export interface Drawn {
  type: string;
  /** Top keys written once and then left to you: title, subtitle, direction, badges. */
  head: Obj;
  /** Collections of entries by id, in the order they are written (groups, nodes; lanes; participants). */
  maps: Record<string, Record<string, Obj>>;
  /** Lists of lines (edges, flow, messages). */
  lists: Record<string, unknown[]>;
  /** Per collection, the keys the source speaks for besides kind, in and tags: set again on every import. */
  mine?: Record<string, string[]>;
}

export const IMPORTED = 'imported';
const ARROW = /\s+-(?:[^\s>][^>]*?)?->\s+|\s+(?:<->|-->|->>|-->>|->|--|\.\.>)\s+/;

/** The names a line or a flow chain joins: `a -> b`, `a -yes-> b -> c`, `{ a -> b: label }`. */
export function ends(item: unknown): string[] {
  const text = typeof item === 'string' ? item : isObj(item) ? (Object.keys(item)[0] ?? '') : '';
  const parts = text.split(ARROW).map((s) => s.trim());
  return parts.length > 1 ? parts : [];
}

/**
 * The YAML of a drawing. With `tag` (an import that will be done again), every entry carries the
 * tag `imported`; with `existing`, it is written over that diagram, hand edits kept.
 */
export function writeDrawn(d: Drawn, opts: { existing?: string; tag?: boolean }, warn: Warnings): string {
  const tag = opts.tag || opts.existing !== undefined;
  const kept = Kept.open(d.type, opts.existing, Object.fromEntries(Object.entries(d.head).filter(([, v]) => v !== undefined)));
  if (typeof kept === 'string') {
    warn.add(kept);
    return opts.existing ?? '';
  }
  if (kept.fresh) for (const k of ['badges']) if (Array.isArray(d.head[k])) (kept.doc.get(k, true) as { flow: boolean }).flow = true;
  const made = (e: Obj | undefined) => !!e && Array.isArray(e.tags) && e.tags.includes(IMPORTED);
  // What was imported before: tagged, or (an import without the tag) of the same id and kind.
  const ours = new Set<string>();
  const gone = new Set<string>();
  for (const [name, entries] of Object.entries(d.maps)) {
    const before = kept.before(name, name === 'lanes' ? 'label' : 'kind');
    for (const [id, e] of Object.entries(before)) {
      if (id in entries && (made(e) || e.kind === entries[id]!.kind)) ours.add(id);
      else if (made(e)) (kept.drop(name, id), gone.add(id));
    }
    const mine = ['kind', 'in', 'tags', ...(d.mine?.[name] ?? [])];
    for (const [id, value] of Object.entries(entries)) {
      const old = before[id];
      // An entry of yours under the same id, of another kind: yours stays, the import's is left out.
      if (old && !ours.has(id) && !kept.fresh) {
        warn.onceFor(`taken:${id}`, `"${id}" is in the diagram already as something of yours: kept as it is`);
        continue;
      }
      const tags = tag ? [...new Set([IMPORTED, ...(Array.isArray(old?.tags) ? old.tags.map(String) : []), ...(Array.isArray(value.tags) ? value.tags.map(String) : [])])] : value.tags;
      kept.put(name, id, { ...value, tags }, mine);
      ours.add(id);
    }
  }
  for (const [name, fresh] of Object.entries(d.lists)) {
    const old = Array.isArray(kept.old[name]) ? (kept.old[name] as unknown[]) : [];
    const now = new Set(fresh.map((e) => JSON.stringify(e)));
    const stay = old.filter((e) => {
      const names = ends(e);
      if (names.some((n) => gone.has(n))) return false;
      // A line of the import's own: there when the source still has it.
      return !(names.length && names.every((n) => ours.has(n) || n === 'start' || n === 'end')) || now.has(JSON.stringify(e));
    });
    const had = new Set(stay.map((e) => JSON.stringify(e)));
    kept.list(name, [...stay, ...fresh.filter((e) => !had.has(JSON.stringify(e)))]);
  }
  kept.tidy(Object.keys(d.maps));
  return kept.text().replace(/^(\s*- )\{ ([^{}[\]:]+?: [^{}[\]]*) \}$/gm, '$1$2');
}
