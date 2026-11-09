import { describe, expect, it } from 'vitest';
import { render } from '@cartography/engine';
import { arrange, bendsOf, dragSegment, nearestSegment, nearestToward, snapBox, viewFor } from '../src/craft.ts';

const box = (x: number, y: number, width = 100, height = 50) => ({ x, y, width, height });

describe('snapping while dragging', () => {
  it('lines up edges and centres within the tolerance, with a guide', () => {
    const s = snapBox(box(203, 304), [box(200, 100), box(500, 300)], 6);
    expect([s.dx, s.dy]).toEqual([-3, -4]);
    expect(s.guides).toContainEqual({ axis: 'x', at: 200, from: 100, to: 350 });
    expect(s.guides.some((g) => g.axis === 'y' && g.at === 300)).toBe(true);
  });
  it('leaves boxes alone that are not close, or snaps them to the grid', () => {
    expect(snapBox(box(243, 177), [box(0, 0)], 6)).toMatchObject({ dx: 0, dy: 0, guides: [] });
    expect(snapBox(box(243, 177), [box(0, 0)], 6, 8)).toMatchObject({ dx: -3, dy: -1 });
  });
  it('offers the same gap as between its neighbours', () => {
    // A at 0, B at 200 (gap 100): a third one near 400 snaps to exactly 400.
    const s = snapBox(box(397, 500), [box(0, 500), box(200, 500)], 6);
    expect(s.dx).toBe(3);
    expect(s.gaps[0]).toMatchObject({ axis: 'x', spans: [[100, 200], [300, 400]] });
    // Midway between two.
    const mid = snapBox(box(248, 0, 100), [box(0, 20), box(500, 0)], 6);
    expect(mid.dx).toBe(2);
    expect(mid.gaps[0]!.spans).toEqual([[100, 250], [350, 500]]);
  });
});

describe('align and distribute', () => {
  const three: [string, ReturnType<typeof box>][] = [['a', box(0, 0)], ['b', box(150, 40, 60)], ['c', box(400, 10)]];
  it('aligns to the edges and centre of the selection, leaving the ones in place out', () => {
    expect(arrange(three, 'top')).toEqual({ b: { x: 150, y: 0 }, c: { x: 400, y: 0 } });
    expect(arrange(three, 'right')).toEqual({ a: { x: 400, y: 0 }, b: { x: 440, y: 40 } });
    expect(arrange(three, 'middle')).toEqual({ a: { x: 0, y: 20 }, b: { x: 150, y: 20 }, c: { x: 400, y: 20 } });
  });
  it('distributes with equal gaps between the first and the last', () => {
    // From 0 to 500, widths 100 + 60 + 100: two gaps of 120.
    expect(arrange(three, 'distribute-x')).toEqual({ b: { x: 220, y: 40 } });
    expect(arrange(three.slice(0, 2), 'distribute-x')).toEqual({});
  });
});

describe('dragging a segment', () => {
  const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 300, y: 200 }];
  it('moves a middle segment across itself and keeps the line orthogonal', () => {
    const moved = dragSegment(line, 1, 40);
    expect(moved).toEqual([{ x: 0, y: 0 }, { x: 140, y: 0 }, { x: 140, y: 200 }, { x: 300, y: 200 }]);
    expect(bendsOf(moved)).toEqual([{ x: 140, y: 0 }, { x: 140, y: 200 }]);
  });
  it('keeps an end on its port with a short straight piece and a jog', () => {
    const moved = dragSegment([{ x: 0, y: 0 }, { x: 200, y: 0 }], 0, 60);
    expect(moved).toEqual([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 60 }, { x: 170, y: 60 }, { x: 170, y: 0 }, { x: 200, y: 0 }]);
    expect(moved.slice(1).every((q, i) => q.x === moved[i]!.x || q.y === moved[i]!.y)).toBe(true);
  });
  it('finds the segment under the pointer', () => {
    expect(nearestSegment(line, { x: 104, y: 120 })).toBe(1);
    expect(nearestSegment(line, { x: 250, y: 195 })).toBe(2);
  });
});

describe('moving focus by direction', () => {
  const all: [string, ReturnType<typeof box>][] = [['right', box(300, 10)], ['far', box(900, 0)], ['below', box(0, 200)], ['diag', box(250, 300)]];
  it('prefers what is straight ahead', () => {
    expect(nearestToward(box(0, 0), all, 'right')).toBe('right');
    expect(nearestToward(box(0, 0), all, 'down')).toBe('below');
    expect(nearestToward(box(0, 0), all, 'left')).toBeUndefined();
  });
});

describe('zoom to a box', () => {
  it('fits it in the pane with a margin and caps the zoom', () => {
    const v = viewFor(box(100, 100, 200, 100), { w: 1000, h: 600 }, { max: 2 });
    expect(v.scale).toBe(2);
    expect(v.x + 200 * v.scale).toBe(500);
  });
});

describe('a dragged segment, drawn again', () => {
  it('comes back through its bends, with every box where it was (also when the drawing turned top-down)', async () => {
    const text = 'type: azure\nnodes:\n  a: app-service\n  b: sql-database\n  c: key-vault\n  d: function-app\nedges:\n  - a -> b\n  - a -> c\n  - c -> d\n';
    const pinSpace = (r: Awaited<ReturnType<typeof render>>, pts: { x: number; y: number }[]) => pts.map((q) => ({ ...q, x: q.x + r.placed!.shift!.x, y: q.y + r.placed!.shift!.y }));
    const free = await render(text, { fonts: 'none' });
    const pts = pinSpace(free, free.placed!.edges.get('e2')!.points);
    const moved = dragSegment(pts, 0, 56);
    const bent = await render(text, { fonts: 'none', sidecar: { version: 1, edges: { e2: { via: bendsOf(moved) } } } });
    expect(pinSpace(bent, bent.placed!.edges.get('e2')!.points)).toEqual(moved);
    for (const id of ['a', 'b', 'c', 'd']) expect(pinSpace(bent, [bent.placed!.nodes.get(id)!])).toEqual(pinSpace(free, [free.placed!.nodes.get(id)!]));
  });
});
