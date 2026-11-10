// The official sets, matched by name with stand-in file names (the real icons are never in the repo).
import { describe, expect, it } from 'vitest';
import { buildPack, coverage, detectVendor, officialNames, sameName, vendors, vendorsFor } from '../src/index.ts';

const azureV22 = [
  'Azure_Public_Service_Icons/Icons/security/10245-icon-service-Key-Vaults.svg',
  'Azure_Public_Service_Icons/Icons/web/10035-icon-service-App-Services.svg',
  'Azure_Public_Service_Icons/Icons/containers/10023-icon-service-Kubernetes-Services.svg',
  'Azure_Public_Service_Icons/Icons/identity/10231-icon-service-Entra-ID.svg',
  'Azure_Public_Service_Icons/Icons/networking/10076-icon-service-Front-Door-and-CDN-Profiles.svg',
  'Azure_Public_Service_Icons/Icons/databases/10130-icon-service-Cache-Redis.svg',
  'Azure_Public_Service_Icons/Icons/other/02884-icon-service-Worker-Container-App.svg',
  'Azure_Public_Service_Icons/Icons/general/10813-icon-service-Search.svg',
];
const kinds = (...k: string[]) => k.map((kind) => ({ kind, label: kind }));

describe('official icon sets', () => {
  it('says where each set is downloaded and which diagram types use it', () => {
    for (const v of Object.values(vendors)) {
      expect(v.page).toMatch(/^https:\/\//);
      expect(v.link.length).toBeGreaterThan(10);
      expect(v.file).toMatch(/\.zip/);
    }
    expect(vendorsFor('cloud')).toEqual(['aws', 'gcp']);
    expect(vendorsFor('azure')).toEqual(['azure']);
    expect(vendorsFor('systems')).toEqual([]);
  });

  it('tells a download by its paths', () => {
    expect(detectVendor(azureV22)).toBe('azure');
    expect(detectVendor(['Asset-Package_07312025/Architecture-Service-Icons_07312025/Arch_Compute/64/Arch_AWS-Lambda_64.svg'])).toBe('aws');
    expect(detectVendor(['google-cloud-icons/bigquery/bigquery.svg'])).toBe('gcp');
    expect(detectVendor(['community-master/icons/svg/resources/unlabeled/pod.svg'])).toBe('kubernetes');
    expect(detectVendor(['my-icons/thing.svg'])).toBeUndefined();
  });

  it('maps Azure kinds by the service names in the table, whatever the number in front', () => {
    const p = buildPack(azureV22, 'azure', kinds('key-vault', 'app-service', 'aks', 'aks-cluster', 'entra-id', 'front-door', 'redis', 'container-app', 'ai-search'));
    expect(p.icons).toMatchObject({ 'key-vault': azureV22[0], 'app-service': azureV22[1], aks: azureV22[2], 'aks-cluster': azureV22[2], 'entra-id': azureV22[3], 'front-door': azureV22[4], redis: azureV22[5], 'container-app': azureV22[6] });
    // "Search" alone is not AI Search: nothing is better than the wrong icon.
    expect(p.unmatched).toEqual(['ai-search']);
  });

  it('every Azure kind in the table is found in a set named like the real one', () => {
    let n = 10001;
    const files = Object.values(officialNames.azure).map((names) => `Icons/x/${n++}-icon-service-${names[0]!.split(' ').map((w) => w[0]!.toUpperCase() + w.slice(1)).join('-')}.svg`);
    const p = buildPack(files, 'azure', kinds(...Object.keys(officialNames.azure)));
    expect(p.unmatched).toEqual([]);
  });

  it('Kubernetes: the unlabeled icon, by its abbreviation', () => {
    const files = ['deploy', 'sts', 'svc', 'ing', 'pod', 'cm', 'netpol'].flatMap((a) => [`community-master/icons/svg/resources/labeled/${a}.svg`, `community-master/icons/svg/resources/unlabeled/${a}.svg`]);
    const p = buildPack(files, 'kubernetes', kinds('deployment', 'statefulset', 'service', 'ingress', 'pod', 'configmap', 'networkpolicy', 'cronjob'));
    expect(p.icons.deployment).toBe('community-master/icons/svg/resources/unlabeled/deploy.svg');
    expect(p.icons.networkpolicy).toBe('community-master/icons/svg/resources/unlabeled/netpol.svg');
    expect(Object.values(p.icons).every((f) => f.includes('/unlabeled/'))).toBe(true);
    expect(p.unmatched).toEqual(['cronjob']);
  });

  it('keeps a hand mapping across a newer release where the file got a new number', () => {
    const v23 = azureV22.map((f) => f.replace(/\/(\d+)-icon/, (_, d) => `/${Number(d) + 6}-icon`));
    const manual = { 'ai-search': azureV22[7]!, gateway: 'Icons/gone/10999-icon-service-Nothing-Like-It.svg' };
    const p = buildPack(v23, 'azure', kinds('key-vault', 'ai-search'), manual);
    expect(p.manual).toEqual({ 'ai-search': v23[7] });
    expect(p.icons['ai-search']).toBe(v23[7]);
    expect(p.icons['key-vault']).toBe(v23[0]);
    expect(sameName(azureV22[0]!, v23)).toBe(v23[0]);
  });

  it('counts coverage against the kinds of the diagram type', () => {
    expect(coverage({ icons: { a: 'x.svg' } }, kinds('a', 'b', 'c'))).toEqual({ have: 1, of: 3, missing: ['b', 'c'] });
  });
});
