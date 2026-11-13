import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findType, render, schemaOf } from '../src/index.ts';
import type { Placed, StepNote, StepState } from '@cartography/core';
import { drawNote, noteStem, placeNotes } from '@cartography/render';
import { light } from '@cartography/theme';

/** The drawing without its text alternative (title and description, see describe.ts), which tells every step. */
const drawn = (svg: string | undefined) => svg?.replace(/ role="img" aria-labelledby="[^"]*"( aria-describedby="[^"]*")?/, '').replace(/<title id="[^"]*-title">[^<]*<\/title>(<desc id="[^"]*-desc">[^<]*<\/desc>)?/, '');

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
edges:
  - customer -> web
  - web -> api
  - api -> db
  - api -> cache
  - api -> stripe
`;
const steps = (lines: string) => `${shop}steps:\n${lines}`;
/** The markup of one marked element: from its mark to the next marked element. */
function part(svg: string, mark: string, id: string): string {
  const at = svg.indexOf(`data-${mark}="${id}"`);
  const next = svg.slice(at + 1).search(/<g data-(node|group|edge)=/);
  return at < 0 ? '' : svg.slice(at, next < 0 ? undefined : at + 1 + next);
}
/** What a step says about each element, by id; the edges by their ends. */
async function told(text: string) {
  const r = await render(text, { fonts: 'none' });
  const g = r.graph!;
  const edge = (from: string, to: string) => g.edges.find((e) => e.from.node === from && e.to.node === to)!.id;
  return { r, steps: r.steps ?? [], edge };
}

describe('steps: what a step shows', () => {
  it('a caption alone leaves everything as it is; a route puts its lines and ends in focus', async () => {
    const { steps: s, edge } = await told(steps(`  - The shop as it is today.\n  - customer -> web -> api: The order comes in.\n`));
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ caption: 'The shop as it is today.', nodes: {}, groups: {}, edges: {} });
    expect(s[1]!.caption).toBe('The order comes in.');
    expect(s[1]!.nodes).toEqual({ customer: 'focus', web: 'focus', api: 'focus', db: 'dim', cache: 'dim', stripe: 'dim' });
    expect(s[1]!.edges[edge('customer', 'web')]).toBe('focus');
    expect(s[1]!.edges[edge('web', 'api')]).toBe('focus');
    expect(s[1]!.edges[edge('api', 'db')]).toBe('dim');
    // The group that holds what is in focus stays; the one that does not stands back.
    expect(s[1]!.groups).toEqual({ data: 'dim' });
  });

  it('selects by id, group (everything inside), tag:, kind: and a line between two', async () => {
    const { steps: s, edge } = await told(
      steps(`  - focus: data\n  - focus: [tag:outside, kind:client]\n  - highlight: api -> stripe\n  - focus: inside.*\n  - title: Two that are joined\n    focus: [api, db]\n`),
    );
    expect(s[0]!.nodes).toMatchObject({ db: 'focus', cache: 'focus', api: 'dim', customer: 'dim' });
    expect(s[0]!.groups).toEqual({});
    expect(s[1]!.nodes).toMatchObject({ stripe: 'focus', web: 'focus', api: 'dim' });
    expect(s[2]!.nodes).toMatchObject({ api: 'focus', stripe: 'focus', web: 'dim' });
    expect(s[2]!.edges[edge('api', 'stripe')]).toBe('focus');
    expect(s[3]!.nodes).toMatchObject({ web: 'focus', api: 'focus', db: 'focus', cache: 'focus', customer: 'dim', stripe: 'dim' });
    // A line between two elements in focus keeps its strength without being named.
    expect(s[4]!.title).toBe('Two that are joined');
    expect(s[4]!.edges[edge('api', 'db')]).toBeUndefined();
    expect(s[4]!.edges[edge('api', 'cache')]).toBe('dim');
  });

  it('without show nothing is ever absent', async () => {
    const { steps: s } = await told(steps(`  - focus: web\n  - path: api -> db\n`));
    for (const x of s) expect([...Object.values(x.nodes), ...Object.values(x.groups), ...Object.values(x.edges)]).not.toContain('hidden');
  });

  it('show builds the drawing up: cumulative, with the groups around what is shown', async () => {
    const { steps: s, edge } = await told(steps(`  - show: [customer, web]\n  - show: api\n  - path: api -> db\n  - show: '*'\n`));
    expect(s[0]!.nodes).toEqual({ api: 'hidden', db: 'hidden', cache: 'hidden', stripe: 'hidden' });
    expect(s[0]!.groups).toEqual({ data: 'hidden' });
    expect(s[0]!.edges[edge('customer', 'web')]).toBeUndefined();
    expect(s[0]!.edges[edge('web', 'api')]).toBe('hidden');
    expect(s[1]!.nodes).toEqual({ db: 'hidden', cache: 'hidden', stripe: 'hidden' });
    // A path to something not shown yet reveals it.
    expect(s[2]!.nodes).toEqual({ customer: 'dim', web: 'dim', api: 'focus', db: 'focus', cache: 'hidden', stripe: 'hidden' });
    expect(s[2]!.groups).toEqual({});
    expect(s[3]!.nodes).toEqual({});
    expect(s[3]!.edges).toEqual({});
  });

  it('hide takes away from that step on; hiding a line keeps its ends', async () => {
    const { steps: s, edge } = await told(steps(`  - hide: [stripe, api -> cache]\n  - A step later.\n`));
    for (const x of s) {
      expect(x.nodes).toEqual({ stripe: 'hidden' });
      expect(x.edges).toEqual({ [edge('api', 'stripe')]: 'hidden', [edge('api', 'cache')]: 'hidden' });
    }
  });

  it('a note points at an element, a group or a line', async () => {
    const { steps: s, edge } = await told(steps(`  - note: { db: Backed up nightly, data: No way in from outside, api -> stripe: Card data leaves here }\n`));
    expect(s[0]!.notes).toEqual([
      { kind: 'node', id: 'db', text: 'Backed up nightly' },
      { kind: 'group', id: 'data', text: 'No way in from outside' },
      { kind: 'edge', id: edge('api', 'stripe'), text: 'Card data leaves here' },
    ]);
  });
});

describe('steps: where a note goes', () => {
  type B = { x: number; y: number; width: number; height: number };
  const hit = (a: B, b: B) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const within = (a: B, b: B) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
  const state = (notes: StepNote[]): StepState => ({ nodes: {}, groups: {}, edges: {}, notes });

  it('does not lie across the frames its card sits in: it goes past them, with a line back', () => {
    // A card snug in two nested frames (as a VM in a subnet in a network), another card left of it.
    const card = { x: 300, y: 120, width: 180, height: 58 };
    const placed: Placed = {
      nodes: new Map([['vm', card], ['other', { x: 40, y: 120, width: 180, height: 58 }]]),
      groups: new Map([['vnet', { x: 260, y: 40, width: 260, height: 180 }], ['subnet', { x: 280, y: 80, width: 220, height: 120 }]]),
      edges: new Map([['e', { points: [{ x: 220, y: 149 }, { x: 300, y: 149 }] }]]),
      width: 560,
      height: 240,
    };
    const [n] = placeNotes(state([{ kind: 'node', id: 'vm', text: 'nsg-app: RDP from Bastion only' }]), placed);
    for (const g of placed.groups.values()) expect(!hit(n!.box, g) || within(n!.box, g)).toBe(true);
    expect(hit(n!.box, placed.nodes.get('other')!)).toBe(false);
    // Out past the frames, a line reaches back to the card's edge.
    expect(noteStem(n!)).toBeDefined();
    expect(n!.tip.y === card.y || n!.tip.y === card.y + card.height || n!.tip.x === card.x || n!.tip.x === card.x + card.width).toBe(true);
    expect(drawNote(n!, light)).toContain('<circle');
  });

  it('leaves a line label readable, coming closer to its card where the gap is narrow', () => {
    // Cards in a column 40 px apart; the gap above is taken by a line's label.
    const placed: Placed = {
      nodes: new Map([['a', { x: 300, y: 0, width: 200, height: 58 }], ['b', { x: 300, y: 98, width: 200, height: 58 }], ['c', { x: 300, y: 196, width: 200, height: 58 }], ['left', { x: 40, y: 98, width: 200, height: 58 }]]),
      groups: new Map(),
      edges: new Map([['r', { points: [{ x: 500, y: 75 }, { x: 760, y: 75 }], label: { x: 330, y: 66, width: 60, height: 18 } }], ['s', { points: [{ x: 500, y: 127 }, { x: 760, y: 127 }], label: { x: 600, y: 118, width: 60, height: 18 } }]]),
      width: 760,
      height: 254,
    };
    const [n] = placeNotes(state([{ kind: 'node', id: 'b', text: 'MFA and a reason' }]), placed);
    for (const [, e] of placed.edges) expect(hit(n!.box, e.label!)).toBe(false);
    for (const [id, b] of placed.nodes) if (id !== 'b') expect(hit(n!.box, b)).toBe(false);
    expect(noteStem(n!)).toBeUndefined();
  });
});

describe('steps: problems', () => {
  it('says where an unknown name is, by line and column', async () => {
    const text = steps(`  - focus: [web, nothing]\n  - web -> stripe: Not joined\n  - path: 'api -> '\n`);
    const { r } = await told(text);
    const lines = text.split('\n');
    const unknown = r.diagnostics.find((d) => d.message === 'Nothing drawn here is called "nothing"')!;
    expect(unknown.severity).toBe('error');
    expect(lines[unknown.line! - 1]!.slice(unknown.column! - 1)).toMatch(/^nothing\]/);
    const none = r.diagnostics.find((d) => d.message === 'There is no line between "web" and "stripe"')!;
    expect(none.severity).toBe('warning');
    expect(lines[none.line! - 1]).toContain('web -> stripe');
    expect(r.diagnostics.some((d) => d.message === '"api -> " misses an end' && d.severity === 'error')).toBe(true);
    // The drawing is still made, with the steps that could be read.
    expect(r.svg).toBeTruthy();
    expect(r.steps).toHaveLength(3);
  });

  it('rejects a step that is neither words nor a map', async () => {
    const { r } = await told(steps(`  - [web, api]\n`));
    expect(r.diagnostics.some((d) => d.severity === 'error' && d.line === shop.split('\n').length + 1)).toBe(true);
  });

  it('steps at the top of a file that only has views are pointed at the view', async () => {
    const text = `type: systems\ninclude: [model.yaml]\nviews:\n  all: { title: All }\nsteps:\n  - Hello\n`;
    const model = `type: model\nelements:\n  a: { kind: service, label: A }\n  b: { kind: service, label: B }\nrelations:\n  - a -> b\n`;
    const r = await render(text, { fonts: 'none', load: () => model });
    expect(r.diagnostics.map((d) => d.message)).toContain('These steps are for the diagram as written, and this file only has views: put steps inside a view');
  });
});

describe('steps: drawing', () => {
  const text = steps(
    `  - title: Today\n    caption: Everything that is there.\n    show: [customer, inside]\n  - title: Paying\n    caption: The API asks Stripe.\n    path: api -> stripe\n    note: { stripe: Card data leaves here }\n  - focus: data\n`,
  );

  it('lists the steps and draws the one asked for, clamped to what there is', async () => {
    const whole = await render(text, { fonts: 'none' });
    expect(whole.steps).toHaveLength(3);
    expect(whole.step).toBeUndefined();
    expect(whole.stepsImplied).toBeUndefined();
    expect((await render(text, { fonts: 'none', step: 2 })).step).toBe(2);
    expect((await render(text, { fonts: 'none', step: 9 })).step).toBe(3);
    expect((await render(text, { fonts: 'none', step: 0 })).step).toBe(1);
    expect((await render(shop, { fonts: 'none', step: 2 })).step).toBeUndefined();
  });

  it('the layout never moves: every box and the drawing size are the same at every step', async () => {
    const whole = await render(text, { fonts: 'none' });
    const shots = await Promise.all([1, 2, 3].map((step) => render(text, { fonts: 'none', step })));
    for (const s of shots) {
      expect([...s.placed!.nodes]).toEqual([...whole.placed!.nodes]);
      expect([...s.placed!.groups]).toEqual([...whole.placed!.groups]);
      expect([...s.placed!.edges].map(([id, e]) => [id, e.points])).toEqual([...whole.placed!.edges].map(([id, e]) => [id, e.points]));
      expect([s.width, s.height, s.origin]).toEqual([shots[0]!.width, shots[0]!.height, shots[0]!.origin]);
    }
    // Also in an example with hand-written steps, and without the caption block (as the presenter draws it).
    const azure = example('azure/web-shop.yaml');
    const first = await render(azure, { fonts: 'none', step: 1, stepCaption: false });
    for (let step = 2; step <= first.steps!.length; step++) {
      const s = await render(azure, { fonts: 'none', step, stepCaption: false });
      expect([...s.placed!.nodes]).toEqual([...first.placed!.nodes]);
      expect([s.width, s.height]).toEqual([first.width, first.height]);
    }
  });

  it('what is not shown yet is absent, what stands back is quiet and flat, the route is heavier with a halo', async () => {
    const one = (await render(text, { fonts: 'none', step: 1, marks: true })).svg!;
    expect(one).toContain('data-node="web"');
    expect(one).not.toContain('data-node="stripe"');
    expect(one).not.toContain('>Stripe<');
    const r = await render(text, { fonts: 'none', step: 2, marks: true });
    const two = r.svg!;
    const node = (id: string) => part(two, 'node', id);
    // In focus: drawn as always, in the theme's text colour. Standing back: a quieter ink.
    expect(node('api')).toContain(`fill="${r.theme!.text}"`);
    expect(node('web')).not.toContain(`fill="${r.theme!.text}"`);
    // In a look with shadows (classic) what is in focus keeps its shadow and what stands back lies flat.
    const classic = (await render(text, { fonts: 'none', step: 2, marks: true, theme: 'classic' })).svg!;
    expect(part(classic, 'node', 'api')).toContain('filter="url(#');
    expect(part(classic, 'node', 'web')).not.toContain('filter="url(#');
    expect(two).toContain('>Stripe<');
    // The route does not lean on colour alone: a halo under it and a heavier line.
    const edge = r.graph!.edges.find((e) => e.to.node === 'stripe')!.id;
    const line = part(two, 'edge', edge);
    expect(line).toContain('data-halo');
    // One calm halo for every line in focus: a shade of the text colour, never a tone or the accent.
    expect(line).toContain(`stroke="${r.theme!.text}" stroke-opacity="0.13"`);
    const widths = [...line.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]));
    const other = r.graph!.edges.find((e) => e.to.node === 'db')!.id;
    const quiet = part(two, 'edge', other);
    expect(Math.max(...widths.slice(1))).toBeGreaterThan(Math.max(...[...quiet.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]))));
    expect(quiet).not.toContain('data-halo');
    // The callout, the words and the place in the story.
    expect(two).toContain('Card data leaves here');
    expect(two).toContain('>Paying<');
    expect(two).toContain('The API asks Stripe.');
    expect(two).toContain('2 / 3');
  });

  it('leaves the words out on request, and draws the whole diagram without a step', async () => {
    const bare = drawn((await render(text, { fonts: 'none', step: 2, stepCaption: false })).svg)!;
    expect(bare).not.toContain('The API asks Stripe.');
    expect(bare).not.toContain('2 / 3');
    expect(bare).toContain('Card data leaves here');
    const whole = drawn((await render(text, { fonts: 'none' })).svg)!;
    expect(whole).toContain('>Stripe<');
    expect(whole).not.toContain('Card data leaves here');
    expect(whole).not.toContain('Everything that is there.');
  });

  it('keeps the room a note needs outside the drawing in the whole drawing too, so it does not jump to the first step', async () => {
    const hub = example('azure/hub-spoke.yaml');
    const whole = await render(hub, { fonts: 'none' });
    const placed = whole.placed!;
    // A step whose note stands past the drawing's edge.
    const out = whole.steps!.findIndex((s) => placeNotes(s, placed).some((n) => n.box.y + n.box.height > placed.height || n.box.x + n.box.width > placed.width || n.box.x < 0 || n.box.y < 0));
    expect(out).toBeGreaterThanOrEqual(0);
    for (let i = 1; i <= whole.steps!.length; i++) {
      const s = await render(hub, { fonts: 'none', step: i, stepCaption: false });
      expect([s.width, s.height, s.origin], `step ${i}`).toEqual([whole.width, whole.height, whole.origin]);
    }
  });

  it('ties the caption to the drawing with a hairline only: no bar that would read as progress', async () => {
    const at = (await render(text, { fonts: 'none', step: 1 })).svg!;
    const after = (await render(text, { fonts: 'none', step: 3 })).svg!;
    expect(at).toContain('1 / 3');
    for (const svg of [at, after]) expect(svg).not.toMatch(/<rect [^>]*width="40" height="3"/);
  });

  it('is legible in the dark theme too: what stands back keeps its distance from the canvas', async () => {
    const r = await render(text, { fonts: 'none', step: 2, theme: 'dark', marks: true });
    const svg = r.svg!;
    const web = part(svg, 'node', 'web');
    const inks = [...web.matchAll(/<text[^>]* fill="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1]!);
    expect(inks.length).toBeGreaterThan(0);
    const lum = (hex: string) => {
      const [r8, g8, b8] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r8! + 0.7152 * g8! + 0.0722 * b8!;
    };
    const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    for (const ink of inks) expect(contrast(ink, r.theme!.canvas), ink).toBeGreaterThan(2.2);
  });
});

describe('steps: views and steps nobody wrote', () => {
  it('a view has its own steps', async () => {
    const text = `${shop}views:\n  paying:\n    title: Paying\n    exclude: [cache]\n    steps:\n      - web -> api: In.\n      - api -> stripe: Out.\n`;
    const whole = await render(text, { fonts: 'none' });
    expect(whole.steps).toBeUndefined();
    const view = await render(text, { fonts: 'none', view: 'paying', step: 2 });
    expect(view.steps).toHaveLength(2);
    expect(view.step).toBe(2);
    expect(view.steps![1]!.nodes).toMatchObject({ api: 'focus', stripe: 'focus', web: 'dim' });
    // A step that names what the view left out says so, at its line.
    const bad = await render(text.replace('api -> stripe: Out.', 'api -> cache: Out.'), { fonts: 'none', view: 'paying' });
    const d = bad.diagnostics.find((x) => x.message === 'Nothing drawn here is called "cache"')!;
    expect(d.line).toBe(text.split('\n').findIndex((l) => l.includes('api -> stripe: Out.')) + 1);
  });

  it('a C4 dynamic view steps through its numbered lines', async () => {
    const text = example('c4/kestrel-bank.yaml');
    const r = await render(text, { fonts: 'none', view: 'payment', step: 3 });
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.steps).toHaveLength(4);
    expect(r.stepsImplied).toBe(true);
    expect(r.steps![2]!.caption).toBe('Books it');
    // One line in focus per step, the rest of the story standing back.
    for (const s of r.steps!) expect(Object.values(s.edges).filter((e) => e === 'focus')).toHaveLength(1);
    expect(r.svg).toContain('3 / 4');
  });

  it('a sequence diagram steps through its messages', async () => {
    const text = example('sequence/checkout.yaml');
    const r = await render(text, { fonts: 'none', step: 2 });
    expect(r.stepsImplied).toBe(true);
    expect(r.steps!.length).toBeGreaterThan(3);
    expect(r.steps!.map((s) => s.message)).toEqual(r.steps!.map((_, i) => i + 1));
    const all = await render(text, { fonts: 'none', step: r.steps!.length });
    expect([r.width, r.height]).toEqual([all.width, all.height]);
    // Later messages are not drawn yet.
    expect(all.svg!.length).toBeGreaterThan(r.svg!.length);
  });

  it('every graph type takes steps, and editors complete them', async () => {
    for (const id of ['systems', 'azure', 'kubernetes', 'network', 'c4', 'erd', 'data-products', 'access', 'github']) {
      const type = findType(id)!;
      expect(type, id).toBeDefined();
      const schema = schemaOf(type) as { properties: Record<string, { items?: unknown }> };
      expect(schema.properties.steps?.items, id).toBeDefined();
    }
  });

  it('the examples told in steps draw every step without problems', async () => {
    for (const f of ['azure/web-shop.yaml', 'data-products/customer.yaml', 'systems/invoice-walkthrough.yaml']) {
      const first = await render(example(f), { fonts: 'none', step: 1 });
      expect(first.diagnostics, f).toEqual([]);
      expect(first.steps!.length, f).toBeGreaterThan(3);
      for (let step = 2; step <= first.steps!.length; step++) expect((await render(example(f), { fonts: 'none', step })).svg, `${f} step ${step}`).toBeTruthy();
    }
  }, 30_000);
});

describe('steps: without a step', () => {
  const story = steps(`  - The shop today.\n  - title: Without Stripe\n    hide: [api -> stripe, stripe]\n`);

  it('draws where the story ends: what a step hid is not drawn, the rest at full strength', async () => {
    const { r, edge } = await told(story);
    const svg = (await render(story, { fonts: 'none', marks: true })).svg!;
    expect(svg).not.toContain(`data-edge="${edge('api', 'stripe')}"`);
    expect(svg).not.toContain('data-node="stripe"');
    expect(svg).toContain(`data-edge="${edge('api', 'db')}"`);
    // No caption or "2 / 2": it is the drawing, not a step of it.
    expect(svg).not.toContain('2 / 2');
    expect(r.step).toBeUndefined();
  });

  it('in the editor what was hidden stays at hand, standing back', async () => {
    const svg = (await render(story, { fonts: 'none', interactive: true })).svg!;
    expect(part(svg, 'node', 'stripe')).toContain('data-dim');
  });

  it('what no step ever showed is still drawn', async () => {
    const text = steps(`  - { title: The front, show: [customer, web] }\n  - { title: All of it }\n`);
    expect((await render(text, { fonts: 'none', marks: true })).svg).toContain('data-node="db"');
  });

  it('a story that hides nothing is drawn as written', async () => {
    const text = steps(`  - focus: web\n  - path: api -> db\n`);
    expect(drawn((await render(text, { fonts: 'none' })).svg)).toBe(drawn((await render(shop, { fonts: 'none' })).svg));
  });

  it('the walkthrough example draws the proposal, not today and the proposal at once', async () => {
    const r = await render(example('systems/invoice-walkthrough.yaml'), { fonts: 'none', marks: true });
    const g = r.graph!;
    const id = (from: string, to: string) => g.edges.find((e) => e.from.node === from && e.to.node === to)!.id;
    expect(r.svg).not.toContain(`data-edge="${id('orders', 'erp')}"`);
    expect(r.svg).not.toContain(`data-edge="${id('orders', 'mail')}"`);
    expect(r.svg).toContain(`data-edge="${id('invoicing', 'erp')}"`);
  });
});
