import { names, type Answers, type Wizard } from '../engine.ts';
import { comment, entry, file, ids, scalar, slug } from '../yaml.ts';

const GIT_SOURCE = 'Scott Chacon, "GitHub Flow" (2011); Vincent Driessen, "A successful Git branching model" (2010); trunkbaseddevelopment.com (release branches)';

export const gitStrategy: Wizard = {
  id: 'git-strategy',
  name: 'Git branching strategy',
  type: 'gitflow',
  description: 'GitHub Flow, Git Flow or trunk-based with release branches, with your next feature on top',
  source: GIT_SOURCE,
  questions: [
    { id: 'product', kind: 'text', label: 'Which product or repository?', default: 'Web shop' },
    {
      id: 'strategy',
      kind: 'choice',
      label: 'How does work reach production?',
      default: 'github-flow',
      options: [
        { value: 'github-flow', label: 'GitHub Flow', help: 'Short branches off main, a pull request each, every merge deploys. Web apps, one version live.' },
        { value: 'trunk-based', label: 'Trunk-based', help: 'Everyone merges into main at least daily; unfinished work behind feature flags.' },
        { value: 'release-branches', label: 'Trunk-based with release branches', help: 'Main moves on; each release gets a branch that only takes fixes. Several versions in support.' },
        { value: 'gitflow', label: 'Git Flow', help: 'develop, release and hotfix branches; for scheduled releases of installed software.' },
      ],
    },
    { id: 'feature', kind: 'text', label: 'What is the next feature called?', default: 'checkout', help: 'Drawn as the branch after the canonical history; empty for none.' },
    {
      id: 'view',
      kind: 'choice',
      label: 'Draw what?',
      default: 'branches',
      options: [
        { value: 'branches', label: 'Branches and commits' },
        { value: 'delivery', label: 'Delivery pipeline', help: 'The same branches through build, test, staging and production.' },
      ],
    },
  ],
  build: buildGit,
};

function buildGit(a: Answers): string {
  const strategy = String(a.strategy);
  const product = String(a.product) || 'Web shop';
  const feature = slug(String(a.feature ?? '')).slice(0, 30);
  const name = { 'github-flow': 'GitHub Flow', 'trunk-based': 'Trunk-based development', 'release-branches': 'Trunk-based with release branches', gitflow: 'Git Flow' }[strategy] ?? strategy;
  const L: (string | false)[] = [];
  L.push(...comment(`Made by the Git branching wizard (carto new --wizard git-strategy). Follows ${GIT_SOURCE}.`));
  L.push('type: gitflow');
  L.push(`title: ${scalar(`${name} at ${product}`)}`);
  L.push(`preset: ${strategy}`);
  if (a.view === 'delivery') L.push('view: delivery');
  if (feature) {
    L.push('');
    L.push(...comment('The preset draws the strategy; these steps continue it with the next feature.'));
    L.push('steps:');
    const branch = strategy === 'trunk-based' ? `feat/${feature}` : `feature/${feature}`;
    L.push(`  - commit: ${branch}`);
    L.push(`    label: ${scalar(`Start ${String(a.feature).trim()}`)}`);
    L.push(`  - commit: ${branch}`);
    L.push(`    label: Tests`);
    L.push(`    note: ${strategy === 'trunk-based' ? 'Behind a flag' : 'Open PR'}`);
    if (strategy === 'gitflow') {
      L.push(`  - merge: ${branch} -> develop`);
      L.push(`    note: Deploy to test`);
    } else if (strategy === 'github-flow') {
      L.push(`  - merge: ${branch} -> main`);
      L.push(`    deploy: production`);
    } else {
      L.push(`  - merge: ${branch} -> main`);
      if (strategy === 'trunk-based') L.push(`    note: Flag on`);
    }
  }
  return file(L);
}

const TEAMS_SOURCE = 'Matthew Skelton and Manuel Pais, "Team Topologies" (IT Revolution, 2019): four team types and three interaction modes';

export const teamTopologies: Wizard = {
  id: 'team-topologies',
  name: 'Team Topologies setup',
  type: 'teams',
  description: 'Stream-aligned teams with the platform, enabling and complicated-subsystem teams that serve them',
  source: TEAMS_SOURCE,
  questions: [
    { id: 'org', kind: 'text', label: 'Which organisation or product?', default: 'Web shop' },
    { id: 'stream', kind: 'text', list: true, label: 'Stream-aligned teams (one per flow of change)', default: 'Browse, Checkout, Delivery, Accounts', help: 'Names, separated by commas (1 to 8).' },
    { id: 'platform', kind: 'text', list: true, label: 'Platform teams', default: 'Cloud platform', help: 'Separated by commas; empty for none.' },
    { id: 'enabling', kind: 'text', list: true, label: 'Enabling teams', default: 'Developer experience', help: 'Separated by commas; empty for none.' },
    { id: 'subsystem', kind: 'text', list: true, label: 'Complicated-subsystem teams', default: 'Search ranking', help: 'Specialist work the stream teams use as a service; empty for none.' },
    { id: 'collaborate', kind: 'yesno', label: 'Are two stream-aligned teams collaborating right now?', default: false, help: 'Collaboration is meant to be temporary: drawn as a bridge between them.', when: (a) => names(a.stream).length > 1 },
  ],
  build: buildTeams,
};

function buildTeams(a: Answers): string {
  const org = String(a.org) || 'Web shop';
  const stream = names(a.stream).slice(0, 8);
  if (!stream.length) stream.push('Product');
  const platform = names(a.platform).slice(0, 3);
  const enabling = names(a.enabling).slice(0, 3);
  const subsystem = names(a.subsystem).slice(0, 3);
  const all = ids([...stream, ...platform, ...enabling, ...subsystem]);
  const sid = all.slice(0, stream.length);
  const pid = all.slice(stream.length, stream.length + platform.length);
  const eid = all.slice(stream.length + platform.length, stream.length + platform.length + enabling.length);
  const cid = all.slice(stream.length + platform.length + enabling.length);
  const L: (string | false)[] = [];
  L.push(...comment(`Made by the Team Topologies wizard (carto new --wizard team-topologies). Follows ${TEAMS_SOURCE}.`));
  L.push('type: teams');
  L.push(`title: ${scalar(`${org} teams`)}`);
  L.push(`subtitle: ${scalar(`${stream.length} stream-aligned, ${platform.length} platform, ${enabling.length} enabling, ${subsystem.length} complicated-subsystem`)}`);
  L.push('flow: Flow of change to customers');
  L.push('');
  L.push('teams:');
  stream.forEach((t, i) => L.push(entry(sid[i]!, { label: t === sid[i] ? undefined : t, kind: 'stream-aligned', size: 7 })));
  platform.forEach((t, i) => L.push(entry(pid[i]!, { label: t, kind: 'platform', caption: 'Self-service, as a product', size: 8 })));
  enabling.forEach((t, i) => L.push(entry(eid[i]!, { label: t, kind: 'enabling', caption: 'Helps teams learn, then leaves', size: 3 })));
  subsystem.forEach((t, i) => L.push(entry(cid[i]!, { label: t, kind: 'complicated-subsystem', size: 4 })));
  const lines: string[] = [];
  // Every stream team uses the platform as a service. The drawing lays a platform under all stream
  // teams, so one line from the team next to it says it; a line from each would loop around the others.
  for (const p of pid) lines.push(`  - ${sid[sid.length - 1]} -> ${p}: x-as-a-service`);
  // Enabling teams work with a few teams at a time: each with two neighbouring stream teams.
  eid.forEach((e, i) => [...new Set([sid[(2 * i) % sid.length]!, sid[(2 * i + 1) % sid.length]!])].forEach((s) => lines.push(`  - ${e} -> ${s}: facilitating`)));
  cid.forEach((c, i) => lines.push(`  - ${sid[i % sid.length]} -> ${c}: x-as-a-service`));
  if (a.collaborate && sid.length > 1) lines.push(`  - ${sid[0]} <-> ${sid[1]}: collaboration`);
  if (lines.length) {
    L.push('');
    L.push(...comment('x-as-a-service: one uses what the other provides · facilitating: one helps the other · collaboration: working closely, for a while.'));
    L.push('interactions:');
    L.push(...lines);
  }
  return file(L);
}
