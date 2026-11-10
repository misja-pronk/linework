// What runs where in Azure, from real exports → `type: azure`. Azure Resource Graph JSON, ARM templates
// (`az bicep build`) and `terraform show -json` of azurerm become one diagram: management groups,
// subscriptions, resource groups, networks and subnets as containers, the resources in the right one,
// and lines for what the export says goes where. Importing again over that diagram keeps what was
// changed by hand. Nothing is fetched: every file is read where it is.
import { config as azureType } from '@cartography/azure';
import { readTemplate, isParameters, isTemplate } from './azure-arm.ts';
import { Estate, normPath, TARGET_RG, TARGET_SUB, parseId, type AzContainer, type AzResource, type Change } from './azure-estate.ts';
import { graphRows, hasResources, onlyContainers, readGraph } from './azure-graph.ts';
import { hasAzurerm, readTerraform } from './azure-terraform.ts';
import type { ExportFile, ImportedExport } from './access.ts';
import type { MeshProblem } from './data-mesh.ts';
import { Kept, isObj, type Obj } from './keep.ts';
import { slug, Warnings } from './text.ts';

export interface AzureOptions {
  title?: string;
  /** The diagram an earlier import made: its ids, labels and hand-made entries are kept. */
  existing?: string;
  /** Also the plumbing: network interfaces, disks, security groups, public IPs, plans, identities. */
  all?: boolean;
  /** Only these subscriptions, by name or id; commas between several, * as a wildcard. */
  subscription?: string;
  /** Only these resource groups, by name; commas between several, * as a wildcard. */
  rg?: string;
  /** How deep containers go: 1 subscriptions, 2 resource groups, 3 networks and subnets too (the default). */
  depth?: number;
  /** Above this many resources in one container, three or more of a kind are one counted card. 12 when not given. */
  collapseAbove?: number;
}

const IMPORTED = 'imported';
/** The edge styles an import draws; a line of another style (or none) between imported entries was drawn by hand. */
const MINE = ['public', 'private', 'data', 'identity', 'management'];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- reading

function parse(files: ExportFile[], warn: Warnings) {
  const estate = new Estate();
  const read: ImportedExport['read'] = [];
  const skipped: ImportedExport['skipped'] = [];
  const problems: MeshProblem[] = [];
  const templates: { path: string; json: Obj }[] = [];
  const given: Obj = {};
  for (const f of files) {
    if (!/\.json$/i.test(f.path)) {
      skipped.push({ file: f.path, why: 'not a JSON file' });
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(f.text.replace(/^﻿/, ''));
    } catch (e) {
      problems.push({ file: f.path, message: `Not valid JSON: ${(e as Error).message}`, severity: 'error' });
      skipped.push({ file: f.path, why: 'not valid JSON' });
      continue;
    }
    const rows = graphRows(json);
    if (rows) {
      const n = readGraph(estate, rows);
      const what = onlyContainers(rows) ? 'subscriptions, resource groups and management groups' : rows.every((r) => /diagnosticsettings$/i.test(String(r.type))) ? 'diagnostic settings' : 'Resource Graph resources';
      read.push({ file: f.path, what, count: onlyContainers(rows) ? rows.length : n });
    } else if (isParameters(json)) {
      for (const [k, v] of Object.entries(json.parameters as Obj)) if (isObj(v) && 'value' in v) given[k] = v.value;
      read.push({ file: f.path, what: 'template parameters', count: Object.keys(json.parameters as Obj).length });
    } else if (isTemplate(json)) templates.push({ path: f.path, json });
    else if (isObj(json) && 'format_version' in json && (isObj(json.values) || isObj(json.planned_values))) {
      if (!hasAzurerm(json)) skipped.push({ file: f.path, why: 'Terraform without azurerm resources: carto import draws AWS and Google Cloud as a cloud diagram' });
      else read.push({ file: f.path, what: isObj(json.planned_values) ? 'Terraform plan' : 'Terraform state', count: readTerraform(estate, json) });
    } else skipped.push({ file: f.path, why: 'not an Azure export this reads' });
  }
  for (const t of templates) {
    const unresolved = new Set<string>();
    read.push({ file: t.path, what: 'ARM template', count: readTemplate(estate, t.json, given, {}, unresolved) });
    if (unresolved.size) warn.add(`${t.path}: some values are only known when it is deployed (${[...unresolved].slice(0, 5).join(', ')}${unresolved.size > 5 ? ', …' : ''}): a name made from one keeps the expression's words in {braces}`);
  }
  return { estate, read, skipped, problems };
}

/** Is this one file something the Azure importer reads? Resources, not only subscriptions or role assignments. */
export function isAzureExport(text: string): boolean {
  if (!/^\s*[[{]/.test(text)) return false;
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return false;
  }
  const rows = graphRows(json);
  if (rows) return hasResources(rows);
  if (isTemplate(json)) return true;
  return isObj(json) && 'format_version' in json && (isObj(json.values) || isObj(json.planned_values)) && hasAzurerm(json);
}

/** Subscriptions, resource groups and management groups as Resource Graph gives them (`resourcecontainers`): they name what an export of resources is in. */
export function isAzureContainers(text: string): boolean {
  try {
    const rows = graphRows(JSON.parse(text.replace(/^﻿/, '')));
    return !!rows && onlyContainers(rows);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- what is drawn

interface Spec {
  kind: string;
  caption?: string;
  /** Left out unless everything is asked for. */
  plumbing?: boolean;
}

/** Resource type → kind of the azure type. Types not here and not below are drawn as a plain service, and named in a warning. */
const KINDS: Record<string, Spec | ((r: AzResource) => Spec)> = {
  'microsoft.web/sites': (r) => (/functionapp/i.test(r.kind ?? '') ? { kind: 'function-app' } : /workflowapp/i.test(r.kind ?? '') ? { kind: 'logic-app', caption: 'Logic App (Standard)' } : { kind: 'app-service' }),
  'microsoft.web/staticsites': { kind: 'static-web-app' },
  'microsoft.web/serverfarms': { kind: 'app-service-plan', plumbing: true },
  'microsoft.app/containerapps': { kind: 'container-app' },
  'microsoft.app/jobs': { kind: 'container-app', caption: 'Container Apps job' },
  'microsoft.app/managedenvironments': { kind: 'service', caption: 'Container Apps environment', plumbing: true },
  'microsoft.containerservice/managedclusters': { kind: 'aks' },
  'microsoft.compute/virtualmachines': { kind: 'vm' },
  'microsoft.compute/virtualmachinescalesets': { kind: 'vmss' },
  'microsoft.compute/disks': { kind: 'disk', plumbing: true },
  'microsoft.containerregistry/registries': { kind: 'container-registry' },
  'microsoft.sql/servers': { kind: 'sql-server' },
  'microsoft.sql/servers/databases': { kind: 'sql-database', plumbing: true },
  'microsoft.sql/managedinstances': { kind: 'sql-server', caption: 'SQL Managed Instance' },
  'microsoft.dbforpostgresql/flexibleservers': { kind: 'postgres' },
  'microsoft.dbforpostgresql/servers': { kind: 'postgres' },
  'microsoft.dbformysql/flexibleservers': { kind: 'mysql' },
  'microsoft.dbformysql/servers': { kind: 'mysql' },
  'microsoft.documentdb/databaseaccounts': { kind: 'cosmos-db' },
  'microsoft.storage/storageaccounts': { kind: 'storage' },
  'microsoft.cache/redis': { kind: 'redis' },
  'microsoft.cache/redisenterprise': { kind: 'redis' },
  'microsoft.keyvault/vaults': { kind: 'key-vault' },
  'microsoft.keyvault/managedhsms': { kind: 'key-vault', caption: 'Managed HSM' },
  'microsoft.servicebus/namespaces': { kind: 'service-bus' },
  'microsoft.eventhub/namespaces': { kind: 'event-hub' },
  'microsoft.eventgrid/topics': { kind: 'event-grid' },
  'microsoft.eventgrid/systemtopics': { kind: 'event-grid', caption: 'Event Grid system topic' },
  'microsoft.eventgrid/domains': { kind: 'event-grid', caption: 'Event Grid domain' },
  'microsoft.eventgrid/namespaces': { kind: 'event-grid' },
  'microsoft.apimanagement/service': { kind: 'api-management' },
  'microsoft.logic/workflows': { kind: 'logic-app' },
  'microsoft.datafactory/factories': { kind: 'data-factory' },
  'microsoft.cognitiveservices/accounts': (r) => (/openai|aiservices/i.test(r.kind ?? '') ? { kind: 'openai' } : { kind: 'openai', caption: `AI services${r.kind ? ` · ${r.kind}` : ''}` }),
  'microsoft.search/searchservices': { kind: 'ai-search' },
  'microsoft.cdn/profiles': (r) => (/azurefrontdoor/i.test(r.sku ?? '') || !r.sku ? { kind: 'front-door' } : { kind: 'front-door', caption: 'CDN profile' }),
  'microsoft.network/frontdoors': { kind: 'front-door', caption: 'Front Door (classic)' },
  'microsoft.network/applicationgateways': { kind: 'app-gateway' },
  'microsoft.network/loadbalancers': { kind: 'load-balancer' },
  'microsoft.network/virtualnetworkgateways': (r) => (/expressroute/i.test(r.gatewayType ?? '') ? { kind: 'expressroute', caption: 'ExpressRoute gateway' } : { kind: 'vpn-gateway' }),
  'microsoft.network/expressroutecircuits': { kind: 'expressroute', caption: 'ExpressRoute circuit' },
  'microsoft.network/localnetworkgateways': { kind: 'external', caption: 'On-premises network' },
  'microsoft.network/virtualhubs': { kind: 'vpn-gateway', caption: 'Virtual WAN hub' },
  'microsoft.network/virtualwans': { kind: 'service', caption: 'Virtual WAN' },
  'microsoft.network/privateendpoints': { kind: 'private-endpoint' },
  'microsoft.network/dnszones': { kind: 'dns' },
  'microsoft.network/privatednszones': { kind: 'dns', caption: 'Private DNS zone' },
  'microsoft.network/dnsresolvers': { kind: 'dns', caption: 'DNS private resolver' },
  'microsoft.network/applicationgatewaywebapplicationfirewallpolicies': { kind: 'firewall', caption: 'WAF policy', plumbing: true },
  'microsoft.network/frontdoorwebapplicationfirewallpolicies': { kind: 'firewall', caption: 'WAF policy', plumbing: true },
  'microsoft.network/azurefirewalls': { kind: 'firewall' },
  'microsoft.network/firewallpolicies': { kind: 'firewall', caption: 'Firewall policy', plumbing: true },
  'microsoft.network/bastionhosts': { kind: 'bastion' },
  'microsoft.network/natgateways': { kind: 'nat-gateway' },
  'microsoft.network/networksecuritygroups': { kind: 'nsg', plumbing: true },
  'microsoft.network/routetables': { kind: 'route-table', plumbing: true },
  'microsoft.network/networkinterfaces': { kind: 'nic', plumbing: true },
  'microsoft.network/publicipaddresses': { kind: 'public-ip', plumbing: true },
  'microsoft.network/ddosprotectionplans': { kind: 'service', caption: 'DDoS protection plan', plumbing: true },
  'microsoft.managedidentity/userassignedidentities': { kind: 'managed-identity', plumbing: true },
  'microsoft.operationalinsights/workspaces': { kind: 'log-analytics' },
  'microsoft.insights/components': { kind: 'app-insights' },
  'microsoft.recoveryservices/vaults': { kind: 'service', caption: 'Recovery Services vault' },
  'microsoft.databricks/workspaces': { kind: 'data-factory', caption: 'Databricks workspace' },
  'microsoft.synapse/workspaces': { kind: 'data-factory', caption: 'Synapse workspace' },
  'microsoft.machinelearningservices/workspaces': { kind: 'openai', caption: 'Machine Learning workspace' },
  'microsoft.signalrservice/signalr': { kind: 'service', caption: 'SignalR' },
  'microsoft.signalrservice/webpubsub': { kind: 'service', caption: 'Web PubSub' },
  'microsoft.automation/automationaccounts': { kind: 'service', caption: 'Automation account' },
  'microsoft.purview/accounts': { kind: 'service', caption: 'Purview' },
};

/** Not drawn and not worth a warning: what is in the picture already (networks), or says nothing about the architecture. */
const QUIET = new RegExp(
  '^microsoft\\.(' +
    [
      'network/virtualnetworks(/subnets)?',
      'network/connections',
      'network/networkwatchers(/.*)?',
      'network/privatednszones/.*',
      'insights/(diagnosticsettings|actiongroups|metricalerts|scheduledqueryrules|activitylogalerts|workbooks|datacollectionrules|datacollectionendpoints|webtests)',
      'alertsmanagement/.*',
      'portal/dashboards',
      'operationsmanagement/solutions',
      'operationalinsights/workspaces/.*',
      'authorization/.*',
      'resources/(deployments|deploymentscripts|templatespecs.*)',
      'compute/(virtualmachines/extensions|sshpublickeys|restorepointcollections|snapshots|images|galleries.*)',
      'web/(certificates|connections)',
      'security/.*',
      'maintenance/.*',
      'managedidentity/userassignedidentities/.*',
      'devtestlab/schedules',
    ].join('|') +
    ')$',
);

/** managedClusters → Managed clusters: a readable caption for a type nobody listed. */
const words = (type: string) => {
  const s = type.split('/').pop()!.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const kindLabel = (kind: string) => azureType.nodeKinds[kind]?.label ?? kind;

/** A glob (rg-shop-*) or a list of them, as a test; case does not matter. */
function globs(text: string | undefined): ((s: string | undefined) => boolean) | undefined {
  const list = text?.split(',').map((x) => x.trim()).filter(Boolean);
  if (!list?.length) return undefined;
  const res = list.map((g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i'));
  return (s) => !!s && res.some((re) => re.test(s));
}

/** The diagram of a set of Azure exports. */
export function importAzure(files: ExportFile[], opts: AzureOptions = {}): ImportedExport {
  const warn = new Warnings();
  const parsed = parse(files, warn);
  return drawAzure(warn, parsed, opts);
}

type Rel = 'subnet' | 'target' | 'vm' | 'nic' | 'nsg' | 'route-table' | 'nat' | 'peer' | 'logs' | 'plan' | 'environment' | 'identity' | 'public-ip' | 'lb' | 'member' | 'gateway' | 'remote' | 'vault' | 'allow' | 'depends' | 'uses';

function relOf(path: string, from: AzResource, to: AzResource): Rel {
  const p = normPath(path);
  const t = to.type;
  if (/dependson/.test(p)) return 'depends';
  if (/networkacls|virtualnetworkrules|iprules|allowedsubnets/.test(p)) return 'allow';
  if (from.type === 'microsoft.network/connections') return /virtualnetworkgateway1/.test(p) ? 'gateway' : 'remote';
  if (t === 'microsoft.network/virtualnetworks/subnets') return 'subnet';
  if (/privatelinkserviceid|privateconnectionresourceid/.test(p)) return 'target';
  if (/remotevirtualnetwork/.test(p) && t === 'microsoft.network/virtualnetworks') return 'peer';
  if (/backendipconfigurations/.test(p)) return 'member';
  if (/(loadbalancer|applicationgateway)backendaddresspools/.test(p)) return 'lb';
  if (t === 'microsoft.compute/virtualmachines' && from.type === 'microsoft.network/networkinterfaces') return 'vm';
  if (t === 'microsoft.network/networkinterfaces') return 'nic';
  if (t === 'microsoft.network/networksecuritygroups') return 'nsg';
  if (t === 'microsoft.network/routetables') return 'route-table';
  if (t === 'microsoft.network/natgateways') return 'nat';
  if (t === 'microsoft.operationalinsights/workspaces') return 'logs';
  if (t === 'microsoft.web/serverfarms') return 'plan';
  if (t === 'microsoft.app/managedenvironments') return 'environment';
  if (t === 'microsoft.managedidentity/userassignedidentities') return 'identity';
  if (t === 'microsoft.network/publicipaddresses') return 'public-ip';
  if (t === 'microsoft.keyvault/vaults') return 'vault';
  return 'uses';
}

/** A drawn entry before it has an id. */
interface Item {
  key: string;
  group: boolean;
  kind: string;
  name: string;
  label: string;
  caption?: string;
  /** Key of what it is in. */
  in?: string;
  badges?: string[];
  /** Alternatives for an id when its name is taken: the name of what it is in, its kind. */
  else: string[];
}

const BADGE: Record<Change, string> = { create: '+ create', update: '~ update', replace: '± replace', delete: '− delete' };
/** What a plan does, also in colour, so it shows from across the room; the words say it without colour. */
const TONE: Record<string, string> = { '+ create': 'green', '~ update': 'amber', '± replace': 'amber', '− delete': 'rose' };

export function drawAzure(warn: Warnings, { estate, read, skipped, problems }: { estate: Estate } & Pick<ImportedExport, 'read' | 'skipped' | 'problems'>, opts: AzureOptions = {}): ImportedExport {
  const nothing = (message: string): ImportedExport => ({ yaml: '', warnings: [...warn.list, message], problems, read, skipped, summary: '' });
  const all = [...estate.resources.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  if (!all.length) return nothing('No Azure resources in these files: expected az graph query, az bicep build or terraform show -json output');

  // ---- what each resource is
  const unmapped = new Map<string, number>();
  const specOf = new Map<string, Spec>();
  const byKey = estate.resources;
  /** A part of a resource drawn as one (a database of a server, an origin of a Front Door): the resource. */
  const owner = (r: AzResource): AzResource => {
    if (r.type === 'microsoft.insights/diagnosticsettings') {
      const on = parseId(r.id).scope;
      const o = on && estate.resolve(on);
      return o ? owner(o) : r;
    }
    if (specOf.has(r.key) || r.type === 'microsoft.network/virtualnetworks/subnets' || r.type === 'microsoft.network/virtualnetworks') return r;
    const up = r.key.replace(/\/[^/]+\/[^/]+$/, '');
    const parent = up !== r.key && up.includes('/providers/') ? estate.resolve(up) : undefined;
    return parent && parent !== r ? owner(parent) : r;
  };
  for (const r of all) {
    const spec = KINDS[r.type];
    if (spec) specOf.set(r.key, typeof spec === 'function' ? spec(r) : spec);
  }
  for (const r of all) {
    if (specOf.has(r.key) || QUIET.test(r.type) || owner(r) !== r) continue;
    // A type nobody listed, with nothing above it to be a part of: a plain service, named by its type.
    specOf.set(r.key, { kind: 'service', caption: words(r.type) });
    unmapped.set(r.type, (unmapped.get(r.type) ?? 0) + 1);
  }
  if (unmapped.size) {
    const top = [...unmapped].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    warn.add(`${plural([...unmapped.values()].reduce((a, b) => a + b, 0), 'resource')} of types without a kind of their own, drawn as a plain service: ${top.slice(0, 8).map(([t, c]) => (c > 1 ? `${t} ×${c}` : t)).join(', ')}${top.length > 8 ? ', …' : ''}`);
  }
  const roles = all.filter((r) => /^microsoft\.authorization\/roleassignments$/.test(r.type)).length;
  if (roles) warn.add(`${plural(roles, 'role assignment')} left out: carto import reads az role assignment list as an access diagram`);

  // ---- relations, from the owner of each end
  const rels = new Map<string, { rel: Rel; to: AzResource; path: string }[]>();
  const relsOf = (r: AzResource) => rels.get(r.key) ?? [];
  let outside = 0;
  for (const r of all) {
    const from = owner(r);
    for (const ref of r.refs) {
      const hit = estate.resolve(ref.id);
      if (!hit) {
        // What Azure makes by itself (a private endpoint's network interface, a disk) is often not exported: not worth a word.
        if (!/\/(networkinterfaces|disks|publicipaddresses|userassignedidentities)\//i.test(ref.id)) outside++;
        continue;
      }
      const to = owner(hit);
      if (to === from) continue;
      const rel = r.type === 'microsoft.insights/diagnosticsettings' ? 'logs' : relOf(ref.path, r, hit.type === 'microsoft.network/virtualnetworks/subnets' ? hit : to);
      rels.set(from.key, [...(rels.get(from.key) ?? []), { rel, to: rel === 'subnet' ? hit : to, path: ref.path }]);
    }
    if (from !== r) {
      // A plan that changes a part (a Front Door origin, a database) changes what it is part of.
      if (r.change && !from.change && r.type !== 'microsoft.insights/diagnosticsettings') from.change = 'update';
      for (const b of r.backends) from.backends.add(b);
      for (const v of r.vaults) from.vaults.add(v);
    }
  }
  const relTo = (r: AzResource, rel: Rel) => relsOf(r).filter((x) => x.rel === rel).map((x) => x.to);

  // ---- which subscriptions and resource groups
  const subOk = globs(opts.subscription);
  const rgOk = globs(opts.rg);
  const subName = (r: AzResource) => (r.sub ? estate.containers.get(`/subscriptions/${r.sub}`)?.name : undefined);
  const chosen = (r: AzResource) => (!subOk || subOk(r.sub) || subOk(subName(r))) && (!rgOk || rgOk(r.rg));
  const vnetOf = (s: AzResource) => estate.resolve(s.key.replace(/\/subnets\/[^/]+$/, ''));
  const drawable = (r: AzResource) => specOf.has(r.key) && owner(r) === r && (opts.all || !specOf.get(r.key)!.plumbing);
  let picked = all.filter((r) => drawable(r) && chosen(r));
  if ((subOk || rgOk) && !picked.length) return nothing(`Nothing in ${[opts.subscription && `subscription ${opts.subscription}`, opts.rg && `resource group ${opts.rg}`].filter(Boolean).join(', ')}: the export has ${[...new Set(all.map((r) => r.rg).filter(Boolean))].slice(0, 6).join(', ')}`);
  if (subOk || rgOk) {
    // What the chosen resources lead to comes along, so a private endpoint's target or a gateway's backend is not cut off.
    const more = new Set<AzResource>();
    for (const r of picked) for (const x of relsOf(r)) if (drawable(x.to) && !chosen(x.to) && /target|lb|member|gateway|remote/.test(x.rel)) more.add(x.to);
    if (more.size) warn.add(`${plural(more.size, 'resource')} outside ${[opts.subscription, opts.rg].filter(Boolean).join(', ')} drawn too, since what is inside leads to them`);
    picked = [...picked, ...more];
  }
  const drawn = new Set(picked.map((r) => r.key));

  // ---- where each resource is: its subnet, through what it is attached with, else its resource group
  const hosts = new Map<string, AzResource>();
  const ips = new Map<string, AzResource>();
  for (const r of all) {
    for (const h of r.hosts) if (!hosts.has(h)) hosts.set(h, owner(r));
    for (const ip of r.ips) if (!ips.has(ip)) ips.set(ip, owner(r));
  }
  const nicsOf = (vm: AzResource) => [...relTo(vm, 'nic'), ...all.filter((n) => n.type === 'microsoft.network/networkinterfaces' && relTo(n, 'vm').includes(vm))];
  const vmOf = (nic: AzResource) => relTo(nic, 'vm')[0] ?? all.find((v) => v.type === 'microsoft.compute/virtualmachines' && relTo(v, 'nic').includes(nic));
  const subnetOf = (r: AzResource, depth = 0): AzResource | undefined => {
    if (depth > 3) return undefined;
    const direct = relTo(r, 'subnet').sort((a, b) => (a.key < b.key ? -1 : 1))[0];
    if (direct) return direct;
    // A machine sits where its network interface does; a container app where its environment does.
    for (const via of [...nicsOf(r), ...relTo(r, 'environment')]) {
      const s = subnetOf(via, depth + 1);
      if (s) return s;
    }
    return undefined;
  };
  const deep = (opts.depth ?? 3) >= 3;
  const vnets = new Set<string>();
  const homeSubnet = new Map<string, AzResource>();
  for (const r of picked) {
    const s = deep ? subnetOf(r) : undefined;
    if (!s) continue;
    homeSubnet.set(r.key, s);
    const v = vnetOf(s);
    if (v) vnets.add(v.key);
  }
  // Networks of the chosen resource groups, with their subnets, also when nothing is drawn in them.
  if (deep)
    for (const v of all.filter((x) => x.type === 'microsoft.network/virtualnetworks' && chosen(x))) vnets.add(v.key);
  const subnets = deep ? all.filter((s) => s.type === 'microsoft.network/virtualnetworks/subnets' && vnets.has(vnetOf(s)?.key ?? '')) : [];

  // ---- containers: management groups, subscriptions, resource groups; networks and subnets in them
  const items: Item[] = [];
  const containerKey = (r: AzResource) => (r.sub && r.rg ? `/subscriptions/${r.sub}/resourcegroups/${r.rg.toLowerCase()}` : r.sub ? `/subscriptions/${r.sub}` : undefined);
  const depth = Math.max(1, Math.min(3, opts.depth ?? 3));
  const placeIn = (key: string | undefined): string | undefined => {
    // Resource groups folded away (depth 1): what was in one is in its subscription.
    let k = key;
    while (k) {
      const c = estate.containers.get(k);
      if (!c) return undefined;
      if (c.kind !== 'resource-group' || depth >= 2) return k;
      k = c.parent;
    }
    return undefined;
  };
  const usedContainers = new Set<string>();
  const mark = (key: string | undefined) => {
    for (let k = key; k && !usedContainers.has(k); k = estate.containers.get(k)?.parent) usedContainers.add(k);
  };
  const homeOf = new Map<string, string | undefined>();
  for (const r of picked) {
    const s = homeSubnet.get(r.key);
    const home = s ? s.key : placeIn(containerKey(r));
    homeOf.set(r.key, home);
    if (!s) mark(home);
  }
  for (const v of vnets) mark(placeIn(containerKey(byKey.get(v)!)));
  // Management groups tell the story of a landing zone; above one subscription they are only a frame.
  if ([...usedContainers].filter((k) => estate.containers.get(k)?.kind === 'subscription').length < 2) for (const k of [...usedContainers]) if (estate.containers.get(k)?.kind === 'management-group') usedContainers.delete(k);
  const containers = [...usedContainers].map((k) => estate.containers.get(k)!).filter(Boolean);
  const isPlaceholder = (c: AzContainer) => c.key.endsWith(`/${TARGET_RG}`) || c.key === `/subscriptions/${TARGET_SUB}`;
  for (const c of containers) {
    const parent = c.parent && usedContainers.has(c.parent) && !(depth < 2 && c.kind === 'resource-group') ? c.parent : undefined;
    const label = !isPlaceholder(c) ? c.name : c.kind === 'resource-group' ? 'Target resource group' : 'Subscription';
    items.push({ key: c.key, group: true, kind: c.kind, name: isPlaceholder(c) ? label : c.name, label, caption: isPlaceholder(c) ? 'where the template is deployed' : undefined, in: parent, else: [c.kind] });
  }

  // Captions of subnets: range, security group, route out (through the firewall, where a route says so), delegation.
  const firewalls = all.filter((r) => r.type === 'microsoft.network/azurefirewalls');
  const DELEGATED: Record<string, string> = { 'microsoft.web/serverfarms': 'App Service', 'microsoft.dbforpostgresql/flexibleservers': 'PostgreSQL', 'microsoft.dbformysql/flexibleservers': 'MySQL', 'microsoft.databricks/workspaces': 'Databricks', 'microsoft.network/dnsresolvers': 'DNS resolver', 'microsoft.app/environments': 'Container Apps', 'microsoft.containerinstance/containergroups': 'Container Instances', 'microsoft.sql/managedinstances': 'SQL Managed Instance', 'microsoft.netapp/volumes': 'NetApp Files' };
  const short = (s: string | undefined) => s && (DELEGATED[s.toLowerCase()] ?? words(s));
  for (const v of [...vnets].map((k) => byKey.get(k)!)) {
    items.push({ key: v.key, group: true, kind: 'vnet', name: v.name, label: v.name, caption: v.cidr ? `Virtual network · ${v.cidr}` : undefined, in: placeIn(containerKey(v)), badges: v.change ? [BADGE[v.change]] : undefined, else: [v.rg ?? 'vnet', 'vnet'] });
  }
  for (const s of subnets) {
    const nsg = relTo(s, 'nsg')[0];
    const table = relTo(s, 'route-table')[0];
    const via = table && firewalls.find((f) => [...f.ips].some((ip) => table.hops.has(ip)));
    const parts = [s.cidr, nsg && `NSG ${nsg.name}`, via ? `UDR → ${via.name}` : table && `UDR ${table.name}`, s.delegation && `delegated to ${short(s.delegation)}`].filter(Boolean);
    items.push({ key: s.key, group: true, kind: 'subnet', name: s.name, label: s.name, caption: parts.length ? parts.join(' · ') : undefined, in: vnetOf(s)!.key, badges: s.change ? [BADGE[s.change]] : undefined, else: [vnetOf(s)!.name, 'subnet'] });
  }

  // ---- the resources
  const databases = (server: AzResource) => all.filter((d) => d.type === 'microsoft.sql/servers/databases' && d.key.startsWith(`${server.key}/`) && d.name.toLowerCase() !== 'master');
  const planOf = (app: AzResource) => relTo(app, 'plan')[0];
  const detail = (r: AzResource): string | undefined => {
    if (r.type === 'microsoft.sql/servers') {
      const dbs = databases(r);
      return dbs.length ? (dbs.length <= 3 ? dbs.map((d) => d.name).join(', ') : plural(dbs.length, 'database')) : undefined;
    }
    if (r.type === 'microsoft.web/sites') return planOf(r)?.sku ?? r.sku;
    if (r.type === 'microsoft.network/localnetworkgateways') return r.cidr;
    if (r.type === 'microsoft.cdn/profiles') return /premium/i.test(r.sku ?? '') ? 'Premium' : undefined;
    if (/^microsoft\.(storage|network\/(publicip|privateendpoints|privatednszones))/.test(r.type)) return undefined;
    return r.sku && !/^(standard|basic|default|free|pergb2018|standalone|s0)$/i.test(r.sku) ? r.sku.replace(/_/g, ' ') : undefined;
  };
  for (const r of picked) {
    const spec = specOf.get(r.key)!;
    const base = spec.caption ?? kindLabel(spec.kind);
    const extra = detail(r);
    const caption = extra ? `${base} · ${extra}` : spec.caption;
    items.push({ key: r.key, group: false, kind: spec.kind, name: r.name, label: r.name, caption, in: homeOf.get(r.key), badges: r.change ? [BADGE[r.change]] : undefined, else: [r.rg ?? spec.kind, spec.kind] });
  }
  const hidden = all.filter((r) => specOf.get(r.key)?.plumbing && owner(r) === r && chosen(r) && !opts.all && !(r.type === 'microsoft.sql/servers/databases' && r.name.toLowerCase() === 'master'));
  if (hidden.length) {
    const kinds = new Map<string, number>();
    for (const r of hidden) kinds.set(specOf.get(r.key)!.caption ?? kindLabel(specOf.get(r.key)!.kind), (kinds.get(specOf.get(r.key)!.caption ?? kindLabel(specOf.get(r.key)!.kind)) ?? 0) + 1);
    const name = (k: string, n: number) => k + (n > 1 ? (/s$/.test(k) ? 'es' : 's') : '');
    warn.add(`${plural(hidden.length, 'resource')} of plumbing left out (${[...kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${name(k, n)}`).join(', ')}): --all draws them`);
  }
  if (outside) warn.onceFor('outside', `${plural(outside, 'reference')} to resources that are not in these files left out: export those subscriptions too to see them`);

  // ---- lines
  type Line = { from: string; to: string; style: string; label?: string };
  const lines: Line[] = [];
  const isDrawn = (r: AzResource | undefined) => !!r && (drawn.has(r.key) || vnets.has(r.key));
  const line = (from: AzResource | undefined, to: AzResource | undefined, style: string, label?: string) => {
    if (!from || !to || from === to || !isDrawn(from) || !isDrawn(to)) return;
    lines.push({ from: from.key, to: to.key, style, ...(label ? { label } : {}) });
  };
  const inNetwork = (r: AzResource) => homeSubnet.has(r.key);
  const backendOf = (b: string): AzResource | undefined => {
    // A template's host name of something it deploys itself: {reference(<its id>).defaultHostName}.
    const ref = /reference\((\/subscriptions\/[^)]+)\)/i.exec(b)?.[1];
    const hit = ref ? (() => { const r = estate.resolve(ref); return r && owner(r); })() : (hosts.get(b) ?? ips.get(b));
    if (!hit) return undefined;
    // An IP of a network interface stands for its machine; without one, for what is drawn alone in its subnet (an AKS ingress).
    if (hit.type !== 'microsoft.network/networkinterfaces') return hit;
    const vm = vmOf(hit);
    if (vm) return vm;
    const s = subnetOf(hit);
    const there = s ? picked.filter((r) => homeSubnet.get(r.key) === s) : [];
    return there.length === 1 ? there[0] : hit;
  };
  const fronted = new Set<string>();
  for (const r of picked) {
    for (const x of relsOf(r)) {
      if (x.rel === 'target') line(r, x.to, 'private', r.groupIds?.[0]);
      else if (x.rel === 'vault') line(r, x.to, 'identity', 'secrets');
      else if (x.rel === 'logs') line(r, x.to, 'management', r.type === 'microsoft.insights/components' ? 'workspace' : 'diagnostics');
      else if (x.rel === 'member' && x.to.type === 'microsoft.network/networkinterfaces') line(r, vmOf(x.to) ?? x.to, 'private');
      else if (x.rel === 'lb') line(x.to, r.type === 'microsoft.network/networkinterfaces' ? (vmOf(r) ?? r) : r, 'private');
      else if (x.rel === 'vm' && opts.all) line(r, x.to, 'private');
      else if (x.rel === 'uses' && drawn.has(x.to.key) && !/microsoft\.network\/(virtualnetworks|publicipaddresses)/.test(x.to.type)) line(r, x.to, 'data');
    }
    // Load balancer pools of network interfaces: the machines behind them.
    if (r.type === 'microsoft.network/loadbalancers' || r.type === 'microsoft.network/applicationgateways')
      for (const nic of all.filter((n) => n.type === 'microsoft.network/networkinterfaces' && relTo(n, 'lb').includes(r))) line(r, vmOf(nic) ?? nic, 'private');
    // Gateways and Front Door: their backends, by host name or address.
    for (const b of r.backends) {
      const to = backendOf(b);
      if (!to) continue;
      if (to.type === 'microsoft.network/applicationgateways' || to.type === 'microsoft.network/publicipaddresses') fronted.add(to.key);
      const pip = to.type === 'microsoft.network/publicipaddresses' ? all.find((g) => g.type === 'microsoft.network/applicationgateways' && relTo(g, 'public-ip').includes(to)) : undefined;
      if (pip) fronted.add(pip.key);
      line(r, pip ?? to, r.type === 'microsoft.network/applicationgateways' && inNetwork(pip ?? to) ? 'private' : 'public');
    }
    for (const v of r.vaults) line(r, all.find((k) => k.type === 'microsoft.keyvault/vaults' && k.name.toLowerCase() === v), 'identity', 'secrets');
  }
  // Peerings, both ways said once; VPN and ExpressRoute connections.
  for (const v of vnets) for (const peer of relTo(byKey.get(v)!, 'peer')) if (!lines.some((l) => l.from === peer.key && l.to === v)) line(byKey.get(v), peer, 'private', 'peering');
  for (const c of all.filter((r) => r.type === 'microsoft.network/connections' && chosen(r))) {
    const kind = /expressroute/i.test(c.gatewayType ?? '') ? 'ExpressRoute' : /vnet2vnet/i.test(c.gatewayType ?? '') ? 'VNet-to-VNet' : 'S2S VPN';
    for (const to of relTo(c, 'remote')) line(relTo(c, 'gateway')[0], to, 'private', kind);
  }
  // The way in: Front Door, and what has a public frontend and nothing in front of it.
  const entry = picked.filter((r) => !fronted.has(r.key) && (r.type === 'microsoft.cdn/profiles' || r.type === 'microsoft.network/frontdoors' || (r.public && /applicationgateways|loadbalancers|apimanagement/.test(r.type))));
  if (entry.length) {
    items.push({ key: 'internet', group: false, kind: 'internet', name: 'internet', label: 'Internet', else: ['internet'] });
    drawn.add('internet');
    for (const r of entry) lines.push({ from: 'internet', to: r.key, style: 'public', label: 'HTTPS' });
  }

  // ---- many of a kind in one place: one counted card
  const limit = opts.collapseAbove ?? 12;
  const folded: string[] = [];
  const into = new Map<string, string>();
  const byHome = new Map<string | undefined, Item[]>();
  for (const it of items) if (!it.group && it.key !== 'internet') byHome.set(it.in, [...(byHome.get(it.in) ?? []), it]);
  // Private endpoints and private DNS zones come by the dozen and say the same each time: four in one place are one card, whatever else is there.
  const always = opts.collapseAbove === undefined ? new Set(['private-endpoint', 'dns']) : new Set<string>();
  for (const [home, list] of byHome) {
    if (list.length <= limit && !list.some((it) => always.has(it.kind) && list.filter((x) => x.kind === it.kind).length >= 4)) continue;
    const kinds = new Map<string, Item[]>();
    // Never what a plan changes: that is what the picture is for.
    for (const it of list) if (!it.badges) kinds.set(it.kind + (it.caption?.split(' · ')[0] ?? ''), [...(kinds.get(it.kind + (it.caption?.split(' · ')[0] ?? '')) ?? []), it]);
    const at = home ? items.find((i) => i.key === home) : undefined;
    const where = at?.kind === 'subnet' ? `${byKey.get(at.in!)?.name}/${at.name}` : at?.name;
    for (const same of kinds.values()) {
      if (same.length < 3 || (list.length <= limit && (!always.has(same[0]!.kind) || same.length < 4))) continue;
      const k = same[0]!;
      const what = k.caption?.split(' · ')[0] ?? kindLabel(k.kind);
      const key = `${home ?? ''}#${k.kind}#${what}`;
      items.push({ key, group: false, kind: k.kind, name: `${where?.replace('/', '-') ?? 'all'}-${slug(what).toLowerCase()}s`, label: `${same.length} × ${what}`, caption: pattern(same.map((s) => s.name)), in: home, else: ['all'] });
      for (const s of same) {
        into.set(s.key, key);
        items.splice(items.indexOf(s), 1);
      }
      folded.push(`${same.length} × ${what}${where ? ` in ${where}` : ''}`);
    }
  }
  if (folded.length) warn.add(`Many of a kind in one place, drawn as one counted card: ${folded.slice(0, 5).join(', ')}${folded.length > 5 ? ', …' : ''}. --collapse-above ${Math.max(limit, ...[...byHome.values()].map((l) => l.length))} draws each`);

  // ---- ids: readable, from the name. What an earlier import called something stays, so pins and hand edits hold.
  // Key Vault references and diagnostics are on nearly everything: a badge on the card, not a line across the picture.
  const badges = ['identity', 'management'].filter((s) => lines.some((l) => l.style === s));
  const kept = Kept.open('azure', opts.existing, { title: opts.title ?? titleOf(estate), subtitle: subtitleOf(estate), ...(badges.length ? { badges } : {}) });
  if (typeof kept === 'string') return { ...nothing(kept), problems: [...problems, { message: kept, severity: 'error' }] };
  if (kept.fresh && badges.length) (kept.doc.get('badges', true) as { flow: boolean }).flow = true;
  const before = { groups: kept.before('groups'), nodes: kept.before('nodes') };
  const was = (id: string): (Obj & { at: 'groups' | 'nodes' }) | undefined => (before.groups[id] ? { ...before.groups[id], at: 'groups' } : before.nodes[id] ? { ...before.nodes[id], at: 'nodes' } : undefined);
  const made = (e: Obj | undefined) => !!e && Array.isArray(e.tags) && e.tags.includes(IMPORTED);
  const used = new Set([...Object.keys(before.groups), ...Object.keys(before.nodes)]);
  const base = (it: Item) => slug(it.name.replace(/_/g, '-')).toLowerCase();
  const twice = new Set(items.map(base).filter((b, i, list) => list.indexOf(b) !== i));
  const tries = (it: Item) => [...(twice.has(base(it)) ? [] : [base(it)]), ...it.else.map((e) => `${base(it)}-${slug(e).toLowerCase()}`), `${base(it)}-${slug(it.else.at(-1)!).toLowerCase()}`];
  const idOf = new Map<string, string>();
  const byHand = new Set<string>();
  const sorted = [...items].sort((a, b) => (a.key < b.key ? -1 : 1));
  // An earlier id is claimed by the entry of the same kind and name first, then by one of the same kind.
  for (const pass of [true, false])
    for (const it of sorted) {
      if (idOf.has(it.key)) continue;
      const id = [base(it), ...tries(it)].find((t) => !used.has(`claimed:${t}`) && was(t) && was(t)!.kind === it.kind && (!pass || was(t)!.label === it.label || (was(t)!.label === undefined && t === base(it))));
      if (!id) continue;
      used.add(`claimed:${id}`);
      idOf.set(it.key, id);
      if (!made(was(id))) byHand.add(it.key);
    }
  for (const it of sorted) {
    if (idOf.has(it.key)) continue;
    const t = tries(it);
    let id = t.find((c) => !used.has(c));
    for (let n = 2; !id; n++) if (!used.has(`${t.at(-1)}-${n}`)) id = `${t.at(-1)}-${n}`;
    used.add(id);
    idOf.set(it.key, id);
  }
  const now = new Set(idOf.values());
  const gone = new Set<string>();
  for (const c of ['groups', 'nodes'] as const) for (const [id, e] of Object.entries(before[c])) if (made(e) && !now.has(id)) (kept.drop(c, id), gone.add(id));

  // In tree order: what something is in comes before it, then by kind and name.
  const order = (it: Item) => (it.group ? ['management-group', 'subscription', 'resource-group', 'vnet', 'subnet'].indexOf(it.kind) : 10);
  const tree: Item[] = [];
  const walk = (parent: string | undefined) => {
    const here = items.filter((x) => x.group && x.in === parent).sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name, 'en'));
    for (const g of here) (tree.push(g), walk(g.key));
  };
  walk(undefined);
  const groupRank = new Map(tree.map((g, i) => [g.key, i]));
  const nodes = items.filter((x) => !x.group).sort((a, b) => (groupRank.get(a.in ?? '') ?? -1) - (groupRank.get(b.in ?? '') ?? -1) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'en'));
  for (const it of [...tree, ...nodes]) {
    if (byHand.has(it.key)) continue;
    const id = idOf.get(it.key)!;
    const to = it.group ? 'groups' : 'nodes';
    const old = was(id);
    if (old && old.at !== to) kept.drop(old.at, id);
    const tags = [...new Set([IMPORTED, ...(Array.isArray(old?.tags) ? old.tags.map(String) : [])])];
    // The tone is the import's while it marks a change of a plan; one chosen by hand stays.
    const marked = !!it.badges || (Array.isArray(old?.badges) && old.badges.some((b) => String(b) in TONE));
    kept.put(to, id, { kind: it.kind, label: it.label, caption: it.caption, in: it.in && idOf.get(it.in), badges: it.badges, tone: it.badges ? TONE[it.badges[0]!] : undefined, tags }, ['kind', 'caption', 'in', 'badges', 'tags', ...(marked ? ['tone'] : [])]);
  }

  // Lines: those of a style the import speaks for, between what it made, follow it; any other one stays.
  const ends = new Map<string, unknown>();
  const at = (k: string) => idOf.get(into.get(k) ?? k);
  for (const l of lines) {
    const from = at(l.from);
    const to = at(l.to);
    // From or to a counted card, one label per line would say eight things at one place.
    if (into.has(l.from) || into.has(l.to)) delete l.label;
    if (!from || !to || from === to) continue;
    const same = [...ends.keys()].find((k) => k.startsWith(`${from} ${to} `) || k.startsWith(`${to} ${from} ${l.style} `));
    if (same) continue;
    ends.set(`${from} ${to} ${l.style} ${l.label ?? ''}`, { [`${from} -> ${to}`]: l.label ? { label: l.label, style: l.style } : { style: l.style } });
  }
  const sortedLines = [...ends].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, v]) => v);
  const ARROW = /^\s*([A-Za-z0-9_.-]+)\s*(?:<->|-->|\.\.>|->|--)\s*([A-Za-z0-9_.-]+)\s*$/;
  const endsOf = (e: unknown): { from: string; to: string; style?: string } | undefined => {
    const text = typeof e === 'string' ? e : isObj(e) ? Object.keys(e)[0] : undefined;
    const m = text && ARROW.exec(text);
    const v = isObj(e) ? Object.values(e)[0] : undefined;
    return m ? { from: m[1]!, to: m[2]!, style: isObj(v) && typeof v.style === 'string' ? v.style : undefined } : undefined;
  };
  const imported = (id: string) => now.has(id) && !byHand.has([...idOf].find(([, v]) => v === id)?.[0] ?? '');
  const old = Array.isArray(kept.old.edges) ? kept.old.edges : [];
  const fresh = new Set(sortedLines.map((l) => JSON.stringify(l)));
  const stay = old.filter((e) => {
    const x = endsOf(e);
    if (!x) return true;
    if (gone.has(x.from) || gone.has(x.to)) return false;
    if (fresh.has(JSON.stringify(e))) return true;
    return !(imported(x.from) || made(was(x.from))) || !(imported(x.to) || made(was(x.to))) || !MINE.includes(x.style ?? '');
  });
  const kept1 = new Set(stay.map((e) => JSON.stringify(e)));
  kept.list('edges', [...stay, ...sortedLines.filter((l) => !kept1.has(JSON.stringify(l)))]);
  kept.tidy(['groups', 'nodes']);

  const subs = containers.filter((c) => c.kind === 'subscription').length;
  const rgs = containers.filter((c) => c.kind === 'resource-group').length;
  const summary = [plural(all.filter((r) => specOf.has(r.key) && owner(r) === r).length, 'resource'), ...(subs ? [plural(subs, 'subscription')] : []), ...(rgs ? [plural(rgs, 'resource group')] : []), ...(vnets.size ? [plural(vnets.size, 'network')] : [])].join(', ') + `; ${plural(nodes.length, 'card')} drawn`;
  return { yaml: kept.text(), warnings: warn.list, problems, read, skipped, summary };
}

function titleOf(estate: Estate): string {
  const subs = [...estate.containers.values()].filter((c) => c.kind === 'subscription' && !/^Subscription( [0-9a-f]{8})?$/.test(c.name));
  return subs.length === 1 ? subs[0]!.name : 'Azure estate';
}

function subtitleOf(estate: Estate): string {
  const s = estate.sources;
  if (s.has('plan')) return 'From a Terraform plan';
  if (s.has('state')) return 'From Terraform state';
  if (s.has('arm')) return 'From an ARM template';
  return 'From Azure Resource Graph';
}

/** st-shop-01, st-shop-02 → st-shop-*: what the names share, cut where a word ends; else the first two and how many more. */
function pattern(names: string[]): string {
  const sorted = [...names].sort();
  const short = Math.min(...sorted.map((n) => n.length));
  let head = 0;
  while (head < short && sorted.every((n) => n[head] === sorted[0]![head])) head++;
  let tail = 0;
  while (tail < short - head && sorted.every((n) => n.at(-1 - tail) === sorted[0]!.at(-1 - tail))) tail++;
  const first = sorted[0]!;
  // Cut where a word ends (pe-shop-* rather than pe-shop-s*), unless the names have no words: stkestrel*.
  if (/[-_.]/.test(first.slice(0, head))) while (head > 0 && /[A-Za-z0-9]/.test(first[head - 1]!) && /[A-Za-z0-9]/.test(first[head] ?? '')) head--;
  if (head + tail >= 3) return `${first.slice(0, head)}*${tail ? first.slice(-tail) : ''}`;
  return `${sorted.slice(0, 2).join(', ')} and ${sorted.length - 2} more`;
}
