import { Resvg } from '@resvg/resvg-js';
import { fontFiles } from '@cartography/theme/node';

/** PNG without a browser; fonts come from the bundled TTFs so the result is the same on every machine. */
export function toPng(svg: string, scale: number): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: scale },
    font: { fontFiles: fontFiles.map((u) => decodeURIComponent(u.pathname)), loadSystemFonts: false, defaultFontFamily: 'Inter' },
  });
  return resvg.render().asPng();
}
