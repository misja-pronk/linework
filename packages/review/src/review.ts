// Runs the rules over a drawing: picks the packs for its type, applies the customer's and the file's
// severities, runs each check, sets aside what was ignored (with its reason), numbers the rest R1,
// R2… worst first, and places each finding on a line of the YAML.
import { parseSource, type Diagnostic, type Graph, type Path } from '@cartography/core';
import { readLang, type Lang } from '@cartography/i18n';
import { ReviewModel } from './model.ts';
import { emptyConfig, nearest, type IgnoreEntry, type Level, type ReviewConfig } from './config.ts';
import { categories, severityRank, type Finding, type Rule, type RuleInfo, type Severity, type Target } from './types.ts';
import { ruleIn, t } from './nl.ts';
import { azureRules } from './packs/azure.ts';
import { awsRules } from './packs/aws.ts';
import { kubernetesRules } from './packs/kubernetes.ts';
import { systemsRules } from './packs/systems.ts';
import { githubRules } from './packs/github.ts';
import { dataProductRules } from './packs/data-products.ts';

/** The built-in packs, in the order docs/review.md lists them. */
export const packs: { id: string; name: string; rules: Rule[] }[] = [
  { id: 'azure', name: 'Azure', rules: azureRules },
  { id: 'aws', name: 'AWS', rules: awsRules },
  { id: 'kubernetes', name: 'Kubernetes', rules: kubernetesRules },
  { id: 'systems', name: 'Systems and C4', rules: systemsRules },
  { id: 'github', name: 'GitHub', rules: githubRules },
  { id: 'data-products', name: 'Data products', rules: dataProductRules },
];
export const builtInRules: Rule[] = packs.flatMap((p) => p.rules);
export const builtInIds = new Set(builtInRules.map((r) => r.id));

/** A rule without its check: what lists and reports show. */
export const infoOf = ({ check: _check, options: _options, ...info }: Rule): RuleInfo => info;

export interface ReviewOptions {
  /** Only these packs (--pack), whatever the file and rules.yaml say. */
  packs?: string[];
  /** The customer's rules files, read and merged (see config.ts). */
  config?: ReviewConfig;
  /** Reads files the diagram refers to (data contracts). */
  load?: (file: string) => string;
  /** The language findings and rules are said in; by default the drawing's (what render() gave), else the file's `lang:`. */
  lang?: Lang;
}

export interface ReviewResult {
  /** Everything found: the ones set aside carry `ignored` and no number. */
  findings: Finding[];
  /** The rules that ran on this drawing. */
  rules: RuleInfo[];
  /** What the file's review: says that does not hold (an unknown rule id). */
  problems: Diagnostic[];
  /** The file says review: off. */
  off?: boolean;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** An ignore list as written: [id] or [{ rule, on?, reason? }]. */
function ignores(v: unknown): IgnoreEntry[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => (typeof x === 'string' ? [{ rule: x }] : isObj(x) && typeof x.rule === 'string' ? [{ rule: x.rule, ...(typeof x.on === 'string' ? { on: x.on } : {}), ...(typeof x.reason === 'string' ? { reason: x.reason } : {}) }] : []));
}

/** Whether an `on:` ("web", "web -> api") names this target. */
function names(on: string | undefined, t: Target, m: ReviewModel): boolean {
  if (on === undefined) return true;
  if (t.kind === 'diagram') return false;
  const arrow = /^\s*([\w.-]+)\s*(?:->|-->|\.\.>|<->|--)\s*([\w.-]+)\s*$/.exec(on);
  if (t.kind === 'edge') {
    const l = m.lines.find((x) => x.id === t.id);
    return !!l && (arrow ? l.from === arrow[1] && l.to === arrow[2] : on.trim() === t.id);
  }
  return !arrow && on.trim() === t.id;
}

/**
 * Reviews one drawing. `drawn` is what render() gave for it (graph, type, view); `text` the file's
 * YAML, for what it says about each element and where each finding is written.
 */
export function review(text: string, drawn: { graph?: Graph; type?: { id: string }; view?: string; lang?: Lang }, opts: ReviewOptions = {}): ReviewResult {
  const source = parseSource(text);
  const data = isObj(source.data) ? source.data : {};
  const problems: Diagnostic[] = [];
  const own = data.review;
  if (own === 'off') return { findings: [], rules: [], problems, off: true };
  if (!drawn.graph || !drawn.type) return { findings: [], rules: [], problems };
  const config = opts.config ?? emptyConfig();
  const file = isObj(own) ? own : {};
  const type = drawn.type.id;
  const lang = opts.lang ?? drawn.lang ?? readLang(data.lang) ?? 'en';

  const custom = config.custom;
  const ids = new Set([...builtInIds, ...custom.map((r) => r.id)]);
  const unknown = (path: Path, id: string) => {
    if (!ids.has(id)) problems.push(source.at(path, `There is no review rule ${id}${nearest(id, ids) ? `: did you mean ${nearest(id, ids)}?` : ''}`, 'warning'));
  };
  const fileLevels: Record<string, Level> = {};
  for (const [id, v] of Object.entries(isObj(file.rules) ? file.rules : {})) {
    unknown(['review', 'rules', id], id);
    if (typeof v === 'string') fileLevels[id] = v as Level;
  }
  const fileIgnores = ignores(file.ignore);
  for (const [i, e] of fileIgnores.entries()) unknown(['review', 'ignore', i], e.rule);

  const wanted = opts.packs ?? (Array.isArray(file.packs) ? (file.packs as string[]) : undefined) ?? config.packs;
  const pick = (r: Rule) => (r.appliesTo.includes(type) || r.appliesTo.includes('*')) && (!wanted || wanted.includes(r.pack) || (!builtInIds.has(r.id) && !opts.packs));
  const level = (r: Rule): Level => fileLevels[r.id] ?? config.rules[r.id]?.severity ?? r.severity;
  const rules = [...builtInRules, ...custom].filter(pick).filter((r) => level(r) !== 'off');

  const m = new ReviewModel({ graph: drawn.graph, data, type, load: opts.load, lang });
  const found: Finding[] = [];
  for (const rule of rules) {
    let hits;
    try {
      hits = rule.check(m, { ...rule.options, ...config.rules[rule.id]?.options });
    } catch (e) {
      problems.push({ severity: 'warning', message: t(lang, 'Review rule {id} could not run: {error}', { id: rule.id, error: e instanceof Error ? e.message : String(e) }) });
      continue;
    }
    for (const h of hits) {
      const on = h.on;
      const line = on.kind === 'edge' ? m.lines.find((l) => l.id === on.id) : undefined;
      const el = on.kind === 'diagram' ? undefined : (line ?? m.el(on.id));
      const path = h.path ?? el?.path ?? [];
      const at = source.locate(path);
      const about = on.kind === 'diagram' ? t(lang, 'the diagram') : line ? m.lineName(line) : m.name(on.id);
      // Set aside on the element or line itself, in the file's review:, or in rules.yaml.
      const inline = el ? ignores(isObj(el.props.review) ? el.props.review.ignore : undefined).find((x) => x.rule === rule.id) : undefined;
      const inFile = fileIgnores.find((x) => x.rule === rule.id && names(x.on, h.on, m));
      const inConfig = config.ignore.find((x) => x.rule === rule.id && names(x.on, h.on, m));
      const ignored = inline ? { where: 'element' as const, reason: inline.reason } : inFile ? { where: 'file' as const, reason: inFile.reason } : inConfig ? { where: 'config' as const, reason: inConfig.reason } : undefined;
      found.push({
        id: '',
        rule: ruleIn(lang, infoOf(rule)),
        severity: level(rule) as Severity,
        message: h.message,
        on: h.on,
        ...(line ? { ends: { from: line.from, to: line.to } } : {}),
        about,
        path,
        ...(at ? { line: at.line, column: at.column } : {}),
        ...(drawn.view ? { view: drawn.view } : {}),
        ...(ignored ? { ignored: { where: ignored.where, ...(ignored.reason ? { reason: ignored.reason } : {}) } } : {}),
      });
    }
  }
  // Inline ignores name rules too.
  for (const el of [...m.nodes.values(), ...m.groups.values(), ...m.lines]) for (const [i, e] of ignores(isObj(el.props.review) ? el.props.review.ignore : undefined).entries()) unknown([...el.path, 'review', 'ignore', i], e.rule);
  return { findings: numbered(found), rules: rules.map((r) => ruleIn(lang, infoOf(r))), problems };
}

/** Worst first, then by pillar, then in the order of the file; R1, R2… for those not set aside. */
export function numbered(found: Finding[]): Finding[] {
  const sorted = [...found].sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || categories.indexOf(a.rule.category) - categories.indexOf(b.rule.category) || (a.line ?? 0) - (b.line ?? 0));
  let n = 0;
  return sorted.map((f) => ({ ...f, id: f.ignored ? '' : `R${++n}` }));
}

/** The findings that count (not set aside) at or above a severity: what --fail-on fails on. */
export function failing(findings: Finding[], at: Severity): Finding[] {
  return findings.filter((f) => !f.ignored && severityRank[f.severity] >= severityRank[at]);
}

/** Counts per severity of the findings that count. */
export function tally(findings: Finding[]): Record<Severity, number> {
  const out: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const f of findings) if (!f.ignored) out[f.severity]++;
  return out;
}
