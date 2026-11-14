import { describe, expect, it } from 'vitest';
import { icon } from '@linework/icons';
import { render } from '@linework/engine';
import { themes } from '@linework/theme';
import { gitflowGeometry, gitTextBoxes, type GitflowGeometry } from '@linework/render';
import type { Box, GitflowShape } from '@linework/core';
import { familyOf, gitflow, gitflowReferences, presetNames } from '../src/index.ts';

async function geometry(yaml: string) {
  const r = await render(yaml, { fonts: 'none' });
  const shape = r.graph?.nodes[0]?.shape as GitflowShape | undefined;
  return { r, shape: shape!, g: shape ? gitflowGeometry(shape, themes.light) : undefined };
}

const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Every vertical stretch of every line: forks, merges, deploy guides. */
function verticals(g: GitflowGeometry): { x: number; y1: number; y2: number }[] {
  const out: { x: number; y1: number; y2: number }[] = [];
  for (const l of g.links) {
    let x = 0;
    let y = 0;
    for (const [, op, args] of l.d.matchAll(/([MHVQC])([^MHVQC]*)/g)) {
      const n = args!.trim().split(/[\s,]+/).map(Number);
      if (op === 'V') out.push({ x, y1: Math.min(y, n[0]!), y2: Math.max(y, n[0]!) });
      if (op === 'M' || op === 'Q' || op === 'C') (x = n.at(-2)!), (y = n.at(-1)!);
      if (op === 'H') x = n[0]!;
      if (op === 'V') y = n[0]!;
    }
  }
  for (const d of g.deploys) out.push({ x: d.x, y1: d.y1, y2: d.y2 });
  return out;
}

function clean(g: GitflowGeometry) {
  const boxes = gitTextBoxes(g);
  for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) expect(overlap(a, b), `${a.commit} / ${b.commit}`).toBe(false);
  // No text sits on a dot, and no line runs through text.
  for (const b of boxes) for (const p of g.commits) expect(overlap(b, { x: p.x - p.half, y: p.y - 6, width: 2 * p.half, height: 12 }), `${b.commit} on ${p.c.id}`).toBe(false);
  for (const v of verticals(g)) for (const b of boxes) expect(v.x > b.x - 1 && v.x < b.x + b.width + 1 && v.y1 < b.y + b.height && v.y2 > b.y, `line at ${v.x} through ${b.commit}`).toBe(false);
  // Columns are in time order and never closer than a dot apart.
  for (const [i, p] of g.commits.entries()) if (i) expect(p.x).toBeGreaterThan(g.commits[i - 1]!.x + 6);
}

describe('gitflow', () => {
  it('has icons for the type and the palette', () => {
    expect(icon(gitflow.icon!)).toBeDefined();
    for (const p of gitflow.palette) expect(icon(p.icon), p.kind).toBeDefined();
  });

  it('knows branch families by name', () => {
    expect(['main', 'master', 'develop', 'release/1.2', 'hotfix/x', 'feature/a', 'feat/b', 'fix/c', 'spike'].map(familyOf)).toEqual(['main', 'main', 'develop', 'release', 'hotfix', 'feature', 'feature', 'feature', 'other']);
  });

  for (const preset of presetNames)
    it(`draws the ${preset} preset alone, cleanly`, async () => {
      const { r, shape, g } = await geometry(`type: gitflow\npreset: ${preset}\n`);
      expect(r.diagnostics).toEqual([]);
      expect(r.graph!.title).toBeTruthy();
      expect(shape.commits.length).toBeGreaterThan(6);
      expect(gitTextBoxes(g!).length).toBeGreaterThan(6);
      clean(g!);
      const d = await geometry(`type: gitflow\npreset: ${preset}\nview: delivery\n`);
      expect(d.r.diagnostics).toEqual([]);
      expect(d.g!.delivery!.cells.length).toBeGreaterThan(3);
    });

  it('lays out Git Flow in the classic lane order, sharing rows between short-lived branches', async () => {
    const { g } = await geometry('type: gitflow\npreset: gitflow\nsteps:\n  - commit: feature/x\n  - merge: feature/x -> develop\n');
    expect(g!.rows.map((r) => r.label)).toEqual(['main', 'hotfix/1.1.1', 'release/1.1', 'develop', 'feature/*', 'feature/search']);
  });

  it('continues a preset with own steps', async () => {
    const { r, shape, g } = await geometry(`type: gitflow
preset: trunk-based
steps:
  - commit: feat/search
    label: Search
  - merge: feat/search -> main
    tag: v2.5.0
`);
    expect(r.diagnostics).toEqual([]);
    const last = shape.commits.at(-1)!;
    expect([last.branch, last.tags, !!last.merge]).toEqual(['main', ['v2.5.0'], true]);
    clean(g!);
  });

  it('forks from the parent the branch kind implies, or from: when given', async () => {
    const { shape } = await geometry(`type: gitflow
steps:
  - commit: main
    id: m1
  - commit: develop
    id: d1
  - commit: feature/a
  - commit: hotfix/b
  - branch: spike/c
    from: main
  - commit: spike/c
`);
    const fork = (b: string) => shape.commits.find((c) => c.branch === b)!.fork;
    expect([fork('develop'), fork('feature/a'), fork('hotfix/b'), fork('spike/c')]).toEqual(['m1', 'd1', 'm1', 'm1']);
  });

  it('keeps forks from one commit apart: the second splits off later', async () => {
    const { g } = await geometry(`type: gitflow
steps:
  - commit: main
    deploy: production
  - commit: feature/a
  - commit: fix/b
  - merge: feature/a -> main
  - merge: fix/b -> main
`);
    const xs = verticals(g!).map((v) => Math.round(v.x));
    expect(new Set(xs).size).toBe(xs.length);
    clean(g!);
  });

  it('collapses runs, tags, notes, cherry-picks and deploys', async () => {
    const { r, shape, g } = await geometry(`type: gitflow
environments: [test, production]
steps:
  - commit: main
    count: 12
  - commit: main
    label: Fix
    id: fix
  - tag: v1
    on: main
  - note: Hot
    on: main
  - deploy: production
    on: main
  - commit: release/1
  - cherry-pick: fix
    into: release/1
`);
    expect(r.diagnostics).toEqual([]);
    expect(shape.commits[0]!.count).toBe(12);
    expect(shape.commits[1]).toMatchObject({ tags: ['v1'], notes: ['Hot'], deploy: ['production'] });
    expect(shape.commits.at(-1)!.pick).toBe('fix');
    expect(g!.envs.map((e) => e.label)).toEqual(['test', 'production']);
    expect(r.svg).toContain('12 commits');
    clean(g!);
  });

  it('says what is wrong', async () => {
    const r = await render(`type: gitflow
steps:
  - commit: main
  - merge: nope -> main
  - cherry-pick: ghost
    into: main
  - tag: v1
    on: develop
`, { fonts: 'none' });
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      'There is no branch "nope" to merge',
      'There is no commit "ghost" before this step; give the commit an id:',
      'Branch "develop" has no commits yet',
    ]);
  });

  it('follows branch renames through steps, and connects branches with a merge', () => {
    const src = { type: 'gitflow' as const, branches: { 'feature/a': null, develop: null }, steps: [{ commit: 'feature/a' }, { merge: 'feature/a -> develop' }] };
    expect(gitflowReferences(src).map((r) => [r.path.join('.'), r.id, r.start])).toEqual([
      ['steps.0.commit', 'feature/a', 0],
      ['steps.1.merge', 'feature/a', 0],
      ['steps.1.merge', 'develop', 13],
    ]);
    expect(gitflow.connect!(src, 'feature/a', 'develop')).toEqual({ path: ['steps'], value: { merge: 'feature/a -> develop' } });
  });

  it('renders its template', async () => {
    const r = await render(gitflow.template, { fonts: 'none' });
    expect(r.diagnostics).toEqual([]);
  });
});
