// The view keeps the drawing in sight: a narrow window shows the drawing with the panels folded, a
// card dropped far out stays near the sheet and the view fits after the drop and after ⌘Z, an undone
// drag puts the card back where it was, a node added in the YAML that grows the sheet past an edge
// brings it back into view, a fitted view fits again when the window grows, and a view people zoomed
// stays theirs.
// node e2e/view-follows.mjs <outDir>
import { chromium } from '@playwright/test';
const out = process.argv[2];
const url = process.env.CARTO_URL ?? 'http://localhost:5178/';
const problems = [];
const fail = (m) => problems.push(m);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
const zoom = async () => Number((await page.locator('.zoom-level').innerText()).replace('%', ''));
const box = (id) => page.locator(`.drawing [data-node="${id}"]`).first().boundingBox();
/** How far the sheet runs out of the drawing's pane (px, 0 when wholly in it). */
const outOfPane = () =>
  page.evaluate(() => {
    const p = document.querySelector('.preview').getBoundingClientRect();
    const s = document.querySelector('.drawing svg').getBoundingClientRect();
    return Math.round(Math.max(0, p.left - s.left, p.top - s.top, s.right - p.right, s.bottom - p.bottom));
  });
const open = async (title) => {
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.start .scenario');
  await page.locator('.scenario-main', { has: page.locator('.scenario-title', { hasText: new RegExp(`^${title}$`) }) }).click();
  await page.waitForSelector('.drawing svg [data-node]');
  await wait(900);
};
const drag = async (id, dx, dy) => {
  const b = await box(id);
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x + (dx * i) / 12, y + (dy * i) / 12);
  await wait(250);
  await page.mouse.up();
  await wait(1100);
};
const undo = async () => {
  await page.keyboard.press('ControlOrMeta+z');
  await wait(1100);
};

try {
  // 1. A narrow window: the drawing, the panels folded; the YAML on its tab; a message stays a line.
  await page.setViewportSize({ width: 900, height: 720 });
  await open('Azure network');
  {
    const h = await page.locator('.preview').evaluate((e) => e.getBoundingClientRect().height);
    if (h < 400) fail(`at 900 px the drawing is ${Math.round(h)} px high`);
    for (const sel of ['.workspace .shapes', '.workspace .side', '.left-rail'])
      if (await page.locator(sel).first().isVisible().catch(() => false)) fail(`at 900 px ${sel} shows beside the drawing`);
    if (await outOfPane()) fail('at 900 px the drawing does not fit its pane');
    await page.screenshot({ path: `${out}/follows-900.png` });
    await page.locator('.pane-tabs button', { hasText: 'YAML' }).click();
    await wait(400);
    if (!(await page.locator('.cm-editor').isVisible())) fail('the YAML tab at 900 px does not show the YAML');
    if (await page.locator('.outline').isVisible().catch(() => false)) fail('the YAML tab at 900 px shows the outline');
    const toast = await page.locator('.toast').boundingBox();
    if (toast && toast.height > 80) fail(`a message on the YAML tab is ${Math.round(toast.height)} px high`);
    await page.screenshot({ path: `${out}/follows-900-yaml.png` });
  }

  // 2. At 1280 the outline is folded and the toolbar keeps its words.
  await page.setViewportSize({ width: 1280, height: 720 });
  await open('Azure network');
  {
    if (await page.locator('.outline').isVisible().catch(() => false)) fail('at 1280 the outline opens beside the drawing');
    if (!(await page.locator('.canvas-tools .tool-label', { hasText: 'Present' }).isVisible())) fail('at 1280 the toolbar has no words');
  }

  // 3. A card dropped far out: it stays near the sheet, the view fits, ⌘Z gives the zoom back.
  {
    const z0 = await zoom();
    await drag('erp-vm', 400, 600);
    if (await outOfPane()) fail(`after a far drop the drawing runs ${await outOfPane()} px out of view`);
    if ((await zoom()) < z0 * 0.65) fail(`a far drop took the zoom from ${z0}% to ${await zoom()}%`);
    await page.screenshot({ path: `${out}/follows-far-drop.png` });
    await undo();
    if (Math.abs((await zoom()) - z0) > 2) fail(`after ⌘Z of a far drop the zoom is ${await zoom()}%, not ${z0}%`);
    if (await outOfPane()) fail('after ⌘Z of a far drop the drawing is out of view');
  }
  // A card dragged out of its subnet: the drawing in view after the drop and after ⌘Z.
  {
    await drag('afw', 0, 200);
    if (await outOfPane()) fail(`after dragging the firewall out of its subnet the drawing runs ${await outOfPane()} px out of view`);
    await page.screenshot({ path: `${out}/follows-out-of-group.png` });
    await undo();
    if (await outOfPane()) fail(`after ⌘Z the drawing runs ${await outOfPane()} px out of view`);
    await page.screenshot({ path: `${out}/follows-out-of-group-undone.png` });
  }
  // 4. The window grows: the fitted view fits again.
  {
    const z = await zoom();
    await page.setViewportSize({ width: 1920, height: 1080 });
    await wait(900);
    if ((await zoom()) < z * 1.3) fail(`1280 → 1920: the zoom went from ${z}% to ${await zoom()}%`);
    await page.setViewportSize({ width: 1280, height: 720 });
    await wait(900);
    if (await outOfPane()) fail('1920 → 1280: the drawing is out of view');
  }
  // 5. Zoomed in on purpose: a drop keeps that zoom.
  {
    await page.locator('button[aria-label="Zoom in"]').click();
    await wait(300);
    const z = await zoom();
    await drag('router', 0, 40);
    if ((await zoom()) !== z) fail(`a drop after zooming in changed the zoom from ${z}% to ${await zoom()}%`);
  }

  // 6. Data products: ⌘Z after a short drag puts the card back where it stood.
  await open('Data products');
  {
    const b0 = await box('crm');
    await drag('crm', 25, 0);
    const b1 = await box('crm');
    if (Math.abs(b1.x - b0.x) < 10) fail('the drag did not move CRM');
    await undo();
    const b2 = await box('crm');
    if (Math.abs(b2.x - b0.x) > 2 || Math.abs(b2.y - b0.y) > 2) fail(`⌘Z left CRM at ${Math.round(b2.x)},${Math.round(b2.y)}, not back at ${Math.round(b0.x)},${Math.round(b0.y)}`);
  }

  // 7. A node added in the YAML that grows the sheet: the drawing stays in view.
  {
    await page.locator('.view-switch button', { hasText: 'YAML' }).click();
    await wait(700);
    const scroller = page.locator('.cm-scroller');
    let line;
    for (let i = 0; i < 80 && !line; i++) {
      const l = page.locator('.cm-line', { hasText: 'domain: sales }' }).first();
      if (await l.count()) line = l;
      else await scroller.evaluate((e, i) => (e.scrollTop = i * 300), i);
    }
    await line.scrollIntoViewIfNeeded();
    const b = await line.boundingBox();
    await page.mouse.click(b.x + 20, b.y + b.height - 6);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('newbox: { kind: database, label: New box, domain: sales }');
    await page.keyboard.press('Enter');
    await page.keyboard.type('newbox2: { kind: database, label: Another new box, domain: sales }');
    await wait(1800);
    if (!(await page.locator('.drawing [data-node="newbox2"]').count())) fail('the nodes typed in the YAML are not drawn');
    if (await outOfPane()) fail(`after adding nodes in the YAML the drawing runs ${await outOfPane()} px out of view`);
    await page.screenshot({ path: `${out}/follows-yaml-added.png` });
  }
} catch (e) {
  fail(String(e?.stack ?? e));
}
await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('view follows: ok');
