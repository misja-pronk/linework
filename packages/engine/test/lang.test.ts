import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describe as tell, toText } from '@cartography/describe';
import { render } from '../src/index.ts';

const shop = `type: systems
title: Webwinkel
nodes:
  klanten: { kind: users }
  winkel: { kind: mobile, label: Webwinkel }
  db: { kind: database, label: Orders, caption: Users }
  q: queue
edges:
  - klanten -> winkel: { label: HTTPS, style: sync }
  - winkel -> db: { style: data }
  - winkel -> q
`;

const nl = (text: string) => `lang: nl\n${text}`;
const card = (r: Awaited<ReturnType<typeof render>>, id: string) => {
  const s = r.graph!.nodes.find((n) => n.id === id)!.shape;
  return s.kind === 'card' ? { label: s.label, caption: s.caption } : undefined;
};

describe('lang: nl', () => {
  it('draws the words Cartography adds in Dutch, and leaves what the author wrote', async () => {
    const r = await render(nl(shop), { fonts: 'none' });
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.lang).toBe('nl');
    expect(r.theme?.lang).toBe('nl');
    // No label of its own: the kind's name, in Dutch. A written label or caption stays.
    expect(card(r, 'klanten')?.label).toBe('Gebruikers');
    expect(card(r, 'winkel')).toEqual({ label: 'Webwinkel', caption: 'Mobiele app' });
    expect(card(r, 'db')).toEqual({ label: 'Orders', caption: 'Users' });
    expect(card(r, 'q')?.label).toBe('Wachtrij');
    expect(r.graph!.legend!.map((l) => l.label)).toEqual(expect.arrayContaining(['Verzoek', 'Datastroom']));
    expect(r.svg).toContain('>LEGENDA<');
    expect(r.svg).not.toContain('>KEY<');
  });

  it('changes nothing in English, written or not', async () => {
    const plain = await render(shop, { fonts: 'none' });
    const en = await render(`lang: en\n${shop}`, { fonts: 'none' });
    expect(plain.lang).toBe('en');
    expect(plain.theme?.lang).toBeUndefined();
    expect(en.svg).toBe(plain.svg);
    expect(card(plain, 'klanten')?.label).toBe('Users');
  });

  it('takes the language asked for when the diagram has none, and the diagram wins', async () => {
    expect((await render(shop, { fonts: 'none', lang: 'nl' })).lang).toBe('nl');
    expect((await render(`lang: en\n${shop}`, { fonts: 'none', lang: 'nl' })).lang).toBe('en');
  });

  it('warns about a language it does not speak', async () => {
    const r = await render(`lang: fr\n${shop}`, { fonts: 'none' });
    expect(r.diagnostics.some((d) => d.severity === 'warning' && /lang/.test(d.message))).toBe(true);
    expect(r.lang).toBe('en');
  });

  it('tells the drawing in Dutch sentences', async () => {
    const r = await render(nl(shop), { fonts: 'none' });
    const text = toText(tell(r));
    expect(text).toContain('Architectuurdiagram.');
    expect(text).toContain('4 elementen, met 3 verbindingen.');
    expect(text).toContain('Gebruikers roepen Webwinkel aan via HTTPS.');
    expect(text).toContain('Legenda');
  });

  it('draws trust boundaries and a focus in Dutch', async () => {
    const text = fs.readFileSync(new URL('../../../examples/systems/trust-zones.yaml', import.meta.url), 'utf8');
    const r = await render(nl(text), { fonts: 'none' });
    expect(r.graph!.legend!.map((l) => l.label)).toContain('Vertrouwensgrens');
    expect(r.graph!.groups.some((g) => g.caption === 'Vertrouwensgrens')).toBe(true);
    const focused = await render(nl(shop), { fonts: 'none', focus: 'winkel' });
    expect(focused.graph!.subtitle).toMatch(/^Focus op Webwinkel, 1 stap ver$/);
  });

  it("names the type's own views in Dutch, in the picker's list and as the drawing's subtitle, and keeps the author's names", async () => {
    const mesh = `type: data-products
title: Mesh
domains:
  sales: Verkoop
products:
  orders: { domain: sales, outputs: { orders: { kind: table, contract: orders } } }
  returns: { label: Retouren, domain: sales, inputs: [orders] }
  loose: { label: Support, inputs: [orders] }
contracts:
  orders: { fields: { id: uuid pk } }
`;
    const r = await render(nl(mesh), { fonts: 'none' });
    expect(r.views!.map((v) => v.title)).toEqual(['Overzicht', 'orders in detail', 'Retouren in detail', 'Overige producten in detail']);
    const one = await render(nl(mesh), { fonts: 'none', view: 'detailed-returns' });
    expect(one.graph!.subtitle).toBe('Retouren in detail');
    // In English as before.
    expect((await render(mesh, { fonts: 'none' })).views![0]!.title).toBe('Overview');
    // The phases of a sequence are its author's dividers: only the whole is named in Dutch.
    const seq = `type: sequence
participants: { a: {}, b: {} }
messages:
  - a -> b: hi
  - divider: Support
  - a -> b: hi
  - divider: Overview
  - b -> a: ok
  - divider: ''
  - b -> a: bye
`;
    const phases = (await render(nl(seq), { fonts: 'none' })).views!;
    expect(phases.map((v) => v.title)).toEqual(['Hele sequence', 'Start', 'Support', 'Overview', 'Fase 4']);
    expect(phases.map((v) => v.name)).toEqual(['whole', 'phase-start', 'phase-support', 'phase-overview', 'phase-phase-4']);
  });

  it('heads the sections of a data product and its contract in Dutch', async () => {
    const product = `type: data-products
title: Orders
view: detailed
contract-fields: 1
products:
  orders: { inputs: [shop], outputs: { orders: { kind: table, contract: orders } } }
sources:
  shop: application
contracts:
  orders:
    fields: { id: uuid pk, total: decimal, placed: timestamp }
    sla: { freshness: 1 hour }
    quality: [id is unique]
`;
    const sections = (r: Awaited<ReturnType<typeof render>>) =>
      r.graph!.nodes.flatMap((n) => (n.shape.kind === 'table' ? n.shape.rows.flatMap((x) => (x.kind === 'section' ? [x.label] : x.id === 'field:more' ? [x.cells[0]!.text] : [])) : []));
    const dutch = await render(nl(product), { fonts: 'none' });
    expect(dutch.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(sections(dutch)).toEqual(['Inputports', 'Outputports', 'Schema', '+ nog 2 velden', 'Garanties', 'Kwaliteitscontroles']);
    expect(sections(await render(product, { fonts: 'none' }))).toEqual(['Input ports', 'Output ports', 'Schema', '+ 2 more fields', 'Guarantees', 'Quality checks']);
  });

  it("writes the other types' own words in Dutch: kinds of participants, matrix corners, months, counts", async () => {
    const text = (r: Awaited<ReturnType<typeof render>>) => r.svg!.replace(/<[^>]+>/g, ' ');
    // A sequence names a participant by its kind when it has no label, and captions it with its kind.
    const seq = await render(nl('type: sequence\nparticipants:\n  shopper: person\n  web: { kind: client, label: Storefront }\nmessages:\n  - shopper -> web: Order\n'), { fonts: 'none' });
    expect(text(seq)).toContain('Persoon');
    expect(text(seq)).toContain('Webapp');
    // An access matrix: its corner, the kinds of its rows and columns, how a role is reached.
    const access = `type: access
view: access
principals:
  devs: { kind: group, label: Developers }
resources:
  prod: { kind: subscription, label: Production }
  rg: { kind: resource-group, label: rg-shop, in: prod }
roles:
  reader: { label: Reader }
assignments:
  - devs is reader on prod
`;
    const matrix = await render(nl(access), { fonts: 'none' });
    const shape = matrix.graph!.nodes.find((n) => n.shape.kind === 'matrix')!.shape as { corner: string; rows: { caption?: string }[]; columns: { caption?: string }[]; cells: ({ note?: string } | undefined)[][] };
    expect(shape.corner).toBe('Wie \\ waar');
    expect(shape.rows[0]!.caption).toBe('Beveiligingsgroep');
    expect(shape.columns.map((c) => c.caption)).toEqual(['Abonnement', 'Resourcegroep']);
    expect(shape.cells[0]![1]!.note).toBe('vanuit Production');
    expect(matrix.views!.map((v) => v.title)).toEqual(['Wie krijgt wat, als tekening', 'Wie × waar', 'Rollen × rechten']);
    // In English the context mark is never drawn.
    const english = (await render(access, { fonts: 'none' })).graph!.nodes.find((n) => n.shape.kind === 'matrix')!.shape as typeof shape;
    expect(english.cells[0]![1]!.note).toBe('from Production');
    // A roadmap's months and today; a load balancer open to the internet; a team's size.
    const plan = await render(nl('type: roadmap\nfrom: 2026-01\nto: 2026-12\nunit: month\ntoday: 2026-05-04\nitems:\n  a: { label: Build, from: 2026-02, to: 2026-04 }\n'), { fonts: 'none' });
    expect(text(plan)).toMatch(/Mrt[\s\S]*Mei[\s\S]*Okt/);
    expect(text(plan)).toContain('Vandaag · 4 Mei 2026');
    const lb = await render(nl('type: cloud\nprovider: aws\nnodes:\n  alb: { kind: alb, label: Front door, exposure: public }\n'), { fonts: 'none' });
    expect(card(lb, 'alb')?.caption).toBe('Application Load Balancer · publiek');
    const teams = await render(nl('type: teams\nteams:\n  shop: { kind: stream-aligned, size: 1 }\n  pay: { kind: stream-aligned, size: 5 }\n'), { fonts: 'none' });
    expect(text(teams)).toContain('1 persoon');
    expect(text(teams)).toContain('5 mensen');
  });

  it('writes what an access diagram says about PIM, Conditional Access and a comparison in Dutch', async () => {
    const access = `type: access
principals:
  devs: { kind: group, label: Developers }
  ops: { kind: group, label: Operations }
resources:
  prod: { kind: subscription, label: Production }
roles:
  reader: { label: Reader }
  owner: { label: Owner, inherits: reader }
policies:
  ca: { targets: [devs], requires: [MFA, PAW], state: report-only }
assignments:
  - devs is reader on prod
  - { principal: ops, role: owner, scope: prod, eligible: true, activation: 4 h, approval: devs }
`;
    const graph = await render(nl(access), { fonts: 'none' });
    expect(graph.graph!.legend!.map((l) => l.label)).toEqual(expect.arrayContaining(['In aanmerking, geactiveerd via PIM', 'Roltoewijzing']));
    expect(graph.graph!.edges.map((e) => e.label)).toContain('Owner · 4 h · goedkeuring');
    expect(card(graph, 'ca')?.caption).toBe('Alleen rapporteren · vereist MFA en PAW');
    type Matrix = { corner: string; rows: { caption?: string }[]; cells: ({ text?: string; note?: string } | undefined)[][] };
    const matrix = (r: Awaited<ReturnType<typeof render>>) => r.graph!.nodes.find((n) => n.shape.kind === 'matrix')!.shape as unknown as Matrix;
    const who = matrix(await render(nl(access), { fonts: 'none', view: 'access' }));
    expect(who.cells[1]![0]).toMatchObject({ text: 'Owner (in aanmerking)', note: 'max. 4 h, goedkeuring door Developers' });
    // Against an earlier state: the key, the corner, what is new, what it was.
    const was = `\nview: access\nwas:\n  principals:\n    devs: { kind: group, label: Developers }\n    gone: { kind: user, label: Gone }\n  resources:\n    prod: { kind: subscription, label: Production }\n  roles:\n    reader: { label: Reader }\n  assignments:\n    - devs is reader on prod\n    - gone is reader on prod\n`;
    const compared = await render(nl(access + was), { fonts: 'none' });
    expect(compared.graph!.legend!.map((l) => l.label)).toEqual(['+ erbij', '− kwijt', '~ gewijzigd', 'ongewijzigd']);
    expect(matrix(compared).corner).toBe('Wie \\ waar');
    expect(matrix(compared).rows.map((r) => r.caption)).toEqual(['Nieuw · Beveiligingsgroep', 'Weg · Gebruiker']);
    expect(matrix(compared).cells[0]![0]!.text).toBe('+ Owner (in aanmerking)');
    // In English as before.
    const english = await render(access + was, { fonts: 'none' });
    expect(english.graph!.legend!.map((l) => l.label)).toEqual(['+ gained', '− lost', '~ changed', 'as it was']);
    expect(matrix(english).cells[0]![0]!.text).toBe('+ Owner (eligible)');
    expect(card(await render(access, { fonts: 'none' }), 'ca')?.caption).toBe('Report-only · requires MFA and PAW');
    // Told in a sentence from its parts, not from the short label on the line.
    expect(toText(tell(graph))).toContain('Operations kan Owner op Production activeren voor maximaal 4 h, met goedkeuring door Developers.');
    expect(toText(tell(await render(access, { fonts: 'none' })))).toContain('Operations can activate Owner on Production for at most 4 h, with approval by Developers.');
  });

  it('says the key and the ends of a line in plain Dutch, without ids or internal words', async () => {
    const example = (f: string) => fs.readFileSync(new URL(`../../../examples/${f}`, import.meta.url), 'utf8');
    const said = async (text: string, view?: string) => toText(tell(await render(nl(text), { fonts: 'none', view, load: (f) => fs.readFileSync(new URL(`../../../examples/data-products/${f}`, import.meta.url), 'utf8') })));
    const access = await said(example('access/azure-rbac-pim.yaml'), 'access');
    expect(access).toContain('Indigo gevulde pil: Direct toegewezen');
    expect(await said(example('access/azure-rbac-pim.yaml'), 'roles')).toContain('Indigo vinkje: Via de rol toegekend');
    // Before a het-word the colour has no -e; a symbol is said by what it means, not by its icon's id.
    const erd = await said(example('erd/orders.yaml'));
    expect(erd).toContain('Oranjegeel symbool: Primaire sleutel');
    expect(erd).not.toMatch(/symbool key/);
    // A data product's ports are rows: a line to one is told by what the row says, not by its id.
    const mesh = await said(example('data-products/customer-detailed.yaml'));
    expect(mesh).toContain('Salesforce is verbonden met Customers.');
    expect(mesh).not.toMatch(/\.(in|out):/);
    // A capability map counts its systems in Dutch.
    const systems = await said(example('capabilities/enterprise.yaml'), 'systems');
    expect(systems).toContain('1 systeem');
    expect(systems).toContain('geen systeem');
    expect(`${access}${erd}${mesh}${systems}`).not.toMatch(/tone:|Tone:/);
  });

  it("keeps a name that is the entry's own key, such as a class called Member", async () => {
    const r = await render(nl('type: class\nclasses:\n  Member: { members: [+name: String] }\n'), { fonts: 'none' });
    const s = r.graph!.nodes.find((n) => n.id === 'Member')!.shape;
    expect(s.kind === 'table' && s.title).toBe('Member');
  });

  it('keeps a name made from the key, and names a kind the key only repeats in Dutch', async () => {
    const label = (r: Awaited<ReturnType<typeof render>>, id: string) => (r.graph!.nodes.find((n) => n.id === id)!.shape as { label?: string }).label;
    // A team called payments is Payments, not Betalingen; its kind is told in Dutch, in the tooltip too.
    const teams = await render(nl('type: teams\nteams:\n  payments: { kind: stream-aligned }\n  search: stream-aligned\n'), { fonts: 'none' });
    expect(label(teams, 'payments')).toBe('Payments');
    expect(label(teams, 'search')).toBe('Search');
    expect(teams.graph!.nodes.find((n) => n.id === 'payments')!.description).toBe('Stroomgericht team');
    expect(toText(tell(teams))).toContain('- Payments (stroomgericht team)\n');
    // users: { kind: users } names its kind: Gebruikers. A lane written "actions: Actions" is the author's.
    expect(card(await render(nl('type: systems\nnodes:\n  users: { kind: users }\n'), { fonts: 'none' }), 'users')?.label).toBe('Gebruikers');
    const flow = await render(nl('type: process\nlanes:\n  actions: Actions\nnodes:\n  Build: { in: actions }\n'), { fonts: 'none' });
    expect(flow.graph!.groups.find((g) => g.id === 'actions')!.label).toBe('Actions');
  });

  it("gives the type's own view titles in another language for the editor, and leaves the author's out", async () => {
    const mesh = 'type: data-products\nproducts:\n  orders: { outputs: { orders: { kind: table } } }\n';
    const r = await render(nl(mesh), { fonts: 'none' });
    expect(r.views![0]!.title).toBe('Overzicht');
    expect(r.viewTitles!('en')).toMatchObject({ overview: 'Overview' });
    expect((await render(mesh, { fonts: 'none' })).viewTitles!('nl')).toMatchObject({ overview: 'Overzicht' });
    // A model's views are the author's: no title of the type's for them.
    const model = await render(fs.readFileSync(new URL('../../../examples/systems/saas-platform.yaml', import.meta.url), 'utf8'), { fonts: 'none' });
    expect(model.views![0]).toEqual({ name: 'overview', title: 'Booking platform' });
    expect(model.viewTitles).toBeUndefined();
  });
});

