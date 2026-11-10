import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { render } from '@cartography/engine';
import { importAccess, isAccessExport, type ExportFile } from '../src/index.ts';

// The fixtures are an invented tenant; examples/access/import/make-fixtures.mjs writes them.
const fixtures = path.resolve(import.meta.dirname, '../../../examples/access/import');
const folder = (name: string): ExportFile[] =>
  fs
    .readdirSync(path.join(fixtures, name))
    .sort()
    .map((f) => ({ path: f, text: fs.readFileSync(path.join(fixtures, name, f), 'utf8') }));
const only = (name: string, ...files: string[]) => folder(name).filter((f) => files.includes(f.path));
type Doc = { principals: Record<string, any>; resources: Record<string, any>; roles: Record<string, any>; packages?: Record<string, any>; catalogs?: Record<string, any>; assignments: string[]; title: string };
const doc = (yaml: string) => parse(yaml) as Doc;

const SUB = '3923ca09-b88c-3a36-dcf8-1c9451fd5edd';
const assignment = (principalId: string, role: string, scope: string, more: object = {}) => ({
  id: `${scope}/providers/Microsoft.Authorization/roleAssignments/0000`,
  principalId,
  principalType: 'Group',
  roleDefinitionId: `/subscriptions/${SUB}/providers/Microsoft.Authorization/roleDefinitions/${role}`,
  scope,
  ...more,
});
const json = (name: string, data: unknown): ExportFile => ({ path: name, text: JSON.stringify(data) });

describe('access import: az and Graph', () => {
  const out = importAccess(folder('kestrel'));
  const d = doc(out.yaml);

  it('reads every file of the folder and says what each one was', () => {
    expect(out.skipped).toEqual([]);
    expect(out.problems).toEqual([]);
    expect(out.warnings).toEqual([]);
    expect(out.read.map((r) => `${r.file}: ${r.what} ${r.count}`)).toEqual(
      expect.arrayContaining(['role-assignments.json: role assignments 10', 'groups.json: groups 5', 'access-packages.json: access packages 3', 'management-groups.json: management group tree 3']),
    );
    expect(new Set(out.read.map((r) => r.file)).size).toBe(15);
    expect(out.summary).toBe('16 identities, 12 role assignments on 9 scopes, 3 access packages');
  });

  it('names things after what they are called, and keeps the GUID as a property', () => {
    expect(d.principals['sg-developers']).toEqual({ kind: 'group', 'object-id': 'f1997d55-a4c7-9409-1b10-3c60944853f7' });
    expect(d.principals['dina-okafor']).toMatchObject({ kind: 'user', label: 'Dina Okafor', 'member-of': ['sg-data-engineers', 'sg-developers'] });
    expect(d.principals['greta-lind-northwind']!.kind).toBe('guest');
    expect(d.principals['sg-platform-admins']!.kind).toBe('role-assignable-group');
    expect(d.principals['all-engineering']).toMatchObject({ kind: 'dynamic-group', caption: 'user.department -eq "Engineering"' });
    expect(d.principals['id-shop-api']!.kind).toBe('managed-identity');
    expect(d.principals['github-deploy-shop']!.kind).toBe('service-principal');
    // A group in a group.
    expect(d.principals['sg-data-engineers']!['member-of']).toBe('sg-developers');
  });

  it('builds the scope tree from the scope strings', () => {
    expect(d.resources['kestrel-logistics']).toMatchObject({ kind: 'management-group', label: 'Kestrel Logistics' });
    expect(d.resources['kestrel-production']).toMatchObject({ kind: 'subscription', in: 'kestrel-logistics', 'resource-id': `/subscriptions/${SUB}` });
    expect(d.resources['rg-shop-prod']).toMatchObject({ kind: 'resource-group', in: 'kestrel-production' });
    expect(d.resources['kv-shop-prod']).toMatchObject({ kind: 'key-vault', in: 'rg-shop-prod' });
    expect(d.resources['stkestreldata']).toMatchObject({ kind: 'storage', in: 'rg-data-prod' });
    // Directory roles are on the directory, which is not above the subscriptions.
    expect(d.resources['directory']).toMatchObject({ kind: 'tenant', caption: 'Entra ID directory' });
    expect(d.resources['directory']!.in).toBeUndefined();
  });

  it('writes an assignment once, on the scope it was made on: what is below inherits', () => {
    expect(d.assignments.filter((a) => a.startsWith('sg-platform-admins is owner'))).toEqual(['sg-platform-admins is owner on kestrel-logistics']);
    expect(d.assignments).toContain('alice-jansen is global-administrator on directory');
    expect(d.assignments).toContain('id-shop-api is key-vault-secrets-user on kv-shop-prod');
    expect(d.assignments).toHaveLength(12);
  });

  it('keeps the permissions of custom roles only, and the ladder everyone knows', () => {
    expect(d.roles['shop-operator']!.permissions).toContain('Microsoft.Web/sites/restart/action');
    expect(d.roles['reader']!.permissions).toBeUndefined();
    expect(d.roles['contributor']).toMatchObject({ inherits: 'reader', 'role-id': 'b24988ac-6180-42a0-ab88-20f7382dd24c' });
    expect(d.roles['owner']!.inherits).toBe('contributor');
  });

  it('reads access packages: catalog, what they grant, who may ask, who approves, who holds one', () => {
    expect(d.catalogs).toEqual({ engineering: { label: 'Engineering', 'object-id': expect.any(String) } });
    expect(d.packages!['developer-access']).toMatchObject({
      catalog: 'engineering',
      label: 'Developer access',
      grants: ['sg-developers', { 'github-enterprise': 'User' }],
      policy: { requestors: ['all-engineering'], approval: ['manager', 'sg-platform-admins'], duration: '180 days', review: 'quarterly' },
      holders: ['chen-wei', 'dina-okafor', 'emre-yilmaz'],
    });
    // An assignment that has expired is not held.
    expect(d.packages!['partner-audit']!.holders).toEqual(['greta-lind-northwind']);
    expect(d.resources['github-enterprise']!.kind).toBe('app');
  });

  it('shows an assignment to an identity that is gone as such', () => {
    expect(d.principals['identity-not-found']).toMatchObject({ kind: 'unknown', label: 'Identity not found' });
    expect(d.assignments).toContain('identity-not-found is reader on rg-data-prod');
  });

  it('draws, with the checks of the type as warnings', async () => {
    const r = await render(out.yaml, { fonts: 'none' });
    expect(r.diagnostics.filter((x) => x.severity === 'error')).toEqual([]);
    expect(r.svg).toContain('sg-platform-admins');
    const said = r.diagnostics.map((w) => w.message).join('\n');
    expect(said).toContain('no longer exists');
    expect(said).toContain('Emre Yilmaz is Contributor on Kestrel Test directly');
  });

  it('is the same text when run again', () => {
    expect(importAccess(folder('kestrel').reverse()).yaml).toBe(out.yaml);
  });
});

describe('access import: one file at a time', () => {
  it('reads role assignments alone, with the names the CLI adds', () => {
    const o = importAccess(only('kestrel', 'role-assignments.json'));
    const d = doc(o.yaml);
    expect(d.assignments).toHaveLength(10);
    expect(d.principals['sg-developers']!.kind).toBe('group');
    // No management group tree: the subscription is called what its id says, and the tree is asked for.
    expect(Object.keys(d.resources)).toContain(`subscription-${SUB.slice(0, 8)}`);
    expect(o.warnings.join('\n')).toContain('az account management-group show --name kestrel');
  });

  it('reads the ARM form, where everything is under properties', () => {
    const scope = `/subscriptions/${SUB}/resourceGroups/rg-one`;
    const o = importAccess([
      json('ra.json', { value: [{ id: `${scope}/providers/Microsoft.Authorization/roleAssignments/1`, type: 'Microsoft.Authorization/roleAssignments', properties: { principalId: 'AAAAAAAA-0000-0000-0000-000000000001', principalType: 'ServicePrincipal', roleDefinitionId: `/subscriptions/${SUB}/providers/Microsoft.Authorization/roleDefinitions/acdd72a7-3385-48ef-bd42-f606fba81ae7`, scope } }] }),
    ]);
    const d = doc(o.yaml);
    expect(d.assignments).toEqual(['identity-aaaaaaaa is reader on rg-one']);
    expect(d.principals['identity-aaaaaaaa']).toMatchObject({ kind: 'service-principal', 'object-id': 'aaaaaaaa-0000-0000-0000-000000000001' });
    expect(o.warnings.join('\n')).toContain('known by id only');
  });

  it('reads a single Graph response of access packages', () => {
    const o = importAccess(only('kestrel', 'access-packages.json'));
    const d = doc(o.yaml);
    expect(Object.keys(d.packages!)).toEqual(['data-platform-access', 'developer-access', 'partner-audit']);
    expect(o.summary).toContain('3 access packages');
  });

  it('knows what it reads and what it does not', () => {
    expect(isAccessExport(only('kestrel', 'role-assignments.json')[0]!.text)).toBe(true);
    expect(isAccessExport(folder('azurehound')[0]!.text)).toBe(true);
    expect(isAccessExport('{"name":"something else"}')).toBe(false);
    expect(isAccessExport('type: access')).toBe(false);
  });

  it('says what it skipped and why', () => {
    const o = importAccess([...only('kestrel', 'role-assignments.json'), { path: 'notes.txt', text: 'hello' }, { path: 'broken.json', text: '{' }, json('other.json', { hello: 'world' })]);
    expect(o.skipped).toEqual([
      { file: 'notes.txt', why: 'not a JSON file' },
      { file: 'broken.json', why: 'not valid JSON' },
      { file: 'other.json', why: 'not an access export this reads' },
    ]);
    expect(o.problems).toEqual([expect.objectContaining({ file: 'broken.json', severity: 'error' })]);
    expect(o.yaml).toContain('assignments:');
  });

  it('has nothing to draw without assignments or packages', () => {
    const o = importAccess(only('kestrel', 'groups.json', 'users.json'));
    expect(o.yaml).toBe('');
    expect(o.warnings.join('\n')).toContain('nothing to draw');
  });
});

describe('access import: AzureHound', () => {
  const out = importAccess(folder('azurehound'));
  const d = doc(out.yaml);

  it('reads the same tenant as the CLI does', () => {
    const az = doc(importAccess(folder('kestrel')).yaml);
    const plain = (a: string) => a.replace('role-d3421385', 'shop-operator').replace(/kestrel-logistics-(management-group|tenant)/, (_, k) => (k === 'tenant' ? 'directory' : 'kestrel-logistics'));
    // AzureHound lists what each scope inherits; the assignment is still one. It has no storage account here.
    expect(d.assignments.map(plain).sort()).toEqual(az.assignments.filter((a) => !a.includes('stkestreldata')).sort());
    expect(d.title).toBe('Kestrel Logistics: who reaches what');
  });

  it('has the names of the directory, and knows who is gone', () => {
    expect(d.principals['alice-jansen']).toMatchObject({ kind: 'user', label: 'Alice Jansen', 'member-of': 'sg-platform-admins' });
    expect(d.principals['identity-not-found']!.kind).toBe('unknown');
    expect(d.resources['kestrel-production']).toMatchObject({ kind: 'subscription', label: 'Kestrel Production' });
    // The vault's role assignments are under a key that says virtual machine (v3.1.3).
    expect(d.assignments).toContain('id-shop-api is key-vault-secrets-user on kv-shop-prod');
  });

  it('says a custom role is known by id only', () => {
    expect(out.warnings.join('\n')).toContain('1 role is known by id only');
    expect(d.roles['role-d3421385']!.label).toBe('Role d3421385');
  });
});

describe('access import: importing again', () => {
  const first = importAccess(folder('kestrel')).yaml;

  it('changes nothing when nothing changed', () => {
    expect(importAccess(folder('kestrel'), { existing: first }).yaml).toBe(first);
  });

  it('keeps ids when unrelated things are added', () => {
    const before = doc(first);
    const after = doc(importAccess(folder('kestrel-later')).yaml);
    const idOf = (d: Doc) => Object.fromEntries(Object.entries(d.principals).map(([id, p]) => [p['object-id'], id]));
    for (const [guid, id] of Object.entries(idOf(before))) if (idOf(after)[guid]) expect(idOf(after)[guid]).toBe(id);
    expect(after.principals['hugo-smit']).toBeDefined();
  });

  it('tells two things with one name apart by what they are in, without renaming the first', () => {
    const one = [assignment('aaaaaaaa-0000-0000-0000-000000000001', 'acdd72a7-3385-48ef-bd42-f606fba81ae7', `/subscriptions/${SUB}/resourceGroups/rg-app`, { principalName: 'sg-app' })];
    const a = importAccess([json('ra.json', one)]);
    expect(Object.keys(doc(a.yaml).resources)).toContain('rg-app');
    const two = [...one, assignment('aaaaaaaa-0000-0000-0000-000000000001', 'acdd72a7-3385-48ef-bd42-f606fba81ae7', '/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-app', { principalName: 'sg-app' })];
    const b = doc(importAccess([json('ra.json', two)], { existing: a.yaml }).yaml);
    expect(b.resources['rg-app']!['resource-id']).toBe(`/subscriptions/${SUB}/resourceGroups/rg-app`);
    expect(Object.keys(b.resources)).toContain('rg-app-subscription-11111111');
    // Fresh, both say where they are.
    expect(Object.keys(doc(importAccess([json('ra.json', two)]).yaml).resources)).toEqual(expect.arrayContaining([`rg-app-subscription-${SUB.slice(0, 8)}`, 'rg-app-subscription-11111111']));
  });

  it('keeps what was written by hand and follows the export for the rest', () => {
    const edited = first
      .replace('title: Who reaches what', 'title: Kestrel access, reviewed in March')
      .replace('  sg-developers: { kind: group,', '  # the big one\n  sg-developers: { kind: group, label: Developers, caption: Everyone who ships,')
      .replace('\ncatalogs:', '  auditor-on-call: { kind: user, label: Auditor on call }\n\ncatalogs:')
      .replace('rg-shop-prod: { kind: resource-group,', 'shop: { kind: resource-group, label: The shop,')
      .replace(/\b(on|in:) rg-shop-prod\b/g, '$1 shop')
      .replace('\nassignments:\n', '\nassignments:\n  - auditor-on-call is reader on shop\n');
    const again = importAccess(folder('kestrel-later'), { existing: edited });
    const d = doc(again.yaml);
    expect(d.title).toBe('Kestrel access, reviewed in March');
    // A label and caption written by hand stay; a comment too.
    expect(d.principals['sg-developers']).toMatchObject({ label: 'Developers', caption: 'Everyone who ships' });
    expect(again.yaml).toContain('# the big one');
    // An id changed by hand stays, since the resource id says which one it is.
    expect(d.resources['shop']).toMatchObject({ label: 'The shop', kind: 'resource-group' });
    expect(d.resources['rg-shop-prod']).toBeUndefined();
    expect(d.resources['kv-shop-prod']!.in).toBe('shop');
    // What was added by hand stays, with its assignment.
    expect(d.principals['auditor-on-call']).toEqual({ kind: 'user', label: 'Auditor on call' });
    expect(d.assignments).toContain('auditor-on-call is reader on shop');
    // What the export says now: gained, lost, changed, gone.
    expect(d.assignments).toContain('sg-data-engineers is contributor on shop');
    expect(d.assignments).toContain('greta-lind-northwind is owner on kestrel-production');
    expect(d.assignments).toContain('github-deploy-shop is website-contributor on shop');
    expect(d.assignments).not.toContain('github-deploy-shop is contributor on shop');
    expect(d.principals['identity-not-found']).toBeUndefined();
    expect(d.assignments.join('\n')).not.toContain('identity-not-found');
    expect(d.principals['emre-yilmaz']!['member-of']).toBeUndefined();
    expect(d.principals['hugo-smit']!['member-of']).toBe('sg-platform-admins');
    expect(d.packages!['developer-access']!.holders).toEqual(['chen-wei', 'dina-okafor', 'fleur-bakker']);
  });

  it('does not touch a diagram of another type, or one that cannot be read', () => {
    const other = importAccess(folder('kestrel'), { existing: 'type: systems\nsystems: {}\n' });
    expect(other.yaml).toBe('');
    expect(other.problems.at(-1)).toMatchObject({ severity: 'error', message: 'The diagram is not an access diagram: not changed' });
    expect(importAccess(folder('kestrel'), { existing: 'type: access\n  bad: [' }).yaml).toBe('');
  });
});

describe('access import: a large tenant', () => {
  const out = importAccess(folder('large'));
  const d = doc(out.yaml);

  it('folds members into their groups, deep scopes into what they are in, and those who reach the same into one', () => {
    expect(out.summary).toBe('23 identities, 34 role assignments on 7 scopes');
    expect(d.principals['sg-platform-admins']!.caption).toBe('14 members');
    expect(d.principals['sg-readers']).toMatchObject({ kind: 'group', label: 'sg-*-readers', caption: '8 groups, 96 members' });
    expect(d.principals['github-deploy']).toMatchObject({ kind: 'service-principal', label: 'github-deploy-*', caption: '4 service principals' });
    expect(Object.values(d.resources).map((r) => r.kind)).not.toContain('resource-group');
    expect(d.roles['contributor-in-part']).toMatchObject({ label: 'Contributor (in part)', part: true });
    expect(d.assignments).toContain('sg-operators is contributor-in-part on kestrel-production');
    const said = out.warnings.join('\n');
    expect(said).toContain('31 scopes are many for one picture');
    expect(said).toContain('200 members of groups folded');
    expect(said).toContain('sg-*-readers (8)');
  });

  it('draws within reason', async () => {
    const r = await render(out.yaml, { fonts: 'none', view: 'access' });
    expect(r.diagnostics.filter((x) => x.severity === 'error')).toEqual([]);
    // A role in part says nothing about which part: no check compares two of them.
    expect(r.diagnostics.map((w) => w.message).join('\n')).not.toContain('(in part)');
  });

  it('draws everyone and everything when asked', () => {
    const all = importAccess(folder('large'), { principals: 'all', depth: 9, groupBy: 'none' });
    const a = doc(all.yaml);
    expect(all.warnings.join('\n')).not.toContain('folded');
    expect(Object.values(a.principals).filter((p) => p.kind === 'user' || p.kind === 'guest').length).toBeGreaterThan(200);
    expect(Object.values(a.resources).filter((r) => r.kind === 'resource-group')).toHaveLength(24);
    expect(a.assignments).toHaveLength(84);
  });

  it('draws one part of the tenant', () => {
    const part = importAccess(folder('large'), { scope: 'Kestrel Production' });
    const p = doc(part.yaml);
    expect(Object.values(p.resources).map((r) => r.label ?? '').filter((l) => l.startsWith('Kestrel')).sort()).toEqual(['Kestrel Logistics', 'Kestrel Production']);
    expect(Object.keys(p.resources)).toContain('rg-shop-production');
    // What is above stays: its roles reach in.
    expect(p.assignments).toContain('sg-platform-admins is owner on kestrel-logistics');
    expect(part.warnings.join('\n')).toMatch(/\d+ role assignments outside Kestrel Production left out/);
    expect(importAccess(folder('large'), { scope: 'nowhere' }).warnings.join('\n')).toContain('No scope is called "nowhere"');
  });

  it('folds to the depth asked for', () => {
    const two = doc(importAccess(folder('large'), { depth: 2, groupBy: 'none' }).yaml);
    expect(Object.values(two.resources).filter((r) => r.kind === 'resource-group')).toHaveLength(24);
    expect(Object.keys(two.roles).join(' ')).not.toContain('in-part');
  });
});
