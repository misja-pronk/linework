// Screens for the final look: shortcuts, inspector with connections, narrow layout, dark mode.
import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const problems = [];
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
/** Says Discard to the app's "Discard the unsaved changes?" dialogs until stopped (they replaced confirm()). */
const discarding = () => {
  let on = true;
  void (async () => {
    while (on && !page.isClosed()) await page.locator('.confirm-dialog button:has-text("Discard")').click({ timeout: 250 }).catch(() => {});
  })();
  return () => void (on = false);
};
discarding();
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
// The detailed customer example (the Customers product, its contract and who reads it): connections for the inspector.
await page.keyboard.press('Meta+k');
await page.keyboard.type('the customers product and its contract');
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
// Overlays never cover each other: the "Opened … Undo" toast stands clear of the hint and its close button.
const overlaps = (a, b) => !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
{
  const toast = await page.locator('.toast').boundingBox();
  const hint = await page.locator('.hint').boundingBox();
  if (!toast) problems.push('no toast after opening an example');
  if (!hint) problems.push('no hint on a fresh start');
  if (overlaps(toast, hint)) problems.push(`the toast covers the hint: ${JSON.stringify(toast)} over ${JSON.stringify(hint)}`);
  await page.screenshot({ path: `${out}/p-toast-hint.png` });
}
await page.locator('.preview').focus();
await page.keyboard.press('?');
await page.waitForTimeout(200);
if (!(await page.locator('.shortcuts').isVisible())) problems.push('? did not open shortcuts');
if (await page.locator('.toast').count()) problems.push('a toast from before stays on top of the shortcuts');
await page.screenshot({ path: `${out}/p-shortcuts.png` });
await page.keyboard.press('Escape');
await page.click('.drawing [data-node="customers"]', { position: { x: 30, y: 20 } });
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
// A phone: the canvas tools fit, and a document that opens with errors still shows its last good
// drawing (greyed, with the note under the tools, not over them).
{
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  phone.on('pageerror', (e) => problems.push('phone: ' + e.message));
  await phone.addInitScript(() => {
    const broken = sessionStorage.getItem('broken');
    if (!broken) return;
    sessionStorage.removeItem('broken');
    const d = JSON.parse(localStorage.getItem('cartography:doc'));
    localStorage.setItem('cartography:doc', JSON.stringify({ ...d, text: broken }));
  });
  await phone.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
  await phone.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('cartography:started', 'true');
  });
  await phone.reload();
  await phone.waitForSelector('.drawing svg');
  await phone.waitForTimeout(800);
  const tools = await phone.locator('.canvas-tools').boundingBox();
  if (tools.x < 0 || tools.x + tools.width > 390) problems.push(`the canvas tools run off a phone screen: ${JSON.stringify(tools)}`);
  await phone.evaluate(() => sessionStorage.setItem('broken', JSON.parse(localStorage.getItem('cartography:doc')).text.replace('\ntitle:', '\n      title:')));
  await phone.reload();
  await phone.waitForTimeout(1500);
  if (await phone.locator('.preview-empty').count()) problems.push('a document with errors shows "Nothing to draw yet" instead of its last good drawing');
  if (!(await phone.locator('.drawing svg').count()) || !(await phone.locator('.stale-note').count())) problems.push('no last good drawing with its note after opening with errors');
  const note = await phone.locator('.stale-note').boundingBox();
  if (overlaps(note, await phone.locator('.canvas-tools').boundingBox())) problems.push('the note about the last good drawing is under the tools');
  await phone.screenshot({ path: `${out}/p-phone-errors.png` });
}
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'polish screens ok');
await browser.close();
