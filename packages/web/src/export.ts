// Export: the same SVG the CLI writes (fonts embedded), PNG through a canvas, and the YAML itself.
import { render } from '@cartography/engine';
import type { LayoutSidecar } from '@cartography/core';

export interface ExportInput {
  text: string;
  theme: 'light' | 'dark';
  sidecar?: LayoutSidecar;
  load?: (f: string) => string;
}

/** Browsers refuse canvases above roughly 16.7 million pixels (Safari); stay under it. */
const MAX_PIXELS = 16_000_000;

export async function exportSvg(input: ExportInput): Promise<string> {
  const r = await render(input.text, { theme: input.theme, sidecar: input.sidecar, load: input.load, fonts: 'embed' });
  if (!r.svg) throw new Error('Nothing to export: fix the problems first');
  return r.svg;
}

export async function exportPng(input: ExportInput, wanted = 2): Promise<Blob> {
  const r = await render(input.text, { theme: input.theme, sidecar: input.sidecar, load: input.load, fonts: 'embed' });
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
