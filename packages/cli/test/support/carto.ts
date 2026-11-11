// The CLI in-process: run() with buffers for a terminal, in a folder, as if typed there.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { run } from '../../src/main.ts';

export interface Result {
  code: number | null;
  out: string;
  err: string;
}

/** carto <args…> in `cwd`: exit code, standard output and standard error. `input` is standard input. */
export async function carto(cwd: string, args: string[], o: { input?: string; env?: NodeJS.ProcessEnv } = {}): Promise<Result> {
  const out: Buffer[] = [];
  let err = '';
  const before = process.cwd();
  process.chdir(cwd);
  try {
    const code = await run(args, {
      stdout: { write: (d) => out.push(Buffer.from(d)) },
      stderr: { write: (d) => (err += d) },
      stdin: () => o.input ?? '',
      env: o.env ?? process.env,
    });
    return { code, out: Buffer.concat(out).toString('utf8'), err };
  } finally {
    process.chdir(before);
  }
}

const root = path.resolve(import.meta.dirname, '../../../..');

/** The real command line, in a process of its own: for the few tests that are about the process. */
export function spawnCarto(cwd: string, args: string[], o: { input?: string; env?: NodeJS.ProcessEnv } = {}): Result {
  const r = spawnSync(path.join(root, 'node_modules/.bin/tsx'), [path.join(root, 'packages/cli/src/main.ts'), ...args], { cwd, encoding: 'utf8', input: o.input, env: o.env });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
