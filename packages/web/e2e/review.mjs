// Architecture review: `carto review -o report.html` (summary, drawing with flags, a crop per finding)
// and the editor's Review tab (findings, flags on the drawing, filter, select, ignore with a reason,
// turn into a decision), with a folder's .cartography/rules.yaml.
// node packages/web/e2e/review.mjs <out-folder>   (CARTO_URL: the web app, default http://localhost:5178/)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const out = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'carto-review-')));
fs.mkdirSync(out, { recursive: true });
const URL = process.env.CARTO_URL ?? 'http://localhost:5178/';
const problems = [];
const fail = (m) => problems.push(m);
const check = (ok, m) => ok || fail(m);
const tsx = path.join(root, 'node_modules/tsx/dist/cli.mjs');
const carto = (...args) => {
  try {
    return execFileSync(process.execPath, [tsx, 'packages/cli/src/main.ts', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return e.stdout ?? '';
  }
};

const browser = await chromium.launch();

// ---------------------------------------------------------------- the HTML report
for (const scheme of ['light', 'dark']) {
  const file = path.join(out, 'report.html');
  if (scheme === 'light') carto('review', 'examples/azure/microservices.yaml', 'examples/kubernetes/web-app.yaml', '-o', file);
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, colorScheme: scheme });
  await page.route(/^(?!file:)/, (r) => (fail(`report: asked the network for ${r.request().url()}`), r.abort()));
  await page.goto(`file://${file}`);
  check((await page.locator('.tile').count()) === 3, 'report: three severity tiles');
  check((await page.locator('table.pillars tbody tr').count()) === 5, 'report: a row per pillar');
  check((await page.locator('.sheet svg [data-review]').count()) >= 3, 'report: the drawing carries the flags');
  check((await page.locator('.finding .crop svg use').count()) >= 3, 'report: findings about an element show a crop of it');
  const crop = await page.locator('.finding .crop svg').first().boundingBox();
  check(crop && crop.height > 40, 'report: the crop is drawn');
  await page.screenshot({ path: path.join(out, `report-${scheme}.png`), fullPage: true });
  await page.close();
}

// ---------------------------------------------------------------- the editor
const shop = fs.readFileSync(path.join(root, 'examples/azure/microservices.yaml'), 'utf8');
const files = {
  'shop.yaml': shop,
  '.cartography/rules.yaml': `rules:
  azure.prod-single-region: info
custom:
  - id: acme.data-tagged
    title: Data stores carry a data tag
    category: operations
    every: { kind: [cosmos-db, sql-database] }
    must: { tag: data }
`,
  'decisions/0001-use-container-apps.md': '---\nstatus: accepted\ndate: 2026-01-01\n---\n\n# Use Container Apps\n\nBecause.\n',
};
{
  const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => fail(`editor: ${e.message}`));
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      fail(`${name}: ${e.message.split('\n').slice(0, 8).join(' | ')}`);
    }
  };
  const disk = (name) =>
    page.evaluate(async (name) => {
      let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('shop');
      const parts = name.split('/');
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
      try {
        return await (await (await d.getFileHandle(parts.at(-1))).getFile()).text();
      } catch {
        return undefined;
      }
    }, name);
  const yaml = () => page.locator('.cm-content').innerText();
  const settle = () => page.waitForTimeout(500);

  await page.goto(URL);
  await page.evaluate(async (files) => {
    localStorage.clear();
    localStorage.setItem('cartography:started', 'true');
    localStorage.setItem('cartography:hinted', 'true');
    const opfs = await navigator.storage.getDirectory();
    for await (const [name] of opfs.entries()) await opfs.removeEntry(name, { recursive: true });
    const root = await opfs.getDirectoryHandle('shop', { create: true });
    for (const [p, text] of Object.entries(files)) {
      let d = root;
      const parts = p.split('/');
      for (const seg of parts.slice(0, -1)) d = await d.getDirectoryHandle(seg, { create: true });
      const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
      await w.write(text);
      await w.close();
    }
  }, files);
  await page.reload();
  await page.evaluate(() => {
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('shop');
  });
  await page.click('button:has-text("Open folder")');
  await page.waitForSelector('.files .file');
  await page.click('.files .file:has-text("shop.yaml")');
  await page.waitForSelector('.preview svg');
  await settle();

  await step('⇧W opens the Review tab with the findings and flags them on the drawing', async () => {
    await page.focus('.preview');
    await page.keyboard.press('Shift+W');
    await page.waitForSelector('.review-panel');
    const rows = await page.locator('.finding-row').count();
    check(rows >= 4, `editor: the microservices example has its findings and the custom rule's (got ${rows})`);
    check((await page.locator('.finding-row:has-text("Data stores carry a data tag")').count()) === 2, 'editor: the folder\'s custom rule runs');
    check((await page.locator('.finding-row.info:has-text("Production survives")').count()) === 1, 'editor: rules.yaml turned the region rule into info');
    check((await page.locator('.review-marker').count()) >= 3, 'editor: flags on the drawing while the tab is open');
    check((await page.locator('.side-tabs [role="tab"][aria-selected="true"]').innerText()).includes('Review'), 'editor: the Review tab is selected');
    await page.screenshot({ path: path.join(out, 'editor-1-review.png') });
  });

  await step('filter by severity and pillar', async () => {
    await page.click('.review-panel .segmented button:has-text("Info")');
    check((await page.locator('.finding-row').count()) === 1, 'editor: Info shows the one info finding');
    await page.click('.review-panel .segmented button:has-text("All")');
    await page.click('.review-panel .chip:has-text("Security")');
    const sec = await page.locator('.finding-row').allInnerTexts();
    check(sec.length >= 2 && sec.every((t) => t.includes('Security')), 'editor: the Security chip keeps the security findings');
    await page.click('.review-panel .chip:has-text("Security")');
  });

  await step('a finding selects what it is about, and says why and how to fix it', async () => {
    await page.click('.finding-row:has-text("Inventory connects") .finding-main');
    await settle();
    check((await page.locator('.finding-row.active .finding-detail').innerText()).toLowerCase().includes('fix'), 'editor: the open finding says its fix');
    check((await page.locator('.statusbar .status-selected').last().innerText()).includes('stock'), 'editor: Inventory is selected');
    check((await page.locator('.review-marker.active').count()) === 1, 'editor: its flag is marked');
    await page.screenshot({ path: path.join(out, 'editor-2-finding.png') });
  });

  await step('ignore with a reason writes it on the element', async () => {
    const before = await page.locator('.finding-row').count();
    await page.click('.finding-row:has-text("Inventory connects") button:has-text("Ignore")');
    await page.fill('.finding-ignore input', 'Inventory uses its managed identity');
    await page.keyboard.press('Enter');
    await settle();
    check((await yaml()).includes('reason: Inventory uses its managed identity'), 'editor: the reason is in the YAML');
    check((await page.locator('.finding-row').count()) === before - 1, 'editor: the finding left the list');
    await page.click('.review-aside .note-go');
    check((await page.locator('.review-aside-row').innerText()).includes('managed identity'), 'editor: set aside, with its reason');
  });

  await step('turn a finding into a decision', async () => {
    await page.click('.finding-row:has-text("Public API is reached") button:has-text("Decision")');
    await page.waitForSelector('.decision-new');
    const title = await page.inputValue('#decision-title');
    check(title.startsWith('Public endpoints sit behind a WAF'), `editor: the decision is named after the rule (${title})`);
    await page.screenshot({ path: path.join(out, 'editor-3-decision.png') });
    await page.click('.decision-new button:has-text("Create")');
    await settle();
    const written = await disk('decisions/0002-public-endpoints-sit-behind-a-waf-customers-public-api.md');
    check(written?.includes('The architecture review found: Public API is reached from Customers'), `editor: the decision starts from the finding (${written?.slice(0, 80)})`);
  });

  await step('the tab keys: ⇧W again closes it and the flags go', async () => {
    await page.focus('.preview');
    await page.keyboard.press('Shift+W');
    await page.waitForSelector('.review-panel');
    await page.focus('.preview');
    await page.keyboard.press('Shift+W');
    await page.waitForSelector('.review-panel', { state: 'detached' });
    check((await page.locator('.review-marker').count()) === 0, 'editor: no flags with the tab closed');
  });
  await page.close();
}

await browser.close();
if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log(`review e2e ok → ${out}`);
