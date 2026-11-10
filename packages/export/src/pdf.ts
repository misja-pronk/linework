// Vector PDF: the same SVG the CLI writes, drawn by svg-to-pdfkit into PDFKit, so lines stay
// lines and text stays selectable text in the theme's own faces, embedded as subsets. One page per diagram.
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { drawSvg } from '@cartography/render';
import { bundledFamily, inThemeFonts, themes, type Theme } from '@cartography/theme';
import type { Drawing } from './pptx.ts';
import { pages } from './steps.ts';

/** Inter as TTF bytes per weight. WOFF2 will not do: fontkit cannot subset it. */
export type FontBytes = Record<400 | 500 | 600, Uint8Array>;
/** TTF bytes of other bundled families by name and weight (a monospace face has no 600). */
export type FamilyBytes = Record<string, Partial<Record<400 | 500 | 600, Uint8Array>>>;

/** The bundled families a theme sets its text in, besides Inter: what a caller reads for `families`. */
export const pdfFamilies = (theme: Theme): string[] => [...new Set([theme.font.sans, theme.font.monoFace].filter((f): f is string => !!f && f !== 'Inter' && !!bundledFamily(f)))];

export interface PdfOptions {
  theme?: 'light' | 'dark' | Theme;
  /** fit: each page as big as its drawing; a4/a3: landscape sheets, the drawing scaled to fit. */
  page?: 'fit' | 'a4' | 'a3';
  fonts: FontBytes;
  /** The theme's own faces (see pdfFamilies). A family that is missing here is set in Inter. */
  families?: FamilyBytes;
  /** Title and date in small print at the bottom of each page. Default on. */
  footer?: boolean;
  date?: Date;
  /** Document title in the PDF properties. */
  title?: string;
  /** Deflate content streams (default). Off only to read the PDF as text, in tests. */
  compress?: boolean;
  /** A page per step is the default for written steps. True: also for steps nobody wrote; false: one page per drawing. */
  steps?: boolean;
}

/** As render writes attribute values, so the monospace family can be found in its output. */
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * svg-to-pdfkit only knows bold or not, and takes one family per element. Give every text and tspan
 * the registered name of its face and weight, so medium stays medium and monospace stays monospace.
 */
function nameFaces(svg: string, monoFamily: string): string {
  let face = 'sans';
  return svg.replace(/<(text|tspan)\b([^>]*)>/g, (_, tag: string, attrs: string) => {
    if (tag === 'text') face = attrs.includes(monoFamily) ? 'mono' : 'sans';
    const weight = /font-weight="(\d00)"/.exec(attrs)?.[1];
    if (tag === 'tspan' && !weight) return `<tspan${attrs}>`;
    const rest = attrs.replace(/ font-family="[^"]*"/, '');
    return `<${tag}${rest} font-family="carto-${face}-${weight ?? '400'}">`;
  });
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
  // One registered name per face and weight; a weight a family lacks falls to the nearest lighter one, then to Inter.
  const sans = opts.families?.[theme.font.sans ?? ''];
  const mono = opts.families?.[theme.font.monoFace ?? ''];
  for (const w of [400, 500, 600] as const) {
    doc.registerFont(`carto-sans-${w}`, (sans?.[w] ?? opts.fonts[w]) as unknown as string);
    doc.registerFont(`carto-mono-${w}`, (mono?.[w] ?? (w === 600 ? mono?.[500] : undefined) ?? sans?.[w] ?? opts.fonts[w]) as unknown as string);
  }
  const monoFamily = `font-family="${escAttr(theme.font.mono)}"`;

  for (const { drawing: d, view } of pages(drawings, opts.steps)) {
    if (!d.graph || !d.placed) throw new Error('Nothing to export: fix the problems first');
    // Drawn in the theme's own faces, as the engine measured it.
    const { graph, placed } = d;
    const out = await inThemeFonts(theme, () => drawSvg(graph, placed, theme, { fonts: 'none', stepView: view }));
    const svg = nameFaces(out.svg, monoFamily);
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
      fontCallback: (family: string, bold: boolean) => /carto-(sans|mono)-\d00/.exec(family)?.[0] ?? (bold ? 'carto-sans-600' : 'carto-sans-400'),
    });
    if (footer) {
      const label = d.graph.title ?? d.name ?? title;
      const day = date.toISOString().slice(0, 10);
      // In line with the drawing's own padding on a fitted page.
      const fx = sheet ? MARGIN : 30;
      const by = size[1] - (sheet ? MARGIN / 2 : 8) - 12;
      doc.font('carto-sans-400').fontSize(7.5).fillColor(theme.textFaint);
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
