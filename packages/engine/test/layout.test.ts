// Layout quality guard: every example must stay clean, and crossings may not creep up.
// When a change improves an example, lower its budget.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { measure } from '@cartography/layout';
import { render } from '../src/index.ts';
import { big } from './perf.ts';

const examples = path.resolve(import.meta.dirname, '../../../examples');
const crossingBudget: Record<string, number> = {
  'access/engineering.yaml': 4,
  'access/engineering-access.yaml': 0,
  'access/engineering-packages.yaml': 0,
  'access/engineering-roles.yaml': 0,
  'azure/data-platform.yaml': 0,
  'azure/hub-spoke.yaml': 1,
  'azure/microservices.yaml': 8,
  'azure/web-shop.yaml': 0,
  'data-products/customer.yaml': 0,
  'data-products/customer-detailed.yaml': 0,
  'data-products/customer-focus.yaml': 0,
  'data-products/finance.yaml': 1,
  'erd/orders.yaml': 0,
  'erd/saas.yaml': 8,
  'erd/shop-schemas.yaml': 0,
  'github/setup.yaml': 0,
  'systems/data-pipeline.yaml': 0,
  'systems/saas-platform.yaml': 2,
  'systems/web-shop.yaml': 0,
};

describe('layout quality', () => {
  const files = fs.readdirSync(examples).flatMap((d) => fs.readdirSync(path.join(examples, d)).filter((f) => f.endsWith('.yaml')).map((f) => `${d}/${f}`));
  it('has a budget for every example', () => expect(files.sort()).toEqual(Object.keys(crossingBudget).sort()));

  for (const file of files)
    it(file, async () => {
      const load = (rel: string) => fs.readFileSync(path.resolve(examples, path.dirname(file), rel), 'utf8');
      const r = await render(fs.readFileSync(path.join(examples, file), 'utf8'), { fonts: 'none', load });
      const m = measure(r.graph!, r.placed!);
      expect({ through: m.edgeThroughNode, labels: m.labelOverlaps, backward: m.backward }).toEqual({ through: 0, labels: 0, backward: 0 });
      expect(m.crossings).toBeLessThanOrEqual(crossingBudget[file]!);
    });

  it('lays out 200 nodes in under a second', async () => {
    await render(big(2, 5), { fonts: 'none' }); // load Graphviz first
    const t = performance.now();
    const r = await render(big(10, 20), { fonts: 'none' });
    expect(r.graph!.nodes).toHaveLength(200);
    expect(performance.now() - t).toBeLessThan(1000);
  });
});

describe('pins', () => {
  it('moves what is in the way of a pinned node, never the pinned node', async () => {
    const text = 'type: azure\nnodes:\n  a: app-service\n  b: sql-database\n  c: key-vault\nedges:\n  - a -> b\n  - a -> c\n';
    const free = await render(text, { fonts: 'none' });
    const shift = free.placed!.shift!;
    const b = free.placed!.nodes.get('b')!;
    // Pin c right on top of b.
    const pinned = await render(text, { fonts: 'none', sidecar: { version: 1, nodes: { c: { x: b.x + shift.x, y: b.y + shift.y } } } });
    const nb = pinned.placed!.nodes.get('b')!;
    const nc = pinned.placed!.nodes.get('c')!;
    const overlap = nb.x < nc.x + nc.width && nc.x < nb.x + nb.width && nb.y < nc.y + nc.height && nc.y < nb.y + nb.height;
    expect(overlap).toBe(false);
    expect({ x: nc.x + pinned.placed!.shift!.x, y: nc.y + pinned.placed!.shift!.y }).toEqual({ x: b.x + shift.x, y: b.y + shift.y });
  });
});

describe('moved groups', () => {
  it('carry their contents, also with an empty group inside', async () => {
    const text = 'type: azure\ngroups:\n  rg: resource-group\n  empty: { kind: subnet, in: rg }\nnodes:\n  a: { kind: app-service, in: rg }\n  b: sql-database\nedges:\n  - a -> b\n';
    const free = await render(text, { fonts: 'none' });
    const g = free.placed!.groups.get('rg')!;
    const s = free.placed!.shift!;
    const moved = await render(text, { fonts: 'none', sidecar: { version: 1, groups: { rg: { x: g.x + s.x, y: g.y + s.y + 200 } } } });
    expect(moved.diagnostics).toEqual([]);
    const a0 = free.placed!.nodes.get('a')!;
    const a1 = moved.placed!.nodes.get('a')!;
    const g1 = moved.placed!.groups.get('rg')!;
    // Same offset inside the group as before.
    expect(a1.y - g1.y).toBeCloseTo(a0.y - g.y, 0);
  });
});
