// The editor's brand choices, outside React state so the renderer and the exports read the same
// thing without app.tsx passing it around: a theme (built-in or a .theme.yaml from the open folder)
// that wins over the diagram's own, and a BYO icon folder mapped to kinds.
import { useSyncExternalStore } from 'react';
import { matchIcons, type KindInfo } from '@cartography/icons';
import { measureText, resolveTheme, SCALE_SAMPLE, themes, type Theme, type ThemeWarning } from '@cartography/theme';
import { types } from '@cartography/engine';
import { store } from './store.ts';
import type { Workspace } from './files.ts';

export interface Brand {
  /** '' follows the diagram's `theme:` (or the light/dark switch); else a built-in name or a theme file path. */
  choice: string;
  theme?: Theme;
  warnings: ThemeWarning[];
  /** kind → SVG markup from the icon folder. */
  icons?: Record<string, string>;
  iconFolder?: string;
  /** A remembered icon folder that needs a click to be read again. */
  iconsToReconnect?: boolean;
}

let state: Brand = { choice: '', warnings: [] };
const listeners = new Set<() => void>();
const set = (next: Partial<Brand>) => {
  state = { ...state, ...next };
  for (const l of listeners) l();
};

export const brand = () => state;
export function useBrand(): Brand {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), brand);
}

// A built-in choice survives a reload; a theme file is picked again (its folder may be gone).
// A choice saved as light or dark (before the looks had names) is Survey in that mode.
const RENAMED: Record<string, string> = { light: 'survey', dark: 'survey-dark' };
const stored = store.get<string>('brand-theme');
const saved = stored ? (RENAMED[stored] ?? stored) : undefined;
if (saved && themes[saved]) set({ choice: saved, theme: themes[saved] });

export function chooseBuiltin(name: string) {
  store.set('brand-theme', name);
  set({ choice: name, theme: name ? themes[name] : undefined, warnings: [] });
  void registerFonts(undefined);
}

/** A built-in theme for this page only, not remembered: what a share link was made with. */
export function showBuiltin(name: string) {
  if (!themes[name]) return;
  set({ choice: name, theme: themes[name], warnings: [] });
  void registerFonts(undefined);
}

/** Theme files in the open folder, by path. */
export const themeFiles = (ws: Workspace | undefined) => (ws ? [...ws.files.keys()].filter((p) => /\.theme\.(ya?ml|json)$/i.test(p)).sort() : []);

async function bytes(ws: Workspace, file: string): Promise<Uint8Array | undefined> {
  try {
    let d = ws.dir;
    const parts = file.split('/').filter((s) => s && s !== '.');
    for (const seg of parts.slice(0, -1)) d = await d.getDirectoryHandle(seg);
    return new Uint8Array(await (await (await d.getFileHandle(parts.at(-1)!)).getFile()).arrayBuffer());
  } catch {
    return undefined;
  }
}

/** Reads a theme file and everything it names (fonts, logo) from the folder, then embeds it all. */
export async function chooseFile(ws: Workspace, file: string) {
  const text = (f: string) => {
    const hit = ws.files.get(f);
    if (!hit) throw new Error(`No file ${f}`);
    return hit.text;
  };
  // The resolver reads synchronously: a dry run learns which binary files it wants, then they are read.
  const wanted = new Set<string>();
  resolveTheme(file, { load: text, assets: (f) => (wanted.add(f), undefined) });
  const cache = new Map<string, Uint8Array>();
  for (const f of wanted) {
    const b = await bytes(ws, f);
    if (b) cache.set(f, b);
  }
  const r = resolveTheme(file, { load: text, assets: (f) => cache.get(f) });
  const scale = await registerFonts(r.theme);
  const theme = scale && !r.theme.font.scale ? { ...r.theme, font: { ...r.theme.font, scale } } : r.theme;
  store.set('brand-theme', '');
  set({ choice: file, theme, warnings: r.warnings });
}

let fontStyle: HTMLStyleElement | undefined;
/** Registers a brand font with the page (the preview draws without embedding) and measures its width against Inter. */
async function registerFonts(theme: Theme | undefined): Promise<number | undefined> {
  fontStyle?.remove();
  fontStyle = undefined;
  const faces = theme?.font.faces;
  if (!faces?.length) return undefined;
  // The width against Inter is that of the text face; a monospace face is measured by its own rule.
  const text = faces.filter((f) => !f.mono);
  const mime = { woff2: 'font/woff2', woff: 'font/woff', truetype: 'font/ttf', opentype: 'font/otf' };
  fontStyle = document.createElement('style');
  fontStyle.textContent = faces.map((f) => `@font-face{font-family:'${f.family}';font-weight:${f.weight};font-style:${f.style};src:url(data:${mime[f.format]};base64,${f.data})}`).join('');
  document.head.append(fontStyle);
  const face = text.find((f) => f.weight === 600) ?? text[0];
  if (!face) return undefined;
  try {
    await document.fonts.load(`${face.weight} 100px '${face.family}'`);
    const g = document.createElement('canvas').getContext('2d')!;
    g.font = `${face.weight} 100px '${face.family}'`;
    return Math.round((g.measureText(SCALE_SAMPLE).width / measureText(SCALE_SAMPLE, 100, face.weight >= 600 ? 600 : face.weight >= 500 ? 500 : 400)) * 1000) / 1000;
  } catch {
    return undefined;
  }
}

// Icon folder: picked once, the handle kept in IndexedDB like the workspace folder.

const DB = 'cartography-icons';
function idb(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('handles');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}
async function remember(dir: FileSystemDirectoryHandle | undefined) {
  try {
    const db = await idb();
    const s = db.transaction('handles', 'readwrite').objectStore('handles');
    if (dir) s.put(dir, 'icons');
    else s.delete('icons');
  } catch {
    /* private window */
  }
}
async function remembered(): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    const db = await idb();
    return await new Promise((ok) => {
      const r = db.transaction('handles').objectStore('handles').get('icons');
      r.onsuccess = () => ok(r.result as FileSystemDirectoryHandle | undefined);
      r.onerror = () => ok(undefined);
    });
  } catch {
    return undefined;
  }
}

let iconDir: FileSystemDirectoryHandle | undefined;
void remembered().then(async (dir) => {
  if (!dir) return;
  iconDir = dir;
  const h = dir as unknown as { queryPermission(o: object): Promise<PermissionState> };
  if ((await h.queryPermission?.({ mode: 'read' })) === 'granted') await readIcons(dir);
  else set({ iconFolder: dir.name, iconsToReconnect: true });
});

const kinds = (): KindInfo[] => {
  const seen = new Map<string, KindInfo>();
  for (const t of types) for (const p of t.palette) if (!seen.has(p.kind)) seen.set(p.kind, { kind: p.kind, label: p.label, keywords: p.keywords });
  return [...seen.values()];
};

async function readIcons(dir: FileSystemDirectoryHandle) {
  const handles = new Map<string, FileSystemFileHandle>();
  const walk = async (d: FileSystemDirectoryHandle, prefix: string, depth: number) => {
    for await (const [name, h] of (d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (handles.size > 20000 || name.startsWith('.') || name === '__MACOSX') continue;
      if (h.kind === 'directory' && depth < 8) await walk(h as FileSystemDirectoryHandle, `${prefix}${name}/`, depth + 1);
      else if (/\.svg$/i.test(name)) handles.set(prefix + name, h as FileSystemFileHandle);
    }
  };
  await walk(dir, '', 0);
  // Only the matched files are read: a full Azure pack is hundreds of icons.
  const map = matchIcons([...handles.keys()], kinds());
  const icons: Record<string, string> = {};
  for (const [kind, file] of Object.entries(map)) icons[kind] = await (await handles.get(file)!.getFile()).text();
  set({ icons, iconFolder: dir.name, iconsToReconnect: false });
}

export async function pickIconFolder() {
  try {
    const dir = await (window as unknown as { showDirectoryPicker(o: object): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: 'read', id: 'cartography-icons' });
    iconDir = dir;
    await remember(dir);
    await readIcons(dir);
  } catch (e) {
    if ((e as Error).name !== 'AbortError') throw e;
  }
}

export async function reconnectIcons() {
  if (!iconDir) return;
  const h = iconDir as unknown as { requestPermission(o: object): Promise<PermissionState> };
  if ((await h.requestPermission({ mode: 'read' })) === 'granted') await readIcons(iconDir);
}

export function forgetIcons() {
  iconDir = undefined;
  void remember(undefined);
  set({ icons: undefined, iconFolder: undefined, iconsToReconnect: false });
}
