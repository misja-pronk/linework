// PowerPoint deck: one 16:9 (or 4:3) slide per diagram, the drawing as native shapes scaled into
// the space under the slide title, speaker notes from the title and subtitle. Written as plain
// OOXML zipped with fflate, so it runs the same in Node and the browser.
import { zipSync, strToU8 } from 'fflate';
import type { Faded, Graph, Placed, StepState } from '@cartography/core';
import { icon } from '@cartography/icons';
import { wrap } from '@cartography/render';
import { inThemeFonts, look, themes, type Theme } from '@cartography/theme';
import * as ox from './ooxml.ts';
import { group, shape, type Run } from './shapes.ts';
import { altOf } from './alt.ts';
import { contentSize, drawDiagram, PX, type IconRef, type SlideImages } from './slide.ts';
import { pages } from './steps.ts';

/** What render() returns, or anything else carrying a built graph and its layout. */
export interface Drawing {
  graph?: Graph;
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
  /** Review notes, a line each: added to the speaker notes when an export asks for them. */
  remarks?: string[];
  /** Draws on the finished SVG before it goes on the page (review note markers in a PDF). */
  annotate?(drawn: { svg: string; width: number; height: number; origin: { x: number; y: number } }): { svg: string; width: number; height: number };
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
  const theme = typeof opts.theme === 'object' ? opts.theme : themes[opts.theme ?? 'light'];
  const font = opts.font ?? theme.font.sans ?? 'Inter';
  const fonts = { sans: font, mono: opts.monoFont ?? theme.font.monoFace ?? firstFamily(theme.font.mono) ?? 'Courier New' };
  // The title as the theme sets it: in capitals or the monospace face where asked.
  const tl = look(theme).title;
  const titleRun = (text: string): Run => ({ text: tl.caps ? text.toUpperCase() : text, size: 24, bold: tl.weight >= 600, color: theme.text, ...(tl.mono ? { font: fonts.mono, mono: true } : {}), ...(tl.tracking ? { spacing: tl.tracking } : {}) });
  const W = opts.aspect === '4:3' ? 9144000 : 12192000;
  const H = 6858000;
  const files: Record<string, Uint8Array> = {};
  const put = (path: string, xml: string) => (files[path] = strToU8(xml));

  // Icons are shared by all slides: one SVG (and PNG) part per icon, colour and size.
  const media = new Map<string, { n: number; svg: string; size: number }>();
  const slides: { xml: string; rels: ox.Rel[]; notes: string[] }[] = [];

  if (opts.title) {
    let id = 1;
    const text = (ph: string, name: string, s: string, run: Run) =>
      shape({ id: ++id, name, ph, frame: { x: MARGIN, y: ph === 'ctrTitle' ? H * 0.36 : H * 0.36 + 1000000, w: W - 2 * MARGIN, h: ph === 'ctrTitle' ? 900000 : 600000 }, geom: { prst: 'rect' }, text: { anchor: ph === 'ctrTitle' ? 'b' : 't', paras: [{ runs: [{ ...run, text: s }] }] } }, font);
    let tree = text('ctrTitle', 'Title 1', opts.title, { text: '', size: 36, bold: true, color: theme.text });
    if (opts.subtitle) tree += text('subTitle', 'Subtitle 2', opts.subtitle, { text: '', size: 18, color: theme.textMuted });
    slides.push({ xml: ox.slideXml(tree), rels: [{ id: 'rId1', type: ox.relType.layout, target: '../slideLayouts/slideLayout2.xml' }], notes: [opts.title, opts.subtitle ?? ''] });
  }

  for (const { drawing: d, view } of pages(drawings, opts.steps)) {
    if (!d.graph || !d.placed) throw new Error('Nothing to export: fix the problems first');
    const { graph, placed } = d;
    const state = view?.states[view.index];
    const rels: ox.Rel[] = [{ id: 'rId1', type: ox.relType.layout, target: '../slideLayouts/slideLayout1.xml' }];
    const refs = new Map<string, IconRef>();
    const icons = (name: string, color: string, size: number, stroke: number): IconRef | undefined => {
      const key = `${name}|${color}|${size}|${stroke}`;
      const known = refs.get(key);
      if (known) return known;
      // An official icon comes as the SVG data URI the drawing has; a line icon is drawn in its colour.
      const svg = name.startsWith('data:image/svg+xml;base64,') ? decodeBase64(name.slice(26)) : iconSvg(name, color, size, stroke);
      if (!svg) return undefined;
      let m = media.get(key);
      if (!m) media.set(key, (m = { n: media.size + 1, svg, size }));
      const ref: IconRef = { svg: `rId${rels.length + 1}` };
      rels.push({ id: ref.svg, type: ox.relType.image, target: `../media/icon${m.n}.svg` });
      if (opts.rasterize) {
        ref.png = `rId${rels.length + 1}`;
        rels.push({ id: ref.png, type: ox.relType.image, target: `../media/icon${m.n}.png` });
      }
      refs.set(key, ref);
      return ref;
    };

    let id = 1;
    const next = () => ++id;
    let tree = '';
    let top = MARGIN;
    if (graph.title) {
      tree += shape({ id: next(), name: 'Title', ph: 'title', frame: { x: MARGIN, y: MARGIN, w: W - 2 * MARGIN, h: 0.5 * INCH }, geom: { prst: 'rect' }, text: { anchor: 'ctr', paras: [{ runs: [titleRun(graph.title)] }] } }, font);
      top += 0.5 * INCH;
      if (graph.subtitle) {
        tree += shape({ id: next(), name: 'Subtitle', textBox: true, frame: { x: MARGIN, y: top, w: W - 2 * MARGIN, h: 0.32 * INCH }, geom: { prst: 'rect' }, text: { anchor: 't', paras: [{ runs: [{ text: graph.subtitle, size: 13, color: theme.textMuted }] }] } }, font);
        top += 0.32 * INCH;
      }
      top += 0.18 * INCH;
    }
    // A step's title and caption sit under the drawing, as high as the longest of all steps, so the drawing never moves.
    const said = (s: StepState) => [...(s.title ? [{ text: s.title, title: true }] : []), ...(s.caption ? wrap(s.caption, CAPTION.px, 400, (W - 2 * MARGIN) / PX - 80).map((text) => ({ text, title: false })) : [])];
    const told = !!view && view.caption !== false;
    const below = told ? Math.round((0.18 + CAPTION.row * Math.max(1, ...view.states.map((s) => said(s).length))) * INCH) : 0;
    let smallest = Infinity;
    // Scale the drawing into what is left, centred, never bigger than MAX_K.
    const area = { x: MARGIN, y: top, w: W - 2 * MARGIN, h: H - MARGIN - top - below };
    // Measured in the theme's own faces, like the SVG, so text boxes are as wide as the words in them.
    // The drawing is one group with alt text: a screen reader hears what the diagram shows, then each shape's own.
    const whole = next();
    const drawing = await inThemeFonts(theme, () => {
      const c = contentSize(graph, placed, theme, view);
      const k = Math.min(area.w / Math.max(1, c.width), area.h / Math.max(1, c.height), MAX_K);
      const at = { k, x: area.x + (area.w - c.width * k) / 2 + c.left * k, y: area.y + (area.h - c.height * k) / 2 + c.top * k, onText: (pt: number) => (smallest = Math.min(smallest, pt)) };
      return drawDiagram(graph, placed, theme, at, fonts, icons, next, view, d.images);
    });
    tree += group(whole, `Diagram: ${graph.title ?? d.name ?? 'Diagram'}`, { x: 0, y: 0, w: W, h: H }, [drawing], altOf(d, 1500, view));
    if (Number.isFinite(smallest)) opts.onSlide?.({ slide: slides.length + 1, ...(graph.title ? { title: graph.title } : {}), ...(told ? { step: view!.index + 1 } : {}), smallestPt: Math.round(smallest * 10) / 10 });
    if (told && state) {
      const y = H - MARGIN - below + 0.18 * INCH;
      tree += shape({ id: next(), name: 'Step rule', frame: { x: MARGIN, y: y - 0.1 * INCH, w: 0.42 * INCH, h: 0.03 * INCH }, geom: { prst: 'rect' }, fill: { color: theme.accent ?? theme.tones.blue.fg }, line: null }, font);
      const paras = said(state).map((l) => ({ runs: [{ text: l.text, size: l.title ? CAPTION.title : CAPTION.text, bold: l.title, color: l.title || !state.title ? theme.text : theme.textMuted }] }));
      if (paras.length) tree += shape({ id: next(), name: 'Step caption', textBox: true, frame: { x: MARGIN, y, w: W - 2 * MARGIN - INCH, h: below - 0.18 * INCH }, geom: { prst: 'rect' }, text: { anchor: 't', paras } }, font);
      tree += shape({ id: next(), name: 'Step number', textBox: true, frame: { x: W - MARGIN - INCH, y, w: INCH, h: CAPTION.row * INCH }, geom: { prst: 'rect' }, text: { anchor: 't', paras: [{ align: 'r', runs: [{ text: `${view.index + 1} / ${view.states.length}`, size: 11, color: theme.textFaint }] }] } }, font);
    }

    const nodes = graph.nodes.filter((n) => !n.folded).length;
    const about = [graph.title ?? d.name ?? 'Diagram', graph.subtitle ?? ''];
    // What the presenter says at this step leads the speaker notes.
    const notes = told && state ? [...[state.title, state.caption].filter((s): s is string => !!s), '', `Step ${view.index + 1} of ${view.states.length} — ${about[0]}${d.name ? `, from ${d.name}` : ''}.`] : [...about, '', `${nodes} elements, ${graph.edges.length} connections${d.name ? `, from ${d.name}` : ''}.`];
    if (d.remarks?.length) notes.push('', 'Review notes:', ...d.remarks);
    slides.push({ xml: ox.slideXml(tree, !!view && view.index > 0), rels, notes });
  }

  // Rasterise after drawing, once per icon, in parallel where the rasteriser is async.
  const pngs = opts.rasterize ? await Promise.all([...media.values()].map((m) => opts.rasterize!(m.svg, Math.max(64, m.size * 8), Math.max(64, m.size * 8)))) : [];
  const names: string[] = [];
  for (const [i, m] of [...media.values()].entries()) {
    files[`ppt/media/icon${m.n}.svg`] = strToU8(m.svg);
    names.push(`icon${m.n}.svg`);
    if (pngs[i]) {
      files[`ppt/media/icon${m.n}.png`] = pngs[i]!;
      names.push(`icon${m.n}.png`);
    }
  }

  const palette: ox.Palette = { canvas: theme.canvas, text: theme.text, muted: theme.textMuted, accent: ['blue', 'teal', 'violet', 'amber', 'rose', 'green'].map((t) => theme.tones[t as 'blue'].fg), font };
  const title = opts.title ?? drawings.find((d) => d.graph?.title)?.graph?.title ?? 'Diagram';
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
