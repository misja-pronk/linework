// The editor on a projector (1280×720), as a consultant demos it: the start screen whole, the drawing's
// tools side by side with the YAML open, the menus within the window, the view picker saying the view
// as V does, the palette's headings once each, a message moving clear of a chip that comes after it,
// the drawing's title kept while the YAML has a mistake, and a blank sequence saying how to start.
// node e2e/projector.mjs <outDir>
import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
const url = process.env.CARTO_URL ?? 'http://localhost:5178/';
/** A first visit, and the start card at that place opened (none: the start screen stays). */
const cold = async (card) => {
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.start .scenario');
  await wait(800);
  if (card === undefined) return;
  await page.locator('.scenario-main').nth(card).click();
  await page.waitForSelector('.drawing [data-node]');
  await wait(700);
};

// 1. The start screen at 720: every card, the blank sheet and the search without scrolling.
await cold();
{
  const cut = await page.locator('.scenario, .home-foot .blank-sheet, .home-foot .search-field').evaluateAll((els) => {
    const bottom = document.querySelector('.home').getBoundingClientRect().bottom;
    return els.filter((e) => e.getBoundingClientRect().bottom > bottom + 1).length;
  });
  if (cut) fail(`${cut} of the cards, the blank sheet and the search are out of view at 1280×720`);
  await page.screenshot({ path: `${out}/projector-start.png` });
}

// 2. Entra access (it has views) with the YAML open: the picker gives up room, no tool slides under another.
await cold(2);
await page.locator('.preview').focus();
await page.keyboard.press('Meta+Backslash');
await wait(500);
{
  const under = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.canvas-tools > :not(.tool-sep)')].map((e) => [e.className, e.getBoundingClientRect()]);
    return items.flatMap((x, i) => (i && x[1].left < items[i - 1][1].right - 1 ? [`${items[i - 1][0]} / ${x[0]}`] : []));
  });
  if (under.length) fail(`tools overlap with the YAML open: ${under.join(', ')}`);
  await page.screenshot({ path: `${out}/projector-tools.png` });
}

// 3. A mistake in the YAML: the properties keep the title of the drawing on screen, not empty fields.
{
  await page.locator('.cm-content').click();
  await page.keyboard.press('Meta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('edges: [ oops');
  await wait(1200);
  const title = await page.locator('.inspector [data-key="title"] input').inputValue();
  if (title !== 'Northwind finance access packages') fail(`the title field reads "${title}" while the YAML has a mistake`);
  for (let i = 0; i < 14; i++) await page.keyboard.press('Backspace');
  await wait(800);
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+Backslash');
  await wait(500);
}

// 4. A view picked in the picker is said as V says it: no message left naming another view.
{
  await page.locator('.preview').focus();
  await page.keyboard.press('v');
  await wait();
  await page.locator('.view-picker select').selectOption({ index: 0 });
  await wait();
  const picked = await page.locator('.view-picker select option:checked').innerText();
  const toast = await page.locator('.toast').innerText().catch(() => '');
  if (!toast.startsWith('View: ') || !picked.startsWith(toast.slice(6))) fail(`after picking "${picked}" the message says "${toast}"`);
}

// 5. The theme menu at 720 stays in the window and scrolls to the language.
{
  await page.click('button[aria-label="More actions"]');
  await page.click('[data-brand]');
  await wait(200);
  const bottom = await page.locator('.topbar .menu').last().evaluate((m) => m.getBoundingClientRect().bottom);
  if (bottom > 720) fail(`the theme menu runs to ${Math.round(bottom)} px, past the window`);
  await page.locator('[data-ui-lang="en"]').scrollIntoViewIfNeeded();
  if (!(await page.locator('[data-ui-lang="en"]').isVisible())) fail('the language cannot be reached in the theme menu');
  await page.keyboard.press('Escape');
}

// 6. ⌘K before typing: each heading once.
{
  await page.keyboard.press('Meta+k');
  await wait(200);
  const heads = await page.locator('.palette-group').allInnerTexts();
  if (new Set(heads).size !== heads.length) fail(`a palette heading comes twice: ${heads.join(', ')}`);
  await page.keyboard.press('Escape');
}

// 7. The "Opened" message moves under the layers chip that comes after it.
await cold(0);
{
  await page.locator('.preview').focus();
  await page.keyboard.press('l');
  await page.keyboard.press('1');
  await page.keyboard.press('Escape');
  await wait();
  const toast = await page.locator('.toast').boundingBox();
  const chip = await page.locator('.layers-chip').boundingBox();
  if (!toast || !chip) fail('no message or no layers chip');
  else if (toast.y < chip.y + chip.height) fail('the message lies over the layers chip');
  await page.screenshot({ path: `${out}/projector-toast.png` });
}

// 8. A blank sequence says how to start, as a blank of any other type does.
{
  await page.click('button[aria-label="More actions"]');
  await page.getByRole('menuitem', { name: 'New diagram' }).click();
  await page.locator('.confirm-dialog button:has-text("Discard")').click({ timeout: 2000 }).catch(() => {});
  await page.locator('.home-foot .import-chip').click();
  await page.locator('.type-card[data-type="sequence"] .type-main').click();
  await wait(400);
  await page.locator('.blank-sheet').first().click();
  await wait(900);
  if (!(await page.locator('.canvas-empty').isVisible())) fail('a blank sequence shows no way to start');
  await page.screenshot({ path: `${out}/projector-sequence.png` });
}

console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'projector OK');
await browser.close();
