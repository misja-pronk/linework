// Drawing one step of a presentation: what stands back is drawn with a quiet version of the theme
// (not see-through, so lines never show through cards), the route in focus gets weight, and the
// caption, the "3 / 7" marker and callouts take the same room at every step so nothing jumps.
import { esc } from './paint.ts';
import type { Box, Placed, Point, StepNote, StepState } from '@cartography/core';
import { baselineOffset, hex, measureText, mix, parseColor, type Theme } from '@cartography/theme';

export interface StepView {
  /** The step drawn, from 0. */
  index: number;
  states: StepState[];
  /** False leaves the title, caption and marker out (a presenter shows them itself). */
  caption?: boolean;
}

const quiet = new WeakMap<Theme, Theme>();
const strong = new WeakMap<Theme, Theme>();

/** The theme for what stands back: near the canvas and nearly grey, with a hint of its colour left so it still reads as the same thing. */
export function quietTheme(theme: Theme): Theme {
  let t = quiet.get(theme);
  if (t) return t;
  const dark = theme.mode === 'dark';
  const grey = (c: string) => {
    const rgb = parseColor(c);
    if (!rgb) return c;
    const y = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    return mix(c, hex([y, y, y]), 0.3);
  };
  const q = (c: string, amount: number) => (parseColor(c) ? mix(grey(c), theme.canvas, amount) : c);
  t = {
    ...theme,
    surface: q(theme.surface, dark ? 0.45 : 0.55),
    border: q(theme.border, 0.7),
    text: q(theme.text, dark ? 0.5 : 0.46),
    textMuted: q(theme.textMuted, dark ? 0.55 : 0.52),
    textFaint: q(theme.textFaint, 0.6),
    edge: q(theme.edge, dark ? 0.5 : 0.45),
    shadow: { ...theme.shadow, opacity: 0 },
    tones: Object.fromEntries(Object.entries(theme.tones).map(([k, c]) => [k, { fg: q(c.fg, dark ? 0.5 : 0.42), bg: q(c.bg, 0.5), wash: q(c.wash, 0.45), line: q(c.line, 0.55) }])) as Theme['tones'],
    ...(theme.accent ? { accent: q(theme.accent, 0.45) } : {}),
    tile: theme.tile === 'solid' ? 'soft' : theme.tile === 'disc' ? 'ring' : theme.tile,
    cardBar: false,
  };
  quiet.set(theme, t);
  return t;
}

/** The theme for lines on the route in focus: heavier and darker, so the emphasis does not hang on colour. */
export function strongTheme(theme: Theme): Theme {
  let t = strong.get(theme);
  if (!t) strong.set(theme, (t = { ...theme, edge: theme.text, textMuted: theme.text, stroke: { ...theme.stroke, edge: theme.stroke.edge * 1.8 } }));
  return t;
}

export function wrap(text: string, size: number, weight: 400 | 500 | 600, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measureText(next, size, weight) > max) (lines.push(line), (line = word));
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const line = (x: number, cy: number, s: string, size: number, weight: number, fill: string, anchor?: 'end' | 'middle') =>
  `<text x="${r1(x)}" y="${r1(cy + baselineOffset(size))}" font-size="${size}" font-weight="${weight}" fill="${fill}"${anchor ? ` text-anchor="${anchor}"` : ''}>${esc(s)}</text>`;

export const CAPTION = { gap: 28, title: 16, text: 15, row: 23, marker: 64 };

/** The lines of a step's caption block: its title, then the caption wrapped to the room there is. */
export function captionLines(s: StepState, width: number): { text: string; title: boolean }[] {
  const room = Math.max(240, width - CAPTION.marker);
  return [...(s.title ? [{ text: s.title, title: true }] : []), ...(s.caption ? wrap(s.caption, CAPTION.text, 400, room).map((text) => ({ text, title: false })) : [])];
}

/** Title, caption and "3 / 7" under the drawing. As high as the longest caption of all steps, so every step is the same size. */
export function captionBlock(view: StepView, theme: Theme, width: number) {
  const height = CAPTION.gap + Math.max(1, ...view.states.map((s) => captionLines(s, width).length)) * CAPTION.row;
  const draw = (x: number, y: number) => {
    const s = view.states[view.index]!;
    let cy = y + CAPTION.gap + CAPTION.row / 2;
    // A hairline with a short accent segment ties the caption to the drawing above it.
    let out = `<rect x="${r1(x)}" y="${r1(y + CAPTION.gap - 12)}" width="${r1(width)}" height="1" fill="${theme.border}"/><rect x="${r1(x)}" y="${r1(y + CAPTION.gap - 13)}" width="40" height="3" rx="1.5" fill="${theme.accent ?? theme.tones.blue.fg}"/>`;
    out += line(x + width, cy, `${view.index + 1} / ${view.states.length}`, 13, 500, theme.textFaint, 'end');
    for (const l of captionLines(s, width)) {
      out += l.title ? line(x, cy, l.text, CAPTION.title, 600, theme.text) : line(x, cy, l.text, CAPTION.text, 400, s.title ? theme.textMuted : theme.text);
      cy += CAPTION.row;
    }
    return out;
  };
  return { height, draw };
}

const NOTE = { size: 12.5, row: 17, padX: 12, padY: 7, max: 220, gap: 10 };

export interface PlacedNote {
  box: Box;
  lines: string[];
  /** Where it points: on the edge of the element it is about. */
  tip: Point;
}

/** Callouts of one step: next to their element, on the side with the fewest things in the way. */
export function placeNotes(state: StepState, placed: Placed): PlacedNote[] {
  const boxes = [...placed.nodes].filter(([id]) => state.nodes[id] !== 'hidden').map(([, b]) => b);
  // The strip a group's name is on: better left free, but a callout may cross a frame.
  const names = [...placed.groups].filter(([id]) => state.groups[id] !== 'hidden').map(([, g]) => ({ x: g.x, y: g.y, width: g.width, height: 44 }));
  const hit = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  // Lines that are drawn, as the boxes of their segments and labels: a callout should not sit on the route it explains.
  const lines = [...placed.edges]
    .filter(([id]) => state.edges[id] !== 'hidden')
    .map(([, e]) => [
      ...e.points.slice(1).map((p, i) => ({ x: Math.min(p.x, e.points[i]!.x) - 2, y: Math.min(p.y, e.points[i]!.y) - 2, width: Math.abs(p.x - e.points[i]!.x) + 4, height: Math.abs(p.y - e.points[i]!.y) + 4 })),
      ...(e.label ? [e.label] : []),
    ]);
  const out: PlacedNote[] = [];
  for (const n of state.notes) {
    const target = anchor(n, placed);
    if (!target) continue;
    const words = wrap(n.text, NOTE.size, 500, NOTE.max);
    const w = Math.max(...words.map((l) => measureText(l, NOTE.size, 500))) + 2 * NOTE.padX;
    const h = words.length * NOTE.row + 2 * NOTE.padY;
    const cx = target.x + target.width / 2;
    const cy = target.y + target.height / 2;
    const spots: PlacedNote[] = [
      { box: { x: cx - w / 2, y: target.y - NOTE.gap - h, width: w, height: h }, lines: words, tip: { x: cx, y: target.y } },
      { box: { x: cx - w / 2, y: target.y + target.height + NOTE.gap, width: w, height: h }, lines: words, tip: { x: cx, y: target.y + target.height } },
      { box: { x: target.x + target.width + NOTE.gap, y: cy - h / 2, width: w, height: h }, lines: words, tip: { x: target.x + target.width, y: cy } },
      { box: { x: target.x - NOTE.gap - w, y: cy - h / 2, width: w, height: h }, lines: words, tip: { x: target.x, y: cy } },
    ];
    const outside = (b: Box) => b.x < 0 || b.y < 0 || b.x + b.width > placed.width || b.y + b.height > placed.height;
    const cost = (s: PlacedNote) => boxes.filter((b) => b !== target && hit(s.box, b)).length * 10 + out.filter((o) => hit(s.box, o.box)).length * 10 + names.filter((b) => hit(s.box, b)).length * 3 + lines.filter((l) => l.some((b) => hit(s.box, b))).length * 2 + (outside(s.box) ? 1 : 0);
    out.push(spots.reduce((best, s) => (cost(s) < cost(best) ? s : best)));
  }
  return out;
}

function anchor(n: StepNote, placed: Placed): Box | undefined {
  if (n.kind === 'node') return placed.nodes.get(n.id);
  // A group is pointed at by its label strip, not its middle (where its contents are).
  const g = n.kind === 'group' ? placed.groups.get(n.id) : undefined;
  if (g) return { x: g.x, y: g.y, width: Math.min(g.width, 160), height: 40 };
  const e = placed.edges.get(n.id);
  if (!e?.points.length) return undefined;
  if (e.label) return e.label;
  const i = Math.floor((e.points.length - 1) / 2);
  const mid = e.points[i]!;
  const next = e.points[i + 1] ?? mid;
  return { x: (mid.x + next.x) / 2 - 4, y: (mid.y + next.y) / 2 - 4, width: 8, height: 8 };
}

/** Room the callouts of all steps need outside the drawing, so its size is the same at every step. */
export function noteMargins(view: StepView, placed: Placed) {
  const m = { left: 0, top: 0, right: 0, bottom: 0 };
  for (const s of view.states)
    for (const n of placeNotes(s, placed)) {
      m.left = Math.max(m.left, -n.box.x);
      m.top = Math.max(m.top, -n.box.y);
      m.right = Math.max(m.right, n.box.x + n.box.width - placed.width);
      m.bottom = Math.max(m.bottom, n.box.y + n.box.height - placed.height);
    }
  return m;
}

/** A callout: a filled bubble in the text colour with a pointer, readable on a projector in both modes. */
export function drawNote(n: PlacedNote, theme: Theme): string {
  const b = n.box;
  const cx = Math.min(b.x + b.width - 12, Math.max(b.x + 12, n.tip.x));
  const cy = Math.min(b.y + b.height - 10, Math.max(b.y + 10, n.tip.y));
  // The pointer: a small triangle from the bubble's edge towards the element.
  const above = n.tip.y >= b.y + b.height;
  const below = n.tip.y <= b.y;
  const left = n.tip.x >= b.x + b.width;
  const d =
    above || below
      ? `M${r1(cx - 6)} ${r1(above ? b.y + b.height : b.y)}L${r1(cx)} ${r1(above ? b.y + b.height + 7 : b.y - 7)}L${r1(cx + 6)} ${r1(above ? b.y + b.height : b.y)}Z`
      : `M${r1(left ? b.x + b.width : b.x)} ${r1(cy - 6)}L${r1(left ? b.x + b.width + 7 : b.x - 7)} ${r1(cy)}L${r1(left ? b.x + b.width : b.x)} ${r1(cy + 6)}Z`;
  let s = `<rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.width)}" height="${r1(b.height)}" rx="8" fill="${theme.text}" stroke="${theme.canvas}" stroke-width="2"/><path d="${d}" fill="${theme.text}"/>`;
  for (const [i, l] of n.lines.entries()) s += line(b.x + NOTE.padX, b.y + NOTE.padY + NOTE.row * i + NOTE.row / 2, l, NOTE.size, 500, theme.canvas);
  return s;
}
