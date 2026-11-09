import { buildGraph, graphReferences, graphSchema, type DiagramType, type GraphSource, type GraphTypeConfig, type PaletteItem } from '@cartography/core';

// Generic line icons in one style; no Microsoft icons, their terms forbid redistributing them.
export const config: GraphTypeConfig = {
  groupKinds: {
    tenant: { label: 'Entra tenant', icon: 'building-complex', tone: 'slate' },
    'management-group': { label: 'Management group', icon: 'layers', tone: 'slate' },
    subscription: { label: 'Subscription', icon: 'folder-key', tone: 'amber' },
    'resource-group': { label: 'Resource group', icon: 'boxes', tone: 'slate' },
    region: { label: 'Region', icon: 'earth', tone: 'slate', border: 'dashed' },
    vnet: { label: 'Virtual network', icon: 'waypoints', tone: 'sky' },
    subnet: { label: 'Subnet', icon: 'square-dashed', tone: 'sky', border: 'dashed' },
    'aks-cluster': { label: 'AKS cluster', icon: 'boxes', tone: 'blue' },
    'on-premises': { label: 'On-premises', icon: 'building', tone: 'slate' },
    boundary: { label: 'Boundary', icon: 'square-dashed', tone: 'slate', border: 'dashed' },
  },
  nodeKinds: {
    'app-service': { label: 'App Service', icon: 'app-window', tone: 'blue', keywords: ['web', 'webapp'] },
    'function-app': { label: 'Function App', icon: 'zap', tone: 'amber', keywords: ['serverless'] },
    'container-app': { label: 'Container App', icon: 'container', tone: 'blue' },
    aks: { label: 'AKS', icon: 'boxes', tone: 'blue', keywords: ['kubernetes'] },
    vm: { label: 'Virtual machine', icon: 'server', tone: 'blue' },
    vmss: { label: 'VM scale set', icon: 'server-cog', tone: 'blue' },
    'static-web-app': { label: 'Static Web App', icon: 'file-code', tone: 'blue' },
    'container-registry': { label: 'Container Registry', icon: 'package', tone: 'blue', keywords: ['acr'] },
    'sql-database': { label: 'SQL Database', icon: 'database', tone: 'indigo' },
    'sql-server': { label: 'SQL Server', icon: 'server', tone: 'indigo' },
    postgres: { label: 'PostgreSQL', icon: 'database', tone: 'indigo' },
    'cosmos-db': { label: 'Cosmos DB', icon: 'orbit', tone: 'indigo' },
    storage: { label: 'Storage account', icon: 'archive', tone: 'teal', keywords: ['blob'] },
    redis: { label: 'Cache for Redis', icon: 'database-zap', tone: 'rose' },
    'key-vault': { label: 'Key Vault', icon: 'key-round', tone: 'amber', keywords: ['secrets'] },
    'service-bus': { label: 'Service Bus', icon: 'send', tone: 'violet', keywords: ['queue'] },
    'event-hub': { label: 'Event Hubs', icon: 'radio-tower', tone: 'violet' },
    'event-grid': { label: 'Event Grid', icon: 'workflow', tone: 'violet' },
    'api-management': { label: 'API Management', icon: 'webhook', tone: 'violet', keywords: ['apim'] },
    'logic-app': { label: 'Logic App', icon: 'workflow', tone: 'teal' },
    'data-factory': { label: 'Data Factory', icon: 'workflow', tone: 'teal' },
    openai: { label: 'Azure OpenAI', icon: 'sparkles', tone: 'violet', keywords: ['ai'] },
    'ai-search': { label: 'AI Search', icon: 'search', tone: 'violet' },
    'front-door': { label: 'Front Door', icon: 'globe', tone: 'sky', keywords: ['cdn', 'waf'] },
    'app-gateway': { label: 'Application Gateway', icon: 'split', tone: 'sky' },
    'load-balancer': { label: 'Load Balancer', icon: 'scale', tone: 'sky' },
    'vpn-gateway': { label: 'VPN Gateway', icon: 'lock', tone: 'sky' },
    'private-endpoint': { label: 'Private endpoint', icon: 'plug-zap', tone: 'sky' },
    dns: { label: 'DNS zone', icon: 'hash', tone: 'sky' },
    firewall: { label: 'Firewall', icon: 'shield', tone: 'rose' },
    nsg: { label: 'Network security group', icon: 'shield-check', tone: 'rose' },
    'entra-id': { label: 'Entra ID', icon: 'fingerprint-pattern', tone: 'slate', keywords: ['aad', 'identity'] },
    'managed-identity': { label: 'Managed identity', icon: 'id-card', tone: 'slate' },
    'log-analytics': { label: 'Log Analytics', icon: 'chart-line', tone: 'green' },
    'app-insights': { label: 'Application Insights', icon: 'activity', tone: 'green' },
    monitor: { label: 'Azure Monitor', icon: 'gauge', tone: 'green' },
    user: { label: 'User', icon: 'user', tone: 'slate' },
    users: { label: 'Users', icon: 'users', tone: 'slate' },
    internet: { label: 'Internet', icon: 'cloud', tone: 'slate' },
    external: { label: 'External system', icon: 'earth', tone: 'slate' },
    service: { label: 'Service', icon: 'box', tone: 'slate' },
  },
  edgeStyles: {
    public: { label: 'Public traffic', line: 'solid', tone: 'sky' },
    private: { label: 'Private network', line: 'dashed', tone: 'teal' },
    data: { label: 'Data flow', line: 'solid', tone: 'violet' },
    identity: { label: 'Identity', line: 'dotted', tone: 'amber' },
    management: { label: 'Management', line: 'dotted', tone: 'slate' },
  },
  // Shared-model kinds (the architecture type's words) as the Azure resource that usually hosts them.
  kindAliases: {
    person: 'user',
    client: 'static-web-app',
    api: 'app-service',
    worker: 'container-app',
    container: 'container-app',
    function: 'function-app',
    job: 'function-app',
    server: 'vm',
    database: 'sql-database',
    cache: 'redis',
    storage: 'storage',
    queue: 'service-bus',
    topic: 'event-hub',
    secrets: 'key-vault',
    identity: 'entra-id',
    monitoring: 'app-insights',
    gateway: 'api-management',
    cdn: 'front-door',
    search: 'ai-search',
    ai: 'openai',
    system: 'boundary',
  },
};

const palette: PaletteItem[] = [
  ...Object.entries(config.groupKinds).map(([kind, k]) => ({ collection: 'groups', kind, ...k })),
  ...Object.entries(config.nodeKinds).map(([kind, k]) => ({ collection: 'nodes', kind, ...k })),
];

export const azure: DiagramType<GraphSource> = {
  id: 'azure',
  name: 'Azure infrastructure',
  description: 'Subscriptions, resource groups, networks and the resources in them',
  icon: 'cloud',
  tagline: 'What runs where in Azure: subscriptions, resource groups, networks',
  useWhen: [
    'Map the resources in an Azure subscription',
    'Show which VNet or subnet each service sits in',
    'Hub and spoke, private endpoints, Front Door, firewalls',
  ],
  notFor: [
    { text: 'A cloud-neutral system overview', use: 'systems' },
    { text: 'Entra groups, roles and access packages', use: 'access' },
  ],
  keywords: [
    'azure', 'subscription', 'resource group', 'vnet', 'subnet', 'private endpoint', 'hub spoke', 'landing zone', 'app service', 'key vault',
    'front door', 'aks', 'cloud', 'infrastructure', 'network', 'firewall', 'deployment', 'iac', 'bicep', 'terraform',
  ],
  schema: graphSchema('azure', config, 'Cartography Azure diagram'),
  palette,
  build: (src, ctx) => buildGraph(src, config, ctx),
  references: graphReferences,
  template: `type: azure
title: Web shop
subtitle: Production

groups:
  prod: { kind: subscription, label: Production }
  rg: { kind: resource-group, label: rg-shop-prod, in: prod }
  vnet: { kind: vnet, label: vnet-shop, in: rg }
  apps: { kind: subnet, label: snet-apps, in: vnet }
  data: { kind: subnet, label: snet-data, in: vnet }

nodes:
  users: users
  edge: { kind: front-door, label: Front Door }
  web: { kind: app-service, label: Web shop, in: apps }
  api: { kind: container-app, label: Orders API, in: apps }
  db: { kind: sql-database, label: Orders, in: data }
  vault: { kind: key-vault, label: Secrets, in: rg }

# Styles shown as a badge on the card instead of a line
badges: [identity]

edges:
  - users -> edge: { label: HTTPS, style: public }
  - edge -> web: { style: public }
  - web -> api: { label: REST, style: private }
  - api -> db: { label: SQL, style: private }
  - api -> vault: { label: secrets, style: identity }
`,
};
