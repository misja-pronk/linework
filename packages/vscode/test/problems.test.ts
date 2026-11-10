import { describe, expect, it } from 'vitest';
import { render } from '@cartography/engine';
import { distance, fixesFor, lineIndex, toProblems } from '../src/problems.ts';

const apply = (text: string, f: { from: number; to: number; text: string }) => text.slice(0, f.from) + f.text + text.slice(f.to);

describe('diagnostics as problems', () => {
  it('turns offsets into zero-based lines and characters', () => {
    const at = lineIndex('ab\ncd\n\nef');
    expect(at(0)).toEqual({ line: 0, character: 0 });
    expect(at(4)).toEqual({ line: 1, character: 1 });
    expect(at(7)).toEqual({ line: 3, character: 0 });
    expect(at(99)).toEqual({ line: 3, character: 2 });
  });

  it('keeps the engine (and CLI) message and its place', async () => {
    const text = 'type: systems\nnodes:\n  a: { kind: apii }\n';
    const r = await render(text, { fonts: 'none' });
    const p = toProblems(text, r.diagnostics);
    const kind = p.find((x) => x.message.startsWith('"kind" must be one of'))!;
    expect(kind.severity).toBe('error');
    // carto validate says line 3, column 8 (1-based): the same place.
    expect(kind.start).toEqual({ line: 2, character: 7 });
    expect(text.split('\n')[2]!.slice(kind.start.character, kind.end.character)).toBe('kind');
  });

  it('offers the allowed values, closest first', async () => {
    const text = 'type: systems\nnodes:\n  a: { kind: apii }\n';
    const r = await render(text, { fonts: 'none' });
    const d = r.diagnostics.find((x) => x.message.startsWith('"kind"'))!;
    const fixes = fixesFor(text, d);
    expect(fixes[0]).toMatchObject({ title: 'Change to "api"', preferred: true });
    expect(apply(text, fixes[0]!)).toContain('{ kind: api }');
    expect(fixes.length).toBeLessThanOrEqual(3);
  });

  it('fixes an unknown type and a missing one', async () => {
    const wrong = 'type: sytems\nnodes: {}\n';
    const r = await render(wrong, { fonts: 'none' });
    const f = fixesFor(wrong, r.diagnostics[0]!);
    expect(apply(wrong, f[0]!)).toBe('type: systems\nnodes: {}\n');
    const none = 'nodes:\n  a: api\n';
    const r2 = await render(none, { fonts: 'none' });
    const f2 = fixesFor(none, r2.diagnostics[0]!);
    expect(apply(none, f2[0]!).startsWith('type: systems\n')).toBe(true);
  });

  it('puts a label that starts with [ ] in quotes', async () => {
    const text = 'type: systems\nnodes:\n  a: api\n  b: api\nedges:\n  - a -> b: [paid] / ship\n';
    const r = await render(text, { fonts: 'none' });
    const d = r.diagnostics.find((x) => x.message.startsWith('Text that starts with'))!;
    expect(d).toBeDefined();
    const f = fixesFor(text, d);
    expect(apply(text, f[0]!)).toContain('- a -> b: "[paid] / ship"');
  });

  it('reports a problem found in several views once', () => {
    const d = { severity: 'warning' as const, message: 'x', line: 1, column: 1, from: 0, to: 4 };
    expect(toProblems('type: systems\n', [d, { ...d }])).toHaveLength(1);
  });

  it('underlines at least a character where the engine has no width', () => {
    const p = toProblems('type: systems\nnodes:\n', [{ severity: 'error', message: 'x', line: 2, column: 1 }]);
    expect(p[0]!.start).toEqual({ line: 1, character: 0 });
    expect(p[0]!.end.character).toBe(6);
  });

  it('measures edit distance', () => {
    expect(distance('apii', 'api')).toBe(1);
    expect(distance('', 'abc')).toBe(3);
  });
});
