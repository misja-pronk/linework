// Processes: who does what, in which order, and where it branches. BPMN's everyday shapes without
// its ceremony, and the type for a decision flowchart.
//
//   lanes:                                  who does it; optional, without lanes it is a flowchart
//     employee: Employee
//     manager: Line manager
//   nodes:                                  only what the flow cannot say itself
//     Request access: employee              a lane, or a kind (user, service, end, timer, parallel…)
//     Check request: { in: manager, kind: user }
//     Rejected: { kind: end, in: employee }
//   flow:                                   read it aloud: the names are the steps
//     - start -> Request access -> Check request -> Approved? -yes-> Grant access -> end
//     - Approved? -no-> Explain why -> Rejected
//     - Grant access --> Employee informed: by mail        --> is a message; "a -> b: text" labels the line
//     - Stock? -> Order parts: { label: none left, default: true }
//
// A name that ends in "?" is a decision, `start` and `end` are the events; everything else is a
// task until `nodes:` says otherwise. A step without `in:` stands in the lane of the step before
// it. The first line of `flow:` is the happy path: drawn straight and a little heavier, and what
// a presentation walks when no steps are written.
import { linksSchema, parseLinks, tones, type BuildContext, type DiagramType, type FlowForm, type FlowShape, type Graph, type GraphBeat, type GraphEdge, type GraphGroup, type GraphNode, type LegendItem, type PaletteItem, type Path, type Reference, type Tone } from '@cartography/core';
import { flowLayout } from './layout.ts';

interface Kind {
  label: string;
  form: FlowForm;
  tone: Tone;
  /** In the palette. */
  icon: string;
  /** Drawn in the shape: a task's corner, an event's circle. */
  inside?: string;
  mark?: FlowShape['mark'];
  keywords?: string[];
}

export const kinds: Record<string, Kind> = {
  task: { label: 'Task', form: 'task', tone: 'slate', icon: 'square', keywords: ['step', 'activity', 'action'] },
  user: { label: 'User task', form: 'task', tone: 'blue', icon: 'user', inside: 'user', keywords: ['human', 'person', 'form'] },
  service: { label: 'Service task', form: 'task', tone: 'blue', icon: 'cog', inside: 'cog', keywords: ['system', 'automated', 'api'] },
  manual: { label: 'Manual task', form: 'task', tone: 'blue', icon: 'hand', inside: 'hand', keywords: ['by hand', 'offline'] },
  script: { label: 'Script task', form: 'task', tone: 'blue', icon: 'scroll-text', inside: 'scroll-text', keywords: ['code', 'job'] },
  subprocess: { label: 'Subprocess', form: 'subprocess', tone: 'slate', icon: 'square-plus', keywords: ['collapsed', 'call activity', 'drill down'] },
  decision: { label: 'Decision', form: 'gateway', mark: 'xor', tone: 'amber', icon: 'diamond', keywords: ['xor', 'exclusive', 'gateway', 'if', 'choice', 'question', 'condition'] },
  parallel: { label: 'Parallel gateway', form: 'gateway', mark: 'and', tone: 'amber', icon: 'diamond-plus', keywords: ['and', 'fork', 'join', 'split', 'at the same time'] },
  inclusive: { label: 'Inclusive gateway', form: 'gateway', mark: 'or', tone: 'amber', icon: 'diamond', keywords: ['or', 'one or more'] },
  'event-based': { label: 'Event gateway', form: 'gateway', mark: 'event', tone: 'amber', icon: 'diamond', keywords: ['whichever comes first', 'race', 'wait'] },
  start: { label: 'Start', form: 'event', mark: 'start', tone: 'green', icon: 'circle-play', keywords: ['begin', 'trigger'] },
  end: { label: 'End', form: 'event', mark: 'end', tone: 'slate', icon: 'circle-stop', keywords: ['stop', 'finish', 'done', 'result'] },
  timer: { label: 'Timer', form: 'event', tone: 'amber', icon: 'clock', inside: 'clock', keywords: ['wait', 'deadline', 'schedule', 'every day'] },
  message: { label: 'Message', form: 'event', tone: 'blue', icon: 'mail', inside: 'mail', keywords: ['receive', 'mail', 'request arrives'] },
  error: { label: 'Error', form: 'event', tone: 'rose', icon: 'zap', inside: 'zap', keywords: ['failure', 'exception'] },
  signal: { label: 'Signal', form: 'event', tone: 'violet', icon: 'radio', inside: 'radio', keywords: ['broadcast', 'alert'] },
  document: { label: 'Document', form: 'document', tone: 'slate', icon: 'file-text', keywords: ['data object', 'form', 'file', 'record'] },
  note: { label: 'Note', form: 'note', tone: 'slate', icon: 'sticky-note', keywords: ['annotation', 'comment', 'remark'] },
};

/** Other words for the same kinds: BPMN's own. */
const aliases: Record<string, string> = { xor: 'decision', and: 'parallel', or: 'inclusive' };
const kindOf = (name: unknown): string | undefined => (typeof name !== 'string' ? undefined : Object.hasOwn(kinds, name) ? name : aliases[name]);

interface NodeEntry {
  label?: string;
  kind?: string;
  in?: string;
  caption?: string;
  icon?: string;
  tone?: Tone;
  description?: string;
  tags?: string[];
  links?: unknown[];
}

interface FlowProps {
  label?: string | number;
  default?: boolean;
}

type FlowItem = string | Record<string, string | number | FlowProps | null>;

export interface ProcessSource {
  type: 'process';
  title?: string;
  subtitle?: string;
  direction?: 'right' | 'down';
  happy?: boolean;
  lanes?: Record<string, string | { label?: string; tone?: Tone; description?: string; links?: unknown[] } | null>;
  nodes?: Record<string, string | NodeEntry | null>;
  flow?: FlowItem[];
}

// ---------------------------------------------------------------- the flow as written

/** "->" hands on, "-->" is a message; "-yes->" and "--by mail-->" carry their label. */
const ARROW = /\s(--?)(?:([^-\s>](?:[^>]*[^-\s>])?)\1)?>(?=\s)/g;

export interface Chain {
  names: { id: string; start: number }[];
  arrows: { label?: string; message: boolean }[];
}

/** "a -> b -yes-> c" as its names and the arrows between them; nothing when it is not a flow. */
export function parseChain(text: string): Chain | undefined {
  const names: Chain['names'] = [];
  const arrows: Chain['arrows'] = [];
  const name = (from: number, to: number) => {
    const raw = text.slice(from, to);
    names.push({ id: raw.trim(), start: from + raw.length - raw.trimStart().length });
  };
  let at = 0;
  for (const m of text.matchAll(ARROW)) {
    name(at, m.index);
    arrows.push({ message: m[1] === '--', ...(m[2] ? { label: m[2].trim() } : {}) });
    at = m.index + m[0].length;
  }
  name(at, text.length);
  return names.length > 1 && names.every((n) => n.id) ? { names, arrows } : undefined;
}

interface Hop {
  from: string;
  to: string;
  label?: string;
  message: boolean;
  default: boolean;
  /** Which item of `flow:` and which arrow in it. */
  item: number;
  n: number;
}

interface Read {
  hops: Hop[];
  /** Every name as written, for renames; `count` is how many other names its item holds, `cut` what goes with it. */
  names: { id: string; start: number; item: number; key: boolean; count: number; cut: [number, number] }[];
  bad: number[];
}

/** One item of `flow:` as its chain and what stands after the colon. */
function readItem(raw: unknown): { chain: Chain; props: FlowProps; key: boolean } | undefined {
  const key = !!raw && typeof raw === 'object';
  const keys = key ? Object.keys(raw as object) : [];
  const text = typeof raw === 'string' ? raw : keys.length === 1 ? keys[0]! : '';
  const chain = parseChain(text);
  if (!chain) return undefined;
  const value = key ? (raw as Record<string, unknown>)[text] : undefined;
  return { chain, props: value && typeof value === 'object' ? (value as FlowProps) : value == null ? {} : { label: String(value) }, key };
}

function readFlow(flow: unknown): Read {
  const out: Read = { hops: [], names: [], bad: [] };
  if (!Array.isArray(flow)) return out;
  for (const [item, raw] of flow.entries()) {
    const read = readItem(raw);
    if (!read) {
      out.bad.push(item);
      continue;
    }
    const { chain, props, key } = read;
    for (const [i, n] of chain.names.entries()) {
      // Deleting the step takes its name and one arrow out of the chain: "a -> b -> c" stays "a -> c".
      const last = i === chain.names.length - 1;
      const cut: [number, number] = last ? [chain.names[i - 1]!.start + chain.names[i - 1]!.id.length, n.start + n.id.length] : [n.start, chain.names[i + 1]!.start];
      out.names.push({ ...n, item, key, count: chain.names.length - chain.names.filter((x) => x.id === n.id).length, cut });
    }
    for (const [n, a] of chain.arrows.entries()) {
      // What is written after the colon belongs to the first arrow: that is where a branch starts.
      const label = a.label ?? (n === 0 && props.label != null && props.label !== '' ? String(props.label) : undefined);
      out.hops.push({ from: chain.names[n]!.id, to: chain.names[n + 1]!.id, ...(label ? { label } : {}), message: a.message, default: n === 0 && props.default === true, item, n });
    }
  }
  return out;
}

/** A node written short: a kind, or else the lane it stands in. */
export function nodeShorthand(v: unknown): NodeEntry {
  if (v == null) return {};
  if (typeof v === 'object') return v as NodeEntry;
  return kindOf(v) ? { kind: String(v) } : { in: String(v) };
}

const reserved = (id: string) => (/^start$/i.test(id) ? 'start' : /^end$/i.test(id) ? 'end' : undefined);
/** What a name is when nothing says so: the events by their names, a question is a decision. */
const impliedKind = (id: string) => reserved(id) ?? (/\?\s*$/.test(id) ? 'decision' : 'task');

// ---------------------------------------------------------------- build

/** How much heavier the happy path is drawn. */
const HAPPY = 2;

export function buildProcess(src: ProcessSource, ctx: BuildContext): Graph {
  const lanes = new Map(Object.entries(src.lanes ?? {}).map(([id, v]) => [id, typeof v === 'string' ? { label: v } : (v ?? {})]));
  const { hops, names, bad } = readFlow(src.flow);
  for (const i of bad) ctx.error(['flow', i], 'A flow is steps with arrows between them: "a -> b -> c", "a -yes-> b", "a --> b" for a message, or "a -> b: label"');
  // Quotes around the whole item take what stands after the colon into the name of the step.
  for (const n of names) if (!n.key && /:\s/.test(n.id)) ctx.warn(['flow', n.item], `"${n.id}" is read as the name of a step: quote only what stands after the colon, like ${n.id.replace(/:\s+(.*)$/, ': "$1"')}`);

  // Steps in the order the flow names them, then what only `nodes:` knows.
  const entries = new Map(Object.entries(src.nodes ?? {}).map(([id, v]) => [id, nodeShorthand(v)]));
  const firstAt = new Map<string, number>();
  for (const n of names) if (!firstAt.has(n.id)) firstAt.set(n.id, n.item);
  const ids = [...firstAt.keys(), ...[...entries.keys()].filter((id) => !firstAt.has(id))];
  const at = (id: string): Path => (entries.has(id) ? ['nodes', id] : ['flow', firstAt.get(id) ?? 0]);

  // "Check request" and "check  request" are one step to a reader, two to the flow.
  const alike = new Map<string, string>();
  for (const id of ids) {
    const k = id.toLowerCase().replace(/\s+/g, ' ');
    if (alike.has(k)) ctx.warn(at(id), `"${id}" and "${alike.get(k)}" are two steps: write them the same way if they are one`);
    else alike.set(k, id);
  }

  const kind = new Map<string, string>();
  for (const id of ids) {
    const e = entries.get(id);
    const raw = src.nodes?.[id];
    if (typeof raw === 'string' && !kindOf(raw) && !lanes.has(raw)) ctx.error(['nodes', id], `"${raw}" is neither a kind nor a lane${lanes.size ? ` (lanes: ${[...lanes.keys()].join(', ')})` : ''}`);
    else if (typeof raw === 'string' && kindOf(raw) && lanes.has(raw)) ctx.warn(['nodes', id], `"${raw}" is a kind as well as a lane: read as the kind; write { in: ${raw} } for the lane`);
    else if (e?.in != null && !lanes.has(e.in)) ctx.error(['nodes', id, 'in'], lanes.size ? `There is no lane "${e.in}" (lanes: ${[...lanes.keys()].join(', ')})` : `There is no lane "${e.in}": add it under lanes:`);
    if (lanes.has(id)) ctx.error(at(id), `"${id}" is a lane and a step: give one of them another name`);
    kind.set(id, kindOf(e?.kind) ?? impliedKind(id));
  }
  const form = (id: string) => kinds[kind.get(id)!]!.form;
  const aside = (id: string) => form(id) === 'document' || form(id) === 'note';

  // A document or a note hangs on a step; a message crosses to another lane; the rest is the order of work.
  const assoc = (h: Hop) => aside(h.from) || aside(h.to);
  const seq = hops.filter((h) => !h.message && !assoc(h));
  const outs = (id: string) => seq.filter((h) => h.from === id);
  const ins = (id: string) => seq.filter((h) => h.to === id);

  // Lanes: as written, else the lane of the step before, else of the step after.
  const lane = new Map<string, string>();
  for (const id of ids) {
    const l = entries.get(id)?.in;
    if (l != null && lanes.has(l)) lane.set(id, l);
  }
  if (lanes.size) {
    for (const back of [false, true])
      for (let moved = true; moved; ) {
        moved = false;
        for (const h of hops.filter((x) => !x.message)) {
          const [known, open] = back ? [h.to, h.from] : [h.from, h.to];
          if (lane.has(known) && !lane.has(open)) (lane.set(open, lane.get(known)!), (moved = true));
        }
      }
    for (const id of ids) if (!lane.has(id)) lane.set(id, lanes.keys().next().value!);
  }

  // The happy path: the first line as written, carried on along the first way out of where it stops.
  const main: Hop[] = [];
  const stops = new Set<string>();
  const first = seq.filter((h) => h.item === seq[0]?.item);
  for (const h of first) {
    if (main.length && (main.at(-1)!.to !== h.from || stops.has(h.to))) break;
    main.push(h);
    stops.add(h.from).add(h.to);
  }
  for (let next = main.at(-1) && outs(main.at(-1)!.to).find((h) => !stops.has(h.to)); next; next = outs(next.to).find((h) => !stops.has(h.to))) {
    main.push(next);
    stops.add(next.to);
  }
  const onMain = new Set(main);
  const marked = src.happy !== false && seq.some((h) => !onMain.has(h));

  // ---------------------------------------------------------------- checks
  const entry = main[0]?.from ?? ids[0];
  const reached = new Set<string>();
  const starts = ids.filter((id) => !aside(id) && (id === entry || (form(id) === 'event' && !ins(id).length)));
  for (const queue = [...starts]; queue.length; ) {
    const id = queue.pop()!;
    if (reached.has(id)) continue;
    reached.add(id);
    queue.push(...hops.filter((h) => h.from === id).map((h) => h.to));
  }
  for (const id of ids) {
    const k = kind.get(id)!;
    const name = id;
    if (!firstAt.has(id)) ctx.warn(['nodes', id], `"${name}" is not in the flow: nothing leads to it or from it`);
    else if (!reached.has(id) && !aside(id) && !hops.some((h) => h.to === id)) ctx.warn(at(id), `Nothing leads to "${name}": the flow cannot get there`);
    if (form(id) === 'gateway' && outs(id).length < 2 && ins(id).length < 2 && firstAt.has(id))
      ctx.warn(at(id), k === 'decision' ? `"${name}" has one way out: a decision needs at least two, like "${name} -no-> …"` : `"${name}" neither splits nor joins: a gateway needs two ways out or two ways in`);
    if (k === 'decision' && outs(id).filter((h) => !h.label && !h.default).length > 1) ctx.warn(at(id), `"${name}" has ways out without a label: write "${name} -yes-> …" so a reader knows which is which`);
    if (k === 'end' && outs(id).length) ctx.warn(['flow', outs(id)[0]!.item], `"${name}" is an end, yet the flow goes on from it`);
    if (k === 'start' && ins(id).length) ctx.warn(['flow', ins(id)[0]!.item], `"${name}" is a start, yet the flow leads to it`);
  }
  const work = ids.filter((id) => !aside(id) && firstAt.has(id));
  if (work.length && !work.some((id) => !outs(id).length)) ctx.warn(['flow'], 'This process has no end: every step leads on to another');
  else if (work.some((id) => form(id) === 'event' && !outs(id).length && ins(id).length))
    for (const id of work) if (form(id) !== 'event' && !outs(id).length && ins(id).length) ctx.warn(at(id), `"${id}" leads nowhere, while other paths reach an end: add "${id} -> end"`);

  // ---------------------------------------------------------------- graph
  const groups: GraphGroup[] = [...lanes].map(([id, l]) => {
    const links = parseLinks(l.links);
    return { id, label: l.label ?? id, tone: l.tone ?? 'slate', border: 'solid', lane: true, kind: 'lane', ...(links ? { links } : {}), ...(l.description ? { description: l.description } : {}), path: ['lanes', id] };
  });
  const labelOf = (id: string) => {
    const e = entries.get(id);
    const quiet = reserved(id) || (form(id) === 'gateway' && kind.get(id) !== 'decision');
    return e?.label ?? (quiet ? '' : id);
  };
  const nodes: GraphNode[] = ids.map((id) => {
    const e = entries.get(id) ?? {};
    const k = kinds[kind.get(id)!]!;
    const links = parseLinks(e.links);
    // An event is what it is by where it stands: nothing before it starts the process, nothing after it ends it.
    const mark = k.form === 'event' ? (k.mark ?? (!ins(id).length ? 'start' : !outs(id).length ? 'end' : 'mid')) : k.mark;
    const icon = e.icon ?? k.inside;
    const shape: FlowShape = { kind: 'flow', form: k.form, label: labelOf(id), ...(e.caption ? { caption: e.caption } : {}), ...(icon ? { icon } : {}), tone: e.tone ?? k.tone, ...(mark ? { mark } : {}) };
    return { id, ...(lane.has(id) ? { parent: lane.get(id)! } : {}), shape, kind: kind.get(id)!, ...(links ? { links } : {}), ...(e.description ? { description: e.description } : {}), ...(e.tags?.length ? { tags: e.tags } : {}), path: ['nodes', id] };
  });
  const edgeId = (h: Hop) => `flow${h.item}${h.n ? `.${h.n}` : ''}`;
  const edges: GraphEdge[] = hops.map((h) => ({
    id: edgeId(h),
    from: { node: h.from },
    to: { node: h.to },
    ...(h.label ? { label: h.label } : {}),
    line: assoc(h) ? 'dotted' : h.message ? 'dashed' : 'solid',
    start: h.default ? 'slash' : 'none',
    end: form(h.from) === 'note' || form(h.to) === 'note' ? 'none' : 'arrow',
    ...(assoc(h) ? { kind: 'Association' } : h.message ? { kind: 'Message' } : {}),
    ...(marked && onMain.has(h) ? { width: HAPPY } : {}),
    path: ['flow', h.item],
  }));

  const title = (id: string) => labelOf(id) || kinds[kind.get(id)!]!.label;
  const walk: GraphBeat[] = main.length
    ? [{ title: title(main[0]!.from), nodes: [main[0]!.from], edges: [] }, ...main.map((h) => ({ title: title(h.to), ...(h.label ? { caption: `${title(h.from)} ${h.label}` } : {}), nodes: [h.to], edges: [edgeId(h)] }))]
    : [];
  // The heavier happy path only means something next to the other ways through: the key names both.
  const legend: LegendItem[] = [...(marked ? [{ label: 'Happy path', line: 'solid' as const, width: HAPPY }, { label: 'Other paths', line: 'solid' as const }] : []), ...(hops.some((h) => h.message && !assoc(h)) ? [{ label: 'Message', line: 'dashed' as const }] : [])];

  return {
    ...(src.title ? { title: src.title } : {}),
    ...(src.subtitle ? { subtitle: src.subtitle } : {}),
    direction: src.direction ?? 'right',
    groups,
    nodes,
    edges,
    ...(legend.length ? { legend } : {}),
    ...(walk.length ? { walk } : {}),
  };
}

/** Every place a step or a lane is named, so renames and deletes follow. */
export function processReferences(src: ProcessSource): Reference[] {
  const out: Reference[] = [];
  const lanes = new Set(Object.keys(src.lanes ?? {}));
  for (const [id, raw] of Object.entries(src.nodes ?? {})) {
    if (typeof raw === 'string' && lanes.has(raw) && !kindOf(raw)) out.push({ path: ['nodes', id], id: raw, start: 0, collection: 'lanes', onDelete: 'key' });
    else if (raw && typeof raw === 'object' && typeof raw.in === 'string' && lanes.has(raw.in)) out.push({ path: ['nodes', id, 'in'], id: raw.in, start: 0, collection: 'lanes', onDelete: 'key' });
  }
  // A chain that still says something without the step loses the step alone; "a -> b" goes whole.
  for (const n of readFlow(src.flow).names) out.push({ path: ['flow', n.item], ...(n.key ? { key: true } : {}), id: n.id, start: n.start, collection: 'nodes', ...(n.count > 1 ? { onDelete: 'cut' as const, cut: n.cut, among: n.count + 1 } : {}) });
  return out;
}

// ---------------------------------------------------------------- one line of a chain, for the builder

const arrowText = (a: Chain['arrows'][number]) => (a.message ? (a.label ? ` --${a.label}--> ` : ' --> ') : a.label ? ` -${a.label}-> ` : ' -> ');
/** A chain as the shortest item that says it: the text, "text: label" or "text: { label, default }". */
function itemFor(names: string[], arrows: Chain['arrows'], props: FlowProps = {}): unknown {
  const text = names.map((n, i) => (i ? arrowText(arrows[i - 1]!) : '') + n).join('');
  const label = props.label != null && props.label !== '' && !arrows[0]?.label ? props.label : undefined;
  return props.default ? { [text]: { ...(label != null ? { label } : {}), default: true } } : label != null ? { [text]: label } : text;
}
/** A label short and plain enough to stand in its arrow: "-yes->". */
const inArrow = (label: string) => /^[^-\s>]([^>]*[^-\s>])?$/.test(label) && label.length <= 16;

/** The chain a drawn line is part of, and which of its arrows it is. */
function lineOf(src: ProcessSource, edge: string) {
  const m = /^flow(\d+)(?:\.(\d+))?$/.exec(edge);
  const read = m && readItem(src.flow?.[Number(m[1])]);
  const n = Number(m?.[2] ?? 0);
  if (!m || !read || n >= read.chain.arrows.length) return undefined;
  return { item: Number(m[1]), n, names: read.chain.names.map((x) => x.id), arrows: read.chain.arrows.map((a) => ({ ...a })), props: read.props };
}

const lines: NonNullable<DiagramType<ProcessSource>['lines']> = {
  hint: 'Short, like yes or no; a longer one is written after the line',
  label(src, edge, label) {
    const at = lineOf(src, edge);
    if (!at) return undefined;
    const { item, n, names, arrows, props } = at;
    const text = label.trim().replace(/\s+/g, ' ');
    delete arrows[n]!.label;
    const first: FlowProps = n === 0 ? (props.default ? { default: true } : {}) : props;
    if (!text || inArrow(text)) {
      if (text) arrows[n]!.label = text;
      return { path: ['flow', item], items: [itemFor(names, arrows, first)] };
    }
    // A sentence reads better after the colon, and that belongs to the first arrow of a line.
    if (n === 0) return { path: ['flow', item], items: [itemFor(names, arrows, { ...first, label: text })] };
    return { path: ['flow', item], items: [itemFor(names.slice(0, n + 1), arrows.slice(0, n), props), itemFor(names.slice(n), arrows.slice(n), { label: text })] };
  },
  remove(src, edge) {
    const at = lineOf(src, edge);
    if (!at) return undefined;
    const { item, n, names, arrows, props } = at;
    const before = n > 0 ? [itemFor(names.slice(0, n + 1), arrows.slice(0, n), props)] : [];
    const after = n + 2 < names.length ? [itemFor(names.slice(n + 1), arrows.slice(n + 1))] : [];
    return { path: ['flow', item], items: [...before, ...after] };
  },
};

// ---------------------------------------------------------------- schema

const kindNames = [...Object.keys(kinds), ...Object.keys(aliases)];
const node = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'What it says (default: its name in the flow)' },
    kind: { enum: kindNames, description: 'task (default), user, service, manual, script, subprocess; decision, parallel, inclusive, event-based; start, end, timer, message, error, signal; document, note' },
    in: { type: 'string', description: 'The lane; without it the step stands in the lane of the step before it' },
    caption: { type: 'string', description: 'A second line in a task: who, how long, with what' },
    icon: { type: 'string', description: 'Lucide icon name, instead of the kind’s own' },
    tone: { enum: tones },
    description: { type: 'string', description: 'Longer text, shown as a tooltip' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Free words that steps select with tag:name' },
    links: linksSchema,
  },
  additionalProperties: false,
};
const flowText = '"a -> b -> c"; "a -yes-> b" with a label; "a --> b" for a message';
const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Cartography process',
  type: 'object',
  required: ['type'],
  properties: {
    type: { const: 'process' },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    direction: { enum: ['right', 'down'], description: 'Which way the flow runs: right (default, lanes as rows) or down (lanes as columns)' },
    happy: { type: 'boolean', description: 'false: do not draw the happy path (the first line of flow) heavier' },
    lanes: {
      type: 'object',
      description: 'Who does the work: a band per role or system, in this order',
      additionalProperties: {
        anyOf: [{ type: 'string', description: 'Its name' }, { type: 'null' }, { type: 'object', properties: { label: { type: 'string' }, tone: { enum: tones }, description: { type: 'string' }, links: linksSchema }, additionalProperties: false }],
      },
    },
    nodes: {
      type: 'object',
      description: 'What the flow cannot say itself: a step’s lane, kind or label. The key is the name used in the flow',
      additionalProperties: { anyOf: [{ type: 'string', description: 'A kind (user, end, timer…) or a lane' }, { type: 'null' }, node] },
    },
    flow: {
      type: 'array',
      description: 'The steps in order, the happy path first',
      items: {
        anyOf: [
          { type: 'string', pattern: '\\s--?([^-\\s>]([^>]*[^-\\s>])?--?)?>\\s', description: flowText },
          {
            type: 'object',
            minProperties: 1,
            maxProperties: 1,
            additionalProperties: {
              anyOf: [
                { type: ['string', 'number', 'null'], description: 'The label of the (first) arrow' },
                { type: 'object', properties: { label: { type: ['string', 'number'], description: 'Text at the start of the line' }, default: { type: 'boolean', description: 'The way out when no other applies: drawn with a slash' } }, additionalProperties: false },
              ],
            },
          },
        ],
      },
    },
  },
  additionalProperties: false,
};

const palette: PaletteItem[] = [
  ...Object.entries(kinds).map(([kind, k]) => ({ collection: 'nodes', kind, label: k.label, icon: k.icon, tone: k.tone, ...(k.keywords ? { keywords: k.keywords } : {}) })),
  { collection: 'lanes', kind: 'lane', label: 'Lane', icon: 'rows-3', tone: 'slate', keywords: ['swimlane', 'role', 'pool', 'actor', 'department'] },
];

export const process: DiagramType<ProcessSource> = {
  id: 'process',
  name: 'Process',
  description: 'Who does what in which order: tasks, decisions, events and parallel work in swimlanes per role, or without lanes as a flowchart',
  icon: 'workflow',
  tagline: 'Who does what, in which order, and where it branches',
  useWhen: ['An approval or request process with roles in swimlanes', 'A decision flowchart: yes or no, and what follows', 'An incident or release procedure with a manual gate', 'Order to cash: the work between departments'],
  notFor: [
    { text: 'The states one thing can be in', use: 'states' },
    { text: 'Messages between systems, call by call', use: 'sequence' },
    { text: 'How one person experiences it', use: 'journey' },
    { text: 'The systems themselves and how they connect', use: 'systems' },
  ],
  keywords: ['process', 'flowchart', 'flow chart', 'workflow', 'bpmn', 'swimlane', 'swim lane', 'decision', 'decision tree', 'approval', 'procedure', 'runbook', 'business process', 'gateway', 'happy path', 'activity diagram', 'who does what', 'handover', 'steps'],
  schema,
  palette,
  template: `type: process
title: Access request
subtitle: From request to access, approved by the line manager

lanes:
  employee: Employee
  manager: Line manager
  it: IT service desk

nodes:
  Request access: { in: employee, kind: user }
  Check request: { in: manager, kind: user }
  Grant access: { in: it, kind: service }
  Confirm access: employee
  Explain why: manager
  Request rejected: end

flow:
  - start -> Request access -> Check request -> Approved? -yes-> Grant access -> Confirm access -> end
  - Approved? -no-> Explain why -> Request rejected
`,
  build: buildProcess,
  references: processReferences,
  connect(src, from, to) {
    const lanes = src.lanes ?? {};
    if (Object.hasOwn(lanes, from) || Object.hasOwn(lanes, to)) return 'Connect one step to another: a lane holds steps, it is not part of the flow';
    if (from === to) return 'Pick another step to connect to';
    const { hops } = readFlow(src.flow);
    if (hops.some((h) => h.from === from && h.to === to)) return 'They are already connected';
    const kind = (id: string) => kindOf(nodeShorthand(src.nodes?.[id]).kind) ?? impliedKind(id);
    if (kind(from) === 'end') return 'An end has no way out: connect to it instead';
    if (kind(to) === 'start') return 'Nothing leads to a start: connect from it instead';
    // The ways out of a decision have names: the first is yes, the second no.
    const taken = new Set(hops.filter((h) => h.from === from).map((h) => h.label?.toLowerCase()));
    const label = kind(from) === 'decision' ? ['yes', 'no'].find((l) => !taken.has(l)) : undefined;
    return { path: ['flow'], value: label ? `${from} -${label}-> ${to}` : `${from} -> ${to}` };
  },
  shorthand(collection, value) {
    if (collection === 'nodes') return nodeShorthand(value) as Record<string, unknown>;
    return undefined;
  },
  refKeys: { in: ['lanes'] },
  freeNames: true,
  lines,
  layout: async (sized) => flowLayout(sized),
};

export { flowLayout } from './layout.ts';
