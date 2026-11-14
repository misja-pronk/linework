// Where the live hosts are: each editor that answers live calls (the VS Code extension, linework serve)
// writes a small file into a folder of the user's temp directory while it runs, readable by the user
// only. An MCP server picks the host whose folders hold the diagram (or its own working directory).
// Node only, no other imports: the VS Code extension bundles this file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export interface LiveEndpoint {
  host: 'vscode' | 'browser';
  /** http://127.0.0.1:<port> */
  url: string;
  token: string;
  /** The folders it has open (absolute). */
  roots: string[];
  pid: number;
  /** When it started, ms. */
  since: number;
}

export const discoveryDir = () => path.join(os.tmpdir(), 'linework-live');

export function announce(e: Omit<LiveEndpoint, 'pid' | 'since'>): () => void {
  const entry: LiveEndpoint = { ...e, pid: process.pid, since: Date.now() };
  // One process may be more than one host (tests); the pid says when the file is stale.
  const file = path.join(discoveryDir(), `${process.pid}-${randomBytes(4).toString('hex')}.json`);
  fs.mkdirSync(discoveryDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(entry), { mode: 0o600 });
  return () => fs.rmSync(file, { force: true });
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const inside = (root: string, p: string) => {
  const rel = path.relative(root, p);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** The hosts running now; files of hosts that are gone are cleaned up. */
export function endpoints(): LiveEndpoint[] {
  let names: string[];
  try {
    names = fs.readdirSync(discoveryDir()).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  return names.flatMap((n) => {
    const p = path.join(discoveryDir(), n);
    try {
      const e = JSON.parse(fs.readFileSync(p, 'utf8')) as LiveEndpoint;
      if (alive(e.pid)) return [e];
      fs.rmSync(p, { force: true });
    } catch {
      /* half written, or not ours */
    }
    return [];
  });
}

/** The host for a path: the one with the deepest folder around it, the newest of equals. */
export function endpointFor(p: string, all = endpoints()): LiveEndpoint | undefined {
  const depth = (e: LiveEndpoint) => Math.max(-1, ...e.roots.filter((r) => inside(r, p)).map((r) => r.length));
  return all
    .filter((e) => depth(e) >= 0)
    .sort((a, b) => depth(b) - depth(a) || b.since - a.since)[0];
}
