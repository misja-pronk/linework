import { Resvg } from '@resvg/resvg-js';
import { fontFiles } from '@cartography/theme/node';

/** PNG without a browser; fonts come from the bundled TTFs (plus a brand theme's) so the result is the same on every machine. */
export function toPng(svg: string, scale: number, extraFonts: string[] = []): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: scale },
    font: { fontFiles: [...extraFonts, ...fontFiles.map((u) => decodeURIComponent(u.pathname))], loadSystemFonts: false, defaultFontFamily: 'Inter' },
  });
  return resvg.render().asPng();
}
