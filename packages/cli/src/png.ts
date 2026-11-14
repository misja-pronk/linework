import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { allFontFiles, bundledFontFiles, fontFiles } from '@linework/theme/node';
import type { Theme } from '@linework/theme';
import { pdfFamilies, type FamilyBytes, type FontBytes } from '@linework/export';

/** PNG without a browser; fonts come from the bundled TTFs (plus a brand theme's) so the result is the same on every machine. */
export function toPng(svg: string, scale: number, extraFonts: string[] = []): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: scale },
    font: { fontFiles: [...extraFonts, ...allFontFiles.map((u) => decodeURIComponent(u.pathname))], loadSystemFonts: false, defaultFontFamily: 'Inter' },
  });
  return resvg.render().asPng();
}

/** An icon's or a picture's PNG fallback for slides, at a fixed pixel width. A picture with text gets the bundled faces. */
export function iconPng(svg: string, width: number): Uint8Array {
  const fontFiles = svg.includes('<text') ? allFontFiles.map((u) => decodeURIComponent(u.pathname)) : [];
  return new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Inter' } }).render().asPng();
}

/** The theme's own bundled faces as TTF, for the PDF export: Instrument Sans and Geist Mono for Survey, nothing for a look in Inter. */
export function themeTtf(theme: Theme): FamilyBytes {
  const out: FamilyBytes = {};
  for (const family of pdfFamilies(theme)) {
    out[family] = Object.fromEntries(Object.entries(bundledFontFiles[family] ?? {}).map(([w, u]) => [w, fs.readFileSync(decodeURIComponent(u.pathname))]));
  }
  return out;
}

/** Inter as TTF for the PDF export, which embeds a subset per weight. */
export function interTtf(): FontBytes {
  const [regular, medium, semibold] = fontFiles.map((u) => fs.readFileSync(decodeURIComponent(u.pathname)));
  return { 400: regular!, 500: medium!, 600: semibold! };
}
