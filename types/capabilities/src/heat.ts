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
  /** What the numbers are in: €, $, %, FTE. Left out, it is read from the values (€220k → €). */
  unit?: string;
  /**
   * The numbers count something (systems): the key says "1 system", "2 systems", a capability with
   * none is drawn plain and the key says "none", and the shades stay light (a count is no alarm).
   */
  count?: string;
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
  systems: { scale: 'sequential', tone: 'violet', title: 'Systems', count: 'system' },
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
/** How deep the shade of the highest count goes (0 to 1): light enough to read the names on it. */
const COUNT_DEPTH = 0.45;
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
  // Two decimals at most, so a step of 0.25 or 2.5M says where it ends.
  const f = (x: number, u: string) => `${Math.round(x * 100) / 100}${u}`;
  return a >= 1e9 ? f(n / 1e9, 'B') : a >= 1e6 ? f(n / 1e6, 'M') : a >= 1e3 ? f(n / 1e3, 'k') : f(n, '');
}

/** The unit the values are written in, when they all share one: "€220k" → €, "35%" → %. */
function unitOf(values: unknown[]): string | undefined {
  const units = values.map((v) => {
    if (typeof v !== 'string') return '';
    const m = /^\s*([^\d\s.,-]{0,3})\s*-?\d[\d.,]*\s*(?:k|m|mn|bn|b)?\s*(%)?\s*$/i.exec(v);
    return m ? m[1] || m[2] || '' : '';
  });
  return units[0] && units.every((u) => u === units[0]) ? units[0] : undefined;
}

/** A number with its unit: a currency before it (€30k), a percentage or a word after it (35%, 4 FTE). */
function withUnit(n: number, unit?: string): string {
  if (!unit) return short(n);
  if (unit === '%') return `${short(n)}%`;
  return /^\p{L}/u.test(unit) ? `${short(n)} ${unit}` : `${unit}${short(n)}`;
}

/**
 * Round step boundaries around lo..hi: a step of 1, 2, 2.5 or 5 times a power of ten, as close to
 * five steps as there is, so a key reads €0–€200k, not 30k–152k.
 */
export function niceSteps(lo: number, hi: number): { start: number; step: number; count: number } {
  let best: { start: number; step: number; count: number } | undefined;
  const e = Math.floor(Math.log10(Math.max(Math.abs(hi - lo), 1e-9) / 5));
  for (let p = e - 1; p <= e + 1; p++)
    for (const m of [1, 2, 2.5, 5]) {
      const step = m * 10 ** p;
      const start = Math.floor(lo / step + 1e-9) * step;
      const end = Math.max(start + step, Math.ceil(hi / step - 1e-9) * step);
      const count = Math.round((end - start) / step);
      if (count > 7) continue;
      if (!best || Math.abs(count - 5) < Math.abs(best.count - 5) || (Math.abs(count - 5) === Math.abs(best.count - 5) && count > best.count)) best = { start, step, count };
    }
  return best ?? { start: lo, step: (hi - lo) / 5 || 1, count: 5 };
}

export interface HeatScale {
  by: string;
  title: string;
  /** The heat of one value; undefined when there is none. */
  of(v: unknown): BlockHeat | undefined;
  legend: LegendItem[];
  /** What the key calls a capability without a value. */
  missing: string;
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
      missing: 'No value',
    };
  }

  // A count of none is no value: drawn plain, and the key says "none".
  const found = nums.filter((n): n is number => n !== undefined && !(e.count && n === 0));
  const unit = e.unit ?? unitOf(present);
  const lo = e.min ?? (found.length ? Math.min(...found) : 0);
  const hi = e.max ?? (found.length ? Math.max(...found) : 1);
  const scale = e.scale ?? 'sequential';
  const tone = e.tone ?? 'blue';
  const at = (n: number) => {
    // A count runs from light to a middle shade: two systems is not twice as alarming as one.
    const t = e.count ? Math.min(1, n / Math.max(hi, 1)) * COUNT_DEPTH : hi > lo ? Math.max(0, Math.min(1, (n - lo) / (hi - lo))) : 0.5;
    return e.reverse ? 1 - t : t;
  };
  // The legend: a sample per labelled value, per whole number of a short range, or five even steps.
  const legend: LegendItem[] = [];
  const whole = found.every((n) => Number.isInteger(n)) && Number.isInteger(lo) && Number.isInteger(hi) && hi - lo <= 6;
  // Round steps colour every value as its step's sample, so the map shows the key's shades and no in-betweens.
  const bins = !(e.labels && Object.keys(e.labels).length) && !whole && found.length ? niceSteps(lo, hi) : undefined;
  const binned = (n: number) => {
    if (!bins) return at(n);
    const t = (Math.max(0, Math.min(bins.count - 1, Math.floor((n - bins.start) / bins.step + 1e-9))) + 0.5) / bins.count;
    return e.reverse ? 1 - t : t;
  };
  const heat = (n: number, text: string): BlockHeat => ({ scale, at: binned(n), tone, text });
  const label = (i: number, s: string) => (e.count ? `${s} ${e.count}${s === '1' ? '' : 's'}` : i === 0 ? `${title}: ${s}` : s);
  if (e.labels && Object.keys(e.labels).length) {
    const keys = Object.keys(e.labels).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    keys.forEach((k, i) => legend.push({ label: label(i, `${short(k)} ${e.labels![String(k)]}`), swatch: 'block', block: { form: 'chip', heat: heat(k, String(k)) } }));
  } else if (whole && found.length) {
    for (let k = lo, i = 0; k <= hi; k++, i++) legend.push({ label: label(i, String(k)), swatch: 'block', block: { form: 'chip', heat: heat(k, String(k)) } });
  } else if (bins) {
    for (let i = 0; i < bins.count; i++) {
      const a = bins.start + bins.step * i;
      const b = a + bins.step;
      legend.push({ label: label(i, `${withUnit(a, unit)}–${withUnit(b, unit)}`), swatch: 'block', block: { form: 'chip', heat: heat((a + b) / 2, '') } });
    }
  }
  return {
    by: e.by,
    title,
    of: (v) => {
      const n = numberOf(v);
      if (n === undefined || (e.count && n === 0)) return undefined;
      // A number says itself; a labelled one keeps its number in the tag and its word in the legend.
      return heat(n, typeof v === 'number' ? withUnit(v, unit) : String(v).trim());
    },
    legend,
    missing: e.count ? 'none' : 'No value',
  };
}
