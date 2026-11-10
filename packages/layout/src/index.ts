// Layout: dot places nodes and groups, pins from the sidecar move nodes, our router draws the lines.
import { unpackLayout, type Box, type EdgeOverride, type Endpoint, type LayoutMemory, type LayoutSidecar, type Marker, type Placed, type PlacedEdge, type Point, type Sized } from '@cartography/core';
import { placeWithDot, type DotVariant, type Placement, type Spacing } from './dot.ts';
import { applyPins } from './pins.ts';
import { compact } from './compact.ts';
import { alignPorts } from './align.ts';
import { tidy } from './tidy.ts';
import { squeeze } from './squeeze.ts';
import { measure, score } from './metrics.ts';
import { routeEdges, type RouteEnd, type RouteRequest } from './router.ts';
import { movedShare, stayPlacement } from './stay.ts';

export * from './dot.ts';
export * from './pins.ts';
export * from './router.ts';
export * from './metrics.ts';
export * from './stay.ts';

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
  /** With labelRoom 'fit': close each gap between columns to what its own labels need (see squeeze.ts); on unless false. */
  squeeze?: boolean;
  /**
   * The drawing before this one (see stay.ts): what was there keeps its place unless another
   * placement is clearly better. Without it the sidecar's note is used; null forgets that too.
   */
  previous?: LayoutMemory | null;
}

/** The ways dot is asked, by the name they have in a variant key. */
const VARIANTS: [string, DotVariant][] = [
  ['plain', {}],
  ['same', { sameRank: true }],
  ['out', { attrs: 'ordering=out' }],
  ['same-rev', { sameRank: true, reverse: true }],
];

/**
 * What moving away from the previous drawing costs, in score points: a little for moving anything
 * at all, and more the larger the share of nodes that moves. Another placement has to be better by
 * this much to win: about two crossings for a small shuffle, half a dozen for redrawing everything.
 */
const MOVE_BASE = 16;
const MOVE_EACH = 60;
/** With only the way it was made remembered (no positions), another way has to be this much better. */
const SWITCH = 12;

interface VariantKey {
  direction: 'right' | 'down';
  dot: DotVariant;
  compact: boolean;
  align: boolean;
}

function parseKey(key: string | undefined): VariantKey | undefined {
  const m = /^(right|down)\/([a-z-]+)\/(c?)(a?)-?$/.exec(key ?? '');
  const dot = VARIANTS.find(([name]) => name === m?.[2])?.[1];
  return m && dot ? { direction: m[1] as 'right' | 'down', dot, compact: !!m[3], align: !!m[4] } : undefined;
}

/** One way of placing everything, drawn without pins or lines bent by hand: those never steer the choice. */
interface Choice {
  /** Boxes in pin space, tidied and with room opened for labels. */
  p: Placement;
  placed: Placed;
  /** Quality (metrics.ts), lower is better. */
  score: number;
  /** Quality plus what it costs to move away from the previous drawing. */
  cost: number;
  key: string;
  /** The sizes it was drawn with (its direction, its header height). */
  sized: Sized;
  held?: boolean;
}

export async function layout(sized: Sized, spacing: Spacing, sidecar?: LayoutSidecar, tuning: Tuning = {}): Promise<Placed> {
  if (tuning.direction) sized = { ...sized, graph: { ...sized.graph, direction: tuning.direction } };
  const { graph } = sized;
  // Nothing to place yet (a new, empty diagram): an empty drawing, not an error.
  if (!graph.nodes.length && !graph.groups.length) return { nodes: new Map(), groups: new Map(), edges: new Map(), width: 0, height: 0, shift: { x: 0, y: 0 } };
  const pinned = Object.keys(sidecar?.nodes ?? {}).length + Object.keys(sidecar?.groups ?? {}).length > 0;
  const prev = tuning.previous === null ? undefined : (tuning.previous ?? unpackLayout(sidecar?.layout));
  const was = parseKey(prev?.variant);
  const open = !!tuning.autoDirection && !tuning.direction;
  const turned = (d: 'right' | 'down'): Sized => (d === graph.direction ? sized : { ...sized, graph: { ...graph, direction: d } });
  // The previous drawing is kept in the direction it had (when the source leaves the direction open).
  const stayIn = open && was ? was.direction : graph.direction;

  let best: Choice;
  if (pinned && was && !tuning.dot) {
    // Pins were set on one placement: the one the sidecar names is drawn again, whatever the others
    // would score now. Moving a pin never redraws the rest.
    const d = open ? was.direction : graph.direction;
    best = await choose(turned(d), spacing, { ...tuning, dot: was.dot, compact: tuning.compact ?? was.compact, align: tuning.align ?? was.align }, prev, d === stayIn);
  } else {
    best = await choose(sized, spacing, tuning, prev, graph.direction === stayIn);
    // A long chain drawn left to right can end up many times wider than tall: unreadable on a slide
    // or a page. When the source did not choose a direction, top-down is tried too and kept when it
    // is better. It is also tried when the previous drawing was top-down, so it can stay that way.
    if (open && graph.direction === 'right' && (best.placed.width >= WIDE * best.placed.height || stayIn === 'down')) {
      const down = await choose(turned('down'), spacing, tuning, prev, stayIn === 'down');
      // Its width is why top-down is tried at all: on a near tie the wide drawing loses, unless the
      // previous drawing was that one.
      if (down.cost < best.cost + (was?.direction === 'right' ? 0 : TIE) - 1e-9) best = down;
    }
  }

  const s = best.sized;
  const memory: LayoutMemory = {
    variant: best.key,
    ...(best.held ? { held: true } : {}),
    nodes: new Map([...best.p.nodes].map(([id, b]) => [id, { x: b.x + b.width / 2, y: b.y + b.height / 2 }])),
    groups: new Map(best.p.groups),
  };
  const direction = s.graph.direction !== graph.direction ? { direction: s.graph.direction } : {};
  // Pins and lines bent by hand come last, on the placement chosen without them: a pin moves its
  // node (and makes room for it), a bend changes one line, and neither changes where the rest goes.
  const joins = (id: string, o: EdgeOverride) => s.graph.edges.some((e) => e.id === id && (o.from == null || e.from.node === o.from) && (o.to == null || e.to.node === o.to));
  const via = new Map(Object.entries(sidecar?.edges ?? {}).filter(([id, o]) => o.via?.length && joins(id, o)).map(([id, o]) => [id, o.via]));
  if (!pinned && !via.size) return { ...best.placed, ...direction, memory };
  const p = pinned ? applyPins(best.p, s.graph, sidecar, s.groupHeader, spacing.groupPad) : best.p;
  return { ...normalise({ ...p, edges: route(s, p, via.size ? via : undefined) }), ...direction, memory };
}

/** Wider than this many times the height, a left-to-right drawing is also tried top-down. */
const WIDE = 3;
/** How much better (in score) the wide drawing must be to be kept over the top-down one. */
const TIE = 1;

/** The best placement in one direction: each way of asking dot, and the previous drawing kept as it was. */
async function choose(sized: Sized, spacing: Spacing, tuning: Tuning, prev: LayoutMemory | undefined, stay: boolean): Promise<Choice> {
  // Top-down, lines come into a group's first row from above, and its header title sits right where
  // the leftmost of them would come in. A slightly taller header leaves a lane under the title: such
  // a line comes down beside the title, runs under it and drops into its node.
  if (sized.graph.direction === 'down') sized = { ...sized, groupHeader: sized.groupHeader + DOWN_LANE };
  const { graph } = sized;
  // dot ranks and orders differently when asked differently, and no one way suits every diagram.
  // Small diagrams try a few ways, each drawn in full, and the best one is kept. Big diagrams ask once.
  const big = graph.nodes.length > VARIANT_LIMIT;
  const ways: [string, DotVariant][] = tuning.dot ? [[VARIANTS.find(([, v]) => v === tuning.dot)?.[0] ?? 'custom', tuning.dot]] : big ? VARIANTS.slice(0, 1) : VARIANTS;
  // A big diagram with a drawing before it is drawn the way that one was (packed or not, straightened
  // or not) and no other: every candidate is routed in full, which is most of the time a layout takes,
  // and next to the previous drawing kept as it was the other three rarely win.
  const was = big ? parseKey(prev?.variant) : undefined;
  if (was && was.direction === graph.direction) tuning = { ...tuning, compact: tuning.compact ?? was.compact, align: tuning.align ?? was.align };
  let best: Choice | undefined;
  for (const [name, variant] of ways) {
    const c = await candidates(sized, spacing, tuning, name, variant, prev);
    if (!best || c.cost < best.cost - 1e-9) best = c;
  }
  if (stay && prev?.nodes?.size) {
    const kept = stayPlacement(graph, best!.p, prev, sized.groupHeader, spacing.groupPad, spacing.nodeGap, sized.groupMinWidth);
    if (kept) {
      const placed = normalise({ ...kept, edges: route(sized, kept) });
      const sc = score(measure(graph, placed, sized.groupHeader, sized.groupMinWidth));
      const cost = sc + moveCost(kept, prev);
      // Only when it differs: a fresh placement that is exactly the previous one is not "held".
      if (cost < best!.cost - 1e-9) best = { p: kept, placed, score: sc, cost, key: prev.variant ?? best!.key, sized, held: true };
    }
  }
  return best!;
}

function moveCost(p: Placement, prev: LayoutMemory | undefined): number {
  const share = movedShare(p.nodes, prev?.nodes);
  return share > 0 ? MOVE_BASE + MOVE_EACH * share : 0;
}

/** The best drawing from one dot placement: compacted or not, straightened or not. */
async function candidates(sized: Sized, spacing: Spacing, tuning: Tuning, name: string, variant: DotVariant, prev: LayoutMemory | undefined): Promise<Choice> {
  const { graph } = sized;
  // Room for labels between columns; lines between table rows end in crow's feet on both sides.
  const rows = graph.edges.some((e) => e.from.row || e.to.row);
  const widest = Math.max(0, ...[...sized.edgeLabels.values()].map((l) => l.width));
  const room = tuning.labelRoom === 'fit' && graph.direction === 'right' ? Math.max(24, Math.min(240, widest + 48 - spacing.layerGap)) : 24;
  const fit = tuning.labelRoom === 'fit' && graph.direction === 'right' && sized.edgeLabels.size > 0;
  const asked = await placeWithDot(sized, spacing, (sized.edgeLabels.size ? room : 0) + (rows ? 48 : 0), variant);
  // dot's gap is one size for all layers, the widest label's: each gap is closed to what its own lines need.
  const squeezed = fit && tuning.squeeze !== false;
  const placed = squeezed ? squeeze(asked, sized, spacing) : asked;
  const finish = (q: Placement, straighten: boolean) => {
    const straightened = straighten ? alignPorts(q, graph, sized.nodes, sized.groupHeader, spacing.groupPad) : q;
    const tidied = tuning.tidy === false ? straightened : tidy(straightened, graph, sized.groupHeader, spacing.groupPad, spacing.nodeGap, sized.groupMinWidth);
    const start = graph.direction === 'down' && tuning.tidy !== false ? chimneys(tidied, sized) : tidied;
    // A label that cannot sit clear of a group border gets room: space is opened just before that
    // border and the lines are drawn again.
    type Drawn = { p: Placement; edges: Map<string, PlacedEdge> };
    const clear = (d: Drawn, left: number, branch: boolean): Drawn => {
      const cuts = left ? labelOnBorder(d.p, d.edges, sized.groupHeader) : [];
      if (!cuts.length) return d;
      // A label at a group's corner can be cleared across or down. Which is better only shows in
      // the finished drawing, so (once) both are drawn to the end: fewer crossings wins, then the better drawing.
      const ends = (branch ? cuts : cuts.slice(0, 1)).map((cut) => {
        const q = openSpace(d.p, cut, graph);
        return clear({ p: q, edges: route(sized, q) }, left - 1, branch && cuts.length < 2);
      });
      if (ends.length < 2) return ends[0]!;
      const worth = (e: Drawn) => {
        const m = measure(graph, normalise({ ...e.p, edges: e.edges }), sized.groupHeader, sized.groupMinWidth);
        return m.crossings * 1000 + score(m);
      };
      return worth(ends[1]!) < worth(ends[0]!) - 1e-9 ? ends[1]! : ends[0]!;
    };
    const { p, edges } = clear({ p: start, edges: route(sized, start) }, 4, true);
    return { placed: normalise({ ...p, edges }), p };
  };
  // Each helps some diagrams and hurts others, so all are drawn and the best one is kept.
  const packed = (q = placed) => compact(q, graph, sized.groupHeader, spacing.groupPad, spacing.nodeGap, sized.groupMinWidth);
  const bases: [boolean, Placement][] = tuning.compact === false ? [[false, placed]] : tuning.compact ? [[true, packed()]] : [[false, placed], [true, packed()]];
  const aligns = tuning.align === false ? [false] : tuning.align ? [true] : [false, true];
  let best: Choice | undefined;
  for (const [c, base] of bases)
    for (const a of aligns) {
      let drawn = finish(base, a);
      const key = `${graph.direction}/${name}/${c ? 'c' : ''}${a ? 'a' : ''}${c || a ? '' : '-'}`;
      let m = measure(graph, drawn.placed, sized.groupHeader, sized.groupMinWidth);
      // Closing the gaps can leave two labels of one fan without room beside each other: then the
      // same drawing with dot's own gaps is the better one.
      if (squeezed && m.labelOverlaps > 0) {
        const wide = finish(c ? packed(asked) : asked, a);
        const wm = measure(graph, wide.placed, sized.groupHeader, sized.groupMinWidth);
        if (score(wm) < score(m)) [drawn, m] = [wide, wm];
      }
      const sc = score(m);
      // Close to the previous drawing counts; with only its variant known, being that variant does.
      const cost = sc + (prev?.nodes?.size ? moveCost(drawn.p, prev) : prev?.variant && prev.variant !== key ? SWITCH : 0);
      if (!best || cost < best.cost - 1e-9) best = { ...drawn, score: sc, cost, key, sized };
    }
  return best!;
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
  // The groups around each end, all the way up: a line is at home in those and a stranger in the rest.
  const groupParent = new Map(graph.groups.map((g) => [g.id, g.parent]));
  const nodeParent = new Map(graph.nodes.map((n) => [n.id, n.parent]));
  const home = (...ends: string[]) => {
    const out = new Set<string>();
    for (const id of ends) for (let g = groupParent.has(id) ? id : nodeParent.get(id); g && !out.has(g); g = groupParent.get(g)) out.add(g);
    return [...out].sort();
  };
  const edges: RouteRequest[] = [];
  for (const e of graph.edges) {
    const from = end(e.from, e.start);
    const to = end(e.to, e.end);
    // Dotted lines (lookups, management) route last, so the main flow gets the best paths.
    if (from && to) edges.push({ id: e.id, from, to, label: sized.edgeLabels.get(e.id), order: e.line === 'dotted' ? 1 : 0, style: `${e.line}|${e.tone ?? ''}|${e.start}|${e.end}|${e.width ?? 1}`, via: via?.get(e.id), home: home(e.from.node, e.to.node) });
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
    return [titleBox(b, w)];
  });
  const groups = graph.groups.flatMap((g) => (p.groups.has(g.id) ? [{ id: g.id, box: p.groups.get(g.id)!, parent: g.parent }] : []));
  return routeEdges({ obstacles: p.nodes, soft, labelZones, texts, groups, header: sized.groupHeader, direction: graph.direction, edges });
}

/** Where a group's title is written, with a little air: `minWidth` is the title's width plus the room size.ts keeps around it. */
function titleBox(b: Box, minWidth: number): Box {
  return { x: b.x + 12, y: b.y + 13, width: Math.min(b.width, minWidth) - 52, height: 18 };
}

/**
 * Top-down, lines come into a group's first row from above, right where the group's title is
 * written. A card standing wholly under the title has no spot to drop a line into, so its lines
 * would loop around the title. Such a card moves along, with everything from its middle on, until
 * its top has room beside the title for the lines that come down into it: a chimney.
 */
function chimneys(p: Placement, sized: Sized): Placement {
  const { graph } = sized;
  const centreX = (b: Box) => b.x + b.width / 2;
  for (let round = 0; round < graph.groups.length; round++) {
    let cut: Cut | undefined;
    for (const n of graph.nodes) {
      const b = p.nodes.get(n.id);
      const g = p.groups.get(n.parent ?? '');
      const w = sized.groupMinWidth.get(n.parent ?? '');
      if (!b || !g || w == null || b.y - g.y > sized.groupHeader + 4) continue;
      // Lines that reach this card's top: the other end lies wholly above it.
      const above = (id: string) => {
        const o = p.nodes.get(id) ?? p.groups.get(id);
        return !!o && o.y + o.height <= b.y;
      };
      const k = graph.edges.filter((e) => (e.to.node === n.id && above(e.from.node)) || (e.from.node === n.id && above(e.to.node))).length;
      if (!k) continue;
      const t = titleBox(g, w);
      // Room for the ports 12px apart, the first one a little in from the corner.
      const need = t.x + t.width + 8 + 12 * k - (b.x + b.width - 12);
      if (need > 0 && (!cut || centreX(b) < cut.at)) cut = { axis: 'x', at: centreX(b) - 0.5, by: Math.ceil(need / 8) * 8, group: n.parent! };
    }
    if (!cut) break;
    p = openSpace(p, cut, graph, centreX);
  }
  return p;
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
  /** The group whose border the label lay on. */
  group: string;
}

/** The first label lying on a group's border or header, as the space to open before that border: the cheapest cut across and the cheapest down, cheapest first. */
function labelOnBorder(p: Placement, edges: Map<string, PlacedEdge>, header: number): Cut[] {
  const t = 4;
  for (const e of edges.values()) {
    const l = e.label;
    if (!l) continue;
    // A label at a group's corner touches two borders at once.
    const cuts: Partial<Record<'x' | 'y', Cut>> = {};
    for (const [group, b] of p.groups)
      for (const [axis, at] of [['x', b.x], ['x', b.x + b.width], ['y', b.y], ['y', b.y + b.height]] as const) {
        const [lo, hi, size] = axis === 'x' ? [l.x, l.x + l.width, l.width] : [l.y, l.y + l.height, l.height];
        // Within the border's extent, and touching its line.
        const [o0, o1] = axis === 'x' ? [b.y, b.y + b.height] : [b.x, b.x + b.width];
        const [l0, l1] = axis === 'x' ? [l.y, l.y + l.height] : [l.x, l.x + l.width];
        // The top border is as thick as the header: a label may not sit in it either.
        const after = axis === 'y' && at === b.y ? header : t;
        if (!(lo < at + after && hi > at - t && l0 < o1 && l1 > o0)) continue;
        const by = Math.ceil((size + 4 * t) / 8) * 8;
        // On a group's far border with something beyond it: the room opens outside the group, which
        // stays snug around what it holds. Otherwise before the border (the group moves on, or grows).
        const far = at !== b[axis];
        const beyond = far && [...p.nodes.values(), ...p.groups.values()].some((q) => q[axis] > at);
        if (!cuts[axis] || by < cuts[axis].by) cuts[axis] = { axis, at: beyond ? at + 1 : Math.min(lo, at) - 2 * t, by, group };
      }
    const found = [cuts.x, cuts.y].filter((c): c is Cut => !!c).sort((a, b) => a.by - b.by);
    if (found.length) return found;
  }
  return [];
}

/**
 * Push everything that starts at or past the cut further along. Of the groups the cut runs through,
 * those grow that hold something pushed, and the one whose border the label lay on (with the groups
 * around it): a group that merely reaches past the cut, with nothing in it moved, stays as it was
 * instead of gaining an empty side.
 */
function openSpace(p: Placement, c: Cut, graph: Sized['graph'], nodeAt: (b: Box) => number = (b) => b[c.axis]): Placement {
  const size = c.axis === 'x' ? 'width' : 'height';
  const pushed = (b: Box | undefined) => !!b && b[c.axis] >= c.at;
  // Nodes may be told apart by another point than their start (their middle: what is lined up stays lined up).
  const pushedNode = (b: Box | undefined) => !!b && nodeAt(b) >= c.at;
  const move = (b: Box) => (pushed(b) ? { ...b, [c.axis]: b[c.axis] + c.by } : b);
  const parent = new Map(graph.groups.map((g) => [g.id, g.parent]));
  const grows = new Set<string>();
  const mark = (id: string | undefined) => {
    for (let g = id; g && !grows.has(g); g = parent.get(g)) grows.add(g);
  };
  mark(c.group);
  for (const n of graph.nodes) if (pushedNode(p.nodes.get(n.id))) mark(n.parent);
  for (const g of graph.groups) if (pushed(p.groups.get(g.id))) mark(g.parent);
  const grow = (id: string, b: Box) => (pushed(b) ? move(b) : b[c.axis] + b[size] > c.at && grows.has(id) ? { ...b, [size]: b[size] + c.by } : b);
  const nodes = new Map([...p.nodes].map(([k, b]) => [k, pushedNode(b) ? { ...b, [c.axis]: b[c.axis] + c.by } : b]));
  const groups = new Map([...p.groups].map(([k, b]) => [k, grow(k, b)]));
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
