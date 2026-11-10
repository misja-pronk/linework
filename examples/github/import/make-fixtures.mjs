// Writes the fixtures in this folder: an invented organisation ("kestrel-logistics") as `gh api`
// would save it, one file per REST response. Nothing here comes from a real organisation: every
// name is made up, every id a counter, and there is no secret in it, only names of secrets.
//
//   node examples/github/import/make-fixtures.mjs
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ORG = 'kestrel-logistics';
let counter = 1000;
const ids = new Map();
const id = (name) => ids.get(name) ?? (ids.set(name, ++counter), counter);

const PERMS = { read: 1, triage: 2, write: 3, maintain: 4, admin: 5 };
const permissions = (p) => ({ admin: PERMS[p] >= 5, maintain: PERMS[p] >= 4, push: PERMS[p] >= 3, triage: PERMS[p] >= 2, pull: true });
const user = (login) => ({ login, id: id(`user ${login}`), type: 'User', site_admin: false });
const repoOf = (r) => ({
  id: id(`repo ${r.name}`),
  name: r.name,
  full_name: `${ORG}/${r.name}`,
  private: r.visibility !== 'public',
  visibility: r.visibility ?? 'private',
  archived: !!r.archived,
  fork: false,
  default_branch: r.branch ?? 'main',
  description: r.description ?? null,
});
const teamOf = (t, all) => ({
  id: id(`team ${t.slug}`),
  name: t.name,
  slug: t.slug,
  description: t.description ?? null,
  privacy: 'closed',
  notification_setting: 'notifications_enabled',
  permission: 'pull',
  parent: t.parent ? { id: id(`team ${t.parent}`), name: all.find((x) => x.slug === t.parent).name, slug: t.parent } : null,
});
const rule = {
  reviews: (n, owners = false) => ({ type: 'pull_request', parameters: { required_approving_review_count: n, dismiss_stale_reviews_on_push: true, require_code_owner_review: owners, require_last_push_approval: false, required_review_thread_resolution: true } }),
  checks: (...names) => ({ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, required_status_checks: names.map((context) => ({ context })) } }),
  noForce: { type: 'non_fast_forward' },
  noDelete: { type: 'deletion' },
  signed: { type: 'required_signatures' },
};

/** One organisation → the files `gh api` would save, as { path: content }. */
function files(o) {
  const out = {};
  const json = (path, data) => (out[path] = JSON.stringify(data, null, 2) + '\n');
  json('org.json', { login: ORG, id: id('org'), name: 'Kestrel Logistics', type: 'Organization', default_repository_permission: o.base ?? 'none', two_factor_requirement_enabled: true, members_can_create_repositories: false });
  json('teams.json', o.teams.map((t) => teamOf(t, o.teams)));
  json('repos.json', o.repos.map(repoOf));
  json('members.json', [...new Set(o.teams.flatMap((t) => t.members))].sort().map(user));
  json('owners.json', o.owners.map(user));
  json('outside-collaborators.json', [...new Set(Object.values(o.outside ?? {}).flatMap(Object.keys))].sort().map(user));
  // A child team's own listing names what it gets from its parent too, the way GitHub answers.
  const reach = (t) => ({ ...(t.parent ? reach(o.teams.find((x) => x.slug === t.parent)) : {}), ...t.repos });
  for (const t of o.teams) {
    json(`teams/${t.slug}/members.json`, t.members.map(user));
    json(`teams/${t.slug}/repos.json`, Object.entries(reach(t)).map(([name, p]) => ({ ...repoOf(o.repos.find((r) => r.name === name)), permissions: permissions(p), role_name: p })));
  }
  const orgRules = (o.rulesets ?? []).map((r) => ({
    id: id(`ruleset ${r.name}`),
    name: r.name,
    target: 'branch',
    source_type: 'Organization',
    source: ORG,
    enforcement: r.enforcement ?? 'active',
    bypass_actors: [{ actor_id: 1, actor_type: 'OrganizationAdmin', bypass_mode: 'always' }],
    conditions: { ref_name: { include: r.refs ?? ['~DEFAULT_BRANCH'], exclude: [] }, repository_name: { include: r.include ?? ['~ALL'], exclude: r.exclude ?? [], protected: true } },
    rules: r.rules,
  }));
  const brief = ({ id, name, target, source_type, source, enforcement }) => ({ id, name, target, source_type, source, enforcement });
  json('rulesets.json', orgRules.map(brief));
  for (const r of orgRules) json(`rulesets/${r.id}.json`, r);
  const match = (pattern, name) => pattern === '~ALL' || new RegExp(`^${pattern.replace(/\*/g, '.*')}$`).test(name);
  for (const r of o.repos) {
    if (o.light) continue;
    const dir = `repos/${r.name}`;
    const direct = { ...(o.direct?.[r.name] ?? {}), ...(o.outside?.[r.name] ?? {}) };
    json(`${dir}/collaborators.json`, Object.entries(direct).map(([login, p]) => ({ ...user(login), permissions: permissions(p), role_name: p })));
    const own = (r.rulesets ?? []).map((x) => ({
      id: id(`ruleset ${r.name} ${x.name}`),
      name: x.name,
      target: 'branch',
      source_type: 'Repository',
      source: `${ORG}/${r.name}`,
      enforcement: x.enforcement ?? 'active',
      bypass_actors: [],
      conditions: { ref_name: { include: x.refs ?? ['~DEFAULT_BRANCH'], exclude: [] } },
      rules: x.rules,
    }));
    const fromOrg = orgRules.filter((x) => x.conditions.repository_name.include.some((p) => match(p, r.name)) && !x.conditions.repository_name.exclude.some((p) => match(p, r.name)));
    json(`${dir}/rulesets.json`, [...own, ...fromOrg].map(brief));
    for (const x of own) json(`${dir}/rulesets/${x.id}.json`, x);
    json(
      `${dir}/branch-protection.json`,
      r.protection
        ? { url: `https://api.github.com/repos/${ORG}/${r.name}/branches/main/protection`, required_pull_request_reviews: { dismiss_stale_reviews: false, require_code_owner_reviews: false, required_approving_review_count: r.protection.reviews }, enforce_admins: { enabled: true }, required_linear_history: { enabled: false }, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false } }
        : { message: 'Branch not protected', documentation_url: 'https://docs.github.com/rest/branches/branch-protection#get-branch-protection', status: '404' },
    );
    json(`${dir}/environments.json`, {
      total_count: (r.environments ?? []).length,
      environments: (r.environments ?? []).map((e) => ({
        id: id(`env ${r.name} ${e.name}`),
        name: e.name,
        protection_rules: [
          ...(e.reviewers ? [{ id: id(`rule ${r.name} ${e.name}`), type: 'required_reviewers', reviewers: e.reviewers.map((slug) => ({ type: 'Team', reviewer: { id: id(`team ${slug}`), slug, name: o.teams.find((t) => t.slug === slug).name } })) }] : []),
          ...(e.wait ? [{ id: id(`wait ${r.name} ${e.name}`), type: 'wait_timer', wait_timer: e.wait }] : []),
        ],
        deployment_branch_policy: e.reviewers ? { protected_branches: true, custom_branch_policies: false } : null,
      })),
    });
    json(`${dir}/secrets.json`, { total_count: (r.secrets ?? []).length, secrets: (r.secrets ?? []).map((name) => ({ name, created_at: '2025-03-01T09:00:00Z', updated_at: '2025-03-01T09:00:00Z' })) });
    json(`${dir}/variables.json`, { total_count: (r.variables ?? []).length, variables: (r.variables ?? []).map((name) => ({ name, value: 'example', created_at: '2025-03-01T09:00:00Z', updated_at: '2025-03-01T09:00:00Z' })) });
    if (r.codeowners) out[`${dir}/CODEOWNERS`] = r.codeowners;
  }
  json('secrets.json', { total_count: (o.secrets ?? []).length, secrets: (o.secrets ?? []).map(([name, visibility]) => ({ name, created_at: '2025-03-01T09:00:00Z', updated_at: '2025-03-01T09:00:00Z', visibility })) });
  json('variables.json', { total_count: (o.variables ?? []).length, variables: (o.variables ?? []).map(([name, visibility]) => ({ name, value: 'example', created_at: '2025-03-01T09:00:00Z', updated_at: '2025-03-01T09:00:00Z', visibility })) });
  const groups = [...new Set((o.runners ?? []).map((r) => r.group))];
  json('runner-groups.json', { total_count: groups.length, runner_groups: groups.map((name) => ({ id: id(`runner group ${name}`), name, visibility: name === 'Default' ? 'all' : 'selected', default: name === 'Default', allows_public_repositories: false })) });
  json('runners.json', {
    total_count: (o.runners ?? []).length,
    runners: (o.runners ?? []).map((r) => ({ id: id(`runner ${r.name}`), name: r.name, os: r.os, status: 'online', busy: false, runner_group_id: id(`runner group ${r.group}`), labels: [{ id: 1, name: 'self-hosted', type: 'read-only' }, { id: 2, name: r.os, type: 'read-only' }, ...r.labels.map((name, i) => ({ id: 10 + i, name, type: 'custom' }))] })),
  });
  json('installations.json', { total_count: (o.apps ?? []).length, installations: (o.apps ?? []).map((a) => ({ id: id(`app ${a.slug}`), app_id: id(`appid ${a.slug}`), app_slug: a.slug, target_type: 'Organization', repository_selection: a.selection, permissions: a.permissions })) });
  return out;
}

function save(folder, all) {
  rmSync(join(here, folder), { recursive: true, force: true });
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(here, folder, path)), { recursive: true });
    writeFileSync(join(here, folder, path), text);
  }
}

// ---- Kestrel Logistics as it is
const kestrel = () => ({
  base: 'read',
  owners: ['anna-visser', 'bram-dekker'],
  teams: [
    { slug: 'platform', name: 'Platform', members: ['anna-visser', 'bram-dekker'], repos: { shop: 'admin', 'shop-web': 'admin', 'data-pipeline': 'admin', infra: 'admin', docs: 'admin', 'legacy-billing': 'admin', sandbox: 'admin' } },
    { slug: 'developers', name: 'Developers', members: ['chloe-jansen', 'daan-bakker', 'eva-smit', 'farid-haddou'], repos: { docs: 'write', sandbox: 'write' } },
    { slug: 'shop-team', name: 'Shop', parent: 'developers', members: ['chloe-jansen', 'daan-bakker'], repos: { shop: 'maintain', 'shop-web': 'write' } },
    { slug: 'data-team', name: 'Data', parent: 'developers', members: ['eva-smit', 'farid-haddou'], repos: { 'data-pipeline': 'write' } },
    { slug: 'security', name: 'Security', members: ['gijs-mulder'], repos: { shop: 'triage', infra: 'read' } },
  ],
  repos: [
    {
      name: 'shop',
      description: 'The web shop',
      rulesets: [{ name: 'Release branches', refs: ['refs/heads/release/*'], rules: [rule.reviews(2), rule.noDelete] }],
      environments: [{ name: 'staging' }, { name: 'production', reviewers: ['platform'], wait: 10 }],
      secrets: ['DEPLOY_KEY'],
      variables: ['REGION'],
      codeowners: '# Who looks at what\n*        @kestrel-logistics/shop-team\n/infra/  @kestrel-logistics/platform\n/docs/   @kestrel-logistics/developers\n',
    },
    { name: 'shop-web' },
    { name: 'data-pipeline', environments: [{ name: 'production', reviewers: ['platform'] }], secrets: ['WAREHOUSE_PASSWORD', 'DBT_TOKEN'] },
    { name: 'infra', visibility: 'internal' },
    { name: 'docs', visibility: 'public', protection: { reviews: 1 } },
    { name: 'legacy-billing', archived: true },
    { name: 'sandbox' },
  ],
  rulesets: [{ name: 'Default branches', exclude: ['legacy-*', 'docs', 'sandbox'], rules: [rule.reviews(1, true), rule.checks('build', 'test'), rule.noForce, rule.noDelete] }],
  direct: { infra: { 'bram-dekker': 'admin' } },
  outside: { shop: { 'ivo-extern': 'write' } },
  secrets: [['AZURE_CLIENT_ID', 'all'], ['NPM_TOKEN', 'selected']],
  variables: [['AZURE_TENANT_ID', 'all']],
  runners: [
    { name: 'runner-ams-01', os: 'linux', group: 'prod-deploy', labels: ['prod'] },
    { name: 'runner-ams-02', os: 'linux', group: 'prod-deploy', labels: ['prod'] },
  ],
  apps: [
    { slug: 'kestrel-deploy', selection: 'selected', permissions: { contents: 'read', deployments: 'write', metadata: 'read' } },
    { slug: 'dependency-bot', selection: 'all', permissions: { contents: 'write', pull_requests: 'write', metadata: 'read' } },
  ],
});
save('kestrel', files(kestrel()));

// ---- and a month later: the Data team got a hand in the shop, Security lost infra, a contractor
// joined, sandbox got protected, and a new repository appeared with nothing guarding it.
const later = kestrel();
const team = (slug) => later.teams.find((t) => t.slug === slug);
team('data-team').repos.shop = 'write';
delete team('security').repos.infra;
team('shop-team').repos['shop-web'] = 'maintain';
team('shop-team').members.push('hanna-koning');
later.outside['data-pipeline'] = { 'jesse-contractor': 'admin' };
later.rulesets[0].exclude = ['legacy-*', 'docs'];
later.repos.push({ name: 'route-planner' });
team('platform').repos['route-planner'] = 'admin';
team('developers').repos['route-planner'] = 'write';
save('kestrel-later', files(later));

// ---- the same organisation in one file
{
  const all = files(kestrel());
  const at = (path) => JSON.parse(all[path]);
  const per = (re) => Object.fromEntries(Object.keys(all).flatMap((p) => (re.exec(p) ? [[re.exec(p)[1], p.endsWith('.json') ? at(p) : all[p]]] : [])));
  const repoRules = per(/^repos\/([^/]+)\/rulesets\.json$/);
  for (const [repo, list] of Object.entries(repoRules)) repoRules[repo] = list.map((r) => (r.source_type === 'Repository' ? at(`repos/${repo}/rulesets/${r.id}.json`) : r));
  const combined = {
    org: at('org.json'),
    teams: at('teams.json'),
    repos: at('repos.json'),
    members: at('members.json'),
    owners: at('owners.json'),
    outside_collaborators: at('outside-collaborators.json'),
    team_members: per(/^teams\/([^/]+)\/members\.json$/),
    team_repos: per(/^teams\/([^/]+)\/repos\.json$/),
    collaborators: per(/^repos\/([^/]+)\/collaborators\.json$/),
    environments: per(/^repos\/([^/]+)\/environments\.json$/),
    rulesets: at('rulesets.json').map((r) => at(`rulesets/${r.id}.json`)),
    repo_rulesets: repoRules,
    branch_protection: Object.fromEntries(Object.entries(per(/^repos\/([^/]+)\/branch-protection\.json$/)).filter(([, v]) => !v.message)),
    codeowners: per(/^repos\/([^/]+)\/CODEOWNERS$/),
    secrets: at('secrets.json').secrets,
    variables: at('variables.json').variables,
    repo_secrets: Object.fromEntries(Object.entries(per(/^repos\/([^/]+)\/secrets\.json$/)).map(([r, v]) => [r, v.secrets])),
    repo_variables: Object.fromEntries(Object.entries(per(/^repos\/([^/]+)\/variables\.json$/)).map(([r, v]) => [r, v.variables])),
    runners: at('runners.json').runners,
    runner_groups: at('runner-groups.json').runner_groups,
    installations: at('installations.json').installations,
  };
  writeFileSync(join(here, 'kestrel-combined.json'), JSON.stringify(combined, null, 2) + '\n');
}

// ---- a large organisation: 120 repositories, 31 teams, 300 people. Only the lists a first look needs.
{
  let seed = 7;
  const next = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648), Math.floor(seed / 65536) % n);
  const areas = ['shop', 'data', 'route', 'fleet', 'billing', 'warehouse', 'partner', 'mobile'];
  const kinds = ['api', 'web', 'worker', 'schema', 'infra', 'docs', 'client', 'jobs', 'gateway', 'events', 'reports', 'tools', 'tests', 'config', 'sdk'];
  const repos = areas.flatMap((a) => kinds.map((k) => ({ name: `${a}-${k}`, archived: k === 'tools' && a === 'billing' })));
  const people = Array.from({ length: 300 }, (_, i) => `dev-${String(i + 1).padStart(3, '0')}`);
  const teams = [
    { slug: 'platform', name: 'Platform', members: people.slice(0, 8), repos: Object.fromEntries(repos.map((r) => [r.name, 'admin'])) },
    { slug: 'engineering', name: 'Engineering', members: [], repos: Object.fromEntries(repos.filter((r) => r.name.endsWith('-docs')).map((r) => [r.name, 'write'])) },
    { slug: 'security', name: 'Security', members: people.slice(8, 14), repos: Object.fromEntries(repos.filter((r) => /-(api|gateway|infra)$/.test(r.name)).map((r) => [r.name, 'triage'])) },
    ...areas.flatMap((a) => [
      { slug: `${a}-developers`, name: `${a[0].toUpperCase()}${a.slice(1)} developers`, parent: 'engineering', members: [], repos: Object.fromEntries(repos.filter((r) => r.name.startsWith(`${a}-`)).map((r) => [r.name, 'write'])) },
      { slug: `${a}-leads`, name: `${a[0].toUpperCase()}${a.slice(1)} leads`, parent: `${a}-developers`, members: [], repos: Object.fromEntries(repos.filter((r) => r.name.startsWith(`${a}-`)).map((r) => [r.name, 'maintain'])) },
      { slug: `${a}-readers`, name: `${a[0].toUpperCase()}${a.slice(1)} readers`, members: [], repos: Object.fromEntries(repos.filter((r) => r.name.startsWith(`${a}-`) && !/-(infra|config)$/.test(r.name)).map((r) => [r.name, 'read'])) },
    ]),
    { slug: 'release', name: 'Release', members: people.slice(14, 20), repos: Object.fromEntries(repos.filter((r) => /-(api|web|worker)$/.test(r.name)).map((r) => [r.name, 'maintain'])) },
  ];
  for (const p of people.slice(20)) {
    const a = areas[next(areas.length)];
    teams.find((t) => t.slug === `${a}-developers`).members.push(p);
    if (next(9) === 0) teams.find((t) => t.slug === `${a}-leads`).members.push(p);
    const other = areas[next(areas.length)];
    if (next(4) === 0) teams.find((t) => t.slug === `${other}-readers`).members.push(p);
  }
  save('large', files({ base: 'none', owners: people.slice(0, 3), teams, repos, light: true, rulesets: [{ name: 'Default branches', rules: [rule.reviews(1), rule.checks('build'), rule.noForce] }] }));
}
