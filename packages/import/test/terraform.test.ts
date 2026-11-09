import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { render } from '@cartography/engine';
import { importTerraform, isKubernetes, isNetworkInventory, isTerraform } from '../src/index.ts';

// Made-up estates in the shape of `terraform show -json`: a state, a saved plan, a Google Cloud state.
const fixture = (name: string) => fs.readFileSync(new URL(`./terraform/${name}.json`, import.meta.url), 'utf8');

async function imported(text: string) {
  const r = importTerraform(text, 'Test');
  const check = await render(r.yaml, { fonts: 'none' });
  expect(check.diagnostics).toEqual([]);
  const doc = parse(r.yaml) as { provider: string; subtitle: string; direction?: string; groups: Record<string, Record<string, string>>; nodes: Record<string, Record<string, string> | string>; edges: (string | Record<string, { style: string }>)[] };
  const edges = doc.edges.map((e) => (typeof e === 'string' ? e : `${Object.keys(e)[0]!} (${Object.values(e)[0]!.style})`));
  return { ...r, doc, edges, graph: check.graph! };
}

describe('importTerraform', () => {
  it('tells Terraform JSON from other files', () => {
    for (const f of ['aws-state', 'aws-plan', 'gcp-state']) {
      expect(isTerraform(fixture(f))).toBe(true);
      expect(isKubernetes(fixture(f))).toBe(false);
      expect(isNetworkInventory(fixture(f))).toBe(false);
    }
    expect(isTerraform('{"devices": {"results": []}}')).toBe(false);
    expect(isTerraform('{"apiVersion": "v1", "kind": "Pod"}')).toBe(false);
    expect(isTerraform('type: cloud\nnodes: {}\n')).toBe(false);
  });

  it('reads a state: the VPC, a column per zone, and subnets by the route out', async () => {
    const { doc, warnings } = await imported(fixture('aws-state'));
    expect(doc.provider).toBe('aws');
    expect(doc.subtitle).toBe('From Terraform state');
    expect(doc.direction).toBe('down');
    expect(doc.groups).toEqual({
      'vpc-main': { kind: 'vpc', label: 'shop', region: 'eu-west-1', cidr: '10.0.0.0/16' },
      'vpc-main-eu-west-1a': { kind: 'zone', zone: 'eu-west-1a', in: 'vpc-main' },
      'vpc-main-eu-west-1b': { kind: 'zone', zone: 'eu-west-1b', in: 'vpc-main' },
      // To the internet gateway: public. To the NAT gateway: private. No way out: isolated.
      'app-0': { kind: 'subnet', tier: 'private', cidr: '10.0.10.0/24', in: 'vpc-main-eu-west-1a' },
      'app-1': { kind: 'subnet', tier: 'private', cidr: '10.0.11.0/24', in: 'vpc-main-eu-west-1b' },
      'data-0': { kind: 'subnet', tier: 'isolated', cidr: '10.0.20.0/24', in: 'vpc-main-eu-west-1a' },
      'data-1': { kind: 'subnet', tier: 'isolated', cidr: '10.0.21.0/24', in: 'vpc-main-eu-west-1b' },
      'public-0': { kind: 'subnet', tier: 'public', cidr: '10.0.0.0/24', in: 'vpc-main-eu-west-1a' },
      'public-1': { kind: 'subnet', tier: 'public', cidr: '10.0.1.0/24', in: 'vpc-main-eu-west-1b' },
    });
    expect(warnings).toEqual(['Left out 3 resources of types that are not drawn: aws_backup_plan, aws_backup_vault, aws_budgets_budget']);
  });

  it('puts each resource where it runs, once per zone when it is spread over zones', async () => {
    const { doc } = await imported(fixture('aws-state'));
    expect(doc.nodes).toEqual({
      internet: 'internet',
      cdn: { kind: 'cloudfront', label: 'Shop' },
      // Through its subnet group; Multi-AZ, so one in each.
      'db-instance-orders-a': { kind: 'rds', label: 'shop-orders', size: 'db.r6g.large', in: 'data-0' },
      'db-instance-orders-b': { kind: 'rds', label: 'shop-orders', size: 'db.r6g.large', in: 'data-1' },
      'app-a': { kind: 'ecs', label: 'shop-app', in: 'app-0' },
      'app-b': { kind: 'ecs', label: 'shop-app', in: 'app-1' },
      'internet-gateway-main': { kind: 'internet-gateway', label: 'shop', in: 'vpc-main' },
      mailer: { kind: 'lambda', label: 'shop-mailer' },
      'web-a': { kind: 'alb', label: 'shop-web', exposure: 'public', in: 'public-0' },
      'web-b': { kind: 'alb', label: 'shop-web', exposure: 'public', in: 'public-1' },
      'nat-gateway-main': { kind: 'nat-gateway', label: 'shop', in: 'public-0' },
      assets: { kind: 's3', label: 'shop-assets-prod' },
      db: { kind: 'secrets-manager', label: 'shop/db' },
      'sqs-queue-orders': { kind: 'sqs', label: 'shop-orders' },
    });
  });

  it('draws lines from what refers to what', async () => {
    const { edges, yaml } = await imported(fixture('aws-state'));
    expect(edges).toEqual([
      // An event source mapping: the queue feeds the function.
      'sqs-queue-orders -> mailer (data)',
      // Listener → target group → the service registered in it; each zone to its own.
      'web-a -> app-a (private)',
      'web-b -> app-b (private)',
      // The database's security group lets the app's in.
      'app-a -> db-instance-orders-a (private)',
      'app-b -> db-instance-orders-b (private)',
      // Origins, by host name.
      'cdn -> assets (public)',
      'cdn -> web-a (public)',
      'cdn -> web-b (public)',
      // ARNs in the task definition's container definitions.
      'app-a -> db',
      'app-b -> db',
      'app-a -> sqs-queue-orders',
      'app-b -> sqs-queue-orders',
      'internet -> internet-gateway-main (public)',
      'internet -> cdn (public)',
      'nat-gateway-main -> internet-gateway-main',
    ]);
    // Names, ranges and sizes only: no secrets, no account numbers in ARNs.
    expect(yaml).not.toMatch(/not-in-the-diagram|123456789012|arn:/);
  });

  it('keeps ids when the estate changes, so pins survive a re-import', async () => {
    const state = JSON.parse(fixture('aws-state')) as { values: { root_module: { resources: { address: string }[] } } };
    const before = await imported(JSON.stringify(state));
    // The same resources in another order: the same file.
    const shuffled = structuredClone(state);
    shuffled.values.root_module.resources.reverse();
    expect(importTerraform(JSON.stringify(shuffled), 'Test').yaml).toBe(before.yaml);
    // One function less: everything else is still called what it was.
    const less = structuredClone(state);
    less.values.root_module.resources = less.values.root_module.resources.filter((r) => !/mailer|event_source_mapping/.test(r.address));
    const after = await imported(JSON.stringify(less));
    expect(Object.keys(after.doc.nodes)).toEqual(Object.keys(before.doc.nodes).filter((k) => k !== 'mailer'));
    expect(after.doc.groups).toEqual(before.doc.groups);
  });

  it('reads a plan from its configuration, through module outputs and variables', async () => {
    const { doc, edges, warnings } = await imported(fixture('aws-plan'));
    expect(doc.subtitle).toBe('From a Terraform plan');
    expect(doc.groups).toEqual({
      this: { kind: 'vpc', label: 'orders', region: 'eu-central-1', cidr: '10.40.0.0/16' },
      'this-eu-central-1a': { kind: 'zone', zone: 'eu-central-1a', in: 'this' },
      'this-eu-central-1b': { kind: 'zone', zone: 'eu-central-1b', in: 'this' },
      'private-a': { kind: 'subnet', tier: 'private', cidr: '10.40.10.0/24', in: 'this-eu-central-1a' },
      'private-b': { kind: 'subnet', tier: 'private', cidr: '10.40.11.0/24', in: 'this-eu-central-1b' },
    });
    // subnet_ids = module.network.private_subnet_ids → the module's subnets.
    expect(doc.nodes['process-a']).toEqual({ kind: 'lambda', label: 'orders-process', in: 'private-a' });
    expect(doc.nodes['process-b']).toEqual({ kind: 'lambda', label: 'orders-process', in: 'private-b' });
    // Not known yet which zone it lands in: in the VPC, on the row of its subnets.
    expect(doc.nodes.ledger).toEqual({ kind: 'rds', label: 'orders-ledger', size: 'db.t4g.medium', tier: 'private', in: 'this' });
    expect(doc.nodes.s3).toEqual({ kind: 'vpc-endpoint', label: 's3', in: 'this' });
    // Two buckets, two things called curated: the type tells them apart.
    expect(doc.nodes['s3-bucket-curated']).toEqual({ kind: 's3', label: 'acme-orders-curated' });
    expect(doc.nodes['glue-crawler-curated']).toEqual({ kind: 'glue', label: 'orders-curated', caption: 'Glue crawler' });
    expect(edges).toEqual(
      expect.arrayContaining([
        'landing -> ingest (data)',
        'ingest -> events',
        'events -> process-a (data)',
        'events -> process-b (data)',
        'events -> dead',
        'process-a -> orders',
        'process-a -> ledger',
        'nightly -> reconcile (data)',
        'reconcile -> alerts',
        'alerts -> notify (data)',
        'clicks -> s3-bucket-curated',
      ]),
    );
    expect(warnings).toEqual(['Left out 1 resources of types that are not drawn: aws_glue_catalog_database']);
  });

  it('reads Google Cloud: a global network, regional subnets, zonal machines', async () => {
    const { doc, edges, warnings } = await imported(fixture('gcp-state'));
    expect(doc.provider).toBe('gcp');
    expect(doc.direction).toBeUndefined();
    expect(doc.groups).toEqual({
      data: { kind: 'vpc', label: 'data' },
      workers: { kind: 'subnet', label: 'workers', region: 'europe-west4', cidr: '10.20.0.0/24', in: 'data' },
    });
    expect(doc.nodes).toMatchObject({
      raw: { kind: 'bigquery', label: 'Raw' },
      ingest: { kind: 'dataflow', label: 'events-to-bigquery', size: 'n2-standard-4', in: 'workers' },
      orchestrator: { kind: 'composer', in: 'workers' },
      bastion: { kind: 'compute-engine', size: 'e2-small', zone: 'europe-west4-a', in: 'workers' },
      // By its private network.
      metadata: { kind: 'cloud-sql', size: 'db-custom-2-7680', in: 'data' },
      // Two things called nat: the router, and the NAT on it (in the router's network).
      'router-nat': { kind: 'cloud-router', in: 'data' },
      'router-nat-nat': { kind: 'cloud-nat', label: 'egress', in: 'data' },
      api_key: { kind: 'secret-manager', label: 'partner-api-key' },
    });
    expect(edges).toEqual([
      // A subscription: the topic feeds what reads it.
      'events -> ingest (data)',
      'landing -> events (data)',
      'api -> events',
      // The scheduler calls a route of the service.
      'nightly -> api',
      // A trigger comes before its function.
      'events -> loader (data)',
      'loader -> raw',
      'orchestrator -> curated',
      'orchestrator -> raw',
      'router-nat-nat -> router-nat',
      'ingest -> landing',
    ]);
    expect(warnings).toEqual(['Left out 2 resources of types that are not drawn: google_bigquery_table ×2']);
  });

  it('names a subnet by its own name where there are no zone columns', async () => {
    const state = JSON.parse(fixture('aws-state')) as { values: { root_module: { resources: { address: string; type: string; index?: number }[] } } };
    // One zone left: no columns, and what was spread over two subnets sits in one.
    state.values.root_module.resources = state.values.root_module.resources.filter((r) => !(r.index === 1 && /^aws_(subnet|route_table_association)$/.test(r.type)));
    const { doc } = await imported(JSON.stringify(state));
    expect(doc.direction).toBeUndefined();
    expect(doc.groups['public-0']).toEqual({ kind: 'subnet', label: 'shop-public-a', tier: 'public', zone: 'eu-west-1a', cidr: '10.0.0.0/24', in: 'vpc-main' });
    expect(doc.nodes.web).toEqual({ kind: 'alb', label: 'shop-web', exposure: 'public', in: 'public-0' });
    expect(doc.nodes.app).toEqual({ kind: 'ecs', label: 'shop-app', in: 'app-0' });
  });

  it('says what is wrong with a file it cannot use', () => {
    expect(importTerraform('resource "aws_vpc" "main" {}')).toEqual({ yaml: '', warnings: [expect.stringMatching(/^Not JSON: .* Expected the output of terraform show -json$/)] });
    expect(importTerraform('{"format_version": "1.0", "values": {"root_module": {}}}')).toEqual({ yaml: '', warnings: ['No AWS or Google Cloud resources found: expected the output of terraform show -json (a state or a saved plan)'] });
    const only = { format_version: '1.0', values: { root_module: { resources: [{ address: 'aws_iam_role.x', mode: 'managed', type: 'aws_iam_role', name: 'x', values: {} }] } } };
    expect(importTerraform(JSON.stringify(only))).toEqual({ yaml: '', warnings: ['None of the 1 resources is one the cloud type draws'] });
  });
});
