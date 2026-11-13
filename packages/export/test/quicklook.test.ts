// What Apple's apps (Quick Look, Mail, an iPhone, Preview) need to show a slide as PowerPoint does, and to read a PDF's words.
import { describe, expect, it } from 'vitest';
import { settle, type Para } from '../src/shapes.ts';
import { joinGlyphs } from '../src/pdf.ts';

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
