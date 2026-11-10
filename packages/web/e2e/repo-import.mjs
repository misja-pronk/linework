// Diagrams from the code in the browser: a Compose file and API descriptions dropped on the page offer
// their diagrams and one opens; the sample repository (examples/repo/shop) opened as a folder offers
// "Diagrams from the code in shop" in the command palette, which writes them into diagrams/ with the
// keyboard, and keeps a hand edit the next time: node e2e/repo-import.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const out = process.argv[2];
if (!out) throw new Error('Name the output folder: node e2e/repo-import.mjs <outDir>');
fs.mkdirSync(out, { recursive: true });
const repo = path.resolve(import.meta.dirname, '../../../examples/repo/shop');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'diagrams' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('cartography:doc') ?? '{}'));
const toast = () => page.locator('.toast').innerText().catch(() => '');
const drop = (files) =>
  page.evaluate((files) => {
    const data = new DataTransfer();
    for (const f of files) data.items.add(new File([f.text], f.name, { type: 'text/yaml' }));
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

// 1. Dropped: a Compose file and the API descriptions. The dialog offers one diagram each; O opens the one at hand.
{
  await drop(['compose.yaml', 'api/openapi.yaml', 'api/asyncapi.yaml', 'api/payments-events.yaml'].map((f) => ({ name: path.basename(f), text: fs.readFileSync(path.join(repo, f), 'utf8') })));
  await page.waitForSelector('.repo-dialog', { timeout: 10000 }).catch(() => fail('a dropped Compose file and API descriptions should offer their diagrams'));
  await wait(400);
  const rows = await page.locator('.repo-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-file')));
  if (rows.join() !== 'diagrams/services.yaml,diagrams/shop-api.yaml,diagrams/shop-api-callbacks.yaml,diagrams/events.yaml') fail('the drop should offer services, the API, its callbacks and the events: ' + rows.join());
  await page.screenshot({ path: `${out}/repo-1-drop.png` });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('o');
  await page.waitForSelector('.drawing [data-node="server"]', { timeout: 10000 }).catch(() => fail('O should open the API diagram'));
  if (!/^type: systems/m.test((await stored()).text ?? '')) fail('the API diagram should be a systems diagram');
  await wait(600);
  await page.screenshot({ path: `${out}/repo-2-api.png` });
}

// 2. The repository opened as a folder: the palette offers its diagrams; Enter writes them into diagrams/.
{
  const files = Object.fromEntries(walk(repo).map((p) => [path.relative(repo, p).split(path.sep).join('/'), fs.readFileSync(p, 'utf8')]));
  await page.evaluate(async (files) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('shop', { create: true });
    for (const [p, text] of Object.entries(files)) {
      let d = root;
      const parts = p.split('/');
      for (const seg of parts.slice(0, -1)) d = await d.getDirectoryHandle(seg, { create: true });
      const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
      await w.write(text);
      await w.close();
    }
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('shop');
    window.confirm = () => true;
  }, files);
  await page.click('button:has-text("Open folder")');
  await wait(1000);
  await page.keyboard.press('Meta+k');
  await page.keyboard.type('diagrams from the code');
  const offer = page.locator('.palette [role="option"]:has-text("Diagrams from the code in shop")');
  if (!(await offer.count())) fail('the palette should offer the diagrams from the code');
  else await offer.click();
  await page.waitForSelector('.repo-dialog', { timeout: 10000 }).catch(() => fail('the palette entry should open the dialog'));
  const n = await page.locator('.repo-row').count();
  if (n !== 9) fail(`the repository should offer 9 diagrams, not ${n}`);
  if (!(await page.locator('.repo-hints summary').innerText().catch(() => '')).includes('not drawn (2)')) fail('the dialog should say what it found and does not draw');
  const listed = await page.locator('nav.files').first().innerText().catch(() => '');
  if (listed.includes('Chart.yaml')) fail('a Helm Chart.yaml (type: application) is not a diagram of the folder');
  await wait(400);
  await page.screenshot({ path: `${out}/repo-3-folder.png` });
  // Space leaves one out: the first, the Compose file's, is left as it is.
  await page.keyboard.press(' ');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('from the code in shop'), null, { timeout: 10000 }).catch(() => {});
  if (!(await toast()).includes('8 diagrams from the code in shop → diagrams/')) fail('writing should say how many and where: ' + (await toast()));
  const written = await page.evaluate(async () => {
    const d = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('shop')).getDirectoryHandle('diagrams');
    const out = [];
    for await (const [name] of d.entries()) out.push(name);
    return out.sort();
  });
  if (written.join() !== 'events.yaml,infra-azure.yaml,kubernetes.yaml,shop-api-callbacks.yaml,shop-api.yaml,shop-chart.yaml,workflow-ci.yaml,workflow-deploy.yaml') fail('diagrams/ should hold the eight picked: ' + written.join());
  await page.waitForSelector('.drawing [data-node="internet"]', { timeout: 10000 }).catch(() => fail('the first written diagram (the chart) should open'));
  await wait(600);
  await page.screenshot({ path: `${out}/repo-4-chart.png` });
}

// 3. A hand edit in a written diagram stays when the code is imported again.
{
  await page.evaluate(async () => {
    const d = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('shop')).getDirectoryHandle('diagrams');
    const f = await d.getFileHandle('events.yaml');
    const text = (await (await f.getFile()).text()).replace('label: Orders service,', 'label: Orders (Go),');
    const w = await f.createWritable();
    await w.write(text);
    await w.close();
  });
  await page.keyboard.press('Meta+k');
  await page.keyboard.type('open folder');
  await page.click('.palette [role="option"]:has-text("Open folder")');
  await wait(1000);
  await page.keyboard.press('Meta+k');
  await page.keyboard.type('diagrams from the code');
  await page.click('.palette [role="option"]:has-text("Diagrams from the code in shop")');
  await page.waitForSelector('.repo-dialog', { timeout: 10000 });
  const row = page.locator('.repo-row[data-file="diagrams/events.yaml"]');
  if (!(await row.innerText()).includes('your edits kept')) fail('the dialog should say the hand edits are kept: ' + (await row.innerText()));
  // With the trackpad: open just that one.
  await row.locator('.repo-open').click();
  await page.waitForSelector('.drawing [data-node="orders-service"]', { timeout: 10000 }).catch(() => fail('Open should open the events diagram'));
  if (!((await stored()).text ?? '').includes('label: Orders (Go)')) fail('importing again should keep the label written by hand');
  await wait(600);
  await page.screenshot({ path: `${out}/repo-5-kept.png` });
}

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all repo import steps ok');
await browser.close();
process.exitCode = problems.length ? 1 : 0;
