import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findType, render, schemaOf } from '../src/index.ts';

const example = (f: string) => fs.readFileSync(new URL(`../../../examples/${f}`, import.meta.url), 'utf8');

const shop = `type: systems
title: Shop
groups:
  inside: { kind: system, label: Web shop }
  data: { kind: zone, label: Data, in: inside }
nodes:
  customer: { kind: users, label: Customers }
  web: { kind: client, label: Storefront, in: inside, tags: [front] }
  api: { kind: service, label: Orders API, in: inside }
  db: { kind: database, label: Orders DB, in: data }
  cache: { kind: cache, label: Sessions, in: data }
  stripe: { kind: payments, label: Stripe, tags: [outside] }
  audit: { kind: service, label: Audit }
edges:
  - customer -> web
  - web -> api
  - api -> db
  - api -> cache
  - api -> stripe
`;
/** What is drawn, by id, and what carries the ring. */
async function drawn(text: string, focus?: unknown) {
  const r = await render(text, { fonts: 'none', ...(focus !== undefined ? { focus } : {}) });
  const g = r.graph!;
  return { r, nodes: g.nodes.map((n) => n.id).sort(), groups: g.groups.map((x) => x.id).sort(), ring: [...g.nodes, ...g.groups].filter((x) => x.focused).map((x) => x.id) };
}

describe('focus', () => {
  it('draws an element and what is one line away, with the groups around them', async () => {
    const d = await drawn(`${shop}focus: db\n`);
    expect(d.r.diagnostics).toEqual([]);
    expect(d.nodes).toEqual(['api', 'db']);
    expect(d.groups).toEqual(['data', 'inside']);
    expect(d.ring).toEqual(['db']);
    expect(d.r.graph!.edges.map((e) => `${e.from.node}>${e.to.node}`)).toEqual(['api>db']);
    expect(d.r.focus).toMatchObject({ on: ['db'], hops: 1, direction: 'both', names: ['Orders DB'], kept: 2, total: 7, written: true });
    // The ring is drawn in the element's own mark, so the editor selects through it.
    const live = await render(`${shop}focus: db\n`, { fonts: 'none', interactive: true });
    expect(live.svg).toMatch(/<g data-node="db"[^>]*>(<title>[^<]*<\/title>)?<rect [^>]*stroke-opacity="0.2"/);
    expect(d.r.svg!.match(/stroke-opacity="0.2"/g)).toHaveLength(1);
    // The file says it is a part: no subtitle is added for a focus somebody wrote.
    expect(d.r.graph!.subtitle).toBeUndefined();
  });

  it('reaches further with hops, and everything connected with all', async () => {
    expect((await drawn(`${shop}focus: { on: db, hops: 2 }\n`)).nodes).toEqual(['api', 'cache', 'db', 'stripe', 'web']);
    expect((await drawn(`${shop}focus: { on: db, hops: all }\n`)).nodes).toEqual(['api', 'cache', 'customer', 'db', 'stripe', 'web']);
    expect((await drawn(`${shop}focus: { on: db, hops: 0 }\n`)).nodes).toEqual(['db']);
  });

  it('follows the arrows upstream and downstream', async () => {
    expect((await drawn(`${shop}focus: { on: api, hops: all, direction: upstream }\n`)).nodes).toEqual(['api', 'customer', 'web']);
    expect((await drawn(`${shop}focus: { on: api, hops: all, direction: downstream }\n`)).nodes).toEqual(['api', 'cache', 'db', 'stripe']);
    // A line without an arrow has no direction: it counts both ways.
    const plain = shop.replace('- api -> stripe', '- api -- stripe');
    expect((await drawn(`${plain}focus: { on: api, direction: upstream }\n`)).nodes).toEqual(['api', 'stripe', 'web']);
  });

  it('takes the selectors of steps: a group, a tag, a list', async () => {
    const group = await drawn(`${shop}focus: data\n`);
    expect(group.nodes).toEqual(['api', 'cache', 'db']);
    // The ring goes around the group, not around each part.
    expect(group.ring).toEqual(['data']);
    expect(group.r.focus!.names).toEqual(['Data']);
    expect((await drawn(`${shop}focus: tag:outside\n`)).nodes).toEqual(['api', 'stripe']);
    const two = await drawn(`${shop}focus: { on: [customer, 'tag:outside'], hops: 0 }\n`);
    expect(two.nodes).toEqual(['customer', 'stripe']);
    expect(two.ring.sort()).toEqual(['customer', 'stripe']);
  });

  it('a line on a group speaks for what is inside', async () => {
    const text = shop.replace('- api -> stripe', '- api -> stripe\n  - audit -> data');
    expect((await drawn(`${text}focus: audit\n`)).nodes).toEqual(['audit', 'cache', 'db']);
    expect((await drawn(`${text}focus: db\n`)).nodes).toEqual(['api', 'audit', 'db']);
  });

  it('says what is wrong where it is written', async () => {
    const missing = await render(`${shop}focus: orders\n`, { fonts: 'none' });
    expect(missing.diagnostics).toMatchObject([{ severity: 'error', message: 'Nothing drawn here is called "orders"', line: 20 }]);
    // Nothing to focus on: the whole diagram is drawn, so the editor keeps something to point at.
    expect(missing.graph!.nodes).toHaveLength(7);
    const typo = await render(`${shop}focus: { on: db, hop: 2 }\n`, { fonts: 'none' });
    expect(typo.diagnostics[0]).toMatchObject({ severity: 'error', line: 20 });
    expect(typo.diagnostics[0]!.message).toMatch(/hop/);
    const far = await render(`${shop}focus: { on: db, hops: -1 }\n`, { fonts: 'none' });
    expect(far.diagnostics[0]).toMatchObject({ severity: 'error', line: 20 });
  });

  it('asked for from outside wins over the file, says so in the subtitle, and null draws everything', async () => {
    const asked = await drawn(`${shop}focus: db\n`, { on: 'stripe', hops: 1, direction: 'upstream' });
    expect(asked.nodes).toEqual(['api', 'stripe']);
    expect(asked.r.graph!.subtitle).toBe('Focus on Stripe, 1 hop upstream');
    expect(asked.r.focus).toMatchObject({ written: false, names: ['Stripe'] });
    expect(asked.r.focusWritten).toBe(true);
    const whole = await drawn(`${shop}focus: db\n`, null);
    expect(whole.nodes).toHaveLength(7);
    expect(whole.r.focus).toBeUndefined();
    expect(whole.r.focusWritten).toBe(true);
    const wrong = await render(shop, { fonts: 'none', focus: 'nothing' });
    expect(wrong.diagnostics).toMatchObject([{ severity: 'error', message: 'Focus: Nothing drawn here is called "nothing"' }]);
    expect(wrong.svg).toBeTruthy();
  });

  it('a view has a focus of its own', async () => {
    const text = `${shop}views:\n  payments: { title: Payments, focus: { on: stripe, hops: 2, direction: upstream } }\n  all: { title: Everything }\n`;
    const view = await render(text, { fonts: 'none', view: 'payments' });
    expect(view.diagnostics).toEqual([]);
    expect(view.graph!.nodes.map((n) => n.id).sort()).toEqual(['api', 'stripe', 'web']);
    expect((await render(text, { fonts: 'none', view: 'all' })).graph!.nodes).toHaveLength(7);
    const wrong = await render(text.replace('on: stripe', 'on: strip'), { fonts: 'none', view: 'payments' });
    expect(wrong.diagnostics).toMatchObject([{ severity: 'error', message: 'Nothing drawn here is called "strip"', line: 21 }]);
  });

  it('keeps pins: what was moved by hand stays where it was put', async () => {
    const free = await render(`${shop}focus: db\n`, { fonts: 'none' });
    const at = free.placed!.nodes.get('db')!;
    const pinned = await render(`${shop}focus: db\n`, { fonts: 'none', sidecar: { version: 1, nodes: { db: { x: at.x + 300, y: at.y } } } });
    expect(pinned.placed!.nodes.get('db')!.x).toBeGreaterThan(at.x + 250);
  });

  // The first line of each type's template, focused on where it starts: the type needs no code for it.
  it('works on every type of elements and lines', async () => {
    for (const id of ['systems', 'c4', 'network', 'azure', 'cloud', 'kubernetes', 'erd', 'access', 'github', 'data-products']) {
      const type = findType(id)!;
      expect((schemaOf(type) as { properties: Record<string, unknown> }).properties.focus, id).toBeDefined();
      const whole = await render(type.template, { fonts: 'none' });
      const edge = whole.graph!.edges[0]!;
      const on = edge.from.node;
      const r = await render(type.template, { fonts: 'none', focus: { on, hops: 1 } });
      expect(r.diagnostics.filter((d) => d.severity === 'error'), id).toEqual([]);
      expect(r.svg, id).toBeTruthy();
      const ids = new Set([...r.graph!.nodes, ...r.graph!.groups].map((x) => x.id));
      expect(ids.has(on), id).toBe(true);
      expect(ids.has(edge.to.node), id).toBe(true);
      expect([...r.graph!.nodes, ...r.graph!.groups].filter((x) => x.focused).map((x) => x.id), id).toEqual([on]);
      expect(r.focus!.kept, id).toBeLessThanOrEqual(r.focus!.total);
      // Nothing is left hanging: every line drawn has both its ends.
      for (const e of r.graph!.edges) expect(ids.has(e.from.node) && ids.has(e.to.node), id).toBe(true);
      // Written in the file it gives the same drawing; a file of views only takes it inside a view.
      if (whole.onlyViews) continue;
      const written = await render(`${type.template.trimEnd()}\nfocus: ${JSON.stringify(on)}\n`, { fonts: 'none' });
      expect(written.diagnostics.filter((d) => d.severity === 'error'), id).toEqual([]);
      expect(written.graph!.nodes.map((n) => n.id), id).toEqual(r.graph!.nodes.map((n) => n.id));
    }
  }, 60_000);

  it('cuts the examples down without problems', async () => {
    const cases: [string, unknown, number][] = [
      ['systems/saas-platform.yaml', { on: 'bookings', hops: 2, direction: 'downstream' }, 6],
      ['data-products/finance.yaml', { on: 'payments', direction: 'upstream' }, 3],
    ];
    for (const [f, focus, count] of cases) {
      const r = await render(example(f), { fonts: 'none', focus, load: (rel) => example(`${f.split('/')[0]}/${rel}`) });
      expect(r.diagnostics, f).toEqual([]);
      expect(r.graph!.nodes, f).toHaveLength(count);
    }
  }, 30_000);

  it('the legend explains what is left: no colour or line of what was cut away', async () => {
    const mesh = example('data-products/mesh.yaml');
    const load = (rel: string) => example(`data-products/${rel}`);
    const labels = async (focus?: unknown) => (await render(mesh, { fonts: 'none', load, ...(focus ? { focus } : {}) })).graph!.legend!.map((l) => l.label);
    expect(await labels()).toEqual(['Source-aligned', 'Aggregate', 'Consumer-aligned', 'Data flow']);
    // And the ring around what the focus is about.
    expect(await labels({ on: 'revenue', hops: 'all', direction: 'upstream' })).toEqual(['Source-aligned', 'Consumer-aligned', 'Data flow', 'In focus']);
    expect(await labels({ on: 'exchange-rates', hops: 0 })).toEqual(['Source-aligned', 'In focus']);
  });

  it('a drawing that is one shape is shown whole, with a note', async () => {
    for (const [id, what] of [['sequence', 'a sequence diagram'], ['gitflow', 'a git graph'], ['roadmap', 'a roadmap'], ['journey', 'a journey map']] as const) {
      const type = findType(id)!;
      const whole = await render(type.template, { fonts: 'none' });
      const r = await render(type.template, { fonts: 'none', focus: 'anything' });
      expect(r.diagnostics.filter((d) => !whole.diagnostics.some((w) => w.message === d.message)), id).toMatchObject([
        { severity: 'warning', message: `Focus works on diagrams of elements and lines; ${what} is one drawing, so it is shown whole` },
      ]);
      expect(r.svg, id).toBe(whole.svg);
      expect(r.focus, id).toBeUndefined();
    }
  });
});
