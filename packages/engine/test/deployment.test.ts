// Deployments of a model: `of:` on a node (it runs that element), `env:` with a view's
// `environment:`, and `complete:`.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render } from '../src/index.ts';

const model = `type: model
elements:
  customer: { kind: person, label: Customer }
  shop:
    kind: system
    label: Web shop
    elements:
      web: { kind: client, label: Storefront, technology: React }
      api: { kind: api, label: Orders API, technology: .NET 9, description: Places orders, tags: [core] }
      db: { kind: database, label: Orders DB, technology: PostgreSQL 16 }
      bus: { kind: queue, label: order-events }
  stripe: { kind: payments, label: Stripe, tags: [external] }
relations:
  - customer -> shop.web: Orders
  - shop.web -> shop.api: REST
  - shop.api -> shop.db: SQL
  - shop.api -> shop.bus: OrderPlaced
  - shop.api -> stripe: Charges
views:
  context: { kind: context, of: shop }
  containers: { kind: container, of: shop }
`;

const load = (f: string) => {
  if (f !== 'model.yaml') throw new Error(`No file ${f}`);
  return model;
};
const draw = (text: string, view?: string) => render(text, { load, fonts: 'none', view });
const node = (r: Awaited<ReturnType<typeof render>>, id: string) => r.graph!.nodes.find((n) => n.id === id)!;
const ids = (r: Awaited<ReturnType<typeof render>>) => ({
  nodes: r.graph!.nodes.map((n) => n.id),
  groups: r.graph!.groups.map((g) => g.id),
  edges: r.graph!.edges.map((e) => `${e.from.node}>${e.to.node}${e.label ? `:${e.label}` : ''}`),
});
const messages = (r: Awaited<ReturnType<typeof render>>) => r.diagnostics.map((d) => [d.severity, d.line, d.message]);

describe('of: a node runs a model element', () => {
  it('takes the name and technology, keeps its own kind, and links back to the model', async () => {
    const r = await draw(`type: azure
include: [model.yaml]
nodes:
  api: { of: shop.api, kind: container-app }
  db: { of: shop.db, kind: postgres, label: psql-orders }
  bus: { of: shop.bus }
`);
    expect(r.diagnostics).toEqual([]);
    // What it runs on, then what it is built with.
    expect(node(r, 'api').shape).toMatchObject({ label: 'Orders API', caption: 'Container App · .NET 9', icon: 'container' });
    // Its own name on top, the element's below; "PostgreSQL · PostgreSQL 16" would say it twice.
    expect(node(r, 'db').shape).toMatchObject({ label: 'psql-orders', caption: 'Orders DB · PostgreSQL 16' });
    // Without a kind of its own, the element's kind in this type's words.
    expect(node(r, 'bus').shape).toMatchObject({ label: 'order-events', caption: 'Service Bus' });
    expect(node(r, 'api').description).toBe('Runs Orders API (shop.api): Places orders');
    expect(node(r, 'api').links).toEqual([{ kind: 'view', target: 'model.yaml#containers', file: 'model.yaml', view: 'containers', label: 'Orders API in the model' }]);
    // The model's relations run between what runs their ends; nothing else of the model comes along.
    expect(ids(r)).toEqual({ nodes: ['api', 'db', 'bus'], groups: [], edges: ['api>db:SQL', 'api>bus:OrderPlaced'] });
  });

  it('keeps written links, and says nothing twice', async () => {
    const r = await draw(`type: azure
include: [model.yaml]
nodes:
  api: { of: shop.api, kind: container-app, caption: ca-orders, description: West Europe, links: ['https://portal.azure.com', 'model.yaml#containers'] }
`);
    expect(node(r, 'api').shape).toMatchObject({ label: 'Orders API', caption: 'ca-orders' });
    expect(node(r, 'api').description).toBe('West Europe');
    expect(node(r, 'api').links!.map((l) => l.target)).toEqual(['https://portal.azure.com', 'model.yaml#containers']);
  });

  it('one element can run in several places: relations go to the nearest instance', async () => {
    const r = await draw(`type: cloud
provider: aws
include: [model.yaml]
groups:
  vpc: { kind: vpc }
  a: { kind: zone, in: vpc }
  b: { kind: zone, in: vpc }
nodes:
  api-a: { of: shop.api, kind: ecs, in: a }
  api-b: { of: shop.api, kind: ecs, in: b }
  db-a: { of: shop.db, kind: rds, in: a }
  db-b: { of: shop.db, kind: rds, in: b }
  queue: { of: shop.bus, kind: sqs }
`);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(node(r, 'api-b').shape).toMatchObject({ label: 'Orders API', caption: 'ECS service · .NET 9' });
    expect(ids(r).edges.sort()).toEqual(['api-a>db-a:SQL', 'api-a>queue:OrderPlaced', 'api-b>db-b:SQL', 'api-b>queue:OrderPlaced']);
  });

  it('with one database for two zones, both instances talk to it', async () => {
    const r = await draw(`type: cloud
provider: aws
include: [model.yaml]
groups:
  vpc: { kind: vpc }
  a: { kind: zone, in: vpc }
  b: { kind: zone, in: vpc }
nodes:
  api-a: { of: shop.api, kind: ecs, in: a }
  api-b: { of: shop.api, kind: ecs, in: b }
  db: { of: shop.db, kind: rds, in: a }
`);
    expect(ids(r).edges.sort()).toEqual(['api-a>db:SQL', 'api-b>db:SQL']);
  });

  it('a relation the written lines already carry is not drawn again', async () => {
    const text = `type: cloud
provider: aws
include: [model.yaml]
nodes:
  cdn: { of: shop.web, kind: cloudfront }
  alb: { kind: alb }
  api: { of: shop.api, kind: ecs }
  db: { of: shop.db, kind: rds }
edges:
  - cdn -> alb
  - alb -> api
  - api -> db: { label: TLS, style: private }
`;
    const r = await draw(text);
    // Storefront → Orders API goes through the load balancer; the written line to the database wins.
    expect(ids(r).edges).toEqual(['cdn>alb', 'alb>api', 'api>db:TLS']);
    const direct = await draw(text.replace('  - cdn -> alb\n', ''));
    expect(ids(direct).edges).toEqual(['alb>api', 'api>db:TLS', 'cdn>api:REST']);
  });

  it('works next to ref: in one drawing, and a view can leave relations out by element', async () => {
    const text = `type: azure
include: [model.yaml]
nodes:
  customer: { ref: customer }
  web: { of: shop.web, kind: static-web-app }
  api: { of: shop.api, kind: container-app }
  db: { of: shop.db, kind: postgres }
views:
  all: {}
  quiet: { exclude: ['shop.api -> shop.db'] }
`;
    const all = await draw(text, 'all');
    expect(all.diagnostics).toEqual([]);
    expect(ids(all)).toEqual({ nodes: ['customer', 'web', 'api', 'db'], groups: [], edges: ['customer>web:Orders', 'web>api:REST', 'api>db:SQL'] });
    expect(ids(await draw(text, 'quiet')).edges).toEqual(['customer>web:Orders', 'web>api:REST']);
  });

  it('reports ids that do not exist, a missing model, and ref: together with of:', async () => {
    const r = await draw(`type: azure
include: [model.yaml]
nodes:
  api: { of: shop.nope, kind: container-app }
  db: { ref: shop.db, of: shop.db }
`);
    expect(messages(r)).toEqual([
      ['error', 4, 'There is no element "shop.nope" in the model'],
      ['error', 5, '"db" has ref: (it is the element) and of: (it runs the element): keep one of them'],
    ]);
    const none = await draw('type: azure\nnodes:\n  api: { of: shop.api, kind: container-app }\n');
    expect(messages(none)).toEqual([['error', 3, '"shop.api" needs a model: add include: [model.yaml] or elements:']]);
  });

  it('on a Kubernetes workload keeps the workload’s own details', async () => {
    const r = await draw(`type: kubernetes
include: [model.yaml]
groups:
  shop: { kind: namespace }
nodes:
  api: { of: shop.api, kind: deployment, in: shop, replicas: 3 }
  db: { of: shop.db, kind: statefulset, in: shop }
`);
    expect(r.diagnostics).toEqual([]);
    expect(node(r, 'api').shape).toMatchObject({ label: 'Orders API', caption: 'Deployment · .NET 9 · ×3' });
    expect(node(r, 'db').shape).toMatchObject({ label: 'Orders DB', caption: 'StatefulSet · PostgreSQL 16' });
    expect(ids(r).edges).toEqual(['api>db:SQL']);
  });
});

describe('environments', () => {
  const text = `type: azure
include: [model.yaml]
groups:
  rg: { kind: resource-group }
  dr: { kind: resource-group, label: rg-dr, env: prod }
nodes:
  door: { kind: front-door, env: prod }
  web: { of: shop.web, kind: static-web-app, in: rg }
  api: { of: shop.api, kind: container-app, in: rg }
  api-dr: { of: shop.api, kind: container-app, in: dr }
  db: { of: shop.db, kind: postgres, in: rg }
  vault: { kind: key-vault, in: rg, env: [test, prod] }
  seed: { kind: function-app, label: Test data, in: rg, env: dev }
edges:
  - door -> web
  - api -> vault
  - seed -> db: { label: fills, env: dev }
  - web -> api: { label: mocked, env: dev }
views:
  prod: { environment: prod }
  test: { environment: test }
  dev: { environment: dev }
  staging: { environment: staging }
`;

  it('a view draws what its environment has: entries, what sits in a group, and lines', async () => {
    const prod = await draw(text, 'prod');
    expect(prod.diagnostics).toEqual([]);
    expect(ids(prod)).toEqual({
      nodes: ['door', 'web', 'api', 'api-dr', 'db', 'vault'],
      groups: ['rg', 'dr'],
      // The storefront calls the Orders API beside it, not the copy in the other resource group; both reach the one database.
      edges: ['door>web', 'api>vault', 'web>api:REST', 'api>db:SQL', 'api-dr>db:SQL'],
    });
    const test = await draw(text, 'test');
    expect(ids(test)).toEqual({ nodes: ['web', 'api', 'db', 'vault'], groups: ['rg'], edges: ['api>vault', 'web>api:REST', 'api>db:SQL'] });
    const dev = await draw(text, 'dev');
    // The line written for dev replaces the model's relation there.
    expect(ids(dev)).toEqual({ nodes: ['web', 'api', 'db', 'seed'], groups: ['rg'], edges: ['seed>db:fills', 'web>api:mocked', 'api>db:SQL'] });
  });

  it('without a view everything is drawn', async () => {
    const r = await draw(text);
    expect(ids(r).nodes).toEqual(['door', 'web', 'api', 'api-dr', 'db', 'vault', 'seed']);
  });

  it('an environment nothing is tagged for is what is left without the extras', async () => {
    const r = await draw(text, 'staging');
    expect(r.diagnostics).toEqual([]);
    // What has no env: is in every environment.
    expect(ids(r).nodes).toEqual(['web', 'api', 'db']);
  });

  it('warns when there is nothing to filter on', async () => {
    const r = await draw('type: azure\nnodes:\n  api: container-app\nviews:\n  prod: { environment: prod }\n', 'prod');
    expect(messages(r)).toEqual([['warning', 5, 'Nothing here has env:, so environment: prod leaves nothing out']]);
  });
});

describe('complete: every part runs somewhere', () => {
  const text = (views: string) => `type: azure
include: [model.yaml]
nodes:
  web: { of: shop.web, kind: static-web-app }
  api: { of: shop.api, kind: container-app }
  db: { of: shop.db, kind: postgres, env: prod }
views:
${views}`;

  it('warns about parts nothing runs, per environment; people and what is external do not count', async () => {
    const views = '  prod: { environment: prod, complete: true }\n  dev: { environment: dev, complete: true }\n';
    expect(messages(await draw(text(views), 'prod'))).toEqual([['warning', 8, 'Nothing runs "shop.bus" (order-events) in prod: add a node with of: shop.bus']]);
    expect(messages(await draw(text(views), 'dev'))).toEqual([
      ['warning', 9, 'Nothing runs "shop.db" (Orders DB) in dev: add a node with of: shop.db'],
      ['warning', 9, 'Nothing runs "shop.bus" (order-events) in dev: add a node with of: shop.bus'],
    ]);
  });

  it('can name what has to run, and says so when a name is wrong', async () => {
    const r = await draw(text('  dev: { environment: dev, complete: [shop.web, shop.api, shop.nope] }\n'), 'dev');
    expect(messages(r)).toEqual([['warning', 8, 'There is no element "shop.nope" in the model']]);
    const all = await draw(text('  all: { complete: shop }\n'), 'all');
    expect(messages(all)).toEqual([['warning', 8, 'Nothing runs "shop.bus" (order-events) in this view: add a node with of: shop.bus']]);
  });

  it('a node that is the element (ref:) counts too', async () => {
    const r = await draw(`type: azure
include: [model.yaml]
nodes:
  web: { of: shop.web, kind: static-web-app }
  api: { of: shop.api, kind: container-app }
  db: { ref: shop.db }
  bus: { ref: shop.bus }
views:
  all: { complete: true }
`, 'all');
    expect(r.diagnostics).toEqual([]);
  });
});

describe('a C4 deployment view', () => {
  const c4 = (nodes: string, extra = '') => `type: c4
elements:
  shop:
    kind: software-system
    label: Web shop
    elements:
      api: { kind: container, label: Orders API, technology: .NET 9 }
      db: { kind: database, label: Orders DB, technology: PostgreSQL 16 }
relations:
  - shop.api -> shop.db: { label: Reads and writes, technology: SQL }
views:
  prod:
    kind: deployment${extra}
    nodes:
${nodes}`;

  it('a node can be the instance itself', async () => {
    const r = await render(c4(`      aws:
        technology: eu-west-1
        nodes:
          ecs: { technology: Fargate, instances: [shop.api] }
          rds: { of: shop.db, technology: RDS, count: 2 }
`), { fonts: 'none', view: 'prod' });
    expect(r.diagnostics).toEqual([]);
    expect(ids(r)).toEqual({ nodes: ['rds', 'shop.api'], groups: ['aws', 'ecs'], edges: ['shop.api>rds:Reads and writes [SQL]'] });
    expect(node(r, 'rds').shape).toMatchObject({ label: 'Orders DB' });
    expect((node(r, 'rds').shape as { caption?: string }).caption).toContain('RDS');
    expect((node(r, 'rds').shape as { caption?: string }).caption).toContain('×2');
  });

  it('warns about of: ids that do not exist, and about what is not deployed when complete', async () => {
    const r = await render(c4(`      aws:
        nodes:
          ecs: { instances: [shop.api] }
          rds: { of: shop.nope }
`, '\n    complete: true'), { fonts: 'none', view: 'prod' });
    expect(r.diagnostics.map((d) => [d.severity, d.message])).toEqual([
      ['warning', 'There is no element "shop.nope" in the model'],
      ['warning', 'Nothing runs "shop.db" (Orders DB) in this view: add it to instances: or a node with of: shop.db'],
    ]);
  });
});

describe('examples/deployment', () => {
  const dir = path.resolve(import.meta.dirname, '../../../examples/deployment');
  const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');
  const show = (f: string, view?: string) => render(read(f), { load: read, fonts: 'none', file: f, view });

  it('one model, on Azure and on AWS, an environment per view', async () => {
    const counts: Record<string, number[]> = {};
    for (const f of ['azure.yaml', 'aws.yaml'])
      for (const view of ['prod', 'test', 'dev']) {
        const r = await show(f, view);
        expect(r.diagnostics, `${f}#${view}`).toEqual([]);
        (counts[f] ??= []).push(r.graph!.nodes.length);
      }
    expect(counts).toEqual({ 'azure.yaml': [9, 7, 6], 'aws.yaml': [11, 8, 6] });
  }, 30_000);

  it('production on AWS runs the Orders API in both zones, each behind its own load balancer', async () => {
    const r = await show('aws.yaml', 'prod');
    const apis = r.graph!.nodes.filter((n) => n.shape.kind === 'card' && n.shape.label === 'Orders API');
    expect(apis.map((n) => [n.id, n.parent])).toEqual([['api-a', 'app-a'], ['api-b', 'app-b']]);
    expect(apis[0]!.links!.map((l) => l.target)).toEqual(['model.yaml#containers']);
    const edges = ids(r).edges;
    // Both write to the one database; the storefront reaches them through the load balancers.
    expect(edges).toContain('api-a>db:Reads and writes [SQL]');
    expect(edges).toContain('api-b>db:Reads and writes [SQL]');
    expect(edges.filter((e) => e.startsWith('cdn>api'))).toEqual([]);
  });

  it('the model links to both deployments', async () => {
    const r = await show('model.yaml', 'containers');
    expect(r.diagnostics).toEqual([]);
    expect(r.graph!.groups.find((g) => g.id === 'shop')!.links!.map((l) => [l.target, l.label])).toEqual([
      ['azure.yaml#prod', 'Production on Azure'],
      ['aws.yaml#prod', 'Production on AWS'],
    ]);
  });
});
