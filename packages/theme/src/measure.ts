// Text width from precomputed font metrics (scripts/fonts.mjs), so Node and the browser
// measure exactly the same and the CLI output equals the web output (requirement E2).
// Each bundled family is measured by its own advance widths; a brand font that brings its own
// files is measured as Inter times its width ratio.
import { bundledFont, MONO_ADVANCE, type BundledFont } from './fonts.ts';

export type Weight = 400 | 500 | 600;
/** Which of the theme's two faces a text is set in. */
export type Face = 'sans' | 'mono';

/** The faces to measure with: bundled family names, and the width ratio of a brand font. */
export interface TextFonts {
  sans?: string;
  mono?: string;
  scale?: number;
}

const inter = bundledFont('Inter')!;

// Set around the synchronous measure and draw steps only (withTextFonts), so concurrent renders
// with other themes never see it.
let sans: BundledFont = inter;
let mono: BundledFont | undefined;
let textScale = 1;

export function withTextFonts<T>(fonts: TextFonts | undefined, fn: () => T): T {
  const before = [sans, mono, textScale] as const;
  sans = bundledFont(fonts?.sans) ?? inter;
  mono = bundledFont(fonts?.mono);
  textScale = fonts?.scale ?? 1;
  try {
    return fn();
  } finally {
    [sans, mono, textScale] = before;
  }
}

/** Inter times a width ratio: how a brand font was measured before each face had its own table. */
export const withTextScale = <T>(scale: number | undefined, fn: () => T): T => withTextFonts({ scale }, fn);

/** Width of a sample in Inter, to compare a brand font against: scale = brand width / this. */
export const SCALE_SAMPLE = 'Orders API · Customer database 0123456789 Key Vault';

/**
 * Width of a line of text. `tracking` is letter-spacing in px, added after every character
 * (as SVG does), so spaced capitals are measured as drawn.
 */
export function measureText(text: string, size: number, weight: Weight = 400, face: Face = 'sans', tracking = 0): number {
  const font = face === 'mono' ? mono : sans;
  let n = 0;
  if (!font) {
    for (const _ of text) n++;
    return n * (MONO_ADVANCE * size + tracking);
  }
  const m = font.weights[weight] ?? font.weights[500] ?? font.weights[400]!;
  let units = 0;
  let prev = '';
  for (const ch of text) {
    units += m.adv[ch.codePointAt(0)!] ?? m.fallback;
    if (prev) units += m.kern[prev + ch] ?? 0;
    prev = ch;
    n++;
  }
  return (units * size * (face === 'mono' ? 1 : textScale)) / font.unitsPerEm + n * tracking;
}

/** Cut text to fit a width, ending in an ellipsis. */
export function fitText(text: string, size: number, weight: Weight, width: number, face: Face = 'sans', tracking = 0): string {
  if (measureText(text, size, weight, face, tracking) <= width) return text;
  const chars = [...text];
  while (chars.length > 1 && measureText(chars.join('') + '…', size, weight, face, tracking) > width) chars.pop();
  return chars.join('').trimEnd() + '…';
}

/** Distance from the vertical centre of a line box to the baseline, for centring text. */
export function baselineOffset(size: number, face: Face = 'sans'): number {
  const font = face === 'mono' ? (mono ?? sans) : sans;
  return ((font.capHeight / font.unitsPerEm) * size) / 2;
}
