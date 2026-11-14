// State machines: the states one thing can be in, and what moves it from one to the next.
//
//   states:                                 only what the transitions cannot say themselves
//     Awaiting payment: { entry: reserve stock }
//     Fulfilment:                           a composite state: its substates are nested in it
//       states:
//         Picking: { do: collect the items }
//         Packed:
//     In stock?: choice                     a kind: choice, history or final
//   transitions:                            from -> to: event [guard] / action
//     - start -> Awaiting payment
//     - Awaiting payment -> Fulfilment: payment received
//     - start -> Picking                    the start inside Fulfilment: where Picking is
//     - Picking -> Packed: all items scanned [nothing missing] / print label
//     - Fulfilment -> Cancelled: customer cancels      from the composite: from any substate
//     - Packed -> end
//
// `start` and `end` are the initial and final pseudo-states of the level the state at the other
// end of the arrow lives in. A name that ends in "?" is a choice. A state that appears only in
// `transitions:` needs no entry.
import { linksSchema, parseLinks, tones, type BuildContext, type DiagramType, type FlowShape, type Graph, type GraphBeat, type GraphEdge, type GraphGroup, type GraphNode, type PaletteItem, type Path, type Reference, type Tone } from '@linework/core';

interface Kind {
  label: string;
  icon: string;
  tone: Tone;
  mark?: FlowShape['mark'];
  keywords?: string[];
}

export const kinds: Record<string, Kind> = {
  state: { label: 'State', icon: 'square', tone: 'slate', keywords: ['status', 'phase', 'mode'] },
  choice: { label: 'Choice', icon: 'diamond', tone: 'amber', mark: 'choice', keywords: ['decision', 'guard', 'if', 'branch', 'condition'] },
  final: { label: 'Final state', icon: 'circle-dot', tone: 'slate', mark: 'final', keywords: ['end', 'done', 'terminal'] },
  history: { label: 'History', icon: 'undo-2', tone: 'slate', mark: 'history', keywords: ['resume', 'where it left off'] },
};
const kindOf = (name: unknown): string | undefined => (typeof name === 'string' && Object.hasOwn(kinds, name) ? name : undefined);

type Lines = string | number | (string | number)[];

interface StateEntry {
  label?: string;
  kind?: string;
  entry?: Lines;
  do?: Lines;
  exit?: Lines;
  note?: string;
  tone?: Tone;
  description?: string;
  tags?: string[];
  links?: unknown[];
  states?: Record<string, string | StateEntry | null> | null;
}

type Transition = string | Record<string, string | number | unknown[] | null>;

export interface StatesSource {
  type: 'states';
  title?: string;
  subtitle?: string;
  direction?: 'right' | 'down';
  states?: Record<string, string | StateEntry | null>;
  transitions?: Transition[];
}

/** A state written short: a kind (choice, final, history), or else its label. */
export function stateShorthand(v: unknown): StateEntry {
  if (v == null) return {};
  if (typeof v === 'object') return v as StateEntry;
  return kindOf(v) ? { kind: String(v) } : { label: String(v) };
}

// ---------------------------------------------------------------- the transitions as written

interface Hop {
  from: string;
  to: string;
  label?: string;
  /** Which item of `transitions:` and which arrow in it. */
  item: number;
  n: number;
}

interface Read {
  hops: Hop[];
  /** Every name as written, for renames; `count` is how many other names its item holds, `cut` what goes with it. */
  names: { id: string; start: number; item: number; key: boolean; count: number; cut: [number, number] }[];
  bad: number[];
}

const ARROW = /\s->(?=\s)/g;

/** "a -> b -> c" as its names with where each starts; nothing when it is not a transition. */
export function parseTransition(text: string): { id: string; start: number }[] | undefined {
  const names: { id: string; start: number }[] = [];
  const name = (from: number, to: number) => {
    const raw = text.slice(from, to);
    names.push({ id: raw.trim(), start: from + raw.length - raw.trimStart().length });
  };
  let at = 0;
  for (const m of text.matchAll(ARROW)) {
    name(at, m.index);
    at = m.index + m[0].length;
  }
  name(at, text.length);
  return names.length > 1 && names.every((n) => n.id) ? names : undefined;
}

/** What stands after the colon: "event [guard] / action". YAML reads a bare "[guard]" as a list. */
const labelOf = (v: unknown): string | undefined => {
  const s = Array.isArray(v) ? `[${v.join(', ')}]` : v == null ? '' : String(v);
  return s.trim().replace(/\s+/g, ' ') || undefined;
};

function readTransitions(list: unknown): Read {
  const out: Read = { hops: [], names: [], bad: [] };
  if (!Array.isArray(list)) return out;
  for (const [item, raw] of list.entries()) {
    const key = !!raw && typeof raw === 'object' && !Array.isArray(raw);
    const keys = key ? Object.keys(raw as object) : [];
    const text = typeof raw === 'string' ? raw : keys.length === 1 ? keys[0]! : '';
    const names = parseTransition(text);
    if (!names) {
      out.bad.push(item);
      continue;
    }
    const label = key ? labelOf((raw as Record<string, unknown>)[text]) : undefined;
    for (const [i, n] of names.entries()) {
      // Deleting the state takes its name and one arrow out of a chain: "a -> b -> c" stays "a -> c".
      const cut: [number, number] = i === names.length - 1 ? [names[i - 1]!.start + names[i - 1]!.id.length, n.start + n.id.length] : [n.start, names[i + 1]!.start];
      out.names.push({ ...n, item, key, count: names.length - names.filter((x) => x.id === n.id).length, cut });
    }
    // What is written after the colon belongs to the first arrow.
    for (let n = 0; n + 1 < names.length; n++) out.hops.push({ from: names[n]!.id, to: names[n + 1]!.id, ...(n === 0 && label ? { label } : {}), item, n });
  }
  return out;
}

const reserved = (id: string): 'start' | 'end' | undefined => (/^start$/i.test(id) ? 'start' : /^end$/i.test(id) ? 'end' : undefined);
const impliedKind = (id: string) => (/\?\s*$/.test(id) ? 'choice' : 'state');

interface Known {
  entry: StateEntry;
  parent?: string;
  path: Path;
  composite: boolean;
}

/** Every state under `states:`, however deep, by its name. */
function readStates(src: StatesSource, twice?: (id: string, path: Path, first: Known) => void): Map<string, Known> {
  const known = new Map<string, Known>();
  const visit = (map: unknown, parent: string | undefined, at: Path, depth: number) => {
    if (!map || typeof map !== 'object' || Array.isArray(map) || depth > 16) return;
    for (const [id, raw] of Object.entries(map as Record<string, unknown>)) {
      const entry = stateShorthand(raw);
      const path = [...at, id];
      const first = known.get(id);
      if (first) {
        twice?.(id, path, first);
        continue;
      }
      const composite = !!entry.states && typeof entry.states === 'object' && Object.keys(entry.states).length > 0;
      known.set(id, { entry, ...(parent ? { parent } : {}), path, composite });
      if (composite) visit(entry.states, id, [...path, 'states'], depth + 1);
    }
  };
  visit(src.states, undefined, ['states'], 0);
  return known;
}

const linesOf = (e: StateEntry): string[] =>
  (['entry', 'do', 'exit'] as const).flatMap((k) => (e[k] == null ? [] : (Array.isArray(e[k]) ? e[k] : [e[k]]).map((l) => `${k} / ${l}`)));

// ---------------------------------------------------------------- build

export function buildStates(src: StatesSource, ctx: BuildContext): Graph {
  const known = readStates(src, (id, path, first) => ctx.error(path, `"${id}" is written twice${first.parent ? ` (also in "${first.parent}")` : ''}: a state has one name in the whole diagram`));
  const { hops: written, names, bad } = readTransitions(src.transitions);
  for (const i of bad) ctx.error(['transitions', i], 'A transition is two states with an arrow between them: "a -> b", or "a -> b: event [guard] / action"');
  // Quotes around the whole item take what stands after the colon into the name of the state.
  for (const n of names) if (!n.key && /:\s/.test(n.id)) ctx.warn(['transitions', n.item], `"${n.id}" is read as the name of a state: quote only what stands after the colon, like ${n.id.replace(/:\s+(.*)$/, ': "$1"')}`);
  for (const [id, k] of known) if (reserved(id)) ctx.error(k.path, `"${id}" is the ${reserved(id)} pseudo-state: it is written in transitions only, as "${reserved(id) === 'start' ? 'start -> …' : '… -> end'}"`);

  const firstAt = new Map<string, number>();
  for (const n of names) if (!reserved(n.id) && !firstAt.has(n.id)) firstAt.set(n.id, n.item);
  // States in the order the transitions name them, then what only `states:` knows.
  const ids = [...firstAt.keys(), ...[...known.keys()].filter((id) => !firstAt.has(id) && !reserved(id))];
  const at = (id: string): Path => known.get(id)?.path ?? ['transitions', firstAt.get(id) ?? 0];
  const parentOf = (id: string) => known.get(id)?.parent;
  const composite = (id: string) => !!known.get(id)?.composite;
  const within = (id: string, group: string) => {
    for (let p = parentOf(id), i = 0; p && i < 32; p = parentOf(p), i++) if (p === group) return true;
    return false;
  };

  // "In transit" and "in  transit" are one state to a reader, two to the machine.
  const alike = new Map<string, string>();
  for (const id of ids) {
    const k = id.toLowerCase().replace(/\s+/g, ' ');
    if (alike.has(k)) ctx.warn(at(id), `"${id}" and "${alike.get(k)}" are two states: write them the same way if they are one`);
    else alike.set(k, id);
  }

  const kind = new Map<string, string>();
  for (const id of ids) {
    const e = known.get(id)?.entry;
    if (e?.kind != null && !kindOf(e.kind)) ctx.error([...at(id), 'kind'], `"${e.kind}" is not a kind of state (${Object.keys(kinds).join(', ')})`);
    kind.set(id, composite(id) ? 'state' : (kindOf(e?.kind) ?? impliedKind(id)));
    if (composite(id) && kindOf(e?.kind) && e?.kind !== 'state') ctx.warn([...at(id), 'kind'], `"${id}" holds states, so it is drawn as a composite state, not as a ${e!.kind}`);
    if (kind.get(id) === 'history' && !parentOf(id)) ctx.warn(at(id), `"${id}" is a history state: it belongs inside a composite state, where it remembers the substate`);
  }

  // `start` and `end` live at the level of the state at the other end of their arrow.
  const pseudo = new Map<string, { mark: 'initial' | 'final'; parent?: string; item: number }>();
  const hops: Hop[] = [];
  for (const h of written) {
    const [rf, rt] = [reserved(h.from), reserved(h.to)];
    if (rf && rt) {
      ctx.error(['transitions', h.item], 'A transition from start to end says nothing: name a state between them');
      continue;
    }
    if (rf === 'end') ctx.warn(['transitions', h.item], 'Nothing leaves an end: it is where the machine stops');
    if (rt === 'start') ctx.warn(['transitions', h.item], 'Nothing leads to a start: it is where the machine begins');
    const scoped = (word: 'start' | 'end', other: string) => {
      const parent = parentOf(other);
      const id = parent ? `${parent}.${word}` : word;
      if (!pseudo.has(id)) pseudo.set(id, { mark: word === 'start' ? 'initial' : 'final', ...(parent ? { parent } : {}), item: h.item });
      return id;
    };
    const from = rf ? scoped(rf, h.to) : h.from;
    const to = rt ? scoped(rt, h.from) : h.to;
    if (from === to && composite(from)) {
      ctx.warn(['transitions', h.item], `"${from}" holds states: a transition from the whole of it back to itself cannot be drawn; name the substate it returns to`);
      continue;
    }
    if (within(to, from) || within(from, to)) {
      const [outer, inner] = within(to, from) ? [from, to] : [to, from];
      ctx.warn(['transitions', h.item], `"${inner}" is inside "${outer}": write "start -> ${inner}" for where "${outer}" begins, or go from one of its substates`);
      continue;
    }
    hops.push({ ...h, from, to });
  }
  const outs = (id: string) => hops.filter((h) => h.from === id);
  const ins = (id: string) => hops.filter((h) => h.to === id);

  // ---------------------------------------------------------------- checks
  if (hops.length && !pseudo.has('start')) ctx.warn(['transitions'], 'There is no start: write "start -> <state>" so a reader knows where it begins');
  // What can be reached: along the arrows; entering a composite state starts at its start; what
  // leaves a composite state leaves from any of its substates; history resumes any of them.
  const reached = new Set<string>();
  for (const queue: string[] = pseudo.has('start') ? ['start'] : []; queue.length; ) {
    const id = queue.pop()!;
    if (reached.has(id)) continue;
    reached.add(id);
    queue.push(...outs(id).map((h) => h.to));
    if (composite(id) && pseudo.has(`${id}.start`)) queue.push(`${id}.start`);
    const parent = pseudo.get(id)?.parent ?? parentOf(id);
    if (parent) queue.push(parent);
    if (kind.get(id) === 'history' && parent) queue.push(...ids.filter((x) => parentOf(x) === parent));
  }
  for (const id of ids) {
    const k = kind.get(id)!;
    if (!firstAt.has(id) && !composite(id) && ids.length > 1) ctx.warn(at(id), `"${id}" is in no transition: nothing leads to it or from it`);
    else if (pseudo.has('start') && !reached.has(id) && !composite(id)) ctx.warn(at(id), `Nothing leads to "${id}": the machine cannot get there from its start`);
    if (composite(id) && ins(id).length && !pseudo.has(`${id}.start`)) {
      const child = ids.find((x) => parentOf(x) === id);
      ctx.warn(at(id), `"${id}" is entered as a whole, but nothing says where it begins: add "start -> ${child ?? '<substate>'}"`);
    }
    if (k === 'choice' && firstAt.has(id)) {
      if (outs(id).length < 2) ctx.warn(at(id), `"${id}" has one way out: a choice needs at least two, each with its guard, like "${id} -> …: [condition]"`);
      else if (outs(id).filter((h) => !h.label).length > 1) ctx.warn(at(id), `"${id}" has ways out without a guard: write "${id} -> …: [condition]" so a reader knows which is which`);
    }
    if (k === 'final' && outs(id).length) ctx.warn(['transitions', outs(id)[0]!.item], `"${id}" is a final state, yet a transition leaves it`);
  }

  // ---------------------------------------------------------------- graph
  const groups: GraphGroup[] = [];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const title = (id: string) => known.get(id)?.entry.label ?? id;
  for (const id of ids) {
    const e = known.get(id)?.entry ?? {};
    const parent = parentOf(id);
    const links = parseLinks(e.links);
    const lines = linesOf(e);
    // A state the transitions alone name gets its entry at the top of `states:` once it needs one.
    const more = { ...(parent ? { parent } : {}), ...(links ? { links } : {}), ...(e.description ? { description: e.description } : {}), ...(e.tags?.length ? { tags: e.tags } : {}), path: known.get(id)?.path ?? ['states', id] };
    if (composite(id)) groups.push({ id, label: title(id), ...(lines.length ? { caption: lines.join(' · ') } : {}), tone: e.tone ?? 'slate', border: 'solid', kind: 'composite', ...more });
    else {
      const k = kinds[kind.get(id)!]!;
      const shape: FlowShape = k.mark
        ? { kind: 'flow', form: 'pseudo', label: k.mark === 'history' ? (e.label ?? '') : title(id), tone: e.tone ?? k.tone, mark: k.mark }
        : { kind: 'flow', form: 'state', label: title(id), tone: e.tone ?? k.tone, ...(lines.length ? { lines } : {}) };
      nodes.push({ id, shape, kind: kind.get(id)!, ...more });
    }
    if (e.note) {
      // A note hangs on its state by a dotted line, at the state's own level.
      nodes.push({ id: `${id}.note`, ...(parent ? { parent } : {}), shape: { kind: 'flow', form: 'note', label: String(e.note), tone: 'slate' }, kind: 'note', path: [...at(id), 'note'] });
      edges.push({ id: `${id}.note`, from: { node: `${id}.note` }, to: { node: id }, line: 'dotted', start: 'none', end: 'none', kind: 'Note', path: [...at(id), 'note'] });
    }
  }
  for (const [id, p] of pseudo) nodes.push({ id, ...(p.parent ? { parent: p.parent } : {}), shape: { kind: 'flow', form: 'pseudo', label: '', tone: 'slate', mark: p.mark }, kind: p.mark === 'initial' ? 'start' : 'end', path: ['transitions', p.item] });

  // The layout reads the flow off the order of the nodes (which line of a cycle is the one that
  // turns back): hand them over as the machine runs, from its start along the transitions.
  const found = new Map<string, number>();
  const visit = (id: string) => {
    if (found.has(id)) return;
    found.set(id, found.size);
    if (composite(id) && pseudo.has(`${id}.start`)) visit(`${id}.start`);
    for (const h of outs(id)) visit(h.to);
  };
  if (pseudo.has('start')) visit('start');
  const turn = (id: string) => found.get(id.replace(/\.note$/, '')) ?? found.size;
  nodes.sort((a, b) => turn(a.id) - turn(b.id));

  const edgeId = (h: Hop) => `t${h.item}${h.n ? `.${h.n}` : ''}`;
  for (const h of hops) edges.push({ id: edgeId(h), from: { node: h.from }, to: { node: h.to }, ...(h.label ? { label: h.label } : {}), line: 'solid', start: 'none', end: 'arrow', path: ['transitions', h.item] });

  // What a presentation walks when no steps are written: from the start along the first way out, state by state.
  const walk: GraphBeat[] = [];
  const seen = new Set<string>();
  const name = (id: string) => (pseudo.has(id) ? (pseudo.get(id)!.mark === 'initial' ? 'Start' : 'End') : title(id));
  const show = (id: string) => (composite(id) ? [id, ...ids.filter((x) => within(x, id) && !composite(x)), ...[...pseudo].filter(([, p]) => p.parent && (p.parent === id || within(p.parent, id))).map(([x]) => x)] : [id]);
  for (let h = (pseudo.has('start') ? outs('start') : hops)[0]; h && !seen.has(h.to); h = outs(h.to).find((x) => !seen.has(x.to))) {
    if (!walk.length) (walk.push({ title: name(h.from), nodes: show(h.from), edges: [] }), seen.add(h.from));
    walk.push({ title: name(h.to), ...(h.label ? { caption: h.label } : {}), nodes: show(h.to), edges: [edgeId(h)] });
    seen.add(h.to);
  }

  return {
    ...(src.title ? { title: src.title } : {}),
    ...(src.subtitle ? { subtitle: src.subtitle } : {}),
    direction: src.direction ?? 'right',
    groups,
    nodes,
    edges,
    ...(walk.length > 1 ? { walk } : {}),
  };
}

/** Every place a state is named in a transition, so renames and deletes follow. */
export function statesReferences(src: StatesSource): Reference[] {
  return readTransitions(src.transitions)
    .names.filter((n) => !reserved(n.id))
    .map((n) => ({ path: ['transitions', n.item], ...(n.key ? { key: true } : {}), id: n.id, start: n.start, collection: 'states', ...(n.count > 1 ? { onDelete: 'cut' as const, cut: n.cut, among: n.count + 1 } : {}) }));
}

// ---------------------------------------------------------------- one line of a chain, for the builder

/** A transition as the shortest item that says it: "a -> b", or "a -> b: label". */
const itemFor = (names: string[], label?: unknown): unknown => (label == null || label === '' ? names.join(' -> ') : { [names.join(' -> ')]: label });

/** The transition a drawn line is part of, and which of its arrows it is. */
function lineOf(src: StatesSource, edge: string) {
  const m = /^t(\d+)(?:\.(\d+))?$/.exec(edge);
  const raw = m ? src.transitions?.[Number(m[1])] : undefined;
  const key = !!raw && typeof raw === 'object' && !Array.isArray(raw);
  const text = typeof raw === 'string' ? raw : key && Object.keys(raw).length === 1 ? Object.keys(raw)[0]! : '';
  const names = parseTransition(text)?.map((x) => x.id);
  const n = Number(m?.[2] ?? 0);
  if (!m || !names || n + 1 >= names.length) return undefined;
  return { item: Number(m[1]), n, names, label: key ? (raw as Record<string, unknown>)[text] : undefined };
}

const lineEdits: NonNullable<DiagramType<StatesSource>['lines']> = {
  hint: 'event [guard] / action',
  label(src, edge, label) {
    const at = lineOf(src, edge);
    if (!at) return undefined;
    const { item, n, names } = at;
    const text = label.trim().replace(/\s+/g, ' ');
    if (n === 0) return { path: ['transitions', item], items: [itemFor(names, text)] };
    // What stands after the colon belongs to the first arrow: the chain is cut where the label goes.
    return { path: ['transitions', item], items: [itemFor(names.slice(0, n + 1), at.label), itemFor(names.slice(n), text)] };
  },
  remove(src, edge) {
    const at = lineOf(src, edge);
    if (!at) return undefined;
    const { item, n, names } = at;
    return { path: ['transitions', item], items: [...(n > 0 ? [itemFor(names.slice(0, n + 1), at.label)] : []), ...(n + 2 < names.length ? [itemFor(names.slice(n + 1))] : [])] };
  },
};

// ---------------------------------------------------------------- schema

const lines = { anyOf: [{ type: ['string', 'number'] }, { type: 'array', items: { type: ['string', 'number'] } }] };
const state = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'What it says (default: its name)' },
    kind: { enum: Object.keys(kinds), description: 'state (default), choice (a diamond: the way out depends on a guard), final, history' },
    entry: { ...lines, description: 'What it does on the way in' },
    do: { ...lines, description: 'What it does while it lasts' },
    exit: { ...lines, description: 'What it does on the way out' },
    note: { type: 'string', description: 'A remark beside it' },
    tone: { enum: tones },
    description: { type: 'string', description: 'Longer text, shown as a tooltip' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Free words that steps select with tag:name' },
    links: linksSchema,
    states: { $ref: '#/definitions/states' },
  },
  additionalProperties: false,
};
const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Linework state machine',
  type: 'object',
  required: ['type'],
  definitions: {
    states: {
      type: ['object', 'null'],
      description: 'States by name; a state with states of its own is a composite state',
      additionalProperties: { anyOf: [{ type: 'string', description: 'A kind (choice, final, history) or its label' }, { type: 'null' }, state] },
    },
  },
  properties: {
    type: { const: 'states' },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    direction: { enum: ['right', 'down'], description: 'Which way the states follow each other: right (default) or down' },
    states: { $ref: '#/definitions/states' },
    transitions: {
      type: 'array',
      description: 'What moves it from one state to the next; start and end are the initial and final pseudo-states',
      items: {
        anyOf: [
          { type: 'string', pattern: '\\s->\\s', description: '"a -> b", or a chain "a -> b -> c"' },
          {
            type: 'object',
            minProperties: 1,
            maxProperties: 1,
            additionalProperties: { anyOf: [{ type: ['string', 'number', 'null'], description: 'event [guard] / action' }, { type: 'array', description: 'A guard alone: [condition]' }] },
          },
        ],
      },
    },
  },
  additionalProperties: false,
};

const palette: PaletteItem[] = Object.entries(kinds).map(([kind, k]) => ({ collection: 'states', kind, label: k.label, icon: k.icon, tone: k.tone, ...(k.keywords ? { keywords: k.keywords } : {}) }));

export const states: DiagramType<StatesSource> = {
  id: 'states',
  name: 'States',
  description: 'The states one thing can be in and what moves it on: a state machine with start and end, composite states, choices and guards',
  icon: 'circle-dot',
  tagline: 'The states one thing can be in, and what moves it on',
  useWhen: ['The lifecycle of an order, a ticket or a document', 'What a pull request or a contract can become, and when', 'A connection or a device that retries, times out and recovers', 'Checking that no status is a dead end before it is built'],
  notFor: [
    { text: 'Who does what in which order, with decisions', use: 'process' },
    { text: 'Messages between systems, call by call', use: 'sequence' },
    { text: 'Branches, merges and releases in git', use: 'gitflow' },
    { text: 'What is delivered when', use: 'roadmap' },
  ],
  keywords: ['state', 'states', 'state machine', 'statechart', 'state diagram', 'lifecycle', 'life cycle', 'status', 'statuses', 'transition', 'transitions', 'fsm', 'finite state', 'guard', 'workflow status', 'order status', 'ticket status'],
  schema,
  palette,
  template: `type: states
title: Order lifecycle
subtitle: The states an order can be in, and what moves it on

states:
  Awaiting payment: { entry: reserve stock }
  Fulfilment:
    states:
      Picking: { do: collect the items }
      Packed: { entry: print the label }
  Cancelled: { entry: release stock }

transitions:
  - start -> Awaiting payment: order placed
  - Awaiting payment -> Fulfilment: payment received
  - start -> Picking
  - Picking -> Packed: all items scanned
  - Fulfilment -> Shipped: handed to carrier
  - Shipped -> Delivered: signed for
  - Delivered -> end
  - Awaiting payment -> Cancelled: 30 min without payment
  - Fulfilment -> Cancelled: customer cancels
  - Cancelled -> end
`,
  build: buildStates,
  references: statesReferences,
  connect(src, from, to) {
    const known = readStates(src);
    const pseudo = (id: string) => /(^|\.)(start|end)$/.test(id) && !known.has(id);
    const word = (id: string) => (pseudo(id) ? id.slice(id.lastIndexOf('.') + 1) : id);
    if (pseudo(from) && word(from) === 'end') return 'Nothing leaves an end: connect to it instead';
    if (pseudo(to) && word(to) === 'start') return 'Nothing leads to a start: connect from it instead';
    if (pseudo(from) && pseudo(to)) return 'Name a state between the start and the end';
    const { hops } = readTransitions(src.transitions);
    if (hops.some((h) => h.from === word(from) && h.to === word(to) && !h.label)) return 'They are already connected: give that transition its event first';
    const kind = (id: string) => kindOf(known.get(id)?.entry.kind) ?? impliedKind(id);
    // The ways out of a choice carry a guard: the first is yes, the second no.
    const taken = new Set(hops.filter((h) => h.from === from).map((h) => h.label?.toLowerCase()));
    const guard = !pseudo(from) && kind(from) === 'choice' ? ['[yes]', '[no]'].find((l) => !taken.has(l)) : undefined;
    const text = `${word(from)} -> ${word(to)}`;
    return { path: ['transitions'], value: guard ? { [text]: guard } : text };
  },
  shorthand(collection, value) {
    if (collection === 'states') return stateShorthand(value) as Record<string, unknown>;
    return undefined;
  },
  freeNames: true,
  lines: lineEdits,
  // Left to right, unless the source says otherwise: top-down the labels crowd the lines between states.
  tuning: { labelRoom: 'fit', autoDirection: false },
};
