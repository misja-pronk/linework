// Layout stability: the first pin (nudge or drag) moves only that node, the drawing comes back the
// same after a reload, an edit keeps what was there in place, and Reset layout draws from scratch:
// node e2e/stability.mjs <outDir>
import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const problems = [];
const fail = (m) => problems.push(m);
let page;
/** A fresh browser profile with one document in it, drawn. */
const openDoc = async (text, name, last) => {
  page = await (await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 })).newPage();
  page.on('pageerror', (e) => fail(e.message));
  // Seeded before the app starts (a reload would save the open document over it on the way out).
  await page.addInitScript(
    ({ text, name }) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.clear();
      for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'code', 'yaml-folded': false, doc: { text, doc: { name } } })) localStorage.setItem(`linework:${k}`, JSON.stringify(v));
    },
    { text, name },
  );
  await page.goto(process.env.LINEWORK_URL ?? 'http://localhost:5178/');
  await page.waitForSelector(`.drawing [data-node="${last}"]`, { timeout: 10000 }).catch(async (e) => {
    await page.screenshot({ path: `${out}/s0-failed.png` });
    throw e;
  });
  await page.waitForTimeout(500);
};
const wait = (ms = 300) => page.waitForTimeout(ms);
const stored = async () => {
  await wait(450);
  return page.evaluate(() => JSON.parse(localStorage.getItem('linework:doc') ?? '{}'));
};
// Top-left corners in the drawing's own coordinates: zooming and panning do not change them.
const corners = () =>
  page.evaluate(() => {
    const svg = document.querySelector('.drawing svg');
    const inv = svg.getScreenCTM().inverse();
    const at = {};
    for (const g of document.querySelectorAll('.drawing [data-node]')) {
      const r = g.querySelector('rect').getBoundingClientRect();
      const p = new DOMPoint(r.x, r.y).matrixTransform(inv);
      at[g.getAttribute('data-node')] = { x: p.x, y: p.y };
    }
    return at;
  });
const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
/** Ids that moved more than `slack` px, once the drawing as a whole is slid back (a pin can grow the canvas). */
const moved = (before, after, skip = [], slack = 1.5) => {
  const ids = Object.keys(before).filter((id) => after[id] && !skip.includes(id));
  const dx = median(ids.map((id) => after[id].x - before[id].x));
  const dy = median(ids.map((id) => after[id].y - before[id].y));
  return ids.filter((id) => Math.hypot(after[id].x - before[id].x - dx, after[id].y - before[id].y - dy) > slack);
};
const screen = (id) => page.locator(`.drawing [data-node="${id}"] > rect`).first().boundingBox();
const centre = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const down = (at) => Object.values(at).every((p) => Math.abs(p.x - at.a.x) < 2);

// A chain with the direction left open: far too wide left to right, so it is drawn top-down.
const ids = 'abcdefgh'.split('');
const chain = `type: azure\nnodes:\n${ids.map((id) => `  ${id}: app-service\n`).join('')}edges:\n${ids.slice(1).map((id, i) => `  - ${ids[i]} -> ${id}\n`).join('')}`;
await openDoc(chain, 'stability.yaml', 'h');
const start = await corners();
await page.screenshot({ path: `${out}/s0-start.png` });
if (!down(start)) fail('the chain was not drawn top-down: ' + JSON.stringify(start));

// 1. The first pin by keyboard: d moves 8px right, nothing else moves, and the drawing stays top-down.
{
  await page.locator('.drawing [data-node="d"]').click();
  await page.locator('.preview').focus();
  await page.keyboard.press('ArrowRight');
  await wait(600);
  const now = await corners();
  await page.screenshot({ path: `${out}/s1-nudged.png` });
  const others = moved(start, now, ['d']);
  if (others.length) fail(`first nudge moved other nodes: ${others.join(', ')}`);
  const dx = now.d.x - start.d.x - (now.a.x - start.a.x);
  if (Math.abs(dx - 8) > 1) fail(`nudge moved d by ${dx}, not 8`);
  if (!down({ ...now, d: now.a })) fail('the first pin turned the drawing: ' + JSON.stringify(now));
  const pins = (await stored()).pins ?? {};
  if (!pins.nodes?.d) fail('nudge did not pin d');
  if (!/^down\//.test(pins.layout?.variant ?? '')) fail('the pin did not record how the drawing was made: ' + JSON.stringify(pins.layout));
  if (pins.layout?.at !== undefined) fail('positions written to the sidecar without being asked for');

  // 2. Reloaded (pins and their note come back from storage): the same drawing.
  await page.reload();
  await page.waitForSelector('.drawing [data-node="h"]');
  await wait(600);
  const again = await corners();
  const changed = moved(now, again, [], 0.6);
  if (changed.length || Math.abs(again.d.x - again.a.x - (now.d.x - now.a.x)) > 0.6) fail(`the drawing changed over a reload: ${changed.join(', ')}`);
  await page.screenshot({ path: `${out}/s2-reloaded.png` });

  // Unpinned again: everything is where it started.
  await page.click('.canvas-tools button[aria-label="More tools"]');
  await page.locator('.canvas-tools .menu [role="menuitem"]:has-text("Tidy all")').click();
  await wait(600);
  const back = await corners();
  if (moved(start, back).length || Math.abs(back.d.x - back.a.x) > 1) fail('reset did not put the chain back');
  if ((await stored()).pins) fail('reset left pins behind');
}

// 3. The first pin by drag: f goes far to the right, the rest stays.
{
  const before = await corners();
  const f = centre(await screen('f'));
  await page.mouse.move(f.x, f.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(f.x + i * 22, f.y + i * 3);
  await wait(300);
  const mid = await corners();
  await page.screenshot({ path: `${out}/s3-dragging.png` });
  if (moved(before, mid, ['f']).length) fail(`dragging moved other nodes: ${moved(before, mid, ['f']).join(', ')}`);
  await page.mouse.up();
  await wait(600);
  const now = await corners();
  await page.screenshot({ path: `${out}/s3-dragged.png` });
  const others = moved(before, now, ['f']);
  if (others.length) fail(`first drag moved other nodes: ${others.join(', ')}`);
  if (now.f.x - now.a.x < 60) fail('the drag did not move f');
  if (!down({ ...now, f: now.a })) fail('the drag turned the drawing');
  await page.keyboard.press('Meta+z');
  await wait(500);
}

// 4. An edit keeps the picture: a line added in the YAML leaves every node where it was, where a
//    drawing from scratch would shuffle them. Reset layout then shows that other drawing.
{
  const web = ['a -> b', 'a -> c', 'b -> d', 'c -> d', 'd -> e', 'a -> e', 'c -> f', 'f -> e', 'b -> g', 'g -> e'];
  const text = `type: azure\ndirection: right\nnodes:\n${'abcdefg'.split('').map((id) => `  ${id}: app-service\n`).join('')}edges:\n${web.map((l) => `  - ${l}\n`).join('')}`;
  await openDoc(text, 'web.yaml', 'g');
  const before = await corners();
  const lines = await page.locator('.drawing [data-edge]').count();
  await page.screenshot({ path: `${out}/s4-before.png` });
  await page.click('.cm-content');
  await page.keyboard.press('Meta+End');
  await page.keyboard.type('  - b -> f');
  await page.waitForFunction((n) => document.querySelectorAll('.drawing [data-edge]').length > n, lines, { timeout: 5000 }).catch(() => fail('the new line was not drawn'));
  await wait(600);
  const after = await corners();
  await page.screenshot({ path: `${out}/s4-edited.png` });
  const jumped = moved(before, after);
  if (jumped.length) fail(`adding a line moved ${jumped.length} of ${Object.keys(before).length} nodes: ${jumped.join(', ')}`);
  // Kept from the drawing before, so there is something to reset to; from scratch it differs.
  await page.click('.canvas-tools button[aria-label="More tools"]');
  const reset = page.locator('.canvas-tools .menu [role="menuitem"]:has-text("Tidy all")');
  if (await reset.count()) {
    await reset.click();
    await wait(700);
    const scratch = await corners();
    await page.screenshot({ path: `${out}/s4-reset.png` });
    if (!moved(after, scratch).length) fail('Reset layout was offered, but drew the same thing');
    await page.click('.canvas-tools button[aria-label="More tools"]');
    if (await reset.count()) fail('Reset layout still offered after a reset');
    await page.keyboard.press('Escape');
  } else {
    await page.keyboard.press('Escape');
    console.log('note: the drawing from scratch was the same, so nothing was held');
  }
}

// 5. Edits in the editor's drawing keep the picture as a session's do: adding a box (the add menu), a
//    rename, a delete, Undo and Redo each leave the boxes that were there within a few pixels.
{
  const text = `type: azure
groups:
  rg: { kind: resource-group, label: rg-shop }
nodes:
  gw: { kind: front-door, label: Front Door }
  web: { kind: app-service, label: Web, in: rg }
  api: { kind: function-app, label: API, in: rg }
  auth: { kind: entra-id, label: Entra ID }
  db: { kind: sql-database, label: Orders DB, in: rg }
  cache: { kind: redis, label: Cache, in: rg }
  bus: { kind: service-bus, label: Bus, in: rg }
  worker: { kind: container-app, label: Worker, in: rg }
edges:
  - gw -> web
  - web -> api
  - api -> db
  - api -> cache
  - api -> bus
  - bus -> worker
  - web -> auth
`;
  await openDoc(text, 'editor.yaml', 'worker');
  const select = async (id) => {
    await page.locator(`.drawing [data-node="${id}"]`).click();
    await wait(300);
  };
  const steps = [
    ['add a Key Vault', async () => (await select('api'), await page.keyboard.press('Escape'), await page.keyboard.press('a'), await page.keyboard.type('key vault'), await page.keyboard.press('Enter'))],
    ['rename Bus', async () => (await select('bus'), await page.keyboard.press('F2'), await page.keyboard.type('Orders bus'), await page.keyboard.press('Enter')), ['bus']],
    ['delete Cache', async () => (await select('cache'), await page.keyboard.press('Delete'))],
    ['undo', async () => (await page.locator('.preview').focus(), await page.keyboard.press('Meta+z'))],
    ['redo', async () => (await page.locator('.preview').focus(), await page.keyboard.press('Meta+Shift+z'))],
  ];
  const worst = [];
  for (const [what, act, skip = []] of steps) {
    const before = await corners();
    await act();
    await wait(700);
    const after = await corners();
    const jumped = moved(before, after, skip, 4);
    worst.push(`${what}: ${jumped.length ? jumped.join(', ') : 'nothing moved'}`);
    if (jumped.length) fail(`${what} in the editor moved ${jumped.join(', ')} over 4px`);
    if (what === 'delete Cache' && after.cache) fail('Delete did not remove Cache');
    if (what === 'undo' && !after.cache) fail('Undo did not bring Cache back');
    if (what === 'add a Key Vault') {
      if (!after['key-vault']) fail('the add menu did not add a Key Vault');
      await page.screenshot({ path: `${out}/s5-added.png` });
    }
  }
  console.log(`editor edits: ${worst.join('; ')}`);
}

await browser.close();
if (problems.length) {
  console.error(problems.map((p) => `FAIL ${p}`).join('\n'));
  process.exit(1);
}
console.log('stability ok');
