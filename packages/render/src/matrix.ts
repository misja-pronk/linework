// Matrix shape: row headers on the left, column headers on top, a pill or check mark per cell.
// Direct values are filled, inherited ones outlined, so the difference does not rely on colour.
import type { Box, MatrixCell, MatrixShape, Tone } from '@cartography/core';
import { baselineOffset, fitText, measureText, type Theme } from '@cartography/theme';
import { icon } from '@cartography/icons';

const PAD = 16;
const HEAD = 56;
const PILL_H = 22;
const PILL_X = 10;
const NOTE = 10.5;
const CHECK = 18;
/** Room an icon takes before a header label: a tile in rows, a bare icon in columns. */
const ROW_ICON = 30;
const COL_ICON = 22;

export interface MatrixGeometry {
  rowHeader: number;
  columns: number[];
  rowHeight: number;
  width: number;
  height: number;
}

export function matrixGeometry(m: MatrixShape, theme: Theme): MatrixGeometry {
  const label = (h: { label: string; caption?: string; icon?: string }, iconWidth: number) =>
    (h.icon ? iconWidth : 0) + Math.max(measureText(h.label, theme.size.cell, 600), h.caption ? measureText(h.caption, theme.size.caption, 400) : 0);
  const cellWidth = (c: MatrixCell | undefined) => {
    if (!c) return 0;
    const pill = c.check ? CHECK : c.text ? measureText(c.text, theme.size.edgeLabel, 500) + 2 * PILL_X : 0;
    return Math.max(pill, c.note ? measureText(c.note, NOTE, 400) : 0);
  };
  const rowHeader = Math.max(m.corner ? measureText(m.corner, theme.size.caption, 500) : 0, ...m.rows.map((r) => label(r, ROW_ICON))) + 2 * PAD;
  const columns = m.columns.map((col, j) => Math.max(72, label(col, COL_ICON), ...m.cells.map((r) => cellWidth(r[j]))) + 2 * PAD);
  const notes = m.cells.some((r) => r.some((c) => c?.note));
  const rowHeight = notes ? 50 : 38;
  const width = rowHeader + columns.reduce((a, b) => a + b, 0);
  return { rowHeader, columns, rowHeight, width, height: HEAD + m.rows.length * rowHeight + 4 };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function text(x: number, cy: number, s: string, size: number, weight: number, fill: string, anchor?: 'middle' | 'end') {
  const a = anchor ? ` text-anchor="${anchor}"` : '';
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
  let s = `<rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.width)}" height="${r1(b.height)}" rx="${theme.radius.card}" fill="${theme.surface}" stroke="${theme.border}" stroke-width="1" filter="url(#${shadowId})"/>`;

  // Header band.
  s += `<line x1="${r1(b.x)}" y1="${r1(b.y + HEAD)}" x2="${r1(b.x + b.width)}" y2="${r1(b.y + HEAD)}" stroke="${theme.border}" stroke-width="1"/>`;
  if (m.corner) s += text(b.x + PAD, b.y + HEAD / 2, m.corner, theme.size.caption, 500, theme.textFaint);
  let x = b.x + g.rowHeader;
  for (const [j, col] of m.columns.entries()) {
    const w = g.columns[j]!;
    const cx = x + w / 2;
    const iconW = col.icon ? COL_ICON : 0;
    const labelW = Math.min(w - 2 * PAD - iconW, measureText(col.label, theme.size.cell, 600));
    const start = cx - (labelW + iconW) / 2;
    const cy = col.caption ? b.y + HEAD / 2 - 7 : b.y + HEAD / 2;
    if (col.icon) s += glyph(col.icon, start, cy - 7, 14, tone(col.tone).fg);
    s += text(start + iconW, cy, fitText(col.label, theme.size.cell, 600, w - 2 * PAD - iconW), theme.size.cell, 600, theme.text);
    if (col.caption) s += text(cx, cy + 16, fitText(col.caption, theme.size.caption, 400, w - 2 * PAD), theme.size.caption, 400, theme.textFaint, 'middle');
    // Column separators, subtle.
    s += `<line x1="${r1(x)}" y1="${r1(b.y + 10)}" x2="${r1(x)}" y2="${r1(b.y + b.height - 10)}" stroke="${theme.border}" stroke-opacity="0.5" stroke-width="1"/>`;
    x += w;
  }

  // Rows.
  let y = b.y + HEAD;
  for (const [i, row] of m.rows.entries()) {
    const cy = y + g.rowHeight / 2;
    if (i > 0)
      s += `<line x1="${r1(b.x + PAD)}" y1="${r1(y)}" x2="${r1(b.x + b.width - PAD)}" y2="${r1(y)}" stroke="${theme.border}" stroke-opacity="0.6" stroke-width="1"/>`;
    const t = tone(row.tone);
    let tx = b.x + PAD;
    if (row.icon) {
      s += `<rect x="${r1(tx)}" y="${r1(cy - 11)}" width="22" height="22" rx="6" fill="${t.bg}"/>` + glyph(row.icon, tx + 4, cy - 7, 14, t.fg);
      tx += ROW_ICON;
    }
    const room = g.rowHeader - (tx - b.x) - PAD;
    if (row.caption) {
      s += text(tx, cy - 7, fitText(row.label, theme.size.cell, 600, room), theme.size.cell, 600, theme.text);
      s += text(tx, cy + 8, fitText(row.caption, theme.size.caption, 400, room), theme.size.caption, 400, theme.textMuted);
    } else s += text(tx, cy, fitText(row.label, theme.size.cell, 600, room), theme.size.cell, 600, theme.text);

    let cx = b.x + g.rowHeader;
    for (const [j] of m.columns.entries()) {
      const w = g.columns[j]!;
      s += drawCell(m.cells[i]?.[j], cx + w / 2, cy, w - 2 * PAD, theme);
      cx += w;
    }
    y += g.rowHeight;
  }
  return s;
}

function drawCell(c: MatrixCell | undefined, cx: number, cy: number, room: number, theme: Theme): string {
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
    const label = fitText(c.text, theme.size.edgeLabel, 500, room - 2 * PILL_X);
    const w = measureText(label, theme.size.edgeLabel, 500) + 2 * PILL_X;
    const x = cx - w / 2;
    s += c.inherited
      ? `<rect x="${r1(x + 0.5)}" y="${r1(py - PILL_H / 2 + 0.5)}" width="${r1(w - 1)}" height="${PILL_H - 1}" rx="${PILL_H / 2}" fill="${theme.surface}" stroke="${t.fg}" stroke-opacity="0.7" stroke-width="1" stroke-dasharray="3 2"/>`
      : `<rect x="${r1(x)}" y="${r1(py - PILL_H / 2)}" width="${r1(w)}" height="${PILL_H}" rx="${PILL_H / 2}" fill="${t.bg}"/>`;
    s += text(cx, py, label, theme.size.edgeLabel, 500, t.fg, 'middle');
  }
  if (c.note) s += text(cx, cy + 13, fitText(c.note, NOTE, 400, room), NOTE, 400, theme.textMuted, 'middle');
  return s;
}
