// What the rules look at: the drawn graph (kinds, groups and nesting, lines with their styles and
// labels, badges, tags) joined with what the YAML says about each element (public, zones, sku,
// props, env, …), so a rule is a few lines over named things rather than a walk over YAML.
import { nodeLabel, type Graph, type GraphEdge, type Path } from '@cartography/core';

export interface El {
  id: string;
  /** A group (subscription, VNet, namespace) rather than a card. */
  group: boolean;
  kind?: string;
  label: string;
  tags: string[];
  parent?: string;
  /** The entry as written in the YAML (empty when it is written short or comes from another file). */
  props: Record<string, unknown>;
  path: Path;
  /** Greyed out as outside the scope (C4 external). */
  muted: boolean;
}

export interface Line {
  id: string;
  from: string;
  to: string;
  label: string;
  /** The style as written (public, private, identity, …), or the kind of line as the type names it. */
  style: string;
  props: Record<string, unknown>;
  path: Path;
  /** Drawn as a badge on the source card (identity, diagnostics) rather than a line. */
  badge: boolean;
}

/** Who is outside: people, the internet, systems of others. */
const OUTSIDE = new Set(['user', 'users', 'person', 'internet', 'external', 'external-system', 'customer', 'customers', 'guest', 'connected-org', 'outside-collaborator']);
/** Lines that do not wait for an answer. */
const ASYNC = /\b(async|asynchronous|event|events|publish(es)?|subscribe(s)?|pub\/sub|emits?|queue[sd]?|enqueue|topic|stream|kafka|webhook|notif(y|ies|ication)|replicat(es|ion)|cdc|batch|nightly|daily|hourly|backup|sync job)\b/i;
const QUEUES = new Set(['queue', 'topic', 'service-bus', 'event-hub', 'event-grid', 'sqs', 'sns', 'eventbridge', 'kinesis', 'msk', 'pubsub', 'eventarc', 'firehose', 'stream']);
const PROD = /\b(prod|production|prd|live)\b/i;

/** Reads a value from parsed YAML at a path. */
export function valueAt(data: unknown, path: Path): unknown {
  let v = data;
  for (const k of path) {
    if (v == null || typeof v !== 'object') return undefined;
    v = (v as Record<string | number, unknown>)[k];
  }
  return v;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The properties of a line as written: `- a -> b: { … }` or `- { from, to, … }`. */
function edgeProps(data: unknown, path: Path): Record<string, unknown> {
  const item = valueAt(data, path);
  const o = obj(item);
  if ('from' in o && 'to' in o) return o;
  const keys = Object.keys(o);
  if (keys.length === 1) {
    const v = o[keys[0]!];
    return typeof v === 'string' ? { label: v } : obj(v);
  }
  return {};
}

export interface ModelInput {
  graph: Graph;
  /** The YAML as parsed (the whole file). */
  data: Record<string, unknown>;
  /** The type it draws as: azure, cloud, systems, c4, … */
  type: string;
  /** Reads files the diagram refers to (data contracts), relative to it. */
  load?: (file: string) => string;
}

export class ReviewModel {
  readonly type: string;
  readonly graph: Graph;
  readonly data: Record<string, unknown>;
  readonly load?: (file: string) => string;
  readonly nodes = new Map<string, El>();
  readonly groups = new Map<string, El>();
  readonly lines: Line[] = [];
  private outs = new Map<string, Line[]>();
  private ins = new Map<string, Line[]>();

  constructor(input: ModelInput) {
    this.type = input.type;
    this.graph = input.graph;
    this.data = input.data;
    this.load = input.load;
    const entry = (path: Path) => obj(valueAt(input.data, path));
    for (const g of input.graph.groups) this.groups.set(g.id, { id: g.id, group: true, kind: g.kind, label: g.label, tags: g.tags ?? [], parent: g.parent, props: entry(g.path), path: g.path, muted: false });
    for (const n of input.graph.nodes)
      this.nodes.set(n.id, { id: n.id, group: false, kind: n.kind, label: nodeLabel(n), tags: n.tags ?? [], parent: n.parent, props: entry(n.path), path: n.path, muted: n.shape.kind === 'card' && !!n.shape.muted });
    for (const e of input.graph.edges) {
      const props = e.path[0] === 'edges' ? edgeProps(input.data, e.path) : {};
      const line: Line = { id: e.id, from: e.from.node, to: e.to.node, label: e.label ?? '', style: typeof props.style === 'string' ? props.style : (e.kind ?? '').toLowerCase(), props, path: e.path, badge: !!e.badge };
      this.lines.push(line);
      this.outs.set(line.from, [...(this.outs.get(line.from) ?? []), line]);
      this.ins.set(line.to, [...(this.ins.get(line.to) ?? []), line]);
    }
  }

  el(id: string): El | undefined {
    return this.nodes.get(id) ?? this.groups.get(id);
  }
  name(id: string): string {
    return this.el(id)?.label ?? id;
  }
  lineName(l: Line): string {
    return `${this.name(l.from)} → ${this.name(l.to)}`;
  }
  edge(id: string): GraphEdge | undefined {
    return this.graph.edges.find((e) => e.id === id);
  }
  /** Lines out of and into an element (badges too: they are links all the same). */
  out(id: string): Line[] {
    return this.outs.get(id) ?? [];
  }
  in(id: string): Line[] {
    return this.ins.get(id) ?? [];
  }
  /** The elements one line away, either way. */
  neighbours(id: string): string[] {
    return [...new Set([...this.out(id).map((l) => l.to), ...this.in(id).map((l) => l.from)])];
  }
  /** The groups around an element, innermost first. */
  ancestors(id: string): El[] {
    const out: El[] = [];
    const seen = new Set<string>();
    for (let p = this.el(id)?.parent; p && !seen.has(p); p = this.groups.get(p)?.parent) {
      seen.add(p);
      const g = this.groups.get(p);
      if (g) out.push(g);
    }
    return out;
  }
  /** Everything inside a group, at any depth. */
  inside(group: string): El[] {
    return [...this.nodes.values(), ...this.groups.values()].filter((e) => e.id !== group && this.ancestors(e.id).some((g) => g.id === group));
  }
  ofKind(...kinds: string[]): El[] {
    return [...this.nodes.values(), ...this.groups.values()].filter((e) => !!e.kind && kinds.includes(e.kind));
  }
  has(...kinds: string[]): boolean {
    return this.ofKind(...kinds).length > 0;
  }
  tagged(id: string, ...tags: string[]): boolean {
    const t = this.el(id)?.tags ?? [];
    return tags.some((x) => t.includes(x));
  }
  prop(id: string, key: string): unknown {
    const e = this.el(id);
    if (!e) return undefined;
    return key in e.props ? e.props[key] : obj(e.props.props)[key];
  }
  /** A setting written as text, lower case ("calico", "true", "waf_v2"); undefined when not written. */
  said(id: string, ...keys: string[]): string | undefined {
    for (const k of keys) {
      const v = this.prop(id, k);
      if (v != null && typeof v !== 'object') return String(v).toLowerCase();
    }
    return undefined;
  }
  /** People, the internet and other people's systems. */
  outsider(id: string): boolean {
    const e = this.el(id);
    if (!e) return false;
    return (!!e.kind && OUTSIDE.has(e.kind)) || e.tags.includes('external') || e.muted || e.props.external === true;
  }
  /** Reachable from the internet, as written: public: true, exposure: public, or an internet-facing load balancer. */
  publicSaid(id: string): boolean | undefined {
    const p = this.prop(id, 'public');
    if (typeof p === 'boolean') return p;
    const x = this.said(id, 'exposure', 'scheme', 'public-network-access', 'public-access');
    if (x === undefined) return undefined;
    return ['public', 'internet-facing', 'enabled', 'true', 'blob', 'container'].includes(x);
  }
  /** A line that does not wait for an answer: an event, a message, a stream, replication. */
  async(l: Line): boolean {
    return ASYNC.test(`${l.label} ${l.style}`) || QUEUES.has(this.el(l.to)?.kind ?? '') || QUEUES.has(this.el(l.from)?.kind ?? '');
  }
  /** The environments an element is in, as written (env: prod or [test, prod]). */
  envs(id: string): string[] {
    const v = this.el(id)?.props.env;
    return typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  }
  /**
   * This drawing is of production: its title or subtitle says so, a subscription, account or
   * environment group is called that, or what is drawn is in env prod. A drawing of several
   * environments is not, as a whole.
   */
  get production(): boolean {
    if (this.#prod !== undefined) return this.#prod;
    const envs = new Set([...this.nodes.keys(), ...this.groups.keys()].flatMap((id) => this.envs(id)));
    const said = `${this.graph.title ?? ''} ${this.graph.subtitle ?? ''}`;
    const tags = [...this.nodes.values(), ...this.groups.values()].some((e) => e.tags.some((t) => PROD.test(t)));
    const groups = [...this.groups.values()].some((g) => ['subscription', 'account', 'project', 'environment', 'resource-group', 'cluster', 'namespace', 'deployment-node'].includes(g.kind ?? '') && PROD.test(`${g.label} ${g.id}`));
    this.#prod = envs.size ? [...envs].some((e) => PROD.test(e)) && envs.size === 1 : PROD.test(said) || groups || tags;
    return this.#prod;
  }
  #prod?: boolean;
}
