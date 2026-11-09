// Renders one example per built-in theme, plus the fictional Acme brand theme, into docs/themes/png.
import fs from 'node:fs';
import path from 'node:path';
import { render, type RenderOptions } from '@cartography/engine';
import { builtinSpecs } from '@cartography/theme';
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

const jobs: { name: string; file: string; theme?: string }[] = [
  ...['light', 'dark', ...Object.keys(builtinSpecs)].map((theme) => ({ name: theme, file: 'examples/systems/saas-platform.yaml', theme })),
  { name: 'slate-azure', file: 'examples/azure/web-shop.yaml', theme: 'slate' },
  { name: 'acme', file: 'docs/themes/acme/platform.yaml' },
];

let failed = false;
for (const j of jobs) {
  const file = path.join(root, j.file);
  const r = await render(fs.readFileSync(file, 'utf8'), { ...io(file), themeOverride: j.theme, fonts: 'none' });
  for (const d of r.diagnostics) console.error(`${j.file}:${d.line ?? 0}  ${d.severity}  ${d.message}`);
  if (!r.svg) {
    failed = true;
    continue;
  }
  fs.writeFileSync(path.join(out, `${j.name}.png`), toPng(r.svg, 2, await ttfFiles(r.theme?.font.faces ?? [])));
  console.log(`${j.file} (${j.theme ?? 'own theme'}) → docs/themes/png/${j.name}.png ${r.width}×${r.height}`);
}
process.exitCode = failed ? 1 : 0;
