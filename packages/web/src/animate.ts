// "Animation (GIF / MP4)": the drawing's steps (or its layers) as a GIF, encoded here, or as a video
// the browser encodes itself (WebCodecs: H.264 into MP4, VP9 into WebM). Nothing leaves the browser.
// The frames are the CLI's (packages/export/src/animate), drawn by a canvas instead of resvg.
import { render, type RenderResult } from '@cartography/engine';
import type { Animated, Chunk, Raster, SceneRaster } from '@cartography/export';
import { options, type ExportInput } from './export.ts';

export type AnimationFormat = 'gif' | 'mp4' | 'webm';

export interface AnimationChoice {
  format: AnimationFormat;
  /** 1280 or 1920: the frame is 16:9. */
  width: number;
  /** Seconds per beat. */
  hold: number;
  transitions: boolean;
  drawLines: boolean;
  /** The steps, or the layers one after the other. */
  story: 'steps' | 'layers';
}

/** What the drawing on screen can tell: its steps, its layers. */
export async function storiesOf(input: ExportInput): Promise<{ steps: number; layers: number }> {
  const r = await render(input.text, { ...options(input), step: undefined, fonts: 'none' });
  return { steps: r.steps?.length ?? 0, layers: r.layers?.list.length ?? 0 };
}

/** The codecs this browser encodes, the first that works per container. */
const CODECS: Record<'mp4' | 'webm', string[]> = { mp4: ['avc1.640028', 'avc1.4d0028', 'avc1.42e028'], webm: ['vp09.00.40.08', 'vp8'] };

async function codecFor(format: 'mp4' | 'webm', width: number, height: number): Promise<VideoEncoderConfig | undefined> {
  if (typeof VideoEncoder === 'undefined') return undefined;
  for (const codec of CODECS[format]) {
    const config: VideoEncoderConfig = { codec, width, height, bitrate: width >= 1920 ? 6_000_000 : 3_000_000, framerate: 30, ...(format === 'mp4' ? { avc: { format: 'avc' } } : {}) };
    try {
      if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
    } catch {
      // not this one
    }
  }
  return undefined;
}

/** Which video formats this browser can make: the menu offers only those. */
export async function videoFormats(): Promise<Record<'mp4' | 'webm', boolean>> {
  const [mp4, webm] = await Promise.all([codecFor('mp4', 1280, 720), codecFor('webm', 1280, 720)]);
  return { mp4: !!mp4, webm: !!webm };
}

/** An SVG drawn by the browser into RGBA pixels. */
async function rasterize(svg: string, width: number, height: number): Promise<Raster> {
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    await img.decode();
    // Safari can report the image ready before its embedded fonts are; give it a frame.
    await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, width, height);
    return { data: new Uint8Array(g.getImageData(0, 0, width, height).data.buffer), width, height };
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

export type Progress = (what: string, done: number) => void;

/** The animation as a file: the beats drawn, the frames between them made, then encoded. */
export async function exportAnimation(input: ExportInput, choice: AnimationChoice, progress: Progress = () => {}): Promise<Blob> {
  const ex = await import('@cartography/export');
  // Layers are walked over the whole drawing, whatever is switched on in the editor.
  const base: ExportInput = choice.story === 'layers' ? { ...input, layers: undefined, layerMode: undefined } : input;
  const r = await render(base.text, { ...options(base), step: undefined });
  if (!r.graph || !r.placed || !r.theme || r.diagnostics.some((d) => d.severity === 'error')) throw new Error('Nothing to export: fix the problems first');
  const beats = choice.story === 'layers' ? await layerBeats(base, r, ex.layerBeats) : r.steps?.length ? ex.stepBeats(r.steps, r.faded) : undefined;
  if (!beats?.length) throw new Error(choice.story === 'layers' ? 'This diagram has no layers' : 'This diagram has no steps to animate');
  const anim: Animated = { graph: r.graph, placed: r.placed, theme: r.theme, beats, ...(r.images ? { images: r.images } : {}) };
  let drawn = 0;
  const total = beats.length + (choice.drawLines ? beats.length - 1 : 0);
  const list: SceneRaster[] = await ex.sceneRasters(
    anim,
    async (svg, w, h) => {
      progress('Drawing the steps', Math.min(1, drawn++ / total));
      return rasterize(svg, w, h);
    },
    { fonts: 'embed', width: choice.width, drawLines: choice.drawLines },
  );
  const timing = { hold: choice.hold, transition: choice.transitions ? 0.5 : 0 };
  if (choice.format === 'gif') {
    progress('Making the GIF', 0);
    // Give the progress a frame to show before the encoder holds the thread.
    await new Promise((ok) => setTimeout(ok, 30));
    return new Blob([ex.gifOf(list, timing) as BlobPart], { type: 'image/gif' });
  }
  const { width, height } = list[0]!.full;
  const config = await codecFor(choice.format, width, height);
  if (!config) throw new Error(`This browser cannot encode ${choice.format === 'mp4' ? 'H.264 (MP4)' : 'VP9 (WebM)'} video: pick ${choice.format === 'mp4' ? 'WebM' : 'MP4'} or GIF`);
  const fps = 30;
  const chunks: Chunk[] = [];
  let description: Uint8Array | undefined;
  let failed: Error | undefined;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({ data, timestamp: chunk.timestamp, duration: chunk.duration ?? 1e6 / fps, key: chunk.type === 'key' });
      const d = meta?.decoderConfig?.description;
      if (d && !description) description = ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength).slice() : new Uint8Array(d).slice();
    },
    error: (e) => (failed = e instanceof Error ? e : new Error(String(e))),
  });
  encoder.configure(config);
  const all = ex.duration(list, { ...timing, fps });
  let n = 0;
  let carry = 0;
  // A fixed rate: a hold is the same frame again, so every player keeps time.
  for (const f of ex.frames(list, { ...timing, fps })) {
    const exact = (f.duration * fps) / 1000 + carry;
    const times = Math.max(1, Math.round(exact));
    carry = exact - times;
    for (let i = 0; i < times; i++, n++) {
      if (failed) throw failed;
      const frame = new VideoFrame(f.data, { format: 'RGBA', codedWidth: width, codedHeight: height, timestamp: Math.round((n * 1e6) / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: n % (fps * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 4) await new Promise((ok) => setTimeout(ok, 2));
      if (n % 15 === 0) progress('Encoding the video', Math.min(1, (n * 1000) / fps / all));
    }
  }
  await encoder.flush();
  encoder.close();
  if (failed) throw failed;
  chunks.sort((a, b) => a.timestamp - b.timestamp);
  const track = { width, height, ...(description ? { description } : {}) };
  const data = choice.format === 'mp4' ? ex.mp4(chunks, track) : ex.webm(chunks, { ...track, codec: config.codec === 'vp8' ? 'V_VP8' : 'V_VP9' });
  return new Blob([data as BlobPart], { type: choice.format === 'mp4' ? 'video/mp4' : 'video/webm' });
}

/** Every layer faded in place over the same drawing, so nothing moves between beats. */
async function layerBeats(input: ExportInput, whole: RenderResult, beats: typeof import('@cartography/export').layerBeats) {
  const list = whole.layers?.list ?? [];
  const each = await Promise.all(list.map((l) => render(input.text, { ...options(input), layers: [l.name], layerMode: 'dim', previous: whole.placed?.memory ?? null, step: undefined, fonts: 'none' })));
  const layers = list.flatMap((l, i) => (each[i]?.faded ? [{ name: l.name, ...(l.title ? { title: l.title } : {}), ...(l.caption ? { caption: l.caption } : {}), faded: each[i]!.faded! }] : []));
  return beats(whole.stepsImplied ? undefined : whole.steps, layers, whole.graph?.title ? `${whole.graph.title}: the whole drawing` : undefined);
}
