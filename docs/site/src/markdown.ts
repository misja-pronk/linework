// Markdown to HTML for the site: markdown-it with the Cartography plugin (```cartography blocks become
// inline SVG), GitHub-style heading anchors, links rewritten from .md to .html, and YAML examples that
// are whole diagrams drawn right under their code.
import fs from 'node:fs';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import { build, markdownItCartography, toHtml, type CartographyOptions } from '@cartography/docs-plugins';
import { highlight } from './highlight.ts';

export interface Heading {
  level: number;
  text: string;
  id: string;
}

export interface Rendered {
  html: string;
  title: string;
  headings: Heading[];
  /** Plain text per section, for the search index. */
  sections: { id: string; heading: string; text: string }[];
  /** Files outside the markdown the page points at (images), absolute. */
  assets: string[];
}

/** Where a link or image found in a markdown file goes in the site. */
export interface Resolver {
  /** A link to another file (absolute path, with any #fragment kept apart); the href to write. */
  link(abs: string, fragment: string, from: string): string | undefined;
  /** An image; the src to write (the file is copied by the caller). */
  image(abs: string, from: string): string | undefined;
}

/** GitHub's heading ids: lower case, punctuation out, spaces to dashes ("Roadmap & timeline" → "roadmap--timeline"). */
export function slug(text: string, seen: Map<string, number>): string {
  const base = text
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n ? `${base}-${n}` : base;
}

export const options: CartographyOptions = { theme: 'auto', fonts: 'embed', pageStyle: false, strict: false, description: false };

/** The first line that says something, for "is this YAML a whole diagram?" */
const firstLine = (text: string) => text.split('\n').find((l) => l.trim() && !l.trim().startsWith('#'))?.trim() ?? '';

/**
 * YAML blocks that start with `type:` are drawn under their code when they draw without errors: the
 * docs show what the snippet gives. The drawings are made before markdown-it runs (it is synchronous)
 * and slotted in as HTML after the block.
 */
async function drawSnippets(source: string, dir: string, root: string): Promise<string> {
  const lines = source.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^```(ya?ml)\s*$/.exec(lines[i]!);
    if (!open) {
      // Any other fence is copied whole, so a ```yaml inside a ````md example stays code.
      const other = /^(`{3,}|~{3,})/.exec(lines[i]!);
      out.push(lines[i]!);
      if (other) {
        const fence = other[1]!;
        while (++i < lines.length) {
          out.push(lines[i]!);
          if (lines[i]!.startsWith(fence) && !lines[i]!.slice(fence.length).trim()) break;
        }
      }
      continue;
    }
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && lines[j] !== '```') body.push(lines[j++]!);
    const text = body.join('\n') + '\n';
    out.push(...lines.slice(i, j + 1));
    i = j;
    if (!/^type:\s*[\w-]+/.test(firstLine(text)) || /^include:/m.test(text)) continue;
    const built = await build({ text, dir, options: { ...options, root } });
    if (!built.ok || built.problems.some((p) => p.severity === 'error')) continue;
    out.push('', `<div class="result"><div class="result-label">Drawn</div>${toHtml(built.figure)}</div>`, '');
  }
  return out.join('\n');
}

export async function renderMarkdown(file: string, resolver: Resolver, root: string): Promise<Rendered> {
  const dir = path.dirname(file);
  const source = await drawSnippets(fs.readFileSync(file, 'utf8'), dir, root);
  const md = new MarkdownIt({ html: true, linkify: false, typographer: false, highlight: (code, lang) => highlight(code, lang) });
  md.use(markdownItCartography, { ...options, root, warn: (m: string) => console.warn(m) });

  const headings: Heading[] = [];
  const seen = new Map<string, number>();
  const assets: string[] = [];
  md.core.ruler.push('anchors', (state) => {
    for (let i = 0; i < state.tokens.length; i++) {
      const t = state.tokens[i]!;
      if (t.type !== 'heading_open') continue;
      const inline = state.tokens[i + 1]!;
      const text = (inline.children ?? []).filter((c) => c.type === 'text' || c.type === 'code_inline').map((c) => c.content).join('');
      const id = slug(text, seen);
      t.attrSet('id', id);
      headings.push({ level: Number(t.tag.slice(1)), text, id });
    }
  });

  const split = (href: string) => {
    const at = href.indexOf('#');
    return at < 0 ? [href, ''] : [href.slice(0, at), href.slice(at)];
  };
  const external = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//');
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const defaultLink = md.renderer.rules.link_open ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));
  md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
    const t = tokens[idx]!;
    const href = String(t.attrGet('href') ?? '');
    if (external(href)) {
      t.attrSet('rel', 'noopener');
    } else if (href && !href.startsWith('#')) {
      const [p, frag] = split(href);
      const to = resolver.link(path.resolve(dir, decode(p!)), frag!, file);
      if (to) t.attrSet('href', to);
    }
    return defaultLink(tokens, idx, opts, env, self);
  };
  const defaultImage = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, idx, opts, env, self) => {
    const t = tokens[idx]!;
    const src = String(t.attrGet('src') ?? '');
    if (src && !external(src)) {
      const abs = path.resolve(dir, decode(src));
      const to = resolver.image(abs, file);
      if (to) {
        t.attrSet('src', to);
        assets.push(abs);
      }
    }
    t.attrSet('loading', 'lazy');
    return defaultImage(tokens, idx, opts, env, self);
  };
  // Wide tables scroll inside their own box instead of widening the page.
  md.renderer.rules.table_open = () => '<div class="table"><table>\n';
  md.renderer.rules.table_close = () => '</table></div>\n';

  const env = { path: file };
  const tokens = md.parse(source, env);
  const html = md.renderer.render(tokens, md.options, env);

  // Search: the text of each section under its heading.
  const sections: Rendered['sections'] = [];
  let current = { id: '', heading: '', text: [] as string[] };
  let h = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type === 'heading_open') {
      if (current.text.length || current.heading) sections.push({ id: current.id, heading: current.heading, text: current.text.join(' ') });
      const head = headings[h++]!;
      current = { id: head.id, heading: head.text, text: [] };
      i++;
      continue;
    }
    if (t.type === 'inline') current.text.push(t.content.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, ''));
    else if (t.type === 'fence' && !/^carto/.test(t.info)) current.text.push(t.content.slice(0, 400));
  }
  sections.push({ id: current.id, heading: current.heading, text: current.text.join(' ') });

  const title = headings.find((x) => x.level === 1)?.text ?? path.basename(file, '.md');
  return { html, title, headings, sections, assets };
}
