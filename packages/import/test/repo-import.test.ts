// Diagrams from a code repository: Compose, Helm (with its own Go template subset), Bicep, OpenAPI,
// AsyncAPI, GitHub Actions and the scan that finds them all. Each syntax feature on its own, then the
// sample repository in examples/repo/shop as a whole.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { render } from '@cartography/engine';
import { compileBicep, importAsyncApi, importAzure, importCompose, importHelm, importOpenApi, importWorkflow, isAsyncApi, isCompose, isOpenApi, isRepo, isWorkflow, renderChart, scanRepo, type ChartFile } from '../src/index.ts';
import { Warnings } from '../src/text.ts';

const repo = path.resolve(import.meta.dirname, '../../../examples/repo/shop');
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const repoFiles = () => walk(repo).map((p) => ({ path: path.relative(repo, p).split(path.sep).join('/'), text: fs.readFileSync(p, 'utf8') }));

async function drawn(yaml: string) {
  const r = await render(yaml, { fonts: 'none' });
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return { doc: parse(yaml) as Record<string, any>, graph: r.graph! };
}

// ---------------------------------------------------------------- Compose

describe('importCompose', () => {
  it('tells a Compose file from manifests and diagrams', () => {
    expect(isCompose('services:\n  web:\n    image: nginx\n')).toBe(true);
    expect(isCompose('apiVersion: v1\nkind: Service\nservices: {}\n')).toBe(false);
    expect(isCompose('type: systems\nservices:\n  a: { image: x }\n')).toBe(false);
  });

  it('guesses kinds from images, names what is built from its Dockerfile', async () => {
    const r = importCompose(
      `services:
  api: { build: ./api, depends_on: [db, cache, mq, kafka] }
  db: { image: postgres:16 }
  cache: { image: "docker.io/library/redis:7-alpine" }
  mq: { image: rabbitmq:3.13-management }
  kafka: { image: bitnami/kafka:3.7 }
  proxy: { image: traefik:v3.0, depends_on: [api] }
  auth: { image: quay.io/keycloak/keycloak:25.0 }
  files: { image: minio/minio }
  search: { image: opensearchproject/opensearch:2 }
  jobs: { build: ./api, command: celery worker }
`,
      { files: { 'api/Dockerfile': 'FROM golang:1.22 AS build\nRUN go build\nFROM gcr.io/distroless/static\nCOPY --from=build /x /x\n' } },
    );
    const { doc } = await drawn(r.yaml);
    expect(Object.fromEntries(Object.entries(doc.nodes).map(([k, v]: [string, any]) => [k, v.kind]))).toEqual({ api: 'api', db: 'database', cache: 'cache', mq: 'queue', kafka: 'topic', proxy: 'gateway', auth: 'identity', files: 'storage', search: 'search', jobs: 'worker' });
    // The runtime image says nothing (distroless): the stage it was built in does.
    expect(doc.nodes.api.caption).toBe('Go 1.22');
    expect(doc.nodes.db.caption).toBe('PostgreSQL 16');
    expect(doc.edges).toEqual(expect.arrayContaining([{ 'api -> db': { style: 'data' } }, { 'api -> mq': { style: 'async' } }, { 'proxy -> api': { style: 'sync' } }]));
  });

  it('reads depends_on in its long form, links and the URLs in the environment', async () => {
    const { doc } = await drawn(
      importCompose(`services:
  web:
    image: node:20
    links: ["api:backend"]
    environment: [API=http://api:8000]
  api:
    image: python:3.12
    depends_on: { db: { condition: service_healthy } }
    environment: { DATABASE_URL: "postgresql+psycopg://u:p@db:5432/x" }
  db: { image: mysql:8 }
`).yaml,
    );
    expect(doc.edges).toEqual([{ 'web -> api': { label: 'HTTP', style: 'sync' } }, { 'api -> db': { label: 'SQL', style: 'data' } }]);
  });

  it('draws networks as zones, published ports from outside, volumes as badges or a shared store', async () => {
    const r = importCompose(`services:
  gw: { image: nginx, ports: ["443:443", "127.0.0.1:9000:9000"], networks: [front, back] }
  app: { image: node:20, networks: [back], volumes: [data:/data, ./src:/src] }
  backup: { image: alpine, networks: [back], volumes: [shared:/s] }
  report: { image: alpine, networks: [back], volumes: [{ type: volume, source: shared, target: /s }] }
  ui: { image: node:20, networks: [front], ports: [{ target: 80, published: 8080 }] }
volumes: { data: {}, shared: {} }
networks: { front: {}, back: { internal: true } }
`);
    const { doc } = await drawn(r.yaml);
    expect(doc.groups).toEqual({ 'net-front': { kind: 'zone', label: 'front' }, 'net-back': { kind: 'zone', label: 'back (internal)' } });
    // In two networks: between them, in neither.
    expect(doc.nodes.gw.in).toBeUndefined();
    expect(doc.nodes.app).toMatchObject({ in: 'net-back', badges: ['data'] });
    expect(doc.nodes['vol-shared']).toEqual({ kind: 'storage', label: 'shared', caption: 'volume' });
    expect(doc.edges).toEqual(expect.arrayContaining([{ 'outside -> gw': { label: ':443', style: 'sync' } }, { 'outside -> ui': { label: ':8080', style: 'sync' } }, { 'backup -> vol-shared': { style: 'data' } }]));
    expect(r.warnings.join()).toMatch(/127\.0\.0\.1.*gw :9000/);
  });

  it('merges anchors, extends and overrides; warns about profiles, include and extends from another file', async () => {
    const r = importCompose(
      `include: [other/compose.yaml]
x-base: &base
  image: python:3.12
  restart: always
services:
  base: { <<: *base, command: serve }
  child: { extends: base, depends_on: [db] }
  far: { extends: { file: common.yaml, service: x }, image: alpine }
  db: { image: postgres }
  mail: { image: mailhog/mailhog, profiles: [dev] }
`,
      { overrides: ['services:\n  child:\n    depends_on: [mail]\n'] },
    );
    const { doc } = await drawn(r.yaml);
    expect(doc.nodes.child.caption).toBe('Python 3.12');
    expect(doc.edges).toEqual(expect.arrayContaining([{ 'child -> db': { style: 'data' } }, { 'child -> mail': { style: 'sync' } }]));
    expect(doc.nodes.mail.badges).toEqual(['profile dev']);
    const w = r.warnings.join('\n');
    expect(w).toMatch(/include: names 1 other Compose file/);
    expect(w).toMatch(/far extends x of common\.yaml/);
    expect(w).toMatch(/mail only runs with a profile \(dev\)/);
  });
});

// ---------------------------------------------------------------- Helm

const chart = (templates: Record<string, string>, values = '', extra: ChartFile[] = []): ChartFile[] => [
  { path: 'Chart.yaml', text: 'apiVersion: v2\nname: demo\nversion: 1.2.3\nappVersion: "4.5"\n' },
  { path: 'values.yaml', text: values },
  ...Object.entries(templates).map(([p, text]) => ({ path: `templates/${p}`, text })),
  ...extra,
];
const rendered = (files: ChartFile[], values?: string) => {
  const w = new Warnings();
  return { ...renderChart(files, { values }, w), warnings: w.list };
};

describe('Helm templates', () => {
  it('trims, looks up values, and runs if / else if / else', () => {
    const r = rendered(
      chart({ 'a.yaml': 'a: {{ .Values.x }}\n{{- if eq .Values.mode "one" }}\nb: 1\n{{- else if eq .Values.mode "two" }}\nb: 2\n{{- else }}\nb: 3\n{{- end }}\nc: {{ .Chart.Name }}-{{ .Chart.AppVersion }}-{{ .Release.Name }}\n' }, 'x: hello\nmode: two\n'),
    );
    expect(r.manifests).toContain('a: hello\nb: 2\nc: demo-4.5-demo');
  });

  it('ranges over lists and maps (sorted), with $i, $v and else; break', () => {
    const r = rendered(chart({ 'a.yaml': '{{- range $i, $v := .Values.list }}\n- {{ $i }}={{ $v }}{{ end }}\n{{- range $k, $v := .Values.map }}\n{{ $k }}: {{ $v.n }}{{ end }}\n{{- range .Values.none }}x{{ else }}\nempty{{ end }}\n{{- range .Values.list }}{{ if eq . "b" }}{{ break }}{{ end }}\n* {{ . }}{{ end }}' }, 'list: [a, b, c]\nmap: { z: { n: 1 }, a: { n: 2 } }\n'));
    expect(r.manifests).toContain('- 0=a\n- 1=b\n- 2=c\na: 2\nz: 1\nempty\n* a');
    expect(r.manifests).not.toContain('* b');
  });

  it('includes named templates with dict, and pipes default, quote, printf, trunc, toYaml | nindent', () => {
    const r = rendered(
      chart(
        {
          '_helpers.tpl': '{{- define "demo.name" -}}{{ default .Chart.Name .Values.nameOverride | trunc 3 }}{{- end }}\n{{- define "demo.sel" -}}app: {{ .name }}\nrelease: {{ .root.Release.Name }}{{- end }}',
          'a.yaml': 'name: {{ include "demo.name" . }}\nport: {{ .Values.port | default 80 | quote }}\nimage: {{ printf "%s:%s" .Values.repo (.Values.tag | default .Chart.AppVersion) }}\nlabels:\n  {{- include "demo.sel" (dict "name" "web" "root" $) | nindent 2 }}\nres:\n  {{- toYaml .Values.res | nindent 2 }}\n{{- with .Values.res }}\ncpu: {{ .cpu }}{{ end }}\n',
        },
        'repo: ghcr.io/x\nres: { cpu: 100m, memory: 1Gi }\n',
      ),
    );
    expect(r.manifests).toContain('name: dem\nport: "80"\nimage: ghcr.io/x:4.5\nlabels:\n  app: web\n  release: demo\nres:\n  cpu: 100m\n  memory: 1Gi\ncpu: 100m');
    expect(r.warnings).toEqual([]);
  });

  it('reads a values file over the chart\'s own', () => {
    expect(rendered(chart({ 'a.yaml': 'n: {{ .Values.a.b }} {{ .Values.a.c }}' }, 'a: { b: 1, c: 2 }\n'), 'a: { c: 9 }\n').manifests).toContain('n: 1 9');
  });

  it('names what it does not know with the file and line, and draws what the template clearly says', async () => {
    const files = chart({
      'deploy.yaml': 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {{ include "x.fullname" . }}-api\n  annotations:\n    sum: {{ frobnicate .Values }}\nspec:\n  template:\n    metadata: { labels: { app: api } }\n    spec: { containers: [{ name: api, image: nginx }] }\n',
      'broken.yaml': 'apiVersion: v1\nkind: Service\nmetadata:\n  name: {{ .Chart.Name }}-svc\n{{- if .Values.x }}\nspec:\n  selector: { app: api }\n',
    });
    const r = importHelm(files);
    const w = r.warnings.join('\n');
    expect(w).toMatch(/demo\/templates\/broken\.yaml:5: \{\{ if \}\} without \{\{ end \}\}/);
    expect(w).toMatch(/demo\/templates\/deploy\.yaml:4: include: no template "x\.fullname"/);
    const { doc } = await drawn(r.yaml);
    // Both drawn from what they clearly say: the deployment, the service named after the chart.
    expect(Object.keys(doc.nodes)).toEqual(expect.arrayContaining(['demo-api', 'demo-svc']));
    expect(r.summary).toMatch(/2 in part/);
  });

  it('warns about an unknown function once, at its line, and goes on', () => {
    const r = rendered(chart({ 'a.yaml': 'a: 1\nb: {{ frobnicate 1 }}\nc: {{ frobnicate 2 }}\n' }));
    expect(r.warnings).toEqual(['demo/templates/a.yaml:2: the function frobnicate is not known here: left empty']);
    expect(r.manifests).toContain('a: 1\nb: \nc: ');
  });

  it('renders subcharts with their values under their name, unless disabled', () => {
    const sub = (n: string): ChartFile[] => [
      { path: `charts/${n}/Chart.yaml`, text: `name: ${n}\nversion: 1.0.0\n` },
      { path: `charts/${n}/values.yaml`, text: 'size: small\n' },
      { path: `charts/${n}/templates/a.yaml`, text: `${n}: {{ .Values.size }} {{ .Values.global.env }} {{ .Release.Name }}\n` },
    ];
    const r = rendered(chart({ 'a.yaml': 'top: 1' }, 'global: { env: prod }\nredis: { size: large }\npg: { enabled: false }\n', [...sub('redis'), ...sub('pg')]));
    expect(r.manifests).toContain('redis: large prod demo');
    expect(r.manifests).not.toContain('pg:');
  });

  it('draws the sample chart as kubernetes, the values file read over it', async () => {
    const dir = path.join(repo, 'deploy/helm/shop');
    const files = walk(dir).map((p) => ({ path: path.relative(dir, p).split(path.sep).join('/'), text: fs.readFileSync(p, 'utf8') }));
    const r = importHelm(files, { values: fs.readFileSync(path.join(dir, 'values-prod.yaml'), 'utf8') });
    expect(r.warnings).toEqual([]);
    const { doc } = await drawn(r.yaml);
    expect(doc.nodes['shop-web']).toMatchObject({ kind: 'deployment', replicas: 3, image: 'ghcr.io/acme/web:2.14.0' });
    expect(doc.nodes['shop-api-hpa']).toMatchObject({ kind: 'hpa', replicas: '4-20' });
    expect(Object.keys(doc.nodes)).toEqual(expect.arrayContaining(['shop-worker-orders', 'shop-worker-emails', 'shop-ing']));
    // The helm test pod is not part of the release.
    expect(r.yaml).not.toContain('test-connection');
  });
});

// ---------------------------------------------------------------- Bicep

const bicep = (files: Record<string, string>) => importAzure(Object.entries(files).map(([p, text]) => ({ path: p, text })));

describe('Bicep', () => {
  it('compiles resources, params with defaults, interpolation and parent: to an ARM template', () => {
    const c = compileBicep(
      'main.bicep',
      new Map([['main.bicep', "param env string = 'prod'\nvar name = 'st${env}01'\nresource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = {\n  name: name\n  location: 'westeurope'\n  kind: 'StorageV2'\n}\nresource svc 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {\n  parent: sa\n  name: 'default'\n}\n"]]),
    );
    expect(c.notes).toEqual([]);
    expect(c.template.parameters).toEqual({ env: { type: 'string', defaultValue: 'prod' } });
    expect(c.template.variables).toEqual({ name: "[format('st{0}01', parameters('env'))]" });
    expect((c.template.resources as any).svc).toMatchObject({ type: 'Microsoft.Storage/storageAccounts/blobServices', parent: 'sa', name: 'default' });
  });

  it('draws modules with what they are given, nested children, conditions, loops; leaves out existing', async () => {
    const r = bicep({
      'main.bicep': `param apps array = ['a', 'b']
param withCache bool = false
resource plan 'Microsoft.Web/serverfarms@2023-01-01' = { name: 'plan-x', location: 'westeurope' }
resource site 'Microsoft.Web/sites@2023-01-01' = [for (app, i) in apps: {
  name: 'app-\${app}-\${i}'
  location: 'westeurope'
  properties: { serverFarmId: plan.id }
}]
resource cache 'Microsoft.Cache/redis@2023-08-01' = if (withCache) { name: 'redis-x', location: 'westeurope' }
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' existing = { name: 'kv-shared' }
module data 'data.bicep' = { name: 'data', params: { prefix: 'shop' } }
resource sql 'Microsoft.Sql/servers@2023-05-01-preview' = {
  name: 'sql-\${data.outputs.suffix}'
  location: 'westeurope'
  resource db 'databases' = { name: 'orders', location: 'westeurope' }
}
`,
      'data.bicep': "param prefix string\nresource st 'Microsoft.Storage/storageAccounts@2023-01-01' = {\n  name: 'st${prefix}'\n  location: 'westeurope'\n}\noutput suffix string = '${prefix}-data'\n",
    });
    const { doc } = await drawn(r.yaml);
    const labels = Object.values(doc.nodes).map((n: any) => n.label);
    expect(labels).toEqual(expect.arrayContaining(['app-a-0', 'app-b-1', 'stshop', 'sql-shop-data']));
    expect(labels).not.toContain('redis-x');
    expect(labels).not.toContain('kv-shared');
    expect(r.read).toEqual([{ file: 'main.bicep', what: 'Bicep', count: expect.any(Number) }]);
  });

  it('reads a .bicepparam file, and says what it cannot know', async () => {
    const r = bicep({
      'main.bicep': "param env string = 'dev'\nresource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = {\n  name: 'st${env}'\n  location: 'westeurope'\n  properties: { x: loadTextContent('a.txt') }\n}\nmodule m 'br:registry.azurecr.io/bicep/x:1.0' = { name: 'm' }\n",
      'main.bicepparam': "using './main.bicep'\nparam env = 'prod'\nparam secret = getSecret('a', 'b', 'c', 'd')\n",
    });
    const { doc } = await drawn(r.yaml);
    expect(Object.values(doc.nodes).map((n: any) => n.label)).toContain('stprod');
    const w = r.warnings.join('\n');
    expect(w).toMatch(/main\.bicep:5: loadTextContent\(\) is not read/);
    expect(w).toMatch(/main\.bicep:7: the module br:registry\.azurecr\.io\/bicep\/x:1\.0 is in a registry: not read/);
    expect(w).toMatch(/main\.bicepparam:3: secret is only known when deployed/);
  });

  it('names a syntax error with its line', () => {
    const r = bicep({ 'main.bicep': "resource x 'A.B/c@1' = {\n  name: 'x'\n  location: )\n}\n" });
    expect(r.warnings.join()).toMatch(/main\.bicep:3: unexpected "\)"/);
  });

  it('draws the sample infrastructure: network, apps in their subnet, a vault the apps reach', async () => {
    const r = scanRepo(repoFiles()).diagrams.find((d) => d.kind === 'bicep')!;
    const { doc } = await drawn(r.yaml);
    expect(doc.groups['snet-apps']).toMatchObject({ kind: 'subnet', in: 'vnet-shop-prod' });
    expect(doc.nodes['ca-shop-prod-web']).toMatchObject({ kind: 'container-app', in: 'snet-apps' });
    expect(doc.nodes['psql-shop-prod']).toMatchObject({ kind: 'postgres', in: 'snet-data' });
    expect(doc.edges).toEqual(expect.arrayContaining([{ 'ca-shop-prod-web -> kv-shop-prod': { label: 'secrets', style: 'identity' } }]));
    expect(doc.subtitle).toBe('From the Bicep source');
  });
});

// ---------------------------------------------------------------- OpenAPI and AsyncAPI

describe('OpenAPI', () => {
  const api = fs.readFileSync(path.join(repo, 'api/openapi.yaml'), 'utf8');
  it('tells OpenAPI, Swagger and AsyncAPI apart', () => {
    expect(isOpenApi(api)).toBe(true);
    expect(isOpenApi('swagger: "2.0"\npaths: {}\n')).toBe(true);
    expect(isAsyncApi(api)).toBe(false);
    expect(isAsyncApi(fs.readFileSync(path.join(repo, 'api/asyncapi.yaml'), 'utf8'))).toBe(true);
  });

  it('draws the API by tag, a card a resource, servers as one, security and what it calls back', async () => {
    const [main, seq] = importOpenApi(api, 'openapi');
    const { doc } = await drawn(main!.yaml);
    expect(Object.values(doc.groups).map((g: any) => g.label)).toEqual(['Shop API', 'orders', 'payments', 'catalog', 'customers', 'untagged']);
    expect(doc.nodes['orders-orders']).toMatchObject({ kind: 'api', label: '/orders', caption: 'GET · POST · DELETE · PATCH · 7 operations' });
    expect(doc.nodes.server).toMatchObject({ kind: 'gateway', label: 'api.shop.example.com', caption: 'Production · Staging' });
    expect(doc.nodes['auth-oauth']).toMatchObject({ kind: 'identity', label: 'auth.shop.example.com' });
    expect(doc.nodes['auth-partnerkey']).toMatchObject({ kind: 'secrets', caption: 'X-Partner-Key in header' });
    expect(doc.edges).toEqual(expect.arrayContaining([{ 'payments-payments -> callbacks': { label: 'paymentResult', style: 'async' } }, { 'api -> subscribers': { label: 'orderShipped', style: 'async' } }]));
    expect(main!.summary).toBe('19 operations in 5 tags, 2 security schemes, 4 open');
    const s = await drawn(seq!.yaml);
    expect(s.doc.messages[0]).toEqual({ 'client -> api': 'POST /payments' });
  });

  it('folds a tag with many resources into a counted card, and reads Swagger 2', async () => {
    const paths = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`/r${i}`, { get: { tags: ['t'] } }]));
    const [r] = importOpenApi(JSON.stringify({ swagger: '2.0', info: { title: 'Old', version: '1' }, host: 'old.example.com', basePath: '/v1', schemes: ['https'], paths, securityDefinitions: { basic: { type: 'basic' } }, security: [{ basic: [] }] }));
    const { doc } = await drawn(r!.yaml);
    expect(Object.keys(doc.nodes).filter((k) => k.startsWith('t-'))).toHaveLength(6);
    expect(doc.nodes['t-more']).toMatchObject({ label: '4 more resources', caption: '4 operations' });
    expect(doc.nodes.server.label).toBe('old.example.com');
    expect(doc.nodes['auth-basic']).toMatchObject({ kind: 'secrets', label: 'HTTP basic' });
  });
});

describe('AsyncAPI', () => {
  const read = (f: string) => ({ path: f, text: fs.readFileSync(path.join(repo, f), 'utf8') });
  it('draws an AsyncAPI 3 service: send and receive, queues by their binding, brokers as zones', async () => {
    const r = importAsyncApi([read('api/asyncapi.yaml')]);
    const { doc } = await drawn(r.yaml);
    expect(doc.nodes['ch-shop-orders-v1']).toMatchObject({ kind: 'topic', in: 'broker-kafka-shop-internal' });
    expect(doc.nodes['ch-payments-results']).toMatchObject({ kind: 'queue', in: 'broker-rabbitmq-shop-internal' });
    expect(doc.edges).toEqual(expect.arrayContaining([{ 'orders-service -> ch-shop-orders-v1': { label: 'OrderPlaced, OrderCancelled', style: 'async' } }, { 'ch-payments-results -> orders-service': { label: 'PaymentSucceeded, PaymentFailed', style: 'async' } }]));
  });

  it('reads AsyncAPI 2 from the other side, and meets the other file on the channels they share', async () => {
    const r = importAsyncApi([read('api/asyncapi.yaml'), read('api/payments-events.yaml')]);
    const { doc } = await drawn(r.yaml);
    // publish in 2.x: what the application receives.
    expect(doc.edges).toEqual(expect.arrayContaining([{ 'ch-shop-orders-v1 -> payments-service': { label: 'OrderPlaced', style: 'async' } }, { 'payments-service -> ch-payments-results': { label: 'PaymentSucceeded, PaymentFailed', style: 'async' } }]));
    expect(Object.keys(doc.nodes).filter((k) => k.startsWith('ch-'))).toHaveLength(3);
    expect(r.summary).toBe('2 services, 3 channels (2 with both ends here)');
  });
});

// ---------------------------------------------------------------- workflows

describe('GitHub Actions', () => {
  const wf = (f: string) => fs.readFileSync(path.join(repo, '.github/workflows', f), 'utf8');
  it('draws jobs, needs, a matrix and when it starts', async () => {
    expect(isWorkflow(wf('ci.yml'))).toBe(true);
    const { doc } = await drawn(importWorkflow(wf('ci.yml'), 'ci.yml').yaml);
    expect(doc.lanes).toBeUndefined();
    expect(doc.nodes['On pull request, push to main']).toEqual({ kind: 'start' });
    expect(doc.nodes['Unit tests'].caption).toBe('matrix ×6: os × node');
    expect(doc.flow).toEqual(['On pull request, push to main -> lint', 'On pull request, push to main -> Unit tests', 'On pull request, push to main -> API contract', 'lint -> Build images', 'Unit tests -> Build images', 'API contract -> Build images', 'Build images -> end']);
  });

  it('puts deploy jobs in lanes of their environment, gates production, links to the github diagram', async () => {
    const r = importWorkflow(wf('deploy.yml'), 'deploy.yml', { github: { file: '../docs/github.yaml', environments: ['staging', 'production'] } });
    const { doc } = await drawn(r.yaml);
    expect(doc.lanes).toEqual({ pipeline: { label: 'Pipeline' }, 'env-staging': { label: 'staging' }, 'env-production': { label: 'production' } });
    expect(doc.nodes.build).toEqual({ kind: 'subprocess', in: 'pipeline', caption: 'uses ci.yml' });
    expect(doc.nodes['Deploy to production']).toMatchObject({ kind: 'service', in: 'env-production', links: ['../docs/github.yaml'] });
    expect(doc.flow).toEqual(expect.arrayContaining([{ 'Smoke tests -> Approve production': 'on main' }, 'Approve production -> Deploy to production']));
    expect(r.summary).toMatch(/production approved first/);
  });
});

// ---------------------------------------------------------------- the repository

describe('scanRepo', () => {
  it('finds every source of the sample repository, a diagram each, and says what it does not draw', async () => {
    const files = repoFiles();
    expect(isRepo(files)).toBe(true);
    const scan = scanRepo(files, { name: 'shop' });
    expect(scan.diagrams.map((d) => `${d.kind} ${d.file} ← ${d.sources.join(', ')}`)).toEqual([
      'compose diagrams/services.yaml ← compose.yaml',
      'helm diagrams/shop-chart.yaml ← deploy/helm/shop',
      'kubernetes diagrams/kubernetes.yaml ← deploy/k8s/postgres.yaml',
      'bicep diagrams/infra-azure.yaml ← infra/main.bicep, infra/main.bicepparam',
      'openapi diagrams/shop-api.yaml ← api/openapi.yaml',
      'callbacks diagrams/shop-api-callbacks.yaml ← api/openapi.yaml',
      'asyncapi diagrams/events.yaml ← api/asyncapi.yaml, api/payments-events.yaml',
      'workflow diagrams/workflow-ci.yaml ← .github/workflows/ci.yml',
      'workflow diagrams/workflow-deploy.yaml ← .github/workflows/deploy.yml',
    ]);
    for (const d of scan.diagrams) await drawn(d.yaml);
    expect(scan.hints.join('\n')).toMatch(/values-prod\.yaml/);
    expect(scan.hints.join('\n')).toMatch(/infra\/dns: Terraform source/);
    // The workflow links to the github diagram in docs/, seen from diagrams/.
    expect(scan.diagrams.find((d) => d.file.endsWith('workflow-deploy.yaml'))!.yaml).toContain('links: [../docs/github.yaml]');
  });

  it('matches what is checked in under examples/repo/shop/diagrams', () => {
    const existing = (f: string) => (fs.existsSync(path.join(repo, f)) ? fs.readFileSync(path.join(repo, f), 'utf8') : undefined);
    for (const d of scanRepo(repoFiles(), { name: 'shop', existing }).diagrams) expect(d.yaml, d.file).toBe(existing(d.file));
  });

  it('imports again over its diagrams: hand edits, renames and entries of yours stay; what is gone goes', () => {
    const files = repoFiles();
    const first = scanRepo(files, { name: 'shop' });
    const services = first.diagrams.find((d) => d.kind === 'compose')!;
    const edited = services.yaml
      .replace('  web: { kind: client, label: web,', '  web: { kind: client, label: Storefront,')
      .replace('\nedges:\n', '  stripe: { kind: payments, label: Stripe }\n\nedges:\n  - payments -> stripe: charge\n')
      .replace('  redis:', '  # the cache\n  redis:');
    const compose = files.find((f) => f.path === 'compose.yaml')!;
    const changed = files.map((f) => (f === compose ? { ...f, text: f.text.replace(/\n  otel:\n(    .*\n)+/, '\n') } : f));
    const again = scanRepo(changed, { name: 'shop', existing: (f) => (f === services.file ? edited : undefined) }).diagrams.find((d) => d.kind === 'compose')!;
    expect(again.kept).toBe(true);
    const doc = parse(again.yaml);
    expect(doc.nodes.web.label).toBe('Storefront');
    expect(doc.nodes.stripe).toEqual({ kind: 'payments', label: 'Stripe' });
    expect(doc.nodes.otel).toBeUndefined();
    expect(doc.edges).toContainEqual({ 'payments -> stripe': 'charge' });
    expect(again.yaml).toContain('# the cache');
  });

  it('leaves the diagrams folder and diagrams that are there alone', () => {
    const scan = scanRepo([
      { path: 'compose.yaml', text: 'services:\n  a: { image: nginx }\n' },
      { path: 'out/compose.yaml', text: 'services:\n  b: { image: nginx }\n' },
      { path: 'docs/arch.yaml', text: 'type: systems\nnodes: { a: service }\n' },
    ], { out: 'out' });
    expect(scan.diagrams.map((d) => d.file)).toEqual(['out/services.yaml']);
  });
});
