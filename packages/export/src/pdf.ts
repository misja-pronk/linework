// Vector PDF: the same SVG the CLI writes, drawn by svg-to-pdfkit into PDFKit, so lines stay
// lines and text stays selectable text in embedded (subset) Inter. One page per diagram.
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { drawSvg } from '@cartography/render';
import { themes, type Theme } from '@cartography/theme';
import type { Drawing } from './pptx.ts';

/** Inter as TTF bytes per weight. WOFF2 will not do: fontkit cannot subset it. */
export type FontBytes = Record<400 | 500 | 600, Uint8Array>;

export interface PdfOptions {
  theme?: 'light' | 'dark' | Theme;
  /** fit: each page as big as its drawing; a4/a3: landscape sheets, the drawing scaled to fit. */
  page?: 'fit' | 'a4' | 'a3';
  fonts: FontBytes;
  /** Title and date in small print at the bottom of each page. Default on. */
  footer?: boolean;
  date?: Date;
  /** Document title in the PDF properties. */
  title?: string;
  /** Deflate content streams (default). Off only to read the PDF as text, in tests. */
  compress?: boolean;
}

const SHEETS = { a4: [841.89, 595.28], a3: [1190.55, 841.89] } as const;
const MARGIN = 28;
const FOOTER = 18;

export async function toPdf(input: Drawing | Drawing[], opts: PdfOptions): Promise<Uint8Array> {
  const drawings = Array.isArray(input) ? input : [input];
  const theme = typeof opts.theme === 'object' ? opts.theme : themes[opts.theme ?? 'light'];
  const footer = opts.footer !== false;
  const date = opts.date ?? new Date();
  const title = opts.title ?? drawings.find((d) => d.graph?.title)?.graph?.title ?? 'Diagram';
  // No default font: the browser build has no standard fonts unless registered, and Inter is all we use.
  const doc = new PDFDocument({ autoFirstPage: false, margin: 0, compress: opts.compress !== false, font: opts.fonts[400] as unknown as string, info: { Title: title, Creator: 'Cartography', Producer: 'Cartography', CreationDate: date } });
  const chunks: Uint8Array[] = [];
  doc.on('data', (c: Uint8Array) => chunks.push(c));
  const done = new Promise<void>((ok, fail) => (doc.on('end', ok), doc.on('error', fail)));
  for (const w of [400, 500, 600] as const) doc.registerFont(`Inter-${w}`, opts.fonts[w] as unknown as string);

  for (const d of drawings) {
    if (!d.graph || !d.placed) throw new Error('Nothing to export: fix the problems first');
    const out = drawSvg(d.graph, d.placed, theme, { fonts: 'none' });
    // svg-to-pdfkit only knows bold or not; name the medium weight by family so it keeps its face.
    const svg = out.svg.replace(/font-weight="500"/g, 'font-weight="500" font-family="Inter-500"');
    const foot = footer ? FOOTER : 0;
    const sheet = opts.page === 'a4' || opts.page === 'a3';
    // The SVG has its own padding: a fitted page adds nothing around it, a sheet keeps a margin.
    const m = sheet ? MARGIN : 0;
    let size: [number, number];
    let scale: number;
    if (opts.page === 'a4' || opts.page === 'a3') {
      size = [...SHEETS[opts.page]];
      scale = Math.min((size[0] - 2 * m) / out.width, (size[1] - 2 * m - foot) / out.height, 1);
    } else {
      // 1 px = 0.75 pt: the drawing at its natural 96 dpi size.
      scale = 0.75;
      size = [out.width * scale, out.height * scale + foot];
    }
    doc.addPage({ size, margin: 0 });
    doc.rect(0, 0, size[0], size[1]).fill(theme.canvas);
    const w = out.width * scale;
    const h = out.height * scale;
    const x = (size[0] - w) / 2;
    const y = m + (size[1] - 2 * m - foot - h) / 2;
    SVGtoPDF(doc, svg, x, y, {
      width: w,
      height: h,
      preserveAspectRatio: 'xMidYMid meet',
      fontCallback: (family: string, bold: boolean) => (family.includes('Inter-500') ? 'Inter-500' : bold ? 'Inter-600' : 'Inter-400'),
    });
    if (footer) {
      const label = d.graph.title ?? d.name ?? title;
      const day = date.toISOString().slice(0, 10);
      // In line with the drawing's own padding on a fitted page.
      const fx = sheet ? MARGIN : 30;
      const by = size[1] - (sheet ? MARGIN / 2 : 8) - 12;
      doc.font('Inter-400').fontSize(7.5).fillColor(theme.textFaint);
      doc.text(label, fx, by, { lineBreak: false, width: size[0] / 2 - fx });
      doc.text(day, size[0] / 2, by, { lineBreak: false, width: size[0] / 2 - fx, align: 'right' });
    }
  }
  doc.end();
  await done;
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const pdf = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) pdf.set(c, at), (at += c.length);
  return pdf;
}
