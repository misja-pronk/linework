// Views of a type that draws its source in several ways: a long sequence is presented as one overview and then phase by
// phase, a data mesh domain by domain. The page frame does not nag about the whole sequence, which
// is read scrolling; exporting it says the phases follow on their own slides rather than "text too
// small"; a phase of an untitled sequence says which phase it is; and a hidden view written in the
// file (view: detailed in a mesh) is what the view picker shows; the picker, palette and toast name a
// type's views in the editor's language, the drawing in the diagram's: node e2e/views.mjs <outDir>
import fs from 'node:fs';
import { chromium } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';
const out = process.argv[2] ?? '.';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
const check = (what, got, want) => got === want || fail(`${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
await page.addInitScript(() => {
  const next = sessionStorage.getItem('seed');
  if (!next) return;
  sessionStorage.removeItem('seed');
  localStorage.clear();
  const { text, name } = JSON.parse(next);
  for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'visual', doc: { text, doc: { name } } })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
});
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
const open = async (text, name) => {
  await page.evaluate((next) => sessionStorage.setItem('seed', next), JSON.stringify({ text, name }));
  await page.reload();
  await page.waitForSelector('.drawing svg', { timeout: 10000 });
  await wait(600);
};
const picked = () => page.evaluate(() => {
  const s = document.querySelector('.view-picker select');
  return s ? s.options[s.selectedIndex]?.textContent ?? '' : '';
});
const options = () => page.evaluate(() => [...document.querySelectorAll('.view-picker select option')].map((o) => o.textContent));
/** The picker's views as `name: what it says`, for the views named. */
const offered = (...names) => page.evaluate((names) => [...document.querySelectorAll('.view-picker select option')].filter((o) => names.includes(o.value)).map((o) => `${o.value}: ${o.textContent}`), names);
const toast = async () => {
  await page.waitForSelector('.toast', { timeout: 20000 });
  return (await page.locator('.toast').innerText()).replace(/\s+/g, ' ').trim();
};
async function save(label) {
  await page.click('.topbar button:has-text("Export")');
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click(`[role=menuitem]:has-text("${label}")`)]);
  const file = `${out}/${download.suggestedFilename()}`;
  await download.saveAs(file);
  return fs.readFileSync(file);
}

// A long sequence without a title, in three phases: far too long for one slide as a whole.
const steps = (n, from, to) => Array.from({ length: n }, (_, i) => `  - ${i % 2 ? `${to} --> ${from}` : `${from} -> ${to}`}: step ${i + 1} of a long story told here`).join('\n');
const sequence = `type: sequence
participants:
  a: { kind: client, label: Browser }
  b: { kind: service, label: Orders API }
  c: { kind: database, label: Orders DB }
  d: { kind: payments, label: Payments }
messages:
  - divider: Order
${steps(14, 'a', 'b')}
  - divider: Payment
${steps(14, 'b', 'd')}
  - divider: Confirmation
${steps(14, 'b', 'c')}
`;
await open(sequence, 'long.yaml');

// 1. The page frame on the whole sequence: it says how it is presented, not "under 6 pt" with everything outlined.
{
  await page.locator('.preview').focus();
  await page.keyboard.press('Shift+P');
  await page.waitForSelector('.page-frame', { timeout: 5000 });
  await wait(300);
  const label = (await page.locator('.page-label').innerText()).replace(/\s+/g, ' ');
  if (/under \d/.test(label)) fail(`page frame on the whole sequence still says text is too small: ${label}`);
  if (!/Order, Payment and Confirmation/.test(label)) fail(`page frame on the whole sequence does not say it is presented per phase: ${label}`);
  if (await page.locator('.page-overflow').count()) fail('page frame on the whole sequence outlines what lies past the readable part');
  await page.screenshot({ path: `${out}/views-whole-page.png` });
}

// 2. PowerPoint of the whole: the phases follow on their own slides, and the notice says so in plain words.
{
  const pptx = unzipSync(new Uint8Array(await save('PowerPoint')));
  const slides = Object.keys(pptx).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).length;
  check('slides in the deck of a sequence in three phases', slides, 4);
  const said = await toast();
  if (/under \d+ pt/.test(said)) fail(`the export notice still is the small-text one: ${said}`);
  if (!/slides after it show it as Order, Payment and Confirmation/.test(said) || !/Leave it out/.test(said)) fail(`the export notice does not say the phases follow: ${said}`);
  await page.screenshot({ path: `${out}/views-pptx-notice.png` });
  const slide2 = strFromU8(pptx['ppt/slides/slide2.xml']);
  if (!slide2.includes('Diagram: Order')) fail('the slide of the first phase does not say which phase it is');
  // Leave it out: the deck again, only the phases.
  const [again] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('.toast button:has-text("Leave it out")')]);
  await again.saveAs(`${out}/phases.pptx`);
  const phases = unzipSync(new Uint8Array(fs.readFileSync(`${out}/phases.pptx`)));
  check('slides after leaving the whole out', Object.keys(phases).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).length, 3);
  await wait(500);
  // The PDF: the whole, then a page per phase, and the same offer.
  const pdf = (await save('PDF')).toString('latin1');
  check('pages in the PDF of a sequence in three phases', (pdf.match(/\/Type \/Page\b/g) ?? []).length, 4);
  if (!/pages after it show it as Order, Payment and Confirmation/.test(await toast())) fail('the PDF notice does not say the phases follow');
}

// 2b. Presenting the whole: one overview slide, then each phase message by message. Every message is
// told once (42 messages, 43 slides), not the whole step by step and then every phase again.
const count = () => page.locator('.present-count').innerText().catch(() => '');
const words = () => page.locator('.present-words').innerText().catch(() => '');
{
  await page.locator('.preview').focus();
  await page.keyboard.press('p');
  await page.waitForSelector('.present .present-frame svg');
  await wait(800);
  check('presenting the whole sequence starts on its overview', await count(), '1 / 43');
  if (/step \d+ of/.test(await words())) fail(`the overview slide is told as a message: ${await words()}`);
  await page.screenshot({ path: `${out}/views-present-overview.png` });
  const told = [];
  for (let i = 2; i <= 43; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction((n) => document.querySelector('.present-count')?.textContent?.startsWith(`${n} /`), i, { timeout: 5000 }).catch(() => fail(`slide ${i} did not come`));
    await wait(120);
    told.push((await words()).replace(/\s+/g, ' ').trim());
    if (i === 2) await page.screenshot({ path: `${out}/views-present-first-message.png` });
  }
  // A caption says who sends to whom: each message once means 42 different captions.
  check('messages told after the overview', told.length, 42);
  check('different messages told', new Set(told).size, 42);
  check('the first phase is told from its first message', told[0], 'Browser → Orders API step 1 of a long story told here');
  check('the last slide is the last message', told[41], 'Orders DB → Orders API step 14 of a long story told here');
  await page.keyboard.press('ArrowRight');
  await wait(300);
  check('the deck stops at its last slide', await count(), '43 / 43');
  await page.keyboard.press('Escape');
  await wait(400);
}

// 3. A phase of an untitled sequence says which phase it is, on the canvas.
{
  await page.selectOption('.view-picker select', 'phase-payment');
  await page.waitForFunction(() => document.querySelector('.drawing svg')?.textContent?.includes('Payment'), null, { timeout: 5000 }).catch(() => fail('the phase Payment of an untitled sequence does not say which phase it is'));
  await wait(300);
  // The Title field edits the file, which has none: the phase's name is the drawing's, not the file's.
  check('title field on a phase of an untitled sequence', await page.locator('.inspector .field[data-key="title"] input').inputValue(), '');
  await page.screenshot({ path: `${out}/views-phase.png` });
  // Presenting from a phase starts at its first message, in the same deck: after the overview and Order's 14.
  await page.locator('.preview').focus();
  await page.keyboard.press('p');
  await page.waitForSelector('.present .present-frame svg');
  await wait(800);
  check('presenting from the phase Payment', await count(), '16 / 43');
  await page.screenshot({ path: `${out}/views-present-phase.png` });
  await page.keyboard.press('Escape');
  await wait(400);
}

// 4. A mesh written with its hidden whole-mesh view: the picker shows that view, not the overview.
const mesh = `type: data-products
title: Mesh
view: detailed
domains:
  sales: { label: Sales }
  customer: { label: Customer }
sources:
  shop: { kind: application, label: Webshop, domain: sales }
products:
  orders:
    domain: sales
    inputs: [shop]
    outputs: { orders: { kind: table } }
  customers:
    domain: customer
    inputs: [orders.orders]
    outputs: { profile: { kind: table } }
`;
await open(mesh, 'mesh.yaml');
{
  const now = await page.locator('.view-picker select').inputValue();
  if (now !== 'detailed') fail(`the view picker shows ${JSON.stringify(now)} for a mesh drawn as view: detailed`);
  const list = await options();
  if ((await offered('detailed')).length !== 1) fail(`the hidden view should be listed once while drawn: ${JSON.stringify(list)}`);
  // A view's name is not said next to its title: no two views here share one.
  if (list.some((o) => /\(\w+\)$/.test(o))) fail(`the picker says a view's name in brackets: ${JSON.stringify(list)}`);
  await page.screenshot({ path: `${out}/views-hidden.png` });
  // Another view picked: the hidden one is no longer offered, and the picker follows.
  await page.selectOption('.view-picker select', 'overview');
  await wait(600);
  check('picker after picking the overview', /overview/i.test(await picked()), true);
}

// 5. The same mesh in Dutch (lang: nl) in an English editor: the picker, the palette and the toast name
// the type's views in the editor's language; the drawing keeps the diagram's. A Dutch editor names them in Dutch.
await open(`lang: nl\n${mesh}`, 'mesh-nl.yaml');
{
  const list = await options();
  check('picker of a Dutch mesh in an English editor', JSON.stringify(await offered('overview', 'detailed')), JSON.stringify(['overview: Overview', 'detailed: Every product in detail']));
  if (list.some((o) => /Overzicht|Alle producten/.test(o))) fail(`the picker speaks the diagram's language: ${JSON.stringify(list)}`);
  await page.selectOption('.view-picker select', 'overview');
  await wait(600);
  const drawn = await page.locator('.drawing svg').first().innerHTML();
  if (!drawn.includes('Overzicht')) fail('the drawing of the overview should keep its Dutch title as subtitle');
  // V goes round the views: the toast names them as the picker does.
  await page.locator('.preview').focus();
  const said = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('v');
    said.push(await toast());
    await wait(500);
  }
  if (!said.some((s) => s.includes('Overview')) || said.some((s) => /Overzicht|Alle producten/.test(s))) fail(`the next-view toast should name the views in English: ${JSON.stringify(said)}`);
  await page.selectOption('.view-picker select', 'detailed-sales');
  await wait(600);
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+k');
  await page.keyboard.type('overview');
  await wait(300);
  const found = await page.locator('.palette').innerText();
  if (!found.includes('Show the Overview view')) fail(`the palette should offer the view by its English title: ${found.slice(0, 200)}`);
  await page.keyboard.press('Escape');
  // The editor in Dutch (seeding clears the choice, so it is made after): the same views in Dutch.
  const inDutch = async (text, name) => {
    await open(text, name);
    await page.evaluate(() => localStorage.setItem('cartography:lang', JSON.stringify('nl')));
    await page.reload();
    await page.waitForSelector('.drawing svg', { timeout: 10000 });
    await wait(600);
  };
  await inDutch(`lang: nl\n${mesh}`, 'mesh-nl.yaml');
  check('picker of a Dutch mesh in a Dutch editor', JSON.stringify(await offered('overview', 'detailed')), JSON.stringify(['overview: Overzicht', 'detailed: Alle producten in detail']));
  // An English mesh in the Dutch editor: Dutch names in the picker, the drawing in English.
  await inDutch(mesh, 'mesh.yaml');
  check('picker of an English mesh in a Dutch editor', (await offered('overview'))[0], 'overview: Overzicht');
  await page.selectOption('.view-picker select', 'overview');
  await wait(600);
  if (!(await page.locator('.drawing svg').first().innerHTML()).includes('Overview')) fail('the English drawing should keep its English subtitle in a Dutch editor');
  await page.evaluate(() => localStorage.removeItem('cartography:lang'));
}

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all views steps ok');
await browser.close();
process.exit(problems.length ? 1 : 0);
