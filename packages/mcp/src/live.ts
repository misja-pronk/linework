// get_context and propose: the agent's side of the live link (core's live.ts). The link is the
// editor's own when the server runs inside linework serve; otherwise the host found through discovery.ts.
import path from 'node:path';
import type { LiveCall, LiveContext, Proposal, ProposalResult } from '@linework/core';
import { render } from '@linework/engine';
import { endpointFor, endpoints, type LiveEndpoint } from './discovery.ts';
import { applyEdits } from './edit.ts';
import { load, problems, reader, resolvePath, type Problem } from './tools.ts';

/** An editor to ask; undefined answers mean no editor is there. */
export interface LiveLink {
  context(): Promise<LiveContext | undefined>;
  propose(p: Proposal): Promise<ProposalResult | undefined>;
}

/** Long enough for a person to look at a change and decide. */
const DECIDE_MS = 10 * 60_000;

async function post(e: LiveEndpoint, call: LiveCall, ms: number): Promise<unknown> {
  const res = await fetch(`${e.url}/live`, { method: 'POST', headers: { authorization: `Bearer ${e.token}`, 'content-type': 'application/json' }, body: JSON.stringify(call), signal: AbortSignal.timeout(ms) });
  const body = (await res.json()) as { result?: unknown; error?: string };
  if (body.error) throw new Error(body.error);
  return body.result;
}

/** The host for a folder: one with a folder around it, else one whose folder is inside it. */
function hostFor(p: string): LiveEndpoint | undefined {
  const all = endpoints();
  return endpointFor(p, all) ?? all.filter((e) => e.roots.some((r) => !path.relative(p, r).startsWith('..'))).sort((a, b) => b.since - a.since)[0];
}

export function discoveredLink(cwd: string): LiveLink {
  return {
    async context() {
      const e = hostFor(cwd);
      return e ? ((await post(e, { method: 'context' }, 10_000)) as LiveContext | null) ?? undefined : undefined;
    },
    async propose(p) {
      const e = endpointFor(p.file) ?? hostFor(cwd);
      if (!e) return undefined;
      try {
        return (await post(e, { method: 'propose', params: p }, DECIDE_MS)) as ProposalResult;
      } catch (err) {
        if ((err as Error).name === 'TimeoutError') return { outcome: 'rejected', message: 'No answer from the user in 10 minutes.' };
        throw err;
      }
    },
  };
}

export type Proposed = (ProposalResult | { outcome: 'no-editor' | 'invalid' }) & { message?: string; problems?: Problem[] };

/** Checks the change the way edit_diagram does before anyone sees it, then asks the editor. */
export async function proposeChange(link: LiveLink, req: { file: string; edits: unknown; summary?: string }, cwd: string): Promise<Proposed> {
  const file = resolvePath(req.file, cwd);
  const src = load({ file }, cwd);
  const applied = applyEdits(src.text, req.edits);
  if ('error' in applied) return { outcome: 'invalid', message: applied.error };
  const r = await render(applied.text, { fonts: 'none', load: reader(src.dir), sidecar: src.sidecar });
  if (!r.svg || r.diagnostics.some((d) => d.severity === 'error')) return { outcome: 'invalid', message: 'The change does not validate; nothing was shown.', problems: problems(r.diagnostics, applied.text, r.type) };
  const out = await link.propose({ file, edits: req.edits as Proposal['edits'], ...(req.summary ? { summary: req.summary } : {}) });
  return out ?? { outcome: 'no-editor', message: 'No editor has the live link open (VS Code with the Linework extension, or linework serve). Use edit_diagram to change the file instead.' };
}
