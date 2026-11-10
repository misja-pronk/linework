// A cut of the stability lab (stability.ts; `pnpm stability` runs all of it): one line or one
// element added to an example moves few of the nodes that were already there, as long as the
// drawing before the edit is known.
import { describe, expect, it } from 'vitest';
import { render } from '../src/index.ts';
import { lab, summary } from './stability.ts';

const files = ['azure/hub-spoke', 'network/small-office', 'kubernetes/web-app', 'erd/orders', 'systems/data-pipeline', 'data-products/finance', 'github/setup'].map((f) => `examples/${f}.yaml`);
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

describe('stability', () => {
  it('an added line or element moves under a tenth of what was there', async () => {
    const rows = summary(await lab(files, { edges: 3, nodes: 2 }));
    // Each file, and the views a file has (data products: overview and detailed) after it.
    expect([...new Set(rows.map((r) => r.drawing.split('#')[0]))]).toEqual(files.map((f) => f.replace('examples/', '')));
    for (const kind of ['edge', 'node'] as const) {
      const tried = rows.filter((r) => r[kind].n);
      expect(tried.length).toBeGreaterThanOrEqual(6);
      // Per drawing, and over all of them.
      for (const r of tried) expect(r[kind].kept, `${r.drawing}, ${kind} added`).toBeLessThan(0.1);
      // Drawn from scratch the same edits shuffle a good part of the drawing: that is what the memory is for.
      expect(mean(tried.map((r) => r[kind].fresh))).toBeGreaterThan(0.2);
    }
  }, 120_000);
});

describe('staying put', () => {
  it('a line drawn between two cards placed before it reads forward, not up', async () => {
    const base = 'type: azure\ngroups:\n  sub: { kind: subscription, label: Subscription }\n  rg: { kind: resource-group, label: Resource group, in: sub }\nnodes:\n  sql: { kind: sql-database, label: SQL Database }\n';
    const app = '  app: { kind: app-service, label: App Service, in: rg }\n';
    const one = await render(base, { fonts: 'none' });
    const two = await render(base + app, { fonts: 'none', previous: one.placed!.memory });
    const linked = await render(`${base}${app}edges:\n  - app -> sql\n`, { fonts: 'none', previous: two.placed!.memory });
    const a = linked.placed!.nodes.get('app')!;
    const b = linked.placed!.nodes.get('sql')!;
    // Left to right: the database right of the app (or below it in the same column), never above.
    expect(b.x >= a.x + a.width || b.y >= a.y + a.height).toBe(true);
  });
});
