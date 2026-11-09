// YAML source handling: parse with positions, so every problem can point at a line and column.
import { isMap, isScalar, isSeq, LineCounter, parseDocument, type Document, type Node } from 'yaml';
import { Ajv, type ErrorObject } from 'ajv';
import type { Path } from './model.ts';

export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  path?: Path;
  line?: number;
  column?: number;
  /** Character offsets in the source, for editors. */
  from?: number;
  to?: number;
}

export interface Source {
  text: string;
  data: unknown;
  doc: Document;
  diagnostics: Diagnostic[];
  /** Line/column (1-based) and offsets of a path in the source, or the nearest parent that exists. */
  locate(path: Path): { line: number; column: number; from: number; to: number } | undefined;
  /** A diagnostic with position filled in. */
  at(path: Path, message: string, severity?: Diagnostic['severity']): Diagnostic;
}

export function parseSource(text: string): Source {
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines, prettyErrors: false, uniqueKeys: true });
  const diagnostics: Diagnostic[] = [];

  const position = (from: number, to: number) => {
    const { line, col } = lines.linePos(from);
    return { line, column: col, from, to };
  };

  for (const e of [...doc.errors, ...doc.warnings]) {
    const [from = 0, to = from] = e.pos;
    diagnostics.push({
      severity: doc.errors.includes(e as never) ? 'error' : 'warning',
      message: e.message.split('\n')[0]!,
      ...position(from, to),
    });
  }

  const locate: Source['locate'] = (path) => {
    let node: unknown = doc.contents;
    let range: [number, number] | undefined = rangeOf(node);
    for (const [i, key] of path.entries()) {
      if (isMap(node)) {
        const pair = node.items.find((p) => isScalar(p.key) && String(p.key.value) === String(key));
        if (!pair) break;
        // The last step points at the key: that is where people look for "this entry".
        range = (i === path.length - 1 ? rangeOf(pair.key) : rangeOf(pair.value)) ?? range;
        node = pair.value;
      } else if (isSeq(node) && typeof key === 'number' && node.items[key]) {
        node = node.items[key];
        range = rangeOf(node) ?? range;
      } else break;
    }
    return range ? position(range[0], range[1]) : undefined;
  };

  return {
    text,
    doc,
    data: doc.errors.length ? undefined : doc.toJS(),
    diagnostics,
    locate,
    at: (path, message, severity = 'error') => ({ severity, message, path, ...locate(path) }),
  };
}

function rangeOf(node: unknown): [number, number] | undefined {
  const r = (node as Node | undefined)?.range;
  return r ? [r[0], r[1]] : undefined;
}

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
const compiled = new WeakMap<object, ReturnType<typeof ajv.compile>>();

/** Validate source data against a JSON Schema and turn the errors into readable diagnostics. */
export function validate(source: Source, schema: object): Diagnostic[] {
  let check = compiled.get(schema);
  if (!check) compiled.set(schema, (check = ajv.compile(schema)));
  if (check(source.data)) return [];
  return simplify(check.errors ?? []).map((e) => {
    const path = pointerToPath(e.instancePath);
    return source.at(e.keyword === 'additionalProperties' ? [...path, e.params.additionalProperty] : path, describe(e, path));
  });
}

// anyOf/oneOf produce one error per branch; keep the most specific ones so people see one clear message.
function simplify(errors: ErrorObject[]): ErrorObject[] {
  const byPath = new Map<string, ErrorObject[]>();
  for (const e of errors) byPath.set(e.instancePath, [...(byPath.get(e.instancePath) ?? []), e]);
  const out: ErrorObject[] = [];
  for (const [path, list] of byPath) {
    const deeper = errors.some((e) => e.instancePath.startsWith(path + '/'));
    const concrete = list.filter((e) => !['anyOf', 'oneOf', 'if'].includes(e.keyword));
    if (deeper && concrete.every((e) => e.keyword === 'type' || e.keyword === 'pattern')) continue;
    const chosen = concrete.length ? concrete : list;
    out.push(...dedupe(chosen));
  }
  return out;
}

function dedupe(list: ErrorObject[]): ErrorObject[] {
  const seen = new Set<string>();
  return list.filter((e) => {
    const k = e.keyword === 'type' ? 'type' : `${e.keyword}:${JSON.stringify(e.params)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function describe(e: ErrorObject, path: Path): string {
  const where = path.length ? `"${path[path.length - 1]}"` : 'The diagram';
  switch (e.keyword) {
    case 'additionalProperties':
      return `Unknown field "${e.params.additionalProperty}"`;
    case 'required':
      return `${where} needs "${e.params.missingProperty}"`;
    case 'enum':
      return `${where} must be one of: ${(e.params.allowedValues as unknown[]).join(', ')}`;
    case 'type':
      return `${where} must be ${Array.isArray(e.params.type) ? e.params.type.join(' or ') : e.params.type}`;
    case 'pattern':
      return `${where} has an invalid format`;
    case 'propertyNames':
      return `Invalid name "${e.params.propertyName}": use letters, digits, - and _`;
    default:
      return `${where} ${e.message ?? 'is invalid'}`;
  }
}

function pointerToPath(pointer: string): Path {
  if (!pointer) return [];
  return pointer
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}
