// Threat overlay: trust boundaries drawn as such, threat numbers on elements and lines, suggestions
// from the rules as warnings (never on the drawing), the "Threat table" view, and threats set from
// the inspector of a line: node e2e/threats.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const out = process.argv[2];
if (out) fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('cartography:doc') ?? '{}'));
const yaml = async () => (await wait(500), (await stored()).text ?? '');
const drawing = () => page.locator('.drawing svg').first().innerHTML();

const text = `type: systems
title: Shop threats
groups:
  internet: { kind: trust-boundary, label: Internet }
  app: { kind: zone, label: Application zone, trust: true }
nodes:
  shopper: { kind: user, label: Shopper, in: internet }
  api: { kind: service, label: Orders API, in: app, threats: [E] }
  db: { kind: database, label: Orders DB, in: app }
edges:
  - shopper -> api: { label: HTTPS, auth: OAuth2 }
  - api -> db: SQL
`;
await page.addInitScript(() => {
  const next = sessionStorage.getItem('seed');
  if (!next) return;
  sessionStorage.removeItem('seed');
  localStorage.clear();
  // The inspector with "More" open: threats, trust and encryption are rarer fields.
  localStorage.setItem('cartography:inspectorMore', 'true');
  const { text, name } = JSON.parse(next);
  for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'visual', doc: { text, doc: { name } } })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
});
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.evaluate((next) => sessionStorage.setItem('seed', next), JSON.stringify({ text, name: 'threats.yaml' }));
await page.reload();
await page.waitForSelector('.drawing [data-node="db"]', { timeout: 10000 });
await wait(500);

// 1. The drawing: both boundaries named as trust boundaries, T1 on the Orders API, a key that explains both.
{
  const svg = await drawing();
  if ((svg.match(/>Trust boundary</g) ?? []).length < 3) fail('the trust boundaries (and the key) do not say "Trust boundary"');
  if (!svg.includes('>T1<')) fail('the threat on Orders API has no T1 tag');
  if (!svg.includes('Threat, see the threat table')) fail('the key does not explain the threat tags');
  if (out) await page.screenshot({ path: path.join(out, 'threats-drawing.png') });
}

// 2. The rules: Orders DB is not encrypted at rest, a warning, and nothing extra on the drawing.
{
  await page.locator('.status-problems').click();
  await wait();
  const list = await page.locator('.palette, [role="dialog"]').last().innerText();
  if (!list.includes('Suggested threat (I) on Orders DB')) fail(`the rules did not warn about Orders DB: ${list.slice(0, 200)}`);
  if (list.includes('Shopper → Orders API')) fail('an encrypted, authenticated line across the boundary should not be flagged');
  await page.keyboard.press('Escape');
  if ((await drawing()).includes('>T2<')) fail('a suggestion should not be drawn');
}

// 3. The threat table view: one row, T1, with its STRIDE category spelled out.
{
  const options = await page.locator('.view-picker option').allInnerTexts();
  if (!options.some((o) => o.includes('Threat table'))) fail(`no "Threat table" view: ${options.join(', ')}`);
  else {
    await page.selectOption('.view-picker select', 'threats');
    await page.waitForFunction(() => document.querySelector('.drawing svg')?.innerHTML.includes('Elevation of privilege'), null, { timeout: 5000 }).catch(() => fail('the threat table does not show T1'));
    if (out) await page.screenshot({ path: path.join(out, 'threats-table.png') });
    await page.selectOption('.view-picker select', 'diagram');
    await wait(500);
  }
}

// 4. The inspector of a line takes STRIDE letters: the line gets its own number.
{
  await page.locator('.drawing [data-node="api"]').click();
  await wait();
  await page.locator('.connections .connection:has-text("Orders DB")').click();
  await wait();
  const field = page.locator('.inspector .field:has(> span:text-is("Threats")) input');
  if (!(await field.count())) fail('the line inspector has no Threats field');
  else {
    await field.fill('T, I');
    await field.press('Enter');
    await wait(600);
    if (!/api -> db:[\s\S]*threats: \[ ?T, I ?\]/.test(await yaml())) fail(`threats not written to the line: ${(await yaml()).split('edges:')[1]}`);
    await page.waitForFunction(() => document.querySelector('.drawing svg')?.innerHTML.includes('>T2<'), null, { timeout: 5000 }).catch(() => fail('the line did not get T2'));
  }
  const enc = page.locator('.inspector .field:has(> span:text-is("Encrypted")) input');
  if (!(await enc.count())) fail('the line inspector has no Encrypted switch');
}

// 5. A group's inspector has the trust boundary switch.
{
  await page.keyboard.press('Escape');
  await page.locator('.drawing [data-group="app"]').click({ position: { x: 30, y: 12 } });
  await wait();
  const trust = page.locator('.inspector .field:has(> span:text-is("Trust boundary")) input');
  if (!(await trust.count())) fail('the group inspector has no Trust switch');
  else if (!(await trust.isChecked())) fail('the Trust switch is off for a trust boundary');
}

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all threats steps ok');
process.exitCode = problems.length ? 1 : 0;
await browser.close();
