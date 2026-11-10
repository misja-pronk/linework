// "Save as block…": the selected entries with the groups they sit in, what a selected group holds,
// and the lines between them, written as a block file with the parameters chosen.
import { Document } from 'yaml';
import type { DiagramType, Path, Point, Reference } from '@cartography/core';
import { parseBlock, type Block, type BlockParam } from './block.ts';
import { PARENT_KEYS, renameIn } from './insert.ts';

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const LABEL_KEYS = ['label', 'name', 'title'];

export interface Selected {
  /** Entries by collection, ids in the order written. */
  entries: { collection: string; id: string; value: unknown }[];
  /** Lines (list items) whose ends are all in the selection. */
  items: { collection: string; value: unknown }[];
  /** Fields that named something outside and were left out (an `in:` to a group not taken along). */
  cut: string[];
}

/**
 * What a block of these entries holds: each with the groups it sits in (so it lands in the same
 * kind of place), everything inside a selected group, and the lines among them.
 */
export function gather(data: Record<string, unknown>, type: DiagramType, paths: Path[]): Selected {
  const refs: Reference[] = type.references?.(data as never) ?? [];
  const key = (c: string, id: string) => `${c}\0${id}`;
  const exists = (c: string, id: string) => isMap(data[c]) && Object.hasOwn(data[c] as object, id);
  const chosen = new Set(paths.filter((p) => p.length === 2 && typeof p[1] === 'string' && exists(String(p[0]), String(p[1]))).map((p) => key(String(p[0]), String(p[1]))));
  const pks = new Set(Object.keys({ ...PARENT_KEYS, ...type.refKeys }));
  const parentRefs = refs.filter((r) => r.path.length === 3 && typeof r.path[1] === 'string' && pks.has(String(r.path[2])));
  // Up: the groups an entry sits in. Down: what sits in a selected group (the selection as it was, so going up does not take the whole world).
  const down = new Set(chosen);
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of parentRefs) {
      const child = key(String(r.path[0]), String(r.path[1]));
      if (down.has(key(r.collection, r.id)) && !down.has(child)) down.add(child), (grew = true);
    }
  }
  const all = new Set(down);
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of parentRefs) {
      const parent = key(r.collection, r.id);
      if (all.has(key(String(r.path[0]), String(r.path[1]))) && exists(r.collection, r.id) && !all.has(parent)) all.add(parent), (grew = true);
    }
  }
  const entries: Selected['entries'] = [];
  for (const [c, v] of Object.entries(data)) if (isMap(v)) for (const [id, e] of Object.entries(v)) if (all.has(key(c, id))) entries.push({ collection: c, id, value: structuredClone(e ?? null) });
  // Lines whose every end came along.
  const byItem = new Map<string, { path: Path; all: boolean }>();
  for (const r of refs) {
    if (typeof r.path[1] !== 'number') continue;
    const k = JSON.stringify(r.path.slice(0, 2));
    const was = byItem.get(k) ?? { path: r.path.slice(0, 2), all: true };
    byItem.set(k, { path: was.path, all: was.all && all.has(key(r.collection, r.id)) });
  }
  const items = [...byItem.values()].filter((x) => x.all).map((x) => ({ collection: String(x.path[0]), value: structuredClone((data[String(x.path[0])] as unknown[])[x.path[1] as number]) }));
  // Fields that name an entry left behind go: the block would not draw on its own with them.
  const cut: string[] = [];
  for (const r of refs) {
    if (typeof r.path[1] !== 'string' || all.has(key(r.collection, r.id)) || !all.has(key(String(r.path[0]), String(r.path[1])))) continue;
    const e = entries.find((x) => x.collection === r.path[0] && x.id === r.path[1]);
    if (e && isMap(e.value) && r.path.length === 3 && typeof r.path[2] === 'string') {
      delete e.value[r.path[2]];
      cut.push(`${r.path[1]}.${r.path[2]}: ${r.id}`);
    }
  }
  return { entries, items, cut };
}

/** A shared start of the ids ("shop" in shop-web, shop-db): what a `name` parameter would stand for. */
export function idPrefix(ids: string[]): string | undefined {
  if (ids.length < 2) return undefined;
  const counts = new Map<string, number>();
  for (const id of ids) {
    const first = id.split(/[-_]/)[0]!;
    if (first && first !== id) counts.set(first, (counts.get(first) ?? 0) + 1);
    else if (first) counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  const [best, n] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
  return best && n! >= 2 && n! >= ids.length / 2 && /^[A-Za-z][\w]*$/.test(best) ? best : undefined;
}

export interface LabelChoice {
  collection: string;
  id: string;
  key: string;
  label: string;
  /** A parameter name for it. */
  param: string;
  /** Says something about this one use (the prefix, a name, a number): worth asking for. */
  suggested: boolean;
}

/** The labels of the entries a block would hold, each with a parameter it could become. */
export function labelChoices(sel: Selected, prefix?: string): LabelChoice[] {
  const out: LabelChoice[] = [];
  const used = new Set<string>(['name']);
  for (const e of sel.entries) {
    if (!isMap(e.value)) continue;
    const k = LABEL_KEYS.find((x) => typeof (e.value as Record<string, unknown>)[x] === 'string');
    if (!k) continue;
    const label = (e.value as Record<string, string>)[k]!;
    const rest = prefix && e.id.startsWith(prefix) ? e.id.slice(prefix.length).replace(/^[-_]/, '') : e.id;
    let param = `${rest || e.id}-label`.replace(/[^\w-]/g, '-').replace(/^[^A-Za-z_]+/, '') || 'label';
    for (let n = 2; used.has(param); n++) param = `${rest || e.id}-label-${n}`;
    used.add(param);
    // Names that belong to one system: the prefix in it, a digit, an environment word.
    const suggested = (!!prefix && label.toLowerCase().includes(prefix.toLowerCase())) || /\d|\b(prod|dev|test|acc|staging)\b/i.test(label);
    out.push({ collection: e.collection, id: e.id, key: k, label, param, suggested });
  }
  return out;
}

export interface BlockSpec {
  name: string;
  title: string;
  description?: string;
  tags?: string[];
  /** The ids' shared start becomes ${name} (param `name`, with this default). */
  prefix?: string;
  /** Labels that become parameters, their own text the default. */
  labels?: LabelChoice[];
  /** Top-left of drawn nodes and groups (any origin): kept relative, as the block's pins. */
  positions?: { nodes?: Record<string, Point>; groups?: Record<string, Point> };
}

/** The block file for a selection: YAML to write to blocks/<name>.block.yaml, and the block it reads as. */
export function blockText(type: DiagramType, sel: Selected, spec: BlockSpec): { text: string; block: Block } {
  let body: Record<string, unknown> = {};
  for (const e of sel.entries) ((body[e.collection] ??= {}) as Record<string, unknown>)[e.id] = e.value;
  for (const it of sel.items) ((body[it.collection] ??= []) as unknown[]).push(it.value);
  const params: BlockParam[] = [];
  const rename = new Map<string, string>();
  if (spec.prefix) {
    const p = spec.prefix;
    for (const e of sel.entries) if (e.id === p || e.id.startsWith(`${p}-`) || e.id.startsWith(`${p}_`)) rename.set(e.id, '${name}' + e.id.slice(p.length));
    params.push({ name: 'name', default: p, label: 'Name' });
    body = renameIn(type, body, rename);
  }
  for (const l of spec.labels ?? []) {
    const e = (body[l.collection] as Record<string, Record<string, unknown>> | undefined)?.[rename.get(l.id) ?? l.id];
    if (!isMap(e)) continue;
    e[l.key] = `\${${l.param}}`;
    params.push({ name: l.param, default: l.label, label: `${l.label} (${l.key})` });
  }
  // With a name parameter, labels that spell the prefix as it is written say ${name} there too.
  if (spec.prefix) {
    const word = new RegExp(`(^|[^A-Za-z0-9])${spec.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^A-Za-z0-9])`, 'g');
    for (const v of Object.values(body))
      if (isMap(v))
        for (const e of Object.values(v))
          if (isMap(e)) for (const k of LABEL_KEYS) if (typeof e[k] === 'string' && !(e[k] as string).includes('${')) e[k] = (e[k] as string).replace(word, (_, before: string) => `${before}\${name}`);
  }
  const doc = new Document({});
  const top = (k: string, v: unknown, flow?: boolean) => doc.set(k, doc.createNode(v, { flow }));
  top('type', type.id);
  top('title', spec.title);
  if (spec.description) top('description', spec.description);
  if (spec.tags?.length) top('tags', spec.tags, true);
  if (params.length) {
    const node = doc.createNode(Object.fromEntries(params.map((p) => [p.name, { default: p.default, ...(p.label ? { label: p.label } : {}) }]))) as { items: { value: { flow?: boolean } }[] };
    for (const p of node.items) p.value.flow = true;
    doc.set('params', node);
  }
  for (const [c, v] of Object.entries(body)) {
    const node = doc.createNode(v);
    // One line per entry, as diagrams are written.
    for (const it of (node as { items: { value?: { flow?: boolean }; flow?: boolean }[] }).items) {
      if (Array.isArray(v)) {
        const m = it as unknown as { items?: { value?: { flow?: boolean } }[]; flow?: boolean };
        if (m.items?.length === 1 && m.items[0]!.value && typeof m.items[0]!.value === 'object') m.items[0]!.value.flow = true;
      } else if (it.value && typeof it.value === 'object') it.value.flow = true;
    }
    doc.set(c, node);
  }

  const pins = spec.positions && relativePins(spec.positions, rename, sel);
  if (pins) {
    const node = doc.createNode(pins) as { items: { value: { items: { value: { flow?: boolean } }[] } }[] };
    for (const kind of node.items) for (const p of kind.value.items) p.value.flow = true;
    doc.set('pins', node);
  }
  doc.commentBefore = ` ${spec.title}: a Cartography block (docs/blocks.md). Insert it from the Blocks section of the shapes panel,\n or: carto blocks insert ${spec.name} into <file.yaml>`;
  // A blank line before each section, as diagrams are written.
  const text = doc.toString({ lineWidth: 0, flowCollectionPadding: true }).replace(/\n(?=(?!type:|title:|description:|tags:|params:)[A-Za-z$][^\s:]*:)/g, '\n\n');
  return { text, block: parseBlock(text, spec.name).block! };
}

/** Positions of what the block holds, from its own top-left. */
function relativePins(pos: NonNullable<BlockSpec['positions']>, rename: Map<string, string>, sel: Selected) {
  const have = new Set(sel.entries.map((e) => e.id));
  const pick = (m: Record<string, Point> | undefined) => Object.entries(m ?? {}).filter(([id]) => have.has(id));
  const nodes = pick(pos.nodes);
  const groups = pick(pos.groups);
  const all = [...nodes, ...groups].map(([, p]) => p);
  if (!all.length) return undefined;
  const x0 = Math.min(...all.map((p) => p.x));
  const y0 = Math.min(...all.map((p) => p.y));
  const rel = (list: [string, Point][]) => Object.fromEntries(list.map(([id, p]) => [rename.get(id) ?? id, { x: Math.round(p.x - x0), y: Math.round(p.y - y0) }]));
  return { ...(nodes.length ? { nodes: rel(nodes) } : {}), ...(groups.length ? { groups: rel(groups) } : {}) };
}
