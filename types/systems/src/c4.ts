// The C4 model: people, software systems, containers and components described once, drawn as
// landscape, context, container, component, dynamic and deployment views. Cards say what each thing
// is the C4 way ("[Container: Spring Boot]") with a short description; external elements are greyed;
// boundaries are dashed and named "[Software System]". See docs/c4.md.
//
//   type: c4
//   elements:
//     customer: { kind: person, label: Customer, description: Buys things online }
//     shop:
//       kind: software-system
//       elements:
//         web: { kind: web-app, technology: React }
//         api: { kind: container, technology: Spring Boot }
//   relations:
//     - customer -> shop.web: { label: Browses, technology: HTTPS }
//   views:
//     context: { kind: context, of: shop }
//     containers: { kind: container, of: shop }
import {
  buildGraph,
  emptyCatalogue,
  trustKeys,
  graphReferences,
  graphSchema,
  viewSource,
  type DiagramType,
  type Entry,
  type Graph,
  type GraphSource,
  type GraphTypeConfig,
  type LegendItem,
  type ModelContext,
  type ModelElement,
  type PaletteItem,
} from '@cartography/core';

/** C4 names the type in each card: [Person], [Software System], [Container: tech], [Component: tech]. */
type Level = 'Person' | 'Software System' | 'Container' | 'Component' | 'Infrastructure Node' | 'Deployment Node' | 'Enterprise' | undefined;

const kind = (label: string, icon: string, tone: GraphTypeConfig['nodeKinds'][string]['tone'], level: Level, keywords?: string[], legend = label) => ({ label, icon, tone, level, legend, ...(keywords ? { keywords } : {}) });

const nodeKinds = {
  person: { ...kind('Person', 'user-round', 'indigo', 'Person', ['user', 'actor', 'customer', 'staff']), form: 'person' as const },
  'software-system': kind('Software System', 'boxes', 'blue', 'Software System', ['system', 'application', 'product'], 'Software system'),
  container: kind('Container', 'box', 'sky', 'Container', ['service', 'api', 'backend', 'application']),
  'web-app': kind('Web app', 'app-window', 'sky', 'Container', ['spa', 'frontend', 'browser', 'website']),
  'mobile-app': kind('Mobile app', 'smartphone', 'sky', 'Container', ['ios', 'android']),
  'desktop-app': kind('Desktop app', 'monitor', 'sky', 'Container'),
  database: kind('Database', 'database', 'violet', 'Container', ['sql', 'postgres', 'schema', 'db', 'data store']),
  queue: kind('Queue', 'send', 'violet', 'Container', ['topic', 'kafka', 'message bus', 'event stream']),
  storage: kind('File storage', 'archive', 'violet', 'Container', ['bucket', 'blob', 's3', 'files']),
  component: kind('Component', 'package', 'teal', 'Component', ['module', 'controller', 'class']),
  infrastructure: kind('Infrastructure node', 'server-cog', 'slate', 'Infrastructure Node', ['infrastructure', 'node']),
  'load-balancer': kind('Load balancer', 'scale', 'slate', 'Infrastructure Node', ['lb', 'ingress'], 'Infrastructure node'),
  gateway: kind('API gateway', 'split', 'slate', 'Infrastructure Node', ['proxy', 'ingress'], 'Infrastructure node'),
  firewall: kind('Firewall', 'shield', 'slate', 'Infrastructure Node', ['waf'], 'Infrastructure node'),
  dns: kind('DNS', 'hash', 'slate', 'Infrastructure Node', [], 'Infrastructure node'),
  cdn: kind('CDN', 'globe', 'slate', 'Infrastructure Node', ['edge'], 'Infrastructure node'),
};

const groupKinds = {
  'software-system': { ...kind('Software System', 'boxes', 'blue', 'Software System'), border: 'dashed' as const },
  container: { ...kind('Container', 'box', 'sky', 'Container'), border: 'dashed' as const },
  enterprise: { ...kind('Enterprise', 'building-complex', 'slate', 'Enterprise', ['organisation', 'company']), border: 'dashed' as const },
  'deployment-node': kind('Deployment node', 'server', 'slate', 'Deployment Node', ['environment', 'cluster', 'region', 'vm', 'pod', 'host']),
  boundary: { ...kind('Boundary', 'square-dashed', 'slate', undefined), border: 'dashed' as const },
  group: { ...kind('Group', 'square-stack', 'slate', undefined), quiet: true, border: 'dashed' as const },
};

type Kind = { label: string; icon: string; level: Level; legend: string };
const kindOf = (k: string | undefined): Kind | undefined => (k ? ((nodeKinds as Record<string, Kind>)[k] ?? (groupKinds as Record<string, Kind>)[k]) : undefined);

export const c4Config: GraphTypeConfig = {
  groupKinds,
  nodeKinds,
  // C4 draws every relationship the same; the label and its [technology] say what it is.
  edgeStyles: {
    sync: { label: 'Synchronous', line: 'solid' },
    async: { label: 'Asynchronous', line: 'dashed' },
    data: { label: 'Data flow', line: 'solid', tone: 'teal' },
    dotted: { label: 'Supporting', line: 'dotted' },
  },
  plainEdge: 'Relationship',
  trust: true,
  // Words of the architecture type and of other tools, for models shared with it.
  kindAliases: {
    system: 'software-system',
    external: 'software-system',
    'external-system': 'software-system',
    user: 'person',
    users: 'person',
    actor: 'person',
    service: 'container',
    api: 'container',
    worker: 'container',
    function: 'container',
    job: 'container',
    server: 'container',
    client: 'web-app',
    web: 'web-app',
    spa: 'web-app',
    mobile: 'mobile-app',
    desktop: 'desktop-app',
    db: 'database',
    cache: 'database',
    warehouse: 'database',
    topic: 'queue',
    bus: 'queue',
    'event-stream': 'queue',
    bucket: 'storage',
    // Azure Databricks' data stores (the azure type's kinds); its compute and pipelines are containers by depth.
    'sql-warehouse': 'database',
    catalog: 'database',
    volume: 'storage',
    'external-location': 'storage',
  },
};

/** Model elements in C4 terms: their kind, an alias, or what their depth means (system → container → component). */
function c4Elements(els: Map<string, ModelElement>): Map<string, ModelElement> {
  const out = new Map<string, ModelElement>();
  for (const [id, el] of els) {
    const k = el.kind;
    const depth = id.split('.').length - 1;
    const known = k && (k in nodeKinds || k in groupKinds) ? k : k ? c4Config.kindAliases![k] : undefined;
    const mapped = known ?? (depth === 0 ? 'software-system' : depth === 1 ? 'container' : 'component');
    const external = k === 'external' || k === 'external-system';
    out.set(id, { ...el, kind: mapped, tags: external && !el.tags.includes('external') ? [...el.tags, 'external'] : el.tags });
  }
  return out;
}

const entryOf = (v: string | Entry | null | undefined): Entry => (typeof v === 'string' ? { kind: v } : (v ?? {}));
const external = (e: Entry) => !!e.tags?.includes('external');

/** "[Container: Spring Boot]": the C4 type line, with the technology when there is one. */
function typeLine(e: Entry, k: Kind | undefined): string | undefined {
  // A deployment node's caption is technology and count, already split out here.
  const tech = e.technology ?? (e.count ? undefined : e.caption);
  const count = e.count && e.count > 1 ? ` ×${e.count}` : '';
  if (!k?.level) return tech ? tech + count : count.trim() || undefined;
  return `[${k.level}${tech ? `: ${tech}` : ''}]${count}`;
}

/** The C4 look on a built graph: type lines, descriptions in the cards, greyed externals, the legend. */
function decorate(graph: Graph, src: GraphSource): Graph {
  const seen = new Map<string, LegendItem>();
  let boundary = false;
  for (const n of graph.nodes) {
    const e = entryOf(src.nodes?.[n.id]);
    const k = kindOf(e.kind);
    if (n.shape.kind !== 'card') continue;
    // An external person stays in colour (outside the enterprise only); external systems are greyed.
    const ext = external(e) && k?.level !== 'Person';
    const caption = e.caption && !e.technology && e.caption !== kindOf(e.kind)?.label && !e.ref ? e.caption : typeLine(e, k);
    n.shape = {
      ...n.shape,
      ...(caption ? { caption } : {}),
      ...(e.description ? { body: e.description } : {}),
      ...(ext ? { muted: true, tone: 'slate' as const } : {}),
    };
    if (k) {
      const label = ext ? (k.level === 'Person' ? 'External person' : 'External system') : k.legend;
      if (!seen.has(label)) seen.set(label, { label, swatch: 'tile', icon: k.icon, tone: ext ? 'slate' : n.shape.tone, ...(ext ? { muted: true } : {}) });
    }
  }
  for (const g of graph.groups) {
    const e = entryOf(src.groups?.[g.id]);
    const k = kindOf(e.kind);
    g.caption = typeLine(e, k) ?? g.caption;
    if (external(e)) g.tone = 'slate';
    if (g.border === 'dashed' && k?.level) boundary = true;
  }
  // Element types first, in C4 order, then boundaries and lines.
  const order = ['Person', 'External person', 'Software system', 'External system', 'Container', 'Web app', 'Mobile app', 'Desktop app', 'Database', 'Queue', 'File storage', 'Component', 'Infrastructure node'];
  const items = [...seen.values()].sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  const lines = graph.legend ?? [];
  // A plain line needs a name too once the legend explains the cards.
  const plain = graph.edges.some((e) => !e.badge && !e.kind && e.line === 'solid' && !e.tone);
  if (plain && !lines.some((l) => l.label === c4Config.plainEdge)) lines.unshift({ label: c4Config.plainEdge!, line: 'solid' });
  graph.legend = [...items, ...(boundary ? [{ label: 'Boundary', swatch: 'boundary' as const }] : []), ...(graph.edges.length ? lines : [])];
  return graph;
}

const palette: PaletteItem[] = [
  ...Object.entries(groupKinds).map(([k, v]) => ({ collection: 'groups', kind: k, label: v.label, icon: v.icon, tone: v.tone, ...('keywords' in v ? { keywords: v.keywords } : {}) })),
  ...Object.entries(nodeKinds).map(([k, v]) => ({ collection: 'nodes', kind: k, label: v.label, icon: v.icon, tone: v.tone, ...('keywords' in v ? { keywords: v.keywords } : {}) })),
];

export const c4: DiagramType<GraphSource> = {
  id: 'c4',
  name: 'C4 model',
  description: 'People, software systems, containers and components, drawn as C4 views of one model',
  icon: 'boxes',
  tagline: 'One model, C4 views: context, containers, components, deployment',
  useWhen: [
    'A system context diagram for a design doc',
    'Container and component diagrams of one system',
    'A numbered walk-through of one scenario (dynamic view)',
    'Which containers run on which deployment nodes',
  ],
  notFor: [
    { text: 'A quick boxes-and-arrows sketch', use: 'systems' },
    { text: 'Azure resources and networks', use: 'azure' },
    { text: 'AWS or Google Cloud accounts, VPCs and services', use: 'cloud' },
  ],
  keywords: [
    'c4',
    'c4 model',
    'context diagram',
    'system context',
    'container diagram',
    'component diagram',
    'landscape',
    'dynamic view',
    'deployment diagram',
    'structurizr',
    'likec4',
    'icepanel',
    'person',
    'software system',
  ],
  schema: graphSchema('c4', c4Config, 'Cartography C4 model'),
  palette,
  // "Places orders [JSON/HTTPS]" is longer than most labels: the columns make room for it.
  tuning: { labelRoom: 'fit' },
  build(src, ctx) {
    const refs = (['groups', 'nodes'] as const).some((c) => Object.values(src[c] ?? {}).some((v) => v == null || (typeof v === 'object' && v.ref != null)));
    let resolved = src;
    if (ctx.model || refs) {
      const m: ModelContext = ctx.model ? { ...ctx.model, elements: c4Elements(ctx.model.elements) } : { ...emptyCatalogue() };
      // Its trust boundaries stay with the diagram, whichever view is drawn.
      resolved = { ...viewSource(src, c4Config, m, ctx), ...trustKeys(src as Record<string, unknown>) };
      if (ctx.model) ctx.model.used = true;
    }
    const graph = buildGraph(resolved, c4Config, { ...ctx, model: undefined });
    return decorate(graph, resolved);
  },
  references: graphReferences,
  connect(src, from, to) {
    if (from === to) return 'Pick another element to connect to';
    const known = (id: string) => (!!src.nodes && Object.hasOwn(src.nodes, id)) || (!!src.groups && Object.hasOwn(src.groups, id));
    if (!known(from) || !known(to)) return 'Connect one node or group to another';
    return { path: ['edges'], value: `${from} -> ${to}` };
  },
  template: `type: c4
title: Web shop

elements:
  customer: { kind: person, label: Customer, description: Buys products online }
  staff: { kind: person, label: Shop staff, description: Keeps products and prices up to date }
  shop:
    kind: software-system
    label: Web shop
    description: Sells products and takes orders
    elements:
      web: { kind: web-app, label: Storefront, technology: Next.js, description: Product pages and checkout }
      api: { kind: container, label: Orders API, technology: Spring Boot, description: Takes and tracks orders }
      db: { kind: database, label: Orders DB, technology: PostgreSQL, description: Orders and stock }
  payments: { kind: software-system, label: Payment provider, external: true, description: Charges cards }
  email: { kind: software-system, label: E-mail service, external: true, description: Sends order confirmations }

relations:
  - customer -> shop.web: { label: Browses and orders, technology: HTTPS }
  - shop.web -> shop.api: { label: Places orders, technology: JSON/HTTPS }
  - shop.api -> shop.db: { label: Reads and writes, technology: SQL }
  - staff -> shop.web: { label: Manages the catalogue, technology: HTTPS }
  - shop.api -> payments: { label: Charges cards, technology: REST }
  - shop.api -> email: { label: Sends confirmations, technology: SMTP }

views:
  context: { kind: context, of: shop, title: Web shop — system context }
  containers: { kind: container, of: shop, title: Web shop — containers }
`,
};
