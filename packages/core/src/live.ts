// The live link: how someone's own AI agent (through the MCP server) talks to an editor that has a
// diagram open. Two calls, both asked by the agent and answered by the editor:
//   context  what is open: the file, what is selected, the view, layers and step, the problems;
//   propose  edits by YAML path (edit.ts), shown in the editor as a proposal with the diff marks;
//            it resolves when the user accepts or rejects it. A file of the host's folder that is
//            not open is opened first (VS Code: the document and its preview; the browser editor
//            of linework serve: the file in the editor). `not-open` only when it cannot be: outside
//            the folder, not there, or the user keeps the file that is open.
// Files are absolute paths on the wire. The hosts are the VS Code extension and `linework serve` (which
// passes calls on to the browser editor). Each host listens on 127.0.0.1 and takes a call as
//   POST /live   Authorization: Bearer <token>   body: LiveCall   → the answer as JSON
// and says where it is in a small discovery file (see @linework/mcp's discovery.ts), so an MCP
// server started anywhere in the same folder finds it. Plain JSON both ways, nothing else.
import { checkOperations, type Operation } from './edit.ts';

export const LIVE_PROTOCOL = 1;

export type LiveHostKind = 'vscode' | 'browser';

export interface LiveSelection {
  kind: 'node' | 'group' | 'edge';
  id: string;
}

export interface LiveContext {
  host: LiveHostKind;
  /** The diagram open in the editor (absolute path); none for a diagram that is not a file yet. */
  file?: string;
  selection: LiveSelection[];
  view?: string;
  layers?: string[];
  step?: number;
  /** The problems the editor shows now. */
  problems: { severity: 'error' | 'warning'; message: string; line?: number }[];
  /** Unsaved changes in the editor: what is on disk is older than what the user sees. */
  dirty?: boolean;
}

export interface Proposal {
  file: string;
  edits: Operation[];
  /** One sentence: what the change does, for the user deciding on it. */
  summary?: string;
}

export interface ProposalResult {
  /** `not-open`: the host cannot open the file (outside its folder, missing); a file it can open, it opens first. */
  outcome: 'accepted' | 'rejected' | 'not-open' | 'failed';
  /** Why, in words for the agent: the file that is open instead, what did not apply. */
  message?: string;
}

export type LiveCall = { method: 'context' } | { method: 'propose'; params: Proposal };

/** What an editor does with the calls. */
export interface LiveHost {
  context(): Promise<LiveContext | undefined> | LiveContext | undefined;
  propose(p: Proposal): Promise<ProposalResult>;
}

/** A call as it came in (JSON from a socket), checked: the call, or why it is not one. */
export function checkLiveCall(v: unknown): LiveCall | { error: string } {
  const o = v as { method?: unknown; params?: { file?: unknown; edits?: unknown; summary?: unknown } } | null;
  if (!o || typeof o !== 'object') return { error: 'Not a call' };
  if (o.method === 'context') return { method: 'context' };
  if (o.method !== 'propose') return { error: `Unknown method ${JSON.stringify(o.method)}` };
  const p = o.params;
  if (!p || typeof p.file !== 'string' || !p.file) return { error: 'propose needs params.file' };
  const edits = checkOperations(p.edits);
  if ('error' in edits) return edits;
  return { method: 'propose', params: { file: p.file, edits, ...(typeof p.summary === 'string' && p.summary.trim() ? { summary: p.summary.trim() } : {}) } };
}

/** Runs a checked call on a host: what goes back over the wire. */
export async function answerLive(host: LiveHost, call: unknown): Promise<{ result: unknown } | { error: string }> {
  const c = checkLiveCall(call);
  if ('error' in c) return c;
  try {
    return { result: c.method === 'context' ? ((await host.context()) ?? null) : await host.propose(c.params) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// The browser editor of `linework serve` is reached over Server-Sent Events (calls and file changes in)
// and POST /api/reply (answers out). Paths there are relative to the folder served.

export type ToEditor = { type: 'call'; id: number; call: LiveCall } | { type: 'changed'; path: string };

export interface FromEditor {
  id: number;
  result?: unknown;
  error?: string;
}
