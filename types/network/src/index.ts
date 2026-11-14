// Network topology: zones and segments as groups (with their CIDR and VLAN), devices as cards, links
// as plain lines. Drawn top-down from the internet to the endpoints, the way network engineers draw.
//
//   groups:
//     office: { kind: site, label: Amsterdam }
//     staff: { kind: vlan, in: office, vlan: 10, cidr: 10.0.10.0/24 }
//   nodes:
//     fw: { kind: firewall, in: office, model: FortiGate 60F, ha: true, ip: 10.0.0.1 }
//     core: { kind: l3-switch, in: office, tier: core }
//   edges:
//     - isp -- fw: 1G
//     - fw -- core: { style: trunk, vlans: [10, 20], speed: 10G, count: 2 }   # "2×10G · VLAN 10, 20", thick
//
// Links have no arrowheads unless `flow: true` (or `<->`): a cable is not a direction. Lines are
// turned to run from the internet side down (by tier, else by kind), so dot layers them top-down.
// `view: table` draws the same file as an IP plan: device, interface, IP, VLAN, zone.
import {
  buildGraph,
  graphReferences,
  graphSchema,
  parseEdge,
  type BuildContext,
  type DiagramType,
  type Graph,
  type GraphSource,
  type GraphTypeConfig,
  type MatrixCell,
  type MatrixHeader,
  type PaletteItem,
} from '@linework/core';

export const config: GraphTypeConfig = {
  groupKinds: {
    internet: { label: 'Internet', icon: 'globe', tone: 'slate', border: 'dashed' },
    wan: { label: 'WAN', icon: 'earth', tone: 'slate', border: 'dashed', keywords: ['mpls', 'sd-wan'] },
    dmz: { label: 'DMZ', icon: 'brick-wall', tone: 'amber', keywords: ['perimeter', 'public'] },
    lan: { label: 'LAN', icon: 'network', tone: 'blue', keywords: ['internal', 'campus'] },
    vlan: { label: 'VLAN', icon: 'tag', tone: 'indigo', border: 'dashed', keywords: ['segment', '802.1q'] },
    zone: { label: 'Zone', icon: 'square-dashed', tone: 'slate', border: 'dashed', quiet: true, keywords: ['security zone', 'segment'] },
    site: { label: 'Site', icon: 'building', tone: 'slate', keywords: ['on-prem', 'office', 'hq', 'campus'] },
    branch: { label: 'Branch', icon: 'store', tone: 'slate', keywords: ['remote office', 'shop'] },
    datacenter: { label: 'Data centre', icon: 'warehouse', tone: 'slate', keywords: ['dc', 'colo', 'on-prem'] },
    region: { label: 'Cloud region', icon: 'cloud', tone: 'sky', border: 'dashed', keywords: ['aws', 'azure', 'gcp'] },
    vpc: { label: 'VPC', icon: 'waypoints', tone: 'sky', keywords: ['aws', 'gcp'] },
    vnet: { label: 'VNet', icon: 'waypoints', tone: 'sky', keywords: ['azure', 'virtual network', 'hub', 'spoke'] },
    subnet: { label: 'Subnet', icon: 'square-dashed', tone: 'sky', border: 'dashed' },
  },
  nodeKinds: {
    internet: { label: 'Internet', icon: 'globe', tone: 'slate', keywords: ['public', 'web'] },
    isp: { label: 'ISP', icon: 'radio-tower', tone: 'slate', keywords: ['uplink', 'carrier', 'provider'] },
    cloud: { label: 'Cloud service', icon: 'cloud', tone: 'sky', keywords: ['saas', 'external'] },
    users: { label: 'Users', icon: 'users', tone: 'slate', keywords: ['remote users', 'people'] },
    router: { label: 'Router', icon: 'router', tone: 'blue', keywords: ['edge', 'bgp', 'cpe'] },
    firewall: { label: 'Firewall', icon: 'brick-wall-fire', tone: 'rose', keywords: ['ngfw', 'utm', 'fortigate', 'palo alto'] },
    waf: { label: 'WAF', icon: 'brick-wall-shield', tone: 'rose', keywords: ['web application firewall'] },
    ids: { label: 'IDS/IPS', icon: 'radar', tone: 'rose', keywords: ['ips', 'intrusion', 'sensor'] },
    'vpn-gateway': { label: 'VPN gateway', icon: 'lock-keyhole', tone: 'teal', keywords: ['ipsec', 'wireguard', 'concentrator'] },
    'cloud-gateway': { label: 'Cloud gateway', icon: 'cable', tone: 'teal', keywords: ['expressroute', 'direct connect', 'interconnect', 'transit gateway'] },
    nat: { label: 'NAT gateway', icon: 'arrow-down-up', tone: 'teal', keywords: ['snat', 'egress'] },
    'load-balancer': { label: 'Load balancer', icon: 'split', tone: 'sky', keywords: ['lb', 'f5', 'haproxy', 'adc'] },
    proxy: { label: 'Proxy', icon: 'arrow-left-right', tone: 'violet', keywords: ['reverse proxy', 'web proxy', 'squid'] },
    dns: { label: 'DNS', icon: 'signpost', tone: 'violet', keywords: ['resolver', 'bind', 'dhcp'] },
    'l3-switch': { label: 'L3 switch', icon: 'network', tone: 'indigo', keywords: ['core switch', 'layer 3', 'multilayer'] },
    switch: { label: 'Switch', icon: 'network', tone: 'blue', keywords: ['access switch', 'layer 2', 'l2'] },
    'access-point': { label: 'Access point', icon: 'wifi', tone: 'sky', keywords: ['ap', 'wifi', 'wireless', 'wlan'] },
    server: { label: 'Server', icon: 'server', tone: 'slate', keywords: ['host', 'vm', 'hypervisor'] },
    nas: { label: 'NAS', icon: 'hard-drive', tone: 'green', keywords: ['file server', 'backup'] },
    storage: { label: 'Storage', icon: 'database', tone: 'green', keywords: ['san', 'array'] },
    client: { label: 'Client', icon: 'laptop', tone: 'slate', keywords: ['workstation', 'pc', 'laptop'] },
    clients: { label: 'Clients', icon: 'monitor', tone: 'slate', keywords: ['workstations', 'desktops'] },
    phone: { label: 'IP phone', icon: 'phone', tone: 'slate', keywords: ['voip', 'sip'] },
    printer: { label: 'Printer', icon: 'printer', tone: 'slate', keywords: ['mfp'] },
    camera: { label: 'Camera', icon: 'cctv', tone: 'slate', keywords: ['cctv', 'iot'] },
  },
  edgeStyles: {
    ethernet: { label: 'Ethernet', line: 'solid' },
    fiber: { label: 'Fibre', line: 'solid', tone: 'orange' },
    trunk: { label: 'Trunk', line: 'solid', tone: 'indigo', pattern: 'double' },
    wan: { label: 'WAN', line: 'solid', tone: 'sky' },
    circuit: { label: 'Private circuit', line: 'solid', tone: 'teal' },
    vpn: { label: 'VPN tunnel', line: 'dashed', tone: 'teal' },
    peering: { label: 'Peering', line: 'dashed', tone: 'blue' },
    wireless: { label: 'Wireless', line: 'dotted', tone: 'sky' },
    ha: { label: 'HA link', line: 'dotted', tone: 'amber' },
    mgmt: { label: 'Management', line: 'dotted', tone: 'slate' },
  },
  plainEdge: 'Ethernet',
  // Shared-model kinds as the device that usually stands for them.
  kindAliases: { person: 'users', client: 'client', server: 'server', service: 'server', database: 'storage', storage: 'nas', gateway: 'router', cdn: 'cloud', system: 'zone' },
};

/** Line weight and label icon per style, on top of what buildGraph knows. */
const STYLE_EXTRA: Record<string, { width?: number; icon?: string }> = { trunk: { width: 2 }, circuit: { width: 1.6 }, vpn: { icon: 'lock' } };
/** An aggregated link (count ≥ 2) draws this much heavier. */
const LAG_WIDTH = 2.2;

/** Tiers top-down; a tier is a layer in the drawing. */
export const tiers = ['internet', 'edge', 'core', 'distribution', 'access', 'endpoint'] as const;

/** Where a kind sits from the internet down, when no tier says: only used to point lines downwards. */
const level: Record<string, number> = {
  internet: 0, isp: 0, cloud: 0, users: 0,
  router: 1, 'vpn-gateway': 1.2, 'cloud-gateway': 1.2, nat: 1.4, firewall: 1.5, waf: 1.5, ids: 1.6,
  'l3-switch': 2, 'load-balancer': 2.5, proxy: 2.5, switch: 3, 'access-point': 4,
  server: 5, nas: 5, storage: 5, client: 5, clients: 5, phone: 5, printer: 5, camera: 5, dns: 5,
};
/** Kinds that are not a device with a hostname: they keep their kind as label. */
const outside = new Set(['internet', 'cloud', 'users', 'clients']);

const vlanSchema = { anyOf: [{ type: 'integer', minimum: 1, maximum: 4094 }, { type: 'string' }] };
const iface = {
  anyOf: [
    { type: 'string', description: 'IP address, e.g. 10.0.10.1/24' },
    {
      type: 'object',
      properties: { ip: { type: 'string' }, vlan: vlanSchema, zone: { type: 'string', description: 'Group id or name of the zone' }, description: { type: 'string' } },
      additionalProperties: false,
    },
  ],
};
/** Node fields that add to the caption (and the table view). */
const nodeDetails = {
  ip: { type: 'string', description: 'Management or main IP, e.g. 10.0.0.1' },
  cidr: { type: 'string', description: 'Prefix the device owns, e.g. 10.0.0.0/24' },
  vlan: vlanSchema,
  model: { type: 'string', description: 'Make and model, e.g. FortiGate 60F' },
  ha: { anyOf: [{ type: 'boolean' }, { type: 'string' }], description: 'A redundant pair, drawn stacked; text like active/passive' },
  ports: { anyOf: [{ type: 'integer' }, { type: 'string' }, { type: 'array', items: { type: ['string', 'integer'] } }], description: 'Port count or names' },
  tier: { enum: [...tiers], description: 'Layer it is drawn in: internet, edge, core, distribution, access, endpoint' },
  interfaces: { type: 'object', additionalProperties: iface, description: 'Interfaces for the table view: name → IP, or { ip, vlan, zone }' },
};
const groupDetails = {
  cidr: { type: 'string', description: 'Address range, e.g. 10.0.10.0/24' },
  vlan: vlanSchema,
};
const edgeDetails = {
  speed: { type: ['string', 'number'], description: 'Link speed, e.g. 10G' },
  count: { type: 'integer', minimum: 1, description: 'Links bundled (LACP): drawn as one thicker line, "2×10G"' },
  vlans: { anyOf: [{ type: ['integer', 'string'] }, { type: 'array', items: { type: ['integer', 'string'] } }], description: 'VLANs carried, e.g. [10, 20, 30]' },
  ports: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'Ports at each end, e.g. [ge-0/0/1, Gi1/0/48]' },
  flow: { type: 'boolean', description: 'A direction (traffic flow), drawn with an arrowhead' },
};

type Vlan = number | string;
interface NetEntry {
  kind?: string;
  label?: string;
  caption?: string;
  in?: string;
  ip?: string;
  cidr?: string;
  vlan?: Vlan;
  model?: string;
  ha?: boolean | string;
  ports?: number | string | (number | string)[];
  tier?: (typeof tiers)[number];
  interfaces?: Record<string, string | { ip?: string; vlan?: Vlan; zone?: string; description?: string }>;
  [k: string]: unknown;
}

export interface NetworkSource extends GraphSource {
  view?: 'graph' | 'table';
}

const entry = (raw: unknown): NetEntry => (typeof raw === 'string' ? { kind: raw } : raw && typeof raw === 'object' ? { ...(raw as NetEntry) } : {});

/** [10, 11, 12, 20] reads "10–12, 20". */
export function vlanList(v: Vlan | Vlan[]): string {
  const list = Array.isArray(v) ? v : [v];
  const out: string[] = [];
  for (let i = 0; i < list.length; i++) {
    let j = i;
    while (typeof list[j] === 'number' && list[j + 1] === (list[j] as number) + 1) j++;
    // Three or more in a row become a range; two stay a pair.
    if (j - i >= 2) out.push(`${list[i]}–${list[j]}`);
    else out.push(...list.slice(i, j + 1).map(String));
    i = j;
  }
  return out.join(', ');
}

function speedText(speed: unknown, count: unknown): string | undefined {
  const s = speed == null ? undefined : typeof speed === 'number' ? `${speed}G` : String(speed);
  const n = typeof count === 'number' && count > 1 ? count : undefined;
  return n ? (s ? `${n}×${s}` : `LAG ×${n}`) : s;
}

function nodeCaption(e: NetEntry): string | undefined {
  const kind = config.nodeKinds[e.kind ?? '']?.label;
  const l = e.label?.toLowerCase();
  // The model says more than the kind; the icon already says what it is.
  const head = e.model ?? (kind && l !== kind.toLowerCase() && !l?.endsWith(` ${kind.toLowerCase()}`) ? kind : undefined);
  const ports = e.ports == null ? undefined : typeof e.ports === 'number' ? `${e.ports} ports` : Array.isArray(e.ports) ? e.ports.join(', ') : e.ports;
  const ha = e.ha === true ? 'HA pair' : typeof e.ha === 'string' ? `HA ${e.ha}` : undefined;
  const parts = [head, e.ip, e.cidr, e.vlan != null ? `VLAN ${e.vlan}` : undefined, ports, ha].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

function groupCaption(e: NetEntry): string | undefined {
  const parts = [e.vlan != null ? `VLAN ${e.vlan}` : undefined, e.cidr].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

// ---------------------------------------------------------------- addresses

/** An IPv4 prefix as [first, last] address, or undefined when it is not one. */
export function range(cidr: string): [number, number] | undefined {
  const m = /^\s*(\d+)\.(\d+)\.(\d+)\.(\d+)(?:\/(\d+))?\s*$/.exec(cidr);
  if (!m) return undefined;
  const octets = m.slice(1, 5).map(Number);
  const bits = m[5] == null ? 32 : Number(m[5]);
  if (octets.some((o) => o > 255) || bits > 32) return undefined;
  const ip = octets.reduce((a, o) => a * 256 + o, 0);
  const size = 2 ** (32 - bits);
  const first = Math.floor(ip / size) * size;
  return [first, first + size - 1];
}

/** Overlapping zones and addresses outside their zone: the mistakes an IP plan review catches. */
function checkAddresses(src: NetworkSource, ctx: BuildContext) {
  const groups = Object.entries(src.groups ?? {}).map(([id, raw]) => [id, entry(raw)] as const);
  const byId = new Map(groups);
  const ancestors = (id: string) => {
    const out = new Set<string>();
    for (let p = byId.get(id)?.in; p && !out.has(p); p = byId.get(p)?.in) out.add(p);
    return out;
  };
  const prefixed = groups.flatMap(([id, e]) => {
    const r = e.cidr ? range(e.cidr) : undefined;
    if (e.cidr && !r) ctx.warn(['groups', id, 'cidr'], `"${e.cidr}" is not an IPv4 prefix like 10.0.0.0/24`);
    return r ? [{ id, cidr: e.cidr!, r }] : [];
  });
  for (const [i, a] of prefixed.entries())
    for (const b of prefixed.slice(i + 1)) {
      const nested = ancestors(a.id).has(b.id) || ancestors(b.id).has(a.id);
      if (!nested && a.r[0] <= b.r[1] && b.r[0] <= a.r[1]) ctx.warn(['groups', b.id, 'cidr'], `${b.cidr} overlaps ${a.cidr} of "${a.id}"`);
    }
  // A zone inside a zone sits inside its range.
  for (const a of prefixed) {
    const parent = [...ancestors(a.id)].map((p) => prefixed.find((x) => x.id === p)).find(Boolean);
    if (parent && (a.r[0] < parent.r[0] || a.r[1] > parent.r[1])) ctx.warn(['groups', a.id, 'cidr'], `${a.cidr} is outside ${parent.cidr} of "${parent.id}"`);
  }
  for (const [id, raw] of Object.entries(src.nodes ?? {})) {
    const e = entry(raw);
    const zone = prefixed.find((x) => x.id === e.in);
    const ip = e.ip ? range(e.ip.split('/')[0]!) : undefined;
    if (e.ip && !ip) ctx.warn(['nodes', id, 'ip'], `"${e.ip}" is not an IPv4 address`);
    else if (ip && zone && (ip[0] < zone.r[0] || ip[0] > zone.r[1])) ctx.warn(['nodes', id, 'ip'], `${e.ip} is outside ${zone.cidr} of "${zone.id}"`);
  }
}

// ---------------------------------------------------------------- graph view

interface LinkExtra {
  from: string;
  to: string;
  flow: boolean;
  width?: number;
  icon?: string;
  /** Aggregated and drawn heavier for it (not a trunk, whose double line already stands out). */
  lag?: boolean;
}

function graphView(src: NetworkSource, ctx: BuildContext): Graph {
  const kinds = new Map<string, string>();
  const tierOf = new Map<string, number>();
  const nodes: Record<string, NetEntry> = {};
  const stacked = new Set<string>();
  for (const [id, raw] of Object.entries(src.nodes ?? {})) {
    if (raw == null) {
      nodes[id] = raw as never;
      continue;
    }
    const e = entry(raw);
    kinds.set(id, e.kind ?? '');
    if (e.tier) tierOf.set(id, tiers.indexOf(e.tier));
    if (e.ha) stacked.add(id);
    // Devices have hostnames, and the id is that name; the internet and people keep their kind.
    if (e.label === undefined && config.nodeKinds[e.kind ?? ''] && !outside.has(e.kind!)) e.label = id;
    if (e.caption === undefined) e.caption = nodeCaption(e);
    for (const k of Object.keys(nodeDetails)) delete e[k];
    nodes[id] = e;
  }
  const groups: Record<string, NetEntry> = {};
  for (const [id, raw] of Object.entries(src.groups ?? {})) {
    if (raw == null) {
      groups[id] = raw as never;
      continue;
    }
    const e = entry(raw);
    // `dmz: dmz` is the DMZ, not "dmz".
    if (e.label === undefined && e.kind === id && config.groupKinds[id]) e.label = config.groupKinds[id].label;
    if (e.caption === undefined) e.caption = groupCaption(e);
    for (const k of Object.keys(groupDetails)) delete e[k];
    groups[id] = e;
  }

  // Tiers and kind levels are different scales: compare tiers when both ends have one, else the kinds.
  const order = (a: string, b: string): [number | undefined, number | undefined] =>
    tierOf.has(a) && tierOf.has(b) ? [tierOf.get(a), tierOf.get(b)] : [level[kinds.get(a) ?? ''], level[kinds.get(b) ?? '']];
  const extras: (LinkExtra | undefined)[] = [];
  const edges = (src.edges ?? []).map((item, i) => {
    const spec = parseEdge(item, ['edges', i]);
    if (typeof spec === 'string') return item;
    const p = spec.props;
    const style = typeof p.style === 'string' ? p.style : undefined;
    const label = [spec.label, speedText(p.speed, p.count), p.vlans != null ? `VLAN ${vlanList(p.vlans as Vlan | Vlan[])}` : undefined, Array.isArray(p.ports) ? p.ports.join(' ↔ ') : p.ports]
      .filter((x) => x != null && x !== '')
      .join(' · ');
    const extra = style ? STYLE_EXTRA[style] : undefined;
    const lag = typeof p.count === 'number' && p.count > 1;
    const end = (x: typeof spec.from) => (x.row ? `${x.node}.${x.row}` : x.node);
    const flow = p.flow === true;
    extras[i] = { from: spec.from.node, to: spec.to.node, flow: flow || spec.start === 'arrow', width: lag ? Math.max(LAG_WIDTH, extra?.width ?? 0) : extra?.width, icon: extra?.icon, lag: lag && style !== 'trunk' };
    // Undirected links point down the tiers, so dot ranks them internet first; flows stay as written.
    const [ra, rb] = order(spec.from.node, spec.to.node);
    const turn = !flow && spec.start !== 'arrow' && ra != null && rb != null && ra > rb;
    const [from, to] = turn ? [end(spec.to), end(spec.from)] : [end(spec.from), end(spec.to)];
    // A tunnel always says it is one, even without a label.
    const text = label || (style === 'vpn' ? 'VPN' : undefined);
    return {
      from,
      to,
      ...(text ? { label: text } : {}),
      ...(style ? { style } : {}),
      // A line style written in the arrow (-->, ..>) or as `line:` wins; otherwise the style decides.
      ...(p.line || !style ? { line: spec.line } : {}),
      ...(typeof p.badge === 'boolean' ? { badge: p.badge } : {}),
    };
  });

  const graph = buildGraph({ ...src, direction: src.direction ?? 'down', groups, nodes, edges }, config, ctx);

  for (const e of graph.edges) {
    const i = e.path[0] === 'edges' && typeof e.path[1] === 'number' ? e.path[1] : -1;
    const x = extras[i];
    const ours = x && new Set([x.from, x.to]).has(e.from.node) && new Set([x.from, x.to]).has(e.to.node);
    const both = ours && x.flow && e.start === 'arrow';
    if (!ours || !x.flow) [e.start, e.end] = ['none', 'none'];
    else if (!both) [e.start, e.end] = ['none', 'arrow'];
    const styleId = Object.entries(config.edgeStyles!).find(([, s]) => s.label === e.kind)?.[0];
    const width = ours ? x.width : STYLE_EXTRA[styleId ?? '']?.width;
    const icon = ours ? x.icon : STYLE_EXTRA[styleId ?? '']?.icon;
    if (width) e.width = width;
    if (icon) e.icon = icon;
  }
  for (const n of graph.nodes) {
    const r = tierOf.get(n.id);
    if (r != null) n.rank = r;
    if (stacked.has(n.id) && n.shape.kind === 'card') n.shape.stack = true;
  }
  // The legend shows each line once, at the weight it is drawn.
  const seen = new Set<string>();
  graph.legend = (graph.legend ?? []).filter((l) => !seen.has(l.label) && seen.add(l.label));
  for (const l of graph.legend) {
    const id = Object.entries(config.edgeStyles!).find(([, s]) => s.label === l.label)?.[0];
    const w = STYLE_EXTRA[id ?? '']?.width;
    if (w && !l.swatch) l.width = w;
  }
  // A heavier line says the link is aggregated (2×10G): the key says so too. A trunk already draws as its
  // own double line, the same with one link or more ("2×1G" on it says how many), so it adds no entry.
  if (graph.legend.length && extras.some((x) => x?.lag)) graph.legend.push({ label: 'Aggregated link (2× or more)', line: 'solid', width: LAG_WIDTH });
  return graph;
}

// ---------------------------------------------------------------- table view

/** The IP plan: one row per interface (or per device with an IP), grouped by device. */
function tableView(src: NetworkSource, ctx: BuildContext): Graph {
  const groups = new Map(Object.entries(src.groups ?? {}).map(([id, raw]) => [id, entry(raw)] as const));
  const groupLabel = (id: string) => {
    const g = groups.get(id);
    return g?.label ?? (g?.kind === id ? config.groupKinds[id]?.label : undefined) ?? id;
  };
  const devices = Object.entries(src.nodes ?? {}).map(([id, raw]) => [id, entry(raw)] as const);
  const addressed = devices.filter(([, e]) => e.ip || (e.interfaces && Object.keys(e.interfaces).length));
  const list = addressed.length ? addressed : devices.filter(([, e]) => !outside.has(e.kind ?? ''));

  const rows: MatrixHeader[] = [];
  const cells: (MatrixCell | undefined)[][] = [];
  const text = (s: unknown, strong = false): MatrixCell | undefined => (s == null || s === '' ? undefined : { text: String(s), ...(strong ? { strong } : {}) });
  for (const [id, e] of list) {
    const kind = config.nodeKinds[e.kind ?? ''];
    if (e.kind && !kind) ctx.warn(['nodes', id, 'kind'], `Unknown kind "${e.kind}"`);
    const ifaces = Object.entries(e.interfaces ?? {}).map(([name, v]) => [name, typeof v === 'string' ? { ip: v } : (v ?? {})] as const);
    const lines: (readonly [string | undefined, { ip?: string; vlan?: Vlan; zone?: string }])[] = ifaces.length ? ifaces : [[undefined, { ip: e.ip }]];
    for (const [k, [name, f]] of lines.entries()) {
      const zoneId = f.zone ?? e.in;
      const zone = zoneId ? (groups.has(zoneId) ? groupLabel(zoneId) : zoneId) : undefined;
      const vlan = f.vlan ?? (f.zone && groups.get(f.zone)?.vlan) ?? (!f.zone ? (e.vlan ?? (e.in ? groups.get(e.in)?.vlan : undefined)) : undefined);
      rows.push(
        k === 0
          ? { label: e.label ?? (outside.has(e.kind ?? '') ? (kind?.label ?? id) : id), caption: e.model ?? kind?.label, icon: kind?.icon, tone: kind?.tone }
          : { label: '' },
      );
      cells.push([text(name), text(f.ip, true), text(vlan), text(zone)]);
    }
  }
  return {
    title: src.title,
    subtitle: src.subtitle,
    direction: 'right',
    groups: [],
    nodes: [
      {
        id: 'table',
        shape: { kind: 'matrix', plain: true, corner: 'Device', columns: [{ label: 'Interface' }, { label: 'IP address' }, { label: 'VLAN' }, { label: 'Zone' }], rows, cells },
        path: [],
      },
    ],
    edges: [],
  };
}

// ---------------------------------------------------------------- type

function build(src: NetworkSource, ctx: BuildContext): Graph {
  checkAddresses(src, ctx);
  if (src.view === 'table') return tableView(src, ctx);
  const { view: _, ...rest } = src;
  return graphView(rest, ctx);
}

function schema(): object {
  const s = graphSchema('network', config, 'Linework network diagram') as { properties: Record<string, any> };
  // The object form of an entry, wherever it sits among the short forms.
  const objectOf = (x: { anyOf: { type?: string }[] }) => x.anyOf.find((y) => y.type === 'object') as { properties: Record<string, object> };
  const node = objectOf(s.properties.nodes.additionalProperties);
  node.properties = { ...node.properties, ...nodeDetails };
  const group = objectOf(s.properties.groups.additionalProperties);
  group.properties = { ...group.properties, ...groupDetails };
  // Long-form edge properties sit in the `a -- b: { … }` value and in the { from, to } form.
  for (const form of s.properties.edges.items.anyOf as { type?: string; properties?: Record<string, object>; additionalProperties?: any }[]) {
    if (form.type !== 'object') continue;
    const long = form.properties?.from ? form : objectOf(form.additionalProperties);
    long.properties = { ...long.properties, ...edgeDetails };
  }
  s.properties.direction = { enum: ['down', 'right'], description: 'down (default): internet at the top' };
  s.properties.view = { enum: ['graph', 'table'], description: 'graph, or table: the IP plan per device and interface' };
  return s;
}

const palette: PaletteItem[] = [
  ...Object.entries(config.groupKinds).map(([kind, k]) => ({ collection: 'groups', kind, ...k })),
  ...Object.entries(config.nodeKinds).map(([kind, k]) => ({ collection: 'nodes', kind, ...k })),
];

export const guidance = {
  tagline: 'Zones, VLANs, devices and links, from the internet down',
  useWhen: [
    'An office or campus: firewall, switches, APs, VLANs',
    'Hybrid cloud: VPN and ExpressRoute to a hub VNet',
    'Core, distribution and access layers',
    'An IP plan per device, with view: table',
  ],
  notFor: [
    { text: 'Which Azure resources run where', use: 'azure' },
    { text: 'VPCs, subnets and services in AWS or Google Cloud', use: 'cloud' },
    { text: 'Services and how they call each other', use: 'systems' },
    { text: 'Pods and services inside a cluster', use: 'kubernetes' },
  ],
  keywords: [
    'network', 'topology', 'vlan', 'firewall', 'router', 'switch', 'subnet', 'cidr', 'ip plan', 'ip address', 'dmz', 'lan', 'wan', 'vpn',
    'expressroute', 'direct connect', 'wifi', 'access point', 'campus', 'datacenter', 'nwdiag', 'visio', 'netbox', 'cisco',
  ],
};

export const network: DiagramType<NetworkSource> = {
  id: 'network',
  name: 'Network',
  description: 'Zones and segments with CIDR and VLAN, the devices in them and the links between',
  icon: 'network',
  ...guidance,
  schema: schema(),
  palette,
  build,
  // Internet at the top is what a network drawing says: the layout never turns it for its shape.
  tuning: { autoDirection: false },
  references: graphReferences,
  connect(src, from, to) {
    if (from === to) return 'Pick another element to connect to';
    const known = (id: string) => (!!src.nodes && Object.hasOwn(src.nodes, id)) || (!!src.groups && Object.hasOwn(src.groups, id));
    if (!known(from) || !known(to)) return 'Connect one device or zone to another';
    return { path: ['edges'], value: `${from} -- ${to}` };
  },
  template: `type: network
title: Office network
subtitle: Amsterdam

groups:
  internet: internet
  office: { kind: site, label: Amsterdam office, cidr: 10.10.0.0/16 }
  staff: { kind: vlan, label: Staff, in: office, vlan: 10, cidr: 10.10.10.0/24 }
  guest: { kind: vlan, label: Guest, in: office, vlan: 30, cidr: 10.10.30.0/24 }

nodes:
  isp: { kind: isp, label: Fibre ISP, in: internet }
  fw: { kind: firewall, in: office, model: FortiGate 60F, ip: 10.10.0.1, ha: true }
  core: { kind: switch, in: office, model: USW Pro 24 PoE, ip: 10.10.0.2 }
  ap: { kind: access-point, label: ap-floor1, in: staff, model: U6 Pro }
  laptops: { kind: clients, label: Laptops, in: staff }
  guests: { kind: clients, label: Guest devices, in: guest }

# Links have no arrowheads: add flow: true for a direction. Speeds are what the named hardware has:
# the FortiGate 60F and the U6 Pro have 1 GbE ports, and the PoE switch powers the access point.
edges:
  - isp -- fw: { speed: 1G, style: wan }
  - fw -- core: { style: trunk, vlans: [10, 30], speed: 1G, count: 2 }
  - core -- ap: { speed: 1G, ports: [port 5, eth0] }
  - ap -- laptops: { style: wireless }
  - ap -- guests: { style: wireless }
`,
};
