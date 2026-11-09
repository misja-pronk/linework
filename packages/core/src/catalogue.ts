// The shared model: elements described once (in a `type: model` file or a diagram's own `elements:`),
// relations between them, and named views. Diagrams reference elements by id instead of redefining
// them, and a view picks what one drawing shows.
//
//   type: model
//   elements:
//     customer: { kind: person, label: Customer }
//     shop:
//       kind: system
//       label: Web shop
//       links: [containers.yaml]
//       elements:
//         api: { kind: api, label: Orders API, technology: .NET }
//   relations:
//     - customer -> shop.api: Places orders
//   views:
//     context: { include: [shop, '*->shop'] }
//     containers: { expand: [shop] }
import { edgeItemSchema, parseEdge } from './edges.ts';
import { idPattern } from './diagram-type.ts';
import { tones, type Direction, type Link, type Path, type Tone } from './model.ts';

export interface ModelElement {
  /** Dotted path from the top of the model, e.g. "shop.api". */
  id: string;
  /** Its own key, e.g. "api". */
  name: string;
  parent?: string;
  kind?: string;
  label?: string;
  description?: string;
  technology?: string;
  owner?: string;
  tags: string[];
  /** As written; parsed where they are drawn. */
  links?: unknown[];
  icon?: string;
  tone?: Tone;
  /** Where it is written, as a path in the diagram being drawn (an include entry for other files). */
  at: Path;
}

export interface ModelRelation {
  /** Element ids (dotted paths). */
  from: string;
  to: string;
  label?: string;
  style?: string;
  at: Path;
  /** Position in the model, for a stable edge id. */
  index: number;
}

export interface ViewSpec {
  name: string;
  title?: string;
  subtitle?: string;
  direction?: Direction;
  /** Element ids, `id.*` (its children), `tag:x`, `kind:x`, `*`, or relations `a -> b` with `*` for any side. */
  include?: string[];
  exclude?: string[];
  /** Elements drawn as a boundary with their children inside, instead of one card. */
  expand?: string[];
  at: Path;
}

export interface Catalogue {
  elements: Map<string, ModelElement>;
  relations: ModelRelation[];
  views: Map<string, ViewSpec>;
}

export interface ModelContext extends Catalogue {
  /** The view to draw; none draws the diagram as written. */
  view?: ViewSpec;
  /** Set by a type that resolved the model itself. */
  used?: boolean;
}

export const emptyCatalogue = (): Catalogue => ({ elements: new Map(), relations: [], views: new Map() });

/** Top-level keys that belong to the model layer, not to a diagram type. */
export const modelKeys = ['include', 'elements', 'relations', 'views'] as const;

type Report = (path: Path, message: string, severity?: 'error' | 'warning') => void;

/**
 * Reads `elements:`, `relations:` and `views:` of one file into the catalogue. `at` turns a path in
 * that file into the path diagnostics should point at (itself for the diagram, its include entry otherwise).
 * An included file (`included` set) brings elements and relations; its links are made relative to the
 * diagram, and its views stay its own: they are what rendering that file shows.
 */
export function readModel(data: Record<string, unknown>, cat: Catalogue, at: (p: Path) => Path, report: Report, file = 'this file', included?: (link: string) => string) {
  const walk = (map: unknown, parent: ModelElement | undefined, base: Path) => {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return;
    for (const [name, raw] of Object.entries(map as Record<string, unknown>)) {
      const path = [...base, name];
      const id = parent ? `${parent.id}.${name}` : name;
      const o = (raw && typeof raw === 'object' ? raw : typeof raw === 'string' ? { kind: raw } : {}) as Record<string, unknown>;
      if (cat.elements.has(id)) {
        report(at(path), `Element "${id}" in ${file} is already in the model`);
        continue;
      }
      const str = (k: string) => (typeof o[k] === 'string' || typeof o[k] === 'number' ? String(o[k]) : undefined);
      const el: ModelElement = {
        id,
        name,
        parent: parent?.id,
        kind: str('kind'),
        label: str('label'),
        description: str('description'),
        technology: str('technology'),
        owner: str('owner'),
        tags: Array.isArray(o.tags) ? o.tags.map(String) : [],
        ...(Array.isArray(o.links) ? { links: included ? o.links.map((l) => rebase(l, included)) : o.links } : {}),
        icon: str('icon'),
        tone: tones.includes(o.tone as Tone) ? (o.tone as Tone) : undefined,
        at: at(path),
      };
      cat.elements.set(id, el);
      walk(o.elements, el, [...path, 'elements']);
    }
  };
  walk(data.elements, undefined, ['elements']);

  if (Array.isArray(data.relations))
    for (const [i, item] of data.relations.entries()) {
      const spec = parseEdge(item, ['relations', i]);
      if (typeof spec === 'string') {
        report(at(['relations', i]), spec);
        continue;
      }
      // Model ids are dotted paths: "shop.api" is one element, not a row.
      const full = (e: { node: string; row?: string }) => (e.row ? `${e.node}.${e.row}` : e.node);
      const style = typeof spec.props.style === 'string' ? spec.props.style : undefined;
      cat.relations.push({ from: full(spec.from), to: full(spec.to), label: spec.label, style, at: at(['relations', i]), index: cat.relations.length });
    }

  if (!included && data.views && typeof data.views === 'object' && !Array.isArray(data.views))
    for (const [name, raw] of Object.entries(data.views as Record<string, unknown>)) {
      if (cat.views.has(name)) {
        report(at(['views', name]), `View "${name}" in ${file} is already defined`);
        continue;
      }
      const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const list = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]).map(String) : typeof o[k] === 'string' ? [o[k] as string] : undefined);
      cat.views.set(name, {
        name,
        title: typeof o.title === 'string' ? o.title : undefined,
        subtitle: typeof o.subtitle === 'string' ? o.subtitle : undefined,
        direction: o.direction === 'right' || o.direction === 'down' ? o.direction : undefined,
        include: list('include'),
        exclude: list('exclude'),
        expand: list('expand'),
        at: at(['views', name]),
      });
    }
}

/** A file or view link written in another file, as seen from the diagram. */
function rebase(raw: unknown, move: (link: string) => string): unknown {
  const l = parseLink(raw);
  if (!l || l.kind === 'url') return raw;
  const to = move(l.target);
  return typeof raw === 'string' ? to : { ...(raw as object), to };
}

/** A link as written: "https://…", "other.yaml", "other.yaml#view", "#view", or { to, label }. */
export function parseLink(v: unknown): Link | undefined {
  const o = typeof v === 'string' ? { to: v } : v && typeof v === 'object' ? (v as { to?: unknown; label?: unknown }) : undefined;
  if (!o || typeof o.to !== 'string' || !o.to.trim()) return undefined;
  const target = o.to.trim();
  const label = typeof o.label === 'string' ? o.label : undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return { kind: 'url', target, ...(label ? { label } : {}) };
  const hash = target.indexOf('#');
  const file = hash < 0 ? target : target.slice(0, hash);
  const view = hash < 0 ? undefined : target.slice(hash + 1) || undefined;
  return { kind: view ? 'view' : 'file', target, file, ...(view ? { view } : {}), ...(label ? { label } : {}) };
}

export function parseLinks(list: unknown): Link[] | undefined {
  if (!Array.isArray(list)) return undefined;
  const out = list.map(parseLink).filter((l): l is Link => !!l);
  return out.length ? out : undefined;
}

/** Where a link goes in an exported SVG: diagrams become the SVG the CLI writes next to them. */
export function linkHref(link: Link, self?: string): string | undefined {
  if (link.kind === 'url') return link.target;
  const file = link.file || self;
  if (!file) return undefined;
  // Other files (an ADR, a runbook) are linked as they are.
  if (!/\.ya?ml$/i.test(file)) return link.target;
  const base = file.replace(/\.ya?ml$/i, '');
  return link.view ? `${base}-${link.view}.svg` : `${base}.svg`;
}

// ---------------------------------------------------------------- schemas

const link = {
  anyOf: [
    { type: 'string', description: 'A URL, other.yaml, other.yaml#view or #view' },
    { type: 'object', required: ['to'], properties: { to: { type: 'string' }, label: { type: 'string' } }, additionalProperties: false },
  ],
};
export const linksSchema = { type: 'array', items: link, description: 'URLs, other diagrams or views (other.yaml#view); drawn as a link icon' };
const tags = { type: 'array', items: { type: 'string' }, description: 'Free words that views select with tag:name' };

/** Fields any element can carry for the model layer, also on nodes and groups of graph types. */
export const elementFields = {
  description: { type: 'string', description: 'Longer text, shown as a tooltip' },
  technology: { type: 'string', description: 'Shown as caption, e.g. React or PostgreSQL' },
  owner: { type: 'string' },
  tags,
  links: linksSchema,
};

// Nested to a fixed depth instead of $ref, so autocomplete can walk it: system → container → component.
function elementSchema(depth: number): object {
  const props: Record<string, object> = {
    kind: { type: 'string', description: 'What it is; mapped to each diagram type, e.g. person, system, service, database' },
    label: { type: 'string' },
    ...elementFields,
    icon: { type: 'string' },
    tone: { enum: tones },
  };
  if (depth > 0) props.elements = { type: 'object', propertyNames: { pattern: idPattern }, additionalProperties: elementSchema(depth - 1), description: 'Parts of this element' };
  return { anyOf: [{ type: 'null' }, { type: 'string', description: 'Its kind' }, { type: 'object', properties: props, additionalProperties: false }] };
}

const selectors = { type: 'array', items: { type: 'string', description: 'id, id.*, tag:x, kind:x, * or a relation like "* -> shop"' } };
const viewSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    subtitle: { type: 'string' },
    direction: { enum: ['right', 'down'] },
    include: { ...selectors, description: 'What the view shows (default: everything at the top)' },
    exclude: { ...selectors, description: 'Left out of what include picked' },
    expand: { type: 'array', items: { type: 'string' }, description: 'Elements drawn as a boundary with their parts inside' },
  },
  additionalProperties: false,
};

/** Top-level properties of the model layer, merged into a type's schema. */
export const modelProperties = {
  include: {
    anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    description: 'Other YAML files merged into this one, relative to it (a type: model file or one of this type)',
  },
  elements: { type: 'object', propertyNames: { pattern: idPattern }, additionalProperties: elementSchema(3), description: 'Shared elements that nodes reference with ref:' },
  relations: { type: 'array', items: edgeItemSchema({ style: { type: 'string' } }), description: 'Relations between model elements, e.g. "shop.web -> shop.api: REST"' },
  views: { type: 'object', propertyNames: { pattern: idPattern }, additionalProperties: viewSchema, description: 'Named views: what each drawing of this model shows' },
};

/** The schema of a `type: model` file. */
export const modelSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Cartography model',
  type: 'object',
  required: ['type'],
  properties: { type: { const: 'model' }, title: { type: 'string' }, subtitle: { type: 'string' }, direction: { enum: ['right', 'down'] }, ...modelProperties },
  additionalProperties: false,
};
