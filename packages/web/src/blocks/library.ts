// The blocks within reach in the editor: the open folder's blocks/, your own library (this browser),
// and the starters bundled from examples/blocks. A name found earlier wins. Previews are drawn once
// per version and theme, in the background.
import { useEffect, useMemo, useState } from 'react';
import { findType, render, type RenderResult } from '@cartography/engine';
import { blockDiagramText, instantiate, mergeLibraries, readBlocks, BLOCK_SUFFIX, type Block, type BlockPins, type Listed } from '@cartography/blocks';
import type { Workspace } from '../files.ts';
import { writeInFolder } from '../files.ts';

const starterFiles = import.meta.glob('../../../../examples/blocks/*.block.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const starters = readBlocks(
  Object.entries(starterFiles).map(([p, t]) => [p.replace(/^.*\/examples\//, 'examples/'), t]),
  'starter',
  findType,
);

const KEY = 'cartography:blocks';
/** Your own blocks, in this browser: name → text. */
export function readUserBlocks(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
function writeUserBlocks(all: Record<string, string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* private window: nothing kept */
  }
}

export const FOLDER = 'blocks';
export const folderPath = (name: string) => `${FOLDER}/${name}${BLOCK_SUFFIX}`;

export function useBlockLibrary(ws: Workspace | undefined, refresh: (w: Workspace) => void) {
  const [mine, setMine] = useState(readUserBlocks);
  // A folder's files are read once when it opens; ws.files changes with every write through files.ts.
  const folderFiles = ws ? [...ws.files].filter(([p]) => p.startsWith(`${FOLDER}/`) && p.endsWith(BLOCK_SUFFIX)) : [];
  const folderKey = folderFiles.map(([p, f]) => `${p}:${f.text.length}:${f.text.slice(0, 40)}`).join('|');
  const listed: Listed[] = useMemo(
    () =>
      mergeLibraries(
        readBlocks(folderFiles.map(([p, f]) => [p, f.text]), 'folder', findType),
        readBlocks(Object.entries(mine).map(([n, t]) => [`${n}${BLOCK_SUFFIX}`, t]), 'library', findType),
        starters,
      ),
    [folderKey, mine], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const byName = useMemo(() => new Map(listed.flatMap((l) => (l.block ? [[l.name, l.block] as const] : []))), [listed]);

  /** Writes a block into the folder's blocks/ or your library. */
  const save = async (name: string, text: string, where: 'folder' | 'library') => {
    if (where === 'folder' && ws) {
      await writeInFolder(ws, folderPath(name), text);
      refresh(ws);
    } else {
      const next = { ...readUserBlocks(), [name]: text };
      writeUserBlocks(next);
      setMine(next);
    }
  };
  const exists = (name: string, where: 'folder' | 'library') => (where === 'folder' ? !!ws?.files.has(folderPath(name)) : Object.hasOwn(readUserBlocks(), name));
  return { listed, byName, save, exists };
}

const thumbs = new Map<string, string>();
/** Where the preview put each node, from the block's top-left, by the id as the block writes it. */
const drawnPins = new Map<string, BlockPins>();

/** A block's own pins, or where its preview drew its nodes: a dropped block without pins still lands as it looks. */
export function pinsOf(b: Block): BlockPins | undefined {
  return b.pins?.nodes ? b.pins : drawnPins.get(`${b.name}:${b.hash}`);
}

function pinsFrom(b: Block, r: RenderResult): BlockPins | undefined {
  const raw = Object.keys((b.body.nodes as Record<string, unknown> | undefined) ?? {});
  const filled = Object.keys((instantiate(b).nodes as Record<string, unknown> | undefined) ?? {});
  const boxes = [...(r.placed?.nodes ?? []), ...(r.placed?.groups ?? [])];
  if (!raw.length || !boxes.length) return undefined;
  const x0 = Math.min(...boxes.map(([, q]) => q.x));
  const y0 = Math.min(...boxes.map(([, q]) => q.y));
  const nodes: Record<string, { x: number; y: number }> = {};
  raw.forEach((k, i) => {
    const q = r.placed?.nodes.get(filled[i]!);
    if (q) nodes[k] = { x: Math.round(q.x - x0), y: Math.round(q.y - y0) };
  });
  return { nodes };
}

/** Only the shapes: the drawing's own frame, title and key cut away, by the boxes the layout placed. */
function cropped(r: RenderResult): string {
  const boxes = [...(r.placed?.nodes.values() ?? []), ...(r.placed?.groups.values() ?? [])];
  if (!r.svg || !boxes.length) return r.svg ?? '';
  const o = r.origin ?? { x: 0, y: 0 };
  const pad = 12;
  const x = Math.min(...boxes.map((b) => b.x)) + o.x - pad;
  const y = Math.min(...boxes.map((b) => b.y)) + o.y - pad;
  const w = Math.max(...boxes.map((b) => b.x + b.width)) + o.x + pad - x;
  const h = Math.max(...boxes.map((b) => b.y + b.height)) + o.y + pad - y;
  return r.svg.replace(/viewBox="[^"]*"/, `viewBox="${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}"`);
}
let thumbIds = 0;

/** The previews of these blocks (by hash and theme), drawn one after another. */
export function useBlockThumbs(blocks: Block[], theme: 'light' | 'dark'): (b: Block) => string | undefined {
  const [, redraw] = useState(0);
  const key = blocks.map((b) => b.hash).join('|');
  useEffect(() => {
    let stop = false;
    (async () => {
      for (const b of blocks) {
        const k = `${theme}:${b.name}:${b.hash}`;
        if (stop) return;
        if (thumbs.has(k)) continue;
        // A preview is the drawing without its title: only the shapes.
        const r = await render(blockDiagramText(b).replace(/^title:.*\n/m, ''), { theme, fonts: 'none', idPrefix: `b${thumbIds++}` }).catch(() => undefined);
        thumbs.set(k, r?.svg ? cropped(r) : '');
        const pins = r && pinsFrom(b, r);
        if (pins) drawnPins.set(`${b.name}:${b.hash}`, pins);
        if (!stop) redraw((n) => n + 1);
      }
    })();
    return () => {
      stop = true;
    };
  }, [key, theme]); // eslint-disable-line react-hooks/exhaustive-deps
  return (b) => thumbs.get(`${theme}:${b.name}:${b.hash}`) || undefined;
}
