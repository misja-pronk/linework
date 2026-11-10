// carto decisions: the architecture decisions of a folder (decisions/0001-….md, adr-tools' doc/adr,
// log4brains' docs/adr) as a decision log, or drawn as the Decisions table; `new` writes the next one.
// carto render --decisions draws their markers on a diagram. What a decision is in core decisions.ts.
import fs from 'node:fs';
import path from 'node:path';
import {
  decisionByNumber,
  decisionFileName,
  decisionLog,
  decisionTable,
  decisionTemplate,
  decisionsDir,
  decisionStatuses,
  indexWorkspace,
  nextDecisionNumber,
  readConcern,
  setDecisionStatus,
  type Decision,
  type DecisionStatus,
  type WorkspaceIndex,
} from '@cartography/core';
import { decisionLines, renderGraph, themes, withDecisions, type RenderOptions, type RenderResult } from '@cartography/engine';
import { t } from './i18n.ts';

const KNOWN = ['decisions', 'docs/decisions', 'docs/adr', 'doc/adr', 'adr', 'docs/architecture/decisions', 'architecture/decisions', 'doc/architecture/decisions'];
const SKIP = new Set(['node_modules', 'dist', '.git']);
const hasMarkdown = (d: string) => fs.existsSync(d) && fs.statSync(d).isDirectory() && fs.readdirSync(d).some((f) => f.endsWith('.md'));

/** A folder that is itself a decisions folder: numbered Markdown files and no diagrams. */
const isDecisionsFolder = (d: string) => {
  const names = fs.readdirSync(d);
  return names.some((f) => /^\d+[-_].*\.md$/i.test(f)) && !names.some((f) => /\.ya?ml$/i.test(f));
};

/**
 * The workspace root a file or folder belongs to, as far as decisions go: up from it to the first
 * folder with a `.adr-dir`, a `.log4brains.yml` or a decisions folder (not past a git root).
 */
export function decisionsRoot(start: string): string {
  let d = path.resolve(fs.existsSync(start) && fs.statSync(start).isDirectory() ? start : path.dirname(start));
  if (isDecisionsFolder(d)) return path.dirname(d);
  const first = d;
  for (;;) {
    if (['.adr-dir', '.log4brains.yml'].some((f) => fs.existsSync(path.join(d, f))) || KNOWN.some((k) => hasMarkdown(path.join(d, k)))) return d;
    if (fs.existsSync(path.join(d, '.git')) || path.dirname(d) === d) return first;
    d = path.dirname(d);
  }
}

/** Diagrams, decisions and the files that say where decisions live, relative to the root. */
export function workspaceFiles(root: string): [string, string][] {
  const out: [string, string][] = [];
  for (const f of ['.adr-dir', '.log4brains.yml']) if (fs.existsSync(path.join(root, f))) out.push([f, fs.readFileSync(path.join(root, f), 'utf8')]);
  const walk = (dir: string, depth: number) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) depth < 6 && walk(p, depth + 1);
      else if (/\.(ya?ml|md)$/i.test(e.name)) out.push([path.relative(root, p).split(path.sep).join('/'), fs.readFileSync(p, 'utf8')]);
    }
  };
  walk(root, 0);
  return out;
}

const cache = new Map<string, WorkspaceIndex>();
/** The index of a root, read once per run. */
export function workspaceAt(root: string): WorkspaceIndex {
  if (!cache.has(root)) cache.set(root, indexWorkspace(workspaceFiles(root)));
  return cache.get(root)!;
}

/** How a concern reads in a log: an element's label with its id, a line by its ends' labels. */
export function describer(ix: WorkspaceIndex): (concern: string) => string {
  const name = (id: string) => ix.elements.get(id)?.[0]?.label ?? id;
  return (s) => {
    const c = readConcern(s);
    if (!c) return s;
    if (c.kind === 'edge') return `${name(c.from)} → ${name(c.to)}`;
    if (c.kind === 'view') return `view ${ix.views.find((v) => v.name === c.view && (!c.file || v.file === c.file))?.title ?? s}`;
    return ix.elements.has(c.id) ? `${name(c.id)} (${c.id})` : c.id;
  };
}

/** What a drawing of `file` needs to place decision markers: the decisions, and how model ids are drawn there. */
export function decisionsFor(file: string): { decisions: Decision[]; rel: string; ix: WorkspaceIndex } {
  const root = decisionsRoot(file);
  const ix = workspaceAt(root);
  return { decisions: ix.decisions, rel: path.relative(root, path.resolve(file)).split(path.sep).join('/'), ix };
}

type Drawn = { svg: string; width: number; height: number; origin?: { x: number; y: number } };

/** A drawing with its decision markers and, under it, the decisions it shows (pptx: in the speaker notes). */
export function withDecisionMarks<T extends RenderResult & { annotate?(d: Drawn & { origin: { x: number; y: number } }): { svg: string; width: number; height: number } }>(r: T, file: string): T & { decisions?: string[] } {
  if (!r.graph || !r.placed || !r.svg || !r.width || !r.height) return r;
  const { decisions, rel, ix } = decisionsFor(file);
  if (!decisions.length) return r;
  const { graph, placed } = r;
  const theme = r.theme ?? themes.light;
  const shows = ix.shows.get(r.view ? `${rel}#${r.view}` : rel);
  const at = { file: rel, view: r.view, drawnAs: (id: string) => shows?.get(id) };
  const before = r.annotate;
  const decorate = (d: Drawn & { origin: { x: number; y: number } }) => {
    const inner = before ? { ...d, ...before(d) } : d;
    return withDecisions(inner, graph, placed, decisions, theme, at);
  };
  const marked = withDecisions({ svg: r.svg, width: r.width, height: r.height, origin: r.origin }, graph, placed, decisions, theme, at);
  if (!marked.count) return r;
  return { ...r, svg: marked.svg, width: marked.width, height: marked.height, decisions: decisionLines(marked.spots), annotate: decorate };
}

export interface DecisionsArgs {
  args: string[];
  out?: string;
  concerns?: string;
  supersedes?: string;
  into?: string;
  title?: string;
  status?: string;
  render: RenderOptions;
  /** Writes a drawing in the format of `out` (svg, png, pptx, pdf), as carto render does. */
  write(r: RenderResult, out: string): Promise<void>;
}

/** carto decisions <folder> [-o log.md|table.svg]; carto decisions new "title" [--concerns a,b] [--supersedes 3] [--into folder]. */
export async function decisionsCommand(a: DecisionsArgs): Promise<number> {
  const [first, ...rest] = a.args;
  if (first === 'new') {
    const title = rest.join(' ').trim();
    if (!title) return (console.error(t('carto decisions new "title": the decision needs a title')), 1);
    if (a.status && !decisionStatuses.includes(a.status as DecisionStatus)) return (console.error(t('--status is one of {list}, not "{value}"', { list: decisionStatuses.join(', '), value: a.status })), 1);
    const root = decisionsRoot(a.into ?? '.');
    const files = workspaceFiles(root);
    const ix = indexWorkspace(files);
    const dir = a.into && isDecisionsFolder(path.resolve(a.into)) ? path.relative(root, path.resolve(a.into)).split(path.sep).join('/') : decisionsDir(files);
    const number = nextDecisionNumber(ix.decisions);
    const file = `${dir}/${decisionFileName(number, title)}`;
    const concerns = (a.concerns ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const old = a.supersedes ? decisionByNumber(ix.decisions, Number(a.supersedes)) : undefined;
    if (a.supersedes && !old) return (console.error(t('carto decisions new: there is no decision {n} in {folder}', { n: a.supersedes, folder: path.join(root, dir) })), 1);
    for (const c of concerns) {
      const parsed = readConcern(c);
      const ids = parsed?.kind === 'element' ? [parsed.id] : parsed?.kind === 'edge' ? [parsed.from, parsed.to] : [];
      for (const id of ids) if (ix.elements.size && !ix.elements.has(id)) console.error(`${file}  ${t('warning')}  ${t('concerns "{id}", which is not in {folder}', { id, folder: root === process.cwd() ? t('this folder') : root })}`);
    }
    const text = decisionTemplate({ number, title, concerns: concerns.length ? concerns : (old?.concerns ?? []), file, ...(old ? { supersedes: old } : {}), ...(a.status ? { status: a.status as DecisionStatus } : {}) });
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
    if (old) {
      fs.writeFileSync(path.join(root, old.file), setDecisionStatus(old.text, old.file, 'superseded', { number, title, file }));
      console.error(`${path.join(root, old.file)} → ${t('superseded by {n}', { n: number })}`);
    }
    console.log(path.join(root, file));
    return 0;
  }
  const folder = first ?? '.';
  if (!fs.existsSync(folder)) return (console.error(t('{file}: no such folder', { file: folder })), 1);
  const root = decisionsRoot(folder);
  const ix = workspaceAt(root);
  const describe = describer(ix);
  for (const p of ix.problems.filter((x) => ix.decisions.some((d) => d.file === x.file))) console.error(`${path.join(root, p.file)}${p.line ? `:${p.line}` : ''}  ${t('warning')}  ${p.message}`);
  const out = a.out;
  const ext = out && out !== '-' ? path.extname(out).slice(1).toLowerCase() : 'md';
  if (ext === 'md' || ext === '') {
    // Links in the log are relative to where it is written.
    const at = out && out !== '-' ? path.relative(path.dirname(path.resolve(out)), root).split(path.sep).join('/') : path.relative(process.cwd(), root).split(path.sep).join('/');
    const md = decisionLog(
      ix.decisions.map((d) => ({ ...d, file: at ? `${at}/${d.file}` : d.file })),
      { title: a.title, describe, dir: '' },
    );
    if (!out || out === '-') process.stdout.write(md);
    else {
      fs.writeFileSync(out, md);
      console.error(`${path.join(root, ix.decisionsDir)} → ${out}  ${t('{count} decision|{count} decisions', { count: ix.decisions.length })}`);
    }
    return 0;
  }
  const r = await renderGraph(decisionTable(ix.decisions, { title: a.title ?? 'Decisions', describe }), a.render);
  await a.write(r, out!);
  console.log(`${path.join(root, ix.decisionsDir)} → ${out} ${r.width}×${r.height}`);
  return 0;
}
