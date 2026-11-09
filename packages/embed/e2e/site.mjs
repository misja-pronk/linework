// A built docs site with diagrams from the plugins: the drawing is there without JavaScript, the dark
// one shows on a dark page, and a diagram marked interactive comes alive when the component loads.
// Usage: node e2e/site.mjs <vitepress|docusaurus|mkdocs> <built site folder> <screenshot folder> [page path]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from '@playwright/test';

const [kind, siteArg, outArg, pagePath = '/'] = process.argv.slice(2);
if (!kind || !siteArg) throw new Error('Usage: node e2e/site.mjs <vitepress|docusaurus|mkdocs> <built site folder> <screenshot folder> [page path]');
const site = path.resolve(siteArg);
const out = path.resolve(outArg ?? path.join(import.meta.dirname, 'out'));
fs.mkdirSync(out, { recursive: true });
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.yaml': 'text/yaml',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
};

// How each site is told to be dark, the way its own switch does it.
const goDark = {
  vitepress: () => document.documentElement.classList.add('dark'),
  docusaurus: () => document.documentElement.setAttribute('data-theme', 'dark'),
  // The built-in theme marks the page; Material marks the body.
  mkdocs: () => (document.documentElement.setAttribute('data-bs-theme', 'dark'), document.body.setAttribute('data-md-color-scheme', 'slate')),
}[kind];
if (!goDark) throw new Error(`Unknown site kind "${kind}"`);

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(site, url);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
  if (!file.startsWith(site) || !fs.existsSync(file)) return res.writeHead(404).end('Not found');
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(fs.readFileSync(file));
});
// A port of our own in 5190-5199; the server lives in this process and ends with it.
let port = 0;
for (const p of [5195, 5196, 5197, 5198]) {
  const ok = await new Promise((done) => server.once('error', () => done(false)).listen(p, '127.0.0.1', () => done(true)));
  if (ok) {
    port = p;
    break;
  }
  server.removeAllListeners('error');
}
if (!port) throw new Error('No free port in 5195-5198');
const address = `http://127.0.0.1:${port}${pagePath}`;

const problems = [];
const fail = (m) => problems.push(m);
const browser = await chromium.launch();
const visible = (page, selector) => page.locator(selector).evaluateAll((all) => all.filter((e) => e.getBoundingClientRect().height > 0).length);

try {
  // 1. Without JavaScript: the drawings are in the page as it comes from the server.
  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(address);
    const figures = await page.locator('figure.carto').count();
    if (!figures) fail('no figure.carto in the page');
    const drawings = await visible(page, 'figure.carto svg, figure.carto img');
    if (drawings !== figures) fail(`without JavaScript (${scheme}): ${drawings} drawings visible for ${figures} figures`);
    await page.screenshot({ path: `${out}/${kind}-nojs-${scheme}.png`, fullPage: true });
    await context.close();
  }

  // 2. With JavaScript: light, then dark the way the site's own switch does it.
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' });
  const page = await context.newPage();
  page.on('pageerror', (e) => fail(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || /hydrat/i.test(m.text())) fail(`console ${m.type()}: ${m.text()}`);
  });
  await page.goto(address);
  await page.waitForLoadState('networkidle');
  const pairs = await page.locator('figure.carto .carto-light').count();
  if (!pairs) fail('no light and dark pair in the page');
  if ((await visible(page, 'figure.carto .carto-light')) !== pairs || (await visible(page, 'figure.carto .carto-dark')) !== 0)
    fail('on a light page the light drawings should show and the dark ones not');
  await page.screenshot({ path: `${out}/${kind}-light.png`, fullPage: true });
  await page.evaluate(goDark);
  await page.waitForTimeout(200);
  // A live diagram hides its static stand-in, so only count the pairs that are still static.
  const staticPairs = await page.locator('figure.carto .carto-dark').evaluateAll((all) => all.filter((e) => !e.closest('carto-diagram')).length);
  const darkShown = await page
    .locator('figure.carto .carto-dark')
    .evaluateAll((all) => all.filter((e) => !e.closest('carto-diagram') && e.getBoundingClientRect().height > 0).length);
  const lightShown = await page
    .locator('figure.carto .carto-light')
    .evaluateAll((all) => all.filter((e) => !e.closest('carto-diagram') && e.getBoundingClientRect().height > 0).length);
  if (darkShown !== staticPairs || lightShown !== 0) fail(`on a dark page: ${darkShown} of ${staticPairs} dark drawings and ${lightShown} light ones show`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${kind}-dark.png`, fullPage: true });

  // 3. A diagram marked interactive comes alive, follows the dark page, and drills down.
  const live = page.locator('carto-diagram').first();
  if (await live.count()) {
    await live.scrollIntoViewIfNeeded();
    await page.waitForSelector('carto-diagram .frame[data-state="drawn"] .canvas svg', { timeout: 20000 });
    const text = () => live.locator('.canvas svg').evaluate((s) => s.textContent);
    if (!(await text()).includes('Web shop')) fail(`the live diagram misses "Web shop": ${(await text()).slice(0, 120)}`);
    if ((await visible(page, 'carto-diagram figure.carto')) !== 0) fail('the static drawing still shows next to the live one');
    await live.screenshot({ path: `${out}/${kind}-live-dark.png` });
    await live.locator('[data-node="shop"]').click();
    await page
      .waitForFunction(() => document.querySelector('carto-diagram').shadowRoot.querySelector('.canvas svg')?.textContent.includes('Storefront'), null, { timeout: 10000 })
      .catch(() => fail('clicking Web shop did not open its containers'));
    await page.waitForTimeout(300);
    await live.screenshot({ path: `${out}/${kind}-live-drilled.png` });
    await live.locator('.stage').focus();
    await page.keyboard.press('Backspace');
    await page
      .waitForFunction(() => document.querySelector('carto-diagram').shadowRoot.querySelector('.canvas svg')?.textContent.includes('Customer'), null, { timeout: 10000 })
      .catch(() => fail('Backspace did not go back'));
  } else console.log('no interactive diagram in this page');
  await context.close();
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
} finally {
  await browser.close();
  server.close();
}
if (problems.length) {
  console.error(problems.map((p) => `FAIL ${p}`).join('\n'));
  process.exit(1);
}
console.log(`${kind}: ok, screenshots in ${out}`);
