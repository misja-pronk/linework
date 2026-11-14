// Software architecture in generic terms: people, clients, services, data stores and the systems
// around them, in nestable groups. The type to reach for first, and the target of imports.
//
//   groups:
//     shop: system
//     backend: { kind: zone, label: Private network, in: shop }
//   nodes:
//     web: { kind: client, label: Web shop, in: shop }
//     db: { kind: database, label: Orders, in: backend }
//   edges:
//     - web -> db: SQL
//     - api -> bus: { label: OrderPlaced, style: async }
//
// Process flows use step, decision, start and end: shapes that speak for themselves, so no caption.
import { buildGraph, graphReferences, graphSchema, type DiagramType, type GraphSource, type GraphTypeConfig, type PaletteItem } from '@linework/core';

export const config: GraphTypeConfig = {
  groupKinds: {
    group: { label: 'Group', icon: 'square-stack', tone: 'slate', quiet: true, keywords: ['subgraph'] },
    system: { label: 'System', icon: 'boxes', tone: 'blue' },
    boundary: { label: 'Boundary', icon: 'square-dashed', tone: 'slate', border: 'dashed' },
    zone: { label: 'Zone', icon: 'shield', tone: 'teal', border: 'dashed', keywords: ['network', 'dmz', 'vpc', 'subnet'] },
    'trust-boundary': { label: 'Trust boundary', icon: 'shield', tone: 'rose', border: 'dashed', keywords: ['threat model', 'security', 'internet'] },
    team: { label: 'Team', icon: 'users', tone: 'violet', border: 'dashed', keywords: ['owner'] },
    domain: { label: 'Domain', icon: 'layers', tone: 'indigo', border: 'dashed', keywords: ['bounded context', 'layer'] },
    cluster: { label: 'Cluster', icon: 'boxes', tone: 'sky', keywords: ['kubernetes', 'k8s'] },
    cloud: { label: 'Cloud', icon: 'cloud', tone: 'sky', keywords: ['aws', 'gcp', 'azure'] },
    region: { label: 'Region', icon: 'earth', tone: 'slate', border: 'dashed' },
    'on-premises': { label: 'On-premises', icon: 'building', tone: 'slate', keywords: ['datacenter'] },
  },
  nodeKinds: {
    user: { label: 'User', icon: 'user', tone: 'slate', keywords: ['person', 'actor'] },
    users: { label: 'Users', icon: 'users', tone: 'slate', keywords: ['people', 'customers'] },
    client: { label: 'Web app', icon: 'app-window', tone: 'sky', keywords: ['browser', 'frontend', 'spa'] },
    mobile: { label: 'Mobile app', icon: 'smartphone', tone: 'sky', keywords: ['ios', 'android'] },
    desktop: { label: 'Desktop app', icon: 'monitor', tone: 'sky' },
    device: { label: 'Device', icon: 'cpu', tone: 'sky', keywords: ['iot', 'sensor'] },
    service: { label: 'Service', icon: 'box', tone: 'blue', keywords: ['microservice', 'backend', 'app'] },
    api: { label: 'API', icon: 'webhook', tone: 'blue', keywords: ['rest', 'graphql', 'grpc'] },
    function: { label: 'Function', icon: 'square-function', tone: 'amber', keywords: ['lambda', 'serverless'] },
    worker: { label: 'Worker', icon: 'cog', tone: 'blue', keywords: ['consumer', 'background'] },
    job: { label: 'Scheduled job', icon: 'clock', tone: 'amber', keywords: ['cron', 'batch'] },
    container: { label: 'Container', icon: 'container', tone: 'blue', keywords: ['docker', 'pod'] },
    server: { label: 'Server', icon: 'server', tone: 'blue', keywords: ['vm', 'host'] },
    queue: { label: 'Queue', icon: 'send', tone: 'violet', keywords: ['sqs', 'rabbitmq', 'message'] },
    topic: { label: 'Event stream', icon: 'radio-tower', tone: 'violet', keywords: ['kafka', 'pubsub', 'event bus', 'topic'] },
    database: { label: 'Database', icon: 'database', tone: 'indigo', keywords: ['sql', 'postgres', 'mysql', 'db'] },
    cache: { label: 'Cache', icon: 'database-zap', tone: 'rose', keywords: ['redis', 'memcached'] },
    storage: { label: 'Object storage', icon: 'archive', tone: 'teal', keywords: ['bucket', 's3', 'blob', 'files'] },
    warehouse: { label: 'Data warehouse', icon: 'chart-bar', tone: 'indigo', keywords: ['analytics', 'lake', 'bigquery'] },
    search: { label: 'Search', icon: 'search', tone: 'violet', keywords: ['elasticsearch', 'index'] },
    gateway: { label: 'API gateway', icon: 'split', tone: 'sky', keywords: ['proxy', 'ingress'] },
    'load-balancer': { label: 'Load balancer', icon: 'scale', tone: 'sky', keywords: ['lb'] },
    cdn: { label: 'CDN', icon: 'globe', tone: 'sky', keywords: ['edge'] },
    dns: { label: 'DNS', icon: 'hash', tone: 'sky' },
    firewall: { label: 'Firewall', icon: 'shield', tone: 'rose', keywords: ['waf'] },
    identity: { label: 'Identity provider', icon: 'fingerprint-pattern', tone: 'amber', keywords: ['auth', 'sso', 'oauth', 'login'] },
    secrets: { label: 'Secrets', icon: 'key-round', tone: 'amber', keywords: ['vault', 'kms'] },
    monitoring: { label: 'Monitoring', icon: 'activity', tone: 'green', keywords: ['logs', 'metrics', 'observability'] },
    email: { label: 'Email', icon: 'mail', tone: 'slate', keywords: ['smtp', 'notification'] },
    ai: { label: 'AI model', icon: 'sparkles', tone: 'violet', keywords: ['llm', 'ml'] },
    payments: { label: 'Payments', icon: 'credit-card', tone: 'green', keywords: ['stripe', 'psp'] },
    external: { label: 'External system', icon: 'earth', tone: 'slate', keywords: ['third party', 'saas'] },
    step: { label: 'Step', icon: 'square', tone: 'slate', form: 'plain', keywords: ['process', 'action', 'task', 'flow'] },
    decision: { label: 'Decision', icon: 'circle-question-mark', tone: 'amber', form: 'decision', keywords: ['choice', 'condition', 'if', 'question', 'flow'] },
    start: { label: 'Start', icon: 'circle-play', tone: 'green', form: 'terminal', keywords: ['begin', 'trigger', 'flow'] },
    end: { label: 'End', icon: 'circle-stop', tone: 'slate', form: 'terminal', keywords: ['stop', 'finish', 'done', 'flow'] },
  },
  edgeStyles: {
    sync: { label: 'Request', line: 'solid', tone: 'blue' },
    async: { label: 'Async message', line: 'dashed', tone: 'amber' },
    // Violet, as in the azure and cloud types: data flow is one colour in every drawing.
    data: { label: 'Data flow', line: 'solid', tone: 'violet' },
    dotted: { label: 'Supporting', line: 'dotted', tone: 'slate' },
  },
  plainEdge: 'Connection',
  // Shared-model (C4) words for what this type already draws.
  trust: true,
  kindAliases: {
    person: 'user', actor: 'user', 'software-system': 'system', component: 'service', web: 'client', spa: 'client', db: 'database', bus: 'topic', 'event-stream': 'topic',
    // Azure Databricks kinds of a shared model (the azure type's), as the generic thing they are.
    databricks: 'system', 'control-plane': 'zone', 'compute-plane': 'zone', 'serverless-plane': 'cloud',
    metastore: 'warehouse', catalog: 'database', schema: 'database', table: 'database', volume: 'storage', 'registered-model': 'ai',
    compute: 'server', serverless: 'function', 'sql-warehouse': 'warehouse',
    'lakeflow-connect': 'worker', 'lakeflow-pipeline': 'worker', 'lakeflow-job': 'job',
    'storage-credential': 'secrets', 'external-location': 'storage', 'access-connector': 'identity',
    'model-serving': 'ai', 'databricks-app': 'client', share: 'storage', recipient: 'external',
    ncc: 'gateway', 'network-policy': 'firewall',
    // and the Azure pieces around it.
    fabric: 'warehouse', subscription: 'boundary', 'resource-group': 'group', vnet: 'zone', subnet: 'zone', 'private-endpoint': 'gateway', nsg: 'firewall', 'route-table': 'firewall',
  },
};

const palette: PaletteItem[] = [
  ...Object.entries(config.groupKinds).map(([kind, k]) => ({ collection: 'groups', kind, ...k })),
  ...Object.entries(config.nodeKinds).map(([kind, k]) => ({ collection: 'nodes', kind, ...k })),
];

export const systems: DiagramType<GraphSource> = {
  id: 'systems',
  name: 'Architecture',
  description: 'Services, clients, data stores and external systems in nestable groups',
  icon: 'layers',
  tagline: 'Boxes and arrows: the parts of a system and how they talk',
  useWhen: [
    'The default when unsure: services, apps, queues, databases',
    'How a request or an order flows through the system',
    'A cloud-neutral overview for a design doc or onboarding',
  ],
  notFor: [
    { text: 'What runs where in Azure', use: 'azure' },
    { text: 'What runs where in AWS or Google Cloud', use: 'cloud' },
    { text: 'Tables and their columns', use: 'erd' },
    { text: 'Who may access what', use: 'access' },
    { text: 'Steps in order, with decisions and who does them', use: 'process' },
    { text: 'C4 context, container and component views', use: 'c4' },
  ],
  keywords: ['architecture', 'system', 'service', 'microservice', 'api', 'component', 'flow', 'overview', 'queue', 'event', 'frontend', 'backend', 'integration', 'boxes and arrows'],
  schema: graphSchema('systems', config, 'Linework architecture diagram'),
  palette,
  build: (src, ctx) => buildGraph(src, config, ctx),
  references: graphReferences,
  connect(src, from, to) {
    if (from === to) return 'Pick another element to connect to';
    const known = (id: string) => (!!src.nodes && Object.hasOwn(src.nodes, id)) || (!!src.groups && Object.hasOwn(src.groups, id));
    if (!known(from) || !known(to)) return 'Connect one node or group to another';
    return { path: ['edges'], value: `${from} -> ${to}` };
  },
  template: `type: systems
title: Web shop
subtitle: How an order flows through the system

groups:
  shop: { kind: system, label: Web shop }
  backend: { kind: zone, label: Private network, in: shop }

nodes:
  customers: users
  web: { kind: client, label: Storefront, in: shop }
  gateway: { kind: gateway, label: API gateway, in: shop }
  orders: { kind: service, label: Orders, in: backend }
  db: { kind: database, label: Orders DB, in: backend }
  bus: { kind: queue, label: order-events, in: backend }
  mailer: { kind: worker, label: Mailer, in: backend }
  stripe: { kind: payments, label: Stripe }

edges:
  - customers -> web: HTTPS
  - web -> gateway: { label: REST, style: sync }
  - gateway -> orders: { style: sync }
  - orders -> db: { label: SQL, style: data }
  - orders -> bus: { label: OrderPlaced, style: async }
  - bus -> mailer: { style: async }
  - orders -> stripe: { label: charge, style: sync }
`,
};

export { c4, c4Config } from './c4.ts';
export { contextMap, contextMapConfig } from './context-map.ts';
