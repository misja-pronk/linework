import { describe, expect, it } from 'vitest';
import type { LayoutSidecar } from '@linework/core';
import { drift, render } from '../src/index.ts';

const text = `type: azure
groups:
  rg: resource-group
nodes:
  web: { kind: app-service, in: rg }
  db: { kind: sql-database, in: rg }
  kv: key-vault
edges:
  - web -> db
  - web -> kv
views:
  data: { include: [web, db], title: Data }
`;

const paths = async (sidecar: LayoutSidecar, source = text) => (await drift(source, sidecar)).stale.map((s) => s.path);

describe('drift', () => {
  it('finds nothing in a sidecar that matches the diagram', async () => {
    const sidecar: LayoutSidecar = {
      version: 1,
      nodes: { web: { x: 10, y: 10 }, kv: { x: 400, y: 10 } },
      groups: { rg: { x: 0, y: 0 } },
      edges: { e1: { via: [{ x: 200, y: 40 }], from: 'web', to: 'kv' } },
      locked: ['web'],
      layout: { variant: 'right/plain/-' },
      views: { data: { nodes: { db: { x: 5, y: 5 } }, layout: { variant: 'right/plain/-' } } },
    };
    const r = await drift(text, sidecar);
    expect(r.stale).toEqual([]);
    expect(r.fixed).toBe(sidecar);
    expect(r.error).toBeUndefined();
  });

  it('reports pins, bends, locks and views that point at nothing, by path', async () => {
    const sidecar: LayoutSidecar = {
      version: 1,
      nodes: { web: { x: 10, y: 10 }, cache: { x: 1, y: 1 } },
      groups: { vnet: { x: 0, y: 0 } },
      edges: { e0: { via: [{ x: 1, y: 1 }], from: 'web', to: 'db' }, e7: { via: [{ x: 1, y: 1 }] } },
      locked: ['web', 'cache', 'kv'],
      views: { data: { nodes: { kv: { x: 5, y: 5 }, db: { x: 9, y: 9 } } }, old: { nodes: { web: { x: 1, y: 1 } } } },
    };
    const r = await drift(text, sidecar);
    expect(r.stale.map((s) => s.path)).toEqual(['nodes.cache', 'groups.vnet', 'edges.e7', 'locked.cache', 'locked.kv', 'views.data.nodes.kv', 'views.old']);
    expect(r.stale.map((s) => s.kind)).toEqual(['node', 'group', 'edge', 'locked', 'locked', 'node', 'view']);
    expect(r.stale.find((s) => s.path === 'locked.kv')!.message).toBe('"kv" is locked but not pinned');
    expect(r.stale.find((s) => s.path === 'views.data.nodes.kv')!.message).toBe('pinned node "kv" is not drawn in view "data"');
    expect(r.stale.at(-1)!.message).toBe('view "old" does not exist (views: data)');
    // What still holds is kept as it was.
    expect(r.fixed).toEqual({
      version: 1,
      nodes: { web: { x: 10, y: 10 } },
      edges: { e0: { via: [{ x: 1, y: 1 }], from: 'web', to: 'db' } },
      locked: ['web'],
      views: { data: { nodes: { db: { x: 9, y: 9 } } } },
    });
    // And the fixed sidecar is clean.
    expect((await drift(text, r.fixed)).stale).toEqual([]);
  });

  it('sees a bend that now sits on another line', async () => {
    // Line ids count down the list: with "web -> db" taken out, e0 is the line to the key vault.
    const edited = text.replace('  - web -> db\n', '');
    const sidecar: LayoutSidecar = { version: 1, edges: { e0: { via: [{ x: 1, y: 1 }], from: 'web', to: 'db' } } };
    const r = await drift(edited, sidecar);
    expect(r.stale).toEqual([expect.objectContaining({ path: 'edges.e0', kind: 'edge', message: 'line "e0" was bent when it ran web -> db; it now runs web -> kv' })]);
    expect(r.fixed).toBeUndefined();
  });

  it('tells a node that became a group', async () => {
    const r = await drift(text, { version: 1, nodes: { rg: { x: 1, y: 1 } } });
    expect(r.stale[0]!.message).toBe('"rg" is pinned as a node, but is now a group');
  });

  it('leaves nothing when everything is stale, and never reports the layout note', async () => {
    expect((await drift(text, { version: 1, nodes: { gone: { x: 1, y: 1 } } })).fixed).toBeUndefined();
    expect(await paths({ version: 1, layout: { variant: 'down/out/ca', at: 'gone@1,2' } })).toEqual([]);
    // A view's note goes with the view.
    const r = await drift(text, { version: 1, views: { old: { layout: { variant: 'right/plain/-' } } } });
    expect(r.stale.map((s) => s.path)).toEqual(['views.old']);
    expect(r.fixed).toBeUndefined();
  });

  it('reports top-level entries of a diagram that only has views', async () => {
    const model = `type: systems
elements:
  shop: { kind: system, label: Shop }
  bank: { kind: system, label: Bank }
relations:
  - shop -> bank: Pays
views:
  all: { include: ['*'] }
`;
    const first = await render(model, { fonts: 'none' });
    expect(first.onlyViews).toBe(true);
    const r = await drift(model, { version: 1, nodes: { shop: { x: 1, y: 1 } }, views: { all: { nodes: { shop: { x: 1, y: 1 } } } } });
    expect(r.stale.map((s) => s.path)).toEqual(['nodes.shop']);
    expect(r.stale[0]!.message).toContain('never used');
    expect(r.fixed).toEqual({ version: 1, views: { all: { nodes: { shop: { x: 1, y: 1 } } } } });
  });

  it('does not judge a sidecar when the diagram cannot be drawn', async () => {
    const r = await drift('type: azure\nnodes:\n  web: no-such-kind-at-all\nedges:\n  - web -> nowhere\n', { version: 1, nodes: { api: { x: 1, y: 1 } } });
    expect(r.stale).toEqual([]);
    expect(r.error).toMatch(/errors/);
  });
});
