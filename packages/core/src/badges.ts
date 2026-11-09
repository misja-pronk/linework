// Badges: edges drawn as a small chip on their source card instead of a line. Cross-cutting links
// (every service → Key Vault, → telemetry) otherwise snake across the whole drawing and shape its layout.
// The chip sits on the source because the link belongs to the one who uses it; on the target it would
// turn into a long "used by" list that says less. Layout never sees badged edges; render draws the chips.
import type { Graph, GraphEdge, GraphNode, Tone } from './model.ts';

export interface Chip {
  edge: string;
  /** The target's name, e.g. "Secrets". */
  label: string;
  icon?: string;
  tone?: Tone;
  /** Tooltip and accessible text, e.g. "Orders → Secrets (Identity)". */
  title: string;
}

/** Chips per source node id, in edge order. Only cards carry chips; other badged edges stay lines. */
export function chips(graph: Graph): Map<string, Chip[]> {
  const nodes = byId(graph);
  const groups = new Map(graph.groups.map((g) => [g.id, g]));
  const name = (id: string): { label: string; icon?: string } => {
    const s = nodes.get(id)?.shape;
    if (s?.kind === 'card') return { label: s.label, icon: s.icon };
    if (s?.kind === 'table') return { label: s.title, icon: s.icon };
    const g = groups.get(id);
    return g ? { label: g.label, icon: g.icon } : { label: id };
  };
  const out = new Map<string, Chip[]>();
  for (const e of graph.edges) {
    if (!isChip(e, nodes)) continue;
    const to = name(e.to.node);
    const why = [e.kind, e.label].filter(Boolean).join(': ');
    const title = `${name(e.from.node).label} → ${to.label}${why ? ` (${why})` : ''}`;
    out.set(e.from.node, [...(out.get(e.from.node) ?? []), { edge: e.id, label: to.label, icon: to.icon, tone: e.tone, title }]);
  }
  return out;
}

/** The graph layout should see: without badged edges, so they no longer pull nodes around. */
export function withoutBadges(graph: Graph): Graph {
  const nodes = byId(graph);
  const edges = graph.edges.filter((e) => !isChip(e, nodes));
  return edges.length === graph.edges.length ? graph : { ...graph, edges };
}

const byId = (graph: Graph) => new Map(graph.nodes.map((n) => [n.id, n]));

function isChip(e: GraphEdge, nodes: Map<string, GraphNode>): boolean {
  return !!e.badge && e.from.node !== e.to.node && nodes.get(e.from.node)?.shape.kind === 'card';
}
