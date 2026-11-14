// AWS and Google Cloud: the containers a resource sits in (organization, account or project, region,
// VPC, availability zone, subnet) and the services in them. One file may mix providers, and Azure too:
// a node's provider follows from its kind, a container's from `provider:`, its kind or what it sits in.
//
//   provider: aws
//   groups:
//     vpc: { kind: vpc, cidr: 10.0.0.0/16 }
//     az-a: { kind: zone, zone: eu-west-1a, in: vpc }
//     public-a: { kind: subnet, tier: public, cidr: 10.0.0.0/24, in: az-a }
//     app-a: { kind: subnet, tier: private, cidr: 10.0.10.0/24, in: az-a }
//   nodes:
//     alb: { kind: alb, in: public-a, exposure: public }
//     web: { kind: ecs, label: Web shop, in: app-a, size: 2 vCPU }
//
// Subnet tiers line up as rows across the zones (public, private, isolated), so three zones with the
// same tiers read as a grid. Address ranges are checked the way the network type checks an IP plan.
import {
  buildGraph,
  english,
  graphReferences,
  graphSchema,
  parseEdge,
  type BuildContext,
  type DiagramType,
  type Entry,
  type Graph,
  type GraphSource,
  type GraphTypeConfig,
  type PaletteItem,
  type Tone,
} from '@linework/core';
import { config as azureConfig } from '@linework/azure';
import { awsGroups, awsNodes, gcpGroups, gcpNodes, generalNodes, providerNames, providers, sharedGroups, sharedLabels, type CloudKind, type Provider } from './kinds.ts';

export { awsNodes, countKinds, gcpNodes, providers, type Provider } from './kinds.ts';

const groupTable: Record<string, CloudKind> = { ...sharedGroups, ...awsGroups, ...gcpGroups };
const nodeTable: Record<string, CloudKind> = { ...generalNodes, ...awsNodes, ...gcpNodes };

/**
 * Azure's kinds are the azure type's own, by reference: a multi-cloud drawing speaks its words. Four of
 * them are also the model's words for any cloud (storage, load-balancer, dns, firewall): those are
 * `azure-storage` and so on here, so that a model's `storage` becomes S3 in an AWS file.
 */
const modelWords = new Set(['storage', 'load-balancer', 'dns', 'firewall']);
const azureOnly = <T>(kinds: Record<string, T>, mine: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(kinds).filter(([k]) => !mine[k]).map(([k, v]) => [modelWords.has(k) ? `azure-${k}` : k, v]));
const azureGroups = azureOnly(azureConfig.groupKinds, groupTable);
const azureNodes = azureOnly(azureConfig.nodeKinds, nodeTable);
/** The azure type's name for one of its kinds as written here. */
export const azureKind = (kind: string) => (kind.startsWith('azure-') && modelWords.has(kind.slice(6)) ? kind.slice(6) : kind);

const plain = ({ label, icon, tone, keywords, quiet, border }: CloudKind) => ({ label, icon, tone, ...(keywords ? { keywords } : {}), ...(quiet ? { quiet } : {}), ...(border ? { border } : {}) });

const tiers = ['public', 'private', 'isolated'] as const;
type Tier = (typeof tiers)[number];
const tierTone: Record<Tier, Tone> = { public: 'green', private: 'sky', isolated: 'indigo' };
const tierLabel: Record<Tier, string> = { public: 'Public subnet', private: 'Private subnet', isolated: 'Isolated subnet' };

/** Model kinds (the systems type's words) as the service that usually hosts them, per provider. */
const aliases: Record<Provider, Record<string, string>> = {
  aws: {
    person: 'user',
    client: 'client',
    api: 'ecs',
    worker: 'ecs',
    container: 'ecs',
    function: 'lambda',
    job: 'lambda',
    server: 'ec2',
    database: 'rds',
    cache: 'elasticache',
    storage: 's3',
    warehouse: 'redshift',
    queue: 'sqs',
    topic: 'sns',
    secrets: 'secrets-manager',
    identity: 'cognito',
    monitoring: 'cloudwatch',
    gateway: 'api-gateway',
    'load-balancer': 'alb',
    cdn: 'cloudfront',
    dns: 'route53',
    firewall: 'network-firewall',
    search: 'opensearch',
    ai: 'bedrock',
    mobile: 'client',
    desktop: 'client',
    payments: 'external',
    system: 'boundary',
    group: 'boundary',
    team: 'boundary',
    domain: 'boundary',
    cluster: 'eks-cluster',
    cloud: 'aws',
  },
  gcp: {
    person: 'user',
    client: 'client',
    api: 'cloud-run',
    worker: 'cloud-run',
    container: 'cloud-run',
    function: 'cloud-functions',
    job: 'cloud-functions',
    server: 'compute-engine',
    database: 'cloud-sql',
    cache: 'memorystore',
    storage: 'gcs',
    warehouse: 'bigquery',
    queue: 'pubsub',
    topic: 'pubsub',
    secrets: 'secret-manager',
    identity: 'identity-platform',
    monitoring: 'cloud-monitoring',
    gateway: 'cloud-api-gateway',
    'load-balancer': 'cloud-load-balancing',
    cdn: 'cloud-cdn',
    dns: 'cloud-dns',
    firewall: 'cloud-firewall',
    ai: 'vertex-ai',
    mobile: 'client',
    desktop: 'client',
    payments: 'external',
    system: 'boundary',
    group: 'boundary',
    team: 'boundary',
    domain: 'boundary',
    cluster: 'gke-cluster',
    cloud: 'gcp',
  },
  azure: {
    ...azureConfig.kindAliases,
    client: 'client',
    storage: 'azure-storage',
    'load-balancer': 'azure-load-balancer',
    dns: 'azure-dns',
    firewall: 'azure-firewall',
    group: 'boundary',
    team: 'boundary',
    domain: 'boundary',
    cluster: 'aks-cluster',
  },
};

const base: GraphTypeConfig = {
  groupKinds: { ...Object.fromEntries(Object.entries(groupTable).map(([k, v]) => [k, plain(v)])), ...azureGroups },
  nodeKinds: { ...Object.fromEntries(Object.entries(nodeTable).map(([k, v]) => [k, plain(v)])), ...azureNodes },
  // The azure type's styles and tones, plus the two that cross a network's edge.
  edgeStyles: {
    public: { label: 'Public traffic', line: 'solid', tone: 'sky' },
    private: { label: 'Private network', line: 'dashed', tone: 'teal' },
    data: { label: 'Data flow', line: 'solid', tone: 'violet' },
    identity: { label: 'Identity', line: 'dotted', tone: 'amber' },
    peering: { label: 'Peering', line: 'dashed', tone: 'blue' },
    vpn: { label: 'VPN / interconnect', line: 'dashed', tone: 'orange' },
    management: { label: 'Management', line: 'dotted', tone: 'slate' },
  },
  plainEdge: 'Connection',
};

/** The type's config; model kinds become the services of `provider`. */
export const configFor = (provider: Provider = 'aws'): GraphTypeConfig => ({ ...base, kindAliases: aliases[provider] });
export const config = configFor('aws');

export interface CloudEntry extends Entry {
  provider?: Provider;
  cidr?: string;
  account?: string | number;
  project?: string;
  region?: string;
  zone?: string;
  tier?: Tier;
  size?: string;
  exposure?: 'public' | 'internal';
}

export interface CloudSource extends GraphSource {
  provider?: Provider;
  groups?: Record<string, string | CloudEntry | null>;
  nodes?: Record<string, string | CloudEntry | null>;
}

const groupDetails = {
  provider: { enum: providers, description: 'Whose container this is, when it differs from what it sits in' },
  cidr: { type: 'string', description: 'Address range, e.g. 10.0.0.0/16' },
  account: { type: ['string', 'integer'], description: 'AWS account id, e.g. "123456789012"' },
  project: { type: 'string', description: 'Google Cloud project id, e.g. shop-prod-4711' },
  region: { type: 'string', description: 'Region code, e.g. eu-west-1 or europe-west4' },
  zone: { type: 'string', description: 'Zone code, e.g. eu-west-1a or europe-west4-b' },
  tier: { enum: [...tiers], description: 'Subnet tier: public (route to the internet), private (out through NAT) or isolated (no way out)' },
};
const nodeDetails = {
  size: { type: 'string', description: 'Instance type, SKU or capacity, e.g. m7g.large or db-custom-4-16384' },
  zone: { type: 'string', description: 'Zone it runs in, when the zone is not drawn as a group' },
  exposure: { enum: ['public', 'internal'], description: 'public: reachable from the internet (internet-facing); internal: only from inside' },
  tier: { enum: [...tiers], description: 'Row to line up with: the tier of the subnets beside it' },
};
const detailKeys = new Set([...Object.keys(groupDetails), ...Object.keys(nodeDetails)]);

const entry = (raw: unknown): CloudEntry => (typeof raw === 'string' ? { kind: raw } : raw && typeof raw === 'object' ? { ...(raw as CloudEntry) } : {});
const kindInfo = (kind: string | undefined): { label: string; quiet?: boolean; provider?: Provider; zonal?: boolean } | undefined => {
  if (!kind) return undefined;
  const mine = nodeTable[kind] ?? groupTable[kind];
  if (mine) return mine;
  const theirs = azureConfig.nodeKinds[azureKind(kind)] ?? azureConfig.groupKinds[azureKind(kind)];
  return theirs ? { ...theirs, provider: 'azure' } : undefined;
};
const says = (label: string | undefined, name: string) => {
  const l = label?.toLowerCase();
  const k = name.toLowerCase();
  return l === k || !!l?.endsWith(` ${k}`);
};
const join = (parts: unknown[]) => {
  const list = parts.filter((p) => p != null && p !== '').map(String);
  return list.length ? list.join(' · ') : undefined;
};

/** What the diagram says, read once: entries, parents, the provider of each. */
function read(src: CloudSource) {
  const top: Provider = providers.includes(src.provider as Provider) ? src.provider! : 'aws';
  const groups = new Map(Object.entries(src.groups ?? {}).map(([id, raw]) => [id, entry(raw)] as const));
  const nodes = new Map(Object.entries(src.nodes ?? {}).map(([id, raw]) => [id, entry(raw)] as const));
  const ancestors = (id: string | undefined): string[] => {
    const out: string[] = [];
    for (let p = id; p && groups.has(p) && !out.includes(p); p = groups.get(p)!.in) out.push(p);
    return out;
  };
  const cache = new Map<string, Provider>();
  const groupProvider = (id: string): Provider => {
    if (!cache.has(id)) {
      const chain = ancestors(id);
      const hit = chain.map((g) => groups.get(g)!).map((e) => (providers.includes(e.provider as Provider) ? e.provider : kindInfo(e.kind)?.provider)).find(Boolean);
      cache.set(id, hit ?? top);
    }
    return cache.get(id)!;
  };
  const nodeProvider = (id: string): Provider => {
    const e = nodes.get(id)!;
    return kindInfo(e.kind)?.provider ?? (e.in && groups.has(e.in) ? groupProvider(e.in) : top);
  };
  /** The tier of the nearest subnet around a node or group. */
  const tierOf = (id: string | undefined): { tier: Tier; subnet: string } | undefined => {
    for (const g of ancestors(id)) {
      const e = groups.get(g)!;
      if (e.kind === 'subnet' && tiers.includes(e.tier as Tier)) return { tier: e.tier!, subnet: g };
    }
    return undefined;
  };
  return { top, groups, nodes, ancestors, groupProvider, nodeProvider, tierOf };
}

// ---------------------------------------------------------------- checks

/** An IPv4 prefix as [first, last] address, or undefined when it is not one. */
export function range(cidr: string): [number, number] | undefined {
  const m = /^\s*(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)\s*$/.exec(cidr);
  if (!m) return undefined;
  const octets = m.slice(1, 5).map(Number);
  const bits = Number(m[5]);
  if (octets.some((o) => o > 255) || bits > 32) return undefined;
  const ip = octets.reduce((a, o) => a * 256 + o, 0);
  const size = 2 ** (32 - bits);
  const first = Math.floor(ip / size) * size;
  return [first, first + size - 1];
}

const networks = new Set(['vpc', 'vnet']);
/** Kinds that join networks: two VPCs on the same one must not overlap. */
const hubs = new Set(['transit-gateway', 'cloud-router', 'vpn', 'cloud-vpn', 'direct-connect', 'interconnect', 'vpn-gateway']);
const outsiders = new Set(['internet', 'users', 'user', 'client']);

/** The mistakes a network review catches: overlapping ranges, a subnet outside its VPC, public things in private subnets, zonal things without a zone. */
function check(src: CloudSource, ctx: BuildContext) {
  const { groups, nodes, ancestors, tierOf } = read(src);
  const prefixed = [...groups].flatMap(([id, e]) => {
    if (typeof e.cidr !== 'string' || e.cidr.includes(':')) return [];
    const r = range(e.cidr);
    if (!r) ctx.warn(['groups', id, 'cidr'], `"${e.cidr}" is not an IPv4 prefix like 10.0.0.0/16`);
    return r ? [{ id, cidr: e.cidr, r, kind: e.kind ?? '' }] : [];
  });
  const byId = new Map(prefixed.map((p) => [p.id, p]));
  const parentRange = (id: string) => ancestors(id).slice(1).map((p) => byId.get(p)).find(Boolean);
  for (const a of prefixed) {
    const parent = parentRange(a.id);
    if (parent && (a.r[0] < parent.r[0] || a.r[1] > parent.r[1])) ctx.warn(['groups', a.id, 'cidr'], `${a.cidr} is outside ${parent.cidr} of "${parent.id}"`);
  }

  // Networks that route to each other: a peering or VPN line between them, or the same hub.
  const netOf = (id: string) => [...(groups.has(id) ? ancestors(id) : ancestors(nodes.get(id)?.in))].find((g) => networks.has(groups.get(g)!.kind ?? ''));
  const linked = new Set<string>();
  const onHub = new Map<string, Set<string>>();
  for (const [i, item] of (src.edges ?? []).entries()) {
    const spec = parseEdge(item, ['edges', i]);
    if (typeof spec === 'string') continue;
    const [a, b] = [spec.from.node, spec.to.node];
    const [na, nb] = [netOf(a), netOf(b)];
    if (na && nb && na !== nb && (spec.props.style === 'peering' || spec.props.style === 'vpn')) linked.add(`${na}\0${nb}`).add(`${nb}\0${na}`);
    for (const [hub, net] of [[a, nb], [b, na]] as const)
      if (net && hubs.has(nodes.get(hub)?.kind ?? '') && netOf(hub) !== net) onHub.set(hub, (onHub.get(hub) ?? new Set()).add(net));
  }
  for (const nets of onHub.values()) for (const a of nets) for (const b of nets) if (a !== b) linked.add(`${a}\0${b}`);

  for (const [i, a] of prefixed.entries())
    for (const b of prefixed.slice(i + 1)) {
      if (a.r[0] > b.r[1] || b.r[0] > a.r[1]) continue;
      if (ancestors(a.id).includes(b.id) || ancestors(b.id).includes(a.id)) continue;
      // Ranges under the same parent range always clash; separate networks only when they route to each other.
      const [pa, pb] = [parentRange(a.id), parentRange(b.id)];
      if (pa && pb && pa.id === pb.id) ctx.warn(['groups', b.id, 'cidr'], `${b.cidr} overlaps ${a.cidr} of "${a.id}"`);
      else if (!pa && !pb && linked.has(`${a.id}\0${b.id}`)) ctx.warn(['groups', b.id, 'cidr'], `${b.cidr} overlaps ${a.cidr} of "${a.id}", and the two are connected`);
    }

  // Internet-facing things belong in a public subnet.
  for (const [id, e] of nodes) {
    const t = tierOf(e.in);
    if (!t || t.tier === 'public') continue;
    if (e.exposure === 'public') ctx.warn(['nodes', id, 'exposure'], `"${id}" is marked public but sits in the ${t.tier} subnet "${t.subnet}"`);
    else if (e.kind === 'nat-gateway' && e.exposure !== 'internal')
      ctx.warn(['nodes', id, 'in'], `A NAT gateway reaches the internet from a public subnet; "${id}" sits in the ${t.tier} subnet "${t.subnet}" (exposure: internal for a private NAT gateway)`);
  }
  for (const [i, item] of (src.edges ?? []).entries()) {
    const spec = parseEdge(item, ['edges', i]);
    if (typeof spec === 'string' || spec.props.style !== 'public') continue;
    const [from, to] = [nodes.get(spec.from.node), nodes.get(spec.to.node)];
    const t = to && tierOf(to.in);
    if (from && outsiders.has(from.kind ?? '') && t && t.tier !== 'public') ctx.warn(['edges', i], `Public traffic goes straight to "${spec.to.node}" in the ${t.tier} subnet "${t.subnet}"`);
  }

  // Once zones are drawn, a zonal resource outside all of them is a question: which zone?
  const zoned = (g: string) => groups.get(g)!.kind === 'zone' || !!groups.get(g)!.zone;
  if ([...groups.keys()].some(zoned))
    for (const [id, e] of nodes) {
      const kind = kindInfo(e.kind);
      if (!kind?.zonal || e.zone) continue;
      const around = ancestors(e.in);
      // A scaling group spreads its instances over zones by itself.
      if (around.some((g) => zoned(g) || groups.get(g)!.kind === 'auto-scaling-group' || groups.get(g)!.kind === 'instance-group')) continue;
      ctx.warn(['nodes', id], `"${id}" (${kind.label}) lives in one zone: put it in a zone or set zone:`);
    }
}

// ---------------------------------------------------------------- build

function build(src: CloudSource, ctx: BuildContext): Graph {
  const word = ctx.word ?? english;
  check(src, ctx);
  const info = read(src);
  // Labels that follow from the details; the details themselves end up in the caption after the build.
  const strip = (e: CloudEntry) => {
    const out: Record<string, unknown> = { ...e };
    for (const k of detailKeys) delete out[k];
    return out as Entry;
  };
  const groups: Record<string, string | Entry | null> = {};
  for (const [id, raw] of Object.entries(src.groups ?? {})) {
    if (raw == null) {
      groups[id] = raw;
      continue;
    }
    const e = entry(raw);
    const tier = e.kind === 'subnet' && tiers.includes(e.tier as Tier) ? e.tier : undefined;
    if (e.label === undefined) {
      if (e.kind === 'zone' && e.zone) e.label = e.zone;
      else if (e.kind === 'region' && e.region) e.label = e.region;
      else if (tier) e.label = tierLabel[tier];
      // `aws: aws` is the AWS Cloud, not "aws".
      else if (e.kind === id && (e.kind === 'aws' || e.kind === 'gcp' || e.kind === 'on-premises' || e.kind === 'organization')) e.label = groupTable[id]!.label;
    }
    if (tier && e.tone === undefined) e.tone = tierTone[tier];
    groups[id] = strip(e);
  }
  const nodes: Record<string, string | Entry | null> = {};
  for (const [id, raw] of Object.entries(src.nodes ?? {})) nodes[id] = raw == null ? raw : strip(entry(raw));

  const { provider: _, ...rest } = src;
  const graph = buildGraph({ ...rest, groups, nodes }, configFor(info.top), ctx);

  const own = (path: unknown[], coll: 'groups' | 'nodes', id: string) => path.length === 2 && path[0] === coll && path[1] === id;
  for (const g of graph.groups) {
    const e = info.groups.get(g.id);
    if (!e || !own(g.path, 'groups', g.id)) continue;
    const provider = info.groupProvider(g.id);
    g.pack = provider;
    if (e.caption !== undefined) continue;
    const kind = kindInfo(e.kind);
    const tier = e.kind === 'subnet' && tiers.includes(e.tier as Tier) ? e.tier : undefined;
    const name = tier ? tierLabel[tier] : (sharedLabels[e.kind ?? '']?.[provider] ?? kind?.label);
    const linked = e.ref != null || (e as { of?: string }).of != null;
    // An account or project id says what the box is: the kind's name would only make the header longer.
    const named = (e.kind === 'account' && e.account != null) || (e.kind === 'project' && e.project != null);
    g.caption = join([
      linked ? g.caption : name && !named && !kind?.quiet && !says(g.label, name) ? name : undefined,
      e.account,
      e.project,
      e.region !== g.label ? e.region : undefined,
      e.zone !== g.label ? e.zone : undefined,
      e.cidr,
    ]);
  }
  for (const n of graph.nodes) {
    const e = info.nodes.get(n.id);
    if (!e || !own(n.path, 'nodes', n.id) || n.shape.kind !== 'card') continue;
    n.pack = info.nodeProvider(n.id);
    const tier = tiers.includes(e.tier as Tier) ? e.tier : info.tierOf(e.in)?.tier;
    if (tier) n.rank = tiers.indexOf(tier) + 1;
    if (e.caption !== undefined) continue;
    const exposure = e.exposure === 'public' ? word('public@exposure') : e.exposure === 'internal' ? word('internal@exposure') : undefined;
    n.shape.caption = join([n.shape.caption, e.size, exposure, e.zone]);
  }
  return graph;
}

function schema(): object {
  const s = graphSchema('cloud', base, 'Linework cloud diagram (AWS, Google Cloud)') as { properties: Record<string, any> };
  const objectOf = (x: { anyOf: { type?: string }[] }) => x.anyOf.find((y) => y.type === 'object') as { properties: Record<string, object> };
  const node = objectOf(s.properties.nodes.additionalProperties);
  node.properties = { ...node.properties, ...nodeDetails };
  const group = objectOf(s.properties.groups.additionalProperties);
  group.properties = { ...group.properties, ...groupDetails };
  s.properties.provider = { enum: providers, description: 'The cloud this file is about (default aws); kinds of the others can still be used' };
  s.properties.direction = { enum: ['right', 'down'], description: 'down reads best for zones side by side with subnet tiers as rows' };
  return s;
}

const item = (collection: string, kind: string, k: CloudKind): PaletteItem => ({
  collection,
  kind,
  label: k.label,
  icon: k.icon,
  tone: k.tone,
  keywords: [...(k.keywords ?? []), ...(k.provider ? [k.provider, providerNames[k.provider].toLowerCase()] : []), k.category],
  ...(k.provider ? { provider: k.provider } : {}),
  ...(k.names ? { names: k.names } : {}),
});

const palette: PaletteItem[] = [
  ...Object.entries(groupTable).map(([kind, k]) => item('groups', kind, k)),
  ...Object.entries(nodeTable).map(([kind, k]) => item('nodes', kind, k)),
];

export const cloud: DiagramType<CloudSource> = {
  id: 'cloud',
  name: 'AWS and Google Cloud',
  description: 'Accounts or projects, regions, VPCs, zones and subnets, and the services in them',
  icon: 'cloud-cog',
  tagline: 'What runs where in AWS or Google Cloud: accounts, VPCs, subnets, zones',
  useWhen: [
    'A VPC across availability zones with its subnet tiers',
    'A data platform on S3, Glue and Redshift, or on BigQuery',
    'A landing zone: organization, accounts or projects, networks',
    'Multi-cloud or hybrid: AWS, Google Cloud, Azure, on-premises',
  ],
  notFor: [
    { text: 'An estate that is only Azure', use: 'azure' },
    { text: 'A cloud-neutral system overview', use: 'systems' },
    { text: 'Pods and services inside a cluster', use: 'kubernetes' },
    { text: 'Devices, cabling and an IP plan', use: 'network' },
  ],
  keywords: [
    'aws', 'amazon', 'gcp', 'google cloud', 'google', 'vpc', 'account', 'project', 'availability zone', 'region', 'multi-cloud', 'multicloud',
    'hybrid cloud', 's3', 'lambda', 'ec2', 'rds', 'ecs', 'eks', 'gke', 'bigquery', 'cloud run', 'transit gateway', 'landing zone', 'data lake',
    'lakehouse', 'terraform', 'cloud', 'infrastructure', 'deployment',
  ],
  schema: schema(),
  palette,
  build,
  references: graphReferences,
  template: `type: cloud
provider: aws
title: Web shop on AWS
subtitle: Production, two availability zones
direction: down

groups:
  account: { kind: account, label: shop-prod, account: "123456789012", region: eu-west-1 }
  vpc: { kind: vpc, label: vpc-shop, cidr: 10.0.0.0/16, in: account }
  az-a: { kind: zone, zone: eu-west-1a, in: vpc }
  az-b: { kind: zone, zone: eu-west-1b, in: vpc }
  app-a: { kind: subnet, tier: private, cidr: 10.0.10.0/24, in: az-a }
  app-b: { kind: subnet, tier: private, cidr: 10.0.11.0/24, in: az-b }
  data-a: { kind: subnet, tier: isolated, cidr: 10.0.20.0/24, in: az-a }
  data-b: { kind: subnet, tier: isolated, cidr: 10.0.21.0/24, in: az-b }

nodes:
  users: users
  cdn: { kind: cloudfront, label: CDN and WAF }
  # The internet gateway and one load balancer across the zones sit on the public row. AWS puts a node of
  # the load balancer in a public subnet of each zone; its caption says so instead of two more boxes.
  igw: { kind: internet-gateway, label: Internet gateway, in: vpc, tier: public }
  alb: { kind: alb, label: Load balancer, in: vpc, tier: public, exposure: public, caption: ALB · a public subnet per zone }
  web-a: { kind: ecs, label: Web shop, in: app-a, size: 2 tasks }
  web-b: { kind: ecs, label: Web shop, in: app-b, size: 2 tasks }
  # One Aurora cluster: a writer and a reader instance on the cluster's shared storage, which Aurora
  # itself keeps in every zone. No line between them: they do not copy data to each other.
  db-a: { kind: aurora, label: Orders reader, in: data-a, caption: Aurora instance · same cluster }
  db-b: { kind: aurora, label: Orders writer, in: data-b, caption: Aurora instance · cluster orders }

edges:
  - users -> cdn: { label: HTTPS, style: public }
  - cdn -> igw: { style: public }
  - igw -> alb: { style: public }
  - alb -> web-a: { style: private }
  - alb -> web-b: { style: private }
  - web-a -> db-b: { style: private }
  - web-b -> db-b: { label: SQL, style: private }
`,
};
