// `carto describe`, `carto export-md` and `carto export-confluence`: a diagram in words, and a
// diagram (or a folder of them) as pages for a wiki that has no Cartography plugin. Markdown with
// SVG and PNG next to it works on GitHub, GitLab and in Obsidian as plain files; the Confluence
// export writes storage-format pages and their attachments for an import the user runs. No network.
import fs from 'node:fs';
import path from 'node:path';
import { decisionsOnDrawing, isDiagramFile } from '@cartography/core';
import { decisionsFor } from './decisions.ts';
import { altText, describe, escapeHtml, escapeMarkdown, pngWithText, toHtml, toMarkdown, toText, type Description } from '@cartography/describe';
import { render, type RenderOptions, type RenderResult } from '@cartography/engine';

export interface WikiFlags {
  /** What every render of a file gets: theme, packs, sidecar, loader (main's optionsFor). */
  options(file: string): RenderOptions;
  /** SVG to PNG bytes, in the theme's own faces. */
  png(svg: string, result: RenderResult): Promise<Uint8Array>;
  /** A step image per written step (default on). */
  steps?: boolean;
  title?: string;
}

/** The architecture decisions about this drawing (docs/decisions.md), one line each; none when the folder has no decisions. */
function decisionsOf(r: RenderResult, file: string) {
  if (!r.graph) return undefined;
  try {
    const { decisions, rel } = decisionsFor(file);
    if (!decisions.length) return undefined;
    const on = decisionsOnDrawing(decisions, r.graph, { file: rel, view: r.view });
    const seen = [...new Map(on.map((x) => [x.decision.number, x.decision])).values()];
    return seen.map((d) => ({ id: `ADR-${String(d.number).padStart(4, '0')}`, title: d.title, status: d.status }));
  } catch {
    return undefined;
  }
}

/** The words of a drawing, as render gave it, with the decisions about it. */
export const told = (r: RenderResult, file: string): Description => describe({ ...r, name: path.basename(file), decisions: decisionsOf(r, file) });

/** A PNG that carries its title and description (PNG text chunks). */
export async function describedPng(r: RenderResult, file: string, bytes: Uint8Array): Promise<Uint8Array> {
  const d = told(r, file);
  return pngWithText(bytes, { title: d.title, description: toText(d, { title: false }).trim() });
}

/** carto describe: text by default, Markdown or HTML by -o's extension or --format. */
export async function describeFile(file: string, o: { view?: string; allViews?: boolean; format: 'text' | 'md' | 'html'; options: RenderOptions }): Promise<{ text: string; ok: boolean; problems: string[] }> {
  const source = fs.readFileSync(file, 'utf8');
  const first = await render(source, { ...o.options, fonts: 'none', view: o.view });
  const runs = [first, ...(o.allViews && !o.view ? await Promise.all((first.views ?? []).filter((v) => v.name !== first.view).map((v) => render(source, { ...o.options, fonts: 'none', view: v.name }))) : [])].filter((r) => r.graph && !r.empty);
  const problems = [first, ...runs].flatMap((r) => r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message));
  const parts = runs.map((r, i) => {
    const d = told(r, file);
    if (o.format === 'md') return toMarkdown(d, { level: i ? 2 : 1 });
    if (o.format === 'html') return toHtml(d, { level: i ? 2 : 1 });
    return toText(d);
  });
  return { text: parts.join(o.format === 'html' ? '\n' : '\n'), ok: !problems.length && !!runs.length, problems: [...new Set(problems)] };
}

// ------------------------------------------------------------------ the pages

/** Diagram files under a folder, relative with forward slashes; not hidden folders, node_modules or snapshots. */
export function diagramsIn(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name.endsWith('.snapshots')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...diagramsIn(p, base));
    else if (/\.ya?ml$/i.test(e.name) && isDiagramFile(e.name, fs.readFileSync(p, 'utf8'))) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

/** A name that is safe in a URL, a wiki and every file system: lower case, letters, digits and dashes. */
export const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.ya?ml$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'diagram';

interface Picture {
  svg: string;
  png: string;
  alt: string;
  width: number;
}

interface Part {
  /** Heading: the drawing's or the view's title. */
  title: string;
  view?: string;
  picture: Picture;
  words: Description;
  steps: { title: string; caption?: string; picture?: Picture }[];
}

interface Page {
  file: string;
  name: string;
  title: string;
  summary: string;
  parts: Part[];
  /** Files written for it, by name, relative to its folder of pictures. */
  files: Map<string, Uint8Array | string>;
  problems: string[];
}

/** Every drawing of one diagram file (as written and each view), drawn as SVG and PNG with its words. */
async function pageOf(root: string, rel: string, flags: WikiFlags, used: Set<string>): Promise<Page> {
  const file = path.join(root, rel);
  const text = fs.readFileSync(file, 'utf8');
  const opts = { ...flags.options(file), fonts: 'embed' as const };
  let name = slug(rel);
  for (let n = 2; used.has(name); n++) name = `${slug(rel)}-${n}`;
  used.add(name);
  const first = await render(text, opts);
  const views = (first.views ?? []).filter((v) => v.name !== first.view);
  const runs = [first, ...(await Promise.all(views.map((v) => render(text, { ...opts, view: v.name }))))].filter((r) => r.svg && !r.empty);
  const problems = [...new Set([first, ...runs].flatMap((r) => r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)))];
  const files = new Map<string, Uint8Array | string>();
  const picture = async (r: RenderResult, base: string, words: Description, alt?: string): Promise<Picture> => {
    files.set(`${base}.svg`, r.svg!);
    files.set(`${base}.png`, pngWithText(await flags.png(r.svg!, r), { title: words.title, description: alt ?? toText(words, { title: false }).trim() }));
    return { svg: `${base}.svg`, png: `${base}.png`, alt: alt ?? altText(words, 1), width: r.width ?? 0 };
  };
  const parts: Part[] = [];
  for (const r of problems.length ? [] : runs) {
    const words = told(r, file);
    const base = r === first ? name : `${name}-${slug(r.view ?? 'view')}`;
    const steps: Part['steps'] = [];
    // Written steps each get a picture of their own; steps nobody wrote are the drawing told in order, already in the words.
    if (flags.steps !== false && r.steps?.length && !r.stepsImplied)
      for (const [i, s] of r.steps.entries()) {
        const at = await render(text, { ...opts, view: r.view, step: i + 1 });
        const title = s.title ?? `Step ${i + 1}`;
        steps.push({ title, ...(s.caption ? { caption: s.caption } : {}), ...(at.svg ? { picture: await picture(at, `${base}-step-${String(i + 1).padStart(2, '0')}`, words, `${words.title}, step ${i + 1} of ${r.steps.length}: ${[s.title, s.caption].filter(Boolean).join('. ')}`) } : {}) });
      }
    // With a section per step (and its picture), the walkthrough list would say the same twice.
    const shown = steps.length ? { ...words, sections: words.sections.filter((x) => x.heading !== 'Walkthrough') } : words;
    parts.push({ title: r === first ? words.title : (r.views?.find((v) => v.name === r.view)?.title ?? words.title), ...(r !== first && r.view ? { view: r.view } : {}), picture: await picture(r, base, words), words: shown, steps });
  }
  const d = parts[0]?.words;
  return { file: rel, name, title: d?.title ?? rel, summary: d?.summary ?? '', parts, files, problems };
}

function writeFiles(dir: string, files: Map<string, Uint8Array | string>) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [n, data] of files) fs.writeFileSync(path.join(dir, n), data);
}

export interface WikiResult {
  pages: { file: string; out: string; title: string; drawings: number; problems: string[] }[];
  written: string[];
}

/** The pages of a file or a folder, in order; problems keep a page out. */
async function pagesOf(target: string, flags: WikiFlags) {
  const folder = fs.statSync(target).isDirectory();
  const root = folder ? path.resolve(target) : path.dirname(path.resolve(target));
  const entries = folder ? diagramsIn(root) : [path.basename(target)];
  const used = new Set<string>(['readme', 'index', 'images']);
  const pages: Page[] = [];
  for (const rel of entries) pages.push(await pageOf(root, rel, flags, used));
  return { folder, root, pages };
}

// ------------------------------------------------------------------ Markdown

/** Paths in Markdown links: forward slashes, spaces and brackets encoded, so GitHub, GitLab and Obsidian all follow them. */
const href = (p: string) => p.split('/').map(encodeURIComponent).join('/');
const altMd = (s: string) => s.replace(/[[\]\\]/g, '\\$&').replace(/\s+/g, ' ');

function pictureMd(p: Picture, images: string): string {
  return `![${altMd(p.alt)}](${href(`${images}/${p.svg}`)})\n\n[PNG](${href(`${images}/${p.png}`)}) · [SVG](${href(`${images}/${p.svg}`)})`;
}

function pageMd(page: Page, images: string, back?: string): string {
  const out: string[] = [];
  if (back) out.push(`[← All diagrams](${href(back)})`, '');
  out.push(`# ${escapeMarkdown(page.title)}`, '');
  for (const [i, part] of page.parts.entries()) {
    const level = i ? 2 : 1;
    if (i) out.push(`## ${escapeMarkdown(part.title)}`, '');
    out.push(pictureMd(part.picture, images), '');
    out.push(toMarkdown(part.words, { title: false, level }).trim(), '');
    if (part.steps.length) {
      out.push(`${'#'.repeat(level + 1)} Step by step`, '');
      for (const [n, s] of part.steps.entries()) {
        out.push(`${'#'.repeat(level + 2)} ${n + 1}. ${escapeMarkdown(s.title)}`, '');
        if (s.caption) out.push(escapeMarkdown(s.caption), '');
        if (s.picture) out.push(pictureMd(s.picture, images), '');
      }
    }
  }
  out.push(`<sub>Made with Cartography from \`${page.file}\`.</sub>`, '');
  return out.join('\n');
}

/**
 * carto export-md: one file is dir/README.md; a folder is dir/README.md as an index and one page per
 * diagram beside it. Pictures go in dir/images/.
 */
export async function exportMarkdown(target: string, out: string, flags: WikiFlags): Promise<WikiResult> {
  const { folder, pages } = await pagesOf(target, flags);
  const dir = path.resolve(out);
  const written: string[] = [];
  const result: WikiResult['pages'] = [];
  const drawn = pages.filter((p) => p.parts.length);
  for (const page of drawn) {
    const md = folder ? `${page.name}.md` : 'README.md';
    writeFiles(path.join(dir, 'images'), page.files);
    fs.writeFileSync(path.join(dir, md), pageMd(page, 'images', folder ? 'README.md' : undefined));
    written.push(md, ...[...page.files.keys()].map((f) => `images/${f}`));
    result.push({ file: page.file, out: md, title: page.title, drawings: page.parts.length, problems: [] });
  }
  for (const page of pages.filter((p) => !p.parts.length)) result.push({ file: page.file, out: '', title: page.title, drawings: 0, problems: page.problems.length ? page.problems : ['nothing to draw'] });
  if (folder) {
    const title = flags.title ?? path.basename(path.resolve(target));
    const index = [`# ${escapeMarkdown(title)}`, '', `${drawn.length} ${drawn.length === 1 ? 'diagram' : 'diagrams'}, each with its pictures and a description in words.`, '', ...drawn.map((p) => `- [${altMd(p.title)}](${href(`${p.name}.md`)}): ${escapeMarkdown(p.summary)}`), ''];
    fs.writeFileSync(path.join(dir, 'README.md'), index.join('\n'));
    written.unshift('README.md');
  }
  return { pages: result, written };
}

// ------------------------------------------------------------------ Confluence

/** Confluence storage format is XHTML: every attribute quoted, every element closed, entities limited to XML's own. */
const xml = (s: string) => escapeHtml(s).replace(/'/g, '&#39;');

function imageXhtml(p: Picture): string {
  // An image from the page's own attachments, as Confluence imports it; the SVG is attached beside it.
  const width = p.width ? ` ac:width="${Math.min(1200, Math.round(p.width))}"` : '';
  return `<p><ac:image ac:alt="${xml(p.alt)}"${width}><ri:attachment ri:filename="${xml(p.png)}" /></ac:image></p>\n<p><ac:link><ri:attachment ri:filename="${xml(p.svg)}" /><ac:plain-text-link-body><![CDATA[SVG]]></ac:plain-text-link-body></ac:link></p>`;
}

/** The description as XHTML that Confluence keeps: headings, paragraphs, lists. */
const wordsXhtml = (d: Description, level: number) => toHtml(d, { title: false, level }).replace(/&quot;/g, '&#34;');

function pageXhtml(page: Page): string {
  const out: string[] = [];
  for (const [i, part] of page.parts.entries()) {
    const level = i ? 2 : 1;
    if (i) out.push(`<h2>${xml(part.title)}</h2>`);
    out.push(imageXhtml(part.picture), wordsXhtml(part.words, level));
    if (part.steps.length) {
      out.push(`<h${level + 1}>Step by step</h${level + 1}>`);
      for (const [n, s] of part.steps.entries()) {
        out.push(`<h${level + 2}>${n + 1}. ${xml(s.title)}</h${level + 2}>`);
        if (s.caption) out.push(`<p>${xml(s.caption)}</p>`);
        if (s.picture) out.push(imageXhtml(s.picture));
      }
    }
  }
  out.push(`<p><sub>Made with Cartography from <code>${xml(page.file)}</code>.</sub></p>`);
  return out.join('\n') + '\n';
}

/** The same page as plain HTML with relative images: for an HTML importer, a browser, or copy and paste. */
function pageHtml(page: Page): string {
  const img = (p: Picture) => `<p><img src="${xml(p.png)}" alt="${xml(p.alt)}"${p.width ? ` width="${Math.min(1200, Math.round(p.width))}"` : ''} /></p>`;
  const body = page.parts.map((part, i) => [i ? `<h2>${xml(part.title)}</h2>` : '', img(part.picture), toHtml(part.words, { title: false, level: i ? 2 : 1 }), ...(part.steps.length ? [`<h${i ? 3 : 2}>Step by step</h${i ? 3 : 2}>`, ...part.steps.flatMap((s, n) => [`<h${i ? 4 : 3}>${n + 1}. ${xml(s.title)}</h${i ? 4 : 3}>`, s.caption ? `<p>${xml(s.caption)}</p>` : '', s.picture ? img(s.picture) : ''])] : [])].filter(Boolean).join('\n'));
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8" /><title>${xml(page.title)}</title></head><body>\n<h1>${xml(page.title)}</h1>\n${body.join('\n')}\n</body></html>\n`;
}

const IMPORT_README = (title: string, pages: { title: string; dir: string; attachments: string[] }[]) => `# ${title}: pages for Confluence

Made with \`carto export-confluence\`. Nothing here was sent anywhere: you choose how it goes in.

${pages.map((p) => `- \`${p.dir}/\`: ${p.title} (${p.attachments.length} attachments)`).join('\n')}

Each folder holds one page:

- \`page.xhtml\`: the page body in Confluence storage format. Its pictures are the page's own attachments
  (\`<ri:attachment ri:filename="…"/>\`), so attach the files of the folder to the page under the same names.
- \`page.html\`: the same page as plain HTML with the pictures beside it, for an HTML importer, or to open
  in a browser and copy into the editor.
- the PNG and SVG files: the attachments. Each PNG carries its title and description; the SVG is attached
  for anyone who wants the vector drawing.

\`manifest.json\` lists every page with its title, body file and attachments, for a script.

## With the REST API (any edition, your own tool)

For each page in \`manifest.json\`, with your own credentials:

1. Create the page: \`POST /wiki/rest/api/content\` (Data Center: \`/rest/api/content\`) with
   \`{"type": "page", "title": …, "space": {"key": …}, "body": {"storage": {"value": <page.xhtml>, "representation": "storage"}}}\`.
   For a folder export, create the page of \`index.xhtml\` first and give the others \`"ancestors": [{"id": <its id>}]\`.
2. Upload the attachments to it: \`POST …/content/<page id>/child/attachment\`, multipart, one \`file\`
   field per file, with the header \`X-Atlassian-Token: no-check\`.

The images show as soon as the attachments are there: the body names them by file name.

## By hand

1. Create a page and open the editor.
2. Open \`page.html\` in a browser, select all and paste it into the page; or use "Copy for Confluence /
   Notion" in the Cartography editor, which puts the picture and the words on the clipboard in one go.
3. Where your Confluence offers an import (Word, or an HTML importer on Data Center), \`page.html\`
   with its pictures is what to give it.
`;

/**
 * carto export-confluence: dir/<page>/page.xhtml (storage format) and page.html with the pictures
 * as attachments, dir/manifest.json, dir/README.md on how to import; a folder adds dir/index.xhtml,
 * a parent page that lists its children.
 */
export async function exportConfluence(target: string, out: string, flags: WikiFlags): Promise<WikiResult> {
  const { folder, pages } = await pagesOf(target, flags);
  const dir = path.resolve(out);
  const written: string[] = [];
  const result: WikiResult['pages'] = [];
  const manifest: { title: string; dir: string; body: string; html: string; attachments: string[]; source: string; parent?: string }[] = [];
  const title = flags.title ?? (folder ? path.basename(path.resolve(target)) : (pages[0]?.title ?? 'Diagram'));
  for (const page of pages) {
    if (!page.parts.length) {
      result.push({ file: page.file, out: '', title: page.title, drawings: 0, problems: page.problems.length ? page.problems : ['nothing to draw'] });
      continue;
    }
    const at = path.join(dir, page.name);
    writeFiles(at, page.files);
    fs.writeFileSync(path.join(at, 'page.xhtml'), pageXhtml(page));
    fs.writeFileSync(path.join(at, 'page.html'), pageHtml(page));
    const attachments = [...page.files.keys()];
    written.push(`${page.name}/page.xhtml`, `${page.name}/page.html`, ...attachments.map((f) => `${page.name}/${f}`));
    manifest.push({ title: page.title, dir: page.name, body: `${page.name}/page.xhtml`, html: `${page.name}/page.html`, attachments, source: page.file, ...(folder ? { parent: 'index.xhtml' } : {}) });
    result.push({ file: page.file, out: `${page.name}/page.xhtml`, title: page.title, drawings: page.parts.length, problems: [] });
  }
  if (folder) {
    const list = manifest.map((m) => `<li>${xml(m.title)}: ${xml(pages.find((p) => p.name === m.dir)!.summary)}</li>`).join('');
    fs.writeFileSync(path.join(dir, 'index.xhtml'), `<p>${manifest.length} ${manifest.length === 1 ? 'diagram' : 'diagrams'}, each on a page of its own with its pictures and a description in words.</p>\n<ul>${list}</ul>\n<ac:structured-macro ac:name="children" ac:schema-version="2" />\n`);
    written.unshift('index.xhtml');
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ title, ...(folder ? { index: 'index.xhtml' } : {}), pages: manifest }, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'README.md'), IMPORT_README(title, manifest));
  written.push('manifest.json', 'README.md');
  return { pages: result, written };
}
