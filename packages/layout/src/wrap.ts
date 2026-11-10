// Wrapping: a drawing far wider than its target shape (a long left-to-right chain of clouds and
// systems) is cut between columns and its parts are stacked as rows, read like lines of text; one
// far taller (a deep top-down drawing) is cut between rows and its parts stand side by side. Only
// whole blocks move: a top-level group with everything in it, or a top-level node. When the drawing
// is a single group, the blocks inside it are wrapped instead and the group fits around them.
import type { Box, Graph } from '@cartography/core';
import type { Placement } from './dot.ts';

/** The shortest part is at least this share of the longest. */
const BALANCE = 0.4;

interface Block {
  /** The node or group ids that move together, the block's own first. */
  ids: string[];
  box: Box;
}

const union = (list: Box[]): Box => {
  const x = Math.min(...list.map((b) => b.x));
  const y = Math.min(...list.map((b) => b.y));
  return { x, y, width: Math.max(...list.map((b) => b.x + b.width)) - x, height: Math.max(...list.map((b) => b.y + b.height)) - y };
};

/**
 * The placement in `parts` rows (a left-to-right drawing) or columns (top-down), each part keeping
 * its blocks where they were relative to each other; undefined when there is nothing to cut.
 */
export function wrap(p: Placement, graph: Graph, parts: number, gap: number, header: number, pad: number, minWidth: Map<string, number>): Placement | undefined {
  const down = graph.direction === 'down';
  const parentOf = new Map<string, string | undefined>([...graph.groups.map((g) => [g.id, g.parent] as const), ...graph.nodes.map((n) => [n.id, n.parent] as const)]);
  const inside = (id: string, g: string) => {
    for (let x = parentOf.get(id); x; x = parentOf.get(x)) if (x === g) return true;
    return false;
  };
  // The level to wrap: the top, or inside the one group that holds everything.
  let scope: string | undefined;
  for (;;) {
    const top = [...graph.groups.filter((g) => g.parent === scope && p.groups.has(g.id)), ...graph.nodes.filter((n) => n.parent === scope && p.nodes.has(n.id))];
    if (top.length === 1 && graph.groups.some((g) => g.id === top[0]!.id)) scope = top[0]!.id;
    else break;
  }
  const blocks: Block[] = [];
  for (const g of graph.groups) if (g.parent === scope && p.groups.has(g.id)) blocks.push({ ids: [g.id, ...[...p.nodes.keys(), ...p.groups.keys()].filter((id) => inside(id, g.id))], box: p.groups.get(g.id)! });
  for (const n of graph.nodes) if (n.parent === scope && p.nodes.has(n.id)) blocks.push({ ids: [n.id], box: p.nodes.get(n.id)! });
  if (blocks.length < 2) return undefined;

  // Columns along the flow: blocks that overlap along it stand in one and are never cut apart.
  const [at, size] = down ? (['y', 'height'] as const) : (['x', 'width'] as const);
  const sorted = [...blocks].sort((a, b) => a.box[at] - b.box[at]);
  const columns: Block[][] = [];
  let end = -Infinity;
  for (const b of sorted) {
    if (b.box[at] < end - 1) columns[columns.length - 1]!.push(b);
    else columns.push([b]);
    end = Math.max(end, b.box[at] + b.box[size]);
  }
  if (columns.length < parts) return undefined;
  // Cut where the parts come out most even in length along the flow.
  const spans = columns.map((c) => union(c.map((b) => b.box)));
  const total = spans[spans.length - 1]![at] + spans[spans.length - 1]![size] - spans[0]![at];
  const cuts: number[] = [];
  for (let k = 1; k < parts; k++) {
    const want = spans[0]![at] + (total * k) / parts;
    let best = -1;
    for (let i = Math.max(1, (cuts[cuts.length - 1] ?? 0) + 1); i < columns.length; i++) if (best < 0 || Math.abs(spans[i]![at] - want) < Math.abs(spans[best]![at] - want)) best = i;
    if (best < 0 || cuts.includes(best)) return undefined;
    cuts.push(best);
  }
  const rows = [0, ...cuts, columns.length].slice(1).map((e, i, a) => columns.slice(i ? a[i - 1]! : 0, e).flat());
  if (rows.some((r) => !r.length)) return undefined;
  // A part far shorter than the longest is a block left on a row of its own: that only adds room.
  const lengths = rows.map((r) => union(r.map((b) => b.box))[size]);
  if (Math.min(...lengths) < BALANCE * Math.max(...lengths)) return undefined;

  // Each part starts at the start of the flow; the next one comes below (beside, top-down).
  const nodes = new Map(p.nodes);
  const groups = new Map(p.groups);
  const across = down ? 'x' : 'y';
  const thick = down ? 'width' : 'height';
  const origin = union(blocks.map((b) => b.box));
  let next = origin[across];
  for (const row of rows) {
    const box = union(row.map((b) => b.box));
    const dx = down ? next - box.x : origin.x - box.x;
    const dy = down ? origin.y - box.y : next - box.y;
    for (const b of row)
      for (const id of b.ids) {
        const m = nodes.has(id) ? nodes : groups;
        const o = m.get(id)!;
        m.set(id, { ...o, x: o.x + dx, y: o.y + dy });
      }
    next += box[thick] + gap;
  }
  // The groups around the wrapped level fit around it again, innermost first.
  for (let g = scope; g; g = parentOf.get(g)) {
    const kids = [...graph.groups.filter((c) => c.parent === g && groups.has(c.id)).map((c) => groups.get(c.id)!), ...graph.nodes.filter((n) => n.parent === g && nodes.has(n.id)).map((n) => nodes.get(n.id)!)];
    const u = union(kids);
    const width = Math.max(u.width + 2 * pad, minWidth.get(g) ?? 0);
    groups.set(g, { x: u.x - pad, y: u.y - header, width, height: u.height + header + pad });
  }
  const all = union([...nodes.values(), ...groups.values()]);
  return { nodes, groups, width: all.width, height: all.height };
}
