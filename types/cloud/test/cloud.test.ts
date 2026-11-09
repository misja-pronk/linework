import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { icon } from '@cartography/icons';
import { matchTypes } from '@cartography/core';
import { render, types } from '@cartography/engine';
import { azureKind, cloud, config, configFor, countKinds, range } from '../src/index.ts';

const draw = (yaml: string) => render(yaml, { fonts: 'none' });
const messages = async (yaml: string) => (await draw(yaml)).diagnostics.map((d) => d.message);

const shop = `type: cloud
provider: aws
groups:
  account: { kind: account, label: shop-prod, account: "123456789012" }
  region: { kind: region, region: eu-west-1, in: account }
  vpc: { kind: vpc, cidr: 10.0.0.0/16, in: region }
  az-a: { kind: zone, zone: eu-west-1a, in: vpc }
  public-a: { kind: subnet, tier: public, cidr: 10.0.0.0/24, in: az-a }
  app-a: { kind: subnet, tier: private, cidr: 10.0.10.0/24, in: az-a }
  data-a: { kind: subnet, tier: isolated, cidr: 10.0.20.0/24, in: az-a }
nodes:
  users: users
  alb: { kind: alb, in: public-a, exposure: public }
  web: { kind: ecs, label: Web shop, in: app-a, size: 2 tasks }
  db: { kind: rds, in: data-a }
edges:
  - users -> alb: { style: public }
  - alb -> web: { style: private }
  - web -> db: { style: private }
`;

describe('cloud', () => {
  it('has an icon for every kind and is registered', () => {
    for (const [kind, k] of Object.entries({ ...config.nodeKinds, ...config.groupKinds })) expect(icon(k.icon), kind).toBeDefined();
    expect(types).toContain(cloud);
  });

  it('covers both providers broadly', () => {
    const n = countKinds();
    for (const p of ['aws', 'gcp'] as const) {
      expect(Object.values(n).reduce((sum, row) => sum + (row[p] ?? 0), 0), p).toBeGreaterThanOrEqual(45);
      for (const [category, row] of Object.entries(n)) expect(row[p] ?? 0, `${p} ${category}`).toBeGreaterThanOrEqual(1);
    }
    expect(Object.keys(n).length).toBeGreaterThanOrEqual(10);
    // Every palette entry of a provider says which official icon to look for.
    for (const item of cloud.palette.filter((x) => x.collection === 'nodes' && (x.provider === 'aws' || x.provider === 'gcp'))) expect(item.names?.length, item.kind).toBeGreaterThan(0);
  });

  it('names containers and lines tiers up as rows', async () => {
    const r = await draw(shop);
    expect(r.diagnostics).toEqual([]);
    const g = r.graph!;
    const group = (id: string) => g.groups.find((x) => x.id === id)!;
    const node = (id: string) => g.nodes.find((x) => x.id === id)!;
    const card = (id: string) => node(id).shape as { label: string; caption?: string };
    const caption = (id: string) => card(id).caption;
    expect(group('account')).toMatchObject({ label: 'shop-prod', caption: '123456789012' });
    expect(group('region')).toMatchObject({ label: 'eu-west-1', caption: 'Region' });
    expect(group('vpc').caption).toBe('10.0.0.0/16');
    expect(group('az-a')).toMatchObject({ label: 'eu-west-1a', caption: 'Availability zone' });
    expect(group('public-a')).toMatchObject({ label: 'Public subnet', caption: '10.0.0.0/24' });
    expect(group('data-a').label).toBe('Isolated subnet');
    expect([node('alb').rank, node('web').rank, node('db').rank, node('users').rank]).toEqual([1, 2, 3, undefined]);
    expect(card('alb').label).toBe('Application Load Balancer');
    expect(caption('alb')).toBe('public');
    expect(caption('web')).toBe('ECS service · 2 tasks');
    expect([group('vpc').pack, node('db').pack]).toEqual(['aws', 'aws']);
  });

  it('speaks Google Cloud when asked', async () => {
    const r = await draw(`type: cloud
provider: gcp
groups:
  project: { kind: project, label: Shop, project: acme-shop }
  net: { kind: vpc, label: shop-net, in: project }
  subnet: { kind: subnet, region: europe-west4, cidr: 10.20.0.0/24, in: net }
  zone: { kind: zone, zone: europe-west4-a, in: subnet }
nodes:
  vm: { kind: compute-engine, in: zone }
`);
    expect(r.diagnostics).toEqual([]);
    const group = (id: string) => r.graph!.groups.find((x) => x.id === id)!;
    expect(group('net').caption).toBe('VPC network');
    expect(group('zone').caption).toBe('Zone');
    expect(group('subnet').caption).toBe('europe-west4 · 10.20.0.0/24');
    expect([group('net').pack, r.graph!.nodes[0]!.pack]).toEqual(['gcp', 'gcp']);
  });

  it('mixes providers in one file', async () => {
    const r = await draw(`type: cloud
provider: aws
groups:
  aws: aws
  gcp: gcp
  net: { kind: vpc, in: gcp }
  tenant: { kind: tenant, label: acme.example }
nodes:
  shop: { kind: eks, in: aws }
  warehouse: { kind: bigquery, in: gcp }
  files: { kind: azure-storage, in: tenant }
  sign-in: { kind: entra-id, in: tenant }
  box: { kind: server, in: net }
edges:
  - shop -> warehouse: { style: data }
`);
    expect(r.diagnostics).toEqual([]);
    const g = r.graph!;
    const pack = (id: string) => g.nodes.find((x) => x.id === id)!.pack;
    expect([pack('shop'), pack('warehouse'), pack('files'), pack('sign-in'), pack('box')]).toEqual(['aws', 'gcp', 'azure', 'azure', 'gcp']);
    expect(g.groups.find((x) => x.id === 'net')!.caption).toBe('VPC network');
    expect(g.groups.find((x) => x.id === 'aws')!.label).toBe('AWS Cloud');
    // Azure kinds that share a word with the model keep their Azure meaning under another name.
    expect(azureKind('azure-storage')).toBe('storage');
    expect(azureKind('entra-id')).toBe('entra-id');
    expect(config.nodeKinds['storage']).toBeUndefined();
  });

  it('draws each shape with its own vendor\'s icon', async () => {
    const packs: Record<string, { name: string; root: string; icons: Record<string, string> }> = {
      aws: { name: 'aws', root: '/aws', icons: { vpc: 'vpc.svg', eks: 'eks.svg', users: 'users.svg' } },
      gcp: { name: 'gcp', root: '/gcp', icons: { vpc: 'network.svg', bigquery: 'bigquery.svg' } },
      azure: { name: 'azure', root: '/azure', icons: { storage: 'storage.svg', 'entra-id': 'entra.svg' } },
    };
    const read: string[] = [];
    const r = await render(
      `type: cloud
icons: [aws, gcp, azure]
groups:
  a: aws
  net-a: { kind: vpc, in: a }
  g: gcp
  net-g: { kind: vpc, in: g }
  t: tenant
nodes:
  people: users
  shop: { kind: eks, in: net-a }
  warehouse: { kind: bigquery, in: net-g }
  files: { kind: azure-storage, in: t }
  sign-in: { kind: entra-id, in: t }
  queue: { kind: sqs, in: a }
`,
      { fonts: 'none', load: (f) => (read.push(f), '<svg viewBox="0 0 1 1"/>'), pack: (n) => packs[n] },
    );
    expect(r.diagnostics).toEqual([]);
    expect(read.sort()).toEqual(['/aws/eks.svg', '/aws/users.svg', '/aws/vpc.svg', '/azure/entra.svg', '/azure/storage.svg', '/gcp/bigquery.svg', '/gcp/network.svg']);
  });

  it('maps the words of a model to the provider', () => {
    expect(configFor('aws').kindAliases).toMatchObject({ database: 'rds', queue: 'sqs', storage: 's3', function: 'lambda' });
    expect(configFor('gcp').kindAliases).toMatchObject({ database: 'cloud-sql', queue: 'pubsub', storage: 'gcs', warehouse: 'bigquery' });
    for (const p of ['aws', 'gcp', 'azure'] as const)
      for (const [word, kind] of Object.entries(configFor(p).kindAliases!)) expect(config.nodeKinds[kind] ?? config.groupKinds[kind], `${p} ${word} → ${kind}`).toBeDefined();
  });

  it('reads prefixes', () => {
    expect(range('10.0.0.0/16')).toEqual([167772160, 167837695]);
    expect(range('10.0.0.0/33')).toBeUndefined();
    expect(range('ten')).toBeUndefined();
  });

  it('warns about ranges that cannot work', async () => {
    const m = await messages(`type: cloud
groups:
  a: { kind: vpc, cidr: 10.0.0.0/16 }
  b: { kind: vpc, cidr: 10.0.128.0/17 }
  c: { kind: vpc, cidr: 10.0.0.0/8 }
  one: { kind: subnet, cidr: 10.0.1.0/24, in: a }
  two: { kind: subnet, cidr: 10.0.1.128/25, in: a }
  far: { kind: subnet, cidr: 10.1.0.0/24, in: a }
  odd: { kind: subnet, cidr: 10.0.0.300/24, in: a }
nodes:
  tgw: transit-gateway
edges:
  - a -> tgw: { style: private }
  - b -> tgw: { style: private }
`);
    expect(m).toContain('10.0.1.128/25 overlaps 10.0.1.0/24 of "one"');
    expect(m).toContain('10.1.0.0/24 is outside 10.0.0.0/16 of "a"');
    expect(m).toContain('"10.0.0.300/24" is not an IPv4 prefix like 10.0.0.0/16');
    expect(m).toContain('10.0.128.0/17 overlaps 10.0.0.0/16 of "a", and the two are connected');
    // Separate networks that are not joined may reuse a range.
    expect(m.filter((x) => x.includes('10.0.0.0/8'))).toEqual([]);
    expect(m).toHaveLength(4);
  });

  it('warns about public things in private places', async () => {
    const m = await messages(`type: cloud
groups:
  vpc: { kind: vpc, cidr: 10.0.0.0/16 }
  app: { kind: subnet, tier: private, in: vpc }
  edge: { kind: subnet, tier: public, in: vpc }
nodes:
  users: users
  alb: { kind: alb, in: app, exposure: public }
  api: { kind: ecs, in: app }
  nat: { kind: nat-gateway, in: app }
  inner: { kind: nat-gateway, in: app, exposure: internal }
  good: { kind: nat-gateway, in: edge }
edges:
  - users -> api: { style: public }
  - users -> good: { style: public }
`);
    expect(m).toEqual([
      '"alb" is marked public but sits in the private subnet "app"',
      'A NAT gateway reaches the internet from a public subnet; "nat" sits in the private subnet "app" (exposure: internal for a private NAT gateway)',
      'Public traffic goes straight to "api" in the private subnet "app"',
    ]);
  });

  it('asks for a zone once zones are drawn', async () => {
    const zoned = (extra: string) => `type: cloud
groups:
  vpc: vpc
  az-a: { kind: zone, zone: eu-west-1a, in: vpc }
nodes:
  one: { kind: ec2, in: az-a }
  two: { kind: ec2, in: vpc${extra} }
  bucket: { kind: s3 }
`;
    expect(await messages(zoned(''))).toEqual(['"two" (EC2 instance) lives in one zone: put it in a zone or set zone:']);
    expect(await messages(zoned(', zone: eu-west-1b'))).toEqual([]);
    // No zones in the picture: nothing to ask.
    expect(await messages('type: cloud\nnodes:\n  vm: ec2\n')).toEqual([]);
  });

  it('is what people find when they ask for AWS or Google Cloud', () => {
    const best = (q: string) => matchTypes(q, types)[0]!.type.id;
    for (const q of ['aws', 'vpc with three availability zones', 'google cloud project', 'gcp bigquery', 'lambda and s3', 'multi-cloud', 'aws landing zone', 'terraform aws'])
      expect(best(q), q).toBe('cloud');
    for (const q of ['vnet subnets and private endpoints', 'azure landing zone', 'vnet subnet']) expect(best(q), q).toBe('azure');
    expect(best('pods and deployments')).toBe('kubernetes');
    expect(best('microservices and queues')).toBe('systems');
    expect(best('vlans and switches')).toBe('network');
  });

  it('draws every example without problems', async () => {
    const dir = new URL('../../../examples/cloud/', import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith('.yaml'));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      const r = await render(readFileSync(new URL(f, dir), 'utf8'), { fonts: 'none' });
      expect(r.diagnostics, f).toEqual([]);
    }
  }, 30_000);
});
