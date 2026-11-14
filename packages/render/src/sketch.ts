// The sketch look: a finished drawing redrawn by hand. Every outline and line becomes a slightly
// wobbly path (rects, circles and lines too), tinted areas get hachure. Only plain paths come out,
// no filters, so PNG, slides and Office-safe SVG keep the look. The wobble is seeded per element:
// by its node, group or edge id where the drawing carries them (the editor's), else by its geometry,
// so the same drawing comes out the same every time and a dragged card keeps its own hand.
import { mix, parseColor, type Theme } from '@linework/theme';
import type { Point } from '@linework/core';

export interface SketchOptions {
  /** 0 is a ruler, 1 the default, 2 a quick marker. */
  roughness: number;
  fill: 'hachure' | 'solid';
  /** Outlines of closed shapes drawn twice, slightly apart. */
  double: boolean;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const P = (p: Point) => `${r1(p.x)} ${r1(p.y)}`;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** mulberry32: small, fast, and the same everywhere. */
function random(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- geometry to subpaths

/** A subpath as corner points; `curved` marks a point that lies on a curve (not a corner to bow between). */
interface Sub {
  pts: Point[];
  curved: boolean[];
  closed: boolean;
}

function arcPoints(p0: Point, rx: number, ry: number, phi: number, large: boolean, sweep: boolean, p1: Point): Point[] {
  // SVG arc endpoint to centre parameterisation (SVG 1.1, F.6.5).
  if (!rx || !ry) return [p1];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2;
  const dy = (p0.y - p1.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const cx1 = (k * rx * y1) / ry;
  const cy1 = (-k * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0.x + p1.x) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0.y + p1.y) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(2, Math.ceil((Math.abs(dt) * Math.max(rx, ry)) / 4));
  const out: Point[] = [];
  for (let i = 1; i <= n; i++) {
    const t = t1 + (dt * i) / n;
    out.push({ x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos });
  }
  out[out.length - 1] = p1;
  return out;
}

function bezier(p0: Point, c1: Point, c2: Point, p1: Point): Point[] {
  const len = Math.hypot(c1.x - p0.x, c1.y - p0.y) + Math.hypot(c2.x - c1.x, c2.y - c1.y) + Math.hypot(p1.x - c2.x, p1.y - c2.y);
  const n = Math.max(2, Math.ceil(len / 4));
  const out: Point[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({ x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x, y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y });
  }
  return out;
}

/** The subpaths of a path's `d`, curves flattened. Undefined for anything it cannot read. */
export function parsePath(d: string): Sub[] | undefined {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g);
  if (!tokens) return undefined;
  const subs: Sub[] = [];
  let cur: Sub | undefined;
  let p: Point = { x: 0, y: 0 };
  let start: Point = p;
  let lastCtrl: Point | undefined;
  let lastCmd = '';
  let i = 0;
  const num = () => {
    const t = tokens[i++];
    if (t === undefined || /[a-zA-Z]/.test(t)) throw new Error('number');
    return Number(t);
  };
  const add = (q: Point, curved = false) => {
    if (!cur) {
      cur = { pts: [p], curved: [false], closed: false };
      subs.push(cur);
    }
    cur.pts.push(q);
    cur.curved.push(curved);
    p = q;
  };
  const curve = (pts: Point[]) => pts.forEach((q, k) => add(q, k < pts.length - 1));
  try {
    let cmd = '';
    while (i < tokens.length) {
      if (/[a-zA-Z]/.test(tokens[i]!)) cmd = tokens[i++]!;
      else if (!cmd) return undefined;
      const rel = cmd === cmd.toLowerCase();
      const o = rel ? p : { x: 0, y: 0 };
      switch (cmd.toUpperCase()) {
        case 'M': {
          const q = { x: o.x + num(), y: o.y + num() };
          p = q;
          start = q;
          cur = undefined;
          cmd = rel ? 'l' : 'L';
          lastCtrl = undefined;
          break;
        }
        case 'L':
          add({ x: o.x + num(), y: o.y + num() });
          break;
        case 'H':
          add({ x: (rel ? p.x : 0) + num(), y: p.y });
          break;
        case 'V':
          add({ x: p.x, y: (rel ? p.y : 0) + num() });
          break;
        case 'C': {
          const c1 = { x: o.x + num(), y: o.y + num() };
          const c2 = { x: o.x + num(), y: o.y + num() };
          const q = { x: o.x + num(), y: o.y + num() };
          curve(bezier(p, c1, c2, q));
          lastCtrl = c2;
          break;
        }
        case 'S': {
          const c1 = lastCtrl && /[CS]/i.test(lastCmd) ? { x: 2 * p.x - lastCtrl.x, y: 2 * p.y - lastCtrl.y } : p;
          const c2 = { x: o.x + num(), y: o.y + num() };
          const q = { x: o.x + num(), y: o.y + num() };
          curve(bezier(p, c1, c2, q));
          lastCtrl = c2;
          break;
        }
        case 'Q': {
          const c = { x: o.x + num(), y: o.y + num() };
          const q = { x: o.x + num(), y: o.y + num() };
          curve(bezier(p, { x: p.x + (2 / 3) * (c.x - p.x), y: p.y + (2 / 3) * (c.y - p.y) }, { x: q.x + (2 / 3) * (c.x - q.x), y: q.y + (2 / 3) * (c.y - q.y) }, q));
          lastCtrl = c;
          break;
        }
        case 'T': {
          const c = lastCtrl && /[QT]/i.test(lastCmd) ? { x: 2 * p.x - lastCtrl.x, y: 2 * p.y - lastCtrl.y } : p;
          const q = { x: o.x + num(), y: o.y + num() };
          curve(bezier(p, { x: p.x + (2 / 3) * (c.x - p.x), y: p.y + (2 / 3) * (c.y - p.y) }, { x: q.x + (2 / 3) * (c.x - q.x), y: q.y + (2 / 3) * (c.y - q.y) }, q));
          lastCtrl = c;
          break;
        }
        case 'A': {
          const rx = num();
          const ry = num();
          const phi = (num() * Math.PI) / 180;
          const large = num() !== 0;
          const sweep = num() !== 0;
          const q = { x: o.x + num(), y: o.y + num() };
          curve(arcPoints(p, rx, ry, phi, large, sweep, q));
          break;
        }
        case 'Z':
          if (cur) cur.closed = true;
          p = start;
          cur = undefined;
          break;
        default:
          return undefined;
      }
      lastCmd = cmd;
      if (!/[CSQT]/i.test(cmd)) lastCtrl = undefined;
    }
  } catch {
    return undefined;
  }
  // A closed subpath that ends where it started does not need the last point twice.
  for (const s of subs) {
    const a = s.pts[0]!;
    const b = s.pts.at(-1)!;
    if (s.closed && s.pts.length > 2 && Math.hypot(a.x - b.x, a.y - b.y) < 0.01) {
      s.pts.pop();
      s.curved.pop();
    }
  }
  return subs.filter((s) => s.pts.length > 1);
}

function roundRect(x: number, y: number, w: number, h: number, rx: number, ry: number): Sub {
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);
  if (rx < 0.5 || ry < 0.5) return { pts: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], curved: [false, false, false, false], closed: true };
  const d = `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
  return parsePath(d)![0]!;
}

function ellipse(cx: number, cy: number, rx: number, ry: number): Sub {
  const n = Math.max(10, Math.round((Math.max(rx, ry) * 2 * Math.PI) / 5));
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) pts.push({ x: cx + rx * Math.cos((2 * Math.PI * i) / n), y: cy + ry * Math.sin((2 * Math.PI * i) / n) });
  return { pts, curved: pts.map(() => true), closed: true };
}

// ---------------------------------------------------------------- drawing by hand

interface Hand {
  rnd: () => number;
  /** Largest stray of a point, px. */
  amp: number;
}

const jitter = (h: Hand, k: number) => (h.rnd() * 2 - 1) * h.amp * k;

/**
 * Runs of a subpath between corners: a straight piece is one stroke that bows a little, a curved
 * run follows its points with a soft drift. Corners are where the hand stops and starts again.
 */
function runs(s: Sub): { pts: Point[]; straight: boolean }[] {
  const n = s.pts.length;
  const at = (i: number) => s.pts[((i % n) + n) % n]!;
  const out: { pts: Point[]; straight: boolean }[] = [];
  const count = s.closed ? n : n - 1;
  let run: Point[] | undefined;
  for (let i = 0; i < count; i++) {
    const a = at(i);
    const b = at(i + 1);
    // A point lies on a curve when it was flattened from one; the segment ending there belongs to a curved run.
    const curved = s.curved[(i + 1) % n] || (s.curved[i] && i > 0 && Math.hypot(b.x - a.x, b.y - a.y) < 8);
    if (curved) {
      if (!run) run = [a];
      run.push(b);
      continue;
    }
    if (run) {
      out.push({ pts: run, straight: false });
      run = undefined;
    }
    out.push({ pts: [a, b], straight: true });
  }
  if (run) out.push({ pts: run, straight: false });
  return out;
}

/** One stroke from a to b: the ends stray a little, the middle bows to one side. */
function stroke(a: Point, b: Point, h: Hand, overshoot: boolean, move: boolean): string {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 0.01) return move ? `M${P(a)}` : '';
  const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const n = { x: -d.y, y: d.x };
  const k = Math.min(1, len / 40);
  const over = overshoot ? Math.min(len * 0.06, h.amp * 1.6) : 0;
  const s = { x: a.x - d.x * over * h.rnd() + n.x * jitter(h, 0.35 * k), y: a.y - d.y * over * h.rnd() + n.y * jitter(h, 0.35 * k) };
  const e = { x: b.x + d.x * over * h.rnd() + n.x * jitter(h, 0.35 * k), y: b.y + d.y * over * h.rnd() + n.y * jitter(h, 0.35 * k) };
  const bow = (h.rnd() * 2 - 1) * Math.min(len * 0.018, 3.5) * (h.amp / 2);
  const c = (t: number) => ({ x: s.x + (e.x - s.x) * t + n.x * (bow + jitter(h, 0.25 * k)), y: s.y + (e.y - s.y) * t + n.y * (bow + jitter(h, 0.25 * k)) });
  return `${move ? `M${P(s)}` : `L${P(s)}`}C${P(c(0.3 + h.rnd() * 0.15))} ${P(c(0.62 + h.rnd() * 0.15))} ${P(e)}`;
}

/** A curved run, its points pushed off the line by a slow drift; the ends keep their place. */
function drift(pts: Point[], h: Hand, move: boolean): string {
  const phase = h.rnd() * Math.PI * 2;
  const wave = 30 + h.rnd() * 30;
  let s = 0;
  let d = move ? `M${P(pts[0]!)}` : `L${P(pts[0]!)}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    s += Math.hypot(b.x - a.x, b.y - a.y);
    const c = pts[Math.min(i + 1, pts.length - 1)]!;
    const t = { x: c.x - a.x, y: c.y - a.y };
    const tl = Math.hypot(t.x, t.y) || 1;
    const end = i === pts.length - 1;
    const off = end ? 0 : Math.sin(phase + (2 * Math.PI * s) / wave) * h.amp * 0.45;
    d += `L${P({ x: b.x - (t.y / tl) * off, y: b.y + (t.x / tl) * off })}`;
  }
  return d;
}

/** The outline of a subpath in one go, closed where the shape is: what a fill needs, and the first pass of a stroke. */
function onePass(s: Sub, h: Hand): string {
  let d = '';
  let first = true;
  for (const r of runs(s)) {
    d += r.straight ? stroke(r.pts[0]!, r.pts[1]!, h, false, first) : drift(r.pts, h, first);
    first = false;
  }
  return s.closed ? d + 'Z' : d;
}

/** The second pass of an outline: each side again, a little apart, overshooting at the corners. */
function secondPass(s: Sub, h: Hand): string {
  let d = '';
  for (const r of runs(s)) d += r.straight ? stroke(r.pts[0]!, r.pts[1]!, h, true, true) : drift(r.pts, h, true);
  return d;
}

// ---------------------------------------------------------------- hachure

function bounds(subs: Sub[]) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const s of subs)
    for (const p of s.pts) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/** Parallel strokes across a closed shape, at an angle, each a little crooked: the hand's way of filling an area. */
function hachure(subs: Sub[], gap: number, angle: number, h: Hand): string {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Rotate so the hatching runs horizontally, cut each scanline with the outline, rotate back.
  const rot = (p: Point) => ({ x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos });
  const back = (p: Point) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos });
  const edges: [Point, Point][] = [];
  for (const s of subs) {
    const pts = s.pts.map(rot);
    for (let i = 0; i < pts.length; i++) edges.push([pts[i]!, pts[(i + 1) % pts.length]!]);
  }
  const ys = edges.flatMap(([a, b]) => [a.y, b.y]);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  let d = '';
  const inset = 3;
  for (let y = top + gap * (0.5 + h.rnd() * 0.3); y < bottom - gap * 0.3; y += gap) {
    const xs: number[] = [];
    for (const [a, b] of edges) {
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = xs[i]! + inset;
      const x1 = xs[i + 1]! - inset;
      if (x1 - x0 < gap * 0.8) continue;
      d += stroke(back({ x: x0 + h.rnd() * 2, y }), back({ x: x1 - h.rnd() * 2, y }), h, false, true);
    }
  }
  return d;
}

// ---------------------------------------------------------------- the SVG pass

const num = (attrs: string, name: string): number | undefined => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(attrs);
  if (!m) return undefined;
  const v = parseFloat(m[1]!);
  return Number.isFinite(v) ? v : undefined;
};
const attr = (attrs: string, name: string): string | undefined => new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1];
const without = (attrs: string, names: string[]) => names.reduce((a, n) => a.replace(new RegExp(`\\s${n}="[^"]*"`, 'g'), ''), attrs);
const GEOMETRY = ['x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'points', 'd'];
const STROKE = ['stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity'];

interface Frame {
  /** Inside an icon (a scaled group): left as drawn, line icons are already drawn by hand at that size. */
  icon: boolean;
  /** Inside defs, a pattern, a marker or a clip: not drawn where it stands. */
  hidden: boolean;
  /** The element id the wobble is seeded from. */
  id?: string;
  stroked: boolean;
}

const ID = /\sdata-(?:node|group|edge)="([^"]*)"/;

/** The drawing redrawn by hand. Text, images and line icons stay as they are. */
export function sketchSvg(svg: string, theme: Theme, o: SketchOptions): string {
  const amp = 2 * o.roughness;
  if (amp <= 0) return svg;
  const width = num(svg.slice(0, svg.indexOf('>')), 'width') ?? 0;
  const height = num(svg.slice(0, svg.indexOf('>')), 'height') ?? 0;
  const stack: Frame[] = [{ icon: false, hidden: false, stroked: false }];
  const plain = new Set([theme.canvas, theme.surface].map((c) => c.toUpperCase()));
  const shade = (fill: string) => mix(theme.mode === 'dark' ? '#FFFFFF' : theme.text, fill, theme.mode === 'dark' ? 0.08 : 0.09);
  return svg.replace(/<(\/?)([a-zA-Z]+)((?:\s[^>]*?)?)(\/?)>/g, (tag, close: string, name: string, attrs: string, self: string) => {
    const top = stack.at(-1)!;
    if (close) {
      if (['g', 'a', 'defs', 'pattern', 'marker', 'clipPath', 'mask', 'symbol'].includes(name) && stack.length > 1) stack.pop();
      return tag;
    }
    if (['g', 'a', 'defs', 'pattern', 'marker', 'clipPath', 'mask', 'symbol'].includes(name) && !self) {
      stack.push({
        icon: top.icon || (name === 'g' && /scale\(/.test(attr(attrs, 'transform') ?? '')),
        hidden: top.hidden || name !== 'g' && name !== 'a',
        id: ID.exec(attrs)?.[1] ?? top.id,
        stroked: top.stroked || (!!attr(attrs, 'stroke') && attr(attrs, 'stroke') !== 'none'),
      });
      return tag;
    }
    if (top.icon || top.hidden || !['rect', 'circle', 'ellipse', 'line', 'path', 'polygon', 'polyline'].includes(name)) return tag;

    let subs: Sub[] | undefined;
    if (name === 'rect') {
      const w = num(attrs, 'width') ?? 0;
      const hh = num(attrs, 'height') ?? 0;
      // The page itself stays a clean sheet.
      if (w >= width - 1 && hh >= height - 1) return tag;
      // A rule (the key's, a header's) is a thin filled rect: drawn as one stroke of its colour.
      const fill = attr(attrs, 'fill');
      if (hh < 4 && w >= 20 && fill && fill !== 'none') {
        const y = (num(attrs, 'y') ?? 0) + hh / 2;
        const x = num(attrs, 'x') ?? 0;
        const hand: Hand = { rnd: random(hash(`rule${x} ${y} ${w}`)), amp };
        return `<path d="${stroke({ x, y }, { x: x + w, y }, hand, false, true)}"${without(attrs, [...GEOMETRY, 'fill'])} fill="none" stroke="${fill}" stroke-width="${r1(Math.max(1, hh))}" stroke-linecap="round"/>`;
      }
      if (w < 4 || hh < 4) return tag;
      const rx = num(attrs, 'rx') ?? num(attrs, 'ry') ?? 0;
      subs = [roundRect(num(attrs, 'x') ?? 0, num(attrs, 'y') ?? 0, w, hh, rx, num(attrs, 'ry') ?? rx)];
    } else if (name === 'circle' || name === 'ellipse') {
      const rx = num(attrs, name === 'circle' ? 'r' : 'rx') ?? 0;
      const ry = num(attrs, name === 'circle' ? 'r' : 'ry') ?? rx;
      // Dots where lines join stay dots.
      if (Math.max(rx, ry) < 4.5) return tag;
      subs = [ellipse(num(attrs, 'cx') ?? 0, num(attrs, 'cy') ?? 0, rx, ry)];
    } else if (name === 'line') {
      subs = [{ pts: [{ x: num(attrs, 'x1') ?? 0, y: num(attrs, 'y1') ?? 0 }, { x: num(attrs, 'x2') ?? 0, y: num(attrs, 'y2') ?? 0 }], curved: [false, false], closed: false }];
    } else if (name === 'polygon' || name === 'polyline') {
      const v = (attr(attrs, 'points') ?? '').trim().split(/[\s,]+/).map(Number);
      const pts: Point[] = [];
      for (let i = 0; i + 1 < v.length; i += 2) pts.push({ x: v[i]!, y: v[i + 1]! });
      subs = [{ pts, curved: pts.map(() => false), closed: name === 'polygon' }];
    } else subs = parsePath(attr(attrs, 'd') ?? '');
    if (!subs?.length) return tag;
    const box = bounds(subs);
    if (Math.max(box.w, box.h) < 3) return tag;

    // The shape relative to its own corner: a card dragged elsewhere keeps its wobble, and a line's
    // second mark (ticks, beads, a double line's core) wobbles with the line it lies on.
    const shapeKey = subs.map((q) => q.pts.map((p) => `${Math.round(p.x - box.x0)},${Math.round(p.y - box.y0)}`).join(' ')).join('|');
    const seed = hash(top.id !== undefined ? `${top.id}#${shapeKey}` : `${Math.round(box.x0)},${Math.round(box.y0)}#${shapeKey}`);
    const hand: Hand = { rnd: random(seed), amp };
    const fill = attr(attrs, 'fill');
    const strokeColor = attr(attrs, 'stroke');
    const closed = subs.every((s) => s.closed);
    const fills = closed && fill !== 'none';
    const strokes = strokeColor ? strokeColor !== 'none' : top.stroked || (!closed && fill === 'none');
    const rest = without(attrs, GEOMETRY);
    let out = '';
    if (fills) {
      out += `<path d="${subs.map((s) => onePass(s, hand)).join('')}"${without(rest, STROKE)} stroke="none"/>`;
      // Hachure on tinted areas big enough to hold it; cards and the page stay plain paper.
      const solid = fill && parseColor(fill) && !plain.has(fill.toUpperCase());
      if (o.fill === 'hachure' && solid && box.w > 30 && box.h > 30) {
        const ink = shade(fill);
        const opacity = attr(attrs, 'opacity') ?? attr(attrs, 'fill-opacity');
        out += `<path d="${hachure(subs, 10, -Math.PI / 4.4, { rnd: hand.rnd, amp: amp * 0.6 })}" fill="none" stroke="${ink}" stroke-width="1" stroke-linecap="round"${opacity ? ` opacity="${opacity}"` : ''}/>`;
      }
    }
    if (strokes) {
      const keep = without(rest, ['fill', 'fill-opacity', 'filter']);
      let d = subs.map((s) => onePass(s, hand)).join('');
      // Closed outlines get the second pencil line; lines and arrowheads are one confident stroke.
      if (o.double && closed && Math.max(box.w, box.h) > 14) d += subs.map((s) => secondPass(s, { rnd: hand.rnd, amp: amp * 0.8 })).join('');
      out += `<path d="${d}"${keep} fill="none"${/stroke-linecap/.test(keep) ? '' : ' stroke-linecap="round"'}${/stroke-linejoin/.test(keep) ? '' : ' stroke-linejoin="round"'}/>`;
    }
    return out || tag;
  });
}
