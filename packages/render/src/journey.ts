// Journey shape: phases as columns, steps in them, and rows under the steps for what they touch,
// how it feels (a smooth curve through the scores), what they think, and pains, gains, ideas and
// metrics. The same data draws as a map, a storyboard (one large card per step), a service
// blueprint (rows split by the line of visibility) or a comparison of today with a future journey.
//
// Everything is first laid out as a list of plain marks (rectangles, text lines, paths, circles,
// icons) with their final colours. The SVG drawer below and the slide drawer in the export package
// both walk that list, so a slide gets the same picture as native, editable shapes.
import { esc } from './paint.ts';
import { journeyMood, type Box, type JourneyPersona, type JourneyPhase, type JourneyRow, type JourneyShape, type JourneyStep, type Tone } from '@cartography/core';
import { baselineOffset, fitText, measureText, type Theme } from '@cartography/theme';
import { icon } from '@cartography/icons';
import { quietTheme, wrap } from './steps.ts';
import { term, tr } from '@cartography/i18n/drawing';

type Weight = 400 | 500 | 600;
export type JourneySeg = ['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number] | ['Z'];

export type JourneyMark =
  | { t: 'rect'; x: number; y: number; w: number; h: number; r?: number; fill?: string; stroke?: string; sw?: number; dash?: boolean; shadow?: boolean; name?: string }
  | { t: 'text'; x: number; y: number; w: number; lines: string[]; size: number; weight: Weight; fill: string; align: 'l' | 'c' | 'r'; lh: number; tracking?: number; mono?: boolean }
  | { t: 'path'; d: JourneySeg[]; fill?: string; stroke?: string; sw?: number; dash?: boolean; name?: string }
  | { t: 'circle'; cx: number; cy: number; r: number; fill?: string; stroke?: string; sw?: number }
  | { t: 'icon'; name: string; x: number; y: number; size: number; color: string; sw: number };

export interface JourneyScene {
  width: number;
  height: number;
  marks: JourneyMark[];
  /** Where the parts that are nodes of their own are: steps, phases, the persona, linked touchpoints. */
  parts: Record<string, Box>;
}

/** Slide proportions to aim for: the drawing plus its title and margins should come close to 16:9. */
const ASPECT = 16 / 9;
const FRAME = { x: 80, y: 136 };

const S = { step: 12.5, body: 11.5, small: 11 };
const lh = (size: number) => Math.round(size * 1.4);

export const JOURNEY_ROWS: Record<JourneyRow, { label: string; icon: string; tone: Tone }> = {
  steps: { label: 'Doing', icon: 'route', tone: 'slate' },
  touchpoints: { label: 'Touchpoints', icon: 'mouse-pointer-2', tone: 'slate' },
  actors: { label: 'With', icon: 'users', tone: 'slate' },
  feeling: { label: 'Feeling', icon: 'heart', tone: 'slate' },
  thoughts: { label: 'Thinking', icon: 'message-square', tone: 'slate' },
  pains: { label: 'Pains', icon: 'triangle-exclamation-point', tone: 'rose' },
  gains: { label: 'Gains', icon: 'badge-check', tone: 'green' },
  ideas: { label: 'Opportunities', icon: 'sparkles', tone: 'amber' },
  metrics: { label: 'Metrics', icon: 'gauge', tone: 'slate' },
};

/** Good, neutral or bad: the colour of a face. The mouth and the place on the curve say the same without colour. */
export const journeyMoodTone = (mood: number): Tone => (mood > 0.25 ? 'green' : mood < -0.25 ? 'rose' : 'amber');

// ---------------------------------------------------------------- marks

class Pen {
  marks: JourneyMark[] = [];
  parts: Record<string, Box> = {};
  /** How round the look is: corner radii below are written for a card radius of 12 and follow the theme's. */
  private corner: number;

  constructor(theme?: Theme) {
    this.corner = theme ? Math.min(1.25, theme.radius.card / 12) : 1;
  }

  rect(x: number, y: number, w: number, h: number, o: { r?: number; fill?: string; stroke?: string; sw?: number; dash?: boolean; shadow?: boolean; name?: string } = {}) {
    this.marks.push({ t: 'rect', x, y, w: Math.max(0, w), h: Math.max(0, h), ...o, ...(o.r ? { r: Math.round(o.r * this.corner * 2) / 2 } : {}) });
  }
  /** Lines of text from the top of a box; returns its height. */
  text(x: number, y: number, w: number, lines: string[], size: number, weight: Weight, fill: string, align: 'l' | 'c' | 'r' = 'l', line = lh(size)): number {
    if (lines.length) this.marks.push({ t: 'text', x, y, w, lines, size, weight, fill, align, lh: line });
    return lines.length * line;
  }
  path(d: JourneySeg[], o: { fill?: string; stroke?: string; sw?: number; dash?: boolean; name?: string }) {
    if (d.length > 1) this.marks.push({ t: 'path', d, ...o });
  }
  line(x1: number, y1: number, x2: number, y2: number, stroke: string, sw = 1, dash = false) {
    this.path([['M', x1, y1], ['L', x2, y2]], { stroke, sw, dash });
  }
  circle(cx: number, cy: number, r: number, o: { fill?: string; stroke?: string; sw?: number }) {
    this.marks.push({ t: 'circle', cx, cy, r, ...o });
  }
  icon(name: string, x: number, y: number, size: number, color: string, sw = 1.75) {
    if (icon(name)) this.marks.push({ t: 'icon', name, x, y, size, color, sw });
  }
}

/** Text wrapped to a width and cut to a number of lines; the last line ends in an ellipsis when there was more. */
function clamp(text: string, size: number, weight: Weight, width: number, max: number): string[] {
  // A word too long for the line may break after a hyphen or a slash ("getting-" / "started").
  const loose = text
    .split(' ')
    .map((w) => (measureText(w, size, weight) > width ? w.replace(/([-/])(?=.)/g, '$1 ') : w))
    .join(' ');
  const all = wrap(loose, size, weight, width);
  const kept = all.length > max ? [...all.slice(0, max - 1), all.slice(max - 1).join(' ')] : all;
  return kept.map((l) => fitText(l, size, weight, width));
}

const widest = (lines: string[], size: number, weight: Weight) => Math.max(0, ...lines.map((l) => measureText(l, size, weight)));

/** "M9 43C9 35 15 31 24 31": absolute M, L, C and Z only. */
function segs(d: string): JourneySeg[] {
  const out: JourneySeg[] = [];
  for (const m of d.matchAll(/([MLCZ])([^MLCZ]*)/g)) {
    const n = m[2]!.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (m[1] === 'Z') out.push(['Z']);
    else if (m[1] === 'C') for (let i = 0; i + 5 < n.length; i += 6) out.push(['C', n[i]!, n[i + 1]!, n[i + 2]!, n[i + 3]!, n[i + 4]!, n[i + 5]!]);
    else for (let i = 0; i + 1 < n.length; i += 2) out.push([i === 0 && m[1] === 'M' ? 'M' : 'L', n[i]!, n[i + 1]!]);
  }
  return out;
}

const moved = (d: JourneySeg[], k: number, dx: number, dy: number): JourneySeg[] =>
  d.map((s) => (s[0] === 'Z' ? s : s[0] === 'C' ? ['C', s[1] * k + dx, s[2] * k + dy, s[3] * k + dx, s[4] * k + dy, s[5] * k + dx, s[6] * k + dy] : [s[0], s[1] * k + dx, s[2] * k + dy]));

// ---------------------------------------------------------------- avatars and faces

/** Line busts on a 48 grid: the same head and shoulders, told apart by hair and headwear only. */
const BUST = { head: [24, 18.5, 8] as const, shoulders: 'M9.5 42.5C10 35.5 15.5 31.5 24 31.5C32.5 31.5 38 35.5 38.5 42.5' };
const FRINGE = 'M16.4 16.4C19.5 16.2 22.3 14.6 23.8 12C25.6 14.8 28.6 16.3 31.6 16.4';
const AVATARS: Record<string, { paths: string[]; circles?: [number, number, number][] }> = {
  short: { paths: [FRINGE] },
  long: { paths: ['M14.5 29.5C14.8 25 14 22 14 18C14 11.5 18.5 7.5 24 7.5C29.5 7.5 34 11.5 34 18C34 22 33.2 25 33.5 29.5', 'M17 15.8C20 15.6 22.5 14.4 24 12.4C25.5 14.4 28 15.6 31 15.8'] },
  bun: { paths: [FRINGE], circles: [[24, 7.4, 3.1]] },
  curly: { paths: ['M15.6 17.5C13.2 16.5 13.2 13 15.8 12.4C15.4 9.6 18.6 8 20.6 9.4C21.8 7 26.2 7 27.4 9.4C29.4 8 32.6 9.6 32.2 12.4C34.8 13 34.8 16.5 32.4 17.5'] },
  bob: { paths: ['M15 25C14 22.5 14 20.5 14 18C14 11.5 18.5 7.5 24 7.5C29.5 7.5 34 11.5 34 18C34 20.5 34 22.5 33 25', 'M17.2 15.6L30.8 15.6'] },
  beard: { paths: [FRINGE, 'M17 21.5C17.3 27.6 20.4 29.8 24 29.8C27.6 29.8 30.7 27.6 31 21.5'] },
  headscarf: { paths: ['M12.5 33C14 29.5 14 25 14 19C14 12 18.5 7.5 24 7.5C29.5 7.5 34 12 34 19C34 25 34 29.5 35.5 33', 'M17.2 15.2C19.2 12.4 28.8 12.4 30.8 15.2'] },
  cap: { paths: ['M15.6 15.5C15.8 10.5 19.3 8 24 8C28.7 8 32.2 10.5 32.4 15.5', 'M14.5 15.5L37 15.5'] },
  glasses: { paths: [FRINGE, 'M23.2 19.2L24.8 19.2'], circles: [[20.7, 19.2, 2.5], [27.3, 19.2, 2.5]] },
};

export const journeyAvatarNames = Object.keys(AVATARS);

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]!.toUpperCase())
    .join('');

/** The persona in a circle: a built-in bust, or the initials. */
function avatar(pen: Pen, p: JourneyPersona, cx: number, cy: number, r: number, theme: Theme) {
  const tone = theme.tones[p.tone];
  pen.circle(cx, cy, r, { fill: tone.bg, stroke: tone.line, sw: 1 });
  const a = p.avatar ? AVATARS[p.avatar] : undefined;
  if (!a) {
    const size = Math.round(r * 0.78);
    pen.text(cx - r, cy - lh(size) / 2, 2 * r, [initials(p.name)], size, 600, tone.fg, 'c');
    return;
  }
  const k = r / 24;
  const sw = Math.max(1.2, 1.7 * k);
  const at = (d: string) => moved(segs(d), k, cx - r, cy - r);
  pen.path(at(BUST.shoulders), { stroke: tone.fg, sw });
  pen.circle(cx - r + BUST.head[0] * k, cy - r + BUST.head[1] * k, BUST.head[2] * k, { fill: tone.bg, stroke: tone.fg, sw });
  for (const d of a.paths) pen.path(at(d), { stroke: tone.fg, sw });
  for (const [x, y, cr] of a.circles ?? []) pen.circle(cx - r + x * k, cy - r + y * k, cr * k, { fill: tone.bg, stroke: tone.fg, sw });
}

/** A face whose mouth follows the mood (-1 sad … 1 happy), so the feeling reads without colour. */
function face(pen: Pen, cx: number, cy: number, r: number, mood: number, theme: Theme, o: { ring?: boolean; faint?: boolean } = {}) {
  const tone = theme.tones[journeyMoodTone(mood)];
  const ink = o.faint ? theme.textFaint : tone.fg;
  if (o.ring) pen.circle(cx, cy, r + 3.5, { stroke: ink, sw: 1.25 });
  pen.circle(cx, cy, r, { fill: o.faint ? theme.canvas : tone.bg, stroke: ink, sw: Math.max(1, r * 0.13) });
  const e = r * 0.12;
  pen.circle(cx - r * 0.34, cy - r * 0.2, e, { fill: ink });
  pen.circle(cx + r * 0.34, cy - r * 0.2, e, { fill: ink });
  // The mouth: a curve whose middle drops for a smile and rises for a frown.
  const mx = r * 0.42;
  const ends = cy + r * 0.34 - mood * r * 0.13;
  const mid = cy + r * 0.34 + mood * r * 0.36;
  pen.path([['M', cx - mx, ends], ['C', cx - mx * 0.45, mid, cx + mx * 0.45, mid, cx + mx, ends]], { stroke: ink, sw: Math.max(1, r * 0.13) });
}

// ---------------------------------------------------------------- the feeling curve

interface CurvePoint {
  x: number;
  y: number;
  step: JourneyStep;
  index: number;
  mood: number;
}

/** Bezier pieces of a smooth curve through the points that never overshoots them (monotone cubic). */
function smooth(pts: { x: number; y: number }[]): [number, number, number, number, number, number, number, number][] {
  const n = pts.length;
  if (n < 2) return [];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1]!.y - pts[i]!.y) / (pts[i + 1]!.x - pts[i]!.x));
  const m: number[] = [d[0]!];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2);
  m.push(d[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / d[i]!;
    const b = m[i + 1]! / d[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i]!;
      m[i + 1] = t * b * d[i]!;
    }
  }
  const out: [number, number, number, number, number, number, number, number][] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = (pts[i + 1]!.x - pts[i]!.x) / 3;
    out.push([pts[i]!.x, pts[i]!.y, pts[i]!.x + h, pts[i]!.y + m[i]! * h, pts[i + 1]!.x - h, pts[i + 1]!.y - m[i + 1]! * h, pts[i + 1]!.x, pts[i + 1]!.y]);
  }
  return out;
}

type Bezier = [number, number, number, number, number, number, number, number];

/** Splits a bezier at t (de Casteljau). */
function split(b: Bezier, t: number): [Bezier, Bezier] {
  const mix = (a: number, c: number) => a + (c - a) * t;
  const [x0, y0, x1, y1, x2, y2, x3, y3] = b;
  const ax = mix(x0, x1), ay = mix(y0, y1), bx = mix(x1, x2), by = mix(y1, y2), cx = mix(x2, x3), cy = mix(y2, y3);
  const dx = mix(ax, bx), dy = mix(ay, by), ex = mix(bx, cx), ey = mix(by, cy);
  const fx = mix(dx, ex), fy = mix(dy, ey);
  return [[x0, y0, ax, ay, dx, dy, fx, fy], [fx, fy, ex, ey, cx, cy, x3, y3]];
}

const yAt = (b: Bezier, t: number) => {
  const u = 1 - t;
  return u * u * u * b[1] + 3 * u * u * t * b[3] + 3 * u * t * t * b[5] + t * t * t * b[7];
};

/** The curve cut where it crosses the baseline, so every piece lies wholly above or below it. */
function sides(curve: Bezier[], base: number): { above: boolean; pieces: Bezier[] }[] {
  const cut: Bezier[] = [];
  for (const b of curve) {
    const a = b[1] - base;
    const c = b[7] - base;
    if (a * c < 0) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 30; i++) {
        const t = (lo + hi) / 2;
        if ((yAt(b, t) - base) * a > 0) lo = t;
        else hi = t;
      }
      cut.push(...split(b, (lo + hi) / 2));
    } else cut.push(b);
  }
  const runs: { above: boolean; pieces: Bezier[] }[] = [];
  for (const b of cut) {
    const mid = yAt(b, 0.5);
    if (Math.abs(mid - base) < 0.01 && Math.abs(b[1] - base) < 0.01 && Math.abs(b[7] - base) < 0.01) continue;
    const above = mid < base;
    const last = runs.at(-1);
    if (last && last.above === above) last.pieces.push(b);
    else runs.push({ above, pieces: [b] });
  }
  return runs;
}

const CHART = { top: 36, plot: 84, bottom: 34, face: 11 };

interface ChartOptions {
  x0: number;
  x1: number;
  y: number;
  /** Points up to this index are drawn (presenting); all when absent. */
  upto?: number;
  /** Themes per point: the one in focus at full strength. */
  themeAt: (index: number) => Theme;
  theme: Theme;
  words: boolean;
  tints: boolean;
  line: { color: string; width: number; dash?: boolean };
  faceR: number;
}

/** One feeling curve: tints above and below neutral, the line, a face per point, the lowest and highest called out. */
function curve(pen: Pen, shape: JourneyShape, points: CurvePoint[], o: ChartOptions) {
  const t = o.theme;
  const shown = o.upto == null ? points : points.filter((p) => p.index <= o.upto!);
  const base = o.y + CHART.top + CHART.plot / 2;
  const beziers = smooth(shown);
  if (o.tints)
    for (const run of sides(beziers, base)) {
      const first = run.pieces[0]!;
      const last = run.pieces.at(-1)!;
      const d: JourneySeg[] = [['M', first[0], base], ['L', first[0], first[1]]];
      for (const b of run.pieces) d.push(['C', b[2], b[3], b[4], b[5], b[6], b[7]]);
      d.push(['L', last[6], base], ['Z']);
      pen.path(d, { fill: t.tones[run.above ? 'green' : 'rose'].bg, name: run.above ? 'Above neutral' : 'Below neutral' });
    }
  if (beziers.length) {
    const d: JourneySeg[] = [['M', beziers[0]![0], beziers[0]![1]]];
    for (const b of beziers) d.push(['C', b[2], b[3], b[4], b[5], b[6], b[7]]);
    pen.path(d, { stroke: o.line.color, sw: o.line.width, dash: o.line.dash, name: 'Feeling' });
  }
  // The lowest and the highest point get a ring and a marked label, when there is a real difference.
  const scores = points.map((p) => p.step.score!);
  const spread = points.length >= 3 && Math.max(...scores) > Math.min(...scores);
  const low = spread ? points.find((p) => p.step.score === Math.min(...scores)) : undefined;
  const high = spread ? points.find((p) => p.step.score === Math.max(...scores)) : undefined;
  for (const [i, p] of shown.entries()) {
    const theme = o.themeAt(p.index);
    const extreme = p === low || p === high;
    face(pen, p.x, p.y, o.faceR, p.mood, theme, { ring: extreme });
    if (!o.words) continue;
    const word = p.step.feeling ?? (p === low ? term(t.lang, 'Low point') : p === high ? term(t.lang, 'High point') : undefined);
    if (!word) continue;
    const tone = theme.tones[journeyMoodTone(p.mood)];
    // Labels go on the outside of the curve: above a peak, below a dip.
    const before = shown[i - 1]?.y ?? p.y;
    const after = shown[i + 1]?.y ?? p.y;
    const peak = p.y <= before && p.y <= after;
    const dip = p.y >= before && p.y >= after;
    const above = peak && dip ? p.mood >= 0 : peak ? true : dip ? false : p.mood >= 0;
    const size = S.small;
    const mark = extreme ? 11 : 0;
    const room = Math.max(40, (shown[i + 1] ? shown[i + 1]!.x - p.x : p.x - (shown[i - 1]?.x ?? o.x0)) - 10);
    const label = fitText(word, size, 600, room - mark - (extreme ? 16 : 0));
    const w = measureText(label, size, 600) + mark + (extreme ? 16 : 0);
    const h = extreme ? 18 : 14;
    const gap = o.faceR + (extreme ? 8 : 5);
    // Not on the dashed neutral line, where the words would read as struck through: the other side
    // of the face, or else just clear of the line.
    const at = (up: boolean) => (up ? p.y - gap - h / 2 : p.y + gap + h / 2);
    const struck = (c: number) => Math.abs(c - base) < h / 2 + 2;
    let cy = at(above);
    if (struck(cy)) cy = !struck(at(!above)) ? at(!above) : above ? Math.min(cy, base - h / 2 - 3) : Math.max(cy, base + h / 2 + 3);
    const x = Math.min(o.x1 - w, Math.max(o.x0, p.x - w / 2));
    if (extreme) {
      pen.rect(x, cy - h / 2, w, h, { r: h / 2, fill: tone.bg, name: p === low ? 'Lowest point' : 'Highest point' });
      // A small triangle says low or high without colour.
      const tx = x + 8 + 3.5;
      const up = p === high;
      pen.path([['M', tx - 3.5, cy + (up ? 2.5 : -2.5)], ['L', tx + 3.5, cy + (up ? 2.5 : -2.5)], ['L', tx, cy + (up ? -3 : 3)], ['Z']], { fill: tone.fg });
      pen.text(x + 8 + mark, cy - lh(size) / 2, w - 16 - mark, [label], size, 600, tone.fg);
    } else pen.text(x, cy - lh(size) / 2, w, [label], size, 600, tone.fg, 'c');
  }
}

/** The neutral line and the small faces that name the ends of the scale. */
function chartFrame(pen: Pen, x0: number, x1: number, y: number, theme: Theme, axisX: number) {
  const base = y + CHART.top + CHART.plot / 2;
  pen.line(x0, base, x1, base, theme.textFaint, 1, true);
  face(pen, axisX, y + CHART.top, 6, 1, theme, { faint: true });
  face(pen, axisX, y + CHART.top + CHART.plot, 6, -1, theme, { faint: true });
}

const chartHeight = CHART.top + CHART.plot + CHART.bottom;

const scoreY = (shape: JourneyShape, score: number, y: number) => y + CHART.top + (1 - (score - shape.scale.min) / Math.max(1e-9, shape.scale.max - shape.scale.min)) * CHART.plot;

// ---------------------------------------------------------------- shared pieces

interface Col {
  step: JourneyStep;
  /** Its number in the journey, from 0. */
  index: number;
  x: number;
  w: number;
  phase: number;
}

interface PhaseBox {
  phase: JourneyPhase;
  x: number;
  w: number;
}

const PHASE = { height: 30, tip: 9, gap: 14 };

/** Columns for the steps of one journey, phase by phase; empty phases take no room. */
function columns(shape: JourneyShape, steps: JourneyStep[], x0: number, colW: number): { cols: Col[]; phases: PhaseBox[]; right: number } {
  const cols: Col[] = [];
  const phases: PhaseBox[] = [];
  let x = x0;
  for (const [pi, phase] of shape.phases.entries()) {
    const mine = steps.filter((s) => s.phase === phase.id);
    if (!mine.length) continue;
    if (phases.length) x += PHASE.gap;
    phases.push({ phase, x, w: mine.length * colW });
    for (const step of mine) {
      cols.push({ step, index: steps.indexOf(step), x, w: colW, phase: pi });
      x += colW;
    }
  }
  return { cols, phases, right: x };
}

/** The phases as a row of arrows: the journey reads left to right. */
function phaseRow(pen: Pen, shape: JourneyShape, phases: PhaseBox[], y: number, themeOf: (p: JourneyPhase) => Theme) {
  for (const [i, b] of phases.entries()) {
    const tone = themeOf(b.phase).tones[b.phase.tone];
    const { height: h, tip } = PHASE;
    const d: JourneySeg[] = [['M', b.x, y], ['L', b.x + b.w - tip, y], ['L', b.x + b.w, y + h / 2], ['L', b.x + b.w - tip, y + h], ['L', b.x, y + h]];
    if (i) d.push(['L', b.x + tip, y + h / 2]);
    d.push(['Z']);
    pen.path(d, { fill: tone.bg, stroke: tone.bg, sw: 3, name: `Phase: ${b.phase.label}` });
    const room = b.w - 2 * tip - 16;
    const label = fitText(b.phase.label, S.step, 600, room);
    const rest = room - measureText(label, S.step, 600) - 10;
    const caption = b.phase.caption && rest > 40 ? fitText(b.phase.caption, S.small, 400, rest) : '';
    const w = measureText(label, S.step, 600) + (caption ? 8 + measureText(caption, S.small, 400) : 0);
    const x = b.x + (b.w + (i ? tip : 0) - tip) / 2 - w / 2 + (i ? 0 : 0);
    pen.text(x, y + h / 2 - lh(S.step) / 2, measureText(label, S.step, 600) + 2, [label], S.step, 600, tone.fg);
    if (caption) pen.text(x + measureText(label, S.step, 600) + 8, y + h / 2 - lh(S.small) / 2 + 0.5, measureText(caption, S.small, 400) + 2, [caption], S.small, 400, tone.fg);
    if (b.phase.path) pen.parts[`phase:${b.phase.id}`] = { x: b.x, y, width: b.w, height: h };
  }
}

interface Kpi {
  label: string;
  value: string;
  /** Comparing: the value today, struck by the future one. */
  was?: string;
}

const PERSONA = { avatar: 56, gap: 14 };

/** Who the journey is about: avatar, name, role and goal, what they say, and the numbers of the whole journey. */
function personaBand(pen: Pen, shape: JourneyShape, x: number, y: number, width: number, theme: Theme, kpis: Kpi[]): number {
  const p = shape.persona;
  if (!p && !kpis.length) return 0;
  // Numbers on the right, as large values over small names.
  const tiles = kpis.slice(0, 4).map((k) => {
    const value = k.value;
    const was = k.was && k.was !== k.value ? k.was : undefined;
    const w = Math.max(measureText(value, 17, 600) + (was ? measureText(was, S.body, 400) + 22 : 0), measureText(k.label, S.small, 500));
    return { ...k, was, w: Math.min(w, 220) };
  });
  const tilesW = tiles.reduce((w, t) => w + t.w, 0) + Math.max(0, tiles.length - 1) * 28;
  let left = 0;
  let h = 0;
  if (p) {
    const r = PERSONA.avatar / 2;
    avatar(pen, p, x + r, y + r, r, theme);
    const tx = x + PERSONA.avatar + PERSONA.gap;
    const room = Math.max(160, Math.min(340, width * 0.36));
    const name = fitText(p.name, 15, 600, room);
    const role = p.role ? clamp(p.role, 12, 400, room, 1) : [];
    const goal = p.goal ? clamp(p.goal, S.body, 400, room - 34, 2) : [];
    const block = 20 + (role.length ? 17 : 0) + (goal.length ? 5 + goal.length * 16 : 0);
    let ty = y + Math.max(0, (PERSONA.avatar - block) / 2);
    pen.text(tx, ty, room, [name], 15, 600, theme.text, 'l', 20);
    ty += 20;
    if (role.length) ty += pen.text(tx, ty, room, role, 12, 400, theme.textMuted, 'l', 17);
    if (goal.length) {
      ty += 5;
      pen.text(tx, ty, 32, [term(theme.lang, 'Goal')], S.small, 600, theme.textFaint, 'l', 16);
      pen.text(tx + 34, ty, room - 34, goal, S.body, 400, theme.textMuted, 'l', 16);
    }
    const textW = Math.max(measureText(name, 15, 600), widest(role, 12, 400), goal.length ? 34 + widest(goal, S.body, 400) : 0);
    left = PERSONA.avatar + PERSONA.gap + textW;
    h = Math.max(PERSONA.avatar, block);
    pen.parts.persona = { x, y, width: left, height: h };
    // What they say, in a speech bubble pointing back at them.
    const qx = x + left + 30;
    const below = width - left - 30 - (tilesW ? tilesW + 32 : 0) < 200;
    const qw = Math.min(380, below ? width - left - 30 : width - left - 30 - (tilesW ? tilesW + 32 : 0));
    if (p.quote && qw >= 160) {
      const lines = clamp(`“${p.quote}”`, 12.5, 400, qw - 28, 3);
      const bw = widest(lines, 12.5, 400) + 28;
      const bh = lines.length * 18 + 18;
      const by = y + Math.max(0, (h - bh) / 2);
      bubble(pen, qx, by, bw, bh, theme, { side: 'left', at: by + bh / 2, kind: 'says' });
      pen.text(qx + 14, by + 9, bw - 28, lines, 12.5, 400, theme.text, 'l', 18);
      h = Math.max(h, bh);
    }
    if (tiles.length && below) {
      // No room beside the quote: the numbers get a row of their own.
      const ky = y + h + 14;
      let kx = x + PERSONA.avatar + PERSONA.gap;
      for (const t of tiles) kx += kpi(pen, t, kx, ky, theme) + 28;
      return h + 14 + 40;
    }
  }
  if (tiles.length) {
    let kx = x + width - tilesW;
    const ky = y + Math.max(0, (Math.max(h, 40) - 40) / 2);
    for (const t of tiles) kx += kpi(pen, t, kx, ky, theme) + 28;
    h = Math.max(h, 40);
  }
  return h;
}

function kpi(pen: Pen, k: Kpi & { w: number }, x: number, y: number, theme: Theme): number {
  let vx = x;
  if (k.was) {
    const was = fitText(k.was, S.body, 400, 90);
    const ww = measureText(was, S.body, 400);
    pen.text(vx, y + 5, ww + 2, [was], S.body, 400, theme.textFaint, 'l', 16);
    pen.line(vx, y + 13, vx + ww, y + 13, theme.textFaint, 1);
    pen.path([['M', vx + ww + 6, y + 13], ['L', vx + ww + 14, y + 13]], { stroke: theme.textFaint, sw: 1.25 });
    pen.path([['M', vx + ww + 11, y + 10], ['L', vx + ww + 14, y + 13], ['L', vx + ww + 11, y + 16]], { stroke: theme.textFaint, sw: 1.25 });
    vx += ww + 22;
  }
  pen.text(vx, y, k.w, [fitText(k.value, 17, 600, k.w - (vx - x))], 17, 600, theme.text, 'l', 24);
  pen.text(x, y + 25, k.w, [fitText(k.label, S.small, 500, k.w)], S.small, 500, theme.textMuted, 'l', 15);
  return k.w;
}

/** A speech bubble (a pointer) or a thought bubble (two small circles) towards whoever says it. */
function bubble(pen: Pen, x: number, y: number, w: number, h: number, theme: Theme, tail: { side: 'top' | 'left'; at: number; kind: 'says' | 'thought' }) {
  pen.rect(x, y, w, h, { r: 10, fill: theme.surface, stroke: theme.border, sw: 1, name: tail.kind === 'says' ? 'Says' : 'Thinks' });
  if (tail.kind === 'thought') {
    if (tail.side === 'top') {
      pen.circle(tail.at - 1, y - 5, 3, { fill: theme.surface, stroke: theme.border, sw: 1 });
      pen.circle(tail.at + 3, y - 11.5, 1.8, { fill: theme.surface, stroke: theme.border, sw: 1 });
    } else {
      pen.circle(x - 5, tail.at + 1, 3, { fill: theme.surface, stroke: theme.border, sw: 1 });
      pen.circle(x - 11.5, tail.at + 4, 1.8, { fill: theme.surface, stroke: theme.border, sw: 1 });
    }
    return;
  }
  // The pointer: filled over the bubble's edge so the two read as one outline.
  if (tail.side === 'top') {
    const c = Math.min(x + w - 16, Math.max(x + 16, tail.at));
    pen.path([['M', c - 6.5, y + 1], ['L', c, y - 7], ['L', c + 6.5, y + 1], ['Z']], { fill: theme.surface });
    pen.path([['M', c - 6.5, y], ['L', c, y - 7], ['L', c + 6.5, y]], { stroke: theme.border, sw: 1 });
  } else {
    const c = Math.min(y + h - 14, Math.max(y + 14, tail.at));
    pen.path([['M', x + 1, c - 6], ['L', x - 7, c], ['L', x + 1, c + 6], ['Z']], { fill: theme.surface });
    pen.path([['M', x, c - 6], ['L', x - 7, c], ['L', x, c + 6]], { stroke: theme.border, sw: 1 });
  }
}

/** A number in a filled circle: the step's place in the journey. */
function badge(pen: Pen, cx: number, cy: number, n: number, tone: { fg: string; bg: string }) {
  pen.circle(cx, cy, 9, { fill: tone.bg });
  pen.text(cx - 9, cy - lh(S.small) / 2, 18, [String(n)], S.small, 600, tone.fg, 'c');
}

/** The small round sign in front of a pain (minus) or a gain (plus). */
function sign(pen: Pen, x: number, cy: number, plus: boolean, color: string) {
  pen.circle(x + 5.5, cy, 5.5, { stroke: color, sw: 1.3 });
  pen.line(x + 3, cy, x + 8, cy, color, 1.3);
  if (plus) pen.line(x + 5.5, cy - 2.5, x + 5.5, cy + 2.5, color, 1.3);
}

/** "Time to access: 6 days" → the value large under its name. */
const metricParts = (m: string) => {
  const i = m.lastIndexOf(': ');
  return i > 0 ? { label: m.slice(0, i), value: m.slice(i + 2) } : { label: '', value: m };
};

function rowLabel(pen: Pen, shape: JourneyShape, row: JourneyRow, y: number, theme: Theme, width: number, label?: string) {
  const r = JOURNEY_ROWS[row];
  const tone = theme.tones[r.tone];
  pen.icon(r.icon, 0, y + 1, 13, tone.fg, 1.75);
  pen.text(19, y, width - 19, [fitText(label ?? shape.rowLabels?.[row] ?? term(theme.lang, r.label), S.body, 600, width - 19)], S.body, 600, theme.textMuted, 'l', 15);
}

const gutterFor = (shape: JourneyShape, labels: string[]) => Math.ceil(Math.max(64, ...labels.map((l) => measureText(l, S.body, 600) + 19))) + 18;

/** A step as a card: its number, what they do, and who is with them. */
function stepCard(pen: Pen, step: JourneyStep, n: number, x: number, y: number, w: number, h: number, lines: string[], theme: Theme, tone: Tone, o: { focus?: boolean; actors?: string; id?: string } = {}) {
  const c = theme.tones[tone];
  pen.rect(x, y, w, h, { r: 10, fill: theme.surface, stroke: o.focus ? c.fg : theme.border, sw: o.focus ? 1.5 : 1, shadow: true, name: step.label });
  badge(pen, x + 10 + 9, y + 10 + 9, n, c);
  pen.text(x + 10 + 18 + 7, y + 10 + (18 - lh(S.step)) / 2, w - 45 - (step.linked ? 14 : 0), lines, S.step, 600, theme.text);
  if (o.actors) {
    const ay = y + h - 10 - 14;
    pen.icon('users', x + 12, ay + 1.5, 11, theme.textFaint, 1.75);
    pen.text(x + 27, ay, w - 37, [fitText(o.actors, S.small, 400, w - 37)], S.small, 400, theme.textMuted, 'l', 14);
  }
  pen.parts[o.id ?? step.id] = { x, y, width: w, height: h };
}

const stepLines = (step: JourneyStep, w: number, max = 3) => clamp(step.label, S.step, 600, w - 45 - (step.linked ? 14 : 0), max);

const TOUCH = { tile: 20, gap: 6 };

/** Touchpoints of one step, stacked: icon tile and name. Returns the height used. */
function touchpoints(pen: Pen, step: JourneyStep, x: number, y: number, w: number, theme: Theme, tone: Tone, max = 3, id = step.id): number {
  const c = theme.tones[tone];
  let ty = y;
  const shown = step.touchpoints.slice(0, max);
  for (const [i, tp] of shown.entries()) {
    const room = w - TOUCH.tile - 7 - (tp.linked ? 24 : 0);
    const lines = clamp(tp.label, S.body, 500, room, 2);
    const h = Math.max(TOUCH.tile, lines.length * 15);
    pen.rect(x, ty + (h - TOUCH.tile) / 2, TOUCH.tile, TOUCH.tile, { r: 6, fill: c.bg, name: tp.label });
    pen.icon(tp.icon, x + 4, ty + (h - TOUCH.tile) / 2 + 4, 12, c.fg, 1.75);
    pen.text(x + TOUCH.tile + 7, ty + (h - lines.length * 15) / 2, room, lines, S.body, 500, theme.textMuted, 'l', 15);
    if (tp.linked) pen.parts[`${id}@${i}`] = { x: x - 2, y: ty - 2, width: w + 4, height: h + 4 };
    ty += h + TOUCH.gap;
  }
  if (step.touchpoints.length > max) ty += pen.text(x + TOUCH.tile + 7, ty, w, [`+${step.touchpoints.length - max} more`], S.small, 400, theme.textFaint) + TOUCH.gap;
  return shown.length ? ty - y - TOUCH.gap : 0;
}

const touchHeight = (step: JourneyStep, w: number, max = 3) => {
  const pen = new Pen();
  // Colours do not matter for measuring.
  return touchpoints(pen, step, 0, 0, w, MEASURE, 'slate', max);
};
let MEASURE: Theme;

interface ListItem {
  lines: string[];
  label?: string;
}

const LIST = { pad: 10, mark: 17, gap: 6, line: 16 };

/** The items of a list cell, wrapped; more than `max` end in "+n more". */
function listItems(items: string[], row: JourneyRow, w: number, max = 3): ListItem[] {
  const room = w - (row === 'metrics' ? 0 : LIST.mark);
  const out: ListItem[] = items.slice(0, max).map((s) => {
    if (row !== 'metrics') return { lines: clamp(s, S.body, 400, room, 3) };
    const m = metricParts(s);
    return { label: m.label ? fitText(m.label, S.small, 400, room) : undefined, lines: clamp(m.value, S.step, 600, room, 2) };
  });
  if (items.length > max) out.push({ lines: [`+${items.length - max} more`] });
  return out;
}

const listHeight = (items: ListItem[], row: JourneyRow) =>
  items.reduce((h, it, i) => h + (i ? LIST.gap : 0) + (it.label ? 14 : 0) + it.lines.length * (row === 'metrics' ? 17 : LIST.line), 0);

function drawList(pen: Pen, items: ListItem[], total: number, row: JourneyRow, x: number, y: number, w: number, theme: Theme) {
  const tone = theme.tones[JOURNEY_ROWS[row].tone];
  let ty = y;
  for (const [i, it] of items.entries()) {
    const more = i >= 3 && total > 3;
    if (row === 'metrics') {
      if (it.label) ty += pen.text(x, ty, w, [it.label], S.small, 400, theme.textMuted, 'l', 14);
      ty += pen.text(x, ty, w, it.lines, more ? S.small : S.step, more ? 400 : 600, more ? theme.textFaint : theme.text, 'l', 17);
    } else {
      if (more) ty += pen.text(x + LIST.mark, ty, w - LIST.mark, it.lines, S.small, 400, theme.textFaint, 'l', LIST.line);
      else {
        if (row === 'ideas') pen.icon('sparkles', x - 0.5, ty + 2, 12, tone.fg, 1.75);
        else sign(pen, x, ty + LIST.line / 2, row === 'gains', tone.fg);
        ty += pen.text(x + LIST.mark, ty, w - LIST.mark, it.lines, S.body, 400, theme.text, 'l', LIST.line);
      }
    }
    ty += LIST.gap;
  }
}

// ---------------------------------------------------------------- map

const MAP = { rowGap: 16, cardGap: 8, min: 132, max: 232, bubblePad: 9 };

function mapScene(shape: JourneyShape, full: Theme, colW: number, step?: number): JourneyScene {
  const pen = new Pen(full);
  const quiet = step ? quietTheme(full) : full;
  const themeAt = (i: number) => (!step || i === step - 1 ? full : quiet);
  const rows = shape.rows;
  // The feeling row's label stands left of the faces on the scale, so it has less room: count it as a few letters longer.
  const labels = rows.map((r) => (shape.rowLabels?.[r] ?? term(full.lang, JOURNEY_ROWS[r].label)) + (r === 'feeling' ? 'mm' : ''));
  const actors = [...new Set(shape.steps.flatMap((s) => s.actors))].slice(0, 6);
  const gutter = gutterFor(shape, rows.includes('actors') ? [...labels, ...actors.map((a) => a.slice(0, 16))] : labels);
  const { cols, phases, right } = columns(shape, shape.steps, gutter, colW);
  const width = Math.max(right, 560);
  const current = step ? cols.find((c) => c.index === step - 1) : undefined;
  // A stage's cell holds each of its steps' items under that step: it is lit with the step in focus only
  // where it is that step's alone, never half lit across a step that stands back.
  const phaseTheme = (p: JourneyPhase) => (!current || (shape.phases[current.phase] === p && cols.filter((c) => shape.phases[c.phase] === p).length === 1) ? full : quiet);
  const toneOf = (c: Col) => shape.phases[c.phase]!.tone;

  let y = 0;
  const band = personaBand(pen, shape, 0, y, width, full, shape.metrics);
  if (band) y += band + 22;
  const named = phases.some((p) => p.phase.label);
  const top = y;
  if (named) {
    phaseRow(pen, shape, phases, y, phaseTheme);
    y += PHASE.height + 12;
  }
  const inner = colW - MAP.cardGap;
  const showActors = !rows.includes('actors');

  for (const row of rows) {
    if (row === 'steps') {
      const lines = cols.map((c) => stepLines(c.step, inner));
      const withActors = showActors && cols.some((c) => c.step.actors.length);
      const h = 20 + Math.max(18, ...lines.map((l) => l.length * lh(S.step))) + (withActors ? 20 : 0);
      rowLabel(pen, shape, row, y + 12, full, gutter - 14);
      for (const [i, c] of cols.entries())
        stepCard(pen, c.step, c.index + 1, c.x + MAP.cardGap / 2, y, inner, h, lines[i]!, themeAt(c.index), toneOf(c), { focus: !!step && c === current, actors: showActors && c.step.actors.length ? c.step.actors.join(', ') : undefined });
      y += h + MAP.rowGap;
    } else if (row === 'touchpoints') {
      const h = Math.max(...cols.map((c) => touchHeight(c.step, inner - 12)));
      rowLabel(pen, shape, row, y + 3, full, gutter - 14);
      for (const c of cols) touchpoints(pen, c.step, c.x + MAP.cardGap / 2 + 6, y, inner - 12, themeAt(c.index), toneOf(c));
      y += h + MAP.rowGap;
    } else if (row === 'actors') {
      rowLabel(pen, shape, row, y, full, gutter - 14);
      let ay = y + 22;
      for (const a of actors) {
        const on = cols.filter((c) => c.step.actors.includes(a));
        pen.text(19, ay - 7, gutter - 33, [fitText(a, S.small, 400, gutter - 33)], S.small, 400, full.textMuted, 'l', 14);
        pen.line(gutter + 6, ay, right - 6, ay, full.border, 1);
        if (on.length > 1) pen.line(on[0]!.x + colW / 2, ay, on.at(-1)!.x + colW / 2, ay, quiet === full ? full.tones.slate.fg : quiet.tones.slate.fg, 1.5);
        for (const c of on) pen.circle(c.x + colW / 2, ay, 4.5, { fill: themeAt(c.index).tones[toneOf(c)].fg, stroke: full.canvas, sw: 1.5 });
        ay += 20;
      }
      y = ay - 20 + 12 + MAP.rowGap;
    } else if (row === 'feeling') {
      rowLabel(pen, shape, row, y + chartHeight / 2 - 7, full, gutter - 30);
      chartFrame(pen, gutter, right, y, full, gutter - 12);
      const pts: CurvePoint[] = cols.filter((c) => c.step.score != null).map((c) => ({ x: c.x + colW / 2, y: scoreY(shape, c.step.score!, y), step: c.step, index: c.index, mood: journeyMood(c.step.score!, shape.scale) }));
      curve(pen, shape, pts, { x0: gutter, x1: right, y, upto: step ? step - 1 : undefined, themeAt, theme: full, words: true, tints: true, line: { color: full.tones.slate.fg, width: 2.25 }, faceR: CHART.face });
      y += chartHeight + (rows[rows.indexOf(row) + 1] === 'thoughts' ? 6 : MAP.rowGap);
    } else if (row === 'thoughts') {
      const said = cols.map((c) => {
        const text = c.step.thought ?? c.step.says;
        return text ? clamp(`“${text}”`, S.body, 400, inner - 2 * MAP.bubblePad - 2, 5) : [];
      });
      const h = Math.max(...said.map((l) => (l.length ? l.length * 16 + 2 * MAP.bubblePad : 0)));
      const by = y + 12;
      rowLabel(pen, shape, row, by + MAP.bubblePad, full, gutter - 14);
      for (const [i, c] of cols.entries()) {
        if (!said[i]!.length) continue;
        const t = themeAt(c.index);
        const bh = said[i]!.length * 16 + 2 * MAP.bubblePad;
        bubble(pen, c.x + MAP.cardGap / 2, by, inner, bh, t, { side: 'top', at: c.x + colW / 2, kind: c.step.thought ? 'thought' : 'says' });
        pen.text(c.x + MAP.cardGap / 2 + MAP.bubblePad + 1, by + MAP.bubblePad, inner - 2 * MAP.bubblePad - 2, said[i]!, S.body, 400, t.text, 'l', 16);
      }
      y = by + h + MAP.rowGap;
    } else {
      const key = row as 'pains' | 'gains' | 'ideas' | 'metrics';
      const room = inner - 2 * LIST.pad + 4;
      const items = cols.map((c) => listItems(c.step[key], row, room));
      const h = Math.max(...items.map((it) => listHeight(it, row))) + 2 * LIST.pad;
      rowLabel(pen, shape, row, y + LIST.pad, full, gutter - 14);
      for (const b of phases) {
        const t = phaseTheme(b.phase);
        pen.rect(b.x, y, b.w, h, { r: 10, fill: t.tones[JOURNEY_ROWS[row].tone].wash, name: `${JOURNEY_ROWS[row].label}: ${b.phase.label}` });
      }
      for (const [i, c] of cols.entries()) drawList(pen, items[i]!, c.step[key].length, row, c.x + MAP.cardGap / 2 + LIST.pad - 2, y + LIST.pad, room, themeAt(c.index));
      y += h + 8;
    }
  }
  const bottom = y - (['pains', 'gains', 'ideas', 'metrics'].includes(rows.at(-1) ?? '') ? 8 : MAP.rowGap);
  // Presenting: an outline around the column in focus, over everything.
  if (current) pen.rect(current.x, (named ? top + PHASE.height + 12 : top) - 5, colW, bottom - (named ? top + PHASE.height + 12 : top) + 10, { r: 14, stroke: full.tones[toneOf(current)].fg, sw: 1.5, name: 'In focus' });
  return { width, height: Math.max(bottom, 40), marks: pen.marks, parts: pen.parts };
}

// ---------------------------------------------------------------- storyboard

const BOARD = { card: 256, widest: 448, gap: 30, rowGap: 22, pad: 14 };

/** `option`: cards per row and the card width, as perRow * 1000 + width (see `fit`). */
function storyboardScene(shape: JourneyShape, full: Theme, option: number, step?: number): JourneyScene {
  const perRow = Math.max(1, Math.floor(option / 1000));
  const pen = new Pen(full);
  const quiet = step ? quietTheme(full) : full;
  const themeAt = (i: number) => (!step || i === step - 1 ? full : quiet);
  const steps = shape.steps;
  const w = option % 1000 || BOARD.card;
  const inner = w - 2 * BOARD.pad;
  const phase = new Map(shape.phases.map((p) => [p.id, p]));
  const who = shape.persona;
  const bubbleX = who ? 52 : 0;
  // Every card has the same regions at the same height, so a row of cards reads as a strip.
  const title = steps.map((s) => clamp(s.label, 14, 600, inner, 2));
  const said = steps.map((s) => {
    const text = s.thought ?? s.says;
    return text ? clamp(`“${text}”`, 12, 400, inner - bubbleX - 22, 5) : [];
  });
  const notes = steps.map((s) => {
    const room = inner - LIST.mark;
    return [
      ...(s.pains[0] ? [{ row: 'pains' as const, lines: clamp(s.pains[0], S.body, 400, room, 2) }] : []),
      ...(s.gains[0] ? [{ row: 'gains' as const, lines: clamp(s.gains[0], S.body, 400, room, 2) }] : []),
      ...(s.ideas[0] ? [{ row: 'ideas' as const, lines: clamp(s.ideas[0], S.body, 400, room, 2) }] : []),
      ...(s.metrics[0] ? [{ row: 'metrics' as const, lines: clamp(s.metrics[0], S.body, 600, room, 1) }] : []),
    ];
  });
  const titleH = Math.max(...title.map((l) => l.length)) * 19;
  const saidH = Math.max(who ? 44 : 0, ...said.map((l) => (l.length ? l.length * 16.5 + 18 : 0)));
  const withH = steps.some((s) => s.actors.length) ? 23 : 0;
  const touchH = Math.max(0, ...steps.map((s) => touchHeight(s, inner, 2))) + withH;
  const notesH = Math.max(0, ...notes.map((n) => n.reduce((h, it, i) => h + (i ? 5 : 0) + it.lines.length * LIST.line, 0)));
  const cardH = BOARD.pad + 24 + 8 + titleH + (saidH ? 12 + saidH : 0) + (touchH ? 12 + touchH : 0) + (notesH ? 12 + 1 + 10 + notesH : 0) + BOARD.pad;

  const count = Math.max(1, Math.min(perRow, steps.length));
  const width = Math.max(count * w + (count - 1) * BOARD.gap, 560);
  let y = 0;
  const band = personaBand(pen, shape, 0, y, width, full, shape.metrics);
  if (band) y += band + 24;

  for (const [i, s] of steps.entries()) {
    const t = themeAt(i);
    const col = i % count;
    const row = Math.floor(i / count);
    const x = col * (w + BOARD.gap);
    const cy = y + row * (cardH + BOARD.rowGap);
    const p = phase.get(s.phase);
    const tone = t.tones[p?.tone ?? 'blue'];
    const focus = !!step && i === step - 1;
    pen.rect(x, cy, w, cardH, { r: 14, fill: t.surface, stroke: focus ? tone.fg : t.border, sw: focus ? 1.5 : 1, shadow: true, name: s.label });
    pen.parts[s.id] = { x, y: cy, width: w, height: cardH };
    // Header: number and phase on the left, the feeling on the right.
    let ty = cy + BOARD.pad;
    badge(pen, x + BOARD.pad + 9, ty + 12, i + 1, tone);
    const mood = s.score != null ? journeyMood(s.score, shape.scale) : undefined;
    const word = s.feeling && mood != null ? fitText(s.feeling, S.body, 600, 90) : '';
    const moodW = mood != null ? 24 + (word ? measureText(word, S.body, 600) + 7 : 0) : 0;
    if (p?.label) pen.text(x + BOARD.pad + 25, ty + 12 - lh(S.body) / 2, inner - 25 - moodW - 6, [fitText(p.label, S.body, 600, inner - 25 - moodW - 6)], S.body, 600, tone.fg);
    if (mood != null) {
      face(pen, x + w - BOARD.pad - 11, ty + 12, 11, mood, t);
      if (word) pen.text(x + w - BOARD.pad - 24 - 7 - measureText(word, S.body, 600), ty + 12 - lh(S.body) / 2, measureText(word, S.body, 600) + 2, [word], S.body, 600, t.tones[journeyMoodTone(mood)].fg);
    }
    ty += 24 + 8;
    pen.text(x + BOARD.pad, ty, inner, title[i]!, 14, 600, t.text, 'l', 19);
    ty += titleH;
    if (saidH) {
      ty += 12;
      if (who) avatar(pen, who, x + BOARD.pad + 20, ty + 22, 20, t);
      if (said[i]!.length) {
        const bw = Math.min(inner - bubbleX, widest(said[i]!, 12, 400) + 22);
        const bh = said[i]!.length * 16.5 + 18;
        const by = ty + Math.max(0, Math.min(saidH - bh, (44 - bh) / 2));
        bubble(pen, x + BOARD.pad + bubbleX, by, bw, bh, t, who ? { side: 'left', at: ty + 22, kind: s.thought ? 'thought' : 'says' } : { side: 'top', at: -1e6, kind: 'thought' });
        pen.text(x + BOARD.pad + bubbleX + 11, by + 9, bw - 22, said[i]!, 12, 400, t.text, 'l', 16.5);
      }
      ty += saidH;
    }
    if (touchH) {
      ty += 12;
      const used = touchpoints(pen, s, x + BOARD.pad, ty, inner, t, p?.tone ?? 'blue', 2);
      // The names as the author wrote them, after a colon: "With: Buddy" reads right whether a name is a person or a role.
      if (s.actors.length) {
        const ay = ty + (used ? used + 8 : 0);
        pen.icon('users', x + BOARD.pad + 4, ay + 1.5, 12, t.textFaint, 1.75);
        pen.text(x + BOARD.pad + TOUCH.tile + 7, ay, inner - TOUCH.tile - 7, [fitText(tr(t.lang, 'With: {names}', { names: s.actors.join(', ') }), S.body, 400, inner - TOUCH.tile - 7)], S.body, 400, t.textMuted, 'l', 15);
      }
      ty += touchH;
    }
    if (notesH) {
      ty += 12;
      pen.line(x + BOARD.pad, ty + 0.5, x + w - BOARD.pad, ty + 0.5, t.border, 1);
      ty += 11;
      for (const n of notes[i]!) {
        const c = t.tones[JOURNEY_ROWS[n.row].tone];
        if (n.row === 'ideas' || n.row === 'metrics') pen.icon(n.row === 'ideas' ? 'sparkles' : 'gauge', x + BOARD.pad - 0.5, ty + 2, 12, n.row === 'ideas' ? c.fg : t.textMuted, 1.75);
        else sign(pen, x + BOARD.pad, ty + LIST.line / 2, n.row === 'gains', c.fg);
        ty += pen.text(x + BOARD.pad + LIST.mark, ty, inner - LIST.mark, n.lines, S.body, n.row === 'metrics' ? 600 : 400, t.text, 'l', LIST.line) + 5;
      }
    }
    // An arrow to the next card in the strip.
    if (col < count - 1 && i < steps.length - 1) {
      const ax = x + w + BOARD.gap / 2;
      const ay = cy + cardH / 2;
      pen.path([['M', ax - 3.5, ay - 6], ['L', ax + 3.5, ay], ['L', ax - 3.5, ay + 6]], { stroke: full.textFaint, sw: 1.75 });
    }
  }
  const rowsN = Math.ceil(steps.length / count);
  return { width, height: y + rowsN * cardH + (rowsN - 1) * BOARD.rowGap, marks: pen.marks, parts: pen.parts };
}

// ---------------------------------------------------------------- blueprint

type Stage = 'frontstage' | 'backstage' | 'support';
const STAGES: { key: Stage; label: string; icon: string; tone: Tone; line: string }[] = [
  { key: 'frontstage', label: 'Frontstage', icon: 'eye', tone: 'sky', line: 'Line of interaction' },
  { key: 'backstage', label: 'Backstage', icon: 'cog', tone: 'violet', line: 'Line of visibility' },
  { key: 'support', label: 'Support', icon: 'layers', tone: 'slate', line: 'Line of internal interaction' },
];

function blueprintScene(shape: JourneyShape, full: Theme, colW: number, step?: number): JourneyScene {
  const pen = new Pen(full);
  const quiet = step ? quietTheme(full) : full;
  const themeAt = (i: number) => (!step || i === step - 1 ? full : quiet);
  const stages = STAGES.filter((s) => shape.steps.some((x) => x[s.key].length)).map((s) => ({ ...s, label: term(full.lang, s.label), line: term(full.lang, s.line) }));
  const touch = shape.steps.some((s) => s.touchpoints.length);
  const gutter = Math.ceil(Math.max(...[term(full.lang, 'Touchpoints'), term(full.lang, 'Actions'), ...stages.flatMap((s) => [s.label])].map((l) => measureText(l, S.body, 600) + 19), ...stages.map((s) => measureText(s.line, S.small, 500)))) + 18;
  const { cols, phases, right } = columns(shape, shape.steps, gutter, colW);
  const width = Math.max(right, 560);
  const current = step ? cols.find((c) => c.index === step - 1) : undefined;
  const phaseTheme = (p: JourneyPhase) => (!current || shape.phases[current.phase] === p ? full : quiet);
  const inner = colW - MAP.cardGap;
  const label = (text: string, iconName: string, y: number, tone: Tone = 'slate') => {
    pen.icon(iconName, 0, y + 1, 13, full.tones[tone].fg, 1.75);
    pen.text(19, y, gutter - 33, [text], S.body, 600, full.textMuted, 'l', 15);
  };

  let y = 0;
  const band = personaBand(pen, shape, 0, y, width, full, shape.metrics);
  if (band) y += band + 22;
  const named = phases.some((p) => p.phase.label);
  const top = y;
  if (named) {
    phaseRow(pen, shape, phases, y, phaseTheme);
    y += PHASE.height + 12;
  }
  const bodyTop = y;
  if (touch) {
    const h = Math.max(...cols.map((c) => touchHeight(c.step, inner - 12, 2)));
    label(shape.rowLabels?.touchpoints ?? term(full.lang, 'Touchpoints'), 'mouse-pointer-2', y + 3);
    for (const c of cols) touchpoints(pen, c.step, c.x + MAP.cardGap / 2 + 6, y, inner - 12, themeAt(c.index), shape.phases[c.phase]!.tone, 2);
    y += h + 14;
  }
  // What the person does.
  const lines = cols.map((c) => stepLines(c.step, inner, 4));
  const cardH = 20 + Math.max(18, ...lines.map((l) => l.length * lh(S.step)));
  label(shape.rowLabels?.steps ?? term(full.lang, 'Actions'), 'route', y + 12);
  const ends = new Map<Col, number>();
  for (const [i, c] of cols.entries()) {
    stepCard(pen, c.step, c.index + 1, c.x + MAP.cardGap / 2, y, inner, cardH, lines[i]!, themeAt(c.index), shape.phases[c.phase]!.tone, { focus: !!step && c === current });
    ends.set(c, y + cardH);
  }
  y += cardH;
  // What the organisation does, in rows divided by the lines of a service blueprint.
  const links: { x: number; y1: number; y2: number; theme: Theme }[] = [];
  for (const st of stages) {
    const lineY = y + 17;
    const visibility = st.key === 'backstage';
    pen.line(gutter, lineY, right, lineY, visibility ? full.textMuted : full.border, visibility ? 1.5 : 1, true);
    pen.text(0, lineY - 7, gutter - 12, [st.line], S.small, visibility ? 600 : 500, visibility ? full.textMuted : full.textFaint, 'l', 14);
    y += 34;
    const cells = cols.map((c) => c.step[st.key].slice(0, 3).map((s) => clamp(s, S.body, 500, inner - 18, 4)));
    const heights = cells.map((cell) => cell.reduce((h, l, i) => h + (i ? 6 : 0) + l.length * 15.5 + 14, 0));
    const h = Math.max(30, ...heights);
    label(shape.rowLabels?.[st.key as never] ?? st.label, st.icon, y + 7, st.tone);
    for (const [i, c] of cols.entries()) {
      const t = themeAt(c.index);
      let cy = y;
      for (const l of cells[i]!) {
        const ch = l.length * 15.5 + 14;
        pen.rect(c.x + MAP.cardGap / 2, cy, inner, ch, { r: 8, fill: t.tones[st.tone].bg, name: l.join(' ') });
        pen.text(c.x + MAP.cardGap / 2 + 9, cy + 7, inner - 18, l, S.body, 500, t.text, 'l', 15.5);
        cy += ch + 6;
      }
      if (cells[i]!.length) {
        links.push({ x: c.x + colW / 2, y1: ends.get(c)!, y2: y, theme: t });
        ends.set(c, cy - 6);
      }
    }
    y += h;
  }
  // Who hands over to whom: a line down the column, across the lines it crosses.
  for (const l of links) {
    pen.line(l.x, l.y1 + 3, l.x, l.y2 - 3, l.theme.edge, 1.25);
    pen.circle(l.x, l.y1 + 3, 2.2, { fill: l.theme.edge });
    pen.circle(l.x, l.y2 - 3, 2.2, { fill: l.theme.edge });
  }
  if (current) pen.rect(current.x, bodyTop - 5, colW, y - bodyTop + 10, { r: 14, stroke: full.tones[shape.phases[current.phase]!.tone].fg, sw: 1.5, name: 'In focus' });
  void top;
  return { width, height: y, marks: pen.marks, parts: pen.parts };
}

// ---------------------------------------------------------------- compare

function compareScene(shape: JourneyShape, full: Theme, colW: number, step?: number): JourneyScene {
  const pen = new Pen(full);
  const future = shape.future ?? { label: term(full.lang, 'Future'), steps: [], metrics: [] };
  const quiet = step ? quietTheme(full) : full;
  const tracks = [
    { label: shape.label, steps: shape.steps, id: (s: JourneyStep) => s.id },
    { label: future.label, steps: future.steps, id: (s: JourneyStep) => s.id },
  ];
  const hasPains = shape.steps.some((s) => s.pains.length);
  const hasGains = future.steps.some((s) => s.gains.length);
  // Wide enough for the legend of the two curves, which names both journeys.
  const gutter = Math.ceil(Math.max(72, ...['Feeling', 'Pains', 'Gains'].map((l) => term(full.lang, l)).map((l) => measureText(l, S.body, 600) + 30), ...tracks.map((t) => Math.min(190, measureText(t.label, S.small, 500) + 28 + 28)))) + 16;
  // A phase is as wide as the journey with the most steps in it; each journey spreads its steps over that width.
  const boxes: PhaseBox[] = [];
  let x = gutter;
  for (const p of shape.phases) {
    const n = Math.max(...tracks.map((t) => t.steps.filter((s) => s.phase === p.id).length));
    if (!n) continue;
    if (boxes.length) x += PHASE.gap;
    boxes.push({ phase: p, x, w: n * colW });
    x += n * colW;
  }
  const right = x;
  const width = Math.max(right, 560);
  const phaseOn = (p: JourneyPhase) => !step || boxes[step - 1]?.phase === p;
  const themeOf = (p: JourneyPhase) => (phaseOn(p) ? full : quiet);
  const place = (steps: JourneyStep[]) =>
    boxes.flatMap((b) => {
      const mine = steps.filter((s) => s.phase === b.phase.id);
      return mine.map((s, i) => ({ step: s, index: steps.indexOf(s), x: b.x + (b.w / mine.length) * i, w: b.w / mine.length, box: b }));
    });

  // Numbers of both journeys side by side: today struck through, the future value large.
  const kpis: Kpi[] = [
    ...future.metrics.map((m) => ({ label: m.label, value: m.value, was: shape.metrics.find((t) => t.label === m.label)?.value })),
    ...shape.metrics.filter((m) => !future.metrics.some((f) => f.label === m.label)),
  ];
  let y = 0;
  const band = personaBand(pen, shape, 0, y, width, full, kpis);
  if (band) y += band + 22;
  const bodyTop = y;
  phaseRow(pen, shape, boxes, y, themeOf);
  y += PHASE.height + 12;

  const cards = (track: (typeof tracks)[number], cy: number, tone: Tone): number => {
    const placed = place(track.steps);
    const lines = placed.map((c) => stepLines(c.step, c.w - MAP.cardGap));
    const h = 20 + Math.max(18, ...lines.map((l) => l.length * lh(S.step)));
    const name = clamp(track.label, S.body, 600, gutter - 16, 2);
    pen.text(0, cy + h / 2 - (name.length * 15) / 2, gutter - 16, name, S.body, 600, full.text, 'l', 15);
    for (const [i, c] of placed.entries()) stepCard(pen, c.step, c.index + 1, c.x + MAP.cardGap / 2, cy, c.w - MAP.cardGap, h, lines[i]!, themeOf(c.box.phase), tone, { id: track.id(c.step) });
    return h;
  };
  const lineOf = [
    { color: full.tones.slate.fg, width: 1.75, dash: true },
    { color: full.tones.green.fg, width: 2.5 },
  ];
  y += cards(tracks[0]!, y, 'slate') + 6;
  // Both curves in one chart: today dashed, the future solid.
  const chartY = y;
  chartFrame(pen, gutter, right, chartY, full, gutter - 12);
  pen.text(0, chartY + chartHeight / 2 - 30, gutter - 30, [term(full.lang, 'Feeling')], S.body, 600, full.textMuted, 'l', 15);
  for (const [i, track] of tracks.entries()) {
    const ly = chartY + chartHeight / 2 - 6 + i * 17;
    pen.line(0, ly + 7, 22, ly + 7, lineOf[i]!.color, lineOf[i]!.width, lineOf[i]!.dash);
    pen.text(28, ly, gutter - 28 - 26, [fitText(track.label, S.small, 500, gutter - 28 - 26)], S.small, 500, full.textMuted, 'l', 14);
  }
  for (const [i, track] of tracks.entries()) {
    const placed = place(track.steps).filter((c) => c.step.score != null);
    const shown = step ? placed.filter((c) => boxes.indexOf(c.box) <= step - 1) : placed;
    const pts: CurvePoint[] = shown.map((c, k) => ({ x: c.x + c.w / 2, y: scoreY(shape, c.step.score!, chartY), step: c.step, index: k, mood: journeyMood(c.step.score!, shape.scale) }));
    const themes = shown.map((c) => themeOf(c.box.phase));
    curve(pen, shape, pts, { x0: gutter, x1: right, y: chartY, themeAt: (k) => themes[k] ?? full, theme: full, words: false, tints: false, line: lineOf[i]!, faceR: 9 });
  }
  y += chartHeight + 6;
  y += cards(tracks[1]!, y, 'green') + MAP.rowGap;

  // What hurts today and what the future journey wins, per phase.
  const lists: { row: 'pains' | 'gains'; steps: JourneyStep[]; label: string }[] = [
    ...(hasPains ? [{ row: 'pains' as const, steps: shape.steps, label: term(full.lang, 'Pains') }] : []),
    ...(hasGains ? [{ row: 'gains' as const, steps: future.steps, label: term(full.lang, 'Gains') }] : []),
  ];
  for (const l of lists) {
    const cells = boxes.map((b) => {
      const all = l.steps.filter((s) => s.phase === b.phase.id).flatMap((s) => s[l.row]);
      const colsN = Math.max(1, Math.min(all.length, Math.round(b.w / 190)));
      const cw = (b.w - 2 * LIST.pad - (colsN - 1) * 14) / colsN;
      const shown = all.slice(0, colsN * 2);
      const items = shown.map((s) => clamp(s, S.body, 400, cw - LIST.mark, 3));
      const per = Math.ceil(items.length / colsN);
      const heights = Array.from({ length: colsN }, (_, c) => items.slice(c * per, (c + 1) * per).reduce((h, it, i) => h + (i ? LIST.gap : 0) + it.length * LIST.line, 0));
      return { b, items, colsN, cw, per, h: Math.max(0, ...heights) };
    });
    const h = Math.max(...cells.map((c) => c.h)) + 2 * LIST.pad;
    rowLabel(pen, shape, l.row, y + LIST.pad, full, gutter - 14, l.label);
    for (const cell of cells) {
      const t = themeOf(cell.b.phase);
      const tone = t.tones[JOURNEY_ROWS[l.row].tone];
      pen.rect(cell.b.x, y, cell.b.w, h, { r: 10, fill: tone.wash, name: `${l.label}: ${cell.b.phase.label}` });
      for (let c = 0; c < cell.colsN; c++) {
        let ty = y + LIST.pad;
        const cx = cell.b.x + LIST.pad + c * (cell.cw + 14);
        for (const it of cell.items.slice(c * cell.per, (c + 1) * cell.per)) {
          sign(pen, cx, ty + LIST.line / 2, l.row === 'gains', tone.fg);
          ty += pen.text(cx + LIST.mark, ty, cell.cw - LIST.mark, it, S.body, 400, t.text, 'l', LIST.line) + LIST.gap;
        }
      }
    }
    y += h + 8;
  }
  const bottom = y - (lists.length ? 8 : MAP.rowGap);
  const on = step ? boxes[step - 1] : undefined;
  if (on) pen.rect(on.x - 3, bodyTop - 5, on.w + 6, bottom - bodyTop + 10, { r: 14, stroke: full.tones[on.phase.tone].fg, sw: 1.5, name: 'In focus' });
  return { width, height: bottom, marks: pen.marks, parts: pen.parts };
}

// ---------------------------------------------------------------- fit and cache

/** How far a drawing of this size is from a slide's proportions (0 is exact). */
const off = (s: { width: number; height: number }) => Math.abs(Math.log((s.width + FRAME.x) / (s.height + FRAME.y) / ASPECT));

function emptyScene(theme: Theme): JourneyScene {
  const pen = new Pen();
  pen.text(0, 10, 420, ['Add steps to draw the journey: "Sign up: 4"'], 13, 400, theme.textFaint);
  return { width: 420, height: 40, marks: pen.marks, parts: {} };
}

const fits = new WeakMap<JourneyShape, Map<Theme, number>>();
const scenes = new WeakMap<JourneyShape, Map<Theme, Map<number, JourneyScene>>>();

/** The column width (or cards per row) that brings this journey closest to a 16:9 slide. */
function fit(shape: JourneyShape, theme: Theme): number {
  let byTheme = fits.get(shape);
  if (!byTheme) fits.set(shape, (byTheme = new Map()));
  let best = byTheme.get(theme);
  if (best != null) return best;
  const make = maker(shape);
  const board = shape.view === 'storyboard';
  const n = Math.max(1, shape.steps.length);
  // A storyboard picks cards per row and a card width together; a last row with holes in it counts against a choice.
  const options = board
    ? Array.from({ length: Math.min(8, n) }, (_, i) => i + 1).flatMap((per) => Array.from({ length: (BOARD.widest - BOARD.card) / 24 + 1 }, (_, k) => per * 1000 + BOARD.card + k * 24))
    : Array.from({ length: (MAP.max - MAP.min) / 10 + 1 }, (_, i) => MAP.min + i * 10);
  const ragged = (o: number) => {
    const per = Math.floor(o / 1000);
    return n > per && n % per ? (0.3 * (per - (n % per))) / per : 0;
  };
  let score = Infinity;
  best = options[0]!;
  for (const o of options) {
    const scene = make(shape, theme, o);
    // Text cut short with an ellipsis counts against a choice too: better a little off 16:9 than unreadable.
    const cut = scene.marks.filter((m) => m.t === 'text' && m.lines.some((l) => l.endsWith('…'))).length;
    const s = off(scene) + (board ? ragged(o) : 0) + Math.min(0.6, cut * 0.08);
    // Nearly as good and wider (more room for text) beats a hair better.
    if (s < score - 0.02 || (!board && s < score + 0.02)) {
      if (s < score) score = s;
      best = o;
    }
  }
  byTheme.set(theme, best);
  return best;
}

const maker = (shape: JourneyShape) => (shape.view === 'storyboard' ? storyboardScene : shape.view === 'blueprint' ? blueprintScene : shape.view === 'compare' ? compareScene : mapScene);

/** The journey as marks, whole or at one step of a presentation (1-based). */
export function journeyScene(shape: JourneyShape, theme: Theme, step?: number): JourneyScene {
  MEASURE = theme;
  let byTheme = scenes.get(shape);
  if (!byTheme) scenes.set(shape, (byTheme = new Map()));
  let bySteps = byTheme.get(theme);
  if (!bySteps) byTheme.set(theme, (bySteps = new Map()));
  let scene = bySteps.get(step ?? 0);
  if (!scene) {
    const has = shape.steps.length || shape.future?.steps.length;
    scene = has ? maker(shape)(shape, theme, fit(shape, theme), step) : emptyScene(theme);
    scene = { ...scene, width: Math.ceil(scene.width), height: Math.ceil(scene.height) };
    bySteps.set(step ?? 0, scene);
  }
  return scene;
}

// ---------------------------------------------------------------- SVG

const r1 = (n: number) => Math.round(n * 10) / 10;

export const journeyPath = (d: JourneySeg[]) => d.map((s) => (s[0] === 'Z' ? 'Z' : `${s[0]}${s.slice(1).map((n) => r1(n as number)).join(' ')}`)).join('');

function glyph(name: string, x: number, y: number, size: number, color: string, stroke: number) {
  const markup = icon(name);
  if (!markup) return '';
  const s = size / 24;
  return `<g transform="translate(${r1(x)} ${r1(y)}) scale(${r1(s * 1000) / 1000})" fill="none" stroke="${color}" stroke-width="${r1(stroke / s)}" stroke-linecap="round" stroke-linejoin="round">${markup}</g>`;
}

const paint = (m: { fill?: string; stroke?: string; sw?: number; dash?: boolean }) =>
  `fill="${m.fill ?? 'none'}"${m.stroke ? ` stroke="${m.stroke}" stroke-width="${r1(m.sw ?? 1)}" stroke-linecap="round" stroke-linejoin="round"` : ''}${m.dash ? ' stroke-dasharray="4 4"' : ''}`;

export function drawJourney(shape: JourneyShape, at: Box, theme: Theme, shadow: string, step?: number): string {
  const scene = journeyScene(shape, theme, step);
  let s = `<g transform="translate(${r1(at.x)} ${r1(at.y)})">`;
  for (const m of scene.marks) {
    if (m.t === 'rect') s += `<rect x="${r1(m.x)}" y="${r1(m.y)}" width="${r1(m.w)}" height="${r1(m.h)}"${m.r ? ` rx="${r1(Math.min(m.r, m.w / 2, m.h / 2))}"` : ''} ${paint(m)}${m.shadow && theme.shadow.opacity > 0 ? ` filter="url(#${shadow})"` : ''}/>`;
    else if (m.t === 'circle') s += `<circle cx="${r1(m.cx)}" cy="${r1(m.cy)}" r="${r1(m.r)}" ${paint(m)}/>`;
    else if (m.t === 'path') s += `<path d="${journeyPath(m.d)}" ${paint(m)}/>`;
    else if (m.t === 'icon') s += glyph(m.name, m.x, m.y, m.size, m.color, m.sw);
    else {
      const x = m.align === 'c' ? m.x + m.w / 2 : m.align === 'r' ? m.x + m.w : m.x;
      const anchor = m.align === 'c' ? ' text-anchor="middle"' : m.align === 'r' ? ' text-anchor="end"' : '';
      for (const [i, l] of m.lines.entries())
        s += `<text x="${r1(x)}" y="${r1(m.y + m.lh * i + m.lh / 2 + baselineOffset(m.size))}" font-size="${m.size}" font-weight="${m.weight}" fill="${m.fill}"${anchor}>${esc(l)}</text>`;
    }
  }
  return s + '</g>';
}
