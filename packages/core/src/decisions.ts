// Architecture decision records: one Markdown file per decision, in a folder next to the diagrams
// (decisions/0001-use-postgres.md by default), in the usual forms: MADR with front matter, Michael
// Nygard's (adr-tools: "# 1. Title", "Date:", a "## Status" section), log4brains' bullets ("- Status:
// accepted"). Unlike review notes they are durable: what was decided, why, and what it costs. The
// drawing points at them: front matter lists what a decision is about,
//
//   ---
//   status: accepted
//   date: 2026-11-02
//   concerns: [payments.engine, "online.api -> payments.gateway", "containers.yaml#payments"]
//   ---
//
// elements and groups by id (a model id in a workspace), lines as "a -> b", views as "file#view". Only
// the keys this file touches are rewritten (status, concerns, superseded-by); the text stays the author's.
import { parse as parseYaml } from 'yaml';
import { inlineMarkdown, type Inline } from './notes.ts';
import type { Graph, MatrixCell, MatrixHeader, GraphNode } from './model.ts';

export type DecisionStatus = 'proposed' | 'accepted' | 'rejected' | 'deprecated' | 'superseded';
export const decisionStatuses: DecisionStatus[] = ['proposed', 'accepted', 'rejected', 'deprecated', 'superseded'];

export interface Decision {
  /** Path as given (relative to the workspace: "decisions/0001-use-postgres.md"). */
  file: string;
  /** 1, 2, 3 … from the file name ("0001-…"), else from the front matter, else by order. */
  number: number;
  title: string;
  status: DecisionStatus;
  /** The status as written ("Accepted", "superseded by ADR-0005"). */
  statusText: string;
  date?: string;
  /** What it is about, as written: ids, "a -> b" lines, "file#view" views. */
  concerns: string[];
  supersededBy?: number;
  supersedes: number[];
  deciders: string[];
  tags: string[];
  /** Where the status is written, so a change goes back there: front matter, a "## Status" section, a "Status:" line. */
  style: 'front-matter' | 'section' | 'line' | 'none';
  /** The markdown after the front matter. */
  body: string;
  text: string;
}

/** The folder the decisions live in when nothing says otherwise. */
export const DEFAULT_DECISIONS_DIR = 'decisions';
/** Folders other tools use, looked for in this order (adr-tools: doc/adr, log4brains: docs/adr). */
const KNOWN_DIRS = ['decisions', 'docs/decisions', 'docs/adr', 'doc/adr', 'adr', 'docs/architecture/decisions', 'architecture/decisions', 'doc/architecture/decisions'];

const trimSlash = (s: string) => s.trim().replace(/^\.\/+/, '').replace(/\/+$/, '');

/**
 * The decisions folder of a workspace (paths relative to its root): what `.adr-dir` (adr-tools) or
 * `.log4brains.yml` (adrFolder) says, else the first known folder that holds Markdown, else decisions/.
 */
export function decisionsDir(files: Iterable<[string, string]>): string {
  const all = new Map(files);
  const adrDir = all.get('.adr-dir')?.trim();
  if (adrDir) return trimSlash(adrDir);
  const l4b = all.get('.log4brains.yml') ?? all.get('.log4brains.yaml');
  if (l4b) {
    try {
      const v = parseYaml(l4b) as { project?: { adrFolder?: unknown } } | null;
      if (typeof v?.project?.adrFolder === 'string') return trimSlash(v.project.adrFolder);
    } catch {
      /* not readable: the defaults */
    }
  }
  const paths = [...all.keys()];
  return KNOWN_DIRS.find((d) => paths.some((p) => p.startsWith(d + '/') && /\.md$/i.test(p))) ?? DEFAULT_DECISIONS_DIR;
}

/** A decision file of that folder: Markdown directly in it (or one level down, as log4brains packages), not its README or template. */
export function isDecisionFile(path: string, dir: string): boolean {
  if (!/\.md$/i.test(path)) return false;
  const rel = dir ? (path.startsWith(dir + '/') ? path.slice(dir.length + 1) : undefined) : path;
  if (rel === undefined || rel.split('/').length > 2) return false;
  const name = rel.split('/').pop()!.toLowerCase();
  return !/^(readme|index|template|adr-template|_template)\.md$/.test(name) && !name.startsWith('.');
}

// ---------------------------------------------------------------- reading

const FRONT = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function frontMatter(text: string): { data: Record<string, unknown>; raw?: string; end: number } {
  const m = FRONT.exec(text);
  if (!m) return { data: {}, end: 0 };
  try {
    const v = parseYaml(m[1]!) as unknown;
    return { data: v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}, raw: m[1], end: m[0].length };
  } catch {
    return { data: {}, raw: m[1], end: m[0].length };
  }
}

const strings = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.flatMap((x) => (typeof x === 'string' || typeof x === 'number' ? [String(x).trim()] : [])).filter(Boolean)
    : typeof v === 'string'
      ? v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : typeof v === 'number'
        ? [String(v)]
        : [];

const asDate = (v: unknown): string | undefined => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'string' || typeof v === 'number' ? String(v).trim() || undefined : undefined);

/** The status word of a line as written ("Accepted", "superseded by [5. …](0005-….md)"). */
export function readStatus(s: string): { status: DecisionStatus; by?: number } {
  const t = s.trim().toLowerCase();
  if (/^superseded|^replaced/.test(t)) return { status: 'superseded', by: numberIn(s.replace(/^\s*(superseded|replaced)\s*(by)?\s*/i, '')) };
  if (/^deprecated|^obsolete|^retired/.test(t)) return { status: 'deprecated' };
  if (/^rejected|^declined/.test(t)) return { status: 'rejected' };
  if (/^accepted|^approved|^decided|^adopted|^done/.test(t)) return { status: 'accepted' };
  return { status: 'proposed' };
}

/** The decision number a reference names: "[3. Foo](0003-foo.md)", "ADR-0003", "0003-foo.md", "3". */
function numberIn(s: string): number | undefined {
  const link = /\]\(([^)]+)\)/.exec(s)?.[1] ?? s;
  const m = /(?:^|[/(\s#-]|adr[-\s]?)0*(\d{1,5})(?=[-_.\s\]):]|$)/i.exec(link) ?? /0*(\d{1,5})/.exec(link);
  return m ? Number(m[1]) : undefined;
}

/** The "## Status" section (Nygard): its lines, and where it is in the text. */
function statusSection(body: string): { lines: string[]; from: number; to: number } | undefined {
  const m = /^#{2,3}[ \t]+status[ \t]*\r?\n/im.exec(body);
  if (!m) return undefined;
  const from = m.index + m[0].length;
  const next = /^#{1,3}[ \t]+\S/m.exec(body.slice(from));
  const to = next ? from + next.index : body.length;
  return { lines: body.slice(from, to).split(/\r?\n/).map((l) => l.trim()).filter(Boolean), from, to };
}

/** A "Status: x" line near the top (log4brains' "- Status: accepted", "* **Status**: proposed"). */
const STATUS_LINE = /^[ \t]*(?:[-*][ \t]+)?(?:\*\*)?status(?:\*\*)?[ \t]*:(?:\*\*)?[ \t]*(.+?)[ \t]*$/im;
const DATE_LINE = /^[ \t]*(?:[-*][ \t]+)?(?:\*\*)?date(?:\*\*)?[ \t]*:(?:\*\*)?[ \t]*(.+?)[ \t]*$/im;

/** The number a file name starts with ("0007-use-kafka.md"); a date (20210403-…) is not one. */
export function fileNumber(path: string): number | undefined {
  const m = /^(\d{1,5})(?=[-_. ])/.exec(path.split('/').pop() ?? '');
  return m ? Number(m[1]) : undefined;
}

/** Reads one decision file; `number` is the file's, 0 when it has none (readDecisions numbers those). */
export function parseDecision(file: string, text: string): Decision {
  const fm = frontMatter(text);
  const d = fm.data;
  const body = text.slice(fm.end);
  const heading = /^#[ \t]+(.+?)[ \t#]*$/m.exec(body)?.[1] ?? '';
  // "# 1. Record decisions", "# ADR 0003: Foo", "# ADR-003 - Foo" are numbered titles.
  const numbered = /^(?:adr[-\s]?)?0*(\d{1,5})(?:\.|:|\s+-|\s+–|\s+—)\s*(.+)$/i.exec(heading);
  const title = (numbered ? numbered[2]! : heading).trim() || (file.split('/').pop() ?? file).replace(/\.md$/i, '').replace(/^\d+[-_]/, '').replace(/[-_]+/g, ' ');
  const number = fileNumber(file) ?? (typeof d.number === 'number' ? d.number : undefined) ?? (numbered ? Number(numbered[1]) : 0);

  let style: Decision['style'] = 'none';
  let statusText = '';
  let by: number | undefined;
  const supersedes = new Set<number>();
  for (const s of strings(d.supersedes)) {
    const n = numberIn(s);
    if (n) supersedes.add(n);
  }
  const section = statusSection(body);
  if (typeof d.status === 'string' && d.status.trim()) ((style = 'front-matter'), (statusText = d.status.trim()));
  else if (section?.lines.length) {
    style = 'section';
    // The first line that says a status; Nygard writes "Supersedes [1. …]" or "Amended by …" under it.
    const said = section.lines.find((l) => !/^(supersedes|amends|amended by|clarifies|clarified by)\b/i.test(l)) ?? section.lines[0]!;
    statusText = said;
    for (const l of section.lines) if (/^supersedes\b/i.test(l)) supersedes.add(numberIn(l.replace(/^supersedes\s*/i, '')) ?? 0);
    const sup = section.lines.find((l) => /^superseded\b/i.test(l));
    if (sup) ((statusText = sup), (by = readStatus(sup).by));
  } else {
    const line = STATUS_LINE.exec(body.slice(0, 1500));
    if (line) ((style = 'line'), (statusText = line[1]!.replace(/\*\*/g, '').trim()));
  }
  supersedes.delete(0);
  const read = readStatus(statusText || 'proposed');
  const fmBy = d['superseded-by'] ?? d.superseded_by ?? d.supersededBy;
  by = (fmBy != null ? numberIn(String(fmBy)) : undefined) ?? by ?? read.by;
  const date = asDate(d.date) ?? DATE_LINE.exec(body.slice(0, 1500))?.[1]?.replace(/\*\*/g, '').trim();
  return {
    file,
    number,
    title,
    status: by ? 'superseded' : read.status,
    statusText: statusText || 'proposed',
    ...(date ? { date } : {}),
    concerns: strings(d.concerns ?? d.concern),
    ...(by ? { supersededBy: by } : {}),
    supersedes: [...supersedes].sort((a, b) => a - b),
    deciders: strings(d.deciders ?? d['decision-makers'] ?? d.decision_makers),
    tags: strings(d.tags),
    style,
    body,
    text,
  };
}

/** Every decision of a folder, by number; files without a number of their own follow in name order (log4brains' dated names). */
export function readDecisions(files: Iterable<[string, string]>, dir?: string): Decision[] {
  const list = [...files].filter(([p]) => (dir === undefined ? /\.md$/i.test(p) : isDecisionFile(p, dir))).sort(([a], [b]) => a.localeCompare(b));
  const out = list.map(([p, t]) => parseDecision(p, t));
  let next = Math.max(0, ...out.map((d) => d.number));
  for (const d of out) if (!d.number) d.number = ++next;
  return out.sort((a, b) => a.number - b.number || a.file.localeCompare(b.file));
}

// ---------------------------------------------------------------- writing

/** The number a new decision gets. */
export const nextDecisionNumber = (decisions: Decision[]) => Math.max(0, ...decisions.map((d) => d.number)) + 1;

/** "0004-use-kafka-for-payment-events.md". */
export function decisionFileName(n: number, title: string): string {
  const slug =
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'decision';
  return `${String(n).padStart(4, '0')}-${slug}.md`;
}

/** A YAML scalar for the front matter: plain where it can be, quoted where it must. */
function scalar(s: string): string {
  return /^[\w.@/][\w .@/()-]*$/.test(s) && !/^(true|false|null|yes|no|on|off|~)$/i.test(s) && !/\s$/.test(s) && !/^\d[\d.e+-]*$/i.test(s) ? s : JSON.stringify(s);
}
const flowList = (v: string[]) => `[${v.map(scalar).join(', ')}]`;

/**
 * The text with one front-matter key set (undefined removes it): its line, and the indented or "- "
 * lines under it, are replaced; the rest of the file stays as written. A file without front matter gets one.
 */
export function setFrontMatter(text: string, key: string, value: string | number | string[] | undefined): string {
  const line = value === undefined ? undefined : `${key}: ${Array.isArray(value) ? flowList(value) : typeof value === 'number' ? value : scalar(value)}`;
  const m = FRONT.exec(text);
  if (!m) return line ? `---\n${line}\n---\n\n${text.replace(/^\s*\n/, '')}` : text;
  const lines = m[1]!.split(/\r?\n/);
  const at = lines.findIndex((l) => new RegExp(`^${key.replace(/[-]/g, '\\-')}\\s*:`).test(l));
  if (at < 0) {
    if (!line) return text;
    lines.push(line);
  } else {
    let end = at + 1;
    // A block value goes along: the indented and "- " lines under the key.
    while (end < lines.length && /^(\s+\S|-\s)/.test(lines[end]!)) end++;
    lines.splice(at, end - at, ...(line ? [line] : []));
  }
  const nl = m[0].includes('\r\n') ? '\r\n' : '\n';
  return `---${nl}${lines.join(nl)}${nl}---${nl}` + text.slice(m[0].length);
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The text with a new status, written where the file keeps it: the front matter, the "## Status"
 * section (Nygard: "Superseded by [5. Title](0005-title.md)"), or the "Status:" line.
 */
export function setDecisionStatus(text: string, file: string, status: DecisionStatus, by?: Pick<Decision, 'number' | 'title' | 'file'>): string {
  const d = parseDecision(file, text);
  const rel = by ? relativeTo(file, by.file) : '';
  if (d.style === 'front-matter' || d.style === 'none') {
    let out = setFrontMatter(text, 'status', status);
    out = setFrontMatter(out, 'superseded-by', status === 'superseded' && by ? by.number : undefined);
    return out;
  }
  const fm = FRONT.exec(text)?.[0].length ?? 0;
  const body = text.slice(fm);
  const said = status === 'superseded' && by ? `Superseded by [${by.number}. ${by.title}](${rel})` : titleCase(status);
  if (d.style === 'section') {
    const s = statusSection(body)!;
    const keep = s.lines.filter((l) => /^(supersedes|amends|amended by|clarifies|clarified by)\b/i.test(l));
    const old = body.slice(s.from, s.to);
    const nl = old.includes('\r\n') ? '\r\n' : '\n';
    return text.slice(0, fm) + body.slice(0, s.from) + `${nl}${[said, ...keep].join(nl + nl)}${nl}${nl}` + body.slice(s.to);
  }
  return text.slice(0, fm) + body.replace(STATUS_LINE, (whole, v: string) => whole.slice(0, whole.lastIndexOf(v)) + (status === 'superseded' && by ? `superseded by [ADR-${String(by.number).padStart(4, '0')}](${rel})` : status));
}

/** The text with what it concerns set (front matter `concerns:`). */
export const setDecisionConcerns = (text: string, concerns: string[]) => setFrontMatter(text, 'concerns', concerns.length ? concerns : undefined);

/** "b.md" from "decisions/a.md" to "decisions/b.md": how one decision links to another. */
function relativeTo(from: string, to: string): string {
  const a = from.split('/').slice(0, -1);
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

export interface NewDecision {
  number: number;
  title: string;
  concerns?: string[];
  /** YYYY-MM-DD; today when left out. */
  date?: string;
  status?: DecisionStatus;
  supersedes?: Pick<Decision, 'number' | 'title' | 'file'>;
  /** Where it will be written, for the link to what it supersedes. */
  file?: string;
}

/** A new decision in MADR's shape, with front matter: what "New decision" and `carto decisions new` write. */
export function decisionTemplate(o: NewDecision): string {
  const date = o.date ?? new Date().toISOString().slice(0, 10);
  const file = o.file ?? decisionFileName(o.number, o.title);
  const sup = o.supersedes;
  return [
    '---',
    `status: ${o.status ?? 'proposed'}`,
    `date: ${date}`,
    ...(o.concerns?.length ? [`concerns: ${flowList(o.concerns)}`] : []),
    ...(sup ? [`supersedes: ${sup.number}`] : []),
    '---',
    '',
    `# ${o.title}`,
    '',
    '## Context',
    '',
    sup ? `[${sup.number}. ${sup.title}](${relativeTo(file, sup.file)}) no longer holds because …` : 'What is the problem, and what forces are at play (technical, organisational, cost)?',
    '',
    '## Options',
    '',
    '- Option one',
    '- Option two',
    '',
    '## Decision',
    '',
    'We will …',
    '',
    '## Consequences',
    '',
    'What becomes easier, what becomes harder, and what we will have to watch.',
    '',
  ].join('\n');
}

/**
 * The files a supersede changes: the new decision (written with `supersedes:`) and the old one
 * marked superseded by it, each in its own style.
 */
export function supersede(old: Decision, next: NewDecision & { file: string }): { file: string; text: string }[] {
  return [
    { file: next.file, text: decisionTemplate({ ...next, supersedes: old }) },
    { file: old.file, text: setDecisionStatus(old.text, old.file, 'superseded', { number: next.number, title: next.title, file: next.file }) },
  ];
}

// ---------------------------------------------------------------- what a decision is about

export type Concern = { kind: 'element'; id: string } | { kind: 'edge'; from: string; to: string } | { kind: 'view'; file: string; view: string };

/** "payments.engine", "api -> db", "containers.yaml#payments" (or "#payments" for the diagram at hand). */
export function readConcern(s: string): Concern | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const edge = /^(.+?)\s*-+>\s*(.+)$/.exec(t);
  if (edge) return { kind: 'edge', from: edge[1]!.trim(), to: edge[2]!.trim() };
  const hash = t.indexOf('#');
  if (hash >= 0) return { kind: 'view', file: t.slice(0, hash).trim(), view: t.slice(hash + 1).trim() };
  if (/^view:/i.test(t)) return { kind: 'view', file: '', view: t.slice(5).trim() };
  return { kind: 'element', id: t };
}

/** A concern as written: what the front matter holds. */
export function concernText(c: Concern): string {
  return c.kind === 'edge' ? `${c.from} -> ${c.to}` : c.kind === 'view' ? `${c.file}#${c.view}` : c.id;
}

/** Ids a concern names (both ends of a line). */
export const concernIds = (c: Concern) => (c.kind === 'element' ? [c.id] : c.kind === 'edge' ? [c.from, c.to] : []);

/** The decisions about an element (by its id) or about a line it is an end of. */
export function decisionsAbout(decisions: Decision[], id: string): Decision[] {
  return decisions.filter((d) => d.concerns.some((s) => concernIds(readConcern(s) ?? { kind: 'view', file: '', view: '' }).includes(id)));
}

/** Decisions linked to each other: what a decision supersedes and what superseded it. */
export function decisionByNumber(decisions: Decision[], n: number | undefined): Decision | undefined {
  return n == null ? undefined : decisions.find((d) => d.number === n);
}

/**
 * Concerns after an element was renamed (`node` maps an old id to the new one): undefined when
 * none changes. Only the `concerns:` key is rewritten.
 */
export function renameDecisionConcerns(text: string, file: string, node: (id: string) => string): string | undefined {
  const d = parseDecision(file, text);
  let changed = false;
  const next = d.concerns.map((s) => {
    const c = readConcern(s);
    if (!c || c.kind === 'view') return s;
    const out: Concern = c.kind === 'element' ? { kind: 'element', id: node(c.id) } : { kind: 'edge', from: node(c.from), to: node(c.to) };
    const t = concernText(out);
    if (t !== concernText(c)) changed = true;
    return t !== concernText(c) ? t : s;
  });
  return changed ? setDecisionConcerns(text, next) : undefined;
}

export type ConcernTarget = { kind: 'node' | 'group' | 'edge'; id: string } | { kind: 'view' };

/**
 * Where a concern is in a drawing: an element by its id (or by the id it is drawn under, `drawnAs`, a
 * workspace's mapping of model ids to the nodes of this drawing), a line by its two ends, a view by
 * its name. Undefined when this drawing does not show it.
 */
export function resolveConcern(concern: string, graph: Graph, at: { file?: string; view?: string; drawnAs?: (id: string) => string | undefined } = {}): ConcernTarget | undefined {
  const c = readConcern(concern);
  if (!c) return undefined;
  if (c.kind === 'view') return c.view === at.view && (!c.file || !at.file || c.file === at.file || at.file.endsWith('/' + c.file)) ? { kind: 'view' } : undefined;
  const drawn = (id: string) => {
    const as = at.drawnAs?.(id);
    if (as && (graph.nodes.some((n) => n.id === as) || graph.groups.some((g) => g.id === as))) return as;
    return graph.nodes.some((n) => n.id === id) || graph.groups.some((g) => g.id === id) ? id : undefined;
  };
  if (c.kind === 'edge') {
    const [a, b] = [drawn(c.from), drawn(c.to)];
    const e = a && b ? graph.edges.find((x) => x.from.node === a && x.to.node === b) : undefined;
    return e ? { kind: 'edge', id: e.id } : undefined;
  }
  const id = drawn(c.id);
  if (!id) return undefined;
  return graph.nodes.some((n) => n.id === id) ? { kind: 'node', id } : { kind: 'group', id };
}

/** For each element, group and line of a drawing, the decisions about it; decisions about the view under "view". */
export function decisionsOnDrawing(decisions: Decision[], graph: Graph, at: Parameters<typeof resolveConcern>[2] = {}): { decision: Decision; target: ConcernTarget }[] {
  const out: { decision: Decision; target: ConcernTarget }[] = [];
  for (const d of decisions) {
    const seen = new Set<string>();
    for (const s of d.concerns) {
      const t = resolveConcern(s, graph, at);
      const key = t ? (t.kind === 'view' ? 'view' : `${t.kind}:${t.id}`) : '';
      if (t && !seen.has(key)) (seen.add(key), out.push({ decision: d, target: t }));
    }
  }
  return out;
}

/** The selection as a concern: an element's id, or a line as "from -> to". */
export function concernFor(graph: Graph, kind: 'node' | 'group' | 'edge', id: string, modelId?: (drawn: string) => string | undefined): string | undefined {
  const as = (x: string) => modelId?.(x) ?? x;
  if (kind !== 'edge') return as(id);
  const e = graph.edges.find((x) => x.id === id);
  return e && `${as(e.from.node)} -> ${as(e.to.node)}`;
}

// ---------------------------------------------------------------- checks

/** Problems with the decisions of a workspace: concerns that name no element, links to decisions that are not there. */
export function checkDecisions(decisions: Decision[], known: { element(id: string): boolean; view?(file: string, view: string): boolean; near?(id: string): string | undefined }): { file: string; line?: number; message: string }[] {
  const out: { file: string; line?: number; message: string }[] = [];
  const numbers = new Set(decisions.map((d) => d.number));
  const twice = new Set(decisions.filter((d, i) => decisions.findIndex((x) => x.number === d.number) !== i).map((d) => d.number));
  for (const d of decisions) {
    const lineOf = (s: string) => {
      const i = d.text.indexOf(s);
      return i < 0 ? undefined : d.text.slice(0, i).split('\n').length;
    };
    for (const s of d.concerns) {
      const c = readConcern(s);
      if (!c) continue;
      if (c.kind === 'view') {
        if (known.view && !known.view(c.file, c.view)) out.push({ file: d.file, line: lineOf(s), message: `Decision ${d.number} concerns view "${s}", which is not in the workspace` });
        continue;
      }
      for (const id of concernIds(c))
        if (!known.element(id)) {
          const near = known.near?.(id);
          out.push({ file: d.file, line: lineOf(s), message: `Decision ${d.number} concerns "${id}", which is not in the workspace${near ? `; did you mean ${near}?` : ''}` });
        }
    }
    if (d.supersededBy && !numbers.has(d.supersededBy)) out.push({ file: d.file, message: `Decision ${d.number} is superseded by ${d.supersededBy}, which is not in the folder` });
    for (const n of d.supersedes) if (!numbers.has(n)) out.push({ file: d.file, message: `Decision ${d.number} supersedes ${n}, which is not in the folder` });
    if (twice.has(d.number)) out.push({ file: d.file, message: `Two decisions are numbered ${d.number}` });
  }
  return out;
}

// ---------------------------------------------------------------- telling

export const statusLabel: Record<DecisionStatus, string> = { proposed: 'Proposed', accepted: 'Accepted', rejected: 'Rejected', deprecated: 'Deprecated', superseded: 'Superseded' };

/** "Superseded by 5", "Accepted". */
export const statusSaid = (d: Decision) => (d.status === 'superseded' && d.supersededBy ? `Superseded by ${d.supersededBy}` : statusLabel[d.status]);

/** Whether a decision still holds: accepted (or proposed, still to hold); the others are history. */
export const decisionStands = (d: Decision) => d.status === 'accepted' || d.status === 'proposed';

/** A section's text by its heading ("Decision", "Decision Outcome", "Context and Problem Statement"). */
export function decisionSection(d: Pick<Decision, 'body'>, name: 'context' | 'decision' | 'consequences' | 'options'): string | undefined {
  const re = { context: /^context/i, decision: /^decision(\s+outcome)?$/i, consequences: /consequences/i, options: /options/i }[name];
  const parts = d.body.split(/^(#{2,3})[ \t]+(.+?)[ \t#]*$/m);
  for (let i = 1; i + 1 < parts.length; i += 3) if (re.test(parts[i + 1]!.trim())) return parts[i + 2]?.trim() || undefined;
  return undefined;
}

/** The first sentence or so of what was decided: a tooltip, a line in a list. */
export function decisionSummary(d: Pick<Decision, 'body'>, max = 160): string {
  const t = (decisionSection(d, 'decision') ?? '').split(/\n\s*\n/)[0]!.replace(/\s+/g, ' ').replace(/[*_`]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
  return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : t;
}

const cell = (s: string | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ') || '–';

/** The decision log as markdown: a table of every decision, then each one's decision in a line. */
export function decisionLog(decisions: Decision[], o: { title?: string; dir?: string; describe?(concern: string): string } = {}): string {
  const out = [`# ${o.title ?? 'Decision log'}`, ''];
  if (!decisions.length) return [...out, 'No decisions are recorded yet.', ''].join('\n');
  const tally = decisionStatuses.map((s) => [s, decisions.filter((d) => d.status === s).length] as const).filter(([, n]) => n);
  out.push(tally.map(([s, n]) => `${n} ${s}`).join(', ') + '.', '');
  out.push('| # | Decision | Status | Date | Concerns |', '| --- | --- | --- | --- | --- |');
  const link = (d: Decision) => (o.dir !== undefined ? relativeTo(o.dir ? `${o.dir}/x` : 'x', d.file) : d.file);
  for (const d of decisions) out.push(`| ${d.number} | [${cell(d.title)}](${link(d)}) | ${statusSaid(d)} | ${cell(d.date)} | ${cell(d.concerns.map((c) => o.describe?.(c) ?? c).join(', '))} |`);
  out.push('');
  for (const d of decisions) {
    const s = decisionSummary(d, 400);
    if (s) out.push(`**${d.number}. ${d.title}** — ${s}`, '');
  }
  return out.join('\n');
}

const statusTone = { proposed: 'amber', accepted: 'green', rejected: 'slate', deprecated: 'slate', superseded: 'slate' } as const;

/** The Decisions view: one row per decision (number, title, status, date, concerns), for a deck or a page. */
export function decisionTable(decisions: Decision[], o: { title?: string; describe?(concern: string): string } = {}): Graph {
  const columns: MatrixHeader[] = [{ label: 'Decision' }, { label: 'Status' }, { label: 'Date' }, { label: 'Concerns' }];
  const cells: (MatrixCell | undefined)[][] = decisions.map((d) => [
    { text: d.title, strong: true },
    { text: statusSaid(d), tone: statusTone[d.status] },
    { text: d.date ?? '–' },
    { text: d.concerns.map((c) => o.describe?.(c) ?? c).join(', ') || '–' },
  ]);
  const node: GraphNode = decisions.length
    ? { id: 'decisions', shape: { kind: 'matrix', corner: '#', plain: true, wrap: 300, table: true, rows: decisions.map((d) => ({ label: String(d.number) })), columns, cells }, path: [] }
    : { id: 'decisions', shape: { kind: 'card', label: 'No decisions yet', caption: 'Add one with carto decisions new "title"', icon: 'file-text', tone: 'slate' }, path: [] };
  const tally = decisionStatuses.map((s) => [s, decisions.filter((d) => d.status === s).length] as const).filter(([, n]) => n);
  return {
    title: o.title ?? 'Decisions',
    subtitle: tally.map(([s, n]) => `${n} ${s}`).join(', ') || undefined,
    direction: 'right',
    groups: [],
    nodes: [node],
    edges: [],
    legend: [],
  };
}

// ---------------------------------------------------------------- markdown

export type MdBlock =
  | { kind: 'heading'; level: number; parts: Inline[] }
  | { kind: 'para'; parts: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; parts: Inline[] }
  | { kind: 'rule' };

/** The markdown of a decision as blocks: headings, paragraphs, lists, quotes, code. Enough for a preview, nothing executable. */
export function markdownBlocks(text: string): MdBlock[] {
  const out: MdBlock[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: 'para', parts: inlineMarkdown(para.join(' ')) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^```/.test(l.trim())) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !/^```/.test(lines[i]!.trim())) code.push(lines[i]!);
      out.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const h = /^(#{1,6})[ \t]+(.+?)[ \t#]*$/.exec(l);
    if (h) {
      flush();
      out.push({ kind: 'heading', level: h[1]!.length, parts: inlineMarkdown(h[2]!) });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) {
      flush();
      out.push({ kind: 'rule' });
      continue;
    }
    const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(l);
    if (item) {
      flush();
      const ordered = !item[1];
      const last = out.at(-1);
      const parts = inlineMarkdown(item[3]!);
      if (last?.kind === 'list' && last.ordered === ordered) last.items.push(parts);
      else out.push({ kind: 'list', ordered, items: [parts] });
      continue;
    }
    const q = /^\s*>\s?(.*)$/.exec(l);
    if (q) {
      flush();
      out.push({ kind: 'quote', parts: inlineMarkdown(q[1]!) });
      continue;
    }
    if (!l.trim()) flush();
    else para.push(l.trim());
  }
  flush();
  return out;
}
