// Annexes: a card that belongs to one row of a table (a data contract on the output port it governs)
// stands beside that table, in the next column (dot.ts keeps that column to it). dot sets it at the
// height of the table, and the lines that leave the table's other rows for the columns after it then
// have to go around it: over the top of the group it is in, or under its bottom. Here the annex moves
// up until it stands wholly above the rows those lines leave from (or, where there is no room above,
// below them), so they run straight on beside it, and what they lead to comes level with those rows.
import type { Box, Sized } from '@cartography/core';
import type { Placement } from './dot.ts';
import { fitGroups } from './tidy.ts';
import { boxOverlaps } from './metrics.ts';

/** Room between an annex and the nearest row whose lines pass it (px): lines keep that far from a card. */
const CLEAR = 40;

export function liftAnnexes(p: Placement, sized: Sized, pad: number, gap: number): Placement {
  const { graph } = sized;
  if (graph.direction !== 'right') return p;
  const annexEdges = graph.edges.filter((e) => e.annex && e.from.row && !e.to.row);
  if (!annexEdges.length) return p;
  let cur = p;
  const overlaps = boxOverlaps(graph, p).length;
  for (const e of annexEdges) {
    const a = cur.nodes.get(e.from.node);
    const b = cur.nodes.get(e.to.node);
    const rows = sized.nodes.get(e.from.node)?.rowY;
    if (!a || !b || !rows) continue;
    // Only an annex alone: every line it has is an annex line from this table (or a loose one).
    if (graph.edges.some((o) => !o.loose && (o.from.node === e.to.node || o.to.node === e.to.node) && !(o.annex && o.from.node === e.from.node))) continue;
    // The rows whose lines run on past the annex, to the right.
    const lines = graph.edges
      .filter((o) => !o.annex && o.from.node === e.from.node && o.from.row && rows[o.from.row] != null)
      .filter((o) => {
        const t = cur.nodes.get(o.to.node) ?? cur.groups.get(o.to.node);
        return !!t && t.x >= b.x + b.width;
      });
    const busy = lines.map((o) => a.y + rows[o.from.row!]!);
    if (!busy.length) continue;
    const [lo, hi] = [Math.min(...busy), Math.max(...busy)];
    // Already clear of them: nothing to do.
    if (b.y + b.height <= lo - CLEAR || b.y >= hi + CLEAR) continue;
    for (const y of [lo - CLEAR - b.height, hi + CLEAR]) {
      const q = place(cur, e.to.node, { ...b, y }, [...new Set(lines.map((o) => o.to.node))], (lo + hi) / 2, a.y + a.height, pad, gap);
      if (!q) continue;
      const fitted = shiftIntoView({ ...q, groups: fitGroups(graph, q.nodes, cur.groups, sized.groupHeader, pad, sized.groupMinWidth) });
      // A group grown over something else: not this way.
      if (boxOverlaps(graph, fitted).length > overlaps) continue;
      cur = fitted;
      break;
    }
  }
  return cur;
}

/**
 * Annex lines whose annex stands clear of its table's other lines (above or below them): those lines
 * run straight on, and the annex's own line is drawn after them, around them.
 */
export function clearAnnexLines(sized: Sized, p: Pick<Placement, 'nodes'>): Set<string> {
  const { graph } = sized;
  const out = new Set<string>();
  for (const e of graph.edges) {
    if (!e.annex || !e.from.row) continue;
    const a = p.nodes.get(e.from.node);
    const b = p.nodes.get(e.to.node);
    const rows = sized.nodes.get(e.from.node)?.rowY;
    if (!a || !b || !rows) continue;
    const busy = graph.edges.filter((o) => !o.annex && o.from.node === e.from.node && o.from.row && rows[o.from.row] != null).map((o) => a.y + rows[o.from.row!]!);
    if (busy.length && (b.y + b.height < Math.min(...busy) || b.y > Math.max(...busy))) out.add(e.id);
  }
  return out;
}

/**
 * The annex at its new place, and what the busy rows lead to stacked level with those rows (in the
 * order dot gave), when they stand in one column with nothing else there; undefined when the annex
 * would stand on something.
 */
function place(p: Placement, id: string, to: Box, targets: string[], mid: number, bottom: number, pad: number, gap: number): Placement | undefined {
  const nodes = new Map(p.nodes);
  if ([...nodes].some(([other, o]) => other !== id && hit(to, o, pad))) return undefined;
  nodes.set(id, to);
  const order = targets.filter((t) => nodes.has(t) && t !== id).sort((u, v) => nodes.get(u)!.y - nodes.get(v)!.y);
  if (!order.length) return { ...p, nodes };
  const boxes = order.map((t) => nodes.get(t)!);
  const left = Math.min(...boxes.map((q) => q.x));
  const right = Math.max(...boxes.map((q) => q.x + q.width));
  const height = boxes.reduce((sum, q) => sum + q.height, 0) + gap * (boxes.length - 1);
  // Centred on the rows, but no lower than the table reaches: below it they only make the drawing taller.
  let top = Math.round(Math.min(mid - height / 2, bottom - height) / 8) * 8;
  const stacked = order.map((t) => {
    const q = nodes.get(t)!;
    const out = { ...q, y: top };
    top += q.height + gap;
    return [t, out] as const;
  });
  const mine = new Set(order);
  const column = { x: left, y: stacked[0]![1].y, width: right - left, height };
  const free = ![...nodes].some(([t, o]) => !mine.has(t) && hit(column, o, pad)) && ![...p.groups].some(([, g]) => hit(column, g, pad) && !order.every((t) => inside(g, nodes.get(t)!)));
  if (free) for (const [t, q] of stacked) nodes.set(t, q);
  return { ...p, nodes };
}

/** The placement moved so nothing stands above 0, and sized to what it holds. */
function shiftIntoView(p: Placement): Placement {
  const all = [...p.nodes.values(), ...p.groups.values()];
  const dy = Math.min(0, ...all.map((b) => b.y));
  const shift = (b: Box): Box => ({ ...b, y: b.y - dy });
  const nodes = new Map([...p.nodes].map(([k, b]) => [k, shift(b)]));
  const groups = new Map([...p.groups].map(([k, b]) => [k, shift(b)]));
  const boxes = [...nodes.values(), ...groups.values()];
  return { nodes, groups, width: Math.max(p.width, ...boxes.map((b) => b.x + b.width)), height: Math.max(...boxes.map((b) => b.y + b.height)) };
}

function inside(g: Box, b: Box) {
  return b.x >= g.x && b.y >= g.y && b.x + b.width <= g.x + g.width && b.y + b.height <= g.y + g.height;
}

function hit(a: Box, b: Box, gap: number) {
  return a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
}
