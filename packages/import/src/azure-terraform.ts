// Terraform (azurerm) → the estate. Reads `terraform show -json` of a state or a saved plan with the
// terraform reader's own walk (modules, references in the configuration of a plan), and puts each
// azurerm resource in Azure's words: its resource type, its resource id. A plan also says what it
// will do to each resource; what it deletes is read from what was there before.
import { Estate, hostOf, walkRefs, type AzResource, type Change } from './azure-estate.ts';
import { isObj, str, type Obj } from './keep.ts';
import { link, readConfig, readResources, type Resource } from './terraform.ts';

/** azurerm resource → Azure resource type. */
const TYPES: Record<string, string> = {
  virtual_network: 'microsoft.network/virtualnetworks',
  subnet: 'microsoft.network/virtualnetworks/subnets',
  network_security_group: 'microsoft.network/networksecuritygroups',
  route_table: 'microsoft.network/routetables',
  nat_gateway: 'microsoft.network/natgateways',
  network_interface: 'microsoft.network/networkinterfaces',
  public_ip: 'microsoft.network/publicipaddresses',
  private_endpoint: 'microsoft.network/privateendpoints',
  private_dns_zone: 'microsoft.network/privatednszones',
  private_dns_zone_virtual_network_link: 'microsoft.network/privatednszones/virtualnetworklinks',
  dns_zone: 'microsoft.network/dnszones',
  application_gateway: 'microsoft.network/applicationgateways',
  lb: 'microsoft.network/loadbalancers',
  firewall: 'microsoft.network/azurefirewalls',
  firewall_policy: 'microsoft.network/firewallpolicies',
  bastion_host: 'microsoft.network/bastionhosts',
  virtual_network_gateway: 'microsoft.network/virtualnetworkgateways',
  local_network_gateway: 'microsoft.network/localnetworkgateways',
  virtual_network_gateway_connection: 'microsoft.network/connections',
  express_route_circuit: 'microsoft.network/expressroutecircuits',
  frontdoor: 'microsoft.network/frontdoors',
  network_watcher: 'microsoft.network/networkwatchers',
  cdn_frontdoor_profile: 'microsoft.cdn/profiles',
  cdn_profile: 'microsoft.cdn/profiles',
  cdn_frontdoor_origin: 'microsoft.cdn/profiles/origingroups/origins',
  cdn_frontdoor_origin_group: 'microsoft.cdn/profiles/origingroups',
  cdn_frontdoor_endpoint: 'microsoft.cdn/profiles/afdendpoints',
  service_plan: 'microsoft.web/serverfarms',
  app_service_plan: 'microsoft.web/serverfarms',
  linux_web_app: 'microsoft.web/sites',
  windows_web_app: 'microsoft.web/sites',
  app_service: 'microsoft.web/sites',
  linux_function_app: 'microsoft.web/sites',
  windows_function_app: 'microsoft.web/sites',
  function_app: 'microsoft.web/sites',
  logic_app_standard: 'microsoft.web/sites',
  static_web_app: 'microsoft.web/staticsites',
  static_site: 'microsoft.web/staticsites',
  logic_app_workflow: 'microsoft.logic/workflows',
  container_app_environment: 'microsoft.app/managedenvironments',
  container_app: 'microsoft.app/containerapps',
  container_app_job: 'microsoft.app/jobs',
  container_registry: 'microsoft.containerregistry/registries',
  kubernetes_cluster: 'microsoft.containerservice/managedclusters',
  linux_virtual_machine: 'microsoft.compute/virtualmachines',
  windows_virtual_machine: 'microsoft.compute/virtualmachines',
  virtual_machine: 'microsoft.compute/virtualmachines',
  linux_virtual_machine_scale_set: 'microsoft.compute/virtualmachinescalesets',
  windows_virtual_machine_scale_set: 'microsoft.compute/virtualmachinescalesets',
  orchestrated_virtual_machine_scale_set: 'microsoft.compute/virtualmachinescalesets',
  managed_disk: 'microsoft.compute/disks',
  mssql_server: 'microsoft.sql/servers',
  sql_server: 'microsoft.sql/servers',
  mssql_database: 'microsoft.sql/servers/databases',
  sql_database: 'microsoft.sql/servers/databases',
  mssql_managed_instance: 'microsoft.sql/managedinstances',
  postgresql_flexible_server: 'microsoft.dbforpostgresql/flexibleservers',
  postgresql_server: 'microsoft.dbforpostgresql/servers',
  mysql_flexible_server: 'microsoft.dbformysql/flexibleservers',
  cosmosdb_account: 'microsoft.documentdb/databaseaccounts',
  storage_account: 'microsoft.storage/storageaccounts',
  redis_cache: 'microsoft.cache/redis',
  key_vault: 'microsoft.keyvault/vaults',
  servicebus_namespace: 'microsoft.servicebus/namespaces',
  eventhub_namespace: 'microsoft.eventhub/namespaces',
  eventgrid_topic: 'microsoft.eventgrid/topics',
  eventgrid_system_topic: 'microsoft.eventgrid/systemtopics',
  eventgrid_domain: 'microsoft.eventgrid/domains',
  api_management: 'microsoft.apimanagement/service',
  data_factory: 'microsoft.datafactory/factories',
  cognitive_account: 'microsoft.cognitiveservices/accounts',
  search_service: 'microsoft.search/searchservices',
  log_analytics_workspace: 'microsoft.operationalinsights/workspaces',
  application_insights: 'microsoft.insights/components',
  monitor_action_group: 'microsoft.insights/actiongroups',
  monitor_metric_alert: 'microsoft.insights/metricalerts',
  user_assigned_identity: 'microsoft.managedidentity/userassignedidentities',
  recovery_services_vault: 'microsoft.recoveryservices/vaults',
  databricks_workspace: 'microsoft.databricks/workspaces',
  synapse_workspace: 'microsoft.synapse/workspaces',
  signalr_service: 'microsoft.signalrservice/signalr',
  machine_learning_workspace: 'microsoft.machinelearningservices/workspaces',
};

/** Resources that only join two others: what they say goes on the first, under Azure's attribute for it. */
const JOINS: Record<string, [on: string, path: string, to: string]> = {
  subnet_network_security_group_association: ['subnet_id', 'networkSecurityGroup.id', 'network_security_group_id'],
  subnet_route_table_association: ['subnet_id', 'routeTable.id', 'route_table_id'],
  subnet_nat_gateway_association: ['subnet_id', 'natGateway.id', 'nat_gateway_id'],
  app_service_virtual_network_swift_connection: ['app_service_id', 'virtualNetworkSubnetId', 'subnet_id'],
  network_interface_backend_address_pool_association: ['network_interface_id', 'ipConfigurations.loadBalancerBackendAddressPools.id', 'backend_address_pool_id'],
  network_interface_application_gateway_backend_address_pool_association: ['network_interface_id', 'ipConfigurations.applicationGatewayBackendAddressPools.id', 'backend_address_pool_id'],
  network_interface_security_group_association: ['network_interface_id', 'networkSecurityGroup.id', 'network_security_group_id'],
  kubernetes_cluster_node_pool: ['kubernetes_cluster_id', 'agentPoolProfiles.vnetSubnetID', 'vnet_subnet_id'],
};

/** The JSON of `terraform show -json` with azurerm resources in it. */
export function hasAzurerm(doc: Obj): boolean {
  const root = isObj(doc.planned_values) ? doc.planned_values.root_module : isObj(doc.values) ? doc.values.root_module : undefined;
  const all: Resource[] = [];
  readResources(root, all);
  return all.some((r) => r.type.startsWith('azurerm_'));
}

const first = (v: unknown): Obj => (Array.isArray(v) && isObj(v[0]) ? v[0] : isObj(v) ? v : {});
const many = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? [v] : []);

/** What a plan does, in one word. */
function changeOf(actions: unknown): Change | undefined {
  const a = strings(actions);
  if (a.includes('delete') && a.includes('create')) return 'replace';
  if (a.includes('create')) return 'create';
  if (a.includes('delete')) return 'delete';
  if (a.includes('update')) return 'update';
  return undefined;
}

/** Reads the azurerm resources of a state or plan into the estate; the number read. */
export function readTerraform(estate: Estate, doc: Obj): number {
  const plan = isObj(doc.planned_values);
  estate.sources.add(plan ? 'plan' : 'state');
  const all: Resource[] = [];
  readResources(plan ? (doc.planned_values as Obj).root_module : isObj(doc.values) ? doc.values.root_module : undefined, all);
  const changes = new Map<string, Change>();
  for (const c of Array.isArray(doc.resource_changes) ? doc.resource_changes.filter(isObj) : []) {
    const change = isObj(c.change) ? c.change : {};
    const what = changeOf(change.actions);
    if (!what || !str(c.address)) continue;
    changes.set(String(c.address), what);
    // Gone after the plan: only what was there before says what it was.
    if (what === 'delete' && str(c.type)?.startsWith('azurerm_') && isObj(change.before)) {
      const address = String(c.address);
      const config = address.replace(/\[[^\]]*\]/g, '');
      all.push({ address, config, type: String(c.type), name: String(c.name), key: c.index == null ? undefined : String(c.index), module: str(c.module_address) ?? '', values: change.before, refs: new Map() });
    }
  }
  const config = new Map<string, Map<string, string[]>>();
  if (isObj(doc.configuration) && isObj(doc.configuration.root_module)) readConfig({ module: doc.configuration.root_module, prefix: '', variable: () => [] }, config);
  const az = all.filter((r) => r.type.startsWith('azurerm_')).sort((a, b) => (a.address < b.address ? -1 : 1));
  link(az, config);
  const at = new Map(az.map((r) => [r.address, r]));

  // Subscription: from any id that is known; a plan's new resources are in the same one as the rest.
  const subs = new Set(az.map((r) => /^\/subscriptions\/([^/]+)/i.exec(str(r.values.id) ?? '')?.[1]?.toLowerCase()).filter(Boolean) as string[]);
  const sub = subs.size === 1 ? [...subs][0]! : subs.size ? undefined : '(subscription)';
  const rgSub = new Map<string, string>();
  for (const r of az) {
    const m = /^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)/i.exec(str(r.values.id) ?? '');
    if (m) rgSub.set(m[2]!.toLowerCase(), m[1]!.toLowerCase());
  }
  const rgId = (rg: string) => `/subscriptions/${rgSub.get(rg.toLowerCase()) ?? sub ?? '(subscription)'}/resourceGroups/${rg}`;

  /** The resource id: as the state has it, else made the way Azure makes it. */
  const ids = new Map<string, string>();
  const idOf = (r: Resource, depth = 0): string | undefined => {
    if (ids.has(r.address)) return ids.get(r.address);
    const known = str(r.values.id);
    if (known && /^\/subscriptions\//i.test(known)) return ids.set(r.address, known).get(r.address);
    const short = r.type.slice('azurerm_'.length);
    const type = TYPES[short];
    const name = str(r.values.name) ?? r.name;
    if (!type || depth > 4) return undefined;
    const ref = (attr: string) => {
      const v = str(r.values[attr]);
      if (v && /^\/subscriptions\//i.test(v)) return v;
      const to = [...(r.refs.get(attr) ?? [])].map((a) => at.get(a)).find(Boolean);
      return to && idOf(to, depth + 1);
    };
    const [ns, ...kinds] = type.split('/');
    const provider = `providers/${{ 'microsoft.network': 'Microsoft.Network', 'microsoft.web': 'Microsoft.Web', 'microsoft.sql': 'Microsoft.Sql', 'microsoft.cdn': 'Microsoft.Cdn' }[ns!] ?? ns}`;
    let id: string | undefined;
    if (short === 'subnet') {
      const rg = str(r.values.resource_group_name);
      const vnet = str(r.values.virtual_network_name);
      id = rg && vnet ? `${rgId(rg)}/${provider}/virtualNetworks/${vnet}/subnets/${name}` : undefined;
    } else if (/^(mssql|sql)_database$/.test(short)) id = ref('server_id') ? `${ref('server_id')}/databases/${name}` : undefined;
    else if (short === 'cdn_frontdoor_origin') id = ref('cdn_frontdoor_origin_group_id') ? `${ref('cdn_frontdoor_origin_group_id')}/origins/${name}` : undefined;
    else if (short === 'cdn_frontdoor_origin_group' || short === 'cdn_frontdoor_endpoint') id = ref('cdn_frontdoor_profile_id') ? `${ref('cdn_frontdoor_profile_id')}/${kinds.at(-1)}/${name}` : undefined;
    else {
      const rg = str(r.values.resource_group_name);
      id = rg ? `${rgId(rg)}/${provider}/${kinds.join('/')}/${name}` : undefined;
    }
    if (id) ids.set(r.address, id);
    return id;
  };

  let n = 0;
  const made = new Map<string, AzResource>();
  for (const r of az) {
    const short = r.type.slice('azurerm_'.length);
    const type = TYPES[short];
    const id = type && idOf(r);
    if (!type || !id) continue;
    const v = r.values;
    const res = estate.resource(id, { type, name: str(v.name) ?? r.name, location: str(v.location), change: changes.get(r.address) });
    made.set(r.address, res);
    n++;
    details(res, short, v);
    // Ids in values (a state), and what a plan's configuration refers to.
    walkRefs(Object.fromEntries(Object.entries(v).filter(([k]) => !/^(id|tags|resource_group_name|location|name)$/.test(k))), res);
    for (const [path, targets] of r.refs)
      for (const a of targets) {
        const to = at.get(a);
        const tid = to && idOf(to);
        if (tid && !res.refs.some((x) => x.id.toLowerCase() === tid.toLowerCase() && x.path === path)) res.refs.push({ path, id: tid });
      }
    // Subnets inside a network block.
    if (short === 'virtual_network')
      for (const s of many(v.subnet)) {
        const name = str(s.name);
        if (!name) continue;
        const sr = estate.resource(str(s.id) ?? `${id}/subnets/${name}`, { type: 'microsoft.network/virtualnetworks/subnets', name, cidr: strings(s.address_prefixes ?? s.address_prefix).join(', ') || undefined });
        if (str(s.security_group)) sr.refs.push({ path: 'networkSecurityGroup.id', id: str(s.security_group)! });
      }
  }
  // Resources that only join two others, routes and peerings: on the one they belong to.
  const target = (r: Resource, attr: string): string | undefined => {
    const v = str(r.values[attr]);
    if (v && /^\/subscriptions\//i.test(v)) return v;
    const to = [...(r.refs.get(attr) ?? [])].map((a) => at.get(a)).find(Boolean);
    return to && idOf(to);
  };
  const byName = (type: string, rg: string | undefined, name: string | undefined) => (rg && name ? [...estate.resources.values()].find((x) => x.type === type && x.name === name && x.rg?.toLowerCase() === rg.toLowerCase()) : undefined);
  for (const r of az) {
    const short = r.type.slice('azurerm_'.length);
    const join = JOINS[short];
    if (join) {
      const on = target(r, join[0]);
      const to = target(r, join[2]);
      const res = on && estate.resolve(on);
      if (res && to) res.refs.push({ path: join[1], id: to });
      continue;
    }
    if (short === 'virtual_network_peering') {
      const vnet = byName('microsoft.network/virtualnetworks', str(r.values.resource_group_name), str(r.values.virtual_network_name));
      const remote = target(r, 'remote_virtual_network_id');
      if (vnet && remote) vnet.refs.push({ path: 'virtualNetworkPeerings.remoteVirtualNetwork.id', id: remote });
    } else if (short === 'route') {
      const table = byName('microsoft.network/routetables', str(r.values.resource_group_name), str(r.values.route_table_name));
      if (table && str(r.values.next_hop_in_ip_address)) table.hops.add(str(r.values.next_hop_in_ip_address)!);
    } else if (short === 'monitor_diagnostic_setting') {
      const on = target(r, 'target_resource_id');
      const workspace = target(r, 'log_analytics_workspace_id');
      if (on && workspace) {
        const d = estate.resource(`${on}/providers/Microsoft.Insights/diagnosticSettings/${str(r.values.name) ?? r.name}`, { type: 'microsoft.insights/diagnosticsettings', change: changes.get(r.address) });
        d.refs.push({ path: 'workspaceId', id: workspace });
      }
    }
  }
  return n;
}

/** What the drawing uses, from azurerm's attribute names. */
function details(r: AzResource, short: string, v: Obj): void {
  const cidr = strings(v.address_space ?? v.address_prefixes ?? v.address_prefix);
  if (cidr.length) r.cidr = cidr.join(', ');
  const tier = str(v.account_tier) && str(v.account_replication_type) ? `${str(v.account_tier)}_${str(v.account_replication_type)}` : undefined;
  r.sku ??= str(v.sku_name) ?? str(v.sku) ?? str(v.size) ?? str(v.vm_size) ?? tier ?? str(first(v.default_node_pool).vm_size);
  r.kind ??= /function_app$/.test(short) ? 'functionapp' : short === 'logic_app_standard' ? 'workflowapp' : str(v.kind);
  for (const k of ['default_hostname', 'default_host_name', 'vault_uri', 'login_server', 'fully_qualified_domain_name', 'primary_blob_endpoint', 'primary_web_endpoint', 'gateway_url', 'latest_revision_fqdn', 'fqdn', 'endpoint'])
    if (str(v[k])) {
      const h = hostOf(str(v[k])!);
      if (h) r.hosts.add(h);
    }
  for (const c of [...many(v.ip_configuration), ...many(v.frontend_ip_configuration)]) {
    if (str(c.private_ip_address)) r.ips.add(str(c.private_ip_address)!);
    if (str(c.public_ip_address_id)) r.public = true;
  }
  if (str(v.private_ip_address)) r.ips.add(str(v.private_ip_address)!);
  if (short === 'public_ip' && str(v.ip_address)) r.ips.add(str(v.ip_address)!);
  for (const p of many(v.backend_address_pool)) for (const x of [...strings(p.fqdns), ...strings(p.ip_addresses)]) r.backends.add(x.toLowerCase());
  for (const p of many(v.backend_pool)) for (const b of many(p.backend)) if (str(b.address)) r.backends.add(str(b.address)!.toLowerCase());
  if (short === 'cdn_frontdoor_origin' && str(v.host_name)) r.backends.add(str(v.host_name)!.toLowerCase());
  for (const route of many(v.route)) if (str(route.next_hop_in_ip_address)) r.hops.add(str(route.next_hop_in_ip_address)!);
  const connection = first(v.private_service_connection);
  if (strings(connection.subresource_names).length) r.groupIds = strings(connection.subresource_names);
  const delegated = many(v.delegation).flatMap((d) => many(d.service_delegation).map((s) => str(s.name))).find(Boolean);
  if (delegated) r.delegation = delegated;
  if (/^external$/i.test(str(v.virtual_network_type) ?? '')) r.public = true;
  if (str(v.type) && /gateway(_connection)?$/.test(short)) r.gatewayType = str(v.type);
  if (short === 'local_network_gateway' && strings(v.address_space).length) r.cidr = strings(v.address_space).join(', ');
}
