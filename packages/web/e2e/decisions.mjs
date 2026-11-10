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
// The browser's private file system stands in for a picked folder, as in workspace.mjs.
{
  const ws = path.join(root, 'examples/workspace');
  const files = Object.fromEntries(fs.readdirSync(ws).filter((f) => f.endsWith('.yaml')).map((f) => [f, fs.readFileSync(path.join(ws, f), 'utf8')]));
  for (const f of fs.readdirSync(path.join(ws, 'decisions'))) files[`decisions/${f}`] = fs.readFileSync(path.join(ws, 'decisions', f), 'utf8');
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
      let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('harbour');
      const parts = name.split('/');
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
      try {
        return await (await (await d.getFileHandle(parts.at(-1))).getFile()).text();
      } catch {
        return undefined;
      }
    }, name);
  const settle = () => page.waitForTimeout(500);
  const selectedId = () => page.locator('.statusbar .status-selected').last().innerText();
  const canvasKey = async (key) => {
    await page.focus('.preview');
    await page.keyboard.press(key);
  };

  await page.goto(URL);
  await page.evaluate(async (files) => {
    localStorage.clear();
    localStorage.setItem('cartography:started', 'true');
    localStorage.setItem('cartography:hinted', 'true');
    const opfs = await navigator.storage.getDirectory();
    for await (const [name] of opfs.entries()) await opfs.removeEntry(name, { recursive: true });
    const root = await opfs.getDirectoryHandle('harbour', { create: true });
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
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('harbour');
  });
  await page.click('button:has-text("Open folder")');
  await page.waitForSelector('.files .file');
  await settle();

  await step('open the payments view with the engine selected', async () => {
    await page.keyboard.press('Meta+p');
    await page.waitForSelector('.ws-search');
    await page.keyboard.type('settlement engine');
    await page.waitForTimeout(150);
    await page.keyboard.press('Alt+Enter');
    await page.waitForFunction(() => document.querySelector('.files .file.active')?.textContent?.trim() === 'containers.yaml');
    await settle();
    check((await selectedId()) === 'payments.engine', `editor: the engine is selected (${await selectedId()})`);
  });

  await step('where used lists the decisions about it', async () => {
    await page.waitForSelector('.where-used');
    const rows = await page.locator('.where-used .where-row').allInnerTexts();
    check(rows.some((r) => r.includes('The gateway calls the settlement engine synchronously')), `editor: where used names decision 2 (${rows.join(' / ')})`);
  });

  await step('the panel, opened on the selection', async () => {
    await canvasKey('Shift+D');
    await page.waitForSelector('.decisions-panel');
    check(await page.locator('.decisions-panel .chip.active:has-text("About")').isVisible(), 'editor: opened with the selection, it shows the decisions about it');
    const rows = await page.locator('.decision-row').count();
    check(rows === 2, `editor: two decisions about the engine, one on a line it is an end of (got ${rows})`);
    const markers = await page.locator('.decision-marker').count();
    check(markers >= 4, `editor: markers on the drawing while the panel is open (got ${markers})`);
    await page.screenshot({ path: path.join(out, 'editor-1-panel.png') });
    await page.click('.decisions-panel .chip:has-text("About")');
    check((await page.locator('.decision-row').count()) === 4, 'editor: all four without the selection filter');
    await page.click('.decisions-panel [role="radio"]:has-text("History")');
    check((await page.locator('.decision-row').count()) === 1, 'editor: History lists the superseded one');
    await page.click('.decisions-panel [role="radio"]:has-text("All")');
  });

  await step('a marker opens its decision; a concern selects what it is about', async () => {
    // The first of its markers may sit under the minimap: the marker's own click, as a reader's tap.
    await page.locator('.decision-marker[data-decision="3"]').first().dispatchEvent('click');
    await page.waitForSelector('[data-decision-open="3"]');
    check((await page.locator('.decision-title').innerText()).includes('Payment events on Kafka'), 'editor: marker 3 opens decision 3');
    check((await page.locator('.decision-open .adr-text h3').count()) >= 3, 'editor: the preview has its sections');
    await page.screenshot({ path: path.join(out, 'editor-2-decision.png') });
    await page.click('.decision-concern button:has-text("Payment events")');
    await settle();
    check((await selectedId()) === 'payments.events', `editor: the concern selects the element (${await selectedId()})`);
  });

  await step('status, written to the file', async () => {
    await page.click('.decision-back');
    await page.click('.decision-row:has-text("read replica")');
    await page.selectOption('.decision-status select', 'accepted');
    await settle();
    check((await disk('decisions/0004-read-balances-from-a-ledger-replica.md'))?.includes('status: accepted'), 'editor: the status is written to the file');
  });

  await step('new decision about the selection', async () => {
    // Selected by search (⌥↵ only selects), as a keyboard user does; the panel stays open.
    await page.keyboard.press('Meta+p');
    await page.waitForSelector('.ws-search');
    await page.keyboard.type('settlement engine');
    await page.waitForTimeout(150);
    await page.keyboard.press('Alt+Enter');
    await settle();
    check((await selectedId()) === 'payments.engine', `editor: the engine is selected again (${await selectedId()})`);
    await canvasKey('Alt+Shift+D');
    await page.waitForSelector('#decision-title');
    check((await page.locator('.decision-new .decision-concern').allInnerTexts()).join() === 'Settlement engine', 'editor: the new decision is about the selection');
    await page.keyboard.type('Run the settlement engine on AKS');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-decision-open="5"]');
    const text = await disk('decisions/0005-run-the-settlement-engine-on-aks.md');
    check(text?.includes('concerns: [payments.engine]') && text.includes('status: proposed') && text.includes('## Consequences'), 'editor: 0005 written from the template, about the engine');
  });

  await step('edit the markdown', async () => {
    await page.click('.decision-mode [role="radio"]:has-text("Markdown")');
    await page.waitForSelector('.decision-source');
    await page.locator('.decision-source').evaluate((t) => (t.focus(), t.setSelectionRange(t.value.length, t.value.length)));
    await page.keyboard.type('\n- One more cluster to run.\n');
    await page.screenshot({ path: path.join(out, 'editor-3-markdown.png') });
    await page.keyboard.press('Meta+s');
    await settle();
    const saved = await disk('decisions/0005-run-the-settlement-engine-on-aks.md');
    check(saved?.startsWith('---\nstatus: proposed') && saved.trimEnd().endsWith('- One more cluster to run.'), `editor: ⌘S writes the markdown (${JSON.stringify(saved?.slice(0, 40))} … ${JSON.stringify(saved?.slice(-60))})`);
  });

  await step('supersede', async () => {
    await page.click('.decision-back');
    await page.click('.decision-row:has-text("Payment events on Kafka")');
    await page.click('.decision-open .note-actions button:has-text("Supersede…")');
    await page.waitForSelector('#decision-title');
    await page.keyboard.type('Payment events on Azure Service Bus');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-decision-open="6"]');
    const neu = await disk('decisions/0006-payment-events-on-azure-service-bus.md');
    check(neu?.includes('supersedes: 3') && neu.includes('payments.events'), 'editor: the new one supersedes 3, about what 3 was about');
    const old = await disk('decisions/0003-kafka-for-payment-events.md');
    check(old?.includes('status: superseded') && old.includes('superseded-by: 6'), 'editor: 3 is marked superseded by 6');
    // Unlink one of its concerns.
    const before = await page.locator('.decision-open .decision-concern').count();
    await page.locator('.decision-open .decision-unlink').first().click();
    await settle();
    check((await page.locator('.decision-open .decision-concern').count()) === before - 1, 'editor: unlink removes a concern');
    check(!(await disk('decisions/0006-payment-events-on-azure-service-bus.md'))?.includes('concerns: [payments.events,'), 'editor: the unlink is written');
    await page.screenshot({ path: path.join(out, 'editor-4-superseded.png') });
  });

  await step('search finds decisions', async () => {
    await canvasKey('Escape');
    await page.keyboard.press('Meta+p');
    await page.waitForSelector('.ws-search');
    await page.keyboard.type('read replica');
    await page.waitForTimeout(150);
    const first = await page.locator('.ws-hit').first().innerText();
    check(first.includes('4. Read balances from a read replica'), `editor: search finds decision 4 (${first.split('\n')[0]})`);
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-decision-open="4"]');
  });

  // Without a folder: kept in this browser, with a download.
  await step('without a folder', async () => {
    const p2 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await p2.goto(URL);
    await p2.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('cartography:started', 'true');
      localStorage.setItem('cartography:hinted', 'true');
    });
    await p2.reload();
    await p2.waitForSelector('.drawing [data-node]');
    const first = p2.locator('.drawing [data-node]').first();
    const id = await first.getAttribute('data-node');
    await first.click();
    await p2.focus('.preview');
    await p2.keyboard.press('Alt+Shift+D');
    await p2.waitForSelector('#decision-title');
    await p2.keyboard.type('Keep it simple');
    await p2.keyboard.press('Enter');
    await p2.waitForSelector('[data-decision-open="1"]');
    const kept = await p2.evaluate(() => localStorage.getItem('cartography:decisions'));
    check(kept?.includes('decisions/0001-keep-it-simple.md') && kept.includes(`concerns: [${id}]`), `editor: without a folder the decision is kept in this browser (${kept?.slice(0, 80)})`);
    check(await p2.locator('.decision-open button:has-text("Download")').isVisible(), 'editor: without a folder a decision can be downloaded');
    check((await p2.locator('.decision-marker').count()) === 1, 'editor: its marker is on the drawing');
    await p2.screenshot({ path: path.join(out, 'editor-5-browser.png') });
    await p2.close();
  });

  await page.close();
}

await browser.close();
if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log(`decisions: all checks passed; screenshots in ${out}`);
