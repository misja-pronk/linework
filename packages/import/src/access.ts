// Who can reach what, from real exports → `type: access`. A folder of JSON files as the Azure CLI,
// Microsoft Graph or AzureHound write them becomes one diagram; importing again over that diagram
// keeps what was changed by hand. Nothing is fetched: every file is read where it is.
import { AzureReader, type Notes } from './access-azure.ts';
import { DIRECTORY, Directory, type DirPrincipal, type DirScope } from './access-dir.ts';
import { houndRecords, readHound } from './access-hound.ts';
import type { MeshProblem } from './data-mesh.ts';
import { Kept, isObj } from './keep.ts';
import { slug, Warnings } from './text.ts';

export interface ExportFile {
  path: string;
  text: string;
}

export interface AccessOptions {
  title?: string;
  /** The diagram an earlier import made: its ids, labels and hand-made entries are kept. */
  existing?: string;
  /** Who is drawn besides those who hold a role themselves: `all` members of groups, only the `groups`, or `auto`: members as long as there are few. */
  principals?: 'auto' | 'all' | 'groups';
  /** With `auto`: the number of group members above which they are folded into their groups. 30 when not given. */
  collapseAbove?: number;
  /** Only this scope and what is in it: a resource id prefix (/subscriptions/…) or a name (rg-shop). What is above it stays, since its roles reach it. */
  scope?: string;
  /** How deep scopes go: 1 management groups and subscriptions, 2 resource groups too, 3 and up the resources in them. A role held deeper is drawn as held in part on what is above. */
  depth?: number;
  /** Without `depth` or `scope`: the number of scopes above which the deepest are folded away. 24 when not given. */
  scopesAbove?: number;
  /** `access`: groups and service principals that reach exactly the same are drawn as one; `none`: never. Not given: as one once more than `collapseAbove` identities are drawn. */
  groupBy?: 'access' | 'none';
}

export interface ImportedExport {
  /** Cartography YAML; empty when nothing could be imported. */
  yaml: string;
  warnings: string[];
  problems: MeshProblem[];
  /** What each file turned out to be. */
  read: { file: string; what: string; count: number }[];
  skipped: { file: string; why: string }[];
  /** What the diagram holds, in a few words. */
  summary: string;
}

const GROUPS = ['group', 'dynamic-group', 'role-assignable-group', 'm365-group'];
/** Azure's own ladder: the only roles whose order everyone knows. */
const LADDER: Record<string, string> = { 'b24988ac-6180-42a0-ab88-20f7382dd24c': 'acdd72a7-3385-48ef-bd42-f606fba81ae7', '8e3af657-a8ff-443c-a75c-2fe8c4bcb635': 'b24988ac-6180-42a0-ab88-20f7382dd24c' };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** What several of a kind are called, for the kinds that are drawn as one when they reach the same. People stay themselves. */
const MANY: Record<string, string> = { group: 'groups', 'role-assignable-group': 'role-assignable groups', 'dynamic-group': 'dynamic groups', 'm365-group': 'Microsoft 365 groups', 'service-principal': 'service principals', 'managed-identity': 'managed identities' };

/** sg-shop-readers, sg-data-readers → sg-*-readers: what the names share, cut where a word ends. */
function pattern(names: string[]): string | undefined {
  const short = Math.min(...names.map((n) => n.length));
  let head = 0;
  while (head < short && names.every((n) => n[head] === names[0]![head])) head++;
  let tail = 0;
  while (tail < short - head && names.every((n) => n.at(-1 - tail) === names[0]!.at(-1 - tail))) tail++;
  const first = names[0]!;
  while (head > 0 && /[A-Za-z0-9]/.test(first[head - 1]!)) head--;
  while (tail > 0 && /[A-Za-z0-9]/.test(first.at(-tail)!)) tail--;
  return head + tail >= 3 ? `${first.slice(0, head)}*${tail ? first.slice(-tail) : ''}` : undefined;
}

function parse(files: ExportFile[], warn: Warnings) {
  const dir = new Directory();
  const read: ImportedExport['read'] = [];
  const skipped: ImportedExport['skipped'] = [];
  const problems: MeshProblem[] = [];
  const reader = new AzureReader(dir, (topic, message) => warn.onceFor(topic, message));
  for (const f of files) {
    const note: Notes = {
      read: (what, count) => void read.push({ file: f.path, what, count }),
      skip: (why) => void skipped.push({ file: f.path, why }),
      warn: (topic, message) => warn.onceFor(topic, message),
    };
    if (!/\.json$/i.test(f.path)) {
      note.skip('not a JSON file');
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(f.text.replace(/^﻿/, ''));
    } catch (e) {
      problems.push({ file: f.path, message: `Not valid JSON: ${(e as Error).message}`, severity: 'error' });
      note.skip('not valid JSON');
      continue;
    }
    const records = houndRecords(json);
    if (records) readHound(dir, records, note);
    else if (!reader.file(f.path, json, note)) note.skip('not an access export this reads');
  }
  reader.finish();
  return { dir, read, skipped, problems };
}

/** Is this one file something the access importer reads? */
export function isAccessExport(text: string): boolean {
  if (!/^\s*[[{]/.test(text)) return false;
  const { read } = parse([{ path: 'file.json', text }], new Warnings());
  return read.length > 0;
}

export function importAccess(files: ExportFile[], opts: AccessOptions = {}): ImportedExport {
  const warn = new Warnings();
  const { dir, read, skipped, problems } = parse(files, warn);
  const nothing = (message: string): ImportedExport => ({ yaml: '', warnings: [...warn.list, message], problems, read, skipped, summary: '' });
  if (!dir.assignments.size && !dir.packages.size) return nothing('No role assignments or access packages in these files: nothing to draw');

  // ---- which scopes
  const scopes = dir.scopes;
  const root = scopes.get('/');
  // The root reaches every management group and subscription that has nothing above it.
  if (root) for (const s of scopes.values()) if (!s.parent && s !== root && s.key.startsWith('/')) s.parent = root.key;
  if (dir.tenant && scopes.has(DIRECTORY)) scopes.get(DIRECTORY)!.name = dir.tenant;
  // A management group nothing is known to be in: its roles reach further than the picture can say.
  for (const s of scopes.values())
    if (s.kind === 'management-group' && ![...scopes.values()].some((x) => x.parent === s.key) && [...dir.assignments.values()].some((a) => a.scope === s.key))
      warn.add(`What is in management group ${s.name} is not in these files, so its roles are not shown on the subscriptions under it: add az account management-group show --name ${s.id.split('/').pop()} --expand --recurse -o json`);
  const above = (key: string): string[] => {
    const out: string[] = [];
    for (let p = scopes.get(key)?.parent; p && !out.includes(p); p = scopes.get(p)?.parent) out.push(p);
    return out;
  };
  let assignments = [...dir.assignments.values()];
  let packages = [...dir.packages.values()];
  if (opts.scope) {
    const needle = opts.scope.toLowerCase().replace(/\/+$/, '');
    const hit = [...scopes.values()].filter((s) => s.key.startsWith(needle) || s.name.toLowerCase() === needle).map((s) => s.key);
    if (!hit.length) warn.add(`No scope is called "${opts.scope}" or starts with it: everything is drawn`);
    else {
      const within = (key: string) => hit.includes(key) || above(key).some((a) => hit.includes(a));
      const over = new Set(hit.flatMap(above));
      const all = assignments.length;
      assignments = assignments.filter((a) => within(a.scope) || over.has(a.scope));
      if (all > assignments.length) warn.add(`${plural(all - assignments.length, 'role assignment')} outside ${opts.scope} left out`);
      const holding = new Set(assignments.map((a) => a.principal));
      packages = packages.filter((p) => p.grants.some((g) => g.principal && holding.has(g.principal)));
    }
  }
  // ---- how deep: a role held further down than is drawn is held "in part" on what is drawn above it.
  const level = (key: string) => scopes.get(key)!.level;
  const deepest = Math.max(1, ...assignments.map((a) => level(a.scope)));
  let depth = opts.depth && opts.depth < deepest ? Math.max(1, opts.depth) : undefined;
  if (!opts.depth && !opts.scope) {
    const count = (d: number) => new Set(assignments.flatMap((a) => [a.scope, ...above(a.scope)].filter((k) => level(k) <= d))).size;
    let d = deepest;
    while (d > 1 && count(d) > (opts.scopesAbove ?? 24)) d--;
    if (d < deepest) {
      depth = d;
      warn.add(`${plural(count(deepest), 'scope')} are many for one picture: ${d === 1 ? 'resource groups and what is in them are' : 'the resources in resource groups are'} folded into what they are in, where a role held further down reads "(in part)". --depth ${deepest} draws them all, --scope <name> one part`);
    }
  }
  if (depth) {
    const folded = new Map<string, (typeof assignments)[number]>();
    const held = new Set(assignments.filter((a) => level(a.scope) <= depth).map((a) => `${a.principal} ${a.role} ${a.scope}`));
    for (const a of assignments) {
      if (level(a.scope) <= depth) {
        folded.set(`${a.principal} ${a.role} ${a.scope}`, a);
        continue;
      }
      const up = above(a.scope);
      const on = up.find((k) => level(k) <= depth);
      // Held in full there or above: the part adds nothing.
      if (!on || up.some((k) => held.has(`${a.principal} ${a.role} ${k}`))) continue;
      const whole = dir.roles.get(a.role)!;
      const part = `${a.role}#part`;
      if (!dir.roles.has(part)) dir.roles.set(part, { key: part, name: `${whole.name ?? `Role ${whole.key.slice(0, 8)}`} (in part)` });
      folded.set(`${a.principal} ${part} ${on}`, { principal: a.principal, role: part, scope: on });
    }
    assignments = [...folded.values()];
  }
  const drawn = new Set<string>();
  for (const a of assignments) for (const s of [a.scope, ...above(a.scope)]) drawn.add(s);
  for (const p of packages) for (const g of p.grants) if (g.resource) drawn.add(g.resource);
  // A subscription nobody has a role on itself still shows what it gets from above.
  for (const s of scopes.values()) if (s.level === 1 && s.parent && !opts.scope && above(s.key).some((a) => assignments.some((x) => x.scope === a))) drawn.add(s.key);

  // ---- which principals
  const holds = new Set<string>(assignments.map((a) => a.principal));
  for (const p of packages) {
    for (const h of p.holders) holds.add(h);
    for (const g of p.grants) if (g.principal) holds.add(g.principal);
    for (const pol of p.policies) for (const k of [...pol.requestors, ...pol.approval.flatMap((a) => a.principal ?? [])]) holds.add(k);
  }
  const everyone = [...dir.principals.values()];
  const isGroup = (p: DirPrincipal) => GROUPS.includes(p.kind ?? '');
  // Members of what is drawn, groups inside groups first: a nested group brings its own members along.
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of everyone) if (isGroup(p) && !holds.has(p.key) && [...p.memberOf].some((g) => holds.has(g))) grew = !!holds.add(p.key);
  }
  const members = everyone.filter((p) => !isGroup(p) && !holds.has(p.key) && [...p.memberOf].some((g) => holds.has(g)));
  const fold = opts.principals === 'groups' || (opts.principals !== 'all' && members.length > (opts.collapseAbove ?? 30));
  const size = new Map<string, number>();
  const inside = (group: string, seen = new Set<string>()): Set<string> => {
    for (const p of everyone) if (p.memberOf.has(group) && !seen.has(p.key)) (seen.add(p.key), isGroup(p) && inside(p.key, seen));
    return seen;
  };
  if (fold) {
    for (const k of holds) if (isGroup(dir.principals.get(k)!)) size.set(k, [...inside(k)].filter((m) => !isGroup(dir.principals.get(m)!)).length);
    warn.add(`${plural(members.length, 'member')} of groups folded into their groups, which say how many they are: --principals all draws each of them`);
  } else for (const p of members) holds.add(p.key);
  const out = everyone.length - holds.size - (fold ? members.length : 0);
  if (out > 0) warn.add(`${plural(out, 'identity', 'identities')} left out: no role, group or access package here leads anywhere for them`);

  // ---- names for what has none
  const allListed = dir.listed.size === 3;
  let unnamed = 0;
  let principals = [...holds].map((k) => dir.principals.get(k)!).map((p) => {
    const gone = p.kind === 'unknown' || (!p.found && !p.name && (allListed || (p.kind === 'user' && dir.listed.has('users')) || (p.kind === 'group' && dir.listed.has('groups'))));
    if (gone) return { ...p, kind: 'unknown', name: 'Identity not found', caption: p.key.slice(0, 8) };
    if (!p.name) unnamed++;
    return { ...p, kind: p.kind ?? 'user', name: p.name ?? `Identity ${p.key.slice(0, 8)}`, caption: p.caption ?? (size.get(p.key) ? plural(size.get(p.key)!, 'member') : undefined) };
  });
  if (unnamed) warn.add(`${plural(unnamed, 'identity is', 'identities are')} known by id only: add the listings of users, groups and service principals (az ad user list, az ad group list, az ad sp list) for their names`);

  // ---- groups and service principals that reach exactly the same, as one: eight reader groups are one thing to look at.
  const same = new Map<string, string>();
  if (opts.groupBy === 'access' || (opts.groupBy !== 'none' && principals.length > (opts.collapseAbove ?? 30))) {
    const named = new Set(packages.flatMap((p) => [...p.holders, ...p.grants.flatMap((g) => g.principal ?? []), ...p.policies.flatMap((pol) => [...pol.requestors, ...pol.approval.flatMap((a) => a.principal ?? [])])]));
    const reach = new Map<string, string[]>();
    for (const a of assignments) reach.set(a.principal, [...(reach.get(a.principal) ?? []), `${a.role} ${a.scope}`]);
    const alike = new Map<string, typeof principals>();
    for (const p of principals) {
      if (!MANY[p.kind] || named.has(p.key) || !reach.has(p.key)) continue;
      const sign = [p.kind, reach.get(p.key)!.sort().join(' | '), [...p.memberOf].filter((g) => holds.has(g)).sort().join(' ')].join('\n');
      alike.set(sign, [...(alike.get(sign) ?? []), p]);
    }
    const said: string[] = [];
    for (const list of alike.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => a.name.localeCompare(b.name, 'en'));
      // Named after the one whose id sorts first, so the entry is found again as long as that one is in it.
      const key = `${list.map((p) => p.key).sort()[0]}+${list.length - 1}`;
      const members = fold && isGroup(list[0]!) ? new Set(list.flatMap((p) => [...inside(p.key)].filter((m) => !isGroup(dir.principals.get(m)!)))).size : 0;
      const name = pattern(list.map((p) => p.name)) ?? `${list[0]!.name} and ${list.length - 1} more`;
      for (const p of list) same.set(p.key, key);
      principals.push({ key, name, kind: list[0]!.kind, caption: `${list.length} ${MANY[list[0]!.kind]}${members ? `, ${plural(members, 'member')}` : ''}`, memberOf: list[0]!.memberOf, found: true });
      holds.add(key);
      said.push(`${name} (${list.length})`);
    }
    if (same.size) {
      principals = principals.filter((p) => !same.has(p.key));
      const one = new Map(assignments.map((a) => [`${same.get(a.principal) ?? a.principal} ${a.role} ${a.scope}`, { ...a, principal: same.get(a.principal) ?? a.principal }]));
      assignments = [...one.values()];
      warn.add(`${same.size} identities that reach exactly the same are drawn as ${said.length === 1 ? 'one' : said.length}: ${said.join(', ')}. --group-by none draws each of them`);
    }
  }
  const roleKeys = [...new Set(assignments.map((a) => a.role))];
  const nameless = roleKeys.filter((k) => !dir.roles.get(k)!.name && !k.endsWith('#part'));
  if (nameless.length) warn.add(`${plural(nameless.length, 'role is', 'roles are')} known by id only: add az role definition list -o json for their names`);

  // ---- the diagram
  const kept = Kept.open('access', opts.existing, { title: opts.title ?? (dir.tenant ? `${dir.tenant}: who reaches what` : 'Who reaches what') });
  if (typeof kept === 'string') return { ...nothing(kept), problems: [...problems, { message: kept, severity: 'error' }] };

  // Ids: readable, from the name; what an earlier import called something stays, so pins and hand edits hold.
  const taken = new Set<string>(['principals', 'resources', 'packages', 'catalogs'].flatMap((c) => Object.keys(kept.before(c))));
  const earlier = (collection: string, marker: string, short = 'kind') =>
    new Map(Object.entries(kept.before(collection, short)).flatMap(([id, v]) => (typeof v[marker] === 'string' ? [[v[marker].toLowerCase(), id] as [string, string]] : [])));
  function ids<T>(items: T[], known: Map<string, string>, used: Set<string>, of: (x: T) => { key: string; name: string; else: string[] }): Map<string, string> {
    const out = new Map<string, string>();
    const todo = items.map(of).sort((a, b) => (a.key < b.key ? -1 : 1));
    const base = (name: string) => slug(name).toLowerCase();
    const twice = new Set(todo.map((x) => base(x.name)).filter((b, i, all) => all.indexOf(b) !== i));
    for (const x of todo) if (known.has(x.key)) out.set(x.key, known.get(x.key)!);
    for (const x of todo) {
      if (out.has(x.key)) continue;
      const b = base(x.name);
      const tries = [...(twice.has(b) ? [] : [b]), ...x.else.map((e) => `${b}-${base(e)}`)];
      let id = tries.find((t) => !used.has(t));
      for (let n = 2; !id; n++) if (!used.has(`${tries.at(-1) ?? b}-${n}`)) id = `${tries.at(-1) ?? b}-${n}`;
      used.add(id);
      out.set(x.key, id);
    }
    return out;
  }
  const principalId = ids(principals, earlier('principals', 'object-id'), taken, (p) => ({ key: p.key, name: p.name, else: [p.key.slice(0, 4), p.key.slice(0, 8)] }));
  const resources = [...drawn].map((k) => scopes.get(k)!);
  const resourceId = ids(resources, earlier('resources', 'resource-id'), taken, (s) => ({ key: s.id.toLowerCase(), name: s.name, else: [...(s.parent ? [scopes.get(s.parent)!.name] : []), s.kind] }));
  const packageId = ids(packages, earlier('packages', 'object-id'), taken, (p) => ({ key: p.key, name: p.name ?? `Package ${p.key.slice(0, 8)}`, else: ['package', p.key.slice(0, 4)] }));
  const catalogs = [...new Set(packages.flatMap((p) => p.catalog ?? []))].map((k) => dir.catalogs.get(k) ?? { key: k });
  const catalogId = ids(catalogs, earlier('catalogs', 'object-id', 'label'), taken, (c) => ({ key: c.key, name: c.name ?? `Catalog ${c.key.slice(0, 8)}`, else: ['catalog', c.key.slice(0, 4)] }));
  const roles = [...new Set([...roleKeys, ...roleKeys.map((k) => LADDER[k]).filter((k) => k && dir.roles.has(k))])].map((k) => dir.roles.get(k!)!);
  const roleId = ids(roles, earlier('roles', 'role-id'), new Set(Object.keys(kept.before('roles'))), (r) => ({ key: r.key, name: r.name ?? `Role ${r.key.slice(0, 8)}`, else: [r.key.slice(0, 4)] }));
  const rid = (s: DirScope) => resourceId.get(s.id.toLowerCase())!;

  // What an earlier import made and this one no longer finds goes; what was added by hand has no marker and stays.
  const gone = new Set<string>();
  const sweep = (collection: string, marker: string, now: Set<string>, short = 'kind') => {
    for (const [id, v] of Object.entries(kept.before(collection, short))) if (typeof v[marker] === 'string' && !now.has(id)) (kept.drop(collection, id), gone.add(id));
  };
  const imported = (collection: string, marker: string, id: string) => typeof kept.before(collection)[id]?.[marker] === 'string';

  const order = ['role-assignable-group', 'group', 'm365-group', 'dynamic-group', 'connected-org', 'user', 'guest', 'service-principal', 'managed-identity', 'unknown'];
  const byName = <T extends { name?: string }>(a: T, b: T) => (a.name ?? '').localeCompare(b.name ?? '', 'en');
  sweep('principals', 'object-id', new Set(principalId.values()));
  for (const p of principals.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || byName(a, b))) {
    const id = principalId.get(p.key)!;
    const memberOf = [...new Set([...p.memberOf].filter((g) => holds.has(g)).map((g) => principalId.get(same.get(g) ?? g)!))].sort();
    const was = kept.before('principals')[id]?.caption;
    // A caption this import wrote (a count of members) follows the export; any other one was written by hand.
    const counted = was === undefined || /^\d+ members?$/.test(String(was));
    kept.put('principals', id, { kind: p.kind, label: p.name === id ? undefined : p.name, caption: p.caption, 'member-of': memberOf.length > 1 ? memberOf : memberOf[0], 'object-id': p.key }, ['kind', 'member-of', 'object-id', ...(counted ? ['caption'] : [])]);
  }
  sweep('catalogs', 'object-id', new Set(catalogId.values()), 'label');
  for (const c of catalogs.sort(byName)) kept.put('catalogs', catalogId.get(c.key)!, { label: c.name ?? `Catalog ${c.key.slice(0, 8)}`, 'object-id': c.key }, ['object-id']);
  sweep('packages', 'object-id', new Set(packageId.values()));
  for (const p of packages.sort(byName)) {
    const policies = p.policies.map((pol) => {
      const approval = pol.approval.map((a) => (a.principal && principalId.get(a.principal)) || a.text!).filter(Boolean);
      const requestors = pol.requestors.map((k) => principalId.get(k)!).filter(Boolean);
      return { requestors: requestors.length ? requestors : undefined, approval: approval.length ? approval : undefined, duration: pol.duration, review: pol.review, auto: pol.auto };
    }).map((pol) => Object.fromEntries(Object.entries(pol).filter(([, v]) => v !== undefined)));
    const grants = p.grants.map((g) => (g.principal ? principalId.get(g.principal)! : { [rid(scopes.get(g.resource!)!)]: g.role }));
    const holders = [...p.holders].map((h) => principalId.get(h)!).filter(Boolean).sort();
    kept.put(
      'packages',
      packageId.get(p.key)!,
      { catalog: p.catalog && catalogId.get(p.catalog), label: p.name ?? `Package ${p.key.slice(0, 8)}`, caption: p.caption, grants: grants.length ? grants : undefined, policy: policies.length > 1 ? policies : policies[0], holders: holders.length ? holders : undefined, 'object-id': p.key },
      ['catalog', 'grants', 'policy', 'holders', 'object-id'],
      ['grants', 'policy', 'holders'],
    );
  }
  sweep('resources', 'resource-id', new Set(resourceId.values()));
  // A scope right before what is in it; Azure first, then the directory, then applications and sites.
  const place = (s: DirScope) => (s.key.startsWith('/') ? 0 : s.key.startsWith(DIRECTORY) ? 1 : 2);
  const tree: DirScope[] = [];
  const walk = (parent: string | undefined) => {
    for (const s of resources.filter((x) => (x.parent && drawn.has(x.parent) ? x.parent : undefined) === parent).sort((a, b) => place(a) - place(b) || byName(a, b))) (tree.push(s), walk(s.key));
  };
  walk(undefined);
  for (const s of tree) kept.put('resources', rid(s), { kind: s.kind, label: s.name === rid(s) ? undefined : s.name, caption: s.caption, in: s.parent && drawn.has(s.parent) ? rid(scopes.get(s.parent)!) : undefined, 'resource-id': s.id }, ['kind', 'in', 'resource-id']);
  sweep('roles', 'role-id', new Set(roleId.values()));
  const rank = (key: string): number => (LADDER[key] && dir.roles.has(LADDER[key]) ? 1 + rank(LADDER[key]) : 0);
  for (const r of roles.sort((a, b) => Number(!(a.key in LADDER || Object.values(LADDER).includes(a.key))) - Number(!(b.key in LADDER || Object.values(LADDER).includes(b.key))) || rank(a.key) - rank(b.key) || byName(a, b)))
    kept.put('roles', roleId.get(r.key)!, { label: r.name ?? `Role ${r.key.slice(0, 8)}`, inherits: LADDER[r.key] && roleId.get(LADDER[r.key]!), permissions: r.permissions?.length ? r.permissions : undefined, part: r.key.endsWith('#part') || undefined, 'role-id': r.key }, ['inherits', 'permissions', 'part', 'role-id']);

  // Assignments: those between what the export speaks for follow it; one that names something made by hand stays.
  const at = new Map(tree.map((s, i) => [s.key, i]));
  const lines = assignments
    .sort((a, b) => at.get(a.scope)! - at.get(b.scope)! || principalId.get(a.principal)!.localeCompare(principalId.get(b.principal)!) || roleId.get(a.role)!.localeCompare(roleId.get(b.role)!))
    .map((a) => `${principalId.get(a.principal)} is ${roleId.get(a.role)} on ${rid(scopes.get(a.scope)!)}`);
  const old = Array.isArray(kept.old.assignments) ? kept.old.assignments : [];
  const parts = (a: unknown): string[] | undefined => (typeof a === 'string' ? /^\s*(\S+)\s+is\s+(\S+)\s+on\s+(\S+)\s*$/.exec(a)?.slice(1) : isObj(a) ? [String(a.principal), String(a.role), String(a.scope)] : undefined);
  const stay = old.filter((a) => {
    const p = parts(a);
    if (!p) return true;
    if (p.some((id) => gone.has(id))) return false;
    const byHand = !imported('principals', 'object-id', p[0]!) || !imported('roles', 'role-id', p[1]!) || !imported('resources', 'resource-id', p[2]!);
    return byHand || lines.includes(`${p[0]} is ${p[1]} on ${p[2]}`);
  });
  const there = new Set(stay.map((a) => parts(a)?.join(' ')));
  kept.list('assignments', [...stay, ...lines.filter((l) => !there.has(l.replace(/ (is|on) /g, ' ')))]);
  kept.tidy(['principals', 'catalogs', 'packages', 'resources', 'roles']);

  const summary = [plural(principals.length, 'identity', 'identities'), `${plural(lines.length, 'role assignment')} on ${plural(tree.length, 'scope')}`, ...(packages.length ? [plural(packages.length, 'access package')] : [])].join(', ');
  return { yaml: kept.text(), warnings: warn.list, problems, read, skipped, summary };
}

