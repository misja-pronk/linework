// Snapshots: named copies of a diagram to compare with later ("before the review"). Always kept in this
// browser (IndexedDB, per document); in an open folder also written next to the diagram as
// <name>.snapshots/<label>.yaml (and <label>.layout.json when it has pins), plain files that git can
// keep and `carto diff --snapshot <label>` reads. A snapshot in the folder wins over the browser's copy.
import type { LayoutSidecar } from '@cartography/core';

export interface Snapshot {
  label: string;
  text: string;
  pins?: LayoutSidecar;
  /** When it was taken, ms since 1970; for a file in the folder, when it was read. */
  at: number;
  /** Where it is in the open folder, when it is there. */
  path?: string;
}

/** Where a snapshot is kept for this browser: anything that stores a list per document. */
export interface SnapshotBackend {
  get(doc: string): Promise<Snapshot[]>;
  put(doc: string, list: Snapshot[]): Promise<void>;
}

/** A label as a file name: letters, digits, dot, dash and underscore; the rest becomes a dash. */
export function slug(label: string): string {
  return (
    label
      .trim()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w.-]+/g, '-')
      .replace(/^[-.]+|-+$/g, '')
      .slice(0, 80) || 'snapshot'
  );
}

/** Two labels name the same snapshot when their files would (folders on a Mac ignore case). */
const key = (label: string) => slug(label).toLowerCase();

/** The folder of a diagram's snapshots: shop.yaml → shop.snapshots/ (next to it). */
export const snapshotDir = (diagram: string) => diagram.replace(/\.ya?ml$/i, '') + '.snapshots/';
export const snapshotPath = (diagram: string, label: string) => `${snapshotDir(diagram)}${slug(label)}.yaml`;
/** A path inside some diagram's snapshots folder: not a diagram of its own in the file list. */
export const isSnapshotPath = (path: string) => /(^|\/)[^/]+\.snapshots\//.test(path);

/** Snapshots written in the folder, read from the folder's files (path → text). */
export function folderSnapshots(diagram: string, files: Map<string, { text: string }>): Snapshot[] {
  const dir = snapshotDir(diagram);
  const out: Snapshot[] = [];
  for (const [path, f] of files) {
    if (!path.startsWith(dir) || !/\.ya?ml$/i.test(path) || path.slice(dir.length).includes('/')) continue;
    const label = path.slice(dir.length).replace(/\.ya?ml$/i, '');
    let pins: LayoutSidecar | undefined;
    try {
      const side = files.get(path.replace(/\.ya?ml$/i, '') + '.layout.json');
      pins = side ? (JSON.parse(side.text) as LayoutSidecar) : undefined;
    } catch {
      pins = undefined;
    }
    out.push({ label, text: f.text, ...(pins ? { pins } : {}), at: 0, path });
  }
  return out;
}

/** Both lists as one, newest first: a snapshot in the folder stands for the browser's copy of the same label. */
export function mergeSnapshots(browser: Snapshot[], folder: Snapshot[]): Snapshot[] {
  const inFolder = new Map(folder.map((s) => [key(s.label), s]));
  const kept = browser.map((s) => {
    const f = inFolder.get(key(s.label));
    if (!f) return s;
    inFolder.delete(key(s.label));
    return { ...f, label: s.label, at: s.at };
  });
  return [...kept, ...inFolder.values()].sort((a, b) => b.at - a.at || a.label.localeCompare(b.label));
}

/** A label not used yet: "Snapshot 3", or the asked one with " (2)". */
export function freeLabel(list: Snapshot[], wanted?: string): string {
  const used = new Set(list.map((s) => key(s.label)));
  if (wanted?.trim() && !used.has(key(wanted))) return wanted.trim();
  const base = wanted?.trim() || 'Snapshot';
  for (let n = wanted?.trim() ? 2 : list.length + 1; ; n++) {
    const l = wanted?.trim() ? `${base} (${n})` : `${base} ${n}`;
    if (!used.has(key(l))) return l;
  }
}

/** Takes a snapshot in the browser's store; the same label again replaces it. Returns the list after. */
export async function takeSnapshot(backend: SnapshotBackend, doc: string, snap: Snapshot): Promise<Snapshot[]> {
  const list = (await backend.get(doc)).filter((s) => key(s.label) !== key(snap.label));
  const next = [snap, ...list].slice(0, 50);
  await backend.put(doc, next);
  return next;
}

export async function dropSnapshot(backend: SnapshotBackend, doc: string, label: string): Promise<Snapshot[]> {
  const next = (await backend.get(doc)).filter((s) => key(s.label) !== key(label));
  await backend.put(doc, next);
  return next;
}

/** In memory: for tests, and when the browser keeps nothing (a private window). */
export function memoryBackend(): SnapshotBackend {
  const m = new Map<string, Snapshot[]>();
  return { get: async (d) => [...(m.get(d) ?? [])], put: async (d, l) => void m.set(d, [...l]) };
}

/** IndexedDB, a database of its own; falls back to memory where IndexedDB is blocked. */
export function browserBackend(): SnapshotBackend {
  const fallback = memoryBackend();
  let db: Promise<IDBDatabase> | undefined;
  const open = () =>
    (db ??= new Promise((ok, fail) => {
      const r = indexedDB.open('cartography-snapshots', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('snapshots');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    }));
  const run = <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) =>
    open().then(
      (d) =>
        new Promise<T>((ok, fail) => {
          const r = f(d.transaction('snapshots', mode).objectStore('snapshots'));
          r.onsuccess = () => ok(r.result);
          r.onerror = () => fail(r.error);
        }),
    );
  return {
    get: async (doc) => {
      try {
        return ((await run('readonly', (s) => s.get(doc))) as Snapshot[] | undefined) ?? [];
      } catch {
        return fallback.get(doc);
      }
    },
    put: async (doc, list) => {
      try {
        await run('readwrite', (s) => s.put(list, doc));
      } catch {
        await fallback.put(doc, list);
      }
    },
  };
}
