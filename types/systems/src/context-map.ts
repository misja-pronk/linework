// A DDD context map: bounded contexts and how they relate, drawn the way Context Mapper and the DDD
// community draw them. A line runs upstream -> downstream; its ends say U and D and carry the
// patterns of each side (OHS and PL upstream, ACL and CF downstream); symmetric relationships
// (partnership, shared kernel, separate ways) are named on the line instead.
//
//   nodes:
//     catalog: { kind: context, label: Catalogue, domain: core }
//   edges:
//     - catalog -> orders: { relation: customer-supplier, upstream: [OHS, PL], downstream: [ACL] }
//     - orders -- billing: { relation: partnership }
//
// A light type of its own rather than more edge styles on `systems`: a context map has its own words
// (bounded context, upstream, conformist) and a palette of thirty service kinds would drown them. It is
// built on the same graph source, so focus, steps, views and model refs work as they do there.
import { buildGraph, edgeItemSchema, graphReferences, graphSchema, parseEdge, type DiagramType, type GraphSource, type GraphTypeConfig, type LegendItem, type PaletteItem, type Tone } from '@cartography/core';

export const relations = {
  partnership: { label: 'Partnership', symmetric: true },
  'shared-kernel': { label: 'Shared kernel', symmetric: true },
  'customer-supplier': { label: 'Customer/Supplier', symmetric: false },
  'upstream-downstream': { label: 'Upstream/Downstream', symmetric: false },
  conformist: { label: 'Conformist', symmetric: false },
  'anticorruption-layer': { label: 'Anticorruption layer', symmetric: false },
  'open-host-service': { label: 'Open host service', symmetric: false },
  'published-language': { label: 'Published language', symmetric: false },
  'separate-ways': { label: 'Separate ways', symmetric: true },
} as const;
type Relation = keyof typeof relations;
/** Short names people write for the relationships, as in Context Mapper's DSL. */
const aliases: Record<string, Relation> = { p: 'partnership', sk: 'shared-kernel', cs: 'customer-supplier', 'customer/supplier': 'customer-supplier', ud: 'upstream-downstream', cf: 'conformist', acl: 'anticorruption-layer', ohs: 'open-host-service', pl: 'published-language' };

const upstreamPatterns = ['OHS', 'PL'] as const;
const downstreamPatterns = ['ACL', 'CF'] as const;
export const patternNames: Record<string, string> = { U: 'Upstream', D: 'Downstream', OHS: 'Open host service', PL: 'Published language', ACL: 'Anticorruption layer', CF: 'Conformist' };

/** Strategic classification of a context's subdomain: in the caption and the tone, so not by colour alone. */
const domains: Record<string, { label: string; tone: Tone }> = {
  core: { label: 'Core domain', tone: 'violet' },
  supporting: { label: 'Supporting subdomain', tone: 'blue' },
  generic: { label: 'Generic subdomain', tone: 'slate' },
};

export const contextMapConfig: GraphTypeConfig = {
  groupKinds: {
    domain: { label: 'Domain', icon: 'layers', tone: 'indigo', border: 'dashed', keywords: ['subdomain', 'area'] },
    team: { label: 'Team', icon: 'users', tone: 'violet', border: 'dashed', keywords: ['owner'] },
    group: { label: 'Group', icon: 'square-stack', tone: 'slate', quiet: true },
  },
  nodeKinds: {
    context: { label: 'Bounded context', icon: 'box', tone: 'blue', keywords: ['bounded context', 'service', 'module'] },
    legacy: { label: 'Legacy system', icon: 'archive', tone: 'slate', keywords: ['monolith', 'erp', 'big ball of mud'] },
    external: { label: 'External system', icon: 'earth', tone: 'slate', keywords: ['third party', 'saas', 'partner'] },
    team: { label: 'Team', icon: 'users', tone: 'violet' },
  },
  kindAliases: { 'bounded-context': 'context', service: 'context', system: 'context', 'software-system': 'context', 'external-system': 'external' },
};

interface MapSource extends GraphSource {
  [key: string]: unknown;
}

const palette: PaletteItem[] = [
  ...Object.entries(contextMapConfig.groupKinds).map(([kind, k]) => ({ collection: 'groups', kind, ...k })),
  ...Object.entries(contextMapConfig.nodeKinds).map(([kind, k]) => ({ collection: 'nodes', kind, ...k })),
];

function schema(): object {
  const s = graphSchema('context-map', contextMapConfig, 'Cartography context map') as { properties: Record<string, any> };
  const node = s.properties.nodes.additionalProperties.anyOf.find((x: { type?: string }) => x.type === 'object');
  node.properties = { ...node.properties, domain: { enum: Object.keys(domains), description: 'Its subdomain: core, supporting or generic' } };
  const patterns = (list: readonly string[]) => ({ type: 'array', items: { enum: list } });
  s.properties.edges = {
    type: 'array',
    items: edgeItemSchema({
      relation: { enum: [...Object.keys(relations), ...Object.keys(aliases)], description: 'How the two contexts relate; a -> b reads upstream -> downstream' },
      upstream: { ...patterns(upstreamPatterns), description: 'Patterns on the upstream side: OHS, PL' },
      downstream: { ...patterns(downstreamPatterns), description: 'Patterns on the downstream side: ACL, CF' },
    }),
  };
  return s;
}

function build(src: MapSource, ctx: Parameters<DiagramType['build']>[1]) {
  const graph = buildGraph(src, contextMapConfig, ctx);
  const used = new Set<string>();
  const kinds = new Set<Relation>();
  for (const e of graph.edges) {
    const spec = e.path[0] === 'edges' ? parseEdge(src.edges?.[Number(e.path[1])], e.path) : undefined;
    const props = typeof spec === 'object' ? spec.props : {};
    const raw = typeof props.relation === 'string' ? props.relation : undefined;
    const rel: Relation | undefined = raw ? ((raw in relations ? raw : aliases[raw]) as Relation) : props.upstream || props.downstream ? 'upstream-downstream' : undefined;
    if (!rel) continue;
    kinds.add(rel);
    const r = relations[rel];
    // A context map's lines say who depends on whom at their ends, not with arrowheads.
    e.start = 'none';
    e.end = 'none';
    if (r.symmetric) {
      e.label = e.label ? `${r.label}: ${e.label}` : r.label;
      if (rel === 'separate-ways') e.line = 'dotted';
      if (rel === 'shared-kernel') e.width = 1.6;
      continue;
    }
    const up = new Set<string>(Array.isArray(props.upstream) ? props.upstream.filter((x): x is string => typeof x === 'string') : []);
    const down = new Set<string>(Array.isArray(props.downstream) ? props.downstream.filter((x): x is string => typeof x === 'string') : []);
    if (rel === 'open-host-service') up.add('OHS');
    if (rel === 'published-language') up.add('PL');
    if (rel === 'conformist') down.add('CF');
    if (rel === 'anticorruption-layer') down.add('ACL');
    const from = ['U', ...upstreamPatterns.filter((p) => up.has(p))];
    const to = ['D', ...downstreamPatterns.filter((p) => down.has(p))];
    for (const t of [...from, ...to]) used.add(t);
    e.ends = { from, to };
    if (!e.label && rel === 'customer-supplier') e.label = r.label;
  }
  for (const n of graph.nodes) {
    const raw = src.nodes?.[n.id];
    const d = raw && typeof raw === 'object' ? domains[(raw as { domain?: string }).domain ?? ''] : undefined;
    if (d && n.shape.kind === 'card') n.shape = { ...n.shape, caption: d.label, tone: d.tone };
  }
  // The key says what the letters mean: U and D first, then the patterns drawn, then the subdomains.
  const legend: LegendItem[] = Object.keys(patternNames)
    .filter((t) => used.has(t))
    .map((t) => ({ label: patternNames[t]!, swatch: 'mark' as const, tag: t }));
  const seen = new Set(graph.nodes.map((n) => (n.shape.kind === 'card' ? n.shape.caption : undefined)));
  for (const d of Object.values(domains)) if (seen.has(d.label)) legend.push({ label: d.label, swatch: 'tile', icon: contextMapConfig.nodeKinds.context!.icon, tone: d.tone });
  graph.legend = [...legend, ...(graph.legend ?? [])];
  return graph;
}

export const contextMap: DiagramType<MapSource> = {
  id: 'context-map',
  name: 'Context map',
  description: 'DDD bounded contexts and how they relate: partnership, shared kernel, customer/supplier, conformist, ACL, OHS',
  icon: 'map',
  tagline: 'Bounded contexts and who depends on whom (DDD)',
  useWhen: [
    'Strategic design: which bounded contexts there are and how they integrate',
    'Who is upstream, and who protects itself with an anticorruption layer',
    'Core, supporting and generic subdomains at a glance',
  ],
  notFor: [
    { text: 'How requests flow between services', use: 'systems' },
    { text: 'A C4 view of one system', use: 'c4' },
  ],
  keywords: ['ddd', 'domain-driven design', 'context map', 'bounded context', 'upstream', 'downstream', 'anticorruption layer', 'acl', 'open host service', 'published language', 'shared kernel', 'conformist', 'partnership', 'subdomain', 'context mapper', 'strategic design'],
  schema: schema(),
  palette,
  build,
  references: graphReferences,
  connect(src, from, to) {
    if (from === to) return 'Pick another context to connect to';
    const known = (id: string) => (!!src.nodes && Object.hasOwn(src.nodes, id)) || (!!src.groups && Object.hasOwn(src.groups, id));
    if (!known(from) || !known(to)) return 'Connect one context to another';
    return { path: ['edges'], value: { [`${from} -> ${to}`]: { relation: 'customer-supplier' } } };
  },
  template: `type: context-map
title: E-commerce context map
subtitle: Bounded contexts and how they integrate

groups:
  sales: { kind: domain, label: Sales }
  fulfilment: { kind: domain, label: Fulfilment }

nodes:
  catalog: { kind: context, label: Catalogue, domain: supporting, in: sales }
  pricing: { kind: context, label: Pricing, domain: core, in: sales }
  ordering: { kind: context, label: Ordering, domain: core, in: sales }
  billing: { kind: context, label: Billing, domain: generic }
  shipping: { kind: context, label: Shipping, domain: supporting, in: fulfilment }
  warehouse: { kind: legacy, label: Warehouse ERP, in: fulfilment }
  payments: { kind: external, label: Payment provider }

edges:
  - catalog -> ordering: { relation: customer-supplier, upstream: [OHS, PL] }
  - pricing -- ordering: { relation: partnership }
  - ordering -> shipping: { relation: customer-supplier }
  - ordering -> billing: { relation: customer-supplier }
  - warehouse -> shipping: { relation: anticorruption-layer, label: stock levels }
  - payments -> billing: { relation: conformist }
`,
};

