// What a run of the CLI reads and writes: the terminal (Io, so tests can run commands in-process),
// the files a diagram refers to, its layout sidecar, and where pictures go.
import fs from 'node:fs';
import path from 'node:path';
import { parseSidecar, pictureName, type Diagnostic, type LayoutSidecar } from '@cartography/core';
import { t, type Lang } from './i18n.ts';

/** The terminal of a run: process.stdout and friends for the real CLI, buffers in tests. */
export interface Io {
  stdout: { write(data: string | Uint8Array): unknown; isTTY?: boolean };
  stderr: { write(data: string): unknown; isTTY?: boolean };
  /** Standard input, read whole (carto render -). */
  stdin(): string;
  env: NodeJS.ProcessEnv;
}

export const processIo: Io = {
  stdout: process.stdout,
  stderr: process.stderr,
  stdin: () => fs.readFileSync(0, 'utf8'),
  env: process.env,
};

/** A mistake in how carto was called: said in one line, without a stack. */
export class UsageError extends Error {}

/** One run of the CLI: its terminal, and the files each diagram read (so watch can follow them). */
export class Ctx {
  /** Files a diagram refers to, by diagram, as the last render read them. */
  readonly loaded = new Map<string, Set<string>>();
  readonly io: Io;
  /** A line on standard output, as console.log. */
  readonly log: (line?: string) => void;
  /** A line on standard error, as console.error. */
  readonly error: (line?: string) => void;
  /** Bytes or text on standard output, as they are. */
  readonly write: (data: string | Uint8Array) => void;
  // Colours only for a terminal: red, yellow and dim when standard error is one, bold for standard output.
  readonly red: (s: string) => string;
  readonly yellow: (s: string) => string;
  readonly dim: (s: string) => string;
  readonly bold: (s: string) => string;

  /** The language asked for on purpose (--lang or CARTO_LANG): the drawing's, for a diagram without lang:. */
  readonly lang: Lang | undefined;

  constructor(io: Io, lang?: Lang) {
    this.io = io;
    this.lang = lang;
    this.log = (line = '') => void io.stdout.write(line + '\n');
    this.error = (line = '') => void io.stderr.write(line + '\n');
    this.write = (data) => void io.stdout.write(data);
    const paint = (code: number, tty: boolean | undefined) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
    this.red = paint(31, io.stderr.isTTY);
    this.yellow = paint(33, io.stderr.isTTY);
    this.dim = paint(2, io.stderr.isTTY);
    this.bold = paint(1, io.stdout.isTTY);
  }

  /** Writes a file, or standard output for `-`. */
  put(out: string, data: string | Uint8Array) {
    if (out === '-') this.write(data);
    else fs.writeFileSync(out, data);
  }

  /** A diagram's problems, file:line:column first. */
  report(file: string, diagnostics: Diagnostic[]) {
    for (const d of diagnostics) {
      const where = d.line ? `${file}:${d.line}:${d.column}` : file;
      this.error(`${where}  ${d.severity === 'error' ? this.red(t('error')) : this.yellow(t('warning'))}  ${d.message}`);
    }
  }

  /** Reads files a diagram refers to, relative to it, and remembers them so watch can follow them. */
  loaderFor(file: string) {
    const set = this.loaded.get(file) ?? new Set<string>();
    this.loaded.set(file, set);
    return (rel: string) => {
      const p = path.resolve(path.dirname(file), rel);
      set.add(p);
      return fs.readFileSync(p, 'utf8');
    };
  }

  /** Binary files next to a diagram (fonts, PNG logos). */
  assetsFor(file: string) {
    return (rel: string) => {
      const p = path.resolve(path.dirname(file), rel);
      this.loaded.get(file)?.add(p);
      return fs.existsSync(p) ? new Uint8Array(fs.readFileSync(p)) : undefined;
    };
  }

  /** The sidecar next to a diagram: an entry that cannot be read is said and left out; JSON that cannot be read stops, naming the file. */
  sidecarFor(file: string): LayoutSidecar | undefined {
    const p = sidecarPath(file);
    if (!fs.existsSync(p)) return undefined;
    let json: unknown;
    try {
      json = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      throw new Error(`${p}: ${t('not valid JSON: {message}', { message: (e as Error).message })}`);
    }
    const r = parseSidecar(json);
    for (const w of r.warnings) this.error(`${p}  ${this.yellow(t('warning'))}  ${w}`);
    return r.sidecar;
  }
}

export const sidecarPath = (file: string) => file.replace(/\.ya?ml$/, '') + '.layout.json';

/** Writes the sidecar the way the editor does; with nothing left in it the file goes. */
export function writeSidecar(file: string, sidecar: LayoutSidecar | undefined) {
  const p = sidecarPath(file);
  if (sidecar) fs.writeFileSync(p, JSON.stringify(sidecar, null, 2) + '\n');
  else fs.rmSync(p, { force: true });
}

/**
 * Where a picture goes: next to the diagram, or under -o. `count` is how many diagrams the command
 * was given (a file name for several pictures is a mistake, not a folder named x.png).
 */
export function outputPath(o: { out?: string; 'all-views'?: boolean; 'all-layers'?: boolean }, count: number, file: string, format: string, view?: string, step?: number): string {
  // Steps are numbered with two digits so the files sort in the order they are told.
  const nn = step ? `-step-${String(step).padStart(2, '0')}` : '';
  const base = pictureName(path.basename(file).replace(/\.ya?ml$/, ''), view) + nn + '.' + format;
  if (!o.out) return path.join(path.dirname(file), base);
  // -o is a folder when it ends in / or has no extension.
  const folder = o.out.endsWith('/') || o.out.endsWith(path.sep) || !path.extname(o.out);
  // A deck holds every view and every layer on a slide of its own: one file.
  const deck = format === 'pptx' || format === 'pdf';
  const perView = o['all-views'] && !deck;
  const perLayer = o['all-layers'] && !deck;
  if (!folder && (count > 1 || perView || perLayer))
    throw new UsageError(t('-o {out} names one file, but {why}: give a folder, e.g. -o {folder}/', { out: o.out, why: perView ? t('--all-views writes one per view') : perLayer ? t('--all-layers writes one per layer') : t('several diagrams make several files'), folder: path.join(path.dirname(o.out), path.basename(o.out, path.extname(o.out))) }));
  if (!folder) return (fs.mkdirSync(path.dirname(o.out), { recursive: true }), nn ? o.out.replace(/(\.\w+)$/, `${nn}$1`) : o.out);
  fs.mkdirSync(o.out, { recursive: true });
  return path.join(o.out, base);
}

export const isFolder = (f: string) => fs.existsSync(f) && fs.statSync(f).isDirectory();

/** Every YAML and JSON file under a folder, where data products and contracts are looked for; not hidden folders, node_modules or layout notes. */
export function dataFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...dataFiles(p));
    else if (/\.(ya?ml|json)$/i.test(e.name) && !/\.layout\.json$/i.test(e.name)) out.push(p);
  }
  return out;
}

/** What went wrong, in one line: a file that is not there, a folder where a file was meant, … */
export function friendly(e: unknown): string {
  const err = e as NodeJS.ErrnoException;
  const near = err.path ? path.relative(process.cwd(), err.path) : undefined;
  const where = err.path ? (near && !near.startsWith('..') ? near : err.path) : undefined;
  if (err.code === 'ENOENT') return t('{file}: no such file or folder', { file: where ?? t('file') });
  if (err.code === 'EISDIR') return t('{file} is a folder; give a file', { file: where ?? t('that') });
  if (err.code === 'ENOTDIR') return t('{file}: a file is in the way where a folder is needed', { file: where ?? t('that') });
  if (err.code === 'EEXIST') return t('{file}: a file is in the way where a folder is needed (-o names a folder when it has no extension)', { file: where ?? t('that') });
  if (err.code === 'EACCES' || err.code === 'EPERM') return t('{file}: not allowed to read or write it', { file: where ?? t('file') });
  return err.message ?? String(e);
}
