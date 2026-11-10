// Review notes: comment threads stored next to the diagram as <name>.notes.json, never in the YAML
// and apart from the layout sidecar, so a diagram can be shared without them and two people's notes
// merge in git. Each thread hangs on an element, a line, a group or a free point of the canvas.
// An anchor follows a rename (renameNoteAnchors, called where the builder renames), and when its
// element is gone it stays as "orphaned" with the label it last had.
import type { Graph, GraphGroup, GraphNode, Point } from './model.ts';
import type { Lang } from '@cartography/i18n';
import { tr } from '@cartography/i18n/drawing';

export type NoteAnchor =
  | { kind: 'node' | 'group'; id: string; label?: string }
  /** A line by its ends (edge ids are positions in a list, so not what a note can hold on to). */
  | { kind: 'edge'; from: string; to: string; label?: string }
  /** A free point of the canvas, in pin space (as pins are), in the thread's view. */
  | { kind: 'point'; x: number; y: number };

export interface NoteReply {
  id: string;
  author: string;
  /** ISO timestamps. */
  created: string;
  edited?: string;
  /** Plain text with simple markdown: **bold**, *italic*, `code`, [links](https://…), "- " lists. */
  text: string;
}

export interface NoteThread extends NoteReply {
  anchor: NoteAnchor;
  /** The view it was written in; without one it shows in every view that draws its anchor. */
  view?: string;
  status: 'open' | 'resolved';
  replies?: NoteReply[];
}

export interface NotesFile {
  version: 1;
  threads: NoteThread[];
}

export const notesPath = (diagram: string) => diagram.replace(/\.ya?ml$/i, '') + '.notes.json';

export const emptyNotes = (): NotesFile => ({ version: 1, threads: [] });

const str = (v: unknown): v is string => typeof v === 'string';

function readReply(v: unknown): NoteReply | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  if (!str(r.id) || !str(r.text)) return undefined;
  return { id: r.id, author: str(r.author) ? r.author : '', created: str(r.created) ? r.created : '', ...(str(r.edited) ? { edited: r.edited } : {}), text: r.text };
}

function readAnchor(v: unknown): NoteAnchor | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const a = v as Record<string, unknown>;
  const label = str(a.label) ? { label: a.label } : {};
  if ((a.kind === 'node' || a.kind === 'group') && str(a.id)) return { kind: a.kind, id: a.id, ...label };
  if (a.kind === 'edge' && str(a.from) && str(a.to)) return { kind: 'edge', from: a.from, to: a.to, ...label };
  if (a.kind === 'point' && typeof a.x === 'number' && typeof a.y === 'number' && Number.isFinite(a.x) && Number.isFinite(a.y)) return { kind: 'point', x: a.x, y: a.y };
  return undefined;
}

/** The notes file read leniently: a thread that cannot be read is skipped and said, the rest stays. */
export function parseNotes(text: string | undefined): { notes: NotesFile; problems: string[] } {
  const notes = emptyNotes();
  if (!text?.trim()) return { notes, problems: [] };
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return { notes, problems: [`not valid JSON: ${(e as Error).message}${/^(<{7}|={7}|>{7})/m.test(text) ? ' (a git merge left conflict markers: carto notes --merge-driver can merge it, see docs/notes.md)' : ''}`] };
  }
  const list = v && typeof v === 'object' ? (v as { threads?: unknown }).threads : undefined;
  if (!Array.isArray(list)) return { notes, problems: ['no "threads" list'] };
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [i, t] of list.entries()) {
    const base = readReply(t);
    const anchor = base && readAnchor((t as { anchor?: unknown }).anchor);
    if (!base || !anchor || seen.has(base.id)) {
      problems.push(`thread ${i + 1}${base ? ` (${base.id})` : ''}: ${!base ? 'needs an id and a text' : !anchor ? 'its anchor cannot be read' : 'the same id twice'}; skipped`);
      continue;
    }
    seen.add(base.id);
    const r = t as Record<string, unknown>;
    const replies = Array.isArray(r.replies) ? r.replies.map(readReply).filter((x): x is NoteReply => !!x) : [];
    notes.threads.push({ ...base, anchor, ...(str(r.view) && r.view ? { view: r.view } : {}), status: r.status === 'resolved' ? 'resolved' : 'open', ...(replies.length ? { replies } : {}) });
  }
  return { notes, problems };
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byTime = (a: NoteReply, b: NoteReply) => (a.created < b.created ? -1 : a.created > b.created ? 1 : byId(a, b));

/** Keys in a fixed order, so the same notes always give the same file. */
function ordered(t: NoteThread | NoteReply): Record<string, unknown> {
  const thread = 'anchor' in t ? t : undefined;
  const a = thread?.anchor;
  const anchor = !a ? undefined : a.kind === 'point' ? { kind: a.kind, x: a.x, y: a.y } : a.kind === 'edge' ? { kind: a.kind, from: a.from, to: a.to, label: a.label } : { kind: a.kind, id: a.id, label: a.label };
  return {
    id: t.id,
    ...(anchor ? { anchor, view: thread!.view, status: thread!.status } : {}),
    author: t.author,
    created: t.created,
    edited: t.edited,
    text: t.text,
    ...(thread?.replies?.length ? { replies: [...thread.replies].sort(byTime).map(ordered) } : {}),
  };
}

/**
 * The file as written: stable key order, threads sorted by id (ids are random, so two people's new
 * threads land in different places of the list), each thread on its own lines. Undefined: nothing to keep.
 */
export function printNotes(notes: NotesFile | undefined): string | undefined {
  if (!notes?.threads.length) return undefined;
  const threads = [...notes.threads].sort(byId).map((t) => '    ' + JSON.stringify(ordered(t), null, 2).replace(/\n/g, '\n    '));
  return `{\n  "version": 1,\n  "threads": [\n${threads.join(',\n')}\n  ]\n}\n`;
}

/** A new id: random, so ids of threads written apart (two branches) do not sort next to each other. */
export function newNoteId(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => (b % 36).toString(36)).join('') + (bytes[0]! % 10).toString();
}

/** Threads numbered 1, 2, 3 … in the order they were written: the numbers on markers and in lists. */
export function noteNumbers(notes: NotesFile): Map<string, number> {
  return new Map([...notes.threads].sort(byTime).map((t, i) => [t.id, i + 1]));
}

/** When a thread last changed: its own edit or its newest reply. */
export function lastActivity(t: NoteThread): string {
  return [t.edited ?? t.created, ...(t.replies ?? []).map((r) => r.edited ?? r.created)].reduce((a, b) => (b > a ? b : a), '');
}

// ---------------------------------------------------------------- anchors

/** The name an element shows: what an orphaned note still says it was about. */
export function nodeLabel(n: GraphNode): string {
  const s = n.shape as { kind: string; label?: string; title?: string };
  return (s.kind === 'table' ? s.title : s.label) || n.id;
}

/** What an anchor is about, as a reader says it: "Orders", "Web → Orders", "a point". */
export function anchorLabel(a: NoteAnchor, graph?: Graph, lang?: Lang): string {
  if (a.kind === 'point') return tr(lang, 'a point on the canvas');
  const name = (id: string) => {
    const n = graph?.nodes.find((x) => x.id === id);
    return n ? nodeLabel(n) : id;
  };
  if (a.kind === 'edge') return a.label && !graph ? a.label : `${name(a.from)} → ${name(a.to)}`;
  if (graph) {
    const hit = a.kind === 'node' ? graph.nodes.find((x) => x.id === a.id) : graph.groups.find((g) => g.id === a.id);
    if (hit) return a.kind === 'node' ? nodeLabel(hit as GraphNode) : (hit as GraphGroup).label || a.id;
  }
  return a.label ?? a.id;
}

export type Resolved =
  | { state: 'attached'; kind: 'node' | 'group' | 'edge'; id: string; anchor: NoteAnchor }
  | { state: 'point'; at: Point }
  | { state: 'orphaned'; was: string };

/**
 * Where an anchor is in a drawing. An id that is gone is looked for by the label it had (an id
 * renamed by hand in the YAML, or a rename undone): one element with that label is it. `anchor` is
 * the anchor as it should now be written (new id, current label).
 */
export function resolveAnchor(a: NoteAnchor, graph: Graph): Resolved {
  if (a.kind === 'point') return { state: 'point', at: { x: a.x, y: a.y } };
  if (a.kind === 'edge') {
    // Of two lines between the same ends, the one with the label it had.
    const lines = graph.edges.filter((e) => e.from.node === a.from && e.to.node === a.to);
    const e = lines.find((x) => (x.label ?? '') === (a.label ?? '')) ?? lines[0];
    if (!e) return { state: 'orphaned', was: anchorLabel(a, graph) };
    return { state: 'attached', kind: 'edge', id: e.id, anchor: { kind: 'edge', from: a.from, to: a.to, ...(e.label ? { label: e.label } : {}) } };
  }
  const list: [string, string][] = a.kind === 'node' ? graph.nodes.map((n) => [n.id, nodeLabel(n)]) : graph.groups.map((g) => [g.id, g.label || g.id]);
  const id = list.some(([x]) => x === a.id) ? a.id : a.label ? findByLabel(list, a.label) : undefined;
  if (!id) return { state: 'orphaned', was: a.label ?? a.id };
  return { state: 'attached', kind: a.kind, id, anchor: { kind: a.kind, id, label: list.find(([x]) => x === id)![1] } };
}

/** The one entry with this label; none when it is not one. */
function findByLabel(list: [string, string][], label: string): string | undefined {
  const hits = list.filter(([, l]) => l === label);
  return hits.length === 1 ? hits[0]![0] : undefined;
}

/** The anchor of a selected element, with its label for when it is gone. */
export function anchorFor(graph: Graph, kind: 'node' | 'group' | 'edge', id: string): NoteAnchor | undefined {
  if (kind === 'edge') {
    const e = graph.edges.find((x) => x.id === id);
    return e && { kind: 'edge', from: e.from.node, to: e.to.node, ...(e.label ? { label: e.label } : {}) };
  }
  const r = resolveAnchor({ kind, id }, graph);
  return r.state === 'attached' ? r.anchor : undefined;
}

/** Threads shown in a view: those of that view and those written for none. */
export function notesInView(notes: NotesFile, view: string | undefined): NoteThread[] {
  return notes.threads.filter((t) => !t.view || t.view === view);
}

/** An element renamed (by the builder): its notes, and the notes on its lines, go along. */
export function renameNoteAnchors(notes: NotesFile, kind: 'node' | 'group', from: string, to: string): NotesFile {
  let changed = false;
  const threads = notes.threads.map((t) => {
    const a = t.anchor;
    if (a.kind === kind && a.id === from) return (changed = true), { ...t, anchor: { ...a, id: to } };
    if (kind === 'node' && a.kind === 'edge' && (a.from === from || a.to === from))
      return (changed = true), { ...t, anchor: { ...a, from: a.from === from ? to : a.from, to: a.to === from ? to : a.to } };
    return t;
  });
  return changed ? { ...notes, threads } : notes;
}

/**
 * Anchors written as they are now found (an id found again by its label, a label that changed), for
 * the threads this drawing shows. The same object back when nothing changed, so a save says nothing new.
 */
export function healNotes(notes: NotesFile, graph: Graph, view: string | undefined): NotesFile {
  let changed = false;
  const threads = notes.threads.map((t) => {
    if (t.view && t.view !== view) return t;
    const r = resolveAnchor(t.anchor, graph);
    if (r.state !== 'attached' || JSON.stringify(r.anchor) === JSON.stringify(t.anchor)) return t;
    changed = true;
    return { ...t, anchor: r.anchor };
  });
  return changed ? { ...notes, threads } : notes;
}

// ---------------------------------------------------------------- merging

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** One entry of a three-way merge: the side that changed wins; both changed, the one edited last. */
function pick<T extends NoteReply>(base: T | undefined, ours: T | undefined, theirs: T | undefined, inner: (b: T | undefined, o: T, t: T) => T): T | undefined {
  if (!ours && !theirs) return undefined;
  // Deleted on one side: gone, unless the other side changed it meanwhile.
  if (!ours) return base && same(base, theirs) ? undefined : theirs;
  if (!theirs) return base && same(base, ours) ? undefined : ours;
  if (same(ours, theirs) || same(base, theirs)) return ours;
  if (same(base, ours)) return theirs;
  return inner(base, ours, theirs);
}

const later = <T extends NoteReply>(o: T, t: T) => ((t.edited ?? t.created) > (o.edited ?? o.created) ? t : o);

function mergeList<T extends NoteReply>(base: T[], ours: T[], theirs: T[], inner: (b: T | undefined, o: T, t: T) => T): T[] {
  const index = (l: T[]) => new Map(l.map((x) => [x.id, x]));
  const [b, o, t] = [index(base), index(ours), index(theirs)];
  const out: T[] = [];
  for (const id of new Set([...o.keys(), ...t.keys()])) {
    const hit = pick(b.get(id), o.get(id), t.get(id), inner);
    if (hit) out.push(hit);
  }
  return out;
}

/**
 * Three-way merge of notes files by thread and reply id: what git's merge driver does (carto notes
 * --merge-driver). New threads and replies of both sides are kept; a thread both changed takes the
 * later text and status, and the replies of both.
 */
export function mergeNotes(base: NotesFile, ours: NotesFile, theirs: NotesFile): NotesFile {
  const threads = mergeList(base.threads, ours.threads, theirs.threads, (b, o, t) => {
    const top = later(o, t);
    const replies = mergeList(b?.replies ?? [], o.replies ?? [], t.replies ?? [], (_, ro, rt) => later(ro, rt));
    // A status changed on one side only is that side's, whoever edited the text last.
    const status = b && o.status !== b.status && t.status === b.status ? o.status : b && t.status !== b.status && o.status === b.status ? t.status : top.status;
    const out: NoteThread = { ...top, status, replies };
    if (!replies.length) delete out.replies;
    return out;
  });
  return { version: 1, threads };
}

// ---------------------------------------------------------------- text

export type Inline = { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string };
export type Block = { list: boolean; parts: Inline[] };

/** Simple markdown: paragraphs and "- " list items of **bold**, *italic*, `code` and [links](url). Only http(s) and mailto links. */
export function noteBlocks(text: string): Block[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l, i, all) => l.trim() || (i > 0 && all[i - 1]!.trim()))
    .map((l) => {
      const m = /^\s*[-*]\s+(.*)$/.exec(l);
      return { list: !!m, parts: inlineMarkdown(m ? m[1]! : l) };
    });
}

/** **bold**, *italic*, `code` and [links](url) of one line; only http(s) and mailto links keep their target. */
export function inlineMarkdown(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let at = 0;
  for (let m: RegExpExecArray | null; (m = re.exec(s)); ) {
    if (m.index > at) out.push({ text: s.slice(at, m.index) });
    if (m[1]) out.push({ text: m[1], bold: true });
    else if (m[2]) out.push({ text: m[2], italic: true });
    else if (m[3]) out.push({ text: m[3], code: true });
    else out.push(/^(https?:|mailto:)/i.test(m[5]!) ? { text: m[4]!, href: m[5]! } : { text: m[4]! });
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ text: s.slice(at) });
  return out;
}

/** The text without its marks, one line per paragraph or list item ("• item"): for SVG and slides. */
export function notePlain(text: string): string[] {
  return noteBlocks(text).map((b) => (b.list ? '• ' : '') + b.parts.map((p) => p.text).join(''));
}

const day = (iso: string) => iso.slice(0, 16).replace('T', ' ');

/** The threads as markdown: what `carto notes` prints and what a pull request can carry. */
export function notesMarkdown(notes: NotesFile, opts: { graph?: Graph; views?: Record<string, Graph>; title?: string; all?: boolean; lang?: Lang } = {}): string {
  const lang = opts.lang;
  const numbers = noteNumbers(notes);
  const list = [...notes.threads].filter((t) => opts.all || t.status === 'open').sort((a, b) => numbers.get(a.id)! - numbers.get(b.id)!);
  const out = [`# ${tr(lang, 'Review notes')}${opts.title ? `: ${opts.title}` : ''}`, ''];
  const open = notes.threads.filter((t) => t.status === 'open').length;
  out.push(`${tr(lang, '{open} open, {resolved} resolved', { open, resolved: notes.threads.length - open })}${opts.all ? '' : ` ${tr(lang, '(not listed; --all lists them)')}`}.`, '');
  if (!list.length) out.push(opts.all ? tr(lang, 'No notes.') : tr(lang, 'No open notes.'), '');
  for (const t of list) {
    const graph = (t.view && opts.views?.[t.view]) || opts.graph;
    const r = graph ? resolveAnchor(t.anchor, graph) : undefined;
    const about = r?.state === 'orphaned' ? `${r.was} (${tr(lang, 'orphaned: no longer in the diagram')})` : anchorLabel(r?.state === 'attached' ? r.anchor : t.anchor, graph, lang);
    out.push(`## ${numbers.get(t.id)}. ${about}${t.status === 'resolved' ? ` — ${tr(lang, 'resolved')}` : ''}`, '');
    out.push(`*${t.author || tr(lang, 'someone')}, ${day(t.created)}${t.view ? `, ${tr(lang, 'view {name}', { name: t.view })}` : ''}${t.edited ? `, ${tr(lang, 'edited')}` : ''}*`, '', t.text.trim(), '');
    for (const reply of [...(t.replies ?? [])].sort(byTime)) {
      out.push(`> **${reply.author || tr(lang, 'someone')}**, ${day(reply.created)}${reply.edited ? `, ${tr(lang, 'edited')}` : ''}`, ...reply.text.trim().split('\n').map((l) => `> ${l}`), '');
    }
  }
  return out.join('\n').replace(/\n+$/, '\n');
}

/** The threads a view shows, as plain lines ("3. Orders — Ann: text", replies indented): PowerPoint's speaker notes. */
export function noteLines(notes: NotesFile, graph: Graph, view: string | undefined, resolved = false, lang?: Lang): string[] {
  const numbers = noteNumbers(notes);
  const out: string[] = [];
  for (const t of notesInView(notes, view).filter((x) => resolved || x.status === 'open').sort((a, b) => numbers.get(a.id)! - numbers.get(b.id)!)) {
    const r = resolveAnchor(t.anchor, graph);
    const about = r.state === 'orphaned' ? `${r.was} (${tr(lang, 'no longer in the diagram')})` : anchorLabel(r.state === 'attached' ? r.anchor : t.anchor, graph, lang);
    const [first = '', ...rest] = notePlain(t.text);
    out.push(`${numbers.get(t.id)}. ${about}${t.status === 'resolved' ? ` (${tr(lang, 'resolved')})` : ''} — ${t.author || tr(lang, 'someone')}: ${first}`, ...rest.map((l) => `   ${l}`));
    for (const reply of [...(t.replies ?? [])].sort(byTime)) out.push(...notePlain(reply.text).map((l, i) => (i ? `      ${l}` : `   ↳ ${reply.author || tr(lang, 'someone')}: ${l}`)));
  }
  return out;
}
