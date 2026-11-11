// The editor's side of the live link (core's live.ts) when it was opened by carto serve: it answers
// get_context from what is on screen, and turns propose into a proposal the user accepts or rejects.
// A proposal is applied to the text as it is now, so a hand edit elsewhere in the file still fits.
import { useEffect, useRef, useState } from 'react';
import { answerLive, applyOperations, type DiagramType, type LiveContext, type LiveHost, type LiveSelection, type Operation, type Proposal, type ProposalResult } from '@cartography/core';
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
  /** Opened by carto serve. */
  served: boolean;
  connected: boolean;
  proposal?: OpenProposal;
  /** Settles the open proposal: accepted or rejected, with a word for the agent. */
  settle(r: ProposalResult): void;
}

/**
 * `state` is read when a call comes in; `onChanged` hears of files changed on disk; `onPropose`
 * brings the panel up.
 */
export function useLive(state: () => LiveState, docKey: number, on: { changed(path: string): void; propose(): void }): Live {
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
      propose: (p: Proposal) =>
        new Promise<ProposalResult>((done) => {
          const st = read.current();
          if (p.file !== st.path) return done({ outcome: 'not-open', message: st.path ? `The editor has ${st.path} open, not ${p.file}.` : `The editor has no file of the folder open, not ${p.file}.` });
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
        }),
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
