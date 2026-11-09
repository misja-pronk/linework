// Straightens almost-straight lines: when the two ends of a line are a few pixels apart across the
// flow, one end's node slides over so the line runs straight, without bends. dot centres nodes on
// their whole neighbourhood, which leaves small jogs between tables of different heights or cards
// next to taller neighbours. A move is kept only when more lines end up straight than before, the
// node stays below its group's header (the group grows when needed), and it overlaps nothing.
import type { Box, Graph, NodeSize } from '@cartography/core';
import type { Placement } from './dot.ts';
import { growGroups } from './pins.ts';

/** Jogs up to this size are worth removing; bigger offsets are real layout decisions. */
const MAX_JOG = 48;
const GAP = 12;

export function alignPorts(p: Placement, graph: Graph, sizes: Map<string, NodeSize>, header: number, pad: number): Placement {
  const down = graph.direction === 'down';
  const nodes = new Map(p.nodes);
  const parentOf = new Map(graph.nodes.map((n) => [n.id, n.parent]));
  // Only node-to-node lines between different nodes; lines to groups go through the router.
  const edges = graph.edges.filter((e) => e.from.node !== e.to.node && nodes.has(e.from.node) && nodes.has(e.to.node));
  const degree = new Map<string, number>();
  for (const e of edges) for (const n of [e.from.node, e.to.node]) degree.set(n, (degree.get(n) ?? 0) + 1);

  /** Where a line leaves a node across the flow: its row, or the middle. */
  const port = (id: string, row: string | undefined, b: Box) => {
    const y = row ? sizes.get(id)?.rowY?.[row] : undefined;
    return down ? b.x + b.width / 2 : b.y + (y ?? b.height / 2);
  };
  const offset = (e: (typeof edges)[number], at = nodes) => port(e.to.node, e.to.row, at.get(e.to.node)!) - port(e.from.node, e.from.row, at.get(e.from.node)!);
  const straight = (at = nodes) => edges.filter((e) => Math.abs(offset(e, at)) < 0.5).length;

  const fits = (id: string, b: Box) => {
    for (const [other, o] of nodes)
      if (other !== id && b.x < o.x + o.width + GAP && o.x < b.x + b.width + GAP && b.y < o.y + o.height + GAP && o.y < b.y + b.height + GAP) return false;
    const parent = parentOf.get(id);
    const g = parent ? p.groups.get(parent) : undefined;
    if (!g) return true;
    // Never into the header or past the start; the far side may grow the group.
    return down ? b.x >= g.x + pad : b.y >= g.y + header;
  };

  for (let round = 0; round < 3; round++) {
    let changed = false;
    // Lines from nodes with few neighbours first: moving those disturbs least.
    const order = [...edges].sort((a, b) => Math.min(degree.get(a.from.node)!, degree.get(a.to.node)!) - Math.min(degree.get(b.from.node)!, degree.get(b.to.node)!));
    for (const e of order) {
      const d = offset(e);
      if (Math.abs(d) < 0.5 || Math.abs(d) > MAX_JOG) continue;
      const before = straight();
      // Try the end with fewer lines first.
      const ends = degree.get(e.to.node)! <= degree.get(e.from.node)! ? [[e.to.node, -d], [e.from.node, d]] : [[e.from.node, d], [e.to.node, -d]];
      for (const [id, delta] of ends as [string, number][]) {
        const b = nodes.get(id)!;
        const moved = down ? { ...b, x: b.x + delta } : { ...b, y: b.y + delta };
        if (!fits(id, moved)) continue;
        const trial = new Map(nodes).set(id, moved);
        if (straight(trial) > before) {
          nodes.set(id, moved);
          changed = true;
          break;
        }
      }
    }
    if (!changed) break;
  }
  return { ...p, nodes, groups: growGroups(graph, nodes, new Map(p.groups), header, pad) };
}
