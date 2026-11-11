// Export and share: pictures, slides and pages, interactive HTML, a share link, copies for the
// clipboard, the description in words. All from the document as it is in the editor now.
import { SLIDE_MIN_PT } from '@cartography/engine';
import { SHARE_LIMIT, shareLink, type LayoutSidecar } from '@cartography/core';
import { themes } from '@cartography/theme';
import { t } from '../i18n/index.ts';
import { brand } from '../brand.ts';
import { copyRich, describeResult } from '../describe.ts';
import { folderBytes, useTemplateChoice } from '../pptx-template.tsx';
import { baseName, download, exportPageSvg, exportPdf, exportPng, exportPptx, exportSafeSvg, exportSlide, exportSvg, yamlName } from '../export.ts';
import type { LayersOptions } from '../layers-control.tsx';
import type { Workspace } from '../files.ts';
import type { Doc } from './document.ts';
import type { Drawing } from './drawing.ts';
import type { FocusAsk } from './navigation.ts';
import type { Notify } from './toasts.tsx';

interface Props {
  textNow(): string;
  theme: 'light' | 'dark';
  load: ((f: string) => string) | undefined;
  pins: LayoutSidecar | undefined;
  doc: Doc;
  docFile: string | undefined;
  ws: Workspace | undefined;
  viewName: string | undefined;
  stepNo: number | undefined;
  focusAsked: FocusAsk | undefined;
  lenses: LayersOptions | undefined;
  drawing: Drawing;
  safeSvg: boolean;
  notify: Notify;
}

export function useExports({ textNow, theme, load, pins, doc, docFile, ws, viewName, stepNo, focusAsked, lenses, drawing, safeSvg, notify }: Props) {
  const { result, drawn, drawnLayout } = drawing;
  const exportInput = () => ({ text: textNow(), theme, load, sidecar: pins, view: viewName, file: docFile, previous: drawnLayout, step: stepNo, focus: focusAsked, ...lenses });
  const attempt = (what: string, run: () => Promise<void>) => () =>
    void run().catch((e: unknown) => notify(t('{what} failed: {error}', { what, error: e instanceof Error ? e.message : String(e) }), { tone: 'error' }));
  const saveLayout = () => pins && download(`${baseName(doc.name)}.layout.json`, JSON.stringify(pins, null, 2) + '\n', 'application/json');
  // SVG for Office: the same drawing without what PowerPoint and Word drop. The choice is remembered.
  const svgNow = () => (safeSvg ? exportSafeSvg(exportInput()) : exportSvg(exportInput()));
  const saveSvg = attempt(t('Export'), async () => download(`${baseName(doc.name)}.svg`, await svgNow(), 'image/svg+xml'));
  const savePng = attempt(t('Export'), async () => download(`${baseName(doc.name)}.png`, await exportPng(exportInput(), 2)));
  const saveSlide = attempt(t('Export'), async () => download(`${baseName(doc.name)}-slide.png`, await exportSlide(exportInput())));
  const pptxTemplate = useTemplateChoice(ws, (m) => notify(m, { tone: 'error' }));
  const savePptx = attempt(t('Export'), async () => {
    // In the template chosen in the menu, or the one the theme names (read from the open folder, next to the diagram).
    const read = async (p: string) => (ws ? ((await folderBytes(ws, [...(doc.path?.split('/').slice(0, -1) ?? []), p].join('/'))) ?? (await folderBytes(ws, p))) : undefined);
    const { blob, small, warnings } = await exportPptx(exportInput(), yamlName(doc.name), { bytes: pptxTemplate.chosen?.bytes, keepLook: pptxTemplate.chosen?.keepLook, read });
    download(`${baseName(doc.name)}.pptx`, blob);
    if (warnings.length && !small.length) notify(warnings.length > 1 ? t('In the template: {warning} (and {count} more)', { warning: warnings[0]!, count: warnings.length - 1 }) : t('In the template: {warning}', { warning: warnings[0]! }));
    // Every slide is checked for text too small to read from the back of a room.
    if (small.length) notify(t('{count} slide with text under {min} pt ({list}): split into views, or Tidy for the page|{count} slides with text under {min} pt ({list}): split into views, or Tidy for the page', { count: small.length, min: SLIDE_MIN_PT, list: small.map((x) => t('slide {n}: {pt} pt', { n: x.slide, pt: x.smallestPt })).join(', ') }), { tone: 'error' });
  });
  const pageName = (result?.page ?? drawn?.page)?.name ?? t('16:9 slide');
  const savePageSvg = attempt(t('Export'), async () => download(`${baseName(doc.name)}-page.svg`, await exportPageSvg(exportInput()), 'image/svg+xml'));
  const savePdf = attempt(t('Export'), async () => download(`${baseName(doc.name)}.pdf`, await exportPdf(exportInput(), yamlName(doc.name))));
  const saveHtml = (folder?: boolean) =>
    attempt(t('Export'), async () => {
      const page = await (await import('../html-export.ts')).exportPage({ file: ws && doc.path ? doc.path : yamlName(doc.name), text: textNow(), ws, load, pins, folder });
      download(`${folder && ws ? ws.name : baseName(doc.name)}.html`, page, 'text/html');
    })();
  const copySvg = attempt(t('Copy'), async () => {
    await navigator.clipboard.writeText(await svgNow());
    notify(t('SVG copied'));
  });
  // A share link carries the diagram in its #fragment, which never reaches a server.
  const copyShare = attempt(t('Share'), async () => {
    const link = await shareLink({ yaml: textNow(), name: doc.name, layout: pins, ...(brand().choice && themes[brand().choice] ? { theme: brand().choice } : {}) }, location.origin + location.pathname);
    if (link.length > SHARE_LIMIT) {
      notify(t('Too large for a link: {size} kB where {limit} kB is the most links safely carry. Share the YAML file instead.', { size: Math.ceil(link.length / 1000), limit: SHARE_LIMIT / 1000 }), { tone: 'error' });
      return;
    }
    await navigator.clipboard.writeText(link);
    const away = result?.includes?.length ? (result.includes.length === 1 ? t(' It does not carry the included file.') : t(' It does not carry the {count} included files.', { count: result.includes.length })) : '';
    notify(`${t('Share link copied: it opens read-only, and the diagram travels in the link itself, nothing was uploaded.')}${away}`);
  });
  // The drawing on screen in words (docs/describe.md), and with its picture for a wiki page.
  const description = () => describeResult(result ?? drawn, docFile);
  const copyForWiki = attempt(t('Copy'), async () => {
    const d = description();
    if (!d) throw new Error(t('Nothing to copy: fix the problems first'));
    await copyRich(exportInput(), d);
    notify(t('Picture and description copied: paste into Confluence, Notion or Google Docs'));
  });
  const copyPng = attempt(t('Copy'), async () => {
    // Safari wants the ClipboardItem created right in the click, with the PNG still on its way.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': exportPng(exportInput(), 2) })]);
    notify(t('PNG copied, paste it into slides or docs'));
  });
  return { exportInput, saveLayout, saveSvg, savePng, saveSlide, pptxTemplate, savePptx, pageName, savePageSvg, savePdf, saveHtml, copySvg, copyShare, description, copyForWiki, copyPng };
}
export type Exports = ReturnType<typeof useExports>;
