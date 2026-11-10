// A journey in the builder and the presenter: a step picked and edited, moved one place later, not dragged
// out of its place, and the story told one step at a time:
// node e2e/journey.mjs <outDir>
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
const text = readFileSync(new URL('../../../examples/journey/developer-onboarding.yaml', import.meta.url), 'utf8');

await page.addInitScript(
  ([text]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    // The inspector with "More" open: these steps check every field.
    localStorage.setItem('cartography:inspectorMore', 'true');
    for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'visual', doc: { text, doc: { name: 'journey.yaml' } } })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
  },
  [text],
);
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.waitForSelector('.drawing [data-node="access"]', { timeout: 10000 });
await wait(500);
await page.screenshot({ path: `${out}/j1-builder.png` });

// 1. A step picked: the inspector shows its fields, and a changed label lands in the YAML.
{
  await page.locator('.drawing [data-node="access"]').click();
  await page.waitForSelector('.inspector label.field');
  const names = await page.locator('.inspector label.field > span').allInnerTexts();
  for (const want of ['Label', 'Inside', 'Feel', 'Thought', 'Touchpoint', 'Pains']) if (!names.includes(want)) fail(`no ${want} field for a step: ${names.join(', ')}`);
  await page.screenshot({ path: `${out}/j2-step.png` });
  const input = page.locator('.inspector label.field', { hasText: 'Label' }).first().locator('input, textarea').first();
  await input.fill('Asks for access to everything');
  await input.press('Enter');
  if (!(await yaml()).includes('Asks for access to everything')) fail('the new label is not in the YAML');
}

// 2. One place earlier and back: the step trades places with its neighbour in the same phase; at the
//    edge of its phase it crosses into the next phase and stays where it is written.
{
  const order = (t) => [...t.matchAll(/^  ([a-z][\w-]*):\s*$/gm)].map((m) => m[1]).join(' ');
  const phase = (t) => /\n  access:\n(?:    .*\n)*?    in: (\S+)/.exec(t)?.[1];
  const before = await yaml();
  await page.locator('.inspector button:has-text("Earlier")').click();
  const earlier = await yaml();
  if (!order(earlier).startsWith('access welcome')) fail(`Earlier did not move the step: ${order(before)} -> ${order(earlier)}`);
  await page.locator('.inspector button:has-text("Later")').click();
  const back = await yaml();
  if (order(back) !== order(before)) fail(`Later did not move the step back: ${order(back)}`);
  await page.locator('.inspector button:has-text("Later")').click();
  const crossed = await yaml();
  if (order(crossed) !== order(before) || phase(crossed) !== 'commit') fail(`Later at the edge of a phase: ${order(crossed)}, in ${phase(crossed)}`);
  await page.screenshot({ path: `${out}/j2b-crossed.png` });
  await page.locator('.inspector button:has-text("Earlier")').click();
  if (phase(await yaml()) !== 'day-one') fail('Earlier did not bring the step back to its phase');
}

// 3. A step is not dragged out of its place: no pin is written.
{
  const box = await page.locator('.drawing [data-node="access"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  await wait(500);
  const doc = await stored('doc');
  if (JSON.stringify(doc?.pins ?? null).includes('access')) fail('a drag pinned a journey step');
}

// 4. Presenting: one slide per step, the caption from the step.
{
  await page.keyboard.press('Escape');
  await page.locator('.canvas-tools button:has-text("Present")').click();
  await page.waitForSelector('.present .present-frame svg');
  await wait(600);
  const first = await page.locator('.present-count').innerText();
  if (!/^1 \/ \d+$/.test(first)) fail(`presenter count: ${first}`);
  const total = Number(first.split('/')[1]);
  if (total < 6) fail(`expected a slide per step, got ${total}`);
  await page.screenshot({ path: `${out}/j3-present-1.png` });
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight'), await wait(350);
  const fourth = await page.locator('.present-count').innerText();
  if (!fourth.startsWith('4 /')) fail(`after three steps forward: ${fourth}`);
  const words = await page.locator('.present-words').innerText();
  if (!words.trim()) fail('no caption on a journey step');
  if (!/<rect[^>]* rx="[\d.]+" fill="none"/.test(await page.locator('.present .present-frame:not(.leaving)').innerHTML())) fail('no step in focus in the presenter');
  await page.screenshot({ path: `${out}/j4-present-4.png` });
  await page.keyboard.press('Escape');
  await wait(300);
  if (await page.locator('.present').count()) fail('Esc did not leave the presenter');
}

await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('journey in builder and presenter OK');
