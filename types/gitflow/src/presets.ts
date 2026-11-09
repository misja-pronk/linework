// Canonical histories of the four strategies people ask about, written as the steps a user would
// write. `preset: trunk-based` alone draws that strategy; own steps continue from where it ends.

export type PresetName = 'gitflow' | 'github-flow' | 'trunk-based' | 'release-branches';

type Step = Record<string, unknown>;
type PipelineStep = string | { stage: string; label?: string; gate?: string };

export interface Preset {
  title: string;
  subtitle: string;
  steps: Step[];
  environments?: string[];
  pipelines: Record<string, PipelineStep[]>;
}

export const presets: Record<PresetName, Preset> = {
  gitflow: {
    title: 'Git Flow',
    subtitle: 'develop integrates features; release branches stabilise; main only holds releases',
    steps: [
      { commit: 'main', label: 'Initial release', tag: 'v1.0.0' },
      { branch: 'develop' },
      { commit: 'develop', label: 'Set up CI' },
      { commit: 'feature/login', label: 'Login form' },
      { commit: 'develop', label: 'Update deps' },
      { commit: 'feature/search', label: 'Search index' },
      { commit: 'feature/login', label: 'Validation', note: 'PR review' },
      { merge: 'feature/login -> develop', note: 'Deploy to test' },
      { commit: 'feature/search', label: 'Search UI' },
      { branch: 'release/1.1' },
      { commit: 'release/1.1', label: 'Bump to 1.1.0', note: 'Deploy to staging' },
      { merge: 'feature/search -> develop' },
      { commit: 'release/1.1', label: 'Fix typo' },
      { merge: 'release/1.1 -> main', tag: 'v1.1.0' },
      { merge: 'release/1.1 -> develop' },
      { commit: 'hotfix/1.1.1', label: 'Fix crash' },
      { merge: 'hotfix/1.1.1 -> main', tag: 'v1.1.1' },
      { merge: 'hotfix/1.1.1 -> develop' },
      { commit: 'develop', label: 'Next sprint' },
    ],
    pipelines: {
      feature: ['build', { stage: 'test', label: 'Unit tests' }],
      develop: ['build', { stage: 'test', label: 'Deploy to test' }],
      release: ['build', 'test', { stage: 'staging', label: 'Deploy to staging' }],
      hotfix: ['build', 'test', { stage: 'staging', label: 'Verify fix' }],
      main: ['build', { stage: 'production', label: 'Deploy tag', gate: 'Approval' }],
    },
  },
  'github-flow': {
    title: 'GitHub Flow',
    subtitle: 'Branch off main, open a pull request, review, merge, deploy',
    environments: ['preview', 'production'],
    steps: [
      { commit: 'main', label: 'Initial commit', deploy: 'production' },
      { commit: 'feature/signup', label: 'Sign-up form' },
      { commit: 'fix/header', label: 'Fix header' },
      { commit: 'feature/signup', label: 'Tests', note: 'Open PR', deploy: 'preview' },
      { merge: 'fix/header -> main', deploy: 'production' },
      { commit: 'feature/signup', label: 'Review fixes', note: 'PR review' },
      { merge: 'feature/signup -> main', tag: 'v1.1.0', deploy: 'production' },
      { commit: 'feature/export', label: 'Export CSV', note: 'Open PR', deploy: 'preview' },
      { merge: 'feature/export -> main', deploy: 'production' },
    ],
    pipelines: {
      feature: ['build', { stage: 'test', label: 'PR checks' }, { stage: 'staging', label: 'Preview env' }],
      main: ['build', 'test', { stage: 'production', label: 'Deploy', gate: 'Review approved' }],
    },
  },
  'trunk-based': {
    title: 'Trunk-based development',
    subtitle: 'Everyone merges small changes into main at least daily; unfinished work hides behind flags',
    steps: [
      { commit: 'main', label: 'Release', tag: 'v2.3.0' },
      { commit: 'feat/cart', label: 'Cart API' },
      { commit: 'main', label: 'Refactor' },
      { merge: 'feat/cart -> main', note: 'Behind a flag' },
      { commit: 'fix/login', label: 'Fix login' },
      { merge: 'fix/login -> main' },
      { commit: 'main', count: 4 },
      { commit: 'feat/pay', label: 'Pay button' },
      { commit: 'feat/pay', label: 'Tests' },
      { merge: 'feat/pay -> main', note: 'Flag on' },
      { commit: 'main', label: 'Release', tag: 'v2.4.0' },
    ],
    pipelines: {
      feature: ['build', { stage: 'test', label: 'Pre-merge checks' }],
      main: ['build', 'test', { stage: 'staging', label: 'Auto deploy' }, { stage: 'production', label: 'Progressive rollout', gate: 'Smoke tests' }],
    },
  },
  'release-branches': {
    title: 'Release branches',
    subtitle: 'Work lands on main; each release gets a branch that only takes fixes',
    steps: [
      { commit: 'main', label: 'Feature A' },
      { commit: 'main', label: 'Feature B' },
      { branch: 'release/1.0' },
      { commit: 'release/1.0', label: 'Freeze', tag: 'v1.0.0' },
      { commit: 'main', label: 'Feature C' },
      { commit: 'main', label: 'Fix CVE', id: 'cve' },
      { 'cherry-pick': 'cve', into: 'release/1.0', tag: 'v1.0.1' },
      { commit: 'main', label: 'Feature D' },
      { branch: 'release/1.1' },
      { commit: 'release/1.1', label: 'Freeze', tag: 'v1.1.0' },
      { commit: 'main', label: 'Fix leak', id: 'leak' },
      { 'cherry-pick': 'leak', into: 'release/1.1', tag: 'v1.1.1' },
      { 'cherry-pick': 'leak', into: 'release/1.0', tag: 'v1.0.2' },
      { commit: 'main', label: 'Feature E' },
    ],
    pipelines: {
      main: ['build', { stage: 'test', label: 'Nightly tests' }],
      release: ['build', 'test', { stage: 'staging', label: 'Release candidate' }, { stage: 'production', label: 'Ship', gate: 'Approval' }],
    },
  },
};

export const presetNames = Object.keys(presets) as PresetName[];
