// A customer's own review settings: `.cartography/rules.yaml` (or `rules/*.yaml`) in the folder.
// Which packs run, severities and options per rule, findings set aside, and simple rules of their
// own, written as data from a small fixed set of words. Nothing in them is ever run as code.
//
//   packs: [azure, systems]
//   rules:
//     azure.no-diagnostics: off
//     arch.deep-sync-chain: { severity: error, max-chain: 3 }
//   ignore:
//     - { rule: azure.prod-single-region, reason: One region by decision, see ADR 7 }
//   custom:
//     - id: acme.sql-backup
//       title: Every SQL database is backed up
//       every: { kind: sql-database }
//       must: { tag: backup }
//     - id: acme.dmz-to-data
//       title: Nothing in the DMZ talks to the data subnet
//       no-edge: { from: { in: dmz }, to: { in: data } }
//     - id: acme.db-in-subnet
//       title: Databases sit in a subnet
//       every: { kind: [sql-database, postgres] }
//       must: { in: { kind: subnet } }
import { parseSource, type Diagnostic, type Path } from '@cartography/core';
import type { El, ReviewModel } from './model.ts';
import { categories, type Category, type Hit, type Rule, type Severity } from './types.ts';
import { t } from './nl.ts';
import type { Lang } from '@cartography/i18n';

export type Level = Severity | 'off';

export interface IgnoreEntry {
  rule: string;
  /** An element id or a line "a -> b"; none: everywhere. */
  on?: string;
  reason?: string;
}

export interface ReviewConfig {
  packs?: string[];
  /** Per rule: its severity (or off), and options such as max-chain. */
  rules: Record<string, { severity?: Level; options: Record<string, number> }>;
  ignore: IgnoreEntry[];
  custom: Rule[];
  /** Where it was read from, for the report: ".cartography/rules.yaml". */
  files: string[];
}

export const emptyConfig = (): ReviewConfig => ({ rules: {}, ignore: [], custom: [], files: [] });

export interface ConfigProblem extends Diagnostic {
  file: string;
}

const LEVELS = ['off', 'info', 'warn', 'error'];
const SELECTOR_KEYS = ['id', 'kind', 'tag', 'in', 'label', 'prop', 'has', 'env', 'group', 'not', 'any'];
const MUST_KEYS = [...SELECTOR_KEYS, 'edge-to', 'edge-from'];
const RULE_KEYS = ['id', 'title', 'why', 'severity', 'category', 'applies-to', 'fix', 'docs', 'every', 'must', 'must-not', 'no-edge', 'exists'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** A selector: which elements it means. Every key written must hold. */
export type Selector = Obj;

/** Whether an element matches a selector of rules.yaml. */
export function matches(m: ReviewModel, e: El, sel: Selector): boolean {
  for (const [k, v] of Object.entries(sel)) {
    switch (k) {
      case 'id':
        if (!list(v).includes(e.id)) return false;
        break;
      case 'kind':
        if (!list(v).includes(e.kind ?? '')) return false;
        break;
      case 'tag':
        if (!list(v).some((t) => e.tags.includes(t))) return false;
        break;
      case 'group':
        if (e.group !== !!v) return false;
        break;
      case 'label':
        if (!list(v).some((t) => e.label.toLowerCase().includes(t.toLowerCase()))) return false;
        break;
      case 'env':
        if (!list(v).some((t) => m.envs(e.id).includes(t))) return false;
        break;
      case 'has':
        if (!list(v).every((p) => m.prop(e.id, p) !== undefined)) return false;
        break;
      case 'prop':
        for (const [p, want] of Object.entries(isObj(v) ? v : {})) {
          const got = m.prop(e.id, p);
          const wanted = (Array.isArray(want) ? want : [want]).map((x) => String(x).toLowerCase());
          if (got === undefined || !wanted.includes(String(got).toLowerCase())) return false;
        }
        break;
      case 'in': {
        const around = m.ancestors(e.id);
        if (typeof v === 'string' ? !around.some((g) => g.id === v) : !around.some((g) => matches(m, g, isObj(v) ? v : {}))) return false;
        break;
      }
      case 'not':
        if (matches(m, e, isObj(v) ? v : {})) return false;
        break;
      case 'any':
        if (!(Array.isArray(v) ? v : []).some((s) => matches(m, e, isObj(s) ? s : {}))) return false;
        break;
      case 'edge-to':
        if (!m.out(e.id).some((l) => !!m.el(l.to) && matches(m, m.el(l.to)!, isObj(v) ? v : {}))) return false;
        break;
      case 'edge-from':
        if (!m.in(e.id).some((l) => !!m.el(l.from) && matches(m, m.el(l.from)!, isObj(v) ? v : {}))) return false;
        break;
    }
  }
  return true;
}

/** Says in words what a selector means, for a finding: "kind sql-database", "in dmz". */
function said(sel: Selector, lang: Lang): string {
  return Object.entries(sel)
    .map(([k, v]) => (k === 'not' ? t(lang, 'not {what}', { what: said(isObj(v) ? v : {}, lang) }) : k === 'prop' && isObj(v) ? Object.entries(v).map(([p, x]) => `${p} ${String(x)}`).join(', ') : isObj(v) ? `${k} ${said(v, lang)}` : `${k} ${list(v).join(t(lang, ' or ')) || String(v)}`))
    .join(', ');
}

/** A rule of rules.yaml as a rule like the built-in ones. */
function customRule(o: Obj): Rule {
  const every = isObj(o.every) ? o.every : undefined;
  const must = isObj(o.must) ? o.must : undefined;
  const mustNot = isObj(o['must-not']) ? o['must-not'] : undefined;
  const noEdge = isObj(o['no-edge']) ? o['no-edge'] : undefined;
  const exists = isObj(o.exists) ? o.exists : undefined;
  const id = String(o.id);
  return {
    id,
    pack: id.includes('.') ? id.split('.')[0]! : 'custom',
    title: String(o.title),
    why: typeof o.why === 'string' ? o.why : 'A rule of this organisation.',
    severity: (typeof o.severity === 'string' && o.severity !== 'off' ? o.severity : 'warn') as Severity,
    category: (typeof o.category === 'string' ? o.category : 'operations') as Category,
    appliesTo: list(o['applies-to']).length ? list(o['applies-to']) : ['*'],
    fix: typeof o.fix === 'string' ? o.fix : '',
    ...(typeof o.docs === 'string' ? { docs: o.docs } : {}),
    check(m) {
      const hits: Hit[] = [];
      const all = [...m.nodes.values(), ...m.groups.values()];
      const at = (e: El) => ({ kind: e.group ? 'group' : 'node', id: e.id }) as const;
      if (every)
        for (const e of all.filter((x) => matches(m, x, every))) {
          if (must && !matches(m, e, must)) hits.push({ on: at(e), message: t(m.lang, '{name} should have {what}', { name: e.label, what: said(must, m.lang) }) });
          else if (mustNot && matches(m, e, mustNot)) hits.push({ on: at(e), message: t(m.lang, '{name} should not have {what}', { name: e.label, what: said(mustNot, m.lang) }) });
        }
      if (noEdge) {
        const from = isObj(noEdge.from) ? noEdge.from : {};
        const to = isObj(noEdge.to) ? noEdge.to : {};
        const style = list(noEdge.style);
        for (const l of m.lines) {
          const a = m.el(l.from);
          const b = m.el(l.to);
          if (a && b && matches(m, a, from) && matches(m, b, to) && (!style.length || style.includes(l.style))) hits.push({ on: { kind: 'edge', id: l.id }, message: t(m.lang, '{line}: no line should go from {from} to {to}', { line: m.lineName(l), from: said(from, m.lang), to: said(to, m.lang) }) });
        }
      }
      if (exists && !all.some((e) => matches(m, e, exists))) hits.push({ on: { kind: 'diagram' }, message: t(m.lang, 'Nothing here has {what}', { what: said(exists, m.lang) }), path: ['title'] });
      return hits;
    },
  };
}

/**
 * Reads one rules file. Problems are said with their line; a broken rule is left out, the rest
 * still counts. `known` are the ids of the built-in rules, so a typo in one is said.
 */
export function readConfig(text: string, file: string, known: Set<string>, into: ReviewConfig = emptyConfig()): { config: ReviewConfig; problems: ConfigProblem[] } {
  const source = parseSource(text);
  const problems: ConfigProblem[] = source.diagnostics.map((d) => ({ ...d, file }));
  const say = (path: Path, message: string, severity: Diagnostic['severity'] = 'error') => problems.push({ ...source.at(path, message, severity), file });
  const data = source.data;
  into.files.push(file);
  if (data == null) return { config: into, problems };
  if (!isObj(data)) return say([], 'A rules file is a map: packs:, rules:, ignore: and custom:'), { config: into, problems };
  for (const k of Object.keys(data)) if (!['packs', 'rules', 'ignore', 'custom'].includes(k)) say([k], `"${k}" is not a rules file key: packs, rules, ignore or custom`);
  if (data.packs !== undefined) {
    if (!list(data.packs).length && !Array.isArray(data.packs)) say(['packs'], 'packs: is a list, e.g. [azure, systems]');
    else into.packs = list(data.packs);
  }
  const customIds = new Set<string>();
  if (data.custom !== undefined) {
    if (!Array.isArray(data.custom)) say(['custom'], 'custom: is a list of rules');
    for (const [i, raw] of (Array.isArray(data.custom) ? data.custom : []).entries()) {
      const at: Path = ['custom', i];
      if (!isObj(raw)) {
        say(at, 'A rule is a map with id, title and every: / no-edge: / exists:');
        continue;
      }
      const before = problems.length;
      for (const k of Object.keys(raw)) if (!RULE_KEYS.includes(k)) say([...at, k], `"${k}" is not a rule key: ${RULE_KEYS.join(', ')}`);
      if (typeof raw.id !== 'string' || !/^[a-z0-9][\w-]*(\.[\w-]+)*$/i.test(raw.id)) say([...at, 'id'], 'A rule needs an id like acme.sql-backup');
      else if (known.has(raw.id)) say([...at, 'id'], `${raw.id} is a built-in rule: give yours an id of its own, e.g. acme.${raw.id.split('.').pop()}`);
      else if (customIds.has(raw.id) || into.custom.some((r) => r.id === raw.id)) say([...at, 'id'], `There is already a rule ${raw.id}`);
      if (typeof raw.title !== 'string') say(at, 'A rule needs a title: what should hold, e.g. "Every SQL database is backed up"');
      if (raw.severity !== undefined && !['info', 'warn', 'error'].includes(String(raw.severity))) say([...at, 'severity'], 'severity is info, warn or error');
      if (raw.category !== undefined && !categories.includes(raw.category as Category)) say([...at, 'category'], `category is one of ${categories.join(', ')}`);
      const checks = ['every', 'no-edge', 'exists'].filter((k) => raw[k] !== undefined);
      if (!checks.length) say(at, 'A rule says what to check: every: with must: or must-not:, no-edge: { from, to }, or exists:');
      if (raw.every !== undefined && raw.must === undefined && raw['must-not'] === undefined) say([...at, 'every'], 'every: needs must: or must-not: (what each of them should have)');
      const selector = (v: unknown, path: Path, keys: string[]) => {
        if (!isObj(v)) return say(path, 'This is a selector: a map like { kind: sql-database } or { in: dmz }');
        for (const [k, x] of Object.entries(v)) {
          if (!keys.includes(k)) say([...path, k], `"${k}" is not something to select on: ${keys.join(', ')}`);
          else if (['not', 'edge-to', 'edge-from'].includes(k)) selector(x, [...path, k], SELECTOR_KEYS);
          else if (k === 'in' && typeof x !== 'string') selector(x, [...path, k], SELECTOR_KEYS);
          else if (k === 'any') (Array.isArray(x) ? x : [x]).forEach((s, j) => selector(s, [...path, k, j], SELECTOR_KEYS));
          else if (k === 'prop' && !isObj(x)) say([...path, k], 'prop: is a map of settings, e.g. { sku: premium }');
        }
      };
      for (const k of ['every', 'exists']) if (raw[k] !== undefined) selector(raw[k], [...at, k], SELECTOR_KEYS);
      for (const k of ['must', 'must-not']) if (raw[k] !== undefined) selector(raw[k], [...at, k], MUST_KEYS);
      if (raw['no-edge'] !== undefined) {
        const ne = raw['no-edge'];
        if (!isObj(ne) || !ne.from || !ne.to) say([...at, 'no-edge'], 'no-edge: needs from: and to:, each a selector');
        else {
          for (const k of Object.keys(ne)) if (!['from', 'to', 'style'].includes(k)) say([...at, 'no-edge', k], `"${k}" is not a no-edge key: from, to or style`);
          selector(ne.from, [...at, 'no-edge', 'from'], SELECTOR_KEYS);
          selector(ne.to, [...at, 'no-edge', 'to'], SELECTOR_KEYS);
        }
      }
      if (problems.length === before) {
        customIds.add(raw.id as string);
        into.custom.push(customRule(raw));
      }
    }
  }
  const ids = new Set([...known, ...into.custom.map((r) => r.id)]);
  if (data.rules !== undefined) {
    if (!isObj(data.rules)) say(['rules'], 'rules: is a map of rule id to off, info, warn or error');
    for (const [id, v] of Object.entries(isObj(data.rules) ? data.rules : {})) {
      if (!ids.has(id)) say(['rules', id], `There is no rule ${id}${nearest(id, ids) ? `: did you mean ${nearest(id, ids)}?` : ''}`, 'warning');
      const entry = into.rules[id] ?? { options: {} };
      if (typeof v === 'string') {
        if (!LEVELS.includes(v)) say(['rules', id], 'A rule is off, info, warn or error');
        else entry.severity = v as Level;
      } else if (isObj(v)) {
        for (const [k, x] of Object.entries(v)) {
          if (k === 'severity') {
            if (!LEVELS.includes(String(x))) say(['rules', id, k], 'severity is off, info, warn or error');
            else entry.severity = x as Level;
          } else if (typeof x === 'number') entry.options[k] = x;
          else say(['rules', id, k], `${k} is a number`);
        }
      } else say(['rules', id], 'A rule is off, info, warn or error, or { severity, options }');
      into.rules[id] = entry;
    }
  }
  if (data.ignore !== undefined) {
    if (!Array.isArray(data.ignore)) say(['ignore'], 'ignore: is a list of { rule, on, reason }');
    for (const [i, v] of (Array.isArray(data.ignore) ? data.ignore : []).entries()) {
      const e = typeof v === 'string' ? { rule: v } : isObj(v) && typeof v.rule === 'string' ? { rule: v.rule, ...(typeof v.on === 'string' ? { on: v.on } : {}), ...(typeof v.reason === 'string' ? { reason: v.reason } : {}) } : undefined;
      if (!e) say(['ignore', i], 'An ignore entry is a rule id, or { rule, on, reason }');
      else {
        if (!ids.has(e.rule)) say(['ignore', i], `There is no rule ${e.rule}${nearest(e.rule, ids) ? `: did you mean ${nearest(e.rule, ids)}?` : ''}`, 'warning');
        into.ignore.push(e);
      }
    }
  }
  return { config: into, problems };
}

/** The id meant by a typo, when one is close. */
export function nearest(word: string, among: Iterable<string>): string | undefined {
  let best: [string, number] | undefined;
  for (const c of among) {
    const d = distance(word, c);
    if (d <= Math.max(2, Math.floor(word.length / 5)) && (!best || d < best[1])) best = [c, d];
  }
  return best?.[0];
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return row[b.length]!;
}
