// Layout quality guard: every example must stay clean, and crossings may not creep up.
// When a change improves an example, lower its budget.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { boxOverlaps, measure, routeEdges, throughVia } from '@cartography/layout';
import { render } from '../src/index.ts';
import { big, timed } from './perf.ts';

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
  'c4/kestrel-bank.yaml': 0,
  'c4/kestrel-bank.yaml#landscape': 0,
  'c4/kestrel-bank.yaml#context': 0,
  'c4/kestrel-bank.yaml#containers': 0,
  'c4/kestrel-bank.yaml#components': 2,
  'c4/kestrel-bank.yaml#payment': 0,
  'c4/kestrel-bank.yaml#production': 0,
  'cloud/aws-data-lake.yaml': 0,
  'cloud/aws-landing-zone.yaml': 0,
  'cloud/aws-three-tier.yaml': 0,
  'cloud/gcp-data-platform.yaml': 0,
  'cloud/multi-cloud.yaml': 0,
  'data-products/customer.yaml': 0,
  'data-products/customer-detailed.yaml': 0,
  'data-products/customer-focus.yaml': 0,
  'data-products/finance.yaml': 0,
  'deployment/aws.yaml': 1,
  'deployment/aws.yaml#prod': 1,
  'deployment/aws.yaml#test': 0,
  'deployment/aws.yaml#dev': 0,
  'deployment/azure.yaml': 0,
  'deployment/azure.yaml#prod': 0,
  'deployment/azure.yaml#test': 0,
  'deployment/azure.yaml#dev': 0,
  'deployment/model.yaml': 0,
  'deployment/model.yaml#context': 0,
  'deployment/model.yaml#containers': 0,
  'erd/orders.yaml': 0,
  'erd/saas.yaml': 6,
  'erd/shop-schemas.yaml': 0,
  'model/containers.yaml': 0,
  'model/context.yaml': 0,
  'model/deployment.yaml': 0,
  'model/model.yaml': 0,
  'network/campus.yaml': 0,
  'network/hybrid-cloud.yaml': 1, // the VPN backup passes the ExpressRoute gateway's line: both gateways stand in one subnet
  'network/office-ip-plan.yaml': 0,
  'network/small-office.yaml': 0,
  'github/setup.yaml': 0,
  'gitflow/git-flow.yaml': 0,
  'gitflow/github-flow-environments.yaml': 0,
  'gitflow/trunk-delivery.yaml': 0,
  'roadmap/migration-waves.yaml': 0,
  'roadmap/now-next-later.yaml': 0,
  'journey/access-request.yaml': 0,
  'journey/data-product-consumer.yaml': 0,
  'journey/developer-onboarding.yaml': 0,
  'journey/first-deploy.yaml': 0,
  'kubernetes/inference.yaml': 0,
  'kubernetes/platform.yaml': 0,
  'kubernetes/web-app.yaml': 0,
  'sequence/checkout.yaml': 0,
  'sequence/oauth-login.yaml': 0,
  'sequence/pipeline-handshake.yaml': 0,
  'systems/data-pipeline.yaml': 0,
  'systems/invoice-walkthrough.yaml': 2, // Orders' confirmation line passes its own OrderPlaced line: the lower drawing with one crossing scores a hair worse
  'systems/saas-platform.yaml': 2,
  'systems/web-shop.yaml': 0,
};

describe('layout quality', () => {
  const files = fs.readdirSync(examples).flatMap((d) => fs.readdirSync(path.join(examples, d)).filter((f) => f.endsWith('.yaml')).map((f) => `${d}/${f}`));
  // C4 examples are one model with many views: each view is a drawing of its own. So is each environment of a deployment.
  const views = files.filter((f) => f.startsWith('c4/') || f.startsWith('deployment/')).flatMap((f) => Object.keys(crossingBudget).filter((k) => k.startsWith(`${f}#`)));
  it('has a budget for every example', () => expect(files.sort()).toEqual(Object.keys(crossingBudget).filter((k) => !k.includes('#')).sort()));

  for (const key of [...files, ...views])
    it(key, async () => {
      const [file, view] = key.split('#') as [string, string | undefined];
      const load = (rel: string) => fs.readFileSync(path.resolve(examples, path.dirname(file), rel), 'utf8');
      const r = await render(fs.readFileSync(path.join(examples, file), 'utf8'), { fonts: 'none', load, view });
      if (file.startsWith('c4/') || file.startsWith('deployment/')) expect(r.diagnostics).toEqual([]);
      const m = measure(r.graph!, r.placed!);
      expect({ through: m.edgeThroughNode, labels: m.labelOverlaps, backward: m.backward, overlaps: m.overlaps }).toEqual({ through: 0, labels: 0, backward: 0, overlaps: 0 });
      expect(m.crossings).toBeLessThanOrEqual(crossingBudget[key]!);
    });

  const c4 = fs.readFileSync(path.join(examples, 'c4/kestrel-bank.yaml'), 'utf8');
  it('keeps groups apart in a deployment view drawn top-down', async () => {
    const down = c4.replace('    kind: deployment\n', '    kind: deployment\n    direction: down\n');
    expect(down).not.toBe(c4);
    const r = await render(down, { fonts: 'none', view: 'production' });
    expect(r.placed!.memory!.variant).toMatch(/^down\//);
    expect(boxOverlaps(r.graph!, r.placed!)).toEqual([]);
  });
  it('keeps the wide deployment view within 2600 px', async () => {
    const r = await render(c4, { fonts: 'none', view: 'production' });
    expect(r.placed!.width).toBeLessThan(2600);
  });
  it('starts the cards of one row on one line, top-down', async () => {
    const r = await render(c4, { fonts: 'none', view: 'containers' });
    expect(r.placed!.memory!.variant).toMatch(/^down\//);
    const tops = new Map<number, Set<number>>();
    for (const [id, b] of r.placed!.nodes) {
      if (r.graph!.edges.some((e) => e.from.node === id || e.to.node === id) === false) continue;
      const row = Math.round((b.y + b.height / 2) / 24);
      tops.set(row, (tops.get(row) ?? new Set()).add(b.y));
    }
    // Rows whose cards are joined by a line stay centred; the others share a top.
    const ragged = [...tops.values()].filter((t) => t.size > 1 && Math.max(...t) - Math.min(...t) < 24);
    expect(ragged).toEqual([]);
  });
  it('starts the cards of one column on one line, left to right', async () => {
    const r = await render(fs.readFileSync(path.join(examples, 'azure/data-platform.yaml'), 'utf8'), { fonts: 'none' });
    const left = ['web', 'crm', 'erp'].map((id) => r.placed!.nodes.get(id)!.x);
    expect(new Set(left).size).toBe(1);
  });

  it('lays out 200 nodes in under a second', async () => {
    await render(big(2, 5), { fonts: 'none' }); // load Graphviz first
    // Best of three, so a busy machine does not fail it.
    const { ms, result } = await timed(big(10, 20), {}, 3);
    expect(result.graph!.nodes).toHaveLength(200);
    expect(ms).toBeLessThan(1000);
  }, 20_000);

  it('and as fast one line later, knowing the drawing before', async () => {
    const text = big(10, 20);
    const before = await render(text, { fonts: 'none' });
    // A line right across the drawing: the longest route there can be. Best of two, so a busy machine does not fail it.
    const { ms, result } = await timed(text + '  - n0_1 -> n9_19\n', { previous: before.placed!.memory }, 2);
    expect(result.graph!.edges).toHaveLength(before.graph!.edges.length + 1);
    expect(ms).toBeLessThan(1000);
    // Drawn the way the drawing before was, and nothing that was there moved.
    expect(result.placed!.memory!.variant).toBe(before.placed!.memory!.variant);
    const was = before.placed!.memory!.nodes!;
    const now = result.placed!.memory!.nodes!;
    const far = [...was].filter(([id, p]) => Math.hypot(now.get(id)!.x - p.x, now.get(id)!.y - p.y) > 16);
    expect(far.length / was.size).toBeLessThan(0.1);
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
  it('are in the way of other lines: none runs on top of one', () => {
    // a and b side by side, their line straight between them; c and d below, their line bent up by
    // hand into exactly that corridor.
    const box = (x: number, y: number) => ({ x, y, width: 100, height: 60 });
    const end = (node: string, x: number, y: number) => ({ node, box: box(x, y), stub: 16 });
    const obstacles = new Map([['a', box(0, 0)], ['b', box(400, 0)], ['c', box(0, 200)], ['d', box(400, 200)]]);
    const straight = { id: 'ab', from: end('a', 0, 0), to: end('b', 400, 0) };
    const hand = { id: 'cd', from: end('c', 0, 200), to: end('d', 400, 200), via: [{ x: 150, y: 30 }, { x: 350, y: 30 }] };
    /** Length two polylines run on top of each other. */
    const shared = (p: { x: number; y: number }[], q: { x: number; y: number }[]) => {
      let total = 0;
      for (let i = 1; i < p.length; i++)
        for (let j = 1; j < q.length; j++) {
          const [a, b, c, d] = [p[i - 1]!, p[i]!, q[j - 1]!, q[j]!];
          if (a.y === b.y && c.y === d.y && a.y === c.y) total += Math.max(0, Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)));
          if (a.x === b.x && c.x === d.x && a.x === c.x) total += Math.max(0, Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)));
        }
      return total;
    };
    const alone = routeEdges({ obstacles, soft: [], direction: 'right', edges: [straight] });
    expect(alone.get('ab')!.points.every((q) => q.y === 30)).toBe(true);
    const both = routeEdges({ obstacles, soft: [], direction: 'right', edges: [straight, hand] });
    for (const v of hand.via) expect(both.get('cd')!.points).toContainEqual(v);
    expect(shared(both.get('ab')!.points, both.get('cd')!.points)).toBe(0);
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
