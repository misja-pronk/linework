// Alt text on what leaves as a document: the drawing as a tagged Div with alt text in a PDF, a described group on a slide.
import fs from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { render } from '@cartography/engine';
import { fontFiles } from '@cartography/theme/node';
import { toPdf, toPptx, type FontBytes } from '../src/index.ts';

const example = (f: string) => fs.readFileSync(new URL(`../../../examples/${f}`, import.meta.url), 'utf8');
const fonts = (): FontBytes => {
  const [a, b, c] = fontFiles.map((u) => fs.readFileSync(decodeURIComponent(u.pathname)));
  return { 400: a!, 500: b!, 600: c! };
};

describe('alt text in documents', () => {
  it('pdf: tagged, the drawing a Div (not a Figure, whose words Preview cannot find) with its description as Alt, frame and footer artifacts', async () => {
    const r = await render(example('systems/web-shop.yaml'), { fonts: 'none' });
    const pdf = Buffer.from(await toPdf(r, { fonts: fonts(), compress: false })).toString('latin1');
    expect(pdf).toContain('/Marked true');
    expect(pdf).toContain('/S /Div');
    expect(pdf).not.toContain('/S /Figure');
    expect(pdf).toMatch(/\/Alt \(Web shop\. Architecture diagram: How an order flows through the system\./);
    expect(pdf).toContain('/Artifact');
    expect(pdf).toContain('/Lang (en)');
  });

  it('pptx: the drawing is one group whose descr says what it shows; a step slide says its step', async () => {
    const r = await render(example('systems/invoice-walkthrough.yaml'), { fonts: 'none' });
    const files = unzipSync(await toPptx(r));
    const first = strFromU8(files['ppt/slides/slide1.xml']!);
    expect(first).toMatch(/<p:grpSp><p:nvGrpSpPr><p:cNvPr id="\d+" name="Diagram: Checkout without waiting" descr="Checkout without waiting, step 1 of 7: Checkout today: A customer orders/);
    const one = unzipSync(await toPptx({ ...r, steps: undefined }));
    expect(strFromU8(one['ppt/slides/slide1.xml']!)).toContain('descr="Checkout without waiting. Architecture diagram: Proposal for the steering group.');
  });
});
