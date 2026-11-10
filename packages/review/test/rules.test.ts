// Every built-in rule on a drawing it should flag and one it should leave alone.
import { describe, expect, it } from 'vitest';
import { render } from '@cartography/engine';
import { builtInRules, review, type Finding } from '../src/index.ts';

async function found(yaml: string, rule: string, load?: (f: string) => string): Promise<Finding[]> {
  const r = await render(yaml, { fonts: 'none', load });
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return review(yaml, r, { load }).findings.filter((f) => f.rule.id === rule && !f.ignored);
}

/** rule id → [should flag, should pass]. */
const cases: Record<string, [string, string]> = {
  'azure.public-without-waf': [
    `type: azure
nodes:
  users: users
  web: { kind: app-service, label: Shop }
edges:
  - users -> web: { style: public }`,
    `type: azure
nodes:
  users: users
  fd: { kind: front-door, label: Front Door }
  web: { kind: app-service, label: Shop }
edges:
  - users -> fd: { style: public }
  - fd -> web: { style: public }`,
  ],
  'azure.data-without-private-endpoint': [
    `type: azure
groups:
  vnet: vnet
nodes:
  app: { kind: app-service, in: vnet }
  db: { kind: sql-database }
edges:
  - app -> db`,
    `type: azure
groups:
  vnet: vnet
  snet: { kind: subnet, in: vnet }
nodes:
  app: { kind: app-service, in: snet }
  pe: { kind: private-endpoint, in: snet }
  db: { kind: sql-database }
edges:
  - app -> pe
  - pe -> db`,
  ],
  'azure.secrets-without-key-vault': [
    `type: azure
nodes:
  api: { kind: container-app }
  db: { kind: sql-database }
  kv: key-vault
  other: { kind: container-app }
edges:
  - api -> db: SQL
  - other -> kv: { style: identity }`,
    `type: azure
nodes:
  api: { kind: container-app }
  db: { kind: sql-database }
  kv: key-vault
edges:
  - api -> db: SQL
  - api -> kv: { style: identity }`,
  ],
  'azure.prod-single-region': [
    `type: azure
title: Shop
subtitle: Production
nodes:
  api: { kind: container-app }`,
    `type: azure
title: Shop
subtitle: Production
nodes:
  api: { kind: container-app, zones: 3 }`,
  ],
  'azure.no-diagnostics': [
    `type: azure
nodes:
  api: { kind: container-app }
  db: { kind: sql-database }
edges:
  - api -> db`,
    `type: azure
nodes:
  api: { kind: container-app }
  db: { kind: sql-database }
  logs: log-analytics
edges:
  - api -> db
  - api -> logs: { style: management }`,
  ],
  'azure.aks-network-policy': [
    `type: azure
nodes:
  aks: { kind: aks, props: { network-policy: none } }`,
    `type: azure
nodes:
  aks: { kind: aks, props: { network-policy: calico } }`,
  ],
  'azure.aks-private-cluster': [
    `type: azure
nodes:
  aks: { kind: aks, props: { private-cluster: false } }`,
    `type: azure
nodes:
  aks: { kind: aks, props: { private-cluster: true } }`,
  ],
  'azure.storage-public-access': [
    `type: azure
nodes:
  st: { kind: storage, public: true }`,
    `type: azure
nodes:
  st: { kind: storage, public: false }`,
  ],
  'azure.owner-at-subscription': [
    `type: access
principals:
  alice: { kind: user, label: Alice }
resources:
  prod: { kind: subscription, label: Production }
roles:
  owner: { label: Owner }
assignments:
  - alice is owner on prod`,
    `type: access
principals:
  admins: { kind: group, label: Admins }
resources:
  prod: { kind: subscription, label: Production }
roles:
  owner: { label: Owner }
assignments:
  - admins is owner on prod`,
  ],
  'aws.alb-without-waf': [
    `type: cloud
provider: aws
nodes:
  users: users
  alb: { kind: alb }
edges:
  - users -> alb`,
    `type: cloud
provider: aws
nodes:
  users: users
  cdn: { kind: cloudfront, tags: [waf] }
  alb: { kind: alb, exposure: public }
edges:
  - users -> cdn
  - cdn -> alb`,
  ],
  'aws.rds-single-az': [
    `type: cloud
provider: aws
title: Shop
subtitle: Production
groups:
  a: { kind: zone, zone: eu-west-1a }
nodes:
  db: { kind: rds, in: a }`,
    `type: cloud
provider: aws
title: Shop
subtitle: Production
groups:
  a: { kind: zone, zone: eu-west-1a }
nodes:
  db: { kind: rds, in: a, props: { multi-az: true } }`,
  ],
  'aws.s3-public': [
    `type: cloud
provider: aws
nodes:
  b: { kind: s3, public: true }`,
    `type: cloud
provider: aws
nodes:
  b: { kind: s3 }`,
  ],
  'aws.no-audit-trail': [
    `type: cloud
provider: aws
nodes:
  a: ec2
  b: rds
  c: s3`,
    `type: cloud
provider: aws
nodes:
  a: ec2
  b: rds
  c: s3
  t: cloudtrail`,
  ],
  'aws.nat-single-az': [
    `type: cloud
provider: aws
groups:
  a: { kind: zone, zone: eu-west-1a }
  b: { kind: zone, zone: eu-west-1b }
  pa: { kind: subnet, tier: public, in: a }
  sa: { kind: subnet, tier: private, in: a }
  sb: { kind: subnet, tier: private, in: b }
nodes:
  nat: { kind: nat-gateway, in: pa }`,
    `type: cloud
provider: aws
groups:
  a: { kind: zone, zone: eu-west-1a }
  b: { kind: zone, zone: eu-west-1b }
  pa: { kind: subnet, tier: public, in: a }
  pb: { kind: subnet, tier: public, in: b }
  sa: { kind: subnet, tier: private, in: a }
  sb: { kind: subnet, tier: private, in: b }
nodes:
  nat-a: { kind: nat-gateway, in: pa }
  nat-b: { kind: nat-gateway, in: pb }`,
  ],
  'k8s.resource-limits': [
    `type: kubernetes
nodes:
  a: { kind: deployment, props: { limits: cpu 1 } }
  b: { kind: deployment }`,
    `type: kubernetes
nodes:
  a: { kind: deployment, props: { limits: cpu 1 } }
  b: { kind: deployment, props: { limits: cpu 1 } }`,
  ],
  'k8s.loadbalancer-service': [
    `type: kubernetes
nodes:
  svc: { kind: service, serviceType: LoadBalancer }
  app: deployment
edges:
  - svc -> app`,
    `type: kubernetes
nodes:
  svc: { kind: service, serviceType: LoadBalancer }
  ctl: deployment
  ing: ingress
edges:
  - svc -> ctl
  - ctl -> ing`,
  ],
  'k8s.no-network-policy': [
    `type: kubernetes
groups:
  ns: namespace
nodes:
  app: { kind: deployment, in: ns }`,
    `type: kubernetes
groups:
  ns: namespace
nodes:
  app: { kind: deployment, in: ns }
  np: { kind: networkpolicy, in: ns }`,
  ],
  'k8s.secret-as-env': [
    `type: kubernetes
nodes:
  app: deployment
  s: secret
edges:
  - app -> s: envFrom`,
    `type: kubernetes
nodes:
  app: deployment
  s: secret
edges:
  - app -> s: volume`,
  ],
  'arch.external-to-datastore': [
    `type: systems
nodes:
  p: { kind: external, label: Partner }
  db: database
edges:
  - p -> db`,
    `type: systems
nodes:
  p: { kind: external, label: Partner }
  api: service
  db: database
edges:
  - p -> api
  - api -> db`,
  ],
  'arch.deep-sync-chain': [
    `type: systems
nodes: { a: service, b: service, c: service, d: service, e: service, f: database }
edges: [a -> b, b -> c, c -> d, d -> e, e -> f]`,
    `type: systems
nodes: { a: service, b: service, c: service, d: service, q: queue, e: service, f: database }
edges:
  - a -> b
  - b -> c
  - c -> d
  - d -> q: publishes
  - q -> e
  - e -> f`,
  ],
  'arch.single-point-of-failure': [
    `type: systems
nodes:
  a: { kind: service, props: { count: 2 } }
  b: { kind: service, props: { count: 2 } }
  c: { kind: service, props: { count: 2 } }
  auth: { kind: service, props: { count: 1 }, label: Auth }
edges:
  - a -> auth
  - b -> auth
  - c -> auth`,
    `type: systems
nodes:
  a: { kind: service, props: { count: 2 } }
  b: { kind: service, props: { count: 2 } }
  c: { kind: service, props: { count: 2 } }
  auth: { kind: service, props: { count: 3 }, label: Auth }
edges:
  - a -> auth
  - b -> auth
  - c -> auth`,
  ],
  'arch.service-cycle': [
    `type: systems
nodes: { a: service, b: service, c: service }
edges: [a -> b, b -> c, c -> a]`,
    `type: systems
nodes: { a: service, b: service, c: service }
edges:
  - a -> b
  - b -> c
  - c -> a: { label: OrderShipped event }`,
  ],
  'github.repo-without-ruleset': [
    `type: github
groups:
  shop: { kind: repo }
  api: { kind: repo }
nodes:
  r: { kind: ruleset, in: shop }
  ci: { kind: workflow, in: api }`,
    `type: github
groups:
  shop: { kind: repo }
nodes:
  r: { kind: ruleset, in: shop }
  ci: { kind: workflow, in: shop }`,
  ],
  'github.admin-on-many-repos': [
    `type: github
nodes:
  t: team
  r: repo
edges:
  - t -> r: { label: admin on 9, style: access }`,
    `type: github
nodes:
  t: team
  r: repo
edges:
  - t -> r: { label: admin on 3, style: access }`,
  ],
  'github.outside-collaborator-admin': [
    `type: github
nodes:
  c: outside-collaborator
  r: repo
edges:
  - c -> r: { label: admin, style: access }`,
    `type: github
nodes:
  c: outside-collaborator
  r: repo
edges:
  - c -> r: { label: write, style: access }`,
  ],
  'data.output-without-contract': [
    `type: data-products
products:
  a: { outputs: { t: table } }
  b: { inputs: [a] }`,
    `type: data-products
products:
  a: { outputs: { t: { kind: table, contract: c } } }
  b: { inputs: [a] }
contracts:
  c: { fields: { id: int pk } }`,
  ],
  'data.pii-without-classification': [
    `type: data-products
products:
  a: { outputs: { t: { kind: table, contract: c } } }
contracts:
  c: { fields: { email: string pii } }`,
    `type: data-products
products:
  a: { outputs: { t: { kind: table, contract: c } } }
contracts:
  c: { classification: confidential, fields: { email: string pii } }`,
  ],
};

describe('built-in rules', () => {
  it('has a case for every rule', () => {
    expect(Object.keys(cases).sort()).toEqual(builtInRules.map((r) => r.id).sort());
  });
  for (const [id, [bad, good]] of Object.entries(cases))
    it(id, async () => {
      expect((await found(bad, id)).length, 'flags the bad one').toBeGreaterThan(0);
      expect(await found(good, id), 'leaves the good one').toEqual([]);
    });
  it('says every rule as data: title, why, fix, a pillar and the types it reads', () => {
    for (const r of builtInRules) {
      expect(r.id).toMatch(/^[a-z0-9]+\.[a-z0-9-]+$/);
      expect(r.title.length).toBeGreaterThan(10);
      expect(r.why).toMatch(/\.$/);
      expect(r.fix.length).toBeGreaterThan(10);
      expect(r.appliesTo.length).toBeGreaterThan(0);
    }
  });
});
