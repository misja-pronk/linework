import { describe, expect, it } from 'vitest';
import { icon } from '@linework/icons';
import { chips, withoutBadges } from '@linework/core';
import { render } from '@linework/engine';
import { config, guidance, kubernetes, shortImage } from '../src/index.ts';

const shop = `type: kubernetes
groups:
  prod: cluster
  shop: { kind: namespace, in: prod }
nodes:
  ing: { kind: ingress, in: shop, host: shop.example.com }
  api-svc: { kind: service, label: api, in: shop, ports: ["80:8080"] }
  api: { kind: deployment, in: shop, replicas: 3, image: ghcr.io/acme/api:1.4 }
  cfg: { kind: configmap, label: api-config, in: shop }
  hpa: { kind: hpa, in: shop, replicas: 2-10 }
  sa: { kind: serviceaccount, in: shop }
  lonely: { kind: secret, in: shop }
edges:
  - ing -> api-svc: /api
  - api-svc -> api
  - api -> cfg
  - hpa -> api
  - api -> sa
`;

describe('kubernetes', () => {
  it('has an icon for every kind', () => {
    for (const [kind, k] of Object.entries({ ...config.nodeKinds, ...config.groupKinds })) expect(icon(k.icon), kind).toBeDefined();
  });

  it('names resources by id and puts replicas, image and ports in the caption', async () => {
    const r = await render(shop, { fonts: 'none' });
    expect(r.diagnostics).toEqual([]);
    const shape = (id: string) => r.graph!.nodes.find((n) => n.id === id)!.shape;
    expect(shape('api')).toMatchObject({ label: 'api', caption: 'Deployment · ×3 · api:1.4' });
    expect(shape('api-svc')).toMatchObject({ label: 'api', caption: 'Service · :80→8080' });
    expect(shape('ing')).toMatchObject({ caption: 'Ingress · shop.example.com' });
  });

  it('infers styles from the kinds and badges mounts, identity and scaling by default', async () => {
    const r = await render(shop, { fonts: 'none' });
    const kinds = r.graph!.edges.map((e) => [e.kind, !!e.badge]);
    expect(kinds).toEqual([['Traffic', false], ['Traffic', false], ['Mounts', true], ['Scales', true], ['Identity', true]]);
    // The autoscaler's chip sits on the workload, whichever way the edge was written.
    expect(chips(r.graph!).get('api')!.map((c) => c.label)).toEqual(['api-config', 'HPA ×2–10', 'sa']);
  });

  it('folds what is only a badge, keeps the rest as cards', async () => {
    const r = await render(shop, { fonts: 'none' });
    const folded = r.graph!.nodes.filter((n) => n.folded).map((n) => n.id);
    expect(folded).toEqual(['cfg', 'hpa', 'sa']);
    expect(withoutBadges(r.graph!).nodes.map((n) => n.id)).not.toContain('cfg');
    expect(r.placed!.nodes.has('cfg')).toBe(false);
    expect(r.placed!.nodes.has('lonely')).toBe(true);
  });

  it('draws everything as lines with an empty badges list', async () => {
    const r = await render(shop + 'badges: []\n', { fonts: 'none' });
    expect(r.graph!.edges.some((e) => e.badge)).toBe(false);
    expect(r.graph!.nodes.some((n) => n.folded)).toBe(false);
  });

  it('keeps an explicit style and a dashed operator', async () => {
    const r = await render('type: kubernetes\nnodes:\n  a: deployment\n  b: statefulset\n  c: deployment\nedges:\n  - a -> b: { style: policy }\n  - a --> c\n', { fonts: 'none' });
    expect(r.graph!.edges.map((e) => [e.kind, e.line])).toEqual([['Network policy', 'dashed'], [undefined, 'dashed']]);
  });

  it('rejects unknown fields', async () => {
    const r = await render('type: kubernetes\nnodes:\n  a: { kind: deployment, replica: 3 }\n', { fonts: 'none' });
    expect(r.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('shortens images to name and tag', () => {
    expect(shortImage('ghcr.io/acme/shop/api:1.4')).toBe('api:1.4');
    expect(shortImage('postgres')).toBe('postgres');
    expect(shortImage('acme/api@sha256:0123456789abcdef')).toBe('api@0123456');
  });

  it('renders its template cleanly and connects with the short form', async () => {
    const r = await render(kubernetes.template, { fonts: 'none' });
    expect(r.diagnostics).toEqual([]);
    expect(kubernetes.connect!({ nodes: { a: 'deployment', b: 'configmap' } }, 'a', 'b')).toEqual({ path: ['edges'], value: 'a -> b' });
    expect(guidance.useWhen).toHaveLength(3);
  });
});
