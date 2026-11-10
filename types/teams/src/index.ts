// Teams, two ways from one file: an org chart (who reports to whom, vacancies, dotted lines) and a
// Team Topologies view (stream-aligned, platform, enabling and complicated-subsystem teams and how
// they interact), both on the tree engine.
//
//   people:
//     anna: Anna de Vries, CEO              "Name, Role" (or the key is the name and this the role)
//     bo: { name: Bo Jansen, role: CTO, reports: anna }
//     cto-office: { role: Chief of staff, reports: bo, vacant: true }
//     eli: { name: Eli Smit, role: Product lead, reports: bo, dotted: anna, team: checkout }
//   teams:
//     checkout: { kind: stream-aligned, caption: Basket to payment, size: 7 }
//     payments: platform
//   interactions:
//     - checkout -> payments: x-as-a-service   the first uses what the second provides
//     - enablement -> checkout: facilitating
//     - checkout <-> fraud: collaboration
import { parseLink, parseLinks, tones, type BlockForm, type BlockShape, type BuildContext, type DiagramType, type GraphEdge, type GraphNode, type Graph, type LegendItem, type Link, type PaletteItem, type Path, type Reference, type Tone } from '@cartography/core';
import { orgLayout } from './org.ts';
import { topologyLayout } from './topology.ts';

export { orgLayout } from './org.ts';
export { topologyLayout } from './topology.ts';

type PersonEntry = string | null | { name?: string; role?: string; reports?: string; dotted?: string | string[]; team?: string; location?: string; vacant?: boolean; tone?: Tone; description?: string; link?: string; links?: unknown[] };
type TeamEntry = string | null | { kind?: TeamKind; label?: string; caption?: string; size?: number; members?: string[]; lead?: string; description?: string; link?: string; links?: unknown[] };
type InteractionEntry = string | { from?: string; to?: string; mode?: Mode; label?: string } | Record<string, string | null>;

export type TeamKind = 'stream-aligned' | 'platform' | 'enabling' | 'complicated-subsystem';
export type Mode = 'collaboration' | 'x-as-a-service' | 'facilitating';

export interface TeamsSource {
  type: 'teams';
  title?: string;
  subtitle?: string;
  people?: Record<string, PersonEntry>;
  teams?: Record<string, TeamEntry>;
  interactions?: InteractionEntry[];
  /** The flow-of-change arrow over the stream-aligned teams: its words, or false for none. */
  flow?: string | boolean;
  view?: string;
}

export const teamKinds: TeamKind[] = ['stream-aligned', 'platform', 'enabling', 'complicated-subsystem'];
export const modes: Mode[] = ['collaboration', 'x-as-a-service', 'facilitating'];
const KIND_FORM: Record<TeamKind, BlockForm> = { 'stream-aligned': 'stream', platform: 'platform', enabling: 'enabling', 'complicated-subsystem': 'subsystem' };
const KIND_NAME: Record<TeamKind, string> = { 'stream-aligned': 'Stream-aligned team', platform: 'Platform team', enabling: 'Enabling team', 'complicated-subsystem': 'Complicated-subsystem team' };
const MODE_FORM: Record<Mode, BlockForm> = { collaboration: 'collaboration', 'x-as-a-service': 'service', facilitating: 'facilitating' };
const MODE_NAME: Record<Mode, string> = { collaboration: 'Collaboration', 'x-as-a-service': 'X-as-a-Service', facilitating: 'Facilitating' };
/** Short and long ways people write the kinds and the modes. */
const KIND_ALIAS: Record<string, TeamKind> = { stream: 'stream-aligned', 'stream-aligned': 'stream-aligned', platform: 'platform', enabling: 'enabling', subsystem: 'complicated-subsystem', 'complicated-subsystem': 'complicated-subsystem' };
const MODE_ALIAS: Record<string, Mode> = { collaboration: 'collaboration', collaborate: 'collaboration', 'x-as-a-service': 'x-as-a-service', xaas: 'x-as-a-service', service: 'x-as-a-service', 'as-a-service': 'x-as-a-service', facilitating: 'facilitating', facilitate: 'facilitating' };
const BRANCH_TONES: Tone[] = ['blue', 'teal', 'violet', 'amber', 'rose', 'indigo', 'green', 'orange', 'sky'];
/** Little words of a name that are no initials: van, de, der… */
const PARTICLES = new Set(['van', 'de', 'der', 'den', 'het', 'ten', 'ter', 'von', 'zu', 'la', 'le', 'du', 'da', 'di', 'del', 'dos', 'das', 'bin', 'al', "'t"]);

/** An id read as a name: "open-sre" → "Open sre". */
const humane = (id: string) => (/^[a-z0-9_-]+$/.test(id) ? id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]+/g, ' ') : id);

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]);

/** A person written short: "Anna de Vries, CEO", or just the role when the key is the name. */
export function personShorthand(v: unknown): Exclude<PersonEntry, string | null> {
  if (typeof v === 'string') {
    const cut = v.indexOf(', ');
    return cut > 0 ? { name: v.slice(0, cut).trim(), role: v.slice(cut + 2).trim() } : { role: v.trim() };
  }
  return v && typeof v === 'object' ? (v as Exclude<PersonEntry, string | null>) : {};
}

export function teamShorthand(v: unknown): Exclude<TeamEntry, string | null> {
  if (typeof v === 'string') return KIND_ALIAS[v.toLowerCase()] ? { kind: KIND_ALIAS[v.toLowerCase()] } : { label: v };
  return v && typeof v === 'object' ? (v as Exclude<TeamEntry, string | null>) : {};
}

export function initialsOf(name: string): string {
  const words = name.replace(/[()]/g, ' ').split(/\s+/).filter((w) => w && !PARTICLES.has(w.toLowerCase()) && /\p{L}/u.test(w));
  if (!words.length) return '';
  const first = [...words[0]!].find((c) => /\p{L}/u.test(c)) ?? '';
  const last = words.length > 1 ? ([...words.at(-1)!].find((c) => /\p{L}/u.test(c)) ?? '') : '';
  return (first + last).toUpperCase();
}

interface Tie {
  from: string;
  to: string;
  mode: Mode;
  label?: string;
  path: Path;
  /** Where the names sit in a written line, for renames. */
  at?: { from: number; to: number };
  /** Written "a -> b: mode", which YAML reads as a map: the names are in its key. */
  keyed?: boolean;
}

const LINE = /^\s*(\S+?)\s*(<->|->|--)\s*(\S+?)\s*(?::\s*(.*?))?\s*$/;

/** Interactions as written: "a -> b: x-as-a-service", "a <-> b: collaboration", or { from, to, mode }. */
export function readInteractions(raw: InteractionEntry[] | undefined, report?: (path: Path, message: string) => void): Tie[] {
  const out: Tie[] = [];
  for (const [i, entry] of (raw ?? []).entries()) {
    const path = ['interactions', i];
    // "a -> b: mode" reads in YAML as a map with one key: the same line.
    const keys = entry && typeof entry === 'object' ? Object.keys(entry) : [];
    const keyed = keys.length === 1 && LINE.test(`${keys[0]}`) && !('from' in (entry as object));
    const item = keyed ? `${keys[0]}: ${String((entry as Record<string, unknown>)[keys[0]!] ?? '')}` : entry;
    if (typeof item === 'string') {
      const m = LINE.exec(item);
      if (!m) {
        report?.(path, 'An interaction is "team -> team: mode", with mode collaboration, x-as-a-service or facilitating');
        continue;
      }
      const words = m[4]?.trim();
      const mode = words ? MODE_ALIAS[words.split(/[\s,(]/)[0]!.toLowerCase()] : m[2] === '->' ? 'x-as-a-service' : 'collaboration';
      if (!mode) {
        report?.(path, `"${words}" is not an interaction mode: collaboration, x-as-a-service or facilitating`);
        continue;
      }
      const rest = words && words.includes(':') ? words.slice(words.indexOf(':') + 1).trim() : undefined;
      out.push({ from: m[1]!, to: m[3]!, mode, ...(rest ? { label: rest } : {}), path, at: { from: item.indexOf(m[1]!), to: item.indexOf(m[3]!, item.indexOf(m[2]!)) }, ...(keyed ? { keyed: true } : {}) });
    } else if (item && typeof item === 'object') {
      const mode = item.mode ? MODE_ALIAS[String(item.mode).toLowerCase()] : 'collaboration';
      if (!item.from || !item.to || !mode) {
        report?.(path, 'An interaction needs from:, to: and a mode: collaboration, x-as-a-service or facilitating');
        continue;
      }
      out.push({ from: item.from, to: item.to, mode, ...(item.label ? { label: item.label } : {}), path });
    }
  }
  return out;
}

const linksOf = (e: { link?: string; links?: unknown[] }, path: Path, ctx: BuildContext): Link[] | undefined => {
  if (e.link != null) {
    const l = parseLink(e.link);
    if (!l) ctx.error([...path, 'link'], 'A link is a URL, another diagram (other.yaml) or a view (other.yaml#view)');
    return l ? [l] : undefined;
  }
  return parseLinks(e.links);
};

const hasPeople = (src: TeamsSource) => Object.keys(src.people ?? {}).length > 0;
const hasTeams = (src: TeamsSource) => Object.keys(src.teams ?? {}).length > 0;

export function buildTeams(src: TeamsSource, ctx: BuildContext): Graph {
  const view = src.view === 'topology' || src.view === 'org' ? src.view : hasPeople(src) || !hasTeams(src) ? 'org' : 'topology';
  return view === 'org' ? buildOrg(src, ctx) : buildTopology(src, ctx);
}

function buildOrg(src: TeamsSource, ctx: BuildContext): Graph {
  const people = Object.entries(src.people ?? {}).map(([id, raw]) => ({ id, e: personShorthand(raw), path: ['people', id] as Path }));
  const known = new Set(people.map((p) => p.id));
  const teamLabel = (t: string) => {
    const e = src.teams?.[t];
    return e === undefined ? t : (teamShorthand(e).label ?? humane(t));
  };
  // Who reports to whom; a loop is cut where it closes.
  const manager = new Map<string, string>();
  for (const p of people) {
    const r = p.e.reports;
    if (r == null) continue;
    if (!known.has(r)) ctx.error([...p.path, 'reports'], `There is no person "${r}"`);
    else if (r === p.id) ctx.error([...p.path, 'reports'], 'Someone cannot report to themselves');
    else {
      let a: string | undefined = r;
      let loop = false;
      for (let n = 0; a && n <= people.length; a = manager.get(a), n++) if (a === p.id) loop = true;
      if (loop) ctx.error([...p.path, 'reports'], `"${p.id}" would report to themselves through "${r}"`);
      else manager.set(p.id, r);
    }
  }
  // A colour per branch under the top: who belongs where, also in print. Written tones carry down.
  const tone = new Map<string, Tone>();
  const reportsOf = (id: string) => people.filter((p) => manager.get(p.id) === id);
  const roots = people.filter((p) => !manager.has(p.id));
  const paint = (id: string, t: Tone) => {
    const own = people.find((p) => p.id === id)?.e.tone;
    const here = own && tones.includes(own) ? own : t;
    tone.set(id, here);
    for (const r of reportsOf(id)) paint(r.id, here);
  };
  let k = 0;
  for (const r of roots) {
    tone.set(r.id, r.e.tone && tones.includes(r.e.tone) ? r.e.tone : 'slate');
    const reports = reportsOf(r.id);
    // A lone root with reports: each report's branch has a colour. Several roots: each root's tree has one.
    if (roots.length === 1) for (const c of reports) paint(c.id, BRANCH_TONES[k++ % BRANCH_TONES.length]!);
    else paint(r.id, r.e.tone ?? BRANCH_TONES[k++ % BRANCH_TONES.length]!);
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let vacancies = 0;
  let dotted = 0;
  for (const p of people) {
    const e = p.e;
    const vacant = !!e.vacant;
    if (vacant) vacancies++;
    const name = e.name ?? (vacant ? 'Vacancy' : humane(p.id));
    const extra = [e.team ? teamLabel(e.team) : undefined, e.location].filter((x): x is string => !!x);
    const shape: BlockShape = {
      kind: 'block',
      form: 'person',
      label: name,
      ...(e.role ? { caption: e.role } : {}),
      tone: tone.get(p.id) ?? 'slate',
      ...(vacant ? { vacant: true } : { initials: initialsOf(name) }),
      ...(extra.length ? { lines: extra } : {}),
    };
    const links = linksOf(e, p.path, ctx);
    const description = e.description;
    nodes.push({ id: p.id, shape, path: p.path, kind: vacant ? 'vacancy' : 'person', ...(e.team ? { tags: [e.team] } : {}), ...(links?.length ? { links } : {}), ...(description ? { description } : {}) });
    const m = manager.get(p.id);
    if (m) edges.push({ id: `reports:${p.id}`, from: { node: m }, to: { node: p.id }, line: 'solid', start: 'none', end: 'none', kind: 'reports', path: [...p.path, 'reports'] });
    const dots = list(e.dotted);
    for (const [i, d] of dots.entries()) {
      const at = [...p.path, 'dotted', ...(Array.isArray(e.dotted) ? [i] : [])];
      if (!known.has(d)) ctx.error(at, `There is no person "${d}"`);
      else if (d !== p.id) {
        dotted++;
        edges.push({ id: `dotted:${p.id}:${i}`, from: { node: d }, to: { node: p.id }, line: 'dotted', start: 'none', end: 'arrow', tone: 'slate', kind: 'dotted', path: at, loose: true });
      }
    }
  }
  const legend: LegendItem[] = [];
  if (dotted) legend.push({ label: 'Reports to', line: 'solid' }, { label: 'Dotted-line report', line: 'dotted', tone: 'slate' });
  if (vacancies) legend.push({ label: 'Vacancy', swatch: 'block', block: { form: 'person' } });
  return { title: src.title, subtitle: src.subtitle, direction: 'down', groups: [], nodes, edges, tree: true, ...(legend.length ? { legend } : {}) };
}

function buildTopology(src: TeamsSource, ctx: BuildContext): Graph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const kinds = new Set<TeamKind>();
  const ids = new Set<string>();
  for (const [id, raw] of Object.entries(src.teams ?? {})) {
    const e = teamShorthand(raw);
    const path = ['teams', id];
    const kind = e.kind ? KIND_ALIAS[String(e.kind).toLowerCase()] : 'stream-aligned';
    if (!kind) ctx.error([...path, 'kind'], `"${e.kind}" is not a team type: stream-aligned, platform, enabling or complicated-subsystem`);
    const k = kind ?? 'stream-aligned';
    kinds.add(k);
    ids.add(id);
    const size = e.size ?? (e.members?.length || undefined);
    const lead = e.lead ? personShorthand(src.people?.[e.lead]).name ?? e.lead : undefined;
    const caption = [e.caption, lead ? `Lead: ${lead}` : undefined].filter(Boolean).join(' · ');
    const shape: BlockShape = { kind: 'block', form: KIND_FORM[k], label: e.label ?? humane(id), ...(caption ? { caption } : {}), tone: 'slate', ...(size ? { badge: `${size} ${size === 1 ? 'person' : 'people'}` } : {}) };
    const links = linksOf(e, path, ctx);
    nodes.push({ id, shape, path, kind: k, ...(links?.length ? { links } : {}), description: [KIND_NAME[k], e.description].filter(Boolean).join('. ') });
  }
  if (src.flow !== false && nodes.some((n) => n.kind === 'stream-aligned'))
    nodes.push({ id: 'flow of change', shape: { kind: 'block', form: 'flow', label: typeof src.flow === 'string' ? src.flow : 'Flow of change', tone: 'slate' }, path: ['flow'], kind: 'flow' });
  const used = new Set<Mode>();
  for (const [i, t] of readInteractions(src.interactions, ctx.error).entries()) {
    const bad = [t.from, t.to].filter((x) => !ids.has(x));
    if (bad.length) {
      ctx.error(t.path, `There is no team "${bad[0]}"`);
      continue;
    }
    used.add(t.mode);
    const style: Pick<GraphEdge, 'line' | 'tone' | 'end' | 'width'> = t.mode === 'collaboration' ? { line: 'solid', tone: 'indigo', end: 'none', width: 1.5 } : t.mode === 'facilitating' ? { line: 'dotted', tone: 'green', end: 'arrow', width: 1.3 } : { line: 'solid', tone: 'slate', end: 'arrow' };
    edges.push({ id: `interaction:${i}`, from: { node: t.from }, to: { node: t.to }, ...style, start: 'none', kind: t.mode, path: t.path });
    nodes.push({ id: `${t.from} ${t.mode} ${t.to}`, shape: { kind: 'block', form: MODE_FORM[t.mode], label: t.label ?? '', tone: 'slate', between: [t.from, t.to] }, path: t.path, kind: t.mode, description: `${MODE_NAME[t.mode]}: ${t.from} and ${t.to}${t.label ? ` (${t.label})` : ''}` });
  }
  const legend: LegendItem[] = [
    ...teamKinds.filter((k) => kinds.has(k)).map((k): LegendItem => ({ label: KIND_NAME[k], swatch: 'block', block: { form: KIND_FORM[k] } })),
    ...modes.filter((m) => used.has(m)).map((m): LegendItem => ({ label: MODE_NAME[m], swatch: 'block', block: { form: MODE_FORM[m] } })),
  ];
  return { title: src.title, subtitle: src.subtitle, direction: 'right', groups: [], nodes, edges, ...(legend.length ? { legend } : {}) };
}

export function teamsReferences(src: TeamsSource): Reference[] {
  const out: Reference[] = [];
  const people = new Set(Object.keys(src.people ?? {}));
  const teams = new Set(Object.keys(src.teams ?? {}));
  for (const [id, raw] of Object.entries(src.people ?? {})) {
    if (!raw || typeof raw !== 'object') continue;
    if (typeof raw.reports === 'string' && people.has(raw.reports)) out.push({ path: ['people', id, 'reports'], id: raw.reports, start: 0, collection: 'people', onDelete: 'key' });
    if (typeof raw.dotted === 'string' && people.has(raw.dotted)) out.push({ path: ['people', id, 'dotted'], id: raw.dotted, start: 0, collection: 'people', onDelete: 'key' });
    else if (Array.isArray(raw.dotted)) for (const [i, d] of raw.dotted.entries()) if (people.has(d)) out.push({ path: ['people', id, 'dotted', i], id: d, start: 0, collection: 'people' });
    if (typeof raw.team === 'string' && teams.has(raw.team)) out.push({ path: ['people', id, 'team'], id: raw.team, start: 0, collection: 'teams', onDelete: 'key' });
  }
  for (const [id, raw] of Object.entries(src.teams ?? {})) {
    if (!raw || typeof raw !== 'object') continue;
    if (typeof raw.lead === 'string' && people.has(raw.lead)) out.push({ path: ['teams', id, 'lead'], id: raw.lead, start: 0, collection: 'people', onDelete: 'key' });
    for (const [i, m] of (raw.members ?? []).entries()) if (people.has(m)) out.push({ path: ['teams', id, 'members', i], id: m, start: 0, collection: 'people' });
  }
  for (const t of readInteractions(src.interactions)) {
    if (!t.at) {
      if (teams.has(t.from)) out.push({ path: [...t.path, 'from'], id: t.from, start: 0, collection: 'teams', onDelete: 'item' });
      if (teams.has(t.to)) out.push({ path: [...t.path, 'to'], id: t.to, start: 0, collection: 'teams', onDelete: 'item' });
      continue;
    }
    const key = t.keyed ? { key: true } : {};
    if (teams.has(t.from)) out.push({ path: t.path, ...key, id: t.from, start: t.at.from, collection: 'teams' });
    if (teams.has(t.to)) out.push({ path: t.path, ...key, id: t.to, start: t.at.to, collection: 'teams' });
  }
  return out;
}

// ---------------------------------------------------------------- schema

const tone = { enum: tones };
const linkSchema = { type: 'string', description: 'A URL, another diagram (other.yaml) or a view (other.yaml#view)' };
const ids = { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] };

const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Cartography teams',
  type: 'object',
  required: ['type'],
  properties: {
    type: { const: 'teams' },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    people: {
      type: 'object',
      description: 'People and roles: drawn as the org chart',
      additionalProperties: {
        anyOf: [
          { type: 'null' },
          { type: 'string', description: '"Name, Role", or the role when the key is the name' },
          {
            type: 'object',
            properties: {
              name: { type: 'string' },
              role: { type: 'string' },
              reports: { type: 'string', description: 'Who they report to' },
              dotted: { ...ids, description: 'Dotted-line reports: who else they answer to' },
              team: { type: 'string', description: 'Their team (an entry of teams:, or a name)' },
              location: { type: 'string' },
              vacant: { type: 'boolean', description: 'A role nobody fills yet' },
              tone: { ...tone, description: 'Colour of their branch' },
              description: { type: 'string' },
              link: linkSchema,
              links: { type: 'array' },
            },
            additionalProperties: false,
          },
        ],
      },
    },
    teams: {
      type: 'object',
      description: 'Teams by Team Topologies type: drawn as the topology view',
      additionalProperties: {
        anyOf: [
          { type: 'null' },
          { type: 'string', description: 'Its type: stream-aligned, platform, enabling or complicated-subsystem' },
          {
            type: 'object',
            properties: {
              kind: { enum: [...teamKinds, 'stream', 'subsystem'], description: 'Team type (default stream-aligned)' },
              label: { type: 'string' },
              caption: { type: 'string', description: 'What it is for: a line under the name' },
              size: { type: 'integer', minimum: 0, description: 'How many people' },
              members: { type: 'array', items: { type: 'string' }, description: 'People in it (entries of people:)' },
              lead: { type: 'string', description: 'Who leads it (an entry of people:)' },
              description: { type: 'string' },
              link: linkSchema,
              links: { type: 'array' },
            },
            additionalProperties: false,
          },
        ],
      },
    },
    interactions: {
      type: 'array',
      description: 'How teams interact: "a -> b: x-as-a-service" (a uses what b provides), "a -> b: facilitating", "a <-> b: collaboration"',
      items: {
        anyOf: [
          { type: 'string' },
          { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' }, mode: { enum: [...modes, 'xaas'] }, label: { type: 'string' } }, additionalProperties: false },
          { type: 'object', minProperties: 1, maxProperties: 1, additionalProperties: { type: ['string', 'null'] }, description: '"a -> b: mode"' },
        ],
      },
    },
    flow: { anyOf: [{ type: 'string' }, { type: 'boolean' }], description: 'The flow-of-change arrow over the stream-aligned teams: its words, or false for none' },
    view: { enum: ['org', 'topology'] },
  },
  additionalProperties: false,
};

const palette: PaletteItem[] = [
  { collection: 'people', kind: 'person', label: 'Person', icon: 'user', tone: 'blue', keywords: ['person', 'role', 'manager', 'employee', 'report'] },
  { collection: 'teams', kind: 'stream-aligned', label: 'Stream-aligned team', icon: 'users', tone: 'amber', keywords: ['team', 'product team', 'feature team', 'stream'] },
  { collection: 'teams', kind: 'platform', label: 'Platform team', icon: 'layers', tone: 'sky', keywords: ['platform', 'infrastructure', 'internal product'] },
  { collection: 'teams', kind: 'enabling', label: 'Enabling team', icon: 'sparkles', tone: 'violet', keywords: ['enabling', 'coaching', 'guild', 'community'] },
  { collection: 'teams', kind: 'complicated-subsystem', label: 'Complicated-subsystem team', icon: 'cpu', tone: 'orange', keywords: ['specialist', 'subsystem', 'complicated'] },
];

export const teams: DiagramType<TeamsSource> = {
  id: 'teams',
  name: 'Teams & org chart',
  description: 'People and teams: an org chart with vacancies and dotted lines, and a Team Topologies view of team types and how they interact',
  icon: 'users',
  tagline: 'Who reports to whom, and how teams work together (Team Topologies)',
  useWhen: ['An org chart with vacancies and dotted-line reports', 'Team Topologies: stream-aligned, platform, enabling teams', 'How teams interact: collaboration, as a service, facilitating', 'The client team on an engagement, and who leads what'],
  notFor: [
    { text: 'GitHub teams and repository permissions', use: 'github' },
    { text: 'Who gets access to what', use: 'access' },
    { text: 'What the business does, by capability', use: 'capabilities' },
    { text: 'Who does which step of a process', use: 'process' },
  ],
  keywords: ['org chart', 'organisation chart', 'organization chart', 'orgchart', 'organogram', 'reporting line', 'reports to', 'hierarchy', 'team topologies', 'stream-aligned', 'platform team', 'enabling team', 'complicated subsystem', 'interaction modes', 'x-as-a-service', 'team structure', 'people', 'vacancy', 'dotted line', 'raci team'],
  schema,
  palette,
  template: `type: teams
title: Product and technology
subtitle: Org chart and team topology, Q3

people:
  anna: Anna de Vries, Chief product and technology officer
  bo: { name: Bo Jansen, role: Head of product, reports: anna }
  cem: { name: Cem Yilmaz, role: Head of engineering, reports: anna }
  dana: { name: Dana Smit, role: Product lead Checkout, reports: bo, team: checkout }
  eli: { name: Eli Bakker, role: Product lead Search, reports: bo, team: search }
  fay: { name: Fay Visser, role: Platform lead, reports: cem, team: platform, dotted: bo }
  open-sre: { role: SRE coach, reports: cem, vacant: true, team: enablement }

teams:
  checkout: { kind: stream-aligned, caption: Basket to payment, size: 7 }
  search: { kind: stream-aligned, caption: Find and compare, size: 6 }
  enablement: { kind: enabling, caption: SRE practices, size: 2 }
  platform: { kind: platform, caption: Paved road, size: 8 }

interactions:
  - enablement -> checkout: facilitating
  - checkout <-> search: collaboration
  - search -> platform: x-as-a-service
`,
  build: buildTeams,
  references: teamsReferences,
  refKeys: { reports: ['people'], dotted: ['people'], lead: ['people'], members: ['people'], team: ['teams'] },
  shorthand(collection, value) {
    if (collection === 'people') return personShorthand(value) as Record<string, unknown>;
    if (collection === 'teams') return teamShorthand(value) as Record<string, unknown>;
    return undefined;
  },
  connect(src, from, to) {
    const people = src.people ?? {};
    const teamsMap = src.teams ?? {};
    if (from === to) return 'Pick someone else to connect to';
    if (Object.hasOwn(people, from) && Object.hasOwn(people, to)) {
      // From manager to report; a second manager becomes a dotted line.
      const e = personShorthand(people[to]);
      if (e.reports === from || list(e.dotted).includes(from)) return 'They are already connected';
      return e.reports ? { path: ['people', to, 'dotted'], value: from } : { path: ['people', to], key: 'reports', value: from };
    }
    if (Object.hasOwn(teamsMap, from) && Object.hasOwn(teamsMap, to)) return { path: ['interactions'], value: `${from} -> ${to}: x-as-a-service` };
    return 'Connect a manager to a report, or one team to another';
  },
  views(src) {
    return hasPeople(src) && hasTeams(src) ? [{ name: 'org', title: 'Org chart' }, { name: 'topology', title: 'Team Topologies' }] : [];
  },
  async layout(sized, _pins, previous) {
    return sized.graph.tree ? orgLayout(sized, previous?.variant) : topologyLayout(sized);
  },
};
