// One HTML file that carries a diagram, or a folder of them: every view and step drawn ahead of
// time in light and dark, with pan and zoom, a presenter, drill-down, search and element details.
// It opens from disk, makes no requests and needs no install. See docs/html-export.md.
import { collect, type HtmlExportInput, type Problem } from './collect.ts';
import { toPage, type PageStats } from './pack.ts';

export type { HtmlExportInput, Problem, PageStats };
export type * from './payload.ts';
export { collect, drawnShapes } from './collect.ts';
export { base64, fontCss, shareIcons, toPage } from './pack.ts';

export interface HtmlExport {
  html: string;
  /** Diagrams that did not draw, or drew with errors. */
  problems: Problem[];
  stats: PageStats;
}

export async function exportHtml(input: HtmlExportInput & { date?: Date }): Promise<HtmlExport> {
  const c = await collect(input);
  const { html, stats } = await toPage(c, { date: input.date });
  return { html, problems: c.problems, stats };
}
