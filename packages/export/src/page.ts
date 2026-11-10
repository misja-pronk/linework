// A drawing on a page of a given shape (a slide, an A4 sheet): the SVG's canvas widened (or
// heightened) to the page's proportions, the drawing centred on it. For PNG and SVG exports that
// go straight onto a slide or into a document without cropping or stretching.

/** The SVG with its canvas grown to `aspect` (width / height), the drawing centred; as it was when it already has that shape. */
export function svgOnPage(svg: string, width: number, height: number, aspect: number, fill: string): { svg: string; width: number; height: number } {
  const w = Math.max(width, Math.round(height * aspect));
  const h = Math.max(height, Math.round(width / aspect));
  if (w === width && h === height) return { svg, width, height };
  const dx = (w - width) / 2;
  const dy = (h - height) / 2;
  const open = /<svg\b[^>]*>/.exec(svg);
  if (!open) return { svg, width, height };
  const head = open[0]
    .replace(/\swidth="[^"]*"/, ` width="${w}"`)
    .replace(/\sheight="[^"]*"/, ` height="${h}"`)
    .replace(/\sviewBox="[^"]*"/, ` viewBox="${-dx} ${-dy} ${w} ${h}"`);
  // The page's own ground first, under the drawing's.
  const ground = `<rect x="${-dx}" y="${-dy}" width="${w}" height="${h}" fill="${fill}"/>`;
  return { svg: head + ground + svg.slice(open.index + open[0].length), width: w, height: h };
}
