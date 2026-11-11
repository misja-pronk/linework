// Theme picker and official icons: built-in theme, a theme file from the open folder (font + logo),
// an official icon download imported as a zip, checked and mapped by hand, and the icon toggle.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { chromium } from '@playwright/test';
const out = process.argv[2];
const acme = path.resolve(import.meta.dirname, '../../../docs/themes/acme');
const b64 = (f) => fs.readFileSync(path.join(acme, f)).toString('base64');
const files = {
  'acme.theme.yaml': fs.readFileSync(path.join(acme, 'acme.theme.yaml')).toString('base64'),
  'acme-logo.svg': b64('acme-logo.svg'),
  'fonts/SpaceGrotesk-400.woff2': b64('fonts/SpaceGrotesk-400.woff2'),
  'fonts/SpaceGrotesk-500.woff2': b64('fonts/SpaceGrotesk-500.woff2'),
  'fonts/SpaceGrotesk-600.woff2': b64('fonts/SpaceGrotesk-600.woff2'),
  'shop.yaml': Buffer.from('type: azure\ntitle: Shop\nnodes:\n  kv: { kind: key-vault, label: Secrets }\n  web: { kind: app-service, label: Web }\nedges:\n  - web -> kv\n').toString('base64'),
};
// A stand-in for an official icon download (never the real files in this repo), zipped the way the
// vendors do (deflated entries), so the browser's own inflate reads it.
const standIn = (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><rect width="18" height="18" rx="3" fill="${c}"/></svg>`;
function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text);
    const data = zlib.deflateRawSync(raw);
    const n = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(n.length, 26);
    local.push(head, n, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += head.length + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
const download = zip({
  'Azure_Public_Service_Icons/Icons/security/10245-icon-service-Key-Vaults.svg': standIn('#0A7'),
  'Azure_Public_Service_Icons/Icons/web/10035-icon-service-App-Services.svg': standIn('#07A'),
  'Azure_Public_Service_Icons/Icons/ai/10813-icon-service-Search.svg': standIn('#A07'),
  '__MACOSX/Azure_Public_Service_Icons/._junk.svg': 'junk',
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
const fail = (m) => problems.push(m);
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.evaluate(async ({ files }) => {
  localStorage.clear();
  localStorage.setItem('cartography:started', 'true');
  const opfs = await navigator.storage.getDirectory();
  for await (const [name] of opfs.entries()) await opfs.removeEntry(name, { recursive: true });
  const put = async (root, p, data) => {
    const parts = p.split('/');
    let d = root;
    for (const seg of parts.slice(0, -1)) d = await d.getDirectoryHandle(seg, { create: true });
    const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
    await w.write(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
    await w.close();
  };
  const ws = await opfs.getDirectoryHandle('client', { create: true });
  for (const [p, data] of Object.entries(files)) await put(ws, p, data);
}, { files });
await page.reload();
await page.evaluate(() => {
  window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('client');
});
await page.click('button[aria-label="More actions"]');
await page.click('.menu button:has-text("Open folder")');
await page.waitForSelector('.files .file');
await page.click('.files .file:has-text("shop.yaml")');
await page.waitForTimeout(600);
const canvas = () => page.locator('.drawing svg > rect').first().getAttribute('fill');
const before = await canvas();

const pick = async (label) => {
  await page.click('button[aria-label="More actions"]');
  await page.click('button[data-brand]');
  await page.click(`.menu [role="menuitem"]:has-text("${label}")`);
  await page.waitForTimeout(700);
};
await pick('Ocean');
if ((await canvas()) !== '#F2F8FB') fail(`ocean canvas: ${await canvas()} (was ${before})`);
await page.click('button[aria-label="More actions"]');
if ((await page.locator('button[data-brand] .brand-now').innerText()).trim() !== 'Ocean') fail('picker label');
await page.keyboard.press('Escape');

await pick('acme.theme.yaml');
if ((await canvas()) !== '#FBF8F4') fail(`acme canvas: ${await canvas()}`);
const svg = await page.locator('.drawing svg').first().innerHTML();
if (!svg.includes('Acme Corporation')) fail('no title block');
if (!/<image[^>]+href="data:image\/svg\+xml/.test(svg)) fail('no logo');
if (!(await page.evaluate(() => document.fonts.check("600 14px 'Space Grotesk'")))) fail('brand font not registered');
await page.screenshot({ path: path.join(out, 'brand-acme.png') });

// Official icons: the guide, a zip, the sheet of shapes, a kind mapped by hand, the toggle.
await page.click('button[aria-label="More actions"]');
await page.click('button[data-brand]');
await page.click('.menu [data-icon-packs]');
const dialog = page.locator('[role="dialog"][aria-label="Official icons"]');
await dialog.waitFor();
if ((await dialog.locator('.icon-vendor').count()) !== 4) fail('four vendors in the guide');
if (!(await dialog.locator('[data-vendor="azure"] a[href*="learn.microsoft.com"]').count())) fail('Azure download link');
await dialog.locator('input[type="file"][accept*="zip"]').setInputFiles({ name: 'Azure_Public_Service_Icons_V23.zip', mimeType: 'application/zip', buffer: download });
await dialog.locator('[data-vendor="azure"] .icon-status', { hasText: ' of ' }).waitFor({ timeout: 8000 });
const status = await dialog.locator('[data-vendor="azure"] h3').innerText();
if (!/2 of \d+ shapes/.test(status)) fail(`azure status: ${status}`);
await dialog.locator('.icon-sheet').waitFor();
if (!(await dialog.locator('.icon-tile[data-kind="key-vault"] img').count())) fail('key vault in the sheet');
if (!(await dialog.locator('.icon-tile[data-kind="ai-search"].missing').count())) fail('AI Search listed without an icon');
await page.screenshot({ path: path.join(out, 'icons-sheet.png') });
await dialog.locator('.icon-tile[data-kind="ai-search"]').click();
await dialog.locator('.icon-pick input').fill('search');
await dialog.locator('.icon-pick .icon-tile').first().click();
await dialog.locator('.icon-tile[data-kind="ai-search"] .icon-hand').waitFor({ timeout: 4000 });
await page.keyboard.press('Escape');
await dialog.waitFor({ state: 'detached' });

const images = () => page.locator('.drawing [data-node] image').count();
if (await images()) fail('official icons before they are turned on');
await pick('Official icons');
if ((await images()) !== 2) fail(`official icons drawn: ${await images()}`);
await page.screenshot({ path: path.join(out, 'brand-icons.png') });
await pick('Line icons');
if (await images()) fail('line icons wins');
await pick('Icons as the diagram says');

// Kept in the browser: after a reload the set and the hand mapping are still there.
await page.reload();
await page.click('.files .file:has-text("shop.yaml")').catch(() => {});
await page.waitForTimeout(800);
await pick('Official icons');
if ((await images()) !== 2) fail(`after a reload: ${await images()}`);
await pick('Icons as the diagram says');

await pick("The diagram's own");
if ((await canvas()) !== before) fail('back to the diagram theme');
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all brand steps ok');
await browser.close();
process.exitCode = problems.length ? 1 : 0;
