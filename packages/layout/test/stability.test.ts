// Pins and the memory of the previous drawing: neither may redraw what was already there.
import { describe, expect, it } from 'vitest';
import { packLayout, unpackLayout, type Graph, type LayoutSidecar, type Placed, type Point, type Sized } from '@linework/core';
import { layout, movedShare, type Spacing } from '../src/index.ts';

const spacing: Spacing = { nodeGap: 24, layerGap: 64, groupPad: 20 };

/** A graph from "a -> b" lines; "g: a b" puts nodes in a group. */
function sized(lines: string[], direction: 'right' | 'down' = 'right', groups: Record<string, string[]> = {}): Sized {
  const ids = [...new Set([...lines.flatMap((l) => l.split(' -> ')), ...Object.values(groups).flat()])];
  const parent = new Map(Object.entries(groups).flatMap(([g, members]) => members.map((m) => [m, g] as const)));
  const graph: Graph = {
    direction,
    groups: Object.keys(groups).map((id) => ({ id, label: id, tone: 'slate', border: 'solid', path: ['groups', id] })),
    nodes: ids.map((id) => ({ id, parent: parent.get(id), shape: { kind: 'card', label: id, tone: 'blue' }, path: ['nodes', id] })),
    edges: lines.map((l, i) => {
      const [from, to] = l.split(' -> ') as [string, string];
      return { id: `e${i}`, from: { node: from }, to: { node: to }, line: 'solid', start: 'none', end: 'arrow', path: ['edges', i] };
    }),
  };
  return { graph, nodes: new Map(ids.map((id) => [id, { width: 180, height: 58 }])), edgeLabels: new Map(), groupHeader: 44, groupMinWidth: new Map(Object.keys(groups).map((g) => [g, 120])) };
}

/** Top-left corners in pin space: where a pin would put them. */
function corners(p: Placed): Map<string, Point> {
  const s = p.shift ?? { x: 0, y: 0 };
  return new Map([...p.nodes].map(([id, b]) => [id, { x: b.x + s.x, y: b.y + s.y }]));
}

const chain = ['a -> b', 'b -> c', 'c -> d', 'd -> e', 'e -> f', 'f -> g', 'g -> h'];
const web = ['a -> b', 'a -> c', 'b -> d', 'c -> d', 'd -> e', 'a -> e', 'c -> f', 'f -> e', 'b -> g', 'g -> e'];

describe('the first pin', () => {
  for (const [name, lines, tuning] of [
    ['a long chain that turned top-down', chain, { autoDirection: true }],
    ['a small web of lines', web, {}],
    ['a web drawn top-down', web, { direction: 'down' as const }],
  ] as const)
    it(`moves one node and leaves the rest where it was: ${name}`, async () => {
      const s = sized([...lines]);
      const free = await layout(s, spacing, undefined, tuning);
      const was = corners(free);
      // Far outside the drawing, so nothing has to make room for it.
      const at = { x: was.get('a')!.x - 600, y: was.get('a')!.y - 400 };
      const pinned = await layout(s, spacing, { version: 1, nodes: { a: at } }, tuning);
      const now = corners(pinned);
      expect(now.get('a')).toEqual(at);
      for (const [id, p] of was) if (id !== 'a') expect(now.get(id), id).toEqual(p);
      expect(pinned.direction).toBe(free.direction);
      expect(pinned.memory?.variant).toBe(free.memory?.variant);
    });

  it('keeps a drawing top-down that only became so because it was wide', async () => {
    const free = await layout(sized(chain), spacing, undefined, { autoDirection: true });
    expect(free.direction).toBe('down');
    expect(free.memory?.variant).toMatch(/^down\//);
    const at = corners(free).get('h')!;
    const pinned = await layout(sized(chain), spacing, { version: 1, nodes: { h: { x: at.x + 300, y: at.y } } }, { autoDirection: true });
    expect(pinned.direction).toBe('down');
  });

  it('remembers the placement before the pin, so unpinning puts the node back', async () => {
    const s = sized(web);
    const free = await layout(s, spacing);
    const at = corners(free).get('d')!;
    const pinned = await layout(s, spacing, { version: 1, nodes: { d: { x: at.x + 400, y: at.y + 300 } } });
    expect(pinned.memory?.nodes).toEqual(free.memory?.nodes);
    const back = await layout(s, spacing, undefined, { previous: pinned.memory });
    expect(corners(back)).toEqual(corners(free));
  });
});

describe('a pinned drawing with its variant in the sidecar', () => {
  it('is drawn that way again, whatever the others would score', async () => {
    const s = sized(web);
    for (const variant of ['right/plain/-', 'right/same-rev/ca', 'down/out/a']) {
      const sidecar: LayoutSidecar = { version: 1, nodes: { a: { x: -500, y: -500 } }, layout: { variant } };
      const p = await layout(s, spacing, sidecar, { autoDirection: true });
      expect(p.memory?.variant).toBe(variant);
      expect(p.direction).toBe(variant.startsWith('down') ? 'down' : undefined);
    }
  });

  it('does not turn against a direction the source chose', async () => {
    const p = await layout(sized(web), spacing, { version: 1, nodes: { a: { x: -500, y: -500 } }, layout: { variant: 'down/plain/-' } });
    expect(p.direction).toBeUndefined();
    expect(p.memory?.variant).toBe('right/plain/-');
  });

  it('ignores a variant it cannot read', async () => {
    const s = sized(web);
    const free = await layout(s, spacing);
    const p = await layout(s, spacing, { version: 1, nodes: { a: { x: -500, y: -500 } }, layout: { variant: 'sideways/whatever' } });
    expect(p.memory?.variant).toBe(free.memory?.variant);
  });
});

describe('the previous drawing', () => {
  it('is kept when a line is added, where a drawing from scratch would move things', async () => {
    const before = await layout(sized(web), spacing);
    const s = sized([...web, 'b -> f']);
    const at = (p: Placed) => new Map([...p.memory!.nodes!].map(([id, c]) => [id, { x: c.x, y: c.y, width: 0, height: 0 }]));
    const fresh = await layout(s, spacing, undefined, { previous: null });
    expect(movedShare(at(fresh), before.memory!.nodes)).toBeGreaterThan(0.2);
    const kept = await layout(s, spacing, undefined, { previous: before.memory });
    expect(movedShare(at(kept), before.memory!.nodes)).toBe(0);
    expect(kept.memory?.held).toBe(true);
    expect(kept.edges.size).toBe(web.length + 1);
  });

  it('is kept when a node is added, which takes a free spot', async () => {
    const before = await layout(sized(web), spacing);
    const kept = await layout(sized([...web, 'd -> x']), spacing, undefined, { previous: before.memory });
    for (const [id, c] of before.memory!.nodes!) expect(kept.memory!.nodes!.get(id), id).toEqual(c);
    const boxes = [...kept.nodes.values()];
    for (const a of boxes) for (const b of boxes) if (a !== b) expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height).toBe(false);
  });

  it('keeps group boxes around what they held, and grows the group that got something new', async () => {
    const groups = { left: ['a', 'b', 'c'], right: ['d', 'e'] };
    const lines = ['a -> d', 'b -> d', 'c -> e'];
    const before = await layout(sized(lines, 'right', groups), spacing);
    const kept = await layout(sized([...lines, 'c -> x'], 'right', { ...groups, right: ['d', 'e', 'x'] }), spacing, undefined, { previous: before.memory });
    expect(kept.memory!.groups!.get('left')).toEqual(before.memory!.groups!.get('left'));
    const g = kept.groups.get('right')!;
    const x = kept.nodes.get('x')!;
    expect(x.x >= g.x && x.y >= g.y && x.x + x.width <= g.x + g.width && x.y + x.height <= g.y + g.height).toBe(true);
    for (const [id, c] of before.memory!.nodes!) expect(kept.memory!.nodes!.get(id), id).toEqual(c);
  });

  it('gives way when another placement is clearly better', async () => {
    const s = sized(['a -> c', 'b -> d', 'a -> e', 'b -> f', 'c -> g', 'd -> h']);
    const fresh = await layout(s, spacing);
    const ids = [...fresh.memory!.nodes!.keys()];
    // Remembered as one long row in no order, and as the fresh drawing with its nodes dealt around.
    const row = new Map('agchebdf'.split('').map((id, i) => [id, { x: 100 + i * 240, y: 40 }]));
    const dealt = new Map(ids.map((id, i) => [id, fresh.memory!.nodes!.get(ids[(i * 3 + 2) % ids.length]!)!]));
    for (const nodes of [row, dealt]) {
      const again = await layout(s, spacing, undefined, { previous: { nodes, groups: new Map() } });
      expect(corners(again)).toEqual(corners(fresh));
      expect(again.memory?.held).toBeUndefined();
    }
  });

  it('is forgotten with previous: null, also the one in the sidecar', async () => {
    const before = await layout(sized(web), spacing);
    const note = packLayout(before.memory, true)!;
    const s = sized([...web, 'b -> f']);
    const fresh = await layout(s, spacing);
    const forgot = await layout(s, spacing, { version: 1, layout: note }, { previous: null });
    expect(corners(forgot)).toEqual(corners(fresh));
    expect(corners(fresh)).not.toEqual(corners(before));
    const kept = await layout(s, spacing, { version: 1, layout: note });
    for (const [id, c] of before.memory!.nodes!) expect(kept.memory!.nodes!.get(id), id).toEqual(c);
  });

  it('is the same drawing every time for the same input', async () => {
    const before = await layout(sized(web), spacing);
    const s = sized([...web, 'd -> x']);
    const one = await layout(s, spacing, undefined, { previous: before.memory });
    const two = await layout(s, spacing, undefined, { previous: before.memory });
    expect([...one.nodes]).toEqual([...two.nodes]);
    expect([...one.edges]).toEqual([...two.edges]);
  });
});

describe('the note in the sidecar', () => {
  it('goes there and back in one line', async () => {
    const p = await layout(sized(['a -> b', 'b -> c'], 'right', { 'my group': ['a', 'b'] }), spacing);
    const note = packLayout(p.memory, true)!;
    expect(note.at).not.toContain('\n');
    const back = unpackLayout(note)!;
    expect(back.variant).toBe(p.memory!.variant);
    expect([...back.nodes!.keys()].sort()).toEqual(['a', 'b', 'c']);
    expect(back.groups!.get('my group')).toEqual(p.memory!.groups!.get('my group'));
    // What the drawing was made of goes with the positions, so --stable draws it the same way next time.
    expect(back.shape).toBe(p.memory!.shape);
    expect(packLayout(p.memory, false)).toEqual({ variant: p.memory!.variant });
  });

  it('survives ids with separators in them, and skips what it cannot read', () => {
    const note = packLayout({ variant: 'right/plain/-', nodes: new Map([['a;b@c#d', { x: 1, y: 2 }]]), groups: new Map([['#g', { x: 0, y: 0, width: 10, height: 10 }]]) }, true)!;
    const back = unpackLayout(note)!;
    expect(back.nodes!.get('a;b@c#d')).toEqual({ x: 1, y: 2 });
    expect(back.groups!.get('#g')).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    expect(unpackLayout({ at: 'junk;x@1;y@a,b;z@3,4' })!.nodes).toEqual(new Map([['z', { x: 3, y: 4 }]]));
    expect(unpackLayout({})).toBeUndefined();
  });
});
