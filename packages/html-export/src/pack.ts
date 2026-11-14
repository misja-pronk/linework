// The page itself: one HTML file with the drawings (gzipped, in a data block), the fonts, the
// stylesheet and the viewer script inline, and a Content-Security-Policy that allows exactly those
// two inline blocks and data: pictures and fonts, nothing else: no network, no eval, no handlers.
import { gzipSync, strToU8 } from 'fflate';
import { bundledFont, themes, type Theme } from '@linework/theme';
import { escapeHtml } from '@linework/embed/shared';
import type { Collected } from './collect.ts';
import type { Payload, Picture } from './payload.ts';
import { pageCss, tokens } from './style.ts';
import { viewerScript } from './generated/viewer.ts';

/** Bytes as base64, in chunks (a spread of a large array overflows the stack). */
export function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The value of a CSP hash source for an inline block. */
export async function cspHash(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', strToU8(text));
  return `'sha256-${base64(new Uint8Array(digest))}'`;
}

/**
 * Pictures that repeat in many drawings (official icons are data: URIs, often several kB each) go in
 * one table; the SVGs point at them by number and the viewer puts them back.
 */
export function shareIcons(pictures: Picture[]): string[] {
  const table: string[] = [];
  const at = new Map<string, number>();
  const swap = (svg: string) =>
    svg.replace(/\s(?:xlink:)?href="(data:image\/[^"]{256,})"/g, (_, uri: string) => {
      let n = at.get(uri);
      if (n === undefined) at.set(uri, (n = table.push(uri) - 1));
      return ` data-linework-icon="${n}"`;
    });
  for (const p of pictures) {
    p.light = swap(p.light);
    if (p.dark) p.dark = swap(p.dark);
  }
  return table;
}

/** @font-face rules for the faces the drawings are set in: bundled families (latin subsets) and a brand's files. */
export function fontCss(list: Theme[]): string {
  const rules = new Map<string, string>();
  const mime = { woff2: 'font/woff2', woff: 'font/woff', truetype: 'font/ttf', opentype: 'font/otf' } as const;
  for (const t of list) {
    for (const f of t.font.faces ?? []) {
      const family = f.family.replace(/['"\\;{}<>]/g, '');
      rules.set(`${family}/${f.weight}/${f.style}`, `@font-face{font-family:'${family}';font-style:${f.style};font-weight:${f.weight};font-display:block;src:url(data:${mime[f.format]};base64,${f.data}) format('${f.format}')}`);
    }
    for (const name of [t.font.sans ?? 'Inter', t.font.monoFace]) {
      const f = bundledFont(name);
      if (!f) continue;
      for (const [w, b64] of Object.entries(f.woff2)) rules.set(`${f.family}/${w}/normal`, `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2')}`);
    }
  }
  return [...rules.values()].join('\n');
}

export interface PageStats {
  bytes: number;
  drawings: number;
  steps: number;
  elements: number;
  /** Bytes of each part of the file. */
  parts: { drawings: number; fonts: number; script: number; style: number };
}

export async function toPage(c: Collected, opts: { date?: Date } = {}): Promise<{ html: string; stats: PageStats }> {
  const pictures = c.drawings.flatMap((d) => [d, ...(d.steps ?? [])]);
  const icons = shareIcons(pictures);
  const payload: Payload = {
    v: 1,
    title: c.title,
    ...(c.subtitle ? { subtitle: c.subtitle } : {}),
    site: c.site,
    made: (opts.date ?? new Date()).toISOString().slice(0, 10),
    files: c.files,
    drawings: c.drawings,
    elements: c.elements,
    icons,
  };
  // mtime 0: the same diagrams give the same file.
  const data = base64(gzipSync(strToU8(JSON.stringify(payload)), { level: 9, mtime: 0 }));
  const light = c.themes.find((t) => t.mode === 'light') ?? themes.light!;
  const dark = c.themes.find((t) => t.mode === 'dark') ?? themes.dark!;
  const fonts = fontCss([light, dark, ...c.themes]);
  const style = `${fonts}\n${pageCss(tokens(light), tokens(dark))}`;
  const script = viewerScript;
  const csp = [
    "default-src 'none'",
    `script-src ${await cspHash(script)}`,
    `style-src ${await cspHash(style)}`,
    'img-src data:',
    'font-src data:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  const title = escapeHtml(c.title);
  const html = `<!doctype html>
<html lang="${c.lang ?? 'en'}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="referrer" content="no-referrer">
<meta name="generator" content="Linework">
<title>${title}</title>
<style>${style}</style>
</head>
<body>
<noscript><p>${title}: this page shows its diagrams with JavaScript, which is off in this browser.</p></noscript>
<script type="application/gzip+json;base64" id="linework-data">${data}</script>
<script>${script}</script>
</body>
</html>
`;
  const bytes = strToU8(html).length;
  return {
    html,
    stats: {
      bytes,
      drawings: c.drawings.length,
      steps: c.drawings.reduce((s, d) => s + (d.steps?.length ?? 0), 0),
      elements: c.elements.filter((e) => e.where.length).length,
      parts: { drawings: data.length, fonts: fonts.length, script: script.length, style: style.length - fonts.length },
    },
  };
}
