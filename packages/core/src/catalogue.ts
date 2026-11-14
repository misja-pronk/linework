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
import { stepItemSchemas } from './steps.ts';
import { focusSchema } from './focus.ts';
import { viewLayersSchema } from './layers.ts';
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
  /** How it talks, e.g. HTTPS/JSON: drawn after the label as "Places orders [HTTPS/JSON]". */
  technology?: string;
  style?: string;
  tags?: string[];
  at: Path;
  /** Position in the model, for a stable edge id. */
  index: number;
}

/** C4 view kinds: each picks its elements from the model by itself (see c4-views.ts). */
export const viewKinds = ['landscape', 'context', 'container', 'component', 'dynamic', 'deployment'] as const;
export type ViewKind = (typeof viewKinds)[number];

/** One numbered interaction of a dynamic view: "customer -> shop.web: Browses". */
export interface StepSpec {
  from: string;
  to: string;
  label?: string;
  technology?: string;
  at: Path;
}

export interface ViewSpec {
  name: string;
  kind?: ViewKind;
  /** The element a context, container, component or dynamic view is about. */
  of?: string;
  /** A landscape or context view draws the elements that are not external inside a boundary with this name. */
  enterprise?: string;
  steps?: StepSpec[];
  /** Steps for presenting the view, as written (see steps.ts). */
  present?: unknown[];
  /** Deployment nodes of a deployment view, as written (nested `nodes:`, `instances:` of model elements). */
  nodes?: Record<string, unknown>;
  /** Extra lines of a deployment view, between deployment nodes or instances. */
  edges?: unknown[];
  title?: string;
  subtitle?: string;
  direction?: Direction;
  /** Element ids (a group written here: with what is in it), `id.*` (its children), `tag:x`, `kind:x`, `env:x`, `*`, or relations `a -> b` with `*` for any side. */
  include?: string[];
  exclude?: string[];
  /** Elements drawn as a boundary with their children inside, instead of one card. */
  expand?: string[];
  /** Only an element and its neighbourhood, as written (see focus.ts). */
  focus?: unknown;
  /** A deployment view of one environment: entries with another `env:` are left out. */
  environment?: string;
  /** Drawn through these layers (layers.ts), named under `layers:` at the top. */
  layers?: string[];
  /** The view claims to deploy everything: true for every part of every system, or the elements it is about. */
  complete?: true | string[];
  /** One of the type's own drawings (an access diagram's graph, access matrix or roles table) this view draws. */
  show?: string;
  at: Path;
}

/** A view of an included file, by name: where an instance links back to. */
export interface IncludedView {
  file: string;
  name: string;
  kind?: ViewKind;
  of?: string;
  expand?: string[];
}

export interface Catalogue {
  elements: Map<string, ModelElement>;
  relations: ModelRelation[];
  views: Map<string, ViewSpec>;
  /** Views of included files. They stay those files' own; nodes with `of:` link to the one that shows their element. */
  includedViews?: IncludedView[];
  /** Relations of the model this file leaves out of every drawing (`exclude:` at the top), as written. */
  exclude?: string[];
  /**
   * `present: views`: the diagram as written is a working canvas, not a slide. Its views are what is
   * presented: drawn first, checked, exported and described; the whole is drawn when asked for (view '').
   */
  present?: 'views';
}

export interface ModelContext extends Catalogue {
  /** The view to draw; none draws the diagram as written. */
  view?: ViewSpec;
  /** Set by a type that resolved the model itself. */
  used?: boolean;
}

export const emptyCatalogue = (): Catalogue => ({ elements: new Map(), relations: [], views: new Map() });

/** Top-level keys that belong to the model layer, not to a diagram type. */
export const modelKeys = ['include', 'elements', 'relations', 'views', 'exclude', 'present'] as const;

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
        // `external: true` is the C4 way of saying it; views select it as tag:external.
        tags: [...(Array.isArray(o.tags) ? o.tags.map(String) : []), ...(o.external === true && !(o.tags as unknown[] | undefined)?.includes('external') ? ['external'] : [])],
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
      const style = typeof spec.props.style === 'string' ? spec.props.style : undefined;
      const technology = typeof spec.props.technology === 'string' ? spec.props.technology : undefined;
      const tags = Array.isArray(spec.props.tags) && spec.props.tags.length ? { tags: spec.props.tags.map(String) } : {};
      cat.relations.push({ from: full(spec.from), to: full(spec.to), label: spec.label, ...(technology ? { technology } : {}), style, ...tags, at: at(['relations', i]), index: cat.relations.length });
    }

  // What the file itself says about its drawings; an included file's stay its own.
  if (!included && data.exclude != null) {
    const rules = (Array.isArray(data.exclude) ? data.exclude : [data.exclude]).map(String);
    rules.forEach((r, i) => {
      if (!r.includes('->')) report(at(Array.isArray(data.exclude) ? ['exclude', i] : ['exclude']), `exclude: at the top leaves relations of the model out, such as "${r} -> *"; leave a node out by not writing it, or in a view`, 'warning');
    });
    const kept = rules.filter((r) => r.includes('->'));
    if (kept.length) cat.exclude = kept;
  }
  if (!included && data.present === 'views') cat.present = 'views';

  if (included && data.views && typeof data.views === 'object' && !Array.isArray(data.views))
    for (const [name, raw] of Object.entries(data.views as Record<string, unknown>)) {
      const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const kind = viewKinds.find((k) => k === o.kind);
      (cat.includedViews ??= []).push({
        file,
        name,
        ...(kind ? { kind } : {}),
        ...(typeof o.of === 'string' ? { of: o.of } : {}),
        ...(Array.isArray(o.expand) ? { expand: o.expand.map(String) } : typeof o.expand === 'string' ? { expand: [o.expand] } : {}),
      });
    }

  if (!included && data.views && typeof data.views === 'object' && !Array.isArray(data.views))
    for (const [name, raw] of Object.entries(data.views as Record<string, unknown>)) {
      if (cat.views.has(name)) {
        report(at(['views', name]), `View "${name}" in ${file} is already defined`);
        continue;
      }
      const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const list = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]).map(String) : typeof o[k] === 'string' ? [o[k] as string] : undefined);
      const steps: StepSpec[] = [];
      // A dynamic view's steps are its numbered relations; any other view's steps are for presenting.
      if (Array.isArray(o.steps) && o.kind === 'dynamic')
        for (const [j, item] of o.steps.entries()) {
          const vp = at(['views', name, 'steps', j]);
          const spec = parseEdge(item, vp);
          if (typeof spec === 'string') report(vp, spec);
          else steps.push({ from: full(spec.from), to: full(spec.to), label: spec.label, ...(typeof spec.props.technology === 'string' ? { technology: spec.props.technology } : {}), at: vp });
        }
      const kind = viewKinds.find((k) => k === o.kind);
      cat.views.set(name, {
        name,
        ...(kind ? { kind } : {}),
        ...(typeof o.of === 'string' ? { of: o.of } : {}),
        ...(typeof o.enterprise === 'string' ? { enterprise: o.enterprise } : {}),
        ...(steps.length ? { steps } : {}),
        ...(Array.isArray(o.steps) && o.kind !== 'dynamic' ? { present: o.steps } : {}),
        ...(o.nodes && typeof o.nodes === 'object' && !Array.isArray(o.nodes) ? { nodes: o.nodes as Record<string, unknown> } : {}),
        ...(Array.isArray(o.edges) ? { edges: o.edges } : {}),
        title: typeof o.title === 'string' ? o.title : undefined,
        subtitle: typeof o.subtitle === 'string' ? o.subtitle : undefined,
        direction: o.direction === 'right' || o.direction === 'down' ? o.direction : undefined,
        include: list('include'),
        exclude: list('exclude'),
        expand: list('expand'),
        ...(o.focus != null ? { focus: o.focus } : {}),
        ...(typeof o.environment === 'string' ? { environment: o.environment } : {}),
        ...(list('layers') ? { layers: list('layers') } : {}),
        ...(o.complete === true ? { complete: true as const } : list('complete') ? { complete: list('complete') } : {}),
        ...(typeof o.show === 'string' ? { show: o.show } : {}),
        at: at(['views', name]),
      });
    }
}

// Model ids are dotted paths: "shop.api" is one element, not a row.
const full = (e: { node: string; row?: string }) => (e.row ? `${e.node}.${e.row}` : e.node);

/** "Places orders" with HTTPS/JSON → "Places orders [HTTPS/JSON]", the way C4 writes a relationship. */
export const withTechnology = (label: string | undefined, technology: string | undefined) => (technology ? (label ? `${label} [${technology}]` : `[${technology}]`) : label);

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

/**
 * What a picture of one of a diagram's views (or layers) is called, from the diagram's name without
 * .yaml: customer--detailed-sales. Two hyphens, so a view of customer.yaml is never taken for a view
 * of customer-detailed.yaml (customer-detailed--sales); one would make both customer-detailed-sales.
 */
export function pictureName(base: string, view?: string): string {
  return view ? `${base}--${view}` : base;
}

/** Where a link goes in an exported SVG: diagrams become the SVG the CLI writes next to them. */
export function linkHref(link: Link, self?: string): string | undefined {
  if (link.kind === 'url') return safeHref(link.target);
  const file = link.file || self;
  if (!file) return undefined;
  // Other files (an ADR, a runbook) are linked as they are.
  if (!/\.ya?ml$/i.test(file)) return safeHref(link.target);
  const base = file.replace(/\.ya?ml$/i, '');
  return safeHref(`${pictureName(base, link.view)}.svg`);
}

/**
 * A link that is safe to put in an href: http, https, mailto or a relative path. Diagrams may come
 * from someone else (a docs site renders what is in the repo), so "javascript:" and friends are dropped,
 * also when hidden behind the tabs, newlines and control characters a browser strips from a URL.
 */
export function safeHref(href: string): string | undefined {
  const clean = href.replace(/[\t\n\r]/g, '').replace(/^[\u0000-\u0020]+/, '');
  if (!clean) return undefined;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(clean)?.[1]?.toLowerCase();
  return !scheme || scheme === 'http' || scheme === 'https' || scheme === 'mailto' ? clean : undefined;
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

const relationProps = { style: { type: 'string' }, technology: { type: 'string', description: 'How it talks, e.g. HTTPS/JSON; drawn as "label [technology]"' } };

// Nested to a fixed depth instead of $ref, so autocomplete can walk it: system → container → component.
function elementSchema(depth: number): object {
  const props: Record<string, object> = {
    kind: { type: 'string', description: 'What it is; mapped to each diagram type, e.g. person, system, service, database' },
    label: { type: 'string' },
    ...elementFields,
    icon: { type: 'string' },
    tone: { enum: tones },
    external: { type: 'boolean', description: 'Outside the scope (C4): drawn greyed, kept out of an enterprise boundary; same as tags: [external]' },
  };
  if (depth > 0) props.elements = { type: 'object', propertyNames: { pattern: idPattern }, additionalProperties: elementSchema(depth - 1), description: 'Parts of this element' };
  return { anyOf: [{ type: 'null' }, { type: 'string', description: 'Its kind' }, { type: 'object', properties: props, additionalProperties: false }] };
}

const selectors = { type: 'array', items: { type: 'string', description: 'id (a group: with what is in it), id.*, tag:x, kind:x, env:x, * or a relation like "* -> shop"' } };
const viewSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    subtitle: { type: 'string' },
    direction: { enum: ['right', 'down'] },
    include: { ...selectors, description: 'What the view shows (default: everything at the top)' },
    exclude: { ...selectors, description: 'Left out of what include picked' },
    expand: { type: 'array', items: { type: 'string' }, description: 'Elements drawn as a boundary with their parts inside' },
    focus: focusSchema,
    kind: { enum: viewKinds, description: 'A C4 view that picks its elements itself: landscape, context/container/component of an element, dynamic (steps) or deployment (nodes)' },
    of: { type: 'string', description: 'The element the view is about, e.g. shop or shop.api' },
    enterprise: { type: 'string', description: 'Draw what is not external inside an enterprise boundary with this name' },
    steps: {
      type: 'array',
      items: { anyOf: [edgeItemSchema({ technology: relationProps.technology }), ...stepItemSchemas] },
      description: 'Steps for presenting this view ({ caption, show, focus, path, hide, note }); in a dynamic view its numbered interactions, e.g. "customer -> shop.web: Browses"',
    },
    nodes: { type: 'object', propertyNames: { pattern: idPattern }, additionalProperties: deploymentNodeSchema(4), description: 'Deployment view: deployment nodes, nested, with instances of model elements' },
    edges: {
      type: 'array',
      items: edgeItemSchema({ ...relationProps, via: { type: 'string', description: 'A deployment node the relation goes through, e.g. lb: drawn from → via → to instead of straight' } }),
      description: 'Deployment view: lines between deployment nodes or instances',
    },
    environment: { type: 'string', description: 'One environment of a deployment, e.g. prod: nodes and groups with another env: are left out' },
    layers: viewLayersSchema,
    show: { type: 'string', description: 'Which of the type’s own drawings this view is, e.g. graph, access (who × where) or roles in an access diagram' },
    complete: {
      anyOf: [{ type: 'boolean' }, { type: 'string' }, { type: 'array', items: { type: 'string' } }],
      description: 'Warn about parts of the model that nothing runs here: true for every system, or the elements it is about, e.g. [shop]',
    },
  },
  additionalProperties: false,
};

function deploymentNodeSchema(depth: number): object {
  const props: Record<string, object> = {
    kind: { type: 'string', description: 'deployment-node (default), or an infrastructure kind such as load-balancer, dns, firewall' },
    label: { type: 'string' },
    technology: { type: 'string', description: 'e.g. Kubernetes 1.31, PostgreSQL 16, eu-west-1' },
    description: { type: 'string' },
    count: { type: 'integer', minimum: 1, description: 'How many of these run, shown as ×3' },
    instances: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'Model elements running here, e.g. [shop.api]' },
    of: { type: 'string', description: 'The model element this node itself runs, e.g. shop.db for a managed database' },
    icon: { type: 'string' },
    tone: { enum: tones },
    tags,
    links: linksSchema,
  };
  if (depth > 0) props.nodes = { type: 'object', propertyNames: { pattern: idPattern }, additionalProperties: deploymentNodeSchema(depth - 1), description: 'Nested deployment nodes' };
  return { anyOf: [{ type: 'null' }, { type: 'object', properties: props, additionalProperties: false }] };
}

/** Top-level properties of the model layer, merged into a type's schema. */
export const modelProperties = {
  include: {
    anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    description: 'Other YAML files merged into this one, relative to it (a type: model file or one of this type)',
  },
  elements: { type: 'object', propertyNames: { pattern: idPattern }, additionalProperties: elementSchema(3), description: 'Shared elements that nodes reference with ref:' },
  relations: { type: 'array', items: edgeItemSchema(relationProps), description: 'Relations between model elements, e.g. "shop.web -> shop.api: REST"' },
  views: { type: 'object', propertyNames: { pattern: idPattern }, additionalProperties: viewSchema, description: 'Named views: what each drawing of this model shows' },
  exclude: {
    anyOf: [{ type: 'string' }, selectors],
    description: 'Relations of the model left out of every drawing of this file, the way a view leaves them out, e.g. "uc-weu -> lakehouse"',
  },
  present: {
    enum: ['whole', 'views'],
    description: 'views: the drawing as written is a working canvas, not a slide; the views are presented, checked and exported, the editor opens on the first (whole is the default)',
  },
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
