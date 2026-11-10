// How well a drawing of a given size fills a slide: what both engines choose their variant by.

/** The page around a drawing on a slide: title above, legend below, margins. Layout px. */
export interface Frame {
  width: number;
  height: number;
}

export const SLIDE = 16 / 9;

/**
 * How large the drawing comes out on a slide of the given aspect, as a scale: the bigger the
 * better, since that is how large its text is read. Free of units: only the ratio matters.
 */
export function slideScale(width: number, height: number, frame: Frame = { width: 0, height: 0 }, aspect = SLIDE): number {
  const w = width + frame.width;
  const h = height + frame.height;
  if (w <= 0 || h <= 0) return 0;
  return Math.min((1000 * aspect) / w, 1000 / h);
}

/**
 * Picks among scored variants: the best, unless the one drawn before is close enough to it, so a
 * small edit does not flip the whole arrangement. Ties go to the earlier variant: no chance in it.
 */
export function choose<T extends { variant: string; score: number }>(options: T[], previous?: string, keep = 0.9): T | undefined {
  let best: T | undefined;
  for (const o of options) if (!best || o.score > best.score + 1e-9) best = o;
  const before = previous ? options.find((o) => o.variant === previous) : undefined;
  return before && best && before.score >= best.score * keep ? before : best;
}
