import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchIcons, nameTokens } from '@cartography/icons';
import { themes } from '@cartography/theme';
import { render } from '../src/index.ts';

const acmeDir = path.resolve(import.meta.dirname, '../../../docs/themes/acme');
const acme = {
  load: (f: string) => fs.readFileSync(path.resolve(acmeDir, f), 'utf8'),
  assets: (f: string) => new Uint8Array(fs.readFileSync(path.resolve(acmeDir, f))),
};

const small = (extra: string) => `type: azure
${extra}
nodes:
  kv: { kind: key-vault, label: Secrets }
  app: { kind: app-service, label: Shop }
edges:
  - app -> kv
`;

describe('brand themes in diagrams', () => {
  it('takes theme: without bothering the type schema', async () => {
    const r = await render(small('theme: slate'), { fonts: 'none' });
    expect(r.diagnostics).toEqual([]);
    expect(r.theme).toBe(themes.slate);
    expect(r.svg).toContain(`fill="${themes.slate!.canvas}"`);
  });

  it('lets an override win over the diagram', async () => {
    const r = await render(small('theme: slate'), { fonts: 'none', themeOverride: 'mono' });
    expect(r.theme).toBe(themes.mono);
  });

  it('points theme problems at the theme key', async () => {
    const r = await render(small('theme: { colors: { primary: nope } }'), { fonts: 'none' });
    expect(r.diagnostics).toMatchObject([{ severity: 'warning', line: 2 }]);
  });

  it('embeds the brand font and the logo in the SVG', async () => {
    const r = await render(fs.readFileSync(path.join(acmeDir, 'platform.yaml'), 'utf8'), { ...acme, fontScale: () => 1.05 });
    expect(r.diagnostics).toEqual([]);
    expect(r.svg).toMatch(/@font-face\{font-family:'Space Grotesk';font-style:normal;font-weight:600;src:url\(data:font\/woff2;base64,/);
    expect(r.svg).toContain(`font-family="'Space Grotesk', Inter`);
    expect(r.svg).toMatch(/<image href="data:image\/svg\+xml;base64,[^"]+" x="40" y="[\d.]+" width="[\d.]+" height="32"/);
    expect(r.svg).toContain('Acme Corporation');
    expect(r.svg).toContain('v1.3  ·  2026-11-09');
    expect(r.svg).toContain('>CONFIDENTIAL<');
  });

  it('measures with the brand font width, so wider fonts get wider cards', async () => {
    const text = fs.readFileSync(path.join(acmeDir, 'platform.yaml'), 'utf8');
    const narrow = await render(text, { ...acme, fonts: 'none', fontScale: () => 1 });
    const wide = await render(text, { ...acme, fonts: 'none', fontScale: () => 1.25 });
    expect(wide.width!).toBeGreaterThan(narrow.width!);
  });
});

describe('icon packs', () => {
  const azure = [
    'Azure_Public_Service_Icons/Icons/security/10245-icon-service-Key-Vaults.svg',
    'Azure_Public_Service_Icons/Icons/app services/10035-icon-service-App-Services.svg',
    'Azure_Public_Service_Icons/Icons/networking/10061-icon-service-Virtual-Networks.svg',
    'Azure_Public_Service_Icons/Icons/containers/10023-icon-service-Kubernetes-Services.svg',
    'Azure_Public_Service_Icons/Icons/databases/10130-icon-service-SQL-Database.svg',
    'Azure_Public_Service_Icons/Icons/databases/10131-icon-service-SQL-Server.svg',
    'Azure_Public_Service_Icons/Icons/storage/10086-icon-service-Storage-Accounts.svg',
  ];

  it('reads the words of vendor file names', () => {
    expect(nameTokens(azure[0]!)).toEqual(['key', 'vault']);
    expect(nameTokens('Arch_Amazon-Simple-Storage-Service_64.svg')).toEqual(['simple', 'storage', 'service']);
  });

  it('maps official file names to our kinds', () => {
    const kinds = ['key-vault', 'app-service', 'vnet', 'aks', 'sql-database', 'sql-server', 'storage', 'redis'].map((kind) => ({ kind }));
    const m = matchIcons(azure, kinds, 'azure');
    expect(m).toEqual({
      'key-vault': azure[0],
      'app-service': azure[1],
      vnet: azure[2],
      aks: azure[3],
      'sql-database': azure[4],
      'sql-server': azure[5],
      storage: azure[6],
    });
  });

  it('prefers the 64px AWS service icon', () => {
    const files = ['Arch_Storage/16/Arch_Amazon-Simple-Storage-Service_16.svg', 'Arch_Storage/64/Arch_Amazon-Simple-Storage-Service_64.svg', 'Res_Storage/Res_Amazon-Simple-Storage-Service_Bucket_48.svg'];
    expect(matchIcons(files, [{ kind: 'storage', label: 'Object storage' }], 'aws')).toEqual({ storage: files[1] });
  });

  it('draws mapped icons as-is on a neutral tile', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><path fill="#0078D4" d="M0 0h18v18H0z"/></svg>';
    const r = await render(small('icons: { key-vault: ./kv.svg }'), { fonts: 'none', load: (f) => (f === './kv.svg' ? svg : '') });
    expect(r.diagnostics).toEqual([]);
    const href = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    expect(r.svg!.split(href).length - 1).toBe(1);
    // Survey sets icons bare: the vendor's picture stands on the card itself, a little larger, with no tile behind it.
    expect(r.svg).toMatch(/<image href="[^"]+" x="\d+" y="\d+" width="28" height="28"/);
    expect(r.svg).not.toContain('fill="#F3F5F8"');
    // Never recoloured: the vendor colour stays inside the untouched file only.
    expect(r.svg).not.toContain('#0078D4');
    // A look with tiles (classic) puts it on a neutral one, so a coloured mark never sits on a coloured wash.
    const classic = await render(small('icons: { key-vault: ./kv.svg }'), { fonts: 'none', theme: 'classic', load: (f) => (f === './kv.svg' ? svg : '') });
    expect(classic.svg).toContain('fill="#F3F5F8"');
    expect(classic.svg).toMatch(/<image href="[^"]+" x="\d+" y="\d+" width="24" height="24"/);
  });

  it('uses packs from the caller and warns about unknown ones', async () => {
    const pack = { name: 'azure', root: '/packs/azure', icons: { 'app-service': 'web/App-Services.svg' } };
    const read: string[] = [];
    const r = await render(small('icons: { pack: [azure, aws] }'), {
      fonts: 'none',
      load: (f) => (read.push(f), '<svg viewBox="0 0 1 1"/>'),
      pack: (n) => (n === 'azure' ? pack : undefined),
    });
    expect(read).toEqual(['/packs/azure/web/App-Services.svg']);
    expect(r.diagnostics.map((d) => d.message)).toEqual([expect.stringMatching(/No icon pack "aws"/)]);
    expect(r.svg).toContain('<image href="data:image/svg+xml');
  });
});
