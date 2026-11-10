import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseSource } from '@cartography/core';
import { render } from '@cartography/engine';
import { dataFileKind, importDataMesh, isDataMeshFile, type MeshFile } from '../src/index.ts';

const orders = `apiVersion: v1.0.0
kind: DataProduct
id: 11-orders
name: Orders
version: 2.1.0
status: active
domain: Sales
inputPorts:
  - { name: webshop order events, version: 1.0.0, contractId: shop-events }
outputPorts:
  - { name: orders, version: 2.1.0, type: tables, contractId: c-orders }
  - { name: order placed, version: 1.0.0, type: Kafka topic }
team:
  name: Sales engineering
`;
const ordersContract = `apiVersion: v3.1.0
kind: DataContract
id: c-orders
name: orders
version: 2.1.0
schema:
  - name: orders
    properties:
      - { name: order_id, logicalType: string, primaryKey: true }
`;
// v1.1: no versions on ports, the team as a list of members, lineage on the output port.
const revenue = `apiVersion: v1.1.0
kind: DataProduct
id: 22-revenue
name: Revenue
status: draft
domain: Finance
inputPorts:
  - { name: sales orders, contractId: c-orders }
outputPorts:
  - name: revenue by day
    type: REST API
    inputContracts:
      - { id: c-orders }
      - { id: c-rates }
team:
  members:
    - { username: ann@example.com, role: steward }
    - { username: bo@example.com, name: Bo, role: Owner }
`;
// Linux Foundation v4: details per language, named ways in, the contract apart.
const rates = `schema: https://opendataproducts.org/v4.0/schema/odps.yaml
version: "4.0"
product:
  details:
    en: { name: Exchange rates, productID: fx, status: production, productVersion: "1.0" }
  contract: { id: c-rates, type: ODCS }
  dataAccess:
    default: { name: { en: Rates API }, outputPorttype: API, format: JSON }
    bulk: { outputPorttype: file, format: CSV }
  dataHolder:
    en: { legalName: Treasury }
`;
// Linux Foundation v3: the details under the language itself, one way in.
const weather = `schema: https://opendataproducts.org/v3.1/schema/odps.yaml
version: "3.1"
product:
  en:
    name: Weather
    productID: w-1
    version: "0.3"
    status: draft
    categories: [Logistics, Planning]
  dataAccess: { type: REST, format: JSON }
  dataHolder: { legalName: Met Office, businessDomain: Environment }
`;

const mesh = (files: Record<string, string>): MeshFile[] => Object.entries(files).map(([p, text]) => ({ path: p, text }));
const all = { 'products/orders.yaml': orders, 'products/revenue.yaml': revenue, 'products/rates.yaml': rates, 'contracts/orders.yaml': ordersContract };

/** The import, read back, and drawn: what comes out is a diagram without problems. */
async function imported(files: Record<string, string>, existing?: string) {
  const r = importDataMesh(mesh(files), { existing });
  const check = await render(r.yaml, { fonts: 'none', load: (f) => files[f]! });
  expect(check.diagnostics).toEqual([]);
  return { ...r, doc: parse(r.yaml), graph: check.graph! };
}

describe('importDataMesh', () => {
  it('knows the files by what is in them', () => {
    const kind = (text: string) => dataFileKind(parseSource(text).data);
    expect([orders, revenue, rates, weather, ordersContract].map(kind)).toEqual(['odps', 'odps', 'odps-lf', 'odps-lf', 'odcs']);
    expect(kind('{"kind": "DataProduct", "apiVersion": "v1.0.0", "id": "x", "status": "active"}')).toBe('odps');
    expect(kind('datasetName: legacy\ndataset:\n  - table: t\n')).toBe('odcs');
    // Not these: a diagram, a Kubernetes manifest, something that only has a product key.
    expect(kind('type: data-products\nproducts:\n  product: {}\n')).toBeUndefined();
    expect(kind('apiVersion: v1\nkind: Service\nmetadata: { name: product }\n')).toBeUndefined();
    expect(kind('product: Widget\nprice: 3\n')).toBeUndefined();
    expect(isDataMeshFile(orders)).toBe(true);
    expect(isDataMeshFile(rates)).toBe(true);
    expect(isDataMeshFile(ordersContract)).toBe(true);
    expect(isDataMeshFile('type: systems\nnodes:\n  dataset: database\n')).toBe(false);
    expect(isDataMeshFile('kind: DataProduct\n  broken: [')).toBe(false);
    expect(isDataMeshFile('flowchart LR\n  product --> dataset\n')).toBe(false);
  });

  it('reads a product with its ports, owner and domain (Bitol ODPS v1.0)', async () => {
    const { doc, warnings, products, contracts } = await imported({ 'products/orders.yaml': orders, 'contracts/orders.yaml': ordersContract });
    expect(warnings).toEqual([]);
    expect([products, contracts]).toEqual([1, 1]);
    expect(doc.domains).toEqual({ sales: { label: 'Sales' } });
    expect(doc.products.orders).toEqual({
      label: 'Orders',
      class: 'source-aligned',
      domain: 'sales',
      owner: 'Sales engineering',
      version: '2.1.0',
      file: 'products/orders.yaml',
      inputs: ['webshop-order-events'],
      outputs: { orders: { kind: 'table', contract: 'orders' }, 'order-placed': { kind: 'topic', label: 'order placed' } },
    });
    // What it reads comes from outside the folder: a source stands for it.
    expect(doc.sources).toEqual({ 'webshop-order-events': { label: 'webshop order events', caption: 'Outside the mesh' } });
    expect(doc.contracts).toEqual({ orders: { file: 'contracts/orders.yaml' } });
  });

  it('connects products where an input port names the contract of an output port', async () => {
    const { doc, graph, warnings } = await imported(all);
    expect(warnings).toEqual([]);
    // Orders has two outputs, so the port is named; the port's own name shows where it says more.
    expect(doc.products.revenue.inputs).toEqual([{ from: 'orders.orders', name: 'sales orders' }, 'exchange-rates.rates-api']);
    expect(doc.products.revenue).toMatchObject({ class: 'consumer-aligned', domain: 'finance', owner: 'Bo', status: 'draft' });
    expect(doc.products.revenue.version).toBeUndefined();
    expect(doc.products.orders.class).toBe('source-aligned');
    const lines = graph.edges.map((e) => `${e.from.node} → ${e.to.node}`);
    expect(lines).toEqual(expect.arrayContaining(['orders → revenue', 'exchange-rates → revenue', 'webshop-order-events → orders']));
  });

  it('reads the Linux Foundation specification, v4 and v3', async () => {
    const { doc } = await imported({ 'rates.yaml': rates, 'weather.json': JSON.stringify(parse(weather)) });
    expect(doc.products['exchange-rates']).toEqual({
      label: 'Exchange rates',
      class: 'source-aligned',
      owner: 'Treasury',
      version: '1.0',
      file: 'rates.yaml',
      // In production is what a reader expects: not said.
      outputs: { 'rates-api': { kind: 'api', label: 'Rates API' }, bulk: { kind: 'files' } },
    });
    expect(doc.products.weather).toEqual({
      label: 'Weather',
      class: 'source-aligned',
      domain: 'logistics',
      owner: 'Met Office',
      version: '0.3',
      status: 'draft',
      file: 'weather.json',
      outputs: { json: { kind: 'api', label: 'JSON' } },
    });
  });

  it('makes products of contracts that stand alone', async () => {
    const contract = (id: string, product?: string) => `apiVersion: v3.0.2\nkind: DataContract\nid: ${id}\nname: ${id}\ndomain: Sales\n${product ? `dataProduct: ${product}\n` : ''}schema:\n  - name: t\n    properties:\n      - { name: id, logicalType: string }\n`;
    const { doc, products, contracts } = await imported({ 'a.odcs.yaml': contract('orders', 'Shop'), 'b.odcs.yaml': contract('returns', 'shop'), 'c.odcs.yaml': contract('stock') });
    expect([products, contracts]).toEqual([2, 3]);
    expect(doc.products.shop).toMatchObject({ label: 'Shop', domain: 'sales', outputs: { orders: { contract: 'orders' }, returns: { contract: 'returns' } } });
    expect(doc.products.stock).toMatchObject({ domain: 'sales', outputs: { stock: { contract: 'stock' } } });
  });

  it('says where a file is wrong, with line and column, and reads the rest', async () => {
    const { problems, skipped, products, doc } = await imported({
      ...all,
      'products/broken.yaml': 'apiVersion: v1.0.0\nkind: DataProduct\nid: x\nname: [broken\n',
      'products/odd.yaml': 'apiVersion: v1.0.0\nkind: DataProduct\nid: odd\nstatus: active\ninputPorts: nope\noutputPorts:\n  - 12\n  - { version: 1 }\n  - name: out\n    inputContracts: [3]\n',
      'products/nameless.yaml': 'kind: DataProduct\nstatus: active\n',
      'contracts/twice.yaml': ordersContract,
      'notes.yaml': 'hello: [',
      'ci.yaml': 'name: build\non: push\n',
    });
    expect(problems.map((p) => [p.file, p.line, p.column, p.severity, p.message])).toEqual([
      ['contracts/twice.yaml', 3, 1, 'warning', 'Contract id "c-orders" is already used by contracts/orders.yaml: this file is not read'],
      ['products/broken.yaml', 5, 1, 'error', expect.stringMatching(/^Not read: /)],
      ['products/nameless.yaml', 1, 1, 'error', 'A data product needs a name or an id: not read'],
      ['products/odd.yaml', 5, 1, 'warning', '"inputPorts" should be a list: not read'],
      ['products/odd.yaml', 7, 5, 'warning', 'An entry of "outputPorts" should be a map with a name: not read'],
      ['products/odd.yaml', 8, 5, 'warning', 'An output port needs a name: not read'],
      ['products/odd.yaml', 10, 22, 'warning', 'An entry of "inputContracts" should be a map with a name: not read'],
    ]);
    // Other YAML in the folder is not ours to complain about.
    expect(skipped).toEqual(['ci.yaml', 'notes.yaml']);
    expect(products).toBe(4);
    expect(doc.products.odd).toMatchObject({ outputs: { out: {} } });
  });

  it('never throws on what is not a data file', () => {
    for (const text of ['', '12', '- a\n- b\n', 'null', 'kind: DataProduct', 'product: { en: 3 }', 'product: { details: { en: { name: [] } } }', 'kind: DataContract\nid: { a: 1 }', '\t{', 'kind: DataProduct\nname: x\nteam: 3\noutputPorts: [{ name: { a: 1 } }]']) {
      const r = importDataMesh([{ path: 'x.yaml', text }]);
      expect(r.problems.every((p) => p.message.length > 0)).toBe(true);
    }
    expect(importDataMesh([]).problems).toEqual([{ message: 'No files to read', severity: 'error' }]);
    const none = importDataMesh([{ path: 'x.yaml', text: 'hello: 1' }]);
    expect(none.yaml).toBe('');
    expect(none.problems).toEqual([{ message: 'No data products or data contracts found: none of these files is ODPS or ODCS', severity: 'error' }]);
  });

  it('keeps what was added by hand when it is imported again', async () => {
    const first = importDataMesh(mesh(all)).yaml;
    // The same files again: nothing moves.
    expect(importDataMesh(mesh(all), { existing: first }).yaml).toBe(first);

    const edited = first
      .replace('title: Data mesh', 'title: Our mesh # ours\nsubtitle: By hand')
      .replace('  revenue:\n    label: Revenue\n    class: consumer-aligned', '  revenue:\n    label: Revenue\n    caption: The number the board sees\n    class: aggregate # ours too')
      .replace('orders: { kind: table, contract: orders }', 'orders: { kind: view, label: Order table, contract: orders }')
      .replace('\ncontracts:\n', '\nconsumers:\n  cfo: { kind: dashboard, uses: [revenue] }\n\ncontracts:\n')
      .concat('\nviews:\n  lineage:\n    focus: { on: revenue, hops: all, direction: upstream }\n');
    const changed = { ...all, 'products/orders.yaml': orders.replace('name: Orders', 'name: Web orders').replace('version: 2.1.0\nstatus: active', 'version: 3.0.0\nstatus: deprecated') };
    const { yaml, doc, warnings } = await imported(changed, edited);
    expect(warnings).toEqual([]);
    expect(yaml).toContain('title: Our mesh # ours\nsubtitle: By hand');
    expect(yaml).toContain('class: aggregate # ours too');
    expect(doc.consumers).toEqual({ cfo: { kind: 'dashboard', uses: ['revenue'] } });
    expect(doc.views.lineage.focus).toEqual({ on: 'revenue', hops: 'all', direction: 'upstream' });
    expect(doc.products.revenue).toMatchObject({ caption: 'The number the board sees', class: 'aggregate' });
    // What the file says is followed; the id stays, so references and pinned positions hold.
    expect(doc.products.orders).toMatchObject({ label: 'Web orders', version: '3.0.0', status: 'deprecated' });
    expect(doc.products['web-orders']).toBeUndefined();
    // On a port the file wins where it speaks (the kind), and what it does not know stays.
    expect(doc.products.orders.outputs.orders).toEqual({ kind: 'table', label: 'Order table', contract: 'orders' });
    // Lists stay written the way they were.
    expect(yaml).toContain('uses: [revenue]');
    expect(yaml).not.toMatch(/\[ /);
  });

  it('drops what an earlier import made when its file is gone, and nothing made by hand', async () => {
    const first = importDataMesh(mesh(all)).yaml.replace('\nproducts:\n', '\nproducts:\n  legacy:\n    inputs: [shop]\n').replace('\nsources:\n', '\nsources:\n  shop: database\n');
    const { 'products/rates.yaml': rates, 'products/orders.yaml': product, ...rest } = all;
    const { doc, yaml, warnings } = await imported(rest, first);
    expect(warnings).toEqual([]);
    expect(Object.keys(doc.products).sort()).toEqual(['legacy', 'orders', 'revenue']);
    // The contract is still there, and stands for a product of its own now; what only the product file knew goes.
    expect(doc.products.orders).toEqual({ class: 'source-aligned', file: 'contracts/orders.yaml', outputs: { orders: { contract: 'orders' } } });
    expect(doc.products.revenue.inputs).toEqual([{ from: 'orders', name: 'sales orders' }, 'c-rates']);
    expect(doc.sources).toEqual({ shop: 'database', 'c-rates': { label: 'c-rates', caption: 'Outside the mesh' } });
    expect(yaml).not.toContain('webshop');
    expect(doc.domains).toEqual({ finance: { label: 'Finance' } });
    // And back: the source that stood for the missing product goes again.
    const back = await imported(all, yaml);
    expect(Object.keys(back.doc.sources)).toEqual(['shop', 'webshop-order-events']);
    expect(Object.keys(back.doc.products).sort()).toEqual(['exchange-rates', 'legacy', 'orders', 'revenue']);
  });

  it('keeps a product whose file is gone while something made by hand reads it', async () => {
    const first = importDataMesh(mesh(all)).yaml.replace('\ncontracts:\n', '\nconsumers:\n  desk: { kind: dashboard, uses: [exchange-rates.bulk] }\n\ncontracts:\n');
    const { 'products/rates.yaml': rates, ...rest } = all;
    const r = importDataMesh(mesh(rest), { existing: first });
    expect(r.problems).toEqual([{ message: 'Product "exchange-rates" is kept: products/rates.yaml is gone, but it is still read by what was added by hand', severity: 'warning' }]);
    expect((await render(r.yaml, { fonts: 'none', load: (f) => rest[f as keyof typeof rest] })).diagnostics).toEqual([]);
  });

  it('leaves a diagram of another type, or one it cannot read, alone', () => {
    const other = importDataMesh(mesh(all), { existing: 'type: systems\nnodes:\n  a: service\n' });
    expect(other.yaml).toBe('');
    expect(other.problems.at(-1)).toEqual({ message: 'The diagram is not a data-products diagram: not changed', severity: 'error' });
    const broken = importDataMesh(mesh(all), { existing: 'type: data-products\nproducts: [' });
    expect(broken.yaml).toBe('');
    expect(broken.problems.at(-1)!.message).toMatch(/^The diagram cannot be read \(.+\): not changed$/);
  });
});

describe('examples/data-products/mesh', () => {
  const dir = path.resolve(import.meta.dirname, '../../../examples/data-products');
  const walk = (d: string): string[] => fs.readdirSync(path.join(dir, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  const files = walk('mesh').map((p) => ({ path: p, text: fs.readFileSync(path.join(dir, p), 'utf8') }));
  const load = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');

  it('imports without a word', () => {
    const r = importDataMesh(files);
    expect(r.problems).toEqual([]);
    expect([r.products, r.contracts, r.skipped]).toEqual([6, 4, []]);
    expect(r.yaml).toMatchSnapshot();
  });

  it('is what mesh.yaml was made from: importing again changes nothing', () => {
    const existing = load('mesh.yaml');
    expect(importDataMesh(files, { existing }).yaml).toBe(existing);
  });

  it('draws the map, its views and the contracts in detail', async () => {
    const map = await render(load('mesh.yaml'), { fonts: 'none', load });
    expect(map.diagnostics).toEqual([]);
    expect(map.graph!.groups.map((g) => g.id).sort()).toEqual(['domain:customer', 'domain:finance', 'domain:sales']);
    const lineage = await render(load('mesh.yaml'), { fonts: 'none', load, view: 'revenue-lineage' });
    expect(lineage.diagnostics).toEqual([]);
    expect(lineage.graph!.nodes.map((n) => n.id).sort()).toEqual(['exchange-rates', 'orders', 'payment-provider-settlements', 'payments', 'revenue', 'webshop-order-events']);
    const detailed = await render(load('mesh-detailed.yaml'), { fonts: 'none', load });
    expect(detailed.diagnostics).toEqual([]);
    // Customer 360 and what it reads: the foreign keys of those three contracts, field to field, one of them inside orders.
    const keys = detailed.graph!.edges.filter((e) => e.tone === 'violet' && e.line === 'solid').map((e) => `${e.from.node}/${e.from.row} → ${e.to.node}/${e.to.row}`);
    expect(keys.sort()).toEqual([
      'contract:customer-profiles/field:0:customer_id → contract:customers/field:0:customer_id',
      'contract:orders/field:0:customer_id → contract:customers/field:0:customer_id',
      'contract:orders/field:1:order_id → contract:orders/field:0:order_id',
    ]);
    expect(detailed.focus).toMatchObject({ on: ['customer-360'], hops: 2, direction: 'upstream' });
  });
});
