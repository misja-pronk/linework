// PowerPoint in a template from the Export menu: a template in the open folder is offered by
// itself, the choice is remembered for the folder across a reload, another one is picked from
// disk, the diagram's own look can be kept, and the template can be let go again. Every deck is
// checked as a package and drawn to PNG (render-deck.ts) to look at.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';

const out = process.argv[2];
if (!out) throw new Error('pptx-template.mjs <out-folder>');
fs.mkdirSync(out, { recursive: true });
const root = path.resolve(import.meta.dirname, '../../..');
const tsx = path.join(root, 'node_modules/.bin/tsx');
// The two made-up templates of the export tests: a 16:9 corporate .potx and a 4:3 Dutch .pptx.
const made = spawnSync(tsx, [path.join(root, 'packages/export/test/support/write-templates.ts'), out], { encoding: 'utf8' });
if (made.status) throw new Error(made.stderr);
const shop = fs.readFileSync(path.join(root, 'examples/systems/web-shop.yaml'), 'utf8');
const files = {
  'shop.yaml': Buffer.from(shop).toString('base64'),
  'brand/template.potx': fs.readFileSync(path.join(out, 'exemplar.potx')).toString('base64'),
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, acceptDownloads: true });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
const fail = (m) => problems.push(m);
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.evaluate(async ({ files }) => {
  localStorage.clear();
  localStorage.setItem('cartography:started', 'true');
  await new Promise((ok) => {
    const r = indexedDB.deleteDatabase('cartography-pptx');
    r.onsuccess = r.onerror = r.onblocked = () => ok();
  });
  const opfs = await navigator.storage.getDirectory();
  for await (const [name] of opfs.entries()) await opfs.removeEntry(name, { recursive: true });
  const ws = await opfs.getDirectoryHandle('client', { create: true });
  for (const [p, data] of Object.entries(files)) {
    const parts = p.split('/');
    let d = ws;
    for (const seg of parts.slice(0, -1)) d = await d.getDirectoryHandle(seg, { create: true });
    const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
    await w.write(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
    await w.close();
  }
}, { files });
await page.reload();
await page.evaluate(() => {
  window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('client');
});
await page.click('button[aria-label="More actions"]');
await page.click('.menu button:has-text("Open folder")');
await page.waitForSelector('.files .file');
await page.click('.files .file:has-text("shop.yaml")');
await page.waitForSelector('.preview svg');
// Nothing leaves the app: the template is read and written in the browser.
const origin = new URL(page.url()).origin;
page.on('request', (r) => !r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:') && fail(`left the app: ${r.url()}`));

const menu = async () => {
  await page.click('button:has-text("Export")');
  await page.waitForSelector('.menu [role="menuitem"]');
};
async function savePptx(name) {
  await menu();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('[role=menuitem]:has-text("PowerPoint")')]);
  const file = path.join(out, `${name}.pptx`);
  await download.saveAs(file);
  const parts = unzipSync(new Uint8Array(fs.readFileSync(file)));
  const r = spawnSync(tsx, [path.join(root, 'packages/export/test/support/render-deck.ts'), file, out], { encoding: 'utf8' });
  if (r.status) fail(`${name}: could not be drawn: ${r.stderr.slice(0, 300)}`);
  return { file, text: (p) => (parts[p] ? strFromU8(parts[p]) : ''), parts };
}

// 1. The folder's template is offered without asking.
await menu();
const offered = page.locator('[data-template-found="brand/template.potx"]');
if (!(await offered.count())) fail('the template in brand/ is not offered');
await page.screenshot({ path: path.join(out, 'menu-offered.png') });
await offered.click();
await page.waitForTimeout(300);
await menu();
const label = await page.locator('[role=menuitem]:has-text("PowerPoint")').first().innerText();
if (!label.includes('in template.potx')) fail(`PowerPoint row does not say the template: ${label}`);
await page.screenshot({ path: path.join(out, 'menu-chosen.png') });
await page.keyboard.press('Escape');

let d = await savePptx('in-template');
if (!d.text('ppt/presentation.xml').includes('<p:sldSz cx="12192000" cy="6858000"')) fail('in-template: not the template size');
if (!d.text('ppt/slides/_rels/slide1.xml.rels').includes('slideLayout5.xml')) fail('in-template: not on Title Only');
if (!d.text('ppt/slides/slide1.xml').includes('<p:ph type="title"/>')) fail('in-template: title not in the placeholder');
if (!d.text('ppt/slides/slide1.xml').includes('typeface="Arial"')) fail('in-template: not in the template body face');
if (d.text('ppt/presentation.xml').includes('sectionLst')) fail('in-template: sample sections left behind');
if (!d.text('[Content_Types].xml').includes('presentation.main+xml')) fail('in-template: still a template content type');
if (!Object.keys(d.parts).some((p) => p.startsWith('ppt/media/cartography-icon') && p.endsWith('.png'))) fail('in-template: icons have no PNG fallback');

// 2. Remembered for this folder after a reload.
await page.reload();
// Reopening the remembered folder (in the top bar's ⋯) takes a click, as the browser asks for access again.
await page.click('button[aria-label="More actions"]');
await page.click('.menu button:has-text("client")');
await page.waitForSelector('.files .file');
await page.click('.files .file:has-text("shop.yaml")');
await page.waitForSelector('.preview svg');
await page.waitForTimeout(500);
await menu();
if (!(await page.locator('[role=menuitem]:has-text("PowerPoint")').first().innerText()).includes('in template.potx')) {
  fail('the template is forgotten after a reload');
  await page.screenshot({ path: path.join(out, 'after-reload.png') });
}
await page.keyboard.press('Escape');

// 3. Another template from disk: the Dutch 4:3 one.
await menu();
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-template-pick]')]);
await chooser.setFiles(path.join(out, 'polder.pptx'));
await page.waitForTimeout(300);
d = await savePptx('dutch');
if (!d.text('ppt/presentation.xml').includes('<p:sldSz cx="9144000" cy="6858000"')) fail('dutch: not 4:3');
if (!d.text('ppt/slides/slide1.xml').includes('typeface="Verdana"')) fail('dutch: not in Verdana');
if (!d.text('ppt/slides/slide1.xml').includes('Polder Advies')) fail('dutch: no footer from the layout');

// 4. The diagram's own look on the template's slides.
await menu();
await page.click('[role=menuitemcheckbox]:has-text("Keep the diagram")');
await page.keyboard.press('Escape');
d = await savePptx('dutch-keep-look');
if (!d.text('ppt/slides/slide1.xml').includes('typeface="Instrument Sans"')) fail('keep look: not in the diagram\'s own face');

// 5. Let go of it: our own deck again.
await menu();
await page.click('[data-template-clear]');
d = await savePptx('plain');
if (!d.text('ppt/presentation.xml').includes('<p:sldSz cx="12192000" cy="6858000"/>')) fail('plain: not our own 16:9');
if (Object.keys(d.parts).some((p) => p.includes('cartography-icon'))) fail('plain: still made in a template');

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all pptx template steps ok');
await browser.close();
process.exitCode = problems.length ? 1 : 0;
