// Mermaid stateDiagram / stateDiagram-v2 → states.
//
// States take their description as their name (`state "Waiting for payment" as wait`), [*] becomes
// start or end, `state X { … }` a composite state with its own start and end, <<choice>> a choice,
// and a note the note of its state. Fork and join bars have no shape here: they come in as states.
import { plain } from './process.ts';
import { cleanLabel, scalar, type Warnings } from './text.ts';

interface State {
  source: string;
  label?: string;
  kind?: 'choice';
  parent?: string;
  notes: string[];
}

export function importState(body: string[], title: string | undefined, warn: Warnings): string {
  const states = new Map<string, State>();
  const hops: { from: string; to: string; label?: string }[] = [];
  const stack: string[] = [];
  let direction: string | undefined;
  let noteFor: State | undefined;

  const state = (source: string): State => {
    let s = states.get(source);
    if (!s) states.set(source, (s = { source, notes: [] }));
    // Where it is first written inside a block is where it lives.
    if (!s.parent && stack.length && stack[stack.length - 1] !== source) s.parent = stack[stack.length - 1];
    return s;
  };
  const ref = (raw: string): string => {
    const id = raw.trim().replace(/:::[\w-]+$/, '');
    if (id !== '[*]') state(id);
    return id;
  };
  const open = (id: string) => {
    state(id);
    stack.push(id);
  };

  for (const raw of body) {
    const s = raw.trim();
    if (noteFor) {
      if (/^end note$/i.test(s)) noteFor = undefined;
      else if (s) noteFor.notes.push(cleanLabel(s));
      continue;
    }
    if (!s || /^(hide empty description|scale\b|accTitle|accDescr)/i.test(s)) continue;
    let m: RegExpExecArray | null;
    if ((m = /^direction\s+(\w+)$/i.exec(s))) {
      if (!stack.length) direction = m[1]!.toUpperCase();
      continue;
    }
    if (s === '--') {
      warn.onceFor('regions', 'Concurrent regions (--) are not kept apart: their states stand together in the composite state');
      continue;
    }
    if (s === '}') {
      if (!stack.pop()) warn.add('A "}" without a state was skipped');
      continue;
    }
    if (/^(classDef|class|style)\b/.test(s)) {
      warn.onceFor('style', `Styling (${s.split(/\s+/)[0]}) is not imported: Cartography colours by kind`);
      continue;
    }
    if ((m = /^note\s+(?:left|right)\s+of\s+([^:]+?)\s*(?::\s*(.*))?$/i.exec(s))) {
      const on = state(m[1]!);
      if (m[2] !== undefined) on.notes.push(cleanLabel(m[2]));
      else noteFor = on;
      continue;
    }
    // state "Description" as id, with or without a block.
    if ((m = /^state\s+"([^"]*)"\s+as\s+([^\s{]+)\s*(\{)?$/.exec(s))) {
      state(m[2]!).label = cleanLabel(m[1]!);
      if (m[3]) open(m[2]!);
      continue;
    }
    if ((m = /^state\s+([^\s{<]+)\s*<<(\w+)>>$/.exec(s))) {
      const st = state(m[1]!);
      if (m[2]!.toLowerCase() === 'choice') st.kind = 'choice';
      else warn.onceFor('fork', 'Fork and join bars are drawn as states: write the parallel work as states of their own');
      continue;
    }
    if ((m = /^state\s+([^\s{]+)\s*\{$/.exec(s))) {
      open(m[1]!);
      continue;
    }
    if ((m = /^state\s+([^\s{]+)$/.exec(s))) {
      state(m[1]!);
      continue;
    }
    if ((m = /^(.+?)\s*-->\s*([^:]+?)\s*(?::\s*(.*))?$/.exec(s))) {
      const [from, to] = [ref(m[1]!), ref(m[2]!)];
      if (from === '[*]' && to === '[*]') continue;
      hops.push({ from, to, ...(m[3]?.trim() ? { label: cleanLabel(m[3]) } : {}) });
      continue;
    }
    // id : description
    if ((m = /^([^\s:]+)\s*:\s*(.+)$/.exec(s))) {
      const st = state(m[1]!);
      st.label = st.label ? `${st.label} ${cleanLabel(m[2]!)}` : cleanLabel(m[2]!);
      continue;
    }
    if (/^[^\s:]+$/.test(s)) {
      state(s);
      continue;
    }
    warn.onceFor(`skip:${s}`, `Skipped: ${s}`);
  }
  if (stack.length) warn.add(`State "${stack[stack.length - 1]}" has no "}"`);

  // The name is what the state says; "start" and "end" are the pseudo-states here.
  const used = new Set<string>(['start', 'end']);
  const names = new Map<string, string>();
  for (const st of states.values()) {
    const base = (st.label ?? st.source).replace(/-+>/g, '→').replace(/\s+/g, ' ').trim() || st.source;
    let name = /^(start|end)$/i.test(base) ? `${base} state` : base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} ${i}`;
    used.add(name.toLowerCase());
    names.set(st.source, name);
  }
  const name = (source: string, pseudo: 'start' | 'end') => (source === '[*]' ? pseudo : names.get(source)!);

  const out = ['type: states'];
  if (title) out.push(`title: ${scalar(title)}`);
  // Written either way, as the source has it (Mermaid's own default is top to bottom).
  out.push(`direction: ${direction === 'LR' || direction === 'RL' ? 'right' : 'down'}`);
  if (direction === 'RL' || direction === 'BT') warn.onceFor('dir', `Direction ${direction} is drawn as ${direction === 'RL' ? 'LR' : 'TB'}: Cartography reads left to right or top to bottom`);

  // Under states: only what the transitions cannot say: what holds states, a choice, a note, a state nothing touches.
  const touched = new Set(hops.flatMap((h) => [h.from, h.to]));
  const kids = (parent: string | undefined) => [...states.values()].filter((st) => st.parent === parent);
  const lines: string[] = [];
  const emit = (st: State, indent: string) => {
    const inside = kids(st.source);
    const note = st.notes.join(' ');
    const key = `${indent}${plain(names.get(st.source)!)}:`;
    if (inside.length) {
      lines.push(key);
      if (note) lines.push(`${indent}  note: ${scalar(note)}`);
      lines.push(`${indent}  states:`);
      for (const k of inside) emit(k, indent + '    ');
    } else if (st.kind && note) lines.push(`${key} { kind: ${st.kind}, note: ${scalar(note)} }`);
    else if (st.kind) lines.push(`${key} ${st.kind}`);
    else if (note) lines.push(`${key} { note: ${scalar(note)} }`);
    else if (st.parent || !touched.has(st.source)) lines.push(key);
  };
  for (const st of kids(undefined)) emit(st, '  ');
  if (lines.length) out.push('', 'states:', ...lines);

  out.push('', 'transitions:');
  if (!hops.length) out.push('  []');
  for (const h of hops) {
    const arrow = plain(`${name(h.from, 'start')} -> ${name(h.to, 'end')}`);
    // A bare [guard] reads well and comes back as written; anything YAML would misread is quoted.
    const label = h.label === undefined ? undefined : /^\[[^[\]{},:#"']*\]$/.test(h.label) ? h.label : plain(h.label);
    out.push(`  - ${arrow}${label === undefined ? '' : `: ${label}`}`);
  }
  return out.join('\n') + '\n';
}
