// AzureHound (SpecterOps) output, as `azurehound list -o file.json` writes it:
//   { "data": [ { "kind": "AZUser", "data": {…} }, … ], "meta": { "type": "azure", "version": 5, "count": n } }
// Read after the collector's source at v3.1.3. It collects the whole directory, so a principal an
// assignment names and no AZUser, AZGroup or AZServicePrincipal describes is one that is gone.
import { directoryObject, type Notes } from './access-azure.ts';
import type { Directory } from './access-dir.ts';
import { isObj, str, type Obj } from './keep.ts';

const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

/** The records of an AzureHound file, or nothing when it is not one. */
export function houndRecords(json: unknown): Obj[] | undefined {
  const list = isObj(json) && Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : undefined;
  const records = list?.filter((x): x is Obj => isObj(x) && typeof x.kind === 'string' && /^AZ[A-Z]/.test(x.kind) && isObj(x.data));
  if (!records?.length) return undefined;
  if (isObj(json) && isObj(json.meta) && json.meta.type !== undefined && json.meta.type !== 'azure') return undefined;
  return records;
}

/** Kinds that say nothing about who reaches what: read past without a word. */
const QUIET = /^AZ(App|Device|Tenant|Role|GroupOwner|AppOwner|ServicePrincipalOwner|DeviceOwner|AppMember|AppRoleAssignment|FunctionApp|WebApp|LogicApp|AutomationAccount|ContainerRegistry|ManagedCluster|VM|VMScaleSet|StorageAccount|StorageContainer|KeyVault|KeyVaultAccessPolicy|ManagementGroupDescendant|[A-Za-z]+(Owner|UserAccessAdmin|Contributor|KVContributor|AvereContributor|VMContributor|AdminLogin|VMAdminLogin))$/;

export function readHound(dir: Directory, records: Obj[], note: Notes): void {
  const count = new Map<string, number>();
  const seen = (what: string, n = 1) => count.set(what, (count.get(what) ?? 0) + n);
  const unread = new Map<string, number>();
  // The directory first: assignments name principals by id only.
  for (const { kind, data } of records as { kind: string; data: Obj }[]) {
    if (kind === 'AZTenant') dir.tenant ??= str(data.displayName);
    else if (kind === 'AZUser') directoryObject(dir, { ...data, '@odata.type': '#microsoft.graph.user' }) && seen('users');
    else if (kind === 'AZGroup') directoryObject(dir, { ...data, '@odata.type': '#microsoft.graph.group' }) && seen('groups');
    else if (kind === 'AZServicePrincipal') directoryObject(dir, { ...data, '@odata.type': '#microsoft.graph.servicePrincipal' }) && seen('service principals');
    else if (kind === 'AZRole') dir.role(data.templateId ?? data.id, data.displayName);
    else if (kind === 'AZSubscription') dir.describe(data.id ?? `/subscriptions/${str(data.subscriptionId)}`, { name: data.displayName }), seen('subscriptions');
    else if (kind === 'AZManagementGroup') dir.describe(data.id, { name: isObj(data.properties) ? data.properties.displayName : data.displayName }), seen('management groups');
  }
  for (const what of ['users', 'groups', 'service-principals'] as const) dir.listed.add(what);
  for (const { kind, data } of records as { kind: string; data: Obj }[]) {
    if (kind === 'AZGroupMember') {
      for (const m of arr(data.members)) {
        const member = isObj(m.member) ? m.member : m;
        if (directoryObject(dir, member)) dir.member(member.id, m.groupId ?? data.groupId), seen('group memberships');
      }
    } else if (kind === 'AZManagementGroupDescendant') {
      // What is under a management group: subscriptions and other management groups, each with its parent.
      const p = isObj(data.properties) ? data.properties : {};
      const parent = isObj(p.parent) ? p.parent.id : undefined;
      const id = /subscriptions$/i.test(str(data.type) ?? '') && !/^\/subscriptions\//i.test(str(data.id) ?? '') ? `/subscriptions/${str(data.name)}` : data.id;
      dir.describe(id, { name: p.displayName ?? p.display_name, parent });
    } else if (kind === 'AZRoleAssignment') {
      // Directory roles: a role definition and who holds it.
      for (const a of arr(data.roleAssignments)) {
        if (isObj(a.roleDefinition)) dir.role(a.roleDefinition.templateId ?? a.roleDefinitionId, a.roleDefinition.displayName);
        if (isObj(a.principal)) directoryObject(dir, a.principal);
        if (dir.assign(a.principalId, a.roleDefinitionId ?? data.roleDefinitionId, dir.directory(a.directoryScopeId))) seen('directory role assignments');
      }
    } else if (/RoleAssignment$/.test(kind)) {
      // Roles on Azure scopes, listed per subscription, resource group, vault…: the same assignment turns
      // up under everything it reaches, so the scope it was made on is what counts.
      for (const item of arr(data.roleAssignments)) {
        const a = isObj(item.roleAssignment) ? item.roleAssignment : item;
        const p = isObj(a.properties) ? a.properties : a;
        const scope = str(p.scope) ?? str(a.id)?.split(/\/providers\/Microsoft\.Authorization\/roleAssignments\//i)[0];
        if (dir.assign(p.principalId, p.roleDefinitionId, dir.scope(scope || '/'))) seen('role assignments');
      }
    } else if (/^AZ(ResourceGroup)$/.test(kind)) {
      // Named by its id already.
    } else if (!/^AZ(Tenant|User|Group|ServicePrincipal|Role|Subscription|ManagementGroup)$/.test(kind) && !QUIET.test(kind) && !/Eligib/i.test(kind)) unread.set(kind, (unread.get(kind) ?? 0) + 1);
  }
  // Counted as assignments made, not as times they were listed.
  if (count.has('role assignments')) count.set('role assignments', [...dir.assignments.values()].filter((a) => !a.scope.startsWith('directory')).length);
  for (const [what, n] of count) note.read(what, n);
  if (unread.size) note.warn('hound-unread', `Not read from the AzureHound file: ${[...unread].map(([k, n]) => `${k} (${n})`).join(', ')}`);
  if (records.some((r) => /Eligib/i.test(String(r.kind)))) note.warn('hound-pim', 'Eligible (PIM) role assignments are not drawn: only what is active');
}
