// Azure Databricks: its kinds in the azure, access and data-products types, and the shared Northwind lakehouse
// model (examples/databricks/model.yaml) that the Databricks diagrams include.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { expandEach } from '@cartography/core';
import { icon } from '@cartography/icons';
import { config as azure, databricksGroups, databricksNodes } from '@cartography/azure';
import { principalKinds, resourceKinds } from '@cartography/access';
import { classes, portKinds } from '@cartography/data-products';
import { config as systems } from '@cartography/systems';
import { render } from '../src/index.ts';

const dir = path.resolve(import.meta.dirname, '../../../examples/databricks');
const load = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');
const draw = (text: string) => render(text, { load, fonts: 'none', file: 'test.yaml' });
/** The model as the diagrams see it: its each: patterns written out. */
const model = () => {
  const raw = parse(load('model.yaml'));
  return (expandEach(raw)?.data ?? raw) as { elements: Record<string, any> };
};

/** One element of each kind in the model (parts as dotted ids): how a kind maps does not depend on which. */
function oneOfEachKind(): string[] {
  const seen = new Map<string, string>();
  const walk = (els: Record<string, { kind?: string; elements?: Record<string, unknown> } | null>, prefix: string) => {
    for (const [id, el] of Object.entries(els)) {
      if (el?.kind && !seen.has(el.kind)) seen.set(el.kind, prefix + id);
      if (el?.elements) walk(el.elements as never, `${prefix}${id}.`);
    }
  };
  walk(model().elements, '');
  return [...seen.values()];
}

describe('Databricks kinds', () => {
  it('have an icon, and a short label, in every type that has them', () => {
    const tables = { ...databricksGroups, ...databricksNodes, account: principalKinds['account-group']!, ...resourceKinds, ...classes, ...portKinds };
    for (const [kind, k] of Object.entries(tables)) {
      expect(icon(k.icon), kind).toBeDefined();
      expect(k.label.length, kind).toBeLessThanOrEqual(28);
    }
  });

  it('are the azure type’s, as cards and as groups', () => {
    for (const kind of Object.keys(databricksNodes)) expect(azure.nodeKinds[kind], kind).toBeDefined();
    for (const kind of Object.keys(databricksGroups)) expect(azure.groupKinds[kind], kind).toBeDefined();
    expect(azure.groupKinds.catalog).toMatchObject({ label: 'Catalog', icon: 'library' });
    expect(azure.nodeKinds['lakeflow-pipeline']!.keywords).toContain('dlt');
  });

  it('map to the architecture type’s own kinds, so a model with them draws there without warnings', () => {
    for (const kind of Object.keys(databricksNodes)) {
      const to = systems.kindAliases![kind];
      expect(to && (systems.nodeKinds[to] ?? systems.groupKinds[to]), kind).toBeDefined();
    }
  });

  it('draw a workspace with its Unity Catalog in an Azure diagram', async () => {
    const r = await render(
      `type: azure
groups:
  ws: { kind: databricks, label: dbw-lakehouse-prod }
  uc: { kind: metastore, label: uc-weu }
  cat: { kind: catalog, label: orders_prod, in: uc }
nodes:
  job: { kind: lakeflow-job, label: nightly, in: ws }
  pipe: { kind: lakeflow-pipeline, label: orders-pipeline, in: ws }
  gold: { kind: schema, label: gold, in: cat }
  dbac: { kind: access-connector, label: dbac-lakehouse-prod }
  ncc: { kind: ncc, label: ncc-lakehouse-prod }
  share: { kind: share, label: contoso_sell_through }
edges:
  - job -> pipe
  - pipe -> gold: { style: data }
`,
      { fonts: 'none' },
    );
    expect(r.diagnostics).toEqual([]);
    const card = (id: string) => r.graph!.nodes.find((n) => n.id === id)!.shape;
    expect(card('pipe')).toMatchObject({ caption: 'Lakeflow pipeline', icon: 'workflow' });
    expect(card('dbac')).toMatchObject({ caption: 'Access connector', icon: 'plug' });
    expect(r.graph!.groups.find((g) => g.id === 'cat')).toMatchObject({ parent: 'uc', caption: 'Catalog' });
  });

  it('give access diagrams Unity Catalog securables and account groups', async () => {
    const r = await render(
      `type: access
principals:
  engineers: { kind: account-group, label: orders-engineers }
resources:
  orders_prod: { kind: catalog }
  gold: { kind: schema, in: orders_prod }
roles:
  use: { label: USE CATALOG }
  select: { label: SELECT }
assignments:
  - engineers is use on orders_prod
  - engineers is select on gold
`,
      { fonts: 'none' },
    );
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.graph!.nodes.find((n) => n.id === 'engineers')!.shape).toMatchObject({ caption: 'Account group' });
  });

  it('give data products the medallion layers and OpenSharing ports', async () => {
    const r = await render(
      `type: data-products
sources:
  erp: { kind: erp, label: ERP }
products:
  raw: { label: Orders raw, class: bronze, inputs: [erp] }
  orders: { label: Orders, class: gold, inputs: [raw], outputs: { share: { kind: share, label: contoso_sell_through } } }
`,
      { fonts: 'none' },
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.graph!.legend!.map((l) => l.label)).toEqual(expect.arrayContaining(['Bronze', 'Gold']));
  });
});

describe('examples/databricks/model.yaml', () => {
  it('draws its own view without problems', async () => {
    expect((await draw(load('model.yaml'))).diagnostics).toEqual([]);
  });

  it('names Azure resources the CAF way, and ids are the names shown', () => {
    for (const [id, el] of Object.entries<{ kind: string; label?: string }>(model().elements)) {
      if (!id.includes('-lakehouse-') && !id.startsWith('st')) continue;
      const abbr = { databricks: 'dbw', 'access-connector': 'dbac', storage: 'st', 'private-endpoint': 'pep', vnet: 'vnet', nsg: 'nsg', 'route-table': 'rt', secrets: 'kv', ncc: 'ncc', subscription: 'sub', 'resource-group': 'rg' }[el.kind];
      expect(abbr, id).toBeDefined();
      expect(id.startsWith(abbr!), id).toBe(true);
      expect(el.label, id).toBe(id);
    }
  });

  it('names catalogs domain first, and gives every domain and environment its own storage', () => {
    const m = model();
    const uc = m.elements['uc-weu'].elements;
    for (const env of ['dev', 'test', 'prod']) {
      for (const domain of ['orders', 'webshop', 'finance', 'sales', 'customers', 'supply']) {
        const st = `st${domain}${env}`;
        expect(uc[`${domain}_${env}`]?.kind, `${domain}_${env}`).toBe('catalog');
        expect(uc[`cred_${domain}_${env}`]?.kind).toBe('storage-credential');
        expect(uc[`${domain}_${env}_catalog`]?.technology).toBe(`catalog@${st}`);
        expect(uc[`${domain}_${env}_landing`], 'no landing location: every source is read by a connector or a stream').toBeUndefined();
        expect(m.elements[st]?.kind, st).toBe('storage');
        expect(st).toMatch(/^[a-z0-9]{3,24}$/);
        expect(m.elements[`pep-${st}-dfs`]?.kind).toBe('private-endpoint');
      }
    }
    expect(Object.keys(m.elements).filter((id) => id.startsWith('stlakehouse'))).toEqual([]);
  });

  it('can be placed in an Azure diagram and in an architecture diagram, every kind of it, without warnings', async () => {
    const ids = oneOfEachKind();
    expect(ids.length).toBeGreaterThan(20);
    const nodes = ids.map((id, i) => `  n${i}: { ref: ${id} }`).join('\n');
    for (const type of ['azure', 'systems']) {
      const r = await draw(`type: ${type}\ninclude: [model.yaml]\nnodes:\n${nodes}\n`);
      expect(r.diagnostics, type).toEqual([]);
    }
  });

  it('can be deployed per environment with of:', async () => {
    const r = await draw(`type: azure
include: [model.yaml]
groups:
  ws: { ref: dbw-lakehouse-prod }
nodes:
  pipe: { of: lakehouse.orders-pipeline, in: ws }
  sales: { of: lakehouse.sales-pipeline, in: ws }
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.graph!.nodes.find((n) => n.id === 'pipe')!.shape).toMatchObject({ label: 'orders-pipeline' });
  });
});
