// Mind maps: a central topic with branches around it, each level a step lighter than the one inside
// it, each branch in a colour of its own that its topics keep. Written as nested lists, as the
// capability map is, or flat with `parent:` (what the builder writes).
//
//   center: Choose an event store
//   layout: both                          both sides (default when it fits a slide best), right or left
//   depth: 3                              draw three levels; deeper ones fold into "+n"
//   topics:
//     Options:                            a branch: its topics as a list…
//       - EventStoreDB: { note: Built for it, icon: database }
//       - Kafka: [Retention, Compaction]
//     Criteria:                           …or as a map with topics:
//       tone: teal
//       topics: [Operations effort, Cost]
//     Replay: { parent: Criteria }        or anywhere, with parent:
//     Risks: Nobody on the team knows it  a string is a note
import { parseLink, parseLinks, tones, type BlockShape, type BuildContext, type DiagramType, type Graph, type GraphEdge, type GraphNode, type Link, type Path, type Reference, type Tone } from '@cartography/core';
import { mindmapLayout } from './layout.ts';

export { mindmapLayout, sides } from './layout.ts';

type Entry = string | number | null | unknown[] | Record<string, unknown>;

export interface MindmapSource {
  type: 'mindmap';
  title?: string;
  subtitle?: string;
  /** The central topic: its words, or { label, note, icon }. Without it, the title. */
  center?: string | { label?: string; note?: string; icon?: string };
  layout?: 'auto' | 'both' | 'right' | 'left';
  depth?: number;
  topics?: Record<string, Entry>;
}

export const CENTER = '(center)';
/** Branch colours in order: apart from their neighbours, calm on a slide. */
const BRANCH_TONES: Tone[] = ['blue', 'teal', 'violet', 'amber', 'rose', 'indigo', 'green', 'orange', 'sky'];
/** Keys of a topic that are not its topics. */
const OWN = new Set(['label', 'note', 'icon', 'tone', 'parent', 'side', 'topics', 'description', 'link', 'links']);

interface Topic {
  id: string;
  name: string;
  props: Record<string, unknown>;
  parent?: Topic;
  parentRef?: string;
  refPath?: Path;
  children: Topic[];
  path: Path;
}

/** Every topic, nested or flat, into one tree under the centre. */
export function readTopics(src: MindmapSource, ctx?: Pick<BuildContext, 'error'>): Topic[] {
  const all = new Map<string, Topic>();
  const order: Topic[] = [];
  const add = (name: string, raw: Entry | undefined, path: Path, parent?: Topic) => {
    let props: Record<string, unknown> = {};
    let kids: { name: string; raw: Entry | undefined; path: Path }[] = [];
    const listKids = (list: unknown[], base: Path) =>
      list.flatMap((item, i): { name: string; raw: Entry | undefined; path: Path }[] => {
        if (typeof item === 'string' || typeof item === 'number') return [{ name: String(item), raw: null, path: [...base, i] }];
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const keys = Object.keys(item);
          if (keys.length === 1) return [{ name: keys[0]!, raw: (item as Record<string, Entry>)[keys[0]!], path: [...base, i, keys[0]!] }];
        }
        ctx?.error([...base, i], 'A topic in a list is its words, or "Topic: [its topics]" or "Topic: { note: … }"');
        return [];
      });
    if (Array.isArray(raw)) kids = listKids(raw, path);
    else if (typeof raw === 'string' || typeof raw === 'number') props = { note: String(raw) };
    else if (raw && typeof raw === 'object') {
      props = raw;
      const inner = raw.topics;
      if (Array.isArray(inner)) kids = listKids(inner, [...path, 'topics']);
      else if (inner && typeof inner === 'object') kids = Object.entries(inner as Record<string, Entry>).map(([k, v]) => ({ name: k, raw: v, path: [...path, 'topics', k] }));
      for (const k of Object.keys(raw)) if (!OWN.has(k)) ctx?.error([...path, k], `A topic has label, note, icon, tone, side, parent and topics; "${k}" is none of them (a topic named so goes under topics:)`);
    }
    // The same words under two branches are told apart by where they stand.
    let id = name;
    if (all.has(id) || id === CENTER) id = parent ? `${parent.id} › ${name}` : `${name} (${order.length})`;
    const t: Topic = { id, name, props, children: [], path };
    if (parent) {
      t.parent = parent;
      parent.children.push(t);
    } else if (typeof props.parent === 'string') {
      t.parentRef = props.parent;
      t.refPath = [...path, 'parent'];
    }
    all.set(id, t);
    order.push(t);
    for (const k of kids) add(k.name, k.raw, k.path, t);
  };
  for (const [name, raw] of Object.entries(src.topics ?? {})) add(name, raw, ['topics', name]);
  for (const t of order) {
    if (!t.parentRef) continue;
    const p = all.get(t.parentRef);
    if (!p) {
      ctx?.error(t.refPath!, `There is no topic "${t.parentRef}"`);
      continue;
    }
    let loop = false;
    for (let a: Topic | undefined = p; a; a = a.parent) if (a === t) loop = true;
    if (loop) {
      ctx?.error(t.refPath!, `"${t.id}" would stand under itself`);
      continue;
    }
    t.parent = p;
    p.children.push(t);
  }
  return order.filter((t) => !t.parent);
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined);

function build(src: MindmapSource, ctx: BuildContext): Graph {
  const branches = readTopics(src, ctx);
  const depth = Math.max(1, Math.round(src.depth ?? 99));
  const c = typeof src.center === 'object' && src.center ? src.center : { label: str(src.center) };
  const nodes: GraphNode[] = [
    {
      id: CENTER,
      shape: { kind: 'block', form: 'topic', level: 0, label: str(c.label) ?? src.title ?? 'Topic', ...(str(c.note) ? { caption: str(c.note)! } : {}), ...(str(c.icon) ? { icon: str(c.icon)! } : {}), tone: 'slate' },
      kind: 'center',
      path: src.center !== undefined ? ['center'] : ['title'],
    },
  ];
  const edges: GraphEdge[] = [];
  const arrange: Record<string, string> = {};
  if (src.layout && src.layout !== 'auto') arrange.layout = src.layout;
  const count = (t: Topic): number => t.children.reduce((s, k) => s + 1 + count(k), 0);
  const walk = (t: Topic, level: number, tone: Tone, parent: string) => {
    const own = tones.includes(t.props.tone as Tone) ? (t.props.tone as Tone) : tone;
    const folded = level === depth ? count(t) : 0;
    const label = str(t.props.label) ?? t.name;
    const links: Link[] | undefined = t.props.link != null ? [parseLink(t.props.link)].filter((l): l is Link => !!l) : parseLinks(t.props.links);
    if (t.props.link != null && !links?.length) ctx.error([...t.path, 'link'], 'A link is a URL, another diagram (other.yaml) or a view (other.yaml#view)');
    const shape: BlockShape = {
      kind: 'block',
      form: 'topic',
      level,
      label,
      tone: own,
      ...(str(t.props.note) ? { caption: str(t.props.note)! } : {}),
      ...(str(t.props.icon) ? { icon: str(t.props.icon)! } : {}),
      ...(folded ? { badge: `+${folded}` } : {}),
    };
    nodes.push({ id: t.id, shape, kind: `level-${level}`, path: t.path, ...(links?.length ? { links } : {}), ...(str(t.props.description) ? { description: str(t.props.description)! } : {}) });
    // Lines get lighter further out, as the topics do.
    edges.push({ id: `to-${t.id}`, from: { node: parent }, to: { node: t.id }, line: 'solid', start: 'none', end: 'none', kind: 'branch', loose: true, tone: own, width: level === 1 ? 1.7 : level === 2 ? 1.3 : 1, path: t.path });
    if (level === 1 && (t.props.side === 'left' || t.props.side === 'right')) arrange[`side:${t.id}`] = t.props.side;
    if (level < depth) for (const k of t.children) walk(k, level + 1, own, t.id);
  };
  for (const [i, b] of branches.entries()) walk(b, 1, BRANCH_TONES[i % BRANCH_TONES.length]!, CENTER);
  if (!branches.length) ctx.warn(['topics'], 'Add topics around the centre: topics: { Options: [A, B], Risks: [C] }');
  return { title: src.title, subtitle: src.subtitle, direction: 'right', groups: [], nodes, edges, arrange, tree: true };
}

function references(src: MindmapSource): Reference[] {
  const out: Reference[] = [];
  const topics = src.topics ?? {};
  const names = new Set<string>();
  const collect = (map: Record<string, Entry>) => {
    for (const [k, v] of Object.entries(map)) {
      names.add(k);
      if (v && typeof v === 'object' && !Array.isArray(v) && v.topics && typeof v.topics === 'object' && !Array.isArray(v.topics)) collect(v.topics as Record<string, Entry>);
    }
  };
  collect(topics);
  for (const [k, v] of Object.entries(topics))
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.parent === 'string' && names.has(v.parent)) out.push({ path: ['topics', k, 'parent'], id: v.parent, start: 0, collection: 'topics', onDelete: 'key' });
  return out;
}

const topicSchema = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'Its words, when they differ from its key' },
    note: { type: 'string', description: 'A short line under it' },
    icon: { type: 'string', description: 'A Lucide icon name: lightbulb, flag, users…' },
    tone: { enum: tones, description: 'The colour of a branch (its topics keep it)' },
    side: { enum: ['left', 'right'], description: 'Which side of the centre a branch stands on' },
    parent: { type: 'string', description: 'The topic it stands under (instead of writing it inside)' },
    topics: { anyOf: [{ type: 'array' }, { type: 'object' }], description: 'The topics under it' },
    description: { type: 'string' },
    link: { type: 'string', description: 'A URL, another diagram (other.yaml) or a view (other.yaml#view)' },
    links: { type: 'array' },
  },
  additionalProperties: false,
};

const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Cartography mind map',
  type: 'object',
  required: ['type'],
  properties: {
    type: { const: 'mindmap' },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    center: {
      anyOf: [
        { type: 'string', description: 'The central topic (without it, the title)' },
        { type: 'object', properties: { label: { type: 'string' }, note: { type: 'string' }, icon: { type: 'string' } }, additionalProperties: false },
      ],
    },
    layout: { enum: ['auto', 'both', 'right', 'left'], description: 'Branches on both sides of the centre, or all to one side; auto (default) picks what fits a slide' },
    depth: { type: 'integer', minimum: 1, description: 'How many levels to draw; deeper topics fold into "+n"' },
    topics: {
      type: 'object',
      description: 'The branches, with their topics inside (a list or a map), or anywhere with parent:',
      additionalProperties: { anyOf: [{ type: 'null' }, { type: 'string' }, { type: 'number' }, { type: 'array' }, topicSchema] },
    },
  },
  additionalProperties: false,
};

export const mindmap: DiagramType<MindmapSource> = {
  id: 'mindmap',
  name: 'Mind map',
  description: 'A central topic with branches around it: brainstorms, decision options, agendas, the parts of a subject',
  icon: 'brain',
  tagline: 'A central topic with branches around it, for brainstorms',
  useWhen: ['Brainstorm options and criteria for a decision', 'A workshop agenda or the outline of a talk', 'Collect ideas before they have a structure', 'The parts of a subject on one slide'],
  notFor: [
    { text: 'What the business does, as a map to invest by', use: 'capabilities' },
    { text: 'Who reports to whom', use: 'teams' },
    { text: 'Steps in order, with decisions', use: 'process' },
  ],
  keywords: ['mind map', 'mindmap', 'mind-map', 'brainstorm', 'ideas', 'central topic', 'branches', 'outline', 'agenda', 'workshop', 'topics', 'subtopics', 'idea map', 'concept map', 'options', 'xmind'],
  schema,
  palette: [{ collection: 'topics', kind: 'topic', label: 'Topic', icon: 'brain', tone: 'blue', keywords: ['branch', 'idea', 'subtopic'] }],
  build,
  references,
  freeNames: true,
  refKeys: { parent: ['topics'] },
  shorthand(collection, value) {
    if (collection !== 'topics') return undefined;
    if (typeof value === 'string' || typeof value === 'number') return { note: String(value) };
    if (Array.isArray(value)) return { topics: value };
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  },
  connect(src, from, to) {
    const t = src.topics?.[to];
    if (!src.topics || !Object.hasOwn(src.topics, to) || (t != null && (typeof t !== 'object' || Array.isArray(t)))) return 'Drag from a topic to a branch written at the top of topics: (one without topics inside) to hang it there';
    if (from === to) return 'A topic cannot stand under itself';
    if (from === CENTER) return 'Every branch written at the top of topics: already comes from the centre';
    return { path: ['topics', to], key: 'parent', value: from };
  },
  async layout(sized, _pins, previous) {
    return mindmapLayout(sized, previous);
  },
  template: `type: mindmap
title: Which event store?
subtitle: Architecture decision brainstorm, before the ADR

center: Event store for Orders
topics:
  Options:
    - EventStoreDB: { note: Built for event sourcing }
    - Kafka: { note: A log rather than a store }
    - Postgres with an outbox
    - DynamoDB streams
  Must have:
    - Replay a stream from any point
    - Optimistic concurrency per stream
    - Subscriptions with at-least-once delivery
  Operations:
    - Who runs it at night
    - Backups and restore drills
    - Managed offering in our region
  Risks:
    - Nobody on the team knows it yet
    - Lock-in to one vendor
  Next steps:
    - Spike on two options
    - Write the ADR
`,
};
