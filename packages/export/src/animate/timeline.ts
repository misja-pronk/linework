// The frames between scenes: a hold on each beat, a short blend to the next (what appears fades in,
// what goes fades out, emphasis shifts with it), and optionally the new lines drawn along their path.
// Works on RGBA pixels, so the CLI (resvg) and the browser (canvas) make the same frames.
import type { Point } from '@cartography/core';

export interface Raster {
  /** RGBA, row by row, opaque. */
  data: Uint8Array;
  width: number;
  height: number;
}

export interface Frame {
  data: Uint8Array;
  /** How long it shows, in milliseconds. */
  duration: number;
}

/** A beat as pixels: the picture, and when its new lines are drawn on, the picture without them and their paths in pixels. */
export interface SceneRaster {
  full: Raster;
  /** The first row of the lower third's words: they go out and come in rather than blend into each other. */
  words?: number;
  lines?: { without: Raster; paths: Point[][] };
}

export interface Timing {
  /** Seconds each beat stays (default 2.5). */
  hold?: number;
  /** Seconds the blend to the next beat takes (default 0.5; 0 cuts). */
  transition?: number;
  /** Seconds the last beat stays (default twice the hold). */
  endHold?: number;
  /** Seconds new lines take to be drawn (default 0.6), when a scene has them. */
  draw?: number;
  /** Frames per second in a transition. */
  fps?: number;
  /** Blend the last beat back into the first, for a GIF that loops. */
  loop?: boolean;
}

export const TIMING = { hold: 2.5, transition: 0.5, draw: 0.6, fps: 30 };

/** Slow in, slow out: a blend that settles instead of stopping. */
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function blend(a: Uint8Array, b: Uint8Array, t: number, out = new Uint8Array(a.length), from = 0, to = a.length): Uint8Array {
  const k = Math.round(t * 256);
  for (let i = from; i < to; i++) {
    const x = a[i]!;
    out[i] = x + (((b[i]! - x) * k) >> 8);
  }
  return out;
}

/** Two words written over each other read as neither: below `row`, the old ones fade to the ground, then the new ones come up. */
function blendWords(a: Raster, b: Uint8Array, t: number, row: number): Uint8Array {
  const out = blend(a.data, b, t, undefined, 0, row * a.width * 4);
  const from = row * a.width * 4;
  // The ground is the frame's own colour, in its bottom-left corner.
  const g = a.data.length - a.width * 4;
  const ground = new Uint8Array(a.data.length - from);
  for (let i = 0; i < ground.length; i += 4) ((ground[i] = a.data[g]!), (ground[i + 1] = a.data[g + 1]!), (ground[i + 2] = a.data[g + 2]!), (ground[i + 3] = 255));
  const tail = t < 0.5 ? blend(a.data.subarray(from), ground, Math.min(1, t * 2.5)) : blend(ground, b.subarray(from), Math.max(0, t * 2.5 - 1.5));
  out.set(tail, from);
  return out;
}

const same = (a: Uint8Array, b: Uint8Array, from: number) => {
  for (let i = from; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/**
 * Where each pixel the new lines add lies along them: the distance along its nearest line and that
 * line's length. Pixels further than `near` from any line (a label beside it) come in at the end.
 */
function reveal(without: Raster, full: Raster, paths: Point[][], near: number) {
  const { width, data: a } = without;
  const b = full.data;
  const segs: { x0: number; y0: number; dx: number; dy: number; len: number; at: number; total: number }[] = [];
  for (const p of paths) {
    let total = 0;
    for (let i = 1; i < p.length; i++) total += Math.hypot(p[i]!.x - p[i - 1]!.x, p[i]!.y - p[i - 1]!.y);
    let at = 0;
    for (let i = 1; i < p.length; i++) {
      const dx = p[i]!.x - p[i - 1]!.x;
      const dy = p[i]!.y - p[i - 1]!.y;
      const len = Math.hypot(dx, dy);
      if (len > 0) segs.push({ x0: p[i - 1]!.x, y0: p[i - 1]!.y, dx, dy, len, at, total });
      at += len;
    }
  }
  const index: number[] = [];
  const along: number[] = [];
  const lengths: number[] = [];
  for (let i = 0, px = 0; i < a.length; i += 4, px++) {
    if (Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!) < 6) continue;
    const x = (px % width) + 0.5;
    const y = Math.floor(px / width) + 0.5;
    let best = Infinity;
    let d = 0;
    let total = 1;
    for (const s of segs) {
      const t = Math.max(0, Math.min(1, ((x - s.x0) * s.dx + (y - s.y0) * s.dy) / (s.len * s.len)));
      const dist = Math.hypot(s.x0 + t * s.dx - x, s.y0 + t * s.dy - y);
      if (dist < best) ((best = dist), (d = s.at + t * s.len), (total = s.total));
    }
    index.push(i);
    along.push(best <= near ? d : -1);
    lengths.push(total);
  }
  return { index, along, lengths };
}

/** The frames of an animation, a beat after the other; a hold is one frame shown long. */
export function* frames(list: SceneRaster[], timing: Timing = {}): Generator<Frame> {
  const hold = (timing.hold ?? TIMING.hold) * 1000;
  const end = (timing.endHold ?? 2 * (timing.hold ?? TIMING.hold)) * 1000;
  const fps = timing.fps ?? TIMING.fps;
  const tick = 1000 / fps;
  const blends = Math.round((timing.transition ?? TIMING.transition) * fps);
  const draws = Math.round((timing.draw ?? TIMING.draw) * fps);
  function* fade(from: SceneRaster, b: Uint8Array, words?: number): Generator<Frame> {
    const a = from.full;
    const row = words != null && !same(a.data, b, words * a.width * 4) ? words : undefined;
    for (let k = 1; k < blends; k++) yield { data: row != null ? blendWords(a, b, ease(k / blends), row) : blend(a.data, b, ease(k / blends)), duration: tick };
  }
  for (const [i, s] of list.entries()) {
    if (i) {
      const lines = s.lines && draws > 1 ? s.lines : undefined;
      yield* fade(list[i - 1]!, lines ? lines.without.data : s.full.data, s.words);
      if (lines) {
        if (blends > 1) yield { data: lines.without.data, duration: tick };
        const scale = s.full.width / 1280;
        const r = reveal(lines.without, s.full, lines.paths, 9 * scale);
        const soft = 14 * scale;
        for (let k = 1; k < draws; k++) {
          const p = ease(k / draws);
          const out = new Uint8Array(lines.without.data);
          const b = s.full.data;
          for (let j = 0; j < r.index.length; j++) {
            const d = r.along[j]!;
            const t = d < 0 ? Math.max(0, (p - 0.7) / 0.3) : Math.max(0, Math.min(1, (p * (r.lengths[j]! + soft) - d) / soft));
            if (!t) continue;
            const q = r.index[j]!;
            for (let c = 0; c < 3; c++) out[q + c] = out[q + c]! + Math.round((b[q + c]! - out[q + c]!) * t);
          }
          yield { data: out, duration: tick };
        }
      }
    }
    yield { data: s.full.data, duration: i === list.length - 1 ? end : hold };
  }
  if (timing.loop && list.length > 1) yield* fade(list.at(-1)!, list[0]!.full.data, list[0]!.words);
}

/** How long the animation runs, in milliseconds: what the frames add up to. */
export function duration(list: SceneRaster[], timing: Timing = {}): number {
  const fps = timing.fps ?? TIMING.fps;
  const blends = Math.max(0, Math.round((timing.transition ?? TIMING.transition) * fps) - 1);
  const draws = Math.round((timing.draw ?? TIMING.draw) * fps);
  const hold = (timing.hold ?? TIMING.hold) * 1000;
  let n = 0;
  for (const [i, s] of list.entries()) if (i) n += blends + (s.lines && draws > 1 ? (blends ? 1 : 0) + draws - 1 : 0);
  if (timing.loop && list.length > 1) n += blends;
  return (n * 1000) / fps + Math.max(0, list.length - 1) * hold + (list.length ? (timing.endHold ?? 2 * (timing.hold ?? TIMING.hold)) * 1000 : 0);
}
