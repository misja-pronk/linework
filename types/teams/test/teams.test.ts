import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BlockShape, GraphNode } from '@cartography/core';
import { render } from '../../../packages/engine/src/index.ts';
import { bigOrg } from '../../../packages/tree/test/fixtures.ts';
import { initialsOf, personShorthand, readInteractions, teams, teamsReferences, type TeamsSource } from '../src/index.ts';

const example = (f: string) => fs.readFileSync(new URL(`../../../examples/teams/${f}`, import.meta.url), 'utf8');
const block = (n: GraphNode | undefined) => n?.shape as BlockShape;
const errors = (r: Awaited<ReturnType<typeof render>>) => r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);

describe('org chart', () => {
  it('reads people written short and long, with initials, vacancies and dotted lines', async () => {
    const r = await render('type: teams\npeople:\n  anna: Anna de Vries, CEO\n  Bo Jansen: CTO\n  x: { role: Head of data, reports: anna, vacant: true }\n  y: { name: Yara van der Berg, reports: Bo Jansen, dotted: anna }\n', { fonts: 'none' });
    expect(errors(r)).toEqual([]);
    const n = (id: string) => block(r.graph!.nodes.find((x) => x.id === id));
    expect(n('anna')).toMatchObject({ form: 'person', label: 'Anna de Vries', caption: 'CEO', initials: 'AV' });
    expect(n('Bo Jansen')).toMatchObject({ label: 'Bo Jansen', caption: 'CTO', initials: 'BJ' });
    expect(n('x')).toMatchObject({ label: 'Vacancy', vacant: true });
    expect(n('x').initials).toBeUndefined();
    expect(r.graph!.edges.map((e) => [e.from.node, e.to.node, e.line])).toEqual([
      ['anna', 'x', 'solid'],
      ['Bo Jansen', 'y', 'solid'],
      ['anna', 'y', 'dotted'],
    ]);
    expect(r.graph!.tree).toBe(true);
    expect(r.graph!.legend!.map((l) => l.label)).toEqual(['Reports to', 'Dotted-line report', 'Vacancy']);
  });

  it('knows names: initials skip the little words, a short entry splits at its comma', () => {
    expect(initialsOf('Anna de Vries')).toBe('AV');
    expect(initialsOf('Jan van der Berg')).toBe('JB');
    expect(initialsOf('Cher')).toBe('C');
    expect(personShorthand('Anna de Vries, Chief executive, interim')).toEqual({ name: 'Anna de Vries', role: 'Chief executive, interim' });
    expect(personShorthand('Head of sales')).toEqual({ role: 'Head of sales' });
  });

  it('says what is wrong: an unknown manager, someone reporting to themselves through others', async () => {
    const r = await render('type: teams\npeople:\n  a: { name: A, reports: c }\n  b: { name: B, reports: a }\n  c: { name: C, reports: b }\n  d: { name: D, reports: nobody }\n', { fonts: 'none' });
    expect(errors(r)).toEqual(['"c" would report to themselves through "b"', 'There is no person "nobody"']);
    expect(r.svg).toBeTruthy();
  });

  it('draws each manager over the reports, every card the same size, a colour per branch', async () => {
    const r = await render(example('product-org.yaml'), { fonts: 'none' });
    const p = r.placed!.nodes;
    const anna = p.get('anna')!;
    for (const id of ['bo', 'cem', 'dewi']) expect(p.get(id)!.y).toBeGreaterThan(anna.y + anna.height);
    expect(new Set([...p.values()].map((b) => `${b.width}×${b.height}`)).size).toBe(1);
    const tone = (id: string) => block(r.graph!.nodes.find((n) => n.id === id)).tone;
    expect(tone('dana')).toBe(tone('bo'));
    expect(tone('bo')).not.toBe(tone('cem'));
    expect(r.width! / r.height!).toBeGreaterThan(1.3);
  });

  it('focuses on a person: their branch and the line up to the top, nothing beside it', async () => {
    const r = await render(example('product-org.yaml'), { fonts: 'none', focus: 'bo', view: 'org' });
    expect(r.graph!.nodes.map((n) => n.id).sort()).toEqual(['anna', 'bo', 'dana', 'eli', 'fay', 'finn'].sort());
    expect(r.graph!.subtitle).toContain('Focus on Bo Jansen and their branch');
  });

  it('puts 150 people on one slide in good time', async () => {
    const text = bigOrg();
    await render(text, { fonts: 'none' });
    const t0 = performance.now();
    const r = await render(text, { fonts: 'none' });
    expect(r.graph!.nodes.length).toBeGreaterThan(140);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(r.width! / r.height!).toBeGreaterThan(1.2);
    expect(r.width! / r.height!).toBeLessThan(2.4);
  });

  it('keeps the chart in place when someone joins, knowing the drawing before', async () => {
    const text = example('consultancy-team.yaml');
    const before = await render(text, { fonts: 'none' });
    const after = await render(`${text}  new: { name: Pim Bos, role: Cloud engineer, reports: arch, location: Consultancy }\n`, { fonts: 'none', previous: before.placed!.memory });
    const was = before.placed!.memory!.nodes!;
    const now = after.placed!.memory!.nodes!;
    const ids = [...was.keys()];
    const med = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1]!;
    const dx = med(ids.map((id) => now.get(id)!.x - was.get(id)!.x));
    const dy = med(ids.map((id) => now.get(id)!.y - was.get(id)!.y));
    const far = ids.filter((id) => Math.hypot(now.get(id)!.x - was.get(id)!.x - dx, now.get(id)!.y - was.get(id)!.y - dy) > 16);
    expect(far.length / ids.length).toBeLessThan(0.35);
  });
});

describe('Team Topologies', () => {
  it('draws team types and the interactions between them as zones where the teams meet', async () => {
    const r = await render(example('platform-org.yaml'), { fonts: 'none' });
    expect(errors(r)).toEqual([]);
    const n = (id: string) => block(r.graph!.nodes.find((x) => x.id === id));
    expect(n('payments').form).toBe('stream');
    expect(n('devex').form).toBe('enabling');
    expect(n('fraud-models').form).toBe('subsystem');
    expect(n('cloud-platform').form).toBe('platform');
    expect(n('flow of change').label).toBe('Flow of change to customers');
    const zones = r.graph!.nodes.filter((x) => block(x).between);
    expect(zones.map((z) => block(z).form)).toEqual(['facilitating', 'facilitating', 'facilitating', 'facilitating', 'collaboration', 'service', 'collaboration', 'service', 'service']);
    // Every zone here sits between its two teams, touching both; no line is needed.
    const p = r.placed!.nodes;
    for (const z of zones) {
      const box = p.get(z.id)!;
      expect(box, z.id).toBeTruthy();
      for (const t of block(z).between!) {
        const b = p.get(t)!;
        const touch = box.x <= b.x + b.width && b.x <= box.x + box.width && box.y <= b.y + b.height && b.y <= box.y + box.height;
        expect(touch, `${z.id} touches ${t}`).toBe(true);
      }
    }
    expect([...r.placed!.edges.values()].filter((e) => e.points.length > 1)).toEqual([]);
    // Platforms underneath, the flow of change on top.
    expect(p.get('cloud-platform')!.y).toBeGreaterThan(p.get('insights')!.y);
    expect(p.get('flow of change')!.y).toBeLessThan(p.get('payments')!.y);
  });

  it('draws a line where two teams do not meet', async () => {
    const r = await render('type: teams\nteams:\n  a: stream-aligned\n  b: stream-aligned\n  c: stream-aligned\ninteractions:\n  - a <-> c: collaboration\n', { fonts: 'none' });
    const e = r.placed!.edges.get('interaction:0')!;
    expect(e.points.length).toBeGreaterThan(1);
    const zone = r.graph!.nodes.find((x) => block(x).between)!;
    expect(r.placed!.nodes.has(zone.id)).toBe(false);
  });

  it('reads interactions as lines, as maps and in long form', () => {
    const ties = readInteractions(['a -> b: x-as-a-service', { 'c <-> d': 'collaboration' }, { from: 'e', to: 'f', mode: 'facilitating' }, 'g -> h'] as never);
    expect(ties.map((t) => [t.from, t.to, t.mode])).toEqual([
      ['a', 'b', 'x-as-a-service'],
      ['c', 'd', 'collaboration'],
      ['e', 'f', 'facilitating'],
      ['g', 'h', 'x-as-a-service'],
    ]);
  });

  it('shows the two ways of one file as views, the topology focused on a team with the zones around it', async () => {
    const r = await render(example('product-org.yaml'), { fonts: 'none', view: 'topology', focus: 'search' });
    expect(r.views!.map((v) => v.name)).toEqual(['org', 'topology']);
    const ids = r.graph!.nodes.map((n) => n.id);
    expect(ids).toContain('checkout collaboration search');
    expect(ids).not.toContain('accounts');
  });
});

describe('editing', () => {
  const src: TeamsSource = { type: 'teams', people: { a: 'A, CEO', b: { name: 'B', reports: 'a' }, c: { name: 'C' } }, teams: { t: 'platform', u: 'stream' }, interactions: ['u -> t: x-as-a-service'] };
  it('connects a manager to a report, and a second manager as a dotted line', () => {
    expect(teams.connect!(src, 'a', 'c')).toEqual({ path: ['people', 'c'], key: 'reports', value: 'a' });
    expect(teams.connect!(src, 'c', 'b')).toEqual({ path: ['people', 'b', 'dotted'], value: 'c' });
    expect(teams.connect!(src, 'a', 'b')).toBe('They are already connected');
    expect(teams.connect!(src, 't', 'u')).toEqual({ path: ['interactions'], value: 't -> u: x-as-a-service' });
  });
  it('follows renames into reports and interaction lines', () => {
    const refs = teamsReferences(src);
    expect(refs).toContainEqual({ path: ['people', 'b', 'reports'], id: 'a', start: 0, collection: 'people', onDelete: 'key' });
    expect(refs).toContainEqual({ path: ['interactions', 0], id: 't', start: 5, collection: 'teams' });
  });
});
