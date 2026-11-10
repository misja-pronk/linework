#!/usr/bin/env node
// carto render | deck | watch | validate | diff | notes | decisions | new | import | export | threats | share | icons | themes | types | describe | export-md | export-confluence
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { iconPng, interTtf, themeTtf, toPng } from './png.ts';
import { pages, toPdf, toPptx, type Drawing } from '@cartography/export';
import { fontScale, ttfFiles } from './fonts.ts';
import { configDir, coverageKinds, findIcons, iconGuide, importIcons, isVendor, listPacks, mapIcon, packSheet, readPack, unmapIcon } from './packs.ts';
import { coverage } from '@cartography/icons';
import { drift, findType, layerKey, render, withReviewNotes, SLIDE_MIN_PT, slideTextPt, types, type RenderOptions, type RenderResult } from '@cartography/engine';
import { isThemeFile, resolveTheme, themeCatalog, themes, type Theme } from '@cartography/theme';
import { importDrawio, importExcalidraw, isDrawio, isExcalidraw, mermaidBlock, toDrawio, toExcalidraw, toMermaid, toSafeSvg, toScene, type ImportedDiagram, type Scene } from '@cartography/interop';
import { GIT_LOG_FORMAT, importAccess, importAzure, isAzureContainers, isAzureExport, importDataMesh, importGithub, isAccessExport, isGithubExport, type GithubOptions, type ImportedExport, importGitLog, importKubernetes, importNetwork, importText, importStructurizr, importTerraform, isDataMeshFile, isKubernetes, isNetworkInventory, isTerraform } from '@cartography/import';
import { execFileSync } from 'node:child_process';
import { runLive, type LiveFlags } from './live.ts';
import { describedPng } from './wiki.ts';
import { decisionsCommand, withDecisionMarks, workspaceFiles } from './decisions.ts';
import type { Fetched } from '@cartography/import/node';
import { compare, explain, explainMarkdown, formatDiff, snapshotDir, snapshotPath, summary, type Comparison } from '@cartography/diff';
import { accessChanges, type AccessChange, type AccessSource } from '@cartography/access';
import { accessOf } from '@cartography/github';
import { parse as parseYaml, stringify as yamlText } from 'yaml';
import { repoPath, repoRoot, versionAt } from '@cartography/diff/node';
import { indexWorkspace, isDiagramFile, threatMarkdown } from '@cartography/core';
import { dynamicView, sequenceYaml, traceable, traceAsk, type TraceMeta } from '@cartography/trace';
import { healNotes, mergeNotes, noteLines, notesInView, notesMarkdown, notesPath, parseNotes, printNotes, resolveAnchor, type NotesFile } from '@cartography/core';
import { matchTypes, packLayout, sameLayoutNote, viewPins, withViewPins, type Diagnostic, type DiagramType, type LayoutSidecar } from '@cartography/core';

const helpAll = `carto — architecture diagrams that look good

  carto render <file.yaml…> [-o out] [--format svg|png|pptx|pdf] [--theme name|file.theme.yaml]
               [--pack azure] [--scale 2]           --theme wins over the diagram's theme:; -o x.pptx or x.pdf picks the format too
               [--icons official|lucide]        the vendor's official icons (carto icons import) or our line icons,
                                                whatever the diagram's icons: says
               [--view name | --all-views]      one of the diagram's views, or each to <file>-<view>.svg
               [--layer security | --all-layers] through one (or several) of its layers:, or each to <file>-<layer>.svg;
               [--dim]                          pptx and pdf: a slide (page) per layer. --dim fades the rest in place
               [--stable]                       note where things were drawn in <file>.layout.json, so the
                                                next render after an edit keeps them there
               [--step 3 | --all-steps]         the drawing at one of its steps:, or each to <file>-step-01.svg;
                                                pptx and pdf get a slide (page) per step by themselves
               [--svg-safe]                     an SVG that PowerPoint, Word and Keynote take whole: no CSS, no
                                                filters or markers, system fonts, one group per node and line
               [--outline-text]                 with --svg-safe: text as outlines in the theme's own font
               [--focus orders] [--hops 2]      only that element (an id, a group, tag:x, kind:x) and what is within
               [--upstream | --downstream]      so many lines of it (default 1, or all); what feeds it, or what it feeds
               [--notes]                        with the open review notes of <file>.notes.json: numbered markers
                                                and the notes under the drawing (pptx: in the speaker notes)
               [--decisions]                    with the architecture decisions of the folder (decisions/): a
                                                numbered page marker on what each is about, and a key and the
                                                decisions under the drawing (pptx: in the speaker notes)
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
  carto animate <file.yaml> -o out.gif|out.mp4|out.webm  its steps as an animation: each step held, a short blend
               [--view name] [--theme name]         to the next (what appears fades in, what goes fades out),
               [--layers | --walk "a -> b -> c"]    the caption as a lower third; --layers walks its layers
               [--hold 2.5] [--transition 0.5]      (the rest faded in place), --walk a route hop by hop;
               [--no-transitions] [--draw-lines]    --draw-lines draws new lines along their path;
               [--fps 30] [--size 1920x1080]        MP4 and WebM need ffmpeg on the PATH (without it: the GIF
               [--no-captions]                      and the frames as PNG). More: docs/animate.md
  carto watch  <file.yaml…> [same options]      re-render on every save (and when included files change)
  carto embed <file.yaml|-> [-o out.html]       a web page that carries everything: the drawing, zoom and drill-down
               [--view name] [--theme name]         --static: the drawing alone, no script; --fragment: only the
               [--static] [--fragment] [--css]      figure, for a page of your own, and --css: the stylesheet with it
  carto export-html <file.yaml|folder> [-o out.html]  one HTML file to send: every view and step drawn (light and
               [--notes] [--title "…"] [--all-steps]  dark), pan and zoom, presenter, drill-down, search, element
                                                details, print; works offline from disk. A file brings the
                                                diagrams it drills into; a folder gets a contents page.
                                                --notes: the open review notes too; --decisions: the folder's
                                                architecture decisions, as a page and in the details. More: docs/html-export.md
  carto describe <file.yaml> [-o out.md|.txt|.html]  the diagram in plain words: what it shows, its groups and
               [--view name | --all-views]      elements, connections in reading order, steps, layers, threats
               [--format text|md|html]          and key (sequence: the messages; ERD: tables and relations).
                                                The same words are in every SVG, PNG, PDF and slide. docs/describe.md
  carto export-md <file.yaml|folder> -o dir/    a Markdown page with each view as SVG and PNG, its description
               [--title "…"] [--no-steps]       under it and steps as sections; a folder gets README.md as its
                                                index. Links work on GitHub, GitLab and in Obsidian. docs/wiki-export.md
  carto export-confluence <file.yaml|folder> -o dir/  Confluence storage-format pages with their PNG and SVG
               [--title "…"] [--no-steps]       attachments, an HTML copy, manifest.json and a README on how to
                                                import them (REST API or by hand); nothing is sent anywhere
  carto threats <file.yaml> [-o threats.md]    the threat table (STRIDE threats, trust boundaries) as markdown;
               [--view name]                    --view: of one of a model's views. Drawn: carto render --view threats
  carto trace <file.yaml> --from a --to b       a request traced along the relations, as a sequence diagram:
               [--view v] [--all] [--pick n]    the shortest route (--all: every route, --pick: route n), with
               [--steps] [--dynamic] [-o x]     replies for calls; without --to, followed until each call ends;
                                                --steps: along the diagram's steps or a dynamic view; --dynamic:
                                                a C4 dynamic view to add to views: instead. More: docs/trace.md
  carto share <file.yaml> [--base URL]          a link that opens the diagram read-only in the web app; the diagram
                                                travels in the link's #fragment, never to a server (default base
                                                http://localhost:5178/)
  carto validate <file.yaml…|folder>            check files and each of their views, print problems (and review
                                                notes in <file>.notes.json whose element is gone); a folder also
                                                across files: dangling ref:/of:, one id with two kinds, elements
                                                that no diagram or view shows
               [--drift]                        also fail when <file>.layout.json pins, bends or locks things
                                                (or views) that are no longer in the diagram
               [--drift --fix]                  drop those entries from <file>.layout.json
  carto diff <before.yaml> <after.yaml>         what changed between two versions, by id: added, removed and
                                                changed nodes, groups and lines
  carto diff <old-folder> <new-folder>          two exports (access, GitHub or Azure; two Azure export files too) imported and compared; for access
                                                and GitHub also who gained and lost what, effective access, in words
               [-o diff.svg|diff.md] [--view access]  the picture, the words as markdown; --view access: the matrix
                                                with gained, lost and changed cells marked
  carto diff --git <ref> <file.yaml…>           the same against the file at a branch, tag or commit (includes too);
                                                --since <ref> says the same
  carto diff --snapshot <label> <file.yaml…>    against a snapshot the editor wrote next to it (<name>.snapshots/<label>.yaml)
               [-o diff.svg|diff.png|diff.md|folder]  also the picture (or, .md, the changes in plain sentences): the newer drawing with what was added and
                                                changed marked, what was removed as ghosts where it was, and a key
               [--side-by-side]                 the picture as before and after, each with its own marks
               [--json] [--view name] [--fresh] [--exit-code]
                                                --fresh lays the newer drawing out from scratch instead of keeping
                                                what was there in place; --exit-code exits 1 when something changed
  carto diff --live <k8s|azure|access|github> <saved.yaml>   drift: what changed in the cluster, the estate or
               [the --live options of carto import] [-o drift.png] [--exit-code]   the organisation since the
                                                diagram was saved (read live, as carto import --live does)
  carto notes <file.yaml…> [-o notes.md]       the review notes of <file>.notes.json as markdown, open ones
               [--open | --all]                 (default), or resolved ones too
  carto notes --merge-driver <base> <ours> <theirs>
                                                git's merge driver for notes files: merges two people's notes by
                                                thread; set up once, see docs/notes.md
  carto decisions [folder] [-o log.md]         the architecture decisions (decisions/, doc/adr, docs/adr, .adr-dir)
               [-o decisions.svg|png|pptx|pdf]  as a decision log in markdown, or drawn as the Decisions table
  carto decisions new "title" [--concerns a,b] [--supersedes 3] [--into folder]
                                                the next decision from the template (MADR with front matter);
                                                --supersedes marks that one superseded by it. More: docs/decisions.md
  carto new <type> [file.yaml]                  start from a template; no type: which to pick
  carto new --wizard <name> [file.yaml]         answer a few questions, get a finished diagram (Azure landing
               [--answers answers.json] [-y]    zone, AKS baseline, AWS, C4, data mesh, …); --wizard list
                                                names them; --answers or -y: no questions, the rest default
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
  carto import --live k8s [--context c] [--namespace n | --all-namespaces]
  carto import --live azure [--subscription s] [--rg r] [--with-access]
  carto import --live access [--subscription s]
  carto import --live github --org o           read live with your own kubectl, az or gh and its login, read-only:
               [--into diagram.yaml] [-o out|-]  the commands are shown and asked for first (--yes: not asked;
               [--yes] [--dry-run] [--timeout 120]  --dry-run: only shown); --into imports over a diagram, your
               [--keep-raw <dir>]               edits stay; --keep-raw saves the answers (no secret values,
                                                ever) for carto import <dir>. Allow-list: docs/live-import.md
  carto export <file.yaml…> -o out.drawio|.excalidraw|.mmd|.md
               [--format drawio|excalidraw|mermaid] [--view name] [--theme name]
                                                the drawing for another tool: draw.io (every view a page) and
                                                Excalidraw keep shapes, groups and attached lines where they are;
                                                Mermaid (.mmd, or .md as a fenced block) for a README on GitHub.
                                                What a format cannot hold is said on stderr. More: docs/interop.md
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
so the same YAML and layout file always give the same picture. More: docs/ci.md`;

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
  ['Draw', [
    ['render', 'a diagram to SVG, PNG, PowerPoint or PDF'],
    ['deck', 'several diagrams in one deck'],
    ['animate', 'steps or layers as a GIF, MP4 or WebM'],
    ['watch', 'render again on every save'],
    ['embed', 'a web page that carries the drawing'],
    ['export-html', 'one HTML file to send, every view inside'],
    ['export-md', 'Markdown pages with pictures, for a wiki or a repo'],
    ['export-confluence', 'Confluence pages with their attachments'],
    ['share', 'a link that opens the diagram in the web app'],
  ]],
  ['Check', [
    ['validate', 'check files and their views'],
    ['diff', 'what changed between two versions'],
    ['describe', 'the diagram in plain words'],
    ['threats', 'the threat table as markdown'],
    ['trace', 'a request through the architecture, as a sequence diagram'],
    ['notes', 'review notes as markdown'],
    ['decisions', 'architecture decisions: log, table, new'],
  ]],
  ['Start and convert', [
    ['new', 'start from a template'],
    ['types', 'which diagram type to pick'],
    ['import', 'Mermaid, draw.io, Excalidraw, Terraform, Azure, … to YAML'],
    ['blocks', 'reusable fragments: list, show, save and insert'],
    ['export', 'to draw.io, Excalidraw or Mermaid'],
  ]],
  ['Look', [
    ['themes', 'built-in themes'],
    ['icons', 'import and list vendor icon packs'],
  ]],
];
const commands = groups.flatMap(([, list]) => list.map(([c]) => c));

const help = `carto — architecture diagrams that look good

Usage: carto <command> [files…] [options]

${groups.map(([title, list]) => `${title}:\n${list.map(([c, what]) => `  ${c.padEnd(17)} ${what}`).join('\n')}`).join('\n\n')}

carto <command> --help   the options of one command
carto help all           every command with every option
- for a file (or -o -) is standard input or output; a drawing with errors is not written
Example: carto render shop.yaml -o shop.png`;

/** Help for one command, or the short help. */
const helpFor = (cmd?: string) => (cmd && usage.has(cmd) ? `${usage.get(cmd)}\n\nAll commands: carto --help` : help);

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

const parsed = (() => {
  try {
    return parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o' },
    format: { type: 'string', short: 'f', default: 'svg' },
    theme: { type: 'string', short: 't' },
    pack: { type: 'string', multiple: true },
    icons: { type: 'string' },
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
    layer: { type: 'string', multiple: true },
    'all-layers': { type: 'boolean' },
    layers: { type: 'boolean' },
    walk: { type: 'string' },
    hold: { type: 'string' },
    transition: { type: 'string' },
    'no-transitions': { type: 'boolean' },
    'draw-lines': { type: 'boolean' },
    fps: { type: 'string' },
    size: { type: 'string' },
    'no-captions': { type: 'boolean' },
    dim: { type: 'boolean' },
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
    snapshot: { type: 'string' },
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
    live: { type: 'string' },
    context: { type: 'string' },
    namespace: { type: 'string', short: 'n' },
    'all-namespaces': { type: 'boolean', short: 'A' },
    'with-access': { type: 'boolean' },
    org: { type: 'string' },
    into: { type: 'string' },
    select: { type: 'string' },
    param: { type: 'string', multiple: true },
    user: { type: 'boolean' },
    yes: { type: 'boolean', short: 'y' },
    from: { type: 'string' },
    to: { type: 'string' },
    pick: { type: 'string' },
    steps: { type: 'boolean' },
    dynamic: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    timeout: { type: 'string' },
    'keep-raw': { type: 'string' },
    wizard: { type: 'string' },
    answers: { type: 'string' },
    notes: { type: 'boolean' },
    decisions: { type: 'boolean' },
    concerns: { type: 'string' },
    supersedes: { type: 'string' },
    status: { type: 'string' },
    open: { type: 'boolean' },
    'merge-driver': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
    });
  } catch (e) {
    // An unknown or malformed option: one line and how to see the right ones.
    const cmd = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : undefined;
    console.error(`carto: ${(e as Error).message.split('\n')[0]!.replace(/\. To specify a positional.*$/, '')}\n${cmd && usage.has(cmd) ? `Options: carto ${cmd} --help` : 'Commands: carto --help'}`);
    process.exit(1);
  }
})();
const { positionals, values } = parsed;

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

/** The review notes next to a diagram; what cannot be read in them is said once. */
function notesFor(file: string): NotesFile | undefined {
  const p = notesPath(file);
  if (!fs.existsSync(p)) return undefined;
  const r = parseNotes(fs.readFileSync(p, 'utf8'));
  for (const m of r.problems) console.error(`${p}  ${yellow('warning')}  ${m}`);
  return r.notes;
}

/** A drawing with its review notes: markers and an appendix in SVG, PNG and PDF; speaker notes in PowerPoint. */
function annotated<T extends RenderResult>(r: T, notes: NotesFile | undefined): T & Pick<Drawing, 'remarks' | 'annotate'> {
  if (!notes || !r.graph || !r.placed) return r;
  const { graph, placed } = r;
  const theme = r.theme ?? themes.light;
  const decorate = (d: { svg: string; width: number; height: number; origin?: { x: number; y: number } }) => withReviewNotes(d, graph, placed, notes, theme, { view: r.view });
  const marked = r.svg && r.width && r.height ? decorate({ svg: r.svg, width: r.width, height: r.height, origin: r.origin }) : undefined;
  return { ...r, ...(marked ? { svg: marked.svg, width: marked.width, height: marked.height } : {}), remarks: noteLines(notes, graph, r.view), annotate: decorate };
}

/**
 * carto trace: a request through the architecture as a sequence diagram (docs/trace.md). Between
 * --from and --to the best route, every route with --all, route n with --pick; without --to the
 * calls followed until each ends; --steps along the diagram's story. --dynamic: a C4 dynamic view.
 */
async function traceCommand(): Promise<number> {
  const [f] = files;
  if (!f || (!values.from && !values.steps)) return (console.error(helpFor('trace')), 1);
  const t = await traceable(fs.readFileSync(f, 'utf8'), { load: loaderFor(f), file: path.basename(f), view: values.view });
  const errors = t.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) return (report(f, errors), 1);
  const pick = values.pick ? Number(values.pick) : undefined;
  if (pick !== undefined && !(Number.isInteger(pick) && pick >= 1)) throw new UsageError('--pick takes a route number: 1, 2, …');
  const r = traceAsk(t, { from: values.from, to: values.to, steps: values.steps, limit: values.all ? 20 : Math.max(5, pick ?? 0) });
  if (r.error) return (console.error(`${f}: ${r.error}`), 1);
  if (pick !== undefined && pick > r.options.length) return (console.error(`${f}: there ${r.options.length === 1 ? 'is 1 route' : `are ${r.options.length} routes`}, not ${pick}`), 1);
  const chosen = values.all ? r.options.map((o, i) => [o, i] as const) : [[r.options[(pick ?? 1) - 1]!, (pick ?? 1) - 1] as const];
  // The sequence names the traced file relative to where it is written.
  const out = values.out && values.out !== '-' ? values.out : undefined;
  const rel = path.relative(out ? path.dirname(path.resolve(out)) : process.cwd(), path.resolve(f)).split(path.sep).join('/');
  const ask = [`carto trace ${f}`, ...(values.view ? [`--view ${values.view}`] : []), ...(values.steps ? ['--steps'] : [`--from ${r.from}`, ...(r.to ? [`--to ${r.to}`] : [])])].join(' ');
  if (r.options.length > 1 && !values.all) {
    console.error(`${r.options.length} routes${pick ? `, route ${pick}` : ', the first'}:`);
    r.options.forEach((o, i) => console.error(`  ${i + 1}. ${o.summary}`));
  }
  const texts = chosen.map(([o, i]) => {
    const meta: TraceMeta = { file: rel, ...(t.view ? { view: t.view } : {}), mode: r.mode, from: r.from, to: r.to, pick: { n: i + 1, of: r.options.length }, command: `${ask}${r.options.length > 1 ? ` --pick ${i + 1}` : ''}` };
    if (!values.dynamic) return sequenceYaml(t.graph, o, meta);
    const d = dynamicView(t.graph, o, meta);
    if (!d) throw new UsageError(`${f} has no model: a dynamic view needs model elements (elements:, or include: of a model)`);
    return d.yaml;
  });
  if (!out) process.stdout.write(texts.join('---\n'));
  else
    texts.forEach((text, i) => {
      const name = i ? out.replace(/(\.ya?ml)?$/, (ext) => `-${i + 1}${ext || '.yaml'}`) : out;
      fs.writeFileSync(name, text);
      console.error(`${f} → ${name}  ${dim(chosen[i]![0].summary)}`);
    });
  return 0;
}

/** carto notes: the threads as markdown; --merge-driver: git's three-way merge of a notes file. */
async function notesCommand(): Promise<number> {
  if (values['merge-driver']) {
    const [base, ours, theirs] = files;
    if (!base || !ours || !theirs) return (console.error(helpFor('notes')), 1);
    const read = (f: string) => parseNotes(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
    const [b, o, t] = [read(base), read(ours), read(theirs)];
    // A side that is not a notes file is not merged by guessing: git keeps the conflict.
    if ([o, t].some((x) => x.problems.some((p) => p.startsWith('not valid') || p.startsWith('no "threads"')))) return (console.error(`carto notes: ${ours} or ${theirs} is not a notes file`), 1);
    fs.writeFileSync(ours, printNotes(mergeNotes(b.notes, o.notes, t.notes)) ?? '{\n  "version": 1,\n  "threads": []\n}\n');
    return 0;
  }
  if (!files.length) return (console.error(helpFor('notes')), 1);
  const parts: string[] = [];
  let ok = true;
  for (const f of files) {
    const notes = notesFor(f);
    if (!notes) {
      console.error(`${f}: no review notes (${notesPath(f)} is not there)`);
      continue;
    }
    const { graph, views } = await graphsFor(f, notes);
    if (!graph) ok = false;
    parts.push(notesMarkdown(notes, { graph, views, title: graph?.title ?? path.basename(f), all: !!values.all && !values.open }));
  }
  const md = parts.join('\n');
  if (!values.out || values.out === '-') process.stdout.write(md);
  else if (md) {
    fs.writeFileSync(values.out, md);
    console.error(`${files.join(', ')} → ${values.out}`);
  }
  return ok ? 0 : 1;
}

/** The drawing of a diagram and of each view its notes were written in: what their anchors are looked up in. */
async function graphsFor(file: string, notes: NotesFile): Promise<{ graph?: RenderResult['graph']; views: Record<string, NonNullable<RenderResult['graph']>> }> {
  const text = fs.readFileSync(file, 'utf8');
  const opts = { fonts: 'none' as const, load: loaderFor(file), file: path.basename(file) };
  const first = await render(text, opts);
  const views: Record<string, NonNullable<RenderResult['graph']>> = {};
  for (const v of new Set(notes.threads.map((t) => t.view).filter((x): x is string => !!x))) {
    const r = await render(text, { ...opts, view: v });
    if (r.graph && r.view === v) views[v] = r.graph;
  }
  return { graph: first.graph, views };
}

/** carto validate: notes whose element is gone, said as a warning each (they are kept, with what they were about). */
async function checkNotes(file: string): Promise<void> {
  const notes = notesFor(file);
  if (!notes?.threads.length) return;
  const { graph, views } = await graphsFor(file, notes);
  if (!graph) return;
  const p = notesPath(file);
  for (const t of notes.threads) {
    const g = t.view ? views[t.view] : graph;
    if (t.view && !g) {
      console.error(`${p}  ${yellow('warning')}  note ${t.id} is in view "${t.view}", which the diagram no longer has`);
      continue;
    }
    const r = resolveAnchor(t.anchor, g!);
    if (r.state === 'orphaned') console.error(`${p}  ${yellow('warning')}  note ${t.id} (${t.status}) is about "${r.was}", which is no longer in the diagram${t.view ? ` (view ${t.view})` : ''}`);
  }
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
  // -o is a folder when it ends in / or has no extension; a file name for several pictures is a mistake,
  // not a folder named x.png.
  const folder = values.out.endsWith('/') || values.out.endsWith(path.sep) || !path.extname(values.out);
  // A deck holds every layer on a slide of its own: one file.
  const perLayer = values['all-layers'] && format !== 'pptx' && format !== 'pdf';
  if (!folder && (files.length > 1 || values['all-views'] || perLayer))
    throw new UsageError(`-o ${values.out} names one file, but ${values['all-views'] ? '--all-views writes one per view' : perLayer ? '--all-layers writes one per layer' : 'several diagrams make several files'}: give a folder, e.g. -o ${path.join(path.dirname(values.out), path.basename(values.out, path.extname(values.out)))}/`);
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
    iconsOverride: iconsFlag(),
    fonts,
    file: path.basename(file),
    view: values.view,
    step: values.step ? Number(values.step) || 1 : undefined,
    focus: focusFlag(),
    ...(values.layer?.length ? { layers: values.layer.flatMap((l) => l.split(',')).map((l) => l.trim()).filter(Boolean) } : {}),
    ...(values.dim ? { layerMode: 'dim' as const } : {}),
  };
}

/** --icons official|lucide; anything else is a usage error. */
function iconsFlag(): RenderOptions['iconsOverride'] {
  const v = values.icons;
  if (v == null) return undefined;
  if (v === 'official' || v === 'lucide') return v;
  throw new UsageError(`--icons is official or lucide, not "${v}"`);
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
  const views = values['all-views'] && first.views?.length ? await Promise.all(first.views.map((v) => render(text, { ...opts, view: v.name }))) : [];
  // A view with nothing in it is no picture: said, not written.
  for (const v of views) if (v.empty) console.error(`${shown}#${v.view}  ${dim('empty: nothing to draw, not written')}`);
  // --all-layers: the drawing as a whole, then through each of its layers as <file>-<layer>.svg (a slide each in a deck).
  if (values['all-layers'] && !first.layers?.list.length) console.error(`${shown}  ${yellow('warning')}  --all-layers: this diagram has no layers: (see docs/layers.md)`);
  const layered = values['all-layers'] ? await Promise.all((first.layers?.list ?? []).map((l) => render(text, { ...opts, layers: l.name }))) : [];
  for (const [i, l] of layered.entries()) if (l.empty || !l.layers?.kept) console.error(`${shown}@${first.layers!.list[i]!.name}  ${dim('nothing on this layer, not written')}`);
  const runs = [first, ...views.filter((v) => !v.empty), ...layered.filter((l) => !l.empty && l.layers?.kept)];
  /** What a run is called in messages and file names: its view, or its layers. */
  const named = (r: RenderResult, i: number) => (i && layered.includes(r) ? [r.view, r.layers!.active.join('+')].filter(Boolean).join('-') : i ? r.view : values.view);
  if (values['all-layers'] && (format === 'pptx' || format === 'pdf')) {
    const drawn = runs.filter((r) => r.svg && !r.diagnostics.some((d) => d.severity === 'error'));
    for (const r of runs) report(r === first ? shown : `${shown}@${named(r, runs.indexOf(r))}`, r === first ? r.diagnostics : r.diagnostics.filter((d) => !first.diagnostics.some((f) => f.message === d.message)));
    if (!drawn.length) return false;
    const out = values.out === '-' ? '-' : outputPath(file, format, values.view);
    // A layer is one slide (its steps are the whole drawing's story, told on its own slides), unless every step is asked for.
    const data = await document(format, drawn.map((r) => ({ ...r, name: path.basename(file), ...(r !== first && !values['all-steps'] ? { steps: undefined } : {}) })), first.theme);
    if (out === '-') process.stdout.write(data);
    else fs.writeFileSync(out, data);
    console.log(`${shown} → ${out === '-' ? 'standard output' : out} ${dim(`${drawn.length} drawings: the whole and ${drawn.length - 1} ${drawn.length === 2 ? 'layer' : 'layers'}`)}`);
    if (values.stable) noteLayout(file, runs);
    return drawn.length === runs.length;
  }
  const notes = values.notes ? notesFor(file) : undefined;
  if (values.notes && !notes) console.error(`${shown}  ${yellow('warning')}  --notes: there is no ${notesPath(file)}`);
  let ok = true;
  const stdout = values.out === '-' || (shown === 'stdin' && !values.out);
  for (const [i, result] of runs.entries()) {
    const view = named(result, i);
    report(view && i ? `${shown}${layered.includes(result) ? '@' : '#'}${view}` : shown, i && !values.view ? result.diagnostics.filter((d) => !first.diagnostics.some((f) => f.message === d.message)) : result.diagnostics);
    if (!result.svg) {
      ok = false;
      continue;
    }
    if ((values.step || (values['all-steps'] && !values['all-views'])) && !result.steps) console.error(`${shown}${view ? `#${view}` : ''}  ${yellow('warning')}  no steps here: drawn as a whole`);
    // --all-steps: an image per step, numbered; a pptx or pdf holds them all in one file.
    const each = values['all-steps'] && result.steps && (format === 'svg' || format === 'png');
    const plain = each ? await Promise.all(result.steps!.map((_, n) => render(text, { ...opts, view: result.view ?? opts.view, ...(layered.includes(result) ? { layers: result.layers!.active } : {}), step: n + 1 }))) : [result];
    const shots = plain.map((r) => (values.decisions ? withDecisionMarks(annotated(r, notes), file) : annotated(r, notes)));
    if (stdout && runs.length + shots.length > 2) throw new UsageError('-o - writes one picture to standard output: give a folder for --all-views or --all-steps');
    // A drawing with errors is not what was asked for: nothing is written, the errors say why.
    if (result.diagnostics.some((d) => d.severity === 'error')) {
      console.error(`${shown}${view ? `#${view}` : ''}  ${red('error')}  nothing written`);
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
        : await document(format, [{ ...shot, name: path.basename(file) }], shot.theme);
      if (stdout) process.stdout.write(data);
      else fs.writeFileSync(out, data);
      (stdout ? console.error : console.log)(`${shown}${view ? `${layered.includes(result) ? '@' : '#'}${view}` : ''}${shot.step ? ` step ${shot.step}` : ''} → ${stdout ? 'standard output' : out} ${dim(`${shot.width}×${shot.height}`)}`);
    }
  }
  if (values.stable) noteLayout(file, runs);
  return ok;
}

/** carto animate: one diagram's steps, layers or a walk as a GIF, MP4 or WebM. */
async function animateFile(file: string): Promise<boolean> {
  const { animate, sizeFlag } = await import('./animate.ts');
  const num = (name: string, v: string | undefined, min: number, max: number) => {
    if (v == null) return undefined;
    const n = Number(v);
    if (!(n >= min && n <= max)) throw new UsageError(`--${name} is a number from ${min} to ${max}, not "${v}"`);
    return n;
  };
  const warn = (s: string) => console.error(`${file}  ${yellow('warning')}  ${s}`);
  const opts = optionsFor(file, 'none');
  let width: number | undefined;
  try {
    width = sizeFlag(values.size, warn);
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
  return animate(
    fs.readFileSync(file, 'utf8'),
    opts,
    {
      out: values.out!,
      layers: values.layers,
      walk: values.walk,
      hold: num('hold', values.hold, 0.2, 60),
      transition: values['no-transitions'] ? 0 : num('transition', values.transition, 0, 5),
      fps: num('fps', values.fps, 5, 60),
      width,
      drawLines: values['draw-lines'],
      captions: !values['no-captions'],
    },
    file,
    {
      info: (s) => console.log(s),
      warn,
      error: (s) => console.error(`${file}  ${red('error')}  ${s}`),
      diagnostics: (r) => report(file, r.diagnostics),
    },
  );
}

/** carto validate <folder>: what only shows across files (a ref: to nothing, one id two kinds, elements no view shows). */
function validateWorkspace(dir: string): boolean {
  // Diagrams, and the decisions folder with what says where it is (decisions concern elements by id).
  const files = workspaceFiles(dir);
  const ix = indexWorkspace(files);
  for (const p of ix.problems) console.error(`${path.join(dir, p.file)}${p.line ? `:${p.line}` : ''}  ${p.severity === 'error' ? red('error') : yellow('warning')}  ${p.message}`);
  const n = ix.files.size;
  if (!ix.problems.length) console.log(`${dir} ${dim(`workspace ok: ${n} diagram${n === 1 ? '' : 's'}, ${ix.elements.size} element${ix.elements.size === 1 ? '' : 's'}`)}`);
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
  // --since <ref> reads as "what changed since": the same as --git.
  const ref = values.git ?? values.since;
  const snap = values.snapshot;
  if (values.live) {
    if (files.length !== 1) return (console.error('One saved diagram: carto diff --live <source> <saved.yaml>'), 1);
    if (!fs.existsSync(files[0]!)) return (console.error(`${files[0]}  ${red('error')}  not found`), 1);
  } else if (ref || snap ? !files.length : files.length !== 2)
    return (console.error(ref ? 'Name the diagrams: carto diff --git <ref> <file.yaml…>' : snap ? 'Name the diagrams: carto diff --snapshot <label> <file.yaml…>' : 'Two files: carto diff <before.yaml> <after.yaml>, carto diff --git <ref> <file.yaml…> or carto diff --snapshot <label> <file.yaml…>'), 1);
  if (snap) {
    // A snapshot that is not there: say which there are.
    const missing = files.filter((f) => !fs.existsSync(snapshotPath(f, snap)));
    for (const f of missing) {
      const dir = snapshotDir(f);
      const there = fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => /\.ya?ml$/i.test(x)).map((x) => x.replace(/\.ya?ml$/i, '')) : [];
      console.error(`${f}  ${red('error')}  no snapshot "${snap}" (${snapshotPath(f, snap)})${there.length ? `; there are: ${there.join(', ')}` : '; take one in the editor with ⇧⌘S'}`);
    }
    if (missing.length) return 1;
  }
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
  const folders = !ref && !values.live && files.every((f) => isFolder(f) || (/\.json$/i.test(f) && fs.existsSync(f) && exportKind([f]) === 'azure'));
  if (folders) {
    const kind = exportKind([files[1]!]) ?? exportKind([files[0]!]);
    if (!kind) return (console.error(`Neither ${files[0]} nor ${files[1]} holds access exports, gh api responses or Azure resources`), 1);
    const before = exportOf([files[0]!], kind, undefined, 'fresh');
    const after = exportOf([files[1]!], kind, undefined, 'fresh', before?.yaml);
    if (!before || !after) return 1;
    exported = { before: before.yaml, after: after.yaml };
  }
  let live: { name: string; yaml: string } | undefined;
  if (values.live) {
    const got = await runLive(values.live, liveFlags());
    if (!got) return values['dry-run'] ? 0 : 1;
    // Imported over the saved diagram: ids stay and what was drawn by hand is not drift.
    const r = liveImport(got[0]!, disk(files[0]!));
    if (!r) return 1;
    live = { name: `live ${values.live}`, yaml: r.yaml };
  }
  const pairs = live
    ? [{ name: live.name, against: path.basename(files[0]!), before: disk(files[0]!), beforeOptions: optionsFor(files[0]!, fonts), after: live.yaml, afterFile: files[0]! }]
    : snap
    ? files.map((f) => {
        const file = snapshotPath(f, snap);
        // Read as the diagram itself would be: includes from beside it, pins from beside the snapshot.
        return { name: f, against: `snapshot ${snap}`, before: disk(file), beforeOptions: { ...optionsFor(f, fonts), sidecar: sidecarFor(file) }, after: disk(f), afterFile: f };
      })
    : folders
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
    if (values.json) json.push({ file: p.name, ...(values.view ? { view: values.view } : {}), against: p.against, ...(state ? { state } : {}), summary: summary(c.diff), explained: explain(c.diff, c.before?.graph, c.after?.graph).map((x) => x.text), ...c.diff, ...(changes ? { access: changes } : {}) });
    else {
      // With -o - the picture or the text is standard output: the summary goes to stderr.
      const say = values.out === '-' ? console.error : console.log;
      say(`${bold(p.name)}${values.view ? `#${values.view}` : ''} ${dim(`against ${p.against}`)}: ${state ? `${state}, ` : ''}${summary(c.diff)}`);
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

function liveFlags(): LiveFlags {
  const timeout = values.timeout === undefined ? undefined : Number(values.timeout);
  if (timeout !== undefined && !(timeout > 0)) throw new UsageError(`--timeout takes seconds, not "${values.timeout}"`);
  return { context: values.context, namespace: values.namespace, allNamespaces: values['all-namespaces'], subscription: values.subscription, rg: values.rg, org: values.org, withAccess: values['with-access'], yes: values.yes, dryRun: values['dry-run'], timeout, keepRaw: values['keep-raw'] };
}

/** What a live source answered, imported (over `was` when given): the diagram, what it holds, and whether nothing went wrong. */
function liveImport(f: Fetched, was: string | undefined): { yaml: string; summary: string; clean: boolean } | undefined {
  const where = `live ${f.kind}`;
  if (f.kind === 'kubernetes') {
    const r = importKubernetes(f.files.map((x) => x.text).join('\n---\n'), values.title ?? f.title ?? 'Kubernetes', { existing: was });
    for (const w of r.warnings) console.error(`${where}  ${yellow('warning')}  ${w}`);
    if (!r.yaml) return undefined;
    const n = Object.keys((parseYaml(r.yaml) as { nodes?: object } | null)?.nodes ?? {}).length;
    return { yaml: r.yaml, summary: `${n} cards${was ? ', what was added by hand kept' : ''}`, clean: !r.warnings.some((w) => /not changed$/.test(w)) };
  }
  const opts = exportOptions();
  if (typeof opts === 'string') return (console.error(opts), undefined);
  const r = f.kind === 'azure' ? importAzure(f.files, { ...(opts as Parameters<typeof importAzure>[1]), existing: was }) : f.kind === 'github' ? importGithub(f.files, { ...opts, existing: was }) : importAccess(f.files, { ...opts, existing: was });
  for (const p of r.problems) console.error(`${where}${p.file ? ` ${p.file}` : ''}  ${p.severity === 'error' ? red('error') : yellow('warning')}  ${p.message}`);
  for (const w of r.warnings) console.error(`${where}  ${yellow('warning')}  ${w}`);
  if (!r.yaml) return undefined;
  return { yaml: r.yaml, summary: `${r.summary}${was ? ', what was added by hand kept' : ''}`, clean: !r.problems.some((p) => p.severity === 'error') };
}

/** carto import --live <source>: the user's own kubectl, az or gh, read-only; --into imports over a diagram, its hand edits kept. */
async function importLive(): Promise<boolean> {
  const into = values.into;
  if (into && !fs.existsSync(into)) return (console.error(`${into}  ${red('error')}  not found: leave out --into to start a new diagram`), false);
  const stdout = values.out === '-';
  const name = (f: Fetched) => `${f.kind === 'kubernetes' ? (f.title ?? 'kubernetes').replace(/[^\w.-]+/g, '-') : f.kind === 'github' ? (f.title ?? 'github') : f.kind}.yaml`;
  // Plan the files before anything runs: an existing one is only written over with --into or --force.
  const first = into && !values.out ? into : values.out && !stdout && path.extname(values.out) ? values.out : undefined;
  if (first && first !== into && fs.existsSync(first) && !values.force) return (console.error(`${first} already exists: --into ${first} imports over it (your edits stay), --force starts it over`), false);
  const got = await runLive(values.live!, liveFlags());
  if (!got) return !!values['dry-run'];
  let ok = true;
  for (const [i, f] of got.entries()) {
    // The access diagram that --with-access adds goes next to the first: azure.yaml, azure-access.yaml.
    const main = first ?? path.join(values.out && !stdout ? values.out : '.', name(got[0]!));
    const out = i === 0 ? main : main.replace(/(\.ya?ml)?$/i, (ext) => `-access${ext || '.yaml'}`);
    if (!first && !stdout && fs.existsSync(out) && !values.force) {
      console.error(`${out} already exists: --into ${out} imports over it (your edits stay), --force starts it over`);
      ok = false;
      continue;
    }
    const over = into && (i === 0 || fs.existsSync(out)) && !values.force ? fs.readFileSync(i === 0 ? into : out, 'utf8') : undefined;
    const r = liveImport(f, over);
    if (!r) {
      ok = false;
      continue;
    }
    const check = await render(r.yaml, { fonts: 'none', load: loaderFor(out) });
    report(`live ${values.live} (imported)`, check.diagnostics);
    if (stdout) {
      process.stdout.write((i ? '---\n' : '') + r.yaml);
      continue;
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, r.yaml);
    console.log(`live ${values.live} → ${out} ${dim(r.summary)}`);
    ok = r.clean && !check.diagnostics.some((d) => d.severity === 'error') && ok;
  }
  return ok;
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
    const name = blocks.length > 1 && i > 0 ? `${base}-${part && blocks.filter((x) => x.name === b.name).length === 1 ? part : i + 1}.yaml` : `${base}.yaml`;
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

/** Writes a file, or standard output for `-`. */
const put = (out: string, data: string | Uint8Array) => (out === '-' ? process.stdout.write(data) : fs.writeFileSync(out, data));

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
    if (values.out === '-') return '-';
    const base = path.basename(file).replace(/\.ya?ml$/, '') + (view ? `-${view}` : '') + '.' + outExt;
    if (!values.out) return path.join(path.dirname(file), base);
    if (files.length === 1 && !view && path.extname(values.out)) return (fs.mkdirSync(path.dirname(values.out), { recursive: true }), values.out);
    fs.mkdirSync(values.out, { recursive: true });
    return path.join(values.out, base);
  };
  // draw.io has pages: every view goes into the one file. The others hold one drawing: the view asked
  // for, or with --all-views a file per view.
  const each = !values.view && first.views?.length && (format === 'drawio' || values['all-views']) ? first.views.map((v) => v.name) : undefined;
  if (values.out === '-' && each && format !== 'drawio') throw new UsageError('-o - writes one drawing to standard output: give a folder for --all-views');
  const drawn: RenderResult[] = each ? (await Promise.all(each.map((v) => render(text, { ...opts, view: v })))).filter((r) => !r.empty) : [first];
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
    put(out, toDrawio(scenes));
    (out === '-' ? console.error : console.log)(`${file} → ${out} ${dim(scenes.length > 1 ? `${scenes.length} pages` : `${scenes[0]!.elements.length} shapes, ${scenes[0]!.connectors.length} connectors`)}`);
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
      put(out, toExcalidraw(scene));
      (out === '-' ? console.error : console.log)(`${file}${view ? `#${view}` : ''} → ${out} ${dim(`${scene.elements.length} shapes, ${scene.connectors.length} arrows`)}`);
    } else {
      const m = toMermaid(r);
      warn(view, m.warnings);
      put(out, format === 'md' ? mermaidBlock(m.text) : m.text);
      (out === '-' ? console.error : console.log)(`${file}${view ? `#${view}` : ''} → ${out} ${dim(m.kind)}`);
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
      console.log(`${'light, dark'.padEnd(14)} ${dim('— other names for survey and survey-dark')}`);
      console.log(dim('Or a file: theme: ./client.theme.yaml (see docs/themes.md and docs/style.md)'));
      return 0;
    case 'icons': {
      const [sub, a, ...more] = files;
      const fail = (e: unknown) => (console.error(`${red('error')}  ${(e as Error).message}`), 1);
      if (!sub || isVendor(sub)) return (console.log(iconGuide(sub)), 0);
      if (sub === 'list') {
        const packs = listPacks();
        if (!packs.length) console.log(`No icon packs yet. Where to get them: carto icons`);
        for (const p of packs) {
          const cov = coverage(p, coverageKinds(p.name));
          console.log(`${p.name.padEnd(12)} ${cov.have} of ${cov.of} kinds${p.manual && Object.keys(p.manual).length ? `, ${Object.keys(p.manual).length} by hand` : ''} ${dim(`imported ${p.imported ?? '?'} ← ${p.source ?? '?'}`)}`);
        }
        return 0;
      }
      if (sub === 'import') {
        if (!a) return (console.error(helpFor(command)), 1);
        try {
          const r = importIcons(a, values.pack?.[0]);
          const name = r.pack.name;
          console.log(`${a} → ${r.dir}\n  ${r.files} SVG files; ${r.coverage.have} of ${r.coverage.of} ${name} kinds have an icon${r.kept.length ? ` (${r.kept.length} mapped by hand before, kept)` : ''}`);
          if (r.coverage.missing.length) console.log(dim(`  no icon yet: ${r.coverage.missing.join(', ')}\n  give one by hand: carto icons map ${name} <kind> <words>; see all: carto icons show ${name} -o ${name}.png`));
          console.log(dim(`  use it: icons: official in the diagram, or carto render diagram.yaml --icons official`));
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
            console.log(`${a}: ${cov.have} of ${cov.of} kinds → ${values.out}`);
          } else {
            const pack = readPack(a)!;
            for (const k of coverageKinds(a)) console.log(`${k.kind.padEnd(24)} ${pack.icons[k.kind] ? pack.icons[k.kind] + (pack.manual?.[k.kind] ? dim('  (by hand)') : '') : dim('—')}`);
            console.log(`\n${cov.have} of ${cov.of} kinds have an icon`);
          }
          return 0;
        }
        if (sub === 'find') {
          const hits = findIcons(a, more.join(' '));
          for (const h of hits.slice(0, 30)) console.log(`${h.name.padEnd(40)} ${dim(h.file)}`);
          if (!hits.length) console.log(`Nothing in ${a} called "${more.join(' ')}"`);
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
          console.log(`${a}: ${kind} draws its line icon again`);
          return 0;
        }
      } catch (e) {
        return fail(e);
      }
      return (console.error(helpFor(command)), 1);
    }
    case 'new': {
      if (values.wizard) {
        const { newFromWizard } = await import('./wizard.ts');
        return newFromWizard(values.wizard, files[0] === '-' ? undefined : files[0], { answers: values.answers, yes: values.yes });
      }
      const [id, target] = files;
      // Without a type, help picking one instead of an error.
      if (!id) return (typeGuide(), 0);
      const type = findType(id);
      if (!type) {
        console.error(`Unknown type "${id ?? ''}". Types: ${types.map((t) => t.id).join(', ')}`);
        return 1;
      }
      // `-` is standard output, as everywhere a file is named.
      if (!target || target === '-') {
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
      if (!f) return (console.error(helpFor(command)), 1);
      const r = await embed(f, { view: values.view, theme: values.theme, title: values.title, fragment: values.fragment, static: values.static, icons: iconsFlag() });
      report(f === '-' ? 'stdin' : f, r.problems);
      // A fragment, or a page made from standard input, goes to standard output unless -o says where.
      // With errors a fragment is still written: it is the message a reader of the page should see.
      const out = values.out === '-' ? undefined : values.out ?? (values.fragment || f === '-' ? undefined : f.replace(/\.ya?ml$/i, '') + '.html');
      if (!out) process.stdout.write(r.html);
      else if (r.ok || values.fragment) fs.writeFileSync(out, r.html);
      if (out && r.ok) console.error(`${f} → ${out}`);
      return r.ok ? 0 : 1;
    }
    case 'export-html': {
      const [f] = files;
      if (!f || files.length > 1) return (console.error(helpFor(command)), 1);
      if (!fs.existsSync(f)) return (console.error(`${f}: no such file or folder`), 1);
      if (!themeFlag()) return 1;
      const { exportHtmlFile } = await import('./html-export.ts');
      const r = await exportHtmlFile(f, values.out, { title: values.title, notes: values.notes, decisions: values.decisions, allSteps: values['all-steps'], render: { themeOverride: forced, packs: values.pack, pack: readPack, iconsOverride: iconsFlag(), fontScale } });
      for (const p of r.problems) console.error(`${path.join(r.root, p.file)}${p.line ? `:${p.line}` : ''}  ${red('error')}  ${p.message}`);
      if (!r.stats.drawings) return (console.error(`${f}: nothing to draw`), 1);
      const s = r.stats;
      console.log(`${f} → ${r.file} ${dim(`${s.drawings} drawing${s.drawings === 1 ? '' : 's'}${s.steps ? `, ${s.steps} steps` : ''}, ${s.elements} elements, ${(s.bytes / 1024).toFixed(0)} kB`)}`);
      return r.problems.length ? 1 : 0;
    }
    case 'describe': {
      const [f] = files;
      if (!f || files.length > 1) return (console.error(helpFor(command)), 1);
      if (!fs.existsSync(f)) return (console.error(`${f}: no such file`), 1);
      const ext = values.out && values.out !== '-' ? path.extname(values.out).slice(1).toLowerCase() : '';
      const asked = values.format === 'markdown' ? 'md' : values.format;
      const format = asked === 'text' || asked === 'md' || asked === 'html' ? asked : ext === 'md' || ext === 'markdown' ? 'md' : ext === 'html' || ext === 'htm' ? 'html' : 'text';
      const { describeFile } = await import('./wiki.ts');
      const r = await describeFile(f, { view: values.view, allViews: values['all-views'], format, options: optionsFor(f, 'none') });
      for (const p of r.problems) console.error(`${f}  ${red('error')}  ${p}`);
      if (!r.ok) return 1;
      if (!values.out || values.out === '-') process.stdout.write(r.text);
      else {
        fs.mkdirSync(path.dirname(path.resolve(values.out)), { recursive: true });
        fs.writeFileSync(values.out, r.text);
        console.error(`${f} → ${values.out}`);
      }
      return 0;
    }
    case 'export-md':
    case 'export-confluence': {
      const [f] = files;
      if (!f || files.length > 1 || !values.out || values.out === '-') return (console.error(helpFor(command)), 1);
      if (!fs.existsSync(f)) return (console.error(`${f}: no such file or folder`), 1);
      if (!themeFlag()) return 1;
      const wiki = await import('./wiki.ts');
      const flags = {
        options: (file: string) => optionsFor(file, 'embed'),
        png: async (svg: string, r: RenderResult) => toPng(svg, Number(values.scale) || 2, await ttfFiles(r.theme?.font.faces ?? [])),
        steps: !values['no-steps'],
        title: values.title,
      };
      const r = await (command === 'export-md' ? wiki.exportMarkdown : wiki.exportConfluence)(f, values.out, flags);
      for (const p of r.pages) for (const m of p.problems) console.error(`${path.join(fs.statSync(f).isDirectory() ? f : path.dirname(f), p.file)}  ${red('error')}  ${m}`);
      const made = r.pages.filter((p) => p.out);
      const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
      if (!made.length) return (console.error(`${f}: nothing to draw`), 1);
      console.log(`${f} → ${values.out} ${dim(`${plural(made.length, 'page')}, ${plural(made.reduce((n, p) => n + p.drawings, 0), 'drawing')}, ${r.written.length} files`)}`);
      return made.length === r.pages.length ? 0 : 1;
    }
    case 'threats': {
      const [f] = files;
      if (!f) return (console.error(helpFor(command)), 1);
      const r = await render(fs.readFileSync(f, 'utf8'), { fonts: 'none', load: loaderFor(f), file: path.basename(f), view: values.view });
      report(f, r.diagnostics);
      if (!r.graph) return 1;
      if (!r.graph.threats) {
        console.error(`${f}: no threat model here: add trust: to a group, or threats: to an element or line (docs/threats.md)`);
        return 1;
      }
      const md = threatMarkdown(r.graph);
      if (!values.out || values.out === '-') process.stdout.write(md);
      else {
        fs.writeFileSync(values.out, md);
        console.error(`${f} → ${values.out}  ${dim(`${r.graph.threats.length} threats`)}`);
      }
      return r.diagnostics.some((d) => d.severity === 'error') ? 1 : 0;
    }
    case 'trace':
      return traceCommand();
    case 'share': {
      const [f] = files;
      if (!f) return (console.error(helpFor(command)), 1);
      const { shareLink, SHARE_LIMIT } = await import('@cartography/core');
      const link = await shareLink({ yaml: fs.readFileSync(f, 'utf8'), name: path.basename(f), layout: sidecarFor(f) }, values.base ?? 'http://localhost:5178/');
      if (link.length > SHARE_LIMIT) {
        console.error(`${f}: the link would be ${Math.ceil(link.length / 1000)} kB, over the ${SHARE_LIMIT / 1000} kB a link can safely carry. Share the file itself instead.`);
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
        const opts = { fonts: 'none' as const, load: loaderFor(f), file: path.basename(f) };
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
        await checkNotes(f);
        const drifted = values.drift && !(await checkDrift(f));
        if (diagnostics.some((d) => d.severity === 'error') || drifted) ok = false;
        else console.log(`${f} ${dim('ok')}`);
      }
      for (const dir of folders) ok = validateWorkspace(dir) && ok;
      return ok ? 0 : 1;
    }
    case 'notes':
      return notesCommand();
    case 'decisions':
      if (!themeFlag()) return 1;
      return decisionsCommand({
        args: files,
        out: values.out,
        concerns: values.concerns,
        supersedes: values.supersedes,
        into: values.into,
        title: values.title,
        status: values.status,
        render: { themeOverride: forced, fontScale, fonts: values.out?.endsWith('.svg') ? 'embed' : 'none' },
        write: async (r, out) => {
          const format = formatFor();
          const data = format === 'png' ? toPng(r.svg!, Number(values.scale) || 2, await ttfFiles(r.theme?.font.faces ?? [])) : format === 'svg' ? r.svg! : await document(format, [{ ...r, name: 'decisions' } as Drawing], r.theme);
          fs.writeFileSync(out, data);
        },
      });
    case 'diff':
      if (!themeFlag()) return 1;
      return diffFiles();
    case 'import': {
      if (values.git) return (await importGit(values.git)) ? 0 : 1;
      if (values.live) return files.length ? (console.error('carto import --live reads from the tool, not from files: --into <diagram.yaml> imports over one'), 1) : (await importLive()) ? 0 : 1;
      if (!files.length) return (console.error(helpFor(command)), 1);
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
      if (!files.length) return (console.error(helpFor(command)), 1);
      if (!themeFlag()) return 1;
      let ok = true;
      if (values.write && !(files.length === 1 && (isFolder(files[0]!) || exportKind([files[0]!]) === 'azure'))) return (console.error('--write keeps the diagram of one folder of exports or data product files: carto render <folder> --write mesh.yaml'), 1);
      for (const f of files) {
        const kind = isFolder(f) && !dataFiles(f).some((x) => isDataMeshFile(fs.readFileSync(x, 'utf8'))) ? exportKind([f]) : /\.json$/i.test(f) && exportKind([f]) === 'azure' ? 'azure' : undefined;
        // `-` reads the diagram from standard input; the picture then goes to standard output unless -o says where.
        if (f === '-') ok = (await renderFile(path.resolve('stdin.yaml'), fs.readFileSync(0, 'utf8'), 'stdin')) && ok;
        else ok = (await (kind ? renderExport(f, kind) : isFolder(f) ? renderMesh(f) : renderFile(f))) && ok;
      }
      return ok ? 0 : 1;
    }
    case 'export': {
      if (!files.length) return (console.error(helpFor(command)), 1);
      if (!themeFlag()) return 1;
      let ok = true;
      for (const f of files) ok = (await exportFile(f)) && ok;
      return ok ? 0 : 1;
    }
    case 'deck':
      if (!files.length) return (console.error(helpFor(command)), 1);
      return (await deck()) ? 0 : 1;
    case 'animate':
      if (files.length !== 1 || !values.out) return (console.error(files.length > 1 ? 'carto animate takes one diagram' : helpFor(command)), 1);
      if (!themeFlag()) return 1;
      return (await animateFile(files[0]!)) ? 0 : 1;
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
          if (name && f.endsWith(name.replace(/\.(layout|notes)\.json$/, path.extname(f)))) again();
        });
      }
      console.log(dim('watching… Ctrl+C to stop'));
      return new Promise(() => {});
    }
    default:
      return unknown(command);
  }
}

function unknown(cmd: string): number {
  const guess = nearest(cmd);
  console.error(`carto: unknown command "${cmd}"${guess ? `. Did you mean "carto ${guess}"?` : ''}\nCommands: ${commands.join(', ')}\nMore: carto --help`);
  return 1;
}

/** What went wrong, in one line: a file that is not there, a folder where a file was meant, … */
function friendly(e: unknown): string {
  const err = e as NodeJS.ErrnoException;
  const where = err.path ? path.relative(process.cwd(), err.path) || err.path : undefined;
  if (err.code === 'ENOENT') return `${where ?? 'file'}: no such file or folder`;
  if (err.code === 'EISDIR') return `${where ?? 'that'} is a folder; give a file`;
  if (err.code === 'ENOTDIR') return `${where ?? 'that'}: a file is in the way where a folder is needed`;
  if (err.code === 'EACCES' || err.code === 'EPERM') return `${where ?? 'file'}: not allowed to read or write it`;
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
