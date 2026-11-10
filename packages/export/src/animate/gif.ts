// An animated GIF, written here: diagrams are flat colours with anti-aliased edges, so one palette for
// the whole animation (median cut over the exact colours of its scenes) keeps every fill exact, and
// each frame only stores the rectangle that changed, the unchanged pixels in it transparent so LZW
// packs them as runs.

export interface GifOptions {
  /** Most colours in the palette (2 to 255; one more index is kept for "unchanged"). Default 255. */
  colours?: number;
  /** Play forever (default) or once. */
  loop?: boolean;
}

/**
 * A palette of at most `max` colours for these pictures: median cut over their exact colours, each
 * box split where the most error is, so a large flat fill keeps its own exact colour and the few
 * pixels in between share what is left.
 */
export function palette(pictures: Uint8Array[], max = 255): Uint8Array {
  const counts = new Map<number, number>();
  for (const data of pictures)
    for (let i = 0; i < data.length; i += 4) {
      const c = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  const colours = [...counts.keys()];
  const weight = colours.map((c) => counts.get(c)!);
  const ch = (c: number, k: number) => (c >> (16 - 8 * k)) & 255;
  interface Box {
    items: number[];
    error: number;
    axis: number;
  }
  const measure = (items: number[]): Box => {
    let n = 0;
    const sum = [0, 0, 0];
    const sq = [0, 0, 0];
    for (const i of items) {
      const w = weight[i]!;
      n += w;
      for (let k = 0; k < 3; k++) {
        const v = ch(colours[i]!, k);
        sum[k]! += w * v;
        sq[k]! += w * v * v;
      }
    }
    const spread = sq.map((s, k) => s - (sum[k]! * sum[k]!) / n);
    const axis = spread.indexOf(Math.max(...spread));
    return { items, error: items.length > 1 ? spread[0]! + spread[1]! + spread[2]! : 0, axis };
  };
  const boxes: Box[] = [measure(colours.map((_, i) => i))];
  while (boxes.length < max) {
    let worst = 0;
    for (let b = 1; b < boxes.length; b++) if (boxes[b]!.error > boxes[worst]!.error) worst = b;
    const box = boxes[worst]!;
    if (box.error <= 0) break;
    const sorted = [...box.items].sort((a, b) => ch(colours[a]!, box.axis) - ch(colours[b]!, box.axis));
    // Split at the weighted median, but never leave a side empty.
    const half = sorted.reduce((s, i) => s + weight[i]!, 0) / 2;
    let acc = 0;
    let cut = 1;
    for (let j = 0; j < sorted.length - 1; j++) {
      acc += weight[sorted[j]!]!;
      if (acc >= half) {
        cut = j + 1;
        break;
      }
      cut = j + 1;
    }
    boxes.splice(worst, 1, measure(sorted.slice(0, cut)), measure(sorted.slice(cut)));
  }
  const out = new Uint8Array(boxes.length * 3);
  for (const [b, box] of boxes.entries()) {
    // The box's colour is its most common one when that one dominates (a fill stays exact), else the weighted mean.
    let n = 0;
    let top = box.items[0]!;
    const sum = [0, 0, 0];
    for (const i of box.items) {
      const w = weight[i]!;
      n += w;
      if (w > weight[top]!) top = i;
      for (let k = 0; k < 3; k++) sum[k]! += w * ch(colours[i]!, k);
    }
    const exact = weight[top]! * 2 >= n;
    for (let k = 0; k < 3; k++) out[b * 3 + k] = exact ? ch(colours[top]!, k) : Math.round(sum[k]! / n);
  }
  return out;
}

/** Pixels to palette indices, the nearest colour each, remembered per colour. */
export function indexer(pal: Uint8Array) {
  const cache = new Map<number, number>();
  const n = pal.length / 3;
  const nearest = (r: number, g: number, b: number) => {
    let best = 0;
    let dist = Infinity;
    for (let j = 0; j < n; j++) {
      const dr = r - pal[j * 3]!;
      const dg = g - pal[j * 3 + 1]!;
      const db = b - pal[j * 3 + 2]!;
      // Green counts most, blue least: closer to what the eye sees as near.
      const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (d < dist) ((dist = d), (best = j));
    }
    return best;
  };
  return (data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(data.length / 4);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const c = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
      let j = cache.get(c);
      if (j === undefined) cache.set(c, (j = nearest(data[i]!, data[i + 1]!, data[i + 2]!)));
      out[p] = j;
    }
    return out;
  };
}

class Bytes {
  buf = new Uint8Array(1 << 16);
  length = 0;
  room(n: number) {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }
  byte(b: number) {
    this.room(1);
    this.buf[this.length++] = b;
  }
  u16(v: number) {
    this.byte(v & 255);
    this.byte((v >> 8) & 255);
  }
  bytes(b: ArrayLike<number>) {
    this.room(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }
  ascii(s: string) {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
  }
  done() {
    return this.buf.slice(0, this.length);
  }
}

const seen = new Int32Array(1 << 20);
const codes = new Int16Array(1 << 20);
let generation = 0;

/** GIF's LZW: variable-width codes from minSize+1 up to 12 bits, the table cleared when full, in sub-blocks of 255 bytes. */
function lzw(out: Bytes, pixels: Uint8Array, minSize: number) {
  out.byte(minSize);
  const clear = 1 << minSize;
  const eoi = clear + 1;
  let next = eoi + 1;
  let size = minSize + 1;
  let acc = 0;
  let bits = 0;
  const block = new Uint8Array(255);
  let fill = 0;
  const flush = () => {
    out.byte(fill);
    out.bytes(block.subarray(0, fill));
    fill = 0;
  };
  const emit = (code: number) => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) {
      block[fill++] = acc & 255;
      if (fill === 255) flush();
      acc >>>= 8;
      bits -= 8;
    }
  };
  if (++generation > 0x7ffffff0) (seen.fill(0), (generation = 1));
  emit(clear);
  let prefix = pixels[0]!;
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i]!;
    const key = (prefix << 8) | k;
    if (seen[key] === generation) {
      prefix = codes[key]!;
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      next = eoi + 1;
      size = minSize + 1;
      generation++;
    } else {
      if (next >= 1 << size) size++;
      seen[key] = generation;
      codes[key] = next++;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) block[fill++] = acc & 255;
  if (fill) flush();
  out.byte(0);
}

/** Writes frames as they come: give it the palette, then each frame's pixels and how long it shows. */
export class GifWriter {
  private out = new Bytes();
  private last?: Uint8Array;
  private pending?: { left: number; top: number; width: number; height: number; pixels: Uint8Array; delay: number };
  /** Rounding of delays to hundredths, carried over so the whole runs as long as asked. */
  private drift = 0;
  private readonly clearIndex: number;
  private readonly size: number;
  private readonly index: (rgba: Uint8Array) => Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    pal: Uint8Array,
    opts: GifOptions = {},
  ) {
    const n = pal.length / 3;
    // One index more than the colours: "as before", for pixels a frame does not change.
    this.clearIndex = n;
    let bits = 1;
    while (1 << bits < n + 1) bits++;
    this.size = bits;
    this.index = indexer(pal);
    const o = this.out;
    o.ascii('GIF89a');
    o.u16(width);
    o.u16(height);
    o.byte(0x80 | 0x70 | (bits - 1));
    o.byte(0);
    o.byte(0);
    const table = new Uint8Array(3 << bits);
    table.set(pal);
    o.bytes(table);
    if (opts.loop !== false) {
      o.bytes([0x21, 0xff, 11]);
      o.ascii('NETSCAPE2.0');
      o.bytes([3, 1, 0, 0, 0]);
    }
  }

  /** A frame of RGBA pixels, shown `ms` milliseconds. One that changes nothing lengthens the frame before it. */
  frame(rgba: Uint8Array, ms: number) {
    const now = this.index(rgba);
    const prev = this.last;
    const { width: W, height: H } = this;
    let x0 = 0;
    let y0 = 0;
    let x1 = W - 1;
    let y1 = H - 1;
    if (prev) {
      x0 = W;
      y0 = H;
      x1 = -1;
      y1 = -1;
      for (let y = 0; y < H; y++) {
        const row = y * W;
        for (let x = 0; x < W; x++)
          if (now[row + x] !== prev[row + x]) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            y1 = y;
          }
      }
      if (x1 < 0) {
        if (this.pending) this.pending.delay += ms;
        return;
      }
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const pixels = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = (y + y0) * W + x + x0;
        pixels[y * w + x] = prev && now[p] === prev[p] ? this.clearIndex : now[p]!;
      }
    this.flush();
    this.pending = { left: x0, top: y0, width: w, height: h, pixels, delay: ms };
    this.last = now;
  }

  private flush() {
    const f = this.pending;
    if (!f) return;
    this.pending = undefined;
    const exact = f.delay / 10 + this.drift;
    const cs = Math.max(2, Math.round(exact));
    this.drift = exact - cs;
    const o = this.out;
    // Graphic control: leave the frame in place (disposal 1), the extra index transparent.
    o.bytes([0x21, 0xf9, 4, (1 << 2) | 1]);
    o.u16(Math.min(65535, cs));
    o.byte(this.clearIndex);
    o.byte(0);
    o.byte(0x2c);
    o.u16(f.left);
    o.u16(f.top);
    o.u16(f.width);
    o.u16(f.height);
    o.byte(0);
    lzw(o, f.pixels, Math.max(2, this.size));
  }

  /** The finished file. */
  end(): Uint8Array {
    this.flush();
    this.out.byte(0x3b);
    return this.out.done();
  }
}

/** A whole GIF from frames: the palette from the pictures given (the scenes; blends lie between their colours). */
export function encodeGif(width: number, height: number, frames: Iterable<{ data: Uint8Array; duration: number }>, samples: Uint8Array[], opts: GifOptions = {}): Uint8Array {
  const gif = new GifWriter(width, height, palette(samples, Math.max(2, Math.min(255, opts.colours ?? 255))), opts);
  for (const f of frames) gif.frame(f.data, f.duration);
  return gif.end();
}
