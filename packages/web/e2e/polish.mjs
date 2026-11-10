// Screens for the final look: shortcuts, inspector with connections, narrow layout, dark mode.
import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const problems = [];
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => problems.push(e.message));
// Opening a template over the edited example asks first: yes, replace it.
page.on('dialog', (d) => d.accept());
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('cartography:started', 'true');
});
await page.reload();
await page.waitForSelector('.drawing svg');
// The detailed customer example: many connections for the inspector.
await page.keyboard.press('Meta+k');
await page.keyboard.type('customer data products in detail');
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
await page.locator('.preview').focus();
await page.keyboard.press('?');
await page.waitForTimeout(200);
if (!(await page.locator('.shortcuts').isVisible())) problems.push('? did not open shortcuts');
await page.screenshot({ path: `${out}/p-shortcuts.png` });
await page.keyboard.press('Escape');
await page.click('.drawing [data-node="customer-360"]', { position: { x: 30, y: 20 } });
await page.waitForTimeout(300);
const conns = await page.locator('.connections li').count();
if (conns < 3) problems.push(`expected connections in the inspector, got ${conns}`);
await page.screenshot({ path: `${out}/p-inspector.png` });
// Remove one line from the inspector.
const before = await page.locator('.drawing [data-edge]').count();
await page.locator('.connections li button[aria-label^="Remove"]').first().click();
await page.waitForTimeout(400);
const after = await page.locator('.drawing [data-edge]').count();
if (after !== before - 1) problems.push(`remove line: ${before} → ${after}`);
// A group dragged by its header moves with its contents, relative to what is outside it.
await page.keyboard.press('Meta+k');
await page.keyboard.type('azure infrastructure template');
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
const gap = async () => (await page.locator('.drawing [data-node="web"]').boundingBox()).y - (await page.locator('.drawing [data-node="users"]').boundingBox()).y;
const g0 = await gap();
const gb = await page.locator('.drawing [data-group="prod"]').boundingBox();
await page.mouse.move(gb.x + 60, gb.y + 10);
await page.mouse.down();
for (let i = 1; i <= 6; i++) await page.mouse.move(gb.x + 60 + i * 5, gb.y + 10 + i * 8);
await page.mouse.up();
await page.waitForTimeout(500);
if (Math.abs((await gap()) - g0) < 20) problems.push(`group move: contents did not move relative to Users (${g0} → ${await gap()})`);
await page.setViewportSize({ width: 600, height: 860 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/p-narrow.png` });
await page.close();
const dark = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' });
await dark.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await dark.evaluate(() => { localStorage.clear(); localStorage.setItem('cartography:started', 'true'); });
await dark.reload();
await dark.waitForSelector('.drawing svg');
await dark.click('.drawing [data-node="orders"]', { position: { x: 30, y: 20 } });
await dark.waitForTimeout(300);
await dark.screenshot({ path: `${out}/p-dark.png` });
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'polish screens ok');
await browser.close();
