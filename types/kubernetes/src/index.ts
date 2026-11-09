// Kubernetes workloads and how traffic reaches them: ingress → service → deployment, grouped by
// cluster and namespace. Config, secrets, volumes, service accounts and autoscalers are what make
// other tools an icon soup, so here they fold into badges on the workload that uses them.
//
//   groups:
//     prod: cluster
//     shop: { kind: namespace, in: prod }
//   nodes:
//     web: { kind: ingress, in: shop, host: shop.example.com }
//     api: { kind: deployment, in: shop, replicas: 3, image: shop/api:1.4, ports: [8080] }
//     api-config: { kind: configmap, in: shop }
//   edges:
//     - web -> api-svc: /api
//     - api -> api-config        # style inferred from the kinds: mounts, drawn as a badge
//
// Styles come from the kinds at both ends when an edge does not name one, and replicas, image and
// ports become the caption, so a plain `a -> b` list reads right.
import { buildGraph, graphReferences, graphSchema, parseEdge, type DiagramType, type GraphSource, type GraphTypeConfig, type PaletteItem } from '@cartography/core';

export const config: GraphTypeConfig = {
  groupKinds: {
    cluster: { label: 'Cluster', icon: 'ship-wheel', tone: 'blue', keywords: ['k8s', 'eks', 'aks', 'gke'] },
    namespace: { label: 'Namespace', icon: 'folder', tone: 'slate', border: 'dashed', keywords: ['ns', 'tenant'] },
    'node-pool': { label: 'Node pool', icon: 'server', tone: 'teal', border: 'dashed', keywords: ['node group', 'nodes', 'agent pool'] },
    boundary: { label: 'Boundary', icon: 'square-dashed', tone: 'slate', border: 'dashed', quiet: true },
  },
  nodeKinds: {
    ingress: { label: 'Ingress', icon: 'route', tone: 'sky', keywords: ['nginx', 'traefik', 'http'] },
    gateway: { label: 'Gateway', icon: 'split', tone: 'sky', keywords: ['gateway api', 'httproute', 'envoy', 'istio'] },
    service: { label: 'Service', icon: 'network', tone: 'teal', keywords: ['svc', 'clusterip', 'loadbalancer'] },
    deployment: { label: 'Deployment', icon: 'layers', tone: 'blue', keywords: ['deploy', 'replicaset', 'app'] },
    statefulset: { label: 'StatefulSet', icon: 'database', tone: 'indigo', keywords: ['sts', 'postgres', 'database', 'kafka'] },
    daemonset: { label: 'DaemonSet', icon: 'server-cog', tone: 'violet', keywords: ['ds', 'agent', 'per node'] },
    job: { label: 'Job', icon: 'circle-play', tone: 'amber', keywords: ['batch', 'migration'] },
    cronjob: { label: 'CronJob', icon: 'calendar-clock', tone: 'amber', keywords: ['schedule', 'cron'] },
    pod: { label: 'Pod', icon: 'box', tone: 'blue', keywords: ['container'] },
    configmap: { label: 'ConfigMap', icon: 'file-sliders', tone: 'slate', keywords: ['config', 'cm'] },
    secret: { label: 'Secret', icon: 'file-key', tone: 'amber', keywords: ['credentials', 'tls'] },
    pvc: { label: 'Volume claim', icon: 'hard-drive', tone: 'teal', keywords: ['pvc', 'volume', 'disk', 'storage'] },
    storageclass: { label: 'StorageClass', icon: 'archive', tone: 'teal', keywords: ['sc', 'csi'] },
    serviceaccount: { label: 'ServiceAccount', icon: 'id-card', tone: 'slate', keywords: ['sa', 'identity', 'rbac', 'workload identity'] },
    hpa: { label: 'Autoscaler', icon: 'scaling', tone: 'green', keywords: ['hpa', 'autoscaling', 'keda'] },
    networkpolicy: { label: 'NetworkPolicy', icon: 'shield-check', tone: 'rose', keywords: ['firewall', 'netpol'] },
    external: { label: 'External', icon: 'earth', tone: 'slate', keywords: ['saas', 'managed', 'third party', 'outside'] },
    user: { label: 'User', icon: 'user', tone: 'slate', keywords: ['person'] },
    users: { label: 'Users', icon: 'users', tone: 'slate', keywords: ['customers', 'people'] },
    internet: { label: 'Internet', icon: 'globe', tone: 'slate', keywords: ['public', 'web'] },
  },
  edgeStyles: {
    traffic: { label: 'Traffic', line: 'solid', tone: 'blue' },
    mounts: { label: 'Mounts', line: 'dotted', tone: 'slate' },
    identity: { label: 'Identity', line: 'dotted', tone: 'amber' },
    scales: { label: 'Scales', line: 'dotted', tone: 'green' },
    policy: { label: 'Network policy', line: 'dashed', tone: 'rose' },
  },
  plainEdge: 'Connection',
};

/** What fields add to the caption, in this order. */
const details = {
  replicas: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'string' }], description: 'Replica count, or a range like 2-10' },
  image: { type: 'string', description: 'Container image; the caption shows name:tag' },
  ports: { anyOf: [{ type: ['integer', 'string'] }, { type: 'array', items: { type: ['integer', 'string'] } }], description: 'Ports, e.g. [8080] or ["80:8080"]' },
  host: { type: 'string', description: 'Host name an ingress or gateway answers to' },
  schedule: { type: 'string', description: 'Cron schedule of a CronJob' },
  size: { type: 'string', description: 'Requested storage, e.g. 10Gi' },
  serviceType: { enum: ['ClusterIP', 'NodePort', 'LoadBalancer', 'ExternalName'] },
};

/** Badged by default: the links that otherwise turn a Kubernetes drawing into a web. */
export const defaultBadges = ['mounts', 'identity', 'scales'];

// Kinds that hang off a workload: their links infer a style, and they fold into its badges.
const styleOfKind: Record<string, string> = { configmap: 'mounts', secret: 'mounts', pvc: 'mounts', storageclass: 'mounts', serviceaccount: 'identity', hpa: 'scales', networkpolicy: 'policy' };
const outside = new Set(['user', 'users', 'internet', 'external']);
const foldable = new Set(['configmap', 'secret', 'pvc', 'serviceaccount', 'hpa', 'networkpolicy']);

interface K8sEntry {
  kind?: string;
  label?: string;
  caption?: string;
  replicas?: number | string;
  image?: string;
  ports?: number | string | (number | string)[];
  host?: string;
  schedule?: string;
  size?: string;
  serviceType?: string;
  [k: string]: unknown;
}

/** shop/api:1.4 and ghcr.io/acme/shop/api:1.4@sha256:… both read "api:1.4". */
export function shortImage(image: string): string {
  const [ref, digest] = image.split('@');
  const name = ref!.split('/').pop()!;
  return !name.includes(':') && digest ? `${name}@${digest.replace(/^sha256:/, '').slice(0, 7)}` : name;
}

function portText(p: number | string): string {
  const s = String(p).replace(/\s*(:|->|→)\s*/, '→');
  return `:${s}`;
}

function detailText(e: K8sEntry): string[] {
  const out: string[] = [];
  if (e.serviceType && e.serviceType !== 'ClusterIP') out.push(e.serviceType);
  if (e.replicas != null) out.push(`×${String(e.replicas).replace(/\s*-\s*/, '–')}`);
  if (e.image) out.push(shortImage(e.image));
  if (e.ports != null) out.push((Array.isArray(e.ports) ? e.ports : [e.ports]).map(portText).join(' '));
  for (const k of ['host', 'schedule', 'size'] as const) if (e[k]) out.push(e[k]!);
  return out;
}

/** Same rule as the shared graph caption: the kind, unless the label already says it. */
function kindCaption(label: string | undefined, kind: string | undefined): string | undefined {
  const k = config.nodeKinds[kind ?? '']?.label;
  if (!k || label === undefined) return undefined;
  const l = label.toLowerCase();
  return l === k.toLowerCase() || l.endsWith(` ${k.toLowerCase()}`) ? undefined : k;
}

export function buildKubernetes(src: GraphSource, ctx: Parameters<DiagramType['build']>[1]) {
  const kinds = new Map<string, string>();
  const nodes: Record<string, string | K8sEntry> = {};
  for (const [id, raw] of Object.entries(src.nodes ?? {})) {
    const e: K8sEntry = typeof raw === 'string' ? { kind: raw } : { ...(raw as K8sEntry) };
    kinds.set(id, e.kind ?? '');
    // Resources have names, and the id is that name: "api", not "Deployment". People and the outside keep the kind.
    if (e.label === undefined && config.nodeKinds[e.kind ?? ''] && !outside.has(e.kind!)) e.label = id;
    const more = detailText(e);
    // A LoadBalancer is worth saying instead of "Service"; the rest follows the kind.
    const head = e.serviceType && e.serviceType !== 'ClusterIP' ? undefined : kindCaption(e.label, e.kind);
    if (e.caption === undefined && more.length) e.caption = [head, ...more].filter(Boolean).join(' · ');
    for (const k of Object.keys(details)) delete e[k];
    nodes[id] = e;
  }

  // Name the style from the kinds when the edge does not: `api -> api-config` mounts it.
  const styles: (string | undefined)[] = [];
  const edges = (src.edges ?? []).map((item, i) => {
    const spec = parseEdge(item, ['edges', i]);
    if (typeof spec === 'string') return item;
    if (typeof spec.props.style === 'string') return (styles[i] = spec.props.style), item;
    if (spec.line !== 'solid' || spec.props.line) return item;
    const [a, b] = [kinds.get(spec.from.node), kinds.get(spec.to.node)];
    const style = styleOfKind[a ?? ''] ?? styleOfKind[b ?? ''] ?? (a !== undefined && b !== undefined ? 'traffic' : undefined);
    if (!style) return item;
    styles[i] = style;
    if (typeof item === 'string') return { [item]: { style } };
    const o = item as Record<string, unknown>;
    if ('from' in o) return { ...o, style };
    const [key, value] = Object.entries(o)[0]!;
    return { [key]: value && typeof value === 'object' ? { ...value, style } : { label: value ?? undefined, style } };
  });

  const graph = buildGraph({ ...src, nodes, edges, badges: src.badges ?? defaultBadges }, config, ctx);

  // A badge belongs on the workload, whichever way the edge was written (hpa -> api, api -> config).
  for (const e of graph.edges) {
    const [a, b] = [kinds.get(e.from.node), kinds.get(e.to.node)];
    if (e.badge && foldable.has(a ?? '') && b !== undefined && !foldable.has(b)) [e.from, e.to] = [e.to, e.from];
  }
  // Fold what is only ever a badge on others: it is named on every card that uses it.
  for (const n of graph.nodes) {
    if (!foldable.has(kinds.get(n.id) ?? '') || n.shape.kind !== 'card') continue;
    const touching = graph.edges.filter((e) => e.from.node === n.id || e.to.node === n.id);
    if (!touching.length || !touching.every((e) => e.badge && e.to.node === n.id && !e.to.row)) continue;
    n.folded = true;
    // The chip is all that is left of it, so it carries the detail: "data · 20Gi", "HPA ×2–10".
    const raw = src.nodes![n.id];
    const extra = raw && typeof raw === 'object' ? detailText(raw as K8sEntry) : [];
    if (kinds.get(n.id) === 'hpa') n.shape.label = ['HPA', ...extra].join(' ');
    else if (extra.length) n.shape.label = `${n.shape.label} · ${extra.join(' · ')}`;
  }
  return graph;
}

function schema(): object {
  const s = graphSchema('kubernetes', config, 'Cartography Kubernetes diagram') as { properties: Record<string, any> };
  // The object form of a node, wherever it sits among the short forms.
  const node = s.properties.nodes.additionalProperties.anyOf.find((x: { type?: string }) => x.type === 'object');
  node.properties = { ...node.properties, ...details };
  return s;
}

const palette: PaletteItem[] = [
  ...Object.entries(config.groupKinds).map(([kind, k]) => ({ collection: 'groups', kind, ...k })),
  ...Object.entries(config.nodeKinds).map(([kind, k]) => ({ collection: 'nodes', kind, ...k })),
];

/** Copy for the optional guidance fields on DiagramType, wired in by the coordinator. */
export const guidance = {
  tagline: 'Workloads, services and ingress per namespace, without the icon soup',
  useWhen: [
    'How traffic reaches workloads: ingress → service → deployment',
    'A namespace or whole platform (ingress, certs, observability)',
    'Manifests or helm/kustomize output, via carto import',
  ],
  notFor: [
    { text: 'Cloud resources around the cluster (VNets, managed DBs)', use: 'azure' },
    { text: 'Services and data flow regardless of where they run', use: 'systems' },
    { text: 'RBAC roles and who may do what', use: 'access' },
  ],
  keywords: ['kubernetes', 'k8s', 'helm', 'kustomize', 'manifests', 'deployment', 'ingress', 'namespace', 'cluster', 'pod', 'service mesh'],
};

export const kubernetes: DiagramType<GraphSource> = {
  id: 'kubernetes',
  name: 'Kubernetes',
  description: 'Clusters, namespaces and the workloads, services and ingress in them',
  icon: 'ship-wheel',
  ...guidance,
  schema: schema(),
  palette,
  build: buildKubernetes,
  references: graphReferences,
  connect(src, from, to) {
    if (from === to) return 'Pick another element to connect to';
    const known = (id: string) => (!!src.nodes && Object.hasOwn(src.nodes, id)) || (!!src.groups && Object.hasOwn(src.groups, id));
    if (!known(from) || !known(to)) return 'Connect one node or group to another';
    // The style follows from the kinds, so the short form is all it takes.
    return { path: ['edges'], value: `${from} -> ${to}` };
  },
  template: `type: kubernetes
title: Web shop
subtitle: Production cluster

groups:
  prod: { kind: cluster, label: prod-eu }
  shop: { kind: namespace, label: shop, in: prod }

nodes:
  users: users
  ingress: { kind: ingress, label: shop, in: shop, host: shop.example.com }
  web-svc: { kind: service, label: web, in: shop, ports: [80] }
  web: { kind: deployment, in: shop, replicas: 2, image: shop/web:2.3 }
  api-svc: { kind: service, label: api, in: shop, ports: ["80:8080"] }
  api: { kind: deployment, in: shop, replicas: 3, image: shop/api:1.4 }
  api-hpa: { kind: hpa, in: shop, replicas: 3-10 }
  api-config: { kind: configmap, in: shop }
  db-credentials: { kind: secret, in: shop }
  postgres: { kind: statefulset, in: shop, image: postgres:16 }
  pg-data: { kind: pvc, label: data, in: shop, size: 20Gi }

# Mounts, identity and scaling show as badges on the workload by default; list styles here to choose.
# badges: [mounts, identity, scales]

edges:
  - users -> ingress: HTTPS
  - ingress -> web-svc: /
  - ingress -> api-svc: /api
  - web-svc -> web
  - api-svc -> api
  - api -> postgres: SQL
  - api -> api-config
  - api -> db-credentials
  - api-hpa -> api
  - postgres -> db-credentials
  - postgres -> pg-data
`,
};
