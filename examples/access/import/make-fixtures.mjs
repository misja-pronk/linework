// Writes the fixtures in this folder: an invented tenant ("Kestrel Logistics") as the Azure CLI,
// Microsoft Graph and AzureHound would save it. Nothing here comes from a real tenant: every id is
// a hash of a name. Only the role definition ids are real, since those are the same for everyone.
//
//   node examples/access/import/make-fixtures.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const id = (name) => createHash('sha1').update(`kestrel:${name}`).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');
const save = (folder, file, data) => {
  mkdirSync(join(here, folder), { recursive: true });
  writeFileSync(join(here, folder, file), JSON.stringify(data, null, 2) + '\n');
};
const graph = (path, value) => ({ '@odata.context': `https://graph.microsoft.com/v1.0/$metadata#${path}`, value });

const TENANT = id('tenant');
const ROLE = {
  Owner: '8e3af657-a8ff-443c-a75c-2fe8c4bcb635',
  Contributor: 'b24988ac-6180-42a0-ab88-20f7382dd24c',
  Reader: 'acdd72a7-3385-48ef-bd42-f606fba81ae7',
  'Key Vault Secrets User': '4633458b-17de-408a-b874-0445c86b69e6',
  'Storage Blob Data Contributor': 'ba92f5b4-2d11-453d-a403-e96b0029c9fe',
  'Website Contributor': 'de139f84-1756-47ae-9be6-808fbbe84772',
  'Shop Operator': id('role Shop Operator'),
};
const DIRECTORY_ROLE = { 'Global Administrator': '62e90394-69f5-4237-9190-012177145e10', 'User Administrator': 'fe930be7-5e62-47db-91af-98c3a49a38b1' };

const sub = (name) => `/subscriptions/${id(`sub ${name}`)}`;
const mg = (name) => `/providers/Microsoft.Management/managementGroups/${name}`;
const rg = (s, name) => `${sub(s)}/resourceGroups/${name}`;
const SCOPE = {
  kestrel: mg('kestrel'),
  production: sub('Kestrel Production'),
  test: sub('Kestrel Test'),
  'rg-shop-prod': rg('Kestrel Production', 'rg-shop-prod'),
  'rg-data-prod': rg('Kestrel Production', 'rg-data-prod'),
  'rg-shop-test': rg('Kestrel Test', 'rg-shop-test'),
  'kv-shop-prod': `${rg('Kestrel Production', 'rg-shop-prod')}/providers/Microsoft.KeyVault/vaults/kv-shop-prod`,
  stkestreldata: `${rg('Kestrel Production', 'rg-data-prod')}/providers/Microsoft.Storage/storageAccounts/stkestreldata`,
};

const user = (name, guestOf) => {
  const mail = name.toLowerCase().replace(/ /g, '.');
  return {
    '@odata.type': '#microsoft.graph.user',
    id: id(`user ${name}`),
    displayName: guestOf ? `${name} (${guestOf})` : name,
    userPrincipalName: guestOf ? `${mail}_${guestOf.toLowerCase()}.example#EXT#@kestrel.example` : `${mail}@kestrel.example`,
    userType: guestOf ? 'Guest' : 'Member',
  };
};
const group = (name, more = {}) => ({ '@odata.type': '#microsoft.graph.group', id: id(`group ${name}`), displayName: name, securityEnabled: true, groupTypes: [], isAssignableToRole: null, ...more });
const sp = (name, type = 'Application') => ({ '@odata.type': '#microsoft.graph.servicePrincipal', id: id(`sp ${name}`), appId: id(`app ${name}`), displayName: name, servicePrincipalType: type });

/** The tenant at one moment; `later` is the same one a few weeks on. */
function tenant(later) {
  const users = ['Alice Jansen', 'Bram de Vries', 'Chen Wei', 'Dina Okafor', 'Emre Yilmaz', 'Fleur Bakker', ...(later ? ['Hugo Smit'] : [])].map((n) => user(n));
  const greta = user('Greta Lind', 'Northwind');
  users.push(greta);
  const U = Object.fromEntries(users.map((u) => [u.displayName.split(' ')[0], u]));
  const groups = [
    group('sg-platform-admins', { isAssignableToRole: true }),
    group('sg-developers'),
    group('sg-data-engineers'),
    group('sg-auditors'),
    group('All Engineering', { groupTypes: ['DynamicMembership'], membershipRule: 'user.department -eq "Engineering"' }),
  ];
  const G = Object.fromEntries(groups.map((g) => [g.displayName, g]));
  const sps = [sp('github-deploy-shop'), sp('id-shop-api', 'ManagedIdentity')];
  const members = {
    'sg-platform-admins': [U.Alice, U.Bram, ...(later ? [U.Hugo] : [])],
    'sg-developers': [U.Chen, U.Dina, ...(later ? [] : [U.Emre]), G['sg-data-engineers']],
    'sg-data-engineers': [U.Fleur, U.Dina],
    'sg-auditors': [greta],
  };
  const assign = (principal, type, role, scope, name) => ({
    id: `${SCOPE[scope]}/providers/Microsoft.Authorization/roleAssignments/${id(`ra ${principal.id} ${role} ${scope}`)}`,
    name: id(`ra ${principal.id} ${role} ${scope}`),
    principalId: principal.id,
    principalName: name ?? (type === 'User' ? principal.userPrincipalName : type === 'ServicePrincipal' ? principal.appId : principal.displayName),
    principalType: type,
    roleDefinitionId: `${/^\/subscriptions\/[^/]+/.exec(SCOPE[scope])?.[0] ?? ''}/providers/Microsoft.Authorization/roleDefinitions/${ROLE[role]}`,
    roleDefinitionName: role,
    scope: SCOPE[scope],
    type: 'Microsoft.Authorization/roleAssignments',
  });
  const assignments = [
    assign(G['sg-platform-admins'], 'Group', 'Owner', 'kestrel'),
    assign(G['sg-auditors'], 'Group', 'Reader', 'kestrel'),
    assign(G['sg-developers'], 'Group', 'Reader', 'production'),
    assign(G['sg-developers'], 'Group', 'Contributor', 'test'),
    assign(G['sg-developers'], 'Group', 'Shop Operator', 'rg-shop-prod'),
    assign(sps[0], 'ServicePrincipal', later ? 'Website Contributor' : 'Contributor', 'rg-shop-prod'),
    assign(sps[1], 'ServicePrincipal', 'Key Vault Secrets User', 'kv-shop-prod'),
    assign(G['sg-data-engineers'], 'Group', 'Storage Blob Data Contributor', 'stkestreldata'),
    // Holds directly what his group already gives him.
    assign(U.Emre, 'User', 'Contributor', 'test'),
    ...(later
      ? [assign(G['sg-data-engineers'], 'Group', 'Contributor', 'rg-shop-prod'), assign(greta, 'User', 'Owner', 'production')]
      : // Someone who left: the assignment is still there, the identity is not.
        [assign({ id: id('user who left') }, 'User', 'Reader', 'rg-data-prod', '')]),
  ];
  const definitions = Object.entries(ROLE).map(([roleName, guid]) => ({
    id: `/providers/Microsoft.Authorization/roleDefinitions/${guid}`,
    name: guid,
    roleName,
    roleType: roleName === 'Shop Operator' ? 'CustomRole' : 'BuiltInRole',
    description: roleName === 'Shop Operator' ? 'Restart and look at the shop, change nothing else' : '',
    assignableScopes: roleName === 'Shop Operator' ? [SCOPE.production] : ['/'],
    permissions:
      roleName === 'Shop Operator'
        ? [{ actions: ['Microsoft.Web/sites/restart/action', 'Microsoft.Web/sites/read', 'Microsoft.Insights/metrics/read'], notActions: [], dataActions: [], notDataActions: [] }]
        : [{ actions: [roleName === 'Reader' ? '*/read' : '*'], notActions: [], dataActions: [], notDataActions: [] }],
    type: 'Microsoft.Authorization/roleDefinitions',
  }));
  const pkg = (name) => id(`package ${name}`);
  const catalog = { id: id('catalog Engineering'), displayName: 'Engineering', catalogType: 'userManaged', state: 'published' };
  const northwind = { '@odata.type': '#microsoft.graph.connectedOrganizationMembers', connectedOrganizationId: id('org Northwind'), description: 'Northwind Audit' };
  const members_ = (g) => ({ '@odata.type': '#microsoft.graph.groupMembers', groupId: G[g].id, description: g });
  const grants = (...g) => g.map((name) => ({ id: id(`rrs ${name}`), role: { displayName: 'Member', originSystem: 'AadGroup', originId: `Member_${G[name].id}` }, scope: { displayName: name, originSystem: 'AadGroup', originId: G[name].id } }));
  const packages = [
    {
      id: pkg('Developer access'),
      displayName: 'Developer access',
      description: 'What a developer needs on day one',
      isHidden: false,
      catalog,
      resourceRoleScopes: [
        ...grants('sg-developers'),
        { id: id('rrs github'), role: { displayName: 'User', originSystem: 'AadApplication', originId: id('approle github user') }, scope: { displayName: 'GitHub Enterprise', originSystem: 'AadApplication', originId: id('sp GitHub Enterprise') } },
      ],
    },
    { id: pkg('Data platform access'), displayName: 'Data platform access', description: 'The data lake and what feeds it', isHidden: false, catalog, resourceRoleScopes: grants('sg-data-engineers') },
    { id: pkg('Partner audit'), displayName: 'Partner audit', description: 'Read-only, for the yearly audit', isHidden: false, catalog, resourceRoleScopes: grants('sg-auditors') },
  ];
  const manager = { '@odata.type': '#microsoft.graph.requestorManager', managerLevel: 1 };
  const policy = (name, targets, approvers, days, months) => ({
    id: id(`policy ${name}`),
    displayName: `${name}: initial policy`,
    allowedTargetScope: targets[0]['@odata.type'].endsWith('connectedOrganizationMembers') ? 'specificConnectedOrganizationUsers' : 'specificDirectoryUsers',
    specificAllowedTargets: targets,
    expiration: { type: 'afterDuration', duration: `P${days}D` },
    requestApprovalSettings: { isApprovalRequiredForAdd: true, stages: approvers.map((a) => ({ durationBeforeAutomaticDenial: 'P14D', primaryApprovers: [a] })) },
    reviewSettings: months ? { isEnabled: true, schedule: { recurrence: { pattern: { type: 'absoluteMonthly', interval: months } } } } : null,
    accessPackage: { id: pkg(name) },
  });
  const policies = [
    policy('Developer access', [members_('All Engineering')], [manager, members_('sg-platform-admins')], 180, 3),
    policy('Data platform access', [members_('sg-developers')], [members_('sg-platform-admins')], 90, 0),
    policy('Partner audit', [northwind], [members_('sg-platform-admins')], 30, 0),
  ];
  const holder = (name, u) => ({ id: id(`assignment ${name} ${u.id}`), state: 'delivered', status: 'Delivered', target: { objectId: u.id, displayName: u.displayName, subjectType: 'user' }, accessPackage: { id: pkg(name) } });
  const holders = [
    holder('Developer access', U.Chen),
    holder('Developer access', U.Dina),
    ...(later ? [holder('Developer access', U.Fleur)] : [holder('Developer access', U.Emre)]),
    holder('Data platform access', U.Fleur),
    holder('Partner audit', greta),
    { ...holder('Partner audit', U.Bram), state: 'expired', status: 'Expired' },
  ];
  const directoryRoles = Object.entries(DIRECTORY_ROLE).map(([name, template]) => ({ id: id(`directory role ${name}`), displayName: name, roleTemplateId: template, members: name === 'Global Administrator' ? [U.Alice] : [U.Bram] }));
  const tree = {
    id: mg('kestrel'),
    name: 'kestrel',
    displayName: 'Kestrel Logistics',
    type: 'Microsoft.Management/managementGroups',
    tenantId: TENANT,
    children: ['Kestrel Production', 'Kestrel Test'].map((n) => ({ id: sub(n), name: id(`sub ${n}`), displayName: n, type: '/subscriptions', children: null })),
  };
  const subscriptions = ['Kestrel Production', 'Kestrel Test'].map((n) => ({ cloudName: 'AzureCloud', id: id(`sub ${n}`), isDefault: n === 'Kestrel Production', name: n, state: 'Enabled', tenantId: TENANT, user: { name: 'someone@kestrel.example', type: 'user' } }));
  return { users, groups, sps, members, assignments, definitions, catalog, packages, policies, holders, directoryRoles, tree, subscriptions, U, G, greta };
}

for (const [folder, later] of [['kestrel', false], ['kestrel-later', true]]) {
  const t = tenant(later);
  save(folder, 'role-assignments.json', t.assignments);
  save(folder, 'role-definitions.json', t.definitions);
  save(folder, 'subscriptions.json', t.subscriptions);
  save(folder, 'management-groups.json', t.tree);
  save(folder, 'groups.json', graph('groups', t.groups.map(({ '@odata.type': _, ...g }) => g)));
  save(folder, 'users.json', graph('users', t.users.map(({ '@odata.type': _, ...u }) => u)));
  save(folder, 'service-principals.json', graph('servicePrincipals', t.sps.map(({ '@odata.type': _, ...s }) => s)));
  for (const [g, m] of Object.entries(t.members)) save(folder, `group-members-${g}.json`, m);
  save(folder, 'directory-roles.json', graph('directoryRoles(members())', t.directoryRoles));
  save(folder, 'access-packages.json', graph('identityGovernance/entitlementManagement/accessPackages(catalog(),resourceRoleScopes(role(),scope()))', t.packages));
  save(folder, 'access-package-policies.json', graph('identityGovernance/entitlementManagement/assignmentPolicies(accessPackage())', t.policies));
  save(folder, 'access-package-assignments.json', graph('identityGovernance/entitlementManagement/assignments(target(),accessPackage())', t.holders));
}

// ---- AzureHound: the same tenant as `azurehound list -o kestrel-azurehound.json` writes it
{
  const t = tenant(false);
  const records = [];
  const add = (kind, data) => records.push({ kind, data });
  const own = { tenantId: TENANT, tenantName: 'Kestrel Logistics' };
  add('AZTenant', { tenantId: TENANT, displayName: 'Kestrel Logistics', id: `/tenants/${TENANT}`, defaultDomain: 'kestrel.example', collected: true });
  for (const { '@odata.type': _, ...u } of t.users) add('AZUser', { ...u, accountEnabled: true, ...own });
  for (const { '@odata.type': _, ...g } of t.groups) add('AZGroup', { ...g, ...own });
  for (const { '@odata.type': _, ...s } of t.sps) add('AZServicePrincipal', { ...s, accountEnabled: true, ...own });
  for (const s of t.sps) add('AZApp', { id: id(`appobject ${s.displayName}`), appId: s.appId, displayName: s.displayName, ...own });
  for (const [g, m] of Object.entries(t.members)) add('AZGroupMember', { groupId: t.G[g].id, members: m.map((member) => ({ groupId: t.G[g].id, member })) });
  for (const r of t.directoryRoles) {
    add('AZRole', { id: r.roleTemplateId, templateId: r.roleTemplateId, displayName: r.displayName, isBuiltIn: true, isEnabled: true, ...own });
    add('AZRoleAssignment', { roleDefinitionId: r.roleTemplateId, tenantId: TENANT, roleAssignments: r.members.map((m) => ({ id: id(`dra ${r.displayName} ${m.id}`), roleDefinitionId: r.roleTemplateId, principalId: m.id, directoryScopeId: '/' })) });
  }
  add('AZManagementGroup', { id: mg('kestrel'), name: 'kestrel', type: 'Microsoft.Management/managementGroups', properties: { displayName: 'Kestrel Logistics', tenantId: TENANT }, tenantId: TENANT, tenantName: 'Kestrel Logistics' });
  for (const n of ['Kestrel Production', 'Kestrel Test']) {
    add('AZSubscription', { id: sub(n), subscriptionId: id(`sub ${n}`), displayName: n, state: 'Enabled', tenantId: TENANT });
    add('AZManagementGroupDescendant', { id: sub(n), name: id(`sub ${n}`), type: '/subscriptions', properties: { displayName: n, parent: { id: mg('kestrel') } } });
  }
  for (const name of ['rg-shop-prod', 'rg-data-prod', 'rg-shop-test']) add('AZResourceGroup', { id: SCOPE[name], name, location: 'westeurope', subscriptionId: SCOPE[name].split('/')[2], tenantId: TENANT });
  add('AZKeyVault', { id: SCOPE['kv-shop-prod'], name: 'kv-shop-prod', subscriptionId: SCOPE['kv-shop-prod'].split('/')[2], resourceGroup: SCOPE['rg-shop-prod'], tenantId: TENANT });
  // AzureHound lists per object what applies there, inherited assignments included: the same one more than once.
  const arm = (a) => ({ id: a.id, name: a.name, type: a.type, properties: { principalId: a.principalId, roleDefinitionId: a.roleDefinitionId, scope: a.scope } });
  const reaching = (scope) => t.assignments.filter((a) => scope === a.scope || scope.startsWith(`${a.scope}/`) || (a.scope === SCOPE.kestrel && scope.startsWith('/subscriptions/')));
  add('AZManagementGroupRoleAssignment', { managementGroupId: SCOPE.kestrel, roleAssignments: reaching(SCOPE.kestrel).map((a) => ({ roleAssignment: arm(a), managementGroupId: SCOPE.kestrel })) });
  for (const s of ['production', 'test']) add('AZSubscriptionRoleAssignment', { subscriptionId: SCOPE[s], roleAssignments: reaching(SCOPE[s]).map((a) => ({ roleAssignment: arm(a), subscriptionId: SCOPE[s] })) });
  for (const g of ['rg-shop-prod', 'rg-data-prod', 'rg-shop-test']) add('AZResourceGroupRoleAssignment', { resourceGroupId: SCOPE[g], roleAssignments: reaching(SCOPE[g]).map((a) => ({ roleAssignment: arm(a), resourceGroupId: SCOPE[g] })) });
  // The collector writes the vault's id under this key (v3.1.3).
  add('AZKeyVaultRoleAssignment', { virtualMachineId: SCOPE['kv-shop-prod'], roleAssignments: reaching(SCOPE['kv-shop-prod']).map((a) => ({ roleAssignment: arm(a), virtualMachineId: SCOPE['kv-shop-prod'] })) });
  save('azurehound', 'kestrel-azurehound.json', { data: records, meta: { type: 'azure', version: 5, count: records.length } });
}

// ---- a large tenant: 300 identities, as the CLI lists them
{
  let seed = 20261110;
  // The high bits: the low ones of this generator repeat.
  const next = (n) => Math.floor((seed = (seed * 1103515245 + 12345) % 2147483648) / 65536) % n;
  const pick = (list) => list[next(list.length)];
  const first = ['Anna', 'Bas', 'Carmen', 'Daan', 'Elif', 'Femke', 'Gijs', 'Hana', 'Ivo', 'Jade', 'Koen', 'Lina', 'Mats', 'Nora', 'Omar', 'Pien', 'Quinn', 'Rosa', 'Sem', 'Tess'];
  const last = ['Aalbers', 'Bos', 'Chen', 'Dekker', 'Evers', 'Faber', 'Groen', 'Haan', 'Idris', 'Jonker', 'Kok', 'Lam', 'Mulder', 'Novak', 'Oomen'];
  const teams = ['shop', 'data', 'billing', 'routing', 'fleet', 'portal', 'platform', 'security'];
  const users = Array.from({ length: 250 }, (_, i) => user(`${first[i % first.length]} ${last[Math.floor(i / first.length) % last.length]}${i >= 300 ? ` ${i}` : ''}`, i >= 240 ? 'Northwind' : undefined));
  const groups = teams.flatMap((t) => [group(`sg-${t}-developers`), group(`sg-${t}-operators`), group(`sg-${t}-readers`)]).concat([group('sg-platform-admins', { isAssignableToRole: true }), group('sg-auditors'), group('sg-finance'), group('sg-support'), group('sg-contractors'), group('sg-everyone')]);
  const sps = teams.flatMap((t) => [sp(`github-deploy-${t}`), sp(`id-${t}-api`, 'ManagedIdentity')]).concat([sp('terraform-platform'), sp('backup-runner'), sp('grafana'), sp('cost-export')]);
  const members = Object.fromEntries(groups.map((g) => [g.id, []]));
  for (const u of users) for (let n = 1 + next(2); n > 0; n--) members[pick(groups).id].push(u);
  const subs = ['Production', 'Test', 'Shared Services', 'Data', 'Sandbox', 'Network'];
  const scopes = { root: mg('kestrel') };
  for (const s of subs) {
    scopes[s] = sub(`Kestrel ${s}`);
    for (const t of teams.slice(0, 4)) scopes[`rg-${t}-${s.toLowerCase().split(' ')[0]}`] = rg(`Kestrel ${s}`, `rg-${t}-${s.toLowerCase().split(' ')[0]}`);
  }
  const names = Object.keys(scopes);
  const assign = (p, type, role, scope) => ({
    id: `${scopes[scope]}/providers/Microsoft.Authorization/roleAssignments/${id(`ra ${p.id} ${role} ${scope}`)}`,
    principalId: p.id,
    principalName: type === 'User' ? p.userPrincipalName : type === 'ServicePrincipal' ? p.appId : p.displayName,
    principalType: type,
    roleDefinitionId: `/providers/Microsoft.Authorization/roleDefinitions/${ROLE[role]}`,
    roleDefinitionName: role,
    scope: scopes[scope],
  });
  const G = Object.fromEntries(groups.map((g) => [g.displayName, g]));
  const assignments = [assign(G['sg-platform-admins'], 'Group', 'Owner', 'root'), assign(G['sg-auditors'], 'Group', 'Reader', 'root')];
  for (const t of teams) {
    assignments.push(assign(G[`sg-${t}-readers`], 'Group', 'Reader', 'Production'), assign(G[`sg-${t}-developers`], 'Group', 'Contributor', 'Test'));
    const mine = names.filter((n) => n.startsWith(`rg-${t}-`));
    for (const n of mine) {
      assignments.push(assign(G[`sg-${t}-operators`], 'Group', 'Contributor', n));
      assignments.push(assign(sps.find((s) => s.displayName === `github-deploy-${t}`), 'ServicePrincipal', 'Contributor', n));
    }
  }
  for (let i = 0; i < 18; i++) assignments.push(assign(users[next(users.length)], 'User', pick(['Reader', 'Contributor', 'Owner']), pick(names.slice(1))));
  save('large', 'role-assignments.json', assignments);
  save('large', 'groups.json', graph('groups', groups.map(({ '@odata.type': _, ...g }) => g)));
  save('large', 'users.json', graph('users', users.map(({ '@odata.type': _, ...u }) => u)));
  save('large', 'service-principals.json', graph('servicePrincipals', sps.map(({ '@odata.type': _, ...s }) => s)));
  save('large', 'group-members.json', members);
  save('large', 'management-groups.json', {
    id: mg('kestrel'),
    name: 'kestrel',
    displayName: 'Kestrel Logistics',
    type: 'Microsoft.Management/managementGroups',
    tenantId: TENANT,
    children: subs.map((s) => ({ id: sub(`Kestrel ${s}`), name: id(`sub Kestrel ${s}`), displayName: `Kestrel ${s}`, type: '/subscriptions', children: null })),
  });
  save('large', 'subscriptions.json', subs.map((s) => ({ id: id(`sub Kestrel ${s}`), name: `Kestrel ${s}`, state: 'Enabled', tenantId: TENANT, isDefault: false })));
}
