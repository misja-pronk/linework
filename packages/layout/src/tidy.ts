// Tidying a placement: node centres on an 8px grid, nearly lined-up nodes exactly lined up, and
// groups fitted snugly around what they hold (header room kept). Small things, but together they
// make a drawing look made rather than computed. Runs before pins, so pinned nodes stay exact.
import type { Box, Graph } from '@cartography/core';
import type { Placement } from './dot.ts';

const GRID = 8;
/** Centres this close across the flow are meant to be one row (or column). */
const NEAR = 12;

/** `gap` is the room kept between nodes: the layout's node gap, so line ends keep room for their stubs. */
export function tidy(p: Placement, graph: Graph, header: number, pad: number, gap: number, minWidth: Map<string, number>): Placement {
  const nodes = new Map(p.nodes);
  const parentOf = new Map(graph.nodes.map((n) => [n.id, n.parent]));
  const groupParent = new Map(graph.groups.map((g) => [g.id, g.parent]));
  const down = graph.direction === 'down';

  const clear = (id: string, b: Box, room = gap) => {
    for (const [other, o] of nodes) if (other !== id && hit(b, o, room)) return false;
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
  const rowBound = new Set(graph.edges.flatMap((e) => [e.from.row ? e.from.node : '', e.to.row ? e.to.node : '']));
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
    const x0 = Math.min(...kids.map((k) => k.x)) - pad;
    const y0 = Math.min(...kids.map((k) => k.y)) - header;
    const x1 = Math.max(...kids.map((k) => k.x + k.width), x0 + (minWidth.get(g.id) ?? 0) - pad) + pad;
    const y1 = Math.max(...kids.map((k) => k.y + k.height)) + pad;
    groups.set(g.id, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  }
  return groups;
}

function hit(a: Box, b: Box, gap: number) {
  return a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
}
