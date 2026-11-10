// Node placement with Graphviz dot. It layers the whole graph at once while keeping clusters
// together, so a node outside a group can sit beside it in the same column. (ELK, tried first,
// lays out each group as one block, which reverses lines that go into a group, out and back in.)
import { Graphviz } from '@hpcc-js/wasm-graphviz';
import type { Box, Graph, GraphEdge, NodeSize, Sized } from '@cartography/core';

export interface Spacing {
  nodeGap: number;
  layerGap: number;
  groupPad: number;
}

let graphviz: Promise<Graphviz> | undefined;
const load = () => (graphviz ??= Graphviz.load());

const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const inch = (px: number) => (px / 72).toFixed(4);

export interface Placement {
  nodes: Map<string, Box>;
  groups: Map<string, Box>;
  width: number;
  height: number;
}

/** A way of asking dot: each gives a different, deterministic placement of the same graph. */
export interface DotVariant {
  /** Extra graph attributes, e.g. 'ordering=out'. */
  attrs?: string;
  /** Nodes of a group with no lines among them (nor paths through others) share one rank. */
  sameRank?: boolean;
  /** Hand dot the nodes and groups in reverse order: its first ordering follows the input. (Lines
   * keep their order: it decides which line of a cycle dot turns around.) */
  reverse?: boolean;
}

/** Positions of nodes and groups; edges are routed separately. */
export async function placeWithDot(sized: Sized, s: Spacing, extraLayerGap = 0, variant: DotVariant = {}): Promise<Placement> {
  const { graph } = sized;
  const lines: string[] = [];
  lines.push('digraph G {');
  lines.push(`graph [rankdir=${graph.direction === 'down' ? 'TB' : 'LR'}, compound=true, newrank=true, nodesep=${inch(s.nodeGap)}, ranksep=${inch(s.layerGap + extraLayerGap)}, splines=false, outputorder=nodesfirst${variant.attrs ? ', ' + variant.attrs : ''}];`);
  lines.push('node [shape=box, fixedsize=true, label=""];');

  const kids = childrenOf(graph);
  const order = <T>(list: T[]) => (variant.reverse ? [...list].reverse() : list);
  const same = variant.sameRank ? sameRankGroups(graph) : new Map<string, string[]>();
  const emit = (parent: string | undefined, indent: string) => {
    for (const g of order(graph.groups.filter((x) => x.parent === parent))) {
      const minW = sized.groupMinWidth.get(g.id) ?? 0;
      lines.push(`${indent}subgraph ${q('cluster_' + g.id)} {`);
      // An empty, fixed-size label reserves the header; margin is the padding around children.
      lines.push(
        `${indent}  graph [margin=${s.groupPad}, labeljust=l, labelloc=t, label=<<TABLE BORDER="0" CELLPADDING="0" CELLSPACING="0"><TR><TD FIXEDSIZE="TRUE" WIDTH="${Math.round(minW)}" HEIGHT="${sized.groupHeader - s.groupPad}"></TD></TR></TABLE>>];`,
      );
      emit(g.id, indent + '  ');
      // An empty group still needs a box (to show it, and to drop things into): a placeholder the size of a card.
      if (!kids.has(g.id) && !graph.groups.some((c) => c.parent === g.id)) lines.push(`${indent}  ${q('__empty__' + g.id)} [width=${inch(200)}, height=${inch(58)}];`);
      const row = same.get(g.id);
      if (row) lines.push(`${indent}  { rank=same; ${row.map(q).join('; ')}; }`);
      lines.push(`${indent}}`);
    }
    for (const n of order(graph.nodes.filter((x) => x.parent === parent))) {
      const size = sized.nodes.get(n.id)!;
      const shape = size.rowY && Object.keys(size.rowY).length ? `shape=record, label=${q(rowRecord(size))}, ` : '';
      lines.push(`${indent}${q(n.id)} [${shape}width=${inch(size.width)}, height=${inch(size.height)}];`);
    }
  };
  emit(undefined, '  ');
  // Rank hints (network tiers): one layer per rank across groups, and the layers in order, even
  // where no line runs between two of them (an invisible, weightless link keeps the order).
  const ranks = new Map<number, string[]>();
  for (const n of graph.nodes) if (n.rank != null && !n.folded) ranks.set(n.rank, [...(ranks.get(n.rank) ?? []), n.id]);
  const layers = [...ranks.entries()].sort((a, b) => a[0] - b[0]).map(([, ids]) => ids);
  for (const [i, row] of layers.entries()) {
    if (row.length > 1) lines.push(`  { rank=same; ${row.map(q).join('; ')}; }`);
    if (i) lines.push(`  ${q(layers[i - 1]![0]!)} -> ${q(row[0]!)} [style=invis, weight=0];`);
  }

  // Edges to a group attach to one of its nodes and are clipped at the cluster (lhead/ltail).
  const groupIds = new Set(graph.groups.map((g) => g.id));
  const back = feedback(graph);
  // What hangs on weak lines alone (a laptop on its wireless link): there the weak line is the one
  // that says where it belongs, and it pulls like any other.
  const held = new Set(graph.edges.filter((e) => e.line !== 'dotted').flatMap((e) => [e.from.node, e.to.node]));
  const weak = (e: GraphEdge) => e.line === 'dotted' && held.has(e.from.node) && held.has(e.to.node);
  for (const e of graph.edges) {
    const a = groupIds.has(e.from.node) ? kids.get(e.from.node) : e.from.node;
    const b = groupIds.has(e.to.node) ? kids.get(e.to.node) : e.to.node;
    // Row ports let dot order tables so that lines to rows cross less.
    const pa = e.from.row && sized.nodes.get(e.from.node)?.rowY?.[e.from.row] != null ? `:${q(portName(e.from.row))}` : '';
    const pb = e.to.row && sized.nodes.get(e.to.node)?.rowY?.[e.to.row] != null ? `:${q(portName(e.to.row))}` : '';
    if (!a || !b || a === b) continue;
    // A feedback line is handed over turned around, so dot ranks it like the rest of the flow.
    if (back.has(e.id)) {
      lines.push(`  ${q(b)}${pb} -> ${q(a)}${pa} [weight=0];`);
      continue;
    }
    const attrs = [
      groupIds.has(e.from.node) ? `ltail=${q('cluster_' + e.from.node)}` : '',
      groupIds.has(e.to.node) ? `lhead=${q('cluster_' + e.to.node)}` : '',
      // Weak lines (dotted: management, lookups) should not pull the layout around.
      weak(e) ? 'weight=0' : e.line === 'dashed' || e.line === 'dotted' ? 'weight=1' : 'weight=2',
      e.loose ? 'constraint=false' : '',
    ].filter(Boolean);
    lines.push(`  ${q(a)}${pa} -> ${q(b)}${pb} [${attrs.join(', ')}];`);
  }
  // What only a badge names (a key vault no line runs to) would stand anywhere, and stretch its
  // group to get there: an unseen link keeps it by the card that names it. Named by several cards
  // it is shared, and belongs with none of them.
  const lined = new Set(graph.edges.flatMap((e) => [e.from.node, e.to.node]));
  const placedIds = new Set(graph.nodes.map((n) => n.id));
  const near = (sized.near ?? []).filter(([a, b]) => a !== b && placedIds.has(a) && placedIds.has(b) && !lined.has(b));
  for (const [a, b] of near) if (near.filter(([, other]) => other === b).length === 1) lines.push(`  ${q(a)} -> ${q(b)} [style=invis, weight=1];`);
  lines.push('}');

  const gv = await load();
  const out = JSON.parse(gv.layout(lines.join('\n'), 'json', 'dot', { yInvert: true })) as DotJson;
  const nodes = new Map<string, Box>();
  const groups = new Map<string, Box>();
  for (const o of out.objects ?? []) {
    if (o.name.startsWith('cluster_') && o.bb) {
      const [x0, y0, x1, y1] = o.bb.split(',').map(Number) as [number, number, number, number];
      groups.set(o.name.slice(8), { x: x0, y: Math.min(y0, y1), width: x1 - x0, height: Math.abs(y1 - y0) });
    } else if (o.pos) {
      const [cx, cy] = o.pos.split(',').map(Number) as [number, number];
      const size = sized.nodes.get(o.name);
      if (size) nodes.set(o.name, { x: cx - size.width / 2, y: cy - size.height / 2, width: size.width, height: size.height });
    }
  }
  const [x0, y0, x1, y1] = out.bb.split(',').map(Number) as [number, number, number, number];
  return { nodes, groups, width: x1 - x0, height: Math.abs(y1 - y0) };
}

const portName = (row: string) => 'r_' + row.replace(/[^A-Za-z0-9_]/g, '_');

/**
 * A record with one field per row, so rows have ports dot can order. Field heights are spread
 * evenly, which is enough: dot only needs the order; exact attach points come from rowY.
 */
function rowRecord(size: NodeSize): string {
  const rows = Object.entries(size.rowY!).sort((a, b) => a[1] - b[1]);
  return `{<_head>|${rows.map(([id]) => `<${portName(id)}>`).join('|')}}`;
}

interface DotJson {
  bb: string;
  objects?: { name: string; pos?: string; bb?: string }[];
}

/**
 * Groups whose own nodes (two or more, no subgroups) have no line or path between any two of them:
 * a set of peers (sources, consumers) that reads best as one row. dot ranks them by their lines,
 * which can stagger them over several ranks and leave the group a ragged, half-empty box.
 */
function sameRankGroups(graph: Graph): Map<string, string[]> {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const groupIds = new Set(graph.groups.map((g) => g.id));
  const back = feedback(graph);
  const next = new Map<string, string[]>();
  for (const e of graph.edges)
    if (ids.has(e.from.node) && ids.has(e.to.node) && e.from.node !== e.to.node && !back.has(e.id)) next.set(e.from.node, [...(next.get(e.from.node) ?? []), e.to.node]);
  const reach = (from: string) => {
    const seen = new Set<string>();
    const todo = [...(next.get(from) ?? [])];
    while (todo.length) {
      const n = todo.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      todo.push(...(next.get(n) ?? []));
    }
    return seen;
  };
  // Lines to or from a group would tie its nodes to the group's anchor; leave those groups alone.
  const touched = new Set(graph.edges.flatMap((e) => [e.from.node, e.to.node]).filter((n) => groupIds.has(n)));
  const out = new Map<string, string[]>();
  for (const g of graph.groups) {
    if (touched.has(g.id) || graph.groups.some((c) => c.parent === g.id)) continue;
    const members = graph.nodes.filter((n) => n.parent === g.id).map((n) => n.id);
    if (members.length < 2) continue;
    const set = new Set(members);
    if (members.some((m) => [...reach(m)].some((r) => r !== m && set.has(r)))) continue;
    out.set(g.id, members);
  }
  return out;
}

/**
 * Lines that close a cycle (feedback, such as scores flowing back to the CRM), found depth first in
 * the order of the source. dot would pick its own line to turn around, and which one depends on the
 * order it is handed the nodes; deciding here keeps every variant's flow the same.
 */
function feedback(graph: Graph): Set<string> {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const out = new Map<string, { id: string; to: string }[]>();
  for (const e of graph.edges)
    if (ids.has(e.from.node) && ids.has(e.to.node) && e.from.node !== e.to.node) out.set(e.from.node, [...(out.get(e.from.node) ?? []), { id: e.id, to: e.to.node }]);
  const back = new Set<string>();
  const state = new Map<string, 1 | 2>();
  const visit = (n: string) => {
    state.set(n, 1);
    for (const { id, to } of out.get(n) ?? []) {
      if (state.get(to) === 1) back.add(id);
      else if (!state.has(to)) visit(to);
    }
    state.set(n, 2);
  };
  for (const n of graph.nodes) if (!state.has(n.id)) visit(n.id);
  return back;
}

/** For every group, a node inside it (first one found, depth first), to attach group edges to. */
function childrenOf(graph: Graph): Map<string, string> {
  const out = new Map<string, string>();
  const find = (g: string): string | undefined =>
    graph.nodes.find((n) => n.parent === g)?.id ?? graph.groups.filter((c) => c.parent === g).map((c) => find(c.id)).find(Boolean);
  for (const g of graph.groups) {
    const n = find(g.id);
    if (n) out.set(g.id, n);
  }
  return out;
}
