// Layout: dot places nodes and groups, pins from the sidecar move nodes, our router draws the lines.
import type { Box, EdgeOverride, Endpoint, LayoutSidecar, Marker, Placed, PlacedEdge, Point, Sized } from '@cartography/core';
import { placeWithDot, type DotVariant, type Placement, type Spacing } from './dot.ts';
import { applyPins } from './pins.ts';
import { compact } from './compact.ts';
import { alignPorts } from './align.ts';
import { tidy } from './tidy.ts';
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
  /** Grid, rows and snug groups (see tidy.ts); on unless false. */
  tidy?: boolean;
  /** Ask dot this way only, instead of trying the usual variants. */
  dot?: DotVariant;
  /** The source left the direction open: a drawing far wider than a slide may turn top-down. */
  autoDirection?: boolean;
  /** 'fit': columns of a left-to-right drawing open up for their longest label (C4's long relationship labels). */
  labelRoom?: 'fit';
}

export async function layout(sized: Sized, spacing: Spacing, sidecar?: LayoutSidecar, tuning: Tuning = {}): Promise<Placed> {
  if (tuning.direction) sized = { ...sized, graph: { ...sized.graph, direction: tuning.direction } };
  const first = await layoutOnce(sized, spacing, sidecar, tuning);
  // A long chain drawn left to right can end up many times wider than tall: unreadable on a slide
  // or a page. When the source did not choose a direction, top-down is tried too and kept when it
  // scores better. Not with pins: they were placed on the drawing as it was.
  const pinned = Object.keys(sidecar?.nodes ?? {}).length + Object.keys(sidecar?.groups ?? {}).length > 0;
  if (!tuning.autoDirection || tuning.direction || pinned || sized.graph.direction !== 'right' || (first.bare ?? first.placed).width < WIDE * (first.bare ?? first.placed).height) return first.placed;
  const down = await layoutOnce({ ...sized, graph: { ...sized.graph, direction: 'down' } }, spacing, sidecar, tuning);
  return down.score < first.score - 1e-9 ? { ...down.placed, direction: 'down' } : first.placed;
}

/** Wider than this many times the height, a left-to-right drawing is also tried top-down. */
const WIDE = 3;

/** A drawing and its score; `bare` is the same drawing before lines bent by hand, which never steer the choices. */
interface Drawn {
  placed: Placed;
  score: number;
  bare?: Placed;
}

async function layoutOnce(sized: Sized, spacing: Spacing, sidecar: LayoutSidecar | undefined, tuning: Tuning): Promise<Drawn> {
  const { graph } = sized;
  // Nothing to place yet (a new, empty diagram): an empty drawing, not an error.
  if (!graph.nodes.length && !graph.groups.length) return { placed: { nodes: new Map(), groups: new Map(), edges: new Map(), width: 0, height: 0, shift: { x: 0, y: 0 } }, score: 0 };
  const pinned = Object.keys(sidecar?.nodes ?? {}).length + Object.keys(sidecar?.groups ?? {}).length > 0;
  // dot ranks and orders differently when asked differently, and no one way suits every diagram.
  // Small diagrams also try a few other ways, each drawn in full, and the best-scoring one is kept. Big diagrams, and
  // pinned ones (whose pins were set on one placement), ask once.
  const others: DotVariant[] = tuning.dot || graph.nodes.length > VARIANT_LIMIT || pinned ? [] : [{ sameRank: true }, { attrs: 'ordering=out' }, { sameRank: true, reverse: true }];
  let best = await candidates(sized, spacing, sidecar, tuning, tuning.dot ?? {});
  for (const variant of others) {
    const c = await candidates(sized, spacing, sidecar, tuning, variant);
    if (c.score < best.score - 1e-9) best = c;
  }
  return best;
}

/** The best drawing from one dot placement: compacted or not, straightened or not. */
async function candidates(sized: Sized, spacing: Spacing, sidecar: LayoutSidecar | undefined, tuning: Tuning, variant: DotVariant): Promise<Drawn> {
  // Top-down, lines come into a group's first row from above, and its header title sits right where
  // the leftmost of them would come in. A slightly taller header leaves a lane under the title: such
  // a line comes down beside the title, runs under it and drops into its node.
  if (sized.graph.direction === 'down') sized = { ...sized, groupHeader: sized.groupHeader + DOWN_LANE };
  const { graph } = sized;
  // Room for labels between columns; lines between table rows end in crow's feet on both sides.
  const rows = graph.edges.some((e) => e.from.row || e.to.row);
  const widest = Math.max(0, ...[...sized.edgeLabels.values()].map((l) => l.width));
  const room = tuning.labelRoom === 'fit' && graph.direction === 'right' ? Math.max(24, Math.min(240, widest + 48 - spacing.layerGap)) : 24;
  const placed = await placeWithDot(sized, spacing, (sized.edgeLabels.size ? room : 0) + (rows ? 48 : 0), variant);
  const pinned = Object.keys(sidecar?.nodes ?? {}).length + Object.keys(sidecar?.groups ?? {}).length > 0;
  const finish = (q: Placement, straighten: boolean) => {
    const straightened = straighten ? alignPorts(q, graph, sized.nodes, sized.groupHeader, spacing.groupPad) : q;
    const tidied = tuning.tidy === false ? straightened : tidy(straightened, graph, sized.groupHeader, spacing.groupPad, spacing.nodeGap, sized.groupMinWidth);
    let p = applyPins(tidied, graph, sidecar, sized.groupHeader, spacing.groupPad);
    let edges = route(sized, p);
    // A label that cannot sit clear of a group border gets room: space is opened just before that
    // border and the lines are drawn again. Not with pins, which must stay exactly where they were put.
    for (let i = 0; i < 4 && !pinned; i++) {
      const cut = labelOnBorder(p, edges, sized.groupHeader);
      if (!cut) break;
      p = openSpace(p, cut);
      edges = route(sized, p);
    }
    return { placed: normalise({ ...p, edges }), p };
  };
  // Each helps some diagrams and hurts others, so all are drawn and the best-scoring one is kept.
  const packed = () => compact(placed, graph, sized.groupHeader, spacing.groupPad, spacing.nodeGap);
  const bases = tuning.compact === false ? [placed] : tuning.compact ? [packed()] : [placed, packed()];
  const aligns = tuning.align === false ? [false] : tuning.align ? [true] : [false, true];
  let best: { placed: Placed; p: Placement } | undefined;
  let bestScore = Infinity;
  for (const base of bases)
    for (const a of aligns) {
      const c = finish(base, a);
      const sc = score(measure(graph, c.placed, sized.groupHeader));
      if (!best || sc < bestScore - 1e-9) {
        best = c;
        bestScore = sc;
      }
    }
  // Lines bent by hand are drawn last, on the placement chosen without them: a bend never changes where boxes go.
  const joins = (id: string, o: EdgeOverride) => graph.edges.some((e) => e.id === id && (o.from == null || e.from.node === o.from) && (o.to == null || e.to.node === o.to));
  const via = new Map(Object.entries(sidecar?.edges ?? {}).filter(([id, o]) => o.via?.length && joins(id, o)).map(([id, o]) => [id, o.via]));
  if (via.size) return { placed: normalise({ ...best!.p, edges: route(sized, best!.p, via) }), score: bestScore, bare: best!.placed };
  return { placed: best!.placed, score: bestScore };
}

/** Above this many nodes dot is asked once: the other variants would cost more time than they win. */
const VARIANT_LIMIT = 60;

function route(sized: Sized, p: Placement, via?: Map<string, Point[]>): Map<string, PlacedEdge> {
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
    if (from && to) edges.push({ id: e.id, from, to, label: sized.edgeLabels.get(e.id), order: e.line === 'dotted' ? 1 : 0, style: `${e.line}|${e.tone ?? ''}|${e.start}|${e.end}|${e.width ?? 1}`, via: via?.get(e.id) });
  }
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
    // The header text itself is a wall (texts, below); the rest of the header is free to cross.
    return bands;
  });
  // Labels keep off every border and the whole header band (the hard rule); lines only pay for them.
  const labelZones = [...p.groups.values()].flatMap((b) => [{ ...b, height: sized.groupHeader }, ...borderBands(b, 4)]);
  // Header titles: where the group's name is written (icon, label, kind), with a little air.
  const texts = graph.groups.flatMap((g) => {
    const b = p.groups.get(g.id);
    const w = sized.groupMinWidth.get(g.id);
    if (!b || w == null) return [];
    // As drawn (svg.ts): icon at x + 16, label and kind after it, centred 22px below the top.
    return [{ x: b.x + 12, y: b.y + 13, width: Math.min(b.width, w) - 32, height: 18 }];
  });
  return routeEdges({ obstacles: p.nodes, soft, labelZones, texts, direction: graph.direction, edges });
}

function borderBands(b: Box, t: number): Box[] {
  return [
    { x: b.x - t, y: b.y - t, width: b.width + 2 * t, height: 2 * t },
    { x: b.x - t, y: b.y + b.height - t, width: b.width + 2 * t, height: 2 * t },
    { x: b.x - t, y: b.y - t, width: 2 * t, height: b.height + 2 * t },
    { x: b.x + b.width - t, y: b.y - t, width: 2 * t, height: b.height + 2 * t },
  ];
}

interface Cut {
  axis: 'x' | 'y';
  at: number;
  by: number;
}

/** The first label lying on a group's border or header, as the space to open before that border. */
function labelOnBorder(p: Placement, edges: Map<string, PlacedEdge>, header: number): Cut | undefined {
  const t = 4;
  for (const e of edges.values()) {
    const l = e.label;
    if (!l) continue;
    // A label at a group's corner touches two borders at once: the cheaper cut clears it.
    let cut: Cut | undefined;
    for (const b of p.groups.values())
      for (const [axis, at] of [['x', b.x], ['x', b.x + b.width], ['y', b.y], ['y', b.y + b.height]] as const) {
        const [lo, hi, size] = axis === 'x' ? [l.x, l.x + l.width, l.width] : [l.y, l.y + l.height, l.height];
        // Within the border's extent, and touching its line.
        const [o0, o1] = axis === 'x' ? [b.y, b.y + b.height] : [b.x, b.x + b.width];
        const [l0, l1] = axis === 'x' ? [l.y, l.y + l.height] : [l.x, l.x + l.width];
        // The top border is as thick as the header: a label may not sit in it either.
        const after = axis === 'y' && at === b.y ? header : t;
        if (lo < at + after && hi > at - t && l0 < o1 && l1 > o0) {
          const c: Cut = { axis, at: Math.min(lo, at) - 2 * t, by: Math.ceil((size + 4 * t) / 8) * 8 };
          if (!cut || c.by < cut.by) cut = c;
        }
      }
    if (cut) return cut;
  }
  return undefined;
}

/** Push everything that starts at or past the cut further along; boxes the cut runs through grow. */
function openSpace(p: Placement, c: Cut): Placement {
  const size = c.axis === 'x' ? 'width' : 'height';
  const move = (b: Box) => (b[c.axis] >= c.at ? { ...b, [c.axis]: b[c.axis] + c.by } : b);
  const grow = (b: Box) => (b[c.axis] >= c.at ? move(b) : b[c.axis] + b[size] > c.at ? { ...b, [size]: b[size] + c.by } : b);
  const nodes = new Map([...p.nodes].map(([k, b]) => [k, move(b)]));
  const groups = new Map([...p.groups].map(([k, b]) => [k, grow(b)]));
  return { nodes, groups, width: p.width + (c.axis === 'x' ? c.by : 0), height: p.height + (c.axis === 'y' ? c.by : 0) };
}

/** Extra header height in top-down diagrams: room for a line to pass under the group's title. */
const DOWN_LANE = 12;

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
  // Shift by whole grid steps, so centres tidied onto the 8px grid stay on it.
  const minX = Math.floor(Math.min(...boxes.map((b) => b.x), ...extras.map((q) => q.x)) / 8) * 8;
  const minY = Math.floor(Math.min(...boxes.map((b) => b.y), ...extras.map((q) => q.y)) / 8) * 8;
  const shift = <T extends Point>(q: T): T => ({ ...q, x: q.x - minX, y: q.y - minY });
  const nodes = new Map([...p.nodes].map(([k, b]) => [k, shift(b)]));
  const groups = new Map([...p.groups].map(([k, b]) => [k, shift(b)]));
  const edges = new Map([...p.edges].map(([k, e]) => [k, { points: e.points.map(shift), label: e.label && shift(e.label) }]));
  const right = (b: { x: number; width?: number }) => b.x + (b.width ?? 0);
  const bottom = (b: { y: number; height?: number }) => b.y + (b.height ?? 0);
  const all = [...nodes.values(), ...groups.values(), ...[...edges.values()].flatMap((e) => [...e.points, ...(e.label ? [e.label] : [])])];
  return { nodes, groups, edges, width: Math.max(0, ...all.map(right)), height: Math.max(0, ...all.map(bottom)), shift: { x: minX, y: minY } };
}
