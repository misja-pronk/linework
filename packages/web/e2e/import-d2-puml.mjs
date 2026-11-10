// D2 and PlantUML into the editor: a .d2 file dropped on the window (two diagrams to pick from), a
// .puml file chosen in the Import panel, and PlantUML pasted, each drawn before it is opened.
// node packages/web/e2e/import-d2-puml.mjs <output folder>   (CARTO_URL: the running app)
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? '.';
fs.mkdirSync(out, { recursive: true });
const fixtures = path.resolve(import.meta.dirname, '../../import/test');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 } });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
const fail = (m) => problems.push(m);
const wait = (ms) => page.waitForTimeout(ms);
const yaml = () => page.evaluate(() => document.querySelector('.cm-content').innerText);
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('cartography:started', 'true');
});
await page.reload();
await page.waitForSelector('.preview svg [data-node]');
const origin = new URL(page.url()).origin;
page.on('request', (r) => !r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:') && fail(`left the app: ${r.url()}`));

async function drop(file, name) {
  const content = fs.readFileSync(file, 'utf8');
  const target = await page.locator('.preview').elementHandle();
  const dt = await page.evaluateHandle(
    ([text, n]) => {
      const t = new DataTransfer();
      t.items.add(new File([text], n, { type: 'application/octet-stream' }));
      return t;
    },
    [content, name],
  );
  await target.dispatchEvent('dragover', { dataTransfer: dt });
  await target.dispatchEvent('drop', { dataTransfer: dt });
}

// 1. A D2 file dropped: the Import panel, the architecture and its tables as two diagrams.
await drop(path.join(fixtures, 'd2/aws-shop.d2'), 'aws-shop.d2');
await page.waitForSelector('.mode-preview svg', { timeout: 8000 }).catch(() => fail('aws-shop.d2: nothing drawn in the Import panel'));
if (!(await page.locator('h2', { hasText: /Import from/ }).count())) fail('aws-shop.d2: not in the Import panel');
const tabs = await page.locator('[aria-label=Diagram] [role=radio]').allInnerTexts();
if (tabs.join('|') !== 'architecture|tables') fail(`aws-shop.d2: diagrams ${tabs.join('|')}`);
const report = await page.locator('.ask-preview .callout').innerText().catch(() => '');
if (!/Icons are not fetched/.test(report)) fail(`aws-shop.d2: the report does not say what was left out (${report.slice(0, 80)})`);
await wait(500);
await page.screenshot({ path: `${out}/1-d2-dropped.png` });
await page.locator('[aria-label=Diagram] [role=radio]', { hasText: 'tables' }).click();
await wait(600);
await page.screenshot({ path: `${out}/2-d2-tables.png` });
await page.locator('[aria-label=Diagram] [role=radio]', { hasText: 'architecture' }).click();
await wait(400);
await page.getByRole('button', { name: /Open in YAML/ }).click();
await wait(800);
const cloud = await yaml();
if (!/^type: cloud\s+provider: aws/.test(cloud) || !cloud.includes('kind: lambda')) fail('aws-shop.d2: not opened as an AWS cloud diagram');

// 2. A PlantUML file chosen in the Import panel of the start dialog.
await page.getByRole('button', { name: 'New' }).click();
await page.getByRole('button', { name: /Import from Mermaid, D2, PlantUML/ }).click();
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /Choose a file/ }).click()]);
await chooser.setFiles(path.join(fixtures, 'plantuml/c4-containers.puml'));
await page.waitForSelector('.mode-preview svg', { timeout: 8000 }).catch(() => fail('c4-containers.puml: nothing drawn'));
await wait(600);
await page.screenshot({ path: `${out}/3-c4-plantuml.png` });
await page.getByRole('button', { name: /Open in builder/ }).click();
await page.waitForSelector('.preview svg [data-node]');
await wait(800);
await page.screenshot({ path: `${out}/4-c4-opened.png` });

// 3. PlantUML pasted, without a file: known by @startuml.
await page.getByRole('button', { name: 'New' }).click();
await page.getByRole('button', { name: /Import from Mermaid, D2, PlantUML/ }).click();
await page.locator('textarea.paste').fill(fs.readFileSync(path.join(fixtures, 'plantuml/checkout-sequence.puml'), 'utf8'));
await page.waitForSelector('.mode-preview svg', { timeout: 8000 }).catch(() => fail('pasted PlantUML: nothing drawn'));
await wait(600);
await page.screenshot({ path: `${out}/5-plantuml-pasted.png` });
await page.getByRole('button', { name: /Open in YAML/ }).click();
await wait(800);
if (!(await yaml()).startsWith('type: sequence')) fail('pasted PlantUML: not a sequence diagram');

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'all D2 and PlantUML import steps ok');
await browser.close();
process.exit(problems.length ? 1 : 0);
