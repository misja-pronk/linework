// The start screen: a card per drawing people come to make opens that example in the editor at once;
// a blank sheet, a search by what to show, and every template one step further. Nothing leaves the
// page. node e2e/start.mjs <outDir>
import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
/** Says Discard to the app's "Discard the unsaved changes?" dialogs until stopped (they replaced confirm()). */
const discarding = () => {
  let on = true;
  void (async () => {
    while (on && !page.isClosed()) {
      const said = await page.locator('.confirm-dialog').innerText({ timeout: 250 }).catch(() => '');
      if (said) asked.push(said);
      await page.locator('.confirm-dialog button:has-text("Discard")').click({ timeout: 250 }).catch(() => {});
    }
  })();
  return () => void (on = false);
};
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
// Starting something new over unsaved changes asks first (as opening a folder does): yes, here.
/** What the app asked before discarding unsaved changes (its own dialog), and any browser dialog (none expected). */
const asked = [];
const native = [];
page.on('dialog', (d) => (native.push(d.message()), d.accept()));
discarding();
const fail = (m) => problems.push(m);
const wait = (ms = 300) => page.waitForTimeout(ms);
const yaml = () => page.evaluate(() => document.querySelector('.cm-content').innerText);

// Nothing in the start dialog talks to the network: no request may leave the page.
await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => (fail(`network: ${route.request().url()}`), route.abort()));

await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.evaluate(() => localStorage.clear());
await page.reload();
// 1. A first visit opens the start screen: the drawings people come to make, in plain words.
await page.waitForSelector('.start .scenario');
await wait(1500);
await page.screenshot({ path: `${out}/1-start.png` });
const titles = await page.locator('.scenario-title').allInnerTexts();
if (titles.join() !== 'Azure network,Landing zone,Entra access,Azure solution,Data products,From PR to production,Sequence') fail(`the cards are ${titles}`);
const said = await page.locator('.start').innerText();
for (const jargon of [/PL\. \d/, /type: \w/, /\bHow\b/, /Your AI/]) if (jargon.test(said)) fail(`the start screen says ${jargon}`);

// 2. A card opens its example in the editor at once, on the drawing: no step in between, no undo offer.
await page.locator('.scenario-main', { hasText: 'Azure network' }).click();
await page.waitForSelector('.shapes .add-item');
await wait(800);
if (await page.locator('.start').count()) fail('the start dialog stayed open after a card');
if (!(await yaml()).includes('title: Hub and spoke')) fail('the Azure network card did not open hub-spoke');
if (await page.locator('.editor-pane').isVisible()) fail('YAML visible after opening a card');
const toast = await page.locator('.toast').innerText().catch(() => '');
if (!toast.includes('Opened Hub and spoke')) fail(`no plain "Opened" message: ${toast}`);
if (await page.locator('.toast button', { hasText: 'Undo' }).count()) fail('opening a card offered an undo');
await page.screenshot({ path: `${out}/2-opened.png` });
// A shape clicked in the panel lands in the YAML.
const before = await page.locator('.drawing [data-node]').count();
await page.locator('.shapes .add-item', { hasText: /^App Service$/ }).click();
await wait(600);
if ((await page.locator('.drawing [data-node]').count()) !== before + 1) fail('click in shapes panel did not add a shape');
// ⌘\ shows the YAML again.
await page.locator('.preview').focus();
await page.keyboard.press('Meta+Backslash');
await wait(400);
if (!(await page.locator('.editor-pane').isVisible())) fail('⌘\\ did not show the YAML');

// 3. A related drawing under a card opens the same way; over the edit, the app asks first.
await page.getByRole('button', { name: 'New' }).click();
await page.locator('.scenario-also button', { hasText: 'Private endpoints' }).click();
await wait(1000);
if (!(await yaml()).includes('title: Private endpoints')) fail('the Private endpoints link did not open it');
if (!asked.some((m) => m.includes('hub-spoke.yaml has changes'))) fail('opening over the edited hub-spoke.yaml should ask first, in the app: ' + JSON.stringify(asked));
if (native.length) fail(`the browser's own dialog came up: ${JSON.stringify(native)}`);

// 4. The search finds the type; its template opens straight away.
await page.getByRole('button', { name: 'New' }).click();
await page.locator('.home .search-field input').fill('vnet subnet');
await wait();
if (!(await page.locator('.home .type-hint button.best').innerText()).includes('Azure infrastructure')) fail('"vnet subnet" does not find Azure infrastructure first');
await page.keyboard.press('Enter');
await page.waitForSelector('.template-card');
await page.locator('.template-card', { hasText: 'Template' }).first().click();
await wait(800);
if (!/^type: azure/m.test(await yaml())) fail('the Azure template did not open');

// 5. Blank sheet: an empty diagram in the builder, with a start on the canvas.
await page.getByRole('button', { name: 'New' }).click();
await page.locator('.home-foot .blank-sheet').click();
await wait(800);
if (!(await yaml()).trim().startsWith('type: systems')) fail('blank start did not open an empty systems diagram');
if (await page.locator('.toast', { hasText: 'Opened' }).count()) fail('a blank start said it opened something');
if (!(await page.locator('.canvas-empty').isVisible())) fail('no empty state on a blank canvas');
await page.screenshot({ path: `${out}/3-blank.png` });
await page.locator('.canvas-empty .chip').first().click();
await wait(700);
if ((await page.locator('.drawing [data-node]').count()) !== 1) fail('quick-add chip did not add a shape');
if (await page.locator('.canvas-empty').count()) fail('empty state still shown after adding a shape');
// The title is renamed in place.
await page.locator('.preview').focus();
await page.keyboard.press('Escape');
const title = await page.locator('.drawing svg > text').first().boundingBox();
await page.mouse.dblclick(title.x + 10, title.y + title.height / 2);
await wait(300);
await page.keyboard.type('Payments');
await page.keyboard.press('Enter');
await wait(500);
if (!(await yaml()).includes('title: Payments')) fail('title not renamed in place');

// At 1440×900: every card, the blank sheet and the search in view; every template one step further, in
// plain names; a type's starts show no drawing twice; and once the dialog is left it does not come
// back at the next launch.
{
  const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p2.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
  await p2.evaluate(() => localStorage.clear());
  await p2.reload();
  await p2.waitForSelector('.scenario');
  await p2.waitForTimeout(500);
  const bottom = await p2.locator('.home').evaluate((e) => e.getBoundingClientRect().bottom);
  const cut = await p2.locator('.scenario, .home-foot .blank-sheet, .home-foot .search-field').evaluateAll((els, b) => els.filter((e) => e.getBoundingClientRect().bottom > b + 1).length, bottom);
  if (cut) fail(`${cut} of the cards, the blank sheet and the search are out of view at 1440×900`);
  await p2.locator('.home-foot .import-chip').click();
  await p2.waitForSelector('.type-card');
  const browse = await p2.locator('.start').innerText();
  if (/PL\. \d|type: systems|\bXI\b/.test(browse)) fail('All templates still shows plate numbers, YAML names or numerals');
  await p2.getByPlaceholder('Describe what you want to show').fill('azure');
  await p2.keyboard.press('Enter');
  await p2.waitForSelector('.template-card');
  const cards = await p2.locator('.template-card .template-meta').allInnerTexts();
  // web-shop.yaml was the Azure template's drawing; since it got layers: (tags and a security, data
  // and ops layer) it shows something the template does not, so both are offered. No card twice, though.
  if (new Set(cards).size !== cards.length) fail('a start is offered twice: ' + cards.join(' | '));
  const names = await p2.locator('.template-card .template-title').allInnerTexts();
  if (new Set(names).size !== names.length) fail('two starts with the same name: ' + names.join(' | '));
  await p2.screenshot({ path: `${out}/start-azure.png` });
  await p2.click('button[aria-label="Close"]').catch(() => p2.keyboard.press('Escape'));
  await p2.waitForTimeout(300);
  if (await p2.locator('.start').count()) await p2.keyboard.press('Escape');
  await p2.waitForTimeout(300);
  await p2.reload();
  await p2.waitForSelector('.drawing svg');
  await p2.waitForTimeout(600);
  if (await p2.locator('.start').count()) fail('the start dialog came back at launch after it was left');
  await p2.close();
}

console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'start flow OK');
await browser.close();
