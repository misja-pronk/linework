// A diagram as Mermaid text, for a README: GitHub draws Mermaid where it does not draw Cartography.
// Written from the diagram itself, not from its picture: Mermaid lays out on its own, so what is
// kept is what is in it (boxes, groups, lines, labels), never where it stands or how it looks.
//
//   graph types   flowchart, groups as subgraphs
//   erd           erDiagram
//   sequence      sequenceDiagram
//   gitflow       gitGraph
//   journey       journey
//   roadmap       gantt, or timeline when the roadmap names its periods instead of dates
//   class         classDiagram, packages as namespaces
//   mindmap       mindmap
import type { BlockShape, FlowShape, GitCommit, GitflowShape, Graph, GraphNode, JourneyShape, Marker, RoadmapShape, SequenceShape, TableShape } from '@cartography/core';

export type MermaidKind = 'flowchart' | 'stateDiagram-v2' | 'erDiagram' | 'sequenceDiagram' | 'gitGraph' | 'journey' | 'gantt' | 'timeline' | 'classDiagram' | 'mindmap';

export interface MermaidExport {
  kind: MermaidKind;
  text: string;
  /** What Mermaid has no place for, one line each. */
  warnings: string[];
}

/** One message per topic, however often it occurs. */
class Notes {
  list: string[] = [];
  private said = new Set<string>();
  once(message: string) {
    if (this.said.has(message)) return;
    this.said.add(message);
    this.list.push(message);
  }
}

// Words Mermaid reads as commands where an id may stand; an id that starts with one is respelled.
const FLOW_WORDS = ['end', 'default', 'graph', 'flowchart', 'subgraph', 'style', 'class', 'classdef', 'click', 'call', 'href', 'linkstyle', 'interpolate', 'direction'];
const SEQUENCE_WORDS = ['end', 'loop', 'alt', 'else', 'opt', 'par', 'and', 'rect', 'note', 'activate', 'deactivate', 'box', 'participant', 'actor', 'critical', 'option', 'break', 'title', 'autonumber', 'create', 'destroy', 'link', 'links', 'properties', 'details', 'over'];

/** Ids Mermaid can read, spelled the way the Mermaid importer spells them (letters, digits, - and _);
 *  ours, unless one would be read as a command; the same one each time. */
class Names {
  private byId = new Map<string, string>();
  private used = new Set<string>();
  constructor(private words: string[], private unsafe?: RegExp) {}
  of(id: string): string {
    let name = this.byId.get(id);
    if (name) return name;
    name = id.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
    const first = /^[A-Za-z0-9_]+/.exec(name)?.[0] ?? '';
    // "end-user" would close a subgraph: "end_user" does not.
    if (this.words.includes(first.toLowerCase())) name = first.length === name.length ? `${name}_` : `${first}_${name.slice(first.length + 1)}`;
    if (this.unsafe?.test(name)) name = name.replace(/-/g, '_');
    const base = name;
    for (let n = 2; this.used.has(name); n++) name = `${base}_${n}`;
    this.used.add(name);
    this.byId.set(id, name);
    return name;
  }
}

/** Text inside "…" in a flowchart or an erDiagram: Mermaid reads #35; and the like as the character. */
function quoted(text: string): string {
  const s = text
    .trim()
    .replace(/#/g, '#35;')
    .replace(/"/g, '#quot;')
    .replace(/</g, '#60;')
    .replace(/>/g, '#62;')
    .replace(/\|/g, '#124;')
    .replace(/`/g, '#96;')
    // "1. Step" is a Markdown list to some Mermaid versions, which then refuse to draw it.
    .replace(/^(\d+)\. /, '$1#46; ')
    .replace(/^([-*+]) /, (_, c: string) => `#${c.charCodeAt(0)}; `)
    .replace(/\s*\n\s*/g, '<br/>');
  return `"${s}"`;
}

/** Text that runs to the end of its line (a message, a note, a participant's name). */
const lineText = (text: string) => text.trim().replace(/#/g, '#35;').replace(/;/g, '#59;').replace(/</g, '#60;').replace(/>/g, '#62;').replace(/\s*\n\s*/g, '<br/>');

/** Text in a list Mermaid splits on colons and commas (journey, gantt, timeline): those are respelled. */
const plain = (text: string) => text.trim().replace(/\s*\n\s*/g, ' ').replace(/\s*:\s*/g, ' - ').replace(/[#;]/g, ' ').replace(/\s+/g, ' ').trim() || '-';

/** Text inside "…" where Mermaid knows no escapes (gitGraph). */
const bare = (text: string) => `"${text.trim().replace(/\s*\n\s*/g, ' ').replace(/"/g, "'")}"`;

/** The diagram's title as front matter, where the Mermaid type has no title line of its own. */
function front(title: string | undefined): string[] {
  if (!title) return [];
  const t = title.replace(/\s*\n\s*/g, ' ').replace(/"/g, "'");
  return ['---', `title: ${/^[A-Za-z0-9][A-Za-z0-9 ._()/-]*$/.test(t) ? t : `"${t}"`}`, '---'];
}

/** A rendered diagram (what `render` returns) as Mermaid text. */
export function toMermaid(d: { graph?: Graph; type?: { id: string } }): MermaidExport {
  const g = d.graph;
  const notes = new Notes();
  if (!g) return { kind: 'flowchart', text: 'flowchart LR\n', warnings: ['Nothing to export: the diagram could not be drawn'] };
  const sub = g.subtitle ? [`  %% ${g.subtitle.replace(/\s*\n\s*/g, ' ')}`] : [];
  const done = (kind: MermaidKind, lines: string[]): MermaidExport => ({ kind, text: lines.join('\n') + '\n', warnings: notes.list });
  for (const n of g.nodes) {
    const s = n.shape;
    if (s.kind === 'sequence') return done('sequenceDiagram', [...front(g.title), ...sequence(s, sub, notes)]);
    if (s.kind === 'gitflow') return done('gitGraph', [...front(g.title), ...gitGraph(s, sub, notes)]);
    if (s.kind === 'journey') return done('journey', journey(s, g.title, sub, notes));
    if (s.kind === 'roadmap') return s.scale === 0 ? done('timeline', timeline(s, g.title, sub, notes)) : done('gantt', gantt(s, g.title, sub, notes));
  }
  if (d.type?.id === 'erd') return done('erDiagram', [...front(g.title), ...er(g, sub, notes)]);
  if (d.type?.id === 'class') return done('classDiagram', [...front(g.title), ...classes(g, sub, notes)]);
  if (d.type?.id === 'mindmap') return done('mindmap', [...front(g.title), ...mindmap(g, sub, notes)]);
  if (d.type?.id === 'states') return done('stateDiagram-v2', [...front(g.title), ...states(g, sub, notes)]);
  return done('flowchart', [...front(g.title), ...flowchart(g, sub, notes)]);
}

/** The Mermaid text in a fenced block, ready to paste into a Markdown file. */
export const mermaidBlock = (text: string) => '```mermaid\n' + text + '```\n';

// Kinds drawn as a cylinder: Mermaid's one shape that says "data is kept here".
const STORES = /(^|[-_ ])(database|db|sql|warehouse|storage|store|bucket|disk|volume|cache|lake|registry)s?($|[-_ ])/;

function flowchart(g: Graph, sub: string[], notes: Notes): string[] {
  const out = [`flowchart ${g.direction === 'down' ? 'TD' : 'LR'}`, ...sub];
  const names = new Names(FLOW_WORDS);
  const groups = new Set(g.groups.map((x) => x.id));
  const written = new Set<string>();
  const walk = (parent: string | undefined, indent: string) => {
    for (const x of g.groups) {
      if ((x.parent && groups.has(x.parent) ? x.parent : undefined) !== parent) continue;
      out.push(`${indent}subgraph ${names.of(x.id)}[${quoted(x.label)}]`);
      written.add(x.id);
      walk(x.id, indent + '  ');
      out.push(`${indent}end`);
    }
    for (const n of g.nodes) {
      if ((n.parent && groups.has(n.parent) ? n.parent : undefined) !== parent) continue;
      const s = n.shape;
      if (s.kind === 'matrix') {
        notes.once('A matrix (who may do what) has no Mermaid form: left out');
        continue;
      }
      if (s.kind !== 'card' && s.kind !== 'table' && s.kind !== 'flow') continue;
      const id = names.of(n.id);
      written.add(n.id);
      if (s.kind === 'flow') {
        out.push(`${indent}${id}${flowNode(s)}`);
        continue;
      }
      if (s.kind === 'table') {
        notes.once('Tables are written as plain boxes: a flowchart has no rows');
        out.push(`${indent}${id}[${quoted(s.title)}]`);
        continue;
      }
      const text = quoted(s.label);
      // The outline says what Mermaid can say: a decision, a start or end, a person, a store.
      if (s.form === 'decision') out.push(`${indent}${id}{${text}}`);
      else if (s.form === 'terminal') out.push(`${indent}${id}([${text}])`);
      else if (s.form === 'person') out.push(`${indent}${id}(${text})`);
      else if (STORES.test(n.kind ?? '') || STORES.test(s.icon ?? '')) out.push(`${indent}${id}[(${text})]`);
      else out.push(`${indent}${id}[${text}]`);
    }
  };
  walk(undefined, '  ');
  for (const e of g.edges) {
    if (!written.has(e.from.node) || !written.has(e.to.node)) continue;
    const dashed = e.line !== 'solid';
    const thick = !dashed && (e.width ?? 1) > 1;
    const a = e.start !== 'none';
    const b = e.end !== 'none';
    // An arrow at the start only is the same line told from the other end.
    const [from, to] = a && !b ? [e.to.node, e.from.node] : [e.from.node, e.to.node];
    const link = a && b ? (dashed ? '<-.->' : thick ? '<==>' : '<-->') : a || b ? (dashed ? '-.->' : thick ? '==>' : '-->') : dashed ? '-.-' : thick ? '===' : '---';
    const label = [e.step !== undefined ? `(${e.step})` : '', e.label ?? ''].filter(Boolean).join(' ');
    out.push(`  ${names.of(from)} ${link}${label ? `|${quoted(label)}|` : ''} ${names.of(to)}`);
  }
  if (g.nodes.some((n) => n.shape.kind === 'card' && (n.shape.caption || n.shape.body))) notes.once('Captions, icons and colours are not written: Mermaid draws a box with its label');
  return out;
}

/** A process shape in the outline Mermaid has for it: an event a circle, a gateway a rhombus, a subprocess a framed box. */
function flowNode(s: FlowShape): string {
  // Mermaid wants words in every shape: an unnamed one is called by what it is.
  const unnamed = s.mark === 'end' || s.mark === 'final' ? 'end' : s.mark === 'start' || s.mark === 'initial' ? 'start' : s.mark === 'and' ? '+' : s.mark === 'or' ? 'o' : s.form === 'gateway' ? 'x' : s.form;
  const text = quoted(s.label || unnamed);
  if (s.form === 'event' || s.form === 'pseudo') return s.mark === 'end' || s.mark === 'final' ? `(((${text})))` : `((${text}))`;
  if (s.form === 'gateway') return `{${text}}`;
  if (s.form === 'subprocess') return `[[${text}]]`;
  if (s.form === 'document') return `[/${text}/]`;
  if (s.form === 'note') return `>${text}]`;
  if (s.form === 'state') return `(${text})`;
  return `[${text}]`;
}

const STATE_WORDS = ['end', 'state', 'note', 'direction', 'classdef', 'class', 'style', 'as', 'left', 'right', 'of', 'over', 'scale', 'hide', 'title'];

/**
 * A state machine as a stateDiagram: composite states as blocks, start and end as [*] of the block
 * they stand in, a choice as <<choice>>, entry / exit / do lines as the state's description, a note
 * as the note of the state it hangs on. Every transition is written in the innermost block that
 * holds both ends, so [*] means the right start or end.
 */
function states(g: Graph, sub: string[], notes: Notes): string[] {
  const out = ['stateDiagram-v2', ...(g.direction === 'right' ? ['  direction LR'] : []), ...sub];
  const names = new Names(STATE_WORDS, /-/);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const groups = new Map(g.groups.map((x) => [x.id, x]));
  const flow = (n: GraphNode | undefined) => (n?.shape.kind === 'flow' ? n.shape : undefined);
  const ends = (id: string) => {
    const s = flow(byId.get(id));
    return s?.form === 'pseudo' && (s.mark === 'initial' || s.mark === 'final' || !s.mark);
  };
  const ref = (id: string) => (ends(id) ? '[*]' : names.of(id));
  const parentOf = (id: string) => byId.get(id)?.parent ?? groups.get(id)?.parent;
  const chain = (id: string | undefined) => {
    const up: (string | undefined)[] = [];
    for (let at = id; at; at = groups.get(at)?.parent) up.push(at);
    return [...up, undefined];
  };
  // The block a transition is written in: the innermost one holding both ends (a group end counts as standing beside its block).
  const scope = (a: string, b: string) => {
    const pa = chain(parentOf(a));
    const pb = new Set(chain(parentOf(b)));
    return pa.find((x) => pb.has(x));
  };
  const attached = new Map<string, string>();
  for (const e of g.edges) {
    const s = flow(byId.get(e.from.node));
    if (s?.form === 'note' && !attached.has(e.from.node)) attached.set(e.from.node, e.to.node);
  }
  const walk = (parent: string | undefined, indent: string) => {
    // Notes last in their block: Mermaid wants the state a note hangs on to be known first.
    const later: string[] = [];
    for (const x of g.groups) {
      if (x.parent !== parent) continue;
      out.push(`${indent}state ${quoted(x.label).replace(/#quot;/g, "'")} as ${names.of(x.id)} {`);
      walk(x.id, indent + '  ');
      out.push(`${indent}}`);
    }
    for (const n of g.nodes) {
      if (n.parent !== parent) continue;
      const s = flow(n);
      if (!s || ends(n.id)) continue;
      if (s.form === 'note') {
        const to = attached.get(n.id);
        if (to) later.push(`${indent}note right of ${ref(to)} : ${lineText(s.label)}`);
        else notes.once('A note that hangs on no state is left out');
        continue;
      }
      const id = names.of(n.id);
      if (s.form === 'pseudo' && s.mark === 'choice') out.push(`${indent}state ${id} <<choice>>`);
      else if (s.form === 'pseudo' && s.mark === 'history') notes.once('A history state has no Mermaid form: written as a plain state');
      if (!(s.form === 'pseudo' && s.mark === 'choice') && s.label && (s.label !== id || s.lines?.length)) out.push(`${indent}state ${quoted(s.label).replace(/#quot;/g, "'")} as ${id}`);
      for (const l of s.lines ?? []) out.push(`${indent}${id} : ${lineText(l)}`);
    }
    for (const e of g.edges) {
      if (flow(byId.get(e.from.node))?.form === 'note') continue;
      if (scope(e.from.node, e.to.node) !== parent) continue;
      out.push(`${indent}${ref(e.from.node)} --> ${ref(e.to.node)}${e.label ? ` : ${lineText(e.label)}` : ''}`);
    }
    out.push(...later);
  };
  walk(undefined, '  ');
  return out;
}

// A crow's foot as Mermaid writes it at the left and at the right of a relation.
const LEFT: Record<Marker, string> = { none: '||', arrow: '||', one: '||', zeroOrOne: '|o', many: '}o', zeroOrMany: '}o', oneOrMany: '}|', slash: '||', triangle: '||', diamond: '||', filledDiamond: '||', open: '||' };
const RIGHT: Record<Marker, string> = { none: '||', arrow: '||', one: '||', zeroOrOne: 'o|', many: 'o{', zeroOrMany: 'o{', oneOrMany: '|{', slash: '||', triangle: '||', diamond: '||', filledDiamond: '||', open: '||' };

/** A column type or name as one Mermaid word. */
const word = (s: string) => {
  const w = s.trim().replace(/\s*,\s*/g, ',').replace(/[^A-Za-z0-9_()[\],-]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[A-Za-z_]/.test(w) ? w : `_${w}`;
};

function er(g: Graph, sub: string[], notes: Notes): string[] {
  const out = ['erDiagram', ...sub];
  const names = new Names([]);
  const tables = g.nodes.filter((n): n is typeof n & { shape: TableShape } => n.shape.kind === 'table');
  if (g.groups.length) notes.once('Schemas are not written: an erDiagram has no groups');
  for (const n of tables) {
    const id = names.of(n.id);
    const rows = n.shape.rows.filter((r) => r.kind === 'row');
    out.push(`  ${id}${n.shape.title !== n.id ? `[${quoted(n.shape.title)}]` : ''} {`);
    for (const r of rows) {
      if (r.kind !== 'row') continue;
      const [name, type] = r.cells;
      const marks = r.marks ?? [];
      const keys = [marks.includes('pk') && 'PK', marks.includes('fk') && 'FK', marks.includes('unique') && 'UK'].filter(Boolean).join(', ');
      const said = [marks.includes('null') && 'nullable', marks.includes('pii') && 'personal data'].filter(Boolean).join(', ');
      out.push(`    ${word(type?.text || 'value')} ${word(name?.text || r.id)}${keys ? ` ${keys}` : ''}${said ? ` "${said}"` : ''}`);
    }
    out.push('  }');
  }
  const known = new Set(tables.map((n) => n.id));
  for (const e of g.edges) {
    if (!known.has(e.from.node) || !known.has(e.to.node)) continue;
    const from = names.of(e.from.node);
    const to = names.of(e.to.node);
    out.push(`  ${from} ${LEFT[e.start]}${e.line === 'solid' ? '--' : '..'}${RIGHT[e.end]} ${to} : ${quoted(e.label ?? '')}`);
  }
  return out;
}

// A UML end as Mermaid writes it at the left and at the right of a relation.
const UML_LEFT: Partial<Record<Marker, string>> = { triangle: '<|', filledDiamond: '*', diamond: 'o', open: '<', arrow: '<' };
const UML_RIGHT: Partial<Record<Marker, string>> = { triangle: '|>', filledDiamond: '*', diamond: 'o', open: '>', arrow: '>' };
/** A multiplicity rather than a role name: 1, 0..*, *, many. */
const MULT = /^([\d*n]+(\.\.[\d*n]+)?|many)$/;

function classes(g: Graph, sub: string[], notes: Notes): string[] {
  const out = ['classDiagram', ...sub];
  if (g.direction === 'right') out.push('  direction LR');
  const names = new Names(['class', 'namespace', 'note', 'direction', 'end']);
  const boxes = g.nodes.filter((n): n is typeof n & { shape: TableShape } => n.shape.kind === 'table');
  const write = (n: (typeof boxes)[number], indent: string) => {
    const s = n.shape;
    const generic = /<(.+)>$/.exec(s.title)?.[1];
    const id = names.of(n.id);
    const label = s.title.replace(/<.+>$/, '');
    out.push(`${indent}class ${id}${generic ? `~${generic.replace(/[<>]/g, '~')}~` : ''}${label !== n.id ? `["${label.replace(/"/g, "'")}"]` : ''} {`);
    for (const st of s.caption?.match(/«([^»]+)»/g) ?? []) out.push(`${indent}  <<${st.slice(1, -1)}>>`);
    for (const r of s.rows) {
      if (r.kind !== 'row') continue;
      const [name, type] = r.cells;
      const text = (name?.text ?? '').replace(/</g, '~').replace(/>/g, '~');
      const flag = name?.underline ? '$' : name?.italic ? '*' : '';
      const t = (type?.text ?? '').replace(/</g, '~').replace(/>/g, '~');
      // A method's result after its brackets, an attribute as "name: Type".
      out.push(`${indent}  ${r.sign ?? ''}${text.endsWith(')') ? `${text}${flag}${t ? ` ${t}` : ''}` : `${text}${t ? `: ${t}` : ''}${flag}`}`);
    }
    out.push(`${indent}}`);
  };
  // Mermaid's namespaces do not nest: a package inside another is written at the top.
  for (const p of g.groups) {
    const inside = boxes.filter((n) => n.parent === p.id);
    if (!inside.length) continue;
    out.push(`  namespace ${names.of(p.id)} {`);
    for (const n of inside) write(n, '    ');
    out.push('  }');
  }
  if (g.groups.some((p) => p.parent)) notes.once('Packages inside packages are written side by side: Mermaid namespaces do not nest');
  for (const n of boxes) if (!n.parent || !g.groups.some((p) => p.id === n.parent)) write(n, '  ');
  const known = new Set(boxes.map((n) => n.id));
  for (const e of g.edges) {
    if (!known.has(e.from.node) || !known.has(e.to.node)) continue;
    const mult = (tags?: string[]) => tags?.find((t) => MULT.test(t));
    const [a, b] = [mult(e.ends?.from), mult(e.ends?.to)];
    if ([...(e.ends?.from ?? []), ...(e.ends?.to ?? [])].some((t) => !MULT.test(t))) notes.once('Role names at the ends of a relation are not written: Mermaid has room for multiplicities only');
    const arrow = `${UML_LEFT[e.start] ?? ''}${e.line === 'solid' ? '--' : '..'}${UML_RIGHT[e.end] ?? ''}`;
    out.push(`  ${names.of(e.from.node)}${a ? ` "${a}"` : ''} ${arrow}${b ? ` "${b}"` : ''} ${names.of(e.to.node)}${e.label ? ` : ${lineText(e.label)}` : ''}`);
  }
  return out;
}

/** A mind map from its centre out, one indent per level; Mermaid draws its own colours. */
function mindmap(g: Graph, sub: string[], notes: Notes): string[] {
  const out = ['mindmap', ...sub];
  const shape = (id: string) => g.nodes.find((n) => n.id === id)?.shape as BlockShape | undefined;
  const centre = g.nodes.find((n) => n.shape.kind === 'block' && n.shape.level === 0);
  if (!centre) return out;
  // Brackets would be read as a node's shape.
  const text = (s: string) => s.replace(/[()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim() || '-';
  const walk = (id: string, indent: string) => {
    const s = shape(id);
    if (!s) return;
    out.push(`${indent}${id === centre.id ? `root((${text(s.label)}))` : text(s.label)}`);
    if (s.caption || s.icon) notes.once('Notes and icons on topics are not written');
    for (const e of g.edges) if (e.from.node === id) walk(e.to.node, `${indent}  `);
  };
  walk(centre.id, '  ');
  return out;
}

const ARROWS = { sync: '->>', async: '-)', reply: '-->>', lost: '-x' } as const;

function sequence(s: SequenceShape, sub: string[], notes: Notes): string[] {
  const out = ['sequenceDiagram', ...sub];
  // A name with "-x" or "--" in it would be read as an arrow.
  const names = new Names(SEQUENCE_WORDS, /-x|--|-$/);
  if (s.events.some((e) => e.kind === 'message' && e.number !== undefined)) out.push('  autonumber');
  let box: string | undefined;
  for (const p of s.participants) {
    if (p.box !== box) {
      if (box) out.push('  end');
      box = p.box;
      // "transparent" first, or a label that starts with a colour ("Blue team") is read as that colour.
      if (box) out.push(`  box transparent ${lineText(s.boxes.find((b) => b.id === box)?.label ?? box)}`);
    }
    const id = names.of(p.id);
    const person = p.icon === 'user' || p.icon === 'users' || p.icon === 'person';
    out.push(`  ${box ? '  ' : ''}${person ? 'actor' : 'participant'} ${id}${p.label !== id ? ` as ${lineText(p.label)}` : ''}`);
  }
  if (box) out.push('  end');
  if (s.participants.some((p) => p.caption)) notes.once('Participant captions and icons are not written');

  const first = s.participants[0]?.id;
  const last = s.participants.at(-1)?.id;
  const over = (ids: string[]) => {
    const order = s.participants.map((p) => p.id);
    const at = (ids.length ? ids : [first, last]).filter((x): x is string => !!x && order.includes(x)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const [a, b] = [at[0], at.at(-1)];
    return a && b && a !== b ? `${names.of(a)},${names.of(b)}` : a ? names.of(a) : '';
  };
  // Mermaid refuses to close an activation that is not open: count them.
  const active = new Map<string, number>();
  const open = (lane: string) => active.set(lane, (active.get(lane) ?? 0) + 1);
  const close = (lane: string) => {
    const n = active.get(lane) ?? 0;
    if (n > 0) active.set(lane, n - 1);
    return n > 0;
  };
  const frames: string[] = [];
  for (const e of s.events) {
    const indent = '  '.repeat(frames.length + 1);
    if (e.kind === 'message') {
      const minus = e.closes && close(e.from) ? '-' : '';
      if (e.opens) open(e.to);
      out.push(`${indent}${names.of(e.from)}${ARROWS[e.arrow]}${e.opens ? '+' : minus}${names.of(e.to)}: ${lineText(e.label ?? '') || ' '}`.trimEnd());
      // A message that opens and closes at once: Mermaid takes one mark, the close follows.
      if (e.opens && minus) out.push(`${indent}deactivate ${names.of(e.from)}`);
    } else if (e.kind === 'note') {
      const where = e.side === 'over' ? `over ${over(e.over)}` : `${e.side} of ${names.of(e.over[0] ?? first ?? '')}`;
      out.push(`${indent}Note ${where}: ${lineText(e.text)}`);
    } else if (e.kind === 'divider') {
      notes.once('Dividers are written as notes across the diagram');
      if (first) out.push(`${indent}Note over ${over([])}: ${lineText(e.label)}`);
    } else if (e.kind === 'ref') {
      notes.once('References to other diagrams are written as notes');
      if (first) out.push(`${indent}Note over ${over(e.over)}: ${lineText(`See: ${e.label}`)}`);
    } else if (e.kind === 'activate') {
      open(e.lane);
      out.push(`${indent}activate ${names.of(e.lane)}`);
    } else if (e.kind === 'deactivate') {
      if (close(e.lane)) out.push(`${indent}deactivate ${names.of(e.lane)}`);
    } else if (e.kind === 'frame') {
      if (e.frame === 'group') {
        // Mermaid's plain frame is a tinted rectangle without a name.
        if (e.label) notes.once('Group frames are written as rect: their labels are not kept');
        out.push(`${indent}rect rgba(128, 128, 128, 0.1)`);
      } else out.push(`${indent}${e.frame}${e.label ? ` ${lineText(e.label)}` : ''}`);
      frames.push(e.frame);
    } else if (e.kind === 'branch') {
      const frame = frames.at(-1);
      const key = frame === 'alt' ? 'else' : frame === 'par' ? 'and' : frame === 'critical' ? 'option' : undefined;
      if (key) out.push(`${'  '.repeat(frames.length)}${key}${e.label ? ` ${lineText(e.label)}` : ''}`);
      else notes.once(`A second branch in a ${frame ?? 'frame'} frame is written into the first: Mermaid has none there`);
    } else if (e.kind === 'end') {
      if (frames.pop()) out.push(`${'  '.repeat(frames.length + 1)}end`);
    }
  }
  while (frames.pop()) out.push(`${'  '.repeat(frames.length + 1)}end`);
  return out;
}

function gitGraph(s: GitflowShape, sub: string[], notes: Notes): string[] {
  const byId = new Map(s.commits.map((c) => [c.id, c]));
  const trunk = s.commits[0]?.branch ?? s.branches[0]?.name ?? 'main';
  const out: string[] = [];
  // Mermaid starts on "main"; a trunk of another name is said first.
  if (trunk !== 'main') out.push(`%%{init: { "gitGraph": { "mainBranchName": ${JSON.stringify(trunk)} } } }%%`);
  out.push('gitGraph', ...sub);
  const branch = (name: string) => (/^[A-Za-z][A-Za-z0-9_]*$/.test(name) && !['branch', 'commit', 'merge', 'checkout', 'switch', 'order', 'tag', 'type', 'id', 'msg'].includes(name) ? name : bare(name));
  const order = new Map(s.branches.map((b, i) => [b.name, i]));

  // A commit shows its id in Mermaid, so the label is the id; two of one name get a number.
  const picked = new Set(s.commits.map((c) => c.pick).filter(Boolean));
  const ids = new Map<string, string>();
  const used = new Set<string>();
  for (const c of s.commits) {
    const text = c.label ?? (c.count ? `${c.count} commits` : picked.has(c.id) ? c.id : undefined);
    if (!text) continue;
    let id = text.trim().replace(/\s*\n\s*/g, ' ').replace(/"/g, "'");
    for (let n = 2; used.has(id); n++) id = `${text} (${n})`;
    used.add(id);
    ids.set(c.id, id);
  }
  const fields = (c: GitCommit) => `${ids.has(c.id) ? ` id: "${ids.get(c.id)}"` : ''}${c.tags.length ? ` tag: ${bare(c.tags.join(', '))}` : ''}`;

  const created = new Set([trunk]);
  const head = new Map<string, string>();
  let current = trunk;
  const checkout = (name: string) => {
    if (current !== name) out.push(`  checkout ${branch(name)}`);
    current = name;
  };
  for (const c of s.commits) {
    if (!created.has(c.branch)) {
      const from = (c.fork && byId.get(c.fork)?.branch) || trunk;
      checkout(created.has(from) ? from : trunk);
      out.push(`  branch ${branch(c.branch)}${order.has(c.branch) ? ` order: ${order.get(c.branch)}` : ''}`);
      created.add(c.branch);
      current = c.branch;
      const at = head.get(from);
      if (at) head.set(c.branch, at);
    } else checkout(c.branch);
    const other = c.merge ? byId.get(c.merge)?.branch : undefined;
    const source = c.pick ? byId.get(c.pick) : undefined;
    // Mermaid refuses a merge of a branch with nothing new on it, and a pick of what is already here.
    if (other && other !== c.branch && created.has(other) && head.get(other) !== head.get(c.branch)) out.push(`  merge ${branch(other)}${fields(c)}`);
    else if (source && ids.has(source.id) && source.branch !== c.branch && !source.merge && head.has(c.branch)) out.push(`  cherry-pick id: "${ids.get(source.id)}"${c.tags.length ? ` tag: ${bare(c.tags.join(', '))}` : ''}`);
    else out.push(`  commit${fields(c)}`);
    head.set(c.branch, c.id);
  }
  if (s.commits.some((c) => c.deploy.length) || s.environments.length) notes.once('Deployments and environments are not written: a gitGraph has none');
  if (s.commits.some((c) => c.notes.length)) notes.once('Notes on commits are not written');
  if (s.view === 'delivery' || s.pipelines.length) notes.once('The delivery pipeline is not written: only the branches and their commits');
  return out;
}

function journey(s: JourneyShape, title: string | undefined, sub: string[], notes: Notes): string[] {
  const out = ['journey', ...(title ? [`  title ${plain(title)}`] : []), ...sub];
  // Mermaid scores run from 1 to 5.
  const span = s.scale.max - s.scale.min;
  const score = (v: number | undefined) => (v === undefined || span <= 0 ? 3 : Math.max(1, Math.min(5, Math.round(1 + (4 * (v - s.scale.min)) / span))));
  const who = (names: string[]) => names.map((n) => plain(n).replace(/,/g, ' ')).filter((n) => n !== '-');
  let phase: string | undefined;
  for (const step of s.steps) {
    if (step.phase !== phase) {
      phase = step.phase;
      out.push(`  section ${plain(s.phases.find((p) => p.id === phase)?.label ?? phase)}`);
    }
    if (step.score === undefined) notes.once('Steps without a feeling get the middle score: Mermaid wants one for every step');
    const actors = who([...(s.persona ? [s.persona.name] : []), ...step.actors]);
    out.push(`    ${plain(step.label)}: ${score(step.score)}${actors.length ? `: ${actors.join(', ')}` : ''}`);
  }
  if (s.steps.some((x) => x.thought || x.says || x.touchpoints.length || x.pains.length || x.gains.length || x.ideas.length || x.metrics.length || x.frontstage.length || x.backstage.length || x.support.length))
    notes.once('Thoughts, touchpoints, pains, gains, ideas and the blueprint rows are not written: a Mermaid journey has steps, scores and who takes part');
  if (s.future) notes.once(`Only "${s.label}" is written; the journey it is compared with ("${s.future.label}") is not`);
  return out;
}

const DAY = 86_400_000;
const iso = (days: number) => new Date(Math.round(days) * DAY).toISOString().slice(0, 10);

function gantt(s: RoadmapShape, title: string | undefined, sub: string[], notes: Notes): string[] {
  const out = ['gantt', ...(title ? [`  title ${plain(title)}`] : []), '  dateFormat YYYY-MM-DD', ...sub];
  const names = new Names([]);
  const byId = new Map(s.items.map((i) => [i.id, i]));
  const id = (x: string) => names.of(x);
  const lanes: (string | undefined)[] = [undefined, ...s.lanes.map((l) => l.id)];
  const known = new Set(s.lanes.map((l) => l.id));
  // A task may only wait for one written above it.
  const written = new Set<string>();
  for (const lane of lanes) {
    const items = s.items.filter((i) => (i.lane && known.has(i.lane) ? i.lane : undefined) === lane);
    if (!items.length) continue;
    if (lane) out.push(`  section ${plain(s.lanes.find((l) => l.id === lane)!.label)}`);
    for (const i of items) {
      const tags = [i.status === 'done' ? 'done' : i.status === 'active' ? 'active' : i.status === 'at-risk' || i.status === 'late' ? 'crit' : '', i.milestone ? 'milestone' : ''].filter(Boolean);
      const waits = i.after.filter((a) => byId.has(a));
      // "after" where the item starts right when what it waits for ends; a date where it starts later.
      const ends = waits.map((a) => byId.get(a)!.end);
      const follows = waits.length > 0 && waits.every((a) => written.has(a)) && Math.max(...ends) === i.start;
      if (waits.length && !follows) notes.once('An item that starts later than what it waits for is written with its date: the dependency is not kept');
      const start = follows ? `after ${waits.map(id).join(' ')}` : iso(i.start);
      const end = i.milestone ? '0d' : follows ? `${Math.max(1, Math.round(i.end - i.start))}d` : iso(Math.max(i.end, i.start + 1));
      out.push(`  ${lane ? '  ' : ''}${plain(i.label)} :${[...tags, id(i.id), start, end].join(', ')}`);
      written.add(i.id);
    }
  }
  if (s.phases.length) notes.once('Phases (the bands behind the items) are not written: a gantt has none');
  if (s.items.some((i) => i.progress !== undefined)) notes.once('Progress is not written: a gantt task is done, active or neither');
  return out;
}

/** A roadmap of named periods (Now, Next, Later): Mermaid's gantt wants dates, its timeline does not. */
function timeline(s: RoadmapShape, title: string | undefined, sub: string[], notes: Notes): string[] {
  const out = ['timeline', ...(title ? [`  title ${plain(title)}`] : []), ...sub];
  // Phases become sections where they cover the periods one after another without overlap.
  const phaseOf = (i: number) => s.phases.filter((p) => p.start <= i && i < p.end);
  const sections = s.phases.length > 0 && s.ticks.every((_, i) => phaseOf(i).length === 1);
  if (s.phases.length && !sections) notes.once('Phases are not written: they do not split the periods into sections');
  let phase: string | undefined;
  for (const [i, tick] of s.ticks.entries()) {
    if (sections && phaseOf(i)[0]!.label !== phase) {
      phase = phaseOf(i)[0]!.label;
      out.push(`  section ${plain(phase)}`);
    }
    const items = s.items.filter((x) => Math.floor(x.start) === i);
    out.push(`  ${sections ? '  ' : ''}${[plain(tick.label), ...items.map((x) => plain(x.label))].join(' : ')}`);
    if (items.some((x) => x.end - x.start > 1)) notes.once('An item that spans several periods is written in the one it starts in');
  }
  if (s.lanes.length) notes.once('Lanes are not written: a timeline has periods and what happens in them');
  if (s.items.some((x) => x.after.length)) notes.once('Dependencies between items are not written');
  return out;
}
