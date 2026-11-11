import { describe as group, expect, it } from 'vitest';
import { accessibleSvg, altText, describe, pngWithText, toHtml, toMarkdown, toText, type Description } from '../src/index.ts';

const d: Description = {
  title: 'Shop *beta*',
  summary: 'Architecture diagram: How an order flows. 3 elements, with 2 connections.',
  sections: [
    { heading: 'Elements', items: [{ text: 'Web shop (System)', items: [{ text: 'Storefront (Web app)' }] }, { text: '1. Not a list' }] },
    { heading: 'Walkthrough', ordered: true, items: [{ text: 'The order comes in.', items: [{ text: 'Storefront: note' }] }, { text: 'It is paid.' }] },
  ],
};

group('writing a description', () => {
  it('as plain text, indented', () => {
    expect(toText(d)).toBe(
      'Shop *beta*\n\nArchitecture diagram: How an order flows. 3 elements, with 2 connections.\n\nElements\n- Web shop (System)\n  - Storefront (Web app)\n- 1. Not a list\n\nWalkthrough\n1. The order comes in.\n  - Storefront: note\n2. It is paid.\n',
    );
  });

  it('as Markdown that keeps labels as labels and nests under numbers', () => {
    const md = toMarkdown(d, { level: 2 });
    expect(md).toContain('## Shop \\*beta\\*');
    expect(md).toContain('### Elements');
    expect(md).toContain('- 1\\. Not a list');
    expect(md).toContain('1. The order comes in.\n   - Storefront: note\n2. It is paid.');
  });

  it('as HTML of headings and lists only', () => {
    const html = toHtml(d, { title: false, level: 3 });
    expect(html).not.toContain('<h3>');
    expect(html).toContain('<h4>Walkthrough</h4>');
    expect(html).toContain('<ol><li>The order comes in.<ul><li>Storefront: note</li></ul></li><li>It is paid.</li></ol>');
  });

  it('as alt text in whole sentences under the limit', () => {
    expect(altText(d, 100)).toBe('Shop *beta*. Architecture diagram: How an order flows. 3 elements, with 2 connections.');
    expect(altText(d, 400)).toContain('Storefront (Web app).');
  });

  it('describes a drawing with nothing in it without failing', () => {
    expect(describe({}).summary).toBe('Diagram. It is empty.');
  });
});

group('the words inside files', () => {
  it('SVG: a title and desc the root names, ids its own', () => {
    const svg = accessibleSvg('<svg xmlns="http://www.w3.org/2000/svg" width="10"><rect/></svg>', { title: 'A & B', desc: 'Two <boxes>', id: 'x y' });
    expect(svg).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="10" role="img" aria-labelledby="x-y-title" aria-describedby="x-y-desc"><title id="x-y-title">A &amp; B</title><desc id="x-y-desc">Two &lt;boxes&gt;</desc><rect/></svg>');
    expect(accessibleSvg(svg, { title: 'again' })).toBe(svg);
    expect(accessibleSvg('<svg><rect/></svg>', { title: 'Winkel', lang: 'nl' })).toBe('<svg role="img" aria-labelledby="carto-title" lang="nl" xml:lang="nl"><title id="carto-title">Winkel</title><rect/></svg>');
  });

  it('PNG: Title and Description chunks after the header, with valid checksums', () => {
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
    const out = pngWithText(png, { title: 'Shop', description: 'Café → API' });
    const text = Buffer.from(out).toString('latin1');
    expect(text.indexOf('iTXtTitle')).toBe(37);
    expect(Buffer.from(out).toString('utf8')).toContain('Description\0\0\0\0\0Café → API');
    // Every chunk's CRC checks out.
    let at = 8;
    const crc = (b: Uint8Array) => {
      let c = 0xffffffff;
      for (const x of b) {
        c ^= x;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      return (c ^ 0xffffffff) >>> 0;
    };
    const view = new DataView(out.buffer);
    while (at < out.length) {
      const len = view.getUint32(at);
      expect(view.getUint32(at + 8 + len)).toBe(crc(out.subarray(at + 4, at + 8 + len)));
      at += 12 + len;
    }
    expect(at).toBe(out.length);
    expect(pngWithText(new Uint8Array([1, 2, 3]), { title: 'x' })).toEqual(new Uint8Array([1, 2, 3]));
  });
});
