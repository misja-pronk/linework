import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { allFontFiles, fontFiles } from '@cartography/theme/node';
import type { FontBytes } from '@cartography/export';

/** PNG without a browser; fonts come from the bundled TTFs (plus a brand theme's) so the result is the same on every machine. */
export function toPng(svg: string, scale: number, extraFonts: string[] = []): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: scale },
    font: { fontFiles: [...extraFonts, ...allFontFiles.map((u) => decodeURIComponent(u.pathname))], loadSystemFonts: false, defaultFontFamily: 'Inter' },
  });
  return resvg.render().asPng();
}

/** An icon's PNG fallback for slides, at a fixed pixel width. */
export function iconPng(svg: string, width: number): Uint8Array {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render().asPng();
}

/** Inter as TTF for the PDF export, which embeds a subset per weight. */
export function interTtf(): FontBytes {
  const [regular, medium, semibold] = fontFiles.map((u) => fs.readFileSync(decodeURIComponent(u.pathname)));
  return { 400: regular!, 500: medium!, 600: semibold! };
}
