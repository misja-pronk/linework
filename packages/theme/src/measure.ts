// Text width from precomputed Inter metrics (scripts/fonts.mjs), so Node and the browser
// measure exactly the same and the CLI output equals the web output (requirement E2).
import metrics from './generated/metrics.json' with { type: 'json' };

export type Weight = 400 | 500 | 600;

interface WeightMetrics {
  adv: Record<string, number>;
  kern: Record<string, number>;
  fallback: number;
}

const table = metrics.weights as unknown as Record<string, WeightMetrics>;
const upm = metrics.unitsPerEm;

// A brand font is measured as Inter times its width ratio. Set around the synchronous measure and draw
// steps only (withTextScale), so concurrent renders with other themes never see it.
let textScale = 1;

export function withTextScale<T>(scale: number | undefined, fn: () => T): T {
  const before = textScale;
  textScale = scale ?? 1;
  try {
    return fn();
  } finally {
    textScale = before;
  }
}

/** Width of a sample in Inter, to compare a brand font against: scale = brand width / this. */
export const SCALE_SAMPLE = 'Orders API · Customer database 0123456789 Key Vault';

export function measureText(text: string, size: number, weight: Weight = 400): number {
  const m = table[weight] ?? table[400]!;
  let units = 0;
  let prev = '';
  for (const ch of text) {
    units += m.adv[ch.codePointAt(0)!] ?? m.fallback;
    if (prev) units += m.kern[prev + ch] ?? 0;
    prev = ch;
  }
  return (units * size * textScale) / upm;
}

/** Cut text to fit a width, ending in an ellipsis. */
export function fitText(text: string, size: number, weight: Weight, width: number): string {
  if (measureText(text, size, weight) <= width) return text;
  const chars = [...text];
  while (chars.length > 1 && measureText(chars.join('') + '…', size, weight) > width) chars.pop();
  return chars.join('').trimEnd() + '…';
}

/** Distance from the vertical centre of a line box to the baseline, for centring text. */
export function baselineOffset(size: number): number {
  return ((metrics.capHeight / upm) * size) / 2;
}
