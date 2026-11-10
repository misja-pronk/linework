// A Team Topologies view placed the way the book draws one: stream-aligned teams as wide bars one
// under the other with the flow of change running along them, enabling teams as upright bars
// beside them spanning the teams they help, complicated-subsystem teams at the end of the stream
// they serve, platforms as wide bars underneath. An interaction between two teams that touch is
// drawn as a zone in the gap between them (cross-hatched, dotted, bracketed); one between teams
// that do not touch is a line around the others in the same colour and dash.
import type { BlockForm, Box, GraphNode, Placed, PlacedEdge, Sized } from '@cartography/core';
import { route } from '@cartography/tree';
import { finish } from './org.ts';

const GAP = 30;
/** How far a zone reaches into the two teams it joins, as the book's shapes overlap. */
const INTO = 5;
const FLOW = { height: 22, gap: 14 };

const formOf = (n: GraphNode): BlockForm | undefined => (n.shape.kind === 'block' ? n.shape.form : undefined);

export function topologyLayout(sized: Sized): Placed {
  const g = sized.graph;
  const size = (id: string) => sized.nodes.get(id) ?? { width: 0, height: 0 };
  const of = (f: BlockForm) => g.nodes.filter((n) => formOf(n) === f);
  const S = of('stream');
  const E = of('enabling');
  const C = of('subsystem');
  const P = of('platform');
  const flow = g.nodes.find((n) => formOf(n) === 'flow');
  const zones = g.nodes.filter((n) => n.shape.kind === 'block' && !!n.shape.between);
  const ties = g.edges.filter((e) => !!e.kind);
  const partners = (id: string) => ties.flatMap((e) => (e.from.node === id ? [e.to.node] : e.to.node === id ? [e.from.node] : []));

  const rowH = Math.max(64, ...[...S, ...C].map((n) => size(n.id).height));
  let ws = Math.max(340, ...S.map((n) => size(n.id).width));
  const we = Math.max(118, ...E.map((n) => size(n.id).width));
  const wc = Math.max(156, ...C.map((n) => size(n.id).width));
  const ph = Math.max(58, ...P.map((n) => size(n.id).height));
  const sRow = new Map(S.map((n, i) => [n.id, i]));

  // Complicated-subsystem teams stand at the end of the first stream they work with; the rest on rows of their own below.
  const cRow = new Map<string, number>();
  let extra = S.length;
  for (const c of C) {
    const rows = partners(c.id).map((id) => sRow.get(id)).filter((r): r is number => r !== undefined);
    cRow.set(c.id, rows.length ? Math.min(...rows) : extra++);
  }
  const rows = Math.max(S.length, extra, E.length && !S.length ? 1 : 0, C.length ? 1 : 0);

  // Enabling teams span the streams they help (all of them when they name none), in as few columns as they fit.
  const spans = E.map((e) => {
    const r = partners(e.id).map((id) => sRow.get(id) ?? cRow.get(id)).filter((x): x is number => x !== undefined);
    let a = r.length ? Math.min(...r) : 0;
    let b = r.length ? Math.max(...r) : Math.max(0, rows - 1);
    // An upright bar needs some height for its name: at least two rows where there are two.
    if (b === a && rows > 1) b < rows - 1 ? b++ : a--;
    return { id: e.id, a, b };
  });
  const columns: { a: number; b: number }[][] = [];
  const eCol = new Map<string, number>();
  for (const s of spans) {
    let k = columns.findIndex((col) => col.every((o) => s.b < o.a || s.a > o.b));
    if (k < 0) k = columns.push([]) - 1;
    columns[k]!.push(s);
    eCol.set(s.id, k);
  }

  const top = flow && S.length ? FLOW.height + FLOW.gap : 0;
  const xS = columns.length * (we + GAP);
  const rowY = (r: number) => top + r * (rowH + GAP);
  const bottom = rows ? rowY(rows) - GAP : top;
  // The streams take the width a 16:9 slide leaves (title and key around the drawing), up to a point:
  // a tall view gets long bars, as the book draws them, instead of a narrow column.
  if (S.length) {
    const height = bottom + (P.length ? GAP + ph : 0);
    const frame = { width: 80, height: (g.title ? 64 : 0) + (g.legend?.length ? 100 : 0) + 80 };
    const most = Math.max(0, ...[...new Set(C.map((c) => cRow.get(c.id)!))].map((r) => C.filter((c) => cRow.get(c.id) === r).length));
    const others = xS + (most ? GAP + most * (wc + GAP) - GAP : 0);
    const want = (16 / 9) * (height + frame.height) - frame.width - others;
    ws = Math.round(Math.min(Math.max(ws, want), Math.max(ws, 680)));
  }
  const boxes = new Map<string, Box>();
  // The innermost column stands next to the streams.
  const eX = (k: number) => xS - (k + 1) * (we + GAP);
  for (const s of spans) boxes.set(s.id, { x: eX(eCol.get(s.id)!), y: rowY(s.a), width: we, height: rowY(s.b) + rowH - rowY(s.a) });
  for (const [i, n] of S.entries()) boxes.set(n.id, { x: xS, y: rowY(i), width: ws, height: rowH });
  const perRow = new Map<number, number>();
  const xC = xS + (S.length ? ws + GAP : 0);
  for (const c of C) {
    const r = cRow.get(c.id)!;
    const k = perRow.get(r) ?? 0;
    perRow.set(r, k + 1);
    boxes.set(c.id, { x: xC + k * (wc + GAP), y: rowY(r), width: wc, height: rowH });
  }
  let right = Math.max(xS + (S.length ? ws : 0), ...[...boxes.values()].map((b) => b.x + b.width));
  const left = Math.min(0, ...[...boxes.values()].map((b) => b.x));
  // Platforms underneath everything, side by side, sharing the width.
  if (P.length) {
    const y = rows ? bottom + GAP : 0;
    const total = Math.max(right - left, P.length * 200 + (P.length - 1) * GAP, ...P.map((n) => size(n.id).width));
    const w = (total - (P.length - 1) * GAP) / P.length;
    for (const [i, n] of P.entries()) boxes.set(n.id, { x: left + i * (w + GAP), y, width: w, height: ph });
    right = Math.max(right, left + total);
  }
  if (flow && S.length) boxes.set(flow.id, { x: xS, y: 0, width: ws, height: FLOW.height });

  // Interactions: a zone where the two teams face each other across a gap, else a line.
  const edges = new Map<string, PlacedEdge>();
  const obstacles = [...boxes.entries()].filter(([id]) => id !== flow?.id).map(([, b]) => b);
  for (const z of zones) {
    if (z.shape.kind !== 'block' || !z.shape.between) continue;
    const [a, b] = z.shape.between;
    const A = boxes.get(a);
    const B = boxes.get(b);
    const zone = A && B ? facing(A, B) : undefined;
    if (zone) boxes.set(z.id, zone);
  }
  for (const e of ties) {
    const z = zones.find((n) => n.shape.kind === 'block' && n.shape.between?.[0] === e.from.node && n.shape.between[1] === e.to.node && n.path.join('/') === e.path.join('/'));
    if (z && boxes.has(z.id)) continue;
    const A = boxes.get(e.from.node);
    const B = boxes.get(e.to.node);
    if (!A || !B) continue;
    const pts = route(obstacles, { box: A, at: 0.5 }, { box: B, at: 0.5 }, { margin: 12, bend: 50 });
    if (pts) edges.set(e.id, { points: pts });
  }
  const all = [...boxes.values()];
  const width = Math.max(right, ...all.map((b) => b.x + b.width), ...[...edges.values()].flatMap((e) => e.points.map((p) => p.x)));
  const height = Math.max(...all.map((b) => b.y + b.height), ...[...edges.values()].flatMap((e) => e.points.map((p) => p.y)), 0);
  // Left of 0 only when there are no streams to hang the columns from.
  if (left < 0) for (const b of all) b.x -= left;
  if (left < 0) for (const e of edges.values()) for (const p of e.points) p.x -= left;
  return finish(boxes, edges, width - left, height, 'topology');
}

/** The zone between two boxes that face each other across a gap, reaching a little into both; undefined when they do not. */
function facing(a: Box, b: Box): Box | undefined {
  const overlap = (a0: number, a1: number, b0: number, b1: number) => [Math.max(a0, b0), Math.min(a1, b1)] as const;
  // One above the other.
  const [x0, x1] = overlap(a.x, a.x + a.width, b.x, b.x + b.width);
  if (x1 - x0 >= 40) {
    const [up, down] = a.y < b.y ? [a, b] : [b, a];
    const gap = down.y - (up.y + up.height);
    if (gap > 0 && gap <= GAP + 1) {
      const w = Math.max(Math.min(120, x1 - x0 - 16), Math.min((x1 - x0) * 0.45, 240));
      return { x: (x0 + x1) / 2 - w / 2, y: up.y + up.height - INTO, width: w, height: gap + 2 * INTO };
    }
  }
  // Side by side.
  const [y0, y1] = overlap(a.y, a.y + a.height, b.y, b.y + b.height);
  if (y1 - y0 >= 30) {
    const [l, r] = a.x < b.x ? [a, b] : [b, a];
    const gap = r.x - (l.x + l.width);
    if (gap > 0 && gap <= GAP + 1) {
      const h = Math.max(Math.min(40, y1 - y0 - 12), Math.min((y1 - y0) * 0.7, 110));
      return { x: l.x + l.width - INTO, y: (y0 + y1) / 2 - h / 2, width: gap + 2 * INTO, height: h };
    }
  }
  return undefined;
}

