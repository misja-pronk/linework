// Draws every slide of a .pptx to PNG (and SVG) with slide-svg.ts, to look at a deck without PowerPoint:
//   tsx packages/export/test/support/render-deck.ts deck.pptx out-folder
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { deckToSvg } from './slide-svg.ts';

const [input, out] = process.argv.slice(2);
if (!input || !out) {
  console.error('render-deck <deck.pptx> <out-folder>');
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const deck = deckToSvg(fs.readFileSync(input));
const base = path.basename(input).replace(/\.(pptx|potx)$/i, '');
for (const [i, svg] of deck.slides.entries()) {
  const file = path.join(out, `${base}-slide${i + 1}`);
  fs.writeFileSync(`${file}.svg`, svg);
  fs.writeFileSync(`${file}.png`, new Resvg(svg, { fitTo: { mode: 'width', value: 1600 }, font: { loadSystemFonts: true, defaultFontFamily: 'Arial' } }).render().asPng());
  console.log(`${file}.png`);
}
