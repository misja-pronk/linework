// Icon packs in the user's config dir: `carto icons import` copies the SVGs of an official download
// there and maps them to our kinds. Nothing of it ever lands in the repo or the npm package.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPack, coverage, detectVendor, iconIndex, nameTokens, vendors, type IconPackFile, type KindInfo, type Vendor } from '@cartography/icons';
import { iconKinds, vendorKinds } from '@cartography/engine';
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

/** The kinds a pack is matched against (see iconKinds in the engine). */
export const kindsFor = (pack: string): KindInfo[] => iconKinds(pack);

/** The kinds a pack is counted against: those of the diagram types it is for. */
export const coverageKinds = (pack: string): KindInfo[] => (pack in vendors ? vendorKinds(pack) : iconKinds(pack));

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
  /** Kinds with an icon, of the kinds the pack's diagram types have. */
  coverage: { have: number; of: number; missing: string[] };
  /** Hand mappings carried over from the pack this one replaced. */
  kept: string[];
}

/** The names of the SVG files in a download, without reading them. */
export function downloadFiles(source: string): string[] {
  if (fs.statSync(source).isDirectory()) return walk(source);
  return zipSvgs(source).map((e) => e.name);
}

const zipSvgs = (source: string) => readZip(fs.readFileSync(source)).filter((e) => /\.svg$/i.test(e.name) && !e.name.includes('__MACOSX/') && !e.name.split('/').some((s) => s.startsWith('.') || s === '..'));

/** Indexes a download (a zip or its unzipped folder) into a pack; without a name the vendor is told from the files. */
export function importIcons(source: string, name?: string): ImportResult {
  const isDir = fs.statSync(source).isDirectory();
  const zip = isDir ? [] : zipSvgs(source);
  const files = isDir ? walk(source) : zip.map((e) => e.name);
  if (!files.length) throw new Error(`No SVG files in ${source}`);
  name ??= detectVendor(files);
  if (!name) throw new Error(`Cannot tell whose icons these are; name the pack: --pack ${Object.keys(vendors).join('|')}`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('--pack is a short name like azure, aws or gcp');
  const dir = packDir(name);
  const svgDir = path.join(dir, 'svg');
  const tmp = `${dir}.importing`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, 'svg'), { recursive: true });
  if (isDir)
    for (const f of files) {
      fs.mkdirSync(path.dirname(path.join(tmp, 'svg', f)), { recursive: true });
      fs.copyFileSync(path.join(source, f), path.join(tmp, 'svg', f));
    }
  else
    for (const e of zip) {
      const to = path.join(tmp, 'svg', e.name);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, e.read());
    }
  const before = readPack(name)?.manual ?? {};
  const built = buildPack(files, name, kindsFor(name), before);
  const pack: IconPackFile = { name, root: svgDir, icons: built.icons, source: path.resolve(source), imported: new Date().toISOString().slice(0, 10), ...(Object.keys(built.manual).length ? { manual: built.manual } : {}) };
  fs.writeFileSync(path.join(tmp, 'pack.json'), JSON.stringify(pack, null, 2) + '\n');
  // All names too, so a kind we did not match can be mapped by hand: "key vault" → file.
  fs.writeFileSync(path.join(tmp, 'index.json'), JSON.stringify(iconIndex(files), null, 2) + '\n');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
  return { pack, dir, files: files.length, unmatched: built.unmatched, coverage: coverage(pack, coverageKinds(name)), kept: Object.keys(built.manual) };
}

function readIndex(name: string): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(path.join(packDir(name), 'index.json'), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Icons of a pack whose name has all these words, best first: what `carto icons map` picks from. */
export function findIcons(name: string, query: string): { name: string; file: string }[] {
  const want = nameTokens(query);
  const index = readIndex(name);
  const hits = Object.entries(index).filter(([n]) => want.every((w) => n.split(' ').some((t) => t.startsWith(w))));
  return hits.sort((a, b) => a[0].length - b[0].length).map(([n, file]) => ({ name: n, file }));
}

/**
 * Maps a kind to an icon of the pack by hand: a file of the pack, or words of its name ("key vault").
 * Stored in the pack's pack.json under `manual`, so it outlives a re-import of a newer download.
 */
export function mapIcon(name: string, kind: string, query: string): { file: string; pack: IconPackFile } {
  const pack = readPack(name);
  if (!pack) throw new Error(`No ${name} icons imported yet: carto icons import <folder|zip>`);
  const exact = fs.existsSync(path.join(pack.root, query)) ? query : undefined;
  const hits = exact ? [] : findIcons(name, query);
  const file = exact ?? hits[0]?.file;
  if (!file) throw new Error(`No icon in ${name} called "${query}"; carto icons find ${name} <words> lists them`);
  const next: IconPackFile = { ...pack, icons: { ...pack.icons, [kind]: file }, manual: { ...pack.manual, [kind]: file } };
  fs.writeFileSync(path.join(packDir(name), 'pack.json'), JSON.stringify(next, null, 2) + '\n');
  return { file, pack: next };
}

/** Forgets a hand mapping (or an automatic match that was wrong): the kind draws its line icon again. */
export function unmapIcon(name: string, kind: string): IconPackFile {
  const pack = readPack(name);
  if (!pack) throw new Error(`No ${name} icons imported yet`);
  const { [kind]: _, ...icons } = pack.icons;
  const { [kind]: __, ...manual } = pack.manual ?? {};
  const next: IconPackFile = { ...pack, icons, manual };
  fs.writeFileSync(path.join(packDir(name), 'pack.json'), JSON.stringify(next, null, 2) + '\n');
  return next;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/**
 * A contact sheet of a pack: every kind of its diagram types with the icon it gets, an empty dashed
 * tile where it has none, and the coverage in the heading. To check a pack before a customer sees it.
 */
export function packSheet(name: string): { svg: string; coverage: { have: number; of: number; missing: string[] } } {
  const pack = readPack(name);
  if (!pack) throw new Error(`No ${name} icons imported yet`);
  const kinds = coverageKinds(name);
  const cov = coverage(pack, kinds);
  const COLS = 8;
  const W = 132;
  const H = 104;
  const top = 64;
  const rows = Math.ceil(kinds.length / COLS);
  const width = COLS * W + 48;
  const height = top + rows * H + 24;
  const label = (vendors as Record<string, { name: string }>)[name]?.name ?? name;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter, sans-serif"><rect width="${width}" height="${height}" fill="#FFFFFF"/>`;
  s += `<text x="24" y="34" font-size="18" font-weight="600" fill="#16212C">${esc(label)} icons</text><text x="24" y="52" font-size="12" fill="#4F5B66">${cov.have} of ${cov.of} kinds have an icon${pack.manual && Object.keys(pack.manual).length ? `, ${Object.keys(pack.manual).length} mapped by hand` : ''}</text>`;
  kinds.forEach((k, i) => {
    const x = 24 + (i % COLS) * W;
    const y = top + Math.floor(i / COLS) * H;
    const file = pack.icons[k.kind];
    let svg: string | undefined;
    try {
      svg = file ? fs.readFileSync(path.join(pack.root, file), 'utf8') : undefined;
    } catch {
      svg = undefined;
    }
    s += svg
      ? `<image href="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" x="${x + W / 2 - 22}" y="${y + 8}" width="44" height="44" preserveAspectRatio="xMidYMid meet"/>`
      : `<rect x="${x + W / 2 - 22}" y="${y + 8}" width="44" height="44" rx="6" fill="none" stroke="#B9BFC6" stroke-dasharray="4 3"/>`;
    s += `<text x="${x + W / 2}" y="${y + 70}" font-size="11" text-anchor="middle" fill="${svg ? '#16212C' : '#8A929C'}">${esc(k.kind)}</text>`;
    if (pack.manual?.[k.kind]) s += `<text x="${x + W / 2}" y="${y + 84}" font-size="9.5" text-anchor="middle" fill="#B5491B">by hand</text>`;
  });
  return { svg: s + '</svg>', coverage: cov };
}

/** The download guide: where each official set is, what the file is called, and what is imported already. */
export function iconGuide(only?: string): string {
  const out: string[] = [];
  for (const v of Object.values(vendors)) {
    if (only && v.id !== only) continue;
    const pack = readPack(v.id);
    const cov = pack ? coverage(pack, coverageKinds(v.id)) : undefined;
    out.push(`${v.name} (--pack ${v.id}, for ${v.types.join(', ')} diagrams)${cov ? `  imported ${pack!.imported ?? ''}: ${cov.have} of ${cov.of} kinds` : '  not imported'}`);
    out.push(`  1. Open ${v.page}`);
    out.push(`  2. ${v.link}`);
    out.push(`  3. You get ${v.file}`);
    out.push(`  4. carto icons import <that zip or folder>`);
    out.push(`  Terms: ${v.terms}`);
    out.push('');
  }
  out.push('Vendors move their pages and rename their files now and then; the importer goes by the names of the icons, not the folders.');
  out.push('Then: icons: official in a diagram, or carto render x.yaml --icons official. More: docs/icons.md');
  return out.join('\n');
}

export const isVendor = (v: string): v is Vendor => v in vendors;
