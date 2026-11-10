// Official icon sets in the browser: a download (zip or folder) is copied into the origin's private
// file system (OPFS), indexed like `carto icons import` does, and the matched icons are kept in memory
// for drawing. Nothing leaves the browser; the sets are never part of a diagram or a share link.
import { useSyncExternalStore } from 'react';
import { buildPack, coverage, detectVendor, iconIndex, nameTokens, vendors, type IconPackFile, type Vendor } from '@cartography/icons';
import { iconKinds, vendorKinds, type IconMode } from '@cartography/engine';
import { store } from './store.ts';
import { t } from './i18n/index.ts';

export interface StoredPack extends IconPackFile {
  /** Every icon of the set by its cleaned-up name, for mapping by hand. */
  index: Record<string, string>;
  files: number;
}

export interface IconPacks {
  packs: Partial<Record<Vendor, StoredPack>>;
  /** Kind → SVG markup per set, what the drawing uses. */
  markup: Partial<Record<Vendor, Record<string, string>>>;
  /** '' follows each diagram's `icons:`; else official or lucide for every diagram. */
  mode: '' | IconMode;
  /** What an import is doing right now. */
  busy?: { vendor?: Vendor; done: number; of: number };
}

let state: IconPacks = { packs: {}, markup: {}, mode: (store.get<string>('icon-mode') as IconPacks['mode']) ?? '' };
const listeners = new Set<() => void>();
const set = (next: Partial<IconPacks>) => {
  state = { ...state, ...next };
  options = undefined;
  for (const l of listeners) l();
};
export const iconPacks = () => state;
export function useIconPacks(): IconPacks {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), iconPacks);
}

let options: { iconPacks?: Record<string, Record<string, string>>; iconsOverride?: IconMode } | undefined;
/** What render() takes from here: the sets in memory and the toggle. One object until something changes. */
export function iconOptions() {
  options ??= {
    ...(Object.keys(state.markup).length ? { iconPacks: state.markup as Record<string, Record<string, string>> } : { iconPacks: {} }),
    ...(state.mode ? { iconsOverride: state.mode } : {}),
  };
  return options;
}

/** iconOptions() for a component, redrawing when a set or the toggle changes. */
export function useIconOptions() {
  useIconPacks();
  return iconOptions();
}

export function setIconMode(mode: IconPacks['mode']) {
  store.set('icon-mode', mode);
  set({ mode });
}

// ---------------------------------------------------------------- OPFS

const opfs = () => navigator.storage?.getDirectory?.();
async function packsDir(create = false): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    return await (await opfs())?.getDirectoryHandle('icon-packs', { create });
  } catch {
    return undefined;
  }
}
async function dirAt(root: FileSystemDirectoryHandle, parts: string[], create: boolean) {
  let d = root;
  for (const p of parts) d = await d.getDirectoryHandle(p, { create });
  return d;
}
async function writeText(root: FileSystemDirectoryHandle, file: string, text: string) {
  const parts = file.split('/').filter(Boolean);
  const d = await dirAt(root, parts.slice(0, -1), true);
  const w = await (await d.getFileHandle(parts.at(-1)!, { create: true })).createWritable();
  await w.write(text);
  await w.close();
}
async function readText(root: FileSystemDirectoryHandle, file: string): Promise<string | undefined> {
  try {
    const parts = file.split('/').filter(Boolean);
    const d = await dirAt(root, parts.slice(0, -1), false);
    return await (await (await d.getFileHandle(parts.at(-1)!)).getFile()).text();
  } catch {
    return undefined;
  }
}

/** The SVG of one icon of a set, by its path in the download. */
export async function iconSvg(vendor: Vendor, file: string): Promise<string | undefined> {
  const dir = await packsDir();
  return dir ? readText(await dir.getDirectoryHandle(vendor), `svg/${file}`).catch(() => undefined) : undefined;
}

async function loadMarkup(vendor: Vendor, pack: StoredPack): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    Object.entries(pack.icons).map(async ([kind, file]) => {
      const svg = await iconSvg(vendor, file);
      if (svg && /<svg[\s>]/.test(svg)) out[kind] = svg;
    }),
  );
  return out;
}

/** Reads what earlier visits imported. */
export async function loadPacks() {
  const dir = await packsDir();
  if (!dir) return;
  const packs: IconPacks['packs'] = {};
  const markup: IconPacks['markup'] = {};
  for (const v of Object.keys(vendors) as Vendor[]) {
    try {
      const text = await readText(await dir.getDirectoryHandle(v), 'pack.json');
      if (!text) continue;
      const pack = JSON.parse(text) as StoredPack;
      packs[v] = pack;
      markup[v] = await loadMarkup(v, pack);
    } catch {
      // Not imported.
    }
  }
  set({ packs, markup });
}
void loadPacks();

// ---------------------------------------------------------------- reading a download

/** An SVG of a download: its path in the zip or folder, and how to read it. */
export interface DownloadFile {
  path: string;
  text(): Promise<string>;
}

const keep = (p: string) => /\.svg$/i.test(p) && !p.includes('__MACOSX/') && !p.split('/').some((s) => s.startsWith('.') || s === '..');

/** Just enough of the ZIP format for the vendors' downloads: stored or deflated entries, inflated by the browser. */
export async function zipFiles(file: Blob): Promise<DownloadFile[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error(t('That is not a zip file'));
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  if (p === 0xffffffff) throw new Error(t('This zip is too big to read here; unzip it and choose the folder'));
  const out: DownloadFile[] = [];
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error(t('The zip is damaged'));
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!keep(name) || (method !== 0 && method !== 8)) continue;
    out.push({
      path: name,
      text: async () => {
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        const raw = buf.subarray(start, start + size);
        if (method === 0) return decoder.decode(raw);
        const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Response(stream).text();
      },
    });
  }
  return out;
}

/** The SVGs in a folder the person picked. */
export async function folderFiles(dir: FileSystemDirectoryHandle): Promise<DownloadFile[]> {
  const out: DownloadFile[] = [];
  const walk = async (d: FileSystemDirectoryHandle, prefix: string, depth: number) => {
    for await (const [name, h] of (d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (out.length > 30000 || name.startsWith('.') || name === '__MACOSX') continue;
      if (h.kind === 'directory' && depth < 10) await walk(h as FileSystemDirectoryHandle, `${prefix}${name}/`, depth + 1);
      else if (keep(name)) out.push({ path: prefix + name, text: async () => (await (h as FileSystemFileHandle).getFile()).text() });
    }
  };
  await walk(dir, '', 0);
  return out;
}

/** Files from an <input webkitdirectory> or a dropped folder's files. */
export const listFiles = (files: File[]): DownloadFile[] =>
  files.map((f) => ({ path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, text: () => f.text() })).filter((f) => keep(f.path));

/**
 * Copies a download into the browser and indexes it. The vendor is told from the files unless given.
 * Hand mappings of the set it replaces are kept, found by name in a newer release.
 */
export async function importDownload(files: DownloadFile[], source: string, vendor?: Vendor): Promise<{ vendor: Vendor; pack: StoredPack; have: number; of: number }> {
  if (!files.length) throw new Error(t('No SVG icons in there. Choose the zip you downloaded, or the folder it unzips to.'));
  const paths = files.map((f) => f.path);
  const v = vendor ?? detectVendor(paths);
  if (!v) throw new Error(t('These do not look like the Azure, AWS, Google Cloud or Kubernetes icons. Use the button of the vendor they are from.'));
  const root = await packsDir(true);
  if (!root) throw new Error(t('This browser does not let the page keep files (private window?), so the icons cannot be stored'));
  set({ busy: { vendor: v, done: 0, of: files.length } });
  try {
    try {
      await root.removeEntry(`${v}.importing`, { recursive: true });
    } catch {
      // Nothing half-done.
    }
    const tmp = await root.getDirectoryHandle(`${v}.importing`, { create: true });
    let done = 0;
    // A few at a time: OPFS writes are slow one by one and a set has hundreds of files.
    const queue = [...files];
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        for (let f = queue.shift(); f; f = queue.shift()) {
          await writeText(tmp, `svg/${f.path}`, await f.text());
          if (++done % 50 === 0) set({ busy: { vendor: v, done, of: files.length } });
        }
      }),
    );
    const built = buildPack(paths, v, iconKinds(v), state.packs[v]?.manual ?? {});
    const pack: StoredPack = { name: v, root: 'svg', icons: built.icons, source, imported: new Date().toISOString().slice(0, 10), files: files.length, index: iconIndex(paths), ...(Object.keys(built.manual).length ? { manual: built.manual } : {}) };
    await writeText(tmp, 'pack.json', JSON.stringify(pack));
    try {
      await root.removeEntry(v, { recursive: true });
    } catch {
      // First import.
    }
    // OPFS cannot rename a folder everywhere yet: the finished copy is moved file by file only where it must be.
    const moved = await moveDir(root, `${v}.importing`, v);
    if (!moved) throw new Error(t('Could not store the icons'));
    const markup = await loadMarkup(v, pack);
    set({ packs: { ...state.packs, [v]: pack }, markup: { ...state.markup, [v]: markup } });
    const c = coverage(pack, vendorKinds(v));
    return { vendor: v, pack, have: c.have, of: c.of };
  } finally {
    set({ busy: undefined });
  }
}

async function moveDir(root: FileSystemDirectoryHandle, from: string, to: string): Promise<boolean> {
  const src = await root.getDirectoryHandle(from);
  const h = src as unknown as { move?(parent: FileSystemDirectoryHandle, name: string): Promise<void> };
  if (h.move) {
    try {
      await h.move(root, to);
      return true;
    } catch {
      // Fall back to copying.
    }
  }
  const dst = await root.getDirectoryHandle(to, { create: true });
  const copy = async (a: FileSystemDirectoryHandle, b: FileSystemDirectoryHandle) => {
    for await (const [name, e] of (a as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (e.kind === 'directory') await copy(e as FileSystemDirectoryHandle, await b.getDirectoryHandle(name, { create: true }));
      else {
        const w = await (await b.getFileHandle(name, { create: true })).createWritable();
        await w.write(await (e as FileSystemFileHandle).getFile());
        await w.close();
      }
    }
  };
  await copy(src, dst);
  await root.removeEntry(from, { recursive: true });
  return true;
}

async function savePack(v: Vendor, pack: StoredPack) {
  const root = await packsDir();
  if (!root) return;
  await writeText(await root.getDirectoryHandle(v), 'pack.json', JSON.stringify(pack));
  set({ packs: { ...state.packs, [v]: pack }, markup: { ...state.markup, [v]: await loadMarkup(v, pack) } });
}

/** Gives a kind an icon of the set by hand; kept when a newer release is imported. */
export async function mapKind(v: Vendor, kind: string, file: string) {
  const pack = state.packs[v];
  if (!pack) return;
  await savePack(v, { ...pack, icons: { ...pack.icons, [kind]: file }, manual: { ...pack.manual, [kind]: file } });
}

/** The kind draws its line icon again (an automatic match that was wrong, or a hand mapping undone). */
export async function unmapKind(v: Vendor, kind: string) {
  const pack = state.packs[v];
  if (!pack) return;
  const { [kind]: _, ...icons } = pack.icons;
  const { [kind]: __, ...manual } = pack.manual ?? {};
  await savePack(v, { ...pack, icons, manual });
}

export async function removePack(v: Vendor) {
  const root = await packsDir();
  try {
    await root?.removeEntry(v, { recursive: true });
  } catch {
    // Already gone.
  }
  const { [v]: _, ...packs } = state.packs;
  const { [v]: __, ...markup } = state.markup;
  set({ packs, markup });
}

/** Icons of a set whose name has all these words, best first. */
export function searchIcons(pack: StoredPack, query: string, limit = 48): { name: string; file: string }[] {
  const want = nameTokens(query);
  const hits = Object.entries(pack.index).filter(([n]) => want.every((w) => n.split(' ').some((t) => t.startsWith(w))));
  return hits
    .sort((a, b) => a[0].length - b[0].length)
    .slice(0, limit)
    .map(([name, file]) => ({ name, file }));
}

export { coverage, vendorKinds, vendors, type Vendor };
