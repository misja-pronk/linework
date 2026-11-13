// Data products (data mesh): domains, source systems, data products with input and output ports,
// data contracts on output ports, and consumers. One file, two levels of detail:
//   overview          products as cards, lineage between them
//   detailed-<domain> one domain's products as tables with their ports and contracts, and what they
//                     read from and are read by as cards (offered when products sit in several domains;
//                     products without a domain get detailed-other)
//   detailed-<product> one product the same way: offered instead of its domain's view when that domain
//                     holds more than one product and a contract among them (a contract is tall)
//   detailed          every product as a table: offered when there is no split, else only when asked by name
// `detail: [id]` (or `detail: true` on a product) shows only some products in detail.
//
//   products:
//     orders:
//       class: source-aligned          # source-aligned, aggregate or consumer-aligned
//       domain: sales
//       inputs: [shop]                 # a source, a product (its only port) or product.port
//       outputs:
//         orders: { kind: table, contract: orders-v2 }
import {
  english,
  idPattern,
  parseSource,
  type BuildContext,
  type DiagramType,
  type Endpoint,
  type Graph,
  type GraphEdge,
  type GraphGroup,
  type GraphNode,
  type KindTable,
  type LegendItem,
  type PaletteItem,
  type Reference,
  type RowMark,
  type TableRow,
  type Tone,
  type Word,
} from '@cartography/core';
import { findField, readOdcs, type ContractModel } from './odcs.ts';

export { readOdcs, type ContractModel, type ContractRelation } from './odcs.ts';

export const classes: KindTable = {
  'source-aligned': { label: 'Source-aligned', icon: 'package', tone: 'teal', keywords: ['raw', 'operational'] },
  aggregate: { label: 'Aggregate', icon: 'boxes', tone: 'indigo', keywords: ['core', 'shared'] },
  'consumer-aligned': { label: 'Consumer-aligned', icon: 'target', tone: 'amber', keywords: ['fit for purpose'] },
};

export const sourceKinds: KindTable = {
  application: { label: 'Application', icon: 'app-window', tone: 'slate' },
  database: { label: 'Database', icon: 'database', tone: 'slate' },
  erp: { label: 'ERP', icon: 'building', tone: 'slate' },
  saas: { label: 'SaaS', icon: 'cloud', tone: 'slate' },
  stream: { label: 'Event stream', icon: 'activity', tone: 'slate', keywords: ['kafka', 'event hub'] },
  file: { label: 'Files', icon: 'file-box', tone: 'slate', keywords: ['sftp', 'csv'] },
  api: { label: 'API', icon: 'webhook', tone: 'slate' },
  device: { label: 'Devices', icon: 'radio-tower', tone: 'slate', keywords: ['iot'] },
};

export const portKinds: KindTable = {
  table: { label: 'table', icon: 'table-2', tone: 'blue' },
  view: { label: 'view', icon: 'table', tone: 'blue' },
  files: { label: 'files', icon: 'file-box', tone: 'blue' },
  api: { label: 'API', icon: 'webhook', tone: 'blue' },
  stream: { label: 'stream', icon: 'activity', tone: 'blue' },
  topic: { label: 'topic', icon: 'radio', tone: 'blue' },
  query: { label: 'SQL', icon: 'search', tone: 'blue' },
  model: { label: 'model', icon: 'brain', tone: 'blue' },
};

export const consumerKinds: KindTable = {
  dashboard: { label: 'Dashboard', icon: 'chart-column-big', tone: 'sky', keywords: ['bi', 'power bi'] },
  report: { label: 'Report', icon: 'file-text', tone: 'sky' },
  ml: { label: 'ML model', icon: 'brain', tone: 'sky' },
  application: { label: 'Application', icon: 'app-window', tone: 'sky' },
  team: { label: 'Team', icon: 'users', tone: 'sky' },
  analyst: { label: 'Analyst', icon: 'user', tone: 'sky' },
  partner: { label: 'Partner', icon: 'handshake', tone: 'sky' },
};

const styles = {
  flow: { label: 'Data flow', line: 'solid' },
  contract: { label: 'Data contract', line: 'dashed', tone: 'violet' },
  relation: { label: 'Foreign key', line: 'solid', tone: 'violet' },
} as const satisfies Record<string, { label: string; line: GraphEdge['line']; tone?: Tone }>;

const CONTRACT_TONE: Tone = 'violet';
/** A contract with this many rows (sections counted) or more stands in two columns. */
const SPLIT_ROWS = 8;

interface Named {
  label?: string;
  caption?: string;
}
interface Placed extends Named {
  kind?: string;
  domain?: string;
}
type Ref = string | { from: string; label?: string; name?: string };
interface Port extends Named {
  kind?: string;
  contract?: string;
}
interface Product extends Named {
  class?: string;
  domain?: string;
  owner?: string;
  version?: string | number;
  /** Where it is in its life when that is worth saying: draft, proposed, deprecated, retired. */
  status?: string;
  detail?: boolean;
  inputs?: Ref[];
  outputs?: Record<string, string | Port | null>;
}
interface Consumer extends Placed {
  uses?: Ref[];
}
interface Contract extends Named {
  /** An Open Data Contract Standard file; the other keys override what it says. */
  file?: string;
  version?: string | number;
  classification?: string;
  fields?: Record<string, string | null>;
  sla?: Record<string, string | number>;
  quality?: string[];
}

export interface DataProductSource {
  title?: string;
  subtitle?: string;
  direction?: 'right' | 'down';
  /** overview, detailed (every product), detailed-<domain> (one domain's products, detailed-other: those without one) or detailed-<product>. */
  view?: string;
  /** Products shown in detail in the overview. */
  detail?: string[];
  /** Show contracts next to detailed products (default true). */
  'show-contracts'?: boolean;
  /** Most fields a contract shows before "+ n more" (default 12, 0 hides fields). */
  'contract-fields'?: number;
  domains?: Record<string, (Named & { owner?: string }) | string | null>;
  sources?: Record<string, Placed | string | null>;
  products?: Record<string, Product | null>;
  consumers?: Record<string, Consumer | string | null>;
  contracts?: Record<string, Contract | null>;
}

interface Part {
  view: string;
  title: string;
  /** The domain drawn (with product: the domain that product is in); none: the products without a domain. */
  domain?: string;
  /** One product drawn, not its whole domain. */
  product?: string;
  /** Drawn when asked for by name, not offered: the domain view of a domain that is offered product by product. */
  hidden?: boolean;
}

/**
 * The detailed views: one per domain that has products, and detailed-other for products without one (a
 * domain called other: detailed-no-domain). A contract is the tall part of a detailed drawing, so a domain
 * that holds more than one product, a contract among them, is offered product by product instead
 * (detailed-<product>, or detailed-product-<product> where that name is taken); its domain view is still
 * drawn when asked for by name.
 */
function detailParts(src: DataProductSource, word: Word = english): Part[] {
  const domains = src.domains ?? {};
  const products = Object.entries(src.products ?? {}).map(([id, p]) => [id, p ?? {}] as const);
  const has = (d: string) => Object.hasOwn(domains, d);
  const groups: { domain?: string; view: string; title: string; members: (readonly [string, Product])[] }[] = Object.entries(domains)
    .map(([id, d]) => ({ domain: id, view: `detailed-${id}`, title: word('{name} in detail', { name: (typeof d === 'string' ? d : d?.label) ?? id }), members: products.filter(([, p]) => p.domain === id) }))
    .filter((g) => g.members.length);
  const loose = products.filter(([, p]) => !p.domain || !has(p.domain));
  if (loose.length) groups.push({ view: has('other') ? 'detailed-no-domain' : 'detailed-other', title: word('Other products in detail'), members: loose });
  const contracted = ([, p]: readonly [string, Product]) => Object.values(p.outputs ?? {}).some((o) => !!o && typeof o === 'object' && !!o.contract);
  const split = (g: (typeof groups)[number]) => src['show-contracts'] !== false && g.members.length > 1 && g.members.some(contracted);
  const taken = new Set(groups.map((g) => g.view));
  const parts: Part[] = [];
  for (const g of groups) {
    if (!split(g)) {
      parts.push({ view: g.view, title: g.title, domain: g.domain });
      continue;
    }
    for (const [id, p] of g.members) {
      const view = taken.has(`detailed-${id}`) ? `detailed-product-${id}` : `detailed-${id}`;
      parts.push({ view, title: word('{name} in detail', { name: p.label ?? id }), domain: g.domain, product: id });
    }
  }
  // The domain views that were split stay drawable by name, after the ones offered.
  for (const g of groups) if (split(g)) parts.push({ view: g.view, title: g.title, domain: g.domain, hidden: true });
  return parts;
}

/**
 * The overview as written draws just what this part does: its products, and only they, in detail
 * (`detail:`), everything else one line from them, and nothing in another domain. Then the part is
 * the same drawing under another name, and only the overview is offered.
 */
function sameAsOverview(src: DataProductSource, part: Part): boolean {
  const products = Object.entries(src.products ?? {}).map(([id, p]) => [id, p ?? {}] as const);
  const domains = src.domains ?? {};
  const known = (d: string | undefined) => (d && Object.hasOwn(domains, d) ? d : undefined);
  const members = new Set(products.filter(([id, p]) => (part.product ? id === part.product : known(p.domain) === part.domain)).map(([id]) => id));
  const detail = new Set([...(src.detail ?? []), ...products.filter(([, p]) => p.detail).map(([id]) => id)]);
  if (detail.size !== members.size || [...detail].some((id) => !members.has(id))) return false;
  const lines: [string, string][] = [
    ...products.flatMap(([id, p]) => (p.inputs ?? []).map((r): [string, string] => [refOf(r).from.split('.')[0]!, id])),
    ...Object.entries(src.consumers ?? {}).flatMap(([id, c]) => (c && typeof c === 'object' ? (c.uses ?? []) : []).map((r): [string, string] => [refOf(r).from.split('.')[0]!, id])),
  ];
  const near = new Set([...members, ...lines.flatMap(([a, b]) => (members.has(a) ? [b] : members.has(b) ? [a] : []))]);
  const everything = [...products, ...Object.entries(src.sources ?? {}), ...Object.entries(src.consumers ?? {})].map(([id, e]) => [id, e && typeof e === 'object' ? e.domain : undefined] as const);
  return everything.every(([id, d]) => near.has(id) && (!known(d) || known(d) === part.domain));
}

const entry = <T extends object>(v: T | string | null | undefined): T => (typeof v === 'string' ? ({ kind: v } as unknown as T) : (v ?? ({} as T)));
const port = (v: string | Port | null): Port => (typeof v === 'string' ? { kind: v } : (v ?? {}));
const refOf = (r: Ref) => (typeof r === 'string' ? { from: r } : r);

/** "decimal(10,2) pk pii null" → type and marks. */
export function parseField(spec: string | null): { type: string; marks: RowMark[] } {
  const marks: RowMark[] = [];
  const type: string[] = [];
  for (const t of (spec ?? '').trim().split(/\s+/).filter(Boolean)) {
    const f = t.toLowerCase();
    if (f === 'pk' || f === 'pii' || f === 'unique') marks.push(f);
    else if (f === 'null' || f === 'nullable') marks.push('null');
    else type.push(t);
  }
  return { type: type.join(' ') + (marks.includes('null') ? '?' : ''), marks };
}

function build(src: DataProductSource, ctx: BuildContext): Graph {
  const word = ctx.word ?? english;
  const products = Object.entries(src.products ?? {}).map(([id, p]) => [id, p ?? {}] as const);
  const sources = Object.entries(src.sources ?? {}).map(([id, s]) => [id, entry<Placed>(s)] as const);
  const consumers = Object.entries(src.consumers ?? {}).map(([id, c]) => [id, entry<Consumer>(c)] as const);
  const contracts = new Map(Object.entries(src.contracts ?? {}).map(([id, c]) => [id, c ?? {}]));
  const models = new Map<string, ContractModel>();
  for (const [id, c] of contracts) {
    const m = contractModel(c, ['contracts', id], ctx);
    if (m) models.set(id, m);
  }
  const domains = new Map(Object.entries(src.domains ?? {}).map(([id, d]) => [id, typeof d === 'string' ? { label: d } : (d ?? {})]));
  const productMap = new Map(products);
  const sourceMap = new Map(sources);

  // Ids share one namespace, so a reference never has to say what it points at.
  const seen = new Map<string, string>();
  for (const [collection, list] of [['sources', sources], ['products', products], ['consumers', consumers]] as const)
    for (const [id] of list) {
      if (seen.has(id)) ctx.error([collection, id], `"${id}" is already used in ${seen.get(id)}`);
      else seen.set(id, collection);
    }

  // detailed-<domain> or detailed-<product>: those products in detail, and only what they connect to besides.
  const parts = typeof src.view === 'string' && src.view.startsWith('detailed-') ? detailParts(src) : [];
  const part = parts.find((p) => p.view === src.view);
  if (parts.length && !part) ctx.error(['view'], `There is no view "${src.view}": the detailed views are ${parts.filter((p) => !p.hidden).map((p) => p.view).join(', ')}`);
  const inPart = (id: string, p: Product) => (part?.product ? id === part.product : part?.domain ? p.domain === part.domain : !p.domain || !domains.has(p.domain));
  const detailed = new Set(
    part ? products.filter(([id, p]) => inPart(id, p)).map(([id]) => id) : src.view === 'detailed' ? products.map(([id]) => id) : products.filter(([, p]) => p.detail).map(([id]) => id),
  );
  for (const [i, id] of (src.detail ?? []).entries()) {
    if (!productMap.has(id)) ctx.error(['detail', i], `There is no product "${id}"`);
    else if (!part) detailed.add(id);
  }
  const showContracts = src['show-contracts'] !== false;

  const groups: GraphGroup[] = [...domains].map(([id, d]) => ({
    id: `domain:${id}`,
    label: d.label ?? id,
    caption: d.caption ?? (d.owner ? `Domain · ${d.owner}` : 'Domain'),
    icon: 'square-stack',
    tone: 'slate',
    border: 'dashed',
    path: ['domains', id],
  }));
  const domainOf = (d: string | undefined, path: (string | number)[]) => {
    if (!d) return undefined;
    if (domains.has(d)) return `domain:${d}`;
    ctx.error(path, `There is no domain "${d}"`);
    return undefined;
  };

  const nodes: GraphNode[] = [];
  const classOf = new Map<string, string>();
  for (const [id, s] of sources) {
    const k = sourceKinds[s.kind ?? ''] ?? sourceKinds.application!;
    nodes.push({
      id,
      parent: domainOf(s.domain, ['sources', id, 'domain']),
      shape: { kind: 'card', label: s.label ?? id, caption: s.caption ?? `Source · ${k.label}`, icon: k.icon, tone: k.tone },
      path: ['sources', id],
    });
  }

  const outputsOf = (p: Product) => Object.entries(p.outputs ?? {}).map(([id, o]) => [id, port(o)] as const);
  for (const [id, p] of products) {
    const k = classes[p.class ?? ''] ?? classes['source-aligned']!;
    classOf.set(id, p.class ?? 'source-aligned');
    // The owner comes last: a long one is cut at the edge of the card, and a status or version cut in half says nothing.
    const caption = p.caption ?? [k.label, p.status, p.version != null && `v${p.version}`, p.owner].filter(Boolean).join(' · ');
    const parent = domainOf(p.domain, ['products', id, 'domain']);
    if (!detailed.has(id)) {
      nodes.push({ id, parent, shape: { kind: 'card', label: p.label ?? id, caption, icon: k.icon, tone: k.tone }, path: ['products', id] });
      continue;
    }
    const rows: TableRow[] = [];
    if (p.inputs?.length) rows.push({ kind: 'section', label: word('Input ports') });
    for (const [i, r] of (p.inputs ?? []).entries()) {
      const ref = refOf(r);
      // One reading for every input port: what it reads from, then how (or which of its ports, or what kind of system).
      const from = refLabel(ref.from);
      const written = ref.label ?? ref.name;
      // "Orders · orders" says nothing twice; the port of a product with several is said, whatever its name.
      const how = written && written.toLowerCase() === from.toLowerCase() ? '' : (written ?? refDetail(ref.from));
      rows.push({
        kind: 'row',
        id: `in:${i}`,
        icon: 'arrow-right-to-line',
        tone: 'slate',
        cells: [{ text: from }, { text: how, muted: true }],
      });
    }
    const outs = outputsOf(p);
    if (outs.length) rows.push({ kind: 'section', label: word('Output ports') });
    for (const [pid, o] of outs) {
      const pk = portKinds[o.kind ?? ''];
      rows.push({
        kind: 'row',
        id: `out:${pid}`,
        icon: pk?.icon ?? 'arrow-right-from-line',
        tone: pk?.tone ?? 'blue',
        cells: [{ text: o.label ?? pid, strong: true }, { text: o.caption ?? pk?.label ?? o.kind ?? '', muted: true }],
      });
    }
    nodes.push({ id, parent, shape: { kind: 'table', title: p.label ?? id, caption, icon: k.icon, tone: k.tone, rows, ports: true }, path: ['products', id] });
  }

  for (const [id, c] of consumers) {
    const k = consumerKinds[c.kind ?? ''] ?? consumerKinds.application!;
    nodes.push({
      id,
      parent: domainOf(c.domain, ['consumers', id, 'domain']),
      shape: { kind: 'card', label: c.label ?? id, caption: c.caption ?? k.label, icon: k.icon, tone: k.tone },
      path: ['consumers', id],
    });
  }

  // References: "shop" (source), "orders" (product, its only output port) or "orders.orders" (product.port).
  function resolve(ref: string): { node: string; port?: string } | string {
    const dot = ref.indexOf('.');
    if (dot >= 0) {
      const [pid, portId] = [ref.slice(0, dot), ref.slice(dot + 1)];
      const p = productMap.get(pid);
      if (!p) return `There is no product "${pid}"`;
      if (!p.outputs || !(portId in p.outputs)) return `Product "${pid}" has no output port "${portId}"`;
      return { node: pid, port: portId };
    }
    if (sourceMap.has(ref)) return { node: ref };
    const p = productMap.get(ref);
    if (p) {
      const outs = Object.keys(p.outputs ?? {});
      return { node: ref, port: outs.length === 1 ? outs[0] : undefined };
    }
    return `There is no source or product "${ref}"`;
  }
  /** What a reference reads from: the source or the product, by its name. */
  function refLabel(ref: string): string {
    const r = resolve(ref);
    if (typeof r === 'string') return ref;
    return sourceMap.get(r.node)?.label ?? productMap.get(r.node)?.label ?? r.node;
  }
  /** Beside it: a source's kind of system, or the port it reads of a product that has several. */
  function refDetail(ref: string): string {
    const r = resolve(ref);
    if (typeof r === 'string') return '';
    const s = sourceMap.get(r.node);
    if (s) return (sourceKinds[s.kind ?? ''] ?? sourceKinds.application!).label;
    const outputs = productMap.get(r.node)?.outputs ?? {};
    return r.port && Object.keys(outputs).length > 1 ? (port(outputs[r.port]!).label ?? r.port) : '';
  }

  let edges: GraphEdge[] = [];
  const styleOf = new Map<string, keyof typeof styles>();
  const merged = new Map<string, GraphEdge>();
  const edge = (from: Endpoint, to: Endpoint, style: keyof typeof styles, label: string | undefined, path: (string | number)[]) => {
    const s: { line: GraphEdge['line']; tone?: Tone } = styles[style];
    // Between two cards, several ports collapse into one line.
    const key = !from.row && !to.row ? `${from.node}|${to.node}|${style}` : undefined;
    const same = key ? merged.get(key) : undefined;
    if (same) {
      if (label && !same.label?.split(', ').includes(label)) same.label = same.label ? `${same.label}, ${label}` : label;
      return;
    }
    // A foreign key reads as in an ERD: many rows here point at one row there.
    const [start, end]: [GraphEdge['start'], GraphEdge['end']] = style === 'relation' ? ['zeroOrMany', 'one'] : ['none', style === 'contract' ? 'none' : 'arrow'];
    const e: GraphEdge = { id: `e${edges.length}`, from, to, label, line: s.line, tone: s.tone, start, end, path };
    edges.push(e);
    styleOf.set(e.id, style);
    if (key) merged.set(key, e);
  };
  const flowFrom = (ref: Ref, path: (string | number)[], to: Endpoint) => {
    const { from, label } = refOf(ref);
    const r = resolve(from);
    if (typeof r === 'string') return ctx.error(path, r);
    const start: Endpoint = r.port && detailed.has(r.node) ? { node: r.node, row: `out:${r.port}` } : { node: r.node };
    // In a detailed product the input row already says what the label would.
    edge(start, to, 'flow', to.row ? undefined : label, path);
  };

  for (const [id, p] of products)
    for (const [i, r] of (p.inputs ?? []).entries())
      flowFrom(r, ['products', id, 'inputs', i], detailed.has(id) ? { node: id, row: `in:${i}` } : { node: id });
  for (const [id, c] of consumers) for (const [i, r] of (c.uses ?? []).entries()) flowFrom(r, ['consumers', id, 'uses', i], { node: id });

  // Contracts sit next to the output port they govern, only where that port is visible.
  const shown = new Set<string>();
  for (const [id, p] of products)
    for (const [pid, o] of outputsOf(p)) {
      if (!o.contract) continue;
      const path = ['products', id, 'outputs', pid, 'contract'];
      const c = contracts.get(o.contract);
      const model = models.get(o.contract);
      if (!c) {
        ctx.error(path, `There is no data contract "${o.contract}"`);
        continue;
      }
      if (!showContracts || !detailed.has(id) || !model) continue;
      if (!shown.has(o.contract)) {
        shown.add(o.contract);
        nodes.push({ id: `contract:${o.contract}`, parent: domainOf(p.domain, []), shape: contractShape(o.contract, c, model, src['contract-fields'] ?? 12, word), path: ['contracts', o.contract] });
      }
      edge({ node: id, row: `out:${pid}` }, { node: `contract:${o.contract}` }, 'contract', undefined, path);
      edges.at(-1)!.annex = true;
    }

  // Foreign keys of the contracts (ODCS relationships): field to field, inside a contract and between two that are both drawn.
  const rowOf = (contract: string, at: { schema: number; field: string }): Endpoint => {
    const node = nodes.find((n) => n.id === `contract:${contract}`)!;
    const rows = node.shape.kind === 'table' ? node.shape.rows : [];
    const has = (id: string) => rows.some((r) => r.kind === 'row' && r.id === id);
    // A field past "+ n more" is spoken for by that row.
    return has(`field:${at.schema}:${at.field}`) ? { node: node.id, row: `field:${at.schema}:${at.field}` } : has('field:more') ? { node: node.id, row: 'field:more' } : { node: node.id };
  };
  for (const id of shown) {
    const model = models.get(id)!;
    for (const r of model.relations ?? []) {
      const path = ['contracts', id, 'file'];
      const other = r.to.file ? contractAt(contracts, contracts.get(id)!.file!, r.to.file) : id;
      const written = `${r.from.field} → ${r.to.file ? `${r.to.file}#` : ''}${r.to.schema}.${r.to.field}`;
      // Another contract that is not in this diagram: the key mark on the field is all there is to say.
      if (!other) continue;
      const target = findField(models.get(other)?.schemas ?? [], r.to.schema, r.to.field);
      if (!target) {
        ctx.warn(path, `${contracts.get(id)!.file}: relationship ${written} points at a field that ${other === id ? 'this contract' : `"${other}"`} does not have`);
        continue;
      }
      if (!shown.has(other)) continue;
      const [from, to] = [rowOf(id, r.from), rowOf(other, target)];
      // With the fields hidden there is nothing in one card to draw a line between.
      if (from.node === to.node && (!from.row || !to.row || from.row === to.row)) continue;
      edge(from, to, 'relation', r.label, path);
      // A contract stands by its product; a key to another contract does not move it.
      if (from.node !== to.node) edges.at(-1)!.loose = true;
    }
  }

  // A tall contract stands in two columns, its guarantees and checks beside its schema: about as tall
  // as its product, so it sits by it without lifting the drawing. Not one with keys drawn to its fields:
  // a line to a field would cross the second column.
  for (const id of shown) {
    const node = nodes.find((n) => n.id === `contract:${id}`)!;
    if (node.shape.kind !== 'table' || edges.some((e) => (e.from.node === node.id && e.from.row) || (e.to.node === node.id && e.to.row))) continue;
    const rows = node.shape.rows;
    const at = rows.findIndex((r, i) => i > 0 && r.kind === 'section' && (r.label === word('Guarantees') || r.label === word('Quality checks')));
    if (rows.length >= SPLIT_ROWS && at > 0) node.shape = { ...node.shape, split: at };
  }

  let drawn = nodes;
  let drawnGroups = groups;
  if (part) {
    // The products in view and their contracts, and the cards one line away from them: nothing further.
    const core = new Set([...detailed, ...nodes.filter((n) => n.id.startsWith('contract:')).map((n) => n.id)]);
    const keep = new Set(core);
    for (const e of edges) {
      if (core.has(e.from.node)) keep.add(e.to.node);
      if (core.has(e.to.node)) keep.add(e.from.node);
    }
    // A card from another domain stands on its own, its domain named first: one box for the domain in view keeps the slide narrow.
    const own = part.domain ? `domain:${part.domain}` : undefined;
    drawn = nodes
      .filter((n) => keep.has(n.id))
      .map((n) => {
        if (!n.parent || n.parent === own) return n;
        const g = groups.find((x) => x.id === n.parent)!;
        // A product from elsewhere is a neighbour here: its domain and class say enough (its version and team are in its own view).
        const product = productMap.get(n.id);
        const caption = product && !product.caption ? [g.label, (classes[product.class ?? ''] ?? classes['source-aligned']!).label] : [g.label, n.shape.kind === 'card' ? n.shape.caption : undefined];
        const shape = n.shape.kind === 'card' ? { ...n.shape, caption: caption.filter(Boolean).join(' · ') } : n.shape;
        return { ...n, parent: undefined, shape };
      });
    edges = edges.filter((e) => keep.has(e.from.node) && keep.has(e.to.node) && (core.has(e.from.node) || core.has(e.to.node)));
    drawnGroups = groups.filter((g) => g.id === own);
  }
  const usedClasses = new Set(drawn.map((n) => classOf.get(n.id)));
  const used = new Set(edges.map((e) => styleOf.get(e.id)));
  const legend: LegendItem[] = [
    ...Object.keys(classes)
      .filter((c) => usedClasses.has(c))
      .map((c): LegendItem => ({ label: classes[c]!.label, swatch: 'fill', icon: classes[c]!.icon, tone: classes[c]!.tone })),
    ...(Object.keys(styles) as (keyof typeof styles)[])
      .filter((k) => used.has(k))
      .map((k): LegendItem => {
        const s: { label: string; line: GraphEdge['line']; tone?: Tone } = styles[k];
        return { label: s.label, line: s.line, tone: s.tone };
      }),
  ];
  return { title: src.title, subtitle: src.subtitle, direction: src.direction ?? 'right', groups: drawnGroups, nodes: drawn, edges, legend };
}

/** A contract from its file (if any) with the keys written in the diagram on top. */
function contractModel(c: Contract, path: (string | number)[], ctx: BuildContext): ContractModel | undefined {
  let m: ContractModel = { schemas: [], sla: [], quality: [] };
  if (c.file) {
    const at = [...path, 'file'];
    if (!ctx.load) return ctx.error(at, 'Contract files can only be read where the diagram is a file (CLI, or a folder opened in the web app)'), undefined;
    let text: string;
    try {
      text = ctx.load(c.file);
    } catch {
      return ctx.error(at, `Cannot read "${c.file}"`), undefined;
    }
    const parsed = parseSource(text);
    const broken = parsed.diagnostics.find((d) => d.severity === 'error');
    if (broken) return ctx.error(at, `${c.file} line ${broken.line}: ${broken.message}`), undefined;
    const read = readOdcs(parsed.data);
    if (typeof read === 'string') return ctx.error(at, `${c.file}: ${read}`), undefined;
    m = read;
    for (const note of m.notes ?? []) ctx.warn(at, `${c.file}: ${note}`);
  }
  const fields = Object.entries(c.fields ?? {});
  const sla = Object.entries(c.sla ?? {});
  return {
    // Fields written in the diagram replace the file's, and its relationships with them.
    ...(m.relations && !fields.length ? { relations: m.relations } : {}),
    label: c.label ?? m.label,
    version: c.version != null ? String(c.version) : m.version,
    classification: c.classification ?? m.classification,
    schemas: fields.length ? [{ fields: fields.map(([name, spec]) => ({ name, ...parseField(spec) })) }] : m.schemas,
    sla: sla.length ? sla.map(([k, v]) => [k, String(v)]) : m.sla,
    quality: c.quality ?? m.quality,
  };
}

/** The contract (by id) whose file a reference in another contract file names: relative to that file, else by file name. */
function contractAt(contracts: Map<string, Contract>, from: string, ref: string): string | undefined {
  const clean = ref.replace(/^file:\/\//, '');
  const parts: string[] = [];
  for (const p of [...from.split('/').slice(0, -1), ...clean.split('/')]) {
    if (p === '..') parts.pop();
    else if (p && p !== '.') parts.push(p);
  }
  const files = [...contracts].filter(([, c]) => c.file);
  const norm = (f: string) => f.replace(/^\.\//, '');
  const exact = files.find(([, c]) => norm(c.file!) === parts.join('/'));
  if (exact) return exact[0];
  const base = clean.split('/').pop();
  const named = files.filter(([, c]) => c.file!.split('/').pop() === base);
  return named.length === 1 ? named[0]![0] : undefined;
}

function contractShape(id: string, c: Contract, m: ContractModel, maxFields: number, word: Word): GraphNode['shape'] {
  const rows: TableRow[] = [];
  let room = maxFields;
  let hidden = 0;
  for (const [i, schema] of m.schemas.entries()) {
    if (!schema.fields.length) continue;
    // Several schema objects (tables, topics) each get their own section.
    if (room > 0) rows.push({ kind: 'section', label: m.schemas.length > 1 ? (schema.name ?? word('Schema')) : word('Schema') });
    for (const f of schema.fields) {
      if (room-- <= 0) {
        hidden++;
        continue;
      }
      rows.push({ kind: 'row', id: `field:${i}:${f.name}`, marks: f.marks, cells: [{ text: f.name, strong: f.marks.includes('pk') }, { text: f.type, muted: true, mono: true }] });
    }
  }
  if (hidden && maxFields > 0) rows.push({ kind: 'row', id: 'field:more', cells: [{ text: word('+ {count} more field|+ {count} more fields', { count: String(hidden) }), muted: true }] });
  if (m.sla.length) rows.push({ kind: 'section', label: word('Guarantees') });
  for (const [k, v] of m.sla) rows.push({ kind: 'row', id: `sla:${k}`, icon: 'gauge', tone: CONTRACT_TONE, cells: [{ text: k }, { text: v, muted: true }] });
  if (m.quality.length) rows.push({ kind: 'section', label: word('Quality checks') });
  for (const [i, q] of m.quality.entries()) rows.push({ kind: 'row', id: `quality:${i}`, icon: 'check', tone: 'green', cells: [{ text: q }] });
  const caption = c.caption ?? ['Data contract', m.version != null && `v${m.version}`, m.classification].filter(Boolean).join(' · ');
  return { kind: 'table', title: m.label ?? id, caption, icon: 'file-check', tone: CONTRACT_TONE, rows };
}

// ---------------------------------------------------------------- schema

const named = { label: { type: 'string' }, caption: { type: 'string' } };
const ref = {
  anyOf: [
    { type: 'string', description: 'A source, a product, or product.port' },
    {
      type: 'object',
      required: ['from'],
      properties: {
        from: { type: 'string', description: 'A source, a product, or product.port' },
        label: { type: 'string', description: 'How it arrives, e.g. CDC or daily batch' },
        name: { type: 'string', description: 'Name of the input port' },
      },
      additionalProperties: false,
    },
  ],
};
const placed = (kinds: KindTable, extra: Record<string, object> = {}) => ({
  anyOf: [
    { enum: Object.keys(kinds) },
    { type: 'null' },
    { type: 'object', properties: { kind: { enum: Object.keys(kinds) }, ...named, domain: { type: 'string' }, ...extra }, additionalProperties: false },
  ],
});
const ids = (value: object) => ({ type: 'object', propertyNames: { pattern: idPattern }, additionalProperties: value });

const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Cartography data products diagram',
  type: 'object',
  required: ['type'],
  properties: {
    type: { const: 'data-products' },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    direction: { enum: ['right', 'down'] },
    view: {
      anyOf: [{ enum: ['overview', 'detailed'] }, { type: 'string', pattern: '^detailed-.+$' }],
      description:
        "overview: products as cards; detailed-<domain>: one domain's products with ports, contracts and fields (detailed-other: those without a domain); detailed-<product>: one product so, for a domain with several products and a contract among them; detailed: every product",
    },
    detail: { type: 'array', items: { type: 'string' }, description: 'Products shown in detail in the overview' },
    'show-contracts': { type: 'boolean', description: 'Show data contracts next to detailed products (default true)' },
    'contract-fields': { type: 'integer', minimum: 0, description: 'Most fields a contract shows before "+ n more" (default 12, 0 hides fields)' },
    domains: ids({ anyOf: [{ type: 'string' }, { type: 'null' }, { type: 'object', properties: { ...named, owner: { type: 'string' } }, additionalProperties: false }] }),
    sources: ids(placed(sourceKinds)),
    products: ids({
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: {
            ...named,
            class: { enum: Object.keys(classes), description: 'source-aligned, aggregate or consumer-aligned' },
            domain: { type: 'string' },
            owner: { type: 'string' },
            version: { type: ['string', 'number'] },
            status: { type: 'string', description: 'Shown after the class, e.g. draft or deprecated' },
            detail: { type: 'boolean', description: 'Show this product in detail in the overview' },
            inputs: { type: 'array', items: ref, description: 'Input ports: where the data comes from' },
            outputs: ids({
              anyOf: [
                { enum: Object.keys(portKinds) },
                { type: 'null' },
                {
                  type: 'object',
                  properties: { kind: { enum: Object.keys(portKinds) }, ...named, contract: { type: 'string', description: 'Id under contracts' } },
                  additionalProperties: false,
                },
              ],
            }),
          },
          additionalProperties: false,
        },
      ],
    }),
    consumers: ids(placed(consumerKinds, { uses: { type: 'array', items: ref, description: 'Products or product.port it reads' } })),
    contracts: ids({
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: {
            ...named,
            file: { type: 'string', description: 'An Open Data Contract Standard file (v3 or v2), relative to this diagram' },
            version: { type: ['string', 'number'] },
            classification: { type: 'string', description: 'e.g. internal, confidential' },
            fields: { type: 'object', additionalProperties: { type: ['string', 'null'] }, description: 'name: type, with pk, pii, unique, null' },
            sla: { type: 'object', additionalProperties: { type: ['string', 'number'] }, description: 'e.g. freshness: 1 hour' },
            quality: { type: 'array', items: { type: 'string' } },
          },
          additionalProperties: false,
        },
      ],
    }),
  },
  additionalProperties: false,
};

const palette: PaletteItem[] = [
  { collection: 'domains', kind: 'domain', label: 'Domain', icon: 'square-stack', tone: 'slate' },
  ...Object.entries(sourceKinds).map(([kind, k]) => ({ collection: 'sources', kind, ...k })),
  ...Object.entries(classes).map(([kind, k]) => ({ collection: 'products', kind, ...k })),
  ...Object.entries(consumerKinds).map(([kind, k]) => ({ collection: 'consumers', kind, ...k })),
  { collection: 'contracts', kind: 'contract', label: 'Data contract', icon: 'file-check', tone: CONTRACT_TONE },
];

export const dataProducts: DiagramType<DataProductSource> = {
  id: 'data-products',
  name: 'Data products',
  description: 'Domains, data products with input and output ports, data contracts and consumers',
  icon: 'boxes',
  tagline: 'Data mesh: domains, products, their ports, contracts and consumers',
  useWhen: [
    'Which data products feed which, through which ports',
    'Link data contracts (ODCS) to the ports they describe',
    'Who consumes a product: reports, models, apps',
    'A folder of ODPS and ODCS files as one data mesh map',
  ],
  notFor: [
    { text: 'The tables inside one database', use: 'erd' },
    { text: 'ETL jobs and services as boxes', use: 'systems' },
  ],
  keywords: ['data product', 'data mesh', 'domain', 'contract', 'odcs', 'port', 'lineage', 'consumer', 'dataset', 'dashboard', 'report', 'analytics', 'warehouse', 'lakehouse', 'sla'],
  schema,
  palette,
  build,
  // Lineage reads from where data comes from to who uses it: left to right, never turned for its shape (a long one is cut into rows).
  tuning: { autoDirection: false },
  references(src) {
    const out: Reference[] = [];
    const products = src.products ?? {};
    const of = (id: string) => (Object.hasOwn(products, id) ? 'products' : src.sources && Object.hasOwn(src.sources, id) ? 'sources' : undefined);
    // "orders" or "orders.port": the product part is the reference.
    const refs = (list: Ref[] | undefined, path: (string | number)[]) =>
      (list ?? []).forEach((r, i) => {
        const at = typeof r === 'string' ? [...path, i] : [...path, i, 'from'];
        const id = (typeof r === 'string' ? r : r.from).split('.')[0]!;
        const collection = of(id);
        if (collection) out.push({ path: at, id, start: 0, collection, onDelete: 'item' });
      });
    for (const c of ['sources', 'products', 'consumers'] as const)
      for (const [id, e] of Object.entries(src[c] ?? {}))
        if (e && typeof e === 'object' && typeof e.domain === 'string') out.push({ path: [c, id, 'domain'], id: e.domain, start: 0, collection: 'domains' });
    for (const [id, p] of Object.entries(products)) {
      refs(p?.inputs, ['products', id, 'inputs']);
      for (const [port, o] of Object.entries(p?.outputs ?? {}))
        if (o && typeof o === 'object' && typeof o.contract === 'string') out.push({ path: ['products', id, 'outputs', port, 'contract'], id: o.contract, start: 0, collection: 'contracts' });
    }
    for (const [id, c] of Object.entries(src.consumers ?? {})) if (c && typeof c === 'object') refs(c.uses, ['consumers', id, 'uses']);
    (src.detail ?? []).forEach((id, i) => out.push({ path: ['detail', i], id, start: 0, collection: 'products' }));
    return out;
  },
  views(src, word = english) {
    if (!src.products || !Object.keys(src.products).length) return [];
    const overview = { name: 'overview', title: word('Overview') };
    // A part that draws just what the overview as written draws is not offered twice.
    const parts = detailParts(src, word).map((p) => (!p.hidden && src.detail?.length && sameAsOverview(src, p) ? { ...p, hidden: true } : p));
    // One domain (or none) drawn whole: one detailed drawing. Else one per domain or product, the whole mesh in detail only when asked for.
    if (parts.length < 2) return [overview, { name: 'detailed', title: word('Detailed') }];
    return [
      overview,
      // A product or a domain in detail reads from left to right in one band: what it reads, the products and their contracts, who reads them.
      ...parts.filter((p) => !p.hidden).map((p) => ({ name: p.view, title: p.title, part: true, steady: true })),
      { name: 'detailed', title: word('Every product in detail'), hidden: true },
      ...parts.filter((p) => p.hidden).map((p) => ({ name: p.view, title: p.title, part: true, steady: true, hidden: true })),
    ];
  },
  connect(src, from, to) {
    if (from === to) return 'Pick another element to connect to';
    const product = src.products?.[from];
    // From a product with several output ports, take the first: the port is easy to change in the YAML.
    const ports = Object.keys(product?.outputs ?? {});
    const ref = ports.length > 1 ? `${from}.${ports[0]}` : from;
    const source = !!src.sources && from in src.sources;
    if (src.products && to in src.products && (source || product !== undefined)) return { path: ['products', to, 'inputs'], value: ref };
    if (src.consumers && to in src.consumers && (product !== undefined || source)) return { path: ['consumers', to, 'uses'], value: ref };
    return 'Data flows from a source or product into a product, or into a consumer';
  },
  template: `type: data-products
title: Customer data products
subtitle: From operational systems to fit-for-purpose products
view: overview   # overview, or detailed-<domain> or detailed-<product>: ports and contracts (the view picker lists them)
# detail: [customer-360]   # only these products in detail

domains:
  sales: { label: Sales, owner: Sales engineering }
  customer: { label: Customer, owner: CRM team }
  marketing: { label: Marketing }

sources:
  shop: { kind: application, label: Webshop, domain: sales }
  crm: { kind: saas, label: Salesforce, domain: customer }

products:
  orders:
    label: Orders
    class: source-aligned
    domain: sales
    inputs: [{ from: shop, label: CDC }]
    outputs:
      orders: { kind: table, contract: orders }
  customers:
    label: Customers
    class: source-aligned
    domain: customer
    inputs: [{ from: crm, label: daily }]
    outputs:
      customers: { kind: table, contract: customers }
  customer-360:
    label: Customer 360
    class: aggregate
    domain: customer
    inputs: [orders.orders, customers.customers]
    outputs:
      profile: { kind: table, label: profiles }
  churn:
    label: Churn risk
    class: consumer-aligned
    domain: marketing
    inputs: [customer-360]
    outputs:
      scores: { kind: api, label: churn scores }

consumers:
  campaigns: { kind: application, label: Campaign tool, uses: [churn] }
  bi: { kind: dashboard, label: Sales dashboard, uses: [orders, customer-360] }

contracts:
  orders:
    label: orders
    version: 2.1.0
    classification: internal
    fields:
      order_id: uuid pk
      customer_id: uuid
      total: decimal(10,2)
      ordered_at: timestamp
    sla: { freshness: 15 min, availability: 99.9% }
    quality: [order_id is unique, total >= 0]
  customers:
    label: customers
    version: 1.4.0
    classification: confidential
    fields:
      customer_id: uuid pk
      email: string pii
      country: string null
    sla: { freshness: 24 hours }
`,
};
