// Review notes: someone else's unread note on the drawing, N to write one on the selection (the name
// asked once), a reply, resolve and the filters, a note by right-click, a rename that the note follows,
// a deleted element that leaves its note orphaned, review mode, and exports with and without the
// notes: node e2e/notes.mjs <outDir>
import fs from 'node:fs';
import { chromium } from '@playwright/test';
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
const stored = (key) => page.evaluate((k) => JSON.parse(localStorage.getItem(`cartography:${k}`) ?? 'null'), key);
const yaml = async () => (await wait(500), (await stored('doc'))?.text ?? '');
const threads = async () => (await wait(400), (await stored('notes'))?.notes?.threads ?? []);
const markers = () => page.locator('.stage .note-marker');
const select = async (id) => {
  await page.locator(`.drawing [data-node="${id}"]`).click();
  await page.locator('.preview').focus();
};
const palette = async (words) => {
  await page.keyboard.press('Meta+k');
  await page.keyboard.type(words);
  await wait(150);
  await page.keyboard.press('Enter');
};
const exported = async () => {
  await page.locator('.preview').focus();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.keyboard.press('Meta+e')]);
  const file = `${out}/${Date.now()}-${download.suggestedFilename()}`;
  await download.saveAs(file);
  return fs.readFileSync(file, 'utf8');
};

const text = `type: systems
title: Shop
nodes:
  web: { kind: client, label: Web shop }
  api: { kind: service, label: Orders API }
  db: { kind: database, label: Orders DB }
edges:
  - web -> api
  - api -> db: { label: SQL }
`;
// Bo's note, written before this browser saw the diagram: unread here.
const bo = { id: 'k3bo001', anchor: { kind: 'node', id: 'db', label: 'Orders DB' }, status: 'open', author: 'Bo', created: '2026-11-09T10:00:00.000Z', text: 'Postgres or the managed one?' };
await page.addInitScript(
  ([text, bo]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'visual', doc: { text, doc: { name: 'notes.yaml' } }, notes: { doc: 'notes.yaml', notes: { version: 1, threads: [bo] }, saved: '' } }))
      localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
  },
  [text, bo],
);
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.waitForSelector('.drawing [data-node="db"]', { timeout: 10000 });
await wait(500);

// 1. Bo's note: a numbered marker, unread, counted on the Notes tool.
if ((await markers().count()) !== 1) fail(`one marker expected, got ${await markers().count()}`);
if (!(await page.locator('.stage .note-marker.unread').count())) fail('Bo’s note should be unread');
if (!(await page.locator('.canvas-tools .tool-count.unread').count())) fail('the Notes tool should count an unread note');
const label = await markers().first().getAttribute('aria-label');
if (label !== 'Note 1 on Orders DB, unread') fail(`marker label: ${label}`);
await page.screenshot({ path: `${out}/1-unread-marker.png` });

// 2. N on a selection: what is typed right away is the note (review 3: it went into the name field and
// the note was lost); the name is asked once, next to the send button.
await select('api');
await page.keyboard.press('n');
await wait();
if (!(await page.locator('.notes-panel').isVisible())) fail('N should open the Notes panel');
const composer = page.locator('.note-thread.drafting textarea');
if (!(await composer.isVisible())) fail('N should open the note composer at once, also before a name is known');
await page.keyboard.type('Is **this**');
if ((await composer.inputValue()) !== 'Is **this**') fail(`typing after N should go into the note, got "${await composer.inputValue()}"`);
if (await page.locator('#note-author').count()) fail('no separate name form while writing the first note');
if (!(await page.locator('.note-thread.drafting .note-about').innerText()).includes('Orders API')) fail('the draft should say it is on Orders API');
await composer.fill('Is **this** one service?\n- billing\n- shipping');
const send = page.locator('.note-thread.drafting button:has-text("Add note")');
if (!(await send.isDisabled())) fail('Add note waits for a name the first time');
await page.locator('.note-thread.drafting .note-composer-name').fill('Ann');
await page.screenshot({ path: `${out}/2-first-note-name.png` });
await page.keyboard.press('Enter');
await wait();
let list = await threads();
const ann = list.find((t) => t.author === 'Ann');
if (!ann || ann.anchor.id !== 'api' || ann.anchor.kind !== 'node') fail(`Ann's note not stored on api: ${JSON.stringify(ann)}`);
if ((await markers().count()) !== 2) fail('two markers expected after adding a note');
if (!(await page.locator('.note-thread .note-text strong:text-is("this")').count())) fail('**this** should show bold');
if ((await page.locator('.note-thread .note-text li').count()) !== 2) fail('the list should show as two items');
await page.screenshot({ path: `${out}/2-added.png` });

// 3. A reply.
const annThread = page.locator(`[data-thread="${ann?.id}"]`);
await annThread.locator('button:has-text("Reply")').click();
await annThread.locator('textarea').fill('Billing moves out next quarter.');
await page.keyboard.press('Meta+Enter');
await wait();
list = await threads();
if (list.find((t) => t.id === ann?.id)?.replies?.length !== 1) fail('the reply was not stored');
if (!(await annThread.locator('.note-entry.reply').innerText()).includes('Billing moves out')) fail('the reply is not shown');

// 4. Opening Bo's note from its marker reads it.
await page.locator('.stage .note-marker[data-note="1"]').click();
await wait();
if (await page.locator('.stage .note-marker.unread').count()) fail('opening the note should mark it read');
if (!(await page.locator(`[data-thread="${bo.id}"].active`).count())) fail('the marker should open its thread');

// 5. Resolve: gone from Open, there under Resolved and All, with a hollow marker.
await annThread.locator('button:has-text("Resolve")').click();
await wait();
if ((await threads()).find((t) => t.id === ann?.id)?.status !== 'resolved') fail('resolve was not stored');
if (await page.locator(`[data-thread="${ann?.id}"]`).count()) fail('a resolved note should leave the Open list');
await page.locator('.notes-tools [role=radio]:has-text("All")').click();
await wait();
if (!(await page.locator(`[data-thread="${ann?.id}"] .note-tag:text-is("resolved")`).count())) fail('All should list the resolved note');
if (!(await page.locator('.stage .note-marker.hollow').count())) fail('a resolved note shows a hollow marker under All');
await page.locator(`[data-thread="${ann?.id}"] button:has-text("Reopen")`).click();
await wait();
if ((await threads()).find((t) => t.id === ann?.id)?.status !== 'open') fail('reopen was not stored');
await page.locator('.notes-tools [role=radio]:has-text("Open")').click();
await page.screenshot({ path: `${out}/3-panel.png` });

// 6. A note by right-click on the web shop: the menu offers it on the element and on the spot.
await page.locator('.drawing [data-node="web"]').click({ button: 'right' });
await wait(200);
const item = page.locator('.context-menu [role=menuitem]:has-text("Add a note on Web shop")');
if (!(await item.count())) fail('right-click should offer a note on the element');
await page.screenshot({ path: `${out}/4-context-menu.png` });
await item.click();
await page.locator('.note-thread.drafting textarea').fill('Rename to Storefront?');
await page.locator('.note-thread.drafting button:has-text("Add note")').click();
await wait();
const webNote = (await threads()).find((t) => t.anchor.id === 'web');
if (!webNote) fail('the right-click note was not stored on web');

// 7. Renamed in the inspector (with the panel closed): Bo's note follows to the new id.
await page.keyboard.press('Escape');
await page.locator('.preview').focus();
await page.keyboard.press('Shift+N');
await wait();
if (await page.locator('.notes-panel').count()) fail('⇧N should close the panel');
await page.locator('.drawing [data-node="db"]').click();
await wait();
await page.locator('.inspector-more summary').click();
await wait(150);
const id = page.locator('.inspector .field:has(> span:text-is("ID")) input');
await id.fill('orders-db');
await id.press('Enter');
await wait(500);
if (!(await yaml()).includes('orders-db:')) fail('the rename did not reach the YAML');
const moved = (await threads()).find((t) => t.id === bo.id);
if (moved?.anchor.id !== 'orders-db') fail(`Bo's note should follow the rename: ${JSON.stringify(moved?.anchor)}`);
if (!(await page.locator('.stage .note-marker[data-note="1"]').count())) fail('the renamed element keeps its marker');

// 8. The web shop deleted: its note stays, orphaned, without a marker.
await select('web');
await page.keyboard.press('Backspace');
await wait(600);
await page.locator('.preview').focus();
await page.keyboard.press('Shift+N');
await wait();
if (!(await page.locator(`[data-thread="${webNote?.id}"] .note-tag:text-is("gone")`).count())) fail('a note on a deleted element should say it is gone');
if (!(await page.locator(`[data-thread="${webNote?.id}"] .note-go`).innerText()).includes('Web shop')) fail('an orphaned note keeps the label it had');
if (await page.locator(`.stage .note-marker[data-note="3"]`).count()) fail('an orphaned note has no marker');
if ((await threads()).length !== 3) fail('deleting an element must not delete its note');

// 9. Review mode: the drawing stands back.
await page.locator('.preview').focus();
await page.keyboard.press('Shift+R');
await wait();
if (!(await page.locator('.canvas-pane.review-mode').count())) fail('⇧R should turn review mode on');
await page.screenshot({ path: `${out}/5-review-mode.png` });
await page.locator('.preview').focus();
await page.keyboard.press('Shift+R');
await wait();
if (await page.locator('.canvas-pane.review-mode').count()) fail('⇧R again should leave review mode');

// 10. Exports: without notes unless asked; with them, markers and the notes under the drawing.
const plain = await exported();
if (plain.includes('data-note')) fail('a plain export must not carry notes');
await page.locator('.notes-footer input[type=checkbox]').check();
await wait();
const noted = await exported();
if (!noted.includes('data-note="1"') || !noted.includes('Review notes') || !noted.includes('Postgres or the managed one?')) fail('the export with notes should have markers and the notes');
if (!noted.includes('Web shop (no longer in the diagram)')) fail('the orphaned note should be listed in the export');
fs.writeFileSync(`${out}/with-notes.svg`, noted);
await palette('exports without review notes');
await wait();
if ((await exported()).includes('data-note')) fail('turned off in the palette, exports carry no notes again');

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all notes steps ok');
process.exitCode = problems.length ? 1 : 0;
await browser.close();
