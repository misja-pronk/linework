// Writes the fixtures in this folder: an invented company ("Kestrel Logistics") as Azure Resource
// Graph, `az bicep build` and `terraform show -json` would save it. Nothing here comes from a real
// tenant: every GUID is a hash of a name, every host name is made up.
//
//   node examples/azure/import/make-fixtures.mjs
//
//   webapp/graph       a small web app as az graph query output (resources and resourcecontainers)
//   webapp/bicep       the same app as az bicep build output, with a network module
//   webapp/terraform   the same app as terraform show -json: a state, and a plan that changes it
//   landing-zone       a hub-and-spoke landing zone, about 150 resources in 3 subscriptions
//   landing-zone-later the same a week on: one storage account more
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const guid = (name) => createHash('sha1').update(`kestrel-azure:${name}`).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');
const save = (folder, file, data) => {
  mkdirSync(join(here, folder), { recursive: true });
  writeFileSync(join(here, folder, file), JSON.stringify(data, null, 2) + '\n');
};
const TENANT = guid('tenant');
const LOCATION = 'westeurope';

// ---------------------------------------------------------------- Resource Graph rows

/** Provider/type in Azure's own capitals, for ids. */
const PROVIDER = {
  'microsoft.network': 'Microsoft.Network',
  'microsoft.web': 'Microsoft.Web',
  'microsoft.sql': 'Microsoft.Sql',
  'microsoft.storage': 'Microsoft.Storage',
  'microsoft.keyvault': 'Microsoft.KeyVault',
  'microsoft.compute': 'Microsoft.Compute',
  'microsoft.cdn': 'Microsoft.Cdn',
  'microsoft.insights': 'Microsoft.Insights',
  'microsoft.operationalinsights': 'Microsoft.OperationalInsights',
  'microsoft.containerservice': 'Microsoft.ContainerService',
  'microsoft.containerregistry': 'Microsoft.ContainerRegistry',
  'microsoft.cache': 'Microsoft.Cache',
  'microsoft.servicebus': 'Microsoft.ServiceBus',
  'microsoft.eventhub': 'Microsoft.EventHub',
  'microsoft.documentdb': 'Microsoft.DocumentDB',
  'microsoft.datafactory': 'Microsoft.DataFactory',
  'microsoft.databricks': 'Microsoft.Databricks',
  'microsoft.cognitiveservices': 'Microsoft.CognitiveServices',
  'microsoft.search': 'Microsoft.Search',
  'microsoft.dbforpostgresql': 'Microsoft.DBforPostgreSQL',
  'microsoft.automation': 'Microsoft.Automation',
  'microsoft.recoveryservices': 'Microsoft.RecoveryServices',
  'microsoft.managedidentity': 'Microsoft.ManagedIdentity',
};
const TYPE_WORDS = {
  virtualnetworks: 'virtualNetworks', subnets: 'subnets', networksecuritygroups: 'networkSecurityGroups', routetables: 'routeTables', networkinterfaces: 'networkInterfaces',
  publicipaddresses: 'publicIPAddresses', privateendpoints: 'privateEndpoints', privatednszones: 'privateDnsZones', virtualnetworklinks: 'virtualNetworkLinks', applicationgateways: 'applicationGateways',
  azurefirewalls: 'azureFirewalls', firewallpolicies: 'firewallPolicies', bastionhosts: 'bastionHosts', virtualnetworkgateways: 'virtualNetworkGateways', localnetworkgateways: 'localNetworkGateways',
  connections: 'connections', dnsresolvers: 'dnsResolvers', networkwatchers: 'networkWatchers', sites: 'sites', serverfarms: 'serverfarms', servers: 'servers', databases: 'databases',
  storageaccounts: 'storageAccounts', vaults: 'vaults', virtualmachines: 'virtualMachines', disks: 'disks', profiles: 'profiles', origingroups: 'originGroups', origins: 'origins',
  afdendpoints: 'afdEndpoints', components: 'components', workspaces: 'workspaces', managedclusters: 'managedClusters', registries: 'registries', redis: 'Redis', namespaces: 'namespaces',
  databaseaccounts: 'databaseAccounts', factories: 'factories', accounts: 'accounts', searchservices: 'searchServices', flexibleservers: 'flexibleServers', automationaccounts: 'automationAccounts',
  userassignedidentities: 'userAssignedIdentities', diagnosticsettings: 'diagnosticSettings',
};
const sub = (name) => guid(`sub ${name}`);
const rgId = (s, rg) => `/subscriptions/${sub(s)}/resourceGroups/${rg}`;
/** /subscriptions/…/resourceGroups/…/providers/Microsoft.Network/virtualNetworks/vnet/subnets/snet */
function rid(s, rg, type, ...names) {
  const [ns, ...types] = type.split('/');
  return `${rgId(s, rg)}/providers/${PROVIDER[ns]}/${types.map((t, i) => `${TYPE_WORDS[t] ?? t}/${names[i]}`).join('/')}`;
}

class Graph {
  rows = [];
  containers = [];
  constructor(mgs) {
    for (const [name, display, parent] of mgs)
      this.containers.push({ id: `/providers/Microsoft.Management/managementGroups/${name}`, name, type: 'microsoft.management/managementgroups', tenantId: TENANT, properties: { displayName: display, details: { parent: parent ? { id: `/providers/Microsoft.Management/managementGroups/${parent}`, name: parent } : null } } });
  }
  subscription(name, chain) {
    this.containers.push({ id: `/subscriptions/${sub(name)}`, name, type: 'microsoft.resources/subscriptions', subscriptionId: sub(name), tenantId: TENANT, properties: { state: 'Enabled', managementGroupAncestorsChain: chain.map(([n, d]) => ({ name: n, displayName: d })) } });
    return name;
  }
  group(s, rg) {
    this.containers.push({ id: rgId(s, rg), name: rg, type: 'microsoft.resources/subscriptions/resourcegroups', resourceGroup: rg, subscriptionId: sub(s), tenantId: TENANT, location: LOCATION, properties: { provisioningState: 'Succeeded' } });
  }
  add(s, rg, type, name, properties = {}, more = {}) {
    const id = rid(s, rg, type, ...name.split('/'));
    this.rows.push({ id, name: name.split('/').pop(), type, tenantId: TENANT, kind: '', location: LOCATION, resourceGroup: rg, subscriptionId: sub(s), managedBy: '', sku: null, plan: null, properties: { provisioningState: 'Succeeded', ...properties }, tags: {}, identity: null, zones: null, extendedLocation: null, ...more });
    return id;
  }
  /** A network with its subnets inside, the way Resource Graph returns it. */
  vnet(s, rg, name, space, subnets, peers = []) {
    const vnetId = rid(s, rg, 'microsoft.network/virtualnetworks', name);
    const snets = subnets.map(([n, prefix, extra = {}]) => ({ id: `${vnetId}/subnets/${n}`, name: n, type: 'Microsoft.Network/virtualNetworks/subnets', properties: { provisioningState: 'Succeeded', addressPrefix: prefix, privateEndpointNetworkPolicies: 'Disabled', ...extra } }));
    this.add(s, rg, 'microsoft.network/virtualnetworks', name, {
      addressSpace: { addressPrefixes: [space] },
      subnets: snets,
      virtualNetworkPeerings: peers.map((remote) => ({ id: `${vnetId}/virtualNetworkPeerings/peer-${remote.split('/').pop()}`, name: `peer-${remote.split('/').pop()}`, properties: { peeringState: 'Connected', remoteVirtualNetwork: { id: remote }, allowForwardedTraffic: true } })),
      enableDdosProtection: false,
    });
    return Object.fromEntries(snets.map((x) => [x.name, x.id]));
  }
  nic(s, rg, name, subnet, ip, more = {}) {
    return this.add(s, rg, 'microsoft.network/networkinterfaces', name, { ipConfigurations: [{ id: `${rid(s, rg, 'microsoft.network/networkinterfaces', name)}/ipConfigurations/ipconfig1`, name: 'ipconfig1', properties: { privateIPAddress: ip, privateIPAllocationMethod: 'Dynamic', subnet: { id: subnet }, ...(more.pool ? { loadBalancerBackendAddressPools: [{ id: more.pool }] } : {}) } }], ...(more.vm ? { virtualMachine: { id: more.vm } } : {}), ...(more.pe ? { privateEndpoint: { id: more.pe } } : {}) });
  }
  vm(s, rg, name, subnet, ip, size = 'Standard_D2s_v5') {
    const vmId = rid(s, rg, 'microsoft.compute/virtualmachines', name);
    const nicId = this.nic(s, rg, `nic-${name}`, subnet, ip, { vm: vmId });
    this.add(s, rg, 'microsoft.compute/virtualmachines', name, { hardwareProfile: { vmSize: size }, networkProfile: { networkInterfaces: [{ id: nicId }] }, storageProfile: { osDisk: { name: `osdisk-${name}`, managedDisk: { id: rid(s, rg, 'microsoft.compute/disks', `osdisk-${name}`) } } } });
    this.add(s, rg, 'microsoft.compute/disks', `osdisk-${name}`, { diskSizeGB: 128 }, { managedBy: vmId, sku: { name: 'Premium_LRS', tier: 'Premium' } });
    return vmId;
  }
  pe(s, rg, name, subnet, target, group, ip) {
    const peId = rid(s, rg, 'microsoft.network/privateendpoints', name);
    const nicId = this.nic(s, rg, `${name}.nic`, subnet, ip, { pe: peId });
    this.add(s, rg, 'microsoft.network/privateendpoints', name, { subnet: { id: subnet }, networkInterfaces: [{ id: nicId }], privateLinkServiceConnections: [{ id: `${peId}/privateLinkServiceConnections/${name}`, name, properties: { privateLinkServiceId: target, groupIds: [group], privateLinkServiceConnectionState: { status: 'Approved' } } }] });
    return peId;
  }
  pip(s, rg, name, ip, fqdn) {
    return this.add(s, rg, 'microsoft.network/publicipaddresses', name, { ipAddress: ip, publicIPAllocationMethod: 'Static', ...(fqdn ? { dnsSettings: { domainNameLabel: fqdn.split('.')[0], fqdn } } : {}) }, { sku: { name: 'Standard', tier: 'Regional' } });
  }
  nsg(s, rg, name) {
    return this.add(s, rg, 'microsoft.network/networksecuritygroups', name, { securityRules: [{ name: 'deny-internet-inbound', properties: { access: 'Deny', direction: 'Inbound', priority: 4000, protocol: '*', sourceAddressPrefix: 'Internet', destinationAddressPrefix: '*', sourcePortRange: '*', destinationPortRange: '*' } }] });
  }
  routeTable(s, rg, name, hop) {
    return this.add(s, rg, 'microsoft.network/routetables', name, { disableBgpRoutePropagation: true, routes: [{ name: 'default-via-firewall', properties: { addressPrefix: '0.0.0.0/0', nextHopType: 'VirtualAppliance', nextHopIpAddress: hop } }] });
  }
  web(s, rg, name, plan, subnet, kind = 'app,linux') {
    return this.add(s, rg, 'microsoft.web/sites', name, { serverFarmId: plan, defaultHostName: `${name}.azurewebsites.net`, hostNames: [`${name}.azurewebsites.net`], httpsOnly: true, virtualNetworkSubnetId: subnet, publicNetworkAccess: 'Disabled', keyVaultReferenceIdentity: 'SystemAssigned', siteConfig: null }, { kind, identity: { type: 'SystemAssigned', principalId: guid(`mi ${name}`), tenantId: TENANT } });
  }
  plan(s, rg, name, sku = 'P1v3') {
    return this.add(s, rg, 'microsoft.web/serverfarms', name, { reserved: true, numberOfWorkers: 2 }, { kind: 'linux', sku: { name: sku, tier: 'PremiumV3', size: sku, capacity: 2 } });
  }
  storage(s, rg, name, sku = 'Standard_ZRS', more = {}) {
    return this.add(s, rg, 'microsoft.storage/storageaccounts', name, { primaryEndpoints: { blob: `https://${name}.blob.core.windows.net/`, dfs: `https://${name}.dfs.core.windows.net/` }, publicNetworkAccess: 'Disabled', minimumTlsVersion: 'TLS1_2', ...more }, { kind: 'StorageV2', sku: { name: sku, tier: 'Standard' } });
  }
  vault(s, rg, name) {
    return this.add(s, rg, 'microsoft.keyvault/vaults', name, { vaultUri: `https://${name}.vault.azure.net/`, enableRbacAuthorization: true, publicNetworkAccess: 'Disabled', sku: { family: 'A', name: 'standard' }, tenantId: TENANT });
  }
  sql(s, rg, name, dbs) {
    const id = this.add(s, rg, 'microsoft.sql/servers', name, { fullyQualifiedDomainName: `${name}.database.windows.net`, publicNetworkAccess: 'Disabled', version: '12.0' }, { kind: 'v12.0' });
    for (const db of ['master', ...dbs]) this.add(s, rg, 'microsoft.sql/servers/databases', `${name}/${db}`, { status: 'Online' }, { kind: 'v12.0,user', sku: { name: db === 'master' ? 'System' : 'GP_S_Gen5_2', tier: db === 'master' ? 'System' : 'GeneralPurpose' }, managedBy: db === 'master' ? id : '' });
    return id;
  }
  insights(s, rg, name, workspace) {
    return this.add(s, rg, 'microsoft.insights/components', name, { Application_Type: 'web', WorkspaceResourceId: workspace, IngestionMode: 'LogAnalytics' }, { kind: 'web' });
  }
  workspace(s, rg, name) {
    return this.add(s, rg, 'microsoft.operationalinsights/workspaces', name, { customerId: guid(`law ${name}`), retentionInDays: 90, sku: { name: 'PerGB2018' } });
  }
  frontDoor(s, rg, name, origins) {
    const id = this.add(s, rg, 'microsoft.cdn/profiles', name, { frontDoorId: guid(`afd ${name}`), originResponseTimeoutSeconds: 60 }, { kind: 'frontdoor', location: 'Global', sku: { name: 'Premium_AzureFrontDoor' } });
    this.add(s, rg, 'microsoft.cdn/profiles/afdendpoints', `${name}/${name}-ep`, { hostName: `${name}-ep-${guid(name).slice(0, 8)}.z01.azurefd.net`, enabledState: 'Enabled' }, { location: 'Global' });
    this.add(s, rg, 'microsoft.cdn/profiles/origingroups', `${name}/og-default`, { healthProbeSettings: { probePath: '/healthz', probeProtocol: 'Https' } }, { location: 'Global' });
    for (const [n, host] of origins) this.add(s, rg, 'microsoft.cdn/profiles/origingroups/origins', `${name}/og-default/${n}`, { hostName: host, originHostHeader: host, httpsPort: 443, enabledState: 'Enabled' }, { location: 'Global' });
    return id;
  }
}

/** az monitor diagnostic-settings list, one per resource, put together: fields flat, as the CLI writes them. */
const diagnostics = (pairs) => pairs.map(([on, workspace]) => ({ id: `${on}/providers/microsoft.insights/diagnosticSettings/to-log-analytics`, name: 'to-log-analytics', type: 'Microsoft.Insights/diagnosticSettings', resourceGroup: on.split('/')[4], workspaceId: workspace, logs: [{ categoryGroup: 'allLogs', enabled: true }], metrics: [{ category: 'AllMetrics', enabled: true }] }));
/** az graph query -q "resources | …" -o json: the rows under data, as the CLI writes them. */
const answer = (rows) => ({ count: rows.length, data: rows, skip_token: null, total_records: rows.length });

// ---------------------------------------------------------------- the small web app

const WEB = 'Kestrel Bookings';
{
  const g = new Graph([['kestrel', 'Kestrel Logistics', null]]);
  g.subscription(WEB, [['kestrel', 'Kestrel Logistics']]);
  for (const rg of ['rg-bookings-prod', 'rg-bookings-network']) g.group(WEB, rg);
  const net = 'rg-bookings-network';
  const app = 'rg-bookings-prod';
  const nsg = g.nsg(WEB, net, 'nsg-bookings-app');
  const snet = g.vnet(WEB, net, 'vnet-bookings-prod', '10.20.0.0/22', [
    ['snet-app', '10.20.0.0/24', { networkSecurityGroup: { id: nsg }, delegations: [{ name: 'web', properties: { serviceName: 'Microsoft.Web/serverFarms' } }] }],
    ['snet-pe', '10.20.1.0/24', { networkSecurityGroup: { id: nsg } }],
  ]);
  const law = g.workspace(WEB, app, 'log-bookings-prod');
  const plan = g.plan(WEB, app, 'asp-bookings-prod');
  const site = g.web(WEB, app, 'app-kestrel-bookings', plan, snet['snet-app']);
  g.insights(WEB, app, 'appi-bookings-prod', law);
  const kv = g.vault(WEB, app, 'kv-kestrel-bookings');
  const sql = g.sql(WEB, app, 'sql-kestrel-bookings', ['bookings']);
  const st = g.storage(WEB, app, 'stkestrelbookings');
  g.pe(WEB, app, 'pe-sql-bookings', snet['snet-pe'], sql, 'sqlServer', '10.20.1.4');
  g.pe(WEB, app, 'pe-kv-bookings', snet['snet-pe'], kv, 'vault', '10.20.1.5');
  g.pe(WEB, app, 'pe-st-bookings-blob', snet['snet-pe'], st, 'blob', '10.20.1.6');
  g.frontDoor(WEB, app, 'afd-kestrel-bookings', [['app', 'app-kestrel-bookings.azurewebsites.net']]);
  save('webapp/graph', 'resources.json', answer(g.rows));
  save('webapp/graph', 'containers.json', answer(g.containers));
  save('webapp/graph', 'diagnostic-settings.json', diagnostics([site, kv, sql].map((x) => [x, law])));
}

// ---------------------------------------------------------------- the same app, as az bicep build writes it

{
  const network = {
    $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
    contentVersion: '1.0.0.0',
    metadata: { _generator: { name: 'bicep', version: '0.30.23.60470', templateHash: '1146394828817593471' } },
    parameters: { location: { type: 'string' }, env: { type: 'string' } },
    variables: { vnetName: "[format('vnet-bookings-{0}', parameters('env'))]" },
    resources: [
      { type: 'Microsoft.Network/networkSecurityGroups', apiVersion: '2023-11-01', name: 'nsg-bookings-app', location: "[parameters('location')]", properties: { securityRules: [] } },
      {
        type: 'Microsoft.Network/virtualNetworks',
        apiVersion: '2023-11-01',
        name: "[variables('vnetName')]",
        location: "[parameters('location')]",
        properties: {
          addressSpace: { addressPrefixes: ['10.20.0.0/22'] },
          subnets: [
            { name: 'snet-app', properties: { addressPrefix: '10.20.0.0/24', networkSecurityGroup: { id: "[resourceId('Microsoft.Network/networkSecurityGroups', 'nsg-bookings-app')]" }, delegations: [{ name: 'web', properties: { serviceName: 'Microsoft.Web/serverFarms' } }] } },
            { name: 'snet-pe', properties: { addressPrefix: '10.20.1.0/24', networkSecurityGroup: { id: "[resourceId('Microsoft.Network/networkSecurityGroups', 'nsg-bookings-app')]" } } },
          ],
        },
        dependsOn: ["[resourceId('Microsoft.Network/networkSecurityGroups', 'nsg-bookings-app')]"],
      },
    ],
    outputs: {
      appSubnetId: { type: 'string', value: "[resourceId('Microsoft.Network/virtualNetworks/subnets', variables('vnetName'), 'snet-app')]" },
      peSubnetId: { type: 'string', value: "[resourceId('Microsoft.Network/virtualNetworks/subnets', variables('vnetName'), 'snet-pe')]" },
    },
  };
  const subnetOut = (name) => `[reference(resourceId('Microsoft.Resources/deployments', 'network'), '2022-09-01').outputs.${name}.value]`;
  const pe = (name, target, group) => ({
    type: 'Microsoft.Network/privateEndpoints',
    apiVersion: '2023-11-01',
    name,
    location: "[parameters('location')]",
    properties: { subnet: { id: subnetOut('peSubnetId') }, privateLinkServiceConnections: [{ name, properties: { privateLinkServiceId: target, groupIds: [group] } }] },
    dependsOn: [target, "[resourceId('Microsoft.Resources/deployments', 'network')]"],
  });
  const diag = (scope, dependsOn) => ({
    type: 'Microsoft.Insights/diagnosticSettings',
    apiVersion: '2021-05-01-preview',
    scope,
    name: 'to-log-analytics',
    properties: { workspaceId: "[resourceId('Microsoft.OperationalInsights/workspaces', variables('logName'))]", logs: [{ categoryGroup: 'allLogs', enabled: true }] },
    dependsOn: [dependsOn, "[resourceId('Microsoft.OperationalInsights/workspaces', variables('logName'))]"],
  });
  const main = {
    $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
    contentVersion: '1.0.0.0',
    metadata: { _generator: { name: 'bicep', version: '0.30.23.60470', templateHash: '9087123465512398012' } },
    parameters: {
      location: { type: 'string', defaultValue: '[resourceGroup().location]' },
      env: { type: 'string', defaultValue: 'prod', allowedValues: ['test', 'prod'] },
      appName: { type: 'string', defaultValue: 'bookings' },
      sqlAdminGroupId: { type: 'string', metadata: { description: 'Entra group that administers the SQL server' } },
    },
    variables: {
      siteName: "[format('app-kestrel-{0}', parameters('appName'))]",
      planName: "[format('asp-{0}-{1}', parameters('appName'), parameters('env'))]",
      vaultName: "[format('kv-kestrel-{0}', parameters('appName'))]",
      sqlName: "[format('sql-kestrel-{0}', parameters('appName'))]",
      storageName: "[format('st{0}{1}', parameters('appName'), uniqueString(resourceGroup().id))]",
      logName: "[format('log-{0}-{1}', parameters('appName'), parameters('env'))]",
      insightsName: "[format('appi-{0}-{1}', parameters('appName'), parameters('env'))]",
      frontDoorName: "[format('afd-kestrel-{0}', parameters('appName'))]",
    },
    resources: [
      { type: 'Microsoft.OperationalInsights/workspaces', apiVersion: '2023-09-01', name: "[variables('logName')]", location: "[parameters('location')]", properties: { retentionInDays: 90, sku: { name: 'PerGB2018' } } },
      { type: 'Microsoft.Insights/components', apiVersion: '2020-02-02', name: "[variables('insightsName')]", location: "[parameters('location')]", kind: 'web', properties: { Application_Type: 'web', WorkspaceResourceId: "[resourceId('Microsoft.OperationalInsights/workspaces', variables('logName'))]" }, dependsOn: ["[resourceId('Microsoft.OperationalInsights/workspaces', variables('logName'))]"] },
      { type: 'Microsoft.Web/serverfarms', apiVersion: '2023-12-01', name: "[variables('planName')]", location: "[parameters('location')]", kind: 'linux', sku: { name: 'P1v3', capacity: 2 }, properties: { reserved: true } },
      {
        type: 'Microsoft.Web/sites',
        apiVersion: '2023-12-01',
        name: "[variables('siteName')]",
        location: "[parameters('location')]",
        kind: 'app,linux',
        identity: { type: 'SystemAssigned' },
        properties: {
          serverFarmId: "[resourceId('Microsoft.Web/serverfarms', variables('planName'))]",
          httpsOnly: true,
          virtualNetworkSubnetId: subnetOut('appSubnetId'),
          siteConfig: {
            linuxFxVersion: 'DOTNETCORE|8.0',
            appSettings: [
              { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: "[reference(resourceId('Microsoft.Insights/components', variables('insightsName')), '2020-02-02').ConnectionString]" },
              { name: 'ConnectionStrings__Bookings', value: "[format('@Microsoft.KeyVault(VaultName={0};SecretName=sql-connection)', variables('vaultName'))]" },
              { name: 'Storage__BlobEndpoint', value: "[reference(resourceId('Microsoft.Storage/storageAccounts', variables('storageName')), '2023-05-01').primaryEndpoints.blob]" },
            ],
          },
        },
        dependsOn: ["[resourceId('Microsoft.Web/serverfarms', variables('planName'))]", "[resourceId('Microsoft.Resources/deployments', 'network')]"],
      },
      diag("[format('Microsoft.Web/sites/{0}', variables('siteName'))]", "[resourceId('Microsoft.Web/sites', variables('siteName'))]"),
      { type: 'Microsoft.KeyVault/vaults', apiVersion: '2023-07-01', name: "[variables('vaultName')]", location: "[parameters('location')]", properties: { tenantId: '[subscription().tenantId]', sku: { family: 'A', name: 'standard' }, enableRbacAuthorization: true, publicNetworkAccess: 'Disabled' } },
      diag("[format('Microsoft.KeyVault/vaults/{0}', variables('vaultName'))]", "[resourceId('Microsoft.KeyVault/vaults', variables('vaultName'))]"),
      {
        type: 'Microsoft.Sql/servers',
        apiVersion: '2023-08-01-preview',
        name: "[variables('sqlName')]",
        location: "[parameters('location')]",
        properties: { publicNetworkAccess: 'Disabled', administrators: { administratorType: 'ActiveDirectory', azureADOnlyAuthentication: true, principalType: 'Group', sid: "[parameters('sqlAdminGroupId')]", login: 'sg-bookings-sql-admins' } },
        resources: [{ type: 'databases', apiVersion: '2023-08-01-preview', name: 'bookings', location: "[parameters('location')]", sku: { name: 'GP_S_Gen5_2', tier: 'GeneralPurpose' }, properties: {}, dependsOn: ["[resourceId('Microsoft.Sql/servers', variables('sqlName'))]"] }],
      },
      diag("[format('Microsoft.Sql/servers/{0}', variables('sqlName'))]", "[resourceId('Microsoft.Sql/servers', variables('sqlName'))]"),
      { type: 'Microsoft.Storage/storageAccounts', apiVersion: '2023-05-01', name: "[variables('storageName')]", location: "[parameters('location')]", kind: 'StorageV2', sku: { name: 'Standard_ZRS' }, properties: { publicNetworkAccess: 'Disabled', minimumTlsVersion: 'TLS1_2' } },
      pe('pe-sql-bookings', "[resourceId('Microsoft.Sql/servers', variables('sqlName'))]", 'sqlServer'),
      pe('pe-kv-bookings', "[resourceId('Microsoft.KeyVault/vaults', variables('vaultName'))]", 'vault'),
      pe('pe-st-bookings-blob', "[resourceId('Microsoft.Storage/storageAccounts', variables('storageName'))]", 'blob'),
      { type: 'Microsoft.Cdn/profiles', apiVersion: '2024-02-01', name: "[variables('frontDoorName')]", location: 'global', sku: { name: 'Premium_AzureFrontDoor' }, properties: {} },
      { type: 'Microsoft.Cdn/profiles/originGroups', apiVersion: '2024-02-01', name: "[format('{0}/{1}', variables('frontDoorName'), 'og-default')]", properties: { healthProbeSettings: { probePath: '/healthz' } }, dependsOn: ["[resourceId('Microsoft.Cdn/profiles', variables('frontDoorName'))]"] },
      {
        type: 'Microsoft.Cdn/profiles/originGroups/origins',
        apiVersion: '2024-02-01',
        name: "[format('{0}/{1}/{2}', variables('frontDoorName'), 'og-default', 'app')]",
        properties: { hostName: "[reference(resourceId('Microsoft.Web/sites', variables('siteName')), '2023-12-01').defaultHostName]", httpsPort: 443, priority: 1, weight: 1000 },
        dependsOn: ["[resourceId('Microsoft.Cdn/profiles/originGroups', variables('frontDoorName'), 'og-default')]", "[resourceId('Microsoft.Web/sites', variables('siteName'))]"],
      },
      {
        type: 'Microsoft.Resources/deployments',
        apiVersion: '2022-09-01',
        name: 'network',
        resourceGroup: 'rg-bookings-network',
        properties: { expressionEvaluationOptions: { scope: 'inner' }, mode: 'Incremental', parameters: { location: { value: "[parameters('location')]" }, env: { value: "[parameters('env')]" } }, template: network },
      },
    ],
    outputs: { siteHost: { type: 'string', value: "[reference(resourceId('Microsoft.Web/sites', variables('siteName')), '2023-12-01').defaultHostName]" } },
  };
  save('webapp/bicep', 'main.json', main);
}

// ---------------------------------------------------------------- the same app, as terraform show -json writes it

{
  const S = sub(WEB);
  const rg = (n) => `/subscriptions/${S}/resourceGroups/${n}`;
  const app = 'rg-bookings-prod';
  const net = 'rg-bookings-network';
  const ids = {
    vnet: `${rg(net)}/providers/Microsoft.Network/virtualNetworks/vnet-bookings-prod`,
    nsg: `${rg(net)}/providers/Microsoft.Network/networkSecurityGroups/nsg-bookings-app`,
    law: `${rg(app)}/providers/Microsoft.OperationalInsights/workspaces/log-bookings-prod`,
    appi: `${rg(app)}/providers/Microsoft.Insights/components/appi-bookings-prod`,
    plan: `${rg(app)}/providers/Microsoft.Web/serverFarms/asp-bookings-prod`,
    site: `${rg(app)}/providers/Microsoft.Web/sites/app-kestrel-bookings`,
    kv: `${rg(app)}/providers/Microsoft.KeyVault/vaults/kv-kestrel-bookings`,
    sql: `${rg(app)}/providers/Microsoft.Sql/servers/sql-kestrel-bookings`,
    st: `${rg(app)}/providers/Microsoft.Storage/storageAccounts/stkestrelbookings`,
    old: `${rg(app)}/providers/Microsoft.Storage/storageAccounts/stkestrelbookingsold`,
    afd: `${rg(app)}/providers/Microsoft.Cdn/profiles/afd-kestrel-bookings`,
  };
  ids.snetApp = `${ids.vnet}/subnets/snet-app`;
  ids.snetPe = `${ids.vnet}/subnets/snet-pe`;
  ids.og = `${ids.afd}/originGroups/og-default`;
  const res = (type, name, values, extra = {}) => ({ address: `${type}.${name}`, mode: 'managed', type, name, provider_name: 'registry.terraform.io/hashicorp/azurerm', schema_version: 0, values: { tags: {}, ...values }, sensitive_values: {}, ...extra });
  const pe = (name, peName, target, group, ip) =>
    res('azurerm_private_endpoint', name, { id: `${rg(app)}/providers/Microsoft.Network/privateEndpoints/${peName}`, name: peName, location: LOCATION, resource_group_name: app, subnet_id: ids.snetPe, private_service_connection: [{ name: peName, private_connection_resource_id: target, subresource_names: [group], is_manual_connection: false, private_ip_address: ip }], network_interface: [{ id: `${rg(app)}/providers/Microsoft.Network/networkInterfaces/${peName}.nic`, name: `${peName}.nic` }] });
  const diag = (name, target) => res('azurerm_monitor_diagnostic_setting', name, { id: `${target}|to-log-analytics`, name: 'to-log-analytics', target_resource_id: target, log_analytics_workspace_id: ids.law, enabled_log: [{ category_group: 'allLogs' }] });
  const state = [
    res('azurerm_resource_group', 'app', { id: rg(app), name: app, location: LOCATION }),
    res('azurerm_resource_group', 'network', { id: rg(net), name: net, location: LOCATION }),
    res('azurerm_network_security_group', 'app', { id: ids.nsg, name: 'nsg-bookings-app', location: LOCATION, resource_group_name: net, security_rule: [] }),
    res('azurerm_virtual_network', 'main', { id: ids.vnet, name: 'vnet-bookings-prod', location: LOCATION, resource_group_name: net, address_space: ['10.20.0.0/22'], subnet: [] }),
    res('azurerm_subnet', 'app', { id: ids.snetApp, name: 'snet-app', resource_group_name: net, virtual_network_name: 'vnet-bookings-prod', address_prefixes: ['10.20.0.0/24'], delegation: [{ name: 'web', service_delegation: [{ name: 'Microsoft.Web/serverFarms', actions: ['Microsoft.Network/virtualNetworks/subnets/action'] }] }] }),
    res('azurerm_subnet', 'pe', { id: ids.snetPe, name: 'snet-pe', resource_group_name: net, virtual_network_name: 'vnet-bookings-prod', address_prefixes: ['10.20.1.0/24'], delegation: [] }),
    res('azurerm_subnet_network_security_group_association', 'app', { id: ids.snetApp, subnet_id: ids.snetApp, network_security_group_id: ids.nsg }),
    res('azurerm_subnet_network_security_group_association', 'pe', { id: ids.snetPe, subnet_id: ids.snetPe, network_security_group_id: ids.nsg }),
    res('azurerm_log_analytics_workspace', 'main', { id: ids.law, name: 'log-bookings-prod', location: LOCATION, resource_group_name: app, sku: 'PerGB2018', retention_in_days: 90 }),
    res('azurerm_application_insights', 'main', { id: ids.appi, name: 'appi-bookings-prod', location: LOCATION, resource_group_name: app, application_type: 'web', workspace_id: ids.law }),
    res('azurerm_service_plan', 'main', { id: ids.plan, name: 'asp-bookings-prod', location: LOCATION, resource_group_name: app, os_type: 'Linux', sku_name: 'P1v3', worker_count: 2 }),
    res('azurerm_linux_web_app', 'bookings', {
      id: ids.site,
      name: 'app-kestrel-bookings',
      location: LOCATION,
      resource_group_name: app,
      service_plan_id: ids.plan,
      default_hostname: 'app-kestrel-bookings.azurewebsites.net',
      https_only: true,
      virtual_network_subnet_id: ids.snetApp,
      app_settings: { ConnectionStrings__Bookings: '@Microsoft.KeyVault(VaultName=kv-kestrel-bookings;SecretName=sql-connection)', Storage__BlobEndpoint: 'https://stkestrelbookings.blob.core.windows.net/' },
      identity: [{ type: 'SystemAssigned', principal_id: guid('mi app-kestrel-bookings'), tenant_id: TENANT, identity_ids: [] }],
      site_config: [{ always_on: true, application_stack: [{ dotnet_version: '8.0' }] }],
    }),
    diag('site', ids.site),
    res('azurerm_key_vault', 'main', { id: ids.kv, name: 'kv-kestrel-bookings', location: LOCATION, resource_group_name: app, sku_name: 'standard', tenant_id: TENANT, vault_uri: 'https://kv-kestrel-bookings.vault.azure.net/', enable_rbac_authorization: true, public_network_access_enabled: false }),
    diag('kv', ids.kv),
    res('azurerm_mssql_server', 'main', { id: ids.sql, name: 'sql-kestrel-bookings', location: LOCATION, resource_group_name: app, version: '12.0', fully_qualified_domain_name: 'sql-kestrel-bookings.database.windows.net', public_network_access_enabled: false }),
    res('azurerm_mssql_database', 'bookings', { id: `${ids.sql}/databases/bookings`, name: 'bookings', server_id: ids.sql, sku_name: 'GP_S_Gen5_2' }),
    diag('sql', ids.sql),
    res('azurerm_storage_account', 'main', { id: ids.st, name: 'stkestrelbookings', location: LOCATION, resource_group_name: app, account_tier: 'Standard', account_replication_type: 'ZRS', primary_blob_endpoint: 'https://stkestrelbookings.blob.core.windows.net/', public_network_access_enabled: false }),
    res('azurerm_storage_account', 'old', { id: ids.old, name: 'stkestrelbookingsold', location: LOCATION, resource_group_name: app, account_tier: 'Standard', account_replication_type: 'LRS', primary_blob_endpoint: 'https://stkestrelbookingsold.blob.core.windows.net/' }),
    pe('sql', 'pe-sql-bookings', ids.sql, 'sqlServer', '10.20.1.4'),
    pe('kv', 'pe-kv-bookings', ids.kv, 'vault', '10.20.1.5'),
    pe('blob', 'pe-st-bookings-blob', ids.st, 'blob', '10.20.1.6'),
    res('azurerm_cdn_frontdoor_profile', 'main', { id: ids.afd, name: 'afd-kestrel-bookings', resource_group_name: app, sku_name: 'Premium_AzureFrontDoor' }),
    res('azurerm_cdn_frontdoor_origin_group', 'default', { id: ids.og, name: 'og-default', cdn_frontdoor_profile_id: ids.afd }),
    res('azurerm_cdn_frontdoor_origin', 'app', { id: `${ids.og}/origins/app`, name: 'app', cdn_frontdoor_origin_group_id: ids.og, host_name: 'app-kestrel-bookings.azurewebsites.net', origin_host_header: 'app-kestrel-bookings.azurewebsites.net' }),
  ];
  save('webapp/terraform', 'state.json', { format_version: '1.0', terraform_version: '1.9.8', values: { root_module: { resources: state } } });

  // The plan: a Redis cache with its private endpoint is added, the app's settings change, the old
  // storage account goes, and the front door's origin is replaced (its host changes).
  const known = state.filter((r) => r.address !== 'azurerm_storage_account.old');
  const site = known.find((r) => r.address === 'azurerm_linux_web_app.bookings');
  const after = { ...site.values, app_settings: { ...site.values.app_settings, Redis__Host: 'redis-kestrel-bookings.redis.cache.windows.net' } };
  const origin = known.find((r) => r.address === 'azurerm_cdn_frontdoor_origin.app');
  const created = [
    res('azurerm_redis_cache', 'main', { name: 'redis-kestrel-bookings', location: LOCATION, resource_group_name: app, sku_name: 'Premium', family: 'P', capacity: 1, public_network_access_enabled: false }),
    res('azurerm_private_endpoint', 'redis', { name: 'pe-redis-bookings', location: LOCATION, resource_group_name: app, subnet_id: ids.snetPe, private_service_connection: [{ name: 'pe-redis-bookings', subresource_names: ['redisCache'], is_manual_connection: false }] }),
  ];
  const planned = [...known.map((r) => (r === site ? { ...r, values: after } : r === origin ? { ...r, values: { ...origin.values, id: undefined, host_name: 'app-kestrel-bookings-v2.azurewebsites.net' } } : r)), ...created];
  const change = (r, actions, before, afterValues) => ({ address: r.address, mode: 'managed', type: r.type, name: r.name, provider_name: r.provider_name, change: { actions, before, after: afterValues, after_unknown: actions.includes('create') ? { id: true } : {} } });
  const changes = [
    ...known.filter((r) => r !== site && r !== origin).map((r) => change(r, ['no-op'], r.values, r.values)),
    change(site, ['update'], site.values, after),
    change(origin, ['delete', 'create'], origin.values, planned.find((p) => p.address === origin.address).values),
    change(state.find((r) => r.address === 'azurerm_storage_account.old'), ['delete'], state.find((r) => r.address === 'azurerm_storage_account.old').values, null),
    ...created.map((r) => change(r, ['create'], null, r.values)),
  ];
  const configuration = {
    provider_config: { azurerm: { name: 'azurerm', full_name: 'registry.terraform.io/hashicorp/azurerm' } },
    root_module: {
      resources: [
        { address: 'azurerm_redis_cache.main', mode: 'managed', type: 'azurerm_redis_cache', name: 'main', expressions: { resource_group_name: { references: ['azurerm_resource_group.app.name', 'azurerm_resource_group.app'] } } },
        { address: 'azurerm_private_endpoint.redis', mode: 'managed', type: 'azurerm_private_endpoint', name: 'redis', expressions: { subnet_id: { references: ['azurerm_subnet.pe.id', 'azurerm_subnet.pe'] }, private_service_connection: [{ private_connection_resource_id: { references: ['azurerm_redis_cache.main.id', 'azurerm_redis_cache.main'] } }] } },
      ],
    },
  };
  save('webapp/terraform', 'plan.json', { format_version: '1.2', terraform_version: '1.9.8', planned_values: { root_module: { resources: planned.map((r) => ({ ...r, values: Object.fromEntries(Object.entries(r.values).filter(([, v]) => v !== undefined)) })) } }, resource_changes: changes, configuration, prior_state: { format_version: '1.0', terraform_version: '1.9.8', values: { root_module: { resources: state } } } });
}

// ---------------------------------------------------------------- a hub-and-spoke landing zone

function landingZone(later) {
  const g = new Graph([
    ['kestrel', 'Kestrel Logistics', null],
    ['kestrel-platform', 'Platform', 'kestrel'],
    ['kestrel-landingzones', 'Landing zones', 'kestrel'],
    ['kestrel-corp', 'Corp', 'kestrel-landingzones'],
  ]);
  const CONN = g.subscription('Kestrel Connectivity', [['kestrel-platform', 'Platform'], ['kestrel', 'Kestrel Logistics']]);
  const SHOP = g.subscription('Kestrel Shop Production', [['kestrel-corp', 'Corp'], ['kestrel-landingzones', 'Landing zones'], ['kestrel', 'Kestrel Logistics']]);
  const DATA = g.subscription('Kestrel Data Platform', [['kestrel-corp', 'Corp'], ['kestrel-landingzones', 'Landing zones'], ['kestrel', 'Kestrel Logistics']]);
  const groups = { [CONN]: ['rg-hub-network', 'rg-hub-dns', 'rg-management', 'NetworkWatcherRG'], [SHOP]: ['rg-shop-network', 'rg-shop-app', 'rg-shop-edge'], [DATA]: ['rg-data-network', 'rg-data-prod'] };
  for (const [s, list] of Object.entries(groups)) for (const rg of list) g.group(s, rg);
  const FW_IP = '10.0.0.4';
  const vnetIds = {
    hub: rid(CONN, 'rg-hub-network', 'microsoft.network/virtualnetworks', 'vnet-hub-weu'),
    shop: rid(SHOP, 'rg-shop-network', 'microsoft.network/virtualnetworks', 'vnet-shop-prod'),
    data: rid(DATA, 'rg-data-network', 'microsoft.network/virtualnetworks', 'vnet-data-prod'),
  };

  // Connectivity: the hub, with the firewall, the VPN to head office, Bastion, DNS.
  const law = g.workspace(CONN, 'rg-management', 'log-kestrel-platform');
  g.add(CONN, 'rg-management', 'microsoft.automation/automationaccounts', 'aa-kestrel-platform', { sku: { name: 'Basic' } });
  g.add(CONN, 'rg-management', 'microsoft.recoveryservices/vaults', 'rsv-kestrel-weu', {}, { sku: { name: 'RS0', tier: 'Standard' } });
  g.add(CONN, 'rg-management', 'microsoft.managedidentity/userassignedidentities', 'id-kestrel-policy', { principalId: guid('id-kestrel-policy') });
  g.add(CONN, 'NetworkWatcherRG', 'microsoft.network/networkwatchers', 'NetworkWatcher_westeurope', {});
  const nsgShared = g.nsg(CONN, 'rg-hub-network', 'nsg-hub-shared');
  const rtShared = g.routeTable(CONN, 'rg-hub-network', 'rt-hub-shared', FW_IP);
  const hub = g.vnet(CONN, 'rg-hub-network', 'vnet-hub-weu', '10.0.0.0/16', [
    ['AzureFirewallSubnet', '10.0.0.0/26'],
    ['GatewaySubnet', '10.0.0.64/27'],
    ['AzureBastionSubnet', '10.0.0.128/26'],
    ['snet-dns-inbound', '10.0.1.0/28', { delegations: [{ name: 'dns', properties: { serviceName: 'Microsoft.Network/dnsResolvers' } }] }],
    ['snet-shared', '10.0.2.0/24', { networkSecurityGroup: { id: nsgShared }, routeTable: { id: rtShared } }],
  ], [vnetIds.shop, vnetIds.data]);
  const pipFw = g.pip(CONN, 'rg-hub-network', 'pip-afw-hub-weu', '20.71.10.4');
  const pipVgw = g.pip(CONN, 'rg-hub-network', 'pip-vgw-hub-weu', '20.71.10.5');
  const pipBas = g.pip(CONN, 'rg-hub-network', 'pip-bas-hub-weu', '20.71.10.6');
  const policy = g.add(CONN, 'rg-hub-network', 'microsoft.network/firewallpolicies', 'afwp-kestrel-hub', { sku: { tier: 'Premium' }, threatIntelMode: 'Deny' });
  g.add(CONN, 'rg-hub-network', 'microsoft.network/azurefirewalls', 'afw-hub-weu', { sku: { name: 'AZFW_VNet', tier: 'Premium' }, firewallPolicy: { id: policy }, ipConfigurations: [{ name: 'ipconfig', properties: { privateIPAddress: FW_IP, subnet: { id: hub.AzureFirewallSubnet }, publicIPAddress: { id: pipFw } } }] });
  const vgw = g.add(CONN, 'rg-hub-network', 'microsoft.network/virtualnetworkgateways', 'vgw-hub-weu', { gatewayType: 'Vpn', vpnType: 'RouteBased', sku: { name: 'VpnGw2AZ', tier: 'VpnGw2AZ' }, ipConfigurations: [{ name: 'default', properties: { subnet: { id: hub.GatewaySubnet }, publicIPAddress: { id: pipVgw } } }] });
  const lgw = g.add(CONN, 'rg-hub-network', 'microsoft.network/localnetworkgateways', 'lgw-kestrel-hq', { gatewayIpAddress: '198.51.100.10', localNetworkAddressSpace: { addressPrefixes: ['192.168.0.0/16'] } });
  g.add(CONN, 'rg-hub-network', 'microsoft.network/connections', 'cn-hub-to-hq', { connectionType: 'IPsec', virtualNetworkGateway1: { id: vgw }, localNetworkGateway2: { id: lgw }, connectionStatus: 'Connected' });
  g.add(CONN, 'rg-hub-network', 'microsoft.network/bastionhosts', 'bas-hub-weu', { ipConfigurations: [{ name: 'ipconf', properties: { subnet: { id: hub.AzureBastionSubnet }, publicIPAddress: { id: pipBas } } }] }, { sku: { name: 'Standard' } });
  g.add(CONN, 'rg-hub-network', 'microsoft.network/dnsresolvers', 'dnspr-hub-weu', { virtualNetwork: { id: vnetIds.hub } });
  g.vm(CONN, 'rg-hub-network', 'vm-hub-dc01', hub['snet-shared'], '10.0.2.4');
  g.vm(CONN, 'rg-hub-network', 'vm-hub-dc02', hub['snet-shared'], '10.0.2.5');
  const zones = ['privatelink.blob.core.windows.net', 'privatelink.dfs.core.windows.net', 'privatelink.vaultcore.azure.net', 'privatelink.database.windows.net', 'privatelink.azurewebsites.net', 'privatelink.redis.cache.windows.net', 'privatelink.servicebus.windows.net', 'privatelink.azurecr.io', 'privatelink.postgres.database.azure.com', 'privatelink.documents.azure.com', 'privatelink.westeurope.azmk8s.io', 'privatelink.openai.azure.com', 'privatelink.search.windows.net'];
  for (const z of zones) {
    g.add(CONN, 'rg-hub-dns', 'microsoft.network/privatednszones', z, { numberOfRecordSets: 4 }, { location: 'global' });
    g.add(CONN, 'rg-hub-dns', 'microsoft.network/privatednszones/virtualnetworklinks', `${z}/link-vnet-hub-weu`, { virtualNetwork: { id: vnetIds.hub }, registrationEnabled: false }, { location: 'global' });
  }

  // Shop: a spoke with the application gateway, App Service, AKS and the data behind private endpoints.
  const nsg = (n) => g.nsg(SHOP, 'rg-shop-network', n);
  const rtShop = g.routeTable(SHOP, 'rg-shop-network', 'rt-shop-spoke', FW_IP);
  const shop = g.vnet(SHOP, 'rg-shop-network', 'vnet-shop-prod', '10.1.0.0/16', [
    ['snet-agw', '10.1.0.0/24', { networkSecurityGroup: { id: nsg('nsg-shop-agw') } }],
    ['snet-app', '10.1.1.0/24', { networkSecurityGroup: { id: nsg('nsg-shop-app') }, routeTable: { id: rtShop }, delegations: [{ name: 'web', properties: { serviceName: 'Microsoft.Web/serverFarms' } }] }],
    ['snet-pe', '10.1.2.0/24', { networkSecurityGroup: { id: nsg('nsg-shop-pe') } }],
    ['snet-aks', '10.1.4.0/22', { networkSecurityGroup: { id: nsg('nsg-shop-aks') }, routeTable: { id: rtShop } }],
  ], [vnetIds.hub]);
  const pipAgw = g.pip(SHOP, 'rg-shop-network', 'pip-agw-shop-prod', '20.71.20.10', 'kestrel-shop-prod.westeurope.cloudapp.azure.com');
  g.add(SHOP, 'rg-shop-network', 'microsoft.network/applicationgateways', 'agw-shop-prod', {
    sku: { name: 'WAF_v2', tier: 'WAF_v2', capacity: 2 },
    gatewayIPConfigurations: [{ name: 'gw', properties: { subnet: { id: shop['snet-agw'] } } }],
    frontendIPConfigurations: [{ name: 'public', properties: { publicIPAddress: { id: pipAgw } } }],
    backendAddressPools: [
      { name: 'web', properties: { backendAddresses: [{ fqdn: 'app-kestrel-shop-web.azurewebsites.net' }] } },
      { name: 'aks-ingress', properties: { backendAddresses: [{ ipAddress: '10.1.4.250' }] } },
    ],
  });
  const plan = g.plan(SHOP, 'rg-shop-app', 'asp-shop-prod', 'P2v3');
  const shopLaw = law;
  const web = g.web(SHOP, 'rg-shop-app', 'app-kestrel-shop-web', plan, shop['snet-app']);
  const api = g.web(SHOP, 'rg-shop-app', 'app-kestrel-shop-api', plan, shop['snet-app']);
  const jobs = g.web(SHOP, 'rg-shop-app', 'func-kestrel-shop-jobs', plan, shop['snet-app'], 'functionapp,linux');
  const aks = g.add(SHOP, 'rg-shop-app', 'microsoft.containerservice/managedclusters', 'aks-shop-prod', {
    kubernetesVersion: '1.30.6',
    agentPoolProfiles: [{ name: 'system', count: 3, vmSize: 'Standard_D4s_v5', vnetSubnetID: shop['snet-aks'], mode: 'System' }, { name: 'apps', count: 4, vmSize: 'Standard_D8s_v5', vnetSubnetID: shop['snet-aks'], mode: 'User' }],
    addonProfiles: { omsagent: { enabled: true, config: { logAnalyticsWorkspaceResourceID: shopLaw } } },
    networkProfile: { networkPlugin: 'azure', outboundType: 'userDefinedRouting' },
    apiServerAccessProfile: { enablePrivateCluster: true },
  }, { sku: { name: 'Base', tier: 'Standard' } });
  g.nic(SHOP, 'rg-shop-app', 'nic-aks-ingress', shop['snet-aks'], '10.1.4.250', { vm: undefined });
  const acr = g.add(SHOP, 'rg-shop-app', 'microsoft.containerregistry/registries', 'crkestrelshopprod', { loginServer: 'crkestrelshopprod.azurecr.io', publicNetworkAccess: 'Disabled' }, { sku: { name: 'Premium', tier: 'Premium' } });
  const kv = g.vault(SHOP, 'rg-shop-app', 'kv-kestrel-shop-prod');
  const sql = g.sql(SHOP, 'rg-shop-app', 'sql-kestrel-shop-prod', ['orders', 'catalog', 'customers']);
  const st = g.storage(SHOP, 'rg-shop-app', 'stkestrelshopprod');
  const redis = g.add(SHOP, 'rg-shop-app', 'microsoft.cache/redis', 'redis-kestrel-shop-prod', { hostName: 'redis-kestrel-shop-prod.redis.cache.windows.net', sku: { name: 'Premium', family: 'P', capacity: 1 }, publicNetworkAccess: 'Disabled' });
  const sb = g.add(SHOP, 'rg-shop-app', 'microsoft.servicebus/namespaces', 'sb-kestrel-shop-prod', { serviceBusEndpoint: 'https://sb-kestrel-shop-prod.servicebus.windows.net:443/' }, { sku: { name: 'Premium', tier: 'Premium', capacity: 1 } });
  g.insights(SHOP, 'rg-shop-app', 'appi-shop-prod', shopLaw);
  const peSpecs = [['pe-kv-shop', kv, 'vault', 4], ['pe-sql-shop', sql, 'sqlServer', 5], ['pe-st-shop-blob', st, 'blob', 6], ['pe-redis-shop', redis, 'redisCache', 7], ['pe-sb-shop', sb, 'namespace', 8], ['pe-acr-shop', acr, 'registry', 9]];
  for (const [n, target, grp, ip] of peSpecs) g.pe(SHOP, 'rg-shop-app', n, shop['snet-pe'], target, grp, `10.1.2.${ip}`);
  g.frontDoor(SHOP, 'rg-shop-edge', 'afd-kestrel-shop', [['agw', 'kestrel-shop-prod.westeurope.cloudapp.azure.com']]);

  // Data: a spoke with Data Factory, Databricks, a self-hosted integration runtime and much storage.
  const rtData = g.routeTable(DATA, 'rg-data-network', 'rt-data-spoke', FW_IP);
  const nsgData = g.nsg(DATA, 'rg-data-network', 'nsg-data-default');
  const nsgDbw = g.nsg(DATA, 'rg-data-network', 'nsg-data-databricks');
  const data = g.vnet(DATA, 'rg-data-network', 'vnet-data-prod', '10.2.0.0/16', [
    ['snet-pe', '10.2.1.0/24', { networkSecurityGroup: { id: nsgData } }],
    ['snet-compute', '10.2.2.0/24', { networkSecurityGroup: { id: nsgData }, routeTable: { id: rtData } }],
    ['snet-psql', '10.2.3.0/28', { networkSecurityGroup: { id: nsgData }, delegations: [{ name: 'psql', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }] }],
    ['snet-dbw-host', '10.2.4.0/24', { networkSecurityGroup: { id: nsgDbw }, routeTable: { id: rtData }, delegations: [{ name: 'dbw', properties: { serviceName: 'Microsoft.Databricks/workspaces' } }] }],
    ['snet-dbw-container', '10.2.5.0/24', { networkSecurityGroup: { id: nsgDbw }, routeTable: { id: rtData }, delegations: [{ name: 'dbw', properties: { serviceName: 'Microsoft.Databricks/workspaces' } }] }],
  ], [vnetIds.hub]);
  const D = 'rg-data-prod';
  g.add(DATA, D, 'microsoft.datafactory/factories', 'adf-kestrel-data', { publicNetworkAccess: 'Disabled' }, { identity: { type: 'SystemAssigned', principalId: guid('adf') } });
  g.add(DATA, D, 'microsoft.databricks/workspaces', 'dbw-kestrel-data', { parameters: { customVirtualNetworkId: { value: vnetIds.data }, customPublicSubnetName: { value: 'snet-dbw-host' }, customPrivateSubnetName: { value: 'snet-dbw-container' } }, managedResourceGroupId: `/subscriptions/${sub(DATA)}/resourceGroups/rg-dbw-kestrel-data-managed` }, { sku: { name: 'premium' } });
  g.vm(DATA, D, 'vm-data-shir01', data['snet-compute'], '10.2.2.4', 'Standard_D4s_v5');
  g.vm(DATA, D, 'vm-data-shir02', data['snet-compute'], '10.2.2.5', 'Standard_D4s_v5');
  const lake = g.storage(DATA, D, 'stkestrellake', 'Standard_ZRS', { isHnsEnabled: true });
  const stores = ['stkestrelraw', 'stkestrelcurated', 'stkestrelarchive', 'stkestrelsandbox', 'stkestrelexports', 'stkestrelaudit', ...(later ? ['stkestrelmodels'] : [])].map((n) => g.storage(DATA, D, n, 'Standard_LRS'));
  const evh = g.add(DATA, D, 'microsoft.eventhub/namespaces', 'evhns-kestrel-data', { serviceBusEndpoint: 'https://evhns-kestrel-data.servicebus.windows.net:443/' }, { sku: { name: 'Standard', tier: 'Standard', capacity: 2 } });
  const cosmos = g.add(DATA, D, 'microsoft.documentdb/databaseaccounts', 'cosmos-kestrel-data', { documentEndpoint: 'https://cosmos-kestrel-data.documents.azure.com:443/', publicNetworkAccess: 'Disabled' }, { kind: 'GlobalDocumentDB' });
  const kvData = g.vault(DATA, D, 'kv-kestrel-data');
  const oai = g.add(DATA, D, 'microsoft.cognitiveservices/accounts', 'oai-kestrel-data', { endpoint: 'https://oai-kestrel-data.openai.azure.com/', publicNetworkAccess: 'Disabled' }, { kind: 'OpenAI', sku: { name: 'S0' } });
  const srch = g.add(DATA, D, 'microsoft.search/searchservices', 'srch-kestrel-data', { publicNetworkAccess: 'disabled', replicaCount: 2 }, { sku: { name: 'standard' } });
  g.add(DATA, D, 'microsoft.dbforpostgresql/flexibleservers', 'psql-kestrel-data', { fullyQualifiedDomainName: 'psql-kestrel-data.postgres.database.azure.com', version: '16', network: { delegatedSubnetResourceId: data['snet-psql'], publicNetworkAccess: 'Disabled' } }, { sku: { name: 'Standard_D4ds_v5', tier: 'GeneralPurpose' } });
  const dataPes = [['pe-lake-dfs', lake, 'dfs', 4], ['pe-raw-blob', stores[0], 'blob', 5], ['pe-curated-blob', stores[1], 'blob', 6], ['pe-cosmos', cosmos, 'Sql', 7], ['pe-kv-data', kvData, 'vault', 8], ['pe-oai', oai, 'account', 9], ['pe-srch', srch, 'searchService', 10], ['pe-evh', evh, 'namespace', 11]];
  for (const [n, target, grp, ip] of dataPes) g.pe(DATA, D, n, data['snet-pe'], target, grp, `10.2.1.${ip}`);

  const diag = [web, api, jobs, aks, kv, sql, kvData, cosmos].map((x) => [x, law]);
  return { graph: g, diag };
}
for (const later of [false, true]) {
  const { graph, diag } = landingZone(later);
  const folder = later ? 'landing-zone-later' : 'landing-zone';
  save(folder, 'resources.json', answer(graph.rows));
  save(folder, 'containers.json', answer(graph.containers));
  save(folder, 'diagnostic-settings.json', diagnostics(diag));
  if (!later) console.log(`landing zone: ${graph.rows.length} resources, ${graph.containers.length} containers`);
}
