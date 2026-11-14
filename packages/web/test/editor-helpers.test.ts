import { describe, expect, it } from 'vitest';
import { cursorContext } from '../src/yaml-path.ts';
import { rank, score } from '../src/palette.tsx';
import { entryAt, entryRanges } from '../src/ranges.ts';
import { schemasAt } from '../src/complete.ts';
import { render, findType } from '@linework/engine';

const at = (text: string) => cursorContext(text.replace('|', ''), text.indexOf('|'));

describe('cursor context', () => {
  it('finds the parent keys of a new key', () => {
    expect(at('nodes:\n  web:\n    la|')).toMatchObject({ path: ['nodes', 'web'], key: true, word: 'la' });
  });
  it('knows which value is being typed', () => {
    expect(at('nodes:\n  web:\n    kind: ap|')).toMatchObject({ path: ['nodes', 'web'], key: false, valueKey: 'kind', word: 'ap' });
  });
  it('reads flow maps on one line', () => {
    expect(at('sources:\n  db: { label: x, kind: da|')).toMatchObject({ path: ['sources', 'db'], valueKey: 'kind', word: 'da' });
  });
  it('treats flow lists as items', () => {
    expect(at('products:\n  a:\n    inputs: [orders, cu|')).toMatchObject({ path: ['products', 'a', 'inputs', '-'], key: false, word: 'cu' });
  });
  it('steps into list items', () => {
    expect(at('edges:\n  - from: a\n    la|')).toMatchObject({ path: ['edges', '-'], key: true });
  });
});

describe('palette matching', () => {
  it('prefers word starts', () => {
    expect(score('exp png', 'Export PNG')).toBeGreaterThan(score('exp png', 'Expand open page navigation'));
    expect(score('xyz', 'Export PNG')).toBe(0);
  });
  it('ranks a command by its name before its hint', () => {
    const pdf = rank('pdf', { group: 'Export', label: 'Export PDF' });
    const describe = rank('pdf', { group: 'Export', label: 'Describe in words…', hint: 'what the diagram shows, for a screen reader or a handout; copy as text or Markdown' });
    expect(pdf).toBeGreaterThan(describe);
  });
});

describe('schema lookup', () => {
  it('walks properties, maps of ids and anyOf branches', () => {
    const kinds = schemasAt(findType('data-products')!.schema as Record<string, any>, ['sources', 'db', 'kind']).flatMap((s) => s.enum ?? []);
    expect(kinds).toContain('database');
  });
});

describe('entry ranges', () => {
  it('maps drawn elements to their YAML entries, without trailing newlines', async () => {
    const text = 'type: azure\nnodes:\n  web:\n    kind: app-service\n  db:\n    kind: sql-database\nedges:\n  - web -> db\n';
    const r = await render(text, { fonts: 'none' });
    const entries = entryRanges(text, r.graph);
    const web = entries.find((e) => e.id === 'web')!;
    expect(text.slice(web.from, web.to)).toBe('web:\n    kind: app-service');
    expect(entryAt(entries, text.indexOf('sql-database'))?.id).toBe('db');
    expect(entryAt(entries, text.indexOf('web ->'))?.kind).toBe('edge');
  });
});
