// Architecture decisions: `carto export-html --decisions` (markers, details, the Decisions page) and
// the editor's Decisions panel (list, filter, open, edit, new about the selection, supersede, jump).
// node packages/web/e2e/decisions.mjs <out-folder>   (CARTO_URL: the web app, default http://localhost:5178/)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const out = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'carto-decisions-')));
fs.mkdirSync(out, { recursive: true });
const URL = process.env.CARTO_URL ?? 'http://localhost:5178/';
const problems = [];
const fail = (m) => problems.push(m);
const check = (ok, m) => ok || fail(m);
const tsx = path.join(root, 'node_modules/tsx/dist/cli.mjs');
const carto = (...args) => execFileSync(process.execPath, [tsx, 'packages/cli/src/main.ts', ...args], { cwd: root, encoding: 'utf8' });

const browser = await chromium.launch();

// ---------------------------------------------------------------- interactive HTML
{
  const file = path.join(out, 'workspace-decisions.html');
  carto('export-html', 'examples/workspace', '--decisions', '-o', file);
  const plain = path.join(out, 'workspace-plain.html');
  carto('export-html', 'examples/workspace', '-o', plain);
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.route(/^(?!file:)/, (r) => (fail(`asked the network for ${r.request().url()}`), r.abort()));
  await page.goto(`file://${plain}#contents`);
  await page.waitForSelector('body[data-ready]');
  check((await page.locator('.side a[href="#decisions"]').count()) === 0, 'html: without --decisions there is no Decisions page');

  await page.goto(`file://${file}#contents`);
  await page.waitForSelector('body[data-ready]');
  await page.click('.side a[href="#decisions"]');
  await page.waitForSelector('.adr table.index');
  const rows = await page.locator('.adr table.index tbody tr').count();
  check(rows === 4, `html: the Decisions page lists 4 decisions (got ${rows})`);
  check((await page.locator('.adr .adr-status.superseded').textContent()) === 'Superseded by 3', 'html: decision 2 says it was superseded by 3');
  await page.screenshot({ path: path.join(out, 'html-decisions.png') });
  await page.click('.adr a[href="#decision-3"]');
  await page.waitForSelector('.adr-text');
  check((await page.locator('.adr h1').textContent())?.startsWith('3. Payment events on Kafka'), 'html: a decision opens on its own page');
  check((await page.locator('.adr-text h2').count()) >= 3, 'html: its sections are headings');
  await page.screenshot({ path: path.join(out, 'html-decision.png') });
  // From the decision to a drawing it is on, and the marker there back to the decision.
  await page.click('.adr-where a >> nth=0');
  await page.waitForSelector('.sheet svg [data-decision]');
  const markers = await page.locator('.sheet svg [data-decision]').count();
  check(markers > 0, 'html: the drawing carries decision markers');
  check(await page.locator('.panel.open').isVisible(), 'html: the element the decision is about is selected, with its details');
  check((await page.locator('.panel a[href^="#decision-"]').count()) > 0, 'html: the details list the decisions about the element');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, 'html-details.png') });
  await page.locator('.sheet svg [data-decision="3"]').first().click();
  await page.waitForFunction(() => location.hash === '#decision-3');
  await page.close();
}

// ---------------------------------------------------------------- the editor
if (!process.env.CARTO_NO_EDITOR) {
  const { editor } = await import('./decisions-editor.mjs');
  await editor({ browser, url: URL, out, root, check, fail });
}

await browser.close();
if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log(`decisions: all checks passed; screenshots in ${out}`);
