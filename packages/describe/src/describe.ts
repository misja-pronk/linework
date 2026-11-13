// A diagram in plain words, made from its model and nothing else (no AI): what it shows, what is in
// it, what connects to what in reading order, its steps, layers, trust boundaries and key. Each kind of drawing
// is told the way a person would tell it: a sequence as its messages in order, a database as its
// tables and how they relate, a matrix row by row, a journey phase by phase, a roadmap lane by lane,
// an org chart as who reports to whom. Kept short: someone should grasp the drawing in half a minute.
import { term } from '@cartography/i18n/drawing';
import { type GraphEdge, type Graph, type GraphGroup, type GraphNode, type LegendItem, type Marker, type StepState } from '@cartography/core';
import type { BlockShape, GitflowShape, JourneyShape, JourneyStep, MatrixShape, RoadmapShape, SequenceShape, TableShape } from '@cartography/core';
import type { Description, Item, Section } from './text.ts';
import { listWords as joinWords, lookup, translator, type Lang, type Params } from '@cartography/i18n';
import { nl, words } from './nl.ts';

/** What render() returns, or anything else that carries a built graph: describe(result) works as is. */
export interface DescribeInput {
  /** The language to tell it in: the diagram's `lang:` (render's). English by default. */
  lang?: Lang;
  graph?: Graph;
  /** The diagram type: its name says what kind of drawing it is. */
  type?: { id: string; name: string };
  /** The steps as resolved (render's), told as a walkthrough unless nobody wrote them. */
  steps?: StepState[];
  stepsImplied?: boolean;
  /** The diagram's layers (render's `layers.list`). */
  layers?: { list: { name: string; title?: string; caption?: string; tags: string[]; count?: number }[] };
  /** The view drawn, and the views there are: a view's title says what this drawing is. */
  view?: string;
  views?: { name: string; title?: string }[];
  /** The file, for a title when the diagram has none. */
  name?: string;
}

// The language of the description being made: set by describe() for the length of one call (it is
// synchronous), so the helpers below say their words in it without each taking it along.
let L: Lang = 'en';
const tr = translator(nl);
const said = lookup(words);
/** One of the description's sentences or phrases, in its language. */
const d = (id: keyof typeof nl, params?: Params) => tr(L, id, params);
/** A word from one of the tables below (a flow mark, a key's sample), in the description's language. */
const w = (text: string) => said(L, text);

/** "3 elements"; the noun in the description's language (./nl.ts `words` has each "one|many"). */
const plural = (n: number, one: string, many = `${one}s`) => {
  const own = L === 'nl' ? words[`${one}|${many}`]?.split('|') : undefined;
  return `${n} ${n === 1 ? (own?.[0] ?? one) : (own?.[1] ?? many)}`;
};
/** "a, b and c" ("a, b en c"). */
export const listWords = (xs: string[]) => joinWords(L, xs);
const sentence = (s: string) => (s && !/[.!?:…]["”')]*$/.test(s) ? `${s}.` : s);
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);
const clean = (s: string | undefined) => s?.replace(/\s+/g, ' ').trim() || undefined;

export function describe(input: DescribeInput): Description {
  const before = L;
  L = input.lang ?? 'en';
  try {
    return describeIn(input);
  } finally {
    L = before;
  }
}

function describeIn(input: DescribeInput): Description {
  const graph = input.graph ?? { direction: 'right', groups: [], nodes: [], edges: [] };
  const view = input.view ? input.views?.find((v) => v.name === input.view) : undefined;
  const title = clean(graph.title) ?? clean(view?.title) ?? input.name?.replace(/\.ya?ml$/i, '') ?? input.type?.name ?? d('Diagram');
  const kind = kindWords(input, graph);
  const s = shapes(graph);
  const told: Told =
    s.sequence ? tellSequence(s.sequence)
    : s.gitflow ? tellGitflow(s.gitflow)
    : s.roadmap ? tellRoadmap(s.roadmap)
    : s.journey ? tellJourney(s.journey)
    : s.blocks.length ? tellBlocks(graph, s.blocks)
    : s.tables.length && s.tables.length === nodesOf(graph).length ? tellTables(graph, s.tables)
    : s.matrices.length && s.matrices.length === nodesOf(graph).length ? tellMatrices(graph, s.matrices)
    : tellGraph(graph, input.type?.id);
  const about = clean(graph.subtitle);
  const summary = [`${kind}${about ? `: ${sentence(about)}` : '.'}`, told.size ? sentence(told.size) : ''].filter(Boolean).join(' ');
  const sections = [...told.sections, ...walkthrough(graph, input), ...layerSection(input), ...trustSection(graph), ...keySection(graph)];
  return { title, summary, ...(told.size ? { size: told.size } : {}), sections: sections.filter((x) => x.text || x.items?.length) };
}

interface Told {
  /** How big, in a few words: "8 elements in 2 groups, with 7 connections". */
  size?: string;
  sections: Section[];
}

/** "Architecture diagram", "Sequence diagram", "Org chart": what a reader is looking at. */
function kindWords(input: DescribeInput, graph: Graph): string {
  const own = input.view ? input.views?.find((v) => v.name === input.view)?.title : undefined;
  const name = (L === 'nl' && input.type ? words[`type:${input.type.id}`] : undefined) ?? input.type?.name ?? d('Diagram');
  // A type with several drawings (teams: org chart or topology) says which one by its view.
  const blocks = graph.nodes.flatMap((n) => (n.shape.kind === 'block' ? [n.shape.form] : []));
  if (input.type?.id === 'teams') return blocks.includes('person') ? d('Org chart') : d('Team topology');
  if (own && input.type && !own.includes('—') && own.length < 40 && !own.toLowerCase().includes(graph.title?.toLowerCase() ?? '\u0000')) return `${name}, ${lowerFirst(own)}`;
  return L === 'nl' || /diagram|map|chart|design|matrix|timeline|flow|model/i.test(name) ? name : `${name} diagram`;
}

const nodesOf = (graph: Graph) => graph.nodes.filter((n) => !n.folded && n.shape.kind !== 'journey-part');

function shapes(graph: Graph) {
  const pick = <K extends GraphNode['shape']['kind']>(k: K) => graph.nodes.filter((n) => n.shape.kind === k) as (GraphNode & { shape: Extract<GraphNode['shape'], { kind: K }> })[];
  return {
    sequence: pick('sequence')[0]?.shape,
    gitflow: pick('gitflow')[0]?.shape,
    roadmap: pick('roadmap')[0]?.shape,
    journey: pick('journey')[0]?.shape,
    blocks: pick('block'),
    tables: pick('table'),
    matrices: pick('matrix'),
  };
}

// ------------------------------------------------------------------ names

const FLOW_WORDS: Record<string, string> = {
  start: 'start event',
  end: 'end event',
  mid: 'intermediate event',
  xor: 'decision',
  and: 'parallel split or join',
  or: 'inclusive decision',
  event: 'event-based decision',
  initial: 'start',
  final: 'end',
  choice: 'choice',
  history: 'history',
};

/** What an element is called in words; a gateway or pseudo-state without a name by what it is. */
export function nameOf(n: GraphNode | GraphGroup | undefined, fallback = ''): string {
  if (!n) return fallback;
  if (!('shape' in n)) return clean(n.label) ?? n.id;
  const s = n.shape;
  switch (s.kind) {
    case 'card':
    case 'block':
    case 'journey-part':
      return clean(s.label) ?? n.id;
    case 'flow': {
      if (clean(s.label)) return clean(s.label)!;
      // A process names its gateways by id ("Approved?"); a state machine's start is just "start".
      const what = w(FLOW_WORDS[s.mark ?? ''] ?? s.form);
      const own = n.id.replace(/^.*\./, '');
      if (s.form === 'pseudo') {
        const inside = n.id.includes('.') ? n.id.split('.').slice(0, -1).join('.') : '';
        return `${what[0]!.toUpperCase()}${what.slice(1)}${inside ? d(' of {name}', { name: inside }) : ''}`;
      }
      return own && !/^(start|end|n?\d+)$/i.test(own) ? own : `${what[0]!.toUpperCase()}${what.slice(1)}`;
    }
    case 'table':
      return clean(s.title) ?? n.id;
    case 'matrix':
      return clean(s.corner) ?? d('Table');
    default:
      return n.id;
  }
}

/** The short "what it is" after a name: its kind or caption, a gateway's role, "external". */
function detailOf(n: GraphNode): string[] {
  const s = n.shape;
  const out: string[] = [];
  if (s.kind === 'card') {
    // C4 writes its kinds in brackets: "[Container: Spring Boot]".
    if (s.caption) out.push(s.caption.replace(/^\[(.*)\]$/, '$1'));
    if (s.muted) out.push(d('external'));
    if (s.stack && !/\b(ha|pair|stack|cluster|redundant)\b/i.test(s.caption ?? '')) out.push(d('a redundant pair'));
  } else if (s.kind === 'flow') {
    const what = w(FLOW_WORDS[s.mark ?? ''] ?? s.form);
    // "timer intermediate event"; a kind the words already say ("decision decision") once.
    const own = n.kind && !['start', 'end', 'message', 'none'].includes(n.kind) ? w(n.kind) : '';
    const kindWord = own && !what.toLowerCase().split(' ').includes(own.toLowerCase()) ? own : '';
    if (s.form === 'gateway' || s.form === 'event') out.push(clean(s.label) || s.form === 'event' ? [kindWord, what].filter(Boolean).join(' ') : what);
    else if (s.form === 'subprocess' || s.form === 'document' || s.form === 'note') out.push(w(s.form));
    if (s.caption) out.push(s.caption);
  } else if (s.kind === 'table' && s.caption) out.push(s.caption);
  return out;
}

/** Name, what it is, and what it says about itself: "Storefront (Web app): the shop's web front". */
function elementText(n: GraphNode): string {
  const s = n.shape;
  const detail = detailOf(n).filter((d, i, all) => d.toLowerCase() !== nameOf(n).toLowerCase() && all.findIndex((x) => x.toLowerCase() === d.toLowerCase()) === i);
  const said = [s.kind === 'card' ? s.body : undefined, n.description, s.kind === 'flow' && s.lines?.length ? s.lines.join('; ') : undefined].map(clean).filter((x): x is string => !!x);
  const unique = said.filter((x, i) => said.indexOf(x) === i);
  const marks = n.marks?.length ? [d('tagged {ids}', { ids: n.marks.join(', ') })] : [];
  const badges = s.kind === 'card' && s.badges?.length ? [d('with {names}', { names: listWords(s.badges) })] : [];
  return `${nameOf(n)}${detail.length ? ` (${detail.join(', ')})` : ''}${[...unique, ...badges, ...marks].length ? `: ${[...unique, ...badges, ...marks].join('; ')}` : ''}`;
}

function groupText(g: GraphGroup): string {
  const detail = [g.caption?.replace(/^\[(.*)\]$/, '$1'), g.lane ? d('lane') : '', g.trust ? d('trust boundary') : ''].filter((x, i, all): x is string => !!x && x.toLowerCase() !== g.label.toLowerCase() && all.findIndex((y) => y?.toLowerCase() === x.toLowerCase()) === i);
  const said = [clean(g.description), g.marks?.length ? d('tagged {ids}', { ids: g.marks.join(', ') }) : ''].filter(Boolean);
  return `${nameOf(g)}${detail.length ? ` (${detail.join(', ')})` : ''}${said.length ? `: ${said.join('; ')}` : ''}`;
}

// ------------------------------------------------------------------ elements and connections

/** Elements in the order a reader meets them: from where the lines start, along them, then the rest as written. */
function readingOrder(graph: Graph): Map<string, number> {
  const ids = [...graph.nodes.filter((n) => !n.folded).map((n) => n.id), ...graph.groups.map((g) => g.id)];
  const known = new Set(ids);
  const out = new Map<string, number>();
  const next = new Map<string, string[]>();
  const into = new Map<string, number>();
  for (const e of graph.edges) {
    if (!known.has(e.from.node) || !known.has(e.to.node) || e.from.node === e.to.node) continue;
    next.set(e.from.node, [...(next.get(e.from.node) ?? []), e.to.node]);
    if (!e.loose) into.set(e.to.node, (into.get(e.to.node) ?? 0) + 1);
  }
  const visit = (start: string) => {
    const queue = [start];
    while (queue.length) {
      const id = queue.shift()!;
      if (out.has(id)) continue;
      out.set(id, out.size);
      queue.push(...(next.get(id) ?? []));
    }
  };
  // Where lines start first (nothing comes in), then anything with lines out, then what is left.
  for (const id of ids) if (next.has(id) && !into.get(id)) visit(id);
  for (const id of ids) if (next.has(id)) visit(id);
  for (const id of ids) visit(id);
  return out;
}

/** The elements as a tree of groups, each part in reading order. */
function elementTree(graph: Graph, order: Map<string, number>): Item[] {
  const nodes = graph.nodes.filter((n) => !n.folded);
  const at = (id: string): number => {
    // A group sits where its first element is met.
    const own = order.get(id) ?? Infinity;
    const inner = [...nodes.filter((n) => n.parent === id).map((n) => order.get(n.id) ?? Infinity), ...graph.groups.filter((g) => g.parent === id).map((g) => at(g.id))];
    return Math.min(own, ...inner);
  };
  const groups = new Set(graph.groups.map((g) => g.id));
  const level = (parent: string | undefined): Item[] => {
    const here: { at: number; item: Item }[] = [
      ...graph.groups.filter((g) => (g.parent && groups.has(g.parent) ? g.parent : undefined) === parent).map((g) => ({ at: at(g.id), item: { text: groupText(g), items: level(g.id) } })),
      ...nodes.filter((n) => (n.parent && groups.has(n.parent) ? n.parent : undefined) === parent).map((n) => ({ at: order.get(n.id) ?? Infinity, item: { text: elementText(n) } })),
    ];
    return here.sort((a, b) => a.at - b.at).map((x) => (x.item.items?.length ? x.item : { text: x.item.text }));
  };
  return level(undefined);
}

const PROTOCOL = /^(https?|tls|mtls|ssh|sftp|ftps?|vpn|ipsec|grpc|mqtt|amqp|tcp|udp|websockets?|wss?|smb|nfs|rdp|bgp|ldaps?|smtp|imap)\b/i;
/** A label that is itself a verb phrase ("Uses", "Reads and writes"), as C4 relations are written. */
const VERB = /^(uses|calls|reads|writes|reads and writes|reads from|writes to|reads from and writes to|depends on|notifies|triggers|invokes|polls|queries|subscribes to|publishes to|sends to|routes to|forwards to)$/i;

/** Plural subjects take a plural verb: "Users call Storefront". */
const isPlural = (n: GraphNode | GraphGroup | undefined) => !!n && 'kind' in n && /^(users|people|persons|customers|actors|staff|employees|members|visitors)$/i.test(n.kind ?? '') && /s$/i.test(nameOf(n));

const PLURAL: Record<string, string> = { mounts: 'mount', moves: 'move', leads: 'lead', sends: 'send', calls: 'call', signs: 'sign', depends: 'depend', gets: 'get', connects: 'connect', is: 'are' };

/**
 * A line that says who may do what (an access diagram's, github's Member of, the azure type's Role
 * assignment), by its kind: "is Contributor on rg-shop", "applies to sg-tier0-admins".
 */
function accessClause(e: GraphEdge, to: string, plural: boolean): string | undefined {
  const label = clean(e.label);
  const p = { to, label: label ?? '', over: label ? ` (${label})` : '', count: plural ? 2 : 1 };
  switch ((e.kind ?? '').toLowerCase()) {
    case 'holds':
      return d('holds {to}|hold {to}', p);
    case 'grants':
      return d('grants {to}{over}|grant {to}{over}', p);
    case 'member of':
      return d('is a member of {to}|are members of {to}', p);
    case 'owns':
      return d('owns {to}|own {to}', p);
    case 'service principal':
      return d('has the service principal {to}|have the service principal {to}', p);
    case 'federated credential of':
      return d('is a federated credential of {to}|are federated credentials of {to}', p);
    case 'role assignment':
      return label ? d('is {label} on {to}|are {label} on {to}', p) : d('holds a role on {to}|hold a role on {to}', p);
    case 'eligible': {
      // In full from its parts: the label says "Owner · 4 h · approval" in short.
      const pim = e.eligible;
      if (!pim) return label ? d('can activate {label} on {to}|can activate {label} on {to}', p) : d('can activate a role on {to}|can activate a role on {to}', p);
      const time = pim.activation ? d(' for at most {time}', { time: pim.activation }) : '';
      const approval = pim.approval ? d(', with approval by {names}', { names: pim.approval }) : '';
      return d('can activate {label} on {to}{time}{approval}|can activate {label} on {to}{time}{approval}', { ...p, label: pim.role, time, approval });
    }
    case 'applies to':
      return d('applies to {to}|apply to {to}', p);
    case 'excludes':
      return d('excludes {to}|exclude {to}', p);
    case 'requires':
      return d('requires {to}|require {to}', p);
    case 'location condition':
      return d('checks the location {to}|check the location {to}', p);
    case 'covers':
      return d('covers {to}|cover {to}', p);
  }
  return undefined;
}

/** One line as a clause after its source: "calls Orders API (REST)", "sends OrderPlaced to order-events". */
function clause(e: GraphEdge, to: string, plural: boolean, flow: 'process' | 'states' | undefined): string {
  const access = flow ? undefined : accessClause(e, to, plural);
  if (access) return access;
  if (L !== 'en') return clauseSaid(e, to, plural, flow);
  const label = clean(e.label);
  const s = (verb: string) => (plural ? (PLURAL[verb] ?? verb) : verb);
  const over = label && PROTOCOL.test(label) ? ` over ${label}` : label ? ` (${label})` : '';
  if (flow === 'states') return `${s('moves')} to ${to}${label ? ` on ${label}` : ''}`;
  if (flow === 'process') return `${s('leads')} to ${to}${label ? ` (${label})` : ''}`;
  const kind = (e.kind ?? '').toLowerCase();
  const both = e.start !== 'none' && e.end !== 'none' && e.start === e.end;
  const none = e.start === 'none' && e.end === 'none';
  // A message's label names the message (OrderPlaced), unless it says what happens ("Publishes [Kafka]", as C4 writes it).
  const said = !!label && /^[A-Z]?[a-z]+s\b/.test(label);
  if (/async|message|event|publish/.test(kind)) return label && !PROTOCOL.test(label) && !said ? `${s('sends')} ${label} to ${to}` : `${s('sends')} messages to ${to}${over}`;
  if (/data|replicat|backup|etl/.test(kind)) return `${s('sends')} data to ${to}${over}`;
  if (/request|call|sync|api/.test(kind)) return `${s('calls')} ${to}${over}`;
  if (/identity|auth|login/.test(kind)) return `${s('signs')} in with ${to}${over}`;
  if (/depend|uses/.test(kind)) return `${s('depends')} on ${to}${over}`;
  if (/secret|key/.test(kind)) return `${s('gets')} secrets from ${to}${over}`;
  if (/traffic|route/.test(kind)) return `${s('sends')} traffic to ${to}${over}`;
  if (/mount|volume/.test(kind)) return `${s('mounts')} ${to}${over}`;
  if (/scale/.test(kind)) return `${s('is')} scaled by ${to}${over}`;
  if (/monitor|telemetry|log|metric/.test(kind)) return `${s('sends')} telemetry to ${to}${over}`;
  if (label && VERB.test(label)) return `${lowerFirst(label)} ${to}`;
  if (kind) return `${s('connects')} to ${to} (${e.kind}${label ? `: ${label}` : ''})`;
  if (both || none) return `${s('is')} linked with ${to}${label ? ` (${label})` : ''}`;
  return `${s('connects')} to ${to}${over}`;
}

/** clause() in another language than English: the same cases, each a message whose two forms are for one subject and for more ("Users call"). */
function clauseSaid(e: GraphEdge, to: string, plural: boolean, flow: 'process' | 'states' | undefined): string {
  const label = clean(e.label);
  const over = label && PROTOCOL.test(label) ? d(' over {label}', { label }) : label ? ` (${label})` : '';
  const p = { to, over, label: label ?? '', count: plural ? 2 : 1 };
  if (flow === 'states') return label ? d('moves to {to} on {label}|move to {to} on {label}', p) : d('moves to {to}|move to {to}', p);
  if (flow === 'process') return d('leads to {to}{over}|lead to {to}{over}', { ...p, over: label ? ` (${label})` : '' });
  const kind = (e.kind ?? '').toLowerCase();
  const both = e.start !== 'none' && e.end !== 'none' && e.start === e.end;
  const none = e.start === 'none' && e.end === 'none';
  const said = !!label && /^[A-Z]?[a-z]+s\b/.test(label);
  if (/async|message|event|publish/.test(kind)) return label && !PROTOCOL.test(label) && !said ? d('sends {label} to {to}|send {label} to {to}', p) : d('sends messages to {to}{over}|send messages to {to}{over}', p);
  if (/data|replicat|backup|etl/.test(kind)) return d('sends data to {to}{over}|send data to {to}{over}', p);
  if (/request|call|sync|api/.test(kind)) return d('calls {to}{over}|call {to}{over}', p);
  if (/identity|auth|login/.test(kind)) return d('signs in with {to}{over}|sign in with {to}{over}', p);
  if (/depend|uses/.test(kind)) return d('depends on {to}{over}|depend on {to}{over}', p);
  if (/secret|key/.test(kind)) return d('gets secrets from {to}{over}|get secrets from {to}{over}', p);
  if (/traffic|route/.test(kind)) return d('sends traffic to {to}{over}|send traffic to {to}{over}', p);
  if (/mount|volume/.test(kind)) return d('mounts {to}{over}|mount {to}{over}', p);
  if (/scale/.test(kind)) return d('is scaled by {to}{over}|are scaled by {to}{over}', p);
  if (/monitor|telemetry|log|metric/.test(kind)) return d('sends telemetry to {to}{over}|send telemetry to {to}{over}', p);
  if (kind) return d('connects to {to} ({kind})|connect to {to} ({kind})', { ...p, kind: `${term(L, e.kind!)}${label ? `: ${label}` : ''}` });
  if (both || none) return d('is linked with {to}{over}|are linked with {to}{over}', { ...p, over: label ? ` (${label})` : '' });
  return d('connects to {to}{over}|connect to {to}{over}', p);
}

/** The ends of a line as tags say them (a context map's U and D): "upstream, open host service". */
function endsText(tags: string[] | undefined, legend: Map<string, string>): string {
  return tags?.length ? tags.map((t) => legend.get(t) ?? t).join(', ') : '';
}

function connectionItems(graph: Graph, order: Map<string, number>, flow?: 'process' | 'states'): Item[] {
  const byId = new Map<string, GraphNode | GraphGroup>([...graph.groups.map((g) => [g.id, g] as const), ...graph.nodes.map((n) => [n.id, n] as const)]);
  // Two elements with one name (a Service and a Deployment both called web) are told apart by their kind.
  const count = new Map<string, number>();
  for (const x of byId.values()) count.set(nameOf(x), (count.get(nameOf(x)) ?? 0) + 1);
  const kindOf = (x: GraphNode | GraphGroup | undefined) => (x && 'shape' in x && x.shape.kind === 'card' ? x.shape.caption?.split(' · ')[0] : x && !('shape' in x) ? x.caption : undefined);
  // A line that ends on a table's row (a data product's port) names the row by what it says, not by
  // its id (in:0); and not at all when that is only the element's name or the other end's again.
  const rowName = (id: string, row: string | undefined, other?: string) => {
    const x = byId.get(id);
    const r = x && 'shape' in x && x.shape.kind === 'table' ? x.shape.rows.find((t) => t.kind === 'row' && t.id === row) : undefined;
    const text = r?.kind === 'row' ? clean(r.cells[0]?.text) : row;
    const same = (s: string | undefined) => s?.toLowerCase() === text?.toLowerCase();
    return text && !same(nameOf(x, id)) && !same(other) ? text : undefined;
  };
  const name = (id: string, row?: string, other?: string) => {
    const x = byId.get(id);
    const own = nameOf(x, id);
    const k = (count.get(own) ?? 0) > 1 ? kindOf(x) : undefined;
    const part = row ? rowName(id, row, other) : undefined;
    return `${own}${k ? ` (${k})` : ''}${part ? `.${part}` : ''}`;
  };
  const legend = new Map((graph.legend ?? []).flatMap((l) => (l.tag ? [[l.tag, lowerFirst(l.label.replace(/:.*$/, ''))] as const] : [])));
  const edges = graph.edges.filter((e) => byId.has(e.from.node) && byId.has(e.to.node));
  const sources = [...new Set(edges.map((e) => e.from.node))].sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity));
  const items: Item[] = [];
  for (const id of sources) {
    const own = edges.filter((e) => e.from.node === id).sort((a, b) => (order.get(a.to.node) ?? Infinity) - (order.get(b.to.node) ?? Infinity));
    // Lines whose ends carry tags (U, D, ACL) say them per line: they differ per line.
    const tagged = own.filter((e) => e.ends?.from?.length || e.ends?.to?.length);
    for (const e of tagged) {
      const from = endsText(e.ends?.from, legend);
      const to = endsText(e.ends?.to, legend);
      items.push({ text: sentence(`${name(id)}${from ? ` (${from})` : ''} ${d('and')} ${name(e.to.node)}${to ? ` (${to})` : ''}${e.label ? `: ${clean(e.label)}` : ''}`) });
    }
    const rest = own.filter((e) => !tagged.includes(e));
    if (!rest.length) continue;
    const plural = isPlural(byId.get(id));
    const note = (() => {
      const n = byId.get(id);
      return !!n && 'shape' in n && n.shape.kind === 'flow' && n.shape.form === 'note';
    })();
    const parts = rest.map((e) => `${note ? d('is a note on {name}', { name: name(e.to.node) }) : clause(e, name(e.to.node, e.to.row, nameOf(byId.get(id), id)), plural, flow)}${e.marks?.length ? ` [${d('tagged {ids}', { ids: e.marks.join(', ') })}]` : ''}`);
    // Clauses with a comma of their own ("for at most 2 h, with approval by …") are kept apart by semicolons.
    const joined = parts.length > 1 && parts.some((p) => p.replace(/\([^)]*\)|\[[^\]]*\]/g, '').includes(', ')) ? parts.join('; ') : listWords(parts);
    items.push({ text: sentence(`${name(id, rest.every((e) => e.from.row === rest[0]!.from.row) ? rest[0]!.from.row : undefined)} ${joined}`) });
  }
  return items;
}

function tellGraph(graph: Graph, type: string | undefined): Told {
  const order = readingOrder(graph);
  const nodes = nodesOf(graph);
  const flow = type === 'states' ? 'states' : type === 'process' ? 'process' : undefined;
  const lanes = graph.groups.filter((g) => g.lane);
  const sections: Section[] = [];
  const matrices = nodes.filter((n) => n.shape.kind === 'matrix');
  const drawn = nodes.filter((n) => n.shape.kind !== 'matrix');
  if (drawn.length || graph.groups.length) sections.push({ heading: lanes.length ? d('Lanes and steps') : graph.groups.length ? d('Groups and elements') : d('Elements'), items: elementTree({ ...graph, nodes: graph.nodes.filter((n) => n.shape.kind !== 'matrix') }, order) });
  // The main line of a process, as its stops in order.
  if (graph.walk?.length) {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const stop = (b: NonNullable<Graph['walk']>[number]) => b.nodes.map((id) => byId.get(id)).find((n) => n && n.shape.kind === 'flow');
    // A caption that names the decision before it ("Checks green? yes") is how the stop is reached, not
    // what it is: after the name, "Waiting for review (Checks green?: yes)". A caption of only the line's label stays.
    const byEdge = new Map(graph.edges.map((e) => [e.id, e]));
    const how = (b: NonNullable<Graph['walk']>[number]) => {
      const e = b.edges.map((id) => byEdge.get(id)).find((x) => x && clean(x.label));
      return e && clean(b.caption) !== clean(e.label) ? `${nameOf(byId.get(e.from.node), e.from.node)}: ${clean(e.label)}` : undefined;
    };
    sections.push({ heading: d('Main path'), ordered: true, items: graph.walk.map((b) => ({ text: how(b) ? `${stop(b) ? nameOf(stop(b)) : b.title} (${how(b)})` : [stop(b) ? nameOf(stop(b)) : b.title, clean(b.caption)].filter(Boolean).join(': ') })) });
  }
  const tables = drawn.filter((n) => n.shape.kind === 'table');
  if (tables.length && type === 'class') sections.push(...tellTables(graph, tables as TableNode[]).sections);
  else if (graph.edges.length) sections.push({ heading: flow === 'states' ? d('Transitions') : d('Connections'), items: connectionItems(graph, order, flow) });
  for (const m of matrices) sections.push(...matrixSections(graph, m as MatrixNode));
  const parts = [plural(drawn.length, flow === 'states' ? 'state' : 'element'), lanes.length ? d('in {n}', { n: plural(lanes.length, 'lane') }) : graph.groups.length ? d('in {n}', { n: plural(graph.groups.length, 'group') }) : '', graph.edges.length ? d('with {n}', { n: plural(graph.edges.length, flow === 'states' ? 'transition' : 'connection') }) : ''];
  const comma = ` ${d('with {n}', { n: '' }).trim()} `;
  return { size: drawn.length ? parts.filter(Boolean).join(' ').replace(comma, `,${comma}`) : matrices.length ? undefined : d('It is empty'), sections };
}

// ------------------------------------------------------------------ tables: ERD and class diagrams

type TableNode = GraphNode & { shape: TableShape };
type MatrixNode = GraphNode & { shape: MatrixShape };

const SIGNS: Record<string, string> = { '+': 'public', '-': 'private', '#': 'protected', '~': 'package' };
const MARKS: Record<string, string> = { pk: 'primary key', fk: 'foreign key', unique: 'unique', null: 'optional', pii: 'personal data' };
const CARD: Partial<Record<Marker, string>> = { one: 'exactly one', zeroOrOne: 'zero or one', many: 'many', oneOrMany: 'one or many', zeroOrMany: 'zero or many' };

function tableItem(n: TableNode, refs?: Map<string, string>): Item {
  const s = n.shape;
  const items: Item[] = [];
  let section = '';
  for (const r of s.rows) {
    if (r.kind === 'section') {
      section = r.label;
      continue;
    }
    const [first, ...rest] = r.cells.map((c) => clean(c.text)).filter((x): x is string => !!x);
    const ref = refs?.get(`${n.id}.${r.id}`);
    const marks = (r.marks ?? []).map((m) => (m === 'fk' && ref ? d('foreign key to {name}', { name: ref }) : w(MARKS[m] ?? m)));
    const what = [...rest, ...marks, ...(r.sign && SIGNS[r.sign] ? [w(SIGNS[r.sign]!)] : [])];
    items.push({ text: `${section && s.form !== 'class' ? `${section}: ` : ''}${first ?? r.id}${what.length ? ` (${what.join(', ')})` : ''}` });
  }
  const detail = [s.caption?.replace(/^«(.*)»$/, '$1'), s.italic && !/abstract/i.test(s.caption ?? '') ? d('abstract') : ''].filter(Boolean);
  const said = clean(n.description);
  return { text: `${s.title}${detail.length ? ` (${detail.join(', ')})` : ''}${said ? `: ${said}` : ''}`, ...(items.length ? { items } : {}) };
}

/** A UML line in words, from the side of its `from` end: "Book extends Item", "Item is made of Copy". */
function umlText(e: GraphEdge, from: string, to: string): string {
  const card = (t?: string[]) => (t?.length ? ` (${t.join(' ')})` : '');
  const label = clean(e.label);
  const named = label ? ` "${label}"` : '';
  if (L !== 'en') {
    const verb = (a: string, b: string, how: 'implements' | 'extends') => d(how === 'implements' ? '{a} implements {b}' : '{a} extends {b}', { a, b });
    if (e.start === 'triangle') return verb(to, from, e.line === 'dashed' ? 'implements' : 'extends');
    if (e.end === 'triangle') return verb(from, to, e.line === 'dashed' ? 'implements' : 'extends');
    if (e.start === 'filledDiamond') return d('{a} is made of {b}', { a: `${from}${card(e.ends?.from)}`, b: `${to}${card(e.ends?.to)}${named}` });
    if (e.end === 'filledDiamond') return d('{a} is made of {b}', { a: `${to}${card(e.ends?.to)}`, b: `${from}${card(e.ends?.from)}${named}` });
    if (e.start === 'diamond') return d('{a} has {b}', { a: `${from}${card(e.ends?.from)}`, b: `${to}${card(e.ends?.to)}${named}` });
    if (e.end === 'diamond') return d('{a} has {b}', { a: `${to}${card(e.ends?.to)}`, b: `${from}${card(e.ends?.from)}${named}` });
    if (e.line === 'dashed') return d('{a} depends on {b}', { a: from, b: `${to}${named}` });
    return label ? `${from}${card(e.ends?.from)} ${label} ${to}${card(e.ends?.to)}` : d('{a} is associated with {b}', { a: `${from}${card(e.ends?.from)}`, b: `${to}${card(e.ends?.to)}` });
  }
  if (e.start === 'triangle') return `${to} ${e.line === 'dashed' ? 'implements' : 'extends'} ${from}`;
  if (e.end === 'triangle') return `${from} ${e.line === 'dashed' ? 'implements' : 'extends'} ${to}`;
  if (e.start === 'filledDiamond') return `${from}${card(e.ends?.from)} is made of ${to}${card(e.ends?.to)}${named}`;
  if (e.end === 'filledDiamond') return `${to}${card(e.ends?.to)} is made of ${from}${card(e.ends?.from)}${named}`;
  if (e.start === 'diamond') return `${from}${card(e.ends?.from)} has ${to}${card(e.ends?.to)}${named}`;
  if (e.end === 'diamond') return `${to}${card(e.ends?.to)} has ${from}${card(e.ends?.from)}${named}`;
  if (e.line === 'dashed') return `${from} depends on ${to}${named}`;
  return `${from}${card(e.ends?.from)} ${label ? `${label} ` : 'is associated with '}${to}${card(e.ends?.to)}`;
}

function tellTables(graph: Graph, tables: TableNode[]): Told {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const name = (id: string) => nameOf(byId.get(id), id);
  const classes = tables.some((t) => t.shape.form === 'class');
  const groups = new Map(graph.groups.map((g) => [g.id, g]));
  // A foreign key says what it points at.
  const refs = new Map(graph.edges.flatMap((e) => (e.from.row ? [[`${e.from.node}.${e.from.row}`, `${name(e.to.node)}${e.to.row ? `.${e.to.row}` : ''}`] as const] : [])));
  const table = (t: TableNode) => tableItem(t, refs);
  // In packages or schemas when there are any; else one list.
  const items: Item[] = graph.groups.length
    ? [...graph.groups.map((g) => ({ text: groupText(g), items: tables.filter((t) => t.parent === g.id).map(table) })), ...tables.filter((t) => !t.parent || !groups.has(t.parent)).map(table)]
    : tables.map(table);
  const relations: Item[] = graph.edges.map((e) => {
    const from = name(e.from.node);
    const to = name(e.to.node);
    if (classes || e.kind) return { text: sentence(umlText(e, from, to)) };
    const a = CARD[e.end];
    const b = CARD[e.start];
    const keys = e.from.row || e.to.row ? `${from}${e.from.row ? `.${e.from.row}` : ''} → ${to}${e.to.row ? `.${e.to.row}` : ''}` : `${from} → ${to}`;
    const rows = (one: string, card: string, other: string) => (L === 'en' ? `each ${one} row has ${card} ${other} row${/many/.test(card) ? 's' : ''}` : d('each {one} row has {card} {other} row|each {one} row has {card} {other} rows', { one, card: w(card), other, count: /many/.test(card) ? 2 : 1 }));
    const said = [a ? rows(from, a, to) : '', b ? rows(to, b, from) : ''].filter(Boolean);
    return { text: sentence(`${keys}${said.length ? `: ${said.join('; ')}` : ''}${e.label ? ` (${clean(e.label)})` : ''}`) };
  });
  const noun = classes ? 'class' : 'table';
  return {
    size: `${plural(tables.length, noun, classes ? 'classes' : 'tables')}${graph.edges.length ? `, ${d('with {n}', { n: plural(graph.edges.length, 'relation') })}` : ''}`,
    sections: [
      { heading: classes ? d('Classes') : d('Tables'), items },
      { heading: d('Relations'), items: relations },
    ],
  };
}

// ------------------------------------------------------------------ matrices

function cellText(c: NonNullable<MatrixShape['cells'][number][number]>, tags: Map<string, string>): string {
  const parts = c.parts?.length ? c.parts.map((p) => p.text) : c.text ? [c.text] : [];
  const said = parts.map((p) => (tags.has(p) ? `${p} (${tags.get(p)})` : p)).join(', ') || (c.check ? d('yes') : '');
  const change = c.change === 'added' ? `, ${d('new')}` : c.change === 'removed' ? `, ${d('removed')}` : c.change === 'changed' ? `, ${d('changed')}` : '';
  return `${said}${c.inherited ? `, ${d('inherited')}` : ''}${c.note ? ` (${clean(c.note)})` : ''}${change}`;
}

function matrixSections(graph: Graph, n: MatrixNode, heading?: string): Section[] {
  const m = n.shape;
  // What the tags in cells mean, from the key: R is "Responsible".
  const tags = new Map((graph.legend ?? []).flatMap((l) => (l.tag ? [[l.tag, l.label.replace(/:.*$/, '')] as const] : [])));
  const cols = m.columns.map((c) => `${c.label}${c.change === 'removed' ? ` (${d('removed')})` : c.change === 'added' ? ` (${d('new')})` : ''}`);
  const colGroups = [...new Set(m.columns.map((c) => c.group).filter((g): g is string => !!g))];
  const text = `${d('Columns')}: ${colGroups.length ? colGroups.map((g) => `${g} (${m.columns.filter((c) => c.group === g).map((c) => c.label).join(', ')})`).join('; ') : listWords(cols)}.`;
  const rowItem = (i: number): Item => {
    const r = m.rows[i]!;
    const cells = m.columns.flatMap((c, j) => {
      const cell = m.cells[i]?.[j];
      if (!cell) return [];
      const said = cellText(cell, tags);
      return said ? [m.plain ? `${c.label} ${said}` : `${c.label}: ${said}`] : [];
    });
    const label = r.label || (i ? '…' : '');
    return { text: `${label}${r.caption ? ` (${r.caption})` : ''}${r.change ? `, ${r.change === 'added' ? d('new') : d('removed')}` : ''}: ${cells.length ? cells.join('; ') : d('nothing')}` };
  };
  // In a plain table a row without a label goes on with the one above (a second interface of one device).
  const rows = (pick: (i: number) => boolean): Item[] => {
    const out: Item[] = [];
    m.rows.forEach((r, i) => {
      if (!pick(i)) return;
      const item = rowItem(i);
      const last = out.at(-1);
      if (!r.label && i && last) {
        last.items = [...(last.items ?? []), { text: item.text.replace(/^…: /, '') }];
        if (last.items.length === 1) {
          last.items.unshift({ text: last.text.replace(/^[^:]*: /, '') });
          last.text = last.text.replace(/: .*$/, '');
        }
      } else out.push(item);
    });
    return out;
  };
  const rowGroups = [...new Set(m.rows.map((r) => r.group).filter((g): g is string => !!g))];
  const items: Item[] = rowGroups.length ? [...rowGroups.map((g) => ({ text: g, items: rows((i) => m.rows[i]!.group === g) })), ...rows((i) => !m.rows[i]!.group)] : rows(() => true);
  return [{ heading: heading ?? (m.corner ? `${d('By row')} (${m.corner.replace(/\\\\/g, '\\').replace(/\s*\\\s*/, ` ${d('by')} `)})` : d('By row')), text, items }];
}

function tellMatrices(graph: Graph, matrices: MatrixNode[]): Told {
  const m = matrices[0]!.shape;
  return {
    size: matrices.length === 1 ? d('A table of {rows} by {columns}', { rows: plural(m.rows.length, 'row'), columns: plural(m.columns.length, 'column') }) : plural(matrices.length, 'table'),
    sections: matrices.flatMap((n) => matrixSections(graph, n, matrices.length > 1 ? nameOf(n) : undefined)),
  };
}

// ------------------------------------------------------------------ sequence

function tellSequence(s: SequenceShape): Told {
  const name = new Map(s.participants.map((p) => [p.id, p.label]));
  const who = (id: string) => name.get(id) ?? id;
  const participant = (p: SequenceShape['participants'][number]): Item => ({ text: `${p.label}${p.caption ? ` (${p.caption})` : ''}` });
  const participants: Item[] = [
    ...s.participants.filter((p) => !p.box || !s.boxes.some((b) => b.id === p.box)).map(participant),
    ...s.boxes.map((b) => ({ text: b.label, items: s.participants.filter((p) => p.box === b.id).map(participant) })),
  ];
  // Keep the order written: boxes stand where their first participant does.
  const at = (it: Item) => s.participants.findIndex((p) => p.label === (it.items?.[0]?.text ?? it.text).replace(/ \(.*\)$/, ''));
  participants.sort((a, b) => at(a) - at(b));
  const FRAME: Record<string, string> = { alt: 'Alternative', opt: 'Optional', loop: 'Loop', par: 'In parallel', break: 'Break', critical: 'Critical', group: 'Group' };
  const BRANCH: Record<string, string> = { alt: 'Else', par: 'And' };
  const root: Item[] = [];
  const stack: { items: Item[]; frame?: string }[] = [{ items: root }];
  const top = () => stack.at(-1)!;
  let messages = 0;
  for (const e of s.events) {
    if (e.kind === 'message') {
      messages++;
      const label = clean(e.label);
      const self = e.from === e.to;
      const verb = e.arrow === 'reply' ? d('replies to {name}', { name: who(e.to) }) : e.arrow === 'async' ? d('sends to {name}', { name: who(e.to) }) : self ? d('does') : d('calls {name}', { name: who(e.to) });
      const text = `${e.number ?? messages}. ${who(e.from)} ${verb}${label ? `: ${label}` : ''}${e.arrow === 'lost' ? ` (${d('lost: no one receives it')})` : ''}`;
      top().items.push({ text: sentence(text) });
    } else if (e.kind === 'frame') {
      const item: Item = { text: `${w(FRAME[e.frame] ?? e.frame)}${e.label ? `: ${clean(e.label)}` : ''}`, items: [] };
      top().items.push(item);
      stack.push({ items: item.items!, frame: e.frame });
    } else if (e.kind === 'branch') {
      const frame = top().frame;
      if (stack.length < 2) continue;
      stack.pop();
      const item: Item = { text: `${w(BRANCH[frame ?? ''] ?? 'Then')}${e.label ? `: ${clean(e.label)}` : ''}`, items: [] };
      top().items.push(item);
      stack.push({ items: item.items!, frame });
    } else if (e.kind === 'end') {
      if (stack.length > 1) stack.pop();
    } else if (e.kind === 'divider') top().items.push({ text: `${clean(e.label) ?? d('Next')}:` });
    else if (e.kind === 'note') top().items.push({ text: `${e.side === 'over' ? d('Note over {names}', { names: listWords(e.over.map(who)) }) : e.side === 'left' ? d('Note left of {names}', { names: listWords(e.over.map(who)) }) : d('Note right of {names}', { names: listWords(e.over.map(who)) })}: ${clean(e.text) ?? ''}` });
    else if (e.kind === 'ref') top().items.push({ text: d('See {what} (over {names})', { what: clean(e.label) ?? d('another diagram'), names: listWords(e.over.map(who)) }) });
  }
  return {
    size: `${plural(s.participants.length, 'participant')} ${d('and')} ${plural(messages, 'message')}`,
    sections: [
      { heading: d('Participants'), items: participants },
      { heading: d('Message flow'), text: d('In order, top to bottom.'), items: root },
    ],
  };
}

// ------------------------------------------------------------------ git branching

function tellGitflow(s: GitflowShape): Told {
  const branchOf = new Map(s.commits.map((c) => [c.id, c.branch]));
  const env = new Map(s.environments.map((e) => [e.id, e.label]));
  if (s.view === 'delivery' && s.pipelines.length) {
    const stage = new Map(s.stages.map((x) => [x.id, x.label]));
    return {
      size: d('{a} through {b}', { a: plural(s.pipelines.length, 'pipeline'), b: plural(s.stages.length, 'stage') }),
      sections: [
        {
          heading: d('Pipelines'),
          items: s.pipelines.map((p) => ({ text: sentence(`${p.label}: ${p.steps.map((st) => `${st.gate ? d('{gate}, then ', { gate: st.gate }) : ''}${st.label || stage.get(st.stage) || st.stage}`).join(' → ')}${p.into ? `; ${d('merges into {name}', { name: p.into })}` : ''}`) })),
        },
      ],
    };
  }
  const branches: Item[] = s.branches.map((b) => {
    const own = s.commits.filter((c) => c.branch === b.name);
    const n = own.reduce((k, c) => k + (c.count ?? 1), 0);
    return { text: `${b.label ?? b.name} (${[b.family !== 'other' && b.family !== b.name ? b.family : '', b.keep ? d('long-lived') : '', plural(n, 'commit')].filter(Boolean).join(', ')})` };
  });
  const history: Item[] = s.commits.map((c) => {
    const what = [
      c.count ? plural(c.count, 'commit') : clean(c.label) ?? (c.merge ? '' : 'commit'),
      c.fork && branchOf.get(c.fork) !== c.branch ? d('branches off {name}', { name: branchOf.get(c.fork) ?? c.fork }) : '',
      c.merge ? d('merges {name}', { name: branchOf.get(c.merge) ?? c.merge }) : '',
      c.pick ? d('cherry-picks from {name}', { name: branchOf.get(c.pick) ?? c.pick }) : '',
      c.tags.length ? d('tagged {tags}', { tags: c.tags.join(', ') }) : '',
      c.deploy.length ? d('deployed to {names}', { names: listWords(c.deploy.map((x) => env.get(x) ?? x)) }) : '',
      ...c.notes.map((x) => clean(x) ?? ''),
    ].filter(Boolean);
    return { text: sentence(`${c.branch}: ${what.join(', ')}`) };
  });
  return {
    size: `${plural(s.branches.length, 'branch', 'branches')} ${d('and')} ${plural(s.commits.length, 'commit')}`,
    sections: [
      { heading: d('Branches'), items: branches },
      { heading: d('History'), text: d('Oldest first.'), ordered: true, items: history },
    ],
  };
}

// ------------------------------------------------------------------ roadmap

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Axis positions in words: dates for an axis of days, else the period's name ("Q3", "Sprint 4"). */
function roadmapClock(s: RoadmapShape) {
  // Ticks a unit wide are named periods; wider ticks are months or weeks of an axis of days since 1970.
  const days = s.ticks.some((t) => t.end - t.start > 1);
  const date = (d: number) => {
    const x = new Date(Math.round(d) * 86400000);
    return { day: x.getUTCDate(), month: w(MONTHS[x.getUTCMonth()]!), year: x.getUTCFullYear() };
  };
  const period = (at: number) => {
    const t = s.ticks.find((k) => at >= k.start && at < k.end) ?? (at >= s.end ? s.ticks.at(-1) : s.ticks[0]);
    return t ? [t.label, t.group && !t.group.includes(t.label) ? t.group : ''].filter(Boolean).join(' ') : String(at);
  };
  const on = (at: number) => {
    if (!days) return period(at);
    const d = date(at);
    return `${d.day} ${d.month} ${d.year}`;
  };
  const span = (start: number, end: number) => {
    if (!days) {
      const a = period(start);
      const b = period(end - 1e-6);
      return a === b ? a : d('{a} to {b}', { a, b });
    }
    const a = date(start);
    const b = date(end - 1);
    if (a.year === b.year && a.month === b.month) return a.day === b.day ? `${a.day} ${a.month} ${a.year}` : `${a.day}–${b.day} ${a.month} ${a.year}`;
    return a.year === b.year ? d('{a} to {b}', { a: `${a.day} ${a.month}`, b: `${b.day} ${b.month} ${b.year}` }) : d('{a} to {b}', { a: `${a.day} ${a.month} ${a.year}`, b: `${b.day} ${b.month} ${b.year}` });
  };
  const whole = () => {
    if (!days) return span(s.start, s.end);
    const a = date(s.start);
    const b = date(s.end - 1);
    return a.year === b.year ? d('{a} to {b}', { a: a.month, b: `${b.month} ${b.year}` }) : d('{a} to {b}', { a: `${a.month} ${a.year}`, b: `${b.month} ${b.year}` });
  };
  return { on, span, whole };
}

const STATUS: Record<string, string> = { planned: 'planned', active: 'in progress', done: 'done', 'at-risk': 'at risk', late: 'late' };

function tellRoadmap(s: RoadmapShape): Told {
  const clock = roadmapClock(s);
  const label = new Map(s.items.map((i) => [i.id, i.label]));
  const item = (i: RoadmapShape['items'][number]): Item => {
    const when = i.milestone ? d('milestone on {date}', { date: clock.on(i.start) }) : clock.span(i.start, i.end);
    const said = [i.status && STATUS[i.status] ? w(STATUS[i.status]!) : i.status, i.progress != null && i.status !== 'done' ? d('{n}% done', { n: Math.round(i.progress * 100) }) : '', i.after.length ? d('after {names}', { names: listWords(i.after.map((a) => label.get(a) ?? a)) }) : ''].filter(Boolean);
    return { text: `${i.label}: ${when}${said.length ? `, ${said.join(', ')}` : ''}` };
  };
  const byStart = (a: RoadmapShape['items'][number], b: RoadmapShape['items'][number]) => a.start - b.start || a.end - b.end;
  const lanes: Item[] = s.lanes.map((l) => ({ text: `${l.label}${l.caption ? ` (${l.caption})` : ''}`, items: s.items.filter((i) => i.lane === l.id).sort(byStart).map(item) }));
  const loose = s.items.filter((i) => !i.lane || !s.lanes.some((l) => l.id === i.lane)).sort(byStart).map(item);
  const milestones = s.items.filter((i) => i.milestone).length;
  const sections: Section[] = [{ heading: s.lanes.length ? d('By lane') : d('Items'), items: [...lanes, ...loose] }];
  if (s.phases.length) sections.push({ heading: d('Phases'), items: s.phases.map((p) => ({ text: `${p.label}: ${clock.span(p.start, p.end)}` })) });
  if (s.today) sections.push({ heading: d('Today'), text: sentence(/\d/.test(s.today.label) ? d('Marked: {label}', { label: s.today.label }) : d('{label} is marked at {date}', { label: s.today.label || d('Today'), date: clock.on(s.today.at) })) });
  return {
    size: `${plural(s.items.length - milestones, 'item')}${milestones ? ` ${d('and')} ${plural(milestones, 'milestone')}` : ''}${s.lanes.length ? ` ${d('in {n}', { n: plural(s.lanes.length, 'lane') })}` : ''}, ${clock.whole()}`,
    sections,
  };
}

// ------------------------------------------------------------------ journey

function stepItem(st: JourneyStep, s: JourneyShape): Item {
  const score = st.score != null ? d('{n} of {max}', { n: st.score, max: s.scale.max }) : '';
  const feel = st.score != null ? d('feels {how}', { how: `${st.feeling ? `${st.feeling}, ` : ''}${score}` }) : st.feeling ? d('feels {how}', { how: st.feeling }) : '';
  const items: Item[] = [
    ...(st.thought ? [{ text: `${d('Thinks')}: “${clean(st.thought)}”` }] : []),
    ...(st.says ? [{ text: `${d('Says')}: “${clean(st.says)}”` }] : []),
    ...(st.touchpoints.length ? [{ text: d('Through {names}', { names: listWords(st.touchpoints.map((t) => t.label)) }) }] : []),
    ...(st.actors.length ? [{ text: d('With: {names}', { names: listWords(st.actors) }) }] : []),
    ...st.pains.map((p) => ({ text: `${d('Pain')}: ${p}` })),
    ...st.gains.map((p) => ({ text: `${d('Works well')}: ${p}` })),
    ...st.ideas.map((p) => ({ text: `${d('Idea')}: ${p}` })),
    ...st.metrics.map((p) => ({ text: `${d('Measured')}: ${p}` })),
    ...(s.view === 'blueprint'
      ? [...st.frontstage.map((p) => ({ text: `${w('Frontstage')}: ${p}` })), ...st.backstage.map((p) => ({ text: `${w('Backstage')}: ${p}` })), ...st.support.map((p) => ({ text: `${w('Support')}: ${p}` }))]
      : []),
  ];
  return { text: `${st.label}${feel ? ` (${feel})` : ''}`, ...(items.length ? { items } : {}) };
}

function tellJourney(s: JourneyShape): Told {
  const sections: Section[] = [];
  const p = s.persona;
  if (p) {
    const items = [p.role ? `${d('Role')}: ${p.role}` : '', p.goal ? `${d('Goal')}: ${p.goal}` : '', p.quote ? `${d('Says')}: “${clean(p.quote)}”` : ''].filter(Boolean).map((text) => ({ text }));
    sections.push({ heading: `${d('Persona')}: ${p.name}`, items });
  }
  const phase = (track: JourneyStep[]) => s.phases.map((ph) => ({ text: `${ph.label}${ph.caption ? ` (${ph.caption})` : ''}`, items: track.filter((st) => st.phase === ph.id).map((st) => stepItem(st, s)) })).filter((x) => x.items.length);
  if (s.view === 'compare' && s.future) {
    sections.push({ heading: s.label || d('Today'), items: phase(s.steps) }, { heading: s.future.label || d('Future'), items: phase(s.future.steps) });
  } else sections.push({ heading: d('By phase'), items: phase(s.steps) });
  // Where it feels worst and best: the first thing anyone asks of a journey.
  const scored = s.steps.filter((st) => st.score != null);
  if (scored.length > 2) {
    const low = scored.reduce((a, b) => (b.score! < a.score! ? b : a));
    const high = scored.reduce((a, b) => (b.score! > a.score! ? b : a));
    sections.push({ heading: d('Feeling'), text: sentence(d('Lowest at “{low}” ({lowScore}); highest at “{high}” ({highScore})', { low: low.label, high: high.label, lowScore: d('{n} of {max}', { n: low.score!, max: s.scale.max }), highScore: d('{n} of {max}', { n: high.score!, max: s.scale.max }) })) });
  }
  const metrics = [...s.metrics, ...(s.future?.metrics ?? [])];
  if (metrics.length) sections.push({ heading: d('Metrics'), items: metrics.map((m) => ({ text: `${m.label}: ${m.value}` })) });
  const phases = s.phases.filter((ph) => s.steps.some((st) => st.phase === ph.id)).length;
  return { size: d('{who} through {phases} and {steps}', { who: p ? d("{name}'s journey", { name: p.name }) : d('A journey'), phases: plural(phases, 'phase'), steps: plural(s.steps.length, 'step') }), sections };
}

// ------------------------------------------------------------------ blocks: org charts, capability maps, teams, mind maps

type BlockNode = GraphNode & { shape: BlockShape };

const TEAM: Record<string, string> = { stream: 'stream-aligned team', platform: 'platform team', enabling: 'enabling team', subsystem: 'complicated-subsystem team' };
const MODE: Record<string, string> = { collaboration: 'collaboration', service: 'X-as-a-Service', facilitating: 'facilitating' };

function blockText(n: BlockNode): string {
  const b = n.shape;
  const said = [
    b.form === 'person' ? '' : b.caption,
    b.heat ? b.heat.text : b.blank ? d('no value') : '',
    b.badge ? b.badge : '',
    b.lines?.length && b.form !== 'person' ? `${d('systems')}: ${b.lines.join(', ')}` : '',
    TEAM[b.form] ? w(TEAM[b.form]!) : '',
    b.vacant ? d('open role') : '',
  ].filter((x): x is string => !!x);
  if (b.form === 'person') said.unshift(...(b.lines ?? []));
  const head = b.form === 'person' ? `${b.vacant ? d('Vacancy') : b.label}${b.caption ? `${b.vacant ? ':' : ','} ${b.caption}` : ''}` : b.label;
  const desc = clean(n.description);
  const shown = desc && !said.some((x) => x.toLowerCase() === desc.toLowerCase()) && desc.toLowerCase() !== head.toLowerCase();
  return `${head}${said.length ? ` (${said.join(', ')})` : ''}${shown ? `: ${desc}` : ''}`;
}

function tellBlocks(graph: Graph, blocks: BlockNode[]): Told {
  const forms = new Set(blocks.map((b) => b.shape.form));
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const name = (id: string) => nameOf(byId.get(id), id);
  // An org chart and a mind map are trees along their lines; a capability map is blocks inside blocks.
  const tree = (children: (id: string | undefined) => BlockNode[]) => {
    const seen = new Set<string>();
    const walk = (id: string | undefined): Item[] =>
      children(id).flatMap((b) => {
        if (seen.has(b.id)) return [];
        seen.add(b.id);
        const kids = walk(b.id);
        return [{ text: blockText(b), ...(kids.length ? { items: kids } : {}) }];
      });
    return walk;
  };
  if (forms.has('person')) {
    const solid = graph.edges.filter((e) => !e.loose && e.line === 'solid');
    const boss = new Map(solid.map((e) => [e.to.node, e.from.node]));
    const people = blocks.filter((b) => b.shape.form === 'person');
    const walk = tree((id) => people.filter((p) => (id ? boss.get(p.id) === id : !boss.has(p.id) || !byId.has(boss.get(p.id)!))));
    const top = people.filter((p) => !boss.has(p.id));
    const dotted = graph.edges.filter((e) => e.loose || e.line !== 'solid');
    const sections: Section[] = [{ heading: d('Who reports to whom'), text: d('Each person, with the people who report to them under them.'), items: walk(undefined) }];
    if (dotted.length) sections.push({ heading: d('Dotted lines'), items: dotted.map((e) => ({ text: sentence(`${d('{a} also reports to {b}', { a: name(e.to.node), b: name(e.from.node) })}${e.label ? ` (${clean(e.label)})` : ''}`) })) });
    const vacant = people.filter((p) => p.shape.vacant).length;
    return { size: `${plural(people.length - vacant, 'person', 'people')}${vacant ? ` ${d('and')} ${plural(vacant, 'open role')}` : ''}${top.length === 1 ? `, ${d('led by {name}', { name: name(top[0]!.id) })}` : ''}`, sections };
  }
  if (forms.has('topic')) {
    const parent = new Map(graph.edges.map((e) => [e.to.node, e.from.node]));
    const walk = tree((id) => blocks.filter((b) => (id ? parent.get(b.id) === id : !parent.has(b.id))));
    const items = walk(undefined);
    const centre = blocks.find((b) => b.shape.level === 0);
    const branches = blocks.filter((b) => b.shape.level === 1).length;
    return { size: `${centre ? `${d('Around {name}', { name: centre.shape.label })}, ` : ''}${d('{a} and {b} in all', { a: plural(branches, 'branch', 'branches'), b: plural(blocks.length, 'topic') })}`, sections: [{ heading: d('Topics'), items: centre && items.length === 1 ? (items[0]!.items ?? []) : items }] };
  }
  const zones = blocks.filter((b) => b.shape.between);
  const teams = blocks.filter((b) => TEAM[b.shape.form]);
  if (teams.length) {
    const sections: Section[] = [{ heading: d('Teams'), items: teams.map((t) => ({ text: blockText(t) })) }];
    // An interaction mode as a line's kind: "x-as-a-service" or "service".
    const modeOf = (kind: string | undefined) => Object.keys(MODE).find((k) => k === kind || MODE[k]!.toLowerCase() === kind?.toLowerCase());
    const said = [...zones.map((z) => ({ a: z.shape.between![0], b: z.shape.between![1], mode: z.shape.form, label: z.shape.label })), ...graph.edges.flatMap((e) => (modeOf(e.kind) ? [{ a: e.from.node, b: e.to.node, mode: modeOf(e.kind)!, label: e.label }] : []))];
    const seen = new Set<string>();
    const items = said.flatMap((z) => {
      const key = [z.a, z.b].sort().join('|');
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ text: sentence(`${name(z.a)} ${d('and')} ${name(z.b)}: ${w(MODE[z.mode] ?? z.mode)}${z.label && z.label !== MODE[z.mode] ? ` (${clean(z.label)})` : ''}`) }];
    });
    if (items.length) sections.push({ heading: d('Interactions'), items });
    const flows = graph.edges.filter((e) => !modeOf(e.kind) && !seen.has([e.from.node, e.to.node].sort().join('|')) && byId.has(e.from.node) && byId.has(e.to.node));
    if (flows.length) sections.push({ heading: d('Connections'), items: connectionItems({ ...graph, edges: flows }, readingOrder(graph)) });
    return { size: `${plural(teams.length, 'team')}${items.length ? `, ${d('with {n}', { n: plural(items.length, 'interaction') })}` : ''}`, sections };
  }
  // A capability map: areas, capabilities, and what they hold.
  const walk = tree((id) => blocks.filter((b) => !b.shape.between && (id ? b.shape.inside === id : !b.shape.inside || !byId.has(b.shape.inside))));
  const areas = blocks.filter((b) => b.shape.form === 'area').length;
  const caps = blocks.filter((b) => b.shape.form === 'capability' || b.shape.form === 'chip').length;
  const sections: Section[] = [{ heading: areas ? d('Areas and capabilities') : d('Capabilities'), items: walk(undefined) }];
  if (graph.edges.length) sections.push({ heading: d('Connections'), items: connectionItems(graph, readingOrder(graph)) });
  return { size: `${areas ? `${plural(areas, 'area')} ${d('and')} ` : ''}${plural(caps || blocks.length, 'capability', 'capabilities')}`, sections };
}

// ------------------------------------------------------------------ what every drawing can have

/** Written steps as a walkthrough; a dynamic view's numbered lines when nobody wrote steps. */
function walkthrough(graph: Graph, input: DescribeInput): Section[] {
  const byId = new Map<string, GraphNode | GraphGroup>([...graph.groups.map((g) => [g.id, g] as const), ...graph.nodes.map((n) => [n.id, n] as const)]);
  if (input.steps?.length && !input.stepsImplied) {
    const items = input.steps.map((s, i) => {
      const shown = Object.entries(s.nodes).filter(([, e]) => e === 'focus').map(([id]) => nameOf(byId.get(id), id));
      const text = [clean(s.title), clean(s.caption)].filter(Boolean).join(': ') || (shown.length ? d('Shows {names}', { names: listWords(shown) }) : d('Step {n}', { n: i + 1 }));
      const notes = s.notes.map((n) => ({ text: `${nameOf(byId.get(n.id), n.id)}: ${clean(n.text) ?? ''}` }));
      return { text: sentence(text), ...(notes.length ? { items: notes } : {}) };
    });
    return [{ heading: d('Walkthrough'), ordered: true, items }];
  }
  if (graph.steps?.length) {
    const edges = new Map(graph.edges.map((e) => [e.id, e]));
    const items = graph.steps.map((s) => {
      const e = edges.get(s.edge);
      const from = nameOf(byId.get(s.from), s.from);
      const to = nameOf(byId.get(s.to), s.to);
      return { text: sentence(`${from} → ${to}${clean(s.label ?? e?.label) ? `: ${clean(s.label ?? e?.label)}` : ''}`) };
    });
    return [{ heading: d('Steps'), ordered: true, items }];
  }
  return [];
}

function layerSection(input: DescribeInput): Section[] {
  const list = input.layers?.list ?? [];
  if (!list.length) return [];
  return [{ heading: d('Layers'), text: d('Ways to look at this drawing by tag.'), items: list.map((l) => ({ text: sentence(`${l.title ?? l.name}${l.caption ? `: ${clean(l.caption)}` : ''} (${d('tags {tags}', { tags: l.tags.join(', ') })}${l.count != null ? `; ${plural(l.count, 'element')}` : ''})`) })) }];
}

function trustSection(graph: Graph): Section[] {
  const trust = graph.groups.filter((g) => g.trust);
  return trust.length ? [{ heading: d('Trust boundaries'), items: trust.map((g) => ({ text: nameOf(g) })) }] : [];
}

const ENDS: Partial<Record<Marker, string>> = { arrow: 'arrow', one: 'bar', zeroOrOne: 'ring and bar', many: "crow's foot", oneOrMany: "bar and crow's foot", zeroOrMany: "ring and crow's foot", triangle: 'hollow triangle', diamond: 'hollow diamond', filledDiamond: 'filled diamond', open: 'open arrowhead', slash: 'slash' };
const SWATCH: Record<string, string> = { fill: 'filled pill', outline: 'outlined pill', check: 'check mark', 'check-outline': 'outlined check mark', badge: 'badge', tile: 'icon', boundary: 'boundary box', trust: 'heavy dashed boundary', block: 'block', glyph: 'symbol', focus: 'ring' };
/** The samples whose Dutch word is a het-word (vinkje, icoon, grenskader, symbool). */
const NEUTER = new Set(['check mark', 'outlined check mark', 'icon', 'boundary box', 'symbol']);

/** A key entry in words: what the sample looks like, and what it means. */
function keyText(l: LegendItem, shade?: { n: number; of: number }): string {
  if (L !== 'en') return keySaid(l, shade);
  const tone = l.tone && l.tone !== 'slate' ? `${l.tone} ` : '';
  let look: string;
  if (l.swatch === 'mark') look = l.tag ? `tag ${l.tag}` : 'numbered tag';
  else if (l.swatch === 'message') look = l.arrow === 'reply' ? 'dashed arrow' : l.arrow === 'async' ? 'arrow with an open head' : l.arrow === 'lost' ? 'arrow ending in a cross' : 'arrow with a filled head';
  else if (l.swatch === 'block') look = l.block?.heat && shade ? `shade ${shade.n} of ${shade.of}${shade.n === 1 ? ' (lightest)' : shade.n === shade.of ? ' (strongest)' : ''}` : l.block?.heat?.text ? `block marked ${l.block.heat.text}` : `${l.block?.form ?? ''} block`.trim();
  else if (l.swatch === 'glyph' && l.icon) look = `${tone}${l.icon.split('-')[0]} symbol`;
  else if (l.swatch) look = `${tone}${SWATCH[l.swatch] ?? l.swatch}${l.muted ? ', greyed' : ''}`;
  else {
    const pattern = l.pattern === 'ticks' ? ' with ticks' : l.pattern === 'beads' ? ' with beads' : l.pattern === 'double' ? ', double' : '';
    const what = l.end && l.end !== 'arrow' ? (ENDS[l.end] ?? l.end) : '';
    const end = what ? ` ending in ${/^[aeiou]/.test(what) ? 'an' : 'a'} ${what}` : '';
    look = `${l.line ?? 'solid'} ${tone}line${pattern}${l.width && l.width > 1.2 ? ', thick' : ''}${end}`;
  }
  return `${look[0]!.toUpperCase()}${look.slice(1)}: ${l.label}`;
}

/** keyText in another language than English: the sample's look from the word tables (./nl.ts), adjective first as Dutch says it. */
function keySaid(l: LegendItem, shade?: { n: number; of: number }): string {
  // Before a het-word Dutch drops the colour's -e: een blauw icoon, but een blauwe pil.
  const neuter = l.swatch && NEUTER.has(SWATCH[l.swatch] ?? '');
  const tone = l.tone && l.tone !== 'slate' ? `${w(`tone:${l.tone}${neuter ? '@het' : ''}`)} ` : '';
  let look: string;
  if (l.swatch === 'mark') look = l.tag ? d('tag {tag}', { tag: l.tag }) : d('numbered tag');
  else if (l.swatch === 'message') look = l.arrow === 'reply' ? d('dashed arrow') : l.arrow === 'async' ? d('arrow with an open head') : l.arrow === 'lost' ? d('arrow ending in a cross') : d('arrow with a filled head');
  else if (l.swatch === 'block') look = l.block?.heat && shade ? `${d('shade {n} of {of}', { n: shade.n, of: shade.of })}${shade.n === 1 ? ` (${d('lightest')})` : shade.n === shade.of ? ` (${d('strongest')})` : ''}` : l.block?.heat?.text ? d('block marked {text}', { text: l.block.heat.text }) : d('block');
  // The icon's name (key, eye) is an English id: the symbol is said by what it means, after the colon.
  else if (l.swatch) look = `${tone}${w(SWATCH[l.swatch] ?? l.swatch)}${l.muted ? `, ${d('greyed')}` : ''}`;
  else {
    const pattern = l.pattern === 'ticks' ? ` ${d('with ticks')}` : l.pattern === 'beads' ? ` ${d('with beads')}` : l.pattern === 'double' ? `, ${d('double')}` : '';
    const what = l.end && l.end !== 'arrow' ? w(ENDS[l.end] ?? l.end) : '';
    look = `${w(`line:${l.line ?? 'solid'}`)} ${tone}${d('line')}${pattern}${l.width && l.width > 1.2 ? `, ${d('thick')}` : ''}${what ? ` ${d('ending in {what}', { what })}` : ''}`;
  }
  return `${look[0]!.toUpperCase()}${look.slice(1)}: ${l.label}`;
}

function keySection(graph: Graph): Section[] {
  const legend = graph.legend ?? [];
  // A heatmap's key is a row of shades: said by their place in it, the colour alone says nothing.
  const heat = legend.filter((l) => l.swatch === 'block' && l.block?.heat && l.block.heat.scale !== 'categorical');
  return legend.length ? [{ heading: d('Key'), items: legend.map((l) => ({ text: keyText(l, heat.includes(l) ? { n: heat.indexOf(l) + 1, of: heat.length } : undefined) })) }] : [];
}
