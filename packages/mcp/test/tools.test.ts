import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { types } from '@cartography/engine';
import { createPrompt, getSchema, importMermaidText, listTypes, newDiagram, renderDiagram, resolvePath, validateDiagram } from '../src/index.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-mcp-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Supporting services everyone points at: crossings that badges should take away.
const hub = `type: azure
nodes:
  a: { kind: app-service, label: A }
  b: { kind: app-service, label: B }
  c: { kind: app-service, label: C }
  d: { kind: sql-database, label: D }
  e: { kind: sql-database, label: E }
  f: { kind: sql-database, label: F }
  v: { kind: key-vault, label: Vault }
  l: { kind: log-analytics, label: Logs }
edges:
  - a -> d
  - b -> e
  - c -> f
  - a -> v
  - b -> v
  - c -> v
  - d -> l
  - e -> l
  - f -> l
  - a -> l
  - c -> l
`;

describe('types and schemas', () => {
  it('lists every type', () => {
    const list = listTypes();
    expect(list.map((t) => t.id)).toEqual(types.map((t) => t.id));
    for (const t of list) expect(t.name && t.description).toBeTruthy();
  });

  it('returns schema, template and an example from the repo', () => {
    const s = getSchema('systems');
    expect(s.schema).toHaveProperty('properties.nodes');
    expect(s.template).toMatch(/^type: systems/);
    expect(s.example?.file).toMatch(/^examples\/systems\/.+\.yaml$/);
  });

  it('suggests the type meant by a typo', () => {
    expect(() => getSchema('sytems')).toThrow(/did you mean "systems"/);
    expect(() => newDiagram('nope')).toThrow(/Types: systems/);
  });

  it('gives a valid template for every type', async () => {
    for (const t of types) expect((await validateDiagram({ yaml: newDiagram(t.id) })).ok, t.id).toBe(true);
  }, 30_000);
});

describe('validate', () => {
  it('reports clean templates with layout quality', async () => {
    const r = await validateDiagram({ yaml: newDiagram('systems') });
    expect(r).toMatchObject({ ok: true, type: 'systems', problems: [] });
    expect(r.quality).toMatchObject({ linesThroughBoxes: 0, labelOverlaps: 0 });
    expect(['clean', 'good']).toContain(r.quality!.verdict);
  });

  it('places problems on their line with a fix hint', async () => {
    const r = await validateDiagram({ yaml: 'type: systems\nnodes:\n  a: servce\n  b: { kind: service, lable: X }\n  c: { kind: databse }\nedges:\n  - a => b\n  - a -> b: { style: syn }\n' });
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => [p.line, p.hint])).toEqual([
      [3, 'Use "service" instead of "servce".'],
      [4, 'Rename it to "label".'],
      [5, 'Use "database" instead of "databse".'],
      [7, expect.stringMatching(/a -> b/)],
      [8, 'Use "sync" instead of "syn".'],
    ]);
    expect(r.quality).toBeUndefined();
  });

  it('names the missing id and the near miss', async () => {
    const r = await validateDiagram({ yaml: 'type: systems\nnodes:\n  orders: service\n  db: database\nedges:\n  - order -> db\n' });
    expect(r.problems).toEqual([expect.objectContaining({ line: 6, hint: expect.stringContaining('did you mean "orders"') })]);
  });

  it('explains YAML syntax errors', async () => {
    const r = await validateDiagram({ yaml: 'type: systems\nnodes:\n  a: [\n' });
    expect(r.problems[0]).toMatchObject({ severity: 'error', hint: expect.stringContaining('YAML syntax') });
  });

  it('suggests badges for a hub, and badges do take the crossings away', async () => {
    const r = await validateDiagram({ yaml: hub });
    expect(r.quality!.crossings).toBeGreaterThan(0);
    expect(r.quality!.suggestions.join(' ')).toMatch(/connect to "l" \(Logs\).*badge: true/);
    const badged = hub.replace(/^ {2}- (\w) -> l$/gm, '  - $1 -> l: { badge: true }');
    const after = await validateDiagram({ yaml: badged });
    expect(after.quality!.crossings).toBeLessThan(r.quality!.crossings);
  });

  it('measures the other direction before suggesting it', async () => {
    const r = await validateDiagram({ file: 'examples/cloud/aws-landing-zone.yaml' }, root);
    expect(r.quality!.suggestions.join(' ')).toMatch(/"direction: right" lays this out better \(score \d+ instead of \d+/);
  });

  it('reads files with the contracts next to them', async () => {
    expect((await validateDiagram({ file: 'examples/data-products/customer.yaml' }, root)).ok).toBe(true);
  });
});

describe('render', () => {
  it('returns SVG text without a path', async () => {
    const r = await renderDiagram({ yaml: newDiagram('erd') }, tmp);
    expect(r.ok).toBe(true);
    expect(r.svg).toMatch(/^<svg/);
    expect(r.path).toBeUndefined();
  });

  it('writes a PNG and returns it', async () => {
    const r = await renderDiagram({ yaml: newDiagram('azure'), path: 'out/azure', format: 'png', theme: 'dark' }, tmp);
    expect(r.path).toBe(path.join(tmp, 'out/azure.png'));
    expect(r.png!.subarray(1, 4).toString()).toBe('PNG');
    expect(fs.readFileSync(r.path!).equals(r.png!)).toBe(true);
  });

  it('takes the format from the extension', async () => {
    const r = await renderDiagram({ yaml: newDiagram('systems'), path: 'a.svg' }, tmp);
    expect(r.format).toBe('svg');
    expect(fs.readFileSync(path.join(tmp, 'a.svg'), 'utf8')).toMatch(/@font-face/);
    await expect(renderDiagram({ yaml: newDiagram('systems'), path: 'a.png', format: 'svg' }, tmp)).rejects.toThrow(/ends in .png but format is svg/);
  });

  it('does not render invalid diagrams', async () => {
    const r = await renderDiagram({ yaml: 'type: systems\nnodes:\n  a: nope\n', path: 'bad.svg' }, tmp);
    expect(r.ok).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'bad.svg'))).toBe(false);
  });

  it('refuses relative paths that leave the working directory', async () => {
    await expect(renderDiagram({ yaml: newDiagram('systems'), path: '../escape.svg' }, tmp)).rejects.toThrow(/outside the working directory/);
    expect(() => resolvePath('a/../../b', tmp)).toThrow();
    expect(resolvePath('/abs/x.svg', tmp)).toBe('/abs/x.svg');
  });
});

describe('import and prompt', () => {
  it('imports Mermaid into valid YAML', async () => {
    const r = importMermaidText('flowchart LR\n  A[Web] --> B[(Orders DB)]\n');
    expect(r.yaml).toMatch(/^type: systems/m);
    expect((await validateDiagram({ yaml: r.yaml })).ok).toBe(true);
  });

  it('carries the per-type questions', () => {
    const p = createPrompt('our order platform');
    expect(p).toContain('our order platform');
    expect(p).toContain('Which Azure services are involved?');
    for (const t of types) expect(p).toContain(`- ${t.id} (`);
  });
});
