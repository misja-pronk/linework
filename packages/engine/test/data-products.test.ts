import { describe, expect, it } from 'vitest';
import type { TableShape } from '@cartography/core';
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
    const r = await render(source('view: overview'), { fonts: 'none' });
    expect(r.views).toEqual([
      { name: 'overview', title: 'Overview' },
      { name: 'detailed', title: 'Detailed' },
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

  it('offers one detailed view per domain, and one for products without a domain; the whole mesh in detail only by name', async () => {
    const r = await render(mesh, { fonts: 'none' });
    expect(r.views).toEqual([
      { name: 'overview', title: 'Overview' },
      { name: 'detailed-sales', title: 'Sales in detail' },
      { name: 'detailed-finance', title: 'Finance in detail' },
      { name: 'detailed-other', title: 'Other products in detail' },
    ]);
    const whole = await render(mesh, { fonts: 'none', view: 'detailed' });
    expect(whole.diagnostics).toEqual([]);
    expect(whole.graph!.nodes.filter((n) => n.shape.kind === 'table').map((n) => n.id)).toEqual(['orders', 'revenue', 'rates', 'forecast', 'contract:orders']);
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
    expect(wrong.diagnostics.map((d) => d.message)).toContain('There is no view "detailed-hr": the detailed views are detailed-sales, detailed-finance, detailed-other');
  });
});
