// Ports in the order of what feeds them: a table whose rows have no order of their own (a data
// product's input ports, `ports: true`) gets, within each section, the rows fed by one line from the
// left in the order those lines come in, top to bottom. Two sources drawn the other way round from
// their ports would cross just before the table; in this order they never need to. Where the order
// makes no difference (sources level, or already in order) the rows stay as written.
import type { Graph, Placed, Sized, TableRow } from '@cartography/core';

/** The rows of each table that should stand in another order, by node id; undefined when none. */
export function portOrder(sized: Sized, placed: Pick<Placed, 'nodes'>): Map<string, TableRow[]> | undefined {
  const { graph } = sized;
  if (graph.direction === 'down') return undefined;
  const out = new Map<string, TableRow[]>();
  for (const n of graph.nodes) {
    if (n.shape.kind !== 'table' || !n.shape.ports) continue;
    const box = placed.nodes.get(n.id);
    if (!box) continue;
    const rows = n.shape.rows;
    // Where each row's line comes from, when it has one line and that comes in from the left.
    const from = new Map<string, number>();
    for (const r of rows) {
      if (r.kind !== 'row') continue;
      const lines = graph.edges.filter((e) => (e.from.node === n.id && e.from.row === r.id) || (e.to.node === n.id && e.to.row === r.id));
      const [e] = lines;
      if (lines.length !== 1 || !e || e.to.node !== n.id || e.from.node === n.id) continue;
      const y = sourceY(sized, placed, e.from);
      const s = placed.nodes.get(e.from.node);
      if (y != null && s && s.x + s.width <= box.x) from.set(r.id, y);
    }
    if (from.size < 2) continue;
    const sorted = [...rows];
    // Each run of rows between two sections: the rows that move take one another's places.
    let start = 0;
    for (let i = 0; i <= rows.length; i++) {
      if (i < rows.length && rows[i]!.kind === 'row') continue;
      const slots = [];
      for (let j = start; j < i; j++) if (from.has((rows[j] as { id: string }).id)) slots.push(j);
      // A stable sort: rows fed from the same height keep the order they were written in.
      const moved = slots.map((j) => rows[j]!).sort((a, b) => from.get((a as { id: string }).id)! - from.get((b as { id: string }).id)!);
      slots.forEach((j, k) => (sorted[j] = moved[k]!));
      start = i + 1;
    }
    if (sorted.some((r, i) => r !== rows[i])) out.set(n.id, sorted);
  }
  return out.size ? out : undefined;
}

/** The graph with those tables' rows in their new order. */
export function withPortOrder(graph: Graph, order: Map<string, TableRow[]>): Graph {
  return { ...graph, nodes: graph.nodes.map((n) => (n.shape.kind === 'table' && order.has(n.id) ? { ...n, shape: { ...n.shape, rows: order.get(n.id)! } } : n)) };
}

function sourceY(sized: Sized, placed: Pick<Placed, 'nodes'>, at: { node: string; row?: string }): number | undefined {
  const b = placed.nodes.get(at.node);
  if (!b) return undefined;
  const row = at.row ? sized.nodes.get(at.node)?.rowY?.[at.row] : undefined;
  return b.y + (row ?? b.height / 2);
}
