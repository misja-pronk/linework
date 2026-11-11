// The editor in Dutch: Language / Taal in the theme menu switches without a reload, the toolbar, the
// palette, the shortcut sheet and the inspector speak Dutch, the choice survives a reload, and English
// comes back. Screenshots of the Dutch editor at 1280 and 1512 wide, to check that nothing overflows.
// node e2e/dutch.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? '.';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, locale: 'en-GB' });
page.setDefaultTimeout(8000);
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
const step = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    fail(`${name}: ${e.message.split('\n').slice(0, 6).join(' | ')}`);
  }
};
const wait = (ms = 300) => page.waitForTimeout(ms);
const has = async (selector, text, what) => {
  const got = await page.locator(selector).first().innerText();
  if (!got.toLowerCase().includes(text.toLowerCase())) fail(`${what}: expected "${text}" in "${got.slice(0, 160)}"`);
};

const text = `type: azure
title: Shop
nodes:
  api: { kind: app-service, label: API }
  db: { kind: sql-database, label: Orders DB }
edges:
  - api -> db
`;
await page.addInitScript((text) => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  localStorage.clear();
  for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'code', doc: { text, doc: { name: 'shop.yaml' } } })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
}, text);
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.waitForSelector('.drawing [data-node="db"]');

/** Picks a language in the theme menu: 'nl', 'en' or 'browser'. */
const pick = async (lang) => {
  await page.click('[data-brand]');
  await page.click(`[data-ui-lang="${lang}"]`);
  await wait();
};

await step('English by default in an English browser', async () => {
  await has('.topbar', 'Export', 'toolbar');
  if ((await page.evaluate(() => document.documentElement.lang)) !== 'en') fail('the page is not lang=en');
});

await step('switching to Dutch, without a reload', async () => {
  await pick('nl');
  if ((await page.evaluate(() => document.documentElement.lang)) !== 'nl') fail('the page is not lang=nl');
  await has('.topbar', 'Exporteren', 'toolbar');
  await has('.topbar', 'Nieuw', 'toolbar');
  await page.click('[data-brand]');
  await has('[role="menu"]', 'Zoals de browser', 'theme menu');
  await has('[role="menu"]', 'Lijniconen', 'theme menu');
  await page.keyboard.press('Escape');
});

await step('the palette in Dutch', async () => {
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+k');
  await wait();
  const dialog = page.locator('.palette');
  const words = await dialog.innerText();
  const placeholder = await dialog.locator('input').first().getAttribute('placeholder');
  if (!/[Zz]oek|Typ/.test(`${placeholder}`)) fail(`palette placeholder is not Dutch: ${placeholder}`);
  if (!/SVG exporteren|Opslaan/.test(words)) fail(`palette commands are not Dutch: ${words.slice(0, 200)}`);
  await page.screenshot({ path: path.join(out, 'dutch-palette-1512.png') });
  await page.keyboard.press('Escape');
});

await step('the shortcut sheet in Dutch', async () => {
  await page.locator('.preview').focus();
  await page.keyboard.press('?');
  await wait();
  await has('.shortcuts', 'Sneltoetsen', 'sheet');
  await has('.shortcuts', 'Vorm toevoegen', 'sheet');
  await has('.shortcuts', 'Muis en trackpad', 'sheet');
  await page.fill('.shortcuts-search', 'vorm');
  await wait(200);
  await has('.shortcuts', 'Vorm toevoegen', 'sheet search in Dutch');
  await page.screenshot({ path: path.join(out, 'dutch-shortcuts-1512.png') });
  await page.keyboard.press('Escape');
});

await step('the inspector in Dutch', async () => {
  await page.click('.drawing [data-node="db"]');
  await wait(400);
  const words = await page.locator('.inspector').first().innerText();
  if (!/Label|Soort/.test(words) || /\bKind\b/.test(words)) fail(`the inspector is not Dutch: ${words.slice(0, 200)}`);
});

await step('screenshots in Dutch', async () => {
  for (const width of [1280, 1512]) {
    await page.setViewportSize({ width, height: 860 });
    await wait(400);
    await page.screenshot({ path: path.join(out, `dutch-editor-${width}.png`) });
  }
  // The builder: the Drawing tab folds the YAML to its rail, the rail's second button shows the shapes.
  await page.click('.view-switch [role="radio"] >> nth=0');
  await page.click('.yaml-strip .rail-icon');
  await wait(500);
  for (const width of [1280, 1512]) {
    await page.setViewportSize({ width, height: 860 });
    await wait(400);
    await page.screenshot({ path: path.join(out, `dutch-builder-${width}.png`) });
  }
  await page.setViewportSize({ width: 1512, height: 900 });
});

await step('Dutch after a reload', async () => {
  await page.reload();
  await page.waitForSelector('.drawing [data-node="db"]');
  await has('.topbar', 'Exporteren', 'toolbar after reload');
});

await step('back to English', async () => {
  await pick('en');
  await has('.topbar', 'Export', 'toolbar');
  const top = await page.locator('.topbar').innerText();
  if (top.includes('Exporteren')) fail('still Dutch after picking English');
  await pick('browser');
  if ((await page.evaluate(() => document.documentElement.lang)) !== 'en') fail('the browser language (English) did not come back');
});

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all Dutch steps ok');
await browser.close();
process.exitCode = problems.length ? 1 : 0;
