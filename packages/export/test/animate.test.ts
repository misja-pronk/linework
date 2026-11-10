import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render } from '@cartography/engine';
import { duration, encodeGif, frames, GifWriter, layerBeats, mp4, newLines, palette, scenes, stepBeats, walkBeats, webm, type Raster, type SceneRaster } from '../src/index.ts';

const example = (f: string) => fs.readFileSync(new URL(`../../../examples/${f}`, import.meta.url), 'utf8');

/** A GIF read back the plain way: every frame composed onto the canvas, as a viewer shows it. */
function decodeGif(bytes: Uint8Array) {
  let p = 0;
  const u16 = () => bytes[p++]! | (bytes[p++]! << 8);
  expect(String.fromCharCode(...bytes.subarray(0, 6))).toBe('GIF89a');
  p = 6;
  const width = u16();
  const height = u16();
  const packed = bytes[p++]!;
  p += 2;
  const table = bytes.subarray(p, p + 3 * (2 << (packed & 7)));
  p += table.length;
  const canvas = new Uint8Array(width * height * 4);
  const out: { rgba: Uint8Array; delay: number }[] = [];
  let loops = false;
  let delay = 0;
  let transparent = -1;
  const blocks = () => {
    const parts: number[] = [];
    for (let n = bytes[p++]!; n; n = bytes[p++]!) (parts.push(...bytes.subarray(p, p + n)), (p += n));
    return parts;
  };
  for (;;) {
    const kind = bytes[p++];
    if (kind === 0x3b) break;
    if (kind === 0x21) {
      const label = bytes[p++];
      if (label === 0xf9) {
        p++;
        const flags = bytes[p++]!;
        delay = u16();
        transparent = flags & 1 ? bytes[p]! : -1;
        p += 2;
      } else if (label === 0xff) {
        loops = String.fromCharCode(...bytes.subarray(p + 1, p + 12)) === 'NETSCAPE2.0';
        p += 12;
        blocks();
      } else blocks();
      continue;
    }
    expect(kind).toBe(0x2c);
    const [left, top, w, h] = [u16(), u16(), u16(), u16()];
    p++;
    const min = bytes[p++]!;
    const data = blocks();
    // LZW, the textbook way.
    const clear = 1 << min;
    let size = min + 1;
    let dict: number[][] = [];
    const reset = () => ((dict = Array.from({ length: clear + 2 }, (_, i) => [i])), (size = min + 1));
    reset();
    const pixels: number[] = [];
    let prev: number[] | undefined;
    let bit = 0;
    while (bit + size <= data.length * 8) {
      let code = 0;
      for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3]! >> (bit & 7)) & 1) << i;
      if (code === clear) {
        reset();
        prev = undefined;
        continue;
      }
      if (code === clear + 1) break;
      const entry = code < dict.length ? dict[code]! : [...prev!, prev![0]!];
      pixels.push(...entry);
      if (prev && dict.length < 4096) dict.push([...prev, entry[0]!]);
      if (dict.length === 1 << size && size < 12) size++;
      prev = entry;
    }
    expect(pixels.length).toBe(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = pixels[y * w + x]!;
        if (i === transparent) continue;
        const o = ((y + top) * width + x + left) * 4;
        canvas.set([table[i * 3]!, table[i * 3 + 1]!, table[i * 3 + 2]!, 255], o);
      }
    out.push({ rgba: canvas.slice(), delay });
  }
  return { width, height, frames: out, loops };
}

/** A picture of `n` flat colours in random blocks, seeded. */
function picture(width: number, height: number, n: number, seed: number): Uint8Array {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s / 0x7fffffff);
  const colours = Array.from({ length: n }, (_, i) => [(i * 37) & 255, (i * 91 + 17) & 255, (i * 53 + 101) & 255]);
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const c = colours[Math.floor(rnd() * n)]!;
    out.set([c[0]!, c[1]!, c[2]!, 255], i * 4);
  }
  return out;
}

describe('GIF', () => {
  it('reads back exactly as written: changed rectangles, unchanged pixels see-through, delays kept', () => {
    const [W, H] = [64, 48];
    const a = picture(W, H, 40, 1);
    const b = a.slice();
    // A change in one corner only.
    for (let y = 30; y < 40; y++) for (let x = 50; x < 60; x++) b.set([10, 200, 30, 255], (y * W + x) * 4);
    const gif = encodeGif(W, H, [
      { data: a, duration: 1000 },
      { data: b, duration: 200 },
      { data: b, duration: 300 },
      { data: a, duration: 2500 },
    ], [a, b]);
    const read = decodeGif(gif);
    expect([read.width, read.height, read.loops]).toEqual([W, H, true]);
    // The repeated frame is one frame, shown as long as both.
    expect(read.frames.map((f) => f.delay)).toEqual([100, 50, 250]);
    expect(read.frames[0]!.rgba).toEqual(a);
    expect(read.frames[1]!.rgba).toEqual(b);
    expect(read.frames[2]!.rgba).toEqual(a);
  });

  it('survives the code table filling up many times over', () => {
    const [W, H] = [300, 200];
    const a = picture(W, H, 250, 7);
    const read = decodeGif(encodeGif(W, H, [{ data: a, duration: 100 }], [a]));
    expect(read.frames[0]!.rgba).toEqual(a);
  });

  it('keeps large flat fills exact when colours must be shared', () => {
    // Two paper tints a few steps apart, and a ramp of anti-aliasing between ink and paper.
    const W = 200;
    const data = new Uint8Array(W * W * 4);
    for (let i = 0; i < W * W; i++) {
      const x = i % W;
      const c = x < 90 ? [0xf7, 0xf4, 0xee] : x < 180 ? [0xf3, 0xef, 0xe7] : [x * 9, x * 5, (x * 13) & 255];
      data.set([c[0]! & 255, c[1]! & 255, c[2]! & 255, 255], i * 4);
    }
    const ramp = picture(100, 100, 1000, 3);
    const pal = palette([data, ramp], 32);
    const has = (r: number, g: number, b: number) => [...Array(pal.length / 3).keys()].some((j) => pal[j * 3] === r && pal[j * 3 + 1] === g && pal[j * 3 + 2] === b);
    expect(pal.length / 3).toBeLessThanOrEqual(32);
    expect(has(0xf7, 0xf4, 0xee)).toBe(true);
    expect(has(0xf3, 0xef, 0xe7)).toBe(true);
  });

  it('carries the rounding of delays so the whole runs as long as asked', () => {
    const a = picture(8, 8, 3, 1);
    const b = picture(8, 8, 3, 2);
    const gif = new GifWriter(8, 8, palette([a, b]));
    // 15 frames a second do not divide into hundredths: 6.67 each.
    for (let i = 0; i < 30; i++) gif.frame(i % 2 ? a : b, 1000 / 15);
    const delays = decodeGif(gif.end()).frames.map((f) => f.delay);
    expect(delays.reduce((s, d) => s + d, 0)).toBe(200);
  });
});

describe('timeline', () => {
  const flat = (v: number): Raster => ({ data: new Uint8Array(16 * 9 * 4).fill(v), width: 16, height: 9 });
  const list: SceneRaster[] = [{ full: flat(0) }, { full: flat(100) }, { full: flat(200) }];

  it('holds each beat, blends between them and adds up to its duration', () => {
    const fs = [...frames(list, { hold: 2, transition: 0.5, endHold: 3, fps: 10 })];
    // A hold, four blends, a hold, four blends, the end hold.
    expect(fs.length).toBe(1 + 4 + 1 + 4 + 1);
    expect(fs.map((f) => f.duration).reduce((s, d) => s + d, 0)).toBeCloseTo(2000 + 400 + 2000 + 400 + 3000);
    expect(duration(list, { hold: 2, transition: 0.5, endHold: 3, fps: 10 })).toBeCloseTo(7800);
    // The blends go one way, slow at both ends.
    const mids = fs.slice(1, 5).map((f) => f.data[0]!);
    expect(mids).toEqual([...mids].sort((a, b) => a - b));
    expect(mids[0]!).toBeGreaterThan(0);
    expect(mids[3]!).toBeLessThan(100);
  });

  it('cuts without a transition, and loops back to the first beat when asked', () => {
    expect([...frames(list, { transition: 0 })].length).toBe(3);
    const looped = [...frames(list, { hold: 1, transition: 0.5, fps: 10, loop: true })];
    expect(looped.length).toBe(1 + 4 + 1 + 4 + 1 + 4);
    expect(duration(list, { hold: 1, transition: 0.5, fps: 10, loop: true })).toBeCloseTo(looped.reduce((s, f) => s + f.duration, 0));
  });

  it('draws a new line along its path: the start before the end', () => {
    const W = 40;
    const without = { data: new Uint8Array(W * 4 * 4).fill(255), width: W, height: 4 };
    const full = { data: without.data.slice(), width: W, height: 4 };
    for (let x = 0; x < W; x++) full.data.set([0, 0, 0, 255], (W + x) * 4);
    const fs = [...frames([{ full: without }, { full, lines: { without, paths: [[{ x: 0, y: 1.5 }, { x: W, y: 1.5 }]] } }], { transition: 0, draw: 1, fps: 10 })];
    const mid = fs[1 + 5]!.data;
    const at = (x: number) => mid[(W + x) * 4]!;
    expect(at(2)).toBe(0);
    expect(at(W - 2)).toBe(255);
  });
});

describe('scenes', () => {
  it('draws every step in the same place, the caption as a lower third', async () => {
    const r = await render(example('systems/invoice-walkthrough.yaml'), { fonts: 'none' });
    const beats = stepBeats(r.steps!);
    const list = scenes({ graph: r.graph!, placed: r.placed!, theme: r.theme!, beats });
    expect(list).toHaveLength(7);
    const place = (svg: string) => /<svg[^>]*\sx="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*">/.exec(svg.slice(10))?.[0].replace(/^.*?(x=)/, '$1');
    expect(new Set(list.map((s) => place(s.svg))).size).toBe(1);
    expect(list[0]!.svg).toContain('width="1280" height="720"');
    expect(list[2]!.svg).toContain('Then checkout waits for Finance');
    expect(list[2]!.svg).toContain('3 / 7');
    // The step's caption is in the lower third, not under the drawing as well.
    expect(list[2]!.svg.split('Then checkout waits for Finance').length).toBe(2);
    // Lines that appear: the bus's in step 5, the workers' in step 6.
    expect(newLines(beats[4], beats[5]!, r.graph!).length).toBeGreaterThan(0);
    expect(newLines(beats[0], beats[1]!, r.graph!)).toEqual([]);
    const id = newLines(beats[4], beats[5]!, r.graph!)[0]!;
    expect(list[5]!.path(id).every((p) => p.x >= 0 && p.x <= 1280 && p.y >= 0 && p.y <= 720)).toBe(true);
    expect(list[5]!.without!([id])).not.toBe(list[5]!.svg);
  });

  it('walks the layers in place, and a route hop by hop', async () => {
    const text = example('azure/web-shop.yaml');
    const r = await render(text, { fonts: 'none' });
    const layers = await Promise.all(r.layers!.list.map(async (l) => ({ ...l, faded: (await render(text, { fonts: 'none', layers: l.name, layerMode: 'dim' })).faded! })));
    const beats = layerBeats(undefined, layers);
    expect(beats.map((b) => b.title)).toEqual(['The whole drawing', 'Security', 'Data', 'Operations']);
    expect(Object.values(beats[2]!.state.nodes)).toContain('dim');

    const shop = await render(example('systems/invoice-walkthrough.yaml'), { fonts: 'none' });
    const walk = walkBeats(shop.graph!, 'customers -> web -> orders -> db')!;
    expect(walk.map((b) => b.title)).toEqual(['Customers → Storefront', 'Storefront → Orders', 'Orders → Orders DB']);
    // Where the walk has been stays at full strength; what it has not reached stands back.
    expect(walk[2]!.state.nodes.customers).toBeUndefined();
    expect(walk[2]!.state.nodes.erp).toBe('dim');
    expect(walk[2]!.state.nodes.db).toBe('focus');
    const said: string[] = [];
    expect(walkBeats(shop.graph!, 'nowhere -> db', (m) => said.push(m))).toBeUndefined();
    expect(said.join()).toContain('nowhere');
  });
});

describe('containers', () => {
  const chunks = [0, 1, 2, 3].map((i) => ({ data: new Uint8Array([i, i, i]), timestamp: (i * 1e6) / 30, duration: 1e6 / 30, key: i === 0 }));

  it('MP4: ftyp, moov in front with the duration, the samples where stco says', () => {
    const avcC = Uint8Array.from([1, 0x64, 0, 0x28, 0xff, 0xe0, 0, 0]);
    const file = mp4(chunks, { width: 1280, height: 720, description: avcC });
    const view = new DataView(file.buffer);
    const boxes: [string, number, number][] = [];
    for (let p = 0; p < file.length; ) {
      const size = view.getUint32(p);
      boxes.push([String.fromCharCode(...file.subarray(p + 4, p + 8)), p, size]);
      p += size;
    }
    expect(boxes.map((b) => b[0])).toEqual(['ftyp', 'moov', 'mdat']);
    const text = String.fromCharCode(...file);
    const stco = text.indexOf('stco');
    const offset = view.getUint32(stco + 12);
    expect([...file.subarray(offset, offset + 6)]).toEqual([0, 0, 0, 1, 1, 1]);
    const mvhd = text.indexOf('mvhd');
    expect(view.getUint32(mvhd + 16)).toBe(1000);
    expect(view.getUint32(mvhd + 20)).toBe(133);
    expect(text).toContain('avcC');
  });

  it('WebM: EBML header, the duration, a block per frame', () => {
    const file = webm(chunks, { width: 640, height: 360 });
    expect([...file.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    const text = String.fromCharCode(...file);
    expect(text).toContain('webm');
    expect(text).toContain('V_VP9');
    const at = text.indexOf(String.fromCharCode(0x44, 0x89, 0x88));
    expect(new DataView(file.buffer).getFloat64(at + 3)).toBeCloseTo(133.33, 1);
    expect(text.split(String.fromCharCode(0xa3)).length - 1).toBeGreaterThanOrEqual(4);
  });
});
