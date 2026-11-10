// Stages: where an architecture is today, the stages it goes through and where it ends, in one file.
// The drawing as written holds everything that is there at any stage; each stage says what it changes
// relative to the one before it. The first stage is the as-is, the last the to-be.
//
//   stages:
//     - { id: as-is, title: As-is, when: 2026-Q1, description: Everything runs on VMware. }
//     - id: q2
//       title: Landing zone
//       when: 2026-Q2
//       add: [hub, firewall, 'dc -> hub']            # there from this stage on (ids, tag:x, kind:x, a -> b)
//       remove: [backup-tapes]                        # gone from this stage on
//       change: { web: { kind: app-service } }        # properties from this stage on; in: moves it
//       replace: { vm-web: web-app }                  # vm-web goes, web-app comes, drawn as "replaces"
//     - { id: to-be, title: To-be, when: 2026-Q4, remove: [dc] }
//
// An element may say it instead: `from: q2` (added in q2) and `until: q4` (gone from q4 on).
//
// Positions never change between stages: the layout is made once, for everything that is there at
// any stage, and a stage only leaves out what is not there yet or any more. A move between groups
// (change: { x: { in: other } }) is the one exception that needs a place of its own: the element is
// laid out twice, once in each group, and each stage draws the one that is true then.
import type { Graph, GraphEdge, GraphGroup, GraphNode, Path, Placed } from './model.ts';
import { selectorsOf } from './steps.ts';

type Report = (path: Path, message: string, severity?: 'error' | 'warning') => void;

export interface StageSpec {
  id: string;
  title: string;
  /** A date or a quarter as written: 2026-Q2, 2026-06, 2026-06-30. */
  when?: string;
  description?: string;
  add: Sel[];
  remove: Sel[];
  change: { id: string; props: Record<string, unknown>; at: Path }[];
  replace: { from: string; to: string; at: Path }[];
  at: Path;
}

interface Sel {
  v: string;
  at: Path;
}

/** One stage as a result lists it: what it is called and how much it changes. */
export interface StageInfo {
  id: string;
  title: string;
  when?: string;
  description?: string;
  /** Short name for a mark on a card and the timeline: the title when short, else the id. */
  short: string;
  /** What this stage adds, removes and changes against the one before (nodes and groups; lines that only follow their ends are not counted). */
  added: number;
  removed: number;
  changed: number;
  /** Pairs this stage replaces: the old element's id and the new one's. */
  replaced: { from: string; to: string }[];
}

export interface Presence {
  nodes: Set<string>;
  groups: Set<string>;
  edges: Set<string>;
}

/** Stages resolved against the drawing of everything (see planStages). */
export interface StagePlan {
  stages: StageInfo[];
  /** What is drawn at each stage, by union graph id. */
  present: Presence[];
  /** Properties changed so far at each stage, by the element's own id (a moved copy shares its original's). */
  changes: Map<string, Record<string, unknown>>[];
  /** What each stage changes, by the element's own id. */
  changed: Set<string>[];
  /** Union id of a copy laid out for a move → the element's own id. */
  copies: Map<string, string>;
  /** Per union id: the stage it first appears in (0: the as-is) and the first stage it is gone in. */
  span: Map<string, { from: number; until?: number }>;
}

const MOVE = '~';
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : undefined);

/** `stages:` as written: a list of stages, each { id, title, when, description, add, remove, change, replace }. */
export function readStages(raw: unknown, report: Report): StageSpec[] {
  if (!Array.isArray(raw)) return [];
  const out: StageSpec[] = [];
  const seen = new Set<string>();
  for (const [i, item] of raw.entries()) {
    const at: Path = ['stages', i];
    const o = (item && typeof item === 'object' && !Array.isArray(item) ? item : {}) as Record<string, unknown>;
    const id = str(o.id) ?? (typeof item === 'string' ? item : `stage-${i + 1}`);
    if (seen.has(id)) report([...at, 'id'], `There are two stages called "${id}": give each its own id`);
    seen.add(id);
    const sels = (key: string): Sel[] => (Array.isArray(o[key]) ? (o[key] as unknown[]).map((v, j) => ({ v: String(v), at: [...at, key, j] })) : o[key] == null ? [] : [{ v: String(o[key]), at: [...at, key] }]);
    const map = (key: string) => (o[key] && typeof o[key] === 'object' && !Array.isArray(o[key]) ? Object.entries(o[key] as Record<string, unknown>) : []);
    const stage: StageSpec = {
      id,
      title: str(o.title) ?? (typeof item === 'string' ? item : id),
      ...(str(o.when) ? { when: str(o.when) } : {}),
      ...(str(o.description) ? { description: str(o.description) } : {}),
      add: sels('add'),
      remove: sels('remove'),
      change: map('change').map(([k, v]) => ({ id: k.includes('->') ? k.split('->').map((x) => x.trim()).join(' -> ') : k, props: v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : typeof v === 'string' ? { kind: v } : {}, at: [...at, 'change', k] })),
      replace: map('replace').map(([k, v]) => ({ from: k, to: String(v), at: [...at, 'replace', k] })),
      at,
    };
    if (i === 0 && (stage.add.length || stage.remove.length || stage.change.length || stage.replace.length))
      report(at, `The first stage is the as-is: it is the drawing as written, without changes. Put what changes in a later stage`, 'warning');
    out.push(stage);
  }
  if (out.length === 1) report(['stages'], 'One stage is only the as-is: add the stages it goes through and the to-be', 'warning');
  return out;
}

/** A time mark taken off an element: where it was written and what it said. */
export interface TimeMark {
  path: Path;
  from?: string;
  until?: string;
}

/**
 * The diagram's data without the elements' `from:` and `until:` (which no type knows), and where
 * they were. Every collection is looked at: maps of entries (nodes, groups) and lists of lines.
 */
export function takeTimeMarks(data: Record<string, unknown>): { data: Record<string, unknown>; marks: TimeMark[] } {
  const marks: TimeMark[] = [];
  const take = (v: unknown, path: Path): unknown => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
    const o = v as Record<string, unknown>;
    if (!('from' in o) && !('until' in o)) return v;
    const { from, until, ...rest } = o;
    marks.push({ path, ...(str(from) ? { from: str(from) } : {}), ...(str(until) ? { until: str(until) } : {}) });
    return rest;
  };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === 'stages' || k === 'steps' || k === 'views' || k === 'layers' || k === 'review') out[k] = v;
    else if (Array.isArray(v))
      out[k] = v.map((item, i) => {
        // A line with its properties: { "a -> b": { label, from } }.
        if (item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length === 1) {
          const [key, value] = Object.entries(item as Record<string, unknown>)[0]!;
          const rest = take(value, [k, i]);
          return rest === value ? item : Object.keys(rest as object).length ? { [key]: rest } : key;
        }
        return item;
      });
    else if (v && typeof v === 'object') out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([id, e]) => [id, take(e, [k, id])]));
    else out[k] = v;
  }
  return { data: out, marks };
}

const samePath = (a: Path, b: Path) => a.length >= 2 && b.length >= 2 && a[0] === b[0] && String(a[1]) === String(b[1]);

/** The short name of a stage, for a mark on a card: its title when short, else its id. */
const shortName = (s: StageSpec) => {
  if (s.title.length <= 8) return s.title;
  const q = /\b(Q[1-4]|H[12])\b/i.exec(s.when ?? '');
  if (q) return q[1]!.toUpperCase();
  return s.id.length <= 10 ? s.id : s.title.slice(0, 9) + '…';
};

/**
 * The stages against the drawing of everything: what each one draws, what it changed, and the graph
 * with a copy of each element that moves between groups (laid out in its new group). Problems are
 * reported where they are written: a name that is not drawn, something removed before it is added,
 * added twice, or changed when it is not there.
 */
export function planStages(graph: Graph, specs: StageSpec[], marks: TimeMark[], report: Report): { graph: Graph; plan: StagePlan } {
  const sel = selectorsOf(graph);
  const index = new Map(specs.map((s, i) => [s.id, i]));
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const groups = new Map(graph.groups.map((g) => [g.id, g]));
  const edges = new Map(graph.edges.map((e) => [e.id, e]));
  const title = (k: number) => specs[k]!.title;
  const name = (id: string) => {
    const n = nodes.get(id);
    const s = n?.shape as { label?: string; title?: string } | undefined;
    return s?.label || s?.title || groups.get(id)?.label || (edges.has(id) ? `${edges.get(id)!.from.node} -> ${edges.get(id)!.to.node}` : id);
  };

  // Where each element comes and goes: from add / from: / replace, and remove / until: / replace.
  const adds = new Map<string, { k: number; at: Path; soft?: boolean }[]>();
  const removes = new Map<string, { k: number; at: Path }[]>();
  const push = (m: typeof adds, id: string, k: number, at: Path, soft?: boolean) => m.set(id, [...(m.get(id) ?? []), { k, at, ...(soft ? { soft } : {}) }]);
  /** What a selector names: an id is the element itself (a group without what is inside), a route its lines. */
  const pick = (s: Sel): string[] => {
    const v = s.v.trim();
    if (v.includes('->')) return sel.pick(v, false, (message, severity) => report(s.at, message, severity)).edges;
    if (nodes.has(v) || groups.has(v)) return [v];
    const rule = /^(tag|kind):(.+)$/.exec(v);
    if (rule) {
      const hit = (x: { tags?: string[]; kind?: string }) => (rule[1] === 'tag' ? !!x.tags?.includes(rule[2]!) : x.kind === rule[2]);
      const ids = [...graph.groups.filter(hit).map((g) => g.id), ...graph.nodes.filter(hit).map((n) => n.id), ...graph.edges.filter((e) => rule[1] === 'tag' && hit(e)).map((e) => e.id)];
      if (!ids.length) report(s.at, `Nothing drawn here is ${rule[1] === 'tag' ? 'tagged' : 'of kind'} "${rule[2]}"`);
      return ids;
    }
    report(s.at, `Nothing drawn here is called "${v}"`);
    return [];
  };
  const known = (id: string, at: Path) => {
    if (nodes.has(id) || groups.has(id)) return true;
    report(at, `Nothing drawn here is called "${id}"`);
    return false;
  };
  for (const [k, s] of specs.entries()) {
    if (!k) continue;
    for (const a of s.add) for (const id of pick(a)) push(adds, id, k, a.at);
    for (const r of s.remove) for (const id of pick(r)) push(removes, id, k, r.at);
    for (const r of s.replace) {
      if (known(r.from, r.at)) push(removes, r.from, k, r.at);
      // What replaces may be there already (two old things folded into one new one).
      if (known(r.to, r.at)) push(adds, r.to, k, r.at, true);
    }
  }
  for (const m of marks) {
    const el = [...graph.nodes, ...graph.groups, ...graph.edges].find((x) => samePath(x.path, m.path));
    if (!el) continue;
    for (const [key, when] of [['from', m.from], ['until', m.until]] as const) {
      if (when == null) continue;
      const k = index.get(when);
      if (k == null) report([...m.path, key], `There is no stage "${when}"; stages: ${specs.map((s) => s.id).join(', ')}`);
      else if (key === 'from' && k > 0) push(adds, el.id, k, [...m.path, key]);
      else if (key === 'until') {
        if (k === 0) report([...m.path, key], `until: ${when} is the first stage: then it is never there. until names the stage it is gone in`);
        else push(removes, el.id, k, [...m.path, key]);
      }
    }
  }

  // Walk the stages: what is there of its own, then what its groups and ends allow.
  const own = new Set<string>([...nodes.keys(), ...groups.keys(), ...edges.keys()]);
  // What a stage adds is not there before it.
  for (const id of adds.keys()) own.delete(id);
  // A move lays a copy out in the new group; references to the element follow it from then on.
  const alias = new Map<string, string>();
  const copies = new Map<string, string>();
  const extraNodes: GraphNode[] = [];
  const extraEdges: GraphEdge[] = [];
  const parentOf = new Map<string, string | undefined>([...graph.nodes.map((n) => [n.id, n.parent] as const), ...graph.groups.map((g) => [g.id, g.parent] as const)]);
  const now = (id: string) => alias.get(id) ?? id;
  const lastSeen = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  const present: Presence[] = [];
  const changes: Map<string, Record<string, unknown>>[] = [];
  const counted: { added: Set<string>; removed: Set<string>; changed: Set<string> }[] = [];
  let changed = new Map<string, Record<string, unknown>>();

  for (const [k, s] of specs.entries()) {
    const c = { added: new Set<string>(), removed: new Set<string>(), changed: new Set<string>() };
    if (k > 0) {
      for (const [id, list] of adds)
        for (const a of list.filter((x) => x.k === k)) {
          const at = now(id);
          if (c.added.has(id) || (a.soft && own.has(at))) continue;
          if (own.has(at)) {
            const before = (adds.get(id) ?? []).find((x) => x.k < k);
            report(a.at, before ? `${name(id)} is already added in ${title(before.k)}` : `${name(id)} is already there in ${title(k - 1)}: only what is not there yet can be added`);
          }
          own.add(at);
          c.added.add(id);
        }
      for (const [id, list] of removes)
        for (const r of list.filter((x) => x.k === k)) {
          const at = now(id);
          if (c.added.has(id) && !r.at.includes('replace')) report(r.at, `${name(id)} is added and removed in ${title(k)}: it is never there`);
          else if (!own.has(at)) {
            const later = (adds.get(id) ?? []).find((x) => x.k > k);
            const before = list.find((x) => x.k < k);
            report(r.at, later ? `${name(id)} is removed in ${title(k)} but only added in ${title(later.k)}` : before ? `${name(id)} is already removed in ${title(before.k)}` : `${name(id)} is not there in ${title(k - 1)}: it cannot be removed`);
          }
          own.delete(at);
          c.removed.add(id);
        }
      changed = new Map([...changed].map(([id, p]) => [id, { ...p }]));
      for (const ch of s.change) {
        if (ch.id.includes('->')) {
          // A line changes its label or style; it stays where it is.
          const [line] = sel.pick(ch.id, false, (message, severity) => report(ch.at, message, severity)).edges;
          if (!line) continue;
          if (!own.has(now(line))) report(ch.at, `${ch.id} is not there in ${title(k)}: only what is there can change`);
          else {
            changed.set(ch.id, { ...changed.get(ch.id), ...ch.props });
            c.changed.add(ch.id);
          }
          continue;
        }
        if (!known(ch.id, ch.at)) continue;
        const at = now(ch.id);
        if (!own.has(at)) {
          report(ch.at, `${name(ch.id)} is not there in ${title(k)}: only what is there can change`);
          continue;
        }
        const { in: into, ...props } = ch.props;
        if (Object.keys(props).length) changed.set(ch.id, { ...changed.get(ch.id), ...props });
        c.changed.add(ch.id);
        if (into === undefined) continue;
        if (groups.has(ch.id)) {
          report([...ch.at, 'in'], 'A group keeps its place between stages: replace it with a new group instead');
          continue;
        }
        const target = into == null || into === '' ? undefined : String(into);
        if (target && !groups.has(target)) {
          report([...ch.at, 'in'], `There is no group "${target}" to move ${name(ch.id)} into`);
          continue;
        }
        if (target === parentOf.get(at)) continue;
        // The copy: the same element in its new group, with the lines of the element it stands for.
        const node = nodes.get(ch.id)!;
        const copy = `${ch.id}${MOVE}${s.id}`;
        extraNodes.push({ ...node, id: copy, ...(target ? { parent: target } : { parent: undefined }) });
        parentOf.set(copy, target);
        copies.set(copy, ch.id);
        own.delete(at);
        own.add(copy);
        // Every line of it moves along, also one that only comes later: it then comes to the copy.
        for (const e of [...graph.edges, ...extraEdges]) {
          if (e.from.node !== at && e.to.node !== at) continue;
          const base = copies.get(e.id) ?? e.id;
          if (now(base) !== e.id) continue;
          const id = `${base}${MOVE}${s.id}`;
          extraEdges.push({ ...e, id, from: e.from.node === at ? { ...e.from, node: copy } : e.from, to: e.to.node === at ? { ...e.to, node: copy } : e.to });
          copies.set(id, base);
          if (own.delete(e.id)) own.add(id);
          alias.set(base, id);
        }
        alias.set(ch.id, copy);
      }
    }
    // Something inside a group that is not there is not there either; a line needs both its ends.
    const there = (id: string): boolean => {
      for (let x: string | undefined = id, n = 0; x && n < 64; x = parentOf.get(x), n++) if (!own.has(x)) return false;
      return true;
    };
    const p: Presence = { nodes: new Set(), groups: new Set(), edges: new Set() };
    for (const id of [...nodes.keys(), ...extraNodes.map((n) => n.id)]) if (there(id)) p.nodes.add(id);
    for (const id of groups.keys()) if (there(id)) p.groups.add(id);
    for (const e of [...graph.edges, ...extraEdges]) {
      const end = (x: string) => p.nodes.has(x) || p.groups.has(x);
      if (own.has(e.id) && end(e.from.node) && end(e.to.node)) p.edges.add(e.id);
    }
    for (const id of [...p.nodes, ...p.groups, ...p.edges]) {
      if (!firstSeen.has(id)) firstSeen.set(id, k);
      lastSeen.set(id, k);
    }
    present.push(p);
    changes.push(changed);
    counted.push(c);
  }

  const span = new Map<string, { from: number; until?: number }>();
  for (const [id, from] of firstSeen) {
    const last = lastSeen.get(id)!;
    span.set(id, { from, ...(last < specs.length - 1 ? { until: last + 1 } : {}) });
  }
  // What no stage draws (removed before it was ever there) is still part of the file: say so.
  for (const id of [...nodes.keys(), ...groups.keys()]) if (!firstSeen.has(id)) report(nodes.get(id)?.path ?? groups.get(id)!.path, `${name(id)} is not there in any stage`, 'warning');

  const stages: StageInfo[] = specs.map((s, k) => {
    const c = counted[k]!;
    const isEl = (id: string) => nodes.has(id) || groups.has(id);
    return {
      id: s.id,
      title: s.title,
      ...(s.when ? { when: s.when } : {}),
      ...(s.description ? { description: s.description } : {}),
      short: shortName(s),
      added: [...c.added].filter(isEl).length,
      removed: [...c.removed].filter(isEl).length,
      changed: [...c.changed].filter((id) => !c.added.has(id)).length,
      replaced: s.replace.filter((r) => nodes.has(r.from) || groups.has(r.from)).map((r) => ({ from: r.from, to: r.to })),
    };
  });
  const union: Graph = extraNodes.length || extraEdges.length ? { ...graph, nodes: [...graph.nodes, ...extraNodes], edges: [...graph.edges, ...extraEdges] } : graph;
  return { graph: union, plan: { stages, present, changes, changed: counted.map((c) => c.changed), copies, span } };
}

/** A stage asked for by id, by number (1-based) or by its title; undefined when there is none. */
export function stageIndex(plan: StagePlan, asked: string | number): number | undefined {
  if (typeof asked === 'number' || /^\d+$/.test(String(asked))) {
    const n = Number(asked);
    return n >= 1 && n <= plan.stages.length ? n - 1 : undefined;
  }
  const a = String(asked).toLowerCase();
  const i = plan.stages.findIndex((s) => s.id.toLowerCase() === a || s.title.toLowerCase() === a);
  return i >= 0 ? i : undefined;
}

/** Copies its own fields over a union element: what a change makes different in the drawing. */
type Rebuilt = { nodes: Map<string, GraphNode>; groups: Map<string, GraphGroup>; edges: Map<string, GraphEdge> };

/**
 * The drawing of one stage: what is there then, under its own ids (a moved element's copy by its
 * own name), with what a change made different taken from `rebuilt` (the diagram built with the
 * stage's changes). The placement is the union's, so nothing moves between stages.
 */
export function stageGraph(union: Graph, placed: Placed, plan: StagePlan, k: number, rebuilt?: Rebuilt): { graph: Graph; placed: Placed } {
  const p = plan.present[k]!;
  const ownId = (id: string) => plan.copies.get(id) ?? id;
  const changed = plan.changes[k]!;
  const nodes = union.nodes
    .filter((n) => p.nodes.has(n.id))
    .map((n) => {
      const id = ownId(n.id);
      const r = changed.has(id) ? rebuilt?.nodes.get(id) : undefined;
      return { ...n, ...(r ? { shape: r.shape, kind: r.kind, tags: r.tags, description: r.description, links: r.links } : {}), id };
    });
  const groups = union.groups
    .filter((g) => p.groups.has(g.id))
    .map((g) => {
      const r = changed.has(g.id) ? rebuilt?.groups.get(g.id) : undefined;
      return r ? { ...g, label: r.label, caption: r.caption, icon: r.icon, tone: r.tone, border: r.border, kind: r.kind, tags: r.tags } : g;
    });
  const byEnds = (e: GraphEdge) => `${ownId(e.from.node)}>${ownId(e.to.node)}`;
  const rebuiltEdges = new Map([...(rebuilt?.edges.values() ?? [])].map((e) => [byEnds(e), e]));
  const edges = union.edges
    .filter((e) => p.edges.has(e.id))
    .map((e) => {
      const key = `${ownId(e.from.node)} -> ${ownId(e.to.node)}`;
      const r = changed.has(key) ? rebuiltEdges.get(byEnds(e)) : undefined;
      return { ...e, ...(r ? { label: r.label, line: r.line, tone: r.tone, pattern: r.pattern, tags: r.tags } : {}), id: ownId(e.id), from: { ...e.from, node: ownId(e.from.node) }, to: { ...e.to, node: ownId(e.to.node) } };
    });
  // Only what is drawn keeps a place (a ghost of what went may stand there); a moved element is
  // drawn where its copy for this stage was laid out, under its own id.
  const pick = <T>(m: Map<string, T>, has: Set<string>) => {
    const out = new Map<string, T>();
    for (const [id, v] of m) if (has.has(id)) out.set(ownId(id), v);
    return out;
  };
  return {
    graph: { ...union, nodes, groups, edges },
    placed: { ...placed, nodes: pick(placed.nodes, p.nodes), groups: pick(placed.groups, p.groups), edges: pick(placed.edges, p.edges), ...(placed.labels ? { labels: pick(placed.labels, p.nodes) } : {}) },
  };
}

/**
 * The migration overview: everything that is there at any stage, each element that comes or goes
 * marked with when ("+ Q2", "− Q4"), the way environment tags are drawn: outlined, in ink.
 */
export function overviewGraph(union: Graph, plan: StagePlan): Graph {
  const mark = (id: string): string[] => {
    const s = plan.span.get(id);
    if (!s) return [];
    const own = plan.copies.get(id) ?? id;
    const changedIn = plan.stages.flatMap((st, k) => (k > s.from && (s.until == null || k < s.until) && plan.changed[k]!.has(own) ? [st.short] : []));
    // Gone from here because it moves to another group then: said so, not that it goes.
    const moves = s.until != null && [...plan.copies].some(([copy, of]) => of === own && plan.span.get(copy)?.from === s.until && !plan.copies.has(id));
    return [...(s.from > 0 ? [`+ ${plan.stages[s.from]!.short}`] : []), ...changedIn.map((x) => `~ ${x}`), ...(s.until != null ? [`${moves ? 'moves' : '−'} ${plan.stages[s.until]!.short}`] : [])];
  };
  const marked = <T extends { id: string; marks?: string[] }>(x: T): T => {
    const m = mark(x.id);
    return m.length ? { ...x, marks: [...(x.marks ?? []), ...m] } : x;
  };
  const words = new Set<string>();
  for (const s of plan.stages) for (const sign of ['+', '−', '~', 'moves']) words.add(`${sign} ${s.short}`);
  // A line that comes and goes with its ends says nothing of its own: only one that does otherwise is marked.
  const spanOf = (id: string) => plan.span.get(id);
  const own = (e: GraphEdge) => {
    const [s, a, b] = [spanOf(e.id), spanOf(e.from.node), spanOf(e.to.node)];
    if (!s || !a || !b) return false;
    const until = (x: { until?: number }) => x.until ?? Infinity;
    return s.from !== Math.max(a.from, b.from) || until(s) !== Math.min(until(a), until(b));
  };
  return { ...union, nodes: union.nodes.map(marked), groups: union.groups.map(marked), edges: union.edges.map((e) => (own(e) ? marked(e) : e)), environments: [...(union.environments ?? []), ...words] };
}

/**
 * The data of the diagram with the changes of a stage written in: what the type builds to draw the
 * changed elements as they are then. `paths` finds where an element is written.
 */
export function withChanges(data: Record<string, unknown>, changes: Map<string, Record<string, unknown>>, graph: Graph): Record<string, unknown> {
  if (!changes.size) return data;
  const out = structuredClone(data);
  const where = (id: string): Path | undefined => {
    const el = graph.nodes.find((n) => n.id === id) ?? graph.groups.find((g) => g.id === id);
    if (el) return el.path;
    if (!id.includes('->')) return undefined;
    const [a, b] = id.split('->').map((s) => s.trim());
    return graph.edges.find((e) => e.from.node === a && e.to.node === b)?.path;
  };
  for (const [id, props] of changes) {
    const path = where(id);
    if (!path || path.length < 2) continue;
    const [key, at] = path as [string, string | number];
    const coll = out[key];
    if (Array.isArray(coll) && typeof at === 'number') {
      const item = coll[at];
      if (typeof item === 'string') coll[at] = { [item]: { ...props } };
      else if (item && typeof item === 'object') {
        const [k, v] = Object.entries(item as Record<string, unknown>)[0]!;
        coll[at] = { [k]: { ...(v && typeof v === 'object' ? v : {}), ...props } };
      }
    } else if (coll && typeof coll === 'object' && !Array.isArray(coll)) {
      const m = coll as Record<string, unknown>;
      const v = m[String(at)];
      m[String(at)] = { ...(typeof v === 'string' ? { kind: v } : v && typeof v === 'object' ? v : {}), ...props };
    }
  }
  return out;
}

const selectors = { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] };
/** `stages:` of a diagram: the as-is, the stages in between and the to-be, each with what it changes. */
export const stagesSchema = {
  type: 'array',
  items: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', pattern: '^[A-Za-z0-9_-]+$', description: 'Short name of the stage, for --stage and from:/until: on elements' },
      title: { type: 'string', description: 'How the stage is called on slides and the timeline: As-is, Landing zone, To-be' },
      when: { anyOf: [{ type: 'string' }, { type: 'number' }], description: 'When the stage is reached: 2026-Q2, 2026-06 or 2026-06-30' },
      description: { type: 'string', description: 'One or two sentences about this stage, under its drawing' },
      add: { ...selectors, description: 'There from this stage on: ids, a -> b, tag:x, kind:x. A group added brings what is inside it' },
      remove: { ...selectors, description: 'Gone from this stage on. A group removed takes what is inside it' },
      change: { type: 'object', additionalProperties: { type: 'object' }, description: 'Properties from this stage on, by id: { web: { kind: app-service, label: Web app } }; in: moves it to another group' },
      replace: { type: 'object', additionalProperties: { type: 'string' }, description: 'Old element → the one that replaces it: { vm-web: web-app }. Drawn as "replaces" in a transition' },
    },
    additionalProperties: false,
  },
  description: 'Architecture states over time: the first is the as-is, the last the to-be; each says what it adds, removes, changes and replaces',
};

/** `from:` and `until:` on an element: the stage it comes in, and the stage it is gone in. */
export const timeMarkProperties = {
  from: { type: 'string', description: 'The stage this is added in (an id under stages:)' },
  until: { type: 'string', description: 'The stage this is gone in (an id under stages:)' },
};
