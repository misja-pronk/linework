// A tidy tree, as an org chart is drawn: each card centred over the cards under it, neighbouring
// branches packed as close as their outlines allow (Reingold–Tilford, with outlines kept as bands
// of y), connectors square and running on a bus between the rows.
//
// Two things keep a big tree on one slide. A manager whose reports have no reports of their own
// can hold them in a list under the card instead of a row beside each other, in one column or in
// two either side of a spine. And a tree that is too wide for its height wraps the branches of its
// widest node into rows, with the trunk running down between them. Which of these a tree gets is
// tried, not guessed: every combination is laid out and the one largest on a 16:9 slide wins,
// unless the arrangement drawn before is close enough, so one more person moves little.
import type { Box, Point } from '@cartography/core';
import { choose, slideScale, type Frame } from './fit.ts';

export interface TidyNode {
  id: string;
  width: number;
  height: number;
  children: TidyNode[];
}

export interface Arrangement {
  /** Reports without reports of their own stand in a list from this many on; Infinity never. */
  list: number;
  /** A list of six or more stands in two columns either side of a spine. */
  pairs: boolean;
  /** The branches of the widest node wrap into this many rows. */
  wrap: number;
}

export interface TidyOptions {
  /** Between neighbouring cards and branches. */
  gapX?: number;
  /** Between a card and the row under it: where the connectors run. */
  gapY?: number;
  /** Between the cards of a list. */
  listGap?: number;
  /** A list stands this far in from its manager's left edge. */
  indent?: number;
  aspect?: number;
  frame?: Frame;
  previous?: string;
  /** Parts of the arrangement the source fixes; the rest is tried. */
  fixed?: Partial<Arrangement>;
}

export interface Tidied {
  boxes: Map<string, Box>;
  /** The connector from each card's manager to it, by the card's id. */
  links: Map<string, Point[]>;
  width: number;
  height: number;
  /** "l3p-w2": lists from three, in pairs, wrapped into two rows. */
  variant: string;
}

/** A horizontal slice of a branch's outline: from y0 to y1 it reaches from l to r. */
interface Band {
  y0: number;
  y1: number;
  l: number;
  r: number;
}

interface Sub {
  members: string[];
  bands: Band[];
}

const STUB = 14;
const PAIRS = 6;

export const variantOf = (a: Arrangement) => `${a.list === Infinity ? 'row' : `l${a.list}`}${a.pairs ? 'p' : ''}-w${a.wrap}`;

export function tidy(roots: TidyNode[], o: TidyOptions = {}): Tidied {
  if (!roots.length) return { boxes: new Map(), links: new Map(), width: 0, height: 0, variant: 'row-w1' };
  const lists = o.fixed?.list !== undefined ? [o.fixed.list] : [Infinity, 2, 3, 5];
  const pairs = o.fixed?.pairs !== undefined ? [o.fixed.pairs] : [false, true];
  const wraps = o.fixed?.wrap !== undefined ? [o.fixed.wrap] : [1, 2, 3];
  const options: (Tidied & { score: number })[] = [];
  const seen = new Set<string>();
  for (const list of lists)
    for (const pair of pairs)
      for (const wrap of wraps) {
        const t = arrange(roots, { list, pairs: pair, wrap }, o);
        // Arrangements that come out the same are one option: the first name for it stands.
        const key = [...t.boxes.values()].map((b) => `${b.x},${b.y}`).join(';');
        if (seen.has(key)) continue;
        seen.add(key);
        const area = [...t.boxes.values()].reduce((s, b) => s + b.width * b.height, 0);
        options.push({ ...t, score: slideScale(t.width, t.height, o.frame, o.aspect) * (0.85 + (0.15 * area) / Math.max(1, t.width * t.height)) });
      }
  // A previous variant that now comes out like another keeps its name through that other.
  const { score: _, ...best } = choose(options, o.previous && options.some((x) => x.variant === o.previous) ? o.previous : undefined)!;
  return best;
}

/** One arrangement, laid out. */
export function arrange(roots: TidyNode[], a: Arrangement, o: TidyOptions = {}): Tidied {
  const gapX = o.gapX ?? 20;
  const gapY = o.gapY ?? 44;
  const listGap = o.listGap ?? 10;
  const indent = o.indent ?? 28;
  const box = new Map<string, Box>();
  const link = new Map<string, Point[]>();

  // A forest hangs from a root of no size, whose connectors are not drawn.
  const top: TidyNode = roots.length === 1 ? roots[0]! : { id: '\u0000', width: 0, height: 0, children: roots };
  const hub = a.wrap > 1 ? widest(top) : undefined;

  const shift = (s: Sub, dx: number, dy: number) => {
    for (const id of s.members) {
      const b = box.get(id)!;
      b.x += dx;
      b.y += dy;
      const l = link.get(id);
      if (l) for (const p of l) (p.x += dx), (p.y += dy);
    }
    for (const b of s.bands) (b.y0 += dy), (b.y1 += dy), (b.l += dx), (b.r += dx);
  };
  const leaf = (n: TidyNode) => !n.children.length;

  const layout = (n: TidyNode): Sub => {
    box.set(n.id, { x: -n.width / 2, y: 0, width: n.width, height: n.height });
    const own: Band = { y0: 0, y1: n.height, l: -n.width / 2, r: n.width / 2 };
    if (!n.children.length) return { members: [n.id], bands: [own] };
    const kids = n.children.map(layout);
    const members = [n.id, ...kids.flatMap((k) => k.members)];
    const ph = n.height;
    const bands: Band[] = [own];
    const centre = (k: number) => box.get(n.children[k]!.id)!.x + n.children[k]!.width / 2;

    if (n.children.every(leaf) && n.children.length >= a.list) {
      // A list: one column hanging from a spine at the left, or two either side of one in the middle.
      const two = a.pairs && n.children.length >= PAIRS;
      const spine = two ? 0 : -n.width / 2 + indent / 2;
      let y = ph + gapY / 2;
      for (let i = 0; i < n.children.length; i += two ? 2 : 1) {
        const row = two ? [i, i + 1].filter((k) => k < n.children.length) : [i];
        const h = Math.max(...row.map((k) => n.children[k]!.height));
        for (const k of row) {
          const c = n.children[k]!;
          const right = !two || k % 2 === 1;
          const x0 = two ? (right ? STUB : -STUB - c.width) : -n.width / 2 + indent;
          shift(kids[k]!, x0 + c.width / 2, y);
          const mid = y + c.height / 2;
          link.set(c.id, [{ x: spine, y: ph }, { x: spine, y: mid }, { x: right ? x0 : x0 + c.width, y: mid }]);
          bands.push(...kids[k]!.bands);
        }
        y += h + listGap;
      }
      bands.push({ y0: ph, y1: y - listGap, l: spine - 1, r: spine + 1 });
      return { members, bands: tighten(bands) };
    }

    if (n === hub) {
      // Wrapped: the branches in rows, the trunk running down between the halves of every row but the last.
      const runs = split(kids, a.wrap);
      let rowTop = ph + gapY;
      let start = 0;
      let lastBus = ph;
      for (const [j, run] of runs.entries()) {
        const idx = run.map((_, i) => start + i);
        start += run.length;
        line(run, gapX, shift);
        const last = j === runs.length - 1;
        if (!last) {
          // Cut where the row's middle is, then pull the halves apart to either side of the trunk.
          const mid = (Math.min(...run.flatMap((s) => s.bands.map((b) => b.l))) + Math.max(...run.flatMap((s) => s.bands.map((b) => b.r)))) / 2;
          let m = run.findIndex((_, i) => centre(idx[i]!) > mid);
          if (m <= 0) m = Math.max(1, Math.floor(run.length / 2));
          const leftHalf = run.slice(0, m);
          const rightHalf = run.slice(m);
          const lr = Math.max(...leftHalf.flatMap((s) => s.bands.map((b) => b.r)));
          for (const s of leftHalf) shift(s, -gapX - lr, 0);
          if (rightHalf.length) {
            const rl = Math.min(...rightHalf.flatMap((s) => s.bands.map((b) => b.l)));
            for (const s of rightHalf) shift(s, gapX - rl, 0);
          }
        } else {
          const c = (centre(idx[0]!) + centre(idx.at(-1)!)) / 2;
          for (const s of run) shift(s, -c, 0);
        }
        for (const s of run) shift(s, 0, rowTop);
        const bus = rowTop - gapY / 2;
        lastBus = bus;
        const xs = idx.map(centre);
        for (const [i, k] of idx.entries()) link.set(n.children[k]!.id, squareDown(0, ph, xs[i]!, bus, rowTop));
        bands.push({ y0: bus - 1, y1: bus + 1, l: Math.min(0, ...xs), r: Math.max(0, ...xs) });
        for (const s of run) bands.push(...s.bands);
        rowTop = Math.max(...run.flatMap((s) => s.bands.map((b) => b.y1))) + gapY;
      }
      bands.push({ y0: ph, y1: lastBus, l: -1, r: 1 });
      return { members, bands: tighten(bands) };
    }

    // A row: branches packed side by side, the manager centred over the first and the last.
    line(kids, gapX, shift);
    const c = (centre(0) + centre(kids.length - 1)) / 2;
    for (const s of kids) shift(s, -c, ph + gapY);
    const bus = ph + gapY / 2;
    const xs = n.children.map((_, k) => centre(k));
    for (const [k, ch] of n.children.entries()) link.set(ch.id, squareDown(0, ph, xs[k]!, bus, ph + gapY));
    bands.push({ y0: bus - 1, y1: bus + 1, l: Math.min(...xs), r: Math.max(...xs) });
    for (const s of kids) bands.push(...s.bands);
    return { members, bands: tighten(bands) };
  };

  layout(top);
  if (top.id === '\u0000') {
    box.delete(top.id);
    for (const r of roots) link.delete(r.id);
  }
  // From 0,0: the drawing's own corner.
  const all = [...box.values()];
  const pts = [...link.values()].flat();
  const x0 = Math.min(...all.map((b) => b.x), ...pts.map((p) => p.x));
  const y0 = Math.min(...all.map((b) => b.y), ...pts.map((p) => p.y));
  for (const b of all) (b.x -= x0), (b.y -= y0);
  for (const p of pts) (p.x -= x0), (p.y -= y0);
  const width = Math.max(...all.map((b) => b.x + b.width), ...pts.map((p) => p.x));
  const height = Math.max(...all.map((b) => b.y + b.height), ...pts.map((p) => p.y));
  return { boxes: box, links: link, width, height, variant: variantOf(a) };
}

/** Down from the manager to the bus, along it, down into the card; straight when it is right below. */
function squareDown(x: number, y: number, to: number, bus: number, top: number): Point[] {
  return Math.abs(to - x) < 0.5 ? [{ x, y }, { x, y: top }] : [{ x, y }, { x, y: bus }, { x: to, y: bus }, { x: to, y: top }];
}

/** Branches side by side, left to right, each as close to the ones before as their outlines allow. */
function line(subs: Sub[], gap: number, shift: (s: Sub, dx: number, dy: number) => void) {
  let acc: Band[] = [];
  for (const s of subs) {
    if (acc.length) {
      let dx = -Infinity;
      for (const a of acc) for (const b of s.bands) if (a.y0 < b.y1 && b.y0 < a.y1) dx = Math.max(dx, a.r + gap - b.l);
      if (dx === -Infinity) dx = Math.max(...acc.map((a) => a.r)) + gap - Math.min(...s.bands.map((b) => b.l));
      shift(s, dx, 0);
    }
    acc = tighten([...acc, ...s.bands]);
  }
}

/** Bands over the same stretch of y become one, so outlines stay short as branches merge. */
function tighten(bands: Band[]): Band[] {
  const by = new Map<string, Band>();
  for (const b of bands) {
    const k = `${Math.round(b.y0 * 10)},${Math.round(b.y1 * 10)}`;
    const was = by.get(k);
    if (was) (was.l = Math.min(was.l, b.l)), (was.r = Math.max(was.r, b.r));
    else by.set(k, { ...b });
  }
  return [...by.values()];
}

/** Branches cut into `k` runs of about equal width, in order. */
function split(subs: Sub[], k: number): Sub[][] {
  const w = subs.map((s) => Math.max(...s.bands.map((b) => b.r)) - Math.min(...s.bands.map((b) => b.l)));
  const total = w.reduce((a, b) => a + b, 0);
  const runs: Sub[][] = [[]];
  let acc = 0;
  for (const [i, s] of subs.entries()) {
    const target = (total * runs.length) / k;
    if (runs.at(-1)!.length && runs.length < k && acc + w[i]! / 2 > target) runs.push([]);
    runs.at(-1)!.push(s);
    acc += w[i]!;
  }
  return runs;
}

/** The node whose branches make the tree wide: the most reports that have reports, the highest first. */
function widest(root: TidyNode): TidyNode | undefined {
  let best: TidyNode | undefined;
  let most = 0;
  const queue = [root];
  while (queue.length) {
    const n = queue.shift()!;
    const inner = n.children.filter((c) => c.children.length).length;
    if (inner > most) (best = n), (most = inner);
    queue.push(...n.children);
  }
  return best && best.children.length >= 4 ? best : undefined;
}
