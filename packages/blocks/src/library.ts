// Where blocks come from: the open folder's blocks/, the person's own library (the browser, or the
// CLI's config folder), and the starters shipped in examples/blocks. A name found earlier wins.
import { blockNameOf, checkBlock, isBlockFile, parseBlock, type Block, type BlockProblem } from './block.ts';
import type { DiagramType } from '@cartography/core';

export type BlockSource = 'folder' | 'library' | 'starter';

export interface Listed {
  block?: Block;
  name: string;
  source: BlockSource;
  /** Where it was read: a path in the folder or on disk. */
  file: string;
  problems: BlockProblem[];
}

/** Reads block files (path → text) of one source; files that are not blocks are skipped. */
export function readBlocks(files: Iterable<[string, string]>, source: BlockSource, typeOf: (id: string) => DiagramType | undefined): Listed[] {
  const out: Listed[] = [];
  for (const [file, text] of files) {
    if (!isBlockFile(file)) continue;
    const name = blockNameOf(file);
    const r = parseBlock(text, name);
    out.push({ name, source, file, ...(r.block ? { block: r.block } : {}), problems: [...r.problems, ...(r.block ? checkBlock(r.block, typeOf(r.block.type)) : [])] });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** One list from several sources, the first one with a name keeping it. */
export function mergeLibraries(...lists: Listed[][]): Listed[] {
  const seen = new Set<string>();
  return lists.flat().filter((l) => !seen.has(l.name) && (seen.add(l.name), true));
}
