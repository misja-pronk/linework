// Bring-your-own icon packs: official Azure/AWS/GCP icons the user downloaded themselves, mapped
// from file names to our kind ids. We never ship or recolour them; this only builds the index.

/** A pack as stored in the user's config dir (or next to a diagram): kind → SVG file under `root`. */
export interface IconPackFile {
  name: string;
  /** Folder the paths in `icons` are relative to; relative to the pack file itself when not absolute. */
  root: string;
  icons: Record<string, string>;
  /** Where it was imported from, for `carto icons list`. */
  source?: string;
}

export interface KindInfo {
  kind: string;
  label?: string;
  keywords?: string[];
  /** What the vendor's own files call it ("simple storage service" for s3): counts as much as the kind's own name. */
  names?: string[];
}

// Vendor words that every file name carries and that say nothing about the service.
const NOISE = new Set(['icon', 'icons', 'arch', 'res', 'amazon', 'aws', 'azure', 'microsoft', 'ms', 'google', 'gcp', 'svg', 'the', 'and', 'for', 'of', 'light', 'dark', 'bg', 'color', 'rgb']);

/** Words of a file or kind name: "10245-icon-service-Key-Vaults.svg" → ["key", "vault"]. */
export function nameTokens(name: string): string[] {
  const base = name
    .split(/[\\/]/)
    .pop()!
    .replace(/\.svg$/i, '')
    .replace(/@\dx$/, '')
    .replace(/^\d+-icon-service-/i, '')
    .replace(/^(arch|res|arch-category)[_-]/i, '')
    .replace(/[_-](16|24|32|48|64)$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
  return base
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !NOISE.has(t) && !/^\d+$/.test(t))
    .map(singular);
}

const singular = (t: string) => (t.length > 3 && t.endsWith('ies') ? t.slice(0, -3) + 'y' : t.length > 3 && t.endsWith('s') && !/(ss|us|is)$/.test(t) ? t.slice(0, -1) : t);

/** Official names that do not follow from our kind id or label. Keys are kind ids; several phrases may match. */
export const aliases: Record<string, Record<string, string[]>> = {
  azure: {
    aks: ['kubernetes services'],
    'aks-cluster': ['kubernetes services'],
    vm: ['virtual machine'],
    vmss: ['vm scale sets', 'virtual machine scale sets'],
    storage: ['storage accounts'],
    redis: ['cache redis', 'redis caches'],
    'event-hub': ['event hubs'],
    'event-grid': ['event grid topics', 'event grid domains'],
    'api-management': ['api management services'],
    'logic-app': ['logic apps'],
    'data-factory': ['data factories'],
    openai: ['openai', 'azure openai'],
    'ai-search': ['cognitive search', 'search services'],
    'front-door': ['front door and cdn profiles', 'front doors'],
    'app-gateway': ['application gateways'],
    'vpn-gateway': ['virtual network gateways', 'vpn gateways'],
    'private-endpoint': ['private endpoints', 'private link'],
    dns: ['dns zones'],
    firewall: ['firewalls'],
    nsg: ['network security groups'],
    'entra-id': ['entra id', 'microsoft entra id', 'azure active directory', 'active directory'],
    'managed-identity': ['managed identities', 'entra managed identities'],
    'log-analytics': ['log analytics workspaces'],
    'app-insights': ['application insights'],
    monitor: ['monitor'],
    vnet: ['virtual networks'],
    subnet: ['subnet'],
    postgres: ['azure database postgresql server', 'database postgresql server'],
    'cosmos-db': ['azure cosmos db', 'cosmos db'],
    'static-web-app': ['static apps', 'static web apps'],
    'container-app': ['container apps', 'worker container app'],
    tenant: ['tenant properties', 'entra tenant'],
    region: ['region management'],
    users: ['users'],
    user: ['user'],
  },
  aws: {
    storage: ['simple storage service'],
    function: ['lambda'],
    queue: ['simple queue service'],
    topic: ['simple notification service'],
    database: ['rds'],
    cache: ['elasticache'],
    api: ['api gateway'],
    container: ['elastic container service'],
    cluster: ['elastic kubernetes service'],
    warehouse: ['redshift'],
    search: ['opensearch service'],
    cdn: ['cloudfront'],
    dns: ['route 53'],
    'load-balancer': ['elastic load balancing'],
    server: ['ec2'],
    secrets: ['secrets manager'],
    'key-vault': ['secrets manager'],
    monitor: ['cloudwatch'],
    users: ['users'],
    user: ['user'],
  },
  gcp: {
    storage: ['cloud storage'],
    function: ['cloud functions'],
    queue: ['pubsub', 'pub sub'],
    topic: ['pubsub', 'pub sub'],
    database: ['cloud sql'],
    warehouse: ['bigquery'],
    cluster: ['google kubernetes engine'],
    container: ['cloud run'],
    server: ['compute engine'],
  },
};

function score(want: string[], have: string[]): number {
  if (!want.length || !have.length) return 0;
  const a = new Set(want);
  const b = new Set(have);
  const both = [...a].filter((t) => b.has(t)).length;
  return both / (a.size + b.size - both);
}

/** Smaller, cleaner variants win a tie: 64px over 16px, service icons over resource icons, short paths. */
function preference(file: string): number {
  let p = -file.length / 1000;
  if (/(^|[/_-])(64|48)([/_.-]|$)/.test(file)) p += 1;
  if (/(^|[/_-])(16|32)([/_.-]|$)/.test(file)) p -= 1;
  if (/(^|\/)res_/i.test(file.split('/').pop()!)) p -= 0.5;
  if (/category/i.test(file)) p -= 0.5;
  if (/dark/i.test(file)) p -= 0.3;
  return p;
}

/**
 * The best file for each kind: every name a kind goes by (id, label, aliases, keywords at lower weight)
 * against the words of each file name. Only confident matches are kept; people can add the rest by hand.
 */
export function matchIcons(files: string[], kinds: KindInfo[], pack?: string, threshold = 0.75): Record<string, string> {
  const svgs = files.filter((f) => /\.svg$/i.test(f));
  const tokens = svgs.map((f) => ({ file: f, t: nameTokens(f) }));
  const out: Record<string, string> = {};
  const extra = pack ? aliases[pack] ?? {} : Object.assign({}, ...Object.values(aliases));
  for (const k of kinds) {
    const phrases = [k.kind.replace(/-/g, ' '), k.label ?? '', ...(k.names ?? []), ...(extra[k.kind] ?? [])].filter(Boolean).map(nameTokens);
    const loose = (k.keywords ?? []).map(nameTokens);
    let best: { file: string; s: number; p: number } | undefined;
    for (const { file, t } of tokens) {
      const s = Math.max(...phrases.map((w) => score(w, t)), ...loose.map((w) => score(w, t) * 0.85));
      const p = preference(file);
      if (s >= threshold && (!best || s > best.s + 1e-9 || (Math.abs(s - best.s) < 1e-9 && p > best.p))) best = { file, s, p };
    }
    if (best) out[k.kind] = best.file;
  }
  return out;
}

/** Index of all icons by their cleaned-up name, so people can map extra kinds by name: "key vault" → file. */
export function iconIndex(files: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of files.filter((x) => /\.svg$/i.test(x)).sort((a, b) => preference(b) - preference(a))) {
    const name = nameTokens(f).join(' ');
    if (name && !out[name]) out[name] = f;
  }
  return out;
}
