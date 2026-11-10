// Trace a request: two elements selected (⇧-click the second) and ⇧Q, or the context menu, or the
// palette → the routes and a preview of the sequence diagram → ↵ opens it as a new document; one
// element traces until the request ends; a model gets the trace as a dynamic view (⌥↵); the steps of
// a diagram trace in order. node e2e/trace.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? '.';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('cartography:doc') ?? '{}'));
const yaml = async () => (await wait(600), (await stored()).text ?? '');
const check = (what, ok) => ok || fail(what);
const palette = async (words) => {
  await page.keyboard.press('Meta+k');
  await page.keyboard.type(words);
  await wait(150);
  await page.keyboard.press('Enter');
};
await page.addInitScript(() => {
  const next = sessionStorage.getItem('seed');
  if (!next) return;
  sessionStorage.removeItem('seed');
  localStorage.clear();
  const { text, name } = JSON.parse(next);
  for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'visual', doc: { text, doc: { name } } })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
});
const seed = async (text, name, node) => {
  await page.evaluate((next) => sessionStorage.setItem('seed', next), JSON.stringify({ text, name }));
  await page.reload();
  await page.waitForSelector(`.drawing [data-node="${node}"]`, { timeout: 10000 });
  await wait(400);
};
const node = (id) => page.locator(`.drawing [data-node="${id}"]`).first();
const dialog = page.locator('.trace-dialog');
const routes = () => page.locator('.trace-routes li[role="option"]');

const shop = `type: systems
title: Web shop
groups:
  shop: { kind: system, label: Web shop }
nodes:
  customers: { kind: users, label: Customers }
  web: { kind: client, label: Storefront, in: shop }
  gateway: { kind: gateway, label: API gateway, in: shop }
  orders: { kind: service, label: Orders, in: shop }
  search: { kind: service, label: Search, in: shop }
  db: { kind: database, label: Orders DB, in: shop }
  bus: { kind: queue, label: order-events, in: shop }
  mailer: { kind: worker, label: Mailer, in: shop }
  billing: { kind: worker, label: Billing, in: shop }
edges:
  - customers -> web: HTTPS
  - web -> gateway: REST
  - gateway -> orders
  - gateway -> search
  - search -> db: reads
  - orders -> db: SQL
  - orders -> bus: { label: OrderPlaced, style: async }
  - bus -> mailer: { style: async }
  - bus -> billing: { style: async }
steps:
  - customers -> web -> gateway: A customer orders
  - title: Stored
    path: orders -> db
`;
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');

// 1. Two selected, ⇧Q: both routes, the shortest first, previewed; ↓ picks the other; ↵ opens it.
await seed(shop, 'shop.yaml', 'db');
await node('customers').click();
await node('db').click({ modifiers: ['Shift'] });
await page.locator('.preview').focus();
await page.keyboard.press('Shift+Q');
await dialog.waitFor({ timeout: 3000 }).catch(() => fail('⇧Q with two selected should open the trace dialog'));
check(`two routes from customers to db, got ${await routes().count()}`, (await routes().count()) === 2);
check(`the header says what is traced, got "${await page.locator('.trace-what').innerText()}"`, (await page.locator('.trace-what').innerText()) === 'from Customers to Orders DB · 2 routes');
check('the shortest route is offered first', (await routes().first().innerText()).includes('Customers → Storefront → API gateway → Orders → Orders DB'));
await page.waitForSelector('.trace-preview svg', { timeout: 5000 }).catch(() => fail('the dialog should preview the sequence diagram'));
await wait(300);
await page.screenshot({ path: path.join(out, 'trace-dialog.png') });
await page.keyboard.press('ArrowDown');
await wait(200);
check('↓ picks the second route', (await routes().nth(1).getAttribute('aria-selected')) === 'true');
await page.keyboard.press('ArrowUp');
await page.keyboard.press('Enter');
await wait(800);
{
  const t = await yaml();
  check('↵ opens a sequence diagram', /^type: sequence$/m.test(t));
  check('it says where it was traced from', t.includes('traced: { file: shop.yaml, from: customers, to: db }') && t.includes('# Traced from shop.yaml'));
  check('participants point back at the elements', t.includes('ref: gateway'));
  check('the gateway forwards REST to Orders', t.includes('- gateway -> orders: REST'));
  check('the database answers', t.includes('- db --> orders'));
  check(`the new document is named after the trace, got ${(await stored()).doc?.name}`, (await stored()).doc?.name === 'trace-customers-db.yaml');
  await page.waitForSelector('.drawing svg', { timeout: 5000 });
  await page.screenshot({ path: path.join(out, 'trace-opened.png') });
  // Back to the source: offered per participant; outside a folder it says what it needs.
  await palette('show orders db in shop');
  await wait(300);
  check('"Show … in the source" outside a folder asks for the folder', (await page.locator('.toast').innerText().catch(() => '')).includes('open its folder'));
}

// 2. One element, by the context menu: until it ends, the router as alt, the topic in parallel; a click picks, ↵ opens.
await seed(shop, 'shop.yaml', 'customers');
await node('customers').click({ button: 'right' });
await page.locator('.context-menu button:has-text("until it ends")').click().catch(() => fail('the context menu should offer "Trace a request … until it ends"'));
await dialog.waitFor({ timeout: 3000 }).catch(() => fail('the context menu should open the trace dialog'));
{
  const notes = await page.locator('.trace-note').allInnerTexts();
  check(`the dialog explains the alt frame, got ${notes.join(' | ')}`, notes.some((n) => n.includes('alt frame')));
  check('the dialog explains the par frame', notes.some((n) => n.includes('par frame')));
  await page.waitForSelector('.trace-preview svg', { timeout: 5000 });
  await wait(300);
  await page.screenshot({ path: path.join(out, 'trace-until.png') });
  // A click on the preview shows it at its own size, Z fits it again.
  await page.locator('.trace-preview').click();
  check('a click shows the preview at its own size', (await page.locator('.trace-preview.actual').count()) === 1);
  await page.keyboard.press('z');
  check('Z fits the preview again', (await page.locator('.trace-preview.actual').count()) === 0);
  await page.locator('.trace-actions button:has-text("Open as a new diagram")').click();
  await wait(800);
  const t = await yaml();
  check('until: an alt for the gateway', t.includes('- alt: Orders'));
  check('until: a par for the queue', t.includes('- par: Mailer'));
}

// 3. One element, "to…" from the palette, then a pick; Esc leaves without changing anything.
await seed(shop, 'shop.yaml', 'web');
await node('web').click();
await page.locator('.preview').focus();
await palette('trace a request from storefront to');
await wait(200);
await page.keyboard.type('search');
await page.keyboard.press('Enter');
await dialog.waitFor({ timeout: 3000 }).catch(() => fail('"to…" then a target should open the dialog'));
check('one route from the storefront to search', (await routes().count()) === 1);
await page.keyboard.press('Escape');
await wait(200);
check('Esc closes the dialog', !(await dialog.isVisible()));
check('Esc leaves the document as it was', /^type: systems$/m.test(await yaml()));

// 4. The steps, in order: a divider per step.
await palette('trace the steps');
await dialog.waitFor({ timeout: 3000 }).catch(() => fail('"Trace the steps" should open the dialog'));
await page.keyboard.press('Enter');
{
  const t = await yaml();
  check('the steps become dividers', t.includes('- divider: A customer orders') && t.includes('- divider: Stored'));
}

// 5. A model: ⌥↵ adds a dynamic view and shows it; ⌘Z takes it out.
const model = `type: c4
title: Shop
elements:
  customer: { kind: person, label: Customer }
  shop:
    kind: software-system
    label: Web shop
    elements:
      web: { kind: web-app, label: Storefront, technology: React }
      api: { kind: container, label: Orders API, technology: Go }
      db: { kind: database, label: Orders DB, technology: PostgreSQL }
relations:
  - customer -> shop.web: { label: Orders, technology: HTTPS }
  - shop.web -> shop.api: { label: Places orders, technology: JSON }
  - shop.api -> shop.db: { label: Writes, technology: SQL }
views:
  containers: { kind: container, of: shop }
`;
await seed(model, 'model.yaml', 'shop.db');
await node('customer').click();
await node('shop.db').click({ modifiers: ['Shift'] });
await page.locator('.preview').focus();
await page.keyboard.press('Shift+Q');
await dialog.waitFor({ timeout: 3000 }).catch(() => fail('⇧Q in a C4 view should open the dialog'));
check('a model offers the dynamic view', await page.locator('.trace-actions button:has-text("dynamic view")').isEnabled());
await page.keyboard.press('Alt+Enter');
await wait(900);
{
  const t = await yaml();
  check('⌥↵ adds the dynamic view', t.includes('trace-customer-db:') && t.includes('kind: dynamic') && t.includes('customer -> shop.web'));
  await page.waitForSelector('.drawing [data-node="shop.api"]', { timeout: 5000 });
  await page.screenshot({ path: path.join(out, 'trace-dynamic.png') });
}

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all trace steps ok');
process.exitCode = problems.length ? 1 : 0;
await browser.close();
