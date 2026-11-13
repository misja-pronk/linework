// The org chart placed: people on a tidy tree (packages/tree), every card in a row (or a list) as tall
// as the tallest in it so the rows line up, the dotted-line reports routed around the cards. Given the
// drawing before, the tree keeps to it: one more person moves the cards beside them, not the chart.
import type { Box, LayoutMemory, Placed, PlacedEdge, Point, Sized } from '@cartography/core';
import { route, tidy, type Side, type TidyNode } from '@cartography/tree';

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
  // A dotted line keeps its own lane: running right beside another line (a trunk, or a dotted line
  // routed before it) costs as running on it, so two lines never read as one and the eye can follow each.
  const drawn: Point[][] = [];
  const keepOff = (pts: Point[]) => {
    for (let d = -8; d <= 8; d++)
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1]!, pts[i]!];
        const level = Math.abs(a.y - b.y) < 0.5;
        drawn.push(level ? [{ x: a.x, y: a.y + d }, { x: b.x, y: b.y + d }] : [{ x: a.x + d, y: a.y }, { x: b.x + d, y: b.y }]);
      }
  };
  for (const e of edges.values()) keepOff(e.points);
  // The side each card's solid line comes in by.
  const arrives = new Map<string, Side>();
  for (const e of solid) {
    const pts = edges.get(e.id)?.points;
    if (!pts || pts.length < 2) continue;
    const [p, q] = [pts.at(-2)!, pts.at(-1)!];
    arrives.set(e.to.node, Math.abs(p.y - q.y) < 0.5 ? (q.x > p.x ? 'W' : 'E') : q.y > p.y ? 'N' : 'S');
  }
  const dots: { id: string; a: Box; b: Box; pts: Point[] }[] = [];
  /** The cheapest way from a to b, out of any side and into any, that crosses none of `avoid`. */
  const other = (a: Box, b: Box, avoid: Point[][]) => {
    const ways: Side[][] = [['N'], ['E'], ['W'], ['S']];
    let best: { pts: Point[]; cost: number } | undefined;
    for (const f of ways)
      for (const to of ways) {
        const r = route(boxes, { box: a, sides: f, at: 0.78 }, { box: b, sides: to, at: 0.78 }, { margin: 10, bend: 60, lines: drawn });
        if (!r || avoid.some((d) => crossings(d, r))) continue;
        const cost = r.slice(1).reduce((n, p, i) => n + Math.abs(p.x - r[i]!.x) + Math.abs(p.y - r[i]!.y), 0) + 60 * (r.length - 2);
        if (!best || cost < best.cost) best = { pts: r, cost };
      }
    return best;
  };
  let width2 = t.width;
  let height2 = t.height;
  for (const e of g.edges) {
    if (e.line === 'solid' || edges.has(e.id)) continue;
    const a = t.boxes.get(e.from.node);
    const b = t.boxes.get(e.to.node);
    if (!a || !b) continue;
    // Not into the side of a card in a list its own reporting line comes in by: the two would arrive as one.
    // (On top, the reporting line takes the middle and this one the far end.)
    const into = (['E', 'W', 'N'] as Side[]).filter((x) => x === 'N' || x !== arrives.get(e.to.node));
    let pts = route(boxes, { box: a, sides: ['E', 'W', 'S'], at: 0.78 }, { box: b, sides: into, at: 0.78 }, { margin: 10, bend: 60, lines: drawn }) ?? route(boxes, { box: a, at: 0.78 }, { box: b, at: 0.78 }, { margin: 10, bend: 60, lines: drawn });
    if (!pts) continue;
    // Two dotted lines that cross cannot be told apart. Where this one crosses one drawn before, that
    // one or this one goes another way (the top of the card it leaves too): whichever costs less.
    const crossed = dots.find((d) => crossings(d.pts, pts!));
    if (crossed) {
      const mine = other(a, b, [...dots.map((d) => d.pts)]);
      const theirs = other(crossed.a, crossed.b, [...dots.filter((d) => d !== crossed).map((d) => d.pts), pts]);
      if (theirs && (!mine || theirs.cost < mine.cost)) {
        crossed.pts = theirs.pts;
        edges.set(crossed.id, { points: theirs.pts });
      } else if (mine) pts = mine.pts;
    }
    dots.push({ id: e.id, a, b, pts });
    edges.set(e.id, { points: pts });
    keepOff(pts);
  }
  for (const d of dots) for (const p of d.pts) (width2 = Math.max(width2, p.x)), (height2 = Math.max(height2, p.y));
  return finish(t.boxes, edges, width2, height2, t.variant);
}

/** How often two square lines cross: a level piece of one through an upright piece of the other. */
function crossings(p: Point[], q: Point[]): number {
  let n = 0;
  for (let i = 1; i < p.length; i++)
    for (let j = 1; j < q.length; j++) {
      const [a, b, c, d] = [p[i - 1]!, p[i]!, q[j - 1]!, q[j]!];
      const [h, v] = Math.abs(a.y - b.y) < 0.5 ? [[a, b], [c, d]] : [[c, d], [a, b]];
      if (Math.abs(h[0]!.y - h[1]!.y) > 0.5 || Math.abs(v[0]!.x - v[1]!.x) > 0.5) continue;
      const between = (x: number, u: number, w: number) => Math.min(u, w) < x && x < Math.max(u, w);
      if (between(v[0]!.x, h[0]!.x, h[1]!.x) && between(h[0]!.y, v[0]!.y, v[1]!.y)) n++;
    }
  return n;
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
