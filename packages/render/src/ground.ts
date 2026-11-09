// "What ground is under this point": the fill of the deepest group there, or the page. Groups are
// filled by nesting depth on a paper look, so labels and line bridges that cut a gap into a line
// need the colour they lie on.
import type { Box, Graph, GraphGroup, Placed } from '@cartography/core';
import { groupFill, type Theme } from '@cartography/theme';

export interface Ground {
  /** Nesting depth of a group: 0 for one that sits on the page. */
  depth(id: string): number;
  /** Fill of a group. */
  fill(g: GraphGroup): string;
  /** Colour under a point of the drawing (layout coordinates). */
  at(x: number, y: number): string;
  /** Colour under most of a box: where its centre lies. */
  under(b: Box): string;
}

export function groupDepths(groups: GraphGroup[]): Map<string, number> {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const seen = new Map<string, number>();
  const depth = (g: GraphGroup, guard = 0): number => {
    const hit = seen.get(g.id);
    if (hit !== undefined) return hit;
    const parent = g.parent ? byId.get(g.parent) : undefined;
    const d = parent && guard < 32 ? 1 + depth(parent, guard + 1) : 0;
    seen.set(g.id, d);
    return d;
  };
  for (const g of groups) depth(g);
  return seen;
}

export function groundOf(graph: Graph, placed: Placed, theme: Theme): Ground {
  const depths = groupDepths(graph.groups);
  const depth = (id: string) => depths.get(id) ?? 0;
  const fill = (g: GraphGroup) => groupFill(theme, depth(g.id), theme.tones[g.tone]);
  // Deepest first, so the first hit is the ground.
  const boxes = graph.groups
    .map((g) => ({ g, box: placed.groups.get(g.id), d: depth(g.id) }))
    .filter((x): x is { g: GraphGroup; box: Box; d: number } => !!x.box)
    .sort((a, b) => b.d - a.d);
  const at = (x: number, y: number) => {
    for (const { g, box } of boxes) if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) return fill(g);
    return theme.canvas;
  };
  return { depth, fill, at, under: (b) => at(b.x + b.width / 2, b.y + b.height / 2) };
}
