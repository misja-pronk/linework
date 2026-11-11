// carto serve with a real browser and a real MCP client: the editor opens the folder, get_context
// sees the selection, a proposal shows and Accept applies it as one undo step, and a file the agent
// writes comes into the editor marked, with ⌘Z taking it back. Needs pnpm web:build first.
// node packages/web/e2e/serve.mjs [out-dir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const repo = path.resolve(import.meta.dirname, '../../..');
const out = process.argv[2];
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-serve-e2e-'));
fs.copyFileSync(path.join(repo, 'examples/azure/web-shop.yaml'), path.join(folder, 'web-shop.yaml'));
const file = path.join(fs.realpathSync(folder), 'web-shop.yaml');
const port = String(4400 + Math.floor(Math.random() * 500));

const server = spawn(path.join(repo, 'node_modules/.bin/tsx'), [path.join(repo, 'packages/cli/src/main.ts'), 'serve', folder, '--port', port], { stdio: ['ignore', 'pipe', 'inherit'] });
let printed = '';
await new Promise((ok, fail) => {
  server.stdout.on('data', (d) => ((printed += d), /Bearer ([\w-]+)/.test(printed) && ok()));
  server.on('exit', (c) => fail(new Error(`carto serve exited ${c}`)));
});
const token = /Bearer ([\w-]+)/.exec(printed)[1];
const url = `http://127.0.0.1:${port}`;

const problems = [];
const fail = (m) => problems.push(m);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => fail(e.message));
const yaml = () => page.evaluate(() => document.querySelector('.cm-content').innerText);

const agent = new Client({ name: 'e2e', version: '0' });
try {
  await page.goto(`${url}/`);
  await page.waitForSelector('.files .file');
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('Web shop'));
  if (!printed.includes(`claude mcp add --transport http cartography ${url}/mcp`)) fail('no claude mcp add line');
  await agent.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  const text = (r) => r.content.map((c) => c.text ?? '').join('\n');

  // Select a node in the drawing; the agent sees it.
  await page.waitForSelector('.drawing [data-node="api"]');
  await page.click('.drawing [data-node="api"]');
  const ctx = text(await agent.callTool({ name: 'get_context', arguments: {} }));
  if (!ctx.includes(file)) fail(`get_context: no file in ${ctx}`);
  if (!ctx.includes('selected: api')) fail(`get_context: no selection in ${ctx}`);

  // A proposal: marked in the panel, accepted with ⏎, one undo step.
  const proposing = agent.callTool({ name: 'propose', arguments: { file, summary: 'Add a cache', edits: [{ op: 'set', path: ['nodes', 'cache'], value: { kind: 'redis', label: 'Cache', in: 'data' } }, { op: 'append', path: ['edges'], value: 'api -> cache: reads' }] } });
  await page.waitForSelector('.ask-panel .proposal');
  if (!(await page.locator('.ask-panel .proposal-summary').first().innerText()).includes('Add a cache')) fail('proposal summary');
  if (!(await page.locator('.ask-panel .proposal-count').innerText().catch(() => '')).length) fail('no diff count');
  if (out) await page.screenshot({ path: path.join(out, 'serve-proposal.png') });
  await page.locator('.ask-panel .proposal').focus();
  await page.keyboard.press('Enter');
  const verdict = text(await proposing);
  if (!/Accepted/.test(verdict)) fail(`propose: ${verdict}`);
  if (!(await yaml()).includes('cache: { kind: redis, label: Cache, in: data }')) fail('accepted change not in the editor');
  await page.click('.drawing', { position: { x: 8, y: 8 } });
  await page.keyboard.press('ControlOrMeta+z');
  // The editor draws only the lines in view, so look for what the proposal added.
  const undone = await yaml();
  if (undone.includes('cache') || !undone.includes('Web shop')) fail('⌘Z did not take the whole proposal back');
  await page.keyboard.press('ControlOrMeta+Shift+z');

  // Rejected: the agent hears it, nothing changes.
  const rejecting = agent.callTool({ name: 'propose', arguments: { file, edits: [{ op: 'delete', path: ['nodes', 'vault'] }] } });
  await page.waitForSelector('.ask-panel .proposal');
  await page.locator('.ask-panel .proposal').focus();
  await page.keyboard.press('Escape');
  if (!/Rejected/.test(text(await rejecting))) fail('reject not heard');
  if (!(await yaml()).includes('vault:')) fail('rejected change applied');

  // Save, then the agent writes the file: it comes in marked, ⌘Z undoes it.
  await page.click('.drawing', { position: { x: 8, y: 8 } });
  await page.keyboard.press('ControlOrMeta+s');
  await page.waitForFunction(() => !document.querySelector('.dirty, [data-dirty="true"]'), null, { timeout: 3000 }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 500));
  const e = text(await agent.callTool({ name: 'edit_diagram', arguments: { file, edits: [{ op: 'set', path: ['nodes', 'web', 'label'], value: 'Storefront' }] } }));
  if (!/^Wrote /.test(e)) fail(`edit_diagram: ${e}`);
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText.includes('label: Storefront'), null, { timeout: 5000 }).catch(() => fail('disk change did not come in'));
  if (!(await page.locator('.ask-panel').innerText()).includes('changed on disk')) fail('disk change not shown in the panel');
  if (out) await page.screenshot({ path: path.join(out, 'serve-disk-change.png') });
  await page.click('.drawing', { position: { x: 8, y: 8 } });
  await page.keyboard.press('ControlOrMeta+z');
  if ((await yaml()).includes('Storefront')) fail('⌘Z did not take the disk change back');

  // A proposal for another file of the folder, one the agent just wrote: the editor opens it and
  // shows the proposal there. A file outside the folder: not-open.
  const billing = path.join(path.dirname(file), 'billing.yaml');
  fs.writeFileSync(billing, 'type: systems\ntitle: Billing\nnodes:\n  billing: { kind: service, label: Billing }\n  ledger: { kind: database, label: Ledger }\nedges:\n  - billing -> ledger\n');
  const proposingOther = agent.callTool({ name: 'propose', arguments: { file: billing, summary: 'Add invoices', edits: [{ op: 'set', path: ['nodes', 'invoices'], value: { kind: 'queue', label: 'Invoices' } }] } });
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('title: Billing'), null, { timeout: 10000 }).catch(() => fail('propose for a file that is not open: it did not open'));
  await page.waitForSelector('.ask-panel .proposal', { timeout: 10000 }).catch(() => fail('propose for a file that is not open: no proposal'));
  if (!(await page.locator('.ask-panel .proposal-summary').first().innerText().catch(() => '')).includes('Add invoices')) fail('propose for a file that is not open: wrong summary');
  if (out) await page.screenshot({ path: path.join(out, 'serve-proposal-opened.png') });
  await page.locator('.ask-panel .proposal').focus();
  await page.keyboard.press('Enter');
  const otherVerdict = text(await proposingOther);
  if (!/Accepted/.test(otherVerdict)) fail(`propose for a file that is not open: ${otherVerdict}`);
  if (!(await yaml()).includes('invoices: { kind: queue, label: Invoices }')) fail('propose for a file that is not open: not applied');
  const outside = path.join(os.tmpdir(), `carto-outside-${process.pid}.yaml`);
  fs.copyFileSync(billing, outside);
  const notOpen = text(await agent.callTool({ name: 'propose', arguments: { file: outside, edits: [{ op: 'delete', path: ['nodes', 'ledger'] }] } }));
  fs.rmSync(outside, { force: true });
  if (!/not-open/.test(notOpen)) fail(`propose outside the folder: ${notOpen}`);
} catch (e) {
  fail(String(e?.stack ?? e));
} finally {
  await agent.close().catch(() => undefined);
  await browser.close();
  server.kill();
  fs.rmSync(folder, { recursive: true, force: true });
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('carto serve e2e: ok');
