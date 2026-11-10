// Renders one example per built-in theme, plus the fictional Acme brand theme, into docs/themes/png.
import fs from 'node:fs';
import path from 'node:path';
import { render, type RenderOptions } from '@cartography/engine';
import { themeCatalog } from '@cartography/theme';
import { fontScale, ttfFiles } from './fonts.ts';
import { toPng } from './png.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const out = path.join(root, 'docs/themes/png');
fs.mkdirSync(out, { recursive: true });

const io = (file: string): RenderOptions => ({
  load: (rel) => fs.readFileSync(path.resolve(path.dirname(file), rel), 'utf8'),
  assets: (rel) => new Uint8Array(fs.readFileSync(path.resolve(path.dirname(file), rel))),
  fontScale,
});

// A sheet with a frame, zone grid and imprint: what a diagram adds to become a page of a document.
const sheet = (text: string) =>
  text.replace(/^type: (\w+)\n/, 'type: $1\ntheme:\n  extends: survey\n  sheet: { marks: frame, zones: true }\n  titleBlock: { client: Acme Corporation, project: Platform modernisation, version: v1.3, classification: Confidential, imprint: true }\n');

const jobs: { name: string; file: string; theme?: string; view?: string; patch?: (text: string) => string }[] = [
  ...themeCatalog.map(({ name }) => ({ name, file: 'examples/systems/saas-platform.yaml', theme: name })),
  { name: 'slate-azure', file: 'examples/azure/web-shop.yaml', theme: 'slate' },
  { name: 'acme', file: 'docs/themes/acme/platform.yaml' },
  // The pictures in docs/style.md.
  { name: 'survey-azure', file: 'examples/azure/web-shop.yaml', theme: 'survey' },
  { name: 'survey-erd', file: 'examples/erd/orders.yaml', theme: 'survey' },
  { name: 'survey-sheet', file: 'examples/azure/web-shop.yaml', patch: sheet },
  { name: 'transit-network', file: 'examples/network/small-office.yaml', theme: 'transit' },
  { name: 'drafting-c4', file: 'examples/c4/kestrel-bank.yaml', theme: 'drafting', view: 'containers' },
  // Sketch, for workshops: the pictures in docs/themes.md.
  { name: 'sketch-azure', file: 'examples/azure/web-shop.yaml', theme: 'sketch' },
  { name: 'sketch-process', file: 'examples/process/order-to-cash.yaml', theme: 'sketch' },
  { name: 'sketch-sequence', file: 'examples/sequence/checkout.yaml', theme: 'sketch' },
  { name: 'sketch-dark-process', file: 'examples/process/order-to-cash.yaml', theme: 'sketch-dark' },
];

let failed = false;
for (const j of jobs) {
  const file = path.join(root, j.file);
  const text = fs.readFileSync(file, 'utf8');
  const r = await render(j.patch ? j.patch(text) : text, { ...io(file), themeOverride: j.theme, view: j.view, fonts: 'none' });
  for (const d of r.diagnostics) console.error(`${j.file}:${d.line ?? 0}  ${d.severity}  ${d.message}`);
  if (!r.svg) {
    failed = true;
    continue;
  }
  fs.writeFileSync(path.join(out, `${j.name}.png`), toPng(r.svg, 2, await ttfFiles(r.theme?.font.faces ?? [])));
  console.log(`${j.file} (${j.theme ?? 'own theme'}) → docs/themes/png/${j.name}.png ${r.width}×${r.height}`);
}
process.exitCode = failed ? 1 : 0;
