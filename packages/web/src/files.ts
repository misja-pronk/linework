// Local files through the File System Access API (Chrome, Edge): open a folder, edit its diagrams in
// place, save next to them. Text files in the folder are cached so the engine's synchronous loader can
// read contracts relative to the diagram, as the CLI does. Other browsers fall back to upload/download.
import { parseSidecar, type LayoutSidecar } from '@linework/core';
import { t } from './i18n/index.ts';
import { sourcedLoader, type Loader } from './render-client.ts';

export const canUseFolders = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
export const canSaveFiles = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

/** Diagrams, sidecars and contracts. */
const TEXT = /\.(ya?ml|json)$/i;
const SKIP = new Set(['node_modules', '.git', 'dist', '.cache', '.next', 'out']);
const MAX_FILES = 800;
const MAX_BYTES = 2_000_000;

export interface Workspace {
  dir: FileSystemDirectoryHandle;
  name: string;
  /** Text files by path relative to the folder, e.g. "data/contracts/orders.odcs.yaml". */
  files: Map<string, { handle: FileSystemFileHandle; text: string }>;
}

/** Paths of the diagrams in a workspace: YAML with a top-level "type:" (snapshots of one, in <name>.snapshots/, are not). */
export function diagrams(ws: Workspace): string[] {
  return [...ws.files]
    .filter(([p, f]) => /\.ya?ml$/i.test(p) && /^type:\s*[\w-]+/m.test(f.text) && !/\.odcs\.ya?ml$/i.test(p) && !/(^|\/)[^/]+\.snapshots\//.test(p) && !isCodeYaml(p, f.text))
    .map(([p]) => p)
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

/** YAML of a repository's code that has a top-level type: too: a Helm chart's Chart.yaml (type: application), a manifest. */
const isCodeYaml = (path: string, text: string) => /(^|\/)Chart\.yaml$/.test(path) || /^apiVersion\s*:/m.test(text);

export async function pickFolder(): Promise<Workspace | undefined> {
  try {
    const dir = await (window as unknown as { showDirectoryPicker(o: object): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: 'readwrite', id: 'linework' });
    await remember(dir);
    return scan(dir);
  } catch (e) {
    if ((e as Error).name === 'AbortError') return undefined;
    throw e;
  }
}

/** Reads every text file (up to a limit) into memory. */
export async function scan(dir: FileSystemDirectoryHandle): Promise<Workspace> {
  const files: Workspace['files'] = new Map();
  const walk = async (d: FileSystemDirectoryHandle, prefix: string, depth: number) => {
    for await (const [name, h] of (d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (files.size >= MAX_FILES) return;
      if (h.kind === 'directory') {
        // Hidden folders are left alone.
        if (depth < 6 && !SKIP.has(name) && !name.startsWith('.')) await walk(h as FileSystemDirectoryHandle, `${prefix}${name}/`, depth + 1);
      } else if (TEXT.test(name)) {
        const file = await (h as FileSystemFileHandle).getFile();
        if (file.size <= MAX_BYTES) files.set(prefix + name, { handle: h as FileSystemFileHandle, text: await file.text() });
      }
    }
  };
  await walk(dir, '', 0);
  return { dir, name: dir.name, files };
}

/** A synchronous loader for one diagram: paths relative to it, from the cache. */
export function folderLoader(ws: Workspace, diagram: string): Loader {
  // The worker that draws (render-client.ts) gets the folder's texts as they are at each drawing.
  return sourcedLoader(
    diagram.split('/').slice(0, -1),
    (path) => ws.files.get(path)?.text,
    () => new Map([...ws.files].map(([path, f]) => [path, f.text])),
    t('No file {file}', { file: '{file}' }),
  );
}

export const sidecarPath = (diagram: string) => diagram.replace(/\.ya?ml$/i, '') + '.layout.json';

export function readSidecar(ws: Workspace, diagram: string): LayoutSidecar | undefined {
  const f = ws.files.get(sidecarPath(diagram));
  if (!f) return undefined;
  try {
    // What cannot be read of it is left out; the rest still pins the drawing.
    const v = parseSidecar(JSON.parse(f.text)).sidecar;
    return v && (v.nodes || v.groups || v.edges || v.views || v.layout) ? v : undefined;
  } catch {
    return undefined;
  }
}

async function handleFor(ws: Workspace, path: string, create: boolean): Promise<FileSystemFileHandle | undefined> {
  const known = ws.files.get(path)?.handle;
  if (known) return known;
  const parts = path.split('/');
  let d = ws.dir;
  try {
    for (const seg of parts.slice(0, -1)) d = await d.getDirectoryHandle(seg, { create });
    return await d.getFileHandle(parts.at(-1)!, { create });
  } catch {
    return undefined;
  }
}

async function write(handle: FileSystemFileHandle, text: string) {
  const w = await (handle as unknown as { createWritable(): Promise<{ write(t: string): Promise<void>; close(): Promise<void> }> }).createWritable();
  await w.write(text);
  await w.close();
}

/** Saves a diagram and its pins (or removes a stale sidecar when there are none). */
export async function saveInFolder(ws: Workspace, path: string, text: string, pins: LayoutSidecar | undefined) {
  const h = await handleFor(ws, path, true);
  if (!h) throw new Error(t('Cannot write {path}', { path }));
  await write(h, text);
  ws.files.set(path, { handle: h, text });
  const side = sidecarPath(path);
  if (['nodes', 'groups', 'edges', 'locked', 'views', 'layout'].some((k) => Object.keys(pins?.[k as 'nodes'] ?? {}).length)) {
    const json = JSON.stringify(pins, null, 2) + '\n';
    const sh = await handleFor(ws, side, true);
    if (!sh) throw new Error(t('Cannot write {path}', { path: side }));
    await write(sh, json);
    ws.files.set(side, { handle: sh, text: json });
  } else if (ws.files.has(side) && isSidecar(ws.files.get(side)!.text)) {
    // Only a layout file we can read is removed; one we cannot read may hold someone's work.
    try {
      const parts = side.split('/');
      let d = ws.dir;
      for (const seg of parts.slice(0, -1)) d = await d.getDirectoryHandle(seg);
      await d.removeEntry(parts.at(-1)!);
    } catch {
      /* already gone */
    }
    ws.files.delete(side);
  }
}

function isSidecar(text: string): boolean {
  try {
    const v = JSON.parse(text);
    return !!v && typeof v === 'object' && (v.nodes || v.groups || v.edges || v.views);
  } catch {
    return false;
  }
}


/** The file as it is on disk now (not the cached copy). */
export async function diskText(ws: Workspace, path: string): Promise<string | undefined> {
  const h = ws.files.get(path)?.handle;
  if (!h) return undefined;
  try {
    return await (await h.getFile()).text();
  } catch {
    return undefined;
  }
}

/** Save a document that has no file yet: a save dialog where supported, else a download. */
export async function saveAs(name: string, text: string, startIn?: FileSystemDirectoryHandle): Promise<{ handle: FileSystemFileHandle; name: string } | undefined> {
  try {
    const handle = await (window as unknown as { showSaveFilePicker(o: object): Promise<FileSystemFileHandle> }).showSaveFilePicker({
      suggestedName: name,
      ...(startIn ? { startIn } : {}),
      types: [{ description: t('Linework diagram'), accept: { 'text/yaml': ['.yaml', '.yml'] } }],
    });
    await write(handle, text);
    return { handle, name: handle.name };
  } catch (e) {
    if ((e as Error).name === 'AbortError') return undefined;
    throw e;
  }
}

export async function saveFile(handle: FileSystemFileHandle, text: string) {
  await write(handle, text);
}

// The last folder survives a reload in IndexedDB; the browser asks again for permission on reopen.

const DB = 'linework';

function idb(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('handles');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}

async function remember(dir: FileSystemDirectoryHandle) {
  try {
    const db = await idb();
    db.transaction('handles', 'readwrite').objectStore('handles').put(dir, 'folder');
  } catch {
    /* private window: nothing to remember */
  }
}

export async function lastFolder(): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    const db = await idb();
    return await new Promise((ok) => {
      const r = db.transaction('handles').objectStore('handles').get('folder');
      r.onsuccess = () => ok(r.result as FileSystemDirectoryHandle | undefined);
      r.onerror = () => ok(undefined);
    });
  } catch {
    return undefined;
  }
}

/** Asks again for access to a remembered folder; needs a click. */
export async function reopen(dir: FileSystemDirectoryHandle): Promise<Workspace | undefined> {
  const h = dir as unknown as { requestPermission(o: object): Promise<PermissionState> };
  if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') return undefined;
  return scan(dir);
}
