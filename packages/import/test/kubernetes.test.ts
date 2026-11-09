import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { render } from '@cartography/engine';
import { importKubernetes, isKubernetes } from '../src/index.ts';

const dir = path.join(import.meta.dirname, 'k8s');
const read = (...files: string[]) => files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n---\n');

async function imported(text: string) {
  const r = importKubernetes(text, 'Test');
  const check = await render(r.yaml, { fonts: 'none' });
  expect(check.diagnostics).toEqual([]);
  return { ...r, doc: parse(r.yaml), graph: check.graph! };
}

describe('importKubernetes', () => {
  it('tells manifests from diagrams and Mermaid', () => {
    expect(isKubernetes(read('shop.yaml'))).toBe(true);
    expect(isKubernetes(read('kubectl-get.yaml'))).toBe(true);
    expect(isKubernetes('{"apiVersion": "v1", "kind": "Service", "metadata": {"name": "a"}}')).toBe(true);
    expect(isKubernetes('type: kubernetes\nnodes:\n  a: deployment\n')).toBe(false);
    expect(isKubernetes('flowchart LR\n  kind --> apiVersion\n')).toBe(false);
  });

  it('links ingress → service → workload and folds what workloads use into badges', async () => {
    const { doc, graph, warnings } = await imported(read('shop.yaml'));
    expect(doc.groups['ns-shop']).toEqual({ kind: 'namespace', label: 'shop', in: 'cluster' });
    expect(doc.nodes.api).toEqual({ kind: 'deployment', in: 'ns-shop', replicas: 3, image: 'ghcr.io/acme/shop-api:1.4.2' });
    expect(doc.nodes['api-svc']).toEqual({ kind: 'service', label: 'api', in: 'ns-shop', ports: ['80:8080'] });
    expect(doc.nodes.shop).toMatchObject({ kind: 'ingress', host: 'shop.example.com' });
    expect(doc.nodes['api-hpa']).toMatchObject({ kind: 'hpa', replicas: '3-12' });
    expect(doc.edges).toEqual(
      expect.arrayContaining([
        { 'internet -> shop': 'HTTPS' },
        { 'shop -> web-svc': '/' },
        { 'shop -> api-svc': '/api' },
        'api-svc -> api',
        'api -> api-config',
        'api -> db-credentials',
        'api -> shop-api',
        'api-hpa -> api',
        'default-deny -> web',
      ]),
    );
    // The envoy sidecar does not replace the main image; the unused ConfigMap stays out.
    expect(doc.nodes.leftover).toBeUndefined();
    expect(warnings.join()).toMatch(/1 ConfigMap/);
    const folded = graph.nodes.filter((n) => n.folded).map((n) => n.id).sort();
    expect(folded).toEqual(['api-config', 'api-hpa', 'db-credentials', 'default-deny', 'shop-api', 'shop-tls']);
  });

  it('merges several files: claim templates, cron jobs and shared secrets', async () => {
    const { doc } = await imported(read('shop.yaml', 'postgres.yaml'));
    expect(doc.nodes.postgres).toMatchObject({ kind: 'statefulset', image: 'postgres:16.4', ports: [5432] });
    expect(doc.nodes.postgres.replicas).toBeUndefined();
    expect(doc.nodes['postgres-svc']).toMatchObject({ kind: 'service', label: 'postgres' });
    expect(doc.nodes.data).toEqual({ kind: 'pvc', in: 'ns-shop', size: '50Gi' });
    expect(doc.nodes.backups).toMatchObject({ kind: 'pvc', size: '200Gi' });
    expect(doc.nodes.backup).toMatchObject({ kind: 'cronjob', schedule: '0 3 * * *' });
    expect(doc.edges).toEqual(expect.arrayContaining(['postgres-svc -> postgres', 'postgres -> data', 'backup -> backups', 'backup -> db-credentials', 'postgres -> db-credentials']));
    // One secret, used by three workloads: still one node.
    expect(Object.values(doc.nodes).filter((n: any) => n.kind === 'secret')).toHaveLength(2);
  });

  it('reads kubectl get -o yaml: Lists, owned pods and cluster noise left out', async () => {
    const { doc, warnings } = await imported(read('kubectl-get.yaml'));
    expect(Object.keys(doc.nodes).sort()).toEqual(['grafana', 'grafana-datasources', 'grafana-svc', 'internet', 'promtail', 'promtail-sa']);
    expect(doc.nodes['grafana-svc']).toMatchObject({ serviceType: 'LoadBalancer', ports: ['80:3000'] });
    expect(doc.edges).toEqual(expect.arrayContaining(['internet -> grafana-svc', 'grafana-svc -> grafana', 'grafana -> grafana-datasources', 'promtail -> promtail-sa']));
    expect(warnings).toEqual([]);
  });

  it('reads helm template output without namespaces, skipping test hooks', async () => {
    const { doc, warnings } = await imported(read('helm-template.yaml'));
    expect(Object.keys(doc.groups)).toEqual(['cluster', 'ns-default']);
    expect(Object.keys(doc.nodes).sort()).toEqual(['release-podinfo', 'release-podinfo-svc']);
    expect(doc.edges).toEqual(['release-podinfo-svc -> release-podinfo']);
    expect(warnings).toEqual(['Left out: PodDisruptionBudget']);
  });

  it('turns HTTPRoutes into gateway → service lines across namespaces', async () => {
    const { doc } = await imported(read('gateway.yaml'));
    expect(doc.nodes.public).toEqual({ kind: 'gateway', in: 'ns-gateway', host: '*.example.com' });
    expect(doc.edges).toEqual([{ 'internet -> public': 'HTTPS' }, { 'public -> api': '/api' }, 'public -> web']);
  });

  it('reads JSON and says so when there is nothing to draw', () => {
    expect(importKubernetes('{"kind": "List", "apiVersion": "v1", "items": [{"apiVersion": "v1", "kind": "Service", "metadata": {"name": "a"}}]}').yaml).toContain('a: { kind: service');
    expect(importKubernetes('# nothing\n').warnings).toEqual(['No Kubernetes resources found']);
  });
});
