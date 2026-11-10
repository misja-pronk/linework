// GitHub: what an organisation review asks first, the same questions `carto import` asks of an
// export (packages/import github-org.ts), here of a drawing.
import { t } from '../nl.ts';
import type { Hit, Rule } from '../types.ts';

const pack = 'github';
const gh = ['github'];
const ADMIN = /\badmin\b/i;
/** "admin on 7", "admin × 7", "7 repositories". */
const MANY = /(?:\bon\s+|×\s*|\bx\s*)(\d+)|(\d+)\s+repo/i;

export const githubRules: Rule[] = [
  {
    id: 'github.repo-without-ruleset',
    pack,
    title: 'Default branches are protected',
    why: 'Without a ruleset or branch protection anyone with write access can push to main, skip review and rewrite history.',
    severity: 'warn',
    category: 'security',
    appliesTo: gh,
    fix: 'Add a ruleset on the default branch (pull request with review, status checks, no force push) and draw it in the repository, or a protects line from an organisation ruleset',
    docs: 'GitHub rulesets and branch protection',
    check(m) {
      const repos = m.ofKind('repo');
      // Only where the drawing shows protection at all, or the repository with what is in it: a picture of who reaches what says nothing about rules.
      const modelled = m.has('ruleset') || m.lines.some((l) => l.style === 'protects');
      return repos
        .filter((r) => {
          if (!modelled && !(r.group && m.inside(r.id).length)) return false;
          const parts = new Set([r.id, ...m.inside(r.id).map((e) => e.id)]);
          const ruled = m.inside(r.id).some((e) => e.kind === 'ruleset') || m.lines.some((l) => parts.has(l.to) && (l.style === 'protects' || m.el(l.from)?.kind === 'ruleset'));
          return !ruled && !m.tagged(r.id, 'protected');
        })
        .map((r) => ({ on: { kind: r.group ? 'group' : 'node', id: r.id }, message: t(m.lang, '{name} has no ruleset or branch protection on its default branch', { name: r.label }) }));
    },
  },
  {
    id: 'github.admin-on-many-repos',
    pack,
    title: 'Admin rights stay with few people per repository',
    why: 'A team that is admin everywhere can turn off every protection; its members\' tokens are the organisation\'s keys.',
    severity: 'warn',
    category: 'security',
    appliesTo: gh,
    options: { 'admin-above': 5 },
    fix: 'Give the team maintain or write and keep admin to a small platform group; admin-above in rules.yaml sets how many repositories are many',
    docs: 'GitHub repository roles for an organisation',
    check(m, o) {
      const above = o['admin-above'] ?? 5;
      const reach = new Map<string, number>();
      for (const l of m.lines) {
        if (l.style !== 'access' && !ADMIN.test(l.label)) continue;
        if (!ADMIN.test(l.label)) continue;
        const n = MANY.exec(l.label);
        reach.set(l.from, (reach.get(l.from) ?? 0) + (n ? Number(n[1] ?? n[2]) : 1));
      }
      const hits: Hit[] = [];
      for (const [who, n] of reach) if (n > above && m.el(who)) hits.push({ on: { kind: m.el(who)!.group ? 'group' : 'node', id: who }, message: t(m.lang, '{name} is admin on {count} repositories', { name: m.name(who), count: n }) });
      return hits;
    },
  },
  {
    id: 'github.outside-collaborator-admin',
    pack,
    title: 'Outside collaborators are never admin',
    why: 'An admin from outside the organisation can change who has access and turn off protection, outside your offboarding.',
    severity: 'warn',
    category: 'security',
    appliesTo: gh,
    fix: 'Give the collaborator write or maintain, or make them a member under your SSO',
    check(m) {
      return m.lines
        .filter((l) => m.el(l.from)?.kind === 'outside-collaborator' && ADMIN.test(l.label))
        .map((l) => ({ on: { kind: 'edge', id: l.id }, message: t(m.lang, 'Outside collaborator {name} is admin on {repo}', { name: m.name(l.from), repo: m.name(l.to) }) }));
    },
  },
];
