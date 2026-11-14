// Tidying a placement: node centres on an 8px grid, nearly lined-up nodes exactly lined up, and
// groups fitted snugly around what they hold (header room kept). Small things, but together they
// make a drawing look made rather than computed. Runs before pins, so pinned nodes stay exact.
import type { Box, Graph } from '@linework/core';
import type { Placement } from './dot.ts';
import { siblingSet } from './metrics.ts';

const GRID = 8;
/** Centres this close across the flow are meant to be one row (or column). */
const NEAR = 12;
/** A group grows by at most this part of its size to match its siblings: more is a band of empty room, with lines through it. */
const EVEN = 0.3;

/** `gap` is the room kept between nodes: the layout's node gap, so line ends keep room for their stubs. */
export function tidy(p: Placement, graph: Graph, header: number, pad: number, gap: number, minWidth: Map<string, number>): Placement {
  const nodes = new Map(p.nodes);
  const parentOf = new Map(graph.nodes.map((n) => [n.id, n.parent]));
  const groupParent = new Map(graph.groups.map((g) => [g.id, g.parent]));
  const down = graph.direction === 'down';

  // `from` is where the node stood: what was already nearer than `room` there does not stop the move.
  const clear = (id: string, b: Box, room = gap, from?: Box) => {
    for (const [other, o] of nodes) if (other !== id && hit(b, o, room) && !(from && hit(from, o, room) && !hit(b, o, 0))) return false;
    // Not into a group the node is not in, and below its own group's header.
    const mine = new Set<string>();
    for (let g = parentOf.get(id); g; g = groupParent.get(g)) mine.add(g);
    for (const [gid, o] of p.groups) if (!mine.has(gid) && hit(b, o, pad)) return false;
    const g = p.groups.get(parentOf.get(id) ?? '');
    return !g || (b.y >= g.y + header - 1 && b.x >= g.x + pad - 1);
  };
  // Lines whose ends' centres line up across the flow: tidying may not make fewer of them.
  const across = (b: Box) => (down ? b.x + b.width / 2 : b.y + b.height / 2);
  const edges = graph.edges.filter((e) => e.from.node !== e.to.node && nodes.has(e.from.node) && nodes.has(e.to.node) && !e.from.row && !e.to.row);
  const straight = () => edges.filter((e) => Math.abs(across(nodes.get(e.from.node)!) - across(nodes.get(e.to.node)!)) < 0.5).length;

  // Tables with lines to their rows are lined up by row (align.ts); moving them would add jogs.
  // So is an annex, set against its table (annex.ts).
  const rowBound = new Set(graph.edges.flatMap((e) => [e.from.row ? e.from.node : '', e.to.row || e.annex ? e.to.node : '']));
  // Centres on the grid, one shared centre line at a time: all nodes on it move together or none
  // does, so what was lined up stays lined up.
  for (const axis of ['x', 'y'] as const) {
    const size = axis === 'x' ? 'width' : 'height';
    const centre = (q: Box) => Math.round((q[axis] + q[size] / 2) * 2) / 2;
    const lines = new Map<number, string[]>();
    for (const [id, q] of nodes) if (!rowBound.has(id)) lines.set(centre(q), [...(lines.get(centre(q)) ?? []), id]);
    for (const [c, ids] of lines) {
      const to = Math.round(c / GRID) * GRID;
      const old = ids.map((id) => nodes.get(id)!);
      ids.forEach((id, i) => nodes.set(id, { ...old[i]!, [axis]: to - old[i]![size] / 2 }));
      // Half a grid step less room than the node gap: dot spaces nodes exactly that far apart.
      if (!ids.every((id) => clear(id, nodes.get(id)!, gap - GRID / 2))) ids.forEach((id, i) => nodes.set(id, old[i]!));
    }
  }

  // Rows: centres within NEAR of each other take the most common value among them.
  const ids = [...nodes.keys()].filter((id) => !rowBound.has(id)).sort((a, b) => across(nodes.get(a)!) - across(nodes.get(b)!));
  for (let i = 0; i < ids.length; ) {
    let j = i + 1;
    while (j < ids.length && across(nodes.get(ids[j]!)!) - across(nodes.get(ids[i]!)!) <= NEAR) j++;
    const row = ids.slice(i, j);
    i = j;
    if (row.length < 2) continue;
    const counts = new Map<number, number>();
    for (const id of row) counts.set(across(nodes.get(id)!), (counts.get(across(nodes.get(id)!)) ?? 0) + 1);
    const target = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
    for (const id of row) {
      const b = nodes.get(id)!;
      const d = target - across(b);
      if (Math.abs(d) < 0.5) continue;
      const moved = down ? { ...b, x: b.x + d } : { ...b, y: b.y + d };
      if (!clear(id, moved)) continue;
      const before = straight();
      nodes.set(id, moved);
      if (straight() < before) nodes.set(id, b);
    }
  }

  // The cards of one layer stand in a row (top-down) or a column (left to right), centred on one
  // line by dot. Cards of unequal size then start a few pixels apart, which reads as a mistake:
  // they start on one line instead, the top of the row or the left of the column (lines come in on
  // that side and leave on the other, so none gets a jog). A card with a line to another card of
  // its layer stays centred: that line runs along the layer, from middle to middle.
  {
    const [axis, size] = down ? (['y', 'height'] as const) : (['x', 'width'] as const);
    const layers = new Map<number, string[]>();
    for (const [id, b] of nodes) {
      const mid = Math.round(b[axis] + b[size] / 2);
      if (!rowBound.has(id)) layers.set(mid, [...(layers.get(mid) ?? []), id]);
    }
    for (const layer of layers.values()) {
      if (layer.length < 2) continue;
      const start = Math.min(...layer.map((id) => nodes.get(id)![axis]));
      const inLayer = new Set(layer);
      for (const id of layer) {
        const b = nodes.get(id)!;
        if (b[axis] - start < 0.5) continue;
        if (edges.some((e) => (e.from.node === id && inLayer.has(e.to.node)) || (e.to.node === id && inLayer.has(e.from.node)))) continue;
        const moved = { ...b, [axis]: start };
        if (clear(id, moved, gap - GRID / 2, b)) nodes.set(id, moved);
      }
    }
  }

  return { ...p, nodes, groups: fitGroups(graph, nodes, p.groups, header, pad, minWidth) };
}

/** Each group exactly around its children plus padding (header on top), innermost first. */
export function fitGroups(graph: Graph, nodes: Map<string, Box>, before: Map<string, Box>, header: number, pad: number, minWidth: Map<string, number>) {
  const groups = new Map(before);
  const depth = (id: string | undefined): number => (id ? 1 + depth(graph.groups.find((g) => g.id === id)?.parent) : 0);
  for (const g of [...graph.groups].sort((a, b) => depth(b.id) - depth(a.id))) {
    const box = groups.get(g.id);
    const kids = [
      ...graph.nodes.filter((n) => n.parent === g.id).map((n) => nodes.get(n.id)),
      ...graph.groups.filter((c) => c.parent === g.id).map((c) => groups.get(c.id)),
    ].filter((b): b is Box => !!b);
    if (!box || !kids.length) continue;
    let x0 = Math.min(...kids.map((k) => k.x)) - pad;
    const y0 = Math.min(...kids.map((k) => k.y)) - header;
    let x1 = Math.max(...kids.map((k) => k.x + k.width)) + pad;
    const y1 = Math.max(...kids.map((k) => k.y + k.height)) + pad;
    // A title wider than what the group holds: the extra width goes where the group already had
    // room (to the right first, then to the left), so it does not grow over its neighbour.
    const extra = (minWidth.get(g.id) ?? 0) - (x1 - x0);
    if (extra > 0) {
      const right = Math.max(0, Math.min(extra, box.x + box.width - x1));
      const left = Math.max(0, Math.min(extra - right, x0 - box.x));
      x0 -= left;
      x1 += extra - left;
    }
    groups.set(g.id, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  }
  return groups;
}

/**
 * Sibling groups of one kind read as a set (the subnets of a zone, the zones of a network): stacked
 * they get one width, side by side one length, the widest of the set. A group grows only a little
 * (a card next to a row of five stays the size of a card) and only into room that is free: over no
 * card or group it does not hold, and no nearer to one than the padding.
 */
export function evenGroups(p: Placement, graph: Graph, pad: number): Placement {
  const groups = new Map(p.groups);
  const parentOf = new Map<string, string | undefined>([...graph.groups, ...graph.nodes].map((x) => [x.id, x.parent]));
  const holds = (g: string, id: string): boolean => {
    for (let at = parentOf.get(id); at; at = parentOf.get(at)) if (at === g) return true;
    return false;
  };
  const sets = new Map<string, string[]>();
  for (const g of graph.groups) if (groups.has(g.id)) sets.set(siblingSet(g), [...(sets.get(siblingSet(g)) ?? []), g.id]);
  for (const ids of sets.values()) {
    if (ids.length < 2) continue;
    for (const [axis, size] of [['x', 'width'], ['y', 'height']] as const) {
      const [other, otherSize] = axis === 'x' ? (['y', 'height'] as const) : (['x', 'width'] as const);
      const overlap = (a: Box, b: Box, on: 'x' | 'y', len: 'width' | 'height') => a[on] < b[on] + b[len] && b[on] < a[on] + a[len];
      // Stacked along the other axis: they share room on this one and none on the other.
      const stacked = (a: string, b: string) => overlap(groups.get(a)!, groups.get(b)!, axis, size) && !overlap(groups.get(a)!, groups.get(b)!, other, otherSize);
      const seen = new Set<string>();
      for (const first of ids) {
        if (seen.has(first)) continue;
        const stack = [first];
        for (const id of stack) for (const o of ids) if (!stack.includes(o) && stacked(id, o)) stack.push(o);
        for (const id of stack) seen.add(id);
        if (stack.length < 2) continue;
        const lo = Math.min(...stack.map((id) => groups.get(id)![axis]));
        const hi = Math.max(...stack.map((id) => groups.get(id)![axis] + groups.get(id)![size]));
        for (const id of stack) {
          const b = groups.get(id)!;
          const wide = { ...b, [axis]: lo, [size]: hi - lo };
          if (hi - lo > b[size] * (1 + EVEN)) continue;
          // What it was already near stays as near; nothing else comes nearer than the padding.
          const blocked = (oid: string, o: Box) => oid !== id && !holds(id, oid) && !holds(oid, id) && hit(wide, o, pad) && !hit(b, o, pad);
          if ([...p.nodes].some(([oid, o]) => blocked(oid, o)) || [...groups].some(([oid, o]) => blocked(oid, o))) continue;
          groups.set(id, wide);
        }
      }
    }
  }
  return { ...p, groups };
}

function hit(a: Box, b: Box, gap: number) {
  return a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
}
