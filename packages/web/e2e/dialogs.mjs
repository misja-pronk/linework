// Every dialog fits the window: at 1280×800 and 1512×900 it ends above the bottom edge and its buttons
// can be clicked without scrolling the page (review 3: Rename everywhere cut off its primary button).
// Opens each dialog the way people do, by key or menu. node e2e/dialogs.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? '.';
fs.mkdirSync(out, { recursive: true });
const shop = fs.readFileSync(path.resolve(import.meta.dirname, '../../../examples/azure/web-shop.yaml'), 'utf8');
const base = process.env.CARTO_URL ?? 'http://localhost:5178/';
const browser = await chromium.launch();
const problems = [];
const fail = (m) => problems.push(m);

/** Where the dialog and its buttons are, and whether each button is the thing under its own centre. */
const fits = (page, sel) =>
  page.evaluate((sel) => {
    const all = [...document.querySelectorAll(sel)].filter((d) => d.getBoundingClientRect().height > 0);
    const d = all.at(-1);
    if (!d) return { missing: true };
    const r = d.getBoundingClientRect();
    const hidden = [...d.querySelectorAll('button')]
      .filter((b) => {
        if (!b.getBoundingClientRect().height) return false;
        // Inside a part of the dialog that scrolls (a list of cards, the preview): reached by scrolling it.
        for (let p = b.parentElement; p && p !== d; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return false;
        return true;
      })
      .filter((b) => {
        const br = b.getBoundingClientRect();
        const x = br.left + br.width / 2;
        const y = br.top + br.height / 2;
        if (y > innerHeight || y < 0 || x > innerWidth) return true;
        const hit = document.elementFromPoint(x, y);
        return !(hit && (hit === b || b.contains(hit)));
      })
      .map((b) => b.textContent.trim().slice(0, 30) || b.getAttribute('aria-label'));
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: innerHeight, hidden };
  }, sel);

async function check(page, size, name, sel) {
  const f = await fits(page, sel);
  await page.screenshot({ path: `${out}/${size}-${name}.png` });
  if (f.missing) return fail(`${size} ${name}: no dialog`);
  if (f.bottom > f.height || f.top < 0) fail(`${size} ${name}: dialog ${f.top}–${f.bottom} outside the window (height ${f.height})`);
  if (f.hidden.length) fail(`${size} ${name}: buttons not reachable: ${f.hidden.join(', ')}`);
}

async function fresh(viewport, text = shop) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => fail(e.message));
  await page.addInitScript((text) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'visual', doc: { text, doc: { name: 'web-shop.yaml' } } })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
  }, text);
  await page.goto(base);
  await page.waitForSelector('.drawing [data-node="api"]', { timeout: 15000 });
  await page.waitForTimeout(400);
  return page;
}
const select = async (page, id) => {
  await page.locator(`.drawing [data-node="${id}"]`).click();
  await page.locator('.preview').focus();
};
const close = async (page) => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
};

for (const viewport of [{ width: 1280, height: 800 }, { width: 1512, height: 900 }]) {
  const size = `${viewport.width}x${viewport.height}`;
  const page = await fresh(viewport);
  const run = async (name, open, sel) => {
    try {
      await open();
      await page.waitForSelector(sel, { timeout: 6000 });
      await page.waitForTimeout(500);
      await check(page, size, name, sel);
    } catch (e) {
      fail(`${size} ${name}: ${e.message.split('\n')[0]}`);
    }
    await close(page);
    await page.locator('.overlay').waitFor({ state: 'detached', timeout: 3000 }).catch(() => close(page));
  };

  await run('trace', async () => (await select(page, 'users'), await page.keyboard.press('Shift+Q')), '.trace-dialog');
  await run('describe', async () => (await page.keyboard.press('Meta+k'), await page.keyboard.type('describe'), await page.waitForTimeout(150), await page.keyboard.press('Enter')), '.describe-dialog');
  await run('animate', async () => (await page.click('button:has-text("Export")'), await page.click('[role=menuitem]:has-text("Animation")')), '.animate-dialog');
  await run('insert-block', async () => (await page.locator('.drawing [data-group="vnet"]').first().click({ position: { x: 30, y: 12 } }), await page.keyboard.press('b'), await page.waitForSelector('.palette-item'), await page.keyboard.press('Enter')), '.block-dialog');
  await run('save-block', async () => (await select(page, 'api'), await page.keyboard.down('Shift'), await page.locator('.drawing [data-node="db"]').click(), await page.keyboard.up('Shift'), await page.locator('.preview').focus(), await page.keyboard.press('Shift+B')), '.block-dialog.save');
  await run('snapshot', async () => (await select(page, 'api'), await page.keyboard.press('Meta+Shift+s')), '.snap-dialog > *');
  await run('shortcuts', async () => (await page.locator('.preview').focus(), await page.keyboard.press('?')), '.shortcuts');
  await run('icon-packs', async () => (await page.click('button[data-brand]'), await page.click('.menu [data-icon-packs]')), '[role="dialog"][aria-label="Official icons"]');
  await page.close();

  // The start dialog and a wizard, from a clean browser.
  const start = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  start.on('pageerror', (e) => fail(e.message));
  await start.goto(base);
  await start.evaluate(() => localStorage.clear());
  await start.reload();
  await start.waitForSelector('.start .type-card');
  await check(start, size, 'start', '.start');
  await start.locator('.type-main', { hasText: 'Azure infrastructure' }).click();
  await start.locator('.template-card', { hasText: 'Template' }).first().click();
  await start.waitForSelector('.mode-card');
  await start.keyboard.press('4');
  await start.waitForSelector('.wizard');
  await start.waitForTimeout(600);
  await check(start, size, 'wizard', '.start');
  await start.close();
}

await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('every dialog fits at 1280×800 and 1512×900');
