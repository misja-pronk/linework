// Node placement with Graphviz dot. It layers the whole graph at once while keeping clusters
// together, so a node outside a group can sit beside it in the same column. (ELK, tried first,
// lays out each group as one block, which reverses lines that go into a group, out and back in.)
import { Graphviz } from '@hpcc-js/wasm-graphviz';
import type { Box, Graph, NodeSize, Sized } from '@cartography/core';

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

/** Positions of nodes and groups; edges are routed separately. */
export async function placeWithDot(sized: Sized, s: Spacing, extraLayerGap = 0): Promise<Placement> {
  const { graph } = sized;
  const lines: string[] = [];
  lines.push('digraph G {');
  lines.push(`graph [rankdir=${graph.direction === 'down' ? 'TB' : 'LR'}, compound=true, newrank=true, nodesep=${inch(s.nodeGap)}, ranksep=${inch(s.layerGap + extraLayerGap)}, splines=false, outputorder=nodesfirst];`);
  lines.push('node [shape=box, fixedsize=true, label=""];');

  const kids = childrenOf(graph);
  const emit = (parent: string | undefined, indent: string) => {
    for (const g of graph.groups.filter((x) => x.parent === parent)) {
      const minW = sized.groupMinWidth.get(g.id) ?? 0;
      lines.push(`${indent}subgraph ${q('cluster_' + g.id)} {`);
      // An empty, fixed-size label reserves the header; margin is the padding around children.
      lines.push(
        `${indent}  graph [margin=${s.groupPad}, labeljust=l, labelloc=t, label=<<TABLE BORDER="0" CELLPADDING="0" CELLSPACING="0"><TR><TD FIXEDSIZE="TRUE" WIDTH="${Math.round(minW)}" HEIGHT="${sized.groupHeader - s.groupPad}"></TD></TR></TABLE>>];`,
      );
      emit(g.id, indent + '  ');
      // An empty group still needs a box (to show it, and to drop things into): a placeholder the size of a card.
      if (!kids.has(g.id) && !graph.groups.some((c) => c.parent === g.id)) lines.push(`${indent}  ${q('__empty__' + g.id)} [width=${inch(200)}, height=${inch(58)}];`);
      lines.push(`${indent}}`);
    }
    for (const n of graph.nodes.filter((x) => x.parent === parent)) {
      const size = sized.nodes.get(n.id)!;
      const shape = size.rowY && Object.keys(size.rowY).length ? `shape=record, label=${q(rowRecord(size))}, ` : '';
      lines.push(`${indent}${q(n.id)} [${shape}width=${inch(size.width)}, height=${inch(size.height)}];`);
    }
  };
  emit(undefined, '  ');

  // Edges to a group attach to one of its nodes and are clipped at the cluster (lhead/ltail).
  const groupIds = new Set(graph.groups.map((g) => g.id));
  for (const e of graph.edges) {
    const a = groupIds.has(e.from.node) ? kids.get(e.from.node) : e.from.node;
    const b = groupIds.has(e.to.node) ? kids.get(e.to.node) : e.to.node;
    // Row ports let dot order tables so that lines to rows cross less.
    const pa = e.from.row && sized.nodes.get(e.from.node)?.rowY?.[e.from.row] != null ? `:${q(portName(e.from.row))}` : '';
    const pb = e.to.row && sized.nodes.get(e.to.node)?.rowY?.[e.to.row] != null ? `:${q(portName(e.to.row))}` : '';
    if (!a || !b || a === b) continue;
    const attrs = [
      groupIds.has(e.from.node) ? `ltail=${q('cluster_' + e.from.node)}` : '',
      groupIds.has(e.to.node) ? `lhead=${q('cluster_' + e.to.node)}` : '',
      // Weak lines (dotted: management, lookups) should not pull the layout around.
      e.line === 'dotted' ? 'weight=0' : e.line === 'dashed' ? 'weight=1' : 'weight=2',
    ].filter(Boolean);
    lines.push(`  ${q(a)}${pa} -> ${q(b)}${pb} [${attrs.join(', ')}];`);
  }
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
