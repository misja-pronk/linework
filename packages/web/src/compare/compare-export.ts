// What a comparison is taken away as: the summary in Markdown (copied, or as a file) for a change
// advisory board, the picture on screen as SVG or PNG, and a two-slide deck: before and after, each
// with its marks, the sentences in the speaker notes. Pictures are drawn again with fonts embedded.
import type { LayoutSidecar } from '@cartography/core';
import { compare, explainMarkdown, summary, type Comparison, type Explained, type Picture } from '@cartography/diff';
import { baseName, download } from '../export.ts';
import type { Baseline } from './versions.ts';
import type { CompareMode, CompareNow } from './compare-view.tsx';

export interface CompareExports {
  copySummary(): Promise<void>;
  saveSummary(): Promise<void>;
  savePng(): Promise<void>;
  saveSvg(): Promise<void>;
  savePptx(): Promise<void>;
}

interface Input {
  baseline: Baseline;
  now: CompareNow;
  name: string;
  mode: CompareMode;
  options(side: { sidecar?: LayoutSidecar; load?: (f: string) => string }): Record<string, unknown>;
  sentences(): Explained[];
  diff(): Comparison | undefined;
  notify(message: string, opts?: { tone?: 'error' }): void;
}

/** Browsers refuse canvases above roughly 16.7 million pixels (Safari); stay under it. */
const MAX_PIXELS = 16_000_000;

export async function svgToPng(svg: string, width: number, height: number, wanted = 2): Promise<Blob> {
  const scale = Math.min(wanted, Math.sqrt(MAX_PIXELS / (width * height)));
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await img.decode();
  await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const g = canvas.getContext('2d')!;
  g.scale(scale, scale);
  g.drawImage(img, 0, 0, width, height);
  URL.revokeObjectURL(img.src);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The browser could not make the PNG'))), 'image/png'));
}

export function compareExports(i: Input): CompareExports {
  const markdown = () => {
    const c = i.diff();
    if (!c) throw new Error('One moment: still comparing');
    return explainMarkdown(c.diff, c.before?.graph, c.after?.graph, { name: c.after?.graph?.title ?? i.name, against: i.baseline.name });
  };
  /** Both versions drawn again, with their fonts in the SVG (a picture outside the page has no page fonts). */
  const embedded = () =>
    compare(i.baseline.text, i.now.text, {
      before: { ...i.options(i.baseline), fonts: 'embed' },
      after: { ...i.options(i.now), fonts: 'embed' },
      ...(i.now.view ? { view: i.now.view } : {}),
    });
  const picture = async (): Promise<Picture> => {
    const c = await embedded();
    const p = i.mode === 'overlay' ? c.picture({ against: i.baseline.name }) : c.sideBySide({ against: i.baseline.name, labels: { before: `Before · ${i.baseline.name}`, after: 'After · now' } });
    if (!p) throw new Error('Nothing to draw: fix the problems first');
    return p;
  };
  const file = (suffix: string) => `${baseName(i.name)}-compare${suffix}`;
  const attempt = (what: string, run: () => Promise<void>) => () => run().catch((e: unknown) => i.notify(`${what} failed: ${e instanceof Error ? e.message : String(e)}`, { tone: 'error' }));
  return {
    copySummary: attempt('Copy', async () => {
      await navigator.clipboard.writeText(markdown());
      i.notify('Summary copied as Markdown: paste it into the change request');
    }),
    saveSummary: attempt('Export', async () => download(file('.md'), markdown(), 'text/markdown')),
    saveSvg: attempt('Export', async () => download(file('.svg'), (await picture()).svg, 'image/svg+xml')),
    savePng: attempt('Export', async () => {
      const p = await picture();
      download(file('.png'), await svgToPng(p.svg, p.width, p.height));
    }),
    savePptx: attempt('Export', async () => {
      const c = await embedded();
      const [was, is] = [c.side('before'), c.side('after')];
      const empty = (words: string): Picture => ({ svg: `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="120" viewBox="0 0 480 120"><text x="240" y="64" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#667085">${words}</text></svg>`, width: 480, height: 120 });
      const sentences = i.sentences().map((s) => s.text);
      const counts = summary(c.diff);
      const title = c.after?.graph?.title ?? c.before?.graph?.title ?? i.name;
      const slides = await Promise.all(
        [
          { pic: was ?? empty(`Not there in ${i.baseline.name}`), title: `Before: ${title}`, subtitle: `${i.baseline.name} · what was removed and changed is marked` },
          { pic: is ?? empty('Removed'), title: `After: ${title}`, subtitle: `Now · ${counts}` },
        ].map(async (s) => ({ title: s.title, subtitle: s.subtitle, svg: s.pic.svg, width: s.pic.width, height: s.pic.height, png: new Uint8Array(await (await svgToPng(s.pic.svg, s.pic.width, s.pic.height)).arrayBuffer()), notes: [s.title, '', ...sentences] })),
      );
      const { toPictureDeck } = await import('@cartography/export');
      const theme = (c.after ?? c.before)?.theme;
      download(file('.pptx'), new Blob([toPictureDeck(slides, { ...(theme ? { theme } : {}), title: `Changes to ${title}` }) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }));
      i.notify('Saved before and after as two slides; the changes are in the speaker notes');
    }),
  };
}
