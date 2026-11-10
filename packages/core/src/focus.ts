// Focus: one element and what lies within a few lines of it, for any diagram of elements and lines.
// The file keeps the whole landscape; a focus draws a neighbourhood of it, which is how a data mesh
// or a network answers "what feeds this?" and "what breaks when this changes?" without a second file.
//
//   focus: orders                                          # orders and what is one line away
//   focus: { on: orders, hops: 2, direction: upstream }    # what feeds it, two lines back
//   focus: { on: [orders, tag:pii], hops: all }            # everything connected
//
// `on` takes the selectors steps take (steps.ts): an id, a group (everything inside), id.*, tag:x,
// kind:x or a route "a -> b". Upstream and downstream follow the arrows; a line without an arrow
// (a network link, a contract, an ERD relation) counts both ways.
import type { Graph, GraphEdge, GraphNode, LegendItem } from './model.ts';
import { selectorsOf } from './steps.ts';

export type FocusDirection = 'both' | 'upstream' | 'downstream';

export interface FocusSpec {
  on: string[];
  /** How many lines away from what it is about; Infinity for everything connected. */
  hops: number;
  direction: FocusDirection;
}

export interface Focused {
  graph: Graph;
  /** What the focus is about, as drawn: labels of the marked elements and groups. */
  names: string[];
  /** Elements drawn, of how many in the whole diagram. */
  kept: number;
  total: number;
}

const DIRECTIONS: FocusDirection[] = ['both', 'upstream', 'downstream'];

/** A focus as written (a selector, a list of them, or { on, hops, direction }); undefined when it is none of these. */
export function readFocus(raw: unknown): FocusSpec | undefined {
  const list = (v: unknown) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.map(String) : []).map((s) => s.trim()).filter(Boolean);
  if (typeof raw === 'string' || Array.isArray(raw)) return list(raw).length ? { on: list(raw), hops: 1, direction: 'both' } : undefined;
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const on = list(o.on);
  if (!on.length) return undefined;
  const hops = o.hops === 'all' ? Infinity : typeof o.hops === 'number' && o.hops >= 0 ? Math.floor(o.hops) : 1;
  return { on, hops, direction: DIRECTIONS.find((d) => d === o.direction) ?? 'both' };
}

/** "2 hops upstream", as a subtitle or a chip says it. */
export function focusReach(spec: Pick<FocusSpec, 'hops' | 'direction'>): string {
  const far = spec.hops === Infinity ? 'everything connected' : `${spec.hops} ${spec.hops === 1 ? 'hop' : 'hops'}`;
  return spec.direction === 'both' ? far : `${far} ${spec.direction}`;
}

/** Drawings that are one shape: there is nothing in them to walk from. */
const WHOLE: Record<string, string> = { sequence: 'a sequence diagram', gitflow: 'a git graph', roadmap: 'a roadmap', matrix: 'a matrix', journey: 'a journey map' };

/**
 * The graph cut down to what the focus is about and its neighbourhood. Groups around what stays are
 * kept, what it is about is marked. Undefined (with a report) when there is nothing to focus on.
 */
export function focusGraph(graph: Graph, spec: FocusSpec, report: (message: string, severity?: 'error' | 'warning') => void): Focused | undefined {
  // Such a drawing is its first node; a journey has its steps as nodes on top of that one, to click and link.
  const only = graph.nodes.length && !graph.groups.length ? WHOLE[graph.nodes[0]!.shape.kind] : undefined;
  if (only) return report(`Focus works on diagrams of elements and lines; ${only} is one drawing, so it is shown whole`, 'warning'), undefined;

  const s = selectorsOf(graph);
  const parentOf = (id: string) => s.nodes.get(id)?.parent ?? s.groups.get(id)?.parent;
  const seeds = new Set<string>();
  const marked = new Set<string>();
  for (const sel of spec.on) {
    const p = s.pick(sel, true, report);
    const picked = new Set([...p.nodes, ...p.groups]);
    for (const id of picked) {
      seeds.add(id);
      // A group stands for what is inside it: the ring goes around the group, not around each part.
      if (!picked.has(parentOf(id) ?? '')) marked.add(id);
    }
  }
  if (!seeds.size) return undefined;

  // A line on a group speaks for everything in it: it is a line of each part, and reaching the group reaches them all.
  const from = new Map<string, GraphEdge[]>();
  const to = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    from.set(e.from.node, [...(from.get(e.from.node) ?? []), e]);
    to.set(e.to.node, [...(to.get(e.to.node) ?? []), e]);
  }
  // 1: an arrow from → to, -1: the other way, 0: no direction (or both).
  const way = (e: GraphEdge) => (e.end === 'arrow' && e.start !== 'arrow' ? 1 : e.start === 'arrow' && e.end !== 'arrow' ? -1 : 0);
  const along = (e: GraphEdge, forward: boolean) => spec.direction === 'both' || way(e) === 0 || (way(e) === 1) === (forward === (spec.direction === 'downstream'));

  const dist = new Map<string, number>();
  let frontier: string[] = [];
  const visit = (id: string, d: number) => {
    if (dist.has(id)) return;
    dist.set(id, d);
    frontier.push(id);
    if (s.groups.has(id)) for (const inner of [...s.inside(id).groups, ...s.inside(id).nodes]) visit(inner, d);
  };
  for (const id of seeds) visit(id, 0);
  for (let d = 0; d < spec.hops && frontier.length; d++) {
    const now = frontier;
    frontier = [];
    for (const id of now)
      for (const end of [id, ...s.up(parentOf(id))]) {
        for (const e of from.get(end) ?? []) if (along(e, true)) visit(e.to.node, d + 1);
        for (const e of to.get(end) ?? []) if (along(e, false)) visit(e.from.node, d + 1);
      }
  }

  const keep = new Set(dist.keys());
  // In a tree (an org chart) a person is seen with their whole branch and the line up to the top.
  if (graph.tree) {
    const solid = graph.edges.filter((e) => e.line === 'solid');
    const down = (id: string) => {
      for (const e of solid) if (e.from.node === id && !keep.has(e.to.node)) (keep.add(e.to.node), down(e.to.node));
    };
    for (const id of seeds) {
      down(id);
      for (let up = solid.find((e) => e.to.node === id), n = 0; up && n < graph.nodes.length; up = solid.find((e) => e.to.node === up!.from.node), n++) keep.add(up.from.node);
    }
  }
  // A shape that only stands between two others (an interaction between two teams) stays when both of them do.
  for (const n of graph.nodes) if (n.shape.kind === 'block' && n.shape.between && n.shape.between.every((id) => keep.has(id))) keep.add(n.id);
  for (const id of [...keep]) for (const g of s.up(parentOf(id))) keep.add(g);
  const mark = <T extends { id: string }>(x: T): T => (marked.has(x.id) ? { ...x, focused: true } : x);
  const edges = graph.edges.filter((e) => keep.has(e.from.node) && keep.has(e.to.node));
  const steps = graph.steps?.filter((x) => edges.some((e) => e.id === x.edge));
  const name = (id: string) => {
    const n = s.nodes.get(id);
    return n ? (n.shape.kind === 'card' || n.shape.kind === 'block' ? n.shape.label : n.shape.kind === 'table' ? n.shape.title : id) : (s.groups.get(id)?.label ?? id);
  };
  const nodes = graph.nodes.filter((n) => keep.has(n.id));
  // The legend explains what is drawn: a line or a colour that only occurred outside the neighbourhood goes with it.
  const sample = (l: LegendItem) => (e: GraphEdge) => (e.line ?? 'solid') === (l.line ?? 'solid') && e.tone === l.tone;
  const tone = (n: GraphNode) => ('tone' in n.shape ? n.shape.tone : undefined);
  // A block sample stands for a team type, an interaction mode or a vacancy: it goes when none of those is left.
  const like = (l: LegendItem) => (n: GraphNode) => n.shape.kind === 'block' && (l.block!.form === 'person' ? !!n.shape.vacant : n.shape.form === l.block!.form);
  const gone = (l: LegendItem) =>
    l.swatch === 'block' && l.block && !l.block.heat
      ? graph.nodes.some(like(l)) && !nodes.some(like(l))
      : l.swatch === 'fill' ? graph.nodes.some((n) => tone(n) === l.tone) && !nodes.some((n) => tone(n) === l.tone) : !l.swatch && graph.edges.some(sample(l)) && !edges.some(sample(l));
  const legend = graph.legend?.filter((l) => !gone(l));
  return {
    graph: { ...graph, groups: graph.groups.filter((g) => keep.has(g.id)).map(mark), nodes: nodes.map(mark), edges, ...(legend ? { legend } : {}), ...(steps ? { steps } : {}) },
    names: [...marked].map(name),
    kept: graph.nodes.filter((n) => keep.has(n.id)).length,
    total: graph.nodes.length,
  };
}

const on = { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, minItems: 1 }], description: 'What it is about: an id, a group, tag:x, kind:x, or a list of these' };
/** `focus:` of a diagram or a view. */
export const focusSchema = {
  anyOf: [
    { type: 'string', description: 'An element or group: it and what is one line away' },
    { type: 'array', items: { type: 'string' }, minItems: 1 },
    {
      type: 'object',
      required: ['on'],
      properties: {
        on,
        hops: { anyOf: [{ type: 'integer', minimum: 0 }, { const: 'all' }], description: 'How many lines away to show (default 1); all for everything connected' },
        direction: { enum: DIRECTIONS, description: 'both (default), upstream (what feeds it) or downstream (what it feeds), following the arrows' },
      },
      additionalProperties: false,
    },
  ],
  description: 'Draw only this element and what lies within a few lines of it: orders, or { on: orders, hops: 2, direction: upstream }',
};
