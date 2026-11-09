// The text range of each drawn element's YAML entry, for selection in both directions.
import { isMap, isSeq, parseDocument, type Node, type Pair } from 'yaml';
import type { Graph, Path } from '@cartography/core';

export interface Entry {
  kind: 'node' | 'group' | 'edge';
  id: string;
  from: number;
  to: number;
}

export function entryRanges(text: string, graph: Graph | undefined): Entry[] {
  if (!graph) return [];
  const doc = parseDocument(text);
  const out: Entry[] = [];
  const add = (kind: Entry['kind'], id: string, path: Path) => {
    const r = rangeOf(doc.contents as Node | null, path);
    if (!r) return;
    // Block values end after their newline; the entry ends at its last character.
    let to = r[1];
    while (to > r[0] && /\s/.test(text[to - 1]!)) to--;
    out.push({ kind, id, from: r[0], to });
  };
  for (const n of graph.nodes) add('node', n.id, n.path);
  for (const g of graph.groups) add('group', g.id, g.path);
  for (const e of graph.edges) add('edge', e.id, e.path);
  return out;
}

/** Start of the key (or list item) to the end of its value. */
function rangeOf(root: Node | null, path: Path): [number, number] | undefined {
  let node: unknown = root;
  let range: [number, number] | undefined;
  for (const seg of path) {
    if (isMap(node)) {
      const pair = (node.items as Pair[]).find((p) => String((p.key as { value?: unknown })?.value) === String(seg));
      if (!pair) return range;
      const k = (pair.key as Node).range;
      const v = (pair.value as Node | null)?.range;
      if (k) range = [k[0], v ? v[1] : k[1]];
      node = pair.value;
    } else if (isSeq(node) && typeof seg === 'number') {
      const item = node.items[seg] as Node | undefined;
      if (!item?.range) return range;
      range = [item.range[0], item.range[1]];
      node = item;
    } else return range;
  }
  return range;
}

/** The innermost entry around a text position: the smallest range that holds it. */
export function entryAt(entries: Entry[], pos: number): Entry | undefined {
  let best: Entry | undefined;
  for (const e of entries) if (pos >= e.from && pos <= e.to && (!best || e.to - e.from < best.to - best.from)) best = e;
  return best;
}
