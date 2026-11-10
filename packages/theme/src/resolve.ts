// Turns a theme reference (a name, a file path or an inline block) into a Theme, reading the theme
// file, the files it extends, its fonts and its logo through the caller's loaders (CLI: disk, web: folder).
import { parse } from 'yaml';
import { builtinSpecs, builtinThemes, deriveTheme, mergeSpecs, parseThemeSpec, type ThemeSpec, type ThemeWarning } from './brand.ts';
import { builtinLooks, dark, light } from './builtin.ts';
import type { FontFace, Theme, TitleBlock } from './tokens.ts';

/**
 * Every built-in theme by name. `light` and `dark` are the default look (Survey) in its two modes,
 * so a diagram that says `theme: dark` follows the product's default.
 */
export const themes: { light: Theme; dark: Theme } & Record<string, Theme> = {
  ...Object.fromEntries(Object.entries(builtinLooks).map(([k, v]) => [k, v.theme])),
  ...builtinThemes,
  light,
  dark,
};
export const themeNames = Object.keys(themes);

/** The built-ins in the order a picker shows them, with one line on when to choose each. */
export const themeCatalog: { name: string; description: string; mode: Theme['mode'] }[] = [
  ...Object.entries(builtinLooks).map(([name, v]) => ({ name, description: v.description, mode: v.theme.mode })),
  ...Object.entries(builtinSpecs).map(([name, v]) => ({ name, description: v.description, mode: themes[name]!.mode })),
];

export interface ThemeLoaders {
  /** Text of a file, relative to the diagram; throws when missing. */
  load?: (file: string) => string;
  /** Bytes of a file (fonts, PNG logos); absent where only text can be read. */
  assets?: (file: string) => Uint8Array | undefined;
}

export interface ResolvedTheme {
  theme: Theme;
  warnings: ThemeWarning[];
  /** Theme files read, for watch mode. */
  files: string[];
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
/** A path in a theme file is relative to that file; the loaders take paths relative to the diagram. */
export const joinPath = (from: string, rel: string) => (/^([a-z]:)?[\\/]/i.test(rel) || /^[a-z]+:/i.test(rel) ? rel : normalise(dirOf(from) + rel));
function normalise(p: string): string {
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '..' && out.length && out.at(-1) !== '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
    else if (seg === '' && !out.length) out.push('');
  }
  return out.join('/') || '.';
}

export const isThemeFile = (s: string) => /\.(ya?ml|json)$/i.test(s) || s.includes('/');

/**
 * `value` is what a diagram has under `theme:` (or a --theme flag): light, dark, a built-in name,
 * a path to a theme file, or an inline block with `extends:`. `fallback` is used when it extends nothing.
 */
export function resolveTheme(value: unknown, io: ThemeLoaders, fallback: Theme = light): ResolvedTheme {
  const warnings: ThemeWarning[] = [];
  const files: string[] = [];
  const at = (prefix: (string | number)[], where?: string) => (w: ThemeWarning) => warnings.push({ path: [...prefix, ...w.path], message: where ? `${where}: ${w.message}` : w.message });

  // Collect the chain of specs, innermost last, with the file each one came from (for relative paths).
  const chain: { spec: ThemeSpec; file: string }[] = [];
  let base: Theme | undefined;
  let next: unknown = value;
  let from = '';
  let prefix: (string | number)[] = [];
  for (let depth = 0; next !== undefined && depth < 8; depth++) {
    if (typeof next === 'string') {
      if (themes[next] && (!builtinSpecs[next] || !chain.length)) {
        base = themes[next];
        break;
      }
      if (builtinSpecs[next]) {
        chain.unshift({ spec: builtinSpecs[next]!, file: '' });
        base = themes[builtinSpecs[next]!.extends];
        break;
      }
      if (!isThemeFile(next)) {
        at(prefix)({ path: [], message: `Unknown theme "${next}", use one of: ${themeNames.join(', ')}, or a path to a .theme.yaml file` });
        break;
      }
      const file = joinPath(from, next);
      let text: string;
      try {
        if (!io.load) throw new Error('no files here');
        text = io.load(file);
      } catch {
        at(prefix)({ path: [], message: `Cannot read theme file ${file}` });
        break;
      }
      files.push(file);
      let data: unknown;
      try {
        data = parse(text);
      } catch (e) {
        at(prefix, file)({ path: [], message: `not valid YAML: ${(e as Error).message.split('\n')[0]}` });
        break;
      }
      const spec = parseThemeSpec(data, at(prefix, file));
      chain.unshift({ spec, file });
      from = file;
      next = spec.extends;
    } else {
      const spec = parseThemeSpec(next, at(prefix));
      chain.unshift({ spec, file: from });
      next = spec.extends;
    }
    prefix = [...prefix, 'extends'];
  }
  base ??= fallback;
  if (!chain.length) return { theme: base, warnings, files };

  // Merge outer to inner; relative paths (font files, logo) resolve against the file that names them.
  let spec: ThemeSpec = {};
  let fontFrom = '';
  let monoFrom = '';
  let logoFrom = '';
  let pptxFrom = '';
  for (const c of chain) {
    if (c.spec.pptx) pptxFrom = c.file;
    if (c.spec.font?.files) fontFrom = c.file;
    if (c.spec.font?.mono?.files) monoFrom = c.file;
    if (c.spec.titleBlock?.logo) logoFrom = c.file;
    spec = mergeSpecs(spec, c.spec);
  }
  const top = at([]);
  const faces = spec.font?.files ? loadFaces(spec.font.files, spec.font.family, fontFrom, io, top, files) : undefined;
  const monoFaces = spec.font?.mono?.files ? loadFaces(spec.font.mono.files, spec.font.mono.family, monoFrom, io, top, files, ['font', 'mono']) : undefined;
  const logo = spec.titleBlock?.logo ? loadLogo(joinPath(logoFrom, spec.titleBlock.logo), io, top, files) : undefined;
  const derived = deriveTheme(base, spec, { faces, monoFaces, logo }, top);
  // The template is read by whoever makes the deck; here its path is made relative to the diagram.
  const theme = spec.pptx ? { ...derived, pptx: { ...spec.pptx, template: joinPath(pptxFrom, spec.pptx.template) } } : derived;
  return { theme, warnings, files };
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const utf8 = (s: string) => new TextEncoder().encode(s);

function read(file: string, io: ThemeLoaders, text: boolean): Uint8Array | undefined {
  try {
    const b = io.assets?.(file);
    if (b) return b;
    return text && io.load ? utf8(io.load(file)) : undefined;
  } catch {
    return undefined;
  }
}

const WEIGHTS: [RegExp, number][] = [[/thin|hairline/i, 100], [/extra-?light|ultra-?light/i, 200], [/light/i, 300], [/semi-?bold|demi/i, 600], [/extra-?bold|ultra-?bold/i, 800], [/black|heavy/i, 900], [/bold/i, 700], [/medium/i, 500]];

export function fontFormat(b: Uint8Array): FontFace['format'] | undefined {
  const tag = String.fromCharCode(...b.subarray(0, 4));
  return tag === 'wOF2' ? 'woff2' : tag === 'wOFF' ? 'woff' : tag === 'OTTO' ? 'opentype' : tag === 'true' || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) ? 'truetype' : undefined;
}

/** usWeightClass from the OS/2 table of a TrueType/OpenType file. */
function weightClass(b: Uint8Array): number | undefined {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = v.getUint16(4);
  for (let i = 0; i < n && 12 + i * 16 + 16 <= b.length; i++) {
    const o = 12 + i * 16;
    if (String.fromCharCode(...b.subarray(o, o + 4)) === 'OS/2') return v.getUint16(v.getUint32(o + 8) + 4);
  }
  return undefined;
}

function loadFaces(files: string[] | Record<string, string>, family: string | undefined, from: string, io: ThemeLoaders, warn: (w: ThemeWarning) => void, seen: string[], at: string[] = ['font']): FontFace[] | undefined {
  if (!family) return warn({ path: [...at, 'family'], message: `${at.join('.')}.files needs ${at.join('.')}.family: the name the SVG uses for these files` }), undefined;
  if (!io.assets) return undefined; // The browser editor shows the family if it is installed; the theme picker embeds the files.
  const list = Array.isArray(files) ? files.map((f) => [undefined, f] as const) : Object.entries(files);
  const faces: FontFace[] = [];
  for (const [w, rel] of list) {
    const file = joinPath(from, rel);
    const bytes = read(file, io, false);
    const format = bytes && fontFormat(bytes);
    if (!bytes || !format) {
      warn({ path: [...at, 'files'], message: bytes ? `${file} is not a font (woff2, woff, ttf or otf)` : `Cannot read font ${file}` });
      continue;
    }
    seen.push(file);
    const named = WEIGHTS.find(([re]) => re.test(rel.split('/').pop()!))?.[1] ?? Number(/(?:^|[-_ ])([1-9]00)(?:[-_. ]|$)/.exec(rel.split('/').pop()!)?.[1] ?? 0);
    const weight = Number(w) || named || (format === 'truetype' || format === 'opentype' ? weightClass(bytes) : undefined) || 400;
    faces.push({ family, weight, style: /italic/i.test(rel) ? 'italic' : 'normal', format, data: base64(bytes), file });
  }
  return faces.length ? faces : undefined;
}

/** The logo as a data URI with its aspect ratio (SVG viewBox or width/height, PNG header). */
function loadLogo(file: string, io: ThemeLoaders, warn: (w: ThemeWarning) => void, seen: string[]): TitleBlock['logo'] {
  const bytes = read(file, io, /\.svg$/i.test(file));
  if (!bytes) return warn({ path: ['titleBlock', 'logo'], message: `Cannot read logo ${file}` }), undefined;
  seen.push(file);
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const v = new DataView(bytes.buffer, bytes.byteOffset);
    return { href: `data:image/png;base64,${base64(bytes)}`, width: v.getUint32(16), height: v.getUint32(20) };
  }
  const svg = new TextDecoder().decode(bytes);
  const size = svgSize(svg);
  if (!/<svg[\s>]/.test(svg) || !size) return warn({ path: ['titleBlock', 'logo'], message: `${file}: the logo must be an SVG (with a viewBox) or a PNG` }), undefined;
  return { href: `data:image/svg+xml;base64,${base64(bytes)}`, ...size };
}

export function svgSize(svg: string): { width: number; height: number } | undefined {
  const tag = /<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
  const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(tag);
  if (vb) return { width: Number(vb[1]), height: Number(vb[2]) };
  const w = /\bwidth\s*=\s*["']([\d.]+)(px)?["']/.exec(tag);
  const h = /\bheight\s*=\s*["']([\d.]+)(px)?["']/.exec(tag);
  return w && h ? { width: Number(w[1]), height: Number(h[1]) } : undefined;
}
