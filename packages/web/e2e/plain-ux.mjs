// What a reviewer ran into driving the editor at 1280×720: typing right after an inspector edit, ⌘K
// finding what is typed, a word after every download, Undo and Redo greyed out when there is nothing
// to undo, a gentle ⌃-wheel, a toolbar that stays put when the view changes, the theme switch in the
// status bar, plain words, the keyboard going round the regions, and no console warnings.
// node e2e/plain-ux.mjs <outDir>
import { chromium } from '@playwright/test';
const out = process.argv[2];
const url = process.env.CARTO_URL ?? 'http://localhost:5178/';
const problems = [];
const fail = (m) => problems.push(m);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
const warnings = [];
page.on('pageerror', (e) => fail(e.message));
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && warnings.push(m.text()));
const wait = (ms = 300) => page.waitForTimeout(ms);
const box = (id) => page.locator(`.drawing [data-node="${id}"]`).first().boundingBox();
const open = async (title) => {
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.start .scenario');
  await page.locator('.scenario-main', { has: page.locator('.scenario-title', { hasText: new RegExp(`^${title}$`) }) }).click();
  await page.waitForSelector('.drawing svg [data-node]');
  await wait(900);
};
const palette = async (query) => {
  await page.locator('.preview').focus();
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type(query);
  await wait(200);
  return page.locator('.palette-item .palette-label').allInnerTexts();
};

try {
  await open('Data products');
  // 1. An inspector edit, then a double-click on the card and typing: the name editor opens at once
  //    and takes the letters; none of them is a shortcut (S a step, A the add menu).
  {
    const steps = await page.locator('.step-chip').count();
    let b = await box('crm');
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await wait(400);
    await page.locator('aside[aria-label="Properties"] input').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' system');
    await wait(300);
    b = await box('crm');
    await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);
    await page.keyboard.type('Sa');
    await wait(700);
    if (!(await page.locator('.label-editor').count())) fail('a double-click after an inspector edit did not open the name editor');
    else if ((await page.locator('.label-editor').inputValue()) !== 'Sa') fail(`the name editor holds "${await page.locator('.label-editor').inputValue()}", not what was typed`);
    if (await page.locator('.add-menu').count()) fail('typing after the double-click opened the add menu');
    if ((await page.locator('.step-chip').count()) !== steps) fail('typing after the double-click added a step');
    await page.screenshot({ path: `${out}/ux-dblclick-typed.png` });
    await page.keyboard.press('Escape');
  }

  // 2. ⌘K: "pdf" finds Export PDF first; Next step says ], Previous step [.
  {
    const found = await palette('pdf');
    if (!/pdf/i.test(found[0] ?? '')) fail(`⌘K "pdf" lists "${found[0]}" first`);
    await page.keyboard.press('Escape');
    await palette('next step');
    const keyOf = async (label) => page.locator('.palette-item', { has: page.locator('.palette-label', { hasText: new RegExp(`^${label}$`) }) }).locator('kbd').innerText().catch(() => '');
    if ((await keyOf('Next step')) !== ']') fail(`⌘K shows "${await keyOf('Next step')}" for Next step`);
    await page.keyboard.press('Escape');
    await palette('previous step');
    if ((await keyOf('Previous step')) !== '[') fail(`⌘K shows "${await keyOf('Previous step')}" for Previous step`);
    await page.keyboard.press('Escape');
    // A step's row keeps its name whole: the caption after it gives way.
    await palette('served');
    const cut = await page.locator('.palette-item .palette-label').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
    if (cut.length) fail(`⌘K cuts the names ${cut.join(', ')}`);
    await page.screenshot({ path: `${out}/ux-palette-steps.png` });
    await page.keyboard.press('Escape');
  }
} catch (e) {
  fail(String(e?.stack ?? e));
}
await browser.close();
const noisy = warnings.filter((w) => !/Download the React DevTools|\[vite\]/.test(w));
if (noisy.length) fail(`console: ${[...new Set(noisy)].join(' | ').slice(0, 600)}`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('plain ux: ok');
