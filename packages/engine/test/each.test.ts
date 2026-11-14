// each: — a pattern written once for a list of values (packages/core/src/each.ts).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { expandEach, indexFile } from '@cartography/core';
import { describe as describeGraph, toText } from '@cartography/describe';
import { render } from '../src/index.ts';

const files = (map: Record<string, string>) => (f: string) => {
  if (!(f in map)) throw new Error(`No file ${f}`);
  return map[f]!;
};
const labelOf = (n: { shape: unknown }) => (n.shape as { label?: string }).label;
const errors = (r: Awaited<ReturnType<typeof render>>) => r.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.line}: ${d.message}`);

const model = `type: model
each:
  domain: { orders: { team: Order management }, webshop: { team: Web shop } }
  env: [dev, test, prod]
elements:
  <domain>-team: { kind: users, label: <domain.team> team }
  dbw-<env>: { kind: databricks, label: dbw-lakehouse-<env> }
  uc:
    kind: metastore
    elements:
      <domain>_<env>: { kind: catalog, label: <domain>_<env>, owner: <domain>-team, tags: [<env>], elements: { gold: { kind: schema, label: gold of <domain> } } }
relations:
  - uc.<domain>_<env> -> dbw-<env>: Bound
  - <domain>-team -> uc.<domain>_dev: { label: Owns <domain> }
views:
  <env>:
    title: In <env>
    include: [uc.<domain>_<env>, dbw-<env>]
`;

describe('each: in a model', () => {
  it('writes an entry once per value, the first list outermost, in place of the pattern', () => {
    const x = expandEach({ type: 'model', each: { a: [1, 2], b: ['x', 'y'] }, elements: { first: 'thing', 'n<a><b>': 'thing', last: 'thing' } })!;
    expect(Object.keys((x.data as { elements: object }).elements)).toEqual(['first', 'n1x', 'n1y', 'n2x', 'n2y', 'last']);
    expect('each' in (x.data as object)).toBe(false);
  });

  it('fills names, labels, fields, tags and nested parts, and relations and views', () => {
    const x = expandEach(parse(model))!;
    const data = x.data as { elements: Record<string, any>; relations: unknown[]; views: Record<string, any> };
    expect(Object.keys(data.elements)).toEqual(['orders-team', 'webshop-team', 'dbw-dev', 'dbw-test', 'dbw-prod', 'uc']);
    expect(data.elements['orders-team'].label).toBe('Order management team');
    expect(Object.keys(data.elements.uc.elements)).toEqual(['orders_dev', 'orders_test', 'orders_prod', 'webshop_dev', 'webshop_test', 'webshop_prod']);
    expect(data.elements.uc.elements.webshop_prod).toMatchObject({ owner: 'webshop-team', tags: ['prod'], elements: { gold: { label: 'gold of webshop' } } });
    expect(data.relations).toEqual([
      ...['orders', 'webshop'].flatMap((d) => ['dev', 'test', 'prod'].map((e) => ({ [`uc.${d}_${e} -> dbw-${e}`]: 'Bound' }))),
      { 'orders-team -> uc.orders_dev': { label: 'Owns orders' } },
      { 'webshop-team -> uc.webshop_dev': { label: 'Owns webshop' } },
    ]);
    expect(Object.keys(data.views)).toEqual(['dev', 'test', 'prod']);
    // A list item names what the view around it does not: one item per value.
    expect(data.views.test).toEqual({ title: 'In test', include: ['uc.orders_test', 'uc.webshop_test', 'dbw-test'] });
  });

  it('is the same every time', () => {
    expect(JSON.stringify(expandEach(parse(model))!.data)).toBe(JSON.stringify(expandEach(parse(model))!.data));
  });

  it('draws the written-out model, describes it by its names, and shows each value where the pattern is', async () => {
    const r = await render(model, { fonts: 'none', view: 'prod' });
    expect(errors(r)).toEqual([]);
    expect(r.graph!.nodes.map(labelOf).sort()).toEqual(['dbw-lakehouse-prod', 'orders_prod', 'webshop_prod']);
    const text = toText(describeGraph({ graph: r.graph!, type: r.type! }));
    expect(text).toContain('orders_prod connects to dbw-lakehouse-prod (Bound)');
    // The editor finds it in the pattern, one step further than any entry, so it is never renamed or deleted on its own.
    const node = r.graph!.nodes.find((n) => labelOf(n) === 'webshop_prod')!;
    expect(node.path).toEqual(['elements', 'uc', 'elements', '<domain>_<env>', '<domain webshop, env prod>']);
  });

  it('leaves a file without each: as it is, <x> and all', async () => {
    expect(expandEach({ type: 'systems', nodes: { a: { label: 'List<Order>' } } })).toBeUndefined();
    const r = await render('type: systems\nnodes:\n  a: { kind: service, label: List<Order> }\n', { fonts: 'none' });
    expect(labelOf(r.graph!.nodes[0]!)).toBe('List<Order>');
  });

  it('writes \\<x> as the text <x>', () => {
    const x = expandEach({ each: { env: ['dev'] }, nodes: { 'a-<env>': { label: 'GET /orders/\\<id> in <env>' } } })!;
    expect(x.data).toEqual({ nodes: { 'a-dev': { label: 'GET /orders/<id> in dev' } } });
    expect(x.problems).toEqual([]);
  });
});

describe('each: problems, at the line they are written on', () => {
  it('says which lists there are when a placeholder names none', async () => {
    const r = await render('type: systems\neach:\n  domain: [orders]\nnodes:\n  <domain>: { kind: service, label: <domian> }\n', { fonts: 'none' });
    expect(errors(r)).toEqual(['5: <domian> is not a list of each: did you mean <domain>? (the lists under each: are <domain>). For the text <domian> itself, write \\<domian>']);
  });

  it('says a name written twice, on the second', async () => {
    const r = await render('type: systems\neach:\n  env: [dev, prod]\nnodes:\n  api-<env>: service\n  api-dev: service\n', { fonts: 'none' });
    expect(errors(r)).toEqual(['6: "api-dev" is already written by api-<env>: give one of them another name']);
  });

  it('says a placeholder no entry around it gives', async () => {
    const r = await render('type: systems\neach:\n  env: [dev, prod]\nnodes:\n  api: { kind: service, label: In <env> }\n', { fonts: 'none' });
    expect(errors(r)).toEqual(['5: <env> is not given here: write it in the name of the entry (the key, or the list item) it is in, so that entry is written once per env']);
  });

  it('says what is wrong with the lists themselves', async () => {
    const r = await render('type: systems\neach:\n  env: [dev, dev]\n  2x: [a]\n  domain: { orders: { team: [a] } }\nnodes:\n  a: service\n', { fonts: 'none' });
    expect(errors(r)).toEqual(['3: dev is twice in env', '4: "2x" cannot name a list: start with a letter, then letters, digits, - and _', '5: A field is one value: team: text']);
  });

  it('says a field no value has', async () => {
    const r = await render('type: systems\neach:\n  env: [dev]\nnodes:\n  a-<env>: { kind: service, label: <env.title> }\n', { fonts: 'none' });
    expect(errors(r)).toEqual(['5: No value of env has a field "title"']);
  });

  it('says a problem in a pattern once, at the pattern, with the values it is about', async () => {
    const r = await render('type: systems\neach:\n  domain: [orders, webshop, finance]\nnodes:\n  <domain>-api: { kind: servce }\n  <domain>-db: { kind: database, in: nowhere }\nedges:\n  - <domain>-api -> <domain>-db\n', { fonts: 'none' });
    expect(errors(r).map((e) => e.replace(/ \(36 allowed.*?\)/, ''))).toEqual(['5: "kind" cannot be "servce": did you mean service? (for domain orders, and 2 more)']);
    const s = await render('type: systems\neach:\n  domain: [orders, webshop, finance]\nnodes:\n  <domain>-db: { kind: database, in: nowhere }\nedges:\n  - <domain>-api -> <domain>-db\n', { fonts: 'none' });
    expect(errors(s)).toEqual(['5: There is no group "nowhere" (for domain orders, and 2 more)', '7: There is no node or group "orders-api" (for domain orders)', '7: There is no node or group "webshop-api" (for domain webshop)', '7: There is no node or group "finance-api" (for domain finance)']);
  });
});

describe('each: in diagrams', () => {
  it('writes nodes, groups and edges of a diagram', async () => {
    const r = await render(
      `type: azure
each:
  env: [dev, prod]
  app: [orders, billing]
groups:
  rg-<env>: { kind: resource-group, label: rg-<env> }
nodes:
  <app>-<env>: { kind: app-service, label: <app>-<env>, in: rg-<env> }
  db-<env>: { kind: sql-database, in: rg-<env> }
edges:
  - <app>-<env> -> db-<env>: SQL
`,
      { fonts: 'none' },
    );
    expect(errors(r)).toEqual([]);
    expect(r.graph!.groups.map((g) => g.id)).toEqual(['rg-dev', 'rg-prod']);
    expect(r.graph!.nodes.filter((n) => n.parent === 'rg-prod').map((n) => n.id).sort()).toEqual(['billing-prod', 'db-prod', 'orders-prod']);
    expect(r.graph!.edges.map((e) => `${e.from.node}>${e.to.node}`)).toEqual(['orders-dev>db-dev', 'orders-prod>db-prod', 'billing-dev>db-dev', 'billing-prod>db-prod']);
    // A line after a pattern's lines is the item it is in the file.
    expect(r.graph!.edges[3]!.path).toEqual(['edges', 0, '<app billing, env prod>']);
  });

  it('writes an included model out in that model, with its problems at its include', async () => {
    const load = files({ 'model.yaml': 'type: model\neach:\n  env: [dev, prod]\nelements:\n  api-<env>: { kind: api, label: <envv> }\n' });
    const r = await render('type: systems\ninclude: [model.yaml]\nnodes:\n  api-dev:\n', { fonts: 'none', load });
    expect(errors(r)[0]).toEqual(['2: model.yaml:5: <envv> is not a list of each: did you mean <env>? (the lists under each: are <env>). For the text <envv> itself, write \\<envv>'][0]);
    const ok = await render('type: systems\ninclude: [model.yaml]\nnodes:\n  api-prod:\n', { fonts: 'none', load: files({ 'model.yaml': 'type: model\neach:\n  env: [dev, prod]\nelements:\n  api-<env>: { kind: api, label: Orders API in <env> }\n' }) });
    expect(ok.graph!.nodes.map(labelOf)).toEqual(['Orders API in prod']);
  });

  it('gives a folder the written-out ids', () => {
    const ws = indexFile('m.yaml', model);
    expect(ws.elements.map((e) => e.id)).toContain('uc.webshop_test');
    expect(ws.elements.find((e) => e.id === 'uc.webshop_test')!.line).toBe(11);
  });
});

const access = `type: access
each:
  domain: [orders, webshop, finance]
  env: [dev, prod]
principals:
  <domain>-team: { kind: account-group, label: <domain>-team }
  sp-<env>: { kind: service-principal, label: sp-<env> }
  analysts: account-group
resources:
  dbw-<env>: databricks
  <domain>_<env>: { kind: catalog, tags: [<env>] }
  <domain>_prod_gold: { kind: schema, in: <domain>_prod }
roles:
  owner: { label: Owner }
  write: { label: Write }
  read: { label: Read }
assignments:
  - <domain>-team is owner on <domain>_dev
  - <domain>-team is read on <domain>_prod
  - sp-<env> is write on <domain>_<env>
  - sp-<env> is write on dbw-<env>
  - analysts is read on <domain>_prod_gold
views:
  matrix: { show: access, rows: domain, columns: env }
  part-<n>: { show: access, rows: domain, columns: env, page: <n> of 2 }
  by-scope: { show: access, rows: domain, environment: prod }
  wrong: { show: access, rows: team }
  picture: { rows: domain }
`.replace('  env: [dev, prod]\n', '  env: [dev, prod]\n  n: [1, 2]\n');

describe('access: who × where laid out by the lists of each:', () => {
  const matrixOf = (r: Awaited<ReturnType<typeof render>>) => {
    const shape = r.graph!.nodes[0]!.shape as { rows: { label: string }[]; columns: { label: string; caption?: string; group?: string }[]; cells: ({ text: string } | undefined)[][] };
    return { rows: shape.rows.map((x) => x.label), columns: shape.columns.map((c) => `${c.label} / ${c.group ?? c.caption}`), cells: shape.cells.map((row) => row.map((c) => c?.text ?? '')) };
  };

  it('puts a row per domain and a column per environment and who holds a role there', async () => {
    const r = await render(access, { fonts: 'none', view: 'matrix' });
    expect(errors(r)).toEqual([]);
    expect(matrixOf(r)).toEqual({
      rows: ['orders', 'webshop', 'finance'],
      columns: ['<domain>-team / dev', 'sp-dev / dev', '<domain>-team / prod', 'sp-prod / prod', 'analysts / prod'],
      cells: [
        ['Owner', 'Write', 'Read', 'Write', 'Read'],
        ['Owner', 'Write', 'Read', 'Write', 'Read'],
        ['Owner', 'Write', 'Read', 'Write', 'Read'],
      ],
    });
  });

  it('shows a part of the rows per view, with the same columns', async () => {
    const one = matrixOf(await render(access, { fonts: 'none', view: 'part-1' }));
    const two = matrixOf(await render(access, { fonts: 'none', view: 'part-2' }));
    expect([one.rows, two.rows]).toEqual([['orders', 'webshop'], ['finance']]);
    expect(two.columns).toEqual(one.columns);
  });

  it('without columns:, has a column per way a scope is written; what a scope above holds is said there only', async () => {
    const r = matrixOf(await render(access, { fonts: 'none', view: 'by-scope' }));
    expect(r.columns).toEqual(['<domain>-team / <domain>_prod', 'sp-prod / <domain>_prod', 'analysts / <domain>_prod_gold']);
    expect(r.cells[0]).toEqual(['Read', 'Write', 'Read']);
  });

  it('says a list there is not, and rows: on a drawing that is not the matrix', async () => {
    const wrong = await render(access, { fonts: 'none', view: 'wrong' });
    expect(wrong.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message)).toContain('rows: names a list of each: (domain, env, n); there is no list "team"');
    const graph = await render(access, { fonts: 'none', view: 'picture' });
    expect(graph.diagnostics.map((d) => d.message)).toContain('rows: and columns: lay out the who × where matrix: add show: access');
  });
});

describe('examples/databricks-at-scale', () => {
  const dir = path.resolve(import.meta.dirname, '../../../examples/databricks-at-scale');
  const load = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');
  it('writes sixty catalogs and their grants out of a few lines', async () => {
    const r = await render(load('governance.yaml'), { fonts: 'none', load, file: 'governance.yaml', view: 'team-access-1' });
    expect(errors(r)).toEqual([]);
    const m = expandEach(parse(load('governance.yaml')))!.data as { resources: object; assignments: unknown[] };
    expect(Object.keys(m.resources).filter((k) => /_(dev|test|prod)$/.test(k))).toHaveLength(60);
    expect(m.assignments.length).toBeGreaterThan(150);
    expect(load('governance.yaml').split('\n').length).toBeLessThan(110);
  });
});
