// The folder as one model: search across files, drill down, back and forward, where used, rename
// everywhere with its preview and undo, and the checks across files. The browser's private file system
// stands in for a picked folder, as in files.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? '.';
const root = path.resolve(import.meta.dirname, '../../../examples/workspace');
const files = Object.fromEntries(fs.readdirSync(root).filter((f) => f.endsWith('.yaml')).map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8')]));
// Pins that must follow a rename, and one diagram that names an element that is not there.
files['containers.layout.json'] = JSON.stringify({ version: 1, views: { payments: { nodes: { 'payments.engine': { x: 40, y: 400 } } } } }, null, 2) + '\n';
files['containers.notes.json'] = JSON.stringify({ version: 1, threads: [{ id: 'n1', author: 'Misja', created: '2026-11-10T10:00:00Z', text: 'Does this scale?', status: 'open', view: 'payments', anchor: { kind: 'node', id: 'payments.engine' } }] }, null, 2) + '\n';
files['broken.yaml'] = 'type: azure\ninclude: [model.yaml]\nnodes:\n  worker: { of: payments.engin, kind: container-app }\n';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
page.setDefaultTimeout(8000);
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
const fail = (m) => problems.push(m);
const step = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    fail(`${name}: ${e.message.split('\n').slice(0, 12).join(' | ')} @ ${e.stack.split('\n').find((l) => l.includes('workspace.mjs'))}`);
  }
};
const disk = (name) =>
  page.evaluate(async (name) => {
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('harbour');
    return (await (await d.getFileHandle(name)).getFile()).text();
  }, name);
const activeFile = () => page.locator('.files .file.active').innerText();
const waitFile = (name) => page.waitForFunction((n) => document.querySelector('.files .file.active')?.textContent?.trim() === n, name, { timeout: 5000 });
const selectedId = () => page.locator('.statusbar .status-selected').last().innerText();
const crumbs = () => page.locator('.crumbs ol').innerText();
const settle = () => page.waitForTimeout(500);

await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.evaluate(async (files) => {
  localStorage.clear();
  localStorage.setItem('cartography:started', 'true');
  localStorage.setItem('cartography:hinted', 'true');
  const opfs = await navigator.storage.getDirectory();
  for await (const [name] of opfs.entries()) await opfs.removeEntry(name, { recursive: true });
  const dir = await opfs.getDirectoryHandle('harbour', { create: true });
  for (const [p, text] of Object.entries(files)) {
    const w = await (await dir.getFileHandle(p, { create: true })).createWritable();
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

await step('folder problems', async () => {
  const s = await page.locator('.status-folder').innerText();
  if (!/1 across harbour/.test(s)) fail(`folder problems: ${s}`);
  await page.click('.status-folder');
  const item = page.locator('.palette-item', { hasText: 'of: payments.engin' });
  if (!/did you mean payments\.engine/.test(await item.innerText())) fail('no suggestion in the problem');
  await item.click();
  await waitFile('broken.yaml');
});

await step('search', async () => {
  await page.keyboard.press('Meta+p');
  await page.waitForSelector('.ws-search');
  await page.keyboard.type('settlement');
  await page.waitForTimeout(150);
  const first = page.locator('.ws-hit').first();
  if (!(await first.innerText()).includes('Settlement engine')) fail(`first hit: ${await first.innerText()}`);
  const chips = await first.locator('.ws-chip').allInnerTexts();
  if (chips.join() !== 'containers › payments,deployment.yaml') fail(`where: ${chips}`);
  await page.screenshot({ path: `${out}/workspace-1-search.png` });
  await page.keyboard.press('Enter');
  await waitFile('containers.yaml');
  await page.waitForSelector('.focus-chip', { timeout: 5000 });
  await settle();
  if ((await selectedId()) !== 'payments.engine') fail(`selected after search: ${await selectedId()}`);
  await page.screenshot({ path: `${out}/workspace-2-opened.png` });
  // ⌥↵ opens the other drawing with the element only selected.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+p');
  await page.keyboard.type('settlement');
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Alt+Enter');
  await waitFile('deployment.yaml');
  await settle();
  if ((await selectedId()) !== 'engine') fail(`selected in the deployment: ${await selectedId()}`);
  if (await page.locator('.focus-chip').count()) fail('⌥↵ focused');
});

// Review 3: ⌘↑ from the containers (drilled into from the context) went to model.yaml. It goes back up
// the way it came: to the context, with Harbour Online selected, then to the landscape.
await step('up goes back the way it came down', async () => {
  await page.keyboard.press('Meta+p');
  await page.keyboard.type('landscape');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await waitFile('model.yaml');
  await settle();
  const dbl = async (id) => {
    const box = await page.locator(`.drawing [data-node="${id}"], .drawing [data-group="${id}"]`).first().boundingBox();
    await page.mouse.dblclick(box.x + 30, box.y + 20);
  };
  await dbl('online');
  await waitFile('context.yaml');
  await settle();
  await dbl('online');
  await waitFile('containers.yaml');
  await settle();
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+ArrowUp');
  await waitFile('context.yaml').catch(async () => fail(`⌘↑ from the containers went to ${await activeFile()}, not back to context.yaml`));
  await settle();
  if ((await selectedId()) !== 'online') fail(`back up, what was drilled into should be selected: ${await selectedId()}`);
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+ArrowUp');
  await waitFile('model.yaml').catch(async () => fail(`⌘↑ from the context went to ${await activeFile()}, not the landscape in model.yaml`));
  await settle();
});

await step('drill down', async () => {
  await page.keyboard.press('Meta+p');
  await page.keyboard.type('landscape');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await waitFile('model.yaml');
  await settle();
  const dbl = async (id) => {
    const box = await page.locator(`.drawing [data-node="${id}"], .drawing [data-group="${id}"]`).first().boundingBox();
    await page.mouse.dblclick(box.x + 30, box.y + 20);
  };
  await dbl('online');
  await waitFile('context.yaml');
  await settle();
  await dbl('online');
  await waitFile('containers.yaml');
  await settle();
  if (!(await crumbs()).includes('Harbour Online')) fail(`crumbs: ${await crumbs()}`);
  await page.click('.drawing [data-node="online.api"]');
  await page.keyboard.press('Meta+ArrowDown');
  await page.waitForFunction(() => document.querySelector('.crumbs ol')?.textContent?.includes('Banking API'), null, { timeout: 5000 });
  await settle();
  await page.screenshot({ path: `${out}/workspace-3-components.png` });
  const c = await crumbs();
  if (!/harbour.*Harbour Online.*Banking API/s.test(c)) fail(`component crumbs: ${c}`);
  // Up through the crumbs, and back again with ⌘[ and ⌘].
  await page.click('.crumbs button.crumb:has-text("Harbour Online")');
  await page.waitForFunction(() => !document.querySelector('.crumbs ol')?.textContent?.includes('Banking API'), null, { timeout: 5000 });
  await page.keyboard.press('Meta+[');
  await page.waitForFunction(() => document.querySelector('.crumbs ol')?.textContent?.includes('Banking API'), null, { timeout: 5000 });
  await page.keyboard.press('Meta+[');
  await page.waitForFunction(() => !document.querySelector('.crumbs ol')?.textContent?.includes('Banking API'), null, { timeout: 5000 });
  await page.keyboard.press('Meta+[');
  await waitFile('context.yaml');
  await page.keyboard.press('Meta+]');
  await waitFile('containers.yaml');
  await settle();
  if ((await crumbs()).includes('Banking API')) fail('forward went to the wrong view');
});

await step('where used', async () => {
  await settle();
  await page.click('.drawing [data-node="online.api"]', { timeout: 5000 });
  await page.waitForSelector('.where-used');
  const rows = await page.locator('.where-used .where-row').allInnerTexts();
  if (!rows.some((r) => r.includes('deployment.yaml') && r.includes('as api'))) fail(`where used: ${rows}`);
  if (!rows.some((r) => r.includes('deployment.yaml:16') && r.includes('runs it'))) fail(`named in: ${rows}`);
  await page.screenshot({ path: `${out}/workspace-4-where-used.png` });
  await page.click('.where-used .where-row:has-text("as api")');
  await waitFile('deployment.yaml');
  await settle();
  if ((await selectedId()) !== 'api') fail(`selected from where used: ${await selectedId()}`);
});

// Review 3: renaming the ledger (12 places in 5 files) made the dialog taller than the window; its
// button was cut off. The diff scrolls, the buttons stay in view, at 1512×900 and at 1280×800.
await step('rename everywhere fits the window', async () => {
  await page.click('.files .file:has-text("context.yaml")');
  await waitFile('context.yaml');
  await settle();
  await page.click('.drawing [data-node="ledger"]');
  await page.keyboard.press('Shift+F2');
  await page.waitForSelector('.rename-everywhere');
  await page.keyboard.type('ledger-core');
  await page.waitForTimeout(300);
  if (!/in [4-9] files/.test(await page.locator('.rename-actions button.primary').innerText())) fail(`ledger is in several files: ${await page.locator('.rename-actions button.primary').innerText()}`);
  for (const viewport of [{ width: 1512, height: 900 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(300);
    const box = await page.locator('.rename-everywhere').boundingBox();
    const button = await page.locator('.rename-actions button.primary').boundingBox();
    if (!box || box.y + box.height > viewport.height) fail(`rename dialog ends at ${box && Math.round(box.y + box.height)} in a ${viewport.height} px window`);
    if (!button || button.y + button.height > viewport.height) fail(`the rename button is cut off at ${viewport.width}×${viewport.height}`);
    await page.screenshot({ path: `${out}/workspace-5-rename-${viewport.height}.png` });
  }
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1512, height: 900 });
  await settle();
  await page.click('.files .file:has-text("deployment.yaml")');
  await waitFile('deployment.yaml');
  await settle();
});

await step('rename everywhere', async () => {
  const before = { model: await disk('model.yaml'), deployment: await disk('deployment.yaml'), pins: await disk('containers.layout.json') };
  await page.click('.drawing [data-node="engine"]');
  await page.keyboard.press('Shift+F2');
  await page.waitForSelector('.rename-everywhere');
  await page.keyboard.type('settlement');
  await page.waitForTimeout(150);
  const shown = await page.locator('.rename-file h4').allInnerTexts();
  if (shown.map((s) => s.split(/\s/)[0]).sort().join() !== 'deployment.yaml,model.yaml') fail(`preview files: ${shown}`);
  const summary = await page.locator('.rename-summary').innerText();
  if (!summary.includes('containers.layout.json') || !summary.includes('containers.notes.json')) fail(`pins and notes not in the summary: ${summary}`);
  await page.screenshot({ path: `${out}/workspace-5-rename.png` });
  await page.keyboard.press('Enter');
  await page.waitForSelector('.toast:has-text("Renamed payments.engine")');
  await settle();
  // The open file is renamed in the editor (one undo step); the others on disk, with their pins.
  if (!(await page.locator('.cm-content').innerText()).includes('of: payments.settlement')) fail('open file not renamed');
  if (!(await disk('model.yaml')).includes('      settlement: { kind: container, label: Settlement engine')) fail('model not renamed on disk');
  if (!(await disk('containers.layout.json')).includes('"payments.settlement"')) fail('pins did not follow');
  if (!(await disk('containers.notes.json')).includes('"payments.settlement"')) fail('notes did not follow');
  if (!(await disk('broken.yaml')).includes('payments.engin,')) fail('touched a file that does not name it');
  await page.screenshot({ path: `${out}/workspace-6-renamed.png` });
  // Undo rename puts every file back.
  await page.keyboard.press('Meta+k');
  await page.keyboard.type('undo rename');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.toast:has-text("Rename undone")');
  if ((await disk('model.yaml')) !== before.model) fail('model.yaml not back');
  if ((await disk('containers.layout.json')) !== before.pins) fail('pins not back');
  if (!(await disk('containers.notes.json')).includes('"payments.engine"')) fail('notes not back');
  if (!(await page.locator('.cm-content').innerText()).includes('of: payments.engine')) fail('open file not back');
  await page.keyboard.press('Meta+s');
  await settle();
  if ((await disk('deployment.yaml')) !== before.deployment) fail('deployment.yaml not back after save');
});

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all workspace steps ok');
await browser.close();
process.exitCode = problems.length ? 1 : 0;
