// YAML source handling: parse with positions, so every problem can point at a line and column.
import { isMap, isScalar, isSeq, LineCounter, parseDocument, type Document, type Node } from 'yaml';
import { Ajv, type ErrorObject } from 'ajv';
import type { Path } from './model.ts';
import * as validators from './generated/validators.ts';

export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  path?: Path;
  line?: number;
  column?: number;
  /** Character offsets in the source, for editors. */
  from?: number;
  to?: number;
  /** The values allowed here, when the message names only a few of them (editors offer them as fixes). */
  choices?: string[];
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

/**
 * What YAML says, in the words of someone writing a label: "a -> b: [paid] / ship" is a list with
 * text after it, which YAML reports as a scalar it did not expect.
 */
function plain(message: string, line: string, column: number): string {
  if (!/^Unexpected scalar at node end/.test(message)) return message;
  if (/:\s+\[[^\]]*\]\s*[^\s#]/.test(line)) return 'Text that starts with [ ] and goes on after it needs quotes, like "[paid] / ship"';
  // Text after a closing } or ] ("a: { kind: api } x"): it belongs inside, or nowhere.
  const close = line.slice(0, column - 1).trimEnd().at(-1);
  if (close === '}' || close === ']') return `There is text after the closing ${close} on this line: remove it, or move it inside the ${close === '}' ? '{ }' : '[ ]'}`;
  return 'There is text after the value on this line that does not belong to it: remove it, or put the whole value in quotes';
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
      message: plain(e.message.split('\n')[0]!, text.slice(text.lastIndexOf('\n', from - 1) + 1).split('\n')[0]!, lines.linePos(from).col),
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

/** How the validators are compiled: ahead of time by scripts/validators.ts, or here for a schema it did not see. */
export const ajvOptions = { allErrors: true, strict: false, allowUnionTypes: true, verbose: true } as const;

/** A compiled validator, as Ajv makes them. */
type Check = ((data: unknown) => boolean) & { errors?: ErrorObject[] | null };

/** A schema's name among the precompiled validators: a hash of its JSON, the same in the build and here. */
export function schemaKey(schema: object): string {
  const s = JSON.stringify(schema);
  // cyrb53: 53 bits, plenty for a few hundred schemas.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `v${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}_${s.length.toString(36)}`;
}

const compiled = new WeakMap<object, Check>();
let ajv: Ajv | undefined;

/**
 * The validator of a schema: precompiled when the build saw it (every schema the engine checks
 * with, see validatedSchemas), else compiled here. Compiling here uses Function(), which the web
 * app's Content-Security-Policy forbids: a test keeps the precompiled ones current.
 */
function checkOf(schema: object): Check {
  let check = compiled.get(schema);
  if (!check) {
    check = (validators as Record<string, Check | undefined>)[schemaKey(schema)] ?? (ajv ??= new Ajv(ajvOptions)).compile(schema);
    compiled.set(schema, check);
  }
  return check;
}

/** Validate source data against a JSON Schema and turn the errors into readable diagnostics. */
export function validate(source: Source, schema: object): Diagnostic[] {
  const check = checkOf(schema);
  if (check(source.data)) return [];
  // A section of its own written two spaces in ("messages:" under "participants:") reads as an entry
  // of the one above: say so once, rather than what such an entry would need.
  const sections = new Set(Object.keys((schema as { properties?: object }).properties ?? {}));
  const indented = new Set<string>();
  const out: Diagnostic[] = [];
  for (const e of simplify(check.errors ?? [])) {
    const path = pointerToPath(e.instancePath);
    const [section, key] = e.keyword === 'additionalProperties' && path.length === 1 ? [path[0], e.params.additionalProperty] : path;
    if (typeof section === 'string' && typeof key === 'string' && key !== section && sections.has(key)) {
      if (!indented.has(`${section}/${key}`)) out.push(source.at([section, key], `"${key}" is indented under "${section}": a section of its own starts at the left edge, without the spaces before it`));
      indented.add(`${section}/${key}`);
      continue;
    }
    const d = source.at(e.keyword === 'additionalProperties' ? [...path, e.params.additionalProperty] : path, describe(e, path));
    out.push(e.keyword === 'enum' ? { ...d, choices: (e.params.allowedValues as unknown[]).map(String) } : d);
  }
  return out;
}

/** Errors about an entry written short ("web: api") whose value is not a kind: said about the entry, not its name. */
const shortForms = new WeakSet<ErrorObject>();

// anyOf/oneOf produce one error per branch; keep the most specific ones so people see one clear message.
function simplify(errors: ErrorObject[]): ErrorObject[] {
  const byPath = new Map<string, ErrorObject[]>();
  for (const e of errors) byPath.set(e.instancePath, [...(byPath.get(e.instancePath) ?? []), e]);
  const out: ErrorObject[] = [];
  for (const [path, list] of byPath) {
    const deeper = errors.some((e) => e.instancePath.startsWith(path + '/'));
    const concrete = list.filter((e) => !['anyOf', 'oneOf', 'if'].includes(e.keyword));
    if (deeper && concrete.every((e) => e.keyword === 'type' || e.keyword === 'pattern')) continue;
    // A value that has the right type for one branch but fails it there: the other branches'
    // "must be object" errors are noise.
    // A map that fails its own branch: the short-form branch's "must be one of …" says nothing useful.
    const isMap = (e: ErrorObject) => e.data !== null && typeof e.data === 'object' && !Array.isArray(e.data);
    const scalarNoise = (e: ErrorObject) => isMap(e) && ['enum', 'const', 'pattern', 'format'].includes(e.keyword);
    // A map whose own branch fails deeper ("kind" there): the short-form "must be one of" is noise, one error per value.
    if (deeper && concrete.length && concrete.every((e) => e.keyword === 'type' || (e.keyword === 'enum' && isMap(e)))) continue;
    const specific = concrete.filter((e) => e.keyword !== 'type' && !(scalarNoise(e) && concrete.some((x) => !scalarNoise(x) && x.keyword !== 'type')));
    const chosen = specific.length ? specific : concrete.length ? concrete : list;
    // A value that may be a kind or a map of details: the entry written short, its name the key.
    if (list.some((e) => e.keyword === 'type' && e.params.type === 'object')) for (const e of chosen) if (e.keyword === 'enum') shortForms.add(e);
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
      if (shortForms.has(e) && path.length) return shortForm(String(path[path.length - 1]), e.data, (e.params.allowedValues as unknown[]).map(String));
      return oneOf(where, e.data, (e.params.allowedValues as unknown[]).map(String));
    case 'type':
      return `${where} must be ${Array.isArray(e.params.type) ? e.params.type.join(' or ') : e.params.type}`;
    case 'pattern': {
      // Schemas describe their formats; quote the value and say what it should look like.
      const hint = (e.parentSchema as { description?: string } | undefined)?.description;
      const value = typeof e.data === 'string' ? `"${e.data}"` : where;
      return hint ? `${value} should look like ${hint}` : `${value} has an invalid format`;
    }
    case 'propertyNames':
      return `Invalid name "${e.params.propertyName}": use letters, digits, - and _`;
    default:
      return `${where} ${e.message ?? 'is invalid'}`;
  }
}

/** Up to this many allowed values, the message lists them all; past it, the nearest and a few. */
const LIST_ALL = 8;

/** "kind" must be one of a, b, c; a long list says what was probably meant and names a few. */
function oneOf(where: string, value: unknown, allowed: string[]): string {
  const near = typeof value === 'string' ? nearest(value, allowed) : undefined;
  if (allowed.length <= LIST_ALL) return `${where} must be one of: ${allowed.join(', ')}${near ? ` (did you mean ${near}?)` : ''}`;
  const shown = typeof value === 'string' || typeof value === 'number' ? `"${value}"` : 'that';
  const few = allowed.filter((a) => a !== near).slice(0, 6).join(', ');
  return `${where} cannot be ${shown}${near ? `: did you mean ${near}?` : ''} (${allowed.length} allowed, e.g. ${few}, …; completion in the editor lists them all)`;
}

/**
 * An entry written short ("web: api") with a value that is not a kind: the entry's name is fine, what
 * follows it is not. Says what may follow: one of the kinds, or the details in { }.
 */
function shortForm(name: string, value: unknown, allowed: string[]): string {
  const near = typeof value === 'string' ? nearest(value, allowed) : undefined;
  const kinds = allowed.length <= LIST_ALL ? allowed.join(', ') : `${allowed.filter((a) => a !== near).slice(0, 6).join(', ')}, …`;
  const scalar = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  const what = scalar ? `"${value}" is not a kind${near ? `: did you mean ${near}?` : ''}` : Array.isArray(value) ? 'a list is not a kind' : 'it needs a kind or its details';
  return `"${scalar ? `${name}: ${value}` : name}": ${what}. Write a kind after the name (${kinds}), or the details in { }, like ${name}: { label: ${name} }`;
}

/** The allowed value one typo or so away, or the only one that starts the same. */
export function nearest(value: string, allowed: string[]): string | undefined {
  const v = value.toLowerCase();
  let best: string | undefined;
  let score = Infinity;
  for (const a of allowed) {
    const d = editDistance(v, a.toLowerCase());
    if (d < score) (score = d), (best = a);
  }
  if (best && score <= Math.max(1, Math.floor(v.length / 3))) return best;
  const starts = v.length >= 3 ? allowed.filter((a) => a.toLowerCase().startsWith(v)) : [];
  return starts.length === 1 ? starts[0] : undefined;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const was = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = was;
    }
  }
  return row[b.length]!;
}

function pointerToPath(pointer: string): Path {
  if (!pointer) return [];
  return pointer
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}
