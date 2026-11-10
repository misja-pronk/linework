// The timeline under a drawing of one stage (or of the migration overview): a stop per stage, the
// one drawn filled and named in bold, what each stage changes under its name, then the stage's own
// title and description. As high at every stage, so slides of the stages line up.
import { baselineOffset, fitText, measureText, type Theme } from '@cartography/theme';
import { CAPTION, wrap } from './steps.ts';

export interface StageStop {
  title: string;
  when?: string;
  /** What the stage changes, said short: "+3 −1 ~2". */
  note?: string;
  description?: string;
}

export interface StageStrip {
  stops: StageStop[];
  /** The stage drawn, from 0; undefined is the overview of all of them. */
  at?: number;
  /** Heading and sentence of the overview, instead of the stage's own. */
  heading?: string;
  caption?: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n: number) => Math.round(n * 10) / 10;
const text = (x: number, cy: number, s: string, size: number, weight: number, fill: string, anchor?: 'middle' | 'end') =>
  `<text x="${r1(x)}" y="${r1(cy + baselineOffset(size))}" font-size="${size}" font-weight="${weight}" fill="${fill}"${anchor ? ` text-anchor="${anchor}"` : ''}>${esc(s)}</text>`;

const LINE = { strip: 62, dot: 6 };

/** The block's lines of text under the timeline: the heading, then the description wrapped. */
function said(strip: StageStrip, width: number) {
  const s = strip.at == null ? undefined : strip.stops[strip.at];
  const own = strip.heading == null;
  const caption = own ? s?.description : strip.caption;
  return { heading: own ? s?.title : strip.heading, lines: caption ? wrap(caption, CAPTION.text, 400, Math.max(240, width)) : [] };
}

export function stageBlock(strip: StageStrip, theme: Theme, width: number) {
  // Every stage's description is measured, so the block is as high at each stage.
  const rows = Math.max(said(strip, width).lines.length, ...strip.stops.map((_, i) => said({ stops: strip.stops, at: i }, width).lines.length));
  const height = CAPTION.gap + LINE.strip + CAPTION.row * (1 + rows);
  const draw = (x: number, y: number) => {
    const n = strip.stops.length;
    const step = width / Math.max(1, n);
    const cx = (i: number) => x + step * (i + 0.5);
    const cy = y + CAPTION.gap + 8;
    const ink = theme.text;
    let out = `<g data-stages="">`;
    out += `<line x1="${r1(cx(0))}" x2="${r1(cx(n - 1))}" y1="${r1(cy)}" y2="${r1(cy)}" stroke="${theme.border}" stroke-width="2"/>`;
    for (const [i, s] of strip.stops.entries()) {
      const on = i === strip.at;
      const past = strip.at != null && i < strip.at;
      out += on
        ? `<circle cx="${r1(cx(i))}" cy="${r1(cy)}" r="${LINE.dot + 1.5}" fill="${ink}" stroke="${theme.canvas}" stroke-width="2"/>`
        : `<circle cx="${r1(cx(i))}" cy="${r1(cy)}" r="${LINE.dot - 1}" fill="${past ? theme.textMuted : theme.canvas}" stroke="${past ? theme.textMuted : theme.border}" stroke-width="2"/>`;
      const room = step - 12;
      out += text(cx(i), cy + 20, fitText(s.title, 13, on ? 600 : 500, room), 13, on ? 600 : 500, on ? ink : theme.textMuted, 'middle');
      const sub = [s.when, s.note].filter(Boolean).join(' · ');
      if (sub) out += text(cx(i), cy + 37, fitText(sub, 11.5, 400, room), 11.5, 400, theme.textFaint, 'middle');
    }
    const words = said(strip, width);
    let ty = y + CAPTION.gap + LINE.strip + CAPTION.row / 2;
    if (words.heading) out += text(x, ty, fitText(words.heading, CAPTION.title, 600, width), CAPTION.title, 600, ink);
    for (const l of words.lines) out += text(x, (ty += CAPTION.row), l, CAPTION.text, 400, theme.textMuted);
    return `${out}</g>`;
  };
  return { height, draw };
}

/** "+3 −1 ~2": what a stage changes, in signs that read without colour. */
export function stageNote(s: { added: number; removed: number; changed: number }): string | undefined {
  const parts = [s.added ? `+${s.added}` : '', s.removed ? `−${s.removed}` : '', s.changed ? `~${s.changed}` : ''].filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
}

export const stageStripWidth = (strip: StageStrip) => strip.stops.length * Math.max(...strip.stops.map((s) => measureText(s.title, 13, 600) + 24), 90);
