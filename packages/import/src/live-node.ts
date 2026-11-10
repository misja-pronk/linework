// The runner for live imports on Node: spawns the user's own kubectl, az or gh with an argument
// list (never a shell), after the allow-list said yes, and stops it when it takes too long.
import { spawn } from 'node:child_process';
import { LiveError, refusal, shown, type Argv, type Ran, type Run } from './live.ts';

export { fetchLive, livePlan, liveProblem, refusal, shown, withoutSecrets, LiveError, LIVE_SOURCES, type Fetched, type LiveOptions, type LiveSource } from './live.ts';

const INSTALL: Record<string, string> = {
  kubectl: 'https://kubernetes.io/docs/tasks/tools/',
  az: 'https://learn.microsoft.com/cli/azure/install-azure-cli',
  gh: 'https://cli.github.com',
};

/** A runner that spawns each command, at most `timeoutMs` long. */
export function nodeRunner({ timeoutMs = 120_000 }: { timeoutMs?: number } = {}): Run {
  return (argv: Argv) =>
    new Promise<Ran>((resolve, reject) => {
      const why = refusal(argv);
      if (why) return reject(new LiveError(`Not run: ${shown(argv)} (${why})`));
      const [tool, ...args] = argv as [string, ...string[]];
      const child = spawn(tool, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let late = false;
      const timer = setTimeout(() => {
        late = true;
        child.kill('SIGTERM');
      }, timeoutMs);
      child.stdout.on('data', (b: Buffer) => out.push(b));
      child.stderr.on('data', (b: Buffer) => err.push(b));
      child.on('error', (e: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        reject(e.code === 'ENOENT' ? new LiveError(`${tool} is not installed, or not on PATH: ${INSTALL[tool] ?? 'install it'} first`) : new LiveError(`${tool} could not be started: ${e.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (late) return reject(new LiveError(`${shown(argv)} took longer than ${Math.round(timeoutMs / 1000)}s and was stopped (--timeout gives it longer)`));
        resolve({ code: code ?? 1, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
      });
    });
}
