// Interactive HTML: exported from the web app's Export menu and from `carto export-html`, then opened
// from disk (file://) with every request outside the file blocked. Stepping, drill-down, search,
// details, dark, presenting and print to PDF; nothing may ask the network for anything.
// node packages/web/e2e/html-export.mjs <out-folder>   (CARTO_URL: the web app, default http://localhost:5178/)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const out = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'carto-html-')));
fs.mkdirSync(out, { recursive: true });
const problems = [];
const fail = (m) => problems.push(m);
const check = (ok, m) => ok || fail(m);

// ---------------------------------------------------------------- the CLI
const tsx = path.join(root, 'node_modules/tsx/dist/cli.mjs');
const carto = (...args) => execFileSync(process.execPath, [tsx, 'packages/cli/src/main.ts', ...args], { cwd: root, encoding: 'utf8' });
const files = {
  shop: path.join(out, 'web-shop.html'),
  walk: path.join(out, 'invoice-walkthrough.html'),
  site: path.join(out, 'workspace.html'),
  hostile: path.join(out, 'hostile.html'),
};
carto('export-html', 'examples/systems/web-shop.yaml', '-o', files.shop);
carto('export-html', 'examples/systems/invoice-walkthrough.yaml', '-o', files.walk);
carto('export-html', 'examples/workspace', '-o', files.site);
// What a diagram says is text, wherever it ends up.
const evil = path.join(out, 'hostile.yaml');
fs.writeFileSync(
  evil,
  `type: systems
title: "</script><script>window.pwned=1</script><img src=x onerror=window.pwned=2>"
nodes:
  a: { label: "<img src=x onerror=window.pwned=3>", kind: client, description: "<script>window.pwned=4</script>", links: ["javascript:window.pwned=5"] }
  b: { label: "\\" onmouseover=\\"window.pwned=6", kind: service }
edges:
  - a -> b: "<svg onload=window.pwned=7>"
`,
);
carto('export-html', evil, '-o', files.hostile);
const size = (f) => `${(fs.statSync(f).size / 1024).toFixed(0)} kB`;
for (const [k, f] of Object.entries(files)) console.log(`cli ${k}: ${size(f)}`);

const browser = await chromium.launch();

// ---------------------------------------------------------------- the web app
{
  const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, acceptDownloads: true });
  page.on('pageerror', (e) => fail(`app: ${e.message}`));
  await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('cartography:started', 'true');
  });
  await page.reload();
  await page.waitForSelector('.preview svg');
  await page.click('button:has-text("Export")');
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('[role=menuitem]:has-text("Interactive HTML")')]);
  files.web = path.join(out, `app-${download.suggestedFilename()}`);
  await download.saveAs(files.web);
  check(download.suggestedFilename().endsWith('.html'), `app: download named ${download.suggestedFilename()}`);
  console.log(`app export: ${size(files.web)}`);
  await page.close();
}

// ---------------------------------------------------------------- opening a file

/** A page with the file open from disk and the network shut: every request but the file itself is a failure. */
async function open(file, opts = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: opts.dark ? 'dark' : 'light', ...opts.context });
  const url = 'file://' + file;
  const requests = [];
  await context.route('**/*', (route) => (route.request().url().split('#')[0] === url ? route.continue() : (requests.push(route.request().url()), route.abort())));
  const page = await context.newPage();
  const name = path.basename(file);
  page.on('request', (r) => r.url().split('#')[0] !== url && !r.url().startsWith('data:') && requests.push(r.url()));
  page.on('pageerror', (e) => fail(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && fail(`${name}: console: ${m.text()}`));
  page.on('dialog', (d) => (fail(`${name}: a dialog opened: ${d.message()}`), d.dismiss()));
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`)));
  await page.goto(url + (opts.hash ?? ''));
  await page.waitForSelector('body[data-ready]', { timeout: 15000 });
  return {
    page,
    done: async () => {
      check(requests.length === 0, `${name}: ${requests.length} requests: ${requests.slice(0, 3).join(', ')}`);
      await context.close();
    },
  };
}

const hash = (page) => page.evaluate(() => decodeURIComponent(location.hash));
const shot = (page, n) => page.screenshot({ path: path.join(out, `${n}.png`) });

// One diagram from the CLI: drawn, details on click, zoom, dark.
{
  const { page, done } = await open(files.shop);
  check(await page.locator('.sheet svg [data-node="orders"]').count(), 'shop: no Orders card');
  check(!(await page.locator('.side').isVisible()), 'shop: one drawing needs no contents');
  await page.click('.sheet svg [data-node="orders"]');
  await page.waitForSelector('.panel.open');
  check((await page.textContent('.panel h3')) === 'Orders', 'shop: the panel is not about Orders');
  check(await page.locator('.sheet .carto-hl').count(), 'shop: no ring around the selection');
  await shot(page, 'shop-details');
  const before = await page.textContent('.zoom .pct');
  await page.keyboard.press('Escape');
  await page.focus('.stage');
  await page.keyboard.press('+');
  check((await page.textContent('.zoom .pct')) !== before, 'shop: + did not zoom');
  await page.keyboard.press('0');
  const light = await page.getAttribute('.sheet svg > rect', 'fill');
  await page.keyboard.press('d');
  check((await page.getAttribute('html', 'data-theme')) === 'dark', 'shop: d did not turn it dark');
  check((await page.getAttribute('.sheet svg > rect', 'fill')) !== light, 'shop: the drawing stayed light');
  await shot(page, 'shop-dark');
  await done();
}

// Steps: arrows go through them, the bar says which; presenting goes full screen.
{
  const { page, done } = await open(files.walk);
  check(await page.locator('.steps').isVisible(), 'walk: no step bar');
  await page.focus('.stage');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  check((await hash(page)).endsWith('&step=2'), `walk: → → is ${await hash(page)}`);
  check((await page.textContent('.steps .say .caps')) === 'Step 2 of 7', 'walk: the bar does not say step 2 of 7');
  check((await page.textContent('.steps .say b')) === 'The order itself is quick', 'walk: wrong step title');
  await page.keyboard.press('p');
  await page.waitForSelector('.app.presenting');
  await page.keyboard.press('ArrowRight');
  check((await hash(page)).endsWith('&step=3'), 'walk: → while presenting');
  await shot(page, 'walk-present');
  await page.keyboard.press('Escape');
  check(!(await page.locator('.app.presenting').count()), 'walk: Esc did not stop presenting');
  await page.keyboard.press('ArrowLeft');
  check((await hash(page)).endsWith('&step=2'), 'walk: ← back');
  await done();
}

// The folder: contents, drill-down with a double-click, breadcrumbs back, search, print.
{
  const { page, done } = await open(files.site);
  check(await page.locator('.home h1').isVisible(), 'site: no contents page');
  check((await page.locator('.home .card').count()) === 6, 'site: not a card per diagram');
  await page.waitForSelector('.home .card .thumb svg');
  await shot(page, 'site-contents');
  await page.click('.home .card:has-text("system context")');
  await page.waitForSelector('.sheet svg [data-node="online"]');
  check((await hash(page)) === '#context.yaml#context', `site: the card opened ${await hash(page)}`);
  await page.dblclick('.sheet svg [data-node="online"]');
  await page.waitForFunction(() => decodeURIComponent(location.hash) === '#containers.yaml#online');
  await page.dblclick('.sheet svg [data-node="online.api"]');
  await page.waitForFunction(() => decodeURIComponent(location.hash) === '#containers.yaml#api');
  const crumbs = await page.locator('.crumbs a').allTextContents();
  check(crumbs.includes('Harbour Online'), `site: breadcrumbs ${crumbs.join(' / ')}`);
  await page.locator('.crumbs').getByRole('link', { name: 'Harbour Online', exact: true }).click();
  await page.waitForFunction(() => decodeURIComponent(location.hash) === '#containers.yaml#online');
  await page.goBack();
  await page.waitForFunction(() => decodeURIComponent(location.hash) === '#containers.yaml#api');
  // Search finds an element and opens it where it is drawn, with its details.
  await page.keyboard.press('/');
  await page.keyboard.type('settlement');
  await shot(page, 'site-search');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.panel.open');
  check((await page.textContent('.panel h3')) === 'Settlement engine', 'site: search did not open Settlement engine');
  check((await page.locator('.panel li a').allTextContents()).some((t) => t.includes('Harbour Bank')), 'site: where it appears does not list the deployment');
  await shot(page, 'site-element');
  // The deployment's card leads to the model.
  await page.click('.panel li a:has-text("Production"), .panel li a:has-text("Azure")');
  await page.waitForFunction(() => decodeURIComponent(location.hash).startsWith('#deployment.yaml'));
  await page.waitForSelector('.panel .open-btn[href*="model.yaml"]', { timeout: 5000 }).catch(() => fail('site: the deployment card has no way into the model'));
  // Print: a page per drawing and the contents in front, all in the light look.
  await page.keyboard.press('d');
  await page.waitForSelector('body[data-print=ready]');
  const pdf = await page.pdf({ path: path.join(out, 'workspace.pdf'), landscape: true, format: 'A4', preferCSSPageSize: true });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  check(pdf.toString('latin1').startsWith('%PDF-'), 'site: print gave no PDF');
  const drawings = await page.locator('.print .page[data-d]').count();
  check(drawings >= 12 && pages === drawings + 1, `site: ${pages} printed pages for ${drawings} drawings and the contents`);
  await done();
}

// The app's export opens the same way.
{
  const { page, done } = await open(files.web);
  check(await page.locator('.sheet svg [data-node]').count(), 'app export: nothing drawn');
  await shot(page, 'app-export');
  await done();
}

// Nothing in a diagram runs.
{
  const { page, done } = await open(files.hostile);
  await page.hover('.sheet svg [data-node="b"]');
  await page.click('.sheet svg [data-node="a"]');
  await page.waitForSelector('.panel.open');
  check((await page.textContent('.panel h3')) === '<img src=x onerror=window.pwned=3>', 'hostile: the label is not shown as text');
  check((await page.locator('.panel a[href^="javascript"]').count()) === 0, 'hostile: a javascript: link');
  check((await page.locator('body img, .panel script').count()) === 0, 'hostile: markup from the YAML became elements');
  check((await page.evaluate(() => window.pwned)) === undefined, 'hostile: something from the YAML ran');
  check((await page.title()).startsWith('</script>'), 'hostile: the title is not the text');
  await done();
}

await browser.close();
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : `all html export steps ok (${out})`);
process.exitCode = problems.length ? 1 : 0;
