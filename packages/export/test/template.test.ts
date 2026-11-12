import fs from 'node:fs';
import { strFromU8, unzipSync, zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { render, textPtAt, type RenderResult } from '@cartography/engine';
import { contrast } from '@cartography/theme';
import { chooseLayout, fitSlide, readTemplate, templateTheme, toPptx, type SlideText } from '../src/index.ts';
import { planSlide } from '../src/template/place.ts';
import { relsOf } from '../src/template/read.ts';
import { child, children, find, findAll, parseXml, type XmlNode } from '../src/template/xml.ts';
import { corporateTemplate, dutchTemplate } from './fixtures/templates.ts';
import { deckToSvg } from './support/slide-svg.ts';

const example = (f: string) => fs.readFileSync(new URL(`../../../examples/${f}`, import.meta.url), 'utf8');
const draw = async (f: string): Promise<RenderResult> => render(example(f), { fonts: 'none', load: (rel) => example(`${f.split('/')[0]}/${rel}`) });
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
const corporate = corporateTemplate();
const dutch = dutchTemplate();

function parts(zip: Uint8Array) {
  const files = unzipSync(zip);
  const text = (p: string) => strFromU8(files[p]!);
  return { files, text, xml: (p: string) => parseXml(text(p)) };
}

/** What PowerPoint checks before it opens a file, done by hand: XML, relationships, content types, ids. */
function valid(zip: Uint8Array) {
  const { files, text, xml } = parts(zip);
  const types = parseXml(text('[Content_Types].xml'));
  const defaults = new Set(findAll(types, 'Default').map((d) => d.attrs.Extension!.toLowerCase()));
  const overrides = new Map(findAll(types, 'Override').map((o) => [o.attrs.PartName!.slice(1), o.attrs.ContentType!]));
  for (const [path, data] of Object.entries(files)) {
    if (path.endsWith('.xml') || path.endsWith('.rels')) expect(() => parseXml(strFromU8(data)), path).not.toThrow();
    if (path === '[Content_Types].xml') continue;
    expect(overrides.has(path) || defaults.has(path.split('.').pop()!.toLowerCase()), `content type of ${path}`).toBe(true);
  }
  for (const part of overrides.keys()) expect(files[part], `override for a part that is not there: ${part}`).toBeDefined();
  // Every relationship resolves; every r:id a part uses is one of its relationships.
  for (const rel of Object.keys(files).filter((p) => p.endsWith('.rels'))) {
    const part = rel === '_rels/.rels' ? '' : rel.replace(/_rels\/([^/]+)\.rels$/, '$1');
    if (part) expect(files[part], `relationships of a part that is not there: ${rel}`).toBeDefined();
    const list = relsOf(files, part);
    expect(new Set(list.map((r) => r.id)).size, `${rel}: ids are unique`).toBe(list.length);
    for (const r of list) if (r.part) expect(files[r.part], `${rel} → ${r.target}`).toBeDefined();
    if (part && part.endsWith('.xml')) for (const [, id] of text(part).matchAll(/r:(?:embed|id|link)="([^"]+)"/g)) expect(list.map((r) => r.id), `${part} uses ${id}`).toContain(id);
  }
  const main = relsOf(files, '').find((r) => r.type.endsWith('/officeDocument'))!.part!;
  expect(overrides.get(main)).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml');
  // Slide ids unique and in range; shape ids unique per slide.
  const pres = parseXml(text(main));
  const ids = findAll(pres, 'p:sldId').map((s) => Number(s.attrs.id));
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) expect(id >= 256 && id < 2147483648).toBe(true);
  for (const s of Object.keys(files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))) {
    const shapeIds = findAll(parseXml(text(s)), 'p:cNvPr').map((c) => c.attrs.id);
    expect(new Set(shapeIds).size, `${s}: shape ids`).toBe(shapeIds.length);
  }
  // Schema order of the presentation's lists.
  const order = child(pres, 'p:presentation')!.children.map((c) => c.name);
  const want = ['p:sldMasterIdLst', 'p:notesMasterIdLst', 'p:handoutMasterIdLst', 'p:sldIdLst', 'p:sldSz', 'p:notesSz'].filter((n) => order.includes(n));
  expect(order.filter((n) => want.includes(n))).toEqual(want);
  return { files, text, xml, pres, main };
}

/** Every frame inside the diagram group of a slide, in EMU. */
function diagramFrames(slide: XmlNode) {
  const g = findAll(slide, 'p:grpSp').find((x) => child(x, 'p:nvGrpSpPr/p:cNvPr')?.attrs.name?.startsWith('Diagram: '))!;
  return g.children.filter((c) => c.name !== 'p:grpSpPr').flatMap((c) => findAll(c, 'a:off')).map((off) => ({ x: Number(off.attrs.x), y: Number(off.attrs.y) }));
}

describe('reading a template', () => {
  it('reads size, theme colours and fonts, masters, layouts and their placeholders', () => {
    const t = readTemplate(corporate);
    expect([t.width, t.height]).toEqual([12192000, 6858000]);
    expect(t.colors.accent1).toBe('#1F5FAD');
    expect(t.colors.dk1).toBe('#1B1B1F');
    expect(t.fonts).toEqual({ major: 'Georgia', minor: 'Arial' });
    expect(t.isTemplate).toBe(true);
    expect(t.layouts.map((l) => l.name)).toEqual(['Title Slide', 'Title and Content', 'Section Header', 'Two Content', 'Title Only', 'Blank']);
    expect(t.slides).toHaveLength(2);
    expect(t.notesMaster).toEqual({ path: 'ppt/notesMasters/notesMaster1.xml', bodyIdx: 3 });
    // The master's title bar, footer rule and logo are what a diagram keeps clear of.
    expect(t.masters[0]!.decorations.map((d) => d.name)).toEqual(['Title bar', 'Footer rule', 'Logo']);
    expect(t.masters[0]!.hf).toEqual({ sldNum: true, ftr: true, dt: false });
    // A layout placeholder without a frame of its own sits where the master's does.
    const titleOnly = t.layouts.find((l) => l.name === 'Title Only')!;
    expect(titleOnly.placeholders.find((p) => p.type === 'title')!.frame).toEqual(t.masters[0]!.placeholders.find((p) => p.type === 'title')!.frame);

    const d = readTemplate(dutch);
    expect([d.width, d.height]).toEqual([9144000, 6858000]);
    expect(d.isTemplate).toBe(false);
    expect(d.fonts.minor).toBe('Verdana');
    expect(d.masters[0]!.background).toEqual({ color: '#FBF8F2' });
    expect(d.notesMaster).toBeUndefined();
  });

  it('chooses Title Only by type or by its name in another language, and takes a layout by name', () => {
    const t = readTemplate(corporate);
    expect(chooseLayout(t, 'diagram').name).toBe('Title Only');
    expect(chooseLayout(t, 'title').name).toBe('Title Slide');
    expect(chooseLayout(t, 'diagram', 'title and content').name).toBe('Title and Content');
    expect(chooseLayout(t, 'diagram', 'Blank').name).toBe('Blank');
    expect(() => chooseLayout(t, 'diagram', 'Comparison')).toThrow(/no layout "Comparison".*"Title Only"/);
    // The Dutch layouts have no types, only names.
    const d = readTemplate(dutch);
    expect(d.layouts.every((l) => !l.type)).toBe(true);
    expect(chooseLayout(d, 'diagram').name).toBe('Alleen titel');
    expect(chooseLayout(d, 'title').name).toBe('Titeldia');
    expect(chooseLayout(d, 'diagram', 'Titel en object').name).toBe('Titel en object');
    expect(chooseLayout(d, 'diagram', 'bijschrift').name).toBe('Afbeelding met bijschrift');
  });

  it('says what is wrong with a file that is not a template', () => {
    expect(() => readTemplate(new Uint8Array([1, 2, 3]))).toThrow(/not a zip/);
    const word = zipSync({ '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'), 'word/document.xml': strToU8('<w:document xmlns:w="x"/>') });
    expect(() => readTemplate(word)).toThrow(/not a presentation/);
  });

  it('plans the slide: under the title, inside the master text area, clear of the logo and above the footers', () => {
    const t = readTemplate(corporate);
    const m = t.masters[0]!;
    const plan = planSlide(t, chooseLayout(t, 'diagram'));
    const title = plan.title!.frame!;
    const body = m.placeholders.find((p) => p.type === 'body')!.frame!;
    expect(plan.area.y).toBeGreaterThan(title.y + title.h);
    expect(plan.area.x).toBeGreaterThanOrEqual(body.x);
    expect(plan.area.x + plan.area.w).toBeLessThanOrEqual(body.x + body.w);
    for (const d of m.decorations.filter((x) => x.name !== 'Title bar')) expect(plan.area.y + plan.area.h <= d.y || plan.area.y >= d.y + d.h).toBe(true);
    expect(plan.footers.map((f) => f.type)).toEqual(['ftr', 'sldNum']);
    // Title and Content: the content placeholder is the room.
    const content = planSlide(t, chooseLayout(t, 'diagram', 'Title and Content'));
    expect(content.content?.idx).toBe(1);
    // A picture layout: the picture placeholder, and the caption under it for the step's words.
    const d = readTemplate(dutch);
    const pic = planSlide(d, chooseLayout(d, 'diagram', 'Afbeelding met bijschrift'));
    expect(pic.content?.type).toBe('pic');
    expect(pic.caption?.idx).toBe(2);
  });
});

describe('the template as a theme', () => {
  it('draws in the accents, text in tx1, on the slide background, in the body face', () => {
    const t = readTemplate(corporate);
    const made = templateTheme(t, chooseLayout(t, 'diagram'));
    expect(made.tones).toMatchObject({ blue: 'accent1', teal: 'accent2' });
    // Red goes where red means something; the near-white accent cannot be drawn with and is left out, said.
    expect(made.tones.rose).toBe('accent5');
    expect(Object.values(made.tones)).not.toContain('accent6');
    expect(made.warnings.join('\n')).toMatch(/accent6 #E7E9EE is too close to the slide background/);
    expect(made.theme.canvas).toBe('#FFFFFF');
    expect(made.theme.font.family).toContain('Arial');
    expect(made.theme.font.monoFor).toEqual([]);
    // Everything drawn with reads on the page.
    for (const tone of Object.values(made.theme.tones)) expect(contrast(tone.fg, made.theme.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(made.theme.text, made.theme.canvas)).toBeGreaterThanOrEqual(4.5);

    // A layout on a dark ground gives a dark theme, its text in the scheme colour that reads there.
    const dark = templateTheme(t, chooseLayout(t, 'diagram', 'Title Slide')).theme;
    expect(dark.mode).toBe('dark');
    expect(dark.canvas).toBe('#0B2545');
    expect(contrast(dark.text, dark.canvas)).toBeGreaterThanOrEqual(4.5);

    const d = readTemplate(dutch);
    const nl = templateTheme(d, chooseLayout(d, 'diagram'));
    expect(nl.theme.canvas).toBe('#FBF8F2');
    expect(nl.tones.blue).toBe('accent1');
    // The yellow is too light for the warm page; the grey accent is the neutral tone.
    expect(Object.values(nl.tones)).not.toContain('accent3');
    expect(nl.tones.slate).toBe('accent4');
  });
});

describe('writing into a template', () => {
  it('a valid deck: the template\'s masters, layouts and theme, its sample slides gone, diagrams on Title Only', async () => {
    const list = await Promise.all(['systems/web-shop.yaml', 'erd/orders.yaml'].map(draw));
    const warnings: string[] = [];
    const zip = await toPptx(list, { template: corporate, title: 'Platform', subtitle: 'Q4', rasterize: () => PNG, onWarning: (w) => warnings.push(w) });
    const { files, text, pres } = valid(zip);
    expect(warnings.some((w) => w.includes('accent6'))).toBe(true);
    // The template's parts are there as they were.
    const t = readTemplate(corporate);
    for (const l of t.layouts) expect(text(l.path)).toBe(strFromU8(t.files[l.path]!));
    expect(text('ppt/theme/theme1.xml')).toBe(strFromU8(t.files['ppt/theme/theme1.xml']!));
    expect(files['ppt/media/image1.png']).toBeDefined();
    // Sample slides, the picture only they used, their notes, their sections and the thumbnail are gone.
    const all = Object.keys(files).map((p) => (p.endsWith('.xml') ? text(p) : '')).join('');
    expect(all).not.toContain('Delete this sample slide');
    expect(all).not.toContain('Quarterly review');
    expect(files['ppt/media/image2.png']).toBeUndefined();
    expect(files['docProps/thumbnail.jpeg']).toBeUndefined();
    expect(text('ppt/presentation.xml')).not.toContain('sectionLst');
    expect(text('ppt/presentation.xml')).not.toContain('custShow');
    expect(findAll(pres, 'p:sldId')).toHaveLength(3);
    expect(text('ppt/presentation.xml')).toContain('<p:sldSz cx="12192000" cy="6858000"/>');
    // The title slide uses Title Slide, the diagrams Title Only.
    expect(text('ppt/slides/_rels/slide1.xml.rels')).toContain('Target="../slideLayouts/slideLayout1.xml"');
    expect(text('ppt/slides/_rels/slide2.xml.rels')).toContain('Target="../slideLayouts/slideLayout5.xml"');
    // Speaker notes on the template's notes master, in its body placeholder.
    expect(text('ppt/notesSlides/notesSlide2.xml')).toContain('Web shop');
    expect(text('ppt/notesSlides/notesSlide2.xml')).toContain('<p:ph type="body" idx="3"/>');
    expect(text('ppt/notesSlides/_rels/notesSlide2.xml.rels')).toContain('../notesMasters/notesMaster1.xml');
    // Icons are named apart from the template's own media.
    expect(Object.keys(files).some((p) => /^ppt\/media\/cartography-icon\d+\.svg$/.test(p))).toBe(true);
  });

  it('fills the placeholders: the title with no formatting of its own, footer and slide number from the layout', async () => {
    const zip = await toPptx(await draw('systems/web-shop.yaml'), { template: corporate, title: 'Platform', subtitle: 'Q4' });
    const { xml } = parts(zip);
    const cover = xml('ppt/slides/slide1.xml');
    const phs = (s: XmlNode) => findAll(s, 'p:ph').map((p) => p.attrs.type ?? 'obj');
    expect(phs(cover)).toEqual(['ctrTitle', 'subTitle']);
    const slide = xml('ppt/slides/slide2.xml');
    expect(phs(slide)).toEqual(['title', 'ftr', 'sldNum']);
    const title = findAll(slide, 'p:sp').find((s) => find(s, 'p:ph')?.attrs.type === 'title')!;
    // Position, face, size and colour are the template's.
    expect(child(title, 'p:spPr')!.children).toHaveLength(0);
    expect(find(title, 'a:rPr')!.attrs.sz).toBeUndefined();
    expect(find(title, 'a:t')!.text).toBe('Web shop');
    expect(find(findAll(slide, 'p:sp').find((s) => find(s, 'p:ph')?.attrs.type === 'sldNum')!, 'a:fld')!.attrs.type).toBe('slidenum');
    // The diagram is in the template's body face, and inside the room the plan gave it.
    const t = readTemplate(corporate);
    const plan = planSlide(t, chooseLayout(t, 'diagram'));
    expect(parts(zip).text('ppt/slides/slide2.xml')).toContain('typeface="Arial"');
    for (const p of diagramFrames(slide)) {
      expect(p.x).toBeGreaterThanOrEqual(plan.area.x - 1);
      expect(p.y).toBeGreaterThanOrEqual(plan.area.y - 1);
      expect(p.x).toBeLessThanOrEqual(plan.area.x + plan.area.w + 1);
      expect(p.y).toBeLessThanOrEqual(plan.area.y + plan.area.h + 1);
    }
  });

  it('keeps our look when asked: our faces, our tones, the template\'s title', async () => {
    const r = await draw('systems/web-shop.yaml');
    const slide = parts(await toPptx(r, { template: corporate, keepLook: true })).text('ppt/slides/slide1.xml');
    expect(slide).toContain('typeface="Instrument Sans"');
    expect(slide).toContain('typeface="Geist Mono"');
    expect(slide).toContain('<p:ph type="title"/>');
  });

  it('a 4:3 template with Dutch layout names: Alleen titel, a notes master added, the stripe and logo kept clear of', async () => {
    const zip = await toPptx(await Promise.all(['systems/web-shop.yaml', 'systems/invoice-walkthrough.yaml'].map(draw)), { template: dutch });
    const { files, text } = valid(zip);
    expect(text('ppt/presentation.xml')).toContain('<p:sldSz cx="9144000" cy="6858000"');
    expect(text('ppt/slides/_rels/slide1.xml.rels')).toContain('slideLayout5.xml');
    // No notes master in the template: one is added, listed right after the slide masters.
    expect(text('ppt/presentation.xml')).toMatch(/<\/p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId\d+"\/><\/p:notesMasterIdLst>/);
    expect(Object.keys(files)).toContain('ppt/notesMasters/notesMaster1.xml');
    expect(text('ppt/slides/slide1.xml')).toContain('typeface="Verdana"');
    expect(text('ppt/slides/slide1.xml')).toContain('Polder Advies — vertrouwelijk');
    // A walkthrough: a slide per step, its caption under the drawing.
    expect(Object.keys(files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).length).toBeGreaterThan(2);
    expect(text('ppt/slides/slide3.xml')).toContain('name="Step caption"');
  });

  it('puts the step caption in the layout\'s caption placeholder when it has one', async () => {
    const zip = await toPptx(await draw('systems/invoice-walkthrough.yaml'), { template: dutch, layout: 'Afbeelding met bijschrift' });
    const { text, xml } = valid(zip);
    const slide = xml('ppt/slides/slide2.xml');
    const caption = findAll(slide, 'p:sp').find((s) => find(s, 'p:ph')?.attrs.idx === '2')!;
    expect(caption).toBeDefined();
    expect(find(caption, 'a:buNone')).toBeDefined();
    expect(text('ppt/slides/slide2.xml')).not.toContain('name="Step caption"');
  });

  it('keeps the template\'s own slides in front when asked, sections and all', async () => {
    const zip = await toPptx(await draw('systems/web-shop.yaml'), { template: corporate, keepSlides: true });
    const { text, pres } = valid(zip);
    expect(findAll(pres, 'p:sldId')).toHaveLength(3);
    expect(text('ppt/slides/slide1.xml')).toContain('Quarterly review');
    expect(text('ppt/slides/slide3.xml')).toContain('Web shop');
    // The new slide joins the last section: every slide is in one.
    const ids = findAll(pres, 'p:sldId').map((s) => s.attrs.id);
    const inSections = findAll(pres, 'p14:sldId').map((s) => s.attrs.id);
    expect(inSections.sort()).toEqual(ids.sort());
  });

  it('draws as a slide of the template: background, title bar and logo of the master under the diagram', async () => {
    const zip = await toPptx(await draw('systems/web-shop.yaml'), { template: corporate });
    const svg = deckToSvg(zip).slides[0]!;
    expect(svg).toContain('fill="#0B2545"');
    expect(svg).toContain('>Web shop</tspan>');
    expect(svg).toContain('Exemplar Group · Internal');
    expect(svg).toContain('data:image/png;base64,');
  });

  it('tells the smallest text as the template\'s room makes it: the drawing fills that room', async () => {
    const r = await draw('network/hybrid-cloud.yaml');
    const inTemplate: SlideText[] = [];
    const ours: SlideText[] = [];
    await toPptx(r, { template: corporate, steps: false, onSlide: (s) => inTemplate.push(s) });
    await toPptx(r, { steps: false, onSlide: (s) => ours.push(s) });
    // The title bar and the footers leave the drawing less room than our own slide: said so, by the same measure.
    expect(inTemplate[0]!.scale).toBeLessThan(ours[0]!.scale);
    expect(inTemplate[0]!.smallestPt).toBe(textPtAt(r.svg!, inTemplate[0]!.scale));
    // Fitted into the room the plan gives (under the subtitle), as high or as wide as it is.
    const t = readTemplate(corporate);
    const plan = planSlide(t, chooseLayout(t, 'diagram'));
    const fit = await fitSlide(r.graph!, r.placed!, templateTheme(t, chooseLayout(t, 'diagram')).theme, { W: t.width, H: t.height, room: plan.area, template: true, titlePlaceholder: !!plan.title, captionPlaceholder: !!plan.caption });
    expect(fit.k / 12700).toBeCloseTo(inTemplate[0]!.scale, 6);
    const used = Math.max((fit.content.width * fit.k) / fit.area.w, (fit.content.height * fit.k) / fit.area.h);
    expect(used).toBeCloseTo(1, 3);
  });

  it('leaves the deck without a template as it was', async () => {
    const zip = await toPptx(await draw('systems/web-shop.yaml'));
    const { files } = valid(zip);
    expect(Object.keys(files)).toContain('ppt/slideLayouts/slideLayout1.xml');
    expect(children(child(parseXml(strFromU8(files['ppt/presentation.xml']!)), 'p:presentation/p:sldIdLst'), 'p:sldId')).toHaveLength(1);
  });
});
