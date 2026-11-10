// Tracing a request: which elements it passes, along the relations, and in what order the calls go.
//
// Three ways in. Between two elements: the simple paths along the arrows, shortest first, through
// elements that pass a request on (a person or a database ends one, it does not go through them).
// From one element until it ends: every relation followed downstream, stopping at stores, external
// systems and people, a loop noticed and not followed. Along steps: the routes of a diagram's
// `steps:` or the numbered lines of a dynamic view, one after the other.
//
// What comes out is a list of calls; `narrate` turns it into messages with replies: a sync call is
// answered once the callee is done, an async message (into or out of a queue, or a relation styled
// async) is not answered at all.
import type { Role, TraceElement, TraceGraph, TraceRelation } from './graph.ts';

export interface Call {
  from: string;
  to: string;
  label?: string;
  technology?: string;
  async: boolean;
  relation?: TraceRelation;
}

export type Item =
  | { kind: 'call'; from: string; to: string; label?: string; async: boolean; relation?: TraceRelation }
  | { kind: 'reply'; from: string; to: string }
  | { kind: 'note'; over: string; text: string }
  | { kind: 'divider'; label: string }
  /** par: at the same time; alt: one of them (a router sends each request one way). */
  | { kind: 'frame'; frame: 'par' | 'alt'; branches: { label?: string; items: Item[] }[] };

export interface TraceOption {
  /** One line to pick it by: "Customers → Storefront → API gateway → Orders → Orders DB". */
  summary: string;
  /** The elements it passes, in order of first appearance. */
  ids: string[];
  items: Item[];
  /** What the trace decided on its way, said once (a loop not followed, a fan-out drawn in parallel). */
  notes: string[];
  /** Calls along the way, without replies: what a dynamic view numbers. */
  calls: Call[];
}

/** Roles a request does not pass through: it ends there. */
const ENDS: Role[] = ['actor', 'store'];
const LONGEST = 12;

const labelOf = (g: TraceGraph, id: string) => g.elements.get(id)?.label ?? id;

/** Within a group: the group itself and everything inside it. */
export function within(g: TraceGraph, id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const e of g.elements.values()) if (e.parent === out[i] && !out.includes(e.id)) out.push(e.id);
  return out;
}

interface Step {
  to: string;
  rel: TraceRelation;
  /** Walked against a line without a direction. */
  reversed?: boolean;
}

function adjacency(g: TraceGraph): Map<string, Step[]> {
  const out = new Map<string, Step[]>();
  const add = (from: string, s: Step) => out.set(from, [...(out.get(from) ?? []), s]);
  for (const r of g.relations) {
    add(r.from, { to: r.to, rel: r });
    if (r.both) add(r.to, { to: r.from, rel: r, reversed: true });
  }
  return out;
}

const roleOf = (g: TraceGraph, id: string): Role => g.elements.get(id)?.role ?? 'service';

/** Into a queue, out of one, or styled so: fire and forget. */
const isAsync = (g: TraceGraph, from: string, to: string, rel?: TraceRelation) => !!rel?.async || roleOf(g, from) === 'queue' || roleOf(g, to) === 'queue';

const ROUTER = /\b(gateway|load.?balancer|lb|alb|elb|front.?door|cdn|ingress|proxy|api.?management|apim|router|waf|traffic.?manager|app.?gateway)\b/;
/** Passes requests on as they come (a gateway, a load balancer, a CDN): each one goes one way. */
export const isRouter = (g: TraceGraph, id: string) => ROUTER.test((g.elements.get(id)?.kind ?? '').toLowerCase().replace(/[-_]+/g, ' '));

/**
 * A call along a relation. A line without a label out of a router carries the request that came in:
 * it takes that call's label, so the request can be followed through the gateway.
 */
const callOf = (g: TraceGraph, from: string, to: string, rel?: TraceRelation, incoming?: Call): Call => {
  const forwarded = !rel?.label && !rel?.technology && incoming && isRouter(g, from) && !incoming.async ? incoming : undefined;
  const said = forwarded ?? rel;
  return {
    from,
    to,
    ...(said?.label ? { label: said.label } : {}),
    ...(said?.technology ? { technology: said.technology } : {}),
    async: isAsync(g, from, to, rel),
    ...(rel ? { relation: rel } : {}),
  };
};

/** Calls along a chain of steps, each knowing the one before it. */
const chainCalls = (g: TraceGraph, start: string, steps: { to: string; rel?: TraceRelation }[]): Call[] => {
  const out: Call[] = [];
  steps.forEach((s, i) => out.push(callOf(g, i ? steps[i - 1]!.to : start, s.to, s.rel, out[i - 1])));
  return out;
};

/** The relation from a to b as written, else a line without a direction between them. */
export function relationBetween(g: TraceGraph, a: string, b: string): TraceRelation | undefined {
  return g.relations.find((r) => r.from === a && r.to === b) ?? g.relations.find((r) => r.both && r.from === b && r.to === a);
}

// ---------------------------------------------------------------- between two elements

/**
 * The simple paths from `from` to `to` along the relations, best first: fewest calls, then fewest
 * external systems passed on the way and lines walked without a direction, then the order the
 * relations are written in. A group stands for itself and everything inside it.
 */
export function paths(g: TraceGraph, from: string, to: string, limit = 5): TraceOption[] {
  const adj = adjacency(g);
  const sources = within(g, from);
  const targets = new Set(within(g, to));
  for (const s of sources) targets.delete(s);
  if (!targets.size) return [];
  const passes = (id: string) => !ENDS.includes(roleOf(g, id));

  // How far each element is from a target, walking back: bounds the search below.
  const dist = new Map<string, number>([...targets].map((t) => [t, 0]));
  const back = new Map<string, string[]>();
  for (const [a, steps] of adj) for (const s of steps) back.set(s.to, [...(back.get(s.to) ?? []), a]);
  for (let frontier = [...targets], d = 1; frontier.length && d <= LONGEST; d++) {
    const next: string[] = [];
    for (const v of frontier)
      for (const u of back.get(v) ?? [])
        if (!dist.has(u) && (passes(u) || sources.includes(u))) {
          dist.set(u, d);
          next.push(u);
        }
    frontier = next;
  }
  const best = Math.min(...sources.map((s) => dist.get(s) ?? Infinity));
  if (best === Infinity) return [];
  const bound = Math.min(LONGEST, best + 2);

  const order = new Map(g.relations.map((r, i) => [r, i]));
  const found: { steps: Step[]; start: string; cost: number; rank: number[] }[] = [];
  const walk = (at: string, start: string, taken: Step[], seen: Set<string>) => {
    if (found.length >= 400) return;
    for (const s of adj.get(at) ?? []) {
      if (seen.has(s.to)) continue;
      const left = dist.get(s.to);
      if (left === undefined || taken.length + 1 + left > bound) continue;
      const steps = [...taken, s];
      if (targets.has(s.to)) {
        const passed = steps.slice(0, -1).map((x) => x.to);
        const cost = steps.length + 0.6 * passed.filter((id) => roleOf(g, id) === 'external').length + 0.3 * steps.filter((x) => x.reversed || x.rel.both).length;
        found.push({ steps, start, cost, rank: steps.map((x) => order.get(x.rel) ?? 0) });
        continue;
      }
      if (!passes(s.to)) continue;
      walk(s.to, start, steps, new Set([...seen, s.to]));
    }
  };
  for (const s of sources) walk(s, s, [], new Set([s]));

  const lex = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
    return a.length - b.length;
  };
  found.sort((a, b) => a.cost - b.cost || lex(a.rank, b.rank));
  // Two lines between the same two elements make the same route: it is offered once.
  const routes = new Set<string>();
  const out: TraceOption[] = [];
  for (const f of found) {
    const ids = [f.start, ...f.steps.map((s) => s.to)];
    const key = ids.join('>');
    if (routes.has(key)) continue;
    routes.add(key);
    const calls = chainCalls(g, f.start, f.steps);
    out.push(option(g, calls, narrate(calls), []));
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------- from one element until it ends

interface Branch {
  call: Call;
  children: Branch[];
  /** loop: it calls back into something still busy with this request; seen: followed further up already. */
  stop?: 'loop' | 'seen';
}

/**
 * Every relation followed from `from`, in the order written, until stores, external systems and
 * people: what one request sets in motion. A loop back into an element still working on the
 * request is drawn once and not followed; an element reached a second time is called, not walked again.
 */
export function until(g: TraceGraph, from: string): TraceOption | undefined {
  const adj = adjacency(g);
  const notes: string[] = [];
  const expanded = new Set<string>();
  const grow = (at: string, stack: string[], incoming?: Call): Branch[] => {
    expanded.add(at);
    const out: Branch[] = [];
    const targets = new Set<string>();
    for (const s of adj.get(at) ?? []) {
      // A line without a direction leads back the way it came: not a call.
      if (targets.has(s.to) || (s.reversed && stack.includes(s.to))) continue;
      targets.add(s.to);
      const call = callOf(g, at, s.to, s.rel, incoming);
      if (stack.includes(s.to)) {
        notes.push(`${labelOf(g, at)} calls back into ${labelOf(g, s.to)}: drawn once, the loop is not followed`);
        out.push({ call, children: [], stop: 'loop' });
      } else if (expanded.has(s.to)) out.push({ call, children: [], stop: 'seen' });
      else if (ENDS.includes(roleOf(g, s.to)) || roleOf(g, s.to) === 'external' || stack.length >= LONGEST) {
        expanded.add(s.to);
        out.push({ call, children: [] });
      } else out.push({ call, children: grow(s.to, [...stack, s.to], call) });
    }
    return out;
  };
  const tree = grow(from, [from]);
  if (!tree.length) return undefined;

  const items: Item[] = [];
  const calls: Call[] = [];
  const names = (list: Branch[]) => list.map((b) => labelOf(g, b.call.to)).join(', ');
  const emit = (b: Branch, into: Item[]) => {
    calls.push(b.call);
    into.push(callItem(b.call));
    if (b.stop === 'loop') into.push({ kind: 'note', over: b.call.to, text: 'Already busy with this request: the loop is not followed' });
    children(b.call.to, b.children, into);
    if (!b.call.async) into.push({ kind: 'reply', from: b.call.to, to: b.call.from });
  };
  const children = (at: string, list: Branch[], into: Item[]) => {
    // Async messages to several at once go out in parallel. A router sends each request one of its
    // ways: its calls are alternatives. Other calls go one after the other, in the order written.
    const asyncs = list.filter((b) => b.call.async);
    const routes = isRouter(g, at) ? list.filter((b) => !b.call.async) : [];
    const together = (b: Branch) => (b.call.async ? asyncs.length >= 2 : routes.length >= 2);
    if (asyncs.length >= 2) notes.push(`${labelOf(g, at)} sends to ${names(asyncs)} without waiting: drawn as a par frame`);
    if (routes.length >= 2) notes.push(`${labelOf(g, at)} passes each request on to one of ${names(routes)}: drawn as an alt frame`);
    const done = new Set<'par' | 'alt'>();
    for (const b of list) {
      if (!together(b)) {
        emit(b, into);
        continue;
      }
      const frame = b.call.async ? 'par' : 'alt';
      if (done.has(frame)) continue;
      done.add(frame);
      into.push({
        kind: 'frame',
        frame,
        branches: (frame === 'par' ? asyncs : routes).map((x) => {
          const inner: Item[] = [];
          emit(x, inner);
          return { label: labelOf(g, x.call.to), items: inner };
        }),
      });
    }
  };
  children(from, tree, items);
  return option(g, calls, items, notes);
}

// ---------------------------------------------------------------- along steps

/** One step of a story: its title and the routes it walks ("a -> b -> c"), as element ids. */
export interface StoryStep {
  title?: string;
  routes: string[][];
}

/**
 * The calls of a story told in steps, in order. Each hop of a route takes the relation between its
 * two ends; where there is none, the shortest path between them. A step whose routes leave one
 * element for several others at once is drawn as a par frame.
 */
export function story(g: TraceGraph, steps: StoryStep[]): TraceOption | undefined {
  const notes: string[] = [];
  const hop = (a: string, b: string): Call[] => {
    const r = relationBetween(g, a, b);
    if (r) return [callOf(g, a, b, r, last)];
    const via = paths(g, a, b, 1)[0];
    if (via) {
      notes.push(`No line from ${labelOf(g, a)} to ${labelOf(g, b)}: traced through ${via.ids.slice(1, -1).map((id) => labelOf(g, id)).join(', ')}`);
      // Called again knowing the call that came in, so a router on the way forwards its label.
      const out: Call[] = [];
      for (const c of via.calls) out.push(callOf(g, c.from, c.to, c.relation, out.at(-1) ?? last));
      return out;
    }
    notes.push(`Nothing leads from ${labelOf(g, a)} to ${labelOf(g, b)}: drawn as a call without a line`);
    return [callOf(g, a, b)];
  };
  let last: Call | undefined;
  const routeCalls = (ids: string[]) =>
    ids.slice(1).flatMap((b, i) => {
      // A route that goes on from where the one before ended carries on with its request: a router
      // it starts at forwards that call's label ("customers -> gateway", then "gateway -> orders").
      if (i === 0 && last?.to !== ids[0]) last = undefined;
      const out = hop(ids[i]!, b);
      last = out.at(-1);
      return out;
    });
  const told = steps.map((s) => ({ title: s.title, routes: s.routes.filter((r) => r.length >= 2).map(routeCalls) })).filter((s) => s.routes.length);
  if (!told.length) return undefined;

  const items: Item[] = [];
  const calls: Call[] = [];
  const stack: Frame[] = [];
  const titled = told.length > 1;
  for (const s of told) {
    // What the step before left open is answered first: the divider starts the new step.
    enter(stack, s.routes[0]![0]!.from, items);
    if (titled && s.title) items.push({ kind: 'divider', label: s.title });
    const starts = new Set(s.routes.map((r) => r[0]!.from));
    const ends = new Set(s.routes.map((r) => r.at(-1)!.to));
    if (s.routes.length > 1 && starts.size === 1 && ends.size === s.routes.length) {
      // One element to several at once in one step: in parallel, each branch answered inside it.
      notes.push(`${s.title ? `"${s.title}"` : 'A step'} leaves ${labelOf(g, [...starts][0]!)} for ${s.routes.length} places at once: drawn as a par frame`);
      const depth = enter(stack, [...starts][0]!, items);
      items.push({
        kind: 'frame',
        frame: 'par',
        branches: s.routes.map((r) => {
          const inner: Item[] = [];
          const mine = stack.slice(0, depth);
          for (const c of r) (calls.push(c), play(mine, c, inner));
          unwind(mine, depth, inner);
          return { label: labelOf(g, r.at(-1)!.to), items: inner };
        }),
      });
    } else for (const r of s.routes) for (const c of r) (calls.push(c), play(stack, c, items));
  }
  unwind(stack, 0, items);
  return option(g, calls, items, notes);
}

// ---------------------------------------------------------------- calls → messages

interface Frame {
  id: string;
  /** Reached by an async message: nobody waits for its answer. */
  async: boolean;
}

/** Back down the stack to `depth`, answering every sync call on the way. */
function unwind(stack: Frame[], depth: number, into: Item[]) {
  while (stack.length > Math.max(depth, 1)) {
    const done = stack.pop()!;
    if (!done.async) into.push({ kind: 'reply', from: done.id, to: stack.at(-1)!.id });
  }
  if (depth === 0) stack.length = 0;
}

/** Makes `id` the one at work: back to it on the stack, or a new start. Returns the depth it is at. */
function enter(stack: Frame[], id: string, into: Item[]): number {
  const at = stack.map((f) => f.id).lastIndexOf(id);
  if (at >= 0) unwind(stack, at + 1, into);
  else {
    unwind(stack, 0, into);
    stack.push({ id, async: false });
  }
  return stack.length;
}

function play(stack: Frame[], c: Call, into: Item[]) {
  enter(stack, c.from, into);
  into.push(callItem(c));
  stack.push({ id: c.to, async: c.async });
}

const callItem = (c: Call): Item => ({ kind: 'call', from: c.from, to: c.to, ...(c.label || c.technology ? { label: withTech(c.label, c.technology) } : {}), async: c.async, ...(c.relation ? { relation: c.relation } : {}) });
const withTech = (label: string | undefined, tech: string | undefined) => (tech ? (label ? `${label} [${tech}]` : `[${tech}]`) : label);

/** Calls in order as messages: each call answered once the callee is done with it, async ones never. */
export function narrate(calls: Call[]): Item[] {
  const items: Item[] = [];
  const stack: Frame[] = [];
  for (const c of calls) play(stack, c, items);
  unwind(stack, 0, items);
  return items;
}

function option(g: TraceGraph, calls: Call[], items: Item[], notes: string[]): TraceOption {
  const ids: string[] = [];
  const add = (id: string) => ids.includes(id) || ids.push(id);
  const visit = (list: Item[]) => {
    for (const it of list)
      if (it.kind === 'call' || it.kind === 'reply') (add(it.from), add(it.to));
      else if (it.kind === 'frame') it.branches.forEach((b) => visit(b.items));
  };
  visit(items);
  // A route reads as the chain it is; a tree or a story by where it starts and how many it reaches.
  const chain = calls.every((c, i) => i === 0 || c.from === calls[i - 1]!.to);
  const summary = chain ? [calls[0]!.from, ...calls.map((c) => c.to)].map((id) => labelOf(g, id)).join(' → ') : `${labelOf(g, calls[0]!.from)} → ${ids.length - 1} ${ids.length === 2 ? 'other' : 'others'}`;
  return { summary, ids, items, notes: [...new Set(notes)], calls };
}

/** Elements as people name them: an id, the end of a dotted id (api.payments), or a label. */
export function findElement(g: TraceGraph, name: string): { id?: string; message?: string } {
  const n = name.trim();
  if (g.elements.has(n)) return { id: n };
  const all = [...g.elements.values()];
  const tail = all.filter((e) => e.id.endsWith(`.${n}`));
  if (tail.length === 1) return { id: tail[0]!.id };
  const named = all.filter((e) => e.label.toLowerCase() === n.toLowerCase());
  if (named.length === 1) return { id: named[0]!.id };
  const many = tail.length > 1 ? tail : named;
  if (many.length > 1) return { message: `"${n}" could be ${many.map((e) => e.id).join(', ')}: name one` };
  const near = all.filter((e: TraceElement) => e.id.includes(n) || e.label.toLowerCase().includes(n.toLowerCase())).slice(0, 5);
  return { message: `There is no element "${n}"${near.length ? `; did you mean ${near.map((e) => e.id).join(', ')}?` : ''}` };
}
