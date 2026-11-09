// Node only: the TTF files of the embedded weights, for renderers that cannot read woff2 (resvg).
// Kept out of the main entry so the web app does not bundle them.
export const fontFiles = ['Inter-Regular.ttf', 'Inter-Medium.ttf', 'Inter-SemiBold.ttf'].map((f) => new URL(`../fonts/${f}`, import.meta.url));
