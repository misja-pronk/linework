// Steps: one drawing told in parts, for presenting. The layout is made once for the whole diagram;
// a step only says what is not there yet, what is in focus and what stands back.
//
//   steps:
//     - The landscape as it is today                      # a caption only: everything at full strength
//     - customer -> web -> api: The order comes in        # a route: its lines and ends in focus
//     - title: Payment
//       caption: The API asks the payment provider and waits for the answer.
//       show: [stripe, tag:finance]                       # revealed from here on (with show anywhere, the rest starts absent)
//       focus: [api, stripe]                              # these at full strength, the rest quiet
//       path: api -> stripe                               # these lines emphasised
//       hide: legacy
//       note: { stripe: 'PCI scope ends here' }
import type { Graph, Path } from './model.ts';
import { journeyBeats } from './journey.ts';

/** hidden: not drawn, its space stays empty; dim: drawn quiet; focus: emphasised. Absent: as usual. */
export type Emphasis = 'hidden' | 'dim' | 'focus';

export interface StepNote {
  kind: 'node' | 'group' | 'edge';
  id: string;
  text: string;
}

/** One step, resolved against a drawn graph. */
export interface StepState {
  title?: string;
  /** The sentence the presenter says, shown under the drawing. */
  caption?: string;
  nodes: Record<string, Emphasis>;
  groups: Record<string, Emphasis>;
  edges: Record<string, Emphasis>;
  notes: StepNote[];
  /** Sequence diagrams: the message this step has reached (1-based); later ones are not drawn yet. */
  message?: number;
  /** Journeys: the step (or, comparing, the phase) this one is about (1-based); the rest stands back and the curve stops here. */
  journey?: number;
}

type Report = (path: Path, message: string, severity?: 'error' | 'warning') => void;

const TERM = '(?:[A-Za-z0-9_.*-]+|tag:[\\w-]+|kind:[\\w-]+)';
const ROUTE = new RegExp(`^\\s*${TERM}(?:\\s*->\\s*${TERM})+\\s*$`);
const KEYS = ['title', 'caption', 'show', 'focus', 'highlight', 'path', 'hide', 'note'];

export interface Picked {
  nodes: string[];
  groups: string[];
  edges: string[];
}

/** What selectors pick in a drawn graph: steps and the focus view share them, so there is one way to name things. */
export function selectorsOf(graph: Graph) {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const groups = new Map(graph.groups.map((g) => [g.id, g]));
  /** A group and the groups around it, innermost first. */
  const up = (id: string | undefined): string[] => {
    const out: string[] = [];
    for (let g = id; g && groups.has(g) && !out.includes(g); g = groups.get(g)!.parent) out.push(g);
    return out;
  };
  const inside = (group: string): Picked => {
    const gs = graph.groups.filter((g) => up(g.id).includes(group)).map((g) => g.id);
    return { groups: gs, nodes: graph.nodes.filter((n) => n.parent && gs.includes(n.parent)).map((n) => n.id), edges: [] };
  };
  const kindOf = (x: { kind?: string; path: Path }) => [x.kind, String(x.path[0] ?? '').replace(/s$/, '')];
  const merge = (...ps: Picked[]): Picked => ({ nodes: [...new Set(ps.flatMap((p) => p.nodes))], groups: [...new Set(ps.flatMap((p) => p.groups))], edges: [...new Set(ps.flatMap((p) => p.edges))] });

  /** One term: an id, a group (everything inside), id.*, tag:x, kind:x or *. */
  const term = (t: string): Picked | undefined => {
    if (t === '*') return { nodes: [...nodes.keys()], groups: [...groups.keys()], edges: [] };
    const rule = /^(tag|kind):(.+)$/.exec(t);
    if (rule) {
      const hit = (x: { tags?: string[]; kind?: string; path: Path }) => (rule[1] === 'tag' ? !!x.tags?.includes(rule[2]!) : kindOf(x).includes(rule[2]!));
      const gs = graph.groups.filter(hit).map((g) => g.id);
      const p = merge({ nodes: graph.nodes.filter(hit).map((n) => n.id), groups: gs, edges: [] }, ...gs.map(inside));
      return p.nodes.length || p.groups.length ? p : undefined;
    }
    const id = t.endsWith('.*') ? t.slice(0, -2) : t;
    if (groups.has(id)) return inside(id);
    if (nodes.has(id) && id === t) return { nodes: [id], groups: [], edges: [] };
    return undefined;
  };
  /** Lines from anything in `a` to anything in `b`, in the direction written, else the other way. */
  const between = (a: Picked, b: Picked): string[] => {
    const has = (p: Picked, id: string) => p.nodes.includes(id) || p.groups.includes(id);
    const forward = graph.edges.filter((e) => has(a, e.from.node) && has(b, e.to.node));
    return (forward.length ? forward : graph.edges.filter((e) => has(b, e.from.node) && has(a, e.to.node))).map((e) => e.id);
  };
  const ends = (ids: string[]): Picked => {
    const es = graph.edges.filter((e) => ids.includes(e.id));
    const all = es.flatMap((e) => [e.from.node, e.to.node]);
    return { nodes: all.filter((id) => nodes.has(id)), groups: all.filter((id) => groups.has(id)), edges: ids };
  };
  /** A selector: a term, or a route "a -> b -> c" (its lines, and with `withEnds` what they connect). */
  const pick = (sel: string, withEnds: boolean, report: (message: string, severity?: 'error' | 'warning') => void): Picked => {
    const parts = sel.split('->').map((s) => s.trim());
    const picked = parts.map((p) => {
      const t = p ? term(p) : undefined;
      if (!t) report(p ? `Nothing drawn here is called "${p}"` : `"${sel}" misses an end`);
      return t;
    });
    if (parts.length === 1) return picked[0] ?? { nodes: [], groups: [], edges: [] };
    const out: Picked[] = [];
    for (let i = 0; i + 1 < picked.length; i++) {
      const [a, b] = [picked[i], picked[i + 1]];
      if (!a || !b) continue;
      const lines = between(a, b);
      if (!lines.length) report(`There is no line between "${parts[i]}" and "${parts[i + 1]}"`, 'warning');
      out.push(withEnds ? ends(lines) : { nodes: [], groups: [], edges: lines });
    }
    return merge(...out);
  };
  return { nodes, groups, up, inside, merge, term, pick };
}

/** Resolves written steps against the graph; what a step names and is not drawn is reported at its line. */
export function resolveSteps(raw: unknown, graph: Graph, at: Path, report: Report): StepState[] {
  if (!Array.isArray(raw)) return [];
  const { nodes, groups, up, merge, pick: picked } = selectorsOf(graph);
  const pick = (sel: string, path: Path, withEnds: boolean) => picked(sel, withEnds, (message, severity) => report(path, message, severity));

  interface Sel {
    v: string;
    p: Path;
  }
  const sels = (o: Record<string, unknown>, key: string, p: Path): Sel[] =>
    Array.isArray(o[key]) ? (o[key] as unknown[]).map((v, j) => ({ v: String(v), p: [...p, key, j] })) : o[key] == null ? [] : [{ v: String(o[key]), p: [...p, key] }];
  const items = raw.map((item, i) => {
    const p = [...at, i];
    const none: Sel[] = [];
    if (typeof item === 'string' || typeof item === 'number')
      return ROUTE.test(String(item)) ? { p, focus: none, path: [{ v: String(item), p }], hide: none } : { p, caption: String(item), focus: none, path: none, hide: none };
    const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    // "a -> b: caption" is a map of one route to its caption in YAML.
    const routes = Object.keys(o).filter((k) => !KEYS.includes(k));
    const caption = typeof o.caption === 'string' ? o.caption : routes.map((k) => o[k]).find((v) => typeof v === 'string' && v);
    return {
      p,
      title: typeof o.title === 'string' ? o.title : undefined,
      caption: caption as string | undefined,
      show: 'show' in o ? sels(o, 'show', p) : undefined,
      focus: [...sels(o, 'focus', p), ...sels(o, 'highlight', p)],
      path: [...sels(o, 'path', p), ...routes.map((k) => ({ v: k, p: [...p, k] }))],
      hide: sels(o, 'hide', p),
      note: o.note && typeof o.note === 'object' && !Array.isArray(o.note) ? (o.note as Record<string, unknown>) : undefined,
    };
  });

  // A card that belongs to a table (a data contract on its product's port) is part of it: a step
  // that puts the table in focus lights the card and the line between them too.
  const withAnnexes = (p: Picked): Picked => {
    const annex = graph.edges.filter((e) => e.annex && p.nodes.includes(e.from.node) && nodes.has(e.to.node));
    return annex.length ? merge(p, { nodes: annex.map((e) => e.to.node), groups: [], edges: annex.map((e) => e.id) }) : p;
  };

  // With a show anywhere the drawing builds up: what no step has shown yet is absent.
  const reveal = items.some((s) => s.show);
  const hiddenNodes = new Set(reveal ? nodes.keys() : []);
  const hiddenGroups = new Set(reveal ? groups.keys() : []);
  const hiddenEdges = new Set<string>();
  const showAll = (p: Picked) => {
    for (const id of p.nodes) (hiddenNodes.delete(id), up(nodes.get(id)?.parent).forEach((g) => hiddenGroups.delete(g)));
    for (const id of p.groups) up(id).forEach((g) => hiddenGroups.delete(g));
    for (const id of p.edges) hiddenEdges.delete(id);
  };

  return items.map((s) => {
    const all = (list: Sel[] | undefined, withEnds: boolean) => merge(...(list ?? []).map((x) => pick(x.v, x.p, withEnds)));
    const shown = all(s.show, true);
    const focus = withAnnexes(all(s.focus, true));
    const route = all(s.path, true);
    const gone = all(s.hide, false);
    showAll(shown);
    // What a step puts in focus is there, also when no step has shown it yet.
    showAll(focus);
    showAll(route);
    for (const id of gone.nodes) hiddenNodes.add(id);
    for (const id of gone.groups) hiddenGroups.add(id);
    for (const id of gone.edges) hiddenEdges.add(id);

    const lit = merge(focus, route);
    const focused = lit.nodes.length + lit.groups.length + lit.edges.length > 0;
    const strong = new Set([...focus.edges, ...route.edges]);
    const litNodes = new Set(lit.nodes);
    // A group stays at full strength when it is in focus itself or holds something that is.
    const litGroups = new Set([...lit.groups, ...lit.nodes.flatMap((id) => up(nodes.get(id)?.parent))]);
    const state: StepState = { ...(s.title ? { title: s.title } : {}), ...(s.caption ? { caption: s.caption } : {}), nodes: {}, groups: {}, edges: {}, notes: [] };
    for (const id of nodes.keys()) {
      if (hiddenNodes.has(id)) state.nodes[id] = 'hidden';
      else if (focused) state.nodes[id] = litNodes.has(id) ? 'focus' : 'dim';
    }
    for (const id of groups.keys()) {
      if (hiddenGroups.has(id)) state.groups[id] = 'hidden';
      else if (focused && !litGroups.has(id)) state.groups[id] = 'dim';
    }
    const away = (id: string) => hiddenNodes.has(id) || hiddenGroups.has(id);
    for (const e of graph.edges) {
      if (hiddenEdges.has(e.id) || away(e.from.node) || away(e.to.node)) state.edges[e.id] = 'hidden';
      else if (strong.has(e.id)) state.edges[e.id] = 'focus';
      else if (focused && !((litNodes.has(e.from.node) || lit.groups.includes(e.from.node)) && (litNodes.has(e.to.node) || lit.groups.includes(e.to.node)))) state.edges[e.id] = 'dim';
    }
    for (const [key, text] of Object.entries(s.note ?? {})) {
      const p = pick(key, [...s.p, 'note', key], false);
      const on: StepNote | undefined = p.edges[0] ? { kind: 'edge', id: p.edges[0], text: String(text) } : key.includes('->') ? undefined : groups.has(key) ? { kind: 'group', id: key, text: String(text) } : p.nodes[0] ? { kind: 'node', id: p.nodes[0], text: String(text) } : undefined;
      if (on) state.notes.push(on);
    }
    return state;
  });
}

/**
 * The drawing without a step asked for: where the story ends, at full strength. What a step hid
 * (today's lines a proposal replaces) is not drawn, so the picture is never today and tomorrow at
 * once. `keep` draws it quiet instead, for an editor where it must stay at hand.
 */
export function finalState(steps: StepState[], keep = false): StepState | undefined {
  const last = steps.at(-1);
  if (!last) return undefined;
  // Only what the story took away after showing it: what no step ever showed is still part of the file.
  const gone = (key: 'nodes' | 'groups' | 'edges'): Record<string, Emphasis> =>
    Object.fromEntries(Object.entries(last[key]).flatMap(([id, e]) => (e === 'hidden' && steps.some((s) => s[key][id] !== 'hidden') ? [[id, keep ? 'dim' : 'hidden'] as const] : [])));
  const state: StepState = { nodes: gone('nodes'), groups: gone('groups'), edges: gone('edges'), notes: [] };
  return Object.keys(state.nodes).length + Object.keys(state.groups).length + Object.keys(state.edges).length ? state : undefined;
}

/** Steps a drawing has without any written: the numbered lines of a dynamic view, the messages of a sequence diagram. */
export function impliedSteps(graph: Graph): StepState[] {
  const name = (id: string) => {
    const n = graph.nodes.find((x) => x.id === id);
    return n ? (n.shape.kind === 'card' || n.shape.kind === 'flow' ? n.shape.label || id : n.shape.kind === 'table' ? n.shape.title : id) : (graph.groups.find((g) => g.id === id)?.label ?? id);
  };
  if (graph.steps?.length)
    return graph.steps.map((s) => {
      const lit = new Set([s.from, s.to]);
      const groups = new Map(graph.groups.map((g) => [g.id, g.parent]));
      for (const id of [...lit]) for (let g = graph.nodes.find((n) => n.id === id)?.parent ?? groups.get(id); g && !lit.has(g); g = groups.get(g)) lit.add(g);
      return {
        title: `${name(s.from)} → ${name(s.to)}`,
        ...(s.label ? { caption: s.label } : {}),
        nodes: Object.fromEntries(graph.nodes.map((n) => [n.id, lit.has(n.id) ? 'focus' : 'dim'])),
        groups: Object.fromEntries(graph.groups.filter((g) => !lit.has(g.id)).map((g) => [g.id, 'dim'])),
        edges: Object.fromEntries(graph.edges.map((e) => [e.id, e.id === s.edge ? 'focus' : 'dim'])),
        notes: [],
      } satisfies StepState;
    });
  // A process or a state machine is walked along its main line: the stop in focus, the rest standing back.
  if (graph.walk?.length)
    return graph.walk.map((b) => {
      const lit = new Set(b.nodes);
      const groups = new Map(graph.groups.map((g) => [g.id, g.parent]));
      for (const id of [...lit]) for (let g = graph.nodes.find((n) => n.id === id)?.parent ?? groups.get(id); g && !lit.has(g); g = groups.get(g)) lit.add(g);
      return {
        title: b.title,
        ...(b.caption ? { caption: b.caption } : {}),
        nodes: Object.fromEntries(graph.nodes.map((n) => [n.id, lit.has(n.id) ? 'focus' : 'dim'])),
        groups: Object.fromEntries(graph.groups.filter((g) => !lit.has(g.id)).map((g) => [g.id, 'dim'])),
        edges: Object.fromEntries(graph.edges.map((e) => [e.id, b.edges.includes(e.id) ? 'focus' : 'dim'])),
        notes: [],
      } satisfies StepState;
    });
  // A journey is told step by step: its column in focus, the feeling curve drawn up to there.
  const journey = graph.nodes.find((n) => n.shape.kind === 'journey')?.shape;
  if (journey?.kind === 'journey') return journeyBeats(journey).map((b, i) => ({ ...b, nodes: {}, groups: {}, edges: {}, notes: [], journey: i + 1 }));
  const seq = graph.nodes.length === 1 && graph.nodes[0]!.shape.kind === 'sequence' ? graph.nodes[0]!.shape : undefined;
  if (!seq) return [];
  const who = new Map(seq.participants.map((p) => [p.id, p.label]));
  return seq.events
    .filter((e) => e.kind === 'message')
    .map((m, i) => ({ title: `${who.get(m.from) ?? m.from} → ${who.get(m.to) ?? m.to}`, ...(m.label ? { caption: m.label } : {}), nodes: {}, groups: {}, edges: {}, notes: [], message: i + 1 }));
}

const selectors = { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] };
const stepObject = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short name of the step' },
    caption: { type: 'string', description: 'The sentence you say at this step, shown under the drawing' },
    show: { ...selectors, description: 'Revealed from this step on: ids, groups (everything inside), tag:x, kind:x, "a -> b". With show anywhere, the rest starts absent' },
    focus: { ...selectors, description: 'At full strength in this step; everything else stands back' },
    highlight: { ...selectors, description: 'Same as focus' },
    path: { ...selectors, description: 'A route to emphasise, e.g. "customer -> web -> api"' },
    hide: { ...selectors, description: 'Gone from this step on' },
    note: { type: 'object', additionalProperties: { type: 'string' }, description: 'A callout on an element: { api: "Scales to zero" }' },
  },
  patternProperties: { '->': { type: 'string', description: 'A route with its caption: "a -> b: what happens"' } },
  additionalProperties: false,
};
export const stepItemSchemas = [{ type: 'string', description: 'A caption, or a route like "a -> b -> c"' }, stepObject];
/** `steps:` of a diagram or a view: what to show and stress, one item per step of the story. */
export const stepsSchema = { type: 'array', items: { anyOf: stepItemSchemas }, description: 'Steps for presenting: each one a caption, a route "a -> b: caption", or { title, caption, show, focus, path, hide, note }' };
