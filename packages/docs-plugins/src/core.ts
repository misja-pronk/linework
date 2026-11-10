// What both plugins do with one diagram: read it, draw it light and dark, clean the SVG and wrap it
// in a figure. Runs in Node at build time; nothing here needs a browser.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { includesOf, joinPath, parseSource, type Diagnostic, type Graph, type LayoutSidecar, type Link } from '@cartography/core';
import { render, themes, type RenderOptions, type RenderResult } from '@cartography/engine';
import { describe, linkTarget, linkText } from '@cartography/embed/shared';
import { bundledFont, type Theme } from '@cartography/theme';
import { el, parseSvg, walk, type El } from './tree.ts';

export interface CartographyOptions {
  /** `auto` (the default) draws a light and a dark version and lets the page pick; or light, dark, or a built-in theme name. */
  theme?: string;
  /** The view to draw when a diagram reference names none. */
  view?: string;
  /** `inline` (the default) puts the SVG in the page; `file` writes SVG files to `outDir` and points an <img> at them. */
  output?: 'inline' | 'file';
  /** Where `output: 'file'` writes. */
  outDir?: string;
  /** The address `outDir` is served at, for the <img>. Default "/". */
  publicPath?: string;
  /** Wrap the drawing in <carto-diagram>: zoom, pan and drill-down once the page has loaded the component; the static drawing until then. */
  interactive?: boolean;
  /**
   * How the page says it is dark. `auto` (the default): the system setting, overruled by data-theme,
   * data-bs-theme, data-md-color-scheme or a dark/light class. `media`: the system setting only.
   * Anything else is a CSS selector that matches when the page is dark, for example ".dark".
   */
  dark?: string;
  /** `embed` (the default) adds the theme's typefaces to the page once, under names of their own; `none` leaves the text to the page's fonts. */
  fonts?: 'embed' | 'none';
  /** Add the drawing in words below it: elements and connections in a <details>. */
  description?: boolean;
  /** Stop the build on a diagram with errors (the default). Off: a message in the page and a warning. */
  strict?: boolean;
  /** Diagrams may only read files below this folder. Default: where the build runs. */
  root?: string;
  /** Put the small stylesheet (light or dark, the typefaces) in each page with a diagram (the default). Off when the site's own CSS has `pageCss()`. */
  pageStyle?: boolean;
  /** Finds an imported official icon set by name (`carto embed` looks in the config dir), for `icons: official`. */
  iconPack?: RenderOptions['pack'];
  /** official or lucide, over what the diagrams say. */
  icons?: RenderOptions['iconsOverride'];
}

/** One diagram to draw. Plain data, so it can cross to a worker. */
export interface Job {
  /** The YAML of a fenced block; without it `file` is read. */
  text?: string;
  /** A diagram file (absolute). */
  file?: string;
  /** The folder includes and links are relative to. */
  dir: string;
  view?: string;
  /** Overrides from the fence line or the image: theme, interactive. */
  theme?: string;
  interactive?: boolean;
  /** The image's alt text; the diagram's own title otherwise. */
  title?: string;
  options: CartographyOptions;
}

export interface Problem extends Diagnostic {
  /** The diagram file the problem is in, when it is not the markdown itself. */
  file?: string;
}

export interface Built {
  /** What goes in the page: the drawing, or a readable message when there is none. */
  figure: El;
  problems: Problem[];
  ok: boolean;
  /** Files written with `output: 'file'`. */
  written: string[];
}

const INLINE = 'diagram.yaml';
const isYaml = (f: string) => /\.ya?ml$/i.test(f);
const hash = (...parts: (string | undefined)[]) => createHash('sha1').update(parts.join('\0')).digest('hex').slice(0, 8);
const posix = (p: string) => p.split(path.sep).join('/');

/** Reads only below the root: a diagram in a docs repo should not be able to pull in the build machine's files. */
function reader(root: string) {
  const check = (p: string) => {
    const rel = path.relative(root, p);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`${posix(rel)} is outside ${posix(root)} (the root option)`);
    return p;
  };
  return {
    text: (p: string) => fs.readFileSync(check(p), 'utf8'),
    bytes: (p: string) => new Uint8Array(fs.readFileSync(check(p))),
    exists: (p: string) => {
      try {
        return fs.statSync(check(p)).isFile();
      } catch {
        return false;
      }
    },
  };
}

function sidecarOf(file: string | undefined, read: ReturnType<typeof reader>): { path: string; text: string; data: LayoutSidecar } | undefined {
  if (!file) return undefined;
  const p = file.replace(/\.ya?ml$/i, '') + '.layout.json';
  if (!read.exists(p)) return undefined;
  try {
    const text = read.text(p);
    return { path: p, text, data: JSON.parse(text) as LayoutSidecar };
  } catch {
    return undefined;
  }
}

export async function build(job: Job): Promise<Built> {
  const o = job.options;
  const root = path.resolve(o.root ?? process.cwd());
  const read = reader(root);
  const problems: Problem[] = [];
  const shown = job.file ? posix(path.relative(process.cwd(), job.file)) : undefined;
  const fail = (message: string): Built => {
    problems.push({ severity: 'error', message, ...(shown ? { file: shown } : {}) });
    return { figure: problemFigure(problems), problems, ok: false, written: [] };
  };

  let text = job.text;
  if (text == null) {
    if (!job.file) return fail('No diagram given');
    try {
      text = read.text(job.file);
    } catch (e) {
      return fail(e instanceof Error && !('code' in e) ? e.message : `Cannot read ${shown}`);
    }
  }

  let theme = (job.theme ?? o.theme ?? 'auto').trim() || 'auto';
  if (theme !== 'auto' && !themes[theme]) {
    problems.push({ severity: 'warning', message: `Unknown theme "${theme}", use one of: auto, ${Object.keys(themes).join(', ')}` });
    theme = 'auto';
  }
  const toFile = o.output === 'file';
  if (toFile && !o.outDir) return fail('output: "file" needs outDir, the folder to write the SVG files to');
  const interactive = job.interactive ?? o.interactive ?? false;
  const view = job.view ?? o.view;
  const name = job.file ? path.basename(job.file) : INLINE;
  const key = hash(text, job.file, view, theme);
  const side = sidecarOf(job.file, read);

  // Everything the engine reads on the way, so an interactive drawing can take it along.
  const texts = new Map<string, string>();
  const assets = new Map<string, Uint8Array>();
  const draw = (mode: 'light' | 'dark', suffix: string): Promise<RenderResult> => {
    const opts: RenderOptions = {
      ...(theme === 'auto' ? { theme: mode } : { themeOverride: theme }),
      view,
      file: name,
      sidecar: side?.data,
      fonts: toFile ? 'embed' : 'none',
      pack: o.iconPack,
      iconsOverride: o.icons,
      interactive: !toFile,
      hints: false,
      idPrefix: `c${key}${suffix}`,
      load: (f) => {
        const t = read.text(path.resolve(job.dir, f));
        texts.set(joinPath('', f), t);
        return t;
      },
      assets: (f) => {
        try {
          const b = read.bytes(path.resolve(job.dir, f));
          assets.set(joinPath('', f), b);
          return b;
        } catch {
          return undefined;
        }
      },
    };
    return render(text, opts);
  };

  const light = await draw('light', 'l');
  for (const d of light.diagnostics) problems.push({ ...d, ...(shown ? { file: shown } : {}) });
  if (!light.svg || !light.graph || problems.some((p) => p.severity === 'error')) {
    if (!problems.some((p) => p.severity === 'error')) problems.push({ severity: 'error', message: 'The diagram could not be drawn', ...(shown ? { file: shown } : {}) });
    return { figure: problemFigure(problems), problems, ok: false, written: [] };
  }
  // A diagram with a theme of its own looks the same on a light and a dark page: one drawing is enough.
  const dark = theme === 'auto' && light.theme?.mode !== 'dark' ? await draw('dark', 'd') : undefined;
  const both = dark?.svg && dark.theme?.mode === 'dark' ? dark : undefined;

  const title = job.title?.trim() || light.graph.title || name.replace(/\.ya?ml$/i, '');
  const written: string[] = [];
  let variants: El[];
  try {
    if (toFile) {
      const dir = path.resolve(o.outDir!);
      fs.mkdirSync(dir, { recursive: true });
      const base = `${name.replace(/\.ya?ml$/i, '').replace(/[^\w.-]+/g, '-')}${light.view ? `-${light.view}` : ''}-${key}`;
      const publicPath = (o.publicPath ?? '/').replace(/\/?$/, '/');
      const image = (r: RenderResult, file: string) => {
        fs.writeFileSync(path.join(dir, file), r.svg!);
        written.push(path.join(dir, file));
        return el('img', { src: publicPath + file, alt: title, width: String(r.width), height: String(r.height), loading: 'lazy', decoding: 'async' });
      };
      const lightImg = image(light, `${base}.svg`);
      const darkImg = both ? image(both, `${base}.dark.svg`) : undefined;
      if (!darkImg) variants = [el('div', { class: 'carto-only' }, lightImg)];
      else if (o.dark === 'media') variants = [el('picture', {}, el('source', { srcset: darkImg.attrs.src, media: '(prefers-color-scheme: dark)' }), lightImg)];
      else variants = [el('div', { class: 'carto-light' }, lightImg), el('div', { class: 'carto-dark' }, darkImg)];
    } else {
      const fonts = o.fonts !== 'none';
      variants = both
        ? [el('div', { class: 'carto-light' }, inlineSvg(light, title, fonts, o)), el('div', { class: 'carto-dark' }, inlineSvg(both, title, fonts, o))]
        : [el('div', { class: 'carto-only' }, inlineSvg(light, title, fonts, o))];
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }

  const figure = el('figure', { class: 'carto' }, ...variants, o.description ? descriptionOf(light.graph) : undefined);
  if (!interactive) return { figure, problems, ok: true, written };

  // The live drawing needs no fetch: the diagram, what it includes and the diagrams it links to ride along.
  const files: Record<string, string> = { [name]: text };
  for (const [f, t] of texts) files[f] = t;
  if (side) files[posix(path.relative(job.dir, side.path))] = side.text;
  linked(text, '', files, job.dir, read, new Set([name]));
  const icons = officialIcons(light);
  const bundle = { main: name, files, ...(assets.size ? { assets: Object.fromEntries([...assets].map(([f, b]) => [f, Buffer.from(b).toString('base64')])) } : {}), ...(icons ? { icons } : {}) };
  const live = el('carto-diagram', { 'data-bundle': JSON.stringify(bundle), ...(light.view ? { view: light.view } : {}), ...(theme !== 'auto' ? { theme } : {}) }, figure);
  return { figure: live, problems, ok: true, written };
}

/** The official icons a drawing used, kind → SVG, so the live drawing has them without the pack. */
function officialIcons(r: RenderResult): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  const add = (id: string, kind: string | undefined, map: Map<string, string> | undefined) => {
    const href = map?.get(id);
    if (kind && href?.startsWith('data:image/svg+xml;base64,')) out[kind] = Buffer.from(href.slice(26), 'base64').toString('utf8');
  };
  for (const n of r.graph?.nodes ?? []) add(n.id, n.kind, r.images?.nodes);
  for (const g of r.graph?.groups ?? []) add(g.id, g.kind, r.images?.groups);
  return Object.keys(out).length ? out : undefined;
}

/** Follows links (and includes) from one diagram to the next and adds their text, so drill-down works offline. */
function linked(text: string, dir: string, files: Record<string, string>, base: string, read: ReturnType<typeof reader>, seen = new Set<string>()) {
  const data = parseSource(text).data;
  if (!data || typeof data !== 'object') return;
  const found = new Set<string>(Array.isArray(data) ? [] : includesOf(data as Record<string, unknown>));
  const theme = (data as Record<string, unknown>).theme;
  if (typeof theme === 'string' && isYaml(theme)) found.add(theme);
  const see = (v: unknown, key?: string) => {
    if (typeof v === 'string') {
      const file = v.trim().replace(/#.*$/, '');
      if ((key === 'links' || key === 'link' || key === 'to') && isYaml(file) && !/^[a-z][a-z0-9+.-]*:/i.test(file)) found.add(file);
    } else if (Array.isArray(v)) v.forEach((x) => see(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) see(x, k === 'to' && key !== 'links' && key !== 'link' ? undefined : k);
  };
  see(data);
  for (const rel of found) {
    const file = joinPath(dir, rel);
    // A page should not grow without end: forty files is a large set of linked diagrams.
    if (seen.has(file) || (!(file in files) && Object.keys(files).length >= 40)) continue;
    seen.add(file);
    const abs = path.resolve(base, file);
    if (!(file in files) && !read.exists(abs)) continue;
    const t = (files[file] ??= read.text(abs));
    const side = sidecarOf(abs, read);
    if (side) files[file.replace(/\.ya?ml$/i, '') + '.layout.json'] = side.text;
    linked(t, file.split('/').slice(0, -1).join('/'), files, base, read, seen);
  }
}

/** The name a bundled typeface goes into a page under, so it never changes the page's own text. No spaces: the CSS needs no quotes. */
const faceName = (family: string) => `Carto${family.replace(/\s+/g, '')}`;
const faceRules = (family: string) =>
  Object.entries(bundledFont(family)?.woff2 ?? {}).map(([weight, data]) => `@font-face{font-family:${faceName(family)};font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${data})}`);
/** The bundled typefaces a theme sets its text in; Inter where a brand brings its own files. */
const facesOf = (theme: Theme | undefined) => [theme?.font.sans ?? 'Inter', theme?.font.monoFace].filter((f): f is string => !!f && !!bundledFont(f));
/** The typefaces in the page stylesheet: those of the site's own theme that are always at hand (a drawing in another theme brings its own). */
const PAGE_FACES = ['Inter', 'Instrument Sans', 'Geist Mono'];
const pageFaces = (o: CartographyOptions) => {
  const name = (o.theme ?? 'auto').trim();
  return facesOf(themes[name] ?? themes.light).filter((f) => PAGE_FACES.includes(f));
};
/** Names the page's copy of each bundled typeface first in a font stack. */
const BUNDLED = /(^|,)\s*'?(Inter|Instrument Sans|Geist Mono|Barlow|IBM Plex Sans|IBM Plex Mono|Kalam)'?\s*(?=,|$)/g;
const ownFaces = (stack: string) => stack.replace(BUNDLED, (_, lead: string, family: string) => `${lead}${faceName(family)}, ${/\s/.test(family) ? `'${family}'` : family}`);

/** The engine's SVG, cleaned, made to fit the page's width, and with the links a static page can honour. */
function inlineSvg(result: RenderResult, title: string, fonts: boolean, o: CartographyOptions): El {
  const svg = parseSvg(result.svg!);
  const g = result.graph!;
  const linksOf = new Map<string, Link[]>();
  for (const n of g.nodes) if (n.links?.length) linksOf.set(`node:${n.id}`, n.links);
  for (const x of g.groups) if (x.links?.length) linksOf.set(`group:${x.id}`, x.links);
  let hasLinks = false;
  // Only links that mean the same on any page: web addresses. Links to other diagrams work in the interactive drawing.
  const outside = (href: string | undefined) => (href && /^(https?|mailto):/i.test(href) ? href : undefined);
  walk(svg, (child, parent, i) => {
    // Text in the monospace face names its own family.
    if (fonts && child.attrs['font-family']) child.attrs['font-family'] = ownFaces(child.attrs['font-family']);
    const id = child.attrs['data-node'] != null ? `node:${child.attrs['data-node']}` : child.attrs['data-group'] != null ? `group:${child.attrs['data-group']}` : undefined;
    for (const k of Object.keys(child.attrs)) if (k.startsWith('data-')) delete child.attrs[k];
    if (child.tag === 'a') {
      const href = outside(child.attrs.href ?? child.attrs['xlink:href']);
      if (href) Object.assign(child, { attrs: { href, target: '_blank', rel: 'noopener noreferrer' } });
      else Object.assign(child, { tag: 'g', attrs: {} });
      hasLinks ||= !!href;
      return;
    }
    const target = id
      ? linksOf
          .get(id)
          ?.map(linkTarget)
          .find((t) => t.kind === 'url' && t.external)
      : undefined;
    const href = target?.kind === 'url' ? outside(target.href) : undefined;
    if (!href) return;
    parent.children[i] = el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, child);
    hasLinks = true;
  });
  const family = svg.attrs['font-family'] ?? 'sans-serif';
  svg.attrs = {
    ...svg.attrs,
    ...(fonts ? { 'font-family': ownFaces(family) } : {}),
    role: hasLinks ? 'group' : 'img',
    'aria-label': title,
    style: 'max-width:100%;height:auto',
  };
  // A drawing in a theme of its own (Transit, Drafting, classic) carries the typefaces the page stylesheet does not have.
  const extra = fonts ? facesOf(result.theme).filter((f) => !pageFaces(o).includes(f)) : [];
  if (extra.length) svg.children.unshift(el('style', {}, extra.flatMap(faceRules).join('')));
  return svg;
}

function descriptionOf(graph: Graph): El {
  const d = describe(graph);
  const heading = [d.title, d.subtitle].filter(Boolean).join(' — ');
  const elements = d.elements.map((e) => {
    const links = e.links.flatMap((l) => {
      const t = linkTarget(l);
      return t.kind === 'url' && t.external && /^(https?|mailto):/i.test(t.href) ? [' ', el('a', { href: t.href, rel: 'noopener noreferrer' }, linkText(l))] : [];
    });
    return el('li', {}, el('strong', {}, e.label), [e.detail ? ` (${e.detail})` : '', e.in ? `, in ${e.in}` : '', e.description ? `: ${e.description}` : ''].join(''), ...links);
  });
  const relations = d.relations.map((r) => el('li', {}, `${r.from} → ${r.to}${r.label ? `: ${r.label}` : ''}`));
  return el(
    'details',
    { class: 'carto-text' },
    el('summary', {}, 'Text description'),
    heading ? el('p', {}, heading) : undefined,
    elements.length ? el('p', {}, el('strong', {}, `Elements (${elements.length})`)) : undefined,
    elements.length ? el('ul', {}, ...elements) : undefined,
    relations.length ? el('p', {}, el('strong', {}, `Connections (${relations.length})`)) : undefined,
    relations.length ? el('ul', {}, ...relations) : undefined,
  );
}

/** "docs/model.yaml:12:5: message", or for a fenced block the line within it. */
export function problemText(p: Problem, file?: string, lineOffset = 0): string {
  const where = [p.file ?? file, p.line != null ? p.line + (p.file ? 0 : lineOffset) : undefined, p.line != null ? p.column : undefined]
    .filter((x) => x != null && x !== '')
    .join(':');
  return where ? `${where}: ${p.message}` : p.message;
}

/** Shown in the page in place of a drawing that could not be made, so the reader never sees an empty box. */
export function problemFigure(problems: Problem[]): El {
  const errors = problems.filter((p) => p.severity === 'error');
  return el(
    'figure',
    { class: 'carto carto-problem', role: 'alert', style: 'margin:1.5em 0;padding:10px 14px;border-left:3px solid #d4372c;background:rgba(212,55,44,.07);text-align:left' },
    el('strong', {}, errors.length > 1 ? 'This diagram has problems' : 'This diagram has a problem'),
    el('ul', { style: 'margin:4px 0 0;padding-left:18px' }, ...errors.slice(0, 8).map((p) => el('li', {}, problemText(p, undefined)))),
  );
}

/**
 * The CSS that goes into a page once: which drawing shows on a light and on a dark page, and the
 * theme's typefaces under names of their own. Written without quotes or angle brackets, so it survives any templating.
 */
export function pageCss(o: CartographyOptions = {}): string {
  const dark = (o.dark ?? 'auto').trim() || 'auto';
  const rules = [
    '.carto{margin:1.5em 0}',
    '.carto svg,.carto img{display:block;margin:0 auto;max-width:100%;height:auto;border-radius:8px}',
    '.carto-dark{display:none}',
    '.carto-text{font-size:.85em;margin-top:.5em}',
  ];
  const toDark = (prefix: string) => `${prefix}.carto-light{display:none}${prefix}.carto-dark{display:block}`;
  const toLight = (prefix: string) => `${prefix}.carto-light{display:block}${prefix}.carto-dark{display:none}`;
  if (dark === 'auto' || dark === 'media') rules.push(`@media (prefers-color-scheme:dark){${toDark('')}}`);
  if (dark === 'auto') {
    rules.push(toDark(':is([data-theme=dark],[data-bs-theme=dark],[data-md-color-scheme=slate],.dark) '));
    rules.push(toLight(':is([data-theme=light],[data-bs-theme=light],[data-md-color-scheme=default],.light) '));
  } else if (dark !== 'media') rules.push(toDark(`:is(${dark.replace(/[<>{}]/g, '')}) `));
  if (o.fonts !== 'none' && o.output !== 'file')
    for (const family of pageFaces(o)) rules.push(...faceRules(family));
  return rules.join('\n');
}

export const pageStyle = (o: CartographyOptions = {}): El => el('style', { 'data-carto': '' }, pageCss(o));

/** `cartography view=ordering theme=dark interactive title="Placing an order"` on a fence line. */
export function fenceInfo(info: string): { match: boolean } & Flags {
  const [lang = '', ...rest] = info.trim().split(/\s+/);
  if (lang !== 'cartography' && lang !== 'carto') return { match: false };
  return { match: true, ...flags(rest.join(' ')) };
}

interface Flags {
  view?: string;
  theme?: string;
  interactive?: boolean;
  title?: string;
}

/** What one diagram asks for itself: on the fence line, or as the title of an image (`![Shop](shop.yaml "interactive")`). */
function flags(text: string): Flags {
  const out: Flags = {};
  for (const m of text.matchAll(/([\w-]+)(?:=(?:"([^"]*)"|(\S+)))?/g)) {
    const value = m[2] ?? m[3];
    if (m[1] === 'view' && value) out.view = value;
    else if (m[1] === 'theme' && value) out.theme = value;
    else if (m[1] === 'title' && value) out.title = value;
    else if (m[1] === 'interactive') out.interactive = value !== 'false';
    else if (m[1] === 'static') out.interactive = false;
  }
  return out;
}

/** `./model/context.yaml#containers` in an image: the file and the view, or nothing when it is not a diagram. */
export function diagramReference(url: string): { file: string; view?: string } | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return undefined;
  const hashAt = url.indexOf('#');
  const decoded = (part: string) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  };
  const file = decoded(hashAt < 0 ? url : url.slice(0, hashAt));
  if (!isYaml(file)) return undefined;
  const view = hashAt < 0 ? undefined : decoded(url.slice(hashAt + 1)) || undefined;
  return { file, ...(view ? { view } : {}) };
}

/** The job for a fenced block, or nothing when the fence is not ours. `dir` is the folder of the markdown file. */
export function fenceJob(info: string, text: string, dir: string, options: CartographyOptions): Job | undefined {
  const f = fenceInfo(info);
  if (!f.match) return undefined;
  return {
    text,
    dir,
    options,
    ...(f.view ? { view: f.view } : {}),
    ...(f.theme ? { theme: f.theme } : {}),
    ...(f.interactive != null ? { interactive: f.interactive } : {}),
    ...(f.title ? { title: f.title } : {}),
  };
}

/**
 * The job for `![Title](./x.yaml#view "interactive")`, or nothing when the image is not a diagram.
 * A leading slash starts at the root; the image's title may carry what a fence line can.
 */
export function imageJob(url: string, alt: string | undefined | null, title: string | undefined | null, dir: string, options: CartographyOptions): Job | undefined {
  const ref = diagramReference(url);
  if (!ref) return undefined;
  const file = ref.file.startsWith('/') ? path.join(path.resolve(options.root ?? process.cwd()), ref.file) : path.resolve(dir, ref.file);
  const f = flags(title ?? '');
  const view = ref.view ?? f.view;
  return {
    file,
    dir: path.dirname(file),
    options,
    ...(view ? { view } : {}),
    ...(f.theme ? { theme: f.theme } : {}),
    ...(f.interactive != null ? { interactive: f.interactive } : {}),
    ...(alt?.trim() ? { title: alt.trim() } : {}),
  };
}
