// The Ask panel (⌘J) with the Claude API mocked, streamed as the real API streams: an edit accepted
// (one undo step, pins kept), an edit rejected, an invalid change repaired and one refused, an
// explanation whose element references select, a bad key, and a run stopped halfway.
// node e2e/ask.mjs <outDir>
import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
const wait = (ms = 300) => page.waitForTimeout(ms);
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('cartography:doc') ?? '{}'));
const yaml = async () => (await wait(500), (await stored()).text ?? '');

const text = `type: azure
title: Order platform   # hand-written comment
groups:
  prod: { kind: subscription, label: Production }
nodes:
  api: { kind: api-management, label: Public API, in: prod }
  orders: { kind: container-app, label: Orders, in: prod }
  db: { kind: sql-database, label: Orders DB, in: prod }
edges:
  - api -> orders: HTTPS
  - orders -> db
`;

// ------------------------------------------------------------ the mocked API

/** A streamed answer: text, thinking and tool_use blocks, cut in pieces as the API sends them. */
const sse = (blocks, stop = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn') => {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const chunks = (s) => s.match(/[\s\S]{1,30}/g) ?? [];
  const body = [ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } })];
  blocks.forEach((b, index) => {
    if (b.type === 'thinking') {
      body.push(ev('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } }));
      body.push(ev('content_block_delta', { index, delta: { type: 'signature_delta', signature: 'sig' } }));
    } else if (b.type === 'text') {
      body.push(ev('content_block_start', { index, content_block: { type: 'text', text: '' } }));
      for (const c of chunks(b.text)) body.push(ev('content_block_delta', { index, delta: { type: 'text_delta', text: c } }));
    } else {
      body.push(ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } }));
      for (const c of chunks(JSON.stringify(b.input))) body.push(ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: c } }));
    }
    body.push(ev('content_block_stop', { index }));
  });
  body.push(ev('message_delta', { delta: { stop_reason: stop }, usage: { output_tokens: 100 } }), ev('message_stop', {}));
  return body.join('');
};
const requests = [];
/** What the next requests get, in order: blocks to stream, or { status, error } for a failed call, or { hang } to never answer in time. */
let replies = [];
await page.route('https://api.anthropic.com/**', async (route) => {
  requests.push(route.request().postDataJSON());
  const r = replies.shift();
  const headers = { 'access-control-allow-origin': '*' };
  if (!r) return route.fulfill({ status: 500, headers, body: '{}' });
  if (r.hang) {
    await new Promise((ok) => setTimeout(ok, 6000));
    return route.fulfill({ status: 200, headers: { ...headers, 'content-type': 'text/event-stream' }, body: sse([{ type: 'text', text: 'too late' }]) }).catch(() => undefined);
  }
  if (r.status) return route.fulfill({ status: r.status, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'error', error: { type: r.error, message: r.error } }) });
  await route.fulfill({ status: 200, headers: { ...headers, 'content-type': 'text/event-stream' }, body: sse(r) });
});
const tool = (id, name, input) => ({ type: 'tool_use', id, name, input });
const last = () => requests.at(-1);
const userBlocks = (req) => req.messages.at(-1).content;
const sentText = (req) => JSON.stringify(req.messages);

// ------------------------------------------------------------ the page

await page.addInitScript(() => {
  const next = sessionStorage.getItem('seed');
  if (!next) return;
  sessionStorage.removeItem('seed');
  localStorage.clear();
  const { text, pins } = JSON.parse(next);
  for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'code', doc: { text, doc: { name: 'orders.yaml' }, pins } })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
});
await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
await page.evaluate((next) => sessionStorage.setItem('seed', next), JSON.stringify({ text, pins: { version: 1, nodes: { db: { x: 40, y: 260 } } } }));
await page.reload();
await page.waitForSelector('.drawing [data-node="db"]', { timeout: 10000 });
await wait(500);
if (!(await page.locator('.statusbar').innerText()).includes('1 pinned')) fail('the seeded pin is not there');

// 1. ⌘J opens the panel; without a key it asks for one and says what is sent.
await page.locator('.drawing [data-node="orders"]').click();
await page.locator('.preview').focus();
await page.keyboard.press('Meta+j');
await page.waitForSelector('.ask-panel');
if (!(await page.locator('.ask-panel input[type=password]').isVisible())) fail('no key field without a key');
const sent = await page.locator('.ask-sent').innerText();
// Exactly what goes: the file's name, the selected id and its label, and the question too.
if (!/the YAML of orders\.yaml, the Azure .* schema and description, the id and label of what is selected, the problem list and your question\. Nothing else/.test(sent)) fail(`what is sent is not said plainly: ${sent}`);
if (!(await page.locator('.ask-scope').innerText()).includes('Orders')) fail('the panel does not say it is about the selection');
await page.screenshot({ path: `${out}/1-open.png` });

// 2. A bad key is explained, nothing changes.
await page.locator('.ask-panel input[type=password]').fill('sk-ant-wrong');
replies.push({ status: 401, error: 'authentication_error' });
await page.locator('.ask-input textarea').fill('Add a cache next to the orders service');
await page.keyboard.press('Enter');
await page.waitForSelector('.ask-panel .callout.error', { timeout: 10000 });
if (!(await page.locator('.ask-panel .callout.error').innerText()).includes('did not accept this API key')) fail('a bad key is not explained');
if ((await yaml()) !== text) fail('a failed call changed the YAML');

// 3. An edit: streamed, validated, shown as a diff; ⏎ accepts it as one undo step and the pin stays.
replies = [
  [
    { type: 'thinking' },
    { type: 'text', text: 'A Redis cache in front of the [[db]], read by [[orders]].' },
    tool('toolu_1', 'edit_diagram', {
      summary: 'Add a Redis cache that Orders reads through',
      operations: [
        { op: 'set', path: ['nodes', 'cache'], value: { kind: 'redis', label: 'Cache', in: 'prod' } },
        { op: 'append', path: ['edges'], value: 'orders -> cache: reads' },
      ],
    }),
  ],
];
await page.locator('.ask-input textarea').fill('Add a cache next to the orders service');
await page.keyboard.press('Enter');
await page.waitForSelector('.proposal .proposal-svg svg', { timeout: 15000 }).catch(() => fail('no drawing of the proposal'));
await wait(400);
await page.screenshot({ path: `${out}/2-proposal.png` });
const first = last();
if (first.model !== 'claude-opus-5-5') fail(`model ${first.model}`);
if (first.thinking?.type !== 'adaptive') fail('adaptive thinking not asked for');
if (!first.tools?.length || !first.tools.every((t) => t.eager_input_streaming === true)) fail('tools do not stream input eagerly');
if (first.system?.[0]?.cache_control?.type !== 'ephemeral') fail('the system prompt is not cached');
const firstText = sentText(first);
for (const want of ['hand-written comment', '<schema>', 'Selected: node orders', 'Problems: none']) if (!firstText.includes(want)) fail(`the first message lacks ${want}`);
if (firstText.includes('Layout report')) fail('an edit request carried the layout report');
if (!(await page.locator('.proposal-count').innerText()).match(/added/)) fail(`the diff does not count the added: ${await page.locator('.proposal-count').innerText()}`);
if (!(await page.locator('.proposal-svg [data-diff-overlay]').count())) fail('the proposal drawing has no diff marks');
await page.locator('.proposal .segmented button', { hasText: 'YAML' }).click();
await wait(200);
const diffText = await page.locator('.proposal-yaml').innerText();
if (!diffText.includes('+   cache: { kind: redis, label: Cache, in: prod }') || !diffText.includes('+   - orders -> cache: reads')) fail(`YAML diff wrong:\n${diffText}`);
await page.screenshot({ path: `${out}/3-yaml-diff.png` });
if ((await yaml()) !== text) fail('the proposal changed the YAML before it was accepted');
await page.locator('.proposal').focus();
await page.keyboard.press('Enter');
await wait(900);
const accepted = await yaml();
if (!accepted.includes('cache: { kind: redis, label: Cache, in: prod }')) fail('accept did not apply the change');
if (!accepted.includes('# hand-written comment')) fail('accept lost the hand-written comment');
if (!(await page.locator('.statusbar').innerText()).includes('1 pinned')) fail('accept lost the pin');
if (!(await page.locator('.drawing [data-node="cache"]').count())) fail('the cache is not drawn');
await page.screenshot({ path: `${out}/4-accepted.png` });
await page.locator('.canvas-tools button[aria-label="Undo"]').click();
await wait(700);
if ((await yaml()) !== text) fail('one undo did not take the whole change back');
await page.locator('.canvas-tools button[aria-label="Redo"]').click();
await wait(700);
if (!(await yaml()).includes('cache:')) fail('redo did not bring the change back');

// 4. A follow-up edit, rejected with Esc: the YAML stays; the accept was told to Claude.
replies = [[tool('toolu_2', 'edit_diagram', { summary: 'Rename db to orders-db', operations: [{ op: 'rename', path: ['nodes', 'db'], to: 'orders-db' }] })]];
await page.locator('.ask-input textarea').fill('Give the database a clearer id');
await page.keyboard.press('Enter');
await page.waitForSelector('.proposal', { timeout: 15000 });
const owed = userBlocks(last());
if (owed[0]?.type !== 'tool_result' || owed[0].tool_use_id !== 'toolu_1' || !String(owed[0].content).includes('accepted')) fail(`the follow-up did not settle the first change: ${JSON.stringify(owed[0])}`);
if (!sentText(last()).includes('cache: { kind: redis')) fail('the follow-up did not send the changed YAML');
if (JSON.stringify(last().messages.at(-1)).includes('<schema>')) fail('the follow-up sent the schema again');
const before = await yaml();
await page.locator('.proposal').focus();
await page.keyboard.press('Escape');
await wait(600);
if ((await yaml()) !== before) fail('reject changed the YAML');
if (!(await page.locator('.proposal-turn.rejected').count())) fail('the rejected change is not marked so');
if (!(await page.locator('.ask-panel').count())) fail('Esc on a proposal closed the panel');

// 5. An invalid change goes back to Claude with the engine's errors and comes back fixed.
replies = [
  [tool('toolu_3', 'edit_diagram', { summary: 'Add a firewall', operations: [{ op: 'set', path: ['nodes', 'fw'], value: { kind: 'not-a-kind', label: 'Firewall', in: 'prod' } }] })],
  [tool('toolu_4', 'edit_diagram', { summary: 'Add a firewall', operations: [{ op: 'set', path: ['nodes', 'fw'], value: { kind: 'firewall', label: 'Firewall', in: 'prod' } }, { op: 'append', path: ['edges'], value: 'fw -> api' }] })],
];
const n5 = requests.length;
await page.locator('.ask-input textarea').fill('Put a firewall in front of the API');
await page.keyboard.press('Enter');
await page.waitForSelector('.proposal', { timeout: 15000 });
if (requests.length !== n5 + 2) fail(`expected a repair round, got ${requests.length - n5} requests`);
const repair = userBlocks(last());
if (!(repair[0]?.type === 'tool_result' && repair[0].is_error && String(repair[0].content).includes('does not validate'))) fail(`the repair round did not carry the error: ${JSON.stringify(repair[0])}`);
const rejected5 = userBlocks(requests[n5]);
if (!String(rejected5[0]?.content).includes('rejected')) fail('the rejection was not told to Claude');
await page.screenshot({ path: `${out}/5-repaired.png` });
await page.locator('.proposal button', { hasText: 'Reject' }).click();
await wait(300);

// 6. Three invalid tries: refused, nothing offered, nothing changed.
const broken = (id) => [tool(id, 'edit_diagram', { summary: 'x', operations: [{ op: 'set', path: ['nodes', 'x'], value: { kind: 'nope' } }] })];
replies = [broken('toolu_5'), broken('toolu_6'), broken('toolu_7')];
const kept = await yaml();
await page.locator('.ask-input textarea').fill('Something impossible');
await page.keyboard.press('Enter');
await page.waitForSelector('text=did not validate after two fixes', { timeout: 15000 }).catch(() => fail('an invalid change was not refused'));
if (await page.locator('.proposal').count()) fail('a refused change was offered');
if ((await yaml()) !== kept) fail('a refused change changed the YAML');
await page.screenshot({ path: `${out}/6-refused.png` });

// 7. A review: the layout report goes along; the answer's references select and frame elements.
replies = [
  [
    {
      type: 'text',
      text: 'Two single points of failure:\n\n- [[db]] is one SQL database without a replica.\n- [[api]] is the only way in; [[api -> orders]] has no fallback.\n\nAdd a geo-replica of **Orders DB**.',
    },
  ],
];
await page.locator('.ask-input textarea').fill('Review it for single points of failure');
await page.keyboard.press('Enter');
await page.waitForSelector('text=Two single points of failure', { timeout: 15000 });
await wait(200);
const review = page.locator('.turn.claude').last();
if (!sentText(last()).includes('Layout report:')) fail('the review did not send the layout report');
const refs = await review.locator('button.ref').allInnerTexts();
if (refs.join('|') !== 'Orders DB|Public API|Public API → Orders') fail(`references: ${refs.join('|')}`);
await review.locator('button.ref', { hasText: 'Orders DB' }).click();
await wait(500);
if (!(await page.locator('.ask-scope').innerText()).includes('Orders DB') || !(await page.locator('.statusbar').innerText()).includes('db')) fail('a reference did not select its element');
if (await page.locator('.inspector').count()) fail('the inspector squeezes in next to the Ask panel');
await page.screenshot({ path: `${out}/7-review.png` });

// 8. Stop: a slow answer is cancelled with Esc; nothing changes, the panel says so.
replies = [{ hang: true }];
await page.locator('.ask-input textarea').fill('Explain this diagram');
await page.keyboard.press('Enter');
await page.waitForSelector('.ask-status', { timeout: 5000 });
await wait(300);
await page.screenshot({ path: `${out}/8-running.png` });
await page.keyboard.press('Escape');
await page.waitForSelector('text=Stopped. Nothing was changed.', { timeout: 5000 }).catch(() => fail('cancel did not stop the run'));
if (await page.locator('.ask-status').count()) fail('still running after stop');

// 9. Dark, and ⌘J closes it again.
await page.emulateMedia({ colorScheme: 'dark' });
await wait(300);
await page.screenshot({ path: `${out}/9-dark.png` });
await page.locator('.ask-input textarea').focus();
await page.keyboard.press('Meta+j');
await wait(300);
// Closed, it keeps its conversation behind the side panel's tabs, out of sight.
if (await page.locator('.ask-panel:visible').count()) fail('⌘J did not close the panel');

// 10. A phone: the panel fits the screen.
{
  const p2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await p2.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
  await p2.evaluate((t) => {
    localStorage.clear();
    for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'visual', doc: { text: t, doc: { name: 'orders.yaml' } } })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
  }, text);
  await p2.reload();
  await p2.waitForSelector('.drawing [data-node="db"]', { timeout: 10000 });
  await p2.locator('.canvas-tools button', { hasText: 'Ask' }).click();
  await p2.waitForSelector('.ask-panel');
  const box = await p2.locator('.ask-panel').boundingBox();
  if (!box || box.x < 0 || box.x + box.width > 390) fail(`the panel does not fit a phone: ${JSON.stringify(box)}`);
  await p2.screenshot({ path: `${out}/10-phone.png` });
  await p2.close();
}

console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'ask OK');
await browser.close();
