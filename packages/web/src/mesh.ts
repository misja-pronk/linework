// Data product and data contract files (ODPS, ODCS), picked, dropped on the page or found in the open
// folder, become one data mesh map, as `carto import <folder>` makes it. Nothing leaves the browser.
import { importDataMesh, isDataMeshFile, type ImportedMesh, type MeshFile } from '@cartography/import';

const TEXT = /\.(ya?ml|json)$/i;
/** What a drop reads: these, and drawings from draw.io, Excalidraw and Mermaid, which the editor imports. */
const READ = /\.(ya?ml|json|drawio|dio|xml|excalidraw|mmd|mermaid)$/i;
const NOTE = /\.layout\.json$/i;
const MAX_FILES = 400;
const MAX_BYTES = 2_000_000;

export interface Mesh extends ImportedMesh {
  /** The files it was made from by path, seen from the diagram: the detailed view reads the contracts there. */
  files: Record<string, string>;
  /** "6 data products, 4 contracts", for the message that says what was opened. */
  summary: string;
}

const count = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;

/** The mesh map of these files; nothing when none of them is a data product or a data contract. */
export function meshFrom(files: MeshFile[], options: { title?: string; existing?: string } = {}): Mesh | undefined {
  const data = files.filter((f) => TEXT.test(f.path) && !NOTE.test(f.path));
  if (!hasMesh(data)) return undefined;
  const r = importDataMesh(data, options);
  const kept = data.filter((f) => !r.skipped.includes(f.path));
  return { ...r, files: Object.fromEntries(kept.map((f) => [f.path, f.text])), summary: `${count(r.products, 'data product')}, ${count(r.contracts, 'contract')}` };
}

/** Whether any of these files is a data product or a data contract. */
export const hasMesh = (files: MeshFile[]): boolean => files.some((f) => TEXT.test(f.path) && !NOTE.test(f.path) && isDataMeshFile(f.text));

/** A synchronous loader over files kept with the document, by the path the diagram names them with. */
export function memoryLoader(files: Record<string, string>): (file: string) => string {
  return (file) => {
    const parts: string[] = [];
    for (const seg of file.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg && seg !== '.') parts.push(seg);
    }
    const text = files[parts.join('/')];
    if (text == null) throw new Error(`No file ${file}`);
    return text;
  };
}

/** The text files of a drop: files as they are, folders walked. Called in the drop event: its items are gone once that is over. */
export async function dropped(data: DataTransfer): Promise<MeshFile[]> {
  const items = [...data.items].filter((i) => i.kind === 'file').map((i) => i.webkitGetAsEntry?.() ?? i.getAsFile());
  const out: MeshFile[] = [];
  const add = async (path: string, f: File) => {
    if (READ.test(f.name) && f.size <= MAX_BYTES && out.length < MAX_FILES) out.push({ path, text: await f.text() });
  };
  const walk = async (e: FileSystemEntry, prefix: string, depth: number): Promise<void> => {
    if (e.isFile) return add(prefix + e.name, await new Promise<File>((ok, fail) => (e as FileSystemFileEntry).file(ok, fail)));
    if (depth > 6 || e.name.startsWith('.') || e.name === 'node_modules') return;
    const reader = (e as FileSystemDirectoryEntry).createReader();
    // A folder is read a batch at a time, until a batch comes back empty.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail));
      if (!batch.length) break;
      for (const c of batch) await walk(c, `${prefix}${e.name}/`, depth + 1);
    }
  };
  for (const i of items) {
    if (i instanceof File) await add(i.name, i);
    else if (i) await walk(i, '', 0);
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** The name of the one folder a drop was, if it was one: the diagram is named after it. */
export const folderOf = (files: MeshFile[]): string | undefined => {
  const tops = new Set(files.map((f) => (f.path.includes('/') ? f.path.split('/')[0]! : '')));
  return tops.size === 1 && !tops.has('') ? [...tops][0] : undefined;
};
