import { describe, expect, it } from 'vitest';
import { findType, render } from '@cartography/engine';
import { addEntry, connectEntries, deleteEntry, duplicateEntry, edgeFields, fieldsFor, parentKey, renameEntry, setEdgeField, setField } from '../src/builder.ts';

const azure = findType('azure')!;
const dp = findType('data-products')!;
const item = (type: typeof azure, collection: string, kind: string) => type.palette.find((p) => p.collection === collection && p.kind === kind)!;

const shop = `type: azure
title: Shop   # keep this comment
groups:
  rg: { kind: resource-group, label: Production }
nodes:
  web: { kind: app-service, in: rg }
  db: { kind: sql-database, in: rg }
edges:
  - web -> db: SQL
  - db -> web
`;

describe('builder edits', () => {
  it('adds a palette item as a new entry inside a group, keeping comments', async () => {
    const r = addEntry(shop, azure, item(azure, 'nodes', 'key-vault'), { collection: 'groups', id: 'rg' })!;
    expect(r.id).toBe('key-vault');
    expect(r.text).toContain('# keep this comment');
    expect(r.text).toContain('key-vault: { kind: key-vault, label: Key Vault, in: rg }');
    expect((await render(r.text, { fonts: 'none' })).diagnostics).toEqual([]);
  });

  it('uses the class key for data products and unique ids', () => {
    const once = addEntry('type: data-products\n', dp, item(dp, 'products', 'aggregate'))!;
    const twice = addEntry(once.text, dp, item(dp, 'products', 'aggregate'))!;
    expect(twice.text).toContain('aggregate: { class: aggregate, label: Aggregate }');
    expect(twice.id).toBe('aggregate-2');
  });

  it('knows how entries nest', () => {
    expect(parentKey(azure, 'nodes', 'groups')).toBe('in');
    expect(parentKey(dp, 'products', 'domains')).toBe('domain');
  });

  it('sets and clears fields, expanding shorthand', () => {
    const t = setField('type: data-products\nsources:\n  db: database\n', dp, ['sources', 'db'], 'label', 'Orders DB')!;
    expect(t).toContain('db: { kind: database, label: Orders DB }');
    expect(setField(t, dp, ['sources', 'db'], 'label', '')).toContain('db: { kind: database }');
  });

  it('renames an entry and every reference', () => {
    const t = renameEntry(shop, azure, ['nodes', 'db'], 'orders-db')!;
    expect(t).toContain('orders-db: { kind: sql-database, in: rg }');
    expect(t).toContain('- web -> orders-db: SQL');
    expect(t).toContain('- orders-db -> web');
    expect(renameEntry(t, azure, ['groups', 'rg'], 'prod')).toContain('web: { kind: app-service, in: prod }');
    expect(renameEntry(shop, azure, ['nodes', 'db'], 'web')).toBeUndefined();
  });

  it('deletes an entry with the edges and parent keys that name it', () => {
    const t = deleteEntry(shop, azure, ['nodes', 'db'])!;
    expect(t).not.toContain('db');
    expect(t).toContain('edges: []');
    expect(deleteEntry(shop, azure, ['groups', 'rg'])).toContain('web: { kind: app-service }');
  });

  it('duplicates next to the original', () => {
    const r = duplicateEntry(shop, ['nodes', 'web'])!;
    expect(r.id).toBe('web-2');
    expect(r.text).toMatch(/web: \{ kind: app-service, in: rg \}\n  web-2: \{ kind: app-service, in: rg \}/);
  });

  it('builds a typed form from the schema', () => {
    const f = fieldsFor(shop, azure, ['nodes', 'web']);
    expect(f[0]).toMatchObject({ key: 'label', kind: 'text' });
    expect(f.find((x) => x.key === 'kind')).toMatchObject({ kind: 'select', value: 'app-service' });
    expect(f.find((x) => x.key === 'in')).toMatchObject({ kind: 'select', value: 'rg', options: ['rg'] });
  });
});

describe('connections', () => {
  const access = findType('access')!;
  const erd = findType('erd')!;
  it('adds an edge for graph types', () => {
    const r = connectEntries(shop, azure, 'web', 'rg');
    expect(r).toMatchObject({ text: expect.stringContaining('- web -> rg') });
    expect(connectEntries(shop, azure, 'web', 'db')).toMatchObject({ text: expect.stringContaining('- web -> db\n') });
  });
  it('follows the type: inputs, member-of, foreign keys', () => {
    const dpText = 'type: data-products\nsources:\n  db: database\nproducts:\n  orders:\n    inputs: [db]\n  revenue: {}\n';
    expect(connectEntries(dpText, dp, 'orders', 'revenue')).toMatchObject({ text: expect.stringContaining('revenue: { inputs: [orders] }') });
    expect(connectEntries(dpText, dp, 'db', 'orders')).toEqual({ error: 'They are already connected' });
    const acc = 'type: access\nprincipals:\n  alice: user\n  devs: group\n';
    expect(connectEntries(acc, access, 'alice', 'devs')).toMatchObject({ text: expect.stringContaining('alice: { kind: user, member-of: [devs] }') });
    const db = 'type: erd\ntables:\n  orders:\n    columns:\n      id: uuid pk\n  customers:\n    columns:\n      id: bigint pk\n';
    expect(connectEntries(db, erd, 'orders', 'customers')).toMatchObject({ text: expect.stringContaining('customer_id: bigint fk customers') });
  });
  it('edits a line, keeping the shortest form', () => {
    const labelled = setEdgeField(shop, ['edges', 1], 'label', 'reads')!;
    expect(labelled).toContain('- db -> web: reads');
    const styled = setEdgeField(labelled, ['edges', 1], 'style', 'private')!;
    expect(styled).toContain('- db -> web: { label: reads, style: private }');
    expect(setEdgeField(setEdgeField(styled, ['edges', 1], 'style', undefined)!, ['edges', 1], 'label', '')).toContain('- db -> web\n');
    expect(edgeFields(styled, azure, ['edges', 1]).find((f) => f.key === 'style')).toMatchObject({ kind: 'select', value: 'private' });
  });
});

describe('references, not text matches', () => {
  const access = findType('access')!;
  const erd = findType('erd')!;
  it('leaves labels, kinds and other collections alone on rename', () => {
    const t = `type: azure
nodes:
  web: { kind: app-service, label: web traffic, caption: db.example.com }
  key-vault: { kind: key-vault }
  db: { kind: sql-database }
edges:
  - web -> db: reads db
`;
    const r = renameEntry(t, azure, ['nodes', 'db'], 'orders')!;
    expect(r).toContain('caption: db.example.com');
    expect(r).toContain('- web -> orders: reads db');
    expect(renameEntry(t, azure, ['nodes', 'key-vault'], 'vault')).toContain('vault: { kind: key-vault }');
    expect(renameEntry(t, azure, ['nodes', 'web'], 'site')).toContain('label: web traffic');
  });

  it('keeps product references when a contract with the same name changes', () => {
    const t = `type: data-products
products:
  orders:
    outputs:
      orders: { kind: table, contract: orders }
  revenue:
    inputs: [orders.orders]
contracts:
  orders: { version: 1 }
`;
    const r = renameEntry(t, dp, ['contracts', 'orders'], 'orders-v1')!;
    expect(r).toContain('contract: orders-v1');
    expect(r).toContain('inputs: [orders.orders]');
    const d = deleteEntry(t, dp, ['contracts', 'orders'])!;
    expect(d).toContain('inputs: [orders.orders]');
    expect(d).toContain('orders: { kind: table }');
    expect(renameEntry(t, dp, ['products', 'orders'], 'sales')).toContain('inputs: [sales.orders]');
  });

  it('follows foreign keys and assignments', () => {
    const db = `type: erd
tables:
  customers:
    columns:
      id: uuid pk
  orders:
    columns:
      customer_id: uuid fk customers.id null
`;
    expect(renameEntry(db, erd, ['tables', 'customers'], 'clients')).toContain('customer_id: uuid fk clients.id null');
    expect(deleteEntry(db, erd, ['tables', 'customers'])).toContain('customer_id: uuid null');
    const acc = `type: access
principals:
  alice: user
  devs: { kind: group }
resources:
  rg: resource-group
roles:
  reader: {}
assignments:
  - devs is reader on rg
  - alice is reader on rg
`;
    const r = renameEntry(acc, access, ['principals', 'devs'], 'developers')!;
    expect(r).toContain('- developers is reader on rg');
    const d = deleteEntry(acc, access, ['principals', 'devs'])!;
    expect(d).not.toContain('devs is reader');
    expect(d).toContain('- alice is reader on rg');
  });

  it('touches only the changed lines of a hand-formatted file', () => {
    const t = `type: azure
nodes:
    web:   { kind: app-service }    # front


    db:
        kind: sql-database
`;
    expect(setField(t, azure, ['nodes', 'db'], 'label', 'Orders')).toBe(t.replace('        kind: sql-database\n', '        kind: sql-database\n        label: Orders\n'));
  });
});
