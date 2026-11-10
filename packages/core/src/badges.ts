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

/** The key's badge samples with the icon their chips carry on the cards (a key on Key Vault's chips, a file on a ConfigMap's). */
export function withBadgeIcons(graph: Graph): Graph {
  if (!graph.legend?.some((l) => l.swatch === 'badge' && !l.icon)) return graph;
  const icons = new Map<string, string>();
  for (const list of chips(graph).values())
    for (const c of list) {
      const kind = graph.edges.find((e) => e.id === c.edge)?.kind;
      if (kind && c.icon && !icons.has(kind)) icons.set(kind, c.icon);
    }
  const legend = graph.legend.map((l) => {
    const icon = l.swatch === 'badge' && !l.icon ? icons.get(l.label.replace(/ badge$/, '')) : undefined;
    return icon ? { ...l, icon } : l;
  });
  return { ...graph, legend };
}

/** The graph layout should see: without badged edges, so they no longer pull nodes around, and without folded nodes. */
export function withoutBadges(graph: Graph): Graph {
  const nodes = byId(graph);
  const folded = new Set(graph.nodes.filter((n) => n.folded).map((n) => n.id));
  const edges = graph.edges.filter((e) => !isChip(e, nodes) && !folded.has(e.from.node) && !folded.has(e.to.node));
  if (edges.length === graph.edges.length && !folded.size) return graph;
  return { ...graph, edges, ...(folded.size ? { nodes: graph.nodes.filter((n) => !n.folded) } : {}) };
}

/** The ends of the badged edges: layout draws no line there, but what a card names in a badge still belongs near it. */
export function badgePairs(graph: Graph): [string, string][] {
  const nodes = byId(graph);
  return graph.edges.filter((e) => isChip(e, nodes) && !nodes.get(e.from.node)?.folded && !nodes.get(e.to.node)?.folded).map((e) => [e.from.node, e.to.node]);
}

const byId = (graph: Graph) => new Map(graph.nodes.map((n) => [n.id, n]));

function isChip(e: GraphEdge, nodes: Map<string, GraphNode>): boolean {
  return !!e.badge && e.from.node !== e.to.node && nodes.get(e.from.node)?.shape.kind === 'card';
}
