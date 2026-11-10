// GitHub design: enterprise → organisations → teams and repositories, with environments,
// workflows, secrets, rulesets, runners and apps, and who has which access.
import { buildGraph, graphReferences, graphSchema, type DiagramType, type GraphSource, type GraphTypeConfig, type PaletteItem } from '@cartography/core';

// Generic line icons; GitHub's logo and Octicons are not used (trademark).
export const config: GraphTypeConfig = {
  groupKinds: {
    enterprise: { label: 'Enterprise', icon: 'building-complex', tone: 'slate' },
    org: { label: 'Organisation', icon: 'building', tone: 'slate' },
    repo: { label: 'Repository', icon: 'folder-git-2', tone: 'indigo' },
    'team-group': { label: 'Teams', icon: 'users', tone: 'blue', border: 'dashed' },
    'runner-group': { label: 'Runner group', icon: 'server-cog', tone: 'teal' },
    cloud: { label: 'Cloud', icon: 'cloud', tone: 'sky' },
    boundary: { label: 'Boundary', icon: 'square-dashed', tone: 'slate', border: 'dashed' },
  },
  nodeKinds: {
    team: { label: 'Team', icon: 'users', tone: 'blue' },
    user: { label: 'User', icon: 'user', tone: 'slate' },
    'outside-collaborator': { label: 'Outside collaborator', icon: 'user-round', tone: 'orange' },
    repo: { label: 'Repository', icon: 'folder-git-2', tone: 'indigo' },
    branch: { label: 'Branch', icon: 'git-branch', tone: 'indigo' },
    ruleset: { label: 'Ruleset', icon: 'shield-check', tone: 'rose', keywords: ['branch protection'] },
    codeowners: { label: 'CODEOWNERS', icon: 'scroll-text', tone: 'slate' },
    workflow: { label: 'Workflow', icon: 'workflow', tone: 'green', keywords: ['actions', 'ci'] },
    'reusable-workflow': { label: 'Reusable workflow', icon: 'workflow', tone: 'teal' },
    action: { label: 'Action', icon: 'play', tone: 'green' },
    environment: { label: 'Environment', icon: 'rocket', tone: 'amber', keywords: ['deployment'] },
    secret: { label: 'Secret', icon: 'key-round', tone: 'amber' },
    variable: { label: 'Variable', icon: 'variable', tone: 'slate' },
    'hosted-runner': { label: 'GitHub-hosted runner', icon: 'cpu', tone: 'teal' },
    'self-hosted-runner': { label: 'Self-hosted runner', icon: 'server-cog', tone: 'teal' },
    app: { label: 'GitHub App', icon: 'bot', tone: 'violet' },
    package: { label: 'Package', icon: 'package', tone: 'indigo', keywords: ['registry', 'ghcr'] },
    pages: { label: 'Pages', icon: 'globe', tone: 'sky' },
    'pull-request': { label: 'Pull request', icon: 'git-pull-request', tone: 'green' },
    'cloud-target': { label: 'Deployment target', icon: 'cloud', tone: 'sky' },
    'identity-provider': { label: 'Identity provider', icon: 'fingerprint-pattern', tone: 'slate', keywords: ['sso', 'oidc'] },
    service: { label: 'Service', icon: 'box', tone: 'slate' },
  },
  edgeStyles: {
    access: { label: 'Repository access', line: 'solid', tone: 'indigo' },
    member: { label: 'Member of', line: 'solid' },
    trigger: { label: 'Triggers', line: 'dashed', tone: 'green' },
    deploy: { label: 'Deploys', line: 'solid', tone: 'amber', pattern: 'double' },
    uses: { label: 'Uses', line: 'dotted', tone: 'slate' },
    oidc: { label: 'OIDC federation', line: 'dotted', tone: 'violet', pattern: 'beads' },
    protects: { label: 'Protects', line: 'dashed', tone: 'rose', pattern: 'ticks' },
  },
};

const palette: PaletteItem[] = [
  ...Object.entries(config.groupKinds).map(([kind, k]) => ({ collection: 'groups', kind, ...k })),
  ...Object.entries(config.nodeKinds).map(([kind, k]) => ({ collection: 'nodes', kind, ...k })),
];

/** read below triage below write below maintain below admin: what GitHub's own roles hold of each other. */
const LADDER = ['read', 'triage', 'write', 'maintain', 'admin'];
const PEOPLE = ['user', 'outside-collaborator'];

/**
 * Who reaches which repository, as an access diagram has it (principals, resources, roles,
 * assignments): teams in a team reach what that team reaches, members what their team does. For
 * `carto diff`, which tells what was gained and lost in plain words from it.
 */
export function accessOf(src: GraphSource) {
  const all = { ...(src.groups ?? {}), ...(src.nodes ?? {}) } as Record<string, { kind?: string; label?: string; caption?: string; in?: string } | string | null>;
  const entry = (id: string) => (typeof all[id] === 'object' && all[id] ? (all[id] as { kind?: string; label?: string; caption?: string; in?: string }) : { kind: typeof all[id] === 'string' ? (all[id] as string) : undefined, caption: undefined });
  const kind = (id: string) => entry(id).kind;
  const team = (id: string) => kind(id) === 'team' || kind(id) === 'team-group';
  const memberOf = new Map<string, Set<string>>();
  const join = (who: string, group: string) => memberOf.set(who, (memberOf.get(who) ?? new Set()).add(group));
  for (const id of Object.keys(all)) if (team(id) && entry(id).in && team(entry(id).in!)) join(id, entry(id).in!);
  const assignments: string[] = [];
  const roles = new Set<string>();
  const who = new Set<string>();
  for (const e of src.edges ?? []) {
    const text = typeof e === 'string' ? e : Object.keys(e as object)[0];
    const v = typeof e === 'object' && e ? (Object.values(e)[0] as { label?: string; style?: string } | undefined) : undefined;
    const m = text && /^\s*([A-Za-z0-9_.-]+)\s*(?:->|-->|\.\.>|--)\s*([A-Za-z0-9_.-]+)/.exec(text);
    if (!m) continue;
    const [, from, to] = m as unknown as [string, string, string];
    if (v?.style === 'member' && team(to)) join(from, to);
    else if (v?.style === 'access' && v.label && kind(to) === 'repo' && (team(from) || PEOPLE.includes(kind(from) ?? ''))) {
      // "read · 3 of 8" on a family of repositories: read, on what stands for them.
      const role = v.label.split(' · ')[0]!.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
      roles.add(role);
      assignments.push(`${from} is ${role} on ${to}`);
      who.add(from);
    }
  }
  // What an import says on a team that holds the same everywhere ("admin on every repository") instead of a line to each.
  const repos = Object.keys(all).filter((id) => kind(id) === 'repo');
  for (const id of Object.keys(all)) {
    const m = (team(id) || PEOPLE.includes(kind(id) ?? '')) && /^(\w+) on every repository\b/.exec(entry(id).caption ?? '');
    if (!m) continue;
    roles.add(m[1]!);
    who.add(id);
    for (const r of repos) assignments.push(`${id} is ${m[1]} on ${r}`);
  }
  for (const [k, v] of memberOf) for (const id of [k, ...v]) who.add(id);
  const principals = Object.fromEntries(
    [...who].filter((id) => team(id) || PEOPLE.includes(kind(id) ?? '')).map((id) => [id, { kind: team(id) ? 'group' : kind(id) === 'outside-collaborator' ? 'guest' : 'user', label: entry(id).label, caption: team(id) ? 'Team' : kind(id) === 'outside-collaborator' ? 'Outside collaborator' : undefined, 'member-of': memberOf.has(id) ? [...memberOf.get(id)!] : undefined }]),
  );
  const resources = Object.fromEntries(repos.map((id) => [id, { kind: 'repo', label: entry(id).label }]));
  // The ladder from read up, with every role between the lowest and highest one used, so "write holds read" still holds when nobody has triage.
  const used = LADDER.filter((r) => roles.has(r));
  const ladder = used.length ? LADDER.slice(LADDER.indexOf(used[0]!), LADDER.indexOf(used.at(-1)!) + 1) : [];
  const roleList = Object.fromEntries([...ladder.map((r, i) => [r, { label: r, inherits: i ? ladder[i - 1] : undefined }]), ...[...roles].filter((r) => !LADDER.includes(r)).map((r) => [r, { label: r }])]);
  return { type: 'access' as const, title: src.title, principals, resources, roles: roleList, assignments };
}

export const github: DiagramType<GraphSource> = {
  id: 'github',
  name: 'GitHub design',
  description: 'Organisations, teams, repositories, environments, workflows and access',
  icon: 'folder-git-2',
  tagline: 'How a GitHub organisation is set up: teams, repos, workflows',
  useWhen: [
    'Plan teams and who may write to which repository',
    'Show workflows, environments and where they deploy',
    'Document rulesets, secrets, runners and apps',
  ],
  notFor: [
    { text: 'Entra or cloud role assignments', use: 'access' },
    { text: 'The services the code becomes', use: 'systems' },
  ],
  keywords: [
    'github', 'repository', 'repo', 'team', 'organisation', 'organization', 'workflow', 'actions', 'environment', 'ci', 'cd', 'pipeline',
    'codeowners', 'ruleset', 'branch protection', 'runner', 'secret', 'oidc',
  ],
  schema: graphSchema('github', config, 'Cartography GitHub diagram'),
  palette,
  build: (src, ctx) => buildGraph(src, config, ctx),
  references: graphReferences,
  template: `type: github
title: GitHub setup
subtitle: Teams, repositories and deployments

groups:
  org: { kind: org, label: acme }
  shop: { kind: repo, label: acme/shop, in: org }
  azure: { kind: cloud, label: Azure }

nodes:
  devs: { kind: team, label: Developers, in: org }
  platform: { kind: team, label: Platform, in: org }
  rules: { kind: ruleset, label: main protected, caption: 1 review · status checks, in: shop }
  ci: { kind: workflow, label: ci.yml, caption: on pull request, in: shop }
  cd: { kind: workflow, label: deploy.yml, caption: on push to main, in: shop }
  staging: { kind: environment, label: staging, in: shop }
  production: { kind: environment, label: production, caption: required reviewers, in: shop }
  runner: { kind: hosted-runner, label: ubuntu-latest }
  app: { kind: cloud-target, label: Container Apps, in: azure }

edges:
  - devs -> shop: { label: write, style: access }
  - platform -> shop: { label: admin, style: access }
  - rules -> ci: { label: required check, style: protects }
  - ci -> runner: { label: runs on, style: uses }
  - cd -> staging: { style: deploy }
  - cd -> production: { style: deploy }
  - production -> app: { label: OIDC, style: oidc }
`,
};
