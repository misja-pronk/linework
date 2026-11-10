// carto import --live and carto diff --live: the commands shown, a yes asked for, then run with the
// user's own tools (packages/import/src/live.ts says which, and checks each one).
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fetchLive, LiveError, livePlan, liveProblem, nodeRunner, shown, type Fetched, type LiveOptions, type LiveSource } from '@cartography/import/node';

export interface LiveFlags extends LiveOptions {
  yes?: boolean;
  dryRun?: boolean;
  /** Seconds a command may take. */
  timeout?: number;
  keepRaw?: string;
}

const dim = (s: string) => (process.stderr.isTTY ? `\x1b[2m${s}\x1b[0m` : s);

/** Whether to go on: yes with --yes, else asked on the terminal; never without one. */
async function confirm(): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.error('Not run: no terminal to ask on. Add --yes to run these read-only commands, or --dry-run to only list them');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await rl.question('Run them? [y/N] ')).trim());
  } finally {
    rl.close();
  }
}

/**
 * The commands, then (asked, or with --yes) their answers as the importers read them. Undefined when
 * nothing ran: a dry run, a no, or a problem already said on stderr.
 */
export async function runLive(source: string, flags: LiveFlags): Promise<Fetched[] | undefined> {
  const problem = liveProblem(source, flags);
  if (problem) return (console.error(problem), undefined);
  const plan = livePlan(source as LiveSource, flags);
  if (flags.dryRun) {
    console.log(`carto would run these read-only commands (with your own ${toolOf(source)} and its login):`);
    for (const l of plan) console.log(`  ${l}`);
    return undefined;
  }
  console.error(`carto runs these read-only commands, with your own ${toolOf(source)} and its login:`);
  for (const l of plan) console.error(`  ${l}`);
  if (!flags.yes && !(await confirm())) return undefined;
  let count = 0;
  try {
    const got = await fetchLive(source as LiveSource, { ...flags, onRun: (argv) => (count++, console.error(dim(`$ ${shown(argv)}`))) }, nodeRunner({ timeoutMs: (flags.timeout ?? 120) * 1000 }));
    console.error(dim(`${count} command${count === 1 ? '' : 's'} run`));
    for (const f of got) for (const n of f.notes) console.error(`live ${source}  note  ${n}`);
    if (flags.keepRaw) keepRaw(flags.keepRaw, got);
    return got;
  } catch (e) {
    if (e instanceof LiveError) return (console.error(`live ${source}  error  ${e.message}`), undefined);
    throw e;
  }
}

const toolOf = (source: string) => ({ k8s: 'kubectl', azure: 'az', access: 'az', github: 'gh' })[source] ?? source;

/** The answers as files, secrets already taken out: for carto import <folder> later, or to look at. */
function keepRaw(dir: string, got: Fetched[]) {
  for (const f of got)
    for (const file of f.files) {
      const to = path.join(dir, ...(got.length > 1 ? [f.kind] : []), ...file.path.split('/'));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, file.text);
    }
  console.error(`answers → ${dir}`);
}
