// C4 view kinds. A view with `kind:` picks its own elements from the model, the way Structurizr and
// LikeC4 do, and the result goes through the same include/expand/exclude rules as any other view:
//
//   views:
//     landscape: { kind: landscape, enterprise: Kestrel Bank }
//     context: { kind: context, of: online }            # online + whatever talks to it, directly
//     containers: { kind: container, of: online }       # online opened up + its outside neighbours
//     api: { kind: component, of: online.api }          # one container opened up, inside its system
//     signin: { kind: dynamic, steps: ['customer -> online.web: Opens the app', …] }
//     prod: { kind: deployment, nodes: { aws: { technology: eu-west-1, nodes: { … instances: [online.api] } } } }
//
// In a deployment view a node can also be the instance itself: `rds: { technology: RDS, of: online.db }`.
//
// Views of a lower level link to the next one down for drill-down (context → containers → components).
import { parseEdge } from './edges.ts';
import { withTechnology, type ModelContext, type ViewKind, type ViewSpec } from './catalogue.ts';
import type { BuildContext } from './diagram-type.ts';
import type { Path } from './model.ts';
import type { Entry, GraphSource, GraphTypeConfig } from './graph-source.ts';
import { checkComplete, fromElement, instanceOf, resolveSource, type Origins } from './views.ts';

type Out = GraphSource & { origin: Origins };

/** How deep a view looks; drill-down links go from a view to one of the same level or deeper. */
const LEVEL: Record<ViewKind, number> = { landscape: 0, context: 1, container: 2, component: 3, dynamic: 0, deployment: 0 };

const within = (id: string, scope: string) => id === scope || id.startsWith(scope + '.');
const ancestors = (id: string) => id.split('.').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('.'));

/**
 * The element that stands for `id` next to `scope`: the child of their deepest common ancestor that
 * holds `id` (a sibling container for a component view), or its top-level element.
 */
function beside(id: string, scope: string): string {
  const a = id.split('.');
  const b = scope.split('.');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i + 1).join('.');
}

/** The diagram as the type should build it for a view with or without a C4 kind. */
export function viewSource(src: GraphSource, cfg: GraphTypeConfig, m: ModelContext, ctx: BuildContext): Out {
  const v = m.view;
  if (!v?.kind) return resolveSource(src, cfg, m, ctx);
  if (v.kind === 'deployment') return deploymentSource(src, cfg, m, ctx);
  const els = m.elements;
  const scoped = v.kind === 'context' || v.kind === 'container' || v.kind === 'component';
  if (v.of != null && !els.has(v.of)) ctx.warn([...v.at, 'of'], `There is no element "${v.of}" in the model`);
  if (scoped && !(v.of && els.has(v.of))) {
    if (v.of == null) ctx.warn(v.at, `A ${v.kind} view needs of: the element it is about`);
    return resolveSource(src, cfg, { ...m, view: { ...v, kind: undefined } }, ctx);
  }
  const of = v.of!;
  const children = (id: string) => [...els.values()].filter((e) => e.parent === id).map((e) => e.id);
  if (v.kind === 'container' && !children(of).length) ctx.warn([...v.at, 'of'], `"${of}" has no parts to show: add elements: under it`);
  if (v.kind === 'component' && !children(of).length) ctx.warn([...v.at, 'of'], `"${of}" has no components to show: add elements: under it`);

  // What the kind picks, on top of what the view says itself.
  const include: string[] = [];
  const expand: string[] = [];
  const exclude: string[] = [];
  let model = m;
  let base = src;
  if (v.kind === 'landscape') include.push('*');
  else if (scoped) {
    const near = new Set<string>();
    for (const r of m.relations)
      for (const [a, b] of [[r.from, r.to], [r.to, r.from]] as const) if (within(a, of) && !within(b, of) && els.has(b)) near.add(beside(b, of));
    include.push(of, ...near);
    if (v.kind === 'container') expand.push(of);
    if (v.kind === 'component') {
      // The container inside its system (and further up), with only the siblings that take part.
      const path = [...ancestors(of), of];
      expand.push(...path);
      for (const p of path.slice(0, -1)) for (const c of children(p)) if (!path.includes(c) && !near.has(c)) exclude.push(c);
    }
  } else {
    // Dynamic: the elements the steps name, inside the boundaries of what they belong to.
    for (const s of v.steps ?? []) for (const id of [s.from, s.to]) if (!include.includes(id)) include.push(id);
    for (const id of include) for (const a of ancestors(id)) if (els.has(a) && !include.includes(a) && !expand.includes(a)) expand.push(a);
    // An opened boundary shows only the parts that take part in the story.
    for (const a of expand) for (const c of children(a)) if (!include.includes(c) && !expand.includes(c)) exclude.push(c);
    // Only the steps are drawn, not the relations of the model.
    model = { ...m, relations: [] };
    base = { ...src, edges: [] };
  }
  const view: ViewSpec = {
    ...v,
    include: [...include, ...(v.include ?? [])],
    expand: [...expand, ...(v.expand ?? [])],
    exclude: [...exclude, ...(v.exclude ?? [])],
  };
  const out = resolveSource(base, cfg, { ...model, view }, ctx);

  if (v.kind === 'dynamic')
    for (const [i, s] of (v.steps ?? []).entries()) {
      const ids = new Set([...Object.keys(out.nodes ?? {}), ...Object.keys(out.groups ?? {})]);
      const end = [s.from, s.to].find((id) => !ids.has(id));
      if (end) {
        ctx.warn(s.at, ids.size && els.has(end) ? `"${end}" is not drawn in this view` : `There is no element "${end}" in the model`);
        continue;
      }
      out.edges!.push({ from: s.from, to: s.to, ...(s.label || s.technology ? { label: withTechnology(s.label, s.technology) } : {}), step: i + 1 });
      out.origin.edges.push({ path: s.at, id: `s${i + 1}` });
    }

  if (v.enterprise && (v.kind === 'landscape' || v.kind === 'context')) {
    const id = out.groups!.enterprise || out.nodes!.enterprise ? '_enterprise' : 'enterprise';
    for (const coll of ['groups', 'nodes'] as const)
      for (const e of Object.values(out[coll]!)) if (e && typeof e === 'object' && !e.in && !e.tags?.includes('external')) e.in = id;
    out.groups = { [id]: { kind: cfg.groupKinds.enterprise ? 'enterprise' : 'boundary', label: v.enterprise }, ...out.groups };
    out.origin.groups[id] = [...v.at, 'enterprise'];
  }

  // Drill-down: a card links to the next view about it (context → containers → components).
  const level = LEVEL[v.kind];
  const views = [...m.views.values()].filter((w) => w.kind && w.of && w.name !== v.name && LEVEL[w.kind] >= Math.max(1, level) && w.kind !== 'dynamic');
  for (const [id, e] of Object.entries(out.nodes ?? {})) {
    if (!e || typeof e !== 'object' || !els.has(id)) continue;
    const next = views.filter((w) => w.of === id).sort((a, b) => LEVEL[a.kind!] - LEVEL[b.kind!])[0];
    if (next && !e.links?.includes(`#${next.name}`)) e.links = [`#${next.name}`, ...(e.links ?? [])];
  }
  return out;
}

/**
 * A deployment view: nested deployment nodes as groups (a node without instances or children is an
 * infrastructure card, e.g. a load balancer), model elements as instances inside them, and the model's
 * relations between the instances.
 */
function deploymentSource(src: GraphSource, cfg: GraphTypeConfig, m: ModelContext, ctx: BuildContext): Out {
  const v = m.view!;
  const els = m.elements;
  const out: Out = {
    title: v.title ?? src.title,
    subtitle: v.subtitle ?? (v.title ? undefined : src.subtitle),
    direction: v.direction ?? src.direction,
    groups: {},
    nodes: {},
    edges: [],
    origin: { nodes: {}, groups: {}, edges: [] },
  };
  const known = (k: string) => !!cfg.groupKinds[k] || !!cfg.nodeKinds[k];
  // Element id → where it runs, in order; `root` is the outermost deployment node (an environment, a region).
  const placed = new Map<string, { node: string; root: string; at: Path }[]>();
  // Element id → the deployment nodes that are an instance of it themselves (`of:`).
  const direct = new Map<string, { id: string; root: string }[]>();
  const roots = new Map<string, string>();
  // Deployment node → the node it sits in, and the element it is an instance of (`of:`).
  const nodeParent = new Map<string, string | undefined>();
  const nodeOf = new Map<string, string>();
  const walk = (map: unknown, parent: string | undefined, base: Path) => {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return;
    for (const [key, raw] of Object.entries(map as Record<string, unknown>)) {
      const path = [...base, key];
      const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      if (roots.has(key)) {
        ctx.error(path, `Deployment node "${key}" is already in this view`);
        continue;
      }
      roots.set(key, parent ? roots.get(parent)! : key);
      nodeParent.set(key, parent);
      const list = typeof o.instances === 'string' ? [o.instances] : Array.isArray(o.instances) ? o.instances.map(String) : [];
      const leaf = !list.length && !(o.nodes && typeof o.nodes === 'object' && Object.keys(o.nodes).length);
      let kind = typeof o.kind === 'string' ? o.kind : leaf ? 'infrastructure' : 'deployment-node';
      if (!known(kind)) {
        if (typeof o.kind === 'string') ctx.warn([...path, 'kind'], `Kind "${kind}" has no match in this diagram type: drawn as a plain ${leaf ? 'card' : 'node'}`);
        kind = leaf ? (known('server') ? 'server' : '') : known('deployment-node') ? 'deployment-node' : known('boundary') ? 'boundary' : '';
      }
      const count = typeof o.count === 'number' && o.count > 1 ? `×${o.count}` : undefined;
      const technology = typeof o.technology === 'string' ? o.technology : undefined;
      const caption = [technology, count].filter(Boolean).join(' · ');
      const rest: Entry = {
        ...(technology ? { technology } : {}),
        ...(count ? { count: o.count as number } : {}),
        ...(parent ? { in: parent } : {}),
        ...(typeof o.icon === 'string' ? { icon: o.icon } : {}),
        ...(typeof o.tone === 'string' ? { tone: o.tone as Entry['tone'] } : {}),
        ...(typeof o.description === 'string' ? { description: o.description } : {}),
        ...(Array.isArray(o.tags) ? { tags: o.tags.map(String) } : {}),
        ...(Array.isArray(o.links) ? { links: o.links } : {}),
      };
      const el = typeof o.of === 'string' ? els.get(o.of) : undefined;
      if (typeof o.of === 'string' && !el) ctx.warn([...path, 'of'], els.size ? `There is no element "${o.of}" in the model` : `"${o.of}" needs a model: add include: [model.yaml] or elements:`);
      if (el) nodeOf.set(key, el.id);
      if (el) direct.set(el.id, [...(direct.get(el.id) ?? []), { id: key, root: roots.get(key)! }]);
      const coll = leaf ? 'nodes' : 'groups';
      const name = el?.label ?? el?.name;
      // The element's name when the node has its own, what it is built with (or runs on), how many.
      const running = [typeof o.label === 'string' && o.label !== name ? name : undefined, technology ?? el?.technology, count].filter(Boolean).join(' · ');
      out[coll]![key] = el
        ? // The node is the instance itself: the element's name, and its kind unless the node says its own.
          instanceOf(el, { ...(typeof o.kind === 'string' || !leaf ? (kind ? { kind } : { icon: 'server' }) : {}), ...(typeof o.label === 'string' ? { label: o.label } : {}), ...(running ? { caption: running } : {}), ...rest }, coll, cfg, ctx, path)
        : { ...(kind ? { kind } : { icon: 'server' }), label: typeof o.label === 'string' ? o.label : key, ...(caption ? { caption } : {}), ...rest };
      out.origin[coll][key] = path;
      for (const [j, id] of list.entries()) {
        if (!els.has(id)) ctx.warn([...path, 'instances', j], els.size ? `There is no element "${id}" in the model` : `"${id}" needs a model: add include: [model.yaml] or elements:`);
        else placed.set(id, [...(placed.get(id) ?? []), { node: key, root: roots.get(key)!, at: [...path, 'instances', j] }]);
      }
      walk(o.nodes, key, [...path, 'nodes']);
    }
  };
  walk(v.nodes, undefined, [...v.at, 'nodes']);
  if (!v.nodes) ctx.warn(v.at, 'A deployment view needs nodes: the deployment nodes and what runs in them');

  // Instance ids: the element's own id, or id@node when it runs in more than one place.
  const instances = new Map<string, { id: string; root: string }[]>();
  // Instance id → its element and the node it runs in.
  const where = new Map<string, { el: string; node: string }>();
  for (const [elId, list] of placed) {
    const el = els.get(elId)!;
    instances.set(
      elId,
      list.map((p) => {
        const id = list.length > 1 ? `${elId}@${p.node}` : elId;
        out.nodes![id] = fromElement(el, { in: p.node }, 'nodes', cfg, ctx, el.at);
        out.origin.nodes[id] = p.at;
        where.set(id, { el: elId, node: p.node });
        return { id, root: p.root };
      }),
    );
  }
  for (const [elId, list] of direct) instances.set(elId, [...(instances.get(elId) ?? []), ...list]);
  checkComplete(v, els, (id) => instances.has(id), 'add it to instances: or a node with of:', ctx);

  // exclude:, as in other views: an element, a deployment node, tag: or kind: takes it out with what
  // runs in it; a rule with an arrow takes out the lines between them, the model's and the ones written.
  // A side matches an instance by its element (and that element's parents) or by the nodes it runs in.
  type Part = { id: string; parent?: string; kind?: string; tags: string[] };
  const elementParts = (id: string): Part[] => {
    const parts: Part[] = [];
    for (let e = els.get(id); e; e = e.parent ? els.get(e.parent) : undefined) parts.push(e);
    return parts;
  };
  const nodeParts = (key: string | undefined): Part[] => {
    const parts: Part[] = [];
    for (let k = key; k; k = nodeParent.get(k)) {
      const e = out.groups![k] ?? out.nodes![k];
      parts.push({ id: k, parent: nodeParent.get(k), kind: typeof e === 'object' ? e?.kind : undefined, tags: (typeof e === 'object' && e?.tags) || [] });
      if (nodeOf.has(k)) parts.push(...elementParts(nodeOf.get(k)!));
    }
    return parts;
  };
  const parts = (id: string): Part[] => {
    const w = where.get(id);
    if (w) return [...elementParts(w.el), ...nodeParts(w.node)];
    return roots.has(id) ? nodeParts(id) : elementParts(id);
  };
  const hit = (sel: string, p: Part) =>
    sel === '*' ||
    (sel.startsWith('tag:') ? p.tags.includes(sel.slice(4)) : sel.startsWith('kind:') ? p.kind === sel.slice(5) : sel.endsWith('.*') ? p.parent === sel.slice(0, -2) : p.id === sel);
  const deep = (sel: string, id: string) => parts(id).some((p) => hit(sel, p));
  const rules = v.exclude ?? [];
  const gone = (id: string) => rules.some((sel) => !sel.includes('->') && deep(sel, id));
  const cut = (from: string, to: string) =>
    rules.some((sel) => {
      if (!sel.includes('->')) return false;
      const [a, b] = sel.split('->').map((x) => x.trim()) as [string, string];
      return deep(a, from) && deep(b, to);
    });
  if (rules.some((sel) => !sel.includes('->'))) {
    for (const coll of ['groups', 'nodes'] as const)
      for (const id of Object.keys(out[coll]!))
        if (gone(id)) {
          delete out[coll]![id];
          delete out.origin[coll][id];
        }
    for (const [elId, list] of instances) {
      const left = list.filter((x) => !gone(x.id));
      if (left.length) instances.set(elId, left);
      else instances.delete(elId);
    }
  }
  // A relation of a component is drawn from the container it is deployed in.
  const running = (id: string) => {
    for (let cur: string | undefined = id; cur; cur = els.get(cur)?.parent) if (instances.has(cur)) return { el: cur, list: instances.get(cur)! };
    return undefined;
  };
  const drawn = new Map<string, { labels: string[]; style?: string; at: Path; id: string; exact?: boolean; written?: boolean }>();
  const pair = (from: { id: string; root: string }[], to: { id: string; root: string }[], add: (f: string, t: string) => void) => {
    // Instances in the same environment talk to each other; across environments only when there is no other.
    for (const f of from) {
      const near = to.filter((t) => t.root === f.root);
      for (const t of near.length ? near : to) if (f.id !== t.id) add(f.id, t.id);
    }
  };
  for (const r of m.relations) {
    const f = running(r.from);
    const t = running(r.to);
    if (!f || !t || f.el === t.el) continue;
    // As in other views: a relation between exactly the deployed elements wins over ones implied by their parts.
    const exact = f.el === r.from && t.el === r.to;
    pair(f.list, t.list, (a, b) => {
      if (cut(r.from, r.to) || cut(a, b)) return;
      const key = `${a}\0${b}`;
      const old = drawn.get(key);
      if (old?.exact && !exact) return;
      const d = old && (old.exact || !exact) ? old : { labels: [], style: r.style, at: r.at, id: `r${r.index}`, exact };
      const label = withTechnology(r.label, r.technology);
      if (label && !d.labels.includes(label)) d.labels.push(label);
      drawn.set(key, d);
    });
  }
  for (const [i, item] of (v.edges ?? []).entries()) {
    const at = [...v.at, 'edges', i];
    const spec = parseEdge(item, at);
    if (typeof spec === 'string') {
      ctx.error(at, spec);
      continue;
    }
    const endIds = [spec.from, spec.to].map((e) => (e.row ? `${e.node}.${e.row}` : e.node));
    // A line to what exclude: took out, or that it names, is left out with it.
    if (endIds.some(gone) || cut(endIds[0]!, endIds[1]!)) continue;
    const ends = endIds.map((id) => (roots.has(id) ? [{ id, root: roots.get(id)! }] : running(id)?.list));
    if (!ends[0] || !ends[1]) {
      ctx.warn(at, 'Connect deployment nodes or elements that run in this view');
      continue;
    }
    const style = typeof spec.props.style === 'string' ? spec.props.style : undefined;
    const label = withTechnology(spec.label, typeof spec.props.technology === 'string' ? spec.props.technology : undefined);
    const via = typeof spec.props.via === 'string' ? spec.props.via : undefined;
    // A line written here replaces the model's line between the same two (keep: the model's line
    // stays too); two written lines between the same two are one line with both labels.
    const put = (a: string, b: string, labels: string[], lineStyle: string | undefined, keep = false) => {
      if (cut(a, b)) return;
      const key = `${a}\0${b}`;
      const old = drawn.get(key);
      if (!old || (!old.written && !keep)) return void drawn.set(key, { labels: [...labels], style: lineStyle, at, id: `d${i}`, written: true });
      for (const l of labels) if (!old.labels.includes(l)) old.labels.push(l);
      old.style ??= lineStyle;
      old.written = true;
    };
    if (via && endIds.includes(via)) {
      ctx.warn([...at, 'via'], `"${via}" is an end of this line, so it is drawn straight. Name the node the line goes through, or leave via: out`);
    } else if (via && gone(via)) {
      continue;
    } else if (via) {
      // The relation goes through a node of this view (a load balancer): from → via, with the
      // relation's label unless one is written, and via → to, unless a line there is written too.
      // A line already there, the model's or one written, stays and gets this label as well.
      const hop = roots.has(via) ? [{ id: via, root: roots.get(via)! }] : running(via)?.list;
      if (!hop) {
        ctx.warn([...at, 'via'], `"${via}" is not a deployment node or an element that runs in this view`);
        continue;
      }
      const direct = new Map<string, { labels: string[]; style?: string }>();
      pair(ends[0], ends[1], (a, b) => {
        const d = drawn.get(`${a}\0${b}`);
        if (d && !direct.has(a)) direct.set(a, d);
        drawn.delete(`${a}\0${b}`);
      });
      const first = [...direct.values()][0];
      pair(ends[0], hop, (a, b) => put(a, b, label ? [label] : (direct.get(a)?.labels ?? []), style ?? direct.get(a)?.style, true));
      pair(hop, ends[1], (a, b) => void (drawn.has(`${a}\0${b}`) || put(a, b, [], style ?? first?.style)));
      continue;
    }
    // Written here, so it wins over the model's relation between the same two.
    pair(ends[0], ends[1], (a, b) => put(a, b, label ? [label] : [], style));
  }
  const ids = new Set<string>();
  for (const [key, d] of drawn) {
    const [from, to] = key.split('\0') as [string, string];
    out.edges!.push({ from, to, ...(d.labels.length ? { label: d.labels.join(', ') } : {}), ...(d.style && cfg.edgeStyles?.[d.style] ? { style: d.style } : {}) });
    // One relation between instances in two places is two lines.
    let id = d.id;
    for (let n = 2; ids.has(id); n++) id = `${d.id}-${n}`;
    ids.add(id);
    out.origin.edges.push({ path: d.at, id });
  }
  return out;
}
