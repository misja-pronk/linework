// Class diagrams and mind maps on a slide: members as text that can be edited, UML ends as shapes.
import fs from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { render } from '@cartography/engine';
import { toPptx } from '../src/index.ts';

const example = (f: string) => fs.readFileSync(new URL(`../../../examples/${f}`, import.meta.url), 'utf8');
const slide = async (f: string) => {
  const r = await render(example(f), { fonts: 'none' });
  return strFromU8(unzipSync(await toPptx(r))['ppt/slides/slide1.xml']!);
};

describe('class diagrams and mind maps on a slide', () => {
  it('a class diagram: boxes, members with their visibility, compartments and UML ends', async () => {
    const xml = await slide('class/domain-model.yaml');
    for (const word of ['Item', '«abstract»', 'loanPeriod()', 'MAX_LOANS', 'Visibility', 'Damaged']) expect(xml).toContain(word);
    // The hollow triangle and the filled diamond: preset shapes named End, turned along the line (Quick Look leaves out a freeform).
    expect(xml.match(/name="End"/g)!.length).toBeGreaterThanOrEqual(3);
    expect(xml).toMatch(/name="End"\/>[^]*?prst="triangle"/);
    expect(xml).toMatch(/name="End"\/>[^]*?prst="diamond"/);
    expect(xml).not.toContain('<a:custGeom>');
  });
  it('an abstract name in italics, a static member underlined, as the drawing marks them', async () => {
    const xml = await slide('class/domain-model.yaml');
    const props = (word: string) => new RegExp(`<a:rPr ([^>]*)>(?:(?!</a:rPr>).)*</a:rPr><a:t>${word}</a:t>`).exec(xml)?.[1] ?? '';
    expect(props('Item')).toContain('i="1"');
    expect(props('loanPeriod\\(\\)')).toContain('i="1"');
    expect(props('MAX_LOANS')).toContain('u="sng"');
    expect(props('Member')).not.toMatch(/ i=| u=/);
  });

  it("the key's samples carry the ends they stand for: a class's triangle and diamond, an entity's bars and crow's foot", async () => {
    const key = (xml: string) => xml.slice(xml.indexOf('name="Legend"'));
    const uml = key(await slide('class/domain-model.yaml'));
    expect(uml).toMatch(/name="End"\/>[^]*?prst="triangle"/);
    expect(uml).toMatch(/name="End"\/>[^]*?prst="diamond"/);
    expect(uml.match(/name="End"/g)!.length).toBe(3);
    const erd = key(await slide('erd/orders.yaml'));
    // Exactly one: two bars; zero or many: a crow's foot and a ring.
    expect(erd.match(/name="End"/g)!.length).toBeGreaterThanOrEqual(3);
    expect(erd).toMatch(/name="End"\/>[^]*?prst="ellipse"/);
  });

  it('a mind map: every topic a shape with its words', async () => {
    const xml = await slide('mindmap/capability-brainstorm.yaml');
    for (const word of ['Data platform', 'Ingest', 'Feature store', '+3']) expect(xml).toContain(word);
  });
});
