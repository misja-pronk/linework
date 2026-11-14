// A drawing that takes long never holds the editor up: the whole of a heavy working canvas (the
// Databricks governance example, present: views, about a minute to lay out) is laid out in a worker.
// Meanwhile the page answers, a note says how long it has been at it, Stop gives it up and goes back
// to the view on screen, and picking another view stops it too.
// node e2e/heavy.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? '.';
const url = process.env.LINEWORK_URL ?? 'http://localhost:5178/';
const repo = path.resolve(import.meta.dirname, '../../..');
const text = fs.readFileSync(path.join(repo, 'examples/databricks/governance.yaml'), 'utf8');
const problems = [];
const fail = (m) => problems.push(m);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
await page.addInitScript((seed) => {
  // The first load opens the governance example; a later one what sessionStorage's "next" says.
  const next = sessionStorage.getItem('next');
  if (sessionStorage.getItem('seeded') && !next) return;
  sessionStorage.setItem('seeded', '1');
  sessionStorage.removeItem('next');
  localStorage.clear();
  const doc = next ? JSON.parse(next) : { text: seed, doc: { name: 'governance.yaml', starter: 'example:databricks/governance.yaml' } };
  for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'visual', doc })) localStorage.setItem(`linework:${k}`, JSON.stringify(v));
}, text);
await page.goto(url);
await page.waitForSelector('.drawing svg', { timeout: 30000 });
await wait(800);
const picker = page.locator('.view-picker select');
const first = await picker.inputValue();
if (!first) fail('governance opens on its whole canvas, not on its first view');
const whole = await picker.locator('option[value=""]').count();
if (!whole) fail('the view picker does not offer the whole diagram');

/** The longest the page went without running a timer, over `ms`: how long it was held up. */
const heldUp = (ms) =>
  page.evaluate(
    (ms) =>
      new Promise((done) => {
        let last = performance.now();
        let worst = 0;
        const end = last + ms;
        const tick = () => {
          const now = performance.now();
          worst = Math.max(worst, now - last);
          last = now;
          if (now < end) setTimeout(tick, 10);
          else done(Math.round(worst));
        };
        setTimeout(tick, 10);
      }),
    ms,
  );

// 1. The whole diagram: the page keeps answering, and says it is laying out.
await picker.selectOption('');
const worst = await heldUp(4000);
if (worst > 400) fail(`the page was held up ${worst} ms while the whole canvas laid out`);
const note = page.locator('.busy-note');
if (!(await note.count())) fail('no note says the whole canvas is being laid out');
else {
  const said = await note.innerText();
  if (!/Laying out the whole canvas(, \d+ elements and \d+ lines)?: \d+ s/.test(said)) fail(`the note says: ${said}`);
}
// The editor answers meanwhile: the shortcuts sheet opens and closes.
await page.locator('.preview').focus();
await page.keyboard.press('?');
await page.waitForSelector('.shortcuts', { timeout: 2000 }).catch(() => fail('the shortcuts sheet did not open while laying out'));
await page.screenshot({ path: `${out}/heavy-busy.png` });
await page.keyboard.press('Escape');
await wait(300);

// 2. Stop: the note goes, the picker is back on the view drawn, and that drawing stays.
await page.locator('.busy-note button').click();
await wait(500);
if (await note.count()) fail(`the note stays after Stop: ${await note.innerText()}`);
const back = await picker.inputValue();
if (back !== first) fail(`after Stop the picker shows ${JSON.stringify(back)}, not ${JSON.stringify(first)}`);
if (!(await page.locator('.drawing svg').count())) fail('no drawing after Stop');
await page.screenshot({ path: `${out}/heavy-stopped.png` });
// Nothing comes back later from the drawing given up.
await wait(1500);
if ((await picker.inputValue()) !== first) fail('the whole canvas came back after Stop');

// 3. The whole again, then another view picked while it lays out: that view is drawn, soon.
await picker.selectOption('');
await wait(2500);
const views = await picker.locator('option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
const other = views.find((v) => v !== first);
const t0 = Date.now();
await picker.selectOption(other);
await page.waitForFunction((v) => document.querySelector('.view-picker select')?.value === v && !document.querySelector('.busy-note'), other, { timeout: 15000 }).catch(() => fail(`picking ${other} while the whole laid out did not draw it`));
const took = Date.now() - t0;
if (took > 10000) fail(`${other} took ${took} ms after the whole was given up`);
await page.screenshot({ path: `${out}/heavy-other.png` });

// 3b. The whole, laid out to the end: picked again after a look at a view, it is there at once,
// for the same text; an edit lays it out again.
await picker.selectOption('');
const w0 = Date.now();
await page.waitForFunction(() => document.querySelector('.view-picker select')?.value === '' && !document.querySelector('.busy-note'), null, { timeout: 300000 }).catch(() => fail('the whole canvas did not finish'));
const wholeMs = Date.now() - w0;
await picker.selectOption(other);
await page.waitForFunction((v) => document.querySelector('.view-picker select')?.value === v && !document.querySelector('.busy-note'), other, { timeout: 15000 }).catch(() => fail(`${other} was not drawn after the whole`));
await wait(400);
const r0 = Date.now();
await picker.selectOption('');
await page.waitForFunction(() => document.querySelector('.view-picker select')?.value === '' && !document.querySelector('.busy-note') && document.querySelectorAll('.drawing [data-node]').length > 40, null, { timeout: 15000 }).catch(() => fail('the whole canvas picked again was not shown'));
const again = Date.now() - r0;
if (again > 2500) fail(`the whole canvas picked again took ${again} ms (it took ${wholeMs} ms the first time)`);
await page.screenshot({ path: `${out}/heavy-whole-again.png` });
await page.locator('.view-switch button', { hasText: 'YAML' }).click();
await page.click('.cm-content');
await page.keyboard.press('Meta+End');
await page.keyboard.type('\n# edited');
await page.waitForSelector('.busy-note', { timeout: 15000 }).catch(() => fail('after an edit the whole canvas was not laid out again'));
await page.locator('.busy-note button').click();
await wait(600);

// 4. Twenty domains (databricks-at-scale): its whole canvas does not finish in minutes. The note says
// how big it is and that it takes minutes; the page answers meanwhile, and Stop brings the view back.
const scale = fs.readFileSync(path.join(repo, 'examples/databricks-at-scale/governance.yaml'), 'utf8');
await page.evaluate((text) => {
  sessionStorage.setItem('next', JSON.stringify({ text, doc: { name: 'governance.yaml', starter: 'example:databricks-at-scale/governance.yaml' } }));
}, scale);
await page.reload();
await page.waitForSelector('.drawing svg', { timeout: 60000 });
await page.waitForFunction(() => !document.querySelector('.busy-note'), null, { timeout: 60000 }).catch(() => fail('the first view of the large file does not finish'));
const big = await picker.inputValue();
await picker.selectOption('');
await page.waitForFunction(() => /elements and \d+ lines/.test(document.querySelector('.busy-note')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => fail('the note on the large canvas does not say how big it is'));
const said = (await note.count()) ? await note.innerText() : '';
if (!/9\d elements/.test(said) || !/can take minutes/.test(said)) fail(`the note on the large canvas says: ${said}`);
const worstBig = await heldUp(3000);
if (worstBig > 400) fail(`the page was held up ${worstBig} ms while the large canvas laid out`);
await page.screenshot({ path: `${out}/heavy-scale.png` });
await page.locator('.busy-note button').click();
await wait(600);
if (await note.count()) fail('the note stays after Stop on the large canvas');
if ((await picker.inputValue()) !== big) fail('after Stop on the large canvas the picker is not back on its first view');

await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`heavy: ok (held up at most ${worst} ms, ${worstBig} ms on the large canvas; another view in ${took} ms; the whole in ${wholeMs} ms, again in ${again} ms)`);
