// Small things review 3 tripped over, at 1512×900: an empty label field shows the drawn name as its
// placeholder, and a toast docks under an open popover (Layers) instead of over it. node e2e/details.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? '.';
fs.mkdirSync(out, { recursive: true });
const shop = fs.readFileSync(path.resolve(import.meta.dirname, '../../../examples/azure/web-shop.yaml'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
page.setDefaultTimeout(8000);
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
const overlap = (a, b) => (a && b ? Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)) : 0);
await page.addInitScript((text) => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  localStorage.clear();
  for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'visual', doc: { text, doc: { name: 'web-shop.yaml' } } })) localStorage.setItem(`linework:${k}`, JSON.stringify(v));
}, shop);
await page.goto(process.env.LINEWORK_URL ?? 'http://localhost:5178/');
await page.waitForSelector('.drawing [data-node="users"]', { timeout: 15000 });
await wait(500);

// 1. "users: users" has no label written: the field is empty, and says what is drawn.
await page.locator('.drawing [data-node="users"]').click();
await wait(400);
const field = page.locator('.side input[aria-label="Label"], .side label:has-text("Label") input').first();
const placeholder = (await field.count()) ? await field.getAttribute('placeholder') : null;
if (!placeholder?.startsWith('Users')) fail(`the empty Label field should show "Users" as its placeholder, got ${JSON.stringify(placeholder)}`);
if ((await field.count()) && (await field.inputValue()) !== '') fail('the Label field should stay empty: nothing is written');
await page.screenshot({ path: `${out}/1-label-placeholder.png` });

// 2. The Layers panel open, then a pin: the toast goes under the panel.
await page.locator('.drawing [data-node="api"]').click();
await page.locator('.canvas-tools .layers-control > button').click();
await page.waitForSelector('.layers-panel');
// Back to the drawing with the panel still open (a pin by key, as the review did), then pin.
await page.evaluate(() => document.querySelector('.preview').focus());
await page.keyboard.press('Shift+L');
const toasted = await page.waitForSelector('.toast', { timeout: 3000 }).then(() => true, () => false);
if (!toasted) fail('Shift+L with the Layers panel open gave no toast');
if (toasted && (await page.locator('.layers-panel').count())) {
  const t = await page.locator('.toast').boundingBox();
  const l = await page.locator('.layers-panel').boundingBox();
  if (overlap(t, l)) fail(`the toast covers the Layers panel: toast ${JSON.stringify(t)}, panel ${JSON.stringify(l)}`);
} else if (toasted) fail('the Layers panel closed: the case is not tested');
await page.screenshot({ path: `${out}/2-toast-under-layers.png` });

await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('details ok');
