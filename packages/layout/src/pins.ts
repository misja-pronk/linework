// Manual tweaks from the sidecar: pinned nodes keep the position people dragged them to and groups
// grow to keep holding their children. Runs before routing, so lines follow the moved nodes.
import type { Box, Graph, LayoutSidecar } from '@cartography/core';
import type { Placement } from './dot.ts';

export function applyPins(p: Placement, graph: Graph, sidecar: LayoutSidecar | undefined, header: number, pad: number, gap = 24): Placement & { nudged?: string[] } {
  const pins = Object.entries(sidecar?.nodes ?? {}).filter(([id]) => p.nodes.has(id));
  const groupPins = Object.entries(sidecar?.groups ?? {}).filter(([id]) => p.groups.has(id));
  if (!pins.length && !groupPins.length) return p;
  const nodes = new Map(p.nodes);
  const groups = new Map(p.groups);
  // Moved groups first (outer before inner), carrying their contents; then pinned nodes on top.
  const fixed = new Set<string>();
  const depth = (id: string): number => {
    const parent = graph.groups.find((g) => g.id === id)?.parent;
    return parent ? 1 + depth(parent) : 0;
  };
  for (const [id, at] of groupPins.sort(([a], [b]) => depth(a) - depth(b))) {
    const box = groups.get(id)!;
    const dx = at.x - box.x;
    const dy = at.y - box.y;
    const inside = new Set([id, ...descendantGroups(graph, id)]);
    // Empty groups have no box: nothing to move.
    for (const g of inside) if (groups.has(g)) groups.set(g, move(groups.get(g)!, dx, dy));
    for (const n of graph.nodes)
      if (n.parent && inside.has(n.parent) && nodes.has(n.id)) {
        nodes.set(n.id, move(nodes.get(n.id)!, dx, dy));
        fixed.add(n.id);
      }
  }
  for (const [id, at] of pins) {
    nodes.set(id, { ...nodes.get(id)!, x: at.x, y: at.y });
    fixed.add(id);
  }
  makeRoom(nodes, fixed, graph.direction === 'down', gap);
  growGroups(graph, nodes, groups, header, pad, new Set(pins.map(([id]) => id)));
  // Newest last: an object keeps its keys in the order they were first set.
  const order = [...pins.map(([id]) => id), ...groupPins.map(([id]) => id)];
  const nudged = clearOverlaps(graph, nodes, groups, fixed, new Set(groupPins.map(([id]) => id)), order, header, pad, gap);
  return { ...p, nodes, groups, ...(nudged.length ? { nudged } : {}) };
}

/** Whole grid steps, rounded away from zero: a move out of the way is never short of it. */
const away = (n: number) => (n < 0 ? Math.floor(n / 8) : Math.ceil(n / 8)) * 8;

/** Air kept between a group and what it does not hold, once something had to move out of its way. */
const CLEAR = 16;

/**
 * Nothing lies on anything it is not in. A group that grew around a pinned node (or was moved by
 * hand) can come to lie over a node or group beside it: what is not pinned moves out of its way, the
 * shortest way out, carrying what it holds, and the groups around it grow to keep holding it. When
 * both are pinned, the newer pin gives way and is named in the result, so the editor can say so.
 */
export function clearOverlaps(graph: Graph, nodes: Map<string, Box>, groups: Map<string, Box>, fixed: Set<string>, pinnedGroups: Set<string>, order: string[], header: number, pad: number, gap: number): string[] {
  const parent = new Map<string, string | undefined>([...graph.groups.map((g) => [g.id, g.parent] as const), ...graph.nodes.map((n) => [n.id, n.parent] as const)]);
  const isGroup = (id: string) => groups.has(id);
  const box = (id: string) => (nodes.get(id) ?? groups.get(id))!;
  const within = (id: string, g: string) => {
    for (let x = parent.get(id); x; x = parent.get(x)) if (x === g) return true;
    return false;
  };
  const subtree = (id: string) => [id, ...[...nodes.keys(), ...groups.keys()].filter((x) => within(x, id))];
  const movable = (id: string) => subtree(id).every((x) => !fixed.has(x) && !pinnedGroups.has(x));
  const ids = [...groups.keys(), ...nodes.keys()];
  const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const nudged = new Set<string>();
  for (let round = 0; round < 60; round++) {
    let pair: [string, string] | undefined;
    for (const g of ids) {
      for (const x of ids) {
        if (x === g || within(x, g) || within(g, x)) continue;
        // Two nodes are makeRoom's (and the layout's) to keep apart; a group is in this pair.
        if (!isGroup(g) && !isGroup(x)) {
          if (!(fixed.has(g) && fixed.has(x))) continue;
        }
        if (overlap(box(g), box(x))) {
          pair = [g, x];
          break;
        }
      }
      if (pair) break;
    }
    if (!pair) break;
    const [g, x] = pair;
    // What gives way: the one that may move; the one that did not grow (x); else the newer pin.
    let mover = movable(x) ? x : movable(g) ? g : undefined;
    let still = mover === x ? g : x;
    if (!mover) {
      const age = (id: string) => Math.max(...subtree(id).map((y) => order.indexOf(y)));
      [mover, still] = age(x) >= age(g) ? [x, g] : [g, x];
      nudged.add(mover);
    }
    const m = box(mover);
    const s = box(still);
    const air = isGroup(mover) || isGroup(still) ? CLEAR : gap;
    // The four ways out, the shortest wins.
    const ways = [
      { dx: s.x - air - (m.x + m.width), dy: 0 },
      { dx: s.x + s.width + air - m.x, dy: 0 },
      { dx: 0, dy: s.y - air - (m.y + m.height) },
      { dx: 0, dy: s.y + s.height + air - m.y },
    ].map((w) => ({ dx: away(w.dx), dy: away(w.dy) }));
    const way = ways.sort((a, b) => Math.abs(a.dx) + Math.abs(a.dy) - (Math.abs(b.dx) + Math.abs(b.dy)))[0]!;
    for (const id of subtree(mover)) {
      const map = nodes.has(id) ? nodes : groups;
      const b = map.get(id)!;
      map.set(id, { ...b, x: b.x + way.dx, y: b.y + way.dy });
    }
    // The groups around what moved grow to keep holding it.
    growGroups(graph, nodes, groups, header, pad);
  }
  return [...nudged];
}

/**
 * A pinned node never sits on another: nodes in its way move across the flow (down in a left-to-right
 * diagram), and so do the ones they then run into. Pinned nodes themselves stay exactly where they were
 * put, and a node nothing ran into stays where it was: two that the layout itself put closer together
 * than the gap are left alone.
 */
function makeRoom(nodes: Map<string, Box>, pinned: Set<string>, down: boolean, gap: number) {
  const settled: { box: Box; moved: boolean }[] = [...pinned].map((id) => ({ box: nodes.get(id)!, moved: true }));
  const hit = (a: Box, b: Box) => a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
  const free = [...nodes.keys()].filter((id) => !pinned.has(id)).sort((a, b) => (down ? nodes.get(a)!.x - nodes.get(b)!.x : nodes.get(a)!.y - nodes.get(b)!.y));
  for (const id of free) {
    let b = nodes.get(id)!;
    let moved = false;
    for (let guard = 0; guard < 200; guard++) {
      const blocker = settled.find((s) => (moved || s.moved) && hit(b, s.box))?.box;
      if (!blocker) break;
      b = down ? { ...b, x: blocker.x + blocker.width + gap } : { ...b, y: blocker.y + blocker.height + gap };
      moved = true;
    }
    nodes.set(id, b);
    settled.push({ box: b, moved });
  }
}

const move = (b: Box, dx: number, dy: number): Box => ({ ...b, x: b.x + dx, y: b.y + dy });

function descendantGroups(graph: Graph, id: string): string[] {
  const kids = graph.groups.filter((g) => g.parent === id).map((g) => g.id);
  return [...kids, ...kids.flatMap((k) => descendantGroups(graph, k))];
}

export function growGroups(graph: Graph, nodes: Map<string, Box>, groups: Map<string, Box>, header: number, pad: number, pinned?: Set<string>) {
  const byId = new Map(graph.groups.map((g) => [g.id, g]));
  const depth = (id: string): number => {
    const parent = byId.get(id)?.parent;
    return parent ? 1 + depth(parent) : 0;
  };
  // Innermost groups first, so their growth propagates outward.
  for (const g of [...graph.groups].sort((a, b) => depth(b.id) - depth(a.id))) {
    const box = groups.get(g.id);
    if (!box) continue;
    const kids = [
      ...graph.nodes.filter((n) => n.parent === g.id).map((n) => nodes.get(n.id)),
      ...graph.groups.filter((c) => c.parent === g.id).map((c) => groups.get(c.id)),
    ].filter((b): b is Box => !!b);
    if (!kids.length) continue;
    // Every node in it placed by hand (a drawing imported with its positions): it fits around them,
    // not around where the layout would have put them.
    const inside = new Set([g.id, ...descendantGroups(graph, g.id)]);
    const own = graph.nodes.filter((n) => n.parent && inside.has(n.parent) && nodes.has(n.id));
    if (pinned && own.length && own.every((n) => pinned.has(n.id))) {
      const fit = { x: Math.min(...kids.map((k) => k.x - pad)), y: Math.min(...kids.map((k) => k.y - header)) };
      const x1 = Math.max(...kids.map((k) => k.x + k.width + pad));
      const y1 = Math.max(...kids.map((k) => k.y + k.height + pad));
      groups.set(g.id, { x: fit.x, y: fit.y, width: x1 - fit.x, height: y1 - fit.y });
      continue;
    }
    // Some of it placed by hand (a shape dropped or dragged in): it fits around what is in it, not
    // around the room the layout made where the pinned ones would have gone; wide enough for a label.
    if (pinned && own.some((n) => pinned.has(n.id))) {
      const x0 = Math.min(...kids.map((k) => k.x - pad));
      const y0 = Math.min(...kids.map((k) => k.y - header));
      const x1 = Math.max(x0 + Math.min(box.width, 220), ...kids.map((k) => k.x + k.width + pad));
      const y1 = Math.max(...kids.map((k) => k.y + k.height + pad));
      groups.set(g.id, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
      continue;
    }
    const x0 = Math.min(box.x, ...kids.map((k) => k.x - pad));
    const y0 = Math.min(box.y, ...kids.map((k) => k.y - header));
    const x1 = Math.max(box.x + box.width, ...kids.map((k) => k.x + k.width + pad));
    const y1 = Math.max(box.y + box.height, ...kids.map((k) => k.y + k.height + pad));
    groups.set(g.id, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  }
  return groups;
}
