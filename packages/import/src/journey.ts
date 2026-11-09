// Mermaid journey → journey.
//
// Sections become phases, tasks steps with their score (Mermaid scores run 1..5, as here). Mermaid
// lists who takes part in each task; the one in most tasks is the person the journey is about (the
// persona), the others stand in the step's with:.
import { cleanLabel, Ids, scalar, slug, type Warnings } from './text.ts';

interface Task {
  label: string;
  phase?: string;
  score?: number;
  actors: string[];
}

export function importJourney(body: string[], title: string | undefined, warn: Warnings): string {
  const phases: { id: string; label: string }[] = [];
  const phaseIds = new Ids();
  const tasks: Task[] = [];
  let phase: string | undefined;
  for (const raw of body) {
    const s = raw.trim();
    if (!s || /^(accTitle|accDescr)\b/i.test(s)) continue;
    let m: RegExpExecArray | null;
    if ((m = /^section\s+(.+)$/i.exec(s))) {
      const label = cleanLabel(m[1]!);
      phase = phaseIds.get(label, slug(label).toLowerCase());
      if (!phases.some((p) => p.id === phase)) phases.push({ id: phase, label });
      continue;
    }
    // "Make tea: 5: Me, Cat"; the task name may hold a colon itself, so read from the end.
    if ((m = /^(.+?)\s*:\s*([+-]?\d+(?:\.\d+)?)\s*(?::\s*(.*))?$/.exec(s))) {
      const actors = (m[3] ?? '').split(',').map(cleanLabel).filter(Boolean);
      tasks.push({ label: cleanLabel(m[1]!), ...(phase ? { phase } : {}), score: Number(m[2]), actors });
      continue;
    }
    if ((m = /^([^:]+)$/.exec(s)) && !/^(title|journey)\b/i.test(s)) {
      tasks.push({ label: cleanLabel(m[1]!), ...(phase ? { phase } : {}), actors: [] });
      warn.onceFor('score', 'Tasks without a score are kept without a feeling');
      continue;
    }
    warn.onceFor(`skip:${s}`, `Skipped: ${s}`);
  }

  // The actor in most tasks is who the journey is about; first named wins a tie.
  const count = new Map<string, number>();
  for (const t of tasks) for (const a of new Set(t.actors)) count.set(a, (count.get(a) ?? 0) + 1);
  const persona = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (persona && tasks.some((t) => t.actors.length && !t.actors.includes(persona))) warn.add(`"${persona}" is taken as the persona; steps without them keep the others under with:`);

  const out = ['type: journey'];
  if (title) out.push(`title: ${scalar(title)}`);
  if (persona) out.push(`persona: ${scalar(persona)}`);
  if (phases.length) {
    out.push('', 'phases:');
    for (const p of phases) out.push(`  ${p.id}: ${scalar(p.label)}`);
  }
  out.push('', 'steps:');
  if (!tasks.length) out.push('  {}');
  const keys = new Ids();
  let last: string | undefined;
  for (const [i, t] of tasks.entries()) {
    // The label is the key, as one writes it by hand; a second step of the same name gets an id.
    const unique = !keys.has(t.label);
    const key = keys.get(unique ? t.label : `${t.label}#${i}`, unique ? t.label : `${slug(t.label).toLowerCase()}-${i + 1}`);
    const others = t.actors.filter((a) => a !== persona);
    const fields: string[] = [];
    if (!unique) fields.push(`label: ${scalar(t.label)}`);
    if (t.phase && t.phase !== last) fields.push(`in: ${t.phase}`);
    if (t.score !== undefined) fields.push(`feel: ${t.score}`);
    if (others.length) fields.push(`with: ${others.length === 1 ? scalar(others[0]!) : `[${others.map(scalar).join(', ')}]`}`);
    last = t.phase ?? last;
    const short = fields.length === 1 && t.score !== undefined ? String(t.score) : fields.length ? `{ ${fields.join(', ')} }` : '';
    out.push(`  ${scalar(key)}:${short ? ` ${short}` : ''}`);
  }
  return out.join('\n') + '\n';
}
