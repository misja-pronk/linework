#!/usr/bin/env node
// carto render | deck | watch | validate | review | diff | notes | decisions | new | import | export | threats | share | icons | themes | types | describe | export-md | export-confluence
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { iconPng, interTtf, themeTtf, toPng } from './png.ts';
import { pages, readTemplate, toPdf, toPptx, type Drawing, type PptxOptions } from '@cartography/export';
import { fontScale, ttfFiles } from './fonts.ts';
import { configDir, coverageKinds, findIcons, iconGuide, importIcons, isVendor, listPacks, mapIcon, packSheet, readPack, unmapIcon } from './packs.ts';
import { coverage } from '@cartography/icons';
import { drift, findType, layerKey, render, SLIDE_MIN_PT, slideTextPt, types, type RenderOptions, type RenderResult } from '@cartography/engine';
import { isThemeFile, resolveTheme, themeCatalog, themes, type Theme } from '@cartography/theme';
import { toSafeSvg } from '@cartography/export/svg-safe';
import { execFileSync } from 'node:child_process';
import { describedPng } from './describe.ts';
import { compare, explain, explainMarkdown, formatDiff, snapshotDir, snapshotPath, summary, type Comparison } from '@cartography/diff';
import { accessChanges, type AccessChange, type AccessSource } from '@cartography/access';
import { accessOf } from '@cartography/github';
import { parse as parseYaml, stringify as yamlText } from 'yaml';
import { repoPath, repoRoot, versionAt } from '@cartography/diff/node';
import { indexWorkspace, isDiagramFile } from '@cartography/core';
import { badLang, explicitLang, helpText, t } from './i18n.ts';
import { matchTypes, packLayout, parseSidecar, sameLayoutNote, viewPins, withViewPins, type Diagnostic, type DiagramType, type LayoutSidecar } from '@cartography/core';

const helpAll = helpText(`carto — architecture diagrams that look good

  carto render <file.yaml…> [-o out] [--format svg|png|pptx|pdf] [--theme name|file.theme.yaml]
               [--pack azure] [--scale 2]           --theme wins over the diagram's theme:; -o x.pptx or x.pdf picks the format too
               [--view name | --all-views]      one of the diagram's views, or each to <file>-<view>.svg
               [--step 3 | --all-steps]         the drawing at one of its steps:, or each to <file>-step-01.svg;
                                                pptx and pdf get a slide (page) per step by themselves
               [--icons official|lucide]        the vendor's official icons (carto icons import) or our line icons,
                                                whatever the diagram's icons: says
               [--layer security | --all-layers] through one (or several) of its layers:, or each to <file>-<layer>.svg;
               [--dim]                          pptx and pdf: a slide (page) per layer. --dim fades the rest in place
               [--stable]                       note where things were drawn in <file>.layout.json, so the
                                                next render after an edit keeps them there
               [--stage q2 | --stage overview]  one of its stages: (as-is to to-be; without it the to-be), or
                                                everything marked with the stage it comes and goes in
               [--svg-safe]                     an SVG that PowerPoint, Word and Keynote take whole: no CSS, no
                                                filters or markers, system fonts, one group per node and line
               [--outline-text]                 with --svg-safe: text as outlines in the theme's own font
               [--focus orders] [--hops 2]      only that element (an id, a group, tag:x, kind:x) and what is within
               [--upstream | --downstream]      so many lines of it (default 1, or all); what feeds it, or what it feeds
               [--template customer.potx]       pptx: made in that PowerPoint template, its layouts, master, fonts
               [--layout "Title Only"]          and colours (a brand theme's pptx: names one too); --layout picks the
               [--keep-look] [--keep-slides]    layout, --keep-look keeps the diagram's own theme, --keep-slides the
                                                template's own slides in front
  carto deck <file.yaml…> -o deck.pptx|deck.pdf  all diagrams in one deck, a slide (page) each, one per step where a diagram has steps:
               [--all-steps | --no-steps]           also step through sequence messages and dynamic views; or never
               [--stages]                           a slide per stage of its stages: and per transition, the overview,
                                                    as-is and to-be side by side, the roadmap (pptx)
               [--title "Deck title"] [--subtitle …] title slide in front (pptx)
               [--aspect 16:9|4:3] [--font Inter]   slide shape and typeface (pptx)
               [--template x.potx] [--layout name]  in a PowerPoint template, as carto render (pptx)
               [--keep-look] [--keep-slides]
               [--page fit|a4|a3]                   page size (pdf, default fit)
  carto stages <file.yaml> [-o folder] [-f png]  everything its stages: make: each stage, the migration overview,
               [--from as-is --to q2]           each transition (what is added, changed, removed, replaced),
               [--side-by-side]                 the as-is and to-be side by side, the roadmap (YAML and drawn)
                                                and the stages in words; --from/--to: that transition only.
                                                Decks: carto deck --stages.
                                                More: docs/transitions.md
  carto watch  <file.yaml…> [same options]      re-render on every save (and when included files change)
  carto serve  [folder] [--port 4317]           the web editor for a folder, with an MCP endpoint for your own AI
  carto export-html <file.yaml|folder> [-o out.html]  one HTML file to send: every view and step drawn (light and
               [--title "…"] [--all-steps]      dark), pan and zoom, presenter, drill-down, search, element
                                                details, print; works offline from disk. A file brings the
                                                diagrams it drills into; a folder gets a contents page.
                                                More: docs/html-export.md
  carto describe <file.yaml> [-o out.md|.txt|.html]  the diagram in plain words: what it shows, its groups and
               [--view name | --all-views]      elements, connections in reading order, steps, layers, trust boundaries
               [--format text|md|html]          and key (sequence: the messages; ERD: tables and relations).
               [--stages]                       its stages: what each one adds, changes, removes and replaces
                                                The same words are in every SVG, PNG, PDF and slide. docs/describe.md
  carto share <file.yaml> [--base URL]          a link that opens the diagram read-only in the web app; the diagram
                                                travels in the link's #fragment, never to a server (default base
                                                http://localhost:5178/)
  carto validate <file.yaml…|folder>            check files and each of their views, print problems; a folder
                                                also across files: dangling ref:/of:, one id with two kinds,
                                                elements that no diagram or view shows
               [--drift]                        also fail when <file>.layout.json pins, bends or locks things
                                                (or views) that are no longer in the diagram
               [--drift --fix]                  drop those entries from <file>.layout.json
  carto diff <before.yaml> <after.yaml>         what changed between two versions, by id: added, removed and
                                                changed nodes, groups and lines
  carto diff --git <ref> <file.yaml…>           the same against the file at a branch, tag or commit (includes too);
                                                --since <ref> says the same
  carto diff --snapshot <label> <file.yaml…>    against a snapshot the editor wrote next to it (<name>.snapshots/<label>.yaml)
               [-o diff.svg|diff.png|diff.md|folder]  also the picture (or, .md, the changes in plain sentences): the newer drawing with what was added and
                                                changed marked, what was removed as ghosts where it was, and a key
               [--side-by-side]                 the picture as before and after, each with its own marks
               [--json] [--view name] [--fresh] [--exit-code]
                                                --fresh lays the newer drawing out from scratch instead of keeping
                                                what was there in place; --exit-code exits 1 when something changed
  carto new <type> [file.yaml]                  start from a template; no type: which to pick
  carto export <file.yaml…|folder> --to html [-o out]
                                                the same as carto export-html (its options apply)
  carto icons [azure|aws|gcp|kubernetes]        where to download each official icon set, and what is imported
  carto icons import <folder|file.zip> [--pack azure]
                                                index an official icon download (Azure, AWS, Google Cloud,
                                                Kubernetes) into a pack in ${configDir()};
                                                the vendor is told from the files when --pack is left out
  carto icons list                              packs, when imported, and how many kinds each covers
  carto icons show <pack> [-o sheet.png|.svg]   which kind got which icon, and which have none
  carto icons find <pack> <words…>              icons of the pack by name, to map one by hand
  carto icons map <pack> <kind> <words…|file>   give a kind an icon by hand (kept when a newer set is imported)
  carto icons unmap <pack> <kind>               the kind draws its line icon again
               then: icons: official in a diagram, or --icons official|lucide on render, deck, watch, embed
  carto themes                                  built-in themes
  carto types [words…]                          which type to pick, best match first
  carto blocks list [--json]                    reusable fragments (docs/blocks.md): ./blocks, your library in
                                                ${configDir()}/blocks, and the starters
  carto blocks show <block> [-o preview.svg|png] [--param k=v]   what it holds, its parameters and problems
  carto blocks new <name> --from file.yaml --select a,b,c [--title …] [--user]
                                                the selection, with its groups and the lines between, as
                                                ./blocks/<name>.block.yaml (--user: into your library)
  carto blocks insert <block> into <file.yaml> [--into group] [--param k=v…] [-o out.yaml|-]
                                                as plain YAML, ids made unique, marked "# from block: name@hash"

Manual positions are read from <file>.layout.json next to the diagram (per view under "views").
The same file can hold a layout note ("layout") per view: render reads it and only --stable writes it,
so the same YAML and layout file always give the same picture. More: docs/ci.md`, { configDir: configDir() });

/** Each command's part of the full help, from the lines that start with "carto <command>". */
const usage = new Map<string, string>();
{
  let current = '';
  for (const line of helpAll.split('\n').slice(2)) {
    const m = /^  carto ([\w-]+)/.exec(line);
    if (m) current = m[1]!;
    else if (!line.startsWith('   ')) current = '';
    if (current) usage.set(current, (usage.has(current) ? usage.get(current) + '\n' : '') + line);
  }
}

/** The commands, grouped, one line each: what `carto --help` shows. */
const groups: [string, [string, string][]][] = [
  [t('Create'), [
    ['new', t('start from a template')],
    ['types', t('which diagram type to pick')],
    ['blocks', t('reusable fragments: list, show, save, insert')],
  ]],
  [t('Draw'), [
    ['render', t('a diagram to SVG, PNG, PowerPoint or PDF')],
    ['deck', t('several diagrams in one deck')],
    ['stages', t('as-is, transition stages and to-be: each, compared, a roadmap')],
    ['watch', t('render again on every save')],
    ['serve', t('the web editor for a folder, and an MCP endpoint for your AI')],
  ]],
  [t('Export'), [
    ['export', '--to html'],
    ['describe', t('the diagram in plain words')],
    ['share', t('a link that opens it in the web app')],
  ]],
  [t('Check'), [
    ['validate', t('check files and their views')],
    ['diff', t('what changed between two versions')],
  ]],
  [t('Look'), [
    ['themes', t('built-in themes')],
    ['icons', t('import and list vendor icon packs')],
  ]],
];
/** Older names, still taken: `carto export --to html` is the same as `carto export-html`. */
const aliases: [string, string][] = [
  ['export-html', 'export --to html'],
];
const commands = [...groups.flatMap(([, list]) => list.map(([c]) => c)), ...aliases.map(([c]) => c)];

// The group names' column: as wide as the longest (Controleren) and a space.
const groupWidth = Math.max(8, ...groups.map(([title]) => title.length + 1));

const help = `${helpText('carto — architecture diagrams that look good')}
${helpText('Usage: carto <command> [files…] [options] [--lang en|nl]')}

${groups.map(([title, list]) => list.map(([c, what], i) => `${(i ? '' : title).padEnd(groupWidth)}${c.padEnd(11)}${what}`).join('\n')).join('\n')}

${t('carto <command> --help: its options · carto help all: everything · - is stdin or stdout')}
${t('Example: carto render shop.yaml -o shop.png')}`;

/**
 * How many entries of a command's help (a usage line, or an option line with what follows it) are
 * the ones most people need: the rest is under "More options". Commands not listed show all as common.
 */
const commonEntries: Record<string, number> = { render: 4, deck: 2, diff: 3, new: 1, icons: 3, blocks: 2, 'export-html': 2, validate: 1 };

/** One command's help: what it does, its common options, then the rest. */
function commandHelp(cmd: string): string {
  const lines = usage.get(cmd)!.split('\n');
  // An entry starts at a usage line or an option line; lines indented further belong to the one above.
  const entries: string[][] = [];
  for (const line of lines) (/^ {2}carto |^ {15}\S/.test(line) || !entries.length ? entries.push([line]) : entries.at(-1)!.push(line));
  const what = cmd === 'export' ? 'the interactive HTML file' : groups.flatMap(([, l]) => l).find(([c]) => c === cmd)?.[1];
  const alias = aliases.find(([c]) => c === cmd)?.[1];
  const head = `carto ${cmd}${what ? ` — ${what}` : alias ? ` (also: carto ${alias})` : ''}`;
  const n = commonEntries[cmd] ?? entries.length;
  const common = entries.slice(0, n).flat().join('\n');
  const more = entries.slice(n).flat().join('\n');
  return `${head}\n\nCommon options:\n${common}${more ? `\n\nMore options:\n${more}` : ''}`;
}

/** Help for one command, or the short help. */
const helpFor = (cmd?: string) => (cmd && usage.has(cmd) ? `${commandHelp(cmd)}\n\n${t('All commands: carto --help')}` : help);

/** The command meant by a typo: the nearest by edit distance, when it is close. */
function nearest(word: string): string | undefined {
  const dist = (a: string, b: string) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0]![j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length]![b.length]!;
  };
  const best = commands.map((c) => [c, c.startsWith(word) && word.length >= 2 ? 0 : dist(word, c)] as const).sort((a, b) => a[1] - b[1])[0];
  return best && best[1] <= Math.max(1, Math.floor(word.length / 3)) ? best[0] : undefined;
}

/** A mistake in how carto was called: said in one line, without a stack. */
class UsageError extends Error {}

/** Node's word for a wrong option, in the CLI's language. */
function parseError(m: string): string {
  const unknown = /^Unknown option '(.+)'$/.exec(m);
  if (unknown) return t("Unknown option '{option}'", { option: unknown[1]! });
  const missing = /^Option '(.+)' argument missing$/.exec(m);
  if (missing) return t("Option '{option}' argument missing", { option: missing[1]! });
  return m;
}

const parsed = (() => {
  try {
    return parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o' },
    port: { type: 'string' },
    format: { type: 'string', short: 'f', default: 'svg' },
    theme: { type: 'string', short: 't' },
    pack: { type: 'string', multiple: true },
    icons: { type: 'string' },
    scale: { type: 'string', default: '2' },
    'no-fonts': { type: 'boolean' },
    'svg-safe': { type: 'boolean' },
    'outline-text': { type: 'boolean' },
    view: { type: 'string' },
    'all-views': { type: 'boolean' },
    layer: { type: 'string', multiple: true },
    'all-layers': { type: 'boolean' },
    dim: { type: 'boolean' },
    stable: { type: 'boolean' },
    drift: { type: 'boolean' },
    json: { type: 'boolean' },
    'side-by-side': { type: 'boolean' },
    fresh: { type: 'boolean' },
    'exit-code': { type: 'boolean' },
    fix: { type: 'boolean' },
    step: { type: 'string' },
    stage: { type: 'string' },
    stages: { type: 'boolean' },
    'all-steps': { type: 'boolean' },
    'no-steps': { type: 'boolean' },
    focus: { type: 'string', multiple: true },
    hops: { type: 'string' },
    upstream: { type: 'boolean' },
    downstream: { type: 'boolean' },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    aspect: { type: 'string', default: '16:9' },
    template: { type: 'string' },
    layout: { type: 'string' },
    'keep-look': { type: 'boolean' },
    'keep-slides': { type: 'boolean' },
    font: { type: 'string' },
    page: { type: 'string', default: 'fit' },
    git: { type: 'string' },
    since: { type: 'string' },
    snapshot: { type: 'string' },
    all: { type: 'boolean' },
    base: { type: 'string' },
    into: { type: 'string' },
    select: { type: 'string' },
    param: { type: 'string', multiple: true },
    user: { type: 'boolean' },
    from: { type: 'string' },
    to: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
    lang: { type: 'string' },
  },
    });
  } catch (e) {
    // An unknown or malformed option: one line and how to see the right ones.
    const args = process.argv.slice(2);
    const at = args[0] === '--lang' ? 2 : args[0]?.startsWith('--lang=') ? 1 : 0;
    const cmd = args[at] && !args[at].startsWith('-') ? args[at] : undefined;
    console.error(`carto: ${parseError((e as Error).message.split('\n')[0]!.replace(/\. To specify a positional.*$/, ''))}\n${cmd && usage.has(cmd) ? t('Options: carto {command} --help', { command: cmd }) : t('Commands: carto --help')}`);
    process.exit(1);
  }
})();
const { positionals, values } = parsed;

const [typed, ...files] = positionals;
/** `carto export --to html` is the export command of that name. */
const exportTo = ['html'];
const command = typed === 'export' && values.to && exportTo.includes(values.to) ? `export-${values.to}` : typed;
if (typed === 'export' && values.to && !exportTo.includes(values.to)) {
  const picture = ['svg', 'png', 'pptx', 'pdf'].includes(values.to) ? ` (a picture or deck: carto render <file> -o out.${values.to})` : '';
  console.error(`carto: --to ${values.to} is not an export; use one of: ${exportTo.join(', ')}${picture}`);
  process.exit(1);
}
const useColor = process.stderr.isTTY;
const red = (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s);
const yellow = (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s);
const dim = (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s);

function report(file: string, diagnostics: Diagnostic[]) {
  for (const d of diagnostics) {
    const where = d.line ? `${file}:${d.line}:${d.column}` : file;
    console.error(`${where}  ${d.severity === 'error' ? red(t('error')) : yellow(t('warning'))}  ${d.message}`);
  }
}

const sidecarPath = (file: string) => file.replace(/\.ya?ml$/, '') + '.layout.json';

/** The sidecar next to a diagram: an entry that cannot be read is said and left out; JSON that cannot be read stops, naming the file. */
function sidecarFor(file: string): LayoutSidecar | undefined {
  const p = sidecarPath(file);
  if (!fs.existsSync(p)) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`${p}: ${t('not valid JSON: {message}', { message: (e as Error).message })}`);
  }
  const r = parseSidecar(json);
  for (const w of r.warnings) console.error(`${p}  ${yellow(t('warning'))}  ${w}`);
  return r.sidecar;
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
    // A drawing of only some layers has a note of its own: the whole view's stays as the whole was drawn.
    const key = r.layers?.mode === 'only' && r.layers.active.length ? layerKey(r.view, r.layers.active) : r.view;
    const mine = viewPins(sidecar, key);
    if (sameLayoutNote(mine?.layout, note)) continue;
    sidecar = withViewPins(sidecar, key, { version: 1, ...mine, layout: note });
  }
  if (sidecar === before) return;
  writeSidecar(file, sidecar);
  console.log(`${file} → ${sidecarPath(file)} ${dim(t('layout noted'))}`);
}

/** validate --drift: what the sidecar still refers to that the diagram no longer has. */
async function checkDrift(file: string): Promise<boolean> {
  const p = sidecarPath(file);
  if (!fs.existsSync(p)) return true;
  let sidecar: LayoutSidecar | undefined;
  try {
    sidecar = sidecarFor(file);
  } catch (e) {
    console.error(`${red(t('error'))}  ${(e as Error).message}`);
    return false;
  }
  if (!sidecar) return false;
  const r = await drift(fs.readFileSync(file, 'utf8'), sidecar, { load: loaderFor(file), file: path.basename(file), packs: values.pack, pack: readPack });
  if (r.error) return (console.error(`${p}  ${yellow(t('warning'))}  ${r.error}`), true);
  if (!r.stale.length) return true;
  const fixing = !!values.fix;
  for (const s of r.stale) console.error(`${p}  ${fixing ? yellow(t('fixed')) : red(t('stale'))}  ${s.path}: ${s.message}`);
  const count = r.stale.length;
  if (!fixing) return (console.error(`${p}  ${t('{count} stale entry; carto validate --drift --fix {file} drops it|{count} stale entries; carto validate --drift --fix {file} drops them', { count, file })}`), false);
  writeSidecar(file, r.fixed);
  console.log(`${p} ${dim(r.fixed ? t('{count} stale entry dropped|{count} stale entries dropped', { count }) : t('{count} stale entry dropped, nothing left: file removed|{count} stale entries dropped, nothing left: file removed', { count }))}`);
  return true;
}

function outputPath(file: string, format: string, view?: string, step?: number): string {
  // Steps are numbered with two digits so the files sort in the order they are told.
  const nn = step ? `-step-${String(step).padStart(2, '0')}` : '';
  const base = path.basename(file).replace(/\.ya?ml$/, '') + (view ? `-${view}` : '') + nn + '.' + format;
  if (!values.out) return path.join(path.dirname(file), base);
  // -o is a folder when it ends in / or has no extension; a file name for several pictures is a mistake,
  // not a folder named x.png.
  const folder = values.out.endsWith('/') || values.out.endsWith(path.sep) || !path.extname(values.out);
  // A deck holds every layer on a slide of its own: one file.
  const perLayer = values['all-layers'] && format !== 'pptx' && format !== 'pdf';
  if (!folder && (files.length > 1 || values['all-views'] || perLayer))
    throw new UsageError(t('-o {out} names one file, but {why}: give a folder, e.g. -o {folder}/', { out: values.out, why: values['all-views'] ? t('--all-views writes one per view') : perLayer ? t('--all-layers writes one per layer') : t('several diagrams make several files'), folder: path.join(path.dirname(values.out), path.basename(values.out, path.extname(values.out))) }));
  if (!folder) return (fs.mkdirSync(path.dirname(values.out), { recursive: true }), nn ? values.out.replace(/(\.\w+)$/, `${nn}$1`) : values.out);
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
  if (!isThemeFile(values.theme)) return (console.error(t('Unknown theme "{name}", use one of: {themes}, or a .theme.yaml file', { name: values.theme, themes: Object.keys(themes).join(', ') })), false);
  const cwd = path.resolve(values.theme);
  const r = resolveTheme(path.basename(cwd), { load: loaderFor(cwd), assets: assetsFor(cwd) });
  for (const w of r.warnings) console.error(`${values.theme}  ${yellow(t('warning'))}  ${w.path.length ? w.path.join('.') + ': ' : ''}${w.message}`);
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
  const ext = values.out && files.length === 1 && values.out !== '-' ? path.extname(values.out).slice(1).toLowerCase() : '';
  if (!formats.includes(values.format as Format)) throw new UsageError(`--format ${values.format} is not one carto ${command} writes; use one of: ${formats.join(', ')}`);
  if (ext && !formats.includes(ext as Format)) throw new UsageError(`-o ${values.out}: carto ${command} writes ${formats.join(', ')}, not .${ext}`);
  return formats.find((f) => f === ext) ?? formats.find((f) => f === values.format) ?? 'svg';
}

/** --lang or CARTO_LANG: the language of the drawing's own words when a diagram has no lang: (never the machine's locale). */
const langOption: Pick<RenderOptions, 'lang'> = explicitLang ? { lang: explicitLang } : {};

function optionsFor(file: string, fonts: RenderOptions['fonts']): RenderOptions {
  return {
    themeOverride: forced,
    sidecar: sidecarFor(file),
    load: loaderFor(file),
    assets: assetsFor(file),
    fontScale,
    packs: values.pack,
    pack: readPack,
    iconsOverride: iconsFlag(),
    fonts,
    file: path.basename(file),
    view: values.view,
    step: values.step ? Number(values.step) || 1 : undefined,
    ...(values.stage ? { stage: values.stage } : {}),
    focus: focusFlag(),
    ...(values.layer?.length ? { layers: values.layer.flatMap((l) => l.split(',')).map((l) => l.trim()).filter(Boolean) } : {}),
    ...(values.dim ? { layerMode: 'dim' as const } : {}),
    ...langOption,
  };
}

/** --icons official|lucide; anything else is a usage error. */
function iconsFlag(): RenderOptions['iconsOverride'] {
  const v = values.icons;
  if (v == null) return undefined;
  if (v === 'official' || v === 'lucide') return v;
  throw new UsageError(t('--icons is official or lucide, not "{value}"', { value: v }));
}

/** --all-steps: also steps nobody wrote; --no-steps: one slide per drawing; else a slide per written step. */
const stepsFlag = () => (values['no-steps'] ? false : values['all-steps'] ? true : undefined);

async function draw(file: string, fonts: RenderOptions['fonts']) {
  const result = await render(fs.readFileSync(file, 'utf8'), optionsFor(file, fonts));
  report(file, result.diagnostics);
  return result;
}

/** Slides and PDF pages, from one or many drawings; a brand theme carries over. */
function document(format: 'pptx' | 'pdf', drawings: Drawing[], theme: RenderResult['theme'], diagram?: string): Promise<Uint8Array> {
  const th = theme ?? (values.theme === 'dark' ? 'dark' : 'light');
  if (format === 'pptx')
    return toPptx(drawings, { theme: th, aspect: values.aspect === '4:3' ? '4:3' : '16:9', font: values.font, title: values.title, subtitle: values.subtitle, steps: stepsFlag(), rasterize: (svg, w) => iconPng(svg, w), onWarning: (w) => console.error(`${yellow(t('warning'))}  ${w}`), ...templateFlags(theme, diagram) });
  const page = values.page === 'a4' || values.page === 'a3' ? values.page : 'fit';
  return toPdf(drawings, { theme: th, page, fonts: interTtf(), families: themeTtf(typeof th === 'object' ? th : themes[th]), title: values.title, steps: stepsFlag() });
}

/**
 * --template customer.potx [--layout "Title Only"] [--keep-look] [--keep-slides], or the template a
 * brand theme names (pptx: template.potx, relative to the theme file): the deck is made in it.
 */
function templateFlags(theme: RenderResult['theme'], diagram?: string): Pick<PptxOptions, 'template' | 'layout' | 'keepLook' | 'keepSlides' | 'onWarning'> {
  const fromTheme = !values.template && theme?.pptx;
  const file = values.template ?? (fromTheme && diagram ? path.join(path.dirname(diagram), fromTheme.template) : undefined);
  if (!file) {
    if (values.layout || values['keep-look'] || values['keep-slides']) console.error(`${yellow(t('warning'))}  ${t('--layout, --keep-look and --keep-slides go with --template: ignored')}`);
    return {};
  }
  if (!/\.(potx|pptx)$/i.test(file)) throw new UsageError(t('--template is a PowerPoint template, .potx or .pptx: {file}', { file }));
  const template = readTemplate(fs.readFileSync(file));
  const layout = values.layout ?? (fromTheme ? fromTheme.layout : undefined);
  return {
    template,
    ...(layout ? { layout } : {}),
    keepLook: !!values['keep-look'] || (!!fromTheme && !!fromTheme.keepLook),
    keepSlides: !!values['keep-slides'],
    onWarning: (w) => console.error(`${file}  ${yellow(t('warning'))}  ${w}`),
  };
}

/** `text`: the diagram when it is not (or not yet) what the file holds; `shown`: what it is called in messages. */
async function renderFile(file: string, text = fs.readFileSync(file, 'utf8'), shown = file): Promise<boolean> {
  const format = formatFor();
  // resvg reads fonts from files; embedding them in the SVG only makes the PNG step slower.
  // Office reads no embedded font either.
  const safe = !!values['svg-safe'] && format === 'svg';
  if (values['svg-safe'] && !safe) console.error(`${file}  ${yellow(t('warning'))}  ${t('--svg-safe is for SVG: ignored for {format}', { format })}`);
  if (values['outline-text'] && !safe) console.error(`${file}  ${yellow(t('warning'))}  ${t('--outline-text goes with --svg-safe: ignored')}`);
  const opts = optionsFor(file, values['no-fonts'] || safe || format !== 'svg' ? 'none' : 'embed');
  const first = await render(text, opts);
  // --all-views: the diagram as written (or its first view) plus every view as <file>-<view>.svg.
  const views = values['all-views'] && first.views?.length ? await Promise.all(first.views.map((v) => render(text, { ...opts, view: v.name }))) : [];
  // A view with nothing in it is no picture: said, not written.
  for (const v of views) if (v.empty) console.error(`${shown}#${v.view}  ${dim(t('empty: nothing to draw, not written'))}`);
  // --all-layers: the drawing as a whole, then through each of its layers as <file>-<layer>.svg (a slide each in a deck).
  if (values['all-layers'] && !first.layers?.list.length) console.error(`${shown}  ${yellow(t('warning'))}  ${t('--all-layers: this diagram has no layers: (see docs/layers.md)')}`);
  const layered = values['all-layers'] ? await Promise.all((first.layers?.list ?? []).map((l) => render(text, { ...opts, layers: l.name }))) : [];
  for (const [i, l] of layered.entries()) if (l.empty || !l.layers?.kept) console.error(`${shown}@${first.layers!.list[i]!.name}  ${dim(t('nothing on this layer, not written'))}`);
  const runs = [first, ...views.filter((v) => !v.empty), ...layered.filter((l) => !l.empty && l.layers?.kept)];
  /** What a run is called in messages and file names: its view, or its layers. */
  const named = (r: RenderResult, i: number) => (i && layered.includes(r) ? [r.view, r.layers!.active.join('+')].filter(Boolean).join('-') : i ? r.view : values.view);
  if (values['all-layers'] && (format === 'pptx' || format === 'pdf')) {
    const drawn = runs.filter((r) => r.svg && !r.diagnostics.some((d) => d.severity === 'error'));
    for (const r of runs) report(r === first ? shown : `${shown}@${named(r, runs.indexOf(r))}`, r === first ? r.diagnostics : r.diagnostics.filter((d) => !first.diagnostics.some((f) => f.message === d.message)));
    if (!drawn.length) return false;
    const out = values.out === '-' ? '-' : outputPath(file, format, values.view);
    // A layer is one slide (its steps are the whole drawing's story, told on its own slides), unless every step is asked for.
    const data = await document(format, drawn.map((r) => ({ ...r, name: path.basename(file), ...(r !== first && !values['all-steps'] ? { steps: undefined } : {}) })), first.theme, file);
    if (out === '-') process.stdout.write(data);
    else fs.writeFileSync(out, data);
    console.log(`${shown} → ${out === '-' ? t('standard output') : out} ${dim(t('{all} drawings: the whole and {count} layer|{all} drawings: the whole and {count} layers', { all: drawn.length, count: drawn.length - 1 }))}`);
    if (values.stable) noteLayout(file, runs);
    return drawn.length === runs.length;
  }
  let ok = true;
  const stdout = values.out === '-' || (shown === 'stdin' && !values.out);
  for (const [i, result] of runs.entries()) {
    const view = named(result, i);
    report(view && i ? `${shown}${layered.includes(result) ? '@' : '#'}${view}` : shown, i && !values.view ? result.diagnostics.filter((d) => !first.diagnostics.some((f) => f.message === d.message)) : result.diagnostics);
    if (!result.svg) {
      ok = false;
      continue;
    }
    if ((values.step || (values['all-steps'] && !values['all-views'])) && !result.steps) console.error(`${shown}${view ? `#${view}` : ''}  ${yellow(t('warning'))}  ${t('no steps here: drawn as a whole')}`);
    // --all-steps: an image per step, numbered; a pptx or pdf holds them all in one file.
    const each = values['all-steps'] && result.steps && (format === 'svg' || format === 'png');
    const shots = each ? await Promise.all(result.steps!.map((_, n) => render(text, { ...opts, view: result.view ?? opts.view, ...(layered.includes(result) ? { layers: result.layers!.active } : {}), step: n + 1 }))) : [result];
    if (stdout && runs.length + shots.length > 2) throw new UsageError(t('-o - writes one picture to standard output: give a folder for --all-views or --all-steps'));
    // A drawing with errors is not what was asked for: nothing is written, the errors say why.
    if (result.diagnostics.some((d) => d.severity === 'error')) {
      console.error(`${shown}${view ? `#${view}` : ''}  ${red(t('error'))}  ${t('nothing written')}`);
      ok = false;
      continue;
    }
    const faces = result.theme?.font.faces ?? [];
    const outline = safe && values['outline-text'] ? await (await import('./outline.ts')).outliner(result.theme) : undefined;
    for (const shot of shots) {
      if (!shot.svg) continue;
      const out = stdout ? '-' : outputPath(file, format, view, each || values.step ? shot.step : undefined);
      const data =
        format === 'png' ? await describedPng(shot, file, toPng(shot.svg, Number(values.scale) || 2, await ttfFiles(faces)))
        : safe ? toSafeSvg(shot.svg, { outline })
        : format === 'svg' ? shot.svg
        : await document(format, [{ ...shot, name: path.basename(file) }], shot.theme, file);
      if (stdout) process.stdout.write(data);
      else fs.writeFileSync(out, data);
      (stdout ? console.error : console.log)(`${shown}${view ? `${layered.includes(result) ? '@' : '#'}${view}` : ''}${shot.step ? ` ${t('step {n}', { n: shot.step })}` : ''} → ${stdout ? t('standard output') : out} ${dim(`${shot.width}×${shot.height}`)}`);
    }
  }
  if (values.stable) noteLayout(file, runs);
  return ok;
}

/** carto validate <folder>: what only shows across files (a ref: to nothing, one id two kinds, elements no view shows). */
function validateWorkspace(dir: string): boolean {
  const ix = indexWorkspace(dataFiles(dir).map((f) => [path.relative(dir, f).split(path.sep).join('/'), fs.readFileSync(f, 'utf8')] as [string, string]));
  for (const p of ix.problems) console.error(`${path.join(dir, p.file)}${p.line ? `:${p.line}` : ''}  ${p.severity === 'error' ? red(t('error')) : yellow(t('warning'))}  ${p.message}`);
  const n = ix.files.size;
  if (!ix.problems.length) console.log(`${dir} ${dim(`${t('workspace ok: {count} diagram|workspace ok: {count} diagrams', { count: n })}, ${t('{count} element|{count} elements', { count: ix.elements.size })}`)}`);
  return !ix.problems.some((p) => p.severity === 'error');
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
  // --since <ref> reads as "what changed since": the same as --git.
  const ref = values.git ?? values.since;
  const snap = values.snapshot;
  if (ref || snap ? !files.length : files.length !== 2)
    return (console.error(ref ? t('Name the diagrams: carto diff --git <ref> <file.yaml…>') : snap ? t('Name the diagrams: carto diff --snapshot <label> <file.yaml…>') : t('Two files: carto diff <before.yaml> <after.yaml>, carto diff --git <ref> <file.yaml…> or carto diff --snapshot <label> <file.yaml…>')), 1);
  if (snap) {
    // A snapshot that is not there: say which there are.
    const missing = files.filter((f) => !fs.existsSync(snapshotPath(f, snap)));
    for (const f of missing) {
      const dir = snapshotDir(f);
      const there = fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => /\.ya?ml$/i.test(x)).map((x) => x.replace(/\.ya?ml$/i, '')) : [];
      console.error(`${f}  ${red(t('error'))}  ${there.length ? t('no snapshot "{label}" ({path}); there are: {list}', { label: snap, path: snapshotPath(f, snap), list: there.join(', ') }) : t('no snapshot "{label}" ({path}); take one in the editor with ⇧⌘S', { label: snap, path: snapshotPath(f, snap) })}`);
    }
    if (missing.length) return 1;
  }
  const ext = values.out ? path.extname(values.out).slice(1).toLowerCase() : '';
  const format = ext === 'png' || ext === 'svg' ? ext : values.format === 'png' ? 'png' : 'svg';
  const fonts: RenderOptions['fonts'] = format === 'svg' && !values['no-fonts'] ? 'embed' : 'none';
  const disk = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : undefined);
  const markdown = ext === 'md';
  let root = '';
  if (ref) {
    try {
      root = repoRoot(process.cwd());
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root, stdio: 'ignore' });
    } catch {
      return (console.error(root ? t('"{ref}" is not a commit, branch or tag here', { ref }) : t('carto diff --git needs a git repository')), 1);
    }
  }
  const pairs = snap
    ? files.map((f) => {
        const file = snapshotPath(f, snap);
        // Read as the diagram itself would be: includes from beside it, pins from beside the snapshot.
        return { name: f, against: `snapshot ${snap}`, before: disk(file), beforeOptions: { ...optionsFor(f, fonts), sidecar: sidecarFor(file) }, after: disk(f), afterFile: f };
      })
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
      console.error(`${p.name}  ${red(t('error'))}  ${ref ? t('not found, here or in {ref}', { ref }) : t('not found')}`);
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
      console.error(`${p.name}  ${red(t('error'))}  ${(e as Error).message}`);
      ok = false;
      continue;
    }
    report(p.name, c.diagnostics);
    if (c.failed) ok = false;
    if (!c.diff.same) changed = true;
    const state = p.before === undefined ? 'new' : p.after === undefined ? 'removed' : undefined;
    if (changes?.length) changed = true;
    if (values.json) json.push({ file: p.name, ...(values.view ? { view: values.view } : {}), against: p.against, ...(state ? { state } : {}), summary: summary(c.diff), explained: explain(c.diff, c.before?.graph, c.after?.graph).map((x) => x.text), ...c.diff, ...(changes ? { access: changes } : {}) });
    else {
      // With -o - the picture or the text is standard output: the summary goes to stderr.
      const say = values.out === '-' ? console.error : console.log;
      say(`${bold(p.name)}${values.view ? `#${values.view}` : ''} ${dim(t('against {what}', { what: p.against }))}: ${state ? `${state}, ` : ''}${summary(c.diff)}`);
      if (!c.diff.same) say(formatDiff(c.diff));
      if (changes?.length) for (const x of changes) say(`  ${x.kind === 'gained' ? '+' : x.kind === 'lost' ? '-' : '~'} ${x.text}`);
    }
    if (!values.out) continue;
    const single = pairs.length === 1 && !!ext;
    if (markdown) {
      const text = changes ? accessMarkdown(path.basename(p.name), changes) : explainMarkdown(c.diff, c.before?.graph, c.after?.graph, { name: path.basename(p.name), against: p.against });
      const out = values.out === '-' ? '-' : single ? values.out : path.join(values.out, path.basename(p.name).replace(/\.ya?ml$/, '') + '.diff.md');
      if (out !== '-') fs.mkdirSync(path.dirname(out), { recursive: true });
      put(out, text);
      if (out !== '-') console.error(`${p.name} → ${out}`);
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
    const out = values.out === '-' ? '-' : single ? values.out : path.join(values.out, path.basename(p.name).replace(/\.ya?ml$/, '') + (values.view ? `-${values.view}` : '') + `.diff.${format}`);
    if (out !== '-') fs.mkdirSync(path.dirname(out), { recursive: true });
    const faces = (c.after ?? c.before)?.theme?.font.faces ?? [];
    put(out, format === 'png' ? toPng(picture.svg, Number(values.scale) || 2, await ttfFiles(faces)) : picture.svg);
    console.error(`${p.name} → ${out} ${dim(`${picture.width}×${picture.height}`)}`);
  }
  if (values.json) console.log(JSON.stringify(ref || snap ? json : json[0], null, 2));
  return !ok ? 1 : values['exit-code'] && changed ? 1 : 0;
}

/** Several diagrams, one file: a slide or page each, in the order given. */
async function deck(): Promise<boolean> {
  const format = values.out?.toLowerCase().endsWith('.pdf') ? 'pdf' : 'pptx';
  if (!values.out || !/\.(pptx|pdf)$/i.test(values.out)) {
    console.error(t('carto deck needs -o <file>.pptx or -o <file>.pdf'));
    return false;
  }
  // --stages: a slide per stage and per transition, the overview, before and after, the roadmap.
  if (values.stages) {
    if (format !== 'pptx') return (console.error('carto deck --stages makes a PowerPoint deck: -o <file>.pptx'), false);
    const { stagesDeck } = await import('./stages.ts');
    const made = await stagesDeck(files, (f) => optionsFor(f, 'none'), async (svg, theme) => toPng(svg, 2, await ttfFiles(theme?.font.faces ?? [])), values.title);
    if (!made) return false;
    fs.mkdirSync(path.dirname(values.out), { recursive: true });
    fs.writeFileSync(values.out, made.data);
    console.log(`${made.slides} slides → ${values.out}`);
    return true;
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
  fs.writeFileSync(values.out, await document(format, drawings, theme, files[0]));
  const count = pages(drawings, stepsFlag()).length;
  console.log(`${t('{count} diagram|{count} diagrams', { count: drawings.length })}${count > drawings.length ? `, ${format === 'pdf' ? t('{count} page|{count} pages', { count }) : t('{count} slide|{count} slides', { count })}` : ''} → ${values.out}`);
  return ok;
}

/** Writes a file, or standard output for `-`. */
const put = (out: string, data: string | Uint8Array) => (out === '-' ? process.stdout.write(data) : fs.writeFileSync(out, data));

const bold = (s: string) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s);

/** What each type is for; with words, the best matches first and the rest left out. */
function typeGuide(query = '') {
  const ranked = matchTypes(query, types);
  const shown = query && ranked[0]!.score > 0 ? ranked.filter((r) => r.score > 0) : ranked;
  if (query && !ranked[0]!.score) console.log(dim(`${t('Nothing matches "{query}"; architecture (systems) is the usual start.', { query })}\n`));
  const name = (id: string) => findType(id)?.name ?? id;
  for (const { type: ty } of shown) {
    console.log(`${bold(ty.id.padEnd(14))} ${ty.name}${ty.tagline ? dim(' — ' + ty.tagline) : ''}`);
    for (const u of ty.useWhen ?? []) console.log(`${' '.repeat(15)}+ ${u}`);
    for (const n of ty.notFor ?? []) console.log(dim(`${' '.repeat(15)}- ${t('not for:')} ${n.text}${n.use ? ` → ${n.use} (${name(n.use)})` : ''}`));
    console.log();
  }
  console.log(dim(t('Start one: carto new <type> [file.yaml]. Guide: docs/types.md')));
}

async function main(): Promise<number> {
  if (badLang !== undefined) throw new UsageError(t('--lang is en or nl, not "{value}"', { value: badLang }));
  if (command === 'help') {
    const [what] = files;
    if (what === 'all') console.log(helpAll);
    else if (what && !usage.has(what)) return unknown(what);
    else console.log(helpFor(what));
    return 0;
  }
  if (values.help || !command) {
    if (command && !usage.has(command)) return unknown(command);
    console.log(helpFor(command));
    return command || values.help ? 0 : 1;
  }
  switch (command) {
    case 'blocks':
      return (await import('./blocks.ts')).blocksCommand(files, { ...values, out: values.out }, helpFor('blocks'));
    case 'types':
      typeGuide(files.join(' '));
      return 0;
    case 'themes':
      for (const t of themeCatalog) console.log(`${t.name.padEnd(14)} ${dim('— ' + t.description)}`);
      console.log(`${'light, dark'.padEnd(14)} ${dim(`— ${t('other names for survey and survey-dark')}`)}`);
      console.log(dim(t('Or a file: theme: ./client.theme.yaml (see docs/themes.md and docs/style.md)')));
      return 0;
    case 'icons': {
      const [sub, a, ...more] = files;
      const fail = (e: unknown) => (console.error(`${red(t('error'))}  ${(e as Error).message}`), 1);
      if (!sub || isVendor(sub)) return (console.log(iconGuide(sub)), 0);
      if (sub === 'list') {
        const packs = listPacks();
        if (!packs.length) console.log(t('No icon packs yet. Where to get them: carto icons'));
        for (const p of packs) {
          const cov = coverage(p, coverageKinds(p.name));
          console.log(`${p.name.padEnd(12)} ${t('{have} of {count} kinds', { have: cov.have, count: cov.of })}${p.manual && Object.keys(p.manual).length ? `, ${t('{count} by hand', { count: Object.keys(p.manual).length })}` : ''} ${dim(t('imported {when} ← {source}', { when: p.imported ?? '?', source: p.source ?? '?' }))}`);
        }
        return 0;
      }
      if (sub === 'import') {
        if (!a) return (console.error(helpFor(command)), 1);
        try {
          const r = importIcons(a, values.pack?.[0]);
          const name = r.pack.name;
          console.log(`${a} → ${r.dir}\n  ${t('{files} SVG files; {have} of {count} {pack} kinds have an icon', { files: r.files, have: r.coverage.have, count: r.coverage.of, pack: name })}${r.kept.length ? ` ${t('({count} mapped by hand before, kept)', { count: r.kept.length })}` : ''}`);
          if (r.coverage.missing.length) console.log(dim(`  ${t('no icon yet: {kinds}', { kinds: r.coverage.missing.join(', ') })}\n  ${t('give one by hand: carto icons map {pack} <kind> <words>; see all: carto icons show {pack} -o {pack}.png', { pack: name })}`));
          console.log(dim(`  ${t('use it: icons: official in the diagram, or carto render diagram.yaml --icons official')}`));
          return 0;
        } catch (e) {
          return fail(e);
        }
      }
      if (!a) return (console.error(helpFor(command)), 1);
      try {
        if (sub === 'show') {
          const { svg, coverage: cov } = packSheet(a);
          if (values.out === '-') process.stdout.write(svg);
          else if (values.out) {
            fs.writeFileSync(values.out, /\.png$/i.test(values.out) ? toPng(svg, 2) : svg);
            console.log(`${a}: ${t('{have} of {count} kinds', { have: cov.have, count: cov.of })} → ${values.out}`);
          } else {
            const pack = readPack(a)!;
            for (const k of coverageKinds(a)) console.log(`${k.kind.padEnd(24)} ${pack.icons[k.kind] ? pack.icons[k.kind] + (pack.manual?.[k.kind] ? dim(`  (${t('by hand')})`) : '') : dim('—')}`);
            console.log(`\n${t('{have} of {count} kinds have an icon', { have: cov.have, count: cov.of })}`);
          }
          return 0;
        }
        if (sub === 'find') {
          const hits = findIcons(a, more.join(' '));
          for (const h of hits.slice(0, 30)) console.log(`${h.name.padEnd(40)} ${dim(h.file)}`);
          if (!hits.length) console.log(t('Nothing in {pack} called "{words}"', { pack: a, words: more.join(' ') }));
          return hits.length ? 0 : 1;
        }
        if (sub === 'map') {
          const [kind, ...words] = more;
          if (!kind || !words.length) return (console.error(helpFor(command)), 1);
          const r = mapIcon(a, kind, words.join(' '));
          console.log(`${a}: ${kind} → ${r.file}`);
          return 0;
        }
        if (sub === 'unmap') {
          const [kind] = more;
          if (!kind) return (console.error(helpFor(command)), 1);
          unmapIcon(a, kind);
          console.log(`${a}: ${t('{kind} draws its line icon again', { kind })}`);
          return 0;
        }
      } catch (e) {
        return fail(e);
      }
      return (console.error(helpFor(command)), 1);
    }
    case 'new': {
      const [id, target] = files;
      // Without a type, help picking one instead of an error.
      if (!id) return (typeGuide(), 0);
      const type = findType(id);
      if (!type) {
        console.error(t('Unknown type "{name}". Types: {types}', { name: id ?? '', types: types.map((x) => x.id).join(', ') }));
        return 1;
      }
      // `-` is standard output, as everywhere a file is named.
      if (!target || target === '-') {
        process.stdout.write(type.template);
        return 0;
      }
      if (fs.existsSync(target)) {
        console.error(t('{file} already exists', { file: target }));
        return 1;
      }
      fs.writeFileSync(target, type.template);
      console.log(t('Created {file}', { file: target }));
      return 0;
    }
    case 'export-html': {
      const [f] = files;
      if (!f || files.length > 1) return (console.error(helpFor(command)), 1);
      if (!fs.existsSync(f)) return (console.error(t('{file}: no such file or folder', { file: f })), 1);
      if (!themeFlag()) return 1;
      const { exportHtmlFile } = await import('./html-export.ts');
      const r = await exportHtmlFile(f, values.out, { title: values.title, allSteps: values['all-steps'], render: { themeOverride: forced, packs: values.pack, pack: readPack, iconsOverride: iconsFlag(), fontScale, ...langOption } });
      for (const p of r.problems) console.error(`${path.join(r.root, p.file)}${p.line ? `:${p.line}` : ''}  ${red(t('error'))}  ${p.message}`);
      if (!r.stats.drawings) return (console.error(t('{file}: nothing to draw', { file: f })), 1);
      const s = r.stats;
      console.log(`${f} → ${r.file} ${dim(`${t('{count} drawing|{count} drawings', { count: s.drawings })}${s.steps ? `, ${t('{count} step|{count} steps', { count: s.steps })}` : ''}, ${t('{count} element|{count} elements', { count: s.elements })}, ${(s.bytes / 1024).toFixed(0)} kB`)}`);
      return r.problems.length ? 1 : 0;
    }
    case 'describe': {
      const [f] = files;
      if (!f || files.length > 1) return (console.error(helpFor(command)), 1);
      if (!fs.existsSync(f)) return (console.error(t('{file}: no such file', { file: f })), 1);
      const ext = values.out && values.out !== '-' ? path.extname(values.out).slice(1).toLowerCase() : '';
      const asked = values.format === 'markdown' ? 'md' : values.format;
      if (asked !== 'svg' && !['text', 'md', 'html'].includes(asked)) throw new UsageError(`--format ${values.format}: carto describe writes text, md or html`);
      const format = asked === 'text' || asked === 'md' || asked === 'html' ? asked : ext === 'md' || ext === 'markdown' ? 'md' : ext === 'html' || ext === 'htm' ? 'html' : 'text';
      if (values.stages) {
        // The stages in words: what each one changes against the one before, a replacement told as one.
        const { stageStory, storyMarkdown, storyText } = await import('@cartography/diff');
        const opts = optionsFor(f, 'none');
        const story = await stageStory(fs.readFileSync(f, 'utf8'), opts);
        if (!story.length) return (console.error(`${f}: this diagram has no stages: (see docs/transitions.md)`), 1);
        const title = (await render(fs.readFileSync(f, 'utf8'), { ...opts, stage: 'overview' })).graph?.title ?? path.basename(f);
        const said = format === 'md' ? storyMarkdown(title, story) : storyText(title, story);
        if (!values.out || values.out === '-') process.stdout.write(said);
        else fs.writeFileSync(values.out, said);
        return 0;
      }
      const { describeFile } = await import('./describe.ts');
      const r = await describeFile(f, { view: values.view, allViews: values['all-views'], format, options: optionsFor(f, 'none') });
      for (const p of r.problems) console.error(`${f}  ${red(t('error'))}  ${p}`);
      if (!r.ok) return 1;
      if (!values.out || values.out === '-') process.stdout.write(r.text);
      else {
        fs.mkdirSync(path.dirname(path.resolve(values.out)), { recursive: true });
        fs.writeFileSync(values.out, r.text);
        console.error(`${f} → ${values.out}`);
      }
      return 0;
    }
    case 'share': {
      const [f] = files;
      if (!f) return (console.error(helpFor(command)), 1);
      const { shareLink, SHARE_LIMIT } = await import('@cartography/core');
      const link = await shareLink({ yaml: fs.readFileSync(f, 'utf8'), name: path.basename(f), layout: sidecarFor(f) }, values.base ?? 'http://localhost:5178/');
      if (link.length > SHARE_LIMIT) {
        console.error(t('{file}: the link would be {size} kB, over the {limit} kB a link can safely carry. Share the file itself instead.', { file: f, size: Math.ceil(link.length / 1000), limit: SHARE_LIMIT / 1000 }));
        return 1;
      }
      console.log(link);
      return 0;
    }
    case 'validate': {
      let ok = true;
      // A folder is a workspace: each diagram in it, and then how they fit together.
      const folders = files.filter(isFolder);
      for (const f of files.filter((x) => !isFolder(x)).concat(folders.flatMap((d) => dataFiles(d).filter((x) => isDiagramFile(x, fs.readFileSync(x, 'utf8')))))) {
        const text = fs.readFileSync(f, 'utf8');
        const opts = { fonts: 'none' as const, load: loaderFor(f), file: path.basename(f), ...langOption };
        const r = await render(text, { ...opts, view: values.view });
        // Without --view every view is checked too: what a view says about itself (complete: true for
        // an environment) is only known when that view is drawn. The same problem is printed once.
        const rest = values.view ? [] : await Promise.all((r.views ?? []).map((v) => render(text, { ...opts, view: v.name })));
        const seen = new Set<string>();
        const diagnostics = [r, ...rest].flatMap((x) => x.diagnostics).filter((d) => !seen.has(`${d.line}:${d.column}:${d.message}`) && !!seen.add(`${d.line}:${d.column}:${d.message}`));
        // Fitted onto its page (a 16:9 slide unless aspect: says otherwise), the smallest text of each drawing should still be readable.
        for (const x of [r, ...rest.filter((v) => v.view !== r.view)]) {
          const pt = x.svg && x.width && x.height ? slideTextPt(x.svg, x.width, x.height, x.page) : undefined;
          if (pt != null && pt < SLIDE_MIN_PT)
            diagnostics.push({ severity: 'warning', message: `${x.view ? `View "${x.view}": o` : 'O'}n a ${x.page?.name ?? '16:9 slide'} its smallest text is ${pt.toFixed(1)} pt, under ${SLIDE_MIN_PT} pt: split it into views, or let it wrap (aspect: 16:9)` });
        }
        report(f, diagnostics);
        const drifted = values.drift && !(await checkDrift(f));
        if (diagnostics.some((d) => d.severity === 'error') || drifted) ok = false;
        else console.log(`${f} ${dim(t('ok'))}`);
      }
      for (const dir of folders) ok = validateWorkspace(dir) && ok;
      return ok ? 0 : 1;
    }
    case 'stages': {
      if (files.length !== 1) return (console.error(helpFor(command)), 2);
      if (!themeFlag()) return 2;
      const { stagesCommand } = await import('./stages.ts');
      return stagesCommand({
        file: files[0]!,
        out: values.out,
        format: values.format === 'png' ? 'png' : 'svg',
        from: values.from,
        to: values.to,
        sideBySide: values['side-by-side'],
        options: { ...optionsFor(files[0]!, 'none'), stage: undefined },
        png: async (svg, theme) => toPng(svg, Number(values.scale) || 2, await ttfFiles(theme?.font.faces ?? [])),
        say: { red, yellow, dim },
      });
    }
    case 'diff':
      if (!themeFlag()) return 1;
      return diffFiles();
    case 'render': {
      if (!files.length) return (console.error(helpFor(command)), 1);
      if (!formats.includes(values.format as Format)) throw new UsageError(`--format ${values.format} is not one carto render writes; use one of: ${formats.join(', ')}`);
      if (!(Number(values.scale) > 0)) throw new UsageError(`--scale ${values.scale}: give a number above 0, e.g. --scale 2`);
      if (!themeFlag()) return 1;
      let ok = true;
      for (const f of files) {
        // `-` reads the diagram from standard input; the picture then goes to standard output unless -o says where.
        if (f === '-') ok = (await renderFile(path.resolve('stdin.yaml'), fs.readFileSync(0, 'utf8'), 'stdin')) && ok;
        else ok = (await renderFile(f)) && ok;
      }
      return ok ? 0 : 1;
    }
    case 'export':
      // Without --to html: which exports there are.
      return (console.error(helpFor(command)), 1);
    case 'deck':
      if (!files.length) return (console.error(helpFor(command)), 1);
      return (await deck()) ? 0 : 1;
    case 'serve': {
      if (files.length > 1) return (console.error(helpFor(command)), 1);
      const root = path.resolve(files[0] ?? '.');
      if (!isFolder(root)) return (console.error(t('{file}: not a folder', { file: files[0] ?? '.' })), 1);
      const port = values.port === undefined ? 4317 : Number(values.port);
      if (!(Number.isInteger(port) && port >= 0 && port < 65536)) throw new UsageError(t('--port takes a number, e.g. --port 4317'));
      const app = path.resolve(import.meta.dirname, '../../web/dist');
      if (!fs.existsSync(path.join(app, 'index.html'))) return (console.error(t('The web app is not built yet: run pnpm web:build first')), 1);
      const { serve } = await import('./serve.ts');
      let s: Awaited<ReturnType<typeof serve>>;
      try {
        s = await serve({ root, port, app, log: (l) => console.error(dim(l)) });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') return (console.error(t('Port {port} is in use: pick another with --port', { port })), 1);
        throw e;
      }
      console.log(`${bold(t('Cartography for {folder}', { folder: root }))}
  ${t('Editor')}  ${s.url}/
  MCP     ${s.url}/mcp
`);
      console.log(dim(t('Connect your AI (once; the token stays the same):')));
      console.log(`  claude mcp add --transport http cartography ${s.url}/mcp --header "Authorization: Bearer ${s.token}"
`);
      console.log(dim(t('Ctrl+C to stop')));
      const stop = () => (s.close(), process.exit(0));
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      return new Promise(() => {});
    }
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
      console.log(dim(t('watching… Ctrl+C to stop')));
      return new Promise(() => {});
    }
    default:
      return unknown(command);
  }
}

function unknown(cmd: string): number {
  const guess = nearest(cmd);
  console.error(`carto: ${guess ? t('unknown command "{name}". Did you mean "carto {guess}"?', { name: cmd, guess }) : t('unknown command "{name}"', { name: cmd })}\n${t('Commands: {list}', { list: commands.join(', ') })}\n${t('More: carto --help')}`);
  return 1;
}

/** What went wrong, in one line: a file that is not there, a folder where a file was meant, … */
function friendly(e: unknown): string {
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

try {
  process.exitCode = await main();
} catch (e) {
  console.error(`carto: ${friendly(e)}`);
  // The stack only when asked for: CARTO_DEBUG=1.
  if (process.env.CARTO_DEBUG && !(e instanceof UsageError)) console.error((e as Error).stack);
  process.exitCode = 1;
}
