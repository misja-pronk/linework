// An SVG that PowerPoint, Word and Keynote take without losing parts. Office reads a small,
// old slice of SVG: no CSS, no filters, masks or clip paths, no markers, no embedded fonts, and
// it does not know paint-order. This rewrites the engine's SVG into that slice: everything as
// plain presentation attributes, text in a system font (or drawn as outlines), and one
// <g id="…"> per node, group and line, so "Convert to shape" gives one group per element.
import { r2, unescapeXml, xmlAttr } from './text.ts';

export interface TextFont {
  mono: boolean;
  weight: number;
  size: number;
  /** Letter-spacing in px. */
  tracking: number;
}

export interface SafeSvgOptions {
  /**
   * Draw text as outlines instead of naming a font: given a run of text, the path of its glyphs
   * with the baseline's start at 0,0, and how far the run advances. Without it, text stays text
   * in a font every machine has.
   */
  outline?: (text: string, font: TextFont) => { d: string; width: number } | undefined;
}

/** Fonts Office finds on Windows and on a Mac. It takes the first name it knows, so the theme's web font cannot lead. */
export const SYSTEM_FONTS = { sans: 'Arial, Helvetica, sans-serif', mono: "'Courier New', Courier, monospace" };

const attrsOf = (s: string) => new Map([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1]!, m[2]!] as [string, string]));
const write = (a: Map<string, string>) => [...a].map(([k, v]) => ` ${k}="${v}"`).join('');

/** CSS properties that are also presentation attributes: what an inline style may be turned into. */
const PRESENTATION = new Set(['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-size', 'font-weight', 'font-style', 'font-family', 'text-anchor', 'letter-spacing', 'visibility', 'display']);

/** `var(--x, fallback)` is its fallback; without one there is nothing to draw with. */
const noVars = (v: string) => v.replace(/var\(\s*--[\w-]+\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, fallback?: string) => fallback?.trim() ?? '');

/** The engine's SVG, rewritten for Office. */
export function toSafeSvg(svg: string, opts: SafeSvgOptions = {}): string {
  let s = svg;
  // Whole elements Office drops or stumbles over. Shadows and the dot grid go with them.
  for (const tag of ['style', 'filter', 'pattern', 'clipPath', 'mask', 'marker', 'foreignObject', 'symbol', 'linearGradient', 'radialGradient', 'script']) s = s.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'g'), '').replace(new RegExp(`<${tag}\\b[^>]*/>`, 'g'), '');
  s = s.replace(/<use\b[^>]*(?:\/>|>[\s\S]*?<\/use>)/g, '');
  // A shape painted with a pattern or gradient that is gone would turn black: leave it out.
  s = s.replace(/<(rect|circle|ellipse|path|polygon)\b[^>]*\sfill="url\([^"]*\)"[^>]*\/>/g, '');
  s = s.replace(/\s(?:filter|clip-path|mask|marker-start|marker-mid|marker-end|text-rendering|class|shape-rendering|dominant-baseline|vector-effect)="[^"]*"/g, '');
  s = s.replace(/\s(fill|stroke)="url\([^"]*\)"/g, ' $1="none"');
  // Inline CSS becomes attributes; custom properties become their fallback.
  s = s.replace(/\sstyle="([^"]*)"/g, (_, css: string) =>
    css
      .split(';')
      .map((d) => d.split(':').map((p) => p.trim()))
      .filter(([k, v]) => k && v && PRESENTATION.has(k) && noVars(v))
      .map(([k, v]) => ` ${k}="${xmlAttr(unescapeXml(noVars(v!)))}"`)
      .join(''),
  );
  s = s.replace(/="([^"]*var\(--[^"]*)"/g, (_, v: string) => `="${noVars(v)}"`);
  // Links: Office has no use for them, and an <a> breaks the grouping.
  s = s.replace(/<a\b[^>]*>/g, '<g>').replace(/<\/a>/g, '</g>');
  s = s.replace(/<defs>\s*<\/defs>/g, '');
  s = s.replace(/<svg\b[^>]*>/, (tag) => tag.replace(/\sfont-family="[^"]*"/, '').replace(/>$/, ` font-family="${SYSTEM_FONTS.sans}">`));
  s = s.replace(/<text\b([^>]*)>([\s\S]*?)<\/text>/g, (_, attrs: string, body: string) => safeText(attrsOf(attrs), body, opts));
  return ids(s);
}

/** A run of text with what it overrides: the engine only nests <tspan> for colour and weight. */
function runs(body: string): { text: string; attrs: Map<string, string> }[] {
  const out: { text: string; attrs: Map<string, string> }[] = [];
  for (const m of body.matchAll(/<tspan\b([^>]*)>([^<]*)<\/tspan>|([^<]+)/g)) out.push(m[3] !== undefined ? { text: m[3], attrs: new Map() } : { text: m[2]!, attrs: attrsOf(m[1]!) });
  return out;
}

function safeText(a: Map<string, string>, body: string, opts: SafeSvgOptions): string {
  const mono = /mono|courier|consolas|menlo/i.test(a.get('font-family') ?? '');
  // A halo (a stroke painted under the fill) needs paint-order. Without it: the halo as its own copy underneath.
  const halo = a.get('paint-order') === 'stroke' && a.has('stroke') ? { color: a.get('stroke')!, width: a.get('stroke-width') ?? '1' } : undefined;
  a.delete('paint-order');
  if (halo) for (const k of ['stroke', 'stroke-width', 'stroke-linejoin', 'stroke-linecap', 'stroke-opacity']) a.delete(k);
  if (!a.has('fill')) a.set('fill', '#000000');

  if (opts.outline) {
    const size = Number(a.get('font-size') ?? 16);
    const tracking = Number(a.get('letter-spacing') ?? 0) || 0;
    const parts = runs(body).map((r) => {
      const weight = Number(r.attrs.get('font-weight') ?? a.get('font-weight') ?? 400) || 400;
      const o = opts.outline!(unescapeXml(r.text), { mono, weight, size, tracking });
      return o && { ...o, fill: r.attrs.get('fill') ?? a.get('fill')! };
    });
    if (parts.every((p) => !!p)) {
      const total = parts.reduce((n, p) => n + p!.width, 0);
      const anchor = a.get('text-anchor');
      let x = Number(a.get('x') ?? 0) - (anchor === 'middle' ? total / 2 : anchor === 'end' ? total : 0);
      const y = Number(a.get('y') ?? 0);
      const keep = new Map([...a].filter(([k]) => !/^(x|y|fill|text-anchor|letter-spacing|font-.*)$/.test(k)));
      let under = '';
      let over = '';
      for (const p of parts) {
        if (p!.d) {
          const at = ` transform="translate(${r2(x)} ${r2(y)})" d="${p!.d}"`;
          if (halo) under += `<path${at} fill="${halo.color}" stroke="${halo.color}" stroke-width="${halo.width}" stroke-linejoin="round"/>`;
          over += `<path${at} fill="${p!.fill}"/>`;
        }
        x += p!.width;
      }
      return `<g${write(keep)}>${under}${over}</g>`;
    }
  }

  a.set('font-family', mono ? SYSTEM_FONTS.mono : SYSTEM_FONTS.sans);
  const text = `<text${write(a)}>${body}</text>`;
  if (!halo) return text;
  const back = new Map(a);
  back.set('fill', halo.color);
  back.set('stroke', halo.color);
  back.set('stroke-width', halo.width);
  back.set('stroke-linejoin', 'round');
  return `<text${write(back)}>${body.replace(/<tspan\b[^>]*>|<\/tspan>/g, '')}</text>${text}`;
}

/** The editor's data-* marks as ids: node-web, group-prod, edge-e3. Unique, and plain enough for any reader. */
function ids(svg: string): string {
  const used = new Set<string>();
  return svg.replace(/<g\b([^>]*)>/g, (all, attrs: string) => {
    const m = /\sdata-(node|group|edge|sheet|step|row)="([^"]*)"/.exec(attrs);
    if (!m) return all.replace(/\sdata-[\w-]+="[^"]*"/g, '');
    const base = `${m[1]}${m[2] ? `-${unescapeXml(m[2]).replace(/[^A-Za-z0-9_.-]+/g, '_')}` : ''}`;
    let id = base;
    for (let k = 2; used.has(id); k++) id = `${base}-${k}`;
    used.add(id);
    return `<g id="${id}"${attrs.replace(/\sdata-[\w-]+="[^"]*"/g, '').replace(/\sid="[^"]*"/, '')}>`;
  });
}

const FORBIDDEN: [string, RegExp][] = [
  ['foreignObject', /<foreignObject\b/],
  ['CSS custom property', /var\(--/],
  ['<style>', /<style\b/],
  ['inline style', /\sstyle="/],
  ['class', /\sclass="/],
  ['embedded font', /@font-face/],
  ['clip-path', /<clipPath\b|\sclip-path=/],
  ['mask', /<mask\b|\smask=/],
  ['filter', /<filter\b|\sfilter=/],
  ['marker', /<marker\b|\smarker-(?:start|mid|end)=/],
  ['pattern', /<pattern\b/],
  ['gradient', /<(?:linear|radial)Gradient\b/],
  ['paint server reference', /url\(#/],
  ['paint-order', /paint-order/],
  ['<use>', /<use\b/],
  ['<symbol>', /<symbol\b/],
  ['link', /<a\b/],
  ['text without a font', /<text\b(?![^>]*\sfont-family=)/],
];

/** What an SVG still holds that Office drops or draws wrong; empty for a safe one. */
export function unsafeConstructs(svg: string): string[] {
  return FORBIDDEN.filter(([, re]) => re.test(svg)).map(([name]) => name);
}
