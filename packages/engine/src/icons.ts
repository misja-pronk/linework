// BYO official icons: which kinds a diagram uses, which SVG file each maps to (packs, then the
// diagram's own `icons:` entries), read only those files and hand them to render as data URIs.
import { parse } from 'yaml';
import type { Graph, Path } from '@cartography/core';
import type { IconPackFile } from '@cartography/icons';
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

export function resolveIcons(graph: Graph, data: Record<string, unknown>, ref: unknown, opts: RenderOptions, warn: (path: Path, message: string) => void): RenderOptions['images'] {
  if (ref == null && !opts.packs?.length && !opts.icons) return undefined;
  const load = opts.load;
  // kind → how to get its SVG markup
  const files = new Map<string, () => string>();
  const fromPack = (p: IconPackFile, base: string) => {
    const root = joinPath(base, p.root || '.');
    for (const [kind, rel] of Object.entries(p.icons ?? {})) files.set(kind, () => load!(joinPath(root + '/', rel)));
  };
  const usePack = (name: string, path: Path) => {
    if (isPath(name)) {
      try {
        const p = parse(load!(name)) as IconPackFile;
        if (!p || typeof p !== 'object' || typeof p.icons !== 'object') throw new Error('no icons: map');
        fromPack(p, name);
      } catch (e) {
        warn(path, `Cannot read icon pack ${name}: ${(e as Error).message.split('\n')[0]}`);
      }
      return;
    }
    const p = opts.pack?.(name);
    if (!p) return warn(path, opts.pack ? `No icon pack "${name}": import one with carto icons import <folder|zip> --pack ${name}` : `Icon pack "${name}" is only available in the CLI; use a pack file or the editor's icon folder`);
    fromPack(p, '');
  };

  for (const name of opts.packs ?? []) usePack(name, ['icons']);
  for (const [kind, svg] of Object.entries(opts.icons ?? {})) files.set(kind, () => svg);
  if (typeof ref === 'string') usePack(ref, ['icons']);
  else if (Array.isArray(ref)) ref.forEach((r, i) => typeof r === 'string' && usePack(r, ['icons', i]));
  else if (ref && typeof ref === 'object')
    for (const [kind, v] of Object.entries(ref as Record<string, unknown>)) {
      if (kind === 'pack') [v].flat().forEach((r) => typeof r === 'string' && usePack(r, ['icons', 'pack']));
      else if (typeof v === 'string') files.set(kind, () => load!(v));
      else warn(['icons', kind], 'An icon is the path of an SVG file, e.g. key-vault: ./icons/key-vault.svg');
    }
  else if (ref != null) warn(['icons'], 'icons is a pack name, a pack file, or a map of kind: file.svg');
  if (!files.size) return undefined;

  const cache = new Map<string, string | undefined>();
  const href = (kind: string | undefined, path: Path) => {
    if (!kind || !files.has(kind)) return undefined;
    if (!cache.has(kind)) {
      let svg: string | undefined;
      try {
        if (!load && !opts.icons?.[kind]) throw new Error('no files here');
        svg = files.get(kind)!();
        if (!/<svg[\s>]/.test(svg)) throw new Error('not an SVG');
      } catch (e) {
        warn(path, `Icon for ${kind}: ${(e as Error).message.split('\n')[0]}`);
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
    const h = n.shape.kind !== 'matrix' ? href(kindAt(data, n.path), n.path) : undefined;
    if (h) nodes.set(n.id, h);
  }
  for (const g of graph.groups) {
    const h = href(kindAt(data, g.path), g.path);
    if (h) groups.set(g.id, h);
  }
  return { nodes, groups };
}
