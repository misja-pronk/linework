import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare, shareLink, shareValue, threatMarkdown } from '@cartography/core';
import { render } from '../src/index.ts';

const example = fs.readFileSync(new URL('../../../examples/systems/threat-model.yaml', import.meta.url), 'utf8');

const small = `type: systems
title: Shop
groups:
  internet: { kind: trust-boundary, label: Internet }
  app: { kind: zone, label: App, trust: true }
nodes:
  user: { kind: user, label: Shopper, in: internet }
  api: { kind: service, label: API, in: app }
  db: { kind: database, label: DB, in: app }
edges:
  - user -> api: HTTP
  - api -> db: { label: SQL, threats: [T, { id: T9, stride: [I, E], title: Dump, mitigation: Least privilege, status: mitigated }] }
`;

describe('threat overlay', () => {
  it('draws trust boundaries and numbers the threats on what they are about', async () => {
    const r = await render(small, { fonts: 'none' });
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const g = r.graph!;
    expect(g.groups.map((x) => [x.id, x.trust, x.caption])).toEqual([
      ['internet', true, 'Trust boundary'],
      ['app', true, 'Trust boundary'],
    ]);
    expect(g.threats!.map((t) => [t.id, t.stride.join(''), t.on, t.status])).toEqual([
      ['T1', 'T', 'API → DB', 'open'],
      ['T9', 'IE', 'API → DB', 'mitigated'],
    ]);
    expect(g.edges.find((e) => e.to.node === 'db')!.marks).toEqual(['T1', 'T9']);
    expect(r.svg).toContain('>T9<');
    expect(g.legend!.map((l) => l.label)).toContain('Trust boundary');
  });

  it('suggests threats as warnings only, and not where a list says it was reviewed', async () => {
    const r = await render(small, { fonts: 'none' });
    const warnings = r.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message);
    // Shopper → API crosses two boundaries over plain HTTP, from outside, without authentication.
    expect(warnings.some((w) => w.startsWith('Suggested threat (T, I) on Shopper → API') && w.includes('"Internet" and "App"'))).toBe(true);
    expect(warnings.some((w) => w.startsWith('Suggested threat (S) on Shopper → API'))).toBe(true);
    // The DB is not encrypted at rest; the API -> DB line lists its threats, so it was looked at.
    expect(warnings.some((w) => w.startsWith('Suggested threat (I) on DB'))).toBe(true);
    expect(warnings.some((w) => w.includes('on API → DB'))).toBe(false);
    expect(r.graph!.threats!.some((t) => t.suggested)).toBe(false);
    const quiet = await render(small.replace('user -> api: HTTP', 'user -> api: { label: HTTPS, auth: OAuth2 }').replace('label: DB, in: app', 'label: DB, in: app, encrypted: true'), { fonts: 'none' });
    expect(quiet.diagnostics.filter((d) => d.message.startsWith('Suggested'))).toEqual([]);
  });

  it('lists suggestions in the table when asked, and says nothing with threat-rules: off', async () => {
    const table = await render(`${small}threat-rules: table\n`, { fonts: 'none' });
    expect(table.graph!.threats!.filter((t) => t.suggested).map((t) => t.status)).toEqual(['suggested', 'suggested', 'suggested']);
    const off = await render(`${small}threat-rules: off\n`, { fonts: 'none' });
    expect(off.diagnostics.filter((d) => d.message.startsWith('Suggested'))).toEqual([]);
  });

  it('leaves a diagram without threats or boundaries alone', async () => {
    const r = await render('type: systems\nnodes:\n  a: service\n  b: database\nedges:\n  - a -> b\n', { fonts: 'none' });
    expect(r.graph!.threats).toBeUndefined();
    expect(r.views).toBeUndefined();
    expect(r.diagnostics).toEqual([]);
  });

  it('draws the threat table as a view, sorted by number, and writes it as markdown', async () => {
    const r = await render(example, { fonts: 'none', view: 'threats' });
    expect(r.views!.map((v) => v.name)).toEqual(['diagram', 'threats']);
    const m = r.graph!.nodes[0]!.shape;
    expect(m.kind).toBe('matrix');
    if (m.kind !== 'matrix') return;
    expect(m.rows.map((x) => x.label)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']);
    expect(m.table).toBe(true);
    const md = threatMarkdown(r.graph!);
    expect(md).toContain('| T7 | Orders DB | Information disclosure | Backups copied out of the data zone | Encrypted backups, keys in KMS | Transferred |');
    expect(md).toContain('3 open, 2 mitigated, 1 accepted, 1 transferred.');
  });

  it('takes threats apart from the drawing, by element or line, and says when they name nothing', async () => {
    const r = await render(`${small}threats:\n  - { on: api, stride: R, title: No audit log }\n  - { on: "user -> db", stride: S }\n  - { on: nope, stride: D }\n`, { fonts: 'none' });
    expect(r.graph!.threats!.find((t) => t.title === 'No audit log')!.on).toBe('API');
    const warnings = r.diagnostics.map((d) => d.message);
    expect(warnings).toContain('There is no line user -> db in this drawing');
    expect(warnings).toContain('There is no element "nope" in this drawing');
  });

  it('works on C4 views through the diagram\'s own threats and trust lists', async () => {
    const c4 = fs.readFileSync(new URL('../../../examples/c4/kestrel-bank.yaml', import.meta.url), 'utf8');
    const views = (await render(c4, { fonts: 'none' })).views!.map((v) => v.name);
    const withThreats = `${c4}\nthreats:\n  - { on: ${'customer'}, stride: S, title: Account takeover }\n`;
    const r = await render(withThreats, { fonts: 'none', view: views[0] });
    const all = await render(withThreats, { fonts: 'none', view: 'threats' });
    expect((await render(withThreats, { fonts: 'none' })).views!.map((v) => v.name)).toEqual([...views, 'threats']);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(all.graph!.nodes[0]!.shape.kind).toBe('matrix');
  });
});

describe('share link', () => {
  it('round-trips the diagram, its layout and theme through the fragment', async () => {
    const d = { yaml: example, name: 'threat-model.yaml', layout: { version: 1 as const, nodes: { db: { x: 1, y: 2 } } }, theme: 'survey-dark' };
    const link = await shareLink(d, 'https://example.org/carto/#old');
    expect(link.startsWith('https://example.org/carto/#share=')).toBe(true);
    expect(link.length).toBeLessThan(example.length);
    expect(await decodeShare(shareValue(new URL(link).hash)!)).toEqual(d);
    expect(await decodeShare(await encodeShare({ yaml: 'type: systems\n' }))).toEqual({ yaml: 'type: systems\n' });
  });

  it('says undefined for anything that is not a share', async () => {
    expect(shareValue('#open=abc')).toBeUndefined();
    expect(await decodeShare('AAAA')).toBeUndefined();
    expect(await decodeShare('!!')).toBeUndefined();
  });
});
