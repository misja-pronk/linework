// `each:` — write a pattern once for a list of values. Named lists at the top of a file, and <name>
// placeholders in what the file says:
//
//   each:
//     domain: [orders, webshop, finance]
//     env: [dev, test, prod]
//   elements:
//     <domain>_<env>: { kind: catalog, owner: <domain>-team, tags: [<env>] }
//   relations:
//     - <domain>_<env> -> dbw-lakehouse-<env>: Bound
//
// An entry whose name (a map key) names a list is written once per value, a list item that names one
// once per value (nine catalogs, nine relations above), first list outermost, in place of the pattern.
// Inside an entry the values it was written for stay: <domain> in its owner is the entry's own domain.
// A list may give its values fields (domain: { orders: { team: Order management } }), read as <domain.team>.
//
// Expansion is a step before everything else: the type, includes and views see plain entries. Paths
// in the expanded data lead back to the pattern (`back`), so a problem points at the line it was
// written on and says for which values. A file without `each:` is read exactly as before.
import { nearest, type Diagnostic, type Source } from './source.ts';
import type { Path } from './model.ts';

/** One value of a list: its name (what <list> becomes) and its fields (what <list.field> becomes). */
export interface EachValue {
  name: string;
  fields: Record<string, string>;
}

/** The values one entry was written for: list name → value name. */
export type Binding = Record<string, string>;

export interface Expansion {
  /** The file with every pattern written out and `each:` taken out. */
  data: unknown;
  lists: Map<string, EachValue[]>;
  /** Problems with the lists or the placeholders, at their paths in the file as written. */
  problems: { path: Path; message: string; severity: 'error' | 'warning' }[];
  /**
   * Where a path of the expanded data is written: its path in the file, and, when it is in an entry a
   * pattern wrote out, the values that entry was written for and the expanded path of that entry.
   */
  back(path: Path): { path: Path; binding?: Binding; entry?: Path };
}

/** The keyword at the top of a file. */
export const EACH = 'each';

const NAME = /^[A-Za-z][\w-]*$/;
/** <name>, <name.field>; \<name> is the text "<name>". */
const PLACEHOLDER = /(\\?)<([A-Za-z][\w-]*)(?:\.([A-Za-z][\w-]*))?>/g;

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const scalar = (v: unknown): v is string | number | boolean => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

/** The lists a string names, in the order it names them; escaped ones are text. */
function named(s: string): { list: string; field?: string }[] {
  const out: { list: string; field?: string }[] = [];
  for (const m of s.matchAll(PLACEHOLDER)) if (!m[1]) out.push({ list: m[2]!, ...(m[3] ? { field: m[3] } : {}) });
  return out;
}

/** Whether a file uses `each:` at all: everything else is read as it is. */
export const hasEach = (data: unknown): boolean => isMap(data) && EACH in data;

/** Trace of one expanded container: for each key or index of the output, the key or index written and what is below it. */
interface Trace {
  src: string | number;
  /** Set on an entry a pattern wrote out: the values it was written for (with those of entries around it). */
  binding?: Binding;
  kids?: Map<string | number, Trace>;
  /**
   * Set where an entry written out by hand adds to one a pattern wrote: what it adds is written at this
   * path of the file, not under the pattern, for the values of the entries around it (outer).
   */
  abs?: Path;
  outer?: Binding;
}

/** Reads `each:`: list name → values, in the order written. */
function readLists(raw: unknown, problem: (path: Path, message: string, severity?: 'error' | 'warning') => void): Map<string, EachValue[]> {
  const lists = new Map<string, EachValue[]>();
  if (!isMap(raw)) {
    problem([EACH], 'each: names lists, like domain: [orders, webshop] and env: [dev, test, prod]');
    return lists;
  }
  for (const [name, v] of Object.entries(raw)) {
    const at: Path = [EACH, name];
    if (!NAME.test(name)) {
      problem(at, `"${name}" cannot name a list: start with a letter, then letters, digits, - and _`);
      continue;
    }
    const values: EachValue[] = [];
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        if (scalar(x)) values.push({ name: String(x), fields: {} });
        else problem([...at, i], `A value of ${name} is a name, like orders; to give it fields write ${name}: { orders: { label: Orders } }`);
      });
    } else if (isMap(v)) {
      for (const [value, fields] of Object.entries(v)) {
        if (fields != null && !isMap(fields)) {
          problem([...at, value], `The fields of ${value} go in { }, like ${value}: { label: ${value} }`);
          continue;
        }
        const own: Record<string, string> = {};
        for (const [f, x] of Object.entries(fields ?? {})) {
          if (!NAME.test(f)) problem([...at, value, f], `"${f}" cannot name a field: start with a letter, then letters, digits, - and _`);
          else if (!scalar(x)) problem([...at, value, f], `A field is one value: ${f}: text`);
          else own[f] = String(x);
        }
        values.push({ name: value, fields: own });
      }
    } else {
      problem(at, `${name} is a list of values, like ${name}: [a, b, c]`);
      continue;
    }
    const seen = new Set<string>();
    for (const [i, x] of values.entries()) {
      if (seen.has(x.name)) problem(Array.isArray(v) ? [...at, i] : [...at, x.name], `${x.name} is twice in ${name}`);
      seen.add(x.name);
    }
    if (!values.length) problem(at, `${name} has no values: what is written with <${name}> is left out`, 'warning');
    lists.set(
      name,
      values.filter((x, i) => values.findIndex((y) => y.name === x.name) === i),
    );
  }
  return lists;
}

/** Every combination of the values of these lists, the first list outermost. */
function combinations(names: string[], lists: Map<string, EachValue[]>): Binding[] {
  let out: Binding[] = [{}];
  for (const n of names) out = out.flatMap((b) => lists.get(n)!.map((v) => ({ ...b, [n]: v.name })));
  return out;
}

/** A pattern with some of its lists given: "<domain>-<env>" with env dev is "<domain>-dev". Fields stay as written. */
export const fillIn = (pattern: string, b: Binding): string => pattern.replace(PLACEHOLDER, (whole, escaped: string, list: string, field?: string) => (escaped || field || b[list] === undefined ? whole : b[list]!));

/** "domain orders, env dev": the values an entry was written for, as a reader says them. */
export const bindingText = (b: Binding) =>
  Object.entries(b)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');

/** Writes out every pattern in a file with `each:`; undefined when it has none. */
export function expandEach(input: unknown): Expansion | undefined {
  if (!hasEach(input)) return undefined;
  const problems: Expansion['problems'] = [];
  const said = new Set<string>();
  const problem = (path: Path, message: string, severity: 'error' | 'warning' = 'error') => {
    const key = `${JSON.stringify(path)}\0${message}`;
    if (said.has(key)) return;
    said.add(key);
    problems.push({ path, message, severity });
  };
  const { [EACH]: raw, ...rest } = input as Record<string, unknown>;
  const lists = readLists(raw, problem);
  const listNames = [...lists.keys()];

  /** What a string names that is not a list: said once, at where it is written. */
  const known = (s: string, at: Path): boolean => {
    let ok = true;
    for (const { list, field } of named(s)) {
      if (!lists.has(list)) {
        ok = false;
        const near = nearest(list, listNames);
        const lists = listNames.length ? `the lists under each: are ${listNames.map((n) => `<${n}>`).join(', ')}` : 'each: names no lists';
        problem(at, `<${list}> is not a list of each: ${near ? `did you mean <${near}>? ` : ''}(${lists}). For the text <${list}> itself, write \\<${list}>`);
      } else if (field && !lists.get(list)!.some((v) => field in v.fields)) {
        ok = false;
        problem(at, `No value of ${list} has a field "${field}"`);
      }
    }
    return ok;
  };
  // A field may name lists itself (owner: sp-lakehouse-<env>): what it names must be there.
  for (const [list, values] of lists) for (const v of values) for (const [f, x] of Object.entries(v.fields)) known(x, [EACH, list, v.name, f]);

  /** The lists a string names that the entry around it was not written for. */
  const open = (s: string, b: Binding) => [...new Set(named(s).map((n) => n.list))].filter((n) => lists.has(n) && !(n in b));

  /**
   * A string with the values of b. A field may itself name lists (owner: sp-lakehouse-<env>): those are
   * filled in too, with the values of the entry it is used in; a field that comes back to itself is said
   * at each:, where it is written.
   */
  const fill = (s: string, b: Binding, at: Path, through: string[] = []): string =>
    s.replace(PLACEHOLDER, (whole, escaped: string, list: string, field?: string) => {
      if (escaped) return whole.slice(1);
      const value = b[list];
      if (value === undefined) return whole;
      if (!field) return value;
      const v = lists.get(list)?.find((x) => x.name === value)?.fields[field];
      if (v === undefined) {
        problem(at, `${value} has no field "${field}" under each: ${list}`);
        return '';
      }
      if (!named(v).length) return v;
      const self = `<${list}.${field}>`;
      if (through.includes(self)) {
        const loop = [...through.slice(through.indexOf(self)), self];
        problem([EACH, list, value, field], `${field} of ${value} comes back to itself: ${loop.join(' → ')}. A field can use other fields, not itself`);
        return '';
      }
      const left = open(v, b);
      if (left.length) {
        problem(at, `${self} of ${value} is ${v}, and <${left[0]}> is not given here: write it in the name of the entry (the key, or the list item) it is in, so that entry is written once per ${left[0]}`);
        return '';
      }
      return fill(v, b, at, [...through, self]);
    });

  /** A value that is not an entry's name or a list item: what it names must be given by the entry around it. */
  const value = (v: unknown, b: Binding, at: Path, trace: Trace): unknown => {
    if (typeof v === 'string') {
      if (!known(v, at)) return v;
      const left = open(v, b);
      if (left.length) problem(at, `<${left[0]}> is not given here: write it in the name of the entry (the key, or the list item) it is in, so that entry is written once per ${left[0]}`);
      return fill(v, b, at);
    }
    if (Array.isArray(v)) return items(v, b, at, trace);
    if (isMap(v)) return entries(v, b, at, trace);
    return v;
  };

  /** What a list item names itself: in its text, or in the keys and plain values of the map it is. */
  const head = (item: unknown): string[] => (typeof item === 'string' ? [item] : isMap(item) ? [...Object.keys(item), ...Object.values(item).filter((x): x is string => typeof x === 'string')] : []);

  const items = (list: unknown[], b: Binding, at: Path, trace: Trace): unknown[] => {
    const out: unknown[] = [];
    trace.kids = new Map();
    list.forEach((item, i) => {
      const here = [...at, i];
      const words = head(item);
      // What names a list that is not there is said, and left out: it cannot be written out.
      if (!words.every((w) => known(w, here))) return;
      const names = [...new Set(words.flatMap((w) => open(w, b)))];
      for (const extra of combinations(names, lists)) {
        const bb = { ...b, ...extra };
        const t: Trace = { src: i };
        if (names.length) t.binding = bb;
        trace.kids!.set(out.length, t);
        out.push(typeof item === 'string' ? fill(item, bb, here) : value(item, bb, here, t));
      }
    });
    return out;
  };

  /**
   * An entry written out by hand with a name a pattern also writes (orders_prod next to <domain>_<env>)
   * adds to what the pattern wrote: maps are merged key by key, lists get its items after the pattern's
   * (a value already there is not added twice), and a field it writes wins. What it adds leads back
   * to where it is written (abs), for the values of the entries around it (outer).
   */
  const merge = (pv: unknown, pt: Trace | undefined, wv: unknown, wt: Trace, wAt: Path, outer: Binding): { v: unknown; t: Trace } => {
    const moved = (t: Trace, path: Path): Trace => ({ ...t, abs: path, ...(Object.keys(outer).length ? { outer } : {}) });
    const kid = (t: Trace, seg: string | number): { t: Trace; at: Path } => {
      const k = t.kids?.get(seg) ?? { src: seg };
      return { t: k, at: k.abs ?? [...wAt, k.src] };
    };
    if (pt && isMap(pv) && isMap(wv)) {
      const v: Record<string, unknown> = { ...pv };
      const t: Trace = { ...pt, kids: new Map(pt.kids) };
      for (const [key, x] of Object.entries(wv)) {
        const w = kid(wt, key);
        if (key in pv) {
          const m = merge(pv[key], pt.kids?.get(key), x, w.t, w.at, outer);
          v[key] = m.v;
          t.kids!.set(key, m.t);
        } else {
          v[key] = x;
          t.kids!.set(key, moved(w.t, w.at));
        }
      }
      return { v, t };
    }
    if (pt && Array.isArray(pv) && Array.isArray(wv)) {
      const v = [...pv];
      const t: Trace = { ...pt, kids: new Map(pt.kids) };
      wv.forEach((x, i) => {
        if (scalar(x) && pv.includes(x)) return;
        const w = kid(wt, i);
        t.kids!.set(v.length, moved(w.t, w.at));
        v.push(x);
      });
      return { v, t };
    }
    return { v: wv, t: moved(wt, wAt) };
  };

  const entries = (map: Record<string, unknown>, b: Binding, at: Path, trace: Trace): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    const from = new Map<string, string>();
    trace.kids = new Map();
    // The names the patterns here write, first: an entry written out with one of them adds to it, wherever it is written.
    const patterns = new Map<string, { k: string; b: Binding }>();
    for (const k of Object.keys(map)) {
      if (!named(k).length || !known(k, [...at, k])) continue;
      const names = open(k, b);
      if (!names.length) continue;
      for (const extra of combinations(names, lists)) {
        const bb = { ...b, ...extra };
        const key = fill(k, bb, [...at, k]);
        if (!patterns.has(key)) patterns.set(key, { k, b: bb });
      }
    }
    const adds: { key: string; k: string; v: unknown }[] = [];
    for (const [k, v] of Object.entries(map)) {
      const here = [...at, k];
      if (!known(k, here)) continue;
      const names = open(k, b);
      if (!names.length) {
        const p = patterns.get(fill(k, b, here));
        if (p && p.k !== k) {
          adds.push({ key: fill(k, b, here), k, v });
          continue;
        }
      }
      for (const extra of combinations(names, lists)) {
        const bb = { ...b, ...extra };
        const key = fill(k, bb, here);
        const was = from.get(key);
        if (was !== undefined) {
          problem(here, was === k ? `${k} writes "${key}" twice: two values give the same name` : `"${key}" is already written by ${was}: give one of them another name`);
          continue;
        }
        from.set(key, k);
        const t: Trace = { src: k };
        if (names.length) t.binding = bb;
        trace.kids.set(key, t);
        out[key] = value(v, bb, here, t);
      }
    }
    for (const { key, k, v } of adds) {
      const here = [...at, k];
      const p = patterns.get(key)!;
      if (v == null || !(key in out)) continue;
      if (!isMap(v)) {
        problem(here, `"${key}" is written by ${p.k} too: write what it adds to that in { }, like ${k}: { tags: [pii] }`);
        continue;
      }
      if (!isMap(out[key])) {
        problem(here, `"${key}" is written by ${p.k} as one value: write that as { kind: … } for ${k} to add to it`);
        continue;
      }
      // Filled in with the values of the entry it adds to: <domain> in orders_prod is orders, as in the pattern.
      const wt: Trace = { src: k };
      const wv = value(v, p.b, here, wt);
      const m = merge(out[key], trace.kids.get(key), wv, wt, here, b);
      out[key] = m.v;
      trace.kids.set(key, m.t);
    }
    return out;
  };

  const root: Trace = { src: '' };
  const data = entries(rest, {}, [], root);
  // each: stays where it was written, for a path that leads there (completion, a problem in it).
  root.kids!.set(EACH, { src: EACH });

  return {
    data,
    lists,
    problems,
    back(path) {
      const out: Path = [];
      let t: Trace | undefined = root;
      let binding: Binding | undefined;
      let entry: Path | undefined;
      for (const [i, seg] of path.entries()) {
        const next: Trace | undefined = t?.kids?.get(seg);
        if (!next) {
          out.push(...path.slice(i));
          break;
        }
        if (next.abs) {
          // Added by an entry written out by hand: it is written there, for the values of the entries around it.
          out.splice(0, out.length, ...next.abs);
          binding = next.outer;
          entry = undefined;
        } else out.push(next.src);
        if (next.binding) (binding = next.binding), (entry = path.slice(0, i + 1));
        t = next;
      }
      return { path: out, ...(binding ? { binding, entry } : {}) };
    },
  };
}

/** What a type sees of a file's `each:`: its lists, and the values an entry was written for. */
export interface EachContext {
  lists: Map<string, EachValue[]>;
  /** For an entry of the expanded data (['principals', 'orders-team']): the name it was written as, and its values. */
  entry(path: Path): { pattern: string; binding: Binding } | undefined;
}

/**
 * The source of a file with `each:` written out: its data expanded, its paths leading back to the
 * pattern, and a problem in an entry a pattern wrote out said once, for the values it is about.
 * The same source back, for a file without `each:`.
 */
export function withEach(src: Source): { source: Source; problems: Diagnostic[]; each?: EachContext; expansion?: Expansion } {
  const x = src.data === undefined ? undefined : expandEach(src.data);
  if (!x) return { source: src, problems: [] };
  // One problem in a pattern is one problem: said once, with the first values and how many more.
  const once = new Map<string, { d: Diagnostic; message: string; first: Binding; more: number }>();
  const locate: Source['locate'] = (path) => src.locate(x.back(path).path);
  const at: Source['at'] = (path, message, severity = 'error') => {
    const b = x.back(path);
    const d: Diagnostic = { severity, message, path: b.path, ...src.locate(b.path) };
    if (!b.binding) return d;
    const key = `${severity}\0${d.from}\0${message}`;
    const seen = once.get(key);
    if (!seen) {
      d.message = `${message} (for ${bindingText(b.binding)})`;
      once.set(key, { d, message, first: b.binding, more: 0 });
      return d;
    }
    seen.more++;
    seen.d.message = `${seen.message} (for ${bindingText(seen.first)}, and ${seen.more} more)`;
    return seen.d;
  };
  const source: Source = { ...src, data: x.data, locate, at };
  const problems = x.problems.map((p) => src.at(p.path, p.message, p.severity));
  const each: EachContext = {
    lists: x.lists,
    entry(path) {
      const b = x.back(path);
      if (!b.binding || b.entry?.length !== path.length) return undefined;
      return { pattern: String(b.path.at(-1)), binding: b.binding };
    },
  };
  return { source, problems, each, expansion: x };
}

const FOR = /^([\s\S]*) \(for [^()]*?(?:, and (\d+) more)?\)$/;

/**
 * Diagnostics said once: a problem in a pattern is said for every value it was written out for, and
 * comes back as one, at its first place, with how many more (a copy made on the way keeps an earlier count).
 */
export function once(ds: Diagnostic[]): Diagnostic[] {
  const first = new Map<string, number>();
  const out: Diagnostic[] = [];
  for (const d of ds) {
    const m = FOR.exec(d.message);
    if (!m) {
      if (!out.includes(d)) out.push(d);
      continue;
    }
    const key = `${d.severity}\0${d.from}\0${m[1]}`;
    const at = first.get(key);
    if (at === undefined) {
      first.set(key, out.length);
      out.push(d);
    } else if (Number(m[2] ?? 0) > Number(FOR.exec(out[at]!.message)?.[2] ?? 0)) out[at] = { ...out[at]!, message: d.message };
  }
  return out;
}

/**
 * The path an editor gets: where it is written (a line after a pattern's lines is the item it is in the
 * file). For something a pattern wrote out: the pattern's own, and one step more
 * that no entry has, so it is shown where it is written and changed there in the YAML, never taken
 * for an entry of its own (renaming or deleting one value would rewrite every one).
 */
export function patternPath(x: Expansion, path: Path): Path {
  const b = x.back(path);
  return b.binding ? [...b.path, `<${bindingText(b.binding)}>`] : b.path;
}

/** Schema of `each:`, for completion and hover in editors (the engine checks it in its own words). */
export const eachSchema = {
  type: 'object',
  description:
    'Named lists for patterns: domain: [orders, webshop] and env: [dev, test, prod]. An entry or list item whose name says <domain> is written once per domain; <domain.label> is a field of the value (domain: { orders: { label: Orders } }). \\<x> is the text <x>',
  additionalProperties: {
    anyOf: [
      { type: 'array', items: { type: ['string', 'number'] } },
      { type: 'object', additionalProperties: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] } }] } },
    ],
  },
};
