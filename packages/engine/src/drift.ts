// Drift: a sidecar (<name>.layout.json) holds pins and bends by id. When the YAML moves on (a node
// renamed, a view removed, a line taken out) those entries point at nothing and silently stop
// working. This finds them, so CI can say so, and drops them on request.
import { viewPins, withViewPins, type LayoutSidecar, type ViewPins } from '@cartography/core';
import { render, type RenderOptions } from './index.ts';

export interface DriftItem {
  /** The view the entry belongs to; undefined for the diagram as written. */
  view?: string;
  /** Where in the sidecar: "nodes.api", "views.prod", "views.prod.edges.e3", "locked.db". */
  path: string;
  kind: 'view' | 'node' | 'group' | 'edge' | 'locked';
  id: string;
  message: string;
}

export interface DriftResult {
  /** Entries that no longer match the diagram. */
  stale: DriftItem[];
  /** The sidecar without them; undefined when nothing is left to keep. */
  fixed: LayoutSidecar | undefined;
  /** The diagram could not be drawn, so nothing can be said about its sidecar. */
  error?: string;
}

/** What one view's tweaks refer to that the drawing of that view does not have. */
function check(pins: ViewPins, ids: { nodes: Set<string>; groups: Set<string>; edges: Map<string, { from: string; to: string }> }, view: string | undefined, at: string): { stale: DriftItem[]; kept: ViewPins } {
  const stale: DriftItem[] = [];
  const kept: ViewPins = { ...pins };
  const where = view ? ` in view "${view}"` : '';
  const item = (kind: DriftItem['kind'], key: string, id: string, message: string) => stale.push({ view, path: `${at}${key}.${id}`, kind, id, message });

  for (const [key, kind, known] of [['nodes', 'node', ids.nodes], ['groups', 'group', ids.groups]] as const) {
    const entries = Object.entries(pins[key] ?? {});
    const ok = entries.filter(([id]) => known.has(id));
    for (const [id] of entries)
      if (!known.has(id)) {
        // A group that became a node (or the other way round) is still drawn, only not as this.
        const other = kind === 'node' ? ids.groups.has(id) : ids.nodes.has(id);
        item(kind, key, id, other ? `"${id}" is pinned as a ${kind}, but is now a ${kind === 'node' ? 'group' : 'node'}${where}` : `pinned ${kind} "${id}" is not drawn${where}`);
      }
    if (ok.length) kept[key] = Object.fromEntries(ok);
    else delete kept[key];
  }

  const bends = Object.entries(pins.edges ?? {});
  const good = bends.filter(([id, o]) => {
    const e = ids.edges.get(id);
    if (!e) return (item('edge', 'edges', id, `bent line "${id}" is not drawn${where}`), false);
    // Line ids are positions in a list: the same id can be another line after an edit.
    if ((o.from != null && o.from !== e.from) || (o.to != null && o.to !== e.to))
      return (item('edge', 'edges', id, `line "${id}" was bent when it ran ${o.from ?? '?'} -> ${o.to ?? '?'}; it now runs ${e.from} -> ${e.to}${where}`), false);
    return true;
  });
  if (good.length) kept.edges = Object.fromEntries(good);
  else delete kept.edges;

  // A lock holds a pin in place: without the pin (or the element) it holds nothing.
  const locks = pins.locked ?? [];
  const held = locks.filter((id) => {
    if (kept.nodes?.[id] || kept.groups?.[id]) return true;
    const gone = !ids.nodes.has(id) && !ids.groups.has(id);
    return (item('locked', 'locked', id, gone ? `locked "${id}" is not drawn${where}` : `"${id}" is locked but not pinned${where}`), false);
  });
  if (held.length) kept.locked = held;
  else delete kept.locked;
  return { stale, kept };
}

/** Top-level entries of a diagram that is only drawn through its views. */
function unused(pins: ViewPins): { stale: DriftItem[]; kept: ViewPins } {
  const stale: DriftItem[] = [];
  const say = (kind: DriftItem['kind'], key: string, id: string) =>
    stale.push({ path: `${key}.${id}`, kind, id, message: `${kind === 'locked' ? 'lock on' : kind === 'edge' ? 'bent line' : `pinned ${kind}`} "${id}" is never used: the diagram only has views, and each view keeps its own under "views"` });
  for (const id of Object.keys(pins.nodes ?? {})) say('node', 'nodes', id);
  for (const id of Object.keys(pins.groups ?? {})) say('group', 'groups', id);
  for (const id of Object.keys(pins.edges ?? {})) say('edge', 'edges', id);
  for (const id of pins.locked ?? []) say('locked', 'locked', id);
  return { stale, kept: {} };
}

/**
 * Checks a sidecar against its diagram: every view that has entries is drawn once (without the
 * sidecar) to see what is there. The layout note (`layout`) is a hint that heals itself and is
 * never reported; it goes when a view goes.
 */
export async function drift(text: string, sidecar: LayoutSidecar | undefined, opts: Pick<RenderOptions, 'load' | 'file' | 'packs' | 'pack'> = {}): Promise<DriftResult> {
  if (!sidecar || typeof sidecar !== 'object') return { stale: [], fixed: sidecar };
  const draw = (view?: string) => render(text, { ...opts, fonts: 'none', view });
  const first = await draw();
  const failed = (r: Awaited<ReturnType<typeof draw>>) => !r.graph || r.diagnostics.some((d) => d.severity === 'error');
  const stale: DriftItem[] = [];
  let fixed: LayoutSidecar | undefined = sidecar;
  const names = new Set((first.views ?? []).map((v) => v.name));

  const idsOf = (r: Awaited<ReturnType<typeof draw>>) => ({
    nodes: new Set(r.graph!.nodes.map((n) => n.id)),
    groups: new Set(r.graph!.groups.map((g) => g.id)),
    edges: new Map(r.graph!.edges.map((e) => [e.id, { from: e.from.node, to: e.to.node }])),
  });

  // The top level belongs to the diagram as written (or to its first view, when it only has views).
  const top = viewPins(sidecar);
  const hasTop = !!top && ['nodes', 'groups', 'edges', 'locked'].some((k) => Object.keys(top[k as 'nodes'] ?? {}).length);
  if (hasTop) {
    if (failed(first)) return { stale: [], fixed: sidecar, error: 'the diagram has errors, so its layout file cannot be checked' };
    const { views: _, version: __, ...own } = sidecar;
    // A diagram that only has views never reads the top level: every view has its own entry.
    const r = first.onlyViews ? unused(own) : check(own, idsOf(first), undefined, '');
    stale.push(...r.stale);
    if (r.stale.length) fixed = withViewPins(sidecar, undefined, { version: 1, ...r.kept });
  }

  for (const [name, pins] of Object.entries(sidecar.views ?? {})) {
    if (!names.has(name)) {
      // Without any view left to compare with and a broken diagram, say nothing rather than guess.
      if (failed(first) && !first.views) return { stale: [], fixed: sidecar, error: 'the diagram has errors, so its layout file cannot be checked' };
      stale.push({ view: name, path: `views.${name}`, kind: 'view', id: name, message: `view "${name}" does not exist${names.size ? ` (views: ${[...names].join(', ')})` : ''}` });
      fixed = withViewPins(fixed, name, null);
      continue;
    }
    const drawn = await draw(name);
    if (failed(drawn)) return { stale: [], fixed: sidecar, error: `view "${name}" has errors, so its layout cannot be checked` };
    const r = check(pins, idsOf(drawn), name, `views.${name}.`);
    stale.push(...r.stale);
    if (r.stale.length) fixed = withViewPins(fixed, name, { version: 1, ...r.kept });
  }
  return { stale, fixed };
}
