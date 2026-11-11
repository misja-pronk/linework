// A live session, played as a consultant drives it on a shared screen: a blank sheet, session mode, a
// name typed, Tab, Tab, Enter for a sibling, a rename, a kind by prefix, a group, the end of the
// session and "What changed". Then: adding boxes does not move the ones that are there (measured), the
// keyboard alone is enough, the focus is where the next key needs it, and Tab while naming works in the
// normal editor too: node e2e/session.mjs <outDir>
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? '.';
const URL = process.env.CARTO_URL ?? 'http://localhost:5178/';
const browser = await chromium.launch();
const problems = [];
const fail = (m) => problems.push(m);
let page;
let shot = 0;
const snap = (name) => page.screenshot({ path: `${out}/session-${String(++shot).padStart(2, '0')}-${name}.png` });

/** A fresh browser profile with one document open; `prefs` are the editor's own (theme, view…). */
const openDoc = async (text, name, prefs = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  page = await ctx.newPage();
  page.on('pageerror', (e) => fail(`page error: ${e.message}`));
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(
    ({ text, name, prefs }) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.clear();
      for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'visual', theme: 'dark', doc: { text, doc: { name } }, ...prefs })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
    },
    { text, name, prefs },
  );
  await page.goto(URL);
  await page.waitForSelector('.drawing svg');
  await page.waitForTimeout(400);
};
/** The YAML as the app keeps it (the editor is hidden in a session). */
const yaml = () => page.evaluate(() => JSON.parse(localStorage.getItem('cartography:doc') ?? '{}').text ?? '');
const until = async (what, fn, arg, timeout = 8000) => {
  try {
    await page.waitForFunction(fn, arg, { timeout });
    return true;
  } catch {
    fail(`${what} (focus on ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 100))})\n${await yaml()}`);
    await snap('stuck');
    return false;
  }
};
const written = (text) => until(`"${text}" never got into the YAML`, (t) => (JSON.parse(localStorage.getItem('cartography:doc') ?? '{}').text ?? '').includes(t), text);
const naming = () => until('no name editor opened', () => document.activeElement?.classList.contains('label-editor'));
const onCanvas = () => until('the drawing does not have the focus', () => document.activeElement?.classList.contains('preview'));
const drawn = (id) => until(`${id} was not drawn`, (id) => !!document.querySelector(`.drawing [data-node="${id}"]`), id);
const box = (id) => page.locator(`.drawing [data-node="${id}"] > rect`).first().boundingBox();
// Top-left corners in the drawing's own coordinates (not moved by panning or zooming).
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
/** How far each node that was there moved, once the drawing as a whole is slid back (a box on the left pushes everything right). */
const drift = (before, after) => {
  const ids = Object.keys(before).filter((id) => after[id]);
  const med = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;
  const dx = med(ids.map((id) => after[id].x - before[id].x));
  const dy = med(ids.map((id) => after[id].y - before[id].y));
  return Object.fromEntries(ids.map((id) => [id, Math.hypot(after[id].x - before[id].x - dx, after[id].y - before[id].y - dy)]));
};
const settle = () => page.waitForTimeout(450);
/**
 * While a box is being named it is drawn as a box (its shape and icon in sight), the selection ring
 * wraps all of it, and the name is typed inside it: the editor never covers the box or the ring.
 */
const namedInBox = async (what) => {
  const r = await page.evaluate(() => {
    const ring = document.querySelector('#canvas-focus')?.getBoundingClientRect();
    const input = document.querySelector('.label-editor')?.getBoundingClientRect();
    if (!ring || !input) return { missing: !ring ? 'ring' : 'name editor' };
    const node = [...document.querySelectorAll('.drawing [data-node]')].find((g) => {
      const b = g.querySelector('rect')?.getBoundingClientRect();
      return b && b.x + b.width / 2 > ring.x && b.x + b.width / 2 < ring.right && b.y + b.height / 2 > ring.y && b.y + b.height / 2 < ring.bottom;
    });
    const shape = node?.querySelector('rect');
    const b = shape?.getBoundingClientRect();
    const seen = (el) => !!el && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
    // What is drawn under the editor's middle: the box's own shape, not the editor over it.
    const under = document.elementsFromPoint(b ? b.x + 8 : 0, b ? b.y + b.height / 2 : 0);
    return {
      id: node?.getAttribute('data-node'),
      ring: { h: ring.height, w: ring.width },
      box: b && { h: b.height, w: b.width },
      shown: seen(shape) && seen(node?.querySelector('g')),
      inside: !!b && input.x >= b.x && input.right <= b.right && input.y >= b.y && input.bottom <= b.bottom,
      coversEdge: !!b && under[0]?.classList.contains('label-editor'),
    };
  });
  if (r.missing) return fail(`${what}: no ${r.missing} while naming`);
  if (!r.box || !r.box.h || !r.box.w) return fail(`${what}: the box being named is not drawn (${JSON.stringify(r)})`);
  if (!r.shown) fail(`${what}: the shape or icon of the box being named is hidden`);
  if (r.ring.h < r.box.h || r.ring.w < r.box.w) fail(`${what}: the selection ring (${r.ring.w}×${r.ring.h}) does not wrap the box (${r.box.w}×${r.box.h})`);
  if (!r.inside) fail(`${what}: the name editor is not inside the box it names`);
  if (r.coversEdge) fail(`${what}: the name editor covers the box's edge`);
};

// ------------------------------------------------------------------ 1. a live session from a blank sheet
{
  await openDoc('type: azure\ntitle: Payments workshop\n', 'workshop.yaml');
  await page.click('.session-toggle');
  await page.waitForSelector('.app.in-session');
  if (await page.locator('.topbar').isVisible()) fail('the top bar shows in a session');
  if (await page.locator('.editor-pane').isVisible()) fail('the YAML shows in a session');
  if (await page.locator('.statusbar').isVisible()) fail('the status bar shows in a session');
  if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== 'light') fail('a session is not on the light theme (the editor was dark)');
  const head = await page.locator('.session-head').innerText();
  if (!/Session · Payments workshop/i.test(head.replace(/\s+/g, ' ')) || /esc/i.test(head)) fail(`the session's line says: ${head}`);
  await onCanvas();
  await snap('blank');

  // A name typed on the empty sheet is the first box; the id follows the name.
  await page.keyboard.type('Orders API');
  await naming();
  await settle();
  await namedInBox('the first box on a blank sheet');
  await page.keyboard.press('Enter');
  await written('orders-api: { kind: service, label: Orders API }');
  await onCanvas();
  await drawn('orders-api');
  if ((await page.locator('.session-keys').count()) !== 1) fail('no sketch keys over the strip in the first session');
  if (/undo/i.test(await page.locator('.session-keys').innerText())) fail('the sketch keys still say Esc undoes');

  // Tab: a box connected from it, named straight away; Tab again from the name goes on.
  await page.keyboard.press('Tab');
  await page.keyboard.type('Payments');
  await naming();
  await settle();
  await namedInBox('a box added with Tab');
  await snap('naming-tab');
  await page.keyboard.press('Tab');
  await written('- orders-api -> payments');
  await page.keyboard.type('Ledger');
  await snap('naming');
  await page.keyboard.press('Enter');
  await written('- payments -> ledger');
  await onCanvas();
  // Enter: a sibling of Ledger, connected from Payments as Ledger is.
  await page.keyboard.press('Enter');
  await page.keyboard.type('Fraud check');
  await naming();
  await settle();
  await namedInBox('a box added with Enter');
  await page.keyboard.press('Enter');
  await written('- payments -> fraud-check');
  await settle();
  await snap('four-boxes');

  // Rename by typing over the selected box.
  await page.locator('.drawing [data-node="orders-api"]').click();
  await page.keyboard.type('Checkout');
  await naming();
  await settle();
  await namedInBox('a box renamed by typing');
  await page.keyboard.press('Enter');
  await written('label: Checkout');
  if ((await yaml()).includes('label: Orders API')) fail('the rename left the old name');

  // A kind by prefix: "fw:" makes Fraud check a firewall named Edge firewall; the list shows while typing.
  await page.locator('.drawing [data-node="fraud-check"]').click();
  await page.keyboard.type('fw:');
  await until('no kind list for "fw:"', () => !!document.querySelector('.kind-list [aria-selected="true"]'));
  const first = await page.locator('.kind-list [aria-selected="true"]').innerText();
  if (!/Firewall/.test(first)) fail(`"fw:" first suggests ${first}`);
  await page.keyboard.type(' Edge firewall');
  await snap('kind-prefix');
  await page.keyboard.press('Enter');
  await written('fraud-check: { kind: firewall, label: Edge firewall }');

  // The menu over the selection: kind, group, connect, delete.
  await settle();
  const menu = page.locator('.sel-menu');
  if (!(await menu.isVisible())) fail('no menu over the selection');
  else {
    const m = await menu.boundingBox();
    const b = await box('fraud-check');
    // Above or below the selection, wherever it covers less of the drawing; never over it, never out of the window.
    if (m.y + m.height > b.y + 2 && m.y < b.y + b.height - 2) fail('the selection menu covers the selection');
    if (m.x < 0 || m.y < 0 || m.x + m.width > 1440 || m.y + m.height > 900) fail('the selection menu runs out of the window');
    // The line into the firewall comes from above: the menu goes below rather than sit on it.
    if (m.y < b.y) fail('the selection menu sits on the line coming into the selection');
    // One thing at the selection: the keys are over the strip, not next to the menu.
    if (await page.locator('.sketch-hint').count()) fail('a second hint floats at the selection');
    const hint = await page.locator('.session-keys').boundingBox();
    const strip = await page.locator('.session-strip').boundingBox();
    if (hint && (hint.x < 0 || hint.x + hint.width > 1440 || hint.y + hint.height > 900)) fail('the sketch keys run out of the window');
    if (hint && strip && (hint.y + hint.height > strip.y || strip.y - hint.y > 60)) fail('the sketch keys are not just over the strip');
    await snap('selection-menu');
  }

  // Group: Payments and Ledger together into a new group, named at once.
  await page.locator('.drawing [data-node="payments"]').click();
  await page.locator('.drawing [data-node="ledger"]').click({ modifiers: ['Shift'] });
  await page.keyboard.press('Meta+g');
  await naming();
  await page.keyboard.type('Core banking');
  await page.keyboard.press('Enter');
  await written('label: Core banking');
  const y = await yaml();
  const group = /\n {2}([\w-]+): \{ kind: boundary, label: Core banking \}/.exec(y)?.[1];
  if (!group) fail(`no group in the YAML:\n${y}`);
  else for (const id of ['payments', 'ledger']) if (!new RegExp(`${id}: \\{[^}]*in: ${group}`).test(y)) fail(`${id} is not in the group`);
  await settle();
  await snap('grouped');

  // End: Esc deselects and never leaves (the customer is watching); End session does, and "What
  // changed" tells the delta in sentences.
  await page.locator('.preview').focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (!(await page.locator('.session-strip').count()) || (await page.locator('.session-end-dialog').count())) fail('Esc left the session');
  await page.locator('.session-strip .session-end').click();
  await until('no "What changed" after the session', () => !!document.querySelector('.session-end-dialog .session-changes li'));
  if (await page.locator('.session-strip').count()) fail('End session did not leave the session');
  const told = await page.locator('.session-changes').innerText();
  for (const want of ['Checkout', 'Payments', 'Ledger', 'Edge firewall', 'Core banking']) if (!told.includes(want)) fail(`"What changed" does not mention ${want}:\n${told}`);
  if (!(await page.evaluate(() => !!document.activeElement?.closest('.session-end-dialog')))) fail('the focus is not in the "What changed" dialog');
  if (!(await page.locator('.app.in-session').count()) || (await page.locator('.topbar').isVisible())) fail('the editor showed up around "What changed" (the customer is still watching)');
  if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== 'light') fail('"What changed" is not on the light theme');
  await snap('what-changed');
  await page.locator('.session-end-dialog button', { hasText: 'Show on the drawing' }).click();
  await until('no comparison on the drawing', () => !!document.querySelector('.cmp-pane'));
  await settle();
  await snap('compared');
  if (await page.locator('.topbar').isVisible()) fail('the editor showed up around the comparison of the session');
  await page.keyboard.press('Escape');
  await until('the editor did not come back after the comparison', () => !!document.querySelector('.topbar') && getComputedStyle(document.querySelector('.topbar')).display !== 'none');
  if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== 'dark') fail('the editor did not go back to its own (dark) theme');
  console.log(`session: ${told.split('\n').length} changes told`);
}

// ------------------------------------------------------------------ 2. adding boxes does not move the ones that are there
{
  const ids = ['gw', 'web', 'api', 'auth', 'db', 'cache', 'bus', 'worker'];
  const text = `type: azure
title: Prepared
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
  await openDoc(text, 'prepared.yaml', { sessions: 10 });
  await page.keyboard.press('Shift+S');
  await page.waitForSelector('.app.in-session');
  await settle();
  if (await page.locator('.session-keys').count()) fail('the sketch keys still show after the first few sessions');
  const steps = [
    ['api', 'Tab', 'Audit log'],
    ['db', 'Enter', 'Reports DB'],
    ['worker', 'Tab', 'Mailer'],
    ['gw', 'Enter', 'CDN'],
    ['auth', 'Tab', 'Key Vault'],
  ];
  const worst = [];
  for (const [from, key, name] of steps) {
    await page.locator(`.drawing [data-node="${from}"]`).click();
    await settle();
    const before = await corners();
    await page.keyboard.press(key);
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
    await written(`label: ${name}`);
    await settle();
    const d = drift(before, await corners());
    const max = Math.max(...Object.values(d));
    const who = Object.entries(d).sort((a, b) => b[1] - a[1])[0];
    worst.push(`${key} from ${from}: max ${max.toFixed(1)}px (${who[0]})`);
    if (max > 4) fail(`${key} from ${from} moved ${who[0]} by ${max.toFixed(1)}px`);
  }
  await snap('prepared-after');
  console.log(`stability: ${worst.join('; ')}`);
  // What does move glides there: after the session, Tidy all draws it from scratch and the boxes go
  // to their new places with a transition on them (not in one jump).
  await page.locator('.session-strip .session-end').click();
  await until('no "What changed" after the prepared session', () => !!document.querySelector('.session-end-dialog'));
  await page.keyboard.press('Escape');
  await until('the editor did not come back', () => getComputedStyle(document.querySelector('.topbar')).display !== 'none');
  const watch = page.evaluate(
    () =>
      new Promise((ok) => {
        const seen = new Set();
        const obs = new MutationObserver(() => {
          for (const g of document.querySelectorAll('.drawing [data-node]')) if (g.style.transition?.includes('transform')) seen.add(g.getAttribute('data-node'));
        });
        obs.observe(document.querySelector('.drawing'), { subtree: true, attributes: true, attributeFilter: ['style'], childList: true });
        setTimeout(() => (obs.disconnect(), ok([...seen])), 1500);
      }),
  );
  await page.click('.canvas-tools button[aria-label="More tools"]');
  await page.locator('.canvas-tools .menu [role="menuitem"]:has-text("Tidy all")').click();
  const glided = await watch;
  console.log(`glide on Tidy all: ${glided.length} boxes (${glided.join(', ')})`);
  if (!glided.length) fail('nothing glided when Tidy all moved the boxes');
  // With reduced motion asked for, the same move is instant.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await settle();
  const still = page.evaluate(
    () =>
      new Promise((ok) => {
        let seen = 0;
        const obs = new MutationObserver(() => {
          for (const g of document.querySelectorAll('.drawing [data-node]')) if (g.style.transition?.includes('transform')) seen++;
        });
        obs.observe(document.querySelector('.drawing'), { subtree: true, attributes: true, attributeFilter: ['style'], childList: true });
        setTimeout(() => (obs.disconnect(), ok(seen)), 1500);
      }),
  );
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+z');
  if (await still) fail('boxes glided with prefers-reduced-motion: reduce');
  void ids;
}

// ------------------------------------------------------------------ 3. the keyboard alone, and where the focus goes
{
  await openDoc('type: azure\ntitle: Keyboard only\n', 'keys.yaml', { sessions: 10 });
  await page.locator('.topbar').waitFor();
  // Into the session without the mouse: the toggle key, from wherever the focus is.
  await page.keyboard.press('Shift+S');
  await page.waitForSelector('.app.in-session');
  await onCanvas();
  await page.keyboard.press('Tab'); // nothing selected: a first box, named
  await page.keyboard.type('Hub');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Spoke A');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Spoke B');
  await page.keyboard.press('Enter');
  await written('- hub -> spoke-b');
  await onCanvas();
  // Shift+Tab goes back to the box it is connected from; arrows to the nearest one.
  await page.keyboard.press('Shift+Tab');
  await until('Shift+Tab did not go back to Hub', () => document.querySelector('#canvas-focus')?.getAttribute('aria-label')?.startsWith('Hub'));
  await page.keyboard.press('F2');
  await naming();
  await page.keyboard.press('Escape');
  await onCanvas();
  if ((await yaml()).match(/label: Hub/g)?.length !== 1) fail('Esc on a rename changed something');
  // Esc while naming a new box takes it away again.
  await page.keyboard.press('Tab');
  await naming();
  await page.keyboard.type('Oops');
  await page.keyboard.press('Escape');
  await onCanvas();
  await page.waitForTimeout(500);
  if (/Oops|service:/.test(await yaml())) fail(`Esc while naming a new box left it:\n${await yaml()}`);
  // ⌘G groups the selected box; Delete removes one; ⌘Z brings it back.
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  const sel = await page.evaluate(() => document.querySelector('#canvas-focus')?.getAttribute('aria-label'));
  if (!sel || sel.startsWith('Hub')) fail(`→ did not move to a spoke: ${sel}`);
  await page.keyboard.press('Meta+g');
  await naming();
  await page.keyboard.type('Spokes');
  await page.keyboard.press('Enter');
  await written('label: Spokes');
  await onCanvas();
  await snap('keyboard');
  // Out of the session by keyboard: Esc lets go of the selection, Esc again goes to End session (and
  // a third would come back), ↵ ends it; the dialog closes with Esc and the drawing has the focus again.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  if (!(await page.evaluate(() => document.activeElement?.classList.contains('session-end')))) fail('Esc with nothing selected did not go to End session');
  await page.keyboard.press('Escape');
  if (!(await page.evaluate(() => document.activeElement?.classList.contains('preview')))) fail('Esc on End session did not go back to the drawing');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await until('no "What changed" after a keyboard session', () => !!document.activeElement?.closest('.session-end-dialog'));
  await page.keyboard.press('Escape');
  await onCanvas();
}

// ------------------------------------------------------------------ 4. Tab while naming, in the normal editor
{
  await openDoc('type: azure\ntitle: Editor\nnodes:\n  web: { kind: app-service, label: Web }\n', 'editor.yaml', { theme: 'light' });
  await page.locator('.drawing [data-node="web"]').dblclick();
  await naming();
  await page.keyboard.type('Storefront');
  await page.keyboard.press('Tab');
  await written('- web -> app-service');
  await naming();
  await settle();
  await namedInBox('a box added with Tab in the editor');
  await page.keyboard.type('kv: Secrets');
  await page.keyboard.press('Enter');
  await written('secrets: { kind: key-vault, label: Secrets }');
  if (!(await yaml()).includes('- web -> secrets')) fail(`the new box is not connected from Storefront:\n${await yaml()}`);
  // Outside a session, letters stay shortcuts: "a" opens the add menu, it does not rename.
  await page.locator('.preview').focus();
  await page.keyboard.press('a');
  if (!(await page.locator('.add-menu').count())) fail('outside a session "a" no longer opens the add menu');
  await snap('editor');
}

await browser.close();
if (problems.length) {
  console.error(problems.map((p) => `FAIL ${p}`).join('\n'));
  process.exit(1);
}
console.log('session ok');
