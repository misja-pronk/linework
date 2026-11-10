// The text alternative inside the SVG itself: a <title> and a <desc> right after the root, which the
// root names with role="img", aria-labelledby and aria-describedby. Screen readers read it wherever the
// file ends up (an <img>, inline in a page, a wiki attachment), and browsers show the title on hover.
import { escapeHtml } from './text.ts';

export interface SvgText {
  title: string;
  /** The description in plain text; line breaks are kept as they are. */
  desc?: string;
  /** Prefix for the two ids, unique on a page with several drawings (render's idPrefix). */
  id?: string;
}

/** The SVG with its title and description; an SVG that already has a role is left as it is. */
export function accessibleSvg(svg: string, text: SvgText): string {
  const open = /<svg\b[^>]*>/.exec(svg);
  if (!open || /\srole=/.test(open[0])) return svg;
  const id = (text.id ?? 'carto').replace(/[^\w-]/g, '-');
  const attrs = ` role="img" aria-labelledby="${id}-title"${text.desc ? ` aria-describedby="${id}-desc"` : ''}`;
  const head = open[0].replace(/\/?>$/, (end) => `${attrs}${end}`);
  const inner = `<title id="${id}-title">${escapeHtml(text.title)}</title>${text.desc ? `<desc id="${id}-desc">${escapeHtml(text.desc)}</desc>` : ''}`;
  return svg.slice(0, open.index) + head + inner + svg.slice(open.index + open[0].length);
}
