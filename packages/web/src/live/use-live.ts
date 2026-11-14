// The editor's side of the live link (core's live.ts) when it was opened by linework serve: it answers
// get_context from what is on screen, and turns propose into a proposal the user accepts or rejects
// (for another file of the folder, that file is opened first).
// A proposal is applied to the text as it is now, so a hand edit elsewhere in the file still fits.
import { useEffect, useRef, useState } from 'react';
import { answerLive, applyOperations, type DiagramType, type LiveContext, type LiveHost, type LiveSelection, type Operation, type Proposal, type ProposalResult } from '@linework/core';
import { listen, served, type Channel } from './serve.ts';

export interface LiveState {
  /** The open diagram's path in the folder; none for one that is not a file of it. */
  path?: string;
  text: string;
  type?: DiagramType;
  selection: LiveSelection[];
  view?: string;
  layers?: string[];
  step?: number;
  problems: LiveContext['problems'];
  dirty: boolean;
}

export interface OpenProposal {
  summary?: string;
  edits: Operation[];
  /** The text it was made on, and the change as it applies to it. */
  base: string;
  yaml: string;
  renames: Map<string, string>;
  /** Which document it is for (the app's docKey), so another file closes it. */
  doc: number;
  settle(r: ProposalResult): void;
}

export interface Live {
  /** Opened by linework serve. */
  served: boolean;
  connected: boolean;
  proposal?: OpenProposal;
  /** Settles the open proposal: accepted or rejected, with a word for the agent. */
  settle(r: ProposalResult): void;
}

/**
 * `state` is read when a call comes in; `onChanged` hears of files changed on disk; `onPropose`
 * brings the panel up; `onOpen` opens another file of the folder for a proposal (false when it cannot).
 */
export function useLive(state: () => LiveState, docKey: number, on: { changed(path: string): void; propose(): void; open(path: string): Promise<boolean> }): Live {
  const [connected, setConnected] = useState(false);
  const [proposal, setProposal] = useState<OpenProposal>();
  const current = useRef(proposal);
  current.current = proposal;
  const doc = useRef(docKey);
  doc.current = docKey;
  const read = useRef(state);
  read.current = state;
  const handlers = useRef(on);
  handlers.current = on;
  const s = useState(served)[0];

  const settle = (r: ProposalResult) => {
    current.current?.settle(r);
    current.current = undefined;
    setProposal(undefined);
  };

  // Another document closes the proposal: it was made for the file that was open.
  useEffect(() => {
    if (current.current && current.current.doc !== docKey) settle({ outcome: 'rejected', message: 'The user opened another file before deciding.' });
  }, [docKey]);

  useEffect(() => {
    if (!s) return;
    const host: LiveHost = {
      context: () => {
        const st = read.current();
        return {
          host: 'browser',
          ...(st.path ? { file: st.path } : {}),
          selection: st.selection,
          ...(st.view ? { view: st.view } : {}),
          ...(st.layers?.length ? { layers: st.layers } : {}),
          ...(st.step ? { step: st.step } : {}),
          problems: st.problems,
          dirty: st.dirty,
        };
      },
      propose: (p: Proposal) => new Promise<ProposalResult>((done) => show(p, done)),
    };
    const show = (p: Proposal, done: (r: ProposalResult) => void) => {
      const st = read.current();
      if (p.file !== st.path) return void openThen(p, done);
      if (!st.type) return done({ outcome: 'failed', message: 'The open diagram cannot be drawn now; fix its problems first.' });
      const r = applyOperations(st.text, st.type, p.edits);
      if ('error' in r) return done({ outcome: 'failed', message: `On the text as it is in the editor now: ${r.error}` });
      if (r.text === st.text) return done({ outcome: 'failed', message: 'The editor already has this.' });
      // A newer proposal replaces the one that is open.
      current.current?.settle({ outcome: 'rejected', message: 'Replaced by a newer proposal.' });
      const next: OpenProposal = { summary: p.summary, edits: p.edits, base: st.text, yaml: r.text, renames: r.renames, doc: doc.current, settle: done };
      current.current = next;
      setProposal(next);
      handlers.current.propose();
    };
    /** Another file of the folder: opened in the editor first, and the proposal made on it once it is drawn. */
    const openThen = async (p: Proposal, done: (r: ProposalResult) => void) => {
      const was = read.current().path;
      if (!(await handlers.current.open(p.file))) {
        return done({ outcome: 'not-open', message: `The editor could not open ${p.file}: it is not a file of the folder${was ? `, or the user kept ${was} open` : ''}.` });
      }
      // Its type comes with its first drawing; until then the state still has the last file's.
      const drawn = (st: LiveState) => st.path === p.file && !!st.type && st.type.id === /^type:\s*["']?([\w-]+)/m.exec(st.text)?.[1];
      for (const end = Date.now() + 15_000; !drawn(read.current()); ) {
        if (Date.now() > end) return done({ outcome: 'failed', message: `Opened ${p.file}, but it could not be drawn to show the change; fix its problems first.` });
        await new Promise((r) => setTimeout(r, 50));
      }
      show(p, done);
    };
    let ch: Channel | undefined = undefined;
    ch = listen(
      s,
      (m) => {
        if (m.type === 'changed') return handlers.current.changed(m.path);
        void answerLive(host, m.call).then((out) => ch?.reply({ id: m.id, ...out }));
      },
      setConnected,
    );
    return () => ch?.close();
  }, [s]);

  return { served: !!s, connected, proposal, settle };
}
