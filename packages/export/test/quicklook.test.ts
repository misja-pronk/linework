// What Apple's apps (Quick Look, Mail, an iPhone, Preview) need to show a slide as PowerPoint does, and to read a PDF's words.
import { describe, expect, it } from 'vitest';
import { settle, type Para } from '../src/shapes.ts';
import { joinGlyphs } from '../src/pdf.ts';
import { dashCut, legs, trimTo, type Leg } from '../src/slide.ts';

const P = (x: number, y: number) => ({ x, y });
const len = (q: { a: { x: number; y: number }; b: { x: number; y: number } }) => Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y);

describe('lines in pieces', () => {
  it('leaves out a straight stretch no longer than the two round bends at its ends take', () => {
    // A jog of 16 px between two bends of radius 8: nothing is left of it but the bends.
    const list = legs([P(0, 0), P(50, 0), P(50, 16), P(100, 16)], 8, 'round', 1);
    expect(list.every((q) => len(q) > 0.01)).toBe(true);
    expect(list.filter((q) => q.bend)).toHaveLength(8);
    expect(list.filter((q) => !q.bend)).toHaveLength(2);
  });

  it('keeps a line that is not square as its own straight pieces, unrounded', () => {
    const curve = Array.from({ length: 41 }, (_, i) => P(i * 2.5, 40 * Math.sin(i / 13)));
    const list = legs(curve, 8, 'round', 1);
    expect(list.some((q) => q.bend)).toBe(false);
    expect(list.length).toBeLessThan(40);
    expect(list[0]!.a).toEqual(curve[0]);
    expect(list.at(-1)!.b).toEqual(curve.at(-1));
  });

  it('cuts a dashed line where its dashes fall, each dashed piece from the start of a dash to the end of one', () => {
    // Period 7, dashes 4 long. A piece from 0 to 20, then one from 20 to 33.
    const list: Leg[] = [
      { a: P(0, 0), b: P(20, 0), s: 0 },
      { a: P(20, 0), b: P(20, 13), s: 20 },
    ];
    const cut = dashCut(list, 7, 4);
    const span = (q: Leg) => [Math.round((q.a.x + q.a.y) * 100) / 100, Math.round((q.b.x + q.b.y) * 100) / 100];
    // 0–18 holds dashes 0–4, 7–11, 14–18; 20 is in a gap; 21–33 holds dashes 21–25, 28–32 and a gap.
    expect(cut.map((q) => [q.dashed, ...span(q)])).toEqual([
      [true, 0, 18],
      [true, 21, 32],
    ]);
    // A piece that starts inside a dash begins with the rest of it, solid; one that ends inside a dash ends with its start, solid.
    const mid = dashCut([{ a: P(2, 0), b: P(16, 0), s: 2 }], 7, 4);
    expect(mid.map((q) => [q.dashed, ...span(q)])).toEqual([
      [false, 2, 4],
      [true, 7, 11],
      [false, 14, 16],
    ]);
    for (const q of [...cut, ...mid].filter((q) => q.dashed)) expect(((len(q) - 4) / 7) % 1).toBeCloseTo(0);
  });

  it('trims a line to the bend where it leaves a trunk it shares, keeping the bend', () => {
    const pts = [P(0, 100), P(50, 100), P(50, 20), P(120, 20)];
    expect(trimTo(pts, P(50, 20), 9)).toEqual([P(50, 29), P(50, 20), P(120, 20)]);
    expect(trimTo(pts, P(500, 20), 9)).toBe(pts);
  });
});

const frame = { x: 1000, y: 2000, w: 1000000, h: 500000 };
const para = (size: number, align?: Para['align'], before?: number): Para => ({ align, before, runs: [{ text: 'x', size, color: '#000' }] });

describe('settle', () => {
  it('sets text centred over a band from the top, as Apple leaves out the bottom inset', () => {
    // Two lines of 10 and 8 pt, 2 pt apart, centred in the top 400000 EMU of the frame.
    const { text, apart } = settle({ anchor: 'ctr', inset: { l: 5000, b: 100000 }, paras: [para(10), para(8, undefined, 2)] }, frame);
    expect(apart).toBeUndefined();
    expect(text.anchor).toBe('t');
    expect(text.inset).toEqual({ l: 5000, t: (400000 - (1.21 * 18 + 2) * 12700) / 2, r: 0, b: 0 });
  });

  it('drops equal side insets of centred text, which Apple moves by the left one', () => {
    const { text, apart } = settle({ anchor: 'ctr', inset: { l: 4000, r: 4000 }, paras: [para(10, 'ctr')] }, frame);
    expect(apart).toBeUndefined();
    expect(text.inset).toEqual({ l: 0, t: 0, r: 0, b: 0 });
  });

  it('moves centred text with unequal side insets to a box of its own over the room they leave', () => {
    const { text, apart } = settle({ anchor: 'ctr', inset: { l: 300000, r: 80000, b: 100000 }, paras: [para(10, 'ctr')] }, frame);
    expect(apart).toEqual({ x: 301000, y: 2000, w: 620000, h: 500000 });
    expect(text.inset!.l).toBe(0);
    expect(text.inset!.r).toBe(0);
    expect(text.inset!.b).toBe(0);
    expect(text.inset!.t).toBeCloseTo((400000 - 1.21 * 10 * 12700) / 2);
  });

  it('leaves left-aligned text at the top and wrapped text alone', () => {
    const top = { anchor: 't' as const, inset: { l: 3000, t: 2000 }, paras: [para(10)] };
    expect(settle(top, frame).text).toEqual({ ...top, inset: { l: 3000, t: 2000, r: 0, b: 0 } });
    const wrapped = { wrap: true, anchor: 'ctr' as const, inset: { l: 3000, b: 9000 }, paras: [para(10, 'ctr')] };
    expect(settle(wrapped, frame).text).toBe(wrapped);
  });
});

describe('joinGlyphs', () => {
  // Glyph 1 is 500/1000 em wide, glyph 2 is 250.
  const width = (_: string, g: number) => (g === 1 ? 500 : g === 2 ? 250 : undefined);

  it('writes the glyphs of one baseline as one run, each where it was', () => {
    const ops = ['BT', '/F1 10 Tf', '0 Tr', '1 0 0 -1 100 50 Tm', '<0001> Tj', '1 0 0 -1 105 50 Tm', '<0002> Tj', '1 0 0 -1 108 50 Tm', '<0001> Tj', 'ET'];
    // After glyph 2 the pen is at 107.5; the next glyph sits half a point on: -50/1000 em.
    expect(joinGlyphs(ops, width)).toEqual(['BT', '/F1 10 Tf', '0 Tr', '1 0 0 -1 100 50 Tm', '[<0001> <0002> -50 <0001>] TJ', 'ET']);
  });

  it('starts a new run on another baseline, a turned glyph, or a glyph of unknown width', () => {
    const ops = ['BT', '/F1 10 Tf', '1 0 0 -1 100 50 Tm', '<0001> Tj', '1 0 0 -1 105 60 Tm', '<0001> Tj', '0 1 -1 0 110 60 Tm', '<0001> Tj', '1 0 0 -1 120 60 Tm', '<0009> Tj', '1 0 0 -1 125 60 Tm', '<0001> Tj', 'ET'];
    expect(joinGlyphs(ops, width).filter((o) => o.endsWith('Tj') || o.endsWith('TJ'))).toHaveLength(5);
  });
});
