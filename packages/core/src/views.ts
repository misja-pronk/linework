// Refs and views. For node-and-edge types the model is resolved into plain groups, nodes and edges
// before buildGraph draws them, so each type's own kinds, styles and legend still apply. Other types
// are filtered by id after they built their graph.
//
// A view picks elements (ids, `id.*`, `tag:x`, `kind:x`, `*`) and relations (`a -> b`, `* -> shop`);
// `expand` opens an element into a boundary with its parts. Relations of the model are drawn between
// whatever is shown: one to a part of a closed element ends on that element (C4's implied relations).
import { parseEdge } from './edges.ts';
import type { BuildContext, KindTable } from './diagram-type.ts';
import type { ModelContext, ModelElement, ViewSpec } from './catalogue.ts';
import type { Graph, LayoutSidecar, Path, Point, ViewPins } from './model.ts';
import type { Entry, GraphSource, GraphTypeConfig } from './graph-source.ts';

/** Where drawn entries are written, when not at ['nodes', id] / ['edges', i]: model elements, other files. */
export interface Origins {
  nodes: Record<string, Path>;
  groups: Record<string, Path>;
  /** Per item of `edges`, in order. */
  edges: { path: Path; id: string }[];
}

type Coll = 'groups' | 'nodes';

interface Item {
  id: string;
  /** Written in this diagram (as a node or a group), or only in the model. */
  coll?: Coll;
  kind?: string;
  tags: string[];
  parent?: string;
  el?: ModelElement;
}

const isRelation = (s: string) => /->/.test(s);
const sides = (s: string) => s.split('->').map((x) => x.trim()) as [string, string];

/** The diagram as the type should build it: refs filled in from the model, the view applied. */
export function resolveSource(src: GraphSource, cfg: GraphTypeConfig, m: ModelContext, ctx: BuildContext): GraphSource & { origin: Origins } {
  const els = m.elements;
  const view = m.view;
  const vat = (key: 'include' | 'exclude' | 'expand', j: number): Path => (view && view.at[0] === 'views' ? [...view.at, key, j] : (view?.at ?? []));

  // 1. Entries written here, with what their ref says filled in. Same id as an element: the same thing.
  const claimed = new Map<string, string>();
  const local = new Map<string, { coll: Coll; entry: Entry; kind?: string; tags: string[] }>();
  for (const coll of ['groups', 'nodes'] as const)
    for (const [id, raw] of Object.entries(src[coll] ?? {})) {
      let e: Entry = raw == null ? { ref: id } : typeof raw === 'string' ? { kind: raw } : { ...raw };
      let kind = e.kind;
      if (e.ref != null) {
        const el = els.get(e.ref);
        if (!el)
          ctx.error(raw == null ? [coll, id] : [coll, id, 'ref'], els.size ? `There is no element "${e.ref}" in the model` : `"${e.ref}" needs a model: add include: [model.yaml] or elements:`);
        else if (claimed.has(el.id)) ctx.error([coll, id, 'ref'], `"${el.id}" is already drawn as "${claimed.get(el.id)}"`);
        else {
          claimed.set(el.id, id);
          kind = e.kind ?? el.kind;
          e = fromElement(el, e, coll, cfg, ctx, [coll, id]);
        }
      } else if (els.has(id) && !claimed.has(id)) claimed.set(id, id);
      local.set(id, { coll, entry: e, kind, tags: [...(e.tags ?? []), ...(e.ref != null ? (els.get(e.ref)?.tags ?? []) : [])] });
    }
  const uid = (elId: string) => claimed.get(elId) ?? elId;

  // 2. Everything a view can show: local entries and the model's elements.
  const items = new Map<string, Item>();
  for (const [id, l] of local) items.set(id, { id, coll: l.coll, kind: l.kind, tags: l.tags, parent: l.entry.in });
  for (const el of els.values()) if (!claimed.has(el.id)) items.set(el.id, { id: el.id, kind: el.kind, tags: el.tags, parent: el.parent && uid(el.parent), el });
  const children = new Map<string, string[]>();
  for (const it of items.values()) if (it.parent) children.set(it.parent, [...(children.get(it.parent) ?? []), it.id]);
  const find = (s: string) => (items.has(s) ? s : els.has(s) ? uid(s) : undefined);

  const relations: { from: string; to: string; local?: number; model?: number }[] = [];
  const edgeEnds = (src.edges ?? []).map((item) => {
    const spec = parseEdge(item, []);
    if (typeof spec === 'string') return undefined;
    const end = (e: { node: string; row?: string }) => find(e.row ? `${e.node}.${e.row}` : e.node) ?? (items.has(e.node) ? e.node : undefined);
    return { from: end(spec.from), to: end(spec.to) };
  });
  edgeEnds.forEach((e, i) => e?.from && e.to && relations.push({ from: e.from, to: e.to, local: i }));
  for (const r of m.relations) {
    const from = find(r.from);
    const to = find(r.to);
    for (const [end, id] of [[from, r.from], [to, r.to]] as const) if (!end) ctx.warn(r.at, `There is no element "${id}" in the model`);
    if (from && to) relations.push({ from, to, model: r.index });
  }

  // 3. What the view shows.
  const expanded = new Set<string>();
  for (const [j, x] of (view?.expand ?? []).entries()) {
    const id = find(x);
    if (!id) ctx.warn(vat('expand', j), `There is no element "${x}" to expand`);
    else if (items.get(id)!.coll) ctx.warn(vat('expand', j), `"${x}" is drawn as written here; expand opens model elements`);
    else expanded.add(id);
  }
  const open = (id: string | undefined) => !!id && (expanded.has(id) || items.get(id)?.coll === 'groups');
  // What stands for an element at this level of detail: itself, or its outermost closed parent.
  const shown = (id: string) => {
    let cur = id;
    for (let p = items.get(cur)?.parent; p && !open(p); p = items.get(cur)?.parent) cur = p;
    return cur;
  };
  const ancestry = (id: string) => {
    const out = [id];
    for (let p = items.get(id)?.parent; p && !out.includes(p); p = items.get(p)?.parent) out.push(p);
    return out;
  };
  const matches = (sel: string, it: Item): boolean => {
    if (sel === '*') return !!it.coll || !it.parent;
    if (sel.startsWith('tag:')) return it.tags.includes(sel.slice(4));
    if (sel.startsWith('kind:')) return it.kind === sel.slice(5);
    if (sel.endsWith('.*')) return !!it.parent && it.parent === find(sel.slice(0, -2));
    return find(sel) === it.id;
  };
  const deep = (sel: string, id: string) => sel === '*' || ancestry(id).some((a) => matches(sel, items.get(a)!));
  const relMatch = (sel: string, r: { from: string; to: string }) => {
    const [a, b] = sides(sel);
    return deep(a, r.from) && deep(b, r.to);
  };

  const show = new Set<string>();
  const hasLocal = local.size > 0;
  if (!view) for (const it of items.values()) if (hasLocal ? !!it.coll : matches('*', it)) show.add(it.id);
  if (view) {
    for (const [j, sel] of (view.include ?? ['*']).entries()) {
      let hit = false;
      if (isRelation(sel)) {
        for (const r of relations) if (relMatch(sel, r)) (show.add(shown(r.from)), show.add(shown(r.to)), (hit = true));
      } else for (const it of items.values()) if (matches(sel, it)) (show.add(it.id), (hit = true));
      if (!hit && !sel.includes('*') && !sel.includes(':') && !isRelation(sel)) ctx.warn(vat('include', j), `There is no element "${sel}"`);
    }
    for (const x of expanded) {
      show.add(x);
      for (const c of children.get(x) ?? []) show.add(c);
    }
    for (const sel of view.exclude ?? []) if (!isRelation(sel)) for (const it of items.values()) if (matches(sel, it)) show.delete(it.id);
  }
  const hidden = (r: { from: string; to: string }) => (view?.exclude ?? []).some((sel) => isRelation(sel) && relMatch(sel, r));
  // What sits inside a drawn group keeps that group.
  for (const id of [...show]) for (let p = items.get(id)?.parent; p && open(p) && !show.has(p); p = items.get(p)?.parent) show.add(p);
  const asGroup = (id: string) => items.get(id)?.coll === 'groups' || (expanded.has(id) && !items.get(id)?.coll);

  // 4. The plain source.
  const out: GraphSource & { origin: Origins } = {
    title: view?.title ?? src.title,
    subtitle: view?.subtitle ?? (view?.title ? undefined : src.subtitle),
    direction: view?.direction ?? src.direction,
    ...(src.badges ? { badges: src.badges } : {}),
    groups: {},
    nodes: {},
    edges: [],
    origin: { nodes: {}, groups: {}, edges: [] },
  };
  for (const [id, l] of local) if (show.has(id)) out[l.coll]![id] = l.entry;
  for (const it of items.values()) {
    if (it.coll || !show.has(it.id) || !it.el) continue;
    const coll: Coll = asGroup(it.id) ? 'groups' : 'nodes';
    const parent = it.parent && show.has(it.parent) && asGroup(it.parent) ? it.parent : undefined;
    out[coll]![it.id] = fromElement(it.el, parent ? { in: parent } : {}, coll, cfg, ctx, it.el.at);
    out.origin[coll][it.id] = it.el.at;
  }

  // An end inside an open group that is not shown was left out on purpose: so is the line.
  const lift = (id: string) => {
    for (const a of ancestry(id)) if (show.has(a)) return a === id || !asGroup(a) ? a : undefined;
    return undefined;
  };
  const pairs = new Set<string>();
  for (const [i, item] of (src.edges ?? []).entries()) {
    const ends = edgeEnds[i];
    if (ends?.from && ends.to) {
      const r = { from: ends.from, to: ends.to };
      if (hidden(r)) continue;
      const from = lift(r.from);
      const to = lift(r.to);
      if (!from || !to || from === to) continue;
      pairs.add(`${from}\0${to}`);
      out.edges!.push(from === r.from && to === r.to && !claimedEnd(item) ? item : retarget(item, from, to));
    } else out.edges!.push(item);
    out.origin.edges.push({ path: ['edges', i], id: `e${i}` });
  }
  const drawn = new Map<string, { labels: string[]; style?: string; at: Path; index: number }>();
  for (const r of relations) {
    if (r.model == null || hidden(r)) continue;
    const rel = m.relations[r.model]!;
    const from = lift(r.from);
    const to = lift(r.to);
    if (!from || !to || from === to || pairs.has(`${from}\0${to}`)) continue;
    const key = `${from}\0${to}`;
    const d = drawn.get(key) ?? { labels: [], style: rel.style, at: rel.at, index: rel.index };
    if (rel.label && !d.labels.includes(rel.label)) d.labels.push(rel.label);
    drawn.set(key, d);
  }
  for (const [key, d] of drawn) {
    const [from, to] = key.split('\0') as [string, string];
    const style = d.style && cfg.edgeStyles?.[d.style] ? { style: d.style } : {};
    out.edges!.push({ from, to, ...(d.labels.length ? { label: d.labels.join(', ') } : {}), ...style });
    out.origin.edges.push({ path: d.at, id: `r${d.index}` });
  }
  return out;

  // An edge written with an element path ("shop.api") whose element is drawn under a local id.
  function claimedEnd(item: unknown): boolean {
    const spec = parseEdge(item, []);
    if (typeof spec === 'string') return false;
    return [spec.from, spec.to].some((e) => !!e.row && claimed.has(`${e.node}.${e.row}`));
  }
}

/** A model element as a node or group entry; `local` fields win. */
function fromElement(el: ModelElement, local: Entry, coll: Coll, cfg: GraphTypeConfig, ctx: BuildContext, at: Path): Entry {
  const kind = local.kind ?? mapKind(el.kind, coll, cfg, (msg) => ctx.warn(at, msg));
  const links = local.links ?? el.links;
  const description = local.description ?? el.description;
  const caption = local.caption ?? local.technology ?? el.technology;
  return {
    ...(kind ? { kind } : {}),
    label: local.label ?? el.label ?? el.name,
    ...(caption ? { caption } : {}),
    ...(local.in ? { in: local.in } : {}),
    // Without a kind of this type the element is a neutral card, still recognisable as a thing.
    ...((local.icon ?? el.icon ?? (kind ? undefined : 'box')) ? { icon: local.icon ?? el.icon ?? (kind ? undefined : 'box') } : {}),
    ...((local.tone ?? el.tone) ? { tone: local.tone ?? el.tone } : {}),
    ...(local.badges ? { badges: local.badges } : {}),
    ...(links ? { links } : {}),
    ...(description ? { description } : {}),
  };
}

/** A model kind in this type's terms: its own kind, a group kind on a card (or the other way), an alias, or none. */
function mapKind(kind: string | undefined, coll: Coll, cfg: GraphTypeConfig, warn: (m: string) => void): string | undefined {
  if (!kind) return undefined;
  const tables: KindTable[] = [cfg.nodeKinds, cfg.groupKinds];
  if (tables.some((t) => t[kind])) return kind;
  const alias = cfg.kindAliases?.[kind];
  if (alias) return alias;
  warn(`Kind "${kind}" from the model has no match in this diagram type: drawn as a plain card${coll === 'groups' ? ' boundary' : ''}. Set kind: here`);
  return undefined;
}

/** An edge item pointed at other ends, written the way it was (string, "a -> b": value, or from/to). */
function retarget(item: unknown, from: string, to: string): unknown {
  const ARROW = /^\s*[A-Za-z0-9_.-]+\s*(<->|-->|\.\.>|->|--)\s*[A-Za-z0-9_.-]+\s*$/;
  if (typeof item === 'string') return item.replace(ARROW, (_, op: string) => `${from} ${op} ${to}`);
  if (item && typeof item === 'object') {
    const o = item as Record<string, unknown>;
    if (typeof o.from === 'string') return { ...o, from, to };
    const [k] = Object.keys(o);
    if (k) return { [k.replace(ARROW, (_, op: string) => `${from} ${op} ${to}`)]: o[k] };
  }
  return item;
}

// ---------------------------------------------------------------- other types

/** A view on a built graph, by id only: for types that do not resolve the model themselves. */
export function filterGraph(graph: Graph, view: ViewSpec, warn: (path: Path, message: string) => void): Graph {
  const parent = new Map<string, string | undefined>([...graph.groups.map((g) => [g.id, g.parent] as const), ...graph.nodes.map((n) => [n.id, n.parent] as const)]);
  const ids = [...parent.keys()];
  const match = (sel: string, id: string) => sel === '*' || sel === id || (sel.endsWith('.*') && parent.get(id) === sel.slice(0, -2));
  const show = new Set<string>();
  for (const [j, sel] of (view.include ?? ['*']).entries()) {
    if (sel.startsWith('tag:') || sel.startsWith('kind:')) warn([...view.at, 'include', j], `${sel.split(':')[0]}: works on node-and-edge diagrams; use ids here`);
    else if (isRelation(sel)) {
      const [a, b] = sides(sel);
      for (const e of graph.edges) if (match(a, e.from.node) && match(b, e.to.node)) (show.add(e.from.node), show.add(e.to.node));
    } else for (const id of ids) if (match(sel, id)) show.add(id);
  }
  for (const sel of view.exclude ?? []) if (!isRelation(sel)) for (const id of ids) if (match(sel, id)) show.delete(id);
  for (const id of [...show]) for (let p = parent.get(id); p && !show.has(p); p = parent.get(p)) show.add(p);
  const cut = (view.exclude ?? []).filter(isRelation).map(sides);
  return {
    ...graph,
    title: view.title ?? graph.title,
    subtitle: view.subtitle ?? (view.title ? undefined : graph.subtitle),
    ...(view.direction ? { direction: view.direction } : {}),
    groups: graph.groups.filter((g) => show.has(g.id)),
    nodes: graph.nodes.filter((n) => show.has(n.id)),
    edges: graph.edges.filter((e) => show.has(e.from.node) && show.has(e.to.node) && !cut.some(([a, b]) => match(a, e.from.node) && match(b, e.to.node))),
  };
}

// ---------------------------------------------------------------- pins per view

const KEYS = ['nodes', 'groups', 'edges', 'locked'] as const;
const filled = (r?: object) => !!r && Object.keys(r).length > 0;
/** Only the parts of a view's tweaks that hold something. */
const own = (v: ViewPins | undefined): ViewPins => Object.fromEntries(KEYS.filter((k) => filled(v?.[k])).map((k) => [k, v![k]]));

/** The pins of one view (the top level of the sidecar without a view). */
export function viewPins(sidecar: LayoutSidecar | undefined, view?: string): LayoutSidecar | undefined {
  if (!sidecar || !view) return sidecar;
  const v = own(sidecar.views?.[view]);
  return Object.keys(v).length ? { version: 1, ...v } : undefined;
}

/** The sidecar with one view's pins replaced (removed with null or undefined); undefined when nothing is pinned anywhere. */
export function withViewPins(sidecar: LayoutSidecar | undefined, view: string | undefined, pins: LayoutSidecar | null | undefined): LayoutSidecar | undefined {
  const mine = own(pins ?? undefined);
  const views = { ...(view ? (sidecar?.views ?? {}) : (pins?.views ?? sidecar?.views ?? {})) };
  const top = view ? own(sidecar) : mine;
  if (view) {
    if (Object.keys(mine).length) views[view] = mine;
    else delete views[view];
  }
  const out: LayoutSidecar = { version: 1, ...top, ...(Object.keys(views).length ? { views } : {}) };
  return Object.keys(out).length > 1 ? out : undefined;
}
