// API descriptions → diagrams. OpenAPI 3.x and Swagger 2 become a `type: systems` view of the API:
// its tags as groups, the resources under each (/orders, /orders/{id} … one card a resource, never one
// a path, and folded into a counted card when a tag has many), the servers it runs on, how callers
// sign in (security schemes) and what it calls back (callbacks, webhooks). An operation with callbacks
// also gives a `type: sequence` of that exchange. AsyncAPI 2 and 3 become the services and the
// channels between them: topics and queues, publishers and subscribers, message names on the lines;
// several AsyncAPI files read together meet on the channels they share.
import { parse } from 'yaml';
import { writeDrawn, type Drawn } from './graph-keep.ts';
import { isObj, str, type Obj } from './keep.ts';
import { scalar, slug, Warnings } from './text.ts';
import type { ImportedBlock } from './index.ts';

export interface ApiOptions {
  title?: string;
  existing?: string;
  tag?: boolean;
  /** Above this many resources under one tag, the rest are one counted card. 6 when not given. */
  resourcesPerTag?: number;
}

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function readDoc(text: string): Obj | undefined {
  try {
    const v = /^\s*\{/.test(text) ? (JSON.parse(text) as unknown) : (parse(text, { maxAliasCount: 1000 }) as unknown);
    return isObj(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** OpenAPI 3.x or Swagger 2.0, as YAML or JSON. */
export function isOpenApi(text: string): boolean {
  if (!/["']?(openapi|swagger)["']?\s*:\s*["']?[23]\./.test(text)) return false;
  const d = readDoc(text);
  return !!d && (/^3\./.test(String(d.openapi ?? '')) || String(d.swagger ?? '') === '2.0') && (isObj(d.paths) || isObj(d.webhooks));
}

/** AsyncAPI 2.x or 3.x. */
export function isAsyncApi(text: string): boolean {
  if (!/["']?asyncapi["']?\s*:\s*["']?[23]\./.test(text)) return false;
  const d = readDoc(text);
  return !!d && /^[23]\./.test(String(d.asyncapi ?? '')) && isObj(d.channels);
}

/** A local $ref (#/components/…) followed; anything else as it is. */
function deref(doc: Obj, v: unknown, depth = 0): unknown {
  if (!isObj(v) || typeof v.$ref !== 'string' || depth > 10) return v;
  if (!v.$ref.startsWith('#/')) return v;
  let at: unknown = doc;
  for (const p of v.$ref.slice(2).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))) at = isObj(at) ? at[p] : undefined;
  return at === undefined ? v : deref(doc, at, depth + 1);
}
const refName = (v: unknown): string | undefined => (isObj(v) && typeof v.$ref === 'string' ? v.$ref.split('/').pop() : undefined);

/** /orders/{orderId}/items → orders: the first segment that is not a version or a parameter. */
function resourceOf(path: string): string {
  const segs = path.split('/').filter(Boolean);
  const first = segs.find((s) => !/^\{.*\}$/.test(s) && !/^v\d+(\.\d+)?$/i.test(s) && s !== 'api');
  return first ?? '/';
}

const hostOf = (url: string) => /^[a-z]+:\/\/([^/]+)/i.exec(url)?.[1] ?? url;

// ---------------------------------------------------------------- OpenAPI

export function importOpenApi(text: string, name = 'api', opts: ApiOptions = {}): (ImportedBlock & { summary: string; file: string })[] {
  const warn = new Warnings();
  const doc = readDoc(text);
  if (!doc) return [{ yaml: '', warnings: ['Not an OpenAPI or Swagger file that can be read'], line: 0, summary: '', file: name }];
  const swagger = String(doc.swagger ?? '') === '2.0';
  const info = isObj(doc.info) ? doc.info : {};
  const title = opts.title ?? str(info.title) ?? 'API';
  const perTag = opts.resourcesPerTag ?? 6;

  // ---- operations, by tag and resource
  type Op = { method: string; path: string; tags: string[]; security?: unknown[]; callbacks: [string, Obj][]; summary?: string; id?: string };
  const ops: Op[] = [];
  const addOps = (paths: Obj) => {
    for (const [path, item] of Object.entries(paths)) {
      const p = deref(doc, item);
      if (!isObj(p)) continue;
      for (const m of METHODS) {
        const o = deref(doc, p[m]);
        if (!isObj(o)) continue;
        const callbacks = isObj(o.callbacks) ? Object.entries(o.callbacks).map(([k, v]) => [k, deref(doc, v)] as [string, Obj]).filter(([, v]) => isObj(v)) : [];
        ops.push({ method: m.toUpperCase(), path, tags: Array.isArray(o.tags) && o.tags.length ? o.tags.map(String) : [], security: Array.isArray(o.security) ? o.security : undefined, callbacks, summary: str(o.summary), id: str(o.operationId) });
      }
    }
  };
  addOps(isObj(doc.paths) ? doc.paths : {});
  const declaredTags = Array.isArray(doc.tags) ? doc.tags.filter(isObj).map((t) => ({ name: String(t.name), description: str(t.description) })) : [];
  // Without tags, the resources themselves are what groups the operations.
  const tagged = ops.some((o) => o.tags.length);
  const tagOf = (o: Op) => (tagged ? (o.tags[0] ?? 'untagged') : resourceOf(o.path));
  const tags = [...new Set([...declaredTags.map((t) => t.name).filter((t) => ops.some((o) => tagOf(o) === t)), ...ops.map(tagOf)])];

  const groups: Record<string, Obj> = {};
  const nodes: Record<string, Obj> = {};
  const edges: unknown[] = [];
  const used = new Set<string>(['clients', 'api', 'server', 'callbacks', 'subscribers']);
  const id = (want: string) => {
    let base = slug(want).toLowerCase() || 'item';
    let out = base;
    for (let i = 2; used.has(out); i++) out = `${base}-${i}`;
    used.add(out);
    return out;
  };

  groups.api = { kind: 'system', label: title, ...(str(info.version) ? { caption: `v${String(info.version).replace(/^v/, '')}` } : {}) };
  nodes.clients = { kind: 'users', label: 'API clients' };

  // Servers: where it runs. One card for all of them (production, staging … are the same API), so
  // every resource has one line in, not one per server.
  const servers: { url: string; description?: string }[] = swagger
    ? [{ url: `${(Array.isArray(doc.schemes) ? doc.schemes[0] : 'https') as string}://${str(doc.host) ?? 'host'}${str(doc.basePath) ?? ''}` }]
    : (Array.isArray(doc.servers) ? doc.servers.filter(isObj) : []).map((s) => ({ url: String(s.url ?? '/'), description: str(s.description) }));
  const named = servers.map((s) => s.description).filter((x): x is string => !!x);
  nodes.server = {
    kind: 'gateway',
    label: servers[0] ? hostOf(servers[0].url) : 'API',
    caption: servers.length > 1 ? (named.length === servers.length && servers.length <= 4 ? named.join(' · ') : plural(servers.length, 'server')) : named[0],
    in: 'api',
  };
  edges.push({ 'clients -> server': { label: servers.some((s) => /^http:/i.test(s.url)) && !servers.some((s) => /^https:/i.test(s.url)) ? 'HTTP' : 'HTTPS', style: 'sync' } });
  const resourceIds = new Map<string, string>();

  // Tags and their resources.
  for (const t of tags) {
    const mine = ops.filter((o) => tagOf(o) === t);
    const gid = id(`tag-${t}`);
    const desc = declaredTags.find((d) => d.name === t)?.description;
    groups[gid] = { kind: 'domain', label: t, in: 'api', ...(desc ? { description: desc } : {}) };
    const byRes = new Map<string, Op[]>();
    for (const o of mine) {
      const r = tagged ? `/${resourceOf(o.path)}` : o.path.split('/').slice(0, 3).join('/') || '/';
      byRes.set(r, [...(byRes.get(r) ?? []), o]);
    }
    const res = [...byRes];
    const shown = res.length > perTag ? res.slice(0, perTag - 1) : res;
    for (const [r, list] of shown) {
      const methods = [...new Set(list.map((o) => o.method))];
      const rid = id(`${t}-${r}`);
      nodes[rid] = { kind: 'api', label: r, caption: `${methods.join(' · ')}${list.length > methods.length ? ` · ${list.length} operations` : ''}`, in: gid };
      for (const o of list) resourceIds.set(`${o.method} ${o.path}`, rid);
      edges.push({ [`server -> ${rid}`]: { style: 'sync' } });
    }
    if (shown.length < res.length) {
      const rest = res.slice(shown.length);
      const rid = id(`${t}-more`);
      nodes[rid] = { kind: 'api', label: `${plural(rest.length, 'more resource')}`, caption: `${rest.reduce((n, [, l]) => n + l.length, 0)} operations`, in: gid };
      for (const [, l] of rest) for (const o of l) resourceIds.set(`${o.method} ${o.path}`, rid);
      edges.push({ [`server -> ${rid}`]: { style: 'sync' } });
    }
  }
  if (!ops.length) warn.add('No operations under paths:');

  // ---- security: how callers sign in
  const schemes = isObj(isObj(doc.components) ? (doc.components as Obj).securitySchemes : undefined) ? ((doc.components as Obj).securitySchemes as Obj) : isObj(doc.securityDefinitions) ? doc.securityDefinitions : {};
  const usedSchemes = new Set<string>();
  for (const req of [...(Array.isArray(doc.security) ? doc.security : []), ...ops.flatMap((o) => o.security ?? [])]) if (isObj(req)) for (const k of Object.keys(req)) usedSchemes.add(k);
  for (const [k, raw] of Object.entries(schemes)) {
    const s = deref(doc, raw);
    if (!isObj(s)) continue;
    const type = String(s.type ?? '');
    const flows = isObj(s.flows) ? Object.keys(s.flows) : str(s.flow) ? [str(s.flow)!] : [];
    const url = isObj(s.flows) ? Object.values(s.flows as Obj).filter(isObj).map((f) => str(f.tokenUrl) ?? str(f.authorizationUrl)).find(Boolean) : (str(s.tokenUrl) ?? str(s.openIdConnectUrl));
    const label = type === 'oauth2' ? 'OAuth 2' : type === 'openIdConnect' ? 'OpenID Connect' : type === 'apiKey' ? `API key` : type === 'http' ? `HTTP ${str(s.scheme) ?? ''}`.trim() : type === 'basic' ? 'HTTP basic' : type || k;
    const caption = type === 'apiKey' ? `${str(s.name) ?? ''} in ${str(s.in) ?? 'header'}`.trim() : flows.length ? flows.join(', ') : url ? hostOf(url) : undefined;
    const sid = id(`auth-${k}`);
    nodes[sid] = { kind: type === 'apiKey' || type === 'http' || type === 'basic' ? 'secrets' : 'identity', label: url && (type === 'oauth2' || type === 'openIdConnect') ? hostOf(url) : label, caption: url && (type === 'oauth2' || type === 'openIdConnect') ? `${label}${flows.length ? ` · ${flows.join(', ')}` : ''}` : caption };
    edges.push({ [`clients -> ${sid}`]: { label: type === 'oauth2' || type === 'openIdConnect' ? 'token' : 'key', style: 'dotted' } });
    if (!usedSchemes.has(k)) warn.add(`The security scheme ${k} is declared but no operation asks for it`);
  }
  const open = ops.filter((o) => Array.isArray(o.security) && !o.security.length).length;

  // ---- what it calls back
  const withCallbacks = ops.filter((o) => o.callbacks.length);
  if (withCallbacks.length) {
    nodes.callbacks = { kind: 'external', label: 'Callback receivers', caption: 'the URL the caller gives' };
    for (const o of withCallbacks) {
      edges.push({ [`${resourceIds.get(`${o.method} ${o.path}`) ?? 'api'} -> callbacks`]: { label: o.callbacks.map(([k]) => k).join(', '), style: 'async' } });
    }
  }
  const webhooks = isObj(doc.webhooks) ? Object.keys(doc.webhooks) : [];
  if (webhooks.length) {
    nodes.subscribers = { kind: 'external', label: 'Webhook subscribers' };
    edges.push({ ['api -> subscribers']: { label: webhooks.length > 3 ? `${webhooks.slice(0, 2).join(', ')} +${webhooks.length - 2}` : webhooks.join(', '), style: 'async' } });
  }

  const d: Drawn = {
    type: 'systems',
    head: { title, subtitle: str(info.description)?.split(/(?<=\.)\s/)[0] ?? `${swagger ? 'Swagger 2' : `OpenAPI ${String(doc.openapi)}`}: the API by tag`, captions: 'written', direction: 'right' },
    maps: { groups, nodes },
    lists: { edges },
    mine: { nodes: ['caption'], groups: ['caption'] },
  };
  const yaml = writeDrawn(d, opts, warn);
  const summary = `${plural(ops.length, 'operation')} in ${plural(tags.length, tagged ? 'tag' : 'resource')}${Object.keys(schemes).length ? `, ${plural(Object.keys(schemes).length, 'security scheme')}` : ''}${open ? `, ${open} open` : ''}`;
  const out: (ImportedBlock & { summary: string; file: string })[] = [{ yaml, warnings: warn.list, line: 0, summary, file: name }];

  // ---- the exchange of the first operation with callbacks, as a sequence
  const first = withCallbacks[0];
  if (first) {
    const lines = ['type: sequence', `title: ${scalar(`${first.summary ?? `${first.method} ${first.path}`}, with its callback`)}`, '', 'participants:', '  client: { kind: service, label: API client }', `  api: { kind: service, label: ${scalar(title)} }`, '', 'messages:', `  - client -> api: ${scalar(`${first.method} ${first.path}`)}`];
    const responses = (() => {
      const item = deref(doc, (doc.paths as Obj)[first.path]);
      const op = isObj(item) ? deref(doc, item[first.method.toLowerCase()]) : undefined;
      return isObj(op) && isObj(op.responses) ? Object.keys(op.responses) : [];
    })();
    lines.push(`  - api --> client: ${scalar(responses.find((r) => /^2/.test(r)) ?? '200')}`);
    for (const [cbName, cb] of first.callbacks) {
      for (const [, item] of Object.entries(cb)) {
        const it = deref(doc, item);
        if (!isObj(it)) continue;
        for (const m of METHODS) {
          const o = deref(doc, it[m]);
          if (!isObj(o)) continue;
          lines.push(`  - api -> client: ${scalar(`${m.toUpperCase()} callback (${cbName})`)}`);
          if (str(o.summary)) lines.push(`  - note: ${scalar(str(o.summary)!)}`, '    over: client');
          const codes = isObj(o.responses) ? Object.keys(o.responses) : [];
          lines.push(`  - client --> api: ${scalar(codes.find((r) => /^2/.test(r)) ?? '200')}`);
        }
      }
    }
    out.push({ yaml: lines.join('\n') + '\n', warnings: [], line: 0, name: `${first.id ?? first.path} callbacks`, summary: `${plural(first.callbacks.length, 'callback')} of ${first.method} ${first.path}`, file: `${name}-callbacks` });
  }
  return out;
}

// ---------------------------------------------------------------- AsyncAPI

interface Channel {
  key: string;
  address: string;
  kind: 'topic' | 'queue';
  broker?: string;
  description?: string;
}

/** One or more AsyncAPI files, each one application: the services and the channels between them. */
export function importAsyncApi(files: { path: string; text: string }[], opts: ApiOptions = {}): ImportedBlock & { summary: string } {
  const warn = new Warnings();
  const channels = new Map<string, Channel>();
  const brokers = new Map<string, { label: string; protocol: string }>();
  const apps: { id: string; label: string; caption?: string }[] = [];
  const flows: { from: string; to: string; messages: Set<string> }[] = [];
  const flow = (from: string, to: string, messages: string[]) => {
    let f = flows.find((x) => x.from === from && x.to === to);
    if (!f) flows.push((f = { from, to, messages: new Set() }));
    for (const m of messages) f.messages.add(m);
  };
  const used = new Set<string>();
  const uid = (want: string) => {
    const base = slug(want).toLowerCase() || 'item';
    let out = base;
    for (let i = 2; used.has(out); i++) out = `${base}-${i}`;
    used.add(out);
    return out;
  };
  const TOPICS = /^(kafka|kafka-secure|pulsar|sns|googlepubsub|mqtt|mqtt5|secure-mqtt|nats|redis|solace|mercure|ws|wss|http|https|eventbridge)$/i;

  for (const f of files) {
    const doc = readDoc(f.text);
    if (!doc || !isObj(doc.channels)) {
      warn.add(`${f.path}: not an AsyncAPI file that can be read`);
      continue;
    }
    const v3 = /^3\./.test(String(doc.asyncapi));
    const info = isObj(doc.info) ? doc.info : {};
    const app = { id: uid(str(info.title) ?? f.path.split('/').pop()!.replace(/\.[^.]+$/, '')), label: str(info.title) ?? f.path, caption: str(info.version) ? `v${String(info.version).replace(/^v/, '')}` : undefined };
    apps.push(app);
    // Servers: the brokers, by host, so two files that name one broker meet there.
    const serverOf = new Map<string, string>();
    for (const [k, s] of Object.entries(isObj(doc.servers) ? doc.servers : {})) {
      if (!isObj(s)) continue;
      const host = String(s.host ?? s.url ?? k).replace(/^[a-z]+:\/\//i, '');
      const protocol = String(s.protocol ?? '');
      serverOf.set(k, host);
      if (!brokers.has(host)) brokers.set(host, { label: host.split(':')[0]!, protocol });
    }
    const brokerFor = (ch: Obj): string | undefined => {
      const list = Array.isArray(ch.servers) ? ch.servers.map((s) => refName(s) ?? String(s)) : [];
      const named = list.map((s) => serverOf.get(s)).find(Boolean);
      return named ?? (serverOf.size === 1 ? [...serverOf.values()][0] : undefined);
    };
    const channel = (key: string, ch: Obj): Channel => {
      const address = v3 ? (str(ch.address) ?? key) : key;
      const broker = brokerFor(ch);
      const known = channels.get(`${broker ?? ''}|${address}`);
      if (known) return known;
      const amqp = isObj(ch.bindings) && isObj((ch.bindings as Obj).amqp) ? ((ch.bindings as Obj).amqp as Obj) : undefined;
      const protocol = broker ? (brokers.get(broker)?.protocol ?? '') : '';
      const kind: Channel['kind'] = amqp ? (amqp.is === 'routingKey' ? 'topic' : 'queue') : TOPICS.test(protocol) ? 'topic' : /amqp|sqs|jms|ibmmq|stomp|anypointmq/i.test(protocol) ? 'queue' : 'topic';
      const c: Channel = { key: uid(`ch-${address}`), address, kind, broker, description: str(ch.description) };
      channels.set(`${broker ?? ''}|${address}`, c);
      return c;
    };
    const messageNames = (list: unknown[]): string[] =>
      list.flatMap((m) => {
        const d = deref(doc, m);
        if (isObj(d) && Array.isArray(d.oneOf)) return messageNames(d.oneOf);
        return [isObj(d) ? (str(d.name) ?? str(d.title) ?? refName(m)) : refName(m)].filter((x): x is string => !!x);
      });
    if (v3) {
      const byKey = new Map<string, { ch: Obj; key: string }>();
      for (const [k, ch] of Object.entries(doc.channels as Obj)) if (isObj(ch)) byKey.set(k, { ch, key: k });
      const ops = isObj(doc.operations) ? doc.operations : {};
      for (const [k, raw] of Object.entries(ops)) {
        const o = deref(doc, raw);
        if (!isObj(o)) continue;
        const target = byKey.get(refName(o.channel) ?? '');
        if (!target) {
          warn.add(`${f.path}: the operation ${k} names no channel of this file`);
          continue;
        }
        const c = channel(target.key, target.ch);
        const msgs = Array.isArray(o.messages) && o.messages.length ? messageNames(o.messages) : messageNames(Object.values(isObj(target.ch.messages) ? target.ch.messages : {}));
        if (o.action === 'send') flow(app.id, c.key, msgs);
        else if (o.action === 'receive') flow(c.key, app.id, msgs);
      }
      for (const { ch, key } of byKey.values()) channel(key, ch);
    } else {
      for (const [k, raw] of Object.entries(doc.channels as Obj)) {
        const ch = deref(doc, raw);
        if (!isObj(ch)) continue;
        const c = channel(k, ch);
        // AsyncAPI 2 speaks from the other side: publish is what the application receives, subscribe what it sends.
        const msgs = (op: unknown) => (isObj(op) ? messageNames([op.message].filter(Boolean)) : []);
        if (isObj(ch.subscribe)) flow(app.id, c.key, msgs(ch.subscribe));
        if (isObj(ch.publish)) flow(c.key, app.id, msgs(ch.publish));
      }
    }
  }
  if (!apps.length) return { yaml: '', warnings: warn.list, line: 0, summary: '' };

  const groups: Record<string, Obj> = {};
  const brokerIds = new Map<string, string>();
  // Each broker a zone, its channels in it.
  const live = new Set([...channels.values()].map((c) => c.broker).filter((b): b is string => !!b));
  for (const b of live) {
      const info = brokers.get(b)!;
      const gid = uid(`broker-${info.label}`);
      brokerIds.set(b, gid);
    groups[gid] = { kind: 'zone', label: info.label, caption: info.protocol || undefined };
  }
  const nodes: Record<string, Obj> = {};
  for (const a of apps) nodes[a.id] = { kind: 'service', label: a.label, ...(a.caption ? { caption: a.caption } : {}) };
  for (const c of channels.values()) nodes[c.key] = { kind: c.kind, label: c.address, ...(c.broker && brokerIds.has(c.broker) ? { in: brokerIds.get(c.broker) } : {}) };
  const edges = flows.map((f) => {
    const m = [...f.messages];
    const label = m.length > 2 ? `${m.slice(0, 2).join(', ')} +${m.length - 2}` : m.join(', ');
    return { [`${f.from} -> ${f.to}`]: label ? { label, style: 'async' } : { style: 'async' } };
  });
  const title = opts.title ?? (apps.length === 1 ? `${apps[0]!.label} events` : 'Events');
  const d: Drawn = {
    type: 'systems',
    head: { title, subtitle: 'From the AsyncAPI files: who sends what to which channel', captions: 'written' },
    maps: { groups, nodes },
    lists: { edges },
  };
  const yaml = writeDrawn(d, opts, warn);
  const shared = [...channels.values()].filter((c) => flows.some((f) => f.to === c.key) && flows.some((f) => f.from === c.key)).length;
  return { yaml, warnings: warn.list, line: 0, summary: `${plural(apps.length, 'service')}, ${plural(channels.size, 'channel')}${shared ? ` (${shared} with both ends here)` : ''}` };
}
