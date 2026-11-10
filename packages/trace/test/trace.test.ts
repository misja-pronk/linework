// Tracing requests through the examples: the routes found, the sequence written, and that it draws.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { indexWorkspace } from '@cartography/core';
import { render } from '@cartography/engine';
import { dynamicView, participantIds, sequenceYaml, traceable, traceAsk, type TraceAsk, type TraceMeta } from '../src/index.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
const loader = (f: string) => (rel: string) => read(path.join(path.dirname(f), rel));

async function traced(file: string, ask: TraceAsk, view?: string, pick = 0) {
  const t = await traceable(read(file), { load: loader(file), file: path.basename(file), view });
  const r = traceAsk(t, ask);
  expect(r.error).toBeUndefined();
  const meta: TraceMeta = { file: path.basename(file), view, mode: r.mode, from: r.from, to: r.to, pick: { n: pick + 1, of: r.options.length } };
  const yaml = sequenceYaml(t.graph, r.options[pick]!, meta);
  const drawn = await render(yaml, { fonts: 'none' });
  expect(drawn.diagnostics).toEqual([]);
  return { t, r, yaml, data: parse(yaml) as Record<string, any>, meta, messages: (parse(yaml) as { messages: unknown[] }).messages.map((m) => (typeof m === 'string' ? m : JSON.stringify(m))) };
}

describe('between two elements', () => {
  it('follows the web shop from the customers to the database, with a reply for every call', async () => {
    const { r, data, messages } = await traced('examples/systems/web-shop.yaml', { from: 'customers', to: 'db' });
    expect(r.options).toHaveLength(1);
    expect(r.options[0]!.summary).toBe('Users → Storefront → API gateway → Orders → Orders DB');
    expect(messages).toEqual([
      '{"customers -> web":"HTTPS"}',
      '{"web -> gateway":"REST"}',
      // The gateway forwards the REST call it got: its line has no label of its own.
      '{"gateway -> orders":"REST"}',
      '{"orders -> db":"SQL"}',
      'db --> orders',
      'orders --> gateway',
      'gateway --> web',
      'web --> customers',
    ]);
    // Groups become a box: the outer system, not each zone in it.
    expect(data.boxes).toEqual({ shop: 'Web shop' });
    expect(data.participants.db).toMatchObject({ kind: 'database', box: 'shop', ref: 'db' });
    expect(data.participants.customers.box).toBeUndefined();
    expect(data.traced).toEqual({ file: 'web-shop.yaml', from: 'customers', to: 'db' });
  });

  it('sends an async message without a reply, and goes on from the queue', async () => {
    const { messages } = await traced('examples/systems/web-shop.yaml', { from: 'customers', to: 'mailer' });
    expect(messages).toContain('{"orders ->> bus":"OrderPlaced"}');
    expect(messages).toContain('bus ->> mailer');
    expect(messages.some((m) => m.startsWith('mailer -->') || m.startsWith('bus -->'))).toBe(false);
    // Orders answers the gateway once it has published.
    expect(messages.at(-3)).toBe('orders --> gateway');
  });

  it('offers every route through the C4 model, down to the components, shortest first', async () => {
    const { r, data, yaml } = await traced('examples/c4/kestrel-bank.yaml', { from: 'customer', to: 'ledger' });
    expect(r.options.map((o) => o.summary)).toEqual([
      'Personal customer → Web banking → Accounts controller → Ledger client → Core ledger',
      'Personal customer → Mobile app → Payments controller → Ledger client → Core ledger',
    ]);
    // online.web -> online.api is the same relation as online.web -> online.api.accounts, written coarser: not a route of its own.
    expect(Object.keys(data.participants)).toEqual(['customer', 'web', 'accounts', 'api-ledger', 'ledger']);
    expect(data.participants['api-ledger']).toMatchObject({ ref: 'online.api.ledger', caption: 'Spring bean' });
    expect(yaml).toContain('- web -> accounts: Gets accounts [JSON/HTTPS]');
  });

  it('writes a dynamic view of a model that the model draws', async () => {
    const { t, r, meta } = await traced('examples/c4/kestrel-bank.yaml', { from: 'customer', to: 'ledger' });
    const d = dynamicView(t.graph, r.options[0]!, meta)!;
    expect(d.name).toBe('trace-customer-ledger');
    expect(d.value.steps[0]).toEqual({ 'customer -> online.web': { label: 'Banks online', technology: 'HTTPS' } });
    const text = read('examples/c4/kestrel-bank.yaml').replace('\nviews:\n', `\nviews:\n${d.yaml.replace(/^/gm, '  ').trimEnd()}\n`);
    const drawn = await render(text, { fonts: 'none', view: d.name });
    expect(drawn.diagnostics).toEqual([]);
    expect(drawn.graph!.steps!.map((s) => `${s.from}>${s.to}`)).toEqual(['customer>online.web', 'online.web>online.api.accounts', 'online.api.accounts>online.api.ledger', 'online.api.ledger>ledger']);
  });

  it('traces what a view draws, with its ids', async () => {
    const { data, messages } = await traced('examples/workspace/containers.yaml', { from: 'customer', to: 'ledger' }, 'online');
    expect(data.traced).toEqual({ file: 'containers.yaml', view: 'online', from: 'customer', to: 'ledger' });
    expect(messages[0]).toBe('{"customer -> web":"Banks online [HTTPS]"}');
    expect(Object.values(data.participants).map((p: any) => p.ref)).toEqual(['customer', 'online.web', 'online.api', 'ledger']);
  });

  it('names what goes wrong', async () => {
    const t = await traceable(read('examples/systems/web-shop.yaml'));
    expect(traceAsk(t, { from: 'db', to: 'customers' }).error).toBe('No request goes from Orders DB to Users along the arrows; one goes the other way: trace from customers to db');
    expect(traceAsk(t, { from: 'nope', to: 'db' }).error).toBe('There is no element "nope"');
    expect(traceAsk(t, { from: 'Orders DB', to: 'orders' }).error).toContain('No request goes');
    expect(traceAsk(t, { from: 'Storefront', to: 'Orders DB' }).options[0]!.ids[0]).toBe('web');
  });
});

describe('until each call ends', () => {
  it('follows a booking out to the stores and external systems: a router as alternatives, a topic in parallel', async () => {
    const { r, data, yaml } = await traced('examples/systems/saas-platform.yaml', { from: 'guests' });
    expect(r.mode).toBe('until');
    expect(r.options[0]!.notes).toEqual([
      'ALB passes each request on to one of Bookings, Availability search: drawn as an alt frame',
      'booking-events sends to Billing, Notifier without waiting: drawn as a par frame',
    ]);
    const alt = data.messages.find((m: any) => m.alt);
    expect(alt.alt).toBe('Bookings');
    expect(Object.keys(alt.else)).toEqual(['Availability search']);
    const par = alt.messages.find((m: any) => m.par);
    expect(par.messages[0]).toBe('events ->> billing');
    expect(par.and.Notifier[0]).toBe('events ->> notify');
    expect(yaml).toContain('# booking-events sends to Billing, Notifier without waiting: drawn as a par frame.');
    expect(data.messages.at(-1)).toBe('app --> guests');
  });

  it('notices a loop and does not follow it', async () => {
    const text = `type: systems
nodes:
  a: { kind: service, label: A }
  b: { kind: service, label: B }
  c: { kind: service, label: C }
  db: { kind: database, label: DB }
edges:
  - a -> b: asks
  - b -> c: asks
  - c -> a: calls back
  - c -> db: reads
`;
    const t = await traceable(text);
    const r = traceAsk(t, { from: 'a' });
    expect(r.options[0]!.notes).toEqual(['C calls back into A: drawn once, the loop is not followed']);
    const seq = parse(sequenceYaml(t.graph, r.options[0]!, { mode: 'until', from: 'a' }));
    expect(seq.messages).toEqual([
      { 'a -> b': 'asks' },
      { 'b -> c': 'asks' },
      { 'c -> a': 'calls back' },
      { note: 'Already busy with this request: the loop is not followed', over: 'a' },
      'a --> c',
      { 'c -> db': 'reads' },
      'db --> c',
      'c --> b',
      'b --> a',
    ]);
  });

  it('walks lines without a direction either way, but not back where it came from', async () => {
    const text = `type: systems
nodes:
  web: { kind: client, label: web }
  api: { kind: service, label: api }
  db: { kind: database, label: db }
edges:
  - web -- api
  - api -- db
`;
    const t = await traceable(text);
    expect(traceAsk(t, { from: 'db', to: 'web' }).options[0]!.summary).toBe('db → api → web');
    expect(traceAsk(t, { from: 'web' }).options[0]!.calls.map((c) => `${c.from}>${c.to}`)).toEqual(['web>api', 'api>db']);
  });
});

describe('along steps', () => {
  it('tells a dynamic view as a sequence: async through the queue, replies for the calls', async () => {
    const { data, messages } = await traced('examples/c4/kestrel-bank.yaml', { steps: true }, 'payment');
    expect(data.title).toBe('Making a transfer');
    expect(messages).toContain('{"events ->> bus":"Publishes PaymentMade [Kafka]"}');
    expect(messages).toContain('{"bus ->> notifier":"Delivers the event"}');
    expect(messages.filter((m) => m.includes('-->'))).toEqual(['ledger --> api-ledger', 'api-ledger --> payments', 'push --> notifier', 'events --> payments', 'payments --> app', 'app --> customer']);
  });

  it('tells written steps, a divider each, the last step answered before the next starts', async () => {
    const { messages } = await traced('examples/azure/web-shop.yaml', { steps: true });
    expect(messages).toEqual([
      '{"divider":"A customer opens the shop"}',
      '{"users -> edge":"HTTPS"}',
      '{"edge -> web":"HTTPS"}',
      '{"divider":"Placing an order is a private REST…"}',
      '{"web -> api":"REST"}',
      '{"divider":"Orders are stored"}',
      '{"api -> db":"SQL"}',
      'db --> api',
      '{"divider":"No secrets in code"}',
      '{"api -> vault":"secrets"}',
      'vault --> api',
      'api --> web',
      'web --> edge',
      'edge --> users',
    ]);
  });

  it('draws one step to several places at once as a par frame', async () => {
    const text = `type: systems
nodes:
  api: service
  db: database
  cache: cache
edges:
  - api -> db
  - api -> cache
steps:
  - title: Write through
    path: [api -> db, api -> cache]
`;
    const t = await traceable(text);
    const r = traceAsk(t, { steps: true });
    const seq = parse(sequenceYaml(t.graph, r.options[0]!, { mode: 'steps' }));
    expect(seq.messages).toEqual([{ par: 'Database', messages: ['api -> db', 'db --> api'], and: { Cache: ['api -> cache', 'cache --> api'] } }]);
  });
});

describe('back from the sequence', () => {
  it('gives short ids that do not clash', () => {
    expect([...participantIds(['ledger', 'online.api.ledger', 'online.web', 'x.web']).values()]).toEqual(['ledger', 'api-ledger', 'online-web', 'x-web']);
  });

  it('is a drawing of the model elements in the workspace: where-used finds it, nothing dangles', async () => {
    const { yaml } = await traced('examples/workspace/containers.yaml', { from: 'customer', to: 'swift' });
    const dir = path.join(root, 'examples/workspace');
    const files: [string, string][] = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml')).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]);
    const ix = indexWorkspace([...files, ['trace.yaml', yaml]]);
    expect(ix.problems.filter((p) => p.file === 'trace.yaml')).toEqual([]);
    const uses = ix.uses.get('payments.engine')!.filter((u) => u.file === 'trace.yaml');
    // Named by its ref:, and drawn there under the participant's id.
    expect(uses.map((u) => [u.how, u.node])).toEqual([['ref', undefined], ['shown', 'engine']]);
  });

  it('a trace of a diagram without a model points at its nodes without a problem', async () => {
    const { yaml } = await traced('examples/systems/web-shop.yaml', { from: 'customers', to: 'db' });
    const ix = indexWorkspace([['web-shop.yaml', read('examples/systems/web-shop.yaml')], ['trace.yaml', yaml]]);
    expect(ix.problems).toEqual([]);
  });
});
