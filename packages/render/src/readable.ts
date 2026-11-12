// Which text of a drawing a reader needs, for how small it may get on a slide: one rule for carto
// validate, the editor's page frame and its export notice, and the deck that reports its slides.

/** Text smaller than this (px) is detail (a tag, a count, a badge): it may get small before the drawing is too big for a page. */
export const DETAIL_PX = 10;

/**
 * The smallest size (px) of the text a reader needs in a drawing's SVG: the words on cards, lines and
 * groups, not the asides (the word KEY, the imprint, a map sheet's grid letters, marked data-aside)
 * nor the details under DETAIL_PX (tags, counts, badges).
 * Undefined when it has no such text.
 */
export function smallestTextPx(svg: string): number | undefined {
  const sizes = [...svg.matchAll(/<text\b[^>]*>/g)]
    .filter((m) => !m[0].includes('data-aside'))
    .map((m) => Number(/font-size="([\d.]+)"/.exec(m[0])?.[1]))
    .filter((n) => n >= DETAIL_PX);
  return sizes.length ? Math.min(...sizes) : undefined;
}
