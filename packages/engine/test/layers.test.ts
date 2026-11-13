import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { drift, findType, render, schemaOf, type RenderOptions } from '../src/index.ts';

const example = (f: string) => fs.readFileSync(new URL(`../../../examples/${f}`, import.meta.url), 'utf8');

const shop = `type: systems
title: Shop
groups:
  inside: { kind: system, label: Web shop }
  data: { kind: zone, label: Data, in: inside, tags: [data] }
nodes:
  customer: { kind: users, label: Customers }
  web: { kind: client, label: Storefront, in: inside }
  api: { kind: service, label: Orders API, in: inside, tags: [security] }
  db: { kind: database, label: Orders DB, in: data }
  cache: { kind: cache, label: Sessions, in: data }
  idp: { kind: identity, label: Sign-in, tags: [security] }
  mail: { kind: email, label: Mail, tags: [phase-2] }
edges:
  - customer -> web
  - web -> api
  - api -> db
  - api -> cache
  - web -> idp: { label: OIDC, tags: [security] }
  - api -> mail
layers:
  security: { tags: [security], title: Security }
  data: [data]
  later: { tags: [phase-2], dim-others: true, caption: Mail comes later. }
`;

async function draw(text: string, opts: RenderOptions = {}) {
  const r = await render(text, { fonts: 'none', interactive: true, ...opts });
  const g = r.graph!;
  return { r, nodes: g.nodes.map((n) => n.id).sort(), groups: g.groups.map((x) => x.id).sort(), edges: g.edges.map((e) => `${e.from.node}>${e.to.node}`).sort() };
}

describe('layers', () => {
  it('only: what carries a tag, the ends of its lines, the groups around them and the untagged lines between them', async () => {
    const { r, nodes, groups, edges } = await draw(shop, { layers: 'security' });
    expect(nodes).toEqual(['api', 'idp', 'web']);
    expect(groups).toEqual(['inside']);
    expect(edges).toEqual(['web>api', 'web>idp']);
    expect(r.layers).toMatchObject({ active: ['security'], mode: 'only', written: false, kept: 3, total: 7 });
    expect(r.graph!.subtitle).toBe('Security layer');
    // The key names the layer as an outlined tag, the way environments are drawn.
    expect(r.graph!.legend).toContainEqual({ label: 'Security: what is tagged security', swatch: 'mark', tag: 'security' });
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('a group on a layer takes what is inside it; several layers show what any of them is about', async () => {
    expect((await draw(shop, { layers: 'data' })).nodes).toEqual(['cache', 'db']);
    const both = await draw(shop, { layers: ['security', 'data'] });
    expect(both.nodes).toEqual(['api', 'cache', 'db', 'idp', 'web']);
    expect(both.edges).toEqual(['api>cache', 'api>db', 'web>api', 'web>idp']);
    expect(both.r.graph!.subtitle).toBe('Security, data layers');
  });

  it('dim: everything in its place, the rest faded; untagged lines that touch the layer keep their strength', async () => {
    const whole = await draw(shop);
    const dim = await draw(shop, { layers: 'later' });
    expect(dim.nodes).toEqual(whole.nodes);
    expect(dim.r.layers?.mode).toBe('dim');
    expect(dim.r.faded?.nodes.sort()).toEqual(['api', 'cache', 'customer', 'db', 'idp', 'web']);
    expect(dim.r.faded?.edges.length).toBe(5);
    // The same placement: no layout of its own.
    for (const [id, box] of whole.r.placed!.nodes) expect(dim.r.placed!.nodes.get(id)).toEqual(box);
    expect(dim.r.svg).toMatch(/data-node="web" data-dim/);
    expect(dim.r.svg).not.toMatch(/data-node="mail" data-dim/);
    // The line to the faded API touches the layer: drawn at full strength, so it says where mail comes from.
    expect(dim.r.faded?.edges).not.toContain(dim.r.graph!.edges.find((e) => e.to.node === 'mail')!.id);
    // A dim layer asked for as only, and the other way round.
    expect((await draw(shop, { layers: 'later', layerMode: 'only' })).nodes).toEqual(['mail']);
    expect((await draw(shop, { layers: 'security', layerMode: 'dim' })).r.faded?.nodes.sort()).toEqual(['cache', 'customer', 'db', 'mail']);
  });

  it('every layer is listed with what is on it, and every tag of the file', async () => {
    const { r } = await draw(shop);
    expect(r.layers?.active).toEqual([]);
    expect(r.layers?.list.map((l) => [l.name, l.count, l.dim])).toEqual([
      ['security', 3, false],
      ['data', 2, false],
      ['later', 1, true],
    ]);
    expect(r.layers?.tags).toEqual(['data', 'phase-2', 'security']);
    // No layers and none asked for: nothing said.
    expect((await draw('type: systems\nnodes:\n  a: service\n')).r.layers).toBeUndefined();
  });

  it('says what is wrong: a tag nothing carries, a layer that is not there, a layer without tags', async () => {
    const odd = shop.replace('  data: [data]\n', '  data: [data, pii]\n');
    const { r } = await draw(odd, { layers: ['nope'] });
    const said = r.diagnostics.map((d) => `${d.severity}: ${d.message}`);
    expect(said).toContain('warning: Nothing here has the tag "pii": add tags: [pii] to what is on layer data');
    expect(said).toContain('error: Layers: There is no layer "nope"; layers: security, data, later');
    // A layer without tags is a mistake in the file.
    const empty = await render(shop.replace('  data: [data]\n', '  data: {}\n'), { fonts: 'none' });
    expect(empty.diagnostics.map((d) => d.message)).toContain('"data" needs "tags"');
    // The schema takes tags on lines and layers: at the top, and the editor completes from it.
    const schema = schemaOf(findType('systems')!) as { properties: Record<string, unknown> };
    expect(schema.properties.layers).toBeDefined();
    // Tags on a line are part of the line's schema; a word it does not know is not.
    expect((await render(shop, { fonts: 'none' })).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect((await render(shop.replace('{ label: OIDC, tags: [security] }', '{ label: OIDC, tags: [security], colour: red }'), { fonts: 'none' })).diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('a view names its layers; a focus wins over them and they wait', async () => {
    const model = `type: systems
title: Shop
elements:
  web: { kind: client, label: Storefront }
  api: { kind: service, label: Orders API, tags: [security] }
  db: { kind: database, label: Orders DB }
relations:
  - web -> api: { label: calls }
  - api -> db: { label: SQL, tags: [data] }
layers:
  security: [security]
  data: [data]
views:
  all: { include: ['*'] }
  data: { include: ['*'], layers: [data] }
  odd: { include: ['*'], layers: [nope] }
`;
    const v = await draw(model, { view: 'data' });
    expect(v.nodes).toEqual(['api', 'db']);
    expect(v.edges).toEqual(['api>db']);
    expect(v.r.layers).toMatchObject({ active: ['data'], written: true });
    // Written in the view: the view says what it is, no subtitle is added.
    expect(v.r.graph!.subtitle).toBeUndefined();
    // null: no layer, whatever the view names.
    expect((await draw(model, { view: 'data', layers: null })).nodes).toEqual(['api', 'db', 'web']);
    const odd = await draw(model, { view: 'odd' });
    expect(odd.r.diagnostics.find((d) => d.message.startsWith('There is no layer "nope"'))?.severity).toBe('warning');
    // A focus is a neighbourhood of the whole drawing: the layers wait.
    const f = await draw(model, { view: 'data', focus: 'web' });
    expect(f.nodes).toEqual(['api', 'web']);
    expect(f.r.layers).toMatchObject({ active: [], paused: 'focus', waiting: ['data'] });
  });

  it('steps are written for the whole drawing: under a layer they still draw, and a faded layer fades at a step too', async () => {
    const text = example('azure/web-shop.yaml');
    for (const layer of ['security', 'data']) {
      const r = await render(text, { fonts: 'none', layers: layer, step: 4 });
      expect(r.diagnostics.filter((d) => d.severity === 'error'), layer).toEqual([]);
      expect(r.steps?.length).toBe(5);
    }
    const ops = await render(text, { fonts: 'none', interactive: true, layers: 'ops', step: 2 });
    expect(ops.faded?.nodes.sort()).toEqual(['db', 'pe-kv', 'pe-sql', 'users', 'vault']);
    expect(ops.svg).toMatch(/data-node="db" data-dim/);
  });

  it('a drawing of only some layers keeps its own layout note, and drift knows it', async () => {
    const r = await render(shop, { fonts: 'none', layers: 'security' });
    const at = (r.placed!.memory!.nodes!.get('api')!);
    // Its own note is read, not the whole drawing's.
    const sidecar = { version: 1 as const, views: { '@security': { layout: { variant: r.placed!.memory!.variant } } } };
    const again = await render(shop, { fonts: 'none', layers: 'security', sidecar });
    expect(again.placed!.memory!.nodes!.get('api')).toEqual(at);
    expect((await drift(shop, sidecar)).stale).toEqual([]);
    const gone = await drift(shop, { version: 1, views: { '@nope': { layout: { variant: 'right/out/ca' } } } });
    expect(gone.stale.map((s) => s.path)).toEqual(['views.@nope']);
  });

  it('the examples draw through every layer without problems', async () => {
    for (const f of ['azure/web-shop.yaml', 'systems/saas-platform.yaml']) {
      const text = example(f);
      const whole = await render(text, { fonts: 'none' });
      expect(whole.layers?.list.length, f).toBe(3);
      for (const l of whole.layers!.list) {
        const r = await render(text, { fonts: 'none', layers: l.name });
        expect(r.diagnostics, `${f}@${l.name}`).toEqual([]);
        expect(r.layers?.kept, `${f}@${l.name}`).toBeGreaterThan(0);
      }
    }
  });
});
