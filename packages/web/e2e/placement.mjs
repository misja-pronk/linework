// Free placement that stays put: a drop stays where it lands and its neighbours where they were, a
// group that grows pushes what is in its way out (nothing overlaps), shift-L pins and unpins, arrows
// carry a group with what it holds, Tidy keeps the pins and Tidy all takes them (undoably), and a
// line's segment drags and its bend comes out with a double-click: node e2e/placement.mjs <outDir>
import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const problems = [];
const fail = (m) => problems.push(m);
const page = await (await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
const text = 'type: azure\ntitle: Drops\ngroups:\n  sub: { kind: subscription, label: Subscription }\n  rg: { kind: resource-group, label: Resource group, in: sub }\nnodes:\n  app: { kind: app-service, label: App Service, in: rg }\n  users: { kind: users, label: Users }\nedges:\n  - users -> app\n';
await page.addInitScript((text) => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  localStorage.clear();
  for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'code', doc: { text, doc: { name: 'placement.yaml' } } })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
}, text);
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.waitForSelector('.drawing [data-node="app"]');
// The trackpad way: the shapes listed beside the drawing in the builder.
await page.locator('.view-switch button', { hasText: 'Builder' }).click();
await wait(600);
await page.locator('.preview').focus();
await page.keyboard.press('Meta+0');
await wait(400);

const pins = async () => {
  await wait(450);
  return (await page.evaluate(() => JSON.parse(localStorage.getItem('cartography:doc') ?? '{}'))).pins ?? {};
};
/** Boxes in the drawing's own coordinates (zoom and pan do not change them), nodes and groups. */
const boxes = () =>
  page.evaluate(() => {
    const svg = document.querySelector('.drawing svg');
    const inv = svg.getScreenCTM().inverse();
    const at = {};
    for (const g of document.querySelectorAll('.drawing [data-node], .drawing [data-group]')) {
      const r = g.querySelector(':scope > rect')?.getBoundingClientRect();
      if (!r) continue;
      const p = new DOMPoint(r.x, r.y).matrixTransform(inv);
      const q = new DOMPoint(r.x + r.width, r.y + r.height).matrixTransform(inv);
      at[g.getAttribute('data-node') ?? g.getAttribute('data-group')] = { x: p.x, y: p.y, width: q.x - p.x, height: q.y - p.y };
    }
    return at;
  });
const screen = (sel) => page.locator(sel).first().boundingBox();
const centre = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
/** How far each element moved, once the drawing as a whole is slid back (a pin can grow the canvas); `anchor` says what did not move. */
const shifts = (before, after, anchor) => {
  const dx = after[anchor].x - before[anchor].x;
  const dy = after[anchor].y - before[anchor].y;
  return Object.fromEntries(Object.keys(before).filter((id) => after[id]).map((id) => [id, Math.round(Math.hypot(after[id].x - before[id].x - dx, after[id].y - before[id].y - dy))]));
};
const pinnedNow = async () => Number((await page.locator('.statusbar').innerText()).match(/(\d+) pinned/)?.[1] ?? 0);
const paletteDrop = async (label, at) => {
  const it = await page.locator(`.add-item:has-text("${label}")`).first().boundingBox();
  await page.mouse.move(it.x + it.width / 2, it.y + it.height / 2);
  await page.mouse.down();
  await page.mouse.move(it.x + 120, it.y, { steps: 4 });
  await page.mouse.move(at.x, at.y, { steps: 12 });
  await wait(300);
  await page.mouse.move(at.x + 1, at.y);
  await wait(300);
  await page.mouse.up();
  await wait(800);
  await page.locator('.preview').focus();
  await page.keyboard.press('Escape');
  await wait(300);
};
/** Displacement budget (drawing px) for something that had to make room: its own size and the air around it. */
const ROOM = 260;

// 1. A drop that has room: it stays where it lands, nothing else moves at all.
const b0 = await boxes();
{
  const rg = await screen('.drawing [data-group="rg"] > rect');
  const app = await screen('.drawing [data-node="app"] > rect');
  await paletteDrop('SQL Database', { x: app.x + app.width / 2, y: rg.y + rg.height - 6 });
  const b1 = await boxes();
  if (!b1['sql-database']) fail('the drop did not draw SQL Database');
  const moved = shifts(b0, b1, 'app');
  if (moved.users > 0) fail(`a drop with room moved Users by ${moved.users}px`);
  if (overlaps(b1.users, b1.sub)) fail('Users lies on the subscription after the drop');
  await page.screenshot({ path: `${out}/p1-dropped.png` });
}

// 2. A drop that grows the group into Users: Users moves out of the way, no further than it must; App Service stays.
{
  const b1 = await boxes();
  const rg = await screen('.drawing [data-group="rg"] > rect');
  await paletteDrop('Function App', { x: rg.x + 30, y: rg.y + rg.height - 10 });
  const b2 = await boxes();
  if (!b2['function-app']) fail('the second drop did not draw Function App');
  const moved = shifts(b1, b2, 'app');
  if (moved['sql-database'] > 0) fail(`the pinned SQL Database moved by ${moved['sql-database']}px`);
  if (moved.users > ROOM) fail(`Users moved ${moved.users}px, over the ${ROOM}px budget`);
  for (const g of ['sub', 'rg']) if (overlaps(b2.users, b2[g])) fail(`Users overlaps ${g} after the group grew: ${JSON.stringify([b2.users, b2[g]])}`);
  console.log(`displacement after a crowding drop: Users ${moved.users}px, App Service ${moved.app}px`);
  await page.screenshot({ path: `${out}/p2-pushed.png` });
}

// 3. Shift-L pins and unpins; a pin shows on what is pinned.
{
  await page.locator('.drawing [data-node="app"]').click();
  await page.locator('.preview').focus();
  const n0 = await pinnedNow();
  const badges0 = await page.locator('.pin-badge').count();
  await page.keyboard.press('Shift+L');
  await wait(600);
  if ((await pinnedNow()) !== n0 + 1) fail(`shift-L did not pin App Service: ${n0} → ${await pinnedNow()}`);
  if ((await page.locator('.pin-badge').count()) !== badges0 + 1) fail('no pin shows on the pinned App Service');
  await page.keyboard.press('Shift+L');
  await wait(600);
  if ((await pinnedNow()) !== n0) fail('shift-L again did not unpin App Service');
  await page.keyboard.press('Escape');
}

// 4. Arrows move a group with everything in it, pinned or not.
{
  const before = await boxes();
  const head = await screen('.drawing [data-group="rg"] > rect');
  await page.mouse.click(head.x + head.width - 30, head.y + 12);
  await wait(300);
  await page.locator('.preview').focus();
  await page.keyboard.press('ArrowDown');
  await wait(700);
  const after = await boxes();
  const p = await pins();
  if (!p.groups?.rg) fail('the arrow did not pin the resource group: ' + JSON.stringify(p));
  const dy = (id) => Math.round(after[id].y - before[id].y - (after.users.y - before.users.y));
  for (const id of ['rg', 'app', 'sql-database']) if (dy(id) !== 8) fail(`${id} moved ${dy(id)}px with its group, not 8`);
  await page.keyboard.press('Escape');
}

// 5. Tidy keeps the pins (and forgets how it was drawn); Tidy all takes them, and ⌘Z brings them back.
{
  const before = await pins();
  await page.locator('.preview').focus();
  await page.keyboard.press('t');
  await wait(800);
  const tidied = await pins();
  for (const id of Object.keys(before.nodes ?? {})) if (JSON.stringify(tidied.nodes?.[id]) !== JSON.stringify(before.nodes[id])) fail(`Tidy moved the pin of ${id}`);
  const b = await boxes();
  for (const id of ['users']) for (const g of ['sub', 'rg']) if (overlaps(b[id], b[g])) fail(`after Tidy ${id} overlaps ${g}`);
  await page.screenshot({ path: `${out}/p3-tidied.png` });
  await page.keyboard.press('Shift+T');
  await wait(800);
  const all = await pins();
  if (all.nodes || all.groups) fail('Tidy all left pins: ' + JSON.stringify(all));
  await page.keyboard.press('Meta+z');
  await wait(800);
  if (!(await pins()).nodes) fail('⌘Z did not bring the pins back after Tidy all');
}

// 6. A line: drag a segment across (kept in the sidecar), then double-click its bend to take it out.
{
  const edge = page.locator('.drawing [data-edge]').first();
  const id = await edge.getAttribute('data-edge');
  await edge.locator('path').last().click({ force: true });
  await wait(300);
  const grips = page.locator('.bend-handle');
  if (!(await grips.count())) fail('no segment grips on the selected line');
  else {
    const g = await grips.last().boundingBox();
    const horizontal = (await grips.last().getAttribute('data-horizontal')) != null;
    const from = centre(g);
    const to = horizontal ? { x: from.x, y: from.y + 60 } : { x: from.x + 60, y: from.y };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
    await wait(700);
    const via = (await pins()).edges?.[id]?.via;
    if (!via?.length) fail('the dragged segment is not kept in the sidecar');
    await page.screenshot({ path: `${out}/p4-bent.png` });
    // A bend on screen: where two neighbouring grips' segments meet (a grip sits mid-segment).
    const gs = await page.locator('.bend-handle').evaluateAll((els) => els.map((e) => ({ i: Number(e.dataset.bend), h: e.dataset.horizontal != null, ...(({ x, y, width, height }) => ({ x: x + width / 2, y: y + height / 2 }))(e.getBoundingClientRect()) })));
    let corner;
    for (let k = Math.floor(gs.length / 2), tries = 0; tries < gs.length && !corner; tries++, k = (k + 1) % gs.length) {
      const [a, b] = [gs[k], gs[k + 1]];
      if (a && b && b.i === a.i + 1 && a.h !== b.h) corner = a.h ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    }
    if (!corner) fail('no two neighbouring grips to find a bend between');
    const n0 = via.length;
    if (corner) await page.mouse.dblclick(corner.x, corner.y);
    await wait(700);
    const after = (await pins()).edges?.[id]?.via ?? [];
    if (after.length >= n0) fail(`double-clicking a bend did not take it out: ${n0} → ${after.length} bends`);
    await page.screenshot({ path: `${out}/p5-unbent.png` });
  }
}

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all placement steps ok');
await browser.close();
process.exitCode = problems.length ? 1 : 0;
