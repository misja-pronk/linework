// Layout quality, measured. Used to compare layout strategies and to guard against regressions.
import type { Box, Graph, Placed, Point } from '@cartography/core';

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
}

type Seg = [Point, Point];

export function measure(graph: Graph, placed: Placed): LayoutMetrics {
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
    if (s && t && (graph.direction === 'down' ? t.y < s.y - 1 : t.x < s.x - 1)) backward++;
  }

  const widths = [...placed.nodes.values()].map((b) => b.width).sort((a, b) => a - b);
  const unit = widths[Math.floor(widths.length / 2)] ?? 1;
  const nodeArea = [...placed.nodes.values()].reduce((s, b) => s + b.width * b.height, 0);
  return {
    crossings,
    edgeThroughNode,
    labelOverlaps,
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
  const aspectPenalty = Math.abs(Math.log(m.aspect / targetAspect));
  return (
    m.edgeThroughNode * 40 +
    m.labelOverlaps * 30 +
    m.crossings * 12 +
    m.backward * 8 +
    m.bends * 1.5 +
    m.edgeLength * 0.6 +
    aspectPenalty * 25 +
    (1 - m.density) * 20
  );
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
