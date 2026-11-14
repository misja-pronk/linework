// The room a slide of our own deck gives a drawing: the slide, less its margins and the rows the title
// and subtitle take over the drawing. The deck draws by these numbers (export's fit.ts) and the layout
// aims by them, so a drawing is shaped for the room it really gets, not for the whole slide.

/** EMU per inch, and per CSS pixel at 96 dpi. */
export const INCH = 914400;
export const PX = 9525;
/** Our own slides (EMU): 13.33 by 7.5 inches for 16:9, 10 by 7.5 for 4:3. */
export const SLIDE_SIZE = { '16:9': { W: 12192000, H: 6858000 }, '4:3': { W: 9144000, H: 6858000 } } as const;
/**
 * Our own slide's margins (EMU): modest at the sides, a little less above and below, where the
 * title row and the drawing's own white space already keep things off the edge.
 */
export const MARGIN = { side: Math.round(0.32 * INCH), top: Math.round(0.25 * INCH), bottom: Math.round(0.24 * INCH) };
/**
 * The rows over the drawing (inches): the title (24 pt), the subtitle and a step's caption lines (13 to
 * 15 pt), and the gap under them.
 */
export const ROWS = { title: 0.38, line: 0.26, gap: 0.06 };
/** Largest scale for small drawings (EMU per drawing px): a 13.5 px label becomes ~16 pt and no bigger. */
export const MAX_K = 1.6 * PX;
/**
 * The height of the key under a drawing (drawing px): a row of samples (`row`), or the KEY the built-in
 * looks draw (`key`: air, a rule and one row; each further row adds to it).
 */
export const KEY_HEIGHT = { row: 40, key: 54 };

/**
 * The room a drawing has on a slide of ours with this title and subtitle (no step told), in drawing px
 * at full size (96 dpi): what is left under the title rows, inside the margins. A drawing (and its key)
 * is scaled to fit it, never past MAX_K.
 */
export function slideArea(aspect: keyof typeof SLIDE_SIZE, rows: { title: boolean; subtitle: boolean }): { width: number; height: number } {
  const { W, H } = SLIDE_SIZE[aspect];
  const title = rows.title ? ROWS.title * INCH : 0;
  // The subtitle has a row of its own only under a title; the room starts a gap under the rows.
  const subtitle = rows.title && rows.subtitle ? ROWS.line * INCH : 0;
  const gap = title ? ROWS.gap * INCH : 0;
  return { width: (W - 2 * MARGIN.side) / PX, height: (H - MARGIN.top - MARGIN.bottom - title - subtitle - gap) / PX };
}
