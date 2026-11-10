// `carto embed`: a diagram as a web page that carries everything, or as the figure to put in a page
// of your own (what the docs plugins write, for sites they do not cover).
import fs from 'node:fs';
import path from 'node:path';
import { build, pageCss, toHtml, type CartographyOptions, type Problem } from '@cartography/docs-plugins';
import { escapeHtml } from '@cartography/embed/shared';
import { readPack } from './packs.ts';

export interface EmbedFlags {
  view?: string;
  theme?: string;
  /** The name read out for the drawing; the diagram's own title when left out. */
  title?: string;
  /** Only the figure, no page around it. */
  fragment?: boolean;
  /** No zoom and drill-down: the drawing alone, a few kB. */
  static?: boolean;
  /** official or lucide, over the diagram's icons:. */
  icons?: 'official' | 'lucide';
  /** The language of the drawing's own words when the diagram has no lang: (--lang, CARTO_LANG). */
  lang?: CartographyOptions['lang'];
}

export interface Embedded {
  ok: boolean;
  problems: Problem[];
  /** The page or the figure; with errors, the message a reader would see. */
  html: string;
}

/** `file` is a diagram, or "-" for YAML on standard input (its includes are read from the current folder). */
export async function embed(file: string, flags: EmbedFlags): Promise<Embedded> {
  const stdin = file === '-';
  const abs = path.resolve(file);
  const options: CartographyOptions = { theme: flags.theme ?? 'auto', view: flags.view, interactive: !flags.static, description: true, strict: false, root: path.parse(abs).root, iconPack: readPack, icons: flags.icons, lang: flags.lang };
  const built = await build(
    stdin
      ? { text: fs.readFileSync(0, 'utf8'), dir: process.cwd(), title: flags.title, options: { ...options, root: path.parse(process.cwd()).root } }
      : { file: abs, dir: path.dirname(abs), title: flags.title, options },
  );
  const figure = toHtml(built.figure);
  if (flags.fragment) return { ok: built.ok, problems: built.problems, html: figure + '\n' };

  const title = /aria-label="([^"]*)"/.exec(figure)?.[1] ?? escapeHtml(path.basename(file));
  // The component and the engine in the page itself: one file that works from disk, without a network.
  const script =
    flags.static || !built.ok
      ? ''
      : `<script type="module">${(await (await import('@cartography/embed/build')).standaloneScript()).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--')}</script>\n`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${title}</title>
<style>
body{margin:0;padding:24px;background:#fff;color:#1b2330;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
@media (prefers-color-scheme:dark){body{background:#0d1117;color:#e8ecf3}}
main{max-width:1200px;margin:0 auto}
${pageCss({ dark: 'media' })}
</style>
</head>
<body>
<main>
${figure}
</main>
${script}</body>
</html>
`;
  return { ok: built.ok, problems: built.problems, html };
}

/** The stylesheet that goes with the figures, once per page or once per site. */
export const embedCss = () => pageCss() + '\n';
