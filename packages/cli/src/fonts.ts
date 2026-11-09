// Brand fonts in Node: how wide they run against Inter (so text fits), and TTF files for resvg,
// which cannot read woff2 (decompressed once into a temp cache).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as fontkit from 'fontkit';
import wawoff2 from 'wawoff2';
import { measureText, SCALE_SAMPLE, type FontFace } from '@cartography/theme';

const SIZE = 100;

type Font = { unitsPerEm: number; layout(s: string): { advanceWidth: number } };
const open = (f: FontFace) => fontkit.create(Buffer.from(f.data, 'base64')) as unknown as Font;

/** Brand width / Inter width on the same sample, from the semibold face if there is one (labels use it). */
export function fontScale(faces: FontFace[]): number | undefined {
  const face = faces.find((f) => f.weight === 600) ?? faces.find((f) => f.weight >= 500) ?? faces[0];
  if (!face) return undefined;
  try {
    const font = open(face);
    const w = (font.layout(SCALE_SAMPLE).advanceWidth / font.unitsPerEm) * SIZE;
    const weight = face.weight >= 600 ? 600 : face.weight >= 500 ? 500 : 400;
    return Math.round((w / measureText(SCALE_SAMPLE, SIZE, weight)) * 1000) / 1000;
  } catch {
    return undefined;
  }
}

const cache = path.join(os.tmpdir(), 'cartography-fonts');

/**
 * resvg picks fonts by the family name inside the file, and web-font builds often carry odd ones
 * ("Space Grotesk Light SemiBold"). Give the copy a fresh name table with the theme's family, so the
 * PNG uses the font the SVG names; weight and style still come from the OS/2 table.
 */
export function renameFamily(ttf: Buffer, family: string): Buffer {
  const n = ttf.readUInt16BE(4);
  let entry = -1;
  for (let i = 0; i < n; i++) if (ttf.toString('latin1', 12 + i * 16, 16 + i * 16) === 'name') entry = 12 + i * 16;
  if (entry < 0) return ttf;
  const records: [number, string][] = [[1, family], [2, 'Regular'], [4, family], [6, family.replace(/[^A-Za-z0-9-]/g, '')], [16, family], [17, 'Regular']];
  const strings = records.map(([, s]) => Buffer.from(s, 'utf16le').swap16());
  const head = Buffer.alloc(6 + records.length * 12);
  head.writeUInt16BE(0, 0);
  head.writeUInt16BE(records.length, 2);
  head.writeUInt16BE(head.length, 4);
  let off = 0;
  records.forEach(([id], i) => {
    const o = 6 + i * 12;
    head.writeUInt16BE(3, o); // Windows, Unicode BMP, en-US
    head.writeUInt16BE(1, o + 2);
    head.writeUInt16BE(0x409, o + 4);
    head.writeUInt16BE(id, o + 6);
    head.writeUInt16BE(strings[i]!.length, o + 8);
    head.writeUInt16BE(off, o + 10);
    off += strings[i]!.length;
  });
  const table = Buffer.concat([head, ...strings]);
  const start = Math.ceil(ttf.length / 4) * 4;
  const out = Buffer.concat([ttf, Buffer.alloc(start - ttf.length), table, Buffer.alloc((4 - (table.length % 4)) % 4)]);
  out.writeUInt32BE(start, entry + 8);
  out.writeUInt32BE(table.length, entry + 12);
  return out;
}

export async function ttfFiles(faces: FontFace[]): Promise<string[]> {
  fs.mkdirSync(cache, { recursive: true });
  const out: string[] = [];
  for (const f of faces) {
    if (f.format === 'woff') continue; // rare: resvg reads neither woff nor woff2; ship a ttf or woff2
    const bytes = Buffer.from(f.data, 'base64');
    const file = path.join(cache, crypto.createHash('sha1').update(bytes).update(f.family).digest('hex') + (f.format === 'opentype' ? '.otf' : '.ttf'));
    if (!fs.existsSync(file)) fs.writeFileSync(file, renameFamily(f.format === 'woff2' ? Buffer.from(await wawoff2.decompress(bytes)) : bytes, f.family));
    out.push(file);
  }
  return out;
}
