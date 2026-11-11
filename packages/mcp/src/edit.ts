// edit_diagram: small edits by YAML path, checked, applied, drawn, and only then written. The rest of
// the file keeps its bytes (comments too), and an id that is renamed takes its pins along.
import fs from 'node:fs';
import { applyOperations, checkOperations, parseSource, renamePinsEverywhere, type Operation } from '@cartography/core';
import { findType, render } from '@cartography/engine';
import { load, problems, quality, reader, resolvePath, type Checked, type Input } from './tools.ts';

export interface EditRequest extends Input {
  edits: unknown;
  /** Check and draw, but write nothing. */
  dryRun?: boolean;
}

export interface Edited extends Checked {
  /** The file written, when one was. */
  written?: string;
  /** The pins file rewritten for renamed ids. */
  pins?: string;
  /** Ids renamed, old → new. */
  renames?: Record<string, string>;
  /** The new YAML: always for yaml input, for a file only with dryRun. */
  yaml?: string;
  /** Why the edits could not be applied (nothing is written). */
  error?: string;
}

/** The edits as a change: the new text and the ids renamed, or why not. */
export function applyEdits(text: string, edits: unknown): { text: string; renames: Map<string, string> } | { error: string } {
  const ops = checkOperations(edits);
  if ('error' in ops) return ops;
  const id = (parseSource(text).data as { type?: unknown } | undefined)?.type;
  const type = typeof id === 'string' ? findType(id) : undefined;
  if (!type) return { error: `The diagram has no known "type:"${typeof id === 'string' ? ` ("${id}")` : ''}; edits need one.` };
  const r = applyOperations(text, type, ops as Operation[]);
  if ('error' in r) return r;
  if (r.text === text) return { error: 'These edits leave the diagram exactly as it is.' };
  return r;
}

export async function editDiagram(req: EditRequest, cwd = process.cwd()): Promise<Edited> {
  const src = load(req, cwd);
  const applied = applyEdits(src.text, req.edits);
  if ('error' in applied) return { ok: false, problems: [], error: applied.error };
  const sidecar = src.sidecar && applied.renames.size ? renamePinsEverywhere(src.sidecar, applied.renames) : src.sidecar;
  const r = await render(applied.text, { fonts: 'none', load: reader(src.dir), sidecar });
  const ok = !!r.svg && !r.diagnostics.some((d) => d.severity === 'error');
  const renames = applied.renames.size ? { renames: Object.fromEntries(applied.renames) } : {};
  const base = { ok, type: r.type?.id, problems: problems(r.diagnostics, applied.text, r.type), ...renames };
  // A change that does not draw is not written: the model gets the problems and tries again.
  if (!ok) return { ...base, yaml: applied.text };
  const q = await quality(r, applied.text, { dir: src.dir, sidecar });
  const out = { ...base, ...(q ? { quality: q } : {}) };
  if (!req.file || req.dryRun) return { ...out, yaml: applied.text };
  const file = resolvePath(req.file, cwd);
  fs.writeFileSync(file, applied.text);
  if (sidecar !== src.sidecar) {
    const side = file.replace(/\.ya?ml$/, '') + '.layout.json';
    fs.writeFileSync(side, `${JSON.stringify(sidecar, null, 2)}\n`);
    return { ...out, written: file, pins: side };
  }
  return { ...out, written: file };
}
