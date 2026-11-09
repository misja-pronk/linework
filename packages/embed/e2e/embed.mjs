// The web component in a real page: examples/docs/static/index.html from a static server of our own.
// Usage: node e2e/embed.mjs <screenshot folder> [page written by carto embed]   (build first: pnpm --filter @cartography/embed build)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? path.resolve(import.meta.dirname, 'out');
fs.mkdirSync(out, { recursive: true });
const root = path.resolve(import.meta.dirname, '../../..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.yaml': 'text/yaml', '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css' };

// Pages that exist only for this test, next to the example so relative paths are the same.
const hostile = `<!doctype html><meta charset="utf-8"><title>hostile</title>
<script type="module" src="/packages/embed/dist/carto-diagram.js"></script>
<carto-diagram id="hostile" loading="eager"><script type="text/yaml">
type: systems
title: '<img src=x onerror="window.pwned=1">'
nodes:
  a: { kind: client, label: "\\x3Cscript>window.pwned=1\\x3C/script>", links: ['javascript:window.pwned=1'] }
  b: { kind: api, label: '"><svg onload="window.pwned=1">', links: ["java\\tscript:window.pwned=1", 'https://example.com/ok'] }
  c: { kind: database, label: 'C', links: ["data:text/html,\\x3Cscript>window.pwned=1\\x3C/script>"] }
edges:
  - a -> b: '<a href="javascript:window.pwned=1">x</a>'
  - b -> c: ok
</script></carto-diagram>
<carto-diagram id="syntax" loading="eager"><script type="text/yaml">
type: systems
nodes:
  a: { kind: api, label: 'A
edges: [
</script></carto-diagram>
<carto-diagram id="empty" loading="eager"></carto-diagram>
<carto-diagram id="missing" loading="eager" src="no-such-file.yaml"></carto-diagram>
<carto-diagram id="elsewhere" loading="eager" src="https://example.com/diagram.yaml"></carto-diagram>`;
const virtual = { '/examples/docs/static/hostile.html': hostile };

const requests = [];
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  requests.push(url);
  if (virtual[url]) return res.writeHead(200, { 'content-type': types['.html'] }).end(virtual[url]);
  const file = path.join(root, url);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end('Not found');
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(fs.readFileSync(file));
});
// A port of our own in 5190-5199; the server lives in this process and ends with it.
let port = 0;
for (const p of [5193, 5194, 5195, 5196, 5197]) {
  const ok = await new Promise((done) => server.once('error', () => done(false)).listen(p, '127.0.0.1', () => done(true)));
  if (ok) {
    port = p;
    break;
  }
  server.removeAllListeners('error');
}
if (!port) throw new Error('No free port in 5193-5197');
const base = `http://127.0.0.1:${port}/examples/docs/static`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' });
const page = await context.newPage();
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(`page error: ${e.message}`));
page.on('dialog', (d) => {
  fail(`dialog: ${d.message()}`);
  void d.dismiss();
});
const state = (id) => page.locator(`#${id} .frame`).getAttribute('data-state');
const drawn = async (id) => {
  await page.locator(`#${id}`).scrollIntoViewIfNeeded();
  await page.waitForSelector(`#${id} .frame[data-state="drawn"] .canvas svg`, { timeout: 20000 });
};
const svgWidth = (id) => page.locator(`#${id} .canvas svg`).evaluate((s) => s.getBoundingClientRect().width);
const shot = (name, id) => (id ? page.locator(`#${id}`).screenshot({ path: `${out}/${name}.png` }) : page.screenshot({ path: `${out}/${name}.png` }));

try {
  await page.goto(`${base}/index.html`);

  // 1. Drawn in the page; the last one waits until it comes near.
  await drawn('context');
  if ((await state('lazy')) !== 'waiting') fail(`the diagram far below was drawn before scrolling: ${await state('lazy')}`);
  await drawn('views');
  await drawn('inline');
  await drawn('dark');
  if ((await state('lazy')) !== 'waiting') fail(`the diagram far below was drawn before it came near: ${await state('lazy')}`);
  await page.evaluate(() => scrollTo(0, 0));
  const drawing = (id) => page.locator(`#${id} .canvas svg`).evaluate((s) => s.textContent);
  const text = await drawing('context');
  if (!text.includes('Web shop')) fail(`context diagram misses "Web shop": ${text.slice(0, 200)}`);
  const label = await page.locator('#context .stage').getAttribute('aria-label');
  if (!label?.startsWith('Diagram: ')) fail(`no accessible name from the title: ${label}`);
  const fitWidth = await svgWidth('context');
  const stageWidth = await page.locator('#context .stage').evaluate((s) => s.clientWidth);
  if (fitWidth > stageWidth + 1) fail(`drawing wider than its container: ${fitWidth} > ${stageWidth}`);
  await page.waitForTimeout(300);
  await shot('1-page-light');
  await shot('1-context', 'context');

  // 2. Zoom: keys, buttons, ctrl + wheel, double-click; 0 fits again.
  await page.locator('#context .stage').focus();
  await page.keyboard.press('+');
  const zoomed = await svgWidth('context');
  if (!(zoomed > fitWidth * 1.3)) fail(`+ did not zoom: ${fitWidth} -> ${zoomed}`);
  await shot('2-zoomed', 'context');
  const box = await page.locator('#context .stage').boundingBox();
  await page.mouse.move(box.x + 40, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 60, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('0');
  if (Math.abs((await svgWidth('context')) - fitWidth) > 1) fail('0 did not fit the drawing again');
  await page.mouse.move(box.x + box.width / 2, box.y + 20);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -40);
  await page.keyboard.up('Control');
  await page.waitForTimeout(100);
  if (!((await svgWidth('context')) > fitWidth * 1.2)) fail('ctrl + wheel did not zoom');
  await page.locator('#context .tools [data-zoom="fit"]').click();
  if (Math.abs((await svgWidth('context')) - fitWidth) > 1) fail('the fit button did not fit');
  await page.locator('#context .tools [data-zoom="in"]').click();
  if (!((await svgWidth('context')) > fitWidth * 1.3)) fail('the + button did not zoom');
  await page.locator('#context .tools [data-zoom="out"]').click();
  if (Math.abs((await svgWidth('context')) - fitWidth) > 1) fail('the − button did not zoom back');
  // A plain wheel belongs to the page.
  const before = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(100);
  if ((await page.evaluate(() => scrollY)) === before) fail('a plain wheel over a diagram did not scroll the page');
  await page.mouse.wheel(0, -120);
  await page.evaluate(() => scrollTo(0, 0));

  // 3. Drill-down through a link, and back.
  await page.locator('#context .canvas [data-node="shop"]').click();
  await page.waitForSelector('#context .bar .back');
  await page.waitForFunction(() => document.querySelector('#context').trail.length === 2 && document.querySelector('#context').trail[1].title);
  const trail = await page.evaluate(() => document.querySelector('#context').trail);
  if (!trail[1].url.endsWith('/model/containers.yaml') || trail[1].view !== 'containers') fail(`drill-down went to ${JSON.stringify(trail[1])}`);
  if (!(await drawing('context')).includes('Orders API')) fail('containers not drawn after drill-down');
  const crumbs = await page.locator('#context .bar ol li').allInnerTexts();
  if (crumbs.length !== 2) fail(`breadcrumb: ${crumbs}`);
  await page.waitForTimeout(200);
  await shot('3-drilled', 'context');
  // One more level, by keyboard: the API leads to its deployment.
  await page.locator('#context .canvas [data-node="shop.api"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#context').trail.length === 3 && document.querySelector('#context').trail[2].title);
  await page.waitForTimeout(200);
  await shot('3-drilled-twice', 'context');
  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => document.querySelector('#context').trail.length === 2);
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForFunction(() => document.querySelector('#context').trail.length === 1);
  await page.waitForSelector('#context .bar', { state: 'hidden' });
  if (!(await drawing('context')).includes('Web shop')) fail('back did not return to the context diagram');
  // The back button does the same.
  await page.locator('#context .canvas [data-node="shop"]').click();
  await page.locator('#context .bar .back').click();
  await page.waitForFunction(() => document.querySelector('#context').trail.length === 1);

  // 4. The view picker.
  const options = await page.locator('#views .bar select option').allInnerTexts();
  if (options.length < 2) fail(`view picker options: ${options}`);
  await page.locator('#views .bar select').selectOption('ordering');
  await page.waitForFunction(() => !document.querySelector('#views').shadowRoot.querySelector('.canvas svg').textContent.includes('Mailer'));
  await page.locator('#views').scrollIntoViewIfNeeded();
  await shot('4-view-ordering', 'views');

  // 5. Problems are shown in place, with the line.
  await page.locator('#broken').scrollIntoViewIfNeeded();
  await page.waitForSelector('#broken .problems');
  const problem = await page.locator('#broken .problems').innerText();
  if (!/nowhere/.test(problem) || !/\d+:\d+/.test(problem)) fail(`problem text lacks the cause or the line: ${problem}`);
  await page.locator('#broken').scrollIntoViewIfNeeded();
  await shot('5-problem', 'broken');
  await shot('5-inline', 'inline');

  // 6. Dark: by the page's own switch, and by the system setting.
  const mode = (id) => page.locator(`#${id} .frame`).getAttribute('data-mode');
  if ((await mode('context')) !== 'light' || (await mode('dark')) !== 'dark') fail(`modes before the switch: ${await mode('context')}, ${await mode('dark')}`);
  await page.evaluate(() => scrollTo(0, 0));
  await page.locator('#scheme').click();
  await page.waitForSelector('#context .frame[data-mode="dark"][data-state="drawn"]');
  await page.waitForSelector('#inline .frame[data-mode="dark"]');
  await page.waitForTimeout(500);
  await shot('6-page-dark');
  await shot('6-context-dark', 'context');
  await page.locator('#scheme').click();
  await page.waitForSelector('#context .frame[data-mode="light"]');
  if ((await mode('dark')) !== 'dark') fail('theme="dark" did not stay dark');
  await page.evaluate(() => delete document.documentElement.dataset.theme);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForSelector('#context .frame[data-mode="dark"]');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForSelector('#context .frame[data-mode="light"]');

  // 7. Lazy: drawn once scrolled to, and the engine was fetched once for the whole page.
  await page.locator('#lazy').scrollIntoViewIfNeeded();
  await drawn('lazy');
  await page.waitForTimeout(300);
  await shot('7-lazy-sequence', 'lazy');
  const engines = requests.filter((r) => r.endsWith('/carto-engine.js')).length;
  if (engines !== 1) fail(`the engine was requested ${engines} times`);
  const models = requests.filter((r) => r.endsWith('/model/model.yaml')).length;
  if (models !== 1) fail(`model.yaml was requested ${models} times`);

  // 8. The text alternative.
  const alt = page.locator('#inline details.alt');
  await alt.locator('summary').focus();
  await page.keyboard.press('Enter');
  const words = await alt.innerText();
  if (!words.includes('Visitor') || !words.includes('Website → CRM')) fail(`text description: ${words}`);
  await page.locator('#inline').scrollIntoViewIfNeeded();
  await shot('8-description', 'inline');

  // 9. Hostile YAML: nothing runs, nothing unsafe is left in the tree; other sites are refused.
  await page.goto(`${base}/hostile.html`);
  await page.waitForSelector('#hostile .frame[data-state="drawn"] .canvas svg');
  await page.waitForSelector('#elsewhere .frame[data-state="failed"]');
  const found = await page.evaluate(() => {
    const rootOf = document.querySelector('#hostile').shadowRoot;
    const bad = [];
    for (const el of rootOf.querySelectorAll('*')) {
      if (['script', 'img', 'iframe', 'foreignObject'].includes(el.localName)) bad.push(el.localName);
      for (const a of el.attributes) {
        if (a.name.startsWith('on')) bad.push(`${el.localName}@${a.name}`);
        if (/^\s*(javascript|data):/i.test(a.value.replace(/[\t\n\r]/g, '')) && el.localName !== 'image') bad.push(`${el.localName}@${a.name}=${a.value.slice(0, 30)}`);
      }
    }
    return {
      bad,
      links: [...rootOf.querySelectorAll('.canvas .link')].map((e) => e.dataset.node),
      pwned: window.pwned ?? null,
      text: rootOf.querySelector('.canvas svg').textContent,
    };
  });
  if (found.bad.length) fail(`unsafe content in the tree: ${found.bad.join(', ')}`);
  if (found.pwned) fail('script from the YAML ran');
  if (found.links.join() !== 'b') fail(`only the https link should be clickable, got: ${found.links}`);
  if (!found.text.includes('<script>')) fail('the hostile label is not shown as text');
  // Clicking and pressing Enter on the hostile ones opens nothing.
  const opened = [];
  context.on('page', (p) => opened.push(p.url()));
  await page.locator('#hostile .canvas [data-node="a"]').click();
  await page.locator('#hostile .canvas [data-node="c"]').click();
  await page.waitForTimeout(200);
  if (opened.length || (await page.evaluate(() => window.pwned))) fail(`a hostile link opened: ${opened}`);
  for (const id of ['syntax', 'empty', 'missing']) {
    await page.waitForSelector(`#${id} .frame[data-state="failed"] .problems`);
    const box = await page.locator(`#${id}`).boundingBox();
    if (!box || box.height < 30) fail(`#${id} is a blank box`);
  }
  if (!/\d+:\d+/.test(await page.locator('#syntax .problems').innerText())) fail('a YAML mistake is shown without its line');
  if (!/404/.test(await page.locator('#missing .problems').innerText())) fail('a missing file is not explained');
  const refused = await page.locator('#elsewhere .problems').innerText();
  if (!/another site/.test(refused)) fail(`cross-origin message: ${refused}`);
  if (requests.some((r) => r.includes('example.com'))) fail('a request left the site');
  await shot('9-hostile');

  // 10. A page written by `carto embed`, opened from disk: everything is in the one file.
  const single = process.argv[3];
  if (single) {
    const lone = await context.newPage();
    const asked = [];
    lone.on('pageerror', (e) => fail(`carto embed page error: ${e.message}`));
    lone.on('request', (r) => asked.push(r.url()));
    await lone.goto(`file://${path.resolve(single)}`);
    await lone.waitForSelector('carto-diagram .frame[data-state="drawn"] .canvas svg', { timeout: 20000 });
    const text = () => lone.locator('carto-diagram .canvas svg').evaluate((s) => s.textContent);
    if (!(await text()).includes('Customer')) fail('the carto embed page does not show the diagram');
    await lone.locator('carto-diagram [data-node="shop"]').click();
    await lone
      .waitForFunction(() => document.querySelector('carto-diagram').shadowRoot.querySelector('.canvas svg')?.textContent.includes('Storefront'), null, { timeout: 10000 })
      .catch(() => fail('the carto embed page does not drill down'));
    await lone.waitForTimeout(300);
    await lone.screenshot({ path: `${out}/10-cli-page.png` });
    const away = asked.filter((u) => !u.startsWith('file://') && !u.startsWith('data:') && !u.startsWith('blob:'));
    if (away.length) fail(`the carto embed page asked for ${away.join(', ')}`);
    await lone.close();
  }
} catch (e) {
  fail(`stopped: ${e.message}`);
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}

if (problems.length) {
  console.error(problems.map((p) => `FAIL ${p}`).join('\n'));
  process.exit(1);
}
console.log(`embed e2e ok (port ${port}), screenshots in ${out}`);
