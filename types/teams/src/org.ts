// The org chart placed: people on a tidy tree (packages/tree), every card in a row (or a list) as tall
// as the tallest in it so the rows line up, the dotted-line reports routed around the cards. Given the
// drawing before, the tree keeps to it: one more person moves the cards beside them, not the chart.
import type { Box, LayoutMemory, Placed, PlacedEdge, Sized } from '@cartography/core';
import { route, tidy, type TidyNode } from '@cartography/tree';

export function orgLayout(sized: Sized, previous?: LayoutMemory): Placed {
  const g = sized.graph;
  const people = g.nodes.filter((n) => n.shape.kind === 'block' && n.shape.form === 'person');
  const width = Math.max(0, ...people.map((n) => sized.nodes.get(n.id)?.width ?? 0));
  const items = new Map<string, TidyNode>(people.map((n) => [n.id, { id: n.id, width, height: sized.nodes.get(n.id)?.height ?? 0, children: [] }]));
  const solid = g.edges.filter((e) => e.line === 'solid' && items.has(e.from.node) && items.has(e.to.node));
  const managed = new Set<string>();
  for (const e of solid) {
    if (managed.has(e.to.node)) continue;
    managed.add(e.to.node);
    items.get(e.from.node)!.children.push(items.get(e.to.node)!);
  }
  const roots = people.filter((n) => !managed.has(n.id)).map((n) => items.get(n.id)!);
  // Title above and a key below: the page around the chart on a slide.
  const frame = { width: 80, height: (g.title ? 64 : 0) + (g.legend?.length ? 60 : 0) + 80 };
  const t = tidy(roots, { frame, previous: previous?.variant, before: previous?.nodes, even: true, gapX: 18, gapY: 46 });

  const edges = new Map<string, PlacedEdge>();
  for (const e of solid) {
    const pts = t.links.get(e.to.node);
    if (pts) edges.set(e.id, { points: pts.map((p) => ({ ...p })) });
  }
  // A dotted line leaves a card's side or the far end of its bottom, and arrives at a side or the far end of a top: the middles carry the solid lines.
  const boxes = [...t.boxes.values()];
  const drawn = [...edges.values()].map((e) => e.points);
  let width2 = t.width;
  let height2 = t.height;
  for (const e of g.edges) {
    if (e.line === 'solid' || edges.has(e.id)) continue;
    const a = t.boxes.get(e.from.node);
    const b = t.boxes.get(e.to.node);
    if (!a || !b) continue;
    const pts = route(boxes, { box: a, sides: ['E', 'W', 'S'], at: 0.78 }, { box: b, sides: ['E', 'W', 'N'], at: 0.78 }, { margin: 10, bend: 60, lines: drawn });
    if (!pts) continue;
    edges.set(e.id, { points: pts });
    for (const p of pts) (width2 = Math.max(width2, p.x)), (height2 = Math.max(height2, p.y));
  }
  return finish(t.boxes, edges, width2, height2, t.variant);
}

/** Moves everything to 0,0 (a route may run left of or above the cards) and remembers where it all is. */
export function finish(nodes: Map<string, Box>, edges: Map<string, PlacedEdge>, width: number, height: number, variant: string): Placed {
  const pts = [...edges.values()].flatMap((e) => e.points);
  const x0 = Math.min(0, ...pts.map((p) => p.x));
  const y0 = Math.min(0, ...pts.map((p) => p.y));
  if (x0 < 0 || y0 < 0) {
    for (const b of nodes.values()) (b.x -= x0), (b.y -= y0);
    for (const p of pts) (p.x -= x0), (p.y -= y0);
  }
  const memory = { variant, nodes: new Map([...nodes].map(([id, b]) => [id, { x: b.x + b.width / 2, y: b.y + b.height / 2 }])) };
  return { nodes, groups: new Map(), edges, width: width - x0, height: height - y0, memory };
}
