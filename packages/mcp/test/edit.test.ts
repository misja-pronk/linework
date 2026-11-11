import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { describeDiagram, diffDiagrams, editDiagram, renderDiagram } from '../src/index.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-mcp-edit-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

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

describe('edit_diagram', () => {
  it('writes a valid change, keeps comments and moves the pins of a renamed id', async () => {
    const file = path.join(tmp, 'shop.yaml');
    fs.writeFileSync(file, shop);
    fs.writeFileSync(path.join(tmp, 'shop.layout.json'), JSON.stringify({ version: 1, nodes: { db: { x: 10, y: 20 } }, views: { a: { nodes: { db: { x: 1, y: 2 } } } } }));
    const r = await editDiagram({ file, edits: [{ op: 'rename', path: ['nodes', 'db'], to: 'orders' }, { op: 'set', path: ['nodes', 'cache'], value: { kind: 'redis', label: 'Cache', in: 'rg' } }, { op: 'append', path: ['edges'], value: 'web -> cache: reads' }] });
    expect(r).toMatchObject({ ok: true, written: file, renames: { db: 'orders' } });
    expect(r.quality).toBeDefined();
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toContain('title: Shop   # keep this comment');
    expect(text).toContain('- web -> orders: SQL');
    const pins = JSON.parse(fs.readFileSync(path.join(tmp, 'shop.layout.json'), 'utf8'));
    expect(pins.nodes).toEqual({ orders: { x: 10, y: 20 } });
    expect(pins.views.a.nodes).toEqual({ orders: { x: 1, y: 2 } });
  });

  it('writes nothing when the result does not validate, and says why', async () => {
    const file = path.join(tmp, 'bad.yaml');
    fs.writeFileSync(file, shop);
    const r = await editDiagram({ file, edits: [{ op: 'set', path: ['nodes', 'x'], value: { kind: 'not-a-kind' } }] });
    expect(r.ok).toBe(false);
    expect(r.written).toBeUndefined();
    expect(r.problems[0]).toMatchObject({ severity: 'error', line: 8 });
    expect(fs.readFileSync(file, 'utf8')).toBe(shop);
  });

  it('refuses edits that cannot be done, and a change that changes nothing', async () => {
    expect(await editDiagram({ yaml: shop, edits: [{ op: 'delete', path: ['nodes', 'nope'] }] })).toMatchObject({ ok: false, error: expect.stringContaining('nothing at that path') });
    expect(await editDiagram({ yaml: shop, edits: [{ op: 'set', path: ['nodes', 'web', 'label'], value: 'Web' }] })).toMatchObject({ error: expect.stringContaining('exactly as it is') });
    expect(await editDiagram({ yaml: shop, edits: [] })).toMatchObject({ error: expect.stringContaining('non-empty') });
    expect(await editDiagram({ yaml: 'nodes: {}\n', edits: [{ op: 'delete', path: ['nodes'] }] })).toMatchObject({ error: expect.stringContaining('type:') });
  });

  it('returns the new YAML for yaml input and with dryRun', async () => {
    const r = await editDiagram({ yaml: shop, edits: [{ op: 'set', path: ['nodes', 'web', 'label'], value: 'Storefront' }] });
    expect(r.yaml).toContain('label: Storefront');
    const file = path.join(tmp, 'dry.yaml');
    fs.writeFileSync(file, shop);
    const d = await editDiagram({ file, dryRun: true, edits: [{ op: 'delete', path: ['nodes', 'db'] }] });
    expect(d).toMatchObject({ ok: true });
    expect(d.written).toBeUndefined();
    expect(fs.readFileSync(file, 'utf8')).toBe(shop);
  });
});

describe('what the engine knows', () => {
  const ex = (p: string) => path.join(root, 'examples', p);

  it('describes a diagram in words', async () => {
    const r = await describeDiagram({ yaml: shop });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('Orders DB');
  });

  it('compares two files', async () => {
    const a = path.join(tmp, 'a.yaml');
    const b = path.join(tmp, 'b.yaml');
    fs.writeFileSync(a, shop);
    fs.writeFileSync(b, shop.replace('  - web -> db: SQL\n', '  - web -> db: SQL\n  - db -> web\n').replace('Orders DB', 'Orders'));
    const r = await diffDiagrams({ file: b, before: a });
    expect(r.summary).toMatch(/added|changed/);
    expect(r.explained.length).toBeGreaterThan(0);
    await expect(diffDiagrams({ file: b })).rejects.toThrow(/before.*ref/);
  });

  it('compares a file with itself at a git ref', async () => {
    const r = await diffDiagrams({ file: ex('azure/web-shop.yaml'), ref: 'HEAD' }, root);
    expect(r).toMatchObject({ ok: true, against: 'HEAD' });
  });

  it('renders a focus, a layer and a stage', async () => {
    const focus = await renderDiagram({ yaml: shop, focus: ['db'], hops: 0 });
    const all = await renderDiagram({ yaml: shop });
    expect(focus.ok && all.ok).toBe(true);
    expect(focus.svg!.length).toBeLessThan(all.svg!.length);
    expect((await renderDiagram({ file: ex('azure/web-shop.yaml'), layer: ['security'] })).ok).toBe(true);
    expect((await renderDiagram({ file: ex('transitions/datacenter-exit.yaml'), stage: 'overview' })).ok).toBe(true);
  });
});
