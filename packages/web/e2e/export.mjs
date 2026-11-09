// PowerPoint and PDF from the Export menu: both made in the browser, offline, and well-formed.
import fs from 'node:fs';
import { chromium } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, acceptDownloads: true });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
const fail = (m) => problems.push(m);
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('cartography:started', 'true');
});
await page.reload();
await page.waitForSelector('.preview svg');
// No network beyond the app itself: the libraries and fonts must come with it.
const origin = new URL(page.url()).origin;
page.on('request', (r) => !r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:') && fail(`left the app: ${r.url()}`));

async function save(label) {
  await page.click('button:has-text("Export")');
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click(`[role=menuitem]:has-text("${label}")`)]);
  const file = `${out}/${download.suggestedFilename()}`;
  await download.saveAs(file);
  return fs.readFileSync(file);
}

const pptx = unzipSync(new Uint8Array(await save('PowerPoint slide')));
const slide = pptx['ppt/slides/slide1.xml'] ? strFromU8(pptx['ppt/slides/slide1.xml']) : '';
if (!slide.includes('<p:cxnSp>') && !slide.includes('<a:custGeom>')) fail('pptx: no lines on the slide');
if (!slide.includes('prst="roundRect"')) fail('pptx: no card shapes');
if (!Object.keys(pptx).some((p) => p.endsWith('.png'))) fail('pptx: icons got no PNG fallback');
const pdf = (await save('PDF')).toString('latin1');
if (!pdf.startsWith('%PDF-')) fail('pdf: not a PDF');
if (!/\/FontFile2/.test(pdf)) fail('pdf: Inter not embedded');
if ((pdf.match(/\/Type \/Page\b/g) ?? []).length !== 1) fail('pdf: expected one page');
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all export steps ok');
await browser.close();
