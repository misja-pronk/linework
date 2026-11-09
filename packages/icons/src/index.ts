// Icon packs are plain records of name → inner SVG markup on a 24×24 stroke grid (requirement X2).
import { lucide } from './generated/lucide.ts';

export type IconPack = Record<string, string>;

const packs: IconPack[] = [lucide];

/** Add an icon pack; later packs win, so a pack can restyle built-in names. */
export function registerIcons(pack: IconPack) {
  packs.unshift(pack);
}

export function icon(name: string): string | undefined {
  for (const pack of packs) if (pack[name]) return pack[name];
  return undefined;
}

export function iconNames(): string[] {
  return [...new Set(packs.flatMap((p) => Object.keys(p)))].sort();
}
