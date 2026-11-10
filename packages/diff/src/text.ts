// The structural diff as words: plain text for a terminal, Markdown for a pull request comment.
import type { Change, GraphDiff, ItemDiff, Status } from './structure.ts';

const SIGN: Record<Status, string> = { added: '+', removed: '-', changed: '~' };
const NAME: Record<ItemDiff['kind'], string> = { node: 'node', group: 'group', edge: 'line' };

const quote = (v: unknown) => (typeof v === 'string' ? `"${v}"` : String(v));

/** label: "Web" → "Web shop"; group: rg → (none) */
export function describeChange(c: Change): string {
  if (c.before === undefined) return `${c.field}: ${c.after === true ? 'set' : `added ${quote(c.after)}`}`;
  if (c.after === undefined) return `${c.field}: ${c.before === true ? 'unset' : `removed ${quote(c.before)}`}`;
  return `${c.field}: ${quote(c.before)} → ${quote(c.after)}`;
}

/** "2 added, 1 removed, 3 changed", or "no changes". */
export function summary(d: GraphDiff): string {
  const parts = (['added', 'removed', 'changed'] as const).filter((s) => d.counts[s]).map((s) => `${d.counts[s]} ${s}`);
  if (d.diagram.length) parts.push('title changed');
  return parts.length ? parts.join(', ') : 'no changes';
}

const items = (d: GraphDiff) => [...d.groups, ...d.nodes, ...d.edges];

/** One line per element, removed and added first: "+ node  cache  "Cache"". */
export function formatDiff(d: GraphDiff): string {
  const out: string[] = [];
  for (const c of d.diagram) out.push(`~ ${describeChange(c)}`);
  const all = items(d);
  const wide = Math.max(0, ...all.map((i) => i.id.length));
  for (const i of all) {
    const what = i.status === 'changed' ? i.changes!.map(describeChange).join('; ') : i.label && i.label !== i.id ? `"${i.label}"` : '';
    out.push(`${SIGN[i.status]} ${NAME[i.kind].padEnd(5)} ${i.id.padEnd(wide)}  ${what}`.trimEnd());
  }
  return out.join('\n');
}

// Labels come from the diagram, which in a pull request is somebody else's text: no markup, no links.
export const escapeMarkdown = (s: string): string => s.replace(/([|\\`*_<>[\]])/g, '\\$1').replace(/\n/g, ' ');

/** The same as a Markdown table, for a pull request comment; at most `limit` rows, the rest counted. */
export function markdownDiff(d: GraphDiff, limit = 40): string {
  if (d.same) return '_No changes in what is drawn._';
  const rows: string[] = [];
  for (const c of d.diagram) rows.push(`| ~ changed | diagram | | ${escapeMarkdown(describeChange(c))} |`);
  for (const i of items(d)) {
    const what = i.status === 'changed' ? i.changes!.map(describeChange).join('; ') : (i.label ?? '');
    rows.push(`| ${SIGN[i.status] === '-' ? '−' : SIGN[i.status]} ${i.status} | ${NAME[i.kind]} | \`${i.id.replace(/`/g, '').replace(/\|/g, '\\|').replace(/\n/g, ' ')}\` | ${escapeMarkdown(what)} |`);
  }
  const shown = rows.slice(0, limit);
  const more = rows.length - shown.length;
  return ['| | | id | what |', '|---|---|---|---|', ...shown].join('\n') + (more > 0 ? `\n\n…and ${more} more.` : '');
}
