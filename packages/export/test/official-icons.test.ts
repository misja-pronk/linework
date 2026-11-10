// Official icons (BYO packs) reach the slides as the vendor's own pictures, and the sketch look keeps its typeface.
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { render } from '@cartography/engine';
import { themes } from '@cartography/theme';
import { toPptx } from '../src/index.ts';

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

  it('in the sketch look name its handwriting face', async () => {
    const r = await render(shop.replace('icons: official\n', ''), { fonts: 'none', theme: 'sketch' });
    const files = unzipSync(await toPptx(r, { theme: themes.sketch }));
    expect(strFromU8(files['ppt/slides/slide1.xml']!)).toContain('typeface="Kalam"');
  });
});
