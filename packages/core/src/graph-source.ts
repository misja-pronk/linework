// The YAML shape shared by node-and-edge types (Azure, Kubernetes, networking, GitHub, …):
//
//   groups:
//     prod: subscription                      # shorthand: id: kind
//     rg-app: { kind: resource-group, in: prod, label: rg-shop-app }
//   nodes:
//     web: { kind: app-service, in: rg-app, label: Web shop }
//   edges:
//     - web -> db: { label: SQL, style: private }
import { edgeItemSchema, edgeReferences, parseEdge } from './edges.ts';
import { idPattern, type BuildContext, type KindTable, type Reference } from './diagram-type.ts';
import type { Direction, Graph, GraphEdge, GraphGroup, GraphNode, LegendItem, Tone } from './model.ts';
import { tones } from './model.ts';

export interface GraphTypeConfig {
  nodeKinds: KindTable;
  groupKinds: Record<string, KindTable[string] & { border?: GraphGroup['border'] }>;
  /** Named edge styles (e.g. public, private); used ones end up in the legend. */
  edgeStyles?: Record<string, { label: string; line: GraphEdge['line']; tone?: Tone }>;
}

interface Entry {
  kind?: string;
  label?: string;
  caption?: string;
  in?: string;
  icon?: string;
  tone?: Tone;
  badges?: string[];
}

export interface GraphSource {
  title?: string;
  subtitle?: string;
  direction?: Direction;
  groups?: Record<string, string | Entry>;
  nodes?: Record<string, string | Entry>;
  edges?: unknown[];
}

/** References in node-and-edge YAML: `in:` and edge ends. */
export function graphReferences(src: GraphSource): Reference[] {
  const out: Reference[] = [];
  const has = (c: 'groups' | 'nodes', id: string) => !!src[c] && Object.hasOwn(src[c]!, id);
  for (const c of ['groups', 'nodes'] as const)
    for (const [id, e] of Object.entries(src[c] ?? {}))
      if (e && typeof e === 'object' && typeof e.in === 'string') out.push({ path: [c, id, 'in'], id: e.in, start: 0, collection: 'groups' });
  out.push(...edgeReferences(src.edges, ['edges'], (id) => (has('nodes', id) ? 'nodes' : has('groups', id) ? 'groups' : undefined)));
  return out;
}

export function graphSchema(typeId: string, cfg: GraphTypeConfig, title: string): object {
  const entry = (kinds: string[], extra: Record<string, object> = {}) => ({
    anyOf: [
      { enum: kinds },
      {
        type: 'object',
        required: ['kind'],
        properties: {
          kind: { enum: kinds },
          label: { type: 'string' },
          caption: { type: 'string', description: 'Small text under the label; defaults to the kind' },
          in: { type: 'string', description: 'Id of the group this sits in' },
          icon: { type: 'string' },
          tone: { enum: tones },
          ...extra,
        },
        additionalProperties: false,
      },
    ],
  });
  const styles: Record<string, object> = cfg.edgeStyles ? { style: { enum: Object.keys(cfg.edgeStyles) } } : {};
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title,
    type: 'object',
    required: ['type'],
    properties: {
      type: { const: typeId },
      title: { type: 'string' },
      subtitle: { type: 'string' },
      direction: { enum: ['right', 'down'] },
      groups: { type: 'object', propertyNames: { pattern: idPattern }, additionalProperties: entry(Object.keys(cfg.groupKinds)) },
      nodes: {
        type: 'object',
        propertyNames: { pattern: idPattern },
        additionalProperties: entry(Object.keys(cfg.nodeKinds), { badges: { type: 'array', items: { type: 'string' } } }),
      },
      edges: { type: 'array', items: edgeItemSchema(styles) },
    },
    additionalProperties: false,
  };
}

export function buildGraph(src: GraphSource, cfg: GraphTypeConfig, ctx: BuildContext): Graph {
  const entries = (coll: 'groups' | 'nodes') =>
    Object.entries(src[coll] ?? {}).map(([id, v]) => [id, typeof v === 'string' ? { kind: v } : v] as [string, Entry]);
  const groupEntries = entries('groups');
  const nodeEntries = entries('nodes');
  const groupIds = new Set(groupEntries.map(([id]) => id));
  const ids = new Set([...groupIds, ...nodeEntries.map(([id]) => id)]);

  for (const [id] of nodeEntries) if (groupIds.has(id)) ctx.error(['nodes', id], `"${id}" is already a group`);

  const parentOf = (coll: string, id: string, e: Entry) => {
    if (e.in == null) return undefined;
    if (!groupIds.has(e.in)) {
      ctx.error([coll, id, 'in'], `There is no group "${e.in}"`);
      return undefined;
    }
    return e.in;
  };

  const groups: GraphGroup[] = groupEntries.map(([id, e]) => {
    const kind = cfg.groupKinds[e.kind ?? ''];
    return {
      id,
      parent: parentOf('groups', id, e),
      label: e.label ?? id,
      caption: e.caption ?? kind?.label,
      icon: e.icon ?? kind?.icon,
      tone: e.tone ?? kind?.tone ?? 'slate',
      border: kind?.border ?? 'solid',
      path: ['groups', id],
    };
  });
  breakCycles(groups, ctx);

  const nodes: GraphNode[] = nodeEntries.map(([id, e]) => {
    const kind = cfg.nodeKinds[e.kind ?? ''];
    return {
      id,
      parent: parentOf('nodes', id, e),
      shape: {
        kind: 'card',
        // Without a label the kind names the node ("Users"), and repeating it as caption adds nothing.
        label: e.label ?? kind?.label ?? id,
        caption: e.caption ?? (e.label && e.label !== kind?.label ? kind?.label : undefined),
        icon: e.icon ?? kind?.icon,
        tone: e.tone ?? kind?.tone ?? 'slate',
        badges: e.badges,
      },
      path: ['nodes', id],
    };
  });

  const edges: GraphEdge[] = [];
  const usedStyles = new Set<string>();
  for (const [i, item] of (src.edges ?? []).entries()) {
    const spec = parseEdge(item, ['edges', i]);
    if (typeof spec === 'string') {
      ctx.error(['edges', i], spec);
      continue;
    }
    let ok = true;
    for (const end of [spec.from, spec.to])
      if (!ids.has(end.node)) {
        ctx.error(['edges', i], `There is no node or group "${end.node}"`);
        ok = false;
      }
    if (!ok) continue;
    const style = typeof spec.props.style === 'string' ? cfg.edgeStyles?.[spec.props.style] : undefined;
    if (style) usedStyles.add(spec.props.style as string);
    edges.push({
      id: `e${i}`,
      from: spec.from,
      to: spec.to,
      label: spec.label,
      line: spec.props.line ? spec.line : (style?.line ?? spec.line),
      tone: style?.tone,
      start: spec.start,
      end: spec.end,
      path: spec.path,
    });
  }

  const legend: LegendItem[] = Object.entries(cfg.edgeStyles ?? {})
    .filter(([k]) => usedStyles.has(k))
    .map(([, s]) => ({ label: s.label, line: s.line, tone: s.tone }));

  return { title: src.title, subtitle: src.subtitle, direction: src.direction ?? 'right', groups, nodes, edges, legend };
}

function breakCycles(groups: GraphGroup[], ctx: BuildContext) {
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const g of groups) {
    const seen = new Set([g.id]);
    for (let p = g.parent; p; p = byId.get(p)?.parent) {
      if (seen.has(p)) {
        ctx.error(['groups', g.id, 'in'], `"${g.id}" ends up inside itself`);
        g.parent = undefined;
        break;
      }
      seen.add(p);
    }
  }
}
