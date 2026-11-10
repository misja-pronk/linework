import { describe, expect, it } from 'vitest';
import type { Box, Point } from '@cartography/core';
import { choose, pack, route, slideScale, tidy, type PackItem, type TidyNode } from '../src/index.ts';
import { rng } from './fixtures.ts';

const inside = (a: Box, b: Box) => a.x >= b.x - 0.01 && a.y >= b.y - 0.01 && a.x + a.width <= b.x + b.width + 0.01 && a.y + a.height <= b.y + b.height + 0.01;
const hit = (a: Box, b: Box) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

/** Share of what was there that moved more than 16 px, the common slide taken out (as the stability lab counts). */
function moved(before: Map<string, Box>, after: Map<string, Box>): number {
  const d = [...before].filter(([id]) => after.has(id)).map(([id, b]) => ({ x: after.get(id)!.x - b.x, y: after.get(id)!.y - b.y }));
  const med = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1]!;
  const mx = med(d.map((p) => p.x));
  const my = med(d.map((p) => p.y));
  return d.filter((p) => Math.hypot(p.x - mx, p.y - my) > 16).length / d.length;
}

/** A map of `areas` areas with a few capabilities and chips each. */
function map(areas: number, seed = 3): PackItem[] {
  const r = rng(seed);
  return Array.from({ length: areas }, (_, a) => ({
    id: `a${a}`,
    width: 140,
    height: 34,
    children: Array.from({ length: 3 + Math.floor(r() * 4) }, (_, c) => {
      const chips = r() < 0.25 ? 0 : 2 + Math.floor(r() * 4);
      return { id: `a${a}c${c}`, width: 150 + Math.floor(r() * 40), height: chips ? 32 : 36, children: Array.from({ length: chips }, (_, k) => ({ id: `a${a}c${c}k${k}`, width: 110 + Math.floor(r() * 40), height: 28 })) };
    }),
  }));
}

function walk(items: PackItem[], depth = 0, out: { item: PackItem; depth: number; parent?: PackItem }[] = [], parent?: PackItem) {
  for (const it of items) {
    out.push({ item: it, depth, parent });
    walk(it.children ?? [], depth + 1, out, it);
  }
  return out;
}

describe('pack', () => {
  const roots = map(8);
  const p = pack(roots);
  const all = walk(roots);

  it('puts every box inside its parent, and siblings never on top of each other', () => {
    for (const { item, parent } of all) {
      const b = p.boxes.get(item.id)!;
      expect(b.width).toBeGreaterThanOrEqual(item.width);
      if (parent) expect(inside(b, p.boxes.get(parent.id)!), item.id).toBe(true);
    }
    const byParent = new Map<string, string[]>();
    for (const { item, parent } of all) byParent.set(parent?.id ?? '', [...(byParent.get(parent?.id ?? '') ?? []), item.id]);
    for (const ids of byParent.values()) for (const [i, a] of ids.entries()) for (const b of ids.slice(i + 1)) expect(hit(p.boxes.get(a)!, p.boxes.get(b)!), `${a} × ${b}`).toBe(false);
  });

  it('makes every box of a level as wide as the others', () => {
    for (const d of [0, 1, 2]) expect(new Set(all.filter((x) => x.depth === d).map((x) => p.boxes.get(x.item.id)!.width)).size, `level ${d + 1}`).toBe(1);
  });

  it('comes close to a 16:9 slide, wrapping areas into rows or lanes', () => {
    expect(p.width / p.height).toBeGreaterThan(1.2);
    expect(p.width / p.height).toBeLessThan(2.6);
    // A long row of areas would be one strip: the search does better than putting them all side by side.
    const strip = pack(roots, { columns: [8] });
    expect(slideScale(p.width, p.height)).toBeGreaterThan(slideScale(strip.width, strip.height));
  });

  it('is the same every time, and a band layout puts the areas one under the other', () => {
    expect(pack(roots).variant).toBe(p.variant);
    expect([...pack(roots).boxes]).toEqual([...p.boxes]);
    const bands = pack(roots, { mode: 'bands' });
    const tops = roots.map((r) => bands.boxes.get(r.id)!);
    for (let i = 1; i < tops.length; i++) expect(tops[i]!.y).toBeGreaterThan(tops[i - 1]!.y + tops[i - 1]!.height - 1);
  });

  it('keeps what is there in place when one chip is added', () => {
    const shares: number[] = [];
    for (let a = 0; a < 8; a++) {
      const more = structuredClone(roots);
      const cap = more[a]!.children!.find((c) => c.children?.length)!;
      cap.children!.push({ id: `${cap.id}-new`, width: 120, height: 28 });
      const after = pack(more, { previous: p.variant });
      expect(after.variant).toBe(p.variant);
      shares.push(moved(p.boxes, after.boxes));
    }
    // Only what stands below the new chip in its own column moves.
    expect(Math.max(...shares)).toBeLessThan(0.25);
    expect(shares.reduce((a, b) => a + b, 0) / shares.length).toBeLessThan(0.12);
  });

  it('lays out 300 boxes fast', () => {
    const big = map(16, 9);
    expect(walk(big).length).toBeGreaterThan(250);
    const t0 = performance.now();
    pack(big);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

/** An org: `n` managers under one top, each with `k` reports. */
function org(n: number, k: (i: number) => number): TidyNode {
  const card = (id: string, children: TidyNode[] = []): TidyNode => ({ id, width: 200, height: 64, children });
  return card('top', Array.from({ length: n }, (_, i) => card(`m${i}`, Array.from({ length: k(i) }, (_, j) => card(`m${i}p${j}`)))));
}

function nodes(n: TidyNode, out: TidyNode[] = []) {
  out.push(n);
  for (const c of n.children) nodes(c, out);
  return out;
}

describe('tidy', () => {
  it('centres a manager over the reports and keeps cards apart', () => {
    const t = tidy([org(3, () => 2)], { fixed: { list: Infinity, wrap: 1, pairs: false } });
    const all = [...t.boxes.values()];
    for (const [i, a] of all.entries()) for (const b of all.slice(i + 1)) expect(hit(a, b)).toBe(false);
    const top = t.boxes.get('top')!;
    const m1 = t.boxes.get('m1')!;
    expect(top.x + top.width / 2).toBeCloseTo(m1.x + m1.width / 2);
    for (const id of ['m0', 'm1', 'm2']) expect(t.boxes.get(id)!.y).toBeGreaterThan(top.y + top.height);
    // Square connectors from the bottom of the manager to the top of the report.
    for (const [id, pts] of t.links) {
      for (let i = 1; i < pts.length; i++) expect(pts[i]!.x === pts[i - 1]!.x || pts[i]!.y === pts[i - 1]!.y, id).toBe(true);
      expect(pts.at(-1)!.y).toBeCloseTo(t.boxes.get(id)!.y);
    }
  });

  it('hangs reports without reports in a list, in two columns when there are many', () => {
    const one = tidy([org(2, () => 3)], { fixed: { list: 2, pairs: false, wrap: 1 } });
    const xs = new Set(['m0p0', 'm0p1', 'm0p2'].map((id) => one.boxes.get(id)!.x));
    expect(xs.size).toBe(1);
    const two = tidy([org(2, () => 6)], { fixed: { list: 2, pairs: true, wrap: 1 } });
    expect(new Set(['m0p0', 'm0p1', 'm0p2', 'm0p3'].map((id) => two.boxes.get(id)!.x)).size).toBe(2);
  });

  it('wraps a wide tree into rows with the trunk between them, and picks what fits a slide', () => {
    const wide = org(8, (i) => 3 + (i % 3));
    const row = tidy([wide], { fixed: { list: 2, pairs: false, wrap: 1 } });
    const wrapped = tidy([wide], { fixed: { list: 2, pairs: false, wrap: 2 } });
    expect(wrapped.width).toBeLessThan(row.width * 0.7);
    const all = [...wrapped.boxes.values()];
    for (const [i, a] of all.entries()) for (const b of all.slice(i + 1)) expect(hit(a, b)).toBe(false);
    // The connectors pass through no card but their own two.
    for (const [id, pts] of wrapped.links)
      for (const [other, b] of wrapped.boxes) {
        if (other === id || other === 'top') continue;
        for (let i = 1; i < pts.length; i++) {
          const s = { x: Math.min(pts[i]!.x, pts[i - 1]!.x), y: Math.min(pts[i]!.y, pts[i - 1]!.y), width: Math.abs(pts[i]!.x - pts[i - 1]!.x) + 0.1, height: Math.abs(pts[i]!.y - pts[i - 1]!.y) + 0.1 };
          expect(hit(s, { x: b.x + 2, y: b.y + 2, width: b.width - 4, height: b.height - 4 }), `${id} through ${other}`).toBe(false);
        }
      }
    const best = tidy([wide]);
    expect(slideScale(best.width, best.height)).toBeGreaterThanOrEqual(slideScale(row.width, row.height));
  });

  it('keeps the arrangement and moves little when one person joins', () => {
    const base = org(6, (i) => 2 + (i % 4));
    const before = tidy([base]);
    let total = 0;
    for (let i = 0; i < 6; i++) {
      const more = structuredClone(base);
      more.children[i]!.children.push({ id: `new${i}`, width: 200, height: 64, children: [] });
      const after = tidy([more], { previous: before.variant });
      expect(after.variant).toBe(before.variant);
      total += moved(before.boxes, after.boxes);
    }
    expect(total / 6).toBeLessThan(0.35);
  });

  const centres = (t: { boxes: Map<string, Box> }) => new Map([...t.boxes].map(([id, b]) => [id, { x: b.x + b.width / 2, y: b.y + b.height / 2 }]));

  it('follows the drawing before card by card: a report added, removed or given a report moves only what is beside it', () => {
    // Wrapped into two rows, lists under every manager: the big org's shape.
    const big = org(24, (i) => 3 + ((i * 5) % 6));
    const before = tidy([big], { fixed: { list: 2, pairs: false, wrap: 2 } });
    const shares: Record<string, number[]> = { add: [], remove: [], first: [] };
    for (let i = 0; i < 24; i += 3) {
      const add = structuredClone(big);
      add.children[i]!.children.push({ id: 'new', width: 200, height: 64, children: [] });
      const remove = structuredClone(big);
      remove.children[i]!.children.splice(1, 1);
      const first = structuredClone(big);
      first.children[i]!.children[1]!.children.push({ id: 'new', width: 200, height: 64, children: [] });
      for (const [k, t] of Object.entries({ add, remove, first })) shares[k]!.push(moved(before.boxes, tidy([t], { previous: before.variant, before: centres(before) }).boxes));
    }
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    // Knowing only the variant, a first report moved 0.39 of the cards (worst 0.5): the list turned into a row. Now 0.13 (0.23).
    expect(mean(shares.add!)).toBeLessThan(0.03);
    expect(mean(shares.remove!)).toBeLessThan(0.05);
    expect(mean(shares.first!)).toBeLessThan(0.16);
    expect(Math.max(...shares.add!, ...shares.remove!, ...shares.first!)).toBeLessThan(0.28);
  });

  it('keeps someone who gains a report in their list, with the report hung under them', () => {
    const base = org(3, () => 5);
    const before = tidy([base], { fixed: { list: 2, pairs: false, wrap: 1 } });
    const more = structuredClone(base);
    more.children[1]!.children[0]!.children.push({ id: 'new', width: 200, height: 64, children: [] });
    const after = tidy([more], { previous: before.variant, before: centres(before) });
    const b = (id: string) => after.boxes.get(id)!;
    expect(b('m1p1').x).toBe(b('m1p0').x);
    expect(b('new').x).toBeGreaterThan(b('m1p0').x);
    expect(b('new').y).toBeGreaterThan(b('m1p0').y + b('m1p0').height);
    expect(b('m1p1').y).toBeGreaterThan(b('new').y + b('new').height);
    const all = [...after.boxes.values()];
    for (const [i, a] of all.entries()) for (const c of all.slice(i + 1)) expect(hit(a, c)).toBe(false);
  });

  it('hangs reports without reports in a list beside reports with reports of their own', () => {
    const card = (id: string, children: TidyNode[] = []): TidyNode => ({ id, width: 200, height: 64, children });
    const t = tidy([card('top', [card('a'), card('b', [card('b1'), card('b2')]), card('c'), card('d')])], { fixed: { list: 2, pairs: false, wrap: 1 } });
    const x = (id: string) => t.boxes.get(id)!.x;
    expect(new Set(['a', 'c', 'd'].map(x)).size).toBe(1);
    expect(x('b')).toBeGreaterThan(x('a') + 200);
    const all = [...t.boxes.values()];
    for (const [i, a] of all.entries()) for (const c of all.slice(i + 1)) expect(hit(a, c)).toBe(false);
  });

  it('places 150 people fast', () => {
    const big = org(30, (i) => 3 + (i % 3));
    expect(nodes(big).length).toBeGreaterThan(140);
    const t0 = performance.now();
    tidy([big]);
    expect(performance.now() - t0).toBeLessThan(800);
  });

  it('lays out a forest side by side', () => {
    const t = tidy([org(1, () => 1), { ...org(1, () => 1), id: 'top2', children: [{ id: 'x', width: 200, height: 64, children: [] }] }]);
    expect(t.boxes.has('top2')).toBe(true);
    expect(t.links.has('top')).toBe(false);
  });
});

describe('route', () => {
  const box = (x: number, y: number, w = 100, h = 40): Box => ({ x, y, width: w, height: h });
  it('goes around what is in the way, square', () => {
    const a = box(0, 0);
    const b = box(400, 0);
    const wall = box(180, -100, 40, 240);
    const pts = route([a, b, wall], { box: a, sides: ['E'] }, { box: b, sides: ['W'] })!;
    expect(pts[0]).toEqual({ x: 100, y: 20 });
    expect(pts.at(-1)).toEqual({ x: 400, y: 20 });
    for (let i = 1; i < pts.length; i++) {
      const p: Point = pts[i]!;
      const q = pts[i - 1]!;
      expect(p.x === q.x || p.y === q.y).toBe(true);
      const s = { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(p.x - q.x) + 0.1, height: Math.abs(p.y - q.y) + 0.1 };
      expect(hit(s, wall)).toBe(false);
    }
  });
  it('keeps a lane of its own beside a line that is there', () => {
    const a = box(0, 0);
    const b = box(400, 200);
    const line = [{ x: 50, y: 120 }, { x: 450, y: 120 }];
    const pts = route([a, b], { box: a, sides: ['S'] }, { box: b, sides: ['N'] }, { lines: [line] })!;
    const level = pts.slice(1).filter((p, i) => p.y === pts[i]!.y);
    expect(level.every((p) => Math.abs(p.y - 120) > 5)).toBe(true);
  });
});

describe('choose', () => {
  it('keeps the variant drawn before unless another is clearly better', () => {
    const o = [{ variant: 'a', score: 1 }, { variant: 'b', score: 1.05 }];
    expect(choose(o)!.variant).toBe('b');
    expect(choose(o, 'a')!.variant).toBe('a');
    expect(choose([{ variant: 'a', score: 1 }, { variant: 'b', score: 2 }], 'a')!.variant).toBe('b');
  });
});
