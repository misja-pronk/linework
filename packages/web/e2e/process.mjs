// A process in the builder and the presenter: a step picked, edited and renamed, a step added from the
// keyboard, joined by a drag and its line labelled, taken away again, not dragged out of its place, and
// the happy path told one step at a time:
// node e2e/process.mjs <outDir>
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
const flow = (t) => t.slice(t.indexOf('\nflow:')).trim().split('\n').slice(1).map((l) => l.replace(/^\s*- /, ''));
const node = (id) => page.locator(`.drawing [data-node="${id}"]`);
const field = (name) => page.locator(`.inspector .field:has(> span:text-is("${name}"))`).first().locator('input, textarea').first();
const rest = async () => {
  await page.locator('.preview').focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+0');
  await wait();
};
const text = readFileSync(new URL('../../../examples/process/access-request.yaml', import.meta.url), 'utf8');

await page.addInitScript(
  ([text]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    // The inspector with "More" open: these steps check every field.
    localStorage.setItem('cartography:inspectorMore', 'true');
    for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'visual', doc: { text, doc: { name: 'process.yaml' } } })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
  },
  [text],
);
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.waitForSelector('.drawing [data-node="Check request"]', { timeout: 10000 });
await wait(500);
await page.screenshot({ path: `${out}/p1-builder.png` });

// 1. A step picked: it goes by its name, not an id; a caption lands in the YAML.
{
  await node('Check request').click();
  await page.waitForSelector('.inspector label.field');
  const names = await page.locator('.inspector label.field > span').allInnerTexts();
  for (const want of ['Name', 'Kind', 'Inside', 'Caption']) if (!names.includes(want)) fail(`no ${want} field for a step: ${names.join(', ')}`);
  if (names.includes('ID')) fail('a step shows an ID field');
  const caption = field('Caption');
  await caption.fill('within two days');
  await caption.press('Enter');
  if (!/Check request: \{ in: manager, kind: user, caption: within two days \}/.test(await yaml())) fail('the caption is not in the YAML');
  await page.screenshot({ path: `${out}/p2-step.png` });
}

// 2. Renamed: the name changes where the step is described and in every line of the flow.
{
  const name = field('Name');
  await name.fill('Review request');
  await name.press('Enter');
  const t = await yaml();
  if (!t.includes('  Review request: {') || t.includes('Check request')) fail('the rename did not reach the step');
  if (!flow(t)[0].startsWith('start -> Request access -> Review request -> Approved?')) fail(`the rename did not reach the flow: ${flow(t)[0]}`);
  if (!(await node('Review request').count())) fail('the renamed step is not drawn');
}

// 3. A decision picked by clicking it, though the flow alone names it: its fields are there to fill.
{
  await rest();
  await node('Approved?').click();
  await wait();
  const names = await page.locator('.inspector label.field > span').allInnerTexts();
  if (!names.includes('Name') || !names.includes('Inside')) fail(`a step only the flow names has no fields: ${names.join(', ')}`);
}

// 4. A timer added from the keyboard, under the name it shows.
{
  await rest();
  await page.keyboard.press('a');
  await page.keyboard.type('timer');
  await page.keyboard.press('Enter');
  if (!(await yaml()).includes('  Timer: timer\n')) fail('adding from the keyboard did not write "Timer: timer"');
  await page.waitForSelector('.drawing [data-node="Timer"]');
  await page.screenshot({ path: `${out}/p3-added.png` });
}

// 5. Joined by a drag from the handle: one more line in the flow.
{
  await rest();
  const a = await node('Explain why').boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await wait(150);
  const h = await page.locator('.connect-handle').boundingBox();
  const b = await node('Timer').boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(h.x + ((b.x + b.width / 2 - h.x) * i) / 8, h.y + ((b.y + b.height / 2 - h.y) * i) / 8);
  await page.screenshot({ path: `${out}/p4-connecting.png` });
  await page.mouse.up();
  const t = await yaml();
  if (flow(t).at(-1) !== 'Explain why -> Timer') fail('the drag did not add a line: ' + ((await page.locator('.toast').allInnerTexts()).join() || 'no message') + '\n' + flow(t).join('\n'));
}

// 6. The new line picked from the step's connections and named: short on the arrow, long after the line.
{
  await rest();
  await node('Explain why').click();
  await wait();
  await page.locator('.connections .connection:has-text("Timer")').click();
  await wait();
  const label = field('Label');
  if (await label.count()) {
    await label.fill('wait');
    await label.press('Enter');
    if (flow(await yaml()).at(-1) !== 'Explain why -wait-> Timer') fail(`a short label is not on the arrow: ${flow(await yaml()).at(-1)}`);
    await field('Label').fill('after a week without an answer');
    await field('Label').press('Enter');
    if (flow(await yaml()).at(-1) !== 'Explain why -> Timer: after a week without an answer') fail(`a long label is not after the line: ${flow(await yaml()).at(-1)}`);
  } else fail('a line of the flow has no label field');
  await page.screenshot({ path: `${out}/p5-line.png` });
}

// 7. A step is not dragged out of its place: the flow places it, no pin is written.
{
  await rest();
  const box = await node('Grant access').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 - 80, { steps: 6 });
  await page.mouse.up();
  await wait(500);
  const doc = await stored('doc');
  if (JSON.stringify(doc?.pins ?? null).includes('Grant access')) fail('a drag pinned a step of a process');
}

// 8. The timer deleted: its line goes with it, the rest of the flow stays, and nothing is left to remark on.
{
  await rest();
  await node('Timer').click();
  await wait();
  await page.locator('.preview').focus();
  await page.keyboard.press('Delete');
  const t = await yaml();
  if (t.includes('Timer')) fail('Delete left the timer in the YAML');
  if (flow(t).length !== 2 || !flow(t)[1].startsWith('Approved? -no-> Explain why')) fail(`Delete took more than the timer's line: ${flow(t).join(' | ')}`);
  const status = await page.locator('.status-problems').innerText();
  if (status !== 'No problems') fail(`after the edits: ${status}`);
}

// 9. Presenting: the happy path one step at a time, each with its words.
{
  await rest();
  await page.locator('.canvas-tools button:has-text("Present")').click();
  await page.waitForSelector('.present .present-frame svg');
  await wait(600);
  const first = await page.locator('.present-count').innerText();
  if (!/^1 \/ \d+$/.test(first)) fail(`presenter count: ${first}`);
  const total = Number(first.split('/')[1]);
  if (total < 6) fail(`expected a slide per step of the happy path, got ${total}`);
  await page.screenshot({ path: `${out}/p6-present-1.png` });
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight'), await wait(350);
  const fourth = await page.locator('.present-count').innerText();
  if (!fourth.startsWith('4 /')) fail(`after three steps forward: ${fourth}`);
  if (!(await page.locator('.present-words').innerText()).trim()) fail('no words on a step of the happy path');
  if (!(await page.locator('.present .present-frame:not(.leaving) [data-dim]').count())) fail('nothing stands back on a step of the happy path');
  await page.screenshot({ path: `${out}/p7-present-4.png` });
  await page.keyboard.press('Escape');
  await wait(300);
  if (await page.locator('.present').count()) fail('Esc did not leave the presenter');
}

await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('process in builder and presenter OK');
