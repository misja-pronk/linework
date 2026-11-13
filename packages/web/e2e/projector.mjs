// The editor on a projector (1280×720), as a consultant demos it: the start screen whole, the drawing's
// tools side by side with the YAML open, the menus within the window, the view picker saying the view
// as V does, the palette's headings once each, a message moving clear of a chip that comes after it,
// the drawing's title kept while the YAML has a mistake, and a blank sequence saying how to start.
// Then what a demo runs into: presenting starts at once, the first-visit hint keeps off the drawing and
// goes with the first thing done, a short message after a deck with small text, the views by their
// titles, the steps given the strip's room, the drawing fitted again after the YAML closes, and a card
// kept in its group by a short drag.
// node e2e/projector.mjs <outDir>
import fs from 'node:fs';
import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
const url = process.env.CARTO_URL ?? 'http://localhost:5178/';
// A diagram of the test's own (sessionStorage `seed`), opened as the editor keeps one between visits.
await page.addInitScript(() => {
  const next = sessionStorage.getItem('seed');
  if (!next) return;
  sessionStorage.removeItem('seed');
  localStorage.clear();
  const { text, name } = JSON.parse(next);
  for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'visual', doc: { text, doc: { name } } })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
});
/** A first visit, and the start card at that place opened (none: the start screen stays). */
const cold = async (card) => {
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.start .scenario');
  await wait(800);
  if (card === undefined) return;
  await page.locator('.scenario-main').nth(card).click();
  await page.waitForSelector('.drawing [data-node]');
  await wait(700);
};

// 1. The start screen at 720: every card, the blank sheet and the search without scrolling.
await cold();
{
  const cut = await page.locator('.scenario, .home-foot .blank-sheet, .home-foot .search-field').evaluateAll((els) => {
    const bottom = document.querySelector('.home').getBoundingClientRect().bottom;
    return els.filter((e) => e.getBoundingClientRect().bottom > bottom + 1).length;
  });
  if (cut) fail(`${cut} of the cards, the blank sheet and the search are out of view at 1280×720`);
  await page.screenshot({ path: `${out}/projector-start.png` });
}

// 2. Entra access (it has views) with the YAML open: the picker gives up room, no tool slides under another.
await cold(2);
await page.locator('.preview').focus();
await page.keyboard.press('Meta+Backslash');
await wait(500);
{
  const under = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.canvas-tools > :not(.tool-sep)')].map((e) => [e.className, e.getBoundingClientRect()]);
    return items.flatMap((x, i) => (i && x[1].left < items[i - 1][1].right - 1 ? [`${items[i - 1][0]} / ${x[0]}`] : []));
  });
  if (under.length) fail(`tools overlap with the YAML open: ${under.join(', ')}`);
  await page.screenshot({ path: `${out}/projector-tools.png` });
}

// 3. A mistake in the YAML: the properties keep the title of the drawing on screen, not empty fields.
{
  await page.locator('.cm-content').click();
  await page.keyboard.press('Meta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('edges: [ oops');
  await wait(1200);
  const title = await page.locator('.inspector [data-key="title"] input').inputValue();
  if (title !== 'Northwind finance access packages') fail(`the title field reads "${title}" while the YAML has a mistake`);
  for (let i = 0; i < 14; i++) await page.keyboard.press('Backspace');
  await wait(800);
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+Backslash');
  await wait(500);
}

// 4. A view picked in the picker is said as V says it: no message left naming another view.
{
  await page.locator('.preview').focus();
  await page.keyboard.press('v');
  await wait();
  await page.locator('.view-picker select').selectOption({ index: 0 });
  await wait();
  const picked = await page.locator('.view-picker select option:checked').innerText();
  const toast = await page.locator('.toast').innerText().catch(() => '');
  if (!toast.startsWith('View: ') || !picked.startsWith(toast.slice(6))) fail(`after picking "${picked}" the message says "${toast}"`);
}

// 5. The theme menu at 720 stays in the window and scrolls to the language.
{
  await page.click('button[aria-label="More actions"]');
  await page.click('[data-brand]');
  await wait(200);
  const bottom = await page.locator('.topbar .menu').last().evaluate((m) => m.getBoundingClientRect().bottom);
  if (bottom > 720) fail(`the theme menu runs to ${Math.round(bottom)} px, past the window`);
  await page.locator('[data-ui-lang="en"]').scrollIntoViewIfNeeded();
  if (!(await page.locator('[data-ui-lang="en"]').isVisible())) fail('the language cannot be reached in the theme menu');
  await page.keyboard.press('Escape');
}

// 6. ⌘K before typing: each heading once.
{
  await page.keyboard.press('Meta+k');
  await wait(200);
  const heads = await page.locator('.palette-group').allInnerTexts();
  if (new Set(heads).size !== heads.length) fail(`a palette heading comes twice: ${heads.join(', ')}`);
  await page.keyboard.press('Escape');
}

// 7. The "Opened" message moves under the layers chip that comes after it.
await cold(0);
{
  await page.locator('.preview').focus();
  await page.keyboard.press('l');
  await page.keyboard.press('1');
  await page.keyboard.press('Escape');
  await wait();
  const toast = await page.locator('.toast').boundingBox();
  const chip = await page.locator('.layers-chip').boundingBox();
  if (!toast || !chip) fail('no message or no layers chip');
  else if (toast.y < chip.y + chip.height) fail('the message lies over the layers chip');
  await page.screenshot({ path: `${out}/projector-toast.png` });
}

// 8. A blank sequence says how to start, as a blank of any other type does.
{
  await page.click('button[aria-label="More actions"]');
  await page.getByRole('menuitem', { name: 'New diagram' }).click();
  await page.locator('.confirm-dialog button:has-text("Discard")').click({ timeout: 2000 }).catch(() => {});
  await page.locator('.home-foot .import-chip').click();
  await page.locator('.type-card[data-type="sequence"] .type-main').click();
  await wait(400);
  await page.locator('.blank-sheet').first().click();
  await wait(900);
  if (!(await page.locator('.canvas-empty').isVisible())) fail('a blank sequence shows no way to start');
  await page.screenshot({ path: `${out}/projector-sequence.png` });
}

// 9. P shows the slide on screen at once, and the deck made after takes it over without a second frame.
await cold(2);
{
  await page.locator('.preview').focus();
  await page.evaluate(() => {
    window.__added = 0;
    window.__first = new Promise((ok) => {
      const t0 = performance.now();
      new MutationObserver((ms, o) => {
        for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('present-frame')) window.__added++;
        if (document.querySelector('.present-frame svg') && !window.__at) (window.__at = performance.now() - t0), ok(window.__at), setTimeout(() => o.disconnect(), 2000);
      }).observe(document.body, { subtree: true, childList: true });
    });
  });
  await page.keyboard.press('p');
  const ms = await page.evaluate(() => window.__first);
  await wait(1500);
  const added = await page.evaluate(() => window.__added);
  const count = await page.locator('.present-count').innerText().catch(() => '');
  console.log(`present: first slide after ${Math.round(ms)} ms`);
  if (ms > 250) fail(`the first slide took ${Math.round(ms)} ms to show`);
  if (added !== 1) fail(`presenting put ${added} frames up before the first step on, not one`);
  if (!/^1 \/ \d+$/.test(count) || count === '1 / 1') fail(`the deck did not come in under the first slide: count "${count}"`);
  await page.keyboard.press('ArrowRight');
  await wait(600);
  if (!(await page.locator('.present-count').innerText()).startsWith('2 /')) fail('→ did not go on after the first slide');
  await page.keyboard.press('Escape');
  await wait(400);
}

// 10. The first-visit hint: never over the drawing, and gone with the first thing done (here a step on).
for (const card of [0, 2, 6]) {
  await cold(card);
  const over = await page.evaluate(() => {
    const h = document.querySelector('.hint');
    if (!h || getComputedStyle(h).visibility === 'hidden') return false;
    const a = h.getBoundingClientRect();
    return [...document.querySelectorAll('.drawing svg, .page-frame')].some((x) => {
      const r = x.getBoundingClientRect();
      return r.left < a.right && r.right > a.left && r.top < a.bottom && r.bottom > a.top;
    });
  });
  if (over) fail(`card ${card}: the first-visit hint lies over the drawing`);
}
await cold(0);
{
  if (!(await page.locator('.hint').count())) fail('no first-visit hint on a first visit');
  await page.locator('.preview').focus();
  await page.keyboard.press(']');
  await wait(400);
  if (await page.locator('.hint').count()) fail('the first-visit hint stays after a step on');
}

// 11. The view picker says each view by its title, without its name in brackets.
await cold(2);
{
  const said = await page.locator('.view-picker select option').allInnerTexts();
  if (said.some((o) => /\(\w[\w-]*\)$/.test(o))) fail(`the view picker says names in brackets: ${said.join(' | ')}`);
}

// 12. The steps' keys come only while a step has the keyboard; until then the steps have the room.
await page.setViewportSize({ width: 1440, height: 900 });
await cold(0);
{
  if (await page.locator('.steps-keys').isVisible()) fail('the steps strip shows its keys without a step having the keyboard');
  const cut = await page.evaluate(() => {
    const row = document.querySelector('.steps-row').getBoundingClientRect();
    return [...document.querySelectorAll('.steps-row .step-chip')].slice(0, 4).filter((c) => c.getBoundingClientRect().right > row.right + 1).length;
  });
  if (cut) fail(`${cut} of the first four step chips are cut off at 1440`);
  await page.locator('.steps-row .step-chip').first().focus();
  await page.keyboard.press('ArrowRight');
  await wait(200);
  if (!(await page.locator('.steps-keys').isVisible())) fail('a step has the keyboard, and the keys do not show');
  const seen = await page.evaluate(() => {
    const row = document.querySelector('.steps-row').getBoundingClientRect();
    const c = document.activeElement.getBoundingClientRect();
    return c.left >= row.left - 1 && c.right <= row.right + 1;
  });
  if (!seen) fail('the step with the keyboard is pushed out of view by the keys');
  await page.screenshot({ path: `${out}/projector-steps-keys.png` });
  await page.keyboard.press('Escape');
}
await page.setViewportSize({ width: 1280, height: 720 });

// 13. A card dragged a short way in its subnet stays in it; after a shape is added and the YAML opened
// and closed, the drawing is fitted again, whole in the canvas.
await page.setViewportSize({ width: 1440, height: 900 });
await cold(0);
{
  await page.locator('.preview').focus();
  await page.keyboard.press('a');
  await wait(300);
  await page.keyboard.type('virtual machine');
  await wait(200);
  await page.keyboard.press('Enter');
  await wait(800);
  const vm = page.locator('.drawing [data-node="vmss-erp-prod"]');
  const b = await vm.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + b.width / 2 + i * 8, b.y + b.height / 2 + i * 4);
  await page.mouse.up();
  await wait(800);
  const inside = await page.locator('.inspector select').nth(1).inputValue().catch(() => '');
  if (inside !== 'snet-app') fail(`a card dragged 80 px inside its subnet left it: now in "${inside}"`);
  await page.screenshot({ path: `${out}/projector-drag.png` });
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+Backslash');
  await wait(900);
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+Backslash');
  await wait(900);
  const whole = await page.evaluate(() => {
    const p = document.querySelector('.preview').getBoundingClientRect();
    const s = document.querySelector('.drawing svg').getBoundingClientRect();
    return s.left >= p.left - 2 && s.right <= p.right + 2 && s.top >= p.top - 2 && s.bottom <= p.bottom + 2;
  });
  if (!whole) fail('after the YAML opened and closed the drawing is not whole in the canvas');
  await page.screenshot({ path: `${out}/projector-yaml-closed.png` });
}
await page.setViewportSize({ width: 1280, height: 720 });

// 14. A deck with text under 6 pt: one short line in the usual tone, no list of every slide.
{
  const wide = `type: systems\ntitle: A long chain\nnodes:\n${Array.from({ length: 30 }, (_, i) => `  n${i}: { kind: service, label: Service number ${i} }`).join('\n')}\nedges:\n${Array.from({ length: 29 }, (_, i) => `  - n${i} -> n${i + 1}`).join('\n')}\n`;
  await page.evaluate((next) => sessionStorage.setItem('seed', next), JSON.stringify({ text: wide, name: 'chain.yaml' }));
  await page.reload();
  await page.waitForSelector('.drawing svg', { timeout: 10000 });
  await wait(600);
  await page.click('button:has-text("Export")');
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('[role=menuitem]:has-text("PowerPoint")')]);
  await download.saveAs(`${out}/projector-chain.pptx`);
  await page.waitForFunction(() => /under 6 pt/.test(document.querySelector('.toast')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
  const toast = page.locator('.toast');
  const said = await toast.innerText().catch(() => '');
  if (!/^\d+ slides? ha(s|ve) text under 6 pt \(smallest [\d.]+ pt\)\. Split into views or Tidy\.$/.test(said)) fail(`the small-text message reads "${said}"`);
  if (await toast.evaluate((e) => e.classList.contains('error')).catch(() => true)) fail('the small-text message is shown as an error');
  if (!(await page.locator('.drawing [data-node="n29"]').count())) fail('the long chain did not open');
  await page.screenshot({ path: `${out}/projector-small-text.png` });
  fs.rmSync(`${out}/projector-chain.pptx`, { force: true });
}

// 15. Esc on the start screen of a first visit: the drawing has the keys, not the page.
await cold();
{
  await page.keyboard.press('Escape');
  await wait(300);
  const on = await page.evaluate(() => document.activeElement?.className ?? '');
  if (!/\bpreview\b/.test(on)) fail(`after Esc on the start screen the keys go to "${on || 'the page'}", not the drawing`);
  await page.keyboard.press('p');
  await wait(600);
  if (!(await page.locator('.present').count())) fail('P right after closing the start screen does not present');
  await page.keyboard.press('Escape');
}

// 16. A card dragged past the canvas edge: the view holds still while it moves, and on the drop the
// whole drawing fits again; a card dragged within its group stays in it.
{
  const text = 'type: azure\ntitle: Drop past the edge\ngroups:\n  rg: { kind: resource-group, label: rg-shop }\nnodes:\n  users: users\n  web: { kind: app-service, label: Web, in: rg }\n  db: { kind: sql-database, label: Orders, in: rg }\nedges:\n  - users -> web\n  - web -> db\n';
  await page.evaluate((next) => sessionStorage.setItem('seed', next), JSON.stringify({ text, name: 'drop.yaml' }));
  await page.reload();
  await page.waitForSelector('.drawing [data-node="db"]');
  await wait(800);
  const stage = () => page.locator('.stage').evaluate((e) => e.style.transform);
  const whole = () =>
    page.evaluate(() => {
      const p = document.querySelector('.preview').getBoundingClientRect();
      const s = document.querySelector('.drawing svg').getBoundingClientRect();
      return s.left >= p.left - 2 && s.right <= p.right + 2 && s.top >= p.top - 2 && s.bottom <= p.bottom + 2;
    });
  if (!(await whole())) fail('the drop drawing is not whole before the drag');
  const before = await stage();
  const pane = await page.locator('.preview').boundingBox();
  const b = await page.locator('.drawing [data-node="db"]').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  const to = pane.x + pane.width + 60 - (b.x + b.width / 2);
  for (let i = 1; i <= 12; i++) await page.mouse.move(b.x + b.width / 2 + (to * i) / 12, b.y + b.height / 2 + i * 6);
  await wait(400);
  if ((await stage()) !== before) fail('the view moved while the card was still being dragged');
  if (await whole()) fail('the test drag did not take the drawing past the edge');
  await page.screenshot({ path: `${out}/projector-drop-dragging.png` });
  await page.mouse.up();
  await wait(1200);
  if (!(await whole())) fail('after a drop past the edge the drawing is not whole in the canvas');
  await page.screenshot({ path: `${out}/projector-drop-fitted.png` });
  // A short drag inside its group: it stays there, and nothing refits.
  const kept = await stage();
  const w = await page.locator('.drawing [data-node="web"]').boundingBox();
  await page.mouse.move(w.x + w.width / 2, w.y + w.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(w.x + w.width / 2 + i * 5, w.y + w.height / 2 + i * 3);
  await page.mouse.up();
  await wait(800);
  const yaml = await page.evaluate(() => JSON.parse(localStorage.getItem('cartography:doc') ?? '{}').text ?? '');
  if (yaml && !/web: \{[^}]*in: rg/.test(yaml)) fail('a card dragged a short way in its group left it');
  if ((await stage()) !== kept && !(await whole())) fail('a short drag inside the drawing left it out of view');
}

console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'projector OK');
await browser.close();
