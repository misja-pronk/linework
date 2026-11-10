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

  it('finds the official AWS files for the cloud kinds', () => {
    const dir = path.join(tmp, 'aws-full');
    const files = {
      ec2: 'Architecture-Service-Icons_07312025/Arch_Compute/64/Arch_Amazon-EC2_64.svg',
      lambda: 'Architecture-Service-Icons_07312025/Arch_Compute/64/Arch_AWS-Lambda_64.svg',
      s3: 'Architecture-Service-Icons_07312025/Arch_Storage/64/Arch_Amazon-Simple-Storage-Service_64.svg',
      aurora: 'Architecture-Service-Icons_07312025/Arch_Database/64/Arch_Amazon-Aurora_64.svg',
      dynamodb: 'Architecture-Service-Icons_07312025/Arch_Database/64/Arch_Amazon-DynamoDB_64.svg',
      cloudfront: 'Architecture-Service-Icons_07312025/Arch_Networking-Content-Delivery/64/Arch_Amazon-CloudFront_64.svg',
      sqs: 'Architecture-Service-Icons_07312025/Arch_App-Integration/64/Arch_Amazon-Simple-Queue-Service_64.svg',
      glue: 'Architecture-Service-Icons_07312025/Arch_Analytics/64/Arch_AWS-Glue_64.svg',
      eks: 'Architecture-Service-Icons_07312025/Arch_Containers/64/Arch_Amazon-Elastic-Kubernetes-Service_64.svg',
      alb: 'Resource-Icons_07312025/Res_Networking-Content-Delivery/Res_Elastic-Load-Balancing_Application-Load-Balancer_48.svg',
      'nat-gateway': 'Resource-Icons_07312025/Res_Networking-Content-Delivery/Res_Amazon-VPC_NAT-Gateway_48.svg',
      'transit-gateway': 'Architecture-Service-Icons_07312025/Arch_Networking-Content-Delivery/64/Arch_AWS-Transit-Gateway_64.svg',
    };
    const others = [
      'Architecture-Service-Icons_07312025/Arch_Compute/16/Arch_AWS-Lambda_16.svg',
      'Architecture-Service-Icons_07312025/Arch_Networking-Content-Delivery/64/Arch_Elastic-Load-Balancing_64.svg',
      'Category-Icons_07312025/Arch-Category_64/Arch-Category_Storage_64.svg',
      'Category-Icons_07312025/Arch-Category_64/Arch-Category_Compute_64.svg',
    ];
    for (const f of [...Object.values(files), ...others]) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), svg('#555'));
    }
    const r = importIcons(dir, 'aws');
    expect(r.pack.icons).toMatchObject(files);
    // The words of the model find the same files, and nothing of Google's is looked for.
    expect(r.pack.icons).toMatchObject({ storage: files.s3, queue: files.sqs, 'load-balancer': others[1] });
    expect(r.pack.icons.bigquery).toBeUndefined();
    expect(r.unmatched).not.toContain('bigquery');
    expect(r.unmatched).toContain('kinesis');
    // A category icon is never mistaken for a service.
    expect(Object.values(r.pack.icons).filter((f) => f.includes('Category'))).toEqual([]);
  });

  it('finds the official Google Cloud files for the cloud kinds', () => {
    const dir = path.join(tmp, 'gcp-full');
    const files = {
      bigquery: 'google-cloud-icons/bigquery/bigquery.svg',
      'cloud-run': 'google-cloud-icons/cloud_run/cloud_run.svg',
      gcs: 'google-cloud-icons/cloud_storage/cloud_storage.svg',
      'compute-engine': 'google-cloud-icons/compute_engine/compute_engine.svg',
      pubsub: 'google-cloud-icons/pubsub/pubsub.svg',
      gke: 'google-cloud-icons/google_kubernetes_engine/google_kubernetes_engine.svg',
      'cloud-sql': 'core-products/Cloud_SQL-512-color.svg',
      'vertex-ai': 'core-products/Vertex_AI-512-color-rgb.svg',
    };
    for (const f of Object.values(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), svg('#666'));
    }
    const r = importIcons(dir, 'gcp');
    expect(r.pack.icons).toMatchObject(files);
    expect(r.pack.icons.s3).toBeUndefined();
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
