// Blocks (docs/blocks.md): save a selection as a block, insert it by keyboard (into a group, with
// parameters) and by dragging (where it is dropped), ids made unique, undo, and "Update instances"
// after the block changes. The browser's private file system stands in for a picked folder.
// node e2e/blocks.mjs <outDir>
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? '.';

const SHOP = `type: azure
title: Shop
subtitle: Blocks e2e

groups:
  sub: { kind: subscription, label: Payments subscription }
  shop-snet: { kind: subnet, label: snet-shop }

nodes:
  users: { kind: users, label: Customers }
  shop-app: { kind: app-service, label: Shop, in: shop-snet }
  shop-db: { kind: sql-database, label: Shop DB, in: shop-snet }

edges:
  - users -> shop-app: HTTPS
  - shop-app -> shop-db: SQL
`;

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
    fail(`${name}: ${e.message.split('\n').slice(0, 8).join(' | ')}`);
  }
};
const wait = (ms = 300) => page.waitForTimeout(ms);
const yaml = () => page.evaluate(() => [...document.querySelectorAll('.cm-content .cm-line')].map((l) => l.textContent).join('\n'));
const disk = (name) =>
  page.evaluate(async (name) => {
    let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('harbour');
    const parts = name.split('/');
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
    return (await (await d.getFileHandle(parts.at(-1))).getFile()).text();
  }, name);
const node = (id) => page.locator(`.drawing [data-node="${id}"]`).first();
const select = async (...ids) => {
  await page.locator('.preview').focus();
  await page.keyboard.press('Escape');
  await node(ids[0]).click();
  for (const id of ids.slice(1)) await node(id).click({ modifiers: ['Shift'] });
  await wait(150);
};
const saveAs = async (title) => {
  await page.keyboard.press('Shift+B');
  await page.waitForSelector('.block-dialog.save');
  await page.fill('.block-dialog.save input[aria-label="Title"]', title);
  await page.locator('.block-dialog.save input[aria-label="Title"]').press('Enter');
  await page.waitForSelector('.block-dialog.save', { state: 'detached' });
  await wait(400);
};

await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.evaluate(async (shop) => {
  localStorage.clear();
  localStorage.setItem('cartography:started', 'true');
  localStorage.setItem('cartography:hinted', 'true');
  const opfs = await navigator.storage.getDirectory();
  for await (const [name] of opfs.entries()) await opfs.removeEntry(name, { recursive: true });
  const dir = await opfs.getDirectoryHandle('harbour', { create: true });
  const w = await (await dir.getFileHandle('shop.yaml', { create: true })).createWritable();
  await w.write(shop);
  await w.close();
}, SHOP);
await page.reload();
await page.evaluate(() => {
  window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('harbour');
});
await page.click('button:has-text("Open folder")');
await page.waitForSelector('.files .file');
await page.locator('.files .file', { hasText: 'shop.yaml' }).click();
await page.waitForSelector('.drawing [data-node="shop-app"]');
await wait(500);

await step('save as block', async () => {
  await select('shop-app', 'shop-db');
  await page.keyboard.press('Shift+B');
  await page.waitForSelector('.block-dialog.save');
  // The shared start of the ids is offered, and ticked, as ${name}.
  const prefix = page.locator('.block-params label.check', { hasText: 'Ids start with' });
  if (!(await prefix.locator('input').isChecked())) fail('the id prefix is not suggested');
  await page.fill('.block-dialog.save input[aria-label="Title"]', 'Shop stack');
  await page.screenshot({ path: `${out}/blocks-1-save.png` });
  await page.locator('.block-dialog.save input[aria-label="Title"]').press('Enter');
  await page.waitForSelector('.block-dialog.save', { state: 'detached' });
  await wait(400);
  const text = await disk('blocks/shop-stack.block.yaml');
  for (const want of ['type: azure', 'title: Shop stack', 'name: { default: shop', '${name}-snet: { kind: subnet, label: "snet-${name}" }', '  - ${name}-app -> ${name}-db: SQL', 'pins:'])
    if (!text.includes(want)) fail(`block file lacks ${want}:\n${text}`);
  if (text.includes('users')) fail('the line from outside came along');
});

await step('the palette shows it with a preview', async () => {
  await page.keyboard.press('Meta+\\');
  await page.waitForSelector('.blocks-panel .block-card');
  await page.waitForFunction(() => document.querySelectorAll('.blocks-panel .block-thumb svg').length >= 3);
  const titles = await page.locator('.blocks-panel .block-title').allInnerTexts();
  for (const t of ['Shop stack', 'Azure hub with firewall and bastion', 'App Service + Key Vault + SQL, private endpoints']) if (!titles.includes(t)) fail(`panel lacks ${t}: ${titles}`);
  if (titles.some((t) => t.startsWith('K8s'))) fail('a block of another type is offered');
  await page.locator('aside.shapes').screenshot({ path: `${out}/blocks-2-panel.png` });
});

await step('insert by keyboard into the selected group, with a parameter', async () => {
  await page.locator('.drawing [data-group="sub"]').first().click({ position: { x: 30, y: 12 } });
  await wait(150);
  await page.keyboard.press('b');
  await page.waitForSelector('.palette-item');
  if (!(await page.locator('.palette .palette-group').first().textContent()).includes('Payments subscription')) fail(`not offered into the group: ${await page.locator('.palette .palette-group').first().innerText()}`);
  await page.keyboard.type('shop stack');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.block-dialog input[aria-label="Name"]');
  await page.fill('.block-dialog input[aria-label="Name"]', 'pay team');
  if (!(await page.locator('.block-dialog .rename-problem').isVisible())) fail('a space in an id parameter is not refused');
  if (!(await page.locator('.block-dialog button.primary').isDisabled())) fail('insert is not disabled with a bad id');
  await page.fill('.block-dialog input[aria-label="Name"]', 'pay');
  await page.screenshot({ path: `${out}/blocks-3-params.png` });
  await page.keyboard.press('Enter');
  await page.waitForSelector('.drawing [data-node="pay-app"]');
  await wait(400);
  const y = await yaml();
  if (!/pay-snet: \{ kind: subnet, label: snet-pay, in: sub \} # from block: shop-stack@[0-9a-f]{8} #1 name=pay/.test(y)) fail(`not inserted into sub with its mark:\n${y}`);
  if (!y.includes('  - pay-app -> pay-db: SQL # from block: shop-stack@')) fail('the inner line is not there');
  if ((await page.locator('.block-handle').count()) < 2) fail('no connect handles on what was inserted');
  await page.screenshot({ path: `${out}/blocks-4-inserted.png` });
});

await step('again with the defaults: one suffix for every id; undo takes it out in one step', async () => {
  await page.locator('.preview').focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('.blocks-panel .block-card', { hasText: 'Shop stack' }).click();
  await page.waitForSelector('.block-dialog input[aria-label="Name"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.drawing [data-node="shop-app-2"]');
  await wait(300);
  const y = await yaml();
  for (const id of ['shop-snet-2:', 'shop-app-2:', 'shop-db-2:', 'shop-app-2 -> shop-db-2: SQL']) if (!y.includes(id)) fail(`no ${id}`);
  if (!y.includes('#2 name=shop')) fail('not instance #2');
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+z');
  await wait(400);
  const after = await yaml();
  if (after.includes('shop-app-2') || after.includes('shop-snet-2')) fail('undo left part of the insert');
  if (!after.includes('pay-app')) fail('undo took the first insert too');
  await page.keyboard.press('Meta+Shift+z');
  await wait(400);
  if (!(await yaml()).includes('shop-app-2')) fail('redo did not bring it back');
});

await step('insert by dragging: where it is dropped, its nodes pinned as the block had them', async () => {
  // Room beside the drawing: zoomed out, dropped near the edge, outside every group.
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+0');
  await page.keyboard.press('Meta+-');
  await wait(300);
  const card = page.locator('.blocks-panel .block-card', { hasText: 'Azure hub' });
  const pv = await page.locator('.preview').boundingBox();
  await card.dragTo(page.locator('.preview'), { targetPosition: { x: 90, y: pv.height - 50 } });
  await page.waitForSelector('.block-dialog input[aria-label="Hub name"]');
  await page.fill('.block-dialog input[aria-label="Hub name"]', 'core');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.drawing [data-node="core-fw"]');
  await wait(500);
  const y = await yaml();
  if (!y.includes('core-fw: { kind: firewall, label: afw-core, in: core-fw-snet } # from block: azure-hub@')) fail('hub not inserted');
  if (!/\n  core: \{ kind: vnet, label: vnet-core · 10\.0\.0\.0\/16 \} #/.test(y)) fail(`dropped outside the groups, yet put in one: ${y.split('\n').find((l) => l.startsWith('  core:'))}`);
  // The starter has no pins: its nodes stand as its preview draws them, from where it was dropped.
  if (!/4 pinned/.test(await page.locator('.statusbar').innerText())) fail(`the dropped hub is not pinned: ${await page.locator('.statusbar').innerText()}`);
  // A block with pins (the one saved from the drawing) keeps its shapes as they stood, from where it is dropped.
  const card2 = page.locator('.blocks-panel .block-card', { hasText: 'Shop stack' });
  await card2.dragTo(page.locator('.preview'), { targetPosition: { x: pv.width - 420, y: 140 } });
  await page.waitForSelector('.block-dialog input[aria-label="Name"]');
  await page.fill('.block-dialog input[aria-label="Name"]', 'drop');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.drawing [data-node="drop-app"]');
  await wait(500);
  await page.screenshot({ path: `${out}/blocks-5-dropped.png` });
  if (!/6 pinned/.test(await page.locator('.statusbar').innerText()) || /warning/.test(await page.locator('.statusbar').innerText())) fail(`the dropped block is not pinned: ${await page.locator('.statusbar').innerText()}`);
  const a = await node('drop-app').boundingBox();
  const b = await node('drop-db').boundingBox();
  if (Math.abs(a.y - b.y) > 2 || b.x <= a.x) fail('the dropped shapes did not keep their places relative to each other');
});

await step('a changed block: update instances with a diff each', async () => {
  // The original changes, and is saved over the block.
  await page.keyboard.press('Meta+\\');
  await wait(300);
  const y = await yaml();
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+0');
  await wait(300);
  await select('shop-app', 'shop-db');
  await page.keyboard.press('Enter');
  const label = page.locator('.inspector .field:has(> span:text-is("Label")) input');
  if (await label.isVisible().catch(() => false)) {
    await label.fill('Orders DB');
    await label.press('Enter');
  }
  await wait(300);
  if (!(await yaml()).includes('label: Orders DB')) {
    // Fall back: the inspector shows the first selected; change the database alone.
    await select('shop-db');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Meta+a');
    await page.keyboard.type('Orders DB');
    await page.keyboard.press('Enter');
    await wait(300);
  }
  if (!(await yaml()).includes('label: Orders DB')) fail(`could not change the label:\n${(await yaml()).slice(0, 400)}`);
  void y;
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+0');
  await wait(300);
  await select('shop-app', 'shop-db');
  await page.keyboard.press('Shift+B');
  await page.waitForSelector('.block-dialog.save');
  await page.fill('.block-dialog.save input[aria-label="Title"]', 'Shop stack');
  if (!(await page.locator('.block-dialog.save button.primary').innerText()).startsWith('Replace')) fail('saving over a block does not say Replace');
  await page.locator('.block-dialog.save input[aria-label="Title"]').press('Enter');
  await page.waitForSelector('.block-dialog.save', { state: 'detached' });
  await wait(400);
  await page.keyboard.press('Meta+\\');
  await page.waitForSelector('.blocks-outdated');
  if (!(await page.locator('.blocks-outdated').innerText()).startsWith('3 instances')) fail(`outdated: ${await page.locator('.blocks-outdated').innerText()}`);
  await page.click('.blocks-outdated');
  await page.waitForSelector('.block-dialog.update');
  if ((await page.locator('.block-dialog.update .diff-hunk .ins').count()) < 2) fail('no diff per instance');
  await page.screenshot({ path: `${out}/blocks-6-update.png` });
  await page.keyboard.press('Enter');
  await page.waitForSelector('.block-dialog.update', { state: 'detached' });
  await wait(400);
  const after = await yaml();
  if (!after.includes('pay-db: { kind: sql-database, label: Orders DB, in: pay-snet } # from block: shop-stack@')) fail(`instance #1 not updated:\n${after}`);
  if (!after.includes('shop-db-2: { kind: sql-database, label: Orders DB, in: shop-snet-2 }')) fail('instance #2 not updated');
  if (!after.includes('pay-snet: { kind: subnet, label: snet-pay, in: sub }')) fail('the instance left its group');
  if (!after.includes('  - shop-app -> shop-db: SQL\n')) fail('a line of the diagram itself went with the update');
  if (!after.includes('  - users -> shop-app: HTTPS')) fail('the line from outside went');
  if (await page.locator('.blocks-outdated').isVisible().catch(() => false)) fail('still says outdated after the update');
});

await step('the context menu and the command palette offer it', async () => {
  await page.locator('.preview').focus();
  await page.keyboard.press('Escape');
  await node('users').click({ button: 'right' });
  await page.waitForSelector('.context-menu [role="menuitem"]');
  if (!(await page.locator('.context-menu [role="menuitem"]', { hasText: 'Save as block' }).isVisible())) fail('no Save as block in the context menu');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+k');
  await page.keyboard.type('save the selection as a block');
  if (!(await page.locator('.palette-item[aria-selected="true"]').innerText()).includes('Save the selection as a block')) fail('not in the command palette');
  await page.keyboard.press('Escape');
});

await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('blocks: ok');
