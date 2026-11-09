// Screenshots of the running app for visual review: node e2e/shoot.mjs <outDir> [url]
import { chromium } from '@playwright/test';
const out = process.argv[2];
const url = process.argv[3] ?? 'http://localhost:5178/';
const browser = await chromium.launch();
const errors = [];
for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme });
  page.on('pageerror', (e) => errors.push(`${scheme}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${scheme} console: ${m.text()}`));
  await page.goto(url);
  await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('cartography:started', 'true');
});
  await page.reload();
  await page.waitForSelector('.drawing svg');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/app-${scheme}.png` });
  if (scheme === 'light') {
    await page.click('.drawing [data-node="customer-360"]');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${out}/select.png` });
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('exp png');
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/palette.png` });
    await page.keyboard.press('Escape');
    await page.click('text=Templates');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/templates.png` });
    await page.keyboard.press('Escape');
    // Autocomplete: a new key under a product.
    await page.click('.cm-line:has-text("crm: {")');
    await page.keyboard.press('End');
    await page.keyboard.type('\ndb: { kind: ');
    await page.keyboard.press('Control+Space');
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/complete.png` });
    await page.keyboard.press('Escape');
    await page.keyboard.type('nope');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/stale.png` });
  }
  await page.close();
}
await browser.close();
console.log(errors.length ? errors.join('\n') : 'no page errors');
