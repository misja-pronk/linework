// Model layer in the editor: includes from a folder, the view picker, pins per view, drill-down links.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const out = process.argv[2];
const root = path.resolve(import.meta.dirname, '../../../examples/model');
const files = Object.fromEntries(fs.readdirSync(root).filter((f) => f.endsWith('.yaml')).map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8')]));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
const fail = (m) => problems.push(m);
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.evaluate(async (files) => {
  localStorage.clear();
  localStorage.setItem('cartography:started', 'true');
  const opfs = await navigator.storage.getDirectory();
  for await (const [name] of opfs.entries()) await opfs.removeEntry(name, { recursive: true });
  const dir = await opfs.getDirectoryHandle('shop-model', { create: true });
  for (const [p, text] of Object.entries(files)) {
    const w = await (await dir.getFileHandle(p, { create: true })).createWritable();
    await w.write(text);
    await w.close();
  }
}, files);
await page.reload();
await page.evaluate(() => {
  window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('shop-model');
});
await page.click('button[aria-label="More actions"]');
await page.click('.menu button:has-text("Open folder")');
await page.waitForSelector('.files .file');
const sidecarText = (name) =>
  page.evaluate(async (name) => {
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('shop-model');
    try {
      return await (await (await d.getFileHandle(name)).getFile()).text();
    } catch {
      return '';
    }
  }, name);

// Containers: only views, so the first one is drawn and the picker has no "as written".
await page.click('.files .file:has-text("containers.yaml")');
await page.waitForTimeout(700);
if ((await page.locator('.status-problems').innerText()) !== 'No problems') fail('problems: ' + (await page.locator('.status-problems').innerText()));
const options = await page.locator('.view-picker option').allInnerTexts();
if (options.join('|') !== 'Web shop — containers|Placing an order') fail(`view options: ${options}`);
if (!(await page.locator('.drawing').innerText()).includes('Mailer')) fail('containers view misses the mailer');
await page.screenshot({ path: `${out}/model-1.png` });

await page.selectOption('.view-picker select', 'ordering');
await page.waitForTimeout(600);
const ordering = await page.locator('.drawing').innerText();
if (ordering.includes('Mailer') || !ordering.includes('Placing an order')) fail('ordering view not drawn');

// A move in this view is pinned under views.ordering, and saved so.
const box = await page.locator('.drawing [data-node="stripe"]').boundingBox();
await page.mouse.move(box.x + 30, box.y + 20);
await page.mouse.down();
for (let i = 1; i <= 5; i++) await page.mouse.move(box.x + 30, box.y + 20 + i * 12);
await page.mouse.up();
await page.waitForTimeout(300);
await page.keyboard.press('Meta+s');
await page.waitForTimeout(500);
const side = JSON.parse((await sidecarText('containers.layout.json')) || '{}');
if (!side.views?.ordering?.nodes?.stripe || side.nodes) fail('pin not stored per view: ' + JSON.stringify(side));
await page.screenshot({ path: `${out}/model-2.png` });

// Drill-down: ⌘-click the shop in the context diagram opens its containers view.
await page.click('.files .file:has-text("context.yaml")');
await page.waitForTimeout(700);
if (await page.locator('.view-picker').count()) fail('context has no views, yet a picker shows');
const shop = await page.locator('.drawing [data-node="shop"]').boundingBox();
// Playwright's click modifiers do not reach pointer events: hold the key instead.
await page.keyboard.down('Meta');
await page.mouse.click(shop.x + shop.width / 2, shop.y + shop.height / 2);
await page.keyboard.up('Meta');
await page.waitForTimeout(800);
const name = await page.locator('.doc-name').innerText();
if (!name.includes('containers.yaml')) fail('link did not open containers.yaml: ' + name);
await page.screenshot({ path: `${out}/model-drill.png` });
if (!(await page.locator('.view-picker select').count()) || (await page.locator('.view-picker select').inputValue()) !== 'containers') fail('link did not pick the containers view');

// The inspector lists links; the deployment diagram (Azure) reads the same elements.
await page.click('.files .file:has-text("deployment.yaml")');
await page.waitForTimeout(800);
if ((await page.locator('.status-problems').innerText()) !== 'No problems') fail('deployment problems: ' + (await page.locator('.status-problems').innerText()));
const api = await page.locator('.drawing [data-node="api"]').boundingBox();
await page.mouse.click(api.x + 40, api.y + 20);
await page.waitForTimeout(300);
const links = await page.locator('.inspector .links').innerText();
if (!links.includes('containers.yaml#containers')) fail('inspector links: ' + links);
await page.screenshot({ path: `${out}/model-3.png` });

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all model steps ok');
await browser.close();
