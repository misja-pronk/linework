import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { icon } from '@cartography/icons';
import { render } from '@cartography/engine';
import { config, systems } from '../src/index.ts';

const shop = `type: systems
groups:
  shop: system
  back: { kind: zone, in: shop }
nodes:
  web: { kind: client, in: shop }
  db: { kind: database, label: Orders, in: back }
edges:
  - web -> db: { label: SQL, style: data }
  - web --> shop
`;

describe('systems', () => {
  it('has an icon for every kind', () => {
    for (const [kind, k] of Object.entries({ ...config.nodeKinds, ...config.groupKinds })) expect(icon(k.icon), kind).toBeDefined();
  });

  it('builds nested groups, captions and a legend of the styles used', async () => {
    const r = await render(shop, { fonts: 'none' });
    expect(r.diagnostics).toEqual([]);
    expect(r.graph!.groups.find((g) => g.id === 'back')).toMatchObject({ parent: 'shop', border: 'dashed', caption: 'Zone' });
    expect(r.graph!.nodes.find((n) => n.id === 'db')!.shape).toMatchObject({ label: 'Orders', caption: 'Database', icon: 'database' });
    expect(r.graph!.nodes.find((n) => n.id === 'web')!.shape).toMatchObject({ label: 'Web app', caption: undefined });
    expect(r.graph!.legend).toEqual([{ label: 'Data flow', line: 'solid', tone: 'teal' }]);
  });

  it('rejects unknown kinds and styles', async () => {
    const r = await render(`type: systems\nnodes:\n  a: databse\nedges:\n  - a -> a: { style: fast }\n`, { fonts: 'none' });
    expect([...new Set(r.diagnostics.map((d) => d.line))]).toEqual([3, 5]);
  });

  it('lists every reference, so renames and deletes follow them', () => {
    const refs = systems.references!(parse(shop)).map((r) => [r.path.join('.'), r.id, r.collection]);
    expect(refs).toEqual([
      ['groups.back.in', 'shop', 'groups'],
      ['nodes.web.in', 'shop', 'groups'],
      ['nodes.db.in', 'back', 'groups'],
      ['edges.0', 'web', 'nodes'],
      ['edges.0', 'db', 'nodes'],
      ['edges.1', 'web', 'nodes'],
      ['edges.1', 'shop', 'groups'],
    ]);
  });

  it('connects nodes and groups with an edge', () => {
    const src = parse(shop);
    expect(systems.connect!(src, 'web', 'back')).toEqual({ path: ['edges'], value: 'web -> back' });
    expect(systems.connect!(src, 'web', 'web')).toBeTypeOf('string');
    expect(systems.connect!(src, 'web', 'nope')).toBeTypeOf('string');
  });
});
