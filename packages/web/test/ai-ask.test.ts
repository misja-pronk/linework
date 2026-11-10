import { describe, expect, it } from 'vitest';
import { findType, render } from '@cartography/engine';
import { applyOperations, checkCall, TOOLS } from '../src/ai/edit-tools.ts';
import { contextMessage, followUpMessage, includedFiles, isReview, layoutReport, resolveRef, sentList, splitRefs, type AskContext } from '../src/ai/ask-prompt.ts';
import { renamePins, settle, tryCall } from '../src/ai/ask.ts';
import { lineDiff } from '../src/ai/line-diff.ts';

const azure = findType('azure')!;
const shop = `type: azure
title: Shop   # keep this comment
groups:
  rg: { kind: resource-group, label: Production }
nodes:
  web: { kind: app-service, label: Web, in: rg }
  db: { kind: sql-database, label: Orders DB, in: rg }
edges:
  - web -> db: SQL
`;

describe('Ask: tool definitions', () => {
  it('streams tool input eagerly and keeps the schemas closed', () => {
    for (const t of TOOLS) {
      expect(t.eager_input_streaming).toBe(true);
      expect((t.input_schema as { additionalProperties?: boolean }).additionalProperties).toBe(false);
    }
  });
});

describe('Ask: checking tool input', () => {
  it('accepts a well-formed edit', () => {
    const c = checkCall('edit_diagram', { summary: 'Add a cache', operations: [{ op: 'set', path: ['nodes', 'cache'], value: { kind: 'redis', label: 'Cache' } }, { op: 'append', path: ['edges'], value: 'web -> cache' }] });
    expect('error' in c).toBe(false);
    expect(c).toMatchObject({ name: 'edit_diagram', summary: 'Add a cache' });
  });

  it('refuses what does not fit the schema, saying why', () => {
    expect(checkCall('edit_diagram', 'nope')).toEqual({ error: 'The input is not a JSON object.' });
    expect(checkCall('edit_diagram', { summary: 's', operations: [] })).toMatchObject({ error: expect.stringContaining('non-empty') });
    expect(checkCall('edit_diagram', { summary: 's', operations: [{ op: 'set', path: ['nodes', 'x'] }] })).toMatchObject({ error: expect.stringContaining('needs a "value"') });
    expect(checkCall('edit_diagram', { summary: 's', operations: [{ op: 'move', path: ['nodes'] }] })).toMatchObject({ error: expect.stringContaining('op must be') });
    expect(checkCall('edit_diagram', { summary: 's', operations: [{ op: 'delete', path: [] }] })).toMatchObject({ error: expect.stringContaining('path') });
    expect(checkCall('edit_diagram', { summary: 's', operations: [{ op: 'delete', path: ['nodes', -1] }] })).toMatchObject({ error: expect.stringContaining('path') });
    expect(checkCall('edit_diagram', { summary: 's', operations: [{ op: 'rename', path: ['nodes', 'web'] }] })).toMatchObject({ error: expect.stringContaining('"to"') });
    expect(checkCall('edit_diagram', { summary: 's', operations: [{ op: 'delete', path: ['x'], extra: 1 }] })).toMatchObject({ error: expect.stringContaining('"extra"') });
    expect(checkCall('edit_diagram', { summary: 's', operations: [], more: 1 })).toMatchObject({ error: expect.stringContaining('"more"') });
    expect(checkCall('replace_diagram', { summary: 's' })).toMatchObject({ error: expect.stringContaining('"yaml"') });
    expect(checkCall('rm_rf', {})).toMatchObject({ error: expect.stringContaining('no tool') });
  });

  it('ends a replaced file with a newline', () => {
    expect(checkCall('replace_diagram', { summary: 's', yaml: 'type: azure' })).toMatchObject({ yaml: 'type: azure\n' });
  });
});

describe('Ask: applying edits', () => {
  it('sets and appends while the rest keeps its exact text', async () => {
    const r = applyOperations(shop, azure, [
      { op: 'set', path: ['nodes', 'cache'], value: { kind: 'redis', label: 'Cache', in: 'rg' } },
      { op: 'append', path: ['edges'], value: 'web -> cache: reads' },
    ]);
    if ('error' in r) throw new Error(r.error);
    expect(r.text).toContain('title: Shop   # keep this comment');
    expect(r.text).toContain('  web: { kind: app-service, label: Web, in: rg }');
    expect(r.text).toContain('  cache: { kind: redis, label: Cache, in: rg }');
    expect(r.text).toContain('- web -> cache: reads');
    expect((await render(r.text, { fonts: 'none' })).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('deletes an entry with the lines to it, as the builder does', () => {
    const r = applyOperations(shop, azure, [{ op: 'delete', path: ['nodes', 'db'] }]);
    if ('error' in r) throw new Error(r.error);
    expect(r.text).not.toContain('db');
    expect(r.text).not.toContain('web -> db');
  });

  it('renames with every reference, and reports the rename for the pins', () => {
    const r = applyOperations(shop, azure, [
      { op: 'rename', path: ['nodes', 'db'], to: 'orders-db' },
      { op: 'rename', path: ['nodes', 'orders-db'], to: 'sql' },
    ]);
    if ('error' in r) throw new Error(r.error);
    expect(r.text).toContain('- web -> sql: SQL');
    expect([...r.renames]).toEqual([['db', 'sql']]);
  });

  it('stops at the first operation that cannot be done', () => {
    expect(applyOperations(shop, azure, [{ op: 'delete', path: ['nodes', 'nope'] }])).toMatchObject({ error: expect.stringContaining('nothing at that path') });
    expect(applyOperations(shop, azure, [{ op: 'append', path: ['nodes'], value: 'x' }])).toMatchObject({ error: expect.stringContaining('map') });
    expect(applyOperations(shop, azure, [{ op: 'rename', path: ['nodes', 'web'], to: 'db' }])).toMatchObject({ error: expect.stringContaining('taken') });
    expect(applyOperations(shop, azure, [{ op: 'set', path: ['edges', 9], value: 'a -> b' }])).toMatchObject({ error: expect.stringContaining('append') });
  });

  it('checks the result with the engine: a change that does not draw comes back as an error', async () => {
    const bad = await tryCall('edit_diagram', { summary: 's', operations: [{ op: 'set', path: ['nodes', 'x'], value: { kind: 'not-a-kind' } }] }, shop, azure);
    expect(bad).toMatchObject({ error: expect.stringContaining('does not validate') });
    expect('error' in bad && bad.error).toContain('line 8');
    const same = await tryCall('edit_diagram', { summary: 's', operations: [{ op: 'set', path: ['nodes', 'web', 'label'], value: 'Web' }] }, shop, azure);
    expect(same).toMatchObject({ error: expect.stringContaining('exactly as it is') });
    const good = await tryCall('replace_diagram', { summary: 's', yaml: shop.replace('Orders DB', 'Orders') }, shop, azure);
    expect(good).toMatchObject({ text: expect.stringContaining('label: Orders, in: rg }') });
  });
});

describe('Ask: what is sent', () => {
  const ctx: AskContext = { text: shop, type: azure, file: 'shop.yaml', selection: [{ kind: 'node', id: 'db', label: 'Orders DB' }], problems: [] };

  it('the first message carries the YAML, the schema, the type, the selection and the problems', () => {
    const m = contextMessage(ctx, 'Add a replica in West Europe');
    expect(m).toContain('<diagram file="shop.yaml">\ntype: azure');
    expect(m).toContain('<schema>');
    expect(m).toContain('"properties"');
    expect(m).toContain(azure.description);
    expect(m).toContain('Selected: node db ("Orders DB")');
    expect(m).toContain('Problems: none');
    expect(m.endsWith('Add a replica in West Europe')).toBe(true);
    expect(m).not.toContain('Layout report');
  });

  it('a follow-up sends the YAML again only when it changed, and never the schema again', () => {
    const same = followUpMessage(ctx, 'and another', false);
    expect(same).not.toContain('<diagram');
    expect(same).toContain('Selected: node db');
    const changed = followUpMessage({ ...ctx, selection: [], problems: ['line 3: bad'] }, 'and another', true);
    expect(changed).toContain('<diagram');
    expect(changed).not.toContain('<schema>');
    expect(changed).toContain('nothing (the question is about the whole diagram)');
    expect(changed).toContain('- line 3: bad');
  });

  it('a review gets the layout report', async () => {
    expect(isReview('Review it for threats')).toBe(true);
    expect(isReview('any single points of failure?')).toBe(true);
    expect(isReview('add a DR region in West Europe')).toBe(false);
    const r = await render(shop, { fonts: 'none' });
    const report = layoutReport(r.graph, r.placed)!;
    expect(report).toMatch(/verdict: (clean|good|needs work)/);
    expect(contextMessage({ ...ctx, layout: report }, 'review')).toContain('Layout report:\n- verdict');
  });
});

describe('Ask: references in answers', () => {
  it('cuts [[id]] and [[id|label]] out of the text', () => {
    expect(splitRefs('The [[db]] is behind [[web|the shop]].')).toEqual([{ text: 'The ' }, { ref: 'db' }, { text: ' is behind ' }, { ref: 'web', label: 'the shop' }, { text: '.' }]);
    expect(splitRefs('no refs')).toEqual([{ text: 'no refs' }]);
  });

  it('resolves nodes, groups and lines in the drawing, and nothing else', async () => {
    const { graph } = await render(shop, { fonts: 'none' });
    expect(resolveRef('db', graph)).toMatchObject({ kind: 'node', id: 'db', label: 'Orders DB' });
    expect(resolveRef('rg', graph)).toMatchObject({ kind: 'group', id: 'rg' });
    expect(resolveRef('web -> db', graph)).toMatchObject({ kind: 'edge', label: 'Web → Orders DB' });
    expect(resolveRef('nope', graph)).toBeUndefined();
  });
});

describe('Ask: after the answer', () => {
  it('settles every tool call it owes with the verdict', () => {
    expect(settle({ messages: [], owed: [{ id: 'a' }, { id: 'b' }] }, 'accepted')).toEqual([
      { type: 'tool_result', tool_use_id: 'a', content: 'accepted' },
      { type: 'tool_result', tool_use_id: 'b', content: 'accepted' },
    ]);
  });

  it('pins follow renamed ids', () => {
    const pins = { version: 1, nodes: { db: { x: 1, y: 2 }, web: { x: 3, y: 4 } }, locked: ['db'] };
    expect(renamePins(pins, new Map([['db', 'sql']]))).toEqual({ version: 1, nodes: { sql: { x: 1, y: 2 }, web: { x: 3, y: 4 } }, locked: ['sql'] });
    expect(renamePins(pins, new Map())).toBe(pins);
  });

  it('diffs the YAML by line, folding what did not change', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 10', 'line ten');
    const d = lineDiff(before, after);
    expect(d.filter((l) => l.kind === 'del').map((l) => 'text' in l && l.text)).toEqual(['line 10']);
    expect(d.filter((l) => l.kind === 'add').map((l) => 'text' in l && l.text)).toEqual(['line ten']);
    expect(d[0]).toEqual({ kind: 'fold', count: 7 });
    expect(d.at(-1)).toEqual({ kind: 'fold', count: 6 });
  });
});

describe('what Ask sends from a folder', () => {
  const files: Record<string, string> = {
    'model.yaml': 'type: c4\ninclude: [people.yaml]\nsystems:\n  online: { label: Online }\n',
    'people.yaml': 'type: c4\npeople:\n  customer: { label: Customer }\n',
  };
  const load = (f: string) => {
    if (!(f in files)) throw new Error(`no ${f}`);
    return files[f]!;
  };
  const view = 'type: c4\ninclude: [model.yaml, missing.yaml]\nviews:\n  context: { kind: context, of: online }\n';

  it('reads the included files, and what they include, once each', () => {
    expect(includedFiles(view, load).map((f) => f.file)).toEqual(['model.yaml', 'people.yaml']);
    expect(includedFiles('type: c4\n', load)).toEqual([]);
  });

  it('puts them in the message, and says so exactly', async () => {
    const { types } = await import('@cartography/engine');
    const type = types.find((t) => t.id === 'c4')!;
    const c = { text: view, type, file: 'context.yaml', included: includedFiles(view, load), selection: [{ kind: 'node' as const, id: 'online', label: 'Online' }], problems: [] };
    const m = contextMessage(c, 'what is this');
    expect(m).toContain('<included file="model.yaml">\ntype: c4');
    expect(m).toContain('<included file="people.yaml">');
    expect(m.indexOf('<included')).toBeLessThan(m.indexOf('<diagram'));
    expect(sentList(c)).toBe('the YAML of context.yaml, the included files model.yaml, people.yaml, the C4 model schema and description, the id and label of what is selected, the problem list and your question');
  });
});
