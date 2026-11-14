// The page around the content: header with search and the light/dark switch, the section list on the
// left, the page's own headings on the right. Every link is relative, so the site works from any
// folder and from file:// as well as from a server.
import { escape } from './highlight.ts';
import type { Heading } from './markdown.ts';

export interface NavItem {
  title: string;
  /** Path in the site, from its root ("types.html", "gallery/index.html"). */
  href: string;
}
export interface NavSection {
  title: string;
  items: NavItem[];
}

export interface Page {
  /** Path in the site, from its root. */
  path: string;
  title: string;
  description?: string;
  body: string;
  headings?: Heading[];
  /** Wide pages (gallery, benchmark) drop the table of contents on the right. */
  wide?: boolean;
  /** The home page has a layout of its own. */
  home?: boolean;
}

/** From one page to another, as a relative href. */
export function rel(from: string, to: string): string {
  const a = from.split('/').slice(0, -1);
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/') || to;
}

const MARK = `<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M3 7.5 11 4l10 3.5L29 4v20.5L21 28l-10-3.5L3 28Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M11 4v20.5M21 7.5V28" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="15" r="2.6" fill="var(--accent)"/></svg>`;

export const icon = (inner: string, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const SEARCH = icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>');
const MOON = icon('<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z"/>', 'i moon');
const SUN = icon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', 'i sun');
const MENU = icon('<path d="M4 6h16M4 12h16M4 18h16"/>');

export function page(p: Page, nav: NavSection[], top: NavItem[]): string {
  const to = (href: string) => rel(p.path, href);
  const side = nav
    .map(
      (s) =>
        `<div class="nav-group"><div class="nav-title">${escape(s.title)}</div>${s.items
          .map((it) => `<a href="${to(it.href)}"${it.href === p.path ? ' aria-current="page"' : ''}>${escape(it.title)}</a>`)
          .join('')}</div>`,
    )
    .join('');
  const toc = (p.headings ?? []).filter((h) => h.level === 2 || h.level === 3);
  const onPage =
    !p.wide && !p.home && toc.length > 1
      ? `<aside class="toc" aria-label="On this page"><div class="nav-title">On this page</div>${toc
          .map((h) => `<a class="l${h.level}" href="#${escape(h.id)}">${escape(h.text)}</a>`)
          .join('')}</aside>`
      : '';
  const topLinks = top.map((it) => `<a href="${to(it.href)}"${p.path.startsWith(it.href.split('/')[0]!.replace(/\.html$/, '')) ? ' aria-current="true"' : ''}>${escape(it.title)}</a>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(p.home ? 'Linework — architecture diagrams as text' : `${p.title} · Linework`)}</title>
${p.description ? `<meta name="description" content="${escape(p.description)}">` : ''}
<meta name="color-scheme" content="light dark">
<script>try{var t=localStorage.getItem('linework-site-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
<link rel="stylesheet" href="${to('assets/site.css')}">
<link rel="icon" href="${to('assets/mark.svg')}" type="image/svg+xml">
</head>
<body class="${p.home ? 'home' : p.wide ? 'wide' : 'doc'}" data-root="${to('index.html').replace(/index\.html$/, '')}">
<a class="skip" href="#main">Skip to the content</a>
<header class="top">
  <button class="menu" type="button" aria-label="Sections" aria-expanded="false">${MENU}</button>
  <a class="brand" href="${to('index.html')}">${MARK}<span>Linework</span></a>
  <nav class="top-links" aria-label="Main">${topLinks}</nav>
  <button class="search-open" type="button" aria-label="Search the docs">${SEARCH}<span>Search</span><kbd>/</kbd></button>
  <button class="theme" type="button" aria-label="Switch light and dark">${MOON}${SUN}</button>
</header>
<div class="frame">
  <nav class="side" aria-label="Sections">${side}</nav>
  <main id="main" class="${p.home ? 'landing' : 'content'}">
${p.body}
  </main>
  ${onPage}
</div>
<footer class="foot"><div>${MARK}<span>Linework · MIT licence · built from the repository's docs, offline, no tracking</span></div><div><a href="${to('gallery/index.html')}">Gallery</a><a href="${to('benchmark.html')}">Benchmark</a><a href="${to('getting-started.html')}">Get started</a></div></footer>
<div class="search" role="dialog" aria-modal="true" aria-label="Search" hidden>
  <div class="search-box"><div class="search-field">${SEARCH}<input type="search" placeholder="Search the docs, types and examples" aria-label="Search"><kbd>Esc</kbd></div><ol class="search-results" role="listbox"></ol></div>
</div>
<script src="${to('assets/search-index.js')}" defer></script>
<script src="${to('assets/site.js')}" defer></script>
</body>
</html>
`;
}
