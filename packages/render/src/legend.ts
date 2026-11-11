// The legend: a plain row of samples, a column beside the drawing, or the KEY of a map sheet (a
// rule across, the word KEY, then the samples, wrapped to the page). A sample of a kind of element
// is that kind's own icon in the theme's tile style, so it also reads without colour.
import type { Graph, LegendItem } from '@cartography/core';
import { baselineOffset, chipText, groupLine, look, measureText, paperTint, type Theme, type ToneColors } from '@cartography/theme';
import { chipBack, dashAttr, endMarker, esc, glyph, iconTile, monoAttr, patternOver, patternWidth, r1, tagRadius } from './paint.ts';
import { drawTags, endStyle, tagsWidth } from './tags.ts';
import { blockSample } from './block.ts';
import { drawMarks } from './flow.ts';
import { messageSample } from './sequence.ts';
import { tr } from '@cartography/i18n/drawing';

/** Sample, gap, label, then the gap to the next item. */
const SAMPLE = 28;
const GAP = 24;
const ROW = 22;
/** Room for the KEY heading in front of the first row. */
const KEY = 44;
/** A legend never forces the page wider than this by itself; past it the rows wrap. */
const WRAP = 640;
const COLUMN_ROW = 26;

/** A tag sample wider than the usual sample (OHS, ACL) pushes its label along. */
export const sampleExtra = (item: LegendItem) => (item.swatch === 'mark' ? Math.max(0, tagsWidth([item.tag ?? 'T1']) + 8 - SAMPLE) : (item.end && item.end !== 'none') || item.swatch === 'message' ? 10 : 0);
const labelWidth = (item: LegendItem, theme: Theme) => sampleExtra(item) + measureText(item.label, theme.size.caption, 500);

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

/** The room the KEY heading takes before the first sample: more for a longer word (LEGENDA). */
export const keyHead = (theme: Pick<Theme, 'lang'>) => Math.max(KEY, Math.ceil(measureText(tr(theme.lang, 'KEY'), 9.5, 600, 'sans', 1.2)) + 14);

/** Row pitch of a wrapped KEY, and the room its heading takes (in English; see keyHead). */
export const LEGEND = { ROW, KEY } as const;

/**
 * The samples of a KEY wrapped into rows. `room` is the width the page has anyway; `after` is what
 * else wants to end the last row (the imprint). Continuation rows start under the first sample,
 * not under the heading.
 */
export function keyLayout(items: LegendItem[], theme: Theme, room: number, after = 0) {
  const head = items.length ? keyHead(theme) : 0;
  const widths = items.map((item) => SAMPLE + labelWidth(item, theme));
  const natural = head + widths.reduce((a, w) => a + w + GAP, 0) - (items.length ? GAP : 0);
  const limit = Math.max(room, Math.min(natural + (after ? after + 32 : 0), WRAP), head + Math.max(0, ...widths), after);
  const wrapAt = (at: number) => {
    const rows: { item: LegendItem; x: number }[][] = [[]];
    let x = head;
    for (const [i, item] of items.entries()) {
      if (x > head && x + widths[i]! > at) {
        rows.push([]);
        x = head;
      }
      rows.at(-1)!.push({ item, x });
      x += widths[i]! + GAP;
    }
    return rows;
  };
  let rows = wrapAt(limit);
  // Wrapped, the rows come out even: the narrowest wrap with as many rows, so no sample is left alone on the last.
  if (rows.length > 1)
    for (let at = limit - 8; at >= head + Math.max(0, ...widths); at -= 8) {
      const fewer = wrapAt(at);
      if (fewer.length > rows.length) break;
      rows = fewer;
    }
  const ends = rows.map((r) => (r.length ? r.at(-1)!.x + SAMPLE + labelWidth(r.at(-1)!.item, theme) : 0));
  return { rows, ends, limit };
}

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
    `<text x="${r1(x)}" y="${r1(cy + baselineOffset(IMPRINT.size, 'mono'))}" font-size="${IMPRINT.size}" font-weight="500" letter-spacing="${IMPRINT.tracking}" fill="${theme.textFaint}" text-anchor="end"${monoAttr(theme)} data-aside="">${esc(imprint ?? '')}</text>`;
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
  const iw = imprint ? imprintWidth(imprint) : 0;
  const { rows, ends, limit } = keyLayout(items, theme, room, iw);
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
    if (items.length) s += `<text x="${r1(x0)}" y="${r1(first + baselineOffset(9.5))}" font-size="9.5" font-weight="600" letter-spacing="1.2" fill="${theme.textFaint}" data-aside="">${tr(theme.lang, 'KEY')}</text>`;
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
  const key = look(theme).legend === 'key';
  const heading = tr(theme.lang, key ? 'KEY' : 'LEGEND');
  const draw = (x: number, y: number) => {
    let s = `<text x="${r1(x)}" y="${r1(y + 10)}" font-size="10" font-weight="600" letter-spacing="${key ? 1.2 : 0.8}" fill="${theme.textFaint}">${heading}</text>`;
    for (const [i, item] of items.entries()) s += legendItem(item, theme, x, y + 36 + i * COLUMN_ROW);
    return s;
  };
  return { width, height: items.length * COLUMN_ROW + 32, draw };
}

/** Legend sample of a badge: the chip as on the cards, with the icon its chips carry (an arrow when they have none). */
function chipSwatch(x: number, cy: number, tone: ToneColors, theme: Theme, icon?: string): string {
  const box = chipBack(theme, x, cy - 8, 20, 16, tone);
  const mark = glyph(icon, x + 4, cy - 6, 12, tone.fg, 1.6);
  if (mark) return box + mark;
  return box + `<path d="M${x + 6} ${cy}h8m-3-3l3 3-3 3" fill="none" stroke="${tone.fg}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** One legend sample and its label, starting at x0. */
export function legendItem(item: LegendItem, theme: Theme, x0: number, cy: number): string {
  const lk = look(theme);
  const color = item.tone ? theme.tones[item.tone].fg : theme.edge;
  const label = `<text x="${r1(x0 + SAMPLE + sampleExtra(item))}" y="${r1(cy + baselineOffset(theme.size.caption))}" font-size="${theme.size.caption}" font-weight="500" fill="${theme.textMuted}">${esc(item.label)}</text>`;
  if (item.swatch === 'badge') return chipSwatch(x0, cy, theme.tones[item.tone ?? 'slate'], theme, item.icon) + label;
  if (item.swatch === 'block' && item.block) return drawMarks(blockSample(item.block.form, theme, x0, cy, item.block.heat), theme, '') + label;
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
  if (item.swatch === 'message') return messageSample(item.arrow ?? 'sync', x0, cy, theme) + label;
  if (item.swatch === 'glyph') return glyph(item.icon, x0 + 3, cy - 7, 14, theme.tones[item.tone ?? 'slate'].fg, 1.75) + label;
  if (item.swatch === 'focus') {
    // What a focus is about: a card with the ring it gets in the drawing.
    const ring = theme.accent ?? theme.tones.blue.fg;
    return `<rect x="${x0 - 1.5}" y="${cy - 9}" width="23" height="18" rx="6" fill="none" stroke="${ring}" stroke-opacity="0.25" stroke-width="4"/><rect x="${x0 - 1.5}" y="${cy - 9}" width="23" height="18" rx="6" fill="none" stroke="${ring}" stroke-width="1.6"/><rect x="${x0 + 1.5}" y="${cy - 6}" width="17" height="12" rx="3.5" fill="${theme.surface}" stroke="${theme.border}" stroke-width="1"/>` + label;
  }
  if (item.swatch === 'trust') return `<path d="M${x0} ${cy}H${x0 + 20}" stroke="${theme.tones.rose.fg}" stroke-width="1.8" stroke-dasharray="5 3"/>` + label;
  if (item.swatch === 'mark' && item.tag && item.tone) {
    // A matrix value: its letter in a pill of its tone, as in the cells.
    const t = theme.tones[item.tone];
    const w = Math.max(20, measureText(item.tag, chipText(theme), 600) + 12);
    return chipBack(theme, x0, cy - 9, w, 18, t, tagRadius(theme, 18)) + `<text x="${r1(x0 + w / 2)}" y="${r1(cy + baselineOffset(chipText(theme)))}" font-size="${chipText(theme)}" font-weight="600" fill="${t.fg}" text-anchor="middle">${esc(item.tag)}</text>` + label;
  }
  if (item.swatch === 'mark') return drawTags(theme, [item.tag ?? ''], x0, cy, endStyle(item.tag ?? '')) + label;
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
  const width = patternWidth(item.pattern, theme.stroke.edge * (item.width ?? 1) + 0.4);
  const dash = dashAttr(item.line, width, theme);
  if (item.end && item.end !== 'none') {
    // A relationship's end (a crow's foot): a longer line, so the mark sits clear of where it starts.
    const tip = { x: x0 + 30, y: cy };
    return `<path d="M${x0} ${cy}H${tip.x}" stroke="${color}" stroke-width="${r1(theme.stroke.edge)}" stroke-linecap="round"${dashAttr(item.line, theme.stroke.edge, theme)}/>` + endMarker(item.end, tip, { x: x0, y: cy }, color, theme) + label;
  }
  const d = `M${x0} ${cy}H${x0 + 20}`;
  return `<path d="${d}" stroke="${color}" stroke-width="${r1(width)}" stroke-linecap="round"${dash}/>` + patternOver(item.pattern, `M${x0 - 1} ${cy}H${x0 + 22}`, color, width, theme, dash) + label;
}
