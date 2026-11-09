// Manual tweaks from the sidecar: pinned nodes keep the position people dragged them to and groups
// grow to keep holding their children. Runs before routing, so lines follow the moved nodes.
import type { Box, Graph, LayoutSidecar } from '@cartography/core';
import type { Placement } from './dot.ts';

export function applyPins(p: Placement, graph: Graph, sidecar: LayoutSidecar | undefined, header: number, pad: number, gap = 24): Placement {
  const pins = Object.entries(sidecar?.nodes ?? {}).filter(([id]) => p.nodes.has(id));
  if (!pins.length) return p;
  const nodes = new Map(p.nodes);
  for (const [id, at] of pins) nodes.set(id, { ...nodes.get(id)!, x: at.x, y: at.y });
  makeRoom(nodes, new Set(pins.map(([id]) => id)), graph.direction === 'down', gap);
  return { ...p, nodes, groups: growGroups(graph, nodes, new Map(p.groups), header, pad) };
}

/**
 * A pinned node never sits on another: nodes in its way move across the flow (down in a left-to-right
 * diagram), and so do the ones they then run into. Pinned nodes themselves stay exactly where they were put.
 */
function makeRoom(nodes: Map<string, Box>, pinned: Set<string>, down: boolean, gap: number) {
  const settled: Box[] = [...pinned].map((id) => nodes.get(id)!);
  const hit = (a: Box, b: Box) => a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
  const free = [...nodes.keys()].filter((id) => !pinned.has(id)).sort((a, b) => (down ? nodes.get(a)!.x - nodes.get(b)!.x : nodes.get(a)!.y - nodes.get(b)!.y));
  for (const id of free) {
    let b = nodes.get(id)!;
    for (let guard = 0; guard < 200; guard++) {
      const blocker = settled.find((s) => hit(b, s));
      if (!blocker) break;
      b = down ? { ...b, x: blocker.x + blocker.width + gap } : { ...b, y: blocker.y + blocker.height + gap };
    }
    nodes.set(id, b);
    settled.push(b);
  }
}

function growGroups(graph: Graph, nodes: Map<string, Box>, groups: Map<string, Box>, header: number, pad: number) {
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
    const x0 = Math.min(box.x, ...kids.map((k) => k.x - pad));
    const y0 = Math.min(box.y, ...kids.map((k) => k.y - header));
    const x1 = Math.max(box.x + box.width, ...kids.map((k) => k.x + k.width + pad));
    const y1 = Math.max(box.y + box.height, ...kids.map((k) => k.y + k.height + pad));
    groups.set(g.id, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  }
  return groups;
}
