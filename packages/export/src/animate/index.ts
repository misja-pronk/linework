// An animation of one drawing: its beats as scenes (scenes.ts), the scenes as pixels (by whoever
// rasterises: resvg in the CLI, a canvas in the browser), the frames between them (timeline.ts),
// and those frames as a GIF (gif.ts) or, encoded elsewhere, an MP4 or WebM (mux.ts).
import { FRAME, newLines, scenes, type Animated, type SceneOptions } from './scenes.ts';
import { frames, type Raster, type SceneRaster, type Timing } from './timeline.ts';
import { encodeGif, type GifOptions } from './gif.ts';

export * from './scenes.ts';
export * from './timeline.ts';
export { encodeGif, GifWriter, palette, type GifOptions } from './gif.ts';
export { mp4, webm, type Chunk, type Track } from './mux.ts';
export { encodePng } from './png.ts';

export interface PixelOptions extends SceneOptions {
  /** Frame width in pixels (default 1280); the height follows the 16:9 frame. */
  width?: number;
  /** Draw lines that appear along their path instead of fading them in. */
  drawLines?: boolean;
}

/** SVG to RGBA pixels at the given size. */
export type Pixels = (svg: string, width: number, height: number) => Raster | Promise<Raster>;

/** The frame size for a width: even numbers, as video encoders want them. */
export const frameSize = (width = FRAME.width) => {
  const w = Math.max(2, Math.round(width / 2) * 2);
  return { width: w, height: Math.round((w * FRAME.height) / FRAME.width / 2) * 2 };
};

/** Every beat as pixels, with what drawing its new lines on needs. */
export async function sceneRasters(a: Animated, rasterize: Pixels, opts: PixelOptions = {}): Promise<SceneRaster[]> {
  const { width, height } = frameSize(opts.width);
  const k = width / FRAME.width;
  const list = scenes(a, opts);
  const out: SceneRaster[] = [];
  for (const [i, s] of list.entries()) {
    const full = await rasterize(s.svg, width, height);
    const words = s.words ? { words: pixels(s.words, k, width, height) } : {};
    const added = opts.drawLines ? newLines(a.beats[i - 1], a.beats[i]!, a.graph) : [];
    if (!added.length || !s.without) {
      out.push({ full, ...words });
      continue;
    }
    const without = await rasterize(s.without(added), width, height);
    out.push({ full, ...words, lines: { without, paths: added.map((e) => s.path(e).map((p) => ({ x: p.x * k, y: p.y * k }))) } });
  }
  return out;
}

/** A box in frame units as whole pixels, inside the frame. */
function pixels(b: { x: number; y: number; width: number; height: number }, k: number, width: number, height: number) {
  const x = Math.max(0, Math.floor(b.x * k));
  const y = Math.max(0, Math.floor(b.y * k));
  return { x, y, width: Math.min(width, Math.ceil((b.x + b.width) * k)) - x, height: Math.min(height, Math.ceil((b.y + b.height) * k)) - y };
}

/** GIF frames come at most this often: more only makes the file bigger, and browsers slow down very short delays. */
export const GIF_FPS = 15;

/** The animation as a GIF. */
export function gifOf(list: SceneRaster[], timing: Timing = {}, opts: GifOptions = {}): Uint8Array {
  const { width, height } = list[0]!.full;
  return encodeGif(width, height, frames(list, { loop: true, ...timing, fps: Math.min(GIF_FPS, timing.fps ?? GIF_FPS) }), list.map((s) => s.full.data), opts);
}
