// The builder without a mouse: template, add, name, connect, label, all by keyboard.
import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
const yaml = () => page.evaluate(() => document.querySelector('.cm-content').innerText);
const wait = (ms = 300) => page.waitForTimeout(ms);
// Wait for what the next key needs, not for a fixed time: a field in focus, or the YAML having caught up.
const state = () => page.evaluate(() => `focus on ${document.activeElement?.outerHTML.slice(0, 120)}\n${document.querySelector('.cm-content').innerText}`);
const until = async (what, fn, arg) => {
  try {
    await page.waitForFunction(fn, arg, { timeout: 8000 });
  } catch {
    console.log(`PROBLEMS:\nno ${what}; ${await state()}`);
    await page.screenshot({ path: `${out}/k-stuck.png` });
    await browser.close();
    process.exit(1);
  }
};
const field = (not) => until('field to type in', (not) => document.activeElement?.tagName === 'INPUT' && !document.activeElement.closest(not), not);
const written = (text) => until(`"${text}" in the YAML`, (text) => document.querySelector('.cm-content').innerText.includes(text), text);
await page.goto(process.env.LINEWORK_URL ?? 'http://localhost:5178/');
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('linework:started', 'true');
  // The YAML starts folded to its rail; these steps type in it.
  localStorage.setItem('linework:yaml-folded', 'false');
});
await page.reload();
await page.waitForSelector('.drawing svg');
await page.keyboard.press('Meta+k');
await page.keyboard.type('blank azure');
await page.keyboard.press('Enter');
await wait(500);
for (const [what, name] of [['app service', 'Shop'], ['sql database', 'Orders DB']]) {
  await page.keyboard.press('a');
  await page.waitForSelector('.add-menu input:focus');
  await page.keyboard.type(what);
  await page.keyboard.press('Enter');
  await field('.add-menu');
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await written(`label: ${name}`);
  await wait(200);
}
const y1 = await yaml();
if (!y1.includes('label: Shop') || !y1.includes('label: Orders DB')) problems.push('adding by keyboard failed:\n' + y1);
// Select the first element with Tab, connect it to the second, label the line.
await page.keyboard.press('Escape');
await page.keyboard.press('Tab');
await wait(200);
await page.keyboard.press('c');
await wait(200);
await page.keyboard.type('orders');
await page.keyboard.press('Enter');
await written('app-service -> sql-database');
await field('.palette, .add-menu');
await page.keyboard.type('SQL');
await page.keyboard.press('Enter');
await written('app-service -> sql-database: SQL');
const y2 = await yaml();
if (!/app-service -> sql-database: SQL/.test(y2)) problems.push('connect + label by keyboard failed:\n' + y2);
await page.screenshot({ path: `${out}/k-done.png` });

// YAML by hand: typed with its own indentation, typed leaning on Enter's, and Tab, all stay valid YAML.
{
  const lines = () => page.evaluate(() => [...document.querySelectorAll('.cm-line')].map((l) => l.textContent).join('\n'));
  await page.locator('.cm-content').click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Delete');
  const want = 'type: sequence\ntitle: Login\nmessages:\n  - user -> web: Sign in\n  - web --> user: Welcome\n  - alt: ok\n    messages:\n      - web -> user: Hi';
  await page.keyboard.type(want);
  if ((await lines()) !== want) problems.push('YAML typed with its own indentation came out indented twice:\n' + (await lines()));
  // Enter's indentation: after a key one level deeper, after a plain list item the next item lines up.
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Delete');
  for (const l of ['messages:', '- a -> b: one', '- b --> a: two']) {
    await page.keyboard.type(l);
    await page.keyboard.press('Enter');
  }
  if (!(await lines()).startsWith('messages:\n  - a -> b: one\n  - b --> a: two')) problems.push('Enter after a list item did not line the next one up:\n' + (await lines()));
  // Tab in the middle of a line puts spaces there; the line keeps its place. Never a tab character.
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type('title:');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Login');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('x');
  const t = await lines();
  if (!t.startsWith('title:  Login\n  x') || t.includes('\t')) problems.push('Tab did not indent with spaces where the cursor is: ' + JSON.stringify(t));
  // Esc, then Tab leaves the editor (the first Esc closes the suggestions, if any are open).
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  if (await page.evaluate(() => !!document.activeElement?.closest('.cm-editor'))) problems.push('Esc, then Tab did not leave the YAML');
  await page.keyboard.press('Meta+z');
}
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'keyboard journey ok');
await browser.close();
