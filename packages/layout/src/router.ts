// Orthogonal edge router. Lines avoid boxes and group headers, keep apart from each other,
// prefer the middle of the channel between boxes, and end with a straight stub so arrowheads and
// crow's feet always sit on a straight piece.
//
// Approach: a grid of "interesting" coordinates (box sides plus margin, channel centres with
// parallel lanes, ports), A* over (point, heading) with costs for length, bends, crossing and
// overlapping lines already routed. Ports are spread along each side, ordered by where the other
// end is, so lines do not cross right at the box.
import type { Box, PlacedEdge, Point } from '@linework/core';
import { nudge } from './nudge.ts';

export type Side = 'N' | 'E' | 'S' | 'W';

export interface RouteEnd {
  node: string;
  box: Box;
  /** Fixed attach height (table rows): the line must leave from W or E at this y. */
  rowY?: number;
  /** Straight piece at the end, room for the marker. */
  stub: number;
  /** The innermost group holding the node (for a group, the one holding it): lines share a trunk only to cards that stand together. */
  within?: string;
  /** The mark drawn at this end (arrow, crow's foot): two different marks never share one row's port. */
  mark?: string;
  /** For a group: the boxes it holds directly. A line lands on the group clear of them (see landing). */
  inner?: Box[];
}

export interface RouteRequest {
  id: string;
  from: RouteEnd;
  to: RouteEnd;
  /** The label's box; `aside` of its width is room for end tags, not words (Sized.edgeLabels). */
  label?: { width: number; height: number; aside?: number };
  /** Lower routes first and gets the best paths. */
  order?: number;
  /**
   * How the line is drawn, as "pattern|tone|start mark|end mark|width". Lines drawn alike may share
   * a trunk; without a style a line keeps its own path. A line with a label, tags at its ends (U, D,
   * ACL) or other marks has none, nor has one with crow's feet other than between table rows: on a
   * shared trunk a reader could not tell which line those belong to, and two lines would seem to
   * link their far ends.
   */
  style?: string;
  /** Bends set by hand: the line runs through them in order (corners added where needed), not searched for. */
  via?: Point[];
  /** The groups holding either end, all the way up (an end that is a group counts itself): the line is at home there. */
  home?: string[];
}

/** A group as the router sees it: where it lies and what it lies in. */
export interface RouteGroup {
  id: string;
  box: Box;
  parent?: string;
}

export interface RouterInput {
  /** Boxes lines must not cross (nodes). */
  obstacles: Map<string, Box>;
  /** Areas lines should not run through (group headers). */
  /** Areas lines may cross but should not run in: group headers, group borders. `weight` scales the cost. */
  soft: (Box & { weight?: number })[];
  /** More areas labels keep out of (group borders and headers); lines may run there. */
  labelZones?: Box[];
  /** Text lines must never cross (group header titles): ports slide clear, the search pays dearly. */
  texts?: Box[];
  /** Groups: a line pays for running through one that holds neither of its ends, most in its header. */
  groups?: RouteGroup[];
  /** Height of the header strip at the top of each group. */
  header?: number;
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
// On a large grid, of ways that cost the same so far, the search takes the one furthest along first: a long
// line across the drawing then runs down one way instead of widening every equal one. (A millionth of the
// cost: it decides ties, never the cost found.) A smaller drawing keeps its first way among equals: it is quick.
const TIE_DEEP = 1e-6;
const LARGE_GRID = 20000;
const LABEL_AIR = 6; // a label keeps this far from every other line: nearer, it seems to belong to that one
const LABEL_NEAR = 16; // and keeps this far when it can
const CROWD = 2; // per pixel nearer than that, per line
const STRUCK = 56; // a label wider than this on a vertical line reads as crossed out: beside the line is better
const BEYOND = 1; // per pixel a label reaches past everything else (placeLabels)
const STRUCK_COST = 50; // so much worse a pill like that is than one beside the line (that costs 30 more than one on it)
const PART = 48; // siblings part at least this far from the end they do not share
const SHARE = 0.5; // per pixel of running on a sibling's line: cheaper than a lane of its own
const FLOW = 150; // per end on a side across the flow, for a line into a later layer
const TEXT = 60; // per pixel through header text: a detour of almost any length is cheaper
const FOREIGN = 1; // per pixel inside a group that holds neither end, for each such group around the line
const HEADER = 6; // per pixel more in the header strip of such a group
const ALONG = 3; // per pixel of running along the header strip of a group the line belongs in
const OUTSIDE = 10; // a track this far outside each group border, to go around the group
const MEETS = 30; // a line out of the side another comes in at (see chooseSides)
const SLIDE = 40; // a step aside shorter than this, right out of a card, is taken out by sliding the line's end
const CLEAR = 24; // lines keep this far from the sides of cards they pass: nearer, they seem to come out of them
const RING = 1; // per pixel of running that near a card (not on a sibling's trunk: that one is at home there)
const RUN_ON = 64; // a line starting this near another's end, on its track, reads as that line running on
const RUN_ON_COST = 0.5; // per pixel of such a start a lane aside, twice that on the track
const RUN_ASIDE = 12; // a lane aside: nearer than this
const OVERHANG = 40; // a label hanging over a bend, past the end of its piece
const PORT = 24; // room a line takes on a side: one more fits while the side, clear of its corners, has this much for each line already there (placePorts then spreads them evenly, so two on a short side can sit nearer)
const LABELLED = 28; // and this much for a line with a label
const CRAMMED = 250; // a line onto a side that has no room left for one more port: around the card, or into another side, is better
const MIXED = 4000; // a line onto a table row's side where another line ends in a different mark: around the table is better

const normal: Record<Side, Point> = { N: { x: 0, y: -1 }, E: { x: 1, y: 0 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 } };
const opposite: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' };

export function routeEdges(input: RouterInput): Map<string, PlacedEdge> {
  const strange = strangers(input);
  // Sides chosen with room for every port, and (when that moved a line) without: a line sent round to
  // another side is only worth it when the drawing reads better for it: no more crossings and no more
  // labels that cover something, and fewer of either. The sides were weighed on an empty grid, where
  // a long way round crosses nothing.
  const at = sideGrid(input);
  const roomy = chooseSides(input, strange, true, at);
  if (!roomy.pressed) return routeSides(input, strange, roomy.sides);
  const sides = chooseSides(input, strange, false, at).sides;
  const out = routeSides(input, strange, roomy.sides);
  if ([...sides].every(([id, [f, t]]) => roomy.sides.get(id)![0] === f && roomy.sides.get(id)![1] === t)) return out;
  const plain = routeSides(input, strange, sides);
  const covered = (r: Map<string, PlacedEdge>) => covering.get(r) ?? placeLabels(input, new Map([...r].map(([k, v]) => [k, { points: v.points }])));
  // With the same crossings and covered labels, the one with fewer steps aside (lines squeezed out of a full side) reads better.
  const [a, b] = [[crossings(out), covered(out), steps(out)], [crossings(plain), covered(plain), steps(plain)]] as const;
  return a[0] <= b[0] && a[1] <= b[1] && (a[0] < b[0] || a[1] < b[1] || a[2] < b[2]) ? out : plain;
}

/** A step aside: a piece between two bends shorter than two lanes. */
const STEP = 2 * LANE;
function steps(routes: Map<string, PlacedEdge>): number {
  let n = 0;
  for (const { points: p } of routes.values()) for (let i = 2; i < p.length - 1; i++) if (Math.abs(p[i]!.x - p[i - 1]!.x) + Math.abs(p[i]!.y - p[i - 1]!.y) < STEP) n++;
  return n;
}

function routeSides(input: RouterInput, strange: (e: RouteRequest) => ZoneCost | undefined, sides: Map<string, [Side, Side]>): Map<string, PlacedEdge> {
  const trunk = input.trunks === false ? new Map<string, string>() : trunkGroups(input, sides);
  const ports = placePorts(input, sides, trunk);
  const out = routeWith(input, sides, trunk, ports, strange);
  // Two lines out of (or into) one side that cross each other: their ports were put in the wrong
  // order (the line that turns away first leaves on the inside). So do a line out of a side and one
  // into it. Swapped, and drawn again; kept when that crosses less.
  const swaps = crossedPorts(input, out, sides, trunk);
  if (!swaps.length) return out;
  const swapped = new Map(ports);
  // A port taken over keeps its own stub (an arrowhead's or none), out of the same side.
  const put = (p: Ports, end: End, q: Ports, qend: End): Ports => {
    const point = qend === 'from' ? q.from : q.to;
    const n = normal[end === 'from' ? p.fromSide : p.toSide];
    const [own, tip] = end === 'from' ? [p.from, p.start] : [p.to, p.goal];
    const len = Math.abs(tip.x - own.x) + Math.abs(tip.y - own.y);
    const moved = { x: point.x + n.x * len, y: point.y + n.y * len };
    return end === 'from' ? { ...p, from: point, start: moved } : { ...p, to: point, goal: moved };
  };
  for (const [a, ea, b, eb] of swaps) {
    const [pa, pb] = [swapped.get(a)!, swapped.get(b)!];
    swapped.set(a, put(pa, ea, pb, eb));
    swapped.set(b, put(pb, eb, pa, ea));
  }
  const again = routeWith(input, sides, trunk, swapped, strange);
  return crossings(again) < crossings(out) ? again : out;
}

type End = 'from' | 'to';

/** Pairs of lines with an end each on one node side, on ports of their own, that cross each other: each pair once. */
function crossedPorts(input: RouterInput, routes: Map<string, PlacedEdge>, sides: Map<string, [Side, Side]>, trunk: Map<string, string>): [string, End, string, End][] {
  const out: [string, End, string, End][] = [];
  const used = new Set<string>();
  const list = input.edges.filter((e) => routes.has(e.id) && !e.via?.length && e.from.node !== e.to.node && !trunk.has(e.id));
  const ends: [End, End][] = [['from', 'from'], ['to', 'to'], ['from', 'to'], ['to', 'from']];
  const side = (e: RouteRequest, k: End) => sides.get(e.id)![k === 'from' ? 0 : 1];
  for (const [i, a] of list.entries())
    for (const b of list.slice(i + 1)) {
      if (used.has(a.id) || used.has(b.id)) continue;
      const pair = ends.find(([ka, kb]) => a[ka].node === b[kb].node && a[ka].rowY == null && b[kb].rowY == null && side(a, ka) === side(b, kb));
      if (!pair || !crossEach(routes.get(a.id)!.points, routes.get(b.id)!.points)) continue;
      out.push([a.id, pair[0], b.id, pair[1]]);
      used.add(a.id).add(b.id);
    }
  return out;
}

function bounds(p: Point[]): { x0: number; y0: number; x1: number; y1: number } {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const v of p) [x0, y0, x1, y1] = [Math.min(x0, v.x), Math.min(y0, v.y), Math.max(x1, v.x), Math.max(y1, v.y)];
  return { x0, y0, x1, y1 };
}

function crossEach(p: Point[], q: Point[]): boolean {
  for (let i = 1; i < p.length; i++) for (let j = 1; j < q.length; j++) if (properCross(p[i - 1]!, p[i]!, q[j - 1]!, q[j]!)) return true;
  return false;
}

function crossings(routes: Map<string, PlacedEdge>): number {
  const all = [...routes.values()].map((r) => r.points);
  let n = 0;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) for (let a = 1; a < all[i]!.length; a++) for (let b = 1; b < all[j]!.length; b++) if (properCross(all[i]![a - 1]!, all[i]![a]!, all[j]![b - 1]!, all[j]![b]!)) n++;
  return n;
}

function properCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

function routeWith(input: RouterInput, sides: Map<string, [Side, Side]>, trunk: Map<string, string>, ports: Map<string, Ports>, strange: (e: RouteRequest) => ZoneCost | undefined): Map<string, PlacedEdge> {
  // Lines bent by hand lie where they were put. They go on the grid first (their corners are grid
  // points), so every other line pays for running along one or crossing it, as for any line that
  // is already there: the others go around a hand-bent line instead of over it.
  const bent = new Map<string, Point[]>();
  for (const e of input.edges) if (e.via?.length) bent.set(e.id, throughVia(ports.get(e.id)!, e.via));
  const grid = buildGrid(input, [...[...ports.values()].flatMap((p) => [p.start, p.goal]), ...[...bent.values()].flat()]);
  for (const pts of bent.values()) mark(grid, cellsOf(grid, pts.slice(1, -1)), 1);
  const members = new Map<string, string[]>();
  for (const [id, t] of trunk) members.set(t, [...(members.get(t) ?? []), id]);
  const used = new Map<string, number[]>();
  const out = new Map<string, PlacedEdge>();
  const loose = new Set<string>();

  const order = [...input.edges].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || span(a) - span(b));
  // First pass routes against what is already there; later passes re-route every line knowing
  // all the others (rip-up and re-route), which removes most needless crossings. A pass that finds
  // every line where it was finds the same again: the next one would too, so routing stops there.
  for (let pass = 0, settled = false; pass < PASSES && !settled; pass++) {
    settled = pass > 0;
    for (const e of order) {
      const p = ports.get(e.id)!;
      const previous = used.get(e.id);
      if (previous) mark(grid, previous, -1);
      let points: Point[];
      loose.delete(e.id);
      if (bent.has(e.id)) points = bent.get(e.id)!;
      else if (e.from.node === e.to.node) points = selfLoop(p);
      else {
        // Siblings' lines are cheap to run on, so the lines merge into one trunk.
        // Lines into one end do not join a sibling near where it starts, though: there the join would
        // seem to end in the sibling's own mark (a crow's foot), as if one line had two.
        const key = trunk.get(e.id) ?? '';
        const marked = key.startsWith('in|') && (e.style?.split('|')[2] ?? 'none') !== 'none';
        const mates = (members.get(key) ?? []).filter((id) => id !== e.id).map((id) => used.get(id)).filter((c): c is number[] => !!c);
        const friends = mates.map((c) => (marked ? trim(grid, c, PART, true) : c));
        // Running on from a sibling is what a trunk does.
        for (const c of mates) markRunOn(grid, c, -1);
        for (const c of friends) mark(grid, c, 1, true);
        const found = search(grid, p, strange(e), SHARE, Infinity, [e.from.node, e.to.node]);
        for (const c of friends) mark(grid, c, -1, true);
        for (const c of mates) markRunOn(grid, c, 1);
        if (found) {
          mark(grid, found.cells, 1);
          used.set(e.id, found.cells);
        }
        if (!found || !previous || !sameCells(previous, found.cells)) settled = false;
        points = found?.points ?? fallback(p);
        if (found) loose.add(e.id);
      }
      out.set(e.id, { points: unloop(simplify(points)) });
    }
  }
  slideEnds(input, out, sides, trunk, loose);
  untangleEnds(input, out, sides, trunk, loose);
  if (input.nudge !== false) {
    const list = input.edges.filter((e) => out.has(e.id));
    const moved = nudge({
      obstacles: [...input.obstacles.values()],
      // Header titles too: spreading must not push a line onto a group's name.
      zones: [...input.soft, ...(input.texts ?? [])],
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
    const unspread = new Map([...out].map(([k, v]) => [k, { points: v.points } as PlacedEdge]));
    const before = placeLabels(input, unspread);
    const after = placeLabels(input, nudged);
    if (after <= before) return labelled(nudged, after);
    // Not spread: the labels as they were just placed on the same lines.
    for (const [k, v] of unspread) if (v.label) out.get(k)!.label = v.label;
    return labelled(out, before);
  }
  return labelled(out, placeLabels(input, out));
}

function sameCells(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** How many labels of a routing could not avoid covering something (placeLabels), as found when it was routed. */
const covering = new WeakMap<Map<string, PlacedEdge>, number>();
function labelled(routes: Map<string, PlacedEdge>, bad: number): Map<string, PlacedEdge> {
  covering.set(routes, bad);
  return routes;
}

/**
 * A line that leaves its card, steps a little aside and runs on the way it was going has its end
 * in the wrong spot: the end slides along the side to where the line runs, when that spot is on
 * the side, a lane away from the other ends there, and the way to it is free. The lines of a trunk
 * that share the end slide together, or not at all.
 */
function slideEnds(input: RouterInput, routes: Map<string, PlacedEdge>, sides: Map<string, [Side, Side]>, trunk: Map<string, string>, free: Set<string>) {
  const walls = [...input.obstacles].map(([id, b]) => ({ id, box: grow(b, MARGIN - 1) })).concat((input.texts ?? []).map((b) => ({ id: '', box: grow(b, 8) })));
  const overlap = (r: Box, t: Box) => r.x < t.x + t.width && t.x < r.x + r.width && r.y < t.y + t.height && t.y < r.y + r.height;
  const same = (p: Point, q: Point) => p.x === q.x && p.y === q.y;
  for (const e of input.edges)
    for (const end of ['from', 'to'] as const) {
      const from = (id: string) => (end === 'from' ? routes.get(id)!.points : [...routes.get(id)!.points].reverse());
      const [p0, p1, p2, p3] = from(e.id);
      if (!p0 || !p1 || !p2 || !p3 || e[end].rowY != null) continue;
      const shared = trunk.get(e.id)?.startsWith(end === 'from' ? 'out|' : 'in|');
      const mates = shared ? input.edges.filter((m) => trunk.get(m.id) === trunk.get(e.id)).map((m) => m.id) : [e.id];
      const side = sides.get(e.id)![end === 'from' ? 0 : 1];
      const along = side === 'N' || side === 'S' ? 'x' : 'y';
      const across = along === 'x' ? 'y' : 'x';
      // Out of the side, a short step along it, and on in the direction it left in: for every line on this end.
      if (p0[along] !== p1[along] || p1[across] !== p2[across] || Math.abs(p2[along] - p1[along]) >= SLIDE) continue;
      const on = (id: string) => {
        const [q0, q1, q2, q3] = from(id);
        return free.has(id) && q3 && same(q0!, p0) && same(q1!, p1) && same(q2!, p2) && q2![along] === q3[along] && Math.sign(p1[across] - p0[across]) === Math.sign(q3[across] - q2![across]);
      };
      if (!mates.every(on)) continue;
      const box = e[end].box;
      const v = p2[along];
      if (v < box[along] + 12 || v > box[along] + (along === 'x' ? box.width : box.height) - 12) continue;
      const moved = { ...p0, [along]: v };
      const way = grow(segmentBox(moved, p2), LANE - 5);
      if (walls.some((w) => w.id !== e[end].node && overlap(way, w.box))) continue;
      // Other lines: none in the way, and no end on this side nearer than a lane.
      const near = grow(segmentBox(moved, moved), 11);
      let taken = false;
      for (const [id, r] of routes) {
        if (taken || mates.includes(id)) continue;
        for (let i = 1; i < r.points.length && !taken; i++) taken = overlap(way, segmentBox(r.points[i - 1]!, r.points[i]!));
        taken ||= [r.points[0]!, r.points[r.points.length - 1]!].some((q) => overlap(near, segmentBox(q, q)));
      }
      if (taken) continue;
      for (const id of mates) {
        const points = simplify([moved, ...from(id).slice(3)]);
        routes.set(id, { points: end === 'from' ? points : points.reverse() });
      }
    }
}

/**
 * Two lines into one side of a card (or out of it) that each turn onto the side's last stretch from
 * a lane of their own, and cross on the way there: the line that runs in on the outer lane took the
 * inner port, or the two came to their lanes the other way round. Each takes the other's lane and
 * port (the piece before stretches or shrinks to reach it), only the other's port, or only the
 * other's lane, whichever crosses least, when that is less than before and runs through no card.
 * Two lines into different cards on sides that face the same way (two endpoints, each to the card
 * it serves) can swap lanes the same way. The search cannot see this: it routes one
 * line at a time, and the first one takes the lane nearest its port.
 */
function untangleEnds(input: RouterInput, routes: Map<string, PlacedEdge>, sides: Map<string, [Side, Side]>, trunk: Map<string, string>, free: Set<string>) {
  // Only lines with a lane before their last stretch (four points or more) can trade one.
  const list = input.edges.filter((e) => free.has(e.id) && !trunk.has(e.id) && e.from.node !== e.to.node && (routes.get(e.id)?.points.length ?? 0) >= 4);
  if (list.length < 2) return;
  // Each line's bounding box: lines whose boxes do not meet cannot cross.
  const boxes = new Map([...routes].map(([id, r]) => [id, bounds(r.points)]));
  const meet = (p: string, q: string) => {
    const [a, b] = [boxes.get(p)!, boxes.get(q)!];
    return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
  };
  const walls = [...input.obstacles];
  const hits = (pts: Point[], own: string[]) => {
    for (let i = 1; i < pts.length; i++) {
      const s = segmentBox(pts[i - 1]!, pts[i]!);
      for (const [id, b] of walls) if (!own.includes(id) && s.x < b.x + b.width && b.x < s.x + s.width && s.y < b.y + b.height && b.y < s.y + s.height) return true;
    }
    return false;
  };
  // Group borders and headers each piece runs through or along: a lane taken over must not lead through more of them.
  const zones = input.soft;
  const borders = (pts: Point[]) => {
    let n = 0;
    for (let i = 1; i < pts.length; i++) {
      const s = segmentBox(pts[i - 1]!, pts[i]!);
      for (const b of zones) if (s.x < b.x + b.width && b.x < s.x + s.width && s.y < b.y + b.height && b.y < s.y + s.height) n++;
    }
    return n;
  };
  const crossingsOf = (ids: string[]) => {
    let n = 0;
    for (const id of ids) for (const [other, r] of routes) if (other !== id && (!ids.includes(other) || other > id) && meet(id, other) && crossEach(routes.get(id)!.points, r.points)) n++;
    return n;
  };
  for (const [i, a] of list.entries())
    // (Only pairs that cross at all: most do not.)
    for (const b of list.slice(i + 1).filter((o) => meet(a.id, o.id) && crossEach(routes.get(a.id)!.points, routes.get(o.id)!.points)))
      for (const ka of ['from', 'to'] as const)
        for (const kb of ['from', 'to'] as const) {
          // Into (or out of) one side of one card; or sides facing the same way, where only the lanes can change.
          const one = a[ka].node === b[kb].node;
          if (a[ka].rowY != null || b[kb].rowY != null) continue;
          const side = sides.get(a.id)![ka === 'from' ? 0 : 1];
          if (side !== sides.get(b.id)![kb === 'from' ? 0 : 1]) continue;
          // Each line with the shared end last.
          const toEnd = (id: string, k: End) => (k === 'to' ? [...routes.get(id)!.points] : [...routes.get(id)!.points].reverse());
          const [pa, pb] = [toEnd(a.id, ka), toEnd(b.id, kb)];
          if (pa.length < 4 || pb.length < 4 || !crossEach(pa, pb)) continue;
          // The port's coordinate along the side, and the lane's across it.
          const along = side === 'N' || side === 'S' ? 'x' : 'y';
          const across = along === 'x' ? 'y' : 'x';
          const lane = (p: Point[]) => p[p.length - 2]![across];
          const port = (p: Point[]) => p[p.length - 1]![along];
          // p takes q's lane, or port, or both.
          const swap = (p: Point[], q: Point[], stub: number, lanes: boolean, ports: boolean): Point[] | undefined => {
            const n = p.length;
            const [before, corner] = [p[n - 4]!, p[n - 3]!];
            // The last stretch runs along the side's normal; the one before it along the side.
            if (p[n - 2]![along] !== p[n - 1]![along] || corner[across] !== p[n - 2]![across] || before[along] !== corner[along]) return undefined;
            const to = lanes ? lane(q) : lane(p);
            const moved = { ...corner, [across]: to };
            // The piece before keeps its direction, and the end keeps room for its mark.
            if (Math.sign(moved[across] - before[across]) !== Math.sign(corner[across] - before[across])) return undefined;
            const end = { ...p[n - 1]!, [along]: ports ? port(q) : port(p) };
            if (Math.abs(end[across] - to) < stub) return undefined;
            return [...p.slice(0, n - 3), moved, { ...end, [across]: to }, end];
          };
          const was = [routes.get(a.id)!, routes.get(b.id)!];
          let best = crossingsOf([a.id, b.id]);
          let kept: [PlacedEdge, PlacedEdge] = [was[0]!, was[1]!];
          // Each the other's lane and port, or only the other's port (each keeps its lane), or only the other's lane.
          for (const [lanes, ports] of one ? [[true, true], [false, true], [true, false]] : [[true, false]]) {
            const na = swap(pa, pb, a[ka].stub, lanes!, ports!);
            const nb = swap(pb, pa, b[kb].stub, lanes!, ports!);
            if (!na || !nb || hits(na, [a.from.node, a.to.node]) || hits(nb, [b.from.node, b.to.node]) || borders(na) + borders(nb) > borders(pa) + borders(pb)) continue;
            const tried: [PlacedEdge, PlacedEdge] = [{ points: simplify(ka === 'to' ? na : na.reverse()) }, { points: simplify(kb === 'to' ? nb : nb.reverse()) }];
            routes.set(a.id, tried[0]).set(b.id, tried[1]);
            boxes.set(a.id, bounds(tried[0].points)).set(b.id, bounds(tried[1].points));
            const n = crossingsOf([a.id, b.id]);
            if (n < best) [best, kept] = [n, tried];
          }
          routes.set(a.id, kept[0]).set(b.id, kept[1]);
          boxes.set(a.id, bounds(kept[0].points)).set(b.id, bounds(kept[1].points));
        }
}

/**
 * Trunk groups: lines drawn alike leaving one node side (fan-out) share a port and run as one line
 * until they branch; so do solid lines arriving at one side (fan-in; dashes would not line up there).
 * Only lines without a label (see RouteRequest.style). Returns edge id → group key, only for groups of two or more.
 */
function trunkGroups(input: RouterInput, sides: Map<string, [Side, Side]>): Map<string, string> {
  const groups = new Map<string, string[]>();
  const add = (key: string, id: string) => groups.set(key, [...(groups.get(key) ?? []), id]);
  // Lines with labels keep their own path: on a shared trunk a label could not say which line it names.
  const usable = input.edges.filter((e) => e.style && !e.label && e.from.node !== e.to.node);
  // Out of one side only to cards that stand together (in one group): a trunk to cards in different places would
  // branch beside one of them and read as running on through it (resolver -> ruleset -> zones).
  // A table row's port is one point whatever its lines share, so there a trunk stays the neater way.
  for (const e of usable) add(`out|${e.from.node}|${e.from.rowY ?? ''}|${sides.get(e.id)![0]}|${e.style}|${e.from.rowY == null ? (e.to.within ?? '') : ''}`, e.id);
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
const sideMiddle = (b: Box, side: Side): Point => ({ x: b.x + b.width / 2 + (normal[side].x * b.width) / 2, y: b.y + b.height / 2 + (normal[side].y * b.height) / 2 });

// ---------------------------------------------------------------- sides and ports

/**
 * What the sides are weighed on (chooseSides): each line's candidate pairs of sides, an empty grid
 * with the stub ends of every one of them, and what each way was found to cost there. Nothing is ever
 * routed on that grid, so a way costs the same every time it is weighed: each is searched once, and
 * again only when asked to look further than it did (a search stops at the cost of the best way so far).
 */
interface SideGrid {
  options: Map<string, [Side, Side][]>;
  probe: Map<string, Ports>;
  grid: Grid;
  /** Per line and pair of sides: the cost found (undefined: none under `limit`, the cost it was searched up to). */
  weighed: Map<string, { cost: number | undefined; limit: number }>;
}

function sideGrid(input: RouterInput): SideGrid {
  const options = new Map<string, [Side, Side][]>();
  for (const e of input.edges) options.set(e.id, candidates(e, input.direction));
  // A grid with the stub ends of every candidate side, at the side's centre.
  const probe = new Map<string, Ports>();
  const points: Point[] = [];
  for (const e of input.edges)
    for (const [f, t] of options.get(e.id)!) {
      const p = centrePorts(e, f, t, input.texts);
      probe.set(`${e.id}|${f}${t}`, p);
      points.push(p.start, p.goal);
    }
  return { options, probe, grid: buildGrid(input, points), weighed: new Map() };
}

/**
 * Pick the sides each line leaves and enters by trying the plausible combinations (sides that face
 * the other end) on an empty grid and keeping the cheapest. The layout direction gets a small
 * preference, so most lines still run left to right.
 */
function chooseSides(input: RouterInput, strange: (e: RouteRequest) => ZoneCost | undefined, roomy: boolean, at = sideGrid(input)): { sides: Map<string, [Side, Side]>; pressed: boolean } {
  const out = new Map<string, [Side, Side]>();
  const { options, probe, grid, weighed } = at;
  // What the way from one pair of sides costs on the empty grid, when it can come under `limit`. A way
  // searched before is not searched again: its cost is known, or known to be no less than its limit then.
  // (A search that stops at a limit finds what one without it finds, up to there.)
  const weigh = (e: RouteRequest, pair: [Side, Side], limit: number): number | undefined => {
    const key = `${e.id}|${pair[0]}${pair[1]}`;
    const known = weighed.get(key);
    if (known && (known.cost != null || known.limit >= limit)) return known.cost;
    const cost = search(grid, probe.get(key)!, strange(e), SHARE, limit, [e.from.node, e.to.node], true)?.cost;
    weighed.set(key, { cost, limit });
    return cost;
  };
  const across = input.direction === 'right' ? ['N', 'S'] : ['E', 'W'];
  // Per node side, how many lines chosen so far come in there (ins) and go out there (outs).
  const ins = new Map<string, number>();
  const outs = new Map<string, number>();
  // Per table row side, the marks drawn there so far: a row's port is one point, and two different
  // marks on it (a crow's foot over a bar) say neither.
  const rowMarks = new Map<string, Set<string>>();
  const rowKey = (r: RouteEnd, side: Side) => `${r.node}:${r.rowY}:${side}`;
  const clash = (r: RouteEnd, side: Side) => r.rowY != null && [...(rowMarks.get(rowKey(r, side)) ?? [])].some((m) => m !== (r.mark ?? ''));
  // Per node side, the ports chosen so far: lines drawn alike without a label, all in or all out, share one (a trunk).
  // A line to a card inside a group its other end is not in passes that group's border on the way: it takes room there too.
  const ports = new Map<string, Map<string, number>>();
  const portOf = (e: RouteRequest, end: 'from' | 'to') => (e.style && !e.label ? `${end}|${e.style}` : `${end}|${e.id}`);
  // A line with a label needs a little more: lines run on side by side from their ports, and the label sits between.
  const room = new Map<string, number>();
  for (const e of input.edges) for (const end of ['from', 'to'] as const) room.set(portOf(e, end), e.label ? LABELLED : PORT);
  const groups = new Map((input.groups ?? []).map((g) => [g.id, g]));
  const around = (r: RouteEnd) => {
    const out: string[] = [];
    for (let g = r.within; g != null && groups.has(g) && !out.includes(g); g = groups.get(g)!.parent) out.push(g);
    return out;
  };
  const sidesAt = (e: RouteRequest, end: 'from' | 'to', side: Side) => {
    const far = around(e[end === 'from' ? 'to' : 'from']);
    const crossed = around(e[end]).filter((g) => !far.includes(g) && g !== e[end === 'from' ? 'to' : 'from'].node);
    return [{ key: `${e[end].node}:${side}`, box: e[end].box }, ...crossed.map((g) => ({ key: `${g}:${side}`, box: groups.get(g)!.box }))];
  };
  let pressed = false;
  const crammed = (e: RouteRequest, end: 'from' | 'to', side: Side) =>
    roomy &&
    e[end].rowY == null &&
    sidesAt(e, end, side).some(({ key, box }) => {
      const taken = ports.get(key);
      if (taken?.has(portOf(e, end))) return false;
      // A group's own side: only where a line lands clear of what the group holds (none such: no room at all).
      if (!taken && !e[end].inner) return false;
      const own = !!e[end].inner && box === e[end].box;
      const span = clearSpan(box, side, input.texts ?? [], 1);
      const [lo, hi] = own ? (landing(e[end], side, span, 1) ?? [0, -1]) : span;
      if (hi < lo) return true;
      if (!taken) return false;
      let need = room.get(portOf(e, end))! - PORT;
      for (const id of taken.keys()) need += room.get(id)!;
      return need > hi - lo;
    })
      ? ((pressed = true), CRAMMED)
      : 0;
  const add = (e: RouteRequest, [f, t]: [Side, Side], by: 1 | -1 = 1) => {
    ins.set(`${e.to.node}:${t}`, (ins.get(`${e.to.node}:${t}`) ?? 0) + by);
    outs.set(`${e.from.node}:${f}`, (outs.get(`${e.from.node}:${f}`) ?? 0) + by);
    for (const [r, side] of [[e.from, f], [e.to, t]] as const) if (r.rowY != null && by > 0) rowMarks.set(rowKey(r, side), (rowMarks.get(rowKey(r, side)) ?? new Set()).add(r.mark ?? ''));
    for (const [end, side] of [['from', f], ['to', t]] as const)
      if (e[end].rowY == null)
        for (const { key } of sidesAt(e, end, side)) {
          const taken = ports.get(key) ?? new Map<string, number>();
          const n = (taken.get(portOf(e, end)) ?? 0) + by;
          if (n > 0) taken.set(portOf(e, end), n);
          else taken.delete(portOf(e, end));
          ports.set(key, taken);
        }
  };
  const choose = (e: RouteRequest, list: [Side, Side][]): [Side, Side] => {
    let best = list[0]!;
    let bestCost = Infinity;
    // Into a later layer (the other end wholly further along the flow), a line leaves and enters
    // along the flow: sideways it would come in on the shoulder, and siblings would loop to reach it.
    const later = input.direction === 'right' ? e.to.box.x > e.from.box.x + e.from.box.width + 24 : e.to.box.y > e.from.box.y + e.from.box.height + 24;
    // Back to an earlier layer, a line runs against the flow whichever side it takes: the flow is no
    // reason to leave along it, and an end on the side the line before came in at turns back on itself.
    const back = input.direction === 'right' ? e.to.box.x + e.to.box.width < e.from.box.x - 24 : e.to.box.y + e.to.box.height < e.from.box.y - 24;
    // A line that runs mostly across the flow (to a card far below, in a left-to-right drawing) and not
    // on to a later layer leaves and enters across it: out of the side along the flow it would start
    // right beside where the line before it came in, and read as that line running on.
    const [ca, cb] = [centre(e.from.box), centre(e.to.box)];
    const crosswise = !later && (input.direction === 'right' ? Math.abs(cb.y - ca.y) > 2 * Math.abs(cb.x - ca.x) : Math.abs(cb.x - ca.x) > 2 * Math.abs(cb.y - ca.y));
    // A line out of the side another line comes in at (or into the side another leaves from) starts
    // right beside that one's end: the two read as one line running on through the card.
    const meets = (pair: [Side, Side]) => (ins.get(`${e.from.node}:${pair[0]}`) ?? 0) + (outs.get(`${e.to.node}:${pair[1]}`) ?? 0);
    for (const pair of list) {
      const sideways = (clash(e.from, pair[0]) ? MIXED : 0) + (clash(e.to, pair[1]) ? MIXED : 0) + meets(pair) * MEETS + crammed(e, 'from', pair[0]) + crammed(e, 'to', pair[1]) + (crosswise ? pair.filter((x) => !across.includes(x)).length * 2 * BEND : pair.filter((x) => across.includes(x)).length * (later ? FLOW : back ? 0 : 25));
      // Only a way cheaper than the best so far is worth finding.
      const found = weigh(e, pair, bestCost - sideways);
      if (found == null) continue;
      const cost = found + sideways;
      if (cost < bestCost) [best, bestCost] = [pair, cost];
    }
    return best;
  };
  for (const e of input.edges) {
    const list = options.get(e.id)!;
    const pair = list.length === 1 || e.from.node === e.to.node ? list[0]! : choose(e, list);
    out.set(e.id, pair);
    add(e, pair);
  }
  // A side filled by lines chosen later: the lines chosen first have not seen them. Each line on a side
  // with no room left for it is chosen again, knowing all the others (not on table rows: their marks stay).
  for (const e of input.edges) {
    const list = options.get(e.id)!;
    if (list.length === 1 || e.from.node === e.to.node || e.from.rowY != null || e.to.rowY != null) continue;
    const was = out.get(e.id)!;
    add(e, was, -1);
    const pair = crammed(e, 'from', was[0]) || crammed(e, 'to', was[1]) ? choose(e, list) : was;
    out.set(e.id, pair);
    add(e, pair);
  }
  return { sides: out, pressed };
}

function candidates(e: RouteRequest, direction: 'right' | 'down'): [Side, Side][] {
  const a = e.from.box;
  const b = e.to.box;
  // A line back to its own node loops off the side the flow does not use (rows attach left or right only).
  if (e.from.node === e.to.node) return direction === 'right' && e.from.rowY == null && e.to.rowY == null ? [['N', 'N']] : [['E', 'E']];
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

function centrePorts(e: RouteRequest, f: Side, t: Side, texts: Box[] = []): Ports {
  const at = (r: RouteEnd, side: Side): Point => {
    const b = r.box;
    if (r.rowY != null) return { x: side === 'E' ? b.x + b.width : b.x, y: b.y + r.rowY };
    // The middle of the part of the side a line can leave straight from (clear of header text): where its port will be.
    const span = clearSpan(b, side, texts, 1, reachTo(b, side, (r === e.from ? e.to : e.from).box));
    const [lo, hi] = landing(r, side, span, 1) ?? span;
    const mid = (lo + hi) / 2;
    return side === 'E' ? { x: b.x + b.width, y: mid }
      : side === 'W' ? { x: b.x, y: mid }
      : side === 'N' ? { x: mid, y: b.y }
      : { x: mid, y: b.y + b.height };
  };
  const from = e.from.rowY != null ? at(e.from, f) : clearOfText(at(e.from, f), f, e.from, texts);
  const to = e.to.rowY != null ? at(e.to, t) : clearOfText(at(e.to, t), t, e.to, texts);
  const out1 = (p: Point, side: Side, len: number) => ({ x: p.x + normal[side].x * len, y: p.y + normal[side].y * len });
  return { from, to, fromSide: f, toSide: t, start: out1(from, f, e.from.stub), goal: out1(to, t, e.to.stub) };
}

/** How far out from a side a line is likely to run straight on when its other end is not ahead of that side: past a group header above it. */
const REACH = 72;

/**
 * Where on a side ports may go (12px from the corners): the widest stretch from which a line can
 * run straight out for `reach` without crossing header text, when `n` ports fit there 12px apart;
 * else such a stretch for REACH (the header nearest the card matters most); otherwise the whole side.
 */
function clearSpan(box: Box, side: Side, texts: Box[], n: number, reach = REACH): [number, number] {
  const along = side === 'N' || side === 'S' ? 'x' : 'y';
  const lo = along === 'x' ? box.x + 12 : box.y + 12;
  const hi = along === 'x' ? box.x + box.width - 12 : box.y + box.height - 12;
  if (!texts.length) return [lo, hi];
  return clearStretch(box, side, texts, n, reach, lo, hi) ?? (reach > REACH ? clearStretch(box, side, texts, n, REACH, lo, hi) : undefined) ?? [lo, hi];
}

function clearStretch(box: Box, side: Side, texts: Box[], n: number, reach: number, lo: number, hi: number): [number, number] | undefined {
  const along = side === 'N' || side === 'S' ? 'x' : 'y';
  const nrm = normal[side];
  const p = side === 'N' ? box.y : side === 'S' ? box.y + box.height : side === 'W' ? box.x : box.x + box.width;
  const q = p + (along === 'x' ? nrm.y : nrm.x) * reach;
  const [s0, s1] = [Math.min(p, q), Math.max(p, q)];
  const blocked: [number, number][] = [];
  for (const t of texts) {
    const [t0, t1, a0, a1] = along === 'x' ? [t.y, t.y + t.height, t.x, t.x + t.width] : [t.x, t.x + t.width, t.y, t.y + t.height];
    if (s0 < t1 && s1 > t0 && a1 + 8 > lo && a0 - 8 < hi) blocked.push([a0 - 8, a1 + 8]);
  }
  if (!blocked.length) return [lo, hi];
  blocked.sort((a, b) => a[0] - b[0]);
  let best: [number, number] | undefined;
  let at = lo;
  for (const [a, b] of [...blocked, [hi, hi] as [number, number]]) {
    if (a > at && (!best || a - at > best[1] - best[0])) best = [at, Math.min(a, hi)];
    at = Math.max(at, b);
  }
  return best && best[1] - best[0] >= 12 * (n - 1) ? best : undefined;
}

/**
 * How far a line runs straight out from a side: as far as the other end when that lies ahead (past
 * the title of every group on the way, however many lie around the card), REACH when it does not.
 */
function reachTo(box: Box, side: Side, other: Box): number {
  const gap = side === 'N' ? box.y - (other.y + other.height) : side === 'S' ? other.y - (box.y + box.height) : side === 'W' ? box.x - (other.x + other.width) : other.x - (box.x + box.width);
  return gap > 0 ? gap : REACH;
}

/** A card this near a group's side stands beside it there (see landing). */
const BESIDE = 48;
/** A line that steps aside less than this right before its end has a kink (metrics.ts: JOG). */
const KINK = 40;
/** And a line lands this far clear of the card's corners. */
const LAND_AIR = 8;

/**
 * Where on a group's left or right side arrowheads land clear of the cards it holds: on the border
 * right beside a card inside, an arrowhead reads as pointing at that card, not at the group. The
 * stretch of the side (within `span`) nearest the header that is beside no card and where `n` ends
 * fit two lanes apart; undefined when there is none. Elsewhere (a card, the top: the header, the
 * bottom, an end without a mark, a group beside no card) the whole `span`. Cards only: beside a
 * smaller scope inside it, a line still reads as onto the outer one.
 */
function landing(r: RouteEnd, side: Side, span: [number, number], n: number): [number, number] | undefined {
  if (!r.inner?.length || (side !== 'W' && side !== 'E') || (r.mark ?? 'none') === 'none') return span;
  const b = r.box;
  const gap = (c: Box) => (side === 'W' ? c.x - b.x : b.x + b.width - (c.x + c.width));
  const blocked = r.inner
    .filter((c) => gap(c) <= BESIDE)
    .map((c) => [c.y - LAND_AIR, c.y + c.height + LAND_AIR] as [number, number])
    .sort((p, q) => p[0] - q[0]);
  if (!blocked.length) return span;
  const [lo, hi] = span;
  let at = lo;
  for (const [a, z] of [...blocked, [hi, hi] as [number, number]]) {
    if (Math.min(a, hi) - at >= Math.max(1, n - 1) * 2 * LANE) return [at, Math.min(a, hi)];
    at = Math.max(at, z);
  }
  return undefined;
}

/**
 * A port whose straight stub would run through header text slides along its side to the nearest
 * spot where the stub is clear (keeping 12px from the corners); when the side has no such spot it
 * stays, and the search pays for the crossing.
 */
function clearOfText(p: Point, side: Side, end: RouteEnd, texts: Box[]): Point {
  if (!texts.length) return p;
  const n = normal[side];
  const along = n.x === 0 ? 'x' : 'y';
  const q = { x: p.x + n.x * end.stub, y: p.y + n.y * end.stub };
  const [s0, s1] = along === 'x' ? [Math.min(p.y, q.y), Math.max(p.y, q.y)] : [Math.min(p.x, q.x), Math.max(p.x, q.x)];
  const blocked: [number, number][] = [];
  for (const t of texts) {
    const [t0, t1, a0, a1] = along === 'x' ? [t.y, t.y + t.height, t.x, t.x + t.width] : [t.x, t.x + t.width, t.y, t.y + t.height];
    if (s0 < t1 && s1 > t0) blocked.push([a0 - 8, a1 + 8]);
  }
  const v = p[along];
  if (!blocked.some(([a, b]) => v > a && v < b)) return p;
  const b = end.box;
  const [lo, hi] = along === 'x' ? [b.x + 12, b.x + b.width - 12] : [b.y + 12, b.y + b.height - 12];
  const options = [lo, hi, ...blocked.flat()].filter((c) => c >= lo && c <= hi && !blocked.some(([a, z]) => c > a && c < z));
  if (!options.length) return p;
  const best = options.reduce((m, c) => (Math.abs(c - v) < Math.abs(m - v) ? c : m));
  return { ...p, [along]: best };
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
  // `toward`: the middle of the side the line takes at its other end, which tells apart lines to one card.
  type Slot = { edge: RouteRequest; end: 'from' | 'to'; other: Point; toward: Point };
  const slots = new Map<string, Slot[]>();
  const shared = new Map<string, string>();
  const firstOf = new Map<string, Slot>();
  const spread = new Map<Slot, Point[]>();
  for (const e of input.edges) {
    const [sf, st] = sides.get(e.id)!;
    for (const [end, side, other, toward] of [
      ['from', sf, centre(e.to.box), sideMiddle(e.to.box, st)],
      ['to', st, centre(e.from.box), sideMiddle(e.from.box, sf)],
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
      const slot = { edge: e, end, other, toward };
      if (sharedEnd) firstOf.set(t, slot), spread.set(slot, [other]);
      slots.set(key, [...(slots.get(key) ?? []), slot]);
    }
  }
  for (const [slot, list] of spread) slot.other = { x: list.reduce((s, p) => s + p.x, 0) / list.length, y: list.reduce((s, p) => s + p.y, 0) / list.length };
  const pos = new Map<string, Point>();
  const texts = input.texts ?? [];
  for (const [key, list] of slots) {
    const side = key.slice(key.lastIndexOf(':') + 1) as Side;
    const box = list[0]!.edge[list[0]!.end].box;
    const along = side === 'E' || side === 'W';
    // Order by angle from the box: the line that turns away earliest leaves outermost, so lines
    // leaving one side do not cross each other.
    const c = centre(box);
    const n = normal[side];
    const angle = (o: Point) => Math.atan2(along ? o.y - c.y : o.x - c.x, Math.max(1, (o.x - c.x) * n.x + (o.y - c.y) * n.y));
    // Two lines to (or from) one card: by the side they take there. A line into this side from the card's
    // far side and one out of it to the card's near side would cross right here in the other order.
    list.sort((p, q) => angle(p.other) - angle(q.other) || angle(p.toward) - angle(q.toward));
    // Spread over the part of the side clear of header text when the ports fit there.
    const span = clearSpan(box, side, texts, list.length, Math.max(...list.map((s) => reachTo(box, side, s.edge[s.end === 'from' ? 'to' : 'from'].box))));
    const axis = along ? 'y' : 'x';
    const group = !input.obstacles.has(list[0]!.edge[list[0]!.end].node);
    // Evenly over [lo, hi], in that order.
    const spread = (lo: number, hi: number) => {
      const length = hi - lo + 24;
      const step = Math.min(28, (length - 24) / Math.max(1, list.length));
      const first = (length - step * (list.length - 1)) / 2;
      const at = list.map((_, i) => lo - 12 + first + i * step);
      // A group's side is long: there a line leaves in line with its other end when that end lies
      // along the side, and the lines beside it make room, as long as all keep their order and stay
      // on the side. A line straight out of a group has room for its label; one that jogs a few
      // pixels has not.
      if (list.length > 1 && group) {
        const straight = list.map((s) => s.other[axis] >= lo && s.other[axis] <= hi);
        const wanted = list.map((s, i) => (straight[i] ? s.other[axis] : at[i]!));
        for (let i = 1; i < list.length; i++) if (!straight[i]) wanted[i] = Math.max(wanted[i]!, wanted[i - 1]! + 2 * LANE);
        for (let i = list.length - 2; i >= 0; i--) if (!straight[i]) wanted[i] = Math.min(wanted[i]!, wanted[i + 1]! - 2 * LANE);
        if (straight.includes(true) && wanted.every((v, i) => v >= lo && v <= hi && (!i || v - wanted[i - 1]! >= 2 * LANE))) return wanted;
      }
      return at;
    };
    // On a group, by its header, clear of what it holds (landing); unless that leaves fewer lines
    // straight, or bends more a little right before the group (a kink), than the whole side does.
    const off = (at: number[]) => list.map((s, i) => Math.abs(at[i]! - s.other[axis]));
    const straights = (at: number[]) => off(at).filter((d) => d <= 0.5).length;
    const kinks = (at: number[]) => off(at).filter((d) => d > 0.5 && d < KINK).length;
    const landed = group ? landing(list[0]!.edge[list[0]!.end], side, span, list.length) : undefined;
    const [here, whole] = [landed && spread(...landed), spread(...span)];
    const at = here && straights(here) >= straights(whole) && kinks(here) <= kinks(whole) ? here : whole;
    at.forEach((v, i) => {
      const s = list[i]!;
      const p =
        side === 'E' ? { x: box.x + box.width, y: v }
        : side === 'W' ? { x: box.x, y: v }
        : side === 'N' ? { x: v, y: box.y }
        : { x: v, y: box.y + box.height };
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
    const range = (r: RouteEnd) => clearSpan(r.box, r === e.from ? sf : st, texts, 1, reachTo(r.box, r === e.from ? sf : st, (r === e.from ? e.to : e.from).box));
    const ff = fixed('from', sf);
    const tf = fixed('to', st);
    const set = (end: 'from' | 'to', v: number) => {
      const [lo, hi] = range(e[end]);
      if (v >= lo && v <= hi) pos.set(`${e.id}:${end}`, { ...pos.get(`${e.id}:${end}`)!, [along]: v });
    };
    if (ff == null && tf != null) set('from', tf);
    else if (tf == null && ff != null) set('to', ff);
    else if (ff == null && tf == null) {
      // Both free: meet in the overlap, if there is one, as near the middle of the first as a
      // straight line can run all the way: clear of the header texts and cards in between.
      const [a0, a1] = range(e.from);
      const [b0, b1] = range(e.to);
      const lo = Math.max(a0, b0);
      const hi = Math.min(a1, b1);
      if (hi >= lo) {
        const ca = pos.get(`${e.id}:from`)![along];
        const [fb, tb] = [e.from.box, e.to.box];
        const [r0, r1] = along === 'x' ? [Math.min(fb.y + fb.height, tb.y + tb.height), Math.max(fb.y, tb.y)] : [Math.min(fb.x + fb.width, tb.x + tb.width), Math.max(fb.x, tb.x)];
        const between = [...texts.map((t) => [t, 8] as const), ...[...input.obstacles].filter(([id]) => id !== e.from.node && id !== e.to.node).map(([, b]) => [b, MARGIN] as const)]
          .filter(([b]) => (along === 'x' ? b.y < r1 && b.y + b.height > r0 : b.x < r1 && b.x + b.width > r0))
          .map(([b, air]) => (along === 'x' ? [b.x - air, b.x + b.width + air] : [b.y - air, b.y + b.height + air]) as [number, number]);
        const open = [lo, hi, ...between.flat()].filter((c) => c >= lo && c <= hi && !between.some(([a, z]) => c > a && c < z));
        const mid = Math.min(hi, Math.max(lo, ca));
        const v = between.some(([a, z]) => mid > a && mid < z) && open.length ? open.reduce((m, c) => (Math.abs(c - mid) < Math.abs(m - mid) ? c : m)) : mid;
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
      return clearOfText(pos.get(`${e.id}:${end}`)!, side, r, input.texts ?? []);
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
  /** The innermost group around each grid edge: 0 none, 2i+1 inside group i, 2i+2 in its header strip; and how much of the edge lies there. */
  hZone: Uint16Array;
  vZone: Uint16Array;
  hZoneLen: Float32Array;
  vZoneLen: Float32Array;
  hUsed: Uint16Array;
  vUsed: Uint16Array;
  /** What running close along a card costs, and whose card that is (index + 1; -1 for several). */
  hRing: Float32Array;
  vRing: Float32Array;
  hRingOf: Int32Array;
  vRingOf: Int32Array;
  /** Card index by node id. */
  cards: Map<string, number>;
  /** Stretches on from the ends of routed lines, on their track (see markRunOn). */
  hRun: Uint16Array;
  vRun: Uint16Array;
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
  // A track just outside each group, so a line that does not belong in it has a way around; only
  // where no track runs close by already.
  const track = (set: Set<number>, v: number) => {
    for (const w of set) if (Math.abs(w - v) < LANE) return;
    set.add(v);
  };
  for (const { box: b } of input.groups ?? []) {
    track(xset, b.x - OUTSIDE);
    track(xset, b.x + b.width + OUTSIDE);
    track(yset, b.y - OUTSIDE);
    track(yset, b.y + b.height + OUTSIDE);
  }
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
    hZone: new Uint16Array(n),
    vZone: new Uint16Array(n),
    hZoneLen: new Float32Array(n),
    vZoneLen: new Float32Array(n),
    hUsed: new Uint16Array(n),
    vUsed: new Uint16Array(n),
    hRing: new Float32Array(n),
    vRing: new Float32Array(n),
    hRingOf: new Int32Array(n),
    vRingOf: new Int32Array(n),
    cards: new Map([...input.obstacles.keys()].map((id, i) => [id, i + 1])),
    hRun: new Uint16Array(n),
    vRun: new Uint16Array(n),
    hFriend: new Uint16Array(n),
    vFriend: new Uint16Array(n),
    cost: new Float64Array(n * 4),
    prev: new Int32Array(n * 4),
    stamp: new Uint32Array(n * 4),
    generation: 0,
  };

  const block = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = lowerBound(ys, y0); y < H && ys[y]! < y1; y++)
      for (let x = Math.max(0, lowerBound(xs, x0) - 1); x < W - 1 && xs[x]! < x1; x++) if (xs[x + 1]! > x0) g.hBlocked[y * W + x] = 1;
    for (let x = lowerBound(xs, x0); x < W && xs[x]! < x1; x++)
      for (let y = Math.max(0, lowerBound(ys, y0) - 1); y < H - 1 && ys[y]! < y1; y++) if (ys[y + 1]! > y0) g.vBlocked[y * W + x] = 1;
  };
  // Boxes, grown by the margin (minus a pixel, so lines may run exactly along the margin).
  for (const b of boxes) block(b.x - MARGIN + 1, b.y - MARGIN + 1, b.x + b.width + MARGIN - 1, b.y + b.height + MARGIN - 1);
  // Header text is a wall too, unless a line has to start or end in it (a port with no clear
  // spot): then it is only very expensive, so that line still finds a way out.
  const soft = [...input.soft];
  for (const t of input.texts ?? []) {
    const inside = points.some((p) => p.x > t.x && p.x < t.x + t.width && p.y > t.y && p.y < t.y + t.height);
    if (inside) soft.push({ ...t, weight: TEXT / SOFT });
    else block(t.x, t.y, t.x + t.width, t.y + t.height);
  }
  // Close along a card's side: allowed (tight spots need it), but a line there seems to belong to
  // the card. Its own lines are at home there; where two cards' rings meet, every line pays.
  boxes.forEach((b, i) => {
    const r = grow(b, CLEAR);
    const [rx1, ry1] = [r.x + r.width, r.y + r.height];
    const own = (arr: Int32Array, e: number) => (arr[e] = arr[e] === 0 || arr[e] === i + 1 ? i + 1 : -1);
    for (let y = lowerBound(ys, r.y); y < H && ys[y]! <= ry1; y++)
      for (let x = Math.max(0, lowerBound(xs, r.x) - 1); x < W - 1 && xs[x]! < rx1; x++) {
        const len = Math.max(0, Math.min(xs[x + 1]!, rx1) - Math.max(xs[x]!, r.x));
        if (len) (g.hRing[y * W + x] = g.hRing[y * W + x]! + RING * len), own(g.hRingOf, y * W + x);
      }
    for (let x = lowerBound(xs, r.x); x < W && xs[x]! <= rx1; x++)
      for (let y = Math.max(0, lowerBound(ys, r.y) - 1); y < H - 1 && ys[y]! < ry1; y++) {
        const len = Math.max(0, Math.min(ys[y + 1]!, ry1) - Math.max(ys[y]!, r.y));
        if (len) (g.vRing[y * W + x] = g.vRing[y * W + x]! + RING * len), own(g.vRingOf, y * W + x);
      }
  });
  // Group headers and borders: allowed, but every pixel inside one costs.
  for (const r of soft) {
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
  // Which group each grid edge lies in, by its middle: the biggest groups first, so the innermost stays.
  const groups = input.groups ?? [];
  const head = input.header ?? 0;
  const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  for (const i of groups.map((_, k) => k).sort((a, b) => groups[b]!.box.width * groups[b]!.box.height - groups[a]!.box.width * groups[a]!.box.height)) {
    const b = groups[i]!.box;
    const [x1, y1, yh] = [b.x + b.width, b.y + b.height, b.y + head];
    for (let y = lowerBound(ys, b.y); y < H && ys[y]! <= y1; y++)
      for (let x = Math.max(0, lowerBound(xs, b.x) - 1); x < W - 1 && xs[x]! < x1; x++) {
        const mid = (xs[x]! + xs[x + 1]!) / 2;
        if (mid <= b.x || mid >= x1) continue;
        g.hZone[y * W + x] = ys[y]! < yh ? 2 * i + 2 : 2 * i + 1;
        g.hZoneLen[y * W + x] = overlap(xs[x]!, xs[x + 1]!, b.x, x1);
      }
    for (let x = lowerBound(xs, b.x); x < W && xs[x]! <= x1; x++)
      for (let y = Math.max(0, lowerBound(ys, b.y) - 1); y < H - 1 && ys[y]! < y1; y++) {
        const mid = (ys[y]! + ys[y + 1]!) / 2;
        if (mid <= b.y || mid >= y1) continue;
        const inHead = mid < yh;
        g.vZone[y * W + x] = inHead ? 2 * i + 2 : 2 * i + 1;
        g.vZoneLen[y * W + x] = inHead ? overlap(ys[y]!, ys[y + 1]!, b.y, yh) : overlap(ys[y]!, ys[y + 1]!, yh, y1);
      }
  }
  return g;
}

/** What a line pays per pixel in each zone of the grid (see Grid.hZone), running across and running down. */
interface ZoneCost {
  h: Float32Array;
  v: Float32Array;
}

/**
 * The price list of each line for the groups it runs through. A group holding neither end costs
 * per pixel, once for each such group around the line (a subnet in another zone costs more than
 * that zone alone), and much more in its header strip. In the header of a group the line belongs
 * in, crossing is free and running along it costs: a line there reads as striking the title out.
 */
function strangers(input: RouterInput): (e: RouteRequest) => ZoneCost | undefined {
  const groups = input.groups ?? [];
  if (!groups.length) return () => undefined;
  const index = new Map(groups.map((g, i) => [g.id, i]));
  const lists = new Map<string, ZoneCost>();
  return (e) => {
    const key = (e.home ?? []).join('|');
    let z = lists.get(key);
    if (!z) {
      const home = new Set(e.home ?? []);
      z = { h: new Float32Array(2 * groups.length + 1), v: new Float32Array(2 * groups.length + 1) };
      groups.forEach((g, i) => {
        let away = 0;
        for (let k: number | undefined = i, n = 0; k != null && n < 64; k = index.get(groups[k]!.parent ?? ''), n++) if (!home.has(groups[k]!.id)) away++;
        const mine = home.has(g.id);
        z!.h[2 * i + 1] = z!.v[2 * i + 1] = FOREIGN * away;
        z!.h[2 * i + 2] = FOREIGN * away + (mine ? ALONG : HEADER);
        z!.v[2 * i + 2] = FOREIGN * away + (mine ? 0 : HEADER);
      });
      lists.set(key, z);
    }
    return z;
  };
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

/** A polyline along grid coordinates as x, y index pairs; pieces that are not on the grid or not straight are left out. */
function cellsOf(g: Grid, pts: Point[]): number[] {
  const cells: number[] = [];
  for (const p of pts) {
    const x = g.xi.get(p.x);
    const y = g.yi.get(p.y);
    if (x == null || y == null) continue;
    const n = cells.length;
    if (n && cells[n - 2] !== x && cells[n - 1] !== y) continue;
    cells.push(x, y);
  }
  return cells;
}

/** A grid path without its first (or last) `by` pixels, cut at the grid line that far in. */
function trim(g: Grid, cells: number[], by: number, first: boolean): number[] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < cells.length; i += 2) pairs.push([cells[i]!, cells[i + 1]!]);
  if (!first) pairs.reverse();
  const at = ([x, y]: [number, number]): Point => ({ x: g.xs[x]!, y: g.ys[y]! });
  let left = by;
  let k = 0;
  while (k < pairs.length - 1) {
    const a = at(pairs[k]!);
    const b = at(pairs[k + 1]!);
    const len = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (len > left) {
      // Cut this piece at the first grid line at least `left` along it.
      const [ax, ay] = pairs[k]!;
      const [bx, by2] = pairs[k + 1]!;
      if (ay === by2) {
        const step = Math.sign(bx - ax);
        let x = ax;
        while (x !== bx && Math.abs(g.xs[x]! - a.x) < left) x += step;
        pairs[k] = [x, ay];
      } else {
        const step = Math.sign(by2 - ay);
        let y = ay;
        while (y !== by2 && Math.abs(g.ys[y]! - a.y) < left) y += step;
        pairs[k] = [ax, y];
      }
      break;
    }
    left -= len;
    k++;
  }
  const kept = pairs.slice(k);
  if (!first) kept.reverse();
  return kept.length > 1 ? kept.flat() : [];
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
  if (!friend) markRunOn(g, cells, delta);
}

/**
 * Two lines on one track with a short gap between their ends read as one line (Kestrel Online's
 * line up to the ledger and the email line down to Postbird, in one channel): the track RUN_ON on
 * past each end of a line's straight pieces is marked, and another line pays for starting there.
 */
function markRunOn(g: Grid, cells: number[], delta: 1 | -1) {
  // Plain loops, no closures or arrays per piece: this runs for every line on every pass.
  const W = g.W;
  for (let i = 2; i < cells.length; i += 2) {
    const ax = cells[i - 2]!;
    const ay = cells[i - 1]!;
    const bx = cells[i]!;
    const by = cells[i + 1]!;
    if (ax === bx && ay === by) continue;
    const flat = ay === by;
    const vals = flat ? g.xs : g.ys;
    const at = flat ? ay : ax;
    const lo = flat ? Math.min(ax, bx) : Math.min(ay, by);
    const hi = flat ? Math.max(ax, bx) : Math.max(ay, by);
    const arr = flat ? g.hRun : g.vRun;
    // On its own track, and (half as dear) on the tracks right beside it: a lane aside it still runs on.
    const across = flat ? g.ys : g.xs;
    // Index of grid edge k on track t: along a row (flat) or down a column.
    const step = flat ? 1 : W;
    for (let t = at - 1; t <= at + 1; t++) {
      if (t < 0 || t >= across.length || Math.abs(across[t]! - across[at]!) >= RUN_ASIDE) continue;
      const d = t === at ? 2 * delta : delta;
      const origin = flat ? t * W : t;
      for (let k = lo - 1; k >= 0 && vals[lo]! - vals[k + 1]! < RUN_ON; k--) arr[origin + k * step] = arr[origin + k * step]! + d;
      for (let k = hi; k < vals.length - 1 && vals[k]! - vals[hi]! < RUN_ON; k++) arr[origin + k * step] = arr[origin + k * step]! + d;
    }
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

function search(g: Grid, p: Ports, strange?: ZoneCost, share = SHARE, limit = Infinity, ends: [string, string] = ['', ''], bends = false): Found | undefined {
  const [ownA, ownB] = ends.map((id) => g.cards.get(id) ?? 0);
  // What is left to go is guessed at full price, which finds a line of its own fast. For a line that
  // is to run on its siblings' the guess must not be dearer than running there, or the search stops
  // at the first way in it finds instead of the best one.
  const guess = share < SHARE ? share : 1;
  const deep = g.W * g.H > LARGE_GRID ? TIE_DEEP : 0;
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

  // With `bends`, the bends still to come are guessed too: however free the way, a line heading off
  // from the goal has to turn, and every turn costs a bend. That is never more than the way costs, so
  // the cost found is the same, sooner; but of two ways that cost the same another may come out. So
  // only where the cost alone counts (weighing sides); a line that is drawn keeps the way it had.
  const ahead = (x: number, y: number, d: number) => {
    const dx = tx - xs[x]!;
    const dy = ty - ys[y]!;
    const along = dx * DX[d]! + dy * DY[d]!;
    const aside = DX[d] ? dy : dx;
    const turns = aside ? (along >= 0 ? 1 : 2) : along >= 0 ? 0 : 3;
    return guess * (Math.abs(dx) + Math.abs(dy)) + (bends ? BEND * turns : 0);
  };
  const s = (sy * W + sx) * 4 + startDir;
  stamp[s] = gen;
  cost[s] = 0;
  prev[s] = -1;
  heap.push(s, ahead(sx, sy, startDir));

  // A walled-in end (a stub ending in another box's margin) would make the search sweep the whole
  // grid; well before that it is cheaper to give up and use the fallback.
  let budget = Math.max(20000, W * H * (guess < 1 ? 8 : 2));
  while (heap.size && budget-- > 0) {
    const k = heap.pop();
    const d = k & 3;
    const cell = k >> 2;
    const x = cell % W;
    const y = (cell - x) / W;
    // At the stub's end the line may still turn into the stub (paid as a bend on the way in), as it
    // may turn right after leaving one: a port under header text is then reached from the side.
    if (x === gx && y === gy && d !== ((goalDir + 2) & 3)) return unwind(g, k, p, cost[k]!);
    const base = cost[k]!;
    const guessed = base + ahead(x, y, d);
    // Nothing still to come is cheaper than this: a caller that knows a better way already has its answer.
    if (guessed >= limit) return undefined;
    // Put on the heap again since, at a lower cost: that one has been taken further already.
    if (heap.taken > guessed) continue;
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
        c += (f ? len * share : len) + g.hSoft[e]! + OVERLAP * len * (g.hUsed[e]! - f) + RUN_ON_COST * len * g.hRun[e]!;
        if (!f && g.hRingOf[e] && g.hRingOf[e] !== ownA && g.hRingOf[e] !== ownB) c += g.hRing[e]!;
        if (strange) c += g.hZoneLen[e]! * strange.h[g.hZone[e]!]!;
        // Crossing a vertical line that runs straight through the point we step onto (a trunk-mate's
        // line is joined there, not crossed).
        if (ny > 0 && ny < H - 1 && g.vUsed[(ny - 1) * W + nx]! > g.vFriend[(ny - 1) * W + nx]! && g.vUsed[ny * W + nx]! > g.vFriend[ny * W + nx]!) c += CROSS;
      } else {
        const e = Math.min(y, ny) * W + x;
        if (g.vBlocked[e]) continue;
        const len = Math.abs(ys[ny]! - ys[y]!);
        const f = g.vFriend[e]!;
        c += (f ? len * share : len) + g.vSoft[e]! + OVERLAP * len * (g.vUsed[e]! - f) + RUN_ON_COST * len * g.vRun[e]!;
        if (!f && g.vRingOf[e] && g.vRingOf[e] !== ownA && g.vRingOf[e] !== ownB) c += g.vRing[e]!;
        if (strange) c += g.vZoneLen[e]! * strange.v[g.vZone[e]!]!;
        if (nx > 0 && nx < W - 1 && g.hUsed[ny * W + nx - 1]! > g.hFriend[ny * W + nx - 1]! && g.hUsed[ny * W + nx]! > g.hFriend[ny * W + nx]!) c += CROSS;
      }
      // Arriving at the goal in the wrong heading costs a bend.
      if (nx === gx && ny === gy && nd !== goalDir) c += BEND;
      const nk = (ny * W + nx) * 4 + nd;
      if (stamp[nk] !== gen || c < cost[nk]!) {
        stamp[nk] = gen;
        cost[nk] = c;
        prev[nk] = k;
        heap.push(nk, c + ahead(nx, ny, nd) - deep * c);
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
  /** The priority of what was taken off last. */
  taken = 0;
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
    this.taken = ps[0]!;
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
  if (p.fromSide === 'N') {
    const y = Math.min(p.start.y, p.goal.y);
    return [p.from, { x: p.from.x, y }, { x: p.to.x, y }, p.to];
  }
  const x = Math.max(p.start.x, p.goal.x) + 14;
  return [p.from, { x, y: p.from.y }, { x, y: p.to.y }, p.to];
}

/**
 * A line with bends set by hand: out of its port, through every bend point in order, into the other port.
 * Points that do not line up get a corner, so the line stays orthogonal when the boxes have moved since.
 */
export function throughVia(p: Pick<Ports, 'from' | 'to' | 'start' | 'goal' | 'fromSide' | 'toSide'>, via: Point[]): Point[] {
  const horizontal = (s: Side) => s === 'E' || s === 'W';
  const corner = (a: Point, b: Point, hFirst: boolean) => (a.x === b.x || a.y === b.y ? undefined : hFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y });
  // Out of the port: on along the stub, unless the first bend lies behind it (then turn first).
  const first = via[0]!;
  const ahead = (first.x - p.start.x) * normal[p.fromSide].x + (first.y - p.start.y) * normal[p.fromSide].y > 0;
  const pts: Point[] = [p.from, p.start];
  const c0 = corner(p.start, first, horizontal(p.fromSide) === ahead);
  if (c0) pts.push(c0);
  via.forEach((q, i) => {
    const c = i ? corner(via[i - 1]!, q, true) : undefined;
    if (c) pts.push(c);
    pts.push(q);
  });
  // Into the port: the last leg runs along the side's normal, so the corner turns onto it.
  const c1 = corner(via.at(-1)!, p.goal, !horizontal(p.toSide));
  if (c1) pts.push(c1);
  pts.push(p.goal, p.to);
  return pts;
}

function fallback(p: Ports): Point[] {
  const mx = (p.start.x + p.goal.x) / 2;
  return [p.from, p.start, { x: mx, y: p.start.y }, { x: mx, y: p.goal.y }, p.goal, p.to];
}

/** Drop duplicate and collinear points. */
/**
 * A line that crosses itself (a small loop taken to reach a straight end) is cut short where it
 * crosses: the loop goes, and the end is the stretch past the crossing, when that is still long
 * enough for an arrowhead.
 */
export function unloop(pts: Point[]): Point[] {
  for (let i = 1; i < pts.length; i++)
    for (let j = i + 2; j < pts.length; j++) {
      const [a, b, c, d] = [pts[i - 1]!, pts[i]!, pts[j - 1]!, pts[j]!];
      if (!properCross(a, b, c, d)) continue;
      const x = a.x === b.x ? { x: a.x, y: c.y } : { x: c.x, y: a.y };
      const room = (p: Point, q: Point) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
      if ((i === 1 && room(a, x) < 12) || (j === pts.length - 1 && room(x, d) < 12)) continue;
      return unloop([...pts.slice(0, i), x, ...pts.slice(j)]);
    }
  return pts;
}

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
  // Group borders and headers: a label there is moved off by opening room (layout's labelOnBorder),
  // so where nothing is clear it may go there rather than over two other lines.
  const zones: Box[] = [...input.soft, ...(input.labelZones ?? [])];
  // Every line, tagged with its edge: a label may sit on its own line but not on another.
  const lines: { edge: string; box: Box }[] = [];
  // With a little air: a label right beside another line seems to belong to that one.
  for (const [id, r] of routes) for (let i = 1; i < r.points.length; i++) lines.push({ edge: id, box: grow(segmentBox(r.points[i - 1]!, r.points[i]!), LABEL_AIR) });
  const overlap = (r: Box, t: Box) => r.x < t.x + t.width && t.x < r.x + r.width && r.y < t.y + t.height && t.y < r.y + r.height;
  let own = new Set<string>();
  // How much a spot covers: nothing (0), or a box or label (each counts 25), a group border or header (1.5) and other lines (each 1),
  // so where no spot is clear the label goes where it covers least.
  const hits = (r: Box) => {
    let n = 0;
    for (const t of taken) if (overlap(r, t)) n += 25;
    if (zones.some((t) => overlap(r, t))) n += 1.5;
    let crossed: Set<string> | undefined;
    for (const l of lines) if (!own.has(l.edge) && overlap(r, l.box)) (crossed ??= new Set()).add(l.edge);
    n += crossed?.size ?? 0;
    return n ? 1000 + 40 * n : crowd(r) + beyond(r);
  };
  // Past the edge of everything else, a label makes the drawing larger (and its text smaller on a slide): per pixel.
  const all = [...input.obstacles.values(), ...input.soft, ...[...routes.values()].flatMap((r) => r.points.map((q) => ({ x: q.x, y: q.y, width: 0, height: 0 })))];
  const edge = { x0: Math.min(...all.map((b) => b.x)), y0: Math.min(...all.map((b) => b.y)), x1: Math.max(...all.map((b) => b.x + b.width)), y1: Math.max(...all.map((b) => b.y + b.height)) };
  const beyond = (r: Box) => BEYOND * (Math.max(0, edge.x0 - r.x) + Math.max(0, r.x + r.width - edge.x1) + Math.max(0, edge.y0 - r.y) + Math.max(0, r.y + r.height - edge.y1));
  // Clear of other lines but near one, a label could be read as that one's: the nearer, the worse.
  const crowd = (r: Box) => {
    const near = new Map<string, number>();
    for (const l of lines) {
      if (own.has(l.edge)) continue;
      const b = l.box;
      const d = Math.max(b.x + LABEL_AIR - (r.x + r.width), r.x - (b.x + b.width - LABEL_AIR), b.y + LABEL_AIR - (r.y + r.height), r.y - (b.y + b.height - LABEL_AIR), 0);
      if (d < LABEL_NEAR) near.set(l.edge, Math.max(near.get(l.edge) ?? 0, LABEL_NEAR - d));
    }
    let n = 0;
    for (const v of near.values()) n += v;
    return CROWD * n;
  };
  for (const e of input.edges) {
    const route = routes.get(e.id);
    if (!e.label || !route) continue;
    own = new Set([e.id]);
    const { width, height } = e.label;
    // Room for end tags around words; a label of tags alone (no words) is placed as one box.
    const aside = e.label.aside && e.label.width - e.label.aside >= 16 ? e.label.aside : 0;
    const pts = route.points;
    // A line back to its own node: outside the loop, where it covers neither the node nor the arrowhead.
    if (e.from.node === e.to.node && pts.length === 4) {
      const [a, b] = [pts[1]!, pts[2]!];
      route.label = a.y === b.y ? { x: (a.x + b.x) / 2 - width / 2, y: a.y - 4 - height, width, height } : { x: a.x + 6, y: (a.y + b.y) / 2 - height / 2, width, height };
      taken.push(route.label);
      continue;
    }
    // Where on a piece the label lies clear of everything: per free stretch, the spot nearest the
    // middle. A long line through a few groups has little room between their borders, and the
    // fixed spots below would miss it.
    const clearSpots = (a: Point, b: Point): number[] => {
      const [along, size, across, thick] = a.y === b.y ? (['x', 'width', 'y', 'height'] as const) : (['y', 'height', 'x', 'width'] as const);
      const half = e.label![size] / 2;
      const [c0, c1] = [a[across] - e.label![thick] / 2, a[across] + e.label![thick] / 2];
      const [lo, hi] = [Math.min(a[along], b[along]) + half + 8, Math.max(a[along], b[along]) - half - 8];
      const shut = [...taken, ...zones, ...lines.filter((l) => !own.has(l.edge)).map((l) => l.box)]
        .filter((t) => t[across] < c1 && t[across] + t[thick] > c0)
        .map((t) => [t[along] - half, t[along] + t[size] + half] as const)
        .sort((p, q) => p[0] - q[0]);
      const middle = (a[along] + b[along]) / 2;
      const out: number[] = [];
      let from = lo;
      for (const [start, end] of [...shut, [hi, Infinity] as const]) {
        if (from <= Math.min(start, hi)) out.push(Math.min(Math.max(middle, from), Math.min(start, hi)));
        from = Math.max(from, end);
      }
      return out.map((v) => (v - a[along]) / (b[along] - a[along]));
    };
    // Where the label could go on these pieces of the line, each with how bad it is there.
    const spots = (pieces: [Point, Point][], alone: boolean) => {
      const found: { box: Box; score: number }[] = [];
      const total = pieces.length;
      pieces.forEach(([a, b], k) => {
        const horizontal = a.y === b.y;
        const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
        const middle = Math.abs(k + 0.5 - total / 2);
        for (const t of [0.5, 0.35, 0.65, 0.2, 0.8, ...clearSpots(a, b)]) {
          const c = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
          // On the line: prefer horizontal, long, central segments. A pill on a horizontal line keeps
          // some line visible either side, or the line would seem to end in the label.
          // A pill hanging past the end of its piece lies on the bend: where the piece has room, its middle is better.
          const half = (horizontal ? width : height) / 2;
          const hangs = Math.min(t, 1 - t) * len < half + 4 ? OVERHANG : 0;
          if (len >= (horizontal ? width + 16 : height + 16)) {
            const box = { x: c.x - width / 2, y: c.y - height / 2, width, height };
            const covers = horizontal && alone && len < width + 28 ? 100 : 0;
            // Words across a vertical line read as struck through: a short label may sit on it, a long one goes beside it.
            // (Beside it, where that is clear, always reads better: a pill there costs more than any spot beside.)
            const over = width - aside - STRUCK;
            const struck = horizontal || over <= 0 ? 0 : STRUCK_COST + over * 0.5;
            found.push({ box, score: (horizontal ? 0 : 60) + struck + covers + hangs + middle * 10 + Math.abs(t - 0.5) * 40 - Math.min(len, 300) * 0.1 + hits(box) });
          }
          // Above or below a horizontal line too short for a pill on it (a short hop between layers),
          // or with no room on it: two lines close together get their labels on the far sides.
          const short = alone && len >= 24 && len < width + 28;
          if (horizontal && (t === 0.5 || !short) && (short || len >= width + 16) && Math.abs(t - 0.5) < 0.2)
            for (const side of [-1, 1]) {
              const y = side < 0 ? c.y - 3 - height : c.y + 3;
              const box = { x: c.x - width / 2, y, width, height };
              found.push({ box, score: (short ? 95 : 110) + middle * 10 + Math.abs(t - 0.5) * 40 + (side > 0 ? 5 : 0) + hits(box) });
            }
          // Beside a vertical line, when it is too short or crowded for a pill on it.
          // Only the words stand beside it: the room for end tags (aside) is half each side of them, so the box reaches over the line.
          if (!horizontal && len >= height + 8)
            for (const side of [1, -1]) {
              const words = { x: side > 0 ? c.x + 3 : c.x - 3 - (width - aside), y: c.y - height / 2, width: width - aside, height };
              const box = { ...words, x: words.x - aside / 2, width };
              // The whole box still keeps off cards and other labels: it is what the drawing measures.
              const covers = aside && taken.some((q) => overlap(box, q)) ? 1000 : 0;
              found.push({ box, score: 90 + middle * 10 + Math.abs(t - 0.5) * 40 + (side < 0 ? 5 : 0) + Math.max(hits(words), covers) });
            }
        }
      });
      return found.sort((p, q) => p.score - q.score);
    };
    const candidates = spots(pts.slice(1).map((b, i) => [pts[i]!, b]), pts.length === 2);
    if (!candidates[0] || candidates[0].score >= 500) bad++;
    const best = candidates[0]?.box ?? midLabel(pts, width, height);
    route.label = best;
    taken.push(best);
  }
  return bad;
}

function grow(b: Box, by: number): Box {
  return { x: b.x - by, y: b.y - by, width: b.width + 2 * by, height: b.height + 2 * by };
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
