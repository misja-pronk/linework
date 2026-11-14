// What changed between two drawings, by id: the same answer for the CLI, a pull request comment and
// (later) the editor's "compare with HEAD". Works on the built graphs, so every diagram type is covered
// and a change in an included model file shows up in the diagrams that draw it.
import type { Graph, GraphEdge, GraphGroup, GraphNode } from '@linework/core';

export type Status = 'added' | 'removed' | 'changed';

/** One thing that is different about an element, e.g. { field: 'label', before: 'Web', after: 'Web shop' }. */
export interface Change {
  field: string;
  before?: unknown;
  after?: unknown;
}

export interface ItemDiff {
  kind: 'node' | 'group' | 'edge';
  /** A node's or group's id; a line's ends, "web -> db" (with "#2" for a second line between the same two). */
  id: string;
  status: Status;
  /** What it is called in the drawing (the newer name when it changed). */
  label?: string;
  /** What is different; only for `changed`. */
  changes?: Change[];
  /** A line's id in the graph before and after (e0, e1, … follow the order in the file, so they differ). */
  edge?: { before?: string; after?: string };
}

export interface GraphDiff {
  /** Title and subtitle. */
  diagram: Change[];
  groups: ItemDiff[];
  nodes: ItemDiff[];
  edges: ItemDiff[];
  counts: Record<Status, number>;
  /** Nothing differs. */
  same: boolean;
}

const EMPTY: Graph = { direction: 'right', groups: [], nodes: [], edges: [] };

/** Either side may be missing: a new file is all added, a deleted one all removed. */
export function diffGraphs(before: Graph | undefined, after: Graph | undefined): GraphDiff {
  const a = before ?? EMPTY;
  const b = after ?? EMPTY;
  const diagram = [...field('title', a.title, b.title), ...field('subtitle', a.subtitle, b.subtitle)];
  const groups = byId('group', a.groups, b.groups, (g) => g.label, groupChanges);
  const nodes = byId('node', a.nodes, b.nodes, nodeLabel, nodeChanges);
  const edges = diffEdges(a, b);
  const counts: Record<Status, number> = { added: 0, removed: 0, changed: 0 };
  for (const i of [...groups, ...nodes, ...edges]) counts[i.status]++;
  return { diagram, groups, nodes, edges, counts, same: !diagram.length && !groups.length && !nodes.length && !edges.length };
}

function byId<T extends { id: string }>(kind: ItemDiff['kind'], before: T[], after: T[], label: (t: T) => string | undefined, changes: (a: T, b: T) => Change[]): ItemDiff[] {
  const was = new Map(before.map((t) => [t.id, t]));
  const now = new Map(after.map((t) => [t.id, t]));
  const out: ItemDiff[] = [];
  const named = (t: T) => (label(t) ? { label: label(t)! } : {});
  for (const t of before) if (!now.has(t.id)) out.push({ kind, id: t.id, status: 'removed', ...named(t) });
  for (const t of after) {
    const old = was.get(t.id);
    if (!old) out.push({ kind, id: t.id, status: 'added', ...named(t) });
    else {
      const c = changes(old, t);
      if (c.length) out.push({ kind, id: t.id, status: 'changed', ...named(t), changes: c });
    }
  }
  return out;
}

function nodeLabel(n: GraphNode): string | undefined {
  const s = n.shape;
  return s.kind === 'card' ? s.label : s.kind === 'table' ? s.title : undefined;
}

function groupChanges(a: GraphGroup, b: GraphGroup): Change[] {
  return [
    ...field('label', a.label, b.label),
    ...field('kind', a.caption, b.caption),
    ...field('group', a.parent, b.parent),
    ...field('border', a.border, b.border),
    ...field('icon', a.icon, b.icon),
    ...field('tone', a.tone, b.tone),
    ...field('description', a.description, b.description),
    ...field('links', targets(a.links), targets(b.links)),
  ];
}

function nodeChanges(a: GraphNode, b: GraphNode): Change[] {
  const out = [...field('group', a.parent, b.parent), ...field('description', a.description, b.description), ...field('links', targets(a.links), targets(b.links)), ...field('tier', a.rank, b.rank)];
  if (!!a.folded !== !!b.folded) out.push({ field: 'shown', before: a.folded ? 'as a badge' : 'as a card', after: b.folded ? 'as a badge' : 'as a card' });
  const [s, t] = [a.shape, b.shape];
  if (s.kind !== t.kind) return [...out, { field: 'shape', before: s.kind, after: t.kind }];
  if (s.kind === 'card' && t.kind === 'card') {
    out.push(...field('label', s.label, t.label), ...field('kind', s.caption, t.caption), ...field('text', s.body, t.body), ...field('icon', s.icon, t.icon), ...field('tone', s.tone, t.tone));
    out.push(...field('form', s.form, t.form), ...field('stack', s.stack, t.stack), ...field('external', s.muted, t.muted), ...field('badges', s.badges?.join(', '), t.badges?.join(', ')));
  } else out.push(...deep(strip(s), strip(t), ''));
  return out;
}

const targets = (links: { target: string }[] | undefined) => (links?.length ? links.map((l) => l.target).join(', ') : undefined);

/** A line is known by its ends; two lines between the same ends are told apart by their order. */
function edgeKeys(g: Graph): Map<string, GraphEdge> {
  const end = (e: GraphEdge['from']) => (e.row ? `${e.node}.${e.row}` : e.node);
  const seen = new Map<string, number>();
  const out = new Map<string, GraphEdge>();
  for (const e of g.edges) {
    const pair = `${end(e.from)} -> ${end(e.to)}`;
    const n = (seen.get(pair) ?? 0) + 1;
    seen.set(pair, n);
    out.set(n > 1 ? `${pair} #${n}` : pair, e);
  }
  return out;
}

function diffEdges(a: Graph, b: Graph): ItemDiff[] {
  const was = edgeKeys(a);
  const now = edgeKeys(b);
  const out: ItemDiff[] = [];
  const named = (e: GraphEdge) => (e.label ? { label: e.label } : {});
  for (const [id, e] of was) if (!now.has(id)) out.push({ kind: 'edge', id, status: 'removed', ...named(e), edge: { before: e.id } });
  for (const [id, e] of now) {
    const old = was.get(id);
    if (!old) out.push({ kind: 'edge', id, status: 'added', ...named(e), edge: { after: e.id } });
    else {
      const c = [
        ...field('label', old.label, e.label),
        ...field('line', old.line, e.line),
        ...field('kind', old.kind, e.kind),
        ...field('tone', old.tone, e.tone),
        ...field('start', old.start, e.start),
        ...field('end', old.end, e.end),
        ...field('shown', old.badge ? 'as a badge' : 'as a line', e.badge ? 'as a badge' : 'as a line'),
        ...field('width', old.width, e.width),
        ...field('icon', old.icon, e.icon),
        ...field('step', old.step, e.step),
      ];
      if (c.length) out.push({ kind: 'edge', id, status: 'changed', ...named(e), changes: c, edge: { before: old.id, after: e.id } });
    }
  }
  return out;
}

function field(name: string, before: unknown, after: unknown): Change[] {
  if (same(before, after)) return [];
  return [{ field: name, ...(empty(before) ? {} : { before }), ...(empty(after) ? {} : { after }) }];
}

const empty = (v: unknown) => v === undefined || v === null || v === false || v === '';
const same = (a: unknown, b: unknown) => (empty(a) && empty(b)) || JSON.stringify(a) === JSON.stringify(b);

/** Source positions are not content: a reordered file is the same drawing. */
function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'path').map(([k, x]) => [k, strip(x)]));
  return v;
}

/**
 * Field by field through shapes that are more than a card (a table's rows, a sequence's messages):
 * "rows.email.cells[1].text". Lists of things with an id are compared by id, other lists by position.
 */
function deep(a: unknown, b: unknown, at: string): Change[] {
  if (same(a, b)) return [];
  const join = (k: string | number) => (typeof k === 'number' ? `${at}[${k}]` : at ? `${at}.${k}` : k);
  if (Array.isArray(a) && Array.isArray(b)) {
    const ids = (list: unknown[]) => list.every((x) => !!x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string');
    if (a.length && b.length && ids(a) && ids(b)) {
      const was = new Map(a.map((x) => [(x as { id: string }).id, x]));
      const now = new Map(b.map((x) => [(x as { id: string }).id, x]));
      const out: Change[] = [];
      for (const id of was.keys()) if (!now.has(id)) out.push({ field: join(id), before: 'present' });
      for (const [id, x] of now) out.push(...(was.has(id) ? deep(was.get(id), x, join(id)) : [{ field: join(id), after: 'present' }]));
      return out;
    }
    const out: Change[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) out.push(...deep(a[i], b[i], join(i)));
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const [x, y] = [a as Record<string, unknown>, b as Record<string, unknown>];
    return [...new Set([...Object.keys(x), ...Object.keys(y)])].flatMap((k) => deep(x[k], y[k], join(k)));
  }
  const show = (v: unknown) => (v !== null && typeof v === 'object' ? 'present' : v);
  return [{ field: at || 'content', ...(empty(a) ? {} : { before: show(a) }), ...(empty(b) ? {} : { after: show(b) }) }];
}
