// The keys from keys.ts in the app: ⌘↩ never presents from a text field (the Ask box, the YAML), ⌘P
// is the browser's, Caps Lock does not change what a letter does, S says what it
// added, ⇧T does nothing any more, ⌘] in the YAML indents even in a folder, and the "?" sheet lists
// every key once, grouped, and can be searched. node e2e/shortcuts.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? '.';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 } });
/** Says Discard to the app's "Discard the unsaved changes?" dialogs until stopped (they replaced confirm()). */
const discarding = () => {
  let on = true;
  void (async () => {
    while (on && !page.isClosed()) await page.locator('.confirm-dialog button:has-text("Discard")').click({ timeout: 250 }).catch(() => {});
  })();
  return () => void (on = false);
};
page.setDefaultTimeout(8000);
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
const step = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    fail(`${name}: ${e.message.split('\n').slice(0, 6).join(' | ')}`);
  }
};
const wait = (ms = 300) => page.waitForTimeout(ms);
/** A key as a Caps Lock keyboard sends it: the capital, without Shift. */
const capsKey = (key) =>
  page.locator('.preview').evaluate((el, key) => {
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: key.toUpperCase(), code: `Key${key.toUpperCase()}`, bubbles: true, cancelable: true }));
  }, key);
/** Whether the app took the last key press (prevented the browser's own use of it). */
const watchPrevented = () => page.evaluate(() => window.addEventListener('keydown', (e) => setTimeout(() => (window.__taken = e.defaultPrevented)), true));
const taken = async () => (await wait(50), page.evaluate(() => window.__taken));

const text = `type: azure
title: Shop
nodes:
  api: { kind: app-service, label: API }
  db: { kind: sql-database, label: Orders DB }
edges:
  - api -> db
`;
// Seeded before the app reads it (a reload would save the open diagram over it on the way out).
await page.addInitScript((text) => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  localStorage.clear();
  for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'code', 'note-author': 'Misja', doc: { text, doc: { name: 'shop.yaml' } } })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
}, text);
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.waitForSelector('.drawing [data-node="db"]');
await watchPrevented();

await step('⌘↩ in the YAML does not present', async () => {
  await page.click('.cm-content');
  await page.keyboard.press('Meta+Enter');
  await wait(400);
  if (await page.locator('.present').count()) fail('⌘↩ in the YAML presented');
});

await step('⌘J opens and closes the Your AI panel', async () => {
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+j');
  await page.waitForSelector('.ask-panel:not([hidden])');
  if (await page.locator('.ask-panel input[type=password], .ask-panel textarea').count()) fail('the Your AI panel has a key or a question box');
  await page.screenshot({ path: `${out}/s1-your-ai.png` });
  await page.click('.ask-panel button[aria-label="Close"]');
});

await step('⌘↩ on the drawing presents', async () => {
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+Enter');
  await page.waitForSelector('.present');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.present', { state: 'detached' });
});

await step('⌘P is the browser’s', async () => {
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+p');
  if (await taken()) fail('⌘P was taken (it prints)');
});

await step('⌘D outside the drawing stays the browser’s', async () => {
  const yaml = () => page.locator('.cm-content').innerText();
  const before = await yaml();
  await page.click('.cm-content');
  await page.keyboard.press('Meta+d');
  await wait(300);
  if ((await yaml()).split('kind:').length !== before.split('kind:').length) fail('⌘D in the YAML duplicated an element');
});

await step('Caps Lock: N adds a note, S a step, as without it', async () => {
  await page.click('.drawing [data-node="api"]');
  await capsKey('n');
  await page.waitForSelector('.note-composer');
  await page.keyboard.press('Escape');
  await page.click('.drawing [data-node="api"]');
  await capsKey('s');
  await page.waitForSelector('.steps-strip');
  // S says what it added, with the way back.
  const toast = await page.locator('.toast').innerText();
  if (!/Step 1 added: API/.test(toast) || !/Undo/.test(toast)) fail(`no message for the new step: ${toast}`);
  await page.keyboard.press('Escape');
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+z');
  await wait(400);
});

await step('⇧T is not Tidy all', async () => {
  await page.click('.drawing [data-node="api"]');
  const box = await page.locator('.drawing [data-node="api"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 90, { steps: 8 });
  await page.mouse.up();
  await wait(500);
  const pinned = await page.locator('.statusbar').innerText();
  await page.locator('.preview').focus();
  await page.keyboard.press('Shift+T');
  await wait(500);
  if ((await page.locator('.statusbar').innerText()) !== pinned) fail('⇧T changed the pins');
});

await step('the sheet: every key once, grouped, searchable', async () => {
  await page.locator('.preview').focus();
  await page.keyboard.press('?');
  await page.waitForSelector('.shortcuts');
  await wait(400);
  await page.screenshot({ path: `${out}/s2-sheet.png` });
  const rows = await page.locator('.shortcuts dl > div').allInnerTexts();
  const seen = new Set();
  for (const r of rows) {
    const k = r.replace(/\s+/g, ' ').trim();
    if (seen.has(k)) fail(`the sheet lists twice: ${k}`);
    seen.add(k);
  }
  const all = rows.join('\n');
  for (const k of ['⌘\\', 'Space drag', '⌘Y', 'Full screen on or off']) if (!all.includes(k)) fail(`the sheet misses ${k}`);
  await page.keyboard.type('zoom');
  await wait(150);
  const found = await page.locator('.shortcuts dl > div').count();
  if (!found || found >= rows.length / 4) fail(`the search did not narrow the sheet: ${found} of ${rows.length}`);
  await page.screenshot({ path: `${out}/s3-sheet-search.png` });
  await page.keyboard.press('Escape');
});

// A folder: ⌘] in the YAML indents, it does not go to another file.
const root = path.resolve(import.meta.dirname, '../../../examples/workspace');
const files = Object.fromEntries(fs.readdirSync(root).filter((f) => f.endsWith('.yaml')).map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8')]));
await page.evaluate(async (files) => {
  const opfs = await navigator.storage.getDirectory();
  for await (const [name] of opfs.entries()) await opfs.removeEntry(name, { recursive: true });
  const dir = await opfs.getDirectoryHandle('harbour', { create: true });
  for (const [p, text] of Object.entries(files)) {
    const w = await (await dir.getFileHandle(p, { create: true })).createWritable();
    await w.write(text);
    await w.close();
  }
  window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('harbour');
}, files);
const stop = discarding();
await page.click('button:has-text("Open folder")');
await page.waitForSelector('.files .file, .files-rail');
stop();
await wait(600);

await step('⌘] in the YAML indents, in a folder too', async () => {
  const file = async () => page.locator('.doc-name').innerText();
  const before = await file();
  // Next to the side panel in a folder the YAML may be folded for room: its rail opens it.
  if (await page.locator('button.yaml-rail').count()) await page.click('button.yaml-rail');
  await page.click('.cm-line >> nth=2');
  await page.keyboard.press('Home');
  const line = await page.locator('.cm-activeLine').innerText();
  await page.keyboard.press('Meta+]');
  await wait(300);
  const after = await page.locator('.cm-activeLine').innerText();
  if (after !== `  ${line}`) fail(`⌘] did not indent the line: "${line}" → "${after}"`);
  if ((await file()) !== before) fail('⌘] in the YAML went to another file');
  await page.keyboard.press('Meta+[');
  await wait(200);
  if ((await page.locator('.cm-activeLine').innerText()) !== line) fail('⌘[ did not outdent the line');
});

await step('the type shows the id the YAML writes', async () => {
  await page.click('.type-pill');
  const card = await page.locator('.type-card-pop').innerText();
  if (!/^type: [a-z-]+$/m.test(card)) fail(`the type card does not say what the YAML writes: ${card}`);
  await page.keyboard.press('Escape');
});

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all shortcut steps ok');
await browser.close();
process.exitCode = problems.length ? 1 : 0;
