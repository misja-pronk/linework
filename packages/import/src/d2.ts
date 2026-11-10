// D2 → systems (or cloud), erd and sequence. An own parser for the part of D2 people write: shapes
// and labels, containers (nested blocks and dot paths a.b.c), connections (->, <-, <->, --, chains,
// labels), shape: person/cylinder/queue/cloud/sql_table/class/sequence_diagram, icon:, near:,
// direction:, vars, comments and block strings. Styles, classes, sizes and grids are read and left out.
//
// One D2 file can become several diagrams: the boxes and lines (systems, or cloud when the icons or
// group names say AWS, Google Cloud or Azure), its sql_tables as an erd, each sequence_diagram as a
// sequence. Steps become `steps:` that build the drawing up, scenarios become `views:`, and every
// layer is a diagram of its own.
import { guessGroupKind, guessKind, systemsYaml, type SysEdge, type SysGroup, type SysNode } from './systems.ts';
import { participantKind, sequenceYaml, type Participant, type Step } from './sequence.ts';
import { Ids, scalar, slug, Warnings } from './text.ts';

// ---------------------------------------------------------------- syntax

type Entry =
  | { type: 'key'; path: string[]; value?: Value; block?: Entry[]; line: number }
  | { type: 'edge'; ends: string[][]; ops: string[]; value?: Value; block?: Entry[]; line: number }
  | { type: 'skip'; what: 'ref' | 'import' | 'spread'; line: number };

/** A value after the colon: text (block strings keep their tag), a list, or null. */
type Value = { text: string; tag?: string } | { list: string[] } | { nul: true };

const ARROW = /^(<-+>|<-+|-+>|--+)/;

class Parser {
  i = 0;
  line = 1;
  constructor(private s: string) {}
  private peek(n = 0) {
    return this.s[this.i + n] ?? '';
  }
  private next() {
    const c = this.s[this.i++] ?? '';
    if (c === '\n') this.line++;
    return c;
  }
  private rest() {
    return this.s.slice(this.i);
  }
  /** Spaces and tabs only. */
  private inline() {
    while (this.peek() === ' ' || this.peek() === '\t') this.next();
  }
  /** Spaces, newlines, `;` and comments: what separates statements. */
  private gap() {
    for (;;) {
      const c = this.peek();
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ';') this.next();
      else if (this.rest().startsWith('"""')) {
        this.i += 3;
        const end = this.s.indexOf('"""', this.i);
        const stop = end < 0 ? this.s.length : end + 3;
        while (this.i < stop) this.next();
      } else if (c === '#') while (this.i < this.s.length && this.peek() !== '\n') this.next();
      else return;
    }
  }
  private quoted(): string {
    const q = this.next();
    let out = '';
    while (this.i < this.s.length && this.peek() !== q) {
      const c = this.next();
      if (c === '\\' && this.i < this.s.length) {
        const e = this.next();
        out += e === 'n' ? '\n' : e;
      } else out += c;
    }
    this.next();
    return out;
  }
  /** One key of a path: quoted, or bare up to a dot, colon, brace, arrow or the end of the line. */
  private segment(): string {
    this.inline();
    if (this.peek() === '"' || this.peek() === "'") return this.quoted();
    let out = '';
    while (this.i < this.s.length) {
      const c = this.peek();
      if (c === '$' && this.peek(1) === '{') {
        out += this.variable();
        continue;
      }
      if ('.:;{}\n[]'.includes(c) || ARROW.test(this.rest()) || (c === '#' && /\s$/.test(out))) break;
      out += this.next();
    }
    return out.trim();
  }
  /** ${name}: kept as written, filled in when the value is used. */
  private variable(): string {
    let out = '';
    while (this.i < this.s.length && this.peek() !== '}' && this.peek() !== '\n') out += this.next();
    return out + (this.peek() === '}' ? this.next() : '');
  }
  private path(): string[] {
    const out = [this.segment()];
    while (this.peek() === '.' && !this.rest().startsWith('...')) {
      this.next();
      out.push(this.segment());
    }
    return out;
  }
  /** |md …|, ||…||, |`lang …`|: the text between the pipes, and the tag (md, latex, a language). */
  private blockString(): Value {
    let pipes = '';
    while (this.peek() === '|') pipes += this.next();
    let tick = '';
    if (this.peek() === '`') tick = this.next();
    const tag = /^[\w-]*/.exec(this.rest())![0];
    this.i += tag.length;
    const close = tick + pipes;
    const end = this.s.indexOf(close, this.i);
    const stop = end < 0 ? this.s.length : end;
    let text = '';
    while (this.i < stop) text += this.next();
    this.i = Math.min(this.s.length, stop + close.length);
    return { text: dedent(text), tag: tag || 'md' };
  }
  private value(): Value | undefined {
    this.inline();
    const c = this.peek();
    if (c === '{' || c === '\n' || c === ';' || c === '}' || c === '') return undefined;
    if (c === '"' || c === "'") return { text: this.quoted() };
    if (c === '|') return this.blockString();
    if (c === '[') {
      this.next();
      let raw = '';
      while (this.i < this.s.length && this.peek() !== ']') raw += this.next();
      this.next();
      return { list: raw.split(/[;,]/).map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean) };
    }
    let raw = '';
    while (this.i < this.s.length && !'{};\n'.includes(this.peek()) && !(this.peek() === '#' && /\s$/.test(raw))) raw += this.peek() === '$' && this.peek(1) === '{' ? this.variable() : this.next();
    raw = raw.trim();
    return raw === 'null' ? { nul: true } : { text: raw };
  }
  private block(): Entry[] | undefined {
    this.inline();
    if (this.peek() !== '{') return undefined;
    this.next();
    return this.map(true);
  }
  /** Statements up to the closing brace (or the end). */
  map(nested = false): Entry[] {
    const out: Entry[] = [];
    for (;;) {
      this.gap();
      if (this.i >= this.s.length) return out;
      if (this.peek() === '}') {
        this.next();
        if (nested) return out;
        continue;
      }
      const line = this.line;
      if (this.rest().startsWith('...')) {
        this.i += 3;
        const what = this.peek() === '@' ? 'import' : 'spread';
        while (this.i < this.s.length && !'\n;}'.includes(this.peek())) this.next();
        out.push({ type: 'skip', what, line });
        continue;
      }
      if (this.peek() === '(') {
        // (a -> b)[0].style: … — a reference to a connection made earlier.
        for (let depth = 0; this.i < this.s.length; ) {
          const c = this.next();
          if (c === '(') depth++;
          else if (c === ')' && --depth === 0) break;
        }
        while (this.i < this.s.length && !':{\n;'.includes(this.peek())) this.next();
        if (this.peek() === ':') (this.next(), this.value());
        this.block();
        out.push({ type: 'skip', what: 'ref', line });
        continue;
      }
      const start = this.i;
      const first = this.path();
      this.inline();
      const ends = [first];
      const ops: string[] = [];
      for (let m = ARROW.exec(this.rest()); m; m = ARROW.exec(this.rest())) {
        this.i += m[0].length;
        ops.push(m[0]);
        ends.push(this.path());
        this.inline();
      }
      let value: Value | undefined;
      if (this.peek() === ':') {
        this.next();
        value = this.value();
      }
      const block = this.block();
      if (this.i === start) {
        // Nothing could be read here: step over the character, so the parser always moves on.
        this.next();
        continue;
      }
      if (ops.length) out.push({ type: 'edge', ends, ops, value, block, line });
      else if (first.some(Boolean)) out.push({ type: 'key', path: first, value, block, line });
    }
  }
}

function dedent(text: string): string {
  const lines = text.replace(/^\n/, '').replace(/\s+$/, '').split('\n');
  const pad = Math.min(...lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length));
  return lines.map((l) => l.slice(Number.isFinite(pad) ? pad : 0)).join('\n');
}

export function parseD2(text: string): Entry[] {
  return new Parser(text.replace(/\r\n?/g, '\n')).map();
}

// ---------------------------------------------------------------- meaning

/** Keys that say something about the object they are on, not objects of their own. */
const RESERVED = new Set([
  'shape', 'label', 'icon', 'style', 'near', 'direction', 'tooltip', 'link', 'width', 'height', 'constraint', 'class', 'classes', 'vars',
  'layers', 'scenarios', 'steps', 'grid-rows', 'grid-columns', 'grid-gap', 'horizontal-gap', 'vertical-gap', 'top', 'left',
  'source-arrowhead', 'target-arrowhead', 'filled', 'multiple', 'opacity', 'stroke', 'fill', 'stroke-dash', 'stroke-width', 'animated', 'font-size', 'font-color', 'bold', 'italic', 'underline', '3d', 'shadow', 'double-border', 'border-radius', 'text-transform',
]);

interface Obj {
  path: string;
  key: string;
  parent?: Obj;
  label?: string;
  /** The label is markdown or code. */
  tag?: string;
  shape?: string;
  icon?: string;
  near?: string;
  constraint: string[];
  children: Map<string, Obj>;
  order: number;
}

interface Edge {
  from: Obj;
  to: Obj;
  op: '->' | '<->' | '--';
  label?: string;
  dashed: boolean;
  /** The object whose block the connection was written in. */
  scope: Obj;
  order: number;
}

interface Board {
  root: Obj;
  edges: Edge[];
  direction?: string;
}

const isSeq = (o: Obj | undefined) => o?.shape === 'sequence_diagram';
const textOf = (v: Value | undefined) => (v && 'text' in v ? v.text : undefined);

class Reader {
  order = 0;
  vars: Record<string, string> = {};
  constructor(private warn: Warnings) {}

  sub(s: string): string {
    return s.replace(/\$\{([\w.-]+)\}/g, (m, name: string) => {
      if (name in this.vars) return this.vars[name]!;
      this.warn.onceFor(`var:${name}`, `The variable \${${name}} is not set: it is kept as written`);
      return m;
    });
  }

  board(): Board {
    return { root: { path: '', key: '', constraint: [], children: new Map(), order: 0 }, edges: [] };
  }

  /** Collects vars (nested maps as a.b), before anything else is read. */
  readVars(entries: Entry[], prefix = '') {
    for (const e of entries) {
      if (e.type !== 'key') continue;
      if (!prefix && e.path[0] !== 'vars') continue;
      const path = prefix ? [...prefix.split('.').filter(Boolean), ...e.path] : e.path.slice(1);
      if (e.block) this.readVars(e.block, path.join('.') + '.');
      const t = textOf(e.value);
      if (t !== undefined && path.length) this.vars[path.join('.')] = t;
      if (!prefix && path.length === 0 && e.block) continue;
    }
  }

  ensure(b: Board, scope: Obj, path: string[]): Obj {
    let at = scope;
    for (const raw of path) {
      if (raw === '_') {
        at = at.parent ?? at;
        continue;
      }
      const key = this.sub(raw);
      let o = at.children.get(key);
      if (!o) at.children.set(key, (o = { path: at.path ? `${at.path}.${key}` : key, key, parent: at, constraint: [], children: new Map(), order: ++this.order }));
      at = o;
    }
    return at;
  }

  /** The object an end of a connection names. In a sequence diagram an actor's name means that actor, from inside any group. */
  end(b: Board, scope: Obj, path: string[], known = false): Obj {
    let seq: Obj | undefined;
    for (let o: Obj | undefined = scope; o; o = o.parent) if (isSeq(o)) seq = o;
    // A key in a group (not a connection) is the group's own unless an actor has that name.
    if (seq && seq !== scope && path[0] !== '_' && (!known || seq.children.has(this.sub(path[0]!)))) return this.ensure(b, seq, path);
    return this.ensure(b, scope, path);
  }

  remove(b: Board, o: Obj) {
    o.parent?.children.delete(o.key);
    const inside = (x: Obj) => x.path === o.path || x.path.startsWith(o.path + '.');
    b.edges = b.edges.filter((e) => !inside(e.from) && !inside(e.to));
  }

  apply(b: Board, entries: Entry[], scope: Obj, boards?: Map<string, Entry[][]>) {
    for (const e of entries) {
      if (e.type === 'skip') {
        if (e.what === 'import') this.warn.onceFor('import', 'Imports (...@file and @file) are not followed: only this file is read');
        else if (e.what === 'spread') this.warn.onceFor('spread', 'Spread variables (...${x}) are not read');
        else this.warn.onceFor('ref', 'Changes to an earlier connection, (a -> b)[0], are left out: write them on the connection itself');
        continue;
      }
      if (e.type === 'edge') {
        this.edge(b, e, scope);
        continue;
      }
      const head = e.path[0]!;
      if (scope === b.root && (head === 'layers' || head === 'scenarios' || head === 'steps') && e.path.length === 1) {
        if (!boards) continue;
        for (const x of e.block ?? []) if (x.type === 'key' && x.block) boards.set(`${head}\0${this.sub(x.path.join('.'))}`, [x.block]);
        continue;
      }
      if (head === 'vars' && scope === b.root) continue;
      if (head === 'classes') {
        this.warn.onceFor('classes', 'Classes (classes: and class:) are left out: the theme styles by kind');
        continue;
      }
      if (head === 'direction' && e.path.length === 1) {
        if (scope === b.root) b.direction = textOf(e.value);
        else this.warn.onceFor('dir', 'A direction inside a container is left out: the whole drawing has one');
        continue;
      }
      // a.b.shape: x — the object is the part before the first reserved word.
      const at = e.path.findIndex((p) => RESERVED.has(p));
      if (e.value && 'nul' in e.value && at < 0) {
        const o = this.find(scope, e.path);
        if (o) this.remove(b, o);
        continue;
      }
      const o = at === 0 ? scope : this.end(b, scope, at < 0 ? e.path : e.path.slice(0, at), true);
      if (at < 0) {
        const t = textOf(e.value);
        if (t !== undefined) this.label(o, e.value!);
        else if (e.value && 'list' in e.value) o.label = e.value.list.join(', ');
        if (e.block) this.apply(b, e.block, o);
        continue;
      }
      this.field(o, e.path.slice(at), e.value, e.block);
    }
  }

  find(scope: Obj, path: string[]): Obj | undefined {
    let o: Obj | undefined = scope;
    for (const k of path) o = k === '_' ? o?.parent : o?.children.get(this.sub(k));
    return o;
  }

  label(o: Obj, v: Value) {
    if (!('text' in v)) return;
    o.label = this.sub(v.text);
    o.tag = v.tag;
  }

  field(o: Obj, path: string[], v: Value | undefined, block: Entry[] | undefined) {
    const name = path[0]!;
    const t = textOf(v) !== undefined ? this.sub(textOf(v)!) : undefined;
    if (name === 'shape' && t) o.shape = t.toLowerCase();
    else if (name === 'label' && v) {
      if (path.length === 1) this.label(o, v);
    } else if (name === 'icon' && t) o.icon = t;
    else if (name === 'near' && t) o.near = t;
    else if (name === 'constraint') o.constraint.push(...(v && 'list' in v ? v.list : t ? [t] : []));
    else if (name === 'class') this.warn.onceFor('classes', 'Classes (classes: and class:) are left out: the theme styles by kind');
    else if (name === 'style' || RESERVED.has(name)) {
      if (name === 'style' || name === 'opacity' || name === 'fill' || name === 'stroke') this.warn.onceFor('style', 'Styles (style.*) are left out: the theme draws each kind its own way');
      else if (['width', 'height', 'top', 'left'].includes(name)) this.warn.onceFor('size', 'Sizes and positions (width, height, top, left) are left out: the layout places everything');
      else if (name.startsWith('grid') || name.endsWith('-gap')) this.warn.onceFor('grid', 'Grids (grid-rows, grid-columns) are left out: the layout places everything');
      else if (name === 'tooltip' || name === 'link') this.warn.onceFor('link', 'Tooltips and links are left out');
    }
    if (block && name === 'label') for (const x of block) if (x.type === 'key' && x.path[0] === 'near') this.warn.onceFor('labelnear', 'Label positions (label.near) are left out');
  }

  edge(b: Board, e: Extract<Entry, { type: 'edge' }>, scope: Obj) {
    const objs = e.ends.map((p) => this.end(b, scope, p));
    let label = textOf(e.value) !== undefined ? this.sub(textOf(e.value)!) : undefined;
    let dashed = false;
    for (const x of e.block ?? []) {
      if (x.type !== 'key') continue;
      const p = x.path.join('.');
      const t = textOf(x.value);
      if (p === 'label' && t !== undefined) label = this.sub(t);
      else if (/^style\.(stroke-dash|animated)$/.test(p) && t && t !== '0' && t !== 'false') dashed = true;
      else if (p === 'style' && x.block?.some((y) => y.type === 'key' && /^(stroke-dash|animated)$/.test(y.path[0]!) && textOf(y.value) !== '0' && textOf(y.value) !== 'false')) dashed = true;
      else if (/^(source|target)-arrowhead/.test(p)) this.warn.onceFor('arrowhead', 'Arrowhead shapes and labels are left out');
      else if (p.startsWith('style')) this.warn.onceFor('style', 'Styles (style.*) are left out: the theme draws each kind its own way');
    }
    if (label === '') label = undefined;
    for (let i = 0; i < e.ops.length; i++) {
      const op = e.ops[i]!;
      const [a, z] = [objs[i]!, objs[i + 1]!];
      const back = op.startsWith('<') && !op.endsWith('>');
      b.edges.push({ from: back ? z : a, to: back ? a : z, op: op.startsWith('<') && op.endsWith('>') ? '<->' : op.endsWith('>') || back ? '->' : '--', label, dashed, scope, order: ++this.order });
    }
  }
}

// ---------------------------------------------------------------- import

export interface ImportedD2 {
  yaml: string;
  warnings: string[];
  /** What this diagram is, when the file gave more than one: "tables", a layer's name, a sequence's. */
  name?: string;
}

/** One D2 file → its diagrams, the main one first. */
export function importD2(text: string, fallbackTitle = 'Imported diagram'): ImportedD2[] {
  const warn = new Warnings();
  const entries = parseD2(text);
  const reader = new Reader(warn);
  reader.readVars(entries);
  const boards = new Map<string, Entry[][]>();
  const main = reader.board();
  reader.apply(main, entries, main.root, boards);
  if (!main.root.children.size && !boards.size) return [{ yaml: '', warnings: ['The D2 text has no shapes'] }];

  // Steps build on each other, starting from the main board; scenarios each build on the main board.
  const steps = [...boards].filter(([k]) => k.startsWith('steps\0'));
  const scenarios = [...boards].filter(([k]) => k.startsWith('scenarios\0'));
  const layers = [...boards].filter(([k]) => k.startsWith('layers\0'));
  const before = new Set(paths(main.root));
  const beforeEdges = new Set(main.edges.map(edgeKey));
  const stepShows: { name: string; objs: string[]; edges: string[] }[] = [];
  for (const [k, [list]] of steps) {
    const had = new Set(paths(main.root));
    const hadEdges = new Set(main.edges.map(edgeKey));
    reader.apply(main, list!, main.root);
    stepShows.push({ name: k.split('\0')[1]!, objs: paths(main.root).filter((p) => !had.has(p)), edges: main.edges.map(edgeKey).filter((x) => !hadEdges.has(x)) });
  }
  const scenarioOnly: { name: string; objs: string[] }[] = [];
  for (const [k, [list]] of scenarios) {
    const had = new Set(paths(main.root));
    reader.apply(main, list!, main.root);
    scenarioOnly.push({ name: k.split('\0')[1]!, objs: paths(main.root).filter((p) => !had.has(p)) });
  }
  if (scenarios.length) warn.add('Scenarios become views: each shows the main drawing with what its scenario adds; what a scenario changes or removes is not kept apart');

  const out: ImportedD2[] = [];
  const drawn = drawBoard(main, fallbackTitle, warn, { before, beforeEdges, steps: stepShows, scenarios: scenarioOnly });
  out.push(...drawn);
  for (const [k, [list]] of layers) {
    const name = k.split('\0')[1]!;
    const lw = new Warnings();
    const r = new Reader(lw);
    r.vars = reader.vars;
    const b = r.board();
    r.apply(b, list!, b.root, new Map());
    for (const d of drawBoard(b, name, lw)) out.push({ ...d, name: d.name ? `${name}: ${d.name}` : name, warnings: d.warnings });
  }
  if (layers.length) warn.add(`Each layer is a diagram of its own (${layers.map(([k]) => k.split('\0')[1]).join(', ')}); links between them are left out`);
  // The file's own notes go with the first diagram.
  if (out[0]) out[0].warnings = [...warn.list, ...out[0].warnings];
  return out.length ? out : [{ yaml: '', warnings: warn.list }];
}

const paths = (o: Obj): string[] => [...o.children.values()].flatMap((c) => [c.path, ...paths(c)]);
const edgeKey = (e: Edge) => `${e.from.path}\0${e.to.path}\0${e.order}`;
const all = (o: Obj): Obj[] => [...o.children.values()].flatMap((c) => [c, ...all(c)]);
const inside = (o: Obj, a: Obj) => a.path === '' || o.path === a.path || o.path.startsWith(a.path + '.');

interface Extras {
  before: Set<string>;
  beforeEdges: Set<string>;
  steps: { name: string; objs: string[]; edges: string[] }[];
  scenarios: { name: string; objs: string[] }[];
}

/** A board's diagrams: the boxes and lines first, then its tables and its sequence diagrams. */
function drawBoard(b: Board, fallbackTitle: string, warn: Warnings, extras?: Extras): ImportedD2[] {
  const out: ImportedD2[] = [];
  // A text near the top is the title.
  let title = b.root.label ? plainText(b.root.label) : fallbackTitle;
  for (const o of b.root.children.values())
    if (o.near && /^top-/.test(o.near) && (o.shape === 'text' || o.tag || o.key === 'title') && o.children.size === 0) {
      title = plainText(o.label ?? o.key);
      b.root.children.delete(o.key);
    }
  if (isSeq(b.root)) return [{ yaml: sequenceOf(b, b.root, title, warn), warnings: [] }];

  const objs = all(b.root);
  const tables = objs.filter((o) => o.shape === 'sql_table');
  const seqs = objs.filter((o) => isSeq(o) && !objs.some((p) => p !== o && isSeq(p) && inside(o, p)));
  // A database whose children are all tables is one box in the architecture; the tables go to the erd.
  const stores = objs.filter((o) => o.children.size && o.shape !== 'sql_table' && [...o.children.values()].every((c) => c.shape === 'sql_table'));
  const boxes = [...stores, ...objs.filter((o) => o.shape === 'sql_table' || o.shape === 'class')];
  const hidden = (o: Obj) => boxes.some((t) => o !== t && inside(o, t)) || seqs.some((s) => inside(o, s));
  const rest = objs.filter((o) => !hidden(o) && o.shape !== 'sql_table');
  const tablesOnly = tables.length > 0 && rest.every((o) => o.children.size > 0 || o.shape === 'text');
  const seqOnly = seqs.length > 0 && rest.filter((o) => !seqs.includes(o)).length === 0;

  if (!tablesOnly && !seqOnly) out.push({ yaml: systemsOf(b, title, warn, hidden, seqs, extras), warnings: [] });
  if (tables.length && (tablesOnly || tables.some((t) => t.children.size))) {
    out.push({ yaml: erdOf(b, tables, tablesOnly ? title : `${title}: tables`, warn), warnings: [], ...(tablesOnly ? {} : { name: 'tables' }) });
    if (!tablesOnly) warn.add(`The ${tables.length > 1 ? `${tables.length} sql_tables are` : 'sql_table is'} also drawn as an erd diagram of ${tables.length > 1 ? 'their' : 'its'} own, with the columns; in the architecture ${tables.every((t) => stores.includes(t.parent!)) ? 'the database that holds them stands for them' : 'each is a database'}`);
  }
  for (const s of seqs) {
    const name = plainText(s.label ?? s.key);
    out.push({ yaml: sequenceOf(b, s, seqOnly && seqs.length === 1 ? title : name, warn), warnings: [], ...(seqOnly && seqs.length === 1 ? {} : { name }) });
    if (!seqOnly) warn.add(`The sequence diagram "${name}" is a sequence diagram of its own; the architecture leaves it out`);
  }
  if (extras?.steps.length && (tablesOnly || seqOnly)) warn.add('Steps are left out: only an architecture drawing builds up step by step');
  return out;
}

/** The text of a markdown label: its first line, without the markup. */
function plainText(s: string): string {
  const first = s.split('\n').find((l) => l.trim()) ?? s;
  return first.replace(/^#+\s*/, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------- systems and cloud

type Provider = 'aws' | 'gcp' | 'azure';

/** Words in an icon's address: https://icons.terrastruct.com/aws%2FCompute%2FAWS-Lambda.svg → "aws compute aws lambda". */
function iconWords(icon: string): string {
  let s = icon;
  try {
    s = decodeURIComponent(icon);
  } catch {
    // An address that is not encoded is read as it is.
  }
  return s.replace(/^\w+:\/\/[^/]+/, '').replace(/\.(svg|png|jpe?g|gif|webp)$/i, '').replace(/[/_\-.%+]+/g, ' ').toLowerCase().trim();
}

const PROVIDER: [Provider, RegExp][] = [
  ['aws', /\b(aws|amazon|amazon web services)\b/],
  ['gcp', /\b(gcp|google cloud|google cloud platform)\b/],
  ['azure', /\b(azure)\b/],
];

// Products by the words of their icon or label, as kinds of the cloud type. First match wins.
const PRODUCTS: Record<Provider, [string, RegExp][]> = {
  aws: [
    ['lambda', /\blambda\b/], ['s3', /\b(s3|simple storage service)\b/], ['aurora', /\baurora\b/], ['dynamodb', /\bdynamo ?db\b/], ['rds', /\b(rds|relational database service)\b/],
    ['sqs', /\b(sqs|simple queue service)\b/], ['sns', /\b(sns|simple notification service)\b/], ['eventbridge', /\beventbridge\b/], ['kinesis', /\bkinesis\b/],
    ['eks', /\b(eks|elastic kubernetes service)\b/], ['ecr', /\b(ecr|elastic container registry)\b/], ['ecs', /\b(ecs|fargate|elastic container service)\b/], ['ec2', /\bec2\b/],
    ['cloudfront', /\bcloudfront\b/], ['route53', /\broute ?53\b/], ['api-gateway', /\bapi ?gateway\b/], ['alb', /\b(alb|elb|elastic load balancing|application load balancer)\b/],
    ['elasticache', /\belasticache\b/], ['cognito', /\bcognito\b/], ['cloudwatch', /\bcloudwatch\b/], ['secrets-manager', /\bsecrets manager\b/],
    ['step-functions', /\bstep functions\b/], ['redshift', /\bredshift\b/], ['athena', /\bathena\b/], ['glue', /\bglue\b/], ['opensearch', /\b(opensearch|elasticsearch service)\b/],
    ['efs', /\b(efs|elastic file system)\b/], ['ebs', /\b(ebs|elastic block store)\b/], ['waf', /\bwaf\b/],
  ],
  gcp: [
    ['cloud-run', /\bcloud run\b/], ['cloud-functions', /\bcloud functions?\b/], ['gke', /\b(gke|kubernetes engine)\b/], ['compute-engine', /\bcompute engine\b/],
    ['cloud-sql', /\bcloud sql\b/], ['spanner', /\bspanner\b/], ['firestore', /\bfirestore\b/], ['bigquery', /\bbigquery\b/], ['memorystore', /\bmemorystore\b/],
    ['gcs', /\b(cloud storage|gcs)\b/], ['pubsub', /\bpub ?\/? ?sub\b/], ['cloud-cdn', /\bcloud cdn\b/], ['cloud-dns', /\bcloud dns\b/], ['cloud-load-balancing', /\bcloud load balancing\b/],
    ['vertex-ai', /\bvertex( ai)?\b/], ['dataflow', /\bdataflow\b/],
  ],
  azure: [],
};

// Systems kinds as the service that usually is one, per provider (as the cloud type's own aliases).
const GENERAL = new Set(['users', 'user', 'client', 'internet', 'external', 'server', 'datastore', 'router', 'service']);
const CLOUD_KIND: Record<Provider, Record<string, string>> = {
  aws: {
    api: 'ecs', worker: 'ecs', container: 'ecs', function: 'lambda', job: 'lambda', database: 'rds', cache: 'elasticache', storage: 's3', warehouse: 'redshift', queue: 'sqs', topic: 'sns',
    secrets: 'secrets-manager', identity: 'cognito', monitoring: 'cloudwatch', gateway: 'api-gateway', 'load-balancer': 'alb', cdn: 'cloudfront', dns: 'route53', firewall: 'network-firewall', search: 'opensearch', ai: 'bedrock',
  },
  gcp: {
    api: 'cloud-run', worker: 'cloud-run', container: 'cloud-run', function: 'cloud-functions', job: 'cloud-functions', database: 'cloud-sql', cache: 'memorystore', storage: 'gcs', warehouse: 'bigquery', queue: 'pubsub', topic: 'pubsub',
    secrets: 'secret-manager', identity: 'identity-platform', monitoring: 'cloud-monitoring', gateway: 'cloud-api-gateway', 'load-balancer': 'cloud-load-balancing', cdn: 'cloud-cdn', dns: 'cloud-dns', firewall: 'cloud-firewall', ai: 'vertex-ai',
  },
  azure: {
    api: 'app-service', worker: 'function-app', container: 'container-app', function: 'function-app', job: 'function-app', database: 'sql-database', cache: 'redis', storage: 'azure-storage', warehouse: 'sql-database', queue: 'service-bus', topic: 'event-hub',
    secrets: 'key-vault', identity: 'entra-id', monitoring: 'monitor', gateway: 'api-management', 'load-balancer': 'azure-load-balancer', cdn: 'front-door', dns: 'azure-dns', firewall: 'azure-firewall', ai: 'openai', search: 'ai-search',
  },
};
const cloudKind = (kind: string, provider: Provider) => CLOUD_KIND[provider][kind] ?? (GENERAL.has(kind) ? kind : kind === 'mobile' || kind === 'desktop' || kind === 'device' ? 'client' : kind === 'email' || kind === 'payments' ? 'external' : 'service');

/** Cloud group kinds from the systems guess and the words of the label. */
function cloudGroup(label: string, kind: string, provider: Provider): string {
  const t = label.toLowerCase();
  if (PROVIDER.find(([p]) => p === provider)![1].test(t) && provider !== 'azure') return provider;
  if (/\bsubnets?\b|\b(public|private|isolated)\b/.test(t)) return 'subnet';
  if (/\b(vpc|vnet|virtual (private )?network)\b/.test(t)) return 'vpc';
  if (/\b(availability zone|az)\b|\b[a-z]{2}-[a-z]+-\d[a-z]\b/.test(t)) return 'zone';
  if (/\baccount\b/.test(t) && provider === 'aws') return 'account';
  if (/\bproject\b/.test(t) && provider === 'gcp') return 'project';
  if (kind === 'region') return 'region';
  if (kind === 'cluster') return provider === 'aws' ? 'eks-cluster' : provider === 'gcp' ? 'gke-cluster' : 'aks-cluster';
  if (kind === 'on-premises') return 'on-premises';
  if (kind === 'cloud') return provider === 'azure' ? 'boundary' : provider;
  return 'boundary';
}

const STORES = new Set(['cache', 'warehouse', 'search', 'storage', 'database']);
const SHAPE_KIND: Record<string, string> = {
  person: 'user', cylinder: 'database', stored_data: 'storage', queue: 'queue', cloud: 'external', page: 'storage', document: 'storage', package: 'container', sql_table: 'database', class: 'service',
};

function systemsOf(b: Board, title: string, warn: Warnings, hidden: (o: Obj) => boolean, seqs: Obj[], extras?: Extras): string {
  const ids = new Ids();
  const objs = all(b.root).filter((o) => !hidden(o));
  const drawn = objs.filter((o) => o.shape !== 'text' && o.shape !== 'code');
  const dropped = objs.filter((o) => o.shape === 'text' || o.shape === 'code');
  if (dropped.length) warn.add(`Text and code shapes are left out: ${dropped.slice(0, 3).map((o) => o.key).join(', ')}${dropped.length > 3 ? ', …' : ''}`);
  if (drawn.some((o) => o.near)) warn.onceFor('near', 'near: is left out (except a text near the top, which becomes the title): the layout places everything');
  if (drawn.some((o) => o.shape === 'class')) warn.onceFor('class', 'class shapes come in as boxes: their fields and methods are left out (there is no class diagram type yet)');
  if (drawn.some((o) => o.icon)) warn.onceFor('icon', 'Icons are not fetched: the kind brings its own icon');

  // Which cloud: the icons say it best, a group named after the provider too.
  const votes = new Map<Provider, number>();
  for (const o of drawn) {
    const words = `${o.icon ? iconWords(o.icon) : ''} ${o.children.size ? (o.label ?? o.key).toLowerCase() : ''}`;
    for (const [p, r] of PROVIDER) if (r.test(words)) votes.set(p, (votes.get(p) ?? 0) + (o.icon ? 1 : 2));
  }
  const ranked = [...votes].sort((x, y) => y[1] - x[1]);
  const provider = ranked[0] && ranked[0][1] >= 2 && (ranked.length === 1 || ranked[0][1] >= 2 * ranked[1]![1]) ? ranked[0][0] : undefined;

  const groups: SysGroup[] = [];
  const nodes: SysNode[] = [];
  const idOf = new Map<Obj, string>();
  for (const o of drawn) idOf.set(o, ids.get(o.path, slug(o.key)));
  const parentOf = (o: Obj) => (o.parent && idOf.has(o.parent) ? idOf.get(o.parent) : undefined);
  for (const o of drawn) {
    const label = plainText(o.label ?? o.key);
    const words = o.icon ? iconWords(o.icon) : '';
    if (o.children.size && o.shape !== 'sql_table' && o.shape !== 'class' && !all(o).every((c) => hidden(c))) {
      let kind = o.shape === 'cloud' && guessGroupKind(label) === 'group' ? 'cloud' : guessGroupKind(label);
      if (provider) kind = cloudGroup(`${label} ${words}`, kind, provider);
      groups.push({ id: idOf.get(o)!, label, kind, parent: parentOf(o) });
      continue;
    }
    // The shape says what it is, the words which one: a cylinder called "Redis cache" is a cache.
    const guess = guessKind(label) ?? (words ? guessKind(words) : undefined);
    let kind =
      o.shape === 'person' ? (guess === 'users' ? 'users' : 'user')
      : o.shape === 'cylinder' || o.shape === 'sql_table' ? (guess && STORES.has(guess) ? guess : 'database')
      : o.shape === 'queue' ? (guess === 'topic' ? 'topic' : 'queue')
      : (guess ?? (o.shape ? SHAPE_KIND[o.shape] : undefined) ?? 'service');
    if (provider) kind = PRODUCTS[provider].find(([, r]) => r.test(`${words} ${label.toLowerCase()}`))?.[0] ?? cloudKind(kind, provider);
    nodes.push({ id: idOf.get(o)!, label, kind, parent: parentOf(o) });
  }

  // A connection to something inside a table or a sequence diagram goes to the table; into a sequence it is left out.
  const target = (o: Obj): string | undefined => {
    if (seqs.some((s) => inside(o, s))) return undefined;
    for (let x: Obj | undefined = o; x; x = x.parent) if (idOf.has(x)) return idOf.get(x);
    return undefined;
  };
  const edges: SysEdge[] = [];
  let lost = 0;
  for (const e of b.edges) {
    const [from, to] = [target(e.from), target(e.to)];
    if (!from || !to) {
      lost++;
      continue;
    }
    if (from === to) continue;
    edges.push({ from, to, op: e.op, label: e.label ? plainText(e.label) : undefined, ...(e.dashed && !provider ? { style: 'async' as const } : {}) });
  }
  if (lost) warn.add(`${lost} connection${lost > 1 ? 's' : ''} to text or into a sequence diagram ${lost > 1 ? 'were' : 'was'} left out`);

  const direction = b.direction === 'down' || b.direction === 'up' ? 'down' : 'right';
  if (b.direction === 'up' || b.direction === 'left') warn.onceFor('dir', `direction: ${b.direction} is drawn ${b.direction === 'up' ? 'down' : 'right'}: Cartography reads left to right or top to bottom`);
  let yaml = systemsYaml({ title, direction, explicit: !!b.direction, groups, nodes, edges });
  if (provider) yaml = yaml.replace(/^type: systems\n/, `type: cloud\nprovider: ${provider}\n`);

  // Steps: the main board first, then what each step adds. Scenarios: one view each.
  if (extras && (extras.steps.length || extras.scenarios.length)) {
    const id = (path: string) => [...idOf].find(([o]) => o.path === path)?.[1];
    const leaves = (list: string[]) => list.map(id).filter((x): x is string => !!x && !groups.some((g) => g.id === x && nodes.some((n) => n.parent === x)));
    const list = (xs: string[]) => `[${xs.map(scalar).join(', ')}]`;
    if (extras.steps.length) {
      const base = leaves([...extras.before]);
      yaml += '\nsteps:\n  - title: Start\n' + (base.length ? `    show: ${list(base)}\n` : '');
      for (const s of extras.steps) {
        const show = leaves(s.objs);
        // A line between things that were there already is shown on its own.
        const lines = b.edges
          .filter((e) => s.edges.includes(edgeKey(e)))
          .map((e) => [target(e.from), target(e.to)])
          .filter(([f, t]) => f && t && f !== t && !show.includes(f) && !show.includes(t))
          .map(([f, t]) => `${f} -> ${t}`);
        yaml += `  - title: ${scalar(s.name)}\n` + (show.length || lines.length ? `    show: ${list([...show, ...lines])}\n` : '');
      }
    }
    if (extras.scenarios.length) {
      const all = extras.scenarios.flatMap((s) => leaves(s.objs));
      const others = (i: number) => extras.scenarios.flatMap((s, j) => (j === i ? [] : leaves(s.objs)));
      const vids = new Ids();
      yaml += `\nviews:\n  ${vids.get('main')}: { title: ${scalar(title)}${all.length ? `, exclude: ${list(all)}` : ''} }\n`;
      extras.scenarios.forEach((s, i) => {
        yaml += `  ${vids.get(s.name, slug(s.name).toLowerCase())}: { title: ${scalar(`${title}: ${s.name}`)}${others(i).length ? `, exclude: ${list(others(i))}` : ''} }\n`;
      });
    }
  }
  return yaml;
}

// ---------------------------------------------------------------- erd

const PK = /^(primary[_ ]?key|pk)$/i;
const FK = /^(foreign[_ ]?key|fk)$/i;
const UNIQUE = /^(unique|unq|uk)$/i;

function erdOf(b: Board, tables: Obj[], title: string, warn: Warnings): string {
  const ids = new Ids();
  const idOf = new Map(tables.map((t) => [t, ids.get(t.path, slug(t.key).toLowerCase())]));
  const tableOf = (o: Obj) => tables.find((t) => o === t || o.parent === t);
  const fks = new Map<Obj, string>();
  const relations: string[] = [];
  for (const e of b.edges) {
    let [a, z] = [e.from, e.to];
    let [ta, tz] = [tableOf(a), tableOf(z)];
    if (!ta || !tz) continue;
    // The key points at the table it refers to: a primary key on the left means the line was drawn the other way.
    const isPk = (o: Obj) => o.constraint.some((c) => PK.test(c));
    if (a !== ta && z !== tz && isPk(a) && !isPk(z)) ([a, z, ta, tz] = [z, a, tz, ta]);
    const colA = a !== ta ? a : undefined;
    const colZ = z !== tz ? z : undefined;
    const ref = colZ ? `${idOf.get(tz)}.${colZ.key}` : idOf.get(tz)!;
    if (colA && !fks.has(colA)) fks.set(colA, ref);
    if (e.label || !colA) relations.push(`  - ${colA ? `${idOf.get(ta)}.${colA.key}` : idOf.get(ta)} -> ${ref}${e.label ? `: ${scalar(plainText(e.label))}` : ''}`);
  }
  const lines = ['type: erd', `title: ${scalar(title)}`, '', 'tables:'];
  for (const t of tables) {
    lines.push(`  ${idOf.get(t)}:`);
    const label = plainText(t.label ?? t.key);
    if (label !== t.key) lines.push(`    label: ${scalar(label)}`);
    if (!t.children.size) {
      lines.push('    columns: {}');
      continue;
    }
    lines.push('    columns:');
    for (const c of t.children.values()) {
      const pk = c.constraint.some((x) => PK.test(x));
      const fk = fks.get(c);
      if (c.constraint.some((x) => FK.test(x)) && !fk) warn.add(`${idOf.get(t)}.${c.key} is a foreign key, but no connection says to which table`);
      const other = c.constraint.filter((x) => !PK.test(x) && !FK.test(x) && !UNIQUE.test(x));
      if (other.length) warn.onceFor('constraint', `Constraints other than primary_key, foreign_key and unique are left out (${other[0]})`);
      const spec = [c.label ? plainText(c.label) : '', pk && 'pk', fk && `fk ${fk}`, c.constraint.some((x) => UNIQUE.test(x)) && 'unique'].filter(Boolean).join(' ');
      lines.push(`      ${/^[\w-]+$/.test(c.key) ? c.key : JSON.stringify(c.key)}: ${spec ? scalar(spec) : '""'}`);
    }
  }
  if (relations.length) lines.push('', 'relations:', ...relations);
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- sequence

const FRAME = /^(alt|opt|optional|loop|par|parallel|break|critical)\b[:\s]*(.*)$/i;

function sequenceOf(b: Board, seq: Obj, title: string, warn: Warnings): string {
  const ids = new Ids();
  const edges = b.edges.filter((e) => inside(e.from, seq) && inside(e.to, seq) && e.from !== seq && e.to !== seq);
  const actorOf = (o: Obj): Obj => {
    let x = o;
    while (x.parent && x.parent !== seq) x = x.parent;
    return x;
  };
  // Groups are what connections are written in; everything else directly in the diagram is an actor.
  const frames = new Set<Obj>();
  for (const e of edges) for (let s: Obj | undefined = e.scope; s && s !== seq && inside(s, seq); s = s.parent) frames.add(s);
  const referenced = new Set(edges.flatMap((e) => [actorOf(e.from), actorOf(e.to)]));
  const actors = [...seq.children.values()].filter((o) => !frames.has(o) && o.shape !== 'text');
  const participants = new Map<Obj, Participant>();
  for (const a of actors) {
    const label = plainText(a.label ?? a.key);
    const id = ids.get(a.path, slug(a.key));
    const kind = a.shape === 'person' ? 'person' : a.shape === 'cylinder' ? 'database' : a.shape === 'queue' ? 'queue' : participantKind(label);
    participants.set(a, { id, kind, ...(label !== id ? { label } : {}) });
  }
  if (edges.some((e) => e.from !== actorOf(e.from) || e.to !== actorOf(e.to))) warn.onceFor('span', 'Spans (alice.t1 -> bob) are drawn on their actor: activations follow the calls');
  if (edges.some((e) => e.op !== '->' && e.op !== '--')) warn.onceFor('both', 'Two-way connections in a sequence diagram are drawn one way');
  if (actors.some((a) => !referenced.has(a) && a.children.size)) warn.onceFor('unused', 'Actors with children that never send or receive are drawn as plain actors');

  // Notes: an object inside an actor that no connection touches.
  const notes = actors.flatMap((a) => all(a).filter((n) => !edges.some((e) => inside(e.from, n) || inside(e.to, n))).map((n) => ({ n, a })));
  const steps = (scope: Obj): Step[] => {
    const items: { order: number; step: Step }[] = [];
    for (const e of edges)
      if (e.scope === scope)
        items.push({ order: e.order, step: { line: message(e) } });
    for (const f of frames) if (f.parent === scope) items.push({ order: f.order, step: frame(f) });
    if (scope === seq) for (const { n, a } of notes) items.push({ order: n.order, step: { line: `note: ${scalar(plainText(n.label ?? n.key))}\n  over: ${participants.get(a)!.id}` } });
    return items.sort((x, y) => x.order - y.order).map((x) => x.step);
  };
  const message = (e: Edge) => {
    const [from, to] = [participants.get(actorOf(e.from))!.id, participants.get(actorOf(e.to))!.id];
    const label = e.label ? plainText(e.label) : '';
    const key = `${from} ${e.dashed ? '-->' : '->'} ${to}`;
    return label ? `${key}: ${scalar(label)}` : key;
  };
  const frame = (f: Obj): Step => {
    const label = plainText(f.label ?? f.key);
    const m = FRAME.exec(label);
    const kind = m ? ({ optional: 'opt', parallel: 'par' } as Record<string, string>)[m[1]!.toLowerCase()] ?? m[1]!.toLowerCase() : 'group';
    return { frame: kind, label: (m ? m[2] : label) || undefined, steps: steps(f), branches: [] };
  };
  // Connections written in an actor's block (rare) count as the diagram's own.
  for (const e of edges) if (!frames.has(e.scope) && e.scope !== seq) e.scope = seq;
  return sequenceYaml({ title, boxes: [], participants: [...participants.values()], steps: steps(seq) });
}
