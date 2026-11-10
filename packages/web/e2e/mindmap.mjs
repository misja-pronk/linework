// A mind map in the builder: a branch picked and given a note in the inspector, a topic added under it
// from the keyboard (the other branches stay where they were), a branch moved to the other side, and
// the depth folding deeper topics into a count:
// node e2e/mindmap.mjs <outDir>
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
const node = (id) => page.locator(`.drawing [data-node="${id}"]`);
const field = (name) => page.locator(`.inspector .field:has(> span:text-is("${name}"))`).first().locator('input, textarea, select').first();
const rest = async () => {
  await page.locator('.preview').focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+0');
  await wait();
};
const centre = async (id) => {
  const b = await node(id).boundingBox();
  return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : undefined;
};
const text = readFileSync(new URL('../../../examples/mindmap/capability-brainstorm.yaml', import.meta.url), 'utf8');

await page.addInitScript(
  ([text]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    localStorage.setItem('cartography:inspectorMore', 'true');
    for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'visual', doc: { text, doc: { name: 'brainstorm.yaml' } } })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
  },
  [text],
);
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5181/');
await page.waitForSelector('.drawing [data-node="Ingest"]', { timeout: 10000 });
await wait(500);
await page.screenshot({ path: `${out}/m1-map.png` });
{
  const svg = await page.locator('.drawing svg').first().innerHTML();
  // depth: 2 folds the third level into counts.
  if (!svg.includes('+3') || svg.includes('Schema checks')) fail('the depth does not fold the third level into a count');
  const c = await centre('(center)');
  const right = (await centre('Ingest')).x > c.x;
  const left = (await centre('Govern')).x < c.x;
  if (!right || !left) fail('the branches do not stand on both sides of the centre');
}

// 1. A branch picked: a note lands in the YAML and under its name.
{
  await node('Ingest').click();
  await page.waitForSelector('.inspector label.field');
  const note = field('Note');
  await note.fill('Batch and streaming');
  await note.press('Enter');
  const t = await yaml();
  if (!/Ingest:\n {4}note: Batch and streaming|Ingest: \{ note: Batch and streaming/.test(t) && !t.includes('note: Batch and streaming')) fail(`the note did not reach the YAML\n${t.slice(0, 400)}`);
  await wait(500);
  if (!(await page.locator('.drawing svg').first().innerHTML()).includes('Batch and streaming')) fail('the note is not drawn');
  await page.screenshot({ path: `${out}/m2-note.png` });
}

// 2. A topic added under the picked branch from the keyboard: it hangs from Ingest, the other side keeps its place.
{
  // Measured from the centre topic, in its widths: the view may move and zoom, the map around the centre should not.
  const from = async (id) => {
    const [a, c, w] = [await centre(id), await centre('(center)'), (await node('(center)').boundingBox()).width];
    return { x: (100 * (a.x - c.x)) / w, y: (100 * (a.y - c.y)) / w };
  };
  const before = { Govern: await from('Govern'), Learn: await from('Learn'), Observe: await from('Observe') };
  await rest();
  await node('Ingest').click();
  await wait();
  await page.keyboard.press('a');
  await page.keyboard.type('topic');
  await page.keyboard.press('Enter');
  const t = await yaml();
  if (!/Topic: \{ parent: Ingest \}/.test(t)) fail(`adding under a branch did not write parent: Ingest\n${t.slice(-300)}`);
  await page.waitForSelector('.drawing [data-node="Topic"]', { timeout: 5000 }).catch(() => fail('the new topic is not drawn'));
  await page.locator('.preview').focus();
  await page.keyboard.press('Escape');
  await wait(600);
  const ingest = await node('Ingest').boundingBox();
  const topic = await node('Topic').boundingBox();
  if (!(topic && ingest && topic.x > ingest.x + ingest.width)) fail('the new topic does not stand out from Ingest');
  for (const [id, was] of Object.entries(before)) {
    const now = await from(id);
    if (Math.hypot(now.x - was.x, now.y - was.y) > 2) fail(`${id} moved when a topic was added on the other side: ${JSON.stringify([was, now])}`);
  }
  await page.screenshot({ path: `${out}/m3-added.png` });
}

// 3. A branch sent to the other side from its Side picker.
{
  await rest();
  await node('Govern').click();
  await wait();
  await field('Side').selectOption('right');
  const t = await yaml();
  if (!/Govern:[\s\S]*side: right/.test(t)) fail(`side: right did not reach the YAML\n${t.slice(0, 600)}`);
  await wait(600);
  if ((await centre('Govern')).x < (await centre('(center)')).x) fail('Govern did not move to the right side');
  await page.screenshot({ path: `${out}/m4-side.png` });
}

await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('mindmap: ok');
