import fs from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { render, type RenderResult } from '@cartography/engine';
import { themes } from '@cartography/theme';
import { bundledFontFiles, fontFiles } from '@cartography/theme/node';
import { pdfFamilies, toPdf, toPptx, type FamilyBytes, type FontBytes } from '../src/index.ts';
import { clean, fitConnector } from '../src/slide.ts';

const example = (f: string) => fs.readFileSync(new URL(`../../../examples/${f}`, import.meta.url), 'utf8');
const draw = async (f: string, theme?: string): Promise<RenderResult> => render(example(f), { fonts: 'none', theme, load: (rel) => example(`${f.split('/')[0]}/${rel}`) });
/** The theme's own faces, read the way the CLI does. */
const families = (theme: (typeof themes)[string]): FamilyBytes =>
  Object.fromEntries(pdfFamilies(theme).map((f) => [f, Object.fromEntries(Object.entries(bundledFontFiles[f]!).map(([w, u]) => [w, fs.readFileSync(decodeURIComponent(u.pathname))]))]));
const fonts = (): FontBytes => {
  const [a, b, c] = fontFiles.map((u) => fs.readFileSync(decodeURIComponent(u.pathname)));
  return { 400: a!, 500: b!, 600: c! };
};
// A 1×1 PNG stands in for the icon rasteriser.
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));

/** Every element closed in order: enough to catch broken XML without a parser. */
function wellFormed(xml: string): boolean {
  const stack: string[] = [];
  for (const m of xml.replace(/<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([\w:.-]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (!m[1]) stack.push(m[2]!);
    else if (stack.pop() !== m[2]) return false;
  }
  return stack.length === 0;
}

function parts(zip: Uint8Array) {
  const files = unzipSync(zip);
  const text = (p: string) => strFromU8(files[p]!);
  return { files, text };
}

describe('pptx', () => {
  it('writes a valid package: content types, relationships, well-formed parts', async () => {
    const r = await draw('systems/web-shop.yaml');
    const { files, text } = parts(await toPptx(r, { rasterize: () => PNG }));
    const types = text('[Content_Types].xml');
    for (const [path, data] of Object.entries(files)) {
      if (path.endsWith('.xml') || path.endsWith('.rels')) expect(wellFormed(strFromU8(data)), path).toBe(true);
      // Every XML part has a content type, every media part a default for its extension.
      if (path.endsWith('.xml') && path !== '[Content_Types].xml') expect(types, path).toContain(`PartName="/${path}"`);
    }
    expect(types).toContain('Extension="png"');
    expect(types).toContain('Extension="svg"');
    // Every relationship points at a part that exists.
    for (const rel of Object.keys(files).filter((p) => p.endsWith('.rels'))) {
      const dir = rel.replace(/_rels\/[^/]*\.rels$/, '');
      for (const [, target] of text(rel).matchAll(/Target="([^"]+)"/g)) {
        const resolved = new URL(target!, `file:///${dir}`).pathname.slice(1);
        expect(files[resolved], `${rel} → ${target}`).toBeDefined();
      }
    }
    // The rIds a slide uses are all declared in its relationships.
    const slide = text('ppt/slides/slide1.xml');
    const rels = text('ppt/slides/_rels/slide1.xml.rels');
    for (const [, id] of slide.matchAll(/r:embed="(rId\d+)"/g)) expect(rels).toContain(`Id="${id}"`);
  });

  it('draws native shapes: a frame per card and group, a line per edge, all text', async () => {
    const r = await draw('systems/web-shop.yaml');
    const g = r.graph!;
    const slide = parts(await toPptx(r)).text('ppt/slides/slide1.xml');
    const named = (prefix: string) => [...slide.matchAll(new RegExp(`<p:cNvPr id="\\d+" name="${prefix}`, 'g'))].length;
    expect(named('Group: ')).toBeGreaterThanOrEqual(g.groups.length);
    expect(named('Card: ')).toBe(g.nodes.length);
    expect(named('Line: ')).toBe(g.edges.length);
    // Simple paths are real connectors, bound to the cards they join.
    expect(slide).toContain('<p:cxnSp>');
    expect(slide).toMatch(/<a:stCxn id="\d+" idx="\d"\/>/);
    expect(slide).toContain('<a:tailEnd type="triangle"');
    expect(slide).toContain('<a:prstDash val="dash"/>');
    const texts = [...slide.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    for (const n of g.nodes) if (n.shape.kind === 'card') expect(texts).toContain(n.shape.label);
    for (const e of g.edges) if (e.label) expect(texts).toContain(e.label);
    expect(texts).toContain(g.title);
    for (const l of g.legend ?? []) expect(texts).toContain(l.label);
    // Pictures for icons, cards with rounded corners.
    expect(slide).toContain('<p:pic>');
    expect(slide).toContain('prst="roundRect"');
  });

  it('follows the look: Survey by default, the theme\'s faces, tints, tiles, labels and arrowheads', async () => {
    const survey = parts(await toPptx(await Promise.all(['systems/web-shop.yaml', 'erd/orders.yaml'].map((f) => draw(f)))));
    const slide = survey.text('ppt/slides/slide1.xml');
    const t = themes.survey!;
    // Text in the theme's own face, with a sans named as the substitute's shape; type columns in the monospace face.
    expect(slide).toContain('<a:latin typeface="Instrument Sans" panose="020B0604020202020204" pitchFamily="34"');
    expect(survey.text('ppt/slides/slide2.xml')).toContain('<a:latin typeface="Geist Mono" panose="020B0609020204030204" pitchFamily="49"');
    // Groups lie on the paper tints, with their names in spaced capitals; flat cards, no tile behind the icons.
    expect(slide.toUpperCase()).toContain(`<A:SRGBCLR VAL="${t.group!.tints![0]!.slice(1).toUpperCase()}"/>`);
    expect(slide).toMatch(/spc="\d+"/);
    expect(slide).not.toContain('<a:outerShdw');
    expect(slide).not.toContain('name="Tile"');
    // The legend is a KEY under a rule.
    expect(slide).toContain('<a:t>KEY</a:t>');

    // Classic keeps its soft shadow, tinted tiles and Inter.
    const classic = parts(await toPptx(await draw('systems/web-shop.yaml', 'classic'), { theme: themes.classic })).text('ppt/slides/slide1.xml');
    expect(classic).toContain('<a:outerShdw');
    expect(classic).toContain('name="Tile"');
    expect(classic).toContain('typeface="Inter"');
    expect(classic).not.toContain('<a:t>KEY</a:t>');

    // Transit: slim arrowheads, roundels, labels in capitals. Drafting: open arrowheads.
    const transit = parts(await toPptx(await draw('systems/web-shop.yaml', 'transit'), { theme: themes.transit })).text('ppt/slides/slide1.xml');
    expect(transit).toContain('<a:tailEnd type="triangle" w="med" len="lg"/>');
    expect(transit).toContain('typeface="Barlow"');
    expect(transit).toContain('<a:t>ORDERPLACED</a:t>');
    const drafting = parts(await toPptx(await draw('systems/web-shop.yaml', 'drafting'), { theme: themes.drafting })).text('ppt/slides/slide1.xml');
    expect(drafting).toContain('<a:tailEnd type="arrow"');
    expect(drafting).toContain('typeface="IBM Plex Mono"');
    // A font of your own choosing wins.
    expect(parts(await toPptx(await draw('systems/web-shop.yaml'), { font: 'Arial' })).text('ppt/slides/slide1.xml')).toContain('typeface="Arial"');
  });

  it('one slide per diagram, a title slide on request, notes, 4:3', async () => {
    const list = await Promise.all(['systems/web-shop.yaml', 'erd/orders.yaml', 'access/engineering-access.yaml'].map((f) => draw(f)));
    const { files, text } = parts(await toPptx(list, { title: 'Architecture', subtitle: 'Q4', aspect: '4:3' }));
    const slides = Object.keys(files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p));
    expect(slides).toHaveLength(4);
    expect(text('ppt/presentation.xml').match(/<p:sldId /g)).toHaveLength(4);
    expect(text('ppt/presentation.xml')).toContain('<p:sldSz cx="9144000" cy="6858000"/>');
    expect(text('ppt/slides/slide1.xml')).toContain('<a:t>Architecture</a:t>');
    expect(text('ppt/notesSlides/notesSlide2.xml')).toContain('Web shop');
    expect(text('ppt/notesSlides/notesSlide2.xml')).toContain('How an order flows through the system');
    // ERD rows and matrix cells come through as text.
    expect(text('ppt/slides/slide3.xml')).toContain('<a:t>customer_id</a:t>');
    expect(text('ppt/slides/slide4.xml')).toContain('<a:t>Contributor</a:t>');
  });
});

describe('connectors', () => {
  const P = (x: number, y: number) => ({ x, y });
  it('fits straight lines and elbows with one to three bends, any direction', () => {
    expect(fitConnector([P(0, 0), P(100, 0)], 1)?.prst).toBe('straightConnector1');
    expect(fitConnector([P(100, 50), P(0, 0)], 1)?.frame).toMatchObject({ flipH: true, flipV: true });
    expect(fitConnector([P(0, 0), P(100, 0), P(100, 80)], 1)?.prst).toBe('bentConnector2');
    expect(fitConnector([P(0, 0), P(0, 80), P(100, 80)], 1)?.prst).toBe('bentConnector2');
    const z = fitConnector([P(0, 0), P(40, 0), P(40, 80), P(100, 80)], 1)!;
    expect(z).toMatchObject({ prst: 'bentConnector3', frame: { rot: 0 } });
    expect(z.adj![0]).toBeCloseTo(40000);
    // Down, across, down: the same elbow turned a quarter.
    expect(fitConnector([P(0, 0), P(0, 30), P(100, 30), P(100, 80)], 1)?.frame.rot).toBeOneOf([90, 270]);
    expect(fitConnector([P(0, 0), P(20, 0), P(20, 50), P(80, 50), P(80, 100)], 1)?.prst).toBe('bentConnector4');
    expect(fitConnector([P(0, 0), P(10, 0), P(10, 10), P(20, 10), P(20, 20), P(30, 20)], 1)).toBeUndefined();
    expect(fitConnector([P(0, 0), P(10, 5), P(20, 0)], 1)).toBeUndefined();
  });

  it('drops repeated and in-line points first', () => {
    expect(clean([P(0, 0), P(0, 0), P(5, 0), P(10, 0), P(10, 10)])).toEqual([P(0, 0), P(10, 0), P(10, 10)]);
  });
});

/** Text a PDF shows, read through each font's ToUnicode map (uncompressed PDFs only). */
function pdfText(pdf: string): string[] {
  const objects = new Map([...pdf.matchAll(/(\d+) 0 obj([\s\S]*?)endobj/g)].map((m) => [m[1]!, m[2]!]));
  const cmap = (id: string) => {
    const map = new Map<string, string>();
    // PDFKit writes ranges with a list: <0000> <00ff> [<0020> <0057> <0066 0069> …].
    for (const [, lo, dst] of (objects.get(id) ?? '').matchAll(/<([0-9a-f]+)>\s*<[0-9a-f]+>\s*\[([^\]]*)\]/gi)) {
      const list = [...dst!.matchAll(/<([0-9a-f ]+)>/gi)].map((x) => String.fromCodePoint(...x[1]!.split(' ').map((h) => parseInt(h, 16))));
      for (const [k, s] of list.entries()) map.set((parseInt(lo!, 16) + k).toString(16).padStart(4, '0'), s);
    }
    return map;
  };
  // Font resource name → ToUnicode map, through the font dictionaries.
  const fonts = new Map<string, Map<string, string>>();
  for (const body of objects.values())
    for (const [, name, ref] of body.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
      const font = objects.get(ref!) ?? '';
      const tu = font.match(/\/ToUnicode (\d+) 0 R/)?.[1];
      if (tu) fonts.set(name!, cmap(tu));
    }
  const out: string[] = [];
  for (const body of objects.values()) {
    if (!body.includes('stream')) continue;
    let map: Map<string, string> | undefined;
    for (const m of body.matchAll(/\/(F\d+) [\d.]+ Tf|\[([^\]]*)\] TJ|<([0-9a-f]+)> Tj/gi)) {
      if (m[1]) map = fonts.get(m[1]);
      const hex = m[2] ? [...m[2].matchAll(/<([0-9a-f]+)>/gi)].map((x) => x[1]!).join('') : (m[3] ?? '');
      if (hex && map) out.push(hex.match(/.{4}/g)!.map((g) => map!.get(g.toLowerCase()) ?? '').join(''));
    }
  }
  return out;
}

describe('pdf', () => {
  it('one page per diagram, the theme\'s faces embedded, text extractable', async () => {
    const list = await Promise.all(['systems/web-shop.yaml', 'erd/orders.yaml'].map((f) => draw(f)));
    const bytes = await toPdf(list, { fonts: fonts(), families: families(themes.survey!), compress: false, date: new Date('2026-11-09T12:00:00Z') });
    const pdf = Buffer.from(bytes).toString('latin1');
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(2);
    // Survey: Instrument Sans for the words, Geist Mono for line labels and column types; no Inter left.
    expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+InstrumentSans-SemiBold/);
    expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+GeistMono-/);
    expect(pdf).not.toMatch(/\/BaseFont \/[A-Z]{6}\+Inter-/);
    expect(pdf).toContain('/FontFile2');
    // svg-to-pdfkit places glyph by glyph, so the pieces join without spaces.
    const text = pdfText(pdf).join('');
    for (const s of ['Web shop', 'Storefront', 'OrderPlaced', 'customer_id', '2026-11-09']) expect(text).toContain(s);
  });

  it('classic stays in Inter, and a theme whose faces are not handed over falls back to it', async () => {
    const classic = Buffer.from(await toPdf(await draw('systems/web-shop.yaml', 'classic'), { theme: themes.classic, fonts: fonts(), compress: false })).toString('latin1');
    expect(classic).toMatch(/\/BaseFont \/[A-Z]{6}\+Inter-SemiBold/);
    expect(pdfFamilies(themes.classic!)).toEqual([]);
    expect(pdfFamilies(themes.survey!)).toEqual(['Instrument Sans', 'Geist Mono']);
    const bare = Buffer.from(await toPdf(await draw('systems/web-shop.yaml'), { fonts: fonts(), compress: false })).toString('latin1');
    expect(bare).toMatch(/\/BaseFont \/[A-Z]{6}\+Inter-SemiBold/);
    expect(pdfText(bare).join('')).toContain('OrderPlaced');
  });

  it('a4 and a3 are landscape sheets', async () => {
    const r = await draw('systems/web-shop.yaml');
    const pdf = Buffer.from(await toPdf(r, { fonts: fonts(), page: 'a3', compress: false })).toString('latin1');
    expect(pdf).toMatch(/\/MediaBox \[0 0 1190\.55 841\.89\]/);
  });
});

describe('steps', () => {
  /** Where each named card and group sits on a slide. */
  const frames = (slide: string) => new Map([...slide.matchAll(/<p:cNvPr id="\d+" name="((?:Card|Group): [^"]*)"[\s\S]*?<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/g)].map((m) => [m[1]!, m.slice(2, 6).join(' ')]));
  const slideCount = (zip: Uint8Array) => Object.keys(parts(zip).files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).length;

  it('pptx: a slide per step, every shape in the same place, the caption on the slide and in the notes', async () => {
    const r = await draw('systems/invoice-walkthrough.yaml');
    expect(r.steps).toHaveLength(7);
    const zip = await toPptx({ ...r, name: 'invoice-walkthrough.yaml' });
    const { text } = parts(zip);
    expect(slideCount(zip)).toBe(7);
    expect(text('ppt/presentation.xml').match(/<p:sldId /g)).toHaveLength(7);
    const last = frames(text('ppt/slides/slide7.xml'));
    expect(last.size).toBe(r.graph!.nodes.length + r.graph!.groups.length);
    for (let n = 1; n <= 7; n++) {
      const slide = text(`ppt/slides/slide${n}.xml`);
      const state = r.steps![n - 1]!;
      expect(wellFormed(slide), `slide ${n}`).toBe(true);
      // What a slide shows sits exactly where it sits on every other slide.
      const here = frames(slide);
      for (const [name, frame] of here) expect(frame, `${name} on slide ${n}`).toBe(last.get(name));
      expect(here.size, `slide ${n}`).toBe(last.size - Object.values({ ...state.nodes, ...state.groups }).filter((s) => s === 'hidden').length);
      expect(slide).toContain(`<a:t>${state.title}</a:t>`);
      expect(slide).toContain(`<a:t>${n} / 7</a:t>`);
      const notes = text(`ppt/notesSlides/notesSlide${n}.xml`);
      expect(notes).toContain(state.title!);
      expect(notes).toContain(state.caption!.slice(0, 40));
      expect(notes).toContain(`Step ${n} of 7`);
      // The steps of one drawing fade into each other; the first slide comes in as any other.
      expect(slide.includes('<p:fade/>'), `slide ${n}`).toBe(n > 1);
    }
    // What is not shown yet is not on the slide at all, and a callout is there for its step only.
    expect(text('ppt/slides/slide1.xml')).not.toContain('<a:t>order-events</a:t>');
    expect(text('ppt/slides/slide5.xml')).toContain('<a:t>order-events</a:t>');
    expect(text('ppt/slides/slide3.xml')).toContain('Maintenance 02:00 to 04:00');
    expect(text('ppt/slides/slide4.xml')).not.toContain('Maintenance 02:00 to 04:00');
  });

  it('pptx: one slide on request, one step on request, and steps nobody wrote only when asked for', async () => {
    const r = await draw('azure/web-shop.yaml');
    expect(slideCount(await toPptx(r))).toBe(r.steps!.length);
    expect(slideCount(await toPptx(r, { steps: false }))).toBe(1);
    expect(slideCount(await toPptx({ ...r, step: 2 }))).toBe(1);
    expect(slideCount(await toPptx([r, await draw('systems/web-shop.yaml')], { title: 'Both' }))).toBe(r.steps!.length + 2);
    expect(parts(await toPptx(r, { steps: false })).text('ppt/slides/slide1.xml')).not.toContain('name="Step caption"');
    const seq = await draw('sequence/checkout.yaml');
    expect(seq.stepsImplied).toBe(true);
    expect(slideCount(await toPptx(seq))).toBe(1);
    expect(slideCount(await toPptx(seq, { steps: true }))).toBe(seq.steps!.length);
  });

  it('pdf: a page per step with its place in the story, one page on request', async () => {
    const r = await draw('data-products/customer.yaml');
    const steps = r.steps!.length;
    expect(steps).toBeGreaterThan(2);
    const pdf = Buffer.from(await toPdf(r, { fonts: fonts(), compress: false })).toString('latin1');
    expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(steps);
    // Every page is the same size: the drawing does not move between steps.
    expect(new Set(pdf.match(/\/MediaBox \[[^\]]*\]/g)).size).toBe(1);
    const said = pdfText(pdf).join('');
    for (let n = 1; n <= steps; n++) expect(said).toContain(`${n} / ${steps}`);
    const one = Buffer.from(await toPdf(r, { fonts: fonts(), compress: false, steps: false })).toString('latin1');
    expect(one.match(/\/Type \/Page\b/g)).toHaveLength(1);
    expect(pdfText(one).join('')).not.toContain(`1 / ${steps}`);
  });
});

describe('journey', () => {
  const slideCount = (zip: Uint8Array) => Object.keys(parts(zip).files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).length;

  it('pptx: native shapes and text you can edit, the feeling curve a real curve', async () => {
    for (const view of ['map', 'storyboard', 'blueprint']) {
      const r = await render(example('journey/first-deploy.yaml'), { fonts: 'none', view });
      const zip = await toPptx(r, { rasterize: () => PNG });
      expect(slideCount(zip), view).toBe(1);
      const slide = parts(zip).text('ppt/slides/slide1.xml');
      expect(wellFormed(slide), view).toBe(true);
      const texts = [...slide.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]!).join(' ');
      const shape = r.graph!.nodes[0]!.shape as { steps: { label: string }[]; phases: { label: string }[] };
      for (const p of shape.phases) expect(texts, view).toContain(p.label.split(' ')[0]);
      for (const s of shape.steps) expect(texts, `${view}: ${s.label}`).toContain(s.label.split(' ')[0]);
      // The curve is a custom shape with bezier segments, not a picture.
      if (view === 'map') {
        expect(slide).toContain('<a:cubicBezTo>');
        expect(slide).toMatch(/<p:cNvPr id="\d+" name="Feeling/);
      }
      expect(slide, view).toContain('prst="ellipse"');
      expect(slide, view).not.toContain('NaN');
    }
  });

  it('pptx and pdf: a slide per step when asked for, the step in focus outlined', async () => {
    const r = await draw('journey/developer-onboarding.yaml');
    expect(r.stepsImplied).toBe(true);
    const n = r.steps!.length;
    expect(slideCount(await toPptx(r, { rasterize: () => PNG }))).toBe(1);
    const zip = await toPptx(r, { steps: true, rasterize: () => PNG });
    expect(slideCount(zip)).toBe(n);
    const { text } = parts(zip);
    for (let i = 1; i <= n; i++) {
      const slide = text(`ppt/slides/slide${i}.xml`);
      expect(wellFormed(slide), `slide ${i}`).toBe(true);
      expect(slide.match(/name="In focus"/g), `slide ${i}`).toHaveLength(1);
      expect(slide).toContain(`<a:t>${i} / ${n}</a:t>`);
    }
    const pdf = Buffer.from(await toPdf(r, { fonts: fonts(), compress: false, steps: true })).toString('latin1');
    expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(n);
    expect(new Set(pdf.match(/\/MediaBox \[[^\]]*\]/g)).size).toBe(1);
  });
});
