// Between the YAML and the drawing: where each drawn element is written, so a click in the preview
// can reveal its line and the cursor in the YAML can light up what it is on.
import { isMap, isScalar, isSeq, parseDocument, type Node } from 'yaml';
import type { Graph, Path } from '@linework/core';

export type ElementKind = 'node' | 'group' | 'edge';

export interface Span {
  kind: ElementKind;
  id: string;
  /** The whole entry: its key (or list dash) to the end of its value, as offsets. */
  from: number;
  to: number;
  /** Where to put the cursor: the entry's key, or the start of a list item. */
  at: number;
  /** How many steps of the path were found: an entry from another file stops at its include. */
  depth: number;
}

const rangeOf = (n: unknown): [number, number] | undefined => {
  const r = (n as Node | null | undefined)?.range;
  return r ? [r[0], r[1]] : undefined;
};

/** The entry a path points at, as far as the text has it. */
export function entrySpan(doc: ReturnType<typeof parseDocument>, path: Path): { from: number; to: number; at: number; depth: number } | undefined {
  let node: unknown = doc.contents;
  let span: { from: number; to: number; at: number } | undefined;
  let depth = 0;
  for (const key of path) {
    if (isMap(node)) {
      const pair = node.items.find((p) => isScalar(p.key) && String(p.key.value) === String(key));
      const k = pair && rangeOf(pair.key);
      if (!pair || !k) break;
      const v = rangeOf(pair.value);
      span = { from: k[0], to: v ? v[1] : k[1], at: k[0] };
      node = pair.value;
    } else if (isSeq(node) && typeof key === 'number' && node.items[key]) {
      node = node.items[key];
      const r = rangeOf(node);
      if (!r) break;
      span = { from: r[0], to: r[1], at: r[0] };
    } else break;
    depth++;
  }
  return span && { ...span, depth };
}

/** Every drawn element with where it is written. Elements the text does not hold at all are left out. */
export function elementSpans(text: string, graph: Pick<Graph, 'nodes' | 'groups' | 'edges'>): Span[] {
  const doc = parseDocument(text, { keepSourceTokens: false });
  const out: Span[] = [];
  const add = (kind: ElementKind, id: string, path: Path | undefined) => {
    if (!path?.length) return;
    const s = entrySpan(doc, path);
    if (s) out.push({ kind, id, ...s });
  };
  for (const g of graph.groups) add('group', g.id, g.path);
  for (const n of graph.nodes) add('node', n.id, n.path);
  for (const e of graph.edges) add('edge', e.id, e.path);
  return out;
}

/**
 * What the cursor is on: the innermost entry that holds it. Of entries that are written in the same
 * place (an include entry stands for everything that came from that file) the first drawn wins.
 */
export function elementAt(spans: readonly Span[], offset: number): Span | undefined {
  let best: Span | undefined;
  for (const s of spans) {
    if (offset < s.from || offset > s.to) continue;
    if (!best || s.to - s.from < best.to - best.from || (s.to - s.from === best.to - best.from && s.depth > best.depth)) best = s;
  }
  return best;
}

/** All elements written at exactly the place of the one found, so a line written once lights up whole. */
export function elementsAt(spans: readonly Span[], offset: number): Span[] {
  const hit = elementAt(spans, offset);
  return hit ? spans.filter((s) => s.from === hit.from && s.to === hit.to) : [];
}

export function spanOf(spans: readonly Span[], kind: ElementKind, id: string): Span | undefined {
  return spans.find((s) => s.kind === kind && s.id === id);
}
