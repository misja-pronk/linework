// The editor opened by `linework serve`: the folder comes from the server, and so do the live calls of
// the user's AI agent (get_context, propose) and word of files changed on disk. The folder is given
// to files.ts as directory and file handles that read and write over HTTP, so opening, saving and
// rescanning work as they do with a folder picked in the browser.
import type { FromEditor, ToEditor } from '@linework/core';

export interface Served {
  token: string;
  folder: string;
}

/** Set when the page came from linework serve (it puts the token in a <meta>). */
export function served(): Served | undefined {
  if (typeof document === 'undefined') return undefined;
  const m = document.querySelector<HTMLMetaElement>('meta[name="linework-serve"]');
  return m?.content ? { token: m.content, folder: m.dataset.folder || 'folder' } : undefined;
}

const api = (s: Served, p: string, init: RequestInit = {}) => fetch(p, { ...init, headers: { ...init.headers, 'x-linework-token': s.token } });
const fileUrl = (path: string) => `api/file?path=${encodeURIComponent(path)}`;

type Entry = { path: string; size: number; mtime: number };

class ServedFile {
  readonly kind = 'file';
  constructor(
    private readonly s: Served,
    readonly path: string,
    readonly name: string,
  ) {}
  async getFile() {
    const r = await api(this.s, fileUrl(this.path));
    if (!r.ok) throw new DOMException(`${this.path}: ${r.status}`, 'NotFoundError');
    const text = await r.text();
    return { name: this.name, size: new Blob([text]).size, lastModified: Number(r.headers.get('x-mtime')) || 0, text: async () => text };
  }
  async createWritable() {
    let out = '';
    return {
      write: async (t: string) => void (out += t),
      close: async () => {
        const r = await api(this.s, fileUrl(this.path), { method: 'PUT', body: out });
        if (!r.ok) throw new Error(`${this.path}: ${r.status}`);
      },
    };
  }
}

class ServedDir {
  readonly kind = 'directory';
  constructor(
    private readonly s: Served,
    readonly name: string,
    private readonly prefix: string,
    private files: Entry[],
  ) {}
  async *entries(): AsyncIterable<[string, ServedFile | ServedDir]> {
    // Listed fresh at the top, so a rescan sees what was added on disk.
    if (!this.prefix) this.files = await list(this.s);
    const dirs = new Set<string>();
    for (const f of this.files) {
      if (!f.path.startsWith(this.prefix)) continue;
      const rest = f.path.slice(this.prefix.length);
      const slash = rest.indexOf('/');
      if (slash < 0) yield [rest, new ServedFile(this.s, f.path, rest)];
      else if (!dirs.has(rest.slice(0, slash))) {
        dirs.add(rest.slice(0, slash));
        yield [rest.slice(0, slash), new ServedDir(this.s, rest.slice(0, slash), `${this.prefix}${rest.slice(0, slash)}/`, this.files)];
      }
    }
  }
  async getDirectoryHandle(name: string) {
    return new ServedDir(this.s, name, `${this.prefix}${name}/`, this.files);
  }
  async getFileHandle(name: string, o: { create?: boolean } = {}) {
    const path = `${this.prefix}${name}`;
    if (!o.create && !this.files.some((f) => f.path === path)) throw new DOMException(path, 'NotFoundError');
    return new ServedFile(this.s, path, name);
  }
  async removeEntry(name: string) {
    await api(this.s, fileUrl(`${this.prefix}${name}`), { method: 'DELETE' });
  }
  async resolve() {
    return null;
  }
}

async function list(s: Served): Promise<Entry[]> {
  const r = await api(s, 'api/files');
  if (!r.ok) throw new Error(`linework serve: ${r.status}`);
  return ((await r.json()) as { files: Entry[] }).files;
}

/** The folder linework serve has open, as a directory handle for files.ts. */
export async function servedFolder(s: Served): Promise<FileSystemDirectoryHandle> {
  return new ServedDir(s, s.folder, '', await list(s)) as unknown as FileSystemDirectoryHandle;
}

export interface Channel {
  reply(m: FromEditor): void;
  close(): void;
}

/** Calls and changes from the server; this tab says it is the one in use when it gets focus. */
export function listen(s: Served, on: (m: ToEditor) => void, onState?: (connected: boolean) => void): Channel {
  const events = new EventSource(`api/events?token=${encodeURIComponent(s.token)}`);
  let editor = 0;
  const active = () => editor && void api(s, 'api/active', { method: 'POST', body: JSON.stringify({ editor }) }).catch(() => undefined);
  events.addEventListener('hello', (e) => {
    editor = (JSON.parse((e as MessageEvent).data) as { editor: number }).editor;
    onState?.(true);
    if (document.hasFocus()) active();
  });
  events.onmessage = (e) => on(JSON.parse(e.data) as ToEditor);
  events.onerror = () => onState?.(false);
  window.addEventListener('focus', active);
  return {
    reply: (m) => void api(s, 'api/reply', { method: 'POST', body: JSON.stringify(m) }).catch(() => undefined),
    close: () => {
      events.close();
      window.removeEventListener('focus', active);
    },
  };
}
