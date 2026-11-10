// Matrix shape: row headers on the left, column headers on top, a pill or check mark per cell.
// Direct values are filled, inherited ones outlined, so the difference does not rely on colour.
import type { Box, MatrixCell, MatrixShape, Tone } from '@cartography/core';
import { baselineOffset, chipText, fitText, groupLine, look, measureText, paperTint, type Theme } from '@cartography/theme';
import { icon } from '@cartography/icons';
import { chipBack, iconTile, shadowAttr, tagRadius, topBand } from './paint.ts';

/** Matrix metrics, shared with the slide export. ROW_ICON/COL_ICON: room an icon takes before a header label (a tile in rows, a bare icon in columns). */
export const MATRIX = { PAD: 16, HEAD: 56, PILL_H: 22, PILL_X: 10, NOTE: 10.5, CHECK: 18, ROW_ICON: 30, COL_ICON: 22 } as const;
const { PAD, HEAD, PILL_H, PILL_X, NOTE, CHECK, ROW_ICON, COL_ICON } = MATRIX;

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
    if (m.plain) return measureText(c.text ?? '–', theme.size.cell, c.strong ? 600 : 400);
    const pill = c.check ? CHECK : c.text ? measureText(c.text, chipText(theme), 500) + 2 * PILL_X : 0;
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
  if (paper) s += topBand(b.x + 0.5, b.y + 0.5, b.width - 1, HEAD - 0.5, Math.max(0, theme.radius.card - 0.5), paper);
  s += `<line x1="${r1(b.x)}" y1="${r1(b.y + HEAD)}" x2="${r1(b.x + b.width)}" y2="${r1(b.y + HEAD)}" stroke="${paper ? (groupLine(theme, theme.tones.slate) ?? theme.border) : theme.border}" stroke-width="1"/>`;
  if (m.corner) s += text(b.x + PAD, b.y + HEAD / 2, m.corner, theme.size.caption, 500, theme.textFaint);
  let x = b.x + g.rowHeader;
  for (const [j, col] of m.columns.entries()) {
    const w = g.columns[j]!;
    const cx = x + w / 2;
    const iconW = col.icon ? COL_ICON : 0;
    const labelW = Math.min(w - 2 * PAD - iconW, measureText(col.label, theme.size.cell, 600));
    // A plain table reads like a spreadsheet: everything flush left.
    const start = m.plain ? x + PAD : cx - (labelW + iconW) / 2;
    const cy = col.caption ? b.y + HEAD / 2 - 7 : b.y + HEAD / 2;
    if (col.icon) s += glyph(col.icon, start, cy - 7, 14, tone(col.tone).fg);
    s += text(start + iconW, cy, fitText(col.label, theme.size.cell, 600, w - 2 * PAD - iconW), theme.size.cell, 600, col.change === 'removed' ? theme.textMuted : theme.text, undefined, col.change === 'removed');
    if (col.caption) s += text(cx, cy + 16, fitText(col.caption, theme.size.caption, 400, w - 2 * PAD), theme.size.caption, 400, theme.textFaint, 'middle');
    // Column separators, subtle.
    s += `<line x1="${r1(x)}" y1="${r1(b.y + 10)}" x2="${r1(x)}" y2="${r1(b.y + b.height - 10)}" stroke="${theme.border}" stroke-opacity="0.5" stroke-width="1"/>`;
    x += w;
  }

  // Rows.
  let y = b.y + HEAD;
  for (const [i, row] of m.rows.entries()) {
    const cy = y + g.rowHeight / 2;
    // A row without a label continues the one above (more interfaces of one device): the rule skips its header.
    const more = m.plain && !row.label;
    if (i > 0)
      s += `<line x1="${r1(more ? b.x + g.rowHeader : b.x + PAD)}" y1="${r1(y)}" x2="${r1(b.x + b.width - PAD)}" y2="${r1(y)}" stroke="${theme.border}" stroke-opacity="0.6" stroke-width="1"/>`;
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
      s += m.plain
        ? text(cx + PAD, cy, fitText(cell?.text ?? '–', theme.size.cell, cell?.strong ? 600 : 400, w - 2 * PAD), theme.size.cell, cell?.strong ? 600 : 400, cell?.text ? theme.text : theme.textFaint)
        : m.compare && cell && !cell.change
          ? `<g opacity="0.42">${drawCell(cell, cx + w / 2, cy, w - 2 * PAD, theme)}</g>`
          : drawCell(cell, cx + w / 2, cy, w - 2 * PAD, theme);
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
