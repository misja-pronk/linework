// A mind map placed: the central topic in the middle, its branches to the right and the left (or one
// side), each side a tidy tree on its side (packages/tree's tidy, turned a quarter), connectors
// square on a bus between the levels. Which arrangement fills a 16:9 slide best is tried, and the
// drawing before is kept close: a branch stays on its side, a new topic moves its neighbours only.
import type { Box, LayoutMemory, Placed, PlacedEdge, Point, Sized } from '@cartography/core';
import { choose, slideScale, tidy, type TidyNode } from '@cartography/tree';

export type Side = 'right' | 'left';
export type Arrangement = 'both' | 'right' | 'left';

/** Between topics stacked on one side, and between a topic and the level out from it. */
const GAP = { along: 10, out: 40 } as const;

interface Item {
  id: string;
  width: number;
  height: number;
  children: Item[];
  side?: Side;
}

export function mindmapLayout(sized: Sized, previous?: LayoutMemory): Placed {
  const g = sized.graph;
  const size = (id: string) => sized.nodes.get(id) ?? { width: 0, height: 0 };
  const items = new Map<string, Item>(g.nodes.map((n) => [n.id, { id: n.id, ...size(n.id), children: [] }]));
  for (const e of g.edges) {
    const a = items.get(e.from.node);
    const b = items.get(e.to.node);
    if (a && b) a.children.push(b);
  }
  const centreId = g.nodes.find((n) => n.shape.kind === 'block' && n.shape.level === 0)?.id ?? g.nodes[0]?.id;
  const centre = centreId ? items.get(centreId) : undefined;
  if (!centre) return { nodes: new Map(), groups: new Map(), edges: new Map(), width: 0, height: 0 };
  // A branch's side as written comes in the arrangement: "side:<id>".
  for (const [k, v] of Object.entries(g.arrange ?? {})) if (k.startsWith('side:') && (v === 'left' || v === 'right') && items.has(k.slice(5))) items.get(k.slice(5))!.side = v;
  const asked = g.arrange?.layout;
  const frame = { width: 80, height: (g.title ? 64 : 0) + (g.legend?.length ? 60 : 0) + 80 };
  const wanted: Arrangement[] = asked === 'both' || asked === 'right' || asked === 'left' ? [asked] : ['both', 'right'];
  const options = wanted.map((a) => {
    const p = place(centre, a, previous);
    return { ...p, variant: a, score: slideScale(p.width, p.height, frame) };
  });
  const pick = choose(options, previous?.variant)!;
  const edges = new Map<string, PlacedEdge>();
  for (const e of g.edges) {
    const pts = pick.links.get(e.to.node);
    if (pts) edges.set(e.id, { points: pts });
  }
  const memory = { variant: pick.variant, nodes: new Map([...pick.boxes].map(([id, b]) => [id, { x: b.x + b.width / 2, y: b.y + b.height / 2 }])) };
  return { nodes: pick.boxes, groups: new Map(), edges, width: pick.width, height: pick.height, memory };
}

/** The branches split over the two sides: about as tall on each, the first ones on the right, going round clockwise. */
export function sides(centre: Item, arrangement: Arrangement, previous?: LayoutMemory): Map<string, Side> {
  const out = new Map<string, Side>();
  const kids = centre.children;
  if (arrangement !== 'both') {
    for (const k of kids) out.set(k.id, arrangement);
    return out;
  }
  const weight = (n: Item): number => (n.children.length ? n.children.reduce((s, c) => s + weight(c), 0) : n.height + GAP.along);
  const total = kids.reduce((s, k) => s + weight(k), 0);
  // Written sides and the sides of the drawing before stay; the rest fill up the lighter side, right first.
  const was = previous?.nodes;
  const c0 = was?.get(centre.id);
  const fixed = new Map<string, Side>();
  for (const k of kids) {
    if (k.side) fixed.set(k.id, k.side);
    else if (c0 && was?.get(k.id)) fixed.set(k.id, was.get(k.id)!.x < c0.x ? 'left' : 'right');
  }
  let right = 0;
  for (const k of kids) if (fixed.get(k.id) === 'right') right += weight(k);
  let acc = 0;
  for (const k of kids) {
    const f = fixed.get(k.id);
    if (f) out.set(k.id, f);
    else {
      const side: Side = right + weight(k) / 2 <= total / 2 + 1e-6 || (acc === 0 && right === 0) ? 'right' : 'left';
      out.set(k.id, side);
      if (side === 'right') right += weight(k);
    }
    acc += weight(k);
  }
  return out;
}

/** Both sides laid out and put together around the centre, moved to 0,0. */
function place(centre: Item, arrangement: Arrangement, previous?: LayoutMemory) {
  const split = sides(centre, arrangement, previous);
  const boxes = new Map<string, Box>();
  const links = new Map<string, Point[]>();
  const c0 = previous?.nodes?.get(centre.id);
  for (const side of ['right', 'left'] as const) {
    // Clockwise: the right side top to bottom, the left side bottom to top.
    const kids = centre.children.filter((k) => split.get(k.id) === side);
    if (side === 'left') kids.reverse();
    if (!kids.length && side === 'left') continue;
    const sign = side === 'right' ? 1 : -1;
    // Turned a quarter: a topic's height is its width along the tree, its width how far the level reaches.
    const turn = (n: Item): TidyNode => ({ id: n.id, width: n.height, height: n.width, children: n.children.map(turn) });
    const root: TidyNode = { ...turn(centre), children: kids.map(turn) };
    // The drawing before, in the turned frame with the centre at 0 and its far side at the top.
    let before: Map<string, Point> | undefined;
    if (c0 && previous?.nodes) {
      before = new Map();
      for (const [id, p] of previous.nodes) {
        if (id !== centre.id && Math.sign(p.x - c0.x) !== sign) continue;
        before.set(id, { x: p.y - c0.y, y: sign * (p.x - c0.x) + centre.width / 2 });
      }
    }
    const t = tidy([root], { gapX: GAP.along, gapY: GAP.out, fixed: { list: Infinity, pairs: false, wrap: 1 }, ...(before ? { before, previous: 'row-w1' } : {}) });
    const r = t.boxes.get(centre.id)!;
    const rx = r.x + r.width / 2;
    const ry = r.y + r.height / 2;
    for (const [id, b] of t.boxes) {
      if (id === centre.id) continue;
      const cx = sign * (b.y + b.height / 2 - ry);
      const cy = b.x + b.width / 2 - rx;
      boxes.set(id, { x: cx - b.height / 2, y: cy - b.width / 2, width: b.height, height: b.width });
    }
    for (const [id, pts] of t.links) links.set(id, pts.map((p) => ({ x: sign * (p.y - ry), y: p.x - rx })));
  }
  boxes.set(centre.id, { x: -centre.width / 2, y: -centre.height / 2, width: centre.width, height: centre.height });
  // From the centre each branch leaves on a curve of its own, so no two colours share a trunk; further
  // out the topics hang square from their branch's bus, as an outline does.
  for (const k of centre.children) {
    const b = boxes.get(k.id);
    if (b) links.set(k.id, curve(centre, b));
  }
  const all = [...boxes.values()];
  const pts = [...links.values()].flat();
  const x0 = Math.min(...all.map((b) => b.x), ...pts.map((p) => p.x));
  const y0 = Math.min(...all.map((b) => b.y), ...pts.map((p) => p.y));
  for (const b of all) (b.x -= x0), (b.y -= y0);
  for (const p of pts) (p.x -= x0), (p.y -= y0);
  const width = Math.max(...all.map((b) => b.x + b.width), ...pts.map((p) => p.x));
  const height = Math.max(...all.map((b) => b.y + b.height), ...pts.map((p) => p.y));
  return { boxes, links, width, height };
}

/** Points along an S-curve from the centre's side to a branch's near side, close enough to draw as a smooth line. */
export function curve(centre: { width: number; height: number }, b: Box, steps = 16): Point[] {
  const right = b.x + b.width / 2 > 0;
  const sx = right ? centre.width / 2 : -centre.width / 2;
  const cy = b.y + b.height / 2;
  // Leave the centre a little towards the branch, within its rounded side.
  const sy = Math.max(-centre.height / 2 + 12, Math.min(centre.height / 2 - 12, cy * 0.25));
  const ex = right ? b.x : b.x + b.width;
  const mx = (sx + ex) / 2;
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    // A cubic with both handles level: it leaves and arrives horizontally.
    pts.push({ x: u * u * u * sx + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * ex, y: u * u * u * sy + 3 * u * u * t * sy + 3 * u * t * t * cy + t * t * t * cy });
  }
  return pts;
}
