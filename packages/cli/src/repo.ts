// A code repository on disk, for carto import <repo> and carto render <repo>: its text files read once
// (not node_modules, build output or hidden folders other than .github), and the diagrams scanRepo
// makes of them.
import fs from 'node:fs';
import path from 'node:path';
import { isRepo, scanRepo, type RepoFile, type RepoScan } from '@cartography/import';

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', '.next', '.cache', '.venv', 'venv', '__pycache__', 'coverage']);
const TEXT = /\.(ya?ml|json|bicep|bicepparam|tpl|tf|txt)$|(^|\/)(Dockerfile|[\w.-]+\.Dockerfile|Dockerfile\.[\w.-]+)$/i;
const MAX_FILES = 5000;
const MAX_BYTES = 2_000_000;

/** The repository's text files, by path relative to it. */
export function readRepo(dir: string): RepoFile[] {
  const out: RepoFile[] = [];
  const walk = (d: string, depth: number) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_FILES) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (depth < 12 && !SKIP.has(e.name) && (!e.name.startsWith('.') || e.name === '.github')) walk(p, depth + 1);
      } else if (e.isFile() && TEXT.test(e.name) && !/\.layout\.json$/i.test(e.name) && fs.statSync(p).size <= MAX_BYTES) {
        out.push({ path: path.relative(dir, p).split(path.sep).join('/'), text: fs.readFileSync(p, 'utf8') });
      }
    }
  };
  walk(dir, 0);
  return out;
}

/** Whether a folder is a code repository this draws: a .git, or a Compose file, chart, Bicep, API description or workflow. */
export function looksLikeRepo(dir: string): boolean {
  return isRepo(readRepo(dir));
}

/** The diagrams of a repository; over what the diagrams folder holds unless `fresh`. */
export function repoDiagrams(dir: string, opts: { out?: string; values?: string; fresh?: boolean }): RepoScan {
  const files = readRepo(dir);
  const name = path.basename(path.resolve(dir));
  return scanRepo(files, {
    out: opts.out,
    name,
    values: opts.values,
    existing: opts.fresh ? undefined : (file) => (fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), 'utf8') : undefined),
  });
}
