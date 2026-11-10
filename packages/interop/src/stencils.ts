// What a draw.io shape is, read from its style: the stencil library says which diagram type fits
// (Azure, AWS, Google Cloud, Kubernetes, network gear) and the stencil's name which kind.
import { config as azure } from '@cartography/azure';
import { config as cloud } from '@cartography/cloud';
import { config as kubernetes } from '@cartography/kubernetes';
import { config as network } from '@cartography/network';
import { knownKind } from './imported.ts';

export type Family = 'azure' | 'aws' | 'gcp' | 'kubernetes' | 'network';

export interface Stencil {
  family?: Family;
  /** A node kind of the family's type, or a systems kind when there is no family. */
  kind?: string;
  /** A group kind, when the shape is a container of that library. */
  group?: string;
  /** The stencil's own name, for the report and for guessing by words. */
  name?: string;
}

// Names the libraries use that are not the kind's own id or label.
const AZURE: Record<string, string> = {
  'web-app': 'app-service', website: 'app-service', 'azure-website': 'app-service', 'website-generic': 'app-service', 'app-service-plan': 'app-service',
  function: 'function-app', functions: 'function-app', 'azure-function': 'function-app',
  'kubernetes-service': 'aks', 'azure-kubernetes-service': 'aks',
  'virtual-machine': 'vm', 'vm-scale-set': 'vmss', 'virtual-machine-scale-set': 'vmss',
  'static-app': 'static-web-app', 'container-registrie': 'container-registry',
  'azure-sql-database': 'sql-database', 'sql-databases': 'sql-database', 'azure-sql': 'sql-database',
  'azure-database-postgresql-server': 'postgres', 'database-postgresql-server': 'postgres', postgresql: 'postgres',
  'azure-cosmos-db': 'cosmos-db', 'storage-account': 'storage', 'blob-storage': 'storage', 'storage-blob': 'storage', 'azure-storage': 'storage',
  'cache-redi': 'redis', 'cache-redis': 'redis', 'azure-cache-redis': 'redis', 'azure-cache-for-redis': 'redis', 'redis-cache': 'redis',
  'key-vaults': 'key-vault', 'azure-key-vault': 'key-vault',
  'event-grid-topic': 'event-grid', 'event-grid-domain': 'event-grid',
  'api-management-service': 'api-management', 'data-factorie': 'data-factory',
  'azure-openai': 'openai', 'cognitive-service': 'openai', 'search-service': 'ai-search', 'cognitive-search': 'ai-search',
  'application-gateway': 'app-gateway', 'virtual-network-gateway': 'vpn-gateway',
  'dns-zone': 'dns', 'azure-firewall': 'firewall', 'network-security-group': 'nsg',
  'azure-active-directory': 'entra-id', 'active-directory': 'entra-id', 'entra-id': 'entra-id',
  'managed-identitie': 'managed-identity', 'log-analytics-workspace': 'log-analytics', 'application-insight': 'app-insights',
  'azure-load-balancer': 'load-balancer', laptop: 'user', computer: 'user',
};
const AZURE_GROUPS: Record<string, string> = {
  'virtual-network': 'vnet', vnet: 'vnet', subnet: 'subnet', 'resource-group': 'resource-group', subscription: 'subscription', 'management-group': 'management-group', tenant: 'tenant',
};
const AWS: Record<string, string> = {
  'lambda-function': 'lambda', instance: 'ec2', instance2: 'ec2', instances: 'ec2', 'ec2-instance': 'ec2',
  bucket: 's3', 'simple-storage-service': 's3', 's3-bucket': 's3', 'bucket-with-objects': 's3',
  'rds-instance': 'rds', 'dynamo-db': 'dynamodb', table: 'dynamodb', 'elasticsearch-service': 'opensearch', 'opensearch-service': 'opensearch',
  'application-load-balancer': 'alb', 'elastic-load-balancing': 'alb', 'network-load-balancer': 'nlb',
  'route-53': 'route53', 'simple-queue-service': 'sqs', queue: 'sqs', 'simple-notification-service': 'sns', topic: 'sns',
  fargate: 'ecs', 'elastic-container-service': 'ecs', 'elastic-kubernetes-service': 'eks', 'elastic-container-registry': 'ecr',
  'kinesis-data-streams': 'kinesis', 'kinesis-data-firehose': 'firehose', role: 'iam-role', 'identity-and-access-management': 'iam',
  'key-management-service': 'kms', 'cloudwatch-2': 'cloudwatch', 'vpn-gateway': 'vpn', 'vpn-connection': 'vpn', endpoint: 'vpc-endpoint', endpoints: 'vpc-endpoint',
  'traditional-server': 'server', 'generic-database': 'datastore', 'internet-alt1': 'internet', 'internet-alt2': 'internet', 'mobile-client': 'client',
  'certificate-manager': 'acm', 'managed-streaming-for-kafka': 'msk', 'elastic-block-store': 'ebs', 'elastic-file-system': 'efs',
};
const AWS_GROUPS: Record<string, string> = {
  'group-aws-cloud': 'aws', 'group-aws-cloud-alt': 'aws', 'group-region': 'region', 'group-vpc': 'vpc', 'group-vpc2': 'vpc', 'group-availability-zone': 'zone',
  'group-security-group': 'security-group', 'group-subnet': 'subnet', 'group-public-subnet': 'subnet', 'group-private-subnet': 'subnet',
  'group-auto-scaling-group': 'auto-scaling-group', 'group-account': 'account', 'group-on-premise': 'on-premises', 'group-corporate-data-center': 'on-premises',
};
const GCP: Record<string, string> = {
  'cloud-storage': 'gcs', 'cloud-pubsub': 'pubsub', 'kubernetes-engine': 'gke', 'container-engine': 'gke', 'cloud-load-balancing': 'cloud-load-balancing',
  'cloud-functions': 'cloud-functions', 'cloud-iam': 'cloud-iam', 'cloud-datastore': 'firestore', 'cloud-spanner': 'spanner', 'cloud-bigtable': 'bigtable',
  'cloud-dataflow': 'dataflow', 'cloud-dataproc': 'dataproc', 'cloud-memorystore': 'memorystore', 'cloud-composer': 'composer',
};
const K8S: Record<string, string> = {
  svc: 'service', deploy: 'deployment', sts: 'statefulset', ds: 'daemonset', ing: 'ingress', cm: 'configmap', pv: 'pvc', vol: 'pvc', sc: 'storageclass',
  sa: 'serviceaccount', netpol: 'networkpolicy', rs: 'deployment', 'c-role': 'serviceaccount', role: 'serviceaccount', master: 'pod', node: 'pod',
};
const K8S_GROUPS: Record<string, string> = { ns: 'namespace', namespace: 'namespace', cluster: 'cluster' };
const NETWORK: Record<string, string> = {
  'layer-3-switch': 'l3-switch', 'multilayer-switch': 'l3-switch', 'workgroup-switch': 'switch', 'wireless-hub': 'access-point', 'wireless-modem': 'access-point',
  'wireless-router': 'access-point', pc: 'client', laptop: 'client', desktop: 'client', 'desktop-pc': 'client', terminal: 'client', tablet: 'client',
  mobile: 'phone', 'ip-phone': 'phone', 'nas-filer': 'nas', 'external-storage': 'storage', 'security-camera': 'camera', 'video-camera': 'camera',
  modem: 'isp', 'proxy-server': 'proxy', 'server-storage': 'storage', 'web-server': 'server', 'mail-server': 'server', 'virus': 'ids',
  'copier': 'printer', 'user-male': 'users', 'user-female': 'users', 'community': 'users', bus: 'switch', hub: 'switch', 'comm-link': 'isp', 'biometric-reader': 'ids',
};

const norm = (s: string) => s.replace(/\.svg$/i, '').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** A kind from a stencil name: as it is, without its vendor prefix, in the singular, or by the table. */
function pick(name: string, kinds: Record<string, { label: string }>, aliases: Record<string, string> | undefined, extra: Record<string, string>): string | undefined {
  const bare = name.replace(/^(azure|amazon|aws|google|cloud|gcp)-(?=.)/, '');
  for (const n of [name, bare, name.replace(/s$/, ''), bare.replace(/s$/, '')]) {
    const hit = extra[n] && kinds[extra[n]!] ? extra[n] : knownKind(kinds, aliases, n);
    if (hit) return hit;
  }
  return undefined;
}

// Plain draw.io shapes that say what a box is, as systems kinds.
const SHAPES: [RegExp, string][] = [
  [/^(cylinder3?|datastore|mxgraph\.flowchart\.database|mxgraph\.flowchart\.stored_data)$/, 'database'],
  [/^(umlactor|actor|mxgraph\.basic\.person|mxgraph\.bpmn\.user_task)$/, 'user'],
  [/^(cloud|mxgraph\.networks\.cloud)$/, 'external'],
  [/^(mxgraph\.flowchart\.decision)$/, 'decision'],
  [/^(document|mxgraph\.flowchart\.document|note)$/, 'storage'],
  [/^(mxgraph\.flowchart\.start_[12]|mxgraph\.flowchart\.terminator)$/, 'start'],
  [/^(mxgraph\.flowchart\.delay|mxgraph\.lean_mapping\.fifo_lane|mxgraph\.eip\.messagechannel)$/, 'queue'],
];

/** What the style of a draw.io cell says the shape is. */
export function readStencil(style: Record<string, string>): Stencil {
  const shape = (style.shape ?? '').toLowerCase();
  const image = style.image ?? '';
  // The icon named inside a generic holder shape counts before the holder.
  const inner = (style.resIcon ?? style.grIcon ?? style.prIcon ?? '').toLowerCase();
  const last = (s: string) => norm(s.slice(s.lastIndexOf('.') + 1));
  const file = norm(image.slice(image.lastIndexOf('/') + 1));

  if (shape.startsWith('mxgraph.aws') || /\/aws\d?\//.test(image)) {
    const name = inner ? last(inner) : shape ? last(shape) : file;
    const group = AWS_GROUPS[name] ?? (shape.includes('.group') ? 'boundary' : undefined);
    return { family: 'aws', name, ...(group ? { group } : { kind: pick(name, cloud.nodeKinds, cloud.kindAliases, AWS) }) };
  }
  if (shape.startsWith('mxgraph.azure') || shape.startsWith('mxgraph.mscae') || /\/(azure2?|mscae)\//.test(image)) {
    const name = shape ? last(shape) : file;
    const group = AZURE_GROUPS[name] ?? AZURE_GROUPS[name.replace(/s$/, '')];
    return { family: 'azure', name, ...(group ? { group } : { kind: pick(name, azure.nodeKinds, azure.kindAliases, AZURE) }) };
  }
  if (shape.startsWith('mxgraph.gcp') || /\/(gcp2?|google)\//.test(image)) {
    const name = inner ? last(inner) : shape ? last(shape) : file;
    return { family: 'gcp', name, kind: pick(name, cloud.nodeKinds, cloud.kindAliases, GCP) };
  }
  if (shape.startsWith('mxgraph.kubernetes') || /\/kubernetes\//.test(image)) {
    const name = inner ? norm(inner) : shape.endsWith('icon') || shape.endsWith('icon2') ? '' : last(shape) || file;
    const group = K8S_GROUPS[name];
    return { family: 'kubernetes', name, ...(group ? { group } : { kind: pick(name, kubernetes.nodeKinds, undefined, K8S) }) };
  }
  if (/^mxgraph\.(cisco|cisco19|cisco_safe|networks|rack|citrix)/.test(shape) || /\/(cisco|networks)\//.test(image)) {
    const name = shape ? last(shape) : file;
    const words = name.split('-');
    const kind = pick(name, network.nodeKinds, network.kindAliases, NETWORK) ?? words.map((w) => pick(w, network.nodeKinds, network.kindAliases, NETWORK)).find(Boolean);
    return { family: 'network', name, kind };
  }
  for (const [re, kind] of SHAPES) if (re.test(shape)) return { kind, name: shape };
  if ('rhombus' in style) return { kind: 'decision', name: 'rhombus' };
  if (file) return { name: file };
  return shape ? { name: last(shape) } : {};
}

/** The diagram type that fits the stencils seen on a page. */
export function typeFor(families: Map<Family, number>): { type: string; provider?: string } {
  const n = (f: Family) => families.get(f) ?? 0;
  const clouds = n('aws') + n('gcp');
  if (clouds > 0) {
    // One provider's icons: that provider; several, Azure among them: a multi-cloud drawing.
    const provider = n('azure') > Math.max(n('aws'), n('gcp')) ? 'azure' : n('aws') >= n('gcp') ? 'aws' : 'gcp';
    return { type: 'cloud', provider };
  }
  if (n('azure') > 0) return { type: 'azure' };
  if (n('kubernetes') > 0) return { type: 'kubernetes' };
  if (n('network') > 0) return { type: 'network' };
  return { type: 'systems' };
}
