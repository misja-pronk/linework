// carto import --live and carto diff --live against stand-ins for kubectl, az and gh: fake executables
// on PATH that answer from fixtures and record how they were called. Nothing real is ever run.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { refusal } from '@cartography/import/node';

const root = path.resolve(import.meta.dirname, '../../..');
const here = path.join(import.meta.dirname, 'live');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-live-'));
const bin = path.join(tmp, 'bin');
const work = path.join(tmp, 'work');
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// The stand-ins: a shell script per tool that hands its arguments to fake.mjs.
fs.mkdirSync(bin, { recursive: true });
for (const tool of ['kubectl', 'az', 'gh']) {
  fs.writeFileSync(path.join(bin, tool), `#!/bin/sh\nexec "${process.execPath}" "${path.join(here, 'fake.mjs')}" ${tool} "$@"\n`, { mode: 0o755 });
}
// Only the stand-ins, node and the system: never a real kubectl, az or gh.
const PATH = [bin, path.dirname(process.execPath), '/usr/bin', '/bin'].join(':');

interface Route {
  argv: string[];
  file?: string;
  stdout?: string;
  stderr?: string;
  code?: number;
  sleep?: number;
}
const routes = (list: Route[]) => fs.writeFileSync(path.join(tmp, 'routes.json'), JSON.stringify(list));
const calls = (): string[][] => (fs.existsSync(path.join(tmp, 'calls.jsonl')) ? fs.readFileSync(path.join(tmp, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

function carto(args: string[], { path: p = PATH }: { path?: string } = {}) {
  const r = spawnSync(path.join(root, 'node_modules/.bin/tsx'), [path.join(root, 'packages/cli/src/main.ts'), ...args], { cwd: work, encoding: 'utf8', env: { ...process.env, PATH: p, FAKE_DIR: tmp, HOME: tmp }, input: '' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const read = (name: string) => fs.readFileSync(path.join(work, name), 'utf8');
const all = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(path.join(dir, e.name)) : [path.join(dir, e.name)]));

beforeEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  fs.rmSync(path.join(tmp, 'calls.jsonl'), { force: true });
});

// ---------------------------------------------------------------- kubernetes

const KINDS = 'deployments,statefulsets,daemonsets,cronjobs,jobs,services,ingresses,persistentvolumeclaims,serviceaccounts,networkpolicies,horizontalpodautoscalers';
function kube(fixture: 'k8s-now.json' | 'k8s-later.json', where: string[] = []): Route[] {
  return [
    { argv: ['kubectl', 'config', 'current-context'], stdout: 'kind-kestrel\n' },
    { argv: ['kubectl', 'get', KINDS, '-o', 'json', ...where], file: path.join(here, fixture) },
    { argv: ['kubectl', 'get', 'gateways.gateway.networking.k8s.io,httproutes.gateway.networking.k8s.io', '-o', 'json', ...where], stderr: 'error: the server doesn\'t have a resource type "gateways"', code: 1 },
    { argv: ['kubectl', 'get', 'configmaps', '-o', 'custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name', '--no-headers', ...where], stdout: 'shop   api-config\nshop   kube-root-ca.crt\nkube-system   coredns\n' },
    { argv: ['kubectl', 'get', 'secrets', '-o', 'custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name,TYPE:.type', '--no-headers', ...where], stdout: 'shop   db-credentials   Opaque\nshop   shop-tls   kubernetes.io/tls\nshop   sh.helm.release.v1.shop.v1   helm.sh/release.v1\n' },
  ];
}
// Values in the fixtures that must never reach a file, the terminal or the diagram.
const SECRETS = ['s3cr3t-in-annotation', 'pw-in-args-1234', 'debug-plain-value', 'pg-literal-password', 'configmap-data-value-9876'];
const leaks = (texts: string[]) => SECRETS.filter((s) => texts.some((t) => t.includes(s)));

describe('carto import --live k8s', { timeout: 60_000 }, () => {
  it('--dry-run lists the commands and runs none of them', () => {
    routes(kube('k8s-now.json', ['-A']));
    const r = carto(['import', '--live', 'k8s', '-A', '--dry-run']);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`kubectl get ${KINDS} -o json -A`);
    expect(r.out).toContain('kubectl get secrets -o custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name,TYPE:.type --no-headers -A   # names only');
    expect(calls()).toEqual([]);
    expect(fs.readdirSync(work)).toEqual([]);
  });

  it('shows the commands and does not run them without a yes', () => {
    routes(kube('k8s-now.json'));
    const r = carto(['import', '--live', 'k8s']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('kubectl config current-context');
    expect(r.err).toContain('Add --yes');
    expect(calls()).toEqual([]);
  });

  it('draws the cluster, leaves out kube-system, and never writes or prints a secret value', () => {
    routes(kube('k8s-now.json', ['-A']));
    const r = carto(['import', '--live', 'k8s', '--all-namespaces', '--yes', '--keep-raw', 'raw']);
    expect(r.code, r.err).toBe(0);
    const yaml = read('kind-kestrel.yaml');
    expect(yaml).toMatch(/^type: kubernetes\ntitle: kind-kestrel/);
    expect(yaml).toContain('web: { kind: deployment, in: ns-shop, replicas: 2, image: ghcr.io/kestrel/web:2.3, tags: [imported] }');
    expect(yaml).toContain('db-credentials');
    expect(yaml).not.toContain('coredns');
    expect(r.err).toContain('left out: --namespace kube-system draws them');
    expect(r.err).toContain('Gateway API is not installed');
    const raw = all(path.join(work, 'raw'));
    expect(raw.map((f) => path.relative(work, f)).sort()).toEqual(['raw/configmaps.json', 'raw/resources.json', 'raw/secrets.json']);
    expect(leaks([yaml, r.out, r.err, ...raw.map((f) => fs.readFileSync(f, 'utf8'))])).toEqual([]);
    // What is kept is still enough to import again from the folder.
    expect(carto(['import', 'raw/resources.json', 'raw/secrets.json', 'raw/configmaps.json', '-o', 'again.yaml']).code).toBe(0);
  });

  it('runs only commands on the allow-list, each once, with the flags given', () => {
    routes(kube('k8s-now.json', ['-n', 'shop', '--context', 'kind-kestrel']));
    expect(carto(['import', '--live', 'k8s', '-n', 'shop', '--context', 'kind-kestrel', '-y']).code).toBe(1); // context route differs: shown as a failure
    routes([{ argv: ['kubectl', 'config', 'current-context', '--context', 'kind-kestrel'], stdout: 'kind-kestrel\n' }, ...kube('k8s-now.json', ['-n', 'shop', '--context', 'kind-kestrel']).slice(1)]);
    fs.rmSync(path.join(tmp, 'calls.jsonl'), { force: true });
    const r = carto(['import', '--live', 'k8s', '-n', 'shop', '--context', 'kind-kestrel', '-y', '-o', 'shop.yaml']);
    expect(r.code, r.err).toBe(0);
    const ran = calls();
    expect(ran.length).toBe(5);
    for (const argv of ran) expect(refusal(argv), argv.join(' ')).toBeUndefined();
    expect(ran.every((a) => a[0] === 'kubectl' && (a[1] === 'get' || a[1] === 'config'))).toBe(true);
  });

  it('--into keeps what was edited by hand and follows the cluster; diff --live shows the drift', () => {
    routes(kube('k8s-now.json'));
    expect(carto(['import', '--live', 'k8s', '-y', '-o', 'shop.yaml']).code).toBe(0);
    // By hand: a label, a comment, a card and a line of our own.
    const edited = read('shop.yaml').replace('web: { kind: deployment,', '# The storefront\n  web: { kind: deployment, label: Storefront,') + '  - web -> payments\n';
    fs.writeFileSync(path.join(work, 'shop.yaml'), edited.replace('\nedges:', '\n  payments: { kind: external, label: Payment provider }\n\nedges:'));
    expect(carto(['validate', 'shop.yaml']).code).toBe(0);

    routes(kube('k8s-later.json'));
    const drift = carto(['diff', '--live', 'k8s', 'shop.yaml', '-y', '--exit-code', '-o', 'drift.png']);
    expect(drift.code, drift.err).toBe(1);
    expect(drift.out).toMatch(/live k8s.*against shop\.yaml/);
    expect(drift.out).toContain('worker');
    expect(drift.out).toContain('shop'); // the ingress, gone
    expect(drift.out).not.toContain('payments');
    expect(fs.statSync(path.join(work, 'drift.png')).size).toBeGreaterThan(1000);
    fs.copyFileSync(path.join(work, 'drift.png'), path.join(tmp, 'drift.png'));

    // Exists: not written over without --into or --force.
    expect(carto(['import', '--live', 'k8s', '-y', '-o', 'shop.yaml']).err).toContain('--into shop.yaml imports over it');
    const r = carto(['import', '--live', 'k8s', '-y', '--into', 'shop.yaml']);
    expect(r.code, r.err).toBe(0);
    const yaml = read('shop.yaml');
    expect(yaml).toContain('# The storefront');
    expect(yaml).toContain('web: { kind: deployment, label: Storefront, in: ns-shop, replicas: 4, image: ghcr.io/kestrel/web:2.4, tags: [imported] }');
    expect(yaml).toContain('payments: { kind: external, label: Payment provider }');
    expect(yaml).toContain('- web -> payments');
    expect(yaml).toContain('worker: { kind: deployment');
    expect(yaml).not.toMatch(/^\s+shop: \{ kind: ingress/m);
    expect(yaml).not.toContain('internet -> shop');
    // Imported again with nothing changed: the same file.
    expect(carto(['import', '--live', 'k8s', '-y', '--into', 'shop.yaml']).code).toBe(0);
    expect(read('shop.yaml')).toBe(yaml);
    expect(carto(['diff', '--live', 'k8s', 'shop.yaml', '-y', '--exit-code']).code).toBe(0);
  });

  it('says what to do when kubectl is missing, not logged in, or too slow', () => {
    routes(kube('k8s-now.json'));
    const missing = carto(['import', '--live', 'k8s', '-y'], { path: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(':') });
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('kubectl is not installed, or not on PATH');

    routes([kube('k8s-now.json')[0]!, { argv: ['kubectl', 'get', KINDS, '-o', 'json'], stderr: 'error: You must be logged in to the server (Unauthorized)', code: 1 }]);
    expect(carto(['import', '--live', 'k8s', '-y']).err).toContain('kubectl is not logged in to the cluster');

    routes([{ ...kube('k8s-now.json')[0]!, sleep: 4000 }]);
    const slow = carto(['import', '--live', 'k8s', '-y', '--timeout', '1']);
    expect(slow.code).toBe(1);
    expect(slow.err).toContain('took longer than 1s and was stopped');
  });
});

// ---------------------------------------------------------------- azure, access

const zone = path.join(root, 'examples/azure/import/landing-zone');
const kestrel = path.join(root, 'examples/access/import/kestrel');
const accountShow: Route = { argv: ['az', 'account', 'show', '-o', 'json'], stdout: JSON.stringify({ name: 'Kestrel Production', tenantDisplayName: 'Kestrel Logistics', user: { name: 'someone@kestrel.example' } }) };
const graph = (q: string, token?: string): string[] => ['az', 'graph', 'query', '-q', q, '--first', '1000', ...(token ? ['--skip-token', token] : []), '-o', 'json'];
function azureRoutes(): Route[] {
  const res = JSON.parse(fs.readFileSync(path.join(zone, 'resources.json'), 'utf8')) as { data: unknown[] };
  const half = Math.ceil(res.data.length / 2);
  return [
    accountShow,
    // Two pages, as az graph query gives them past --first.
    { argv: graph('resources'), stdout: JSON.stringify({ count: half, data: res.data.slice(0, half), skip_token: 'page-two' }) },
    { argv: graph('resources', 'page-two'), stdout: JSON.stringify({ count: res.data.length - half, data: res.data.slice(half), skip_token: null }) },
    { argv: graph('resourcecontainers'), file: path.join(zone, 'containers.json') },
  ];
}
function accessRoutes(): Route[] {
  const groups = (JSON.parse(fs.readFileSync(path.join(kestrel, 'groups.json'), 'utf8')) as { value: { id: string; displayName: string }[] }).value;
  return [
    accountShow,
    { argv: ['az', 'role', 'assignment', 'list', '--all', '--include-inherited', '-o', 'json'], file: path.join(kestrel, 'role-assignments.json') },
    { argv: ['az', 'role', 'definition', 'list', '--custom-role-only', '-o', 'json'], file: path.join(kestrel, 'role-definitions.json') },
    ...groups.filter((g) => fs.existsSync(path.join(kestrel, `group-members-${g.displayName}.json`))).map((g) => ({ argv: ['az', 'ad', 'group', 'member', 'list', '--group', g.id, '-o', 'json'], file: path.join(kestrel, `group-members-${g.displayName}.json`) })),
  ];
}

describe('carto import --live azure and access', { timeout: 60_000 }, () => {
  it('pages through Resource Graph and draws what the saved files draw', () => {
    routes(azureRoutes());
    const r = carto(['import', '--live', 'azure', '--yes', '-o', '-']);
    expect(r.code, r.err).toBe(0);
    expect(calls().filter((a) => a[1] === 'graph').length).toBe(3);
    fs.mkdirSync(path.join(work, 'saved'));
    for (const f of ['resources.json', 'containers.json']) fs.copyFileSync(path.join(zone, f), path.join(work, 'saved', f));
    const saved = carto(['import', 'saved', '-o', '-']);
    expect(r.out).toBe(saved.out);
    for (const argv of calls()) expect(refusal(argv)).toBeUndefined();
  });

  it('narrows the query by resource group and subscription id', () => {
    const sub = 'e251188d-1e09-f37d-cf3f-842941c7a93f';
    const r = carto(['import', '--live', 'azure', '--rg', 'rg-shop-app,rg-management', '--subscription', sub, '--dry-run']);
    expect(r.out).toContain(`az graph query -q 'resources | where resourceGroup in~ ('\\''rg-shop-app'\\'', '\\''rg-management'\\'')' --first 1000 --subscriptions ${sub} -o json`);
    // A wildcard is left to the import, never put in the query.
    expect(carto(['import', '--live', 'azure', '--rg', "rg-shop-*", '--dry-run']).out).toContain('az graph query -q resources --first 1000 -o json');
  });

  it('--with-access adds the access diagram beside it, members of each group that holds a role read by id', () => {
    routes([...azureRoutes(), ...accessRoutes().slice(1)]);
    const r = carto(['import', '--live', 'azure', '--with-access', '-y']);
    expect(r.code, r.err).toBe(0);
    expect(fs.readdirSync(work).sort()).toEqual(['azure-access.yaml', 'azure.yaml']);
    const access = read('azure-access.yaml');
    expect(access).toMatch(/^type: access/);
    expect(access).toContain('Dina Okafor');
    expect(calls().filter((a) => a[1] === 'account').length).toBe(1);
    expect(calls().some((a) => a.join(' ').startsWith('az ad group member list --group '))).toBe(true);
  });

  it('access alone; az not logged in says so', () => {
    routes(accessRoutes());
    const r = carto(['import', '--live', 'access', '-y']);
    expect(r.code, r.err).toBe(0);
    expect(read('access.yaml')).toContain('sg-developers');
    routes([{ argv: accountShow.argv, stderr: "ERROR: Please run 'az login' to setup account.", code: 1 }]);
    const out = carto(['import', '--live', 'access', '-y']);
    expect(out.code).toBe(1);
    expect(out.err).toContain('run `az login` first');
  });
});

// ---------------------------------------------------------------- github

const gh = path.join(root, 'examples/github/import/kestrel');
function githubRoutes(): Route[] {
  const org = 'kestrel-logistics';
  const out: Route[] = [{ argv: ['gh', 'auth', 'status'], stderr: 'github.com\n  ✓ Logged in to github.com account someone (keyring)\n  - Token: gho_************************************' }];
  const all = (p: string, file: string) => fs.existsSync(path.join(gh, file)) && out.push({ argv: ['gh', 'api', '--paginate', '--slurp', p], file: path.join(gh, file) });
  out.push({ argv: ['gh', 'api', `orgs/${org}`], file: path.join(gh, 'org.json') });
  for (const [p, f] of [['teams', 'teams.json'], ['members', 'members.json'], ['members?role=admin', 'owners.json'], ['outside_collaborators', 'outside-collaborators.json'], ['repos', 'repos.json'], ['rulesets', 'rulesets.json'], ['actions/secrets', 'secrets.json'], ['actions/variables', 'variables.json'], ['actions/runners', 'runners.json'], ['actions/runner-groups', 'runner-groups.json'], ['installations', 'installations.json']]) all(`orgs/${org}/${p}`, f!);
  for (const f of fs.readdirSync(path.join(gh, 'rulesets'))) out.push({ argv: ['gh', 'api', `orgs/${org}/rulesets/${f.replace('.json', '')}`], file: path.join(gh, 'rulesets', f) });
  for (const t of fs.existsSync(path.join(gh, 'teams')) ? fs.readdirSync(path.join(gh, 'teams')) : []) for (const w of ['members', 'repos']) all(`orgs/${org}/teams/${t}/${w}`, `teams/${t}/${w}.json`);
  for (const r of fs.readdirSync(path.join(gh, 'repos'))) {
    for (const [p, f] of [['collaborators?affiliation=direct', 'collaborators.json'], ['environments', 'environments.json'], ['rulesets', 'rulesets.json'], ['actions/secrets', 'secrets.json'], ['actions/variables', 'variables.json'], ['branches/main/protection', 'branch-protection.json']]) all(`repos/${org}/${r}/${p}`, `repos/${r}/${f}`);
    for (const f of fs.existsSync(path.join(gh, 'repos', r, 'rulesets')) ? fs.readdirSync(path.join(gh, 'repos', r, 'rulesets')) : []) out.push({ argv: ['gh', 'api', `repos/${org}/${r}/rulesets/${f.replace('.json', '')}`], file: path.join(gh, 'repos', r, 'rulesets', f) });
    if (fs.existsSync(path.join(gh, 'repos', r, 'CODEOWNERS'))) out.push({ argv: ['gh', 'api', `repos/${org}/${r}/contents/.github/CODEOWNERS`, '-H', 'Accept: application/vnd.github.raw'], file: path.join(gh, 'repos', r, 'CODEOWNERS') });
  }
  return out;
}

describe('carto import --live github', { timeout: 60_000 }, () => {
  it('asks gh what the docs script asks and draws what the saved answers draw', () => {
    routes(githubRoutes());
    const r = carto(['import', '--live', 'github', '--org', 'kestrel-logistics', '-y', '--keep-raw', 'raw']);
    expect(r.code, r.err).toBe(0);
    expect(r.err).not.toContain('gho_');
    const saved = carto(['import', gh, '-o', '-']);
    expect(read('kestrel-logistics.yaml')).toBe(saved.out);
    // The kept answers are a folder carto import reads the same way.
    expect(carto(['import', 'raw', '-o', '-']).out).toBe(saved.out);
    const ran = calls();
    for (const argv of ran) expect(refusal(argv), argv.join(' ')).toBeUndefined();
    expect(ran.every((a) => a[1] === 'auth' || (a[1] === 'api' && !a.some((x) => /^(-X|--method|-f|-F|--field|--raw-field|--input)$/.test(x))))).toBe(true);
  });

  it('needs --org, and says when gh is not logged in', () => {
    expect(carto(['import', '--live', 'github', '-y']).err).toContain('needs --org');
    routes([{ argv: ['gh', 'auth', 'status'], stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login', code: 1 }]);
    expect(carto(['import', '--live', 'github', '--org', 'kestrel-logistics', '-y']).err).toContain('run `gh auth login` first');
  });
});
