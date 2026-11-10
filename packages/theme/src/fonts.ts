// The font families Cartography ships with: their metrics (so text is measured the same everywhere,
// each face by its own advance widths) and the woff2 data embedded in exported SVGs.
// Inter, Instrument Sans and Geist Mono are always there; Barlow, IBM Plex and Kalam load on first use.
import { embeddedFonts } from './generated/fonts.ts';
import metrics from './generated/metrics.json' with { type: 'json' };
import { font as instrumentSans } from './generated/font-instrument-sans.ts';
import { font as geistMono } from './generated/font-geist-mono.ts';

export interface WeightMetrics {
  /** Advance per code point, in font units. */
  adv: Record<string, number>;
  /** Kerning per ASCII pair. */
  kern: Record<string, number>;
  /** Advance for a character the table does not hold. */
  fallback: number;
}

export interface BundledFont {
  family: string;
  mono: boolean;
  unitsPerEm: number;
  capHeight: number;
  /** Metrics per weight (400, 500 and, for the sans families, 600). */
  weights: Record<string, WeightMetrics>;
  /** woff2 per weight as base64, for @font-face in SVG. */
  woff2: Record<string, string>;
}

const inter: BundledFont = {
  family: 'Inter',
  mono: false,
  unitsPerEm: metrics.unitsPerEm,
  capHeight: metrics.capHeight,
  weights: metrics.weights as unknown as Record<string, WeightMetrics>,
  woff2: Object.fromEntries(Object.entries(embeddedFonts)),
};

const loaded = new Map<string, BundledFont>([inter, instrumentSans, geistMono].map((f) => [f.family, f]));

const optional: Record<string, () => Promise<{ font: BundledFont }>> = {
  Barlow: () => import('./generated/font-barlow.ts'),
  'IBM Plex Sans': () => import('./generated/font-ibm-plex-sans.ts'),
  'IBM Plex Mono': () => import('./generated/font-ibm-plex-mono.ts'),
  Kalam: () => import('./generated/font-kalam.ts'),
};

/** Every family that can be named in a theme without shipping font files. */
export const bundledFamilies = [...loaded.keys(), ...Object.keys(optional)];

/** The bundled family by name, whatever the case; undefined for anything else. */
export const bundledFamily = (name: string | undefined) => (name ? bundledFamilies.find((f) => f.toLowerCase() === name.trim().toLowerCase()) : undefined);

/** A bundled font that is in memory: the always-there ones, and the optional ones after loadFonts. */
export const bundledFont = (family: string | undefined): BundledFont | undefined => (family ? loaded.get(family) : undefined);

/** Brings the optional families in; a render awaits this before it measures or draws. */
export async function loadFonts(families: (string | undefined)[]): Promise<void> {
  for (const f of families) {
    if (!f || loaded.has(f) || !optional[f]) continue;
    try {
      loaded.set(f, (await optional[f]!()).font);
    } catch {
      // The face is a file of its own in some builds and that file may not be there: the text is then
      // measured by the default table and drawn in the family's fallback.
    }
  }
}

/** Monospace faces are all 0.6 em wide per character, near enough, when no table is at hand. */
export const MONO_ADVANCE = 0.6;
