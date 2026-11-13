// What Apple's importer (Quick Look, Mail, an iPhone) needs to show a slide as PowerPoint does.
import { describe, expect, it } from 'vitest';
import { settle, type Para } from '../src/shapes.ts';

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
