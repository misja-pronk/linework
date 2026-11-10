// A GitHub organisation as `gh api` saves it, one file per REST response: the organisation, its
// teams (members, repositories), repositories (collaborators, environments, rulesets, branch
// protection, CODEOWNERS), secrets and variables by name, runners and installed apps. What a file is
// shows from its shape; which team or repository it is about, from the folder it is in
// (teams/<team>/…, repos/<repo>/…). Nothing is fetched, and no value of a secret or variable is kept.
import type { Notes } from './access-azure.ts';
import { isObj, str, type Obj } from './keep.ts';

export interface GhTeam {
  slug: string;
  name: string;
  parent?: string;
  /** Logins, when the team's members were read. */
  members?: Set<string>;
  /** Repository (lower case) → permission, as the team's own listing says: what it gets from a parent team is in there too. */
  repos: Map<string, string>;
}

export interface GhRepo {
  key: string;
  name: string;
  id?: number;
  visibility?: string;
  archived: boolean;
  branch?: string;
}

export interface GhRuleset {
  id: string;
  name: string;
  /** Made on the organisation, for several repositories. */
  org: boolean;
  /** The repository it is made on, when not on the organisation. */
  repo?: string;
  target: string;
  enforcement: string;
  /** Known once the ruleset itself was read, not only the list it is in. */
  rules?: Obj[];
  refs?: { include: string[]; exclude: string[] };
  names?: { include: string[]; exclude: string[] };
  ids?: number[];
  /** Picked by repository property: which repositories that comes down to is not in the export. */
  byProperty?: boolean;
  bypass: number;
  /** The repositories whose own list of rulesets names it. */
  on: Set<string>;
}

export interface GhEnvironment {
  name: string;
  reviewers: { team?: string; user?: string }[];
  wait?: number;
  branches?: string;
}

export interface GhNamed {
  name: string;
  visibility?: string;
}

const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const low = (v: unknown) => str(v)?.toLowerCase();
export const LEVELS = ['read', 'triage', 'write', 'maintain', 'admin'];
const OLD: Record<string, string> = { pull: 'read', push: 'write' };

/** What a repository's `permissions` or `role_name` comes down to: read, triage, write, maintain, admin, or the name of a custom role. */
export function permission(o: Obj): string | undefined {
  const role = str(o.role_name);
  if (role) return OLD[role] ?? role;
  const p = isObj(o.permissions) ? o.permissions : undefined;
  if (!p) return undefined;
  return p.admin ? 'admin' : p.maintain ? 'maintain' : p.push ? 'write' : p.triage ? 'triage' : p.pull ? 'read' : undefined;
}

/** shop-* against a name, the way rulesets match: * is anything. */
const glob = (pattern: string, name: string) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*+/g, '.*').replace(/\?/g, '.')}$`, 'i').test(name);

/** What a ruleset asks, in the few words a caption has room for. */
export function rulesText(rules: Obj[]): string[] {
  const out: string[] = [];
  const params = (r: Obj) => (isObj(r.parameters) ? r.parameters : {});
  for (const r of rules) {
    const type = str(r.type);
    if (type === 'pull_request') {
      const n = Number(params(r).required_approving_review_count) || 0;
      out.push(n ? `${n} review${n === 1 ? '' : 's'}` : 'pull request');
      if (params(r).require_code_owner_review === true) out.push('code owners');
    } else if (type === 'required_status_checks') out.push('status checks');
    else if (type === 'required_signatures') out.push('signed commits');
    else if (type === 'required_linear_history') out.push('linear history');
    else if (type === 'non_fast_forward') out.push('no force push');
    else if (type === 'required_deployments') out.push('deployments first');
    else if (type && type !== 'deletion' && type !== 'creation' && type !== 'update') out.push(type.replace(/_/g, ' '));
  }
  if (!out.length && rules.some((r) => r.type === 'deletion')) out.push('no deletion');
  return out;
}

export class GithubOrg {
  login?: string;
  name?: string;
  /** What every member may do in every repository: none, read, write, admin. */
  base?: string;
  teams = new Map<string, GhTeam>();
  repos = new Map<string, GhRepo>();
  /** Login (lower case) → as written, and whether from outside the organisation. */
  people = new Map<string, { login: string; outside: boolean }>();
  owners = new Set<string>();
  /** Repository → login → permission, for those who hold it themselves and not through a team. */
  collaborators = new Map<string, Map<string, string>>();
  environments = new Map<string, GhEnvironment[]>();
  rulesets = new Map<string, GhRuleset>();
  /** Repositories whose own list of rulesets was read: only for these is "no ruleset" something the export says. */
  ruled = new Set<string>();
  /** Repository → what classic branch protection asks on the default branch. */
  protection = new Map<string, string[]>();
  codeowners = new Map<string, { pattern: string; owners: string[] }[]>();
  /** '' for the organisation's own, else by repository. Names only. */
  secrets = new Map<string, GhNamed[]>();
  variables = new Map<string, GhNamed[]>();
  runners: { name: string; os?: string; labels: string[]; group?: string }[] = [];
  runnerGroups = new Map<string, { id: string; name: string; visibility?: string }>();
  apps: { slug: string; selection?: string; writes: string[] }[] = [];

  team(slug: unknown, name?: unknown): GhTeam | undefined {
    const key = low(slug);
    if (!key) return undefined;
    let t = this.teams.get(key);
    if (!t) this.teams.set(key, (t = { slug: key, name: str(name) ?? str(slug)!, repos: new Map() }));
    else if (str(name)) t.name = str(name)!;
    return t;
  }

  repo(name: unknown, o: Obj = {}): GhRepo | undefined {
    const key = low(name);
    if (!key) return undefined;
    let r = this.repos.get(key);
    if (!r) this.repos.set(key, (r = { key, name: str(name)!, archived: false }));
    if (typeof o.id === 'number') r.id = o.id;
    r.visibility = str(o.visibility) ?? (o.private === true ? 'private' : o.private === false ? 'public' : r.visibility);
    if (typeof o.archived === 'boolean') r.archived = o.archived;
    r.branch = str(o.default_branch) ?? r.branch;
    return r;
  }

  person(login: unknown, outside = false): string | undefined {
    const key = low(login);
    if (!key) return undefined;
    const p = this.people.get(key);
    if (!p) this.people.set(key, { login: str(login)!, outside });
    else if (outside) p.outside = true;
    return key;
  }

  /** Does this ruleset hold on the repository's default branch? Not known (undefined) when the export leaves it open. */
  covers(r: GhRuleset, repo: GhRepo): boolean | undefined {
    if (r.target !== 'branch' || r.enforcement !== 'active') return false;
    if (!r.org) {
      if (r.repo !== repo.key) return false;
    } else if (!r.on.has(repo.key)) {
      // Its own list did not name it; without that list, the ruleset's conditions say.
      if (this.ruled.has(repo.key)) return false;
      if (r.ids) {
        if (!r.ids.includes(repo.id ?? -1)) return false;
      } else if (r.names) {
        if (!r.names.include.some((p) => p === '~ALL' || glob(p, repo.name)) || r.names.exclude.some((p) => glob(p, repo.name))) return false;
      } else return r.byProperty || !r.rules ? undefined : false;
    }
    if (!r.refs) return undefined;
    const branch = `refs/heads/${repo.branch ?? 'main'}`;
    const hit = (p: string) => p === '~ALL' || p === '~DEFAULT_BRANCH' || glob(p, branch);
    return r.refs.include.some(hit) && !r.refs.exclude.some(hit);
  }

  private ruleset(o: Obj, repo?: string): boolean {
    const id = str(o.id);
    if (!id) return false;
    let r = this.rulesets.get(id);
    if (!r) this.rulesets.set(id, (r = { id, name: str(o.name) ?? `Ruleset ${id}`, org: false, target: 'branch', enforcement: 'active', bypass: 0, on: new Set() }));
    r.target = str(o.target) ?? r.target;
    r.enforcement = str(o.enforcement) ?? r.enforcement;
    const source = low(o.source_type);
    if (source === 'organization' || source === 'enterprise') r.org = true;
    else if (source === 'repository') r.repo = low(o.source)?.split('/').pop();
    else if (repo) r.repo ??= repo;
    else r.org = true;
    if (repo) r.on.add(repo);
    if (Array.isArray(o.rules)) r.rules = arr(o.rules);
    if (Array.isArray(o.bypass_actors)) r.bypass = o.bypass_actors.length;
    const c = isObj(o.conditions) ? o.conditions : undefined;
    const patterns = (v: unknown) => (isObj(v) ? { include: (Array.isArray(v.include) ? v.include : []).map(String), exclude: (Array.isArray(v.exclude) ? v.exclude : []).map(String) } : undefined);
    if (c) {
      r.refs = patterns(c.ref_name) ?? r.refs;
      r.names = patterns(c.repository_name) ?? r.names;
      if (isObj(c.repository_id) && Array.isArray(c.repository_id.repository_ids)) r.ids = c.repository_id.repository_ids.map(Number);
      if (isObj(c.repository_property)) r.byProperty = true;
    }
    return true;
  }

  /** CODEOWNERS: a pattern and who must look at changes to it. The last match wins in GitHub; here every line is one rule. */
  owned(repo: string, text: string): number {
    const rules: { pattern: string; owners: string[] }[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/(^|\s)#.*$/, '').trim();
      const [pattern, ...owners] = line.split(/\s+/);
      if (pattern && owners.length) rules.push({ pattern, owners: owners.filter((o) => o.startsWith('@')).map((o) => o.slice(1).toLowerCase()) });
    }
    this.repo(repo);
    this.codeowners.set(repo.toLowerCase(), rules);
    return rules.length;
  }

  /** One saved response. False when it is nothing this reads. */
  file(path: string, json: unknown, note: Notes): boolean {
    const parts = path.split(/[\\/]+/);
    const file = parts.at(-1)!.toLowerCase();
    const after = (dir: string) => {
      const i = parts.map((p) => p.toLowerCase()).lastIndexOf(dir);
      return i >= 0 && parts.length - i >= 3 ? parts[i + 1]!.toLowerCase() : undefined;
    };
    const repo = after('repos');
    const team = after('teams');
    json = pages(json);

    if (Array.isArray(json)) {
      const items = arr(json);
      const first = items[0];
      if (!first) {
        // Nothing in it. For rulesets that is an answer: this repository has none.
        if (repo && file.includes('ruleset')) (this.repo(repo), this.ruled.add(repo));
        if (team && file.includes('member')) this.team(team)!.members ??= new Set();
        note.read('empty list', 0);
        return true;
      }
      if ('slug' in first && ('privacy' in first || 'parent' in first || 'members_url' in first)) {
        for (const o of items) {
          const t = this.team(o.slug, o.name);
          if (t && isObj(o.parent)) t.parent = this.team(o.parent.slug, o.parent.name)?.slug;
        }
        note.read('teams', items.length);
      } else if ('full_name' in first || ('default_branch' in first && 'name' in first)) {
        const t = team ? this.team(team) : undefined;
        for (const o of items) {
          const r = this.repo(o.name, o);
          const p = t && permission(o);
          if (r && p) t.repos.set(r.key, p);
        }
        note.read(t ? 'repositories of a team' : 'repositories', items.length);
      } else if ('enforcement' in first && ('source_type' in first || 'target' in first || 'rules' in first)) {
        if (repo) (this.repo(repo), this.ruled.add(repo));
        note.read(repo ? 'rulesets of a repository' : 'rulesets', items.filter((o) => this.ruleset(o, repo)).length);
      } else if ('app_slug' in first) this.installed(items, note);
      else if ('login' in first) {
        if (team) {
          const t = this.team(team)!;
          t.members ??= new Set();
          for (const o of items) t.members.add(this.person(o.login)!);
          note.read('members of a team', items.length);
        } else if (/outside/.test(file)) {
          for (const o of items) {
            const who = this.person(o.login, true);
            const p = repo && permission(o);
            if (who && p) this.direct(repo, who, p);
          }
          note.read('outside collaborators', items.length);
        } else if (repo) {
          for (const o of items) {
            const who = this.person(o.login);
            const p = permission(o);
            if (who && p) this.direct(repo, who, p);
          }
          note.read('collaborators of a repository', items.length);
        } else if (/owner|admin/.test(file)) {
          for (const o of items) this.owners.add(this.person(o.login)!);
          note.read('owners', items.length);
        } else {
          for (const o of items) this.person(o.login);
          note.read('members', items.length);
        }
      } else return false;
      return true;
    }
    if (!isObj(json)) return false;
    if (typeof json.message === 'string' && ('documentation_url' in json || 'status' in json)) {
      // An answer that was an error, saved all the same: "Branch not protected", "Not Found".
      note.skip(`GitHub answered "${json.message}"`);
      return true;
    }
    // Everything in one object: not one of the answers below, though it has keys like theirs.
    if (isObj(json.org) || Array.isArray(json.teams) || (Array.isArray(json.repos) && !('total_count' in json))) return this.combined(json, note);
    if (str(json.login) && (json.type === 'Organization' || 'default_repository_permission' in json || 'members_can_create_repositories' in json)) {
      this.login = str(json.login);
      this.name = str(json.name);
      this.base = low(json.default_repository_permission) ?? this.base;
      note.read('organisation', 1);
    } else if (Array.isArray(json.environments)) {
      if (!repo) return (note.skip('environments, but not in a folder repos/<repository>/: which repository is not known'), true);
      this.repo(repo);
      const envs = arr(json.environments).map((e): GhEnvironment => {
        const rules = arr(e.protection_rules);
        const policy = isObj(e.deployment_branch_policy) ? e.deployment_branch_policy : undefined;
        const reviewers = rules.flatMap((r) => arr(r.reviewers)).flatMap((r) => (isObj(r.reviewer) ? [low(r.type) === 'team' ? { team: low(r.reviewer.slug) } : { user: this.person(r.reviewer.login) }] : []));
        const wait = rules.map((r) => Number(r.wait_timer) || 0).find((n) => n > 0);
        return { name: str(e.name) ?? 'environment', reviewers, wait, branches: policy?.protected_branches === true ? 'protected branches' : policy?.custom_branch_policies === true ? 'selected branches' : undefined };
      });
      this.environments.set(repo, envs);
      note.read('environments', envs.length);
    } else if ('enforcement' in json && ('rules' in json || 'conditions' in json)) {
      this.ruleset(json, undefined);
      note.read('ruleset', 1);
    } else if ('required_pull_request_reviews' in json || 'required_status_checks' in json || 'enforce_admins' in json || 'allow_force_pushes' in json) {
      if (!repo) return (note.skip('branch protection, but not in a folder repos/<repository>/: which repository is not known'), true);
      this.repo(repo);
      const reviews = isObj(json.required_pull_request_reviews) ? json.required_pull_request_reviews : undefined;
      const n = Number(reviews?.required_approving_review_count) || 0;
      const on = (v: unknown) => isObj(v) && v.enabled === true;
      this.protection.set(repo, [
        ...(reviews ? [n ? `${n} review${n === 1 ? '' : 's'}` : 'pull request'] : []),
        ...(reviews?.require_code_owner_reviews === true ? ['code owners'] : []),
        ...(isObj(json.required_status_checks) ? ['status checks'] : []),
        ...(on(json.required_signatures) ? ['signed commits'] : []),
        ...(on(json.required_linear_history) ? ['linear history'] : []),
        ...(on(json.enforce_admins) ? ['admins too'] : []),
      ]);
      note.read('branch protection', 1);
    } else if (Array.isArray(json.secrets) || Array.isArray(json.variables)) {
      // Names only: a variable's value is in the export, and stays there.
      const secret = Array.isArray(json.secrets);
      const list = arr(secret ? json.secrets : json.variables).flatMap((s) => (str(s.name) ? [{ name: str(s.name)!, visibility: low(s.visibility) }] : []));
      if (repo) this.repo(repo);
      (secret ? this.secrets : this.variables).set(repo ?? '', list);
      note.read(`${secret ? 'secrets' : 'variables'}${repo ? ' of a repository' : ''}, by name`, list.length);
    } else if (Array.isArray(json.runners)) {
      for (const r of arr(json.runners))
        if (str(r.name)) this.runners.push({ name: str(r.name)!, os: low(r.os), labels: arr(r.labels).filter((l) => l.type !== 'read-only').map((l) => String(l.name)), group: str(r.runner_group_id) });
      note.read('self-hosted runners', arr(json.runners).length);
    } else if (Array.isArray(json.runner_groups)) {
      for (const g of arr(json.runner_groups)) if (str(g.id)) this.runnerGroups.set(str(g.id)!, { id: str(g.id)!, name: str(g.name) ?? `Group ${g.id}`, visibility: low(g.visibility) });
      note.read('runner groups', arr(json.runner_groups).length);
    } else if (Array.isArray(json.installations)) this.installed(arr(json.installations), note);
    else return false;
    return true;
  }

  private direct(repo: string, who: string, p: string): void {
    this.repo(repo);
    if (!this.collaborators.has(repo)) this.collaborators.set(repo, new Map());
    this.collaborators.get(repo)!.set(who, p);
  }

  private installed(items: Obj[], note: Notes): void {
    for (const a of items) {
      const perms = isObj(a.permissions) ? a.permissions : {};
      if (str(a.app_slug)) this.apps.push({ slug: str(a.app_slug)!, selection: low(a.repository_selection), writes: Object.keys(perms).filter((k) => perms[k] === 'write' || perms[k] === 'admin').map((k) => k.replace(/_/g, ' ')) });
    }
    note.read('installed apps', items.length);
  }

  /** Everything in one object, for those who would rather keep one file: each part is read as the file it would have been. */
  private combined(json: Obj, note: Notes): boolean {
    const each = (v: unknown) => (isObj(v) ? Object.entries(v) : []);
    // A bare list of secrets, or the answer as GitHub gave it ({ total_count, secrets }).
    const wrap = (key: string, v: unknown) => (Array.isArray(v) ? { [key]: v } : v);
    const parts: [string, unknown][] = [
      ['org.json', json.org],
      ['teams.json', json.teams],
      ['repos.json', json.repos],
      ['members.json', json.members],
      ['owners.json', json.owners],
      ['outside-collaborators.json', json.outside_collaborators],
      ['rulesets.json', json.rulesets],
      ['secrets.json', wrap('secrets', json.secrets)],
      ['variables.json', wrap('variables', json.variables)],
      ['runners.json', wrap('runners', json.runners)],
      ['runner-groups.json', wrap('runner_groups', json.runner_groups)],
      ['installations.json', wrap('installations', json.installations)],
      ...each(json.team_members).map(([t, v]): [string, unknown] => [`teams/${t}/members.json`, v]),
      ...each(json.team_repos).map(([t, v]): [string, unknown] => [`teams/${t}/repos.json`, v]),
      ...each(json.collaborators).map(([r, v]): [string, unknown] => [`repos/${r}/collaborators.json`, v]),
      ...each(json.environments).map(([r, v]): [string, unknown] => [`repos/${r}/environments.json`, wrap('environments', v)]),
      ...each(json.repo_rulesets).map(([r, v]): [string, unknown] => [`repos/${r}/rulesets.json`, v]),
      ...each(json.branch_protection).map(([r, v]): [string, unknown] => [`repos/${r}/branch-protection.json`, v]),
      ...each(json.repo_secrets).map(([r, v]): [string, unknown] => [`repos/${r}/secrets.json`, wrap('secrets', v)]),
      ...each(json.repo_variables).map(([r, v]): [string, unknown] => [`repos/${r}/variables.json`, wrap('variables', v)]),
    ];
    for (const [path, v] of parts) if (v !== undefined && v !== null && !this.file(path, v, note)) note.warn(`combined ${path}`, `The part that would be ${path} is not what GitHub answers there: left out`);
    for (const [r, text] of each(json.codeowners)) if (typeof text === 'string') note.read('CODEOWNERS rules', this.owned(r.toLowerCase(), text));
    return true;
  }
}

/** `gh api --paginate --slurp` wraps the pages in a list: a list of lists is one list, a list of { total_count, things } one such object. */
export function pages(json: unknown): unknown {
  if (!Array.isArray(json) || !json.length) return json;
  if (json.every(Array.isArray)) return json.flat();
  const key = isObj(json[0]) && 'total_count' in json[0] ? Object.keys(json[0]).find((k) => Array.isArray((json[0] as Obj)[k])) : undefined;
  if (key && json.every((p) => isObj(p) && Array.isArray(p[key]))) return { total_count: json.length, [key]: json.flatMap((p) => (p as Obj)[key]) };
  return json;
}

/** JSON as `gh api --paginate` prints it without --slurp: one value after the other. One value when that is what it is. */
export function parsePages(text: string): unknown {
  const clean = text.replace(/^﻿/, '');
  try {
    return JSON.parse(clean);
  } catch (e) {
    const values: unknown[] = [];
    let depth = 0;
    let start = -1;
    let quote = false;
    for (let i = 0; i < clean.length; i++) {
      const c = clean[i]!;
      if (quote) {
        if (c === '\\') i++;
        else if (c === '"') quote = false;
      } else if (c === '"') quote = true;
      else if (c === '[' || c === '{') {
        if (depth++ === 0) start = i;
      } else if ((c === ']' || c === '}') && --depth === 0) values.push(JSON.parse(clean.slice(start, i + 1)));
    }
    if (values.length < 2 || depth !== 0) throw e;
    return values;
  }
}
