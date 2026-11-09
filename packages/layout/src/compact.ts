// Moves things across the flow (up in a left-to-right diagram) where there is room, so groups do not
// keep empty corners. dot centres each layer on its widest neighbour; in nested groups that leaves
// space nobody uses. Order is kept: nothing passes anything else, groups move with their contents.
import type { Box, Graph } from '@cartography/core';
import type { Placement } from './dot.ts';

interface Axis {
  /** Position across the flow (y for left-to-right). */
  get(b: Box): number;
  set(b: Box, v: number): Box;
  size(b: Box): number;
  setSize(b: Box, v: number): Box;
  /** Position and size along the flow, for the overlap test. */
  along(b: Box): [number, number];
}

const vertical: Axis = {
  get: (b) => b.y,
  set: (b, v) => ({ ...b, y: v }),
  size: (b) => b.height,
  setSize: (b, v) => ({ ...b, height: v }),
  along: (b) => [b.x, b.x + b.width],
};
const horizontal: Axis = {
  get: (b) => b.x,
  set: (b, v) => ({ ...b, x: v }),
  size: (b) => b.width,
  setSize: (b, v) => ({ ...b, width: v }),
  along: (b) => [b.y, b.y + b.height],
};

export function compact(p: Placement, graph: Graph, header: number, pad: number, gap: number): Placement {
  const ax = graph.direction === 'down' ? horizontal : vertical;
  // Down-flowing diagrams have the group header on top, which is along the flow there.
  const lead = graph.direction === 'down' ? pad : header;
  const nodes = new Map(p.nodes);
  const groups = new Map(p.groups);
  const kids = (parent: string | undefined) => [
    ...graph.groups.filter((g) => g.parent === parent && groups.has(g.id)).map((g) => ({ id: g.id, group: true })),
    ...graph.nodes.filter((n) => n.parent === parent && nodes.has(n.id)).map((n) => ({ id: n.id, group: false })),
  ];
  const box = (k: { id: string; group: boolean }) => (k.group ? groups.get(k.id)! : nodes.get(k.id)!);

  const shift = (k: { id: string; group: boolean }, d: number) => {
    if (!k.group) return void nodes.set(k.id, ax.set(nodes.get(k.id)!, ax.get(nodes.get(k.id)!) + d));
    groups.set(k.id, ax.set(groups.get(k.id)!, ax.get(groups.get(k.id)!) + d));
    for (const c of kids(k.id)) shift(c, d);
  };

  const pack = (parent: string | undefined) => {
    const items = kids(parent);
    for (const c of items) if (c.group) pack(c.id);
    if (!items.length) return;
    const outer = parent ? groups.get(parent)! : undefined;
    const start = outer ? ax.get(outer) + lead : Math.min(...items.map((c) => ax.get(box(c))));
    const done: Box[] = [];
    for (const c of [...items].sort((a, b) => ax.get(box(a)) - ax.get(box(b)))) {
      const b = box(c);
      const [a0, a1] = ax.along(b);
      let at = start;
      for (const q of done) {
        const [q0, q1] = ax.along(q);
        if (a0 < q1 + gap / 2 && q0 < a1 + gap / 2) at = Math.max(at, ax.get(q) + ax.size(q) + gap);
      }
      // Only ever towards the start: compaction never pushes things apart.
      if (at < ax.get(b)) shift(c, at - ax.get(b));
      done.push(box(c));
    }
    if (outer) {
      const end = Math.max(...items.map((c) => ax.get(box(c)) + ax.size(box(c))));
      groups.set(parent!, ax.setSize(outer, end + pad - ax.get(outer)));
    }
  };
  pack(undefined);

  const all = [...nodes.values(), ...groups.values()];
  return {
    nodes,
    groups,
    width: Math.max(...all.map((b) => b.x + b.width)),
    height: Math.max(...all.map((b) => b.y + b.height)),
  };
}
