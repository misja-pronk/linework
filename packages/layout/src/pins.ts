// Manual tweaks from the sidecar: pinned nodes keep the position people dragged them to and groups
// grow to keep holding their children. Runs before routing, so lines follow the moved nodes.
import type { Box, Graph, LayoutSidecar } from '@cartography/core';
import type { Placement } from './dot.ts';

export function applyPins(p: Placement, graph: Graph, sidecar: LayoutSidecar | undefined, header: number, pad: number): Placement {
  const pins = Object.entries(sidecar?.nodes ?? {}).filter(([id]) => p.nodes.has(id));
  if (!pins.length) return p;
  const nodes = new Map(p.nodes);
  for (const [id, at] of pins) nodes.set(id, { ...nodes.get(id)!, x: at.x, y: at.y });
  return { ...p, nodes, groups: growGroups(graph, nodes, new Map(p.groups), header, pad) };
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
