// Compare with an earlier version: take a snapshot, edit, compare as overlay and side by side, step
// through the changes, copy the summary, export (Markdown, PPTX, PNG, SVG), leave; then in a folder
// that is a git repository (packed by gc): last saved, HEAD and an earlier commit, a snapshot written
// next to the diagram. node e2e/compare.mjs <outDir>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
await context.grantPermissions(['clipboard-read', 'clipboard-write']);
const page = await context.newPage();
/** Says Discard to the app's "Discard the unsaved changes?" dialogs until stopped (they replaced confirm()). */
const discarding = () => {
  let on = true;
  void (async () => {
    while (on && !page.isClosed()) await page.locator('.confirm-dialog button:has-text("Discard")').click({ timeout: 250 }).catch(() => {});
  })();
  return () => void (on = false);
};
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
// A step that throws still says what failed before it, with a picture of the page.
process.on('uncaughtException', async (e) => {
  console.error([...problems, e.message].join('\n'));
  await page.screenshot({ path: `${out}/failed.png` }).catch(() => undefined);
  process.exit(1);
});
const wait = (ms = 300) => page.waitForTimeout(ms);
const check = (what, got, want) => (got === want ? undefined : fail(`${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`));
const url = process.env.CARTO_URL ?? 'http://localhost:5178/';

const v1 = `type: azure
title: Shop
groups:
  rg: { kind: resource-group, label: rg-shop }
nodes:
  users: users
  web: { kind: app-service, label: Web shop, in: rg }
  api: { kind: container-app, label: Orders API, in: rg }
  db: { kind: sql-database, label: Orders, in: rg }
  vm: { kind: vm, label: Legacy VM, in: rg }
edges:
  - users -> web: { label: HTTPS }
  - web -> api
  - api -> db
  - vm -> db
`;
const v2 = v1
  .replace('  vm: { kind: vm, label: Legacy VM, in: rg }\n', '  cache: { kind: redis, label: Redis cache, in: rg }\n')
  .replace('  - vm -> db\n', '  - api -> cache: { label: TLS }\n');
const v3 = v2.replace('  users: users\n', '  users: users\n  admin: { kind: user, label: Admins }\n');

/** Replaces the YAML in the editor as one edit, as typing or pasting would. */
const setYaml = async (text) => {
  await page.locator('.cm-content').click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.insertText(text);
  await wait(700);
};
const counts = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.cmp-count')].map((e) => [e.dataset.count, Number(e.innerText.match(/\d+/)?.[0])])));
const items = () => page.locator('.cmp-item .cmp-text').allInnerTexts();
const pick = async (words) => {
  await page.waitForSelector('.palette input');
  await page.keyboard.type(words);
  await wait(150);
  await page.keyboard.press('Enter');
};
const download = async (menuItem) => {
  const [d] = await Promise.all([page.waitForEvent('download'), (async () => {
    await page.click('.cmp-bar button:has-text("Export")');
    await page.click(`.menu [role="menuitem"]:has-text("${menuItem}")`);
  })()]);
  const file = path.join(out, d.suggestedFilename());
  await d.saveAs(file);
  return file;
};

// 1. A snapshot, an edit, and the overlay: added, removed (a ghost where it stood) and changed.
{
  await page.addInitScript((text) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'code', doc: { text, doc: { name: 'shop.yaml' } } })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
  }, v1);
  await page.goto(url);
  await page.waitForSelector('.drawing [data-node="vm"]', { timeout: 15000 });
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+Shift+s');
  await page.waitForSelector('.snap-dialog input');
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('before-review');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.toast:has-text("before-review")');
  if (await page.locator('.snap-dialog').count()) fail('the snapshot dialog stayed open');

  await setYaml(v2);
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+Shift+d');
  await pick('before-review');
  await page.waitForSelector('.compare .cmp-count', { timeout: 15000 });
  await wait(400);
  const c = await counts();
  // Counted as the list says them: added the cache and its line (two sentences); removed the VM with
  // its connection (one sentence, so one removed, not two); changed: nothing else.
  check('counts in the toolbar', JSON.stringify(c), JSON.stringify({ added: 2, changed: 0, removed: 1 }));
  check('removed as many as the list says', (await page.locator('.cmp-sign').allInnerTexts()).filter((x) => x === '−').length, c.removed);
  const said = await items();
  for (const s of ['Added Redis cache (cache for Redis) in rg-shop', 'Orders API now connects to Redis cache (“TLS”)', 'Removed Legacy VM from rg-shop (and its connection)']) if (!said.includes(s)) fail(`change list lacks "${s}": ${JSON.stringify(said)}`);
  if (!(await page.locator('.cmp-pane[data-pane="overlay"] [data-diff="removed"][data-node="vm"]').count())) fail('no ghost of the removed VM in the overlay');
  if (!(await page.locator('.cmp-pane[data-pane="overlay"] [data-diff="added"][data-node="cache"]').count())) fail('the cache is not marked added');
  // Never colour alone: every sign in the list is a character, and removed rows are struck through.
  check('signs in the list', (await page.locator('.cmp-sign').allInnerTexts()).join(''), '++−');
  await page.screenshot({ path: `${out}/c1-overlay.png` });

  // 2. ] and [ step through the changes (as they step through steps): the row and the mark are current, the view moves to it.
  const transform = () => page.locator('.cmp-pane[data-pane="overlay"] .cmp-stage').evaluate((e) => e.style.transform);
  const before = await transform();
  await page.keyboard.press(']');
  await wait(400);
  check('first change current', await page.locator('.cmp-item.current').getAttribute('data-step'), '0');
  if (!(await page.locator('.cmp-stage [data-current][data-node="cache"]').count())) fail('the cache mark is not current after ]');
  if ((await transform()) === before) fail('the view did not move to the change');
  await page.keyboard.press(']');
  await page.keyboard.press('j');
  await wait(300);
  check('third change current', await page.locator('.cmp-item.current').getAttribute('data-step'), '2');
  if (!(await page.locator('.cmp-stage [data-current][data-node="vm"]').count())) fail('the ghost of the VM is not current on the third change');
  await page.keyboard.press('[');
  await wait(300);
  check('[ goes back', await page.locator('.cmp-item.current').getAttribute('data-step'), '1');
  // N and P are the drawing's (a note, presenting): under the comparison they do nothing.
  await page.keyboard.press('p');
  await page.keyboard.press('n');
  await wait(300);
  if (await page.locator('.present').count()) fail('P presented while comparing');
  if (await page.locator('.note-composer').count()) fail('N started a note while comparing');
  check('P and N leave the change alone', await page.locator('.cmp-item.current').getAttribute('data-step'), '1');
  await page.locator('.cmp-item').first().click();
  check('a click picks a change', await page.locator('.cmp-item.current').getAttribute('data-step'), '0');
  await wait(400);
  await page.screenshot({ path: `${out}/c2-stepped.png` });

  // 3. Live: an edit while comparing shows up in the comparison.
  await setYaml(v3);
  await wait(600);
  check('added after a live edit', (await counts()).added, 3);
  if (!(await items()).includes('Added Admins (user)')) fail(`live edit not listed: ${JSON.stringify(await items())}`);

  // 4. Side by side: two panes, panned and zoomed together.
  await page.locator('.compare').focus();
  await page.keyboard.press('m');
  await page.waitForSelector('.cmp-pane[data-pane="before"]');
  await wait(500);
  if (!(await page.locator('.cmp-pane[data-pane="before"] [data-diff="removed"][data-node="vm"]').count())) fail('the VM is not marked removed on the before side');
  if (!(await page.locator('.cmp-pane[data-pane="after"] [data-diff="added"][data-node="cache"]').count())) fail('the cache is not marked added on the after side');
  await page.screenshot({ path: `${out}/c3-side-by-side.png` });
  if (!(await page.locator('.cmp-panes.stacked').count())) fail('a wide drawing side by side is not stacked');
  const box = await page.locator('.cmp-pane[data-pane="after"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Meta');
  await page.mouse.wheel(0, -40);
  await page.keyboard.up('Meta');
  await wait(200);
  const both = await page.locator('.cmp-stage').evaluateAll((els) => els.map((e) => e.style.transform));
  check('both panes zoomed together', both[0], both[1]);
  await page.screenshot({ path: `${out}/c3-side-by-side-zoomed.png` });

  // 5. The summary as Markdown on the clipboard, for a change advisory board.
  await page.click('.cmp-bar button:has-text("Copy summary")');
  await wait(300);
  const md = await page.evaluate(() => navigator.clipboard.readText());
  if (!md.startsWith('## Changes to Shop since snapshot before-review')) fail(`summary heading: ${md.split('\n')[0]}`);
  for (const s of ['- Added Redis cache (cache for Redis) in rg-shop', '- Removed Legacy VM from rg-shop (and its connection)', '### Element by element']) if (!md.includes(s)) fail(`summary lacks "${s}"`);
  fs.writeFileSync(`${out}/summary.md`, md);

  // 6. Exports: two slides, a PNG and an SVG of what is on screen.
  const pptx = unzipSync(fs.readFileSync(await download('.pptx')));
  const slides = Object.keys(pptx).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
  check('slides in the deck', slides.length, 2);
  if (!strFromU8(pptx['ppt/slides/slide1.xml']).includes('Before: Shop')) fail('slide 1 is not the before');
  if (!strFromU8(pptx['ppt/notesSlides/notesSlide2.xml']).includes('Removed Legacy VM')) fail('the changes are not in the notes');
  if (!strFromU8(pptx['ppt/media/picture1.svg']).includes('data-diff="removed"')) fail('the before slide has no marks');
  const png = fs.readFileSync(await download('PNG'));
  check('PNG signature', png.subarray(1, 4).toString(), 'PNG');
  const svg = fs.readFileSync(await download('SVG'), 'utf8');
  if (!svg.includes('data-diff-panel="before"') || !svg.includes('@font-face')) fail('side-by-side SVG without its panels or fonts');

  // 7. Esc leaves: the editor as it was, the drawing back.
  await page.locator('.compare').focus();
  await page.keyboard.press('Escape');
  await wait(300);
  if (await page.locator('.compare').count()) fail('Esc did not leave the comparison');
  if (!(await page.locator('.drawing [data-node="admin"]').count())) fail('the drawing is not back after leaving');
}

// 8. In a folder that is a git repository: last saved, HEAD and an earlier commit; a snapshot in the folder.
{
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-compare-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Ann', GIT_AUTHOR_EMAIL: 'ann@example.com', GIT_COMMITTER_NAME: 'Ann', GIT_COMMITTER_EMAIL: 'ann@example.com', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => execFileSync('git', a, { cwd: repo, env, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'shop.yaml'), v1);
  git('add', '-A');
  git('commit', '-q', '-m', 'First shop');
  fs.writeFileSync(path.join(repo, 'shop.yaml'), v2);
  git('commit', '-q', '-am', 'Redis cache instead of the VM');
  git('gc', '-q');
  fs.writeFileSync(path.join(repo, 'shop.yaml'), v3);
  const files = {};
  const walk = (d, prefix) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = prefix + e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), p + '/');
      else files[p] = fs.readFileSync(path.join(d, e.name)).toString('base64');
    }
  };
  walk(repo, '');
  fs.rmSync(repo, { recursive: true, force: true });
  await page.evaluate(async (files) => {
    const opfs = await navigator.storage.getDirectory();
    for await (const [name] of opfs.entries()) await opfs.removeEntry(name, { recursive: true });
    const dir = await opfs.getDirectoryHandle('shop-repo', { create: true });
    for (const [p, b64] of Object.entries(files)) {
      const parts = p.split('/');
      let d = dir;
      for (const seg of parts.slice(0, -1)) d = await d.getDirectoryHandle(seg, { create: true });
      const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
      await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      await w.close();
    }
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('shop-repo');
  }, files);
  // The unsaved document is discarded (asked twice: before the folder, and before its first file).
  const stop = discarding();
  await page.click('button:has-text("Open folder")');
  await page.waitForSelector('.files .file.active:has-text("shop.yaml")');
  stop();
  await page.waitForSelector('.drawing [data-node="admin"]');

  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+Shift+d');
  await page.waitForSelector('.palette input');
  const offered = await page.locator('.palette [role="option"], .palette button').allInnerTexts();
  const has = (s) => offered.some((o) => o.includes(s));
  if (!has('Last saved')) fail('no "Last saved" in a folder');
  if (!has('HEAD (main)')) fail(`no HEAD in a git folder: ${JSON.stringify(offered)}`);
  if (!has('First shop')) fail('the earlier commit of the file is not offered');
  await pick('HEAD');
  await page.waitForSelector('.compare .cmp-count');
  await wait(300);
  check('against HEAD: the admin is new', JSON.stringify(await counts()), JSON.stringify({ added: 1, changed: 0, removed: 0 }));
  check('named in the toolbar', await page.locator('.cmp-against strong').innerText(), 'HEAD');
  await page.screenshot({ path: `${out}/c4-head.png` });
  await page.click('.cmp-against');
  await pick('First shop');
  await page.waitForFunction(() => document.querySelector('.cmp-against strong')?.textContent !== 'HEAD');
  await wait(400);
  check('against the first commit', JSON.stringify(await counts()), JSON.stringify({ added: 3, changed: 0, removed: 1 }));
  await page.locator('.compare').focus();
  await page.keyboard.press('Escape');

  // A snapshot written next to the diagram, which the file list does not show as a diagram.
  await page.locator('.preview').focus();
  await page.keyboard.press('Meta+Shift+s');
  await page.waitForSelector('.snap-dialog input');
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('Q3 review');
  if (!(await page.locator('.snap-dialog code:has-text("shop.snapshots/Q3-review.yaml")').count())) fail('the dialog does not say where the snapshot goes');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.toast:has-text("Q3 review")');
  const written = await page.evaluate(async () => {
    const d = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('shop-repo')).getDirectoryHandle('shop.snapshots');
    return (await (await d.getFileHandle('Q3-review.yaml')).getFile()).text();
  });
  check('snapshot file in the folder', written, v3);
  check('file list without the snapshot', (await page.locator('.files .file').allInnerTexts()).join(), 'shop.yaml');
}

await browser.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('compare: ok');
