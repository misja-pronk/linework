// Mermaid sequenceDiagram → sequence. Participants and actors (with `as` aliases and boxes), every
// arrow, +/- and activate/deactivate, notes, loop/alt/opt/par/critical/break/rect frames, autonumber.
// Activations: a diagram that sets none gets ours (calls open, replies close); one that sets any keeps
// exactly its own (`activations: explicit`).
import { guessKind } from './systems.ts';
import { cleanLabel, Ids, scalar, type Warnings } from './text.ts';

// Systems kinds the guess may give, as sequence kinds.
const KIND: Record<string, string> = {
  user: 'person', users: 'people', desktop: 'client', device: 'client', 'load-balancer': 'gateway', cdn: 'gateway', dns: 'gateway', firewall: 'gateway',
  warehouse: 'database', search: 'service', container: 'service', server: 'service', job: 'worker', email: 'service', ai: 'service', monitoring: 'service', secrets: 'service',
};
const SEQUENCE_KINDS = new Set(['person', 'people', 'client', 'mobile', 'service', 'api', 'gateway', 'function', 'worker', 'database', 'cache', 'storage', 'queue', 'topic', 'identity', 'payments', 'system', 'external']);
// Mermaid's own participant types (`participant A@{ "type": "database" }`).
const TYPED: Record<string, string> = { database: 'database', queue: 'queue', collections: 'storage', entity: 'database', boundary: 'system', control: 'service', actor: 'person' };

const COLOUR = /^(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8}|transparent|(light|dark)?(aqua|blue|green|red|yellow|purple|gr[ae]y|orange|pink|white|black|teal|navy|olive|silver|beige|ivory|lavender|wheat|khaki|coral|salmon|tan|cyan|magenta))\b\s*/i;

// Longest first, so "-->>" is not read as "-->".
const ARROW = /^(.+?)\s*(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)\s*([+-]?)\s*(.+?)\s*(?::(.*))?$/;
const OURS: Record<string, string> = { '->>': '->', '->': '->', '-->>': '-->', '-->': '-->', '-x': '-x', '--x': '-x', '-)': '->>', '--)': '->>', '<<->>': '->', '<<-->>': '-->' };

interface Participant {
  id: string;
  label?: string;
  kind: string;
  box?: string;
}

type Step = { line: string } | { frame: string; label?: string; steps: Step[]; branches: { label?: string; steps: Step[] }[] };

export function importSequence(body: string[], title: string | undefined, warn: Warnings): string {
  const ids = new Ids();
  const participants = new Map<string, Participant>();
  const boxes: { id: string; label: string }[] = [];
  let box: string | undefined;
  let autonumber = false;
  let explicit = false;
  const root: Step[] = [];
  const stack: Extract<Step, { frame: string }>[] = [];
  const current = () => {
    const f = stack.at(-1);
    return f ? (f.branches.at(-1)?.steps ?? f.steps) : root;
  };

  const declare = (raw: string, label?: string, typed?: string, actor = false) => {
    const source = raw.trim();
    let p = participants.get(source);
    if (!p) {
      const text = label ?? source;
      const guess = guessKind(text);
      const kind = actor ? 'person' : typed ? (TYPED[typed] ?? 'service') : guess ? (KIND[guess] ?? (SEQUENCE_KINDS.has(guess) ? guess : 'service')) : 'service';
      participants.set(source, (p = { id: ids.get(source), kind, box }));
      if (label !== undefined && label !== p.id) p.label = label;
      else if (!label && source !== p.id) p.label = source;
    }
    return p.id;
  };

  for (const raw of body) {
    const s = raw.trim();
    if (!s) continue;
    let m: RegExpExecArray | null;
    if ((m = /^(create\s+)?(participant|actor)\s+(.+?)(?:@\{(.*)\})?(?:\s+as\s+(.+))?$/i.exec(s))) {
      if (m[1]) warn.onceFor('create', 'create participant is drawn as a participant from the start');
      const typed = m[4] ? /"?type"?\s*:\s*"?(\w+)"?/.exec(m[4])?.[1] : undefined;
      declare(m[3]!, m[5] ? cleanLabel(m[5]) : undefined, typed, m[2]!.toLowerCase() === 'actor');
    } else if ((m = /^box\s*(.*)$/i.exec(s))) {
      // The colour comes first when there is one: a name, rgb(…) or "transparent".
      const label = cleanLabel(m[1]!.replace(COLOUR, '')) || 'Box';
      box = ids.get(`box:${label}`, label.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'box');
      boxes.push({ id: box, label });
    } else if (/^end$/i.test(s)) {
      if (stack.length) stack.pop();
      else box = undefined;
    } else if (/^autonumber\b/i.test(s)) autonumber = true;
    else if ((m = /^(activate|deactivate)\s+(.+)$/i.exec(s))) {
      explicit = true;
      current().push({ line: `${m[1]!.toLowerCase()}: ${declare(m[2]!)}` });
    } else if ((m = /^destroy\s+(.+)$/i.exec(s))) {
      declare(m[1]!);
      warn.onceFor('destroy', 'destroy is not drawn: the lifeline runs to the end');
    } else if ((m = /^note\s+(left of|right of|over)\s+([^:]+):(.*)$/i.exec(s))) {
      const where = m[2]!.split(',').map((x) => declare(x));
      const side = m[1]!.toLowerCase().split(' ')[0]!;
      const at = side === 'over' ? (where.length > 1 ? `[${where.join(', ')}]` : where[0]!) : where[0]!;
      current().push({ line: `note: ${scalar(cleanLabel(m[3]!))}\n  ${side}: ${at}` });
    } else if ((m = /^(loop|alt|opt|par|par_over|critical|break|rect)\b\s*(.*)$/i.exec(s))) {
      const kind = m[1]!.toLowerCase();
      const frame = kind === 'rect' ? 'group' : kind === 'par_over' ? 'par' : kind;
      if (kind === 'rect') warn.onceFor('rect', 'rect highlights become plain group frames (colours are not kept)');
      const label = kind === 'rect' ? undefined : cleanLabel(m[2]!) || undefined;
      const f = { frame, label, steps: [], branches: [] };
      current().push(f);
      stack.push(f);
    } else if ((m = /^(else|and|option)\b\s*(.*)$/i.exec(s))) {
      stack.at(-1)?.branches.push({ label: cleanLabel(m[2]!) || undefined, steps: [] });
    } else if ((m = ARROW.exec(s))) {
      const op = m[2]!;
      if (op.startsWith('<<')) warn.onceFor('both', 'Two-way arrows (<<->>) are drawn one way');
      if (m[3]) explicit = true;
      const from = declare(m[1]!);
      const to = declare(m[4]!);
      const label = cleanLabel(m[5] ?? '');
      const key = `${from} ${OURS[op]} ${m[3]}${to}`;
      current().push({ line: label ? `${key}: ${scalar(label)}` : key });
    } else if (/^(title|links?|properties|details)\b/i.test(s)) continue;
    else warn.onceFor(`skip:${s}`, `Skipped: ${s}`);
  }

  const out: string[] = ['type: sequence'];
  if (title) out.push(`title: ${scalar(title)}`);
  if (autonumber) out.push('autonumber: true');
  if (explicit) out.push('activations: explicit');
  if (boxes.length) {
    out.push('', 'boxes:');
    for (const b of boxes) out.push(`  ${b.id}: ${scalar(b.label)}`);
  }
  out.push('', 'participants:');
  for (const p of participants.values()) {
    // The kind is read from the source's words or type: it gives the icon, not a caption the source never wrote.
    const quiet = p.kind === 'person' || p.kind === 'people';
    const fields = [`kind: ${p.kind}`, p.label ? `label: ${scalar(p.label)}` : '', p.label && !quiet ? 'caption: ""' : '', p.box ? `box: ${p.box}` : ''].filter(Boolean);
    out.push(`  ${p.id}: ${fields.length === 1 ? p.kind : `{ ${fields.join(', ')} }`}`);
  }
  out.push('', 'steps:');
  writeSteps(root, '  ', out);
  return out.join('\n') + '\n';
}

function writeSteps(steps: Step[], indent: string, out: string[]) {
  if (!steps.length) out.push(`${indent}[]`);
  for (const step of steps) {
    if ('line' in step) {
      const [first, ...rest] = step.line.split('\n');
      out.push(`${indent}- ${first}`, ...rest.map((l) => `${indent}${l}`));
      continue;
    }
    out.push(`${indent}- ${step.frame}:${step.label ? ` ${scalar(step.label)}` : ''}`);
    out.push(`${indent}  steps:`);
    writeSteps(step.steps, `${indent}    `, out);
    if (!step.branches.length) continue;
    const key = step.frame === 'par' ? 'and' : 'else';
    if (step.branches.length === 1 && !step.branches[0]!.label) {
      out.push(`${indent}  ${key}:`);
      writeSteps(step.branches[0]!.steps, `${indent}    `, out);
      continue;
    }
    out.push(`${indent}  ${key}:`);
    const seen = new Set<string>();
    for (const b of step.branches) {
      let label = b.label ?? key;
      for (let n = 2; seen.has(label); n++) label = `${b.label ?? key} (${n})`;
      seen.add(label);
      out.push(`${indent}    ${scalar(label)}:`);
      writeSteps(b.steps, `${indent}      `, out);
    }
  }
}
