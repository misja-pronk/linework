// The target of a flowchart that is a process: a `type: process` diagram. Its names are the labels,
// so the flow reads like the process, and the first chain (the way the source walks) is the happy path.
import { scalar } from './text.ts';

export interface FlowNode {
  source: string;
  label: string;
  kind: 'task' | 'decision' | 'start' | 'end' | 'subprocess' | 'document' | 'parallel';
  lane?: string;
  /** Drawn without its name (a gateway that only splits or joins). */
  bare?: boolean;
}

export interface FlowLink {
  from: string;
  to: string;
  label?: string;
  /** A dotted line: drawn dashed, as a message. */
  message: boolean;
}

export interface FlowDiagram {
  title?: string;
  lanes: { id: string; label: string }[];
  nodes: FlowNode[];
  links: FlowLink[];
}

/** A plain YAML scalar where that is safe as a list item or a key (arrows and all), quoted otherwise. */
export function plain(s: string): string {
  const risky = /: |:$| #|^[?\-[\]{}"'!&*|>%@`,#]|^\s|\s$|^$/.test(s) || /^(true|false|yes|no|on|off|y|n|null|~)$/i.test(s) || /^[-+.]?\d[\d_.,]*$/.test(s);
  return risky ? JSON.stringify(s) : s;
}

/** A label that can stand in the arrow itself: "-yes->". */
const inline = (label: string) => /^[\p{L}\p{N}](?:[\p{L}\p{N} ]*[\p{L}\p{N}])?$/u.test(label) && label.length <= 16;

export function processYaml(d: FlowDiagram): string {
  // A name is what the box says; "->" inside one would read as an arrow.
  const tidy = (label: string) => label.replace(/-+>/g, '→').replace(/\s+/g, ' ').trim() || 'Step';
  const used = new Set<string>();
  const names = new Map<string, string>();
  for (const n of d.nodes) {
    const word = n.kind === 'start' && /^(start|begin)$/i.test(n.label) ? 'start' : n.kind === 'end' && /^(end|stop)$/i.test(n.label) ? 'end' : undefined;
    // "Start" as a step in the middle would be taken for the start event.
    const base = word ?? (/^(start|end)$/i.test(n.label) ? `${tidy(n.label)} step` : tidy(n.label));
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} ${i}`;
    used.add(name.toLowerCase());
    names.set(n.source, name);
  }
  const name = (source: string) => names.get(source) ?? source;

  const out: string[] = ['type: process'];
  if (d.title) out.push(`title: ${scalar(d.title)}`);
  if (d.lanes.length) {
    out.push('', 'lanes:');
    for (const l of d.lanes) out.push(`  ${l.id}: ${scalar(l.label)}`);
  }

  // Only what the flow cannot say: a lane, or a kind the name does not give away.
  const entries: string[] = [];
  for (const n of d.nodes) {
    const id = name(n.source);
    const implied = id === 'start' ? 'start' : id === 'end' ? 'end' : /\?\s*$/.test(id) ? 'decision' : 'task';
    const kind = n.kind === implied ? undefined : n.kind;
    if (n.bare) entries.push(`  ${plain(id)}: { ${[`kind: ${n.kind}`, n.lane && `in: ${n.lane}`, 'label: ""'].filter(Boolean).join(', ')} }`);
    else if (kind && n.lane) entries.push(`  ${plain(id)}: { in: ${n.lane}, kind: ${kind} }`);
    else if (kind || n.lane) entries.push(`  ${plain(id)}: ${kind ?? n.lane}`);
  }
  if (entries.length) out.push('', 'nodes:', ...entries);

  // Chains as the source walks them: on along the first line out, until the flow stops or comes
  // back. Of several ways on, the one that reaches the end comes before one that leads somewhere
  // new, and that before a way back: the first chain is the happy path.
  const from = new Map<string, FlowLink[]>();
  for (const l of d.links) from.set(l.from, [...(from.get(l.from) ?? []), l]);
  const done = new Set<FlowLink>();
  const seen = new Set<string>();
  const ends = new Set(d.nodes.filter((n) => (d.nodes.some((x) => x.kind === 'end') ? n.kind === 'end' : !from.has(n.source))).map((n) => n.source));
  const finishes = (at: string, past = new Set<string>()): boolean => {
    if (ends.has(at)) return true;
    if (seen.has(at) || past.has(at)) return false;
    past.add(at);
    return (from.get(at) ?? []).some((l) => !l.message && finishes(l.to, past));
  };
  const items: string[] = [];
  const arrow = (l: FlowLink) => (l.message ? (l.label ? `--${l.label}-->` : '-->') : l.label ? `-${l.label}->` : '->');
  for (const first of d.links) {
    if (done.has(first)) continue;
    if (first.label && !inline(first.label)) {
      // A label with more to it than a word or two stands after the colon, on a line of its own.
      done.add(first);
      seen.add(first.from).add(first.to);
      items.push(`  - ${plain(`${name(first.from)} ${first.message ? '-->' : '->'} ${name(first.to)}`)}: ${scalar(first.label)}`);
      continue;
    }
    let text = name(first.from);
    for (let l: FlowLink | undefined = first; l; ) {
      done.add(l);
      const fresh: boolean = !seen.has(l.to);
      seen.add(l.from).add(l.to);
      text += ` ${arrow(l)} ${name(l.to)}`;
      const next: FlowLink[] = fresh ? (from.get(l.to) ?? []).filter((x) => !done.has(x) && !x.message && (!x.label || inline(x.label))) : [];
      l = next.find((x) => finishes(x.to)) ?? next.find((x) => !seen.has(x.to)) ?? next[0];
    }
    items.push(`  - ${plain(text)}`);
  }
  out.push('', 'flow:', ...(items.length ? items : ['  []']));
  return out.join('\n') + '\n';
}
