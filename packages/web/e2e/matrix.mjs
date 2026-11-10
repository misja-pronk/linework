// Matrix: the type is found from the start dialog by "raci", its template draws a checked table,
// a row without its one A is a warning, and PowerPoint gets a real table: node e2e/matrix.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';
const out = process.argv[2] ?? fs.mkdtempSync('/tmp/matrix-');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('cartography:doc') ?? '{}'));
const yaml = async () => (await wait(500), (await stored()).text ?? '');
const drawing = () => page.locator('.drawing svg').first().innerHTML();

await page.addInitScript(() => {
  const text = sessionStorage.getItem('seed');
  if (!text) return;
  sessionStorage.removeItem('seed');
  localStorage.setItem('cartography:doc', JSON.stringify({ text, doc: { name: 'raci.yaml' } }));
});
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.evaluate(() => {
  localStorage.clear();
  for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'code' })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
});
await page.reload();
await page.waitForSelector('.preview svg');

// 1. New → "raci" finds the matrix type; its template opens.
{
  await page.getByRole('button', { name: 'New' }).click();
  await page.waitForSelector('.start .type-card');
  await page.keyboard.type('raci');
  await wait(400);
  const first = await page.locator('.start .type-card').first().innerText();
  if (!first.includes('Matrix')) fail(`"raci" does not find the matrix type first: ${first.split('\n')[0]}`);
  await page.locator('.type-main', { hasText: 'Matrix' }).first().click();
  await page.locator('.template-card', { hasText: 'Template' }).first().click();
  await page.waitForSelector('.mode-card').catch(() => {});
  await page.keyboard.press('3').catch(() => {});
  await wait(800);
  if (!/^type: matrix/m.test(await yaml())) {
    // The mode step may differ: open the template the way the dialog offers it.
    await page.locator('.mode-card').last().click().catch(() => {});
    await wait(800);
  }
  if (!/^type: matrix/m.test(await yaml())) fail('the matrix template did not open');
}

// 2. The drawing: role groups over the columns, phases between the rows, R/A/C/I in the cells and the key.
{
  await page.waitForFunction(() => document.querySelector('.drawing svg')?.innerHTML.includes('Migration plan'), null, { timeout: 8000 }).catch(() => fail('the RACI table is not drawn'));
  const svg = await drawing();
  for (const want of ['BUSINESS', 'PREPARE', 'Programme manager', 'Accountable: signs off, one per activity']) if (!svg.includes(want)) fail(`the drawing lacks "${want}"`);
  if ((await page.locator('.status-problems').innerText()).match(/[1-9]\d* warning/)) fail('the template should have no warnings');
  await page.screenshot({ path: path.join(out, 'matrix-raci.png') });
}

// 3. A row without its A: a warning that says so.
{
  const text = (await yaml()).replace('case: { sponsor: A,', 'case: { sponsor: C,');
  // Handed to the next load, after the page has written its own document on leaving.
  await page.evaluate((t) => sessionStorage.setItem('seed', t), text);
  await page.reload();
  await page.waitForSelector('.drawing svg');
  await wait(800);
  await page.locator('.status-problems').click();
  await wait();
  const list = await page.locator('.palette, [role="dialog"]').last().innerText();
  if (!list.includes('"Business case" has 0 × A; it needs exactly one')) fail(`no warning about the missing A: ${list.slice(0, 200)}`);
  await page.keyboard.press('Escape');
}

// 4. PowerPoint: the matrix is a real table, with its values as text.
{
  await page.click('button:has-text("Export")');
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('[role=menuitem]:has-text("PowerPoint")')]);
  const file = path.join(out, download.suggestedFilename());
  await download.saveAs(file);
  const slide = strFromU8(unzipSync(new Uint8Array(fs.readFileSync(file)))['ppt/slides/slide1.xml'] ?? new Uint8Array());
  if (!slide.includes('<a:tbl>')) fail('pptx: the matrix is not a table');
  if (!slide.includes('<a:t>Migration plan</a:t>')) fail('pptx: the table lacks its rows');
  if ((slide.match(/gridSpan=/g) ?? []).length < 3) fail('pptx: grouped columns and phases are not merged cells');
}

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all matrix steps ok');
process.exitCode = problems.length ? 1 : 0;
await browser.close();
