// A cut of the stability lab (stability.ts; `pnpm stability` runs all of it): one line or one
// element added to an example moves few of the nodes that were already there, as long as the
// drawing before the edit is known.
import { describe, expect, it } from 'vitest';
import { measure } from '@cartography/layout';
import { render } from '../src/index.ts';
import { lab, moved, summary } from './stability.ts';

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
  it('a line that finds no clean way between the boxes where they stood moves one node, not most', async () => {
    // The web shop on Kubernetes (as the example was before its nodes were put in another order). Held
    // as it was, the customers' new line to Postgres crosses four lines; drawn afresh, most cards move.
    // Held but for one card, which looks for room again, it crosses none.
    const nodes = ['customers: { kind: users, label: Customers }', 'ingress: { kind: ingress, label: shop, in: shop, host: shop.acme.io }', 'web-svc: { kind: service, label: web, in: shop, ports: [80] }', 'web: { kind: deployment, in: shop, replicas: 2 }', 'api-svc: { kind: service, label: api, in: shop, ports: ["80:8080"] }', 'api: { kind: deployment, in: shop }', 'api-hpa: { kind: hpa, in: shop, replicas: 3-12 }', 'worker: { kind: deployment, label: order-worker, in: shop, replicas: 2 }', 'nightly: { kind: cronjob, label: invoice-run, in: shop, schedule: "0 3 * * *" }', 'postgres: { kind: statefulset, in: shop }', 'redis: { kind: statefulset, in: shop }', 'pg-data: { kind: pvc, label: data, in: shop, size: 50Gi }', 'redis-data: { kind: pvc, label: data, in: shop, size: 5Gi }', 'api-config: { kind: configmap, in: shop }', 'db-credentials: { kind: secret, in: shop }', 'shop-tls: { kind: secret, in: shop }', 'api-sa: { kind: serviceaccount, label: shop-api, in: shop }', 'stripe: { kind: external, label: Stripe }'];
    const edges = ['customers -> ingress: HTTPS', 'ingress -> shop-tls', 'ingress -> web-svc: /', 'ingress -> api-svc: /api', 'web-svc -> web', 'api-svc -> api', 'api -> postgres: SQL', 'api -> redis', 'api -> stripe: payments', 'api -> api-config', 'api -> db-credentials', 'api -> api-sa', 'api-hpa -> api', 'worker -> postgres', 'worker -> db-credentials', 'nightly -> postgres', 'nightly -> db-credentials', 'postgres -> pg-data', 'postgres -> db-credentials', 'redis -> redis-data'];
    const text = `type: kubernetes\ntitle: Web shop\ngroups:\n  prod: { kind: cluster, label: prod-eu-1 }\n  shop: { kind: namespace, in: prod }\nnodes:\n${nodes.map((n) => `  ${n}\n`).join('')}edges:\n${edges.map((e) => `  - ${e}\n`).join('')}`;
    const before = await render(text, { fonts: 'none' });
    const after = await render(`${text}  - customers -> postgres\n`, { fonts: 'none', previous: before.placed!.memory });
    expect(moved(before.placed!.memory!.nodes!, after.placed!.memory!.nodes!)).toBeLessThan(0.1);
    expect(measure(after.graph!, after.placed!).crossings).toBe(0);
  });

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
