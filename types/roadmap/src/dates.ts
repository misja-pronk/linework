// Dates as whole days since 1970 (UTC), so the axis is plain arithmetic and never shifts with a time
// zone. A written date is a range: "2026" a year, "2026-03" a month, "2026-Q2" a quarter, "2026-W14"
// an ISO week, "2026-03-15" a day.

import { english, type Word } from '@linework/core';

export type Unit = 'week' | 'month' | 'quarter';

const DAY = 86_400_000;
export const day = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m, d) / DAY);
const ymd = (n: number) => {
  const d = new Date(n * DAY);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: (d.getUTCDay() + 6) % 7 };
};

/** Monday of ISO week 1: the week with the year's first Thursday. */
function isoWeekOne(y: number): number {
  const jan4 = day(y, 0, 4);
  return jan4 - ymd(jan4).wd;
}

export function isoWeek(n: number): { year: number; week: number } {
  const thursday = n - ymd(n).wd + 3;
  const year = ymd(thursday).y;
  return { year, week: Math.floor((thursday - isoWeekOne(year)) / 7) + 1 };
}

/** [start, end) of a written date, or undefined when it is not one. */
export function parseDate(v: unknown): { start: number; end: number } | undefined {
  if (typeof v === 'number' && Number.isInteger(v) && v > 1000 && v < 10000) return { start: day(v, 0, 1), end: day(v + 1, 0, 1) };
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})$/.exec(s))) return parseDate(Number(m[1]));
  if ((m = /^(\d{4})-(\d{1,2})$/.exec(s))) {
    const [y, mo] = [Number(m[1]), Number(m[2]) - 1];
    return mo >= 0 && mo < 12 ? { start: day(y, mo, 1), end: day(y, mo + 1, 1) } : undefined;
  }
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
    const n = day(y, mo, d);
    return ymd(n).m === mo ? { start: n, end: n + 1 } : undefined;
  }
  if ((m = /^(\d{4})-?Q([1-4])$/i.exec(s)) || (m = /^Q([1-4])[\s-]+(\d{4})$/i.exec(s))) {
    const [y, q] = s.toUpperCase().startsWith('Q') ? [Number(m[2]), Number(m[1])] : [Number(m[1]), Number(m[2])];
    return { start: day(y, (q - 1) * 3, 1), end: day(y, q * 3, 1) };
  }
  if ((m = /^(\d{4})-?W(\d{1,2})$/i.exec(s))) {
    const start = isoWeekOne(Number(m[1])) + (Number(m[2]) - 1) * 7;
    return Number(m[2]) >= 1 && Number(m[2]) <= 53 ? { start, end: start + 7 } : undefined;
  }
  return undefined;
}

/** `start` plus a duration such as "6w", "3 months", "10d", "1q"; undefined when it is not one. */
export function addDuration(start: number, v: unknown): number | undefined {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(d|days?|w|weeks?|m|mo|months?|q|quarters?|y|years?)\s*$/i.exec(String(v ?? ''));
  if (!m) return undefined;
  const n = Number(m[1]);
  const u = m[2]!.toLowerCase()[0];
  if (u === 'd') return start + Math.round(n);
  if (u === 'w') return start + Math.round(n * 7);
  const months = u === 'q' ? n * 3 : u === 'y' ? n * 12 : n;
  const d = ymd(start);
  const whole = Math.floor(months);
  const base = day(d.y, d.m + whole, d.d);
  return base + Math.round((months - whole) * 30);
}

/** The start of the unit that holds day n (a Monday, the 1st of a month or quarter). */
export function floorUnit(n: number, unit: Unit): number {
  const d = ymd(n);
  if (unit === 'week') return n - d.wd;
  if (unit === 'month') return day(d.y, d.m, 1);
  return day(d.y, d.m - (d.m % 3), 1);
}

export function nextUnit(n: number, unit: Unit): number {
  const d = ymd(n);
  if (unit === 'week') return n + 7;
  return day(d.y, d.m + (unit === 'month' ? 1 : 3), 1);
}

// Each with a context mark: May the month, not the verb (the mark is never drawn).
const MONTHS = ['Jan@month', 'Feb@month', 'Mar@month', 'Apr@month', 'May@month', 'Jun@month', 'Jul@month', 'Aug@month', 'Sep@month', 'Oct@month', 'Nov@month', 'Dec@month'];

/** The names of the months in the drawing's language: `word` as the type gets it, the English when there is none. */
const monthNames = (word: Word) => MONTHS.map((m) => word(m));

/** Ticks of the axis from start to end, each with the label of the group above it. */
export function ticks(start: number, end: number, unit: Unit, word: Word = english): { start: number; end: number; label: string; group: string }[] {
  const month = monthNames(word);
  const out: { start: number; end: number; label: string; group: string }[] = [];
  const long = end - start > 560;
  for (let t = floorUnit(start, unit); t < end; t = nextUnit(t, unit)) {
    const d = ymd(t);
    const q = Math.floor(d.m / 3) + 1;
    const next = nextUnit(t, unit);
    if (unit === 'week') out.push({ start: t, end: next, label: `W${isoWeek(t).week}`, group: `${month[d.m]} ${d.y}` });
    else if (unit === 'month') out.push({ start: t, end: next, label: month[d.m]!, group: long ? String(d.y) : `Q${q} ${d.y}` });
    else out.push({ start: t, end: next, label: `Q${q}`, group: String(d.y) });
  }
  return out;
}

export function formatDay(n: number, word: Word = english): string {
  const month = monthNames(word);
  const d = ymd(n);
  return `${d.d} ${month[d.m]} ${d.y}`;
}
