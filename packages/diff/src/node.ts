// Versions of a diagram from disk and from git, with everything they refer to read from the same
// place: a diagram at a commit includes the model file of that commit, not today's.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { LayoutSidecar } from '@cartography/core';
import type { RenderOptions } from '@cartography/engine';

/** Runs git and returns what it printed; throws with git's own message when it fails. */
export function git(args: string[], cwd: string, input?: string | Uint8Array): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...(input !== undefined ? { input } : {}) });
}

/** The top of the work tree `cwd` is in. */
export function repoRoot(cwd: string): string {
  return git(['rev-parse', '--show-toplevel'], cwd).trim();
}

/** A path as git names it: from the top of the repository, with forward slashes. */
export function repoPath(root: string, cwd: string, file: string): string {
  return path.relative(fs.realpathSync(root), path.resolve(fs.realpathSync(cwd), file)).split(path.sep).join('/');
}

/** A file as it was at a ref; undefined when it was not there. `file` is a repository path. */
export function fileAt(root: string, ref: string, file: string): Buffer | undefined {
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return undefined;
  }
}

export interface Version {
  /** The diagram's text; undefined when the file does not exist in this version. */
  text: string | undefined;
  /** What render needs to read the rest of this version: includes, contracts, fonts, pins. */
  options: RenderOptions;
  /** Every file the diagram read while it was drawn, as repository paths (filled in by rendering). */
  read: Set<string>;
}

const sidecarOf = (file: string) => file.replace(/\.ya?ml$/, '') + '.layout.json';
const parse = (text: string | undefined): LayoutSidecar | undefined => {
  try {
    return text === undefined ? undefined : (JSON.parse(text) as LayoutSidecar);
  } catch {
    return undefined;
  }
};
const join = (file: string, rel: string) => path.posix.normalize(path.posix.join(path.posix.dirname(file), rel.split(path.sep).join('/')));

/** A diagram as it was at a ref (a branch, a tag, a commit). `file` is a repository path. */
export function versionAt(root: string, ref: string, file: string): Version {
  const read = new Set<string>();
  const sidecar = parse(fileAt(root, ref, sidecarOf(file))?.toString('utf8'));
  return {
    text: fileAt(root, ref, file)?.toString('utf8'),
    read,
    options: {
      file: path.posix.basename(file),
      ...(sidecar ? { sidecar } : {}),
      load: (rel) => {
        const p = join(file, rel);
        read.add(p);
        const data = fileAt(root, ref, p);
        if (!data) throw new Error(`${p} is not in ${ref}`);
        return data.toString('utf8');
      },
      assets: (rel) => {
        const p = join(file, rel);
        read.add(p);
        const data = fileAt(root, ref, p);
        return data ? new Uint8Array(data) : undefined;
      },
    },
  };
}

/** A diagram as it is in the work tree. `file` is a repository path. */
export function versionOnDisk(root: string, file: string): Version {
  const read = new Set<string>();
  const abs = (p: string) => path.join(root, p);
  const text = (p: string) => (fs.existsSync(abs(p)) ? fs.readFileSync(abs(p), 'utf8') : undefined);
  const sidecar = parse(text(sidecarOf(file)));
  return {
    text: text(file),
    read,
    options: {
      file: path.posix.basename(file),
      ...(sidecar ? { sidecar } : {}),
      load: (rel) => {
        const p = join(file, rel);
        read.add(p);
        return fs.readFileSync(abs(p), 'utf8');
      },
      assets: (rel) => {
        const p = join(file, rel);
        read.add(p);
        return fs.existsSync(abs(p)) ? new Uint8Array(fs.readFileSync(abs(p))) : undefined;
      },
    },
  };
}

export interface ChangedFile {
  /** Repository path. */
  path: string;
  status: 'added' | 'removed' | 'changed';
}

/** Files that differ between a ref and the work tree (or another ref). Renames count as a removal and an addition. */
export function changedFiles(root: string, base: string, head?: string): ChangedFile[] {
  const out = git(['diff', '--name-status', '--no-renames', '-z', base, ...(head ? [head] : []), '--'], root);
  const parts = out.split('\0').filter(Boolean);
  const files: ChangedFile[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) files.push({ path: parts[i + 1]!, status: parts[i] === 'A' ? 'added' : parts[i] === 'D' ? 'removed' : 'changed' });
  // New files that are not staged yet are a change too (a local run; in CI everything is committed).
  if (!head) for (const p of git(['ls-files', '--others', '--exclude-standard', '-z'], root).split('\0').filter(Boolean)) files.push({ path: p, status: 'added' });
  return files;
}
