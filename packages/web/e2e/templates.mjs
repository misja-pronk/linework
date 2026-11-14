// Every template and every example opens in the web app and draws: no page error, no error in the
// editor, and a drawing with shapes in it. Each is opened the way the start dialog opens it (as a
// document of the bundled examples, so includes and contracts next to it are found).
//   LINEWORK_URL=http://localhost:5191/ node e2e/templates.mjs <outDir> [words…]
// <outDir> gets a screenshot of each, and of each failure; words narrow it to matching names.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const [out, ...only] = process.argv.slice(2);
if (out) fs.mkdirSync(out, { recursive: true });
const base = process.env.LINEWORK_URL ?? 'http://localhost:5178/';
const root = path.resolve(import.meta.dirname, '../../..');

// The templates are TypeScript in the engine; tsx loads them without a build.
const { tsImport } = await import('tsx/esm/api');
const { types } = await tsImport('@linework/engine', import.meta.url);

const items = [
  ...types.map((t) => ({ name: `template-${t.id}`, text: t.template, file: `${t.id}.yaml`, starter: `template:${t.id}` })),
  ...fs
    .readdirSync(path.join(root, 'examples'))
    .sort()
    .flatMap((dir) => {
      const d = path.join(root, 'examples', dir);
      if (!fs.statSync(d).isDirectory()) return [];
      return fs
        .readdirSync(d)
        .filter((f) => /\.ya?ml$/.test(f))
        .sort()
        .map((f) => ({ dir, f, text: fs.readFileSync(path.join(d, f), 'utf8') }))
        .filter((x) => /^type:\s*[\w-]+/m.test(x.text))
        .map((x) => ({ name: `${x.dir}-${x.f.replace(/\.ya?ml$/, '')}`, text: x.text, file: x.f, starter: `example:${x.dir}/${x.f}` }));
    }),
].filter((x) => !only.length || only.some((w) => x.name.includes(w)));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const problems = [];
let current = '';
page.on('pageerror', (e) => problems.push(`${current}: page error: ${e.message}`));
// Against the built app (vite preview) its Content-Security-Policy applies: whatever it blocks is a problem.
page.on('console', (m) => m.type() === 'error' && /Content Security Policy/i.test(m.text()) && problems.push(`${current}: ${m.text()}`));

// The document to open is put in storage before the app starts, as the app keeps it between visits.
await page.addInitScript(() => {
  const next = sessionStorage.getItem('linework-e2e-doc');
  if (!next) return;
  sessionStorage.removeItem('linework-e2e-doc');
  localStorage.clear();
  const { text, file, starter } = JSON.parse(next);
  const state = { started: true, hinted: true, view: 'code', doc: { text, doc: { name: file, starter } } };
  for (const [k, v] of Object.entries(state)) localStorage.setItem(`linework:${k}`, JSON.stringify(v));
});
await page.goto(base);

const started = Date.now();
for (const item of items) {
  current = item.name;
  const before = problems.length;
  await page.evaluate((next) => sessionStorage.setItem('linework-e2e-doc', next), JSON.stringify(item));
  await page.reload();
  try {
    await page.waitForSelector('.drawing svg', { timeout: 20000 });
    // Layout runs in the background: wait until the drawing stops changing.
    let last = '';
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(150);
      const now = await page.locator('.drawing svg').first().evaluate((s) => `${s.getAttribute('viewBox')}|${s.querySelectorAll('*').length}`);
      if (now === last) break;
      last = now;
    }
    const drawn = await page.locator('.drawing svg').first().evaluate((s) => {
      const r = s.getBoundingClientRect();
      return { w: r.width, h: r.height, shapes: s.querySelectorAll('rect, path, circle, ellipse, polygon, text').length, nodes: s.querySelectorAll('[data-node], [data-group], [data-edge]').length };
    });
    if (drawn.w < 40 || drawn.h < 40) problems.push(`${item.name}: the drawing is ${Math.round(drawn.w)}×${Math.round(drawn.h)} px`);
    if (drawn.shapes < 5) problems.push(`${item.name}: the drawing is empty (${drawn.shapes} shapes)`);
    const errors = await page.locator('.cm-lintRange-error, .cm-lint-marker-error').count();
    if (errors) {
      const text = await page.locator('.cm-lintRange-error').first().getAttribute('title').catch(() => null);
      problems.push(`${item.name}: ${errors} error mark(s) in the editor${text ? `: ${text}` : ''}`);
    }
    const status = await page.getByText(/^\d+ (errors?|problems?)$/).count();
    if (status) problems.push(`${item.name}: the status bar reports problems`);
    if (!(await page.locator('.doc-name').innerText().catch(() => '')).includes(item.file)) problems.push(`${item.name}: the editor did not open ${item.file}`);
  } catch (e) {
    problems.push(`${item.name}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
  }
  const failed = problems.length > before;
  if (out && (failed || !process.env.ONLY_FAILURES)) await page.screenshot({ path: path.join(out, `${failed ? 'FAIL-' : ''}${item.name}.png`) });
  console.log(`${failed ? 'FAIL' : 'ok  '}  ${item.name}`);
}

await browser.close();
console.log(`${items.length} drawings opened in ${((Date.now() - started) / 1000).toFixed(0)} s`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
