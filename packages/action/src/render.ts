// On push: every diagram drawn to SVG or PNG, next to its source or in one folder, and (when asked)
// committed back, so the pictures in the repository are never older than the YAML.
import fs from 'node:fs';
import path from 'node:path';
import { pictureName, type Diagnostic } from '@cartography/core';
import { ttfFiles } from '@cartography/cli/fonts';
import { toPng } from '@cartography/cli/png';
import { git, versionOnDisk } from '@cartography/diff/node';
import { render, type RenderResult } from '@cartography/engine';
import { diagrams } from './plan.ts';

export type Format = 'svg' | 'png';

export interface RenderAllOptions {
  files?: string[];
  formats?: Format[];
  /** A folder (repository path) for the pictures, keeping each diagram's own folders under it; without it they go next to the diagram. */
  output?: string;
  /** Also every view, as <name>--<view>.svg. */
  views?: boolean;
  scale?: number;
}

export interface Rendered {
  /** Repository paths of the pictures written, also the ones that came out the same as before. */
  written: string[];
  /** Diagrams with problems: errors mean no (or an incomplete) picture. */
  reports: { file: string; view?: string; diagnostics: Diagnostic[] }[];
  failed: boolean;
}

export async function renderAll(root: string, opts: RenderAllOptions = {}): Promise<Rendered> {
  const formats = opts.formats?.length ? opts.formats : (['svg'] as Format[]);
  const out: Rendered = { written: [], reports: [], failed: false };
  for (const file of diagrams(root, opts.files)) {
    const v = versionOnDisk(root, file);
    for (const format of formats) {
      // resvg reads fonts from files; an SVG carries its own.
      const options = { ...v.options, fonts: format === 'svg' ? ('embed' as const) : ('none' as const) };
      const first = await render(v.text!, options);
      const runs: RenderResult[] = [first];
      if (opts.views && first.views?.length) for (const view of first.views) runs.push(await render(v.text!, { ...options, view: view.name }));
      for (const [i, r] of runs.entries()) {
        const view = i ? r.view : undefined;
        if (format === formats[0] && r.diagnostics.length) out.reports.push({ file, ...(view ? { view } : {}), diagnostics: i ? r.diagnostics.filter((d) => !first.diagnostics.some((f) => f.message === d.message)) : r.diagnostics });
        if (r.diagnostics.some((d) => d.severity === 'error')) out.failed = true;
        if (!r.svg) continue;
        const name = `${pictureName(file.replace(/\.ya?ml$/, ''), view)}.${format}`;
        const target = opts.output ? path.posix.join(opts.output, name) : name;
        fs.mkdirSync(path.dirname(path.join(root, target)), { recursive: true });
        fs.writeFileSync(path.join(root, target), format === 'png' ? toPng(r.svg, opts.scale ?? 2, await ttfFiles(r.theme?.font.faces ?? [])) : r.svg);
        out.written.push(target);
      }
    }
  }
  out.reports = out.reports.filter((r) => r.diagnostics.length);
  return out;
}

export interface CommitOptions {
  message?: string;
  remote?: string;
  /** The branch to push to; without it the commit stays local. */
  branch?: string;
}

/** Commits exactly `paths` (nothing else that may be staged) when they differ, and pushes. Returns the commit, or undefined when all pictures were up to date. */
export function commitPictures(root: string, paths: string[], opts: CommitOptions = {}): string | undefined {
  if (!paths.length) return undefined;
  git(['add', '--', ...paths], root);
  try {
    git(['diff', '--cached', '--quiet', '--', ...paths], root);
    return undefined;
  } catch {
    // differs: commit
  }
  const who = ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', '-c', 'commit.gpgsign=false'];
  git([...who, 'commit', '--quiet', '-m', opts.message ?? 'Render diagrams [skip ci]', '--', ...paths], root);
  const commit = git(['rev-parse', 'HEAD'], root).trim();
  if (opts.branch) git(['push', '--quiet', opts.remote ?? 'origin', `HEAD:refs/heads/${opts.branch}`], root);
  return commit;
}
