// The tool handlers, as plain functions: the MCP server wraps them, tests call them directly.
// Everything an assistant needs to write a diagram on its own: types, schemas, checks with layout
// quality it can act on, and rendering to a file or straight back into the chat.
import fs from 'node:fs';
import path from 'node:path';
import { parseSource, withoutBadges, type Diagnostic, type DiagramType, type LayoutSidecar, type Path } from '@cartography/core';
import { findType, render, types, type RenderOptions, type RenderResult } from '@cartography/engine';
import { importMermaid } from '@cartography/import';
import { measure, score, type LayoutMetrics } from '@cartography/layout';
import { toPng } from './png.ts';

const examplesDir = new URL('../../../examples/', import.meta.url);

export function listTypes() {
  return types.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    ...(t.tagline ? { tagline: t.tagline } : {}),
    ...(t.useWhen ? { useWhen: t.useWhen } : {}),
    ...(t.notFor ? { notFor: t.notFor } : {}),
  }));
}

function typeOrThrow(id: string): DiagramType {
  const type = findType(id);
  if (!type) throw new Error(`Unknown type "${id}"${hintFor(id, types.map((t) => t.id))}. Types: ${types.map((t) => t.id).join(', ')}`);
  return type;
}

/** The richest example in the repo for a type (the template is the small one); none when installed without examples. */
export function exampleFor(id: string): { file: string; yaml: string } | undefined {
  const dir = new URL(`${id}/`, examplesDir);
  if (!fs.existsSync(dir)) return undefined;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml')).map((f) => ({ file: `examples/${id}/${f}`, yaml: fs.readFileSync(new URL(f, dir), 'utf8') }));
  return files.sort((a, b) => b.yaml.length - a.yaml.length)[0];
}

export function getSchema(id: string) {
  const type = typeOrThrow(id);
  return { type: type.id, name: type.name, schema: type.schema, template: type.template, example: exampleFor(type.id) };
}

export const newDiagram = (id: string) => typeOrThrow(id).template;

export const importMermaidText = (text: string) => importMermaid(text);

// --- Input: YAML text or a file, with relative paths kept inside the working directory -------------

export interface Input {
  yaml?: string;
  file?: string;
}

/** Absolute paths are taken as given; relative ones resolve against cwd and may not climb out of it. */
export function resolvePath(p: string, cwd: string): string {
  if (path.isAbsolute(p)) return path.normalize(p);
  const abs = path.resolve(cwd, p);
  const rel = path.relative(cwd, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`"${p}" points outside the working directory (${cwd}); use a path inside it or an absolute path`);
  return abs;
}

export interface Loaded {
  text: string;
  /** Contract files and the layout sidecar resolve from here. */
  dir: string;
  sidecar?: LayoutSidecar;
}

export function load(input: Input, cwd: string): Loaded {
  if (input.yaml != null) return { text: input.yaml, dir: cwd };
  if (!input.file) throw new Error('Pass the diagram as "yaml" (the text) or "file" (a path to a .yaml file)');
  const file = resolvePath(input.file, cwd);
  const side = file.replace(/\.ya?ml$/, '') + '.layout.json';
  const sidecar = fs.existsSync(side) ? (JSON.parse(fs.readFileSync(side, 'utf8')) as LayoutSidecar) : undefined;
  return { text: fs.readFileSync(file, 'utf8'), dir: path.dirname(file), sidecar };
}

export const reader = (dir: string) => (rel: string) => fs.readFileSync(resolvePath(rel, dir), 'utf8');

// --- Diagnostics with fix hints -------------------------------------------------------------------

export interface Problem {
  severity: 'error' | 'warning';
  message: string;
  line?: number;
  column?: number;
  hint?: string;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

/** The option a typo most likely meant, if one is close enough. */
function closest(word: string, options: string[]): string | undefined {
  const best = options.map((o) => ({ o, d: distance(word.toLowerCase(), o.toLowerCase()) })).sort((a, b) => a.d - b.d)[0];
  return best && best.d > 0 && best.d <= Math.max(2, Math.floor(word.length / 3)) ? best.o : undefined;
}

const hintFor = (word: string, options: string[]) => {
  const c = closest(word, options);
  return c ? ` (did you mean "${c}"?)` : '';
};

const at = (data: unknown, p: Path | undefined) => (p ?? []).reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k as string] : undefined), data);

/** Every property name the schema allows somewhere, for "unknown field" near misses. */
function schemaKeys(schema: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) for (const s of schema) schemaKeys(s, out);
  else if (schema && typeof schema === 'object')
    for (const [k, v] of Object.entries(schema)) {
      if (k === 'properties' && v && typeof v === 'object') for (const name of Object.keys(v)) out.add(name);
      schemaKeys(v, out);
    }
  return out;
}

/** Ids defined in the diagram: the keys of every top-level map (nodes, groups, tables, products…). */
function definedIds(data: unknown): string[] {
  if (!data || typeof data !== 'object') return [];
  return Object.values(data).flatMap((v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v) : []));
}

function hint(d: Diagnostic, data: unknown, type: DiagramType | undefined): string | undefined {
  const m = d.message;
  let r: RegExpExecArray | null;
  if (d.choices || (r = /must be one of: ([^(]+?)(?: \(did you mean .*\))?$/.exec(m))) {
    const value = at(data, d.path);
    const near = typeof value === 'string' ? closest(value, d.choices ?? r![1]!.split(', ')) : undefined;
    return near ? `Use "${near}" instead of "${String(value)}".` : 'Use one of the listed values exactly; get_schema lists them all.';
  }
  if ((r = /^Unknown field "(.+)"$/.exec(m))) {
    const near = type ? closest(r[1]!, [...schemaKeys(type.schema)]) : undefined;
    return near ? `Rename it to "${near}".` : 'Remove it: only fields in the schema are allowed (get_schema shows them).';
  }
  if ((r = /^Unknown type "(.+?)"/.exec(m))) return `Set type: to one of the ids from list_types${hintFor(r[1]!, types.map((t) => t.id))}.`;
  if (/^Add "type:"/.test(m)) return 'Start the file with a line like "type: systems".';
  if ((r = /^There is no (?:node|group|node or group|table|product|principal|resource|source)[^"]* "(.+?)"/.exec(m)))
    return `Define "${r[1]}" first, or fix the id${hintFor(r[1]!, definedIds(data))}. Ids are the keys, not the labels.`;
  if (/^Invalid name|has an invalid format/.test(m)) return 'Ids use letters, digits, - and _ only (orders-api); put display text in label:.';
  if (/should look like "a -> b"/.test(m)) return 'Write edges as "- a -> b", "- a -> b: label" or "- a -> b: { label: x, style: y }".';
  if (/is already a group/.test(m)) return 'Give the node and the group different ids.';
  if (d.path?.length === 0 || /indent|Flow sequence|Implicit|Nested mappings|Map keys|unexpected|end of the stream/i.test(m))
    return 'YAML syntax: indent with two spaces, close every [ and {, and quote text that contains ": " or " #".';
  return undefined;
}

/**
 * A value with several allowed forms (`a: service` or `a: { kind: service }`) is reported against
 * each form it misses: "needs from", "Unknown field a -> b", or "must be one of" on an object. Drop
 * that noise when a more specific problem sits on the same line or inside the value.
 */
function dropAnyOfNoise(ds: Diagnostic[], data: unknown): Diagnostic[] {
  const inside = (o: Diagnostic, d: Diagnostic) => !!o.path && !!d.path && o.path.length > d.path.length && d.path.every((k, i) => o.path![i] === k);
  const noise = (d: Diagnostic) =>
    /^"\d+" needs "(from|to)"$/.test(d.message) ||
    /^Unknown field "[^"]*(->|-->|\.\.>|<->|--)[^"]*"$/.test(d.message) ||
    ((/must be one of/.test(d.message) || !!d.choices) && typeof at(data, d.path) === 'object' && ds.some((o) => inside(o, d)));
  return ds.filter((d) => !noise(d) || !ds.some((o) => o !== d && !noise(o) && (o.line === d.line || inside(o, d))));
}

export function problems(ds: Diagnostic[], text: string, type: DiagramType | undefined): Problem[] {
  const data = parseSource(text).data;
  return dropAnyOfNoise(ds, data).map((d) => {
    const h = hint(d, data, type);
    return { severity: d.severity, message: d.message, ...(d.line ? { line: d.line, column: d.column } : {}), ...(h ? { hint: h } : {}) };
  });
}

// --- Layout quality with suggestions ----------------------------------------------------------------

export interface Quality {
  /** Lower is better; compare versions of one diagram, not different diagrams. */
  score: number;
  verdict: 'clean' | 'good' | 'needs work';
  crossings: number;
  linesThroughBoxes: number;
  labelOverlaps: number;
  bends: number;
  backward: number;
  /** Share of the drawing that is empty space far from everything (0–1). */
  voids: number;
  /** Width / height; slides like about 1.8. */
  aspect: number;
  width: number;
  height: number;
  suggestions: string[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function quality(r: RenderResult, text: string, opts: { dir: string; sidecar?: LayoutSidecar }): Promise<Quality | undefined> {
  if (!r.graph || !r.placed || !r.type || !r.graph.edges.length) return undefined;
  const graph = withoutBadges(r.graph);
  const m = measure(graph, r.placed);
  const s = score(m);
  const tips: string[] = [];
  const props = (r.type.schema as { properties?: Record<string, { items?: { enum?: string[] } }> }).properties ?? {};
  const locate = parseSource(text).locate;

  // Try the other direction once, so advice about direction comes with numbers instead of a guess.
  let alt: { direction: 'right' | 'down'; m: LayoutMetrics; score: number } | undefined;
  if (props.direction && !r.type.layout && !opts.sidecar) {
    const direction = r.graph.direction === 'down' ? 'right' : 'down';
    const ar = await render(text, { fonts: 'none', load: reader(opts.dir), tuning: { direction } }).catch(() => undefined);
    if (ar?.graph && ar.placed) {
      const am = measure({ ...withoutBadges(ar.graph), direction }, ar.placed);
      alt = { direction, m: am, score: score(am) };
    }
  }
  const altBetter = !!alt && alt.score < s * 0.85 && s - alt.score > 10;
  const altNote = (alt: { direction: string; m: LayoutMetrics; score: number }) => `score ${Math.round(alt.score)} instead of ${Math.round(s)}; ${alt.m.crossings} crossings, ${alt.m.bends} bends, aspect ${alt.m.aspect}`;

  if (m.edgeThroughNode) tips.push(`${plural(m.edgeThroughNode, 'line runs', 'lines run')} through a box it does not connect. Put related nodes in one group, or badge the link that cuts across.`);
  if (m.labelOverlaps) tips.push(`${plural(m.labelOverlaps, 'line label overlaps', 'line labels overlap')} a box or another label. Shorten labels to one or two words, or drop labels that only repeat the line style.`);
  if (m.crossings) {
    let tip = `${plural(m.crossings, 'line crosses', 'lines cross')}.`;
    // A node many others point at (secrets, logging, identity) is the usual cause: badges take those lines out of the layout.
    const incoming = new Map<string, Set<string>>();
    for (const e of graph.edges) if (e.from.node !== e.to.node) incoming.set(e.to.node, (incoming.get(e.to.node) ?? new Set()).add(e.from.node));
    const [hub, from] = [...incoming].sort((a, b) => b[1].size - a[1].size)[0] ?? [];
    const styles = props.badges?.items?.enum;
    if (styles && hub && from && from.size >= 3) {
      const lines = graph.edges.filter((e) => e.to.node === hub).map((e) => locate(e.path)?.line).filter(Boolean);
      const shape = r.graph.nodes.find((n) => n.id === hub)?.shape;
      const name = shape?.kind === 'card' ? ` (${shape.label})` : '';
      tip += ` ${from.size} nodes connect to "${hub}"${name}${lines.length ? `, edges on lines ${lines.join(', ')}` : ''}. If it is a supporting service (secrets, logging, identity), show those links as badges on the cards: add "badge: true" to each edge, or give them one style and list it at the top level, e.g. "badges: [${styles.at(-1)}]" (styles: ${styles.join(', ')}).`;
    } else tip += ' Put nodes that talk to each other in the same group, and write edges in flow order.';
    tips.push(tip);
  }
  if (m.backward > 1) tips.push(`${plural(m.backward, 'line runs', 'lines run')} against the flow. Write edges in the direction requests or data travel (caller -> callee), so the drawing reads one way.`);
  if (m.voids > 0.25) tips.push(`About ${Math.round(m.voids * 100)}% of the drawing is empty space. Fewer or flatter groups make it tighter; a node without lines can move into a related group.`);
  if (alt && altBetter) tips.push(`"direction: ${alt.direction}" lays this out better (${altNote(alt)}).`);
  else if (m.aspect > 3.2 || m.aspect < 0.45) {
    const shape = m.aspect > 3.2 ? `very wide (${m.aspect}:1)` : `very tall (1:${Math.round(100 / m.aspect) / 100})`;
    const other = r.graph.direction === 'down' ? 'right' : 'down';
    tips.push(alt ? `The drawing is ${shape}. "direction: ${alt.direction}" was tried and is not better (${altNote(alt)}); fine for a page, for a slide split it into two diagrams.` : `The drawing is ${shape}. Try "direction: ${other}".`);
  }

  const verdict = m.edgeThroughNode || m.labelOverlaps || m.crossings > 3 ? 'needs work' : m.crossings || m.voids > 0.25 || m.backward > 1 ? 'good' : 'clean';
  return {
    score: Math.round(s),
    verdict,
    crossings: m.crossings,
    linesThroughBoxes: m.edgeThroughNode,
    labelOverlaps: m.labelOverlaps,
    bends: m.bends,
    backward: m.backward,
    voids: m.voids,
    aspect: m.aspect,
    width: m.width,
    height: m.height,
    suggestions: tips,
  };
}

// --- validate and render ------------------------------------------------------------------------------

export interface Checked {
  ok: boolean;
  type?: string;
  problems: Problem[];
  quality?: Quality;
}

export async function validateDiagram(input: Input, cwd = process.cwd()): Promise<Checked> {
  const src = load(input, cwd);
  const r = await render(src.text, { fonts: 'none', load: reader(src.dir), sidecar: src.sidecar });
  const ok = !!r.svg && !r.diagnostics.some((d) => d.severity === 'error');
  return { ok, type: r.type?.id, problems: problems(r.diagnostics, src.text, r.type), ...(ok ? { quality: await quality(r, src.text, src) } : {}) };
}

export interface RenderRequest extends Input, Drawn {
  format?: 'svg' | 'png';
  /** A built-in theme: survey (the default), survey-dark, transit, drafting, classic… */
  theme?: string;
  /** Where to write the file; without it the drawing comes back in the result only. */
  path?: string;
  /** PNG pixel density (default 2). */
  scale?: number;
}

/** What to draw of a diagram, as the CLI's --view, --focus, --layer, --stage and --step say it. */
export interface Drawn {
  view?: string;
  /** Element ids to focus on: them, and what is within `hops` lines. */
  focus?: string[];
  hops?: number | 'all';
  direction?: 'both' | 'upstream' | 'downstream';
  layer?: string[];
  stage?: string;
  step?: number;
}

/** The engine's options for a Drawn. */
export const drawnOptions = (d: Drawn): RenderOptions => ({
  ...(d.view ? { view: d.view } : {}),
  ...(d.focus?.length ? { focus: { on: d.focus, hops: d.hops ?? 1, direction: d.direction ?? 'both' } } : {}),
  ...(d.layer?.length ? { layers: d.layer } : {}),
  ...(d.stage ? { stage: d.stage } : {}),
  ...(d.step ? { step: d.step } : {}),
});

export interface Rendered extends Checked {
  format: 'svg' | 'png';
  path?: string;
  width?: number;
  height?: number;
  svg?: string;
  png?: Buffer;
}

export async function renderDiagram(req: RenderRequest, cwd = process.cwd()): Promise<Rendered> {
  const ext = /\.(svg|png)$/i.exec(req.path ?? '')?.[1]?.toLowerCase() as 'svg' | 'png' | undefined;
  const format = req.format ?? ext ?? 'svg';
  if (ext && ext !== format) throw new Error(`"${req.path}" ends in .${ext} but format is ${format}; make them match`);
  // Check the target before the slow part, so a bad path fails fast.
  const out = req.path ? resolvePath(ext ? req.path : `${req.path}.${format}`, cwd) : undefined;
  const src = load(req, cwd);
  // Fonts are embedded only in SVG files: resvg reads them from disk, and inline SVG goes back to a
  // model, where a few hundred KB of font data is pure cost.
  const r = await render(src.text, { theme: req.theme ?? 'survey', fonts: format === 'svg' && out ? 'embed' : 'none', load: reader(src.dir), sidecar: src.sidecar, ...drawnOptions(req) });
  const base = { format, problems: problems(r.diagnostics, src.text, r.type), type: r.type?.id };
  if (!r.svg || r.diagnostics.some((d) => d.severity === 'error')) return { ...base, ok: false };
  const png = format === 'png' ? toPng(r.svg, req.scale ?? 2) : undefined;
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, png ?? r.svg);
  }
  return { ...base, ok: true, path: out, width: r.width, height: r.height, quality: await quality(r, src.text, src), ...(png ? { png } : out ? {} : { svg: r.svg }) };
}
