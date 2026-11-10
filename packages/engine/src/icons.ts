// BYO official icons: which kinds a diagram uses, which SVG file each maps to (packs, then the
// diagram's own `icons:` entries), read only those files and hand them to render as data URIs.
import { parse } from 'yaml';
import type { Graph, Path } from '@cartography/core';
import { vendorsFor, type IconPackFile } from '@cartography/icons';
import { joinPath } from '@cartography/theme';
import type { RenderOptions } from './index.ts';

export type { IconPackFile };

const isPath = (s: string) => /\.(ya?ml|json)$/i.test(s) || s.includes('/');
const toBase64 = (s: string) => {
  const b = new TextEncoder().encode(s);
  let out = '';
  for (let i = 0; i < b.length; i += 0x8000) out += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(out);
};

/** The kind an entry was written with: `id: kind` or `id: { kind: … }`. */
function kindAt(data: Record<string, unknown>, path: Path): string | undefined {
  let v: unknown = data;
  for (const k of path) v = v && typeof v === 'object' ? (v as Record<string | number, unknown>)[k] : undefined;
  if (typeof v === 'string') return v.split(/\s/)[0];
  return v && typeof v === 'object' && typeof (v as { kind?: unknown }).kind === 'string' ? (v as { kind: string }).kind : undefined;
}

/**
 * `icons: official` uses the imported official set of each vendor the diagram draws (Azure for an
 * azure diagram; AWS and Google Cloud for a cloud diagram, by the shapes in it; Kubernetes);
 * `icons: lucide` keeps our line icons whatever packs are around. An override (--icons, the editor's
 * toggle) wins over what the diagram says.
 */
export type IconMode = 'official' | 'lucide';

export function resolveIcons(graph: Graph, data: Record<string, unknown>, ref: unknown, opts: RenderOptions, warn: (path: Path, message: string) => void, typeId?: string): RenderOptions['images'] {
  const written = ref === 'official' || ref === 'lucide' ? (ref as IconMode) : undefined;
  const mode = opts.iconsOverride ?? written;
  if (mode === 'lucide') return undefined;
  if (written) ref = undefined;
  // The vendor sets of the diagram's type (Azure; AWS and Google Cloud; Kubernetes).
  const official = mode === 'official' && typeId ? vendorsFor(typeId) : [];
  if (ref == null && !opts.packs?.length && !opts.icons && !official.length) return undefined;
  const load = opts.load;
  // kind → how to get its SVG markup
  const files = new Map<string, () => string>();
  // The same per pack, for diagrams that say whose icon a shape wants (a cloud diagram mixing vendors).
  const packs = new Map<string, Map<string, () => string>>();
  // Kinds mapped by hand, in the diagram or by the caller: these win over any pack.
  const byHand = new Set<string>();
  // In `icons: official` the first vendor's icon wins for a kind every vendor has (users, a server):
  // one look for the people in a diagram, not whichever set came last.
  let keep = false;
  const fromPack = (p: IconPackFile, base: string, name: string) => {
    const root = joinPath(base, p.root || '.');
    const own = packs.get(name) ?? new Map<string, () => string>();
    packs.set(name, own);
    for (const [kind, rel] of Object.entries(p.icons ?? {})) {
      const get = () => load!(joinPath(root + '/', rel));
      if (!keep || !files.has(kind)) files.set(kind, get);
      own.set(kind, get);
    }
  };
  const fromMarkup = (icons: Record<string, string>, name: string) => {
    const own = packs.get(name) ?? new Map<string, () => string>();
    packs.set(name, own);
    for (const [kind, svg] of Object.entries(icons)) {
      if (!keep || !files.has(kind)) files.set(kind, () => svg);
      own.set(kind, () => svg);
    }
  };
  const usePack = (name: string, path: Path, quiet = false) => {
    if (opts.iconPacks?.[name]) return fromMarkup(opts.iconPacks[name]!, name);
    if (isPath(name)) {
      try {
        const p = parse(load!(name)) as IconPackFile;
        if (!p || typeof p !== 'object' || typeof p.icons !== 'object') throw new Error('no icons: map');
        fromPack(p, name, typeof p.name === 'string' ? p.name : name);
      } catch (e) {
        warn(path, `Cannot read icon pack ${name}: ${(e as Error).message.split('\n')[0]}`);
      }
      return;
    }
    const p = opts.pack?.(name);
    if (!p) {
      if (quiet) return;
      return warn(path, opts.pack || !opts.iconPacks ? `No ${name} icons imported yet: download the official set and run carto icons import <folder|zip> (docs/icons.md)` : `No ${name} icons in this browser yet: Theme → Official icons… imports the download (docs/icons.md)`);
    }
    fromPack(p, '', name);
  };

  keep = true;
  // One vendor (azure, kubernetes): say when its set is missing. Several (cloud): only when none is there.
  for (const v of official) usePack(v, ['icons'], official.length > 1);
  if (official.length > 1 && !official.some((v) => packs.has(v))) usePack(official[0]!, ['icons']);
  keep = false;
  for (const name of opts.packs ?? []) usePack(name, ['icons']);
  for (const [kind, svg] of Object.entries(opts.icons ?? {})) {
    files.set(kind, () => svg);
    byHand.add(kind);
  }
  if (typeof ref === 'string') usePack(ref, ['icons']);
  else if (Array.isArray(ref)) ref.forEach((r, i) => typeof r === 'string' && usePack(r, ['icons', i]));
  else if (ref && typeof ref === 'object')
    for (const [kind, v] of Object.entries(ref as Record<string, unknown>)) {
      if (kind === 'pack') [v].flat().forEach((r) => typeof r === 'string' && usePack(r, ['icons', 'pack']));
      else if (typeof v === 'string') {
        files.set(kind, () => load!(v));
        byHand.add(kind);
      }
      else warn(['icons', kind], 'An icon is the path of an SVG file, e.g. key-vault: ./icons/key-vault.svg');
    }
  else if (ref != null) warn(['icons'], 'icons is official, lucide, a pack name, a pack file, or a map of kind: file.svg');
  if (!files.size) return undefined;

  const cache = new Map<string, string | undefined>();
  /**
   * Where a kind's icon comes from. A shape that names its vendor looks only in that vendor's pack
   * when it is loaded (an AWS VPC icon on a Google network would be wrong), also under the kind's
   * name without the vendor ("azure-storage" is "storage" in the azure pack).
   */
  const source = (kind: string, pack: string | undefined): { key: string; get: () => string } | undefined => {
    const own = pack ? packs.get(pack) : undefined;
    if (!own || byHand.has(kind)) return files.has(kind) ? { key: kind, get: files.get(kind)! } : undefined;
    const k = own.has(kind) ? kind : kind.startsWith(`${pack}-`) ? kind.slice(pack!.length + 1) : kind;
    return own.has(k) ? { key: `${pack}/${k}`, get: own.get(k)! } : undefined;
  };
  const href = (written: string | undefined, path: Path, pack?: string) => {
    const from = written ? source(written, pack) : undefined;
    if (!from) return undefined;
    const kind = from.key;
    if (!cache.has(kind)) {
      let svg: string | undefined;
      try {
        if (!load && !opts.icons?.[written!] && !opts.iconPacks) throw new Error('no files here');
        svg = from.get();
        if (!/<svg[\s>]/.test(svg)) throw new Error('not an SVG');
      } catch (e) {
        warn(path, `Icon for ${written}: ${(e as Error).message.split('\n')[0]}`);
        svg = undefined;
      }
      // As-is: the vendor's file, base64 so nothing in it can clash with the drawing's ids or styles.
      cache.set(kind, svg && `data:image/svg+xml;base64,${toBase64(svg)}`);
    }
    return cache.get(kind);
  };
  const nodes = new Map<string, string>();
  const groups = new Map<string, string>();
  for (const n of graph.nodes) {
    const h = n.shape.kind !== 'matrix' ? href(kindAt(data, n.path), n.path, n.pack) : undefined;
    if (h) nodes.set(n.id, h);
  }
  for (const g of graph.groups) {
    const h = href(kindAt(data, g.path), g.path, g.pack);
    if (h) groups.set(g.id, h);
  }
  return { nodes, groups };
}
