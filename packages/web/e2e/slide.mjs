// Slide mode: the canvas frames the page the drawing is for (16:9 unless aspect: says otherwise),
// says how small its text comes out, flags what makes it too small, follows aspect:, hides with
// shift-P, and exports onto the page: node e2e/slide.mjs <outDir>
import fs from 'node:fs';
import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const problems = [];
const fail = (m) => problems.push(m);
let page;
const wait = (ms = 300) => page.waitForTimeout(ms);
/** `frameOn`: the page frame pref as the person left it; true unless said (it is off by default). */
const open = async (text, name, frameOn = true) => {
  page = await (await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true })).newPage();
  page.on('pageerror', (e) => fail(e.message));
  await page.addInitScript(
    ({ text, name, frameOn }) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.clear();
      for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'code', doc: { text, doc: { name } }, ...(frameOn == null ? {} : { page: frameOn }) })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
    },
    { text, name, frameOn },
  );
  await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
  await page.waitForSelector('.drawing svg');
  await wait(900);
};
const frame = async () => {
  const f = page.locator('.page-frame');
  if (!(await f.count())) return undefined;
  const b = await f.boundingBox();
  return { name: await f.getAttribute('data-page'), pt: Number(await f.getAttribute('data-pt')), small: (await f.getAttribute('class')).includes('small'), shape: b.width / b.height, label: await f.locator('.page-label').innerText() };
};

// 0. Nobody asked for the page: no frame on the canvas.
await open('type: azure\ntitle: Small\nnodes:\n  app: { kind: app-service, label: App Service }\n', 'plain.yaml', null);
if (await page.locator('.page-frame').count()) fail('the page frame shows without being asked for');
await page.context().close();

// 1. A small drawing: a 16:9 frame around it, readable, nothing flagged.
await open('type: azure\ntitle: Small\nnodes:\n  app: { kind: app-service, label: App Service }\n  db: { kind: sql-database, label: Orders }\nedges:\n  - app -> db\n', 'small.yaml');
{
  const f = await frame();
  if (!f) fail('no page frame on the canvas');
  else {
    if (f.name !== '16:9 slide' || Math.abs(f.shape - 16 / 9) > 0.02) fail(`the frame is not a 16:9 slide: ${JSON.stringify(f)}`);
    if (f.small || f.pt < 9) fail(`a small drawing is flagged as too small: ${JSON.stringify(f)}`);
    if (!/^Page: 16:9 slide · [\d.]+ pt/.test(f.label)) fail(`the frame does not say its page and text size: "${f.label}"`);
  }
  if (await page.locator('[data-overflow]').count()) fail('a small drawing has elements flagged');
  await page.screenshot({ path: `${out}/s1-small.png` });
  // Shift-P hides the page, and shows it again.
  await page.locator('.preview').focus();
  await page.keyboard.press('Shift+P');
  await wait(300);
  if (await page.locator('.page-frame').count()) fail('shift-P did not hide the page');
  await page.keyboard.press('Shift+P');
  await wait(300);
  if (!(await page.locator('.page-frame').count())) fail('shift-P did not bring the page back');
}

// 2. A big drawing: the frame says its text is under 6 pt (SLIDE_MIN_PT), shows the readable part and flags what lies outside it.
await page.context().close();
// Written here, not an example: the examples are kept small enough for a slide.
const chain = Array.from({ length: 16 }, (_, i) => `s${i}`);
const tooBig = `type: systems\ntitle: A long chain\nnodes:\n${chain.map((id, i) => `  ${id}: { kind: service, label: Service number ${i + 1} }`).join('\n')}\nedges:\n${chain.slice(1).map((id, i) => `  - ${chain[i]} -> ${id}: calls`).join('\n')}\n`;
await open(tooBig, 'long-chain.yaml');
{
  const f = await frame();
  if (!f?.small) fail(`a drawing far too big for a slide is not flagged: ${JSON.stringify(f)}`);
  if (!(await page.locator('.page-readable').count())) fail('no readable part shown on a page that is too full');
  if (!(await page.locator('[data-overflow]').count())) fail('nothing flagged outside the readable part');
  if (!/under 6 pt/.test(f?.label ?? '')) fail(`the frame does not say the text is under 6 pt: "${f?.label}"`);
  if (!/outlined: past the readable part/.test(f?.label ?? '')) fail(`the frame does not say what the outlines mean: "${f?.label}"`);
  await page.screenshot({ path: `${out}/s2-too-full.png` });
  // The page export: an SVG of the page's shape.
  await page.click('button:has-text("Export")');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[role="menuitem"]:has-text("SVG of the page")')]);
  const svg = fs.readFileSync(await dl.path(), 'utf8');
  const [, w, h] = /<svg[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"/.exec(svg) ?? [];
  if (!w || Math.abs(Number(w) / Number(h) - 16 / 9) > 0.01) fail(`the page SVG is not 16:9: ${w}×${h}`);
  // The frame says what the PowerPoint slide has: the export's notice names the same size for slide 1.
  await page.click('button:has-text("Export")');
  await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('[role="menuitem"]:has-text("PowerPoint")')]);
  await wait(600);
  const said = /slide 1: ([\d.]+) pt/.exec(await page.locator('body').innerText())?.[1];
  if (!said || Number(said) !== f?.pt) fail(`the frame says ${f?.pt} pt, the PowerPoint export ${said} pt for its slide`);
}

// 3. aspect: 4:3 and A4 portrait give those pages; aspect: auto none.
for (const [aspect, name, shape] of [['4:3', '4:3 slide', 4 / 3], ['a4-portrait', 'A4 portrait', 210 / 297], ['auto', undefined]]) {
  await page.context().close();
  await open(`type: azure\ntitle: Paged\naspect: ${aspect}\nnodes:\n  app: { kind: app-service, label: App Service }\n`, 'paged.yaml');
  const f = await frame();
  if (!name) {
    if (f) fail('aspect: auto still shows a page');
    continue;
  }
  if (f?.name !== name || Math.abs(f.shape - shape) > 0.02) fail(`aspect: ${aspect} did not frame a ${name}: ${JSON.stringify(f)}`);
}
await page.screenshot({ path: `${out}/s3-auto.png` });

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all slide steps ok');
await browser.close();
process.exitCode = problems.length ? 1 : 0;
