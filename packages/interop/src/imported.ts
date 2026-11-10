// What an import from a drawing tool comes to, before it is YAML: groups, nodes, connections and
// tables, with what was left out. One writer turns that into Cartography YAML, a layout sidecar
// (when the positions are kept) and a report in plain words.
import type { Box, LayoutSidecar } from '@cartography/core';
import { config as azure } from '@cartography/azure';
import { config as cloud } from '@cartography/cloud';
import { config as github } from '@cartography/github';
import { config as kubernetes } from '@cartography/kubernetes';
import { config as network } from '@cartography/network';
import { kinds as sequenceKinds } from '@cartography/sequence';
import { config as systems } from '@cartography/systems';
import { guessKind } from '@cartography/import';

export type Line = 'solid' | 'dashed' | 'dotted';
/** The end of a relation between tables, as the ERD type names it. */
export type End = 'none' | 'arrow' | 'one' | 'zeroOrOne' | 'many' | 'oneOrMany' | 'zeroOrMany';

export interface InGroup {
  id: string;
  label: string;
  kind?: string;
  caption?: string;
  parent?: string;
  /** The colour it was given, by name (blue, teal); written where the type takes one. */
  tone?: string;
  box?: Box;
}

export interface InNode {
  id: string;
  label: string;
  kind?: string;
  caption?: string;
  parent?: string;
  box?: Box;
}

export interface InEdge {
  /** A node or group id; `table.column` between tables. */
  from: string;
  to: string;
  label?: string;
  line: Line;
  start: End;
  end: End;
  /** The name of a line style ("Private network") or its id (private). */
  style?: string;
  badge?: boolean;
}

export interface InColumn {
  id: string;
  type?: string;
  /** pk, fk, unique, null, pii */
  marks: string[];
}

export interface InTable {
  id: string;
  label: string;
  caption?: string;
  /** The schema it is in: one of the groups. */
  parent?: string;
  columns: InColumn[];
  box?: Box;
}

export interface InMessage {
  from: string;
  to: string;
  arrow: 'sync' | 'async' | 'reply' | 'lost';
  label?: string;
}

export interface InDiagram {
  /** The page or file it came from. */
  name?: string;
  /** systems, azure, cloud, kubernetes, network, github, erd or sequence. */
  type: string;
  provider?: string;
  title?: string;
  subtitle?: string;
  direction?: 'right' | 'down';
  groups: InGroup[];
  nodes: InNode[];
  edges: InEdge[];
  tables: InTable[];
  /** A sequence: the nodes are its participants. */
  messages?: InMessage[];
  /** The positions are Cartography's own (a file it wrote): kept as they are, not spread to fit its cards. */
  exact?: boolean;
  /** Text that belonged to no shape. */
  texts: string[];
  /** What could not be brought along, one line each. */
  dropped: string[];
}

export interface ImportedDiagram {
  name?: string;
  type: string;
  yaml: string;
  /** Pins for <name>.layout.json; only with keepPositions. */
  sidecar?: LayoutSidecar;
  /** What was mapped and what was dropped, one line each. */
  report: string[];
}

export interface ImportOptions {
  /** Keep where the shapes were, as pins in the layout sidecar. Default: Cartography lays it out. */
  keepPositions?: boolean;
  /** The title when the drawing has none (the file name). */
  title?: string;
}

interface Kinds {
  nodeKinds: Record<string, { label: string }>;
  groupKinds: Record<string, { label: string; keywords?: string[] }>;
  edgeStyles?: Record<string, { label: string; line: Line }>;
  kindAliases?: Record<string, string>;
}

/** The types that are written as groups, nodes and edges, with the kinds each one knows. */
export const graphTypes: Record<string, Kinds> = { systems, azure, cloud, kubernetes, network, github };

/** A Cartography id ([A-Za-z0-9_-]) from any label. */
export function slug(s: string): string {
  const out = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  return out || 'item';
}

/** Hands out unique ids, the same one each time for the same source id. */
export class Ids {
  private bySource = new Map<string, string>();
  private used = new Set<string>();
  get(source: string, prefer: string): string {
    let id = this.bySource.get(source);
    if (id) return id;
    const base = slug(prefer).toLowerCase().slice(0, 40).replace(/-$/, '') || 'item';
    id = base;
    for (let n = 2; this.used.has(id); n++) id = `${base}-${n}`;
    this.used.add(id);
    this.bySource.set(source, id);
    return id;
  }
  find(source: string): string | undefined {
    return this.bySource.get(source);
  }
}

const RESERVED = /^(true|false|yes|no|on|off|y|n|null|~|[-+]?(\d[\d_]*(\.\d*)?|\.\d+)(e[-+]?\d+)?|0x[0-9a-f]+|\.inf|\.nan)$/i;

/** A YAML scalar, plain when that is safe inside flow maps and after "key: ", quoted otherwise. */
export function scalar(s: string): string {
  if (/^[A-Za-z_(][\w .\/()+'&-]*$/.test(s) && !/\s$/.test(s) && !RESERVED.test(s)) return s;
  return JSON.stringify(s);
}

/** `{ kind: database, label: Orders }` with values in the given order, undefined left out. */
function flow(entries: [string, string | undefined][]): string {
  const parts = entries.filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v === 'true' ? v : scalar(v!)}`);
  return parts.length ? `{ ${parts.join(', ')} }` : '{}';
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The kind a type knows for a name, by id, alias or label; undefined when it knows none. */
export function knownKind(table: Record<string, { label: string }>, aliases: Record<string, string> | undefined, name: string | undefined): string | undefined {
  if (!name) return undefined;
  const n = slug(name).toLowerCase();
  if (table[n]) return n;
  const alias = aliases?.[n];
  if (alias && table[alias]) return alias;
  return Object.keys(table).find((k) => slug(table[k]!.label).toLowerCase() === n);
}

/** Name prefixes people give Azure resources (the Cloud Adoption Framework's), as the group they name. */
const PREFIX: Record<string, string> = { rg: 'resource-group', vnet: 'vnet', snet: 'subnet', sub: 'subscription', mg: 'management-group', aks: 'aks-cluster', vpc: 'vpc', ns: 'namespace', vlan: 'vlan' };

/** The group kind the words of a label name ("Virtual network", "rg-shop-prod"); the longest name wins. */
export function guessGroup(table: Record<string, { label: string; keywords?: string[] }>, text: string): string | undefined {
  const words = ` ${text.toLowerCase().replace(/[^a-z0-9-]+/g, ' ')} `;
  let best: { kind: string; length: number } | undefined;
  for (const [kind, k] of Object.entries(table)) {
    if (kind === 'group' || kind === 'boundary') continue;
    for (const name of [kind.replace(/-/g, ' '), kind, k.label.toLowerCase(), ...(k.keywords ?? [])]) {
      if (name.length > (best?.length ?? 2) && words.includes(` ${name.toLowerCase()} `)) best = { kind, length: name.length };
    }
  }
  if (best) return best.kind;
  const prefix = PREFIX[/^\s*([a-z]+)[-_]/i.exec(text)?.[1]?.toLowerCase() ?? ''];
  return prefix && table[prefix] ? prefix : undefined;
}

/** The ERD type's word for the end of a relation. */
const side: Partial<Record<End, string>> = { zeroOrOne: 'zero-or-one', one: 'one', many: 'many', zeroOrMany: 'many', oneOrMany: 'one-or-many' };

/** Room a Cartography card needs, with the gap to the next one and a group's header between rows. */
const CARD = { width: 264, height: 124 };

/**
 * How far apart the shapes of another tool must move to hold Cartography's cards: an icon of 60 px
 * becomes a card of 220. Each pair is kept apart along the side it was already furthest apart on.
 */
function spread(boxes: Box[]): [number, number] {
  let sx = 1;
  let sy = 1;
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      const dx = Math.abs(a.x - b.x);
      const dy = Math.abs(a.y - b.y);
      if (dx / CARD.width >= dy / CARD.height) sx = Math.max(sx, CARD.width / Math.max(dx, 1));
      else sy = Math.max(sy, CARD.height / Math.max(dy, 1));
    }
  }
  return [Math.min(sx, 8), Math.min(sy, 8)];
}

/** Cartography YAML for an imported diagram, its pins and the report. */
export function writeImported(d: InDiagram, opts: ImportOptions = {}): ImportedDiagram {
  const report: string[] = [];
  const title = d.title ?? opts.title;
  const out: string[] = [`type: ${d.type}`];
  if (d.provider) out.push(`provider: ${d.provider}`);
  if (title) out.push(`title: ${scalar(title)}`);
  if (d.subtitle) out.push(`subtitle: ${scalar(d.subtitle)}`);

  if (d.type === 'erd') {
    if (d.groups.length) {
      out.push('', 'schemas:');
      // "Schema" is what a schema is called when it has no caption of its own.
      for (const g of d.groups) out.push(`  ${g.id}: ${flow([['label', g.label === g.id ? undefined : g.label], ['caption', g.caption === 'Schema' ? undefined : g.caption], ['tone', g.tone]])}`);
    }
    const schemas = new Set(d.groups.map((g) => g.id));
    out.push('', 'tables:');
    const tableIds = new Set(d.tables.map((t) => t.id));
    // A relation that starts at a column is that column's foreign key; the others are listed.
    const fk = new Map<string, string>();
    const relations: InEdge[] = [];
    for (const e of d.edges) {
      const [ft, fc] = e.from.split('.');
      const [tt] = e.to.split('.');
      if (!tableIds.has(ft!) || !tableIds.has(tt!)) continue;
      // What the column itself says about both ends; a relation is only written when the line says more.
      const column = fc ? d.tables.find((t) => t.id === ft)?.columns.find((c) => c.id === fc) : undefined;
      const soleKey = d.tables.find((t) => t.id === ft)?.columns.filter((c) => c.marks.includes('pk')).length === 1;
      const implied = column && [column.marks.includes('unique') || (column.marks.includes('pk') && soleKey) ? 'zeroOrOne' : 'zeroOrMany', column.marks.includes('null') ? 'zeroOrOne' : 'one'];
      const plain = !side[e.start] || !side[e.end] || (implied && implied[0] === e.start && implied[1] === e.end);
      if (column && !fk.has(e.from)) {
        fk.set(e.from, e.to);
        if (e.label || !plain) relations.push(e);
      } else relations.push(e);
    }
    const relation = (e: InEdge) => {
      const cardinality = side[e.start] && side[e.end] && `${side[e.start]}-to-${side[e.end]}` !== 'many-to-one' ? `${side[e.start]}-to-${side[e.end]}` : undefined;
      return cardinality || e.label ? `  - ${e.from} -> ${e.to}: ${flow([['cardinality', cardinality], ['label', e.label]])}` : `  - ${e.from} -> ${e.to}`;
    };
    for (const t of d.tables) {
      out.push(`  ${t.id}:`);
      if (t.label !== t.id) out.push(`    label: ${scalar(t.label)}`);
      if (t.caption) out.push(`    caption: ${scalar(t.caption)}`);
      if (t.parent && schemas.has(t.parent)) out.push(`    schema: ${t.parent}`);
      out.push('    columns:');
      if (!t.columns.length) out[out.length - 1] = '    columns: {}';
      for (const c of t.columns) {
        const target = fk.get(`${t.id}.${c.id}`);
        const marks = c.marks.filter((m) => m !== 'fk' || !target).map((m) => (m === 'fk' ? undefined : m)).filter(Boolean);
        // A nullable column is drawn as "uuid?"; the mark says it once.
        const type = c.type && c.marks.includes('null') ? c.type.replace(/\?$/, '') : c.type;
        const words = [type || 'text', ...marks, ...(target ? [`fk ${target}`] : [])].join(' ');
        out.push(`      ${/^[A-Za-z_][\w-]*$/.test(c.id) ? c.id : JSON.stringify(c.id)}: ${scalar(words)}`);
      }
    }
    if (relations.length) {
      out.push('', 'relations:');
      for (const e of relations) out.push(relation(e));
    }
    const untyped = d.tables.reduce((n, t) => n + t.columns.filter((c) => !c.type).length, 0);
    report.push(`${plural(d.tables.length, 'table')} with ${plural(d.tables.reduce((n, t) => n + t.columns.length, 0), 'column')}, ${plural(new Set([...fk.keys(), ...relations.map((e) => e.from + e.to)]).size, 'relation')}`);
    if (untyped) report.push(`${plural(untyped, 'column')} had no type: written as text`);
  } else if (d.type === 'sequence') {
    out.push('', 'participants:');
    for (const n of d.nodes) {
      const kind = n.kind && sequenceKinds[n.kind] ? n.kind : undefined;
      const said = kind ? sequenceKinds[kind]!.label : undefined;
      const label = n.label === said || n.label === n.id ? undefined : n.label;
      const caption = n.caption === said ? undefined : n.caption;
      out.push(`  ${n.id}: ${kind && !label && !caption ? kind : flow([['kind', kind], ['label', label], ['caption', caption]])}`);
    }
    out.push('', 'steps:');
    const op = { sync: '->', async: '->>', reply: '-->', lost: '-x' };
    for (const m of d.messages ?? []) out.push(`  - ${m.from} ${op[m.arrow]} ${m.to}${m.label ? `: ${scalar(m.label)}` : ''}`);
    report.push(`${plural(d.nodes.length, 'participant')}, ${plural(d.messages?.length ?? 0, 'message')}`);
    report.push('Notes, frames (alt, loop) and activations of the sequence are not read back');
  } else {
    const kinds = graphTypes[d.type] ?? systems;
    if (d.direction === 'down') out.push('direction: down');
    const groupIds = new Set(d.groups.map((g) => g.id));
    let guessed = 0;
    const entry = (id: string, kind: string, label: string, caption: string | undefined, parent: string | undefined, known: Record<string, { label: string }>) => {
      const l = label === known[kind]?.label ? undefined : label;
      const c = caption === undefined || caption === known[kind]?.label ? undefined : caption;
      return l === undefined && c === undefined && parent === undefined ? `  ${id}: ${kind}` : `  ${id}: ${flow([['kind', kind], ['label', l], ['caption', c], ['in', parent]])}`;
    };
    if (d.groups.length) {
      out.push('', 'groups:');
      const fallback = kinds.groupKinds.group ? 'group' : kinds.groupKinds.boundary ? 'boundary' : Object.keys(kinds.groupKinds)[0]!;
      for (const g of d.groups) {
        const kind = knownKind(kinds.groupKinds, kinds.kindAliases, g.kind) ?? guessGroup(kinds.groupKinds, `${g.label} ${g.caption ?? ''}`) ?? fallback;
        out.push(entry(g.id, kind, g.label, g.caption, g.parent && groupIds.has(g.parent) ? g.parent : undefined, kinds.groupKinds));
      }
    }
    if (d.nodes.length) {
      out.push('', 'nodes:');
      const fallback = kinds.nodeKinds.service ? 'service' : kinds.nodeKinds.server ? 'server' : Object.keys(kinds.nodeKinds)[0]!;
      for (const n of d.nodes) {
        let kind = knownKind(kinds.nodeKinds, kinds.kindAliases, n.kind);
        if (!kind) {
          // No kind the type knows: the words of the label say what it is, where they can.
          kind = knownKind(kinds.nodeKinds, kinds.kindAliases, guessKind(`${n.label} ${n.kind ?? ''}`)) ?? fallback;
          guessed++;
        }
        out.push(entry(n.id, kind, n.label, n.caption, n.parent && groupIds.has(n.parent) ? n.parent : undefined, kinds.nodeKinds));
      }
    }
    const styles = kinds.edgeStyles ?? {};
    const styleId = (name: string | undefined) => (name === undefined ? undefined : styles[name] ? name : Object.keys(styles).find((k) => styles[k]!.label === name));
    if (d.edges.length) {
      out.push('', 'edges:');
      for (const e of d.edges) {
        const style = styleId(e.style);
        // The style brings its own line; without one the arrow says dashed or dotted.
        const line = style ? 'solid' : e.line;
        const both = e.start !== 'none' && e.end !== 'none';
        const none = e.start === 'none' && e.end === 'none';
        const reversed = e.start !== 'none' && e.end === 'none';
        const op = both ? '<->' : none ? '--' : line === 'dashed' ? '-->' : line === 'dotted' ? '..>' : '->';
        const arrow = reversed ? `${e.to} ${op} ${e.from}` : `${e.from} ${op} ${e.to}`;
        const lineProp = style && e.line !== styles[style]!.line ? e.line : !style && (both || none) && e.line !== 'solid' ? e.line : undefined;
        if (style || e.badge || lineProp) out.push(`  - ${arrow}: ${flow([['label', e.label], ['style', style], ['line', lineProp], ['badge', e.badge ? 'true' : undefined]])}`);
        else if (e.label) out.push(`  - ${arrow}: ${scalar(e.label)}`);
        else out.push(`  - ${arrow}`);
      }
    }
    report.push(`${plural(d.nodes.length, 'node')}, ${plural(d.groups.length, 'group')}, ${plural(d.edges.length, 'connection')}`);
    if (guessed) report.push(`${plural(guessed, 'node')} had no kind this type knows: guessed from the label, or drawn as a plain ${kinds.nodeKinds.service ? 'service' : 'box'}`);
  }

  if (d.texts.length) report.push(`Loose text, not part of a shape, left out: ${d.texts.map((t) => `"${t.length > 60 ? `${t.slice(0, 57)}...` : t}"`).join(', ')}`);
  report.push(...d.dropped);

  let sidecar: LayoutSidecar | undefined;
  if (opts.keepPositions) {
    const boxes = [...d.nodes, ...d.tables].filter((n): n is typeof n & { box: Box } => !!n.box);
    if (boxes.length) {
      const x0 = Math.min(...boxes.map((n) => n.box.x));
      const y0 = Math.min(...boxes.map((n) => n.box.y));
      const [sx, sy] = d.exact ? [1, 1] : spread(boxes.map((n) => n.box));
      sidecar = { version: 1, nodes: Object.fromEntries(boxes.map((n) => [n.id, { x: Math.round((n.box.x - x0) * sx), y: Math.round((n.box.y - y0) * sy) }])) };
      report.push(`Positions kept: ${plural(boxes.length, 'pin')} for the layout file`);
    }
  }
  return { ...(d.name ? { name: d.name } : {}), type: d.type, yaml: out.join('\n') + '\n', ...(sidecar ? { sidecar } : {}), report };
}
