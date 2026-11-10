// Export: the same SVG the CLI writes (fonts embedded), PNG through a canvas, PowerPoint and PDF
// (their libraries load on first use, so the editor itself stays small), and the YAML itself.
// And the drawing for other tools: draw.io, Excalidraw, Mermaid, and an SVG that Office takes whole.
import { render, themes } from '@cartography/engine';
import type { LayoutMemory, LayoutSidecar } from '@cartography/core';
import type { FamilyBytes } from '@cartography/export';
import { brand } from './brand.ts';

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
}

/** Browsers refuse canvases above roughly 16.7 million pixels (Safari); stay under it. */
const MAX_PIXELS = 16_000_000;

/** What every export renders with: the editor's theme pick (fonts embedded) and icon folder win. */
const options = (input: ExportInput) => ({ theme: input.theme, themeOverride: brand().theme, icons: brand().icons, sidecar: input.sidecar, load: input.load, view: input.view, file: input.file, previous: input.previous, step: input.step, fonts: 'embed' as const });

export async function exportSvg(input: ExportInput): Promise<string> {
  const r = await render(input.text, options(input));
  if (!r.svg) throw new Error('Nothing to export: fix the problems first');
  return r.svg;
}

export async function exportPng(input: ExportInput, wanted = 2): Promise<Blob> {
  const r = await render(input.text, options(input));
  if (!r.svg || !r.width || !r.height) throw new Error('Nothing to export: fix the problems first');
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
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The browser could not make the PNG'))), 'image/png'));
}

/** A 1920×1080 slide: the drawing centred on the theme's background, with a margin. */
export async function exportSlide(input: ExportInput): Promise<Blob> {
  const r = await render(input.text, options(input));
  if (!r.svg || !r.width || !r.height) throw new Error('Nothing to export: fix the problems first');
  const W = 1920;
  const H = 1080;
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
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The browser could not make the PNG'))), 'image/png'));
}

/** A slide with native, editable shapes (one per step when the drawing has steps); icon PNG fallbacks drawn by the browser's canvas. */
export async function exportPptx(input: ExportInput, name?: string): Promise<Blob> {
  const r = await render(input.text, { ...options(input), step: undefined, fonts: 'none' });
  if (!r.graph || !r.placed) throw new Error('Nothing to export: fix the problems first');
  const { toPptx } = await import('@cartography/export');
  const data = await toPptx({ ...r, name }, { theme: r.theme ?? input.theme, rasterize });
  return new Blob([data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}

/** Vector PDF, one page fitted to the drawing (one per step when it has steps), with the theme's own faces embedded. */
export async function exportPdf(input: ExportInput, name?: string): Promise<Blob> {
  const r = await render(input.text, { ...options(input), step: undefined, fonts: 'none' });
  if (!r.graph || !r.placed) throw new Error('Nothing to export: fix the problems first');
  const [{ toPdf, pdfFamilies }, { fontFiles, bundledFontFiles }] = await Promise.all([import('@cartography/export'), import('@cartography/theme/node')]);
  // The TTFs are assets of their own, fetched only now; PDF subsetting cannot use the WOFF2 the SVG embeds.
  const bytes = async (u: URL) => new Uint8Array(await (await fetch(u)).arrayBuffer());
  const theme = r.theme ?? themes[input.theme];
  const [regular, medium, semibold] = await Promise.all(fontFiles.map(bytes));
  const families: FamilyBytes = {};
  for (const family of pdfFamilies(theme)) {
    families[family] = Object.fromEntries(await Promise.all(Object.entries(bundledFontFiles[family] ?? {}).map(async ([w, u]) => [w, await bytes(u)] as const)));
  }
  const data = await toPdf({ ...r, name }, { theme, fonts: { 400: regular!, 500: medium!, 600: semibold! }, families });
  return new Blob([data as BlobPart], { type: 'application/pdf' });
}

/** What another tool's format could not hold, said to the person once the file is there. */
export interface Handed {
  data: string;
  warnings: string[];
}

/** The whole drawing, not one step of it, and without embedded fonts: the other tool brings its own. */
const plain = (input: ExportInput) => ({ ...options(input), step: undefined, fonts: 'none' as const });

/** draw.io: editable shapes, containers and attached connectors; every view of the file is a page. */
export async function exportDrawio(input: ExportInput): Promise<Handed> {
  const first = await render(input.text, plain(input));
  if (!first.graph || !first.svg) throw new Error('Nothing to export: fix the problems first');
  const { toDrawio, toScene } = await import('@cartography/interop');
  // The view on screen is the drawing as it stands; the others are drawn fresh.
  const drawn = first.views?.length ? await Promise.all(first.views.map((v) => (v.name === first.view ? first : render(input.text, { ...plain(input), view: v.name, previous: undefined })))) : [first];
  const scenes = drawn.filter((r) => r.graph && r.svg).map((r) => toScene(r));
  return { data: toDrawio(scenes), warnings: [...new Set(scenes.flatMap((s) => s.warnings))] };
}

/** Excalidraw: the view on screen as rectangles, bound text and bound arrows, frames for groups. */
export async function exportExcalidraw(input: ExportInput): Promise<Handed> {
  const r = await render(input.text, plain(input));
  if (!r.graph || !r.svg) throw new Error('Nothing to export: fix the problems first');
  const { toExcalidraw, toScene } = await import('@cartography/interop');
  const scene = toScene(r);
  return { data: toExcalidraw(scene), warnings: scene.warnings };
}

/** Mermaid text of the view on screen, for a README: what is in the drawing, not where it stands. */
export async function exportMermaid(input: ExportInput): Promise<Handed> {
  const r = await render(input.text, plain(input));
  if (!r.graph) throw new Error('Nothing to export: fix the problems first');
  const { toMermaid } = await import('@cartography/interop');
  const m = toMermaid(r);
  return { data: m.text, warnings: m.warnings };
}

/** An SVG that PowerPoint, Word and Keynote take whole: no CSS, no effects, system fonts, a group per node. */
export async function exportSafeSvg(input: ExportInput): Promise<string> {
  const r = await render(input.text, { ...options(input), fonts: 'none' });
  if (!r.svg) throw new Error('Nothing to export: fix the problems first');
  const { toSafeSvg } = await import('@cartography/interop');
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
  if (!blob) throw new Error('The browser could not draw an icon');
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
