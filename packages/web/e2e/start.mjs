// The start flow: template → way of working → (AI) questions → generated diagram. The Claude API is
// mocked with a streamed answer: first with a mistake, so the repair round runs too. node e2e/start.mjs <outDir>
import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
const fail = (m) => problems.push(m);
const wait = (ms = 300) => page.waitForTimeout(ms);
const yaml = () => page.evaluate(() => document.querySelector('.cm-content').innerText);

const good = `type: azure
title: Order platform
groups:
  prod:
    kind: subscription
    label: Production
nodes:
  api:
    kind: api-management
    label: Public API
    in: prod
  orders:
    kind: container-app
    label: Orders
    in: prod
  db:
    kind: sql-database
    label: Orders DB
    in: prod
edges:
  - api -> orders: HTTPS
  - orders -> db
`;
const bad = good.replace('kind: sql-database', 'kind: not-a-kind');
const requests = [];
const sse = (text) => {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const parts = text.match(/[\s\S]{1,40}/g);
  return [
    ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } }),
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    ...parts.map((p) => ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: p } })),
    ev('content_block_stop', { index: 0 }),
    ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 100 } }),
    ev('message_stop', {}),
  ].join('');
};
await page.route('https://api.anthropic.com/**', async (route) => {
  const body = route.request().postDataJSON();
  requests.push(body);
  const answer = '```yaml\n' + (requests.length === 1 ? bad : good) + '```';
  await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: sse(answer) });
});

await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.evaluate(() => localStorage.clear());
await page.reload();
// 1. A first visit opens the start dialog.
await page.waitForSelector('.start .template-card');
await wait(1500);
await page.screenshot({ path: `${out}/1-pick.png` });
await page.locator('.chip', { hasText: 'Azure infrastructure' }).first().click();
await page.locator('.template-card', { hasText: 'Template' }).first().click();
await page.waitForSelector('.mode-card');
await wait(800);
await page.screenshot({ path: `${out}/2-mode.png` });

// 2. Build visually: shapes panel, no YAML.
await page.keyboard.press('2');
await page.waitForSelector('.shapes .add-item');
await wait(800);
if (await page.locator('.editor-pane').isVisible()) fail('YAML visible in the builder view');
await page.screenshot({ path: `${out}/3-builder.png` });
// A shape dragged from the panel lands in the YAML.
const before = await page.locator('.drawing [data-node]').count();
await page.locator('.shapes .add-item', { hasText: 'App Service' }).click();
await wait(600);
if ((await page.locator('.drawing [data-node]').count()) !== before + 1) fail('click in shapes panel did not add a shape');
// ⌘\ shows the YAML again.
await page.locator('.preview').focus();
await page.keyboard.press('Meta+Backslash');
await wait(400);
if (!(await page.locator('.editor-pane').isVisible())) fail('⌘\\ did not show the YAML');

// 3. Describe it: questions, generate (mocked), a repair round, open.
await page.getByRole('button', { name: 'New' }).click();
await page.locator('.chip', { hasText: 'Azure infrastructure' }).first().click();
await page.locator('.template-card', { hasText: 'Template' }).first().click();
await page.keyboard.press('1');
await page.waitForSelector('.ask-form');
await page.locator('.ask-form textarea').first().fill('An order platform with a public API, an orders service and SQL.');
await page.locator('.ask-form .chip', { hasText: 'Key Vault' }).click().catch(() => {});
await page.locator('.ask-run input[type=password]').fill('sk-ant-test');
await page.screenshot({ path: `${out}/4-ask.png` });
await page.getByRole('button', { name: /Generate/ }).click();
await page.waitForSelector('text=Ready', { timeout: 15000 }).catch(() => fail('generation did not finish'));
await wait(800);
await page.screenshot({ path: `${out}/5-result.png` });
if (requests.length !== 2) fail(`expected a repair round (2 requests), got ${requests.length}`);
const first = requests[0];
if (first?.model !== 'claude-opus-5-5') fail('wrong model');
if (!JSON.stringify(first?.messages).includes('An order platform')) fail('answers missing from the prompt');
if (!JSON.stringify(requests[1]?.messages ?? '').includes('not-a-kind')) fail('repair round did not carry the error');
await page.getByRole('button', { name: /Open in builder/ }).click();
await wait(800);
if (!(await yaml()).includes('Orders DB')) fail('generated YAML not opened');
await page.screenshot({ path: `${out}/6-opened.png` });

// 4. Copy the prompt instead, paste an answer.
await page.getByRole('button', { name: 'New' }).click();
await page.locator('.template-card').first().click();
await page.keyboard.press('1');
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
await page.getByRole('button', { name: /Copy the prompt/ }).click();
await page.waitForSelector('.paste');
const clip = await page.evaluate(() => navigator.clipboard.readText());
if (!clip.includes('JSON Schema')) fail('prompt not on the clipboard');
await page.locator('.paste').fill('Here you go:\n```yaml\n' + good + '```\nEnjoy!');
await wait(900);
if (!(await page.locator('.ask-preview svg').count())) fail('pasted answer not drawn');
await page.screenshot({ path: `${out}/7-paste.png` });

await page.emulateMedia({ colorScheme: 'dark' });
await page.getByRole('button', { name: /Open in YAML/ }).click();
await wait(800);
await page.screenshot({ path: `${out}/8-dark.png` });

// 5. Import from Mermaid.
await page.getByRole('button', { name: 'New' }).click();
await page.getByRole('button', { name: /Import from Mermaid/ }).click();
await page.getByRole('button', { name: 'Try the example' }).click();
await wait(900);
if (!(await page.locator('.ask-preview svg').count())) fail('imported Mermaid not drawn');
await page.screenshot({ path: `${out}/9-import.png` });
await page.getByRole('button', { name: /Open in builder/ }).click();
await wait(800);
if (!(await yaml()).includes('type: systems')) fail('import not opened');

// 6. Start blank: an empty diagram of the chosen type in the builder, with a start on the canvas.
await page.emulateMedia({ colorScheme: 'light' });
await page.getByRole('button', { name: 'New' }).click();
if (await page.locator('.template-card', { hasText: /^Empty/ }).count()) fail('the picker still shows Empty cards');
await page.locator('.chip', { hasText: 'Architecture' }).first().click();
await page.locator('.template-card', { hasText: 'Template' }).first().click();
await page.getByRole('button', { name: /start blank/ }).click();
await wait(800);
if (!(await yaml()).trim().startsWith('type: systems')) fail('blank start did not open an empty systems diagram');
if (await page.locator('.toast', { hasText: 'Opened' }).count()) fail('a blank start offered an undo toast');
if (!(await page.locator('.canvas-empty').isVisible())) fail('no empty state on a blank canvas');
await page.screenshot({ path: `${out}/10-blank.png` });
await page.locator('.canvas-empty .chip').first().click();
await wait(700);
if ((await page.locator('.drawing [data-node]').count()) !== 1) fail('quick-add chip did not add a shape');
if (await page.locator('.canvas-empty').count()) fail('empty state still shown after adding a shape');
// The title is renamed in place.
await page.locator('.preview').focus();
await page.keyboard.press('Escape');
const title = await page.locator('.drawing svg > text').first().boundingBox();
await page.mouse.dblclick(title.x + 10, title.y + title.height / 2);
await wait(300);
await page.keyboard.type('Payments');
await page.keyboard.press('Enter');
await wait(500);
if (!(await yaml()).includes('title: Payments')) fail('title not renamed in place');

console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'start flow OK');
await browser.close();
