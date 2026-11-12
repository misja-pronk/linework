// Business capability maps: what an organisation does, in three levels, without saying how or by
// whom. Level 1 areas stand as columns (or bands), level 2 capabilities as boxes in them, level 3
// as chips in those. Any property of the capabilities can colour the map as a heatmap, and
// capabilities name the systems that support them, from a model or as plain names.
//
//   heat: maturity                         or { by: investment, values: { divest: { tone: rose, pattern: hatch } } }
//   capabilities:
//     Customer:                            a level-1 area: its capabilities as a list…
//       - Marketing: [Campaigns, Segmentation]
//       - Sales: { maturity: 3, systems: [crm] }
//     Finance:
//       capabilities:                      …or as a map
//         Accounting: { maturity: 4 }
//     Payroll: { parent: Finance }         or anywhere, with parent:
import { english, parseLink, parseLinks, tones, type BlockHeat, type BlockShape, type BuildContext, type DiagramType, type Graph, type GraphNode, type Link, type PaletteItem, type Path, type Placed, type Reference, type Sized, type Tone } from '@cartography/core';
import { pack, type PackItem } from '@cartography/tree';
import { heatScale, type HeatEntry, type HeatScale } from './heat.ts';

export { heatScale, numberOf, type HeatEntry } from './heat.ts';

type Entry = string | null | unknown[] | Record<string, unknown>;

export interface CapabilitiesSource {
  type: 'capabilities';
  title?: string;
  subtitle?: string;
  /** columns: areas side by side (default); bands: areas one under the other. */
  layout?: 'columns' | 'bands';
  /** How many levels to draw, 1–3. */
  depth?: number;
  /** Areas to a row (columns) or capabilities to a row (bands); left open, the slide decides. */
  columns?: number;
  heat?: string | HeatEntry | (string | HeatEntry)[];
  capabilities?: Record<string, Entry>;
  /** The view the type draws: map, systems, or one of the heats. */
  view?: string;
}

interface Cap {
  id: string;
  name: string;
  props: Record<string, unknown>;
  parent?: string;
  /** Written as `parent:`, resolved once all are read. */
  parentRef?: string;
  children: Cap[];
  path: Path;
  /** Where its parent reference is written, for errors. */
  refPath?: Path;
}

const heats = (h: CapabilitiesSource['heat']): HeatEntry[] => (h == null ? [] : (Array.isArray(h) ? h : [h]).map((x) => (typeof x === 'string' ? { by: x } : x)).filter((x) => x && typeof x.by === 'string'));

/** Reads every capability, nested or flat, into one tree. */
function readCapabilities(src: CapabilitiesSource, ctx: BuildContext): Cap[] {
  const all = new Map<string, Cap>();
  const order: Cap[] = [];
  const add = (name: string, raw: Entry | undefined, path: Path, parent?: Cap) => {
    let props: Record<string, unknown> = {};
    let kids: { name: string; raw: Entry | undefined; path: Path }[] = [];
    const listKids = (list: unknown[], base: Path) =>
      list.flatMap((item, i): { name: string; raw: Entry | undefined; path: Path }[] => {
        if (typeof item === 'string' || typeof item === 'number') return [{ name: String(item), raw: null, path: [...base, i] }];
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const keys = Object.keys(item);
          if (keys.length === 1) return [{ name: keys[0]!, raw: (item as Record<string, Entry>)[keys[0]!], path: [...base, i, keys[0]!] }];
        }
        ctx.error([...base, i], 'A capability in a list is a name, or "Name: [its capabilities]" or "Name: { … }"');
        return [];
      });
    if (Array.isArray(raw)) kids = listKids(raw, path);
    else if (typeof raw === 'string') props = { label: raw };
    else if (raw && typeof raw === 'object') {
      props = raw;
      const inner = raw.capabilities;
      if (Array.isArray(inner)) kids = listKids(inner, [...path, 'capabilities']);
      else if (inner && typeof inner === 'object') kids = Object.entries(inner as Record<string, Entry>).map(([k, v]) => ({ name: k, raw: v, path: [...path, 'capabilities', k] }));
    }
    // A name used twice (Reporting under Sales and under Finance) is told apart by where it stands.
    let id = name;
    if (all.has(id)) id = parent ? `${parent.id} › ${name}` : `${name} (${order.length})`;
    const cap: Cap = { id, name, props, children: [], path };
    if (parent) {
      cap.parent = parent.id;
      parent.children.push(cap);
    } else if (typeof props.parent === 'string') {
      cap.parentRef = props.parent;
      cap.refPath = [...path, 'parent'];
    }
    all.set(id, cap);
    order.push(cap);
    for (const k of kids) add(k.name, k.raw, k.path, cap);
  };
  for (const [name, raw] of Object.entries(src.capabilities ?? {})) add(name, raw, ['capabilities', name]);
  // Flat entries join their parent after the ones written inside it, in the order written.
  for (const cap of order) {
    if (!cap.parentRef) continue;
    const p = all.get(cap.parentRef);
    if (!p) {
      ctx.error(cap.refPath!, `There is no capability "${cap.parentRef}"`);
      continue;
    }
    for (let a: Cap | undefined = p; a; a = a.parent ? all.get(a.parent) : undefined)
      if (a === cap) {
        ctx.error(cap.refPath!, `"${cap.id}" would stand inside itself`);
        cap.parentRef = undefined;
        break;
      }
    if (!cap.parentRef) continue;
    cap.parent = p.id;
    p.children.push(cap);
  }
  return order.filter((c) => !c.parent);
}

const FORMS = ['area', 'capability', 'chip'] as const;

export function buildCapabilities(src: CapabilitiesSource, ctx: BuildContext): Graph {
  const roots = readCapabilities(src, ctx);
  const depth = Math.max(1, Math.min(3, Math.round(src.depth ?? 3)));
  const entries = heats(src.heat);
  const elements = ctx.model?.elements;
  const flat: { cap: Cap; level: number }[] = [];
  const walk = (c: Cap, level: number) => {
    flat.push({ cap: c, level });
    for (const k of c.children) walk(k, level + 1);
  };
  for (const r of roots) walk(r, 1);
  const deep = flat.filter((f) => f.level > 3);
  if (deep.length) ctx.warn(deep[0]!.cap.path, `A capability map has three levels; "${deep[0]!.cap.name}" is level ${deep[0]!.level}, so it is left out`);

  // What supports each capability: model elements by id, or names as written.
  const systemsOf = (c: Cap): { label: string; ref?: string }[] => {
    const raw = c.props.systems;
    const list = Array.isArray(raw) ? raw.map(String) : raw == null ? [] : [String(raw)];
    return list.map((s) => {
      const el = elements?.get(s);
      if (el && ctx.model) ctx.model.used = true;
      return el ? { label: el.label ?? el.name, ref: el.id } : { label: s };
    });
  };
  const anySystems = flat.some((f) => systemsOf(f.cap).length);
  const views = ['map', ...entries.map((e) => e.by), ...(anySystems ? ['systems'] : [])];
  const view = src.view && views.includes(src.view) ? src.view : (entries[0]?.by ?? 'map');
  const showSystems = view === 'systems';
  const entry = entries.find((e) => e.by === view);
  // Systems are counted, none as 0 (the key says "none").
  const valueOf = (c: Cap, by: string) => (by === 'systems' && typeof c.props.systems !== 'number' ? systemsOf(c).length : c.props[by]);
  const scale: HeatScale | undefined = entry ? heatScale(entry, flat.map((f) => valueOf(f.cap, entry.by))) : undefined;
  if (entry && !flat.some((f) => valueOf(f.cap, entry.by) != null)) ctx.warn(['heat'], `No capability has "${entry.by}" yet: give some a value, e.g. ${entry.by}: 3`);

  const nodes: GraphNode[] = [];
  let missing = false;
  for (const { cap, level } of flat) {
    if (level > depth) continue;
    const kids = level < depth && cap.children.length > 0;
    const sys = systemsOf(cap);
    const heat: BlockHeat | undefined = scale?.of(valueOf(cap, scale.by));
    if (scale && !heat && !kids) missing = true;
    const label = typeof cap.props.label === 'string' ? cap.props.label : cap.name;
    const caption = typeof cap.props.caption === 'string' ? cap.props.caption : undefined;
    const links = cap.props.link != null ? [parseLink(cap.props.link)].filter((l): l is Link => !!l) : parseLinks(cap.props.links);
    if (cap.props.link != null && !links?.length) ctx.error([...cap.path, 'link'], 'A link is a URL, another diagram (other.yaml) or a view (other.yaml#view)');
    const tone = tones.includes(cap.props.tone as Tone) ? (cap.props.tone as Tone) : 'slate';
    const supported = sys.length ? `Supported by ${sys.map((s) => s.label).join(', ')}` : undefined;
    const description = [typeof cap.props.description === 'string' ? cap.props.description : undefined, supported].filter(Boolean).join('. ') || undefined;
    const shape: BlockShape = {
      kind: 'block',
      form: FORMS[level - 1]!,
      label,
      ...(caption ? { caption } : {}),
      tone,
      ...(heat ? { heat } : scale && !kids ? { blank: true } : {}),
      ...(kids ? { container: true } : {}),
      ...(cap.parent ? { inside: cap.parent } : {}),
      // In the systems view every capability without children lists what supports it, or says nothing does.
      ...(showSystems && !kids ? { lines: sys.length ? sys.map((s) => s.label) : ['no system'] } : {}),
    };
    const tags = Array.isArray(cap.props.tags) ? cap.props.tags.map(String) : [];
    nodes.push({ id: cap.id, shape, path: cap.path, kind: shape.form, ...(tags.length ? { tags } : {}), ...(links?.length ? { links } : {}), ...(description ? { description } : {}) });
  }

  const legend = scale ? [...scale.legend, ...(missing ? [{ label: scale.missing, swatch: 'block' as const, block: { form: 'chip' as const } }] : [])] : undefined;
  const subtitle = src.subtitle ?? (showSystems ? 'Supporting systems per capability' : undefined);
  return {
    title: src.title,
    subtitle,
    direction: 'right',
    groups: [],
    nodes,
    edges: [],
    ...(legend?.length ? { legend } : {}),
    arrange: { mode: src.layout === 'bands' ? 'bands' : 'columns', ...(src.columns ? { columns: Math.round(src.columns) } : {}) },
  };
}

/** The map placed: blocks inside blocks, fitted to a slide. */
export function capabilityLayout(sized: Sized, previous?: string): Placed {
  const g = sized.graph;
  const items = new Map<string, PackItem>();
  const roots: PackItem[] = [];
  for (const n of g.nodes) {
    const s = sized.nodes.get(n.id) ?? { width: 0, height: 0 };
    items.set(n.id, { id: n.id, width: s.width, height: s.height, children: [] });
  }
  for (const n of g.nodes) {
    const inside = n.shape.kind === 'block' ? n.shape.inside : undefined;
    const parent = inside ? items.get(inside) : undefined;
    if (parent) parent.children!.push(items.get(n.id)!);
    else roots.push(items.get(n.id)!);
  }
  const mode = g.arrange?.mode === 'bands' ? 'bands' : 'columns';
  const columns = typeof g.arrange?.columns === 'number' ? g.arrange.columns : undefined;
  // Title above and a key below: the page around the map on a slide.
  const frame = { width: 80, height: (g.title ? 64 : 0) + (g.legend?.length ? 60 : 0) + 80 };
  const p = pack(roots, { mode, frame, previous, columns: mode === 'bands' ? [1, columns] : [columns], gap: 8, outerGap: 14, pad: 9 });
  const memory = { variant: p.variant, nodes: new Map([...p.boxes].map(([id, b]) => [id, { x: b.x + b.width / 2, y: b.y + b.height / 2 }])) };
  return { nodes: p.boxes, groups: new Map(), edges: new Map(), width: p.width, height: p.height, memory };
}

export function capabilityReferences(src: CapabilitiesSource): Reference[] {
  const out: Reference[] = [];
  const names = new Set<string>();
  const collect = (map: Record<string, Entry> | undefined) => {
    for (const [k, v] of Object.entries(map ?? {})) {
      names.add(k);
      if (v && typeof v === 'object' && !Array.isArray(v) && v.capabilities && typeof v.capabilities === 'object' && !Array.isArray(v.capabilities)) collect(v.capabilities as Record<string, Entry>);
    }
  };
  collect(src.capabilities);
  for (const [k, v] of Object.entries(src.capabilities ?? {}))
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.parent === 'string' && names.has(v.parent)) out.push({ path: ['capabilities', k, 'parent'], id: v.parent, start: 0, collection: 'capabilities', onDelete: 'key' });
  return out;
}

// ---------------------------------------------------------------- schema

const tone = { enum: tones };
const linkSchema = { type: 'string', description: 'A URL, another diagram (other.yaml) or a view (other.yaml#view)' };
const heatEntry = {
  anyOf: [
    { type: 'string', description: 'The property to colour by: maturity, investment, fit, cost, systems or any of your own' },
    {
      type: 'object',
      required: ['by'],
      properties: {
        by: { type: 'string', description: 'The property to colour by' },
        title: { type: 'string', description: 'Its name in the legend' },
        scale: { enum: ['sequential', 'diverging', 'categorical'], description: 'Numbers: sequential (one hue) or diverging (bad to good); words: categorical' },
        min: { type: 'number' },
        max: { type: 'number' },
        labels: { type: 'object', additionalProperties: { type: 'string' }, description: 'Words for numbers: { 1: Initial, 5: Optimised }' },
        values: { type: 'object', additionalProperties: { anyOf: [tone, { type: 'object', properties: { tone, label: { type: 'string' }, pattern: { enum: ['hatch', 'dots'] } }, additionalProperties: false }] }, description: 'Tones for words: { invest: green, divest: { tone: rose, pattern: hatch } }' },
        tone: { ...tone, description: 'The hue of a sequential scale' },
        reverse: { type: 'boolean', description: 'Higher is worse' },
        unit: { type: 'string', description: 'What the numbers are in, for the key: €, $, %, FTE; read from the values (€220k) when left out' },
      },
      additionalProperties: false,
    },
  ],
};
const capability = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'What it is called, when that differs from its key' },
    caption: { type: 'string' },
    description: { type: 'string', description: 'Longer text: a tooltip, and what a screen reader reads' },
    parent: { type: 'string', description: 'The capability it is part of (instead of writing it inside)' },
    systems: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'What supports it: model element ids or names' },
    owner: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    tone,
    link: linkSchema,
    links: { type: 'array', items: { anyOf: [linkSchema, { type: 'object' }] } },
    capabilities: { anyOf: [{ type: 'array' }, { type: 'object' }], description: 'The capabilities inside it' },
    // The values heatmaps usually colour by, so the editor offers them; any other property works too.
    maturity: { type: 'number', description: 'How mature it is, 1 (initial) to 5 (optimised)' },
    investment: { type: 'string', description: 'invest, maintain, tolerate, migrate, divest or eliminate' },
    fit: { type: ['number', 'string'], description: 'How well it is supported: 1–5, or good, fair, poor' },
    cost: { type: ['number', 'string'], description: 'What it costs to run: 1200000, €1.2M, 800k' },
    risk: { type: ['number', 'string'], description: '1–5, or high, medium, low' },
  },
  // Anything else is a value to colour by: maturity: 3, investment: invest, cost: €1.2M.
  additionalProperties: { type: ['number', 'string', 'boolean', 'null'] },
};

const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Cartography capability map',
  type: 'object',
  required: ['type'],
  properties: {
    type: { const: 'capabilities' },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    layout: { enum: ['columns', 'bands'], description: 'columns: level-1 areas side by side (default); bands: one under the other' },
    depth: { type: 'integer', minimum: 1, maximum: 3, description: 'How many levels to draw (default 3)' },
    columns: { type: 'integer', minimum: 1, description: 'Areas to a row (columns) or capabilities to a row (bands); left out, the slide decides' },
    heat: { anyOf: [heatEntry, { type: 'array', items: heatEntry }], description: 'Colour the map by a property; several make several views' },
    capabilities: {
      type: 'object',
      description: 'Level-1 areas, with their capabilities inside (a list or a map), or anywhere with parent:',
      additionalProperties: { anyOf: [{ type: 'null' }, { type: 'string' }, { type: 'array' }, capability] },
    },
    view: { type: 'string' },
  },
  additionalProperties: false,
};

const palette: PaletteItem[] = [{ collection: 'capabilities', kind: 'capability', label: 'Capability', icon: 'layout-grid', tone: 'slate', keywords: ['capability', 'function', 'area', 'domain', 'business'] }];

export const capabilities: DiagramType<CapabilitiesSource> = {
  id: 'capabilities',
  name: 'Capability map',
  description: 'What the business does, in three levels: areas, capabilities and sub-capabilities, with a heatmap of any property and the systems that support each',
  icon: 'layout-grid',
  tagline: 'What the business does, in levels, coloured by maturity or investment',
  useWhen: ['A business capability map for a strategy deck', 'A heatmap of maturity or investment per capability', 'Which systems support which capability', 'Where to invest, tolerate or divest'],
  notFor: [
    { text: 'The systems themselves and how they talk', use: 'systems' },
    { text: 'Who reports to whom, or which teams there are', use: 'teams' },
    { text: 'When the work happens', use: 'roadmap' },
  ],
  keywords: ['capability', 'capabilities', 'capability map', 'business capability', 'business architecture', 'heatmap', 'heat map', 'maturity', 'investment', 'time model', 'tolerate invest migrate eliminate', 'value stream', 'functional decomposition', 'domain map', 'application portfolio', 'enterprise architecture', 'bcm'],
  schema,
  palette,
  template: `type: capabilities
title: Business capability map
subtitle: Maturity per capability, 2026 baseline
heat: maturity

capabilities:
  Customer:
    - Marketing: { maturity: 3 }
    - Sales: { maturity: 4 }
    - Service: { maturity: 2 }
  Products:
    - Product management: { maturity: 3 }
    - Pricing: { maturity: 2 }
  Operations:
    - Order management: { maturity: 4 }
    - Fulfilment: { maturity: 3 }
    - Procurement: { maturity: 2 }
  Finance:
    - Accounting: { maturity: 5 }
    - Planning: { maturity: 3 }
`,
  build: buildCapabilities,
  references: capabilityReferences,
  unconnected: true,
  freeNames: true,
  refKeys: { parent: ['capabilities'] },
  views(src, word = english) {
    // The first heat is what the file draws by default. Its scale's title is a word of the type's (Maturity) or the key as written.
    const out: { name: string; title: string; default?: boolean }[] = [{ name: 'map', title: word('Map') }, ...heats(src.heat).map((h, i) => ({ name: h.by, title: word('Heatmap: {scale}', { scale: word(heatScale(h, []).title) }), ...(i ? {} : { default: true }) }))];
    const any = (map: Record<string, Entry> | undefined): boolean => JSON.stringify(map ?? {}).includes('"systems"');
    if (any(src.capabilities) && !out.some((v) => v.name === 'systems')) out.push({ name: 'systems', title: word('Supporting systems') });
    return out.length > 1 ? out : [];
  },
  async layout(sized, _pins, previous) {
    return capabilityLayout(sized, previous?.variant);
  },
};
