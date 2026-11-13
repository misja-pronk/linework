// The diagram in words (docs/describe.md): the Describe dialog from the palette and from the Export
// menu, its copy buttons and keys, "Copy for Confluence / Notion" as rich HTML with the PNG inside,
// and the text alternative of an exported SVG and PNG as a screen reader gets it (the accessibility tree).
//   node packages/web/e2e/describe.mjs <out-folder>     CARTO_URL picks the app (default http://localhost:5178/)
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? '.';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
const wait = (ms) => page.waitForTimeout(ms);
const url = process.env.CARTO_URL ?? 'http://localhost:5178/';
const origin = new URL(url).origin;
page.on('request', (r) => !r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:') && fail(`left the app: ${r.url()}`));
await page.goto(url);
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('cartography:started', 'true');
  // The YAML starts folded to its rail; these steps type in it.
  localStorage.setItem('cartography:yaml-folded', 'false');
});
await page.reload();
await page.waitForSelector('.preview svg');

// A diagram with steps and a key, typed into the editor as anyone would.
const yaml = `type: systems
title: Web shop
subtitle: How an order flows
groups:
  shop: { kind: system, label: Web shop }
nodes:
  customers: users
  web: { kind: client, label: Storefront, in: shop }
  orders: { kind: service, label: Orders API, in: shop }
  db: { kind: database, label: Orders DB, in: shop }
edges:
  - customers -> web: HTTPS
  - web -> orders: { label: REST, style: sync }
  - orders -> db: { label: SQL, style: data }
steps:
  - title: The order comes in
    focus: [customers, web]
  - title: It is stored
    focus: [orders, db]
`;
await page.locator('.cm-content').click();
await page.keyboard.press('Meta+a');
await page.keyboard.insertText(yaml);
await page.waitForFunction(() => document.querySelector('.preview svg')?.textContent?.includes('Orders API'), null, { timeout: 15000 }).catch(() => fail('the typed diagram was not drawn'));
await wait(500);

// 1. From the palette, by keyboard.
await page.keyboard.press('Meta+k');
await page.keyboard.type('describe');
const option = page.locator('.palette [role="option"]:has-text("Describe in words")');
if (!(await option.count())) fail('the palette offers no "Describe in words"');
await page.keyboard.press('Enter');
const dialog = page.getByRole('dialog', { name: 'Describe' });
await dialog.waitFor({ timeout: 5000 }).catch(() => fail('Describe opened no dialog'));
await wait(600);
await page.screenshot({ path: `${out}/describe-dialog.png` });
const tree = await dialog.ariaSnapshot().catch(() => '');
fs.writeFileSync(`${out}/describe-dialog.aria.txt`, tree);
for (const want of ['heading "Web shop"', 'heading "Groups and elements"', 'heading "Connections"', 'heading "Walkthrough"', 'heading "Key"', 'Users connect to Storefront over HTTPS.', 'Storefront calls Orders API (REST).', 'The order comes in.']) if (!tree.includes(want)) fail(`the dialog's accessibility tree lacks ${want}`);
// The dialog is described by its summary, as a screen reader announces it on opening.
const described = await dialog.evaluate((d) => document.getElementById(d.getAttribute('aria-describedby') ?? '')?.textContent ?? '');
if (!described.startsWith('Architecture diagram: How an order flows.')) fail(`the dialog's description is "${described}"`);

// T copies the words as text, M as Markdown.
await page.keyboard.press('t');
await wait(300);
const text = await page.evaluate(() => navigator.clipboard.readText());
if (!text.startsWith('Web shop\n\nArchitecture diagram: How an order flows.')) fail(`T copied: ${text.slice(0, 80)}`);
await page.keyboard.press('m');
await wait(300);
const md = await page.evaluate(() => navigator.clipboard.readText());
if (!md.startsWith('## Web shop\n') || !md.includes('### Walkthrough\n\n1. The order comes in.')) fail(`M copied: ${md.slice(0, 120)}`);
fs.writeFileSync(`${out}/describe.md`, md);
await page.keyboard.press('Escape');
await wait(200);
if (await dialog.count()) fail('Escape left the dialog open');

// 2. From the Export menu, with the pointer: Copy for Confluence / Notion puts rich HTML on the clipboard.
await page.click('button:has-text("Export")');
await page.click('[role=menuitem]:has-text("Copy for Confluence / Notion")');
await page.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('Confluence'), null, { timeout: 15000 }).catch(() => fail('no word that the copy for Confluence worked'));
const clip = await page.evaluate(async () => {
  const items = await navigator.clipboard.read();
  const item = items[0];
  if (!item) return {};
  const get = async (t) => (item.types.includes(t) ? await (await item.getType(t)).text() : undefined);
  return { types: item.types, html: await get('text/html'), text: await get('text/plain') };
});
if (!clip.html?.includes('<img src="data:image/png;base64,')) fail(`the rich copy holds no PNG: ${clip.types}`);
if (!clip.html?.includes('<h3>Connections</h3>') || !clip.html.includes('alt="Web shop. Architecture diagram')) fail('the rich copy lacks the words or the alt text');
if (!clip.text?.startsWith('Web shop')) fail('the rich copy has no plain-text fallback');
fs.writeFileSync(`${out}/clipboard.html`, clip.html ?? '');
// Pasted into an editor, it is a picture with alt text and headings: what Confluence and Notion make of it.
const paste = await browser.newPage();
await paste.setContent(`<div contenteditable="true" id="doc">${clip.html ?? ''}</div>`);
const pasted = await paste.locator('#doc').ariaSnapshot();
fs.writeFileSync(`${out}/clipboard.aria.txt`, pasted);
if (!/img "Web shop\. Architecture diagram/.test(pasted)) fail('the pasted picture has no alt text');
await paste.screenshot({ path: `${out}/clipboard.png`, fullPage: true });
await paste.close();

// 3. The menu opens the dialog too.
await page.click('button:has-text("Export")');
await page.click('[role=menuitem]:has-text("Describe in words")');
await dialog.waitFor({ timeout: 5000 }).catch(() => fail('the menu opened no Describe dialog'));
await dialog.getByRole('button', { name: /Copy text/ }).click();
await wait(300);
if (!(await page.evaluate(() => navigator.clipboard.readText())).includes('Walkthrough')) fail('Copy text did not copy the words');
await dialog.getByRole('button', { name: 'Close' }).click();

// 4. The exported SVG as a screen reader gets it, in an <img> and inline.
async function save(label) {
  await page.click('button:has-text("Export")');
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click(`[role=menuitem]:has-text("${label}")`)]);
  const file = `${out}/${download.suggestedFilename()}`;
  await download.saveAs(file);
  return fs.readFileSync(file);
}
const svg = (await save('SVG')).toString('utf8');
const head = /<svg[^>]*>/.exec(svg)?.[0] ?? '';
if (!head.includes('role="img"') || !head.includes('aria-labelledby=') || !head.includes('aria-describedby=')) fail(`the SVG root does not name itself: ${head.slice(0, 200)}`);
const shown = await browser.newPage();
await shown.setContent(`<main>${svg}</main>`);
const cdp = await shown.context().newCDPSession(shown);
const { nodes } = await cdp.send('Accessibility.getFullAXTree');
const img = nodes.find((n) => n.role?.value === 'image' && n.name?.value === 'Web shop');
if (!img) fail('the inline SVG is not an image named "Web shop" in the accessibility tree');
else {
  const desc = img.description?.value ?? '';
  fs.writeFileSync(`${out}/svg-accessible-description.txt`, desc);
  if (!desc.startsWith('Architecture diagram: How an order flows.') || !desc.includes('Storefront calls Orders API (REST).')) fail(`the SVG's accessible description is "${desc.slice(0, 120)}"`);
}
const aria = await shown.locator('main').ariaSnapshot();
if (!aria.includes('img "Web shop"')) fail(`aria snapshot of the inline SVG: ${aria.slice(0, 200)}`);
await shown.close();

// 5. The PNG carries its title and description as text chunks.
const png = await save('PNG');
const latin = png.toString('latin1');
if (!latin.includes('iTXtTitle\0\0\0\0\0Web shop')) fail('the PNG has no Title');
if (!png.toString('utf8').includes('Description\0\0\0\0\0Architecture diagram: How an order flows.')) fail('the PNG has no Description');

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'describe ok: dialog, copy as text and Markdown, rich copy with PNG, SVG and PNG text alternatives');
await browser.close();
process.exit(problems.length ? 1 : 0);
