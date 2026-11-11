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
    // The page is fitted and centred in the drawing's pane, never under the side panel.
    const frame = (await page.locator('.page-frame').count()) ? await box('.page-frame') : null;
    if (frame && (frame.x < c.x - 1 || frame.x + frame.width > c.x + c.width + 1)) fail(`${tag}: the page runs out of the drawing's pane (${Math.round(frame.x)}–${Math.round(frame.x + frame.width)} in ${Math.round(c.x)}–${Math.round(c.x + c.width)})`);
    if (frame && Math.abs(frame.x - c.x - (c.x + c.width - frame.x - frame.width)) > 24) fail(`${tag}: the page is not centred in the pane`);
    const mini = (await page.locator('.minimap').count()) ? await box('.minimap') : null;
    if (mini && mini.width * mini.height > c.width * c.height * 0.08) fail(`${tag}: the minimap takes ${Math.round((100 * mini.width * mini.height) / (c.width * c.height))}% of the drawing`);
  });

  // Zoomed in, the floating tools may sit over the drawing; fit and zoom to the
  // selection never put what they show under them.
  await step('fit and zoom to selection stay clear of the tools', async () => {
    // The topmost and the bottommost element: a selection taller than wide, the case that ran under the tools.
    const ends = await page.locator('.drawing [data-node]').evaluateAll((els) => {
      const at = els.map((el) => [el.getAttribute('data-node'), el.getBoundingClientRect().top]).sort((a, b) => a[1] - b[1]);
      return [at[0][0], at.at(-1)[0]];
    });
    await page.click(`.drawing [data-node="${ends[0]}"]`);
    await page.click(`.drawing [data-node="${ends[1]}"]`, { modifiers: ['Shift'] });
    await page.waitForTimeout(700);
    await page.focus('.preview');
    await page.keyboard.press('Shift+2');
    await page.waitForTimeout(500);
    const top = await box('.canvas-top');
    const rings = await page.locator('.selection-ring').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
    const ring = { y: Math.min(...rings) };
    if (ring.y < top.y + top.height) fail(`${tag}: zoom to selection puts the element under the tools (${Math.round(ring.y)} < ${Math.round(top.y + top.height)})`);
    await page.screenshot({ path: `${out}/panes-${tag}-1b-zoom-selection.png` });
    await page.keyboard.press('Shift+1');
    await page.waitForTimeout(500);
    const shown = (await page.locator('.page-frame').count()) ? await box('.page-frame') : await box('.drawing svg');
    if (shown.y < top.y + top.height) fail(`${tag}: fit puts the drawing under the tools (${Math.round(shown.y)} < ${Math.round(top.y + top.height)})`);
    await page.click('.drawing [data-node="online.api"]');
    await page.waitForTimeout(1400);
  });

  await step('the properties of the selection fit the panel', async () => {
    const wide = await page.locator('.side .inspector-body').evaluate((el) => el.scrollWidth - el.clientWidth);
    if (wide > 1) fail(`${tag}: the properties run ${wide} px past the panel`);
  });

  // Next to the side panel in a folder the YAML is too narrow to read: folded, not the drawing squeezed
  // (review 3). Opened from its rail on purpose, it stays.
  await step('the YAML folds before the drawing gives way', async () => {
    if (!(await page.locator('button.yaml-rail').count())) fail(`${tag}: with the side panel the YAML should fold to its rail`);
    else {
      await page.click('button.yaml-rail');
      await page.waitForSelector('.fold-yaml');
    }
    // The folded file list says it holds files, not the folder's name on its side.
    if (await page.locator('.files-rail').count()) {
      const said = await page.locator('.files-rail .rail-label').innerText();
      if (!/^Files · \d+$/.test(said)) fail(`${tag}: the file rail says "${said}"`);
    }
  });

  await step('header on one line with unsaved changes', async () => {
    await page.click('.cm-content');
    await page.keyboard.press('Meta+End');
    await page.keyboard.type('\n# x');
    await page.waitForSelector('.topbar .dirty');
    const h = await box('.topbar');
    const sw = await page.locator('.view-switch').boundingBox();
    if (h.height > 53 || sw.height > h.height) fail(`${tag}: the header wraps with unsaved changes (${h.height}, ${sw.height})`);
    await page.keyboard.press('Meta+z');
    await page.click('.drawing [data-node="online.api"]');
    await page.waitForTimeout(300);
    // The drawing pans by its transform: a click on a linked element must not scroll the pane away.
    const scrolled = await page.locator('.preview').evaluate((el) => el.scrollTop + el.scrollLeft);
    if (scrolled) fail(`${tag}: the drawing's pane scrolled by ${scrolled} px after a click`);
  });

  await step('side panel tabs', async () => {
    await page.click('.side-tabs button:has-text("Your AI")');
    await page.waitForSelector('.side .ask-panel:not([hidden])');
    const c = await box('.canvas-pane');
    const ask = await box('.side .ask-panel');
    if (overlap(c, ask)) fail(`${tag}: Ask covers the drawing`);
    // Nothing is sent anywhere, and the panel says so.
    if (!/talks to no AI and no network/.test(await page.locator('.ask-sent > span').innerText())) fail(`${tag}: the Your AI panel does not say nothing is sent`);
    await page.screenshot({ path: `${out}/panes-${tag}-2-ask-tab.png` });
    await page.click('.side-tabs button:has-text("Properties")');
    await page.waitForSelector('.side .inspector');
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
