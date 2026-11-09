// Mermaid gitGraph → gitflow. commit (id, msg, tag, type), branch (order), checkout/switch, merge
// (id, tag), cherry-pick (id, parent). Mermaid works on a checked-out branch; the steps name theirs.
import { cleanLabel, scalar, type Warnings } from './text.ts';

/** A branch name gitflow accepts: Mermaid allows almost anything, quoted. */
export function branchName(raw: string): string {
  const s = cleanLabel(raw).replace(/[^A-Za-z0-9_./-]+/g, '-').replace(/^[^A-Za-z0-9_]+/, '');
  return s || 'branch';
}

/** `key: "value"` pairs after a command; values may be quoted or bare. */
function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/(\w+)\s*:\s*("([^"]*)"|'([^']*)'|[^\s"']+)/g)) out[m[1]!.toLowerCase()] = m[3] ?? m[4] ?? m[2]!;
  return out;
}

/** One step as YAML lines: the first after "- ", the rest indented under it. */
const step = (head: string, fields: [string, string | undefined][]) => [head, ...fields.filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${scalar(v!)}`)];

export function importGitGraph(body: string[], header: string, title: string | undefined, warn: Warnings): string {
  const options = /^gitGraph\s*(LR|TB|BT)?\s*:?/i.exec(header);
  if (options?.[1] && options[1].toUpperCase() !== 'LR') warn.onceFor('dir', `gitGraph ${options[1]} is drawn left to right`);
  const main = 'main';
  let current = main;
  const known = new Set([main]);
  const commits = new Set<string>();
  const picked = new Set<string>();
  const steps: string[][] = [];
  for (const raw of body) {
    const s = raw.trim();
    if (!s) continue;
    let m: RegExpExecArray | null;
    if ((m = /^commit\b(.*)$/i.exec(s))) {
      const a = attrs(m[1]!);
      if (a.type && a.type.toUpperCase() === 'HIGHLIGHT') warn.onceFor('highlight', 'Highlighted commits are drawn as plain commits');
      const note = a.type?.toUpperCase() === 'REVERSE' ? 'Revert' : undefined;
      if (a.id) commits.add(a.id);
      steps.push(step(`commit: ${current}`, [['label', a.msg ?? a.id], ['id', a.id], ['tag', a.tag], ['note', note]]));
    } else if ((m = /^branch\s+("[^"]+"|\S+)(.*)$/i.exec(s))) {
      const name = branchName(m[1]!);
      if (/order\s*:/.test(m[2]!)) warn.onceFor('order', 'Branch order: is not kept; lanes follow the branch kind (main, release, develop, feature)');
      steps.push(step(`branch: ${name}`, [['from', current]]));
      known.add(name);
      current = name;
    } else if ((m = /^(checkout|switch)\s+("[^"]+"|\S+)/i.exec(s))) {
      const name = branchName(m[2]!);
      if (!known.has(name)) warn.add(`checkout of unknown branch "${name}"`);
      current = name;
    } else if ((m = /^merge\s+("[^"]+"|\S+)(.*)$/i.exec(s))) {
      const a = attrs(m[2]!);
      if (a.id) commits.add(a.id);
      steps.push(step(`merge: ${branchName(m[1]!)} -> ${current}`, [['id', a.id], ['tag', a.tag]]));
    } else if ((m = /^cherry-pick\b(.*)$/i.exec(s))) {
      const a = attrs(m[1]!);
      if (!a.id || !commits.has(a.id)) {
        warn.add(`cherry-pick of an unknown commit${a.id ? ` "${a.id}"` : ''} is skipped`);
        continue;
      }
      picked.add(`id: ${scalar(a.id)}`);
      steps.push(step(`cherry-pick: ${scalar(a.id)}`, [['into', current], ['tag', a.tag]]));
    } else if (/^(accTitle|accDescr)\b/i.test(s)) continue;
    else warn.onceFor(`skip:${s}`, `Skipped: ${s}`);
  }
  const out = ['type: gitflow'];
  if (title) out.push(`title: ${scalar(title)}`);
  out.push('', 'steps:');
  if (!steps.length) out.push('  []');
  // Ids only matter to a cherry-pick; the rest is the label already.
  const keep = (l: string) => !l.startsWith('id: ') || picked.has(l);
  for (const lines of steps) out.push(`  - ${lines[0]}`, ...lines.slice(1).filter(keep).map((l) => `    ${l}`));
  return out.join('\n') + '\n';
}
