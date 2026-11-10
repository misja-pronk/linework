// What a trace walks: the elements of a drawing or a model and the relations between them, with
// what a request needs to know about each. Read from a drawn graph (what a view shows, any type of
// elements and lines) or from the model itself (every level, as written).
import type { Catalogue, Graph, Path } from '@cartography/core';

/**
 * What an element does with a request. actor: starts one (a person). store: answers it and calls no
 * further (a database, a cache, a bucket). queue: passes it on later (a topic, a bus). external: outside
 * the drawing's scope, answers it. service: everything else.
 */
export type Role = 'actor' | 'service' | 'queue' | 'store' | 'external';

export interface TraceElement {
  id: string;
  label: string;
  kind?: string;
  technology?: string;
  tags: string[];
  /** The group (or model element) it sits in. */
  parent?: string;
  /** It has elements inside it: drawn as a box around them, a participant only when a line ends on it. */
  group?: boolean;
  role: Role;
  path: Path;
}

export interface TraceRelation {
  id: string;
  from: string;
  to: string;
  /** What it says, without the technology. */
  label?: string;
  technology?: string;
  /** Fire and forget: an async message without a reply. */
  async: boolean;
  /** A line without a direction (or with arrows at both ends): it can be walked either way. */
  both?: boolean;
  path: Path;
}

/** A numbered interaction of a dynamic view, in order. */
export interface TraceStep {
  from: string;
  to: string;
  label?: string;
  technology?: string;
}

export interface TraceGraph {
  title?: string;
  elements: Map<string, TraceElement>;
  relations: TraceRelation[];
  /** Its ids are model element ids: a dynamic view can be made of a trace. */
  model: boolean;
  /** The numbered lines of a dynamic view, when the drawing is one. */
  steps?: TraceStep[];
}

const words = (...s: (string | undefined)[]) => ` ${s.filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
const has = (w: string, list: string[]) => list.some((x) => w.includes(` ${x} `));

const ACTOR = ['person', 'people', 'user', 'users', 'actor', 'customer', 'customers', 'staff', 'admin'];
const STORE = ['database', 'db', 'sql', 'cache', 'redis', 'storage', 'bucket', 'blob', 's3', 'cosmos', 'warehouse', 'lake', 'datalake', 'disk', 'files', 'store', 'memcached', 'elasticsearch', 'dynamodb', 'postgres', 'mysql', 'mongodb', 'rds', 'aurora', 'bigquery', 'snowflake', 'vault', 'secrets'];
const QUEUE = ['queue', 'topic', 'bus', 'event', 'events', 'stream', 'kafka', 'sns', 'sqs', 'eventbridge', 'pubsub', 'servicebus', 'eventhub', 'kinesis', 'rabbitmq', 'mq', 'broker'];
const EXTERNAL = ['external', 'saas', 'partner', 'payments', 'payment', 'email', 'sms', 'third'];

/** What an element does with a request, from its kind (first), its tags and, for a person, its form. */
export function roleOf(kind: string | undefined, tags: string[], person = false): Role {
  const k = words(kind?.replace(/-/g, ' '), kind?.replace(/-/g, ''));
  if (person || has(k, ACTOR)) return 'actor';
  if (has(k, QUEUE)) return 'queue';
  if (has(k, STORE)) return 'store';
  if (tags.includes('external') || has(k, EXTERNAL)) return 'external';
  return 'service';
}

/** "Places orders [JSON/HTTPS]" → label and technology, as C4 writes a relation. */
export function splitTechnology(text: string | undefined): { label?: string; technology?: string } {
  if (!text) return {};
  const m = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(text);
  if (!m) return { label: text };
  return { ...(m[1] ? { label: m[1] } : {}), technology: m[2] };
}

const ASYNC = /\basync|asynchron|event|message|publish|subscri/i;

/** The elements and lines of a drawn graph (a diagram as written or one of its views). */
export function fromGraph(graph: Graph, model = false): TraceGraph {
  const elements = new Map<string, TraceElement>();
  for (const g of graph.groups) {
    if (g.lane) continue;
    elements.set(g.id, { id: g.id, label: g.label, kind: g.kind, tags: g.tags ?? [], parent: g.parent, group: true, role: roleOf(g.kind, g.tags ?? []), path: g.path });
  }
  for (const n of graph.nodes) {
    if (n.folded) continue;
    const s = n.shape;
    const label = s.kind === 'card' || s.kind === 'flow' || s.kind === 'block' ? s.label : s.kind === 'table' ? s.title : undefined;
    if (label === undefined) continue;
    const tags = [...(n.tags ?? []), ...(s.kind === 'card' && s.muted ? ['external'] : [])];
    const person = s.kind === 'card' && s.form === 'person';
    // A C4 card says its technology in its type line: [Container: Spring Boot].
    const technology = s.kind === 'card' ? /^\[[^:\]]+:\s*([^\]]+)\]/.exec(s.caption ?? '')?.[1] : undefined;
    elements.set(n.id, { id: n.id, label, kind: n.kind, ...(technology ? { technology } : {}), tags, parent: n.parent, role: roleOf(n.kind, tags, person), path: n.path });
  }
  const relations: TraceRelation[] = [];
  for (const e of graph.edges) {
    if (!elements.has(e.from.node) || !elements.has(e.to.node) || e.from.node === e.to.node) continue;
    const forward = e.end === 'arrow' || e.end === 'open';
    const back = e.start === 'arrow' || e.start === 'open';
    // An arrow only at the start points the other way: read as written from its head.
    const [from, to] = back && !forward ? [e.to.node, e.from.node] : [e.from.node, e.to.node];
    const { label, technology } = splitTechnology(e.label);
    relations.push({
      id: e.id,
      from,
      to,
      ...(label ? { label } : {}),
      ...(technology ? { technology } : {}),
      async: !!e.kind && ASYNC.test(e.kind),
      ...(forward === back ? { both: true } : {}),
      path: e.path,
    });
  }
  const steps = graph.steps?.map((s) => ({ from: s.from, to: s.to, ...splitTechnology(s.label) }));
  return { title: graph.title, elements, relations, model, ...(steps?.length ? { steps } : {}) };
}

/**
 * The whole model: every element at every level, every relation as written. A relation written at a
 * coarse level next to the same one in detail (web → api besides web → api.signin) is left out: the
 * detailed one says where the request really goes.
 */
export function fromCatalogue(cat: Catalogue, title?: string): TraceGraph {
  const elements = new Map<string, TraceElement>();
  const parents = new Set([...cat.elements.values()].flatMap((e) => (e.parent ? [e.parent] : [])));
  for (const e of cat.elements.values())
    elements.set(e.id, {
      id: e.id,
      label: e.label ?? e.name,
      kind: e.kind,
      ...(e.technology ? { technology: e.technology } : {}),
      tags: e.tags,
      parent: e.parent,
      ...(parents.has(e.id) ? { group: true } : {}),
      role: roleOf(e.kind, e.tags),
      path: e.at,
    });
  const within = (id: string, scope: string) => id === scope || id.startsWith(scope + '.');
  const finer = (r: Catalogue['relations'][number]) =>
    cat.relations.some((o) => o !== r && within(o.from, r.from) && within(o.to, r.to) && (o.from !== r.from || o.to !== r.to));
  const relations: TraceRelation[] = cat.relations
    .filter((r) => elements.has(r.from) && elements.has(r.to) && r.from !== r.to && !finer(r))
    .map((r) => ({
      id: `r${r.index}`,
      from: r.from,
      to: r.to,
      ...(r.label ? { label: r.label } : {}),
      ...(r.technology ? { technology: r.technology } : {}),
      async: !!r.style && ASYNC.test(r.style),
      path: r.at,
    }));
  return { title, elements, relations, model: true };
}
