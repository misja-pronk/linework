import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TableShape } from '@linework/core';
import { tableGrid } from '@linework/render';
import { themes } from '@linework/theme';
import { render } from '../src/index.ts';

const source = (extra = '') => `type: data-products
${extra}
sources:
  shop: database
products:
  orders:
    inputs: [{ from: shop, label: CDC }]
    outputs:
      orders: { kind: table, contract: orders }
      events: stream
  revenue:
    class: consumer-aligned
    inputs: [orders.orders, orders.events]
consumers:
  bi: { kind: dashboard, uses: [revenue] }
contracts:
  orders:
    version: 2
    fields: { id: uuid pk, email: string pii }
    sla: { freshness: 1 hour }
`;

describe('data products', () => {
  it('draws cards and one line per product pair in the overview', async () => {
    const r = await render(source(), { fonts: 'none' });
    expect(r.diagnostics).toEqual([]);
    expect(r.graph!.nodes.map((n) => n.shape.kind)).toEqual(['card', 'card', 'card', 'card']);
    const lines = r.graph!.edges.filter((e) => e.from.node === 'orders' && e.to.node === 'revenue');
    expect(lines).toHaveLength(1);
    expect(r.graph!.edges.find((e) => e.from.node === 'shop')!.label).toBe('CDC');
  });

  it('attaches lines to ports and shows contracts in detail', async () => {
    const r = await render(source('view: detailed'), { fonts: 'none' });
    expect(r.diagnostics).toEqual([]);
    const flows = r.graph!.edges.filter((e) => e.to.node === 'revenue');
    expect(flows.map((e) => [e.from.row, e.to.row])).toEqual([['out:orders', 'in:0'], ['out:events', 'in:1']]);
    const contract = r.graph!.nodes.find((n) => n.id === 'contract:orders')!.shape as TableShape;
    expect(contract.caption).toBe('Data contract · v2');
    expect(contract.rows.find((x) => x.kind === 'row' && x.id === 'field:0:email')).toMatchObject({ marks: ['pii'] });
    expect(r.graph!.edges.some((e) => e.to.node === 'contract:orders' && e.line === 'dashed')).toBe(true);
  });

  it('shows only the products asked for in detail', async () => {
    const r = await render(source('detail: [revenue]'), { fonts: 'none' });
    const kinds = Object.fromEntries(r.graph!.nodes.map((n) => [n.id, n.shape.kind]));
    expect(kinds).toEqual({ shop: 'card', orders: 'card', revenue: 'table', bi: 'card' });
    expect(r.graph!.nodes.some((n) => n.id.startsWith('contract:'))).toBe(false);
  });

  it('reports unknown ports and contracts on their line', async () => {
    const text = source().replace('orders.events]', 'orders.missing]').replace('contract: orders }', 'contract: nope }');
    const r = await render(text, { fonts: 'none' });
    expect(r.diagnostics.map((d) => [d.line, d.message])).toEqual([
      [13, 'Product "orders" has no output port "missing"'],
      [9, 'There is no data contract "nope"'],
    ]);
  });
});

describe('schema messages', () => {
  it('points at the wrong field, not at the short form', async () => {
    const r = await render('type: data-products\nconsumers:\n  bi: { kind: dashboard, inputs: [x] }\n', { fonts: 'none' });
    expect(r.diagnostics.map((d) => d.message)).toEqual([expect.stringMatching(/inputs/)]);
  });

  it('offers overview and detailed as views: asked for, a view wins over the one written, focus included', async () => {
    // Without a contract nothing is tall: one detailed drawing of every product.
    const plain = await render(source('view: overview').replace('{ kind: table, contract: orders }', 'table'), { fonts: 'none' });
    expect(plain.views).toEqual([
      { name: 'overview', title: 'Overview' },
      { name: 'detailed', title: 'Detailed' },
    ]);
    // Two products and a contract among them: one product at a time, every one only by name.
    const r = await render(source('view: overview'), { fonts: 'none' });
    expect(r.views).toEqual([
      { name: 'overview', title: 'Overview' },
      { name: 'detailed-orders', title: 'orders in detail' },
      { name: 'detailed-revenue', title: 'revenue in detail' },
    ]);
    const d = await render(source('view: overview'), { fonts: 'none', view: 'detailed' });
    expect(d.diagnostics).toEqual([]);
    expect(d.view).toBe('detailed');
    expect(d.graph!.nodes.some((n) => n.id.startsWith('contract:'))).toBe(true);
    // A focus on a detailed drawing stays detailed: both views are elements and lines.
    const f = await render(source('view: detailed'), { fonts: 'none', focus: 'orders' });
    expect(f.graph!.nodes.some((n) => n.id.startsWith('contract:'))).toBe(true);
  });
});

describe('detailed views per domain', () => {
  const mesh = `type: data-products
domains:
  sales: Sales
  finance: Finance
sources:
  shop: { kind: database, domain: sales }
products:
  orders:
    domain: sales
    inputs: [shop]
    outputs:
      orders: { kind: table, contract: orders }
  revenue:
    domain: finance
    inputs: [orders]
  rates: {}
  forecast:
    domain: sales
    inputs: [rates]
consumers:
  cfo: { kind: dashboard, uses: [revenue] }
contracts:
  orders:
    fields: { id: uuid pk }
steps:
  - title: From the shop to the CFO
    path: [shop -> orders, orders -> revenue, revenue -> cfo]
`;

  it('offers one detailed view per domain, and one per product where a domain holds several and a contract; the rest only by name', async () => {
    const r = await render(mesh, { fonts: 'none' });
    expect(r.views).toEqual([
      { name: 'overview', title: 'Overview' },
      { name: 'detailed-orders', title: 'orders in detail' },
      { name: 'detailed-forecast', title: 'forecast in detail' },
      { name: 'detailed-finance', title: 'Finance in detail' },
      { name: 'detailed-other', title: 'Other products in detail' },
    ]);
    const whole = await render(mesh, { fonts: 'none', view: 'detailed' });
    expect(whole.diagnostics).toEqual([]);
    expect(whole.graph!.nodes.filter((n) => n.shape.kind === 'table').map((n) => n.id)).toEqual(['orders', 'revenue', 'rates', 'forecast', 'contract:orders']);
    // The domain drawn whole is still there by name.
    const sales = await render(mesh, { fonts: 'none', view: 'detailed-sales' });
    expect(sales.diagnostics).toEqual([]);
    expect(sales.graph!.nodes.filter((n) => n.shape.kind === 'table').map((n) => n.id)).toEqual(['orders', 'forecast', 'contract:orders']);
    // Without contracts drawn nothing is split.
    const bare = await render(mesh.replace('domains:', 'show-contracts: false\ndomains:'), { fonts: 'none' });
    expect(bare.views!.map((v) => v.name)).toEqual(['overview', 'detailed-sales', 'detailed-finance', 'detailed-other']);
  });

  it('draws one product in detail with its contract, the rest of its domain and what it connects to as cards', async () => {
    const r = await render(mesh, { fonts: 'none', view: 'detailed-orders' });
    expect(r.diagnostics).toEqual([]);
    expect(r.steps).toBeUndefined();
    const nodes = new Map(r.graph!.nodes.map((n) => [n.id, n]));
    expect([...nodes.keys()].sort()).toEqual(['contract:orders', 'orders', 'revenue', 'shop']);
    expect(nodes.get('orders')!.shape.kind).toBe('table');
    expect(nodes.get('shop')!.parent).toBe('domain:sales');
    expect(nodes.get('revenue')!.shape).toMatchObject({ kind: 'card', caption: 'Finance · Source-aligned' });
    expect(r.graph!.groups.map((g) => g.id)).toEqual(['domain:sales']);
    // A neighbour from elsewhere says its domain and class only: its version and team are for its own view.
    const versioned = await render(mesh.replace('    domain: finance\n', '    domain: finance\n    version: 3.0.0\n    owner: Finance data team\n'), { fonts: 'none', view: 'detailed-orders' });
    expect(versioned.graph!.nodes.find((n) => n.id === 'revenue')!.shape).toMatchObject({ caption: 'Finance · Source-aligned' });
    // Forecast, the other product of Sales, is a card in its own view's neighbours only.
    const forecast = await render(mesh, { fonts: 'none', view: 'detailed-forecast' });
    expect(forecast.graph!.nodes.map((n) => [n.id, n.shape.kind])).toEqual([
      ['rates', 'card'],
      ['forecast', 'table'],
    ]);
  });

  it('names a product view apart from a domain view of the same name', async () => {
    const r = await render(mesh.replace('  finance: Finance', '  finance: Finance\n  orders: Orders desk').replace('rates: {}', 'rates: { domain: orders }'), { fonts: 'none' });
    expect(r.views!.map((v) => v.name)).toEqual(['overview', 'detailed-product-orders', 'detailed-forecast', 'detailed-finance', 'detailed-orders']);
    const one = await render(mesh.replace('  finance: Finance', '  finance: Finance\n  orders: Orders desk').replace('rates: {}', 'rates: { domain: orders }'), { fonts: 'none', view: 'detailed-product-orders' });
    expect(one.graph!.nodes.find((n) => n.id === 'orders')!.shape.kind).toBe('table');
  });

  it("draws a domain's products in detail with their contracts, and what they connect to as cards outside the domain box", async () => {
    const r = await render(mesh, { fonts: 'none', view: 'detailed-sales' });
    // The steps tell the whole mesh: in one domain's view they are not told, and not wrong either.
    expect(r.diagnostics).toEqual([]);
    expect(r.steps).toBeUndefined();
    const nodes = new Map(r.graph!.nodes.map((n) => [n.id, n]));
    expect([...nodes.keys()].sort()).toEqual(['contract:orders', 'forecast', 'orders', 'rates', 'revenue', 'shop']);
    expect(nodes.get('orders')!.shape.kind).toBe('table');
    expect(nodes.get('revenue')!.shape).toMatchObject({ kind: 'card', caption: 'Finance · Source-aligned' });
    expect(nodes.get('revenue')!.parent).toBeUndefined();
    expect(r.graph!.groups.map((g) => g.id)).toEqual(['domain:sales']);
    // The CFO reads revenue, not anything of Sales: it is left out.
    expect(nodes.has('cfo')).toBe(false);
    const other = await render(mesh, { fonts: 'none', view: 'detailed-other' });
    expect(other.graph!.nodes.map((n) => n.id).sort()).toEqual(['forecast', 'rates']);
  });

  it('takes a domain view written in the file, and says which there are when the name is wrong', async () => {
    const r = await render(mesh.replace('domains:', 'view: detailed-finance\ndomains:'), { fonts: 'none' });
    expect(r.graph!.nodes.find((n) => n.id === 'revenue')!.shape.kind).toBe('table');
    const wrong = await render(mesh.replace('domains:', 'view: detailed-hr\ndomains:'), { fonts: 'none' });
    expect(wrong.diagnostics.map((d) => d.message)).toContain('There is no view "detailed-hr": the detailed views are detailed-orders, detailed-forecast, detailed-finance, detailed-other');
  });

  it('sets a tall contract in two columns, unless keys are drawn to its fields', async () => {
    const tall = source('view: detailed').replace("fields: { id: uuid pk, email: string pii }", "fields: { id: uuid pk, email: string pii, name: string, country: string }\n    quality: [id is unique, email is valid]");
    const r = await render(tall, { fonts: 'none' });
    const shape = r.graph!.nodes.find((n) => n.id === 'contract:orders')!.shape as TableShape;
    // Schema in the first column, guarantees and checks in the second.
    expect(shape.split).toBe(shape.rows.findIndex((row) => row.kind === 'section' && row.label === 'Guarantees'));
    // The second column starts at the top, beside the first.
    const grid = tableGrid(shape, themes.light);
    const [first, second] = [grid.rows[1]!, grid.rows[shape.split!]!];
    expect([first.column, second.column, second.y]).toEqual([0, 1, grid.rows[0]!.y]);
    expect(grid.columns[1]!.x).toBe(grid.columns[0]!.width);
    const short = await render(source('view: detailed'), { fonts: 'none' });
    expect((short.graph!.nodes.find((n) => n.id === 'contract:orders')!.shape as TableShape).split).toBeUndefined();
  });

  it("stands one product's contract under it, and the lines from its port run straight on to who reads it", async () => {
    const one = `type: data-products
sources:
  crm: saas
products:
  customers:
    inputs: [crm]
    outputs:
      customers: { kind: table, contract: customers }
consumers:
  bi: { kind: dashboard, uses: [customers] }
  app: { kind: application, uses: [customers] }
contracts:
  customers:
    fields: { id: uuid pk, name: string, email: string pii, country: string }
    sla: { freshness: 24 hours }
    quality: [email is valid]
`;
    const r = await render(one, { fonts: 'none', view: 'detailed' });
    const box = (id: string) => r.placed!.nodes.get(id)!;
    const [product, contract] = [box('customers'), box('contract:customers')];
    expect(contract.x).toBe(product.x);
    expect(contract.y).toBeGreaterThan(product.y + product.height);
    // The port's lines leave to the right and never pass under the contract.
    const lines = r.graph!.edges.filter((x) => x.from.row === 'out:customers' && !x.annex);
    const port = r.placed!.edges.get(lines[0]!.id)!.points[0]!.y;
    for (const e of lines) for (const p of r.placed!.edges.get(e.id)!.points) expect(p.y).toBeLessThan(contract.y);
    // One of them level with the port (to the 8 px grid).
    expect(Math.min(...['bi', 'app'].map((id) => Math.abs(box(id).y + box(id).height / 2 - port)))).toBeLessThan(5);
  });
});

describe('data products, read as a practitioner reads them', () => {
  const dir = new URL('../../../examples/data-products/', import.meta.url);
  const file = (f: string) => fs.readFileSync(new URL(f, dir), 'utf8');
  const draw = (f: string, opts: Parameters<typeof render>[1] = {}) => render(file(f), { fonts: 'none', load: (p) => fs.readFileSync(new URL(p, dir), 'utf8'), file: f, ...opts });

  it('lights the contract with its product when a step puts the product in focus', async () => {
    const r = await draw('northwind-orders-product.yaml', { step: 3 });
    const step = r.steps![2]!;
    expect(step.nodes.orders).toBe('focus');
    expect(step.nodes['contract:orders']).toBe('focus');
    const link = r.graph!.edges.find((e) => e.annex && e.to.node === 'contract:orders')!;
    expect(step.edges[link.id]).toBe('focus');
    // What the step is not about stays quiet.
    expect(step.nodes.erp).toBe('dim');
  });

  it('puts input ports in the order of what feeds them, so their lines do not cross', async () => {
    for (const [f, view] of [['customer.yaml', 'detailed-customer-360'], ['mesh.yaml', 'detailed-customer-360'], ['northwind-mesh.yaml', 'detailed-supply']] as const) {
      const r = await draw(f, { view });
      for (const n of r.graph!.nodes) {
        if (n.shape.kind !== 'table' || !n.shape.ports) continue;
        const inputs = n.shape.rows.filter((row) => row.kind === 'row' && row.id.startsWith('in:')).map((row) => (row as { id: string }).id);
        const from = inputs.map((row) => {
          const e = r.graph!.edges.find((x) => x.to.node === n.id && x.to.row === row)!;
          const b = r.placed!.nodes.get(e.from.node)!;
          return b.y + b.height / 2;
        });
        expect(from, `${f}#${view} ${n.id}`).toEqual([...from].sort((a, b) => a - b));
      }
    }
    // Where the sources stand in the order written, the ports keep it.
    const written = await draw('northwind-orders-product.yaml');
    const rows = (written.graph!.nodes.find((n) => n.id === 'orders')!.shape as TableShape).rows.filter((row) => row.kind === 'row').map((row) => (row as { id: string }).id);
    expect(rows.slice(0, 2)).toEqual(['in:0', 'in:1']);
  });

  it('reads every input port the same way: what it reads from, then how', async () => {
    const r = await draw('mesh.yaml', { view: 'detailed-revenue' });
    const revenue = r.graph!.nodes.find((n) => n.id === 'revenue')!.shape as TableShape;
    const cells = revenue.rows.filter((row) => row.kind === 'row' && row.id.startsWith('in:')).map((row) => (row as { cells: { text: string }[] }).cells.map((c) => c.text));
    // Orders has two output ports: which one it reads is said beside it.
    expect(cells).toEqual(expect.arrayContaining([['Payments', ''], ['Exchange rates', ''], ['Orders', 'orders']]));
    const product = await draw('northwind-orders-product.yaml');
    const orders = product.graph!.nodes.find((n) => n.id === 'orders')!.shape as TableShape;
    expect(orders.rows.filter((row) => row.kind === 'row' && row.id.startsWith('in:')).map((row) => (row as { cells: { text: string }[] }).cells.map((c) => c.text))).toEqual([
      ['ERP', 'CDC every 5 min'],
      ['Webshop events', 'stream'],
    ]);
  });

  it('draws a domain in detail in one band, an output port leaving on the output side', async () => {
    const r = await draw('northwind-mesh.yaml', { view: 'detailed-supply' });
    const box = (id: string) => r.placed!.nodes.get(id)!;
    expect(box('replenish').x).toBeGreaterThan(box('forecast').x + box('forecast').width);
    const api = r.graph!.edges.find((e) => e.from.row === 'out:forecast')!;
    expect(r.placed!.edges.get(api.id)!.points[0]!.x).toBeGreaterThanOrEqual(box('forecast').x + box('forecast').width - 1);
  });

  it('fills the column of a wide contract under its product instead of leaving it empty', async () => {
    const r = await draw('finance.yaml', { view: 'detailed-payments' });
    const box = (id: string) => r.placed!.nodes.get(id)!;
    const [product, contract, revenue] = [box('payments'), box('contract:settled-payments'), box('revenue')];
    expect(contract.x).toBe(product.x);
    expect(contract.y).toBeGreaterThan(product.y + product.height);
    // Revenue stands beside the product, over the contract, not past the contract's right edge.
    expect(revenue.x).toBeLessThan(contract.x + contract.width);
    expect(revenue.y + revenue.height).toBeLessThan(contract.y);
  });

  it("keeps a contract's own keys and its line to the product inside the domain box", async () => {
    for (const [f, view] of [['mesh.yaml', 'detailed-sales'], ['mesh-detailed.yaml', 'orders-contract'], ['northwind-orders-product.yaml', undefined]] as const) {
      const r = await draw(f, { view });
      const domain = r.placed!.groups.get('domain:sales')!;
      const own = r.graph!.edges.filter((e) => (e.from.node === e.to.node && e.from.row) || e.annex);
      expect(own.length, `${f}#${view}`).toBeGreaterThan(0);
      for (const e of own)
        for (const p of r.placed!.edges.get(e.id)!.points) {
          expect(p.x, `${f}#${view} ${e.id}`).toBeGreaterThan(domain.x + 8);
          expect(p.x, `${f}#${view} ${e.id}`).toBeLessThan(domain.x + domain.width - 8);
        }
    }
  });

  it('offers a drawing once: a part the overview as written already draws is not offered again', async () => {
    const r = await draw('northwind-orders-product.yaml');
    expect(r.views!.map((v) => v.name)).toEqual(['overview', 'detailed-other']);
    // Still drawn when asked for by name.
    expect((await draw('northwind-orders-product.yaml', { view: 'detailed-sales' })).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    // Without detail: written, the domain's view is a drawing of its own.
    const plain = await render(file('northwind-orders-product.yaml').replace('detail: [orders]\n', ''), { fonts: 'none' });
    expect(plain.views!.map((v) => v.name)).toContain('detailed-sales');
    // The customer files open on views their picker offers.
    const detailed = await draw('customer-detailed.yaml');
    expect(detailed.views!.map((v) => v.name)).toContain(detailed.asWritten?.name);
  });
});
