import { describe, expect, it } from 'vitest';
import { render } from '@linework/engine';
import { contextMap } from '../src/index.ts';

describe('context map', () => {
  it('draws upstream and downstream ends with their patterns, and names symmetric relations on the line', async () => {
    const r = await render(contextMap.template, { fonts: 'none' });
    expect(r.diagnostics).toEqual([]);
    const edge = (from: string, to: string) => r.graph!.edges.find((e) => e.from.node === from && e.to.node === to)!;
    expect(edge('catalog', 'ordering')).toMatchObject({ ends: { from: ['U', 'OHS', 'PL'], to: ['D'] }, label: 'Customer/Supplier', end: 'none' });
    expect(edge('warehouse', 'shipping').ends).toEqual({ from: ['U'], to: ['D', 'ACL'] });
    expect(edge('payments', 'billing').ends).toEqual({ from: ['U'], to: ['D', 'CF'] });
    expect(edge('pricing', 'ordering').label).toBe('Partnership');
    expect(edge('pricing', 'ordering').ends).toBeUndefined();
    expect(r.graph!.nodes.find((n) => n.id === 'ordering')!.shape).toMatchObject({ caption: 'Core domain', tone: 'violet' });
    expect(r.graph!.legend!.map((l) => l.tag ?? l.label)).toEqual(['U', 'D', 'OHS', 'PL', 'ACL', 'CF', 'Core domain', 'Supporting subdomain', 'Generic subdomain']);
    expect(r.svg).toContain('>ACL<');
  });

  it('takes the short names of Context Mapper and draws separate ways dotted', async () => {
    const r = await render(
      `type: context-map
nodes: { a: context, b: context, c: context }
edges:
  - a -> b: { relation: acl }
  - a -- c: { relation: separate-ways }
  - b -> c: { relation: sk, label: Money types }
`,
      { fonts: 'none' },
    );
    expect(r.diagnostics).toEqual([]);
    const [acl, ways, sk] = r.graph!.edges;
    expect(acl!.ends).toEqual({ from: ['U'], to: ['D', 'ACL'] });
    expect(ways).toMatchObject({ line: 'dotted', label: 'Separate ways' });
    expect(sk).toMatchObject({ label: 'Shared kernel: Money types', width: 1.6 });
  });
});
