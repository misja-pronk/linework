export * from './tokens.ts';
export * from './measure.ts';
export { embeddedFonts } from './generated/fonts.ts';

/** TTF files of the embedded weights, for renderers that cannot read woff2 (resvg). Node only. */
export const fontFiles = ['Inter-Regular.ttf', 'Inter-Medium.ttf', 'Inter-SemiBold.ttf'].map(
  (f) => new URL(`../fonts/${f}`, import.meta.url),
);
