// carto render and carto deck into a PowerPoint template: --template, --layout, --keep-look,
// --keep-slides, and a brand theme file that names its template (pptx: template.potx).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { corporateTemplate, deckParts, dutchTemplate } from '../../export/test/fixtures/templates.ts';
import { carto as inProcess } from './support/carto.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-template-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const carto = (...args: string[]) => inProcess(tmp, args);
const write = (name: string, data: string | Uint8Array) => {
  fs.mkdirSync(path.dirname(path.join(tmp, name)), { recursive: true });
  fs.writeFileSync(path.join(tmp, name), data);
};
const deck = (name: string) => deckParts(fs.readFileSync(path.join(tmp, name)));

const shop = `type: systems
title: Shop
subtitle: The order path
nodes:
  web: { kind: client, label: Web }
  api: { kind: service, label: API }
  db: { kind: database, label: Orders }
edges:
  - web -> api: REST
  - api -> db
`;

write('corporate.potx', corporateTemplate());
write('brand/polder.pptx', dutchTemplate());
write('shop.yaml', shop);

describe('carto render -o x.pptx --template', () => {
  it('makes the deck in the template: its layout, master and size, the sample slides gone, warnings said', async () => {
    const r = await carto('render', 'shop.yaml', '-o', 'shop.pptx', '--template', 'corporate.potx');
    expect(r.code).toBe(0);
    expect(r.err).toContain('accent6 #E7E9EE is too close to the slide background');
    const d = deck('shop.pptx');
    expect(d.text('[Content_Types].xml')).toContain('presentation.main+xml');
    expect(d.text('[Content_Types].xml')).not.toContain('template.main+xml');
    expect(d.text('ppt/slides/_rels/slide1.xml.rels')).toContain('slideLayout5.xml');
    expect(d.text('ppt/slides/slide1.xml')).toContain('<p:ph type="title"/>');
    expect(d.text('ppt/slides/slide1.xml')).toContain('typeface="Arial"');
    expect(Object.keys(d.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))).toHaveLength(1);
  }, 60000);

  it('--layout by name, --keep-look, --keep-slides', async () => {
    expect((await carto('render', 'shop.yaml', '-o', 'content.pptx', '--template', 'corporate.potx', '--layout', 'Title and Content', '--keep-look', '--keep-slides')).code).toBe(0);
    const d = deck('content.pptx');
    expect(Object.keys(d.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))).toHaveLength(3);
    expect(d.text('ppt/slides/_rels/slide3.xml.rels')).toContain('slideLayout2.xml');
    expect(d.text('ppt/slides/slide3.xml')).toContain('typeface="Courier New"');
  }, 60000);

  it('says which layouts there are when the one asked for is not there, and what a template is', async () => {
    const r = await carto('render', 'shop.yaml', '-o', 'x.pptx', '--template', 'corporate.potx', '--layout', 'Comparison');
    expect(r.code).toBe(1);
    expect(r.err).toContain('The template has no layout "Comparison"');
    expect(r.err).toContain('"Title Only"');
    write('not-a-deck.potx', 'hello');
    expect((await carto('render', 'shop.yaml', '-o', 'x.pptx', '--template', 'not-a-deck.potx')).err).toContain('Not a PowerPoint file');
    expect((await carto('render', 'shop.yaml', '-o', 'x.pptx', '--template', 'shop.yaml')).err).toContain('--template is a PowerPoint template');
    expect((await carto('render', 'shop.yaml', '-o', 'x.pptx', '--layout', 'Blank')).err).toContain('go with --template');
  }, 60000);

  it('carto deck: every diagram in the template, a title slide on its Title Slide layout', async () => {
    write('two.yaml', shop.replace('title: Shop', 'title: Second'));
    const r = await carto('deck', 'shop.yaml', 'two.yaml', '-o', 'deck.pptx', '--template', 'brand/polder.pptx', '--title', 'Architectuur');
    expect(r.code).toBe(0);
    const d = deck('deck.pptx');
    expect(d.text('ppt/presentation.xml')).toContain('<p:sldSz cx="9144000" cy="6858000"');
    expect(d.text('ppt/slides/_rels/slide1.xml.rels')).toContain('slideLayout1.xml');
    expect(d.text('ppt/slides/slide1.xml')).toContain('<a:t>Architectuur</a:t>');
    expect(d.text('ppt/slides/_rels/slide2.xml.rels')).toContain('slideLayout5.xml');
    expect(d.text('ppt/slides/slide3.xml')).toContain('<a:t>Second</a:t>');
  }, 60000);

  it('a brand theme file that names its template: every deck of a diagram in that theme is made in it', async () => {
    write('brand/polder.theme.yaml', 'name: polder\nextends: light\ncolors:\n  primary: "#E06C00"\npptx:\n  template: polder.pptx\n  layout: Titel en object\n');
    write('themed.yaml', shop.replace('type: systems', 'type: systems\ntheme: brand/polder.theme.yaml'));
    const r = await carto('render', 'themed.yaml', '-o', 'themed.pptx');
    expect(r.code).toBe(0);
    const d = deck('themed.pptx');
    expect(d.text('ppt/slides/_rels/slide1.xml.rels')).toContain('slideLayout2.xml');
    expect(d.text('ppt/slides/slide1.xml')).toContain('typeface="Verdana"');
    // --template wins over the theme's.
    expect((await carto('render', 'themed.yaml', '-o', 'other.pptx', '--template', 'corporate.potx')).code).toBe(0);
    expect(deck('other.pptx').text('ppt/presentation.xml')).toContain('<p:sldSz cx="12192000"');
    // SVG and PDF are not affected.
    expect((await carto('render', 'themed.yaml', '-o', 'themed.svg')).code).toBe(0);
  }, 60000);
});
