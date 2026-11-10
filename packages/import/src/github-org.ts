// A GitHub organisation from saved `gh api` responses → `type: github` (teams, repositories and what
// guards them), or `type: access` (who reaches which repository, as a matrix). Importing again over
// the diagram keeps what was changed by hand. Nothing is fetched: every file is read where it is.
import { Directory } from './access-dir.ts';
import { drawAccess, type AccessOptions, type ExportFile, type ImportedExport } from './access.ts';
import type { Notes } from './access-azure.ts';
import type { MeshProblem } from './data-mesh.ts';
import { GithubOrg, LEVELS, parsePages, rulesText, type GhRepo, type GhTeam } from './github-read.ts';
import { Kept, isObj, type Obj } from './keep.ts';
import { slug, Warnings } from './text.ts';

export interface GithubOptions extends AccessOptions {
  /** `github` (the default): the organisation as it is set up. `access`: who reaches which repository, with the matrix an access diagram has. */
  as?: 'github' | 'access';
  /** The number of repositories above which a team that is admin on them is worth a warning. 5 when not given. */
  adminAbove?: number;
}

/** The entries an import writes carry this tag: it is how the next import knows them from what was added by hand. */
const IMPORTED = 'imported';
/** The edge styles an import speaks for; an edge of another style between two imported entries was drawn by hand. */
const MINE = ['access', 'member', 'protects'];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const rank = (p: string | undefined) => (p ? LEVELS.indexOf(p) : -1);
const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, 'en');
/** As many names as a caption has room for, and how many more there are. */
const few = (names: string[], room = 36) => {
  let n = 1;
  while (n < names.length && names.slice(0, n + 1).join(', ').length <= room) n++;
  return `${names.slice(0, n).join(', ')}${names.length > n ? ` +${names.length - n}` : ''}`;
};
/** The parts that fit a caption, the most telling first: the picture cuts a longer one off mid-word. */
const fit = (parts: (string | undefined)[], room = 40): string | undefined => {
  const out: string[] = [];
  for (const p of parts) if (p && (!out.length || [...out, p].join(' · ').length <= room)) out.push(p);
  return out.join(' · ') || undefined;
};
const some = (names: string[], max = 6) => (names.length > max ? `${names.slice(0, max).join(', ')} and ${names.length - max} more` : names.join(', '));

/** shop-api, shop-web → shop-*: what the names share, cut where a word ends. */
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
  const org = new GithubOrg();
  const read: ImportedExport['read'] = [];
  const skipped: ImportedExport['skipped'] = [];
  const problems: MeshProblem[] = [];
  for (const f of files) {
    const note: Notes = {
      read: (what, count) => void read.push({ file: f.path, what, count }),
      skip: (why) => void skipped.push({ file: f.path, why }),
      warn: (topic, message) => warn.onceFor(topic, message),
    };
    const parts = f.path.split(/[\\/]+/);
    if (/^codeowners(\.txt)?$/i.test(parts.at(-1)!)) {
      const at = parts.map((p) => p.toLowerCase()).lastIndexOf('repos');
      if (at >= 0 && parts.length - at >= 3) note.read('CODEOWNERS rules', org.owned(parts[at + 1]!.toLowerCase(), f.text));
      else note.skip('CODEOWNERS, but not in a folder repos/<repository>/: which repository is not known');
      continue;
    }
    if (!/\.json$/i.test(f.path)) {
      note.skip('not a JSON file');
      continue;
    }
    let json: unknown;
    try {
      json = parsePages(f.text);
    } catch (e) {
      problems.push({ file: f.path, message: `Not valid JSON: ${(e as Error).message}`, severity: 'error' });
      note.skip('not valid JSON');
      continue;
    }
    if (!org.file(f.path, json, note)) note.skip('not a GitHub export this reads');
  }
  return { org, read, skipped, problems };
}

/** Is this one file something the GitHub importer reads? */
export function isGithubExport(text: string): boolean {
  if (!/^\s*[[{]/.test(text)) return false;
  const { read } = parse([{ path: 'file.json', text }], new Warnings());
  return read.some((r) => r.what !== 'empty list');
}

/** What a team reaches by itself: its own listing without what it has from the teams above it. */
function own(org: GithubOrg, t: GhTeam): Map<string, string> {
  const out = new Map<string, string>();
  const above: GhTeam[] = [];
  for (let p = t.parent && org.teams.get(t.parent); p && !above.includes(p); p = p.parent && org.teams.get(p.parent)) above.push(p);
  for (const [repo, p] of t.repos) if (!above.some((a) => rank(a.repos.get(repo)) >= rank(p) && (rank(p) >= 0 || a.repos.get(repo) === p))) out.set(repo, p);
  return out;
}

/** The checks an export can answer by itself. Quiet in the picture: they are warnings. */
function check(org: GithubOrg, repos: GhRepo[], opts: GithubOptions, warn: Warnings, graph: boolean): void {
  const bare = repos.filter((r) => !r.archived && org.ruled.has(r.key) && !org.protection.get(r.key) && ![...org.rulesets.values()].some((s) => org.covers(s, r) !== false));
  if (bare.length) warn.add(`${plural(bare.length, 'repository has', 'repositories have')} no ruleset or branch protection on the default branch: ${some(bare.map((r) => r.name).sort())}`);
  const many = opts.adminAbove ?? 5;
  for (const t of [...org.teams.values()].sort(byName)) {
    const n = [...own(org, t)].filter(([repo, p]) => p === 'admin' && repos.some((r) => r.key === repo)).length;
    if (n > many) warn.add(`Team ${t.name} is admin on ${n} repositories`);
  }
  // In an access diagram the type itself says these two.
  if (!graph) return;
  for (const r of repos) {
    for (const [who, p] of org.collaborators.get(r.key) ?? []) {
      const person = org.people.get(who)!;
      if (person.outside && p === 'admin') warn.add(`Outside collaborator ${person.login} is admin on ${r.name}`);
      const through = [...org.teams.values()].find((t) => t.members?.has(who) && rank(t.repos.get(r.key)) >= rank(p) && rank(p) >= 0);
      if (!person.outside && through) warn.add(`${person.login} is ${p} on ${r.name} directly, and already through team ${through.name}`);
    }
  }
}

export function importGithub(files: ExportFile[], opts: GithubOptions = {}): ImportedExport {
  const warn = new Warnings();
  const { org, read, skipped, problems } = parse(files, warn);
  const nothing = (message: string): ImportedExport => ({ yaml: '', warnings: [...warn.list, message], problems, read, skipped, summary: '' });
  if (!org.teams.size && !org.repos.size) return nothing('No teams or repositories in these files: nothing to draw');

  let repos = [...org.repos.values()].sort(byName);
  if (opts.scope) {
    const needle = opts.scope.toLowerCase().replace(/\*+$/, '');
    const hit = repos.filter((r) => r.key.startsWith(needle));
    if (!hit.length) warn.add(`No repository is called "${opts.scope}" or starts with it: everything is drawn`);
    else {
      warn.add(`${plural(repos.length - hit.length, 'repository', 'repositories')} outside ${opts.scope} left out`);
      repos = hit;
    }
  }
  check(org, repos, opts, warn, opts.as !== 'access');
  if (opts.as === 'access') return asAccess(org, repos, opts, warn, { read, skipped, problems });

  const shown = new Set(repos.map((r) => r.key));
  const title = opts.title ?? `${org.name ?? org.login ?? 'GitHub'}: teams and repositories`;
  const kept = Kept.open('github', opts.existing, { title });
  if (typeof kept === 'string') return { ...nothing(kept), problems: [...problems, { message: kept, severity: 'error' }] };

  // ---- how deep: 1 the organisation, teams and repositories; 2 what is in a repository too.
  const many = repos.length > (opts.scopesAbove ?? 24);
  const deep = opts.depth ? opts.depth >= 2 : !many || !!opts.scope;
  const has = (r: GhRepo) => !!(org.environments.get(r.key)?.length || org.protection.get(r.key) || org.codeowners.get(r.key)?.length || org.secrets.get(r.key)?.length || org.variables.get(r.key)?.length || [...org.rulesets.values()].some((s) => !s.org && s.repo === r.key));
  if (!deep && !opts.depth && repos.some(has)) warn.add(`${plural(repos.length, 'repository', 'repositories')} are many for one picture: what is in them (environments, rulesets, secrets) is left out. --depth 2 draws it, --scope <prefix> one part`);

  // ---- who reaches what: a team's own access; a person's when held directly.
  const teams = [...org.teams.values()].filter((t) => !opts.scope || [...t.repos.keys()].some((k) => shown.has(k))).sort(byName);
  const drawnTeams = new Set(teams.map((t) => t.slug));
  // A team above one that is drawn comes along: the nesting is the point.
  for (const t of [...teams]) for (let p = t.parent && org.teams.get(t.parent); p && !drawnTeams.has(p.slug); p = p.parent && org.teams.get(p.parent)) (drawnTeams.add(p.slug), teams.push(p));
  const access: { from: string; repo: string; label: string }[] = [];
  for (const t of teams) for (const [repo, p] of own(org, t)) if (shown.has(repo)) access.push({ from: `team:${t.slug}`, repo, label: p });
  const direct = new Set<string>();
  for (const r of repos) for (const [who, p] of org.collaborators.get(r.key) ?? []) (direct.add(who), access.push({ from: `user:${who}`, repo: r.key, label: p }));
  // Who holds the same on every repository says so on itself: seven lines that all say admin cross everything else.
  const everywhere = new Map<string, string>();
  if (repos.length >= 3)
    for (const from of new Set(access.map((a) => a.from))) {
      const held = access.filter((a) => a.from === from);
      if (held.length === repos.length && new Set(held.map((a) => a.repo)).size === repos.length && new Set(held.map((a) => a.label)).size === 1) everywhere.set(from, held[0]!.label);
    }
  for (let i = access.length - 1; i >= 0; i--) if (everywhere.has(access[i]!.from)) access.splice(i, 1);
  const onAll = (key: string) => (everywhere.has(key) ? `${everywhere.get(key)} on every repository` : undefined);

  // ---- many repositories: those of one family (shop-api, shop-web: shop-*) as one, with what each team holds on how many of them.
  // Asked for (--group-by access): those that are reached in exactly the same way, as one.
  const same = new Map<string, string>();
  const merged: { key: string; name: string; caption: string }[] = [];
  const inside = (r: GhRepo) => deep && has(r);
  if (opts.groupBy === 'access' || (opts.groupBy !== 'none' && many)) {
    const alike = new Map<string, GhRepo[]>();
    for (const r of repos) {
      if (inside(r)) continue;
      const sign = opts.groupBy === 'access' ? [r.archived ? 'archived' : '', ...access.filter((a) => a.repo === r.key).map((a) => `${a.from} ${a.label}`).sort()].join('\n') : r.name.split(/[-_.]/)[0]!.toLowerCase();
      alike.set(sign, [...(alike.get(sign) ?? []), r]);
    }
    const said: string[] = [];
    for (const list of alike.values()) {
      if (list.length < 2) continue;
      const key = `${list[0]!.key}+${list.length - 1}`;
      const name = pattern(list.map((r) => r.name)) ?? `${list[0]!.name} and ${list.length - 1} more`;
      for (const r of list) same.set(r.key, key);
      const archived = list.filter((r) => r.archived).length;
      merged.push({ key, name, caption: [`${list.length} repositories`, archived ? (archived === list.length ? 'archived' : `${archived} archived`) : undefined].filter(Boolean).join(' · ') });
      said.push(`${name} (${list.length})`);
    }
    if (same.size) warn.add(`${same.size} repositories ${opts.groupBy === 'access' ? 'that are reached in exactly the same way' : 'are many for one picture: those whose names start the same'} are drawn as ${said.length === 1 ? 'one' : said.length}: ${some(said, 8)}. A line says on how many of them a team holds a role; --group-by none draws each, --scope <prefix> one family, --as access the matrix`);
  }
  const familySize = new Map<string, number>();
  for (const k of same.values()) familySize.set(k, (familySize.get(k) ?? 0) + 1);
  const repoKey = (key: string) => `repo:${same.get(key) ?? key}`;

  // ---- people: those who hold something themselves always; members of teams as long as they are few.
  const reviewers = new Set(repos.flatMap((r) => (deep ? (org.environments.get(r.key) ?? []) : []).flatMap((e) => e.reviewers.flatMap((v) => v.user ?? []))));
  const members = new Set(teams.flatMap((t) => [...(t.members ?? [])]));
  const fold = opts.principals === 'groups' || (opts.principals !== 'all' && members.size > (opts.collapseAbove ?? 6));
  if (fold && members.size && opts.principals !== 'groups') warn.add(`${plural(members.size, 'member')} of teams folded into their teams, which say how many they are: --principals all draws each of them`);
  const people = [...new Set([...direct, ...reviewers, ...(fold ? [] : members)])].map((k) => org.people.get(k)!).sort((a, b) => a.login.localeCompare(b.login, 'en'));

  // ---- what there is to write: every entry with the id it would like, its place and its words.
  interface Item {
    key: string;
    group: boolean;
    cls: string;
    name: string;
    /** Used when the name is taken: shop the team next to shop the repository. */
    else: string;
    kind: string;
    label?: string;
    caption?: string;
    in?: string;
  }
  const items: Item[] = [];
  const edges: { from: string; to: string; label?: string; style: string }[] = [];
  const ORG = 'org';
  const login = org.login ?? 'organisation';
  items.push({ key: ORG, group: true, cls: 'org', name: login, else: 'org', kind: 'org', label: login, caption: org.base && org.base !== 'none' ? `members ${org.base} everywhere` : undefined });
  const parents = new Set(teams.flatMap((t) => (t.parent && drawnTeams.has(t.parent) ? [t.parent] : [])));
  const size = (t: GhTeam) => (t.members && (fold || !t.members.size) ? plural(t.members.size, 'member') : undefined);
  for (const t of teams) {
    // A team with teams in it is drawn around them: what it reaches, they reach.
    const group = parents.has(t.slug);
    items.push({ key: `team:${t.slug}`, group, cls: 'team', name: t.slug, else: 'team', kind: group ? 'team-group' : 'team', label: t.name, caption: fit([onAll(`team:${t.slug}`), size(t)]), in: t.parent && drawnTeams.has(t.parent) ? `team:${t.parent}` : ORG });
    if (!fold) for (const m of t.members ?? []) edges.push({ from: `user:${m}`, to: `team:${t.slug}`, style: 'member' });
  }
  for (const p of people) items.push({ key: `user:${p.login.toLowerCase()}`, group: false, cls: 'user', name: p.login, else: 'user', kind: p.outside ? 'outside-collaborator' : 'user', label: p.login, caption: onAll(`user:${p.login.toLowerCase()}`), in: p.outside ? undefined : ORG });
  const words = (r: GhRepo) => [r.visibility && r.visibility !== 'private' ? r.visibility : undefined, r.archived ? 'archived' : undefined].filter(Boolean).join(' · ') || undefined;
  for (const r of repos) if (!same.has(r.key)) items.push({ key: `repo:${r.key}`, group: inside(r), cls: 'repo', name: r.name, else: 'repo', kind: 'repo', label: r.name, caption: words(r), in: ORG });
  for (const m of merged) items.push({ key: `repo:${m.key}`, group: false, cls: 'repo', name: m.name, else: 'repos', kind: 'repo', label: m.name, caption: m.caption, in: ORG });
  // One line for each role a team holds on a family, saying on how many of them when not on all.
  const held = new Map<string, { from: string; to: string; label: string; n: number }>();
  for (const a of access) {
    const to = repoKey(a.repo);
    const k = `${a.from} ${to} ${a.label}`;
    held.set(k, { from: a.from, to, label: a.label, n: (held.get(k)?.n ?? 0) + 1 });
  }
  for (const h of held.values()) {
    const all = familySize.get(h.to.slice('repo:'.length));
    edges.push({ from: h.from, to: h.to, label: all && h.n < all ? `${h.label} · ${h.n} of ${all}` : h.label, style: 'access' });
  }

  const refs = (list: string[] | undefined) => (list ?? []).map((p) => (p === '~DEFAULT_BRANCH' ? 'default branch' : p === '~ALL' ? 'all branches' : p.replace(/^refs\/heads\//, ''))).join(', ');
  const named = (place: string, list: { name: string }[], kind: 'secret' | 'variable', into: string) => {
    if (!list.length) return;
    const pre = place ? `${place}-` : '';
    // One by its name; more than one as one entry that says how many and names the first.
    if (list.length === 1) items.push({ key: `${kind}s:${place}`, group: false, cls: kind, name: `${pre}${kind}s`, else: 'all', kind, label: list[0]!.name, in: into });
    else items.push({ key: `${kind}s:${place}`, group: false, cls: kind, name: `${pre}${kind}s`, else: 'all', kind, label: `${list.length} ${kind}s`, caption: few(list.map((s) => s.name), 26), in: into });
  };
  for (const s of [...org.rulesets.values()].filter((x) => x.org).sort(byName)) {
    const covered = repos.filter((r) => org.covers({ ...s, enforcement: 'active' }, r) !== false);
    if (!covered.length && opts.scope) continue;
    const all = covered.length === repos.length;
    const state = s.enforcement === 'active' ? [] : [s.enforcement === 'evaluate' ? 'evaluate only' : 'disabled'];
    // A line to each of a few; more are named in the caption, where they do not cross everything else.
    const lines = !all && covered.length <= 3;
    const where = all ? ['all repositories'] : lines ? [] : covered.length <= 6 ? [few(covered.map((r) => r.name), 28)] : [plural(covered.length, 'repository', 'repositories')];
    const caption = fit([...state, ...where, ...rulesText(s.rules ?? [])]);
    items.push({ key: `ruleset:${s.id}`, group: false, cls: 'ruleset', name: s.name, else: 'ruleset', kind: 'ruleset', label: s.name, caption, in: ORG });
    if (lines) for (const r of covered) edges.push({ from: `ruleset:${s.id}`, to: repoKey(r.key), style: 'protects' });
  }
  for (const r of repos) {
    if (!inside(r)) continue;
    const at = `repo:${r.key}`;
    for (const s of [...org.rulesets.values()].filter((x) => !x.org && x.repo === r.key).sort(byName)) {
      const state = s.enforcement === 'active' ? [] : [s.enforcement === 'evaluate' ? 'evaluate only' : 'disabled'];
      const where = s.refs && !s.refs.include.includes('~DEFAULT_BRANCH') ? [refs(s.refs.include)] : [];
      items.push({ key: `ruleset:${s.id}`, group: false, cls: 'ruleset', name: `${r.name}-${s.name}`, else: 'ruleset', kind: 'ruleset', label: s.name, caption: fit([...state, ...where, ...rulesText(s.rules ?? [])]), in: at });
    }
    const classic = org.protection.get(r.key);
    if (classic) items.push({ key: `protection:${r.key}`, group: false, cls: 'ruleset', name: `${r.name}-branch-protection`, else: 'classic', kind: 'ruleset', label: `${r.branch ?? 'main'} protected`, caption: fit(['classic', ...classic]), in: at });
    for (const e of org.environments.get(r.key) ?? []) {
      const key = `environment:${r.key}/${e.name.toLowerCase()}`;
      const caption = fit([e.reviewers.length ? 'reviewers' : undefined, e.branches, e.wait ? `wait ${e.wait} min` : undefined]);
      items.push({ key, group: false, cls: 'environment', name: `${r.name}-${e.name}`, else: 'environment', kind: 'environment', label: e.name, caption, in: at });
      for (const v of e.reviewers) {
        const from = v.team ? `team:${v.team}` : `user:${v.user}`;
        if (v.team ? drawnTeams.has(v.team) : true) edges.push({ from, to: key, label: 'approves', style: 'access' });
      }
    }
    const rules = org.codeowners.get(r.key) ?? [];
    if (rules.length) {
      const key = `codeowners:${r.key}`;
      // Who is asked to look is named, not drawn: a line per owner and path crosses all the access lines.
      const owners = [...new Set(rules.flatMap((rule) => rule.owners))].map((o) => (o.includes('/') ? (org.teams.get(o.split('/').pop()!)?.name ?? o.split('/').pop()!) : o));
      items.push({ key, group: false, cls: 'codeowners', name: `${r.name}-codeowners`, else: 'file', kind: 'codeowners', label: 'CODEOWNERS', caption: fit([plural(rules.length, 'rule'), owners.length ? few(owners, 24) : undefined]), in: at });
    }
    named(r.name, org.secrets.get(r.key) ?? [], 'secret', at);
    named(r.name, org.variables.get(r.key) ?? [], 'variable', at);
  }
  if (deep) {
    named('', org.secrets.get('') ?? [], 'secret', ORG);
    named('', org.variables.get('') ?? [], 'variable', ORG);
    for (const g of [...org.runnerGroups.values()].sort(byName)) {
      const runners = org.runners.filter((r) => r.group === g.id).sort(byName);
      if (!runners.length) continue;
      const at = `runners:${g.id}`;
      items.push({ key: at, group: true, cls: 'runner-group', name: `runners-${g.name}`, else: 'group', kind: 'runner-group', label: g.name, caption: g.visibility === 'all' ? 'all repositories' : g.visibility === 'selected' ? 'selected repositories' : undefined, in: ORG });
      const os = [...new Set(runners.flatMap((r) => r.os ?? []))].join(', ') || undefined;
      if (runners.length <= 4) for (const r of runners) items.push({ key: `runner:${r.name.toLowerCase()}`, group: false, cls: 'runner', name: r.name, else: 'runner', kind: 'self-hosted-runner', label: r.name, caption: fit([r.os, ...r.labels]), in: at });
      else items.push({ key: `runner:${g.id}/all`, group: false, cls: 'runner', name: `runners-${g.name}-all`, else: 'runner', kind: 'self-hosted-runner', label: `${runners.length} runners`, caption: os, in: at });
    }
    const loose = org.runners.filter((r) => !r.group || !org.runnerGroups.has(r.group)).sort(byName);
    if (loose.length <= 4) for (const r of loose) items.push({ key: `runner:${r.name.toLowerCase()}`, group: false, cls: 'runner', name: r.name, else: 'runner', kind: 'self-hosted-runner', label: r.name, caption: fit([r.os, ...r.labels]), in: ORG });
    else items.push({ key: 'runner:all', group: false, cls: 'runner', name: 'runners', else: 'all', kind: 'self-hosted-runner', label: `${loose.length} runners`, in: ORG });
    for (const a of [...org.apps].sort((x, y) => x.slug.localeCompare(y.slug, 'en'))) {
      const where = a.selection === 'all' ? 'all repositories' : a.selection === 'selected' ? 'some repositories' : undefined;
      const writes = a.writes.length ? `writes ${few(a.writes, 14)}` : undefined;
      items.push({ key: `app:${a.slug.toLowerCase()}`, group: false, cls: 'app', name: a.slug, else: 'app', kind: 'app', label: a.slug, caption: fit([where, writes]), in: ORG });
    }
  }

  // ---- ids: readable, from the name. What an earlier import called something stays, so pins and hand edits hold.
  const before = { groups: kept.before('groups'), nodes: kept.before('nodes') };
  const was = (id: string): (Obj & { at: 'groups' | 'nodes' }) | undefined => (before.groups[id] ? { ...before.groups[id], at: 'groups' } : before.nodes[id] ? { ...before.nodes[id], at: 'nodes' } : undefined);
  const made = (e: Obj | undefined) => !!e && Array.isArray(e.tags) && e.tags.includes(IMPORTED);
  const CLASS: Record<string, string> = { 'team-group': 'team', 'outside-collaborator': 'user', 'self-hosted-runner': 'runner' };
  const cls = (e: Obj) => CLASS[String(e.kind)] ?? String(e.kind);
  const used = new Set([...Object.keys(before.groups), ...Object.keys(before.nodes)]);
  const idOf = new Map<string, string>();
  /** Taken over by hand: the tag was removed, so the entry stays as written and only its edges follow the export. */
  const byHand = new Set<string>();
  const tries = (x: Item) => {
    const base = slug(x.name.replace(/_/g, '-')).toLowerCase();
    return [base, `${base}-${x.else}`];
  };
  const claimed = new Set<string>();
  for (const x of items) {
    const id = tries(x).find((t) => !claimed.has(t) && was(t) && cls(was(t)!) === x.cls);
    if (!id) continue;
    claimed.add(id);
    idOf.set(x.key, id);
    if (!made(was(id))) byHand.add(x.key);
  }
  for (const x of items) {
    if (idOf.has(x.key)) continue;
    const t = tries(x);
    let id = t.find((c) => !used.has(c));
    for (let n = 2; !id; n++) if (!used.has(`${t[1]}-${n}`)) id = `${t[1]}-${n}`;
    used.add(id);
    idOf.set(x.key, id);
  }

  // What an earlier import made and this one no longer finds goes; what was added by hand has no tag and stays.
  const now = new Set(idOf.values());
  const gone = new Set<string>();
  for (const c of ['groups', 'nodes'] as const) for (const [id, e] of Object.entries(before[c])) if (made(e) && !now.has(id)) (kept.drop(c, id), gone.add(id));
  const KEEP = ['kind', 'caption', 'in', 'tags'];
  for (const x of items) {
    if (byHand.has(x.key)) continue;
    const id = idOf.get(x.key)!;
    const to = x.group ? 'groups' : 'nodes';
    const old = was(id);
    // A repository that got something in it becomes a group (and back): what was written on it by hand moves along.
    const moved = old && old.at !== to ? Object.fromEntries(Object.entries(old).filter(([k]) => !KEEP.includes(k) && k !== 'at')) : {};
    if (old && old.at !== to) kept.drop(old.at, id);
    const tags = [...new Set([IMPORTED, ...(Array.isArray(old?.tags) ? old.tags.map(String) : [])])];
    kept.put(to, id, { kind: x.kind, label: x.label, caption: x.caption, in: x.in && idOf.get(x.in), ...moved, tags }, ['kind', 'caption', 'in', 'tags']);
  }

  // Edges: those of a style the import speaks for, between what it made, follow it; any other one stays.
  const ARROW = /^\s*([A-Za-z0-9_.-]+)\s*(?:<->|-->|\.\.>|->|--)\s*([A-Za-z0-9_.-]+)\s*$/;
  const ends = (e: unknown): { from: string; to: string; style?: string } | undefined => {
    const text = typeof e === 'string' ? e : isObj(e) ? Object.keys(e)[0] : undefined;
    const m = text && ARROW.exec(text);
    const v = isObj(e) ? Object.values(e)[0] : undefined;
    return m ? { from: m[1]!, to: m[2]!, style: isObj(v) && typeof v.style === 'string' ? v.style : undefined } : undefined;
  };
  const lines = new Map<string, unknown>();
  const order = (style: string) => MINE.indexOf(style);
  for (const e of edges
    .flatMap((e) => (idOf.has(e.from) && idOf.has(e.to) ? [{ ...e, from: idOf.get(e.from)!, to: idOf.get(e.to)! }] : []))
    .sort((a, b) => order(a.style) - order(b.style) || a.to.localeCompare(b.to) || a.from.localeCompare(b.from) || (a.label ?? '').localeCompare(b.label ?? '')))
    lines.set(`${e.from} ${e.to} ${e.style} ${e.label ?? ''}`, { [`${e.from} -> ${e.to}`]: e.label ? { label: e.label, style: e.style } : { style: e.style } });
  const imported = (id: string) => now.has(id) && !byHand.has([...idOf].find(([, v]) => v === id)![0]);
  const old = Array.isArray(kept.old.edges) ? kept.old.edges : [];
  const stay = old.filter((e) => {
    const x = ends(e);
    if (!x) return true;
    if (gone.has(x.from) || gone.has(x.to)) return false;
    return !(imported(x.from) || made(was(x.from))) || !(imported(x.to) || made(was(x.to))) || !MINE.includes(x.style ?? '');
  });
  kept.list('edges', [...stay, ...lines.values()]);
  kept.tidy(['groups', 'nodes']);

  const count = (c: string) => items.filter((x) => x.cls === c).length;
  const summary = [plural(count('team'), 'team'), plural(repos.length, 'repository', 'repositories'), ...(people.length ? [plural(people.length, 'person', 'people')] : []), ...(count('ruleset') ? [plural(count('ruleset'), 'ruleset')] : []), ...(count('environment') ? [plural(count('environment'), 'environment')] : [])].join(', ');
  return { yaml: kept.text(), warnings: warn.list, problems, read, skipped, summary };
}

/** The same organisation as principals, scopes and roles: teams are groups, repositories resources, read to admin a ladder. */
function asAccess(org: GithubOrg, repos: GhRepo[], opts: GithubOptions, warn: Warnings, notes: Pick<ImportedExport, 'read' | 'skipped' | 'problems'>): ImportedExport {
  const dir = new Directory();
  const login = org.login ?? 'organisation';
  dir.tenant = org.name ?? login;
  dir.listed = new Set(['users', 'groups', 'service-principals']);
  const top = dir.add(login, { name: login, kind: 'organization', caption: 'GitHub organisation', level: 1 });
  const role = (p: string) => {
    const r = dir.role(`github:${p}`, p)!;
    const below = LEVELS[LEVELS.indexOf(p) - 1] ?? (p === 'owner' ? 'admin' : undefined);
    if (below) r.inherits = role(below).key;
    return r;
  };
  for (const r of repos) dir.add(`${login}/${r.name}`, { name: r.name, kind: 'repo', caption: [r.visibility && r.visibility !== 'private' ? r.visibility : undefined, r.archived ? 'archived' : undefined].filter(Boolean).join(' · ') || undefined, parent: top, level: 2 });
  const scope = (repo: string) => `${login}/${repo}`.toLowerCase();
  const shown = new Set(repos.map((r) => r.key));
  for (const t of org.teams.values()) {
    dir.principal(`team:${t.slug}`, { name: t.name, kind: 'group', caption: 'Team', found: true });
    // A team in a team reaches what the one above it reaches: a member of it, in access terms.
    if (t.parent) dir.member(`team:${t.slug}`, `team:${t.parent}`);
    for (const m of t.members ?? []) dir.member(`user:${m}`, `team:${t.slug}`);
    for (const [repo, p] of own(org, t)) if (shown.has(repo)) dir.assign(`team:${t.slug}`, role(p).key, scope(repo));
  }
  for (const [key, p] of org.people) dir.principal(`user:${key}`, { name: p.login, kind: p.outside ? 'guest' : 'user', found: true });
  for (const r of repos) for (const [who, p] of org.collaborators.get(r.key) ?? []) dir.assign(`user:${who}`, role(p).key, scope(r.key));
  for (const who of org.owners) dir.assign(`user:${who}`, role('owner').key, top);
  if (org.base && org.base !== 'none') {
    // What every member may do everywhere. Not tied to each of them: that would be a line per person.
    dir.principal('members:all', { name: 'All members', kind: 'group', caption: 'base permission', found: true });
    dir.assign('members:all', role(org.base).key, top);
  }
  return drawAccess(warn, { dir, ...notes }, { scopesAbove: Infinity, ...opts, scope: undefined, title: opts.title ?? `${dir.tenant}: who reaches which repository` });
}
