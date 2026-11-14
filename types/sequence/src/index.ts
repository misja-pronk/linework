// Sequence diagrams: participants side by side, messages between them in order, top to bottom.
//
//   participants:
//     shopper: person
//     api: { kind: service, label: Orders API, box: shop }
//   messages:
//     - shopper -> api: Place order        call (opens an activation on api)
//     - api ->> bus: OrderPlaced           async message
//     - api --> shopper: 201 Created       reply (closes api's activation)
//     - alt: Card accepted                 frames: alt/else, opt, loop, par/and, break, critical, group
//       messages: [...]
//       else: { Card declined: [...] }
//     - note: Idempotent                   notes over, left or right of participants
//       over: api
//     - divider: Payment
//
// Dividers at the top level of messages: cut the sequence into phases. The drawing is the whole
// sequence; each phase is also a view of its own (phase-payment), a drawing that fits a slide: only
// that phase's messages and the participants that take part, numbered as in the whole.
//
// `steps:` is the old name of `messages:` (everywhere else steps: are presentation steps): still read,
// with a warning.
//
// Activations follow the calls by default: a call opens one on the callee, its reply closes it.
// `activations: explicit` draws only the ones asked for (`a -> +b`, `b --> -a`, activate:/deactivate:).
import {
  english,
  idPattern,
  type BuildContext,
  type DiagramType,
  type FrameKind,
  type Graph,
  type KindTable,
  type LegendItem,
  type PaletteItem,
  type Path,
  type Reference,
  type SequenceArrow,
  type SequenceEvent,
  type SequenceParticipant,
  type Tone,
  type Word,
  tones,
} from '@cartography/core';

export const kinds: KindTable = {
  person: { label: 'Person', icon: 'user', tone: 'slate', quiet: true, keywords: ['actor', 'user', 'customer'] },
  people: { label: 'People', icon: 'users', tone: 'slate', quiet: true, keywords: ['users', 'team'] },
  client: { label: 'Web app', icon: 'app-window', tone: 'sky', keywords: ['browser', 'frontend', 'spa'] },
  mobile: { label: 'Mobile app', icon: 'smartphone', tone: 'sky', keywords: ['ios', 'android'] },
  service: { label: 'Service', icon: 'box', tone: 'blue', keywords: ['backend', 'microservice'] },
  api: { label: 'API', icon: 'webhook', tone: 'blue', keywords: ['rest', 'graphql'] },
  gateway: { label: 'Gateway', icon: 'split', tone: 'sky', keywords: ['proxy', 'ingress'] },
  function: { label: 'Function', icon: 'square-function', tone: 'amber', keywords: ['lambda', 'serverless'] },
  worker: { label: 'Worker', icon: 'cog', tone: 'blue', keywords: ['consumer', 'job'] },
  database: { label: 'Database', icon: 'database', tone: 'indigo', keywords: ['sql', 'db', 'store'] },
  cache: { label: 'Cache', icon: 'database-zap', tone: 'rose', keywords: ['redis'] },
  storage: { label: 'Storage', icon: 'archive', tone: 'teal', keywords: ['bucket', 's3', 'blob', 'files'] },
  queue: { label: 'Queue', icon: 'send', tone: 'violet', keywords: ['sqs', 'rabbitmq', 'message'] },
  topic: { label: 'Event stream', icon: 'radio-tower', tone: 'violet', keywords: ['kafka', 'event bus', 'pubsub'] },
  identity: { label: 'Identity provider', icon: 'fingerprint-pattern', tone: 'amber', keywords: ['idp', 'oauth', 'sso', 'auth'] },
  'key-vault': { label: 'Key vault', icon: 'key-round', tone: 'amber', keywords: ['vault', 'kv', 'secrets', 'kms', 'secrets manager'] },
  payments: { label: 'Payments', icon: 'credit-card', tone: 'green', keywords: ['psp', 'stripe'] },
  system: { label: 'System', icon: 'boxes', tone: 'blue' },
  external: { label: 'External system', icon: 'earth', tone: 'slate', keywords: ['third party', 'saas', 'partner'] },
};

export const frames: FrameKind[] = ['alt', 'opt', 'loop', 'par', 'break', 'critical', 'group'];

/** `a -> b`, `a ->> b`, `a --> b` (also -->>), `a -x b`; `+b` opens an activation on b, `-b` closes the sender's. */
export const MESSAGE = /^\s*([A-Za-z0-9_-]+?)\s*(-->>|->>|-->|->|-x(?=\s))\s*([+-]?)([A-Za-z0-9_-]+)\s*$/;
const ARROWS: Record<string, SequenceArrow> = { '->': 'sync', '->>': 'async', '-->': 'reply', '-->>': 'reply', '-x': 'lost' };

interface ParticipantEntry {
  kind?: string;
  label?: string;
  caption?: string;
  icon?: string;
  tone?: Tone;
  box?: string;
  /** The element it stands for in another diagram or the model: the HTML export drills into it. */
  ref?: string;
}

export interface SequenceSource {
  type: 'sequence';
  title?: string;
  subtitle?: string;
  autonumber?: boolean;
  activations?: 'auto' | 'explicit';
  footers?: boolean;
  /** `written`: only captions written here, none from the kind (an import, whose kinds are guesses). */
  captions?: 'kinds' | 'written';
  boxes?: Record<string, string | { label?: string; tone?: Tone }>;
  participants?: Record<string, string | ParticipantEntry | null>;
  messages?: unknown[];
  /** The old name of messages. */
  steps?: unknown[];
  /** The view drawn (set by the engine): `whole`, or one phase (`phase-payment`). */
  view?: string;
}

/** A phase: the messages between two top-level dividers (or before the first), a view of its own. */
export interface Phase {
  name: string;
  title: string;
  /** Index in the top-level messages: of its divider, or -1 for the messages before the first divider. */
  divider: number;
  /** The title is the type's own word, not a divider's text: "Start", or "Phase 2" for a divider without text. */
  own?: { text: string; params?: Record<string, string> };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    // A long divider ("The same for every resource, with a token…") names its view by its first words.
    .split('-')
    .slice(0, 4)
    .join('-');

/**
 * The phases of a sequence: one per top-level divider, and one for what comes before the first
 * (called Start), when there is something. A divider inside a frame does not cut: a phase never
 * starts or ends halfway an alt or a loop. Fewer than two phases: none, the whole is the one drawing.
 */
export function sequencePhases(src: SequenceSource): Phase[] {
  const items = src[messagesKey(src)];
  if (!Array.isArray(items)) return [];
  const out: Phase[] = [];
  const taken = new Set<string>();
  const add = (title: string, divider: number, own?: Phase['own']) => {
    const base = `phase-${slug(title) || out.length + 1}`;
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
    taken.add(name);
    out.push({ name, title, divider, ...(own ? { own } : {}) });
  };
  const first = items.findIndex((it) => stepKind(it) === 'divider');
  if (first !== 0) add('Start', -1, { text: 'Start' });
  if (first < 0) return [];
  for (const [i, it] of items.entries()) {
    if (stepKind(it) !== 'divider') continue;
    const text = String((it as Item).divider ?? '').trim();
    // The names stay English whatever the language (phase-start, phase-phase-2): a view is asked for by them.
    if (text) add(text, i);
    else add(`Phase ${out.length + 1}`, i, { text: 'Phase {n}', params: { n: String(out.length + 1) } });
  }
  return out.length > 1 ? out : [];
}

/** Where the messages of a sequence or a frame are: `messages:`, or the old `steps:`. */
const messagesKey = (o: { messages?: unknown; steps?: unknown }): 'messages' | 'steps' => (o.messages === undefined && o.steps !== undefined ? 'steps' : 'messages');

type Item = Record<string, unknown>;

/** What a step is, by its keys. */
function stepKind(item: unknown): 'message' | 'note' | 'divider' | 'ref' | 'activate' | 'deactivate' | FrameKind | undefined {
  if (typeof item === 'string') return MESSAGE.test(item) ? 'message' : undefined;
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
  const keys = Object.keys(item);
  for (const k of ['note', 'divider', 'ref', 'activate', 'deactivate', ...frames] as const) if (keys.includes(k)) return k;
  return keys.length === 1 && MESSAGE.test(keys[0]!) ? 'message' : undefined;
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]);

/** The kind a participant's name points to: a kind's id, name or keyword as a whole word ("Orders API", "user-db"). */
function kindFromName(name: string): KindTable[string] | undefined {
  const words = ` ${name.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  const has = (w: string) => words.includes(` ${w.toLowerCase()} `);
  return Object.entries(kinds).find(([id, k]) => has(id) || has(k.label) || k.keywords?.some(has))?.[1];
}

/** `word`: a kind's name in the drawing's language, where it stands for a label or caption not written. */
function participantsOf(src: SequenceSource, word: Word = english): SequenceParticipant[] {
  const out: SequenceParticipant[] = [];
  for (const [id, raw] of Object.entries(src.participants ?? {})) {
    const e: ParticipantEntry = typeof raw === 'string' ? { kind: raw } : (raw ?? {});
    // Without a kind, the name may say it (Orders API, Payments DB); otherwise a plain card, never a guessed service cube.
    const kind = e.kind ? kinds[e.kind] : kindFromName(`${id} ${e.label ?? ''}`);
    const label = e.label ?? (e.kind && kind ? word(kind.label) : undefined) ?? id;
    // The kind as caption, unless the label says it already or the kind is plain (a person).
    const said = !e.kind || !e.label || kind?.quiet || label.toLowerCase().endsWith(kind?.label.toLowerCase() ?? '\0');
    out.push({ id, label, caption: e.caption ?? (said || src.captions === 'written' || !kind ? undefined : word(kind.label)), icon: e.icon ?? kind?.icon, tone: e.tone ?? kind?.tone ?? 'slate', box: e.box, path: ['participants', id] });
  }
  // A box holds participants side by side: keep its members together where the first one stands.
  const order: SequenceParticipant[] = [];
  for (const p of out) {
    if (order.includes(p)) continue;
    order.push(p, ...(p.box ? out.filter((q) => q !== p && q.box === p.box) : []));
  }
  return order;
}

export function buildSequence(src: SequenceSource, ctx: BuildContext): Graph {
  const participants = participantsOf(src, ctx.word);
  const ids = new Set(participants.map((p) => p.id));
  const boxes = Object.entries(src.boxes ?? {}).map(([id, b]) => {
    const e = typeof b === 'string' ? { label: b } : (b ?? {});
    return { id, label: e.label ?? id, tone: e.tone ?? 'slate' };
  });
  for (const p of participants)
    if (p.box && !boxes.some((b) => b.id === p.box)) {
      ctx.error([...p.path, 'box'], `There is no box "${p.box}"; add it under boxes`);
      p.box = undefined;
    }
  const known = (id: string, path: Path) => {
    if (ids.has(id)) return true;
    ctx.error(path, `There is no participant "${id}"; add it under participants`);
    return false;
  };

  const auto = src.activations !== 'explicit';
  const events: SequenceEvent[] = [];
  const open = new Map<string, number>();
  const bump = (lane: string, by: number) => open.set(lane, Math.max(0, (open.get(lane) ?? 0) + by));
  let number = 0;
  // A ref written without over: spans every participant drawn (in a phase: those taking part).
  const wide = new WeakSet<SequenceEvent>();

  const walk = (steps: unknown, base: Path) => {
    if (!Array.isArray(steps)) return;
    for (const [i, item] of steps.entries()) {
      const path = [...base, i];
      const kind = stepKind(item);
      const o = (item && typeof item === 'object' ? item : {}) as Item;
      if (!kind) {
        ctx.error(path, 'Each entry is a message ("a -> b: text"), a note, a divider, a ref or a frame (alt, opt, loop, par, …)');
        continue;
      }
      if (kind === 'message') {
        const key = typeof item === 'string' ? item : Object.keys(o)[0]!;
        const value = typeof item === 'string' ? undefined : o[key];
        const [, from, op, sign, to] = MESSAGE.exec(key)!;
        if (!known(from!, path) || !known(to!, path)) continue;
        const v = value && typeof value === 'object' && !Array.isArray(value) ? (value as Item) : undefined;
        const label = v ? (v.label == null ? undefined : String(v.label)) : value == null ? undefined : String(value);
        const arrow = ARROWS[op!]!;
        const opens = sign === '+' || (typeof v?.activate === 'boolean' ? v.activate : auto && arrow === 'sync');
        const closes = sign === '-' || (auto && arrow === 'reply' && (open.get(from!) ?? 0) > 0 && v?.activate !== true);
        if (opens && from !== to) bump(to!, 1);
        if (closes) bump(from!, -1);
        events.push({ kind: 'message', from: from!, to: to!, label, arrow, ...(src.autonumber ? { number: ++number } : {}), ...(opens ? { opens } : {}), ...(closes ? { closes } : {}), path });
      } else if (kind === 'note') {
        const side = o.left != null ? 'left' : o.right != null ? 'right' : 'over';
        const where = list(o[side]);
        if (!where.length) {
          ctx.error(path, 'A note needs over:, left: or right: with a participant');
          continue;
        }
        if (!where.every((id) => known(id, [...path, side]))) continue;
        events.push({ kind: 'note', text: String(o.note ?? ''), over: side === 'over' ? where : where.slice(0, 1), side, path });
      } else if (kind === 'divider') events.push({ kind: 'divider', label: String(o.divider ?? ''), path });
      else if (kind === 'ref') {
        const over = o.over == null ? participants.map((p) => p.id) : list(o.over);
        if (!over.every((id) => known(id, [...path, 'over']))) continue;
        const ev: SequenceEvent = { kind: 'ref', label: String(o.ref ?? ''), over, ...(typeof o.link === 'string' ? { link: o.link } : {}), path };
        if (o.over == null) wide.add(ev);
        events.push(ev);
      } else if (kind === 'activate' || kind === 'deactivate') {
        const lane = String(o[kind]);
        if (!known(lane, [...path, kind])) continue;
        bump(lane, kind === 'activate' ? 1 : -1);
        events.push({ kind, lane, path });
      } else {
        events.push({ kind: 'frame', frame: kind, ...(o[kind] != null ? { label: String(o[kind]) } : {}), ...(typeof o.tone === 'string' ? { tone: o.tone as Tone } : {}), path });
        const inner = messagesKey(o);
        if (inner === 'steps') ctx.warn([...path, 'steps'], 'In a sequence this is now called messages: (steps: are for presenting elsewhere); rename it');
        walk(o[inner], [...path, inner]);
        // else: (alt) and and: (par) hold the other branches: a map of label → steps, or one list without a label.
        for (const k of ['else', 'and'] as const) {
          const more = o[k];
          if (Array.isArray(more)) {
            events.push({ kind: 'branch', path: [...path, k] });
            walk(more, [...path, k]);
          } else if (more && typeof more === 'object')
            for (const [label, steps] of Object.entries(more)) {
              events.push({ kind: 'branch', label, path: [...path, k, label] });
              walk(steps, [...path, k, label]);
            }
        }
        events.push({ kind: 'end', path });
      }
    }
  };
  const top = messagesKey(src);
  if (top === 'steps') ctx.warn(['steps'], 'In a sequence this is now called messages: (steps: are for presenting elsewhere); rename it');
  if (src.messages !== undefined && src.steps !== undefined) ctx.error(['steps'], 'Both messages: and steps: here: steps: is the old name of messages:, keep one');
  walk(src[top], [top]);
  if (auto) {
    activateOnSignals(events);
    activateCallers(events, new Set(participants.filter((p) => quietKind(src, p.id)).map((p) => p.id)));
  }
  const phases = typeof src.view === 'string' && src.view.startsWith('phase-') ? sequencePhases(src) : [];
  const phase = phases.find((p) => p.name === src.view);
  const drawn = phase ? phaseOf(events, participants, phase, phases, top, wide) : { events, participants };
  // The key names the arrows this drawing has: a phase lists only those drawn in it.
  const key = arrowKey(drawn.events);

  return {
    title: src.title,
    subtitle: src.subtitle,
    direction: 'down',
    groups: [],
    nodes: [{ id: 'sequence', shape: { kind: 'sequence', participants: drawn.participants, boxes, events: drawn.events, ...(src.footers ? { footers: true } : {}) }, path: [] }],
    edges: [],
    ...(key.length ? { legend: key } : {}),
  };
}

/** A person (or people): someone who asks, not a system that is busy while it waits. */
function quietKind(src: SequenceSource, id: string): boolean {
  const raw = src.participants?.[id];
  const e: ParticipantEntry = typeof raw === 'string' ? { kind: raw } : (raw ?? {});
  const kind = e.kind ? kinds[e.kind] : kindFromName(`${id} ${e.label ?? ''}`);
  return !!kind?.quiet;
}

/**
 * A system that starts a conversation itself (a call while nothing has called it) is busy from that
 * call until it last takes part in what follows, as a callee is: its bar shows it waits for the
 * answers. The conversation ends at a divider, at the end of its frame or branch, or where another
 * message (not an answer) reaches it. People get no bar: they ask, they do not run.
 */
function activateCallers(events: SequenceEvent[], people: Set<string>): void {
  const open = new Map<string, number>();
  const bump = (lane: string, by: number) => open.set(lane, Math.max(0, (open.get(lane) ?? 0) + by));
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.kind === 'activate' || e.kind === 'deactivate') bump(e.lane, e.kind === 'activate' ? 1 : -1);
    if (e.kind !== 'message') continue;
    if (e.closes) bump(e.from, -1);
    if (e.opens && e.from !== e.to) bump(e.to, 1);
    if (e.arrow !== 'sync' || e.from === e.to || people.has(e.from) || (open.get(e.from) ?? 0) > 0) continue;
    let last = -1;
    let depth = 0;
    for (let j = i + 1; j < events.length; j++) {
      const x = events[j]!;
      if (x.kind === 'frame') depth++;
      else if (x.kind === 'end' && --depth < 0) break;
      else if ((x.kind === 'branch' && depth === 0) || x.kind === 'divider') break;
      else if (x.kind === 'message' && x.to === e.from && x.from !== e.from && x.arrow !== 'reply') break;
      else if (x.kind === 'message' && (x.from === e.from || x.to === e.from)) last = j;
    }
    if (last < 0) continue;
    events.splice(last + 1, 0, { kind: 'deactivate', lane: e.from, path: events[last]!.path });
    events.splice(i + 1, 0, { kind: 'activate', lane: e.from, path: e.path });
    bump(e.from, 1);
    i++;
  }
}

/**
 * A participant that acts on a message it does not answer (a webhook, an event) is busy while it does:
 * it gets an activation from that message to the last one it sends in turn, as a call's callee does.
 * Its turn ends where another message (not a reply) reaches it, or at its branch, frame or divider.
 * Nothing is drawn for a message that is only received.
 */
function activateOnSignals(events: SequenceEvent[]): void {
  const open = new Map<string, number>();
  const bump = (lane: string, by: number) => open.set(lane, Math.max(0, (open.get(lane) ?? 0) + by));
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.kind === 'activate' || e.kind === 'deactivate') bump(e.lane, e.kind === 'activate' ? 1 : -1);
    if (e.kind !== 'message') continue;
    if (e.closes) bump(e.from, -1);
    if (e.opens && e.from !== e.to) bump(e.to, 1);
    if (e.opens || e.from === e.to || e.arrow !== 'async' || (open.get(e.to) ?? 0) > 0) continue;
    let last = -1;
    let depth = 0;
    for (let j = i + 1; j < events.length; j++) {
      const x = events[j]!;
      if (x.kind === 'frame') depth++;
      else if (x.kind === 'end' && --depth < 0) break;
      else if ((x.kind === 'branch' && depth === 0) || x.kind === 'divider') break;
      else if (x.kind === 'message' && x.to === e.to && x.from !== e.to && x.arrow !== 'reply') break;
      // What it sends, and the answers to its own calls.
      else if (x.kind === 'message' && (x.from === e.to || (x.to === e.to && last >= 0))) last = j;
    }
    if (last < 0) continue;
    events[i] = { ...e, opens: true };
    bump(e.to, 1);
    events.splice(last + 1, 0, { kind: 'deactivate', lane: e.to, path: events[last]!.path });
  }
}

/**
 * One phase of the whole: its events (without its own divider: the view's title says it), the
 * participants that take part in it, and the activations still open from the phases before, opened
 * again at its top so their bars run on. Numbers stay those of the whole sequence.
 */
function phaseOf(events: SequenceEvent[], participants: SequenceParticipant[], phase: Phase, phases: Phase[], top: string, wide: WeakSet<SequenceEvent>): { events: SequenceEvent[]; participants: SequenceParticipant[] } {
  const atTop = (e: SequenceEvent, i: number) => e.kind === 'divider' && e.path.length === 2 && e.path[0] === top && e.path[1] === i;
  const start = phase.divider < 0 ? 0 : events.findIndex((e) => atTop(e, phase.divider)) + 1;
  const next = phases[phases.indexOf(phase) + 1];
  const end = next ? events.findIndex((e) => atTop(e, next.divider)) : events.length;
  const part = events.slice(start, end);
  // Who takes part: the ends of its messages, what its notes, explicit refs and activations name.
  const used = new Set<string>();
  for (const e of part)
    if (e.kind === 'message') used.add(e.from).add(e.to);
    else if (e.kind === 'note' || (e.kind === 'ref' && !wide.has(e))) for (const id of e.over) used.add(id);
    else if (e.kind === 'activate' || e.kind === 'deactivate') used.add(e.lane);
  const kept = participants.filter((p) => used.has(p.id));
  const all = (kept.length ? kept : participants).map((p) => p.id);
  // Activations open when the phase starts, replayed as the renderer reads them.
  const open = new Map<string, number>();
  const bump = (lane: string, by: number) => open.set(lane, Math.max(0, (open.get(lane) ?? 0) + by));
  for (const e of events.slice(0, start))
    if (e.kind === 'message') {
      if (e.closes) bump(e.from, -1);
      if (e.opens && e.from !== e.to) bump(e.to, 1);
    } else if (e.kind === 'activate' || e.kind === 'deactivate') bump(e.lane, e.kind === 'activate' ? 1 : -1);
  const carried: SequenceEvent[] = [];
  for (const id of all) for (let n = open.get(id) ?? 0; n > 0; n--) carried.push({ kind: 'activate', lane: id, path: [top, Math.max(0, phase.divider)] });
  const out = part.map((e) => (e.kind === 'ref' && wide.has(e) ? { ...e, over: all } : e));
  return { events: [...carried, ...out], participants: kept.length ? kept : participants };
}

/** The key: what each kind of arrow drawn means, in every sequence alike, and nothing that is not drawn. */
function arrowKey(events: SequenceEvent[]): LegendItem[] {
  const drawn = new Set(events.flatMap((e) => (e.kind === 'message' ? [e.arrow] : [])));
  const names: [SequenceArrow, string][] = [['sync', 'Call'], ['reply', 'Reply'], ['async', 'Async message'], ['lost', 'Lost message']];
  return names.filter(([a]) => drawn.has(a)).map(([arrow, label]) => ({ label, swatch: 'message' as const, arrow }));
}

/** Every participant id a step names, so renames and deletes follow them. */
export function sequenceReferences(src: SequenceSource): Reference[] {
  const out: Reference[] = [];
  const ids = new Set(Object.keys(src.participants ?? {}));
  for (const [id, raw] of Object.entries(src.participants ?? {}))
    if (raw && typeof raw === 'object' && typeof raw.box === 'string') out.push({ path: ['participants', id, 'box'], id: raw.box, start: 0, collection: 'boxes' });
  const scalar = (v: unknown, path: Path) => {
    if (typeof v === 'string' && ids.has(v)) out.push({ path, id: v, start: 0, collection: 'participants', onDelete: 'item' });
    else if (Array.isArray(v)) for (const [j, x] of v.entries()) if (typeof x === 'string' && ids.has(x)) out.push({ path: [...path, j], id: x, start: 0, collection: 'participants' });
  };
  const walk = (steps: unknown, base: Path) => {
    if (!Array.isArray(steps)) return;
    for (const [i, item] of steps.entries()) {
      const path = [...base, i];
      const kind = stepKind(item);
      if (kind === 'message') {
        const key = typeof item === 'string' ? item : Object.keys(item as Item)[0]!;
        const m = new RegExp(MESSAGE.source, 'd').exec(key);
        for (const g of [1, 4]) if (m?.indices && ids.has(m[g]!)) out.push({ path, key: typeof item !== 'string', id: m[g]!, start: m.indices[g]![0], collection: 'participants' });
        continue;
      }
      const o = item as Item;
      if (kind === 'note') for (const k of ['over', 'left', 'right']) scalar(o[k], [...path, k]);
      else if (kind === 'ref') scalar(o.over, [...path, 'over']);
      else if (kind === 'activate' || kind === 'deactivate') scalar(o[kind], [...path, kind]);
      else if (kind && frames.includes(kind as FrameKind)) {
        const inner = messagesKey(o);
        walk(o[inner], [...path, inner]);
        for (const k of ['else', 'and'])
          if (Array.isArray(o[k])) walk(o[k], [...path, k]);
          else if (o[k] && typeof o[k] === 'object') for (const [label, s] of Object.entries(o[k] as Item)) walk(s, [...path, k, label]);
      }
    }
  };
  const top = messagesKey(src);
  walk(src[top], [top]);
  return out;
}

// ---------------------------------------------------------------- schema

const tone = { enum: tones };
const ids = { anyOf: [{ type: 'string', pattern: idPattern }, { type: 'array', items: { type: 'string', pattern: idPattern }, minItems: 1 }] };
const messageKey = { pattern: MESSAGE.source, description: '"a -> b" (call), "a ->> b" (async), "a --> b" (reply), "a -x b" (lost)' };

/**
 * Messages nest inside frames. The top level is written out so the editor can complete it; inside a
 * frame they refer to one shared definition (inlining every level grows the schema exponentially).
 */
function stepsSchema(inner: object): object {
  const steps = inner;
  const branches = { anyOf: [steps, { type: 'object', additionalProperties: steps }], description: 'More branches: label → messages, or one list of messages' };
  const old = { ...(steps as object), description: 'The old name of messages:' };
  const message = {
    type: 'object',
    minProperties: 1,
    maxProperties: 1,
    propertyNames: messageKey,
    additionalProperties: {
      anyOf: [
        { type: ['string', 'number', 'null'] },
        { type: 'object', properties: { label: { type: ['string', 'number'] }, activate: { type: 'boolean', description: 'Open an activation on the receiver (calls do by default)' } }, additionalProperties: false },
      ],
    },
  };
  const frame = (k: FrameKind) => ({
    type: 'object',
    required: [k],
    properties: { [k]: { type: ['string', 'null'], description: 'Condition or label in the tab' }, messages: steps, steps: old, else: branches, and: branches, tone },
    additionalProperties: false,
  });
  return {
    type: 'array',
    items: {
      anyOf: [
        { type: 'string', ...messageKey },
        message,
        {
          type: 'object',
          required: ['note'],
          properties: { note: { type: ['string', 'number'] }, over: ids, left: { type: 'string', pattern: idPattern }, right: { type: 'string', pattern: idPattern } },
          additionalProperties: false,
        },
        { type: 'object', required: ['divider'], properties: { divider: { type: 'string' } }, additionalProperties: false },
        { type: 'object', required: ['ref'], properties: { ref: { type: 'string' }, over: ids, link: { type: 'string', description: 'Another diagram or a URL' } }, additionalProperties: false },
        { type: 'object', required: ['activate'], properties: { activate: { type: 'string', pattern: idPattern } }, additionalProperties: false },
        { type: 'object', required: ['deactivate'], properties: { deactivate: { type: 'string', pattern: idPattern } }, additionalProperties: false },
        ...frames.map(frame),
      ],
    },
  };
}

const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Cartography sequence diagram',
  type: 'object',
  required: ['type'],
  properties: {
    type: { const: 'sequence' },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    autonumber: { type: 'boolean', description: 'Number the messages' },
    captions: { enum: ['kinds', 'written'], description: 'kinds (default): a participant without a caption says its kind; written: only the captions written here' },
    activations: { enum: ['auto', 'explicit'], description: 'auto: calls open activations, replies close them; explicit: only +b, -a, activate:' },
    footers: { type: 'boolean', description: 'Repeat the participants under the lifelines' },
    boxes: {
      type: 'object',
      propertyNames: { pattern: idPattern },
      additionalProperties: { anyOf: [{ type: 'string' }, { type: 'object', properties: { label: { type: 'string' }, tone }, additionalProperties: false }] },
    },
    participants: {
      type: 'object',
      propertyNames: { pattern: idPattern },
      additionalProperties: {
        anyOf: [
          { enum: Object.keys(kinds) },
          { type: 'null' },
          {
            type: 'object',
            properties: {
              kind: { enum: Object.keys(kinds) },
              label: { type: 'string' },
              caption: { type: 'string' },
              icon: { type: 'string' },
              tone,
              box: { type: 'string', pattern: idPattern, description: 'The box it is drawn in' },
              ref: { type: 'string', description: 'The element it stands for, in the model or another diagram' },
            },
            additionalProperties: false,
          },
        ],
      },
    },
    messages: { ...stepsSchema({ $ref: '#/$defs/messages' }), description: 'The messages, in order: "a -> b: text", notes, dividers, refs and frames (alt, opt, loop, par, …)' },
    steps: { ...stepsSchema({ $ref: '#/$defs/messages' }), description: 'The old name of messages:' },
  },
  additionalProperties: false,
  $defs: { messages: stepsSchema({ $ref: '#/$defs/messages' }) },
};

const palette: PaletteItem[] = [
  ...Object.entries(kinds).map(([kind, k]) => ({ collection: 'participants', kind, label: k.label, icon: k.icon, tone: k.tone, keywords: k.keywords })),
  { collection: 'boxes', kind: 'box', label: 'Box', icon: 'square-dashed', tone: 'slate', keywords: ['group', 'system'] },
];

export const sequence: DiagramType<SequenceSource> = {
  id: 'sequence',
  name: 'Sequence',
  description: 'Participants and the messages between them, in order: calls, replies, async events, frames',
  icon: 'arrow-left-right',
  tagline: 'Who calls whom, in what order: calls, replies, async events',
  useWhen: ['A login or OAuth flow, step by step', 'An API integration with a payment provider', 'Event choreography between services', 'A handshake between two systems'],
  notFor: [
    { text: 'Which services exist and how they connect', use: 'systems' },
    { text: 'A process flow with decisions', use: 'process' },
    { text: 'The states one thing goes through', use: 'states' },
    { text: 'What a person goes through and how it feels', use: 'journey' },
  ],
  keywords: ['sequence', 'sequence diagram', 'interaction', 'message', 'call', 'reply', 'request response', 'oauth', 'handshake', 'flow over time', 'lifeline', 'choreography', 'uml'],
  schema,
  palette,
  template: `type: sequence
title: Checkout
autonumber: true

boxes:
  shop: Web shop

participants:
  shopper: person
  web: { kind: client, label: Storefront, box: shop }
  orders: { kind: service, label: Orders, box: shop }
  psp: { kind: payments, label: Stripe }

messages:
  - shopper -> web: Place order
  - web -> orders: POST /orders
  - orders -> psp: Create payment
  - alt: Paid
    messages:
      - psp --> orders: succeeded
      - orders --> web: 201 Created
      - web --> shopper: Confirmation
    else:
      Declined:
        - psp --> orders: card_declined
        - orders --> web: 402 Payment required
        - web --> shopper: Card declined, try another
`,
  build: buildSequence,
  references: sequenceReferences,
  // The whole sequence is the drawing; with dividers each phase is a view of its own, for a slide.
  // A long whole is read scrolling, not on one slide: it is presented by its phases.
  views(src, word = english) {
    const phases = sequencePhases(src);
    // A phase's title is its divider's text, the author's: only the whole, "Start" and "Phase 2" are the type's own words.
    return phases.length ? [{ name: 'whole', title: word('Whole sequence'), scroll: true }, ...phases.map(({ name, title, own }) => ({ name, title: own ? word(own.text, own.params) : title }))] : [];
  },
  connect(src, from, to) {
    const known = (id: string) => !!src.participants && Object.hasOwn(src.participants, id);
    if (!known(from) || !known(to)) return 'Connect one participant to another';
    return { path: [messagesKey(src)], value: `${from} -> ${to}` };
  },
  // One node, drawn whole: no graph layout to run.
  async layout(sized) {
    const s = sized.nodes.get('sequence') ?? { width: 0, height: 0 };
    return { nodes: new Map([['sequence', { x: 0, y: 0, width: s.width, height: s.height }]]), groups: new Map(), edges: new Map(), width: s.width, height: s.height };
  },
};
