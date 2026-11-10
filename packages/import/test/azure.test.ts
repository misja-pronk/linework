import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { render } from '@cartography/engine';
import { moved } from '../../engine/test/stability.ts';
import { importAzure, isAccessExport, isAzureContainers, isAzureExport, isTerraform, type AzureOptions } from '../src/index.ts';

// The invented Kestrel estate in examples/azure/import (make-fixtures.mjs): a web app as Resource Graph
// rows, as az bicep build output and as Terraform state and plan; a landing zone of about 150 resources.
const root = path.resolve(import.meta.dirname, '../../../examples/azure/import');
const files = (rel: string) => {
  const p = path.join(root, rel);
  return fs.statSync(p).isDirectory() ? fs.readdirSync(p).sort().map((f) => ({ path: f, text: fs.readFileSync(path.join(p, f), 'utf8') })) : [{ path: path.basename(p), text: fs.readFileSync(p, 'utf8') }];
};
type Doc = { title: string; subtitle: string; badges?: string[]; groups: Record<string, Record<string, unknown>>; nodes: Record<string, Record<string, unknown>>; edges: Record<string, Record<string, string>>[] };

async function imported(rel: string, opts: AzureOptions = {}) {
  const r = importAzure(files(rel), opts);
  const check = await render(r.yaml, { fonts: 'none' });
  expect(check.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const doc = parse(r.yaml) as Doc;
  const edges = doc.edges.map((e) => `${Object.keys(e)[0]} (${Object.values(e)[0]!.style}${Object.values(e)[0]!.label ? `, ${Object.values(e)[0]!.label}` : ''})`);
  return { ...r, doc, edges, check };
}

describe('importAzure', () => {
  it('tells Azure exports from access exports and other JSON', () => {
    for (const f of ['webapp/graph/resources.json', 'webapp/bicep/main.json', 'webapp/terraform/state.json', 'webapp/terraform/plan.json', 'landing-zone/resources.json']) expect(isAzureExport(files(f)[0]!.text), f).toBe(true);
    // Subscriptions and resource groups alone name things: they go with an export, they are not one.
    expect(isAzureExport(files('webapp/graph/containers.json')[0]!.text)).toBe(false);
    expect(isAzureContainers(files('webapp/graph/containers.json')[0]!.text)).toBe(true);
    const roles = fs.readFileSync(path.resolve(root, '../../access/import/kestrel/role-assignments.json'), 'utf8');
    expect(isAzureExport(roles)).toBe(false);
    expect(isAccessExport(roles)).toBe(true);
    expect(isAzureExport(fs.readFileSync(path.resolve(import.meta.dirname, 'terraform/aws-state.json'), 'utf8'))).toBe(false);
    expect(isTerraform(files('webapp/terraform/state.json')[0]!.text)).toBe(true);
  });

  it('reads Resource Graph: containers, the subnet each resource is in, and what goes where', async () => {
    const { doc, edges, read, warnings } = await imported('webapp/graph');
    expect(doc.title).toBe('Kestrel Bookings');
    expect(read.map((x) => x.what)).toEqual(['subscriptions, resource groups and management groups', 'diagnostic settings', 'Resource Graph resources']);
    // One subscription: the management group around it is left out.
    expect(Object.keys(doc.groups)).toEqual(['kestrel-bookings', 'rg-bookings-network', 'vnet-bookings-prod', 'snet-app', 'snet-pe', 'rg-bookings-prod']);
    expect(doc.groups['snet-app']).toMatchObject({ kind: 'subnet', caption: '10.20.0.0/24 · NSG nsg-bookings-app · delegated to App Service', in: 'vnet-bookings-prod' });
    expect(doc.nodes['app-kestrel-bookings']).toMatchObject({ kind: 'app-service', caption: 'App Service · P1v3', in: 'snet-app' });
    expect(doc.nodes['pe-sql-bookings']).toMatchObject({ kind: 'private-endpoint', in: 'snet-pe' });
    expect(doc.nodes['sql-kestrel-bookings']).toMatchObject({ caption: 'SQL Server · bookings', in: 'rg-bookings-prod' });
    expect(doc.badges).toEqual(['management']);
    expect(edges).toEqual(expect.arrayContaining([
      'internet -> afd-kestrel-bookings (public, HTTPS)',
      'afd-kestrel-bookings -> app-kestrel-bookings (public)',
      'pe-sql-bookings -> sql-kestrel-bookings (private, sqlServer)',
      'app-kestrel-bookings -> log-bookings-prod (management, diagnostics)',
      'appi-bookings-prod -> log-bookings-prod (management, workspace)',
    ]));
    expect(warnings.join('\n')).toMatch(/plumbing left out \(3 Network interfaces.*--all draws them/);
  });

  it('reads az bicep build output: module outputs, the module resource group, references to what it deploys', async () => {
    const { doc, edges, warnings } = await imported('webapp/bicep/main.json');
    expect(doc.subtitle).toBe('From an ARM template');
    // The network module is deployed to its own resource group; the rest to the one the template is deployed to.
    expect(doc.groups['rg-bookings-network']).toMatchObject({ kind: 'resource-group' });
    expect(doc.groups['target-resource-group']).toMatchObject({ label: 'Target resource group', caption: 'where the template is deployed' });
    // virtualNetworkSubnetId is reference(module).outputs.appSubnetId.value: worked out.
    expect(doc.nodes['app-kestrel-bookings']).toMatchObject({ in: 'snet-app', caption: 'App Service · P1v3' });
    // uniqueString(resourceGroup().id) is different for every deployment.
    expect(doc.nodes['stbookings']).toMatchObject({ label: 'stbookings…' });
    expect(edges).toEqual(expect.arrayContaining([
      // The origin's host name is reference(the site).defaultHostName: the site itself.
      'afd-kestrel-bookings -> app-kestrel-bookings (public)',
      // A Key Vault reference in the app settings, and diagnostic settings as extension resources.
      'app-kestrel-bookings -> kv-kestrel-bookings (identity, secrets)',
      'sql-kestrel-bookings -> log-bookings-prod (management, diagnostics)',
      'pe-st-bookings-blob -> stbookings (private, blob)',
    ]));
    expect(doc.badges).toEqual(['identity', 'management']);
    expect(warnings[0]).toMatch(/parameter sqlAdminGroupId/);
  });

  it('reads Terraform state the same as Resource Graph', async () => {
    const graph = await imported('webapp/graph');
    const state = await imported('webapp/terraform/state.json');
    expect(state.doc.subtitle).toBe('From Terraform state');
    const same = (d: Doc) => Object.fromEntries(Object.entries(d.nodes).filter(([id]) => !/old$/.test(id)).map(([id, n]) => [id, [n.kind, n.in]]));
    expect(same(state.doc)).toEqual(same(graph.doc));
    expect(state.edges).toEqual(expect.arrayContaining(graph.edges.filter((e) => !/appi/.test(e))));
    // Terraform has the app settings Resource Graph has not: the Key Vault reference.
    expect(state.edges).toContain('app-kestrel-bookings -> kv-kestrel-bookings (identity, secrets)');
  });

  it('marks what a plan does, in words and in colour', async () => {
    const { doc, edges } = await imported('webapp/terraform/plan.json');
    expect(doc.subtitle).toBe('From a Terraform plan');
    expect(doc.nodes['redis-kestrel-bookings']).toMatchObject({ badges: ['+ create'], tone: 'green', in: 'rg-bookings-prod' });
    expect(doc.nodes['pe-redis-bookings']).toMatchObject({ badges: ['+ create'], in: 'snet-pe' });
    expect(doc.nodes['app-kestrel-bookings']).toMatchObject({ badges: ['~ update'], tone: 'amber' });
    expect(doc.nodes['stkestrelbookingsold']).toMatchObject({ badges: ['− delete'], tone: 'rose' });
    // The origin is replaced: what it is part of, the Front Door, changes.
    expect(doc.nodes['afd-kestrel-bookings']).toMatchObject({ badges: ['~ update'] });
    // A new resource's id is not known yet: the configuration says what it refers to.
    expect(edges).toContain('pe-redis-bookings -> redis-kestrel-bookings (private, redisCache)');
  });

  it('keeps a large estate readable, and draws one part on request', async () => {
    const lz = await imported('landing-zone');
    expect(lz.summary).toMatch(/^\d+ resources, 3 subscriptions, 8 resource groups, 3 networks; \d+ cards drawn$/);
    expect(Object.keys(lz.doc.nodes).length).toBeLessThan(50);
    // Management groups above three subscriptions; peerings between the networks.
    expect(lz.doc.groups['kestrel-connectivity']).toMatchObject({ kind: 'subscription', in: 'platform' });
    expect(lz.edges).toEqual(expect.arrayContaining(['vnet-data-prod -> vnet-hub-weu (private, peering)', 'vnet-shop-prod -> vnet-hub-weu (private, peering)', 'vgw-hub-weu -> lgw-kestrel-hq (private, S2S VPN)', 'agw-shop-prod -> aks-shop-prod (private)']));
    // Many of a kind in one place: one counted card; private endpoints and DNS zones from four.
    const counted = Object.values(lz.doc.nodes).filter((n) => / × /.test(String(n.label))).map((n) => n.label);
    expect(counted.sort()).toEqual(['13 × Private DNS zone', '6 × Private endpoint', '7 × Storage account', '8 × Private endpoint']);
    expect(lz.doc.groups['snet-shared']).toMatchObject({ caption: '10.0.2.0/24 · NSG nsg-hub-shared · UDR → afw-hub-weu' });
    expect(Object.values(lz.doc.nodes).some((n) => n.kind === 'nic')).toBe(false);

    const all = await imported('landing-zone', { all: true, collapseAbove: 100 });
    expect(Object.values(all.doc.nodes).filter((n) => n.kind === 'nic').length).toBe(22);
    expect(Object.values(all.doc.nodes).filter((n) => n.kind === 'private-endpoint').length).toBe(14);

    const rg = await imported('landing-zone', { rg: 'rg-shop-*' });
    expect(rg.doc.title).toBe('Kestrel Shop Production');
    expect(Object.keys(rg.doc.groups)).not.toContain('kestrel-logistics');
    // What the chosen part sends its logs to comes along, so the badges say where.
    expect(rg.doc.nodes['log-kestrel-platform']).toBeDefined();
    expect(Object.values(rg.doc.nodes).filter((n) => n.in === 'rg-data-prod')).toEqual([]);

    const sub = await imported('landing-zone', { subscription: 'Kestrel Data*' });
    expect(Object.values(sub.doc.groups).filter((g) => g.kind === 'subscription').map((g) => g.label)).toEqual(expect.arrayContaining(['Kestrel Data Platform']));
    expect(sub.doc.nodes['agw-shop-prod']).toBeUndefined();

    const shallow = await imported('landing-zone', { depth: 1 });
    expect(Object.values(shallow.doc.groups).map((g) => g.kind)).not.toContain('resource-group');
    expect(Object.values(shallow.doc.groups).map((g) => g.kind)).not.toContain('vnet');
  }, 60_000);

  it('is drawn around one element with the focus engine', async () => {
    const { yaml } = importAzure(files('landing-zone'));
    const r = await render(yaml, { fonts: 'none', focus: { on: ['agw-shop-prod'], hops: 1, direction: 'both' } } as Parameters<typeof render>[1]);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const ids = r.graph!.nodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(['agw-shop-prod', 'afd-kestrel-shop', 'aks-shop-prod', 'app-kestrel-shop-web']));
    expect(ids).not.toContain('cosmos-kestrel-data');
  }, 30_000);

  it('imports again over the diagram: hand edits stay, one resource more changes one entry and moves little', async () => {
    const first = importAzure(files('landing-zone')).yaml;
    // By hand: a label, a caption, an entry and a line of one's own, and a comment.
    const edited = first
      .replace('aks-shop-prod: { kind: aks, label: aks-shop-prod,', 'aks-shop-prod: { kind: aks, label: Shop cluster,')
      .replace(/^nodes:$/m, 'nodes:\n  # Added by hand\n  partner: { kind: external, label: Payment provider }')
      .replace(/^edges:$/m, 'edges:\n  - app-kestrel-shop-api -> partner: { label: payments }');
    const again = importAzure(files('landing-zone'), { existing: edited }).yaml;
    expect(again).toBe(edited);

    const later = importAzure(files('landing-zone-later'), { existing: edited }).yaml;
    const added = later.split('\n').filter((l) => !edited.split('\n').includes(l));
    const removed = edited.split('\n').filter((l) => !later.split('\n').includes(l));
    expect(added).toEqual(['  kv-kestrel-shop-certs: { kind: key-vault, label: kv-kestrel-shop-certs, in: rg-shop-app, tags: [imported] }']);
    expect(removed).toEqual([]);

    // The layout: drawn knowing the drawing before, under a tenth of what was there moves.
    const before = await render(edited, { fonts: 'none', previous: null });
    const after = await render(later, { fonts: 'none', previous: before.placed!.memory! });
    expect(moved(before.placed!.memory!.nodes!, after.placed!.memory!.nodes!)).toBeLessThan(0.1);
  }, 60_000);

  it('drops what is gone, but not what was written by hand', () => {
    const later = importAzure(files('landing-zone-later')).yaml.replace(/^nodes:$/m, 'nodes:\n  partner: { kind: external, label: Payment provider }');
    const back = importAzure(files('landing-zone'), { existing: later }).yaml;
    expect(back).not.toContain('kv-kestrel-shop-certs');
    expect(back).toContain('partner: { kind: external, label: Payment provider }');
    // Untagged: taken over by hand, so left as it is.
    const kept = importAzure(files('landing-zone'), { existing: later.replace('kv-kestrel-shop-certs: { kind: key-vault, label: kv-kestrel-shop-certs, in: rg-shop-app, tags: [imported] }', 'kv-kestrel-shop-certs: { kind: key-vault, label: Certificates, in: rg-shop-app }') }).yaml;
    expect(kept).toContain('kv-kestrel-shop-certs: { kind: key-vault, label: Certificates, in: rg-shop-app }');
  });

  it('says what it could not read', () => {
    const r = importAzure([{ path: 'x.json', text: '{ nope' }, { path: 'notes.txt', text: 'hi' }]);
    expect(r.yaml).toBe('');
    expect(r.problems[0]!.message).toMatch(/Not valid JSON/);
    expect(r.skipped.map((s) => s.why)).toEqual(['not valid JSON', 'not a JSON file']);
    expect(importAzure(files('webapp/graph'), { existing: 'type: systems\n' }).problems[0]!.message).toMatch(/not an azure diagram/);
  });
});
