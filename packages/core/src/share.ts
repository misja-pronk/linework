// A share link: the diagram itself, deflated and base64url-encoded, in the URL's #fragment. A browser
// never sends the fragment to a server, so opening the link reads the diagram from the link alone.
// The same code runs in the web app and in `carto share` (CompressionStream is in both).
import type { LayoutSidecar } from './model.ts';
import { parseSidecar } from './sidecar.ts';

export interface SharedDiagram {
  yaml: string;
  /** File name it had, so "Open in editor" can keep it. */
  name?: string;
  /** Hand-placed positions, so the link looks as the editor did. */
  layout?: LayoutSidecar;
  /** The theme picked in the editor, when it was not the diagram's own. */
  theme?: string;
}

/** The fragment key: #share=… */
export const SHARE_KEY = 'share';
/** Longest link we hand out: chat tools, mail clients and older browsers cut longer ones. */
export const SHARE_LIMIT = 32_000;
/** Most a link may unpack to: a few kB of deflate can hold gigabytes of nothing. */
export const SHARE_UNPACKED_LIMIT = 1_000_000;

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Inflated piece by piece; undefined as soon as it grows past `limit` bytes. */
async function inflate(bytes: Uint8Array, limit: number): Promise<Uint8Array | undefined> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) return (await reader.cancel().catch(() => {}), undefined);
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) (out.set(p, at), (at += p.length));
  return out;
}

function toBase64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** The diagram as the fragment's value. */
export async function encodeShare(d: SharedDiagram): Promise<string> {
  const body = { v: 1, y: d.yaml, ...(d.name ? { n: d.name } : {}), ...(d.layout ? { l: d.layout } : {}), ...(d.theme ? { t: d.theme } : {}) };
  return toBase64url(await pipe(new TextEncoder().encode(JSON.stringify(body)), new CompressionStream('deflate-raw')));
}

/** The diagram back from a fragment's value; undefined when it is not one, or unpacks to more than `limit` bytes. A layout keeps only what can be read of it. */
export async function decodeShare(value: string, limit = SHARE_UNPACKED_LIMIT): Promise<SharedDiagram | undefined> {
  try {
    const bytes = await inflate(fromBase64url(value), limit);
    if (!bytes) return undefined;
    const json = JSON.parse(new TextDecoder().decode(bytes));
    if (!json || typeof json.y !== 'string') return undefined;
    const layout = json.l && typeof json.l === 'object' ? parseSidecar(json.l).sidecar : undefined;
    return { yaml: json.y, ...(typeof json.n === 'string' ? { name: json.n } : {}), ...(layout ? { layout } : {}), ...(typeof json.t === 'string' ? { theme: json.t } : {}) };
  } catch {
    return undefined;
  }
}

/** The whole link: the base URL (any fragment it had dropped) with #share=… */
export async function shareLink(d: SharedDiagram, base: string): Promise<string> {
  return `${base.replace(/#.*$/, '')}#${SHARE_KEY}=${await encodeShare(d)}`;
}

/** The value of #share=… in a location hash, if there is one. */
export function shareValue(hash: string): string | undefined {
  const m = new RegExp(`^#?${SHARE_KEY}=([A-Za-z0-9_-]+)$`).exec(hash);
  return m?.[1];
}
