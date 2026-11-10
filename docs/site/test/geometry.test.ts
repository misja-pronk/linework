import { describe, expect, it } from 'vitest';
import { bends, contacts, crossings, turning, displacement, measure, type Drawing, type Pt } from '../src/geometry.ts';

/** A line from a to b sampled every `step` pixels, the way the benchmark samples a drawn path. */
const sampled = (...corners: Pt[]): Pt[] => {
  const out: Pt[] = [corners[0]!];
  for (let i = 1; i < corners.length; i++) {
    const [a, b] = [corners[i - 1]!, corners[i]!];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
};

/** A quarter circle from (0,0) heading right, turning down. */
const arc = (r: number): Pt[] => Array.from({ length: 21 }, (_, i) => [r * Math.sin((i / 20) * (Math.PI / 2)), r - r * Math.cos((i / 20) * (Math.PI / 2))] as Pt);

describe('bends', () => {
  it('a straight line has none', () => expect(bends(sampled([0, 0], [200, 0]))).toBe(0));
  it('an orthogonal route counts its corners', () => expect(bends(sampled([0, 0], [100, 0], [100, 80], [200, 80]))).toBe(2));
  it('a rounded corner is one bend, not many', () => expect(bends([...sampled([-100, 0], [0, 0]), ...arc(12).slice(1), ...sampled([12, 12], [12, 120]).slice(1)])).toBe(1));
  it('a slight wobble is not a bend', () => expect(bends(sampled([0, 0], [100, 2], [200, 0]))).toBe(0));
});

describe('turning', () => {
  it('a right angle turns 90°, rounded or not', () => {
    expect(turning(sampled([0, 0], [100, 0], [100, 80]))).toBeCloseTo(90, 0);
    expect(turning([...sampled([-100, 0], [0, 0]), ...arc(40).slice(1), ...sampled([40, 40], [40, 120]).slice(1)])).toBeCloseTo(90, -1);
  });
});

describe('crossings', () => {
  it('counts an X once', () => expect(crossings([{ id: 'a', pts: sampled([0, 0], [100, 100]) }, { id: 'b', pts: sampled([0, 100], [100, 0]) }])).toBe(1));
  it('does not count lines that meet at their ends', () => expect(crossings([{ id: 'a', pts: sampled([0, 0], [50, 50]) }, { id: 'b', pts: sampled([50, 50], [100, 0]) }])).toBe(0));
  it('does not count a trunk that splits at a junction', () =>
    expect(crossings([{ id: 'a', pts: sampled([0, 0], [100, 0], [100, 80]) }, { id: 'b', pts: sampled([0, 0.4], [100, 0.4], [100.4, 0.4], [200, 0.4]) }])).toBe(0));
  it('sees two unrelated lines that kiss at a corner', () =>
    expect(contacts([{ id: 'a', pts: sampled([0, 0], [100, 0], [100, 100]) }, { id: 'b', pts: sampled([101, -100], [101, -1], [200, -1]) }]).touches).toBe(1));
  it('does not count lines that run side by side on one track', () => expect(crossings([{ id: 'a', pts: sampled([0, 0], [100, 0]) }, { id: 'b', pts: sampled([20, 0], [80, 0]) }])).toBe(0));
});

describe('measure', () => {
  const d: Drawing = {
    nodes: [
      { id: 'a', x: 0, y: 0, w: 100, h: 40 },
      { id: 'b', x: 200, y: 0, w: 100, h: 40 },
      { id: 'c', x: 400, y: 0, w: 100, h: 40 },
    ],
    // a → c straight through b.
    lines: [{ id: 'x', pts: sampled([100, 20], [400, 20]) }],
    labels: [{ x: 210, y: 10, w: 40, h: 12 }],
  };
  it('sees a line through a shape and a label on a shape', () => {
    const m = measure(d);
    expect(m.throughShapes).toBe(1);
    expect(m.labelOverlaps).toBe(1);
    expect(m.crossings).toBe(0);
    expect(m.aspect).toBeCloseTo(500 / 40);
  });
});

describe('displacement', () => {
  const before: Drawing = { nodes: [{ id: 'a', x: 0, y: 0, w: 100, h: 40 }, { id: 'b', x: 200, y: 0, w: 100, h: 40 }], lines: [], labels: [] };
  it('a drawing slid as a whole has not moved', () => {
    const after = { ...before, nodes: before.nodes.map((n) => ({ ...n, x: n.x + 50, y: n.y + 30 })) };
    expect(displacement(before, after).mean).toBeCloseTo(0);
  });
  it('a swap moves everything', () => {
    const after = { ...before, nodes: [{ ...before.nodes[0]!, x: 200 }, { ...before.nodes[1]!, x: 0 }] };
    const r = displacement(before, after);
    expect(r.moved).toBe(1);
    expect(r.mean).toBeGreaterThan(0.5);
  });
});
