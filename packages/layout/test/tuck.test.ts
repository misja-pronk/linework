// Tucking (tuck.ts): a card outside the groups that makes the drawing longer goes into free room.
import { describe, expect, it } from 'vitest';
import type { Box, Graph } from '@cartography/core';
import { tuck } from '../src/tuck.ts';
import type { Placement } from '../src/dot.ts';

/** A domain g holding a -> b, a source s under it feeding a, and a reader u of b to the right of it. */
function drawing(uy: number): { graph: Graph; p: Placement } {
  const card = (id: string, parent?: string) => ({ id, parent, shape: { kind: 'card' as const, label: id, tone: 'blue' as const }, path: ['nodes', id] });
  const edge = (i: number, from: string, to: string) => ({ id: `e${i}`, from: { node: from }, to: { node: to }, line: 'solid' as const, start: 'none' as const, end: 'arrow' as const, path: ['edges', i] });
  const graph: Graph = {
    direction: 'right',
    groups: [{ id: 'g', label: 'g', tone: 'slate', border: 'solid', path: ['groups', 'g'] }],
    nodes: [card('a', 'g'), card('b', 'g'), card('s'), card('u')],
    edges: [edge(0, 'a', 'b'), edge(1, 's', 'a'), edge(2, 'b', 'u')],
  } as Graph;
  const nodes = new Map<string, Box>([
    ['a', { x: 20, y: 60, width: 180, height: 58 }],
    ['b', { x: 400, y: 60, width: 180, height: 58 }],
    ['s', { x: 0, y: 260, width: 180, height: 58 }],
    ['u', { x: 1000, y: uy, width: 180, height: 58 }],
  ]);
  const groups = new Map<string, Box>([['g', { x: 0, y: 0, width: 900, height: 200 }]]);
  return { graph, p: { nodes, groups, width: 1180, height: 318 } };
}

const scale = (q: Placement) => Math.min((16 / 9) * 1000 / q.width, 1000 / q.height);
const gaps = { along: 64, across: 24 };

describe('tuck', () => {
  it('moves a card at the end of the flow under the group, after what feeds it', () => {
    const { graph, p } = drawing(100);
    const [q] = tuck(p, graph, gaps, scale);
    const u = q!.nodes.get('u')!;
    // Under the group, within its length, after b: the drawing is no longer than the rest.
    expect(u.y).toBeGreaterThanOrEqual(200 + gaps.across);
    expect(u.x).toBeGreaterThanOrEqual(580);
    expect(u.x + u.width).toBeLessThanOrEqual(900);
    expect(scale(q!)).toBeGreaterThan(scale(p));
    // As near b as that allows: just under the group.
    expect(u.y).toBe(200 + gaps.across);
  });
  it('leaves a card in line with what it is joined to: its line runs straight', () => {
    const { graph, p } = drawing(60);
    expect(tuck(p, graph, gaps, scale)).toEqual([]);
  });
});
