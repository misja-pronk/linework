#!/usr/bin/env node
// carto render | deck | watch | validate | diff | new | import | icons | themes | types
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { iconPng, interTtf, themeTtf, toPng } from './png.ts';
import { pages, toPdf, toPptx, type Drawing } from '@cartography/export';
import { fontScale, ttfFiles } from './fonts.ts';
import { configDir, importIcons, listPacks, readPack } from './packs.ts';
import { drift, findType, render, types, type RenderOptions, type RenderResult } from '@cartography/engine';
import { isThemeFile, resolveTheme, themeCatalog, themes, type Theme } from '@cartography/theme';
import { GIT_LOG_FORMAT, importDataMesh, importGitLog, importKubernetes, importMarkdown, importMermaid, importNetwork, importStructurizr, importTerraform, isDataMeshFile, isKubernetes, isNetworkInventory, isTerraform } from '@cartography/import';
import { execFileSync } from 'node:child_process';
import { compare, formatDiff, summary, type Comparison } from '@cartography/diff';
import { repoPath, repoRoot, versionAt } from '@cartography/diff/node';
import { matchTypes, packLayout, sameLayoutNote, viewPins, withViewPins, type Diagnostic, type DiagramType, type LayoutSidecar } from '@cartography/core';

const help = `carto — architecture diagrams that look good

  carto render <file.yaml…> [-o out] [--format svg|png|pptx|pdf] [--theme name|file.theme.yaml]
               [--pack azure] [--scale 2]           --theme wins over the diagram's theme:; -o x.pptx or x.pdf picks the format too
               [--view name | --all-views]      one of the diagram's views, or each to <file>-<view>.svg
               [--stable]                       note where things were drawn in <file>.layout.json, so the
                                                next render after an edit keeps them there
               [--step 3 | --all-steps]         the drawing at one of its steps:, or each to <file>-step-01.svg;
                                                pptx and pdf get a slide (page) per step by themselves
               [--focus orders] [--hops 2]      only that element (an id, a group, tag:x, kind:x) and what is within
               [--upstream | --downstream]      so many lines of it (default 1, or all); what feeds it, or what it feeds
  carto render <folder> [-o mesh.svg]           a folder of data product and data contract files (ODPS, ODCS) as one
               [--write mesh.yaml]              data mesh map; --write keeps the diagram, and updates it the next time
  carto deck <file.yaml…> -o deck.pptx|deck.pdf  all diagrams in one deck, a slide (page) each, one per step where a diagram has steps:
               [--all-steps | --no-steps]           also step through sequence messages and dynamic views; or never
               [--title "Deck title"] [--subtitle …] title slide in front (pptx)
               [--aspect 16:9|4:3] [--font Inter]   slide shape and typeface (pptx)
               [--page fit|a4|a3]                   page size (pdf, default fit)
  carto watch  <file.yaml…> [same options]      re-render on every save (and when included files change)
  carto embed <file.yaml|-> [-o out.html]       a web page that carries everything: the drawing, zoom and drill-down
               [--view name] [--theme name]         --static: the drawing alone, no script; --fragment: only the
               [--static] [--fragment] [--css]      figure, for a page of your own, and --css: the stylesheet with it
  carto validate <file.yaml…>                   check files and each of their views, print problems
               [--drift]                        also fail when <file>.layout.json pins, bends or locks things
                                                (or views) that are no longer in the diagram
               [--drift --fix]                  drop those entries from <file>.layout.json
  carto diff <before.yaml> <after.yaml>         what changed between two versions, by id: added, removed and
                                                changed nodes, groups and lines
  carto diff --git <ref> <file.yaml…>           the same against the file at a branch, tag or commit (includes too)
               [-o diff.svg|diff.png|folder]    also the picture: the newer drawing with what was added and
                                                changed marked, what was removed as ghosts where it was, and a key
               [--side-by-side]                 the picture as before and after, each with its own marks
               [--json] [--view name] [--fresh] [--exit-code]
                                                --fresh lays the newer drawing out from scratch instead of keeping
                                                what was there in place; --exit-code exits 1 when something changed
  carto new <type> [file.yaml]                  start from a template; no type: which to pick
  carto import <file.mmd|.md|.dsl|.yaml…> [-o out|-] [--force]
                                                Mermaid (flowchart, architecture-beta,
                                                erDiagram, sequenceDiagram, gitGraph, gantt, timeline, journey) to YAML;
                                                .md: every mermaid block; Kubernetes manifests: all files in one diagram;
                                                .csv inventory or NetBox JSON: a network diagram;
                                                terraform show -json (state or plan, AWS and Google Cloud): a cloud diagram;
                                                a folder (or files) of data products and contracts (ODPS, ODCS):
                                                one data mesh diagram, <folder>.yaml; again updates it, your edits stay
  carto import --git <repo> [--since 2026-01-01] [--branches main,develop] [--max 200] [-o out]
                                                a repository's history as a git branching diagram
  carto icons import <folder|file.zip> --pack azure
                                                index an official icon download (Azure, AWS,
                                                GCP) into a pack in ${configDir()}
  carto icons list                              packs and how many kinds each maps
  carto themes                                  built-in themes
  carto types [words…]                          which type to pick, best match first

Manual positions are read from <file>.layout.json next to the diagram (per view under "views").
The same file can hold a layout note ("layout") per view: render reads it and only --stable writes it,
so the same YAML and layout file always give the same picture. More: docs/ci.md`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o' },
    format: { type: 'string', short: 'f', default: 'svg' },
    theme: { type: 'string', short: 't' },
    pack: { type: 'string', multiple: true },
    scale: { type: 'string', default: '2' },
    'no-fonts': { type: 'boolean' },
    force: { type: 'boolean' },
    view: { type: 'string' },
    fragment: { type: 'boolean' },
    static: { type: 'boolean' },
    css: { type: 'boolean' },
    'all-views': { type: 'boolean' },
    stable: { type: 'boolean' },
    drift: { type: 'boolean' },
    json: { type: 'boolean' },
    'side-by-side': { type: 'boolean' },
    fresh: { type: 'boolean' },
    'exit-code': { type: 'boolean' },
    fix: { type: 'boolean' },
    step: { type: 'string' },
    'all-steps': { type: 'boolean' },
    'no-steps': { type: 'boolean' },
    focus: { type: 'string', multiple: true },
    hops: { type: 'string' },
    upstream: { type: 'boolean' },
    downstream: { type: 'boolean' },
    write: { type: 'string' },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    aspect: { type: 'string', default: '16:9' },
    font: { type: 'string' },
    page: { type: 'string', default: 'fit' },
    git: { type: 'string' },
    since: { type: 'string' },
    branches: { type: 'string' },
    max: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

const [command, ...files] = positionals;
const useColor = process.stderr.isTTY;
const red = (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s);
const yellow = (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s);
const dim = (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s);

function report(file: string, diagnostics: Diagnostic[]) {
  for (const d of diagnostics) {
    const where = d.line ? `${file}:${d.line}:${d.column}` : file;
    console.error(`${where}  ${d.severity === 'error' ? red('error') : yellow('warning')}  ${d.message}`);
  }
}

const sidecarPath = (file: string) => file.replace(/\.ya?ml$/, '') + '.layout.json';

function sidecarFor(file: string): LayoutSidecar | undefined {
  const p = sidecarPath(file);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')) as LayoutSidecar) : undefined;
}

/** Writes the sidecar the way the editor does; with nothing left in it the file goes. */
function writeSidecar(file: string, sidecar: LayoutSidecar | undefined) {
  const p = sidecarPath(file);
  if (sidecar) fs.writeFileSync(p, JSON.stringify(sidecar, null, 2) + '\n');
  else fs.rmSync(p, { force: true });
}

/**
 * --stable: the note of each drawn view (how it was laid out and where things are) goes into the
 * sidecar, so the next render after an edit keeps what was there in place. Only written when it changed.
 */
function noteLayout(file: string, results: RenderResult[]) {
  const before = sidecarFor(file);
  let sidecar = before;
  for (const r of results) {
    const note = packLayout(r.placed?.memory, true);
    if (!r.svg || !note) continue;
    const mine = viewPins(sidecar, r.view);
    if (sameLayoutNote(mine?.layout, note)) continue;
    sidecar = withViewPins(sidecar, r.view, { version: 1, ...mine, layout: note });
  }
  if (sidecar === before) return;
  writeSidecar(file, sidecar);
  console.log(`${file} → ${sidecarPath(file)} ${dim('layout noted')}`);
}

/** validate --drift: what the sidecar still refers to that the diagram no longer has. */
async function checkDrift(file: string): Promise<boolean> {
  const p = sidecarPath(file);
  if (!fs.existsSync(p)) return true;
  let sidecar: LayoutSidecar;
  try {
    sidecar = JSON.parse(fs.readFileSync(p, 'utf8')) as LayoutSidecar;
  } catch (e) {
    console.error(`${p}  ${red('error')}  not valid JSON: ${(e as Error).message}`);
    return false;
  }
  const r = await drift(fs.readFileSync(file, 'utf8'), sidecar, { load: loaderFor(file), file: path.basename(file), packs: values.pack, pack: readPack });
  if (r.error) return (console.error(`${p}  ${yellow('warning')}  ${r.error}`), true);
  if (!r.stale.length) return true;
  const fixing = !!values.fix;
  for (const s of r.stale) console.error(`${p}  ${fixing ? yellow('fixed') : red('stale')}  ${s.path}: ${s.message}`);
  const count = `${r.stale.length} stale entr${r.stale.length > 1 ? 'ies' : 'y'}`;
  if (!fixing) return (console.error(`${p}  ${count}; carto validate --drift --fix ${file} drops ${r.stale.length > 1 ? 'them' : 'it'}`), false);
  writeSidecar(file, r.fixed);
  console.log(r.fixed ? `${p} ${dim(`${count} dropped`)}` : `${p} ${dim(`${count} dropped, nothing left: file removed`)}`);
  return true;
}

function outputPath(file: string, format: string, view?: string, step?: number): string {
  // Steps are numbered with two digits so the files sort in the order they are told.
  const nn = step ? `-step-${String(step).padStart(2, '0')}` : '';
  const base = path.basename(file).replace(/\.ya?ml$/, '') + (view ? `-${view}` : '') + nn + '.' + format;
  if (!values.out) return path.join(path.dirname(file), base);
  if (files.length === 1 && !values['all-views'] && path.extname(values.out)) return (fs.mkdirSync(path.dirname(values.out), { recursive: true }), nn ? values.out.replace(/(\.\w+)$/, `${nn}$1`) : values.out);
  fs.mkdirSync(values.out, { recursive: true });
  return path.join(values.out, base);
}

/** Reads files a diagram refers to, relative to it, and remembers them so watch can follow them. */
const loaded = new Map<string, Set<string>>();
function loaderFor(file: string) {
  const set = loaded.get(file) ?? new Set<string>();
  loaded.set(file, set);
  return (rel: string) => {
    const p = path.resolve(path.dirname(file), rel);
    set.add(p);
    return fs.readFileSync(p, 'utf8');
  };
}

/** Binary files next to a diagram (fonts, PNG logos). */
const assetsFor = (file: string) => (rel: string) => {
  const p = path.resolve(path.dirname(file), rel);
  loaded.get(file)?.add(p);
  return fs.existsSync(p) ? new Uint8Array(fs.readFileSync(p)) : undefined;
};

/** --theme: a name, or a theme file relative to where carto runs; read once for all files. */
let forced: Theme | undefined;
function themeFlag(): boolean {
  if (!values.theme) return true;
  if (themes[values.theme]) return ((forced = themes[values.theme]), true);
  if (!isThemeFile(values.theme)) return (console.error(`Unknown theme "${values.theme}", use one of: ${Object.keys(themes).join(', ')}, or a .theme.yaml file`), false);
  const cwd = path.resolve(values.theme);
  const r = resolveTheme(path.basename(cwd), { load: loaderFor(cwd), assets: assetsFor(cwd) });
  for (const w of r.warnings) console.error(`${values.theme}  ${yellow('warning')}  ${w.path.length ? w.path.join('.') + ': ' : ''}${w.message}`);
  forced = r.theme;
  return true;
}

/** --focus orders --hops 2 --upstream, as the focus: of a diagram would say it; undefined without --focus. */
function focusFlag(): RenderOptions['focus'] {
  if (!values.focus?.length) return undefined;
  const hops = values.hops === 'all' ? 'all' : values.hops != null && Number(values.hops) >= 0 ? Math.floor(Number(values.hops)) : 1;
  return { on: values.focus, hops, direction: values.upstream && !values.downstream ? 'upstream' : values.downstream && !values.upstream ? 'downstream' : 'both' };
}

type Format = 'svg' | 'png' | 'pptx' | 'pdf';
const formats: Format[] = ['svg', 'png', 'pptx', 'pdf'];

/** -o deck.pptx says the format as clearly as --format pptx; the extension wins for one file. */
function formatFor(): Format {
  const ext = values.out && files.length === 1 ? path.extname(values.out).slice(1).toLowerCase() : '';
  return formats.find((f) => f === ext) ?? formats.find((f) => f === values.format) ?? 'svg';
}

function optionsFor(file: string, fonts: RenderOptions['fonts']): RenderOptions {
  return {
    themeOverride: forced,
    sidecar: sidecarFor(file),
    load: loaderFor(file),
    assets: assetsFor(file),
    fontScale,
    packs: values.pack,
    pack: readPack,
    fonts,
    file: path.basename(file),
    view: values.view,
    step: values.step ? Number(values.step) || 1 : undefined,
    focus: focusFlag(),
  };
}

/** --all-steps: also steps nobody wrote; --no-steps: one slide per drawing; else a slide per written step. */
const stepsFlag = () => (values['no-steps'] ? false : values['all-steps'] ? true : undefined);

async function draw(file: string, fonts: RenderOptions['fonts']) {
  const result = await render(fs.readFileSync(file, 'utf8'), optionsFor(file, fonts));
  report(file, result.diagnostics);
  return result;
}

/** Slides and PDF pages, from one or many drawings; a brand theme carries over. */
function document(format: 'pptx' | 'pdf', drawings: Drawing[], theme: RenderResult['theme']): Promise<Uint8Array> {
  const t = theme ?? (values.theme === 'dark' ? 'dark' : 'light');
  if (format === 'pptx')
    return toPptx(drawings, { theme: t, aspect: values.aspect === '4:3' ? '4:3' : '16:9', font: values.font, title: values.title, subtitle: values.subtitle, steps: stepsFlag(), rasterize: (svg, w) => iconPng(svg, w) });
  const page = values.page === 'a4' || values.page === 'a3' ? values.page : 'fit';
  return toPdf(drawings, { theme: t, page, fonts: interTtf(), families: themeTtf(typeof t === 'object' ? t : themes[t]), title: values.title, steps: stepsFlag() });
}

/** `text`: the diagram when it is not (or not yet) what the file holds; `shown`: what it is called in messages. */
async function renderFile(file: string, text = fs.readFileSync(file, 'utf8'), shown = file): Promise<boolean> {
  const format = formatFor();
  // resvg reads fonts from files; embedding them in the SVG only makes the PNG step slower.
  const opts = optionsFor(file, values['no-fonts'] || format !== 'svg' ? 'none' : 'embed');
  const first = await render(text, opts);
  // --all-views: the diagram as written (or its first view) plus every view as <file>-<view>.svg.
  const runs = values['all-views'] && first.views?.length ? [first, ...(await Promise.all(first.views.map((v) => render(text, { ...opts, view: v.name }))))] : [first];
  let ok = true;
  for (const [i, result] of runs.entries()) {
    const view = i ? result.view : values.view;
    report(view && i ? `${shown}#${view}` : shown, i && !values.view ? result.diagnostics.filter((d) => !first.diagnostics.some((f) => f.message === d.message)) : result.diagnostics);
    if (!result.svg) {
      ok = false;
      continue;
    }
    if ((values.step || (values['all-steps'] && !values['all-views'])) && !result.steps) console.error(`${shown}${view ? `#${view}` : ''}  ${yellow('warning')}  no steps here: drawn as a whole`);
    // --all-steps: an image per step, numbered; a pptx or pdf holds them all in one file.
    const each = values['all-steps'] && result.steps && (format === 'svg' || format === 'png');
    const shots = each ? await Promise.all(result.steps!.map((_, n) => render(text, { ...opts, view: view ?? opts.view, step: n + 1 }))) : [result];
    const faces = result.theme?.font.faces ?? [];
    for (const shot of shots) {
      if (!shot.svg) continue;
      const out = outputPath(file, format, view, each || values.step ? shot.step : undefined);
      const data =
        format === 'png' ? toPng(shot.svg, Number(values.scale) || 2, await ttfFiles(faces))
        : format === 'svg' ? shot.svg
        : await document(format, [{ ...shot, name: path.basename(file) }], shot.theme);
      fs.writeFileSync(out, data);
      console.log(`${shown}${view ? `#${view}` : ''}${shot.step ? ` step ${shot.step}` : ''} → ${out} ${dim(`${shot.width}×${shot.height}`)}`);
    }
    if (result.diagnostics.some((d) => d.severity === 'error')) ok = false;
  }
  if (values.stable) noteLayout(file, runs);
  return ok;
}

const isFolder = (f: string) => fs.existsSync(f) && fs.statSync(f).isDirectory();

/** Every YAML and JSON file under a folder, where data products and contracts are looked for; not hidden folders, node_modules or layout notes. */
function dataFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...dataFiles(p));
    else if (/\.(ya?ml|json)$/i.test(e.name) && !/\.layout\.json$/i.test(e.name)) out.push(p);
  }
  return out;
}

/** The diagram of a folder lives next to it, under its name: mesh/ → mesh.yaml. */
function besideFolder(folder: string): string {
  const clean = path.normalize(folder).replace(/[\\/]+$/, '');
  return (clean === '.' || path.basename(clean) === '..' ? path.resolve(folder) : clean) + '.yaml';
}

/**
 * Data product and data contract files (ODPS, ODCS), and folders of them → the data-products diagram
 * at `diagram`. What that file holds already stays where the data files say nothing about it ("merge");
 * "fresh" starts over, "if-mesh" only builds on it when it is such a diagram.
 */
function meshOf(inputs: string[], diagram: string, existing: 'merge' | 'if-mesh' | 'fresh'): { yaml: string; summary: string; clean: boolean } | undefined {
  const from = path.dirname(diagram);
  const list = inputs.flatMap((f) => (isFolder(f) ? dataFiles(f) : [f])).filter((f) => path.resolve(f) !== path.resolve(diagram));
  let was = existing !== 'fresh' && fs.existsSync(diagram) ? fs.readFileSync(diagram, 'utf8') : undefined;
  if (existing === 'if-mesh' && was && !/^type:\s*data-products\s*$/m.test(was)) was = undefined;
  // Contracts are read from where the diagram is, so that is how the files are named in it.
  const r = importDataMesh(list.map((f) => ({ path: path.relative(from, f).split(path.sep).join('/'), text: fs.readFileSync(f, 'utf8') })), { title: values.title, existing: was });
  for (const p of r.problems) {
    const where = p.file ? `${path.join(from, p.file)}${p.line ? `:${p.line}:${p.column}` : ''}` : r.products || !was ? inputs.join(', ') : diagram;
    console.error(`${where}  ${p.severity === 'error' ? red('error') : yellow('warning')}  ${p.message}`);
  }
  if (!r.yaml) return undefined;
  const count = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;
  // A file that could not be read is drawn around, and still fails the run.
  return { yaml: r.yaml, summary: `${count(r.products, 'data product')}, ${count(r.contracts, 'contract')}${was ? ', what was added by hand kept' : ''}`, clean: !r.problems.some((p) => p.severity === 'error') };
}

/** carto render <folder>: its data products and contracts as one map. --write keeps the diagram it is drawn from. */
async function renderMesh(folder: string): Promise<boolean> {
  const diagram = values.write ?? besideFolder(folder);
  const mesh = meshOf([folder], diagram, values.write ? 'merge' : 'if-mesh');
  if (!mesh) return false;
  if (!values.write) return (await renderFile(diagram, mesh.yaml, folder)) && mesh.clean;
  fs.mkdirSync(path.dirname(diagram), { recursive: true });
  fs.writeFileSync(diagram, mesh.yaml);
  console.log(`${folder} → ${diagram} ${dim(mesh.summary)}`);
  return (await renderFile(diagram)) && mesh.clean;
}

/** carto import <folder | data product and contract files>: one data-products diagram, updated when it is there already. */
async function importMesh(inputs: string[]): Promise<boolean> {
  const folder = inputs.length === 1 && isFolder(inputs[0]!) ? inputs[0]! : undefined;
  const stdout = values.out === '-';
  const out = values.out && !stdout ? (path.extname(values.out) ? values.out : path.join(values.out, 'data-mesh.yaml')) : folder && !stdout ? besideFolder(folder) : path.join(stdout ? '.' : path.dirname(inputs[0]!), 'data-mesh.yaml');
  const mesh = meshOf(inputs, out, stdout || values.force ? 'fresh' : 'merge');
  if (!mesh) return false;
  const where = inputs.length === 1 ? inputs[0]! : `${inputs.length} data product and contract files`;
  const check = await render(mesh.yaml, { fonts: 'none', load: loaderFor(out) });
  report(`${where} (imported)`, check.diagnostics);
  if (stdout) return (process.stdout.write(mesh.yaml), mesh.clean);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, mesh.yaml);
  console.log(`${where} → ${out} ${dim(mesh.summary)}`);
  return mesh.clean && !check.diagnostics.some((d) => d.severity === 'error');
}

/** carto diff: two files, or files against a git ref. Words (or JSON) on stdout, the picture with -o. */
async function diffFiles(): Promise<number> {
  const ref = values.git;
  if (ref ? !files.length : files.length !== 2) return (console.error(ref ? 'Name the diagrams: carto diff --git <ref> <file.yaml…>' : 'Two files: carto diff <before.yaml> <after.yaml>, or carto diff --git <ref> <file.yaml…>'), 1);
  const ext = values.out ? path.extname(values.out).slice(1).toLowerCase() : '';
  const format = ext === 'png' || ext === 'svg' ? ext : values.format === 'png' ? 'png' : 'svg';
  const fonts: RenderOptions['fonts'] = format === 'svg' && !values['no-fonts'] ? 'embed' : 'none';
  const disk = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : undefined);
  let root = '';
  if (ref) {
    try {
      root = repoRoot(process.cwd());
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root, stdio: 'ignore' });
    } catch {
      return (console.error(root ? `"${ref}" is not a commit, branch or tag here` : 'carto diff --git needs a git repository'), 1);
    }
  }
  const pairs = ref
    ? files.map((f) => {
        const old = versionAt(root, ref, repoPath(root, process.cwd(), f));
        return { name: f, against: ref, before: old.text, beforeOptions: { ...old.options, themeOverride: forced, fontScale, packs: values.pack, pack: readPack, fonts }, after: disk(f), afterFile: f };
      })
    : [{ name: files[1]!, against: path.basename(files[0]!), before: disk(files[0]!), beforeOptions: optionsFor(files[0]!, fonts), after: disk(files[1]!), afterFile: files[1]! }];

  let ok = true;
  let changed = false;
  const json: unknown[] = [];
  for (const p of pairs) {
    if (p.before === undefined && p.after === undefined) {
      console.error(`${p.name}  ${red('error')}  not found${ref ? `, here or in ${ref}` : ''}`);
      ok = false;
      continue;
    }
    let c: Comparison;
    try {
      c = await compare(p.before, p.after, { before: p.beforeOptions, after: optionsFor(p.afterFile, fonts), view: values.view, fresh: values.fresh });
    } catch (e) {
      console.error(`${p.name}  ${red('error')}  ${(e as Error).message}`);
      ok = false;
      continue;
    }
    report(p.name, c.diagnostics);
    if (c.failed) ok = false;
    if (!c.diff.same) changed = true;
    const state = p.before === undefined ? 'new' : p.after === undefined ? 'removed' : undefined;
    if (values.json) json.push({ file: p.name, ...(values.view ? { view: values.view } : {}), against: p.against, ...(state ? { state } : {}), summary: summary(c.diff), ...c.diff });
    else {
      console.log(`${bold(p.name)}${values.view ? `#${values.view}` : ''} ${dim(`against ${p.against}`)}: ${state ? `${state}, ` : ''}${summary(c.diff)}`);
      if (!c.diff.same) console.log(formatDiff(c.diff));
    }
    if (!values.out) continue;
    const overlay = { against: p.against, labels: { before: p.against, after: ref ? 'Working tree' : path.basename(p.name) } };
    const picture = values['side-by-side'] ? c.sideBySide(overlay) : c.picture(overlay);
    if (!picture) continue;
    const single = pairs.length === 1 && !!ext;
    const out = single ? values.out : path.join(values.out, path.basename(p.name).replace(/\.ya?ml$/, '') + (values.view ? `-${values.view}` : '') + `.diff.${format}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const faces = (c.after ?? c.before)?.theme?.font.faces ?? [];
    fs.writeFileSync(out, format === 'png' ? toPng(picture.svg, Number(values.scale) || 2, await ttfFiles(faces)) : picture.svg);
    console.error(`${p.name} → ${out} ${dim(`${picture.width}×${picture.height}`)}`);
  }
  if (values.json) console.log(JSON.stringify(ref ? json : json[0], null, 2));
  return !ok ? 1 : values['exit-code'] && changed ? 1 : 0;
}

/** Several diagrams, one file: a slide or page each, in the order given. */
async function deck(): Promise<boolean> {
  const format = values.out?.toLowerCase().endsWith('.pdf') ? 'pdf' : 'pptx';
  if (!values.out || !/\.(pptx|pdf)$/i.test(values.out)) {
    console.error('carto deck needs -o <file>.pptx or -o <file>.pdf');
    return false;
  }
  const drawings: Drawing[] = [];
  let theme: RenderResult['theme'];
  let ok = true;
  for (const f of files) {
    // A deck tells every step; --step is for one drawing.
    const r = { ...(await draw(f, 'none')), step: undefined };
    theme ??= r.theme;
    if (!r.graph || r.diagnostics.some((d) => d.severity === 'error')) ok = false;
    if (r.graph) drawings.push({ ...r, name: path.basename(f) });
  }
  if (!drawings.length) return false;
  fs.mkdirSync(path.dirname(values.out), { recursive: true });
  fs.writeFileSync(values.out, await document(format, drawings, theme));
  const count = pages(drawings, stepsFlag()).length;
  console.log(`${drawings.length} diagram${drawings.length > 1 ? 's' : ''}${count > drawings.length ? `, ${count} ${format === 'pdf' ? 'pages' : 'slides'}` : ''} → ${values.out}`);
  return ok;
}

/** Mermaid or Markdown → <name>.yaml (or <name>-<n>.yaml per block), checked by rendering it once. */
async function importFile(file: string): Promise<boolean> {
  const text = fs.readFileSync(file, 'utf8');
  const base = path.basename(file).replace(/\.(mmd|mermaid|md|markdown|dsl)$/i, '');
  // A Structurizr workspace becomes one C4 file: the model and all its views.
  const dsl = /\.dsl$/i.test(file);
  const blocks = dsl ? [{ ...importStructurizr(text, base), line: 0 }] : /\.(md|markdown)$/i.test(file) ? importMarkdown(text) : [{ ...importMermaid(text), line: 0 }];
  if (dsl && !blocks[0]!.yaml) console.error(`${file}  ${yellow('warning')}  no workspace model found`);
  if (!blocks.length) console.error(`${file}  ${yellow('warning')}  no \`\`\`mermaid blocks found`);
  let ok = blocks.length > 0;
  for (const [i, b] of blocks.entries()) {
    const where = b.line ? `${file}:${b.line}` : file;
    for (const w of b.warnings) console.error(`${where}  ${yellow('warning')}  ${w}`);
    if (!b.yaml) {
      ok = false;
      continue;
    }
    const check = await render(b.yaml, { fonts: 'none' });
    report(`${where} (imported)`, check.diagnostics);
    if (values.out === '-') {
      process.stdout.write((i ? '---\n' : '') + b.yaml);
      continue;
    }
    const name = blocks.length > 1 ? `${base}-${i + 1}.yaml` : `${base}.yaml`;
    const out = !values.out ? path.join(path.dirname(file), name) : files.length === 1 && blocks.length === 1 && path.extname(values.out) ? values.out : path.join(values.out, name);
    if (fs.existsSync(out) && !values.force) {
      console.error(`${out} already exists, use --force to overwrite`);
      ok = false;
      continue;
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, b.yaml);
    console.log(`${where} → ${out}`);
  }
  return ok;
}

/** A network inventory (CSV name,type,ip,zone,uplink or NetBox JSON) or Terraform's JSON → <name>.yaml next to it. */
async function importInventory(file: string, read = importNetwork): Promise<boolean> {
  const base = path.basename(file).replace(/\.(csv|json)$/i, '');
  const r = read(fs.readFileSync(file, 'utf8'), base);
  for (const w of r.warnings) console.error(`${file}  ${yellow('warning')}  ${w}`);
  if (!r.yaml) return false;
  const check = await render(r.yaml, { fonts: 'none' });
  report(`${file} (imported)`, check.diagnostics);
  if (values.out === '-') return (process.stdout.write(r.yaml), true);
  const out = values.out ? (path.extname(values.out) ? values.out : path.join(values.out, `${base}.yaml`)) : path.join(path.dirname(file), `${base}.yaml`);
  if (fs.existsSync(out) && !values.force) {
    console.error(`${out} already exists, use --force to overwrite`);
    return false;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, r.yaml);
  console.log(`${file} → ${out}`);
  return !check.diagnostics.some((d) => d.severity === 'error');
}

/** A repository's history: `git log` in a child process, read into a gitflow diagram. */
async function importGit(repo: string): Promise<boolean> {
  const branches = values.branches?.split(',').map((b) => b.trim()).filter(Boolean);
  const args = ['-C', repo, 'log', '--topo-order', '--reverse', `--format=${GIT_LOG_FORMAT}`, `--max-count=${Number(values.max) || 200}`];
  if (values.since) args.push(`--since=${values.since}`);
  args.push(...(branches?.length ? branches : ['--branches', '--tags']), '--');
  let text: string;
  try {
    text = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    console.error(`git log failed in ${repo}: ${String((e as { stderr?: string }).stderr ?? e).trim()}`);
    return false;
  }
  const name = path.basename(path.resolve(repo));
  const r = importGitLog(text, { title: `${name} history`, ...(branches?.length ? { branches } : {}) });
  for (const w of r.warnings) console.error(`${repo}  ${yellow('warning')}  ${w}`);
  if (!r.yaml) return false;
  const check = await render(r.yaml, { fonts: 'none' });
  report(`${repo} (imported)`, check.diagnostics);
  if (!values.out || values.out === '-') return (process.stdout.write(r.yaml), true);
  const out = path.extname(values.out) ? values.out : path.join(values.out, `${name}-history.yaml`);
  if (fs.existsSync(out) && !values.force) {
    console.error(`${out} already exists, use --force to overwrite`);
    return false;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, r.yaml);
  console.log(`${repo} → ${out}`);
  return !check.diagnostics.some((d) => d.severity === 'error');
}

/** Kubernetes manifests, all files merged into one diagram grouped by namespace. */
async function importManifests(list: string[]): Promise<boolean> {
  const base = list.length === 1 ? path.basename(list[0]!).replace(/\.(ya?ml|json)$/i, '') : 'kubernetes';
  const toFile = values.out && values.out !== '-' ? (path.extname(values.out) ? values.out : path.join(values.out, `${base}.yaml`)) : undefined;
  const title = path.basename(toFile ?? base).replace(/\.ya?ml$/i, '');
  const text = list.map((f) => fs.readFileSync(f, 'utf8')).join('\n---\n');
  const r = importKubernetes(text, title);
  const where = list.length === 1 ? list[0]! : `${list.length} manifest files`;
  for (const w of r.warnings) console.error(`${where}  ${yellow('warning')}  ${w}`);
  if (!r.yaml) return false;
  const check = await render(r.yaml, { fonts: 'none' });
  report(`${where} (imported)`, check.diagnostics);
  if (values.out === '-') return (process.stdout.write(r.yaml), true);
  const out = toFile ?? path.join(path.dirname(list[0]!), `${base}.diagram.yaml`);
  if (fs.existsSync(out) && !values.force) {
    console.error(`${out} already exists, use --force to overwrite`);
    return false;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, r.yaml);
  console.log(`${where} → ${out}`);
  return !check.diagnostics.some((d) => d.severity === 'error');
}

const bold = (s: string) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s);

/** What each type is for; with words, the best matches first and the rest left out. */
function typeGuide(query = '') {
  const ranked = matchTypes(query, types);
  const shown = query && ranked[0]!.score > 0 ? ranked.filter((r) => r.score > 0) : ranked;
  if (query && !ranked[0]!.score) console.log(dim(`Nothing matches "${query}"; architecture (systems) is the usual start.\n`));
  const name = (id: string) => findType(id)?.name ?? id;
  for (const { type: t } of shown) {
    console.log(`${bold(t.id.padEnd(14))} ${t.name}${t.tagline ? dim(' — ' + t.tagline) : ''}`);
    for (const u of t.useWhen ?? []) console.log(`${' '.repeat(15)}+ ${u}`);
    for (const n of t.notFor ?? []) console.log(dim(`${' '.repeat(15)}- not for: ${n.text}${n.use ? ` → ${n.use} (${name(n.use)})` : ''}`));
    console.log();
  }
  console.log(dim('Start one: carto new <type> [file.yaml]. Guide: docs/types.md'));
}

async function main(): Promise<number> {
  if (values.help || !command) {
    console.log(help);
    return command ? 0 : 1;
  }
  switch (command) {
    case 'types':
      typeGuide(files.join(' '));
      return 0;
    case 'themes':
      for (const t of themeCatalog) console.log(`${t.name.padEnd(14)} ${dim('— ' + t.description)}`);
      console.log(`${'light, dark'.padEnd(14)} ${dim('— other names for survey and survey-dark')}`);
      console.log(dim('Or a file: theme: ./client.theme.yaml (see docs/themes.md and docs/style.md)'));
      return 0;
    case 'icons': {
      const [sub, src] = files;
      if (sub === 'list') {
        const packs = listPacks();
        if (!packs.length) console.log(`No icon packs yet. Import one: carto icons import <folder|zip> --pack azure`);
        for (const p of packs) console.log(`${p.name.padEnd(12)} ${Object.keys(p.icons).length} kinds ${dim(`← ${p.source ?? '?'}  (${p.root})`)}`);
        return 0;
      }
      if (sub !== 'import' || !src) return (console.error(help), 1);
      const name = values.pack?.[0];
      if (!name) return (console.error('Name the pack: carto icons import <folder|zip> --pack azure'), 1);
      try {
        const r = importIcons(src, name);
        console.log(`${src} → ${r.dir}\n  ${r.files} SVG files, ${Object.keys(r.pack.icons).length} kinds mapped`);
        if (r.unmatched.length) console.log(dim(`  not matched (map by hand under icons: in a diagram, names in ${path.join(r.dir, 'index.json')}):\n  ${r.unmatched.join(', ')}`));
        console.log(dim(`  use it: carto render diagram.yaml --pack ${name}, or icons: { pack: ${name} } in the diagram`));
        return 0;
      } catch (e) {
        console.error(`${src}  ${red('error')}  ${(e as Error).message}`);
        return 1;
      }
    }
    case 'new': {
      const [id, target] = files;
      // Without a type, help picking one instead of an error.
      if (!id) return (typeGuide(), 0);
      const type = findType(id);
      if (!type) {
        console.error(`Unknown type "${id ?? ''}". Types: ${types.map((t) => t.id).join(', ')}`);
        return 1;
      }
      if (!target) {
        process.stdout.write(type.template);
        return 0;
      }
      if (fs.existsSync(target)) {
        console.error(`${target} already exists`);
        return 1;
      }
      fs.writeFileSync(target, type.template);
      console.log(`Created ${target}`);
      return 0;
    }
    case 'embed': {
      const { embed, embedCss } = await import('./embed.ts');
      if (values.css) return (process.stdout.write(embedCss()), 0);
      const [f] = files;
      if (!f) return (console.error(help), 1);
      const r = await embed(f, { view: values.view, theme: values.theme, title: values.title, fragment: values.fragment, static: values.static });
      report(f === '-' ? 'stdin' : f, r.problems);
      // A fragment, or a page made from standard input, goes to standard output unless -o says where.
      // With errors a fragment is still written: it is the message a reader of the page should see.
      const out = values.out ?? (values.fragment || f === '-' ? undefined : f.replace(/\.ya?ml$/i, '') + '.html');
      if (!out) process.stdout.write(r.html);
      else if (r.ok || values.fragment) fs.writeFileSync(out, r.html);
      if (out && r.ok) console.error(`${f} → ${out}`);
      return r.ok ? 0 : 1;
    }
    case 'validate': {
      let ok = true;
      for (const f of files) {
        const text = fs.readFileSync(f, 'utf8');
        const opts = { fonts: 'none' as const, load: loaderFor(f), file: path.basename(f) };
        const r = await render(text, { ...opts, view: values.view });
        // Without --view every view is checked too: what a view says about itself (complete: true for
        // an environment) is only known when that view is drawn. The same problem is printed once.
        const rest = values.view ? [] : await Promise.all((r.views ?? []).map((v) => render(text, { ...opts, view: v.name })));
        const seen = new Set<string>();
        const diagnostics = [r, ...rest].flatMap((x) => x.diagnostics).filter((d) => !seen.has(`${d.line}:${d.column}:${d.message}`) && !!seen.add(`${d.line}:${d.column}:${d.message}`));
        report(f, diagnostics);
        const drifted = values.drift && !(await checkDrift(f));
        if (diagnostics.some((d) => d.severity === 'error') || drifted) ok = false;
        else console.log(`${f} ${dim('ok')}`);
      }
      return ok ? 0 : 1;
    }
    case 'diff':
      if (!themeFlag()) return 1;
      return diffFiles();
    case 'import': {
      if (values.git) return (await importGit(values.git)) ? 0 : 1;
      if (!files.length) return (console.error(help), 1);
      // Data products and their contracts are one mesh, however many files and folders they are in.
      const mesh = files.filter((f) => isFolder(f) || (/\.(ya?ml|json)$/i.test(f) && isDataMeshFile(fs.readFileSync(f, 'utf8'))));
      // Manifests are read together: a platform is spread over many files, but it is one drawing.
      // terraform show -json, of a state or a saved plan: read from the file, never from the cloud.
      const plans = files.filter((f) => !mesh.includes(f) && /\.json$/i.test(f) && isTerraform(fs.readFileSync(f, 'utf8')));
      const manifests = files.filter((f) => !mesh.includes(f) && !plans.includes(f) && /\.(ya?ml|json)$/i.test(f) && isKubernetes(fs.readFileSync(f, 'utf8')));
      const inventories = files.filter((f) => !mesh.includes(f) && (/\.csv$/i.test(f) || (/\.json$/i.test(f) && !plans.includes(f) && !manifests.includes(f) && isNetworkInventory(fs.readFileSync(f, 'utf8')))));
      let ok = mesh.length ? await importMesh(mesh) : true;
      if (manifests.length) ok = (await importManifests(manifests)) && ok;
      for (const f of plans) ok = (await importInventory(f, importTerraform)) && ok;
      for (const f of inventories) ok = (await importInventory(f)) && ok;
      for (const f of files) if (!mesh.includes(f) && !plans.includes(f) && !manifests.includes(f) && !inventories.includes(f)) ok = (await importFile(f)) && ok;
      return ok ? 0 : 1;
    }
    case 'render': {
      if (!files.length) return (console.error(help), 1);
      if (!themeFlag()) return 1;
      let ok = true;
      if (values.write && !(files.length === 1 && isFolder(files[0]!))) return (console.error('--write keeps the diagram of one folder of data product files: carto render <folder> --write mesh.yaml'), 1);
      for (const f of files) ok = (await (isFolder(f) ? renderMesh(f) : renderFile(f))) && ok;
      return ok ? 0 : 1;
    }
    case 'deck':
      if (!files.length) return (console.error(help), 1);
      return (await deck()) ? 0 : 1;
    case 'watch': {
      if (!themeFlag()) return 1;
      for (const f of files) {
        let timer: NodeJS.Timeout | undefined;
        const followed = new Set<string>();
        const again = () => {
          clearTimeout(timer);
          timer = setTimeout(() => void renderFile(f).then(follow), 80);
        };
        // Contract files can be added while watching, so follow whatever the last render read.
        const follow = () => {
          for (const p of loaded.get(f) ?? [])
            if (!followed.has(p) && fs.existsSync(p)) {
              followed.add(p);
              fs.watch(p, again);
            }
        };
        await renderFile(f);
        follow();
        fs.watch(path.dirname(f), (_, name) => {
          if (name && f.endsWith(name.replace(/\.layout\.json$/, path.extname(f)))) again();
        });
      }
      console.log(dim('watching… Ctrl+C to stop'));
      return new Promise(() => {});
    }
    default:
      console.error(`Unknown command "${command}"\n\n${help}`);
      return 1;
  }
}

process.exitCode = await main();
