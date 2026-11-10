import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { render } from '@cartography/engine';
import { importGithub, isAccessExport, isGithubExport, type ExportFile } from '../src/index.ts';
import { accessOf } from '../../../types/github/src/index.ts';
import { accessChanges, type AccessSource } from '../../../types/access/src/index.ts';

// The fixtures are an invented organisation; examples/github/import/make-fixtures.mjs writes them.
const fixtures = path.resolve(import.meta.dirname, '../../../examples/github/import');
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const folder = (name: string): ExportFile[] => walk(path.join(fixtures, name)).map((f) => ({ path: path.relative(path.join(fixtures, name), f), text: fs.readFileSync(f, 'utf8') }));
type Entry = { kind: string; label?: string; caption?: string; in?: string; tags?: string[] };
type Doc = { title: string; groups: Record<string, Entry>; nodes: Record<string, Entry>; edges: (string | Record<string, { label?: string; style?: string }>)[] };
const doc = (yaml: string) => parse(yaml) as Doc;
/** The edges as `from -> to label style`, for comparing. */
const lines = (d: Doc) => d.edges.map((e) => (typeof e === 'string' ? e : `${Object.keys(e)[0]} ${Object.values(e)[0]!.label ?? ''} ${Object.values(e)[0]!.style ?? ''}`.replace(/\s+/g, ' ').trim()));

describe('GitHub import: a folder of gh api responses', () => {
  const out = importGithub(folder('kestrel'));
  const d = doc(out.yaml);

  it('reads every file and says what each one was', () => {
    expect(out.problems).toEqual([]);
    // GitHub's own 404 for an unprotected branch is said, not an error.
    expect(out.skipped.map((s) => s.why)).toEqual(Array(out.skipped.length).fill('GitHub answered "Branch not protected"'));
    expect(out.summary).toBe('5 teams, 7 repositories, 2 people, 3 rulesets, 3 environments');
    expect(d.title).toBe('Kestrel Logistics: teams and repositories');
  });

  it('nests teams, and draws what a team holds itself, not what it has from the team above', () => {
    expect(d.groups['developers']).toMatchObject({ kind: 'team-group', label: 'Developers' });
    expect(d.nodes['data-team']).toMatchObject({ kind: 'team', in: 'developers' });
    expect(lines(d)).toContain('developers -> sandbox write access');
    expect(lines(d)).not.toContain('data-team -> sandbox write access');
  });

  it('says on a team that it holds the same on every repository, instead of a line to each', () => {
    expect(d.nodes['platform']!.caption).toBe('admin on every repository · 2 members');
    expect(lines(d).filter((l) => l.startsWith('platform ->') && l.endsWith(' access') && !l.includes('approves'))).toEqual([]);
  });

  it('puts what is in a repository inside it: environments, rulesets, CODEOWNERS, secrets by name only', () => {
    expect(d.groups['shop']).toMatchObject({ kind: 'repo' });
    expect(d.nodes['shop-production']).toMatchObject({ kind: 'environment', in: 'shop', caption: 'reviewers · protected branches' });
    expect(d.nodes['shop-codeowners']).toMatchObject({ kind: 'codeowners', in: 'shop' });
    expect(d.nodes['shop-release-branches']).toMatchObject({ kind: 'ruleset', caption: 'release/* · 2 reviews' });
    expect(d.nodes['data-pipeline-secrets']).toMatchObject({ kind: 'secret', label: '2 secrets' });
    expect(lines(d)).toContain('platform -> shop-production approves access');
    // A secret's value is never in an export, and never in the diagram.
    expect(out.yaml).not.toMatch(/value|encrypted/i);
  });

  it('marks an outside collaborator as such, outside the organisation', () => {
    expect(d.nodes['ivo-extern']).toMatchObject({ kind: 'outside-collaborator' });
    expect(d.nodes['ivo-extern']!.in).toBeUndefined();
  });

  it('says what is worth a second look as warnings, and leaves the picture alone', () => {
    expect(out.warnings).toEqual(
      expect.arrayContaining([
        '1 repository has no ruleset or branch protection on the default branch: sandbox',
        'Team Platform is admin on 7 repositories',
        'bram-dekker is admin on infra directly, and already through team Platform',
      ]),
    );
  });

  it('draws without errors', async () => {
    const r = await render(out.yaml, { fonts: 'none' });
    expect(r.diagnostics.filter((x) => x.severity === 'error')).toEqual([]);
  });

  it('reads one combined JSON as it reads the folder', () => {
    const combined = importGithub([{ path: 'kestrel.json', text: fs.readFileSync(path.join(fixtures, 'kestrel-combined.json'), 'utf8') }]);
    expect(combined.problems).toEqual([]);
    expect(lines(doc(combined.yaml)).sort()).toEqual(lines(d).sort());
  });

  it('tells its files from those of the access importer', () => {
    const gh = folder('kestrel').filter((f) => f.path.endsWith('.json'));
    expect(gh.filter((f) => isAccessExport(f.text))).toEqual([]);
    expect(gh.filter((f) => isGithubExport(f.text)).length).toBeGreaterThan(30);
    const az = fs.readdirSync(path.resolve(fixtures, '../../access/import/kestrel')).map((f) => fs.readFileSync(path.resolve(fixtures, '../../access/import/kestrel', f), 'utf8'));
    expect(az.filter(isGithubExport)).toEqual([]);
  });

  it('has nothing to draw without teams or repositories', () => {
    const r = importGithub([{ path: 'x.json', text: '{"login":"someone","type":"User"}' }]);
    expect(r.yaml).toBe('');
  });
});

describe('GitHub import: importing again', () => {
  const first = importGithub(folder('kestrel')).yaml;

  it('changes nothing when nothing changed', () => {
    expect(importGithub(folder('kestrel'), { existing: first }).yaml).toBe(first);
  });

  it('keeps what was written by hand and follows the export for the rest', () => {
    const edited = first
      .replace('title: "Kestrel Logistics: teams and repositories"', 'title: Kestrel on GitHub')
      .replace('  infra: { kind: repo, label: infra,', '  # where the cloud lives\n  infra: { kind: repo, label: Infrastructure,')
      .replace('\nedges:\n', '\n  wiki: { kind: pages, label: Team wiki }\n\nedges:\n  - wiki -> docs: { label: links to }\n');
    const again = importGithub(folder('kestrel-later'), { existing: edited });
    const d = doc(again.yaml);
    expect(d.title).toBe('Kestrel on GitHub');
    expect(d.nodes['infra']!.label).toBe('Infrastructure');
    expect(again.yaml).toContain('# where the cloud lives');
    expect(d.nodes['wiki']).toEqual({ kind: 'pages', label: 'Team wiki' });
    expect(lines(d)).toContain('wiki -> docs links to');
    // What the export says now.
    expect(d.nodes['route-planner']).toMatchObject({ kind: 'repo', tags: ['imported'] });
    expect(d.nodes['shop-team']!.caption).toBe('3 members');
    expect(lines(d)).toContain('shop-team -> shop-web maintain access');
    expect(lines(d)).not.toContain('security -> infra read access');
  });

  it('leaves an entry alone once its tag is taken off', () => {
    const edited = first.replace('  sandbox: { kind: repo, label: sandbox, in: kestrel-logistics, tags: [imported] }', '  sandbox: { kind: repo, label: Playground }');
    const d = doc(importGithub(folder('kestrel'), { existing: edited }).yaml);
    expect(d.nodes['sandbox']).toEqual({ kind: 'repo', label: 'Playground' });
    expect(lines(d)).toContain('developers -> sandbox write access');
  });
});

describe('GitHub import: as who reaches which repository', () => {
  const out = importGithub(folder('kestrel'), { as: 'access' });
  const d = parse(out.yaml) as Omit<AccessSource, 'roles' | 'assignments'> & { roles: Record<string, { inherits?: string }>; assignments: string[] };

  it('is an access diagram: teams are groups, read to admin a ladder, owners on the organisation', async () => {
    expect(out.yaml).toMatch(/^type: access/);
    expect(d.roles['write']!.inherits).toBe('triage');
    expect(d.assignments).toContain('platform is admin on infra');
    expect(d.assignments.some((a) => /is owner on kestrel-logistics$/.test(a))).toBe(true);
    expect((d.principals!['ivo-extern'] as { kind: string }).kind).toBe('guest');
    const r = await render(out.yaml, { fonts: 'none', view: 'access' });
    expect(r.diagnostics.filter((x) => x.severity === 'error')).toEqual([]);
  });
});

describe('GitHub import: a large organisation', () => {
  const out = importGithub(folder('large'));
  const d = doc(out.yaml);

  it('draws repositories by family, each line saying on how many of them a team holds its role', () => {
    const repos = Object.values({ ...d.groups, ...d.nodes }).filter((e) => e.kind === 'repo');
    expect(repos.length).toBe(8);
    expect(repos.map((r) => r.label)).toContain('shop-*');
    expect(lines(d).length).toBeLessThan(90);
    expect(lines(d).some((l) => / · \d+ of 15 access$/.test(l))).toBe(true);
    expect(out.warnings.join('\n')).toMatch(/300 members of teams folded/);
  });

  it('draws each repository when asked', () => {
    const all = doc(importGithub(folder('large'), { groupBy: 'none' }).yaml);
    expect(Object.values({ ...all.groups, ...all.nodes }).filter((e) => e.kind === 'repo').length).toBe(120);
  });

  it('draws one family', () => {
    const shop = doc(importGithub(folder('large'), { scope: 'shop-' }).yaml);
    expect(Object.values({ ...shop.groups, ...shop.nodes }).filter((e) => e.kind === 'repo').every((r) => r.label!.startsWith('shop-'))).toBe(true);
  });
});

describe('GitHub: what was gained and lost', () => {
  const before = importGithub(folder('kestrel'));
  const after = importGithub(folder('kestrel-later'), { existing: before.yaml });

  it('tells it in words, effective access: a team in a team gains what that team gains', () => {
    const words = accessChanges(accessOf(parse(before.yaml)) as AccessSource, accessOf(parse(after.yaml)) as AccessSource).map((c) => c.text);
    expect(words).toEqual(
      expect.arrayContaining([
        'Developers gained write on route-planner, and with it Data, Shop',
        'Security lost read on infra',
        'Shop changed from write to maintain on shop-web',
        'Platform gained admin on route-planner',
        'jesse-contractor gained admin on data-pipeline',
      ]),
    );
  });
});
