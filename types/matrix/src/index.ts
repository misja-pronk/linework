// A matrix: rows × columns with a value from a declared legend in each cell. RACI (who is responsible,
// accountable, consulted, informed for each activity), CRUD (which service creates, reads, updates or
// deletes which data), or a legend of your own. The legend's rules are checked: one A per row.
//
//   type: matrix
//   legend: raci                      # raci, crud, or { key: { label, tone, per-row, per-column } }
//   columns: { pm: Programme manager, arch: { label: Architect, group: IT } }
//   rows: { plan: { label: Migration plan, group: Discover } }
//   cells:
//     plan: { pm: A, arch: R }        # several values: "C R U", "CRU" or "A/R"
//
// Row and column ids that name model elements (with include:) take their names from the model.
import { parseLinks, tones, type BuildContext, type DiagramType, type Graph, type LegendItem, type Link, type MatrixCell, type MatrixHeader, type Path, type Reference, type Tone } from '@cartography/core';

type Rule = 'exactly-one' | 'at-least-one' | 'at-most-one';
interface Value {
  label: string;
  tone?: Tone;
  'per-row'?: Rule;
  'per-column'?: Rule;
}

export const presets: Record<string, { corner: string; values: Record<string, Value> }> = {
  raci: {
    corner: 'Activity \\ role',
    values: {
      R: { label: 'Responsible: does the work', tone: 'blue', 'per-row': 'at-least-one' },
      A: { label: 'Accountable: signs off, one per activity', tone: 'violet', 'per-row': 'exactly-one' },
      C: { label: 'Consulted: asked before', tone: 'teal' },
      I: { label: 'Informed: told after', tone: 'slate' },
    },
  },
  crud: {
    corner: 'Service \\ data',
    values: {
      C: { label: 'Create', tone: 'green', 'per-column': 'at-least-one' },
      R: { label: 'Read', tone: 'blue', 'per-column': 'at-least-one' },
      U: { label: 'Update', tone: 'amber' },
      D: { label: 'Delete', tone: 'rose' },
    },
  },
};

type HeaderEntry = string | null | { label?: string; caption?: string; group?: string; icon?: string; tone?: Tone; description?: string; links?: unknown[] };

export interface MatrixSource {
  title?: string;
  subtitle?: string;
  legend?: string | Record<string, string | Value>;
  corner?: string;
  rows?: Record<string, HeaderEntry>;
  columns?: Record<string, HeaderEntry>;
  cells?: Record<string, Record<string, string | null> | null>;
  counts?: boolean | 'rows' | 'columns' | 'both';
}

const ids = '^[A-Za-z0-9_.-]+$';
const rule = { enum: ['exactly-one', 'at-least-one', 'at-most-one'] };
const header = {
  anyOf: [
    { type: 'string', description: 'Its label' },
    { type: 'null', description: 'The model element with this id, or the id itself' },
    {
      type: 'object',
      properties: {
        label: { type: 'string' },
        caption: { type: 'string' },
        group: { type: 'string', description: 'Headers with the same group next to each other are named once, over or between them' },
        icon: { type: 'string' },
        tone: { enum: tones },
        description: { type: 'string' },
        links: { type: 'array' },
      },
      additionalProperties: false,
    },
  ],
};

const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Cartography matrix',
  type: 'object',
  required: ['type'],
  properties: {
    type: { const: 'matrix' },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    legend: {
      anyOf: [
        { enum: Object.keys(presets), description: 'raci or crud, with their checks' },
        {
          type: 'object',
          description: 'Your own values: { key: label } or { key: { label, tone, per-row, per-column } }',
          propertyNames: { pattern: '^[A-Za-z0-9+_-]+$' },
          additionalProperties: {
            anyOf: [
              { type: 'string' },
              { type: 'object', required: ['label'], properties: { label: { type: 'string' }, tone: { enum: tones }, 'per-row': rule, 'per-column': rule }, additionalProperties: false },
            ],
          },
        },
      ],
    },
    corner: { type: 'string', description: 'Text above the row names, e.g. Activity \\ role' },
    rows: { type: 'object', propertyNames: { pattern: ids }, additionalProperties: header },
    columns: { type: 'object', propertyNames: { pattern: ids }, additionalProperties: header },
    cells: {
      type: 'object',
      propertyNames: { pattern: ids },
      additionalProperties: { anyOf: [{ type: 'null' }, { type: 'object', propertyNames: { pattern: ids }, additionalProperties: { type: ['string', 'null'], description: 'A legend value, or several: "C R U"' } }] },
      description: 'Per row id: { column id: value }',
    },
    counts: { enum: [true, false, 'columns', 'rows', 'both'], description: 'How many of each value, under each column name (true or columns), each row name (rows), or both' },
  },
  additionalProperties: false,
};

const ruleText: Record<Rule, string> = { 'exactly-one': 'exactly one', 'at-least-one': 'at least one', 'at-most-one': 'at most one' };
const breaks = (r: Rule, n: number) => (r === 'exactly-one' ? n !== 1 : r === 'at-least-one' ? n < 1 : n > 1);

function legendOf(src: MatrixSource, ctx: BuildContext): { values: Record<string, Value>; corner?: string } {
  const l = src.legend ?? 'raci';
  if (typeof l === 'string') {
    const p = presets[l];
    if (!p) ctx.error(['legend'], `Unknown legend "${l}": raci, crud, or your own values`);
    return p ?? presets.raci!;
  }
  // Without a tone a value takes the next of a quiet, well-told-apart set.
  const order: Tone[] = ['blue', 'violet', 'teal', 'amber', 'green', 'rose', 'sky', 'slate'];
  return { values: Object.fromEntries(Object.entries(l).map(([k, v], i) => [k, typeof v === 'string' ? { label: v, tone: order[i % order.length] } : { tone: order[i % order.length], ...v }])) };
}

/** "A", "C R U", "CRU", "A/R": the legend keys a cell holds, or the part that is not one. */
export function cellValues(raw: string, keys: string[]): string[] | { unknown: string } {
  const s = raw.trim();
  if (!s) return [];
  if (keys.includes(s)) return [s];
  const parts = s.split(/[\s,/+]+/).filter(Boolean);
  const split = parts.length === 1 && [...s].every((c) => keys.includes(c)) ? [...s] : parts;
  const bad = split.find((p) => !keys.includes(p));
  return bad ? { unknown: bad } : [...new Set(split)];
}

function build(src: MatrixSource, ctx: BuildContext): Graph {
  const { values, corner } = legendOf(src, ctx);
  const keys = Object.keys(values);
  const model = ctx.model;
  if (model) model.used = true;
  // A header that names a model element takes its name and links from it.
  const element = (id: string) => {
    const els = model?.elements;
    if (!els) return undefined;
    const exact = els.get(id);
    if (exact) return exact;
    const named = [...els.values()].filter((e) => e.name === id);
    return named.length === 1 ? named[0] : undefined;
  };
  const headers = (coll: 'rows' | 'columns'): [string, MatrixHeader][] =>
    Object.entries(src[coll] ?? {}).map(([id, v]) => {
      const e = typeof v === 'string' ? { label: v } : (v ?? {});
      const el = element(id);
      const link: Link | undefined = parseLinks(e.links ?? el?.links)?.[0];
      return [id, { label: e.label ?? el?.label ?? id, ...(e.caption ? { caption: e.caption } : {}), ...(e.group ? { group: e.group } : {}), ...(e.icon ? { icon: e.icon } : {}), ...(e.tone ? { tone: e.tone } : {}), ...(link ? { link } : {}) }];
    });
  const rows = headers('rows');
  const columns = headers('columns');
  const rowIndex = new Map(rows.map(([id], i) => [id, i]));
  const colIndex = new Map(columns.map(([id], i) => [id, i]));
  const held: string[][][] = rows.map(() => columns.map(() => []));

  for (const [r, line] of Object.entries(src.cells ?? {})) {
    const i = rowIndex.get(r);
    if (i === undefined) {
      ctx.error(['cells', r], `There is no row "${r}"${rows.length ? `; rows: ${rows.map(([id]) => id).join(', ')}` : ''}`);
      continue;
    }
    for (const [c, raw] of Object.entries(line ?? {})) {
      const j = colIndex.get(c);
      const path: Path = ['cells', r, c];
      if (j === undefined) {
        ctx.error(path, `There is no column "${c}"${columns.length ? `; columns: ${columns.map(([id]) => id).join(', ')}` : ''}`);
        continue;
      }
      const v = cellValues(raw ?? '', keys);
      if (!Array.isArray(v)) ctx.error(path, `"${v.unknown}" is not in the legend: ${keys.join(', ')}`);
      else held[i]![j] = v;
    }
  }

  // The legend's rules, per row and per column: "exactly one A" per activity.
  for (const [k, v] of Object.entries(values)) {
    const count = (list: string[][]) => list.filter((x) => x.includes(k)).length;
    if (v['per-row'])
      for (const [i, [id, h]] of rows.entries()) {
        const n = count(held[i]!);
        if (breaks(v['per-row'], n)) ctx.warn(src.cells?.[id] ? ['cells', id] : ['rows', id], `"${h.label}" has ${n} × ${k}; it needs ${ruleText[v['per-row']]} (${v.label.split(':')[0]})`);
      }
    if (v['per-column'])
      for (const [j, [id, h]] of columns.entries()) {
        const n = count(held.map((r) => r[j]!));
        if (breaks(v['per-column'], n)) ctx.warn(['columns', id], `"${h.label}" has ${n} × ${k}; it needs ${ruleText[v['per-column']]} (${v.label.split(':')[0]})`);
      }
  }

  // Counts as captions: how much each role carries, how often a value occurs in a row.
  const tally = (list: string[][]) =>
    keys
      .map((k) => [k, list.filter((x) => x.includes(k)).length] as const)
      .filter(([, n]) => n)
      .map(([k, n]) => `${n} ${k}`)
      .join(' · ');
  const counts = src.counts === true ? 'columns' : src.counts || undefined;
  if (counts === 'columns' || counts === 'both') for (const [j, [, h]] of columns.entries()) h.caption ??= tally(held.map((r) => r[j]!)) || undefined;
  if (counts === 'rows' || counts === 'both') for (const [i, [, h]] of rows.entries()) h.caption ??= tally(held[i]!) || undefined;

  const cells: (MatrixCell | undefined)[][] = held.map((r) =>
    // One value or several, the same small pill each, so a column reads as one.
    r.map((v) => (!v.length ? undefined : { text: v.join(' '), parts: v.map((k) => ({ text: k, tone: values[k]!.tone })) })),
  );
  const used = new Set(held.flat(2));
  // The key spells out each letter; the letters are in the cells, so colour only helps.
  const legend: LegendItem[] = keys.filter((k) => used.has(k)).map((k) => ({ label: values[k]!.label, swatch: 'mark', tag: k, tone: values[k]!.tone }));
  return {
    title: src.title,
    subtitle: src.subtitle,
    direction: 'right',
    groups: [],
    nodes: rows.length && columns.length
      ? [{ id: 'matrix', shape: { kind: 'matrix', corner: src.corner ?? corner, rows: rows.map(([, h]) => h), columns: columns.map(([, h]) => h), cells, table: true }, path: [] }]
      : [{ id: 'matrix', shape: { kind: 'card', label: 'An empty matrix', caption: 'Add rows: and columns:, then cells:', icon: 'grid-3x3', tone: 'slate' }, path: [] }],
    edges: [],
    legend,
  };
}

export const matrix: DiagramType<MatrixSource> = {
  id: 'matrix',
  name: 'Matrix',
  description: 'Rows × columns with a value from a legend in each cell: RACI, CRUD, or your own',
  icon: 'grid-3x3',
  tagline: 'Who does what, or what touches which data, as a checked table',
  useWhen: [
    'A RACI chart for a programme or a migration',
    'A CRUD matrix of services against the data they touch',
    'Any grid of rows against columns with a fixed set of values',
  ],
  notFor: [
    { text: 'Who may access which resource, with roles and groups', use: 'access' },
    { text: 'Steps in order and who does them', use: 'process' },
  ],
  keywords: ['matrix', 'raci', 'rasci', 'crud', 'responsible', 'accountable', 'consulted', 'informed', 'responsibility', 'ownership', 'governance', 'grid', 'table', 'data ownership', 'create read update delete'],
  schema,
  palette: [],
  unconnected: true,
  build,
  references(src) {
    const out: Reference[] = [];
    for (const [r, line] of Object.entries(src.cells ?? {})) {
      if (src.rows && Object.hasOwn(src.rows, r)) out.push({ path: ['cells', r], key: true, id: r, start: 0, collection: 'rows', onDelete: 'key' });
      for (const c of Object.keys(line ?? {})) if (src.columns && Object.hasOwn(src.columns, c)) out.push({ path: ['cells', r, c], key: true, id: c, start: 0, collection: 'columns', onDelete: 'key' });
    }
    return out;
  },
  template: `type: matrix
title: Platform migration — RACI
subtitle: Who does what in the move to the new platform
legend: raci
counts: true

columns:
  sponsor: { label: Sponsor, group: Business }
  pm: { label: Programme manager, group: Business }
  arch: { label: Architect, group: IT }
  platform: { label: Platform team, group: IT }
  apps: { label: App teams, group: IT }
  security: { label: Security officer, group: Risk }

rows:
  case: { label: Business case, group: Prepare }
  plan: { label: Migration plan, group: Prepare }
  landing: { label: Landing zone, group: Build }
  pipelines: { label: Deployment pipelines, group: Build }
  migrate: { label: Move the applications, group: Migrate }
  test: { label: Acceptance tests, group: Migrate }
  cutover: { label: Cut-over and decommission, group: Run }

cells:
  case: { sponsor: A, pm: R, arch: C, security: I }
  plan: { sponsor: I, pm: A, arch: R, platform: C, apps: C, security: C }
  landing: { pm: I, arch: A, platform: R, security: C }
  pipelines: { arch: C, platform: A/R, apps: C }
  migrate: { pm: A, platform: C, apps: R, security: I }
  test: { pm: A, apps: R, security: C }
  cutover: { sponsor: I, pm: A, platform: R, apps: R, security: I }
`,
};

