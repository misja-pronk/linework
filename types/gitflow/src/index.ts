// Git branching: branches as lanes, commits along one time axis, forks, merges, cherry-picks, tags.
//
//   preset: gitflow                 gitflow | github-flow | trunk-based | release-branches: a canonical
//                                   history; steps below continue it
//   branches:
//     main: { tone: indigo }        optional: tone, family, from, keep (long-lived)
//   steps:
//     - commit: feature/login       a commit (the branch is created from its parent on first use)
//       label: Login form
//       note: PR review             notes and tags: one or a list
//     - merge: feature/login -> develop
//       tag: v1.2.0
//     - branch: release/1.2         fork now (from: develop by default for releases and features)
//     - cherry-pick: fix-1          a commit id, into: a branch
//       into: release/1.1
//     - commit: main
//       count: 12                   a collapsed run: "12 commits"
//       deploy: production          environments: a track under the branches
//   view: delivery                  the same branches through a CI/CD pipeline (stages:, pipelines:)
import {
  type BranchFamily,
  type BuildContext,
  type DiagramType,
  type GitBranch,
  type GitCommit,
  type GitPipeline,
  type GitStage,
  type Graph,
  type PaletteItem,
  type Path,
  type Reference,
  type Tone,
  tones,
} from '@cartography/core';
import { presetNames, presets, type PresetName } from './presets.ts';

export { presets, presetNames, type PresetName };

/** Branch names as git allows them, near enough: feature/login, release/1.2, v2.x. */
export const branchPattern = '^[A-Za-z0-9_][A-Za-z0-9_./-]*$';
export const MERGE = /^\s*([A-Za-z0-9_][A-Za-z0-9_./-]*)\s*->\s*([A-Za-z0-9_][A-Za-z0-9_./-]*)\s*$/;

export const familyTones: Record<BranchFamily, Tone> = { main: 'blue', develop: 'violet', release: 'amber', hotfix: 'rose', feature: 'teal', other: 'sky' };
const FAMILY_ORDER: BranchFamily[] = ['main', 'hotfix', 'release', 'develop', 'feature', 'other'];
const families = Object.keys(familyTones) as BranchFamily[];

/** The family a branch name says it belongs to. */
export function familyOf(name: string): BranchFamily {
  const n = name.toLowerCase();
  if (/^(main|master|trunk|production|prod)$/.test(n)) return 'main';
  if (/^(develop|development|dev|next|integration)$/.test(n)) return 'develop';
  if (/^(release|releases|rel)[/-]/.test(n) || n === 'release') return 'release';
  if (/^(hotfix|hotfixes|hot-fix)[/-]/.test(n)) return 'hotfix';
  if (/^(feature|features|feat|bugfix|fix|chore|topic|story|task|users?|pr|dependabot|renovate)[/-]/.test(n)) return 'feature';
  return 'other';
}

/** Where a new branch of a family comes from when the YAML does not say. */
function parentFamilies(f: BranchFamily): BranchFamily[] {
  if (f === 'main') return [];
  if (f === 'hotfix' || f === 'develop') return ['main'];
  return ['develop', 'main'];
}

export const defaultStages: Record<string, { label: string; icon: string; tone: Tone; action: string }> = {
  build: { label: 'Build', icon: 'package', tone: 'slate', action: 'Build' },
  test: { label: 'Test', icon: 'list-checks', tone: 'sky', action: 'Test' },
  staging: { label: 'Staging', icon: 'server', tone: 'amber', action: 'Deploy' },
  production: { label: 'Production', icon: 'rocket', tone: 'green', action: 'Release' },
};

interface BranchEntry {
  label?: string;
  tone?: Tone;
  family?: BranchFamily;
  from?: string;
  keep?: boolean;
}

type StageEntry = string | { label?: string; icon?: string; tone?: Tone };
type PipelineStep = string | { stage: string; label?: string; gate?: string };

export interface GitflowSource {
  type: 'gitflow';
  title?: string;
  subtitle?: string;
  preset?: PresetName;
  view?: 'branches' | 'delivery';
  branches?: Record<string, BranchEntry | string | null>;
  environments?: string[] | Record<string, string | { label?: string; tone?: Tone } | null>;
  stages?: Record<string, StageEntry | null>;
  pipelines?: Record<string, PipelineStep[]>;
  steps?: unknown[];
}

type Item = Record<string, unknown>;
const STEP_KEYS = ['commit', 'merge', 'branch', 'cherry-pick', 'tag', 'note', 'deploy'] as const;
type StepKind = (typeof STEP_KEYS)[number];

export function stepKind(item: unknown): StepKind | undefined {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
  return STEP_KEYS.find((k) => k in item);
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]);

export function buildGitflow(src: GitflowSource, ctx: BuildContext): Graph {
  const preset = src.preset ? presets[src.preset] : undefined;
  const declared = new Map<string, BranchEntry>();
  for (const [name, raw] of Object.entries(src.branches ?? {})) declared.set(name, typeof raw === 'string' ? { tone: raw as Tone } : (raw ?? {}));

  const branches = new Map<string, GitBranch & { latest?: string; base?: string }>();
  const commits: GitCommit[] = [];
  const ids = new Set<string>();
  let n = 0;

  const create = (name: string, path: Path, from?: string) => {
    const d = declared.get(name) ?? {};
    const family = d.family ?? familyOf(name);
    const b: GitBranch & { latest?: string; base?: string } = {
      name,
      ...(d.label ? { label: d.label } : {}),
      family,
      tone: d.tone ?? familyTones[family],
      keep: d.keep ?? (family === 'main' || family === 'develop'),
      path: declared.has(name) ? ['branches', name] : path,
    };
    const parent = from ?? d.from ?? parentFamilies(family).map((f) => [...branches.values()].find((p) => p.family === f && p.latest)?.name).find(Boolean);
    if (from && !branches.has(from)) ctx.error([...path, 'from'], `There is no branch "${from}" yet; commit to it first`);
    // Where it forks: the newest commit on its parent right now.
    b.base = parent ? branches.get(parent)?.latest : undefined;
    branches.set(name, b);
    return b;
  };
  const branch = (name: string, path: Path) => branches.get(name) ?? create(name, path);

  const commit = (on: string, o: Item, path: Path, extra: Partial<GitCommit> = {}) => {
    const b = branch(on, path);
    let id = typeof o.id === 'string' ? o.id : `c${++n}`;
    if (ids.has(id)) {
      ctx.error([...path, 'id'], `Commit id "${id}" is used twice`);
      id = `${id}-${++n}`;
    }
    while (ids.has(id)) id = `c${++n}`;
    ids.add(id);
    const count = typeof o.count === 'number' && o.count > 1 ? Math.round(o.count) : undefined;
    const c: GitCommit = {
      id,
      branch: on,
      ...(o.label != null ? { label: String(o.label) } : {}),
      tags: list(o.tag),
      notes: list(o.note),
      ...(count ? { count } : {}),
      ...(!b.latest && b.base ? { fork: b.base } : {}),
      deploy: list(o.deploy),
      path,
      ...extra,
    };
    commits.push(c);
    b.latest = id;
    return c;
  };
  const latest = (on: unknown, path: Path): GitCommit | undefined => {
    const b = typeof on === 'string' ? branches.get(on) : undefined;
    const c = b?.latest ? commits.find((x) => x.id === b.latest) : undefined;
    if (!c) ctx.error(path, typeof on === 'string' ? `Branch "${on}" has no commits yet` : 'Say which branch: on: <branch>');
    return c;
  };

  // Preset steps point at preset: in the YAML, own steps at their own entry.
  const steps: [unknown, Path][] = [...(preset?.steps.map((s): [unknown, Path] => [s, ['preset']]) ?? []), ...(Array.isArray(src.steps) ? src.steps.map((s, i): [unknown, Path] => [s, ['steps', i]]) : [])];
  for (const [item, path] of steps) {
    const kind = stepKind(item);
    const o = (item ?? {}) as Item;
    if (!kind) {
      ctx.error(path, 'A step is a commit, merge, branch, cherry-pick, tag, note or deploy');
      continue;
    }
    if (kind === 'commit') commit(String(o.commit), o, path);
    else if (kind === 'branch') {
      const name = String(o.branch);
      if (branches.has(name)) ctx.warn(path, `Branch "${name}" exists already`);
      else create(name, path, typeof o.from === 'string' ? o.from : undefined);
    } else if (kind === 'merge') {
      const m = MERGE.exec(String(o.merge));
      const from = m ? m[1]! : String(o.merge);
      const into = m ? m[2]! : typeof o.into === 'string' ? o.into : undefined;
      if (!into) {
        ctx.error(path, 'Write merge: "feature/x -> develop", or merge: feature/x with into: develop');
        continue;
      }
      const source = branches.get(from);
      if (!source) {
        ctx.error([...path, 'merge'], `There is no branch "${from}" to merge`);
        continue;
      }
      // A branch without commits of its own merges the commit it started from.
      const head = source.latest ?? source.base;
      if (!head) {
        ctx.error([...path, 'merge'], `Branch "${from}" has nothing to merge yet`);
        continue;
      }
      commit(into, o, path, { merge: head });
    } else if (kind === 'cherry-pick') {
      const id = String(o['cherry-pick']);
      const into = typeof o.into === 'string' ? o.into : undefined;
      if (!commits.some((c) => c.id === id)) {
        ctx.error([...path, 'cherry-pick'], `There is no commit "${id}" before this step; give the commit an id:`);
        continue;
      }
      if (!into) {
        ctx.error(path, 'Say where the commit goes: into: <branch>');
        continue;
      }
      commit(into, o, path, { pick: id });
    } else {
      const c = latest(o.on, [...path, 'on']);
      if (!c) continue;
      if (kind === 'tag') c.tags.push(String(o.tag));
      else if (kind === 'note') c.notes.push(String(o.note));
      else c.deploy.push(...list(o.deploy));
    }
  }

  // Lanes top to bottom: main, hotfixes, releases, develop, features (the classic Git Flow picture).
  const ordered = [...branches.values()].sort((a, b) => FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family));
  for (const name of declared.keys())
    if (!branches.has(name)) ctx.warn(['branches', name], `Branch "${name}" has no commits; it is not drawn`);

  // Environments: as listed, then any a deploy names.
  const envs: { id: string; label: string; tone: Tone }[] = [];
  const envTone = (id: string): Tone => (/prod/i.test(id) ? 'green' : /stag|accept|uat|preprod|qa/i.test(id) ? 'amber' : /test/i.test(id) ? 'sky' : 'slate');
  const rawEnvs = src.environments ?? preset?.environments;
  if (Array.isArray(rawEnvs)) for (const e of rawEnvs) envs.push({ id: String(e), label: String(e), tone: envTone(String(e)) });
  else
    for (const [id, e] of Object.entries(rawEnvs ?? {})) {
      const x = typeof e === 'string' ? { label: e } : (e ?? {});
      envs.push({ id, label: x.label ?? id, tone: x.tone ?? envTone(id) });
    }
  for (const c of commits) for (const d of c.deploy) if (!envs.some((e) => e.id === d)) envs.push({ id: d, label: d, tone: envTone(d) });

  const view = src.view ?? 'branches';
  const { stages, pipelines } = view === 'delivery' ? delivery(src, ordered, commits, ctx) : { stages: [], pipelines: [] };

  return {
    title: src.title ?? preset?.title,
    subtitle: src.subtitle ?? (src.title ? undefined : preset?.subtitle),
    direction: 'right',
    groups: [],
    nodes: [
      {
        id: 'gitflow',
        shape: { kind: 'gitflow', view, branches: ordered.map(({ latest: _, base: __, ...b }) => b), commits, environments: envs, stages, pipelines },
        path: [],
      },
    ],
    edges: [],
  };
}

/** Stages and the pipeline rows of the delivery view: one row per family (or per named branch). */
function delivery(src: GitflowSource, branches: GitBranch[], commits: GitCommit[], ctx: BuildContext): { stages: GitStage[]; pipelines: GitPipeline[] } {
  const rawStages = src.stages ?? Object.fromEntries(Object.keys(defaultStages).map((k) => [k, null]));
  const stages: (GitStage & { action: string })[] = Object.entries(rawStages).map(([id, raw]) => {
    const d = defaultStages[id];
    const e = typeof raw === 'string' ? { label: raw } : (raw ?? {});
    return { id, label: e.label ?? d?.label ?? id, icon: e.icon ?? d?.icon ?? 'circle-dot', tone: e.tone ?? d?.tone ?? 'slate', action: d?.action ?? e.label ?? id };
  });
  const known = new Set(stages.map((s) => s.id));
  const preset = src.preset ? presets[src.preset].pipelines : presets.gitflow.pipelines;
  // Own pipelines win; otherwise each family present gets the preset's (Git Flow's without a preset).
  const own = src.pipelines;
  const keys = own ? Object.keys(own) : [...new Set(branches.map((b) => b.family))].filter((f) => preset[f]);
  const pipelines: GitPipeline[] = [];
  const familyOfRow = new Map<GitPipeline, BranchFamily>();
  for (const key of keys) {
    const raw = own ? own[key]! : preset[key]!;
    const path: Path = own ? ['pipelines', key] : ['view'];
    const fam = (families as string[]).includes(key) ? (key as BranchFamily) : familyOf(key);
    const named = branches.filter((b) => b.family === fam);
    const label = !(families as string[]).includes(key) ? key : fam === 'main' || fam === 'develop' ? (named[0]?.name ?? key) : `${named[0]?.name.split('/')[0] ?? key}/*`;
    const steps: GitPipeline['steps'] = [];
    for (const [i, s] of (Array.isArray(raw) ? raw : []).entries()) {
      const e = typeof s === 'string' ? { stage: s } : s;
      if (!known.has(e.stage)) {
        ctx.error(own ? [...path, i] : path, `There is no stage "${e.stage}"; stages: ${[...known].join(', ')}`);
        continue;
      }
      const at = stages.findIndex((x) => x.id === e.stage);
      if (steps.length && stages.findIndex((x) => x.id === steps.at(-1)!.stage) >= at) {
        ctx.error(own ? [...path, i] : path, 'Stages in a pipeline go left to right, in the order of stages:');
        continue;
      }
      steps.push({ stage: e.stage, label: e.label ?? stages[at]!.action, ...(e.gate ? { gate: e.gate } : {}) });
    }
    pipelines.push({ label, tone: named[0]?.tone ?? familyTones[fam], steps, path });
    familyOfRow.set(pipelines.at(-1)!, fam);
  }
  // Rows in lane order: main on top, features at the bottom, as in the branches view.
  pipelines.sort((a, b) => FAMILY_ORDER.indexOf(familyOf(a.label.replace('/*', '/x'))) - FAMILY_ORDER.indexOf(familyOf(b.label.replace('/*', '/x'))));
  // Where a family's branches merge in the history, its row hands over to that family's row: the nearest
  // one, and only when it is next to it, so the hand-over never runs through another row.
  const familyOfBranch = new Map(branches.map((b) => [b.name, b.family]));
  const byId = new Map(commits.map((c) => [c.id, c]));
  const shown = pipelines.filter((p) => p.steps.length);
  const rowOf = (f: BranchFamily | undefined) => shown.findIndex((p) => familyOfRow.get(p) === f);
  for (const c of commits) {
    const from = rowOf(c.merge ? familyOfBranch.get(byId.get(c.merge)?.branch ?? '') : undefined);
    const to = rowOf(familyOfBranch.get(c.branch));
    if (from >= 0 && to >= 0 && Math.abs(from - to) === 1) shown[from]!.into ??= shown[to]!.label;
  }
  return { stages: stages.map(({ action: _, ...s }) => s), pipelines: shown };
}

/** Branch names in steps and commit ids in cherry-picks, so renames follow them. */
export function gitflowReferences(src: GitflowSource): Reference[] {
  const out: Reference[] = [];
  const names = new Set(Object.keys(src.branches ?? {}));
  if (!names.size) return out;
  for (const [i, item] of (Array.isArray(src.steps) ? src.steps : []).entries()) {
    const kind = stepKind(item);
    if (!kind) continue;
    const o = item as Item;
    const path = ['steps', i];
    const at = (key: string) => {
      const v = o[key];
      if (typeof v === 'string' && names.has(v)) out.push({ path: [...path, key], id: v, start: 0, collection: 'branches', onDelete: 'item' });
    };
    if (kind === 'merge' && typeof o.merge === 'string') {
      const m = new RegExp(MERGE.source, 'd').exec(o.merge);
      if (m?.indices) for (const g of [1, 2]) if (names.has(m[g]!)) out.push({ path: [...path, 'merge'], id: m[g]!, start: m.indices[g]![0], collection: 'branches', onDelete: 'item' });
      if (!m) at('merge');
    } else if (kind === 'commit' || kind === 'branch') at(kind);
    for (const k of ['into', 'from', 'on']) at(k);
  }
  return out;
}

// ---------------------------------------------------------------- schema

const tone = { enum: tones };
const branchName = { type: 'string', pattern: branchPattern };
const oneOrMany = { anyOf: [{ type: ['string', 'number'] }, { type: 'array', items: { type: ['string', 'number'] } }] };
const commitFields = {
  label: { type: ['string', 'number'], description: 'Commit message, shown under the dot' },
  id: { type: 'string', description: 'For cherry-pick: and links' },
  tag: { ...oneOrMany, description: 'Tag or release, e.g. v1.2.0' },
  note: { ...oneOrMany, description: 'Annotation, e.g. "PR review", "Deploy to test"' },
  deploy: { ...oneOrMany, description: 'Environments this commit is deployed to' },
};
const step = (key: string, value: object, extra: Record<string, object> = {}, description?: string) => ({
  type: 'object',
  required: [key],
  properties: { [key]: { ...value, ...(description ? { description } : {}) }, ...extra },
  additionalProperties: false,
});

const pipelineStep = {
  anyOf: [
    { type: 'string' },
    { type: 'object', required: ['stage'], properties: { stage: { type: 'string' }, label: { type: 'string' }, gate: { type: 'string', description: 'A check before this stage: Approval, Smoke tests' } }, additionalProperties: false },
  ],
};

const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Cartography git branching diagram',
  type: 'object',
  required: ['type'],
  properties: {
    type: { const: 'gitflow' },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    preset: { enum: presetNames, description: 'Start from a canonical history: gitflow, github-flow, trunk-based, release-branches' },
    view: { enum: ['branches', 'delivery'], description: 'branches: the history; delivery: the branches through the CI/CD pipeline' },
    branches: {
      type: 'object',
      propertyNames: branchName,
      additionalProperties: {
        anyOf: [
          { enum: tones },
          { type: 'null' },
          {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Shown instead of the name' },
              tone,
              family: { enum: families, description: 'Colour and lane order: main, develop, release, hotfix, feature, other' },
              from: { ...branchName, description: 'The branch it is created from' },
              keep: { type: 'boolean', description: 'Long-lived: the line runs to the end' },
            },
            additionalProperties: false,
          },
        ],
      },
    },
    environments: {
      anyOf: [
        { type: 'array', items: { type: 'string' } },
        { type: 'object', additionalProperties: { anyOf: [{ type: 'string' }, { type: 'null' }, { type: 'object', properties: { label: { type: 'string' }, tone }, additionalProperties: false }] } },
      ],
      description: 'Deployment targets, drawn as a track under the branches',
    },
    stages: {
      type: 'object',
      description: 'Delivery view: pipeline stages, left to right',
      additionalProperties: { anyOf: [{ type: 'string' }, { type: 'null' }, { type: 'object', properties: { label: { type: 'string' }, icon: { type: 'string' }, tone }, additionalProperties: false }] },
    },
    pipelines: {
      type: 'object',
      description: 'Delivery view: per family (feature, develop, release, hotfix, main) or branch, the stages it goes through',
      additionalProperties: { type: 'array', items: pipelineStep },
    },
    steps: {
      type: 'array',
      description: 'The history in order: commits, merges, branches, cherry-picks',
      items: {
        anyOf: [
          step('commit', branchName, { ...commitFields, count: { type: 'integer', minimum: 2, description: 'A run of commits, drawn as one "n commits" pill' } }, 'The branch the commit is on'),
          step('merge', { type: 'string' }, { ...commitFields, into: branchName }, '"feature/x -> develop", or a branch with into:'),
          step('branch', branchName, { from: branchName }, 'A new branch, forked from the newest commit of from:'),
          step('cherry-pick', { type: 'string' }, { ...commitFields, into: branchName }, 'The id of the commit to copy'),
          step('tag', { type: ['string', 'number'] }, { on: branchName }, 'Tags the newest commit on on:'),
          step('note', { type: ['string', 'number'] }, { on: branchName }, 'Annotates the newest commit on on:'),
          step('deploy', oneOrMany, { on: branchName }, 'Deploys the newest commit on on:'),
        ],
      },
    },
  },
  additionalProperties: false,
};

const palette: PaletteItem[] = [
  { collection: 'branches', kind: 'feature', label: 'Feature branch', icon: 'git-branch', tone: 'teal', keywords: ['feature', 'topic', 'pr'] },
  { collection: 'branches', kind: 'release', label: 'Release branch', icon: 'git-branch', tone: 'amber', keywords: ['release'] },
  { collection: 'branches', kind: 'hotfix', label: 'Hotfix branch', icon: 'git-branch', tone: 'rose', keywords: ['hotfix', 'patch'] },
  { collection: 'branches', kind: 'develop', label: 'Develop', icon: 'git-branch', tone: 'violet', keywords: ['integration'] },
  { collection: 'branches', kind: 'main', label: 'Main', icon: 'git-branch', tone: 'blue', keywords: ['trunk', 'master'] },
];

export const gitflow: DiagramType<GitflowSource> = {
  id: 'gitflow',
  name: 'Git branching',
  description: 'Branches as lanes, commits, merges, tags and releases; presets for Git Flow, GitHub Flow, trunk-based and release branches',
  icon: 'git-branch',
  tagline: 'Branches, merges and releases: a branching strategy at a glance',
  useWhen: ['Explaining Git Flow, GitHub Flow or trunk-based', 'How releases and hotfixes reach main', 'Which branch deploys to which environment', 'A real repository history, imported'],
  notFor: [
    { text: 'The order services call each other', use: 'sequence' },
    { text: 'Which repos and teams a GitHub org has', use: 'github' },
    { text: 'The states a pull request can be in', use: 'states' },
  ],
  keywords: ['git', 'git flow', 'gitflow', 'branching', 'branching strategy', 'branch', 'merge', 'release', 'hotfix', 'trunk', 'trunk-based', 'github flow', 'cherry-pick', 'tag', 'pull request', 'delivery', 'pipeline', 'ci/cd', 'promotion', 'gitgraph'],
  schema,
  palette,
  template: `type: gitflow
title: Our branching strategy
preset: gitflow

# Continue the history: commits, merges, tags
steps:
  - commit: feature/export
    label: Export CSV
  - merge: feature/export -> develop
    note: Deploy to test
`,
  build: buildGitflow,
  references: gitflowReferences,
  connect(src, from, to) {
    const known = (id: string) => !!src.branches && Object.hasOwn(src.branches, id);
    if (!known(from) || !known(to)) return 'Connect one branch to another to merge it';
    return { path: ['steps'], value: { merge: `${from} -> ${to}` } };
  },
  async layout(sized) {
    const s = sized.nodes.get('gitflow') ?? { width: 0, height: 0 };
    return { nodes: new Map([['gitflow', { x: 0, y: 0, width: s.width, height: s.height }]]), groups: new Map(), edges: new Map(), width: s.width, height: s.height };
  },
};
