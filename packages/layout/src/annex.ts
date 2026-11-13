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
    // Only an annex alone: every line it has is an annex line from this table (or a loose one, or one inside it).
    if (graph.edges.some((o) => !o.loose && o.from.node !== o.to.node && (o.from.node === e.to.node || o.to.node === e.to.node) && !(o.annex && o.from.node === e.from.node))) continue;
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

/** Room between a table and the annex stacked under it (px): close enough to read as one. */
const STACK = 32;

/**
 * Each annex under its table, in the table's column (dot was asked to rank them together), joined to
 * it by its short line: the table's other lines then leave its rows and run straight on to the right,
 * past nothing, and what they lead to stands level with those rows. Annexes of one table stack in the
 * order of their lines. Undefined where something stands in the way: then this is no way to draw it
 * (above the table the annex's line would have to run all the way round it).
 */
export function stackAnnexes(p: Placement, sized: Sized, pad: number, gap: number): Placement | undefined {
  const { graph } = sized;
  if (graph.direction !== 'right') return undefined;
  let cur = p;
  const tables = [...new Set(graph.edges.filter((e) => e.annex && e.from.row && !e.to.row).map((e) => e.from.node))];
  for (const t of tables) {
    const a = cur.nodes.get(t);
    if (!a) continue;
    const annexes = [...new Set(graph.edges.filter((e) => e.annex && e.from.node === t && !e.to.row).map((e) => e.to.node))];
    // Only an annex alone: every line it has is an annex line from this table (or a loose one, or one inside it).
    const alone = annexes.filter((id) => cur.nodes.has(id) && !graph.edges.some((o) => !o.loose && o.from.node !== o.to.node && (o.from.node === id || o.to.node === id) && !(o.annex && o.from.node === t)));
    if (!alone.length) continue;
    const mine = new Set([t, ...alone]);
    const nodes = new Map(cur.nodes);
    // dot ranked the table with its annexes, so it stands in the middle of a column as wide as the
    // widest of them, with that column's slack on both sides. Under the table's left edge the annexes
    // would leave the slack empty: the table and its annexes move left into the slack before it, and
    // what follows moves up to them, so every gap is again the one dot gave.
    const widest = Math.max(...alone.map((id) => nodes.get(id)!.width));
    const slack = Math.max(0, (widest - a.width) / 2);
    const [lo, hi] = [a.x + a.width / 2 - widest / 2, a.x + a.width / 2 + widest / 2];
    const before = [...nodes].filter(([id, o]) => !mine.has(id) && o.x + o.width <= a.x);
    const after = [...nodes].filter(([id, o]) => !mine.has(id) && o.x >= a.x + a.width);
    const gapBefore = Math.min(...before.map(([, o]) => lo - o.x - o.width));
    const left = Math.max(0, Math.min(slack, before.length ? a.x - Math.max(...before.map(([, o]) => o.x + o.width)) - gapBefore : slack));
    const table = { ...a, x: a.x - left };
    nodes.set(t, table);
    let y = a.y + a.height + STACK;
    let bottom = y;
    for (const id of alone) {
      const b = nodes.get(id)!;
      nodes.set(id, { ...b, x: table.x, y });
      bottom = y + b.height;
      y += b.height + STACK;
    }
    if (after.length) {
      // Beside the annexes nothing can come closer than dot had it to the column's edge; beside the table only, it can.
      const gapAfter = Math.min(...after.map(([, o]) => o.x - hi));
      const edge = (o: Box) => (o.y < bottom && o.y + o.height > a.y + a.height ? table.x + widest : table.x + table.width);
      const shift = Math.max(0, Math.min(2 * slack, ...after.map(([, o]) => o.x - edge(o) - gapAfter)));
      if (shift > 0) for (const [id, o] of after) nodes.set(id, { ...o, x: o.x - shift });
    }
    if (alone.some((id) => [...nodes].some(([other, o]) => !mine.has(other) && hit(nodes.get(id)!, o, Math.min(pad, gap))))) return undefined;
    // What the table's other rows lead to, on the right, stacked level with those rows: the lines run straight.
    const rows = sized.nodes.get(t)?.rowY ?? {};
    const lines = graph.edges.filter((o) => !o.annex && o.from.node === t && o.from.row && rows[o.from.row] != null && (cur.nodes.get(o.to.node)?.x ?? -Infinity) >= a.x + a.width);
    const busy = lines.map((o) => a.y + rows[o.from.row!]!);
    const first = alone[0]!;
    const q = busy.length ? place({ ...cur, nodes }, first, nodes.get(first)!, [...new Set(lines.map((o) => o.to.node))], (Math.min(...busy) + Math.max(...busy)) / 2, a.y + a.height, pad, gap) : undefined;
    if (q) for (const [id, box] of q.nodes) nodes.set(id, box);
    const groups = fitGroups(graph, nodes, cur.groups, sized.groupHeader, pad, sized.groupMinWidth);
    // A group grown over something else: not this way.
    if (boxOverlaps(graph, { nodes, groups }).length > boxOverlaps(graph, cur).length) return undefined;
    cur = { ...cur, nodes, groups };
  }
  return cur === p ? undefined : snug(cur);
}

/** The placement moved to start at 0, 0 and sized to what it holds. */
function snug(p: Placement): Placement {
  const all = [...p.nodes.values(), ...p.groups.values()];
  const dx = Math.min(...all.map((b) => b.x));
  const dy = Math.min(...all.map((b) => b.y));
  const shift = (b: Box): Box => ({ ...b, x: b.x - dx, y: b.y - dy });
  const nodes = new Map([...p.nodes].map(([k, b]) => [k, shift(b)]));
  const groups = new Map([...p.groups].map(([k, b]) => [k, shift(b)]));
  const boxes = [...nodes.values(), ...groups.values()];
  return { nodes, groups, width: Math.max(...boxes.map((b) => b.x + b.width)), height: Math.max(...boxes.map((b) => b.y + b.height)) };
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
