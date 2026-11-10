// The threat overlay of node-and-edge diagrams: trust boundaries, STRIDE threats per element and
// line, threats suggested by simple rules, and the threat table they all end up in.
//
//   groups:
//     internet: { kind: zone, label: Internet, trust: true }     # a trust boundary
//   nodes:
//     db: { kind: database, encrypted: true, threats: [T, { stride: I, title: Backup leaks, mitigation: Encrypted backups }] }
//   edges:
//     - web -> api: { label: HTTPS, auth: OAuth2, threats: [S] }
//   threats:                                                       # or apart, by id or line
//     - { on: "api -> db", stride: E, title: SQL injection, mitigation: Parameterised queries, status: mitigated }
//   trust: [shop]                                                  # groups that are trust boundaries (model views)
//   threat-rules: warn                                             # warn (default), table or off
//
// Threats are numbered T1, T2… in the order written unless they bring an id; the numbers are drawn on
// the elements as small tags, so the drawing and the table point at each other without colour.
import type { BuildContext, KindTable } from './diagram-type.ts';
import type { Graph, GraphEdge, GraphNode, LegendItem, MatrixCell, MatrixHeader, Path, Tone } from './model.ts';

export type Stride = 'S' | 'T' | 'R' | 'I' | 'D' | 'E';
export type ThreatStatus = 'open' | 'mitigated' | 'accepted' | 'transferred' | 'suggested';

export const strideNames: Record<Stride, string> = {
  S: 'Spoofing',
  T: 'Tampering',
  R: 'Repudiation',
  I: 'Information disclosure',
  D: 'Denial of service',
  E: 'Elevation of privilege',
};
const letters = Object.keys(strideNames) as Stride[];
const byName = new Map<string, Stride>([...letters.map((l) => [l.toLowerCase(), l] as const), ...letters.map((l) => [strideNames[l].toLowerCase(), l] as const)]);

/** One row of the threat table. */
export interface ThreatRow {
  id: string;
  stride: Stride[];
  title: string;
  mitigation?: string;
  status: ThreatStatus;
  /** What it is about, as drawn: "Orders API" or "Storefront → Orders API". */
  on: string;
  node?: string;
  edge?: string;
  /** Found by a rule, not written. */
  suggested?: boolean;
  path: Path;
}

const statuses = ['open', 'mitigated', 'accepted', 'transferred'] as const;
const strideValue = { enum: [...letters, ...letters.map((l) => strideNames[l])] };
const threatEntry = (on: boolean) => ({
  anyOf: [
    { ...strideValue, description: 'A STRIDE category: S, T, R, I, D or E' },
    {
      type: 'object',
      required: on ? ['on', 'stride'] : ['stride'],
      properties: {
        ...(on ? { on: { type: 'string', description: 'The element (an id) or line ("a -> b") it is about' } } : {}),
        id: { type: 'string', description: 'Its number in the table, e.g. T7; default T1, T2… in order' },
        stride: { anyOf: [strideValue, { type: 'array', items: strideValue }], description: 'STRIDE categories: S, T, R, I, D, E' },
        title: { type: 'string', description: 'What could go wrong' },
        mitigation: { type: 'string', description: 'What stops it' },
        status: { enum: statuses },
        owner: { type: 'string' },
      },
      additionalProperties: false,
    },
  ],
});
const threatList = { type: 'array', items: threatEntry(false), description: 'STRIDE threats on this element: [S, T] or { stride, title, mitigation, status }; [] says it was reviewed' };

/** Fields of the overlay on a node or group, an edge and the diagram, for graphSchema. */
export const threatFields = {
  node: { threats: threatList, encrypted: { type: 'boolean', description: 'Data at rest is encrypted (threat rules)' } },
  group: { threats: threatList, trust: { type: ['boolean', 'string'], description: 'A trust boundary: drawn as one and checked by the threat rules; a string names it' } },
  edge: {
    threats: threatList,
    encrypted: { type: 'boolean', description: 'Encrypted in transit (TLS); an HTTPS or TLS label says so too' },
    auth: { type: ['boolean', 'string'], description: 'The caller is authenticated, e.g. true or OAuth2' },
  },
  top: {
    threats: { type: 'array', items: threatEntry(true), description: 'Threats kept apart from the drawing, each on an element or line' },
    trust: { type: 'array', items: { type: 'string' }, description: 'Groups that are trust boundaries, by id' },
    'threat-rules': { enum: ['warn', 'table', 'off'], description: 'Threats suggested by rules: as warnings (default), also in the threat table, or not at all' },
  },
};

/** The overlay's own keys, which model views do not carry over: kept aside so they reach the drawing. */
export function overlayKeys(src: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(['threats', 'trust', 'threat-rules', 'view'].filter((k) => src[k] !== undefined).map((k) => [k, src[k]]));
}

/** Kinds the rules know: who is outside, what keeps data. */
export interface ThreatKinds {
  external?: string[];
  stores?: string[];
}

interface Written {
  stride: Stride[];
  id?: string;
  title?: string;
  mitigation?: string;
  status?: ThreatStatus;
  path: Path;
}

function parseThreat(v: unknown, path: Path, ctx: BuildContext): Written | undefined {
  const cat = (x: unknown) => (typeof x === 'string' ? byName.get(x.trim().toLowerCase()) : undefined);
  if (typeof v === 'string') {
    const s = cat(v);
    if (!s) ctx.error(path, `"${v}" is not a STRIDE category: S, T, R, I, D or E`);
    return s ? { stride: [s], path } : undefined;
  }
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const raw = Array.isArray(o.stride) ? o.stride : [o.stride];
  const stride = [...new Set(raw.map(cat).filter((s): s is Stride => !!s))];
  if (!stride.length) {
    ctx.error([...path, 'stride'], 'A threat needs its STRIDE category: S, T, R, I, D or E');
    return undefined;
  }
  const str = (k: string) => (typeof o[k] === 'string' && o[k] ? (o[k] as string) : undefined);
  return { stride, id: str('id'), title: str('title'), mitigation: str('mitigation'), status: str('status') as ThreatStatus | undefined, path };
}

const ENCRYPTED = /\b(https|tls|mtls|ssh|sftp|ftps|wss|ipsec|vpn|encrypted)\b/i;
const AUTHENTICATED = /\b(oauth2?|oidc|openid|jwt|mtls|saml|api[- ]?key|token|signed|kerberos|basic auth|authenticated)\b/i;

/**
 * Reads the overlay from the source, marks the graph (trust boundaries, threat ids on elements and
 * lines), runs the rules and puts the rows on `graph.threats`. Nothing happens for a diagram that
 * names no trust boundary, no threat and no rules: the overlay is there only when asked for.
 */
export function applyThreats(graph: Graph, src: Record<string, unknown>, kinds: ThreatKinds, ctx: BuildContext): void {
  type Raw = { threats?: unknown; encrypted?: unknown; trust?: unknown; auth?: unknown };
  const entries = (c: 'nodes' | 'groups') => (src[c] && typeof src[c] === 'object' ? (src[c] as Record<string, unknown>) : {});
  const entryOf = (c: 'nodes' | 'groups', id: string): Raw => {
    const e = entries(c)[id];
    return e && typeof e === 'object' ? (e as Raw) : {};
  };
  const edgeProps = (e: GraphEdge): Raw => {
    const item = (src.edges as unknown[] | undefined)?.[Number(e.path[1])];
    if (e.path[0] !== 'edges' || !item || typeof item !== 'object') return {};
    const o = item as Record<string, unknown>;
    if ('from' in o) return o as Raw;
    const v = Object.values(o)[0];
    return v && typeof v === 'object' ? (v as Raw) : {};
  };
  const rules = src['threat-rules'] === 'off' ? 'off' : src['threat-rules'] === 'table' ? 'table' : 'warn';
  const trustList = Array.isArray(src.trust) ? (src.trust as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const top = Array.isArray(src.threats) ? (src.threats as unknown[]) : [];
  const groupIds = new Set(graph.groups.map((g) => g.id));
  for (const [i, id] of trustList.entries()) if (!groupIds.has(id)) ctx.warn(['trust', i], `There is no group "${id}" in this drawing`);

  // Trust boundaries.
  const trusted = new Map<string, string>();
  for (const g of graph.groups) {
    const t = entryOf('groups', g.id).trust;
    if (t || trustList.includes(g.id) || g.kind === 'trust-boundary') {
      g.trust = true;
      trusted.set(g.id, typeof t === 'string' && t ? t : g.label);
      if (typeof t === 'string' && t && t !== g.label) g.caption = t;
      else if (!g.caption || ['Zone', 'Boundary', 'Trust boundary'].includes(g.caption)) g.caption = 'Trust boundary';
    }
  }
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const hasThreats = (r: Raw) => Array.isArray(r.threats);
  const active =
    trusted.size > 0 || top.length > 0 || src['threat-rules'] != null ||
    graph.nodes.some((n) => hasThreats(entryOf('nodes', n.id))) || graph.groups.some((g) => hasThreats(entryOf('groups', g.id))) || graph.edges.some((e) => hasThreats(edgeProps(e)));
  if (!active) return;

  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const groups = new Map(graph.groups.map((g) => [g.id, g]));
  const name = (id: string) => {
    const s = nodes.get(id)?.shape;
    return s?.kind === 'card' || s?.kind === 'flow' ? s.label : s?.kind === 'table' ? s.title : (groups.get(id)?.label ?? id);
  };
  const lineName = (e: GraphEdge) => `${name(e.from.node)} → ${name(e.to.node)}`;
  const kindOf = (id: string) => nodes.get(id)?.kind ?? groups.get(id)?.kind;
  const tagged = (id: string, tag: string) => !!(nodes.get(id)?.tags ?? groups.get(id)?.tags)?.includes(tag);
  const external = (id: string) => tagged(id, 'external') || (!!kindOf(id) && !!kinds.external?.includes(kindOf(id)!)) || (nodes.get(id)?.shape.kind === 'card' && !!(nodes.get(id)!.shape as { muted?: boolean }).muted);
  const store = (id: string) => !!kindOf(id) && !!kinds.stores?.includes(kindOf(id)!);
  /** The trust boundaries something sits in, innermost first. */
  const zones = (id: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (let p: string | undefined = groups.has(id) ? id : nodes.get(id)?.parent; p && !seen.has(p); p = groups.get(p)?.parent) {
      seen.add(p);
      if (trusted.has(p)) out.push(p);
    }
    return out;
  };

  // Written threats, on what they are about.
  type Target = { node?: string; edge?: GraphEdge; reviewed: boolean; written: Written[] };
  const targets = new Map<string, Target>();
  const target = (key: string, t: Omit<Target, 'written' | 'reviewed'>) => targets.get(key) ?? (targets.set(key, { ...t, reviewed: false, written: [] }), targets.get(key)!);
  const read = (t: Target, list: unknown, path: Path) => {
    if (!Array.isArray(list)) return;
    t.reviewed = true;
    for (const [i, v] of list.entries()) {
      const w = parseThreat(v, [...path, i], ctx);
      if (w) t.written.push(w);
    }
  };
  for (const n of graph.nodes) read(target(`n:${n.id}`, { node: n.id }), entryOf('nodes', n.id).threats, [...n.path, 'threats']);
  for (const g of graph.groups) read(target(`n:${g.id}`, { node: g.id }), entryOf('groups', g.id).threats, [...g.path, 'threats']);
  for (const e of graph.edges) read(target(`e:${e.id}`, { edge: e }), edgeProps(e).threats, [...e.path, 'threats']);
  const ARROW = /^\s*([A-Za-z0-9_.-]+)\s*(?:->|-->|\.\.>|<->|--)\s*([A-Za-z0-9_.-]+)\s*$/;
  for (const [i, v] of top.entries()) {
    const on = v && typeof v === 'object' ? (v as { on?: unknown }).on : undefined;
    if (typeof on !== 'string') continue;
    const m = ARROW.exec(on);
    const key = m ? graph.edges.find((e) => e.from.node === m[1] && e.to.node === m[2]) : undefined;
    if (m && !key) {
      ctx.warn(['threats', i, 'on'], `There is no line ${m[1]} -> ${m[2]} in this drawing`);
      continue;
    }
    if (!m && !nodeIds.has(on) && !groupIds.has(on)) {
      ctx.warn(['threats', i, 'on'], `There is no element "${on}" in this drawing`);
      continue;
    }
    const t = key ? target(`e:${key.id}`, { edge: key }) : target(`n:${on}`, { node: on });
    const w = parseThreat(v, ['threats', i], ctx);
    if (w) t.written.push(w);
  }

  // Rules: what a reviewer asks first. A target that lists its threats (even none) was looked at; a
  // category it already names is not suggested again.
  type Found = { t: Target; stride: Stride[]; title: string; mitigation: string; path: Path };
  const found: Found[] = [];
  if (rules !== 'off') {
    const suggest = (t: Target, stride: Stride[], title: string, mitigation: string, path: Path) => {
      if (t.reviewed) return;
      const named = new Set(t.written.flatMap((w) => w.stride));
      const left = stride.filter((s) => !named.has(s));
      if (left.length) found.push({ t, stride: left, title, mitigation, path });
    };
    for (const e of graph.edges) {
      if (e.from.node === e.to.node) continue;
      const p = edgeProps(e);
      const said = `${e.label ?? ''} ${e.kind ?? ''}`;
      const encrypted = p.encrypted === true || ENCRYPTED.test(said);
      const auth = !!p.auth || AUTHENTICATED.test(said);
      const a = zones(e.from.node);
      const b = zones(e.to.node);
      const crossed = [...a.filter((z) => !b.includes(z)), ...b.filter((z) => !a.includes(z))];
      const t = target(`e:${e.id}`, { edge: e });
      const boundary = crossed.length ? `the trust boundary ${crossed.map((z) => `"${trusted.get(z)}"`).join(' and ')}` : '';
      const fromOutside = external(e.from.node) && !external(e.to.node);
      if (crossed.length && !encrypted) suggest(t, ['T', 'I'], `Data crosses ${boundary} unencrypted`, 'Encrypt in transit (TLS); then mark the line encrypted: true', e.path);
      if ((crossed.length || fromOutside) && !auth)
        suggest(t, ['S'], fromOutside ? `${name(e.from.node)} reaches ${name(e.to.node)} without authentication` : `The caller is not authenticated across ${boundary}`, 'Authenticate the caller (OAuth2/OIDC, mTLS or a signed token); then set auth:', e.path);
      if (external(e.from.node) && store(e.to.node)) suggest(t, ['T', 'I'], `${name(e.from.node)} writes to a data store directly`, 'Put a service in front of the store that checks what comes in', e.path);
    }
    for (const n of graph.nodes) {
      if (!store(n.id)) continue;
      const encrypted = entryOf('nodes', n.id).encrypted === true || tagged(n.id, 'encrypted');
      if (!encrypted) suggest(target(`n:${n.id}`, { node: n.id }), ['I'], 'Data at rest is not encrypted', 'Encrypt at rest (disk, TDE or KMS keys); then mark it encrypted: true', n.path);
    }
  }

  // Numbers: ids as written, the rest T1, T2… in the order of the drawing; suggestions after them.
  const used = new Set<string>();
  for (const t of targets.values()) for (const w of t.written) if (w.id) used.add(w.id);
  let n = 0;
  const next = () => {
    let id: string;
    do id = `T${++n}`;
    while (used.has(id));
    used.add(id);
    return id;
  };
  const rows: ThreatRow[] = [];
  const where = (t: Target) => ({ on: t.edge ? lineName(t.edge) : name(t.node!), ...(t.edge ? { edge: t.edge.id } : { node: t.node }) });
  for (const t of targets.values())
    for (const w of t.written)
      rows.push({ id: w.id ?? next(), stride: w.stride, title: w.title ?? w.stride.map((s) => strideNames[s]).join(', '), ...(w.mitigation ? { mitigation: w.mitigation } : {}), status: w.status ?? 'open', ...where(t), path: w.path });
  // In the table by number, as a reader looks them up from the drawing: T2 before T10.
  rows.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  for (const f of found) {
    const cats = f.stride.join(', ');
    ctx.warn(f.path, `Suggested threat (${cats}) on ${f.t.edge ? lineName(f.t.edge) : name(f.t.node!)}: ${f.title}. ${f.mitigation}, list the threat under threats:, or write threats: [] when it was reviewed`);
    if (rules === 'table') rows.push({ id: next(), stride: f.stride, title: f.title, mitigation: f.mitigation, status: 'suggested', ...where(f.t), suggested: true, path: f.path });
  }

  // Marks on the drawing.
  const marks = new Map<string, string[]>();
  for (const r of rows) {
    const key = r.edge ? `e:${r.edge}` : `n:${r.node}`;
    marks.set(key, [...(marks.get(key) ?? []), r.id]);
  }
  for (const nd of graph.nodes) if (marks.has(`n:${nd.id}`)) nd.marks = marks.get(`n:${nd.id}`);
  for (const g of graph.groups) if (marks.has(`n:${g.id}`)) g.marks = marks.get(`n:${g.id}`);
  for (const e of graph.edges) if (marks.has(`e:${e.id}`)) e.marks = marks.get(`e:${e.id}`);
  graph.threats = rows;
  const legend: LegendItem[] = [];
  if (trusted.size) legend.push({ label: 'Trust boundary', swatch: 'trust', tone: 'rose' });
  if (rows.length) legend.push({ label: 'Threat, see the threat table', swatch: 'mark', tone: 'rose' });
  graph.legend = [...(graph.legend ?? []), ...legend];
}

/** The views a diagram with a threat overlay offers: the drawing and its threat table. */
export function threatViews(src: Record<string, unknown>): { name: string; title?: string }[] {
  const has = (v: unknown) => !!v && typeof v === 'object' && Object.values(v).some((e) => !!e && typeof e === 'object' && ('threats' in e || 'trust' in e));
  const edges = Array.isArray(src.edges) && (src.edges as unknown[]).some((e) => !!e && typeof e === 'object' && Object.values(e).some((v) => !!v && typeof v === 'object' && 'threats' in v));
  const kinds = (v: unknown) => !!v && typeof v === 'object' && Object.values(v).some((e) => e === 'trust-boundary' || (!!e && typeof e === 'object' && (e as { kind?: unknown }).kind === 'trust-boundary'));
  const on = kinds(src.groups) || src.threats != null || src.trust != null || src['threat-rules'] != null || has(src.nodes) || has(src.groups) || edges;
  return on ? [{ name: 'diagram', title: 'Data flow diagram' }, { name: 'threats', title: 'Threat table' }] : [];
}

export const statusTone: Record<ThreatStatus, Tone> = { open: 'rose', mitigated: 'green', accepted: 'amber', transferred: 'slate', suggested: 'slate' };
const statusLabel: Record<ThreatStatus, string> = { open: 'Open', mitigated: 'Mitigated', accepted: 'Accepted', transferred: 'Transferred', suggested: 'Suggested' };

/** The threat table as a drawing: one row per threat, its number as on the drawing. */
export function threatTable(graph: Graph): Graph {
  const rows = graph.threats ?? [];
  const columns: MatrixHeader[] = [{ label: 'Element or flow' }, { label: 'STRIDE' }, { label: 'Threat' }, { label: 'Mitigation' }, { label: 'Status' }];
  const cells: (MatrixCell | undefined)[][] = rows.map((r) => [
    { text: r.on, strong: true },
    { text: r.stride.map((s) => strideNames[s]).join(', ') },
    { text: r.title },
    { text: r.mitigation ?? '–' },
    { text: statusLabel[r.status], tone: statusTone[r.status] },
  ]);
  const used = [...new Set(rows.map((r) => r.status))];
  const node: GraphNode = rows.length
    ? { id: 'threats', shape: { kind: 'matrix', corner: 'ID', plain: true, wrap: 260, table: true, rows: rows.map((r) => ({ label: r.id })), columns, cells }, path: [] }
    : { id: 'threats', shape: { kind: 'card', label: 'No threats yet', caption: 'Add threats: to elements and lines, or a trust boundary', icon: 'shield-check', tone: 'green' }, path: [] };
  const counts = (['open', 'mitigated', 'accepted', 'transferred', 'suggested'] as const).filter((s) => used.includes(s)).map((s) => `${rows.filter((r) => r.status === s).length} ${s}`);
  return {
    title: graph.title ? `${graph.title} — threats` : 'Threats',
    subtitle: [graph.subtitle, counts.join(', ')].filter(Boolean).join(' · ') || undefined,
    direction: 'right',
    groups: [],
    nodes: [node],
    edges: [],
    legend: [],
    threats: rows,
  };
}

/** The threat table as markdown, for a design document or a ticket. */
export function threatMarkdown(graph: Graph, title = graph.title): string {
  const rows = graph.threats ?? [];
  const cell = (s: string | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ') || '–';
  const out = [`# ${title ? `${title} — threats` : 'Threats'}`, ''];
  if (!rows.length) return [...out, 'No threats are listed yet.', ''].join('\n');
  const tally = (['open', 'mitigated', 'accepted', 'transferred', 'suggested'] as const).map((s) => [s, rows.filter((r) => r.status === s).length] as const).filter(([, n]) => n);
  out.push(tally.map(([s, n]) => `${n} ${s}`).join(', ') + '.', '');
  out.push('| ID | Element or flow | STRIDE | Threat | Mitigation | Status |', '| --- | --- | --- | --- | --- | --- |');
  for (const r of rows) out.push(`| ${cell(r.id)} | ${cell(r.on)} | ${r.stride.map((s) => strideNames[s]).join(', ')} | ${cell(r.title)} | ${cell(r.mitigation)} | ${statusLabel[r.status]} |`);
  out.push('', 'STRIDE: Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege.', '');
  return out.join('\n');
}

/** Default kinds for the rules, by what the kind tables call them. */
export function threatKindsOf(nodeKinds: KindTable, extra: ThreatKinds = {}): ThreatKinds {
  const has = (k: string) => k in nodeKinds;
  return {
    external: [...['user', 'users', 'person', 'external', 'payments', 'email'].filter(has), ...(extra.external ?? [])],
    stores: [...['database', 'cache', 'storage', 'warehouse', 'search', 'sql-database', 'cosmos-db', 'storage-account', 'redis', 's3', 'rds', 'dynamodb'].filter(has), ...(extra.stores ?? [])],
  };
}
