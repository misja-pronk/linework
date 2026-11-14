// Straightens almost-straight lines: when the two ends of a line are a few pixels apart across the
// flow, one end's node slides over so the line runs straight, without bends. dot centres nodes on
// their whole neighbourhood, which leaves small jogs between tables of different heights or cards
// next to taller neighbours. A move is kept only when more lines end up straight than before, the
// node stays below its group's header (the group grows when needed), and it overlaps nothing.
import type { Box, Graph, NodeSize } from '@cartography/core';
import type { Placement } from './dot.ts';
import { growGroups } from './pins.ts';

/** Jogs up to this size are worth removing; bigger offsets are real layout decisions, except for a
 * node with a single line (a leaf), which may slide any distance to sit in line with its neighbour. */
const MAX_JOG = 48;
const GAP = 12;

export function alignPorts(p: Placement, graph: Graph, sizes: Map<string, NodeSize>, header: number, pad: number): Placement {
  const down = graph.direction === 'down';
  const nodes = new Map(p.nodes);
  const parentOf = new Map(graph.nodes.map((n) => [n.id, n.parent]));
  const groupParent = new Map(graph.groups.map((g) => [g.id, g.parent]));
  // Only node-to-node lines between different nodes; lines to groups go through the router.
  const edges = graph.edges.filter((e) => e.from.node !== e.to.node && nodes.has(e.from.node) && nodes.has(e.to.node));
  const degree = new Map<string, number>();
  for (const e of edges) for (const n of [e.from.node, e.to.node]) degree.set(n, (degree.get(n) ?? 0) + 1);

  /** Where a line leaves a node across the flow: its row, or the middle. */
  const port = (id: string, row: string | undefined, b: Box) => {
    const y = row ? sizes.get(id)?.rowY?.[row] : undefined;
    return down ? b.x + b.width / 2 : b.y + (y ?? b.height / 2);
  };
  const offset = (e: (typeof edges)[number], at = nodes) => port(e.to.node, e.to.row, at.get(e.to.node)!) - port(e.from.node, e.from.row, at.get(e.from.node)!);
  const straight = (at = nodes) => edges.filter((e) => Math.abs(offset(e, at)) < 0.5).length;

  const fits = (id: string, b: Box, far = false) => {
    for (const [other, o] of nodes)
      if (other !== id && b.x < o.x + o.width + GAP && o.x < b.x + b.width + GAP && b.y < o.y + o.height + GAP && o.y < b.y + b.height + GAP) return false;
    // Never into a group the node is not in.
    const mine = new Set<string>();
    for (let g = parentOf.get(id); g; g = groupParent.get(g)) mine.add(g);
    for (const [gid, o] of p.groups) if (!mine.has(gid) && b.x < o.x + o.width + GAP && o.x < b.x + b.width + GAP && b.y < o.y + o.height + GAP && o.y < b.y + b.height + GAP) return false;
    const parent = parentOf.get(id);
    const g = parent ? p.groups.get(parent) : undefined;
    if (!g) return true;
    // Never into the header or past the start; the far side may grow the group, but not for a far move.
    if (far && (down ? b.x + b.width > g.x + g.width - pad : b.y + b.height > g.y + g.height - pad)) return false;
    return down ? b.x >= g.x + pad : b.y >= g.y + header;
  };

  for (let round = 0; round < 3; round++) {
    let changed = false;
    // Lines from nodes with few neighbours first: moving those disturbs least.
    const order = [...edges].sort((a, b) => Math.min(degree.get(a.from.node)!, degree.get(a.to.node)!) - Math.min(degree.get(b.from.node)!, degree.get(b.to.node)!));
    for (const e of order) {
      const d = offset(e);
      if (Math.abs(d) < 0.5) continue;
      const far = Math.abs(d) > MAX_JOG;
      const before = straight();
      // Try the end with fewer lines first.
      const ends = degree.get(e.to.node)! <= degree.get(e.from.node)! ? [[e.to.node, -d], [e.from.node, d]] : [[e.from.node, d], [e.to.node, -d]];
      for (const [id, delta] of ends as [string, number][]) {
        if (far && degree.get(id)! > 1) continue;
        const b = nodes.get(id)!;
        const moved = down ? { ...b, x: b.x + delta } : { ...b, y: b.y + delta };
        if (!fits(id, moved, far)) continue;
        const trial = new Map(nodes).set(id, moved);
        if (straight(trial) > before) {
          nodes.set(id, moved);
          changed = true;
          break;
        }
      }
    }
    if (!changed) break;
  }
  return { ...p, nodes, groups: growGroups(graph, nodes, new Map(p.groups), header, pad) };
}

/**
 * Something standing outside everything (the internet, a data centre with its edge router) that
 * one line joins to one card inside: dot leaves it at a far corner when the card ended up elsewhere
 * (after a wrap, or across a wide group), and its line runs the width of the drawing. It slides
 * across the flow, as a whole, until its line runs straight, where that overlaps nothing.
 */
/** A loner moves only for a line this long across, and this share of the drawing's extent across. */
const LONER_MIN = 240;
const LONER_SHARE = 0.3;
/** A line keeps this far from the corners of the card it leaves or enters. */
const CORNER = 12;

export function alignLoners(p: Placement, graph: Graph, gap: number): Placement {
  const down = graph.direction === 'down';
  const [at, size] = down ? (['x', 'width'] as const) : (['y', 'height'] as const);
  const [along, length] = down ? (['y', 'height'] as const) : (['x', 'width'] as const);
  const parentOf = new Map<string, string | undefined>([...graph.groups.map((g) => [g.id, g.parent] as const), ...graph.nodes.map((n) => [n.id, n.parent] as const)]);
  const topOf = (id: string) => {
    let t = id;
    while (parentOf.get(t)) t = parentOf.get(t)!;
    return t;
  };
  const nodes = new Map(p.nodes);
  const groups = new Map(p.groups);
  const boxOf = (id: string) => nodes.get(id) ?? groups.get(id);
  const everything = [...p.nodes.values(), ...p.groups.values()];
  const extent = Math.max(...everything.map((b) => b[at] + b[size])) - Math.min(...everything.map((b) => b[at]));
  // The top-level blocks, each with the ids that move with it.
  const members = new Map<string, string[]>();
  for (const id of [...nodes.keys(), ...groups.keys()]) members.set(topOf(id), [...(members.get(topOf(id)) ?? []), id]);
  // The loners and the one card each is joined to.
  const loners: { top: string; ids: string[]; inside: Set<string>; lines: typeof graph.edges; end: string; own: string }[] = [];
  for (const [top, ids] of members) {
    const inside = new Set(ids);
    const lines = graph.edges.filter((e) => inside.has(e.from.node) !== inside.has(e.to.node) && (inside.has(e.from.node) || inside.has(e.to.node)));
    if (!lines.length || inside.size > 2) continue;
    const ends = new Set(lines.map((e) => (inside.has(e.from.node) ? e.to.node : e.from.node)));
    const own = new Set(lines.map((e) => (inside.has(e.from.node) ? e.from.node : e.to.node)));
    if (ends.size === 1 && own.size === 1) loners.push({ top, ids, inside, lines, end: [...ends][0]!, own: [...own][0]! });
  }
  // Several joined to one card (spokes around a hub) stand around it as dot put them: in line they would stand on each other.
  for (const { top, ids, inside, lines, end, own } of loners) {
    if (loners.filter((l) => l.end === end).length > 1) continue;
    const ends = [end];
    const far = boxOf(end);
    const near = boxOf(own);
    const block = boxOf(top);
    if (!far || !near || !block) continue;
    const by = Math.round((far[at] + far[size] / 2 - (near[at] + near[size] / 2)) / 8) * 8;
    const clear = (b: Box) => [...nodes, ...groups].every(([id, o]) => inside.has(id) || b.x >= o.x + o.width + GAP || o.x >= b.x + b.width + GAP || b.y >= o.y + o.height + GAP || o.y >= b.y + b.height + GAP);
    // Only a line that runs a good part of the drawing's width (height, top-down) across: a short
    // step aside is the router's to draw. Unless a group of its own (an office with its router) and
    // the card it joins, nested deeper, overlap too little for a straight line: then it would jog
    // right at one of them. In line, where that is free and the drawing grows no larger across, it runs straight.
    if (Math.abs(by) < Math.max(LONER_MIN, LONER_SHARE * extent)) {
      const overlap = Math.min(near[at] + near[size], far[at] + far[size]) - Math.max(near[at], far[at]);
      const moved = { ...block, [at]: block[at] + by };
      if (!by || !groups.has(top) || overlap >= 2 * CORNER || !clear(moved) || moved[at] < Math.min(...everything.map((b) => b[at])) || moved[at] + moved[size] > Math.max(...everything.map((b) => b[at] + b[size]))) continue;
    }
    let shift = { [at]: by, [along]: 0 } as Record<'x' | 'y', number>;
    if (!clear({ ...block, [at]: block[at] + by })) {
      // No room in line where it stands: past the end of the drawing (what the lines run into), or
      // before its start (what they come from).
      const into = lines.every((e) => inside.has(e.to.node));
      const out = lines.every((e) => inside.has(e.from.node));
      // (Only a group of its own, a data centre with its router: a card past the end reads as the next step.)
      if ((!into && !out) || !groups.has(top)) continue;
      // Just past the block the other end stands in, else past everything.
      const home = boxOf(topOf(ends[0]!))!;
      const others = [...nodes, ...groups].filter(([id]) => !inside.has(id)).map(([, o]) => o);
      const spots = into ? [home[along] + home[length] + gap, Math.max(...others.map((o) => o[along] + o[length])) + gap] : [home[along] - gap - block[length], Math.min(...others.map((o) => o[along])) - gap - block[length]];
      const fit = spots.map((to) => ({ [at]: by, [along]: Math.round((to - block[along]) / 8) * 8 }) as Record<'x' | 'y', number>).find((d) => clear({ ...block, x: block.x + d.x, y: block.y + d.y }));
      if (!fit) continue;
      shift = fit;
    }
    for (const id of ids) {
      const m = nodes.has(id) ? nodes : groups;
      const o = m.get(id)!;
      m.set(id, { ...o, x: o.x + shift.x, y: o.y + shift.y });
    }
  }
  const all = [...nodes.values(), ...groups.values()];
  return { nodes, groups, width: Math.max(...all.map((b) => b.x + b.width)) - Math.min(...all.map((b) => b.x)), height: Math.max(...all.map((b) => b.y + b.height)) - Math.min(...all.map((b) => b.y)) };
}
