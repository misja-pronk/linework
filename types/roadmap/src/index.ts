// Roadmaps and timelines: workstreams as lanes along a time axis, items as bars, milestones as
// diamonds, phases (migration waves) as bands behind everything, dependencies as arrows.
//
//   from: 2026-01                   axis: dates (month, 2026-Q2, 2026-W14, 2026-03-15) and a unit
//   to: 2026-12
//   unit: month                     week | month | quarter
//   periods: [Now, Next, Later]     or named periods instead of dates
//   today: 2026-04-15
//   lanes:
//     platform: Platform team
//   phases:
//     Wave 1: { from: 2026-01, to: 2026-04, tone: sky }
//   items:
//     landing-zone: { lane: platform, label: Landing zone, from: 2026-01, to: 2026-02, status: done }
//     aks: { lane: platform, after: landing-zone, duration: 8w, status: active, progress: 40% }
//     go-live: { at: 2026-09-01, label: Go-live }      a milestone (on the axis when it has no lane)
import { english, type BuildContext, type DiagramType, type Graph, type PaletteItem, type Path, type Reference, type RoadmapItem, type RoadmapShape, type RoadmapStatus, type Tone, tones } from '@cartography/core';
import { addDuration, day, floorUnit, formatDay, nextUnit, parseDate, ticks, type Unit } from './dates.ts';

export { addDuration, parseDate, ticks, type Unit };

export const statuses: RoadmapStatus[] = ['planned', 'active', 'done', 'at-risk', 'late'];
const LANE_TONES: Tone[] = ['blue', 'teal', 'violet', 'amber', 'sky', 'rose', 'indigo', 'green', 'orange'];
/** Pixels per day: a year of months is about 1200 wide, a quarter of weeks about 400. */
const SCALE: Record<Unit, number> = { week: 32 / 7, month: 100 / 30.44, quarter: 220 / 91.3 };

type When = string | number;

interface ItemEntry {
  lane?: string;
  label?: string;
  kind?: 'task' | 'milestone';
  from?: When;
  to?: When;
  in?: When;
  at?: When;
  duration?: string;
  after?: string | string[];
  status?: RoadmapStatus;
  progress?: number | string;
  tone?: Tone;
}

export interface RoadmapSource {
  type: 'roadmap';
  title?: string;
  subtitle?: string;
  from?: When;
  to?: When;
  unit?: Unit;
  periods?: string[];
  today?: When | boolean;
  lanes?: Record<string, string | { label?: string; caption?: string; tone?: Tone } | null>;
  phases?: Record<string, { label?: string; from?: When; to?: When; in?: When; tone?: Tone } | null>;
  items?: Record<string, ItemEntry | null>;
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]);

/** 40%, 40 or 0.4 → 0.4. */
function percent(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+(\.\d+)?\s*%?\s*$/.test(v) ? Number(v.replace('%', '')) : undefined;
  if (n === undefined) return undefined;
  return Math.max(0, Math.min(1, n > 1 || (typeof v === 'string' && v.includes('%')) ? n / 100 : n));
}

export function buildRoadmap(src: RoadmapSource, ctx: BuildContext): Graph {
  const word = ctx.word ?? english;
  const periods = src.periods?.map(String);
  // The axis speaks days, or period indexes when the roadmap names its periods.
  const when = (v: unknown, path: Path): { start: number; end: number } | undefined => {
    if (v == null) return undefined;
    if (periods) {
      const i = periods.indexOf(String(v));
      if (i >= 0) return { start: i, end: i + 1 };
      ctx.error(path, `"${String(v)}" is not one of the periods: ${periods.join(', ')}`);
      return undefined;
    }
    const d = parseDate(v);
    if (!d) ctx.error(path, `"${String(v)}" is not a date: write 2026-03, 2026-03-15, 2026-Q2 or 2026-W14`);
    return d;
  };

  const lanes: RoadmapShape['lanes'] = [];
  const laneIds = new Set<string>();
  for (const [id, raw] of Object.entries(src.lanes ?? {})) {
    const e = typeof raw === 'string' ? { label: raw } : (raw ?? {});
    lanes.push({ id, label: e.label ?? id, ...(e.caption ? { caption: e.caption } : {}), tone: e.tone ?? LANE_TONES[lanes.length % LANE_TONES.length]!, path: ['lanes', id] });
    laneIds.add(id);
  }

  // Items: own dates first, then the end of what they wait for, in order until nothing moves.
  const entries = Object.entries(src.items ?? {}).map(([id, raw]) => [id, raw ?? {}] as const);
  const items = new Map<string, RoadmapItem & { e: ItemEntry; resolved: boolean }>();
  for (const [id, e] of entries) {
    const path = ['items', id];
    if (e.lane != null && !laneIds.has(e.lane)) {
      // Lanes named only by items are drawn in the order they are first named.
      lanes.push({ id: e.lane, label: e.lane, tone: LANE_TONES[lanes.length % LANE_TONES.length]!, path });
      laneIds.add(e.lane);
    }
    const milestone = e.kind === 'milestone' || (e.at != null && e.from == null && e.to == null);
    items.set(id, {
      id,
      ...(e.lane != null ? { lane: e.lane } : {}),
      label: e.label ?? id,
      start: 0,
      end: 0,
      milestone,
      ...(e.status ? { status: e.status } : {}),
      ...(percent(e.progress) !== undefined ? { progress: percent(e.progress) } : {}),
      ...(e.tone ? { tone: e.tone } : {}),
      after: list(e.after),
      path,
      e,
      resolved: false,
    });
  }
  for (const it of items.values())
    for (const [k, dep] of it.after.entries())
      if (!items.has(dep)) {
        ctx.error([...it.path, 'after', ...(Array.isArray(it.e.after) ? [k] : [])], `There is no item "${dep}"`);
        it.after = it.after.filter((d) => d !== dep);
      }

  const unitOf = (): Unit => src.unit ?? 'month';
  const axisFrom = when(src.from, ['from']);
  const axisTo = when(src.to, ['to']);
  const resolve = (it: RoadmapItem & { e: ItemEntry; resolved: boolean }, seen: Set<string>): void => {
    if (it.resolved) return;
    if (seen.has(it.id)) {
      ctx.error([...it.path, 'after'], `"${it.id}" waits for itself through after:`);
      it.after = [];
    }
    seen.add(it.id);
    const e = it.e;
    const path = it.path;
    const at = when(e.at ?? e.in, [...path, e.at != null ? 'at' : 'in']);
    const from = when(e.from, [...path, 'from']) ?? at;
    const to = when(e.to, [...path, 'to']);
    let start = from?.start;
    if (start === undefined && it.after.length) {
      for (const d of it.after) resolve(items.get(d)!, seen);
      start = Math.max(...it.after.map((d) => items.get(d)!.end));
    }
    if (start === undefined) {
      // A new item from the builder has no dates yet: put it at the start, so it shows.
      start = axisFrom?.start ?? 0;
      if (!e.at && !e.from) ctx.warn(path, 'Give it from: (or at:, in:, after:) to place it on the axis');
    }
    let end = it.milestone ? start : (to?.end ?? (e.duration != null ? (periods ? start + Number(String(e.duration).replace(/\D+$/, '')) : addDuration(start, e.duration)) : undefined) ?? from?.end ?? at?.end);
    if (e.duration != null && end === undefined) ctx.error([...path, 'duration'], 'A duration is a number and a unit: 10d, 6w, 3m, 1q');
    end ??= periods ? start + 1 : nextUnit(floorUnit(start, unitOf()), unitOf());
    if (end < start || (end === start && !it.milestone)) {
      ctx.error([...path, 'to'], 'It ends before it starts');
      end = start;
    }
    Object.assign(it, { start, end, resolved: true });
  };
  for (const it of items.values()) resolve(it, new Set());

  // The axis: as written, or around everything there is; snapped to whole units.
  const all = [...items.values()];
  const phases: RoadmapShape['phases'] = [];
  for (const [key, raw] of Object.entries(src.phases ?? {})) {
    const p = raw ?? {};
    const path = ['phases', key];
    const range = when(p.in, [...path, 'in']);
    const from = when(p.from, [...path, 'from']) ?? range;
    const to = when(p.to, [...path, 'to']) ?? range;
    if (!from || !to) {
      if (!range && (p.from == null || p.to == null)) ctx.error(path, 'A phase needs from: and to: (or in:)');
      continue;
    }
    phases.push({ label: p.label ?? key, start: from.start, end: to.end, tone: p.tone ?? 'slate', path });
  }
  const unit = src.unit ?? (periods ? 'month' : guessUnit(all, axisFrom, axisTo));
  const lo = Math.min(...[axisFrom?.start, ...all.map((i) => i.start), ...phases.map((p) => p.start)].filter((x): x is number => x !== undefined));
  const hi = Math.max(...[axisTo?.end, ...all.map((i) => Math.max(i.end, i.start + 1)), ...phases.map((p) => p.end)].filter((x): x is number => x !== undefined));
  let start: number;
  let end: number;
  let axis: RoadmapShape['ticks'];
  if (periods) {
    start = 0;
    end = Math.max(periods.length, Number.isFinite(hi) ? hi : 0);
    axis = periods.map((label, i) => ({ start: i, end: i + 1, label }));
  } else {
    const today0 = day(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
    start = floorUnit(axisFrom?.start ?? (Number.isFinite(lo) ? lo : today0), unit);
    end = axisTo?.end ?? (Number.isFinite(hi) ? hi : nextUnit(start, unit));
    // Round up to a whole unit, and show at least one.
    let e = start;
    while (e < end) e = nextUnit(e, unit);
    end = Math.max(e, nextUnit(start, unit));
    axis = ticks(start, end, unit, ctx.word);
  }
  for (const it of all)
    if (it.end <= start || it.start >= end || (it.milestone && (it.start < start || it.start > end))) ctx.warn(it.path, 'It falls outside from: … to:, so it is cut off');

  let today: RoadmapShape['today'];
  if (src.today != null && src.today !== false) {
    const t = src.today === true ? Math.floor(Date.now() / 86_400_000) : when(src.today, ['today'])?.start;
    if (t !== undefined && !periods) today = { at: t, label: src.today === true ? word('Today') : `${word('Today')} · ${formatDay(t, ctx.word)}` };
    if (t !== undefined && periods) today = { at: t + 0.5, label: 'Now' };
  }

  if (!lanes.length && all.some((i) => !i.milestone)) lanes.push({ id: '', label: '', tone: 'blue', path: ['items'] });
  for (const it of all) if (!it.milestone && it.lane == null) it.lane = lanes[0]!.id;

  return {
    title: src.title,
    subtitle: src.subtitle,
    direction: 'right',
    groups: [],
    nodes: [
      {
        id: 'roadmap',
        shape: {
          kind: 'roadmap',
          start,
          end,
          ticks: axis,
          scale: periods ? 0 : SCALE[unit],
          lanes,
          items: all.map(({ e: _, resolved: __, ...i }) => i),
          phases,
          ...(today ? { today } : {}),
        },
        path: [],
      },
    ],
    edges: [],
  };
}

/** Weeks for a few months, quarters past two years, months in between. */
function guessUnit(items: RoadmapItem[], from?: { start: number }, to?: { end: number }): Unit {
  const lo = Math.min(from?.start ?? Infinity, ...items.map((i) => i.start));
  const hi = Math.max(to?.end ?? -Infinity, ...items.map((i) => i.end));
  const span = hi - lo;
  if (!Number.isFinite(span)) return 'month';
  return span <= 100 ? 'week' : span > 730 ? 'quarter' : 'month';
}

/** Lanes named by items and items named by after:, so renames and deletes follow them. */
export function roadmapReferences(src: RoadmapSource): Reference[] {
  const out: Reference[] = [];
  const lanes = new Set(Object.keys(src.lanes ?? {}));
  const items = new Set(Object.keys(src.items ?? {}));
  for (const [id, raw] of Object.entries(src.items ?? {})) {
    if (!raw) continue;
    if (typeof raw.lane === 'string' && lanes.has(raw.lane)) out.push({ path: ['items', id, 'lane'], id: raw.lane, start: 0, collection: 'lanes', onDelete: 'key' });
    if (typeof raw.after === 'string' && items.has(raw.after)) out.push({ path: ['items', id, 'after'], id: raw.after, start: 0, collection: 'items', onDelete: 'key' });
    else if (Array.isArray(raw.after)) for (const [k, d] of raw.after.entries()) if (items.has(d)) out.push({ path: ['items', id, 'after', k], id: d, start: 0, collection: 'items' });
  }
  return out;
}

// ---------------------------------------------------------------- schema

const tone = { enum: tones };
const date = { type: ['string', 'integer'], description: '2026, 2026-03, 2026-Q2, 2026-W14, 2026-03-15 (or a period name)' };

const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Cartography roadmap',
  type: 'object',
  required: ['type'],
  properties: {
    type: { const: 'roadmap' },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    from: { ...date, description: 'Start of the axis (default: the first item)' },
    to: { ...date, description: 'End of the axis, inclusive (default: the last item)' },
    unit: { enum: ['week', 'month', 'quarter'], description: 'Ticks of the axis' },
    periods: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Named periods instead of dates: Now, Next, Later' },
    today: { anyOf: [date, { type: 'boolean' }], description: 'A "today" line: a date, or true for the real date' },
    lanes: {
      type: 'object',
      description: 'Workstreams or teams, top to bottom',
      additionalProperties: { anyOf: [{ type: 'string' }, { type: 'null' }, { type: 'object', properties: { label: { type: 'string' }, caption: { type: 'string' }, tone }, additionalProperties: false }] },
    },
    phases: {
      type: 'object',
      description: 'Phases or waves: bands behind the lanes',
      additionalProperties: {
        anyOf: [{ type: 'null' }, { type: 'object', properties: { label: { type: 'string' }, from: date, to: date, in: date, tone }, additionalProperties: false }],
      },
    },
    items: {
      type: 'object',
      description: 'Bars and milestones',
      additionalProperties: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            properties: {
              kind: { enum: ['task', 'milestone'], description: 'A bar (default) or a milestone diamond' },
              lane: { type: 'string', description: 'The lane it is in; a milestone without one sits on the axis' },
              label: { type: 'string' },
              from: date,
              to: { ...date, description: 'Last day, month or quarter, inclusive' },
              in: { ...date, description: 'The whole of one month, quarter, week or period' },
              at: { ...date, description: 'A milestone on this date' },
              duration: { type: ['string', 'number'], description: '10d, 6w, 3m, 1q (periods: a number)' },
              after: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'Waits for these items: starts when they end, drawn as arrows' },
              status: { enum: statuses },
              progress: { type: ['number', 'string'], description: 'How much is done: 40% or 0.4' },
              tone,
            },
            additionalProperties: false,
          },
        ],
      },
    },
  },
  additionalProperties: false,
};

const palette: PaletteItem[] = [
  { collection: 'items', kind: 'task', label: 'Item', icon: 'calendar', tone: 'blue', keywords: ['bar', 'task', 'epic', 'project'] },
  { collection: 'items', kind: 'milestone', label: 'Milestone', icon: 'flag', tone: 'rose', keywords: ['deadline', 'go-live', 'release'] },
  { collection: 'lanes', kind: 'lane', label: 'Lane', icon: 'layers', tone: 'slate', keywords: ['workstream', 'team', 'track'] },
];

export const roadmap: DiagramType<RoadmapSource> = {
  id: 'roadmap',
  name: 'Roadmap & timeline',
  description: 'Workstreams along a time axis: items with start and end, milestones, phases and dependencies',
  icon: 'calendar-clock',
  tagline: 'What happens when: workstreams, milestones and waves on a time axis',
  useWhen: ['A 12-month migration in waves', 'A delivery plan per team with milestones', 'Now / next / later for a steering deck', 'A project timeline from a Mermaid gantt'],
  notFor: [
    { text: 'The order of messages in one flow', use: 'sequence' },
    { text: 'How branches merge and release', use: 'gitflow' },
    { text: 'The steps one person takes, and how they feel', use: 'journey' },
    { text: 'How the work itself goes, step by step', use: 'process' },
  ],
  keywords: ['roadmap', 'timeline', 'gantt', 'plan', 'planning', 'schedule', 'milestone', 'migration waves', 'waves', 'phases', 'quarter', 'delivery plan', 'workstream', 'now next later', 'deadline', 'project plan'],
  schema,
  palette,
  template: `type: roadmap
title: Platform roadmap 2026
from: 2026-01
to: 2026-12
unit: month
today: 2026-04-15

lanes:
  platform: Platform
  apps: Applications
  data: Data

phases:
  Wave 1: { from: 2026-01, to: 2026-04, tone: sky }
  Wave 2: { from: 2026-05, to: 2026-09, tone: violet }

items:
  landing-zone: { lane: platform, label: Landing zone, from: 2026-01, to: 2026-02, status: done }
  aks: { lane: platform, label: AKS baseline, after: landing-zone, duration: 10w, status: active }
  lakehouse: { lane: data, label: Lakehouse, from: 2026-03, to: 2026-07, status: planned }
  shop: { lane: apps, label: Move web shop, after: aks, duration: 3m, status: at-risk }
  go-live: { at: 2026-10-01, label: Go-live }
`,
  build: buildRoadmap,
  references: roadmapReferences,
  connect(src, from, to) {
    const known = (id: string) => !!src.items && Object.hasOwn(src.items, id);
    if (!known(from) || !known(to)) return 'Connect one item to another: the second waits for the first';
    return { path: ['items', to, 'after'], value: from };
  },
  async layout(sized) {
    const s = sized.nodes.get('roadmap') ?? { width: 0, height: 0 };
    return { nodes: new Map([['roadmap', { x: 0, y: 0, width: s.width, height: s.height }]]), groups: new Map(), edges: new Map(), width: s.width, height: s.height };
  },
};
