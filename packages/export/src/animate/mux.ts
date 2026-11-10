// Video containers for frames a browser encoded (WebCodecs): MP4 for H.264, WebM for VP9. Only what
// a player needs for one video track: everything is in memory, so sizes are known and the index
// (MP4's moov, WebM's Info with its Duration) goes in front, ready to stream.

export interface Chunk {
  data: Uint8Array;
  /** Microseconds. */
  timestamp: number;
  duration: number;
  key: boolean;
}

export interface Track {
  width: number;
  height: number;
  /** MP4: the avcC record WebCodecs hands over as decoderConfig.description. */
  description?: Uint8Array;
}

class Out {
  parts: Uint8Array[] = [];
  length = 0;
  push(b: Uint8Array) {
    this.parts.push(b);
    this.length += b.length;
  }
  join(): Uint8Array {
    const all = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) (all.set(p, at), (at += p.length));
    return all;
  }
}

const u8 = (...v: number[]) => Uint8Array.from(v);
const u16 = (v: number) => u8((v >> 8) & 255, v & 255);
const u32 = (v: number) => u8((v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255);
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const cat = (...parts: Uint8Array[]) => {
  const o = new Out();
  for (const p of parts) o.push(p);
  return o.join();
};

// --- MP4 ---------------------------------------------------------------------------------------

const box = (type: string, ...body: Uint8Array[]) => {
  const inner = cat(...body);
  return cat(u32(8 + inner.length), ascii(type), inner);
};
const full = (type: string, version: number, flags: number, ...body: Uint8Array[]) => box(type, u8(version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255), ...body);
const zeros = (n: number) => new Uint8Array(n);
const MATRIX = cat(u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000));

/** An MP4 (ISO BMFF) with one H.264 track: samples in one mdat, the moov in front. */
export function mp4(chunks: Chunk[], track: Track): Uint8Array {
  const avcC = track.description;
  if (!avcC) throw new Error('An MP4 needs the encoder’s avcC description');
  const scale = 90000;
  const ticks = (us: number) => Math.round((us * scale) / 1e6);
  // Durations from the timestamps, so rounding never adds up.
  const starts = chunks.map((c) => ticks(c.timestamp));
  const last = chunks.at(-1);
  const total = last ? ticks(last.timestamp + last.duration) : 0;
  const durations = chunks.map((_, i) => (i + 1 < chunks.length ? starts[i + 1]! : total) - starts[i]!);
  const stts: [number, number][] = [];
  for (const d of durations) {
    const run = stts.at(-1);
    if (run && run[1] === d) run[0]++;
    else stts.push([1, d]);
  }
  const keys = chunks.flatMap((c, i) => (c.key ? [i + 1] : []));
  const ms = Math.round((total / scale) * 1000);
  const { width: W, height: H } = track;
  const moov = (offset: number) =>
    box(
      'moov',
      full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(ms), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(2)),
      box(
        'trak',
        full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(ms), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(W << 16), u32(H << 16)),
        box(
          'mdia',
          full('mdhd', 0, 0, u32(0), u32(0), u32(scale), u32(total), u16(0x55c4), u16(0)),
          full('hdlr', 0, 0, u32(0), ascii('vide'), zeros(12), ascii('Cartography\0')),
          box(
            'minf',
            full('vmhd', 0, 1, zeros(8)),
            box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))),
            box(
              'stbl',
              full('stsd', 0, 0, u32(1), box('avc1', zeros(6), u16(1), zeros(16), u16(W), u16(H), u32(0x480000), u32(0x480000), u32(0), u16(1), zeros(32), u16(0x18), u16(0xffff), box('avcC', avcC))),
              full('stts', 0, 0, u32(stts.length), ...stts.flatMap(([n, d]) => [u32(n), u32(d)])),
              full('stss', 0, 0, u32(keys.length), ...keys.map(u32)),
              full('stsc', 0, 0, u32(1), u32(1), u32(chunks.length), u32(1)),
              full('stsz', 0, 0, u32(0), u32(chunks.length), ...chunks.map((c) => u32(c.data.length))),
              full('stco', 0, 0, u32(1), u32(offset)),
            ),
          ),
        ),
      ),
    );
  const ftyp = box('ftyp', ascii('isom'), u32(0x200), ascii('isom'), ascii('iso2'), ascii('avc1'), ascii('mp41'));
  const size = chunks.reduce((s, c) => s + c.data.length, 0);
  // The moov is the same size whatever offset it holds: measure it once, then write it with the real one.
  const head = ftyp.length + moov(0).length;
  const out = new Out();
  out.push(ftyp);
  out.push(moov(head + 8));
  out.push(cat(u32(8 + size), ascii('mdat')));
  for (const c of chunks) out.push(c.data);
  return out.join();
}

// --- WebM --------------------------------------------------------------------------------------

/** An EBML element: its id as written, its size as a vint, then the body. */
const el = (id: number, ...body: Uint8Array[]) => {
  const inner = cat(...body);
  const idBytes: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) idBytes.unshift(v & 255);
  return cat(Uint8Array.from(idBytes), vint(inner.length), inner);
};
function vint(n: number): Uint8Array {
  for (let len = 1; len <= 8; len++)
    if (n < 2 ** (7 * len) - 1) {
      const out = new Uint8Array(len);
      let v = n;
      for (let i = len - 1; i >= 0; i--) ((out[i] = v & 255), (v = Math.floor(v / 256)));
      out[0]! |= 1 << (8 - len);
      return out;
    }
  throw new Error('EBML size too large');
}
const uint = (id: number, v: number) => {
  const b: number[] = [];
  for (let x = v; b.length === 0 || x > 0; x = Math.floor(x / 256)) b.unshift(x & 255);
  return el(id, Uint8Array.from(b));
};
const float = (id: number, v: number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v);
  return el(id, b);
};
const text = (id: number, s: string) => el(id, ascii(s));

/** A WebM with one VP9 (or VP8) track: a cluster per key frame (and at least every 30 seconds). */
export function webm(chunks: Chunk[], track: Track & { codec?: 'V_VP9' | 'V_VP8' }): Uint8Array {
  const last = chunks.at(-1);
  const ms = last ? (last.timestamp + last.duration) / 1000 : 0;
  const header = el(0x1a45dfa3, uint(0x4286, 1), uint(0x42f7, 1), uint(0x42f2, 4), uint(0x42f3, 8), text(0x4282, 'webm'), uint(0x4287, 4), uint(0x4285, 2));
  const info = el(0x1549a966, uint(0x2ad7b1, 1_000_000), text(0x4d80, 'Cartography'), text(0x5741, 'Cartography'), float(0x4489, ms));
  const tracks = el(0x1654ae6b, el(0xae, uint(0xd7, 1), uint(0x73c5, 1), uint(0x83, 1), uint(0x9c, 0), text(0x86, track.codec ?? 'V_VP9'), el(0xe0, uint(0xb0, track.width), uint(0xba, track.height))));
  const clusters: Uint8Array[] = [];
  let start = -1;
  let blocks: Uint8Array[] = [];
  const close = () => {
    if (start >= 0) clusters.push(el(0x1f43b675, uint(0xe7, start), ...blocks));
    blocks = [];
  };
  for (const c of chunks) {
    const t = Math.round(c.timestamp / 1000);
    if (start < 0 || c.key || t - start > 30000) (close(), (start = t));
    blocks.push(el(0xa3, u8(0x81), u16((t - start) & 0xffff), u8(c.key ? 0x80 : 0), c.data));
  }
  close();
  return cat(header, el(0x18538067, info, tracks, ...clusters));
}
