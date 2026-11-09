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
