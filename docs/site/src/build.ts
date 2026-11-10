// Builds the documentation site into docs/site/dist: the Markdown in docs/ (diagrams drawn at build
// time), the template gallery, the benchmark, a search index and, when it has been built, the web app
// itself under app/ so "Open in the editor" works offline. Plain files: open dist/index.html.
//   pnpm docs:build              (builds the web app first)
//   pnpm --filter @cartography/site build [--app <url>]   site only; --app points the editor links elsewhere
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { bundledFont } from '@cartography/theme';
import { pageCss } from '@cartography/docs-plugins';
import { benchmarkCharts, benchmarkDrawings, benchmarkTeaser } from './bench-page.ts';
import { buildGallery, galleryIndex, typePage, type TypeEntry } from './gallery.ts';
import { home } from './home.ts';
import { page, rel, type NavSection, type Page } from './layout.ts';
import { renderMarkdown, type Rendered } from './markdown.ts';

const { values } = parseArgs({ options: { app: { type: 'string' }, out: { type: 'string' } } });
const here = path.resolve(import.meta.dirname, '..');
const root = path.resolve(here, '../..');
const docs = path.join(root, 'docs');
const out = path.resolve(values.out ?? path.join(here, 'dist'));
const started = Date.now();

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { repository?: { url?: string } | string };
const repoUrl = (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? 'https://github.com/OWNER/cartography').replace(/^git\+/, '').replace(/\.git$/, '');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets/fonts'), { recursive: true });

// ---------------------------------------------------------------- which pages, in which order

const NAV: { title: string; items: [string, string?][] }[] = [
  { title: 'Start', items: [['getting-started.md', 'Get started'], ['types.md', 'Which type do I need?'], ['wizards.md', 'Wizards'], ['gallery/index.html', 'Gallery']] },
  {
    title: 'Coming from',
    items: [['coming-from/mermaid.md', 'Mermaid'], ['coming-from/d2.md', 'D2'], ['coming-from/drawio.md', 'draw.io'], ['coming-from/plantuml.md', 'PlantUML'], ['coming-from/structurizr.md', 'Structurizr']],
  },
  {
    title: 'Diagram types',
    items: [['c4.md', 'C4 model'], ['process.md', 'Processes'], ['states.md', 'State machines'], ['capabilities.md', 'Capability maps'], ['teams.md', 'Teams and org charts'], ['class.md', 'Class diagrams'], ['mindmap.md', 'Mind maps'], ['context-map.md', 'Context maps'], ['matrix.md', 'Matrices'], ['data-products.md', 'Data products'], ['threats.md', 'Threat models']],
  },
  { title: 'Model and tell', items: [['model.md', 'One model, many diagrams'], ['workspace.md', 'The folder as one model'], ['steps.md', 'Steps'], ['compare.md', 'Compare versions'], ['share.md', 'Share links'], ['html-export.md', 'Interactive HTML']] },
  { title: 'Import and export', items: [['azure-import.md', 'Azure import'], ['access-import.md', 'Access import'], ['interop.md', 'draw.io, Excalidraw, Office']] },
  { title: 'Docs, CI and AI', items: [['embed.md', 'In a docs site'], ['ci.md', 'In CI'], ['mcp.md', 'MCP and agents']] },
  { title: 'Look', items: [['style.md', 'The Survey style'], ['themes.md', 'Brand themes'], ['icons.md', 'Official icons']] },
  { title: 'Compare', items: [['benchmark.md', 'Layout benchmark'], ['comparison/README.md', 'Side by side'], ['requirements.md', 'Requirements']] },
];
/** Pages that are written for the repository's own work, not for users. */
const SKIP = [/^research\//, /^site\//, /^benchmark\//];

const sitePath = (fromDocs: string) => fromDocs.replace(/(^|\/)README\.md$/, '$1index.html').replace(/\.md$/, '.html');
const docFiles = (dir = docs): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const abs = path.join(dir, d.name);
    if (d.name === 'node_modules' || d.name === 'dist') return [];
    if (d.isDirectory()) return docFiles(abs);
    const r = path.relative(docs, abs).split(path.sep).join('/');
    return d.name.endsWith('.md') && !SKIP.some((s) => s.test(r)) ? [r] : [];
  });
const files = docFiles();

const nav: NavSection[] = NAV.map((s) => ({
  title: s.title,
  items: s.items.filter(([f]) => f.endsWith('.html') || files.includes(f)).map(([f, title]) => ({ title: title ?? f, href: f.endsWith('.html') ? f : sitePath(f) })),
}));
const listed = new Set(NAV.flatMap((s) => s.items.map(([f]) => f)));
const unlisted = files.filter((f) => !listed.has(f));
if (unlisted.length) nav.push({ title: 'More', items: unlisted.map((f) => ({ title: f.replace(/\.md$/, ''), href: sitePath(f) })) });
const top = [
  { title: 'Docs', href: 'getting-started.html' },
  { title: 'Types', href: 'types.html' },
  { title: 'Gallery', href: 'gallery/index.html' },
  { title: 'Benchmark', href: 'benchmark.html' },
];

// ---------------------------------------------------------------- links, images, files

const copied = new Set<string>();
const copy = (abs: string, to: string) => {
  if (copied.has(to) || !fs.existsSync(abs)) return;
  copied.add(to);
  fs.mkdirSync(path.dirname(path.join(out, to)), { recursive: true });
  fs.copyFileSync(abs, path.join(out, to));
};
const inside = (abs: string, dir: string) => !path.relative(dir, abs).startsWith('..') && !path.isAbsolute(path.relative(dir, abs));
const posix = (p: string) => p.split(path.sep).join('/');
const examplesDir = path.join(root, 'examples');
/** examples/<dir> → its type's gallery page, set once the gallery is known. */
const exampleType = new Map<string, string>();
for (const dir of fs.readdirSync(examplesDir)) {
  const p = path.join(examplesDir, dir);
  if (!fs.statSync(p).isDirectory()) continue;
  const first = fs.readdirSync(p).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => /^type:\s*([\w-]+)/m.exec(fs.readFileSync(path.join(p, f), 'utf8'))?.[1]).find(Boolean);
  if (first) exampleType.set(dir, first);
}

const resolver = (pagePath: string) => ({
  link(abs: string, fragment: string): string | undefined {
    const r = posix(path.relative(docs, abs));
    if (inside(abs, docs)) {
      if (r.endsWith('.md') && files.includes(r)) return rel(pagePath, sitePath(r)) + fragment;
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory() && files.includes(`${r}/README.md`)) return rel(pagePath, sitePath(`${r}/README.md`)) + fragment;
    }
    // The examples folder is the gallery on the site, and the folder itself on GitHub.
    if (path.resolve(abs) === path.resolve(examplesDir)) return rel(pagePath, 'gallery/index.html') + fragment;
    if (inside(abs, examplesDir)) {
      const [dir, file] = posix(path.relative(examplesDir, abs)).split('/');
      const type = dir ? exampleType.get(dir) : undefined;
      if (type && (!file || /\.ya?ml$/.test(file))) return rel(pagePath, `gallery/${type}.html`) + (file ? `#${dir}-${file.replace(/\.ya?ml$/, '')}` : '');
    }
    if (inside(abs, root)) {
      const kind = fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? 'tree' : 'blob';
      return `${repoUrl}/${kind}/main/${posix(path.relative(root, abs))}${fragment}`;
    }
    return undefined;
  },
  image(abs: string): string | undefined {
    if (!inside(abs, root)) return undefined;
    const to = inside(abs, docs) ? posix(path.relative(docs, abs)) : `_repo/${posix(path.relative(root, abs))}`;
    copy(abs, to);
    return rel(pagePath, to);
  },
});

// ---------------------------------------------------------------- the stylesheet, fonts and scripts

const faces: string[] = [];
for (const family of ['Instrument Sans', 'Geist Mono']) {
  const f = bundledFont(family)!;
  const name = `Carto${family.replace(/\s+/g, '')}`;
  for (const [weight, data] of Object.entries(f.woff2)) {
    const file = `${name}-${weight}.woff2`;
    fs.writeFileSync(path.join(out, 'assets/fonts', file), Buffer.from(data, 'base64'));
    faces.push(`@font-face{font-family:${name};font-style:normal;font-weight:${weight};font-display:swap;src:url(fonts/${file}) format("woff2")}`);
  }
}
// The plugins' own rules (which drawing shows on a light and on a dark page), then the site's.
const css = [faces.join('\n'), pageCss({ ...{ fonts: 'none' as const } }), fs.readFileSync(path.join(here, 'assets/site.css'), 'utf8')].join('\n');
fs.writeFileSync(path.join(out, 'assets/site.css'), css);
fs.copyFileSync(path.join(here, 'assets/site.js'), path.join(out, 'assets/site.js'));
fs.copyFileSync(path.join(here, 'assets/mark.svg'), path.join(out, 'assets/mark.svg'));

// ---------------------------------------------------------------- the web app, for "Open in the editor"

const appDist = path.join(root, 'packages/web/dist');
// The gallery pages sit one folder down; an absolute --app is used as it is.
const app = values.app ?? '../app/index.html';
if (!values.app) {
  if (fs.existsSync(path.join(appDist, 'index.html'))) fs.cpSync(appDist, path.join(out, 'app'), { recursive: true });
  else console.warn('packages/web/dist not found: "Open in the editor" links point at app/, which is missing. Run pnpm web:build first, or pass --app <url>.');
}

// ---------------------------------------------------------------- pages

const search: { p: string; h: string; u: string; x: string }[] = [];
const pages: Page[] = [];
const write = (p: Page) => {
  fs.mkdirSync(path.dirname(path.join(out, p.path)), { recursive: true });
  fs.writeFileSync(path.join(out, p.path), page(p, nav, top));
};

let problems = 0;
const rendered = new Map<string, Rendered>();
for (const f of files) {
  const p = sitePath(f);
  try {
    rendered.set(f, await renderMarkdown(path.join(docs, f), resolver(p), root));
  } catch (e) {
    problems++;
    console.error(`docs/${f}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const gallery: TypeEntry[] = await buildGallery({ root, out, app });
for (const e of gallery) {
  for (const c of e.cards) search.push({ p: `Gallery · ${e.name}`, h: c.title + (c.view ? ` (${c.view})` : ''), u: `gallery/${e.id}.html#${c.id}`, x: `${c.source} ${e.tagline}` });
  pages.push({ path: `gallery/${e.id}.html`, title: `${e.name} gallery`, description: e.tagline, body: typePage(e, gallery), wide: true });
}
pages.push({ path: 'gallery/index.html', title: 'Gallery', description: 'Every template and example, drawn light and dark', body: galleryIndex(gallery), wide: true });

const results = path.join(docs, 'benchmark/results.json');
for (const [f, r] of rendered) {
  const p = sitePath(f);
  let body = r.html;
  if (f === 'benchmark.md' && fs.existsSync(results)) {
    const data = JSON.parse(fs.readFileSync(results, 'utf8'));
    body = body.replace('<!-- charts -->', benchmarkCharts(data)).replace(
      '<!-- drawings -->',
      benchmarkDrawings(data, (file) => {
        copy(path.join(docs, file), file);
        return rel(p, file);
      }),
    );
  }
  const lead = /<p>([^]*?)<\/p>/.exec(r.html)?.[1]?.replace(/<[^>]+>/g, '').slice(0, 200);
  pages.push({ path: p, title: r.title, description: lead, body: `<article class="prose">${body}</article>`, headings: r.headings, wide: f === 'benchmark.md' || f === 'comparison/README.md' });
  for (const s of r.sections) search.push({ p: r.title, h: s.heading || r.title, u: s.id ? `${p}#${s.id}` : p, x: s.text.replace(/\s+/g, ' ').slice(0, 1200) });
}
pages.push({ path: 'index.html', title: 'Cartography', description: 'Architecture diagrams as text that look like a map sheet', body: await home({ root, gallery, ...(fs.existsSync(results) ? { benchmark: benchmarkTeaser(JSON.parse(fs.readFileSync(results, 'utf8'))) } : {}) }), home: true });

for (const p of pages) write(p);
fs.writeFileSync(path.join(out, 'assets/search-index.js'), `window.CARTO_SEARCH=${JSON.stringify(search)};\n`);

const size = (dir: string): number => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, d) => n + (d.isDirectory() ? size(path.join(dir, d.name)) : fs.statSync(path.join(dir, d.name)).size), 0);
console.log(`${pages.length} pages, ${gallery.reduce((n, e) => n + e.cards.length, 0)} gallery drawings, ${(size(out) / 1e6).toFixed(1)} MB in ${path.relative(process.cwd(), out) || out} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
if (problems) {
  console.error(`${problems} page(s) could not be built`);
  process.exitCode = 1;
}
