// Sheet marks: what makes the page a sheet. Corner marks show its extent without a box, so a white
// diagram does not float on a white slide. A frame adds a neatline, centring ticks and a zone grid
// (numbers along the top and bottom, letters down the sides), as on a map sheet or a drawing frame.
import { look, type Theme } from '@cartography/theme';
import { esc, r1 } from './paint.ts';

/** Arm length of a corner mark. */
const ARM = 9;
/** Roughly how wide a zone is; the sheet is divided into whole zones. */
const ZONE = 260;
/** Letters down the side skip I and O, as drawing frames do. */
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Extra page padding a frame needs, so the title and the drawing keep their distance from it. */
export function sheetPad(theme: Theme): number {
  const s = look(theme).sheet;
  return s.marks === 'frame' ? Math.max(0, s.inset + s.band - 6) : 0;
}

/** A fine dot grid behind the drawing, as on drafting paper: a pattern for the defs and the rectangle that shows it. */
export function dotGrid(width: number, height: number, theme: Theme, id: string): { defs: string; body: string } {
  const d = theme.background?.dots;
  if (!d) return { defs: '', body: '' };
  // Inside a frame the grid stops at the neatline.
  const s = look(theme).sheet;
  const m = s.marks === 'frame' ? s.inset + s.band : 0;
  return {
    defs: `<pattern id="${id}-dots" x="${m}" y="${m}" width="${d.step}" height="${d.step}" patternUnits="userSpaceOnUse"><circle cx="${d.step / 2}" cy="${d.step / 2}" r="${d.r}" fill="${d.color}"/></pattern>`,
    body: `<rect x="${m}" y="${m}" width="${width - 2 * m}" height="${height - 2 * m}" fill="url(#${id}-dots)"/>`,
  };
}

export function drawSheet(width: number, height: number, theme: Theme): string {
  const s = look(theme).sheet;
  if (s.marks === 'none') return '';
  const m = s.inset;
  let out = '';
  if (s.marks === 'corners') {
    for (const [x, y, dx, dy] of [[m, m, 1, 1], [width - m, m, -1, 1], [m, height - m, 1, -1], [width - m, height - m, -1, -1]] as const)
      out += `<path d="M${x + dx * ARM} ${y}H${x}V${y + dy * ARM}" fill="none" stroke="${theme.textFaint}" stroke-width="1"/>`;
    return out;
  }
  const line = theme.text;
  const w = width - 2 * m;
  const h = height - 2 * m;
  out += `<rect x="${m}" y="${m}" width="${w}" height="${h}" fill="none" stroke="${line}" stroke-width="1"/>`;
  if (s.zones) {
    const i0 = m + s.band;
    const iw = width - 2 * i0;
    const ih = height - 2 * i0;
    out += `<rect x="${i0}" y="${i0}" width="${iw}" height="${ih}" fill="none" stroke="${line}" stroke-width="1"/>`;
    const cols = Math.max(2, Math.round(iw / ZONE));
    const rows = Math.min(LETTERS.length, Math.max(2, Math.round(ih / ZONE)));
    const label = (x: number, y: number, t: string) =>
      `<text x="${r1(x)}" y="${r1(y + 2.9)}" font-size="8" font-weight="500" fill="${theme.textFaint}" text-anchor="middle" font-family="${esc(theme.font.mono)}">${t}</text>`;
    for (let i = 0; i < cols; i++) {
      const x0 = i0 + (iw * i) / cols;
      const xc = x0 + iw / cols / 2;
      if (i) out += `<path d="M${r1(x0)} ${m}V${i0}M${r1(x0)} ${height - i0}V${height - m}" stroke="${line}" stroke-width="1"/>`;
      out += label(xc, m + s.band / 2, String(i + 1)) + label(xc, height - m - s.band / 2, String(i + 1));
    }
    for (let j = 0; j < rows; j++) {
      const y0 = i0 + (ih * j) / rows;
      const yc = y0 + ih / rows / 2;
      if (j) out += `<path d="M${m} ${r1(y0)}H${i0}M${width - i0} ${r1(y0)}H${width - m}" stroke="${line}" stroke-width="1"/>`;
      out += label(m + s.band / 2, yc, LETTERS[j]!) + label(width - m - s.band / 2, yc, LETTERS[j]!);
    }
  }
  if (s.ticks) {
    // Centring ticks: short strokes across the frame at the middle of each side; with a zone band
    // they stop at the frame, so they never run through a zone's letter or number.
    const t = 7;
    const inner = s.zones ? 0 : t;
    for (const [x, y, dx, dy] of [[width / 2, m, 0, 1], [width / 2, height - m, 0, -1], [m, height / 2, 1, 0], [width - m, height / 2, -1, 0]] as const)
      out += `<path d="M${r1(x - dx * t)} ${r1(y - dy * t)}L${r1(x + dx * inner)} ${r1(y + dy * inner)}" stroke="${line}" stroke-width="1"/>`;
  }
  return out;
}
