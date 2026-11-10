// Access and GitHub exports in the browser: az / Graph JSON dropped on the page becomes one access
// diagram (focus on a group works on it), one combined gh api JSON a GitHub diagram, and a folder of gh
// api responses opened as a folder offers "GitHub organisation of …" in the command palette, which
// writes github.yaml there: node e2e/access-import.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const out = process.argv[2];
if (!out) throw new Error('Name the output folder: node e2e/access-import.mjs <outDir>');
const examples = path.resolve(import.meta.dirname, '../../../examples');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('cartography:doc') ?? '{}'));
const toast = () => page.locator('.toast').innerText().catch(() => '');
const chip = async () => ((await page.locator('.focus-chip').count()) ? (await page.locator('.focus-chip').innerText()).replace(/\s+/g, ' ').trim() : '');
const drop = (files) =>
  page.evaluate((files) => {
    const data = new DataTransfer();
    for (const f of files) data.items.add(new File([f.text], f.name, { type: 'application/json' }));
    const at = document.querySelector('.app');
    at.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }));
    at.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
  }, files);

await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.evaluate(async () => {
  localStorage.clear();
  localStorage.setItem('cartography:started', 'true');
  const opfs = await navigator.storage.getDirectory();
  for await (const [name] of opfs.entries()) await opfs.removeEntry(name, { recursive: true });
});
await page.reload();
await page.waitForSelector('.drawing svg');

// 1. az role assignments and Graph JSON, dropped: one access diagram, and the drop says what it holds.
{
  const dir = path.join(examples, 'access/import/kestrel');
  await drop(fs.readdirSync(dir).map((f) => ({ name: f, text: fs.readFileSync(path.join(dir, f), 'utf8') })));
  await page.waitForSelector('.drawing [data-node="sg-developers"]', { timeout: 15000 }).catch(() => fail('the dropped access exports were not drawn'));
  const said = await toast();
  if (!said.includes('16 identities, 12 role assignments on 9 scopes, 3 access packages')) fail('the drop should say what it made: ' + said);
  await wait(600);
  if (!/^type: access/m.test((await stored()).text ?? '')) fail('the drop should open an access diagram');
  await page.screenshot({ path: `${out}/access-1-dropped.png` });

  // 2. What can this group reach: focus on it, downstream.
  await page.locator('.drawing [data-node="sg-developers"]').click();
  await page.locator('.preview').focus();
  await page.keyboard.press('f');
  // D turns it upstream (who reaches it), and again downstream (what it reaches).
  await page.keyboard.press('d');
  await page.keyboard.press('d');
  await wait(900);
  if (!(await chip()).includes('sg-developers') || !(await chip()).includes('Downstream')) fail('focus on a group, downstream: ' + (await chip()));
  const kept = await page.evaluate(() => [...document.querySelectorAll('.drawing [data-node]')].map((n) => n.getAttribute('data-node')));
  if (!kept.includes('kestrel-test') || kept.includes('github-deploy-shop')) fail('the focus should keep what sg-developers reaches and nothing else: ' + kept.join(' '));
  await page.screenshot({ path: `${out}/access-2-focus.png` });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

// 3. One combined gh api JSON, dropped: the organisation as a GitHub diagram.
{
  await drop([{ name: 'kestrel-combined.json', text: fs.readFileSync(path.join(examples, 'github/import/kestrel-combined.json'), 'utf8') }]);
  await page.waitForSelector('.drawing [data-node="platform"]', { timeout: 15000 }).catch(() => fail('the dropped GitHub JSON was not drawn'));
  const said = await toast();
  if (!said.includes('5 teams, 7 repositories')) fail('the GitHub drop should say what it made: ' + said);
  await wait(600);
  if (!/^type: github/m.test((await stored()).text ?? '')) fail('the drop should open a GitHub diagram');
  await page.screenshot({ path: `${out}/access-3-github.png` });
}

// 4. A folder of gh api responses (teams/<team>/…, repos/<repo>/…): the command palette makes github.yaml in it.
{
  const dir = path.join(examples, 'github/import/kestrel');
  const files = Object.fromEntries(walk(dir).map((f) => [path.relative(dir, f).split(path.sep).join('/'), fs.readFileSync(f, 'utf8')]));
  await page.evaluate(async (files) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('kestrel-gh', { create: true });
    for (const [p, text] of Object.entries(files)) {
      const parts = p.split('/');
      let d = root;
      for (const seg of parts.slice(0, -1)) d = await d.getDirectoryHandle(seg, { create: true });
      const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
      await w.write(text);
      await w.close();
    }
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('kestrel-gh');
    // The diagram of the drop before is not kept: this is about the folder.
    window.confirm = () => true;
  }, files);
  await page.click('button:has-text("Open folder")');
  // No diagram in the folder yet: its exports are drawn straight away.
  await page.waitForSelector('.drawing [data-node="shop-production"]', { timeout: 15000 }).catch(() => fail('the folder of gh api responses was not drawn'));
  await page.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('→ github.yaml'), null, { timeout: 5000 }).catch(() => {});
  if (!(await toast()).includes('→ github.yaml')) fail('opening the folder should say where the diagram goes: ' + (await toast()));
  // Saved from the palette: the new diagram is not in the folder until then.
  await page.keyboard.press('Meta+k');
  await page.keyboard.type('save github.yaml');
  await page.click('.palette [role="option"]:has-text("Save github.yaml")');
  await wait(800);
  const written = await page.evaluate(async () => {
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('kestrel-gh');
    return (await (await d.getFileHandle('github.yaml')).getFile()).text().catch(() => '');
  }).catch(() => '');
  if (!/^type: github/m.test(written)) fail('saving should write github.yaml into the folder');
  // Again from the palette: the hand edit stays.
  await page.evaluate(async () => {
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('kestrel-gh');
    const f = await d.getFileHandle('github.yaml');
    const text = (await (await f.getFile()).text()).replace('label: infra,', 'label: Infrastructure,');
    const w = await f.createWritable();
    await w.write(text);
    await w.close();
  });
  // The folder again, as it is on disk now: github.yaml is one of its diagrams.
  await page.keyboard.press('Meta+k');
  await page.keyboard.type('open folder');
  await page.click('.palette [role="option"]:has-text("Open folder")');
  await wait(1000);
  await page.keyboard.press('Meta+k');
  await page.keyboard.type('GitHub organisation of');
  const offer = page.locator('.palette [role="option"]:has-text("GitHub organisation of kestrel-gh")');
  if (!(await offer.count())) fail('the palette should offer the GitHub organisation of the folder');
  else await offer.click();
  await wait(900);
  if (!((await stored()).text ?? '').includes('label: Infrastructure')) fail('importing again should keep the label written by hand');
  if (!(await toast()).includes('what you added by hand is kept')) fail('importing again should say the hand edits are kept: ' + (await toast()));
  await page.screenshot({ path: `${out}/access-4-folder.png` });
}

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all access import steps ok');
await browser.close();
process.exitCode = problems.length ? 1 : 0;
