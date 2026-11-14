// Nudging: the step after routing that every serious orthogonal router has (libavoid, MSAGL).
// A* leaves lines on a few fixed lanes, so lines sharing a corridor end up packed, unevenly spaced
// or on top of each other. Here every straight piece may slide sideways within the room it has
// (never into a box, a header or across a group border, never so far that a neighbouring piece
// flips direction), pieces sharing a corridor keep their order, so no new crossings appear, and
// bundles are spread evenly. Line ends slide along their node side the same way, which spreads
// crowded ports. Shared trunks (siblings drawn as one line) move as one.
import type { Box, Point } from '@linework/core';

export interface NudgeEdge {
  id: string;
  points: Point[];
  /** Node boxes at both ends, for sliding ends along their side. */
  fromBox: Box;
  toBox: Box;
  /** Minimum straight piece at each end (room for the marker). */
  fromStub: number;
  toStub: number;
  /** Ends that may not slide (table rows). */
  fromFixed?: boolean;
  toFixed?: boolean;
  /** Leave this line exactly as it is (self loops, fallbacks), but keep others clear of it. */
  fixed?: boolean;
  /** Edges with the same trunk key may lie exactly on top of each other: they are one line there. */
  trunk?: string;
}

export interface NudgeInput {
  obstacles: Box[];
  /** Areas lines should stay out of unless they already cross them (headers, group borders). */
  zones: Box[];
  edges: NudgeEdge[];
}

/** Gap between neighbouring lines in a bundle, unless they already had more room. */
const IDEAL = 14;
/** Most a bundle is spread: wider gaps stop reading as one bundle. */
const WIDEST = 24;
/** Lines closer than this, running side by side, form a bundle. */
const BUNDLE = 30;
/** Clearance from boxes: the router's margin. */
const MARGIN = 14;
/** Two lines on one track with less than this between their ends read as one line. */
const GAP_END = 2 * IDEAL;
/** Keep line ends this far from a node's corners. */
const CORNER = 10;

interface Unit {
  /** Segments (edge index, segment index) that move together. */
  segs: [number, number][];
  at: number;
  lo: number;
  hi: number;
  min: number;
  max: number;
  /** Where the line turns at the lo and hi end: -1 towards smaller, +1 towards larger, 0 an end. */
  loTurn: number;
  hiTurn: number;
  key: string;
}

export function nudge(input: NudgeInput): Point[][] {
  const routes = input.edges.map((e) => e.points.map((p) => ({ ...p })));
  for (const vertical of [true, false, true]) pass(input, routes, vertical);
  return routes.map(clean);
}

function pass(input: NudgeInput, routes: Point[][], vertical: boolean) {
  // Along a vertical piece y varies and x is what moves; the other way round for horizontal ones.
  const A = vertical ? 'x' : 'y';
  const L = vertical ? 'y' : 'x';
  const units: Unit[] = [];
  for (const [ei, pts] of routes.entries()) {
    const e = input.edges[ei]!;
    const last = pts.length - 2;
    for (let k = 0; k <= last; k++) {
      const a = pts[k]!;
      const b = pts[k + 1]!;
      if (a[A] !== b[A] || a[L] === b[L]) continue;
      const lo = Math.min(a[L], b[L]);
      const hi = Math.max(a[L], b[L]);
      let min = -Infinity;
      let max = Infinity;
      const at = a[A];
      // Line ends slide along their side, clear of the corners; table rows do not slide.
      const endBox = (box: Box, fixed?: boolean) => {
        if (fixed) [min, max] = [Math.max(min, at), Math.min(max, at)];
        else {
          const s = vertical ? [box.x, box.x + box.width] : [box.y, box.y + box.height];
          min = Math.max(min, s[0]! + CORNER);
          max = Math.min(max, s[1]! - CORNER);
        }
      };
      if (k === 0) endBox(e.fromBox, e.fromFixed);
      if (k === last) endBox(e.toBox, e.toFixed);
      // Neighbouring pieces may shrink but not flip, and stubs keep their length.
      const turn = (j: number, other: Point | undefined) => {
        if (!other) return 0;
        const need = j === 0 ? e.fromStub : j === last ? e.toStub : 6;
        if (other[A] < at) min = Math.max(min, other[A] + need);
        else max = Math.min(max, other[A] - need);
        return Math.sign(other[A] - at);
      };
      const before = k > 0 ? turn(k - 1, pts[k - 1]) : 0;
      const after = k < last ? turn(k + 1, pts[k + 2]) : 0;
      const loTurn = a[L] < b[L] ? before : after;
      const hiTurn = a[L] < b[L] ? after : before;
      // Boxes and zones beside the piece bound it. Its own end boxes are left out for end pieces.
      const own = [k === 0 ? e.fromBox : undefined, k === last ? e.toBox : undefined];
      const bound = (r: Box, grow: number) => {
        const r0 = (vertical ? r.x : r.y) - grow;
        const r1 = (vertical ? r.x + r.width : r.y + r.height) + grow;
        const l0 = (vertical ? r.y : r.x) - grow;
        const l1 = (vertical ? r.y + r.height : r.x + r.width) + grow;
        if (!(lo < l1 && hi > l0)) return;
        if (r1 <= at + 0.5) min = Math.max(min, r1);
        else if (r0 >= at - 0.5) max = Math.min(max, r0);
        else if (grow === 0) return; // already crossing a zone: it may stay there
        else [min, max] = [Math.max(min, at), Math.min(max, at)]; // inside a box's margin: leave it
      };
      for (const r of input.obstacles) if (!own.includes(r)) bound(r, MARGIN - 1);
      for (const r of input.zones) bound(r, 0);
      if (e.fixed) [min, max] = [at, at];
      if (min > at) min = at;
      if (max < at) max = at;
      units.push({ segs: [[ei, k]], at, lo, hi, min, max, loTurn, hiTurn, key: `${e.id}:${k}` });
    }
  }
  if (!units.length) return;

  // Trunk siblings on top of each other move as one.
  const merged: Unit[] = [];
  for (const u of units) {
    const t = input.edges[u.segs[0]![0]]!.trunk;
    const same = t && merged.find((m) => input.edges[m.segs[0]![0]]!.trunk === t && Math.abs(m.at - u.at) < 0.5 && Math.min(m.hi, u.hi) - Math.max(m.lo, u.lo) >= 0);
    if (!same) {
      merged.push(u);
      continue;
    }
    same.segs.push(...u.segs);
    same.lo = Math.min(same.lo, u.lo);
    same.hi = Math.max(same.hi, u.hi);
    same.min = Math.max(same.min, u.min);
    same.max = Math.min(same.max, u.max);
    if (same.min > same.at) same.min = same.at;
    if (same.max < same.at) same.max = same.at;
  }

  // Order: by position, ties (lines on top of each other) by where they turn off, so they do not cross.
  const order = (p: Unit, q: Unit) => {
    if (Math.abs(p.at - q.at) > 0.5) return p.at - q.at;
    if (p.lo > q.lo + 0.5 && p.loTurn) return p.loTurn;
    if (q.lo > p.lo + 0.5 && q.loTurn) return -q.loTurn;
    if (p.hi < q.hi - 0.5 && p.hiTurn) return p.hiTurn;
    if (q.hi < p.hi - 0.5 && q.hiTurn) return -q.hiTurn;
    return p.loTurn + p.hiTurn - q.loTurn - q.hiTurn || (p.key < q.key ? -1 : 1);
  };
  const us = merged.sort(order);
  const n = us.length;

  // Constraints between pieces that run side by side (or touch end to end) and could swap places.
  const cons: [number, number, number][] = [];
  const near: number[][] = us.map(() => []);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const p = us[i]!;
      const q = us[j]!;
      const overlap = Math.min(p.hi, q.hi) - Math.max(p.lo, q.lo);
      if (overlap < -GAP_END) continue;
      if (Math.max(p.min, q.min) > Math.min(p.max, q.max) && q.at - p.at > IDEAL) continue;
      // Two lines that meet end to end on one track read as one line between their far ends: they
      // keep apart like lines side by side. Lines of one trunk may meet; that is what a trunk is.
      const t = input.edges[p.segs[0]![0]]!.trunk;
      const meet = overlap <= 1 && Math.abs(q.at - p.at) < 0.5 && !(t && t === input.edges[q.segs[0]![0]]!.trunk) && !sharedEnd(routes[p.segs[0]![0]]!, routes[q.segs[0]![0]]!);
      if (overlap < -0.5 && !meet) continue;
      cons.push([i, j, overlap > 1 || meet ? IDEAL : 0]);
      if ((overlap > 1 || meet) && q.at - p.at < BUNDLE) near[i]!.push(j), near[j]!.push(i);
    }

  // Desired positions: lone pieces stay; bundles spread evenly around where they are.
  const want = us.map((u) => u.at);
  const seen = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (seen.has(i) || !near[i]!.length) continue;
    const comp: number[] = [];
    const stack = [i];
    seen.add(i);
    while (stack.length) {
      const c = stack.pop()!;
      comp.push(c);
      for (const d of near[c]!) if (!seen.has(d)) seen.add(d), stack.push(d);
    }
    comp.sort((a, b) => a - b);
    const span = us[comp[comp.length - 1]!]!.at - us[comp[0]!]!.at;
    const gap = Math.min(WIDEST, Math.max(IDEAL, span / (comp.length - 1)));
    const mid = comp.reduce((s, c) => s + us[c]!.at, 0) / comp.length;
    comp.forEach((c, r) => (want[c] = mid + (r - (comp.length - 1) / 2) * gap));
  }

  // Satisfy order, spacing and bounds by repeated projection, starting from the wish.
  const x = us.map((u, i) => clamp(want[i]!, u.min, u.max));
  for (let it = 0; it < 60; it++) {
    let moved = 0;
    for (const [i, j, s] of cons) {
      const v = x[i]! + s - x[j]!;
      if (v <= 1e-6) continue;
      const p = us[i]!;
      const q = us[j]!;
      // Split the move; whatever one side cannot take (its bound), the other takes.
      const down = Math.min(v / 2, x[i]! - p.min);
      const up = Math.min(v - down, q.max - x[j]!);
      const down2 = Math.min(v - up, x[i]! - p.min);
      x[i] = x[i]! - down2;
      x[j] = x[j]! + up;
      moved += down2 + up;
    }
    if (moved < 0.01) break;
  }
  // Order must hold (else lines would cross where they did not); otherwise keep the routes as they were.
  for (const [i, j] of cons) if (x[j]! < x[i]! - 0.5) return;
  for (const [i, u] of us.entries()) {
    const v = Math.round(x[i]! * 2) / 2;
    if (Math.abs(v - u.at) < 0.25) continue;
    for (const [ei, k] of u.segs) {
      const pts = routes[ei]!;
      pts[k]![A] = v;
      pts[k + 1]![A] = v;
    }
  }
}

/** Two lines from (or into) one spot: they meet there anyway. */
function sharedEnd(a: Point[], b: Point[]): boolean {
  const same = (p: Point, q: Point) => Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5;
  return same(a[0]!, b[0]!) || same(a[a.length - 1]!, b[b.length - 1]!);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Drop duplicate and collinear points left behind by moved pieces. */
function clean(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    const before = out[out.length - 2];
    if (before && last && ((before.x === last.x && last.x === p.x) || (before.y === last.y && last.y === p.y))) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}
