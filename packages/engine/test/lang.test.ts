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
});
