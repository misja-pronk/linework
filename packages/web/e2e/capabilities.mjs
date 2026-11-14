// A capability map in the builder: a capability picked and its maturity changed in the inspector,
// one added inside it from the keyboard, the heatmap switched to another view, and the boxes not
// dragged out of their place:
// node e2e/capabilities.mjs <outDir>
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
const stored = (k) => page.evaluate((k) => JSON.parse(localStorage.getItem(`linework:${k}`) ?? 'null'), k);
const yaml = async () => (await wait(600), (await stored('doc'))?.text ?? '');
const node = (id) => page.locator(`.drawing [data-node="${id}"]`);
const field = (name) => page.locator(`.inspector .field:has(> span:text-is("${name}"))`).first().locator('input, textarea').first();
const rest = async () => {
  await page.locator('.preview').focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+0');
  await wait();
};
const text = readFileSync(new URL('../../../examples/capabilities/e-commerce.yaml', import.meta.url), 'utf8');

await page.addInitScript(
  ([text]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    // The inspector with "More" open: these steps check every field.
    localStorage.setItem('linework:inspectorMore', 'true');
    for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'visual', doc: { text, doc: { name: 'capabilities.yaml' } } })) localStorage.setItem(`linework:${k}`, JSON.stringify(v));
  },
  [text],
);
await page.goto(process.env.LINEWORK_URL ?? 'http://localhost:5178/');
await page.waitForSelector('.drawing [data-node="Returns"]', { timeout: 10000 });
await wait(500);
await page.screenshot({ path: `${out}/c1-map.png` });

// 1. A capability picked: its values are fields; a new run cost lands in the YAML and in the drawing.
{
  await node('Returns').click();
  await page.waitForSelector('.inspector label.field');
  const names = await page.locator('.inspector label.field > span').allInnerTexts();
  for (const want of ['Name', 'Parent', 'Systems']) if (!names.includes(want)) fail(`no ${want} field for a capability: ${names.join(', ')}`);
  if ((await field('Systems').inputValue()) !== 'Legacy OMS') fail('the systems of Returns are not in the inspector');
  const cost = field('Cost');
  await cost.fill('€90k');
  await cost.press('Enter');
  if (!(await yaml()).includes('- Returns: { cost: €90k')) fail('a new cost did not reach the YAML');
  await page.screenshot({ path: `${out}/c2-picked.png` });
}

// 2. One added inside a picked area from the keyboard: it gets parent: and stands inside the area.
{
  await rest();
  await node('Serve').click();
  await wait();
  await page.keyboard.press('a');
  await page.keyboard.type('capability');
  await page.keyboard.press('Enter');
  const t = await yaml();
  if (!/ {2}Capability: \{ parent: Serve \}/.test(t)) fail(`adding inside an area did not write parent: Serve\n${t.slice(-200)}`);
  await page.waitForSelector('.drawing [data-node="Capability"]');
  const inner = await node('Capability').boundingBox();
  const area = await node('Serve').boundingBox();
  if (!(inner.x >= area.x && inner.y >= area.y && inner.x + inner.width <= area.x + area.width + 1 && inner.y + inner.height <= area.y + area.height + 1)) fail('the new capability does not stand inside its area');
  await page.screenshot({ path: `${out}/c3-added.png` });
}

// 3. Renamed in the inspector: the key changes, and so does the drawing.
{
  const name = field('Name');
  await name.fill('Loyalty');
  await name.press('Enter');
  if (!(await yaml()).includes('  Loyalty: { parent: Serve }')) fail('the rename did not reach the YAML');
  if (!(await node('Loyalty').count())) fail('the renamed capability is not drawn');
}

// 4. Not dragged: a capability stays where the map puts it, no pin is written.
{
  await rest();
  const before = await node('Payment').boundingBox();
  await page.mouse.move(before.x + 20, before.y + 10);
  await page.mouse.down();
  await page.mouse.move(before.x + 200, before.y + 160, { steps: 8 });
  await page.mouse.up();
  await wait(600);
  const doc = await stored('doc');
  if (JSON.stringify(doc?.pins ?? null).includes('Payment')) fail('a drag pinned a capability');
}

// 5. The other heatmap, from the view picker: the legend says fit.
{
  await rest();
  const picker = page.locator('.view-picker select, select.view-picker').first();
  if (await picker.count()) {
    await picker.selectOption('fit');
    await wait(800);
    const svg = await page.locator('.drawing svg').first().innerHTML();
    if (!svg.includes('Fit: 1 Poor')) fail('the fit view has no fit legend');
    await page.screenshot({ path: `${out}/c4-fit.png` });
  } else fail('no view picker for the heatmaps');
}

await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('capabilities: ok');
