import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { render } from '@cartography/engine';
import { importNetwork, isNetworkInventory, networkKind } from '../src/index.ts';

async function imported(text: string) {
  const r = importNetwork(text, 'Test');
  const check = await render(r.yaml, { fonts: 'none' });
  expect(check.diagnostics).toEqual([]);
  return { ...r, doc: parse(r.yaml), graph: check.graph! };
}

const csv = `name,type,ip,zone,uplink,model
isp,ISP,,Internet,,
fw01,Firewall,10.0.0.1,DMZ,isp,FortiGate 60F
core01,Core switch,10.0.1.2,LAN,fw01:port2,
ap-1,Access point,10.0.1.11,LAN,core01,
"web, 01",server,10.0.0.10,DMZ,fw01,
`;

describe('importNetwork', () => {
  it('tells inventories from other files', () => {
    expect(isNetworkInventory(csv)).toBe(true);
    expect(isNetworkInventory('{"devices": {"results": []}}')).toBe(true);
    expect(isNetworkInventory('type: network\nnodes: {}\n')).toBe(false);
    expect(isNetworkInventory('flowchart LR\n  a --> b\n')).toBe(false);
  });

  it('guesses kinds from type and role words', () => {
    expect(['Core switch', 'access-switch', 'PA-3420 firewall', 'Wireless AP', 'ESXi host', 'WAF', 'edge router', 'unknown'].map(networkKind)).toEqual([
      'l3-switch', 'switch', 'firewall', 'access-point', 'server', 'waf', 'router', 'server',
    ]);
  });

  it('reads a CSV inventory: zones become groups, uplinks become links', async () => {
    const { doc, warnings, graph } = await imported(csv);
    expect(warnings).toEqual([]);
    expect(doc.groups).toEqual({
      Internet: { kind: 'internet', label: 'Internet' },
      DMZ: { kind: 'dmz', label: 'DMZ' },
      LAN: { kind: 'lan', label: 'LAN' },
    });
    expect(doc.nodes.fw01).toEqual({ kind: 'firewall', in: 'DMZ', model: 'FortiGate 60F', ip: '10.0.0.1' });
    expect(doc.nodes['web-01']).toMatchObject({ kind: 'server', in: 'DMZ' });
    expect(doc.edges).toEqual(['isp -- fw01', { 'fw01 -- core01': { ports: 'port2' } }, 'core01 -- ap-1', 'fw01 -- web-01']);
    expect(graph.direction).toBe('down');
  });

  it('reads YAML rows and warns about unknown uplinks', async () => {
    const r = importNetwork('- { name: a, type: router, zone: wan }\n- { name: b, type: switch, uplink: a }\n- { name: c, type: switch, uplink: zz }\n');
    expect(r.warnings).toEqual(['Uplink "zz" of c is not in the inventory; link skipped']);
    expect(parse(r.yaml).edges).toEqual(['a -- b']);
  });

  it('reads a NetBox export: devices by site, cables between interfaces, IPs per interface', async () => {
    const netbox = {
      devices: {
        results: [
          { id: 1, name: 'fw-ams', role: { name: 'Firewall' }, device_type: { model: 'PA-3420', manufacturer: { name: 'Palo Alto' } }, site: { name: 'Amsterdam' }, primary_ip4: { address: '10.0.0.1/24' } },
          { id: 2, name: 'core-ams', role: { name: 'Core' }, device_type: { model: 'Nexus 93180' }, site: { name: 'Amsterdam' } },
        ],
      },
      ip_addresses: [{ address: '10.0.0.2/24', assigned_object: { name: 'mgmt0', device: { id: 2, name: 'core-ams' } } }],
      cables: [
        { label: '10G', a_terminations: [{ object: { name: 'ethernet1/1', device: { id: 1 } } }], b_terminations: [{ object: { name: 'Eth1/49', device: { id: 2 } } }] },
        { termination_a: { name: 'xe-0/0/0', device: { id: 9 } }, termination_b: { name: 'Eth1/1', device: { id: 2 } } },
      ],
    };
    const { doc, warnings } = await imported(JSON.stringify(netbox));
    expect(warnings).toEqual(['Some cables end outside the exported devices (circuits, patch panels); they are left out']);
    expect(doc.groups).toEqual({ Amsterdam: { kind: 'site', label: 'Amsterdam' } });
    expect(doc.nodes['fw-ams']).toEqual({ kind: 'firewall', in: 'Amsterdam', model: 'Palo Alto PA-3420', ip: '10.0.0.1' });
    expect(doc.nodes['core-ams']).toMatchObject({ kind: 'l3-switch', interfaces: { mgmt0: '10.0.0.2/24' } });
    expect(doc.edges).toEqual([{ 'fw-ams -- core-ams': { speed: '10G', ports: ['ethernet1/1', 'Eth1/49'] } }]);
  });

  it('says what it expects when there is nothing to import', () => {
    expect(importNetwork('name,type\n').warnings).toEqual(['No devices found: expect columns name,type,ip,zone,uplink']);
  });
});
