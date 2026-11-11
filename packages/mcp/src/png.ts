// PNG without a browser, as the CLI's png.ts makes it (the same bundled fonts, so the same pixels).
// Its own copy so the MCP server does not depend on the CLI: the CLI starts it for carto serve.
import { Resvg } from '@resvg/resvg-js';
import { allFontFiles } from '@cartography/theme/node';

export function toPng(svg: string, scale: number): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: scale },
    font: { fontFiles: allFontFiles.map((u) => decodeURIComponent(u.pathname)), loadSystemFonts: false, defaultFontFamily: 'Inter' },
  });
  return resvg.render().asPng();
}
