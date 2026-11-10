// Reading a git repository straight from its .git folder, for the browser that has no git binary:
// HEAD and branches (loose and packed refs), commits, trees and blobs, loose (zlib) and in packfiles
// (version 2 index, with both kinds of delta). Read-only, no dependency: inflating is the platform's
// DecompressionStream. Enough to show a file as it was at HEAD and at the commits that changed it.
// Not handled, and said so: SHA-256 repositories, and a .git that is a file pointing elsewhere
// (a worktree or submodule), which a folder picked in the browser cannot reach.
import { t } from '../i18n/index.ts';

/** What a repository is read through: files of the .git folder by path ("objects/pack/x.idx"). */
export interface GitFiles {
  /** The file as a Blob (sliced lazily, so a packfile of hundreds of MB is not read whole); undefined when missing. */
  file(path: string): Promise<Blob | undefined>;
  /** Names of the entries in a folder; empty when missing. */
  list(path: string): Promise<string[]>;
}

export type ObjectType = 'commit' | 'tree' | 'blob' | 'tag';

export interface Commit {
  oid: string;
  tree: string;
  parents: string[];
  author: string;
  /** Seconds since 1970, as git stores it. */
  time: number;
  message: string;
}

/** A version of one file: the blob, and the newest commit in the walk that has it. */
export interface FileVersion {
  commit: Commit;
  blob: string;
}

const TYPES: Record<number, ObjectType> = { 1: 'commit', 2: 'tree', 3: 'blob', 4: 'tag' };
const utf8 = new TextDecoder();
const hex = (b: Uint8Array, at = 0, n = 20) => {
  let s = '';
  for (let i = at; i < at + n; i++) s += b[i]!.toString(16).padStart(2, '0');
  return s;
};

/** Inflates a whole zlib stream (git's objects are zlib, "deflate" in the Compression Streams API). */
export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface Pack {
  name: string;
  pack: Blob;
  /** Object ids, sorted, 20 bytes each. */
  ids: Uint8Array;
  fanout: Uint32Array;
  offsets: number[];
  /** Every object's start in the pack, sorted: an object ends where the next begins. */
  starts: Float64Array;
}

/** A pack's index (version 2): ids, and where each object starts in the pack. */
function readIndex(name: string, idx: Uint8Array, pack: Blob): Pack {
  const view = new DataView(idx.buffer, idx.byteOffset, idx.byteLength);
  if (view.getUint32(0) !== 0xff744f63 || view.getUint32(4) !== 2) throw new Error(`${name}.idx is not a version 2 pack index`);
  const fanout = new Uint32Array(256);
  for (let i = 0; i < 256; i++) fanout[i] = view.getUint32(8 + i * 4);
  const n = fanout[255]!;
  const idsAt = 8 + 256 * 4;
  const ids = idx.subarray(idsAt, idsAt + n * 20);
  const offAt = idsAt + n * 20 + n * 4;
  const bigAt = offAt + n * 4;
  const offsets: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = view.getUint32(offAt + i * 4);
    // The top bit says the offset is in the table of 8-byte offsets (packs over 2 GB).
    offsets[i] = o & 0x80000000 ? Number(view.getBigUint64(bigAt + (o & 0x7fffffff) * 8)) : o;
  }
  const starts = Float64Array.from(offsets).sort();
  return { name, pack, ids, fanout, offsets, starts };
}

function find(p: Pack, oid: Uint8Array): number {
  let lo = oid[0] ? p.fanout[oid[0] - 1]! : 0;
  let hi = p.fanout[oid[0]!]! - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    let c = 0;
    for (let i = 0; i < 20 && !c; i++) c = p.ids[mid * 20 + i]! - oid[i]!;
    if (!c) return mid;
    if (c < 0) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

const fromHex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));

/** Applies a git delta to its base. */
export function applyDelta(base: Uint8Array, delta: Uint8Array): Uint8Array {
  let at = 0;
  const varint = () => {
    let v = 0;
    let shift = 0;
    let b: number;
    do {
      b = delta[at++]!;
      v += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80);
    return v;
  };
  if (varint() !== base.length) throw new Error('A delta does not fit its base');
  const out = new Uint8Array(varint());
  let w = 0;
  while (at < delta.length) {
    const op = delta[at++]!;
    if (op & 0x80) {
      let off = 0;
      let size = 0;
      for (let i = 0; i < 4; i++) if (op & (1 << i)) off |= delta[at++]! << (8 * i);
      for (let i = 0; i < 3; i++) if (op & (0x10 << i)) size |= delta[at++]! << (8 * i);
      off >>>= 0;
      if (!size) size = 0x10000;
      out.set(base.subarray(off, off + size), w);
      w += size;
    } else if (op) {
      out.set(delta.subarray(at, at + op), w);
      w += op;
      at += op;
    } else throw new Error('A delta has an unknown instruction');
  }
  if (w !== out.length) throw new Error('A delta came out the wrong size');
  return out;
}

export class Repo {
  private packs: Pack[] = [];
  private cache = new Map<string, { type: ObjectType; data: Uint8Array }>();

  private constructor(private files: GitFiles) {}

  /** A repository from its .git folder; throws with what is wrong when it cannot be read. */
  static async open(files: GitFiles): Promise<Repo> {
    const config = await text(files, 'config');
    if (config === undefined || (await files.file('HEAD')) === undefined) throw new Error(t('No git repository here'));
    if (/objectformat\s*=\s*sha256/i.test(config)) throw new Error(t('This repository uses SHA-256 object names, which the browser reader does not read'));
    const repo = new Repo(files);
    for (const f of (await files.list('objects/pack')).filter((f) => f.endsWith('.idx'))) {
      const name = f.slice(0, -4);
      const [idx, pack] = [await files.file(`objects/pack/${f}`), await files.file(`objects/pack/${name}.pack`)];
      if (idx && pack) repo.packs.push(readIndex(name, new Uint8Array(await idx.arrayBuffer()), pack));
    }
    return repo;
  }

  /** A ref or a commit: HEAD, a branch or tag name, refs/…, or a full commit id. */
  async resolve(ref: string, depth = 0): Promise<string | undefined> {
    if (/^[0-9a-f]{40}$/.test(ref)) return ref;
    if (depth > 8) return undefined;
    const names = ref === 'HEAD' || ref.startsWith('refs/') ? [ref] : [`refs/heads/${ref}`, `refs/tags/${ref}`, `refs/remotes/${ref}`, ref];
    for (const name of names) {
      const loose = (await text(this.files, name))?.trim();
      if (loose?.startsWith('ref: ')) return this.resolve(loose.slice(5), depth + 1);
      if (loose && /^[0-9a-f]{40}$/.test(loose)) return this.peel(loose);
      const packed = await this.packedRefs();
      const hit = packed.get(name);
      if (hit) return this.peel(hit);
    }
    return undefined;
  }

  /** The branch HEAD is on ("main"), or undefined when it is detached. */
  async branch(): Promise<string | undefined> {
    const head = (await text(this.files, 'HEAD'))?.trim();
    return head?.startsWith('ref: refs/heads/') ? head.slice(16) : undefined;
  }

  private refs?: Map<string, string>;
  private async packedRefs(): Promise<Map<string, string>> {
    if (this.refs) return this.refs;
    const refs = new Map<string, string>();
    for (const line of ((await text(this.files, 'packed-refs')) ?? '').split('\n')) {
      const m = /^([0-9a-f]{40}) (\S+)$/.exec(line);
      if (m) refs.set(m[2]!, m[1]!);
    }
    return (this.refs = refs);
  }

  /** An annotated tag points at a tag object: on to the commit. */
  private async peel(oid: string): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const o = await this.object(oid);
      if (o.type !== 'tag') return oid;
      oid = /^object ([0-9a-f]{40})/.exec(utf8.decode(o.data))![1]!;
    }
    return oid;
  }

  /** Any object by id. */
  async object(oid: string): Promise<{ type: ObjectType; data: Uint8Array }> {
    const known = this.cache.get(oid);
    if (known) return known;
    const loose = await this.files.file(`objects/${oid.slice(0, 2)}/${oid.slice(2)}`);
    let o: { type: ObjectType; data: Uint8Array } | undefined;
    if (loose) {
      const raw = await inflate(new Uint8Array(await loose.arrayBuffer()));
      const nul = raw.indexOf(0);
      const [type] = utf8.decode(raw.subarray(0, nul)).split(' ');
      o = { type: type as ObjectType, data: raw.subarray(nul + 1) };
    } else {
      const id = fromHex(oid);
      for (const p of this.packs) {
        const i = find(p, id);
        if (i >= 0) {
          o = await this.packed(p, p.offsets[i]!);
          break;
        }
      }
    }
    if (!o) throw new Error(t('Object {oid} is not in the repository (a shallow clone?)', { oid: oid.slice(0, 7) }));
    // Trees and commits are read again and again while walking history; blobs are not kept.
    if (o.type !== 'blob') {
      if (this.cache.size > 4000) this.cache.clear();
      this.cache.set(oid, o);
    }
    return o;
  }

  private byOffset = new Map<string, { type: ObjectType; data: Uint8Array }>();

  /** An object in a pack at an offset, deltas applied. */
  private async packed(p: Pack, offset: number, depth = 0): Promise<{ type: ObjectType; data: Uint8Array }> {
    const key = `${p.name}:${offset}`;
    const known = this.byOffset.get(key);
    if (known) return known;
    if (depth > 64) throw new Error('A delta chain is too long');
    // Where the next object starts is where this one's compressed data ends (the last ends at the checksum).
    let lo = 0;
    let hi = p.starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (p.starts[mid]! <= offset) lo = mid + 1;
      else hi = mid;
    }
    const end = lo < p.starts.length ? p.starts[lo]! : p.pack.size - 20;
    const bytes = new Uint8Array(await p.pack.slice(offset, end).arrayBuffer());
    let at = 0;
    let c = bytes[at++]!;
    const kind = (c >> 4) & 7;
    while (c & 0x80) c = bytes[at++]!;
    let o: { type: ObjectType; data: Uint8Array };
    if (kind === 6) {
      c = bytes[at++]!;
      let back = c & 0x7f;
      while (c & 0x80) {
        c = bytes[at++]!;
        back = (back + 1) * 128 + (c & 0x7f);
      }
      const base = await this.packed(p, offset - back, depth + 1);
      o = { type: base.type, data: applyDelta(base.data, await inflate(bytes.subarray(at))) };
    } else if (kind === 7) {
      const base = await this.object(hex(bytes, at));
      o = { type: base.type, data: applyDelta(base.data, await inflate(bytes.subarray(at + 20))) };
    } else if (TYPES[kind]) o = { type: TYPES[kind]!, data: await inflate(bytes.subarray(at)) };
    else throw new Error(`Unknown object type ${kind} in ${p.name}`);
    // Bases of deltas are what gets read twice; keep a few.
    if (o.type !== 'blob' || depth > 0) {
      if (this.byOffset.size > 2000) this.byOffset.clear();
      this.byOffset.set(key, o);
    }
    return o;
  }

  async commit(oid: string): Promise<Commit> {
    const o = await this.object(oid);
    if (o.type !== 'commit') throw new Error(`${oid.slice(0, 7)} is a ${o.type}, not a commit`);
    const s = utf8.decode(o.data);
    const split = s.indexOf('\n\n');
    const head = s.slice(0, split < 0 ? undefined : split);
    const parents = [...head.matchAll(/^parent ([0-9a-f]{40})$/gm)].map((m) => m[1]!);
    const author = /^author (.*) <[^>]*> (\d+) [+-]\d{4}$/m.exec(head);
    return { oid, tree: /^tree ([0-9a-f]{40})$/m.exec(head)![1]!, parents, author: author?.[1] ?? '', time: Number(author?.[2] ?? 0), message: split < 0 ? '' : s.slice(split + 2) };
  }

  /** A tree's entries: name → id (and whether it is a folder). */
  async tree(oid: string): Promise<Map<string, { oid: string; dir: boolean }>> {
    const { type, data } = await this.object(oid);
    if (type !== 'tree') throw new Error(`${oid.slice(0, 7)} is not a tree`);
    const out = new Map<string, { oid: string; dir: boolean }>();
    let at = 0;
    while (at < data.length) {
      const space = data.indexOf(0x20, at);
      const nul = data.indexOf(0, space);
      const mode = utf8.decode(data.subarray(at, space));
      out.set(utf8.decode(data.subarray(space + 1, nul)), { oid: hex(data, nul + 1), dir: mode === '40000' });
      at = nul + 21;
    }
    return out;
  }

  /** The blob id of a path ("docs/shop.yaml") in a commit; undefined when it is not there. */
  async blobAt(commit: string, path: string): Promise<string | undefined> {
    let tree = (await this.commit(commit)).tree;
    const parts = path.split('/').filter(Boolean);
    for (const [i, part] of parts.entries()) {
      const e = (await this.tree(tree)).get(part);
      if (!e || e.dir !== i < parts.length - 1) return undefined;
      if (!e.dir) return e.oid;
      tree = e.oid;
    }
    return undefined;
  }

  /** A file's bytes at a commit (or a ref); undefined when it is not there. */
  async fileAt(ref: string, path: string): Promise<Uint8Array | undefined> {
    const commit = await this.resolve(ref);
    const blob = commit && (await this.blobAt(commit, path));
    return blob ? (await this.object(blob)).data : undefined;
  }

  /**
   * The versions of a file, newest first: each blob it had, with the newest commit that has it, along
   * the first parents from HEAD (as `git log --first-parent -- path` sees it). At most `limit`
   * versions, looking back at most `depth` commits.
   */
  async history(path: string, { from = 'HEAD', limit = 12, depth = 400 } = {}): Promise<FileVersion[]> {
    const out: FileVersion[] = [];
    let oid = await this.resolve(from);
    let last: string | undefined;
    for (let n = 0; oid && n < depth && out.length <= limit; n++) {
      let c: Commit;
      try {
        c = await this.commit(oid);
      } catch {
        break; // a shallow clone ends here
      }
      const blob = await this.blobAt(oid, path);
      // A version is told by the commit that made it: the oldest commit with this blob in a run.
      if (blob !== last) {
        if (blob) out.push({ commit: c, blob });
        last = blob;
        if (!blob && out.length) break; // the file did not exist before this
      } else if (blob && out.length) out[out.length - 1] = { commit: c, blob };
      oid = c.parents[0];
    }
    return out.slice(0, limit);
  }
}

async function text(files: GitFiles, path: string): Promise<string | undefined> {
  const f = await files.file(path);
  return f ? f.text() : undefined;
}

/** A .git folder of a folder picked in the browser; undefined when it has none it can read, with why. */
export async function gitFilesIn(dir: FileSystemDirectoryHandle): Promise<{ files?: GitFiles; why?: string }> {
  let git: FileSystemDirectoryHandle;
  try {
    git = await dir.getDirectoryHandle('.git');
  } catch {
    try {
      await dir.getFileHandle('.git');
      return { why: t('This folder is a git worktree or submodule: its repository lives elsewhere. Open the main checkout to compare with commits.') };
    } catch {
      return { why: t('The open folder is not the top of a git repository') };
    }
  }
  const walk = async (path: string): Promise<FileSystemDirectoryHandle | undefined> => {
    let d = git;
    try {
      for (const seg of path.split('/').filter(Boolean)) d = await d.getDirectoryHandle(seg);
      return d;
    } catch {
      return undefined;
    }
  };
  const files: GitFiles = {
    file: async (path) => {
      const parts = path.split('/');
      const d = await walk(parts.slice(0, -1).join('/'));
      try {
        return d ? await (await d.getFileHandle(parts.at(-1)!)).getFile() : undefined;
      } catch {
        return undefined;
      }
    },
    list: async (path) => {
      const d = await walk(path);
      const out: string[] = [];
      if (d) for await (const name of (d as unknown as { keys(): AsyncIterable<string> }).keys()) out.push(name);
      return out;
    },
  };
  return { files };
}
