// Docker Compose files (compose.yaml, docker-compose*.yml) → a `type: systems` diagram of what runs.
// Services are cards, their kind guessed from the image (postgres a database, rabbitmq a queue, nginx
// a gateway, keycloak the identity provider …) or, for what is built here, from its name and its
// Dockerfile. depends_on, links and the URLs in the environment are the lines; networks that keep
// services apart are zones; published ports come in from outside; named volumes are badges on the
// card that keeps them (a store of their own when several services share one).
import { parseDocument } from 'yaml';
import { guessKind } from './systems.ts';
import { writeDrawn, type Drawn } from './graph-keep.ts';
import { isObj, str, type Obj } from './keep.ts';
import { slug, Warnings } from './text.ts';
import type { Imported } from './index.ts';

export interface ComposeOptions {
  title?: string;
  /** The diagram an earlier import made: what the compose file says follows it, what was written by hand stays. */
  existing?: string;
  /** Tag every entry `imported`, for an import that will be done again (a repository scan). */
  tag?: boolean;
  /** Other files of the repository by path relative to the compose file: Dockerfiles say what a built service is. */
  files?: Record<string, string>;
  /** compose.override.yaml and the like: read over the file, as `docker compose` does. */
  overrides?: string[];
}

/** The file names Compose itself looks for, and the docker-compose.prod.yml kind next to them. */
export const isComposeName = (name: string): boolean => /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/i.test(name);

/** Whether a text is a Compose file: services: with images or builds, no apiVersion. */
export function isCompose(text: string): boolean {
  if (!/^services\s*:/m.test(text) || /^apiVersion\s*:/m.test(text) || /^type\s*:/m.test(text)) return false;
  const doc = read(text);
  return !!doc && isObj(doc.services) && Object.values(doc.services).some((s) => isObj(s) && (s.image !== undefined || s.build !== undefined || s.extends !== undefined));
}

function read(text: string): Obj | undefined {
  const doc = parseDocument(text.replace(/\r\n?/g, '\n'), { merge: true });
  if (doc.errors.length) return undefined;
  const js = doc.toJS({ maxAliasCount: 1000 }) as unknown;
  return isObj(js) ? js : undefined;
}

// The image's name, without registry, owner or tag, says what most off-the-shelf services are.
const IMAGES: [string, RegExp, string?][] = [
  ['database', /^(postgres|postgis|timescaledb|mysql|mariadb|percona|mongo|mongodb|cockroach|cassandra|scylla|couchdb|neo4j|mssql|sql-?server|oracle|clickhouse|influxdb|surrealdb|arangodb|yugabyte|supabase)/],
  ['cache', /^(redis|valkey|keydb|dragonfly|memcached|varnish|hazelcast)/],
  ['queue', /^(rabbitmq|activemq|artemis|nats|beanstalkd|celery|sqs|elasticmq|localstack-sqs)/],
  ['topic', /^(kafka|cp-kafka|redpanda|pulsar|zookeeper|cp-zookeeper|eventstore|kafka-ui)/],
  ['gateway', /^(nginx|openresty|traefik|envoy|haproxy|caddy|kong|apisix|tyk|httpd|apache)/],
  ['identity', /^(keycloak|authentik|dex|zitadel|authelia|oauth2-proxy|ory|hydra|kratos|logto|openldap|ldap)/],
  ['storage', /^(minio|azurite|seaweedfs|localstack|fake-gcs|s3)/],
  ['search', /^(elasticsearch|opensearch|meilisearch|typesense|solr|manticore|zinc)/],
  ['monitoring', /^(prometheus|grafana|loki|tempo|jaeger|zipkin|otel|opentelemetry|alertmanager|node-exporter|cadvisor|datadog|signoz|uptime-kuma|kibana|logstash|fluentd|fluent-bit|promtail|vector)/],
  ['email', /^(mailpit|mailhog|mailcatcher|smtp|postfix|maildev|greenmail)/],
  ['secrets', /^(vault|openbao|infisical)/],
  ['ai', /^(ollama|vllm|text-generation-inference|localai)/],
];
/** What a card is called under its name, from the image: "PostgreSQL 16". */
const PRODUCT: Record<string, string> = { postgres: 'PostgreSQL', mysql: 'MySQL', mariadb: 'MariaDB', mongo: 'MongoDB', redis: 'Redis', valkey: 'Valkey', rabbitmq: 'RabbitMQ', kafka: 'Kafka', nginx: 'nginx', traefik: 'Traefik', keycloak: 'Keycloak', minio: 'MinIO', elasticsearch: 'Elasticsearch', opensearch: 'OpenSearch', prometheus: 'Prometheus', grafana: 'Grafana', mailpit: 'Mailpit', mailhog: 'MailHog', vault: 'Vault', 'opentelemetry-collector': 'OpenTelemetry Collector', 'opentelemetry-collector-contrib': 'OpenTelemetry Collector', memcached: 'Memcached', envoy: 'Envoy', caddy: 'Caddy', haproxy: 'HAProxy', jaeger: 'Jaeger', node: 'Node.js', python: 'Python', golang: 'Go', openjdk: 'Java', 'eclipse-temurin': 'Java', dotnet: '.NET', aspnet: 'ASP.NET', ruby: 'Ruby', php: 'PHP', rust: 'Rust', deno: 'Deno', bun: 'Bun' };

/** postgres:16 → { name: postgres, tag: 16 }; quay.io/keycloak/keycloak:25.0 → keycloak, 25.0. */
function imageName(image: string): { name: string; tag?: string } {
  const at = image.replace(/@sha256:.*$/, '');
  const slash = at.lastIndexOf('/');
  const colon = at.lastIndexOf(':');
  const tag = colon > slash ? at.slice(colon + 1) : undefined;
  return { name: (colon > slash ? at.slice(0, colon) : at).slice(slash + 1).toLowerCase(), tag };
}

/** "PostgreSQL 16" from postgres:16, "Node.js 20" from node:20-alpine; nothing for a tag that says nothing. */
function product(image: string): string | undefined {
  const { name, tag } = imageName(image);
  const base = PRODUCT[name] ?? PRODUCT[name.replace(/-.*$/, '')];
  const version = /^v?(\d+(\.\d+)?)/.exec(tag ?? '')?.[1];
  if (!base) return undefined;
  return version ? `${base} ${version}` : base;
}

/** What a Dockerfile says: the image the last stage runs on, and the ports it exposes. */
export function dockerHint(text: string): { base?: string; first?: string; expose: number[] } {
  const lines = text.replace(/\\\r?\n/g, ' ').split(/\r?\n/);
  let base: string | undefined;
  let first: string | undefined;
  const stages = new Map<string, string>();
  const expose: number[] = [];
  for (const l of lines) {
    const from = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(l);
    if (from) {
      // FROM build-stage: the image that stage was built on.
      base = stages.get(from[1]!.toLowerCase()) ?? from[1]!;
      first ??= base;
      if (from[2]) stages.set(from[2].toLowerCase(), base);
    }
    const ex = /^\s*EXPOSE\s+(.+)$/i.exec(l);
    if (ex) for (const p of ex[1]!.split(/\s+/)) if (/^\d+/.test(p)) expose.push(parseInt(p, 10));
  }
  return { base, first, expose };
}

const SCHEME: Record<string, string> = { http: 'HTTP', https: 'HTTPS', grpc: 'gRPC', amqp: 'AMQP', amqps: 'AMQP', postgres: 'SQL', postgresql: 'SQL', mysql: 'SQL', mongodb: 'MongoDB', redis: 'Redis', rediss: 'Redis', kafka: 'Kafka', nats: 'NATS', smtp: 'SMTP', ws: 'WebSocket', wss: 'WebSocket' };
const STORES = new Set(['database', 'cache', 'storage', 'search', 'warehouse']);
const BROKERS = new Set(['queue', 'topic']);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter((x): x is string => !!x) : isObj(v) ? Object.keys(v) : str(v) ? [str(v)!] : []);

/** Several files read over each other, as `docker compose -f a -f b` does: maps merge, lists add up. */
function over(base: unknown, top: unknown): unknown {
  if (isObj(base) && isObj(top)) {
    const out: Obj = { ...base };
    for (const [k, v] of Object.entries(top)) out[k] = k in base ? over(base[k], v) : v;
    return out;
  }
  if (Array.isArray(base) && Array.isArray(top)) return [...new Set([...base, ...top].map((x) => JSON.stringify(x)))].map((x) => JSON.parse(x) as unknown);
  return top;
}

export interface ImportedCompose extends Imported {
  summary: string;
}

export function importCompose(text: string, opts: ComposeOptions = {}): ImportedCompose {
  const warn = new Warnings();
  let doc = read(text);
  if (!doc) {
    const e = parseDocument(text).errors[0];
    return { yaml: '', warnings: [`Not a Compose file that can be read${e ? `: ${e.message.split('\n')[0]}` : ''}`], summary: '' };
  }
  for (const o of opts.overrides ?? []) {
    const top = read(o);
    if (top) doc = over(doc, top) as Obj;
  }
  const services = isObj(doc.services) ? doc.services : {};
  if (!Object.keys(services).length) return { yaml: '', warnings: ['No services in this Compose file'], summary: '' };
  if (doc.include !== undefined) warn.add(`include: names ${plural(list(doc.include).length, 'other Compose file')}: import ${list(doc.include).length > 1 ? 'them' : 'it'} too, each draws its own services`);

  // extends: within the file, read as the service it extends with this one's keys over it.
  const svc = (name: string, seen = new Set<string>()): Obj => {
    const s = isObj(services[name]) ? services[name] : {};
    const ext = s.extends;
    if (ext === undefined) return s;
    const from = typeof ext === 'string' ? { service: ext } : isObj(ext) ? ext : {};
    if (from.file) {
      warn.onceFor(`extends:${name}`, `${name} extends ${str(from.service)} of ${str(from.file)}, another file: drawn with what it says itself`);
      return s;
    }
    const base = str(from.service);
    if (!base || seen.has(base) || !(base in services)) return s;
    return over(svc(base, new Set([...seen, name])), s) as Obj;
  };
  const all = Object.keys(services).map((name) => ({ name, s: svc(name) }));

  const id = (name: string) => slug(name).toLowerCase();
  const nodes: Record<string, Obj> = {};
  const groups: Record<string, Obj> = {};
  const edges: unknown[] = [];
  const seen = new Set<string>();
  const kinds = new Map<string, string>();
  const line = (from: string, to: string, label?: string) => {
    if (from === to || seen.has(`${from}>${to}`)) return;
    seen.add(`${from}>${to}`);
    const kind = kinds.get(to) ?? '';
    const style = STORES.has(kind) ? 'data' : BROKERS.has(kind) ? 'async' : kind === 'monitoring' ? 'dotted' : 'sync';
    edges.push({ [`${from} -> ${to}`]: label ? { label, style } : { style } });
  };

  // ---- what each service is
  const profiled = new Map<string, string[]>();
  for (const { name, s } of all) {
    const image = str(s.image);
    const build = typeof s.build === 'string' ? s.build : isObj(s.build) ? (str(s.build.context) ?? '.') : undefined;
    const dockerfile = build !== undefined ? (isObj(s.build) && str(s.build.dockerfile)) || 'Dockerfile' : undefined;
    const hint = build !== undefined ? dockerHint(opts.files?.[join(build, dockerfile!)] ?? '') : undefined;
    let kind: string | undefined;
    const img = image ? imageName(image).name : '';
    for (const [k, re] of IMAGES) if (img && re.test(img)) kind ??= k;
    const command = Array.isArray(s.command) ? s.command.join(' ') : (str(s.command) ?? '');
    if (!kind && /\b(worker|consumer|celery|sidekiq|queue)\b/i.test(`${name} ${command}`)) kind = 'worker';
    if (!kind && /\b(cron|scheduler|beat)\b/i.test(`${name} ${command}`)) kind = 'job';
    if (!kind) kind = guessKind(name.replace(/[-_]/g, ' ')) ?? (/\b(web|frontend|ui|app|site|storefront|portal)\b/i.test(name) ? 'client' : 'service');
    // What is built here is a service of one's own, whatever its name says (payments is not Stripe).
    if (build !== undefined && !['service', 'worker', 'job', 'client', 'api', 'gateway', 'function', 'mobile'].includes(kind)) kind = 'service';
    if (kind === 'external' || kind === 'user' || kind === 'users') kind = 'service';
    kinds.set(id(name), kind);
    const caption = (image && product(image)) ?? (hint?.base ? (product(hint.base) ?? (hint.first ? product(hint.first) : undefined)) : undefined) ?? (image ? imageName(image).name : undefined);
    const entry: Obj = { kind, label: name === id(name) ? undefined : name };
    if (caption) entry.caption = caption;
    const profiles = list(s.profiles);
    if (profiles.length) profiled.set(name, profiles);
    nodes[id(name)] = entry;
  }

  // ---- networks: zones when they keep services apart
  const networksOf = (s: Obj) => list(s.networks);
  const declared = isObj(doc.networks) ? doc.networks : {};
  const used = new Set(all.flatMap(({ s }) => networksOf(s)));
  const zones = [...used].filter((n) => n !== 'default');
  if (zones.length > 1) {
    for (const n of zones) {
      const net = isObj(declared[n]) ? declared[n] : {};
      groups[`net-${id(n)}`] = { kind: 'zone', label: net.internal === true ? `${n} (internal)` : n };
    }
    for (const { name, s } of all) {
      const mine = networksOf(s).filter((n) => n !== 'default');
      // In one network: inside it. In several, the service joins them and stands between.
      if (mine.length === 1) nodes[id(name)]!.in = `net-${id(mine[0]!)}`;
    }
  }

  // ---- what comes in from outside: published ports
  const outside: [string, string][] = [];
  const local: string[] = [];
  for (const { name, s } of all) {
    for (const p of Array.isArray(s.ports) ? s.ports : []) {
      let host: string | undefined;
      let ip: string | undefined;
      if (isObj(p)) ((host = str(p.published)), (ip = str(p.host_ip)));
      else {
        const parts = String(p).replace(/\/(tcp|udp)$/, '').split(':');
        if (parts.length === 3) [ip, host] = parts;
        else if (parts.length === 2) host = parts[0];
      }
      if (!host) continue;
      if (ip && /^(127\.|localhost|::1)/.test(ip)) local.push(`${name} :${host}`);
      else outside.push([name, host]);
    }
  }
  if (outside.length) nodes.outside = { kind: 'users', label: 'Outside', caption: 'published ports' };
  for (const [name, port] of outside) {
    const k = `outside -> ${id(name)}`;
    if (seen.has(k)) continue;
    seen.add(`outside>${id(name)}`);
    edges.push({ [k]: { label: `:${port}`, style: 'sync' } });
  }

  // ---- what each uses
  const names = new Set(all.map((x) => x.name));
  for (const { name, s } of all) {
    // A URL to another service in the environment says how it is used: postgres://… is SQL.
    const env = isObj(s.environment) ? Object.values(s.environment) : Array.isArray(s.environment) ? s.environment.map((e) => String(e).split('=').slice(1).join('=')) : [];
    const how = new Map<string, string>();
    for (const v of env.map(String)) for (const m of v.matchAll(/\b([a-z][a-z0-9+]*):\/\/(?:[^@/\s]*@)?([A-Za-z0-9_.-]+)/g)) if (names.has(m[2]!)) how.set(m[2]!, SCHEME[m[1]!.split('+')[0]!] ?? m[1]!.toUpperCase());
    for (const dep of [...list(s.depends_on), ...list(s.links).map((l) => l.split(':')[0]!)]) {
      if (!names.has(dep)) {
        warn.add(`${name} depends on ${dep}, which is not a service here`);
        continue;
      }
      line(id(name), id(dep), how.get(dep));
    }
    for (const [to, label] of how) line(id(name), id(to), label);
  }

  // ---- volumes: a badge on the card that keeps one, a store of its own when shared
  const holders = new Map<string, string[]>();
  for (const { name, s } of all)
    for (const v of Array.isArray(s.volumes) ? s.volumes : []) {
      const source = isObj(v) ? (v.type === 'volume' || v.type === undefined ? str(v.source) : undefined) : String(v).split(':').length > 1 ? String(v).split(':')[0] : undefined;
      // Bind mounts of the repository's own files (./nginx.conf) are configuration, not storage.
      if (!source || /^[./~$]/.test(source)) continue;
      holders.set(source, [...(holders.get(source) ?? []), name]);
    }
  for (const [vol, who] of holders) {
    if (who.length === 1) {
      const n = nodes[id(who[0]!)]!;
      n.badges = [...((n.badges as string[]) ?? []), vol];
    } else {
      const vid = `vol-${id(vol)}`;
      nodes[vid] = { kind: 'storage', label: vol, caption: 'volume' };
      kinds.set(vid, 'storage');
      for (const w of who) line(id(w), vid);
    }
  }
  for (const [name, profiles] of profiled) {
    const n = nodes[id(name)]!;
    n.badges = [...((n.badges as string[]) ?? []), `profile ${profiles.join(', ')}`];
  }
  if (profiled.size) warn.add(`${[...profiled.keys()].join(', ')} only ${profiled.size > 1 ? 'run' : 'runs'} with a profile (${[...new Set([...profiled.values()].flat())].join(', ')}): drawn, with the profile as a badge`);
  if (local.length) warn.add(`Published on this machine only (127.0.0.1), so not drawn as coming in from outside: ${local.join(', ')}`);

  const project = str(doc.name);
  const title = opts.title ?? (project ? `${project[0]!.toUpperCase()}${project.slice(1)} services` : 'Services');
  const d: Drawn = {
    type: 'systems',
    // Telemetry goes from nearly everything: a badge on each card rather than a line across the drawing.
    head: { title, subtitle: 'From the Compose file: what runs and what it uses', captions: 'written', badges: edges.some((e) => JSON.stringify(e).includes('"dotted"')) ? ['dotted'] : undefined },
    maps: { groups, nodes },
    lists: { edges },
    mine: { nodes: ['badges'] },
  };
  const yaml = writeDrawn(d, opts, warn);
  const stores = Object.values(nodes).filter((n) => STORES.has(String(n.kind))).length;
  const count = Object.keys(nodes).filter((k) => k !== 'outside').length;
  return { yaml, warnings: warn.list, summary: `${plural(count - stores, 'service')}, ${plural(stores, 'store')}${zones.length > 1 ? `, ${plural(zones.length, 'network')}` : ''}` };
}

/** ./services/web + Dockerfile → services/web/Dockerfile. */
export function join(dir: string, file: string): string {
  const parts: string[] = [];
  for (const seg of `${dir}/${file}`.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}
