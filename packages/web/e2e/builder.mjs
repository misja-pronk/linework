// Drives the builder like a person and checks the YAML after each step: node e2e/builder.mjs <outDir>
import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
const fail = (m) => problems.push(m);
const yaml = () => page.evaluate(() => document.querySelector('.cm-content').innerText);
const wait = (ms = 250) => page.waitForTimeout(ms);

await page.goto('http://localhost:5178/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.drawing svg');
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

// 8. Drag from the palette into a group.
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

// 10. Select the new line and give it a label in the inspector.
const edges = page.locator('.drawing [data-edge]');
await edges.last().click({ force: true });
await wait();
const lbl = page.locator('.inspector .field:has(> span:text-is("Label")) input');
if (await lbl.count()) {
  await lbl.fill('reads');
  await lbl.press('Enter');
  await wait(400);
  if (!/label: reads|-> \w+: reads/.test(await yaml())) fail('edge label not written');
} else fail('edge inspector has no label field');
await page.screenshot({ path: `${out}/7-edge.png` });

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all builder steps ok');
await browser.close();
