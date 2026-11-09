// Icon packs in the user's config dir: `carto icons import` copies the SVGs of an official download
// there and maps them to our kinds. Nothing of it ever lands in the repo or the npm package.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { iconIndex, matchIcons, type IconPackFile, type KindInfo } from '@cartography/icons';
import type { PaletteItem } from '@cartography/core';
import { types } from '@cartography/engine';
import { readZip } from './zip.ts';

export function configDir(): string {
  if (process.env.CARTO_CONFIG_DIR) return process.env.CARTO_CONFIG_DIR;
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, 'cartography');
  if (process.platform === 'win32' && process.env.APPDATA) return path.join(process.env.APPDATA, 'cartography');
  return path.join(os.homedir(), '.config', 'cartography');
}

const packDir = (name: string) => path.join(configDir(), 'icons', name);

export function readPack(name: string): IconPackFile | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(packDir(name), 'pack.json'), 'utf8')) as IconPackFile;
  } catch {
    return undefined;
  }
}

export function listPacks(): IconPackFile[] {
  const dir = path.join(configDir(), 'icons');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).flatMap((n) => readPack(n) ?? []);
}

/**
 * Kinds to match: the type of the same name (azure, kubernetes), or for a vendor pack (aws, gcp) the
 * kinds that say they are that vendor's (the cloud type, with the names the vendor's files go by)
 * and then every type's general kinds. Kinds of another vendor are left out: BigQuery has no AWS icon.
 */
export function kindsFor(pack: string): KindInfo[] {
  const own = types.find((t) => t.id === pack);
  const seen = new Map<string, KindInfo>();
  // With official names at hand the search words (category, vendor) would only add false matches.
  const add = (p: PaletteItem) => void (seen.has(p.kind) || seen.set(p.kind, { kind: p.kind, label: p.label, keywords: p.names ? undefined : p.keywords, names: p.names }));
  for (const t of types) for (const p of t.palette) if (p.provider === pack) add(p);
  for (const t of own ? [own] : types) for (const p of t.palette) if (!p.provider || p.provider === pack) add(p);
  return [...seen.values()];
}

function walk(dir: string, prefix = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.name.startsWith('.') || e.name === '__MACOSX' ? [] : e.isDirectory() ? walk(path.join(dir, e.name), `${prefix}${e.name}/`) : /\.svg$/i.test(e.name) ? [`${prefix}${e.name}`] : [],
  );
}

export interface ImportResult {
  pack: IconPackFile;
  dir: string;
  files: number;
  unmatched: string[];
}

export function importIcons(source: string, name: string): ImportResult {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('--pack is a short name like azure, aws or gcp');
  const dir = packDir(name);
  const svgDir = path.join(dir, 'svg');
  const tmp = `${dir}.importing`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, 'svg'), { recursive: true });
  let files: string[];
  if (fs.statSync(source).isDirectory()) {
    files = walk(source);
    for (const f of files) {
      fs.mkdirSync(path.dirname(path.join(tmp, 'svg', f)), { recursive: true });
      fs.copyFileSync(path.join(source, f), path.join(tmp, 'svg', f));
    }
  } else {
    const entries = readZip(fs.readFileSync(source)).filter((e) => /\.svg$/i.test(e.name) && !e.name.includes('__MACOSX/') && !e.name.split('/').some((s) => s.startsWith('.') || s === '..'));
    files = entries.map((e) => e.name);
    for (const e of entries) {
      const to = path.join(tmp, 'svg', e.name);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, e.read());
    }
  }
  if (!files.length) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error(`No SVG files in ${source}`);
  }
  const kinds = kindsFor(name);
  const icons = matchIcons(files, kinds, name);
  const pack: IconPackFile = { name, root: svgDir, icons, source: path.resolve(source) };
  fs.writeFileSync(path.join(tmp, 'pack.json'), JSON.stringify(pack, null, 2) + '\n');
  // All names too, so a kind we did not match can be mapped by hand: "key vault" → file.
  fs.writeFileSync(path.join(tmp, 'index.json'), JSON.stringify(iconIndex(files), null, 2) + '\n');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
  return { pack, dir, files: files.length, unmatched: kinds.map((k) => k.kind).filter((k) => !icons[k]) };
}
