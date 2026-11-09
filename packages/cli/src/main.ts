#!/usr/bin/env node
// carto render | deck | watch | validate | new | import | icons | themes | types
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { iconPng, interTtf, toPng } from './png.ts';
import { toPdf, toPptx, type Drawing } from '@cartography/export';
import { fontScale, ttfFiles } from './fonts.ts';
import { configDir, importIcons, listPacks, readPack } from './packs.ts';
import { findType, render, types, type RenderOptions, type RenderResult } from '@cartography/engine';
import { builtinSpecs, isThemeFile, resolveTheme, themes, type Theme } from '@cartography/theme';
import { importKubernetes, importMarkdown, importMermaid, importNetwork, importStructurizr, isKubernetes, isNetworkInventory } from '@cartography/import';
import { matchTypes, type Diagnostic, type DiagramType, type LayoutSidecar } from '@cartography/core';

const help = `carto — architecture diagrams that look good

  carto render <file.yaml…> [-o out] [--format svg|png|pptx|pdf] [--theme name|file.theme.yaml]
               [--pack azure] [--scale 2]           --theme wins over the diagram's theme:; -o x.pptx or x.pdf picks the format too
               [--view name | --all-views]      one of the diagram's views, or each to <file>-<view>.svg
  carto deck <file.yaml…> -o deck.pptx|deck.pdf  all diagrams in one deck, a slide (page) each
               [--title "Deck title"] [--subtitle …] title slide in front (pptx)
               [--aspect 16:9|4:3] [--font Inter]   slide shape and typeface (pptx)
               [--page fit|a4|a3]                   page size (pdf, default fit)
  carto watch  <file.yaml…> [same options]      re-render on every save (and when included files change)
  carto validate <file.yaml…>                   check files, print problems
  carto new <type> [file.yaml]                  start from a template; no type: which to pick
  carto import <file.mmd|.md|.dsl|.yaml…> [-o out|-] [--force]
                                                Mermaid (flowchart, architecture-beta,
                                                erDiagram, sequenceDiagram) to YAML; .md: every mermaid block;
                                                Kubernetes manifests: all files in one diagram;
                                                .csv inventory or NetBox JSON: a network diagram
  carto icons import <folder|file.zip> --pack azure
                                                index an official icon download (Azure, AWS,
                                                GCP) into a pack in ${configDir()}
  carto icons list                              packs and how many kinds each maps
  carto themes                                  built-in themes
  carto types [words…]                          which type to pick, best match first

Manual positions are read from <file>.layout.json next to the diagram (per view under "views").`;

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
    'all-views': { type: 'boolean' },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    aspect: { type: 'string', default: '16:9' },
    font: { type: 'string' },
    page: { type: 'string', default: 'fit' },
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

function sidecarFor(file: string): LayoutSidecar | undefined {
  const p = file.replace(/\.ya?ml$/, '') + '.layout.json';
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')) as LayoutSidecar) : undefined;
}

function outputPath(file: string, format: string, view?: string): string {
  const base = path.basename(file).replace(/\.ya?ml$/, '') + (view ? `-${view}` : '') + '.' + format;
  if (!values.out) return path.join(path.dirname(file), base);
  if (files.length === 1 && !values['all-views'] && path.extname(values.out)) return (fs.mkdirSync(path.dirname(values.out), { recursive: true }), values.out);
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
  };
}

async function draw(file: string, fonts: RenderOptions['fonts']) {
  const result = await render(fs.readFileSync(file, 'utf8'), optionsFor(file, fonts));
  report(file, result.diagnostics);
  return result;
}

/** Slides and PDF pages, from one or many drawings; a brand theme carries over. */
function document(format: 'pptx' | 'pdf', drawings: Drawing[], theme: RenderResult['theme']): Promise<Uint8Array> {
  const t = theme ?? (values.theme === 'dark' ? 'dark' : 'light');
  if (format === 'pptx')
    return toPptx(drawings, { theme: t, aspect: values.aspect === '4:3' ? '4:3' : '16:9', font: values.font, title: values.title, subtitle: values.subtitle, rasterize: (svg, w) => iconPng(svg, w) });
  const page = values.page === 'a4' || values.page === 'a3' ? values.page : 'fit';
  return toPdf(drawings, { theme: t, page, fonts: interTtf(), title: values.title });
}

async function renderFile(file: string): Promise<boolean> {
  const format = formatFor();
  const text = fs.readFileSync(file, 'utf8');
  // resvg reads fonts from files; embedding them in the SVG only makes the PNG step slower.
  const opts = optionsFor(file, values['no-fonts'] || format !== 'svg' ? 'none' : 'embed');
  const first = await render(text, opts);
  // --all-views: the diagram as written (or its first view) plus every view as <file>-<view>.svg.
  const runs = values['all-views'] && first.views?.length ? [first, ...(await Promise.all(first.views.map((v) => render(text, { ...opts, view: v.name }))))] : [first];
  let ok = true;
  for (const [i, result] of runs.entries()) {
    const view = i ? result.view : values.view;
    report(view && i ? `${file}#${view}` : file, i && !values.view ? result.diagnostics.filter((d) => !first.diagnostics.some((f) => f.message === d.message)) : result.diagnostics);
    if (!result.svg) {
      ok = false;
      continue;
    }
    const out = outputPath(file, format, view);
    const faces = result.theme?.font.faces ?? [];
    const data =
      format === 'png' ? toPng(result.svg, Number(values.scale) || 2, await ttfFiles(faces))
      : format === 'svg' ? result.svg
      : await document(format, [{ ...result, name: path.basename(file) }], result.theme);
    fs.writeFileSync(out, data);
    console.log(`${file}${view ? `#${view}` : ''} → ${out} ${dim(`${result.width}×${result.height}`)}`);
    if (result.diagnostics.some((d) => d.severity === 'error')) ok = false;
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
    const r = await draw(f, 'none');
    theme ??= r.theme;
    if (!r.graph || r.diagnostics.some((d) => d.severity === 'error')) ok = false;
    if (r.graph) drawings.push({ ...r, name: path.basename(f) });
  }
  if (!drawings.length) return false;
  fs.mkdirSync(path.dirname(values.out), { recursive: true });
  fs.writeFileSync(values.out, await document(format, drawings, theme));
  console.log(`${drawings.length} diagram${drawings.length > 1 ? 's' : ''} → ${values.out}`);
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

/** A network inventory (CSV name,type,ip,zone,uplink or NetBox JSON) → <name>.yaml next to it. */
async function importInventory(file: string): Promise<boolean> {
  const base = path.basename(file).replace(/\.(csv|json)$/i, '');
  const r = importNetwork(fs.readFileSync(file, 'utf8'), base);
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
      console.log(`${'light'.padEnd(10)} ${dim('— the default')}\n${'dark'.padEnd(10)} ${dim('— the default, dark')}`);
      for (const [k, s] of Object.entries(builtinSpecs)) console.log(`${k.padEnd(10)} ${dim('— ' + s.description)}`);
      console.log(dim('Or a file: theme: ./client.theme.yaml (see docs/themes.md)'));
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
    case 'validate': {
      let ok = true;
      for (const f of files) {
        const r = await render(fs.readFileSync(f, 'utf8'), { fonts: 'none', load: loaderFor(f), file: path.basename(f), view: values.view });
        report(f, r.diagnostics);
        if (r.diagnostics.some((d) => d.severity === 'error')) ok = false;
        else console.log(`${f} ${dim('ok')}`);
      }
      return ok ? 0 : 1;
    }
    case 'import': {
      if (!files.length) return (console.error(help), 1);
      // Manifests are read together: a platform is spread over many files, but it is one drawing.
      const manifests = files.filter((f) => /\.(ya?ml|json)$/i.test(f) && isKubernetes(fs.readFileSync(f, 'utf8')));
      const inventories = files.filter((f) => /\.csv$/i.test(f) || (/\.json$/i.test(f) && !manifests.includes(f) && isNetworkInventory(fs.readFileSync(f, 'utf8'))));
      let ok = manifests.length ? await importManifests(manifests) : true;
      for (const f of inventories) ok = (await importInventory(f)) && ok;
      for (const f of files) if (!manifests.includes(f) && !inventories.includes(f)) ok = (await importFile(f)) && ok;
      return ok ? 0 : 1;
    }
    case 'render': {
      if (!files.length) return (console.error(help), 1);
      if (!themeFlag()) return 1;
      let ok = true;
      for (const f of files) ok = (await renderFile(f)) && ok;
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
