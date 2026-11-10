#!/usr/bin/env node
// carto render | deck | watch | validate | diff | new | import | export | threats | share | icons | themes | types
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { iconPng, interTtf, themeTtf, toPng } from './png.ts';
import { pages, toPdf, toPptx, type Drawing } from '@cartography/export';
import { fontScale, ttfFiles } from './fonts.ts';
import { configDir, importIcons, listPacks, readPack } from './packs.ts';
import { drift, findType, render, types, type RenderOptions, type RenderResult } from '@cartography/engine';
import { isThemeFile, resolveTheme, themeCatalog, themes, type Theme } from '@cartography/theme';
import { importDrawio, importExcalidraw, isDrawio, isExcalidraw, mermaidBlock, toDrawio, toExcalidraw, toMermaid, toSafeSvg, toScene, type ImportedDiagram, type Scene } from '@cartography/interop';
import { GIT_LOG_FORMAT, importAccess, importAzure, isAzureContainers, isAzureExport, importDataMesh, importGithub, isAccessExport, isGithubExport, type GithubOptions, type ImportedExport, importGitLog, importKubernetes, importNetwork, importText, importStructurizr, importTerraform, isDataMeshFile, isKubernetes, isNetworkInventory, isTerraform } from '@cartography/import';
import { execFileSync } from 'node:child_process';
import { compare, formatDiff, summary, type Comparison } from '@cartography/diff';
import { accessChanges, type AccessChange, type AccessSource } from '@cartography/access';
import { accessOf } from '@cartography/github';
import { parse as parseYaml, stringify as yamlText } from 'yaml';
import { repoPath, repoRoot, versionAt } from '@cartography/diff/node';
import { threatMarkdown } from '@cartography/core';
import { matchTypes, packLayout, sameLayoutNote, viewPins, withViewPins, type Diagnostic, type DiagramType, type LayoutSidecar } from '@cartography/core';

const help = `carto — architecture diagrams that look good

  carto render <file.yaml…> [-o out] [--format svg|png|pptx|pdf] [--theme name|file.theme.yaml]
               [--pack azure] [--scale 2]           --theme wins over the diagram's theme:; -o x.pptx or x.pdf picks the format too
               [--view name | --all-views]      one of the diagram's views, or each to <file>-<view>.svg
               [--stable]                       note where things were drawn in <file>.layout.json, so the
                                                next render after an edit keeps them there
               [--step 3 | --all-steps]         the drawing at one of its steps:, or each to <file>-step-01.svg;
                                                pptx and pdf get a slide (page) per step by themselves
               [--svg-safe]                     an SVG that PowerPoint, Word and Keynote take whole: no CSS, no
                                                filters or markers, system fonts, one group per node and line
               [--outline-text]                 with --svg-safe: text as outlines in the theme's own font
               [--focus orders] [--hops 2]      only that element (an id, a group, tag:x, kind:x) and what is within
               [--upstream | --downstream]      so many lines of it (default 1, or all); what feeds it, or what it feeds
  carto render <folder> [-o mesh.svg]           a folder of data product and data contract files (ODPS, ODCS) as one
               [--write mesh.yaml]              data mesh map; --write keeps the diagram, and updates it the next time
  carto render <folder> [-o access.svg]         a folder of saved az / Graph / AzureHound JSON as who reaches what,
                                                or of gh api responses as the GitHub organisation (same options as
                                                carto import <folder> below; --write access.yaml keeps the diagram)
  carto render <folder|export.json> [-o x.png]  Azure resources (az graph query, az bicep build, terraform show -json)
                                                as an azure diagram, with the options of carto import below
  carto deck <file.yaml…> -o deck.pptx|deck.pdf  all diagrams in one deck, a slide (page) each, one per step where a diagram has steps:
               [--all-steps | --no-steps]           also step through sequence messages and dynamic views; or never
               [--title "Deck title"] [--subtitle …] title slide in front (pptx)
               [--aspect 16:9|4:3] [--font Inter]   slide shape and typeface (pptx)
               [--page fit|a4|a3]                   page size (pdf, default fit)
  carto watch  <file.yaml…> [same options]      re-render on every save (and when included files change)
  carto embed <file.yaml|-> [-o out.html]       a web page that carries everything: the drawing, zoom and drill-down
               [--view name] [--theme name]         --static: the drawing alone, no script; --fragment: only the
               [--static] [--fragment] [--css]      figure, for a page of your own, and --css: the stylesheet with it
  carto threats <file.yaml> [-o threats.md]    the threat table (STRIDE threats, trust boundaries) as markdown;
               [--view name]                    --view: of one of a model's views. Drawn: carto render --view threats
  carto share <file.yaml> [--base URL]          a link that opens the diagram read-only in the web app; the diagram
                                                travels in the link's #fragment, never to a server (default base
                                                http://localhost:5173/)
  carto validate <file.yaml…>                   check files and each of their views, print problems
               [--drift]                        also fail when <file>.layout.json pins, bends or locks things
                                                (or views) that are no longer in the diagram
               [--drift --fix]                  drop those entries from <file>.layout.json
  carto diff <before.yaml> <after.yaml>         what changed between two versions, by id: added, removed and
                                                changed nodes, groups and lines
  carto diff <old-folder> <new-folder>          two exports (access, GitHub or Azure; two Azure export files too) imported and compared; for access
                                                and GitHub also who gained and lost what, effective access, in words
               [-o diff.svg|diff.md] [--view access]  the picture, the words as markdown; --view access: the matrix
                                                with gained, lost and changed cells marked
  carto diff --git <ref> <file.yaml…>           the same against the file at a branch, tag or commit (includes too)
               [-o diff.svg|diff.png|folder]    also the picture: the newer drawing with what was added and
                                                changed marked, what was removed as ghosts where it was, and a key
               [--side-by-side]                 the picture as before and after, each with its own marks
               [--json] [--view name] [--fresh] [--exit-code]
                                                --fresh lays the newer drawing out from scratch instead of keeping
                                                what was there in place; --exit-code exits 1 when something changed
  carto new <type> [file.yaml]                  start from a template; no type: which to pick
  carto import <file.mmd|.d2|.puml|.md|.dsl|.yaml…> [-o out|-] [--force]
                                                Mermaid (flowchart, architecture-beta, stateDiagram,
                                                erDiagram, sequenceDiagram, gitGraph, gantt, timeline, journey) to YAML;
                                                D2 (boxes, sql_table, sequence_diagram; layers: one file each);
                                                PlantUML (sequence, component, deployment, C4, state, activity,
                                                entity; every @startuml block); .md: every mermaid, d2 and
                                                plantuml block; Kubernetes manifests: all files in one diagram;
                                                .csv inventory or NetBox JSON: a network diagram;
                                                terraform show -json (state or plan, AWS and Google Cloud): a cloud diagram;
                                                a folder (or files) of data products and contracts (ODPS, ODCS):
                                                one data mesh diagram, <folder>.yaml; again updates it, your edits stay;
                                                a folder (or files) of az role assignment / Graph / AzureHound JSON:
                                                an access diagram; of gh api responses (or one combined JSON): github
               [--principals auto|all|groups]   members drawn, or folded into their groups (auto: above --collapse-above, 30)
               [--scope <prefix|name>]          one part: /subscriptions/…, rg-shop, or repositories shop-*
               [--depth 1|2|3] [--group-by access|none] [--as github|access]
                                                how deep scopes go; those that reach the same as one; a GitHub
                                                organisation as who reaches which repository (a matrix)
                                                Azure: az graph query JSON (resources and resourcecontainers), az bicep
                                                build output (ARM templates), terraform show -json with azurerm: an azure
                                                diagram, <folder|file>.yaml; again updates it, your edits and pins stay
               [--subscription <name|id,…>] [--rg <name|glob,…>] [--depth 1|2|3] [--all] [--collapse-above 12]
                                                only some subscriptions or resource groups; containers down to
                                                subscriptions, resource groups or (3) networks and subnets; --all also
                                                NICs, disks, NSGs, public IPs, plans; above 12 in one place, 3+ of a kind are one card
  carto import <file.drawio|.excalidraw…> [--keep-positions] [-o out|-] [--force]
                                                a draw.io file (every page) or an Excalidraw file to YAML, with a
                                                report of what was mapped and what was left out; --keep-positions
                                                writes where the shapes stood to <file>.layout.json as pins
  carto import --git <repo> [--since 2026-01-01] [--branches main,develop] [--max 200] [-o out]
                                                a repository's history as a git branching diagram
  carto export <file.yaml…> -o out.drawio|.excalidraw|.mmd|.md
               [--format drawio|excalidraw|mermaid] [--view name] [--theme name]
                                                the drawing for another tool: draw.io (every view a page) and
                                                Excalidraw keep shapes, groups and attached lines where they are;
                                                Mermaid (.mmd, or .md as a fenced block) for a README on GitHub.
                                                What a format cannot hold is said on stderr. More: docs/interop.md
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
    'svg-safe': { type: 'boolean' },
    'outline-text': { type: 'boolean' },
    'keep-positions': { type: 'boolean' },
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
    principals: { type: 'string' },
    scope: { type: 'string' },
    depth: { type: 'string' },
    'collapse-above': { type: 'string' },
    'group-by': { type: 'string' },
    as: { type: 'string' },
    all: { type: 'boolean' },
    subscription: { type: 'string' },
    rg: { type: 'string' },
    base: { type: 'string' },
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
  // Office reads no embedded font either.
  const safe = !!values['svg-safe'] && format === 'svg';
  if (values['svg-safe'] && !safe) console.error(`${file}  ${yellow('warning')}  --svg-safe is for SVG: ignored for ${format}`);
  if (values['outline-text'] && !safe) console.error(`${file}  ${yellow('warning')}  --outline-text goes with --svg-safe: ignored`);
  const opts = optionsFor(file, values['no-fonts'] || safe || format !== 'svg' ? 'none' : 'embed');
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
    const outline = safe && values['outline-text'] ? await (await import('./outline.ts')).outliner(result.theme) : undefined;
    for (const shot of shots) {
      if (!shot.svg) continue;
      const out = outputPath(file, format, view, each || values.step ? shot.step : undefined);
      const data =
        format === 'png' ? toPng(shot.svg, Number(values.scale) || 2, await ttfFiles(faces))
        : safe ? toSafeSvg(shot.svg, { outline })
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

/** The diagram of a folder lives next to it, under its name: mesh/ → mesh.yaml; of one export file too: resources.json → resources.yaml. */
function besideFolder(folder: string): string {
  if (!isFolder(folder) && /\.json$/i.test(folder)) return folder.replace(/\.json$/i, '.yaml');
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

type ExportKind = 'access' | 'github' | 'azure';

/** Every file under a folder an access or GitHub export can be: JSON, and CODEOWNERS where gh keeps it. */
function exportFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...exportFiles(p));
    else if ((/\.json$/i.test(e.name) && !/\.layout\.json$/i.test(e.name)) || /^codeowners$/i.test(e.name)) out.push(p);
  }
  return out;
}

/** What a set of files (or folders) is, by what most of its JSON files are: GitHub responses, access exports, or Azure resources. */
function exportKind(inputs: string[]): ExportKind | undefined {
  let github = 0;
  let access = 0;
  let azure = 0;
  for (const f of inputs.flatMap((x) => (isFolder(x) ? exportFiles(x) : [x]))) {
    if (!/\.json$/i.test(f)) continue;
    const text = fs.readFileSync(f, 'utf8');
    if (isAzureExport(text)) azure++;
    else if (isGithubExport(text)) github++;
    // Subscriptions and resource groups name what Azure resources are in, as much as whose roles are on them.
    else if (isAccessExport(text) && !isAzureContainers(text)) access++;
  }
  return azure > access && azure >= github ? 'azure' : github > access ? 'github' : access ? 'access' : undefined;
}

/** The flags an access or GitHub import takes; a word it does not know is said and stops the run. */
function exportOptions(): GithubOptions | string {
  const pick = <T extends string>(flag: string, allowed: T[]): T | undefined | string => {
    const v = values[flag as keyof typeof values] as string | undefined;
    return v === undefined || allowed.includes(v as T) ? (v as T | undefined) : `--${flag} is one of ${allowed.join(', ')}, not "${v}"`;
  };
  const num = (flag: string): number | undefined | string => {
    const v = values[flag as keyof typeof values] as string | undefined;
    return v === undefined ? undefined : Number(v) > 0 ? Number(v) : `--${flag} takes a number, not "${v}"`;
  };
  const opts = { principals: pick('principals', ['auto', 'all', 'groups']), groupBy: pick('group-by', ['access', 'none']), as: pick('as', ['github', 'access']), depth: num('depth'), collapseAbove: num('collapse-above') };
  const wrong = Object.values(opts).find((v) => typeof v === 'string' && v.startsWith('--'));
  if (wrong) return wrong as string;
  return { ...(opts as GithubOptions), title: values.title, scope: values.scope, all: values.all, subscription: values.subscription, rg: values.rg } as GithubOptions;
}

/**
 * Access exports (az, Graph, AzureHound) or gh api responses → their diagram at `diagram`. What that
 * file holds already stays where the export says nothing about it ("merge"); "fresh" starts over,
 * "if-same" only builds on it when it is a diagram of that type.
 */
function exportOf(inputs: string[], kind: ExportKind, diagram: string | undefined, existing: 'merge' | 'if-same' | 'fresh', base?: string): (ImportedExport & { clean: boolean; type: string }) | undefined {
  const opts = exportOptions();
  if (typeof opts === 'string') return (console.error(opts), undefined);
  const type = kind === 'azure' ? 'azure' : kind === 'github' && opts.as !== 'access' ? 'github' : 'access';
  let was = base ?? (existing !== 'fresh' && diagram && fs.existsSync(diagram) ? fs.readFileSync(diagram, 'utf8') : undefined);
  if (existing === 'if-same' && was && !new RegExp(`^type:\\s*${type}\\s*$`, 'm').test(was)) was = undefined;
  const list = inputs.flatMap((f) => (isFolder(f) ? exportFiles(f).map((p) => ({ p, at: f })) : [{ p: f, at: path.dirname(f) }])).filter((x) => !diagram || path.resolve(x.p) !== path.resolve(diagram));
  // Which team or repository a file is about shows from the folders it is in, below the one given.
  const files = list.map((x) => ({ path: path.relative(x.at, x.p).split(path.sep).join('/'), text: fs.readFileSync(x.p, 'utf8') }));
  const r = kind === 'azure' ? importAzure(files, { ...(opts as Parameters<typeof importAzure>[1]), existing: was }) : kind === 'github' ? importGithub(files, { ...opts, existing: was }) : importAccess(files, { ...opts, existing: was });
  const where = inputs.join(', ');
  for (const p of r.problems) console.error(`${p.file ? path.join(inputs.length === 1 && isFolder(inputs[0]!) ? inputs[0]! : '', p.file) : where}  ${p.severity === 'error' ? red('error') : yellow('warning')}  ${p.message}`);
  for (const w of r.warnings) console.error(`${where}  ${yellow('warning')}  ${w}`);
  if (!r.yaml) return undefined;
  return { ...r, summary: `${r.summary}${was && !base ? ', what was added by hand kept' : ''}`, clean: !r.problems.some((p) => p.severity === 'error'), type };
}

/** carto import <folder | export files>: one access or GitHub diagram, updated when it is there already. */
async function importExport(inputs: string[], kind: ExportKind): Promise<boolean> {
  // One Azure export file is its own diagram, next to it: plan.json → plan.yaml.
  const folder = inputs.length === 1 && (isFolder(inputs[0]!) || kind === 'azure') ? inputs[0]! : undefined;
  const stdout = values.out === '-';
  const name = `${kind === 'azure' ? 'azure' : kind === 'github' && values.as !== 'access' ? 'github' : 'access'}.yaml`;
  const out = values.out && !stdout ? (path.extname(values.out) ? values.out : path.join(values.out, name)) : folder && !stdout ? besideFolder(folder) : path.join(stdout ? '.' : path.dirname(inputs[0]!), name);
  const r = exportOf(inputs, kind, out, stdout || values.force ? 'fresh' : 'merge');
  if (!r) return false;
  const check = await render(r.yaml, { fonts: 'none', load: loaderFor(out) });
  // The type's own checks are said once, as the import's warnings are: quiet, the picture stays.
  report(`${folder ?? inputs[0]!} (imported)`, check.diagnostics);
  if (stdout) return (process.stdout.write(r.yaml), r.clean);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, r.yaml);
  console.log(`${folder ?? `${inputs.length} files`} → ${out} ${dim(r.summary)}`);
  return r.clean && !check.diagnostics.some((d) => d.severity === 'error');
}

/** carto render <folder> of access, GitHub or Azure exports (or one Azure export file). --write keeps the diagram it is drawn from. */
async function renderExport(folder: string, kind: ExportKind): Promise<boolean> {
  const diagram = values.write ?? besideFolder(folder);
  const r = exportOf([folder], kind, diagram, values.write ? 'merge' : 'if-same');
  if (!r) return false;
  if (!values.write) return (await renderFile(diagram, r.yaml, folder)) && r.clean;
  fs.mkdirSync(path.dirname(diagram), { recursive: true });
  fs.writeFileSync(diagram, r.yaml);
  console.log(`${folder} → ${diagram} ${dim(r.summary)}`);
  return (await renderFile(diagram)) && r.clean;
}

/** Two access or GitHub diagrams as access sources (principals, scopes, roles), for who gained and lost what; undefined for any other type. */
function accessSources(before: string | undefined, after: string | undefined): { was: AccessSource; now: AccessSource } | undefined {
  const read = (text: string | undefined): AccessSource | undefined => {
    if (text === undefined) return {};
    try {
      const doc = parseYaml(text) as { type?: string } | null;
      if (doc?.type === 'access') return doc as AccessSource;
      if (doc?.type === 'github') return accessOf(doc as Parameters<typeof accessOf>[0]) as AccessSource;
    } catch {
      // Not readable: the structural diff says so.
    }
    return undefined;
  };
  const was = read(before);
  const now = read(after);
  return was && now && (before ?? after) !== undefined ? { was, now } : undefined;
}

/** The changes in words, gained first: for the terminal, and as markdown for a pull request or a report. */
function accessMarkdown(name: string, changes: AccessChange[]): string {
  const head = { gained: 'Gained', lost: 'Lost', changed: 'Changed' } as const;
  const out = [`## Access: ${name}`, ''];
  if (!changes.length) return [...out, 'Nobody gained or lost access.', ''].join('\n');
  for (const kind of ['gained', 'lost', 'changed'] as const) {
    const list = changes.filter((c) => c.kind === kind);
    if (list.length) out.push(`### ${head[kind]} (${list.length})`, '', ...list.map((c) => `- ${c.text}`), '');
  }
  return out.join('\n');
}

/** carto diff: two files, or files against a git ref. Words (or JSON) on stdout, the picture with -o. */
async function diffFiles(): Promise<number> {
  const ref = values.git;
  if (ref ? !files.length : files.length !== 2) return (console.error(ref ? 'Name the diagrams: carto diff --git <ref> <file.yaml…>' : 'Two files: carto diff <before.yaml> <after.yaml>, or carto diff --git <ref> <file.yaml…>'), 1);
  const ext = values.out ? path.extname(values.out).slice(1).toLowerCase() : '';
  const format = ext === 'png' || ext === 'svg' ? ext : values.format === 'png' ? 'png' : 'svg';
  const fonts: RenderOptions['fonts'] = format === 'svg' && !values['no-fonts'] ? 'embed' : 'none';
  const disk = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : undefined);
  let exported: { before: string; after: string } | undefined;
  const markdown = ext === 'md';
  let root = '';
  if (ref) {
    try {
      root = repoRoot(process.cwd());
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root, stdio: 'ignore' });
    } catch {
      return (console.error(root ? `"${ref}" is not a commit, branch or tag here` : 'carto diff --git needs a git repository'), 1);
    }
  }
  // Two folders of exports: each imported, the newer over the older so the same things keep their ids.
  // Two Azure export files (a Resource Graph answer, a template, a Terraform state) are compared the same way.
  const folders = !ref && files.every((f) => isFolder(f) || (/\.json$/i.test(f) && fs.existsSync(f) && exportKind([f]) === 'azure'));
  if (folders) {
    const kind = exportKind([files[1]!]) ?? exportKind([files[0]!]);
    if (!kind) return (console.error(`Neither ${files[0]} nor ${files[1]} holds access exports, gh api responses or Azure resources`), 1);
    const before = exportOf([files[0]!], kind, undefined, 'fresh');
    const after = exportOf([files[1]!], kind, undefined, 'fresh', before?.yaml);
    if (!before || !after) return 1;
    exported = { before: before.yaml, after: after.yaml };
  }
  const pairs = folders
    ? [{ name: files[1]!, against: path.basename(path.resolve(files[0]!)), before: exported!.before, beforeOptions: optionsFor(besideFolder(files[0]!), fonts), after: exported!.after, afterFile: besideFolder(files[1]!) }]
    : ref
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
    // Access and GitHub: who gained and lost what, and with --view access the who × where matrix marked with it.
    const sources = accessSources(p.before, p.after);
    const changes = sources && accessChanges(sources.was, sources.now);
    const matrix = values.view === 'access' && sources;
    let c: Comparison;
    try {
      // The structural diff is of the diagram as written; the matrix is drawn below from both states.
      const plain = (o: RenderOptions): RenderOptions => (matrix ? { ...o, view: undefined } : o);
      c = await compare(p.before, p.after, { before: plain(p.beforeOptions), after: plain(optionsFor(p.afterFile, fonts)), view: matrix ? undefined : values.view, fresh: values.fresh });
    } catch (e) {
      console.error(`${p.name}  ${red('error')}  ${(e as Error).message}`);
      ok = false;
      continue;
    }
    report(p.name, c.diagnostics);
    if (c.failed) ok = false;
    if (!c.diff.same) changed = true;
    const state = p.before === undefined ? 'new' : p.after === undefined ? 'removed' : undefined;
    if (changes?.length) changed = true;
    if (values.json) json.push({ file: p.name, ...(values.view ? { view: values.view } : {}), against: p.against, ...(state ? { state } : {}), summary: summary(c.diff), ...c.diff, ...(changes ? { access: changes } : {}) });
    else {
      console.log(`${bold(p.name)}${values.view ? `#${values.view}` : ''} ${dim(`against ${p.against}`)}: ${state ? `${state}, ` : ''}${summary(c.diff)}`);
      if (!c.diff.same) console.log(formatDiff(c.diff));
      if (changes?.length) for (const x of changes) console.log(`  ${x.kind === 'gained' ? '+' : x.kind === 'lost' ? '-' : '~'} ${x.text}`);
    }
    if (!values.out) continue;
    const single = pairs.length === 1 && !!ext;
    if (markdown) {
      const text = changes ? accessMarkdown(path.basename(p.name), changes) : `## ${path.basename(p.name)}\n\n${summary(c.diff)}\n`;
      const out = single ? values.out : path.join(values.out, path.basename(p.name).replace(/\.ya?ml$/, '') + '.diff.md');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, text);
      console.error(`${p.name} → ${out}`);
      continue;
    }
    const overlay = { against: p.against, labels: { before: p.against, after: ref ? 'Working tree' : path.basename(p.name) } };
    let picture: { svg: string; width: number; height: number } | undefined;
    if (matrix) {
      // The type marks the cells itself: gained +, lost struck through, changed ~, each with its words.
      const r = await render(yamlText({ ...sources.now, type: 'access', view: undefined, was: sources.was }, { lineWidth: 0 }), optionsFor(p.afterFile, fonts));
      report(`${p.name}#access`, r.diagnostics.filter((d) => d.severity === 'error'));
      picture = r.svg && r.width !== undefined && r.height !== undefined ? { svg: r.svg, width: r.width, height: r.height } : undefined;
    } else picture = values['side-by-side'] ? c.sideBySide(overlay) : c.picture(overlay);
    if (!picture) continue;
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

/** Mermaid, D2, PlantUML or Markdown → <name>.yaml (or <name>-<n>.yaml per block or diagram), checked by rendering it once. */
async function importFile(file: string): Promise<boolean> {
  const text = fs.readFileSync(file, 'utf8');
  const base = path.basename(file).replace(/\.(mmd|mermaid|md|markdown|dsl|d2|puml|plantuml|pu|iuml|wsd)$/i, '');
  // A Structurizr workspace becomes one C4 file: the model and all its views.
  const dsl = /\.dsl$/i.test(file);
  const blocks = dsl ? [{ ...importStructurizr(text, base), line: 0 }] : importText(text, path.basename(file));
  if (dsl && !blocks[0]!.yaml) console.error(`${file}  ${yellow('warning')}  no workspace model found`);
  if (!blocks.length) console.error(`${file}  ${yellow('warning')}  no \`\`\`mermaid, \`\`\`d2 or \`\`\`plantuml blocks found`);
  let ok = blocks.length > 0;
  for (const [i, b] of blocks.entries()) {
    const where = `${b.line ? `${file}:${b.line}` : file}${b.name ? ` (${b.name})` : ''}`;
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
    // Several diagrams: named after what each is (aws-shop-tables.yaml), numbered when that is not clear.
    const part = b.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const name = blocks.length > 1 && (b.name || blocks.some((x, j) => j < i && !x.name)) ? `${base}-${part && blocks.filter((x) => x.name === b.name).length === 1 ? part : i + 1}.yaml` : `${base}.yaml`;
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

/** A draw.io file (a diagram per page) or an Excalidraw file → <name>.yaml, with the report of what was kept. */
async function importDrawing(file: string): Promise<boolean> {
  const text = fs.readFileSync(file, 'utf8');
  const base = path.basename(file).replace(/\.(drawio\.xml|drawio|dio|xml|excalidraw\.json|excalidraw|json)$/i, '');
  const opts = { keepPositions: !!values['keep-positions'], title: base };
  let pages: ImportedDiagram[];
  try {
    pages = isExcalidraw(text) ? [importExcalidraw(text, opts)] : importDrawio(text, opts);
  } catch (e) {
    console.error(`${file}  ${red('error')}  ${(e as Error).message}`);
    return false;
  }
  if (!pages.length) console.error(`${file}  ${yellow('warning')}  no pages found`);
  let ok = pages.length > 0;
  const taken = new Set<string>();
  for (const [i, p] of pages.entries()) {
    const where = pages.length > 1 ? `${file} (${p.name ?? `page ${i + 1}`})` : file;
    if (!p.yaml) {
      for (const line of p.report) console.error(`${where}  ${yellow('warning')}  ${line}`);
      // An empty page among others is no failure; a file with nothing in it is.
      if (pages.length === 1) ok = false;
      continue;
    }
    const check = await render(p.yaml, { fonts: 'none' });
    report(`${where} (imported)`, check.diagnostics);
    if (check.diagnostics.some((d) => d.severity === 'error')) ok = false;
    if (values.out === '-') {
      process.stdout.write((i ? '---\n' : '') + p.yaml);
      for (const line of p.report) console.error(`${where}  ${dim(line)}`);
      continue;
    }
    // A file per page, named after the page.
    let name = base;
    if (pages.length > 1) {
      const page = (p.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || String(i + 1);
      name = `${base}-${page}`;
      for (let k = 2; taken.has(name); k++) name = `${base}-${page}-${k}`;
      taken.add(name);
    }
    const out = !values.out ? path.join(path.dirname(file), `${name}.yaml`) : files.length === 1 && pages.length === 1 && path.extname(values.out) ? values.out : path.join(values.out, `${name}.yaml`);
    if (fs.existsSync(out) && !values.force) {
      console.error(`${out} already exists, use --force to overwrite`);
      ok = false;
      continue;
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, p.yaml);
    // The pins go next to it; without --keep-positions an older layout file would pin the wrong things.
    if (p.sidecar) writeSidecar(out, p.sidecar);
    console.log(`${where} → ${out}${p.sidecar ? ` + ${sidecarPath(out)}` : ''}`);
    for (const line of p.report) console.log(`  ${dim(line)}`);
  }
  return ok;
}

type Interop = 'drawio' | 'excalidraw' | 'mermaid' | 'md';
const interopExt: Record<string, Interop> = { drawio: 'drawio', dio: 'drawio', xml: 'drawio', excalidraw: 'excalidraw', mmd: 'mermaid', mermaid: 'mermaid', md: 'md', markdown: 'md' };

/** carto export: the drawing in another tool's format. What the format cannot hold is said on stderr. */
async function exportFile(file: string): Promise<boolean> {
  const ext = values.out && files.length === 1 ? path.extname(values.out).slice(1).toLowerCase() : '';
  const format: Interop | undefined = interopExt[ext] ?? (['drawio', 'excalidraw', 'mermaid', 'md'] as const).find((f) => f === values.format);
  if (!format) return (console.error('Say which format: -o out.drawio, .excalidraw, .mmd or .md, or --format drawio|excalidraw|mermaid'), false);
  const text = fs.readFileSync(file, 'utf8');
  const opts = optionsFor(file, 'none');
  const first = await render(text, opts);
  report(file, first.diagnostics);
  if (!first.graph || !first.svg) return false;
  const warn = (view: string | undefined, lines: string[]) => {
    for (const w of new Set(lines)) console.error(`${file}${view ? `#${view}` : ''}  ${yellow('warning')}  ${w}`);
  };
  const outExt = format === 'mermaid' ? 'mmd' : format;
  const target = (view?: string) => {
    const base = path.basename(file).replace(/\.ya?ml$/, '') + (view ? `-${view}` : '') + '.' + outExt;
    if (!values.out) return path.join(path.dirname(file), base);
    if (files.length === 1 && !view && path.extname(values.out)) return (fs.mkdirSync(path.dirname(values.out), { recursive: true }), values.out);
    fs.mkdirSync(values.out, { recursive: true });
    return path.join(values.out, base);
  };
  // draw.io has pages: every view goes into the one file. The others hold one drawing: the view asked
  // for, or with --all-views a file per view.
  const each = !values.view && first.views?.length && (format === 'drawio' || values['all-views']) ? first.views.map((v) => v.name) : undefined;
  const drawn: RenderResult[] = each ? await Promise.all(each.map((v) => render(text, { ...opts, view: v }))) : [first];
  let ok = !first.diagnostics.some((d) => d.severity === 'error');
  if (format === 'drawio') {
    const scenes: Scene[] = [];
    for (const r of drawn) {
      if (!r.graph || !r.svg) {
        report(`${file}#${r.view}`, r.diagnostics);
        ok = false;
        continue;
      }
      const scene = toScene(r);
      warn(each ? r.view : undefined, scene.warnings);
      scenes.push(scene);
    }
    if (!scenes.length) return false;
    const out = target();
    fs.writeFileSync(out, toDrawio(scenes));
    console.log(`${file} → ${out} ${dim(scenes.length > 1 ? `${scenes.length} pages` : `${scenes[0]!.elements.length} shapes, ${scenes[0]!.connectors.length} connectors`)}`);
    return ok;
  }
  for (const r of drawn) {
    const view = each ? r.view : undefined;
    if (!r.graph || !r.svg) {
      report(`${file}#${r.view}`, r.diagnostics);
      ok = false;
      continue;
    }
    const out = target(view);
    if (format === 'excalidraw') {
      const scene = toScene(r);
      warn(view, scene.warnings);
      fs.writeFileSync(out, toExcalidraw(scene));
      console.log(`${file}${view ? `#${view}` : ''} → ${out} ${dim(`${scene.elements.length} shapes, ${scene.connectors.length} arrows`)}`);
    } else {
      const m = toMermaid(r);
      warn(view, m.warnings);
      fs.writeFileSync(out, format === 'md' ? mermaidBlock(m.text) : m.text);
      console.log(`${file}${view ? `#${view}` : ''} → ${out} ${dim(m.kind)}`);
    }
  }
  return ok;
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
    case 'threats': {
      const [f] = files;
      if (!f) return (console.error(help), 1);
      const r = await render(fs.readFileSync(f, 'utf8'), { fonts: 'none', load: loaderFor(f), file: path.basename(f), view: values.view });
      report(f, r.diagnostics);
      if (!r.graph) return 1;
      if (!r.graph.threats) {
        console.error(`${f}: no threat model here: add trust: to a group, or threats: to an element or line (docs/threats.md)`);
        return 1;
      }
      const md = threatMarkdown(r.graph);
      if (!values.out) process.stdout.write(md);
      else {
        fs.writeFileSync(values.out, md);
        console.error(`${f} → ${values.out}  ${dim(`${r.graph.threats.length} threats`)}`);
      }
      return r.diagnostics.some((d) => d.severity === 'error') ? 1 : 0;
    }
    case 'share': {
      const [f] = files;
      if (!f) return (console.error(help), 1);
      const { shareLink, SHARE_LIMIT } = await import('@cartography/core');
      const link = await shareLink({ yaml: fs.readFileSync(f, 'utf8'), name: path.basename(f), layout: sidecarFor(f) }, values.base ?? 'http://localhost:5173/');
      if (link.length > SHARE_LIMIT) {
        console.error(`${f}: the link would be ${Math.ceil(link.length / 1000)} kB, over the ${SHARE_LIMIT / 1000} kB a link can safely carry. Share the file itself instead.`);
        return 1;
      }
      console.log(link);
      return 0;
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
      // Access exports and gh api responses: a folder (or the files) is one diagram, as a mesh is.
      const kinds = new Map(files.map((f) => [f, isFolder(f) ? (dataFiles(f).some((x) => isDataMeshFile(fs.readFileSync(x, 'utf8'))) ? undefined : exportKind([f])) : /\.json$/i.test(f) ? exportKind([f]) : undefined] as const));
      const exports = files.filter((f) => kinds.get(f));
      // Data products and their contracts are one mesh, however many files and folders they are in.
      const mesh = files.filter((f) => !exports.includes(f) && (isFolder(f) || (/\.(ya?ml|json)$/i.test(f) && isDataMeshFile(fs.readFileSync(f, 'utf8')))));
      // Manifests are read together: a platform is spread over many files, but it is one drawing.
      // terraform show -json, of a state or a saved plan: read from the file, never from the cloud.
      // Drawings from draw.io and Excalidraw are known by their ending, or by what is in an .xml or .json.
      const drawings = files.filter((f) => !exports.includes(f) && !mesh.includes(f) && (/\.(drawio|dio|excalidraw)$/i.test(f) || (/\.xml$/i.test(f) && isDrawio(fs.readFileSync(f, 'utf8'))) || (/\.json$/i.test(f) && isExcalidraw(fs.readFileSync(f, 'utf8')))));
      const plans = files.filter((f) => !exports.includes(f) && !mesh.includes(f) && !drawings.includes(f) && /\.json$/i.test(f) && isTerraform(fs.readFileSync(f, 'utf8')));
      const manifests = files.filter((f) => !exports.includes(f) && !mesh.includes(f) && !drawings.includes(f) && !plans.includes(f) && /\.(ya?ml|json)$/i.test(f) && isKubernetes(fs.readFileSync(f, 'utf8')));
      const inventories = files.filter((f) => !exports.includes(f) && !mesh.includes(f) && !drawings.includes(f) && (/\.csv$/i.test(f) || (/\.json$/i.test(f) && !plans.includes(f) && !manifests.includes(f) && isNetworkInventory(fs.readFileSync(f, 'utf8')))));
      let ok = mesh.length ? await importMesh(mesh) : true;
      for (const kind of ['access', 'github', 'azure'] as const) {
        const list = exports.filter((f) => kinds.get(f) === kind);
        // Folders each their own diagram; loose files together, as one.
        for (const f of list.filter(isFolder)) ok = (await importExport([f], kind)) && ok;
        if (list.some((f) => !isFolder(f))) ok = (await importExport(list.filter((f) => !isFolder(f)), kind)) && ok;
      }
      if (manifests.length) ok = (await importManifests(manifests)) && ok;
      for (const f of drawings) ok = (await importDrawing(f)) && ok;
      for (const f of plans) ok = (await importInventory(f, importTerraform)) && ok;
      for (const f of inventories) ok = (await importInventory(f)) && ok;
      for (const f of files) if (!exports.includes(f) && !mesh.includes(f) && !drawings.includes(f) && !plans.includes(f) && !manifests.includes(f) && !inventories.includes(f)) ok = (await importFile(f)) && ok;
      return ok ? 0 : 1;
    }
    case 'render': {
      if (!files.length) return (console.error(help), 1);
      if (!themeFlag()) return 1;
      let ok = true;
      if (values.write && !(files.length === 1 && (isFolder(files[0]!) || exportKind([files[0]!]) === 'azure'))) return (console.error('--write keeps the diagram of one folder of exports or data product files: carto render <folder> --write mesh.yaml'), 1);
      for (const f of files) {
        const kind = isFolder(f) && !dataFiles(f).some((x) => isDataMeshFile(fs.readFileSync(x, 'utf8'))) ? exportKind([f]) : /\.json$/i.test(f) && exportKind([f]) === 'azure' ? 'azure' : undefined;
        ok = (await (kind ? renderExport(f, kind) : isFolder(f) ? renderMesh(f) : renderFile(f))) && ok;
      }
      return ok ? 0 : 1;
    }
    case 'export': {
      if (!files.length) return (console.error(help), 1);
      if (!themeFlag()) return 1;
      let ok = true;
      for (const f of files) ok = (await exportFile(f)) && ok;
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
