import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { findType, render } from '@cartography/engine';
import { blockText, checkBlock, checkValues, findInstances, gather, idPrefix, insertBlock, labelChoices, outdated, parseBlock, readBlocks, updateInstance, type Block } from '../src/index.ts';

const dir = new URL('../../../examples/blocks/', import.meta.url);
const starters = fs.readdirSync(dir).filter((f) => f.endsWith('.block.yaml'));
const starter = (name: string) => parseBlock(fs.readFileSync(new URL(`${name}.block.yaml`, dir), 'utf8'), name).block!;
const azure = findType('azure')!;
const ok = <T extends object>(r: T | { error: string }): T => {
  if ('error' in r) throw new Error(r.error);
  return r;
};

describe('starter blocks', () => {
  it('ships the five', () => expect(starters.sort()).toEqual(['aws-three-tier.block.yaml', 'azure-app-stack.block.yaml', 'azure-hub.block.yaml', 'c4-web-api-db.block.yaml', 'k8s-namespace.block.yaml']));
  for (const f of starters)
    it(`${f} keeps the fragment rules and draws without problems`, async () => {
      const [l] = readBlocks([[f, fs.readFileSync(new URL(f, dir), 'utf8')]], 'starter', findType);
      expect(l!.problems).toEqual([]);
      const b = l!.block!;
      expect(b.params.length).toBeGreaterThan(0);
      const r = await render(`type: ${b.type}\n${b.type === 'cloud' ? 'provider: aws\n' : ''}title: Empty\n`, { fonts: 'none' });
      expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      const ins = ok(insertBlock(`type: ${b.type}\ntitle: T\n`, findType(b.type)!, b));
      const drawn = await render(ins.text, { fonts: 'none' });
      expect(drawn.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(drawn.graph!.nodes.length).toBeGreaterThan(1);
    });
});

describe('fragment rules', () => {
  const block = (text: string) => parseBlock(text, 'x').block!;
  it('an undeclared parameter, an unused one and a line to outside are problems', () => {
    const b = block('type: azure\nparams: { a: { default: x }, b: { default: y } }\nnodes:\n  ${a}-web: app-service\n  ${c}-db: sql-database\nedges:\n  - x-web -> outside\n');
    const msgs = checkBlock(b, azure).map((p) => `${p.severity}: ${p.message}`);
    expect(msgs.some((m) => m.startsWith('error: ${c} is used but not declared'))).toBe(true);
    expect(msgs).toContain('warning: Parameter b is declared but not used');
    // ${c} stays as written: no valid id, so the schema says so before the line is looked at.
    expect(msgs.some((m) => m.startsWith('error: nodes'))).toBe(true);
  });
  it('a line to an entry outside the block is an error', () => {
    const b = block('type: azure\nnodes:\n  web: app-service\nedges:\n  - web -> outside\n');
    expect(checkBlock(b, azure).filter((p) => p.severity === 'error').length).toBeGreaterThan(0);
  });
  it('a parameter in an id must be an id', () => {
    const b = starter('azure-hub');
    expect(checkValues(b, { name: 'my hub' })).toEqual({ name: 'Part of an id: letters, digits, - and _ only' });
    expect(checkValues(b, { name: 'hub-2', cidr: '10.1.0.0/16 and more' })).toEqual({});
  });
  it('the hash follows the fragment, not the title or comments', () => {
    const a = starter('azure-hub');
    const b = parseBlock(a.text.replace('title: Azure hub', 'title: The hub').replace(/^#.*\n/gm, ''), 'azure-hub').block!;
    const c = parseBlock(a.text.replace('afw-${name}', 'fw-${name}'), 'azure-hub').block!;
    expect(b.hash).toBe(a.hash);
    expect(c.hash).not.toBe(a.hash);
  });
});

const DIAGRAM = `type: azure
title: Shop

groups:
  sub: { kind: subscription, label: Online shop }

nodes:
  # Ours, by hand.
  users: { kind: users, label: Customers }

edges:
  - users -> users
`;

describe('insert', () => {
  const hub = starter('azure-hub');
  it('fills in parameters, keeps the file as it was around it, marks every entry', () => {
    const r = ok(insertBlock(DIAGRAM, azure, hub, { values: { name: 'core', cidr: '10.9.0.0/16' } }));
    expect(r.text.startsWith(DIAGRAM.split('\nedges:')[0]!.split('\nnodes:')[0]!)).toBe(true);
    expect(r.text).toContain('  # Ours, by hand.\n  users: { kind: users, label: Customers }\n');
    expect(r.text).toContain('  core-fw: { kind: firewall, label: afw-core, in: core-fw-snet } # from block: azure-hub@' + hub.hash + ' #1 name=core cidr=10.9.0.0/16');
    expect(r.text).toContain('  - core-vpn -> core-fw: { style: private } # from block:');
    const data = parse(r.text);
    expect(data.groups.core.label).toBe('vnet-core · 10.9.0.0/16');
    expect(r.instance).toMatchObject({ block: 'azure-hub', no: 1, params: { name: 'core', cidr: '10.9.0.0/16' } });
    expect(findInstances(r.text)).toEqual([r.instance]);
  });
  it('a second time: the next instance number, and one suffix for all ids that are taken', () => {
    const one = ok(insertBlock(DIAGRAM, azure, hub));
    const two = ok(insertBlock(one.text, azure, hub));
    expect([...two.ids.values()]).toEqual(['hub-2', 'hub-fw-snet-2', 'hub-bastion-snet-2', 'hub-gw-snet-2', 'hub-fw-2', 'hub-bastion-2', 'hub-vpn-2', 'hub-logs-2']);
    const data = parse(two.text);
    expect(data.nodes['hub-fw-2'].in).toBe('hub-fw-snet-2');
    expect(data.edges).toContainEqual({ 'hub-vpn-2 -> hub-fw-2': { style: 'private' } });
    expect(findInstances(two.text).map((i) => i.no)).toEqual([1, 2]);
  });
  it('into a group: the top-level entries go in, the rest stay where the block put them', () => {
    const r = ok(insertBlock(DIAGRAM, azure, hub, { into: { collection: 'groups', id: 'sub' } }));
    const data = parse(r.text);
    expect(data.groups.hub.in).toBe('sub');
    expect(data.groups['hub-fw-snet'].in).toBe('hub');
  });
  it('pins come back by the ids in the diagram', () => {
    const b = parseBlock(hub.text + 'pins:\n  nodes:\n    ${name}-fw: { x: 10, y: 20 }\n', 'azure-hub').block!;
    const one = ok(insertBlock(DIAGRAM, azure, b));
    const two = ok(insertBlock(one.text, azure, b));
    expect(two.pins.nodes).toEqual({ 'hub-fw-2': { x: 10, y: 20 } });
  });
  it('refuses a block of another type', () => expect(insertBlock(DIAGRAM, azure, starter('k8s-namespace'))).toEqual({ error: expect.stringContaining('kubernetes') }));
});

describe('update instances', () => {
  const hub = starter('azure-hub');
  const newer = parseBlock(hub.text.replace('  ${name}-logs: { kind: log-analytics, label: "log-${name}", in: "${name}" }\n', '  ${name}-logs: { kind: log-analytics, label: "logs-${name}", in: "${name}" }\n  ${name}-dns: { kind: dns, label: private dns, in: "${name}" }\n').replace('  ${name}-vpn: { kind: vpn-gateway, label: "vgw-${name}", in: "${name}-gw-snet" }\n', '').replace('  - ${name}-vpn -> ${name}-fw: { style: private }\n', ''), 'azure-hub').block!;
  it('says which instances are behind', () => {
    const r = ok(insertBlock(DIAGRAM, azure, hub, { into: { collection: 'groups', id: 'sub' } }));
    expect(outdated(r.text, new Map([['azure-hub', hub]]))).toEqual([]);
    expect(outdated(r.text, new Map([['azure-hub', newer]])).map((i) => i.no)).toEqual([1]);
  });
  it('replaces the instance in place: same ids and suffix, same group, same parameters; lines from outside stay', () => {
    let text = ok(insertBlock(DIAGRAM, azure, hub)).text;
    text = ok(insertBlock(text, azure, hub, { values: { name: 'hub' }, into: { collection: 'groups', id: 'sub' } })).text;
    text = text.replace('  - users -> users\n', '  - users -> users\n  - users -> hub-vpn-2\n  - users -> hub-fw-2\n');
    const inst = findInstances(text).find((i) => i.no === 2)!;
    const u = ok(updateInstance(text, azure, newer, inst));
    expect(u.removed).toEqual(['hub-vpn-2']);
    expect(u.added).toEqual(['hub-dns-2']);
    expect(u.dangling).toBe(1);
    const data = parse(u.text);
    expect(data.groups['hub-2'].in).toBe('sub');
    expect(data.nodes['hub-logs-2'].label).toBe('logs-hub');
    expect(data.nodes['hub-logs'].label).toBe('log-hub');
    expect(data.nodes['hub-vpn']).toBeDefined();
    expect(data.edges).toContain('users -> hub-fw-2');
    const after = findInstances(u.text);
    expect(after.map((i) => [i.no, i.hash])).toEqual([
      [1, hub.hash],
      [2, newer.hash],
    ]);
    // Instance #1 is untouched.
    expect(u.text.split('\n').filter((l) => l.includes(`#1 name=hub`)).length).toBe(text.split('\n').filter((l) => l.includes(`#1 name=hub`)).length);
  });
});

describe('save as block', () => {
  const text = fs.readFileSync(new URL('../../../examples/azure/hub-spoke.yaml', import.meta.url), 'utf8');
  const data = parse(text);
  it('takes the groups a selection sits in, what a selected group holds, and the lines between', () => {
    const s = gather(data, azure, [['groups', 'spoke']]);
    expect(s.entries.map((e) => e.id).sort()).toEqual(['agw', 'app', 'apps', 'data', 'pe', 'spoke', 'sql', 'web']);
    expect(s.items.map((i) => JSON.stringify(i.value))).toEqual(['{"agw -> apps":{"style":"public"}}', '{"apps -> pe":{"label":"SQL","style":"private"}}', '{"pe -> sql":{"style":"private"}}']);
    expect(s.cut).toEqual([]);
  });
  it('a node alone comes with its groups; a field naming what stays behind is cut', () => {
    const s = gather(data, azure, [['nodes', 'fw'], ['nodes', 'vpn']]);
    expect(s.entries.map((e) => e.id).sort()).toEqual(['conn', 'fw', 'hub', 'vpn']);
    const s2 = gather({ ...data, groups: { ...data.groups, hub: { kind: 'vnet', in: 'conn' } } }, azure, [['groups', 'hub']]);
    expect(s2.entries.find((e) => e.id === 'hub')).toBeDefined();
  });
  it('suggests the shared start of the ids as ${name}, writes a block that inserts back the same', () => {
    const shop = `type: azure\ntitle: S\ngroups:\n  shop-snet: { kind: subnet, label: snet-shop }\nnodes:\n  shop-app: { kind: app-service, label: Shop, in: shop-snet }\n  shop-db: { kind: sql-database, label: Shop DB, in: shop-snet }\nedges:\n  - shop-app -> shop-db: SQL\n`;
    const d = parse(shop);
    const s = gather(d, azure, [['nodes', 'shop-app'], ['nodes', 'shop-db']]);
    const prefix = idPrefix(s.entries.map((e) => e.id));
    expect(prefix).toBe('shop');
    const labels = labelChoices(s, prefix);
    expect(labels.map((l) => [l.id, l.param, l.suggested])).toEqual([
      ['shop-snet', 'snet-label', true],
      ['shop-app', 'app-label', true],
      ['shop-db', 'db-label', true],
    ]);
    const out = blockText(azure, s, { name: 'shop-stack', title: 'Shop stack', tags: ['app'], prefix, labels: labels.filter((l) => l.id === 'shop-app'), positions: { nodes: { 'shop-app': { x: 100, y: 50 }, 'shop-db': { x: 300, y: 50 } } } });
    expect(out.text).toContain('  ${name}-app: { kind: app-service, label: "${app-label}", in: "${name}-snet" }');
    expect(out.text).toContain('  - ${name}-app -> ${name}-db: SQL');
    expect(out.text).toContain('label: "snet-${name}"');
    expect(out.text).toContain('${name}-db: { x: 200, y: 0 }');
    const b: Block = out.block;
    expect(checkBlock(b, azure)).toEqual([]);
    const back = ok(insertBlock('type: azure\ntitle: T\n', azure, b, { values: { name: 'pay', 'app-label': 'Payments' } }));
    const dd = parse(back.text);
    expect(dd.nodes['pay-app']).toEqual({ kind: 'app-service', label: 'Payments', in: 'pay-snet' });
    expect(dd.groups['pay-snet'].label).toBe('snet-pay');
    expect(back.pins.nodes).toEqual({ 'pay-app': { x: 0, y: 0 }, 'pay-db': { x: 200, y: 0 } });
  });
});
