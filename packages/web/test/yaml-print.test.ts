import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { printPreserving } from '../src/yaml-print.ts';

const edit = (text: string, f: (d: ReturnType<typeof parseDocument>) => void) => {
  const doc = parseDocument(text);
  f(doc);
  return printPreserving(text, doc);
};

const file = `type: azure
title: Shop    # aligned comment


nodes:
    web:   { kind: app-service }     # the web
    db:
        kind: sql-database
        caption: >-
            long folded
            text here

edges:
    - [web -> db]
    - db -> web
`;

describe('printing edits in place', () => {
  it('changes only the touched entry', () => {
    const t = edit(file, (d) => d.setIn(['nodes', 'web', 'label'], 'Shop'));
    expect(t).toBe(file.replace('web:   { kind: app-service }     # the web', 'web: { kind: app-service, label: Shop } # the web'));
  });
  it('keeps 4-space indentation, blank lines and block text when adding', () => {
    const t = edit(file, (d) => (d.getIn(['nodes']) as any).set('cache', d.createNode({ kind: 'redis' }, { flow: true })));
    expect(t).toBe(file.replace('            text here\n', '            text here\n    cache: { kind: redis }\n'));
  });
  it('removes whole lines and list items', () => {
    const t = edit(file, (d) => {
      d.deleteIn(['nodes', 'web']);
      (d.getIn(['edges']) as any).items.splice(1, 1);
    });
    expect(t).not.toContain('web:   {');
    expect(t).toContain('    - [web -> db]\n\n'.slice(0, 18));
    expect(t).not.toContain('- db -> web');
    expect(t).toContain('caption: >-\n            long folded');
  });
  it('replaces a renamed key where it stands', () => {
    const t = edit(file, (d) => {
      const nodes = d.getIn(['nodes']) as any;
      nodes.items[1].key.value = 'orders';
    });
    expect(t).toContain('    orders:\n        kind: sql-database');
    expect(t.indexOf('orders:')).toBeGreaterThan(t.indexOf('web:'));
  });
  it('appends new top-level keys at the end', () => {
    const t = edit('type: azure\nnodes:\n  a: x\n', (d) => d.set('groups', d.createNode({ g: { kind: 'vnet' } })));
    expect(t).toBe('type: azure\nnodes:\n  a: x\n\ngroups:\n  g:\n    kind: vnet\n');
  });
  it('adds to a list after its last item', () => {
    const t = edit(file, (d) => (d.getIn(['edges']) as any).add('web -> cache'));
    expect(t).toContain('    - db -> web\n    - web -> cache\n');
  });
});

describe('printer edge cases from review', () => {
  it('edits list items whose dash is on its own line', () => {
    const t = 'edges:\n  - # main path\n    from: a\n    to: b\n';
    const out = edit(t, (d) => d.setIn(['edges', 0, 'label'], 'x'));
    expect(parseDocument(out).toJS()).toEqual({ edges: [{ from: 'a', to: 'b', label: 'x' }] });
    const more = edit(t, (d) => (d.getIn(['edges']) as any).add('c -> d'));
    expect(parseDocument(more).toJS()).toEqual({ edges: [{ from: 'a', to: 'b' }, 'c -> d'] });
  });
  it('keeps two inserts at one spot in order', () => {
    const t = 'type: azure\nnodes:\n  web: { kind: app-service }\n';
    const out = edit(t, (d) => {
      d.setIn(['nodes', 'web', 'in'], 'g');
      d.set('groups', d.createNode({ g: { kind: 'vnet' } }));
      d.setIn(['nodes', 'api'], 'container-app');
      d.setIn(['nodes', 'db'], 'sql-database');
    });
    expect(parseDocument(out).toJS()).toEqual(parseDocument(out).toJS());
    expect(out).toMatch(/api: container-app\n  db: sql-database/);
    expect(parseDocument(out).toJS().groups).toEqual({ g: { kind: 'vnet' } });
    expect(parseDocument(out).toJS().nodes.web.in).toBe('g');
  });
});
