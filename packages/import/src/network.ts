// Network inventories → a `type: network` diagram.
//
//   CSV or YAML/JSON rows:  name,type,ip,zone,uplink   (optional: model, vlan, cidr, tier, speed, label)
//     fw01,firewall,10.0.0.1,dmz,isp
//     core01,switch,10.0.1.2,lan,fw01:port2       ← "device:port" names the port at the upstream end
//   NetBox export (JSON): { devices, cables?, ip_addresses? }, each a list or an API
//   page ({ results: [...] }). Devices group by site; cables between interfaces become links.
//
// Types and zones are matched by their words ("Core switch" → l3-switch, "DMZ" → dmz), so an export
// from a spreadsheet or a CMDB reads without a mapping table.
import { parse } from 'yaml';
import { Ids, scalar, Warnings } from './text.ts';
import type { Imported } from './index.ts';

type Obj = Record<string, any>;

interface Device {
  id: string;
  kind: string;
  label?: string;
  zone?: string;
  ip?: string;
  model?: string;
  vlan?: string;
  tier?: string;
  interfaces: [string, string][];
}

interface Link {
  from: string;
  to: string;
  /** The port at each end, or only the upstream one. */
  ports?: string[];
  speed?: string;
}

// First match wins: the more specific words come first ("core switch" before "switch").
const KINDS: [RegExp, string][] = [
  [/\b(waf|web application firewall)\b/, 'waf'],
  [/\b(ids|ips|intrusion)\b/, 'ids'],
  [/firewall|\bfw\b|\bngfw\b|\butm\b/, 'firewall'],
  [/vpn/, 'vpn-gateway'],
  [/expressroute|direct ?connect|interconnect|transit/, 'cloud-gateway'],
  [/\bnat\b/, 'nat'],
  [/load ?balancer|\blb\b|\badc\b/, 'load-balancer'],
  [/proxy/, 'proxy'],
  [/\b(dns|dhcp|resolver)\b/, 'dns'],
  [/router|\brtr\b|\bcpe\b/, 'router'],
  [/core|distribution|\bl3\b|layer ?3|multilayer/, 'l3-switch'],
  [/switch|\bsw\b/, 'switch'],
  [/access ?point|\bap\b|wireless|wifi|wlan/, 'access-point'],
  [/\b(nas|file server|backup)\b/, 'nas'],
  [/storage|\bsan\b|array/, 'storage'],
  [/\b(isp|carrier|provider|uplink)\b/, 'isp'],
  [/internet/, 'internet'],
  [/phone|voip/, 'phone'],
  [/printer|\bmfp\b/, 'printer'],
  [/camera|cctv/, 'camera'],
  [/client|workstation|desktop|laptop|\bpc\b/, 'client'],
  [/server|host|\bvm\b|hypervisor|esx/, 'server'],
];

/** A network kind from a type or role name; servers when nothing matches. */
export function networkKind(type: string | undefined): string {
  const t = (type ?? '').toLowerCase().replace(/[-_]+/g, ' ');
  return KINDS.find(([re]) => re.test(t))?.[1] ?? 'server';
}

function zoneKind(name: string): string {
  const t = name.toLowerCase();
  if (/dmz|perimeter/.test(t)) return 'dmz';
  if (/internet|public/.test(t)) return 'internet';
  if (/\bwan\b|mpls/.test(t)) return 'wan';
  if (/vlan/.test(t)) return 'vlan';
  if (/subnet/.test(t)) return 'subnet';
  if (/\bvpc\b/.test(t)) return 'vpc';
  if (/vnet/.test(t)) return 'vnet';
  if (/\blan\b/.test(t)) return 'lan';
  return 'zone';
}

/** Whether a text looks like an inventory this importer reads: CSV with a name column, or NetBox JSON. */
export function isNetworkInventory(text: string): boolean {
  const first = text.trimStart().split('\n')[0] ?? '';
  if (/^\s*"?name"?\s*[,;\t]/i.test(first) && /[,;\t]\s*"?(type|role|kind)"?\b/i.test(first)) return true;
  try {
    const o = JSON.parse(text);
    return !!o && typeof o === 'object' && 'devices' in o;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- CSV

/** Rows of a CSV (comma, semicolon or tab, quotes allowed) as objects keyed by the lower-cased header. */
export function parseCsv(text: string): Obj[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() && !l.trimStart().startsWith('#'));
  if (!lines.length) return [];
  const sep = [',', ';', '\t'].map((s) => [s, lines[0]!.split(s).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const cells = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (quoted && c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') quoted = !quoted;
      else if (c === sep && !quoted) out.push(cur.trim()), (cur = '');
      else cur += c;
    }
    out.push(cur.trim());
    return out;
  };
  const head = cells(lines[0]!).map((h) => h.toLowerCase());
  return lines.slice(1).map((l) => Object.fromEntries(cells(l).map((v, i) => [head[i] ?? `col${i}`, v]).filter(([, v]) => v !== '')));
}

function fromRows(rows: Obj[], warn: Warnings): { devices: Device[]; links: Link[]; zones: Map<string, Obj> } {
  const ids = new Ids();
  const devices: Device[] = [];
  const links: Link[] = [];
  const zones = new Map<string, Obj>();
  for (const [i, r] of rows.entries()) {
    const name = String(r.name ?? r.hostname ?? r.device ?? '').trim();
    if (!name) {
      warn.add(`Row ${i + 1} has no name; skipped`);
      continue;
    }
    const zone = r.zone ?? r.segment ?? r.vlan_name ?? r.site;
    if (zone) {
      const z = zones.get(String(zone)) ?? {};
      if (r.cidr && !z.cidr) z.cidr = String(r.cidr);
      zones.set(String(zone), z);
    }
    devices.push({
      id: ids.get(name),
      kind: networkKind(r.type ?? r.role ?? r.kind),
      label: r.label,
      zone: zone ? String(zone) : undefined,
      ip: r.ip ?? r.address ?? r.ip_address,
      model: r.model,
      vlan: r.vlan != null ? String(r.vlan) : undefined,
      tier: r.tier,
      interfaces: [],
    });
    for (const up of String(r.uplink ?? r.uplinks ?? '').split(/[|\s]+/).filter(Boolean)) {
      const [dev, port] = up.split(':');
      links.push({ from: dev!, to: name, ...(port ? { ports: [port] } : {}), speed: r.speed });
    }
  }
  // Uplinks name devices by their name; ids may differ.
  for (const l of links) {
    if (!ids.has(l.from)) warn.add(`Uplink "${l.from}" of ${l.to} is not in the inventory; link skipped`);
    l.from = ids.has(l.from) ? ids.get(l.from) : '';
    l.to = ids.get(l.to);
  }
  return { devices, links: links.filter((l) => l.from), zones };
}

// ---------------------------------------------------------------- NetBox

const list = (v: unknown): Obj[] => (Array.isArray(v) ? v : v && typeof v === 'object' && Array.isArray((v as Obj).results) ? (v as Obj).results : []);
const nameOf = (v: unknown): string | undefined => (typeof v === 'string' ? v : v && typeof v === 'object' ? ((v as Obj).name ?? (v as Obj).display ?? (v as Obj).slug) : undefined);

function fromNetbox(o: Obj, warn: Warnings): { devices: Device[]; links: Link[]; zones: Map<string, Obj> } {
  const ids = new Ids();
  const byNetboxId = new Map<unknown, Device>();
  const byName = new Map<string, Device>();
  const zones = new Map<string, Obj>();
  for (const d of list(o.devices)) {
    const name = nameOf(d) ?? `device-${d.id}`;
    const site = nameOf(d.site);
    if (site) zones.set(site, { kind: 'site' });
    const role = nameOf(d.role) ?? nameOf(d.device_role);
    const type = d.device_type;
    const model = [nameOf(type?.manufacturer), type?.model ?? nameOf(type)].filter(Boolean).join(' ') || undefined;
    const dev: Device = { id: ids.get(name), kind: networkKind(`${role ?? ''} ${model ?? ''}`), zone: site, ip: nameOf(d.primary_ip4)?.split('/')[0] ?? d.primary_ip4?.address?.split('/')[0], model, interfaces: [] };
    byNetboxId.set(d.id, dev);
    byName.set(name, dev);
  }
  const deviceOf = (x: Obj | undefined) => (x ? (byNetboxId.get(x.id) ?? byName.get(nameOf(x) ?? '')) : undefined);
  for (const ip of list(o.ip_addresses)) {
    const obj = ip.assigned_object;
    const dev = deviceOf(obj?.device);
    if (dev && ip.address) dev.interfaces.push([nameOf(obj) ?? '', String(ip.address)]);
  }
  // A cable end: v4 lists terminations, v3 has one termination per side.
  const ends = (c: Obj, side: 'a' | 'b'): Obj | undefined => c[`${side}_terminations`]?.[0]?.object ?? c[`termination_${side}`];
  const links: Link[] = [];
  for (const c of list(o.cables)) {
    const [a, b] = [ends(c, 'a'), ends(c, 'b')];
    const [da, db] = [deviceOf(a?.device), deviceOf(b?.device)];
    if (!da || !db) {
      warn.onceFor('cable', 'Some cables end outside the exported devices (circuits, patch panels); they are left out');
      continue;
    }
    const ports = [nameOf(a), nameOf(b)].filter((p): p is string => !!p);
    links.push({ from: da.id, to: db.id, ...(ports.length === 2 ? { ports } : {}), speed: c.label || undefined });
  }
  if (!byNetboxId.size) warn.add('No devices found: export /api/dcim/devices/ as "devices"');
  return { devices: [...byNetboxId.values()], links, zones };
}

// ---------------------------------------------------------------- output

export function importNetwork(text: string, title = 'Network'): Imported {
  const warn = new Warnings();
  let data: { devices: Device[]; links: Link[]; zones: Map<string, Obj> };
  let parsed: unknown;
  try {
    // A CSV parses as one YAML string, so anything that is not a list or a map is read as CSV.
    parsed = parse(text);
  } catch {
    parsed = undefined;
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'devices' in parsed) data = fromNetbox(parsed as Obj, warn);
  else if (Array.isArray(parsed)) data = fromRows(parsed.filter((r) => r && typeof r === 'object'), warn);
  else data = fromRows(parseCsv(text), warn);
  if (!data.devices.length) return { yaml: '', warnings: [...warn.list, ...(warn.list.length ? [] : ['No devices found: expect columns name,type,ip,zone,uplink'])] };

  const zoneIds = new Ids();
  // A zone may not take a device's id: groups and nodes share one namespace.
  for (const d of data.devices) zoneIds.get(`\0${d.id}`, d.id);
  const out: string[] = ['type: network', `title: ${scalar(title)}`, ''];
  if (data.zones.size) {
    out.push('groups:');
    for (const [name, z] of data.zones) {
      const parts = [`kind: ${z.kind ?? zoneKind(name)}`, `label: ${scalar(name)}`, ...(z.cidr ? [`cidr: ${scalar(z.cidr)}`] : [])];
      out.push(`  ${zoneIds.get(name)}: { ${parts.join(', ')} }`);
    }
    out.push('');
  }
  out.push('nodes:');
  for (const d of data.devices) {
    const parts = [`kind: ${d.kind}`];
    if (d.label) parts.push(`label: ${scalar(d.label)}`);
    if (d.zone) parts.push(`in: ${zoneIds.get(d.zone)}`);
    if (d.model) parts.push(`model: ${scalar(d.model)}`);
    if (d.ip) parts.push(`ip: ${scalar(d.ip)}`);
    if (d.vlan) parts.push(`vlan: ${/^\d+$/.test(d.vlan) ? d.vlan : scalar(d.vlan)}`);
    if (d.tier) parts.push(`tier: ${scalar(d.tier)}`);
    if (d.interfaces.length) parts.push(`interfaces: { ${d.interfaces.map(([n, ip]) => `${scalar(n || 'ip')}: ${scalar(ip)}`).join(', ')} }`);
    out.push(`  ${d.id}: { ${parts.join(', ')} }`);
  }
  if (data.links.length) {
    out.push('', 'edges:');
    for (const l of data.links) {
      const props = [...(l.speed ? [`speed: ${scalar(String(l.speed))}`] : []), ...(l.ports?.length ? [`ports: ${l.ports.length > 1 ? `[${l.ports.map(scalar).join(', ')}]` : scalar(l.ports[0]!)}`] : [])];
      out.push(`  - ${l.from} -- ${l.to}${props.length ? `: { ${props.join(', ')} }` : ''}`);
    }
  }
  return { yaml: out.join('\n') + '\n', warnings: warn.list };
}
