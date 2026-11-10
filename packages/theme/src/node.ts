// Node only: the TTF files of the embedded weights, for renderers that cannot read woff2 (resvg, PDF).
// Kept out of the main entry so the web app does not bundle them.
const file = (f: string) => new URL(`../fonts/${f}`, import.meta.url);

/** Inter, the fallback face: regular, medium, semibold. */
export const fontFiles = ['Inter-Regular.ttf', 'Inter-Medium.ttf', 'Inter-SemiBold.ttf'].map(file);

const WEIGHT = { 400: 'Regular', 500: 'Medium', 600: 'SemiBold' } as const;
const FILES: Record<string, [string, (400 | 500 | 600)[]]> = {
  Inter: ['Inter', [400, 500, 600]],
  'Instrument Sans': ['InstrumentSans', [400, 500, 600]],
  'Geist Mono': ['GeistMono', [400, 500]],
  Barlow: ['Barlow', [400, 500, 600]],
  'IBM Plex Sans': ['IBMPlexSans', [400, 500, 600]],
  'IBM Plex Mono': ['IBMPlexMono', [400, 500]],
};

/** The TTF files of every bundled family, by family name and weight. */
export const bundledFontFiles: Record<string, Partial<Record<400 | 500 | 600, URL>>> = Object.fromEntries(
  Object.entries(FILES).map(([family, [prefix, weights]]) => [family, Object.fromEntries(weights.map((w) => [w, file(`${prefix}-${WEIGHT[w]}.ttf`)]))]),
);

/** Every bundled TTF, for a renderer that picks faces by family name itself. */
export const allFontFiles: URL[] = Object.values(bundledFontFiles).flatMap((w) => Object.values(w));
