// The builder's left panel is the drawing's outline: a tree of its groups and what is in them that
// selects what it names (and follows a selection made in the drawing), folds, and walks with the
// arrows; adding is the quick add (A, type, Enter); the shapes stay on a tab of their own to browse
// and drag. Opened the way people do, from the start screen's Azure network card, at 1440×900.
// node e2e/outline.mjs <outDir>
import fs from 'node:fs';
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? '.';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.setDefaultTimeout(8000);
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
const yaml = () => page.evaluate(() => document.querySelector('.cm-content').innerText);
const row = (key) => page.locator(`.outline [data-key="${key}"]`);
const selectedRows = () => page.locator('.outline [aria-selected="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-key')));

await page.goto(process.env.LINEWORK_URL ?? 'http://localhost:5178/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.locator('.scenario-main', { hasText: 'Azure network' }).click();
await page.waitForSelector('.drawing [data-node="vmss-erp-prod"]');
await wait(800);

// 1. The panel opens on the outline, nested as the drawing is: subscription › VNet › subnet › box.
if (!(await page.locator('.shapes .outline[role="tree"]').count())) fail('the left panel does not open on the outline');
if (await page.locator('.shapes .add-item').count()) fail('the shapes list shows with the outline');
const level = async (key) => Number(await row(key).getAttribute('aria-level'));
const levels = [await level('group:sub-erp-prod'), await level('group:vnet-erp-prod'), await level('group:snet-app'), await level('node:vmss-erp-prod')];
if (levels.join() !== '1,2,3,4') fail(`the outline is not nested as the drawing: ${levels}`);
if ((await row('lines').getAttribute('aria-expanded')) !== 'false') fail('the lines do not start folded');
if (await page.locator('.outline [data-key^="edge:"]').count()) fail('folded lines still show');
await page.screenshot({ path: `${out}/1-outline.png` });

// 2. A click on a row selects it in the drawing (and in the side panel).
await row('node:vmss-erp-prod').click();
await wait(400);
if (!(await selectedRows()).includes('node:vmss-erp-prod')) fail('the clicked row is not highlighted');
const sideSays = await page.locator('.side').innerText();
if (!sideSays.includes('vmss-erp')) fail(`clicking the outline did not select it: the side panel says ${sideSays.slice(0, 80)}`);
await page.screenshot({ path: `${out}/2-nested-selected.png` });

// 3. Selected in the drawing: highlighted in the outline, unfolded to when it was folded away.
await row('group:sub-connectivity').locator('.outline-fold').click();
await wait(200);
if (await row('node:afw-hub').count()) fail('folding the subscription left its contents showing');
await page.locator('.drawing [data-node="afw-hub"]').click();
await wait(400);
if (!(await row('node:afw-hub').count())) fail('selecting in the drawing did not unfold the outline to it');
if ((await selectedRows()).join() !== 'node:afw-hub') fail(`selecting in the drawing highlights ${await selectedRows()} in the outline`);

// 4. The arrows walk the tree and select as they go; Left goes to the parent; Enter goes back to the drawing.
await row('node:afw-hub').click();
await page.keyboard.press('ArrowLeft');
await wait(200);
if ((await selectedRows()).join() !== 'group:AzureFirewallSubnet') fail(`ArrowLeft selects ${await selectedRows()}, not the subnet`);
await page.keyboard.press('ArrowDown');
await wait(200);
if ((await selectedRows()).join() !== 'node:afw-hub') fail(`ArrowDown selects ${await selectedRows()}`);
await page.keyboard.press('Enter');
await wait(200);
if (!(await page.evaluate(() => !!document.activeElement?.closest('.preview')))) fail('Enter in the outline did not go back to the drawing');

// 5. The drawing's keys for the selection work from the outline: ⌘D, Delete, ⌘C ⌘V; the keyboard stays there.
const nodes = () => page.locator('.drawing [data-node]').count();
const n0 = await nodes();
await row('node:bas-hub').click();
await page.keyboard.press('Meta+d');
await wait(800);
if ((await nodes()) !== n0 + 1) fail('⌘D in the outline did not duplicate');
const copy = (await selectedRows())[0];
if (!copy || copy === 'node:bas-hub') fail(`the duplicate is not selected in the outline: ${copy}`);
if (!(await page.evaluate(() => !!document.activeElement?.closest('.outline')))) fail('the keyboard left the outline after ⌘D');
await page.keyboard.press('Delete');
await wait(800);
if ((await nodes()) !== n0) fail('Delete in the outline did not delete');
if (!(await page.evaluate(() => !!document.activeElement?.closest('.outline')))) fail('the keyboard left the outline after Delete');
await row('node:bas-hub').click();
await page.keyboard.press('Meta+c');
await page.keyboard.press('Meta+v');
await wait(800);
if ((await nodes()) !== n0 + 1) fail('⌘C ⌘V in the outline did not paste');
await page.keyboard.press('Delete');
await wait(800);

// 6. The quick add: A, "sql", Enter adds a SQL database (into the selected group, as it says).
await row('group:snet-app').click();
await page.locator('.preview').focus();
await page.keyboard.press('a');
await page.waitForSelector('.add-menu:not(.inline) input:focus');
await page.keyboard.type('sql');
await wait(200);
const first = await page.locator('.add-menu:not(.inline) .add-item[aria-selected="true"]').innerText();
if (!/sql/i.test(first)) fail(`"sql" puts ${first} first`);
if (!(await page.locator('.add-into').innerText()).includes('snet-app')) fail('the quick add does not say where the shape goes');
const box = await page.locator('.add-menu:not(.inline)').boundingBox();
const toast = await page.locator('.toast').boundingBox().catch(() => null);
if (toast && toast.y < box.y + box.height && toast.y + toast.height > box.y && toast.x < box.x + box.width) fail('a toast covers the quick add');
await page.screenshot({ path: `${out}/3-quick-add.png` });
await page.keyboard.press('Enter');
await wait(800);
const y = await yaml();
if (!/sql[\w-]*: \{ kind: sql[\w-]*,.*in: snet-app/.test(y)) fail(`Enter did not add a SQL shape in the subnet:\n${y.split('\n').filter((l) => /sql/.test(l)).join('\n')}`);
if (!(await page.locator('.outline [data-key^="node:sql"]').count())) fail('the added shape is not in the outline');

// 7. The shapes tab: the whole palette, to browse and drag.
await page.keyboard.press('Escape');
await page.locator('.left-tabs [role="tab"]', { hasText: 'Shapes' }).click();
await wait(300);
if ((await page.locator('.shapes .add-item').count()) < 10) fail('the shapes tab does not list the shapes');
await page.screenshot({ path: `${out}/4-shapes-tab.png` });
await page.locator('.left-tabs [role="tab"]', { hasText: 'Outline' }).click();

console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'outline OK');
await browser.close();
