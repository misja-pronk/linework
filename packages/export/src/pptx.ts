// PowerPoint deck: one 16:9 (or 4:3) slide per diagram, the drawing as native shapes scaled into
// the space under the slide title, speaker notes from the title and subtitle. Written as plain
// OOXML zipped with fflate, so it runs the same in Node and the browser.
import { zipSync, strToU8 } from 'fflate';
import type { Faded, Graph, Placed, StepState } from '@cartography/core';
import { icon } from '@cartography/icons';
import { wrap } from '@cartography/render';
import { inThemeFonts, isDark, look, themes, type Theme } from '@cartography/theme';
import * as ox from './ooxml.ts';
import { group, shape, type Run } from './shapes.ts';
import { altOf } from './alt.ts';
import { contentSize, drawDiagram, PX, type IconRef, type PictureKind, type SlideImages } from './slide.ts';
import { pages } from './steps.ts';
import { chooseLayout, readTemplate, type PptxTemplate } from './template/read.ts';
import { filled, footer, planSlide } from './template/place.ts';
import { pageColor, templateTheme } from './template/theme.ts';
import { writeTemplateDeck } from './template/write.ts';
import type { Lang } from '@cartography/i18n';
import { tr } from '@cartography/i18n/drawing';

/** What render() returns, or anything else carrying a built graph and its layout. */
export interface Drawing {
  graph?: Graph;
  /** The language of the words the export adds (speaker notes, alt text): render()'s, the diagram's `lang:`. */
  lang?: Lang;
  placed?: Placed;
  /** File name, mentioned in the speaker notes. */
  name?: string;
  /** The diagram's steps, as render() returns them: a slide or page each. */
  steps?: StepState[];
  /** Only this step (from 1). */
  step?: number;
  /** Steps nobody wrote (a dynamic view's numbered lines, a sequence's messages): one slide unless asked. */
  stepsImplied?: boolean;
  /** Official icons (BYO packs) by node and group id, as render() returns them: pictures on the slide, as they are. */
  images?: SlideImages;
  /** What a layer drawn with dim-others leaves faded, as render() returns it: faded on every slide or page of the drawing. */
  faded?: Faded;
  /** The drawing in words for alt text (docs/describe.md); made from the graph when left out. */
  alt?: string;
  /** The diagram type, as render() returns it: the alt text says what kind of drawing it is. */
  type?: { id: string; name: string };
}

/** SVG to PNG bytes at the given pixel size; icons get a PNG for apps that cannot show SVG. */
export type Rasterize = (svg: string, width: number, height: number) => Uint8Array | Promise<Uint8Array>;

export interface PptxOptions {
  theme?: 'light' | 'dark' | Theme;
  aspect?: '16:9' | '4:3';
  /**
   * Typeface for the text; by default the theme's own (Instrument Sans for Survey, Inter for classic).
   * Slides hold native text, so the face is not embedded: where it is not installed the app
   * substitutes a sans (Arial, Helvetica). Name one here to choose it yourself, e.g. 'Arial'.
   */
  font?: string;
  /** Typeface for what the theme sets in monospace; by default the theme's (Geist Mono for Survey). Substituted by a fixed-pitch face (Consolas, Menlo, Courier New) where it is not installed. */
  monoFont?: string;
  /** Adds a title slide in front. */
  title?: string;
  subtitle?: string;
  /** Without it icons are SVG only: PowerPoint 365 and LibreOffice show them, older apps may not. */
  rasterize?: Rasterize;
  /** A slide per step is the default for written steps. True: also for steps nobody wrote; false: one slide per drawing. */
  steps?: boolean;
  date?: Date;
  /**
   * A PowerPoint template (.potx or .pptx, its bytes or as readTemplate read it): the deck keeps its
   * masters, layouts, theme and slide size, and each diagram slide is a slide of one of its layouts.
   */
  template?: Uint8Array | PptxTemplate;
  /** The template layout for diagram slides, by name; by default Title Only (or its translation), else Title and Content. */
  layout?: string;
  /** With a template: draw in the diagram's own theme instead of one made from the template's accents and fonts. */
  keepLook?: boolean;
  /** With a template: keep its own slides, in front of the diagrams. */
  keepSlides?: boolean;
  /** Told what of a template could not be used as it is (an accent too light to draw with), and what is drawn as a picture instead of native shapes. */
  onWarning?(message: string): void;
  /** Told, per slide of a drawing, the smallest text on it (points): under SLIDE_MIN_PT it is hard to read from the back of a room. */
  onSlide?(slide: SlideText): void;
}

/** The smallest text on one slide. */
export interface SlideText {
  /** From 1, counting a title slide. */
  slide: number;
  title?: string;
  /** The step shown, from 1. */
  step?: number;
  smallestPt: number;
}

const INCH = 914400;
const MARGIN = Math.round(0.45 * INCH);
/** Largest scale for small drawings: a 13.5 px label becomes ~16 pt and no bigger. */
const MAX_K = 1.6 * PX;
/** A step's caption on a slide: sizes in points, the row in inches, `px` the caption size for wrapping. */
const CAPTION = { title: 15, text: 14, row: 0.3, px: (14 * 12700) / PX };

/** The first name of a CSS font stack. */
const firstFamily = (stack: string | undefined) => stack?.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '') || undefined;

const decodeBase64 = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

export function iconSvg(name: string, color: string, size: number, stroke: number): string | undefined {
  const markup = icon(name);
  if (!markup) return undefined;
  const s = size / 24;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"><g fill="none" stroke="${color}" stroke-width="${Math.round((stroke / s) * 100) / 100}" stroke-linecap="round" stroke-linejoin="round">${markup}</g></svg>`;
}

export async function toPptx(input: Drawing | Drawing[], opts: PptxOptions = {}): Promise<Uint8Array> {
  const drawings = Array.isArray(input) ? input : [input];
  const tpl = opts.template ? ('files' in opts.template ? opts.template : readTemplate(opts.template)) : undefined;
  const layout = tpl ? chooseLayout(tpl, 'diagram', opts.layout) : undefined;
  const plan = tpl && layout ? planSlide(tpl, layout) : undefined;
  let theme = typeof opts.theme === 'object' ? opts.theme : themes[opts.theme ?? 'light'];
  if (tpl && layout && !opts.keepLook) {
    const made = templateTheme(tpl, layout);
    theme = made.theme;
    for (const w of made.warnings) opts.onWarning?.(w);
  } else if (tpl && layout) {
    // Our look on the template's page: what knocks out a line under a label takes the page's colour.
    const page = pageColor(tpl, layout);
    if (isDark(page) === (theme.mode === 'dark')) theme = { ...theme, canvas: page };
    else opts.onWarning?.(`The template's slides are ${isDark(page) ? 'dark' : 'light'} (${page}) and the diagram's theme is ${theme.mode}: leave out --keep-look, or pick a ${isDark(page) ? 'dark' : 'light'} theme`);
  }
  const font = opts.font ?? (tpl && !opts.keepLook ? tpl.fonts.minor : (theme.font.sans ?? 'Inter'));
  const fonts = { sans: font, mono: opts.monoFont ?? (tpl && !opts.keepLook ? font : (theme.font.monoFace ?? firstFamily(theme.font.mono) ?? 'Courier New')) };
  // The title as the theme sets it: in capitals or the monospace face where asked.
  const tl = look(theme).title;
  const titleRun = (text: string): Run => ({ text: tl.caps ? text.toUpperCase() : text, size: 24, bold: tl.weight >= 600, color: theme.text, ...(tl.mono ? { font: fonts.mono, mono: true } : {}), ...(tl.tracking ? { spacing: tl.tracking } : {}), ...(tpl ? { font: tpl.fonts.major } : {}) });
  const W = tpl ? tpl.width : opts.aspect === '4:3' ? 9144000 : 12192000;
  const H = tpl ? tpl.height : 6858000;
  // The room a diagram slide has: the template's (under its title, clear of its footers and logo), or ours.
  const room = plan?.area ?? { x: MARGIN, y: MARGIN, w: W - 2 * MARGIN, h: H - 2 * MARGIN };
  const files: Record<string, Uint8Array> = {};
  const put = (path: string, xml: string) => (files[path] = strToU8(xml));
  // In a template, icons are named so they cannot meet the template's own media.
  const iconName = (n: number, ext: string) => (tpl ? `cartography-icon${n}.${ext}` : `icon${n}.${ext}`);

  // Icons are shared by all slides: one SVG (and PNG) part per icon, colour and size.
  const media = new Map<string, { n: number; svg: string; size: number; height?: number }>();
  // What is drawn as a picture is said once per drawing and kind.
  const pictured = new Set<string>();
  const kindName: Record<PictureKind, string> = { sequence: 'sequence diagram', gitflow: 'git flow', roadmap: 'roadmap' };
  const slides: { xml: string; rels: ox.Rel[]; notes: string[]; layout?: string }[] = [];

  if (opts.title) {
    let id = 1;
    const titleLayout = tpl ? chooseLayout(tpl, 'title') : undefined;
    const big = titleLayout?.placeholders.find((p) => p.type === 'ctrTitle') ?? titleLayout?.placeholders.find((p) => p.type === 'title');
    const small = titleLayout?.placeholders.find((p) => p.type === 'subTitle') ?? titleLayout?.placeholders.find((p) => p.type === 'body');
    const text = (ph: string, name: string, s: string, run: Run) =>
      shape({ id: ++id, name, ph, frame: { x: MARGIN, y: ph === 'ctrTitle' ? H * 0.36 : H * 0.36 + 1000000, w: W - 2 * MARGIN, h: ph === 'ctrTitle' ? 900000 : 600000 }, geom: { prst: 'rect' }, text: { anchor: ph === 'ctrTitle' ? 'b' : 't', paras: [{ runs: [{ ...run, text: s }] }] } }, font);
    // In a template the title slide is its own layout's placeholders, filled; formatting is the template's.
    let tree = big ? filled(++id, big, [{ text: opts.title }]) : text('ctrTitle', 'Title 1', opts.title, { text: '', size: 36, bold: true, color: theme.text, ...(tpl ? { font: tpl.fonts.major } : {}) });
    if (opts.subtitle) tree += small ? filled(++id, small, [{ text: opts.subtitle }], small.type === 'body') : text('subTitle', 'Subtitle 2', opts.subtitle, { text: '', size: 18, color: theme.textMuted });
    slides.push({ xml: ox.slideXml(tree), rels: [{ id: 'rId1', type: ox.relType.layout, target: '../slideLayouts/slideLayout2.xml' }], notes: [opts.title, opts.subtitle ?? ''], ...(titleLayout ? { layout: titleLayout.path } : {}) });
  }

  for (const { drawing: d, view } of pages(drawings, opts.steps)) {
    if (!d.graph || !d.placed) throw new Error('Nothing to export: fix the problems first');
    const { graph, placed } = d;
    const state = view?.states[view.index];
    const rels: ox.Rel[] = [{ id: 'rId1', type: ox.relType.layout, target: '../slideLayouts/slideLayout1.xml' }];
    const refs = new Map<string, IconRef>();
    const icons = (name: string, color: string, size: number, stroke: number, pic?: { svg: string; height: number }): IconRef | undefined => {
      const key = pic ? pic.svg : `${name}|${color}|${size}|${stroke}`;
      const known = refs.get(key);
      if (known) return known;
      // An official icon comes as the SVG data URI the drawing has; a line icon is drawn in its colour.
      const svg = pic ? pic.svg : name.startsWith('data:image/svg+xml;base64,') ? decodeBase64(name.slice(26)) : iconSvg(name, color, size, stroke);
      if (!svg) return undefined;
      let m = media.get(key);
      if (!m) media.set(key, (m = { n: media.size + 1, svg, size, ...(pic ? { height: pic.height } : {}) }));
      const ref: IconRef = { svg: `rId${rels.length + 1}` };
      rels.push({ id: ref.svg, type: ox.relType.image, target: `../media/${iconName(m.n, 'svg')}` });
      if (opts.rasterize) {
        ref.png = `rId${rels.length + 1}`;
        rels.push({ id: ref.png, type: ox.relType.image, target: `../media/${iconName(m.n, 'png')}` });
      }
      refs.set(key, ref);
      return ref;
    };

    let id = 1;
    const next = () => ++id;
    let tree = '';
    let top = room.y;
    const told = !!view && view.caption !== false;
    // A template's text placeholder besides the content takes the step's caption, or else the subtitle.
    const captionPh = plan?.caption;
    if (graph.title && plan?.title) tree += filled(next(), plan.title, [{ text: graph.title }]);
    else if (graph.title) {
      tree += shape({ id: next(), name: 'Title', ph: tpl ? undefined : 'title', textBox: !!tpl, frame: { x: room.x, y: top, w: room.w, h: 0.5 * INCH }, geom: { prst: 'rect' }, text: { anchor: 'ctr', paras: [{ runs: [titleRun(graph.title)] }] } }, font);
      top += 0.5 * INCH;
    }
    if (graph.subtitle && captionPh && !told) tree += filled(next(), captionPh, [{ text: graph.subtitle }], true);
    else if (graph.subtitle && (graph.title || tpl)) {
      tree += shape({ id: next(), name: 'Subtitle', textBox: true, frame: { x: room.x, y: top, w: room.w, h: 0.32 * INCH }, geom: { prst: 'rect' }, text: { anchor: 't', paras: [{ runs: [{ text: graph.subtitle, size: 13, color: theme.textMuted }] }] } }, font);
      top += 0.32 * INCH;
    }
    if (top > room.y && !tpl) top += 0.18 * INCH;
    else if (top > room.y) top += 0.1 * INCH;
    // A step's title and caption sit under the drawing, as high as the longest of all steps, so the drawing never moves.
    const said = (s: StepState) => [...(s.title ? [{ text: s.title, title: true }] : []), ...(s.caption ? wrap(s.caption, CAPTION.px, 400, room.w / PX - 80).map((text) => ({ text, title: false })) : [])];
    // With a caption placeholder only the step number needs a row of its own.
    const below = !told ? 0 : captionPh ? Math.round(CAPTION.row * INCH) : Math.round((0.18 + CAPTION.row * Math.max(1, ...view.states.map((s) => said(s).length))) * INCH);
    let smallest = Infinity;
    // Scale the drawing into what is left, centred, never bigger than MAX_K.
    const area = { x: room.x, y: top, w: room.w, h: room.y + room.h - top - below };
    // Measured in the theme's own faces, like the SVG, so text boxes are as wide as the words in them.
    // The drawing is one group with alt text: a screen reader hears what the diagram shows, then each shape's own.
    const whole = next();
    const drawing = await inThemeFonts(theme, () => {
      const c = contentSize(graph, placed, theme, view);
      const k = Math.min(area.w / Math.max(1, c.width), area.h / Math.max(1, c.height), MAX_K);
      // In a template the drawing starts under the title, as a slide's content does; on our own slides it is centred.
      const y = tpl ? area.y : area.y + (area.h - c.height * k) / 2;
      const onPicture = (kind: PictureKind) => {
        const said = `${d.name ?? graph.title ?? 'Diagram'}: the ${kindName[kind]} is drawn as a picture, not native shapes`;
        if (!pictured.has(said)) opts.onWarning?.(said);
        pictured.add(said);
      };
      const at = { k, x: area.x + (area.w - c.width * k) / 2 + c.left * k, y: y + c.top * k, onText: (pt: number) => (smallest = Math.min(smallest, pt)), onPicture };
      return drawDiagram(graph, placed, theme, at, fonts, icons, next, view, d.images);
    });
    tree += group(whole, `Diagram: ${graph.title ?? d.name ?? 'Diagram'}`, { x: 0, y: 0, w: W, h: H }, [drawing], altOf(d, 1500, view));
    if (Number.isFinite(smallest)) opts.onSlide?.({ slide: slides.length + 1, ...(graph.title ? { title: graph.title } : {}), ...(told ? { step: view!.index + 1 } : {}), smallestPt: Math.round(smallest * 10) / 10 });
    if (told && state && captionPh) {
      const lines = said(state).length ? [...(state.title ? [{ text: state.title, bold: true }] : []), ...(state.caption ? [{ text: state.caption }] : [])] : [];
      if (lines.length) tree += filled(next(), captionPh, lines, true);
    } else if (told && state) {
      const y = room.y + room.h - below + 0.18 * INCH;
      tree += shape({ id: next(), name: 'Step rule', frame: { x: room.x, y: y - 0.1 * INCH, w: 0.42 * INCH, h: 0.03 * INCH }, geom: { prst: 'rect' }, fill: { color: theme.accent ?? theme.tones.blue.fg }, line: null }, font);
      const paras = said(state).map((l) => ({ runs: [{ text: l.text, size: l.title ? CAPTION.title : CAPTION.text, bold: l.title, color: l.title || !state.title ? theme.text : theme.textMuted }] }));
      if (paras.length) tree += shape({ id: next(), name: 'Step caption', textBox: true, frame: { x: room.x, y, w: room.w - INCH, h: below - 0.18 * INCH }, geom: { prst: 'rect' }, text: { anchor: 't', paras } }, font);
    }
    if (told && state) {
      const y = room.y + room.h - below + (captionPh ? 0 : 0.18 * INCH);
      tree += shape({ id: next(), name: 'Step number', textBox: true, frame: { x: room.x + room.w - INCH, y, w: INCH, h: CAPTION.row * INCH }, geom: { prst: 'rect' }, text: { anchor: 't', paras: [{ align: 'r', runs: [{ text: `${view.index + 1} / ${view.states.length}`, size: 11, color: theme.textFaint }] }] } }, font);
    }
    // The template's footer and slide number, as its layout shows them.
    for (const f of plan?.footers ?? []) tree += footer(next(), f);

    const nodes = graph.nodes.filter((n) => !n.folded).length;
    const lang = d.lang;
    const about = [graph.title ?? d.name ?? tr(lang, 'Diagram'), graph.subtitle ?? ''];
    const from = d.name ? tr(lang, ', from {file}', { file: d.name }) : '';
    // What the presenter says at this step leads the speaker notes.
    const notes = told && state ? [...[state.title, state.caption].filter((s): s is string => !!s), '', `${tr(lang, 'Step {n} of {count} — {title}', { n: view.index + 1, count: view.states.length, title: about[0]! })}${from}.`] : [...about, '', `${tr(lang, '{count} element|{count} elements', { count: nodes })}, ${tr(lang, '{count} connection|{count} connections', { count: graph.edges.length })}${from}.`];
    slides.push({ xml: ox.slideXml(tree, !!view && view.index > 0), rels, notes, ...(layout ? { layout: layout.path } : {}) });
  }

  // Rasterise after drawing, once per icon, in parallel where the rasteriser is async; a picture at twice its size.
  const pngs = opts.rasterize ? await Promise.all([...media.values()].map((m) => (m.height ? opts.rasterize!(m.svg, m.size * 2, m.height * 2) : opts.rasterize!(m.svg, Math.max(64, m.size * 8), Math.max(64, m.size * 8))))) : [];
  const names: string[] = [];
  for (const [i, m] of [...media.values()].entries()) {
    files[`ppt/media/${iconName(m.n, 'svg')}`] = strToU8(m.svg);
    names.push(iconName(m.n, 'svg'));
    if (pngs[i]) {
      files[`ppt/media/${iconName(m.n, 'png')}`] = pngs[i]!;
      names.push(iconName(m.n, 'png'));
    }
  }

  const title = opts.title ?? drawings.find((d) => d.graph?.title)?.graph?.title ?? 'Diagram';
  if (tpl) return writeTemplateDeck(tpl, slides.map((s) => ({ ...s, layout: s.layout! })), files, { keepSlides: opts.keepSlides, title, date: opts.date ?? new Date() });

  const palette: ox.Palette = { canvas: theme.canvas, text: theme.text, muted: theme.textMuted, accent: ['blue', 'teal', 'violet', 'amber', 'rose', 'green'].map((t) => theme.tones[t as 'blue'].fg), font };
  put('[Content_Types].xml', ox.contentTypes(slides.length, names));
  put('_rels/.rels', ox.rootRels());
  put('docProps/core.xml', ox.coreProps(title, opts.date ?? new Date()));
  put('docProps/app.xml', ox.appProps(slides.length));
  put('ppt/presentation.xml', ox.presentation(slides.length, W, H));
  put('ppt/_rels/presentation.xml.rels', ox.presentationRels(slides.length));
  put('ppt/presProps.xml', ox.presProps());
  put('ppt/viewProps.xml', ox.viewProps());
  put('ppt/tableStyles.xml', ox.tableStyles());
  put('ppt/theme/theme1.xml', ox.theme('Cartography', palette));
  put('ppt/theme/theme2.xml', ox.theme('Cartography Notes', { ...palette, canvas: '#FFFFFF', text: '#000000' }));
  put('ppt/slideMasters/slideMaster1.xml', ox.master(W, H, MARGIN, palette));
  put('ppt/slideMasters/_rels/slideMaster1.xml.rels', ox.masterRels());
  put('ppt/slideLayouts/slideLayout1.xml', ox.layout('titleOnly', W, H, MARGIN));
  put('ppt/slideLayouts/slideLayout2.xml', ox.layout('title', W, H, MARGIN));
  put('ppt/slideLayouts/_rels/slideLayout1.xml.rels', ox.layoutRels());
  put('ppt/slideLayouts/_rels/slideLayout2.xml.rels', ox.layoutRels());
  put('ppt/notesMasters/notesMaster1.xml', ox.notesMaster(palette));
  put('ppt/notesMasters/_rels/notesMaster1.xml.rels', ox.notesMasterRels());
  for (const [i, s] of slides.entries()) {
    const n = i + 1;
    put(`ppt/slides/slide${n}.xml`, s.xml);
    put(`ppt/slides/_rels/slide${n}.xml.rels`, ox.rels([...s.rels, { id: `rId${s.rels.length + 1}`, type: ox.relType.notes, target: `../notesSlides/notesSlide${n}.xml` }]));
    put(`ppt/notesSlides/notesSlide${n}.xml`, ox.notesSlide(s.notes));
    put(`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`, ox.notesRels(n));
  }
  // Content types first, as Office itself writes them.
  const ordered = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a === '[Content_Types].xml' ? -1 : b === '[Content_Types].xml' ? 1 : 0)));
  return zipSync(ordered, { level: 6 });
}
