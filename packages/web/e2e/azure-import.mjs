// Azure exports in the browser: Resource Graph JSON dropped on the page becomes one azure diagram (focus
// on the application gateway works on it), a Bicep build and a Terraform plan dropped each draw the same
// app, and a folder of exports opened as a folder offers "Azure resources in …" in the command palette,
// which writes azure.yaml there and keeps a hand edit the next time: node e2e/azure-import.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const out = process.argv[2];
if (!out) throw new Error('Name the output folder: node e2e/azure-import.mjs <outDir>');
fs.mkdirSync(out, { recursive: true });
const examples = path.resolve(import.meta.dirname, '../../../examples/azure/import');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('cartography:doc') ?? '{}'));
const toast = () => page.locator('.toast').innerText().catch(() => '');
const chip = async () => ((await page.locator('.focus-chip').count()) ? (await page.locator('.focus-chip').innerText()).replace(/\s+/g, ' ').trim() : '');
const read = (dir) => fs.readdirSync(path.join(examples, dir)).map((f) => ({ name: f, text: fs.readFileSync(path.join(examples, dir, f), 'utf8') }));
const drop = (files) =>
  page.evaluate((files) => {
    const data = new DataTransfer();
    for (const f of files) data.items.add(new File([f.text], f.name, { type: 'application/json' }));
    const at = document.querySelector('.app');
    at.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }));
    at.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
  }, files);

await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.evaluate(async () => {
  localStorage.clear();
  localStorage.setItem('cartography:started', 'true');
  const opfs = await navigator.storage.getDirectory();
  for await (const [name] of opfs.entries()) await opfs.removeEntry(name, { recursive: true });
});
await page.reload();
await page.waitForSelector('.drawing svg');

// 1. The landing zone as az graph query output, dropped: one azure diagram, and the drop says what it holds.
{
  await drop(read('landing-zone'));
  await page.waitForSelector('.drawing [data-node="agw-shop-prod"]', { timeout: 20000 }).catch(() => fail('the dropped Resource Graph export was not drawn'));
  const said = await toast();
  if (!/3 subscriptions, 8 resource groups, 3 networks/.test(said)) fail('the drop should say what it made: ' + said);
  await wait(600);
  if (!/^type: azure/m.test((await stored()).text ?? '')) fail('the drop should open an azure diagram');
  await page.screenshot({ path: `${out}/azure-1-landing-zone.png` });

  // 2. What is around the application gateway: focus on it.
  // Zoomed out this far the card is small and its connect dot covers the middle: click its left edge.
  const card = page.locator('.drawing [data-node="agw-shop-prod"]');
  const box = await card.boundingBox();
  await page.mouse.click(box.x + 2, box.y + box.height / 2);
  await page.locator('.preview').focus();
  await page.keyboard.press('f');
  await wait(900);
  if (!(await chip()).includes('agw-shop-prod')) fail('focus on the gateway: ' + (await chip()));
  const kept = await page.evaluate(() => [...document.querySelectorAll('.drawing [data-node]')].map((n) => n.getAttribute('data-node')));
  if (!kept.includes('aks-shop-prod') || !kept.includes('afd-kestrel-shop') || kept.includes('cosmos-kestrel-data')) fail('the focus should keep what the gateway reaches and nothing else: ' + kept.join(' '));
  await page.screenshot({ path: `${out}/azure-2-focus.png` });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

// 3. The same web app from az bicep build and from a Terraform plan.
for (const [file, expect, shot] of [['webapp/bicep/main.json', 'From an ARM template', 'azure-3-bicep'], ['webapp/terraform/plan.json', 'From a Terraform plan', 'azure-4-plan']]) {
  await drop([{ name: path.basename(file), text: fs.readFileSync(path.join(examples, file), 'utf8') }]);
  await page.waitForFunction((e) => (JSON.parse(localStorage.getItem('cartography:doc') ?? '{}').text ?? '').includes(e), expect, { timeout: 15000 }).catch(() => fail(`${file} was not drawn`));
  await page.waitForSelector('.drawing [data-node="app-kestrel-bookings"]', { timeout: 15000 }).catch(() => fail(`${file}: no app on the drawing`));
  await wait(600);
  await page.screenshot({ path: `${out}/${shot}.png` });
}
if (!((await stored()).text ?? '').includes('+ create')) fail('the plan should mark what it creates');

// 5. A folder of exports: the command palette makes azure.yaml in it, and keeps a hand edit the next time.
{
  const files = Object.fromEntries(read('webapp/graph').map((f) => [f.name, f.text]));
  await page.evaluate(async (files) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('bookings', { create: true });
    for (const [p, text] of Object.entries(files)) {
      const w = await (await root.getFileHandle(p, { create: true })).createWritable();
      await w.write(text);
      await w.close();
    }
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('bookings');
    window.confirm = () => true;
  }, files);
  await page.click('button:has-text("Open folder")');
  await page.waitForSelector('.drawing [data-node="app-kestrel-bookings"]', { timeout: 15000 }).catch(() => fail('the folder of Azure exports was not drawn'));
  await page.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('→ azure.yaml'), null, { timeout: 5000 }).catch(() => {});
  if (!(await toast()).includes('→ azure.yaml')) fail('opening the folder should say where the diagram goes: ' + (await toast()));
  await page.keyboard.press('Meta+k');
  await page.keyboard.type('save azure.yaml');
  await page.click('.palette [role="option"]:has-text("Save azure.yaml")');
  await wait(800);
  await page.evaluate(async () => {
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('bookings');
    const f = await d.getFileHandle('azure.yaml');
    const text = (await (await f.getFile()).text()).replace('label: app-kestrel-bookings,', 'label: Bookings web,');
    const w = await f.createWritable();
    await w.write(text);
    await w.close();
  });
  await page.keyboard.press('Meta+k');
  await page.keyboard.type('open folder');
  await page.click('.palette [role="option"]:has-text("Open folder")');
  await wait(1000);
  await page.keyboard.press('Meta+k');
  await page.keyboard.type('Azure resources in');
  const offer = page.locator('.palette [role="option"]:has-text("Azure resources in bookings")');
  if (!(await offer.count())) fail('the palette should offer the Azure resources of the folder');
  else await offer.click();
  await wait(900);
  if (!((await stored()).text ?? '').includes('label: Bookings web')) fail('importing again should keep the label written by hand');
  if (!(await toast()).includes('what you added by hand is kept')) fail('importing again should say the hand edits are kept: ' + (await toast()));
  await page.screenshot({ path: `${out}/azure-5-folder.png` });
}

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all azure import steps ok');
await browser.close();
process.exitCode = problems.length ? 1 : 0;
