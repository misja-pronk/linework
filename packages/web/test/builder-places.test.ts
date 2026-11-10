import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { findType, render } from '@cartography/engine';
import { deleteEntry, renameEntry } from '../src/builder.ts';

const azure = findType('azure')!;
const errors = async (text: string) => (await render(text, { fonts: 'none' })).diagnostics.filter((d) => d.severity === 'error');

// Steps, focus, views, threats and trust name drawn things too: a delete or rename in the builder follows them.
const told = `type: azure
groups:
  vnet: { kind: vnet, label: vnet-shop, trust: true }
nodes:
  users: users
  web: { kind: app-service, in: vnet }
  api: { kind: container-app, in: vnet }
  vault: { kind: key-vault, in: vnet }
  db: { kind: sql-database }
edges:
  - users -> web
  - web -> api
  - api -> vault
  - api -> db
threats:
  - { on: vault, stride: I, title: Secrets leak }
  - { on: "api -> db", stride: T, title: SQL injection }
trust: [vnet]
steps:
  - users -> web -> api: A customer orders.
  - api -> vault
  - title: Secrets
    caption: From Key Vault.
    path: api -> vault
    show: [vault, db]
    note: { vault: Managed identity, db: Encrypted }
`;

describe('builder delete and rename follow place-references', () => {
  it('deleting a node leaves no step, focus, threat or note naming it', async () => {
    const t = deleteEntry(told, azure, ['nodes', 'vault'])!;
    expect(t).not.toMatch(/vault/);
    expect(t).toContain('title: Secrets');
    expect(t).toContain('show: [db]');
    expect(t).toContain('SQL injection');
    expect(await errors(t)).toEqual([]);
  });

  it('a route step keeps its caption', async () => {
    const t = deleteEntry(told, azure, ['nodes', 'web'])!;
    expect(t).toContain('- A customer orders.');
    expect(await errors(t)).toEqual([]);
  });

  it('a focus loses what is gone, and goes when it names nothing', async () => {
    const focused = told + 'focus: { on: [vault, api], hops: 1 }\n';
    let t = deleteEntry(focused, azure, ['nodes', 'vault'])!;
    expect(t).toContain('focus: { on: [api], hops: 1 }');
    t = deleteEntry(t, azure, ['nodes', 'api'])!;
    expect(t).not.toMatch(/^focus/m);
    expect(await errors(t)).toEqual([]);
  });

  it('deleting a group takes it out of trust:', () => {
    const t = deleteEntry(told, azure, ['groups', 'vnet'])!;
    expect(t).not.toMatch(/^trust/m);
  });

  it('renaming follows steps, notes, focus and threats', async () => {
    const t = renameEntry(told, azure, ['nodes', 'vault'], 'secrets')!;
    expect(t).not.toMatch(/vault:|-> vault|\[vault|on: vault/);
    expect(t).toContain('path: api -> secrets');
    expect(t).toContain('secrets: Managed identity');
    expect(t).toContain('- api -> secrets');
    expect(await errors(t)).toEqual([]);
  });

  it('the web-shop example: deleting Key Vault leaves no error (review 3)', async () => {
    const shop = readFileSync(new URL('../../../examples/azure/web-shop.yaml', import.meta.url), 'utf8');
    const t = deleteEntry(shop, azure, ['nodes', 'vault'])!;
    expect(t).toContain('title: No secrets in code');
    expect(await errors(t)).toEqual([]);
  });
});
