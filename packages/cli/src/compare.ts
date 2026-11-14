// Renders docs/comparison/src/<name>.mmd with Mermaid itself (in headless Chromium), <name>.d2 with D2
// when the d2 binary is installed, and the same diagram in Linework, side by side in png/.
// Linework's YAML in linework/ was converted from the Mermaid once and is not hand-tuned (the card payment's dividers aside).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chromium, type Page } from '@playwright/test';
import { render } from '@linework/engine';
import { toPng } from './png.ts';

const SCALE = 1.5;
const root = path.resolve(import.meta.dirname, '../../..');
const dir = path.join(root, 'docs/comparison');
const png = path.join(dir, 'png');
const yamlDir = path.join(dir, 'linework');
fs.mkdirSync(png, { recursive: true });

const mermaidJs = createRequire(import.meta.url).resolve('mermaid/dist/mermaid.min.js');
const hasD2 = (() => {
  try {
    return !!execFileSync('d2', ['--version'], { encoding: 'utf8' });
  } catch {
    return false;
  }
})();
if (!hasD2) console.warn('d2 not found: skipping D2 (brew install d2)');

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: SCALE, viewport: { width: 1600, height: 1000 } });

/** Screenshot an SVG on white with the same margin the other tools get. */
async function shoot(p: Page, raw: string, out: string) {
  // Both tools size their SVG to the container (width 100%, max-width); pin it to its natural size.
  const svg = raw.replace(/^<\?xml[^>]*>\s*/, '').replace(/^<svg\b[^>]*>/, (tag) => {
    const [, , w, h] = /viewBox="([^"]+)"/.exec(tag)![1]!.trim().split(/[\s,]+/).map(Number);
    return tag.replace(/\s(width|height|style)="[^"]*"/g, '').replace(/^<svg/, `<svg width="${w}" height="${h}"`);
  });
  await p.setContent(`<!doctype html><body style="margin:0;background:#fff"><div id="d" style="display:inline-block;padding:24px;background:#fff">${svg}</div></body>`);
  await p.locator('#d').screenshot({ path: out });
}

for (const file of fs.readdirSync(path.join(dir, 'src')).filter((f) => f.endsWith('.mmd')).sort()) {
  const name = file.replace(/\.mmd$/, '');
  const text = fs.readFileSync(path.join(dir, 'src', file), 'utf8');

  await page.setContent('<!doctype html><body></body>');
  await page.addScriptTag({ path: mermaidJs });
  const svg = await page.evaluate(async (src) => {
    const m = (window as unknown as { mermaid: { initialize(o: object): void; render(id: string, t: string): Promise<{ svg: string }> } }).mermaid;
    m.initialize({ startOnLoad: false, theme: 'default' });
    return (await m.render('m', src)).svg;
  }, text);
  await shoot(page, svg, path.join(png, `${name}-mermaid.png`));

  const d2 = path.join(dir, 'src', `${name}.d2`);
  if (hasD2 && fs.existsSync(d2)) {
    const out = path.join(png, `${name}-d2.svg`);
    execFileSync('d2', ['--pad', '0', d2, out], { stdio: 'ignore' });
    await shoot(page, fs.readFileSync(out, 'utf8'), path.join(png, `${name}-d2.png`));
    fs.rmSync(out);
  }

  const r = await render(fs.readFileSync(path.join(yamlDir, `${name}.yaml`), 'utf8'), { fonts: 'none' });
  for (const d of r.diagnostics) console.error(`${name}: ${d.message}`);
  fs.writeFileSync(path.join(png, `${name}-linework.png`), toPng(r.svg!, SCALE));
  console.log(name);
}

await browser.close();
console.log(`→ ${path.relative(root, png)}`);
