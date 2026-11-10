// The open folder as one model (see core workspace.ts), kept up to date as files and the open
// document change: a keystroke re-reads only the open file, a save or a scan only what changed.
import { useMemo, useRef } from 'react';
import { Workspace as Index, type WorkspaceIndex } from '@cartography/core';
import type { Workspace } from '../files.ts';

/**
 * The index of the folder, with the open document as it is in the editor (unsaved edits too). Without
 * a folder, the open document on its own: its views can still be searched and walked.
 */
export function useWorkspaceIndex(ws: Workspace | undefined, open: { path?: string; name: string; text: string }): WorkspaceIndex {
  const kept = useRef<Index>(undefined);
  return useMemo(() => {
    const index = (kept.current ??= new Index());
    const files: [string, string][] = ws ? [...ws.files].map(([p, f]) => [p, f.text]) : [];
    const here = ws && open.path ? open.path : open.name;
    const at = files.findIndex(([p]) => p === here);
    if (at >= 0) files[at] = [here, open.text];
    else if (!ws || !open.path) files.push([here, open.text]);
    index.sync(files);
    return index.index;
  }, [ws, open.path, open.name, open.text]);
}

/** Where a workspace position is: a file, a view in it, what is selected there. */
export interface Place {
  file: string;
  view?: string;
  node?: string;
  /** A line to show in the YAML. */
  line?: number;
}

export const samePlace = (a: Place | undefined, b: Place | undefined) => !!a && !!b && a.file === b.file && a.view === b.view;

/** Character offset of a line (1-based) in a text: where the editor jumps to. */
export function lineOffset(text: string, line: number): { from: number; to: number } {
  let from = 0;
  for (let n = 1; n < line && from >= 0; n++) from = text.indexOf('\n', from) + 1 || text.length;
  const end = text.indexOf('\n', from);
  return { from, to: end < 0 ? text.length : end };
}
