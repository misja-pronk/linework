// A state machine in the builder and the presenter: a state inside another picked and given an entry
// line, a state only the transitions name renamed, a state added from the keyboard, joined by a drag and
// its transition written as event [guard] / action, a state moved by hand and pinned, the added one
// taken away again, and the life of the thing told one state at a time:
// node e2e/states.mjs <outDir>
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
const stored = (k) => page.evaluate((k) => JSON.parse(localStorage.getItem(`cartography:${k}`) ?? 'null'), k);
const yaml = async () => (await wait(600), (await stored('doc'))?.text ?? '');
const moves = (t) => t.slice(t.indexOf('\ntransitions:')).trim().split('\n').slice(1).map((l) => l.replace(/^\s*- /, ''));
const node = (id) => page.locator(`.drawing [data-node="${id}"]`);
const field = (name) => page.locator(`.inspector .field:has(> span:text-is("${name}"))`).first().locator('input, textarea').first();
const rest = async () => {
  await page.locator('.preview').focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+0');
  await wait();
};
const text = readFileSync(new URL('../../../examples/states/order-lifecycle.yaml', import.meta.url), 'utf8');

await page.addInitScript(
  ([text]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'visual', doc: { text, doc: { name: 'states.yaml' } } })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
  },
  [text],
);
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.waitForSelector('.drawing [data-node="Awaiting payment"]', { timeout: 10000 });
await wait(500);
await page.screenshot({ path: `${out}/s1-builder.png` });

// 1. A state inside another picked: it goes by its name, and what it does on the way in lands where it is nested.
{
  await node('Picking').click();
  await page.waitForSelector('.inspector label.field');
  const names = await page.locator('.inspector label.field > span').allInnerTexts();
  for (const want of ['Name', 'Kind', 'Entry', 'Do', 'Exit']) if (!names.includes(want)) fail(`no ${want} field for a state: ${names.join(', ')}`);
  if (names.includes('ID')) fail('a state shows an ID field');
  if ((await field('Do').inputValue().catch(() => '')) !== 'collect the items') fail('what a state does is not there to edit in place');
  const entry = field('Entry');
  await entry.fill('open the pick list');
  await entry.press('Enter');
  const t = await yaml();
  if (!/\n      Picking: \{[^}\n]*entry: open the pick list[^}\n]*\}/.test(t)) fail(`the entry line is not with the nested state:\n${t}`);
  if (!(await node('Picking').textContent()).includes('open the pick list')) fail('the entry line is not drawn');
  await page.screenshot({ path: `${out}/s2-state.png` });
}

// 2. A state only the transitions name, renamed: every transition follows.
{
  await rest();
  await node('Shipped').click();
  await wait();
  const name = field('Name');
  await name.fill('Dispatched');
  await name.press('Enter');
  const t = await yaml();
  if (t.includes('Shipped')) fail('the rename left the old name behind');
  if (!moves(t).includes('Fulfilment -> Dispatched: handed to carrier') || !moves(t).includes('Dispatched -> Delivered: signed for')) fail(`the rename did not reach the transitions:\n${moves(t).join('\n')}`);
  if (!(await node('Dispatched').count())) fail('the renamed state is not drawn');
}

// 3. A state added from the keyboard, under the name it shows.
{
  await rest();
  await page.keyboard.press('a');
  await page.keyboard.type('state');
  await page.keyboard.press('Enter');
  if (!/\n  State: /.test(await yaml())) fail(`adding from the keyboard did not write a state:\n${await yaml()}`);
  await page.waitForSelector('.drawing [data-node="State"]');
  await page.screenshot({ path: `${out}/s3-added.png` });
}

// 4. Joined by a drag from the handle: one more transition.
{
  await rest();
  const a = await node('Delivered').boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await wait(150);
  const h = await page.locator('.connect-handle').boundingBox();
  const b = await node('State').boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(h.x + ((b.x + b.width / 2 - h.x) * i) / 8, h.y + ((b.y + b.height / 2 - h.y) * i) / 8);
  await page.screenshot({ path: `${out}/s4-connecting.png` });
  await page.mouse.up();
  const t = await yaml();
  if (moves(t).at(-1) !== 'Delivered -> State') fail('the drag did not add a transition: ' + ((await page.locator('.toast').allInnerTexts()).join() || 'no message') + '\n' + moves(t).join('\n'));
}

// 5. The new transition picked from the state's connections and written out: event, guard and action.
{
  await rest();
  await node('Delivered').click();
  await wait();
  await page.locator('.connections .connection:has-text("State")').click();
  await wait();
  const label = field('Label');
  if (await label.count()) {
    await label.fill('sent back [within 30 days] / refund');
    await label.press('Enter');
    const last = moves(await yaml()).at(-1);
    if (last !== 'Delivered -> State: sent back [within 30 days] / refund') fail(`the transition is not written as typed: ${last}`);
    if (!(await page.locator('.drawing svg').first().textContent()).includes('[within 30 days]')) fail('the guard is not drawn');
    // A guard alone starts with a bracket: it is quoted, so the YAML still reads.
    await field('Label').fill('[within 30 days]');
    await field('Label').press('Enter');
    const bare = moves(await yaml()).at(-1);
    if (!/^(["'])Delivered -> State: \[within 30 days\]\1$|^Delivered -> State: \[within 30 days\]$/.test(bare)) fail(`a guard alone is not written so that it reads: ${bare}`);
    const status = await page.locator('.status-problems').innerText();
    if (status !== 'No problems') fail(`after a guard alone: ${status}`);
  } else fail('a transition has no label field');
  await page.screenshot({ path: `${out}/s5-transition.png` });
}

// 6. A state moved by hand stays where it is put: pinned beside the YAML, which itself does not change.
{
  await rest();
  const before = await yaml();
  // Measured against a state that stays put: the view may move with the pick.
  const lead = async () => {
    const [a, b] = [await node('Cancelled').boundingBox(), await node('Delivered').boundingBox()];
    return (a.x - b.x) / b.width;
  };
  const was = await lead();
  const box = await node('Cancelled').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  await wait(500);
  const doc = await stored('doc');
  if (!JSON.stringify(doc?.pins ?? null).includes('Cancelled')) fail('a drag did not pin the state');
  if (doc.text !== before) fail('moving a state changed the YAML');
  if ((await lead()) - was < 0.5) fail(`the state did not move with the drag: ${was.toFixed(2)} to ${(await lead()).toFixed(2)}`);
  await page.screenshot({ path: `${out}/s6-moved.png` });
}

// 7. The state deleted: its transition goes with it, the others stay, and nothing is left to remark on.
{
  await rest();
  await node('State').click();
  await wait();
  await page.locator('.preview').focus();
  await page.keyboard.press('Delete');
  const t = await yaml();
  if (/\bState\b/.test(t)) fail('Delete left the state in the YAML');
  if (moves(t).length !== 10 || moves(t).at(-1) !== 'Cancelled -> end') fail(`Delete took more than the state's transition:\n${moves(t).join('\n')}`);
  const status = await page.locator('.status-problems').innerText();
  if (status !== 'No problems') fail(`after the edits: ${status}`);
}

// 8. Presenting: from the start to the end, one state at a time, each with its words.
{
  await rest();
  await page.locator('.canvas-tools button:has-text("Present")').click();
  await page.waitForSelector('.present .present-frame svg');
  await wait(600);
  const first = await page.locator('.present-count').innerText();
  if (!/^1 \/ \d+$/.test(first)) fail(`presenter count: ${first}`);
  const total = Number(first.split('/')[1]);
  if (total < 4) fail(`expected a slide per state on the way, got ${total}`);
  await page.screenshot({ path: `${out}/s7-present-1.png` });
  for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowRight'), await wait(350);
  const third = await page.locator('.present-count').innerText();
  if (!third.startsWith('3 /')) fail(`after two steps forward: ${third}`);
  if (!(await page.locator('.present-words').innerText()).trim()) fail('no words on a state of the walk');
  if (!(await page.locator('.present .present-frame:not(.leaving) [data-dim]').count())) fail('nothing stands back on a state of the walk');
  await page.screenshot({ path: `${out}/s8-present-3.png` });
  await page.keyboard.press('Escape');
  await wait(300);
  if (await page.locator('.present').count()) fail('Esc did not leave the presenter');
}

await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('states in builder and presenter OK');
