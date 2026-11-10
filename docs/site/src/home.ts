// The landing page: what Cartography is in one sentence, a real file next to its drawing, the types,
// where it fits, and the benchmark in plain numbers (including where it loses).
import fs from 'node:fs';
import path from 'node:path';
import { build, toHtml } from '@cartography/docs-plugins';
import { escape, highlight } from './highlight.ts';
import { typeIcon, type TypeEntry } from './gallery.ts';
import { icon } from './layout.ts';
import { options } from './markdown.ts';

const ARROW = icon('<path d="M5 12h14M13 6l6 6-6 6"/>');

const FEATURES: [string, string, string, string][] = [
  ['book-open', 'In your docs', 'A markdown-it and a remark plugin draw <code>```cartography</code> blocks as inline SVG at build time, light and dark. This site is built with them.', 'embed.html'],
  ['git-pull-request', 'In pull requests', '<code>carto diff</code> says what changed in words and as a marked-up picture; a GitHub Action posts it. Edits keep the rest of the drawing in place.', 'ci.html'],
  ['file-code', 'From what you have', 'Mermaid, Structurizr DSL, draw.io, Excalidraw, Terraform, Kubernetes manifests, Azure Resource Graph, Entra and GitHub exports.', 'interop.html'],
  ['download', 'To where it goes', 'SVG, PNG, PDF, a 16:9 slide or one slide per step in PowerPoint, an Office-safe SVG, and editable draw.io files.', 'steps.html'],
  ['link', 'As a link', 'The whole diagram rides in the link’s #fragment, which never reaches a server. The reader gets a viewer and can open it in the editor.', 'share.html'],
  ['bot', 'With an assistant', 'An MCP server checks what an AI wrote against the schema and scores its layout before you see it.', 'mcp.html'],
];

const GUIDES: [string, string][] = [
  ['mermaid', 'Mermaid'],
  ['d2', 'D2'],
  ['drawio', 'draw.io'],
  ['plantuml', 'PlantUML'],
  ['structurizr', 'Structurizr'],
];

export async function home(o: { root: string; gallery: TypeEntry[]; benchmark?: string }): Promise<string> {
  const file = path.join(o.root, 'examples/systems/web-shop.yaml');
  const text = fs.readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  const built = await build({ text, dir: path.dirname(file), options: { ...options, root: o.root } });
  const total = o.gallery.reduce((n, e) => n + e.cards.length, 0);
  const types = o.gallery
    .filter((e) => e.id !== 'model')
    .map((e) => `<a class="type" href="gallery/${e.id}.html">${typeIcon(e.icon)}<span><strong>${escape(e.name)}</strong><small>${escape(e.tagline)}</small></span></a>`)
    .join('');
  const { icon: lucide } = await import('@cartography/icons');
  const features = FEATURES.map(([i, h, p, href]) => `<a class="feature" href="${href}">${icon(lucide(i) ?? '')}<h3>${h}</h3><p>${p}</p></a>`).join('');
  return `<section class="hero">
  <div class="hero-text">
    <p class="eyebrow">Open source · MIT · works offline</p>
    <h1>Architecture diagrams that read like a&nbsp;map.</h1>
    <div>
    <p class="lede">Write a short YAML file or build the diagram in the editor. Cartography lays it out, routes every line and draws it in one calm style: ${o.gallery.length - 1} diagram types, light and dark, for docs, pull requests and slides.</p>
    <div class="cta"><a class="button primary big" href="getting-started.html">Get started ${ARROW}</a><a class="button big" href="gallery/index.html">Browse ${total} examples</a></div>
    <pre class="install"><span class="t-com"># in a clone of the repository</span>
<span class="t-cmd">pnpm</span> install
<span class="t-cmd">pnpm</span> carto new systems shop.yaml
<span class="t-cmd">pnpm</span> carto render shop.yaml <span class="t-flag">-f</span> png</pre>
    </div>
  </div>
  <div class="hero-sheet">
    <div class="sheet-tabs"><span class="mono">examples/systems/web-shop.yaml</span></div>
    <div class="sheet-body">
      <div class="sheet-code">${highlight(text, 'yaml')}</div>
      <div class="sheet-drawing">${toHtml(built.figure)}</div>
    </div>
  </div>
  <div class="hero-foot"><span>Left: the whole file. Right: what this site's build drew from it, untouched.</span><a href="gallery/systems.html#systems-web-shop">See it in the gallery →</a></div>
</section>

<section class="band">
  <div class="band-head"><p class="eyebrow">One look, every type</p><h2>Pick what your diagram answers</h2><p>Each type knows its shapes, how they nest and how to lay them out. Not sure? <a href="types.html">Which type do I need?</a></p></div>
  <div class="types">${types}</div>
</section>

<section class="band">
  <div class="band-head"><p class="eyebrow">Where it fits</p><h2>Text you can review, drawings you can show</h2></div>
  <div class="features">${features}</div>
</section>

${o.benchmark ?? ''}

<section class="band">
  <div class="band-head"><p class="eyebrow">Coming from another tool</p><h2>Bring your diagrams along</h2><p>What maps to what, the import command, and an honest list of what you lose and what you gain.</p></div>
  <div class="guides">${GUIDES.map(([f, n]) => `<a class="guide" href="coming-from/${f}.html"><span>${n}</span>${ARROW}</a>`).join('')}</div>
</section>`;
}
