// Trust boundaries of node-and-edge diagrams: groups drawn as a boundary, a heavier dashed line in the
// rose of a warning, with *Trust boundary* next to the name so it reads without colour too.
//
//   groups:
//     internet: { kind: trust-boundary, label: Internet }      # the kind says it
//     app: { kind: zone, label: Application zone, trust: true } # or a flag on any group
//     psp: { kind: system, label: Stripe, trust: PCI scope }    # a string names the boundary
//   trust: [shop]                                               # groups that are trust boundaries (model views)
import type { BuildContext } from './diagram-type.ts';
import type { Graph } from './model.ts';

/** Fields of trust boundaries on a group and on the diagram, for graphSchema. */
export const trustFields = {
  group: { trust: { anyOf: [{ type: 'boolean' }, { type: 'string' }], description: 'A trust boundary: drawn as one; a string names it' } },
  top: { trust: { type: 'array', items: { type: 'string' }, description: 'Groups that are trust boundaries, by id' } },
};

/** The diagram's own `trust:`, which model views do not carry over: kept aside so it reaches the drawing. */
export const trustKeys = (src: Record<string, unknown>): Record<string, unknown> => (src.trust !== undefined ? { trust: src.trust } : {});

/** Marks the groups that are trust boundaries, and says so in the key. */
export function applyTrust(graph: Graph, src: Record<string, unknown>, ctx: BuildContext): void {
  const groupsSrc = src.groups && typeof src.groups === 'object' ? (src.groups as Record<string, unknown>) : {};
  const trustOf = (id: string) => {
    const e = groupsSrc[id];
    return e && typeof e === 'object' ? (e as { trust?: unknown }).trust : undefined;
  };
  const list = Array.isArray(src.trust) ? (src.trust as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const groupIds = new Set(graph.groups.map((g) => g.id));
  for (const [i, id] of list.entries()) if (!groupIds.has(id)) ctx.warn(['trust', i], `There is no group "${id}" in this drawing`);
  let any = false;
  for (const g of graph.groups) {
    const t = trustOf(g.id);
    if (!t && !list.includes(g.id) && g.kind !== 'trust-boundary') continue;
    any = true;
    g.trust = true;
    // Its icon in the colour of its line, so a zone does not look like two things at once.
    g.tone = 'rose';
    if (typeof t === 'string' && t && t !== g.label) g.caption = t;
    else if (!g.caption || ['Zone', 'Boundary', 'Trust boundary'].includes(g.caption)) g.caption = 'Trust boundary';
  }
  if (any) graph.legend = [...(graph.legend ?? []), { label: 'Trust boundary', swatch: 'trust', tone: 'rose' }];
}
