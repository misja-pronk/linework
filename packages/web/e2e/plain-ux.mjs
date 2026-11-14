// What a reviewer ran into driving the editor at 1280×720: typing right after an inspector edit, ⌘K
// finding what is typed, a word after every download, Undo and Redo greyed out when there is nothing
// to undo, a gentle ⌃-wheel, a toolbar that stays put when the view changes, the theme switch in the
// status bar, plain words, the keyboard going round the regions, and no console warnings.
// node e2e/plain-ux.mjs <outDir>
import { chromium } from '@playwright/test';
const out = process.argv[2];
const url = process.env.LINEWORK_URL ?? 'http://localhost:5178/';
const problems = [];
const fail = (m) => problems.push(m);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
const warnings = [];
page.on('pageerror', (e) => fail(e.message));
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && warnings.push(m.text()));
const wait = (ms = 300) => page.waitForTimeout(ms);
const box = (id) => page.locator(`.drawing [data-node="${id}"]`).first().boundingBox();
const open = async (title) => {
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.start .scenario');
  await page.locator('.scenario-main', { has: page.locator('.scenario-title', { hasText: new RegExp(`^${title}$`) }) }).click();
  // The diagram edited before is kept between visits: opening another one asks first.
  await page.locator('.confirm-dialog button:has-text("Discard")').click({ timeout: 1500 }).catch(() => {});
  await page.waitForSelector('.drawing svg [data-node]');
  await wait(900);
};
const palette = async (query) => {
  await page.locator('.preview').focus();
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type(query);
  await wait(200);
  return page.locator('.palette-item .palette-label').allInnerTexts();
};

try {
  await open('Data products');
  // 1. An inspector edit, then a double-click on the card and typing: the name editor opens at once
  //    and takes the letters; none of them is a shortcut (S a step, A the add menu).
  {
    const steps = await page.locator('.step-chip').count();
    let b = await box('crm');
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await wait(400);
    await page.locator('aside[aria-label="Properties"] input').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' system');
    await wait(300);
    b = await box('crm');
    await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);
    await page.keyboard.type('Sa');
    await wait(700);
    if (!(await page.locator('.label-editor').count())) fail('a double-click after an inspector edit did not open the name editor');
    else if ((await page.locator('.label-editor').inputValue()) !== 'Sa') fail(`the name editor holds "${await page.locator('.label-editor').inputValue()}", not what was typed`);
    if (await page.locator('.add-menu').count()) fail('typing after the double-click opened the add menu');
    if ((await page.locator('.step-chip').count()) !== steps) fail('typing after the double-click added a step');
    await page.screenshot({ path: `${out}/ux-dblclick-typed.png` });
    await page.keyboard.press('Escape');
  }

  // 2. ⌘K: "pdf" finds Export PDF first; Next step says ], Previous step [.
  {
    const found = await palette('pdf');
    if (!/pdf/i.test(found[0] ?? '')) fail(`⌘K "pdf" lists "${found[0]}" first`);
    await page.keyboard.press('Escape');
    await palette('next step');
    const keyOf = async (label) => page.locator('.palette-item', { has: page.locator('.palette-label', { hasText: new RegExp(`^${label}$`) }) }).locator('kbd').innerText().catch(() => '');
    if ((await keyOf('Next step')) !== ']') fail(`⌘K shows "${await keyOf('Next step')}" for Next step`);
    await page.keyboard.press('Escape');
    await palette('previous step');
    if ((await keyOf('Previous step')) !== '[') fail(`⌘K shows "${await keyOf('Previous step')}" for Previous step`);
    await page.keyboard.press('Escape');
    // A step's row keeps its name whole: the caption after it gives way.
    await palette('served');
    const cut = await page.locator('.palette-item .palette-label').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
    if (cut.length) fail(`⌘K cuts the names ${cut.join(', ')}`);
    await page.screenshot({ path: `${out}/ux-palette-steps.png` });
    await page.keyboard.press('Escape');
  }
  // 3. Export: a word after each download, the page's two pictures named alike, a short menu of
  //    actions only; saving and the YAML are under ⋯.
  await open('Azure network');
  {
    const exportMenu = () => page.locator('.topbar button:has-text("Export")').click();
    await exportMenu();
    await page.waitForSelector('.topbar .menu [role="menuitem"]');
    const items = await page.locator('.topbar .menu [role^="menuitem"]').count();
    if (items > 13 || items < 8) fail(`the Export menu has ${items} items`);
    if (await page.locator('.topbar .menu [role="menuitemcheckbox"]').count()) fail('the Export menu has a checkbox among its actions');
    await page.screenshot({ path: `${out}/ux-export-menu.png` });
    const names = [];
    for (const label of ['PNG', 'The slide as PNG', 'The slide as SVG']) {
      if (label !== 'PNG') await exportMenu();
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.locator('.topbar .menu [role="menuitem"]', { hasText: new RegExp(`^\\s*${label}`) }).first().click()]);
      names.push(dl.suggestedFilename());
      await wait(300);
      const said = await page.locator('.toast').innerText().catch(() => '');
      if (!said.includes(dl.suggestedFilename())) fail(`no word after downloading ${label}: "${said}"`);
    }
    if (names[1].replace('.png', '') !== names[2].replace('.svg', '')) fail(`the slide's pictures are named ${names[1]} and ${names[2]}`);
    await page.click('button[aria-label="More actions"]');
    for (const label of ['Save', 'Download YAML'])
      if (!(await page.locator('.topbar .menu [role="menuitem"]', { hasText: label }).count())) fail(`⋯ has no ${label}`);
    const [yaml] = await Promise.all([page.waitForEvent('download'), page.locator('.topbar .menu [role="menuitem"]', { hasText: 'Download YAML' }).click()]);
    await wait(300);
    if (!(await page.locator('.toast').innerText().catch(() => '')).includes(yaml.suggestedFilename())) fail('no word after downloading the YAML');
  }

  // 4. Undo and Redo greyed out with nothing to undo or redo; the theme in the status bar switches it;
  //    a mouse wheel notch with ⌃ zooms gently; a drag over empty canvas says how to move the view.
  await open('Azure network');
  {
    const undoOff = () => page.locator('.canvas-tools button[aria-label="Undo"]').isDisabled();
    const redoOff = () => page.locator('.canvas-tools button[aria-label="Redo"]').isDisabled();
    if (!(await undoOff()) || !(await redoOff())) fail('Undo or Redo is not greyed out on a diagram just opened');
    const b = await box('edge-router');
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.keyboard.press('ArrowRight');
    await wait(400);
    if (await undoOff()) fail('Undo is greyed out after a nudge');
    await page.keyboard.press('ControlOrMeta+z');
    await wait(400);
    if (!(await undoOff()) || (await redoOff())) fail('after ⌘Z Undo should be greyed out and Redo not');
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
    const was = await theme();
    await page.locator('.statusbar .status-theme').click();
    if ((await theme()) === was) fail('the theme in the status bar does not switch it');
    await page.locator('.statusbar .status-theme').click();
    const zoom = async () => Number((await page.locator('.zoom-level').innerText()).replace('%', ''));
    const z = await zoom();
    await page.mouse.move(500, 350);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await wait(300);
    if ((await zoom()) / z > 1.3) fail(`one ⌃-wheel notch zoomed from ${z}% to ${await zoom()}%`);
    await page.locator('button[aria-label="Fit to screen"]').click();
    await wait(300);
    const pane = await page.locator('.preview').boundingBox();
    await page.mouse.move(pane.x + 12, pane.y + pane.height - 80);
    await page.mouse.down();
    await page.mouse.move(pane.x + 40, pane.y + pane.height - 60, { steps: 4 });
    await page.mouse.up();
    await wait(300);
    if (!/Space/.test(await page.locator('.toast').innerText().catch(() => ''))) fail('a drag over empty canvas does not say how to move the view');
  }

  // 5. Views and layers: the toolbar stays put when the view changes; a layer drawn alone is fitted;
  //    a new group's name is typed in a field the size of a name.
  await open('Entra access');
  {
    const toolsTop = () => page.locator('.canvas-tools').evaluate((e) => Math.round(e.getBoundingClientRect().top));
    const tops = [await toolsTop()];
    const views = await page.locator('.view-picker option').count();
    for (let i = 1; i < views; i++) {
      await page.locator('.preview').focus();
      await page.keyboard.press('v');
      await wait(700);
      tops.push(await toolsTop());
    }
    if (new Set(tops).size > 1) fail(`the toolbar moves as the view changes: ${tops.join(', ')}`);
  }
  await open('Azure network');
  {
    const outOfPane = () =>
      page.evaluate(() => {
        const p = document.querySelector('.preview').getBoundingClientRect();
        const s = document.querySelector('.drawing svg').getBoundingClientRect();
        return Math.round(Math.max(0, p.left - s.left, p.top - s.top, s.right - p.right, s.bottom - p.bottom));
      });
    await page.locator('.preview').focus();
    await page.keyboard.press('l');
    await wait(300);
    const first = page.locator('.layers-panel [role="menuitemcheckbox"]').first();
    if (await first.count()) {
      await first.click();
      await page.locator('[role="menuitemradio"]', { hasText: 'Only' }).click();
      await wait(1200);
      if (await outOfPane()) fail(`a layer drawn alone runs ${await outOfPane()} px out of view`);
      const chip = await page.locator('.layers-chip').innerText().catch(() => '');
      if (/\d+ of \d+(?! shown)/.test(chip)) fail(`the layers chip says "${chip}"`);
      await page.screenshot({ path: `${out}/ux-layer-only.png` });
      await page.keyboard.press('Escape');
      await page.locator('.layers-chip button[aria-label="The whole drawing"]').click().catch(() => {});
      await wait(800);
    } else fail('no layer to switch on in Azure network');
    const a = await box('vmss-erp-prod');
    const b = await box('vmss-intranet-prod');
    await page.mouse.click(a.x + 10, a.y + 10);
    await page.keyboard.down('Shift');
    await page.mouse.click(b.x + 10, b.y + 10);
    await page.keyboard.up('Shift');
    await page.keyboard.press('ControlOrMeta+g');
    await wait(1200);
    const field = await page.locator('.label-editor').boundingBox();
    if (!field) fail('⌘G did not open the new group\'s name');
    else if (field.width > 300) fail(`the new group's name field is ${Math.round(field.width)} px wide`);
    await page.screenshot({ path: `${out}/ux-group-name.png` });
    await page.keyboard.press('Escape');
  }
  // 6. The keyboard: F6 goes round every region, End in a menu goes to its last item, an element
  //    picked in ⌘K leaves the keyboard on the drawing, ↓ in the outline goes on from the row that has
  //    the keyboard, ⌘A on a status bar button selects no page text.
  await open('Azure network');
  {
    const where = () =>
      page.evaluate(() => {
        const a = document.activeElement;
        return ['.topbar', '.left-rail', '.shapes', '.canvas-tools', '.steps-strip', '.side', '.statusbar', '.preview'].find((q) => a?.closest(q)) ?? a?.tagName;
      });
    await page.locator('.preview').focus();
    const seen = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('F6');
      seen.push(await where());
    }
    for (const region of ['.canvas-tools', '.steps-strip', '.side', '.statusbar', '.topbar', '.left-rail', '.preview'])
      if (!seen.includes(region)) fail(`F6 never reaches ${region}: ${seen.join(' → ')}`);
    await page.locator('.topbar button:has-text("Export")').click();
    await page.waitForSelector('.topbar .menu [role="menuitem"]');
    await page.keyboard.press('End');
    const last = await page.evaluate(() => document.activeElement?.textContent?.trim());
    if (!/Describe/.test(last ?? '')) fail(`End in the Export menu went to "${last}"`);
    await page.keyboard.press('Escape');
    await page.locator('.topbar button[aria-label="Commands"]').click();
    await page.keyboard.type('edge router');
    await page.keyboard.press('Enter');
    await wait(300);
    if ((await where()) !== '.preview') fail(`after ⌘K → an element → Enter the keyboard is on ${await where()}`);
    await page.locator('.left-rail button[aria-label="Show the outline"]').click();
    await wait(300);
    const rows = page.locator('.outline [role="treeitem"]');
    await rows.nth(0).click();
    await rows.nth(3).focus();
    await page.keyboard.press('ArrowDown');
    const key4 = await rows.nth(4).getAttribute('data-key');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-key'));
    if (focused !== key4) fail(`↓ from the fourth row went to ${focused}, not the fifth (${key4})`);
    await page.locator('.statusbar button').first().focus();
    await page.keyboard.press('ControlOrMeta+a');
    const picked = await page.evaluate(() => window.getSelection()?.toString().length ?? 0);
    if (picked) fail(`⌘A on a status bar button selected ${picked} characters of the page`);
  }
  // 7. Plain words: the add menu's shapes are "Shapes", the properties say what a card is (its id on
  //    hover), the page frame names the page and its smallest text, a sequence's steps are its messages.
  {
    const b = await box('edge-router');
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await wait(300);
    const sub = await page.locator('.inspector-title span').innerText();
    if (/·/.test(sub) || sub !== sub.charAt(0).toUpperCase() + sub.slice(1)) fail(`the properties call the card "${sub}"`);
    await page.locator('.preview').focus();
    await page.keyboard.press('a');
    await wait(300);
    const heads = await page.locator('.add-menu .palette-group').allInnerTexts();
    if (heads.some((h) => /^nodes$/i.test(h.trim()))) fail(`the add menu has a heading "${heads.find((h) => /nodes/i.test(h))}"`);
    await page.keyboard.press('Escape');
    await page.locator('.preview').focus();
    await page.keyboard.press('Shift+P');
    await wait(1200);
    const frame = await page.locator('.page-label').innerText().catch(() => '');
    if (!/smallest text/i.test(frame) || /^page:/i.test(frame)) fail(`the page frame says "${frame}"`);
    await page.keyboard.press('Shift+P');
  }
  await open('Sequence');
  {
    const chip = await page.locator('.step-chip[data-step="1"]').innerText();
    if (/→/.test(chip)) fail(`a sequence's first step is called "${chip}"`);
    await page.locator('.left-rail button[aria-label="Show the outline"]').click();
    await wait(300);
    const rows = await page.locator('.outline [role="treeitem"]').allInnerTexts();
    if (rows.some((r) => /^(sequence|matrix)$/.test(r.trim()))) fail(`the outline lists "${rows.join(', ')}"`);
  }
  // 8. Present, Esc, P at once: presenting again, and no warning about full screen in the console.
  {
    await page.locator('.preview').focus();
    await page.keyboard.press('p');
    await wait(900);
    await page.keyboard.press('Escape');
    await wait(50);
    await page.keyboard.press('p');
    await wait(900);
    if (!(await page.locator('.present').count())) fail('P right after Esc from presenting did not present again');
    await page.keyboard.press('Escape');
  }
} catch (e) {
  fail(String(e?.stack ?? e));
}
await browser.close();
const noisy = warnings.filter((w) => !/Download the React DevTools|\[vite\]/.test(w));
if (noisy.length) fail(`console: ${[...new Set(noisy)].join(' | ').slice(0, 600)}`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('plain ux: ok');
