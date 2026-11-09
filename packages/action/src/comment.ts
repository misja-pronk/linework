// The pull request comment (and the job summary): per diagram what changed, in a picture and in words.
import { markdownDiff, summary } from '@cartography/diff';
import { MARKER } from './github.ts';
import type { Plan, Target } from './plan.ts';

export interface CommentOptions {
  /** Target → address of its picture. Targets without one are described in words only. */
  images?: Map<Target, string>;
  /** What the older version is called: a branch name or a short commit. */
  against?: string;
  /** The commit the pictures were drawn from, short. */
  head?: string;
  /** Where the pictures are when they are not in the comment: a link to the run and its artifact. */
  artifact?: { url: string; name: string };
  /** GitHub refuses comments over 65 536 characters; stay under this. */
  limit?: number;
}

const code = (s: string) => '`' + s.replace(/`/g, '') + '`';
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const titleOf = (t: Target) => (t.view ? `${t.file} · view ${t.view}` : t.file);

function headline(t: Target): string {
  const c = t.comparison;
  switch (t.state) {
    case 'new':
      return t.view ? 'new view' : 'new diagram';
    case 'removed':
      return t.view ? 'view removed' : 'removed';
    case 'layout':
      return 'layout only: the same things, in other places';
    case 'broken':
      return 'does not draw';
    default:
      return summary(c.diff);
  }
}

function section(t: Target, image: string | undefined, table: boolean): string {
  const c = t.comparison;
  const out = [`#### ${code(t.file)}${t.view ? ` · view ${code(t.view)}` : ''}: ${headline(t)}`, ''];
  if (t.because.length) out.push(`Through ${t.because.map(code).join(', ')}.`, '');
  const errors = c.diagnostics.filter((d) => d.severity === 'error');
  for (const d of errors.slice(0, 5)) out.push(`- **Error**${d.line ? ` on line ${d.line}` : ''}: ${d.message.replace(/\s+/g, ' ')}`);
  if (errors.length > 5) out.push(`- …and ${errors.length - 5} more errors`);
  if (errors.length) out.push('');
  if (image) out.push(`![${titleOf(t)}: ${headline(t)}](${image})`, '');
  if (table && t.state === 'changed') out.push('<details><summary>What changed</summary>', '', markdownDiff(c.diff), '', '</details>', '');
  return out.join('\n');
}

/** The comment's Markdown, or undefined when the change touches no diagram (nothing to say). */
export function commentBody(plan: Plan, opts: CommentOptions = {}): string | undefined {
  if (!plan.targets.length && !plan.problems.length) return undefined;
  const limit = opts.limit ?? 60_000;
  const files = new Set(plan.targets.map((t) => t.file));
  const head = [MARKER, '### Diagram changes', ''];
  const against = opts.against ? ` against ${code(opts.against)}` : '';
  head.push(`${plural(files.size, 'diagram')} changed${against}${plan.targets.length > files.size ? `, in ${plural(plan.targets.length, 'drawing')}` : ''}.`, '');

  const tail: string[] = [];
  for (const p of plan.problems) tail.push(`- ${code(p.file)} could not be compared: ${p.message.replace(/\s+/g, ' ')}`);
  if (plan.problems.length) tail.push('');
  if (plan.untouched.length) tail.push(`${plural(plan.untouched.length, 'other diagram')} ${plan.untouched.length === 1 ? 'reads' : 'read'} a changed file and ${plan.untouched.length === 1 ? 'draws' : 'draw'} the same: ${plan.untouched.map(code).join(', ')}.`, '');
  const notes: string[] = [];
  if (opts.artifact && plan.targets.some((t) => !opts.images?.get(t))) notes.push(`Pictures: artifact ${code(opts.artifact.name)} of [this run](${opts.artifact.url})`);
  if (opts.head) notes.push(`Drawn from ${code(opts.head)}`);
  notes.push('solid outline: added, dashed: changed, dotted: removed');
  tail.push(`<sub>${notes.join(' · ')}</sub>`);

  // Everything if it fits; else the tables go first, then whole drawings, counted.
  const fixed = head.join('\n').length + tail.join('\n').length + 200;
  for (const tables of [true, false]) {
    const parts = plan.targets.map((t) => section(t, opts.images?.get(t), tables));
    if (fixed + parts.reduce((n, p) => n + p.length + 1, 0) <= limit) return [...head, ...parts, ...tail].join('\n');
  }
  const parts: string[] = [];
  let size = fixed;
  for (const t of plan.targets) {
    const s = section(t, opts.images?.get(t), false);
    if (size + s.length + 1 > limit) break;
    parts.push(s);
    size += s.length + 1;
  }
  const rest = plan.targets.slice(parts.length);
  return [...head, ...parts, `…and ${plural(rest.length, 'more drawing')}: ${rest.map((t) => code(titleOf(t))).join(', ').slice(0, 2000)}`, '', ...tail].join('\n');
}
