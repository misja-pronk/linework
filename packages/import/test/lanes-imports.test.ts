// Imports onto the lanes types: Mermaid gitGraph → gitflow, gantt and timeline → roadmap, git log → gitflow.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { render } from '@cartography/engine';
import { GIT_LOG_FORMAT, importGitLog, importMermaid } from '../src/index.ts';

async function clean(yaml: string) {
  const r = await render(yaml, { fonts: 'none' });
  expect(r.diagnostics, yaml).toEqual([]);
  return r;
}

describe('gitGraph', () => {
  it('turns checkouts into named steps', async () => {
    const { yaml, warnings } = importMermaid(`gitGraph
  commit id: "Init" tag: "v1.0"
  branch develop
  checkout develop
  commit
  branch "feature/login"
  commit msg: "Login form"
  checkout develop
  merge feature/login
  checkout main
  merge develop tag: "v1.1"
  cherry-pick id: "Init"
`);
    expect(warnings).toEqual([]);
    expect(parse(yaml).steps).toEqual([
      { commit: 'main', label: 'Init', id: 'Init', tag: 'v1.0' },
      { branch: 'develop', from: 'main' },
      { commit: 'develop' },
      { branch: 'feature/login', from: 'develop' },
      { commit: 'feature/login', label: 'Login form' },
      { merge: 'feature/login -> develop' },
      { merge: 'develop -> main', tag: 'v1.1' },
      { 'cherry-pick': 'Init', into: 'main' },
    ]);
    const r = await clean(yaml);
    expect(r.svg).toContain('v1.1');
  });
});

describe('gantt', () => {
  it('keeps sections, statuses, dependencies and milestones', async () => {
    const { yaml, warnings } = importMermaid(`gantt
  title Release plan
  dateFormat YYYY-MM-DD
  excludes weekends
  section Build
  Design      :done, des, 2026-01-05, 2026-01-10
  Code        :active, code, after des, 3w
  Review      :crit, 5d
  section Ship
  Go-live     :milestone, live, 2026-02-20, 0d
`);
    expect(warnings).toEqual(['excludes (weekends, holidays) is ignored: durations count every day']);
    const doc = parse(yaml);
    expect(doc.title).toBe('Release plan');
    expect(doc.lanes).toEqual({ Build: 'Build', Ship: 'Ship' });
    expect(doc.items).toEqual({
      des: { lane: 'Build', label: 'Design', from: '2026-01-05', to: '2026-01-09', status: 'done' },
      code: { lane: 'Build', label: 'Code', after: 'des', duration: '21d', status: 'active' },
      review: { lane: 'Build', label: 'Review', from: '2026-01-31', duration: '5d', status: 'at-risk' },
      live: { lane: 'Ship', label: 'Go-live', at: '2026-02-20' },
    });
    await clean(yaml);
  });

  it('reads other date formats', () => {
    const { yaml } = importMermaid('gantt\n  dateFormat DD.MM.YYYY\n  A :a, 03.02.2026, 2d\n');
    expect(parse(yaml).items.a.from).toBe('2026-02-03');
  });
});

describe('timeline', () => {
  it('makes periods the axis and sections phases', async () => {
    const { yaml } = importMermaid(`timeline
  title Social media
  section Early days
    2002 : LinkedIn
    2004 : Facebook : Google
         : Flickr
  section Video
    2005 : YouTube
`);
    const doc = parse(yaml);
    expect(doc.periods).toEqual(['2002', '2004', '2005']);
    expect(doc.phases).toEqual({ 'Early days': { from: '2002', to: '2004', tone: 'sky' }, Video: { from: '2005', to: '2005', tone: 'violet' } });
    expect(Object.values(doc.items).map((i: any) => `${i.in} ${i.label}`)).toEqual(['2002 LinkedIn', '2004 Facebook', '2004 Google', '2004 Flickr', '2005 YouTube']);
    await clean(yaml);
  });
});

describe('git log', () => {
  // Oldest first: main, develop off it, a feature merged into develop (branch deleted), a release tag.
  const log = [
    ['a1', '', 'tag: v1.0', 'Initial'],
    ['a2', 'a1', '', 'Readme'],
    ['b1', 'a2', '', 'Start develop'],
    ['f1', 'b1', '', 'Login form'],
    ['f2', 'f1', '', 'Login tests'],
    ['f3', 'f2', '', 'Login polish'],
    ['f4', 'f3', '', 'Login docs'],
    ['b2', 'b1 f4', '', "Merge branch 'feature/login' into develop"],
    ['a3', 'a2 b2', 'HEAD -> main, origin/main, tag: v1.1', "Merge branch 'develop'"],
    ['b3', 'b2', 'develop, origin/develop', 'Next'],
  ]
    .map((f) => f.join('\x1f'))
    .join('\n');

  it('recovers branches, forks and merges, and collapses plain runs', async () => {
    expect(GIT_LOG_FORMAT).toBe('%H%x1f%P%x1f%D%x1f%s');
    const { yaml, warnings } = importGitLog(log, { title: 'repo' });
    expect(warnings).toEqual([]);
    expect(parse(yaml).steps).toEqual([
      { commit: 'main', label: 'Initial', tag: 'v1.0' },
      { commit: 'main', label: 'Readme' },
      { branch: 'develop', from: 'main' },
      { commit: 'develop', label: 'Start develop' },
      { branch: 'feature/login', from: 'develop' },
      { commit: 'feature/login', label: 'Login form' },
      { commit: 'feature/login', count: 3 },
      { merge: 'feature/login -> develop' },
      { merge: 'develop -> main', tag: 'v1.1' },
      { commit: 'develop', label: 'Next' },
    ]);
    const r = await clean(yaml);
    expect(r.svg).toContain('3 commits');
  });

  it('keeps every commit with collapse: 0, and says when there is nothing', () => {
    expect(parse(importGitLog(log, { collapse: 0 }).yaml).steps).toHaveLength(12);
    expect(importGitLog('').warnings[0]).toMatch(/No commits/);
  });
});
