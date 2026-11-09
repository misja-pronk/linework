// The lanes + axis engine: lanes (participants, branches, workstreams) side by side, ordered steps
// (or time) along the axis that runs through them. Pure one-dimensional arithmetic on measured sizes,
// so it does not care whether lanes are columns (sequence) or rows (git flow, roadmap): the type picks
// the orientation, the engine spaces. No Graphviz and no search: the same input always gives the same
// drawing, and a new step only moves what comes after it.
//
//   across  spread(sizes, gap, aparts, reaches)  lane centres, each gap only as wide as something needs
//   along   stack(rows, bands)                   row and band positions; bands (frames, phases) add a head and a foot
//   spans   tracks(spans)                        side-by-side tracks for overlapping spans on one lane (activations, bars)
//   bands   nesting(bands)                       how many bands sit inside each, for insets that never touch

/** Lane centres `a` and `b` at least `min` apart: room for a label between them, a self-call, a note. */
export interface Apart {
  a: number;
  b: number;
  min: number;
}

/** Something drawn sticks out of a lane: `before` and `after` its centre. Only widens the outer edges. */
export interface Reach {
  lane: number;
  before?: number;
  after?: number;
}

export interface Spread {
  /** Lane centres from 0, the start of the drawing. */
  centres: number[];
  /** Extent of everything across the axis. */
  size: number;
}

/**
 * Places lanes across the axis. Neighbours keep `gap` between their headers; every `Apart` widens the
 * gaps it spans, shortest first, spreading what is missing evenly, so one long label does not push a
 * single gap wide while the others stay tight. Gaps only ever grow, so earlier wishes stay met.
 */
export function spread(sizes: number[], gap: number, aparts: Apart[] = [], reaches: Reach[] = []): Spread {
  const n = sizes.length;
  if (!n) return { centres: [], size: 0 };
  const gaps = sizes.slice(1).map((s, k) => (sizes[k]! + s) / 2 + gap);
  const wishes = aparts
    .map((w, i) => ({ a: Math.min(w.a, w.b), b: Math.max(w.a, w.b), min: w.min, i }))
    .filter((w) => w.a !== w.b && w.a >= 0 && w.b < n)
    .sort((x, y) => x.b - x.a - (y.b - y.a) || x.a - y.a || x.i - y.i);
  for (const w of wishes) {
    let have = 0;
    for (let k = w.a; k < w.b; k++) have += gaps[k]!;
    const short = w.min - have;
    if (short > 0) for (let k = w.a; k < w.b; k++) gaps[k]! += short / (w.b - w.a);
  }
  const centres = [0];
  for (const g of gaps) centres.push(centres[centres.length - 1]! + Math.ceil(g));
  let lo = Math.min(...sizes.map((s, k) => centres[k]! - s / 2));
  let hi = Math.max(...sizes.map((s, k) => centres[k]! + s / 2));
  for (const r of reaches) {
    const c = centres[r.lane];
    if (c === undefined) continue;
    lo = Math.min(lo, c - (r.before ?? 0));
    hi = Math.max(hi, c + (r.after ?? 0));
  }
  return { centres: centres.map((c) => c - lo), size: Math.ceil(hi - lo) };
}

/** One step along the axis; `anchor` is where its line or item sits inside it (default the middle). */
export interface Row {
  size: number;
  anchor?: number;
}

/** A range of rows (inclusive) framed together: a fragment, a phase. `head` and `foot` add room before and after. */
export interface Band {
  from: number;
  to: number;
  head?: number;
  foot?: number;
}

export interface Stacked {
  rows: { start: number; size: number; at: number }[];
  bands: { start: number; end: number }[];
  size: number;
}

/**
 * Stacks rows along the axis with `gap` between them. Bands that open on the same row open outer
 * first (the longer one), and close inner first, so nested heads and feet stack instead of overlapping.
 */
export function stack(rows: Row[], bands: Band[] = [], gap = 0): Stacked {
  const opening = new Map<number, number[]>();
  const closing = new Map<number, number[]>();
  for (const [i, b] of bands.entries()) {
    (opening.get(b.from) ?? opening.set(b.from, []).get(b.from)!).push(i);
    (closing.get(b.to) ?? closing.set(b.to, []).get(b.to)!).push(i);
  }
  const outBands = bands.map(() => ({ start: 0, end: 0 }));
  const outRows: Stacked['rows'] = [];
  let y = 0;
  for (const [r, row] of rows.entries()) {
    if (r) y += gap;
    for (const i of (opening.get(r) ?? []).sort((p, q) => bands[q]!.to - bands[p]!.to || p - q)) {
      outBands[i]!.start = y;
      y += bands[i]!.head ?? 0;
    }
    outRows.push({ start: y, size: row.size, at: y + (row.anchor ?? row.size / 2) });
    y += row.size;
    for (const i of (closing.get(r) ?? []).sort((p, q) => bands[q]!.from - bands[p]!.from || q - p)) {
      y += bands[i]!.foot ?? 0;
      outBands[i]!.end = y;
    }
  }
  return { rows: outRows, bands: outBands, size: y };
}

/** A bar on one lane over a range of rows (inclusive): an activation, a work item. */
export interface Span {
  lane: number;
  from: number;
  to: number;
}

/**
 * The track of each span: 0 next to the lane, 1 beside that, … Overlapping spans on a lane take the
 * first free track, so nested activations step outwards and spans one after the other share track 0.
 * Spans that only touch at a row do not overlap; a one-row span overlaps whatever runs through its row.
 */
export function tracks(spans: Span[]): number[] {
  const order = spans.map((s, i) => i).sort((p, q) => spans[p]!.lane - spans[q]!.lane || spans[p]!.from - spans[q]!.from || spans[q]!.to - spans[p]!.to || p - q);
  const out = spans.map(() => 0);
  const placed: number[] = [];
  const overlap = (a: Span, b: Span) =>
    a.lane === b.lane && (a.from === a.to || b.from === b.to ? a.from <= b.to && b.from <= a.to : a.from < b.to && b.from < a.to);
  for (const i of order) {
    const s = spans[i]!;
    const taken = new Set(placed.filter((j) => overlap(spans[j]!, s)).map((j) => out[j]));
    let t = 0;
    while (taken.has(t)) t++;
    out[i] = t;
    placed.push(i);
  }
  return out;
}

/** The deepest track running through `row` on `lane`, or -1 when none does. */
export function deepest(spans: Span[], track: number[], lane: number, row: number): number {
  let d = -1;
  for (const [i, s] of spans.entries()) if (s.lane === lane && s.from <= row && row <= s.to) d = Math.max(d, track[i]!);
  return d;
}

/**
 * For each band, how many levels of bands sit inside it (0: none). A band's inset grows with it, so a
 * frame always clears the frames it holds. Equal ranges nest in list order: the later one is inside.
 */
export function nesting(bands: Band[]): number[] {
  const inside = (i: number, o: number) => {
    const a = bands[i]!;
    const b = bands[o]!;
    if (i === o || a.from < b.from || a.to > b.to) return false;
    return a.from !== b.from || a.to !== b.to || i > o;
  };
  const memo = new Map<number, number>();
  const level = (o: number): number => {
    if (memo.has(o)) return memo.get(o)!;
    let l = 0;
    for (let i = 0; i < bands.length; i++) if (inside(i, o)) l = Math.max(l, level(i) + 1);
    memo.set(o, l);
    return l;
  };
  return bands.map((_, i) => level(i));
}
