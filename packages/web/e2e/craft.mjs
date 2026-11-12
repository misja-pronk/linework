// Editor craft: smart guides and snapping, align and distribute, bending a line by hand and resetting it,
// lock, moving and focusing by keyboard, zoom keys and the minimap: node e2e/craft.mjs <outDir>
import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
// The pins as the app keeps them (saved to the browser shortly after each change).
const pins = async () => {
  await wait(450);
  return page.evaluate(() => JSON.parse(localStorage.getItem('cartography:doc') ?? '{}').pins ?? {});
};
const rect = (id) => page.locator(`.drawing [data-node="${id}"] > rect`).first().boundingBox();
const zoom = () => page.locator('.zoom-level').innerText();
const status = () => page.locator('.statusbar').innerText();
// The selected element's id, as the status bar shows it (next to the pin count, when there is one).
const selectedId = () => page.evaluate(() => [...document.querySelectorAll('.status-selected')].map((s) => s.textContent.trim()).filter((t) => !t.endsWith('pinned')).pop());
const drag = async (from, to, steps = 10, opts = {}) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (opts.alt) await page.keyboard.down('Alt');
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  if (opts.shot) await page.screenshot({ path: `${out}/${opts.shot}` });
  await page.mouse.up();
  if (opts.alt) await page.keyboard.up('Alt');
  await wait(400);
};
const centre = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

const text = 'type: azure\nnodes:\n  a: app-service\n  b: sql-database\n  c: key-vault\n  d: function-app\nedges:\n  - a -> b\n  - a -> c\n  - c -> d\n';
// Seeded before the app starts (a reload would save the open document over it on the way out).
await page.addInitScript((text) => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  localStorage.clear();
  for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'visual', doc: { text, doc: { name: 'craft.yaml' } } })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
}, text);
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.waitForSelector('.drawing [data-node="d"]', { timeout: 10000 }).catch(async (e) => {
  await page.screenshot({ path: `${out}/c0-failed.png` });
  throw e;
});
await wait(400);
await page.screenshot({ path: `${out}/c0-start.png` });

// 1. Guides and snapping: drag b so its top is 3px off d's top (one column to its left); it snaps level with a guide, ⌥ turns that off.
{
  // Pin b first (a nudge): the first pin can redraw the rest, and the drag below should start from that drawing.
  await page.locator('.drawing [data-node="b"]').click();
  await page.locator('.preview').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await wait(500);
  const a = await rect('d');
  const b = await rect('b');
  const target = { x: centre(b).x + 30, y: centre(b).y + (a.y - b.y) + 3 };
  await drag(centre(b), target, 10, { shot: 'c1-guides.png' });
  const guides = await page.evaluate(() => document.querySelectorAll('.guides line').length);
  const b1 = await rect('b');
  // Level with d as it stands now: a fitted view may fit again once the drawing has grown.
  const a1 = await rect('d');
  if (Math.abs(b1.y - a1.y) > 0.6) fail(`snap: b top ${b1.y} not level with d top ${a1.y}`);
  if (!Object.keys((await pins()).nodes ?? {}).includes('b')) fail('snap: drag did not pin b');
  // Guides showed during the drag (screenshot) and are gone afterwards.
  if (guides) fail('guides stayed after the drag');
  await page.keyboard.press('Meta+z');
  await wait(400);
  const b2 = await rect('b');
  await drag(centre(b2), { x: centre(b2).x + 30, y: centre(b2).y + ((await rect('d')).y - b2.y) + 3 }, 10, { alt: true });
  const b3 = await rect('b');
  if (Math.abs(b3.y - (await rect('d')).y) < 1) fail('⌥ drag still snapped');
  await page.keyboard.press('Meta+z');
  await page.keyboard.press('Meta+z');
  await wait(400);
}
// A drag in progress shows its guides: hold one mid-drag and count.
{
  const a = await rect('a');
  const c = await rect('c');
  await page.mouse.move(centre(c).x, centre(c).y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(centre(c).x + i * 4, centre(c).y + ((a.y - c.y + 2) * i) / 8);
  await wait(200);
  const live = await page.evaluate(() => document.querySelectorAll('.guides line').length);
  if (!live) fail('no guides while dragging next to an aligned node');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await wait(300);
}

// 2. Align and distribute: shift-click three, ⌥W aligns tops in one undo step; the panel distributes.
{
  for (const [i, id] of ['a', 'b', 'c'].entries()) await page.locator(`.drawing [data-node="${id}"]`).click({ modifiers: i ? ['Shift'] : [] });
  await wait();
  if (!(await page.locator('.arrange-bar').isVisible())) fail('align buttons missing in the multi-selection panel');
  await page.screenshot({ path: `${out}/c2-multi.png` });
  await page.locator('.preview').focus();
  await page.keyboard.press('Alt+KeyW');
  await wait(500);
  const tops = await Promise.all(['a', 'b', 'c'].map(async (id) => (await rect(id)).y));
  if (Math.max(...tops) - Math.min(...tops) > 0.6) fail(`align top: tops ${tops.join(', ')}`);
  await page.locator('.arrange-bar button[aria-label="Distribute horizontally"]').click();
  await wait(500);
  const xs = (await Promise.all(['a', 'b', 'c'].map(rect))).sort((p, q) => p.x - q.x);
  const g1 = xs[1].x - (xs[0].x + xs[0].width);
  const g2 = xs[2].x - (xs[1].x + xs[1].width);
  if (Math.abs(g1 - g2) > 1.5) fail(`distribute: gaps ${g1} and ${g2}`);
  await page.screenshot({ path: `${out}/c3-aligned.png` });
  // Two steps back: the distribute, then the align; nothing pinned any more.
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+z');
  await page.keyboard.press('Meta+z');
  await wait(500);
  if (Object.keys((await pins()).nodes ?? {}).length) fail('two undos did not take back align + distribute');
  // From the command palette too.
  await page.keyboard.press('Meta+k');
  await page.keyboard.type('align left');
  await page.keyboard.press('Enter');
  await wait(500);
  const lefts = await Promise.all(['a', 'b', 'c'].map(async (id) => (await rect(id)).x));
  if (Math.max(...lefts) - Math.min(...lefts) > 0.6) fail(`palette align left: ${lefts.join(', ')}`);
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+z');
  await page.keyboard.press('Escape');
  await wait(400);
}

// 3. Bend a line: select it, drag a segment grip across; the bend is kept in the sidecar; Reset line takes it out.
{
  const edge = page.locator('.drawing [data-edge="e2"]');
  await edge.locator('path').last().click({ force: true });
  await wait();
  const grips = page.locator('.bend-handle');
  if (!(await grips.count())) fail('no segment grips on the selected line');
  else {
    const g = await grips.first().boundingBox();
    const horizontal = (await grips.first().getAttribute('data-horizontal')) != null;
    const to = horizontal ? { x: centre(g).x, y: centre(g).y + 70 } : { x: centre(g).x + 70, y: centre(g).y };
    await drag(centre(g), to, 10, { shot: 'c4-bending.png' });
    const via = (await pins()).edges?.e2?.via;
    if (!via?.length) fail('bend not stored in the sidecar: ' + JSON.stringify(await pins()));
    const d = await edge.locator('path').last().getAttribute('d');
    await page.screenshot({ path: `${out}/c5-bent.png` });
    if (!/^M[\d.\s,-]+(L[\d.\s,-]+)+$/.test(d?.replace(/[QC][^LM]*/g, 'L0 0') ?? '')) fail('bent line path looks odd: ' + d);
    const reset = page.locator('.inspector button:has-text("Reset line")');
    if (!(await reset.isVisible())) fail('no Reset line in the inspector');
    else {
      await reset.click();
      await wait(500);
      if ((await pins()).edges) fail('Reset line left the bend');
      await page.locator('.preview').focus();
      await page.keyboard.press('Meta+z');
      await wait(500);
      if (!(await pins()).edges?.e2) fail('undo did not bring the bend back');
      await page.keyboard.press('Meta+z');
      await wait(500);
      if ((await pins()).edges) fail('second undo did not take the bend back');
    }
  }
  await page.locator('.preview').focus();
  await page.keyboard.press('Escape');
}

// 4. Keyboard canvas: Tab focuses with a visible ring and an announcement, arrows nudge 8px, ⌥ arrows move the focus.
{
  await page.locator('.preview').focus();
  await page.keyboard.press('Tab');
  await wait();
  const first = (await status()).match(/mouse-pointer|(\S+)\s*$/);
  if (!(await page.locator('.selection-ring.focus').count())) fail('no focus ring after Tab');
  const said = await page.locator('.preview > .sr-only[role="status"]').innerText();
  if (!said.trim()) fail('focused element not announced');
  if ((await page.locator('.preview').getAttribute('aria-activedescendant')) !== 'canvas-focus') fail('aria-activedescendant missing');
  const sel = await selectedId();
  const before = await rect(sel);
  await page.keyboard.press('ArrowRight');
  await wait(500);
  const after = await rect(sel);
  const scale = parseFloat(await zoom()) / 100;
  if (Math.abs(after.x - before.x - 8 * scale) > 1) fail(`arrow nudge moved ${(after.x - before.x) / scale}px, not 8`);
  await page.screenshot({ path: `${out}/c6-focus.png` });
  const ids = [];
  for (const k of ['Alt+ArrowRight', 'Alt+ArrowDown', 'Alt+ArrowLeft', 'Alt+ArrowUp']) {
    await page.keyboard.press(k);
    await wait(200);
    ids.push(await selectedId());
  }
  if (new Set([sel, ...ids]).size < 2) fail(`⌥ arrows did not move the focus: ${[sel, ...ids].join(' → ')}`);
  void first;
  await page.keyboard.press('Meta+z');
  await wait(300);
}

// 5. Lock: ⇧⌘L locks the selection with a badge; dragging it then does not move it.
{
  await page.locator('.drawing [data-node="d"]').click();
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+Shift+KeyL');
  await wait(500);
  if (!(await page.locator('.lock-badge').count())) fail('no lock badge');
  if (!(await pins()).locked?.includes('d')) fail('lock not stored');
  // A locked shape is not dragged (the view pans instead): it keeps its place relative to a neighbour.
  const d0 = await rect('d');
  const a0 = await rect('a');
  await drag(centre(d0), { x: centre(d0).x + 80, y: centre(d0).y + 40 });
  const d1 = await rect('d');
  const a1 = await rect('a');
  if (Math.abs(d1.x - a1.x - (d0.x - a0.x)) > 1 || Math.abs(d1.y - a1.y - (d0.y - a0.y)) > 1) fail('locked shape moved relative to the others');
  await page.screenshot({ path: `${out}/c7-locked.png` });
  await page.locator('.drawing [data-node="d"]').click();
  if (!(await page.locator('.inspector button:has-text("Unlock")').isVisible())) fail('no Unlock in the inspector');
  await page.locator('.inspector button:has-text("Unlock")').click();
  await wait(500);
  if ((await pins()).locked) fail('unlock did not clear the lock');
}

// 6. Zoom keys: ⇧2 zooms to the selection (at most 200%), ⇧1 fits; the minimap shows when zoomed in and pans on click.
{
  await page.locator('.preview').focus();
  await page.keyboard.press('Shift+Digit1');
  await wait(200);
  const fitted = await zoom();
  await page.locator('.drawing [data-node="a"]').click();
  await page.locator('.preview').focus();
  await page.keyboard.press('Shift+Digit2');
  await wait(300);
  const close = await zoom();
  if (close === fitted || parseInt(close) > 200) fail(`⇧2 zoom: ${fitted} → ${close}`);
  const a = await rect('a');
  const pane = await page.locator('.preview').boundingBox();
  if (Math.abs(centre(a).x - (pane.x + pane.width / 2)) > 30) fail('⇧2 did not centre the selection');
  if (!(await page.locator('.minimap').isVisible())) fail('no minimap when the drawing does not fit');
  else {
    await page.screenshot({ path: `${out}/c8-zoomed.png` });
    const m = await page.locator('.minimap svg').boundingBox();
    const before = await rect('a');
    await page.mouse.click(m.x + m.width - 4, m.y + m.height - 4);
    await wait(200);
    const moved = await rect('a');
    if (Math.abs(moved.x - before.x) < 5 && Math.abs(moved.y - before.y) < 5) fail('minimap click did not pan');
    await page.keyboard.press('Shift+KeyM');
    await wait(200);
    if (await page.locator('.minimap').count()) fail('⇧M did not hide the minimap');
  }
  await page.locator('.preview').focus();
  await page.keyboard.press('Shift+Digit1');
  await wait(300);
  if ((await zoom()) !== fitted) fail(`⇧1 did not fit again: ${await zoom()} vs ${fitted}`);
}

// 7. Grid snap: ⇧G, then a free drag lands on the 8px grid; the shortcuts sheet lists the new keys.
{
  await page.locator('.preview').focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+KeyG');
  await wait(200);
  // The switch is in ⋯ (no longer on the zoom bar): it shows the grid as on.
  await page.click('.canvas-tools button[aria-label="More tools"]');
  if ((await page.locator('.menu [role=menuitemcheckbox]:has-text("Snap to grid")').getAttribute('aria-checked')) !== 'true') fail('⇧G did not turn on the grid');
  await page.keyboard.press('Escape');
  const b = await rect('b');
  await drag(centre(b), { x: centre(b).x + 37, y: centre(b).y + 61 }, 10, { alt: false });
  const pin = (await pins()).nodes?.b;
  if (!pin) fail('grid drag did not pin');
  // Snapped to a guide or to the grid: either way on whole steps unless it lined up with another node.
  else if (pin.x % 8 && pin.y % 8) fail(`grid snap: pin ${JSON.stringify(pin)}`);
  await page.keyboard.press('Shift+KeyG');
  await page.keyboard.press('?');
  await wait(200);
  const sheet = await page.locator('.shortcuts').innerText();
  for (const k of ['⌥A', '⌥⇧H', '⇧⌘L', '⇧1', '⇧2', '⌥ ← ↑ → ↓']) if (!sheet.includes(k)) fail(`shortcuts sheet misses ${k}`);
  await page.screenshot({ path: `${out}/c9-shortcuts.png` });
  await page.keyboard.press('Escape');
}

// Hover: a quiet outline on what a click would select, a box's lines in ink; none while dragging.
{
  await page.locator('.preview').focus();
  await page.keyboard.press('Escape');
  await wait(200);
  const lit = () => page.evaluate(() => [...document.querySelectorAll('.drawing [data-edge]')].filter((g) => g.querySelector('.lit-stroke')).length);
  const ring = () => page.evaluate(() => {
    const r = document.querySelector('.hover-ring')?.getBoundingClientRect();
    return r && { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
  });
  const a = await rect('a');
  await page.mouse.move(centre(a).x, centre(a).y);
  await wait(200);
  const r = await ring();
  if (!r || r.x > a.x || r.y > a.y || r.right < a.x + a.width || r.bottom < a.y + a.height) fail(`hovering a does not outline it: ${JSON.stringify(r)} round ${JSON.stringify(a)}`);
  // a -> b and a -> c; c -> d stays as drawn.
  if ((await lit()) !== 2) fail(`hovering a lights ${await lit()} lines, not its 2`);
  await page.screenshot({ path: `${out}/c10-hover.png` });
  await page.mouse.down();
  await page.mouse.move(centre(a).x + 30, centre(a).y + 20, { steps: 4 });
  if ((await ring()) || (await lit())) fail('the hover outline or lit lines show while dragging');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await wait(300);
  // Over the empty table: nothing outlined.
  const f = await page.locator('.preview').boundingBox();
  await page.mouse.move(f.x + 20, f.y + f.height - 20);
  await wait(200);
  if ((await ring()) || (await lit())) fail('the hover outline stays after the pointer left the box');
  // Out of the pane altogether, straight from a box: its connect handle goes too.
  await page.mouse.move(centre(a).x, centre(a).y);
  await wait(200);
  if (!(await page.locator('.connect-handle').count())) fail('no connect handle on the hovered box');
  await page.mouse.move(f.x + f.width / 2, 5);
  await wait(200);
  if (await page.locator('.connect-handle').count()) fail('the connect handle stays after the pointer left the drawing');
  if (await ring()) fail('the hover outline stays after the pointer left the drawing');
}

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'craft ok');
await browser.close();
