// Closes the room between columns that no label needs. Where lines carry labels (C4), dot is asked
// for one gap between all layers, wide enough for the widest label of the whole diagram: one long
// label then makes every gap that wide, and a drawing of five columns ends up mostly empty. Here
// each gap between two columns shrinks to what the labels of the lines crossing it need.
// Left-to-right drawings only: top-down, labels sit beside their lines and gaps are not widened.
import type { Box, Sized } from '@cartography/core';
import type { Placement, Spacing } from './dot.ts';

/** Room around a label in its gap: a stub at each end before the line may turn. */
const AROUND = 48;
/** Lines that fit in the least gap before each further one adds a lane. */
const LANES = 4;
const LANE = 12;

export function squeeze(p: Placement, sized: Sized, s: Spacing): Placement {
  const { graph } = sized;
  const nodes = new Map(p.nodes);
  const groups = new Map(p.groups);
  const boxOf = (id: string): Box | undefined => nodes.get(id) ?? groups.get(id);

  // What stands in the way along x: every node, and the padding inside each group's left and right border.
  const taken: [number, number][] = [...nodes.values()].map((b) => [b.x, b.x + b.width]);
  for (const g of groups.values()) taken.push([g.x, g.x + s.groupPad], [g.x + g.width - s.groupPad, g.x + g.width]);
  taken.sort((a, b) => a[0] - b[0]);
  const bands: [number, number][] = [];
  let end = -Infinity;
  for (const [a, b] of taken) {
    if (a > end + 1 && end > -Infinity) bands.push([end, a]);
    end = Math.max(end, b);
  }

  // Right to left, so that what is still to do keeps its coordinates.
  for (const [a, b] of bands.reverse()) {
    let lines = 0;
    let label = 0;
    for (const e of graph.edges) {
      const from = boxOf(e.from.node);
      const to = boxOf(e.to.node);
      if (!from || !to) continue;
      const [l, r] = from.x <= to.x ? [from, to] : [to, from];
      if (l.x + l.width > a + 1 || r.x < b - 1) continue;
      lines++;
      label = Math.max(label, sized.edgeLabels.get(e.id)?.width ?? 0);
    }
    if (!lines) continue;
    const least = Math.max(s.layerGap + 24 + Math.max(0, lines - LANES) * LANE, label ? label + AROUND : 0);
    let by = Math.floor((b - a - least) / 8) * 8;
    // A group around the gap stays as wide as its title.
    for (const [id, g] of groups) if (g.x < a && g.x + g.width > b) by = Math.min(by, Math.floor(g.width - (sized.groupMinWidth.get(id) ?? 0)));
    if (by <= 0) continue;
    for (const [id, n] of nodes) if (n.x >= b - 1) nodes.set(id, { ...n, x: n.x - by });
    for (const [id, g] of groups) {
      if (g.x >= b - 1) groups.set(id, { ...g, x: g.x - by });
      else if (g.x + g.width > b) groups.set(id, { ...g, width: g.width - by });
    }
  }
  const all = [...nodes.values(), ...groups.values()];
  return { nodes, groups, width: Math.max(...all.map((q) => q.x + q.width)), height: p.height };
}
