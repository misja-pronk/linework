// Mermaid gantt and timeline → roadmap.
//
// gantt: sections become lanes, tasks items; done/active/crit become statuses, milestone a diamond,
// `after a b` stays a dependency (so it is drawn), a start left out continues after the task before.
// timeline: its periods become the axis, events items in that period, sections phases.
import { parseDate } from '@cartography/roadmap';
import { cleanLabel, Ids, scalar, slug, type Warnings } from './text.ts';

const DAY = 86_400_000;
const iso = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

/** A date in Mermaid's dateFormat (YYYY, MM, DD and separators) → days, or undefined. */
function dateIn(format: string, s: string): number | undefined {
  if (format === 'YYYY-MM-DD' || /^\d{4}-\d{2}-\d{2}$/.test(s)) return parseDate(s)?.start;
  const order: string[] = [];
  const re = format.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/YYYY|YY|MM|M|DD|D|HH|mm|ss/g, (t) => {
    order.push(t);
    return t.length === 4 ? '(\\d{4})' : '(\\d{1,2})';
  });
  const m = new RegExp(`^${re}$`).exec(s.trim());
  if (!m) return undefined;
  const get = (t: string[]) => {
    const i = order.findIndex((o) => t.includes(o));
    return i < 0 ? undefined : Number(m[i + 1]);
  };
  const y = get(['YYYY']) ?? 2000 + (get(['YY']) ?? 0);
  return parseDate(`${y}-${String(get(['MM', 'M']) ?? 1).padStart(2, '0')}-${String(get(['DD', 'D']) ?? 1).padStart(2, '0')}`)?.start;
}

/** Mermaid durations in days: 3d, 2w, 12h (rounded up to a day); minutes and seconds count as a day. */
function durationDays(s: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w|y)$/.exec(s.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  return { ms: 1, s: 1, m: 1, h: Math.max(1, Math.ceil(n / 24)), d: Math.round(n), w: Math.round(n * 7), y: Math.round(n * 365) }[m[2]!] ?? undefined;
}

interface Task {
  id: string;
  label: string;
  lane?: string;
  status?: string;
  milestone: boolean;
  start: number;
  end: number;
  from?: string;
  after: string[];
  to?: string;
  duration?: string;
}

export function importGantt(body: string[], title: string | undefined, warn: Warnings): string {
  let format = 'YYYY-MM-DD';
  const lanes: { id: string; label: string }[] = [];
  const laneIds = new Ids();
  const ids = new Ids();
  const byMermaid = new Map<string, Task>();
  const tasks: Task[] = [];
  let lane: string | undefined;
  for (const raw of body) {
    const s = raw.trim();
    if (!s) continue;
    let m: RegExpExecArray | null;
    if ((m = /^dateFormat\s+(.+)$/i.exec(s))) format = m[1]!.trim();
    else if (/^(axisFormat|tickInterval|todayMarker|weekday|inclusiveEndDates|topAxis|displayMode|accTitle|accDescr)\b/i.test(s)) continue;
    else if (/^excludes\b/i.test(s)) warn.onceFor('excludes', 'excludes (weekends, holidays) is ignored: durations count every day');
    else if ((m = /^section\s+(.+)$/i.exec(s))) {
      const label = cleanLabel(m[1]!);
      lane = laneIds.get(label);
      lanes.push({ id: lane, label });
    } else if ((m = /^([^:]+):(.*)$/.exec(s))) {
      const label = cleanLabel(m[1]!);
      const parts = m[2]!.split(',').map((p) => p.trim()).filter(Boolean);
      const tags = new Set<string>();
      while (parts.length && /^(done|active|crit|milestone)$/.test(parts[0]!)) tags.add(parts.shift()!);
      // What is left: [id,] [start,] end-or-duration (Mermaid's own rules).
      const [mid, startRaw, endRaw] = parts.length >= 3 ? parts : parts.length === 2 ? [undefined, parts[0], parts[1]] : [undefined, undefined, parts[0]];
      const id = ids.get(mid ?? `task:${tasks.length}`, slug(mid ?? label).toLowerCase());
      const prev = tasks.at(-1);
      const t: Task = { id, label, ...(lane ? { lane } : {}), milestone: tags.has('milestone'), start: prev?.end ?? 0, end: 0, after: [] };
      t.status = tags.has('crit') ? 'at-risk' : tags.has('done') ? 'done' : tags.has('active') ? 'active' : undefined;
      if (startRaw && /^after\s+/i.test(startRaw)) {
        const refs = startRaw.replace(/^after\s+/i, '').split(/\s+/).filter(Boolean);
        t.after = refs.map((r) => byMermaid.get(r)?.id).filter((x): x is string => !!x);
        if (t.after.length < refs.length) warn.add(`${label}: after names an unknown task`);
        t.start = Math.max(...t.after.map((a) => tasks.find((x) => x.id === a)!.end), prev?.end ?? 0);
      } else if (startRaw) {
        const d = dateIn(format, startRaw);
        if (d === undefined) warn.add(`${label}: "${startRaw}" is not a ${format} date`);
        else (t.start = d), (t.from = iso(d));
      } else if (prev) t.from = iso(prev.end);
      else warn.add(`${label}: no start date`);
      const days = endRaw ? durationDays(endRaw) : undefined;
      const endDate = endRaw && days === undefined ? dateIn(format, endRaw) : undefined;
      if (endRaw && /^until\s/i.test(endRaw)) warn.onceFor('until', 'until is not supported: such tasks last one day');
      if (days !== undefined) t.end = t.start + days;
      else if (endDate !== undefined) t.end = endDate;
      else t.end = t.start + 1;
      if (!t.milestone) {
        // Mermaid's end date is exclusive; ours is the last day.
        if (endDate !== undefined) t.to = iso(Math.max(t.start, endDate - 1));
        else t.duration = `${Math.max(1, t.end - t.start)}d`;
      } else t.end = t.start;
      if (/h$|m$|s$/.test(endRaw ?? '') && days !== undefined) warn.onceFor('hours', 'Durations under a day are rounded up to a day');
      if (mid) byMermaid.set(mid, t);
      tasks.push(t);
    } else warn.onceFor(`skip:${s}`, `Skipped: ${s}`);
  }

  const out = ['type: roadmap'];
  if (title) out.push(`title: ${scalar(title)}`);
  if (lanes.length) {
    out.push('', 'lanes:');
    for (const l of lanes) out.push(`  ${l.id}: ${scalar(l.label)}`);
  }
  out.push('', 'items:');
  if (!tasks.length) out.push('  {}');
  for (const t of tasks) {
    const f: string[] = [];
    if (t.lane) f.push(`lane: ${t.lane}`);
    if (t.label !== t.id) f.push(`label: ${scalar(t.label)}`);
    if (t.milestone) f.push(`at: ${t.from ?? iso(t.start)}`);
    else {
      if (t.from && !t.after.length) f.push(`from: ${t.from}`);
      if (t.after.length) f.push(`after: ${t.after.length === 1 ? t.after[0] : `[${t.after.join(', ')}]`}`);
      if (t.to) f.push(`to: ${t.to}`);
      if (t.duration) f.push(`duration: ${t.duration}`);
    }
    if (t.status) f.push(`status: ${t.status}`);
    out.push(`  ${t.id}: { ${f.join(', ')} }`);
  }
  return out.join('\n') + '\n';
}

export function importTimeline(body: string[], title: string | undefined, warn: Warnings): string {
  const periods: string[] = [];
  const events: { period: string; label: string }[] = [];
  const sections: { label: string; from: string; to: string }[] = [];
  for (const raw of body) {
    const s = raw.trim();
    if (!s) continue;
    let m: RegExpExecArray | null;
    if ((m = /^section\s+(.+)$/i.exec(s))) {
      sections.push({ label: cleanLabel(m[1]!), from: '', to: '' });
      continue;
    }
    if (/^(accTitle|accDescr)\b/i.test(s)) continue;
    const parts = s.split(/\s+:\s*|\s*:\s+|^:\s*/);
    // ": event" on its own line adds to the period before it.
    const period = s.startsWith(':') ? periods.at(-1) : cleanLabel(parts.shift()!);
    if (s.startsWith(':')) parts.shift();
    if (!period) {
      warn.onceFor(`skip:${s}`, `Skipped: ${s}`);
      continue;
    }
    if (!periods.includes(period)) periods.push(period);
    const sec = sections.at(-1);
    if (sec) (sec.from ||= period), (sec.to = period);
    for (const e of parts.map(cleanLabel).filter(Boolean)) events.push({ period, label: e });
  }
  const ids = new Ids();
  const tones = ['sky', 'violet', 'teal', 'amber', 'rose', 'indigo'];
  const out = ['type: roadmap'];
  if (title) out.push(`title: ${scalar(title)}`);
  out.push(`periods: [${periods.map(scalar).join(', ')}]`);
  if (sections.some((s) => s.from)) {
    out.push('', 'phases:');
    for (const [i, s] of sections.entries()) if (s.from) out.push(`  ${scalar(s.label)}: { from: ${scalar(s.from)}, to: ${scalar(s.to)}, tone: ${tones[i % tones.length]} }`);
  }
  out.push('', 'items:');
  if (!events.length) out.push('  {}');
  for (const e of events) {
    const id = ids.get(`${e.period}:${e.label}`, slug(e.label).toLowerCase());
    out.push(`  ${id}: { label: ${scalar(e.label)}, in: ${scalar(e.period)} }`);
  }
  return out.join('\n') + '\n';
}
