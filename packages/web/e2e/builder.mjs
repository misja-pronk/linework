// Drives the builder like a person and checks the YAML after each step: node e2e/builder.mjs <outDir>
import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => m.text().startsWith('DBG') && console.log(m.text()));
page.on('console', async (m) => { if (m.type() === 'error' && m.text().includes('render failed')) problems.push('console: ' + (await Promise.all(m.args().map((a) => a.evaluate((v) => (v instanceof Error ? v.stack : String(v)))))).join(' ')); });
const fail = (m) => problems.push(m);
const yaml = () => page.evaluate(() => document.querySelector('.cm-content').innerText);
const wait = (ms = 250) => page.waitForTimeout(ms);

await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('cartography:started', 'true');
});
await page.reload();
await page.waitForSelector('.drawing svg');
await page.click('button[aria-label="Dismiss hint"]');
// Start from the Azure template.
await page.keyboard.press('Meta+k');
await page.keyboard.type('azure infrastructure template');
await page.keyboard.press('Enter');
await wait(500);

// 1. Select a node: inspector opens with its fields.
const node = page.locator('.drawing [data-node="web"]');
await node.click();
await wait();
if (!(await page.locator('.inspector').isVisible())) fail('inspector did not open');
await page.screenshot({ path: `${out}/1-inspector.png` });
// The form leads with what the element is about; the id and rarer fields wait under "More".
const firstFields = await page.locator('.inspector-body > .field > span').allInnerTexts();
if (firstFields.slice(0, 3).join() !== 'Label,Kind,Inside') fail('inspector does not lead with Label, Kind, Inside: ' + firstFields.join());
if (await page.locator('.inspector .field:has(> span:text-is("ID")) input').isVisible()) fail('the ID is not under More');

// 2. Change the label in the inspector.
const labelInput = page.locator('.inspector .field:has(> span:text-is("Label")) input');
await labelInput.fill('Storefront');
await labelInput.press('Enter');
await wait(400);
if (!(await yaml()).includes('label: Storefront')) fail('label not written to YAML');

// 3. Add a Key Vault with the keyboard.
await page.locator('.preview').focus();
await page.keyboard.press('Escape');
await page.keyboard.press('a');
await page.keyboard.type('key vault');
await page.keyboard.press('Enter');
await wait(500);
if (!/key-vault: \{ kind: key-vault, label: Key Vault/.test(await yaml())) fail('palette add did not write YAML');
await page.screenshot({ path: `${out}/2-added.png` });

// 4. Drag a node: it gets pinned and lines follow.
const box = await page.locator('.drawing [data-node="db"]').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
// A small move, staying inside its subnet.
for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + box.width / 2 + i * 3, box.y + box.height / 2 + i * 2);
await page.mouse.up();
await wait(400);
const pinned = await page.locator('.statusbar').innerText();
if (!pinned.includes('1 pinned')) fail(`drag did not pin: ${pinned}`);
await page.screenshot({ path: `${out}/3-dragged.png` });

// 5. Undo from the canvas undoes the move, then the add.
await page.locator('.preview').focus();
await page.keyboard.press('Meta+z');
await wait(300);
if ((await page.locator('.statusbar').innerText()).includes('pinned')) fail('undo did not unpin');
await page.keyboard.press('Meta+z');
await wait(300);
if ((await yaml()).includes('key-vault:')) fail('second undo did not remove the added node');
await page.keyboard.press('Meta+Shift+z');
await wait(300);
if (!(await yaml()).includes('key-vault:')) fail('redo did not bring the node back');

// 6. Rename through the inspector updates references (the ID is under More, which stays open).
await page.locator('.drawing [data-node="db"]').click();
await wait();
await page.locator('.inspector-more summary').click();
await wait(150);
await page.locator('.drawing [data-node="api"]').click();
await wait();
if (!(await page.locator('.inspector-more').evaluate((d) => d.open))) fail('More did not stay open for the next element');
await page.locator('.drawing [data-node="db"]').click();
await wait();
const id = page.locator('.inspector .field:has(> span:text-is("ID")) input');
await id.fill('orders-db');
await id.press('Enter');
await wait(400);
const y = await yaml();
if (!y.includes('orders-db:') || y.includes(' db:') || !/-> orders-db/.test(y)) fail('rename did not update references');

// 7. Delete with the keyboard removes edges too.
await page.locator('.preview').focus();
await page.keyboard.press('Delete');
await wait(400);
if ((await yaml()).includes('orders-db')) fail('delete left references');
await page.screenshot({ path: `${out}/4-deleted.png` });

// 8. Drag from the palette into a group (everything in view first).
await page.locator('.preview').focus();
await page.keyboard.press('Escape');
await page.keyboard.press('Meta+0');
await wait(300);
await page.keyboard.press('a');
await wait();
const item = page.locator('.add-item:has-text("Function App")').first();
const target = await page.locator('.drawing [data-group]').last().boundingBox();
await item.dragTo(page.locator('.preview'), { targetPosition: { x: target.x - (await page.locator('.preview').boundingBox()).x + 40, y: target.y - (await page.locator('.preview').boundingBox()).y + 60 } });
await wait(500);
if (!/function-app: \{ kind: function-app, label: Function App, in: /.test(await yaml())) fail('palette drop did not nest: ' + (await yaml()).split('\n').filter((l) => l.includes('function-app')).join(' | '));
await page.screenshot({ path: `${out}/5-dropped.png` });

// 9. Connect by dragging the handle from one node to another (nothing selected, all in view).
await page.locator('.preview').focus();
await page.keyboard.press('Escape');
await page.keyboard.press('Meta+0');
await wait(300);
const a = await page.locator('.drawing [data-node="users"]').boundingBox();
await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
await wait(100);
const h = await page.locator('.connect-handle').boundingBox();
const b = await page.locator('.drawing [data-node="vault"]').boundingBox();
await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
await page.mouse.down();
for (let i = 1; i <= 8; i++) await page.mouse.move(h.x + ((b.x + b.width / 2 - h.x) * i) / 8, h.y + ((b.y + b.height / 2 - h.y) * i) / 8);
await page.screenshot({ path: `${out}/6-connecting.png` });
await page.mouse.up();
await wait(400);
if (!(await yaml()).includes('- users -> vault')) fail('connect did not add an edge: ' + ((await page.locator('.toast').allInnerTexts()).join() || 'no message') + '\n' + (await yaml()).split('edges:')[1]);

// 10. Select the new line (from Users' connection list) and give it a label in the inspector.
await page.locator('.preview').focus();
await page.keyboard.press('Escape');
await page.keyboard.press('Meta+0');
await wait(300);
await page.locator('.drawing [data-node="users"]').click();
await wait();
await page.locator('.connections .connection:has-text("Secrets")').click();
await wait();
const lbl = page.locator('.inspector .field:has(> span:text-is("Label")) input');
if (await lbl.count()) {
  await lbl.fill('reads');
  await lbl.press('Enter');
  await wait(400);
  if (!(await yaml()).includes('- users -> vault: reads')) fail('edge label not written');
} else fail('edge inspector has no label field');
await page.screenshot({ path: `${out}/7-edge.png` });

// 11. Drag a group by its header: the group and everything in it move.
await page.locator('.preview').focus();
await page.keyboard.press('Escape');
await page.keyboard.press('Meta+0');
await wait(300);
const before = (await page.locator('.statusbar').innerText()).match(/(\d+) pinned/)?.[1] ?? '0';
const g = await page.locator('.drawing [data-group]').first().boundingBox();
// Relative to things outside the group: the drawing re-centres and outside nodes may be pushed aside,
// so it counts when the contents moved relative to any of them.
const rel = async () => {
  const w = (await page.locator('.drawing [data-node="web"]').boundingBox()).y;
  const refs = [page.locator('.drawing svg > text').first(), page.locator('.drawing [data-node="users"]'), page.locator('.drawing [data-node="key-vault"]')];
  return Promise.all(refs.map(async (r) => w - (await r.boundingBox()).y));
};
const web = await rel();
await page.mouse.move(g.x + 60, g.y + 10);
await page.mouse.down();
// Up and to the right: down, the group would land on the pinned Function App at some pane widths.
for (let i = 1; i <= 6; i++) await page.mouse.move(g.x + 60 + i * 5, g.y + 10 - i * 4);
await page.mouse.up();
await wait(400);
const after = (await page.locator('.statusbar').innerText()).match(/(\d+) pinned/)?.[1] ?? '0';
const web2 = await rel();
if (Number(after) !== Number(before) + 1) fail(`group drag did not pin the group: ${before} → ${after}`);
const savedPins = await page.evaluate(() => JSON.parse(localStorage.getItem('cartography:doc') ?? '{}').pins);
if (!savedPins?.groups || !Object.keys(savedPins.groups).length) fail('group drag did not save a group pin: ' + JSON.stringify(savedPins));
if ((await page.locator('.status-problems').innerText()) !== 'No problems') {
  await page.click('.status-problems');
  await wait(200);
  fail('after group drag: ' + (await page.locator('.palette-list').innerText()));
  await page.keyboard.press('Escape');
}
await page.screenshot({ path: `${out}/8-group.png` });

// 12. Double-click a node: its label is edited in place; typed keys never reach the canvas shortcuts.
await page.locator('.preview').focus();
await page.keyboard.press('Escape');
await page.keyboard.press('Meta+0');
await wait(300);
const nodeCount = await page.locator('.drawing [data-node]').count();
// Unselected: the first click opens the inspector, which narrows the canvas; the second click still
// lands on the node, not on the inspector that now covers where the node was.
if (await page.locator('.inspector').count()) fail('inspector open before the double-click');
const vb = await page.locator('.drawing [data-node="vault"]').boundingBox();
await page.mouse.dblclick(vb.x + vb.width / 2, vb.y + vb.height / 2);
await wait(300);
if (!(await page.locator('.label-editor').isVisible())) fail('double-click did not open the label editor');
// "a" would add a shape and "c" connect: typed here they are just letters.
await page.keyboard.type('Vault a c');
await page.keyboard.press('Enter');
await wait(500);
if (!(await yaml()).includes('label: Vault a c')) fail('inline rename not written: ' + (await yaml()).split('\n').filter((l) => l.includes('vault:')).join());
if ((await page.locator('.drawing [data-node]').count()) !== nodeCount || (await page.locator('.add-menu:not(.inline)').count())) fail('typing in the label editor triggered canvas shortcuts');
const vb2 = await page.locator('.drawing [data-node="vault"]').boundingBox();
await page.mouse.dblclick(vb2.x + vb2.width / 2, vb2.y + vb2.height / 2);
await wait(300);
await page.keyboard.type('Nope');
await page.keyboard.press('Escape');
await wait(400);
if ((await yaml()).includes('Nope')) fail('Esc did not cancel the inline rename');
// The same at a person's pace: a pause between the clicks, the inspector already in by the second.
await page.locator('.preview').focus();
await page.keyboard.press('Escape');
await page.keyboard.press('Meta+0');
await wait(300);
const vb3 = await page.locator('.drawing [data-node="vault"]').boundingBox();
await page.mouse.click(vb3.x + vb3.width / 2, vb3.y + vb3.height / 2);
await wait(180);
await page.mouse.click(vb3.x + vb3.width / 2, vb3.y + vb3.height / 2, { clickCount: 2 });
await wait(300);
if (!(await page.locator('.label-editor').isVisible())) fail('a slower double-click did not open the label editor');
const yBefore = await yaml();
await page.keyboard.press('Escape');
await wait(300);
if ((await yaml()) !== yBefore) fail('the second click changed something in the inspector');
await page.screenshot({ path: `${out}/9-renamed.png` });

// 13. Shift-click two nodes, then a marquee around everything: both select several.
await page.locator('.preview').focus();
await page.keyboard.press('Escape');
await page.keyboard.press('Meta+0');
await wait(300);
await page.locator('.drawing [data-node="users"]').click();
await page.locator('.drawing [data-node="vault"]').click({ modifiers: ['Shift'] });
await wait(300);
if (!(await page.locator('.inspector', { hasText: '2 selected' }).count())) fail('shift-click did not select two');
if ((await page.locator('.selection-ring').count()) !== 2) fail('expected two selection rings');
await page.keyboard.press('Escape');
await page.keyboard.press('Meta+0');
await wait(300);
const all = await page.locator('.drawing').boundingBox();
await page.mouse.move(all.x - 20, all.y - 20);
await page.mouse.down();
for (let i = 1; i <= 8; i++) await page.mouse.move(all.x - 20 + ((all.width + 40) * i) / 8, all.y - 20 + ((all.height + 40) * i) / 8);
if (!(await page.locator('.marquee').count())) fail('no marquee while dragging on empty canvas');
await page.mouse.up();
await wait(300);
const selectedText = await page.locator('.inspector header').innerText().catch(() => '');
if (Number(/(\d+) selected/.exec(selectedText)?.[1] ?? 0) < 5) fail('marquee selected too little: ' + selectedText);
await page.screenshot({ path: `${out}/10-marquee.png` });

// 14. Copy and paste a selection: new unique ids, the line between them comes along, one undo step.
await page.locator('.preview').focus();
await page.keyboard.press('Escape');
await page.keyboard.press('Meta+0');
await wait(300);
await page.locator('.drawing [data-node="users"]').click();
await page.locator('.drawing [data-node="vault"]').click({ modifiers: ['Shift'] });
const before14 = await yaml();
await page.keyboard.press('Meta+c');
await page.keyboard.press('Meta+v');
await wait(600);
const y14 = await yaml();
if (!/users-2:/.test(y14) || !/vault-2:/.test(y14)) fail('paste did not add copies with new ids');
if (!y14.includes('users-2 -> vault-2')) fail('paste did not copy the line between the copies: ' + y14.split('edges:')[1]);
if (!(await page.locator('.inspector', { hasText: '2 selected' }).count())) fail('the pasted copies are not selected');
await page.screenshot({ path: `${out}/11-pasted.png` });
await page.keyboard.press('Meta+z');
await wait(400);
if ((await yaml()) !== before14) fail('one undo did not take the whole paste back');
// Delete several at once.
await page.keyboard.press('Meta+v');
await wait(600);
await page.keyboard.press('Delete');
await wait(500);
if ((await yaml()).includes('users-2') || (await yaml()).includes('vault-2')) fail('deleting the selection left copies');

// 15. Drops from the palette stay where they land: into a group that already has something in it
// (the group under the pointer is ringed and named while dragging), and into free space.
// Seeded before the app starts (it saves what it has on the way out).
await page.addInitScript(() => {
  const text = sessionStorage.getItem('seed');
  if (!text) return;
  sessionStorage.removeItem('seed');
  localStorage.setItem('cartography:doc', JSON.stringify({ text, doc: { name: 'drops.yaml' } }));
});
await page.evaluate(() => {
  const text = 'type: azure\ntitle: Drops\ngroups:\n  sub: { kind: subscription, label: Subscription }\n  rg: { kind: resource-group, label: Resource group, in: sub }\nnodes:\n  app: { kind: app-service, label: App Service, in: rg }\n  users: { kind: users, label: Users }\nedges:\n  - users -> app\n';
  sessionStorage.setItem('seed', text);
});
await page.reload();
await page.waitForSelector('.drawing [data-node="app"]');
// The trackpad way: the shapes listed beside the drawing in the builder, dragged over.
await page.locator('.view-switch button', { hasText: 'Builder' }).click();
await wait(600);
await page.locator('.preview').focus();
await page.keyboard.press('Meta+0');
await wait(500);
const pinnedNow = async () => Number((await page.locator('.statusbar').innerText()).match(/(\d+) pinned/)?.[1] ?? 0);
const centre = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const paletteDrop = async (label, at, during) => {
  const it = await page.locator(`.add-item:has-text("${label}")`).first().boundingBox();
  await page.mouse.move(it.x + it.width / 2, it.y + it.height / 2);
  await page.mouse.down();
  await page.mouse.move(it.x + 120, it.y, { steps: 4 });
  await page.mouse.move(at.x, at.y, { steps: 12 });
  await wait(300);
  // One more small move: a held drag repaints only when the pointer moves.
  await page.mouse.move(at.x + 1, at.y);
  await wait(300);
  if (during) await during();
  await page.mouse.up();
  await wait(700);
  await page.locator('.preview').focus();
  await page.keyboard.press('Escape');
  await wait(300);
};
const rg15 = await page.locator('.drawing [data-group="rg"]').boundingBox();
const app15 = await page.locator('.drawing [data-node="app"]').boundingBox();
const pins0 = await pinnedNow();
const into = { x: app15.x + app15.width / 2, y: rg15.y + rg15.height - 6 };
await paletteDrop('SQL Database', into, async () => {
  const ring = await page.locator('.drop-ring:not(.refused) > span').innerText().catch(() => '');
  if (!ring.includes('Into Resource group')) fail(`no "Into Resource group" ring while dragging over the group: "${ring}"`);
  if ((await page.locator('.drop-ghost').count()) !== 1) fail('no outline of where the dropped shape lands');
  await page.screenshot({ path: `${out}/12-dropping.png` });
});
if (!/sql-database: \{ kind: sql-database, label: SQL Database, in: rg \}/.test(await yaml())) fail('drop into a group with content did not nest: ' + (await yaml()).split('\n').filter((l) => l.includes('sql')).join());
if ((await pinnedNow()) !== pins0 + 1) fail(`the dropped shape was not pinned where it landed: ${pins0} → ${await pinnedNow()}`);
// It lands where it was let go: under App Service, clear of it, inside the group.
const sql15 = await page.locator('.drawing [data-node="sql-database"]').boundingBox();
const app15b = await page.locator('.drawing [data-node="app"]').boundingBox();
const rg15b = await page.locator('.drawing [data-group="rg"]').boundingBox();
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
if (Math.abs(centre(sql15).x - centre(app15b).x) > app15b.width / 2 || sql15.y < app15b.y + app15b.height) fail(`the shape dropped under App Service did not stay there: ${JSON.stringify(sql15)} vs ${JSON.stringify(app15b)}`);
if (overlaps(sql15, app15b)) fail('the dropped shape covers App Service');
if (sql15.x < rg15b.x || sql15.x + sql15.width > rg15b.x + rg15b.width || sql15.y + sql15.height > rg15b.y + rg15b.height) fail('the group did not grow around the dropped shape');
await page.screenshot({ path: `${out}/13-dropped-in.png` });
// Free space right of the subscription: it stays there, outside every group.
const sub15 = await page.locator('.drawing [data-group="sub"]').boundingBox();
const pane15 = await page.locator('.preview').boundingBox();
const free = { x: Math.min(sub15.x + sub15.width + 160, pane15.x + pane15.width - 120), y: sub15.y + sub15.height / 2 };
const pins1 = await pinnedNow();
await paletteDrop('Function App', free);
const fa = await page.locator('.drawing [data-node="function-app"]').boundingBox();
const sub15b = await page.locator('.drawing [data-group="sub"]').boundingBox();
if ((await pinnedNow()) !== pins1 + 1) fail('a shape dropped in free space was not pinned');
if (!fa || fa.x < sub15b.x + sub15b.width || overlaps(fa, sub15b)) fail(`a shape dropped right of the subscription did not stay there: ${JSON.stringify(fa)} vs ${JSON.stringify(sub15b)}`);
if (/function-app: .*in:/.test(await yaml())) fail('a shape dropped outside every group was nested');
await page.screenshot({ path: `${out}/14-dropped-free.png` });

// 16. Panes opening and closing re-fit a fitted drawing: centred in what is left, not pushed aside.
await page.keyboard.press('Meta+0');
await wait(400);
const offCentre = async () => {
  const d = await page.locator('.drawing svg').boundingBox();
  const c = await page.locator('.preview').boundingBox();
  const fits = d.x >= c.x - 1 && d.x + d.width <= c.x + c.width + 1;
  return { off: Math.round(d.x + d.width / 2 - (c.x + c.width / 2)), fits };
};
await page.locator('.drawing [data-node="app"]').click();
await wait(1200);
let oc = await offCentre();
if (!(await page.locator('.inspector').isVisible()) || Math.abs(oc.off) > 24 || !oc.fits) fail(`after the inspector opened the drawing is ${oc.off}px off centre${oc.fits ? '' : ' and clipped'}`);
await page.click('.inspector button[aria-label="Close properties"]');
await wait(1200);
oc = await offCentre();
if (Math.abs(oc.off) > 24 || !oc.fits) fail(`after the inspector closed the drawing is ${oc.off}px off centre`);
for (const mode of ['YAML', 'Builder']) {
  await page.locator('.view-switch button', { hasText: mode }).click();
  await wait(1200);
  oc = await offCentre();
  if (Math.abs(oc.off) > 24 || !oc.fits) fail(`after switching to ${mode} the drawing is ${oc.off}px off centre${oc.fits ? '' : ' and clipped'}`);
}
await page.screenshot({ path: `${out}/15-refit.png` });

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all builder steps ok');
await browser.close();
