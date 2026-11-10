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
  /** A list of four or more stands in two columns either side of a spine. */
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
  /** Where each card's centre stood in the drawing before, in any frame: the tree is drawn as close to it as it allows. */
  before?: Map<string, Point>;
  /** Cards in one row of the tree, or in one list, as tall as the tallest of them. */
  even?: boolean;
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
const PAIRS = 4;

export const variantOf = (a: Arrangement) => `${a.list === Infinity ? 'row' : `l${a.list}`}${a.pairs ? 'p' : ''}-w${a.wrap}`;

/** "l3p-w2" back to the arrangement it names; undefined for anything else. */
export function arrangementOf(variant: string | undefined): Arrangement | undefined {
  const m = /^(row|l(\d+))(p?)-w(\d+)$/.exec(variant ?? '');
  return m ? { list: m[2] ? Number(m[2]) : Infinity, pairs: m[3] === 'p', wrap: Number(m[4]) } : undefined;
}

/** A drawing known before is followed when at least this share of the cards were in it. */
const KNOWN = 0.5;
/** Following the drawing before may cost this much of the size on a slide before a fresh one is drawn. */
const KEEP = 0.75;

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
        options.push({ ...t, score: scoreOf(t, o) });
      }
  // A previous variant that now comes out like another keeps its name through that other.
  const { score: _, ...best } = choose(options, o.previous && options.some((x) => x.variant === o.previous) ? o.previous : undefined)!;
  // Where the cards stood before is known: draw this tree as close to that as it allows, unless that costs the slide too much.
  if (o.before?.size) {
    const ids = roots.flatMap(function all(n): string[] {
      return [n.id, ...n.children.flatMap(all)];
    });
    if (ids.filter((id) => o.before!.has(id)).length >= Math.max(1, KNOWN * ids.length)) {
      const a = arrangementOf(o.previous) ?? arrangementOf(best.variant)!;
      const fresh = arrangementOf(best.variant)!;
      // Managers with someone new under them may also take a fresh look, the rest as they were.
      const touched = new Set<string>();
      (function walk(n: TidyNode) {
        if (n.children.some((c) => !o.before!.has(c.id))) touched.add(n.id);
        n.children.forEach(walk);
      })(top(roots));
      // And a list that grew may go into two columns, so it does not push down what is under it.
      const owners = new Set<string>();
      (function walk(n: TidyNode) {
        if (touched.has(n.id) || n.children.some((c) => touched.has(c.id))) owners.add(n.id);
        n.children.forEach(walk);
      })(top(roots));
      const tries = [
        arrange(roots, a, o, o.before),
        ...(touched.size ? [{ ...arrange(roots, fresh, o, o.before, touched), variant: variantOf(a) }, arrange(roots, a, o, o.before, undefined, owners)] : []),
        best,
      ];
      const most = Math.max(...options.map((x) => x.score));
      // What the drawing before scored, from where its cards stood: a kept drawing no worse than that is always fine.
      const sizes = new Map<string, TidyNode>();
      (function walk(n: TidyNode) {
        sizes.set(n.id, n);
        n.children.forEach(walk);
      })(top(roots));
      const w0 = [...sizes.values()].reduce((s, n) => s + n.width, 0) / sizes.size;
      const h0 = [...sizes.values()].reduce((s, n) => s + n.height, 0) / sizes.size;
      const was = [...o.before].map(([id, p]) => ({ p, n: sizes.get(id) ?? { width: w0, height: h0 } }));
      const span = (f: (v: (typeof was)[number]) => number[]) => Math.max(...was.map((v) => f(v)[1]!)) - Math.min(...was.map((v) => f(v)[0]!));
      const then = scoreOf({ boxes: new Map(was.map((v, i) => [String(i), { x: 0, y: 0, width: v.n.width, height: v.n.height }])), links: new Map(), width: span((v) => [v.p.x - v.n.width / 2, v.p.x + v.n.width / 2]), height: span((v) => [v.p.y - v.n.height / 2, v.p.y + v.n.height / 2]), variant: '' }, o);
      // The one that moves least of those that still fit the slide well; the fresh drawing always does.
      let pick = best;
      let least = Infinity;
      for (const t of tries) {
        if (t !== best && scoreOf(t, o) < Math.min(KEEP * most, 0.97 * then)) continue;
        const d = drift(t.boxes, o.before);
        if (d < least - 1e-9) (pick = t), (least = d);
      }
      return pick;
    }
  }
  return best;
}

const top = (roots: TidyNode[]): TidyNode => (roots.length === 1 ? roots[0]! : { id: '\u0000', width: 0, height: 0, children: roots });

/**
 * Share of the cards that stood somewhere before and now stand more than 16 px from it, the common
 * slide taken out: the slide that leaves the most cards where they were, as the eye sees it.
 */
export function drift(boxes: Map<string, Box>, before: Map<string, Point>): number {
  const d = [...boxes].filter(([id]) => before.has(id)).map(([id, b]) => ({ x: b.x + b.width / 2 - before.get(id)!.x, y: b.y + b.height / 2 - before.get(id)!.y }));
  if (!d.length) return 0;
  const slides = new Map(d.map((p) => [`${Math.round(p.x)},${Math.round(p.y)}`, p]));
  let most = 0;
  for (const s of slides.values()) most = Math.max(most, d.filter((p) => Math.hypot(p.x - s.x, p.y - s.y) <= 16).length);
  return 1 - most / d.length;
}

function scoreOf(t: Tidied, o: TidyOptions): number {
  const area = [...t.boxes.values()].reduce((s, b) => s + b.width * b.height, 0);
  return slideScale(t.width, t.height, o.frame, o.aspect) * (0.85 + (0.15 * area) / Math.max(1, t.width * t.height));
}

/** How a manager's reports stand: some in a list under the card, the rest in a row beside it (or wrapped into rows). */
interface Plan {
  list: TidyNode[];
  row: TidyNode[];
  /** The list in two columns either side of a spine. */
  pairs: boolean;
  /** The row wrapped into these runs, the trunk between the halves of every run but the last. */
  runs?: TidyNode[][];
  /** In runs kept from the drawing before: who stands left of the trunk. */
  left?: Set<string>;
  /** In two columns: which column each stands in (alternating when not given). */
  side?: Map<TidyNode, 'l' | 'r'>;
  /** A list hung under someone in the left column of two: its spine on the right, so it stays clear of the middle. */
  mirror?: boolean;
}

/**
 * One arrangement, laid out. Given where the cards stood before (`before`, centres in any frame),
 * every manager keeps the way its reports stood (list, two columns, row, rows), every branch stays
 * as close to where it was as its neighbours allow, and only a manager over a changed row moves to
 * the middle of it: one more person moves the cards beside them, not the chart. Managers named in
 * `again` are planned afresh by `a` all the same; a list of one column under a manager named in
 * `fold` goes into two, so it grows down half as fast.
 */
export function arrange(roots: TidyNode[], a: Arrangement, o: TidyOptions = {}, before?: Map<string, Point>, again?: Set<string>, fold?: Set<string>): Tidied {
  const gapX = o.gapX ?? 20;
  const gapY = o.gapY ?? 44;
  const listGap = o.listGap ?? 10;
  const indent = o.indent ?? 28;
  const box = new Map<string, Box>();
  const link = new Map<string, Point[]>();

  // A forest hangs from a root of no size, whose connectors are not drawn.
  const virtual = roots.length !== 1;
  const top: TidyNode = virtual ? { id: '\u0000', width: 0, height: 0, children: roots } : roots[0]!;
  const freshHub = !before && a.wrap > 1 ? widest(top) : undefined;
  const leaf = (n: TidyNode) => !n.children.length;
  const was = (id: string) => before?.get(id);

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

  // Leaves in a list from `a.list` of them on; any reports with reports of their own beside it in a row.
  const freshPlan = (n: TidyNode): Plan => {
    const leaves = n.children.filter(leaf);
    if (n === freshHub || leaves.length < a.list) return { list: [], row: n.children, pairs: false };
    return { list: leaves, row: n.children.filter((c) => !leaf(c)), pairs: a.pairs && leaves.length >= PAIRS };
  };

  // As the drawing before had them: each report in the list, in the two columns or in the row it stood in.
  const keptPlan = (n: TidyNode): Plan => {
    const at = was(n.id);
    const seen = new Map<TidyNode, { kind: 'list' | 'pairs' | 'row'; x: number; y: number }>();
    if (at)
      for (const c of n.children) {
        const p = was(c.id);
        if (!p) continue;
        const dx = p.x - at.x;
        if (p.y <= at.y) continue;
        const kind = Math.abs(dx - (-n.width / 2 + indent + c.width / 2)) < 3 ? 'list' : Math.abs(Math.abs(dx) - (STUB + c.width / 2)) < 3 ? 'pairs' : 'row';
        seen.set(c, { kind, x: p.x, y: p.y });
      }
    // A row hangs right under the manager (its first run, when wrapped); anyone else standing somewhere is someone who came from elsewhere.
    const rowed = [...seen].filter(([, v]) => v.kind === 'row');
    const first = rowed.find(([c, v]) => Math.abs(v.y - c.height / 2 - (at!.y + n.height / 2) - gapY) < 30);
    if (!first) for (const [c] of rowed) seen.delete(c);
    // Two columns are two columns only with three or more in them over more than one height; else a row that happens to stand so.
    const paired = [...seen.values()].filter((v) => v.kind === 'pairs');
    if (paired.length < 3 || new Set(paired.map((v) => Math.round(v.y))).size < 2) for (const v of paired) v.kind = 'row';
    if (!seen.size || again?.has(n.id)) return freshPlan(n);
    // Rows of branches one under the other: the wrap stays, each branch in its run and on its side of the trunk.
    // A run lower down reaches across the trunk; one that does not is someone who came from elsewhere.
    const ys = [...new Set([...seen.values()].filter((v) => v.kind === 'row').map((v) => v.y))].sort((p, q) => p - q);
    const levels = ys.filter((y, i) => i === 0 || y - ys[i - 1]! > 4);
    for (const j of [...levels.keys()].reverse()) {
      if (!j) continue;
      const on = [...seen].filter(([, v]) => v.kind === 'row' && levels.findLastIndex((l) => l <= v.y + 4) === j);
      if (on.some(([c, v]) => v.x - c.width / 2 <= at!.x) && on.some(([c, v]) => v.x + c.width / 2 >= at!.x)) continue;
      for (const [c] of on) seen.delete(c);
      levels.splice(j, 1);
    }
    if (!seen.size) return freshPlan(n);
    const kinds = [...seen.values()].map((v) => v.kind);
    if (levels.length >= 2) {
      const run = new Map<TidyNode, number>();
      const left = new Map<TidyNode, boolean>();
      for (const c of n.children) {
        const v = seen.get(c);
        if (v?.kind === 'row') {
          run.set(c, levels.findLastIndex((y) => y <= v.y + 4));
          left.set(c, v.x < at!.x);
        }
      }
      // Who is new takes the run and side of the one before, or of the one after.
      const order = n.children;
      for (const pass of [order, [...order].reverse()])
        for (const [i, c] of pass.entries()) {
          if (run.has(c) || i === 0) continue;
          const k = pass[i - 1]!;
          if (run.has(k)) run.set(c, run.get(k)!), left.set(c, left.get(k)!);
        }
      const runs = levels.map((_, j) => order.filter((c) => (run.get(c) ?? 0) === j)).filter((r) => r.length);
      return { list: [], row: order, pairs: false, runs, left: new Set([...left].filter(([, v]) => v).map(([c]) => c.id)) };
    }
    const mode = kinds.includes('pairs') ? 'pairs' : kinds.includes('list') ? 'list' : undefined;
    const list: TidyNode[] = [];
    const row: TidyNode[] = [];
    for (const c of n.children) {
      const k = seen.get(c)?.kind;
      // A list keeps its people; one who gains reports stays in it with them hung under.
      if ((mode === 'list' && k === 'list') || (mode === 'pairs' && k === 'pairs') || (mode && !k && leaf(c))) list.push(c);
      else row.push(c);
    }
    if (mode !== 'pairs' && !(fold?.has(n.id) && list.length >= PAIRS - 1)) return { list, row, pairs: false };
    if (mode !== 'pairs') return { list, row, pairs: true };
    // Two columns: everyone stays in theirs, and who is new joins the shorter one.
    const side = new Map<TidyNode, 'l' | 'r'>();
    for (const c of list) if (seen.has(c)) side.set(c, seen.get(c)!.x < at!.x ? 'l' : 'r');
    const count = (k: 'l' | 'r') => [...side.values()].filter((v) => v === k).length;
    for (const c of list) if (!side.has(c)) side.set(c, count('l') <= count('r') ? 'l' : 'r');
    return { list, row, pairs: true, side };
  };

  // Every manager's plan, and which cards share a height: a row of a tree's level, or one list.
  const plans = new Map<TidyNode, Plan>();
  const group = new Map<TidyNode, string>();
  const visit = (n: TidyNode, depth: number, outline: 'l' | 'r' | undefined, g: string) => {
    group.set(n, g);
    if (!n.children.length) return;
    const p: Plan = n === top && virtual ? { list: [], row: n.children, pairs: false } : outline ? { list: n.children, row: [], pairs: false, mirror: outline === 'l' } : before ? keptPlan(n) : freshPlan(n);
    plans.set(n, p);
    const listed = new Set(p.list);
    for (const [k, c] of p.list.entries()) {
      const side = p.pairs && p.list.length > 1 ? (p.side?.get(c) ?? (k % 2 ? 'r' : 'l')) : p.mirror ? 'l' : 'r';
      visit(c, depth + 1, leaf(c) ? undefined : side, `l:${n.id}`);
    }
    for (const c of n.children) if (!listed.has(c)) visit(c, depth + 1, undefined, `r:${depth + 1}`);
  };
  visit(top, 0, undefined, 'r:0');
  const tallest = new Map<string, number>();
  for (const [n, g] of group) tallest.set(g, Math.max(tallest.get(g) ?? 0, n.height));
  const H = (n: TidyNode) => (o.even ? tallest.get(group.get(n)!)! : n.height);

  /** Where a branch stood before, as the shift from where it is now: what most of its cards agree on. */
  const pull = (s: Sub): { at?: number; weight: number } => {
    const d = s.members.flatMap((id) => {
      const p = was(id);
      const b = box.get(id)!;
      return p ? [p.x - (b.x + b.width / 2)] : [];
    });
    if (!d.length) return { weight: 0 };
    d.sort((p, q) => p - q);
    const at = d[(d.length - 1) >> 1]!;
    return { at, weight: d.filter((x) => Math.abs(x - at) <= 16).length };
  };
  const spreadSubs = (subs: Sub[], fixed?: { index: number; at: number }) => {
    const pulls = subs.map(pull);
    if (fixed) pulls[fixed.index] = { at: fixed.at, weight: 1e6 };
    return spread(subs, pulls, gapX);
  };

  const layout = (n: TidyNode): Sub => {
    const ph = H(n);
    box.set(n.id, { x: -n.width / 2, y: 0, width: n.width, height: ph });
    const own: Band = { y0: 0, y1: ph, l: -n.width / 2, r: n.width / 2 };
    if (!n.children.length) return { members: [n.id], bands: [own] };
    const plan = plans.get(n)!;
    const kids = new Map(n.children.map((c) => [c, layout(c)]));
    const sub = (c: TidyNode) => kids.get(c)!;
    const members = [n.id, ...n.children.flatMap((c) => sub(c).members)];
    const bands: Band[] = [own];
    const centre = (c: TidyNode) => box.get(c.id)!.x + c.width / 2;

    if (plan.list.length) {
      // A list: one column hanging from a spine at the left, or two either side of one in the middle.
      // Beside a row it starts lower, so the row's bus passes over it.
      const two = plan.pairs && plan.list.length > 1;
      const spine = two ? 0 : plan.mirror ? n.width / 2 - indent / 2 : -n.width / 2 + indent / 2;
      const start = ph + (plan.row.length ? gapY : gapY / 2);
      const next = { l: start, r: start };
      let end = start;
      for (const [k, c] of plan.list.entries()) {
        const side = two ? (plan.side?.get(c) ?? (k % 2 ? 'r' : 'l')) : plan.mirror ? 'l' : 'r';
        const right = side === 'r';
        const x0 = two ? (right ? STUB : -STUB - c.width) : plan.mirror ? n.width / 2 - indent - c.width : -n.width / 2 + indent;
        const y = next[two ? side : 'l'];
        shift(sub(c), x0 + c.width / 2, y);
        const mid = y + H(c) / 2;
        link.set(c.id, [{ x: spine, y: ph }, { x: spine, y: mid }, { x: right ? x0 : x0 + c.width, y: mid }]);
        bands.push(...sub(c).bands);
        // Someone in the list with reports of their own: the list goes on under them.
        const below = Math.max(...sub(c).bands.map((b) => b.y1)) + listGap;
        next[two ? side : 'l'] = below;
        end = Math.max(end, below);
      }
      bands.push({ y0: ph, y1: end - listGap, l: spine - 1, r: spine + 1 });
      if (!plan.row.length) return { members, bands: tighten(bands) };
    }

    if (plan.runs || n === freshHub) {
      // Wrapped: the branches in rows, the trunk running down between the halves of every row but the last.
      const runs = plan.runs ?? split(n.children.map(sub), a.wrap).map((r) => r.map((s) => n.children.find((c) => sub(c) === s)!));
      const trunk = plan.runs ? was(n.id)?.x : undefined;
      const hubTop = was(n.id) ? was(n.id)!.y - ph / 2 : undefined;
      let rowTop = ph + gapY;
      let lastBus = ph;
      for (const [j, run] of runs.entries()) {
        const last = j === runs.length - 1;
        if (trunk !== undefined) {
          const order = last ? run : [...run.filter((c) => plan.left!.has(c.id)), ...run.filter((c) => !plan.left!.has(c.id))];
          const subs = order.map(sub);
          const lefts = last ? -1 : order.filter((c) => plan.left!.has(c.id)).length;
          if (!last) subs.splice(lefts, 0, { members: [], bands: [{ y0: -1e9, y1: 1e9, l: 0, r: 0 }] });
          const pos = spreadSubs(subs, last ? undefined : { index: lefts, at: trunk });
          const lost = last && !subs.some((s) => pull(s).weight);
          for (const [i, s] of subs.entries()) shift(s, pos[i]! - trunk, 0);
          if (lost) {
            const c = (centre(order[0]!) + centre(order.at(-1)!)) / 2;
            for (const s of subs) shift(s, -c, 0);
          }
        } else {
          const subs = run.map(sub);
          line(subs, gapX, shift);
          if (!last) {
            // Cut where the row's middle is, then pull the halves apart to either side of the trunk.
            const mid = (Math.min(...subs.flatMap((s) => s.bands.map((b) => b.l))) + Math.max(...subs.flatMap((s) => s.bands.map((b) => b.r)))) / 2;
            let m = run.findIndex((c) => centre(c) > mid);
            if (m <= 0) m = Math.max(1, Math.floor(run.length / 2));
            const leftHalf = subs.slice(0, m);
            const rightHalf = subs.slice(m);
            const lr = Math.max(...leftHalf.flatMap((s) => s.bands.map((b) => b.r)));
            for (const s of leftHalf) shift(s, -gapX - lr, 0);
            if (rightHalf.length) {
              const rl = Math.min(...rightHalf.flatMap((s) => s.bands.map((b) => b.l)));
              for (const s of rightHalf) shift(s, gapX - rl, 0);
            }
          } else {
            const c = (centre(run[0]!) + centre(run.at(-1)!)) / 2;
            for (const s of subs) shift(s, -c, 0);
          }
        }
        // A run kept from before stays at its height when the one above it got shorter.
        const tops = hubTop === undefined ? [] : run.flatMap((c) => (was(c.id) ? [was(c.id)!.y - H(c) / 2 - hubTop] : []));
        if (trunk !== undefined && tops.length) rowTop = Math.max(rowTop, tops.sort((p, q) => p - q)[(tops.length - 1) >> 1]!);
        for (const c of run) shift(sub(c), 0, rowTop);
        const bus = rowTop - gapY / 2;
        lastBus = bus;
        const xs = run.map(centre);
        for (const [i, c] of run.entries()) link.set(c.id, squareDown(0, ph, xs[i]!, bus, rowTop));
        bands.push({ y0: bus - 1, y1: bus + 1, l: Math.min(0, ...xs), r: Math.max(0, ...xs) });
        for (const c of run) bands.push(...sub(c).bands);
        rowTop = Math.max(...run.flatMap((c) => sub(c).bands.map((b) => b.y1))) + gapY;
      }
      bands.push({ y0: ph, y1: lastBus, l: -1, r: 1 });
      return { members, bands: tighten(bands) };
    }

    // A row: branches packed side by side, the manager centred over the first and the last (or, beside a
    // list, standing over the list with the row to its right).
    const rowTop = ph + gapY;
    const subs = plan.row.map(sub);
    for (const s of subs) shift(s, 0, rowTop);
    const head: Sub | undefined = plan.list.length ? { members: [n.id, ...plan.list.flatMap((c) => sub(c).members)], bands } : undefined;
    const items = head ? [head, ...subs] : subs;
    const pos = spreadSubs(items);
    for (const [i, s] of items.entries()) shift(s, pos[i]!, 0);
    let c = head ? pos[0]! : 0;
    if (!head) {
      // With an odd number of branches the manager stands right over the middle one when that is close: one straight trunk, no kink beside it.
      const cs = plan.row.map(centre);
      const mid = (cs[0]! + cs.at(-1)!) / 2;
      const median = cs.length % 2 ? cs[(cs.length - 1) / 2]! : mid;
      c = Math.abs(median - mid) < 0.2 * (cs.at(-1)! - cs[0]!) ? median : mid;
    }
    for (const s of items) shift(s, -c, 0);
    const bus = ph + gapY / 2;
    const xs = plan.row.map(centre);
    for (const [k, ch] of plan.row.entries()) link.set(ch.id, squareDown(0, ph, xs[k]!, bus, rowTop));
    bands.push({ y0: bus - 1, y1: bus + 1, l: Math.min(0, ...xs), r: Math.max(0, ...xs) });
    for (const s of subs) bands.push(...s.bands);
    return { members, bands: tighten(bands) };
  };

  layout(top);
  if (virtual) {
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

/** How far right `b` must stand to clear `a` standing at `at`, by `gap`. */
function clear(a: Band[], at: number, b: Band[], gap: number): number {
  let dx = -Infinity;
  for (const p of a) for (const q of b) if (p.y0 < q.y1 && q.y0 < p.y1) dx = Math.max(dx, p.r + at + gap - q.l);
  return dx === -Infinity ? Math.max(...a.map((p) => p.r)) + at + gap - Math.min(...b.map((q) => q.l)) : dx;
}

/**
 * Where branches stand side by side, in order: each as close to where it was (`at`) as the others
 * allow. Branches that would overlap are pushed together into a block, which stands where most of
 * its cards were (a weighted median, as in pool-adjacent-violators). A branch that is new packs
 * tight against its neighbour; with nothing known they all pack tight from 0, as `line` does.
 */
function spread(subs: Sub[], pulls: { at?: number; weight: number }[], gap: number): number[] {
  const n = subs.length;
  const want = pulls.map((p) => (p.weight ? p.at : undefined));
  const weight = pulls.map((p) => Math.max(p.weight, 1e-3));
  if (want.every((w) => w === undefined)) {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(i ? Math.max(...out.map((o, j) => clear(subs[j]!.bands, o, subs[i]!.bands, gap))) : 0);
    return out;
  }
  for (let i = 1; i < n; i++) if (want[i] === undefined && want[i - 1] !== undefined) want[i] = clear(subs[i - 1]!.bands, want[i - 1]!, subs[i]!.bands, gap);
  for (let i = n - 2; i >= 0; i--) if (want[i] === undefined && want[i + 1] !== undefined) want[i] = want[i + 1]! - clear(subs[i]!.bands, 0, subs[i + 1]!.bands, gap);
  interface Block {
    items: number[];
    rel: number[];
    bands: Band[];
    at: number;
  }
  const median = (b: Block) => {
    const v = b.items.map((i, k) => ({ x: want[i]! - b.rel[k]!, w: weight[i]! })).sort((p, q) => p.x - q.x);
    const half = v.reduce((s, p) => s + p.w, 0) / 2;
    let acc = 0;
    for (const p of v) if ((acc += p.w) >= half - 1e-9) return p.x;
    return v.at(-1)!.x;
  };
  const stack: Block[] = [];
  for (let i = 0; i < n; i++) {
    let b: Block = { items: [i], rel: [0], bands: subs[i]!.bands.map((x) => ({ ...x })), at: want[i]! };
    while (stack.length) {
      const least = Math.max(...stack.map((e) => clear(e.bands, e.at, b.bands, gap)));
      if (b.at >= least - 1e-6) break;
      const p = stack.pop()!;
      const r = clear(p.bands, 0, b.bands, gap);
      b = { items: [...p.items, ...b.items], rel: [...p.rel, ...b.rel.map((x) => x + r)], bands: tighten([...p.bands, ...b.bands.map((x) => ({ ...x, l: x.l + r, r: x.r + r }))]), at: 0 };
      b.at = median(b);
    }
    stack.push(b);
  }
  const out = new Array<number>(n);
  for (const b of stack) for (const [k, i] of b.items.entries()) out[i] = b.at + b.rel[k]!;
  return out;
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
