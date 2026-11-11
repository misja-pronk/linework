// What the engine knows about a diagram besides the drawing, for an assistant to read: the diagram in
// words, the review's findings, the threat model, what changed between two versions, and the routes
// a request takes. Each is what the CLI's command of the same name says, as data.
import path from 'node:path';
import { threatMarkdown } from '@cartography/core';
import { describe as describeDrawing, toMarkdown } from '@cartography/describe';
import { compare, explain, summary as diffSummary } from '@cartography/diff';
import { repoPath, repoRoot, versionAt } from '@cartography/diff/node';
import { render, type RenderOptions } from '@cartography/engine';
import { review } from '@cartography/review';
import { traceable, traceAsk } from '@cartography/trace';
import { drawnOptions, load, problems, reader, resolvePath, type Drawn, type Input, type Problem } from './tools.ts';

const errorsIn = (ds: { severity: string }[]) => ds.some((d) => d.severity === 'error');

async function drawn(input: Input & Drawn, cwd: string, extra: RenderOptions = {}) {
  const src = load(input, cwd);
  const r = await render(src.text, { fonts: 'none', load: reader(src.dir), sidecar: src.sidecar, file: input.file ? path.basename(input.file) : undefined, ...drawnOptions(input), ...extra });
  return { src, r, problems: problems(r.diagnostics, src.text, r.type) };
}

export async function describeDiagram(input: Input & Drawn, cwd = process.cwd()): Promise<{ ok: boolean; text?: string; problems: Problem[] }> {
  const { r, problems } = await drawn(input, cwd);
  if (!r.graph || errorsIn(r.diagnostics)) return { ok: false, problems };
  return { ok: true, text: toMarkdown(describeDrawing({ ...r, name: input.file ? path.basename(input.file) : undefined })), problems };
}

export interface Reviewed {
  ok: boolean;
  problems: Problem[];
  off?: boolean;
  rules?: string[];
  findings?: { id: string; rule: string; severity: string; message: string; about: string; line?: number; fix?: string }[];
}

export async function reviewDiagram(input: Input & Drawn & { packs?: string[] }, cwd = process.cwd()): Promise<Reviewed> {
  const { src, r, problems } = await drawn(input, cwd);
  if (!r.graph || errorsIn(r.diagnostics)) return { ok: false, problems };
  const out = review(src.text, r, { packs: input.packs, load: reader(src.dir) });
  return {
    ok: true,
    problems: [...problems, ...out.problems.map((p) => ({ severity: p.severity, message: p.message, ...(p.line ? { line: p.line, column: p.column } : {}) }))],
    ...(out.off ? { off: true } : {}),
    rules: out.rules.map((x) => x.id),
    findings: out.findings
      .filter((f) => !f.ignored)
      .map((f) => ({ id: f.id, rule: f.rule.id, severity: f.severity, message: f.message, about: f.about, ...(f.line ? { line: f.line } : {}), ...(f.rule.fix ? { fix: f.rule.fix } : {}) })),
  };
}

export async function threatsOf(input: Input & { view?: string }, cwd = process.cwd()): Promise<{ ok: boolean; markdown?: string; count?: number; problems: Problem[] }> {
  const { r, problems } = await drawn(input, cwd);
  if (!r.graph || errorsIn(r.diagnostics)) return { ok: false, problems };
  if (!r.graph.threats) return { ok: true, problems, markdown: 'No threat model here: add trust: to a group, or threats: to an element or line (docs/threats.md).', count: 0 };
  return { ok: true, markdown: threatMarkdown(r.graph), count: r.graph.threats.length, problems };
}

export interface DiffRequest {
  /** The newer version (a file). */
  file: string;
  /** The older version: another file… */
  before?: string;
  /** …or the same file at a git commit, branch or tag. */
  ref?: string;
  view?: string;
}

export async function diffDiagrams(req: DiffRequest, cwd = process.cwd()) {
  if (!req.before === !req.ref) throw new Error('Pass "before" (another file) or "ref" (a git commit, branch or tag), one of the two');
  const after = load({ file: req.file }, cwd);
  const afterOptions: RenderOptions = { load: reader(after.dir), sidecar: after.sidecar };
  let before: string | undefined;
  let beforeOptions: RenderOptions;
  let against: string;
  if (req.before) {
    const b = load({ file: req.before }, cwd);
    [before, beforeOptions, against] = [b.text, { load: reader(b.dir), sidecar: b.sidecar }, req.before];
  } else {
    const file = resolvePath(req.file, cwd);
    let root: string;
    try {
      root = repoRoot(path.dirname(file));
    } catch {
      throw new Error(`${req.file} is not in a git repository, so there is no "${req.ref}" to compare with`);
    }
    const v = versionAt(root, req.ref!, repoPath(root, path.dirname(file), path.basename(file)));
    [before, beforeOptions, against] = [v.text, v.options, req.ref!];
  }
  const c = await compare(before, after.text, { before: beforeOptions, after: afterOptions, view: req.view });
  return {
    ok: !c.failed,
    against,
    ...(before === undefined ? { state: 'new' } : {}),
    summary: diffSummary(c.diff),
    explained: explain(c.diff, c.before?.graph, c.after?.graph).map((x) => x.text),
    counts: c.diff.counts,
    problems: problems(c.diagnostics, after.text, c.after?.type),
  };
}

export interface TraceRequest extends Input {
  from?: string;
  to?: string;
  steps?: boolean;
  view?: string;
}

export async function traceDiagram(req: TraceRequest, cwd = process.cwd()) {
  const src = load(req, cwd);
  const t = await traceable(src.text, { load: reader(src.dir), file: req.file ? path.basename(req.file) : undefined, view: req.view });
  const errors = t.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) return { ok: false, problems: problems(errors, src.text, undefined) };
  const r = traceAsk(t, { from: req.from, to: req.to, steps: req.steps, limit: 5 });
  if (r.error) return { ok: false, error: r.error, problems: [] };
  return { ok: true, mode: r.mode, ...(r.from ? { from: r.from } : {}), ...(r.to ? { to: r.to } : {}), routes: r.options.map((o) => ({ summary: o.summary, elements: o.ids, ...(o.notes.length ? { notes: o.notes } : {}) })) };
}
