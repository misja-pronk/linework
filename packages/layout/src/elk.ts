// Default layout for node-and-edge diagrams: ELK layered, orthogonal edges, nested groups.
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode, ElkPort, LayoutOptions } from 'elkjs/lib/elk-api.js';
import type { Box, GraphEdge, Placed, PlacedEdge, Point, Sized } from '@cartography/core';

export interface Spacing {
  nodeGap: number;
  layerGap: number;
  groupPad: number;
}

const elk = new ELK();

export async function layoutElk(sized: Sized, spacing: Spacing): Promise<Placed> {
  const { graph } = sized;
  const usesRows = graph.edges.some((e) => e.from.row || e.to.row);
  if (!usesRows) return place(await elk.layout(elkGraph(sized, spacing)), sized);
  // Lines attach to table rows, on the left or right side. Which side depends on where the
  // other table ends up, so lay out once without ports, pick sides, then lay out with them.
  const first = place(await elk.layout(elkGraph(sized, spacing)), sized);
  const sides = new Map<string, 'W' | 'E'>();
  for (const e of graph.edges) {
    const a = first.nodes.get(e.from.node);
    const b = first.nodes.get(e.to.node);
    if (!a || !b) continue;
    const right = a.x + a.width / 2 <= b.x + b.width / 2;
    if (e.from.row) sides.set(e.id + ':from', right ? 'E' : 'W');
    if (e.to.row) sides.set(e.id + ':to', right ? 'W' : 'E');
  }
  return place(await elk.layout(elkGraph(sized, spacing, sides)), sized);
}

const portId = (node: string, row: string, side: 'W' | 'E') => `${node}::${row}::${side}`;

function elkGraph(sized: Sized, s: Spacing, sides?: Map<string, 'W' | 'E'>): ElkNode {
  const { graph } = sized;
  const ports = new Map<string, ElkPort[]>();
  const endpoint = (e: GraphEdge, end: 'from' | 'to') => {
    const ep = e[end];
    const side = sides?.get(`${e.id}:${end}`);
    if (!ep.row || !side) return ep.node;
    const size = sized.nodes.get(ep.node);
    const y = size?.rowY?.[ep.row];
    if (!size || y == null) return ep.node;
    const id = portId(ep.node, ep.row, side);
    const list = ports.get(ep.node) ?? [];
    if (!list.some((p) => p.id === id))
      list.push({
        id,
        x: side === 'W' ? 0 : size.width,
        y,
        width: 0,
        height: 0,
        layoutOptions: { 'elk.port.side': side === 'W' ? 'WEST' : 'EAST' },
      });
    ports.set(ep.node, list);
    return id;
  };

  const edges: ElkExtendedEdge[] = graph.edges.map((e) => {
    const label = sized.edgeLabels.get(e.id);
    return {
      id: e.id,
      sources: [endpoint(e, 'from')],
      targets: [endpoint(e, 'to')],
      labels: label && e.label ? [{ id: `${e.id}:label`, text: e.label, width: label.width, height: label.height }] : [],
    };
  });

  // ELK does not pass options down to groups, so every group gets the spacing explicitly.
  // Lines on table rows end in crow's feet, which need room on both sides.
  const layerGap = sized.graph.edges.some((e) => e.from.row || e.to.row) ? Math.max(s.layerGap, 96) : s.layerGap;
  const spacing: LayoutOptions = {
    'elk.spacing.nodeNode': String(s.nodeGap),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(layerGap),
    'elk.spacing.edgeNode': '24',
    'elk.spacing.edgeEdge': '14',
    'elk.layered.spacing.edgeNodeBetweenLayers': '24',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
    'elk.spacing.componentComponent': String(layerGap),
    'elk.spacing.edgeLabel': '4',
  };

  const children = new Map<string | undefined, ElkNode[]>();
  const add = (parent: string | undefined, n: ElkNode) => children.set(parent, [...(children.get(parent) ?? []), n]);
  // Groups and nodes in source order, so the drawing follows the order people wrote (stability).
  for (const g of graph.groups)
    add(g.parent, {
      id: g.id,
      layoutOptions: {
        ...spacing,
        'elk.padding': `[top=${sized.groupHeader},left=${s.groupPad},bottom=${s.groupPad},right=${s.groupPad}]`,
        'elk.nodeSize.constraints': 'MINIMUM_SIZE',
        'elk.nodeSize.minimum': `(${sized.groupMinWidth.get(g.id) ?? 0}, ${sized.groupHeader + s.groupPad})`,
      },
    });
  for (const n of graph.nodes) {
    const size = sized.nodes.get(n.id)!;
    add(n.parent, {
      id: n.id,
      width: size.width,
      height: size.height,
      ports: ports.get(n.id),
      layoutOptions: ports.has(n.id) ? { 'elk.portConstraints': 'FIXED_POS' } : undefined,
    });
  }
  const attach = (n: ElkNode): ElkNode => {
    const kids = children.get(n.id);
    return kids ? { ...n, children: kids.map(attach) } : n;
  };

  const options: LayoutOptions = {
    ...spacing,
    'elk.algorithm': 'layered',
    'elk.direction': graph.direction === 'down' ? 'DOWN' : 'RIGHT',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.json.shapeCoords': 'ROOT',
    'elk.json.edgeCoords': 'ROOT',
    'elk.edgeLabels.inline': 'true',
    'elk.edgeLabels.placement': 'CENTER',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    'elk.layered.thoroughness': '20',
    'elk.padding': '[top=0,left=0,bottom=0,right=0]',
  };

  return { id: '__root', layoutOptions: options, children: (children.get(undefined) ?? []).map(attach), edges };
}

function place(root: ElkNode, sized: Sized): Placed {
  const groupIds = new Set(sized.graph.groups.map((g) => g.id));
  const nodes = new Map<string, Box>();
  const groups = new Map<string, Box>();
  const walk = (n: ElkNode) => {
    for (const c of n.children ?? []) {
      const box = { x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? 0, height: c.height ?? 0 };
      (groupIds.has(c.id) ? groups : nodes).set(c.id, box);
      walk(c);
    }
  };
  walk(root);

  const edges = new Map<string, PlacedEdge>();
  const collect = (n: ElkNode) => {
    for (const e of (n.edges ?? []) as ElkExtendedEdge[]) {
      const sec = e.sections?.[0];
      if (!sec) continue;
      const l = e.labels?.[0];
      const points = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint].map((p) => ({ x: p.x, y: p.y }));
      edges.set(e.id, {
        points,
        label: l ? onLine(points, { x: l.x ?? 0, y: l.y ?? 0, width: l.width ?? 0, height: l.height ?? 0 }) : undefined,
      });
    }
    for (const c of n.children ?? []) collect(c);
  };
  collect(root);

  return { nodes, groups, edges, width: root.width ?? 0, height: root.height ?? 0 };
}

/** ELK puts inline labels next to the line; centre the pill on the nearest point of the line instead. */
function onLine(points: Point[], label: Box): Box {
  const c = { x: label.x + label.width / 2, y: label.y + label.height / 2 };
  let best = { d: Infinity, x: c.x, y: c.y };
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1]!;
    const q = points[i]!;
    const len2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((c.x - p.x) * (q.x - p.x) + (c.y - p.y) * (q.y - p.y)) / len2));
    const x = p.x + t * (q.x - p.x);
    const y = p.y + t * (q.y - p.y);
    const d = (x - c.x) ** 2 + (y - c.y) ** 2;
    if (d < best.d) best = { d, x, y };
  }
  return { ...label, x: best.x - label.width / 2, y: best.y - label.height / 2 };
}
