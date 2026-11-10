// Square lines around boxes, for the few lines a tree does not draw itself: a dotted-line report,
// an interaction between two teams that do not touch. A shortest path with a price on every bend,
// on the grid the boxes' own edges make (kept a margin away), so a line hugs no card and passes
// through none.
import type { Box, Point } from '@cartography/core';

export type Side = 'N' | 'E' | 'S' | 'W';

export interface RouteEnd {
  box: Box;
  /** Sides it may leave or arrive by (default all four). */
  sides?: Side[];
  /** Where along a side, 0–1 (default the middle): off the centre keeps it clear of a connector there. */
  at?: number;
}

export interface RouteOptions {
  /** Room kept around every box. */
  margin?: number;
  /** What one bend costs, in px of length. */
  bend?: number;
  /** Lines already drawn: running along one costs five times its length, so a line keeps a lane of its own beside them. */
  lines?: Point[][];
}

interface Run {
  /** The y of a level run, the x of an upright one. */
  at: number;
  lo: number;
  hi: number;
}

const DIRS: Record<Side, Point> = { N: { x: 0, y: -1 }, E: { x: 1, y: 0 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 } };

function port(b: Box, side: Side, at: number): Point {
  if (side === 'N') return { x: b.x + b.width * at, y: b.y };
  if (side === 'S') return { x: b.x + b.width * at, y: b.y + b.height };
  if (side === 'W') return { x: b.x, y: b.y + b.height * at };
  return { x: b.x + b.width, y: b.y + b.height * at };
}

/** A square route from one box to another around `obstacles` (the two ends may be among them); undefined when there is none. */
export function route(obstacles: Box[], from: RouteEnd, to: RouteEnd, o: RouteOptions = {}): Point[] | undefined {
  const m = o.margin ?? 12;
  const bendCost = o.bend ?? 40;
  const sidesA = from.sides ?? (['N', 'E', 'S', 'W'] as Side[]);
  const sidesB = to.sides ?? (['N', 'E', 'S', 'W'] as Side[]);
  const starts = sidesA.map((s) => ({ s, p: port(from.box, s, from.at ?? 0.5) }));
  const goals = sidesB.map((s) => ({ s, p: port(to.box, s, to.at ?? 0.5) }));
  const stub = (p: Point, s: Side) => ({ x: p.x + DIRS[s].x * m, y: p.y + DIRS[s].y * m });

  // Only what lies near the two ends matters: the boxes in their joint frame, widened a little.
  const fx0 = Math.min(from.box.x, to.box.x) - 200;
  const fx1 = Math.max(from.box.x + from.box.width, to.box.x + to.box.width) + 200;
  const fy0 = Math.min(from.box.y, to.box.y) - 200;
  const fy1 = Math.max(from.box.y + from.box.height, to.box.y + to.box.height) + 200;
  const near = obstacles.filter((b) => b.x < fx1 && b.x + b.width > fx0 && b.y < fy1 && b.y + b.height > fy0);
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (const b of near) {
    xs.add(b.x - m), xs.add(b.x + b.width + m), ys.add(b.y - m), ys.add(b.y + b.height + m);
  }
  // Channels: half way between neighbouring box edges.
  const mids = (s: Set<number>) => {
    const v = [...s].sort((a, b) => a - b);
    for (let i = 1; i < v.length; i++) if (v[i]! - v[i - 1]! > 2) s.add((v[i]! + v[i - 1]!) / 2);
  };
  mids(xs);
  mids(ys);
  // Lanes beside the lines already there, and what running on them costs.
  const level: Run[] = [];
  const upright: Run[] = [];
  for (const l of o.lines ?? [])
    for (let i = 1; i < l.length; i++) {
      const a = l[i - 1]!;
      const b = l[i]!;
      if (Math.abs(a.y - b.y) < 0.5) level.push({ at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
      else if (Math.abs(a.x - b.x) < 0.5) upright.push({ at: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
    }
  for (const r of level) if (r.at > fy0 && r.at < fy1) ys.add(r.at - 9), ys.add(r.at + 9);
  for (const r of upright) if (r.at > fx0 && r.at < fx1) xs.add(r.at - 9), xs.add(r.at + 9);
  const along = (x0: number, y0: number, x1: number, y1: number) => {
    const runs = y0 === y1 ? level : upright;
    const [at, a, b] = y0 === y1 ? [y0, Math.min(x0, x1), Math.max(x0, x1)] : [x0, Math.min(y0, y1), Math.max(y0, y1)];
    let shared = 0;
    for (const r of runs) if (Math.abs(r.at - at) < 1) shared = Math.max(shared, Math.min(b, r.hi) - Math.max(a, r.lo));
    return Math.max(0, shared);
  };
  for (const e of [...starts, ...goals]) {
    const q = stub(e.p, e.s);
    xs.add(q.x), ys.add(q.y);
  }
  const X = [...xs].sort((a, b) => a - b);
  const Y = [...ys].sort((a, b) => a - b);
  const xi = new Map(X.map((v, i) => [v, i]));
  const yi = new Map(Y.map((v, i) => [v, i]));
  // Grid points inside a box (and its margin) are closed. Every box edge and every channel between
  // two is a grid line, so a step between neighbouring points never jumps over a box.
  const free = new Uint8Array(X.length * Y.length).fill(1);
  const span = (v: number[], lo: number, hi: number) => {
    let a = 0;
    while (a < v.length && v[a]! <= lo + 0.5) a++;
    let b = a;
    while (b < v.length && v[b]! < hi - 0.5) b++;
    return [a, b] as const;
  };
  for (const b of near) {
    const [i0, i1] = span(X, b.x - m, b.x + b.width + m);
    const [j0, j1] = span(Y, b.y - m, b.y + b.height + m);
    for (let j = j0; j < j1; j++) free.fill(0, j * X.length + i0, j * X.length + i1);
  }
  const open = (i2: number, j2: number) => free[j2 * X.length + i2] === 1;

  // A* over (cell, heading); the heading is what a bend is counted against.
  const W = X.length;
  const key = (i: number, j: number, d: number) => (j * W + i) * 4 + d;
  const dirs: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const sideDir: Record<Side, number> = { N: 0, E: 1, S: 2, W: 3 };
  const cost = new Map<number, number>();
  const back = new Map<number, number>();
  const heap = new Heap();
  const goalAt = new Map<number, { s: Side; p: Point }>();
  for (const g of goals) {
    const q = stub(g.p, g.s);
    const i = xi.get(q.x)!;
    const j = yi.get(q.y)!;
    goalAt.set(j * W + i, g);
  }
  const target = goals.map((g) => stub(g.p, g.s));
  const h = (i: number, j: number) => Math.min(...target.map((t) => Math.abs(X[i]! - t.x) + Math.abs(Y[j]! - t.y)));
  for (const s of starts) {
    const q = stub(s.p, s.s);
    const i = xi.get(q.x)!;
    const j = yi.get(q.y)!;
    if (!free[j * W + i]) continue;
    const k = key(i, j, sideDir[s.s]);
    cost.set(k, m);
    back.set(k, -1 - starts.indexOf(s));
    heap.push(k, m + h(i, j));
  }
  let end: number | undefined;
  while (heap.size) {
    const k = heap.pop()!;
    const c = cost.get(k)!;
    const d = k % 4;
    const cell = (k - d) / 4;
    const i = cell % W;
    const j = (cell - i) / W;
    const g = goalAt.get(cell);
    // Arriving must be heading into the box: against the side's outward direction.
    if (g && (sideDir[g.s] + 2) % 4 === d) {
      end = k;
      break;
    }
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (d + 2) % 4) continue;
      const [dx, dy] = dirs[nd]!;
      const i2 = i + dx;
      const j2 = j + dy;
      if (i2 < 0 || j2 < 0 || i2 >= W || j2 >= Y.length || !open(i2, j2)) continue;
      const nk = key(i2, j2, nd);
      const nc = c + Math.abs(X[i2]! - X[i]!) + Math.abs(Y[j2]! - Y[j]!) + (nd === d ? 0 : bendCost) + 4 * along(X[i]!, Y[j]!, X[i2]!, Y[j2]!);
      if (nc < (cost.get(nk) ?? Infinity)) {
        cost.set(nk, nc);
        back.set(nk, k);
        heap.push(nk, nc + h(i2, j2));
      }
    }
    // Turning on the spot into the goal's heading.
    if (g) {
      const nd = (sideDir[g.s] + 2) % 4;
      const nk = key(i, j, nd);
      const nc = c + bendCost;
      if (nc < (cost.get(nk) ?? Infinity)) (cost.set(nk, nc), back.set(nk, k), heap.push(nk, nc));
    }
  }
  if (end === undefined) return undefined;
  const cells: Point[] = [];
  let k: number = end;
  let first = 0;
  while (k >= 0) {
    const cell = (k - (k % 4)) / 4;
    const i = cell % W;
    cells.unshift({ x: X[i]!, y: Y[(cell - i) / W]! });
    const b = back.get(k)!;
    if (b < 0) first = -1 - b;
    k = b;
  }
  const g = goalAt.get((end - (end % 4)) / 4)!;
  const pts = [starts[first]!.p, ...cells, g.p];
  return simplify(pts);
}

/** Drops points that do not turn. */
export function simplify(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    if (out.length && Math.abs(out.at(-1)!.x - p.x) < 0.01 && Math.abs(out.at(-1)!.y - p.y) < 0.01) continue;
    if (out.length >= 2) {
      const a = out.at(-2)!;
      const b = out.at(-1)!;
      if ((Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - p.x) < 0.01) || (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - p.y) < 0.01)) out.pop();
    }
    out.push(p);
  }
  return out;
}

/** A binary heap of keys by priority. */
class Heap {
  private k: number[] = [];
  private p: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, pri: number) {
    const k = this.k;
    const p = this.p;
    k.push(key);
    p.push(pri);
    let i = k.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (p[up]! <= p[i]!) break;
      [k[up], k[i]] = [k[i]!, k[up]!];
      [p[up], p[i]] = [p[i]!, p[up]!];
      i = up;
    }
  }
  pop(): number | undefined {
    const k = this.k;
    const p = this.p;
    if (!k.length) return undefined;
    const top = k[0]!;
    const lk = k.pop()!;
    const lp = p.pop()!;
    if (k.length) {
      k[0] = lk;
      p[0] = lp;
      let i = 0;
      for (;;) {
        const a = 2 * i + 1;
        const b = a + 1;
        let s = i;
        if (a < k.length && p[a]! < p[s]!) s = a;
        if (b < k.length && p[b]! < p[s]!) s = b;
        if (s === i) break;
        [k[s], k[i]] = [k[i]!, k[s]!];
        [p[s], p[i]] = [p[i]!, p[s]!];
        i = s;
      }
    }
    return top;
  }
}
