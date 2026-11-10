// An org chart and its Team Topologies view in the builder: a person picked and edited, a report
// added under a picked manager, a focus on that manager's branch, and a team's type changed in the
// topology view:
// node e2e/teams.mjs <outDir>
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
const text = readFileSync(new URL('../../../examples/teams/product-org.yaml', import.meta.url), 'utf8');

await page.addInitScript(
  ([text]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    // The inspector with "More" open: these steps check every field.
    localStorage.setItem('cartography:inspectorMore', 'true');
    for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'visual', doc: { text, doc: { name: 'teams.yaml' } } })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
  },
  [text],
);
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.waitForSelector('.drawing [data-node="anna"]', { timeout: 10000 });
await wait(500);
await page.screenshot({ path: `${out}/t1-org.png` });

// 1. A person picked: name, role and manager are fields; a new role lands in the YAML and the card.
{
  await node('kai').click();
  await page.waitForSelector('.inspector label.field');
  const names = await page.locator('.inspector label.field > span').allInnerTexts();
  for (const want of ['Name', 'Role', 'Reports', 'Dotted', 'Vacant']) if (!names.includes(want)) fail(`no ${want} field for a person: ${names.join(', ')}`);
  if ((await field('Reports').inputValue()) !== 'dewi') fail('the manager of Kai is not in the inspector');
  const role = field('Role');
  await role.fill('Lead UX researcher');
  await role.press('Enter');
  if (!(await yaml()).includes('kai: { name: Kai Vermeer, role: Lead UX researcher, reports: dewi }')) fail('the new role did not reach the YAML');
  if (!(await node('kai').innerHTML()).includes('Lead UX researcher')) fail('the card does not show the new role');
  await page.screenshot({ path: `${out}/t2-person.png` });
}

// 2. A person added with a manager picked: they report to that manager and hang under the card.
{
  await rest();
  await node('dewi').click();
  await wait();
  await page.keyboard.press('a');
  await page.keyboard.type('person');
  await page.keyboard.press('Enter');
  if (!/ {2}person: \{ name: Person, reports: dewi \}/.test(await yaml())) fail('adding under a manager did not write reports: dewi');
  await page.waitForSelector('.drawing [data-node="person"]');
  const added = await node('person').boundingBox();
  const boss = await node('dewi').boundingBox();
  if (!(added.y > boss.y + boss.height)) fail('the new person does not stand under the manager');
  await page.screenshot({ path: `${out}/t3-added.png` });
}

// 3. Focus on a manager: their branch and the line to the top, nobody beside it.
{
  await rest();
  await node('bo').click();
  await wait();
  await page.keyboard.press('f');
  await wait(900);
  const shown = await page.locator('.drawing [data-node]').evaluateAll((els) => els.map((e) => e.getAttribute('data-node')));
  for (const id of ['anna', 'bo', 'dana', 'eli', 'finn']) if (!shown.includes(id)) fail(`the branch of bo lacks ${id}`);
  for (const id of ['gus', 'kai', 'dewi']) if (shown.includes(id)) fail(`the branch of bo shows ${id}`);
  await page.screenshot({ path: `${out}/t4-focus.png` });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await wait(600);
}

// 4. The topology view: teams in their book shapes; a team's type changed in the inspector.
{
  await rest();
  const picker = page.locator('.view-picker select').first();
  await picker.selectOption('topology');
  await page.waitForSelector('.drawing [data-node="platform"]');
  await wait(500);
  await page.screenshot({ path: `${out}/t5-topology.png` });
  await node('accounts').click();
  await page.waitForSelector('.inspector label.field');
  const kind = field('Kind');
  await kind.selectOption('enabling');
  await wait(600);
  if (!(await yaml()).includes('accounts: { kind: enabling')) fail('the team type did not reach the YAML');
  const box = await node('accounts').boundingBox();
  if (box.height < box.width) fail('an enabling team is not drawn upright');
  await page.screenshot({ path: `${out}/t6-kind.png` });
}

await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('teams: ok');
