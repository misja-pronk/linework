// UML class diagrams: classes, interfaces, abstract classes, enums and records with their members,
// packages as groups, and the relations UML draws: generalization and realization (hollow triangle),
// composition and aggregation (diamonds), association (with multiplicities, roles and an open arrow
// for navigability) and dependency (dashed, open arrow).
//
//   classes:
//     Order:
//       stereotype: aggregate root
//       package: ordering
//       members:
//         - -id: OrderId                     visibility + - # ~, then name: Type
//         - "+addLine(product: ProductId, quantity: Int): void"
//         - +total(): Money
//         - +{static} create(customer: CustomerId): Order
//     Money: { kind: record, members: [+amount: Decimal, +currency: String] }
//     OrderStatus: { kind: enum, values: [Draft, Placed, Paid] }
//     PaymentMethod: interface
//     Card: { extends: PaymentMethod }        or implements:
//   relations:
//     - Order "1" *-- "1..*" OrderLine: lines   whole *-- part; o-- aggregation
//     - SqlOrders ..|> OrderRepository           ..|> realization, --|> generalization
//     - OrderLine --> Money: price               --> navigable association, -- plain, ..> dependency
//
// Parents stand above their children: the hierarchy ranks the drawing top-down, wholes above their
// parts, and every other relation follows unless it would turn the hierarchy round.
import {
  idPattern,
  parseLink,
  parseLinks,
  tones,
  type BuildContext,
  type DiagramType,
  type Graph,
  type GraphEdge,
  type GraphGroup,
  type GraphNode,
  type LegendItem,
  type Marker,
  type Path,
  type Reference,
  type TableRow,
  type Tone,
} from '@cartography/core';

export type ClassKind = 'class' | 'interface' | 'abstract' | 'enum' | 'record';
export const classKinds: ClassKind[] = ['class', 'interface', 'abstract', 'enum', 'record'];

export interface ClassEntry {
  kind?: ClassKind;
  /** What it is called when that differs from its key. */
  label?: string;
  /** Type parameters: "T", "K, V" draws Repository<T>. */
  generic?: string;
  stereotype?: string | string[];
  package?: string;
  extends?: string | string[];
  implements?: string | string[];
  members?: unknown[];
  /** An enum's literals. */
  values?: unknown[];
  tone?: Tone;
  description?: string;
  link?: string;
  links?: unknown[];
}

export interface ClassSource {
  type: 'class';
  title?: string;
  subtitle?: string;
  direction?: 'down' | 'right';
  packages?: Record<string, { label?: string; caption?: string; parent?: string; tone?: Tone } | string | null>;
  classes?: Record<string, ClassEntry | ClassKind | null>;
  relations?: unknown[];
}

const KINDS: Record<ClassKind, { icon: string; tone: Tone; stereotype?: string; label: string }> = {
  class: { icon: 'box', tone: 'blue', label: 'Class' },
  interface: { icon: 'circle-dot', tone: 'teal', stereotype: 'interface', label: 'Interface' },
  abstract: { icon: 'square-dashed', tone: 'indigo', stereotype: 'abstract', label: 'Abstract class' },
  enum: { icon: 'list-checks', tone: 'amber', stereotype: 'enumeration', label: 'Enumeration' },
  record: { icon: 'braces', tone: 'violet', stereotype: 'record', label: 'Record' },
};

/** A class entry as written: a kind on its own ("PaymentMethod: interface") or the full entry. */
export function classShorthand(v: unknown): ClassEntry {
  if (typeof v === 'string') return (classKinds as string[]).includes(v) ? { kind: v as ClassKind } : { label: v };
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as ClassEntry) : {};
}

// ---------------------------------------------------------------- members

export type Visibility = '+' | '-' | '#' | '~';

export interface Member {
  visibility?: Visibility;
  name: string;
  /** Parameters as written between the brackets; set for an operation, '' for none. */
  params?: string;
  type?: string;
  /** Initial value of an attribute. */
  value?: string;
  static?: boolean;
  abstract?: boolean;
}

/**
 * "+name: String", "-count: Int = 0", "+total(): Money", "+{static} of(amount: Decimal): Money",
 * "+{abstract} area(): Double", "#log(message)" → a member. Also reads `$` (static) and `*`
 * (abstract) after the member, as Mermaid writes them. A one-key map is the same line: YAML reads
 * "- +name: String" as { "+name": "String" }.
 */
export function parseMember(raw: unknown): Member | undefined {
  let s: string;
  if (typeof raw === 'string' || typeof raw === 'number') s = String(raw);
  else if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 1) {
    const [k, v] = Object.entries(raw)[0]!;
    s = v == null || v === '' ? k : `${k}: ${String(v)}`;
  } else return undefined;
  s = s.trim();
  if (!s) return undefined;
  const m: Member = { name: '' };
  const vis = /^([+\-#~])\s*/.exec(s);
  if (vis) (m.visibility = vis[1] as Visibility), (s = s.slice(vis[0].length));
  for (;;) {
    const mod = /^(\{static\}|\{classifier\}|\{abstract\}|static\s+|abstract\s+)\s*/i.exec(s);
    if (!mod) break;
    if (/static|classifier/i.test(mod[1]!)) m.static = true;
    else m.abstract = true;
    s = s.slice(mod[0].length);
  }
  const open = s.indexOf('(');
  const close = open >= 0 ? matching(s, open) : -1;
  if (open > 0 && close > open) {
    m.name = s.slice(0, open).trim();
    m.params = s.slice(open + 1, close).trim();
    let rest = s.slice(close + 1).trim();
    const flag = /^([$*]+)\s*/.exec(rest);
    if (flag) {
      if (flag[1]!.includes('$')) m.static = true;
      if (flag[1]!.includes('*')) m.abstract = true;
      rest = rest.slice(flag[0].length);
    }
    rest = rest.replace(/^:\s*/, '').replace(/[$*]+$/, (f) => ((f.includes('$') && (m.static = true)), (f.includes('*') && (m.abstract = true)), '')).trim();
    if (rest) m.type = rest;
  } else {
    const flag = /\s*([$*]+)$/.exec(s);
    if (flag) {
      if (flag[1]!.includes('$')) m.static = true;
      if (flag[1]!.includes('*')) m.abstract = true;
      s = s.slice(0, flag.index);
    }
    const eq = s.indexOf('=');
    if (eq > 0) (m.value = s.slice(eq + 1).trim()), (s = s.slice(0, eq).trim());
    const colon = s.indexOf(':');
    if (colon > 0) (m.name = s.slice(0, colon).trim()), (m.type = s.slice(colon + 1).trim() || undefined);
    else m.name = s.trim();
  }
  return m.name ? m : undefined;
}

/** The index of the bracket that closes the one at `open`. */
function matching(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

/** A member as one line again, as the YAML writes it. */
export function memberLine(m: Member): string {
  const mods = (m.static ? '{static} ' : '') + (m.abstract ? '{abstract} ' : '');
  const head = `${m.visibility ?? ''}${mods}${m.name}${m.params !== undefined ? `(${m.params})` : ''}`;
  return `${head}${m.type ? `: ${m.type}` : ''}${m.value ? ` = ${m.value}` : ''}`;
}

/** What tells two members apart: an attribute by its name, an operation by its name and its parameter types. */
const signature = (m: Member) => (m.params === undefined ? m.name : `${m.name}(${m.params.split(',').map((p) => p.split(':').pop()!.trim()).join(',')})`);

// ---------------------------------------------------------------- relations

export type RelationKind = 'generalization' | 'realization' | 'composition' | 'aggregation' | 'association' | 'dependency' | 'link';

export interface Relation {
  /** As written, left to right. */
  a: string;
  b: string;
  kind: RelationKind;
  /** The marks at a's end and at b's end. */
  aEnd: Marker;
  bEnd: Marker;
  dashed: boolean;
  aMult?: string;
  bMult?: string;
  aRole?: string;
  bRole?: string;
  label?: string;
  path: Path;
  /** Where a and b start in the written line, and whether that line is the key of a one-key map. */
  at?: { a: number; b: number; keyed: boolean };
}

const ARROW = /^(<\||\*|o|<)?(-{2,}|\.{2,})(\|>|\*|o|>)?$/;
const HEAD: Record<string, Marker> = { '<|': 'triangle', '|>': 'triangle', '*': 'filledDiamond', o: 'diamond', '<': 'open', '>': 'open' };

/** `A "1" *-- "0..*" B: label` → its parts; undefined when it is not a relation. */
export function parseRelationLine(line: string): Omit<Relation, 'path' | 'kind' | 'label'> & { label?: string; kind: RelationKind } | undefined {
  // Words and quoted multiplicities, with where each starts.
  const tokens: { text: string; at: number; quoted: boolean }[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let colonAt = -1;
  for (let m: RegExpExecArray | null; (m = re.exec(line)); ) {
    if (m[2] === ':' || (m[2]?.startsWith(':') && tokens.length >= 3)) {
      colonAt = m.index;
      break;
    }
    // "B: label" with the colon glued to the name, once the arrow is behind.
    const cut = m[2]?.indexOf(':') ?? -1;
    if (m[2] && cut > 0 && tokens.some((t) => !t.quoted && ARROW.test(t.text))) {
      tokens.push({ text: m[2].slice(0, cut), at: m.index, quoted: false });
      colonAt = m.index + cut;
      break;
    }
    tokens.push({ text: m[1] ?? m[2]!, at: m.index + (m[1] !== undefined ? 1 : 0), quoted: m[1] !== undefined });
  }
  // "B: label" glued to the name.
  const last = tokens.at(-1);
  let label: string | undefined;
  if (colonAt >= 0) label = line.slice(colonAt).replace(/^:\s*/, '').trim() || undefined;
  else if (last && !last.quoted && last.text.includes(':') && tokens.length >= 3) {
    const cut = last.text.indexOf(':');
    label = (last.text.slice(cut + 1) + line.slice(last.at + last.text.length)).trim() || undefined;
    last.text = last.text.slice(0, cut);
  }
  const arrowAt = tokens.findIndex((t) => !t.quoted && ARROW.test(t.text));
  if (arrowAt < 1) return undefined;
  const a = tokens[0]!;
  const aMult = arrowAt === 2 && tokens[1]!.quoted ? tokens[1]!.text : undefined;
  if (arrowAt > 2 || (arrowAt === 2 && !aMult)) return undefined;
  const rest = tokens.slice(arrowAt + 1);
  const bMult = rest.length === 2 && rest[0]!.quoted ? rest[0]!.text : undefined;
  const b = rest.length === 1 ? rest[0]! : bMult !== undefined ? rest[1]! : undefined;
  if (!b || b.quoted || a.quoted || !b.text) return undefined;
  const [, left, body, right] = ARROW.exec(tokens[arrowAt]!.text)!;
  const dashed = body!.startsWith('.');
  const aEnd = left ? HEAD[left]! : 'none';
  const bEnd = right ? HEAD[right]! : 'none';
  const ends = [aEnd, bEnd];
  const kind: RelationKind = ends.includes('triangle')
    ? dashed
      ? 'realization'
      : 'generalization'
    : ends.includes('filledDiamond')
      ? 'composition'
      : ends.includes('diamond')
        ? 'aggregation'
        : dashed
          ? ends.includes('open')
            ? 'dependency'
            : 'link'
          : 'association';
  return { a: a.text, b: b.text, kind, aEnd, bEnd, dashed, ...(aMult !== undefined ? { aMult } : {}), ...(bMult !== undefined ? { bMult } : {}), ...(label ? { label } : {}), at: { a: a.at, b: b.at, keyed: false } };
}

/** Every relation as written: a line, a one-key map of a line to its label or props. */
export function readRelations(items: unknown[] | undefined, report?: (path: Path, message: string) => void): Relation[] {
  const out: Relation[] = [];
  for (const [i, item] of (items ?? []).entries()) {
    const path: Path = ['relations', i];
    let line: string | undefined;
    let props: Record<string, unknown> = {};
    let keyed = false;
    if (typeof item === 'string') line = item;
    else if (item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length === 1) {
      const [k, v] = Object.entries(item)[0]!;
      line = k;
      keyed = true;
      if (typeof v === 'string' || typeof v === 'number') props = { label: String(v) };
      else if (v && typeof v === 'object' && !Array.isArray(v)) props = v as Record<string, unknown>;
    }
    const r = line ? parseRelationLine(line) : undefined;
    if (!r) {
      report?.(path, 'A relation is "A --|> B" (extends), "A ..|> B" (implements), "A *-- B" (has, composition), "A o-- B" (aggregation), "A --> B" (association) or "A ..> B" (uses)');
      continue;
    }
    const roles = Array.isArray(props.roles) ? props.roles.map((x) => (x == null ? '' : String(x))) : [];
    const mult = Array.isArray(props.multiplicity) ? props.multiplicity.map((x) => (x == null ? '' : String(x))) : [];
    const label = typeof props.label === 'string' ? props.label : r.label;
    out.push({
      ...r,
      ...(label ? { label } : {}),
      ...(roles[0] ? { aRole: roles[0] } : {}),
      ...(roles[1] ? { bRole: roles[1] } : typeof props.role === 'string' ? { bRole: props.role } : {}),
      ...(mult[0] ? { aMult: mult[0] } : {}),
      ...(mult[1] ? { bMult: mult[1] } : {}),
      path,
      at: { ...r.at!, keyed },
    });
  }
  return out;
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);

// ---------------------------------------------------------------- build

/** The order relations rank the drawing in: the hierarchy first, then wholes over parts, then the rest. */
const RANK: Record<RelationKind, number> = { generalization: 0, realization: 0, composition: 1, aggregation: 1, association: 2, dependency: 3, link: 4 };

function build(src: ClassSource, ctx: BuildContext): Graph {
  const packageIds = new Set(Object.keys(src.packages ?? {}));
  const groups: GraphGroup[] = Object.entries(src.packages ?? {}).map(([id, raw]) => {
    const p = typeof raw === 'string' ? { label: raw } : (raw ?? {});
    if (p.parent && !packageIds.has(p.parent)) ctx.error(['packages', id, 'parent'], `There is no package "${p.parent}"`);
    return {
      id,
      ...(p.parent && packageIds.has(p.parent) && p.parent !== id ? { parent: p.parent } : {}),
      label: p.label ?? id,
      caption: p.caption ?? 'Package',
      icon: 'package',
      tone: p.tone ?? 'slate',
      border: 'dashed' as const,
      kind: 'package',
      path: ['packages', id],
    };
  });

  const entries = Object.entries(src.classes ?? {}).map(([id, raw]) => [id, classShorthand(raw)] as const);
  const known = new Map(entries);
  const kindOf = (id: string): ClassKind => known.get(id)?.kind ?? 'class';

  const nodes: GraphNode[] = entries.map(([id, c]) => {
    const kind = c.kind ?? 'class';
    const k = KINDS[kind];
    const path: Path = ['classes', id];
    if (c.package && !packageIds.has(c.package)) ctx.error([...path, 'package'], `There is no package "${c.package}"`);
    const stereotypes = [...(k.stereotype ? [k.stereotype] : []), ...list(c.stereotype)];
    const rows: TableRow[] = [];
    const seen = new Map<string, number>();
    const memberRows = (raw: { m: unknown; i: number }[], at: Path, literal: boolean) => {
      const out: TableRow[] = [];
      for (const { m: item, i } of raw) {
        const m = literal && (typeof item === 'string' || typeof item === 'number') ? { name: String(item).trim() } : parseMember(item);
        if (!m?.name) {
          ctx.error([...at, i], literal ? 'An enum value is a name' : 'A member is "+name: Type" or "+operation(param: Type): Result"');
          continue;
        }
        const sig = signature(m);
        if (seen.has(sig)) ctx.warn([...at, i], `"${m.name}" is in ${c.label ?? id} twice`);
        seen.set(sig, i);
        const op = m.params !== undefined;
        out.push({
          kind: 'row',
          id: `${at.at(-1)}-${i}`,
          ...(m.visibility ? { sign: m.visibility } : {}),
          cells: [
            { text: op ? `${m.name}(${m.params})` : m.name, ...(m.abstract ? { italic: true } : {}), ...(m.static ? { underline: true } : {}) },
            { text: [m.type, m.value !== undefined ? `= ${m.value}` : undefined].filter(Boolean).join(' '), muted: true, mono: true },
          ],
        });
      }
      return out;
    };
    const values = memberRows((c.values ?? []).map((m, i) => ({ m, i })), [...path, 'values'], true);
    const members = (c.members ?? []).map((m, i) => ({ m, i, op: parseMember(m)?.params !== undefined }));
    const attributes = memberRows(members.filter((x) => !x.op), [...path, 'members'], false);
    const operations = memberRows(members.filter((x) => x.op), [...path, 'members'], false);
    if (kind !== 'enum' && values.length) ctx.warn([...path, 'values'], `Only an enum has values: make ${id} "kind: enum", or write them as members`);
    // Compartments: values or attributes, then the operations under a rule.
    rows.push(...values, ...attributes);
    if (rows.length && operations.length) rows.push({ kind: 'section', label: '' });
    rows.push(...operations);
    const title = `${c.label ?? id}${c.generic ? `<${c.generic}>` : ''}`;
    const links = c.link != null ? [parseLink(c.link)].filter((l) => !!l) : parseLinks(c.links);
    if (c.link != null && !links?.length) ctx.error([...path, 'link'], 'A link is a URL, another diagram (other.yaml) or a view (other.yaml#view)');
    return {
      id,
      ...(c.package && packageIds.has(c.package) ? { parent: c.package } : {}),
      shape: {
        kind: 'table',
        form: 'class',
        title,
        ...(stereotypes.length ? { caption: stereotypes.map((s) => `«${s}»`).join(' ') } : {}),
        ...(kind === 'abstract' ? { italic: true } : {}),
        icon: k.icon,
        tone: c.tone ?? k.tone,
        rows,
      },
      kind,
      ...(links?.length ? { links } : {}),
      ...(c.description ? { description: c.description } : {}),
      path,
    };
  });

  // Relations: written ones, and the ones extends: and implements: stand for.
  const relations = readRelations(src.relations, (p, m) => ctx.error(p, m));
  for (const [id, c] of entries)
    for (const key of ['extends', 'implements'] as const) {
      const targets = list(c[key]);
      for (const [i, parent] of targets.entries()) {
        const path: Path = Array.isArray(c[key]) ? ['classes', id, key, i] : ['classes', id, key];
        relations.push({ a: id, b: parent, kind: key === 'extends' ? 'generalization' : 'realization', aEnd: 'none', bEnd: 'triangle', dashed: key === 'implements', path });
      }
    }

  const edges: GraphEdge[] = [];
  // Child → parent along the hierarchy, to find cycles.
  const parents = new Map<string, Set<string>>();
  const reaches = (from: string, to: string, graph: Map<string, Set<string>>, seen = new Set<string>()): boolean => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return [...(graph.get(from) ?? [])].some((n) => reaches(n, to, graph, seen));
  };
  // Upper → lower, as ranked so far: a relation that would point back up is drawn without ranking.
  const below = new Map<string, Set<string>>();
  const ordered = relations.map((r, i) => ({ r, i })).sort((x, y) => RANK[x.r.kind] - RANK[y.r.kind] || x.i - y.i);
  const built = new Map<number, GraphEdge>();
  for (const { r, i } of ordered) {
    const missing = [r.a, r.b].find((x) => !known.has(x));
    if (missing) {
      ctx.error(r.path, `There is no class "${missing}"`);
      continue;
    }
    // Who stands above: the parent of a generalization, the whole of a composition; else as written.
    const flip = r.kind === 'generalization' || r.kind === 'realization' ? r.aEnd === 'triangle' ? false : true : r.bEnd === 'filledDiamond' || r.bEnd === 'diamond' ? true : r.aEnd === 'open' && r.bEnd === 'none';
    const [upper, lower] = flip ? [r.b, r.a] : [r.a, r.b];
    if (r.kind === 'generalization' || r.kind === 'realization') {
      if (reaches(upper, lower, parents)) {
        ctx.error(r.path, `${lower} cannot ${r.kind === 'realization' ? 'implement' : 'extend'} ${upper}: ${upper} already comes from ${lower}`);
        continue;
      }
      if (!parents.has(lower)) parents.set(lower, new Set());
      parents.get(lower)!.add(upper);
      const target = kindOf(upper);
      if (r.kind === 'realization' && target !== 'interface') ctx.warn(r.path, `${upper} is not an interface: a class extends it (--|>), it does not implement it`);
      if (r.kind === 'generalization' && target === 'interface' && kindOf(lower) !== 'interface') ctx.warn(r.path, `${upper} is an interface: a class implements it (..|>)`);
    }
    // A line that would turn the ranking round says nothing about what stands above what.
    const loose = upper === lower || reaches(lower, upper, below);
    if (!loose) {
      if (!below.has(upper)) below.set(upper, new Set());
      below.get(upper)!.add(lower);
    }
    const [startEnd, endEnd, fromMult, toMult, fromRole, toRole] = flip ? [r.bEnd, r.aEnd, r.bMult, r.aMult, r.bRole, r.aRole] : [r.aEnd, r.bEnd, r.aMult, r.bMult, r.aRole, r.bRole];
    const tagsOf = (mult?: string, role?: string) => [role, mult].filter((x): x is string => !!x);
    const fromTags = tagsOf(fromMult, fromRole);
    const toTags = tagsOf(toMult, toRole);
    built.set(i, {
      id: `rel-${r.path.join('-')}`,
      from: { node: upper },
      to: { node: lower },
      ...(r.label ? { label: r.label } : {}),
      line: r.dashed ? 'dashed' : 'solid',
      start: startEnd,
      end: endEnd,
      kind: r.kind,
      ...(loose ? { loose: true } : {}),
      ...(fromTags.length || toTags.length ? { ends: { ...(fromTags.length ? { from: fromTags } : {}), ...(toTags.length ? { to: toTags } : {}) } } : {}),
      path: r.path,
    });
  }
  for (const i of [...built.keys()].sort((x, y) => x - y)) edges.push(built.get(i)!);

  return { title: src.title, subtitle: src.subtitle, direction: src.direction ?? 'down', groups, nodes, edges, legend: classKey(edges) };
}

const KEY: [RelationKind, string, GraphEdge['line'], Marker][] = [
  ['generalization', 'Extends', 'solid', 'triangle'],
  ['realization', 'Implements', 'dashed', 'triangle'],
  ['composition', 'Composed of (owns)', 'solid', 'filledDiamond'],
  ['aggregation', 'Aggregates (shares)', 'solid', 'diamond'],
  ['association', 'Association', 'solid', 'open'],
  ['dependency', 'Depends on', 'dashed', 'open'],
];

/** The key: the kinds of relation drawn, nothing else. UML readers know the ends; the key is for everyone else. */
function classKey(edges: GraphEdge[]): LegendItem[] {
  const kinds = new Set(edges.map((e) => e.kind));
  return KEY.filter(([k]) => kinds.has(k)).map(([, label, line, end]) => ({ label, line, end }));
}

// ---------------------------------------------------------------- references

function references(src: ClassSource): Reference[] {
  const out: Reference[] = [];
  const classes = src.classes ?? {};
  const is = (id: string) => Object.hasOwn(classes, id);
  for (const [id, raw] of Object.entries(classes)) {
    if (!raw || typeof raw !== 'object') continue;
    if (typeof raw.package === 'string') out.push({ path: ['classes', id, 'package'], id: raw.package, start: 0, collection: 'packages' });
    for (const key of ['extends', 'implements'] as const) {
      const v = raw[key];
      if (typeof v === 'string' && is(v)) out.push({ path: ['classes', id, key], id: v, start: 0, collection: 'classes' });
      if (Array.isArray(v)) for (const [i, x] of v.entries()) if (typeof x === 'string' && is(x)) out.push({ path: ['classes', id, key, i], id: x, start: 0, collection: 'classes' });
    }
  }
  for (const [id, raw] of Object.entries(src.packages ?? {}))
    if (raw && typeof raw === 'object' && typeof raw.parent === 'string') out.push({ path: ['packages', id, 'parent'], id: raw.parent, start: 0, collection: 'packages' });
  for (const r of readRelations(src.relations))
    for (const [name, start] of [[r.a, r.at!.a], [r.b, r.at!.b]] as const)
      if (is(name)) out.push({ path: r.path, ...(r.at!.keyed ? { key: true } : {}), id: name, start, collection: 'classes' });
  return out;
}

// ---------------------------------------------------------------- schema

const strings = { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] };
const member = {
  anyOf: [
    { type: 'string', description: 'Visibility (+ public, - private, # protected, ~ package), then "name: Type" or "operation(param: Type): Result"; {static} or {abstract} before the name' },
    { type: 'object', maxProperties: 1, additionalProperties: { type: ['string', 'null'] } },
  ],
};
const classEntry = {
  type: 'object',
  properties: {
    kind: { enum: classKinds, description: 'class (default), interface, abstract, enum or record' },
    label: { type: 'string', description: 'What it is called, when that differs from its key' },
    generic: { type: 'string', description: 'Type parameters: T, or K, V' },
    stereotype: { ...strings, description: 'aggregate root, value object, entity, service…: drawn «like this»' },
    package: { type: 'string', description: 'The package it is in' },
    extends: { ...strings, description: 'The class (or interface, for an interface) it extends' },
    implements: { ...strings, description: 'The interfaces it implements' },
    members: { type: 'array', items: member, description: 'Attributes and operations: "+name: Type", "+total(): Money"' },
    values: { type: 'array', items: { type: ['string', 'number'] }, description: 'An enum’s values' },
    tone: { enum: tones },
    description: { type: 'string' },
    link: { type: 'string', description: 'A URL, another diagram (other.yaml) or a view (other.yaml#view)' },
    links: { type: 'array' },
  },
  additionalProperties: false,
};
const relationProps = {
  anyOf: [
    { type: 'string', description: 'The name of the association' },
    {
      type: 'object',
      properties: {
        label: { type: 'string' },
        role: { type: 'string', description: 'The role name at the second end' },
        roles: { type: 'array', items: { type: ['string', 'null'] }, maxItems: 2, description: 'Role names at the first and the second end' },
        multiplicity: { type: 'array', items: { type: ['string', 'null'] }, maxItems: 2, description: 'Multiplicities at the first and the second end: ["1", "0..*"]' },
      },
      additionalProperties: false,
    },
    { type: 'null' },
  ],
};

const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Cartography class diagram',
  type: 'object',
  required: ['type'],
  properties: {
    type: { const: 'class' },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    direction: { enum: ['down', 'right'], description: 'down (default): parents above their children' },
    packages: {
      type: 'object',
      propertyNames: { pattern: idPattern },
      additionalProperties: {
        anyOf: [{ type: 'null' }, { type: 'string' }, { type: 'object', properties: { label: { type: 'string' }, caption: { type: 'string' }, parent: { type: 'string' }, tone: { enum: tones } }, additionalProperties: false }],
      },
    },
    classes: {
      type: 'object',
      propertyNames: { pattern: idPattern },
      additionalProperties: { anyOf: [{ type: 'null' }, { enum: classKinds }, classEntry] },
    },
    relations: {
      type: 'array',
      items: {
        anyOf: [
          { type: 'string', description: 'A --|> B, A ..|> B, A *-- B, A o-- B, A --> B, A -- B, A ..> B; multiplicities in quotes: A "1" *-- "0..*" B' },
          { type: 'object', minProperties: 1, maxProperties: 1, additionalProperties: relationProps },
        ],
      },
    },
  },
  additionalProperties: false,
};

export const classDiagram: DiagramType<ClassSource> = {
  id: 'class',
  name: 'Class diagram',
  description: 'UML classes, interfaces and enums with their members, and how they relate: extends, implements, composition, association',
  icon: 'box',
  tagline: 'Classes, interfaces and their members, with UML relations',
  useWhen: ['A domain model: aggregates, entities and value objects', 'A design pattern or a module’s types for a design doc', 'What extends and implements what in a codebase', 'Review an API’s types before writing them'],
  notFor: [
    { text: 'Tables, columns and foreign keys', use: 'erd' },
    { text: 'The components inside a service', use: 'c4' },
    { text: 'Bounded contexts and how they relate', use: 'context-map' },
  ],
  keywords: ['class', 'class diagram', 'uml', 'uml class', 'interface', 'inheritance', 'extends', 'implements', 'generalization', 'realization', 'composition', 'aggregation', 'association', 'domain model', 'aggregate', 'value object', 'entity', 'oop', 'object model', 'type hierarchy', 'design pattern', 'enum', 'record'],
  schema,
  palette: [
    { collection: 'classes', kind: 'class', label: 'Class', icon: 'box', tone: 'blue', keywords: ['entity', 'type'] },
    { collection: 'classes', kind: 'interface', label: 'Interface', icon: 'circle-dot', tone: 'teal', keywords: ['protocol', 'contract', 'port'] },
    { collection: 'classes', kind: 'abstract', label: 'Abstract class', icon: 'square-dashed', tone: 'indigo', keywords: ['base class'] },
    { collection: 'classes', kind: 'enum', label: 'Enum', icon: 'list-checks', tone: 'amber', keywords: ['enumeration', 'status'] },
    { collection: 'classes', kind: 'record', label: 'Record', icon: 'braces', tone: 'violet', keywords: ['value object', 'data class', 'struct'] },
    { collection: 'packages', kind: 'package', label: 'Package', icon: 'package', tone: 'slate', keywords: ['namespace', 'module'] },
  ],
  build,
  references,
  // Parents above their children, whatever shape the slide has.
  tuning: { autoDirection: false, wrap: false },
  connect(src, from, to) {
    if (!src.classes || !Object.hasOwn(src.classes, from) || !Object.hasOwn(src.classes, to)) return 'Connect one class to another';
    return { path: ['relations'], value: `${from} --> ${to}` };
  },
  refKeys: { package: ['packages'], extends: ['classes'], implements: ['classes'], parent: ['packages'] },
  shorthand(collection, value) {
    if (collection === 'classes') return classShorthand(value) as Record<string, unknown>;
    if (collection === 'packages' && typeof value === 'string') return { label: value };
    return undefined;
  },
  template: `type: class
title: Order aggregate
subtitle: Ordering context, domain layer
direction: right

classes:
  Order:
    stereotype: aggregate root
    members:
      - -id: OrderId
      - -status: OrderStatus
      - -placedAt: Instant
      - "+addLine(product: ProductId, quantity: Int): void"
      - +place(): void
      - +total(): Money
  OrderLine:
    stereotype: entity
    members:
      - -product: ProductId
      - -quantity: Int
      - +subtotal(): Money
  Money:
    kind: record
    stereotype: value object
    members:
      - +amount: Decimal
      - +currency: Currency
      - "+add(other: Money): Money"
  OrderStatus:
    kind: enum
    values: [Draft, Placed, Paid, Shipped, Cancelled]
  OrderRepository:
    kind: interface
    members:
      - "+byId(id: OrderId): Order"
      - "+save(order: Order): void"

relations:
  - Order "1" *-- "1..*" OrderLine: { role: lines }
  - Order --> OrderStatus
  - OrderLine --> Money: { role: price }
  - OrderRepository ..> Order: stores
`,
};
