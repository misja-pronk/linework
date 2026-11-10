// The Azure CLI and Microsoft Graph as they are saved to files: `az role assignment list --all -o json`,
// `az role definition list`, `az ad group member list`, `az account list`, and Graph responses
// ({ "value": [...] }) for /groups, /users, /servicePrincipals, /directoryRoles,
// /roleManagement/directory/roleAssignments and entitlement management (access packages, their
// policies and assignments). Nothing is fetched: what a file names but does not contain stays a name.
import { Directory, tail } from './access-dir.ts';
import { isObj, str, type Obj } from './keep.ts';

export interface Notes {
  /** What a file turned out to be, and how many of it. */
  read(what: string, count: number): void;
  skip(why: string): void;
  warn(topic: string, message: string): void;
}

const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** bob_contoso.com#EXT#@kestrel.onmicrosoft.com → bob@contoso.com: a guest's own address. */
const guestAddress = (upn: string) => {
  const own = upn.split('#EXT#')[0]!;
  const at = own.lastIndexOf('_');
  return at < 0 ? own : `${own.slice(0, at)}@${own.slice(at + 1)}`;
};

/** A principal type as an assignment names it. */
const TYPES: Record<string, string> = { user: 'user', group: 'group', foreigngroup: 'group', serviceprincipal: 'service-principal', msi: 'managed-identity' };

/** P180D → 180 days. */
export function duration(iso: unknown): string | undefined {
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?)?$/.exec(str(iso) ?? '');
  if (!m) return undefined;
  const units = ['year', 'month', 'week', 'day', 'hour', 'minute'];
  const parts = m.slice(1).flatMap((n, i) => (Number(n) ? [`${Number(n)} ${units[i]}${Number(n) === 1 ? '' : 's'}`] : []));
  return parts.join(' ') || undefined;
}

/** A directory object of any sort (a member, an expanded principal) as a principal. */
export function directoryObject(dir: Directory, o: Obj): string | undefined {
  const type = (str(o['@odata.type']) ?? '').toLowerCase();
  const upn = str(o.userPrincipalName);
  const name = str(o.displayName);
  let kind: string | undefined;
  let caption: string | undefined;
  if (type.endsWith('.group') || 'securityEnabled' in o || 'groupTypes' in o) {
    const types = Array.isArray(o.groupTypes) ? o.groupTypes.map(String) : [];
    kind = types.includes('DynamicMembership') ? 'dynamic-group' : o.isAssignableToRole === true ? 'role-assignable-group' : types.includes('Unified') ? 'm365-group' : 'group';
    if (kind === 'dynamic-group') caption = str(o.membershipRule)?.replace(/\s+/g, ' ').slice(0, 60);
  } else if (type.endsWith('.serviceprincipal') || 'servicePrincipalType' in o) kind = str(o.servicePrincipalType) === 'ManagedIdentity' ? 'managed-identity' : 'service-principal';
  else if (type.endsWith('.user') || upn) kind = str(o.userType)?.toLowerCase() === 'guest' || upn?.includes('#EXT#') ? 'guest' : 'user';
  else if (type) return undefined; // a device, a contact: not something that holds a role here
  const p = dir.principal(o.id, { name: name ?? (upn && (upn.includes('#EXT#') ? guestAddress(upn) : upn)), kind, caption, found: true });
  if (!p) return undefined;
  for (const g of arr(o.memberOf)) if (directoryObject(dir, g)) dir.member(p.key, g.id);
  for (const m of arr(o.members)) if (directoryObject(dir, m)) dir.member(m.id, p.key);
  return p.key;
}

/** The group (or directory role) a members file is about, from where it is saved: group-members-<group>.json, groups/<group>/members.json. */
const membersOf = (path: string) =>
  /(?:^|[\\/])(?:groups?|directory-?roles?)[\\/]([^\\/]+)[\\/]members(?:\.json)?$/i.exec(path)?.[1] ?? /(?:^|[\\/])(?:(?:group|role|directory-?role)[-_])?members[-_]([^\\/]+?)(?:\.json)?$/i.exec(path)?.[1];

export class AzureReader {
  private pending: { of: string; members: Obj[]; path: string }[] = [];
  /** A directory role's own id in this tenant → the template everyone knows it by. */
  private roleObjects = new Map<string, string>();

  constructor(
    private dir: Directory,
    private warn: (topic: string, message: string) => void,
  ) {}

  /** One file. False when it is not something az or Graph writes. */
  file(path: string, json: unknown, note: Notes): boolean {
    const dir = this.dir;
    if (isObj(json) && Array.isArray(json.children) && /managementgroups/i.test(str(json.type) ?? '')) {
      note.read('management group tree', this.tree(json, undefined));
      return true;
    }
    // { "<group>": [members] }: all memberships in one file.
    if (isObj(json) && !('value' in json) && !('id' in json) && Object.values(json).length && Object.values(json).every(Array.isArray) && /member/i.test(path)) {
      for (const [of, members] of Object.entries(json)) this.pending.push({ of, members: arr(members), path });
      note.read('group memberships', Object.values(json).reduce((n: number, m) => n + (m as unknown[]).length, 0));
      return true;
    }
    const context = isObj(json) ? (str(json['@odata.context']) ?? '') : '';
    const items = Array.isArray(json) ? arr(json) : isObj(json) && Array.isArray(json.value) ? arr(json.value) : isObj(json) && json.id ? [json] : undefined;
    if (!items) return false;
    const any = (test: (x: Obj) => unknown) => items.some((x) => !!test(x));
    const props = (x: Obj) => (isObj(x.properties) ? x.properties : x);
    const name = path.split(/[\\/]/).pop()!.toLowerCase();

    if (any((x) => props(x).roleDefinitionId && props(x).principalId && props(x).scope)) {
      let n = 0;
      for (const x of items) {
        const a = props(x);
        const flat = 'principalName' in a;
        const type = TYPES[(str(a.principalType) ?? '').toLowerCase()];
        const principalName = str(a.principalName);
        // The CLI leaves the name empty when the principal is gone; the portal says "Identity not found".
        const kind = flat && !principalName ? 'unknown' : type === 'user' && principalName?.includes('#EXT#') ? 'guest' : type;
        const label = principalName && !GUID.test(principalName) ? (principalName.includes('#EXT#') ? guestAddress(principalName) : principalName) : undefined;
        dir.role(a.roleDefinitionId, a.roleDefinitionName);
        if (dir.assign(a.principalId, a.roleDefinitionId, dir.scope(a.scope), { name: label, kind })) n++;
      }
      note.read('role assignments', n);
    } else if (any((x) => x.roleDefinitionId && x.principalId && 'directoryScopeId' in x)) {
      let n = 0;
      for (const x of items) {
        if (isObj(x.principal)) directoryObject(dir, x.principal);
        if (isObj(x.roleDefinition)) dir.role(x.roleDefinition.templateId ?? x.roleDefinitionId, x.roleDefinition.displayName);
        if (dir.assign(x.principalId, this.roleObjects.get(tail(x.roleDefinitionId)!) ?? x.roleDefinitionId, dir.directory(x.directoryScopeId))) n++;
      }
      note.read('directory role assignments', n);
    } else if (any((x) => props(x).roleName && Array.isArray(props(x).permissions))) {
      for (const x of items) {
        const d = props(x);
        const role = dir.role(x.name ?? x.id, d.roleName);
        // Only a role of the tenant's own: what Contributor may do is in the documentation, and it is long.
        if (!role || !/custom/i.test(str(d.roleType ?? d.type) ?? '')) continue;
        const all = arr(d.permissions).flatMap((p) => [
          ...(Array.isArray(p.actions) ? p.actions.map(String) : []),
          ...(Array.isArray(p.notActions) ? p.notActions.map((a) => `not ${a}`) : []),
          ...(Array.isArray(p.dataActions) ? p.dataActions.map((a) => `data: ${a}`) : []),
          ...(Array.isArray(p.notDataActions) ? p.notDataActions.map((a) => `not data: ${a}`) : []),
        ]);
        role.permissions = all.slice(0, 12);
        if (all.length > 12) note.warn(`long:${role.key}`, `${role.name} has ${all.length} permissions: the first 12 are listed`);
      }
      note.read('role definitions', items.length);
    } else if (any((x) => Array.isArray(x.rolePermissions))) {
      for (const x of items) {
        dir.role(x.templateId ?? x.id, x.displayName);
        if (tail(x.templateId) && tail(x.id) !== tail(x.templateId)) this.roleObjects.set(tail(x.id)!, tail(x.templateId)!);
      }
      note.read('directory role definitions', items.length);
    } else if (any((x) => x.roleTemplateId)) {
      let n = 0;
      for (const x of items) {
        dir.role(x.roleTemplateId, x.displayName);
        if (tail(x.id)) this.roleObjects.set(tail(x.id)!, tail(x.roleTemplateId)!);
        for (const m of arr(x.members)) if (directoryObject(dir, m) && dir.assign(m.id, x.roleTemplateId, dir.directory())) n++;
      }
      note.read(n ? `directory roles, with ${n} member${n === 1 ? '' : 's'}` : 'directory roles', items.length);
    } else if (any((x) => 'allowedTargetScope' in x || 'requestApprovalSettings' in x || 'requestorSettings' in x)) {
      note.read('access package policies', items.filter((x) => this.policy(x)).length);
    } else if (any((x) => x.state && isObj(x.target) && (x.accessPackage || x.accessPackageId || /assignments/i.test(context + name)))) {
      let n = 0;
      for (const x of items) {
        if (str(x.state)?.toLowerCase() !== 'delivered') continue;
        const target = x.target as Obj;
        const pkg = dir.package(isObj(x.accessPackage) ? x.accessPackage.id : x.accessPackageId, isObj(x.accessPackage) ? { name: x.accessPackage.displayName } : {});
        const who = dir.principal(target.objectId, { name: str(target.displayName), kind: str(target.subjectType)?.toLowerCase() === 'serviceprincipal' ? 'service-principal' : 'user' });
        if (pkg && who && ++n) pkg.holders.add(who.key);
      }
      note.read('access package assignments', n);
    } else if (/catalogs/i.test(context) || any((x) => 'catalogType' in x)) {
      for (const x of items) dir.catalog(x.id, x.displayName);
      note.read('catalogs', items.length);
    } else if (/accessPackages/i.test(context) || /access-?packages?/.test(name) || any((x) => 'resourceRoleScopes' in x)) {
      for (const x of items) {
        const catalog = isObj(x.catalog) ? dir.catalog(x.catalog.id, x.catalog.displayName) : x.catalogId;
        const pkg = dir.package(x.id, { name: x.displayName, catalog });
        if (pkg) for (const g of arr(x.resourceRoleScopes ?? x.accessPackageResourceRoleScopes)) this.grant(pkg.key, g);
        for (const pol of arr(x.assignmentPolicies)) this.policy({ ...pol, accessPackage: { id: x.id } });
      }
      note.read('access packages', items.length);
    } else if (membersOf(path) && any((x) => x.id)) {
      this.pending.push({ of: membersOf(path)!, members: items, path });
      note.read(`members of ${membersOf(path)}`, items.length);
    } else if (/#groups/i.test(context) || any((x) => 'securityEnabled' in x || 'groupTypes' in x)) {
      for (const x of items) directoryObject(dir, { ...x, '@odata.type': '#microsoft.graph.group' });
      dir.listed.add('groups');
      note.read('groups', items.length);
    } else if (any((x) => 'servicePrincipalType' in x)) {
      for (const x of items) directoryObject(dir, x);
      dir.listed.add('service-principals');
      note.read('service principals', items.length);
    } else if (any((x) => 'userPrincipalName' in x)) {
      for (const x of items) directoryObject(dir, x);
      dir.listed.add('users');
      note.read('users', items.length);
    } else if (any((x) => /managementgroups/i.test(str(x.type) ?? ''))) {
      for (const x of items) {
        const p = props(x);
        const parent = isObj(p.parent) ? p.parent.id : isObj(p.details) && isObj(p.details.parent) ? p.details.parent.id : undefined;
        dir.describe(x.id, { name: x.displayName ?? p.displayName, parent });
      }
      note.read('management groups', items.length);
    } else if (any((x) => GUID.test(str(x.id) ?? '') && x.tenantId && x.name && ('state' in x || 'isDefault' in x))) {
      for (const x of items) dir.describe(`/subscriptions/${x.id}`, { name: x.name });
      note.read('subscriptions', items.length);
    } else if (any((x) => /^\/subscriptions\/[^/]+$/i.test(str(x.id) ?? '') && x.displayName)) {
      for (const x of items) dir.describe(x.id, { name: x.displayName });
      note.read('subscriptions', items.length);
    } else if (any((x) => /^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+(\/providers\/.+)?$/i.test(str(x.id) ?? ''))) {
      note.skip('a list of resources: their names are in the ids the role assignments carry, so it is not needed');
    } else if (any((x) => x['@odata.type'])) {
      note.skip('directory objects, but of which group? Save members as group-members-<group name or id>.json');
    } else return false;
    return true;
  }

  private tree(node: Obj, parent: string | undefined): number {
    this.dir.describe(node.id, { name: node.displayName ?? node.name, parent });
    return 1 + arr(node.children).reduce((n, c) => n + this.tree(c, str(node.id)), 0);
  }

  /** What a package gives: membership of a group, a role in an application, a place on a site. */
  private grant(pkg: string, g: Obj): void {
    const dir = this.dir;
    const role = isObj(g.role) ? g.role : (g.accessPackageResourceRole as Obj | undefined) ?? {};
    const scope = isObj(g.scope) ? g.scope : (g.accessPackageResourceScope as Obj | undefined) ?? {};
    const system = (str(scope.originSystem) ?? str(role.originSystem) ?? '').toLowerCase();
    const what = str(role.displayName) ?? 'Member';
    const grants = dir.packages.get(pkg)!.grants;
    if (system === 'aadgroup') {
      const group = dir.principal(scope.originId, { name: str(scope.displayName), kind: 'group' });
      if (!group) return;
      if (/owner/i.test(what)) this.warn(`owner:${pkg}:${group.key}`, `${dir.packages.get(pkg)!.name ?? 'An access package'} makes its holders owner of ${group.name ?? 'a group'}: drawn as nothing, since an owner is not a member`);
      else if (!grants.some((x) => x.principal === group.key)) grants.push({ principal: group.key, role: what });
      return;
    }
    const origin = str(scope.originId);
    if (!origin) return;
    const kind = system === 'aadapplication' ? 'app' : system === 'sharepointonline' ? 'sharepoint-site' : 'resource';
    const resource = dir.add(origin, { name: str(scope.displayName) ?? origin.split('/').filter(Boolean).pop()!, kind, level: 1 });
    if (!grants.some((x) => x.resource === resource && x.role === what)) grants.push({ resource, role: what });
  }

  /** Who may ask for a package, who says yes, for how long. */
  private policy(x: Obj): boolean {
    const dir = this.dir;
    const pkg = dir.package(isObj(x.accessPackage) ? x.accessPackage.id : x.accessPackageId);
    if (!pkg) {
      this.warn('policy-without-package', 'An assignment policy does not say which access package it is for: ask Graph for it with $expand=accessPackage');
      return false;
    }
    const subject = (s: Obj): { principal?: string; text?: string } => {
      const type = (str(s['@odata.type']) ?? '').toLowerCase();
      const name = str(s.description) ?? str(s.displayName);
      if (type.endsWith('requestormanager')) return { text: 'manager' };
      if (type.endsWith('groupmembers')) return { principal: dir.principal(s.groupId ?? s.id, { name, kind: 'group' })?.key, text: name };
      if (type.endsWith('singleuser')) return { principal: dir.principal(s.userId ?? s.id, { name, kind: 'user' })?.key, text: name };
      if (type.endsWith('connectedorganizationmembers')) return { principal: dir.principal(s.connectedOrganizationId ?? s.id, { name, kind: 'connected-org', found: true })?.key, text: name };
      return { text: name ?? (type.split('.').pop() || undefined) };
    };
    const requestorSettings = isObj(x.requestorSettings) ? x.requestorSettings : {};
    const targets = arr(x.specificAllowedTargets).length ? arr(x.specificAllowedTargets) : arr(requestorSettings.allowedRequestors);
    const approvalSettings = isObj(x.requestApprovalSettings) ? x.requestApprovalSettings : {};
    const stages = arr(approvalSettings.stages ?? approvalSettings.approvalStages);
    const approval = approvalSettings.isApprovalRequiredForAdd === false || approvalSettings.isApprovalRequired === false ? [] : stages.flatMap((s) => arr(s.primaryApprovers).slice(0, 1).map(subject));
    const review = isObj(x.reviewSettings) && x.reviewSettings.isEnabled !== false ? x.reviewSettings : undefined;
    const pattern = review && isObj(review.schedule) && isObj(review.schedule.recurrence) && isObj(review.schedule.recurrence.pattern) ? review.schedule.recurrence.pattern : undefined;
    const every = Number(pattern?.interval ?? 1);
    const months = /month/i.test(str(pattern?.type) ?? '') ? every : /year/i.test(str(pattern?.type) ?? '') ? every * 12 : undefined;
    const expiration = isObj(x.expiration) ? x.expiration : {};
    pkg.policies.push({
      requestors: targets.map((t) => subject(t).principal).filter((k): k is string => !!k),
      approval: approval.filter((a) => a.principal || a.text),
      duration: duration(expiration.duration) ?? (Number(x.durationInDays) ? `${Number(x.durationInDays)} days` : undefined),
      review: months === 1 ? 'monthly' : months === 3 ? 'quarterly' : months === 6 ? 'half-yearly' : months === 12 ? 'yearly' : months ? `every ${months} months` : pattern ? (/week/i.test(str(pattern.type) ?? '') ? 'weekly' : undefined) : (str(review?.recurrenceType)?.toLowerCase()),
      auto: isObj(x.automaticRequestSettings) && x.automaticRequestSettings.requestAccessForAllowedTargets === true ? true : undefined,
    });
    return true;
  }

  /** Members files name their group by where they are saved: now that every group is known, that name means something. */
  finish(): void {
    const dir = this.dir;
    const same = (a: string | undefined, b: string) => !!a && a.toLowerCase().replace(/[^a-z0-9]+/g, '-') === b.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    for (const { of, members, path } of this.pending) {
      const role = /role/i.test(path) ? (this.roleObjects.get(of.toLowerCase()) ?? [...dir.roles.values()].find((r) => same(r.name, of))?.key) : undefined;
      const group = role ? undefined : GUID.test(of) ? dir.principal(of, { kind: 'group' }) : [...dir.principals.values()].find((p) => /group/.test(p.kind ?? '') && same(p.name, of));
      if (!role && !group) {
        this.warn(`members:${of}`, `${path} lists the members of "${of}", which no other file names: left out. Add the groups (az ad group list) or name the file after the group's object id`);
        continue;
      }
      for (const m of members) {
        if (!directoryObject(dir, m)) continue;
        if (role) dir.assign(m.id, role, dir.directory());
        else dir.member(m.id, group!.key);
      }
    }
    this.pending = [];
  }
}
