// Layout: dot places nodes and groups, pins from the sidecar move nodes, our router draws the lines.
import type { Endpoint, LayoutSidecar, Marker, Placed, PlacedEdge, Point, Sized } from '@cartography/core';
import { placeWithDot, type Placement, type Spacing } from './dot.ts';
import { applyPins } from './pins.ts';
import { routeEdges, type RouteEnd, type RouteRequest } from './router.ts';

export * from './dot.ts';
export * from './pins.ts';
export * from './router.ts';
export * from './metrics.ts';

export interface Tuning {
  /** Override the diagram's direction. */
  direction?: 'right' | 'down';
}

export async function layout(sized: Sized, spacing: Spacing, sidecar?: LayoutSidecar, tuning: Tuning = {}): Promise<Placed> {
  if (tuning.direction) sized = { ...sized, graph: { ...sized.graph, direction: tuning.direction } };
  const { graph } = sized;
  // Room for labels between columns; lines between table rows end in crow's feet on both sides.
  const rows = graph.edges.some((e) => e.from.row || e.to.row);
  const placed = await placeWithDot(sized, spacing, (sized.edgeLabels.size ? 24 : 0) + (rows ? 48 : 0));
  const p = applyPins(placed, graph, sidecar, sized.groupHeader, spacing.groupPad);
  return normalise({ ...p, edges: route(sized, p) });
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
    return b ? [{ x: b.x, y: b.y, width: Math.min(b.width, sized.groupMinWidth.get(g.id) ?? b.width), height: sized.groupHeader }] : [];
  });
  return routeEdges({ obstacles: p.nodes, soft, direction: graph.direction, edges });
}

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
