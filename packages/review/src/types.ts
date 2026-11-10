// The words of the architecture review: a rule (data plus a small check), what it finds, and the
// Well-Architected pillars findings are sorted under.
import type { Path } from '@cartography/core';
import type { ReviewModel } from './model.ts';

export type Severity = 'info' | 'warn' | 'error';
export const severities: Severity[] = ['error', 'warn', 'info'];
export const severityRank: Record<Severity, number> = { info: 1, warn: 2, error: 3 };
export const severityLabel: Record<Severity, string> = { error: 'Error', warn: 'Warning', info: 'Info' };

/** The pillars of the Azure and AWS Well-Architected frameworks that a drawing can say something about. */
export type Category = 'security' | 'reliability' | 'operations' | 'cost' | 'performance';
export const categories: Category[] = ['security', 'reliability', 'operations', 'performance', 'cost'];
export const categoryLabel: Record<Category, string> = {
  security: 'Security',
  reliability: 'Reliability',
  operations: 'Operational excellence',
  performance: 'Performance efficiency',
  cost: 'Cost optimisation',
};

/** What a rule is, as listed in docs/review.md and the Review tab. */
export interface RuleInfo {
  /** pack.name, e.g. azure.public-without-waf: what `ignore:` and rules.yaml name. */
  id: string;
  /** The pack it belongs to: azure, aws, kubernetes, systems, github, data-products, or the customer's. */
  pack: string;
  /** What should hold, as a reviewer says it: "Public endpoints sit behind a WAF". */
  title: string;
  /** One line: why it matters. */
  why: string;
  severity: Severity;
  category: Category;
  /** Diagram types it reads (azure, cloud, …); a model file is reviewed as the type it draws as. */
  appliesTo: string[];
  /** What to do about it, and how to say so in the YAML. */
  fix: string;
  /** Where to read more, as text: "Azure WAF: Front Door or Application Gateway WAF_v2". */
  docs?: string;
}

/** Where a finding points: an element, a group, a line, or the diagram as a whole. */
export type Target = { kind: 'node' | 'group' | 'edge'; id: string } | { kind: 'diagram' };

/** One thing a check found, before it is numbered and placed. */
export interface Hit {
  on: Target;
  /** What was found here, in a sentence: "Orders API is reached from Users without a WAF". */
  message: string;
  /** The YAML it is about; by default the element's or line's own. */
  path?: Path;
}

export interface Rule extends RuleInfo {
  /** Options a customer may set in rules.yaml (max-chain: 5), with their defaults. */
  options?: Record<string, number>;
  check(m: ReviewModel, options: Record<string, number>): Hit[];
}

export interface Finding {
  /** R1, R2… in the order of the report: errors first, then warnings, then info. */
  id: string;
  rule: RuleInfo;
  /** The severity after rules.yaml and the file have had their say. */
  severity: Severity;
  message: string;
  on: Target;
  /** A line's two ends by id, so `on: a -> b` can name it. */
  ends?: { from: string; to: string };
  /** What it is about, as drawn: "Orders API", "Web → API", "the diagram". */
  about: string;
  path: Path;
  line?: number;
  column?: number;
  /** The drawing it was found in: a view's name, or none for the diagram as written. */
  view?: string;
  /** Set aside, and where: on the element, in the file's review:, or in rules.yaml. */
  ignored?: { where: 'element' | 'file' | 'config'; reason?: string };
}
