// Editor craft as plain geometry, so it can be tested without a browser: smart guides and snapping while
// dragging, align and distribute, dragging a line's segment, and finding the nearest element in a direction.
// Everything works in pin space (what the sidecar stores).
import type { Box, Point } from '@linework/core';

/** An alignment line: `axis` x is a vertical line at x = `at`, running from `from` to `to` along y. */
export interface Guide {
  axis: 'x' | 'y';
  at: number;
  from: number;
  to: number;
}

/** Equal spacing: the gaps that came out the same, as spans along `axis`, drawn across at `at`. */
export interface Gap {
  axis: 'x' | 'y';
  at: number;
  spans: [number, number][];
}

export interface Snap {
  dx: number;
  dy: number;
  guides: Guide[];
  gaps: Gap[];
}

type Axis = 'x' | 'y';
const size = (a: Axis) => (a === 'x' ? 'width' : 'height');
const other = (a: Axis): Axis => (a === 'x' ? 'y' : 'x');
const lines = (b: Box, a: Axis) => [b[a], b[a] + b[size(a)] / 2, b[a] + b[size(a)]];

interface Candidate {
  d: number;
  gap?: Gap;
}

/** Where `m` snaps along one axis: edges and centres of the others, or the same gap as its neighbours have. */
function snapAxis(m: Box, others: Box[], a: Axis, tol: number): Candidate | undefined {
  let best: Candidate | undefined;
  const offer = (c: Candidate) => Math.abs(c.d) <= tol && (!best || Math.abs(c.d) < Math.abs(best.d) - 0.01) && (best = c);
  for (const o of others) for (const theirs of lines(o, a)) for (const mine of lines(m, a)) offer({ d: theirs - mine });
  // Spacing: only boxes in the same row (or column) count, the way people read a gap.
  const s = size(a);
  const b = other(a);
  const row = others.filter((o) => o[b] < m[b] + m[size(b)] && m[b] < o[b] + o[size(b)]).sort((p, q) => p[a] - q[a]);
  const end = (o: Box) => o[a] + o[s];
  const before = row.filter((o) => end(o) <= m[a] + tol);
  const after = row.filter((o) => o[a] >= m[a] + m[s] - tol);
  const l = before.at(-1) && before.reduce((p, q) => (end(q) > end(p) ? q : p));
  const r = after[0] && after.reduce((p, q) => (q[a] < p[a] ? q : p));
  const across = (boxes: Box[]) => {
    const lo = Math.max(...boxes.map((o) => o[b]));
    const hi = Math.min(...boxes.map((o) => o[b] + o[size(b)]));
    return lo <= hi ? (lo + hi) / 2 : m[b] + m[size(b)] / 2;
  };
  if (l && r && r[a] - end(l) > m[s]) {
    const at = (end(l) + r[a] - m[s]) / 2;
    offer({ d: at - m[a], gap: { axis: a, at: across([l, m, r]), spans: [[end(l), at], [at + m[s], r[a]]] } });
  }
  // The gap of a neighbouring pair, repeated on the far side of it.
  for (let i = 0; i + 1 < row.length; i++) {
    const p = row[i]!;
    const q = row[i + 1]!;
    const g = q[a] - end(p);
    if (g <= 0) continue;
    if (q === l) offer({ d: end(q) + g - m[a], gap: { axis: a, at: across([p, q, m]), spans: [[end(p), q[a]], [end(q), end(q) + g]] } });
    if (p === r) offer({ d: p[a] - g - m[s] - m[a], gap: { axis: a, at: across([m, p, q]), spans: [[p[a] - g, p[a]], [end(p), q[a]]] } });
  }
  return best;
}

/** Snaps a dragged box to the others (within `tol`), else to the grid; returns the correction and what to draw. */
export function snapBox(m: Box, others: Box[], tol: number, grid?: number): Snap {
  const x = snapAxis(m, others, 'x', tol);
  const y = snapAxis(m, others, 'y', tol);
  const toGrid = (v: number) => (grid ? Math.round(v / grid) * grid - v : 0);
  const dx = x ? x.d : toGrid(m.x);
  const dy = y ? y.d : toGrid(m.y);
  const at = { ...m, x: m.x + dx, y: m.y + dy };
  // Every edge or centre that lines up after the snap gets a guide, spanning the boxes it joins.
  const guides: Guide[] = [];
  for (const a of ['x', 'y'] as const) {
    if (!(a === 'x' ? x : y)) continue;
    const b = other(a);
    for (const v of lines(at, a)) {
      const hits = others.filter((o) => lines(o, a).some((w) => Math.abs(w - v) < 0.5));
      if (!hits.length) continue;
      const all = [at, ...hits];
      guides.push({ axis: a, at: v, from: Math.min(...all.map((o) => o[b])), to: Math.max(...all.map((o) => o[b] + o[size(b)])) });
    }
  }
  const gaps = [x?.gap, y?.gap].filter((g): g is Gap => !!g && Math.abs((g.axis === 'x' ? x! : y!).d) <= tol);
  return { dx, dy, guides, gaps };
}

/** The smallest box around all of them. */
export function union(boxes: Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  return { x: x0, y: y0, width: Math.max(...boxes.map((b) => b.x + b.width)) - x0, height: Math.max(...boxes.map((b) => b.y + b.height)) - y0 };
}

// ---------------------------------------------------------------- align and distribute

export type ArrangeOp = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom' | 'distribute-x' | 'distribute-y';

/** New top-lefts for boxes aligned or distributed; boxes that do not move are left out. */
export function arrange(boxes: [string, Box][], op: ArrangeOp): Record<string, Point> {
  const out: Record<string, Point> = {};
  if (boxes.length < 2) return out;
  const all = union(boxes.map(([, b]) => b));
  const put = (id: string, b: Box, x: number, y: number) => (Math.round(x) !== Math.round(b.x) || Math.round(y) !== Math.round(b.y)) && (out[id] = { x: Math.round(x), y: Math.round(y) });
  if (op === 'distribute-x' || op === 'distribute-y') {
    if (boxes.length < 3) return out;
    const a: Axis = op === 'distribute-x' ? 'x' : 'y';
    const s = size(a);
    const sorted = [...boxes].sort(([, p], [, q]) => p[a] + p[s] / 2 - (q[a] + q[s] / 2));
    const first = sorted[0]![1];
    const last = sorted.at(-1)![1];
    const room = last[a] + last[s] - first[a] - sorted.reduce((t, [, b]) => t + b[s], 0);
    // Equal gaps between them; when they overlap too much for that, equal steps between centres.
    const gap = room / (sorted.length - 1);
    let at = first[a];
    sorted.forEach(([id, b], i) => {
      const v = gap >= 0 ? at : first[a] + first[s] / 2 + ((last[a] + last[s] / 2 - first[a] - first[s] / 2) * i) / (sorted.length - 1) - b[s] / 2;
      put(id, b, a === 'x' ? v : b.x, a === 'y' ? v : b.y);
      at += b[s] + gap;
    });
    return out;
  }
  for (const [id, b] of boxes) {
    const x = op === 'left' ? all.x : op === 'centre' ? all.x + all.width / 2 - b.width / 2 : op === 'right' ? all.x + all.width - b.width : b.x;
    const y = op === 'top' ? all.y : op === 'middle' ? all.y + all.height / 2 - b.height / 2 : op === 'bottom' ? all.y + all.height - b.height : b.y;
    put(id, b, x, y);
  }
  return out;
}

// ---------------------------------------------------------------- lines bent by hand

/** Drop duplicate and collinear points (as the router does). */
export function simplify(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out.at(-1);
    if (last && last.x === p.x && last.y === p.y) continue;
    const before = out.at(-2);
    if (before && last && ((before.x === last.x && last.x === p.x) || (before.y === last.y && last.y === p.y))) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

/** The segment of a line nearest to a point. */
export function nearestSegment(pts: Point[], q: Point): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const cx = Math.max(Math.min(a.x, b.x), Math.min(q.x, Math.max(a.x, b.x)));
    const cy = Math.max(Math.min(a.y, b.y), Math.min(q.y, Math.max(a.y, b.y)));
    const d = Math.hypot(q.x - cx, q.y - cy);
    if (d < bestD) [best, bestD] = [i, d];
  }
  return best;
}

/** Whether segment `i` runs left-right (it then moves up and down). */
export const isHorizontal = (pts: Point[], i: number) => pts[i]!.y === pts[i + 1]!.y;

/**
 * The line with segment `i` moved across itself by `d`. The ends stay on their ports: an end segment keeps a
 * short straight piece at the box and gets a jog, like dragging a segment in draw.io or yFiles.
 */
export function dragSegment(pts: Point[], i: number, d: number, stub = 30): Point[] {
  const h = isHorizontal(pts, i);
  const off = (p: Point) => (h ? { x: p.x, y: p.y + d } : { x: p.x + d, y: p.y });
  const toward = (a: Point, b: Point) => {
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    const t = len ? Math.min(stub, len / 2) / len : 0;
    // Along the segment only, unrounded: rounding the other coordinate would put a tiny jog in a line on a half pixel.
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  const a = pts[i]!;
  const b = pts[i + 1]!;
  const head = i === 0 ? [a, toward(a, b), off(toward(a, b))] : [...pts.slice(0, i), off(a)];
  const tail = i + 1 === pts.length - 1 ? [off(toward(b, a)), toward(b, a), b] : [off(b), ...pts.slice(i + 2)];
  return simplify([...head, ...tail]);
}

/**
 * The line with the bend at point `j` taken out: the shorter of its two pieces collapses (the piece
 * after it, or before it, moves over onto the other side), so two bends become none and the line
 * stays orthogonal. Undefined when `j` is an end, or the bend sits between the two end pieces.
 */
export function removeBend(pts: Point[], j: number): Point[] | undefined {
  if (j <= 0 || j >= pts.length - 1) return undefined;
  const len = (i: number) => Math.abs(pts[i + 1]!.x - pts[i]!.x) + Math.abs(pts[i + 1]!.y - pts[i]!.y);
  // The piece to collapse has a piece on both sides of it.
  const s = [j - 1, j].filter((i) => i > 0 && i < pts.length - 2).sort((a, b) => len(a) - len(b))[0];
  if (s == null) return undefined;
  const a = pts[s]!;
  const b = pts[s + 1]!;
  const d = isHorizontal(pts, s) ? b.x - a.x : b.y - a.y;
  // Move the piece after it back onto its start, or (when that is the last piece) the one before it on to its end.
  const after = s + 1 < pts.length - 2;
  return dragSegment(pts, after ? s + 1 : s - 1, after ? -d : d);
}

/** The bend (point index) of a line within `tol` of a point, ends excepted. */
export function bendAt(pts: Point[], q: Point, tol: number): number | undefined {
  for (let j = 1; j < pts.length - 1; j++) if (Math.abs(pts[j]!.x - q.x) <= tol && Math.abs(pts[j]!.y - q.y) <= tol) return j;
  return undefined;
}

/** What the sidecar keeps of a line: its bends, without the two ends (those follow the boxes). */
export const bendsOf = (pts: Point[]): Point[] => simplify(pts).slice(1, -1);

// ---------------------------------------------------------------- moving focus by direction

export type Direction = 'left' | 'right' | 'up' | 'down';

/** The element nearest in a direction from `from`: straight ahead counts more than off to the side. */
export function nearestToward(from: Box, candidates: [string, Box][], dir: Direction): string | undefined {
  const c = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const o = c(from);
  let best: [string, number] | undefined;
  for (const [id, b] of candidates) {
    const p = c(b);
    const ahead = dir === 'right' ? p.x - o.x : dir === 'left' ? o.x - p.x : dir === 'down' ? p.y - o.y : o.y - p.y;
    const side = dir === 'left' || dir === 'right' ? Math.abs(p.y - o.y) : Math.abs(p.x - o.x);
    if (ahead <= 1) continue;
    const cost = ahead + 2 * side;
    if (!best || cost < best[1]) best = [id, cost];
  }
  return best?.[0];
}

/** A view (offset and scale) that shows `b` in a pane, with a margin; never closer than `max`. */
export function viewFor(b: Box, pane: { w: number; h: number }, opts: { pad?: number; top?: number; bottom?: number; min?: number; max?: number } = {}) {
  const { pad = 48, top = 0, bottom = 0, min = 0.1, max = 4 } = opts;
  const w = Math.max(1, pane.w - 2 * pad);
  const h = Math.max(1, pane.h - 2 * pad - top - bottom);
  const scale = Math.min(max, Math.max(min, Math.min(w / Math.max(1, b.width), h / Math.max(1, b.height))));
  return { scale, x: pane.w / 2 - (b.x + b.width / 2) * scale, y: top + pad + h / 2 - (b.y + b.height / 2) * scale };
}
