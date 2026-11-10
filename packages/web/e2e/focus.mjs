// Focus: F cuts the drawing down to the selection and what is around it, + and − reach further or less
// far, D turns it upstream or downstream, F on a neighbour walks on, Esc goes back; the YAML stays as it
// is and the export is what is on screen. Then data product and contract files dropped on the page
// become one data mesh map: node e2e/focus.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('cartography:doc') ?? '{}'));
const yaml = async () => (await wait(500), (await stored()).text ?? '');
const nodes = () => page.evaluate(() => [...document.querySelectorAll('.drawing [data-node]')].map((n) => n.getAttribute('data-node')).sort().join(' '));
const chip = async () => ((await page.locator('.focus-chip').count()) ? (await page.locator('.focus-chip').innerText()).replace(/\s+/g, ' ').trim() : '');
const check = (what, got, want) => got === want || fail(`${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
/** Waits until the drawing holds exactly these nodes: a focus is drawn a moment after its key. */
const drawn = async (what, want) => {
  try {
    await page.waitForFunction((want) => [...document.querySelectorAll('.drawing [data-node]')].map((n) => n.getAttribute('data-node')).sort().join(' ') === want, want, { timeout: 5000 });
  } catch {
    fail(`${what}: expected ${want}, got ${await nodes()}`);
  }
};
const select = async (id) => {
  await page.locator(`.drawing [data-node="${id}"]`).click();
  await page.locator('.preview').focus();
};
const palette = async (words) => {
  await page.keyboard.press('Meta+k');
  await page.keyboard.type(words);
  await page.keyboard.press('Enter');
};

const text = `type: systems
title: Shop
nodes:
  customer: { kind: user, label: Customer }
  web: { kind: client, label: Web shop }
  api: { kind: service, label: Orders API }
  db: { kind: database, label: Orders DB }
  bus: { kind: queue, label: Event bus }
  mail: { kind: service, label: Email worker }
  crm: { kind: external, label: CRM }
edges:
  - customer -> web
  - web -> api
  - api -> db
  - api -> bus
  - bus -> mail
  - mail -> crm
`;
const ALL = 'api bus crm customer db mail web';
// A document handed to the next load, once: set as the page starts, after the old page wrote its own on leaving.
await page.addInitScript(() => {
  const next = sessionStorage.getItem('seed');
  if (!next) return;
  sessionStorage.removeItem('seed');
  localStorage.clear();
  const { text, name } = JSON.parse(next);
  for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'visual', doc: { text, doc: { name } } })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
});
const seed = async (text, name) => {
  await page.evaluate((next) => sessionStorage.setItem('seed', next), JSON.stringify({ text, name }));
  await page.reload();
};
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await seed(text, 'focus.yaml');
await page.waitForSelector('.drawing [data-node="crm"]', { timeout: 10000 });
await wait(400);

// 1. Nothing selected: no chip, the tool waits for a selection, and F says what it needs.
{
  check('no chip without a focus', await chip(), '');
  const tool = page.locator('.canvas-tools button:has-text("Focus")');
  if (!(await tool.isVisible())) fail('no Focus button in the toolbar');
  else if (!(await tool.isDisabled())) fail('Focus should wait for a selection');
  if (!(await tool.innerText()).includes('F')) fail('the Focus button does not show its key');
  await page.locator('.preview').focus();
  await page.keyboard.press('f');
  await wait();
  if (!(await page.locator('.toast').innerText().catch(() => '')).includes('Select what to focus on')) fail('F without a selection should say to select something');
  await drawn('F without a selection draws everything', ALL);
}

// 2. F on the selection: it and its neighbours, a chip that says so, and the YAML untouched.
{
  await select('api');
  await page.keyboard.press('f');
  await drawn('one hop around the API', 'api bus db web');
  const c = await chip();
  if (!c.includes('Focused on Orders API') || !c.includes('4 of 7') || !c.includes('1 hop') || !c.includes('Both ways') || !c.includes('Esc')) fail('the chip should say what is in focus, how far and the way back: ' + c);
  if (!(await page.locator('.drawing svg').innerHTML()).includes('Focus on Orders API')) fail('the drawing should say under its title what it is cut down to');
  check('the YAML stays as it is', await yaml(), text);
  // With the inspector open the chip goes under the toolbar, and the drawing (its title too) is fitted below both.
  await wait(400);
  const box = (q) => page.locator(q).boundingBox();
  const title = await page.locator('.drawing svg > text').first().boundingBox();
  let [bar, tag] = [await box('.canvas-tools'), await box('.focus-chip')];
  if (tag.y < bar.y + bar.height && tag.x < bar.x + bar.width) fail(`the chip overlaps the toolbar: ${JSON.stringify([bar, tag])}`);
  if (title.y < tag.y + tag.height + 8) fail(`the title is crowded under the chip: chip bottom ${tag.y + tag.height}, title top ${title.y}`);
  await page.screenshot({ path: `${out}/f1-focus.png` });
  // Without the inspector there is room beside the toolbar: the chip sits there.
  await page.keyboard.press('Escape');
  await wait(400);
  [bar, tag] = [await box('.canvas-tools'), await box('.focus-chip')];
  if (Math.abs(bar.y - tag.y) > 2 || tag.x < bar.x + bar.width) fail(`the chip should sit beside the toolbar: ${JSON.stringify([bar, tag])}`);
  await page.screenshot({ path: `${out}/f1b-focus-wide.png` });
  await select('api');
}

// 3. + and − reach further and less far; 0 hops is the element alone.
{
  await page.keyboard.press('+');
  await drawn('two hops', 'api bus customer db mail web');
  if (!(await chip()).includes('2 hops')) fail('+ should say 2 hops: ' + (await chip()));
  await page.keyboard.press('-');
  await drawn('back to one hop', 'api bus db web');
  await page.keyboard.press('-');
  await drawn('no hops', 'api');
  if (!(await page.locator('.focus-chip button[aria-label="One hop fewer"]').isDisabled())) fail('fewer than no hops should not be offered');
  await page.keyboard.press('-');
  await page.locator('.focus-chip button[aria-label="One hop more"]').click();
  await page.locator('.preview').focus();
  await drawn('the + of the chip', 'api bus db web');
}

// 4. D: upstream is what feeds it, downstream what it feeds.
{
  await page.keyboard.press('d');
  await drawn('upstream', 'api web');
  if (!(await chip()).includes('Upstream')) fail('D should say Upstream: ' + (await chip()));
  await page.keyboard.press('d');
  await drawn('downstream', 'api bus db');
  if (!(await chip()).includes('Downstream')) fail('D again should say Downstream: ' + (await chip()));
  await page.keyboard.press('+');
  await drawn('downstream, two hops', 'api bus db mail');
  await page.screenshot({ path: `${out}/f2-downstream.png` });
  await page.keyboard.press('-');
  await page.keyboard.press('d');
  await drawn('both ways again', 'api bus db web');
}

// 5. F on a neighbour walks on, keeping how far it reaches; Esc deselects first, then leaves.
{
  await select('bus');
  await page.keyboard.press('f');
  await drawn('walked on to the bus', 'api bus mail');
  if (!(await chip()).includes('Focused on Event bus')) fail('the chip should follow: ' + (await chip()));
  await select('mail');
  await page.keyboard.press('Escape');
  await wait();
  if (!(await chip()).includes('Focused on Event bus')) fail('the first Esc only deselects');
  await page.keyboard.press('Escape');
  await drawn('Esc leaves the focus', ALL);
  check('no chip after Esc', await chip(), '');
}

// 5b. P keeps the focus set by keys: the presenter draws the neighbourhood and says so; A shows everything and back.
{
  const shown = () => page.evaluate(() => [...document.querySelectorAll('.present-frame:last-child [data-node]')].map((n) => n.getAttribute('data-node')).sort().join(' '));
  const presented = async (what, want) => {
    try {
      await page.waitForFunction((want) => [...document.querySelectorAll('.present-frame:last-child [data-node]')].map((n) => n.getAttribute('data-node')).sort().join(' ') === want, want, { timeout: 5000 });
    } catch {
      fail(`${what}: expected ${want}, got ${await shown()}`);
    }
  };
  await select('api');
  await page.keyboard.press('f');
  await page.keyboard.press('+');
  await drawn('two hops before presenting', 'api bus customer db mail web');
  await page.keyboard.press('p');
  await presented('the presenter keeps the focus', 'api bus customer db mail web');
  const said = (await page.locator('.present-focus').innerText().catch(() => '')).replace(/\s+/g, ' ');
  if (!said.includes('Focused on Orders API') || !said.includes('2 hops')) fail('the presenter should say what it is focused on: ' + said);
  await page.screenshot({ path: `${out}/f2b-present-focus.png` });
  await page.keyboard.press('a');
  await presented('A in the presenter shows everything', ALL);
  if (!(await page.locator('.present-focus').innerText().catch(() => '')).includes('Everything shown')) fail('the presenter should say everything is shown');
  await page.keyboard.press('a');
  await presented('A again brings the focus back', 'api bus customer db mail web');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.present', { state: 'detached', timeout: 3000 }).catch(() => fail('Esc did not leave the presenter'));
  await drawn('the editor still has the focus after presenting', 'api bus customer db mail web');
  await page.locator('.preview').focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await drawn('left the focus after presenting', ALL);
}

// 6. From the palette, with its keys shown; the export is the neighbourhood on screen.
{
  await select('db');
  await page.keyboard.press('Meta+k');
  await page.keyboard.type('focus on');
  await wait();
  const row = await page.locator('.palette [aria-selected="true"], .palette .active').first().innerText().catch(() => '');
  if (!row.includes('Focus on Orders DB') || !row.includes('F')) fail('the palette should offer Focus on Orders DB with its key: ' + row);
  await page.keyboard.press('Enter');
  await drawn('focus from the palette', 'api db');
  await page.locator('.preview').focus();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.keyboard.press('Meta+e')]);
  const file = `${out}/${download.suggestedFilename()}`;
  await download.saveAs(file);
  const svg = fs.readFileSync(file, 'utf8');
  if (!svg.includes('Focus on Orders DB') || svg.includes('Email worker')) fail('the exported SVG should be the focus on screen');
  await palette('leave the focus');
  await drawn('left from the palette', ALL);
}

// 7. A focus written in the YAML: Esc shows everything, and brings the focus back.
{
  await seed(text + 'focus: { on: mail, hops: 1 }\n', 'written.yaml');
  await page.waitForSelector('.drawing [data-node="mail"]', { timeout: 10000 });
  await drawn('the focus of the YAML', 'bus crm mail');
  if (!(await chip()).includes('Focused on Email worker')) fail('a focus in the YAML shows in the chip too: ' + (await chip()));
  await page.locator('.preview').focus();
  await page.keyboard.press('Escape');
  await drawn('Esc shows everything', ALL);
  if (!(await chip()).includes('Everything shown')) fail('the chip should offer the way back to the focus: ' + (await chip()));
  await page.screenshot({ path: `${out}/f3-everything.png` });
  await page.keyboard.press('Escape');
  await drawn('Esc again is the focus of the YAML', 'bus crm mail');
  await page.keyboard.press('+');
  await drawn('+ on a focus of the YAML', 'api bus crm mail');
  if (!(await yaml()).includes('focus: { on: mail, hops: 1 }')) fail('keys do not rewrite the focus in the YAML');
}

// 8. A drawing that is one shape has nothing to walk from: it says so and stays whole.
{
  await seed('type: sequence\ntitle: Login\nparticipants:\n  user: { kind: person, label: User }\n  app: { kind: client, label: Web app }\nsteps:\n  - user -> app: Sign in\n  - app --> user: Welcome\n', 'login.yaml');
  await page.waitForSelector('.drawing svg', { timeout: 10000 });
  await wait(400);
  const any = page.locator('.drawing [data-node]').first();
  if (await any.count()) {
    await any.click();
    await page.locator('.preview').focus();
    await page.keyboard.press('f');
    await wait(900);
    check('no focus on a sequence', await chip(), '');
    if (!(await page.locator('.toast').innerText().catch(() => '')).length) fail('a sequence should say why it has no focus');
    await page.screenshot({ path: `${out}/f4-one-shape.png` });
  }
}

// 9. Data products and contracts (ODPS, ODCS) dropped on the page: one data mesh map, its contracts read for the detailed view.
{
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/data-products/mesh');
  const files = ['products', 'contracts'].flatMap((d) => fs.readdirSync(path.join(dir, d)).map((f) => ({ name: f, text: fs.readFileSync(path.join(dir, d, f), 'utf8') })));
  const dropMesh = () => page.evaluate((files) => {
    const data = new DataTransfer();
    for (const f of files) data.items.add(new File([f.text], f.name, { type: 'text/yaml' }));
    const at = document.querySelector('.app');
    at.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }));
    at.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
  }, files);
  // The open diagram has changes that are in no file: a drop asks before it replaces them, and No keeps them.
  const unsaved = await yaml();
  let asked = '';
  page.once('dialog', (d) => ((asked = d.message()), d.dismiss()));
  await dropMesh();
  await wait(800);
  if (!asked.includes('not saved')) fail('dropping over unsaved changes should ask first: ' + (asked || 'nothing asked'));
  check('No keeps the unsaved diagram', await yaml(), unsaved);
  page.once('dialog', (d) => d.accept());
  await page.evaluate((files) => {
    const data = new DataTransfer();
    for (const f of files) data.items.add(new File([f.text], f.name, { type: 'text/yaml' }));
    const at = document.querySelector('.app');
    at.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }));
    at.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
  }, files);
  await page.waitForSelector('.drawing [data-node="customer-360"]', { timeout: 10000 }).catch(() => fail('the dropped data products were not drawn'));
  const said = await page.locator('.toast').innerText().catch(() => '');
  if (!said.includes('6 data products, 4 contracts')) fail('the drop should say what it made: ' + said);
  await wait(600);
  const doc = await stored();
  if (!/^type: data-products/m.test(doc.text ?? '')) fail('the drop should open a data-products diagram');
  check('the files stay with the document', Object.keys(doc.doc?.files ?? {}).length, 10);
  await page.screenshot({ path: `${out}/f5-mesh.png` });
  await select('revenue');
  await page.keyboard.press('f');
  await page.keyboard.press('d');
  await wait(600);
  if (!(await chip()).includes('Focused on Revenue') || !(await chip()).includes('Upstream')) fail('focus on a data product: ' + (await chip()));
  await page.screenshot({ path: `${out}/f6-mesh-lineage.png` });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // The detailed view reads the contracts that came with the drop: V shows it without touching the YAML.
  const before = await yaml();
  await page.locator('.preview').focus();
  await page.keyboard.press('v');
  await page.waitForSelector('.drawing [data-node^="contract:"]', { timeout: 10000 }).catch(() => fail('V did not show the detailed view with the dropped contracts'));
  if ((await page.locator('.view-picker select').inputValue().catch(() => '')) !== 'detailed') fail('the view picker should say Detailed');
  check('V leaves the YAML as it is', await yaml(), before);
  await page.keyboard.press('v');
  await page.waitForFunction(() => !document.querySelector('.drawing [data-node^="contract:"]'), null, { timeout: 5000 }).catch(() => fail('V again should go back to the overview'));
  // From the palette, then kept in the YAML on request.
  await palette('show the detailed view');
  await page.waitForSelector('.drawing [data-node^="contract:"]', { timeout: 10000 }).catch(() => fail('the palette did not show the detailed view'));
  check('the palette leaves the YAML as it is', await yaml(), before);
  await palette('write view: detailed');
  await wait(600);
  if (!/^view: detailed/m.test(await yaml())) fail('writing the view should put view: detailed in the YAML: ' + (await yaml()).split('\n').slice(0, 4).join(' | '));
  if (!(await page.locator('.drawing [data-node^="contract:"]').count())) fail('the drawing should stay detailed once the view is written');
  await page.keyboard.press('Meta+Backslash');
  await page.screenshot({ path: `${out}/f7-mesh-detailed.png` });
  // After a reload the contracts are still there: they are kept with the document.
  await page.reload();
  await page.waitForSelector('.drawing [data-node^="contract:"]', { timeout: 10000 }).catch(() => fail('the dropped contracts were lost in a reload'));
}

// 10. A folder with only data products and contracts: opening it draws them, and ⌘S keeps the map as data-mesh.yaml in it.
{
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/data-products/mesh');
  const files = Object.fromEntries(['products', 'contracts'].flatMap((d) => fs.readdirSync(path.join(dir, d)).map((f) => [`${d}/${f}`, fs.readFileSync(path.join(dir, d, f), 'utf8')])));
  const inFolder = () =>
    page.evaluate(async () => {
      const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('mesh');
      return (await (await d.getFileHandle('data-mesh.yaml')).getFile()).text().catch(() => '');
    });
  await page.evaluate(async (files) => {
    const opfs = await navigator.storage.getDirectory();
    for await (const [name] of opfs.entries()) await opfs.removeEntry(name, { recursive: true });
    const dir = await opfs.getDirectoryHandle('mesh', { create: true });
    for (const [p, text] of Object.entries(files)) {
      const parts = p.split('/');
      const d = await dir.getDirectoryHandle(parts[0], { create: true });
      const w = await (await d.getFileHandle(parts[1], { create: true })).createWritable();
      await w.write(text);
      await w.close();
    }
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('mesh');
    // The map of the drop is not kept: this is about the folder.
    window.confirm = () => true;
  }, files);
  await palette('open folder');
  await page.waitForSelector('.drawing [data-node="customer-360"]', { timeout: 10000 }).catch(() => fail('the data products of the folder were not drawn'));
  const said = await page.locator('.toast').innerText().catch(() => '');
  if (!said.includes('6 data products, 4 contracts in mesh')) fail('opening the folder should say what it made: ' + said);
  if (!(await page.locator('.doc-name .dirty').count())) fail('the new map is not in the folder yet: it should show as unsaved');
  await page.keyboard.press('Meta+s');
  await wait(600);
  if (await page.locator('.doc-name .dirty').count()) fail('still unsaved after ⌘S');
  const first = await inFolder().catch(() => '');
  if (!/^type: data-products/m.test(first)) fail('⌘S did not write data-mesh.yaml into the folder');
  // Again, with something added by hand (the YAML is still open from the step before): it stays.
  await page.click('.cm-content');
  await page.keyboard.press('Meta+End');
  await page.keyboard.type('\n# reviewed by the data office');
  await page.keyboard.press('Meta+s');
  await wait(600);
  await palette('data mesh map of mesh');
  await wait(800);
  const again = await yaml();
  if (!again.includes('# reviewed by the data office') || !/^type: data-products/m.test(again)) fail('making the map again should keep what was added by hand');
  if (!(await page.locator('.toast').innerText().catch(() => '')).includes('kept')) fail('making the map again should say that edits are kept');
}

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all focus steps ok');
process.exitCode = problems.length ? 1 : 0;
await browser.close();
