// What the engine knows about a diagram besides the drawing, for an assistant to read: the diagram in
// words, and what changed between two versions. Each is what the CLI's command of the same name says.
import path from 'node:path';
import { describe as describeDrawing, toMarkdown } from '@linework/describe';
import { compare, explain, summary as diffSummary } from '@linework/diff';
import { repoPath, repoRoot, versionAt } from '@linework/diff/node';
import { render, type RenderOptions } from '@linework/engine';
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
