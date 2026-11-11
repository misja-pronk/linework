// The path-based edits live in @cartography/core; tested here, against real types.
import { describe, expect, it } from 'vitest';
import { findType, render, types } from '@cartography/engine';
import { applyOperations, checkOperations, questionsFor, renamePins } from '@cartography/core';

const azure = findType('azure')!;
const shop = `type: azure
title: Shop   # keep this comment
groups:
  rg: { kind: resource-group, label: Production }
nodes:
  web: { kind: app-service, label: Web, in: rg }
  db: { kind: sql-database, label: Orders DB, in: rg }
edges:
  - web -> db: SQL
`;

describe('edits by path: checking the input', () => {
  it('accepts well-formed edits', () => {
    expect(checkOperations([{ op: 'set', path: ['nodes', 'cache'], value: { kind: 'redis' } }, { op: 'rename', path: ['nodes', 'web'], to: ' shop ' }])).toEqual([
      { op: 'set', path: ['nodes', 'cache'], value: { kind: 'redis' } },
      { op: 'rename', path: ['nodes', 'web'], to: 'shop' },
    ]);
  });

  it('refuses what does not fit, saying why', () => {
    expect(checkOperations([])).toMatchObject({ error: expect.stringContaining('non-empty') });
    expect(checkOperations('x')).toMatchObject({ error: expect.stringContaining('non-empty') });
    expect(checkOperations([{ op: 'set', path: ['nodes', 'x'] }])).toMatchObject({ error: expect.stringContaining('needs a "value"') });
    expect(checkOperations([{ op: 'move', path: ['nodes'] }])).toMatchObject({ error: expect.stringContaining('op must be') });
    expect(checkOperations([{ op: 'delete', path: [] }])).toMatchObject({ error: expect.stringContaining('path') });
    expect(checkOperations([{ op: 'delete', path: ['nodes', -1] }])).toMatchObject({ error: expect.stringContaining('path') });
    expect(checkOperations([{ op: 'rename', path: ['nodes', 'web'] }])).toMatchObject({ error: expect.stringContaining('"to"') });
    expect(checkOperations([{ op: 'delete', path: ['x'], extra: 1 }])).toMatchObject({ error: expect.stringContaining('"extra"') });
  });
});

describe('edits by path: applying them', () => {
  it('sets and appends while the rest keeps its exact text', async () => {
    const r = applyOperations(shop, azure, [
      { op: 'set', path: ['nodes', 'cache'], value: { kind: 'redis', label: 'Cache', in: 'rg' } },
      { op: 'append', path: ['edges'], value: 'web -> cache: reads' },
    ]);
    if ('error' in r) throw new Error(r.error);
    expect(r.text).toContain('title: Shop   # keep this comment');
    expect(r.text).toContain('  cache: { kind: redis, label: Cache, in: rg }');
    expect(r.text).toContain('- web -> cache: reads');
    expect((await render(r.text, { fonts: 'none' })).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('deletes an entry with the lines to it', () => {
    const r = applyOperations(shop, azure, [{ op: 'delete', path: ['nodes', 'db'] }]);
    if ('error' in r) throw new Error(r.error);
    expect(r.text).not.toContain('db');
  });

  it('renames with every reference, and a chain of renames is one', () => {
    const r = applyOperations(shop, azure, [
      { op: 'rename', path: ['nodes', 'db'], to: 'orders-db' },
      { op: 'rename', path: ['nodes', 'orders-db'], to: 'sql' },
    ]);
    if ('error' in r) throw new Error(r.error);
    expect(r.text).toContain('- web -> sql: SQL');
    expect([...r.renames]).toEqual([['db', 'sql']]);
  });

  it('stops at the first edit that cannot be done', () => {
    expect(applyOperations(shop, azure, [{ op: 'delete', path: ['nodes', 'nope'] }])).toMatchObject({ error: expect.stringContaining('edits[0]') });
    expect(applyOperations(shop, azure, [{ op: 'append', path: ['nodes'], value: 'x' }])).toMatchObject({ error: expect.stringContaining('map') });
    expect(applyOperations(shop, azure, [{ op: 'rename', path: ['nodes', 'web'], to: 'db' }])).toMatchObject({ error: expect.stringContaining('taken') });
    expect(applyOperations(shop, azure, [{ op: 'set', path: ['edges', 9], value: 'a -> b' }])).toMatchObject({ error: expect.stringContaining('append') });
  });

  it('moves pins with renamed ids', () => {
    const pins = { nodes: { db: { x: 1, y: 2 }, web: { x: 0, y: 0 } }, locked: ['db'] };
    expect(renamePins(pins, new Map([['db', 'sql']]))).toEqual({ nodes: { sql: { x: 1, y: 2 }, web: { x: 0, y: 0 } }, locked: ['sql'] });
    expect(renamePins(pins, new Map())).toBe(pins);
  });
});

describe('questions per type', () => {
  it('every type has questions, translated through say', () => {
    for (const t of types) expect(questionsFor(t).length).toBeGreaterThan(3);
    expect(questionsFor(azure, (s) => `!${s}`)[0]!.label.startsWith('!')).toBe(true);
  });
});
