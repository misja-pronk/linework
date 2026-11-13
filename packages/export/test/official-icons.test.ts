// Official icons (BYO packs) reach the slides as the vendor's own pictures, and the sketch look keeps its typeface.
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { render } from '@cartography/engine';
import { themes } from '@cartography/theme';
import fs from 'node:fs';
import { fontFiles } from '@cartography/theme/node';
import { toPdf, toPptx } from '../src/index.ts';

const vendor = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><rect width="18" height="18" fill="#0A7"/></svg>';
const shop = `type: azure
icons: official
nodes:
  kv: { kind: key-vault, label: Secrets }
  app: { kind: app-service, label: Shop }
edges:
  - app -> kv
`;

describe('slides', () => {
  it('carry official icons as they are', async () => {
    const r = await render(shop, { fonts: 'none', iconPacks: { azure: { 'key-vault': vendor } } });
    expect(r.images?.nodes?.size).toBe(1);
    const files = unzipSync(await toPptx(r));
    const media = Object.keys(files).filter((f) => f.startsWith('ppt/media/') && f.endsWith('.svg')).map((f) => strFromU8(files[f]!));
    expect(media).toContain(vendor);
    expect(strFromU8(files['ppt/slides/slide1.xml']!)).toContain('name="Icon Official icon"');
  });

  it('PDF pages draw them as vectors, dimmed where a step stands them back', async () => {
    const gradient = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><defs><linearGradient id="a"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><rect width="18" height="18" fill="url(#a)"/></svg>';
    const r = await render(shop + 'steps:\n  - { show: [app] }\n  - { show: [app, kv], focus: [kv] }\n', { fonts: 'none', iconPacks: { azure: { 'key-vault': gradient, 'app-service': gradient } } });
    const [a, b, c] = fontFiles.map((u) => fs.readFileSync(decodeURIComponent(u.pathname)));
    const pdf = Buffer.from(await toPdf(r, { fonts: { 400: a!, 500: b!, 600: c! }, compress: false, steps: true })).toString('latin1');
    // The vendor's gradient arrives as a PDF shading; nothing is left as an image it could not open.
    expect(pdf).toMatch(/\/ShadingType/);
    expect(pdf).not.toMatch(/\/Subtype \/Image/);
  });

  it('in the sketch look name a face every machine has for its handwriting (Kalam is on few)', async () => {
    const r = await render(shop.replace('icons: official\n', ''), { fonts: 'none', theme: 'sketch' });
    const files = unzipSync(await toPptx(r, { theme: themes.sketch }));
    expect(strFromU8(files['ppt/slides/slide1.xml']!)).toContain('typeface="Arial"');
    expect(strFromU8(await toPptx(r, { theme: themes.sketch, font: 'Kalam' }).then((d) => unzipSync(d)['ppt/slides/slide1.xml']!))).toContain('typeface="Kalam"');
  });
});
