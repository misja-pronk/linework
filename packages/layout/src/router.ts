// Orthogonal edge router. Lines avoid boxes and group headers, keep apart from each other,
// prefer the middle of the channel between boxes, and end with a straight stub so arrowheads and
// crow's feet always sit on a straight piece.
//
// Approach: a grid of "interesting" coordinates (box sides plus margin, channel centres with
// parallel lanes, ports), A* over (point, heading) with costs for length, bends, crossing and
// overlapping lines already routed. Ports are spread along each side, ordered by where the other
// end is, so lines do not cross right at the box.
import type { Box, PlacedEdge, Point } from '@cartography/core';
import { nudge } from './nudge.ts';

export type Side = 'N' | 'E' | 'S' | 'W';

export interface RouteEnd {
  node: string;
  box: Box;
  /** Fixed attach height (table rows): the line must leave from W or E at this y. */
  rowY?: number;
  /** Straight piece at the end, room for the marker. */
  stub: number;
}

export interface RouteRequest {
  id: string;
  from: RouteEnd;
  to: RouteEnd;
  label?: { width: number; height: number };
  /** Lower routes first and gets the best paths. */
  order?: number;
  /** How the line is drawn (pattern, colour, markers). Lines drawn alike may share a trunk. */
  style?: string;
}

export interface RouterInput {
  /** Boxes lines must not cross (nodes). */
  obstacles: Map<string, Box>;
  /** Areas lines should not run through (group headers). */
  /** Areas lines may cross but should not run in: group headers, group borders. `weight` scales the cost. */
  soft: (Box & { weight?: number })[];
  direction: 'right' | 'down';
  edges: RouteRequest[];
  /** Spread lines sharing a corridor after routing (see nudge.ts); on unless false. */
  nudge?: boolean;
  /** Let lines drawn alike that leave (or reach) the same node side share one trunk; on unless false. */
  trunks?: boolean;
}

const MARGIN = 14;
const LANE = 9;
const BEND = 30;
const CROSS = 70;
const OVERLAP = 6; // per pixel of running on top of another line
const SOFT = 4; // per pixel inside a group header
const PASSES = 3;
const SHARE = 0.5; // per pixel of running on a sibling's line: cheaper than a lane of its own

const normal: Record<Side, Point> = { N: { x: 0, y: -1 }, E: { x: 1, y: 0 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 } };
const opposite: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' };

export function routeEdges(input: RouterInput): Map<string, PlacedEdge> {
  const sides = chooseSides(input);
  const trunk = input.trunks === false ? new Map<string, string>() : trunkGroups(input, sides);
  const ports = placePorts(input, sides, trunk);
  const grid = buildGrid(input, [...ports.values()].flatMap((p) => [p.start, p.goal]));
  const members = new Map<string, string[]>();
  for (const [id, t] of trunk) members.set(t, [...(members.get(t) ?? []), id]);
  const used = new Map<string, number[]>();
  const out = new Map<string, PlacedEdge>();
  const loose = new Set<string>();

  const order = [...input.edges].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || span(a) - span(b));
  // First pass routes against what is already there; later passes re-route every line knowing
  // all the others (rip-up and re-route), which removes most needless crossings.
  for (let pass = 0; pass < PASSES; pass++)
    for (const e of order) {
      const p = ports.get(e.id)!;
      const previous = used.get(e.id);
      if (previous) mark(grid, previous, -1);
      let points: Point[];
      loose.delete(e.id);
      if (e.from.node === e.to.node) points = selfLoop(p);
      else {
        // Siblings' lines are cheap to run on, so the lines merge into one trunk.
        const friends = (members.get(trunk.get(e.id) ?? '') ?? []).filter((id) => id !== e.id).map((id) => used.get(id)).filter((c): c is number[] => !!c);
        for (const c of friends) mark(grid, c, 1, true);
        const found = search(grid, p);
        for (const c of friends) mark(grid, c, -1, true);
        if (found) {
          mark(grid, found.cells, 1);
          used.set(e.id, found.cells);
        }
        points = found?.points ?? fallback(p);
        if (found) loose.add(e.id);
      }
      out.set(e.id, { points: simplify(points) });
    }
  if (input.nudge !== false) {
    const list = input.edges.filter((e) => out.has(e.id));
    const moved = nudge({
      obstacles: [...input.obstacles.values()],
      zones: input.soft,
      edges: list.map((e) => ({
        id: e.id,
        points: out.get(e.id)!.points,
        fromBox: e.from.box,
        toBox: e.to.box,
        fromStub: e.from.stub,
        toStub: e.to.stub,
        fromFixed: e.from.rowY != null,
        toFixed: e.to.rowY != null,
        fixed: !loose.has(e.id),
        trunk: trunk.get(e.id),
      })),
    });
    const nudged = new Map(out);
    list.forEach((e, i) => nudged.set(e.id, { points: moved[i]! }));
    // Spreading lines can shorten the pieces labels sat on: keep the spread only when every label still fits.
    const before = placeLabels(input, new Map([...out].map(([k, v]) => [k, { points: v.points }])));
    const after = placeLabels(input, nudged);
    if (after <= before) return nudged;
  }
  placeLabels(input, out);
  return out;
}

/**
 * Trunk groups: lines drawn alike leaving one node side (fan-out) share a port and run as one line
 * until they branch; so do solid lines arriving at one side (fan-in; dashes would not line up there).
 * Returns edge id → group key, only for groups of two or more.
 */
function trunkGroups(input: RouterInput, sides: Map<string, [Side, Side]>): Map<string, string> {
  const groups = new Map<string, string[]>();
  const add = (key: string, id: string) => groups.set(key, [...(groups.get(key) ?? []), id]);
  const usable = input.edges.filter((e) => e.style && e.from.node !== e.to.node);
  for (const e of usable) add(`out|${e.from.node}|${e.from.rowY ?? ''}|${sides.get(e.id)![0]}|${e.style}`, e.id);
  const out = new Map<string, string>();
  for (const [k, ids] of groups) if (ids.length > 1) for (const id of ids) out.set(id, k);
  groups.clear();
  for (const e of usable) if (!out.has(e.id) && e.style!.startsWith('solid')) add(`in|${e.to.node}|${e.to.rowY ?? ''}|${sides.get(e.id)![1]}|${e.style}`, e.id);
  for (const [k, ids] of groups) if (ids.length > 1) for (const id of ids) out.set(id, k);
  return out;
}

function span(e: RouteRequest): number {
  const a = centre(e.from.box);
  const b = centre(e.to.box);
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

const centre = (b: Box): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

// ---------------------------------------------------------------- sides and ports

/**
 * Pick the sides each line leaves and enters by trying the plausible combinations (sides that face
 * the other end) on an empty grid and keeping the cheapest. The layout direction gets a small
 * preference, so most lines still run left to right.
 */
function chooseSides(input: RouterInput): Map<string, [Side, Side]> {
  const out = new Map<string, [Side, Side]>();
  const options = new Map<string, [Side, Side][]>();
  for (const e of input.edges) options.set(e.id, candidates(e));

  // A grid with the stub ends of every candidate side, at the side's centre.
  const probe = new Map<string, Ports>();
  const points: Point[] = [];
  for (const e of input.edges)
    for (const [f, t] of options.get(e.id)!) {
      const p = centrePorts(e, f, t);
      probe.set(`${e.id}|${f}${t}`, p);
      points.push(p.start, p.goal);
    }
  const grid = buildGrid(input, points);
  const across = input.direction === 'right' ? ['N', 'S'] : ['E', 'W'];
  for (const e of input.edges) {
    const list = options.get(e.id)!;
    if (list.length === 1 || e.from.node === e.to.node) {
      out.set(e.id, list[0]!);
      continue;
    }
    let best = list[0]!;
    let bestCost = Infinity;
    for (const pair of list) {
      const found = search(grid, probe.get(`${e.id}|${pair[0]}${pair[1]}`)!);
      if (!found) continue;
      const cost = found.cost + pair.filter((x) => across.includes(x)).length * 25;
      if (cost < bestCost) [best, bestCost] = [pair, cost];
    }
    out.set(e.id, best);
  }
  return out;
}

function candidates(e: RouteRequest): [Side, Side][] {
  const a = e.from.box;
  const b = e.to.box;
  if (e.from.node === e.to.node) return [['E', 'E']];
  const ca = centre(a);
  const cb = centre(b);
  if (e.from.rowY != null || e.to.rowY != null) {
    // Rows attach left or right only.
    const right = cb.x >= ca.x;
    return right ? [['E', 'W'], ['E', 'E'], ['W', 'W']] : [['W', 'E'], ['W', 'W'], ['E', 'E']];
  }
  const facing = (box: Box, other: Point): Side[] => {
    const s: Side[] = [];
    if (other.x > box.x + box.width) s.push('E');
    if (other.x < box.x) s.push('W');
    if (other.y > box.y + box.height) s.push('S');
    if (other.y < box.y) s.push('N');
    return s;
  };
  const fs = facing(a, cb);
  const ts = facing(b, ca);
  const pairs: [Side, Side][] = [];
  for (const f of fs) for (const t of ts) pairs.push([f, t]);
  if (!pairs.length) {
    // Overlapping boxes (rare): fall back to the dominant axis.
    const dx = cb.x - ca.x;
    const dy = cb.y - ca.y;
    return Math.abs(dx) >= Math.abs(dy) ? [dx >= 0 ? ['E', 'W'] : ['W', 'E']] : [dy >= 0 ? ['S', 'N'] : ['N', 'S']];
  }
  return pairs;
}

function centrePorts(e: RouteRequest, f: Side, t: Side): Ports {
  const at = (r: RouteEnd, side: Side): Point => {
    const b = r.box;
    if (r.rowY != null) return { x: side === 'E' ? b.x + b.width : b.x, y: b.y + r.rowY };
    return side === 'E' ? { x: b.x + b.width, y: b.y + b.height / 2 }
      : side === 'W' ? { x: b.x, y: b.y + b.height / 2 }
      : side === 'N' ? { x: b.x + b.width / 2, y: b.y }
      : { x: b.x + b.width / 2, y: b.y + b.height };
  };
  const from = at(e.from, f);
  const to = at(e.to, t);
  const out1 = (p: Point, side: Side, len: number) => ({ x: p.x + normal[side].x * len, y: p.y + normal[side].y * len });
  return { from, to, fromSide: f, toSide: t, start: out1(from, f, e.from.stub), goal: out1(to, t, e.to.stub) };
}

interface Ports {
  from: Point;
  to: Point;
  fromSide: Side;
  toSide: Side;
  /** First and last grid points: the end of each stub. */
  start: Point;
  goal: Point;
}

function placePorts(input: RouterInput, sides: Map<string, [Side, Side]>, trunk: Map<string, string>): Map<string, Ports> {
  // Collect, per node side, the edges that attach there and where their other end is. Siblings
  // sharing a trunk take one slot together, aimed at the middle of their other ends.
  type Slot = { edge: RouteRequest; end: 'from' | 'to'; other: Point };
  const slots = new Map<string, Slot[]>();
  const shared = new Map<string, string>();
  const firstOf = new Map<string, Slot>();
  const spread = new Map<Slot, Point[]>();
  for (const e of input.edges) {
    const [sf, st] = sides.get(e.id)!;
    for (const [end, side, other] of [
      ['from', sf, centre(e.to.box)],
      ['to', st, centre(e.from.box)],
    ] as const) {
      if (e[end].rowY != null) continue;
      const t = trunk.get(e.id);
      const sharedEnd = t && t.startsWith(end === 'from' ? 'out|' : 'in|');
      const first = sharedEnd ? firstOf.get(t) : undefined;
      if (first) {
        shared.set(`${e.id}:${end}`, `${first.edge.id}:${end}`);
        spread.get(first)!.push(other);
        continue;
      }
      const key = `${e[end].node}:${side}`;
      const slot = { edge: e, end, other };
      if (sharedEnd) firstOf.set(t, slot), spread.set(slot, [other]);
      slots.set(key, [...(slots.get(key) ?? []), slot]);
    }
  }
  for (const [slot, list] of spread) slot.other = { x: list.reduce((s, p) => s + p.x, 0) / list.length, y: list.reduce((s, p) => s + p.y, 0) / list.length };
  const pos = new Map<string, Point>();
  for (const [key, list] of slots) {
    const side = key.slice(key.lastIndexOf(':') + 1) as Side;
    const box = list[0]!.edge[list[0]!.end].box;
    const along = side === 'E' || side === 'W';
    // Order by angle from the box: the line that turns away earliest leaves outermost, so lines
    // leaving one side do not cross each other.
    const c = centre(box);
    const n = normal[side];
    const angle = (o: Point) => Math.atan2(along ? o.y - c.y : o.x - c.x, Math.max(1, (o.x - c.x) * n.x + (o.y - c.y) * n.y));
    list.sort((p, q) => angle(p.other) - angle(q.other));
    const length = along ? box.height : box.width;
    const room = length - 24;
    const step = Math.min(28, room / Math.max(1, list.length));
    const first = (length - step * (list.length - 1)) / 2;
    list.forEach((s, i) => {
      const t = first + i * step;
      const p =
        side === 'E' ? { x: box.x + box.width, y: box.y + t }
        : side === 'W' ? { x: box.x, y: box.y + t }
        : side === 'N' ? { x: box.x + t, y: box.y }
        : { x: box.x + t, y: box.y + box.height };
      pos.set(`${s.edge.id}:${s.end}`, p);
    });
  }
  for (const [member, first] of shared) pos.set(member, pos.get(first)!);

  // Straighten: a port that is alone on its side moves in line with the other end, when that
  // still lands on its side, so the line needs no jog.
  const count = (node: string, side: Side) => slots.get(`${node}:${side}`)?.length ?? 0;
  for (const e of input.edges) {
    const [sf, st] = sides.get(e.id)!;
    if (sf !== opposite[st] || e.from.node === e.to.node) continue;
    const along = sf === 'E' || sf === 'W' ? 'y' : 'x';
    const isShared = (end: 'from' | 'to') => shared.has(`${e.id}:${end}`) || [...shared.values()].includes(`${e.id}:${end}`);
    const fixed = (end: 'from' | 'to', side: Side) =>
      e[end].rowY != null ? e[end].box.y + e[end].rowY! : count(e[end].node, side) > 1 || isShared(end) ? pos.get(`${e.id}:${end}`)![along] : undefined;
    const range = (r: RouteEnd) => (along === 'y' ? [r.box.y + 12, r.box.y + r.box.height - 12] : [r.box.x + 12, r.box.x + r.box.width - 12]) as [number, number];
    const ff = fixed('from', sf);
    const tf = fixed('to', st);
    const set = (end: 'from' | 'to', v: number) => {
      const [lo, hi] = range(e[end]);
      if (v >= lo && v <= hi) pos.set(`${e.id}:${end}`, { ...pos.get(`${e.id}:${end}`)!, [along]: v });
    };
    if (ff == null && tf != null) set('from', tf);
    else if (tf == null && ff != null) set('to', ff);
    else if (ff == null && tf == null) {
      // Both free: meet in the middle of the overlap, if there is one.
      const [a0, a1] = range(e.from);
      const [b0, b1] = range(e.to);
      const lo = Math.max(a0, b0);
      const hi = Math.min(a1, b1);
      if (hi >= lo) {
        const ca = pos.get(`${e.id}:from`)![along];
        const v = Math.min(hi, Math.max(lo, ca));
        set('from', v);
        set('to', v);
      }
    }
  }

  const out = new Map<string, Ports>();
  for (const e of input.edges) {
    const [fromSide, toSide] = sides.get(e.id)!;
    const at = (end: 'from' | 'to', side: Side): Point => {
      const r = e[end];
      if (r.rowY != null) return { x: side === 'E' ? r.box.x + r.box.width : r.box.x, y: r.box.y + r.rowY };
      return pos.get(`${e.id}:${end}`)!;
    };
    const from = at('from', fromSide);
    const to = at('to', toSide);
    const out1 = (p: Point, side: Side, len: number) => ({ x: p.x + normal[side].x * len, y: p.y + normal[side].y * len });
    out.set(e.id, { from, to, fromSide, toSide, start: out1(from, fromSide, e.from.stub), goal: out1(to, toSide, e.to.stub) });
  }
  return out;
}

// ---------------------------------------------------------------- grid

/**
 * Routing grid. Everything the search needs per step is precomputed per grid edge, so a step is a
 * few array lookups: whether it is blocked, what running through a group header costs, and how
 * many routed lines already use it. Edge index: horizontal (x→x+1, y) and vertical (x, y→y+1)
 * both live at y * W + x in their own array.
 */
interface Grid {
  xs: number[];
  ys: number[];
  W: number;
  H: number;
  xi: Map<number, number>;
  yi: Map<number, number>;
  hBlocked: Uint8Array;
  vBlocked: Uint8Array;
  hSoft: Float32Array;
  vSoft: Float32Array;
  hUsed: Uint16Array;
  vUsed: Uint16Array;
  /** Usage by siblings of the line being routed (a subset of hUsed/vUsed). */
  hFriend: Uint16Array;
  vFriend: Uint16Array;
  // Search buffers, reused: an entry is valid only when its stamp equals the current search.
  cost: Float64Array;
  prev: Int32Array;
  stamp: Uint32Array;
  generation: number;
}

function buildGrid(input: RouterInput, points: Point[]): Grid {
  const boxes = [...input.obstacles.values()];
  const xset = new Set<number>();
  const yset = new Set<number>();
  for (const b of boxes) {
    xset.add(b.x - MARGIN).add(b.x + b.width + MARGIN);
    yset.add(b.y - MARGIN).add(b.y + b.height + MARGIN);
  }
  for (const p of points) {
    xset.add(p.x);
    yset.add(p.y);
  }
  // Channel centres between neighbouring coordinates, with parallel lanes either side.
  const addChannels = (set: Set<number>) => {
    const sorted = [...set].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i]! - sorted[i - 1]!;
      if (gap < 2 * LANE) continue;
      const mid = (sorted[i]! + sorted[i - 1]!) / 2;
      set.add(mid);
      for (let k = 1; k <= 3 && gap > 2 * (k + 1) * LANE; k++) set.add(mid - k * LANE).add(mid + k * LANE);
    }
    // Room to go around everything.
    const lo = sorted[0] ?? 0;
    const hi = sorted[sorted.length - 1] ?? 0;
    set.add(lo - 2 * MARGIN).add(hi + 2 * MARGIN);
  };
  addChannels(xset);
  addChannels(yset);
  const xs = [...xset].sort((a, b) => a - b);
  const ys = [...yset].sort((a, b) => a - b);
  const W = xs.length;
  const H = ys.length;
  const n = W * H;
  const g: Grid = {
    xs,
    ys,
    W,
    H,
    xi: new Map(xs.map((x, i) => [x, i])),
    yi: new Map(ys.map((y, i) => [y, i])),
    hBlocked: new Uint8Array(n),
    vBlocked: new Uint8Array(n),
    hSoft: new Float32Array(n),
    vSoft: new Float32Array(n),
    hUsed: new Uint16Array(n),
    vUsed: new Uint16Array(n),
    hFriend: new Uint16Array(n),
    vFriend: new Uint16Array(n),
    cost: new Float64Array(n * 4),
    prev: new Int32Array(n * 4),
    stamp: new Uint32Array(n * 4),
    generation: 0,
  };

  // Boxes, grown by the margin (minus a pixel, so lines may run exactly along the margin).
  for (const b of boxes) {
    const x0 = b.x - MARGIN + 1;
    const x1 = b.x + b.width + MARGIN - 1;
    const y0 = b.y - MARGIN + 1;
    const y1 = b.y + b.height + MARGIN - 1;
    for (let y = lowerBound(ys, y0); y < H && ys[y]! < y1; y++)
      for (let x = Math.max(0, lowerBound(xs, x0) - 1); x < W - 1 && xs[x]! < x1; x++) if (xs[x + 1]! > x0) g.hBlocked[y * W + x] = 1;
    for (let x = lowerBound(xs, x0); x < W && xs[x]! < x1; x++)
      for (let y = Math.max(0, lowerBound(ys, y0) - 1); y < H - 1 && ys[y]! < y1; y++) if (ys[y + 1]! > y0) g.vBlocked[y * W + x] = 1;
  }
  // Group headers: allowed, but every pixel inside one costs.
  for (const r of input.soft) {
    const rx1 = r.x + r.width;
    const ry1 = r.y + r.height;
    const cost = SOFT * (r.weight ?? 1);
    for (let y = lowerBound(ys, r.y); y < H && ys[y]! <= ry1; y++)
      for (let x = Math.max(0, lowerBound(xs, r.x) - 1); x < W - 1 && xs[x]! < rx1; x++)
        g.hSoft[y * W + x] = g.hSoft[y * W + x]! + cost * Math.max(0, Math.min(xs[x + 1]!, rx1) - Math.max(xs[x]!, r.x));
    for (let x = lowerBound(xs, r.x); x < W && xs[x]! <= rx1; x++)
      for (let y = Math.max(0, lowerBound(ys, r.y) - 1); y < H - 1 && ys[y]! < ry1; y++)
        g.vSoft[y * W + x] = g.vSoft[y * W + x]! + cost * Math.max(0, Math.min(ys[y + 1]!, ry1) - Math.max(ys[y]!, r.y));
  }
  return g;
}

/** First index whose value is >= v. */
function lowerBound(a: number[], v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Add (+1) or remove (-1) a routed line's grid path from the usage counts. */
function mark(g: Grid, cells: number[], delta: 1 | -1, friend = false) {
  const h = friend ? g.hFriend : g.hUsed;
  const v = friend ? g.vFriend : g.vUsed;
  for (let i = 2; i < cells.length; i += 2) {
    const ax = cells[i - 2]!;
    const ay = cells[i - 1]!;
    const bx = cells[i]!;
    const by = cells[i + 1]!;
    if (ay === by) for (let x = Math.min(ax, bx); x < Math.max(ax, bx); x++) h[ay * g.W + x] = h[ay * g.W + x]! + delta;
    else for (let y = Math.min(ay, by); y < Math.max(ay, by); y++) v[y * g.W + ax] = v[y * g.W + ax]! + delta;
  }
}

// ---------------------------------------------------------------- search

type Dir = 0 | 1 | 2 | 3; // E S W N
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const sideDir: Record<Side, Dir> = { E: 0, S: 1, W: 2, N: 3 };

interface Found {
  points: Point[];
  /** Grid path as x, y index pairs, for usage counting. */
  cells: number[];
  cost: number;
}

function search(g: Grid, p: Ports): Found | undefined {
  const { xs, ys, W, H } = g;
  const sx = g.xi.get(p.start.x);
  const sy = g.yi.get(p.start.y);
  const gx = g.xi.get(p.goal.x);
  const gy = g.yi.get(p.goal.y);
  if (sx == null || sy == null || gx == null || gy == null) return undefined;

  const gen = ++g.generation;
  const { cost, prev, stamp } = g;
  const startDir = sideDir[p.fromSide];
  const goalDir = sideDir[opposite[p.toSide]];
  const tx = xs[gx]!;
  const ty = ys[gy]!;
  const heap = new Heap();

  const s = (sy * W + sx) * 4 + startDir;
  stamp[s] = gen;
  cost[s] = 0;
  prev[s] = -1;
  heap.push(s, Math.abs(xs[sx]! - tx) + Math.abs(ys[sy]! - ty));

  while (heap.size) {
    const k = heap.pop();
    const d = k & 3;
    const cell = k >> 2;
    const x = cell % W;
    const y = (cell - x) / W;
    if (x === gx && y === gy && d === goalDir) return unwind(g, k, p, cost[k]!);
    const base = cost[k]!;
    for (let nd = 0; nd < 4; nd++) {
      if (nd === ((d + 2) & 3)) continue; // no U-turns
      const nx: number = x + DX[nd]!;
      const ny: number = y + DY[nd]!;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      let c = base + (nd === d ? 0 : BEND);
      if (ny === y) {
        const e = y * W + Math.min(x, nx);
        if (g.hBlocked[e]) continue;
        const len = Math.abs(xs[nx]! - xs[x]!);
        const f = g.hFriend[e]!;
        c += (f ? len * SHARE : len) + g.hSoft[e]! + OVERLAP * len * (g.hUsed[e]! - f);
        // Crossing a vertical line that runs straight through the point we step onto.
        if (ny > 0 && ny < H - 1 && g.vUsed[(ny - 1) * W + nx]! && g.vUsed[ny * W + nx]!) c += CROSS;
      } else {
        const e = Math.min(y, ny) * W + x;
        if (g.vBlocked[e]) continue;
        const len = Math.abs(ys[ny]! - ys[y]!);
        const f = g.vFriend[e]!;
        c += (f ? len * SHARE : len) + g.vSoft[e]! + OVERLAP * len * (g.vUsed[e]! - f);
        if (nx > 0 && nx < W - 1 && g.hUsed[ny * W + nx - 1]! && g.hUsed[ny * W + nx]!) c += CROSS;
      }
      // Arriving at the goal in the wrong heading costs a bend.
      if (nx === gx && ny === gy && nd !== goalDir) c += BEND * 2;
      const nk = (ny * W + nx) * 4 + nd;
      if (stamp[nk] !== gen || c < cost[nk]!) {
        stamp[nk] = gen;
        cost[nk] = c;
        prev[nk] = k;
        heap.push(nk, c + Math.abs(xs[nx]! - tx) + Math.abs(ys[ny]! - ty));
      }
    }
  }
  return undefined;
}

function unwind(g: Grid, k: number, p: Ports, total: number): Found {
  const cells: number[] = [];
  for (let c = k; c >= 0; c = g.prev[c]!) {
    const cell = c >> 2;
    const x = cell % g.W;
    cells.push((cell - x) / g.W, x);
  }
  cells.reverse(); // now x, y pairs from start to goal
  const pts: Point[] = [];
  for (let i = 0; i < cells.length; i += 2) pts.push({ x: g.xs[cells[i]!]!, y: g.ys[cells[i + 1]!]! });
  return { points: [p.from, ...pts, p.to], cells, cost: total };
}

class Heap {
  private keys: number[] = [];
  private pri: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(k: number, p: number) {
    const ks = this.keys;
    const ps = this.pri;
    let i = ks.length;
    ks.push(k);
    ps.push(p);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (ps[up]! <= p) break;
      ks[i] = ks[up]!;
      ps[i] = ps[up]!;
      i = up;
    }
    ks[i] = k;
    ps[i] = p;
  }
  pop(): number {
    const ks = this.keys;
    const ps = this.pri;
    const top = ks[0]!;
    const k = ks.pop()!;
    const p = ps.pop()!;
    if (ks.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= ks.length) break;
        const r = l + 1;
        const c = r < ks.length && ps[r]! < ps[l]! ? r : l;
        if (ps[c]! >= p) break;
        ks[i] = ks[c]!;
        ps[i] = ps[c]!;
        i = c;
      }
      ks[i] = k;
      ps[i] = p;
    }
    return top;
  }
}

// ---------------------------------------------------------------- helpers

function selfLoop(p: Ports): Point[] {
  const x = Math.max(p.start.x, p.goal.x) + 14;
  return [p.from, { x, y: p.from.y }, { x, y: p.to.y }, p.to];
}

function fallback(p: Ports): Point[] {
  const mx = (p.start.x + p.goal.x) / 2;
  return [p.from, p.start, { x: mx, y: p.start.y }, { x: mx, y: p.goal.y }, p.goal, p.to];
}

/** Drop duplicate and collinear points. */
export function simplify(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    const before = out[out.length - 2];
    if (before && last && ((before.x === last.x && last.x === p.x) || (before.y === last.y && last.y === p.y))) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------- labels

/** Puts each label on its line where it covers nothing; returns how many could not avoid covering something. */
function placeLabels(input: RouterInput, routes: Map<string, PlacedEdge>): number {
  let bad = 0;
  const taken: Box[] = [...input.obstacles.values()].map((b) => ({ x: b.x - 4, y: b.y - 4, width: b.width + 8, height: b.height + 8 }));
  taken.push(...input.soft);
  // Every line, tagged with its edge: a label may sit on its own line but not on another.
  const lines: { edge: string; box: Box }[] = [];
  for (const [id, r] of routes) for (let i = 1; i < r.points.length; i++) lines.push({ edge: id, box: segmentBox(r.points[i - 1]!, r.points[i]!) });
  const overlap = (r: Box, t: Box) => r.x < t.x + t.width && t.x < r.x + r.width && r.y < t.y + t.height && t.y < r.y + r.height;
  let current = '';
  const hits = (r: Box) => taken.some((t) => overlap(r, t)) || lines.some((l) => l.edge !== current && overlap(r, l.box));
  for (const e of input.edges) {
    current = e.id;
    const route = routes.get(e.id);
    if (!e.label || !route) continue;
    const { width, height } = e.label;
    const pts = route.points;
    const candidates: { box: Box; score: number }[] = [];
    const total = pts.length - 1;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const horizontal = a.y === b.y;
      const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      const middle = Math.abs(i - 0.5 - total / 2);
      for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const c = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        // On the line: prefer horizontal, long, central segments.
        if (len >= (horizontal ? width + 16 : height + 16)) {
          const box = { x: c.x - width / 2, y: c.y - height / 2, width, height };
          candidates.push({ box, score: (horizontal ? 0 : 60) + middle * 10 + Math.abs(t - 0.5) * 40 - Math.min(len, 300) * 0.1 + (hits(box) ? 1000 : 0) });
        }
        // Beside a vertical line, when it is too short or crowded for a pill on it.
        if (!horizontal && len >= height + 8)
          for (const side of [1, -1]) {
            const x = side > 0 ? c.x + 6 : c.x - 6 - width;
            const box = { x, y: c.y - height / 2, width, height };
            candidates.push({ box, score: 90 + middle * 10 + Math.abs(t - 0.5) * 40 + (side < 0 ? 5 : 0) + (hits(box) ? 1000 : 0) });
          }
      }
    }
    candidates.sort((p, q) => p.score - q.score);
    if (!candidates[0] || candidates[0].score >= 500) bad++;
    const best = candidates[0]?.box ?? midLabel(pts, width, height);
    route.label = best;
    taken.push(best);
  }
  return bad;
}

function segmentBox(a: Point, b: Point): Box {
  return { x: Math.min(a.x, b.x) - 1, y: Math.min(a.y, b.y) - 1, width: Math.abs(b.x - a.x) + 2, height: Math.abs(b.y - a.y) + 2 };
}

function midLabel(pts: Point[], width: number, height: number): Box {
  let best = 0;
  let at = pts[0]!;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.abs(pts[i]!.x - pts[i - 1]!.x) + Math.abs(pts[i]!.y - pts[i - 1]!.y);
    if (len > best) {
      best = len;
      at = { x: (pts[i]!.x + pts[i - 1]!.x) / 2, y: (pts[i]!.y + pts[i - 1]!.y) / 2 };
    }
  }
  return { x: at.x - width / 2, y: at.y - height / 2, width, height };
}
