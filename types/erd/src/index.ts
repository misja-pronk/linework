// Database design: tables with columns, relations drawn from foreign keys with crow's-foot ends.
//
//   tables:
//     orders:
//       schema: sales
//       columns:
//         id: uuid pk
//         customer_id: uuid fk customers.id     # or: fk customers  (its primary key)
//         note: text null
//   relations:                                  # optional: extra or overriding relations
//     - order_lines.product_id -> products.id: { cardinality: many-to-one, label: sells }
import {
  edgeItemSchema,
  edgeReferences,
  idPattern,
  parseEdge,
  tones,
  type BuildContext,
  type DiagramType,
  type Graph,
  type GraphEdge,
  type GraphGroup,
  type GraphNode,
  type Marker,
  type Reference,
  type RowMark,
  type Tone,
} from '@cartography/core';

export interface Column {
  type?: string;
  pk?: boolean;
  fk?: string;
  unique?: boolean;
  nullable?: boolean;
  default?: string;
  pii?: boolean;
  note?: string;
}

interface Table {
  label?: string;
  caption?: string;
  schema?: string;
  tone?: Tone;
  columns?: Record<string, string | Column | null>;
}

export interface ErdSource {
  title?: string;
  subtitle?: string;
  direction?: 'right' | 'down';
  schemas?: Record<string, { label?: string; caption?: string; tone?: Tone } | null>;
  tables?: Record<string, Table>;
  relations?: unknown[];
}

// "<from side>-to-<to side>": many is zero or more, one-or-many has the bar of "at least one".
const sides = ['zero-or-one', 'one', 'many', 'one-or-many'] as const;
const cardinalities = sides.flatMap((a) => sides.map((b) => `${a}-to-${b}`));
const sideMarker: Record<(typeof sides)[number], Marker> = { 'zero-or-one': 'zeroOrOne', one: 'one', many: 'zeroOrMany', 'one-or-many': 'oneOrMany' };

/** "uuid fk customers.id unique null default now()" → Column */
export function parseColumn(spec: string | Column | null): Column {
  if (spec == null) return {};
  if (typeof spec !== 'string') return spec;
  const tokens = spec.trim().split(/\s+/);
  const col: Column = {};
  const flags = new Set(['pk', 'fk', 'ref', '->', 'unique', 'null', 'nullable', 'pii', 'default']);
  if (tokens[0] && !flags.has(tokens[0].toLowerCase())) col.type = tokens.shift();
  while (tokens.length) {
    const t = tokens.shift()!;
    switch (t.toLowerCase()) {
      case 'pk':
        col.pk = true;
        break;
      case 'fk':
      case 'ref':
      case '->':
        col.fk = tokens.shift();
        break;
      case 'unique':
        col.unique = true;
        break;
      case 'null':
      case 'nullable':
        col.nullable = true;
        break;
      case 'pii':
        col.pii = true;
        break;
      case 'default':
        col.default = tokens.join(' ');
        tokens.length = 0;
        break;
      default:
        col.type = col.type ? `${col.type} ${t}` : t;
    }
  }
  return col;
}

function build(src: ErdSource, ctx: BuildContext): Graph {
  const schemaIds = new Set(Object.keys(src.schemas ?? {}));
  const groups: GraphGroup[] = Object.entries(src.schemas ?? {}).map(([id, s]) => ({
    id,
    label: s?.label ?? id,
    caption: s?.caption ?? 'Schema',
    icon: 'layout-grid',
    tone: s?.tone ?? 'slate',
    border: 'dashed',
    path: ['schemas', id],
  }));

  const tables = Object.entries(src.tables ?? {});
  const columns = new Map(tables.map(([id, t]) => [id, Object.entries(t.columns ?? {}).map(([c, s]) => [c, parseColumn(s)] as const)]));
  const pkOf = (table: string) => columns.get(table)?.find(([, c]) => c.pk)?.[0];

  const nodes: GraphNode[] = tables.map(([id, t]) => {
    if (t.schema && !schemaIds.has(t.schema)) ctx.error(['tables', id, 'schema'], `There is no schema "${t.schema}"`);
    const schemaTone = t.schema ? src.schemas?.[t.schema]?.tone : undefined;
    return {
      id,
      parent: t.schema && schemaIds.has(t.schema) ? t.schema : undefined,
      shape: {
        kind: 'table',
        title: t.label ?? id,
        caption: t.caption,
        icon: 'table-2',
        tone: t.tone ?? schemaTone ?? 'blue',
        rows: columns.get(id)!.map(([name, c]) => {
          const marks: RowMark[] = [];
          if (c.pk) marks.push('pk');
          if (c.fk) marks.push('fk');
          if (c.unique) marks.push('unique');
          if (c.nullable) marks.push('null');
          if (c.pii) marks.push('pii');
          return {
            kind: 'row' as const,
            id: name,
            marks,
            cells: [
              { text: name, strong: c.pk },
              { text: (c.type ?? '') + (c.nullable ? '?' : ''), muted: true, mono: true },
            ],
          };
        }),
      },
      path: ['tables', id],
    };
  });

  const edges: GraphEdge[] = [];
  const seen = new Map<string, number>();
  const key = (a: string, b: string) => `${a}|${b}`;

  for (const [table, cols] of columns) {
    // A key column is unique on its own only when the key has one column.
    const singleKey = cols.filter(([, c]) => c.pk).length === 1;
    for (const [name, c] of cols) {
      if (!c.fk) continue;
      const [refTable, refCol = pkOf(refTable!)] = c.fk.split('.');
      const path = ['tables', table, 'columns', name];
      if (!refTable || !columns.has(refTable)) {
        ctx.error(path, `There is no table "${refTable}"`);
        continue;
      }
      if (refCol && !columns.get(refTable)!.some(([n]) => n === refCol)) {
        ctx.error(path, `Table "${refTable}" has no column "${refCol}"`);
        continue;
      }
      seen.set(key(`${table}.${name}`, `${refTable}.${refCol}`), edges.length);
      edges.push({
        id: `fk-${table}-${name}`,
        from: { node: table, row: name },
        to: { node: refTable, row: refCol },
        line: 'solid',
        start: c.unique || (c.pk && singleKey) ? 'zeroOrOne' : 'zeroOrMany',
        end: c.nullable ? 'zeroOrOne' : 'one',
        path,
      });
    }
  }

  for (const [i, item] of (src.relations ?? []).entries()) {
    const spec = parseEdge(item, ['relations', i]);
    if (typeof spec === 'string') {
      ctx.error(['relations', i], spec);
      continue;
    }
    const missing = [spec.from, spec.to].find((e) => !columns.has(e.node) || (e.row && !columns.get(e.node)!.some(([n]) => n === e.row)));
    if (missing) {
      ctx.error(['relations', i], `There is no ${missing.row ? `column "${missing.node}.${missing.row}"` : `table "${missing.node}"`}`);
      continue;
    }
    const [start, end] = markers(spec.props.cardinality as string | undefined);
    const edge: GraphEdge = {
      id: `rel-${i}`,
      from: spec.from,
      to: spec.to,
      label: spec.label,
      line: spec.line,
      start,
      end,
      path: spec.path,
    };
    const existing = seen.get(key(`${spec.from.node}.${spec.from.row}`, `${spec.to.node}.${spec.to.row}`));
    if (existing != null) edges[existing] = { ...edge, id: edges[existing]!.id };
    else edges.push(edge);
  }

  return { title: src.title, subtitle: src.subtitle, direction: src.direction ?? 'right', groups, nodes, edges };
}

function markers(cardinality: string | undefined): [Marker, Marker] {
  const m = new RegExp(`^(${sides.join('|')})-to-(${sides.join('|')})$`).exec(cardinality ?? '');
  return m ? [sideMarker[m[1] as (typeof sides)[number]], sideMarker[m[2] as (typeof sides)[number]]] : ['zeroOrMany', 'one'];
}

const column = {
  anyOf: [
    { type: 'string', description: 'type and flags: "uuid pk", "uuid fk customers.id", "text unique null"' },
    { type: 'null' },
    {
      type: 'object',
      properties: {
        type: { type: 'string' },
        pk: { type: 'boolean' },
        fk: { type: 'string', description: 'table or table.column' },
        unique: { type: 'boolean' },
        nullable: { type: 'boolean' },
        default: { type: 'string' },
        pii: { type: 'boolean' },
        note: { type: 'string' },
      },
      additionalProperties: false,
    },
  ],
};

export const erd: DiagramType<ErdSource> = {
  id: 'erd',
  name: 'Database design',
  description: 'Tables, columns and relations with crow’s-foot notation',
  icon: 'table-2',
  tagline: 'Tables, columns and keys, with crow’s-foot relations',
  useWhen: [
    'Design a database schema before writing migrations',
    'Explain how tables relate: one-to-many, many-to-many',
    'Document an existing schema for a review',
  ],
  notFor: [
    { text: 'Which services use the database', use: 'systems' },
    { text: 'Data products and their contracts', use: 'data-products' },
  ],
  keywords: ['database', 'table', 'column', 'schema', 'sql', 'postgres', 'mysql', 'entity', 'relation', 'foreign key', 'primary key', 'erd', 'er diagram', 'data model', 'migration'],
  schema: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'Cartography database diagram',
    type: 'object',
    required: ['type'],
    properties: {
      type: { const: 'erd' },
      title: { type: 'string' },
      subtitle: { type: 'string' },
      direction: { enum: ['right', 'down'] },
      schemas: {
        type: 'object',
        propertyNames: { pattern: idPattern },
        additionalProperties: {
          anyOf: [
            { type: 'null' },
            {
              type: 'object',
              properties: { label: { type: 'string' }, caption: { type: 'string' }, tone: { enum: tones } },
              additionalProperties: false,
            },
          ],
        },
      },
      tables: {
        type: 'object',
        propertyNames: { pattern: idPattern },
        additionalProperties: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            caption: { type: 'string' },
            schema: { type: 'string' },
            tone: { enum: tones },
            columns: { type: 'object', additionalProperties: column },
          },
          additionalProperties: false,
        },
      },
      relations: { type: 'array', items: edgeItemSchema({ cardinality: { enum: cardinalities } }) },
    },
    additionalProperties: false,
  },
  references(src) {
    const out: Reference[] = [];
    const tables = src.tables ?? {};
    for (const [id, t] of Object.entries(tables)) {
      if (typeof t?.schema === 'string') out.push({ path: ['tables', id, 'schema'], id: t.schema, start: 0, collection: 'schemas' });
      for (const [col, spec] of Object.entries(t?.columns ?? {})) {
        const path = ['tables', id, 'columns', col];
        if (typeof spec === 'string') {
          // "uuid fk customers.id": deleting customers cuts the "fk customers.id" part, the column stays.
          const m = /(^|\s)((?:fk|ref|->)\s+)([A-Za-z0-9_-]+)(\.[A-Za-z0-9_-]+)?/di.exec(spec);
          if (m?.indices) out.push({ path, id: m[3]!, start: m.indices[3]![0], collection: 'tables', onDelete: 'cut', cut: [m.indices[2]![0] - m[1]!.length, m.indices[4]?.[1] ?? m.indices[3]![1]] });
        } else if (spec && typeof spec.fk === 'string') out.push({ path: [...path, 'fk'], id: spec.fk.split('.')[0]!, start: 0, collection: 'tables' });
      }
    }
    out.push(...edgeReferences(src.relations, ['relations'], (id) => (Object.hasOwn(tables, id) ? 'tables' : undefined)));
    return out;
  },
  connect(src, from, to) {
    const target = src.tables?.[to];
    if (!src.tables?.[from] || !target) return 'Connect one table to another';
    const pk = Object.entries(target.columns ?? {}).find(([, c]) => parseColumn(c).pk);
    const key = `${to.replace(/s$/, '')}_${pk?.[0] ?? 'id'}`;
    const type = pk ? parseColumn(pk[1]).type : undefined;
    return { path: ['tables', from, 'columns'], key, value: `${type ? `${type} ` : ''}fk ${to}` };
  },
  palette: [
    { collection: 'schemas', kind: 'schema', label: 'Schema', icon: 'layout-grid', tone: 'slate' },
    { collection: 'tables', kind: 'table', label: 'Table', icon: 'table-2', tone: 'blue', keywords: ['entity'] },
  ],
  build,
  template: `type: erd
title: Orders

tables:
  customers:
    columns:
      id: uuid pk
      email: text unique
      name: text
  orders:
    columns:
      id: uuid pk
      customer_id: uuid fk customers
      placed_at: timestamptz default now()
      total: numeric(10,2)
  order_lines:
    columns:
      order_id: uuid pk fk orders
      product_id: uuid pk fk products
      quantity: int
  products:
    columns:
      id: uuid pk
      name: text
      price: numeric(10,2)
`,
};
