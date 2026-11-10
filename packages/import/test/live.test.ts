import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { render } from '@cartography/engine';
import { importKubernetes } from '../src/index.ts';
import { fetchLive, livePlan, refusal, withoutSecrets, type Argv, type Ran } from '../src/live.ts';

describe('the allow-list', () => {
  it('lets the reading commands through', () => {
    for (const argv of [
      ['kubectl', 'config', 'current-context'],
      ['kubectl', 'get', 'deployments,services', '-o', 'json', '-A', '--context', 'prod'],
      ['kubectl', 'get', 'secrets', '-o', 'custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name,TYPE:.type', '--no-headers', '-n', 'shop'],
      ['az', 'graph', 'query', '-q', "resources | where resourceGroup in~ ('rg-a')", '--first', '1000', '--subscriptions', 'e251188d-1e09-f37d-cf3f-842941c7a93f', '--skip-token', 'abc', '-o', 'json'],
      ['az', 'role', 'assignment', 'list', '--all', '--include-inherited', '-o', 'json'],
      ['az', 'ad', 'group', 'member', 'list', '--group', 'a6ba93a4-1fc4-1fbb-825e-1276e79c844a', '-o', 'json'],
      ['gh', 'auth', 'status'],
      ['gh', 'api', '--paginate', '--slurp', 'orgs/kestrel/teams/platform/members'],
      ['gh', 'api', 'repos/kestrel/shop/contents/.github/CODEOWNERS', '-H', 'Accept: application/vnd.github.raw'],
      ['gh', 'api', '--paginate', '--slurp', 'repos/kestrel/shop/branches/release%2F2.0/protection'],
    ])
      expect(refusal(argv), argv.join(' ')).toBeUndefined();
  });

  it('refuses everything that writes, runs code, reads values or is not on the list', () => {
    for (const argv of [
      ['kubectl', 'delete', 'deployment', 'api'],
      ['kubectl', 'apply', '-f', 'x.yaml'],
      ['kubectl', 'exec', 'api', '--', 'sh'],
      ['kubectl', 'get', 'pods', '-o', 'json'],
      ['kubectl', 'get', 'secrets', '-o', 'json'],
      ['kubectl', 'get', 'secrets', '-o', 'yaml'],
      ['kubectl', 'get', 'secrets', '-o', 'custom-columns=DATA:.data'],
      ['kubectl', 'get', 'secrets,deployments', '-o', 'custom-columns=NAME:.metadata.name'],
      ['kubectl', 'get', 'deployments', '-o', 'json', '--kubeconfig', '/tmp/x'],
      ['kubectl', 'get', 'deployments', '-o', 'json', '-n', 'a', '-A'],
      ['kubectl', 'config', 'use-context', 'prod'],
      ['az', 'role', 'assignment', 'create', '--role', 'Owner'],
      ['az', 'role', 'assignment', 'delete', '--ids', 'x'],
      ['az', 'graph', 'query', '-q', '@/etc/passwd'],
      ['az', 'rest', '--method', 'post', '--url', 'x'],
      ['az', 'ad', 'group', 'member', 'add', '--group', 'a6ba93a4-1fc4-1fbb-825e-1276e79c844a'],
      ['az', 'ad', 'group', 'member', 'list', '--group', 'sg-admins; rm -rf /'],
      ['gh', 'api', '-X', 'DELETE', 'repos/kestrel/shop'],
      ['gh', 'api', '--method', 'POST', 'orgs/kestrel/teams'],
      ['gh', 'api', 'orgs/kestrel/teams', '-f', 'name=x'],
      ['gh', 'api', 'graphql'],
      ['gh', 'api', 'user'],
      ['gh', 'api', 'orgs/kestrel/teams', '--input', 'x.json'],
      ['gh', 'api', 'repos/kestrel/shop/contents/.github/CODEOWNERS/../../x'],
      ['gh', 'repo', 'delete', 'kestrel/shop'],
      ['gh', 'auth', 'token'],
      ['sh', '-c', 'kubectl get pods'],
      ['/usr/local/bin/kubectl', 'get', 'deployments', '-o', 'json'],
      [],
    ])
      expect(refusal(argv), argv.join(' ')).toBeTypeOf('string');
  });

  it('passes every command the plans show, with the placeholders filled in', () => {
    const plans = [
      ...livePlan('k8s', { context: 'prod', allNamespaces: true }),
      ...livePlan('k8s', { namespace: 'shop' }),
      ...livePlan('azure', { withAccess: true, rg: 'rg-a,rg-b', subscription: 'e251188d-1e09-f37d-cf3f-842941c7a93f' }),
      ...livePlan('github', { org: 'kestrel' }),
    ];
    const fill = { '<team>': 'platform', '<repo>': 'shop', '<id>': '12', '<group>': 'a6ba93a4-1fc4-1fbb-825e-1276e79c844a', '<default branch>': 'main' };
    for (const line of plans) {
      let l = line.replace(/\s+#.*$/, '');
      for (const [k, v] of Object.entries(fill)) l = l.split(k).join(v);
      // Undo the quoting of shown(): split on spaces outside '…'.
      const argv = [...l.matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)].map((m) => (m[1] !== undefined ? m[1].replace(/'\\''/g, "'") : m[2]!));
      expect(refusal(argv), line).toBeUndefined();
    }
  });

  it('a runner handed in is never asked to run what the list refuses', async () => {
    const asked: Argv[] = [];
    const run = async (argv: Argv): Promise<Ran> => (asked.push(argv), { code: 0, stdout: argv[1] === 'config' ? 'ctx\n' : '{"items":[]}', stderr: '' });
    // A context that would sneak a flag in: refused before anything runs.
    await expect(fetchLive('k8s', { context: '--kubeconfig=/x' }, run)).rejects.toThrow(/not a context name/);
    await expect(fetchLive('k8s', { namespace: 'a b' }, run)).rejects.toThrow(/not a namespace name/);
    await expect(fetchLive('github', { org: 'x/../y' }, run)).rejects.toThrow(/not an organisation name/);
    expect(asked).toEqual([]);
  });
});

describe('withoutSecrets', () => {
  it('takes out data, literal env values, command lines and annotations, and keeps what the importer reads', () => {
    const out = withoutSecrets({
      kind: 'List',
      items: [
        { kind: 'Secret', metadata: { name: 'db', annotations: { 'kubectl.kubernetes.io/last-applied-configuration': '{"data":{"p":"c2VjcmV0"}}' } }, type: 'Opaque', data: { p: 'c2VjcmV0' }, stringData: { p: 'secret' } },
        { kind: 'ConfigMap', metadata: { name: 'cfg' }, data: { url: 'postgres://u:pw@db' }, binaryData: { b: 'AA==' } },
        {
          kind: 'Deployment',
          metadata: { name: 'api', annotations: { 'helm.sh/hook': 'pre-install', other: 'x' }, managedFields: [{}] },
          spec: { template: { spec: { containers: [{ image: 'api:1', command: ['run', '--token=t0k3n'], args: ['--pw=pw'], env: [{ name: 'A', value: 'literal' }, { name: 'B', valueFrom: { secretKeyRef: { name: 'db', key: 'p' } } }] }] } } },
          status: { replicas: 1 },
        },
      ],
    });
    expect(JSON.stringify(out)).not.toMatch(/c2VjcmV0|secret"|postgres:|AA==|t0k3n|--pw|literal|last-applied|managedFields|status/);
    expect(out.items[0]).toEqual({ kind: 'Secret', metadata: { name: 'db' }, type: 'Opaque' });
    expect(out.items[2]!.metadata).toEqual({ name: 'api', annotations: { 'helm.sh/hook': 'pre-install' } });
    expect(out.items[2]!.spec!.template.spec.containers[0]).toEqual({ image: 'api:1', env: [{ name: 'A' }, { name: 'B', valueFrom: { secretKeyRef: { name: 'db', key: 'p' } } }] });
  });
});

const manifests = (replicas: number, extra = '') => `
apiVersion: apps/v1
kind: Deployment
metadata: { name: api, namespace: shop }
spec:
  replicas: ${replicas}
  selector: { matchLabels: { app: api } }
  template:
    metadata: { labels: { app: api } }
    spec: { containers: [{ name: api, image: "api:1" }] }
---
apiVersion: v1
kind: Service
metadata: { name: api, namespace: shop }
spec: { selector: { app: api }, ports: [{ port: 80, targetPort: 8080 }] }
${extra}`;
const worker = `---
apiVersion: apps/v1
kind: Deployment
metadata: { name: worker, namespace: shop }
spec:
  selector: { matchLabels: { app: worker } }
  template:
    metadata: { labels: { app: worker } }
    spec: { containers: [{ name: w, image: "worker:1" }] }
`;

describe('importKubernetes over an earlier import', () => {
  it('follows the cluster and keeps what was written by hand', async () => {
    const first = importKubernetes(manifests(2, worker), 'Shop', {}).yaml;
    expect(parse(first).nodes.api).toEqual({ kind: 'deployment', in: 'ns-shop', replicas: 2, image: 'api:1', tags: ['imported'] });
    const edited = first
      .replace('title: Shop', 'title: The shop # ours')
      .replace('  api: {', '  # The API\n  api: { label: Orders API,')
      .replace('\nedges:', '\n  db: { kind: external, label: Managed database }\n\nedges:') + '  - api -> db\n';
    const again = importKubernetes(manifests(4), 'Shop', { existing: edited });
    const doc = parse(again.yaml);
    expect(again.yaml).toContain('title: The shop # ours');
    expect(again.yaml).toContain('# The API');
    expect(doc.nodes.api).toEqual({ label: 'Orders API', kind: 'deployment', in: 'ns-shop', replicas: 4, image: 'api:1', tags: ['imported'] });
    expect(doc.nodes.db).toEqual({ kind: 'external', label: 'Managed database' });
    expect(doc.nodes.worker).toBeUndefined();
    expect(doc.edges).toEqual(['api-svc -> api', 'api -> db']);
    expect((await render(again.yaml, { fonts: 'none' })).diagnostics).toEqual([]);
    // Nothing changed in the cluster: nothing changes in the file.
    expect(importKubernetes(manifests(4), 'Shop', { existing: again.yaml }).yaml).toBe(again.yaml);
  });

  it('finds an entry whose id was renamed, and treats untagged entries of a file import as the same things', () => {
    const first = importKubernetes(manifests(2), 'Shop', {}).yaml.replace(/\bapi-svc\b/g, 'orders-svc');
    const doc = parse(importKubernetes(manifests(3), 'Shop', { existing: first }).yaml);
    expect(Object.keys(doc.nodes).sort()).toEqual(['api', 'orders-svc']);
    expect(doc.edges).toEqual(['orders-svc -> api']);

    const plain = importKubernetes(manifests(2), 'Shop').yaml.replace('\nedges:', '  extra: { kind: external }\n\nedges:');
    const over = parse(importKubernetes(manifests(5), 'Shop', { existing: plain }).yaml);
    expect(over.nodes.api).toMatchObject({ replicas: 5, tags: ['imported'] });
    expect(over.nodes.extra).toEqual({ kind: 'external' });
  });

  it('leaves a diagram of another type alone', () => {
    const r = importKubernetes(manifests(2), 'Shop', { existing: 'type: azure\nnodes:\n  a: app-service\n' });
    expect(r.yaml).toBe('type: azure\nnodes:\n  a: app-service\n');
    expect(r.warnings).toContain('The diagram is not a kubernetes diagram: not changed');
  });
});
