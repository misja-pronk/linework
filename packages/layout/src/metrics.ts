// Layout quality, measured. Used to compare layout strategies and to guard against regressions.
import type { Box, Graph, GraphEdge, Placed, Point } from '@cartography/core';

export interface LayoutMetrics {
  /** Pairs of edge segments that cross. */
  crossings: number;
  /** Edge segments running through a node that is not one of the edge's ends. */
  edgeThroughNode: number;
  /** Edge labels overlapping a node or another label. */
  labelOverlaps: number;
  bends: number;
  /** Total edge length divided by the median node width, so diagrams of any size compare. */
  edgeLength: number;
  /** Edges whose general direction goes against the diagram direction. */
  backward: number;
  /** Width / height of the drawing. */
  aspect: number;
  /** Share of the drawing covered by nodes; low means lots of empty space. */
  density: number;
  /** Width and height of the drawing. */
  width: number;
  height: number;
  /** Mean of route length / manhattan distance between the ends; 1 is a perfectly direct drawing. */
  detour: number;
  /** Sum over edges of the length beyond direct, in median node widths (each capped at 3). */
  detourExcess: number;
  /** Mean share of each group's inside that is far from anything it holds (0 is a snug group). */
  groupEmpty: number;
  /** Share of the whole drawing far from every node and group: holes and empty corners. */
  voids: number;
  /** Share of nodes whose centre lines up across the flow (same row in a left-to-right diagram) with another node. */
  aligned: number;
  /** Parallel stretches of unrelated lines closer than MIN_GAP (or on top of each other). */
  tightPairs: number;
  /** Smallest gap between parallel lines that run side by side (0 when none do). */
  minGap: number;
  /** How unevenly bundled lines are spaced: per line between two neighbours, |left - right| / max. */
  uneven: number;
  /** Labels on a group border or header, and lines running along a border or through a header. */
  borderHits: number;
  /** Line ends on one node side closer together than MIN_GAP (shared trunk ends excepted). */
  portCrowding: number;
  /** Groups lying over each other (neither inside the other), and nodes lying in a group they are not in. */
  overlaps: number;
  /** Lines over a group header: through the header of a group that holds neither end, or running along inside any header. */
  headerHits: number;
  /** Length of line inside groups that hold neither of its ends, in median node widths (nested groups each count). */
  foreign: number;
  /** Small steps: a piece shorter than JOG between two pieces that run the same way. */
  jogs: number;
  /** Labels lying on a bend of their own line. */
  labelOnBend: number;
  /** Labels with another line running through or right along them (labelMetrics). */
  labelTouching: number;
  /** Long labels a vertical line runs right through, their own or another: the words read as crossed out (labelMetrics). */
  labelStruck: number;
  /** How ragged sibling groups of one kind are: per pair lying side by side, how far their starts and ends are apart. */
  siblingSpread: number;
  /** Pairs of groups in one parent standing side by side against the order they are written in. */
  disorder: number;
}

/** Lines closer than this read as one smudge. */
const MIN_GAP = 8;
/** Farther than this from every box is a hole in the drawing (more than a wide gap between layers). */
const VOID = 96;
/** Parallel lines within this distance count as one bundle. */
const BUNDLE = 40;
/** A step shorter than this in a line that runs on the same way reads as a kink. */
const JOG = 40;

type Seg = [Point, Point];

/**
 * `titles` is the room each group's title takes (its least width, as layout got it); without it
 * the title's extent is guessed from its text.
 */
export function measure(graph: Graph, placed: Placed, header = 44, titles?: Map<string, number>): LayoutMetrics {
  const segs = new Map<string, Seg[]>();
  for (const e of graph.edges) {
    const pts = placed.edges.get(e.id)?.points ?? [];
    segs.set(e.id, pts.slice(1).map((p, i) => [pts[i]!, p] as Seg));
  }

  let crossings = 0;
  const ids = [...segs.keys()];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      for (const a of segs.get(ids[i]!)!) for (const b of segs.get(ids[j]!)!) if (properCross(a, b)) crossings++;

  let edgeThroughNode = 0;
  for (const e of graph.edges)
    for (const [id, box] of placed.nodes) {
      if (id === e.from.node || id === e.to.node) continue;
      if (segs.get(e.id)!.some((s) => segmentHitsBox(s, inset(box, 2)))) edgeThroughNode++;
    }

  const labels = [...placed.edges.values()].map((e) => e.label).filter((l): l is Box => !!l);
  let labelOverlaps = 0;
  for (const [i, l] of labels.entries()) {
    for (const n of placed.nodes.values()) if (overlaps(l, n)) labelOverlaps++;
    for (const m of labels.slice(i + 1)) if (overlaps(l, m)) labelOverlaps++;
  }

  let bends = 0;
  let length = 0;
  let backward = 0;
  for (const e of graph.edges) {
    const pts = placed.edges.get(e.id)?.points ?? [];
    bends += Math.max(0, pts.length - 2);
    for (const [a, b] of segs.get(e.id)!) length += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    const s = pts[0];
    const t = pts[pts.length - 1];
    if (!e.loose && s && t && (graph.direction === 'down' ? t.y < s.y - 1 : t.x < s.x - 1)) backward++;
  }

  const widths = [...placed.nodes.values()].map((b) => b.width).sort((a, b) => a - b);
  const unit = widths[Math.floor(widths.length / 2)] ?? 1;
  const nodeArea = [...placed.nodes.values()].reduce((s, b) => s + b.width * b.height, 0);
  const beauty = beautyMetrics(graph, placed, segs, header, unit, titles);
  const { labelTouching, labelStruck } = labelMetrics(graph, placed);
  return {
    ...beauty,
    labelTouching,
    labelStruck,
    crossings,
    edgeThroughNode,
    labelOverlaps,
    overlaps: boxOverlaps(graph, placed).length,
    bends,
    edgeLength: Math.round((length / unit) * 10) / 10,
    backward,
    aspect: Math.round((placed.width / Math.max(1, placed.height)) * 100) / 100,
    density: Math.round((nodeArea / Math.max(1, placed.width * placed.height)) * 1000) / 1000,
    width: Math.round(placed.width),
    height: Math.round(placed.height),
  };
}

/**
 * One number to minimise. Weights reflect what readers notice most: lines through boxes and
 * covered labels are errors; crossings and detours hurt; shape matters for slides (target 16:9).
 */
export function score(m: LayoutMetrics, targetAspect = 16 / 9): number {
  // Anything from about square to wide reads fine on a page or slide; only extremes cost.
  const aspectPenalty = Math.max(0, Math.abs(Math.log(m.aspect / targetAspect)) - Math.log(1.8));
  return (
    m.edgeThroughNode * 200 +
    m.labelOverlaps * 200 +
    m.overlaps * 200 +
    m.crossings * 12 +
    m.backward * 8 +
    m.bends * 2.5 +
    m.edgeLength * 0.6 +
    aspectPenalty * 25 +
    (1 - m.density) * 20 +
    m.detourExcess * 15 +
    m.groupEmpty * 40 +
    m.voids * 80 +
    (1 - m.aligned) * 12 +
    m.tightPairs * 6 +
    m.uneven * 4 +
    m.labelTouching * 8 +
    m.labelStruck * 0 +
    m.borderHits * 25 +
    m.headerHits * 10 +
    m.foreign * 6 +
    m.disorder * 6 +
    m.portCrowding * 8
  );
}

/**
 * Groups of one parent that stand side by side (across the flow) read in the order they are
 * written: the first one left (or on top, in a left-to-right drawing). Counts the pairs that do not.
 */
export function disorder(graph: Graph, groups: Map<string, Box>): number {
  const down = graph.direction === 'down';
  let n = 0;
  for (const [i, first] of graph.groups.entries())
    for (const second of graph.groups.slice(i + 1)) {
      const [a, b] = [groups.get(first.id), groups.get(second.id)];
      if (!a || !b || first.parent !== second.parent) continue;
      const beside = down ? a.y < b.y + b.height && b.y < a.y + a.height : a.x < b.x + b.width && b.x < a.x + a.width;
      if (beside && (down ? b.x + b.width <= a.x + 1 : b.y + b.height <= a.y + 1)) n++;
    }
  return n;
}

/**
 * Boxes that lie over each other and should not: two groups of which neither holds the other, and a
 * node in a group it does not belong to. Each as "a×b", for messages and tests.
 */
export function boxOverlaps(graph: Graph, placed: Pick<Placed, 'nodes' | 'groups'>): string[] {
  const parent = new Map(graph.groups.map((g) => [g.id, g.parent]));
  const within = (id: string | undefined, group: string) => {
    for (let g = id; g; g = parent.get(g)) if (g === group) return true;
    return false;
  };
  // Borders may touch (a shared edge is drawn once); a pixel of rounding is not an overlap.
  const hit = (a: Box, b: Box) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
  const out: string[] = [];
  const groups = graph.groups.filter((g) => placed.groups.has(g.id));
  for (const [i, a] of groups.entries())
    for (const b of groups.slice(i + 1)) if (!within(a.id, b.id) && !within(b.id, a.id) && hit(placed.groups.get(a.id)!, placed.groups.get(b.id)!)) out.push(`${a.id}×${b.id}`);
  for (const n of graph.nodes) {
    const box = placed.nodes.get(n.id);
    if (box) for (const g of groups) if (!within(n.parent, g.id) && hit(box, placed.groups.get(g.id)!)) out.push(`${n.id}×${g.id}`);
  }
  return out;
}

/** A label nearer than this to another line seems to belong to it. */
const LABEL_AIR = 6;
/** Wider than this, a label with a vertical line right through it reads as crossed out. */
const STRUCK = 56;

/**
 * Labels that read wrong: `far` sit clear of their own line (more than a few pixels from every piece
 * of it), `touching` have another line running through them or right along them.
 */
export function labelMetrics(graph: Graph, placed: Pick<Placed, 'edges'>): { labelFar: number; labelTouching: number; labelStruck: number } {
  const grow = (b: Box, by: number): Box => ({ x: b.x - by, y: b.y - by, width: b.width + 2 * by, height: b.height + 2 * by });
  const hits = (b: Box, [p, q]: Seg) =>
    Math.max(p.x, q.x) >= b.x && Math.min(p.x, q.x) <= b.x + b.width && Math.max(p.y, q.y) >= b.y && Math.min(p.y, q.y) <= b.y + b.height;
  const segsOf = (id: string) => {
    const pts = placed.edges.get(id)?.points ?? [];
    return pts.slice(1).map((p, i) => [pts[i]!, p] as Seg);
  };
  let labelFar = 0;
  let labelTouching = 0;
  let labelStruck = 0;
  // A vertical piece right through a long label, top to bottom, away from its ends.
  const through = (b: Box, [p, q]: Seg) =>
    p.x === q.x && p.x > b.x + 6 && p.x < b.x + b.width - 6 && Math.min(p.y, q.y) < b.y + 2 && Math.max(p.y, q.y) > b.y + b.height - 2;
  const lines = graph.edges.map((o) => segsOf(o.id));
  for (const e of graph.edges) {
    const box = placed.edges.get(e.id)?.label;
    if (!box) continue;
    if (box.width > STRUCK && lines.some((l) => l.some((s) => through(box, s)))) labelStruck++;
    if (!segsOf(e.id).some((s) => hits(grow(box, LABEL_AIR), s))) labelFar++;
    const near = grow(box, LABEL_AIR - 1);
    // Lines that share this line's ends run into the same card beside it: only lines that pass count.
    if (graph.edges.some((o) => o.id !== e.id && segsOf(o.id).some((s) => hits(near, s) && !endsAt(s, placed.edges.get(e.id)!.points)))) labelTouching++;
  }
  return { labelFar, labelTouching, labelStruck };
}

/** A piece that starts or ends where the line does (a sibling leaving the same port). */
function endsAt([p, q]: Seg, pts: Point[]): boolean {
  const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
  const ends = [pts[0]!, pts[pts.length - 1]!];
  return ends.some((x) => same(x, p) || same(x, q));
}

/** Ends that say how many (an ERD's crow's feet). */
const COUNTED = new Set(['one', 'zeroOrOne', 'many', 'oneOrMany', 'zeroOrMany']);

/**
 * A line that may share a trunk: nothing on it says which line it is (no label, step number, end
 * tags or other marks), and no crow's feet, except between table rows: the lines into one key
 * row all end in the same mark there and may come in as one.
 */
export function plainLine(e: GraphEdge): boolean {
  if (e.label || e.step != null || e.marks?.length || e.ends?.from?.length || e.ends?.to?.length) return false;
  return (!!e.from.row && !!e.to.row) || (!COUNTED.has(e.start) && !COUNTED.has(e.end));
}

/** Two lines nearer than this end to end on one track read as one line. */
const MEET = 8;

/**
 * Pairs of lines that run on one track (on top of each other, or end to end) and may not: they are
 * not one trunk, so the ink they share draws a link between their far ends that the source does not
 * have, or puts a label or end tag where it could belong to either. Each as "a+b".
 */
export function falseJoins(graph: Graph, placed: Pick<Placed, 'edges'>): string[] {
  const segsOf = (id: string) => {
    const pts = placed.edges.get(id)?.points ?? [];
    return pts.slice(1).map((p, i) => [pts[i]!, p] as Seg);
  };
  // One trunk: lines drawn alike from one start or into one end. Lines that leave one row (a data
  // product's output port) start as one whatever they look like: the row is what they share.
  const port = (a: GraphEdge, b: GraphEdge) => !!a.from.row && a.from.node === b.from.node && a.from.row === b.from.row;
  const alike = (a: GraphEdge, b: GraphEdge) => a.line === b.line && a.tone === b.tone && a.start === b.start && a.end === b.end;
  const may = (a: GraphEdge, b: GraphEdge) =>
    plainLine(a) && plainLine(b) && (port(a, b) || (alike(a, b) && ((a.from.node === b.from.node && a.from.row === b.from.row) || (a.to.node === b.to.node && a.to.row === b.to.row))));
  const track = ([p, q]: Seg, [r, t]: Seg) => {
    const flat = (s: Point, u: Point) => (s.y === u.y ? 'h' : s.x === u.x ? 'v' : '');
    const k = flat(p, q);
    if (!k || k !== flat(r, t)) return false;
    const [at, along] = k === 'h' ? (['y', 'x'] as const) : (['x', 'y'] as const);
    if (Math.abs(p[at] - r[at]) > 0.5) return false;
    const gap = Math.max(Math.min(p[along], q[along]), Math.min(r[along], t[along])) - Math.min(Math.max(p[along], q[along]), Math.max(r[along], t[along]));
    return gap < MEET;
  };
  const out: string[] = [];
  const edges = graph.edges.filter((e) => placed.edges.has(e.id));
  for (const [i, a] of edges.entries())
    for (const b of edges.slice(i + 1)) {
      if (may(a, b)) continue;
      const sa = segsOf(a.id);
      const sb = segsOf(b.id);
      if (sa.some((x) => sb.some((y) => track(x, y)))) out.push(`${a.id}+${b.id}`);
    }
  return out;
}

/** Two ends with a mark nearer than this (and not on one spot) draw their arrowheads over each other. */
const HEADS = 12;
/** A crossing this near a line's end, or a line in and one out this near on one side, sits right at the card. */
const NEAR_END = 24;

/**
 * Lines that are drawn in a way that misleads, each counted once per line (or pair):
 * - `loops`: a line that crosses itself (a small loop before its end);
 * - `hooks`: two lines that cross right at one's end (a hook out of the card over its neighbour),
 *   or a line that leaves, turns and comes back on itself within a lane (a U at its end);
 * - `heads`: marked ends into one node side so near that their arrowheads lie on each other, or two
 *   lines that are not one trunk coming into one spot from different ways (one arrowhead for two);
 * - `continuations`: a line into a node side and another out of that side right beside it, or two
 *   lines meeting end to start on a straight track, so one seems to run on into the other.
 */
export function lineFaults(graph: Graph, placed: Pick<Placed, 'edges'>): { loops: number; hooks: number; heads: number; continuations: number } {
  const ptsOf = (id: string) => placed.edges.get(id)?.points ?? [];
  const segsOf = (pts: Point[]) => pts.slice(1).map((p, i) => [pts[i]!, p] as Seg);
  const edges = graph.edges.filter((e) => ptsOf(e.id).length >= 2 && e.from.node !== e.to.node);
  const dist = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const way = (a: Point, b: Point) => (a.x === b.x ? (b.y > a.y ? 'S' : 'N') : b.x > a.x ? 'E' : 'W');
  let loops = 0;
  let hooks = 0;
  let heads = 0;
  let continuations = 0;
  for (const e of edges) {
    const pts = ptsOf(e.id);
    const segs = segsOf(pts);
    if (segs.some((a, i) => segs.slice(i + 2).some((b) => properCross(a, b)))) loops++;
    // A U at an end: out, a short step aside, and straight back past where it started.
    for (const q of [pts, [...pts].reverse()]) {
      if (q.length < 4) continue;
      const [a, b, c, d] = q as [Point, Point, Point, Point];
      if (dist(b, c) < NEAR_END && way(a, b) !== way(b, c) && way(c, d) === ({ N: 'S', S: 'N', E: 'W', W: 'E' } as const)[way(a, b)]) hooks++;
    }
  }
  for (const [i, a] of edges.entries())
    for (const b of edges.slice(i + 1)) {
      const pa = ptsOf(a.id);
      const pb = ptsOf(b.id);
      const ends = [pa[0]!, pa[pa.length - 1]!, pb[0]!, pb[pb.length - 1]!];
      // Crossing right at an end.
      const sa = segsOf(pa);
      const sb = segsOf(pb);
      if (sa.some((x) => sb.some((y) => properCross(x, y) && ends.some((p) => dist(p, crossAt(x, y)) < NEAR_END)))) hooks++;
      // Ends with marks into one node.
      for (const [ea, ia] of [[a.end, 'to'], [a.start, 'from']] as const)
        for (const [eb, ib] of [[b.end, 'to'], [b.start, 'from']] as const) {
          if (a[ia].node !== b[ib].node || (ea === 'none' && eb === 'none')) continue;
          const p = ia === 'to' ? pa[pa.length - 1]! : pa[0]!;
          const q = ib === 'to' ? pb[pb.length - 1]! : pb[0]!;
          const d = dist(p, q);
          const inA = ia === 'to' ? way(pa[pa.length - 2]!, p) : way(pa[1]!, p);
          const inB = ib === 'to' ? way(pb[pb.length - 2]!, q) : way(pb[1]!, q);
          if (inA !== inB) continue;
          if (d > 0.5 && d < HEADS && ea !== 'none' && eb !== 'none') heads++;
          // On one spot: one arrowhead for two lines that do not share their last stretch (one comes in from the side).
          else if (d <= 0.5 && ea === eb && ea !== 'none') {
            const lastA = ia === 'to' ? pa[pa.length - 2]! : pa[1]!;
            const lastB = ib === 'to' ? pb[pb.length - 2]! : pb[1]!;
            if (!(a.line === b.line && a.tone === b.tone && plainLine(a) && plainLine(b)) || dist(lastA, lastB) > 0.5 && Math.min(dist(lastA, p), dist(lastB, q)) < NEAR_END) heads++;
          }
        }
      // One in and one out beside each other on one side of a node.
      for (const [x, px, y, py] of [[a, pa, b, pb], [b, pb, a, pa]] as const) {
        if (x.to.node !== y.from.node || x.from.node === y.to.node) continue;
        const p = px[px.length - 1]!;
        const q = py[0]!;
        const inWay = way(px[px.length - 2]!, p);
        const outWay = way(q, py[1]!);
        const sameSide = ({ N: 'S', S: 'N', E: 'W', W: 'E' } as const)[inWay] === outWay;
        if (sameSide && dist(p, q) < NEAR_END && dist(p, q) > 0.5) continuations++;
      }
    }
  return { loops, hooks, heads, continuations };
}

/** Where two crossing pieces (one level, one upright) meet. */
function crossAt([p, q]: Seg, [r]: Seg): Point {
  return p.y === q.y ? { x: r.x, y: p.y } : { x: p.x, y: r.y };
}

/** Lines that may share ink: same start or same end, drawn alike (a trunk that branches). */
function siblings(a: GraphEdge, b: GraphEdge): boolean {
  return (a.from.node === b.from.node || a.to.node === b.to.node) && a.line === b.line && a.tone === b.tone;
}

function beautyMetrics(graph: Graph, placed: Placed, segs: Map<string, Seg[]>, header: number, unit: number, titles?: Map<string, number>) {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const byId = new Map(graph.edges.map((e) => [e.id, e]));

  // Detour: route length against the manhattan distance between its two ends.
  let ratioSum = 0;
  let detourExcess = 0;
  let counted = 0;
  for (const e of graph.edges) {
    const pts = placed.edges.get(e.id)?.points ?? [];
    if (pts.length < 2 || e.from.node === e.to.node) continue;
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    const len = segs.get(e.id)!.reduce((s, [p, q]) => s + Math.abs(q.x - p.x) + Math.abs(q.y - p.y), 0);
    const direct = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    ratioSum += len / Math.max(24, direct);
    detourExcess += Math.min(3, Math.max(0, len - direct) / unit);
    counted++;
  }

  // Empty room in groups: sample the inside (below the header) and count points far from any child.
  const kidsOf = (g: string) => [
    ...graph.nodes.filter((n) => n.parent === g).map((n) => placed.nodes.get(n.id)),
    ...graph.groups.filter((c) => c.parent === g).map((c) => placed.groups.get(c.id)),
  ].filter((b): b is Box => !!b);
  let emptySum = 0;
  let groupsCounted = 0;
  for (const g of graph.groups) {
    const box = placed.groups.get(g.id);
    const kids = kidsOf(g.id);
    if (!box || !kids.length) continue;
    const step = 24;
    let total = 0;
    let empty = 0;
    for (let y = box.y + header + step / 2; y < box.y + box.height; y += step)
      for (let x = box.x + step / 2; x < box.x + box.width; x += step) {
        total++;
        if (!kids.some((k) => boxDistance(k, x, y) < 64)) empty++;
      }
    if (total) {
      emptySum += empty / total;
      groupsCounted++;
    }
  }

  // Alignment across the flow: centres sharing a row (left-to-right) or column (top-down).
  const centres = [...placed.nodes.values()].map((b) => (graph.direction === 'down' ? b.x + b.width / 2 : b.y + b.height / 2));
  const aligned = centres.filter((c, i) => centres.some((d, j) => j !== i && Math.abs(c - d) < 1)).length;

  // Parallel segments: tight pairs, smallest gap, uneven bundles.
  type S = { edge: string; h: boolean; at: number; lo: number; hi: number };
  const all: S[] = [];
  for (const [id, list] of segs)
    for (const [a, b] of list) {
      const h = a.y === b.y;
      if (!h && a.x !== b.x) continue;
      all.push(h ? { edge: id, h, at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) } : { edge: id, h, at: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
    }
  let tightPairs = 0;
  let minGap = Infinity;
  const near = all.map(() => [] as number[]);
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]!;
      const b = all[j]!;
      if (a.h !== b.h || a.edge === b.edge) continue;
      if (Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) < 8) continue;
      const d = Math.abs(a.at - b.at);
      if (d >= BUNDLE) continue;
      const sib = siblings(byId.get(a.edge)!, byId.get(b.edge)!);
      if (d < 0.5 && sib) continue; // a shared trunk: one line on purpose
      if (d < MIN_GAP) tightPairs++;
      if (d >= 0.5) {
        minGap = Math.min(minGap, d);
        near[i]!.push(b.at - a.at);
        near[j]!.push(a.at - b.at);
      }
    }
  let uneven = 0;
  for (const list of near) {
    const left = Math.max(-Infinity, ...list.filter((d) => d < 0));
    const right = Math.min(Infinity, ...list.filter((d) => d > 0));
    if (left > -Infinity && right < Infinity) uneven += Math.abs(-left - right) / Math.max(-left, right);
  }

  // Group borders and headers: no label on them, no line running along a border or through a header.
  let borderHits = 0;
  const labels = [...placed.edges.values()].map((e) => e.label).filter((l): l is Box => !!l);
  for (const g of graph.groups) {
    const b = placed.groups.get(g.id);
    if (!b) continue;
    const head = { x: b.x, y: b.y, width: b.width, height: Math.min(header, b.height) };
    const t = 3;
    const bands = [
      { x: b.x - t, y: b.y - t, width: b.width + 2 * t, height: 2 * t },
      { x: b.x - t, y: b.y + b.height - t, width: b.width + 2 * t, height: 2 * t },
      { x: b.x - t, y: b.y - t, width: 2 * t, height: b.height + 2 * t },
      { x: b.x + b.width - t, y: b.y - t, width: 2 * t, height: b.height + 2 * t },
    ];
    for (const l of labels) if (overlaps(l, head) || bands.some((r) => overlaps(l, r))) borderHits++;
    // Where the title ends: its least width less the air kept beside it, or about 7px a letter.
    const end = titles?.has(g.id) ? titles.get(g.id)! - 40 : Math.min(212, 44 + 7 * (g.label.length + (g.caption?.length ?? 0)));
    for (const s of all) {
      const along = s.h ? [b.y, b.y + b.height].some((v) => Math.abs(s.at - v) < t) && Math.min(s.hi, b.x + b.width) - Math.max(s.lo, b.x) > 12
        : [b.x, b.x + b.width].some((v) => Math.abs(s.at - v) < t) && Math.min(s.hi, b.y + b.height) - Math.max(s.lo, b.y) > 12;
      // Through the header text: the title is drawn 13 to 31px below the top, from 12px in (a line
      // passing under it, in a top-down header's lane, or beside it is fine).
      const [t0, t1, a0, a1] = s.h ? [b.x + 12, b.x + Math.min(b.width - 12, end), b.y + 13, b.y + 31] : [b.y + 13, b.y + 31, b.x + 12, b.x + Math.min(b.width - 12, end)];
      const through = s.at > a0 && s.at < a1 && s.lo < t1 && s.hi > t0;
      if (along || through) borderHits++;
    }
  }

  // Port crowding: ends on one node side closer than MIN_GAP, unless they are one shared end.
  let portCrowding = 0;
  const ends: { node: string; side: string; at: number; edge: GraphEdge }[] = [];
  for (const e of graph.edges) {
    const pts = placed.edges.get(e.id)?.points ?? [];
    if (pts.length < 2) continue;
    for (const [node, p, q] of [[e.from.node, pts[0]!, pts[1]!], [e.to.node, pts[pts.length - 1]!, pts[pts.length - 2]!]] as const) {
      const side = p.y === q.y ? (q.x > p.x ? 'E' : 'W') : q.y > p.y ? 'S' : 'N';
      ends.push({ node, side, at: p.y === q.y ? p.y : p.x, edge: e });
    }
  }
  for (let i = 0; i < ends.length; i++)
    for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i]!;
      const b = ends[j]!;
      if (a.node !== b.node || a.side !== b.side || a.edge === b.edge) continue;
      const d = Math.abs(a.at - b.at);
      if (d < MIN_GAP && !(d < 0.5 && siblings(a.edge, b.edge))) portCrowding++;
    }

  // Headers and foreign groups: a line has no business in a group that holds neither of its ends,
  // least of all over its header; inside any header it may cross (on its way in) but not run along.
  // Lanes are bands across the drawing with their name at the start: lines cross them freely.
  const parent = new Map(graph.groups.map((g) => [g.id, g.parent]));
  const nodeParent = new Map(graph.nodes.map((n) => [n.id, n.parent]));
  const home = (e: GraphEdge) => {
    const out = new Set<string>();
    for (const end of [e.from.node, e.to.node]) for (let g = parent.has(end) ? end : nodeParent.get(end); g && !out.has(g); g = parent.get(g)) out.add(g);
    return out;
  };
  let headerHits = 0;
  let foreign = 0;
  for (const e of graph.edges) {
    const list = segs.get(e.id)!;
    if (!list.length) continue;
    const own = home(e);
    for (const g of graph.groups) {
      const b = placed.groups.get(g.id);
      if (!b || g.lane) continue;
      const away = !own.has(g.id);
      const head = { x: b.x + 1, y: b.y + 1, width: b.width - 2, height: Math.min(header, b.height) - 2 };
      let hit = false;
      for (const s of list) {
        const [x0, x1, y0, y1] = [Math.min(s[0].x, s[1].x), Math.max(s[0].x, s[1].x), Math.min(s[0].y, s[1].y), Math.max(s[0].y, s[1].y)];
        if (away) foreign += lengthInside(s, b);
        if (!segmentHitsBox(s, head)) continue;
        if (away || (y0 === y1 && Math.min(x1, head.x + head.width) - Math.max(x0, head.x) > 12)) hit = true;
      }
      if (hit) headerHits++;
    }
  }

  // Jogs, and labels on a bend of their own line.
  let jogs = 0;
  let labelOnBend = 0;
  for (const e of graph.edges) {
    const pe = placed.edges.get(e.id);
    const pts = pe?.points ?? [];
    for (let i = 1; i + 2 < pts.length; i++) {
      const [a, b, c, d] = [pts[i - 1]!, pts[i]!, pts[i + 1]!, pts[i + 2]!];
      const step = Math.abs(c.x - b.x) + Math.abs(c.y - b.y);
      const same = Math.sign(b.x - a.x) === Math.sign(d.x - c.x) && Math.sign(b.y - a.y) === Math.sign(d.y - c.y);
      if (step < JOG && same) jogs++;
    }
    const l = pe?.label;
    if (l && pts.slice(1, -1).some((p) => p.x > l.x - 2 && p.x < l.x + l.width + 2 && p.y > l.y - 2 && p.y < l.y + l.height + 2)) labelOnBend++;
  }

  // Sibling groups of one kind (the zones of a network, the subnets of a zone): side by side they
  // start and end on one line, stacked they are equally wide.
  let siblingSpread = 0;
  const sets = new Map<string, Box[]>();
  for (const g of graph.groups) {
    const b = placed.groups.get(g.id);
    if (b) sets.set(siblingSet(g), [...(sets.get(siblingSet(g)) ?? []), b]);
  }
  for (const list of sets.values())
    for (const [i, a] of list.entries())
      for (const b of list.slice(i + 1)) {
        const row = a.y < b.y + b.height && b.y < a.y + a.height;
        const column = a.x < b.x + b.width && b.x < a.x + a.width;
        if (row === column) continue;
        const apart = row ? Math.abs(a.y - b.y) + Math.abs(a.y + a.height - b.y - b.height) : Math.abs(a.x - b.x) + Math.abs(a.x + a.width - b.x - b.width);
        siblingSpread += Math.min(1, apart / Math.max(1, row ? Math.max(a.height, b.height) : Math.max(a.width, b.width)));
      }

  return {
    headerHits,
    foreign: r2(foreign / unit),
    jogs,
    labelOnBend,
    siblingSpread: r2(siblingSpread),
    disorder: disorder(graph, placed.groups),
    detour: counted ? r2(ratioSum / counted) : 1,
    detourExcess: r2(detourExcess),
    groupEmpty: groupsCounted ? r2(emptySum / groupsCounted) : 0,
    voids: voidShare(placed),
    aligned: centres.length ? r2(aligned / centres.length) : 1,
    tightPairs,
    minGap: minGap === Infinity ? 0 : r2(minGap),
    uneven: r2(uneven),
    borderHits,
    portCrowding,
  };
}

/** Groups with the same answer are siblings of one kind: they read as a set. */
/** The share of the drawing far from every node and group (the voids of measure): boxes alone decide it, before any line is routed. */
export function voidShare(placed: Pick<Placed, 'nodes' | 'groups'>): number {
  const { samples, holes } = voidSamples(placed);
  return samples ? Math.round((holes / samples) * 100) / 100 : 0;
}

// Voids: points of the drawing far from every box. Lines through a hole do not fill it.
function voidSamples(placed: Pick<Placed, 'nodes' | 'groups'>): { samples: number; holes: number } {
  const boxes = [...placed.nodes.values(), ...placed.groups.values()];
  let samples = 0;
  let holes = 0;
  if (boxes.length) {
    const x0 = Math.min(...boxes.map((b) => b.x));
    const y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.width));
    const y1 = Math.max(...boxes.map((b) => b.y + b.height));
    const step = Math.max(24, Math.sqrt(((x1 - x0) * (y1 - y0)) / 2500));
    for (let y = y0 + step / 2; y < y1; y += step)
      for (let x = x0 + step / 2; x < x1; x += step) {
        samples++;
        if (!boxes.some((b) => boxDistance(b, x, y) < VOID)) holes++;
      }
  }
  return { samples, holes };
}

export function siblingSet(g: Graph['groups'][number]): string {
  return `${g.parent ?? ''}|${g.kind ?? `${g.icon ?? ''}/${g.tone}/${g.border}`}`;
}

function boxDistance(b: Box, x: number, y: number): number {
  const dx = Math.max(b.x - x, 0, x - b.x - b.width);
  const dy = Math.max(b.y - y, 0, y - b.y - b.height);
  return Math.hypot(dx, dy);
}

/** How much of an orthogonal segment lies inside a box (not on its border). */
function lengthInside([a, b]: Seg, box: Box): number {
  if (a.y === b.y) return a.y > box.y && a.y < box.y + box.height ? Math.max(0, Math.min(Math.max(a.x, b.x), box.x + box.width) - Math.max(Math.min(a.x, b.x), box.x)) : 0;
  return a.x > box.x && a.x < box.x + box.width ? Math.max(0, Math.min(Math.max(a.y, b.y), box.y + box.height) - Math.max(Math.min(a.y, b.y), box.y)) : 0;
}

function inset(b: Box, d: number): Box {
  return { x: b.x + d, y: b.y + d, width: b.width - 2 * d, height: b.height - 2 * d };
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function segmentHitsBox([a, b]: Seg, box: Box): boolean {
  // Orthogonal segments: compare the segment's bounding box with the node.
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return x0 < box.x + box.width && x1 > box.x && y0 < box.y + box.height && y1 > box.y;
}

function properCross([a, b]: Seg, [c, d]: Seg): boolean {
  const o = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const o1 = o(a, b, c);
  const o2 = o(a, b, d);
  const o3 = o(c, d, a);
  const o4 = o(c, d, b);
  // Touching or overlapping segments (shared endpoints, merged lines) do not count as crossings.
  return o1 * o2 < 0 && o3 * o4 < 0;
}
