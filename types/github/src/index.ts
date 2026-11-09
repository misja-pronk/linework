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
    trigger: { label: 'Triggers', line: 'dashed', tone: 'green' },
    deploy: { label: 'Deploys', line: 'solid', tone: 'amber' },
    uses: { label: 'Uses', line: 'dotted', tone: 'slate' },
    oidc: { label: 'OIDC federation', line: 'dotted', tone: 'violet' },
    protects: { label: 'Protects', line: 'dashed', tone: 'rose' },
  },
};

const palette: PaletteItem[] = [
  ...Object.entries(config.groupKinds).map(([kind, k]) => ({ collection: 'groups', kind, ...k })),
  ...Object.entries(config.nodeKinds).map(([kind, k]) => ({ collection: 'nodes', kind, ...k })),
];

export const github: DiagramType<GraphSource> = {
  id: 'github',
  name: 'GitHub design',
  description: 'Organisations, teams, repositories, environments, workflows and access',
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
