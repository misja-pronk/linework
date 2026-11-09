#!/usr/bin/env node
// carto render | deck | watch | validate | new | import | types
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { iconPng, interTtf, toPng } from './png.ts';
import { toPdf, toPptx, type Drawing } from '@cartography/export';
import { findType, render, types, type RenderOptions } from '@cartography/engine';
import { importKubernetes, importMarkdown, importMermaid, isKubernetes } from '@cartography/import';
import type { Diagnostic, LayoutSidecar } from '@cartography/core';

const help = `carto — architecture diagrams that look good

  carto render <file.yaml…> [-o out] [--format svg|png|pptx|pdf] [--theme light|dark] [--scale 2]
                                                -o x.pptx or x.pdf picks the format too
  carto deck <file.yaml…> -o deck.pptx|deck.pdf  all diagrams in one deck, a slide (page) each
               [--title "Deck title"] [--subtitle …] title slide in front (pptx)
               [--aspect 16:9|4:3] [--font Inter]   slide shape and typeface (pptx)
               [--page fit|a4|a3]                   page size (pdf, default fit)
  carto watch  <file.yaml…> [same options]      re-render on every save
  carto validate <file.yaml…>                   check files, print problems
  carto new <type> [file.yaml]                  start from a template
  carto import <file.mmd|.md|.yaml…> [-o out|-] [--force]
                                                Mermaid (flowchart, architecture-beta,
                                                erDiagram) to YAML; .md: every mermaid block;
                                                Kubernetes manifests: all files in one diagram
  carto types                                   list diagram types

Manual positions are read from <file>.layout.json next to the diagram.`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o' },
    format: { type: 'string', short: 'f', default: 'svg' },
    theme: { type: 'string', short: 't', default: 'light' },
    scale: { type: 'string', default: '2' },
    'no-fonts': { type: 'boolean' },
    force: { type: 'boolean' },
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

function outputPath(file: string, format: string): string {
  const base = path.basename(file).replace(/\.ya?ml$/, '') + '.' + format;
  if (!values.out) return path.join(path.dirname(file), base);
  if (files.length === 1 && path.extname(values.out)) return values.out;
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

type Format = 'svg' | 'png' | 'pptx' | 'pdf';
const formats: Format[] = ['svg', 'png', 'pptx', 'pdf'];

/** -o deck.pptx says the format as clearly as --format pptx; the extension wins for one file. */
function formatFor(): Format {
  const ext = values.out && files.length === 1 ? path.extname(values.out).slice(1).toLowerCase() : '';
  return formats.find((f) => f === ext) ?? formats.find((f) => f === values.format) ?? 'svg';
}

async function draw(file: string, fonts: RenderOptions['fonts']) {
  const result = await render(fs.readFileSync(file, 'utf8'), { theme: values.theme === 'dark' ? 'dark' : 'light', sidecar: sidecarFor(file), load: loaderFor(file), fonts });
  report(file, result.diagnostics);
  return result;
}

/** Slides and PDF pages, from one or many drawings. */
function document(format: 'pptx' | 'pdf', drawings: Drawing[]): Promise<Uint8Array> {
  const theme = values.theme === 'dark' ? 'dark' : 'light';
  if (format === 'pptx')
    return toPptx(drawings, { theme, aspect: values.aspect === '4:3' ? '4:3' : '16:9', font: values.font, title: values.title, subtitle: values.subtitle, rasterize: (svg, w) => iconPng(svg, w) });
  const page = values.page === 'a4' || values.page === 'a3' ? values.page : 'fit';
  return toPdf(drawings, { theme, page, fonts: interTtf(), title: values.title });
}

async function renderFile(file: string): Promise<boolean> {
  const format = formatFor();
  // resvg reads fonts from files; embedding them in the SVG only makes the PNG step slower.
  const result = await draw(file, values['no-fonts'] || format !== 'svg' ? 'none' : 'embed');
  if (!result.svg) return false;
  const out = outputPath(file, format);
  const data =
    format === 'png' ? toPng(result.svg, Number(values.scale) || 2)
    : format === 'svg' ? result.svg
    : await document(format, [{ ...result, name: path.basename(file) }]);
  fs.writeFileSync(out, data);
  console.log(`${file} → ${out} ${dim(`${result.width}×${result.height}`)}`);
  return !result.diagnostics.some((d) => d.severity === 'error');
}

/** Several diagrams, one file: a slide or page each, in the order given. */
async function deck(): Promise<boolean> {
  const format = values.out?.toLowerCase().endsWith('.pdf') ? 'pdf' : 'pptx';
  if (!values.out || !/\.(pptx|pdf)$/i.test(values.out)) {
    console.error('carto deck needs -o <file>.pptx or -o <file>.pdf');
    return false;
  }
  const drawings: Drawing[] = [];
  let ok = true;
  for (const f of files) {
    const r = await draw(f, 'none');
    if (!r.graph || r.diagnostics.some((d) => d.severity === 'error')) ok = false;
    if (r.graph) drawings.push({ ...r, name: path.basename(f) });
  }
  if (!drawings.length) return false;
  fs.mkdirSync(path.dirname(values.out), { recursive: true });
  fs.writeFileSync(values.out, await document(format, drawings));
  console.log(`${drawings.length} diagram${drawings.length > 1 ? 's' : ''} → ${values.out}`);
  return ok;
}

/** Mermaid or Markdown → <name>.yaml (or <name>-<n>.yaml per block), checked by rendering it once. */
async function importFile(file: string): Promise<boolean> {
  const text = fs.readFileSync(file, 'utf8');
  const base = path.basename(file).replace(/\.(mmd|mermaid|md|markdown)$/i, '');
  const blocks = /\.(md|markdown)$/i.test(file) ? importMarkdown(text) : [{ ...importMermaid(text), line: 0 }];
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

async function main(): Promise<number> {
  if (values.help || !command) {
    console.log(help);
    return command ? 0 : 1;
  }
  switch (command) {
    case 'types':
      for (const t of types) console.log(`${t.id.padEnd(14)} ${t.name} ${dim('— ' + t.description)}`);
      return 0;
    case 'new': {
      const [id, target] = files;
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
        const r = await render(fs.readFileSync(f, 'utf8'), { fonts: 'none', load: loaderFor(f) });
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
      let ok = manifests.length ? await importManifests(manifests) : true;
      for (const f of files) if (!manifests.includes(f)) ok = (await importFile(f)) && ok;
      return ok ? 0 : 1;
    }
    case 'render': {
      if (!files.length) return (console.error(help), 1);
      let ok = true;
      for (const f of files) ok = (await renderFile(f)) && ok;
      return ok ? 0 : 1;
    }
    case 'deck':
      if (!files.length) return (console.error(help), 1);
      return (await deck()) ? 0 : 1;
    case 'watch': {
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
