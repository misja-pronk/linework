// What an Azure export says, before it becomes a diagram: resources, keyed by their resource id, and the
// management groups, subscriptions and resource groups they are in. The readers (Resource Graph, ARM
// templates, Terraform) fill it in; azure.ts draws it. What one resource says about another is kept as
// the attribute it was found under and the id it names, so the drawing can tell a subnet from a target.
import { isObj, str, type Obj } from './keep.ts';

export type Change = 'create' | 'update' | 'delete' | 'replace';

export interface AzResource {
  /** The resource id, lower case. */
  key: string;
  /** The resource id as the export writes it. */
  id: string;
  /** The resource type, lower case: microsoft.web/sites, microsoft.network/virtualnetworks/subnets. */
  type: string;
  name: string;
  /** Subscription id, lower case. */
  sub?: string;
  rg?: string;
  location?: string;
  /** The `kind` Azure gives some types: functionapp, OpenAI. */
  kind?: string;
  sku?: string;
  /** Address space of a network, address prefix of a subnet, ranges of an on-premises network. */
  cidr?: string;
  /** Host names it answers on: a web app's default host, a vault's URI. */
  hosts: Set<string>;
  /** Private IP addresses it has: a network interface, a firewall. */
  ips: Set<string>;
  /** What it sends traffic on to, by host name or IP: the backends of a gateway, the origins of a Front Door. */
  backends: Set<string>;
  /** Key vaults it reads from, by name: Key Vault references in app settings. */
  vaults: Set<string>;
  /** Next hops of a route table. */
  hops: Set<string>;
  /** Attribute path (Azure's or Terraform's words) → the resource id it names. */
  refs: { path: string; id: string }[];
  /** A Private Link connection's sub-resource: blob, vault, sqlServer. */
  groupIds?: string[];
  /** A delegated subnet: the service it is delegated to. */
  delegation?: string;
  /** A gateway with a public frontend; an API Management or load balancer facing the internet. */
  public?: boolean;
  /** VPN or ExpressRoute: a virtual network gateway, a connection. */
  gatewayType?: string;
  /** In a Terraform plan: what the plan does to it. */
  change?: Change;
  /** Its name could not be worked out from the template: kept as the expression says it. */
  unresolved?: boolean;
}

export interface AzContainer {
  key: string;
  id: string;
  kind: 'management-group' | 'subscription' | 'resource-group';
  name: string;
  parent?: string;
}

/** /subscriptions/…/resourceGroups/…/providers/Namespace/type/name/child/name → its parts. Lower-case type, names as written. */
export function parseId(id: string): { sub?: string; rg?: string; type?: string; names: string[]; scope?: string } {
  const parts = id.split('/').filter(Boolean);
  const at = (i: number) => parts[i]?.toLowerCase();
  const out: { sub?: string; rg?: string; type?: string; names: string[]; scope?: string } = { names: [] };
  // An extension resource (diagnostic settings, a role assignment) names what it is on before its own provider.
  const last = parts.map((p) => p.toLowerCase()).lastIndexOf('providers');
  const first = parts.map((p) => p.toLowerCase()).indexOf('providers');
  if (last > first && first >= 0) out.scope = '/' + parts.slice(0, last).join('/');
  if (at(0) === 'subscriptions') out.sub = at(1);
  if (at(2) === 'resourcegroups') out.rg = parts[3];
  if (last >= 0 && parts[last + 1]) {
    let type = parts[last + 1]!.toLowerCase();
    for (let i = last + 2; parts[i]; i += 2) {
      type += '/' + parts[i]!.toLowerCase();
      if (parts[i + 1]) out.names.push(parts[i + 1]!);
    }
    out.type = type;
  } else if (out.rg && parts.length === 4) out.type = 'microsoft.resources/resourcegroups';
  else if (out.sub && parts.length === 2) out.type = 'microsoft.resources/subscriptions';
  return out;
}

export const isArmId = (s: string) => /^\/(subscriptions|providers)\/[^/]+/i.test(s);

/** Host name of a URL or a bare host: https://kv-shop.vault.azure.net/ → kv-shop.vault.azure.net. */
export function hostOf(s: string): string | undefined {
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?(?:[/?#].*)?$/i.exec(s.trim());
  return m && !/^\d+(\.\d+){3}$/.test(m[1]!) ? m[1]!.toLowerCase() : undefined;
}

/** Key vaults a value reads from: `@Microsoft.KeyVault(SecretUri=https://kv-shop.vault.azure.net/…)`, `VaultName=kv-shop`, or a vault URI. */
export function vaultsIn(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/https:\/\/([a-z0-9-]+)\.vault\.(?:azure\.net|usgovcloudapi\.net|azure\.cn)/gi)) out.push(m[1]!.toLowerCase());
  for (const m of s.matchAll(/VaultName=([a-z0-9-]+)/gi)) out.push(m[1]!.toLowerCase());
  return out;
}

/** An attribute path in a form both Azure's and Terraform's words reduce to: properties.subnet.id → subnetid, subnet_id → subnetid. */
export const normPath = (path: string) =>
  path
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')
    .replace(/(^|\.)properties(?=\.|$)/g, '')
    .replace(/[._-]/g, '');

export class Estate {
  resources = new Map<string, AzResource>();
  containers = new Map<string, AzContainer>();
  /** Where each resource was read from: Resource Graph, a template, Terraform state or a plan. */
  sources = new Set<'graph' | 'arm' | 'state' | 'plan'>();

  /** A resource; what was read about it before stays where this says nothing. */
  resource(id: string, fill: Partial<Omit<AzResource, 'key' | 'id'>> & { name?: string; type?: string }): AzResource {
    const key = id.toLowerCase().replace(/\/+$/, '');
    const parsed = parseId(id);
    let r = this.resources.get(key);
    if (!r) {
      r = {
        key,
        id: id.replace(/\/+$/, ''),
        type: (fill.type ?? parsed.type ?? 'unknown').toLowerCase(),
        name: fill.name ?? parsed.names.at(-1) ?? id.split('/').pop()!,
        sub: parsed.sub,
        rg: parsed.rg,
        hosts: new Set(),
        ips: new Set(),
        backends: new Set(),
        vaults: new Set(),
        hops: new Set(),
        refs: [],
      };
      this.resources.set(key, r);
    }
    for (const [k, v] of Object.entries(fill)) {
      if (v === undefined) continue;
      const was = (r as unknown as Obj)[k];
      if (was instanceof Set) for (const x of v as Iterable<string>) was.add(x);
      else if (Array.isArray(was)) was.push(...(v as unknown[]));
      else if (was === undefined || k === 'change') (r as unknown as Obj)[k] = v;
    }
    if (r.sub) this.subscription(r.sub);
    if (r.sub && r.rg) this.group(r.sub, r.rg);
    return r;
  }

  managementGroup(name: string, display?: string, parent?: string): string {
    const key = `/providers/microsoft.management/managementgroups/${name.toLowerCase()}`;
    const c = this.containers.get(key) ?? { key, id: `/providers/Microsoft.Management/managementGroups/${name}`, kind: 'management-group' as const, name: display ?? name };
    if (display) c.name = display;
    if (parent && parent.toLowerCase() !== name.toLowerCase()) c.parent = this.managementGroup(parent);
    this.containers.set(key, c);
    return key;
  }

  subscription(id: string, name?: string, parent?: string): string {
    const sub = id.toLowerCase();
    const key = `/subscriptions/${sub}`;
    const c = this.containers.get(key) ?? { key, id: `/subscriptions/${sub}`, kind: 'subscription' as const, name: /^[0-9a-f-]{36}$/.test(sub) ? `Subscription ${sub.slice(0, 8)}` : 'Subscription' };
    if (name) c.name = name;
    if (parent) c.parent = this.managementGroup(parent);
    this.containers.set(key, c);
    return key;
  }

  group(sub: string, name: string): string {
    const parent = this.subscription(sub);
    const key = `${parent}/resourcegroups/${name.toLowerCase()}`;
    if (!this.containers.has(key)) this.containers.set(key, { key, id: `/subscriptions/${sub}/resourceGroups/${name}`, kind: 'resource-group', name, parent });
    return key;
  }

  /** The resource an id names, or the one it is a part of: an IP configuration's id names its network interface. */
  resolve(id: string): AzResource | undefined {
    let key = id.toLowerCase().replace(/\/+$/, '');
    for (let i = 0; i < 8 && key.includes('/providers/'); i++) {
      const r = this.resources.get(key);
      if (r) return r;
      // Up one level: drop the last name and its type.
      key = key.replace(/\/[^/]+\/[^/]+$/, '');
    }
    return undefined;
  }
}

/**
 * Everything an ARM-shaped object (a Resource Graph row's `properties`, a template's resource) says
 * about other resources: ids under the attribute they are in, host names behind a gateway, vaults in
 * app settings. Also an object's keys, where Azure puts ids there (user-assigned identities).
 */
export function walkRefs(value: unknown, r: AzResource, path = ''): void {
  if (typeof value === 'string') {
    if (isArmId(value)) {
      if (value.toLowerCase() !== r.key) r.refs.push({ path, id: value });
    } else if (value.length < 4000) for (const v of vaultsIn(value)) r.vaults.add(v);
    return;
  }
  if (Array.isArray(value)) return value.forEach((x, i) => walkRefs(x, r, `${path}[${i}]`));
  if (!isObj(value)) return;
  for (const [k, v] of Object.entries(value)) {
    if (/^(tags|etag|provisioningState|resourceGuid)$/i.test(k)) continue;
    const at = path ? `${path}.${k}` : k;
    if (isArmId(k)) r.refs.push({ path: at, id: k });
    walkRefs(v, r, at);
  }
}

const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const props = (o: unknown): Obj => (isObj(o) && isObj(o.properties) ? o.properties : isObj(o) ? o : {});
const get = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((x, k) => (isObj(x) ? x[k] : undefined), o);

/**
 * Attributes that point back at what uses a resource, not at what it uses: a subnet lists the network
 * interfaces in it, a security group the subnets it is on. The other side says the same the right way round.
 */
const BACK: Record<string, string[]> = {
  'microsoft.network/virtualnetworks': ['subnets'],
  'microsoft.network/virtualnetworks/subnets': ['ipconfigurations', 'privateendpoints', 'ipconfigurationprofiles', 'serviceassociationlinks', 'resourcenavigationlinks', 'applicationgatewayipconfigurations'],
  'microsoft.network/networksecuritygroups': ['subnets', 'networkinterfaces'],
  'microsoft.network/routetables': ['subnets'],
  'microsoft.network/natgateways': ['subnets', 'publicipaddresses'],
  'microsoft.network/publicipaddresses': ['ipconfiguration', 'natgateway'],
  'microsoft.network/networkinterfaces': ['privateendpoint', 'privatelinkservice'],
  'microsoft.network/privateendpoints': ['networkinterfaces'],
  'microsoft.network/ddosprotectionplans': ['virtualnetworks'],
  'microsoft.web/serverfarms': [],
};

/** What an ARM-shaped resource says about itself that the drawing uses: ranges, hosts, backends, SKU. */
export function readDetails(r: AzResource, row: Obj): void {
  const p = props(row);
  const sku = isObj(row.sku) ? (str(row.sku.name) ?? str(row.sku.tier)) : str(row.sku);
  if (sku && !r.sku) r.sku = sku;
  if (str(row.kind) && !r.kind) r.kind = str(row.kind);
  if (str(row.location) && !r.location) r.location = str(row.location);
  const space = get(p, 'addressSpace.addressPrefixes') ?? get(p, 'localNetworkAddressSpace.addressPrefixes');
  if (Array.isArray(space) && space.length) r.cidr = space.map(String).join(', ');
  const prefix = str(p.addressPrefix) ?? (Array.isArray(p.addressPrefixes) ? p.addressPrefixes.map(String).join(', ') : undefined);
  if (prefix) r.cidr = prefix;
  for (const k of ['defaultHostName', 'defaultHostname', 'fqdn', 'fullyQualifiedDomainName', 'loginServer', 'gatewayUrl', 'vaultUri', 'latestRevisionFqdn', 'hostName', 'documentEndpoint', 'endpoint'])
    if (str(p[k]) && k !== 'hostName') {
      const h = hostOf(str(p[k])!);
      if (h) r.hosts.add(h);
    }
  for (const h of [...(Array.isArray(p.hostNames) ? p.hostNames : []), ...(isObj(p.primaryEndpoints) ? Object.values(p.primaryEndpoints) : []), get(p, 'configuration.ingress.fqdn'), get(p, 'dnsSettings.fqdn')]) {
    const host = typeof h === 'string' ? hostOf(h) : undefined;
    if (host) r.hosts.add(host);
  }
  for (const c of [...list(p.ipConfigurations), ...list(p.frontendIPConfigurations)]) {
    const ip = str(props(c).privateIPAddress);
    if (ip) r.ips.add(ip);
    if (isObj(props(c).publicIPAddress)) r.public = true;
  }
  if (str(p.ipAddress) && r.type === 'microsoft.network/publicipaddresses') r.ips.add(str(p.ipAddress)!);
  // Gateways and Front Door: where traffic goes on to.
  for (const pool of list(p.backendAddressPools)) for (const a of list(props(pool).backendAddresses)) for (const k of ['fqdn', 'ipAddress']) if (str(a[k])) r.backends.add(str(a[k])!.toLowerCase());
  for (const pool of list(p.backendPools)) for (const b of list(props(pool).backends)) if (str(b.address)) r.backends.add(str(b.address)!.toLowerCase());
  if (/\/origins$/.test(r.type) && str(p.hostName)) r.backends.add(str(p.hostName)!.toLowerCase());
  if (/^microsoft\.apimanagement\/service\/backends$/.test(r.type) && str(p.url)) r.backends.add(hostOf(str(p.url)!) ?? str(p.url)!);
  for (const route of list(p.routes)) if (str(props(route).nextHopIpAddress)) r.hops.add(str(props(route).nextHopIpAddress)!);
  for (const c of [...list(p.privateLinkServiceConnections), ...list(p.manualPrivateLinkServiceConnections)]) {
    const ids = props(c).groupIds;
    if (Array.isArray(ids) && ids.length) r.groupIds = ids.map(String);
  }
  const delegated = list(p.delegations).map((d) => str(props(d).serviceName)).find(Boolean);
  if (delegated) r.delegation = delegated;
  if (str(p.gatewayType)) r.gatewayType = str(p.gatewayType);
  if (str(p.connectionType)) r.gatewayType = str(p.connectionType);
  if (/^external$/i.test(str(p.virtualNetworkType) ?? '')) r.public = true;
  const back = BACK[r.type];
  walkRefs(back ? Object.fromEntries(Object.entries(p).filter(([k]) => !back.includes(k.toLowerCase()))) : p, r);
  // Some ids sit next to properties rather than in them.
  if (isObj(row.identity)) walkRefs(row.identity, r, 'identity');
  if (str(row.managedBy)) r.refs.push({ path: 'managedBy', id: str(row.managedBy)! });
}
