// How the window is shared out (pane-layout.ts), at 1512×900 and 1280×800, light and dark: in a
// folder the drawing keeps at least 640 px, the toolbar never runs under the side panel or off the
// pane, the header stays one line, the hint and toasts stay off the zoom bar, and the side panel is
// one place with tabs. The folded file list and YAML are remembered.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? '.';
const root = path.resolve(import.meta.dirname, '../../../examples/workspace');
const files = Object.fromEntries(fs.readdirSync(root).filter((f) => f.endsWith('.yaml')).map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8')]));

const browser = await chromium.launch();
const problems = [];
const fail = (m) => problems.push(m);

/** Overlap of two boxes, in px² (0 when apart). */
const overlap = (a, b) => (a && b ? Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)) : 0);

async function run(width, height, theme) {
  const tag = `${width}-${theme}`;
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: theme });
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => fail(`${tag}: ${e.message}`));
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      fail(`${tag} ${name}: ${e.message.split('\n').slice(0, 6).join(' | ')}`);
    }
  };
  const box = (q) => page.locator(q).first().boundingBox();
  await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
  await page.evaluate(async (files) => {
    localStorage.clear();
    localStorage.setItem('cartography:started', 'true');
    localStorage.setItem('cartography:view', '"code"');
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

  await step('header on one line', async () => {
    const h = await box('.topbar');
    const kids = await page.locator('.topbar .actions > *:visible').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    if (h.height > 53 || kids.some((x) => x > 40)) fail(`${tag}: the header wraps (${h.height}px, ${kids})`);
  });

  await page.click('button:has-text("Open folder")');
  await page.waitForSelector('.files .file, .files-rail');
  await page.waitForTimeout(600);
  // The containers of Harbour Online, with an element selected: the case that left 250 px.
  await page.evaluate(() => [...document.querySelectorAll('.files .file')].find((b) => b.textContent?.trim() === 'containers.yaml')?.click());
  if (!(await page.locator('.files .file').count())) {
    await page.click('.files-rail .rail-button');
    await page.click('.files.over .file:has-text("containers.yaml")');
  }
  await page.waitForTimeout(900);
  await page.click('.drawing [data-node="online.api"]');
  // The drawing glides to fit the narrower pane once the pointer has been still a moment.
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${out}/panes-${tag}-1-folder-selected.png` });

  await step('the drawing keeps its room', async () => {
    const c = await box('.canvas-pane');
    if (c.width < 630) fail(`${tag}: the drawing has ${Math.round(c.width)} px`);
    const tools = await box('.canvas-tools');
    if (tools.x + tools.width > c.x + c.width - 8) fail(`${tag}: the toolbar runs past the drawing (${Math.round(tools.x + tools.width)} > ${Math.round(c.x + c.width)})`);
    const side = await box('.side');
    if (!side) fail(`${tag}: no side panel for the selection`);
    else if (overlap(tools, side)) fail(`${tag}: the toolbar runs under the side panel`);
    const crumbs = await box('.crumbs');
    if (crumbs && overlap(crumbs, tools)) fail(`${tag}: crumbs over the toolbar`);
    // The page is fitted and centred in the drawing's pane, never under the side panel.
    const frame = (await page.locator('.page-frame').count()) ? await box('.page-frame') : null;
    if (frame && (frame.x < c.x - 1 || frame.x + frame.width > c.x + c.width + 1)) fail(`${tag}: the page runs out of the drawing's pane (${Math.round(frame.x)}–${Math.round(frame.x + frame.width)} in ${Math.round(c.x)}–${Math.round(c.x + c.width)})`);
    if (frame && Math.abs(frame.x - c.x - (c.x + c.width - frame.x - frame.width)) > 24) fail(`${tag}: the page is not centred in the pane`);
    const mini = (await page.locator('.minimap').count()) ? await box('.minimap') : null;
    if (mini && mini.width * mini.height > c.width * c.height * 0.08) fail(`${tag}: the minimap takes ${Math.round((100 * mini.width * mini.height) / (c.width * c.height))}% of the drawing`);
  });

  await step('where used and the file it is defined in, with the selection', async () => {
    if (!(await page.locator('.side .where-used').count())) fail(`${tag}: where-used is not with the selection`);
    const defined = await page.locator('.side .defined-in').innerText();
    if (!/model\.yaml/.test(defined)) fail(`${tag}: no "defined in model.yaml" for an included element: ${defined}`);
    const wide = await page.locator('.side .inspector-body').evaluate((el) => el.scrollWidth - el.clientWidth);
    if (wide > 1) fail(`${tag}: the properties run ${wide} px past the panel`);
  });

  await step('header on one line with unsaved changes', async () => {
    await page.click('.cm-content');
    await page.keyboard.press('Meta+End');
    await page.keyboard.type('\n# x');
    await page.waitForSelector('.topbar .dirty');
    const h = await box('.topbar');
    const sw = await page.locator('.view-switch').boundingBox();
    if (h.height > 53 || sw.height > 40) fail(`${tag}: the header wraps with unsaved changes (${h.height}, ${sw.height})`);
    await page.keyboard.press('Meta+z');
    await page.click('.drawing [data-node="online.api"]');
    await page.waitForTimeout(300);
    // The drawing pans by its transform: a click on a linked element must not scroll the pane away.
    const scrolled = await page.locator('.preview').evaluate((el) => el.scrollTop + el.scrollLeft);
    if (scrolled) fail(`${tag}: the drawing's pane scrolled by ${scrolled} px after a click`);
  });

  await step('side panel tabs', async () => {
    await page.click('.side-tabs button:has-text("Notes")');
    await page.waitForSelector('.side .notes-panel');
    await page.click('.side-tabs button:has-text("Ask")');
    await page.waitForSelector('.side .ask-panel:not([hidden])');
    if (await page.locator('.side .notes-panel').count()) fail(`${tag}: notes and Ask at once`);
    const c = await box('.canvas-pane');
    const ask = await box('.side .ask-panel');
    if (overlap(c, ask)) fail(`${tag}: Ask covers the drawing`);
    // In a folder the included model goes too, and the line under the box says so.
    const said = await page.locator('.ask-sent > span').innerText();
    if (!/included file model\.yaml/.test(said) || !/your question/.test(said)) fail(`${tag}: Ask does not say it sends model.yaml: ${said}`);
    await page.click('.ask-sent button:has-text("Show exactly")');
    if (!(await page.locator('.ask-sent-text').innerText()).includes('<included file="model.yaml">')) fail(`${tag}: Ask does not send the included model.yaml`);
    await page.click('.ask-sent button:has-text("Hide")');
    await page.screenshot({ path: `${out}/panes-${tag}-2-ask-tab.png` });
    await page.click('.side-tabs button:has-text("Properties")');
    await page.waitForSelector('.side .inspector:not(.notes-panel)');
    // Ask kept its place behind the tab.
    if (!(await page.locator('.side .ask-panel[hidden]').count())) fail(`${tag}: Ask was dropped when switching tabs`);
  });

  await step('fold the YAML, remembered', async () => {
    const before = (await box('.canvas-pane')).width;
    await page.click('.fold-yaml');
    await page.waitForSelector('button.yaml-rail');
    const after = (await box('.canvas-pane')).width;
    // The room goes to the drawing, or to the file list folded for want of it.
    const list = await page.locator('nav.files:not(.over)').count();
    if (after <= before + (list ? 40 : 200)) fail(`${tag}: folding the YAML gave the drawing ${Math.round(after - before)} px`);
    await page.reload();
    await page.waitForSelector('button.yaml-rail');
    await page.click('button.yaml-rail');
    await page.waitForSelector('.editor-pane:not([hidden])');
  });

  await step('toasts and hint stay off the zoom bar', async () => {
    await page.evaluate(() => localStorage.removeItem('cartography:hinted'));
    await page.reload();
    await page.waitForSelector('.hint');
    await page.click('.preview');
    await page.keyboard.press('v');
    await page.waitForSelector('.toast');
    const zoom = await box('.zoom');
    const hint = await box('.hint');
    const toast = await box('.toast');
    if (overlap(zoom, hint)) fail(`${tag}: the hint covers the zoom bar`);
    if (overlap(zoom, toast)) fail(`${tag}: the toast covers the zoom bar`);
    if (overlap(hint, toast)) fail(`${tag}: the toast covers the hint`);
    const tools = await box('.canvas-tools');
    if (overlap(tools, toast)) fail(`${tag}: the toast covers the toolbar`);
    await page.screenshot({ path: `${out}/panes-${tag}-3-hint-toast.png` });
    // Gone within five seconds: it holds no action.
    await page.waitForSelector('.toast', { state: 'detached', timeout: 5500 });
  });

  await page.close();
}

for (const [w, h] of [
  [1512, 900],
  [1280, 800],
])
  for (const theme of ['light', 'dark']) await run(w, h, theme);

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all pane steps ok');
await browser.close();
process.exitCode = problems.length ? 1 : 0;
