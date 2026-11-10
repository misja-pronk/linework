// carto animate: a diagram's steps (or its layers, or a walk along a route) as an animated GIF, or as
// an MP4 or WebM through ffmpeg when it is on the PATH. Without ffmpeg there is no video encoder to
// be had without a dependency, so the GIF is written with the frames as PNGs and the ffmpeg command
// that makes the video from them.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Resvg } from '@resvg/resvg-js';
import { allFontFiles } from '@cartography/theme/node';
import { duration, encodePng, frames, frameSize, gifOf, layerBeats, stepBeats, sceneRasters, walkBeats, type Animated, type Raster, type SceneRaster, type Timing } from '@cartography/export';
import { render, type RenderOptions, type RenderResult } from '@cartography/engine';

export interface AnimateFlags {
  out: string;
  layers?: boolean;
  walk?: string;
  hold?: number;
  transition?: number;
  fps?: number;
  width?: number;
  drawLines?: boolean;
  captions?: boolean;
}

export type Say = { info: (s: string) => void; warn: (s: string) => void; error: (s: string) => void; diagnostics: (r: RenderResult) => void };

/** `--size 1920x1080` (or 1080p, 720p): the frame width; the frame is 16:9 whatever the height says. */
export function sizeFlag(v: string | undefined, warn: (s: string) => void): number | undefined {
  if (v == null) return undefined;
  const named: Record<string, number> = { '720p': 1280, '1080p': 1920 };
  if (named[v]) return named[v];
  const m = /^(\d+)\s*[x×]\s*(\d+)$/.exec(v);
  if (!m || Number(m[1]) < 160 || Number(m[1]) > 3840) throw new Error(`--size is like 1280x720 or 1920x1080, not "${v}"`);
  const [w, h] = [Number(m[1]), Number(m[2])];
  if (Math.abs(w / h - 16 / 9) > 0.01) warn(`--size ${v} is not 16:9: frames are ${frameSize(w).width}×${frameSize(w).height}`);
  return w;
}

/** ffmpeg on the PATH, if there is one; nothing is ever installed. */
export function findFfmpeg(): string | undefined {
  const exe = process.platform === 'win32' ? ['ffmpeg.exe'] : ['ffmpeg'];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean))
    for (const e of exe) {
      const p = path.join(dir, e);
      try {
        fs.accessSync(p, fs.constants.X_OK);
        if (fs.statSync(p).isFile()) return p;
      } catch {
        // not here
      }
    }
  return undefined;
}

const fontFiles = allFontFiles.map((u) => decodeURIComponent(u.pathname));
/** Pixels by resvg, with the bundled fonts, so a frame looks the same on every machine. */
const rasterize = (extra: string[]) => (svg: string, width: number): Raster => {
  const img = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { fontFiles: [...extra, ...fontFiles], loadSystemFonts: false, defaultFontFamily: 'Inter' } }).render();
  return { data: new Uint8Array(img.pixels.buffer, img.pixels.byteOffset, img.pixels.byteLength), width: img.width, height: img.height };
};

/** The beats asked for: a walk, the layers, or the steps (written, else those the drawing implies). */
async function beatsOf(text: string, opts: RenderOptions, r: RenderResult, flags: AnimateFlags, say: Say): Promise<Animated['beats'] | undefined> {
  if (flags.walk) return walkBeats(r.graph!, flags.walk, say.error);
  if (flags.layers) {
    const list = r.layers?.list ?? [];
    if (!list.length) return say.error('--layers: this diagram has no layers: (see docs/layers.md)'), undefined;
    // Every layer faded in place over the same drawing: nothing moves between beats.
    const each = await Promise.all(list.map((l) => render(text, { ...opts, layers: l.name, layerMode: 'dim', previous: r.placed?.memory ?? null })));
    const layers = list.flatMap((l, i) => (each[i]?.faded ? [{ name: l.name, ...(l.title ? { title: l.title } : {}), ...(l.caption ? { caption: l.caption } : {}), faded: each[i]!.faded! }] : []));
    return layerBeats(r.stepsImplied ? undefined : r.steps, layers, r.graph?.title ? `${r.graph.title}: the whole drawing` : undefined);
  }
  if (!r.steps?.length) return say.error(`nothing to animate: no steps:${r.layers?.list.length ? ', try --layers' : ''} (or --walk "a -> b -> c"; see docs/animate.md)`), undefined;
  return stepBeats(r.steps, r.faded);
}

/** Writes the animation of one diagram to flags.out (.gif, .mp4 or .webm). */
export async function animate(text: string, opts: RenderOptions, flags: AnimateFlags, shown: string, say: Say, extraFonts: string[] = []): Promise<boolean> {
  const ext = path.extname(flags.out).slice(1).toLowerCase();
  if (!['gif', 'mp4', 'webm'].includes(ext)) throw new Error(`-o ${flags.out}: an animation is a .gif, .mp4 or .webm`);
  const r = await render(text, { ...opts, fonts: 'none', step: undefined });
  say.diagnostics(r);
  if (!r.graph || !r.placed || !r.theme || r.diagnostics.some((d) => d.severity === 'error')) return say.error('nothing written'), false;
  const beats = await beatsOf(text, opts, r, flags, say);
  if (!beats?.length) return false;
  const anim: Animated = { graph: r.graph, placed: r.placed, theme: r.theme, beats, ...(r.images ? { images: r.images } : {}) };
  const list = await sceneRasters(anim, rasterize(extraFonts), { width: flags.width, drawLines: flags.drawLines, captions: flags.captions });
  const timing: Timing = { ...(flags.hold != null ? { hold: flags.hold } : {}), ...(flags.transition != null ? { transition: flags.transition } : {}) };
  const { width, height } = list[0]!.full;
  fs.mkdirSync(path.dirname(path.resolve(flags.out)), { recursive: true });
  const what = `${width}×${height}, ${beats.length} beats`;
  if (ext === 'gif') {
    const gif = gifOf(list, timing);
    fs.writeFileSync(flags.out, gif);
    say.info(`${shown} → ${flags.out}  ${what}, ${seconds(duration(list, { loop: true, ...timing, fps: 15 }))}, ${megabytes(gif.length)}`);
    return true;
  }
  const fps = flags.fps ?? 30;
  const ffmpeg = findFfmpeg();
  if (ffmpeg) {
    await video(ffmpeg, list, { ...timing, fps }, flags.out, ext as 'mp4' | 'webm');
    say.info(`${shown} → ${flags.out}  ${what}, ${seconds(duration(list, { ...timing, fps }))} at ${fps} fps, ${megabytes(fs.statSync(flags.out).size)}`);
    return true;
  }
  // No encoder: the GIF, and the frames with how long each shows, for ffmpeg on another machine.
  const gifPath = flags.out.replace(/\.\w+$/, '.gif');
  fs.writeFileSync(gifPath, gifOf(list, timing));
  const dir = flags.out.replace(/\.\w+$/, '-frames');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const lines: string[] = ['ffconcat version 1.0'];
  let n = 0;
  for (const f of frames(list, { ...timing, fps })) {
    const name = `frame-${String(++n).padStart(4, '0')}.png`;
    fs.writeFileSync(path.join(dir, name), encodePng(f.data, width, height));
    lines.push(`file ${name}`, `duration ${(f.duration / 1000).toFixed(4)}`);
  }
  // The concat demuxer takes the last frame's duration only when the frame is listed once more.
  lines.push(`file frame-${String(n).padStart(4, '0')}.png`);
  fs.writeFileSync(path.join(dir, 'frames.txt'), lines.join('\n') + '\n');
  const codec = ext === 'mp4' ? '-c:v libx264 -pix_fmt yuv420p -movflags +faststart' : '-c:v libvpx-vp9 -b:v 0 -crf 32';
  say.warn(`ffmpeg is not on the PATH, so no ${ext.toUpperCase()}: wrote ${gifPath} and the frames in ${dir}/. With ffmpeg installed:\n  ffmpeg -f concat -i ${path.join(dir, 'frames.txt')} -r ${fps} ${codec} ${flags.out}`);
  return true;
}

/** Frames into ffmpeg as raw RGBA at a fixed rate: a hold is the same frame again. */
function video(ffmpeg: string, list: SceneRaster[], timing: Timing & { fps: number }, out: string, ext: 'mp4' | 'webm'): Promise<void> {
  const { width, height } = list[0]!.full;
  const codec = ext === 'mp4' ? ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'] : ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', 'yuv420p'];
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', String(timing.fps), '-i', '-', '-g', String(timing.fps * 2), ...codec, out];
  const child = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d: Buffer) => (err += d.toString()));
  const done = new Promise<void>((ok, fail) => {
    child.on('error', fail);
    child.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg failed (${code}): ${err.trim().split('\n').slice(-3).join(' ')}`))));
  });
  const write = (b: Uint8Array) => new Promise<void>((ok, fail) => (child.stdin.write(b, (e) => (e ? fail(e) : ok()))));
  return (async () => {
    // Whole frames per frame's duration, the rounding carried so the video runs as long as the timeline.
    let carry = 0;
    try {
      for (const f of frames(list, timing)) {
        const exact = (f.duration * timing.fps) / 1000 + carry;
        const n = Math.max(1, Math.round(exact));
        carry = exact - n;
        for (let i = 0; i < n; i++) await write(f.data);
      }
    } finally {
      child.stdin.end();
    }
    await done;
  })();
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const megabytes = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(2)} MB` : `${Math.round(bytes / 1000)} kB`);
