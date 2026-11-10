// The official icon sets people download themselves: where to get each, how to tell a download
// apart, and which official icon is ours for each kind. The table names services as the vendor's
// files do; matching goes by the words of the name, so number prefixes ("10245-icon-service-"),
// size suffixes ("_64") and the set's version or date in folder names do not matter.
import { matchIcons, nameTokens, type IconPackFile, type KindInfo } from './match.ts';
import type { Vendor } from './names.ts';

export { officialNames, type Vendor } from './names.ts';

export interface VendorInfo {
  id: Vendor;
  name: string;
  /** The page the set is downloaded from. Vendors move these pages now and then. */
  page: string;
  /** What to click there. */
  link: string;
  /** What the download is called (the version or date changes with every release). */
  file: string;
  /** Terms in one line; the full text comes with the download. */
  terms: string;
  /** Which of our diagram types use it. */
  types: string[];
}

export const vendors: Record<Vendor, VendorInfo> = {
  azure: {
    id: 'azure',
    name: 'Microsoft Azure',
    page: 'https://learn.microsoft.com/azure/architecture/icons/',
    link: 'Download SVG icons (in "Icon terms", after accepting them)',
    file: 'Azure_Public_Service_Icons_V23.zip (V and a number: the release); inside, Azure_Public_Service_Icons/Icons/<category>/<number>-icon-service-<Name>.svg',
    terms: 'For architecture diagrams, training and documentation; do not modify, crop or recolour them; do not redistribute the set.',
    types: ['azure'],
  },
  aws: {
    id: 'aws',
    name: 'Amazon Web Services',
    page: 'https://aws.amazon.com/architecture/icons/',
    link: 'Download the asset package (under "Architecture Icons")',
    file: 'Asset-Package_07312025.zip (the date of the release); inside, Architecture-Service-Icons_<date>/Arch_<Category>/64/Arch_<Name>_64.svg and Resource-Icons_<date>/Res_<Category>/Res_<Name>_48.svg',
    terms: 'For architecture diagrams; no changes to the icons, no implied endorsement, follow the AWS trademark guidelines.',
    types: ['cloud'],
  },
  gcp: {
    id: 'gcp',
    name: 'Google Cloud',
    page: 'https://cloud.google.com/icons',
    link: 'Download all icons (or "Core products" for the main ones)',
    file: 'google-cloud-icons.zip, with a folder per product (bigquery/bigquery.svg); the core-products set names files <Product>-512-color.svg',
    terms: 'For diagrams of Google Cloud architectures, under the terms on the page; do not change the icons.',
    types: ['cloud'],
  },
  kubernetes: {
    id: 'kubernetes',
    name: 'Kubernetes',
    page: 'https://github.com/kubernetes/community/tree/master/icons',
    link: 'Download the repository as a ZIP (Code, then Download ZIP), or copy the icons folder',
    file: 'community-master.zip; inside, icons/svg/resources/unlabeled/<abbreviation>.svg (deploy.svg, sts.svg, svc.svg) and labeled/ versions',
    terms: 'CC BY 4.0, by the Kubernetes authors: credit "Kubernetes icons, CC BY 4.0" where you publish.',
    types: ['kubernetes'],
  },
};

/** The vendors whose icons a diagram type can use. */
export const vendorsFor = (type: string): Vendor[] => (Object.values(vendors) as VendorInfo[]).filter((v) => v.types.includes(type)).map((v) => v.id);

/** Which vendor a download is, by its paths; undefined when it does not look like any of them. */
export function detectVendor(files: string[]): Vendor | undefined {
  const all = files.join('\n');
  if (/icon-service-|Azure_Public_Service_Icons/i.test(all)) return 'azure';
  if (/(^|\/)(Arch|Res)_[A-Z]|Architecture-Service-Icons|Asset-Package/.test(all)) return 'aws';
  if (/(^|\/)icons\/svg\/(resources|infrastructure_components|control_plane_components)\//i.test(all) || /(^|\/)resources\/(un)?labeled\/(pod|deploy|svc)\.svg/i.test(all)) return 'kubernetes';
  if (/google-cloud|core-products|(^|\/)(bigquery|cloud_run|compute_engine)\//i.test(all)) return 'gcp';
  return undefined;
}

/** What an import or a hand mapping makes of a download: the pack record and what is still missing. */
export interface BuiltPack {
  icons: Record<string, string>;
  /** Kinds mapped by hand: kept over the automatic match, and carried over to a newer download by name. */
  manual: Record<string, string>;
  unmatched: string[];
}

/**
 * Maps a download's files to our kinds: the vendor's table, then the words of the kinds, then what was
 * mapped by hand before. A hand-mapped file that is gone in a newer release is looked up by its name
 * there ("10245-icon-service-Key-Vaults" in V22 is "10251-icon-service-Key-Vaults" in V23).
 */
export function buildPack(files: string[], vendor: Vendor | string, kinds: KindInfo[], manual: Record<string, string> = {}): BuiltPack {
  const v = vendor in vendors ? (vendor as Vendor) : undefined;
  const icons = matchIcons(files, kinds, v);
  const have = new Set(files);
  const kept: Record<string, string> = {};
  for (const [kind, file] of Object.entries(manual)) {
    const found = have.has(file) ? file : sameName(file, files);
    if (found) kept[kind] = icons[kind] = found;
  }
  return { icons, manual: kept, unmatched: kinds.map((k) => k.kind).filter((k) => !icons[k]) };
}

/** The file in a newer download with the same service name as an older one. */
export function sameName(old: string, files: string[]): string | undefined {
  const want = nameTokens(old).join(' ');
  if (!want) return undefined;
  const base = (f: string) => f.split('/').pop()!;
  return files.filter((f) => nameTokens(f).join(' ') === want).sort((a, b) => Number(base(a) !== base(old)) - Number(base(b) !== base(old)) || a.length - b.length)[0];
}

/** How much of a diagram type a pack covers: kinds with an icon, out of the kinds there are. */
export function coverage(pack: Pick<IconPackFile, 'icons'>, kinds: KindInfo[]): { have: number; of: number; missing: string[] } {
  const missing = kinds.filter((k) => !pack.icons[k.kind]).map((k) => k.kind);
  return { have: kinds.length - missing.length, of: kinds.length, missing };
}
