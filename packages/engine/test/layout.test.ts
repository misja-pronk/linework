// Layout quality guard: every example must stay clean, and crossings may not creep up.
// When a change improves an example, lower its budget.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { measure, routeEdges, throughVia } from '@cartography/layout';
import { render } from '../src/index.ts';
import { big } from './perf.ts';

const examples = path.resolve(import.meta.dirname, '../../../examples');
const crossingBudget: Record<string, number> = {
  'access/engineering.yaml': 0,
  'access/engineering-access.yaml': 0,
  'access/engineering-packages.yaml': 0,
  'access/engineering-roles.yaml': 0,
  'azure/data-platform.yaml': 0,
  'azure/hub-spoke.yaml': 1,
  'azure/microservices.yaml': 7,
  'azure/web-shop.yaml': 0,
  'data-products/customer.yaml': 0,
  'data-products/customer-detailed.yaml': 0,
  'data-products/customer-focus.yaml': 0,
  'data-products/finance.yaml': 0,
  'erd/orders.yaml': 0,
  'erd/saas.yaml': 6,
  'erd/shop-schemas.yaml': 0,
  'model/containers.yaml': 0,
  'model/context.yaml': 0,
  'model/deployment.yaml': 0,
  'model/model.yaml': 0,
  'github/setup.yaml': 0,
  'kubernetes/inference.yaml': 0,
  'kubernetes/platform.yaml': 0,
  'kubernetes/web-app.yaml': 0,
  'sequence/checkout.yaml': 0,
  'sequence/oauth-login.yaml': 0,
  'sequence/pipeline-handshake.yaml': 0,
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

describe('lines bent by hand', () => {
  const text = 'type: azure\nnodes:\n  a: app-service\n  b: sql-database\n  c: key-vault\nedges:\n  - a -> b\n  - a -> c\n';
  const orthogonal = (pts: { x: number; y: number }[]) => pts.slice(1).every((q, i) => q.x === pts[i]!.x || q.y === pts[i]!.y);
  it('run through their bend points, stay orthogonal and leave the boxes where they were', async () => {
    const free = await render(text, { fonts: 'none' });
    const s = free.placed!.shift!;
    const pts = free.placed!.edges.get('e0')!.points;
    // A detour 120px below the line's lowest point, entered and left from its first and last bends.
    const low = Math.max(...pts.map((q) => q.y)) + 120;
    const via = [{ x: pts[0]!.x + 20 + s.x, y: low + s.y }, { x: pts.at(-1)!.x - 20 + s.x, y: low + s.y }];
    const bent = await render(text, { fonts: 'none', sidecar: { version: 1, edges: { e0: { via } } } });
    const p = bent.placed!;
    const out = p.edges.get('e0')!.points.map((q) => ({ x: q.x + p.shift!.x, y: q.y + p.shift!.y }));
    expect(orthogonal(out)).toBe(true);
    for (const v of via) expect(out).toContainEqual(v);
    for (const id of ['a', 'b', 'c']) {
      const before = free.placed!.nodes.get(id)!;
      const after = p.nodes.get(id)!;
      expect({ x: after.x + p.shift!.x, y: after.y + p.shift!.y }).toEqual({ x: before.x + s.x, y: before.y + s.y });
    }
    // The other line still leaves and arrives where it did (its trunk partner went its own way, so the middle may differ).
    const e1 = (q: { x: number; y: number }[], o: { x: number; y: number }) => [q[0], q.at(-1)].map((r) => ({ x: r!.x + o.x, y: r!.y + o.y }));
    expect(e1(p.edges.get('e1')!.points, p.shift!)).toEqual(e1(free.placed!.edges.get('e1')!.points, s));
  });
  it('are ignored once the line at that position joins other nodes', async () => {
    const free = await render(text, { fonts: 'none' });
    const via = [{ x: 0, y: 900 }];
    const stale = await render(text, { fonts: 'none', sidecar: { version: 1, edges: { e0: { via, from: 'a', to: 'c' } } } });
    expect(stale.placed!.edges.get('e0')!.points).toEqual(free.placed!.edges.get('e0')!.points);
  });
  it('get corners where bends no longer line up with the ports', () => {
    const ports = { from: { x: 0, y: 0 }, start: { x: 16, y: 0 }, fromSide: 'E' as const, to: { x: 200, y: 100 }, goal: { x: 184, y: 100 }, toSide: 'W' as const };
    const pts = throughVia(ports, [{ x: 100, y: 40 }]);
    expect(orthogonal(pts)).toBe(true);
    expect(pts).toContainEqual({ x: 100, y: 40 });
    expect(pts.slice(-2)).toEqual([{ x: 184, y: 100 }, { x: 200, y: 100 }]);
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

describe('tidy lines', () => {
  const text = 'type: azure\nnodes:\n  bus: service-bus\n  a: app-service\n  b: function-app\n  c: app-service\nedges:\n  - bus -> a\n  - bus -> b\n  - bus -> c\n';
  it('fans out from one shared port as a trunk', async () => {
    const r = await render(text, { fonts: 'none' });
    const starts = [...r.placed!.edges.values()].map((e) => e.points[0]!);
    expect(new Set(starts.map((p) => `${p.x},${p.y}`)).size).toBe(1);
    expect(r.svg).toContain('<circle');
  });
  it('puts node centres on the 8px grid where there is room', async () => {
    const r = await render('type: azure\nnodes:\n  a: app-service\n  b: sql-database\n  c: key-vault\nedges:\n  - a -> b\n  - b -> c\n', { fonts: 'none' });
    for (const b of r.placed!.nodes.values()) {
      expect((b.x + b.width / 2) % 8).toBe(0);
      expect((b.y + b.height / 2) % 8).toBe(0);
    }
  });
});

describe('group titles', () => {
  // A node right under a title, fed from straight above: the line may not run through the title.
  const title = { x: 0, y: 160, width: 172, height: 18 };
  const end = (node: string, y: number) => ({ node, box: { x: 0, y, width: 172, height: 58 }, stub: 18 });
  const crosses = (pts: { x: number; y: number }[]) =>
    pts.slice(1).some((q, i) => {
      const p = pts[i]!;
      return Math.min(p.x, q.x) < title.x + title.width && Math.max(p.x, q.x) > title.x && Math.min(p.y, q.y) < title.y + title.height && Math.max(p.y, q.y) > title.y;
    });
  it('are never crossed by lines, also when the title covers the whole top of the node', () => {
    const out = routeEdges({ obstacles: new Map([['a', end('a', 0).box], ['b', end('b', 203).box]]), soft: [], texts: [title], direction: 'down', edges: [{ id: 'e', from: end('a', 0), to: end('b', 203) }] });
    expect(crosses(out.get('e')!.points)).toBe(false);
  });
  it('take the lane under them: a fan-out into the next row comes in from the top', async () => {
    const r = await render(fs.readFileSync(path.join(examples, 'systems/saas-platform.yaml'), 'utf8'), { fonts: 'none' });
    for (const id of ['lb', 'events']) {
      const lines = r.graph!.edges.filter((e) => e.from.node === id);
      for (const e of lines) {
        const pts = r.placed!.edges.get(e.id)!.points;
        const [a, b] = [pts[pts.length - 2]!, pts[pts.length - 1]!];
        expect(a.x === b.x && a.y < b.y).toBe(true);
      }
    }
  });
});
