import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as fontkit from 'fontkit';
import { importIcons, readPack } from '../src/packs.ts';
import { readZip, writeZip } from '../src/zip.ts';
import { renameFamily, ttfFiles } from '../src/fonts.ts';
import { fontFiles } from '@cartography/theme/node';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-icons-'));
process.env.CARTO_CONFIG_DIR = path.join(tmp, 'config');
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Stand-ins with official-looking names; the real icons are never in the repo.
const svg = (c: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><rect width="18" height="18" fill="${c}"/></svg>`;

describe('carto icons import', () => {
  it('indexes a downloaded zip into the config dir', () => {
    const zip = path.join(tmp, 'Azure_Public_Service_Icons.zip');
    fs.writeFileSync(
      zip,
      writeZip({
        'Azure_Public_Service_Icons/Icons/security/10245-icon-service-Key-Vaults.svg': svg('#111'),
        'Azure_Public_Service_Icons/Icons/web/10035-icon-service-App-Services.svg': svg('#222'),
        'Azure_Public_Service_Icons/Icons/networking/10061-icon-service-Virtual-Networks.svg': svg('#333'),
        '__MACOSX/Azure_Public_Service_Icons/._x.svg': 'junk',
        'Azure_Public_Service_Icons/License.txt': 'terms',
      }),
    );
    expect(readZip(fs.readFileSync(zip)).map((e) => e.name)).toHaveLength(5);
    const r = importIcons(zip, 'azure');
    expect(r.files).toBe(3);
    expect(r.dir.startsWith(process.env.CARTO_CONFIG_DIR!)).toBe(true);
    const pack = readPack('azure')!;
    expect(pack.icons).toEqual({
      'key-vault': 'Azure_Public_Service_Icons/Icons/security/10245-icon-service-Key-Vaults.svg',
      'app-service': 'Azure_Public_Service_Icons/Icons/web/10035-icon-service-App-Services.svg',
      vnet: 'Azure_Public_Service_Icons/Icons/networking/10061-icon-service-Virtual-Networks.svg',
    });
    expect(fs.readFileSync(path.join(pack.root, pack.icons['key-vault']!), 'utf8')).toBe(svg('#111'));
    expect(r.unmatched).toContain('redis');
  });

  it('imports an unzipped folder too, replacing the old pack', () => {
    const dir = path.join(tmp, 'aws');
    fs.mkdirSync(path.join(dir, 'Arch_Storage/64'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Arch_Storage/64/Arch_Amazon-Simple-Storage-Service_64.svg'), svg('#444'));
    importIcons(dir, 'aws');
    expect(readPack('aws')!.icons.storage).toBe('Arch_Storage/64/Arch_Amazon-Simple-Storage-Service_64.svg');
    expect(() => importIcons(dir, '../evil')).toThrow(/short name/);
  });
});

describe('brand fonts for PNG', () => {
  it('renames the family inside the font so resvg finds it by the theme name', async () => {
    const inter = fs.readFileSync(decodeURIComponent(fontFiles[2]!.pathname));
    const renamed = fontkit.create(renameFamily(inter, 'Acme Sans')) as { familyName: string; 'OS/2': { usWeightClass: number } };
    expect(renamed.familyName).toBe('Acme Sans');
    expect(renamed['OS/2'].usWeightClass).toBe(600);
    const [file] = await ttfFiles([{ family: 'Acme Sans', weight: 600, style: 'normal', format: 'truetype', data: inter.toString('base64') }]);
    expect(fs.existsSync(file!)).toBe(true);
  });
});
