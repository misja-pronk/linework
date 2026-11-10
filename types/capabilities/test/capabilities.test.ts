import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BlockShape, GraphNode } from '@cartography/core';
import { render } from '../../../packages/engine/src/index.ts';
import { bigMap } from '../../../packages/tree/test/fixtures.ts';
import { capabilityReferences, heatScale, numberOf } from '../src/index.ts';

const example = (f: string) => fs.readFileSync(new URL(`../../../examples/capabilities/${f}`, import.meta.url), 'utf8');
const block = (n: GraphNode | undefined) => n?.shape as BlockShape;
const errors = (r: Awaited<ReturnType<typeof render>>) => r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);

describe('capabilities', () => {
  it('reads nested lists, nested maps and parent: into one tree of three levels', async () => {
    const r = await render(
      `type: capabilities
capabilities:
  Customer:
    - Marketing: [Campaigns, Loyalty]
    - Sales
  Finance:
    capabilities:
      Accounting: { maturity: 4 }
  Payroll: { parent: Finance }
`,
      { fonts: 'none' },
    );
    expect(errors(r)).toEqual([]);
    const g = r.graph!;
    const n = (id: string) => block(g.nodes.find((x) => x.id === id));
    expect(n('Customer').form).toBe('area');
    expect(n('Marketing').form).toBe('capability');
    expect(n('Marketing').container).toBe(true);
    expect(n('Campaigns').form).toBe('chip');
    expect(n('Campaigns').inside).toBe('Marketing');
    expect(n('Payroll').inside).toBe('Finance');
    expect(n('Payroll').form).toBe('capability');
    // Paths point at what was written, for the editor.
    expect(g.nodes.find((x) => x.id === 'Campaigns')!.path).toEqual(['capabilities', 'Customer', 0, 'Marketing', 0]);
    expect(g.nodes.find((x) => x.id === 'Accounting')!.path).toEqual(['capabilities', 'Finance', 'capabilities', 'Accounting']);
    // Children stand inside their parent's box.
    const p = r.placed!.nodes;
    const inside = (a: string, b: string) => p.get(a)!.x >= p.get(b)!.x && p.get(a)!.x + p.get(a)!.width <= p.get(b)!.x + p.get(b)!.width && p.get(a)!.y >= p.get(b)!.y && p.get(a)!.y + p.get(a)!.height <= p.get(b)!.y + p.get(b)!.height;
    for (const [a, b] of [['Campaigns', 'Marketing'], ['Marketing', 'Customer'], ['Payroll', 'Finance']]) expect(inside(a!, b!), `${a} in ${b}`).toBe(true);
  });

  it('says what is wrong: an unknown parent, a loop, a fourth level', async () => {
    const r = await render('type: capabilities\ncapabilities:\n  A: { parent: Nope }\n  B: { parent: C }\n  C: { parent: B }\n  D:\n    - E:\n        - F: [G]\n', { fonts: 'none' });
    const all = r.diagnostics.map((d) => d.message);
    expect(all).toContain('There is no capability "Nope"');
    expect(all.some((m) => m.includes('inside itself'))).toBe(true);
    expect(all.some((m) => m.includes('three levels'))).toBe(true);
    expect(r.svg).toBeTruthy();
  });

  it('tells a name used twice apart by where it stands', async () => {
    const r = await render('type: capabilities\ncapabilities:\n  Sales: [Reporting]\n  Finance: [Reporting]\n', { fonts: 'none' });
    expect(r.graph!.nodes.map((n) => n.id)).toEqual(['Sales', 'Reporting', 'Finance', 'Finance › Reporting']);
  });

  it('colours by maturity with words beside every colour, and a legend', async () => {
    const r = await render(example('enterprise.yaml'), { fonts: 'none' });
    expect(errors(r)).toEqual([]);
    const loyalty = block(r.graph!.nodes.find((n) => n.id === 'Loyalty'));
    expect(loyalty.heat).toMatchObject({ scale: 'diverging', at: 0, text: '1' });
    expect(r.graph!.legend!.map((l) => l.label)).toEqual(['Maturity: 1 Initial', '2 Developing', '3 Defined', '4 Managed', '5 Optimised']);
    // The value is in the drawing as text, not only as a colour.
    expect(r.svg).toContain('>1</text>');
    expect(r.views!.map((v) => v.name)).toEqual(['map', 'maturity', 'investment', 'systems']);
  });

  it('colours by words as categories, with a pattern for what goes', async () => {
    const r = await render(example('enterprise.yaml'), { fonts: 'none', view: 'investment' });
    const payroll = block(r.graph!.nodes.find((n) => n.id === 'Payroll'));
    expect(payroll.heat).toEqual({ scale: 'categorical', tone: 'rose', text: 'Divest', pattern: 'hatch' });
    expect(r.graph!.legend![0]!.label).toBe('Investment: Maintain');
  });

  it('lists the systems behind each capability, from the model', async () => {
    const r = await render(example('enterprise.yaml'), { fonts: 'none', view: 'systems' });
    const campaigns = block(r.graph!.nodes.find((n) => n.id === 'Campaigns'));
    expect(campaigns.lines).toEqual(['Salesforce', 'Contentful']);
    expect(campaigns.heat?.text).toBe('2');
    expect(block(r.graph!.nodes.find((n) => n.id === 'Loyalty')).lines).toEqual(['no system']);
    expect(r.graph!.nodes.find((n) => n.id === 'Quoting')!.description).toBe('Supported by Salesforce, SAP S/4HANA');
  });

  it('reads costs as numbers, and draws as deep as asked', async () => {
    expect(numberOf('€1.2M')).toBe(1.2e6);
    expect(numberOf('800k')).toBe(8e5);
    expect(numberOf('invest')).toBeUndefined();
    const s = heatScale({ by: 'cost' }, ['€100k', '€500k']);
    // The top of the range takes the last of the key's five shades.
    expect(s.of('€500k')).toMatchObject({ scale: 'sequential', at: 0.9, text: '€500k' });
    expect(s.of('€110k')).toMatchObject({ at: 0.1 });
    expect(s.legend).toHaveLength(5);
    const r = await render(example('e-commerce.yaml').replace('heat:', 'depth: 2\nheat:'), { fonts: 'none' });
    expect(r.graph!.nodes.some((n) => block(n).form === 'chip')).toBe(false);
  });

  it('lays out bands one under the other', async () => {
    const r = await render(example('retail-bank.yaml'), { fonts: 'none' });
    const ys = ['Channels', 'Customer', 'Products', 'Payments'].map((id) => r.placed!.nodes.get(id)!.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(new Set(['Channels', 'Customer'].map((id) => r.placed!.nodes.get(id)!.x)).size).toBe(1);
  });

  it('fits every example on a 16:9 slide', async () => {
    for (const f of fs.readdirSync(new URL('../../../examples/capabilities/', import.meta.url))) {
      const r = await render(example(f), { fonts: 'none' });
      expect(r.width! / r.height!, f).toBeGreaterThan(1.3);
      expect(r.width! / r.height!, f).toBeLessThan(2.3);
    }
  });

  it('draws about 300 capabilities on one slide in good time', async () => {
    const text = bigMap();
    await render(text, { fonts: 'none' });
    const t0 = performance.now();
    const r = await render(text, { fonts: 'none' });
    expect(r.graph!.nodes.length).toBeGreaterThan(280);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(r.width! / r.height!).toBeGreaterThan(1.3);
    expect(r.width! / r.height!).toBeLessThan(2.3);
  });

  it('keeps the map in place when a chip is added, knowing the drawing before', async () => {
    const text = example('enterprise.yaml');
    const before = await render(text, { fonts: 'none' });
    const after = await render(text.replace('          - Loyalty: { maturity: 1, investment: invest }\n', '          - Loyalty: { maturity: 1, investment: invest }\n          - Referrals: { maturity: 2 }\n'), { fonts: 'none', previous: before.placed!.memory });
    expect(after.graph!.nodes.length).toBe(before.graph!.nodes.length + 1);
    expect(after.placed!.memory!.variant).toBe(before.placed!.memory!.variant);
    const was = before.placed!.memory!.nodes!;
    const now = after.placed!.memory!.nodes!;
    const far = [...was].filter(([id, p]) => Math.hypot(now.get(id)!.x - p.x, now.get(id)!.y - p.y) > 16);
    expect(far.length / was.size).toBeLessThan(0.2);
  });

  it('follows renames through parent:', () => {
    expect(capabilityReferences({ type: 'capabilities', capabilities: { A: null, B: { parent: 'A' } } })).toEqual([{ path: ['capabilities', 'B', 'parent'], id: 'A', start: 0, collection: 'capabilities', onDelete: 'key' }]);
  });

});
