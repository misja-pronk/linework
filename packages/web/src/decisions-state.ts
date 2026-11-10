// The architecture decisions of the editor: in an open folder, the Markdown files of its decisions
// folder (read with the folder, written back to it at once, as a rename writes the other files);
// without a folder, kept in this browser, with a download. Decisions are files of their own, not the
// diagram's text: they are not in its undo history. What a decision is: core decisions.ts.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_DECISIONS_DIR,
  decisionByNumber,
  decisionFileName,
  decisionTemplate,
  nextDecisionNumber,
  readDecisions,
  setDecisionConcerns,
  setDecisionStatus,
  type Decision,
  type DecisionStatus,
  type WorkspaceIndex,
} from '@cartography/core';
import { writeInFolder, type Workspace } from './files.ts';
import { store } from './store.ts';

export interface Decisions {
  list: Decision[];
  /** The folder they are in, relative to the open folder (decisions/ unless .adr-dir or log4brains says). */
  dir: string;
  /** Written to the folder; else kept in this browser. */
  inFolder: boolean;
  get(n: number): Decision | undefined;
  /** Writes a decision's text as it is given. */
  save(file: string, text: string): Promise<void>;
  /** A new decision from the template: the next number, about these concerns. Returns its number. */
  create(title: string, concerns: string[], supersedes?: number): Promise<number>;
  setStatus(n: number, status: DecisionStatus): Promise<void>;
  link(n: number, concern: string): Promise<void>;
  unlink(n: number, concern: string): Promise<void>;
  /** The decisions kept in this browser, to put in a folder by hand. */
  download(n: number): void;
}

const KEY = 'decisions';

export function useDecisions(ws: Workspace | undefined, index: WorkspaceIndex, h: { refresh(ws: Workspace): void; notify(message: string, o?: { tone?: 'error' }): void }): Decisions {
  // Without a folder: [path, text] pairs in this browser.
  const [kept, setKept] = useState<[string, string][]>(() => store.get<[string, string][]>(KEY) ?? []);
  useEffect(() => store.set(KEY, kept), [kept]);
  const local = useMemo(() => readDecisions(kept, DEFAULT_DECISIONS_DIR), [kept]);
  const list = ws ? index.decisions : local;
  const dir = ws ? index.decisionsDir : DEFAULT_DECISIONS_DIR;

  const save = useCallback(
    async (file: string, text: string) => {
      if (ws) {
        try {
          await writeInFolder(ws, file, text);
        } catch (e) {
          h.notify(`Could not write ${file}: ${e instanceof Error ? e.message : String(e)}`, { tone: 'error' });
          return;
        }
        h.refresh(ws);
      } else setKept((k) => [...k.filter(([p]) => p !== file), [file, text]]);
    },
    [ws, h],
  );

  return useMemo<Decisions>(() => {
    const get = (n: number) => decisionByNumber(list, n);
    const change = async (n: number, f: (d: Decision) => string) => {
      const d = get(n);
      if (d) await save(d.file, f(d));
    };
    return {
      list,
      dir,
      inFolder: !!ws,
      get,
      save,
      async create(title, concerns, supersedes) {
        const number = nextDecisionNumber(list);
        const file = `${dir}/${decisionFileName(number, title)}`;
        const old = supersedes ? get(supersedes) : undefined;
        await save(file, decisionTemplate({ number, title, concerns, file, ...(old ? { supersedes: old } : {}) }));
        // The old one is marked superseded by the new one, in its own style.
        if (old) await save(old.file, setDecisionStatus(old.text, old.file, 'superseded', { number, title, file }));
        return number;
      },
      setStatus: (n, status) => change(n, (d) => setDecisionStatus(d.text, d.file, status)),
      link: (n, concern) => change(n, (d) => (d.concerns.includes(concern) ? d.text : setDecisionConcerns(d.text, [...d.concerns, concern]))),
      unlink: (n, concern) => change(n, (d) => setDecisionConcerns(d.text, d.concerns.filter((c) => c !== concern))),
      download(n) {
        const d = get(n);
        if (!d) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([d.text], { type: 'text/markdown' }));
        a.download = d.file.split('/').pop()!;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      },
    };
  }, [list, dir, ws, save]);
}
