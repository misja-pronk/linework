// Out to draw.io, Excalidraw, Mermaid and Office, and back in: by the Export menu, by dropping a
// file on the window, and through the Import panel of the start dialog.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const out = process.argv[2];
const fixtures = path.resolve(import.meta.dirname, '../../interop/test/fixtures');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, acceptDownloads: true });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
const fail = (m) => problems.push(m);
const wait = (ms) => page.waitForTimeout(ms);
const yaml = () => page.evaluate(() => document.querySelector('.cm-content').innerText);
const nodes = () => page.locator('.preview svg [data-node]').count();
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('cartography:started', 'true');
});
await page.reload();
await page.waitForSelector('.preview svg [data-node]');
const origin = new URL(page.url()).origin;
page.on('request', (r) => !r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:') && fail(`left the app: ${r.url()}`));
const before = await nodes();

async function save(label) {
  await page.click('button:has-text("Export")');
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click(`[role=menuitem]:has-text("${label}")`)]);
  const file = `${out}/${download.suggestedFilename()}`;
  await download.saveAs(file);
  return { file, text: fs.readFileSync(file, 'utf8') };
}

// 1. Export: a file for each tool, well-formed and with the drawing in it.
const drawio = await save('draw.io');
if (!drawio.file.endsWith('.drawio')) fail(`draw.io: named ${drawio.file}`);
if (!/<mxfile[\s>]/.test(drawio.text) || !/<diagram /.test(drawio.text)) fail('draw.io: no <mxfile> with a page');
const edges = drawio.text.match(/edge="1"[^>]*source="[^"]+"[^>]*target="[^"]+"/g) ?? [];
if (!edges.length) fail('draw.io: no connector attached at both ends');
if ((drawio.text.match(/carto="node"/g) ?? []).length !== before) fail(`draw.io: ${(drawio.text.match(/carto="node"/g) ?? []).length} nodes, the drawing has ${before}`);
await page.waitForSelector('.toast:has-text("Saved for draw.io")', { timeout: 5000 }).catch(() => fail('draw.io: no word that it was saved'));

const excalidraw = await save('Excalidraw');
let scene;
try {
  scene = JSON.parse(excalidraw.text);
} catch {
  fail('Excalidraw: not JSON');
}
if (scene && scene.type !== 'excalidraw') fail('Excalidraw: wrong type');
if (scene && !scene.elements.some((e) => e.type === 'arrow' && e.startBinding && e.endBinding)) fail('Excalidraw: no bound arrows');

const mermaid = await save('Mermaid (.mmd)');
if (!/^(---\n[^]*?\n---\n)?(flowchart|erDiagram|sequenceDiagram|gitGraph|journey|gantt|timeline)\b/.test(mermaid.text)) fail(`Mermaid: starts with ${mermaid.text.slice(0, 30)}`);

// Office-safe SVG: a switch in the menu; the SVG row follows it, and it is remembered.
await page.click('button:has-text("Export")');
await page.click('[role=menuitemcheckbox]:has-text("Office-safe SVG")');
if ((await page.locator('[role=menuitemcheckbox][aria-checked=true]').count()) !== 1) fail('Office-safe switch did not turn on');
await page.screenshot({ path: `${out}/1-export-menu.png` });
await page.keyboard.press('Escape');
const svg = await save('SVG, Office-safe');
for (const [what, re] of [
  ['a style sheet', /<style/],
  ['a CSS variable', /var\(--/],
  ['a filter', /filter=/],
  ['foreignObject', /<foreignObject/],
  ['a marker', /marker-(start|end)=/],
])
  if (re.test(svg.text)) fail(`Office-safe SVG still has ${what}`);
await page.reload();
await page.waitForSelector('.preview svg [data-node]');
await page.click('button:has-text("Export")');
if (!(await page.locator('[role=menuitem]:has-text("SVG, Office-safe")').count())) fail('Office-safe choice not remembered');
await page.click('[role=menuitemcheckbox]:has-text("Office-safe SVG")');
await page.keyboard.press('Escape');

// 2. Drop the draw.io file on the window: the Import panel opens with it, positions can be kept.
async function drop(file, name) {
  const content = fs.readFileSync(file, 'utf8');
  const target = await page.locator('.preview').elementHandle();
  const dt = await page.evaluateHandle(
    ([text, n]) => {
      const t = new DataTransfer();
      t.items.add(new File([text], n, { type: 'application/octet-stream' }));
      return t;
    },
    [content, name],
  );
  await target.dispatchEvent('dragover', { dataTransfer: dt });
  await target.dispatchEvent('drop', { dataTransfer: dt });
}
await drop(drawio.file, 'round-trip.drawio');
await page.waitForSelector('.mode-preview svg', { timeout: 8000 }).catch(() => fail('dropped draw.io: nothing drawn in the Import panel'));
if (!(await page.locator('h2', { hasText: /Import from/ }).count())) fail('dropped draw.io: not in the Import panel');
const keep = page.locator('label', { hasText: /Keep the positions from draw.io/ });
if (!(await keep.count())) fail('dropped draw.io: no choice to keep the positions');
else await keep.locator('input').check();
await wait(600);
await page.screenshot({ path: `${out}/2-drop-drawio.png` });
await page.getByRole('button', { name: /Open in builder/ }).click();
await page.waitForSelector('.preview svg [data-node]');
await wait(800);
if ((await nodes()) !== before) fail(`draw.io round trip: ${await nodes()} nodes, was ${before}`);
await page.screenshot({ path: `${out}/3-drawio-opened.png` });

// 3. Through the start dialog: choose an Excalidraw file in the Import panel.
await page.getByRole('button', { name: 'New' }).click();
await page.getByRole('button', { name: /Import from Mermaid, draw.io or Excalidraw/ }).click();
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /Choose a file/ }).click()]);
await chooser.setFiles(path.join(fixtures, 'sketch.excalidraw'));
await page.waitForSelector('.mode-preview svg', { timeout: 8000 }).catch(() => fail('Excalidraw: nothing drawn in the Import panel'));
const report = await page.locator('.ask-preview .callout').innerText().catch(() => '');
if (!/Read from Excalidraw/.test(report)) fail(`Excalidraw: no report (${report.slice(0, 80)})`);
if (!/left out/.test(report)) fail('Excalidraw: the report does not say what was left out');
await page.screenshot({ path: `${out}/4-import-excalidraw.png` });
await page.getByRole('button', { name: /Open in YAML/ }).click();
await wait(800);
const text = await yaml();
if (!text.includes('order-api') || !text.includes('in: backend')) fail('Excalidraw: not opened as YAML');

// 4. A draw.io file of several pages: a page to pick, each its own type.
await drop(path.join(fixtures, 'clouds.drawio'), 'clouds.drawio');
await page.waitForSelector('.mode-preview svg', { timeout: 8000 }).catch(() => fail('clouds.drawio: nothing drawn'));
const pages = await page.locator('[aria-label=Page] [role=radio]').allInnerTexts();
if (pages.join('|') !== 'Azure shop|AWS three tier|Cluster') fail(`clouds.drawio: pages ${pages.join('|')}`);
await page.locator('[aria-label=Page] [role=radio]', { hasText: 'Cluster' }).click();
await wait(700);
await page.screenshot({ path: `${out}/5-drawio-pages.png` });
await page.getByRole('button', { name: /Open in YAML/ }).click();
await wait(800);
if (!(await yaml()).startsWith('type: kubernetes')) fail('clouds.drawio: the Cluster page is not Kubernetes');

// 5. Mermaid file dropped: the same panel, read as Mermaid.
await drop(mermaid.file, 'shop.mmd');
await page.waitForSelector('.mode-preview svg', { timeout: 8000 }).catch(() => fail('Mermaid file: nothing drawn'));
await page.getByRole('button', { name: /Open in builder/ }).click();
await wait(800);
if ((await nodes()) !== before) fail(`Mermaid round trip: ${await nodes()} nodes, was ${before}`);

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all interop steps ok');
await browser.close();
process.exit(problems.length ? 1 : 0);
