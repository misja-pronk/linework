// The viewer inside an exported page. Everything it shows was drawn ahead of time; this script only
// unpacks it, puts the right SVG on the sheet and handles the reader: pan and zoom (trackpad, mouse,
// touch, keys), views and steps, presenting full screen, drill-down, search and details, light and
// dark. Text from the diagrams only ever goes in as text (textContent), SVGs are parsed as XML and
// cleaned to what the renderer draws with, links leave only for http, https and mailto.
import { gunzipSync, strFromU8 } from 'fflate';
import { safeAttribute, safeHref, SVG_ELEMENTS } from '@cartography/embed/shared';
import type { Payload, PDrawing, PElement, Picture } from '../payload.ts';

// ---------------------------------------------------------------- small helpers

type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string | false | undefined | null;

/** An element with attributes and children; strings become text nodes, never markup. */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== false && c != null) el.append(c);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The page's own icons (24 × 24, drawn with lines). */
const PATHS: Record<string, string[]> = {
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', 'm20 20-4-4'],
  play: ['M7 4.5v15l12-7.5-12-7.5Z'],
  contrast: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 3v18', 'M12 7.5h4', 'M12 12h6', 'M12 16.5h4'],
  help: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6', 'M12 17h.01'],
  x: ['M6 6l12 12', 'M18 6 6 18'],
  left: ['m15 18-6-6 6-6'],
  right: ['m9 18 6-6-6-6'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  fit: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
  down: ['M7 7h10v10', 'M7 17 17 7'],
  out: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  grid: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  note: ['M5 4h14v12H9l-4 4V4Z'],
  printer: ['M7 9V4h10v5', 'M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2', 'M7 14h10v6H7z'],
};
function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', name === 'play' ? 'currentColor' : 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of PATHS[name] ?? []) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

const button = (cls: string, label: string, ...children: Child[]) => h('button', { type: 'button', class: cls, 'aria-label': label, title: label }, ...children);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(`carto-html:${k}`);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) localStorage.removeItem(`carto-html:${k}`);
      else localStorage.setItem(`carto-html:${k}`, v);
    } catch {
      // A page from disk may have no storage: the choice lasts until it is closed.
    }
  },
};

// ---------------------------------------------------------------- data

function load(): Payload {
  const text = document.getElementById('carto-data')?.textContent ?? '';
  const bin = atob(text.trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(strFromU8(gunzipSync(bytes))) as Payload;
}

let data: Payload;
/** Drawing index by key. */
const byKey = new Map<string, number>();

/** An SVG of the page as a clean element: parsed as XML, only what the renderer draws with. */
function svgOf(pic: Picture, look: 'light' | 'dark'): SVGSVGElement | undefined {
  const markup = look === 'dark' && pic.dark ? pic.dark : pic.light;
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName !== 'svg' || doc.querySelector('parsererror')) return undefined;
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      if (!SVG_ELEMENTS.has(child.localName) || child.localName === 'style') child.remove();
      else walk(child);
    }
    const shared = el.getAttribute('data-carto-icon');
    if (shared !== null) {
      const uri = data.icons[Number(shared)];
      if (uri) el.setAttribute('href', uri);
      el.removeAttribute('data-carto-icon');
    }
    for (const a of [...el.attributes]) if (!safeAttribute(el.localName, a.name, a.value)) el.removeAttribute(a.name);
  };
  walk(root);
  for (const a of root.querySelectorAll('a')) {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  }
  return document.importNode(root, true) as unknown as SVGSVGElement;
}

// ---------------------------------------------------------------- page state

type Look = 'light' | 'dark';
const system = matchMedia('(prefers-color-scheme: dark)');
/** The reader's own pick; without it the system's. */
let picked = store.get('theme') as Look | null;
const look = (): Look => picked ?? (system.matches ? 'dark' : 'light');

interface Place {
  d: number;
  /** 0: the whole drawing; 1…n: a step. */
  step: number;
}
let here: Place | undefined;
let selected: string | undefined;
let presenting = false;
/** Where the sheet is and how large: translate x, y and scale k. */
const at = { x: 0, y: 0, k: 1 };
let fitted = true;
let size = { w: 1, h: 1 };
let sheetSvg: SVGSVGElement | undefined;
let panelFor: 'element' | 'notes' | undefined;

// ---------------------------------------------------------------- the frame

const els = {
  app: h('div', { class: 'app', id: 'app' }),
  top: h('header', { class: 'top' }),
  side: h('nav', { class: 'side', 'aria-label': 'Contents' }),
  main: h('main', { class: 'main' }),
  stage: h('div', { class: 'stage', tabindex: 0, role: 'application', 'aria-roledescription': 'diagram', 'aria-label': 'Diagram' }),
  sheet: h('div', { class: 'sheet' }),
  home: h('section', { class: 'home', hidden: true }),
  panel: h('aside', { class: 'panel', 'aria-label': 'Details' }),
  panelIn: h('div', { class: 'in' }),
  steps: h('div', { class: 'steps', hidden: true, role: 'group', 'aria-label': 'Steps' }),
  crumbs: h('div', { class: 'crumbs' }),
  pct: button('pct', 'Fit to the window (0)'),
  counter: h('div', { class: 'counter', 'aria-live': 'polite' }),
  notesBtn: button('btn', 'Review notes'),
  search: h('div', { class: 'overlay', hidden: true }),
  keys: h('div', { class: 'overlay', hidden: true }),
  print: h('div', { class: 'print', 'aria-hidden': 'true' }),
  live: h('div', { class: 'sr', 'aria-live': 'polite' }),
};

function frame() {
  const titleLink = h('a', { class: 'title', href: '#' }, h('b', {}, data.title));
  const menu = button('btn menu', 'Contents', icon('menu'));
  menu.addEventListener('click', () => els.app.classList.toggle(window.innerWidth <= 880 ? 'side-open' : 'no-side'));
  const searchBtn = h('button', { type: 'button', class: 'btn search', title: 'Search (/)' }, icon('search'), h('span', {}, 'Search elements and views'), h('kbd', {}, '/'));
  searchBtn.addEventListener('click', openSearch);
  const present = button('btn', 'Present full screen (P)', icon('play'), h('span', {}, 'Present'));
  present.addEventListener('click', () => startPresenting());
  const dark = button('btn', 'Light or dark (D)', icon('contrast'));
  dark.addEventListener('click', toggleLook);
  const print = button('btn', 'Print, a page per view', icon('printer'));
  print.addEventListener('click', () => {
    buildPrint();
    window.print();
  });
  const help = button('btn', 'Keys (?)', icon('help'));
  help.addEventListener('click', () => showKeys(true));
  els.notesBtn.append(icon('note'), h('span', {}));
  els.notesBtn.hidden = true;
  els.notesBtn.addEventListener('click', () => (panelFor === 'notes' ? closePanel() : showNotes()));
  els.top.append(menu, titleLink, els.crumbs, h('div', { class: 'spacer' }), searchBtn, els.notesBtn, present, print, dark, help);

  const zoom = h('div', { class: 'zoom', role: 'group', 'aria-label': 'Zoom' });
  const zin = button('', 'Zoom in (+)', icon('plus'));
  const zout = button('', 'Zoom out (−)', icon('minus'));
  const zfit = button('', 'Fit (0)', icon('fit'));
  zin.addEventListener('click', () => zoomBy(1.25));
  zout.addEventListener('click', () => zoomBy(0.8));
  zfit.addEventListener('click', () => fit());
  els.pct.addEventListener('click', () => (fitted ? zoomTo(1) : fit()));
  zoom.append(zout, els.pct, zin, zfit);
  const leave = h('button', { type: 'button', class: 'btn leave', title: 'Stop presenting (Esc)' }, icon('x'), h('span', {}, 'Esc'));
  leave.addEventListener('click', stopPresenting);
  els.stage.append(els.sheet);
  els.main.append(els.stage, els.home, els.steps, zoom, els.counter, leave);
  els.panel.append(els.panelIn);
  els.app.append(els.top, els.side, els.main, els.panel);
  document.body.append(els.app, els.search, els.keys, els.print, els.live);
  if (!data.site && data.drawings.length < 2) els.app.classList.add('no-side');
}

// ---------------------------------------------------------------- contents

const hrefOf = (d: number, step = 0, shape?: string) => `#${encodeURIComponent(data.drawings[d]!.key)}${step ? `&step=${step}` : ''}${shape ? `&at=${encodeURIComponent(shape)}` : ''}`;

function sidebar() {
  const items: Node[] = [];
  if (data.site) items.push(h('a', { href: '#contents', class: 'home-link', 'data-home': true }, icon('grid'), 'Contents'));
  items.push(h('h2', {}, data.site ? 'Diagrams' : 'Views'));
  for (const f of data.files) {
    const [first] = f.drawings;
    if (first === undefined) continue;
    const many = f.drawings.length > 1;
    const one = data.drawings[first]!;
    if (!many) {
      items.push(h('a', { href: hrefOf(first), class: 'file', 'data-d': first }, h('span', {}, f.title), one.steps ? h('span', { class: 'n' }, plural(one.steps.length, 'step')) : null));
      continue;
    }
    items.push(h('a', { href: hrefOf(first), class: 'file', 'data-file': f.path }, h('span', {}, f.title), h('span', { class: 'n' }, String(f.drawings.length))));
    for (const d of f.drawings) {
      const dr = data.drawings[d]!;
      items.push(h('a', { href: hrefOf(d), class: 'sub', 'data-d': d }, h('span', {}, shortTitle(dr, f.title)), dr.steps ? h('span', { class: 'n' }, plural(dr.steps.length, 'step')) : null));
    }
  }
  els.side.replaceChildren(...items);
}

/** A drawing's name under its file: the diagram as written is its overview. */
function shortTitle(d: PDrawing, file: string): string {
  if (d.view) return d.title === file ? d.view : d.title;
  const siblings = data.files.find((f) => f.path === d.file)?.drawings.map((i) => data.drawings[i]!) ?? [];
  return siblings.some((x) => x !== d && /^overview$/i.test(x.title)) ? 'Whole diagram' : 'Overview';
}

function markSidebar() {
  for (const a of els.side.querySelectorAll('a')) {
    const d = a.getAttribute('data-d');
    const on = here ? d !== null && Number(d) === here.d : a.hasAttribute('data-home');
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  els.side.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest' });
}

/** The folder's front page: what is in it, a card per diagram, and every element with where it is. */
function homePage() {
  const steps = data.drawings.reduce((s, d) => s + (d.steps?.length ?? 0), 0);
  const shown = data.elements.filter((e) => e.where.length);
  const facts = h(
    'div',
    { class: 'facts' },
    h('div', {}, h('b', {}, String(data.files.length)), data.files.length === 1 ? 'diagram' : 'diagrams'),
    h('div', {}, h('b', {}, String(data.drawings.length)), data.drawings.length === 1 ? 'drawing' : 'drawings'),
    steps ? h('div', {}, h('b', {}, String(steps)), 'steps') : null,
    h('div', {}, h('b', {}, String(shown.length)), 'elements'),
    h('div', {}, h('b', {}, data.made), 'made'),
  );
  const cards = h('div', { class: 'cards' });
  for (const f of data.files) {
    const [first] = f.drawings;
    if (first === undefined) continue;
    const thumb = h('div', { class: 'thumb', 'data-thumb': first });
    const views = f.drawings.length > 1 ? h('ul', {}, ...f.drawings.map((d) => h('li', {}, shortTitle(data.drawings[d]!, f.title)))) : null;
    cards.append(h('a', { class: 'card', href: hrefOf(first) }, thumb, h('div', { class: 'txt' }, h('span', { class: 'caps' }, f.type || 'diagram'), h('b', {}, f.title), views)));
  }
  const rows = shown
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((e) => {
      const [d, s] = e.where[0]!;
      const places = [...new Set(e.where.map(([x]) => data.drawings[x]!.title))];
      return h(
        'tr',
        {},
        h('td', {}, h('a', { href: hrefOf(d, 0, s) }, e.label)),
        h('td', { class: 'mono' }, e.kind ?? ''),
        h('td', { class: 'mono' }, [e.technology, e.owner].filter(Boolean).join(' · ')),
        h('td', {}, places.slice(0, 3).join(', ') + (places.length > 3 ? `, +${places.length - 3}` : '')),
      );
    });
  const index = shown.length
    ? [h('h2', { class: 'caps' }, 'Elements'), h('table', { class: 'index' }, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Kind'), h('th', {}, 'Technology · owner'), h('th', {}, 'Appears in'))), h('tbody', {}, ...rows))]
    : [];
  els.home.replaceChildren(
    h('div', { class: 'wrap' }, h('span', { class: 'caps' }, 'Architecture'), h('h1', {}, data.title), data.subtitle ? h('p', { class: 'lede' }, data.subtitle) : null, facts, h('h2', { class: 'caps' }, 'Diagrams'), cards, ...index),
  );
  thumbs();
}

/** Thumbnails are drawn when they come into sight: a large folder opens at once. */
let thumbWatch: IntersectionObserver | undefined;
function thumbs() {
  thumbWatch?.disconnect();
  thumbWatch = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target as HTMLElement;
      thumbWatch!.unobserve(el);
      const svg = svgOf(data.drawings[Number(el.dataset.thumb)]!, look());
      if (svg) {
        svg.setAttribute('aria-hidden', 'true');
        el.replaceChildren(svg);
      }
    }
  });
  for (const t of els.home.querySelectorAll('[data-thumb]')) thumbWatch.observe(t);
}

// ---------------------------------------------------------------- routing

function parseHash(): { d?: number; step: number; shape?: string; home: boolean } {
  const raw = location.hash.slice(1);
  if (!raw || raw === 'contents') return { home: true, step: 0 };
  const [key = '', ...rest] = raw.split('&');
  const opts = new Map(rest.map((p) => [p.slice(0, p.indexOf('=')), decodeURIComponent(p.slice(p.indexOf('=') + 1))] as const));
  let d: number | undefined;
  try {
    d = byKey.get(decodeURIComponent(key));
  } catch {
    d = undefined;
  }
  return { d, step: Number(opts.get('step')) || 0, shape: opts.get('at'), home: false };
}

function route() {
  const r = parseHash();
  // Already there (go() shows it at once; the hashchange that follows has nothing to do).
  if (r.d !== undefined && here && r.d === here.d && r.step === here.step && (!r.shape || r.shape === selected) && !els.stage.hidden) return;
  if (r.d === undefined) {
    if (data.site || !data.drawings.length) return showHome();
    return show(0, 0);
  }
  show(r.d, r.step, r.shape);
}

/** Goes there now: keys pressed quickly one after another each move on from where the last one went. */
const go = (d: number, step = 0, shape?: string) => {
  const next = hrefOf(d, step, shape);
  if (location.hash !== next) location.hash = next;
  route();
};

function showHome() {
  here = undefined;
  els.home.hidden = false;
  els.stage.hidden = true;
  els.steps.hidden = true;
  (els.main.querySelector('.zoom') as HTMLElement).hidden = true;
  els.notesBtn.hidden = true;
  closePanel();
  els.crumbs.replaceChildren();
  document.title = data.title;
  if (!els.home.firstChild) homePage();
  markSidebar();
}

function show(d: number, step: number, shape?: string) {
  const drawing = data.drawings[d]!;
  step = Math.max(0, Math.min(drawing.steps?.length ?? 0, step));
  const same = here?.d === d;
  const before = here;
  here = { d, step };
  els.home.hidden = true;
  els.stage.hidden = false;
  (els.main.querySelector('.zoom') as HTMLElement).hidden = false;
  const pic = step ? drawing.steps![step - 1]! : drawing;
  // Steps of one drawing are the same size: going through them keeps the zoom.
  const keep = same && before && pic.w === size.w && pic.h === size.h && !fitted;
  draw(pic);
  if (!keep) fit();
  else apply();
  if (!same) {
    selected = undefined;
    if (panelFor === 'element') closePanel();
  }
  crumbs(drawing);
  stepBar(drawing, step);
  els.notesBtn.hidden = !drawing.notes?.length;
  const label = els.notesBtn.querySelector('span');
  if (label) label.textContent = drawing.notes?.length ? `Notes ${drawing.notes.length}` : '';
  if (panelFor === 'notes') drawing.notes?.length ? showNotes() : closePanel();
  document.title = `${drawing.title} · ${data.title}`;
  markSidebar();
  if (shape && drawing.shapes[shape] !== undefined) {
    select(shape, true);
    centerOn(shape);
  } else if (selected) ring(selected);
  counter();
}

function draw(pic: Picture) {
  const svg = svgOf(pic, look());
  size = { w: pic.w, h: pic.h };
  sheetSvg = svg;
  els.sheet.replaceChildren(...(svg ? [svg] : [h('p', { class: 'loading' }, 'This drawing could not be shown.')]));
  if (!svg || !here) return;
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', data.drawings[here.d]!.title);
  const drawing = data.drawings[here.d]!;
  for (const el of svg.querySelectorAll('[data-node], [data-group]')) {
    const shape = shapeKey(el);
    if (shape && drawing.drill[shape] !== undefined) el.classList.add('drills');
  }
}

function shapeKey(el: Element): string | undefined {
  const n = el.getAttribute('data-node');
  if (n !== null) return `n:${n}`;
  const g = el.getAttribute('data-group');
  return g !== null ? `g:${g}` : undefined;
}

function shapeEl(shape: string): SVGGraphicsElement | undefined {
  if (!sheetSvg) return undefined;
  const attr = shape.startsWith('n:') ? 'data-node' : 'data-group';
  const id = shape.slice(2);
  for (const el of sheetSvg.querySelectorAll(`[${attr}]`)) if (el.getAttribute(attr) === id) return el as SVGGraphicsElement;
  return undefined;
}

function crumbs(drawing: PDrawing) {
  const parts: Node[] = [];
  const sep = () => h('span', { class: 'sep', 'aria-hidden': 'true' }, '/');
  if (data.site) parts.push(sep(), h('a', { href: '#contents' }, 'Contents'));
  const file = data.files.find((f) => f.path === drawing.file);
  if (drawing.trail?.length) {
    for (const c of drawing.trail.slice(0, -1)) parts.push(sep(), c.to !== undefined ? h('a', { href: hrefOf(c.to) }, c.label) : h('span', {}, c.label));
  } else if (file && file.drawings.length > 1 && file.title !== drawing.title) parts.push(sep(), h('a', { href: hrefOf(file.drawings[0]!) }, file.title));
  const name = drawing.view || !file ? drawing.title : file.title;
  if (parts.length || name !== data.title) parts.push(sep(), h('span', { class: 'here' }, name));
  els.crumbs.replaceChildren(...parts);
}

// ---------------------------------------------------------------- steps and presenting

function stepBar(drawing: PDrawing, step: number) {
  const steps = drawing.steps ?? [];
  if (!steps.length && !presenting) {
    els.steps.hidden = true;
    return;
  }
  els.steps.hidden = false;
  const s = step ? steps[step - 1] : undefined;
  const prev = button('nav', 'Back (←)', icon('left'));
  const next = button('nav', 'Next (→)', icon('right'));
  const all = sequence();
  const i = indexIn(all);
  prev.disabled = i <= 0;
  next.disabled = i >= all.length - 1;
  prev.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  const say = h(
    'div',
    { class: 'say' },
    h('span', { class: 'caps' }, steps.length ? (step ? `Step ${step} of ${steps.length}` : `${plural(steps.length, 'step')}, all shown`) : drawing.kind),
    h('b', {}, s?.title ?? (step ? `Step ${step}` : drawing.title)),
    s?.caption ? h('p', {}, s.caption) : null,
  );
  const dots = steps.length
    ? h(
        'div',
        { class: 'dots' },
        ...[...(presenting ? [] : [0]), ...steps.map((_, n) => n + 1)].map((n) => {
          const b = button(n ? '' : 'all', n ? `Step ${n}${steps[n - 1]!.title ? `: ${steps[n - 1]!.title}` : ''}` : 'The whole drawing');
          if (n === step) b.setAttribute('aria-current', 'step');
          b.addEventListener('click', () => go(here!.d, n));
          return b;
        }),
      )
    : null;
  els.steps.replaceChildren(prev, say, dots ?? '', next);
}

/** Every place in order: the whole of each drawing, then its steps. Presenting skips the whole of a drawing that has steps. */
function sequence(): Place[] {
  const out: Place[] = [];
  for (const f of data.files)
    for (const d of f.drawings) {
      const n = data.drawings[d]!.steps?.length ?? 0;
      if (!presenting || !n) out.push({ d, step: 0 });
      for (let s = 1; s <= n; s++) out.push({ d, step: s });
    }
  return out;
}

function indexIn(all: Place[]): number {
  if (!here) return -1;
  const i = all.findIndex((p) => p.d === here!.d && p.step === here!.step);
  return i >= 0 ? i : all.findIndex((p) => p.d === here!.d);
}

function move(by: number) {
  const all = sequence();
  if (!here) {
    const first = all[0];
    if (first) go(first.d, first.step);
    return;
  }
  const next = all[indexIn(all) + by];
  if (next) go(next.d, next.step);
}

/** The next or previous drawing, past its steps. */
function moveDrawing(by: number) {
  const order = data.files.flatMap((f) => f.drawings);
  const i = here ? order.indexOf(here.d) : -1;
  const next = order[i + by];
  if (next !== undefined) go(next, presenting && data.drawings[next]!.steps ? 1 : 0);
}

function counter() {
  const all = sequence();
  els.counter.textContent = here ? `${indexIn(all) + 1} / ${all.length}` : '';
}

function startPresenting() {
  if (presenting) return;
  presenting = true;
  els.app.classList.add('presenting');
  closePanel();
  closeSearch();
  void document.documentElement.requestFullscreen?.().catch(() => {});
  if (!here) {
    const first = sequence()[0];
    if (first) return go(first.d, first.step);
  } else if (here.step === 0 && data.drawings[here.d]!.steps) return go(here.d, 1);
  if (here) show(here.d, here.step);
  els.stage.focus();
}

function stopPresenting() {
  if (!presenting) return;
  presenting = false;
  els.app.classList.remove('presenting');
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  if (here) show(here.d, here.step);
}

// ---------------------------------------------------------------- pan and zoom

const room = () => {
  const r = els.stage.getBoundingClientRect();
  const below = els.steps.hidden ? 0 : els.steps.offsetHeight + 20;
  return { w: r.width, h: Math.max(80, r.height - below), full: r.height };
};

function apply() {
  els.sheet.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`;
  if (sheetSvg) {
    sheetSvg.setAttribute('width', String(Math.max(1, size.w * at.k)));
    sheetSvg.setAttribute('height', String(Math.max(1, size.h * at.k)));
  }
  els.pct.textContent = `${Math.round(at.k * 100)}%`;
  els.pct.title = fitted ? 'Actual size (1)' : 'Fit to the window (0)';
}

function fit() {
  const r = room();
  const pad = presenting ? 28 : r.w < 600 ? 12 : 40;
  const k = Math.min((r.w - 2 * pad) / size.w, (r.h - 2 * pad) / size.h, presenting ? 2.5 : 1.6);
  at.k = Math.max(0.02, k);
  at.x = (r.w - size.w * at.k) / 2;
  at.y = Math.max(pad, (r.h - size.h * at.k) / 2);
  fitted = true;
  apply();
}

/** Keeps part of the sheet on screen, wherever it is dragged. */
function clamp() {
  const r = room();
  const keep = 80;
  at.x = Math.min(r.w - keep, Math.max(keep - size.w * at.k, at.x));
  at.y = Math.min(r.full - keep, Math.max(keep - size.h * at.k, at.y));
}

function zoomAt(k: number, cx: number, cy: number) {
  const next = Math.min(8, Math.max(0.05, k));
  at.x = cx - ((cx - at.x) * next) / at.k;
  at.y = cy - ((cy - at.y) * next) / at.k;
  at.k = next;
  fitted = false;
  clamp();
  apply();
}

function zoomBy(f: number, cx?: number, cy?: number) {
  const r = room();
  zoomAt(at.k * f, cx ?? r.w / 2, cy ?? r.h / 2);
}

function zoomTo(k: number) {
  const r = room();
  zoomAt(k, r.w / 2, r.h / 2);
}

function panBy(dx: number, dy: number) {
  at.x += dx;
  at.y += dy;
  fitted = false;
  clamp();
  apply();
}

/** Brings a shape into the middle of the window, zooming in only when it is too small to read. */
function centerOn(shape: string) {
  const el = shapeEl(shape);
  if (!el) return;
  const box = el.getBoundingClientRect();
  const stage = els.stage.getBoundingClientRect();
  const r = room();
  if (box.width < 60 && at.k < 1) zoomAt(1, box.left - stage.left + box.width / 2, box.top - stage.top + box.height / 2);
  const b = el.getBoundingClientRect();
  const inside = b.left >= stage.left + 20 && b.right <= stage.right - 20 && b.top >= stage.top + 20 && b.bottom <= stage.top + r.h - 20;
  if (!inside) panBy(stage.left + r.w / 2 - (b.left + b.width / 2), stage.top + r.h / 2 - (b.top + b.height / 2));
}

/** Pans only when the shape is out of sight (behind the panel that just opened). */
function keepInSight(shape: string) {
  const el = shapeEl(shape);
  if (!el) return;
  const b = el.getBoundingClientRect();
  const s = els.stage.getBoundingClientRect();
  const dx = b.right > s.right - 16 ? s.right - 16 - b.right : b.left < s.left + 16 ? s.left + 16 - b.left : 0;
  if (dx) panBy(dx, 0);
}

function gestures() {
  const stage = els.stage;
  const local = (e: { clientX: number; clientY: number }) => {
    const r = stage.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  // A trackpad scrolls with two fingers and pinches with ctrlKey set; a mouse wheel with ctrl or ⌘ zooms.
  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? room().h : 1;
      if (e.ctrlKey || e.metaKey) {
        const [x, y] = local(e);
        zoomAt(at.k * Math.exp(-e.deltaY * unit * (e.ctrlKey && !e.metaKey ? 0.01 : 0.002)), x, y);
      } else panBy(-e.deltaX * unit, -e.deltaY * unit);
    },
    { passive: false },
  );
  // Safari's pinch.
  let gestureK = 1;
  stage.addEventListener('gesturestart', (e) => {
    e.preventDefault();
    gestureK = at.k;
  });
  stage.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    const g = e as unknown as { scale: number; clientX: number; clientY: number };
    const [x, y] = local(g);
    zoomAt(gestureK * g.scale, x, y);
  });

  const pointers = new Map<number, { x: number; y: number }>();
  let start: { x: number; y: number; ax: number; ay: number; target: EventTarget | null } | undefined;
  let moved = false;
  let pinch: { d: number; k: number } | undefined;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      // Captured, the pointer's later events name the stage: what was pressed on is kept from here.
      start = { x: e.clientX, y: e.clientY, ax: at.x, ay: at.y, target: e.target };
      moved = false;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), k: at.k };
      moved = true;
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const [x, y] = local({ clientX: (a!.x + b!.x) / 2, clientY: (a!.y + b!.y) / 2 });
      zoomAt((pinch.k * Math.hypot(a!.x - b!.x, a!.y - b!.y)) / pinch.d, x, y);
      return;
    }
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    stage.classList.add('panning');
    at.x = start.ax + dx;
    at.y = start.ay + dy;
    fitted = false;
    clamp();
    apply();
  });
  const end = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size < 2) pinch = undefined;
    if (pointers.size) return;
    stage.classList.remove('panning');
    if (!moved && e.type === 'pointerup' && start) tap(e, start.target);
    start = undefined;
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('dblclick', (e) => {
    if (presenting) return;
    // The pointer was captured by the stage: the shape is the one the last tap was on.
    const shape = shapeAt(e.target) ?? lastTap;
    const to = shape && here ? data.drawings[here.d]!.drill[shape] : undefined;
    if (to !== undefined) return go(to);
    const [x, y] = local(e);
    zoomAt(at.k * 1.6, x, y);
  });
  new ResizeObserver(() => {
    if (fitted && here) fit();
    else clamp();
  }).observe(stage);
}

function shapeAt(target: EventTarget | null): string | undefined {
  if (!(target instanceof Element) || !els.sheet.contains(target)) return undefined;
  const el = target.closest('[data-node], [data-group]');
  return el ? shapeKey(el) : undefined;
}

let lastTap: string | undefined;
function tap(e: PointerEvent, target: EventTarget | null) {
  if (presenting) {
    // A click moves on, as in slides; on the left third it goes back.
    const r = els.stage.getBoundingClientRect();
    return move(e.clientX - r.left < r.width / 3 ? -1 : 1);
  }
  const shape = shapeAt(target);
  lastTap = shape;
  if (shape) select(shape);
  else if (selected) clearSelection();
}

// ---------------------------------------------------------------- selection and details

function ring(shape: string, soft = false) {
  sheetSvg?.querySelectorAll('.carto-hl').forEach((r) => r.remove());
  const el = shapeEl(shape);
  if (!el?.parentNode) return;
  let box: DOMRect;
  try {
    box = el.getBBox();
  } catch {
    return;
  }
  const pad = 5;
  const r = document.createElementNS(SVG_NS, 'rect');
  r.setAttribute('class', `carto-hl${soft ? ' soft' : ''}`);
  r.setAttribute('x', String(box.x - pad));
  r.setAttribute('y', String(box.y - pad));
  r.setAttribute('width', String(box.width + 2 * pad));
  r.setAttribute('height', String(box.height + 2 * pad));
  r.setAttribute('rx', '9');
  const t = el.getAttribute('transform');
  if (t) r.setAttribute('transform', t);
  el.parentNode.append(r);
}

function clearSelection() {
  selected = undefined;
  sheetSvg?.querySelectorAll('.carto-hl').forEach((r) => r.remove());
  if (panelFor === 'element') closePanel();
}

function select(shape: string, quiet = false) {
  if (!here) return;
  const drawing = data.drawings[here.d]!;
  const ei = drawing.shapes[shape];
  if (ei === undefined) return;
  selected = shape;
  ring(shape);
  // The panel takes room from the stage: the drawing stays where it is under the pointer.
  fitted = false;
  const wasOpen = els.panel.classList.contains('open');
  details(data.elements[ei]!, drawing, shape);
  if (!wasOpen && !quiet) setTimeout(() => keepInSight(shape), 200);
  if (!quiet) els.live.textContent = data.elements[ei]!.label;
}

function openPanel(...content: Child[]) {
  els.panelIn.replaceChildren(...content.filter((c): c is Node | string => c !== false && c != null));
  els.panel.classList.add('open');
  els.panelIn.scrollTop = 0;
}

function closePanel() {
  els.panel.classList.remove('open');
  panelFor = undefined;
}

function details(el: PElement, drawing: PDrawing, shape: string) {
  panelFor = 'element';
  const close = button('btn x', 'Close (Esc)', icon('x'));
  close.addEventListener('click', clearSelection);
  const drill = drawing.drill[shape];
  const facts: [string, string][] = [['id', el.id]];
  for (const p of el.props ?? []) facts.push(p);
  const parent = el.parent !== undefined ? data.elements[el.parent] : undefined;
  const where = el.where.filter(([d], i, all) => all.findIndex(([x]) => x === d) === i);
  const notes = drawing.notes?.filter((n) => n.shape === shape) ?? [];
  openPanel(
    h('div', { class: 'head' }, h('div', {}, h('span', { class: 'caps' }, el.kind ?? 'element'), h('h3', {}, el.label)), close),
    el.technology ? h('span', { class: 'kind' }, el.technology) : null,
    el.owner ? h('span', { class: 'kind' }, `owner ${el.owner}`) : null,
    el.description ? h('p', { class: 'desc' }, el.description) : null,
    drill !== undefined ? h('a', { class: 'btn primary open-btn', href: hrefOf(drill) }, icon('down'), `Open ${data.drawings[drill]!.title}`) : null,
    el.tags?.length ? h('div', { class: 'tags' }, ...el.tags.map((t) => h('span', {}, t))) : null,
    h('section', {}, h('span', { class: 'caps' }, 'Properties'), h('dl', {}, ...facts.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))),
    parent
      ? h('section', {}, h('span', { class: 'caps' }, 'Part of'), h('ul', {}, h('li', {}, parent.where[0] ? h('a', { href: hrefOf(parent.where[0][0], 0, parent.where[0][1]) }, parent.label, h('small', {}, parent.kind ?? '')) : h('span', { class: 'na' }, parent.label, h('small', {}, parent.kind ?? '')))))
      : null,
    el.links?.length
      ? h(
          'section',
          {},
          h('span', { class: 'caps' }, 'Links'),
          h(
            'ul',
            {},
            ...el.links.map((l) => {
              const href = l.href ? safeHref(l.href) : undefined;
              return h('li', {}, href && /^(https?|mailto):/i.test(href) ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, l.label, icon('out')) : h('span', { class: 'na' }, l.label, h('small', {}, 'not in this file')));
            }),
          ),
        )
      : null,
    h(
      'section',
      {},
      h('span', { class: 'caps' }, `Appears in ${plural(where.length, 'drawing')}`),
      h(
        'ul',
        {},
        ...where.map(([d, s]) => {
          const a = h('a', { href: hrefOf(d, 0, s) }, data.drawings[d]!.title, h('small', {}, data.drawings[d]!.kind));
          if (d === here?.d) a.setAttribute('aria-current', 'true');
          return h('li', {}, a);
        }),
      ),
    ),
    notes.length ? h('section', {}, h('span', { class: 'caps' }, 'Review notes'), ...notes.map(noteEl)) : null,
  );
}

function noteEl(n: NonNullable<PDrawing['notes']>[number]): HTMLElement {
  return h(
    'div',
    { class: 'note' },
    h('span', { class: 'num' }, String(n.n)),
    h('div', { class: 'body' }, h('div', { class: 'meta' }, `${n.about} · ${n.author}, ${n.date}`), h('p', {}, n.text), ...n.replies.map((r) => h('div', { class: 'reply' }, h('div', { class: 'meta' }, `${r.author}, ${r.date}`), h('p', {}, r.text)))),
  );
}

function showNotes() {
  if (!here) return;
  const notes = data.drawings[here.d]!.notes ?? [];
  panelFor = 'notes';
  const close = button('btn x', 'Close (Esc)', icon('x'));
  close.addEventListener('click', closePanel);
  const list = notes.map((n) => {
    const el = noteEl(n);
    if (n.shape) {
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      const pick = () => {
        ring(n.shape!, true);
        centerOn(n.shape!);
      };
      el.addEventListener('click', pick);
      el.addEventListener('keydown', (e) => e.key === 'Enter' && pick());
    }
    return el;
  });
  openPanel(h('div', { class: 'head' }, h('div', {}, h('span', { class: 'caps' }, 'Review'), h('h3', {}, plural(notes.length, 'open note'))), close), h('section', {}, ...list));
}

// ---------------------------------------------------------------- search

interface Hit {
  title: string;
  detail: string;
  href: string;
  score: number;
  group: 'Elements' | 'Drawings';
}

function grade(text: string | undefined, q: string): number {
  if (!text) return 0;
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  const i = t.indexOf(q);
  if (i > 0 && /[^a-z0-9]/.test(t[i - 1]!)) return 65;
  if (i > 0) return 40;
  return 0;
}

function find(query: string): Hit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const score = (fields: [string | undefined, number][]) => {
    let total = 0;
    for (const w of words) {
      const best = Math.max(0, ...fields.map(([t, k]) => grade(t, w) * k));
      if (!best) return 0;
      total += best;
    }
    return total / words.length;
  };
  const hits: Hit[] = [];
  for (const e of data.elements) {
    if (!e.where.length) continue;
    const s = score([[e.label, 1], [e.id, 0.9], [e.kind, 0.5], [e.technology, 0.6], [e.owner, 0.6], [e.description, 0.4], ...(e.tags ?? []).map((t) => [t, 0.6] as [string, number]), ...(e.props ?? []).map(([, v]) => [v, 0.3] as [string, number])]);
    if (!s) continue;
    const mine = here ? e.where.find(([d]) => d === here!.d) : undefined;
    const [d, shape] = mine ?? e.where[0]!;
    hits.push({ title: e.label, detail: [e.kind, e.technology].filter(Boolean).join(' · ') || data.drawings[d]!.title, href: hrefOf(d, 0, shape), score: s + 10, group: 'Elements' });
  }
  for (const [i, d] of data.drawings.entries()) {
    const s = score([[d.title, 1], [d.view, 0.8], [d.kind, 0.5], [d.file, 0.6]]);
    if (s) hits.push({ title: d.title, detail: d.kind, href: hrefOf(i), score: s, group: 'Drawings' });
  }
  const best = (g: Hit['group']) => hits.filter((x) => x.group === g).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  // Elements first unless a drawing is clearly what was meant.
  const [els, dws] = [best('Elements').slice(0, 30), best('Drawings').slice(0, 10)];
  return (dws[0]?.score ?? 0) > (els[0]?.score ?? 0) + 10 ? [...dws, ...els] : [...els, ...dws];
}

const searchInput = h('input', { type: 'text', placeholder: 'Find an element or a view…', 'aria-label': 'Search', autocomplete: 'off', spellcheck: 'false' });
const searchResults = h('div', { class: 'results', role: 'listbox', id: 'carto-results' });
let hitIndex = 0;

function searchBox() {
  const dialog = h('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Search' }, searchInput, searchResults, h('div', { class: 'foot' }, h('span', {}, h('kbd', {}, '↑'), ' ', h('kbd', {}, '↓'), ' to move'), h('span', {}, h('kbd', {}, '↵'), ' to open'), h('span', {}, h('kbd', {}, 'esc'), ' to close')));
  searchInput.setAttribute('aria-controls', 'carto-results');
  els.search.append(dialog);
  els.search.addEventListener('pointerdown', (e) => e.target === els.search && closeSearch());
  searchInput.addEventListener('input', () => {
    hitIndex = 0;
    listHits();
  });
  searchInput.addEventListener('keydown', (e) => {
    const links = [...searchResults.querySelectorAll('a')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      hitIndex = Math.max(0, Math.min(links.length - 1, hitIndex + (e.key === 'ArrowDown' ? 1 : -1)));
      markHit(links);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      links[hitIndex]?.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSearch();
    }
  });
}

function listHits() {
  const hits = find(searchInput.value);
  const nodes: Node[] = [];
  let group = '';
  for (const hit of hits) {
    if (hit.group !== group) nodes.push(h('div', { class: 'grp caps' }, (group = hit.group)));
    const a = h('a', { href: hit.href, role: 'option' }, h('span', {}, hit.title), h('small', {}, hit.detail));
    a.addEventListener('click', closeSearch);
    nodes.push(a);
  }
  if (!hits.length) nodes.push(h('div', { class: 'none' }, searchInput.value.trim() ? 'Nothing by that name.' : `${plural(data.elements.filter((e) => e.where.length).length, 'element')} and ${plural(data.drawings.length, 'drawing')} to search.`));
  searchResults.replaceChildren(...nodes);
  markHit([...searchResults.querySelectorAll('a')]);
}

function markHit(links: HTMLAnchorElement[]) {
  links.forEach((a, i) => a.setAttribute('aria-selected', String(i === hitIndex)));
  links[hitIndex]?.scrollIntoView({ block: 'nearest' });
}

function openSearch() {
  els.search.hidden = false;
  searchInput.select();
  listHits();
  searchInput.focus();
}

function closeSearch() {
  if (els.search.hidden) return;
  els.search.hidden = true;
  if (here) els.stage.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- keys

const KEYS: [string, string][] = [
  ['← →', 'previous and next step, then the next view'],
  ['[ ]', 'previous and next view'],
  ['↑ ↓, ⇧ ← →', 'move the drawing'],
  ['+ − 0 1', 'zoom in, out, fit, actual size'],
  ['/', 'search'],
  ['Tab', 'the next element in the drawing'],
  ['↵', 'open what the element leads to'],
  ['⌫', 'back'],
  ['P', 'present full screen'],
  ['D', 'light or dark'],
  ['Esc', 'close, stop presenting'],
];

function keysBox() {
  const close = button('btn x', 'Close (Esc)', icon('x'));
  close.addEventListener('click', () => showKeys(false));
  els.keys.append(h('div', { class: 'dialog keys', role: 'dialog', 'aria-label': 'Keys' }, h('div', { class: 'head' }, h('h3', {}, 'Keys')), h('dl', {}, ...KEYS.flatMap(([k, what]) => [h('dt', {}, ...k.split(' ').map((x) => (/^[,]$/.test(x) ? ' ' : h('kbd', {}, x)))), h('dd', {}, what)]))));
  els.keys.addEventListener('pointerdown', (e) => e.target === els.keys && showKeys(false));
}

function showKeys(on: boolean) {
  els.keys.hidden = !on;
}

function nextShape(by: number): boolean {
  if (!sheetSvg || !here) return false;
  const shapes = [...sheetSvg.querySelectorAll('[data-node], [data-group]')].map(shapeKey).filter((s): s is string => !!s && data.drawings[here!.d]!.shapes[s] !== undefined);
  const unique = [...new Set(shapes)];
  const i = selected ? unique.indexOf(selected) : -1;
  const next = unique[i + by];
  if (!next) return false;
  select(next);
  centerOn(next);
  return true;
}

function keys() {
  document.addEventListener('keydown', (e) => {
    if (!els.keys.hidden && (e.key === 'Escape' || e.key === '?')) return (e.preventDefault(), showKeys(false));
    if (!els.search.hidden) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable]')) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') return (e.preventDefault(), openSearch());
    if (e.metaKey || e.ctrlKey || e.altKey) {
      if (e.altKey && e.key === 'ArrowLeft') history.back();
      return;
    }
    const k = e.key;
    const onStage = here && !els.stage.hidden;
    const run = (f: () => void) => {
      e.preventDefault();
      f();
    };
    if (k === '/') return run(openSearch);
    if (k === '?') return run(() => showKeys(true));
    if (k === 'd' || k === 'D') return run(toggleLook);
    if (k === 'Escape') {
      if (presenting) return run(stopPresenting);
      if (els.panel.classList.contains('open')) return run(() => (panelFor === 'element' ? clearSelection() : closePanel()));
      if (selected) return run(clearSelection);
      return;
    }
    if (k === 'p' || k === 'P' || k === 'F5') return run(() => (presenting ? stopPresenting() : startPresenting()));
    if (k === 'f' || k === 'F') return run(() => (presenting ? stopPresenting() : startPresenting()));
    if (t.closest('a, button') && (k === 'Enter' || k === ' ')) return;
    if (k === 'ArrowRight' && !e.shiftKey) return run(() => move(1));
    if (k === 'ArrowLeft' && !e.shiftKey) return run(() => move(-1));
    if (k === 'PageDown' || (k === ' ' && !e.shiftKey)) return run(() => move(1));
    if (k === 'PageUp' || (k === ' ' && e.shiftKey)) return run(() => move(-1));
    if (k === ']') return run(() => moveDrawing(1));
    if (k === '[') return run(() => moveDrawing(-1));
    if (k === 'Home' || k === 'h' || k === 'H') return run(() => (data.site ? (location.hash = '#contents') : go(0)));
    if (k === 'Backspace') return run(() => history.back());
    if (!onStage) return;
    const step = 80;
    if (k === 'ArrowUp') return run(() => panBy(0, step));
    if (k === 'ArrowDown') return run(() => panBy(0, -step));
    if (k === 'ArrowLeft') return run(() => panBy(step, 0));
    if (k === 'ArrowRight') return run(() => panBy(-step, 0));
    if (k === '+' || k === '=') return run(() => zoomBy(1.25));
    if (k === '-' || k === '_') return run(() => zoomBy(0.8));
    if (k === '0') return run(fit);
    if (k === '1') return run(() => zoomTo(1));
    if (k === 'Enter' && selected) {
      const to = data.drawings[here!.d]!.drill[selected];
      if (to !== undefined) return run(() => go(to));
    }
    if (k === 'Tab' && t === els.stage && !presenting && nextShape(e.shiftKey ? -1 : 1)) return e.preventDefault();
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && presenting) stopPresenting();
  });
}

// ---------------------------------------------------------------- light and dark

function setLook() {
  document.documentElement.dataset.theme = look();
  if (here) {
    const keepSel = selected;
    const pic = here.step ? data.drawings[here.d]!.steps![here.step - 1]! : data.drawings[here.d]!;
    draw(pic);
    apply();
    if (keepSel) ring(keepSel);
  }
  if (els.home.firstChild) {
    for (const t of els.home.querySelectorAll<HTMLElement>('[data-thumb]')) t.replaceChildren();
    thumbs();
  }
}

function toggleLook() {
  const next: Look = look() === 'dark' ? 'light' : 'dark';
  // Back to the system's choice when that is what was picked.
  picked = next === (system.matches ? 'dark' : 'light') ? null : next;
  store.set('theme', picked);
  setLook();
}

// ---------------------------------------------------------------- print

let printed = false;
/** A page per drawing, light, with its name over it; a folder starts with its contents. */
function buildPrint() {
  if (printed) return;
  printed = true;
  const pages: Node[] = [];
  if (data.site)
    pages.push(
      h(
        'section',
        { class: 'page cover' },
        h('span', { class: 'caps' }, 'Architecture'),
        h('h1', {}, data.title),
        h('div', { class: 'caps' }, data.made),
        h('ol', {}, ...data.files.flatMap((f) => f.drawings.map((d) => h('li', {}, data.drawings[d]!.title)))),
      ),
    );
  for (const f of data.files)
    for (const d of f.drawings) {
      const dr = data.drawings[d]!;
      const svg = svgOf(dr, 'light');
      if (!svg) continue;
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      pages.push(h('section', { class: 'page', 'data-d': d }, h('header', {}, h('b', {}, dr.title), h('span', { class: 'caps' }, dr.kind), h('span', { class: 'caps' }, data.title)), h('div', { class: 'fig' }, svg)));
    }
  els.print.replaceChildren(...pages);
  document.body.dataset.print = 'ready';
}

// ---------------------------------------------------------------- start

function start() {
  try {
    data = load();
  } catch {
    document.body.append(h('p', { class: 'loading' }, 'This file is damaged: its diagrams could not be read.'));
    return;
  }
  data.drawings.forEach((d, i) => byKey.set(d.key, i));
  // A link to a file opens its first drawing.
  for (const f of data.files) if (f.drawings[0] !== undefined && !byKey.has(f.path)) byKey.set(f.path, f.drawings[0]);
  document.documentElement.dataset.theme = look();
  frame();
  sidebar();
  searchBox();
  keysBox();
  gestures();
  keys();
  system.addEventListener('change', () => picked === null && setLook());
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeprint', buildPrint);
  route();
  els.stage.focus({ preventScroll: true });
  document.body.dataset.ready = 'true';
  // The print pages are made while nothing else happens, so printing (and print to PDF) is immediate.
  setTimeout(buildPrint, 400);
}

start();
