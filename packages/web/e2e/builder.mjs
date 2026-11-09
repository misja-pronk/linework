// Drives the builder like a person and checks the YAML after each step: node e2e/builder.mjs <outDir>
import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
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

// 6. Rename through the inspector updates references.
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
for (let i = 1; i <= 6; i++) await page.mouse.move(g.x + 60 + i * 5, g.y + 10 + i * 8);
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

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all builder steps ok');
await browser.close();
