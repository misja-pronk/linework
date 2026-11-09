// The journey shape: what one person goes through, step by step, as one node. Phases are columns,
// steps stand in them left to right; rows under the steps say what they touch, how it feels (the
// emotion curve), what they think, and what hurts, helps and could be better. The journey type
// reads the YAML into this; render draws it as a map, a storyboard, a service blueprint or a
// comparison of today and a future journey.
import type { Path, Tone } from './model.ts';

export type JourneyView = 'map' | 'storyboard' | 'blueprint' | 'compare';
export const journeyViews: JourneyView[] = ['map', 'storyboard', 'blueprint', 'compare'];

/** Rows of the map under the phases, in the order drawn. */
export type JourneyRow = 'steps' | 'touchpoints' | 'actors' | 'feeling' | 'thoughts' | 'pains' | 'gains' | 'ideas' | 'metrics';
export const journeyRows: JourneyRow[] = ['steps', 'touchpoints', 'actors', 'feeling', 'thoughts', 'pains', 'gains', 'ideas', 'metrics'];

/** The built-in persona avatars: plain line busts, told apart by hair and headwear only. */
export const journeyAvatars = ['short', 'long', 'bun', 'curly', 'bob', 'beard', 'headscarf', 'cap', 'glasses'] as const;

export interface JourneyPersona {
  name: string;
  role?: string;
  /** One of the built-in avatars; absent draws the initials. */
  avatar?: string;
  goal?: string;
  quote?: string;
  tone: Tone;
  path: Path;
}

export interface JourneyPhase {
  id: string;
  label: string;
  caption?: string;
  tone: Tone;
  /** Where it is written; absent for a phase only steps name. */
  path?: Path;
}

export interface JourneyTouchpoint {
  label: string;
  icon: string;
  /** It leads somewhere (a model element's diagram, a URL): drawn with a link mark. */
  linked?: boolean;
}

export interface JourneyStep {
  id: string;
  label: string;
  /** Id of its phase. */
  phase: string;
  /** How it feels, on the journey's scale. */
  score?: number;
  /** The feeling in a word: "lost", "relieved". */
  feeling?: string;
  /** What they think (a thought bubble). */
  thought?: string;
  /** What they say out loud (a speech bubble). */
  says?: string;
  touchpoints: JourneyTouchpoint[];
  /** Who else is involved. */
  actors: string[];
  pains: string[];
  gains: string[];
  ideas: string[];
  metrics: string[];
  /** Service blueprint: what the organisation does in sight, out of sight, and what supports it. */
  frontstage: string[];
  backstage: string[];
  support: string[];
  linked?: boolean;
  path: Path;
}

export interface JourneyMetric {
  label: string;
  value: string;
}

export interface JourneyShape {
  kind: 'journey';
  view: JourneyView;
  persona?: JourneyPersona;
  phases: JourneyPhase[];
  /** In the order told: by phase, then as written. */
  steps: JourneyStep[];
  /** The ends of the feeling scale; neutral is halfway. */
  scale: { min: number; max: number };
  rows: JourneyRow[];
  /** Rows the author named differently: { ideas: 'Next steps' }. */
  rowLabels?: Partial<Record<JourneyRow, string>>;
  /** Numbers about the whole journey: "Time to first deploy: 3 days". */
  metrics: JourneyMetric[];
  /** What this journey is called next to a future one: "Today". */
  label: string;
  /** A second journey through the same phases: how it should be. */
  future?: { label: string; steps: JourneyStep[]; metrics: JourneyMetric[] };
}

/** A part of a journey that can be pointed at: a step, a phase, the persona, a touchpoint. Drawn by the journey itself; this is where a click lands. */
export interface JourneyPartShape {
  kind: 'journey-part';
  part: 'step' | 'phase' | 'persona' | 'touchpoint';
  label: string;
  icon?: string;
}

/** The feeling scale's halfway point: neither good nor bad. */
export const journeyNeutral = (s: { min: number; max: number }) => (s.min + s.max) / 2;

/** A score as -1 (worst) to 1 (best), 0 neutral. */
export function journeyMood(score: number, s: { min: number; max: number }): number {
  const half = (s.max - s.min) / 2;
  return half > 0 ? Math.max(-1, Math.min(1, (score - journeyNeutral(s)) / half)) : 0;
}

/** The steps a journey is told in when presenting: each step of the map, or each phase of a comparison. */
export function journeyBeats(shape: JourneyShape): { title: string; caption?: string }[] {
  if (shape.view === 'compare' && shape.future) {
    const future = shape.future;
    return shape.phases.map((p) => {
      const now = shape.steps.filter((s) => s.phase === p.id).map((s) => s.label);
      const then = future.steps.filter((s) => s.phase === p.id).map((s) => s.label);
      const caption = [now.length ? `${shape.label}: ${now.join(', ')}` : '', then.length ? `${future.label}: ${then.join(', ')}` : ''].filter(Boolean).join('. ');
      return { title: p.label, ...(caption ? { caption } : {}) };
    });
  }
  const phase = new Map(shape.phases.map((p) => [p.id, p.label]));
  const named = shape.phases.length > 1 || shape.phases.some((p) => p.label);
  return shape.steps.map((s) => {
    const said = s.thought ?? s.says;
    const caption = [said ? `“${said}”` : '', s.pains[0] ?? '', !said && !s.pains.length ? (s.gains[0] ?? '') : ''].filter(Boolean).join(' ');
    return { title: named && phase.get(s.phase) ? `${phase.get(s.phase)}: ${s.label}` : s.label, ...(caption ? { caption } : {}) };
  });
}
