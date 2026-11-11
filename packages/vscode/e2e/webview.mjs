// The built extension without VS Code (none is downloaded): dist/extension.js activated against the
// stubbed `vscode` module, then the preview page it makes opened in Chromium with a stubbed
// acquireVsCodeApi, fed the extension's real messages, clicked, dragged, zoomed and screenshotted.
// Usage: node e2e/webview.mjs [screenshot folder]   (build first: pnpm --filter @cartography/vscode build)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const here = path.resolve(import.meta.dirname, '..');
const out = path.resolve(process.argv[2] ?? path.join(here, 'e2e/out'));
fs.mkdirSync(out, { recursive: true });
const dist = path.join(here, 'dist');
if (!fs.existsSync(path.join(dist, 'extension.js'))) throw new Error('Build first: pnpm --filter @cartography/vscode build');
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

// The stub, as CommonJS, answering require('vscode') for the bundle.
// The real path: require caches by it, and a second copy of the stub would see nothing.
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'carto-vscode-e2e-')));
const stubFile = path.join(tmp, 'vscode-stub.cjs');
await build({ entryPoints: [path.join(here, 'test/vscode-stub.ts')], bundle: true, format: 'cjs', platform: 'node', outfile: stubFile, logLevel: 'warning' });
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return request === 'vscode' ? stubFile : resolve.call(this, request, ...rest);
};
const require = createRequire(import.meta.url);
const stub = require(stubFile);
stub.state.config['cartography.preview.debounce'] = 0;
// The folder the live link announces (live.ts), for an agent to find.
stub.workspace.workspaceFolders = [{ uri: stub.Uri.file(path.join(tmp, 'work')) }];
const ext = require(path.join(dist, 'extension.js'));
const api = ext.activate({ subscriptions: [], extensionUri: stub.Uri.file(here) });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** MCP over stdio, as an agent speaks it: one JSON-RPC message per line. */
function mcpClient(child) {
  const waiting = new Map();
  let buf = '';
  let id = 0;
  child.stdout.on('data', (d) => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
      const m = JSON.parse(buf.slice(0, i));
      waiting.get(m.id)?.(m);
    }
  });
  child.stderr.on('data', () => {});
  const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  const rpc = (method, params = {}) =>
    new Promise((ok) => {
      const n = ++id;
      waiting.set(n, ok);
      send({ id: n, method, params });
    });
  return {
    rpc,
    notify: (method) => send({ method }),
    /** A tool call's text. */
    tool: async (name, args) => ((await rpc('tools/call', { name, arguments: args })).result?.content ?? []).map((c) => c.text ?? '').join('\n'),
    close: () => child.kill(),
  };
}
async function until(f, ms = 20_000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await wait(25);
  }
}

// A diagram with a view and steps, next to the files it would read.
const work = path.join(tmp, 'work');
fs.mkdirSync(work);
const file = path.join(work, 'shop.yaml');
const text = `type: systems
title: Web shop
subtitle: How an order flows through the system
groups:
  shop: { kind: system, label: Web shop }
  backend: { kind: zone, label: Private network, in: shop }
nodes:
  customers: users
  web: { kind: client, label: Storefront, in: shop }
  gateway: { kind: gateway, label: API gateway, in: shop }
  orders: { kind: service, label: Orders, in: backend }
  db: { kind: database, label: Orders DB, in: backend }
  stripe: { kind: payments, label: Stripe }
edges:
  - customers -> web: HTTPS
  - web -> gateway: { label: REST, style: sync }
  - gateway -> orders: { style: sync }
  - orders -> db: { label: SQL, style: data }
  - orders -> stripe: { label: charge, style: sync }
steps:
  - title: The order
    caption: A customer orders in the storefront
    show: [customers, web]
  - title: Payment
    caption: Orders charges the card through Stripe
    focus: [orders, stripe]
`;
fs.writeFileSync(file, text);

// 1. The bundle: problems for a broken document, as the CLI words them.
const broken = stub.openDocument(path.join(work, 'broken.yaml'), 'type: systems\nnodes:\n  a: { kind: apii }\n');
const collection = stub.state.collections.find((c) => c.name === 'cartography');
const problems = await until(() => collection.get(broken.uri)?.length && collection.get(broken.uri));
// The words of core's source.ts (as carto validate prints them): the value, the nearest kind, a few allowed.
check(problems.some((d) => d.message.startsWith('"kind" cannot be "apii": did you mean api?') && d.range.start.line === 2 && d.range.start.character === 7), 'bundle: problems at the right line, in the CLI words');

// 3. The preview page in Chromium, with what the extension posts.
const doc = stub.openDocument(file, text);
stub.window.activeTextEditor = { document: doc, selections: [] };
await stub.commands.executeCommand('cartography.showPreview');
const panel = await until(() => stub.state.panels.find((p) => p.viewType === 'cartography.preview'));
fs.copyFileSync(path.join(dist, 'webview.js'), path.join(tmp, 'webview.js'));
// VS Code's theme variables, as a light theme sets them.
const vars = `<style>:root{--vscode-font-family:-apple-system,system-ui,sans-serif;--vscode-editor-background:#fff;--vscode-foreground:#3b3b3b;--vscode-focusBorder:#005fb8;--vscode-button-secondaryBackground:#e5e5e5;--vscode-badge-background:#cce;--vscode-widget-border:#ddd;--vscode-editorWidget-background:#f8f8f8;--vscode-dropdown-background:#fff;--vscode-dropdown-border:#ccc}</style>`;
const browser = await chromium.launch();
const errors = [];

/** A panel's page in a tab, with acquireVsCodeApi stubbed: what the page says goes to the panel, what the extension posts goes to the page. */
async function openPage(panel, name, viewport) {
  const html = panel.webview.html.replace(/src="[^"]*webview\.js"/, 'src="webview.js"');
  const nonce = /nonce-([A-Za-z0-9]+)/.exec(html)[1];
  const stubApi = `<script nonce="${nonce}">window.__sent = []; window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__sent.push(m), getState: () => window.__state, setState: (s) => (window.__state = s) });</script>`;
  const file = path.join(tmp, `${name}.html`);
  fs.writeFileSync(file, html.replace('<head>', `<head>${vars}`).replace('<style>', stubApi + '<style>'));
  const tab = await browser.newPage({ viewport });
  tab.on('pageerror', (e) => errors.push(e.message));
  tab.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await tab.goto(`file://${file}`);
  const pump = async () => {
    const sent = await tab.evaluate(() => window.__sent.splice(0));
    for (const m of sent) panel.received.fire(m);
    const posted = panel.posted.splice(0);
    for (const m of posted) await tab.evaluate((m) => window.postMessage(m, '*'), m);
    return { sent, posted };
  };
  return { tab, pump, pumpUntil: (f) => until(async () => (await pump(), f())) };
}

const { tab, pump, pumpUntil } = await openPage(panel, 'preview', { width: 1100, height: 720 });
await pumpUntil(async () => (await tab.$('#paper svg')) !== null);
await tab.waitForTimeout(300);
check(errors.length === 0, `no errors in the page${errors.length ? `: ${errors.join('; ')}` : ''}`);
check((await tab.$$eval('#paper [data-node]', (els) => els.length)) === 6, 'all six nodes drawn');
check(await tab.evaluate(() => !!document.getElementById('carto-fonts')?.textContent?.includes('@font-face')), 'font faces put in the page once');
check(await tab.$eval('#steps', (el) => !el.hidden), 'steps shown in the toolbar');
await tab.screenshot({ path: path.join(out, 'preview.png') });

// Click → reveal.
await tab.click('#paper [data-node="orders"]');
const { sent } = await pump();
check(sent.some((m) => m.type === 'reveal' && m.id === 'orders'), 'click on a node asks to reveal its YAML');
check(await tab.$eval('#paper [data-node="orders"]', (el) => el.classList.contains('carto-hl')), 'the clicked node is lit up');

// Cursor in the YAML → highlight.
const at = text.indexOf('db: {') + 2;
const before = text.slice(0, at).split('\n');
const pos = new stub.Position(before.length - 1, before[before.length - 1].length);
const editor = { document: doc, selections: [new stub.Selection(pos, pos)] };
stub.window.visibleTextEditors = [editor];
stub.fireSelection({ textEditor: editor });
await pump();
await tab.waitForTimeout(50);
check(await tab.$eval('#paper [data-node="db"]', (el) => el.classList.contains('carto-hl')), 'the cursor in the YAML lights up its node');

// Zoom, then an edit: the zoom stays.
await tab.click('#in');
await tab.click('#in');
const zoomed = await tab.$eval('#paper', (el) => el.style.transform);
const edited = text.replace('label: Orders DB', 'label: Orders database');
// The edit, as VS Code fires it.
stub.changeDocument(doc, edited);
await pumpUntil(async () => (await tab.$eval('#paper', (el) => el.textContent)).includes('Orders database'));
check((await tab.$eval('#paper', (el) => el.style.transform)) === zoomed, 'an edit redraws and keeps zoom and pan');
await tab.click('#fit');

// Drag a node → the sidecar.
const box = await tab.$eval('#paper [data-node="stripe"]', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await tab.mouse.move(box.x, box.y);
await tab.mouse.down();
await tab.mouse.move(box.x + 60, box.y + 80, { steps: 6 });
await tab.mouse.up();
await pump();
const sidecar = path.join(work, 'shop.layout.json');
const pins = await until(() => fs.existsSync(sidecar) && JSON.parse(fs.readFileSync(sidecar, 'utf8')));
check(!!pins.nodes?.stripe, `dragging a node writes its pin to shop.layout.json (${JSON.stringify(pins.nodes?.stripe)})`);
await pumpUntil(async () => {
  const p = panel.posted.length;
  return p === 0 && (await tab.$('#paper [data-node="stripe"]')) !== null;
});
await tab.waitForTimeout(200);
await pump();
await tab.screenshot({ path: path.join(out, 'preview-pinned.png') });

// A step.
await tab.click('#next');
await pumpUntil(async () => (await tab.$eval('#stepN', (el) => el.textContent)) === '1 / 2');
await tab.screenshot({ path: path.join(out, 'preview-step.png') });

// Dark: VS Code's dark theme, the diagram without a theme of its own follows.
stub.window.activeColorTheme = { kind: stub.ColorThemeKind.Dark };
panel.received.fire({ type: 'step', n: null });
await pumpUntil(async () => (await tab.evaluate(() => getComputedStyle(document.body).getPropertyValue('--carto-canvas'))).trim() !== '' && (await tab.$eval('#stepN', (el) => el.textContent)) === '2 steps');
await tab.emulateMedia({ colorScheme: 'dark' });
await tab.addStyleTag({ content: ':root{--vscode-editor-background:#1f1f1f;--vscode-foreground:#ccc;--vscode-editorWidget-background:#252526;--vscode-button-secondaryBackground:#313131;--vscode-dropdown-background:#313131}' });
await pump();
await tab.waitForTimeout(200);
const canvas = await tab.evaluate(() => getComputedStyle(document.body).backgroundColor);
check(/rgb\((\d+), (\d+), (\d+)\)/.test(canvas) && Number(canvas.match(/\d+/)[0]) < 80, `dark theme: canvas is dark (${canvas})`);
await tab.screenshot({ path: path.join(out, 'preview-dark.png') });

// Exports: SVG and PowerPoint in the extension, PNG through the page's canvas.
const written = new Map();
stub.workspace.fs.writeFile = async (uri, data) => void written.set(path.extname(uri.fsPath), data);
for (const [cmd, ext] of [['cartography.exportSvg', '.svg'], ['cartography.exportPptx', '.pptx'], ['cartography.exportPng', '.png']]) {
  stub.window.showSaveDialog = async () => stub.Uri.file(path.join(out, `export${ext}`));
  const done = stub.commands.executeCommand(cmd, doc.uri);
  await pumpUntil(() => written.has(ext));
  await done;
  fs.writeFileSync(path.join(out, `export${ext}`), written.get(ext));
}
const svg = Buffer.from(written.get('.svg')).toString('utf8');
check(svg.startsWith('<svg') && svg.includes('@font-face'), 'SVG export with the fonts embedded');
check(Buffer.from(written.get('.pptx')).subarray(0, 2).toString() === 'PK', 'PowerPoint export is a zip');
const png = Buffer.from(written.get('.png'));
check(png.subarray(1, 4).toString() === 'PNG' && png.readUInt32BE(16) > 1000, `PNG export from the page canvas (${png.readUInt32BE(16)}×${png.readUInt32BE(20)})`);

// The live link: the agent finds the extension, asks what is open, and proposes a change over the preview.
const liveDir = path.join(os.tmpdir(), 'cartography-live');
const live = fs.readdirSync(liveDir).map((f) => JSON.parse(fs.readFileSync(path.join(liveDir, f), 'utf8'))).find((e) => e.host === 'vscode' && e.roots.includes(work) && e.pid === process.pid);
check(!!live, 'live: the extension announces itself for the workspace folder');
const call = (body) => fetch(`${live.url}/live`, { method: 'POST', headers: { authorization: `Bearer ${live.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
check((await fetch(`${live.url}/live`, { method: 'POST', body: '{"method":"context"}' })).status === 401, 'live: no token, no answer');
const onOrders = doc.positionAt(doc.getText().indexOf('  orders:') + 2);
stub.window.activeTextEditor = { document: doc, selections: [new stub.Selection(onOrders, onOrders)] };
stub.window.visibleTextEditors = [stub.window.activeTextEditor];
const ctx = (await call({ method: 'context' })).result;
check(ctx?.file === file && ctx.selection.some((s) => s.id === 'orders'), `live: get_context names the file and what the cursor is on (${JSON.stringify(ctx?.selection)})`);
const proposing = call({ method: 'propose', params: { file, summary: 'Add a cache', edits: [{ op: 'set', path: ['nodes', 'cache'], value: { kind: 'service', label: 'Cache', in: 'backend' } }, { op: 'append', path: ['edges'], value: 'orders -> cache: reads' }] } });
await pumpUntil(async () => tab.$eval('#proposal', (el) => !el.hidden));
check((await tab.$eval('#pSummary', (el) => el.textContent)) === 'Add a cache', 'live: the proposal shows over the preview');
check((await tab.$$eval('#pDrawing svg', (els) => els.length)) === 1, 'live: with the marked drawing');
await tab.screenshot({ path: path.join(out, 'proposal.png') });
await tab.keyboard.press('Enter');
await pump();
const verdict = (await proposing).result;
check(verdict?.outcome === 'accepted', `live: Accept answers the agent (${JSON.stringify(verdict)})`);
check(doc.getText().includes('cache: { kind: service, label: Cache, in: backend }') && doc.getText().includes('title: Web shop'), 'live: the change is in the document, the rest as it was');
const rejecting = call({ method: 'propose', params: { file, edits: [{ op: 'delete', path: ['nodes', 'stripe'] }] } });
await pumpUntil(async () => tab.$eval('#proposal', (el) => !el.hidden));
await tab.keyboard.press('Escape');
await pump();
check((await rejecting).result?.outcome === 'rejected' && doc.getText().includes('stripe:'), 'live: Reject leaves the document');

// The MCP server the extension registers with VS Code (mcp.ts), started as VS Code starts it: the
// definition's command, arguments, environment and folder. An agent's calls go through it to the live link.
const [definition] = await stub.state.mcpProviders.get('cartography.mcp').provideMcpServerDefinitions();
check(definition?.cwd?.fsPath === work && definition.args[0] === path.join(dist, 'mcp.mjs'), 'mcp: one server, the bundled one, in the workspace folder');
const mcp = mcpClient(spawn(definition.command, definition.args, { cwd: definition.cwd.fsPath, env: { ...process.env, ...definition.env } }));
const hello = await mcp.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
mcp.notify('notifications/initialized');
check(hello.result?.serverInfo?.name === 'cartography', `mcp: the server starts and answers (${hello.result?.serverInfo?.name ?? hello.error?.message})`);
const names = (await mcp.rpc('tools/list')).result?.tools.map((t) => t.name) ?? [];
check(['get_schema', 'validate', 'edit_diagram', 'get_context', 'propose'].every((n) => names.includes(n)), `mcp: the tools are there (${names.length})`);
const mcpCtx = await mcp.tool('get_context', {});
check(mcpCtx.includes(file) && mcpCtx.includes('orders'), 'mcp: get_context reaches the extension through the live link');
const valid = await mcp.tool('validate', { file: 'shop.yaml' });
check(/valid/i.test(valid), 'mcp: relative paths resolve in the workspace folder');

// The presenter: full screen, the step's caption below, arrows step.
stub.window.activeColorTheme = { kind: stub.ColorThemeKind.Light };
await stub.commands.executeCommand('cartography.present', doc.uri);
const present = await until(() => stub.state.panels.find((p) => p.viewType === 'cartography.present'));
check(present.webview.html.includes('data-mode="present"'), 'present opens a page of its own');
check(stub.state.executed.some((e) => /maximizeEditor/.test(e.id)), 'present maximizes the editor');
const show = await openPage(present, 'present', { width: 1280, height: 720 });
await show.pumpUntil(async () => (await show.tab.$('#paper svg')) !== null);
await show.tab.keyboard.press('ArrowRight');
await show.pumpUntil(async () => (await show.tab.$eval('#caption .n', (el) => el.textContent)) === '2 / 2');
await show.tab.waitForTimeout(150);
check(await show.tab.$eval('#bar', (el) => getComputedStyle(el).display === 'none'), 'no toolbar while presenting');
await show.tab.screenshot({ path: path.join(out, 'present.png') });
let closed = false;
present.onDidDispose(() => (closed = true));
await show.tab.keyboard.press('Escape');
await show.pump();
check(closed, 'Escape closes the presenter');

mcp.close();
await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`screenshots in ${path.relative(process.cwd(), out) || '.'}`);
if (failures.length) {
  console.error(`${failures.length} failed`);
  process.exit(1);
}
process.exit(0);
