// Layout: dot places nodes and groups, pins from the sidecar move nodes, our router draws the lines.
import { unpackLayout, type Box, type EdgeOverride, type Graph, type Endpoint, type LayoutMemory, type LayoutSidecar, type Marker, type Placed, type PlacedEdge, type Point, type Sized } from '@cartography/core';
import { placeWithDot, type DotVariant, type Placement, type Spacing } from './dot.ts';
import { applyPins } from './pins.ts';
import { compact } from './compact.ts';
import { alignLoners, alignPorts } from './align.ts';
import { evenGroups, tidy } from './tidy.ts';
import { squeeze } from './squeeze.ts';
import { clearAnnexLines, liftAnnexes, stackAnnexes } from './annex.ts';
import { disorder, labelMetrics, lineFaults, measure, plainLine, score, touchedLabels, voidShare, boxOverlaps, type LayoutMetrics } from './metrics.ts';
import { routeEdges, type RouteEnd, type RouteRequest } from './router.ts';
import { movedShare, stayPlacement } from './stay.ts';
import { wrap, wrapScopes, type WrapOptions } from './wrap.ts';

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
  /** Draw the mirror image (across the flow) when that puts groups in the order they are written; tried both ways unless set. */
  mirror?: boolean;
  /** Straighten almost-straight lines (see align.ts): forced on or off; tried both ways when unset. */
  align?: boolean;
  /** Grid, rows and snug groups (see tidy.ts); on unless false. */
  tidy?: boolean;
  /** Ask dot this way only, instead of trying the usual variants. */
  dot?: DotVariant;
  /** The source left the direction open: a drawing far wider (or taller) than its target shape may turn. */
  autoDirection?: boolean;
  /** The shape to aim for, width / height (16:9 when not set); 'auto' takes the drawing as it comes. */
  aspect?: number | 'auto';
  /** false: never cut into rows or columns for the page (a hierarchy that must read top-down, as UML classes). */
  wrap?: false;
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
  // Asked only of a drawing with annexes (annex.ts): each set beside its table, clear of the table's other lines.
  ['annex', { annex: true }],
  ['same-annex', { sameRank: true, annex: true }],
  ['stack', { stack: true }],
  ['same-stack', { sameRank: true, stack: true }],
];

/**
 * What moving away from the previous drawing costs, in score points: a little for moving anything
 * at all, and more the larger the share of nodes that moves. Another placement has to be better by
 * this much to win: about two crossings for a small shuffle, half a dozen for redrawing everything.
 */
const MOVE_BASE = 16;
const MOVE_EACH = 60;
/** Up to this many nodes, a drawing that cannot stay as it was tries staying put with one node free (see choose). */
const REPAIR_LIMIT = 24;
/**
 * From this many nodes (one of them under a tenth), a drawing that stays as it was but crosses lines it need not also tries that:
 * one card of so many moving still reads as the same drawing; in a smaller one it does not.
 */
const MEND_FROM = 10;
/** With only the way it was made remembered (no positions), another way has to be this much better. */
const SWITCH = 12;

interface VariantKey {
  direction: 'right' | 'down';
  dot: DotVariant;
  compact: boolean;
  align: boolean;
  mirror: boolean;
  /** Cut into this many rows (columns, top-down) by wrap.ts; 0 when not. */
  wrap: number;
  /** How it was cut: a chain too, inside which group. */
  wrapOpts: WrapOptions;
}

function parseKey(key: string | undefined): VariantKey | undefined {
  const m = /^(right|down)\/([a-z-]+)\/(c?)(a?)(m?)-?(?:w(\d)(c?)(l?)(f?)(t?)(?:@(.+))?)?$/.exec(key ?? '');
  const dot = VARIANTS.find(([name]) => name === m?.[2])?.[1];
  const wrapOpts: WrapOptions = { ...(m?.[7] ? { chains: true } : {}), ...(m?.[8] ? { loose: true } : {}), ...(m?.[9] ? { flip: true } : {}), ...(m?.[10] ? { transpose: true } : {}), ...(m?.[11] ? { scope: m[11] } : {}) };
  return m && dot ? { direction: m[1] as 'right' | 'down', dot, compact: !!m[3], align: !!m[4], mirror: !!m[5], wrap: Number(m[6] ?? 0), wrapOpts } : undefined;
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
  const before = tuning.previous === null ? undefined : (tuning.previous ?? unpackLayout(sidecar?.layout));
  const was = parseKey(before?.variant);
  // Groups put in another order in the source since the drawing before: that asks for them to move,
  // so nothing is held where it was.
  const prev = before?.disorder != null && before.groups && disorder(graph, before.groups) > before.disorder ? undefined : before;
  const open = !!tuning.autoDirection && !tuning.direction;
  const turned = (d: 'right' | 'down'): Sized => (d === graph.direction ? sized : { ...sized, graph: { ...graph, direction: d } });
  // The previous drawing is kept in the direction it had (when the source leaves the direction open).
  const stayIn = open && was ? was.direction : graph.direction;

  const target = tuning.aspect === 'auto' ? undefined : (tuning.aspect ?? SLIDE);
  const shape = shapeOf(graph, open, target);
  // The same diagram drawn again (a label edited, a colour changed, the same file opened): the way it
  // was drawn (direction, way of asking dot, packed, straightened, mirrored, wrapped) is drawn again
  // and the others are not tried. Each of those is routed in full, which is most of what a layout
  // costs, and next to the previous drawing kept as it was they win only when the diagram changed.
  const same = !!prev && !!was && prev.shape === shape && (open || was.direction === graph.direction);

  let best: Choice;
  if (was && (pinned || same) && !tuning.dot) {
    // Pins were set on one placement: the one the sidecar names is drawn again, whatever the others
    // would score now. Moving a pin never redraws the rest. (Nor does drawing the same diagram again.)
    const d = open ? was.direction : graph.direction;
    // And what is not pinned stays where it was whenever it can: placing things by hand, the rest
    // holding still is worth more than any score.
    best = await choose(turned(d), spacing, { ...tuning, dot: was.dot, compact: tuning.compact ?? was.compact, align: tuning.align ?? was.align, mirror: tuning.mirror ?? was.mirror }, prev, d === stayIn, pinned ? new Map(Object.entries(sidecar?.nodes ?? {})) : undefined);
    if (was.wrap && !best.held) best = rewrap(best, spacing, was.wrap, was.wrapOpts, target) ?? best;
  } else {
    best = await choose(sized, spacing, tuning, prev, graph.direction === stayIn, undefined, true);
    const asked = best;
    // A long chain drawn left to right can end up many times wider than tall, and a deep tree drawn
    // top-down many times taller than wide: neither fits a slide or a page. When the source did not
    // choose a direction, the other one is tried too and kept when its shape is nearer the target
    // (16:9 unless the source says otherwise) without more crossings or any new error. With a
    // drawing before this one, that one's direction is tried as well, so it can stay that way.
    const other = graph.direction === 'right' ? 'down' : 'right';
    const wide = graph.direction === 'right' && best.placed.width >= WIDE * best.placed.height;
    // Shape alone asks for another try only on a first drawing of a diagram small enough to draw twice.
    // So does a drawing with labels on cards or lines through them: the other direction may have none.
    const reshape = !was && graph.nodes.length <= VARIANT_LIMIT && ((target != null && off(best.placed, graph, target) > OFF) || errors(best) > 0);
    let turnedAlt: Choice | undefined;
    if (open && (stayIn === other || wide || reshape)) {
      const alt = await choose(turned(other), spacing, tuning, prev, stayIn === other, undefined, true);
      turnedAlt = alt;
      const [a, b] = target == null ? [0, 0] : [off(alt.placed, graph, target), off(best.placed, graph, target)];
      // Without a drawing before, the one that fits the target shape (within OFF) and is clearly
      // nearer it wins, when it is no worse. Otherwise the better drawing: its shape is why the other
      // is tried at all, so on a near tie the drawing as asked loses, unless the previous drawing was
      // that one. A long chain, far off either way, goes top-down there as it always did.
      const fits = (x: number, y: number) => !was && x <= OFF && x < y - NEARER;
      if (fits(a, b) && noWorse(alt, best)) best = alt;
      // Or, on a first drawing, when it reads clearly better on the page (larger text, for what it costs).
      else if (!was && target != null && readsBetter(alt, best, target)) best = alt;
      // A shape is no reason to keep a drawing with labels on cards or lines through them that the other is free of.
      else if (errors(best) > errors(alt) && alt.cost < best.cost) best = alt;
      // Tried for its shape alone (the drawing is not a wide chain), a clearly worse shape never wins;
      // nor, on a first drawing of a few cards (too few to wrap), a worse shape that comes out clearly smaller on the page;
      // nor, on a first drawing, one whose text a slide shows smaller than 6 pt, or without the margin, where the other's it does not (slideTier);
      // nor, where the other's text a slide shows without that margin, one whose text comes out smaller still (AS_LARGE).
      else if (!(target != null && !was && (slideTier(alt, target) < slideTier(best, target) || (slideTier(best, target) < 2 && pageScale(alt.placed, graph, target) < AS_LARGE * pageScale(best.placed, graph, target)))) && !(fits(b, a) && noWorse(best, alt)) && !(!was && !wide && stayIn !== other && b < a - NEARER) && alt.cost < best.cost + (was?.direction === graph.direction ? 0 : TIE) - 1e-9 && !(!was && graph.nodes.length <= FEW && target != null && a > b && readsAs(alt, target) < readsAs(best, target) - WRAP_GAIN)) best = alt;
    }
    // Still far too wide (or tall): cut it into rows (or columns) of whole blocks, when that comes nearer.
    if (!was && tuning.wrap !== false && graph.nodes.length <= VARIANT_LIMIT && target != null && off(best.placed, graph, target) > WRAP_OFF) {
      const kept = best;
      best = wrapped(best, spacing, target) ?? best;
      // The other direction, wrapped, may read better still (a drawing far off the page's shape both ways).
      // The drawing in the direction not kept: that one, wrapped, may read better still.
      const unkept = turnedAlt && (turnedAlt === kept ? asked : turnedAlt);
      const other = unkept && unkept !== kept && graph.nodes.length <= WRAP_ALL && off(unkept.placed, graph, target) > WRAP_OFF ? wrapped(unkept, spacing, target, best) : undefined;
      if (other && readsBetter(other, best, target)) best = other;
    }
    // A drawing that was wrapped is wrapped again the same way (unless it was held as it was).
    else if (tuning.wrap !== false && was?.wrap && !best.held && best.sized.graph.direction === was.direction) best = rewrap(best, spacing, was.wrap, was.wrapOpts, target) ?? best;
  }

  // A label with another line through it gets room, when the drawing comes out no worse for it.
  if (!best.held && !pinned) best = clearLines(best, target);
  const s = best.sized;
  const memory: LayoutMemory = {
    variant: best.key,
    shape,
    ...(best.held ? { held: true } : {}),
    disorder: disorder(s.graph, best.p.groups),
    nodes: new Map([...best.p.nodes].map(([id, b]) => [id, { x: b.x + b.width / 2, y: b.y + b.height / 2 }])),
    groups: new Map(best.p.groups),
  };
  const direction = s.graph.direction !== graph.direction ? { direction: s.graph.direction } : {};
  // Pins and lines bent by hand come last, on the placement chosen without them: a pin moves its
  // node (and makes room for it), a bend changes one line, and neither changes where the rest goes.
  const joins = (id: string, o: EdgeOverride) => s.graph.edges.some((e) => e.id === id && (o.from == null || e.from.node === o.from) && (o.to == null || e.to.node === o.to));
  const via = new Map(Object.entries(sidecar?.edges ?? {}).filter(([id, o]) => o.via?.length && joins(id, o)).map(([id, o]) => [id, o.via]));
  if (!pinned && !via.size) return { ...best.placed, ...direction, memory };
  const p: Placement & { nudged?: string[] } = pinned ? applyPins(best.p, s.graph, sidecar, s.groupHeader, spacing.groupPad) : best.p;
  const nudged = p.nudged?.length ? { nudged: p.nudged } : {};
  return { ...normalise({ ...p, edges: route(s, p, via.size ? via : undefined) }), ...direction, memory, ...nudged };
}

/** What a diagram is made of, without sizes or words (LayoutMemory.shape): a short hash. */
function shapeOf(graph: Graph, open: boolean, target: number | undefined): string {
  const parts = [
    `${graph.direction}${open ? '?' : ''} ${target ?? 'auto'}`,
    ...graph.groups.map((g) => `#${g.id}<${g.parent ?? ''}`),
    ...graph.nodes.map((n) => `${n.id}<${n.parent ?? ''}`),
    ...graph.edges.map((e) => `${e.from.node}.${e.from.row ?? ''}>${e.to.node}.${e.to.row ?? ''}${e.loose ? '~' : ''}`),
  ];
  // FNV-1a, 32 bits.
  let h = 0x811c9dc5;
  for (const ch of parts.join('\n')) h = Math.imul(h ^ ch.codePointAt(0)!, 0x01000193);
  return (h >>> 0).toString(36);
}

/** A drawing of this many cards or fewer fits a page side by side: it is not a long chain to turn. */
const FEW = 5;
/** Wider than this many times the height, a left-to-right drawing is also tried top-down. */
const WIDE = 3;
/** The shape a drawing aims for unless the source says otherwise: a slide. */
const SLIDE = 16 / 9;
/** Further than this from the target shape (as a log ratio: from about square to 3:1 for 16:9), another shape is tried. */
const OFF = Math.log(1.8);

/**
 * How far a drawing's shape is from the target, as a log ratio: 0 is spot on. The shape is that of
 * the whole picture: the margins, the title (and subtitle) above and the key below, about as render draws them.
 */
function off(p: Pick<Placed, 'width' | 'height'>, graph: Graph, target: number): number {
  const width = p.width + 80;
  const height = p.height + 125 + (graph.subtitle ? 20 : 0) + (graph.legend?.length ? 55 : 0);
  return Math.abs(Math.log(width / height / target));
}

/** How much nearer the target shape (log ratio) another drawing has to come to be worth its change. */
const NEARER = 0.2;

/**
 * How large a drawing comes out on a page of the target shape: the scale it is drawn at to fit a
 * page 720 px high (a 16:9 slide is 1280 by 720). Text size on the slide goes with it.
 */
export function pageScale(p: Pick<Placed, 'width' | 'height'>, graph: Graph, target: number): number {
  const width = p.width + 80;
  const height = p.height + 125 + (graph.subtitle ? 20 : 0) + (graph.legend?.length ? 55 : 0);
  return Math.min((720 * target) / width, 720 / height);
}

/**
 * The page scale at which the words on a slide are comfortably read (about 8 pt for the small
 * labels on lines). Below it every doubling counts twice: a drawing whose text is too small to read
 * gains more from larger text than it loses to a crossing or a line back.
 */
export const READABLE_SCALE = 0.95;
/** How much more each doubling below READABLE_SCALE counts (1: twice). */
export const SMALL_COST = 1;
/**
 * A picture outside the band of slide shapes (1.1:1 to 2.4:1 for 16:9, in proportion for another
 * target) leaves most of a slide empty and reads as a strip: weighed with small text, each unit of
 * log ratio past the band costs this much.
 */
const SHAPE_COST = 2;
const BAND: [number, number] = [1.1 / SLIDE, 2.4 / SLIDE];

/** How far (log ratio) a picture's shape lies outside the band of slide shapes; 0 inside it. */
function outOfBand(p: Pick<Placed, 'width' | 'height'>, graph: Graph, target: number): number {
  const width = p.width + 80;
  const height = p.height + 125 + (graph.subtitle ? 20 : 0) + (graph.legend?.length ? 55 : 0);
  const r = width / height / target;
  return Math.max(0, Math.log(BAND[0] / r), Math.log(r / BAND[1]));
}
/** What one crossing costs in readability, in doublings of the page scale: one crossing is worth 19% larger text. */
export const CROSSING_COST = 0.25;
/** And one line running back against the flow (the line down to the next row of a wrapped chain). */
export const BACKWARD_COST = 0.05;
/** And empty room: per share of the drawing far from everything (metrics voids), as a block left alone on a row leaves. */
export const VOID_COST = 1.5;
/** And a line that misleads (lineFaults): a loop, a hook at an end, arrowheads on each other, a line that seems to run on into another. */
export const FAULT_COST = 0.1;
/** A wrapped drawing must read this much better (in doublings of scale: 11% larger text) to be kept. */
const WRAP_GAIN = 0.15;

/**
 * How well a drawing reads on a page of the target shape, higher is better: the size it is drawn at
 * (log2 of the page scale) less what its crossings, its lines against the flow and its empty room cost. Wrapping
 * trades one for the other: rows make the text larger but may cost a crossing or a line back.
 */
export function slideReadability(scale: number, crossings: number, backward: number, voids = 0, small = SMALL_COST): number {
  return Math.log2(scale) - small * Math.max(0, -Math.log2(scale / READABLE_SCALE)) - CROSSING_COST * crossings - BACKWARD_COST * backward - VOID_COST * voids;
}

/** A wrapped drawing comes out at least this much larger on the page (its text a fifth larger). */
const LARGER = 1.2;
/** Or, for a drawing whose text is under 6 pt on the slide (slideScale), at least this much larger (its text 15% larger). */
const LARGER_SMALL = 1.15;
/** How much larger a wrapped drawing (of these sizes) must come out than one at page scale `sb` to be worth it. */
const largerThan = (sb: number, s: Sized) => (sb < slideScale(s) ? LARGER_SMALL : LARGER) * sb;
/** Or comes out about as large (text at most 3% smaller) and nearer a slide's shape. */
const AS_LARGE = 0.97;
/** Up to this many nodes every way of wrapping is tried (inside groups, chains, loose cuts, four parts). */
const WRAP_ALL = 30;
/** Further than this from the target shape (log ratio), wrapping into rows or columns is tried. */
const WRAP_OFF = Math.log(1.3);

type Flaw = 'edgeThroughNode' | 'labelOverlaps' | 'overlaps' | 'headerHits' | 'borderHits' | 'jogs' | 'labelOnBend';
const FLAWS: Flaw[] = ['edgeThroughNode', 'labelOverlaps', 'overlaps', 'headerHits', 'borderHits', 'jogs', 'labelOnBend'];
/** Weighed with text too small counting double, steps aside and labels on a bend only cost (readsAs). */
const HARD_FLAWS: Flaw[] = FLAWS.filter((k) => k !== 'jogs' && k !== 'labelOnBend');

/** Each drawing's metrics, measured once: the wrap search weighs one drawing against many. */
const measured = new WeakMap<Placed, LayoutMetrics>();
function metricsOf(c: Pick<Choice, 'placed' | 'sized'>): LayoutMetrics {
  let m = measured.get(c.placed);
  if (!m) measured.set(c.placed, (m = measure(c.sized.graph, c.placed, c.sized.groupHeader, c.sized.groupMinWidth)));
  return m;
}

const touching = new WeakMap<Placed, number>();
function touchingOf(c: Choice): number {
  let n = touching.get(c.placed);
  if (n == null) touching.set(c.placed, (n = labelMetrics(c.sized.graph, c.placed).labelTouching));
  return n;
}

const faults = new WeakMap<Placed, number>();
/** Lines that mislead (lineFaults): loops, hooks at an end, arrowheads on each other, a line that seems to run on into another. */
function faultsOf(c: Choice): number {
  let n = faults.get(c.placed);
  if (n == null) {
    const f = lineFaults(c.sized.graph, c.placed);
    faults.set(c.placed, (n = f.loops + f.hooks + f.heads + f.continuations));
  }
  return n;
}

/**
 * How a drawing reads on the page, flaws or not. Weighed with text too small counting double
 * (`small`), steps aside and labels on a bend count as misleading lines too (with it they are no veto).
 */
function readsAs(c: Choice, target: number, small = SMALL_COST): number {
  const m = metricsOf(c);
  const shape = small ? SHAPE_COST * outOfBand(c.placed, c.sized.graph, target) : 0;
  return slideReadability(pageScale(c.placed, c.sized.graph, target), m.crossings, m.backward, m.voids, small) - FAULT_COST * (faultsOf(c) + (small ? m.jogs + m.labelOnBend : 0)) - shape;
}

/** How a drawing reads on the page (slideReadability), or undefined when it has a flaw (FLAWS, touching labels) the other is free of. */
function readability(c: Choice, than: Choice, target: number, small = SMALL_COST): number | undefined {
  const m = metricsOf(c);
  const m0 = metricsOf(than);
  if ((small ? HARD_FLAWS : FLAWS).some((k) => m[k] > m0[k])) return undefined;
  if (touchingOf(c) > touchingOf(than)) return undefined;
  return readsAs(c, target, small);
}

/**
 * Whether `a` reads clearly better on the page than `b`: weighed as it is, or, when it comes out
 * clearly larger (LARGER), with text too small to read weighed double (SMALL_COST). A drawing whose
 * text is small gives up a crossing or a line back for text a fifth larger; one already readable does not.
 */
function readsBetter(a: Choice, b: Choice, target: number): boolean {
  // Never further outside the band of slide shapes than the drawing it would replace.
  if (outOfBand(a.placed, a.sized.graph, target) > Math.max(1e-9, outOfBand(b.placed, b.sized.graph, target))) return false;
  // Nor a drawing whose text comes out at 6 pt or more on a slide by one whose text comes out smaller (slideTier).
  if (slideTier(a, target) < slideTier(b, target)) return false;
  if (beats(readability(a, b, target, 0), readsAs(b, target, 0))) return true;
  // Half as many again as it has only for text far too small (under half the readable size): a dense drawing at 2 pt.
  const crossed = metricsOf(b).crossings;
  const tiny = pageScale(b.placed, b.sized.graph, target) < READABLE_SCALE / 2;
  // And twice as many for text that a slide shows at 6 pt where the other's it does not: a crossing or
  // two is no reason to show a slide under 6 pt (multi-cloud with a longer group name: 3.9 pt unwrapped).
  const lifts = slideTier(a, target) > 0 && slideTier(b, target) === 0;
  if (metricsOf(a).crossings > crossed + Math.max(SMALL_CROSSINGS, tiny ? Math.ceil(crossed / 2) : 0, lifts ? 2 * SMALL_CROSSINGS : 0)) return false;
  // A drawing whose text a slide already shows with the margin (slideTier 2) takes on no crossing for larger text.
  if (slideTier(b, target) === 2 && metricsOf(a).crossings > crossed) return false;
  // Weighed with small text double, for text too small to read: only for text clearly larger, or for a
  // slide's shape at text as large.
  const [sa, sb] = [pageScale(a.placed, a.sized.graph, target), pageScale(b.placed, b.sized.graph, target)];
  const shaped = outOfBand(a.placed, a.sized.graph, target) < outOfBand(b.placed, b.sized.graph, target) - NEARER && sa >= AS_LARGE * sb;
  if (sb < READABLE_SCALE && (sa >= largerThan(sb, b.sized) || shaped) && beats(readability(a, b, target), readsAs(b, target))) return true;
  // Or when it brings text that is too small for a slide up to readable (slideScale), or up to the
  // margin above it (SLIDE_AIM), at no cost: no more crossings, no new flaw, and reading better however weighed.
  const r = readability(a, b, target);
  return slideTier(a, target) > slideTier(b, target) && metricsOf(a).crossings <= crossed && r != null && r > readsAs(b, target) + 1e-9 && (readability(a, b, target, 0) ?? -Infinity) > readsAs(b, target, 0) + 1e-9;
}
/** The least size (pt) for text on a slide. */
const SLIDE_PT = 6;
/**
 * And the size aimed for (6.3 pt): a drawing just at 6 pt goes under it as soon as a label gets a
 * word longer, so of two drawings a slide reads, the one with this margin is the one kept.
 */
const SLIDE_AIM = 6.3;
/**
 * The page scale at which a drawing's smallest words (Sized.smallText: labels on lines, group names;
 * 10 px when not said) come out at `pt` on the page. A pixel is three quarters of a point.
 */
const slideScale = (s: Sized, pt = SLIDE_PT) => pt / (0.75 * (s.smallText ?? 10));
/** How a drawing's text comes out on a slide: 2 with the margin (SLIDE_AIM), 1 at 6 pt or more, 0 under. */
function slideTier(c: { placed: Pick<Placed, 'width' | 'height'>; sized: Sized }, target: number): number {
  const sc = pageScale(c.placed, c.sized.graph, target);
  return sc >= slideScale(c.sized, SLIDE_AIM) ? 2 : sc >= slideScale(c.sized) ? 1 : 0;
}
/** For larger text a drawing may take on this many more crossings (half as many again as it has when its text is tiny), no more: past that it is a tangle, however large. */
const SMALL_CROSSINGS = 2;
const beats = (r: number | undefined, than: number) => r != null && r > than + WRAP_GAIN + 1e-9;

/** Lines that run back against the flow whatever their route: the box they go to lies wholly before the one they leave. */
function surelyBack(graph: Graph, p: Placement): number {
  const down = graph.direction === 'down';
  let n = 0;
  for (const e of graph.edges) {
    const s = p.nodes.get(e.from.node) ?? p.groups.get(e.from.node);
    const t = p.nodes.get(e.to.node) ?? p.groups.get(e.to.node);
    if (!e.loose && s && t && (down ? t.y + t.height < s.y - 1 : t.x + t.width < s.x - 1)) n++;
  }
  return n;
}

/** A wrapped drawing longer than this many times its depth is a strip. */
const STRIP = 3;

/** At most this many wrapped drawings are routed in one search, the most promising first. */
const WRAP_ROUTED = 12;

/**
 * The drawing cut into rows (columns, top-down), at the top level or inside a group that takes most
 * of its length, when that reads clearly better on the page (slideReadability) without any new error
 * (lines through boxes, covered labels, overlaps). With `than`, it must also read that much better
 * than that drawing (the one it would replace).
 *
 * Routing is what costs, so every cut is placed first and routed only when it could still win: its
 * lines can only cost (crossings, lines back), so the page scale of its boxes alone bounds how well
 * it can read. Cuts that come out the same are routed once.
 */
function wrapped(best: Choice, spacing: Spacing, target: number, than?: Choice): Choice | undefined {
  const s = best.sized;
  let found: Choice | undefined;
  const m0 = metricsOf(best);
  // A cut must read better than the drawing and the other one (readsBetter); of those that do, the one
  // that reads best with text too small weighed double wins. One whose boxes alone cannot come out above
  // the bar (either way of weighing) is not routed.
  const beat = than ? [best, than] : [best];
  // Each way of weighing has its own bar (readsBetter): a cut is routed when its boxes could clear either.
  const bars = (k: number) => Math.max(...beat.map((b) => readsAs(b, target, k))) + WRAP_GAIN;
  const [plainBar, smallBar] = [bars(0), bars(SMALL_COST)];
  // Or that could bring its text up a tier on a slide (readsBetter's last way).
  const tier = Math.max(...beat.map((b) => slideTier(b, target)));
  const could = (c: { bound: number; reach: number; tier: number }) => c.bound > plainBar - 1e-9 || c.reach > smallBar - 1e-9 || c.tier > tier;
  // A bigger diagram tries the plain cuts only.
  const small = s.graph.nodes.length <= WRAP_ALL;
  const scopes: (string | undefined)[] = [undefined, ...(small ? wrapScopes(best.p, s.graph) : [])];
  const modes = small ? [[false, false, false], [true, false, false], [true, true, false], [false, false, true], [true, true, true]] : [[false, false, false]];
  // A drawing too long along its flow is cut along it (rows of a left-to-right drawing); one too
  // thick across it (stacked domains), across it (wrap.ts transpose).
  const along = best.sized.graph.direction === 'down' ? best.placed.height / best.placed.width : best.placed.width / best.placed.height;
  const transpose = along < (best.sized.graph.direction === 'down' ? 1 / target : target);
  const cuts: { q: Placement; parts: number; opts: WrapOptions; bound: number; reach: number; tier: number; i: number }[] = [];
  const seen = new Set<string>();
  for (const scope of scopes)
    for (const [chains, loose, flip] of modes)
      for (const parts of small ? [2, 3, 4] : [2, 3]) {
        // Rows turned over only at the top: inside a group they would stand against the order written.
        if (flip && scope) continue;
        const opts: WrapOptions = { scope, chains, loose, ...(flip ? { flip } : {}), ...(transpose ? { transpose } : {}) };
        const q = wrap(best.p, s.graph, parts, spacing.layerGap, s.groupHeader, spacing.groupPad, s.groupMinWidth, opts, (r) => pageScale(r, s.graph, target));
        if (!q) continue;
        const sig = boxesKey(q);
        if (seen.has(sig)) continue;
        seen.add(sig);
        // Boxes on each other are a flaw no routing mends.
        if (boxOverlaps(s.graph, q).length > m0.overlaps) continue;
        const sq = pageScale(q, s.graph, target);
        const [plain, smallText] = [0, SMALL_COST].map((k) => slideReadability(sq, 0, surelyBack(s.graph, q), voidShare(q), k)) as [number, number];
        // Weighed with small text double only where readsBetter would (text too small, and clearly larger or nearer a slide's shape).
        const weighed = beat.some((b) => {
          const sb = pageScale(b.placed, s.graph, target);
          return sb < READABLE_SCALE && (sq >= largerThan(sb, s) || (outOfBand(q, s.graph, target) < outOfBand(b.placed, s.graph, target) - NEARER && sq >= AS_LARGE * sb));
        });
        cuts.push({ q, parts, opts, bound: plain, reach: weighed ? smallText - SHAPE_COST * outOfBand(q, s.graph, target) : -Infinity, tier: slideTier({ placed: q, sized: s }, target), i: cuts.length });
      }
  // The most promising first, so the bar rises early and the rest need not be routed; on a tie the
  // one tried first in the order above wins, as it always did.
  cuts.sort((a, b) => b.bound - a.bound || a.i - b.i);
  let routed = 0;
  for (const c of cuts) {
    if (routed >= WRAP_ROUTED) break;
    if (!could(c) || (found && c.tier <= slideTier(found, target) && Math.max(c.bound, c.reach) < readsAs(found, target) - 1e-9)) continue;
    routed++;
    const choice = rewrapped(best, spacing, c.q, c.parts, c.opts);
    // Cut into a strip far wider (or taller) than the drawing was: no shape for a page, however large its text.
    const strip = (c: Choice) => Math.max(c.placed.width / c.placed.height, c.placed.height / c.placed.width);
    const ok = (strip(choice) <= STRIP || strip(choice) <= strip(best)) && beat.every((b) => readsBetter(choice, b, target));
    // Text at 6 pt or more on a slide wins over text under it, and text with a margin over text just at it
    // (slideTier), however the two weigh otherwise: under it validate warns, and one word more tips it under.
    const [t, tf] = [slideTier(choice, target), found ? slideTier(found, target) : -1];
    if (ok && (!found || (t !== tf ? t > tf : readsAs(choice, target) > readsAs(found, target) + 1e-9))) found = choice;
  }
  return found;
}

/** The drawing cut into `parts` rows (columns), its key saying so, so the next drawing can be cut the same way. */
function rewrap(best: Choice, spacing: Spacing, parts: number, opts: WrapOptions = {}, target?: number): Choice | undefined {
  const s = best.sized;
  const q = wrap(best.p, s.graph, parts, spacing.layerGap, s.groupHeader, spacing.groupPad, s.groupMinWidth, opts, target == null ? undefined : (r) => pageScale(r, s.graph, target));
  return q && rewrapped(best, spacing, q, parts, opts);
}

/** A wrapped placement (wrap.ts) routed, its key saying how it was cut. */
function rewrapped(best: Choice, spacing: Spacing, wrappedQ: Placement, parts: number, opts: WrapOptions): Choice {
  const s = best.sized;
  // What stood outside everything, joined to one card, follows that card to its row.
  const aligned = alignLoners(wrappedQ, s.graph, spacing.layerGap);
  // Rows meet at new borders: a label lying on one gets room there too.
  const { p: q, edges } = clearBorders(s, { p: aligned, edges: route(s, aligned) });
  const placed = normalise({ ...q, edges });
  const sc = score(metricsOf({ placed, sized: s }));
  return { p: q, placed, score: sc, cost: sc, key: `${best.key.replace(/w\d.*$/, '')}w${parts}${opts.chains ? 'c' : ''}${opts.loose ? 'l' : ''}${opts.flip ? 'f' : ''}${opts.transpose ? 't' : ''}${opts.scope ? `@${opts.scope}` : ''}`, sized: s };
}

/** A placement and its lines. */
type Drawn = { p: Placement; edges: Map<string, PlacedEdge> };

/**
 * A label that cannot sit clear of a group border gets room: space is opened just before that border
 * and the lines are drawn again, at most `left` times.
 */
function clearBorders(sized: Sized, d: Drawn, left = 4, branch = true): Drawn {
  const { graph } = sized;
  const cuts = left ? labelOnBorder(d.p, d.edges, sized.groupHeader) : [];
  if (!cuts.length) return d;
  // A label at a group's corner can be cleared across or down. Which is better only shows in
  // the finished drawing, so (once) both are drawn to the end: fewer crossings wins, then the better drawing.
  // A cut after which the label still lies on that border (it moved on with its line, beside it)
  // opens room for nothing: it is not taken, or room would be opened again and again to no end.
  const ends: Drawn[] = [];
  for (const cut of cuts) {
    if (ends.length && !branch) break;
    const q = openSpace(d.p, cut, graph);
    const edges = route(sized, q);
    const l = cut.edge != null ? edges.get(cut.edge)?.label : undefined;
    if (l && borderCuts(q, l, sized.groupHeader).some((c) => c.group === cut.group && c.axis === cut.axis)) continue;
    ends.push(clearBorders(sized, { p: q, edges }, left - 1, branch && cuts.length < 2));
  }
  if (!ends.length) return d;
  if (ends.length < 2) return ends[0]!;
  const worth = (e: Drawn) => {
    const m = measure(graph, normalise({ ...e.p, edges: e.edges }), sized.groupHeader, sized.groupMinWidth);
    return m.crossings * 1000 + score(m);
  };
  return worth(ends[1]!) < worth(ends[0]!) - 1e-9 ? ends[1]! : ends[0]!;
}

/**
 * A label with another line through it or right along it: no spot on its own line was clear, the
 * channel it lies in is too narrow for its words and a neighbour's line (web-app: db_datawriter
 * across the TDS line; the walkthrough's "create invoice" across Notifier's line). Room is opened
 * where the label lies, across the line that touches it, and the lines are drawn again; kept when
 * that label (and no other) is now clear, with no more crossings or errors, and the text on a slide
 * comes out no smaller in tier (slideTier). At most `left` times.
 */
function clearLines(best: Choice, target: number | undefined, left = 3): Choice {
  const { sized } = best;
  const before = touchedLabels(sized.graph, best.placed);
  if (!left || !before.length) return best;
  const m0 = metricsOf(best);
  const shift = best.placed.shift ?? { x: 0, y: 0 };
  for (const t of before) {
    const [a, b] = t.by;
    // Across a vertical piece: room left to right; across a horizontal one: room top to bottom.
    const axis = a.x === b.x ? 'x' : 'y';
    const l = { ...t.label, x: t.label.x + shift.x, y: t.label.y + shift.y };
    const line = (axis === 'x' ? a.x : a.y) + (axis === 'x' ? shift.x : shift.y);
    const size = axis === 'x' ? l.width : l.height;
    // Before the label and the line (what lies past them moves on), or between them.
    const by = Math.ceil((size + 16) / 8) * 8;
    for (const at of [Math.min(l[axis], line) - 4, (Math.min(l[axis] + size, line) + Math.max(l[axis], line)) / 2]) {
      const q = openSpace(best.p, { axis, at, by, group: '' }, sized.graph);
      const drawn = clearBorders(sized, { p: q, edges: route(sized, q) });
      const placed = normalise({ ...drawn.p, edges: drawn.edges });
      const next: Choice = { ...best, p: drawn.p, placed, score: 0, cost: 0 };
      const m = metricsOf(next);
      const after = touchedLabels(sized.graph, placed);
      if (after.length >= before.length || after.some((x) => x.edge === t.edge)) continue;
      if (m.crossings > m0.crossings || errors(next) > errors(best) || faultsOf(next) > faultsOf(best)) continue;
      if (target != null && slideTier(next, target) < slideTier(best, target)) continue;
      const sc = score(m);
      return clearLines({ ...next, score: sc, cost: best.cost - best.score + sc }, target, left - 1);
    }
  }
  return best;
}

/** What no shape makes up for: lines through boxes, covered labels, boxes on each other. */
function errors(c: Choice): number {
  const m = metricsOf(c);
  return m.edgeThroughNode + m.labelOverlaps + m.overlaps;
}

/** A drawing with no more crossings than another and none of the errors (lines through boxes, covered labels, overlaps) that one is free of. */
function noWorse(a: Choice, b: Choice): boolean {
  const ma = metricsOf(a);
  const mb = metricsOf(b);
  return ma.crossings <= mb.crossings && ma.edgeThroughNode <= mb.edgeThroughNode && ma.labelOverlaps <= mb.labelOverlaps && ma.overlaps <= mb.overlaps;
}
/** How much better (in score) the wide drawing must be to be kept over the top-down one. */
const TIE = 1;

/** The best placement in one direction: each way of asking dot, and the previous drawing kept as it was (`changed`: the diagram is not the one drawn before). */
async function choose(sized: Sized, spacing: Spacing, tuning: Tuning, prev: LayoutMemory | undefined, stay: boolean, hold?: Map<string, Point>, changed = false): Promise<Choice> {
  // Top-down, lines come into a group's first row from above, and its header title sits right where
  // the leftmost of them would come in. A slightly taller header leaves a lane under the title: such
  // a line comes down beside the title, runs under it and drops into its node.
  if (sized.graph.direction === 'down') sized = { ...sized, groupHeader: sized.groupHeader + DOWN_LANE };
  const { graph } = sized;
  // dot ranks and orders differently when asked differently, and no one way suits every diagram.
  // Small diagrams try a few ways, each drawn in full, and the best one is kept. Big diagrams ask once.
  const big = graph.nodes.length > VARIANT_LIMIT;
  // One table with annexes (one data product and its contracts): its annexes are set by annex.ts, under or
  // beside it, so its other lines run straight on; dot's own placement would put them in those lines' way.
  // With annexes on several tables that costs more than it wins, and dot's own placement is weighed too.
  const annexed = new Set(graph.edges.filter((e) => e.annex).map((e) => e.from.node)).size;
  const offered = VARIANTS.filter(([, v]) => (annexed === 1 ? !!(v.annex || v.stack) : annexed > 1 || !(v.annex || v.stack)));
  const ways: [string, DotVariant][] = tuning.dot ? [[VARIANTS.find(([, v]) => v === tuning.dot)?.[0] ?? 'custom', tuning.dot]] : big ? offered.slice(0, 1) : offered;
  // A big diagram with a drawing before it is drawn the way that one was (packed or not, straightened
  // or not) and no other: every candidate is routed in full, which is most of the time a layout takes,
  // and next to the previous drawing kept as it was the other three rarely win.
  const was = big ? parseKey(prev?.variant) : undefined;
  if (was && was.direction === graph.direction) tuning = { ...tuning, compact: tuning.compact ?? was.compact, align: tuning.align ?? was.align, mirror: tuning.mirror ?? was.mirror };
  let best: Choice | undefined;
  // A contract stacked under its product makes a tall column: where that leaves the text too small for
  // a slide and another way does not, the other way wins whatever its score.
  const target = tuning.aspect === 'auto' ? undefined : (tuning.aspect ?? SLIDE);
  const fits = (c: Choice) => annexed !== 1 || target == null || pageScale(c.placed, c.sized.graph, target) >= slideScale(c.sized);
  for (const [name, variant] of ways) {
    const c = await candidates(sized, spacing, tuning, name, variant, prev);
    // A way that cannot be drawn so (an annex with no room under its table) is no candidate.
    if (!c) continue;
    if (!best || (fits(c) !== fits(best) ? fits(c) : c.cost < best.cost - 1e-9)) best = c;
  }
  // Every way leaves a label on the cards it joins, longer than the room between their columns (a label
  // made a word longer): each is drawn again with room for labels between the columns (as labelRoom 'fit').
  // Only on a first drawing: with one before it, what stays where it was counts for more.
  if (best && !prev?.nodes?.size && !tuning.labelRoom && graph.direction === 'right' && sized.edgeLabels.size && metricsOf(best).labelOverlaps > 0)
    for (const [name, variant] of ways) {
      const c = await candidates(sized, spacing, { ...tuning, labelRoom: 'fit' }, name, variant, prev);
      if (c && (fits(c) !== fits(best) ? fits(c) : c.cost < best.cost - 1e-9)) best = c;
    }
  // Asked one way only (a drawing before it was stacked) and that way cannot be drawn now: dot's own placement.
  best ??= (await candidates(sized, spacing, { ...tuning, dot: undefined }, 'plain', {}, prev))!;
  if (stay && prev?.nodes?.size) {
    const fresh = best!;
    // The previous drawing with what it remembers held where it was: routed, weighed, and what moving costs.
    const keep = (memory: LayoutMemory): Choice | undefined => {
      const kept = stayPlacement(graph, fresh.p, memory, sized.groupHeader, spacing.groupPad, spacing.nodeGap, sized.groupMinWidth, hold);
      if (!kept) return undefined;
      const placed = normalise({ ...kept, edges: route(sized, kept) });
      const sc = score(metricsOf({ placed, sized }));
      return { p: kept, placed, score: sc, cost: sc + moveCost(kept, prev), key: prev.variant ?? fresh.key, sized, held: true };
    };
    // Staying put never turns a line against the reading direction: a line drawn between two nodes
    // that were placed before it existed (two cards, then the arrow) would otherwise point up or back.
    const forward = (c: Choice) => upstream(graph, c.p, prev) <= upstream(graph, fresh.p, prev);
    const kept = keep(prev);
    // Only when it differs: a fresh placement that is exactly the previous one is not "held".
    if (kept && forward(kept) && (hold || kept.cost < fresh.cost - 1e-9)) best = kept;
    // Everything held costs more than drawing afresh (a new line finds no clean way between the boxes
    // where they stood): held but for one node, which looks for room again, may still read as well
    // and moves one node instead of most. Each node in turn, in a small drawing: each try is routed in full.
    // So too, the diagram changed, where held it crosses lines that drawn afresh it does not; then only
    // a node that looks for room again and takes those crossings away moves.
    const mending = graph.nodes.length >= MEND_FROM && best === kept && changed && metricsOf(kept).crossings > metricsOf(fresh).crossings;
    if (!hold && graph.nodes.length <= REPAIR_LIMIT && (best !== kept || mending))
      for (const id of prev.nodes.keys()) {
        if (!fresh.p.nodes.has(id)) continue;
        const c = keep({ ...prev, nodes: new Map([...prev.nodes].filter(([k]) => k !== id)) });
        if (c && forward(c) && c.cost < best!.cost - 1e-9 && (!mending || metricsOf(c).crossings < metricsOf(kept!).crossings)) best = c;
      }
  }
  return best!;
}

/**
 * Lines whose far end comes before their near end in reading order: back along the flow, or, with
 * both ends in one layer, up (left in a top-down drawing). Only lines between two nodes the previous
 * drawing had, one of them with no other line: that end was placed with nothing to go by, so where it
 * stands says nothing worth keeping.
 */
function upstream(graph: Graph, p: Placement, prev: LayoutMemory): number {
  const down = graph.direction === 'down';
  const degree = new Map<string, number>();
  for (const e of graph.edges) for (const id of [e.from.node, e.to.node]) degree.set(id, (degree.get(id) ?? 0) + 1);
  let n = 0;
  for (const e of graph.edges) {
    if (degree.get(e.from.node)! > 1 && degree.get(e.to.node)! > 1) continue;
    if (!prev.nodes?.has(e.from.node) || !prev.nodes.has(e.to.node)) continue;
    const a = p.nodes.get(e.from.node);
    const b = p.nodes.get(e.to.node);
    if (e.loose || !a || !b || e.from.node === e.to.node) continue;
    const [along, across] = down ? (['y', 'x'] as const) : (['x', 'y'] as const);
    const size = down ? 'height' : 'width';
    const before = b[along] + b[size] <= a[along];
    const level = b[along] < a[along] + a[size] && a[along] < b[along] + b[size];
    if (before || (level && b[across] < a[across] - 1)) n++;
  }
  return n;
}

function moveCost(p: Placement, prev: LayoutMemory | undefined): number {
  const share = movedShare(p.nodes, prev?.nodes);
  return share > 0 ? MOVE_BASE + MOVE_EACH * share : 0;
}

/** The best drawing from one way of asking dot: as placed or in a mirror, compacted or not, straightened or not. */
async function candidates(sized: Sized, spacing: Spacing, tuning: Tuning, name: string, variant: DotVariant, prev: LayoutMemory | undefined): Promise<Choice | undefined> {
  const { graph } = sized;
  // Room for labels between columns; lines between table rows end in crow's feet on both sides.
  const rows = graph.edges.some((e) => e.from.row || e.to.row);
  const widest = Math.max(0, ...[...sized.edgeLabels.values()].map((l) => l.width));
  const room = tuning.labelRoom === 'fit' && graph.direction === 'right' ? Math.max(24, Math.min(240, widest + 48 - spacing.layerGap)) : 24;
  const fit = tuning.labelRoom === 'fit' && graph.direction === 'right' && sized.edgeLabels.size > 0;
  const placed = await placeWithDot(sized, spacing, (sized.edgeLabels.size ? room : 0) + (rows ? 48 : 0), variant);
  const stacked = variant.stack ? stackAnnexes(placed, sized, spacing.groupPad, spacing.nodeGap) : undefined;
  if (variant.stack && !stacked) return undefined;
  const dot = variant.annex ? liftAnnexes(placed, sized, spacing.groupPad, spacing.nodeGap) : (stacked ?? placed);
  // Seen in a mirror a placement can have its groups in the order they are written. Which of the two
  // draws better only shows when drawn, so a small diagram draws both; a big one takes the mirror.
  const turned = tuning.mirror === false ? undefined : inOrder(dot, graph, sized.groupHeader - spacing.groupPad);
  const sides: [boolean, Placement][] = !turned ? [[false, dot]] : tuning.mirror || graph.nodes.length > VARIANT_LIMIT ? [[true, turned]] : [[false, dot], [true, turned]];
  let best: Choice | undefined;
  for (const [mirror, asked] of sides) {
    const c = drawings(sized, spacing, tuning, `${graph.direction}/${name}/`, mirror, asked, fit, prev);
    if (!best || c.cost < best.cost - 1e-9) best = c;
  }
  return best!;
}

/** Drawings finished per set of sizes (one direction of one layout), by their boxes (boxesKey). */
const finished = new WeakMap<Sized, Map<string, { placed: Placed; p: Placement }>>();

/** Where every box is, as one string: two placements with the same key are the same drawing. */
function boxesKey(p: Pick<Placement, 'nodes' | 'groups'>): string {
  let out = '';
  for (const [id, b] of p.nodes) out += `${id}@${b.x},${b.y},${b.width},${b.height};`;
  for (const [id, b] of p.groups) out += `#${id}@${b.x},${b.y},${b.width},${b.height};`;
  return out;
}

/** The best drawing of one placement: compacted or not, straightened or not. */
function drawings(sized: Sized, spacing: Spacing, tuning: Tuning, name: string, mirror: boolean, asked: Placement, fit: boolean, prev: LayoutMemory | undefined): Choice {
  const { graph } = sized;
  // dot's gap is one size for all layers, the widest label's: each gap is closed to what its own lines need.
  const squeezed = fit && tuning.squeeze !== false;
  const placed = squeezed ? squeeze(asked, sized, spacing) : asked;
  const finish = (q: Placement, straighten: boolean) => {
    const straightened = straighten ? alignPorts(q, graph, sized.nodes, sized.groupHeader, spacing.groupPad) : q;
    const tidied = tuning.tidy === false ? straightened : tidy(straightened, graph, sized.groupHeader, spacing.groupPad, spacing.nodeGap, sized.groupMinWidth);
    const opened = graph.direction === 'down' && tuning.tidy !== false ? chimneys(tidied, sized) : tidied;
    const start = tuning.tidy === false ? opened : alignLoners(evenGroups(opened, graph, spacing.groupPad), graph, spacing.layerGap);
    // Ways of asking dot, mirrors, packing and straightening often come to the very same boxes:
    // those are routed once (routing is most of what a layout costs).
    const sig = boxesKey(start);
    const done = finished.get(sized)?.get(sig);
    if (done) return done;
    const { p, edges } = clearBorders(sized, { p: start, edges: route(sized, start) });
    const result = { placed: normalise({ ...p, edges }), p };
    if (!finished.has(sized)) finished.set(sized, new Map());
    finished.get(sized)!.set(sig, result);
    return result;
  };
  // Each helps some diagrams and hurts others, so all are drawn and the best one is kept.
  const packed = (q = placed) => compact(q, graph, sized.groupHeader, spacing.groupPad, spacing.nodeGap, sized.groupMinWidth);
  const bases: [boolean, Placement][] = tuning.compact === false ? [[false, placed]] : tuning.compact ? [[true, packed()]] : [[false, placed], [true, packed()]];
  const aligns = tuning.align === false ? [false] : tuning.align ? [true] : [false, true];
  let best: Choice | undefined;
  for (const [c, base] of bases)
    for (const a of aligns) {
      let drawn = finish(base, a);
      const key = `${name}${c ? 'c' : ''}${a ? 'a' : ''}${mirror ? 'm' : ''}${c || a || mirror ? '' : '-'}`;
      let m = metricsOf({ placed: drawn.placed, sized });
      // Closing the gaps can leave two labels of one fan without room beside each other: then the
      // same drawing with dot's own gaps is the better one.
      if (squeezed && m.labelOverlaps > 0) {
        const wide = finish(c ? packed(asked) : asked, a);
        const wm = metricsOf({ placed: wide.placed, sized });
        if (score(wm) < score(m)) [drawn, m] = [wide, wm];
      }
      const sc = score(m);
      // Close to the previous drawing counts; with only its variant known, being that variant does
      // (in a mirror or not: that follows the order in the source, which may have changed).
      const way = (k: string) => k.replace(/w\d.*$/, '').replace(/m?-?$/, '');
      const cost = sc + (prev?.nodes?.size ? moveCost(drawn.p, prev) : prev?.variant && way(prev.variant) !== way(key) ? SWITCH : 0);
      if (!best || cost < best.cost - 1e-9) best = { ...drawn, score: sc, cost, key, sized };
    }
  return best!;
}

/**
 * dot has no word for which of two groups comes first, and asked in reverse it hands them back in
 * reverse. A placement is as good seen in a mirror (across the flow): this is the mirror image,
 * when that has more groups in the order they are written.
 */
function inOrder(p: Placement, graph: Graph, head: number): Placement | undefined {
  const down = graph.direction === 'down';
  // Upside down a group has its header at the bottom: what it holds moves down by what the header
  // is taller than the padding, once for each group around it.
  const parent = new Map<string, string | undefined>([...graph.groups, ...graph.nodes].map((x) => [x.id, x.parent]));
  const depth = (id: string | undefined): number => (parent.get(id!) ? 1 + depth(parent.get(id!)) : 0);
  const flip = (id: string, b: Box): Box => (down ? { ...b, x: p.width - b.x - b.width } : { ...b, y: p.height - b.y - b.height + head * depth(id) });
  const turn = (m: Map<string, Box>) => new Map([...m].map(([id, b]) => [id, flip(id, b)]));
  const groups = turn(p.groups);
  return disorder(graph, groups) < disorder(graph, p.groups) ? { ...p, nodes: turn(p.nodes), groups } : undefined;
}

/** Above this many nodes dot is asked once: the other variants would cost more time than they win. */
const VARIANT_LIMIT = 60;

function route(sized: Sized, p: Placement, via?: Map<string, Point[]>): Map<string, PlacedEdge> {
  const { graph } = sized;
  const groupParent = new Map(graph.groups.map((g) => [g.id, g.parent]));
  const nodeParent = new Map(graph.nodes.map((n) => [n.id, n.parent]));
  const end = (ep: Endpoint, marker: Marker): RouteEnd | undefined => {
    const box = p.nodes.get(ep.node) ?? p.groups.get(ep.node);
    if (!box) return undefined;
    const rowY = ep.row ? sized.nodes.get(ep.node)?.rowY?.[ep.row] : undefined;
    return { node: ep.node, box, rowY, stub: stubFor(marker), within: groupParent.get(ep.node) ?? nodeParent.get(ep.node), mark: marker };
  };
  // The groups around each end, all the way up: a line is at home in those and a stranger in the rest.
  const home = (...ends: string[]) => {
    const out = new Set<string>();
    for (const id of ends) for (let g = groupParent.has(id) ? id : nodeParent.get(id); g && !out.has(g); g = groupParent.get(g)) out.add(g);
    return [...out].sort();
  };
  const edges: RouteRequest[] = [];
  const clear = clearAnnexLines(sized, p);
  for (const e of graph.edges) {
    const from = end(e.from, e.start);
    const to = end(e.to, e.end);
    // Dotted lines (lookups, management) and the lines up to an annex that stands clear (annex.ts) route last, so the main flow gets the best paths.
    // Only plain lines share a trunk (see plainLine): what is written on a shared trunk could belong to either line.
    const style = plainLine(e) ? `${e.line}|${e.tone ?? ''}|${e.start}|${e.end}|${e.width ?? 1}` : undefined;
    if (from && to) edges.push({ id: e.id, from, to, label: sized.edgeLabels.get(e.id), order: e.line === 'dotted' || clear.has(e.id) ? 1 : 0, style, via: via?.get(e.id), home: home(e.from.node, e.to.node) });
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
  /** The line whose label it was. */
  edge?: string;
}

/** The first label lying on a group's border or header, as the space to open before that border: the cheapest cut across and the cheapest down, cheapest first. */
function labelOnBorder(p: Placement, edges: Map<string, PlacedEdge>, header: number): Cut[] {
  for (const [id, e] of edges) {
    const found = e.label ? borderCuts(p, e.label, header) : [];
    if (found.length) return found.map((c) => ({ ...c, edge: id }));
  }
  return [];
}

/** Where one label lies on a group's border or header: the cheapest cut across and the cheapest down, cheapest first. */
function borderCuts(p: Placement, l: Box, header: number): Cut[] {
  const t = 4;
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
  return [cuts.x, cuts.y].filter((c): c is Cut => !!c).sort((a, b) => a.by - b.by);
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
