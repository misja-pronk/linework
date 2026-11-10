// Stages: a diagram with stages: (as-is, the stages between, to-be) gets a timeline strip under the
// drawing. Each stage is drawn on the placement of everything (nothing moves between them); ← → on
// the strip and , . on the drawing walk them; adding while a stage is picked records it in that
// stage's add:, deleting records remove:; "Compare stages" opens the compare view on two stages and
// "Make roadmap" opens the roadmap the stages make: node e2e/stages.mjs <outDir>
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? '.';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('cartography:doc') ?? '{}'));
const yaml = async () => (await wait(600), (await stored()).text ?? '');
const places = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.drawing [data-node]')].map((n) => { const b = n.getBBox(); return [n.getAttribute('data-node'), `${Math.round(b.x)},${Math.round(b.y + b.height)}`]; })));
const nodes = () => page.evaluate(() => [...new Set([...document.querySelectorAll('.drawing [data-node]')].map((n) => n.getAttribute('data-node')))].sort().join(' '));
const drawn = async (what, want) => {
  try {
    await page.waitForFunction((want) => [...new Set([...document.querySelectorAll('.drawing [data-node]')].map((n) => n.getAttribute('data-node')))].sort().join(' ') === want, want, { timeout: 5000 });
  } catch {
    fail(`${what}: expected ${want}, got ${await nodes()}`);
  }
};
const active = async () => (await page.locator('.stages-strip .step-chip.active').innerText()).replace(/\s+/g, ' ').trim();
const drawing = () => page.locator('.preview').focus();
const palette = async (words) => {
  await page.keyboard.press('Meta+k');
  await page.keyboard.type(words);
  await wait(200);
  await page.keyboard.press('Enter');
};

const text = `type: azure
title: Move to Azure
groups:
  dc: { kind: on-premises, label: Data centre }
  lz: { kind: subscription, label: Landing zone }
nodes:
  users: users
  vm: { kind: vm, label: Web VM, in: dc }
  sql: { kind: sql-server, label: SQL VM, in: dc }
  web: { kind: app-service, label: Web app, in: lz }
  db: { kind: sql-database, label: Orders, in: lz }
edges:
  - users -> vm
  - vm -> sql
  - users -> web
  - web -> db
stages:
  - { id: as-is, title: As-is, when: 2026-Q1 }
  - id: q2
    title: Web moves
    when: 2026-Q2
    replace: { vm: web }
    add: [lz]
  - id: to-be
    title: To-be
    when: 2026-Q4
    replace: { sql: db }
    remove: [dc]
`;
await page.addInitScript(() => {
  const next = sessionStorage.getItem('seed');
  if (!next) return;
  sessionStorage.removeItem('seed');
  localStorage.clear();
  const { text, name } = JSON.parse(next);
  for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'visual', doc: { text, doc: { name } } })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
});
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.evaluate((next) => sessionStorage.setItem('seed', next), JSON.stringify({ text, name: 'move.yaml' }));
await page.reload();
await page.waitForSelector('.drawing [data-node="db"]', { timeout: 10000 });
await wait(400);

// 1. The editor opens on the overview: everything, each element marked with when; the strip lists the stages.
{
  if (!(await page.locator('.stages-strip').isVisible())) fail('no stages strip under the drawing');
  const chips = (await page.locator('.stages-strip .stages-row .step-chip').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  if (chips.join(' | ') !== 'Overview | As-is 2026-Q1 | Web moves 2026-Q2 | To-be 2026-Q4') fail(`strip chips: ${chips.join(' | ')}`);
  await drawn('overview', 'db sql users vm web');
  if (!(await page.locator('.drawing svg').first().innerHTML()).includes('+ To-be')) fail('the overview does not mark what comes in the to-be');
  await page.screenshot({ path: `${out}/1-overview.png` });
}

// 2. A click on a stage draws it, on the same places: nothing moves between stages.
const whole = await places();
{
  await page.locator('.stages-strip [data-stage="as-is"]').click();
  await drawn('as-is', 'sql users vm');
  const now = await places();
  for (const id of ['users', 'vm', 'sql']) if (now[id] !== whole[id]) fail(`${id} moved between the overview and the as-is: ${whole[id]} → ${now[id]}`);
  await page.screenshot({ path: `${out}/2-as-is.png` });
}

// 3. ← → on the strip walk the stages; , and . on the drawing too.
{
  await page.locator('.stages-strip [data-stage="as-is"]').focus();
  await page.keyboard.press('ArrowRight');
  await drawn('→ to q2', 'sql users web');
  if (!(await active()).startsWith('Web moves')) fail(`after →, active chip is ${await active()}`);
  await drawing();
  await page.keyboard.press('.');
  await drawn('. to the to-be', 'db users web');
  const now = await places();
  for (const id of ['users', 'web', 'db']) if (now[id] !== whole[id]) fail(`${id} moved between the overview and the to-be`);
  await page.keyboard.press(',');
  await drawn(', back to q2', 'sql users web');
  await page.screenshot({ path: `${out}/3-q2.png` });
}

// 4. Adding while a stage is picked: it comes in that stage.
{
  await drawing();
  await page.keyboard.press('a');
  await page.keyboard.type('key vault');
  await page.keyboard.press('Enter');
  const t = await yaml();
  if (!/add: \[\s*lz, key-vault\s*\]/.test(t)) fail(`adding in q2 did not write add: [lz, key-vault]\n${t}`);
  await drawn('q2 with the new vault', 'key-vault sql users web');
  await page.locator('.stages-strip [data-stage="as-is"]').click();
  await drawn('the as-is has no vault', 'sql users vm');
}

// 5. Deleting while a stage is picked: it goes in that stage, and stays in the ones before.
{
  await page.locator('.stages-strip [data-stage="q2"]').click();
  await drawn('q2 again', 'key-vault sql users web');
  await page.locator('.drawing [data-node="users"]').first().click();
  await page.keyboard.press('Backspace');
  const t = await yaml();
  if (!/remove: \[\s*users\s*\]/.test(t.slice(t.indexOf('id: q2')))) fail(`deleting in q2 did not write remove: [users]\n${t.slice(t.indexOf('stages:'))}`);
  if (!/\n {2}users: users/.test(t)) fail('deleting in a stage took the element out of the file');
  await drawn('q2 without users', 'key-vault sql web');
  await page.locator('.stages-strip [data-stage="as-is"]').click();
  await drawn('the as-is still has users', 'sql users vm');
  // Deleting what only comes in this stage takes it out of the file, and out of the stage.
  await page.locator('.stages-strip [data-stage="q2"]').click();
  await drawn('q2 once more', 'key-vault sql web');
  await page.locator('.drawing [data-node="key-vault"]').first().click();
  await page.keyboard.press('Backspace');
  const u = await yaml();
  if (/key-vault/.test(u)) fail(`deleting what q2 adds left it in the file\n${u.slice(u.indexOf('stages:'))}`);
}

// 6. Compare stages: the compare view, the as-is before and the stage after.
{
  await drawing();
  await palette('Compare stages: As-is');
  await page.waitForSelector('.compare', { timeout: 8000 }).catch(() => fail('Compare stages did not open the compare view'));
  await wait(1500);
  const body = await page.locator('.compare').innerText().catch(() => '');
  if (!/Replaced Web VM by Web app/.test(body)) fail(`the compare list does not say what replaces what:\n${body.slice(0, 400)}`);
  await page.screenshot({ path: `${out}/4-compare.png` });
  await page.keyboard.press('Escape');
  await wait(300);
}

// 7. Make roadmap: a new document, a roadmap with an item per change.
{
  await page.locator('.stages-strip button', { hasText: 'Make roadmap' }).click();
  // The unsaved diagram: the app asks before it is left (its own dialog).
  const discard = page.locator('.confirm-dialog button', { hasText: 'Discard' });
  await discard.waitFor({ timeout: 5000 }).then(() => discard.click()).catch(() => {});
  await wait(1500);
  const t = (await stored()).text ?? '';
  if (!/^type: roadmap/m.test(t)) fail(`Make roadmap did not open a roadmap:\n${t.slice(0, 300)}`);
  else if (!/Web VM → Web app/.test(t)) fail(`the roadmap has no item for the replacement:\n${t}`);
  await page.screenshot({ path: `${out}/5-roadmap.png` });
}

await browser.close();
if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log('stages: all good');
