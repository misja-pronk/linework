// Sketching edits: Tab (a connected box), Enter (a sibling), naming with a kind prefix, changing the
// kind, grouping. Each is a text edit the type reads back without errors.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { findType, render } from '@cartography/engine';
import type { Graph } from '@cartography/core';
import { addConnected, addFirst, addSibling, groupInto, groupKinds, idFor, matchKinds, nameEntry, plainItem, readTyped, setKind, shapeKinds } from '../src/sketch.ts';

const azure = findType('azure')!;
const proc = findType('process')!;
const graphOf = (text: string, type = azure): Graph => type.build(parse(text), { error() {}, warn() {} });
const problems = async (text: string) => (await render(text, { fonts: 'none' })).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
const blank = 'type: azure\ntitle: Untitled\n';

describe('kind by typing', () => {
  const items = shapeKinds(azure);
  it('finds a kind by its id, initials, keyword or letters in order', () => {
    expect(matchKinds('firewall', items)[0]!.kind).toBe('firewall');
    expect(matchKinds('fw', items)[0]!.kind).toBe('firewall');
    expect(matchKinds('kv', items)[0]!.kind).toBe('key-vault');
    expect(matchKinds('apim', items)[0]!.kind).toBe('api-management');
    expect(matchKinds('sql', items)[0]!.kind).toMatch(/^sql-/);
    expect(matchKinds('zzz', items)).toEqual([]);
  });
  it('reads a prefix only when it names a kind', () => {
    expect(readTyped('fw: Edge firewall', items)).toMatchObject({ name: 'Edge firewall', query: 'fw', kind: { kind: 'firewall' } });
    expect(readTyped('kv:', items)).toMatchObject({ name: '', kind: { kind: 'key-vault' } });
    expect(readTyped('Orders API', items)).toEqual({ name: 'Orders API' });
    expect(readTyped('Step 1: check', items)).toEqual({ name: 'Step 1: check' });
    expect(readTyped('https://example.com', items)).toEqual({ name: 'https://example.com' });
    expect(readTyped('qqq: Something', items)).toEqual({ name: 'qqq: Something' });
  });
  it('starts a blank sheet with a plain box, and tells shapes from groups', () => {
    expect(plainItem(azure)!.kind).toBe('service');
    expect(groupKinds(azure).every((g) => g.collection === 'groups')).toBe(true);
    expect(shapeKinds(azure).some((g) => g.collection === 'groups')).toBe(false);
  });
});

describe('a sketch, step by step', () => {
  it('adds a first box, names it, and the id follows the name', async () => {
    const first = addFirst(blank, azure)!;
    expect(first.id).toBe('service');
    const named = nameEntry(first.text, azure, first.path, 'Orders API', true)!;
    expect(named.path).toEqual(['nodes', 'orders-api']);
    expect(named.text).toContain('orders-api: { kind: service, label: Orders API }');
    expect(await problems(named.text)).toEqual([]);
  });

  it('Tab adds a box of the same kind, connected from the selected one, in its group', async () => {
    const text = `type: azure
groups:
  rg: { kind: resource-group, label: rg-shop }
nodes:
  web: { kind: app-service, label: Web, in: rg }
`;
    const r = addConnected(text, azure, graphOf(text), 'web')!;
    expect(r.id).toBe('app-service');
    expect(r.text).toContain('app-service: { kind: app-service, label: App Service, in: rg }');
    expect(r.text).toMatch(/edges:\n\s+- web -> app-service/);
    expect(await problems(r.text)).toEqual([]);
    // Another Tab from the same box: a second, under its own id.
    const again = addConnected(r.text, azure, graphOf(r.text), 'web')!;
    expect(again.id).toBe('app-service-2');
    expect(again.text).toContain('- web -> app-service-2');
  });

  it('Enter adds a sibling, connected from the same source when there is one', async () => {
    const text = `type: azure
nodes:
  web: { kind: app-service, label: Web }
  api: { kind: function-app, label: API }
edges:
  - web -> api
`;
    const r = addSibling(text, azure, graphOf(text), 'api')!;
    expect(r.id).toBe('function-app');
    expect(r.text).toContain('- web -> function-app');
    expect(await problems(r.text)).toEqual([]);
    // Two sources: which one is not clear, so it stands alone.
    const two = `${text}  - db -> api\n`.replace('nodes:\n', 'nodes:\n  db: { kind: sql-database, label: DB }\n');
    const alone = addSibling(two, azure, graphOf(two), 'api')!;
    expect(alone.text).not.toContain('-> function-app');
    // No source: a box beside it, unconnected.
    const top = addSibling(text, azure, graphOf(text), 'web')!;
    expect(top.text).not.toContain('-> app-service');
  });

  it('a kind prefix changes the kind; a box still named after its kind is renamed with it', async () => {
    const text = 'type: azure\nnodes:\n  a: { kind: service, label: Service }\n  b: { kind: service, label: Orders }\n';
    const a = setKind(text, azure, ['nodes', 'a'], 'firewall')!;
    expect(a).toContain('a: { kind: firewall, label: Firewall }');
    const b = setKind(text, azure, ['nodes', 'b'], 'firewall')!;
    expect(b).toContain('b: { kind: firewall, label: Orders }');
    expect(await problems(b)).toEqual([]);
    // Shorthand ("db: sql-database") turns into the long form.
    expect(setKind('type: azure\nnodes:\n  db: sql-database\n', azure, ['nodes', 'db'], 'postgres')).toContain('db: { kind: postgres }');
  });

  it('renaming keeps the id when the name is taken, or when not asked to follow', () => {
    const text = 'type: azure\nnodes:\n  orders: { kind: service, label: Service }\n  service: { kind: service, label: Service }\n';
    expect(nameEntry(text, azure, ['nodes', 'service'], 'Orders', true)!.path).toEqual(['nodes', 'service']);
    expect(nameEntry(text, azure, ['nodes', 'service'], 'Billing', false)!.path).toEqual(['nodes', 'service']);
    expect(nameEntry(text, azure, ['nodes', 'service'], '  ', true)).toBeUndefined();
    expect(idFor('Café Überweg!')).toBe('cafe-uberweg');
  });

  it('groups boxes into a new group, or into one that is there', async () => {
    const text = 'type: azure\nnodes:\n  a: { kind: service, label: A }\n  b: { kind: service, label: B }\n  c: { kind: service, label: C }\n';
    const rg = azure.palette.find((p) => p.kind === 'resource-group')!;
    const g = groupInto(text, azure, graphOf(text), ['a', 'b'], { item: rg })!;
    expect(g.id).toBe('resource-group');
    expect(g.text).toContain('a: { kind: service, label: A, in: resource-group }');
    expect(g.text).toContain('b: { kind: service, label: B, in: resource-group }');
    expect(g.text).toContain('c: { kind: service, label: C }');
    expect(await problems(g.text)).toEqual([]);
    const more = groupInto(g.text, azure, graphOf(g.text), ['c'], 'resource-group')!;
    expect(more.text).toContain('c: { kind: service, label: C, in: resource-group }');
  });

  it('works for a type whose steps are their names', async () => {
    const text = 'type: process\nflow:\n  - start -> Ask -> end\n';
    const r = addConnected(text, proc, graphOf(text, proc), 'Ask')!;
    expect(r.id).toBeTruthy();
    const named = nameEntry(r.text, proc, r.path, 'Check stock', true)!;
    expect(named.text).toContain('Check stock');
    expect(named.text).toMatch(/Ask -> Check stock/);
    expect(await problems(named.text)).toEqual([]);
  });
});
