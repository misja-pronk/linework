// Layers: one diagram seen as a security view, a data view, an ops view or phase 2, without a copy of
// the file. Elements, groups and lines carry `tags:`; a layer names the tags it is about.
//
//   layers:
//     security: { tags: [security, identity] }               # only what is tagged so (and what it needs)
//     phase-2: { tags: [phase-2], dim-others: true }         # everything, the rest faded
//     data: [data]                                           # the tags alone
//   views:
//     secure: { layers: [security] }
//
// "Only" draws what a layer is about, the groups around it and the ends of its lines, laid out on its
// own; a line without tags between two things that stay stays too. "Dim" keeps the drawing as it is,
// in the same places, and draws the rest quietly (but for lines without tags that touch the layer). Several layers at once show what any of them is
// about; the rest is faded when every one of them says dim-others, else left out.
//
// What wins when several lenses are asked at once: comparing versions, then a focus, then layers. A
// focus is a neighbourhood of the whole drawing, so while one is drawn the layers wait.
import type { Graph, GraphEdge, GraphNode, LegendItem, Path } from './model.ts';
import type { Emphasis, StepState } from './steps.ts';
import { pruneLegend } from './focus.ts';

export type LayerMode = 'only' | 'dim';

export interface LayerSpec {
  name: string;
  title?: string;
  /** Any of these tags puts an element, group or line on the layer. */
  tags: string[];
  /** dim-others: the rest is drawn faded in its place instead of left out. */
  dim: boolean;
  /** One sentence for a presenter or a slide's notes. */
  caption?: string;
  at: Path;
}

/** What a dim layer draws quietly: the ids of everything not on it. */
export interface Faded {
  nodes: string[];
  groups: string[];
  edges: string[];
}

export interface Layered {
  graph: Graph;
  mode: LayerMode;
  /** With mode dim: what is drawn faded. */
  faded?: Faded;
  /** Elements on the layers (with what they need), of how many in the whole drawing. */
  kept: number;
  total: number;
}

type Report = (path: Path, message: string, severity?: 'error' | 'warning') => void;

const list = (v: unknown) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.map(String) : []).map((s) => s.trim()).filter(Boolean);

/** `layers:` as written: name → { tags, dim-others, title, caption }, or name → its tags. */
export function readLayers(raw: unknown, report: Report): LayerSpec[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const out: LayerSpec[] = [];
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    const at: Path = ['layers', name];
    const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : { tags: v };
    const tags = list(o.tags);
    if (!tags.length) {
      report(at, `Layer "${name}" needs tags: the tags of what is on it, e.g. tags: [${name}]`);
      continue;
    }
    out.push({
      name,
      tags,
      dim: o['dim-others'] === true,
      ...(typeof o.title === 'string' ? { title: o.title } : {}),
      ...(typeof o.caption === 'string' ? { caption: o.caption } : {}),
      at,
    });
  }
  return out;
}

/** Every tag written in a diagram's data (nodes, groups, lines, model elements and relations), wherever it is. */
export function writtenTags(data: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 12) return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'layers' && depth === 0) continue;
      if (k === 'tags' && Array.isArray(x)) for (const t of x) out.add(String(t));
      else walk(x, depth + 1);
    }
  };
  walk(data, 0);
  return out;
}

/** The layers' names checked against the ones defined: the known ones, in the order asked. */
export function pickLayers(names: string[], layers: LayerSpec[], report: (message: string, index: number) => void): LayerSpec[] {
  const out: LayerSpec[] = [];
  for (const [i, n] of names.entries()) {
    const l = layers.find((x) => x.name === n);
    if (!l) report(layers.length ? `There is no layer "${n}"; layers: ${layers.map((x) => x.name).join(', ')}` : `There is no layer "${n}": add layers: { ${n}: { tags: [${n}] } }`, i);
    else if (!out.includes(l)) out.push(l);
  }
  return out;
}

/** Only when every layer asks for it is the rest faded; one that shows only its own wins. */
export const modeOf = (layers: LayerSpec[]): LayerMode => (layers.length && layers.every((l) => l.dim) ? 'dim' : 'only');

/** "Security, Data": the layers as a subtitle or a chip names them. */
export const layerNames = (layers: LayerSpec[]) => layers.map((l) => l.title ?? l.name).join(', ');

/**
 * The drawing seen through layers. Only: what carries one of the tags, what is inside a group that
 * does, the ends of its lines and the groups around all that; lines that carry a tag of the layers,
 * and lines without tags between two things that stay. Dim: the same set at full strength, the rest
 * listed to be drawn quietly where it is.
 */
export function layerGraph(graph: Graph, tags: string[], mode: LayerMode): Layered {
  const want = new Set(tags);
  const on = (x: { tags?: string[] }) => !!x.tags?.some((t) => want.has(t));
  const groups = new Map(graph.groups.map((g) => [g.id, g]));
  const up = (id: string | undefined): string[] => {
    const out: string[] = [];
    for (let g = id; g && groups.has(g) && !out.includes(g); g = groups.get(g)!.parent) out.push(g);
    return out;
  };
  // A group on a layer takes what is inside it along.
  const hit = (x: { tags?: string[]; parent?: string }) => on(x) || up(x.parent).some((g) => on(groups.get(g)!));
  const keep = new Set<string>();
  for (const g of graph.groups) if (hit(g)) keep.add(g.id);
  for (const n of graph.nodes) if (hit(n)) keep.add(n.id);
  const lines = new Set<string>();
  for (const e of graph.edges)
    if (on(e)) {
      lines.add(e.id);
      keep.add(e.from.node);
      keep.add(e.to.node);
    }
  // A shape that only stands between two others (an interaction between two teams) stays when both of them do.
  for (const n of graph.nodes) if (n.shape.kind === 'block' && n.shape.between?.every((id) => keep.has(id))) keep.add(n.id);
  const parentOf = (id: string) => graph.nodes.find((n) => n.id === id)?.parent ?? groups.get(id)?.parent;
  for (const id of [...keep]) for (const g of up(parentOf(id))) keep.add(g);
  // Faded in place, a line without tags that touches the layer says what it connects to, so it keeps its strength.
  const touches = (e: GraphEdge) => (mode === 'dim' ? keep.has(e.from.node) || keep.has(e.to.node) : keep.has(e.from.node) && keep.has(e.to.node));
  for (const e of graph.edges) if (!e.tags?.length && touches(e)) lines.add(e.id);

  const total = graph.nodes.length;
  const kept = graph.nodes.filter((n) => keep.has(n.id)).length;
  if (mode === 'dim') {
    const faded: Faded = {
      nodes: graph.nodes.filter((n) => !keep.has(n.id)).map((n) => n.id),
      groups: graph.groups.filter((g) => !keep.has(g.id)).map((g) => g.id),
      edges: graph.edges.filter((e) => !lines.has(e.id)).map((e) => e.id),
    };
    return { graph, mode, faded, kept, total };
  }
  const nodes: GraphNode[] = graph.nodes.filter((n) => keep.has(n.id));
  const edges: GraphEdge[] = graph.edges.filter((e) => lines.has(e.id) && keep.has(e.from.node) && keep.has(e.to.node));
  const steps = graph.steps?.filter((s) => edges.some((e) => e.id === s.edge));
  const walk = graph.walk?.map((b) => ({ ...b, nodes: b.nodes.filter((id) => keep.has(id)), edges: b.edges.filter((id) => lines.has(id)) })).filter((b) => b.nodes.length);
  const legend = pruneLegend(graph, nodes, edges);
  return {
    graph: {
      ...graph,
      groups: graph.groups.filter((g) => keep.has(g.id)),
      nodes,
      edges,
      ...(legend ? { legend } : {}),
      ...(steps ? { steps } : {}),
      ...(walk ? { walk } : {}),
    },
    mode,
    kept,
    total,
  };
}

/** The key's entry for a layer: its name as an outlined tag, the way environment tags are drawn. */
export function layerLegend(layer: LayerSpec, mode: LayerMode): LegendItem {
  const what = layer.tags.length === 1 && layer.tags[0] === layer.name ? `tagged ${layer.name}` : `tagged ${layer.tags.join(' or ')}`;
  return { label: `${layer.title ?? 'Layer'}: what is ${what}${mode === 'dim' ? '; the rest faded' : ''}`, swatch: 'mark', tag: layer.name };
}

/** A step (or no step) with what a dim layer leaves out drawn quietly; what the step hides stays hidden. */
export function fadeState(state: StepState | undefined, faded: Faded): StepState {
  const base: StepState = state ?? { nodes: {}, groups: {}, edges: {}, notes: [] };
  const fade = (own: Record<string, Emphasis>, ids: string[]) => {
    const out = { ...own };
    for (const id of ids) if (out[id] !== 'hidden') out[id] = 'dim';
    return out;
  };
  return { ...base, nodes: fade(base.nodes, faded.nodes), groups: fade(base.groups, faded.groups), edges: fade(base.edges, faded.edges) };
}

/** `layers:` of a diagram. */
export const layersSchema = {
  type: 'object',
  propertyNames: { pattern: '^[A-Za-z0-9_-]+$' },
  additionalProperties: {
    anyOf: [
      { type: 'string', description: 'The tag of what is on this layer' },
      { type: 'array', items: { type: 'string' }, minItems: 1, description: 'The tags of what is on this layer' },
      {
        type: 'object',
        required: ['tags'],
        properties: {
          tags: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, minItems: 1 }], description: 'Elements, groups and lines with any of these tags are on the layer' },
          'dim-others': { type: 'boolean', description: 'Keep everything in its place and fade what is not on the layer (default: draw only the layer, laid out on its own)' },
          title: { type: 'string', description: 'How the layer is named in the key, a subtitle and the layer picker' },
          caption: { type: 'string', description: 'One sentence about the layer, for presenting' },
        },
        additionalProperties: false,
      },
    ],
  },
  description: 'Named layers of this diagram by tag: security: { tags: [security, identity] }, phase-2: { tags: [phase-2], dim-others: true }',
};

/** `layers:` of a view: the layers it is drawn through. */
export const viewLayersSchema = {
  anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  description: 'Draw this view through these layers (named under layers: at the top), e.g. [security]',
};
