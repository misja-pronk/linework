// A trace written out: a `type: sequence` diagram whose participants point back at the elements
// they stand for (`ref:`) and that says where it was traced from (`traced:` and a comment), and,
// for a model, the same calls as a dynamic view to add to its `views:`.
import { kinds } from '@cartography/sequence';
import type { TraceElement, TraceGraph } from './graph.ts';
import type { Item, TraceOption } from './trace.ts';

export interface TraceMeta {
  /** The file traced, as the sequence diagram should name it (relative to where it is written). */
  file?: string;
  view?: string;
  mode: 'between' | 'until' | 'steps';
  from?: string;
  to?: string;
  /** Which of how many routes this is (between two elements). */
  pick?: { n: number; of: number };
  /** The command that makes it again. */
  command?: string;
}

const PLAIN = /^[A-Za-z0-9][\w .,/()&+'[\]-]*$/;
const RESERVED = /^(true|false|yes|no|on|off|null|~|[-+]?[\d.]+(e[-+]?\d+)?)$/i;
/** A string as a YAML scalar inside { } or a block: plain where it reads the same, double-quoted otherwise. */
export const scalar = (s: string, flow = false) => (PLAIN.test(s) && !RESERVED.test(s) && !(flow && /[,[\]]/.test(s)) && !/\s$/.test(s) ? s : JSON.stringify(s));

/** Ids participants can have: letters, digits, - and _. */
const clean = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'p';

/**
 * Short ids for elements: the last part of a dotted id, more of it where another element has the same
 * last part (ledger and api-ledger). The same elements get the same ids, whatever the order.
 */
export function participantIds(ids: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const suffix = (id: string, k: number) => clean(id.split('.').slice(-k).join('-'));
  for (const id of ids) {
    const n = id.split('.').length;
    let k = 1;
    while (k < n && ids.some((o) => o !== id && suffix(o, k) === suffix(id, k))) k++;
    let name = suffix(id, k);
    for (let i = 2; [...out.values()].includes(name); i++) name = `${suffix(id, k)}-${i}`;
    out.set(id, name);
  }
  return out;
}

const KIND_WORDS: [RegExp, string][] = [
  [/\b(web.?app|spa|web|browser|frontend|client|static.?web)\b/, 'client'],
  [/\b(mobile|ios|android|phone)\b/, 'mobile'],
  [/\b(gateway|load.?balancer|front.?door|cdn|ingress|proxy|api.?management|apim|alb|elb|waf|firewall)\b/, 'gateway'],
  [/\b(function|lambda|serverless)\b/, 'function'],
  [/\b(worker|job|consumer|batch)\b/, 'worker'],
  [/\b(identity|idp|auth|oauth|entra|active.?directory|cognito|okta|keycloak)\b/, 'identity'],
  [/\b(payments?|psp|stripe)\b/, 'payments'],
  [/\b(api)\b/, 'api'],
  [/\b(software.?system|system)\b/, 'system'],
];

/** The sequence kind closest to what an element is. */
export function sequenceKind(e: TraceElement): string {
  const k = (e.kind ?? '').toLowerCase().replace(/[-_]+/g, ' ');
  if (e.kind && e.kind in kinds) return e.role === 'external' && e.kind === 'system' ? 'external' : e.kind;
  if (e.role === 'actor') return /\b(users|people|team|staff|customers)\b/.test(k) ? 'people' : 'person';
  if (/\b(vault|secrets?|key ?vault)\b/.test(k)) return 'storage';
  if (e.role === 'store') return /\b(cache|redis|memcached)\b/.test(k) ? 'cache' : /\b(storage|bucket|blob|s3|files|lake)\b/.test(k) ? 'storage' : 'database';
  if (e.role === 'queue') return /\b(topic|stream|kafka|event|events|hub|grid|sns|kinesis|pubsub)\b/.test(k) ? 'topic' : 'queue';
  for (const [re, kind] of KIND_WORDS) if (re.test(k)) return kind === 'system' && e.role === 'external' ? 'external' : kind;
  if (e.role === 'external') return 'external';
  return 'service';
}

/** The source's own kind as a caption ("Key vault", "Front door"), where the sequence kind is only near it. */
function kindCaption(e: TraceElement, kind: string): string | undefined {
  if (!e.kind || e.kind === kind || e.group || e.role === 'actor' || e.label.toLowerCase().includes(e.kind.replace(/[-_]+/g, ' ').toLowerCase())) return undefined;
  const words = e.kind.split(/[-_\s]+/).map((w) => (w.length <= 3 && !/^(app|web|hub)$/.test(w) ? w.toUpperCase() : w));
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

interface Cast {
  /** Element id → participant id. */
  ids: Map<string, string>;
  /** Participants in the order they are written: by first appearance, a box's members together. */
  order: string[];
  /** Element id → the box (group element id) it is drawn in. */
  box: Map<string, string>;
  boxes: Map<string, string>;
}

/**
 * Who takes part and in which boxes. The box is the outermost group around a participant; when every
 * participant sits in the same one, it says nothing and the next level down is used instead.
 */
function cast(g: TraceGraph, opt: TraceOption): Cast {
  const chain = (id: string) => {
    const out: string[] = [];
    for (let p = g.elements.get(id)?.parent; p && g.elements.has(p) && !out.includes(p); p = g.elements.get(p)!.parent) out.unshift(p);
    // A group that takes part itself is a participant, not a box.
    return out.filter((x) => !opt.ids.includes(x));
  };
  const chains = new Map(opt.ids.map((id) => [id, chain(id)]));
  let level = 0;
  while (opt.ids.length > 1 && opt.ids.every((id) => chains.get(id)![level] !== undefined && chains.get(id)![level] === chains.get(opt.ids[0]!)![level])) level++;
  const box = new Map<string, string>();
  for (const id of opt.ids) {
    const b = chains.get(id)![level];
    if (b) box.set(id, b);
  }
  const order: string[] = [];
  for (const id of opt.ids) if (!order.includes(id)) order.push(id, ...(box.has(id) ? opt.ids.filter((x) => x !== id && box.get(x) === box.get(id)) : []));
  const ids = participantIds(order);
  const boxes = participantIds([...new Set(box.values())]);
  // A box and a participant with one name read alike in the YAML: the box takes another.
  for (const [g2, name] of boxes) if ([...ids.values()].includes(name)) boxes.set(g2, `${name}-box`);
  return { ids, order, box, boxes };
}

/** The title a trace gets: "Customers to Orders DB", "From Customers", or the diagram's own. */
export function traceTitle(g: TraceGraph, meta: TraceMeta): string {
  const name = (id?: string) => (id ? (g.elements.get(id)?.label ?? id) : '');
  if (meta.mode === 'between') return `${name(meta.from)} to ${name(meta.to)}`;
  if (meta.mode === 'until') return `From ${name(meta.from)}`;
  return g.title ?? 'Traced steps';
}

/** The trace as a sequence diagram, in YAML. */
export function sequenceYaml(g: TraceGraph, opt: TraceOption, meta: TraceMeta): string {
  const c = cast(g, opt);
  const id = (el: string) => c.ids.get(el)!;
  const out: string[] = [];
  const what =
    meta.mode === 'between'
      ? `from ${meta.from} to ${meta.to}${meta.pick && meta.pick.of > 1 ? `, route ${meta.pick.n} of ${meta.pick.of}` : ''}`
      : meta.mode === 'until'
        ? `from ${meta.from} until each call ends (a store, an external system, a person)`
        : 'along its steps';
  out.push(`# Traced from ${meta.file ?? 'the diagram'}${meta.view ? `, view ${meta.view}` : ''}: ${what}.`);
  for (const n of opt.notes) out.push(`# ${n}.`);
  if (meta.command) out.push(`# Again: ${meta.command}`);
  out.push('type: sequence');
  out.push(`title: ${scalar(traceTitle(g, meta))}`);
  const from = meta.view ? `${meta.file ?? 'the diagram'}, view ${meta.view}` : (g.title ?? meta.file ?? 'the diagram');
  out.push(`subtitle: ${scalar(`Traced from ${from}`)}`);
  const traced = [
    ...(meta.file ? [`file: ${scalar(meta.file, true)}`] : []),
    ...(meta.view ? [`view: ${scalar(meta.view, true)}`] : []),
    ...(meta.from ? [`from: ${scalar(meta.from, true)}`] : []),
    ...(meta.to ? [`to: ${scalar(meta.to, true)}`] : []),
    ...(meta.mode === 'steps' ? ['steps: true'] : meta.mode === 'until' ? ['until: end'] : []),
  ];
  out.push(`traced: { ${traced.join(', ')} }`);
  out.push('');
  if (c.boxes.size) {
    out.push('boxes:');
    for (const [gid, name] of c.boxes) out.push(`  ${name}: ${scalar(g.elements.get(gid)?.label ?? gid)}`);
    out.push('');
  }
  out.push('participants:');
  for (const el of c.order) {
    const e = g.elements.get(el)!;
    const kind = sequenceKind(e);
    const fields = [`kind: ${kind}`, `label: ${scalar(e.label, true)}`];
    const caption = e.technology ?? kindCaption(e, kind);
    if (caption) fields.push(`caption: ${scalar(caption, true)}`);
    if (c.box.has(el)) fields.push(`box: ${c.boxes.get(c.box.get(el)!)}`);
    fields.push(`ref: ${scalar(el, true)}`);
    out.push(`  ${id(el)}: { ${fields.join(', ')} }`);
  }
  out.push('');
  out.push('messages:');
  const write = (items: Item[], indent: string) => {
    for (const it of items) {
      if (it.kind === 'call' || it.kind === 'reply') {
        const arrow = it.kind === 'reply' ? '-->' : it.async ? '->>' : '->';
        const label = it.kind === 'call' ? it.label : undefined;
        out.push(`${indent}- ${id(it.from)} ${arrow} ${id(it.to)}${label ? `: ${scalar(label)}` : ''}`);
      } else if (it.kind === 'note') out.push(`${indent}- note: ${scalar(it.text)}`, `${indent}  over: ${id(it.over)}`);
      else if (it.kind === 'divider') out.push(`${indent}- divider: ${scalar(it.label)}`);
      else {
        const [first, ...rest] = it.branches;
        out.push(`${indent}- ${it.frame}: ${scalar(first!.label ?? '')}`, `${indent}  messages:`);
        write(first!.items, `${indent}    `);
        if (rest.length) {
          out.push(`${indent}  ${it.frame === 'alt' ? 'else' : 'and'}:`);
          for (const b of rest) {
            out.push(`${indent}    ${scalar(b.label ?? 'and')}:`);
            write(b.items, `${indent}      `);
          }
        }
      }
    }
  };
  write(opt.items, '  ');
  return out.join('\n') + '\n';
}

/** A name for the view: trace-customer-ledger. */
export const viewName = (meta: TraceMeta) => clean(['trace', ...(meta.mode === 'steps' ? ['steps'] : [meta.from, meta.to ?? 'all'].map((x) => x?.split('.').at(-1) ?? ''))].join('-')).toLowerCase();

export interface DynamicView {
  name: string;
  /** As it goes under `views:`. */
  value: { kind: 'dynamic'; title: string; subtitle?: string; steps: (string | Record<string, string | Record<string, string>>)[] };
  /** The same, as YAML to paste under `views:`. */
  yaml: string;
}

/**
 * The calls as a C4 dynamic view: numbered steps between model elements, label and technology
 * apart. Only for a trace of a model, whose ids are the model's; replies are not steps.
 */
export function dynamicView(g: TraceGraph, opt: TraceOption, meta: TraceMeta): DynamicView | undefined {
  if (!g.model || !opt.calls.length) return undefined;
  const name = viewName(meta);
  const title = traceTitle(g, meta);
  const steps = opt.calls.map((c): DynamicView['value']['steps'][number] => {
    const key = `${c.from} -> ${c.to}`;
    if (c.technology) return { [key]: { ...(c.label ? { label: c.label } : {}), technology: c.technology } };
    return c.label ? { [key]: c.label } : key;
  });
  const lines = [`${name}:`, '  kind: dynamic', `  title: ${scalar(title)}`, `  subtitle: ${scalar(`Traced ${meta.mode === 'steps' ? 'along the steps' : 'through the model'}`)}`, '  steps:'];
  for (const s of steps) {
    if (typeof s === 'string') lines.push(`    - ${s}`);
    else {
      const [k, v] = Object.entries(s)[0]!;
      lines.push(typeof v === 'string' ? `    - ${k}: ${scalar(v)}` : `    - ${k}: { ${Object.entries(v).map(([a, b]) => `${a}: ${scalar(String(b), true)}`).join(', ')} }`);
    }
  }
  return { name, value: { kind: 'dynamic', title, subtitle: `Traced ${meta.mode === 'steps' ? 'along the steps' : 'through the model'}`, steps }, yaml: lines.join('\n') + '\n' };
}
