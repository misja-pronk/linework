import { describe, expect, it } from 'vitest';
import { findType, render } from '@linework/engine';
import { setUiLang } from '../src/i18n/index.ts';
import { addEntry, connectEntries, copyEntries, deleteEntries, deleteEntry, duplicateEntry, pasteEntries, edgeFields, fieldsFor, parentKey, renameEntry, setEdgeField, setField } from '../src/builder.ts';

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

  it('names a duplicate apart from its original: "Key Vault copy", then "Key Vault copy 2"', () => {
    const t = 'type: azure\nnodes:\n  kv: { kind: key-vault, label: Key Vault }\n';
    const once = duplicateEntry(t, ['nodes', 'kv'])!;
    expect(once.text).toContain('kv-2: { kind: key-vault, label: Key Vault copy }');
    expect(duplicateEntry(once.text, ['nodes', 'kv'])!.text).toContain('label: Key Vault copy 2 }');
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
    // "web -> db: SQL" is already there: a second, unlabelled line would be a duplicate.
    expect(connectEntries(shop, azure, 'web', 'db')).toEqual({ error: 'They are already connected' });
    expect(connectEntries(shop, azure, 'web', 'web')).toEqual({ error: 'Pick another element to connect to' });
  });
  it("says why not in the editor's language, also when the type says it", () => {
    setUiLang('nl');
    try {
      expect(connectEntries(shop, azure, 'web', 'web')).toEqual({ error: 'Kies een ander element om mee te verbinden' });
      const acc = 'type: access\nprincipals:\n  alice: user\n';
      expect(connectEntries(acc, access, 'alice', 'alice')).toEqual({ error: 'Kies een ander element om mee te verbinden' });
      expect(connectEntries('type: erd\ntables:\n  orders: {}\n', erd, 'x', 'orders')).toEqual({ error: 'Lijnen beginnen bij een tabel: sleep vanaf een tabel' });
    } finally {
      setUiLang(undefined);
    }
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

describe('review 3 cases', () => {
  const access = findType('access')!;
  const erd = findType('erd')!;
  it('removes a single approver field, not the whole policy', () => {
    const t = `type: access
principals:
  eng: group
  mgr: user
packages:
  dev:
    policy:
      - { requestors: eng, approval: mgr }
`;
    const d = deleteEntry(t, access, ['principals', 'mgr'])!;
    expect(d).toContain('requestors: eng');
    expect(d).not.toContain('approval');
  });
  it('lets an ERD table point at itself, and asks for a role first', () => {
    const t = 'type: erd\ntables:\n  employees:\n    columns:\n      id: int pk\n';
    expect(connectEntries(t, erd, 'employees', 'employees')).toMatchObject({ text: expect.stringContaining('employee_id: int fk employees') });
    expect(connectEntries('type: access\nprincipals:\n  a: user\nresources:\n  rg: resource-group\n', access, 'a', 'rg')).toEqual({ error: 'Add a role first: a person or group gets a role on a resource' });
  });
});

describe('copy, paste and delete several', () => {
  it('pastes under new ids with references inside the copied set remapped, and lines between them', async () => {
    const clip = copyEntries(shop, azure, [['groups', 'rg'], ['nodes', 'web'], ['nodes', 'db']])!;
    expect(clip.items.length).toBe(2);
    const r = pasteEntries(shop, azure, clip)!;
    expect(r.text).toContain('rg-2: { kind: resource-group, label: Production copy }');
    expect(r.text).toContain('web-2: { kind: app-service, in: rg-2 }');
    expect(r.text).toContain('- web-2 -> db-2: SQL');
    expect(r.text).toContain('- db-2 -> web-2');
    expect(r.text).toContain('# keep this comment');
    expect((await render(r.text, { fonts: 'none' })).diagnostics).toEqual([]);
  });

  it('keeps references to what was not copied', () => {
    const r = pasteEntries(shop, azure, copyEntries(shop, azure, [['nodes', 'web']])!)!;
    expect(r.text).toContain('web-2: { kind: app-service, in: rg }');
    expect(r.text).not.toContain('web-2 ->');
  });

  it('deletes several entries and lines in one edit', () => {
    const t = deleteEntries(shop, azure, [['edges', 0], ['nodes', 'db']])!;
    expect(t).not.toContain('db');
    expect(t).toContain('web:');
  });
});
