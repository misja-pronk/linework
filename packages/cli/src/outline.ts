// --outline-text: text drawn as outlines in the theme's own faces, so a slide looks the same on a
// machine that has none of the fonts. The price: the text is a shape, no longer text to edit.
import fs from 'node:fs';
import * as fontkit from 'fontkit';
import wawoff2 from 'wawoff2';
import { bundledFontFiles } from '@cartography/theme/node';
import type { FontFace, Theme } from '@cartography/theme';
import type { SafeSvgOptions, TextFont } from '@cartography/export/svg-safe';

interface Glyph {
  id: number;
  advanceWidth: number;
  path: { commands: { command: string; args: number[] }[] };
}
interface Font {
  unitsPerEm: number;
  hasGlyphForCodePoint(cp: number): boolean;
  layout(s: string): { glyphs: Glyph[]; positions: { xAdvance: number; xOffset: number; yOffset: number }[] };
}

const LETTER = { moveTo: 'M', lineTo: 'L', quadraticCurveTo: 'Q', bezierCurveTo: 'C', closePath: 'Z' } as const;
const r2 = (n: number) => String(Math.round(n * 100) / 100);

/** The face nearest in weight; a heavier one before a lighter one, as browsers pick. */
function nearest<T extends { weight: number }>(faces: T[], weight: number): T | undefined {
  return [...faces].sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight) || b.weight - a.weight)[0];
}

/**
 * The outliner for one theme: its brand files where it brings them, else the bundled family it
 * names, and Inter for a character the face does not have (an arrow, a check mark).
 */
export async function outliner(theme: Theme | undefined): Promise<NonNullable<SafeSvgOptions['outline']>> {
  const opened = new Map<string, Font | undefined>();
  const bundled = (family: string, weight: number): Font | undefined => {
    const files = Object.entries(bundledFontFiles[family] ?? {}).map(([w, url]) => ({ weight: Number(w), url }));
    const pick = nearest(files, weight);
    if (!pick) return undefined;
    const key = pick.url.href;
    if (!opened.has(key)) opened.set(key, fontkit.create(fs.readFileSync(decodeURIComponent(pick.url.pathname))) as Font);
    return opened.get(key);
  };
  // Brand faces come as base64, mostly woff2: unpacked once, up front, because that is async.
  const brand: { face: FontFace; font: Font }[] = [];
  for (const face of theme?.font.faces ?? []) {
    if (face.format === 'woff' || face.style === 'italic') continue;
    try {
      const bytes = Buffer.from(face.data, 'base64');
      brand.push({ face, font: fontkit.create(face.format === 'woff2' ? Buffer.from(await wawoff2.decompress(bytes)) : bytes) as Font });
    } catch {
      // A file fontkit cannot read: the bundled family stands in.
    }
  }
  const faceFor = (f: TextFont): Font | undefined => {
    const own = nearest(brand.filter((b) => !!b.face.mono === f.mono).map((b) => ({ weight: b.face.weight, font: b.font })), f.weight);
    return own?.font ?? bundled(f.mono ? (theme?.font.monoFace ?? 'Geist Mono') : (theme?.font.sans ?? 'Inter'), f.weight) ?? bundled('Inter', f.weight);
  };

  return (text, f) => {
    const main = faceFor(f);
    const spare = bundled('Inter', f.weight);
    if (!main || !spare) return undefined;
    // Runs of characters by the face that has them.
    const parts: { font: Font; text: string }[] = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      const font = main.hasGlyphForCodePoint(cp) ? main : spare.hasGlyphForCodePoint(cp) ? spare : undefined;
      if (!font) return undefined;
      const last = parts.at(-1);
      if (last?.font === font) last.text += ch;
      else parts.push({ font, text: ch });
    }
    let d = '';
    let x = 0;
    for (const part of parts) {
      const k = f.size / part.font.unitsPerEm;
      const run = part.font.layout(part.text);
      run.glyphs.forEach((g, i) => {
        const pos = run.positions[i]!;
        const ox = x + pos.xOffset * k;
        const oy = -pos.yOffset * k;
        // Font units run up, the page runs down.
        for (const c of g.path.commands) d += LETTER[c.command as keyof typeof LETTER] + c.args.map((v, n) => r2(n % 2 ? oy - v * k : ox + v * k)).join(' ');
        x += pos.xAdvance * k + f.tracking;
      });
    }
    return { d, width: x };
  };
}
