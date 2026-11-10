// A PNG of RGBA pixels, for frames written one by one (the CLI's frames when there is no ffmpeg).
import { zlibSync } from 'fflate';

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  v.setUint32(8 + body.length, crc(out.subarray(4, 8 + body.length)));
  return out;
}

/** RGB, no filter: frames are flat colour, and deflate packs those rows well enough. */
export function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0, o = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0, i = y * width * 4; x < width; x++, i += 4) ((raw[o++] = rgba[i]!), (raw[o++] = rgba[i + 1]!), (raw[o++] = rgba[i + 2]!));
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) (out.set(p, at), (at += p.length));
  return out;
}
