// Folder workflow, with the browser's private file system standing in for a picked folder.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const out = process.argv[2];
const root = path.resolve(import.meta.dirname, '../../../examples/data-products');
const files = {
  'finance.yaml': fs.readFileSync(path.join(root, 'finance.yaml'), 'utf8'),
  'customer.yaml': fs.readFileSync(path.join(root, 'customer.yaml'), 'utf8'),
  'contracts/payments.odcs.yaml': fs.readFileSync(path.join(root, 'contracts/payments.odcs.yaml'), 'utf8'),
};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
const fail = (m) => problems.push(m);
await page.goto('http://localhost:5178/');
await page.evaluate(async (files) => {
  localStorage.clear();
  const opfs = await navigator.storage.getDirectory();
  for await (const [name] of opfs.entries()) await opfs.removeEntry(name, { recursive: true });
  const dir = await opfs.getDirectoryHandle('shop-data', { create: true });
  for (const [p, text] of Object.entries(files)) {
    const parts = p.split('/');
    let d = dir;
    for (const seg of parts.slice(0, -1)) d = await d.getDirectoryHandle(seg, { create: true });
    const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
    await w.write(text);
    await w.close();
  }
}, files);
await page.reload();
await page.evaluate(() => {
  window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('shop-data');
});
await page.click('button:has-text("Open folder")');
await page.waitForSelector('.files .file');
const listed = await page.locator('.files .file').allInnerTexts();
if (listed.join() !== 'customer.yaml,finance.yaml') fail(`file list: ${listed}`);

await page.click('.files .file:has-text("finance.yaml")');
await page.waitForTimeout(600);
if (!(await page.locator('.drawing').innerText()).includes('settled payments')) fail('contract from the folder not drawn');
if ((await page.locator('.status-problems').innerText()) !== 'No problems') fail('problems: ' + (await page.locator('.status-problems').innerText()));
await page.screenshot({ path: `${out}/files-1.png` });

// Drag a node, then save: YAML and sidecar land in the folder.
const box = await page.locator('.drawing [data-node="cfo"]').boundingBox();
await page.mouse.move(box.x + 30, box.y + 20);
await page.mouse.down();
for (let i = 1; i <= 5; i++) await page.mouse.move(box.x + 30, box.y + 20 + i * 10);
await page.mouse.up();
await page.waitForTimeout(300);
if (!(await page.locator('.doc-name .dirty').count())) fail('no unsaved dot after a move');
await page.keyboard.press('Meta+s');
await page.waitForTimeout(500);
if (await page.locator('.doc-name .dirty').count()) fail('still dirty after save');
const sidecar = await page.evaluate(async () => {
  const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('shop-data');
  return (await (await d.getFileHandle('finance.layout.json')).getFile()).text();
});
if (!sidecar.includes('"cfo"')) fail('sidecar not written: ' + sidecar);

// Switching files saves edits first.
await page.click('.cm-content');
await page.keyboard.press('Meta+End');
await page.keyboard.type('\n# edited');
await page.click('.files .file:has-text("customer.yaml")');
await page.waitForTimeout(500);
const saved = await page.evaluate(async () => {
  const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('shop-data');
  return (await (await d.getFileHandle('finance.yaml')).getFile()).text();
});
if (!saved.includes('# edited')) fail('switching did not save the edit');
await page.screenshot({ path: `${out}/files-2.png` });
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all file steps ok');
await browser.close();
