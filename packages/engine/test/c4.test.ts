import { describe, expect, it } from 'vitest';
import { render } from '../src/index.ts';

const model = `type: c4
elements:
  customer: { kind: person, label: Customer, description: Buys things }
  staff: { kind: person, label: Staff }
  shop:
    label: Web shop
    description: Sells things
    elements:
      web: { kind: web-app, label: Storefront, technology: React }
      api:
        label: Orders API
        technology: Spring Boot
        elements:
          orders: { label: Orders controller }
          repo: { label: Order repository, technology: JPA }
      db: { kind: database, label: Orders DB, technology: PostgreSQL }
      worker: { label: Mailer, technology: Go }
  stripe: { label: Stripe, external: true }
  erp: { label: ERP }
relations:
  - customer -> shop.web: { label: Orders, technology: HTTPS }
  - shop.web -> shop.api: { label: Calls, technology: JSON }
  - shop.web -> shop.api.orders: Places orders
  - shop.api.orders -> shop.api.repo: Saves
  - shop.api.repo -> shop.db: { label: Writes, technology: SQL }
  - shop.api.orders -> stripe: Charges
  - staff -> erp: Books
views:
  landscape: { kind: landscape, enterprise: Shop Inc }
  context: { kind: context, of: shop }
  containers: { kind: container, of: shop }
  components: { kind: component, of: shop.api }
  checkout:
    kind: dynamic
    steps:
      - customer -> shop.web: Checks out
      - shop.web -> shop.api.orders: { label: Places the order, technology: JSON }
      - shop.api.orders -> stripe: Charges
  prod:
    kind: deployment
    nodes:
      aws:
        technology: eu-west-1
        nodes:
          lb: { kind: load-balancer, label: ALB }
          eks: { label: EKS, technology: Kubernetes, nodes: { api-pod: { count: 3, instances: [shop.api, shop.web] } } }
          rds: { technology: PostgreSQL, instances: [shop.db] }
    edges:
      - lb -> shop.web: HTTPS
`;

const view = (name: string) => render(model, { fonts: 'none', view: name });
const ids = (r: Awaited<ReturnType<typeof render>>) => ({
  nodes: r.graph!.nodes.map((n) => n.id).sort(),
  groups: r.graph!.groups.map((g) => g.id).sort(),
  edges: r.graph!.edges.map((e) => `${e.from.node}>${e.to.node}${e.label ? `:${e.label}` : ''}`).sort(),
});

describe('C4 views', () => {
  it('context: the element and what it talks to directly, lifted to the top', async () => {
    const r = await view('context');
    expect(r.diagnostics).toEqual([]);
    expect(ids(r)).toEqual({ nodes: ['customer', 'shop', 'stripe'], groups: [], edges: ['customer>shop:Orders [HTTPS]', 'shop>stripe:Charges'] });
  });

  it('container: the element opened up, with its outside neighbours; exact relations win over implied ones', async () => {
    const r = await view('containers');
    expect(ids(r)).toEqual({
      nodes: ['customer', 'shop.api', 'shop.db', 'shop.web', 'shop.worker', 'stripe'],
      groups: ['shop'],
      edges: ['customer>shop.web:Orders [HTTPS]', 'shop.api>shop.db:Writes [SQL]', 'shop.api>stripe:Charges', 'shop.web>shop.api:Calls [JSON]'],
    });
  });

  it('component: the container inside its system, with only the siblings that take part', async () => {
    const r = await view('components');
    expect(ids(r).groups).toEqual(['shop', 'shop.api']);
    expect(ids(r).nodes).toEqual(['shop.api.orders', 'shop.api.repo', 'shop.db', 'shop.web', 'stripe']);
    // "Calls" to the opened container says less than "Places orders" to its controller: only that one is drawn.
    expect(ids(r).edges.filter((e) => e.startsWith('shop.web>'))).toEqual(['shop.web>shop.api.orders:Places orders']);
  });

  it('landscape: everything at the top, the internal part in an enterprise boundary', async () => {
    const r = await view('landscape');
    const parent = Object.fromEntries(r.graph!.nodes.map((n) => [n.id, n.parent]));
    expect(parent).toEqual({ customer: 'enterprise', staff: 'enterprise', shop: 'enterprise', stripe: undefined, erp: 'enterprise' });
    expect(r.graph!.groups[0]).toMatchObject({ id: 'enterprise', label: 'Shop Inc', caption: '[Enterprise]', border: 'dashed' });
  });

  it('cards say what they are, C4 style, and externals are greyed', async () => {
    const r = await view('containers');
    const card = (id: string) => r.graph!.nodes.find((n) => n.id === id)!.shape;
    expect(card('shop.api')).toMatchObject({ caption: '[Container: Spring Boot]' });
    expect(card('shop.db')).toMatchObject({ caption: '[Container: PostgreSQL]', icon: 'database' });
    expect(card('customer')).toMatchObject({ caption: '[Person]', body: 'Buys things', form: 'person' });
    expect(card('stripe')).toMatchObject({ caption: '[Software System]', muted: true, tone: 'slate' });
    expect(r.graph!.groups[0]).toMatchObject({ caption: '[Software System]', border: 'dashed' });
    expect(r.graph!.legend!.map((l) => l.label)).toEqual(['Person', 'External system', 'Container', 'Web app', 'Database', 'Boundary', 'Relationship']);
  });

  it('drill-down: cards link to the next view about them', async () => {
    expect((await view('landscape')).graph!.nodes.find((n) => n.id === 'shop')!.links).toEqual([{ kind: 'view', target: '#context', file: '', view: 'context' }]);
    expect((await view('context')).graph!.nodes.find((n) => n.id === 'shop')!.links?.[0]?.view).toBe('containers');
    expect((await view('containers')).graph!.nodes.find((n) => n.id === 'shop.api')!.links?.[0]?.view).toBe('components');
  });

  it('dynamic: numbered steps only, inside the boundaries they belong to', async () => {
    const r = await view('checkout');
    expect(ids(r)).toEqual({
      nodes: ['customer', 'shop.api.orders', 'shop.web', 'stripe'],
      groups: ['shop', 'shop.api'],
      edges: ['customer>shop.web:Checks out', 'shop.api.orders>stripe:Charges', 'shop.web>shop.api.orders:Places the order [JSON]'],
    });
    expect(r.graph!.steps!.map((s) => [s.n, s.from, s.to])).toEqual([
      [1, 'customer', 'shop.web'],
      [2, 'shop.web', 'shop.api.orders'],
      [3, 'shop.api.orders', 'stripe'],
    ]);
    expect(r.graph!.edges.map((e) => e.step)).toEqual([1, 2, 3]);
    expect(r.svg).toContain('>Charges<');
  });

  it('deployment: nested nodes with technology, instances of model elements, relations between them', async () => {
    const r = await view('prod');
    expect(r.diagnostics).toEqual([]);
    expect(ids(r)).toEqual({
      nodes: ['lb', 'shop.api', 'shop.db', 'shop.web'],
      groups: ['api-pod', 'aws', 'eks', 'rds'],
      edges: ['lb>shop.web:HTTPS', 'shop.api>shop.db:Writes [SQL]', 'shop.web>shop.api:Calls [JSON]'],
    });
    const g = Object.fromEntries(r.graph!.groups.map((x) => [x.id, x]));
    expect(g.eks).toMatchObject({ parent: 'aws', caption: '[Deployment Node: Kubernetes]', border: 'solid' });
    expect(g['api-pod']!.caption).toBe('[Deployment Node] ×3');
    expect(r.graph!.nodes.find((n) => n.id === 'lb')!.shape).toMatchObject({ caption: '[Infrastructure Node]' });
  });

  it('deployment: a relation written with via: goes through that node instead of straight', async () => {
    const via = (edge: string) => render(model.replace('      - lb -> shop.web: HTTPS\n', `      - lb -> shop.web: HTTPS\n      - ${edge}\n`), { fonts: 'none', view: 'prod' });
    const r = await via('shop.web -> shop.api: { via: lb }');
    expect(r.diagnostics).toEqual([]);
    // The model's label goes on the first hop.
    expect(ids(r).edges).toEqual(['lb>shop.api', 'lb>shop.web:HTTPS', 'shop.api>shop.db:Writes [SQL]', 'shop.web>lb:Calls [JSON]']);
    // A label written with it wins; a line written from the node on stays as written.
    const own = await via('shop.web -> shop.api: { via: lb, label: Calls via the ALB }\n      - lb -> shop.api: Forwards');
    expect(ids(own).edges).toEqual(['lb>shop.api:Forwards', 'lb>shop.web:HTTPS', 'shop.api>shop.db:Writes [SQL]', 'shop.web>lb:Calls via the ALB']);
    const wrong = await via('shop.web -> shop.api: { via: nope }');
    expect(wrong.diagnostics.map((d) => d.message)).toContain('"nope" is not a deployment node or an element that runs in this view');
  });

  it('a model file with C4 views draws in C4 notation', async () => {
    const r = await render(model.replace('type: c4', 'type: model'), { fonts: 'none', view: 'context' });
    expect(r.type!.id).toBe('c4');
    expect(r.graph!.nodes.find((n) => n.id === 'shop')!.shape).toMatchObject({ caption: '[Software System]', body: 'Sells things' });
  });

  it('warns about a view without its element', async () => {
    const r = await render(model.replace('context: { kind: context, of: shop }', 'context: { kind: context, of: nope }'), { fonts: 'none', view: 'context' });
    expect(r.diagnostics.map((d) => d.message)).toContain('There is no element "nope" in the model');
  });
});
