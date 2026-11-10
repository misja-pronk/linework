// Writes the two made-up templates and decks made in them from a few examples, then draws every
// slide to PNG, to look at what an export into a template gives:
//   tsx packages/export/test/support/template-demo.ts out-folder
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { render } from '@cartography/engine';
import { toPptx, type PptxOptions } from '../../src/index.ts';
import { corporateTemplate, dutchTemplate } from '../fixtures/templates.ts';
import { deckToSvg } from './slide-svg.ts';

const out = process.argv[2];
if (!out) {
  console.error('template-demo <out-folder>');
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const root = new URL('../../../../examples/', import.meta.url);
const draw = async (f: string) => {
  const text = fs.readFileSync(new URL(f, root), 'utf8');
  const r = await render(text, { fonts: 'none', load: (rel) => fs.readFileSync(new URL(`${path.dirname(f)}/${rel}`, root), 'utf8') });
  return { ...r, name: path.basename(f) };
};
const png = (svg: string, size: number) => new Uint8Array(new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng());
const templates = { corporate: corporateTemplate(), dutch: dutchTemplate() };
for (const [k, t] of Object.entries(templates)) fs.writeFileSync(path.join(out, `${k}.${k === 'corporate' ? 'potx' : 'pptx'}`), t);

const decks: [string, string[], PptxOptions][] = [
  ['corporate-deck', ['systems/web-shop.yaml', 'systems/invoice-walkthrough.yaml'], { template: templates.corporate, title: 'Platform architecture', subtitle: 'Exemplar Group · November 2026' }],
  ['corporate-keep-look', ['systems/web-shop.yaml'], { template: templates.corporate, keepLook: true }],
  ['corporate-content', ['process/order-to-cash.yaml'], { template: templates.corporate, layout: 'Title and Content' }],
  ['dutch-deck', ['systems/web-shop.yaml', 'systems/invoice-walkthrough.yaml'], { template: templates.dutch, title: 'Architectuur', subtitle: 'Polder Advies' }],
  ['dutch-caption', ['systems/invoice-walkthrough.yaml'], { template: templates.dutch, layout: 'Afbeelding met bijschrift' }],
  ['corporate-dark', ['systems/web-shop.yaml'], { template: templates.corporate, layout: 'Title Slide' }],
  ['dutch-blank', ['erd/orders.yaml'], { template: templates.dutch, layout: 'Leeg' }],
  ['plain', ['systems/web-shop.yaml'], {}],
];
const only = process.argv[3];
for (const [name, files, opts] of decks) {
  if (only && !name.startsWith(only)) continue;
  const drawings = await Promise.all(files.map(draw));
  const deck = await toPptx(drawings, { ...opts, rasterize: png, onWarning: (w) => console.error(`${name}: ${w}`) });
  const file = path.join(out, `${name}.pptx`);
  fs.writeFileSync(file, deck);
  for (const [i, svg] of deckToSvg(deck).slides.entries()) {
    fs.writeFileSync(path.join(out, `${name}-${i + 1}.svg`), svg);
    fs.writeFileSync(path.join(out, `${name}-${i + 1}.png`), new Resvg(svg, { fitTo: { mode: 'width', value: 1400 }, font: { loadSystemFonts: true, defaultFontFamily: 'Arial' } }).render().asPng());
  }
  console.log(`${file}: ${deckToSvg(deck).slides.length} slides`);
}
