// What the access exports say, before it becomes a diagram: principals, scopes, roles, assignments and
// access packages, keyed by what the directory calls them (object ids, resource ids), not by diagram ids.
// The readers (az and Graph JSON, AzureHound) fill it in; access.ts writes the diagram.
import { str } from './keep.ts';

export interface DirPrincipal {
  /** The object id, lower case. */
  key: string;
  name?: string;
  kind?: string;
  caption?: string;
  /** Keys of the groups it is a direct member of. */
  memberOf: Set<string>;
  /** Seen as an object of the directory, not only named by an assignment. */
  found: boolean;
}

export interface DirScope {
  /** The resource id, lower case. */
  key: string;
  /** The resource id as the export writes it. */
  id: string;
  name: string;
  kind: string;
  caption?: string;
  parent?: string;
  /** 1 for management groups and subscriptions, 2 for resource groups, 3 and up for what is in them. */
  level: number;
}

export interface DirRole {
  key: string;
  name?: string;
  permissions?: string[];
}

export interface DirPolicy {
  requestors: string[];
  /** Approvers in order: a principal's key, or a text ("manager"). */
  approval: { principal?: string; text?: string }[];
  duration?: string;
  review?: string;
  auto?: boolean;
}

export interface DirPackage {
  key: string;
  name?: string;
  caption?: string;
  catalog?: string;
  grants: { principal?: string; resource?: string; role: string }[];
  policies: DirPolicy[];
  holders: Set<string>;
}

/** Role definition ids everyone has: Azure built-in roles and Entra directory role templates. An export of assignments alone names them by id only. */
const WELL_KNOWN: Record<string, string> = {
  '8e3af657-a8ff-443c-a75c-2fe8c4bcb635': 'Owner',
  'b24988ac-6180-42a0-ab88-20f7382dd24c': 'Contributor',
  'acdd72a7-3385-48ef-bd42-f606fba81ae7': 'Reader',
  '18d7d88d-d35e-4fb5-a5c3-7773c20a72d9': 'User Access Administrator',
  'f58310d9-a9f6-439a-9e8d-f62e7b41a168': 'Role Based Access Control Administrator',
  '00482a5a-887f-4fb3-b363-3b7fe8e74483': 'Key Vault Administrator',
  '4633458b-17de-408a-b874-0445c86b69e6': 'Key Vault Secrets User',
  'b86a8fe4-44ce-4948-aee5-eccb2c155cd7': 'Key Vault Secrets Officer',
  '21090545-7ca7-4776-b22c-e363652d74d2': 'Key Vault Reader',
  'ba92f5b4-2d11-453d-a403-e96b0029c9fe': 'Storage Blob Data Contributor',
  '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1': 'Storage Blob Data Reader',
  'b7e6dc6d-f1e8-4753-8033-0f276bb0955b': 'Storage Blob Data Owner',
  '17d1049b-9a84-46fb-8f53-869881c3d3ab': 'Storage Account Contributor',
  '9980e02c-c2be-4d73-94e8-173b1dc7cf3c': 'Virtual Machine Contributor',
  '4d97b98b-1d4f-4787-a291-c67834d212e7': 'Network Contributor',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d': 'AcrPull',
  '8311e382-0749-4cb8-b61a-304f252e45ec': 'AcrPush',
  'f1a07417-d97a-45cb-824c-7a7467783830': 'Managed Identity Operator',
  '749f88d5-cbae-40b8-bcfc-e573ddc772fa': 'Monitoring Contributor',
  '43d0d8ad-25c7-4714-9337-8ba259a9fe05': 'Monitoring Reader',
  '92aaf0da-9dab-42b6-94a3-d43ce8d16293': 'Log Analytics Contributor',
  '73c42c96-874c-492b-b04d-ab87d138a893': 'Log Analytics Reader',
  'de139f84-1756-47ae-9be6-808fbbe84772': 'Website Contributor',
  'fb1c8493-542b-48eb-b624-b4c8fea62acd': 'Security Admin',
  '39bc4728-0917-49c7-9d2c-d95423bc2eb4': 'Security Reader',
  '62e90394-69f5-4237-9190-012177145e10': 'Global Administrator',
  'f2ef992c-3afb-46b9-b7cf-a126ee74c451': 'Global Reader',
  'e8611ab8-c189-46e8-94e1-60213ab1f814': 'Privileged Role Administrator',
  'fe930be7-5e62-47db-91af-98c3a49a38b1': 'User Administrator',
  '9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3': 'Application Administrator',
  '158c047a-c907-4556-b7ef-446551a6b5f7': 'Cloud Application Administrator',
  '194ae4cb-b126-40b2-bd5b-6091b380977d': 'Security Administrator',
  '5d6b6bb7-de71-4623-b4af-96380a352509': 'Security Reader',
  '88d8e3e3-8f55-4a1e-953a-9b9898b8876b': 'Directory Readers',
  '9360feb5-f418-4baa-8175-e2a00bac4301': 'Directory Writers',
  'fdd7a751-b60b-444a-984c-02652fe8fa1c': 'Groups Administrator',
  '729827e3-9c14-49f7-bb1b-9608f156bbb8': 'Helpdesk Administrator',
  'b1be1c3e-b65d-4f19-8427-f6fa0d97feb9': 'Conditional Access Administrator',
  '7be44c8a-adaf-4e2a-84d6-ab2649e08a13': 'Privileged Authentication Administrator',
  'c4e39bd9-1100-46d3-8c65-fb160da0071f': 'Authentication Administrator',
  '29232cdf-9323-42fd-ade2-1d097af3e4de': 'Exchange Administrator',
  'f28a1f50-f6e7-4571-818b-6a12f2af6b6c': 'SharePoint Administrator',
  '69091246-20e8-4a56-aa4d-066075b2a7a8': 'Teams Administrator',
  '3a2c62db-5318-420d-8d74-23affee5d9d5': 'Intune Administrator',
  'b0f54661-2d74-4c50-afa3-1ec803f12efe': 'Billing Administrator',
  '17315797-102d-40b4-93e0-432062caca18': 'Compliance Administrator',
};

/** Resource types that have a kind of their own; the others are a plain resource with the type as caption. */
const TYPED: [RegExp, string, string][] = [
  [/^microsoft\.keyvault\/(vaults|managedhsms)$/, 'key-vault', 'Key Vault'],
  [/^microsoft\.storage\/storageaccounts$/, 'storage', 'Storage account'],
  [/^microsoft\.sql\/servers$/, 'database', 'SQL server'],
  [/^microsoft\.sql\/servers\/databases$/, 'database', 'SQL database'],
  [/^microsoft\.dbfor(postgresql|mysql|mariadb)\//, 'database', 'Database server'],
  [/^microsoft\.documentdb\/databaseaccounts$/, 'database', 'Cosmos DB account'],
  [/^microsoft\.compute\/virtualmachines$/, 'resource', 'Virtual machine'],
  [/^microsoft\.compute\/virtualmachinescalesets$/, 'resource', 'VM scale set'],
  [/^microsoft\.containerservice\/managedclusters$/, 'resource', 'Kubernetes cluster'],
  [/^microsoft\.containerregistry\/registries$/, 'resource', 'Container registry'],
  [/^microsoft\.web\/sites$/, 'resource', 'App Service'],
  [/^microsoft\.logic\/workflows$/, 'resource', 'Logic app'],
  [/^microsoft\.automation\/automationaccounts$/, 'resource', 'Automation account'],
  [/^microsoft\.network\/virtualnetworks$/, 'resource', 'Virtual network'],
  [/^microsoft\.operationalinsights\/workspaces$/, 'resource', 'Log Analytics workspace'],
  [/^microsoft\.managedidentity\/userassignedidentities$/, 'resource', 'Managed identity'],
];

/** managedClusters → Managed clusters: a readable caption for a type nobody listed. */
const words = (type: string) => {
  const s = type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const guid = (v: unknown) => str(v)?.toLowerCase();
/** The last part of an id: a role definition's GUID from its full resource id. */
export const tail = (v: unknown) => guid(v)?.split('/').filter(Boolean).pop();

/** The scope the directory's own roles are on. Not above subscriptions: a directory role grants nothing in Azure. */
export const DIRECTORY = 'directory';

export class Directory {
  principals = new Map<string, DirPrincipal>();
  scopes = new Map<string, DirScope>();
  roles = new Map<string, DirRole>();
  assignments = new Map<string, { principal: string; role: string; scope: string }>();
  packages = new Map<string, DirPackage>();
  catalogs = new Map<string, { key: string; name?: string }>();
  /** The listings that were given whole: a principal missing from one of these is gone, not merely unnamed. */
  listed = new Set<'users' | 'groups' | 'service-principals'>();
  tenant?: string;

  /** A principal by object id; what is given fills in what is not known yet. */
  principal(id: unknown, fill: { name?: string; kind?: string; caption?: string; found?: boolean } = {}): DirPrincipal | undefined {
    const key = guid(id);
    if (!key) return undefined;
    let p = this.principals.get(key);
    if (!p) this.principals.set(key, (p = { key, memberOf: new Set(), found: false }));
    // A directory object knows better than the name and type an assignment mentions.
    if (str(fill.name) && (!p.name || (fill.found && !p.found))) p.name = str(fill.name);
    if (fill.kind && (fill.found || !p.kind)) p.kind = fill.kind;
    p.caption ??= fill.caption;
    p.found ||= !!fill.found;
    return p;
  }

  member(member: unknown, group: unknown): void {
    const g = this.principal(group);
    const m = this.principal(member);
    if (g && m && g !== m) m.memberOf.add(g.key);
  }

  /** A scope that is not an Azure resource id: an application, a site, the directory. */
  add(id: string, s: Omit<DirScope, 'key' | 'id'>): string {
    const key = id.toLowerCase();
    if (!this.scopes.has(key)) this.scopes.set(key, { key, id, ...s });
    return key;
  }

  /** The scope an id names, with everything above it: /subscriptions/…/resourceGroups/…/providers/… becomes a tree. */
  scope(raw: unknown): string | undefined {
    const text = str(raw);
    if (!text) return undefined;
    const id = text.replace(/\/+$/, '') || '/';
    if (this.scopes.has(id.toLowerCase())) return id.toLowerCase();
    if (id === '/') return this.add('/', { name: 'Root', kind: 'tenant', caption: 'Everything in the tenant', level: 1 });
    const parts = id.split('/').filter(Boolean);
    const at = (i: number) => parts[i]?.toLowerCase();
    const upTo = (n: number) => '/' + parts.slice(0, n).join('/');
    if (at(0) === 'providers' && at(1) === 'microsoft.management' && at(2) === 'managementgroups' && parts[3])
      return this.add(upTo(4), { name: parts[3], kind: 'management-group', level: 1 });
    if (at(0) !== 'subscriptions' || !parts[1]) return this.add(id, { name: parts.at(-1)!, kind: 'resource', level: 3 });
    let parent = this.add(upTo(2), { name: `Subscription ${parts[1].slice(0, 8)}`, kind: 'subscription', level: 1 });
    let i = 2;
    if (at(i) === 'resourcegroups' && parts[i + 1]) {
      parent = this.add(upTo(i + 2), { name: parts[i + 1]!, kind: 'resource-group', parent, level: 2 });
      i += 2;
    }
    if (at(i) === 'providers' && parts[i + 1]) {
      let type = parts[i + 1]!;
      let level = 3;
      for (i += 2; parts[i] && parts[i + 1]; i += 2, level++) {
        type += '/' + parts[i];
        const known = TYPED.find(([re]) => re.test(type.toLowerCase()));
        parent = this.add(upTo(i + 2), { name: parts[i + 1]!, kind: known?.[1] ?? 'resource', caption: known?.[2] ?? words(parts[i]!), parent, level });
      }
    }
    return parent;
  }

  /** What an export knows about a scope beyond its id: its name, what it is in. */
  describe(raw: unknown, fill: { name?: unknown; parent?: unknown }): void {
    const key = this.scope(raw);
    const s = key && this.scopes.get(key);
    if (!s) return;
    const name = str(fill.name);
    if (name) s.name = name;
    const parent = fill.parent === undefined ? undefined : this.scope(fill.parent);
    if (parent && parent !== s.key) s.parent = parent;
  }

  /** The directory itself, for directory roles; and what one can be scoped to (an administrative unit, one application). */
  directory(scopeId?: unknown): string {
    const root = this.add(DIRECTORY, { name: this.tenant ?? 'Directory', kind: 'tenant', caption: 'Entra ID directory', level: 1 });
    const sub = str(scopeId);
    if (!sub || sub === '/') return root;
    const unit = /administrativeunits/i.test(sub);
    return this.add(`${DIRECTORY}/${sub.replace(/^\/+/, "")}`, { name: sub.split('/').filter(Boolean).pop()!.slice(0, 8), kind: 'resource', caption: unit ? 'Administrative unit' : 'Directory object', parent: root, level: 2 });
  }

  role(id: unknown, name?: unknown): DirRole | undefined {
    const key = tail(id);
    if (!key) return undefined;
    let r = this.roles.get(key);
    if (!r) this.roles.set(key, (r = { key, name: WELL_KNOWN[key] }));
    // What the export calls it wins over the list above: a tenant may have its own names.
    if (str(name)) r.name = str(name);
    return r;
  }

  /** One assignment, once: an export that lists what a scope inherits names the same one again and again. */
  assign(principal: unknown, role: unknown, scope: string | undefined, as: { name?: string; kind?: string } = {}): boolean {
    const p = this.principal(principal, as);
    const r = this.role(role);
    if (!p || !r || !scope) return false;
    this.assignments.set(`${p.key} ${r.key} ${scope}`, { principal: p.key, role: r.key, scope });
    return true;
  }

  package(id: unknown, fill: { name?: unknown; caption?: unknown; catalog?: unknown } = {}): DirPackage | undefined {
    const key = guid(id);
    if (!key) return undefined;
    let p = this.packages.get(key);
    if (!p) this.packages.set(key, (p = { key, grants: [], policies: [], holders: new Set() }));
    p.name ??= str(fill.name);
    p.caption ??= str(fill.caption);
    p.catalog ??= this.catalog(fill.catalog);
    return p;
  }

  catalog(id: unknown, name?: unknown): string | undefined {
    const key = guid(id);
    if (!key) return undefined;
    const c = this.catalogs.get(key) ?? { key };
    c.name ??= str(name);
    this.catalogs.set(key, c);
    return key;
  }
}
