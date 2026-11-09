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
});
