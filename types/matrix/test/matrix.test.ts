import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render } from '@linework/engine';
import { cellValues, matrix } from '../src/index.ts';

const crud = fs.readFileSync(new URL('../../../examples/matrix/crud-services.yaml', import.meta.url), 'utf8');

describe('matrix', () => {
  it('reads one value or several in a cell', () => {
    const keys = ['C', 'R', 'U', 'D'];
    expect(cellValues('CRU', keys)).toEqual(['C', 'R', 'U']);
    expect(cellValues('C R', keys)).toEqual(['C', 'R']);
    expect(cellValues('A/R', ['R', 'A', 'C', 'I'])).toEqual(['A', 'R']);
    expect(cellValues('Owner', ['Owner', 'Backup'])).toEqual(['Owner']);
    expect(cellValues('X', keys)).toEqual({ unknown: 'X' });
  });

  it('draws the RACI template without warnings: grouped columns, phases, counts and a key', async () => {
    const r = await render(matrix.template, { fonts: 'none' });
    expect(r.diagnostics).toEqual([]);
    const m = r.graph!.nodes[0]!.shape;
    if (m.kind !== 'matrix') throw new Error('not a matrix');
    expect(m.columns.map((c) => c.group)).toEqual(['Business', 'Business', 'IT', 'IT', 'IT', 'Risk']);
    expect(m.columns[1]!.caption).toBe('1 R · 4 A · 1 I');
    expect(m.cells[3]![3]!.parts!.map((p) => p.text)).toEqual(['A', 'R']);
    expect(r.graph!.legend!.map((l) => l.tag)).toEqual(['R', 'A', 'C', 'I']);
    expect(r.svg).toContain('PREPARE');
  });

  it('checks the legend rules: one A per activity, a creator and a reader per entity', async () => {
    const raci = await render(matrix.template.replace('case: { sponsor: A,', 'case: { sponsor: R,').replace('pipelines: { arch: C, platform: A/R', 'pipelines: { arch: A, platform: A/R'), { fonts: 'none' });
    expect(raci.diagnostics.map((d) => d.message)).toEqual([
      '"Business case" has 0 × A; it needs exactly one (Accountable)',
      '"Deployment pipelines" has 2 × A; it needs exactly one (Accountable)',
    ]);
    const c = await render(crud.replace('checkout: { customer: R, address: R, product: R, price: R, order: C, payment: C }', 'checkout: { customer: R, address: R, product: R, price: R, order: C }'), { fonts: 'none' });
    expect(c.diagnostics.map((d) => d.message)).toEqual(['"Payment" has 0 × C; it needs at least one (Create)']);
  });

  it('takes a legend of its own and says what is not in it, or not a row or column', async () => {
    const r = await render(
      `type: matrix
legend: { Own: { label: Owner, per-column: exactly-one }, Use: User }
rows: { a: Team A, b: Team B }
columns: { x: Service X }
cells:
  a: { x: Own, y: Use }
  b: { x: Maybe }
  c: { x: Use }
`,
      { fonts: 'none' },
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      'There is no column "y"; columns: x',
      '"Maybe" is not in the legend: Own, Use',
      'There is no row "c"; rows: a, b',
    ]);
  });

  it('names rows and columns after model elements with the same id', async () => {
    const r = await render(
      `type: matrix
legend: crud
elements:
  shop:
    label: Web shop
    elements:
      api: { label: Orders API, links: ["https://example.org/api"] }
rows: { api: null }
columns: { order: Order }
cells: { api: { order: CRUD } }
`,
      { fonts: 'none' },
    );
    expect(r.diagnostics).toEqual([]);
    const m = r.graph!.nodes[0]!.shape;
    if (m.kind !== 'matrix') throw new Error('not a matrix');
    expect(m.rows[0]).toMatchObject({ label: 'Orders API', link: { kind: 'url', target: 'https://example.org/api' } });
  });
});
