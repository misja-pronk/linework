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
}

/** Lines closer than this read as one smudge. */
const MIN_GAP = 8;
/** Farther than this from every box is a hole in the drawing (more than a wide gap between layers). */
const VOID = 96;
/** Parallel lines within this distance count as one bundle. */
const BUNDLE = 40;

type Seg = [Point, Point];

export function measure(graph: Graph, placed: Placed, header = 44): LayoutMetrics {
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
  const beauty = beautyMetrics(graph, placed, segs, header, unit);
  return {
    ...beauty,
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
    m.borderHits * 25 +
    m.portCrowding * 8
  );
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

/** Lines that may share ink: same start or same end, drawn alike (a trunk that branches). */
function siblings(a: GraphEdge, b: GraphEdge): boolean {
  return (a.from.node === b.from.node || a.to.node === b.to.node) && a.line === b.line && a.tone === b.tone;
}

function beautyMetrics(graph: Graph, placed: Placed, segs: Map<string, Seg[]>, header: number, unit: number) {
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

  // Voids: points of the drawing far from every box. Lines through a hole do not fill it.
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
    for (const s of all) {
      const along = s.h ? [b.y, b.y + b.height].some((v) => Math.abs(s.at - v) < t) && Math.min(s.hi, b.x + b.width) - Math.max(s.lo, b.x) > 12
        : [b.x, b.x + b.width].some((v) => Math.abs(s.at - v) < t) && Math.min(s.hi, b.y + b.height) - Math.max(s.lo, b.y) > 12;
      // Through the header text: the title is drawn 13 to 31px below the top, from 12px in, and is
      // rarely wider than 200px (a line passing under it, in a top-down header's lane, is fine).
      const [t0, t1, a0, a1] = s.h ? [b.x + 12, b.x + Math.min(b.width - 12, 212), b.y + 13, b.y + 31] : [b.y + 13, b.y + 31, b.x + 12, b.x + Math.min(b.width - 12, 212)];
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

  return {
    detour: counted ? r2(ratioSum / counted) : 1,
    detourExcess: r2(detourExcess),
    groupEmpty: groupsCounted ? r2(emptySum / groupsCounted) : 0,
    voids: samples ? r2(holes / samples) : 0,
    aligned: centres.length ? r2(aligned / centres.length) : 1,
    tightPairs,
    minGap: minGap === Infinity ? 0 : r2(minGap),
    uneven: r2(uneven),
    borderHits,
    portCrowding,
  };
}

function boxDistance(b: Box, x: number, y: number): number {
  const dx = Math.max(b.x - x, 0, x - b.x - b.width);
  const dy = Math.max(b.y - y, 0, y - b.y - b.height);
  return Math.hypot(dx, dy);
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
