// The legend: a plain row of samples, a column beside the drawing, or the KEY of a map sheet (a
// rule across, the word KEY, then the samples, wrapped to the page). A sample of a kind of element
// is that kind's own icon in the theme's tile style, so it also reads without colour.
import type { Graph, LegendItem } from '@cartography/core';
import { baselineOffset, groupLine, look, measureText, paperTint, type Theme, type ToneColors } from '@cartography/theme';
import { dashAttr, esc, glyph, iconTile, monoAttr, r1 } from './paint.ts';

/** Sample, gap, label, then the gap to the next item. */
const SAMPLE = 28;
const GAP = 24;
const ROW = 22;
/** Room for the KEY heading in front of the first row. */
const KEY = 44;
/** A legend never forces the page wider than this by itself; past it the rows wrap. */
const WRAP = 640;
const COLUMN_ROW = 26;

const labelWidth = (item: LegendItem, theme: Theme) => measureText(item.label, theme.size.caption, 500);

/** Positions of the items in one unwrapped row (the classic legend). */
export function legendItems(g: Pick<Graph, 'legend'>, theme: Theme) {
  let x = 0;
  return (g.legend ?? []).map((item) => {
    const at = x;
    x += SAMPLE + labelWidth(item, theme) + GAP;
    return { item, x: at, end: x - GAP };
  });
}

export function legendWidth(g: Pick<Graph, 'legend'>, theme: Theme): number {
  return legendItems(g, theme).at(-1)?.end ?? 0;
}

export interface LegendBlock {
  /** Width the page must at least give it. */
  width: number;
  height: number;
  /** Drawn with its top-left at x, y, across `width` (the page between its paddings). */
  draw(x: number, y: number, width: number): string;
}

const NONE: LegendBlock = { width: 0, height: 0, draw: () => '' };

/** The one line of the imprint: the title block's fields as the author gave them, never an invented date. */
export function imprintOf(theme: Theme): string | undefined {
  const b = theme.titleBlock;
  if (!b?.imprint) return undefined;
  const parts = [b.client, b.project, b.version, b.date, b.classification].filter(Boolean);
  return parts.length ? parts.join('  ·  ').toUpperCase() : undefined;
}

const IMPRINT = { size: 9, tracking: 0.6 };
const imprintWidth = (s: string) => measureText(s, IMPRINT.size, 500, 'mono', IMPRINT.tracking);

/**
 * The legend above or below the drawing. `room` is the width the page has anyway (drawing, title),
 * so the KEY wraps to it instead of widening the page.
 */
export function legendBlock(items: LegendItem[], theme: Theme, where: 'top' | 'bottom', room: number): LegendBlock {
  const imprint = where === 'bottom' ? imprintOf(theme) : undefined;
  if (!items.length && !imprint) return NONE;
  const mark = (x: number, cy: number) =>
    `<text x="${r1(x)}" y="${r1(cy + baselineOffset(IMPRINT.size, 'mono'))}" font-size="${IMPRINT.size}" font-weight="500" letter-spacing="${IMPRINT.tracking}" fill="${theme.textFaint}" text-anchor="end"${monoAttr(theme)}>${esc(imprint ?? '')}</text>`;
  if (look(theme).legend !== 'key') {
    const placed = legendItems({ legend: items }, theme);
    const row = legendWidth({ legend: items }, theme);
    // The row sits 6 px under the header, or 14 px above the bottom padding; an imprint ends it on the right.
    const cy = where === 'top' ? 6 : 26;
    return {
      width: row + (imprint ? (row ? 32 : 0) + imprintWidth(imprint) : 0),
      height: 40,
      draw: (x, y, total) => placed.map((p) => legendItem(p.item, theme, x + p.x, y + cy)).join('') + (imprint ? mark(x + total, y + cy) : ''),
    };
  }
  const head = items.length ? KEY : 0;
  const widths = items.map((item) => SAMPLE + labelWidth(item, theme));
  const natural = head + widths.reduce((a, w) => a + w + GAP, 0) - (items.length ? GAP : 0);
  const iw = imprint ? imprintWidth(imprint) : 0;
  const limit = Math.max(room, Math.min(natural + (iw ? iw + 32 : 0), WRAP), head + Math.max(0, ...widths), iw);
  // Wrap the samples into rows; continuation rows start under the first sample, not under the heading.
  const rows: { item: LegendItem; x: number }[][] = [[]];
  let x = head;
  for (const [i, item] of items.entries()) {
    if (x > head && x + widths[i]! > limit) {
      rows.push([]);
      x = head;
    }
    rows.at(-1)!.push({ item, x });
    x += widths[i]! + GAP;
  }
  const ends = rows.map((r) => (r.length ? r.at(-1)!.x + SAMPLE + labelWidth(r.at(-1)!.item, theme) : 0));
  // The imprint ends the last row when there is room beside the samples, else it takes a row of its own.
  const beside = !iw || ends.at(-1)! + (ends.at(-1)! ? 32 : 0) + iw <= limit;
  const count = rows.length + (beside ? 0 : 1);
  const width = Math.max(...ends, beside ? ends.at(-1)! + (iw ? (ends.at(-1)! ? 32 : 0) + iw : 0) : iw);
  // Bottom: 16 px of air, the rule, the rows. Top: the rows, the rule, 16 px of air.
  const height = (where === 'bottom' ? 54 : 44) + (count - 1) * ROW;
  const draw = (x0: number, y0: number, total: number) => {
    const first = where === 'bottom' ? y0 + 40 : y0 + 8;
    const rule = where === 'bottom' ? y0 + 16 : y0 + 8 + (count - 1) * ROW + 20;
    let s = `<rect x="${r1(x0)}" y="${r1(rule)}" width="${r1(total)}" height="1" fill="${theme.border}"/>`;
    if (items.length) s += `<text x="${r1(x0)}" y="${r1(first + baselineOffset(9.5))}" font-size="9.5" font-weight="600" letter-spacing="1.2" fill="${theme.textFaint}">KEY</text>`;
    for (const [i, row] of rows.entries()) for (const p of row) s += legendItem(p.item, theme, x0 + p.x, first + i * ROW);
    if (imprint) s += mark(x0 + total, first + (count - 1) * ROW);
    return s;
  };
  return { width, height, draw };
}

/** The legend as a column beside the drawing, under a small heading. */
export function legendColumn(g: Graph, theme: Theme) {
  const items = g.legend ?? [];
  const width = Math.max(0, ...items.map((item) => SAMPLE + labelWidth(item, theme)));
  const heading = look(theme).legend === 'key' ? 'KEY' : 'LEGEND';
  const draw = (x: number, y: number) => {
    let s = `<text x="${r1(x)}" y="${r1(y + 10)}" font-size="10" font-weight="600" letter-spacing="${heading === 'KEY' ? 1.2 : 0.8}" fill="${theme.textFaint}">${heading}</text>`;
    for (const [i, item] of items.entries()) s += legendItem(item, theme, x, y + 36 + i * COLUMN_ROW);
    return s;
  };
  return { width, height: items.length * COLUMN_ROW + 32, draw };
}

/** Legend sample of a badge: a small chip with an arrow, in the style's colour. */
function chipSwatch(x: number, cy: number, tone: ToneColors, theme: Theme): string {
  const box =
    look(theme).chip === 'outline'
      ? `<rect x="${x + 0.5}" y="${cy - 6.5}" width="19" height="13" rx="${Math.min(4, theme.radius.chip)}" fill="${theme.surface}" stroke="${tone.fg}" stroke-opacity="0.55"/>`
      : `<rect x="${x}" y="${cy - 7}" width="20" height="14" rx="${Math.min(4, theme.radius.chip)}" fill="${tone.bg}"/>`;
  return box + `<path d="M${x + 6} ${cy}h8m-3-3l3 3-3 3" fill="none" stroke="${tone.fg}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** One legend sample and its label, starting at x0. */
export function legendItem(item: LegendItem, theme: Theme, x0: number, cy: number): string {
  const lk = look(theme);
  const color = item.tone ? theme.tones[item.tone].fg : theme.edge;
  const label = `<text x="${r1(x0 + SAMPLE)}" y="${r1(cy + baselineOffset(theme.size.caption))}" font-size="${theme.size.caption}" font-weight="500" fill="${theme.textMuted}">${esc(item.label)}</text>`;
  if (item.swatch === 'badge') return chipSwatch(x0, cy, theme.tones[item.tone ?? 'slate'], theme) + label;
  if ((item.swatch === 'tile' || item.swatch === 'fill') && item.icon && lk.legend === 'key') {
    // A kind of element: its own icon, treated as on the cards. Shape tells the kinds apart, colour only helps.
    const t = theme.tones[item.tone ?? 'slate'];
    return iconTile(theme, { x: x0, y: cy - 10, slot: 20, tone: t, icon: item.icon, muted: item.muted, rx: Math.min(5.5, theme.radius.tile), iconSize: lk.tile === 'bare' ? 16 : lk.tile === 'disc' || lk.tile === 'ring' ? 11 : 13 }) + label;
  }
  if (item.swatch === 'tile') {
    // A small icon tile, as on the cards: what a kind of element looks like.
    const t = theme.tones[item.tone ?? 'slate'];
    const fill = item.muted ? theme.tones.slate.bg : t.bg;
    const edge = item.muted ? ` stroke="${theme.tones.slate.line}" stroke-width="1"` : '';
    return `<rect x="${x0 + 0.5}" y="${cy - 9.5}" width="19" height="19" rx="5.5" fill="${fill}"${edge}/>` + glyph(item.icon, x0 + 3.5, cy - 6.5, 13, t.fg, 1.6) + label;
  }
  if (item.swatch === 'boundary') {
    // A boundary is a group: on a paper look its sample is the tint inside the contour.
    const paper = paperTint(theme, 0);
    if (paper) return `<rect x="${x0 + 0.5}" y="${cy - 7.5}" width="19" height="15" rx="${Math.min(4, theme.radius.group)}" fill="${paper}" stroke="${groupLine(theme, theme.tones.slate) ?? theme.textFaint}" stroke-width="1.2" stroke-dasharray="${lk.group.dash}"/>` + label;
    return `<rect x="${x0 + 0.5}" y="${cy - 7.5}" width="19" height="15" rx="4" fill="none" stroke="${theme.textFaint}" stroke-width="1.2" stroke-dasharray="3 2.5"/>` + label;
  }
  if (item.swatch === 'fill') return `<rect x="${x0}" y="${cy - 7}" width="20" height="14" rx="${Math.min(7, theme.radius.chip + 3)}" fill="${theme.tones[item.tone ?? 'blue'].bg}"/>` + label;
  if (item.swatch === 'check' || item.swatch === 'check-outline') {
    // The same filled or dashed check circle as the matrix cells.
    const t = theme.tones[item.tone ?? 'blue'];
    const cx = x0 + 10;
    const circle =
      item.swatch === 'check'
        ? `<circle cx="${cx}" cy="${cy}" r="8" fill="${t.fg}"/>`
        : `<circle cx="${cx}" cy="${cy}" r="7.5" fill="none" stroke="${t.fg}" stroke-width="1.2" stroke-dasharray="2.5 2"/>`;
    const tick = `<path d="M${cx - 3.5} ${cy}l2.4 2.4 4.6-4.8" fill="none" stroke="${item.swatch === 'check' ? theme.surface : t.fg}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
    return circle + tick + label;
  }
  if (item.swatch === 'outline')
    return `<rect x="${x0 + 0.5}" y="${cy - 6.5}" width="19" height="13" rx="${Math.min(6.5, theme.radius.chip + 2.5)}" fill="none" stroke="${color}" stroke-opacity="0.7" stroke-dasharray="3 2"/>` + label;
  const width = theme.stroke.edge * (item.width ?? 1) + 0.4;
  return `<path d="M${x0} ${cy}H${x0 + 20}" stroke="${color}" stroke-width="${r1(width)}" stroke-linecap="round"${dashAttr(item.line, width, theme)}/>` + label;
}
