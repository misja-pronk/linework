// Line bridges: where two lines cross, the upright one hops over the level one. A short gap in the
// ground colour is cut into the line underneath and the line on top is drawn again, so a crossing
// never reads as a junction.
import type { Graph, GraphEdge, Marker, Placed, Point } from '@linework/core';
import { look, type Theme } from '@linework/theme';
import type { Ground } from './ground.ts';
import { r1 } from './paint.ts';

interface Segment {
  a: Point;
  b: Point;
  edge: GraphEdge;
  /** The line's own ends this piece has (first or last piece), with how near a gap may come: a gap cut near one reads as a broken arrow. */
  ends: { at: Point; keep: number }[];
}

/** Crossings stay clear of bends and line ends by this much, so a bridge never lands on a corner. */
const CLEAR = 7;
/** A gap is never cut this near a line's end (its arrowhead or mark): the other line takes the gap, or none does. */
const END = 28;
/** Nor this near the far side of its mark: a crow's foot with a ring reaches about 30px along the line. */
const PAST_MARK = 20;
const COUNTED = new Set<Marker>(['one', 'zeroOrOne', 'many', 'oneOrMany', 'zeroOrMany']);
const reach = (m: Marker) => (COUNTED.has(m) ? 30 : m === 'triangle' ? 13 : m === 'diamond' || m === 'filledDiamond' ? 16 : m === 'none' ? 0 : 10);

/** `step`: in one step of a presentation the line that matters more goes over, as heavy as that step draws it. */
export function bridges(graph: Graph, placed: Placed, theme: Theme, ground: Ground, color: (e: GraphEdge) => string, skip: Set<string> = new Set(), step?: { rank: (e: GraphEdge) => number; scale: (e: GraphEdge) => number }): string {
  const gap = look(theme).line.bridge;
  if (!gap) return '';
  const level: Segment[] = [];
  const upright: Segment[] = [];
  for (const edge of graph.edges) {
    const pts = placed.edges.get(edge.id)?.points;
    if (!pts || pts.length < 2 || skip.has(edge.id)) continue;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const keep = (m: Marker) => Math.max(END, reach(m) + PAST_MARK);
      const ends = [...(i === 1 ? [{ at: a, keep: keep(edge.start) }] : []), ...(i === pts.length - 1 ? [{ at: b, keep: keep(edge.end) }] : [])];
      if (Math.abs(a.y - b.y) < 0.5) level.push({ a, b, edge, ends });
      else if (Math.abs(a.x - b.x) < 0.5) upright.push({ a, b, edge, ends });
    }
  }
  const within = (v: number, p: number, q: number) => v > Math.min(p, q) + CLEAR && v < Math.max(p, q) - CLEAR;
  const seen = new Set<string>();
  let s = '';
  for (const v of upright)
    for (const h of level) {
      if (v.edge === h.edge) continue;
      const x = v.a.x;
      const y = h.a.y;
      if (!within(x, h.a.x, h.b.x) || !within(y, v.a.y, v.b.y)) continue;
      // The upright line goes over, unless it is dashed and the level one is solid: a gap in a dashed
      // line is just another dash. Two dashed lines cross as they are.
      const first = step ? step.rank(h.edge) - step.rank(v.edge) : 0;
      let over = first > 0 || (!first && v.edge.line !== 'solid' && h.edge.line === 'solid') ? h : v;
      // Not a gap right before an arrowhead: the other line takes it, or (both near their ends) none does.
      const near = (g: Segment) => g.ends.some((e) => Math.abs(e.at.x - x) + Math.abs(e.at.y - y) < e.keep);
      const other = over === v ? h : v;
      if (near(other)) {
        if (near(over) || over.edge.line === 'solid' && other.edge.line !== 'solid') continue;
        over = other;
      }
      if (over.edge.line !== 'solid') continue;
      const key = `${r1(x)},${r1(y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const w = theme.stroke.edge * (over.edge.width ?? 1) * (step?.scale(over.edge) ?? 1);
      const under = over === v ? h : v;
      const wu = theme.stroke.edge * (under.edge.width ?? 1) * (step?.scale(under.edge) ?? 1);
      // Cut the line underneath back on both sides of the one on top, then draw that one again across the cut.
      const half = w / 2 + gap;
      const cut = over === v ? `M${r1(x - half)} ${r1(y)}H${r1(x + half)}` : `M${r1(x)} ${r1(y - half)}V${r1(y + half)}`;
      const reach = wu / 2 + 1.5;
      const top = over === v ? `M${r1(x)} ${r1(y - reach)}V${r1(y + reach)}` : `M${r1(x - reach)} ${r1(y)}H${r1(x + reach)}`;
      s += `<path d="${cut}" stroke="${ground.at(x, y)}" stroke-width="${r1(wu + 1.5)}" fill="none"/><path d="${top}" stroke="${color(over.edge)}" stroke-width="${r1(w)}" fill="none"${over.edge.tone ? ' stroke-opacity="0.9"' : ''}/>`;
    }
  return s;
}
