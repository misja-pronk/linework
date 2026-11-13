import { describe, expect, it } from 'vitest';
import { parseEdge } from '@cartography/core';
import { parseColumn } from '@cartography/erd';
import { render, types } from '../src/index.ts';

describe('edges', () => {
  it('reads the shorthand forms', () => {
    expect(parseEdge('a -> b', [])).toMatchObject({ from: { node: 'a' }, to: { node: 'b' }, line: 'solid', end: 'arrow' });
    expect(parseEdge({ 'a --> b': 'SQL' }, [])).toMatchObject({ label: 'SQL', line: 'dashed' });
    expect(parseEdge({ 'a <-> b': { label: 'sync', style: 'private' } }, [])).toMatchObject({ start: 'arrow', props: { style: 'private' } });
    expect(parseEdge({ from: 'orders.customer_id', to: 'customers' }, [])).toMatchObject({ from: { node: 'orders', row: 'customer_id' } });
    expect(parseEdge('a => b', [])).toBeTypeOf('string');
  });
});

describe('key: naming lines without a style', () => {
  const doc = (key: string) => `type: systems\nnodes:\n  a: { kind: service }\n  b: { kind: service }\n  c: { kind: service }\nedges:\n  - a ..> b\n  - b ..> c\nkey: ${key}\n`;
  it('shows a name written there even when it is the only entry', async () => {
    const r = await render(doc('{ dotted: Configuration }'), { fonts: 'none' });
    expect(r.diagnostics).toEqual([]);
    expect(r.graph!.legend).toEqual([{ label: 'Configuration', line: 'dotted' }]);
  });
  it('says when a name is empty or names a look that is not drawn', async () => {
    const empty = await render(doc('{ dotted: "" }'), { fonts: 'none' });
    expect(empty.graph!.legend).toEqual([]);
    expect(empty.diagnostics.map((d) => d.message)).toEqual(['The key name for dotted lines is empty: write what they mean, or leave dotted: out']);
    const unused = await render(doc('{ dotted: Configuration, dashed: Replication }'), { fonts: 'none' });
    expect(unused.graph!.legend).toEqual([{ label: 'Configuration', line: 'dotted' }]);
    expect(unused.diagnostics.map((d) => d.message)).toEqual(['No line without a style is drawn dashed, so "Replication" is not in the key: draw one with -->, or leave dashed: out']);
  });
});

describe('erd columns', () => {
  it('reads type and flags', () => {
    expect(parseColumn('uuid pk fk orders')).toEqual({ type: 'uuid', pk: true, fk: 'orders' });
    expect(parseColumn('numeric(10,2) null')).toEqual({ type: 'numeric(10,2)', nullable: true });
    expect(parseColumn('timestamptz default now()')).toEqual({ type: 'timestamptz', default: 'now()' });
    expect(parseColumn('character varying unique')).toEqual({ type: 'character varying', unique: true });
  });

  it('derives cardinality from keys', async () => {
    const r = await render(`type: erd
tables:
  a: { columns: { id: int pk } }
  b: { columns: { id: int pk, a_id: int fk a null } }
  c: { columns: { a_id: int pk fk a, b_id: int pk fk b } }
  d: { columns: { a_id: int pk fk a } }
`);
    const ends = Object.fromEntries(r.graph!.edges.map((e) => [e.id, [e.start, e.end]]));
    expect(ends['fk-b-a_id']).toEqual(['zeroOrMany', 'zeroOrOne']);
    expect(ends['fk-c-a_id']).toEqual(['zeroOrMany', 'one']); // part of a composite key
    expect(ends['fk-d-a_id']).toEqual(['zeroOrOne', 'one']); // the whole key: one-to-one
  });
});

describe('diagnostics', () => {
  it('points at the line of the problem', async () => {
    const r = await render(`type: azure
nodes:
  web: app-service
  db: { kind: sql-databse }
edges:
  - web -> nope
`);
    expect(r.svg).toBeUndefined();
    expect(r.diagnostics[0]).toMatchObject({ line: 4, message: expect.stringContaining('cannot be "sql-databse": did you mean sql-database?') });
  });

  it('reports unknown references but still draws', async () => {
    const r = await render(`type: azure
nodes:
  web: { kind: app-service, in: missing }
edges:
  - web -> nope
`);
    expect(r.svg).toBeDefined();
    expect(r.diagnostics.map((d) => [d.line, d.message])).toEqual([
      [3, 'There is no group "missing"'],
      [5, 'There is no node or group "nope"'],
    ]);
  });

  it('asks for a type', async () => {
    expect((await render('title: x')).diagnostics[0]!.message).toMatch(/Add "type:"/);
    expect((await render('type: nope')).diagnostics[0]).toMatchObject({ line: 1, message: expect.stringMatching(/Unknown type/) });
  });
});

describe('templates', () => {
  for (const t of types)
    it(`${t.id} renders without problems`, async () => {
      const r = await render(t.template, { fonts: 'none' });
      expect(r.diagnostics).toEqual([]);
      expect(r.svg).toMatchSnapshot();
    });

  it('keeps pinned nodes where they were put', async () => {
    const t = types.find((x) => x.id === 'azure')!;
    const r = await render(t.template, { fonts: 'none', sidecar: { version: 1, nodes: { vault: { x: 2000, y: 900 } } } });
    const vault = r.placed!.nodes.get('vault')!;
    const rg = r.placed!.groups.get('rg')!;
    expect(rg.x + rg.width).toBeGreaterThanOrEqual(vault.x + vault.width);
    expect(rg.y + rg.height).toBeGreaterThanOrEqual(vault.y + vault.height);
  });
});

describe('empty diagrams', () => {
  it('render as a title only, for every type', async () => {
    for (const t of ['azure', 'erd', 'access', 'github', 'data-products']) {
      const r = await render(`type: ${t}\ntitle: Untitled\n`, { fonts: 'none' });
      expect(r.diagnostics).toEqual([]);
      expect(r.svg).toContain('Untitled');
    }
  });
});

describe('a section written two spaces in', () => {
  it('says it is indented, once, instead of what an entry would need', async () => {
    const r = await render('type: sequence\nparticipants:\n  a: { label: A }\n  b: { label: B }\n  messages:\n    - a -> b: hi\n', { fonts: 'none' });
    const errors = r.diagnostics.filter((d) => d.severity === 'error');
    expect(errors.map((d) => d.message)).toEqual(['"messages" is indented under "participants": a section of its own starts at the left edge, without the spaces before it']);
    expect(errors[0]!.line).toBe(5);
  });
});
