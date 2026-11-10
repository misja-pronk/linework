// icons: official | lucide, the --icons override, and packs the editor keeps in the browser.
import { describe, expect, it } from 'vitest';
import { iconKinds, render, vendorKinds } from '../src/index.ts';

const svg = (c: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><rect width="18" height="18" fill="${c}"/></svg>`;
const shop = (icons = '') => `type: azure
${icons}
nodes:
  kv: { kind: key-vault, label: Secrets }
  app: { kind: app-service, label: Shop }
edges:
  - app -> kv
`;
const azure = { azure: { 'key-vault': svg('#111'), 'app-service': svg('#222') } };
const images = (s: string | undefined) => (s?.match(/<image /g) ?? []).length;

describe('official icons', () => {
  it('icons: official draws the imported set of the diagram type', async () => {
    const r = await render(shop('icons: official'), { fonts: 'none', iconPacks: azure });
    expect(r.diagnostics).toEqual([]);
    expect(images(r.svg)).toBe(2);
    expect(r.svg).toContain('data:image/svg+xml;base64,');
  });

  it('icons: lucide keeps the line icons, whatever packs are around', async () => {
    const r = await render(shop('icons: lucide'), { fonts: 'none', iconPacks: azure, packs: ['azure'] });
    expect(images(r.svg)).toBe(0);
    expect(r.diagnostics).toEqual([]);
  });

  it('the override wins over the diagram', async () => {
    expect(images((await render(shop('icons: official'), { fonts: 'none', iconPacks: azure, iconsOverride: 'lucide' })).svg)).toBe(0);
    expect(images((await render(shop(), { fonts: 'none', iconPacks: azure, iconsOverride: 'official' })).svg)).toBe(2);
    // Without either, a diagram draws as written: packs in the browser are not used by themselves.
    expect(images((await render(shop(), { fonts: 'none', iconPacks: azure })).svg)).toBe(0);
  });

  it('says how to get the set when it is not imported', async () => {
    const cli = await render(shop('icons: official'), { fonts: 'none', pack: () => undefined });
    expect(cli.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining('carto icons import')]);
    const web = await render(shop('icons: official'), { fonts: 'none', iconPacks: {} });
    expect(web.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining('Official icons')]);
  });

  it('a cloud diagram uses each shape’s own vendor, and the first vendor for the kinds every vendor has', async () => {
    const text = `type: cloud
nodes:
  people: { kind: users, label: Customers }
  fn: { kind: lambda, label: Orders }
  bq: { kind: bigquery, label: Warehouse }
edges:
  - people -> fn
  - fn -> bq
`;
    const packs = { aws: { users: svg('#A00'), lambda: svg('#A01') }, gcp: { users: svg('#B00'), bigquery: svg('#B01') } };
    const r = await render(text, { fonts: 'none', iconPacks: packs, iconsOverride: 'official', interactive: true });
    expect(r.diagnostics).toEqual([]);
    const href = (id: string) => /href="data:image\/svg\+xml;base64,([^"]+)"/.exec(new RegExp(`data-node="${id}".*?</g>`).exec(r.svg!)![0])?.[1];
    expect(atob(href('people')!)).toContain('#A00');
    expect(atob(href('fn')!)).toContain('#A01');
    expect(atob(href('bq')!)).toContain('#B01');
    // Only Google's set there: no warning about AWS when no shape is AWS's.
    const onlyGcp = await render(text.replace(/  fn:.*\n/, '').replace('  - people -> fn\n  - fn -> bq\n', '  - people -> bq\n'), { fonts: 'none', iconPacks: { gcp: packs.gcp }, iconsOverride: 'official' });
    expect(onlyGcp.diagnostics).toEqual([]);
  });

  it('matches a vendor pack against its own kinds and the general ones', () => {
    const aws = iconKinds('aws').map((k) => k.kind);
    expect(aws).toContain('lambda');
    expect(aws).not.toContain('bigquery');
    const cover = vendorKinds('kubernetes').map((k) => k.kind);
    expect(cover).toContain('deployment');
    expect(vendorKinds('aws').map((k) => k.kind)).not.toContain('key-vault');
  });
});
