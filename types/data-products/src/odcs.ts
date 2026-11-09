// Reads an Open Data Contract Standard file (https://bitol-io.github.io/open-data-contract-standard/)
// into what a contract card shows: name, version, schema objects with their fields, SLAs and quality rules.
// v3 (`schema[].properties[]`, `slaProperties[]`) is the target; v2 (`dataset[].columns[]`) is read too.
import type { RowMark } from '@cartography/core';

export interface ContractField {
  name: string;
  type: string;
  marks: RowMark[];
}

export interface ContractModel {
  label?: string;
  version?: string;
  classification?: string;
  /** One entry per schema object (table, topic, …). */
  schemas: { name?: string; fields: ContractField[] }[];
  sla: [string, string][];
  quality: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const str = (v: unknown): string | undefined => (v == null || typeof v === 'object' ? undefined : String(v));

export function isOdcs(data: unknown): boolean {
  return isObj(data) && (data.kind === 'DataContract' || typeof data.apiVersion === 'string');
}

/** An ODCS document, or a message saying why it is not one. */
export function readOdcs(data: unknown): ContractModel | string {
  if (!isOdcs(data)) return 'This is not an Open Data Contract Standard file (no "kind: DataContract")';
  const d = data as Obj;
  const quality: string[] = [];

  // v3: schema[] with properties[]; v2: dataset[] with columns[].
  const objects = objs(d.schema).length ? objs(d.schema) : objs(d.dataset);
  const schemas = objects.map((o) => {
    const name = str(o.name) ?? str(o.table) ?? str(o.physicalName);
    for (const q of objs(o.quality)) quality.push(rule(q));
    const fields = objs(o.properties).length ? objs(o.properties) : objs(o.columns);
    return {
      name,
      fields: fields.map((f): ContractField => {
        const fieldName = str(f.name) ?? str(f.column) ?? '?';
        for (const q of objs(f.quality)) quality.push(rule(q, fieldName));
        const marks: RowMark[] = [];
        if (f.primaryKey === true || f.isPrimaryKey === true) marks.push('pk');
        if (pii(f)) marks.push('pii');
        if (f.unique === true && !marks.includes('pk')) marks.push('unique');
        // ODCS: optional unless `required: true` (v3) or `isNullable: false` (v2); keys are never optional.
        const optional = marks.includes('pk') ? false : 'required' in f ? f.required !== true : 'isNullable' in f ? f.isNullable !== false : true;
        if (optional) marks.push('null');
        const type = str(f.physicalType) ?? str(f.logicalType) ?? '';
        return { name: fieldName, type: type + (optional ? '?' : ''), marks };
      }),
    };
  });
  for (const q of objs(d.quality)) quality.push(rule(q));

  const sla = objs(d.slaProperties).map((p): [string, string] => [str(p.property) ?? '?', amount(p)]);
  return {
    label: str(d.name) ?? str(d.datasetName) ?? str(d.id),
    version: str(d.version),
    classification: str(d.classification) ?? strongest(objects),
    schemas,
    sla,
    quality,
  };
}

function pii(f: Obj): boolean {
  if (f.pii === true) return true;
  const tags = Array.isArray(f.tags) ? f.tags.map(String) : [];
  return tags.some((t) => /^pii$/i.test(t)) || /pii|personal/i.test(str(f.classification) ?? '');
}

const levels = ['public', 'internal', 'confidential', 'restricted', 'secret'];

/** The strictest field classification, when the contract itself has none. */
function strongest(objects: Obj[]): string | undefined {
  let best = -1;
  for (const o of objects)
    for (const f of [...objs(o.properties), ...objs(o.columns)]) best = Math.max(best, levels.indexOf((str(f.classification) ?? '').toLowerCase()));
  return best >= 0 ? levels[best] : undefined;
}

const units: Record<string, string> = { d: 'days', day: 'days', h: 'hours', hour: 'hours', y: 'years', year: 'years', min: 'minutes', s: 'seconds', ms: 'ms', w: 'weeks' };

function amount(p: Obj): string {
  const v = str(p.value) ?? '';
  const unit = str(p.unit);
  const word = unit ? (units[unit.toLowerCase()] ?? unit) : '';
  const one = v === '1' && word.endsWith('s') && word !== 'ms' ? word.slice(0, -1) : word;
  return [v, one].filter(Boolean).join(' ');
}

const compare: [string, string][] = [
  ['mustBe', '='],
  ['mustNotBe', '≠'],
  ['mustBeGreaterThan', '>'],
  ['mustBeGreaterOrEqualTo', '≥'],
  ['mustBeGreaterThanOrEqualTo', '≥'],
  ['mustBeLessThan', '<'],
  ['mustBeLessOrEqualTo', '≤'],
  ['mustBeLessThanOrEqualTo', '≤'],
];

/** A quality rule in a few words: its description, or rule plus threshold. */
function rule(q: Obj, field?: string): string {
  const description = str(q.description);
  if (description) return description;
  const what = str(q.rule) ?? str(q.metric) ?? str(q.type) ?? 'check';
  let threshold = '';
  for (const [key, op] of compare) if (q[key] != null) threshold = ` ${op} ${str(q[key])}`;
  for (const key of ['mustBeBetween', 'mustNotBeBetween'])
    if (Array.isArray(q[key])) threshold = ` ${key === 'mustBeBetween' ? 'between' : 'not between'} ${q[key].join(' and ')}`;
  return `${field ? `${field}: ` : ''}${what}${threshold}`;
}
