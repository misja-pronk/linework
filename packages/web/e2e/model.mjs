// Model layer in the editor: includes from a folder, the view picker, pins per view, drill-down links.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const out = process.argv[2];
const root = path.resolve(import.meta.dirname, '../../../examples/model');
const files = Object.fromEntries(fs.readdirSync(root).filter((f) => f.endsWith('.yaml')).map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8')]));
// A sequence whose ref box links to a view of another diagram, and a model with a warning that two files include.
files['checkout.yaml'] = 'type: sequence\nparticipants: { shopper: person, shop: service }\nmessages:\n  - shopper -> shop: Order\n  - ref: Placing an order\n    link: containers.yaml#ordering\n  - shop --> shopper: Done\n';
files['warned.yaml'] = 'type: model\nelements:\n  a: { kind: api, label: A }\nrelations:\n  - a -> nothere\n';
files['uses-warned.yaml'] = 'type: systems\ninclude: [warned.yaml]\nnodes:\n  a:\n';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
const fail = (m) => problems.push(m);
await page.goto(process.env.LINEWORK_URL ?? 'http://localhost:5178/');
await page.evaluate(async (files) => {
  localStorage.clear();
  localStorage.setItem('linework:started', 'true');
  const opfs = await navigator.storage.getDirectory();
  for await (const [name] of opfs.entries()) await opfs.removeEntry(name, { recursive: true });
  const dir = await opfs.getDirectoryHandle('shop-model', { create: true });
  for (const [p, text] of Object.entries(files)) {
    const w = await (await dir.getFileHandle(p, { create: true })).createWritable();
    await w.write(text);
    await w.close();
  }
}, files);
await page.reload();
await page.evaluate(() => {
  window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('shop-model');
});
await page.click('button[aria-label="More actions"]');
await page.click('.menu button:has-text("Open folder")');
await page.waitForSelector('.files .file');
const sidecarText = (name) =>
  page.evaluate(async (name) => {
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('shop-model');
    try {
      return await (await (await d.getFileHandle(name)).getFile()).text();
    } catch {
      return '';
    }
  }, name);

// Containers: only views, so the first one is drawn and the picker has no "as written".
await page.click('.files .file:has-text("containers.yaml")');
await page.waitForTimeout(700);
if ((await page.locator('.status-problems').innerText()) !== 'No problems') fail('problems: ' + (await page.locator('.status-problems').innerText()));
const options = await page.locator('.view-picker option').allInnerTexts();
if (options.join('|') !== 'Web shop — containers|Placing an order') fail(`view options: ${options}`);
if (!(await page.locator('.drawing').innerText()).includes('Mailer')) fail('containers view misses the mailer');
await page.screenshot({ path: `${out}/model-1.png` });

await page.selectOption('.view-picker select', 'ordering');
await page.waitForTimeout(600);
const ordering = await page.locator('.drawing').innerText();
if (ordering.includes('Mailer') || !ordering.includes('Placing an order')) fail('ordering view not drawn');

// A move in this view is pinned under views.ordering, and saved so.
const box = await page.locator('.drawing [data-node="stripe"]').boundingBox();
await page.mouse.move(box.x + 30, box.y + 20);
await page.mouse.down();
for (let i = 1; i <= 5; i++) await page.mouse.move(box.x + 30, box.y + 20 + i * 12);
await page.mouse.up();
await page.waitForTimeout(300);
await page.keyboard.press('Meta+s');
await page.waitForTimeout(500);
const side = JSON.parse((await sidecarText('containers.layout.json')) || '{}');
if (!side.views?.ordering?.nodes?.stripe || side.nodes) fail('pin not stored per view: ' + JSON.stringify(side));
await page.screenshot({ path: `${out}/model-2.png` });

// Drill-down: ⌘-click the shop in the context diagram opens its containers view.
await page.click('.files .file:has-text("context.yaml")');
await page.waitForTimeout(700);
if (await page.locator('.view-picker').count()) fail('context has no views, yet a picker shows');
const shop = await page.locator('.drawing [data-node="shop"]').boundingBox();
// Playwright's click modifiers do not reach pointer events: hold the key instead.
await page.keyboard.down('Meta');
await page.mouse.click(shop.x + shop.width / 2, shop.y + shop.height / 2);
await page.keyboard.up('Meta');
await page.waitForTimeout(800);
const name = await page.locator('.doc-name').innerText();
if (!name.includes('containers.yaml')) fail('link did not open containers.yaml: ' + name);
await page.screenshot({ path: `${out}/model-drill.png` });
if (!(await page.locator('.view-picker select').count()) || (await page.locator('.view-picker select').inputValue()) !== 'containers') fail('link did not pick the containers view');

// Back: a chip over the drawing names where the link came from; a walk of two links comes back
// one at a time, each in the view it showed (⌘[ and the chip alike).
const chip = page.locator('.back-chip');
if (!(await chip.count())) fail('no way back after following a link');
else if (!(await chip.innerText()).includes('context.yaml')) fail('the way back does not name context.yaml: ' + (await chip.innerText()));
await page.locator('.view-picker select').selectOption('ordering');
await page.waitForTimeout(800);
const apiBox = await page.locator('.drawing [data-node="shop.api"], .drawing [data-node="api"]').first().boundingBox();
await page.keyboard.down('Meta');
await page.mouse.click(apiBox.x + apiBox.width / 2, apiBox.y + apiBox.height / 2);
await page.keyboard.up('Meta');
await page.waitForTimeout(800);
if (!(await page.locator('.doc-name').innerText()).includes('deployment.yaml')) fail('the API link did not open deployment.yaml');
if (!(await chip.innerText()).includes('Placing an order')) fail('the way back does not name the view it came from: ' + (await chip.innerText()));
await page.screenshot({ path: `${out}/model-back-chip.png` });
await page.locator('.preview').focus();
await page.keyboard.press('Meta+BracketLeft');
await page.waitForTimeout(800);
if (!(await page.locator('.doc-name').innerText()).includes('containers.yaml')) fail('⌘[ did not go back to containers.yaml');
if ((await page.locator('.view-picker select').inputValue()) !== 'ordering') fail('back in containers.yaml, the view is not the one it showed (ordering)');
await chip.click();
await page.waitForTimeout(800);
if (!(await page.locator('.doc-name').innerText()).includes('context.yaml')) fail('the chip did not go back to context.yaml');
if (await chip.count()) fail('a way back shows with nowhere left to go back to');
await page.screenshot({ path: `${out}/model-back.png` });

// A sequence's ref box links to a view: ⌘-click opens containers.yaml at "Placing an order"; Back returns.
await page.click('.files .file:has-text("checkout.yaml")');
await page.waitForTimeout(800);
const ref = await page.locator('.drawing [data-link="containers.yaml#ordering"]').boundingBox();
if (!ref) fail('the ref box does not say its link');
else {
  await page.keyboard.down('Meta');
  await page.mouse.click(ref.x + ref.width / 2, ref.y + ref.height / 2);
  await page.keyboard.up('Meta');
  await page.waitForTimeout(900);
  if (!(await page.locator('.doc-name').innerText()).includes('containers.yaml')) fail('the ref box did not open containers.yaml');
  if ((await page.locator('.view-picker select').inputValue()) !== 'ordering') fail('the ref box did not land on the view it names (ordering)');
  await page.screenshot({ path: `${out}/model-ref-link.png` });
  if (!(await chip.count()) || !(await chip.innerText()).includes('checkout.yaml')) fail('no way back to checkout.yaml after the ref box');
  else {
    await chip.click();
    await page.waitForTimeout(800);
    if (!(await page.locator('.doc-name').innerText()).includes('checkout.yaml')) fail('Back did not return to checkout.yaml');
  }
}

// A warning in an included model is said in the model, not again in the file that includes it.
await page.click('.files .file:has-text("uses-warned.yaml")');
await page.waitForTimeout(800);
if ((await page.locator('.status-problems').innerText()) !== 'No problems') fail('the warning of the included model is said again: ' + (await page.locator('.status-problems').innerText()));
await page.click('.files .file:has-text("warned.yaml"):not(:has-text("uses-"))');
await page.waitForTimeout(800);
if (!/1 warning/i.test(await page.locator('.status-problems').innerText())) fail('the model itself does not say its warning: ' + (await page.locator('.status-problems').innerText()));

// The inspector lists links; the deployment diagram (Azure) reads the same elements.
await page.click('.files .file:has-text("deployment.yaml")');
await page.waitForTimeout(800);
if ((await page.locator('.status-problems').innerText()) !== 'No problems') fail('deployment problems: ' + (await page.locator('.status-problems').innerText()));
const api = await page.locator('.drawing [data-node="api"]').boundingBox();
await page.mouse.click(api.x + 40, api.y + 20);
await page.waitForTimeout(300);
const links = await page.locator('.inspector .links').innerText();
if (!links.includes('containers.yaml#containers')) fail('inspector links: ' + links);
await page.screenshot({ path: `${out}/model-3.png` });

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all model steps ok');
await browser.close();
