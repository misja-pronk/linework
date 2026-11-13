import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { linkHref, parseLink, viewPins, withViewPins } from '@cartography/core';
import { render } from '../src/index.ts';

const files = (map: Record<string, string>) => (f: string) => {
  if (!(f in map)) throw new Error(`No file ${f}`);
  return map[f]!;
};

const model = `type: model
elements:
  customer: { kind: person, label: Customer, tags: [people] }
  shop:
    kind: system
    label: Web shop
    elements:
      web: { kind: client, label: Storefront, technology: React }
      api: { kind: api, label: Orders API, links: [api.yaml] }
      db: { kind: database, label: Orders DB }
  stripe: { kind: payments, label: Stripe, tags: [external] }
relations:
  - customer -> shop.web: Orders
  - shop.web -> shop.api: REST
  - shop.api -> shop.db: SQL
  - shop.api -> stripe: Charges
views:
  context: { include: [shop, '* -> shop', 'shop -> *'] }
  containers: { title: Containers, expand: [shop] }
`;

const ids = (r: Awaited<ReturnType<typeof render>>) => ({
  nodes: r.graph!.nodes.map((n) => n.id),
  groups: r.graph!.groups.map((g) => g.id),
  edges: r.graph!.edges.map((e) => `${e.from.node}>${e.to.node}${e.label ? `:${e.label}` : ''}`),
});

describe('include', () => {
  it('merges nodes, groups and edges after the diagram’s own', async () => {
    const load = files({ 'parts/db.yaml': 'type: azure\nnodes:\n  db: sql-database\nedges:\n  - api -> db\n' });
    const r = await render('type: azure\ninclude: [parts/db.yaml]\nnodes:\n  api: app-service\n', { load, fonts: 'none' });
    expect(r.diagnostics).toEqual([]);
    expect(ids(r)).toEqual({ nodes: ['api', 'db'], groups: [], edges: ['api>db'] });
    expect(r.includes).toEqual(['parts/db.yaml']);
    // Entries from the other file are edited there: they point at the include entry.
    expect(r.graph!.nodes[1]!.path).toEqual(['include', 0, 'parts/db.yaml']);
    expect(r.graph!.nodes[0]!.path).toEqual(['nodes', 'api']);
  });

  it('reports id clashes, cycles, other types and missing files at the include entry', async () => {
    const load = files({
      'a.yaml': 'type: azure\nnodes:\n  api: vm\ninclude: [b.yaml]\n',
      'b.yaml': 'include: [a.yaml]\n',
      'erd.yaml': 'type: erd\ntables: {}\n',
    });
    const r = await render('type: azure\ninclude: [a.yaml, erd.yaml, nope.yaml]\nnodes:\n  api: app-service\n', { load, fonts: 'none', file: 'main.yaml' });
    const msgs = r.diagnostics.map((d) => [d.line, d.message]);
    expect(msgs).toContainEqual([2, '"api" in a.yaml is already in nodes of this file']);
    expect(msgs).toContainEqual([2, 'Include cycle: main.yaml → a.yaml → b.yaml → a.yaml']);
    expect(msgs).toContainEqual([2, 'erd.yaml is a erd diagram: include a type: model file or another azure diagram']);
    expect(msgs).toContainEqual([2, 'Cannot read nope.yaml']);
    expect(r.svg).toBeDefined();
  });

  it('sees an include of the diagram itself as a cycle', async () => {
    const main = 'type: systems\ninclude: [model.yaml]\nnodes:\n  web: client\n';
    const r = await render(main, { load: files({ 'model.yaml': 'type: model\ninclude: [main.yaml]\n', 'main.yaml': main }), fonts: 'none', file: 'main.yaml' });
    expect(r.diagnostics.map((d) => d.message)).toEqual(['Include cycle: main.yaml → model.yaml → main.yaml']);
  });

  it('points at the line inside an included file that is wrong', async () => {
    const r = await render('type: azure\ninclude: [x.yaml]\n', { load: files({ 'x.yaml': 'nodes:\n  a: { kind: nope }\n' }), fonts: 'none' });
    expect(r.diagnostics[0]!.message).toMatch(/^x\.yaml:2: "kind" cannot be "nope"/);
  });

  it('takes a file with its own language and look: the including diagram’s rule', async () => {
    const load = files({
      'part.yaml': 'type: systems\nlang: nl\ntheme: dark\naspect: 16:9\nicons: {}\nnodes:\n  db: database\n',
      'model.yaml': 'type: model\nlang: nl\ntheme: dark\nelements:\n  m: { kind: service, label: M }\n',
    });
    const r = await render('type: systems\ninclude: [part.yaml, model.yaml]\nnodes:\n  api: service\n  m: { ref: m }\nedges:\n  - api -> db\n', { load, fonts: 'none' });
    expect(r.diagnostics).toEqual([]);
    expect(r.lang).toBe('en');
    expect(ids(r).nodes).toEqual(['api', 'm', 'db']);
  });

  it('works for types with their own collections (ERD tables and relations)', async () => {
    const load = files({ 'more.yaml': 'type: erd\ntables:\n  b: { columns: { id: int pk, a_id: int fk a } }\n' });
    const r = await render('type: erd\ninclude: [more.yaml]\ntables:\n  a: { columns: { id: int pk } }\nrelations: []\n', { load, fonts: 'none' });
    expect(r.diagnostics).toEqual([]);
    expect(r.graph!.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(r.graph!.edges).toHaveLength(1);
  });
});

describe('refs', () => {
  const load = files({ 'model.yaml': model });

  it('take label, caption, links from the model; local fields win; relations follow', async () => {
    const r = await render('type: systems\ninclude: [model.yaml]\nnodes:\n  customer:\n  web: { ref: shop.web, label: Shop front }\n  api: { ref: shop.api }\n', { load, fonts: 'none' });
    expect(r.diagnostics).toEqual([]);
    const web = r.graph!.nodes.find((n) => n.id === 'web')!;
    expect(web.shape).toMatchObject({ kind: 'card', label: 'Shop front', caption: 'React', icon: 'app-window' });
    expect(r.graph!.nodes.find((n) => n.id === 'customer')!.shape).toMatchObject({ label: 'Customer', icon: 'user' });
    expect(r.graph!.nodes.find((n) => n.id === 'api')!.links).toEqual([{ kind: 'file', target: 'api.yaml', file: 'api.yaml' }]);
    expect(ids(r).edges).toEqual(['customer>web:Orders', 'web>api:REST']);
  });

  it('a local edge between the same two wins over the model’s relation', async () => {
    const r = await render('type: systems\ninclude: [model.yaml]\nnodes:\n  web: { ref: shop.web }\n  api: { ref: shop.api }\nedges:\n  - web -> api: HTTPS\n', { load, fonts: 'none' });
    expect(ids(r).edges).toEqual(['web>api:HTTPS']);
  });

  it('map kinds per type, and fall back to a neutral card with a warning', async () => {
    const r = await render('type: azure\ninclude: [model.yaml]\nnodes:\n  db: { ref: shop.db }\n  stripe:\n', { load, fonts: 'none' });
    expect(r.graph!.nodes.find((n) => n.id === 'db')!.shape).toMatchObject({ caption: 'SQL Database' });
    const stripe = r.graph!.nodes.find((n) => n.id === 'stripe')!;
    expect(stripe.shape).toMatchObject({ label: 'Stripe', icon: 'box', tone: 'slate' });
    expect(r.diagnostics).toEqual([expect.objectContaining({ severity: 'warning', message: expect.stringContaining('Kind "payments"') })]);
  });

  it('report unknown refs', async () => {
    const r = await render('type: systems\ninclude: [model.yaml]\nnodes:\n  x: { ref: shop.nope }\n  y:\n', { load, fonts: 'none' });
    expect(r.diagnostics.map((d) => [d.line, d.message])).toEqual([
      [4, 'There is no element "shop.nope" in the model'],
      [5, 'There is no element "y" in the model'],
    ]);
  });

  it('can use elements defined in the diagram itself', async () => {
    const r = await render('type: systems\nelements:\n  a: { kind: service, label: Alpha }\nnodes:\n  a:\n', { fonts: 'none' });
    expect(r.diagnostics).toEqual([]);
    expect(r.graph!.nodes[0]!.shape).toMatchObject({ label: 'Alpha' });
  });
});

describe('views', () => {
  const load = files({ 'model.yaml': model });

  it('a model file draws its first view; relations lift to closed elements', async () => {
    const r = await render(model, { fonts: 'none' });
    expect(r.view).toBe('context');
    expect(r.views).toEqual([{ name: 'context' }, { name: 'containers', title: 'Containers' }]);
    expect(ids(r)).toEqual({ nodes: ['customer', 'shop', 'stripe'], groups: [], edges: ['customer>shop:Orders', 'shop>stripe:Charges'] });
  });

  it('expand opens an element into a boundary with its parts', async () => {
    const r = await render(model, { fonts: 'none', view: 'containers' });
    expect(r.diagnostics).toEqual([]);
    expect(r.graph!.title).toBe('Containers');
    expect(ids(r)).toEqual({
      nodes: ['customer', 'shop.web', 'shop.api', 'shop.db', 'stripe'],
      groups: ['shop'],
      edges: ['customer>shop.web:Orders', 'shop.web>shop.api:REST', 'shop.api>shop.db:SQL', 'shop.api>stripe:Charges'],
    });
    expect(r.graph!.nodes[1]!.parent).toBe('shop');
    // Model elements are edited in the model: their path is where they are written.
    expect(r.graph!.nodes[1]!.path).toEqual(['elements', 'shop', 'elements', 'web']);
  });

  it('select by tag, kind, children and relation, and exclude', async () => {
    const view = async (spec: string) => ids(await render(`type: systems\ninclude: [model.yaml]\nviews:\n  v: ${spec}\n`, { load, fonts: 'none' }));
    expect((await view('{ include: ["tag:external", "tag:people"] }')).nodes).toEqual(['customer', 'stripe']);
    expect((await view('{ include: ["kind:database"] }')).nodes).toEqual(['shop.db']);
    expect((await view('{ include: ["shop.*"], exclude: [shop.db] }')).nodes).toEqual(['shop.web', 'shop.api']);
    expect((await view('{ include: ["* -> stripe"], expand: [shop], exclude: [shop.web, shop.db] }')).nodes).toEqual(['shop.api', 'stripe']);
    expect((await view('{ expand: [shop], exclude: ["shop.web -> *"] }')).edges).not.toContain('shop.web>shop.api:REST');
  });

  it('filter a plain diagram, keeping the groups of what is shown', async () => {
    const text = 'type: azure\ngroups:\n  rg: resource-group\nnodes:\n  web: { kind: app-service, in: rg }\n  db: { kind: sql-database, in: rg }\n  kv: key-vault\nedges:\n  - web -> db\n  - web -> kv\nviews:\n  data: { include: [web, db], title: Data }\n';
    const all = await render(text, { fonts: 'none' });
    expect(all.view).toBeUndefined();
    expect(ids(all).nodes).toEqual(['web', 'db', 'kv']);
    const r = await render(text, { fonts: 'none', view: 'data' });
    expect(ids(r)).toEqual({ nodes: ['web', 'db'], groups: ['rg'], edges: ['web>db'] });
    // Ids and paths of written edges stay, so the editor still finds them.
    expect(r.graph!.edges[0]).toMatchObject({ id: 'e0', path: ['edges', 0] });
  });

  it('filter other types by id', async () => {
    const r = await render('type: erd\ntables:\n  a: { columns: { id: int pk } }\n  b: { columns: { id: int pk } }\nviews:\n  only-a: { include: [a] }\n', { fonts: 'none', view: 'only-a' });
    expect(r.diagnostics).toEqual([]);
    expect(r.graph!.nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('report an unknown view and unknown ids', async () => {
    const r = await render(model, { fonts: 'none', view: 'nope' });
    expect(r.diagnostics[0]!.message).toBe('There is no view "nope"; views: context, containers');
    const w = await render(`type: systems\ninclude: [model.yaml]\nviews:\n  v: { include: [ghost] }\n`, { load, fonts: 'none' });
    expect(w.diagnostics).toEqual([expect.objectContaining({ line: 4, severity: 'warning', message: 'There is no element "ghost"' })]);
  });
});

describe('links', () => {
  it('parse URLs, files and views', () => {
    expect(parseLink('https://x.org')).toEqual({ kind: 'url', target: 'https://x.org' });
    expect(parseLink('c.yaml#containers')).toEqual({ kind: 'view', target: 'c.yaml#containers', file: 'c.yaml', view: 'containers' });
    expect(linkHref(parseLink('adr/7.md')!)).toBe('adr/7.md');
    expect(linkHref(parseLink('#v')!, 'me.yaml')).toBe('me--v.svg');
    expect(parseLink({ to: '#context', label: 'Up' })).toEqual({ kind: 'view', target: '#context', file: '', view: 'context', label: 'Up' });
  });

  it('render as an icon, and as real links in exports', async () => {
    const text = "type: systems\nnodes:\n  a: { kind: service, links: ['https://x.org'] }\n  b: { kind: service, links: ['other.yaml#v'], description: Bee }\n  c: { kind: service, links: ['#v'] }\n";
    const out = await render(text, { fonts: 'none', file: 'me.yaml' });
    expect(out.svg).toContain('<a href="https://x.org" target="_blank">');
    expect(out.svg).toContain('<a href="other--v.svg">');
    expect(out.svg).toContain('<a href="me--v.svg">');
    expect(out.svg).toContain('<title>Bee</title>');
    const live = await render(text, { fonts: 'none', interactive: true });
    expect(live.svg).not.toContain('<a href');
  });

  it('from an included file stay relative to that file', async () => {
    const load = files({ 'm/model.yaml': "type: model\nelements:\n  a: { kind: service, links: ['detail.yaml', '#ctx', 'https://x.org'] }\n" });
    const r = await render('type: systems\ninclude: [m/model.yaml]\nnodes:\n  a:\n', { load, fonts: 'none' });
    expect(r.graph!.nodes[0]!.links!.map((l) => l.target)).toEqual(['m/detail.yaml', 'm/model.yaml#ctx', 'https://x.org']);
  });
});

describe('pins per view', () => {
  const text = 'type: systems\nnodes:\n  a: service\n  b: service\nviews:\n  v: { include: [a] }\n';
  it('keep each view’s pins apart, and old sidecars working', async () => {
    const sidecar = { version: 1 as const, nodes: { a: { x: 500, y: 0 } }, views: { v: { nodes: { a: { x: 0, y: 300 } } } } };
    const plain = await render(text, { fonts: 'none', sidecar });
    const view = await render(text, { fonts: 'none', sidecar, view: 'v' });
    const at = (r: typeof plain) => r.placed!.nodes.get('a')!;
    expect(at(plain).x - at(plain).y).not.toEqual(at(view).x - at(view).y);
    expect(viewPins(sidecar, 'v')).toEqual({ version: 1, nodes: { a: { x: 0, y: 300 } } });
    expect(viewPins(sidecar)).toBe(sidecar);
  });

  it('are replaced per view without touching the others', () => {
    const s = withViewPins({ version: 1, nodes: { a: { x: 1, y: 1 } } }, 'v', { version: 1, nodes: { b: { x: 2, y: 2 } } });
    expect(s).toEqual({ version: 1, nodes: { a: { x: 1, y: 1 } }, views: { v: { nodes: { b: { x: 2, y: 2 } } } } });
    expect(withViewPins(s, undefined, null)).toEqual({ version: 1, views: { v: { nodes: { b: { x: 2, y: 2 } } } } });
    expect(withViewPins(withViewPins(s, undefined, null), 'v', null)).toBeUndefined();
  });

  it('carry bent lines and locks per view too', () => {
    const edges = { e0: { via: [{ x: 1, y: 2 }] } };
    const s = withViewPins({ version: 1, locked: ['a'] }, 'v', { version: 1, edges, locked: ['b'] });
    expect(s).toEqual({ version: 1, locked: ['a'], views: { v: { edges, locked: ['b'] } } });
    expect(viewPins(s, 'v')).toEqual({ version: 1, edges, locked: ['b'] });
    expect(withViewPins(s, 'v', { version: 1, locked: [] })).toEqual({ version: 1, locked: ['a'] });
  });
});

describe('examples/model', () => {
  const dir = path.resolve(import.meta.dirname, '../../../examples/model');
  const load = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.yaml')))
    it(`${f} renders every view without problems`, async () => {
      const text = load(f);
      const first = await render(text, { load, fonts: 'none', file: f });
      expect(first.diagnostics).toEqual([]);
      for (const v of first.views ?? []) expect((await render(text, { load, fonts: 'none', file: f, view: v.name })).diagnostics).toEqual([]);
    });
});
