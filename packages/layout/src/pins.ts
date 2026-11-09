// Manual tweaks from the sidecar: pinned nodes keep the position people dragged them to, the lines
// to them are re-routed, and groups grow to keep holding their children.
import type { Box, Graph, LayoutSidecar, Placed, PlacedEdge, Point, Sized } from '@cartography/core';

export function applyPins(placed: Placed, sized: Sized, sidecar: LayoutSidecar | undefined, groupPad: number): Placed {
  const pins = sidecar?.nodes ?? {};
  const moved = new Set<string>();
  const nodes = new Map(placed.nodes);
  for (const [id, p] of Object.entries(pins)) {
    const box = nodes.get(id);
    if (!box || (box.x === p.x && box.y === p.y)) continue;
    nodes.set(id, { ...box, x: p.x, y: p.y });
    moved.add(id);
  }
  if (!moved.size) return placed;

  const graph = sized.graph;
  const groups = growGroups(graph, nodes, new Map(placed.groups), sized.groupHeader, groupPad);
  const edges = new Map(placed.edges);
  for (const e of graph.edges) {
    if (!moved.has(e.from.node) && !moved.has(e.to.node)) continue;
    const a = nodes.get(e.from.node) ?? groups.get(e.from.node);
    const b = nodes.get(e.to.node) ?? groups.get(e.to.node);
    if (!a || !b) continue;
    const ya = e.from.row ? sized.nodes.get(e.from.node)?.rowY?.[e.from.row] : undefined;
    const yb = e.to.row ? sized.nodes.get(e.to.node)?.rowY?.[e.to.row] : undefined;
    edges.set(e.id, route(a, b, ya, yb, placed.edges.get(e.id)?.label, !!(e.from.row || e.to.row)));
  }
  return normalise({ nodes, groups, edges, width: placed.width, height: placed.height });
}

function growGroups(graph: Graph, nodes: Map<string, Box>, groups: Map<string, Box>, header: number, pad: number) {
  const byId = new Map(graph.groups.map((g) => [g.id, g]));
  const depth = (id: string): number => {
    const p = byId.get(id)?.parent;
    return p ? 1 + depth(p) : 0;
  };
  // Innermost groups first, so their growth propagates outward.
  for (const g of [...graph.groups].sort((a, b) => depth(b.id) - depth(a.id))) {
    const box = groups.get(g.id);
    if (!box) continue;
    const kids = [
      ...graph.nodes.filter((n) => n.parent === g.id).map((n) => nodes.get(n.id)),
      ...graph.groups.filter((c) => c.parent === g.id).map((c) => groups.get(c.id)),
    ].filter((b): b is Box => !!b);
    if (!kids.length) continue;
    const x0 = Math.min(box.x, ...kids.map((k) => k.x - pad));
    const y0 = Math.min(box.y, ...kids.map((k) => k.y - header));
    const x1 = Math.max(box.x + box.width, ...kids.map((k) => k.x + k.width + pad));
    const y1 = Math.max(box.y + box.height, ...kids.map((k) => k.y + k.height + pad));
    groups.set(g.id, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  }
  return groups;
}

/** A simple orthogonal connector between two boxes. */
export function route(a: Box, b: Box, rowA?: number, rowB?: number, label?: Box, sidesOnly = false): PlacedEdge {
  const ac = { x: a.x + a.width / 2, y: a.y + (rowA ?? a.height / 2) };
  const bc = { x: b.x + b.width / 2, y: b.y + (rowB ?? b.height / 2) };
  const overlapX = a.x < b.x + b.width && b.x < a.x + a.width;
  let points: Point[];
  if (overlapX && !sidesOnly) {
    const down = bc.y > ac.y;
    const s = { x: ac.x, y: down ? a.y + a.height : a.y };
    const t = { x: bc.x, y: down ? b.y : b.y + b.height };
    const my = (s.y + t.y) / 2;
    points = s.x === t.x ? [s, t] : [s, { x: s.x, y: my }, { x: t.x, y: my }, t];
  } else {
    const right = bc.x >= ac.x;
    const s = { x: right ? a.x + a.width : a.x, y: ac.y };
    const t = { x: right ? b.x : b.x + b.width, y: bc.y };
    // Rows on the same side of two stacked tables: go out and come back.
    const mx = overlapX ? Math.max(a.x + a.width, b.x + b.width) + 24 : (s.x + t.x) / 2;
    if (overlapX) {
      s.x = a.x + a.width;
      t.x = b.x + b.width;
    }
    points = s.y === t.y && !overlapX ? [s, t] : [s, { x: mx, y: s.y }, { x: mx, y: t.y }, t];
  }
  return { points, label: label ? centreLabel(points, label) : undefined };
}

function centreLabel(points: Point[], label: Box): Box {
  let best = 0;
  let at: Point = points[0]!;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1]!;
    const q = points[i]!;
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len > best) {
      best = len;
      at = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    }
  }
  return { ...label, x: at.x - label.width / 2, y: at.y - label.height / 2 };
}

/** Shift everything so the drawing starts at 0,0 again, and recompute its size. */
function normalise(p: Placed): Placed {
  const boxes = [...p.nodes.values(), ...p.groups.values()];
  const points = [...p.edges.values()].flatMap((e) => [...e.points, ...(e.label ? [e.label] : [])]);
  const minX = Math.min(0, ...boxes.map((b) => b.x), ...points.map((q) => q.x));
  const minY = Math.min(0, ...boxes.map((b) => b.y), ...points.map((q) => q.y));
  const shift = <T extends Point>(q: T): T => ({ ...q, x: q.x - minX, y: q.y - minY });
  const nodes = new Map([...p.nodes].map(([k, b]) => [k, shift(b)]));
  const groups = new Map([...p.groups].map(([k, b]) => [k, shift(b)]));
  const edges = new Map([...p.edges].map(([k, e]) => [k, { points: e.points.map(shift), label: e.label && shift(e.label) }]));
  const all = [...nodes.values(), ...groups.values()];
  const width = Math.max(...all.map((b) => b.x + b.width), ...[...edges.values()].flatMap((e) => e.points.map((q) => q.x)));
  const height = Math.max(...all.map((b) => b.y + b.height), ...[...edges.values()].flatMap((e) => e.points.map((q) => q.y)));
  return { nodes, groups, edges, width, height };
}
