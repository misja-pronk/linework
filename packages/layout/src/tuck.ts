// Tucking: a card outside the groups that stands on an edge of the drawing by itself (a dashboard at
// the far end of the flow, staff on a row of their own under a wrapped drawing) makes the drawing
// longer for one card, and leaves the room beside it empty. Moved into an empty corner of the rest,
// beside or under what it is joined to, the drawing gets shorter and comes out larger on the page.
import type { Box, Graph } from '@cartography/core';
import type { Placement } from './dot.ts';

const union = (list: Box[]): Box => {
  const x = Math.min(...list.map((b) => b.x));
  const y = Math.min(...list.map((b) => b.y));
  return { x, y, width: Math.max(...list.map((b) => b.x + b.width)) - x, height: Math.max(...list.map((b) => b.y + b.height)) - y };
};

const grid = (n: number) => Math.round(n / 8) * 8;

/** How far apart two boxes are (0 when they touch or overlap). */
function apart(a: Box, b: Box): number {
  const dx = Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width);
  const dy = Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height);
  return Math.hypot(dx, dy);
}

const hit = (a: Box, b: Box, gx: number, gy: number) => a.x < b.x + b.width + gx && b.x < a.x + a.width + gx && a.y < b.y + b.height + gy && b.y < a.y + a.height + gy;

/**
 * Placements with one card outside the groups moved into free room of the rest, most promising
 * first (by `scale`, how large a placement comes out on the page), at most `most`. Only moves that
 * make the drawing come out larger by `gain`; a card never ends up further from what it is joined to
 * than it was (by more than its own length), nor before what feeds it or after what it feeds.
 */
export function tuck(p: Placement, graph: Graph, gaps: { along: number; across: number }, scale: (q: Placement) => number, gain = 1.03, most = 4): Placement[] {
  const down = graph.direction === 'down';
  // Room between columns along the flow, and between cards across it, as dot keeps them.
  const [gx, gy] = down ? [gaps.across, gaps.along] : [gaps.along, gaps.across];
  const [at, size] = down ? (['y', 'height'] as const) : (['x', 'width'] as const);
  const top = [...graph.groups.filter((g) => !g.parent && p.groups.has(g.id)).map((g) => p.groups.get(g.id)!), ...graph.nodes.filter((n) => !n.parent && p.nodes.has(n.id)).map((n) => ({ id: n.id, ...p.nodes.get(n.id)! }))];
  if (!top.length) return [];
  const all = union(top);
  const now = scale({ ...p, width: all.width, height: all.height });
  const found: { q: Placement; s: number; d: number; level: boolean }[] = [];
  for (const n of graph.nodes) {
    const card = p.nodes.get(n.id);
    if (n.parent || !card) continue;
    const lines = graph.edges.filter((e) => (e.from.node === n.id) !== (e.to.node === n.id));
    if (!lines.length) continue;
    const ends = lines.map((e) => ({ out: e.from.node === n.id, box: p.nodes.get(e.from.node === n.id ? e.to.node : e.from.node) ?? p.groups.get(e.from.node === n.id ? e.to.node : e.from.node) }));
    if (ends.some((e) => !e.box)) continue;
    // A card in line with what it is joined to stays: its line runs straight.
    const mid = (b: Box) => (down ? b.x + b.width / 2 : b.y + b.height / 2);
    if (ends.some((e) => Math.abs(mid(e.box!) - mid(card)) < 1)) continue;
    const rest = top.filter((b) => !('id' in b) || b.id !== n.id) as Box[];
    if (!rest.length) continue;
    const r = union(rest);
    // Only a card that makes the drawing longer or thicker by standing where it stands.
    const whole = union([r, card]);
    if (whole.width <= r.width + 1 && whole.height <= r.height + 1) continue;
    const far = Math.max(...ends.map((e) => apart(card, e.box!))) + Math.max(card.width, card.height);
    // Spots: flush with the edges of what stands at the top level, or the gap away from them.
    const xs = new Set<number>();
    const ys = new Set<number>();
    for (const b of [...rest, ...ends.map((e) => e.box!)]) {
      // Level with a box as it stands (it may be off the grid), or on the grid.
      xs.add(b.x).add(b.x + b.width - card.width);
      ys.add(b.y).add(b.y + b.height - card.height);
      for (const x of [b.x, b.x + b.width - card.width, b.x + b.width + gx, b.x - gx - card.width, b.x + b.width / 2 - card.width / 2]) xs.add(grid(x));
      for (const y of [b.y, b.y + b.height - card.height, b.y + b.height + gy, b.y - gy - card.height, b.y + b.height / 2 - card.height / 2]) ys.add(grid(y));
    }
    const inOrder = (b: Box) => ends.every((e) => (e.out ? b[at] + b[size] <= e.box![at] : b[at] >= e.box![at] + e.box![size]));
    const clear = inOrder(card);
    let best: { q: Placement; s: number; d: number; level: boolean } | undefined;
    for (const x of xs)
      for (const y of ys) {
        const to: Box = { ...card, x, y };
        if (rest.some((b) => hit(to, b, gx - 1, gy - 1))) continue;
        const d = Math.max(...ends.map((e) => apart(to, e.box!)));
        if (d > far) continue;
        // Along the flow: still after what feeds it and before what it feeds (wholly, when it stood so), so its lines run on and never back.
        if (clear ? !inOrder(to) : ends.some((e) => (e.out ? e.box![at] + e.box![size] <= to[at] : to[at] + to[size] <= e.box![at]))) continue;
        // Into the rest: the drawing gets no longer along the flow for it.
        if (to[at] < r[at] - 1 || to[at] + to[size] > r[at] + r[size] + 1) continue;
        const u = union([r, to]);
        const q: Placement = { nodes: new Map(p.nodes).set(n.id, to), groups: p.groups, width: u.width, height: u.height };
        const s = scale(q);
        if (s < gain * now) continue;
        // The largest on the page; of two as large, one in a row (column, top-down) with a card or group
        // already there, then the one nearer what it is joined to.
        const level = rest.some((b) => Math.abs(b[at] - to[at]) < 1 || Math.abs(b[at] + b[size] - to[at] - to[size]) < 1);
        if (!best || s > best.s + 1e-6 || (s > best.s - 1e-6 && (level !== best.level ? level : d < best.d))) best = { q, s, d, level };
      }
    if (best) found.push(best);
  }
  return found
    .sort((a, b) => b.s - a.s || a.d - b.d)
    .slice(0, most)
    .map((f) => f.q);
}
