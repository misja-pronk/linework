// The Wizard mode of the start dialog: type → template → "Answer questions" → one question at a time with
// the drawing redrawn as you answer, by keyboard and by clicking; Finish opens the diagram; "Refine it with your AI
// it" starts the AI mode from the wizard's drawing (the API is mocked). node e2e/wizard.mjs <outDir>
import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('dialog', (d) => d.accept());
const fail = (m) => problems.push(m);
const wait = (ms = 300) => page.waitForTimeout(ms);
const question = () => page.locator('.wizard-question h3').innerText();
const preview = () => page.locator('.wizard-preview .mode-preview').innerText();
/** Waits until the preview shows a text (it is redrawn shortly after each answer). */
const shows = async (text, what) => {
  for (let i = 0; i < 40; i++) {
    if ((await preview()).includes(text)) return true;
    await wait(100);
  }
  fail(`${what}: the preview does not show "${text}"`);
  return false;
};

await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.start .type-card');

// 1. A type with wizards offers "Answer questions" as a fourth way to work; key 4 opens it.
await page.locator('.type-main', { hasText: 'Azure infrastructure' }).click();
await page.locator('.template-card', { hasText: 'Template' }).first().click();
await page.waitForSelector('.mode-card');
if (!(await page.locator('.mode-card.mode-wizard').isVisible())) fail('no wizard mode for Azure');
await page.screenshot({ path: `${out}/1-mode.png` });
await page.keyboard.press('4');
await page.waitForSelector('.wizard');

// 2. Azure has three wizards: the first question is which one; arrows choose and the preview follows.
if ((await question()) !== 'Which one?') fail(`first question: ${await question()}`);
await shows('Azure landing zone', 'landing zone chosen');
await page.keyboard.press('ArrowDown');
await shows('AKS', 'arrow down picks the AKS baseline');
await page.keyboard.press('ArrowUp');
await shows('Azure landing zone', 'arrow up goes back');
await wait(500);
await page.screenshot({ path: `${out}/2-which.png` });
await page.keyboard.press('Enter');

// 3. A text question: type, Enter goes on, the title follows.
if (!(await question()).includes('organisation')) fail(`second question: ${await question()}`);
await page.keyboard.press('ControlOrMeta+a');
await page.keyboard.type('Fabrikam');
await shows('Fabrikam', 'organisation name');
await page.keyboard.press('Enter');

// 4. A choice by number key: 2 = Virtual WAN.
if (!(await question()).includes('topology')) fail(`third question: ${await question()}`);
await page.keyboard.press('2');
await shows('Virtual WAN', 'number key picks Virtual WAN');
await wait(500);
await page.screenshot({ path: `${out}/3-choice.png` });
await page.keyboard.press('Enter');

// 5. Yes/no by N; Esc goes back one question (not out of the dialog), Enter forward again.
if (!(await question()).includes('Firewall')) fail(`fourth question: ${await question()}`);
await page.keyboard.press('n');
for (let i = 0; i < 40 && (await preview()).includes('afw-'); i++) await wait(100);
if ((await preview()).includes('afw-')) fail('no firewall still draws one');
await page.keyboard.press('Escape');
if (!(await question()).includes('topology')) fail(`Esc did not go back: ${await question()}`);
if (!(await page.locator('.wizard').isVisible())) fail('Esc left the wizard');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');

// 6. Trackpad: click an option and Next; the progress dots jump to a question.
await page.locator('.wizard-option', { hasText: 'Not connected' }).click();
await page.locator('.wizard-nav .button.primary').click();
if (!(await question()).includes('Where')) fail(`after clicking Next: ${await question()}`);
await page.locator('.wizard-progress .dot').nth(6).click();
if (!(await question()).includes('regions')) fail(`dot did not jump: ${await question()}`);
await page.locator('.wizard-number button[aria-label="More"]').click();
await shows('2 regions', 'more regions');
await page.keyboard.press('ArrowRight');
await shows('3 regions', 'arrow right adds a region');
await wait(600);
await page.screenshot({ path: `${out}/4-number.png` });

// One way to finish (the primary button, or ⌘↵), with how it opens as a choice; the preview reads at full size on a click.
const finishes = await page.locator('.wizard .button.primary').count();
if (finishes !== 1) fail(`${finishes} finish buttons in the wizard`);
const fitted = await page.locator('.wizard-preview .mode-preview > div > svg').boundingBox();
await page.locator('.wizard-preview .mode-preview').click();
await wait(200);
const full = await page.locator('.wizard-preview .mode-preview > div > svg').boundingBox();
if (!(full.width > fitted.width * 1.3)) fail(`the preview did not open at full size: ${Math.round(fitted.width)} → ${Math.round(full.width)}`);
await page.screenshot({ path: `${out}/4b-preview-full.png` });
await page.locator('.wizard-preview .mode-preview').click();

// 7. Refine it with your AI: the AI mode with the wizard's drawing in the prompt to copy.
await page.locator('button', { hasText: 'Refine it with your AI' }).click();
await page.waitForSelector('.ask-form');
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
await page.locator('.ask-run .button', { hasText: 'Copy the prompt' }).click();
await page.waitForSelector('.paste');
const sent = await page.evaluate(() => navigator.clipboard.readText());
if (!sent.includes('Start from this draft') || !sent.includes('Fabrikam')) fail('the prompt does not start from the wizard drawing');
// Esc from there goes back to the wizard, answers kept.
await page.getByRole('button', { name: /Change answers/ }).click();
await page.keyboard.press('Escape');
await page.waitForSelector('.wizard');
await shows('Fabrikam', 'answers kept after the AI mode');

// 8. "Finish with defaults" beside Next (⌘↵ does the same): the diagram opens in the builder. Review 3:
// only the hint said it could finish early; a trackpad needs a button.
const early = page.locator('.wizard button.wizard-early', { hasText: 'Finish with defaults' });
if (!(await early.isVisible())) fail('no visible "Finish with defaults" under Next');
await early.click();
await page.waitForSelector('.start', { state: 'detached' });
await page.waitForSelector('.drawing svg');
await wait(1200);
const drawn = await page.locator('.drawing').evaluate((e) => e.textContent);
if (!drawn.includes('Fabrikam') || !drawn.toLowerCase().includes('vhub')) fail('the opened diagram is not the wizard drawing');
await page.screenshot({ path: `${out}/5-opened.png` });

// 9. Another type: C4 has one wizard, so the first question is its own; Finish via the last question's Enter.
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.start .type-card');
await page.locator('.type-main', { hasText: 'C4' }).first().click();
await page.locator('.template-card').first().click();
await page.waitForSelector('.mode-card.mode-wizard');
await page.locator('.mode-card.mode-wizard').click();
await page.waitForSelector('.wizard');
if ((await question()) === 'Which one?') fail('C4 asks which wizard');
await shows('Online shop', 'C4 default system');
for (let i = 0; i < 10 && (await page.locator('.wizard').count()); i++) {
  if (i === 4) {
    // The multi-choice: 6 toggles the worker on, Space on the focused one too.
    await page.keyboard.press('6');
    if (!(await page.locator('.wizard-option[aria-checked="true"]', { hasText: 'Worker' }).count())) fail('number key did not toggle a container');
    await wait(400);
    await page.screenshot({ path: `${out}/6-multi.png` });
  }
  await page.keyboard.press('Enter');
  await wait(150);
}
await page.waitForSelector('.start', { state: 'detached' });
await page.waitForSelector('.drawing svg');
await wait(800);
await page.screenshot({ path: `${out}/7-c4.png` });

await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('wizard: ok');
