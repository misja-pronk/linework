// Reads an Open Data Contract Standard file (https://bitol-io.github.io/open-data-contract-standard/)
// into what a contract card shows: name, version, schema objects with their fields, SLAs and quality rules.
// v3 (`schema[].properties[]`, `slaProperties[]`) is the target; v2 (`dataset[].columns[]`) is read too.
// v3.1 `relationships` (foreign keys, on a schema object or on a property) become lines between fields.
import type { RowMark } from '@cartography/core';

export interface ContractField {
  /** The stable `id` (v3.1), which fully qualified references use instead of the name. */
  id?: string;
  name: string;
  type: string;
  marks: RowMark[];
}

/** A foreign key: a field of this contract that points at a field here or in another contract file. */
export interface ContractRelation {
  /** Schema object (its index) and field (its name) in this contract. */
  from: { schema: number; field: string };
  /** The other end as written: the object and property by id or by name, and the contract file when it is not this one. */
  to: { file?: string; schema: string; field: string };
  /** `customProperties` label or description, when the contract gives one. */
  label?: string;
}

export interface ContractModel {
  label?: string;
  version?: string;
  classification?: string;
  /** One entry per schema object (table, topic, …). */
  schemas: { id?: string; name?: string; fields: ContractField[] }[];
  sla: [string, string][];
  quality: string[];
  relations?: ContractRelation[];
  /** What could not be read as written, in words (a relationship that names a field that is not there). */
  notes?: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const str = (v: unknown): string | undefined => (v == null || typeof v === 'object' ? undefined : String(v));

/** `kind: DataContract`; files from before `kind` (v2) are known by their dataset. Other kinds (DataProduct) are not contracts. */
export function isOdcs(data: unknown): boolean {
  if (!isObj(data)) return false;
  if (data.kind != null) return data.kind === 'DataContract';
  return typeof data.apiVersion === 'string' || (typeof data.datasetName === 'string' && Array.isArray(data.dataset));
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
      ...(str(o.id) ? { id: str(o.id) } : {}),
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
        return { ...(str(f.id) ? { id: str(f.id) } : {}), name: fieldName, type: type + (optional ? '?' : ''), marks };
      }),
    };
  });
  for (const q of objs(d.quality)) quality.push(rule(q));

  // v3.1 relationships: on a property the from end is that property; on a schema object both ends are written.
  const relations: ContractRelation[] = [];
  const notes: string[] = [];
  const add = (from: { schema: number; field: string } | undefined, to: unknown, r: Obj, written: string) => {
    const end = typeof to === 'string' ? readRef(to) : undefined;
    if (!from || !end) return void notes.push(`Relationship ${written} is not read: ${!from ? 'its from end is not a field of this contract' : 'its to end is not a reference like table.column'}`);
    const mark = schemas[from.schema]!.fields.find((f) => f.name === from.field)!.marks;
    if (!mark.includes('fk')) mark.splice(mark.includes('pk') ? 1 : 0, 0, 'fk');
    const label = custom(r, 'label') ?? custom(r, 'description');
    // Written on the property and again on its schema object, it is still one key.
    const twice = relations.find((x) => x.from.schema === from.schema && x.from.field === from.field && x.to.file === end.file && x.to.schema === end.schema && x.to.field === end.field);
    if (twice) twice.label ??= label;
    else relations.push({ from, to: end, ...(label ? { label } : {}) });
  };
  for (const [i, o] of objects.entries()) {
    for (const r of objs(o.relationships)) {
      if (!foreignKey(r)) continue;
      const from = Array.isArray(r.from) ? r.from : [r.from];
      const to = Array.isArray(r.to) ? r.to : [r.to];
      // A composite key is a line per pair of columns.
      for (const [k, f] of from.entries()) {
        const ref = typeof f === 'string' ? readRef(f) : undefined;
        add(ref && !ref.file ? findField(schemas, ref.schema, ref.field) : undefined, to[k], r, `${String(f)} → ${String(to[k])}`);
      }
    }
    for (const f of objs(o.properties))
      for (const r of objs(f.relationships)) {
        if (!foreignKey(r)) continue;
        const name = str(f.name) ?? '?';
        for (const to of Array.isArray(r.to) ? r.to : [r.to]) add({ schema: i, field: name }, to, r, `${name} → ${String(to)}`);
      }
  }

  const sla = objs(d.slaProperties).map((p): [string, string] => [str(p.property) ?? '?', amount(p)]);
  return {
    label: str(d.name) ?? str(d.datasetName) ?? str(d.id),
    version: str(d.version),
    classification: str(d.classification) ?? strongest(objects),
    schemas,
    sla,
    quality,
    ...(relations.length ? { relations } : {}),
    ...(notes.length ? { notes } : {}),
  };
}

const foreignKey = (r: Obj) => r.type == null || /^foreign[-_ ]?key$/i.test(String(r.type));

function custom(r: Obj, key: string): string | undefined {
  // customProperties is a list of { property, value }; a plain map is read too.
  if (isObj(r.customProperties)) return str(r.customProperties[key]);
  return str(objs(r.customProperties).find((c) => c.property === key)?.value);
}

/**
 * A reference as ODCS writes it: `table.column` (names), `schema/<object>/properties/<property>` (ids),
 * either one behind `other-contract.yaml#` for a field of another contract. A nested property
 * (`table.address.street`) points at the top-level one, which is what a contract card lists.
 */
function readRef(text: string): ContractRelation['to'] | undefined {
  const hash = text.indexOf('#');
  const file = hash > 0 ? text.slice(0, hash).trim() : undefined;
  const path = (hash >= 0 ? text.slice(hash + 1) : text).trim().replace(/^\//, '');
  const full = /^schema\/([^/]+)\/properties\/([^/]+)/.exec(path);
  const short = /^([^./]+)\.([^./]+)/.exec(path);
  const m = full ?? short;
  return m ? { ...(file ? { file } : {}), schema: m[1]!, field: m[2]! } : undefined;
}

/** The field a reference names, by id or by name: its schema object's index and its own name. */
export function findField(schemas: ContractModel['schemas'], schema: string, field: string): ContractRelation['from'] | undefined {
  const at = schemas.findIndex((s) => s.id === schema);
  const i = at >= 0 ? at : schemas.findIndex((s) => s.name === schema);
  const f = schemas[i]?.fields.find((x) => x.id === field) ?? schemas[i]?.fields.find((x) => x.name === field);
  return f ? { schema: i, field: f.name } : undefined;
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
