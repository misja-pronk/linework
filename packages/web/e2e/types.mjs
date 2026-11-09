// The type chooser: a card per type, a search that ranks them, "Not for → X" jumps, the chosen type's
// templates with its guidance, and the type pill in the top bar. Light, dark and a phone. node e2e/types.mjs <outDir>
import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const problems = [];

async function run(name, viewport, colorScheme) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2, colorScheme });
  const fail = (m) => problems.push(`${name}: ${m}`);
  page.on('pageerror', (e) => fail(e.message));
  const wait = (ms = 300) => page.waitForTimeout(ms);
  await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.start .type-card');
  await wait(1800);
  await page.screenshot({ path: `${out}/${name}-1-types.png` });
  if ((await page.locator('.type-card').count()) < 6) fail('fewer than six type cards');
  if (!(await page.locator('.type-card', { hasText: 'Use when' }).count())) fail('no "Use when" on the cards');

  // The search box has focus; words rank the types.
  await page.keyboard.type('who has access');
  await wait();
  if ((await page.locator('.type-card.best').getAttribute('data-type')) !== 'access') fail('"who has access" did not pick access');
  await page.screenshot({ path: `${out}/${name}-2-search.png` });
  await page.keyboard.press('Escape');
  if (await page.locator('.search-field input').inputValue()) fail('Esc did not clear the search');
  if (!(await page.locator('.start').count())) fail('Esc with text closed the dialog');

  // "Not for → Database design" puts focus on that card.
  await page.locator('[data-type="systems"] .type-not button', { hasText: 'Database design' }).click();
  await wait(500);
  if ((await page.evaluate(() => document.activeElement?.closest('.type-card')?.getAttribute('data-type'))) !== 'erd') fail('Not-for link did not jump to erd');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.type-summary');
  await wait(1200);
  if (!(await page.locator('.type-summary', { hasText: 'Database design' }).count())) fail('templates step lacks the type guidance');
  if (await page.locator('.template-sub', { hasText: 'Azure' }).count()) fail('templates of other types shown');
  await page.screenshot({ path: `${out}/${name}-3-templates.png` });
  // Esc goes back to the types, focus on the chosen one.
  await page.keyboard.press('Escape');
  await wait();
  if ((await page.evaluate(() => document.activeElement?.closest('.type-card')?.getAttribute('data-type'))) !== 'erd') fail('back did not land on the chosen type');

  // Arrow keys from the search box into the cards, Enter opens, Enter on the template, 3 for YAML.
  await page.locator('.search-field input').focus();
  await page.keyboard.type('vnet subnet');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.template-card');
  await wait(300);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.mode-card');
  await page.keyboard.press('3');
  await wait(1200);
  const pill = page.locator('.type-pill');
  if (await pill.isVisible()) {
    if ((await pill.innerText()) !== 'Azure infrastructure') fail('pill shows the wrong type');
    await pill.click();
    await wait(300);
    await page.screenshot({ path: `${out}/${name}-4-pill.png` });
    await page.getByRole('menuitem', { name: /Which type do I need/ }).click();
    await page.waitForSelector('.type-card.current[data-type="azure"]').catch(() => fail('guide does not mark the open type'));
    await page.keyboard.press('Escape');
  }
  await page.close();
}

await run('light', { width: 1440, height: 900 }, 'light');
await run('dark', { width: 1440, height: 900 }, 'dark');
await run('phone', { width: 390, height: 844 }, 'light');
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'type chooser OK');
await browser.close();
