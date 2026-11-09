// Edge shorthand shared by all types:
//   - web -> db                     arrow
//   - web -> db: SQL                arrow with label
//   - web --> db                    dashed arrow     (..> dotted, <-> both ends, -- plain line)
//   - web -> db: { label: SQL, style: private }
//   - { from: web, to: db, label: SQL }
// An endpoint may name a row: orders.customer_id
import type { Endpoint, GraphEdge, Path } from './model.ts';
import type { Reference } from './diagram-type.ts';

export interface EdgeSpec {
  from: Endpoint;
  to: Endpoint;
  label?: string;
  line: GraphEdge['line'];
  start: 'none' | 'arrow';
  end: 'none' | 'arrow';
  /** Remaining long-form properties, for the diagram type to interpret (style, cardinality, …). */
  props: Record<string, unknown>;
  path: Path;
}

const ARROW = /^\s*([A-Za-z0-9_.-]+)\s*(<->|-->|\.\.>|->|--)\s*([A-Za-z0-9_.-]+)\s*$/;

const OPERATORS: Record<string, Pick<EdgeSpec, 'line' | 'start' | 'end'>> = {
  '->': { line: 'solid', start: 'none', end: 'arrow' },
  '-->': { line: 'dashed', start: 'none', end: 'arrow' },
  '..>': { line: 'dotted', start: 'none', end: 'arrow' },
  '<->': { line: 'solid', start: 'arrow', end: 'arrow' },
  '--': { line: 'solid', start: 'none', end: 'none' },
};

export const edgePattern = ARROW.source;

/** The ids in an edge list, whatever form each edge takes. `collectionOf` says what an id names. */
export function edgeReferences(items: unknown, base: Path, collectionOf: (id: string) => string | undefined): Reference[] {
  if (!Array.isArray(items)) return [];
  const out: Reference[] = [];
  const ends = (s: string, path: Path, key: boolean) => {
    const m = new RegExp(ARROW.source, 'd').exec(s);
    if (!m?.indices) return;
    for (const g of [1, 3]) {
      const id = m[g]!.split('.')[0]!;
      const collection = collectionOf(id);
      if (collection) out.push({ path, key, id, start: m.indices[g]![0], collection });
    }
  };
  for (const [i, item] of items.entries()) {
    const path = [...base, i];
    if (typeof item === 'string') ends(item, path, false);
    else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      if (typeof o.from === 'string' || typeof o.to === 'string') {
        for (const k of ['from', 'to'] as const) {
          const id = typeof o[k] === 'string' ? (o[k] as string).split('.')[0]! : undefined;
          const collection = id ? collectionOf(id) : undefined;
          if (id && collection) out.push({ path: [...path, k], id, start: 0, collection });
        }
      } else {
        const keys = Object.keys(o);
        if (keys.length === 1) ends(keys[0]!, path, true);
      }
    }
  }
  return out;
}

export function endpoint(ref: string): Endpoint {
  const dot = ref.indexOf('.');
  return dot < 0 ? { node: ref } : { node: ref.slice(0, dot), row: ref.slice(dot + 1) };
}

/** Parse one item of an `edges:` list; returns a message on failure. */
export function parseEdge(item: unknown, path: Path): EdgeSpec | string {
  if (typeof item === 'string') return fromArrow(item, undefined, path) ?? `"${item}" is not an edge like "a -> b"`;
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const o = item as Record<string, unknown>;
    if (typeof o.from === 'string' && typeof o.to === 'string') {
      const { from, to, label, ...props } = o;
      return {
        from: endpoint(from),
        to: endpoint(o.to as string),
        label: label == null ? undefined : String(label),
        ...OPERATORS['->']!,
        ...lineProps(props),
        props,
        path,
      };
    }
    const keys = Object.keys(o);
    if (keys.length === 1) {
      const spec = fromArrow(keys[0]!, o[keys[0]!], path);
      if (spec) return spec;
    }
  }
  return 'An edge is "a -> b", "a -> b: label" or { from, to, label }';
}

function fromArrow(arrow: string, value: unknown, path: Path): EdgeSpec | undefined {
  const m = ARROW.exec(arrow);
  if (!m) return undefined;
  const base = { from: endpoint(m[1]!), to: endpoint(m[3]!), ...OPERATORS[m[2]!]!, path };
  if (value == null) return { ...base, props: {} };
  if (typeof value === 'object' && !Array.isArray(value)) {
    const { label, ...props } = value as Record<string, unknown>;
    return { ...base, ...lineProps(props), label: label == null ? undefined : String(label), props };
  }
  return { ...base, label: String(value), props: {} };
}

function lineProps(props: Record<string, unknown>): Partial<EdgeSpec> {
  const out: Partial<EdgeSpec> = {};
  if (props.line === 'solid' || props.line === 'dashed' || props.line === 'dotted') out.line = props.line;
  if (props.both === true) out.start = 'arrow';
  return out;
}

/** JSON Schema for an `edges:` list item, shared by all types. `extra` adds long-form properties. */
export function edgeItemSchema(extra: Record<string, object> = {}): object {
  const long = {
    label: { type: ['string', 'number'], description: 'Text on the line' },
    line: { enum: ['solid', 'dashed', 'dotted'] },
    both: { type: 'boolean', description: 'Arrow at both ends' },
    ...extra,
  };
  return {
    anyOf: [
      { type: 'string', pattern: edgePattern, description: '"a -> b" (also -->, ..>, <->, --)' },
      {
        type: 'object',
        minProperties: 1,
        maxProperties: 1,
        propertyNames: { pattern: edgePattern },
        additionalProperties: {
          anyOf: [{ type: ['string', 'number', 'null'] }, { type: 'object', properties: long, additionalProperties: false }],
        },
      },
      {
        type: 'object',
        required: ['from', 'to'],
        properties: { from: { type: 'string' }, to: { type: 'string' }, ...long },
        additionalProperties: false,
      },
    ],
  };
}
