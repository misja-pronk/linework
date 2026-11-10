import { describe, expect, it } from 'vitest';
import { parseSource, type TableShape } from '@cartography/core';
import { readOdcs } from '@cartography/data-products';
import { render } from '../src/index.ts';

const v3 = `apiVersion: v3.0.2
kind: DataContract
id: abc
name: orders
version: 1.2.0
schema:
  - name: orders
    properties:
      - { name: id, physicalType: uuid, primaryKey: true, quality: [{ rule: duplicateCount, mustBe: 0 }] }
      - { name: email, logicalType: string, required: true, classification: confidential, tags: [pii] }
      - { name: note, logicalType: string }
    quality:
      - { metric: rowCount, mustBeBetween: [1, 100] }
slaProperties:
  - { property: latency, value: 1, unit: d }
  - { property: availability, value: 99.9% }
`;

describe('Open Data Contract Standard', () => {
  it('reads v3 schema, SLAs and quality rules', () => {
    expect(readOdcs(parseSource(v3).data)).toEqual({
      label: 'orders',
      version: '1.2.0',
      classification: 'confidential',
      schemas: [
        {
          name: 'orders',
          fields: [
            { name: 'id', type: 'uuid', marks: ['pk'] },
            { name: 'email', type: 'string', marks: ['pii'] },
            { name: 'note', type: 'string?', marks: ['null'] },
          ],
        },
      ],
      sla: [['latency', '1 day'], ['availability', '99.9%']],
      quality: ['rowCount between 1 and 100', 'id: duplicateCount = 0'],
    });
  });

  it('reads v2 datasets with columns', () => {
    const m = readOdcs({
      kind: 'DataContract',
      apiVersion: 'v2.2.2',
      datasetName: 'legacy',
      dataset: [{ table: 'tbl', columns: [{ column: 'id', logicalType: 'int', isPrimaryKey: true }, { column: 'x', logicalType: 'text', isNullable: false }] }],
    });
    expect(m).toMatchObject({ label: 'legacy', schemas: [{ name: 'tbl', fields: [{ name: 'id', marks: ['pk'] }, { name: 'x', type: 'text', marks: [] }] }] });
  });

  it('rejects other files', () => expect(readOdcs({ hello: 1 })).toMatch(/not an Open Data Contract/));

  const diagram = (contract: string, extra = '') => `type: data-products
view: detailed
${extra}
products:
  shop:
    outputs:
      orders: { kind: table, contract: orders }
contracts:
  orders: ${contract}
`;
  const files: Record<string, string> = { 'orders.odcs.yaml': v3, 'broken.yaml': 'a: [', 'other.yaml': 'hello: 1' };
  const load = (f: string) => {
    if (!(f in files)) throw new Error('missing');
    return files[f]!;
  };

  it('draws a contract from a file, with diagram keys on top', async () => {
    const r = await render(diagram('{ file: orders.odcs.yaml, label: Orders v1 }', 'contract-fields: 2'), { fonts: 'none', load });
    expect(r.diagnostics).toEqual([]);
    const c = r.graph!.nodes.find((n) => n.id === 'contract:orders')!.shape as TableShape;
    expect(c.title).toBe('Orders v1');
    expect(c.caption).toBe('Data contract · v1.2.0 · confidential');
    expect(c.rows.filter((x) => x.kind === 'row' && x.id.startsWith('field:')).map((x) => (x.kind === 'row' ? x.cells[0]!.text : ''))).toEqual(['id', 'email', '+ 1 more field']);
  });

  it('points at the file key when the file cannot be used', async () => {
    const message = async (contract: string, opts = { load }) => (await render(diagram(contract), { fonts: 'none', ...opts })).diagnostics.map((d) => [d.line, d.message]);
    expect(await message('{ file: nope.yaml }')).toEqual([[9, 'Cannot read "nope.yaml"']]);
    expect((await message('{ file: broken.yaml }'))[0]![1]).toMatch(/^broken.yaml line 1: /);
    expect(await message('{ file: other.yaml }')).toEqual([[9, 'other.yaml: This is not an Open Data Contract Standard file (no "kind: DataContract")']]);
    expect((await message('{ file: orders.odcs.yaml }', { load: undefined as never }))[0]![1]).toMatch(/can only be read/);
  });
});

describe('ODCS 3.1 relationships', () => {
  const orders = `apiVersion: v3.1.0
kind: DataContract
id: o
name: orders
schema:
  - id: orders_tbl
    name: orders
    properties:
      - { id: order_pk, name: order_id, logicalType: string, primaryKey: true }
      - name: customer_id
        logicalType: string
        relationships:
          - { type: foreignKey, to: customers.odcs.yaml#/schema/customers_tbl/properties/customer_pk }
      - name: region
        logicalType: string
        relationships:
          - { to: nowhere.yaml#/regions.code }
  - name: order_lines
    properties:
      - { name: line_id, logicalType: string, primaryKey: true }
      - { name: order_id, logicalType: string }
      - { name: tenant, logicalType: string }
    relationships:
      - { type: foreignKey, from: order_lines.order_id, to: orders.order_id }
      - { from: [order_lines.order_id, order_lines.tenant], to: [orders.order_id, orders.region], customProperties: [{ property: label, value: same tenant }] }
`;
  const customers = `apiVersion: v3.1.0
kind: DataContract
id: c
name: customers
schema:
  - id: customers_tbl
    name: customers
    properties:
      - { id: customer_pk, name: customer_id, logicalType: string, primaryKey: true }
      - name: referred_by
        logicalType: string
        relationships:
          - { type: foreignKey, to: schema/customers_tbl/properties/customer_pk }
`;
  const read = (text: string) => {
    const m = readOdcs(parseSource(text).data);
    if (typeof m === 'string') throw new Error(m);
    return m;
  };

  it('reads them on a property and on a schema object, by name and by id', () => {
    const m = read(orders);
    expect(m.relations!.map((r) => [`${r.from.schema}.${r.from.field}`, r.to.file, `${r.to.schema}.${r.to.field}`])).toEqual([
      ['0.customer_id', 'customers.odcs.yaml', 'customers_tbl.customer_pk'],
      ['0.region', 'nowhere.yaml', 'regions.code'],
      // A composite key is one line per pair of fields; the pair that was there already is not read twice.
      ['1.order_id', undefined, 'orders.order_id'],
      ['1.tenant', undefined, 'orders.region'],
    ]);
    expect(m.relations!.map((r) => r.label)).toEqual([undefined, undefined, 'same tenant', 'same tenant']);
    // The field that points away carries the foreign-key mark, once.
    expect(m.schemas[0]!.fields.map((f) => [f.name, f.marks.includes('fk')])).toEqual([['order_id', false], ['customer_id', true], ['region', true]]);
    expect(m.schemas[1]!.fields.find((f) => f.name === 'order_id')!.marks.filter((x) => x === 'fk')).toEqual(['fk']);
    expect(read(customers).relations).toEqual([{ from: { schema: 0, field: 'referred_by' }, to: { schema: 'customers_tbl', field: 'customer_pk' } }]);
  });

  it('leaves a 3.0 contract as it was', () => {
    const m = read(v3);
    expect(m.relations).toBeUndefined();
    expect(m.schemas[0]!.fields.every((f) => !f.marks.includes('fk'))).toBe(true);
  });

  it('says what it cannot read instead of failing', () => {
    const odd = read(`apiVersion: v3.1.0
kind: DataContract
schema:
  - name: t
    properties:
      - { name: a, relationships: nope }
      - { name: b, relationships: [12, { to: 7 }, { type: foreignKey }, { to: no-dot }] }
    relationships: [{ from: t.missing, to: t.a }, { from: [t.a, t.b], to: [t.b] }, { type: other, from: t.a, to: t.b }]
`);
    // Only the first pair of the lopsided composite key is one; the rest is said in words.
    expect(odd.relations).toEqual([{ from: { schema: 0, field: 'a' }, to: { schema: 't', field: 'b' } }]);
    expect(odd.notes).toEqual([
      'Relationship t.missing → t.a is not read: its from end is not a field of this contract',
      'Relationship t.b → undefined is not read: its to end is not a reference like table.column',
      'Relationship b → 7 is not read: its to end is not a reference like table.column',
      'Relationship b → undefined is not read: its to end is not a reference like table.column',
      'Relationship b → no-dot is not read: its to end is not a reference like table.column',
    ]);
  });

  const mesh = (extra = '') => `type: data-products
view: detailed
${extra}
products:
  shop:
    outputs:
      orders: { kind: table, contract: orders }
  crm:
    outputs:
      customers: { kind: table, contract: customers }
contracts:
  orders: { file: contracts/orders.odcs.yaml }
  customers: { file: contracts/customers.odcs.yaml }
`;
  const files: Record<string, string> = { 'contracts/orders.odcs.yaml': orders, 'contracts/customers.odcs.yaml': customers };
  const load = (f: string) => {
    if (!(f in files)) throw new Error('missing');
    return files[f]!;
  };
  const keys = async (text: string, extra: Record<string, string> = {}) => {
    const r = await render(text, { fonts: 'none', load: (f) => ({ ...files, ...extra })[f] ?? load(f) });
    const lines = r.graph!.edges.filter((e) => e.tone === 'violet' && e.line === 'solid').map((e) => `${e.from.node}/${e.from.row} → ${e.to.node}/${e.to.row}${e.label ? ` (${e.label})` : ''}`);
    return { r, lines };
  };

  it('draws them field to field, inside a contract and between two', async () => {
    const { r, lines } = await keys(mesh());
    expect(r.diagnostics).toEqual([]);
    expect(lines).toEqual([
      'contract:orders/field:0:customer_id → contract:customers/field:0:customer_id',
      'contract:orders/field:1:order_id → contract:orders/field:0:order_id (same tenant)',
      'contract:orders/field:1:tenant → contract:orders/field:0:region (same tenant)',
      'contract:customers/field:0:referred_by → contract:customers/field:0:customer_id',
    ]);
    const fk = r.graph!.edges.find((e) => e.tone === 'violet' && e.line === 'solid')!;
    expect([fk.start, fk.end]).toEqual(['zeroOrMany', 'one']);
    expect(r.svg).toContain('Foreign key');
  });

  it('ends on "+ n more" when the field is folded away, and draws nothing in the overview', async () => {
    const { lines } = await keys(mesh('contract-fields: 1'));
    expect(lines).toContain('contract:orders/field:more → contract:customers/field:0:customer_id');
    const overview = await keys(mesh().replace('view: detailed', 'view: overview'));
    expect(overview.r.diagnostics).toEqual([]);
    expect(overview.lines).toEqual([]);
  });

  it('warns about a field the other contract does not have', async () => {
    const { r, lines } = await keys(mesh(), { 'contracts/customers.odcs.yaml': customers.replace('id: customer_pk, ', '') });
    expect(r.diagnostics.map((d) => [d.severity, d.line])).toEqual([['warning', 12], ['warning', 13]]);
    expect(r.diagnostics[0]!.message).toMatch(/orders\.odcs\.yaml: relationship customer_id → customers\.odcs\.yaml#customers_tbl\.customer_pk points at a field that "customers" does not have/);
    expect(lines).toHaveLength(2);
  });
});
