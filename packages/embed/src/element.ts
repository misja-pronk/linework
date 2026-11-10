// <carto-diagram>: a diagram from a YAML file (or inline YAML) drawn in the page, with zoom, pan
// and drill-down through links. This file is the light half: the chrome, the gestures and the
// fetching. The engine arrives through `setEngine` when the element comes near the viewport.
import type { Diagnostic, LayoutSidecar, Link } from '@cartography/core';
import type { RenderResult } from '@cartography/engine';
import type * as Engine from './engine.ts';
import { describe, diagnosticText, linkTarget, linkText, safeAttribute, SVG_ELEMENTS } from './shared.ts';
import { css } from './style.ts';

type EngineModule = typeof Engine;
let engineLoader: (() => Promise<EngineModule>) | undefined;
let engine: Promise<EngineModule> | undefined;
/** Where the engine comes from: a separate file loaded on demand, or bundled in (the standalone build). */
export function setEngine(load: () => Promise<EngineModule>) {
  engineLoader = load;
}
const loadEngine = () => (engine ??= engineLoader!());

/** One step of the drill-down trail. */
interface Entry {
  /** The diagram's address: includes, the sidecar and links are relative to it. */
  url: string;
  /** Inline YAML; otherwise the text is fetched from `url`. */
  text?: string;
  view?: string;
  title?: string;
}

/** Fetched files, shared by every diagram on the page: ten diagrams on one model fetch it once. */
const fetched = new Map<string, Promise<Response>>();
const get = (url: string) => {
  let p = fetched.get(url);
  if (!p) {
    p = fetch(url, { credentials: 'same-origin' });
    fetched.set(url, p);
    p.catch(() => fetched.delete(url));
  }
  return p.then((r) => r.clone());
};

const live = new Set<CartoDiagram>();
let watching = false;
/** Pages switch between light and dark in different ways; any of them redraws the `theme="auto"` diagrams. */
function watchPage() {
  if (watching) return;
  watching = true;
  const again = () => {
    for (const el of live) el.schemeChanged();
    // Once more when a colour transition has ended: the background is one of the things read.
    setTimeout(() => live.forEach((el) => el.schemeChanged()), 400);
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', again);
  const mo = new MutationObserver(again);
  const attributes = { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-bs-theme', 'data-md-color-scheme'] };
  mo.observe(document.documentElement, attributes);
  if (document.body) mo.observe(document.body, attributes);
}

/** Whether the page around an element is light or dark right now. */
export function pageScheme(el: Element): 'light' | 'dark' {
  for (const e of [document.documentElement, document.body]) {
    if (!e) continue;
    const named = e.getAttribute('data-theme') ?? e.getAttribute('data-bs-theme');
    if (named === 'dark' || named === 'light') return named;
    const material = e.getAttribute('data-md-color-scheme');
    if (material) return material === 'slate' ? 'dark' : 'light';
    if (e.classList.contains('dark')) return 'dark';
    if (e.classList.contains('light')) return 'light';
  }
  // No convention we know: look at what is actually behind the diagram.
  for (let e: Element | null = el; e; e = e.parentElement ?? ((e.getRootNode() as ShadowRoot).host as Element | undefined) ?? null) {
    const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(getComputedStyle(e).backgroundColor);
    if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) continue;
    return 0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3]) < 110 ? 'dark' : 'light';
  }
  // Nothing painted: the browser's own canvas, which is dark only when the page allows it.
  const allowed = getComputedStyle(document.documentElement).colorScheme;
  return allowed === 'dark' || (allowed.includes('dark') && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}

const fontsAdded = new Set<string>();
/** Fonts in a shadow tree have to be registered on the document. The bundled faces go in under a private name ('Carto Instrument Sans'), so they never change the page's own text. */
function addFont(family: string, weight: number | string, style: string, base64: string) {
  const key = `${family}/${weight}/${style}`;
  if (fontsAdded.has(key) || typeof FontFace === 'undefined') return;
  fontsAdded.add(key);
  try {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const face = new FontFace(family, bytes.buffer, { weight: String(weight), style });
    document.fonts.add(face);
    void face.load().catch(() => {});
  } catch {
    // Text falls back to the fonts of the page.
  }
}

/** Names the private copy of each bundled face first in a font stack, so the drawing is set in the faces it was measured in. */
const BUNDLED = /(^|,)\s*'?(Inter|Instrument Sans|Geist Mono|Barlow|IBM Plex Sans|IBM Plex Mono|Kalam)'?\s*(?=,|$)/g;
const ownFaces = (stack: string) => stack.replace(BUNDLED, "$1'Carto $2','$2'");

/** A link written as an href (a sequence diagram's ref): the same three kinds as `links:`. */
function linkFromHref(href: string): Link {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { kind: 'url', target: href };
  const hash = href.indexOf('#');
  const file = hash < 0 ? href : href.slice(0, hash);
  const view = hash < 0 ? undefined : href.slice(hash + 1) || undefined;
  return { kind: view ? 'view' : 'file', target: href, file, ...(view ? { view } : {}) };
}

/** YAML written inside the element is indented like the HTML around it: line 1 is its first line, column 1 its own margin. */
function inlineText(script: HTMLScriptElement): string {
  const lines = (script.textContent ?? '')
    .replace(/^[ \t]*\r?\n/, '')
    .replace(/\s+$/, '')
    .split('\n');
  const margin = Math.min(...lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length));
  return lines.map((l) => l.slice(Number.isFinite(margin) ? margin : 0)).join('\n') + '\n';
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
};

let count = 0;
const MAX_ZOOM = 8;

export class CartoDiagram extends HTMLElement {
  static observedAttributes = ['src', 'view', 'theme', 'controls', 'layout', 'data-bundle'];

  #root: ShadowRoot;
  #frame!: HTMLElement;
  #bar!: HTMLElement;
  #stage!: HTMLElement;
  #canvas!: HTMLElement;
  #problems!: HTMLElement;
  #alt!: HTMLDetailsElement;
  #id = `carto${++count}`;
  #trail: Entry[] = [];
  #result?: RenderResult;
  #scheme: 'light' | 'dark' = 'light';
  #seq = 0;
  #started = false;
  #seen?: IntersectionObserver;
  #resized?: ResizeObserver;
  /** Files given in the page itself (`<script type="text/yaml" data-file>`), by address. */
  #given = new Map<string, string>();
  /** Pictures and fonts given the same way, base64. */
  #givenBytes = new Map<string, string>();
  // The drawing's size, and how it sits in the stage: scale and offset in CSS pixels.
  #w = 0;
  #h = 0;
  #scale = 1;
  #x = 0;
  #y = 0;
  #fitted = true;
  #pointers = new Map<number, { x: number; y: number }>();
  #drag?: { x: number; y: number; moved: boolean; pinch?: number };
  #swallowClick = false;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    if (!this.#frame) this.#build();
    live.add(this);
    watchPage();
    if (this.#started) return;
    if (this.getAttribute('loading') === 'eager' || typeof IntersectionObserver === 'undefined') return this.#start();
    // The engine is over a megabyte: it loads when a diagram is about to be seen, not with the page.
    this.#seen = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && this.#start(), { rootMargin: '400px' });
    this.#seen.observe(this);
  }

  disconnectedCallback() {
    live.delete(this);
    this.#seen?.disconnect();
  }

  attributeChangedCallback(name: string, before: string | null, now: string | null) {
    if (!this.#started || before === now) return;
    if (name === 'src' || name === 'view' || name === 'data-bundle') this.#trail = [];
    void this.#draw();
  }

  /** The page went light or dark. */
  schemeChanged() {
    if (!this.#started || this.#themeName() !== 'auto') return;
    if (pageScheme(this) !== this.#scheme) void this.#draw();
  }

  /** The trail of diagrams opened through links, the one shown last. */
  get trail(): { url: string; view?: string; title?: string }[] {
    return this.#trail.map(({ url, view, title }) => ({ url, ...(view ? { view } : {}), ...(title ? { title } : {}) }));
  }

  /** Back to the diagram the last link was followed from. */
  back(): boolean {
    if (this.#trail.length < 2) return false;
    this.#trail.pop();
    void this.#draw(true);
    return true;
  }

  #themeName(): string {
    return (this.getAttribute('theme') ?? 'auto').trim() || 'auto';
  }

  #build() {
    const style = document.createElement('style');
    style.textContent = css;
    const tool = (zoom: string, label: string, text: string) => h('button', { type: 'button', 'data-zoom': zoom, 'aria-label': label, title: label }, text);
    this.#bar = h('div', { class: 'bar', hidden: '' });
    this.#canvas = h('div', { class: 'canvas' });
    this.#stage = h(
      'div',
      { class: 'stage', tabindex: '0', role: 'group', 'aria-roledescription': 'diagram', 'aria-label': 'Diagram', 'aria-details': `${this.#id}-alt` },
      h('slot'),
      h('div', { class: 'wait' }, 'Loading diagram…'),
      this.#canvas,
      h('div', { class: 'tools', role: 'group', 'aria-label': 'Zoom' }, tool('out', 'Zoom out (−)', '−'), tool('in', 'Zoom in (+)', '+'), tool('fit', 'Fit (0)', '⤢')),
    );
    this.#problems = h('div', { class: 'problems', role: 'alert', hidden: '' });
    this.#alt = h('details', { class: 'alt', id: `${this.#id}-alt`, hidden: '' });
    this.#frame = h('div', { class: 'frame', part: 'frame', 'data-state': 'waiting' }, this.#bar, this.#stage, this.#problems, this.#alt);
    // A static drawing inside the element (from the docs plugins) stays visible until the live one is ready.
    if (this.querySelector(':scope > :not(script)')) this.#frame.setAttribute('data-fallback', '');
    this.#root.append(style, this.#frame);
    this.#listen();
  }

  #start() {
    if (this.#started) return;
    this.#started = true;
    this.#seen?.disconnect();
    this.#resized = new ResizeObserver(() => this.#layout());
    this.#resized.observe(this.#stage);
    void this.#draw();
  }

  // ---------------------------------------------------------------- reading

  /** The diagram to start from: `src`, or the YAML written inside the element. */
  #first(): Entry | undefined {
    const view = this.getAttribute('view') || undefined;
    const scripts = [
      ...this.querySelectorAll<HTMLScriptElement>(':scope > script[type="text/yaml"], :scope > script[type="application/yaml"], :scope > script[type="application/json"]'),
    ];
    const main = scripts.find((s) => s.type !== 'application/json' && (!s.dataset.file || s.hasAttribute('data-main')));
    const src = this.getAttribute('src');
    this.#given.clear();
    this.#givenBytes.clear();
    // Generated pages (the docs plugins, carto embed) carry the diagram and what it reads in one attribute.
    const bundle = this.#bundle();
    if (bundle) {
      const start = new URL(bundle.main, document.baseURI).href;
      for (const [k, v] of Object.entries(bundle.files)) this.#given.set(new URL(k, start).href, String(v));
      for (const [k, v] of Object.entries(bundle.assets ?? {})) this.#givenBytes.set(new URL(k, start).href, String(v));
      return { url: start, view };
    }
    const base = src ? new URL(src, document.baseURI).href : main?.dataset.file ? new URL(main.dataset.file, document.baseURI).href : document.baseURI;
    for (const s of scripts)
      if (s.dataset.file && s !== main) this.#given.set(new URL(s.dataset.file, base).href, s.type === 'application/json' ? (s.textContent ?? '') : inlineText(s));
    if (src) return { url: base, view };
    if (main) return { url: base, text: inlineText(main), view };
    return undefined;
  }

  #bundle(): { main: string; files: Record<string, string>; assets?: Record<string, string> } | undefined {
    const text = this.getAttribute('data-bundle');
    if (!text) return undefined;
    try {
      const b = JSON.parse(text) as { main?: unknown; files?: unknown; assets?: unknown };
      if (typeof b.main !== 'string' || !b.files || typeof b.files !== 'object') return undefined;
      return b as { main: string; files: Record<string, string>; assets?: Record<string, string> };
    } catch {
      return undefined;
    }
  }

  /** Same site only, unless the element says its diagram lives elsewhere; then that site is trusted too. */
  #allowed(url: string): boolean {
    const origin = new URL(url).origin;
    if (origin === location.origin) return true;
    const src = this.getAttribute('src');
    return this.hasAttribute('cross-origin') && !!src && new URL(src, document.baseURI).origin === origin;
  }

  async #response(url: string): Promise<Response> {
    if (!this.#allowed(url)) throw new Error(`${url} is on another site. Add the cross-origin attribute to load a diagram from the site its src points at.`);
    let r: Response;
    try {
      r = await get(url);
    } catch {
      throw new Error(
        location.protocol === 'file:' ? `Cannot read ${url}: a page opened as a file cannot fetch. Serve the folder, or write the YAML inside the element.` : `Cannot read ${url}`,
      );
    }
    if (!r.ok) throw new Error(`Cannot read ${url} (${r.status})`);
    return r;
  }

  async #text(url: string): Promise<string> {
    return this.#given.get(url) ?? (await this.#response(url)).text();
  }

  async #sidecar(entry: Entry): Promise<LayoutSidecar | undefined> {
    const attr = this.getAttribute('layout');
    if (attr === 'none') return undefined;
    const named = attr && entry === this.#trail[0];
    const url = named ? new URL(attr, entry.url).href : entry.url.replace(/[?#].*$/, '').replace(/\.ya?ml$/i, '') + '.layout.json';
    // A diagram that came with the page has its sidecar there too, or none: nothing to fetch.
    const local = entry.text != null || this.#given.has(entry.url);
    try {
      const text = local && !named ? this.#given.get(url) : await this.#text(url);
      return text ? (JSON.parse(text) as LayoutSidecar) : undefined;
    } catch {
      // Most diagrams have no moved elements, so no sidecar.
      return undefined;
    }
  }

  // ---------------------------------------------------------------- drawing

  async #draw(focus = false) {
    const n = ++this.#seq;
    if (!this.#trail.length) {
      const first = this.#first();
      if (!first)
        return this.#show(n, {
          diagnostics: [{ severity: 'error', message: 'Nothing to draw: give the element a src, or put the YAML in a <script type="text/yaml"> inside it.' }],
        });
      this.#trail = [first];
    }
    const entry = this.#trail.at(-1)!;
    this.#frame.setAttribute('aria-busy', 'true');
    const scheme = pageScheme(this);
    const name = this.#themeName();
    const file = entry.text != null && entry.url === document.baseURI ? undefined : decodeURIComponent(new URL(entry.url).pathname.split('/').pop() ?? '');
    let result: RenderResult;
    try {
      const [engine, text, sidecar] = await Promise.all([loadEngine(), entry.text ?? this.#text(entry.url), this.#sidecar(entry)]);
      if (n !== this.#seq) return;
      const unknown: Diagnostic[] =
        name !== 'auto' && !engine.themeNames.includes(name)
          ? [{ severity: 'warning', message: `Unknown theme "${name}", use one of: auto, ${engine.themeNames.join(', ')}` }]
          : [];
      result = await engine.draw({
        text,
        file,
        view: entry.view,
        scheme: name === 'light' || name === 'dark' ? name : scheme,
        theme: name === 'auto' ? undefined : name,
        sidecar,
        idPrefix: this.#id,
        read: (f) => this.#text(new URL(f, entry.url).href),
        bytes: async (f) => {
          const url = new URL(f, entry.url).href;
          const given = this.#givenBytes.get(url);
          return given != null ? Uint8Array.from(atob(given), (c) => c.charCodeAt(0)) : new Uint8Array(await (await this.#response(url)).arrayBuffer());
        },
      });
      result.diagnostics.push(...unknown);
      if (this.getAttribute('fonts') !== 'page') {
        for (const f of engine.themeFonts(result.theme)) for (const [weight, data] of Object.entries(f.woff2)) addFont(`Carto ${f.family}`, weight, 'normal', data);
        for (const f of result.theme?.font.faces ?? []) addFont(f.family, f.weight, f.style, f.data);
      }
    } catch (e) {
      result = { diagnostics: [{ severity: 'error', message: e instanceof Error ? e.message : String(e) }] };
    }
    if (n !== this.#seq) return;
    this.#scheme = scheme;
    entry.title = result.graph?.title ?? entry.title ?? file;
    this.#show(n, result, file, focus);
  }

  #show(n: number, result: RenderResult, file?: string, focus = false) {
    if (n !== this.#seq) return;
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    for (const d of result.diagnostics) if (d.severity === 'warning') console.warn(`carto-diagram: ${diagnosticText(d, file)}`);
    // Redrawing replaces what had the focus: it goes back to the view picker, or to the drawing.
    const active = this.#root.activeElement;
    const toSelect = active?.localName === 'select';
    const toStage = focus || (!!active && this.#canvas.contains(active));
    this.#result = result;
    this.#frame.removeAttribute('aria-busy');
    this.#frame.setAttribute('data-state', result.svg ? 'drawn' : 'failed');
    this.#frame.setAttribute('data-mode', result.theme?.mode ?? this.#scheme);

    if (result.svg) {
      const svg = this.#clean(result.svg);
      const t = result.theme;
      if (t)
        for (const [k, v] of Object.entries({ canvas: t.canvas, surface: t.surface, border: t.border, text: t.text, muted: t.textMuted }))
          this.#frame.style.setProperty(`--c-${k}`, v);
      if (svg) {
        this.#w = result.width ?? 0;
        this.#h = result.height ?? 0;
        if (this.getAttribute('fonts') !== 'page') {
          svg.style.fontFamily = ownFaces(svg.getAttribute('font-family') ?? 'sans-serif');
          // Text in the monospace face names its own family.
          for (const t of svg.querySelectorAll('[font-family]')) t.setAttribute('font-family', ownFaces(t.getAttribute('font-family')!));
        }
        this.#links(svg);
        this.#canvas.replaceChildren(svg);
        this.#frame.removeAttribute('data-fallback');
        this.#fitted = true;
        this.#layout();
      }
    } else {
      this.#canvas.replaceChildren();
      this.#stage.style.height = '';
    }

    const title = result.graph?.title;
    this.#stage.setAttribute('aria-label', title ? `Diagram: ${title}` : 'Diagram');
    this.#showProblems(errors, file);
    this.#showBar();
    this.#showAlt();
    if (toSelect) this.#bar.querySelector('select')?.focus({ preventScroll: true });
    else if (toStage) (result.svg ? this.#stage : this.#bar.querySelector<HTMLElement>('.back'))?.focus({ preventScroll: true });
    this.dispatchEvent(
      new CustomEvent('carto-render', { bubbles: true, composed: true, detail: { ok: !!result.svg && !errors.length, title, view: result.view, diagnostics: result.diagnostics } }),
    );
  }

  /**
   * The SVG is ours, but its text and links come from YAML someone else may have written: parse it as
   * XML (never as HTML), and keep only the elements and attributes the renderer draws with.
   */
  #clean(markup: string): SVGSVGElement | undefined {
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
    const root = doc.documentElement;
    if (root.nodeName !== 'svg' || doc.querySelector('parsererror')) return undefined;
    const walk = (el: Element) => {
      for (const child of [...el.children]) {
        if (!SVG_ELEMENTS.has(child.localName) || child.localName === 'style') child.remove();
        else walk(child);
      }
      for (const a of [...el.attributes]) if (!safeAttribute(el.localName, a.name, a.value)) el.removeAttribute(a.name);
    };
    walk(root);
    return document.importNode(root, true) as unknown as SVGSVGElement;
  }

  /** Elements that lead somewhere can be clicked, tabbed to and opened with Enter. */
  #links(svg: SVGSVGElement) {
    const g = this.#result?.graph;
    if (!g) return;
    const all = new Map<string, Link[]>();
    for (const x of g.nodes) if (x.links?.length) all.set(`node:${x.id}`, x.links);
    for (const x of g.groups) if (x.links?.length) all.set(`group:${x.id}`, x.links);
    for (const el of svg.querySelectorAll<SVGElement>('[data-node], [data-group]')) {
      const kind = el.hasAttribute('data-node') ? 'node' : 'group';
      const links = all.get(`${kind}:${el.getAttribute(`data-${kind}`)}`);
      const link = links?.find((l) => linkTarget(l).kind !== 'none');
      if (!link) continue;
      const shape = kind === 'node' ? g.nodes.find((x) => x.id === el.dataset.node)?.shape : undefined;
      const label = shape?.kind === 'card' ? shape.label : shape?.kind === 'table' ? shape.title : (g.groups.find((x) => x.id === el.dataset.group)?.label ?? '');
      el.classList.add('link');
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'link');
      el.setAttribute('aria-label', `${label}: open ${linkText(link)}`);
    }
    for (const a of svg.querySelectorAll('a')) a.setAttribute('rel', 'noopener noreferrer');
  }

  #linkOf(target: Element): Link | undefined {
    const g = this.#result?.graph;
    const el = target.closest<SVGElement>('.link');
    if (el && g) {
      const links = el.dataset.node != null ? g.nodes.find((x) => x.id === el.dataset.node)?.links : g.groups.find((x) => x.id === el.dataset.group)?.links;
      return links?.find((l) => linkTarget(l).kind !== 'none');
    }
    const a = target.closest('a');
    const href = a?.getAttribute('href') ?? a?.getAttribute('xlink:href');
    return href && this.#canvas.contains(a!) ? linkFromHref(href) : undefined;
  }

  /** Follows a link: a view or diagram opens in place, anything else in the browser. */
  open(link: Link) {
    const t = linkTarget(link);
    const here = this.#trail.at(-1);
    if (!here || t.kind === 'none') return;
    if (t.kind === 'url') {
      // Relative files (an ADR, a runbook) sit next to the diagram, not next to the page.
      const href = t.external ? t.href : new URL(t.href, here.url).href;
      if (this.dispatchEvent(new CustomEvent('carto-link', { bubbles: true, composed: true, cancelable: true, detail: { href } })))
        window.open(href, t.external ? '_blank' : '_self', 'noopener,noreferrer');
      return;
    }
    const url = t.kind === 'view' ? here.url : new URL(t.file, here.url).href;
    if (t.kind === 'diagram' && url === here.url && !t.view) return;
    this.#trail.push({ url, view: t.view, ...(url === here.url && here.text != null ? { text: here.text } : {}) });
    void this.#draw(true);
  }

  #showProblems(errors: Diagnostic[], file?: string) {
    this.#problems.hidden = !errors.length;
    if (!errors.length) return this.#problems.replaceChildren();
    const list = h('ul');
    for (const d of errors.slice(0, 8)) {
      const where = d.line ? `${file ?? 'line'}${file ? ':' : ' '}${d.line}:${d.column ?? 1}` : (file ?? '');
      list.append(h('li', {}, ...(where ? [h('code', {}, where), ' '] : []), d.message));
    }
    if (errors.length > 8) list.append(h('li', {}, `and ${errors.length - 8} more`));
    this.#problems.replaceChildren(h('strong', {}, errors.length > 1 ? 'This diagram has problems' : 'This diagram has a problem'), list);
  }

  /** Back and the trail after a drill-down; the view picker when asked for. */
  #showBar() {
    const parts: Node[] = [];
    if (this.#trail.length > 1) {
      const back = h('button', { type: 'button', class: 'back', 'aria-label': 'Back', title: 'Back (Backspace)' }, '←');
      back.addEventListener('click', () => this.back());
      const crumbs = h('ol');
      this.#trail.forEach((e, i) => {
        const last = i === this.#trail.length - 1;
        const text = e.title ?? e.view ?? 'Diagram';
        const item = last ? h('span', { 'aria-current': 'page' }, text) : h('button', { type: 'button' }, text);
        if (!last)
          item.addEventListener('click', () => {
            this.#trail.length = i + 1;
            void this.#draw(true);
          });
        crumbs.append(h('li', {}, item));
      });
      parts.push(back, h('nav', { 'aria-label': 'Trail' }, crumbs));
    }
    const views = this.#result?.views;
    if (views?.length && (this.getAttribute('controls') ?? '').split(/\s+/).includes('views')) {
      const select = h('select', { 'aria-label': 'View' });
      if (!this.#result?.onlyViews) select.append(h('option', { value: '' }, 'As written'));
      for (const v of views) select.append(h('option', { value: v.name }, v.title ?? v.name));
      select.value = this.#result?.view ?? '';
      select.addEventListener('change', () => {
        this.#trail.at(-1)!.view = select.value || undefined;
        void this.#draw();
      });
      parts.push(h('span', { class: 'grow' }), select);
    }
    this.#bar.hidden = !parts.length;
    this.#bar.replaceChildren(...parts);
  }

  /** The drawing in words, for screen readers and for anyone who wants the list. */
  #showAlt() {
    const g = this.#result?.graph;
    this.#alt.hidden = !g;
    if (!g) return this.#alt.replaceChildren();
    const d = describe(g);
    const elements = h('ul');
    for (const e of d.elements) {
      const li = h('li', {}, h('strong', {}, e.label), [e.detail ? ` (${e.detail})` : '', e.in ? `, in ${e.in}` : '', e.description ? `: ${e.description}` : ''].join(''));
      for (const l of e.links) {
        if (linkTarget(l).kind === 'none') continue;
        const b = h('button', { type: 'button', class: 'textlink' }, linkText(l));
        b.addEventListener('click', () => this.open(l));
        li.append(' ', b);
      }
      elements.append(li);
    }
    const relations = h('ul');
    for (const r of d.relations) relations.append(h('li', {}, `${r.from} → ${r.to}${r.label ? `: ${r.label}` : ''}`));
    const heading = [d.title, d.subtitle].filter(Boolean).join(' — ');
    this.#alt.replaceChildren(
      h('summary', {}, 'Text description'),
      ...(heading ? [h('p', {}, heading)] : []),
      ...(d.elements.length ? [h('p', { class: 'head' }, `Elements (${d.elements.length})`), elements] : []),
      ...(d.relations.length ? [h('p', { class: 'head' }, `Connections (${d.relations.length})`), relations] : []),
    );
  }

  // ---------------------------------------------------------------- zoom and pan

  /** The scale at which the whole drawing fits: as wide as the stage, never larger than drawn. */
  #fit(): number {
    const width = this.#stage.clientWidth;
    const max = parseFloat(getComputedStyle(this.#stage).maxHeight);
    return Math.min(1, width / this.#w, Number.isFinite(max) && max > 0 ? max / this.#h : 1) || 1;
  }

  #layout() {
    const svg = this.#canvas.firstElementChild as SVGSVGElement | null;
    if (!svg || !this.#w) return;
    const fit = this.#fit();
    if (this.#fitted || this.#scale < fit) {
      this.#scale = fit;
      this.#fitted = true;
    }
    this.#stage.style.height = `${Math.ceil(this.#h * fit)}px`;
    const sw = this.#stage.clientWidth;
    const sh = this.#h * fit;
    const w = this.#w * this.#scale;
    const hgt = this.#h * this.#scale;
    // Smaller than the stage: centred. Larger: it can be moved, but never out of sight.
    this.#x = w <= sw ? (sw - w) / 2 : Math.min(0, Math.max(sw - w, this.#x));
    this.#y = hgt <= sh ? (sh - hgt) / 2 : Math.min(0, Math.max(sh - hgt, this.#y));
    svg.setAttribute('width', String(Math.round(w * 100) / 100));
    svg.setAttribute('height', String(Math.round(hgt * 100) / 100));
    svg.style.transform = `translate(${Math.round(this.#x * 100) / 100}px, ${Math.round(this.#y * 100) / 100}px)`;
    this.#stage.toggleAttribute('data-zoomed', !this.#fitted);
    const [out, , fitButton] = this.#stage.querySelectorAll<HTMLButtonElement>('.tools button');
    out!.disabled = fitButton!.disabled = this.#fitted;
  }

  /** Zooms by a factor around a point of the stage (its centre without one). */
  zoom(factor: number, at?: { x: number; y: number }) {
    if (!this.#w) return;
    const fit = this.#fit();
    const p = at ?? { x: this.#stage.clientWidth / 2, y: (this.#h * fit) / 2 };
    const next = Math.min(Math.max(MAX_ZOOM, fit), Math.max(fit, this.#scale * factor));
    this.#x = p.x - ((p.x - this.#x) * next) / this.#scale;
    this.#y = p.y - ((p.y - this.#y) * next) / this.#scale;
    this.#scale = next;
    this.#fitted = next <= fit * 1.001;
    this.#layout();
  }

  /** Back to the whole drawing. */
  fit() {
    this.#fitted = true;
    this.#layout();
  }

  #pan(dx: number, dy: number) {
    this.#x += dx;
    this.#y += dy;
    this.#layout();
  }

  #listen() {
    const stage = this.#stage;
    const point = (e: { clientX: number; clientY: number }) => {
      const r = stage.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onText = (t: EventTarget | null) => t instanceof Element && !!t.closest('text') && !t.closest('.link, a');
    const inTools = (t: EventTarget | null) => t instanceof Element && !!t.closest('.tools');

    // Ctrl + wheel (which is also what a trackpad pinch sends) zooms; a plain wheel scrolls the page as always.
    stage.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        this.zoom(Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.01), point(e));
      },
      { passive: false },
    );

    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || inTools(e.target)) return;
      // Dragging over text selects it; dragging anywhere else moves the drawing.
      if (e.pointerType === 'mouse' && onText(e.target)) return;
      this.#pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = [...this.#pointers.values()];
      this.#drag = { x: e.clientX, y: e.clientY, moved: false, ...(pts.length === 2 ? { pinch: Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) } : {}) };
    });
    stage.addEventListener('pointermove', (e) => {
      const d = this.#drag;
      if (!d || !this.#pointers.has(e.pointerId)) return;
      this.#pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = [...this.#pointers.values()];
      if (pts.length === 2 && d.pinch) {
        const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
        this.zoom(dist / d.pinch, point({ clientX: (pts[0]!.x + pts[1]!.x) / 2, clientY: (pts[0]!.y + pts[1]!.y) / 2 }));
        d.pinch = dist;
        d.moved = true;
        return;
      }
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
      if (!d.moved) {
        d.moved = true;
        stage.setPointerCapture(e.pointerId);
        stage.setAttribute('data-panning', '');
      }
      this.#pan(e.clientX - d.x, e.clientY - d.y);
      d.x = e.clientX;
      d.y = e.clientY;
    });
    const end = (e: PointerEvent) => {
      this.#pointers.delete(e.pointerId);
      if (this.#drag?.moved) this.#swallowClick = true;
      if (!this.#pointers.size) this.#drag = undefined;
      stage.removeAttribute('data-panning');
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);

    stage.addEventListener('click', (e) => {
      const moved = this.#swallowClick;
      this.#swallowClick = false;
      const t = e.target as Element;
      const zoom = t.closest<HTMLElement>('[data-zoom]')?.dataset.zoom;
      if (zoom) return zoom === 'fit' ? this.fit() : this.zoom(zoom === 'in' ? 1.4 : 1 / 1.4);
      const link = this.#linkOf(t);
      if (!link) return;
      // Our own navigation, also for links the SVG carries itself: they would leave the page.
      e.preventDefault();
      if (!moved) this.open(link);
    });
    stage.addEventListener('dblclick', (e) => {
      if (onText(e.target) || inTools(e.target) || this.#linkOf(e.target as Element)) return;
      if (this.#fitted) this.zoom(2, point(e));
      else this.fit();
    });

    this.#frame.addEventListener('keydown', (e) => {
      const t = e.target as Element;
      if (t.localName === 'select' || e.defaultPrevented) return;
      if ((e.key === 'Enter' || e.key === ' ') && t.closest('.link, .canvas a')) {
        const link = this.#linkOf(t);
        if (link) {
          e.preventDefault();
          this.open(link);
        }
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      const step = 48;
      const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft')) {
        if (this.back()) e.preventDefault();
      } else if (e.altKey) return;
      else if (e.key === '+' || e.key === '=') this.zoom(1.4);
      else if (e.key === '-' || e.key === '_') this.zoom(1 / 1.4);
      else if (e.key === '0') this.fit();
      else if (moves[e.key] && !this.#fitted) {
        e.preventDefault();
        this.#pan(...moves[e.key]!);
      }
    });
  }
}

export function define() {
  if (typeof customElements !== 'undefined' && !customElements.get('carto-diagram')) customElements.define('carto-diagram', CartoDiagram);
}
