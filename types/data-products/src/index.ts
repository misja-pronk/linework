// Data products (data mesh): domains, source systems, data products with input and output ports,
// data contracts on output ports, and consumers. One file, two levels of detail:
//   overview   products as cards, lineage between them
//   detailed   products as tables with their ports; lines attach to the exact port, contracts beside them
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
  type RowMark,
  type TableRow,
  type Tone,
} from '@cartography/core';
import { readOdcs, type ContractModel } from './odcs.ts';

export { readOdcs, type ContractModel } from './odcs.ts';

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
} as const satisfies Record<string, { label: string; line: GraphEdge['line']; tone?: Tone }>;

const CONTRACT_TONE: Tone = 'violet';

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
  view?: 'overview' | 'detailed';
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

  const detailed = new Set(src.view === 'detailed' ? products.map(([id]) => id) : products.filter(([, p]) => p.detail).map(([id]) => id));
  for (const [i, id] of (src.detail ?? []).entries()) {
    if (productMap.has(id)) detailed.add(id);
    else ctx.error(['detail', i], `There is no product "${id}"`);
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
  const usedClasses = new Set<string>();
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
    usedClasses.add(p.class ?? 'source-aligned');
    const caption = p.caption ?? [k.label, p.owner, p.version != null && `v${p.version}`].filter(Boolean).join(' · ');
    const parent = domainOf(p.domain, ['products', id, 'domain']);
    if (!detailed.has(id)) {
      nodes.push({ id, parent, shape: { kind: 'card', label: p.label ?? id, caption, icon: k.icon, tone: k.tone }, path: ['products', id] });
      continue;
    }
    const rows: TableRow[] = [];
    if (p.inputs?.length) rows.push({ kind: 'section', label: 'Input ports' });
    for (const [i, r] of (p.inputs ?? []).entries()) {
      const ref = refOf(r);
      const name = ref.name ?? refLabel(ref.from);
      const from = ref.label ?? refKind(ref.from);
      rows.push({
        kind: 'row',
        id: `in:${i}`,
        icon: 'arrow-right-to-line',
        tone: 'slate',
        // "orders · orders" says nothing twice: the product name only shows when the port is named otherwise.
        cells: [{ text: name }, { text: from === name ? '' : from, muted: true }],
      });
    }
    const outs = outputsOf(p);
    if (outs.length) rows.push({ kind: 'section', label: 'Output ports' });
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
    nodes.push({ id, parent, shape: { kind: 'table', title: p.label ?? id, caption, icon: k.icon, tone: k.tone, rows }, path: ['products', id] });
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
  function refLabel(ref: string): string {
    const r = resolve(ref);
    if (typeof r === 'string') return ref;
    if (r.port) return port(productMap.get(r.node)!.outputs![r.port]!).label ?? r.port;
    return sourceMap.get(r.node)?.label ?? productMap.get(r.node)?.label ?? r.node;
  }
  function refKind(ref: string): string {
    const r = resolve(ref);
    if (typeof r === 'string') return '';
    const s = sourceMap.get(r.node);
    if (s) return (sourceKinds[s.kind ?? ''] ?? sourceKinds.application!).label;
    return productMap.get(r.node)?.label ?? r.node;
  }

  const edges: GraphEdge[] = [];
  const used = new Set<keyof typeof styles>();
  const merged = new Map<string, GraphEdge>();
  const edge = (from: Endpoint, to: Endpoint, style: keyof typeof styles, label: string | undefined, path: (string | number)[]) => {
    used.add(style);
    const s: { line: GraphEdge['line']; tone?: Tone } = styles[style];
    // Between two cards, several ports collapse into one line.
    const key = !from.row && !to.row ? `${from.node}|${to.node}|${style}` : undefined;
    const same = key ? merged.get(key) : undefined;
    if (same) {
      if (label && !same.label?.split(', ').includes(label)) same.label = same.label ? `${same.label}, ${label}` : label;
      return;
    }
    const e: GraphEdge = { id: `e${edges.length}`, from, to, label, line: s.line, tone: s.tone, start: 'none', end: style === 'contract' ? 'none' : 'arrow', path };
    edges.push(e);
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
        nodes.push({ id: `contract:${o.contract}`, parent: domainOf(p.domain, []), shape: contractShape(o.contract, c, model, src['contract-fields'] ?? 12), path: ['contracts', o.contract] });
      }
      edge({ node: id, row: `out:${pid}` }, { node: `contract:${o.contract}` }, 'contract', undefined, path);
    }

  const legend: LegendItem[] = [
    ...Object.keys(classes)
      .filter((c) => usedClasses.has(c))
      .map((c): LegendItem => ({ label: classes[c]!.label, swatch: 'fill', tone: classes[c]!.tone })),
    ...(Object.keys(styles) as (keyof typeof styles)[])
      .filter((k) => used.has(k))
      .map((k): LegendItem => {
        const s: { label: string; line: GraphEdge['line']; tone?: Tone } = styles[k];
        return { label: s.label, line: s.line, tone: s.tone };
      }),
  ];
  return { title: src.title, subtitle: src.subtitle, direction: src.direction ?? 'right', groups, nodes, edges, legend };
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
  }
  const fields = Object.entries(c.fields ?? {});
  const sla = Object.entries(c.sla ?? {});
  return {
    label: c.label ?? m.label,
    version: c.version != null ? String(c.version) : m.version,
    classification: c.classification ?? m.classification,
    schemas: fields.length ? [{ fields: fields.map(([name, spec]) => ({ name, ...parseField(spec) })) }] : m.schemas,
    sla: sla.length ? sla.map(([k, v]) => [k, String(v)]) : m.sla,
    quality: c.quality ?? m.quality,
  };
}

function contractShape(id: string, c: Contract, m: ContractModel, maxFields: number): GraphNode['shape'] {
  const rows: TableRow[] = [];
  let room = maxFields;
  let hidden = 0;
  for (const [i, schema] of m.schemas.entries()) {
    if (!schema.fields.length) continue;
    // Several schema objects (tables, topics) each get their own section.
    if (room > 0) rows.push({ kind: 'section', label: m.schemas.length > 1 ? (schema.name ?? 'Schema') : 'Schema' });
    for (const f of schema.fields) {
      if (room-- <= 0) {
        hidden++;
        continue;
      }
      rows.push({ kind: 'row', id: `field:${i}:${f.name}`, marks: f.marks, cells: [{ text: f.name, strong: f.marks.includes('pk') }, { text: f.type, muted: true, mono: true }] });
    }
  }
  if (hidden && maxFields > 0) rows.push({ kind: 'row', id: 'field:more', cells: [{ text: `+ ${hidden} more field${hidden === 1 ? '' : 's'}`, muted: true }] });
  if (m.sla.length) rows.push({ kind: 'section', label: 'Guarantees' });
  for (const [k, v] of m.sla) rows.push({ kind: 'row', id: `sla:${k}`, icon: 'gauge', tone: CONTRACT_TONE, cells: [{ text: k }, { text: v, muted: true }] });
  if (m.quality.length) rows.push({ kind: 'section', label: 'Quality checks' });
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
    view: { enum: ['overview', 'detailed'], description: 'overview: products as cards; detailed: ports, contracts and fields' },
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
  schema,
  palette,
  build,
  connect(src, from, to) {
    const product = src.products?.[from];
    // From a product with several output ports, take the first: the port is easy to change in the YAML.
    const ports = Object.keys(product?.outputs ?? {});
    const ref = ports.length > 1 ? `${from}.${ports[0]}` : from;
    const source = !!src.sources && from in src.sources;
    if (src.products && to in src.products && (source || product !== undefined)) return { path: ['products', to, 'inputs'], value: ref };
    if (src.consumers && to in src.consumers && product !== undefined) return { path: ['consumers', to, 'uses'], value: ref };
    return 'Data flows from a source or product into a product, or from a product to a consumer';
  },
  template: `type: data-products
title: Customer data products
subtitle: From operational systems to fit-for-purpose products
view: overview   # overview or detailed
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
    class: source-aligned
    domain: sales
    inputs: [{ from: shop, label: CDC }]
    outputs:
      orders: { kind: table, contract: orders }
  customers:
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
