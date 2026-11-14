import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MatrixShape } from '@cartography/core';
import { parse, stringify } from 'yaml';
import { accessChanges, effectiveAccess, type AccessSource } from '@cartography/access';
import { describe as describeDiagram, toText } from '@cartography/describe';
import { wrapNote, wrapText } from '@cartography/render';
import { findType, render } from '../src/index.ts';

const source = (view: string) => `type: access
view: ${view}
principals:
  alice: user
  carol: { kind: user, member-of: sg-ops }
  sg-dev: group
  sg-ops: group
packages:
  dev: { label: Developer access, grants: [sg-dev, gh: User], holders: [alice] }
resources:
  prod: subscription
  rg: { kind: resource-group, in: prod }
  gh: app
roles:
  reader: { label: Reader, permissions: [read] }
  owner: { label: Owner, inherits: reader, permissions: [manage] }
assignments:
  - sg-dev is reader on prod
  - sg-ops is owner on rg
  - alice is owner on rg
`;

async function matrix(view: string) {
  const r = await render(source(view), { fonts: 'none' });
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const m = r.graph!.nodes[0]!.shape as MatrixShape;
  const cell = (row: string, col: string) => m.cells[m.rows.findIndex((x) => x.label === row)]![m.columns.findIndex((x) => x.label === col)];
  return { m, cell };
}

describe('access view', () => {
  it('resolves packages, groups and parent scopes', async () => {
    const { cell } = await matrix('access');
    expect(cell('alice', 'prod')).toMatchObject({ text: 'Reader', inherited: true, note: 'via Developer access' });
    // A direct, stronger assignment wins over what is inherited.
    expect(cell('alice', 'rg')).toMatchObject({ text: 'Owner', inherited: false });
    expect(cell('alice', 'gh')).toMatchObject({ text: 'User', note: 'via Developer access' });
    expect(cell('carol', 'rg')).toMatchObject({ text: 'Owner', inherited: true, note: 'via sg-ops' });
    expect(cell('carol', 'prod')).toBeUndefined();
    expect(cell('sg-dev', 'rg')).toMatchObject({ text: 'Reader', note: 'from prod' });
  });

  it('lists permissions with inherited ones marked', async () => {
    const { cell } = await matrix('roles');
    expect(cell('Owner', 'read')).toMatchObject({ check: true, inherited: true });
    expect(cell('Owner', 'manage')).toMatchObject({ check: true, inherited: false });
    expect(cell('Reader', 'manage')).toBeUndefined();
  });

  it('explains a malformed assignment', async () => {
    const r = await render(source('graph').replace('- alice is owner on rg', '- alice owns rg'), { fonts: 'none' });
    expect(r.diagnostics.map((d) => [d.line, d.message])).toEqual([
      [20, '"alice owns rg" should look like "who is role on scope", e.g. "sg-devs is contributor on rg-dev"'],
    ]);
  });

  it('reports what does not exist', async () => {
    const r = await render(source('graph').replace('- alice is owner on rg', '- alice is owner on nowhere'), { fonts: 'none' });
    expect(r.diagnostics.map((d) => d.message)).toEqual(['There is no resource "nowhere"']);
  });

  it('draws an eligible (PIM) assignment dashed, and holds what is active before what can be activated', async () => {
    const text = source('access').replace('- alice is owner on rg', '- alice is eligible owner on rg\n  - { principal: sg-ops, role: reader, scope: prod, eligible: true }');
    const r = await render(text, { fonts: 'none', view: 'graph' });
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const line = r.graph!.edges.find((e) => e.from.node === 'alice' && e.to.node === 'rg')!;
    expect(line).toMatchObject({ label: 'Owner', line: 'dashed' });
    expect(r.graph!.legend!.map((l) => l.label)).toContain('Eligible, activated through PIM');
    const m = (await render(text, { fonts: 'none' })).graph!.nodes[0]!.shape as MatrixShape;
    const cell = (row: string, col: string) => m.cells[m.rows.findIndex((x) => x.label === row)]![m.columns.findIndex((x) => x.label === col)];
    // Owner is assigned on rg itself (eligible: once activated), so it takes the pill; Reader on prod (through
    // the package) is held now and named too. The pill's own way comes first, then every other role there,
    // each with its own way when that differs.
    expect(cell('alice', 'rg')).toMatchObject({ text: 'Owner (eligible)', note: 'also Reader (via Developer access, from prod)' });
    expect(cell('sg-ops', 'prod')).toMatchObject({ text: 'Reader (eligible)', inherited: false });
  });

  it('names every role in a cell, also an eligible one the stronger eligible role includes', async () => {
    const text = `type: access
view: access
principals:
  sg: role-assignable-group
resources:
  tenant: tenant
roles:
  pra: { label: Privileged Role Administrator }
  ga: { label: Global Administrator, inherits: pra }
assignments:
  - { principal: sg, role: ga, scope: tenant, eligible: true, activation: 2 h }
  - { principal: sg, role: pra, scope: tenant, eligible: true, activation: 2 h }
`;
    const m = (await render(text, { fonts: 'none' })).graph!.nodes[0]!.shape as MatrixShape;
    expect(m.cells[0]![0]).toMatchObject({ text: 'Global Administrator (eligible)', note: 'max 2\u00a0h; also Privileged Role Administrator' });
  });

  it('says how a role is activated where it is assigned, and only where it comes from below that', async () => {
    const text = `type: access
view: access
principals:
  priya: { kind: user, member-of: devs }
  devs: group
  admins: group
resources:
  mg: management-group
  sub: { kind: subscription, in: mg }
  rg: { kind: resource-group, in: sub }
  kv: { kind: key-vault, in: rg }
roles:
  reader: { label: Reader }
  contributor: { label: Contributor, inherits: reader }
  owner: { label: Owner, inherits: contributor }
assignments:
  - { principal: admins, role: owner, scope: mg, eligible: true, activation: 4 h, approval: admins }
  - devs is reader on sub
  - { principal: devs, role: contributor, scope: rg, eligible: true, activation: 8 h }
`;
    const r = await render(text, { fonts: 'none' });
    expect(r.diagnostics).toEqual([]);
    const m = r.graph!.nodes[0]!.shape as MatrixShape;
    const cell = (row: string, col: string) => m.cells[m.rows.findIndex((x) => x.label === row)]![m.columns.findIndex((x) => x.label === col)];
    expect(cell('admins', 'mg')!.note).toBe('max 4\u00a0h, approval by admins');
    expect(cell('admins', 'kv')!.note).toBe('from mg');
    // The words under a pill are first about that pill: Reader comes through devs from sub; Contributor is a further, eligible role.
    expect(cell('priya', 'kv')).toMatchObject({ text: 'Reader', note: 'via devs, from sub; eligible for Contributor (from rg)' });
    expect(cell('priya', 'rg')).toMatchObject({ text: 'Contributor (eligible)', note: 'via devs, max 8\u00a0h; also Reader (from sub)' });
    expect(r.graph!.legend!.map((l) => l.label)).toEqual(['Assigned directly', 'Through a group or parent scope']);
  });

  it('draws a group a package hands out as somewhere to get to, and keys only what is drawn', async () => {
    const r = await render(`type: access
view: access
principals:
  emma: user
  team: { kind: m365-group, label: Finance team }
packages:
  basic: { label: Finance basics, grants: [team, site: Member], holders: [emma] }
resources:
  site: sharepoint-site
`, { fonts: 'none' });
    const m = r.graph!.nodes[0]!.shape as MatrixShape;
    // The group holds nothing itself: a column, not an empty row.
    expect(m.rows.map((x) => x.label)).toEqual(['emma']);
    expect(m.columns.map((x) => x.label)).toEqual(['Finance team', 'site']);
    expect(m.cells[0]![0]).toMatchObject({ text: 'Member', inherited: true, note: 'via Finance basics' });
    // Nothing is assigned directly, and the outlined pill comes through a package only: the key says just that.
    expect(r.graph!.legend!.map((l) => l.label)).toEqual(['Through an access package']);
  });

  it('draws the same relation the same way in every access diagram', async () => {
    const lines = async (text: string) => (await render(text, { fonts: 'none', view: 'graph' })).graph!.edges.map((e) => `${e.kind}:${e.line}:${e.pattern ?? ''}`);
    const packagesOnly = await lines('type: access\nprincipals:\n  emma: user\n  team: group\npackages:\n  basic: { grants: [team], holders: [emma] }\n');
    const all = await lines(source('graph'));
    for (const l of packagesOnly) expect(all).toContain(l);
    expect(packagesOnly).toEqual(['Holds:solid:beads', 'Grants:solid:ticks']);
  });
});

describe('access checks', () => {
  const warnings = async (text: string) => (await render(text, { fonts: 'none' })).diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message);

  it('names a user who holds directly what a group holds', async () => {
    expect(await warnings(source('graph'))).toEqual(['alice is Owner on rg directly, where sg-ops holds the same role: membership of the group would do']);
  });

  it('names a role granted on a kind of scope where it, or a permission in it, does not apply', async () => {
    const text = `type: access
principals:
  analysts: group
  ops: group
resources:
  sales: { kind: catalog }
  gold: { kind: schema, in: sales }
  kv: { kind: key-vault }
  rg: { kind: resource-group }
roles:
  browse: { permissions: [BROWSE] }
  read: { inherits: browse, permissions: [{ USE CATALOG: { on: catalog } }, { USE SCHEMA: { on: [catalog, schema] } }, SELECT] }
  schema-read: { permissions: [{ USE SCHEMA: { on: [catalog, schema] } }, SELECT] }
  secrets: { on: key-vault, permissions: [get secret] }
assignments:
  - analysts is read on sales
  - analysts is read on gold
  - analysts is schema-read on gold
  - ops is secrets on kv
  - ops is secrets on rg
`;
    const r = await render(text, { fonts: 'none' });
    expect(r.diagnostics.filter((d) => d.severity === 'warning').map((d) => [d.line, d.message])).toEqual([
      [17, 'read holds USE CATALOG (on catalog), and gold is a schema: grant it where that applies, or take it out of the role'],
      [20, 'secrets is granted on key-vault, and rg is a resource-group'],
    ]);
    // The roles table names the permissions as ever, the inherited ones too.
    const roles = await render(text.replace('type: access', 'type: access\nview: roles'), { fonts: 'none' });
    expect(roles.svg).toContain('USE CATALOG');
    expect(roles.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('names a guest with an owner-level role on a broad scope, also through a group', async () => {
    const text = `type: access
principals:
  eve: { kind: guest, label: Eve (Contoso), member-of: sg-ops }
  sg-ops: group
  gone: { kind: unknown, label: Identity not found }
resources:
  prod: { kind: subscription, label: Production }
  rg: { kind: resource-group, in: prod }
roles:
  owner: { label: Owner }
  reader: { label: Reader }
assignments:
  - sg-ops is owner on prod
  - gone is reader on rg
`;
    expect(await warnings(text)).toEqual([
      'Reader on rg is held by an identity that no longer exists (Identity not found): the assignment can go',
      'Guest Eve (Contoso) is Owner on subscription Production (via sg-ops): an owner-level role on a broad scope for someone from outside',
    ]);
  });

  it('says nothing about a tidy diagram', async () => {
    expect(await warnings(source('graph').replace('  - alice is owner on rg\n', ''))).toEqual([]);
  });
});

describe('gained and lost access', () => {
  const before = parse(source('access')) as AccessSource;
  const after = parse(
    source('access')
      .replace('carol: { kind: user, member-of: sg-ops }', 'carol: { kind: user, member-of: [sg-ops, sg-dev] }\n  dave: { kind: guest, label: Dave, member-of: sg-ops }')
      .replace('  - alice is owner on rg\n', '  - sg-ops is reader on prod\n'),
  ) as AccessSource;

  it('tells what changed in plain words, effective access included', () => {
    expect(accessChanges(before, after).map((c) => c.text)).toEqual([
      // She keeps Reader there through her access package: only the direct Owner went.
      'alice lost Owner on rg',
      // A new member of a group that holds a role.
      'Dave gained Owner on rg (via sg-ops)',
      // The group's new role is told once, not again for carol and Dave.
      'sg-ops gained Reader on prod, and with it carol, Dave',
    ]);
    expect(accessChanges(before, before)).toEqual([]);
  });

  it('tells a group change once, with the members it carries along', () => {
    const more = { ...before, assignments: [...before.assignments!, 'sg-ops is reader on gh'] };
    expect(accessChanges(before, more).map((c) => c.text)).toEqual(['sg-ops gained Reader on gh, and with it carol']);
  });

  it('knows a renamed principal by its object id', () => {
    const named = (id: string) => ({ ...before, principals: { ...before.principals, [id]: { kind: 'user', 'object-id': 'A1' } } }) as AccessSource;
    const a = { ...named('bob'), assignments: ['bob is reader on rg'] };
    const b = { ...named('robert'), principals: Object.fromEntries(Object.entries(named('robert').principals!).filter(([id]) => id !== 'bob')), assignments: ['robert is owner on rg'] };
    expect(accessChanges(a, b).filter((c) => c.who === 'robert').map((c) => c.text)).toEqual(['robert changed from Reader to Owner on rg']);
  });

  it('draws the who × where matrix of the change: signs, struck text, the rest quiet', async () => {
    const r = await render(stringify({ ...after, was: before }), { fonts: 'none' });
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const m = r.graph!.nodes[0]!.shape as MatrixShape;
    expect(m.compare).toBe(true);
    // Only who and where something changed.
    expect(m.rows.map((x) => x.label)).toEqual(['alice', 'carol', 'Dave', 'sg-ops']);
    expect(m.rows[2]).toMatchObject({ change: 'added', caption: 'New · Guest' });
    expect(m.columns.map((x) => x.label)).toEqual(['prod', 'rg']);
    const cell = (row: string, col: string) => m.cells[m.rows.findIndex((x) => x.label === row)]![m.columns.findIndex((x) => x.label === col)];
    expect(cell('alice', 'rg')).toMatchObject({ text: '~ Reader', change: 'changed', note: '− Owner', tone: 'amber' });
    expect(cell('carol', 'prod')).toMatchObject({ text: '+ Reader', change: 'added', tone: 'green', note: 'via sg-ops' });
    expect(cell('alice', 'prod')).toMatchObject({ text: 'Reader' });
    expect(cell('alice', 'prod')!.change).toBeUndefined();
    expect(r.svg).toContain('opacity="0.42"');
    // And the other way round: what was lost is struck through.
    const back = await render(stringify({ ...before, was: after }), { fonts: 'none' });
    const lost = (back.graph!.nodes[0]!.shape as MatrixShape);
    expect(lost.rows.find((x) => x.label === 'Dave')).toMatchObject({ change: 'removed' });
    expect(lost.cells.flat().some((c) => c?.change === 'removed' && c.text === '− Owner')).toBe(true);
    expect(back.svg).toContain('text-decoration="line-through"');
  });

  it('says so when nothing changed', async () => {
    const r = await render(stringify({ ...before, was: before }), { fonts: 'none' });
    expect(r.graph!.nodes[0]!.shape).toMatchObject({ kind: 'card', label: 'No access gained or lost' });
  });

  it('lists what everyone reaches', () => {
    const all = effectiveAccess(before);
    expect(all.find((x) => x.principal === 'carol' && x.scope === 'rg')!.reach.map((r) => [r.text, r.via])).toEqual([['Owner', 'sg-ops']]);
  });

  it('tells its steps in the graph, and draws a table without them', async () => {
    const text = `${source('graph')}steps:\n  - title: Production\n    path: sg-ops -> rg\n`;
    for (const view of ['graph', 'access', 'roles']) {
      const r = await render(text, { fonts: 'none', view });
      expect(r.diagnostics.filter((d) => d.severity === 'error'), view).toEqual([]);
    }
  });

  it('picks a view by name', async () => {
    const r = await render(source('graph'), { fonts: 'none', view: 'access' });
    expect(r.graph!.nodes[0]!.shape.kind).toBe('matrix');
    expect(r.views!.map((v) => v.name)).toEqual(['graph', 'access', 'packages', 'roles']);
  });

  it('another view than the one the file is written for is subtitled by its own name', async () => {
    const text = fs.readFileSync(new URL('../../../examples/access/engineering-access.yaml', import.meta.url), 'utf8');
    expect((await render(text, { fonts: 'none' })).graph!.subtitle).toBe('Who reaches where, through Entra ID access packages and Azure roles');
    expect((await render(text, { fonts: 'none', view: 'access' })).graph!.subtitle).toBe('Who reaches where, through Entra ID access packages and Azure roles');
    expect((await render(text, { fonts: 'none', view: 'roles' })).graph!.subtitle).toBe('Roles × permissions');
    expect((await render(text, { fonts: 'none', view: 'roles' })).graph!.title).toBe('Engineering access');
  });

  it('offers no view with nothing to show: no packages, no packages table', async () => {
    const r = await render(fs.readFileSync(new URL('../../../examples/workspace/access.yaml', import.meta.url), 'utf8'), {
      fonts: 'none',
      load: (f) => fs.readFileSync(new URL(`../../../examples/workspace/${f}`, import.meta.url), 'utf8'),
    });
    expect(r.views!.map((v) => v.name)).toEqual(['graph', 'access', 'roles']);
    expect(r.empty).toBeUndefined();
    // A table without a row is empty: --all-views and decks leave it out.
    expect((await render('type: access\nview: packages\n', { fonts: 'none' })).empty).toBe(true);
  });
});

describe('Entra kinds', () => {
  const entra = `type: access
policies:
  ca: { kind: conditional-access, label: CA001 Admins, targets: [sg-admins], excludes: bg, requires: [paw, phish, MFA], locations: office }
  phish: { kind: authentication-strength, label: Phishing-resistant MFA }
  office: { kind: named-location, label: Offices }
principals:
  bg: { kind: user, label: Break-glass }
  sg-admins: { kind: role-assignable-group, label: sg-admins, owners: bg, tags: [tier0] }
  paw: { kind: paw, label: PAW }
  app: { kind: app-registration, label: app-deploy }
  sp: { kind: service-principal, label: app-deploy, app: app }
  fic: { kind: federated-credential, label: github-prod, app: app }
packages:
  admin: { label: Admin access, grants: [sg-admins], policy: { id: admin-approval, requestors: [bg], approval: [manager, sg-admins] } }
resources:
  tenant: tenant
roles:
  ga: { label: Global Administrator }
assignments:
  - { principal: sg-admins, role: ga, scope: tenant, eligible: true, activation: 2 h, approval: sg-admins, tags: [tier0] }
  - sp is ga on tenant
`;

  it('draws Conditional Access, app registrations and owners as cards with their own lines', async () => {
    const r = await render(entra, { fonts: 'none' });
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const g = r.graph!;
    const line = (from: string, to: string) => g.edges.find((e) => e.from.node === from && e.to.node === to);
    expect(line('ca', 'sg-admins')?.kind).toBe('Applies to');
    expect(line('ca', 'bg')?.kind).toBe('Excludes');
    expect(line('ca', 'paw')?.kind).toBe('Requires');
    expect(line('ca', 'phish')?.kind).toBe('Requires');
    expect(line('ca', 'office')?.kind).toBe('Location condition');
    expect(line('bg', 'sg-admins')?.kind).toBe('Owns');
    expect(line('app', 'sp')?.kind).toBe('Service principal');
    expect(line('fic', 'app')?.kind).toBe('Federated credential of');
    // Words that name nothing are said on the card.
    expect(g.nodes.find((n) => n.id === 'ca')!.shape).toMatchObject({ caption: 'Requires MFA', icon: 'shield-half' });
    // PIM's settings on the line, in short; the policy card by its own id, its approval in any number.
    expect(line('sg-admins', 'tenant')).toMatchObject({ label: 'Global Administrator · 2 h · approval', line: 'dashed', tags: ['tier0'] });
    expect(g.nodes.find((n) => n.id === 'admin-approval')!.shape).toMatchObject({ label: 'Approval: manager → sg-admins' });
    expect(g.nodes.find((n) => n.id === 'sg-admins')!.tags).toEqual(['tier0']);
    expect(g.legend!.map((l) => l.label)).toEqual(expect.arrayContaining(['Policy applies to', 'Excluded from the policy', 'Policy requires', 'Owns', 'App and its service principal']));
  });

  it('keeps app registrations, credentials and devices out of the who × where rows, and tells how PIM activates', async () => {
    const r = await render(entra.replace('type: access', 'type: access\nview: access'), { fonts: 'none' });
    const m = r.graph!.nodes[0]!.shape as MatrixShape;
    expect(m.rows.map((x) => x.label)).toEqual(['Break-glass', 'sg-admins', 'app-deploy']);
    // Nobody holds Admin access: no column for the sg-admins it hands out.
    expect(m.cells[1]![0]).toMatchObject({ text: 'Global Administrator (eligible)', note: 'max 2\u00a0h, approval by sg-admins' });
  });

  it('checks what the new fields name', async () => {
    const bad = entra.replace('app: app }', 'app: nope }').replace('excludes: bg', 'excludes: nobody').replace('id: admin-approval', 'id: ca');
    const messages = (await render(bad, { fonts: 'none' })).diagnostics.map((d) => d.message);
    expect(messages).toEqual(expect.arrayContaining(['There is no app registration "nope"', 'There is no principal "nobody"', '"ca" is already the id of something else']));
  });

  it('follows a rename into policies, owners and app', async () => {
    const refs = findType('access')!.references!(parse(entra) as AccessSource);
    const at = (id: string) => refs.filter((r) => r.id === id).map((r) => r.path.join('.'));
    expect(at('bg')).toEqual(expect.arrayContaining(['principals.sg-admins.owners', 'policies.ca.excludes']));
    expect(at('app')).toEqual(expect.arrayContaining(['principals.sp.app', 'principals.fic.app']));
    expect(at('phish')).toEqual(['policies.ca.requires.1']);
  });

  it('says what each line means', async () => {
    const r = await render(entra, { fonts: 'none' });
    const text = toText(describeDiagram(r));
    expect(text).toContain('CA001 Admins applies to sg-admins');
    expect(text).toContain('excludes Break-glass');
    expect(text).toContain('requires PAW');
    expect(text).toContain('app-deploy (App registration) has the service principal app-deploy (Service principal)');
    expect(text).toContain('app-deploy (Service principal) is Global Administrator on tenant');
    expect(text).toContain('sg-admins can activate Global Administrator on tenant for at most 2 h, with approval by');
  });
});

describe('subtitles of a type\'s own views', () => {
  it('keeps the file\'s subtitle on the view drawn by default, also where that is not the first', async () => {
    const text = fs.readFileSync(new URL('../../../examples/capabilities/enterprise.yaml', import.meta.url), 'utf8');
    const plain = (await render(text, { fonts: 'none' })).graph!.subtitle;
    expect(plain).toBe('Baseline assessment 2026');
    expect((await render(text, { fonts: 'none', view: 'maturity' })).graph!.subtitle).toBe(plain);
    expect((await render(text, { fonts: 'none', view: 'investment' })).graph!.subtitle).toBe('Heatmap: Investment');
  });
});

describe('notes under a pill', () => {
  it('never break "8 h" over two lines', () => {
    for (let n = 1; n < 40; n++) {
      const note = `${'x'.repeat(n)} also Reader (from sub-shop-prod); max 8\u00a0h`;
      for (const line of wrapNote(note)) expect(line).not.toMatch(/^h\b/);
      for (const line of wrapText(note, 10.5, 400, 200, 8)) expect(line).not.toMatch(/^h\b/);
    }
  });

  it('end a line after a comma rather than leave a name hanging, when that takes no more lines', () => {
    expect(wrapNote('via sg-azure-platform-admins, from Northwind')).toEqual(['via sg-azure-platform-admins,', 'from Northwind']);
  });
});

// A lakehouse in small: two domains through two environments, a share and a mask.
const lake = (views: string) => `type: access
present: views
principals:
  engineers: account-group
  orders-team: { kind: account-group, member-of: engineers }
  sales-team: { kind: account-group, member-of: engineers }
  analysts: account-group
  sp-dev: { kind: service-principal, tags: [dev] }
  sp-prod: { kind: service-principal, tags: [prod] }
  contoso: { kind: recipient, tags: [prod] }
resources:
  dbw-prod: { kind: databricks, tags: [prod] }
  orders_dev: { kind: catalog, bound: dbw-prod, tags: [dev] }
  orders_prod: { kind: catalog, bound: dbw-prod, tags: [prod] }
  sales_prod: { kind: catalog, tags: [prod] }
  sales_gold: { kind: schema, in: sales_prod, tags: [prod] }
  share: { kind: share, tags: [prod] }
roles:
  browse: { label: BROWSE, permissions: [BROWSE] }
  read: { label: Read, inherits: browse, permissions: [SELECT] }
  write: { label: Write, inherits: read, permissions: [MODIFY] }
  manage: { label: MANAGE, inherits: read, permissions: [MANAGE] }
  share-read: { label: SELECT on share, permissions: [SELECT on share] }
policies:
  mask: { kind: column-mask, tag: pii, on: sales_prod, excludes: [sales-team] }
assignments:
  - orders-team is manage on orders_dev
  - orders-team is manage on orders_prod
  - sales-team is manage on sales_prod
  - sp-dev is write on orders_dev
  - sp-prod is write on orders_prod
  - sp-prod is write on sales_prod
  - engineers is browse on orders_prod
  - analysts is read on sales_gold
  - contoso is share-read on share
views:
${views}`;

describe('views of an access diagram', () => {
  const draw = (views: string, view?: string) => render(lake(views), { fonts: 'none', ...(view ? { view } : {}) });
  const table = (r: Awaited<ReturnType<typeof render>>) => {
    const m = r.graph!.nodes[0]!.shape as MatrixShape;
    return { rows: m.rows.map((x) => x.label), columns: m.columns.map((x) => x.label), m };
  };

  it('cuts the graph to the principals and scopes it picks, with the grants between them', async () => {
    const r = await draw('  orders:\n    title: Orders\n    include: [orders-team, orders_dev, orders_prod]');
    expect(r.diagnostics).toEqual([]);
    expect(r.graph!.title).toBe('Orders');
    expect(r.graph!.nodes.map((n) => n.id).sort()).toEqual(['orders-team', 'orders_dev', 'orders_prod']);
    expect(r.graph!.edges.map((e) => e.label)).toEqual(['MANAGE', 'MANAGE']);
  });

  it('leaves a side open that it names nothing of', async () => {
    const r = await draw('  sales:\n    include: [sales_prod.*]');
    expect(r.graph!.nodes.map((n) => n.id).sort()).toEqual(['analysts', 'mask', 'sales-team', 'sales_gold', 'sp-prod']);
    expect(r.graph!.groups.map((g) => g.id)).toEqual(['sales_prod']);
  });

  it('cuts the who × where matrix and the roles table alike', async () => {
    const r = await draw('  prod:\n    show: access\n    environment: prod\n    exclude: [kind:databricks, engineers]\n  roles-prod:\n    show: roles\n    environment: prod', 'prod');
    expect(r.diagnostics).toEqual([]);
    const t = table(r);
    // engineers left out with its grants: its members do not BROWSE through it here.
    expect(t.rows).toEqual(['orders-team', 'sales-team', 'analysts', 'sp-prod', 'contoso']);
    expect(t.columns).toEqual(['orders_prod', 'sales_prod', 'sales_gold', 'share']);
    const roles = table(await draw('  prod:\n    show: access\n  roles-prod:\n    show: roles\n    environment: prod', 'roles-prod'));
    expect(roles.rows).toEqual(['BROWSE', 'Read', 'Write', 'MANAGE', 'SELECT on share']);
  });

  it('says in the matrix what a data policy does to what is read, and to whom it does not', async () => {
    const t = table(await draw('  prod:\n    show: access\n    environment: prod'));
    const cell = (row: string, col: string) => t.m.cells[t.rows.indexOf(row)]![t.columns.indexOf(col)];
    expect(cell('analysts', 'sales_gold')!.note).toContain('columns tagged pii masked');
    expect(cell('sales-team', 'sales_prod')!.note ?? '').not.toContain('masked');
    // BROWSE reads no rows: nothing to mask.
    expect(cell('engineers', 'orders_prod')!.note ?? '').not.toContain('masked');
  });

  it('draws the graph in columns: who, their groups, then where', async () => {
    const r = await draw('  all:\n    include: ["*"]');
    const x = (id: string) => r.placed!.nodes.get(id)!.x;
    expect(x('orders-team')).toBeLessThan(x('engineers'));
    expect(x('sp-dev')).toBeLessThan(x('engineers'));
    expect(x('engineers')).toBeLessThan(x('orders_dev'));
    expect(r.graph!.nodes.find((n) => n.id === 'orders_dev')!.shape).toMatchObject({ caption: 'Bound to dbw-prod' });
    expect(r.graph!.nodes.find((n) => n.id === 'mask')!.shape).toMatchObject({ caption: 'Masks columns tagged pii', icon: 'eye-off' });
  });

  it('presents the views alone, and warns about a view named like one of its drawings', async () => {
    const r = await draw('  a: { include: [orders-team] }\n  roles: { show: roles }');
    expect(r.views!.map((v) => v.name)).toEqual(['a', 'roles']);
    expect(r.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining('"roles" is also the name of one of this type\'s own drawings')]);
    const bad = await draw('  a: { show: packages-table }');
    expect(bad.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining('There is no drawing "packages-table"')]);
  });

  it('checks what a binding and a data policy name', async () => {
    const r = await render(lake('  a: { include: [orders-team] }').replace('bound: dbw-prod, tags: [dev]', 'bound: dbw-nope, tags: [dev]').replace('on: sales_prod', 'on: nope'), { fonts: 'none' });
    expect(r.diagnostics.map((d) => d.message).sort()).toEqual(['There is no resource "nope"', 'There is no workspace "dbw-nope" under resources']);
  });
});
