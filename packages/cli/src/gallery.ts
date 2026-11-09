// Renders every examples/<type>/*.yaml in light and dark, plus PNGs and an index page, into gallery/out.
import fs from 'node:fs';
import path from 'node:path';
import { render } from '@cartography/engine';
import { toPng } from './png.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const out = path.join(root, 'gallery/out');
fs.mkdirSync(out, { recursive: true });

const cards: string[] = [];
let failed = false;
for (const dir of fs.readdirSync(path.join(root, 'examples')).sort()) {
  for (const file of fs.readdirSync(path.join(root, 'examples', dir)).filter((f) => f.endsWith('.yaml')).sort()) {
    const name = `${dir}-${file.replace(/\.yaml$/, '')}`;
    const text = fs.readFileSync(path.join(root, 'examples', dir, file), 'utf8');
    for (const theme of ['light', 'dark'] as const) {
      const r = await render(text, { theme, idPrefix: `${name}-${theme}` });
      for (const d of r.diagnostics) console.error(`examples/${dir}/${file}:${d.line ?? 0}  ${d.message}`);
      if (!r.svg || r.diagnostics.some((d) => d.severity === 'error')) failed = true;
      if (!r.svg) continue;
      fs.writeFileSync(path.join(out, `${name}-${theme}.svg`), r.svg);
      fs.writeFileSync(path.join(out, `${name}-${theme}.png`), toPng((await render(text, { theme, fonts: 'none' })).svg!, 2));
    }
    cards.push(`<figure><figcaption>${dir} · ${file}</figcaption><img class="light" src="${name}-light.svg"><img class="dark" src="${name}-dark.svg"></figure>`);
    console.log(`examples/${dir}/${file}`);
  }
}

fs.writeFileSync(
  path.join(out, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>Cartography gallery</title>
<style>
body{margin:0;padding:32px 16px;font:14px system-ui;background:#F4F5F7;color:#0F172A}
h1{font-size:20px;margin:0 0 24px}
figure{margin:0 0 32px;overflow-x:auto}figcaption{margin-bottom:8px;color:#556070}
img{display:block;max-width:100%;height:auto;border-radius:12px;box-shadow:0 1px 3px #0001}
.dark{display:none}
@media (prefers-color-scheme:dark){body{background:#05070A;color:#E8EBF0}.light{display:none}.dark{display:block}}
</style>
<h1>Cartography gallery</h1>${cards.join('\n')}`,
);
console.log(`→ ${path.relative(root, out)}/index.html`);
process.exitCode = failed ? 1 : 0;
