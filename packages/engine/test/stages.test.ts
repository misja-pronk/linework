import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render } from '../src/index.ts';

const example = (f: string) => fs.readFileSync(new URL(`../../../examples/${f}`, import.meta.url), 'utf8');

const move = `type: systems
title: Move
groups:
  old: { kind: system, label: Old }
  new: { kind: system, label: New }
nodes:
  user: { kind: users, label: Users }
  vm: { kind: server, label: Web VM, in: old }
  db: { kind: database, label: DB, in: old }
  app: { kind: service, label: Web app, in: new }
  cache: { kind: cache, label: Cache, in: new, from: q2 }
  batch: { kind: service, label: Batch, in: old, until: to-be }
edges:
  - user -> vm
  - vm -> db
  - user -> app
  - app -> db
  - batch -> db
stages:
  - { id: as-is, title: As-is, when: 2026-Q1 }
  - id: q2
    title: Q2
    when: 2026-Q2
    replace: { vm: app }
    add: [new]
    change: { db: { label: Orders DB } }
  - id: to-be
    title: To-be
    when: 2026-Q4
    change: { db: { in: new } }
    remove: [old]
`;

const ids = (r: { graph?: { nodes: { id: string }[] } }) => r.graph!.nodes.map((n) => n.id).sort().join(' ');
const at = (r: Awaited<ReturnType<typeof render>>, id: string) => {
  const b = r.placed!.nodes.get(id)!;
  return `${Math.round(b.x)},${Math.round(b.y)}`;
};

describe('stages', () => {
  it('draws each stage with what is there then', async () => {
    const asIs = await render(move, { stage: 'as-is', fonts: 'none' });
    expect(asIs.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(ids(asIs)).toBe('batch db user vm');
    expect(ids(await render(move, { stage: 'q2', fonts: 'none' }))).toBe('app batch cache db user');
    expect(ids(await render(move, { stage: 3, fonts: 'none' }))).toBe('app cache db user');
    expect(asIs.stages!.map((s) => s.id)).toEqual(['as-is', 'q2', 'to-be']);
    expect(asIs.stage).toBe('as-is');
  });

  it('draws the to-be without a stage asked, and everything marked in the overview', async () => {
    const plain = await render(move, { fonts: 'none' });
    expect(plain.stage).toBe('to-be');
    const all = await render(move, { stage: 'overview', fonts: 'none' });
    const marks = Object.fromEntries(all.graph!.nodes.map((n) => [n.id, n.marks ?? []]));
    expect(marks.cache).toEqual(['+ Q2']);
    expect(marks.vm).toEqual(['− Q2']);
    expect(marks.db).toEqual(['~ Q2', 'moves To-be']);
    expect(marks['db~to-be']).toEqual(['+ To-be']);
    expect(all.svg).toContain('Migration overview');
  });

  it('keeps every element in its place across stages', async () => {
    const [a, b, c] = await Promise.all(['as-is', 'q2', 'to-be'].map((stage) => render(move, { stage, fonts: 'none' })));
    expect(at(a!, 'user')).toBe(at(b!, 'user'));
    expect(at(b!, 'app')).toBe(at(c!, 'app'));
    expect(at(a!, 'db')).toBe(at(b!, 'db'));
    expect(a!.width).toBe(c!.width);
    expect(a!.height).toBe(c!.height);
  });

  it('builds a change in and moves an element between groups', async () => {
    const q2 = await render(move, { stage: 'q2', fonts: 'none' });
    const label = (r: typeof q2, id: string) => (r.graph!.nodes.find((n) => n.id === id)!.shape as { label: string }).label;
    expect(label(q2, 'db')).toBe('Orders DB');
    expect(label(await render(move, { stage: 'as-is', fonts: 'none' }), 'db')).toBe('DB');
    const toBe = await render(move, { stage: 'to-be', fonts: 'none' });
    expect(toBe.graph!.nodes.find((n) => n.id === 'db')!.parent).toBe('new');
    expect(label(toBe, 'db')).toBe('Orders DB');
    // The line to the moved element follows it.
    expect(toBe.graph!.edges.some((e) => e.from.node === 'app' && e.to.node === 'db')).toBe(true);
    expect(at(toBe, 'db')).not.toBe(at(q2, 'db'));
  });

  it('reports what cannot be', async () => {
    const bad = move.replace('replace: { vm: app }', 'replace: { vm: app }\n    remove: [ghost, cache]').replace("remove: [old]", 'remove: [old, vm]\n    add: [app]');
    const r = await render(bad, { stage: 'q2', fonts: 'none' });
    const said = r.diagnostics.map((d) => d.message);
    expect(said).toContain('Nothing drawn here is called "ghost"');
    expect(said.some((m) => /Web VM is already removed in Q2/.test(m))).toBe(true);
    expect(said.some((m) => /Web app is already added in Q2/.test(m))).toBe(true);
    expect(said).toContain('Cache is added and removed in Q2: it is never there');
    const unknown = await render(move.replace('from: q2', 'from: q9'), { fonts: 'none' });
    expect(unknown.diagnostics.some((d) => /There is no stage "q9"/.test(d.message))).toBe(true);
    const early = await render(move.replace('until: to-be', 'until: as-is'), { fonts: 'none' });
    expect(early.diagnostics.some((d) => /is the first stage/.test(d.message))).toBe(true);
    expect((await render(move, { stage: 'nope', fonts: 'none' })).diagnostics.some((d) => /There is no stage "nope"/.test(d.message))).toBe(true);
  });

  it('removes before it is added: said at the stage', async () => {
    const r = await render(move.replace("remove: [old]", 'remove: [old]').replace('add: [new]', 'add: [new]\n    remove: [cache]').replace('from: q2', 'from: to-be'), { fonts: 'none' });
    expect(r.diagnostics.some((d) => d.message === 'Cache is removed in Q2 but only added in To-be')).toBe(true);
  });

  it('gives each stage as a step of everything, for an animation', async () => {
    const r = await render(move, { stage: 'union', fonts: 'none' });
    expect(r.stageStates!.length).toBe(3);
    expect(r.stageStates![0]!.nodes.app).toBe('hidden');
    expect(r.stageStates![0]!.nodes.vm).toBeUndefined();
    expect(r.stageStates![1]!.nodes.vm).toBe('hidden');
  });

  it('draws the examples without problems', async () => {
    for (const f of ['transitions/datacenter-exit.yaml', 'transitions/app-modernisation.yaml']) {
      const r = await render(example(f), { stage: 'overview', fonts: 'none' });
      expect(r.diagnostics, f).toEqual([]);
      expect(r.stages!.length).toBe(4);
    }
  });

  it('leaves types without elements and lines alone', async () => {
    const r = await render('type: roadmap\nstages: [{ id: a }]\nitems: {}\n', { fonts: 'none' });
    expect(r.diagnostics.some((d) => /stages are for drawings of them/.test(d.message))).toBe(true);
  });
});
