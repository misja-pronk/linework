// Share link: "Copy share link" puts the diagram in the link's #fragment; opening it shows the
// read-only viewer (the note that nothing was uploaded, pan and zoom, present, export), and "Open in
// editor" makes it a document of its own with an undo. A diagram too large says so: node e2e/share.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const out = process.argv[2];
if (out) fs.mkdirSync(out, { recursive: true });
const base = process.env.CARTO_URL ?? 'http://localhost:5178/';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
const toast = () => page.locator('.toast').innerText().catch(() => '');
const palette = async (words) => {
  await page.keyboard.press('Meta+k');
  await page.keyboard.type(words);
  await page.keyboard.press('Enter');
};
// Requests that carry the diagram: there must be none, the fragment stays in the browser.
const sent = [];
context.on('request', (r) => sent.push(r.url()));

const text = `type: systems
title: Shared shop
nodes:
  web: { kind: client, label: Storefront }
  api: { kind: service, label: Orders API }
  db: { kind: database, label: Orders DB }
edges:
  - web -> api: HTTPS
  - api -> db: SQL
steps:
  - { title: The front, show: [web] }
  - { title: All of it }
`;
await page.addInitScript(() => {
  const next = sessionStorage.getItem('seed');
  if (!next) return;
  sessionStorage.removeItem('seed');
  localStorage.clear();
  const { text, name } = JSON.parse(next);
  for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'code', doc: { text, doc: { name } } })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
});
const seed = async (text, name) => {
  await page.evaluate((next) => sessionStorage.setItem('seed', next), JSON.stringify({ text, name }));
  await page.reload();
};
await page.goto(base);
await seed(text, 'shop.yaml');
await page.waitForSelector('.drawing [data-node="db"]', { timeout: 10000 });
await wait(400);

// 1. Copy share link from the palette: a link to this page with #share=, and a note that nothing was uploaded.
let link = '';
{
  await page.locator('.preview').focus();
  await palette('copy share link');
  await wait(800);
  link = await page.evaluate(() => navigator.clipboard.readText());
  if (!link.startsWith(base.replace(/\/$/, '')) || !/#share=[A-Za-z0-9_-]+$/.test(link)) fail(`the share link looks wrong: ${link.slice(0, 80)}`);
  if (!(await toast()).includes('nothing was uploaded')) fail('copying the link should say nothing was uploaded');
  if (sent.some((u) => u.includes('share='))) fail('the share data went into a request');
}

// 2. The export menu has it too.
{
  await page.locator('button:has-text("Export")').first().click();
  if (!(await page.locator('[role="menuitem"]:has-text("Copy share link")').isVisible())) fail('the export menu has no "Copy share link"');
  await page.keyboard.press('Escape');
}

// 3. Opening the link: the read-only viewer, with the drawing, the note, and no editor.
const viewer = await context.newPage();
viewer.on('pageerror', (e) => fail(`viewer: ${e.message}`));
{
  const before = sent.length;
  await viewer.goto(link);
  await viewer.waitForSelector('.viewer-drawing svg', { timeout: 10000 });
  if (sent.slice(before).some((u) => u.includes('share=') || u.includes('Orders'))) fail('opening the link sent the diagram somewhere');
  if (!(await viewer.locator('.viewer-note').first().innerText()).includes('never send')) fail('the viewer does not say the diagram stays in the browser');
  if (await viewer.locator('.cm-content').count()) fail('the viewer shows the YAML editor');
  if ((await viewer.locator('.viewer-drawing [data-node]').count()) !== 3) fail('the viewer does not draw the three nodes');
  if (!(await viewer.locator('.type-pill').innerText()).includes('Read-only')) fail('the viewer does not say it is read-only');
  if (out) await viewer.screenshot({ path: path.join(out, 'share-viewer.png') });
}

// 4. Zoom and pan move the drawing; 0 fits it again.
{
  const transform = () => viewer.locator('.viewer-drawing').evaluate((e) => e.style.transform);
  const fitted = await transform();
  await viewer.locator('[aria-label="Zoom in"]').click();
  const zoomed = await transform();
  if (zoomed === fitted) fail('zoom in did not change the drawing');
  const stage = viewer.locator('.viewer-stage');
  const b = await stage.boundingBox();
  await viewer.mouse.move(b.x + 200, b.y + 200);
  await viewer.mouse.down();
  await viewer.mouse.move(b.x + 320, b.y + 260, { steps: 4 });
  await viewer.mouse.up();
  if ((await transform()) === zoomed) fail('dragging did not pan the drawing');
  await viewer.keyboard.press('0');
  await wait();
  if ((await transform()) !== fitted) fail('0 should fit the drawing again');
}

// 5. Present: full screen, step by step; Esc comes back.
{
  await viewer.locator('button:has-text("Present")').click();
  await viewer.waitForSelector('.present', { timeout: 5000 }).catch(() => fail('Present did not open'));
  await viewer.keyboard.press('Escape');
  await wait(600);
  if (await viewer.locator('.present').count()) fail('Esc did not close the presentation');
}

// 6. Export from the viewer: an SVG of the same drawing.
{
  const [dl] = await Promise.all([viewer.waitForEvent('download'), viewer.locator('.viewer button:has-text("SVG")').click()]);
  const file = await dl.path();
  if (!fs.readFileSync(file, 'utf8').includes('Orders API')) fail('the exported SVG is not the shared drawing');
  if (dl.suggestedFilename() !== 'shop.svg') fail(`the export is called ${dl.suggestedFilename()}`);
}

// 7. Open in editor: a document of its own, named as shared, with an undo; the link leaves the address bar.
{
  await viewer.evaluate(() => {
    for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'code', doc: { text: 'type: systems\ntitle: Mine\n', doc: { name: 'mine.yaml' } } })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
  });
  await viewer.locator('button:has-text("Open in editor")').click();
  await viewer.waitForSelector('.drawing [data-node="api"]', { timeout: 10000 }).catch(() => fail('Open in editor did not open the diagram'));
  await wait(600);
  if (viewer.url().includes('#')) fail(`the address keeps the link data: ${viewer.url().slice(0, 80)}`);
  if (!(await viewer.locator('.doc-name').innerText()).includes('shop.yaml')) fail('the opened document is not named as shared');
  const t = await viewer.locator('.toast').innerText().catch(() => '');
  if (!t.includes('shared') || !t.includes('Undo')) fail(`opening should say so and offer an undo: ${t}`);
  if (out) await viewer.screenshot({ path: path.join(out, 'share-opened.png') });
}

// 7b. A Dutch data mesh, shared: the viewer lists its views as the editor's picker does, the view as
// written by its name (in the reader's editor language) instead of "As written", and can go back to it.
{
  const mesh = `type: data-products
lang: nl
title: Mesh
domains:
  sales: { label: Sales }
sources:
  shop: { kind: application, label: Webshop, domain: sales }
products:
  orders: { domain: sales, inputs: [shop], outputs: { orders: { kind: table } } }
  loose: { label: Support, inputs: [orders.orders] }
`;
  await seed(mesh, 'mesh.yaml');
  await page.waitForSelector('.drawing svg', { timeout: 10000 });
  await page.locator('.preview').focus();
  await palette('copy share link');
  await wait(800);
  const meshLink = await page.evaluate(() => navigator.clipboard.readText());
  const reader = await context.newPage();
  reader.on('pageerror', (e) => fail(`viewer: ${e.message}`));
  await reader.goto(meshLink);
  await reader.waitForSelector('.viewer-drawing svg', { timeout: 10000 });
  const options = () => reader.evaluate(() => [...document.querySelectorAll('.viewer-views option')].map((o) => o.textContent));
  const chosen = () => reader.evaluate(() => document.querySelector('.viewer-views')?.selectedOptions[0]?.textContent);
  const list = await options();
  if (list.includes('As written')) fail(`the viewer lists "As written" for a type's own view: ${JSON.stringify(list)}`);
  if (list[0] !== 'Overview' || (await chosen()) !== 'Overview') fail(`the viewer should name the view as written "Overview", like the picker: ${JSON.stringify(list)}`);
  if (!(await reader.locator('.viewer-drawing svg').innerHTML()).includes('Mesh')) fail('the viewer does not draw the mesh');
  // The list speaks the reader's language; the drawing keeps the diagram's.
  await reader.selectOption('.viewer-views', 'detailed-other');
  await wait(800);
  if ((await chosen()) !== 'Other products in detail') fail(`picking a view in the viewer: ${await chosen()}`);
  const drawn = await reader.locator('.viewer-drawing svg').evaluate((s) => s.textContent ?? '');
  if (!drawn.includes('Overige producten in detail')) fail(`the drawing of the picked view should be subtitled in Dutch: ${drawn.slice(0, 120)}`);
  await reader.selectOption('.viewer-views', 'overview');
  await wait(800);
  if ((await chosen()) !== 'Overview' || (await options()).includes('As written')) fail('the viewer did not go back to the view as written');
  if (out) await reader.screenshot({ path: path.join(out, 'share-viewer-views.png') });
  await reader.close();
}

// 8. A link that is not one, and a diagram that is too large for a link.
{
  await viewer.goto(`${base}#share=AAAA`);
  await viewer.reload();
  await viewer.waitForSelector('.viewer-empty', { timeout: 5000 });
  if (!(await viewer.locator('.viewer-empty').innerText()).includes('does not hold a diagram')) fail('a broken link should say so');
  // Text that does not compress: random labels.
  let big = 'type: systems\ntitle: Huge\nnodes:\n';
  for (let i = 0; i < 1600; i++) big += `  n${i}: { kind: service, label: "${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}" }\n`;
  await seed(big, 'huge.yaml');
  await page.waitForSelector('.drawing [data-node="n1"]', { timeout: 30000 });
  await page.evaluate(() => navigator.clipboard.writeText('unchanged'));
  await page.locator('.preview').focus();
  await palette('copy share link');
  await wait(1500);
  if (!(await toast()).includes('Too large')) fail('a diagram too large for a link should say so');
  if ((await page.evaluate(() => navigator.clipboard.readText())) !== 'unchanged') fail('a too large link should not be copied');
}

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all share steps ok');
process.exitCode = problems.length ? 1 : 0;
await browser.close();
