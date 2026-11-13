// Which text of a drawing a reader needs, for how small it may get on a slide: one rule for carto
// validate, the editor's page frame and its export notice, and the deck that reports its slides.

/**
 * The size (px) of the smallest words a reader needs that are not set by the theme: the word KEY, the
 * tags on lines and cards (a class's 0..* and role names, a context map's U and D, environments),
 * a table's section names. As big as a line's label, so they read alike on a slide.
 */
export const SMALL_PX = 10.5;

/** Text smaller than this (px) is detail (a count, a badge, a team's size): it may get small before the drawing is too big for a page. */
export const DETAIL_PX = 10;

/**
 * The smallest size (px) of the text a reader needs in a drawing's SVG: the words on cards, lines and
 * groups, the KEY and the tags, not the asides (the imprint, a map sheet's grid letters, marked
 * data-aside) nor the details under DETAIL_PX (counts, badges).
 * Undefined when it has no such text.
 */
export function smallestTextPx(svg: string): number | undefined {
  const sizes = [...svg.matchAll(/<text\b[^>]*>/g)]
    .filter((m) => !m[0].includes('data-aside'))
    .map((m) => Number(/font-size="([\d.]+)"/.exec(m[0])?.[1]))
    .filter((n) => n >= DETAIL_PX);
  return sizes.length ? Math.min(...sizes) : undefined;
}
