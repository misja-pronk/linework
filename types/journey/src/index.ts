// Journeys: what one person goes through, step by step, and how it feels. A developer's first week,
// a customer asking for access, a data consumer finding a data product.
//
//   persona: Dana, new backend developer          or { name, role, avatar, goal, quote }
//   phases:                                        columns; optional
//     day1: First day
//   steps:                                         the key is the step; a number is how it feels
//     Collect laptop and accounts: 4
//     Find the repositories: 2 lost                a score and the feeling in a word
//     deploy:
//       label: First deploy
//       in: day1                                   steps without in: follow the step above
//       feel: 2 anxious
//       thought: Did I just break production?      a thought bubble (says: a speech bubble)
//       touchpoint: [Portal, CI pipeline]          what they use; a model element id links to it
//       with: Platform team                        who else is involved
//       pains: No preview environment
//       gains: Pipeline is fast
//       ideas: Preview environment per pull request
//       metrics: { Lead time: 3 days }
//       frontstage: …  backstage: …  support: …    the rows of a service blueprint
//   view: map                                      map | storyboard | blueprint | compare
//   future: { label: With self-service, steps: … } a second journey through the same phases
import { term } from '@linework/i18n/drawing';
import {
  english,
  journeyAvatars,
  journeyRows,
  journeyViews,
  linksSchema,
  parseLink,
  parseLinks,
  tones,
  type BuildContext,
  type DiagramType,
  type Graph,
  type GraphNode,
  type JourneyMetric,
  type JourneyPhase,
  type JourneyRow,
  type JourneyShape,
  type JourneyStep,
  type JourneyTouchpoint,
  type JourneyView,
  type Link,
  type PaletteItem,
  type Word,
  type Path,
  type Reference,
  type Tone,
} from '@linework/core';

const PHASE_TONES: Tone[] = ['blue', 'indigo', 'violet', 'sky', 'teal'];
const DEFAULT_ROWS: JourneyRow[] = ['steps', 'touchpoints', 'feeling', 'thoughts', 'pains', 'gains', 'ideas', 'metrics'];

type Many = string | string[];

interface TouchEntry {
  label?: string;
  icon?: string;
  /** A model element this stands for: its label, icon and links. */
  ref?: string;
  /** Where a click leads: a URL, another diagram, a view. */
  link?: unknown;
}

export interface StepEntry {
  label?: string;
  in?: string;
  feel?: number | string;
  thought?: string;
  says?: string;
  touchpoint?: string | TouchEntry | (string | TouchEntry)[];
  with?: Many;
  pains?: Many;
  gains?: Many;
  ideas?: Many;
  metrics?: Many | Record<string, string | number>;
  frontstage?: Many;
  backstage?: Many;
  support?: Many;
  links?: unknown[];
  description?: string;
}

type Steps = Record<string, number | string | StepEntry | null>;
type Metrics = Record<string, string | number> | string[];

export interface JourneySource {
  type: 'journey';
  title?: string;
  subtitle?: string;
  view?: JourneyView;
  scale?: string | [number, number];
  persona?: string | { name?: string; role?: string; avatar?: string; goal?: string; quote?: string; tone?: Tone };
  phases?: Record<string, string | { label?: string; caption?: string; tone?: Tone } | null>;
  steps?: Steps;
  rows?: (JourneyRow | Partial<Record<JourneyRow, string>>)[];
  hide?: JourneyRow[];
  metrics?: Metrics;
  current?: string;
  future?: { label?: string; steps?: Steps; metrics?: Metrics };
}

const many = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null || v === '' ? [] : [String(v)]).map((s) => s.trim()).filter(Boolean);

/** "2 lost" → a score and a word; 4 → a score; "lost" → a word. */
export function parseFeel(v: unknown): { score?: number; feeling?: string } {
  if (typeof v === 'number') return Number.isFinite(v) ? { score: v } : {};
  if (typeof v !== 'string') return {};
  const m = /^\s*([+-]?\d+(?:\.\d+)?)(?=$|[\s,:;])[\s,:;-]*(.*)$/.exec(v);
  if (!m) return v.trim() ? { feeling: v.trim() } : {};
  return { score: Number(m[1]), ...(m[2]!.trim() ? { feeling: m[2]!.trim() } : {}) };
}

/** A step written short: a number (how it feels, with an optional word) or a label. */
export function stepShorthand(v: unknown): StepEntry {
  if (v == null) return {};
  if (typeof v === 'object') return v as StepEntry;
  if (typeof v === 'number' || parseFeel(v).score !== undefined) return { feel: v as number | string };
  return { label: String(v) };
}

/** The feeling scale: as written ("1..5", [-2, 2]), or the usual scale the scores fit in. */
export function journeyScale(written: unknown, scores: number[], ctx?: Pick<BuildContext, 'error'>): { min: number; max: number } {
  if (written != null) {
    const m = typeof written === 'string' ? /^\s*(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)\s*$/.exec(written) : undefined;
    const pair = Array.isArray(written) && written.length === 2 ? written.map(Number) : m ? [Number(m[1]), Number(m[2])] : undefined;
    if (pair && pair.every(Number.isFinite) && pair[0]! < pair[1]!) return { min: pair[0]!, max: pair[1]! };
    ctx?.error(['scale'], 'A scale is its worst and best score: 1..5, -2..2 or [0, 10]');
  }
  if (!scores.length) return { min: 1, max: 5 };
  const lo = Math.min(...scores);
  const hi = Math.max(...scores);
  if (lo < 0) {
    const most = Math.max(-lo, hi);
    const bound = most <= 2 ? 2 : most <= 3 ? 3 : most <= 5 ? 5 : most <= 10 ? 10 : Math.ceil(most);
    return { min: -bound, max: bound };
  }
  if (hi <= 5) return { min: lo < 1 ? 0 : 1, max: 5 };
  if (hi <= 10) return { min: lo < 1 ? 0 : 1, max: 10 };
  return { min: 0, max: hi <= 100 ? 100 : Math.ceil(hi) };
}

const ICON_WORDS: [RegExp, string][] = [
  [/\b(e-?mail|mail|inbox|newsletter|outlook)\b/, 'mail'],
  [/\b(slack|teams|chat|message|dm|channel|discord)\b/, 'message-square'],
  [/\b(phone|call|hotline)\b/, 'phone'],
  [/\b(pull request|merge request|pr|code review|review)\b/, 'git-pull-request'],
  [/\b(git|github|gitlab|repo|repos|repository|repositories|branch|bitbucket)\b/, 'git-branch'],
  [/\b(pipeline|ci|cd|ci\/cd|workflow|actions|build|deploy|deployment|argo|jenkins)\b/, 'workflow'],
  [/\b(cli|terminal|shell|command line|kubectl|ssh)\b/, 'terminal'],
  [/\b(ide|editor|vs code|vscode|code|sdk|notebook)\b/, 'code'],
  [/\b(docs?|documentation|wiki|confluence|handbook|guide|readme|runbook|tutorial|knowledge base|golden path)\b/, 'book-open'],
  [/\b(catalog|catalogue|marketplace|store|shop)\b/, 'store'],
  [/\b(search|find|discover|discovery)\b/, 'search'],
  [/\b(portal|backstage|console|dashboard|web ?site|web ?app|web|app|ui|intranet|self-service)\b/, 'app-window'],
  [/\b(ticket|tickets|form|request|jira|servicenow|service desk|helpdesk|help desk|topdesk)\b/, 'file-text'],
  [/\b(approval|approve|sign-?off|contract|agreement|policy|terms)\b/, 'file-check'],
  [/\b(access|permission|permissions|role|iam|entra|sso|login|log in|sign in|password|key|secret|vault|token|mfa)\b/, 'key-round'],
  [/\b(alert|alerts|pager|pagerduty|on-?call|incident|notification|notifications)\b/, 'bell'],
  [/\b(monitoring|metrics|grafana|observability|logs|report|power bi|bi|analytics|chart)\b/, 'chart-line'],
  [/\b(api|webhook|endpoint|rest|graphql)\b/, 'webhook'],
  [/\b(database|sql|table|tables|dataset|data product|lakehouse|warehouse|query|data)\b/, 'database'],
  [/\b(cloud|azure|aws|gcp|cluster|kubernetes|k8s|platform|environment|namespace)\b/, 'cloud'],
  [/\b(laptop|device|workstation|hardware)\b/, 'laptop'],
  [/\b(mobile|phone app|sms|whatsapp)\b/, 'smartphone'],
  [/\b(meeting|stand-?up|calendar|workshop|session|intake|kick-?off|demo|training)\b/, 'calendar'],
  [/\b(team|colleagues|community|guild|squad)\b/, 'users'],
  [/\b(manager|buddy|mentor|lead|owner|steward|colleague|person|desk|office|reception|architect|engineer|officer|support)\b/, 'user-round'],
  [/\b(template|scaffold|starter|blueprint|config|yaml|manifest)\b/, 'file-code'],
];

/** An icon for a touchpoint from the words in its name; a plain dot when nothing fits. */
export function touchpointIcon(label: string): string {
  const l = label.toLowerCase();
  return ICON_WORDS.find(([re]) => re.test(l))?.[1] ?? 'circle-dot';
}

const KIND_ICONS: Record<string, string> = { person: 'user-round', actor: 'user-round', database: 'database', queue: 'workflow', system: 'box', container: 'box', service: 'server', app: 'app-window', api: 'webhook' };

function metricsOf(v: unknown): JourneyMetric[] {
  if (Array.isArray(v))
    return v.map((s) => {
      const text = String(s);
      const i = text.lastIndexOf(': ');
      return i > 0 ? { label: text.slice(0, i).trim(), value: text.slice(i + 2).trim() } : { label: '', value: text };
    });
  if (v && typeof v === 'object') return Object.entries(v).map(([label, value]) => ({ label, value: String(value) }));
  return [];
}

export function buildJourney(src: JourneySource, ctx: BuildContext): Graph {
  // Phases as declared; steps may name more when none are declared.
  const phases: JourneyPhase[] = [];
  const declared = !!src.phases && Object.keys(src.phases).length > 0;
  for (const [id, raw] of Object.entries(src.phases ?? {})) {
    const e = typeof raw === 'string' ? { label: raw } : (raw ?? {});
    phases.push({ id, label: e.label ?? id, ...(e.caption ? { caption: e.caption } : {}), tone: e.tone ?? PHASE_TONES[phases.length % PHASE_TONES.length]!, path: ['phases', id] });
  }
  const phaseOf = (name: string, path: Path): string | undefined => {
    const hit = phases.find((p) => p.id === name) ?? phases.find((p) => p.label.toLowerCase() === name.toLowerCase());
    if (hit) return hit.id;
    if (declared) {
      ctx.error(path, `There is no phase "${name}"; phases: ${phases.map((p) => p.id).join(', ')}`);
      return undefined;
    }
    phases.push({ id: name, label: name, tone: PHASE_TONES[phases.length % PHASE_TONES.length]! });
    return name;
  };

  const taken = new Set(['journey', 'persona']);
  const links = new Map<string, Link[]>();
  const descriptions = new Map<string, string>();
  const elements = ctx.model?.elements;

  const touchpoint = (raw: string | TouchEntry, path: Path, id: string): JourneyTouchpoint | undefined => {
    const e: TouchEntry = typeof raw === 'string' ? (elements?.has(raw) ? { ref: raw } : { label: raw }) : (raw ?? {});
    const el = e.ref != null ? elements?.get(e.ref) : undefined;
    if (e.ref != null && !el) ctx.error(typeof raw === 'string' ? path : [...path, 'ref'], `There is no element "${e.ref}" in the model`);
    if (el && ctx.model) ctx.model.used = true;
    const label = e.label ?? el?.label ?? el?.name ?? e.ref;
    if (!label) {
      ctx.error(path, 'A touchpoint needs a label or a ref');
      return undefined;
    }
    const own = e.link != null ? parseLink(e.link) : undefined;
    if (e.link != null && !own) ctx.error([...path, 'link'], 'A link is a URL, another diagram (other.yaml) or a view (other.yaml#view)');
    const to = own ? [own] : el ? parseLinks(el.links) : undefined;
    if (to) links.set(id, to);
    if (el?.description) descriptions.set(id, el.description);
    return { label, icon: e.icon ?? el?.icon ?? (el?.kind && KIND_ICONS[el.kind]) ?? touchpointIcon(label), ...(to ? { linked: true } : {}) };
  };

  const scored: { step: JourneyStep; path: Path }[] = [];
  const read = (map: Steps | undefined, base: Path, prefix: string): JourneyStep[] => {
    const out: JourneyStep[] = [];
    let last: string | undefined;
    for (const [key, raw] of Object.entries(map ?? {})) {
      const path = [...base, key];
      const e = stepShorthand(raw);
      const plain = raw == null || typeof raw !== 'object';
      let id = prefix + key;
      if (taken.has(id) || /^phase:|@\d+$/.test(id)) id = `step:${id}`;
      taken.add(id);
      const phase = (e.in != null ? phaseOf(String(e.in), [...path, 'in']) : undefined) ?? last ?? phases[0]?.id ?? phaseOf('', path)!;
      last = phase;
      const feel = parseFeel(e.feel);
      if (e.feel != null && feel.score === undefined && feel.feeling === undefined) ctx.error(plain ? path : [...path, 'feel'], 'How it feels is a score, optionally with a word: 2 or "2 lost"');
      const touches = (Array.isArray(e.touchpoint) ? e.touchpoint : e.touchpoint == null ? [] : [e.touchpoint])
        .map((t, i) => touchpoint(t, [...path, 'touchpoint', ...(Array.isArray(e.touchpoint) ? [i] : [])], `${id}@${i}`))
        .map((t, i) => ({ t, i }));
      // Touchpoint nodes are numbered as drawn, so a dropped one leaves no gap.
      const kept = touches.filter((x) => x.t);
      for (const [n, x] of kept.entries())
        if (n !== x.i) {
          const l = links.get(`${id}@${x.i}`);
          const d = descriptions.get(`${id}@${x.i}`);
          links.delete(`${id}@${x.i}`);
          descriptions.delete(`${id}@${x.i}`);
          if (l) links.set(`${id}@${n}`, l);
          if (d) descriptions.set(`${id}@${n}`, d);
        }
      const own = parseLinks(e.links);
      if (own) links.set(id, own);
      if (e.description) descriptions.set(id, e.description);
      const step: JourneyStep = {
        id,
        label: e.label ?? key,
        phase,
        ...(feel.score !== undefined ? { score: feel.score } : {}),
        ...(feel.feeling ? { feeling: feel.feeling } : {}),
        ...(e.thought ? { thought: String(e.thought) } : {}),
        ...(e.says ? { says: String(e.says) } : {}),
        touchpoints: kept.map((x) => x.t!),
        actors: many(e.with),
        pains: many(e.pains),
        gains: many(e.gains),
        ideas: many(e.ideas),
        metrics: e.metrics && typeof e.metrics === 'object' && !Array.isArray(e.metrics) ? Object.entries(e.metrics).map(([k, v]) => `${k}: ${v}`) : many(e.metrics),
        frontstage: many(e.frontstage),
        backstage: many(e.backstage),
        support: many(e.support),
        ...(own ? { linked: true } : {}),
        path,
      };
      if (step.score !== undefined) scored.push({ step, path: plain ? path : [...path, 'feel'] });
      out.push(step);
    }
    return out;
  };
  const steps = read(src.steps, ['steps'], '');
  const futureSteps = src.future ? read(src.future.steps, ['future', 'steps'], 'future:') : undefined;
  // Told phase by phase, in the order written within a phase.
  const order = new Map(phases.map((p, i) => [p.id, i]));
  const byPhase = (list: JourneyStep[]) => list.map((s, i) => ({ s, i })).sort((a, b) => order.get(a.s.phase)! - order.get(b.s.phase)! || a.i - b.i).map((x) => x.s);

  const scale = journeyScale(src.scale, scored.map((x) => x.step.score!), ctx);
  for (const { step, path } of scored)
    if (step.score! < scale.min || step.score! > scale.max) {
      ctx.warn(path, `${step.score} is outside the scale ${scale.min}..${scale.max}: drawn at the edge (set scale: to change it)`);
      step.score = Math.max(scale.min, Math.min(scale.max, step.score!));
    }

  const p = src.persona;
  let persona: JourneyShape['persona'];
  if (typeof p === 'string' && p.trim()) {
    const i = p.indexOf(',');
    persona = { name: (i < 0 ? p : p.slice(0, i)).trim(), ...(i >= 0 && p.slice(i + 1).trim() ? { role: p.slice(i + 1).trim() } : {}), tone: 'indigo', path: ['persona'] };
  } else if (p && typeof p === 'object') {
    if (p.avatar && !(journeyAvatars as readonly string[]).includes(p.avatar)) ctx.warn(['persona', 'avatar'], `There is no avatar "${p.avatar}": use one of ${journeyAvatars.join(', ')} (drawn with initials)`);
    persona = {
      name: p.name?.trim() || 'Persona',
      ...(p.role ? { role: p.role } : {}),
      ...(p.avatar && (journeyAvatars as readonly string[]).includes(p.avatar) ? { avatar: p.avatar } : {}),
      ...(p.goal ? { goal: p.goal } : {}),
      ...(p.quote ? { quote: p.quote } : {}),
      tone: p.tone ?? 'indigo',
      path: ['persona'],
    };
  }

  // Rows: the order written (or the usual one), without the hidden ones and the ones nothing fills.
  const all = [...steps, ...(futureSteps ?? [])];
  const rowLabels: Partial<Record<JourneyRow, string>> = {};
  const written: JourneyRow[] = [];
  for (const [i, r] of (src.rows ?? []).entries()) {
    const [name, label] = typeof r === 'string' ? [r, undefined] : (Object.entries(r ?? {})[0] ?? []);
    if (!name || !journeyRows.includes(name as JourneyRow)) {
      ctx.error(['rows', i], `Rows are: ${journeyRows.join(', ')}`);
      continue;
    }
    if (!written.includes(name as JourneyRow)) written.push(name as JourneyRow);
    if (label) rowLabels[name as JourneyRow] = String(label);
  }
  const filled: Record<JourneyRow, boolean> = {
    steps: true,
    touchpoints: steps.some((s) => s.touchpoints.length),
    actors: steps.some((s) => s.actors.length),
    feeling: steps.some((s) => s.score !== undefined),
    thoughts: steps.some((s) => s.thought || s.says),
    pains: steps.some((s) => s.pains.length),
    gains: steps.some((s) => s.gains.length),
    ideas: steps.some((s) => s.ideas.length),
    metrics: steps.some((s) => s.metrics.length),
  };
  const hidden = new Set(src.hide ?? []);
  const rows = (written.length ? written : DEFAULT_ROWS).filter((r) => filled[r] && !hidden.has(r));

  const hasStages = steps.some((s) => s.frontstage.length || s.backstage.length || s.support.length);
  let view: JourneyView = src.view ?? (futureSteps?.length ? 'compare' : 'map');
  if (view === 'compare' && !futureSteps?.length) {
    ctx.warn(src.view ? ['view'] : [], 'Comparing needs a second journey: add future: { label: …, steps: … } (drawn as a map)');
    view = 'map';
  }
  if (view === 'blueprint' && !hasStages) ctx.warn(['view'], 'A blueprint shows what the organisation does: give steps frontstage:, backstage: or support:');

  const used = new Set(all.map((s) => s.phase));
  const shape: JourneyShape = {
    kind: 'journey',
    view,
    ...(persona ? { persona } : {}),
    phases: phases.filter((ph) => ph.path || used.has(ph.id)),
    steps: byPhase(steps),
    scale,
    rows,
    ...(Object.keys(rowLabels).length ? { rowLabels } : {}),
    metrics: metricsOf(src.metrics),
    label: src.current ?? term(ctx.lang, 'Today'),
    ...(futureSteps ? { future: { label: src.future?.label ?? term(ctx.lang, 'Future'), steps: byPhase(futureSteps), metrics: metricsOf(src.future?.metrics) } } : {}),
  };

  // The journey draws itself as one node; its steps, phases and persona are nodes on top of it, so
  // they can be clicked, linked and selected in the builder.
  const part = (id: string, kind: 'step' | 'phase' | 'persona' | 'touchpoint', label: string, path: Path, icon?: string): GraphNode => ({
    id,
    shape: { kind: 'journey-part', part: kind, label, ...(icon ? { icon } : {}) },
    ...(links.has(id) ? { links: links.get(id)! } : {}),
    ...(descriptions.has(id) ? { description: descriptions.get(id)! } : {}),
    path,
  });
  const nodes: GraphNode[] = [{ id: 'journey', shape, path: ['steps'] }];
  if (persona) nodes.push(part('persona', 'persona', persona.name, ['persona'], 'user-round'));
  for (const ph of shape.phases) if (ph.path) nodes.push(part(`phase:${ph.id}`, 'phase', ph.label, ph.path, 'flag'));
  for (const s of view === 'compare' ? [...shape.steps, ...(shape.future?.steps ?? [])] : shape.steps) {
    nodes.push(part(s.id, 'step', s.label, s.path, 'route'));
    for (const [i, t] of s.touchpoints.entries()) if (t.linked) nodes.push(part(`${s.id}@${i}`, 'touchpoint', t.label, s.path, t.icon));
  }
  return { ...(src.title ? { title: src.title } : {}), ...(src.subtitle ? { subtitle: src.subtitle } : {}), direction: 'right', groups: [], nodes, edges: [] };
}

/** The ways this journey can be drawn: a blueprint needs stage rows, a comparison a future journey. */
export function journeyViewsOf(src: JourneySource, word: Word = english): { name: JourneyView; title: string; default?: boolean }[] {
  const steps = Object.values(src.steps ?? {});
  const staged = steps.some((s) => s && typeof s === 'object' && (s.frontstage != null || s.backstage != null || s.support != null));
  const future = !!src.future?.steps && Object.keys(src.future.steps).length > 0;
  return [
    { name: 'map' as const, title: word('Journey map') },
    { name: 'storyboard' as const, title: word('Storyboard') },
    ...(staged ? [{ name: 'blueprint' as const, title: word('Service blueprint') }] : []),
    ...(future ? [{ name: 'compare' as const, title: word('Today and future'), default: true }] : []),
  ];
}

/** Phases named by steps, so renames and deletes follow them. */
export function journeyReferences(src: JourneySource): Reference[] {
  const out: Reference[] = [];
  const phases = new Set(Object.keys(src.phases ?? {}));
  const scan = (map: Steps | undefined, base: Path) => {
    for (const [id, raw] of Object.entries(map ?? {}))
      if (raw && typeof raw === 'object' && typeof raw.in === 'string' && phases.has(raw.in)) out.push({ path: [...base, id, 'in'], id: raw.in, start: 0, collection: 'phases', onDelete: 'key' });
  };
  scan(src.steps, ['steps']);
  scan(src.future?.steps, ['future', 'steps']);
  return out;
}

// ---------------------------------------------------------------- schema

const tone = { enum: tones };
const text = { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] };
const touch = {
  anyOf: [
    { type: 'string', description: 'What they use: a name, or the id of a model element' },
    {
      type: 'object',
      properties: {
        label: { type: 'string' },
        icon: { type: 'string', description: 'Lucide icon name' },
        ref: { type: 'string', description: 'A model element: its label, icon and links' },
        link: { ...linksSchema.items, description: 'Where a click leads: a URL, other.yaml or other.yaml#view' },
      },
      additionalProperties: false,
    },
  ],
};
const step = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'What they do (default: the key)' },
    in: { type: 'string', description: 'The phase; without it the step follows the one above' },
    feel: { type: ['number', 'string'], description: 'How it feels: a score on the scale, optionally with a word: 2 or "2 lost"' },
    thought: { type: 'string', description: 'What they think (a thought bubble)' },
    says: { type: 'string', description: 'What they say out loud (a speech bubble)' },
    touchpoint: { anyOf: [{ type: 'array', items: touch }, ...touch.anyOf], description: 'What they use or meet: a tool, a channel, a place' },
    with: { ...text, description: 'Who else is involved' },
    pains: { ...text, description: 'What hurts' },
    gains: { ...text, description: 'What goes well' },
    ideas: { ...text, description: 'Opportunities: what could make this step better' },
    metrics: { anyOf: [...text.anyOf, { type: 'object', additionalProperties: { type: ['string', 'number'] } }], description: 'Numbers of this step: { Waiting time: 2 days }' },
    frontstage: { ...text, description: 'Blueprint: what the organisation does in sight of the person' },
    backstage: { ...text, description: 'Blueprint: what happens out of sight' },
    support: { ...text, description: 'Blueprint: systems and processes that support it' },
    links: linksSchema,
    description: { type: 'string', description: 'Longer text, shown as a tooltip' },
  },
  additionalProperties: false,
};
const steps = {
  type: 'object',
  description: 'The steps in order; the key is the step, a number is how it feels',
  additionalProperties: { anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'null' }, step] },
};
const metrics = { anyOf: [{ type: 'object', additionalProperties: { type: ['string', 'number'] } }, { type: 'array', items: { type: 'string' } }] };
const rowName = { enum: journeyRows };

const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Linework journey',
  type: 'object',
  required: ['type'],
  properties: {
    type: { const: 'journey' },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    view: { enum: journeyViews, description: 'map (rows under the steps), storyboard (a card per step), blueprint (service blueprint) or compare (today and future)' },
    scale: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }], description: 'Worst and best score: 1..5 (default), -2..2, [0, 10]' },
    persona: {
      anyOf: [
        { type: 'string', description: 'Name, role' },
        {
          type: 'object',
          properties: {
            name: { type: 'string' },
            role: { type: 'string' },
            avatar: { enum: [...journeyAvatars], description: 'A built-in avatar; without one the initials are drawn' },
            goal: { type: 'string', description: 'What they want to get done' },
            quote: { type: 'string', description: 'One line in their words' },
            tone,
          },
          additionalProperties: false,
        },
      ],
      description: 'Who the journey is about',
    },
    phases: {
      type: 'object',
      description: 'Phases of the journey, left to right',
      additionalProperties: { anyOf: [{ type: 'string' }, { type: 'null' }, { type: 'object', properties: { label: { type: 'string' }, caption: { type: 'string' }, tone }, additionalProperties: false }] },
    },
    steps,
    rows: {
      type: 'array',
      items: { anyOf: [rowName, { type: 'object', propertyNames: rowName, additionalProperties: { type: 'string' }, minProperties: 1, maxProperties: 1 }] },
      description: 'Rows of the map in order; { ideas: Next steps } renames one. Default: steps, touchpoints, feeling, thoughts, pains, gains, ideas, metrics',
    },
    hide: { type: 'array', items: rowName, description: 'Rows to leave out' },
    metrics: { ...metrics, description: 'Numbers of the whole journey: { Time to first deploy: 3 days }' },
    current: { type: 'string', description: 'What this journey is called next to the future one (default: Today)' },
    future: {
      type: 'object',
      description: 'A second journey through the same phases: how it should be',
      properties: { label: { type: 'string' }, steps, metrics },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

const palette: PaletteItem[] = [
  { collection: 'steps', kind: 'step', label: 'Step', icon: 'route', tone: 'blue', keywords: ['action', 'task', 'moment', 'touchpoint'] },
  { collection: 'phases', kind: 'phase', label: 'Phase', icon: 'flag', tone: 'indigo', keywords: ['stage', 'column', 'chapter'] },
];

export const journey: DiagramType<JourneySource> = {
  id: 'journey',
  name: 'Journey map',
  description: 'What one person goes through, step by step: touchpoints, feelings, pains and opportunities; as a map, storyboard, service blueprint or today next to future',
  icon: 'route',
  tagline: 'What one person goes through, step by step, and how it feels',
  useWhen: ['A developer’s first week, from laptop to first deploy', 'Asking for access today next to the self-service way', 'A service blueprint: frontstage, backstage, support', 'A storyboard that tells a slide deck step by step'],
  notFor: [
    { text: 'Messages between systems in one flow', use: 'sequence' },
    { text: 'A plan with dates and milestones', use: 'roadmap' },
    { text: 'A process with decisions and branches', use: 'process' },
  ],
  keywords: [
    'journey',
    'user journey',
    'customer journey',
    'developer journey',
    'journey map',
    'experience',
    'developer experience',
    'onboarding',
    'persona',
    'touchpoint',
    'pain points',
    'emotion',
    'feeling',
    'service blueprint',
    'storyboard',
    'storytelling',
    'as-is to-be',
    'current vs future',
    'adoption',
  ],
  schema,
  palette,
  template: `type: journey
title: A developer's first week
persona:
  name: Dana
  role: New backend developer
  avatar: bob
  goal: Ship a first change to production
  quote: I want to feel useful this week.

phases:
  start: First day
  commit: First commit
  deploy: First deploy

steps:
  Collect laptop and accounts: { in: start, feel: 4, touchpoint: IT desk, with: Buddy }
  Find the right repository:
    feel: 2 lost
    thought: Which of these 40 repositories is ours?
    touchpoint: [GitHub, Wiki]
    pains: No map of the landscape
    ideas: One page with the team's systems
  Run the service locally: { in: commit, feel: 3, touchpoint: Terminal }
  Open a pull request:
    feel: 4 welcome
    says: That was a quick review!
    touchpoint: GitHub
    with: Reviewer
    gains: Review within the hour
  Deploy to production:
    in: deploy
    feel: 5 proud
    touchpoint: [Pipeline, Portal]
    gains: One button, no ticket
    metrics: { Time to first deploy: 4 days }

metrics:
  Time to first deploy: 4 days
`,
  build: buildJourney,
  references: journeyReferences,
  views: journeyViewsOf,
  shorthand(collection, value) {
    if (collection === 'steps') return stepShorthand(value) as Record<string, unknown>;
    return undefined;
  },
  refKeys: { in: ['phases'] },
  ordered: { steps: 'in', phases: true },
  unconnected: true,
  connect() {
    return 'A journey has no lines to draw: steps follow each other in the order written';
  },
  async layout(sized) {
    const s = sized.nodes.get('journey') ?? { width: 0, height: 0 };
    const nodes = new Map([['journey', { x: 0, y: 0, width: s.width, height: s.height }]]);
    // Steps, phases and the persona stand where the journey drew them.
    for (const n of sized.graph.nodes) {
      const box = n.id === 'journey' ? undefined : s.parts?.[n.id];
      if (box) nodes.set(n.id, { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) });
    }
    return { nodes, groups: new Map(), edges: new Map(), width: s.width, height: s.height };
  },
};
