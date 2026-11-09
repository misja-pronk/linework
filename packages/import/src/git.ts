// A real repository's history → gitflow. Reads the output of
//   git log --topo-order --reverse --format=GIT_LOG_FORMAT [--since …] [--max-count …] <branches>
// (the CLI runs it): one commit per line, parents and refs included, oldest first.
//
// Branches are recovered the way people read a graph: each branch head claims its first-parent
// history, main first, then develop, releases, hotfixes, features; commits only reachable through a
// merge belong to the branch the merge message names ("Merge branch 'feature/x'", "Merge pull
// request #12 from org/feature/x"). Linear runs without tags, forks or merges collapse into one
// "n commits" pill, so a year of history still fits a slide.
import { branchName } from './gitgraph.ts';
import { scalar } from './text.ts';

/** Fields separated by the unit separator: hash, parents, refs, subject. */
export const GIT_LOG_FORMAT = '%H%x1f%P%x1f%D%x1f%s';

export interface GitLogOptions {
  title?: string;
  /** Collapse runs of at least this many plain commits (default 3; 0 keeps every commit). */
  collapse?: number;
  /** Only these branches get lanes; other commits fold into the branch that merged them. */
  branches?: string[];
}

interface Commit {
  hash: string;
  parents: string[];
  refs: string[];
  tags: string[];
  subject: string;
  branch?: string;
}

const RANK = [/^(main|master|trunk)$/, /^(develop|development|dev)$/, /^(release|releases)[/-]/, /^(hotfix|hotfixes)[/-]/];
const rank = (b: string) => {
  const i = RANK.findIndex((r) => r.test(b));
  return i < 0 ? RANK.length : i;
};

/** The branch a merge commit's message says it merged, if it says. */
function mergedName(subject: string): string | undefined {
  const m = /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(subject) ?? /^Merge pull request #\d+ from [^/\s]+\/(\S+)/.exec(subject) ?? /^Merge branch "([^"]+)"/.exec(subject);
  return m ? branchName(m[1]!.replace(/^origin\//, '')) : undefined;
}

export function importGitLog(text: string, opts: GitLogOptions = {}): { yaml: string; warnings: string[] } {
  const warnings: string[] = [];
  const commits: Commit[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const [hash, parents, refs, ...subject] = line.split('\x1f');
    if (!hash || parents === undefined) continue;
    const all = (refs ?? '').split(',').map((r) => r.trim()).filter(Boolean);
    commits.push({
      hash,
      parents: parents.split(' ').filter(Boolean),
      tags: all.filter((r) => r.startsWith('tag: ')).map((r) => r.slice(5)),
      refs: [...new Set(all.filter((r) => !r.startsWith('tag: ') && r !== 'HEAD').map((r) => r.replace(/^HEAD -> /, '').replace(/^[^/]+\/(?=.)/, (p) => (p === 'origin/' || p === 'upstream/' ? '' : p))).filter((r) => r !== 'HEAD'))],
      subject: subject.join('\x1f'),
    });
  }
  if (!commits.length) return { yaml: '', warnings: ['No commits: is it a git repository, and does --since leave anything?'] };
  const byHash = new Map(commits.map((c) => [c.hash, c]));

  // 1. Heads claim their first-parent history, the most important branch first.
  const heads = new Map<string, Commit>();
  for (const c of commits) for (const r of c.refs) if (!opts.branches || opts.branches.includes(r)) heads.set(branchName(r), c);
  const claim = (start: Commit | undefined, name: string) => {
    for (let c = start; c && !c.branch; c = byHash.get(c.parents[0] ?? '')) c.branch = name;
  };
  for (const [name, head] of [...heads].sort((a, b) => rank(a[0]) - rank(b[0]) || commits.indexOf(b[1]) - commits.indexOf(a[1]))) claim(head, name);
  // 2. Merged and deleted branches: the second parent's line, named by the merge message.
  for (const c of [...commits].reverse())
    for (const p of c.parents.slice(1)) {
      const side = byHash.get(p);
      if (side && !side.branch) claim(side, mergedName(c.subject) ?? `merged/${p.slice(0, 7)}`);
    }
  // 3. What is left (a head outside --branches): the branch of its child.
  for (const c of [...commits].reverse()) if (!c.branch) claim(c, commits.find((x) => x.parents[0] === c.hash)?.branch ?? 'main');

  // 4. Steps, oldest first. A branch is created right after the commit it forks from.
  const forksAt = new Map<string, Commit[]>();
  const firstOf = new Map<string, Commit>();
  for (const c of commits) if (!firstOf.has(c.branch!)) firstOf.set(c.branch!, c);
  for (const [b, c] of firstOf) {
    const parent = byHash.get(c.parents[0] ?? '');
    if (parent && parent.branch !== b) (forksAt.get(parent.hash) ?? forksAt.set(parent.hash, []).get(parent.hash)!).push(c);
  }
  const plain = (c: Commit) => c.parents.length < 2 && !c.tags.length && !forksAt.has(c.hash) && firstOf.get(c.branch!) !== c && !c.refs.length;
  const min = opts.collapse ?? 3;
  const steps: string[][] = [];
  let run: Commit[] = [];
  const flush = () => {
    if (min && run.length >= min) steps.push([`commit: ${run[0]!.branch}`, `count: ${run.length}`]);
    else for (const c of run) steps.push(commitStep(c));
    run = [];
  };
  for (const c of commits) {
    if (plain(c) && (!run.length || run[0]!.branch === c.branch)) {
      run.push(c);
      continue;
    }
    flush();
    if (plain(c)) {
      run.push(c);
      continue;
    }
    const side = c.parents.slice(1).map((p) => byHash.get(p)).find((p) => p && p.branch !== c.branch);
    if (side) steps.push([`merge: ${side.branch} -> ${c.branch}`, ...fields(c, false)]);
    else steps.push(commitStep(c));
    for (const f of forksAt.get(c.hash) ?? []) steps.push([`branch: ${f.branch}`, `from: ${c.branch}`]);
  }
  flush();
  if (commits.length > 400) warnings.push(`${commits.length} commits: consider --since or --max-count`);

  const out = ['type: gitflow'];
  if (opts.title) out.push(`title: ${scalar(opts.title)}`);
  out.push('', 'steps:');
  for (const lines of steps) out.push(`  - ${lines[0]}`, ...lines.slice(1).map((l) => `    ${l}`));
  return { yaml: out.join('\n') + '\n', warnings };
}

function fields(c: Commit, label = true): string[] {
  const out: string[] = [];
  const subject = c.subject.length > 40 ? `${c.subject.slice(0, 38).trimEnd()}…` : c.subject;
  if (label && subject) out.push(`label: ${scalar(subject)}`);
  if (c.tags.length) out.push(`tag: ${c.tags.length === 1 ? scalar(c.tags[0]!) : `[${c.tags.map(scalar).join(', ')}]`}`);
  return out;
}

const commitStep = (c: Commit) => [`commit: ${c.branch}`, ...fields(c)];
