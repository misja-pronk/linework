// Bring-your-own icon packs: official Azure/AWS/GCP icons the user downloaded themselves, mapped
// from file names to our kind ids. We never ship or recolour them; this only builds the index.
import { officialNames } from './names.ts';

/** A pack as stored in the user's config dir (or next to a diagram): kind → SVG file under `root`. */
export interface IconPackFile {
  name: string;
  /** Folder the paths in `icons` are relative to; relative to the pack file itself when not absolute. */
  root: string;
  icons: Record<string, string>;
  /** Where it was imported from, for `carto icons list`. */
  source?: string;
  /** Kinds mapped by hand (also in `icons`): kept when a newer download is imported. */
  manual?: Record<string, string>;
  /** When it was imported (ISO date). */
  imported?: string;
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
  // Kubernetes ships each icon with and without its name under it: the card has the name already.
  if (/(^|\/)unlabeled\//i.test(file)) p += 0.4;
  else if (/(^|\/)labeled\//i.test(file)) p -= 0.2;
  return p;
}

/**
 * The best file for each kind: every name a kind goes by (id, label, the vendor's names, keywords at lower weight)
 * against the words of each file name. Only confident matches are kept; people can add the rest by hand.
 */
export function matchIcons(files: string[], kinds: KindInfo[], pack?: string, threshold = 0.75): Record<string, string> {
  const svgs = files.filter((f) => /\.svg$/i.test(f));
  const tokens = svgs.map((f) => ({ file: f, t: nameTokens(f) }));
  const out: Record<string, string> = {};
  const extra: Record<string, string[]> = pack ? ((officialNames as Record<string, Record<string, string[]>>)[pack] ?? {}) : Object.assign({}, ...Object.values(officialNames));
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
