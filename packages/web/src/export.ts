// Export: the same SVG the CLI writes (fonts embedded), PNG through a canvas, PowerPoint and PDF
// (their libraries load on first use, so the editor itself stays small), and the YAML itself.
// And an SVG that Office takes whole.
import { render, SLIDE_MIN_PT, themes, withReviewNotes, type RenderResult } from '@cartography/engine';
import { noteLines, type LayoutMemory, type LayoutSidecar, type NotesFile } from '@cartography/core';
import type { FamilyBytes, SlideText } from '@cartography/export';
import { iconOptions } from './icon-packs.ts';
import { brand } from './brand.ts';
import { t } from './i18n/index.ts';
import { describe, pngWithText, toText } from '@cartography/describe';

export interface ExportInput {
  text: string;
  theme: 'light' | 'dark';
  sidecar?: LayoutSidecar;
  load?: (f: string) => string;
  /** The view on screen, and the file name (for "#view" links in the SVG). */
  view?: string;
  file?: string;
  /** The drawing on screen (its `placed.memory`): the export is that drawing, not a new one from scratch. */
  previous?: LayoutMemory;
  /** The step on screen: SVG and PNG show it; PowerPoint and PDF get every step, one per slide or page. */
  step?: number;
  /** The focus set in the editor: the export is the neighbourhood on screen, and says so under its title. */
  focus?: unknown;
  /** The layers switched on in the editor (layers-control.tsx): the export is what is on screen. */
  layers?: string[];
  layerMode?: 'only' | 'dim';
  /** "With review notes": numbered markers and the notes under the drawing (PowerPoint: in the speaker notes). */
  notes?: NotesFile;
}

/** The drawing as an export draws it: with the review notes when asked for, as they are. */
function noted(r: RenderResult, input: ExportInput): RenderResult {
  if (!input.notes || !r.svg || !r.graph || !r.placed || !r.width || !r.height) return r;
  const theme = r.theme ?? themes[input.theme];
  const d = withReviewNotes({ svg: r.svg, width: r.width, height: r.height, origin: r.origin }, r.graph, r.placed, input.notes, theme, { view: r.view });
  return { ...r, svg: d.svg, width: d.width, height: d.height };
}

/** PowerPoint and PDF: the notes as speaker notes, and as markers drawn onto each page. */
function notedDrawing(r: RenderResult, input: ExportInput) {
  const { notes } = input;
  if (!notes || !r.graph || !r.placed) return {};
  const { graph, placed } = r;
  const theme = r.theme ?? themes[input.theme];
  type Drawn = { svg: string; width: number; height: number; origin: { x: number; y: number } };
  return {
    remarks: noteLines(notes, graph, r.view),
    annotate: (d: Drawn) => ({ ...d, ...withReviewNotes(d, graph, placed, notes, theme, { view: r.view }) }),
  };
}

/** Browsers refuse canvases above roughly 16.7 million pixels (Safari); stay under it. */
const MAX_PIXELS = 16_000_000;

/** What every export renders with: the editor's theme pick (fonts embedded) and icon folder win. */
export const options = (input: ExportInput) => ({ theme: input.theme, themeOverride: brand().theme, ...iconOptions(), sidecar: input.sidecar, load: input.load, view: input.view, file: input.file, previous: input.previous, step: input.step, ...(input.focus !== undefined ? { focus: input.focus } : {}), ...(input.layers ? { layers: input.layers, layerMode: input.layerMode } : {}), fonts: 'embed' as const });

export async function exportSvg(input: ExportInput): Promise<string> {
  const r = noted(await render(input.text, options(input)), input);
  if (!r.svg) throw new Error(t('Nothing to export: fix the problems first'));
  return r.svg;
}

export async function exportPng(input: ExportInput, wanted = 2): Promise<Blob> {
  const r = noted(await render(input.text, options(input)), input);
  if (!r.svg || !r.width || !r.height) throw new Error(t('Nothing to export: fix the problems first'));
  const scale = Math.min(wanted, Math.sqrt(MAX_PIXELS / (r.width * r.height)));
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([r.svg], { type: 'image/svg+xml' }));
  await img.decode();
  // Safari can report the image ready before its embedded fonts are; give it a frame.
  await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(r.width * scale);
  canvas.height = Math.round(r.height * scale);
  const g = canvas.getContext('2d')!;
  g.scale(scale, scale);
  g.drawImage(img, 0, 0, r.width, r.height);
  URL.revokeObjectURL(img.src);
  const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('The browser could not make the PNG')))), 'image/png'));
  // The PNG carries its title and description, as the CLI's does (docs/describe.md).
  const said = describe({ ...r, name: input.file });
  return new Blob([pngWithText(new Uint8Array(await png.arrayBuffer()), { title: said.title, description: toText(said, { title: false }).trim() }) as BlobPart], { type: 'image/png' });
}

/** The SVG on its page (aspect: in the YAML, a 16:9 slide by default): the canvas grown to the page's shape, the drawing centred. */
export async function exportPageSvg(input: ExportInput): Promise<string> {
  const r = noted(await render(input.text, options(input)), input);
  if (!r.svg || !r.width || !r.height) throw new Error(t('Nothing to export: fix the problems first'));
  if (!r.page) return r.svg;
  const { svgOnPage } = await import('@cartography/export');
  return svgOnPage(r.svg, r.width, r.height, r.page.width / r.page.height, r.theme?.canvas ?? themes[input.theme].canvas).svg;
}

/** A 1920 px wide picture of the page (a 1920×1080 slide by default): the drawing centred on the theme's background, with a margin. */
export async function exportSlide(input: ExportInput): Promise<Blob> {
  const r = noted(await render(input.text, options(input)), input);
  if (!r.svg || !r.width || !r.height) throw new Error(t('Nothing to export: fix the problems first'));
  const page = r.page ?? { width: 1280, height: 720 };
  const W = page.width >= page.height ? 1920 : Math.round((1920 * page.width) / page.height);
  const H = Math.round((W * page.height) / page.width);
  const margin = 72;
  const scale = Math.min((W - 2 * margin) / r.width, (H - 2 * margin) / r.height, 3);
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([r.svg], { type: 'image/svg+xml' }));
  await img.decode();
  await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  g.fillStyle = r.theme?.canvas ?? themes[input.theme].canvas;
  g.fillRect(0, 0, W, H);
  const w = r.width * scale;
  const h = r.height * scale;
  g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  URL.revokeObjectURL(img.src);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('The browser could not make the PNG')))), 'image/png'));
}

/**
 * A deck with native, editable shapes: a slide per view (the one on screen first), one per step
 * where a view has steps, then one per layer; icon PNG fallbacks drawn by the browser's canvas. `small` lists the slides
 * whose smallest text is under SLIDE_MIN_PT.
 */
export interface PptxTemplateInput {
  /** The template chosen in the Export menu. */
  bytes?: Uint8Array;
  keepLook?: boolean;
  /** Reads a template a theme names (pptx:), by its path relative to the diagram. */
  read?(path: string): Promise<Uint8Array | undefined>;
}

export async function exportPptx(input: ExportInput, name?: string, template?: PptxTemplateInput): Promise<{ blob: Blob; small: SlideText[]; warnings: string[] }> {
  const r = await render(input.text, { ...options(input), step: undefined, fonts: 'none' });
  if (!r.graph || !r.placed) throw new Error(t('Nothing to export: fix the problems first'));
  const others = (r.views ?? []).filter((v) => v.name !== r.view);
  // The other views as they are drawn from scratch (with their own pins): only the one on screen has a drawing before it.
  const rest = await Promise.all(others.map((v) => render(input.text, { ...options(input), view: v.name, previous: undefined, step: undefined, fonts: 'none' })));
  // Then a slide per layer of the drawing on screen (its steps are told on the slides before), all but the one on screen.
  const shown = r.layers?.active.join('+');
  const layered = await Promise.all((r.layers?.list ?? []).filter((l) => l.name !== shown).map((l) => render(input.text, { ...options(input), layers: [l.name], layerMode: undefined, previous: undefined, step: undefined, fonts: 'none' })));
  const layerSlides = layered.filter((x) => x.graph && x.placed && !x.empty && x.layers?.kept).map((x) => ({ ...x, steps: undefined }));
  const drawings = [r, ...rest.filter((x) => x.graph && x.placed && !x.empty), ...layerSlides].map((x) => ({ ...x, name, ...notedDrawing(x, input) }));
  const { toPptx } = await import('@cartography/export');
  const small: SlideText[] = [];
  const aspect = r.page && Math.abs(r.page.width / r.page.height - 4 / 3) < 0.01 ? '4:3' : '16:9';
  // In a PowerPoint template: the one chosen in the menu, else the one the diagram's theme names (pptx:).
  const named = r.theme?.pptx;
  const bytes = template?.bytes ?? (named && template?.read ? await template.read(named.template) : undefined);
  const warnings: string[] = [];
  if (named && !bytes) warnings.push(t('the theme makes decks in {template}, which is not in the open folder: made without it', { template: named.template }));
  const inTemplate = bytes ? { template: bytes, keepLook: template?.bytes ? !!template.keepLook : !!named?.keepLook, ...(!template?.bytes && named?.layout ? { layout: named.layout } : {}) } : {};
  const data = await toPptx(drawings, { theme: r.theme ?? input.theme, rasterize, aspect, onSlide: (t) => t.smallestPt < SLIDE_MIN_PT && small.push(t), onWarning: (w: string) => warnings.push(w), ...inTemplate });
  return { blob: new Blob([data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }), small, warnings };
}

/** Vector PDF, one page fitted to the drawing (one per step when it has steps), with the theme's own faces embedded. */
export async function exportPdf(input: ExportInput, name?: string): Promise<Blob> {
  const r = await render(input.text, { ...options(input), step: undefined, fonts: 'none' });
  if (!r.graph || !r.placed) throw new Error(t('Nothing to export: fix the problems first'));
  const [{ toPdf, pdfFamilies }, { fontFiles, bundledFontFiles }] = await Promise.all([import('@cartography/export'), import('@cartography/theme/node')]);
  // The TTFs are assets of their own, fetched only now; PDF subsetting cannot use the WOFF2 the SVG embeds.
  const bytes = async (u: URL) => new Uint8Array(await (await fetch(u)).arrayBuffer());
  const theme = r.theme ?? themes[input.theme];
  const [regular, medium, semibold] = await Promise.all(fontFiles.map(bytes));
  const families: FamilyBytes = {};
  for (const family of pdfFamilies(theme)) {
    families[family] = Object.fromEntries(await Promise.all(Object.entries(bundledFontFiles[family] ?? {}).map(async ([w, u]) => [w, await bytes(u)] as const)));
  }
  // On the drawing's page (a 16:9 slide unless aspect: says otherwise), 1 px = 0.75 pt.
  const page = r.page ? { width: r.page.width * 0.75, height: r.page.height * 0.75 } : undefined;
  const data = await toPdf({ ...r, name, ...notedDrawing(r, input) }, { theme, fonts: { 400: regular!, 500: medium!, 600: semibold! }, families, ...(page ? { page } : {}) });
  return new Blob([data as BlobPart], { type: 'application/pdf' });
}

/** What another tool's format could not hold, said to the person once the file is there. */
/** An SVG that PowerPoint, Word and Keynote take whole: no CSS, no effects, system fonts, a group per node. */
export async function exportSafeSvg(input: ExportInput): Promise<string> {
  const r = noted(await render(input.text, { ...options(input), fonts: 'none' }), input);
  if (!r.svg) throw new Error(t('Nothing to export: fix the problems first'));
  const { toSafeSvg } = await import('@cartography/export/svg-safe');
  return toSafeSvg(r.svg);
}

async function rasterize(svg: string, width: number, height: number): Promise<Uint8Array> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
  if (!blob) throw new Error(t('The browser could not draw an icon'));
  return new Uint8Array(await blob.arrayBuffer());
}

export function download(name: string, data: Blob | string, type = 'text/plain') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const baseName = (file: string) => file.replace(/\.ya?ml$/, '');
export const yamlName = (file: string) => (/\.ya?ml$/.test(file) ? file : `${file}.yaml`);
