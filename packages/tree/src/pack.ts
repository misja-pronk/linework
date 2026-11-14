// Nested packing: boxes inside boxes, as a capability map draws them.
//
// Every box at the same depth is as wide as every other (equal columns per level), so a map reads
// as a grid: level-1 areas side by side, the capabilities in them stacked in one or more equal
// columns, the chips inside those in rows. How many columns each level gets is not guessed: every
// combination is laid out and the one that comes out largest on a 16:9 slide wins. A wide map
// wraps its areas into a second row, a tall one gives its areas two columns of capabilities.
// Plain arithmetic and a small search, so the same input always gives the same drawing; the
// variant drawn before is kept unless another is clearly better, so one more chip does not
// rearrange the map.
import type { Box } from '@linework/core';
import { choose, slideScale, type Frame } from './fit.ts';

export interface PackItem {
  id: string;
  /** A leaf: the room it needs. A container: the width its header needs, and the header's height. */
  width: number;
  height: number;
  children?: PackItem[];
}

export interface PackOptions {
  /** columns: the top items side by side, wrapping into rows; bands: one under the other, each with its header on the left. */
  mode?: 'columns' | 'bands';
  /** Between siblings. */
  gap?: number;
  /** Between the top items. */
  outerGap?: number;
  /** Inside a container, around what it holds. */
  pad?: number;
  aspect?: number;
  frame?: Frame;
  /** The variant drawn before. */
  previous?: string;
  /** The most columns tried inside a container (default 4). */
  maxColumns?: number;
  /** Columns per level as the source fixes them: [top items per row, inside a top item, inside the next]; undefined is searched. */
  columns?: (number | undefined)[];
}

export interface Packed {
  boxes: Map<string, Box>;
  width: number;
  height: number;
  /** "columns:3.2.1": how many columns each level got. */
  variant: string;
  columns: number[];
}

interface Level {
  /** Items of this depth, in reading order. */
  items: PackItem[];
  /** The most children any item of this depth has. */
  kids: number;
}

const GAP = 10;
const PAD = 10;

export function pack(roots: PackItem[], o: PackOptions = {}): Packed {
  const mode = o.mode ?? 'columns';
  const gap = o.gap ?? GAP;
  const outer = o.outerGap ?? gap + 6;
  const pad = o.pad ?? PAD;
  const maxC = o.maxColumns ?? 4;
  const levels: Level[] = [];
  const walk = (items: PackItem[], d: number) => {
    if (!items.length) return;
    const l = (levels[d] ??= { items: [], kids: 0 });
    for (const it of items) {
      l.items.push(it);
      l.kids = Math.max(l.kids, it.children?.length ?? 0);
      walk(it.children ?? [], d + 1);
    }
  };
  walk(roots, 0);
  if (!levels.length) return { boxes: new Map(), width: 0, height: 0, variant: `${mode}:`, columns: [] };

  // The ranges searched: top items per row (one band per row in bands mode), then columns inside each level.
  const ranges: number[][] = [];
  ranges.push(mode === 'bands' ? [1] : Array.from({ length: Math.min(roots.length, 16) }, (_, i) => i + 1));
  for (let d = 0; d < levels.length - 1; d++) {
    const most = Math.max(1, levels[d]!.kids);
    const top = mode === 'bands' && d === 0 ? Math.min(most, 12) : Math.min(most, maxC);
    // Past three levels deep everything stands in one column: there is little to gain and much to search.
    ranges.push(d < 2 ? Array.from({ length: top }, (_, i) => i + 1) : [1]);
  }
  const fixed = ranges.map((r, i) => (o.columns?.[i] ? [Math.max(1, Math.round(o.columns[i]!))] : r));

  const options: (Packed & { score: number })[] = [];
  // Top items in rows (each row as tall as its tallest) or, for columns, in lanes of their own height.
  const tops: ('rows' | 'lanes')[] = mode === 'columns' ? ['rows', 'lanes'] : ['rows'];
  // Lanes drawn before keep the areas they had: "columns-lanes:3.1.1@0,2,5" names where each lane started.
  const [prevName, prevCuts] = (o.previous ?? '').split('@');
  const cuts = prevCuts?.split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < roots.length) ?? [];
  const combos = (i: number, acc: number[]) => {
    if (i === fixed.length) {
      for (const top of tops) {
        if (top === 'lanes' && (acc[0] === 1 || acc[0] === roots.length)) continue;
        const name = `${mode}${top === 'lanes' ? '-lanes' : ''}:${acc.join('.')}`;
        const keep = top === 'lanes' && name === prevName && cuts.length === acc[0] && cuts.every((c, k) => (k === 0 ? c === 0 : c > cuts[k - 1]!)) ? cuts : undefined;
        const p = arrange(roots, levels, acc, { mode, top, gap, outer, pad, starts: keep });
        const leafArea = levels.reduce((s, l) => s + l.items.filter((it) => !it.children?.length).reduce((a, it) => a + (p.boxes.get(it.id)?.width ?? 0) * (p.boxes.get(it.id)?.height ?? 0), 0), 0);
        // Fitting the slide comes first; among drawings that fit about as well, the one with the least empty paper.
        const fill = leafArea / Math.max(1, p.width * p.height);
        options.push({ ...p, score: slideScale(p.width, p.height, o.frame, o.aspect) * (0.7 + 0.3 * fill) });
      }
      return;
    }
    for (const c of fixed[i]!) combos(i + 1, [...acc, c]);
  };
  combos(0, []);
  const { score: _, ...best } = choose(options, o.previous)!;
  return best;
}

/** One combination of columns, laid out. */
function arrange(roots: PackItem[], levels: Level[], cols: number[], o: { mode: 'columns' | 'bands'; top: 'rows' | 'lanes'; gap: number; outer: number; pad: number; starts?: number[] }): Packed {
  const { mode, gap, pad } = o;
  const depthOf = new Map<string, number>();
  for (const [d, l] of levels.entries()) for (const it of l.items) depthOf.set(it.id, d);
  const left = (d: number) => mode === 'bands' && d === 0;
  // Header room of a band: as wide as the widest, so the bands' contents line up.
  const headerWidth = left(0) ? Math.max(0, ...levels[0]!.items.filter((it) => it.children?.length).map((it) => it.width)) : 0;

  // Widths, deepest level first: a container is as wide as its columns of children.
  const width: number[] = [];
  for (let d = levels.length - 1; d >= 0; d--) {
    const c = cols[d + 1] ?? 1;
    let w = 0;
    for (const it of levels[d]!.items) {
      if (!it.children?.length) w = Math.max(w, it.width);
      else {
        const inner = c * (width[d + 1] ?? 0) + (c - 1) * gap;
        w = Math.max(w, left(d) ? headerWidth + inner + pad : Math.max(it.width, inner + 2 * pad));
      }
    }
    width[d] = Math.ceil(w);
  }
  // Then down again: what stands in a container fills its width, so a wide capability does not leave its chips a gap.
  for (let d = 0; d < levels.length - 1; d++) {
    const c = cols[d + 1] ?? 1;
    const room = left(d) ? width[d]! - headerWidth - pad : width[d]! - 2 * pad;
    width[d + 1] = Math.max(width[d + 1]!, Math.floor((room - (c - 1) * gap) / c));
  }

  // Heights, memoised: a container is its header and its grid.
  const heights = new Map<string, number>();
  const grids = new Map<string, Grid>();
  const heightOf = (it: PackItem): number => {
    const known = heights.get(it.id);
    if (known !== undefined) return known;
    const d = depthOf.get(it.id)!;
    let h = it.height;
    if (it.children?.length) {
      const kids = it.children;
      const c = Math.min(cols[d + 1] ?? 1, kids.length);
      const grid = mode === 'columns' && d === 0 ? balanced(kids.map(heightOf), c, gap) : rows(kids.map(heightOf), c, gap);
      grids.set(it.id, grid);
      h = left(d) ? Math.max(it.height, grid.height + 2 * pad) : it.height + grid.height + pad;
    }
    heights.set(it.id, h);
    return h;
  };
  for (const r of roots) heightOf(r);

  const boxes = new Map<string, Box>();
  const place = (it: PackItem, x: number, y: number, h: number) => {
    const d = depthOf.get(it.id)!;
    boxes.set(it.id, { x, y, width: width[d]!, height: h });
    const grid = grids.get(it.id);
    if (!grid || !it.children) return;
    const x0 = left(d) ? x + headerWidth : x + pad;
    const y0 = left(d) ? y + pad : y + it.height;
    const w = width[d + 1]!;
    for (const [i, kid] of it.children.entries()) {
      const cell = grid.cells[i]!;
      place(kid, x0 + cell.col * (w + gap), y0 + cell.y, cell.height);
    }
  };
  const across = Math.min(cols[0] ?? 1, roots.length);
  const top = o.top === 'lanes' ? balanced(roots.map(heightOf), across, o.outer, o.starts) : rows(roots.map(heightOf), across, o.outer);
  // In lanes the last item of each runs down to the foot of the tallest, so the map ends on one line.
  if (o.top === 'lanes')
    for (let k = 0; k < across; k++) {
      const last = top.cells.findLastIndex((c) => c.col === k);
      if (last >= 0) top.cells[last]!.height = top.height - top.cells[last]!.y;
    }
  for (const [i, r] of roots.entries()) {
    const cell = top.cells[i]!;
    place(r, cell.col * (width[0]! + o.outer), cell.y, cell.height);
  }
  return { boxes, width: across * width[0]! + (across - 1) * o.outer, height: top.height, variant: `${mode}${o.top === 'lanes' ? `-lanes:${cols.join('.')}@${top.starts!.join(',')}` : `:${cols.join('.')}`}`, columns: cols };
}

interface Grid {
  cells: { col: number; y: number; height: number }[];
  height: number;
  /** Where each column starts, in reading order (balanced grids). */
  starts?: number[];
}

/** Row by row, `c` to a row; a row is as tall as its tallest, and each cell is stretched to it. */
function rows(heights: number[], c: number, gap: number): Grid {
  const cells: Grid['cells'] = [];
  let y = 0;
  for (let r = 0; r * c < heights.length; r++) {
    const row = heights.slice(r * c, r * c + c);
    const h = Math.max(...row);
    for (const i of row.keys()) cells.push({ col: i, y, height: h });
    y += h + gap;
  }
  return { cells, height: Math.max(0, y - gap) };
}

/**
 * Down the columns, in reading order: the items split into `c` runs that are as even as they can
 * be (the tallest column as short as it can be), each run one column.
 */
function balanced(heights: number[], c: number, gap: number, given?: number[]): Grid {
  const n = heights.length;
  if (given) return columnsFrom(heights, given, gap);
  const span = (a: number, b: number) => heights.slice(a, b).reduce((s, h) => s + h, 0) + Math.max(0, b - a - 1) * gap;
  // best[k][i]: the tallest column when the first i items fill k columns; cut[k][i]: where the last column starts.
  const best: number[][] = [Array.from({ length: n + 1 }, (_, i) => (i === 0 ? 0 : Infinity))];
  const cut: number[][] = [[]];
  for (let k = 1; k <= c; k++) {
    best[k] = [0];
    cut[k] = [0];
    for (let i = 1; i <= n; i++) {
      let b = Infinity;
      let at = 0;
      for (let j = k - 1; j < i; j++) {
        const v = Math.max(best[k - 1]![j]!, span(j, i));
        // Ties go to the later cut: earlier columns take more, as people fill columns.
        if (v <= b) (b = v), (at = j);
      }
      best[k]![i] = b;
      cut[k]![i] = at;
    }
  }
  const starts: number[] = [];
  for (let k = c, i = n; k > 0; k--) {
    const j = cut[k]![i]!;
    starts.unshift(j);
    i = j;
  }
  return columnsFrom(heights, starts, gap);
}

/** Columns that start at the given items. */
function columnsFrom(heights: number[], starts: number[], gap: number): Grid {
  const n = heights.length;
  const c = starts.length;
  const cells: Grid['cells'] = [];
  let height = 0;
  for (let k = 0; k < c; k++) {
    let y = 0;
    for (let i = starts[k]!; i < (starts[k + 1] ?? n); i++) {
      cells.push({ col: k, y, height: heights[i]! });
      y += heights[i]! + gap;
    }
    height = Math.max(height, y - gap);
  }
  return { cells, height: Math.max(0, height), starts };
}
