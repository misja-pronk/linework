// A class diagram in the builder: a class picked and a member added in the inspector's member list,
// an interface added from the keyboard, a class made to extend another from its Extends picker, and
// the template drawn without problems:
// node e2e/class.mjs <outDir>
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
const field = (name) => page.locator(`.inspector .field:has(> span:text-is("${name}"))`).first().locator('input, textarea, select').first();
const rest = async () => {
  await page.locator('.preview').focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+0');
  await wait();
};
const text = readFileSync(new URL('../../../examples/class/strategy.yaml', import.meta.url), 'utf8');

await page.addInitScript(
  ([text]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    localStorage.setItem('linework:inspectorMore', 'true');
    for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'visual', doc: { text, doc: { name: 'strategy.yaml' } } })) localStorage.setItem(`linework:${k}`, JSON.stringify(v));
  },
  [text],
);
await page.goto(process.env.LINEWORK_URL ?? 'http://localhost:5178/');
await page.waitForSelector('.drawing [data-node="Checkout"]', { timeout: 10000 });
await wait(500);
await page.screenshot({ path: `${out}/k1-diagram.png` });
{
  const svg = await page.locator('.drawing svg').first().innerHTML();
  for (const word of ['«interface»', 'setStrategy(s: ShippingCost)', 'Implements']) if (!svg.includes(word)) fail(`the drawing does not say ${word}`);
}

// 1. A class picked: it reads as a class, and its members are a list to edit; one more lands in the YAML and the drawing.
{
  await node('Checkout').click();
  await page.waitForSelector('.inspector label.field');
  const head = await page.locator('.inspector').innerText();
  if (head.split('\n')[1]?.trim().toLowerCase() !== 'class') fail(`the inspector does not call Checkout a class:\n${head.slice(0, 80)}`);
  const members = field('Members');
  const value = await members.inputValue().catch(() => '');
  if (!value.includes('-strategy: ShippingCost') || !value.includes('+shippingTotal(): Money')) fail(`the members are not in the inspector: "${value}"`);
  await members.fill(`${value}; +reset(): void`);
  await members.press('Enter');
  const t = await yaml();
  if (!t.includes('+reset(): void')) fail(`the new member did not reach the YAML\n${t.slice(0, 400)}`);
  if (/ShippingCost, \+/.test(t) || !/("\+shippingTotal\(\): Money"|- \+shippingTotal\(\): Money\n)/.test(t)) fail(`the members ran together\n${t.slice(0, 400)}`);
  await wait(500);
  if (!(await page.locator('.drawing svg').first().innerHTML()).includes('reset()')) fail('the new member is not drawn');
  await page.screenshot({ path: `${out}/k2-member.png` });
}

// 2. An interface added from the keyboard: it lands in classes: as an interface.
{
  await rest();
  await page.keyboard.press('a');
  await page.keyboard.type('interface');
  await page.keyboard.press('Enter');
  const t = await yaml();
  if (!/\n {2}interface: \{ kind: interface, label: Interface \}/.test(t)) fail(`adding an interface did not write one\n${t.slice(-300)}`);
  await page.waitForSelector('.drawing [data-node="interface"]', { timeout: 5000 }).catch(() => fail('the new interface is not drawn'));
  if (!(await page.locator('.drawing svg').first().innerHTML()).includes('«interface»')) fail('the new interface is not drawn as one');
  await page.screenshot({ path: `${out}/k3-interface.png` });
}

// 3. Parcel made to extend another class from its Extends picker: a triangle line is drawn, the parent above.
{
  await rest();
  await node('Parcel').click();
  await wait();
  const ext = field('Extends');
  await ext.selectOption('Checkout');
  const t = await yaml();
  if (!/Parcel:[\s\S]*extends: Checkout/.test(t)) fail(`extends did not reach the YAML\n${t.slice(-400)}`);
  await wait(600);
  const a = await node('Checkout').boundingBox();
  const b = await node('Parcel').boundingBox();
  if (!(a && b && a.y + a.height <= b.y + 1)) fail('the parent does not stand above its child');
  await page.screenshot({ path: `${out}/k4-extends.png` });
}

const status = await page.locator('.statusbar, footer').first().innerText().catch(() => '');
if (/error/i.test(status) && !/No problems/.test(status)) fail(`problems: ${status}`);

await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('class: ok');
