// The diagram in words in the editor (docs/describe.md): for the Describe dialog, and for "Copy for
// Confluence / Notion", which puts the picture and the words on the clipboard as one piece of rich
// HTML, so a paste into Confluence, Notion or Google Docs gives both. Made here; nothing is uploaded.
import { altText, describe, escapeHtml, toHtml, toMarkdown, toText, type Description } from '@linework/describe';
import type { RenderResult } from '@linework/engine';
import { exportPng, type ExportInput } from './export.ts';

export const describeResult = (r: RenderResult | undefined, file?: string): Description | undefined => (r?.graph ? describe({ ...r, name: file }) : undefined);

export const asText = (d: Description) => toText(d);
export const asMarkdown = (d: Description) => toMarkdown(d, { level: 2 });

/** PNG bytes as a data URL; the pixel width read from its header. */
async function pngData(blob: Blob): Promise<{ url: string; width: number }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const width = new DataView(bytes.buffer).getUint32(16);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { url: `data:image/png;base64,${btoa(bin)}`, width };
}

/** The picture (PNG inline, at its 1× size) with the words under it, as editors paste it. */
export async function richHtml(input: ExportInput, d: Description): Promise<string> {
  const png = await pngData(await exportPng(input, 2));
  const width = Math.min(960, Math.round(png.width / 2));
  return `<meta charset="utf-8"><h2>${escapeHtml(d.title)}</h2>\n<p><img src="${png.url}" alt="${escapeHtml(altText(d, 1))}" width="${width}"></p>\n${toHtml(d, { title: false, level: 2 })}`;
}

/**
 * Puts the rich HTML (and the words as plain text, for anything that takes only text) on the clipboard.
 * Safari wants the ClipboardItem made right in the click, with its parts still on their way.
 */
export function copyRich(input: ExportInput, d: Description): Promise<void> {
  const html = richHtml(input, d).then((h) => new Blob([h], { type: 'text/html' }));
  const text = new Blob([toText(d)], { type: 'text/plain' });
  return navigator.clipboard.write([new ClipboardItem({ 'text/html': html, 'text/plain': text })]);
}
