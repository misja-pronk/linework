// Where a drawing goes on one of its slides, and how large: the room a slide has (ours, or a
// template's), the rows its title, subtitle or a step's caption take, and the scale that fits the
// drawing into what is left. The deck draws with it; carto validate, the editor's page frame and the
// PDF on a slide page measure with it, so they say what PowerPoint shows. Nothing here draws.
import type { Graph, LegendItem, Placed, StepState } from '@cartography/core';
import { keyLayout, LEGEND, legendItems, legendWidth, noteMargins, wrap, type StepView } from '@cartography/render';
import { inThemeFonts, look, type Theme } from '@cartography/theme';
import { pages } from './steps.ts';
import type { Drawing } from './pptx.ts';

/** EMU per CSS pixel at 96 dpi. */
export const PX = 9525;
export const INCH = 914400;
/**
 * Our own slide's margins (EMU): modest at the sides, a little less above and below, where the
 * title row and the drawing's own white space already keep things off the edge.
 */
export const MARGIN = { side: Math.round(0.32 * INCH), top: Math.round(0.25 * INCH), bottom: Math.round(0.24 * INCH) };
/**
 * The rows over the drawing (inches): the title (24 pt), the subtitle or a step's caption line (13 to
 * 15 pt, the same row so a one-line caption costs the drawing nothing), and the gap under them.
 */
export const ROWS = { title: 0.38, line: 0.26, gap: 0.06 };
/** Largest scale for small drawings: a 13.5 px label becomes ~16 pt and no bigger. */
export const MAX_K = 1.6 * PX;
/** A step's caption on a slide: sizes in points, `px` the caption size for wrapping. */
export const CAPTION = { title: 15, text: 14, px: (14 * 12700) / PX };
/**
 * A step's caption beside the drawing instead (inches): where a drawing is too tall for what the
 * slide leaves under its title, the width it leaves free holds the words and the drawing keeps the full height.
 */
const COLUMN = { min: 2.6, max: 3.6, gap: 0.35 };

/** A step's title and caption as one paragraph, the title in bold. */
export const words = (s: StepState) => [s.title, s.caption].filter(Boolean).join('  ');
/** Lines a step's paragraph takes at this width (in drawing px); the bold title is a little wider than measured. */
export const lines = (s: StepState, width: number) => (words(s) ? wrap(words(s), CAPTION.px, 400, width * 0.95).length : 0);

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The slide a drawing goes on: its size and the room it gives (EMU), and what a template's layout holds for it. */
export interface SlideRoom {
  W: number;
  H: number;
  /** Where the title, subtitle, caption and drawing go. */
  room: Rect;
  /** In a template: its spacing, and a drawing that starts under the title instead of centred. */
  template?: boolean;
  /** The template's layout has a title placeholder: the title goes there, not in the room. */
  titlePlaceholder?: boolean;
  /** The template's layout has a text placeholder besides the content: the caption (or subtitle) goes there. */
  captionPlaceholder?: boolean;
}

/** One of our own slides, 16:9 (13.33 by 7.5 inches) unless said. */
export function ownRoom(aspect: '16:9' | '4:3' = '16:9'): SlideRoom {
  const W = aspect === '4:3' ? 9144000 : 12192000;
  const H = 6858000;
  return { W, H, room: { x: MARGIN.side, y: MARGIN.top, w: W - 2 * MARGIN.side, h: H - MARGIN.top - MARGIN.bottom } };
}

/** The legend under the drawing: one row of samples, or the KEY of a paper look, wrapped to the drawing's width. */
export function legendLayout(graph: Graph, placed: Placed, theme: Theme) {
  const items = graph.legend ?? [];
  if (!items.length) return { key: false, rows: [] as { item: LegendItem; x: number }[][], width: 0, height: 0 };
  if (look(theme).legend !== 'key') return { key: false, rows: [legendItems(graph, theme).map(({ item, x }) => ({ item, x }))], width: legendWidth(graph, theme), height: 40 };
  const lay = keyLayout(items, theme, placed.width);
  return { key: true, rows: lay.rows, width: Math.max(...lay.ends), height: 54 + (lay.rows.length - 1) * LEGEND.ROW };
}

/** Content size in layout px: the drawing plus the legend under it, and the room callouts of any step need around it (left, top: where the drawing starts). */
export function contentSize(graph: Graph, placed: Placed, theme: Theme, view?: StepView) {
  const legend = legendLayout(graph, placed, theme);
  const room = view ? noteMargins(view, placed) : { left: 0, top: 0, right: 0, bottom: 0 };
  return { width: Math.max(placed.width + room.left + room.right, legend.width), height: placed.height + room.top + room.bottom + legend.height, left: room.left, top: room.top };
}

/** Where everything goes on one slide of a drawing (EMU), and `k`: EMU per drawing px. */
export interface SlideFit {
  k: number;
  /** What the drawing is fitted into. */
  area: Rect;
  /** The drawing's content box (layout px), as `area` holds it. */
  content: { width: number; height: number; left: number; top: number };
  /** The step's caption column beside the drawing: its left edge, top and width. */
  side?: { x: number; y: number; w: number };
  /** A step is told on this slide (its title and caption on it). */
  told: boolean;
  /** The title is a text box of ours (not the template's placeholder). */
  titled: boolean;
  /** The subtitle stands under the title. */
  subtitled: boolean;
  /** The step's caption stands under the title (not beside the drawing, not in a placeholder). */
  header: boolean;
  /** Where the row under the title starts. */
  titleTop: number;
  /** Where the room under the step's caption starts. */
  capTop: number;
  /** The bottom of the room. */
  bottom: number;
  /** The row under the drawing a template's caption placeholder leaves for the step number. */
  below: number;
}

/**
 * The layout of one slide of a drawing: the title row, then the subtitle or the step's title and
 * caption (as high as the longest of all steps, so the drawing never moves) or those beside the
 * drawing where it is too tall and that keeps it larger; the drawing scaled into what is left,
 * never bigger than MAX_K.
 */
export async function fitSlide(graph: Graph, placed: Placed, theme: Theme, s: SlideRoom, view?: StepView): Promise<SlideFit> {
  const { room } = s;
  const tpl = !!s.template;
  const told = !!view && view.caption !== false;
  const captionPh = !!s.captionPlaceholder;
  const bottom = room.y + room.h;
  const titled = !!graph.title && !s.titlePlaceholder;
  const subtitled = !!graph.subtitle && !(captionPh && !told) && (!!graph.title || tpl);
  /** The room under the title rows starts this far down. */
  const under = (top: number) => (top > room.y ? top + ROWS.gap * INCH : top);
  const titleTop = room.y + (titled ? ROWS.title * INCH : 0);
  const rows = (width: number) => Math.max(1, ...(view?.states ?? []).map((st) => lines(st, width)));
  const capTop = under(titleTop + ROWS.line * INCH * rows(room.w / PX - (titled ? 0 : 80)));
  const subTop = under(titleTop + (subtitled ? ROWS.line * INCH : 0));
  // With a caption placeholder only the step number needs a row of its own, under the drawing.
  const below = told && captionPh ? Math.round(ROWS.line * INCH) : 0;
  const c = await inThemeFonts(theme, () => contentSize(graph, placed, theme, view));
  const fit = (w: number, h: number) => Math.min(w / Math.max(1, c.width), h / Math.max(1, c.height), MAX_K);
  let area = { x: room.x, y: told && !captionPh ? capTop : subTop, w: room.w, h: 0 };
  area.h = bottom - area.y - below;
  let k = fit(area.w, area.h);
  let side: SlideFit['side'];
  if (told && !captionPh) {
    const h = bottom - subTop;
    const gap = COLUMN.gap * INCH;
    // As wide as the drawing at full height leaves free, within bounds that keep the lines readable.
    const w = Math.min(COLUMN.max * INCH, Math.max(COLUMN.min * INCH, room.w - c.width * fit(room.w, h) - gap));
    const besideK = fit(room.w - w - gap, h);
    // The column holds the longest caption of all steps, its title on a line of its own, with the step number under it.
    const fits = (0.18 + ROWS.line * (rows(w / PX) + 2)) * INCH <= h;
    if (fits && besideK > k * 1.01) {
      k = besideK;
      const used = c.width * k + gap + w;
      area = { x: room.x + (room.w - used) / 2, y: subTop, w: c.width * k, h };
      side = { x: area.x + area.w + gap, y: tpl ? area.y : area.y + (area.h - c.height * k) / 2, w };
    }
  }
  return { k, area, content: c, ...(side ? { side } : {}), told, titled, subtitled, header: told && !captionPh && !side, titleTop, capTop, bottom, below };
}

/** Lines a step's title and caption take under the title of one of our own slides (16:9 unless said). */
export function stepCaptionLines(s: StepState, aspect: '16:9' | '4:3' = '16:9'): number {
  return lines(s, ownRoom(aspect).room.w / PX);
}

/**
 * How large a drawing comes out on its slide in a deck of our own (16:9 unless said): points per
 * drawing px of its plain slide (the whole drawing, no step told), as the deck draws it. Its smallest
 * text px times this is what PowerPoint shows.
 */
export async function slideScale(d: Pick<Drawing, 'graph' | 'placed' | 'steps' | 'stepsImplied' | 'faded'>, theme: Theme, aspect: '16:9' | '4:3' = '16:9'): Promise<number | undefined> {
  if (!d.graph || !d.placed) return undefined;
  const page = pages([d], false)[0];
  const f = await fitSlide(d.graph, d.placed, theme, ownRoom(aspect), page?.view);
  return f.k / 12700;
}
