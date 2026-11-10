// Steps and presenting: a step made from the selection, the strip (pick, name, move, remove, undo), the
// presenter (keys, jump, blank, exit), views walked in order and a link followed and come back from:
// node e2e/present.mjs <outDir>
import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
const yaml = () => page.evaluate(() => JSON.parse(localStorage.getItem('cartography:doc') ?? '{}').text ?? '');
const saved = async () => (await wait(500), yaml());
const chips = () => page.locator('.steps-strip .step-chip[data-step]:not([data-step="0"])').count();
const active = () => page.locator('.steps-strip .step-chip.active').getAttribute('data-step');
const count = () => page.locator('.present-count').innerText();
const words = () => page.locator('.present-words').innerText();
// What stands back in a step lies flat: a dimmed card has lost its shadow.
// Standing back in a step: the renderer says so on the element, whatever the look (the default has no shadows to lose).
const flat = (id) => page.evaluate((id) => !!document.querySelector(`.drawing [data-node="${id}"][data-dim]`), id);
const check = async (what, got, want) => got === want || fail(`${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);

const text = `type: azure
title: Shop
nodes:
  users: users
  web: { kind: app-service, label: Shop }
  db: { kind: sql-database, label: Orders }
  vault: { kind: key-vault, label: Secrets }
edges:
  - users -> web
  - web -> db
  - web -> vault
`;
const seed = (text, name) =>
  page.addInitScript(
    ([text, name]) => {
      if (sessionStorage.getItem('seeded') === name) return;
      sessionStorage.setItem('seeded', name);
      localStorage.clear();
      for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'visual', doc: { text, doc: { name } } })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
    },
    [text, name],
  );
await seed(text, 'steps.yaml');
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.waitForSelector('.drawing [data-node="vault"]', { timeout: 10000 });
await wait(400);

// 1. No steps yet: no strip, and the toolbar offers Step and Present.
{
  if (await page.locator('.steps-strip').count()) fail('a strip without steps');
  if (!(await page.locator('.canvas-tools button:has-text("Present")').isVisible())) fail('no Present button in the toolbar');
  if (!(await page.locator('.canvas-tools button:has-text("Step")').isVisible())) fail('no Step button in the toolbar');
}

// 2. A step from the selection: S, name it, and the YAML has it with the selection as its focus.
{
  await page.locator('.drawing [data-node="web"]').click();
  await page.locator('.drawing [data-node="db"]').click({ modifiers: ['Shift'] });
  await page.locator('.preview').focus();
  await page.keyboard.press('s');
  await page.waitForSelector('.step-chip.editing input');
  await check('name offered for a step of two', await page.locator('.step-chip.editing input').inputValue(), 'Shop and Orders');
  await page.keyboard.type('The order is stored');
  await page.keyboard.press('Enter');
  const y = await saved();
  if (!/steps:\n  - title: The order is stored\n    focus: \[ ?web, db ?\]/.test(y)) fail('step from selection not written:\n' + y);
  await check('steps after the first', await chips(), 1);
  await check('the new step is shown', await active(), '1');
  if (!(await flat('vault')) || (await flat('web'))) fail('step 1 should dim the vault and keep the shop');
  await page.screenshot({ path: `${out}/s1-first-step.png` });
}

// 3. A second and a third step; [ and ] walk them and come back to the whole drawing.
{
  await page.locator('.drawing [data-node="vault"]').click();
  await page.locator('.preview').focus();
  await page.keyboard.press('s');
  await page.waitForSelector('.step-chip.editing input');
  await page.keyboard.type('Secrets stay in the vault');
  await page.keyboard.press('Enter');
  await wait(500);
  await page.locator('.drawing [data-node="users"]').click();
  await page.locator('.steps-strip .step-chip.add').click();
  await page.waitForSelector('.step-chip.editing input');
  await page.keyboard.press('Enter');
  const y = await saved();
  if (!/- title: Secrets stay in the vault\n    focus: vault\n  - title: Users\n    focus: users/.test(y)) fail('second and third step not written:\n' + y);
  await check('steps', await chips(), 3);
  await page.locator('.preview').focus();
  await page.keyboard.press('[');
  await wait();
  await check('[ goes back', await active(), '2');
  if (await flat('vault')) fail('step 2 should light the vault');
  await page.keyboard.press(']');
  await page.keyboard.press(']');
  await wait();
  await check('] past the last step shows everything', await active(), '0');
  if (await flat('vault')) fail('nothing should be dim without a step');
  await page.locator('.steps-strip .step-chip[data-step="2"]').click();
  await wait();
  await check('a click picks the step', await active(), '2');
  await page.screenshot({ path: `${out}/s2-strip.png` });
}

// 4. On a chip: ⌥← moves it, one undo brings it back, F2 names it, ⌫ removes it.
{
  const before = await saved();
  await page.locator('.steps-strip .step-chip[data-step="2"]').focus();
  await page.keyboard.press('Alt+ArrowLeft');
  const moved = await saved();
  if (moved.indexOf('Secrets stay') > moved.indexOf('The order is stored')) fail('⌥← did not move the step:\n' + moved);
  await check('the moved step is still shown', await active(), '1');
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+z');
  await check('one undo takes the move back', await saved(), before);
  await page.locator('.steps-strip .step-chip[data-step="3"]').focus();
  await page.keyboard.press('F2');
  await page.waitForSelector('.step-chip.editing input');
  await page.keyboard.type('Customers come in');
  await page.keyboard.press('Enter');
  const named = await saved();
  if (!named.includes('- title: Customers come in\n    focus: users')) fail('F2 did not name the step:\n' + named);
  await wait();
  await page.locator('.steps-strip .step-chip[data-step="3"]').focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Backspace');
  const less = await saved();
  if (less.includes('Secrets stay')) fail('⌫ did not remove the step:\n' + less);
  await check('steps after removing one', await chips(), 2);
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+z');
  await check('one undo brings the step back', await saved(), named);
}

// 5. Presenting: P, the keys, a jump, blank, and Esc back to the editor.
{
  await page.locator('.steps-strip .step-chip[data-step="0"]').click();
  await page.locator('.preview').focus();
  await page.keyboard.press('p');
  await page.waitForSelector('.present .present-frame svg');
  await wait(600);
  await check('starts at the first step', await count(), '1 / 3');
  await check('says the step', await words(), 'The order is stored');
  await page.screenshot({ path: `${out}/s3-present-1.png` });
  await page.keyboard.press('ArrowRight');
  await wait(600);
  await check('→', await count(), '2 / 3');
  await check('says the second step', await words(), 'Secrets stay in the vault');
  await page.screenshot({ path: `${out}/s4-present-2.png` });
  await page.keyboard.press('Space');
  await page.keyboard.press('Space');
  await wait(600);
  await check('Space stops at the last', await count(), '3 / 3');
  await page.keyboard.press('PageUp');
  await wait(600);
  await check('PageUp', await count(), '2 / 3');
  await page.keyboard.press('Home');
  await wait(600);
  await check('Home', await count(), '1 / 3');
  await page.keyboard.press('End');
  await wait(600);
  await check('End', await count(), '3 / 3');
  await page.keyboard.press('2');
  if (!(await page.locator('.present-note').innerText()).includes('Go to 2')) fail('typing a number should say where it goes');
  await page.keyboard.press('Enter');
  await wait(600);
  await check('2 ↵ jumps', await count(), '2 / 3');
  await page.keyboard.press('b');
  if (!(await page.locator('.present-blank').isVisible())) fail('B did not blank the screen');
  await page.keyboard.press('b');
  if (await page.locator('.present-blank').count()) fail('a key should bring the drawing back');
  await check('still there after blanking', await count(), '2 / 3');
  // The step drawn is the same size and place as the one before: the picture builds up, it does not jump.
  const box = () => page.locator('.present-frame:last-child svg').boundingBox();
  const a = await box();
  await page.keyboard.press('ArrowLeft');
  await wait(600);
  const b = await box();
  if (a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height) fail(`the drawing moved between steps: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  await page.keyboard.press('Escape');
  await wait();
  if (await page.locator('.present').count()) fail('Esc did not stop presenting');
  await check('the editor is as it was', await chips(), 3);
  // From the palette too.
  await page.keyboard.press('Meta+k');
  await page.keyboard.type('present full');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.present .present-frame svg');
  await page.locator('.present-tools button:has-text("Exit")').click();
  await wait();
  if (await page.locator('.present').count()) fail('Exit did not stop presenting');
}

// 6. Views, with a link from one to the other: the views come in order, the steps of a view inside it,
//    Tab and ↵ follow the link and ⌫ comes back. ⌘↩ starts presenting from the YAML editor.
{
  const views = `type: systems
title: Shop
nodes:
  customer: { kind: user, label: Customer }
  web: { kind: client, label: Web shop, links: ['#inside'] }
  api: { kind: service, label: Orders API }
  db: { kind: database, label: Orders DB }
edges:
  - customer -> web
  - web -> api
  - api -> db
views:
  overview:
    title: The shop from outside
    exclude: [api, db]
  inside:
    title: Inside the shop
    steps:
      - web -> api: The web shop calls the API.
      - api -> db: The API stores the order.
`;
  await seed(views, 'views.yaml');
  await page.reload();
  await page.waitForSelector('.drawing [data-node="web"]', { timeout: 10000 });
  await page.locator('.preview').focus();
  await page.keyboard.press('p');
  await page.waitForSelector('.present .present-frame svg');
  await wait(600);
  await check('the drawing as written, a slide per view, and per step inside one', await count(), '1 / 4');
  await page.keyboard.press('ArrowRight');
  await wait(600);
  await check('the first view', await count(), '2 / 4');
  if (!(await page.locator('.present-frame:last-child svg').innerHTML()).includes('The shop from outside')) fail('the view should be drawn with its title');
  await page.keyboard.press('Tab');
  await wait();
  if (!(await page.locator('.present-ring').isVisible())) fail('Tab did not ring the linked element');
  await page.screenshot({ path: `${out}/s5-present-link.png` });
  await page.keyboard.press('Enter');
  await wait(600);
  await check('↵ follows the link to the view', await count(), '3 / 4');
  if (!(await words()).includes('The web shop calls the API.')) fail('the linked view starts at its first step: ' + (await words()));
  await page.keyboard.press('ArrowRight');
  await wait(600);
  await check('the steps of the view', await count(), '4 / 4');
  // A tall drawing is fitted to the stage: nothing runs under the caption or off the screen.
  const fit = await page.evaluate(() => {
    const a = document.querySelector('.present-frame:last-child svg').getBoundingClientRect();
    const b = document.querySelector('.present-stage').getBoundingClientRect();
    return a.top >= b.top - 1 && a.bottom <= b.bottom + 1 && a.left >= b.left - 1 && a.right <= b.right + 1;
  });
  if (!fit) fail('the drawing does not fit the stage');
  await page.screenshot({ path: `${out}/s6-present-view-step.png` });
  await page.keyboard.press('Backspace');
  await wait(600);
  await check('⌫ comes back to where the link was', await count(), '2 / 4');
  await page.keyboard.press('Escape');
  await wait();
  if (await page.locator('.present').count()) fail('Esc did not stop presenting the views');
}

// A drawing without steps: told group by group, said so, and filling the screen; without groups one
// slide, and the arrows say why they do nothing.
{
  await seed('type: azure\ngroups:\n  front: { kind: resource-group, label: Front }\n  back: { kind: resource-group, label: Back }\nnodes:\n  web: { kind: app-service, in: front }\n  db: { kind: sql-database, in: back }\nedges:\n  - web -> db\n', 'plain.yaml');
  await page.reload();
  await page.waitForSelector('.drawing [data-node="db"]', { timeout: 10000 });
  await page.locator('.preview').focus();
  await page.keyboard.press('p');
  await page.waitForSelector('.present-frame svg');
  await wait(900);
  check('slides made from the groups', await page.locator('.present-count').innerText().catch(() => ''), '1 / 3');
  if (!/group by group/.test(await page.locator('.present-about').innerText().catch(() => ''))) fail('presenting by group is not said');
  const svg = await page.locator('.present-frame:last-child svg').boundingBox();
  if (!svg || (svg.width < 1512 * 0.6 && svg.height < 900 * 0.7)) fail(`the drawing does not fill the screen: ${JSON.stringify(svg)}`);
  await page.screenshot({ path: `${out}/p-auto-steps.png` });
  await page.keyboard.press('Escape');
  await wait();
  await seed('type: azure\nnodes:\n  web: app-service\n  db: sql-database\nedges:\n  - web -> db\n', 'flat.yaml');
  await page.reload();
  await page.waitForSelector('.drawing [data-node="db"]', { timeout: 10000 });
  await page.locator('.preview').focus();
  await page.keyboard.press('p');
  await page.waitForSelector('.present-frame svg');
  await wait(600);
  if (!/^One slide/.test(await page.locator('.present-about').innerText().catch(() => ''))) fail('one slide without a word on how to make more');
  if (!/no steps/.test((await page.locator('.present-tools button[aria-label="Next"]').getAttribute('title')) ?? '')) fail('the disabled Next does not say why');
  await page.keyboard.press('Escape');
}

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all present steps ok');
await browser.close();
