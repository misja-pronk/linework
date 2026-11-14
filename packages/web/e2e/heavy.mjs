// A drawing that takes long never holds the editor up: the whole of a heavy working canvas (the
// Databricks governance example, present: views, about a minute to lay out) is laid out in a worker.
// Meanwhile the page answers, a note says how long it has been at it, Stop gives it up and goes back
// to the view on screen, and picking another view stops it too.
// node e2e/heavy.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? '.';
const url = process.env.CARTO_URL ?? 'http://localhost:5178/';
const repo = path.resolve(import.meta.dirname, '../../..');
const text = fs.readFileSync(path.join(repo, 'examples/databricks/governance.yaml'), 'utf8');
const problems = [];
const fail = (m) => problems.push(m);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
await page.addInitScript((seed) => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  localStorage.clear();
  const doc = { text: seed, doc: { name: 'governance.yaml', starter: 'example:databricks/governance.yaml' } };
  for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'visual', doc })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
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
  if (!/Laying out the whole canvas: \d+ s/.test(said)) fail(`the note says: ${said}`);
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

await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`heavy: ok (held up at most ${worst} ms; another view in ${took} ms)`);
