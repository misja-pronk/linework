// Export: the same SVG the CLI writes (fonts embedded), PNG through a canvas, and the YAML itself.
import { render } from '@cartography/engine';
import type { LayoutSidecar } from '@cartography/core';

export interface ExportInput {
  text: string;
  theme: 'light' | 'dark';
  sidecar?: LayoutSidecar;
  load?: (f: string) => string;
}

export async function exportSvg(input: ExportInput): Promise<string | undefined> {
  const r = await render(input.text, { theme: input.theme, sidecar: input.sidecar, load: input.load, fonts: 'embed' });
  return r.svg;
}

export async function exportPng(input: ExportInput, scale = 2): Promise<Blob | undefined> {
  const r = await render(input.text, { theme: input.theme, sidecar: input.sidecar, load: input.load, fonts: 'embed' });
  if (!r.svg || !r.width || !r.height) return undefined;
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([r.svg], { type: 'image/svg+xml' }));
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(r.width * scale);
  canvas.height = Math.round(r.height * scale);
  const g = canvas.getContext('2d')!;
  g.scale(scale, scale);
  g.drawImage(img, 0, 0, r.width, r.height);
  URL.revokeObjectURL(img.src);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? undefined), 'image/png'));
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
