import { describe, expect, it } from 'vitest';
import { deepest, nesting, spread, stack, tracks } from '../src/index.ts';

describe('spread', () => {
  it('keeps neighbours a gap apart and starts at 0', () => {
    const s = spread([100, 60, 100], 20);
    expect(s.centres).toEqual([50, 150, 250]);
    expect(s.size).toBe(300);
  });

  it('widens only the gaps a wish spans, evenly, shortest wishes first', () => {
    const s = spread([100, 100, 100, 100], 20, [{ a: 0, b: 1, min: 200 }, { a: 1, b: 3, min: 400 }]);
    const gaps = s.centres.slice(1).map((c, i) => c - s.centres[i]!);
    expect(gaps[0]).toBe(200);
    expect(gaps[1]).toBe(200);
    expect(gaps[2]).toBe(200);
    // Met wishes stay met, and wishes in either order or between the same lane change nothing.
    expect(spread([100, 100, 100, 100], 20, [{ a: 3, b: 1, min: 400 }, { a: 0, b: 1, min: 200 }, { a: 2, b: 2, min: 999 }]).centres).toEqual(s.centres);
  });

  it('is stable: a wish on the right does not move lanes on its left', () => {
    const before = spread([80, 80, 80], 20, [{ a: 0, b: 1, min: 150 }]);
    const after = spread([80, 80, 80], 20, [{ a: 0, b: 1, min: 150 }, { a: 1, b: 2, min: 300 }]);
    expect(after.centres.slice(0, 2)).toEqual(before.centres.slice(0, 2));
  });

  it('counts what sticks out of the outer lanes in the size', () => {
    const s = spread([100, 100], 20, [], [{ lane: 0, before: 90 }, { lane: 1, after: 200 }]);
    expect(s.centres[0]).toBe(90);
    expect(s.size).toBe(90 + 120 + 200);
  });
});

describe('stack', () => {
  it('places rows one after the other with their anchors', () => {
    const s = stack([{ size: 30, anchor: 20 }, { size: 10 }], [], 5);
    expect(s.rows).toEqual([{ start: 0, size: 30, at: 20 }, { start: 35, size: 10, at: 40 }]);
    expect(s.size).toBe(45);
  });

  it('nests bands that open and close on the same row: heads outer first, feet inner first', () => {
    const s = stack([{ size: 10 }, { size: 10 }], [{ from: 0, to: 0, head: 4, foot: 2 }, { from: 0, to: 1, head: 8, foot: 3 }]);
    expect(s.bands[1]).toEqual({ start: 0, end: 4 + 8 + 10 + 2 + 10 + 3 });
    expect(s.bands[0]).toEqual({ start: 8, end: 8 + 4 + 10 + 2 });
    expect(s.rows[0]!.start).toBe(12);
  });
});

describe('tracks', () => {
  it('steps nested spans outwards and lets spans one after the other share track 0', () => {
    const spans = [
      { lane: 0, from: 0, to: 10 },
      { lane: 0, from: 2, to: 5 },
      { lane: 0, from: 3, to: 3 },
      { lane: 0, from: 6, to: 8 },
      { lane: 1, from: 2, to: 4 },
      { lane: 1, from: 4, to: 6 },
    ];
    expect(tracks(spans)).toEqual([0, 1, 2, 1, 0, 0]);
    expect(deepest(spans, tracks(spans), 0, 3)).toBe(2);
    expect(deepest(spans, tracks(spans), 0, 11)).toBe(-1);
  });
});

describe('nesting', () => {
  it('counts levels of bands inside each band', () => {
    expect(nesting([{ from: 0, to: 9 }, { from: 1, to: 4 }, { from: 2, to: 3 }, { from: 6, to: 8 }, { from: 6, to: 8 }])).toEqual([2, 1, 0, 1, 0]);
  });
});
