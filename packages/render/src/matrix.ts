// Matrix shape: row headers on the left, column headers on top, a pill or check mark per cell.
// Direct values are filled, inherited ones outlined, so the difference does not rely on colour.
import type { Box, MatrixCell, MatrixShape, Tone } from '@cartography/core';
import { baselineOffset, chipText, fitText, groupLine, look, measureText, paperTint, type Theme } from '@cartography/theme';
import { icon } from '@cartography/icons';
import { chipBack, iconTile, shadowAttr, tagRadius, topBand, esc } from './paint.ts';
import { wrapText } from './size.ts';

/**
 * Matrix metrics, shared with the slide export. ROW_ICON/COL_ICON: room an icon takes before a header
 * label (a tile in rows, a bare icon in columns). BAND: a name over grouped columns; SECTION: a name
 * between grouped rows; LINE: a line of wrapped text; PART_GAP: between the pills of one cell.
 */
export const MATRIX = { PAD: 16, HEAD: 56, PILL_H: 22, PILL_X: 10, NOTE: 10.5, CHECK: 18, ROW_ICON: 30, COL_ICON: 22, BAND: 26, SECTION: 28, LINE: 17, PART_GAP: 4, PART_X: 6 } as const;
const { PAD, HEAD, PILL_H, PILL_X, NOTE, CHECK, ROW_ICON, COL_ICON, BAND, SECTION, LINE, PART_GAP, PART_X } = MATRIX;

export interface MatrixGeometry {
  rowHeader: number;
  columns: number[];
  /** The height of a row that does not wrap. */
  rowHeight: number;
  width: number;
  height: number;
  /** Where the column headers start (under the bands of grouped columns) and the rows start. */
  band: number;
  head: number;
  /** Each row's top and height, from the matrix's top. */
  rows: { y: number; height: number }[];
  /** Names of grouped rows: the band above each group's first row. */
  sections: { label: string; y: number }[];
  /** Names of grouped columns: over which columns they stand. */
  bands: { label: string; x: number; width: number }[];
  /** Wrapped text per cell of a plain table that wraps. */
  lines: (string[] | undefined)[][];
}

/** Runs of the same group in a list of headers: [label, first, count]. */
export function headerGroups(headers: { group?: string }[]): [string, number, number][] {
  const out: [string, number, number][] = [];
  for (const [i, h] of headers.entries()) {
    const last = out.at(-1);
    if (h.group && last && last[0] === h.group && last[1] + last[2] === i) last[2]++;
    else if (h.group) out.push([h.group, i, 1]);
  }
  return out;
}

const partWidth = (text: string, theme: Theme) => measureText(text, chipText(theme), 500) + 2 * PART_X;
/** Width of the small pills of a cell with several values. */
export const partsWidth = (parts: { text: string }[], theme: Theme) => parts.reduce((a, p) => a + partWidth(p.text, theme), 0) + Math.max(0, parts.length - 1) * PART_GAP;

export function matrixGeometry(m: MatrixShape, theme: Theme): MatrixGeometry {
  const label = (h: { label: string; caption?: string; icon?: string }, iconWidth: number) =>
    (h.icon ? iconWidth : 0) + Math.max(measureText(h.label, theme.size.cell, 600), h.caption ? measureText(h.caption, theme.size.caption, 400) : 0);
  const pill = (c: MatrixCell) => (c.parts?.length ? partsWidth(c.parts, theme) : c.check ? CHECK : c.text ? measureText(c.text, chipText(theme), 500) + 2 * PILL_X : 0);
  const cellWidth = (c: MatrixCell | undefined) => {
    if (!c) return 0;
    if (m.plain && !c.tone) return measureText(c.text ?? '–', theme.size.cell, c.strong ? 600 : 400);
    return Math.max(pill(c), c.note ? measureText(c.note, NOTE, 400) : 0);
  };
  const rowHeader = Math.max(m.corner ? (m.plain ? measureText(m.corner, theme.size.cell, 600) : measureText(m.corner, theme.size.caption, 500)) : 0, ...m.rows.map((r) => label(r, ROW_ICON))) + 2 * PAD;
  const natural = m.columns.map((col, j) => Math.max(72, label(col, COL_ICON), ...m.cells.map((r) => cellWidth(r[j]))));
  // A plain table that wraps keeps long text in its column: the words go on the next line.
  const wraps = (j: number) => !!m.plain && !!m.wrap && natural[j]! > m.wrap;
  const lines = m.cells.map((r) => m.columns.map((_, j) => {
    const c = r[j];
    return wraps(j) && c?.text && !c.tone ? wrapText(c.text, theme.size.cell, c.strong ? 600 : 400, m.wrap!, 12) : undefined;
  }));
  const columns = natural.map((w, j) => (wraps(j) ? Math.max(m.wrap!, ...lines.map((r) => Math.max(0, ...(r[j] ?? []).map((l) => measureText(l, theme.size.cell, 600))))) : w) + 2 * PAD);
  const notes = m.cells.some((r) => r.some((c) => c?.note));
  const rowHeight = notes ? 50 : 38;
  const bands = headerGroups(m.columns).map(([label, first, count]) => ({
    label,
    x: rowHeader + columns.slice(0, first).reduce((a, b) => a + b, 0),
    width: columns.slice(first, first + count).reduce((a, b) => a + b, 0),
  }));
  const band = bands.length ? BAND : 0;
  const head = band + HEAD;
  const rows: { y: number; height: number }[] = [];
  const sections: { label: string; y: number }[] = [];
  let y = head;
  for (const [i, r] of m.rows.entries()) {
    if (r.group && r.group !== m.rows[i - 1]?.group) {
      sections.push({ label: r.group, y });
      y += SECTION;
    }
    const most = Math.max(1, ...(lines[i] ?? []).map((l) => l?.length ?? 1));
    const height = most > 1 ? Math.max(rowHeight, most * LINE + 20) : rowHeight;
    rows.push({ y, height });
    y += height;
  }
  const width = rowHeader + columns.reduce((a, b) => a + b, 0);
  return { rowHeader, columns, rowHeight, width, height: y + 4, band, head, rows, sections, bands, lines };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function text(x: number, cy: number, s: string, size: number, weight: number, fill: string, anchor?: 'middle' | 'end', struck = false) {
  const a = `${anchor ? ` text-anchor="${anchor}"` : ''}${struck ? ' text-decoration="line-through"' : ''}`;
  return `<text x="${r1(x)}" y="${r1(cy + baselineOffset(size))}" font-size="${size}" font-weight="${weight}" fill="${fill}"${a}>${esc(s)}</text>`;
}

function glyph(name: string, x: number, y: number, size: number, color: string, stroke = 1.75) {
  const markup = icon(name);
  if (!markup) return '';
  const s = size / 24;
  return `<g transform="translate(${r1(x)} ${r1(y)}) scale(${s})" fill="none" stroke="${color}" stroke-width="${r1(stroke / s)}" stroke-linecap="round" stroke-linejoin="round">${markup}</g>`;
}

export function drawMatrix(m: MatrixShape, b: Box, theme: Theme, shadowId: string): string {
  const g = matrixGeometry(m, theme);
  const tone = (t?: Tone) => theme.tones[t ?? 'slate'];
  let s = `<rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.width)}" height="${r1(b.height)}" rx="${theme.radius.card}" fill="${theme.surface}" stroke="${theme.border}" stroke-width="${theme.stroke.card}"${shadowAttr(theme, shadowId)}/>`;

  // Header band: on a paper look it lies on the paper tint, with the contour under it, like a table's header.
  const paper = look(theme).tableHead === 'paper' ? paperTint(theme, 0) : undefined;
  const head = g.head;
  if (paper) s += topBand(b.x + 0.5, b.y + 0.5, b.width - 1, head - 0.5, Math.max(0, theme.radius.card - 0.5), paper);
  const rule = paper ? (groupLine(theme, theme.tones.slate) ?? theme.border) : theme.border;
  s += `<line x1="${r1(b.x)}" y1="${r1(b.y + head)}" x2="${r1(b.x + b.width)}" y2="${r1(b.y + head)}" stroke="${rule}" stroke-width="1"/>`;
  // Grouped columns: their name over them, with a short rule under it that shows how far the group goes.
  for (const band of g.bands) {
    s += text(b.x + band.x + band.width / 2, b.y + g.band / 2 + 4, fitText(band.label.toUpperCase(), 10, 600, band.width - 12), 10, 600, theme.textMuted, 'middle');
    s += `<line x1="${r1(b.x + band.x + 8)}" y1="${r1(b.y + g.band + 2)}" x2="${r1(b.x + band.x + band.width - 8)}" y2="${r1(b.y + g.band + 2)}" stroke="${theme.textFaint}" stroke-opacity="0.6" stroke-width="1"/>`;
  }
  // A plain table's corner is its first column's header, lettered like the others; a matrix's says how to read it (who \ where).
  if (m.corner) s += m.plain ? text(b.x + PAD, b.y + g.band + HEAD / 2, m.corner, theme.size.cell, 600, theme.text) : text(b.x + PAD, b.y + g.band + HEAD / 2, m.corner, theme.size.caption, 500, theme.textFaint);
  let x = b.x + g.rowHeader;
  for (const [j, col] of m.columns.entries()) {
    const w = g.columns[j]!;
    const cx = x + w / 2;
    const iconW = col.icon ? COL_ICON : 0;
    const labelW = Math.min(w - 2 * PAD - iconW, measureText(col.label, theme.size.cell, 600));
    // A plain table reads like a spreadsheet: everything flush left.
    const start = m.plain ? x + PAD : cx - (labelW + iconW) / 2;
    const cy = (col.caption ? b.y + HEAD / 2 - 7 : b.y + HEAD / 2) + g.band;
    if (col.icon) s += glyph(col.icon, start, cy - 7, 14, tone(col.tone).fg);
    s += text(start + iconW, cy, fitText(col.label, theme.size.cell, 600, w - 2 * PAD - iconW), theme.size.cell, 600, col.change === 'removed' ? theme.textMuted : theme.text, undefined, col.change === 'removed');
    if (col.caption) s += text(cx, cy + 16, fitText(col.caption, theme.size.caption, 400, w - 2 * PAD), theme.size.caption, 400, theme.textFaint, 'middle');
    // Column separators, subtle.
    s += `<line x1="${r1(x)}" y1="${r1(b.y + g.band + 10)}" x2="${r1(x)}" y2="${r1(b.y + b.height)}" stroke="${theme.border}" stroke-opacity="0.5" stroke-width="1"/>`;
    x += w;
  }

  // Grouped rows: the group's name in small capitals on a band of its own, as a table's sections.
  for (const sec of g.sections) {
    const sy = b.y + sec.y;
    if (sec.y > head) s += `<line x1="${r1(b.x)}" y1="${r1(sy)}" x2="${r1(b.x + b.width)}" y2="${r1(sy)}" stroke="${theme.border}" stroke-width="1"/>`;
    s += `<rect x="${r1(b.x + 0.5)}" y="${r1(sy + 0.5)}" width="${r1(b.width - 1)}" height="${SECTION - 1}" fill="${paperTint(theme, 1) ?? theme.tones.slate.bg}" fill-opacity="0.6"/>`;
    s += text(b.x + PAD, sy + SECTION / 2, fitText(sec.label.toUpperCase(), 10, 600, b.width - 2 * PAD), 10, 600, theme.textMuted);
  }

  // Rows.
  for (const [i, row] of m.rows.entries()) {
    const y = b.y + g.rows[i]!.y;
    const rh = g.rows[i]!.height;
    // A row that wraps reads from its top, as a table in a document does.
    const cy = rh > g.rowHeight ? y + 10 + LINE / 2 : y + rh / 2;
    // A row without a label continues the one above (more interfaces of one device): the rule skips its header.
    const more = m.plain && !row.label;
    if (i > 0 && g.rows[i - 1]!.y + g.rows[i - 1]!.height === g.rows[i]!.y)
      // Rules run to the table's edges, as the header's does.
      s += `<line x1="${r1(more ? b.x + g.rowHeader : b.x)}" y1="${r1(y)}" x2="${r1(b.x + b.width)}" y2="${r1(y)}" stroke="${theme.border}" stroke-opacity="0.6" stroke-width="1"/>`;
    const t = tone(row.tone);
    let tx = b.x + PAD;
    if (row.icon) {
      s += iconTile(theme, { x: tx, y: cy - 11, slot: 22, tone: t, icon: row.icon, rx: Math.min(6, theme.radius.tile), iconSize: look(theme).tile === 'bare' ? 17 : look(theme).tile === 'disc' || look(theme).tile === 'ring' ? 12 : 14 });
      tx += ROW_ICON;
    }
    const room = g.rowHeader - (tx - b.x) - PAD;
    const gone = row.change === 'removed';
    if (row.caption) {
      s += text(tx, cy - 7, fitText(row.label, theme.size.cell, 600, room), theme.size.cell, 600, gone ? theme.textMuted : theme.text, undefined, gone);
      s += text(tx, cy + 8, fitText(row.caption, theme.size.caption, 400, room), theme.size.caption, 400, theme.textMuted);
    } else s += text(tx, cy, fitText(row.label, theme.size.cell, 600, room), theme.size.cell, 600, gone ? theme.textMuted : theme.text, undefined, gone);

    let cx = b.x + g.rowHeader;
    for (const [j] of m.columns.entries()) {
      const w = g.columns[j]!;
      const cell = m.cells[i]?.[j];
      const wrapped = g.lines[i]?.[j];
      // Wrapped text starts at the top of its row, as in a document's table; a status pill stays flush left.
      s += wrapped
        ? wrapped.map((l, k) => text(cx + PAD, y + 10 + LINE * (k + 0.5), l, theme.size.cell, cell?.strong ? 600 : 400, theme.text)).join('')
        : m.plain && cell?.tone
          ? drawCell(cell, cx + PAD + cellPill(cell, theme) / 2, cy, w - 2 * PAD, theme)
          : m.plain
            ? text(cx + PAD, cy, fitText(cell?.text ?? '–', theme.size.cell, cell?.strong ? 600 : 400, w - 2 * PAD), theme.size.cell, cell?.strong ? 600 : 400, cell?.text ? theme.text : theme.textFaint)
            : m.compare && cell && !cell.change
              ? `<g opacity="0.42">${drawCell(cell, cx + w / 2, cy, w - 2 * PAD, theme)}</g>`
              : drawCell(cell, cx + w / 2, cy, w - 2 * PAD, theme);
      cx += w;
    }
  }
  return s;
}

const cellPill = (c: MatrixCell, theme: Theme) => measureText(c.text ?? '', chipText(theme), 500) + 2 * PILL_X;

function drawCell(c: MatrixCell | undefined, cx: number, cy: number, room: number, theme: Theme): string {
  if (c?.parts?.length) {
    // Several values: a small pill each, side by side, each in its own tone; the letters say which.
    let x = cx - partsWidth(c.parts, theme) / 2;
    let s = '';
    const size = chipText(theme);
    for (const p of c.parts) {
      const w = partWidth(p.text, theme);
      const t = theme.tones[p.tone ?? 'blue'];
      s += chipBack(theme, x, cy - PILL_H / 2, w, PILL_H, t, tagRadius(theme, PILL_H));
      s += text(x + w / 2, cy, p.text, size, 600, t.fg, 'middle');
      x += w + PART_GAP;
    }
    return s;
  }
  if (!c || (!c.text && !c.check)) return text(cx, cy, '–', theme.size.cell, 400, theme.textFaint, 'middle');
  const t = theme.tones[c.tone ?? 'blue'];
  const py = c.note ? cy - 8 : cy;
  let s = '';
  if (c.check) {
    const r = CHECK / 2;
    s += c.inherited
      ? `<circle cx="${r1(cx)}" cy="${r1(py)}" r="${r - 0.5}" fill="${theme.surface}" stroke="${t.fg}" stroke-width="1.2" stroke-dasharray="2.5 2"/>`
      : `<circle cx="${r1(cx)}" cy="${r1(py)}" r="${r}" fill="${t.fg}"/>`;
    s += glyph('check', cx - 6, py - 6, 12, c.inherited ? t.fg : theme.surface, 2.4);
  } else if (c.text) {
    const size = chipText(theme);
    const label = fitText(c.text, size, 500, room - 2 * PILL_X);
    const w = measureText(label, size, 500) + 2 * PILL_X;
    const x = cx - w / 2;
    const rx = tagRadius(theme, PILL_H);
    // Direct: a filled tag (outlined where the theme's chips are). Inherited: always a dashed outline.
    s += c.inherited
      ? `<rect x="${r1(x + 0.5)}" y="${r1(py - PILL_H / 2 + 0.5)}" width="${r1(w - 1)}" height="${PILL_H - 1}" rx="${rx}" fill="${theme.surface}" stroke="${t.fg}" stroke-opacity="0.7" stroke-width="1" stroke-dasharray="3 2"/>`
      : chipBack(theme, x, py - PILL_H / 2, w, PILL_H, t, rx);
    // A change has its own outline besides its sign: solid for gained, dashed for changed, dotted for lost.
    if (c.change)
      s += `<rect x="${r1(x - 2.5)}" y="${r1(py - PILL_H / 2 - 2.5)}" width="${r1(w + 5)}" height="${PILL_H + 5}" rx="${rx + 2.5}" fill="none" stroke="${t.fg}" stroke-width="1.4"${c.change === 'added' ? '' : ` stroke-dasharray="${c.change === 'changed' ? '5 3' : '1.5 3'}" stroke-linecap="round"`}/>`;
    s += text(cx, py, label, size, 500, t.fg, 'middle', c.change === 'removed');
  }
  if (c.note) s += text(cx, cy + 13, fitText(c.note, NOTE, 400, room), NOTE, 400, theme.textMuted, 'middle');
  return s;
}
