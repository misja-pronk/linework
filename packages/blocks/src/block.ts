// A block: a fixed fragment of one diagram type (a hub with its firewall and bastion, an App Service
// with its Key Vault and SQL behind private endpoints), kept as blocks/<name>.block.yaml and inserted
// as plain YAML. `${name}` in ids and labels is a parameter, asked for on insert (docs/blocks.md).
import { parse, stringify } from 'yaml';
import { parseSource, validate, type DiagramType, type Point } from '@cartography/core';

export interface BlockParam {
  name: string;
  default: string;
  /** How the insert form asks for it ("Name of the app"). */
  label?: string;
}

export interface BlockPins {
  /** Top-left of each node, relative to the block's own top-left (ids as written, with ${…}). */
  nodes?: Record<string, Point>;
  groups?: Record<string, Point>;
}

export interface Block {
  /** The file name without .block.yaml: what `carto blocks insert <name>` and the instances say. */
  name: string;
  type: string;
  title: string;
  description?: string;
  tags: string[];
  params: BlockParam[];
  /** The collections it adds (nodes, groups, edges…), as written: ids may hold ${…}. */
  body: Record<string, unknown>;
  /** Top-level settings the fragment is drawn with (provider: aws) but that are not inserted. */
  context: Record<string, unknown>;
  pins?: BlockPins;
  /** What the instances record (name@hash): changes with the fragment and its parameters, not with its title or pins. */
  hash: string;
  text: string;
}

export interface BlockProblem {
  severity: 'error' | 'warning';
  message: string;
}

/** Keys of a block file that describe it; everything else is the fragment. */
export const BLOCK_KEYS = new Set(['type', 'title', 'description', 'tags', 'params', 'pins']);
/** Settings a diagram has once (its title, direction, steps): never part of a fragment. */
const DIAGRAM_SCALARS = new Set(['subtitle', 'direction', 'focus', 'steps', 'views', 'include', 'layers', 'theme', 'icons', 'badges', 'aspect', 'legend']);

export const BLOCK_SUFFIX = '.block.yaml';
export const isBlockFile = (path: string) => /\.block\.ya?ml$/i.test(path);
/** "blocks/app-stack.block.yaml" → "app-stack". */
export const blockNameOf = (path: string) => path.split('/').pop()!.replace(/\.block\.ya?ml$/i, '');
export const BLOCK_NAME = /^[a-z0-9][a-z0-9-]*$/;
/** "App Service stack" → "app-service-stack". */
export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'block';

const PLACEHOLDER = /\$\{([A-Za-z_][\w-]*)\}/g;
const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** FNV-1a over the fragment and its parameters, 8 hex digits: short enough for a comment, plenty to tell versions apart. */
export function hashOf(type: string, params: BlockParam[], body: Record<string, unknown>): string {
  const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : isMap(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  const s = JSON.stringify([type, params.map((p) => [p.name, p.default]), canon(body)]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Reads a block file; problems with the file itself (not with the fragment, see checkBlock) come back as errors. */
export function parseBlock(text: string, name: string): { block?: Block; problems: BlockProblem[] } {
  let data: unknown;
  try {
    data = parse(text);
  } catch (e) {
    return { problems: [{ severity: 'error', message: `Not YAML: ${(e as Error).message.split('\n')[0]}` }] };
  }
  if (!isMap(data)) return { problems: [{ severity: 'error', message: 'A block file is a map with type: and its nodes, groups and lines' }] };
  if (typeof data.type !== 'string' || !data.type) return { problems: [{ severity: 'error', message: 'A block needs type: (the diagram type it is a part of)' }] };
  const problems: BlockProblem[] = [];
  const params: BlockParam[] = [];
  if (data.params != null && !isMap(data.params)) problems.push({ severity: 'error', message: 'params: is a map: name: { default: shop }' });
  for (const [k, v] of Object.entries(isMap(data.params) ? data.params : {})) {
    if (!/^[A-Za-z_][\w-]*$/.test(k)) problems.push({ severity: 'error', message: `Parameter "${k}": letters, digits, - and _, starting with a letter` });
    const d = isMap(v) ? v.default : v;
    params.push({ name: k, default: d == null ? '' : String(d), ...(isMap(v) && typeof v.label === 'string' ? { label: v.label } : {}) });
  }
  const body: Record<string, unknown> = {};
  const context: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (BLOCK_KEYS.has(k)) continue;
    if (DIAGRAM_SCALARS.has(k)) problems.push({ severity: 'warning', message: `${k}: belongs to a diagram, not a block: it is left out on insert` });
    else if (v && typeof v === 'object') body[k] = v;
    else context[k] = v;
  }
  const pins = isMap(data.pins) ? (data.pins as BlockPins) : undefined;
  const tags = Array.isArray(data.tags) ? data.tags.map(String) : typeof data.tags === 'string' ? [data.tags] : [];
  const block: Block = {
    name,
    type: data.type,
    title: typeof data.title === 'string' ? data.title : name,
    ...(typeof data.description === 'string' ? { description: data.description } : {}),
    tags,
    params,
    body,
    context,
    ...(pins ? { pins } : {}),
    hash: hashOf(data.type, params, body),
    text,
  };
  return { block, problems };
}

/** Every ${…} written in a value (keys included). */
export function placeholders(v: unknown, out = new Set<string>()): Set<string> {
  if (typeof v === 'string') for (const m of v.matchAll(PLACEHOLDER)) out.add(m[1]!);
  else if (Array.isArray(v)) v.forEach((x) => placeholders(x, out));
  else if (isMap(v))
    for (const [k, x] of Object.entries(v)) {
      placeholders(k, out);
      placeholders(x, out);
    }
  return out;
}

/** The value with each ${p} replaced, in keys and strings alike. */
export function substitute<T>(v: T, values: Record<string, string>): T {
  const s = (t: string) => t.replace(PLACEHOLDER, (all, p: string) => (Object.hasOwn(values, p) ? values[p]! : all));
  const walk = (x: unknown): unknown => (typeof x === 'string' ? s(x) : Array.isArray(x) ? x.map(walk) : isMap(x) ? Object.fromEntries(Object.entries(x).map(([k, y]) => [s(k), walk(y)])) : x);
  return walk(v) as T;
}

/** The parameters' values: what was given, else the defaults. */
export const valuesFor = (block: Block, given: Record<string, string> = {}) => Object.fromEntries(block.params.map((p) => [p.name, given[p.name] ?? p.default]));

/** The fragment with its parameters filled in. */
export const instantiate = (block: Block, given: Record<string, string> = {}): Record<string, unknown> => substitute(structuredClone(block.body), valuesFor(block, given));

/** The fragment as a diagram of its own (defaults filled in): to check, preview and lay out. */
export function blockDiagram(block: Block, given: Record<string, string> = {}): Record<string, unknown> {
  return { type: block.type, title: block.title, ...block.context, ...instantiate(block, given) };
}

/** The same, as YAML text: what `carto render` and the palette's preview draw. */
export const blockDiagramText = (block: Block, given?: Record<string, string>) => stringify(blockDiagram(block, given), { lineWidth: 0, flowCollectionPadding: true });

/** Ids a value may take when a parameter ends up in an id. */
const ID = /^[A-Za-z0-9_-]+$/;

/** Parameters that end up in ids: their values must be ids too. */
export function idParams(block: Block): Set<string> {
  const out = new Set<string>();
  for (const v of Object.values(block.body)) if (isMap(v)) for (const k of Object.keys(v)) placeholders(k, out);
  return out;
}

/** What is wrong with values given for a block's parameters, by parameter. */
export function checkValues(block: Block, given: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const ids = idParams(block);
  for (const p of block.params) {
    const v = given[p.name] ?? p.default;
    if (ids.has(p.name) && !ID.test(v)) out[p.name] = v ? 'Part of an id: letters, digits, - and _ only' : 'Needed: it is part of an id';
  }
  return out;
}

/**
 * The fragment rules: a block is one type's YAML with only collections in it, every parameter it
 * uses declared, and, filled in with its defaults, valid against the type's schema and drawable on
 * its own (so every line and every `in:` points at something inside the block).
 */
export function checkBlock(block: Block, type: DiagramType | undefined): BlockProblem[] {
  const out: BlockProblem[] = [];
  if (!type) return [{ severity: 'error', message: `Unknown diagram type "${block.type}"` }];
  if (!Object.keys(block.body).length) out.push({ severity: 'error', message: 'Empty: a block holds at least one node, group or line' });
  const used = placeholders(block.body);
  for (const p of used) if (!block.params.some((x) => x.name === p)) out.push({ severity: 'error', message: `\${${p}} is used but not declared under params:` });
  for (const p of block.params) if (!used.has(p.name)) out.push({ severity: 'warning', message: `Parameter ${p.name} is declared but not used` });
  for (const [p, why] of Object.entries(checkValues(block, {}))) out.push({ severity: 'error', message: `Default of ${p}: ${why}` });
  const schema = type.schema as { properties?: Record<string, unknown> };
  for (const k of Object.keys(block.body)) if (schema.properties && !schema.properties[k]) out.push({ severity: 'error', message: `${k}: is not part of a ${type.name} diagram` });
  const text = blockDiagramText(block);
  const source = parseSource(text);
  for (const d of validate(source, type.schema)) out.push({ severity: d.severity, message: `${(d.path ?? []).join('.') || 'block'}: ${d.message}` });
  if (!out.some((d) => d.severity === 'error'))
    try {
      type.build(source.data, {
        error: (path, message) => out.push({ severity: 'error', message: `${path.join('.')}: ${message}` }),
        warn: (path, message) => out.push({ severity: 'warning', message: `${path.join('.')}: ${message}` }),
      });
    } catch (e) {
      out.push({ severity: 'error', message: `Cannot be drawn: ${(e as Error).message}` });
    }
  return out;
}
