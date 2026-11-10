import { describe, expect, it } from 'vitest';
import { icon } from '@cartography/icons';
import { matchTypes } from '@cartography/core';
import { render, types } from '@cartography/engine';
import { config, network, range, vlanList } from '../src/index.ts';

const office = `type: network
groups:
  internet: internet
  office: { kind: site, label: Office, cidr: 10.0.0.0/16 }
  staff: { kind: vlan, label: Staff, in: office, vlan: 10, cidr: 10.0.10.0/24 }
nodes:
  isp: { kind: isp, in: internet }
  core: { kind: switch, in: office, model: USW Pro 24, ip: 10.0.0.2, tier: core }
  fw: { kind: firewall, in: office, model: FortiGate 60F, ha: true, ip: 10.0.0.1, tier: edge }
  ap: { kind: access-point, in: staff, interfaces: { eth0: 10.0.10.11/24, mgmt: { ip: 10.0.0.11/24, zone: office, vlan: 1 } } }
edges:
  - core -- fw: { style: trunk, speed: 10G, count: 2, vlans: [10, 11, 12, 20] }
  - fw -- isp: { style: wan, speed: 1G }
  - core -- ap
  - ap -> core: { flow: true, label: telemetry }
  - fw -- core: { style: vpn }
`;

describe('network', () => {
  it('has an icon for every kind and is registered', () => {
    for (const [kind, k] of Object.entries({ ...config.nodeKinds, ...config.groupKinds })) expect(icon(k.icon), kind).toBeDefined();
    expect(types).toContain(network);
  });

  it('renders the template cleanly', async () => {
    const r = await render(network.template, { fonts: 'none' });
    expect(r.diagnostics).toEqual([]);
    expect(r.graph!.direction).toBe('down');
  });

  it('names devices by id, puts model, IP and HA in the caption and stacks HA pairs', async () => {
    const r = await render(office, { fonts: 'none' });
    expect(r.diagnostics).toEqual([]);
    const node = (id: string) => r.graph!.nodes.find((n) => n.id === id)!;
    expect(node('fw').shape).toMatchObject({ label: 'fw', caption: 'FortiGate 60F · 10.0.0.1 · HA pair', stack: true });
    expect(node('core').shape).toMatchObject({ caption: 'USW Pro 24 · 10.0.0.2' });
    expect(node('isp').shape).toMatchObject({ label: 'isp', caption: undefined });
    expect(r.graph!.groups.find((g) => g.id === 'staff')).toMatchObject({ caption: 'VLAN 10 · 10.0.10.0/24' });
    expect(r.graph!.groups.find((g) => g.id === 'internet')).toMatchObject({ label: 'Internet' });
  });

  it('turns links down the tiers, without arrowheads unless they are a flow', async () => {
    const r = await render(office, { fonts: 'none' });
    const [trunk, wan, plain, flow, vpn] = r.graph!.edges;
    expect([trunk!.from.node, trunk!.to.node]).toEqual(['fw', 'core']);
    expect([wan!.from.node, wan!.to.node]).toEqual(['isp', 'fw']);
    expect([plain!.start, plain!.end]).toEqual(['none', 'none']);
    expect([flow!.from.node, flow!.start, flow!.end]).toEqual(['ap', 'none', 'arrow']);
    expect(trunk).toMatchObject({ label: '2×10G · VLAN 10–12, 20', width: 2.2, tone: 'indigo' });
    expect(vpn).toMatchObject({ label: 'VPN', icon: 'lock', line: 'dashed' });
    expect(r.graph!.nodes.find((n) => n.id === 'fw')!.rank).toBe(1);
    expect(r.graph!.legend!.find((l) => l.label === 'Trunk')).toMatchObject({ width: 2 });
  });

  it('lines up tiers top-down', async () => {
    // As placed, not wrapped for a slide (that stands the internet beside the office).
    const r = await render(office, { fonts: 'none', tuning: { wrap: false } });
    const y = (id: string) => r.placed!.nodes.get(id)!.y;
    expect(y('isp')).toBeLessThan(y('fw'));
    expect(y('fw')).toBeLessThan(y('core'));
  });

  it('draws the same file as an IP table', async () => {
    const r = await render(office.replace('type: network', 'type: network\nview: table'), { fonts: 'none' });
    expect(r.diagnostics).toEqual([]);
    const shape = r.graph!.nodes[0]!.shape;
    if (shape.kind !== 'matrix') throw new Error('expected a table');
    expect(shape.plain).toBe(true);
    expect(shape.columns.map((c) => c.label)).toEqual(['Interface', 'IP address', 'VLAN', 'Zone']);
    expect(shape.rows.map((r) => r.label)).toEqual(['core', 'fw', 'ap', '']);
    expect(shape.cells[2]!.map((c) => c?.text)).toEqual(['eth0', '10.0.10.11/24', '10', 'Staff']);
    expect(shape.cells[3]!.map((c) => c?.text)).toEqual(['mgmt', '10.0.0.11/24', '1', 'Office']);
    expect(r.svg).toContain('10.0.10.11/24');
  });

  it('warns about overlapping zones and addresses outside their zone', async () => {
    const text = `type: network
groups:
  a: { kind: vlan, cidr: 10.0.1.0/24 }
  b: { kind: vlan, cidr: 10.0.1.128/25 }
  c: { kind: lan, cidr: 10.1.0.0/16 }
  d: { kind: subnet, in: c, cidr: 10.2.0.0/24 }
nodes:
  s: { kind: server, in: a, ip: 10.0.2.5 }
`;
    const r = await render(text, { fonts: 'none' });
    const messages = r.diagnostics.map((d) => [d.severity, d.message]);
    expect(messages).toEqual([
      ['warning', '10.0.1.128/25 overlaps 10.0.1.0/24 of "a"'],
      ['warning', '10.2.0.0/24 is outside 10.1.0.0/16 of "c"'],
      ['warning', '10.0.2.5 is outside 10.0.1.0/24 of "a"'],
    ]);
  });

  it('formats VLAN lists and prefixes', () => {
    expect(vlanList([10, 11, 12, 20, 30, 31])).toBe('10–12, 20, 30, 31');
    expect(vlanList('100-200')).toBe('100-200');
    expect(range('10.0.0.0/24')).toEqual([167772160, 167772415]);
    expect(range('10.0.0.300')).toBeUndefined();
  });

  it('is what people find for network words', () => {
    for (const q of ['network', 'vlan', 'firewall', 'topology', 'network topology with vlans'])
      expect(matchTypes(q, types)[0]!.type.id, q).toBe('network');
  });

  it('connects with a plain link', () => {
    expect(network.connect!({ nodes: { a: 'router', b: 'switch' } }, 'a', 'b')).toEqual({ path: ['edges'], value: 'a -- b' });
  });
});
