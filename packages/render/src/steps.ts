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
  /** The steps whose callouts the drawing keeps room for, when not `states`: the whole drawing keeps its steps' room, so it is as large as they are. */
  room?: StepState[];
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
    // A hairline ties the caption to the drawing above it ("3 / 7" says where the story is; a bar that never moves would look like progress).
    let out = `<rect x="${r1(x)}" y="${r1(y + CAPTION.gap - 12)}" width="${r1(width)}" height="1" fill="${theme.border}"/>`;
    out += line(x + width, cy, `${view.index + 1} / ${view.states.length}`, 13, 500, theme.textFaint, 'end');
    for (const l of captionLines(s, width)) {
      out += l.title ? line(x, cy, l.text, CAPTION.title, 600, theme.text) : line(x, cy, l.text, CAPTION.text, 400, s.title ? theme.textMuted : theme.text);
      cy += CAPTION.row;
    }
    return out;
  };
  return { height, draw };
}

/** `near`: as close as a callout comes where a gap is narrow, its pointer's length. */
const NOTE = { size: 12.5, row: 17, padX: 12, padY: 7, max: 220, gap: 10, near: 7 };

export interface PlacedNote {
  box: Box;
  lines: string[];
  /** Where it points: on the edge of the element it is about. */
  tip: Point;
}

const hit = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const within = (a: Box, b: Box) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;

/** The strip between a callout and its element where the callout stands further out than its own pointer reaches: a line runs there. */
export function noteStem(n: PlacedNote): Box | undefined {
  const b = n.box;
  if (n.tip.y <= b.y || n.tip.y >= b.y + b.height) {
    const [y0, y1] = n.tip.y <= b.y ? [n.tip.y, b.y] : [b.y + b.height, n.tip.y];
    return y1 - y0 > NOTE.gap + 1 ? { x: n.tip.x - 3, y: y0 + 2, width: 6, height: y1 - y0 - 4 } : undefined;
  }
  const [x0, x1] = n.tip.x <= b.x ? [n.tip.x, b.x] : [b.x + b.width, n.tip.x];
  return x1 - x0 > NOTE.gap + 1 ? { x: x0 + 2, y: n.tip.y - 3, width: x1 - x0 - 4, height: 6 } : undefined;
}

/**
 * Callouts of one step: beside their element where that is clear of cards, line labels, other
 * callouts and the frames of groups. Where it is not, just past a frame the element sits in, with a
 * line back to it; failing that, over the inside of a group rather than over words.
 */
export function placeNotes(state: StepState, placed: Placed): PlacedNote[] {
  const boxes = [...placed.nodes].filter(([id]) => state.nodes[id] !== 'hidden').map(([, b]) => b);
  const frames = [...placed.groups].filter(([id]) => state.groups[id] !== 'hidden').map(([, g]) => g);
  // The strip a group's name is on: better left free.
  const names = frames.map((g) => ({ x: g.x, y: g.y, width: g.width, height: 44 }));
  const drawn = [...placed.edges].filter(([id]) => state.edges[id] !== 'hidden').map(([, e]) => e);
  const labels = drawn.flatMap((e) => (e.label ? [e.label] : []));
  // Lines that are drawn, as the boxes of their segments: a callout should not sit on the route it explains.
  const lines = drawn.map((e) => e.points.slice(1).map((p, i) => ({ x: Math.min(p.x, e.points[i]!.x) - 2, y: Math.min(p.y, e.points[i]!.y) - 2, width: Math.abs(p.x - e.points[i]!.x) + 4, height: Math.abs(p.y - e.points[i]!.y) + 4 })));
  const out: PlacedNote[] = [];
  for (const n of state.notes) {
    const target = anchor(n, placed);
    if (!target) continue;
    const words = wrap(n.text, NOTE.size, 500, NOTE.max);
    const w = Math.max(...words.map((l) => measureText(l, NOTE.size, 500))) + 2 * NOTE.padX;
    const h = words.length * NOTE.row + 2 * NOTE.padY;
    const cx = target.x + target.width / 2;
    const cy = target.y + target.height / 2;
    // How far out on each side: just beside the element (closer still where a gap is narrow), or just past one of the frames around it.
    const around = frames.filter((g) => within(target, g));
    const room = { top: target.y, bottom: -(target.y + target.height), left: target.x, right: -(target.x + target.width) };
    const edgeOf = { top: (g: Box) => g.y, bottom: (g: Box) => -(g.y + g.height), left: (g: Box) => g.x, right: (g: Box) => -(g.x + g.width) };
    const reach = (side: keyof typeof room) => [...new Set([NOTE.gap, NOTE.near, ...around.map((g) => room[side] - edgeOf[side](g) + NOTE.gap)].filter((d) => d >= NOTE.near))];
    // Along the side: centred on the element, or lined up with one of its ends.
    const across = [cx - w / 2, target.x, target.x + target.width - w];
    const along = [cy - h / 2, target.y, target.y + target.height - h];
    const tipX = (x: number) => Math.min(x + w - 14, Math.max(x + 14, cx));
    const tipY = (y: number) => Math.min(y + h - 12, Math.max(y + 12, cy));
    // Closer than the usual gap only where nothing else fits.
    const tight = new Set<PlacedNote>();
    const spot = (box: Box, tip: Point): PlacedNote => {
      const s = { box, lines: words, tip };
      if (Math.max(box.y - tip.y, tip.y - box.y - box.height, box.x - tip.x, tip.x - box.x - box.width) < NOTE.gap) tight.add(s);
      return s;
    };
    const spots: PlacedNote[] = [
      ...reach('top').flatMap((d) => across.map((x) => spot({ x, y: target.y - d - h, width: w, height: h }, { x: tipX(x), y: target.y }))),
      ...reach('bottom').flatMap((d) => across.map((x) => spot({ x, y: target.y + target.height + d, width: w, height: h }, { x: tipX(x), y: target.y + target.height }))),
      ...reach('right').flatMap((d) => along.map((y) => spot({ x: target.x + target.width + d, y, width: w, height: h }, { x: target.x + target.width, y: tipY(y) }))),
      ...reach('left').flatMap((d) => along.map((y) => spot({ x: target.x - d - w, y, width: w, height: h }, { x: target.x, y: tipY(y) }))),
    ];
    const overflow = (b: Box) => Math.max(0, -b.x) + Math.max(0, -b.y) + Math.max(0, b.x + b.width - placed.width) + Math.max(0, b.y + b.height - placed.height);
    const cost = (s: PlacedNote) => {
      const reaching = noteStem(s);
      const covers = (b: Box) => hit(s.box, b) || (!!reaching && hit(reaching, b));
      // A frame the callout lies across (its line back to the element may cross one).
      const straddled = frames.filter((g) => hit(s.box, g) && !within(s.box, g) && !within(g, s.box)).length;
      const beyond = overflow(s.box);
      return (
        boxes.filter((b) => b !== target && covers(b)).length * 10 +
        out.filter((o) => covers(o.box) || (!!noteStem(o) && hit(s.box, noteStem(o)!))).length * 10 +
        labels.filter((b) => b !== target && covers(b)).length * 8 +
        straddled * 6 +
        names.filter((b) => hit(s.box, b)).length * 6 +
        lines.filter((l) => l.some((b) => hit(s.box, b))).length * 2 +
        (beyond > 0 ? 1 + beyond / 40 : 0) +
        (reaching ? 0.5 + Math.max(reaching.width, reaching.height) / 60 : 0) +
        (tight.has(s) ? 0.3 : 0)
      );
    };
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
  for (const s of view.room ?? view.states)
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
  const bubble = `<rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.width)}" height="${r1(b.height)}" rx="8" fill="${theme.text}" stroke="${theme.canvas}" stroke-width="2"/>`;
  const words = n.lines.map((l, i) => line(b.x + NOTE.padX, b.y + NOTE.padY + NOTE.row * i + NOTE.row / 2, l, NOTE.size, 500, theme.canvas)).join('');
  // Further out than the pointer reaches (past a frame): a line back to the element instead, ending in a dot on its edge.
  if (noteStem(n)) {
    const from = above || below ? { x: n.tip.x, y: above ? b.y + b.height : b.y } : { x: left ? b.x + b.width : b.x, y: n.tip.y };
    const d = `M${r1(from.x)} ${r1(from.y)}L${r1(n.tip.x)} ${r1(n.tip.y)}`;
    return `<path d="${d}" stroke="${theme.canvas}" stroke-width="4" fill="none"/><path d="${d}" stroke="${theme.text}" stroke-width="1.5" fill="none"/><circle cx="${r1(n.tip.x)}" cy="${r1(n.tip.y)}" r="3.5" fill="${theme.text}" stroke="${theme.canvas}" stroke-width="1.5"/>${bubble}${words}`;
  }
  const d =
    above || below
      ? `M${r1(cx - 6)} ${r1(above ? b.y + b.height : b.y)}L${r1(cx)} ${r1(above ? b.y + b.height + 7 : b.y - 7)}L${r1(cx + 6)} ${r1(above ? b.y + b.height : b.y)}Z`
      : `M${r1(left ? b.x + b.width : b.x)} ${r1(cy - 6)}L${r1(left ? b.x + b.width + 7 : b.x - 7)} ${r1(cy)}L${r1(left ? b.x + b.width : b.x)} ${r1(cy + 6)}Z`;
  return `${bubble}<path d="${d}" fill="${theme.text}"/>${words}`;
}
