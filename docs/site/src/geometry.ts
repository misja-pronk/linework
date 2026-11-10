// Layout measures computed from drawn geometry only: boxes for nodes and labels, sampled polylines
// for lines. Every tool's SVG is reduced to this in the same way, so the numbers compare.

export type Pt = [number, number];
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Shape extends Rect {
  id: string;
}
export interface Line {
  id: string;
  /** The line as drawn, sampled every few pixels (curves included), without the arrowhead. */
  pts: Pt[];
}
export interface Drawing {
  nodes: Shape[];
  lines: Line[];
  /** Labels on lines (not the names inside shapes). */
  labels: Rect[];
}

export interface Metrics {
  nodes: number;
  lines: number;
  /** Places where two different lines cross (not where they meet at a shape). */
  crossings: number;
  /** Pairs of lines that share no end but run into each other and part on one track. */
  touches: number;
  /** Changes of direction of 25° or more, summed over all lines; a rounded corner or a curve that turns counts once. */
  bends: number;
  /** Mean total change of direction per line, in degrees (fair to curves and to right angles alike). */
  turning: number;
  /** Mean line length, in units of the typical shape size (square root of the median shape area). */
  length: number;
  /** Area of the drawing (shapes, lines, labels; no title or legend) over the area of the shapes in it. */
  area: number;
  /** Width over height of that area. */
  aspect: number;
  /** Line labels that overlap another label or a shape. */
  labelOverlaps: number;
  /** A line passing through a shape that is not one of its ends. */
  throughShapes: number;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function polylineLength(pts: Pt[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += dist(pts[i - 1]!, pts[i]!);
  return n;
}

/** Where segments ab and cd cross properly (not at an end, not collinear), or undefined. */
export function crossing(a: Pt, b: Pt, c: Pt, d: Pt): Pt | undefined {
  const r: Pt = [b[0] - a[0], b[1] - a[1]];
  const s: Pt = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return undefined;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  const e = 1e-6;
  if (t <= e || t >= 1 - e || u <= e || u >= 1 - e) return undefined;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

/** Distance from a point to a polyline. */
function distanceTo(p: Pt, line: Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1]!, line[i]!];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return best;
}

/** The point `d` pixels along a polyline from where segment `i` (ending at index i) holds `x`; negative goes back. */
function along(pts: Pt[], i: number, x: Pt, d: number): Pt {
  let left = Math.abs(d);
  let at = x;
  let k = d > 0 ? i : i - 1;
  while (k >= 0 && k < pts.length) {
    const next = pts[k]!;
    const step = dist(at, next);
    if (step >= left) return [at[0] + ((next[0] - at[0]) * left) / step, at[1] + ((next[1] - at[1]) * left) / step];
    left -= step;
    at = next;
    k += d > 0 ? 1 : -1;
  }
  return at;
}

/**
 * Crossings between lines. Points near either line's ends (where lines meet at a shape or a port) do
 * not count, and neither do places where two lines run on one track and part (a trunk that splits at
 * a junction): just before or after such a point the lines are still on top of each other. So a real
 * crossing is one where, `probe` pixels either side of it, each line is clear of the other.
 */
export function crossings(lines: Line[], endRadius = 6, merge = 6, probe = 8): number {
  return contacts(lines, [], endRadius, merge, probe).crossings;
}

/**
 * Crossings, and touches: places where two lines that share no end run into each other and part
 * again on the same track. A trunk that splits (lines from one shape) is not a touch; two unrelated
 * lines meeting at a corner is, because a reader cannot tell which way each one goes.
 */
export function contacts(lines: Line[], nodes: Shape[] = [], endRadius = 6, merge = 6, probe = 8): { crossings: number; touches: number } {
  const endsByLine = lines.map((l) => endsOf(l, nodes));
  const found: Pt[] = [];
  let touches = 0;
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const p = lines[i]!.pts;
      const q = lines[j]!.pts;
      if (p.length < 2 || q.length < 2) continue;
      const ends = [p[0]!, p.at(-1)!, q[0]!, q.at(-1)!];
      // Lines that start or end at the same place may share a track.
      const related = [...endsByLine[i]!].some((n) => endsByLine[j]!.has(n)) || [p[0]!, p.at(-1)!].some((e) => [q[0]!, q.at(-1)!].some((f) => dist(e, f) < 24));
      const here: Pt[] = [];
      for (let a = 1; a < p.length; a++) {
        for (let b = 1; b < q.length; b++) {
          const x = crossing(p[a - 1]!, p[a]!, q[b - 1]!, q[b]!);
          if (!x || ends.some((e) => dist(e, x) < endRadius)) continue;
          // A line drawn as a curve can cross the same line twice within a few pixels: one crossing.
          if (here.some((h) => dist(h, x) < merge)) continue;
          const shared = [along(p, a, x, -probe), along(p, a, x, probe)].some((s) => distanceTo(s, q) < 1.5) || [along(q, b, x, -probe), along(q, b, x, probe)].some((s) => distanceTo(s, p) < 1.5);
          if (!shared) here.push(x);
        }
      }
      found.push(...here);
      // Unrelated lines that come within 4 px of each other (closer than a reader can tell apart) away from any crossing.
      if (!related && p.some((s) => !ends.some((e) => dist(e, s) < endRadius) && !here.some((h) => dist(h, s) < probe + 4) && distanceTo(s, q) < 4)) touches++;
    }
  }
  return { crossings: found.length, touches };
}

/**
 * Bends on one line: walk it, and group the turning that happens within `window` pixels of line;
 * a group that turns at least `min` degrees is one bend. A rounded orthogonal corner and a spline
 * that sweeps round both count as one, a wobble from sampling counts as none.
 */
export function bends(pts: Pt[], min = 25, window = 24): number {
  const clean: Pt[] = [];
  for (const p of pts) if (!clean.length || dist(clean.at(-1)!, p) > 0.75) clean.push(p);
  if (clean.length < 3) return 0;
  const heading = (a: Pt, b: Pt) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  const turn = (h1: number, h2: number) => {
    let d = h2 - h1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  };
  let count = 0;
  let group = 0;
  let since = Infinity;
  for (let i = 1; i < clean.length - 1; i++) {
    const d = turn(heading(clean[i - 1]!, clean[i]!), heading(clean[i]!, clean[i + 1]!));
    const step = dist(clean[i]!, clean[i + 1]!);
    if (Math.abs(d) > (2 * Math.PI) / 180) {
      // Turning in the same sense close to the last turn belongs to the same bend.
      if (since <= window && Math.sign(d) === Math.sign(group)) group += d;
      else {
        if (Math.abs(group) >= (min * Math.PI) / 180) count++;
        group = d;
      }
      since = 0;
    }
    since += step;
  }
  if (Math.abs(group) >= (min * Math.PI) / 180) count++;
  return count;
}

/** Total change of direction along a line, in degrees: 90 for a right-angle corner, the sweep of a curve, both turns of an S. */
export function turning(pts: Pt[]): number {
  const clean: Pt[] = [];
  for (const p of pts) if (!clean.length || dist(clean.at(-1)!, p) > 2) clean.push(p);
  let total = 0;
  for (let i = 1; i < clean.length - 1; i++) {
    let d = Math.atan2(clean[i + 1]![1] - clean[i]![1], clean[i + 1]![0] - clean[i]![0]) - Math.atan2(clean[i]![1] - clean[i - 1]![1], clean[i]![0] - clean[i - 1]![0]);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    if (Math.abs(d) > (0.3 * Math.PI) / 180) total += Math.abs(d);
  }
  return (total * 180) / Math.PI;
}

const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const shrink = (r: Rect, by: number): Rect => ({ x: r.x + by, y: r.y + by, w: Math.max(0, r.w - 2 * by), h: Math.max(0, r.h - 2 * by) });
const inside = (p: Pt, r: Rect, pad = 0) => p[0] >= r.x - pad && p[0] <= r.x + r.w + pad && p[1] >= r.y - pad && p[1] <= r.y + r.h + pad;

function segmentHitsRect(a: Pt, b: Pt, r: Rect): boolean {
  if (inside(a, r) || inside(b, r)) return true;
  const corners: Pt[] = [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h],
    [r.x, r.y + r.h],
  ];
  for (let i = 0; i < 4; i++) if (crossing(a, b, corners[i]!, corners[(i + 1) % 4]!)) return true;
  return false;
}

/** The shapes a line starts and ends at: those its ends touch (within `pad`), nearest first. */
export function endsOf(line: Line, nodes: Shape[], pad = 10): Set<string> {
  const out = new Set<string>();
  for (const end of [line.pts[0], line.pts.at(-1)]) {
    if (!end) continue;
    const near = nodes.filter((n) => inside(end, n, pad)).sort((x, y) => x.w * x.h - y.w * y.h);
    if (near[0]) out.add(near[0].id);
  }
  return out;
}

export function bounds(d: Drawing): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const r of [...d.nodes, ...d.labels]) (add(r.x, r.y), add(r.x + r.w, r.y + r.h));
  for (const l of d.lines) for (const p of l.pts) add(p[0], p[1]);
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 };
}

/** The typical shape size: the square root of the median shape area. */
export function unitOf(nodes: Shape[]): number {
  const areas = nodes.map((n) => n.w * n.h).sort((a, b) => a - b);
  return Math.sqrt(areas[Math.floor(areas.length / 2)] ?? 1) || 1;
}

export function measure(d: Drawing): Metrics {
  const unit = unitOf(d.nodes);
  const box = bounds(d);
  const nodeArea = d.nodes.reduce((n, r) => n + r.w * r.h, 0) || 1;
  let labelOverlaps = 0;
  for (let i = 0; i < d.labels.length; i++) {
    const a = shrink(d.labels[i]!, 1);
    const hit = d.labels.some((b, j) => j !== i && overlap(a, shrink(b, 1)) > 4) || d.nodes.some((n) => overlap(a, shrink(n, 2)) > 4);
    if (hit) labelOverlaps++;
  }
  let throughShapes = 0;
  for (const l of d.lines) {
    const ends = endsOf(l, d.nodes);
    for (const n of d.nodes) {
      if (ends.has(n.id)) continue;
      const r = shrink(n, 3);
      if (r.w <= 0 || r.h <= 0) continue;
      // A shape that holds one of the line's ends (a table inside a group, a port) is not passed through.
      if (inside(l.pts[0]!, n, 1) || inside(l.pts.at(-1)!, n, 1)) continue;
      let hit = false;
      for (let i = 1; i < l.pts.length && !hit; i++) hit = segmentHitsRect(l.pts[i - 1]!, l.pts[i]!, r);
      if (hit) throughShapes++;
    }
  }
  const total = d.lines.reduce((n, l) => n + polylineLength(l.pts), 0);
  return {
    nodes: d.nodes.length,
    lines: d.lines.length,
    ...contacts(d.lines, d.nodes),
    bends: d.lines.reduce((n, l) => n + bends(l.pts), 0),
    turning: d.lines.length ? d.lines.reduce((n, l) => n + turning(l.pts), 0) / d.lines.length : 0,
    length: d.lines.length ? total / d.lines.length / unit : 0,
    area: (box.w * box.h) / nodeArea,
    aspect: box.h ? box.w / box.h : 0,
    labelOverlaps,
    throughShapes,
  };
}

export interface Displacement {
  /** Shapes in both drawings. */
  matched: number;
  /** Mean movement of a shape that was there before, after sliding the drawing as a whole back, as a share of the diagonal before. */
  mean: number;
  /** Share of those shapes that moved more than half a shape size. */
  moved: number;
}

/** How far the shapes that were already there moved when one shape and one line were added. */
export function displacement(before: Drawing, after: Drawing): Displacement {
  const centre = (r: Rect): Pt => [r.x + r.w / 2, r.y + r.h / 2];
  const now = new Map(after.nodes.map((n) => [n.id, centre(n)]));
  const pairs = before.nodes.filter((n) => now.has(n.id)).map((n) => [centre(n), now.get(n.id)!] as const);
  if (!pairs.length) return { matched: 0, mean: 0, moved: 0 };
  // The whole drawing may shift (it grew on one side): that is not movement a reader has to follow.
  const dx = pairs.reduce((s, [a, b]) => s + b[0] - a[0], 0) / pairs.length;
  const dy = pairs.reduce((s, [a, b]) => s + b[1] - a[1], 0) / pairs.length;
  const moves = pairs.map(([a, b]) => Math.hypot(b[0] - a[0] - dx, b[1] - a[1] - dy));
  const box = bounds(before);
  const diag = Math.hypot(box.w, box.h) || 1;
  const unit = unitOf(before.nodes);
  return { matched: pairs.length, mean: moves.reduce((s, m) => s + m, 0) / moves.length / diag, moved: moves.filter((m) => m > unit / 2).length / moves.length };
}
