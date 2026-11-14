// Layers: the Layers control in the canvas tools switches the diagram's layers: on and off (L, then
// 1–9, 0 for everything, D for only / faded; or clicks on the toggles), the chip says what is drawn,
// a focus wins and the layers wait, the palette has "Show layer X" and "#tag", the inspector edits
// tags as chips that complete from the file, and the presenter goes through the layers on L. The YAML
// stays as it is throughout: node e2e/layers.mjs <outDir>
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? '.';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('linework:doc') ?? '{}'));
const yaml = async () => (await wait(500), (await stored()).text ?? '');
/** Where each node is in the drawing's own units: the canvas may zoom to fit, the drawing does not move. */
const places = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.drawing [data-node]')].map((n) => { const b = n.getBBox(); return [n.getAttribute('data-node'), `${Math.round(b.x)},${Math.round(b.y)}`]; })));
const nodes = () => page.evaluate(() => [...document.querySelectorAll('.drawing [data-node]')].map((n) => n.getAttribute('data-node')).sort().join(' '));
const faded = () => page.evaluate(() => [...document.querySelectorAll('.drawing [data-node][data-dim]')].map((n) => n.getAttribute('data-node')).sort().join(' '));
const chip = async () => ((await page.locator('.layers-chip').count()) ? (await page.locator('.layers-chip').innerText()).replace(/\s+/g, ' ').trim() : '');
const check = (what, got, want) => got === want || fail(`${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
const drawn = async (what, want) => {
  try {
    await page.waitForFunction((want) => [...document.querySelectorAll('.drawing [data-node]')].map((n) => n.getAttribute('data-node')).sort().join(' ') === want, want, { timeout: 5000 });
  } catch {
    fail(`${what}: expected ${want}, got ${await nodes()}`);
  }
};
const drawing = () => page.locator('.preview').focus();
const palette = async (words) => {
  await page.keyboard.press('Meta+k');
  await page.keyboard.type(words);
  await wait(150);
  await page.keyboard.press('Enter');
};

const text = `type: azure
title: Web shop
groups:
  rg: { kind: resource-group, label: rg-shop }
  apps: { kind: subnet, label: snet-apps, in: rg }
  data: { kind: subnet, label: snet-data, in: rg }
nodes:
  users: users
  edge: { kind: front-door, label: Front Door, tags: [security] }
  web: { kind: app-service, label: Web shop, in: apps }
  api: { kind: container-app, label: Orders API, in: apps }
  db: { kind: sql-database, label: Orders, in: data, tags: [data] }
  vault: { kind: key-vault, label: Secrets, in: rg, tags: [security] }
edges:
  - users -> edge: { label: HTTPS, tags: [security] }
  - edge -> web
  - web -> api: REST
  - api -> db: { label: SQL, tags: [data] }
  - api -> vault: { label: secrets, tags: [security] }
layers:
  security: { tags: [security], title: Security }
  data: { tags: [data], title: Data }
  phase: { tags: [phase-2], dim-others: true }
`;
const ALL = 'api db edge users vault web';
await page.addInitScript(() => {
  const next = sessionStorage.getItem('seed');
  if (!next) return;
  sessionStorage.removeItem('seed');
  localStorage.clear();
  const { text, name } = JSON.parse(next);
  for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'visual', doc: { text, doc: { name } } })) localStorage.setItem(`linework:${k}`, JSON.stringify(v));
});
await page.goto(process.env.LINEWORK_URL ?? 'http://localhost:5178/');
await page.evaluate((next) => sessionStorage.setItem('seed', next), JSON.stringify({ text, name: 'layers.yaml' }));
await page.reload();
await page.waitForSelector('.drawing [data-node="vault"]', { timeout: 10000 });
await wait(400);

// 1. The control: in the tools with its key, no chip while everything is drawn; a layer nobody tagged is a warning.
{
  const tool = page.locator('.canvas-tools .layers-control > button');
  if (!(await tool.isVisible())) fail('no Layers button in the canvas tools');
  else if (!(await tool.innerText()).includes('L')) fail('the Layers button does not show its key');
  check('no chip with every layer off', await chip(), '');
  await page.locator('.status-problems').first().click();
  await wait(200);
  if (!(await page.locator('body').innerText()).includes('Nothing here has the tag "phase-2"')) fail('a layer whose tag nothing carries should be reported');
  await page.keyboard.press('Escape');
  await wait(200);
}

// 2. Keyboard: L opens the panel, 1 shows Security only (with what it needs), 2 adds Data, D fades the rest in place, 0 is everything.
{
  await drawing();
  await page.keyboard.press('l');
  await wait(150);
  if (!(await page.locator('.layers-panel').isVisible())) fail('L should open the layers panel');
  if ((await page.evaluate(() => document.activeElement?.getAttribute('role'))) !== 'menuitemcheckbox') fail('the first layer toggle should have the keyboard');
  await page.keyboard.press('1');
  // Security: the front door and the vault, the users and the API at the ends of its lines, the API's subnet.
  await drawn('the security layer', 'api edge users vault');
  const c = await chip();
  if (!c.includes('Layer Security') || !c.includes('4 of 6')) fail('the chip should say which layer and how much of the drawing: ' + c);
  if (!(await page.locator('.drawing svg').innerHTML()).includes('Security layer')) fail('the drawing should say under its title which layer it is');
  if (!(await page.locator('.drawing svg').innerHTML()).includes('what is tagged security')) fail('the key should name the layer');
  await page.keyboard.press('2');
  await drawn('security and data', 'api db edge users vault');
  if (!(await chip()).includes('Security, Data')) fail('the chip should name both layers: ' + (await chip()));
  await page.screenshot({ path: `${out}/l1-two-layers.png` });
  await page.keyboard.press('d');
  await drawn('faded: everything drawn', ALL);
  check('faded: what is off the layers', await faded(), 'web');
  if (!(await chip()).includes('Faded rest')) fail('the chip should say the rest is faded: ' + (await chip()));
  await page.screenshot({ path: `${out}/l2-faded.png` });
  // Faded keeps the whole drawing's places: switching another layer on and off moves nothing.
  const placed = await places();
  await page.keyboard.press('2');
  await wait(600);
  const again = await places();
  if (JSON.stringify(placed) !== JSON.stringify(again)) fail(`a faded layer should keep every place: ${JSON.stringify(placed)} then ${JSON.stringify(again)}`);
  await page.keyboard.press('0');
  await drawn('0: everything', ALL);
  // The faded drawing has every node too: what tells them apart is the fading, gone once the new drawing is in (made in a worker, it comes a moment later).
  await page.waitForFunction(() => !document.querySelector('.drawing [data-node][data-dim]'), undefined, { timeout: 5000 }).catch(() => undefined);
  check('0: nothing faded', await faded(), '');
  check('0: no chip', await chip(), '');
  await page.keyboard.press('Escape');
  await wait(150);
  if (await page.locator('.layers-panel').count()) fail('Esc should close the panel');
  if (!(await page.evaluate(() => document.activeElement?.classList.contains('preview')))) fail('Esc should give the keyboard back to the drawing');
  check('the YAML stays as it is', await yaml(), text);
}

// 3. Trackpad: a click opens the panel, clicks toggle (several at once), ⌥-click shows one alone, a click outside closes.
{
  await page.locator('.canvas-tools .layers-control > button').click();
  await page.locator('.layer-toggle:has-text("Data")').click();
  await drawn('a click on Data', 'api db');
  await page.locator('.layer-toggle:has-text("Security")').click();
  await drawn('a click on Security as well', 'api db edge users vault');
  await page.locator('.layer-toggle:has-text("Data")').click({ modifiers: ['Alt'] });
  await drawn('⌥-click: Data alone', 'api db');
  if (!(await page.locator('.layers-panel').isVisible())) fail('the panel should stay open while toggling');
  await page.screenshot({ path: `${out}/l3-panel.png` });
  await page.locator('.layers-mode button:has-text("Fade the rest")').click();
  await drawn('Fade the rest', ALL);
  await page.mouse.click(700, 860);
  await wait(150);
  if (await page.locator('.layers-panel').count()) fail('a click outside should close the panel');
  await page.locator('.layers-chip button[aria-label="The whole drawing"]').click();
  await drawn('the chip’s ×', ALL);
  check('×: no chip', await chip(), '');
}

// 4. The palette: Show layer, All layers, and #tag lists what carries it.
{
  await drawing();
  await palette('show layer data');
  await drawn('palette: Show layer Data', 'api db');
  await palette('all layers');
  await drawn('palette: All layers', ALL);
  await page.keyboard.press('Meta+k');
  await page.keyboard.type('#secu');
  await wait(200);
  const items = (await page.locator('.palette [role="option"]').allInnerTexts()).map((t) => t.split('\n')[0]);
  const names = items.join(' | ');
  if (!names.includes('Front Door') || !names.includes('Secrets') || names.includes('Orders API')) fail('#secu should list only what is tagged security: ' + names);
  await page.keyboard.press('Escape');
}

// 5. Precedence: a focus wins and the layers wait, said in the chip; leaving the focus brings them back.
{
  await drawing();
  await page.keyboard.press('l');
  await page.keyboard.press('1');
  await page.keyboard.press('Escape');
  await drawn('security again', 'api edge users vault');
  await page.locator('.drawing [data-node="vault"]').click();
  await drawing();
  await page.keyboard.press('f');
  await drawn('a focus on the vault, over the layer', 'api vault');
  const c = await chip();
  if (!c.includes('wait') || !c.includes('focus')) fail('the chip should say the layers wait for the focus: ' + c);
  await page.screenshot({ path: `${out}/l4-focus-wins.png` });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await drawn('out of the focus, the layer again', 'api edge users vault');
  await page.keyboard.press('l');
  await page.keyboard.press('0');
  await page.keyboard.press('Escape');
  await drawn('everything again', ALL);
}

// 6. The inspector: tags as chips, completed from the file; each change written to the YAML.
{
  await page.locator('.drawing [data-node="web"]').click();
  await wait(300);
  const more = page.locator('.inspector-more');
  if ((await more.count()) && !(await more.getAttribute('open'))) await more.locator('summary').click();
  const field = page.locator('.inspector .tag-chips input');
  if (!(await field.count())) fail('no tag field in the inspector');
  else {
    await field.click();
    await page.keyboard.type('sec');
    await wait(100);
    if (!(await page.locator('.tag-suggestions').innerText()).includes('security')) fail('the tag field should suggest tags of the file');
    await page.keyboard.press('Enter');
    await wait(500);
    if (!/web: \{[^}]*tags: \[ ?security ?\]/.test(await yaml())) fail('the tag should be written to the YAML: ' + (await yaml()).split('\n').find((l) => l.includes('web:')));
    await page.keyboard.type('ops,');
    await wait(500);
    if (!/web: \{[^}]*tags: \[ ?security, ops ?\]/.test(await yaml())) fail('a comma should add the tag: ' + (await yaml()).split('\n').find((l) => l.includes('web:')));
    await page.screenshot({ path: `${out}/l5-tags.png` });
    await page.keyboard.press('Backspace');
    await wait(500);
    if (/web: \{[^}]*ops/.test(await yaml())) fail('Backspace in an empty field should take the last tag off');
  }
  await page.keyboard.press('Escape');
}

// 7. Presenting: L adds a slide per layer.
{
  await page.screenshot({ path: `${out}/l6-before-present.png` });
  await drawing();
  await page.keyboard.press('p');
  await page.waitForSelector('.present .present-frame svg', { timeout: 5000 }).catch(() => fail('P should present'));
  await wait(600);
  await page.keyboard.press('l');
  await wait(800);
  const said = await page.locator('.present').innerText({ timeout: 2000 }).catch(() => '');
  if (!said.includes('A slide per layer')) fail('L in the presenter should go through the layers: ' + said.slice(0, 200));
  await page.keyboard.press('End');
  await wait(800);
  const end = await page.locator('.present').innerText({ timeout: 2000 }).catch(() => '');
  if (!end.includes('Data layer')) fail('the last slide should be the last layer: ' + end.slice(0, 200));
  await page.screenshot({ path: `${out}/l6-present.png` });
  await page.keyboard.press('Escape');
}

await browser.close();
if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log('layers: ok');
