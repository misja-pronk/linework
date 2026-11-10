// The diff in plain sentences, for people who do not read diagrams for a living: a change advisory
// board, a release note. "Added Redis cache in rg-shop", "Orders API now connects to Redis cache
// (“TLS”)", "Removed Legacy VM (and its 2 connections)". No AI: every sentence comes from the
// structural diff, with the names the drawing shows rather than ids.
import type { Graph, GraphEdge, GraphNode } from '@cartography/core';
import { escapeMarkdown, markdownDiff } from './text.ts';
import type { Change, GraphDiff, ItemDiff, Status } from './structure.ts';

/** One sentence, with the element it is about (to focus it in the drawing). */
export interface Explained {
  text: string;
  item?: ItemDiff;
}

/** What the drawing calls a node: its label, a table's title, else its id. */
function nodeName(n: GraphNode | undefined, id: string): string {
  const s = n?.shape as { label?: string; title?: string } | undefined;
  return s?.label || s?.title || id;
}

const quote = (v: unknown) => (typeof v === 'string' ? `“${v}”` : String(v));
const lower = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);

interface Names {
  node(id: string, side?: 'before' | 'after'): string;
  group(id: string | undefined, side?: 'before' | 'after'): string | undefined;
  edge(id: string | undefined, side: 'before' | 'after'): GraphEdge | undefined;
}

function names(before: Graph | undefined, after: Graph | undefined): Names {
  const graph = (side: 'before' | 'after' = 'after') => (side === 'after' ? (after ?? before) : (before ?? after));
  return {
    node: (id, side) => {
      const g = graph(side);
      const other = g === after ? before : after;
      return nodeName(g?.nodes.find((n) => n.id === id) ?? other?.nodes.find((n) => n.id === id), id);
    },
    group: (id, side) => {
      if (!id) return undefined;
      const g = graph(side);
      return (g?.groups.find((x) => x.id === id) ?? (g === after ? before : after)?.groups.find((x) => x.id === id))?.label || id;
    },
    edge: (id, side) => (id ? (side === 'after' ? after : before)?.edges.find((e) => e.id === id) : undefined),
  };
}

/** A field change in words: "icon “server” → “database”", "description changed". */
function field(c: Change): string {
  const long = (v: unknown) => typeof v === 'string' && v.length > 40;
  if (long(c.before) || long(c.after)) return `${c.field} ${c.before === undefined ? 'added' : c.after === undefined ? 'removed' : 'changed'}`;
  if (c.before === undefined) return c.after === true ? `${c.field} set` : `${c.field} now ${quote(c.after)}`;
  if (c.after === undefined) return c.before === true ? `${c.field} unset` : `no ${c.field} (was ${quote(c.before)})`;
  return `${c.field} ${quote(c.before)} → ${quote(c.after)}`;
}

/** A changed node or group: a rename and a move in their own words, the rest listed after them. */
function changedSentence(i: ItemDiff, n: Names): string {
  const is = i.label ?? (i.kind === 'group' ? (n.group(i.id) ?? i.id) : n.node(i.id));
  let rename: string | undefined;
  let move: { from?: string; to?: string } | undefined;
  const rest: Change[] = [];
  for (const c of i.changes ?? []) {
    if (c.field === 'label' && typeof c.before === 'string' && typeof c.after === 'string') rename = `Renamed ${quote(c.before)} to ${quote(c.after)}`;
    else if (c.field === 'group') move = { from: n.group(c.before as string | undefined, 'before'), to: n.group(c.after as string | undefined, 'after') };
    else rest.push(c);
  }
  const moved = move && (move.from && move.to ? `from ${move.from} to ${move.to}` : move.to ? `into ${move.to}` : `out of ${move.from}`);
  const parts = rename ? [rename, ...(moved ? [`moved it ${moved}`] : [])] : moved ? [`Moved ${is} ${moved}`] : [];
  if (rest.length) parts.push(parts.length ? `its ${rest.map(field).join(', ')}` : `${is}: ${rest.map(field).join(', ')}`);
  return parts.join('; ');
}

/**
 * The changes as sentences, in the order a person tells them: what is new, what changed, what is gone.
 * Lines to or from something that went are not told one by one: the removal says how many went with it.
 */
export function explain(diff: GraphDiff, before?: Graph, after?: Graph): Explained[] {
  const n = names(before, after);
  const out: Explained[] = [];
  for (const c of diff.diagram) {
    if (c.field === 'title') out.push({ text: c.before && c.after ? `Renamed the diagram from ${quote(c.before)} to ${quote(c.after)}` : c.after ? `Titled the diagram ${quote(c.after)}` : 'Removed the title' });
    else out.push({ text: c.after ? `Subtitle now ${quote(c.after)}` : 'Removed the subtitle' });
  }
  const removed = new Set(diff.nodes.filter((i) => i.status === 'removed').map((i) => i.id));
  const ends = (i: ItemDiff, side: 'before' | 'after') => {
    const e = n.edge(i.edge?.[side], side);
    return e ? { from: e.from.node, to: e.to.node } : (() => {
      const [a, b] = i.id.replace(/ #\d+$/, '').split(' -> ');
      return { from: (a ?? '').split('.')[0]!, to: (b ?? '').split('.')[0]! };
    })();
  };
  const where = (parent: string | undefined, side: 'before' | 'after', word: string) => (parent ? ` ${word} ${n.group(parent, side)}` : '');
  const caption = (id: string, side: 'before' | 'after') => {
    const g = side === 'after' ? after : before;
    const node = g?.nodes.find((x) => x.id === id);
    const cap = (node?.shape as { caption?: string } | undefined)?.caption;
    return { parent: node?.parent, cap: cap && cap.toLowerCase() !== nodeName(node, id).toLowerCase() ? cap : undefined };
  };

  for (const g of diff.groups.filter((i) => i.status === 'added')) {
    const grp = after?.groups.find((x) => x.id === g.id);
    out.push({ text: `Added ${grp?.caption ? `${lower(grp.caption)} ` : 'group '}${g.label ?? g.id}${where(grp?.parent, 'after', 'in')}`, item: g });
  }
  for (const i of diff.nodes.filter((x) => x.status === 'added')) {
    const { parent, cap } = caption(i.id, 'after');
    out.push({ text: `Added ${n.node(i.id)}${cap ? ` (${lower(cap)})` : ''}${where(parent, 'after', 'in')}`, item: i });
  }
  for (const e of diff.edges.filter((x) => x.status === 'added')) {
    const { from, to } = ends(e, 'after');
    out.push({ text: `${n.node(from)} now connects to ${n.node(to)}${e.label ? ` (${quote(e.label)})` : ''}`, item: e });
  }
  for (const i of [...diff.groups, ...diff.nodes].filter((x) => x.status === 'changed')) out.push({ text: changedSentence(i, n), item: i });
  for (const e of diff.edges.filter((x) => x.status === 'changed')) {
    const { from, to } = ends(e, 'after');
    const label = e.changes?.find((c) => c.field === 'label');
    const rest = (e.changes ?? []).filter((c) => c !== label);
    const parts = [
      ...(label ? [label.after === undefined ? `no longer labelled ${quote(label.before)}` : label.before === undefined ? `now labelled ${quote(label.after)}` : `now ${quote(label.after)} (was ${quote(label.before)})`] : []),
      ...rest.map(field),
    ];
    out.push({ text: `${n.node(from)} → ${n.node(to)}: ${parts.join(', ')}`, item: e });
  }
  for (const i of diff.nodes.filter((x) => x.status === 'removed')) {
    const { parent } = caption(i.id, 'before');
    const gone = diff.edges.filter((e) => e.status === 'removed' && (({ from, to }) => from === i.id || to === i.id)(ends(e, 'before'))).length;
    out.push({ text: `Removed ${n.node(i.id, 'before')}${where(parent, 'before', 'from')}${gone ? ` (and ${gone === 1 ? 'its connection' : `its ${gone} connections`})` : ''}`, item: i });
  }
  for (const e of diff.edges.filter((x) => x.status === 'removed')) {
    const { from, to } = ends(e, 'before');
    if (removed.has(from) || removed.has(to)) continue;
    out.push({ text: `${n.node(from, 'before')} no longer connects to ${n.node(to, 'before')}${e.label ? ` (${quote(e.label)})` : ''}`, item: e });
  }
  for (const g of diff.groups.filter((i) => i.status === 'removed')) out.push({ text: `Removed ${g.label ?? g.id}`, item: g });
  return out;
}

/**
 * How many changes, counted as the sentences tell them: a line that went with its node is part of
 * that node's sentence, not a change of its own; a new title is a change. The editor's list, its
 * counts, the picture's key and the Markdown summary all count this way, so they agree.
 */
export function countTold(told: Explained[]): Record<Status, number> {
  const counts: Record<Status, number> = { added: 0, removed: 0, changed: 0 };
  for (const x of told) counts[x.item?.status ?? 'changed']++;
  return counts;
}

export const toldCounts = (diff: GraphDiff, before?: Graph, after?: Graph): Record<Status, number> => countTold(explain(diff, before, after));

/** "2 added, 1 removed, 3 changed", or "no changes": the counts of the sentences. */
export function toldSummary(diff: GraphDiff, before?: Graph, after?: Graph): string {
  const counts = toldCounts(diff, before, after);
  const parts = (['added', 'removed', 'changed'] as const).filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`);
  return parts.length ? parts.join(', ') : 'no changes';
}

/** The sentences joined for a one-line note: "Added Redis cache; removed Legacy VM." */
export function explainText(diff: GraphDiff, before?: Graph, after?: Graph): string {
  const s = explain(diff, before, after).map((x, i) => (i ? lower(x.text) : x.text));
  return s.length ? `${s.join('; ')}.` : 'No changes in what is drawn.';
}

export interface ExplainOptions {
  /** The diagram's name or file, for the heading. */
  name?: string;
  /** What it is compared with: "last saved", "snapshot before-review", "HEAD". */
  against?: string;
  /** Extra sentences told first, e.g. who gained and lost access. */
  lead?: string[];
}

/** For a change advisory board or a pull request: a heading, the counts, the sentences, then the table element by element. */
export function explainMarkdown(diff: GraphDiff, before?: Graph, after?: Graph, opts: ExplainOptions = {}): string {
  const name = opts.name ?? after?.title ?? before?.title ?? 'Diagram';
  const head = `## Changes to ${escapeMarkdown(name)}${opts.against ? ` since ${escapeMarkdown(opts.against)}` : ''}`;
  if (diff.same && !opts.lead?.length) return `${head}\n\nNo changes in what is drawn.\n`;
  const lines = [...(opts.lead ?? []), ...explain(diff, before, after).map((x) => x.text)];
  const counts = toldSummary(diff, before, after);
  return [head, '', `${counts[0]!.toUpperCase()}${counts.slice(1)}.`, '', ...lines.map((l) => `- ${escapeMarkdown(l)}`), '', '### Element by element', '', markdownDiff(diff, 200), ''].join('\n');
}
