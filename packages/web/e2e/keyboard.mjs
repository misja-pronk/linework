// The builder without a mouse: template, add, name, connect, label, all by keyboard.
import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
const yaml = () => page.evaluate(() => document.querySelector('.cm-content').innerText);
const wait = (ms = 300) => page.waitForTimeout(ms);
await page.goto('http://localhost:5178/');
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('cartography:started', 'true');
});
await page.reload();
await page.waitForSelector('.drawing svg');
await page.keyboard.press('Meta+k');
await page.keyboard.type('empty azure');
await page.keyboard.press('Enter');
await wait(500);
for (const [what, name] of [['app service', 'Shop'], ['sql database', 'Orders DB']]) {
  await page.keyboard.press('a');
  await wait(150);
  await page.keyboard.type(what);
  await page.keyboard.press('Enter');
  await wait(500);
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await wait(400);
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
await wait(600);
await page.keyboard.type('SQL');
await page.keyboard.press('Enter');
await wait(500);
const y2 = await yaml();
if (!/app-service -> sql-database: SQL/.test(y2)) problems.push('connect + label by keyboard failed:\n' + y2);
await page.screenshot({ path: `${out}/k-done.png` });
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'keyboard journey ok');
await browser.close();
