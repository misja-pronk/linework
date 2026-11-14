// One diagram for a page of the site: drawn light and dark, the SVG cleaned and wrapped in a figure,
// the page picking which one shows. Runs at build time; nothing here needs a browser.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Diagnostic, LayoutSidecar, Link } from '@linework/core';
import { render, themes, type RenderOptions, type RenderResult } from '@linework/engine';
import { diagnosticText, escapeHtml, linkTarget, safeAttribute, SVG_ELEMENTS } from '@linework/embed/shared';
import { bundledFont, type Theme } from '@linework/theme';

export interface DrawOptions {
  /** `auto` (the default) draws a light and a dark version and lets the page pick; or a built-in theme name. */
  theme?: string;
  /** `embed` (the default) puts the typefaces of a theme the page stylesheet does not have into its drawing; `none` leaves the text to the page's fonts. */
  fonts?: 'embed' | 'none';
  /** Diagrams may only read files below this folder. Default: where the build runs. */
  root?: string;
}

/** One diagram to draw: the YAML, or a file to read. */
export interface Job {
  text?: string;
  /** A diagram file (absolute). */
  file?: string;
  /** The folder includes are relative to. */
  dir: string;
  view?: string;
  options: DrawOptions;
}

export interface Problem extends Diagnostic {
  /** The diagram file the problem is in. */
  file?: string;
}

export interface Built {
  /** What goes in the page: the drawing, or a readable message when there is none. */
  figure: El;
  problems: Problem[];
  ok: boolean;
}

const posix = (p: string) => p.split(path.sep).join('/');
const hash = (...parts: (string | undefined)[]) => createHash('sha1').update(parts.join('\0')).digest('hex').slice(0, 8);

/** Reads only below the root. */
function reader(root: string) {
  const check = (p: string) => {
    const rel = path.relative(root, p);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`${posix(rel)} is outside ${posix(root)} (the root option)`);
    return p;
  };
  return {
    text: (p: string) => fs.readFileSync(check(p), 'utf8'),
    bytes: (p: string) => new Uint8Array(fs.readFileSync(check(p))),
  };
}

function sidecarOf(file: string | undefined, read: ReturnType<typeof reader>): LayoutSidecar | undefined {
  if (!file) return undefined;
  try {
    return JSON.parse(read.text(file.replace(/\.ya?ml$/i, '') + '.layout.json')) as LayoutSidecar;
  } catch {
    return undefined;
  }
}

export async function build(job: Job): Promise<Built> {
  const o = job.options;
  const read = reader(path.resolve(o.root ?? process.cwd()));
  const problems: Problem[] = [];
  const shown = job.file ? posix(path.relative(process.cwd(), job.file)) : undefined;
  const fail = (message: string): Built => {
    problems.push({ severity: 'error', message, ...(shown ? { file: shown } : {}) });
    return { figure: problemFigure(problems), problems, ok: false };
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

  const theme = (o.theme ?? 'auto').trim() || 'auto';
  const name = job.file ? path.basename(job.file) : 'diagram.yaml';
  const key = hash(text, job.file, job.view, theme);
  const sidecar = sidecarOf(job.file, read);
  const draw = (mode: 'light' | 'dark', suffix: string): Promise<RenderResult> => {
    const opts: RenderOptions = {
      ...(theme === 'auto' ? { theme: mode } : { themeOverride: theme }),
      view: job.view,
      file: name,
      sidecar,
      fonts: 'none',
      interactive: true,
      hints: false,
      idPrefix: `c${key}${suffix}`,
      load: (f) => read.text(path.resolve(job.dir, f)),
      assets: (f) => {
        try {
          return read.bytes(path.resolve(job.dir, f));
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
    return { figure: problemFigure(problems), problems, ok: false };
  }
  // A diagram with a theme of its own looks the same on a light and a dark page: one drawing is enough.
  const dark = theme === 'auto' && light.theme?.mode !== 'dark' ? await draw('dark', 'd') : undefined;
  const both = dark?.svg && dark.theme?.mode === 'dark' ? dark : undefined;
  const title = light.graph.title || name.replace(/\.ya?ml$/i, '');
  const fonts = o.fonts !== 'none';
  try {
    const variants = both
      ? [el('div', { class: 'linework-light' }, inlineSvg(light, title, fonts, o)), el('div', { class: 'linework-dark' }, inlineSvg(both, title, fonts, o))]
      : [el('div', { class: 'linework-only' }, inlineSvg(light, title, fonts, o))];
    return { figure: el('figure', { class: 'linework' }, ...variants), problems, ok: true };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/** The name a bundled typeface goes into a page under, so it never changes the page's own text. No spaces: the CSS needs no quotes. */
const faceName = (family: string) => `Linework${family.replace(/\s+/g, '')}`;
const faceRules = (family: string) =>
  Object.entries(bundledFont(family)?.woff2 ?? {}).map(([weight, data]) => `@font-face{font-family:${faceName(family)};font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${data})}`);
/** The bundled typefaces a theme sets its text in; Inter where a brand brings its own files. */
const facesOf = (theme: Theme | undefined) => [theme?.font.sans ?? 'Inter', theme?.font.monoFace].filter((f): f is string => !!f && !!bundledFont(f));
/** The typefaces the site's stylesheet has: those of its own theme that are always at hand (a drawing in another theme brings its own). */
const PAGE_FACES = ['Inter', 'Instrument Sans', 'Geist Mono'];
const pageFaces = (o: DrawOptions) => facesOf(themes[(o.theme ?? 'auto').trim()] ?? themes.light).filter((f) => PAGE_FACES.includes(f));
/** Names the page's copy of each bundled typeface first in a font stack. */
const BUNDLED = /(^|,)\s*'?(Inter|Instrument Sans|Geist Mono|Barlow|IBM Plex Sans|IBM Plex Mono|Kalam)'?\s*(?=,|$)/g;
const ownFaces = (stack: string) => stack.replace(BUNDLED, (_, lead: string, family: string) => `${lead}${faceName(family)}, ${/\s/.test(family) ? `'${family}'` : family}`);

/** The engine's SVG, cleaned, made to fit the page's width, and with the links a static page can honour. */
function inlineSvg(result: RenderResult, title: string, fonts: boolean, o: DrawOptions): El {
  const svg = parseSvg(result.svg!);
  const g = result.graph!;
  const linksOf = new Map<string, Link[]>();
  for (const n of g.nodes) if (n.links?.length) linksOf.set(`node:${n.id}`, n.links);
  for (const x of g.groups) if (x.links?.length) linksOf.set(`group:${x.id}`, x.links);
  let hasLinks = false;
  // Only links that mean the same on any page: web addresses.
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
  svg.attrs = { ...svg.attrs, ...(fonts ? { 'font-family': ownFaces(family) } : {}), role: hasLinks ? 'group' : 'img', 'aria-label': title, style: 'max-width:100%;height:auto' };
  // A drawing in a theme of its own (Transit, Drafting, classic) carries the typefaces the page stylesheet does not have.
  const extra = fonts ? facesOf(result.theme).filter((f) => !pageFaces(o).includes(f)) : [];
  if (extra.length) svg.children.unshift(el('style', {}, extra.flatMap(faceRules).join('')));
  return svg;
}

/** Shown in the page in place of a drawing that could not be made, so the reader never sees an empty box. */
function problemFigure(problems: Problem[]): El {
  const errors = problems.filter((p) => p.severity === 'error');
  return el(
    'figure',
    { class: 'linework linework-problem', role: 'alert', style: 'margin:1.5em 0;padding:10px 14px;border-left:3px solid #d4372c;background:rgba(212,55,44,.07);text-align:left' },
    el('strong', {}, errors.length > 1 ? 'This diagram has problems' : 'This diagram has a problem'),
    el('ul', { style: 'margin:4px 0 0;padding-left:18px' }, ...errors.slice(0, 8).map((p) => el('li', {}, diagnosticText(p, p.file)))),
  );
}

/** The CSS that goes into the site once: which drawing shows on a light and on a dark page. */
export function pageCss(): string {
  const toDark = (prefix: string) => `${prefix}.linework-light{display:none}${prefix}.linework-dark{display:block}`;
  const toLight = (prefix: string) => `${prefix}.linework-light{display:block}${prefix}.linework-dark{display:none}`;
  return [
    '.linework{margin:1.5em 0}',
    '.linework svg,.linework img{display:block;margin:0 auto;max-width:100%;height:auto;border-radius:8px}',
    '.linework-dark{display:none}',
    `@media (prefers-color-scheme:dark){${toDark('')}}`,
    toDark(':is([data-theme=dark],[data-bs-theme=dark],[data-md-color-scheme=slate],.dark) '),
    toLight(':is([data-theme=light],[data-bs-theme=light],[data-md-color-scheme=default],.light) '),
  ].join('\n');
}

// ---------------------------------------------------------------- a small element tree

export interface El {
  tag: string;
  attrs: Record<string, string>;
  children: (El | string)[];
}

const el = (tag: string, attrs: Record<string, string | undefined> = {}, ...children: (El | string | undefined | false)[]): El => ({
  tag,
  attrs: Object.fromEntries(Object.entries(attrs).filter((e): e is [string, string] => e[1] != null)),
  children: children.filter((c): c is El | string => c !== undefined && c !== false),
});

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== '#') return NAMED[e.toLowerCase()] ?? m;
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });

const TOKEN = /<!--[^]*?-->|<\?[^]*?\?>|<!\[CDATA\[([^]*?)\]\]>|<\/([\w:-]+)\s*>|<([\w:-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Reads an SVG as the engine writes it and keeps only the elements and attributes the renderer draws with. */
function parseSvg(markup: string): El {
  const root: El = { tag: '#root', attrs: {}, children: [] };
  // `kept` is false below an element that is dropped: its whole subtree goes with it.
  const stack: { node: El; kept: boolean }[] = [{ node: root, kept: true }];
  let at = 0;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(markup); m; m = TOKEN.exec(markup)) {
    if (m.index !== at) break;
    at = TOKEN.lastIndex;
    const top = stack.at(-1)!;
    const [, cdata, close, open, attrText, selfClosing, text] = m;
    if (close !== undefined) {
      if (stack.length < 2 || top.node.tag !== close) throw new Error('The drawing could not be read');
      stack.pop();
    } else if (open !== undefined) {
      if (stack.length === 1 && root.children.length) throw new Error('The drawing could not be read');
      const kept = top.kept && SVG_ELEMENTS.has(open) && open !== 'style';
      const node: El = { tag: open, attrs: {}, children: [] };
      for (const a of (attrText ?? '').matchAll(ATTR)) {
        const value = decode(a[2] ?? a[3] ?? '');
        if (safeAttribute(open, a[1]!, value)) node.attrs[a[1]!] = value;
      }
      if (kept) top.node.children.push(node);
      if (!selfClosing) stack.push({ node, kept });
    } else if (top.kept && stack.length > 1) {
      const value = cdata ?? (text !== undefined ? decode(text) : undefined);
      if (value) top.node.children.push(value);
    }
  }
  const svg = root.children.find((c): c is El => typeof c !== 'string');
  if (at !== markup.length || stack.length !== 1 || svg?.tag !== 'svg') throw new Error('The drawing could not be read');
  return svg;
}

function walk(node: El, visit: (child: El, parent: El, index: number) => void) {
  node.children.forEach((c, i) => {
    if (typeof c === 'string') return;
    visit(c, node, i);
    // The visit may have put a link around the element; its own children are still to be seen.
    walk(c, visit);
  });
}

// What sits inside these is not HTML text: it is written as it is (our own CSS only).
const RAW = new Set(['style']);

export function toHtml(node: El | string): string {
  if (typeof node === 'string') return escapeHtml(node);
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${escapeHtml(v)}"`))
    .join('');
  const inner = RAW.has(node.tag)
    ? node.children
        .filter((c) => typeof c === 'string')
        .join('')
        .replace(/<\/?style/gi, '')
    : node.children.map(toHtml).join('');
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
}
