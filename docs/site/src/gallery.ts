// The template gallery: every type's template and every file in examples/, drawn light and dark,
// grouped by type, with what the type is for (from docs/types.md), the YAML, and a link that opens the
// diagram in the web app. Made from the folders, so a new example appears on the next build.
import fs from 'node:fs';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import { encodeShare } from '@cartography/core';
import { build, toHtml } from '@cartography/docs-plugins';
import { render, types } from '@cartography/engine';
import { icon as lucide } from '@cartography/icons';
import { escape } from './highlight.ts';
import { icon } from './layout.ts';
import { options, slug } from './markdown.ts';

export interface Card {
  id: string;
  title: string;
  /** Where the YAML came from: "examples/erd/orders.yaml" or "template". */
  source: string;
  yamlHref: string;
  view?: string;
  figure: string;
  share?: string;
  /** Why there is no share link. */
  noShare?: string;
  nodes: number;
  /** Width over height of the drawing: wide ones get a row of their own. */
  aspect: number;
}

export interface TypeEntry {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  use: string;
  notFor: string;
  docHref?: string;
  cards: Card[];
}

const inline = new MarkdownIt({ html: false });

/** "Use it for …" and "Not for: …" for each `type: id` section of docs/types.md, with its anchor. */
export function typeGuide(root: string): Map<string, { anchor: string; use: string; notFor: string }> {
  const text = fs.readFileSync(path.join(root, 'docs/types.md'), 'utf8');
  const seen = new Map<string, number>();
  const out = new Map<string, { anchor: string; use: string; notFor: string }>();
  // Anchors are counted over every heading, as the docs page counts them.
  const headings = [...text.matchAll(/^#{1,6} (.+)$/gm)].map((m) => ({ at: m.index!, anchor: slug(m[1]!, seen) }));
  for (const h of headings) {
    const next = headings.find((x) => x.at > h.at)?.at ?? text.length;
    const body = text.slice(h.at, next);
    const id = /^`type: ([\w-]+)`/m.exec(body)?.[1];
    if (!id || out.has(id)) continue;
    const para = (re: RegExp) => body.split(/\n\n+/).find((p) => re.test(p.trim()))?.trim() ?? '';
    out.set(id, { anchor: h.anchor, use: para(/^Use it /), notFor: para(/^Not for:/).replace(/^Not for:\s*/, '') });
  }
  return out;
}

const typeOf = (text: string) => /^type:\s*([\w-]+)/m.exec(text)?.[1];
const titleOf = (text: string) => /^title:\s*(.+)$/m.exec(text)?.[1]?.trim().replace(/^['"]|['"]$/g, '');

/** A link into the web app with the diagram in the fragment, or the reason there cannot be one. */
async function shareOf(text: string, name: string, app: string): Promise<{ share?: string; noShare?: string }> {
  if (/^include:/m.test(text)) return { noShare: 'This example includes other files: open its folder in the editor, or pick it under New → Examples.' };
  return { share: `${app}#share=${await encodeShare({ yaml: text, name })}` };
}

export interface GalleryOptions {
  root: string;
  out: string;
  /** The web app's index.html, relative to the gallery pages. */
  app: string;
}

export async function buildGallery(o: GalleryOptions): Promise<TypeEntry[]> {
  const guide = typeGuide(o.root);
  const byType = new Map<string, TypeEntry>();
  const entry = (id: string): TypeEntry => {
    let e = byType.get(id);
    if (e) return e;
    const t = types.find((x) => x.id === id);
    const g = guide.get(id);
    e = {
      id,
      name: t?.name ?? (id === 'model' ? 'Model' : id),
      tagline: t?.tagline ?? (id === 'model' ? 'Systems described once and drawn in many views' : ''),
      icon: t?.icon ?? 'library',
      use: g ? inline.renderInline(g.use) : t?.useWhen ? escape(t.useWhen.join('. ')) + '.' : id === 'model' ? 'Use it to describe systems and their parts once, and draw context, container and deployment diagrams from it with <code>include:</code> and <code>views:</code>.' : '',
      notFor: g ? inline.renderInline(g.notFor) : (t?.notFor ?? []).map((n) => escape(n.text) + (n.use ? ` (use <code>${escape(n.use)}</code>)` : '')).join(', '),
      docHref: g ? `types.html#${g.anchor}` : id === 'model' ? 'model.html' : undefined,
      cards: [],
    };
    byType.set(id, e);
    return e;
  };
  // The engine's order of types, so the gallery reads like the type guide.
  for (const t of types) entry(t.id);

  const yamlDir = path.join(o.out, 'gallery/yaml');
  const draw = async (text: string, file: string | undefined, dir: string, view?: string) => {
    const built = await build({ ...(file ? { file } : { text }), dir, options: { ...options, root: o.root }, ...(view ? { view } : {}) });
    const errors = built.problems.filter((p) => p.severity === 'error');
    if (!built.ok || errors.length) throw new Error(`${file ?? 'template'}${view ? `#${view}` : ''}: ${errors.map((e) => e.message).join('; ') || 'not drawn'}`);
    return toHtml(built.figure);
  };

  for (const t of types) {
    const e = entry(t.id);
    const name = `${t.id}.yaml`;
    fs.mkdirSync(path.join(yamlDir, 'templates'), { recursive: true });
    fs.writeFileSync(path.join(yamlDir, 'templates', name), t.template);
    const r = await render(t.template, { fonts: 'none' });
    e.cards.push({
      id: `template-${t.id}`,
      title: 'Template',
      source: `carto new ${t.id}`,
      yamlHref: `yaml/templates/${name}`,
      figure: await draw(t.template, undefined, o.root),
      nodes: r.graph?.nodes.length ?? 0,
      aspect: (r.width ?? 1) / (r.height ?? 1),
      ...(await shareOf(t.template, name, o.app)),
    });
  }

  const examples = path.join(o.root, 'examples');
  for (const dir of fs.readdirSync(examples).sort()) {
    if (!fs.statSync(path.join(examples, dir)).isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(examples, dir)).filter((x) => /\.ya?ml$/.test(x)).sort()) {
      const file = path.join(examples, dir, f);
      const text = fs.readFileSync(file, 'utf8');
      const type = typeOf(text);
      if (!type) continue;
      const e = entry(type);
      fs.mkdirSync(path.join(yamlDir, dir), { recursive: true });
      fs.writeFileSync(path.join(yamlDir, dir, f), text);
      const load = (rel: string) => fs.readFileSync(path.resolve(path.dirname(file), rel), 'utf8');
      const first = await render(text, { fonts: 'none', load, file: f });
      // A C4 model is one file with many views: each is a card of its own.
      const views = type === 'c4' ? (first.views ?? []).map((v) => v.name) : [undefined];
      for (const view of views) {
        const r = view ? await render(text, { fonts: 'none', load, file: f, view }) : first;
        e.cards.push({
          id: `${dir}-${f.replace(/\.ya?ml$/, '')}${view ? `-${view}` : ''}`,
          title: (r.graph?.title || titleOf(text) || f) + (view ? '' : ''),
          source: `examples/${dir}/${f}`,
          yamlHref: `yaml/${dir}/${f}`,
          ...(view ? { view } : {}),
          figure: await draw(text, file, path.dirname(file), view),
          nodes: r.graph?.nodes.length ?? 0,
          aspect: (r.width ?? 1) / (r.height ?? 1),
          ...(await shareOf(text, f, o.app)),
        });
      }
    }
  }
  return [...byType.values()].filter((e) => e.cards.length);
}

export const typeIcon = (name: string) => icon(lucide(name) ?? lucide('layers') ?? '', 'i type-icon');

const OPEN = icon('<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>');
const CODE = icon('<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>');

function cardHtml(c: Card): string {
  const open = c.share
    ? `<a class="button primary" href="${escape(c.share)}" target="_blank" rel="noopener">${OPEN}Open in the editor</a>`
    : `<span class="button disabled" title="${escape(c.noShare ?? '')}">${OPEN}Open in the editor</span>`;
  return `<article class="card${c.aspect > 1.3 ? ' wide' : ''}" id="${escape(c.id)}">
  <div class="card-drawing">${c.figure}</div>
  <div class="card-meta">
    <div><h3>${escape(c.title)}${c.view ? ` <span class="chip">view: ${escape(c.view)}</span>` : ''}</h3><p class="mono">${escape(c.source)}</p></div>
    <div class="card-actions"><a class="button" href="${escape(c.yamlHref)}">${CODE}YAML</a>${open}</div>
  </div>
  ${c.noShare ? `<p class="card-note">${escape(c.noShare)}</p>` : ''}
</article>`;
}

/** One page per type. */
export function typePage(e: TypeEntry, all: TypeEntry[]): string {
  const chips = all.map((x) => `<a class="chip${x.id === e.id ? ' on' : ''}" href="${x.id}.html">${escape(x.name)}</a>`).join('');
  return `<nav class="type-chips" aria-label="Types">${chips}</nav>
<header class="type-head">
  <div class="type-badge">${typeIcon(e.icon)}</div>
  <div>
    <p class="eyebrow">Gallery · <code>type: ${escape(e.id)}</code></p>
    <h1>${escape(e.name)}</h1>
    <p class="lede">${escape(e.tagline)}</p>
  </div>
</header>
<section class="pick">
  <div><h2>Pick it when</h2><p>${e.use}</p></div>
  ${e.notFor ? `<div><h2>Not for</h2><p>${e.notFor}</p></div>` : ''}
  ${e.docHref ? `<p class="pick-more"><a href="../${e.docHref}">How to pick a type →</a></p>` : ''}
</section>
<p class="count">${e.cards.length} drawing${e.cards.length === 1 ? '' : 's'}, each in light and dark: switch with the button at the top.</p>
<div class="cards">${e.cards.map(cardHtml).join('\n')}</div>`;
}

/** The overview: one tile per type with its first drawing. */
export function galleryIndex(all: TypeEntry[]): string {
  const total = all.reduce((n, e) => n + e.cards.length, 0);
  const tiles = all
    .map((e) => {
      // The drawing whose shape fits the tile best (wide drawings shrink to nothing in a tile).
      const fit = (c: Card) => Math.abs(Math.log(c.aspect / 1.5)) + (c.id === `template-${e.id}` ? 0.3 : 0);
      const show = [...e.cards].sort((a, b) => fit(a) - fit(b))[0]!;
      return `<a class="tile" href="${e.id}.html">
  <div class="tile-drawing">${show.figure}</div>
  <div class="tile-meta">${typeIcon(e.icon)}<div><h2>${escape(e.name)}</h2><p>${escape(e.tagline)}</p></div><span class="tile-count">${e.cards.length}</span></div>
</a>`;
    })
    .join('\n');
  return `<header class="page-head">
  <p class="eyebrow">Gallery</p>
  <h1>Every template, every example</h1>
  <p class="lede">${total} drawings in ${all.length} types, drawn by this build from the YAML in <code>examples/</code> and each type's template. Nothing here is retouched. Open any of them in the editor and make it yours.</p>
</header>
<div class="tiles">${tiles}</div>`;
}
