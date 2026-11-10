// A wizard is data and one pure function: questions (with defaults, some asked only after certain
// answers) and `build`, which turns the answers into YAML. No AI, no I/O: the same answers give the
// same file, so the editor can redraw on every keypress and the CLI and tests share it.

export type Answer = string | number | boolean | string[];
export type Answers = Record<string, Answer>;

export interface Option {
  value: string;
  label: string;
  /** One line under the option: what it means, when to pick it. */
  help?: string;
}

interface Base {
  id: string;
  /** The question, as a sentence. */
  label: string;
  help?: string;
  /** Asked only when this holds for the answers so far. */
  when?: (a: Answers) => boolean;
}

export type Question =
  | (Base & { kind: 'choice'; options: Option[]; default: string })
  | (Base & { kind: 'multi'; options: Option[]; default: string[] })
  | (Base & { kind: 'number'; min: number; max: number; default: number; unit?: string })
  | (Base & { kind: 'yesno'; default: boolean })
  /** `list`: names separated by commas, read as a list. */
  | (Base & { kind: 'text'; default: string; placeholder?: string; list?: boolean });

export interface Wizard {
  id: string;
  name: string;
  /** The diagram type it writes (for a wizard that can write several, the first). */
  type: string;
  /** Every type it is offered under in the start dialog. */
  types?: string[];
  /** One line: what it draws. */
  description: string;
  /** The vendor's or author's reference it follows, named in the YAML too. */
  source: string;
  questions: Question[];
  build(a: Answers): string;
}

/** Comma-separated names, trimmed, without empties and doubles. */
export function names(v: Answer | undefined): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  const seen = new Set<string>();
  return list.map((s) => String(s).trim()).filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
}

/** An answer read as the question wants it: from JSON, the terminal or the dialog, all the same. */
export function coerce(q: Question, v: unknown): Answer | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  switch (q.kind) {
    case 'choice': {
      const s = String(v).trim().toLowerCase();
      const o = q.options.find((x) => x.value.toLowerCase() === s || x.label.toLowerCase() === s) ?? (/^\d+$/.test(s) ? q.options[Number(s) - 1] : undefined);
      return o?.value;
    }
    case 'multi': {
      const list = Array.isArray(v) ? v.map(String) : String(v).split(',');
      const picked = list.map((s) => coerce({ ...q, kind: 'choice', default: '' }, s)).filter((x): x is string => typeof x === 'string');
      // In the order of the options, so the YAML does not depend on the order of clicks.
      return q.options.map((o) => o.value).filter((o) => picked.includes(o));
    }
    case 'number': {
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      return Number.isFinite(n) ? Math.min(q.max, Math.max(q.min, Math.round(n))) : undefined;
    }
    case 'yesno': {
      if (typeof v === 'boolean') return v;
      const s = String(v).trim().toLowerCase();
      return ['y', 'yes', 'true', '1', 'on', 'ja'].includes(s) ? true : ['n', 'no', 'false', '0', 'off', 'nee'].includes(s) ? false : undefined;
    }
    case 'text':
      return q.list ? names(v as Answer).join(', ') : String(v).trim();
  }
}

/** The questions asked for these answers, in order: each `when` sees the answers before it. */
export function asked(w: Wizard, partial: Answers = {}): Question[] {
  const a = resolve(w, partial);
  return w.questions.filter((q) => q.id in a);
}

/** Every question answered: what was given (read as the question wants it), else its default. Questions not asked are left out. */
export function resolve(w: Wizard, partial: Answers = {}): Answers {
  const out: Answers = {};
  for (const q of w.questions) {
    if (q.when && !q.when(out)) continue;
    out[q.id] = coerce(q, partial[q.id]) ?? q.default;
  }
  return out;
}

/** The YAML for some answers; what is not answered takes its default. */
export function run(w: Wizard, partial: Answers = {}): string {
  return w.build(resolve(w, partial));
}

/** Values worth trying per question: every option, both ends and the default of a number, a few subsets of a multi. */
function samples(q: Question): Answer[] {
  switch (q.kind) {
    case 'choice':
      return q.options.map((o) => o.value);
    case 'yesno':
      return [true, false];
    case 'number':
      return [...new Set([q.min, q.default, q.max])];
    case 'multi': {
      const all = q.options.map((o) => o.value);
      return [q.default, [], all, ...all.map((o) => [o])].filter((s, i, list) => list.findIndex((t) => t.join() === s.join()) === i);
    }
    case 'text':
      return [q.default];
  }
}

/**
 * Answer sets that cover the wizard: every combination when there are at most `limit`, else the
 * defaults with one answer changed at a time plus a fixed sample of the rest (the same each run).
 */
export function combinations(w: Wizard, limit = 200): Answers[] {
  const out: Answers[] = [];
  const seen = new Set<string>();
  const add = (a: Answers) => {
    const r = resolve(w, a);
    const key = JSON.stringify(r);
    if (!seen.has(key)) seen.add(key), out.push(r);
  };
  let total = 1;
  for (const q of w.questions) total *= samples(q).length;
  if (total <= limit) {
    const walk = (i: number, a: Answers) => {
      if (i === w.questions.length) return add(a);
      for (const v of samples(w.questions[i]!)) walk(i + 1, { ...a, [w.questions[i]!.id]: v });
    };
    walk(0, {});
    return out;
  }
  add({});
  for (const q of w.questions) for (const v of samples(q)) add({ [q.id]: v });
  // A small deterministic generator: the sample is the same on every run and machine.
  let seed = 7;
  const next = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
  for (let n = 0; out.length < limit && n < limit * 4; n++) {
    const a: Answers = {};
    for (const q of w.questions) {
      const s = samples(q);
      a[q.id] = s[Math.floor(next() * s.length)]!;
    }
    add(a);
  }
  return out;
}
