// Heatmaps on a capability map: one property of the capabilities (maturity, investment, fit, a
// cost) on a scale, with a legend. Numbers go on a sequential or a diverging scale, words on a
// categorical one; every capability with a value says it in a tag as well, so the colour only helps.
import type { BlockHeat, LegendItem, Tone } from '@cartography/core';

export interface HeatEntry {
  /** The property the map is coloured by. */
  by: string;
  title?: string;
  scale?: 'sequential' | 'diverging' | 'categorical';
  min?: number;
  max?: number;
  /** Words for numbers: { 1: Initial, 5: Optimised }. */
  labels?: Record<string, string>;
  /** Tones (and words, patterns) for categories: { invest: green, divest: { tone: rose, pattern: hatch } }. */
  values?: Record<string, Tone | { tone?: Tone; label?: string; pattern?: 'hatch' | 'dots' }>;
  /** The hue of a sequential scale. */
  tone?: Tone;
  /** Higher is worse: a diverging scale turns round. */
  reverse?: boolean;
}

/** What the common properties mean, so `heat: maturity` is all a map needs. */
const PRESETS: Record<string, Omit<HeatEntry, 'by'>> = {
  maturity: { scale: 'diverging', min: 1, max: 5, labels: { 1: 'Initial', 2: 'Developing', 3: 'Defined', 4: 'Managed', 5: 'Optimised' } },
  fit: { scale: 'diverging', min: 1, max: 5, labels: { 1: 'Poor', 2: 'Weak', 3: 'Adequate', 4: 'Good', 5: 'Excellent' } },
  importance: { scale: 'sequential', min: 1, max: 5, tone: 'indigo' },
  value: { scale: 'sequential', min: 1, max: 5, tone: 'indigo' },
  risk: { scale: 'sequential', tone: 'rose' },
  cost: { scale: 'sequential', tone: 'orange' },
  spend: { scale: 'sequential', tone: 'orange' },
  systems: { scale: 'sequential', tone: 'violet', title: 'Systems' },
};

/** Words that usually come with a heatmap, and how they read. Gartner's TIME and the usual investment calls. */
const CATEGORY: Record<string, { tone: Tone; pattern?: 'hatch' | 'dots' }> = {
  invest: { tone: 'green' },
  grow: { tone: 'green' },
  innovate: { tone: 'green' },
  maintain: { tone: 'sky' },
  sustain: { tone: 'sky' },
  keep: { tone: 'sky' },
  tolerate: { tone: 'amber' },
  migrate: { tone: 'violet' },
  replace: { tone: 'violet' },
  divest: { tone: 'rose', pattern: 'hatch' },
  eliminate: { tone: 'rose', pattern: 'hatch' },
  retire: { tone: 'rose', pattern: 'hatch' },
  sunset: { tone: 'orange', pattern: 'hatch' },
  good: { tone: 'green' },
  fair: { tone: 'amber' },
  poor: { tone: 'rose', pattern: 'hatch' },
  high: { tone: 'rose' },
  medium: { tone: 'amber' },
  low: { tone: 'green' },
  strategic: { tone: 'indigo' },
  core: { tone: 'blue' },
  supporting: { tone: 'slate' },
  commodity: { tone: 'slate', pattern: 'dots' },
  differentiating: { tone: 'violet' },
};
const CYCLE: Tone[] = ['blue', 'teal', 'violet', 'amber', 'sky', 'indigo', 'orange', 'green', 'rose'];

/** "€1.2M", "800k", "35%", 3 → a number; undefined for words. */
export function numberOf(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const m = /^\s*[^\d\s.,-]{0,3}\s*(-?\d+(?:[.,]\d+)?)\s*(k|m|mn|bn|b|%)?\s*$/i.exec(v);
  if (!m) return undefined;
  const n = Number(m[1]!.replace(',', '.'));
  const unit = m[2]?.toLowerCase();
  return n * (unit === 'k' ? 1e3 : unit === 'm' || unit === 'mn' ? 1e6 : unit === 'b' || unit === 'bn' ? 1e9 : 1);
}

const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/[-_]/g, ' ') : s);

/** 1200000 → 1.2M, as a legend says a range. */
function short(n: number): string {
  const a = Math.abs(n);
  const f = (x: number, u: string) => `${Math.round(x * 10) / 10}${u}`;
  return a >= 1e9 ? f(n / 1e9, 'B') : a >= 1e6 ? f(n / 1e6, 'M') : a >= 1e3 ? f(n / 1e3, 'k') : String(Math.round(n * 10) / 10);
}

export interface HeatScale {
  by: string;
  title: string;
  /** The heat of one value; undefined when there is none. */
  of(v: unknown): BlockHeat | undefined;
  legend: LegendItem[];
}

/** A heat entry, preset filled in, read against the values the map has. */
export function heatScale(entry: HeatEntry, values: unknown[]): HeatScale {
  const preset = PRESETS[entry.by.toLowerCase()] ?? {};
  const e: HeatEntry = { ...preset, ...entry, labels: entry.labels ?? preset.labels };
  const title = e.title ?? preset.title ?? titleCase(e.by);
  const present = values.filter((v) => v != null && v !== '');
  const nums = present.map(numberOf);
  const categorical = e.scale === 'categorical' || (e.scale === undefined && (e.values !== undefined || nums.some((n) => n === undefined)));

  if (categorical) {
    // Categories in the order the entry lists them, then as they occur.
    const order: string[] = [];
    for (const k of Object.keys(e.values ?? {})) order.push(k);
    for (const v of present) if (!order.some((k) => k.toLowerCase() === String(v).toLowerCase())) order.push(String(v));
    const look = (v: string) => {
      const key = order.find((k) => k.toLowerCase() === v.toLowerCase()) ?? v;
      const own = e.values?.[key];
      const spec = typeof own === 'string' ? { tone: own } : (own ?? {});
      const known = CATEGORY[key.toLowerCase()];
      const tone = spec.tone ?? known?.tone ?? CYCLE[order.indexOf(key) % CYCLE.length]!;
      return { key, tone, label: spec.label ?? titleCase(key), pattern: spec.pattern ?? (spec.tone ? undefined : known?.pattern) };
    };
    const used = order.filter((k) => present.some((v) => String(v).toLowerCase() === k.toLowerCase()) || e.values?.[k] !== undefined);
    return {
      by: e.by,
      title,
      of: (v) => {
        if (v == null || v === '') return undefined;
        const l = look(String(v));
        return { scale: 'categorical', tone: l.tone, text: l.label, ...(l.pattern ? { pattern: l.pattern } : {}) };
      },
      legend: used.map((k, i) => {
        const l = look(k);
        return { label: i === 0 ? `${title}: ${l.label}` : l.label, swatch: 'block', block: { form: 'chip', heat: { scale: 'categorical', tone: l.tone, text: l.label, ...(l.pattern ? { pattern: l.pattern } : {}) } } };
      }),
    };
  }

  const found = nums.filter((n): n is number => n !== undefined);
  const lo = e.min ?? (found.length ? Math.min(...found) : 0);
  const hi = e.max ?? (found.length ? Math.max(...found) : 1);
  const scale = e.scale ?? 'sequential';
  const tone = e.tone ?? 'blue';
  const at = (n: number) => {
    const t = hi > lo ? Math.max(0, Math.min(1, (n - lo) / (hi - lo))) : 0.5;
    return e.reverse ? 1 - t : t;
  };
  const heat = (n: number, text: string): BlockHeat => ({ scale, at: at(n), tone, text });
  // The legend: a sample per labelled value, per whole number of a short range, or five even steps.
  const legend: LegendItem[] = [];
  const whole = found.every((n) => Number.isInteger(n)) && Number.isInteger(lo) && Number.isInteger(hi) && hi - lo <= 6;
  const label = (i: number, s: string) => (i === 0 ? `${title}: ${s}` : s);
  if (e.labels && Object.keys(e.labels).length) {
    const keys = Object.keys(e.labels).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    keys.forEach((k, i) => legend.push({ label: label(i, `${short(k)} ${e.labels![String(k)]}`), swatch: 'block', block: { form: 'chip', heat: heat(k, String(k)) } }));
  } else if (whole && found.length) {
    for (let k = lo, i = 0; k <= hi; k++, i++) legend.push({ label: label(i, String(k)), swatch: 'block', block: { form: 'chip', heat: heat(k, String(k)) } });
  } else if (found.length) {
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const a = lo + ((hi - lo) * i) / steps;
      const b = lo + ((hi - lo) * (i + 1)) / steps;
      legend.push({ label: label(i, `${short(a)}–${short(b)}`), swatch: 'block', block: { form: 'chip', heat: heat((a + b) / 2, '') } });
    }
  }
  return {
    by: e.by,
    title,
    of: (v) => {
      const n = numberOf(v);
      if (n === undefined) return undefined;
      // A number says itself; a labelled one keeps its number in the tag and its word in the legend.
      return heat(n, typeof v === 'number' ? short(v) : String(v).trim());
    },
    legend,
  };
}
