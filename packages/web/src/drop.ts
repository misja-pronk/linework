// Files dropped on the page: the diagrams among them, read in the browser. Nothing leaves it.

/** What a drop reads: diagrams. */
const READ = /\.ya?ml$/i;
const MAX_FILES = 400;
const MAX_BYTES = 2_000_000;

export interface DroppedFile {
  path: string;
  text: string;
}

/** The text files of a drop: files as they are, folders walked. Called in the drop event: its items are gone once that is over. */
export async function dropped(data: DataTransfer): Promise<DroppedFile[]> {
  const items = [...data.items].filter((i) => i.kind === 'file').map((i) => i.webkitGetAsEntry?.() ?? i.getAsFile());
  const out: DroppedFile[] = [];
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
