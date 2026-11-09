// Layout: dot places nodes and groups, pins from the sidecar move nodes, our router draws the lines.
import type { Endpoint, LayoutSidecar, Marker, Placed, PlacedEdge, Point, Sized } from '@cartography/core';
import { placeWithDot, type Placement, type Spacing } from './dot.ts';
import { applyPins } from './pins.ts';
import { compact } from './compact.ts';
import { alignPorts } from './align.ts';
import { measure, score } from './metrics.ts';
import { routeEdges, type RouteEnd, type RouteRequest } from './router.ts';

export * from './dot.ts';
export * from './pins.ts';
export * from './router.ts';
export * from './metrics.ts';

export interface Tuning {
  /** Override the diagram's direction. */
  direction?: 'right' | 'down';
  /** Move things across the flow where there is room (see compact.ts). */
  compact?: boolean;
  /** Straighten almost-straight lines (see align.ts): forced on or off; tried both ways when unset. */
  align?: boolean;
}

export async function layout(sized: Sized, spacing: Spacing, sidecar?: LayoutSidecar, tuning: Tuning = {}): Promise<Placed> {
  if (tuning.direction) sized = { ...sized, graph: { ...sized.graph, direction: tuning.direction } };
  const { graph } = sized;
  // Room for labels between columns; lines between table rows end in crow's feet on both sides.
  const rows = graph.edges.some((e) => e.from.row || e.to.row);
  const placed = await placeWithDot(sized, spacing, (sized.edgeLabels.size ? 24 : 0) + (rows ? 48 : 0));
  const finish = (q: Placement, straighten: boolean) => {
    const straightened = straighten ? alignPorts(q, graph, sized.nodes, sized.groupHeader, spacing.groupPad) : q;
    const p = applyPins(straightened, graph, sidecar, sized.groupHeader, spacing.groupPad);
    return normalise({ ...p, edges: route(sized, p) });
  };
  // Candidates: dot's placement, compacted or not, straightened or not. Each helps some diagrams and
  // hurts others, so all are drawn and the best-scoring one is kept.
  const bases = tuning.compact === false ? [placed] : tuning.compact ? [compact(placed, graph, sized.groupHeader, spacing.groupPad, spacing.nodeGap)] : [placed, compact(placed, graph, sized.groupHeader, spacing.groupPad, spacing.nodeGap)];
  const aligns = tuning.align === false ? [false] : tuning.align ? [true] : [false, true];
  let best: Placed | undefined;
  let bestScore = Infinity;
  for (const base of bases)
    for (const a of aligns) {
      const c = finish(base, a);
      const sc = score(measure(graph, c));
      if (sc < bestScore - 1e-9) {
        best = c;
        bestScore = sc;
      }
    }
  return best!;
}

function route(sized: Sized, p: Placement): Map<string, PlacedEdge> {
  const { graph } = sized;
  const end = (ep: Endpoint, marker: Marker): RouteEnd | undefined => {
    const box = p.nodes.get(ep.node) ?? p.groups.get(ep.node);
    if (!box) return undefined;
    const rowY = ep.row ? sized.nodes.get(ep.node)?.rowY?.[ep.row] : undefined;
    return { node: ep.node, box, rowY, stub: stubFor(marker) };
  };
  const edges: RouteRequest[] = [];
  for (const e of graph.edges) {
    const from = end(e.from, e.start);
    const to = end(e.to, e.end);
    // Dotted lines (lookups, management) route last, so the main flow gets the best paths.
    if (from && to) edges.push({ id: e.id, from, to, label: sized.edgeLabels.get(e.id), order: e.line === 'dotted' ? 1 : 0 });
  }
  // Only the header text is kept clear, so lines may still pass along the rest of a group's top.
  const soft = graph.groups.flatMap((g) => {
    const b = p.groups.get(g.id);
    if (!b) return [];
    // Thin bands along each border: crossing one is cheap, running along it (or a label on it) is not.
    const t = BORDER_BAND;
    const bands = [
      { x: b.x - t, y: b.y - t, width: b.width + 2 * t, height: 2 * t },
      { x: b.x - t, y: b.y + b.height - t, width: b.width + 2 * t, height: 2 * t },
      { x: b.x - t, y: b.y - t, width: 2 * t, height: b.height + 2 * t },
      { x: b.x + b.width - t, y: b.y - t, width: 2 * t, height: b.height + 2 * t },
    ].map((r) => ({ ...r, weight: 0.5 }));
    return [{ x: b.x, y: b.y, width: Math.min(b.width, sized.groupMinWidth.get(g.id) ?? b.width), height: sized.groupHeader }, ...bands];
  });
  return routeEdges({ obstacles: p.nodes, soft, direction: graph.direction, edges });
}

/** Half the width of the band along group borders that lines and labels keep out of. */
const BORDER_BAND = 7;

/** Straight end long enough for the marker drawn there. */
function stubFor(m: Marker): number {
  return m === 'none' ? 16 : m === 'arrow' ? 18 : 30;
}

/** Shift everything so the drawing starts at 0,0 (routes may go around the outside), and size it. */
function normalise(p: Placed): Placed {
  const boxes = [...p.nodes.values(), ...p.groups.values()];
  const extras = [...p.edges.values()].flatMap((e) => [...e.points, ...(e.label ? [e.label] : [])]);
  const minX = Math.min(...boxes.map((b) => b.x), ...extras.map((q) => q.x));
  const minY = Math.min(...boxes.map((b) => b.y), ...extras.map((q) => q.y));
  const shift = <T extends Point>(q: T): T => ({ ...q, x: q.x - minX, y: q.y - minY });
  const nodes = new Map([...p.nodes].map(([k, b]) => [k, shift(b)]));
  const groups = new Map([...p.groups].map(([k, b]) => [k, shift(b)]));
  const edges = new Map([...p.edges].map(([k, e]) => [k, { points: e.points.map(shift), label: e.label && shift(e.label) }]));
  const right = (b: { x: number; width?: number }) => b.x + (b.width ?? 0);
  const bottom = (b: { y: number; height?: number }) => b.y + (b.height ?? 0);
  const all = [...nodes.values(), ...groups.values(), ...[...edges.values()].flatMap((e) => [...e.points, ...(e.label ? [e.label] : [])])];
  return { nodes, groups, edges, width: Math.max(0, ...all.map(right)), height: Math.max(0, ...all.map(bottom)), shift: { x: minX, y: minY } };
}
