// Theme picker and icon folder: built-in theme, a theme file from the open folder (font + logo), BYO icons.
import fs from 'node:fs';
import path from 'node:path';
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
// A stand-in for an official icon download (never the real files in this repo).
const icons = { 'Icons/security/10245-icon-service-Key-Vaults.svg': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><rect width="18" height="18" rx="3" fill="#0A7"/></svg>').toString('base64') };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
const fail = (m) => problems.push(m);
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.evaluate(async ({ files, icons }) => {
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
  const ic = await opfs.getDirectoryHandle('azure-icons', { create: true });
  for (const [p, data] of Object.entries(icons)) await put(ic, p, data);
}, { files, icons });
await page.reload();
await page.evaluate(() => {
  window.showDirectoryPicker = async (o) => (await navigator.storage.getDirectory()).getDirectoryHandle(o?.id === 'cartography-icons' ? 'azure-icons' : 'client');
});
await page.click('button:has-text("Open folder")');
await page.waitForSelector('.files .file');
await page.click('.files .file:has-text("shop.yaml")');
await page.waitForTimeout(600);
const canvas = () => page.locator('.drawing svg > rect').first().getAttribute('fill');
const before = await canvas();

const pick = async (label) => {
  await page.click('button[data-brand]');
  await page.click(`.menu [role="menuitem"]:has-text("${label}")`);
  await page.waitForTimeout(700);
};
await pick('Ocean');
if ((await canvas()) !== '#F2F8FB') fail(`ocean canvas: ${await canvas()} (was ${before})`);
if ((await page.locator('button[data-brand]').innerText()).trim() !== 'Ocean') fail('picker label');

await pick('acme.theme.yaml');
if ((await canvas()) !== '#FBF8F4') fail(`acme canvas: ${await canvas()}`);
const svg = await page.locator('.drawing svg').first().innerHTML();
if (!svg.includes('Acme Corporation')) fail('no title block');
if (!/<image[^>]+href="data:image\/svg\+xml/.test(svg)) fail('no logo');
if (!(await page.evaluate(() => document.fonts.check("600 14px 'Space Grotesk'")))) fail('brand font not registered');
await page.screenshot({ path: path.join(out, 'brand-acme.png') });

await pick('Icon folder');
const tiles = await page.locator('.drawing [data-node="kv"] image').count();
if (tiles !== 1) fail(`official icon not drawn (${tiles})`);
if (await page.locator('.drawing [data-node="web"] image').count()) fail('unmatched kind got an icon');
await page.screenshot({ path: path.join(out, 'brand-icons.png') });

await pick("The diagram's own");
if ((await canvas()) !== before) fail('back to the diagram theme');
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all brand steps ok');
await browser.close();
process.exitCode = problems.length ? 1 : 0;
