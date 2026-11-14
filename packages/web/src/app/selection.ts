// What is selected: in the drawing, in the YAML (the entry under the cursor) and in the inspector, the
// same thing. One element is "the" selection (inspector, Tab, connect); more is a group action.
import { useCallback, useState } from 'react';
import type { Path } from '@linework/core';
import type { Selection } from '../preview.tsx';
import { entryAt } from '../ranges.ts';
import type { EditorHandle } from '../editor.tsx';
import type { Drawing } from './drawing.ts';

export function useSelection() {
  /** Everything selected. One element is "the" selection (inspector, Tab, connect); more is a group action. */
  const [selection, setSelection] = useState<Selection[]>([]);
  const selected = selection.length === 1 ? selection[0] : undefined;
  const setSelected = useCallback(
    (s: Selection | undefined | ((s: Selection | undefined) => Selection | undefined)) =>
      setSelection((prev) => {
        const one = prev.length === 1 ? prev[0] : undefined;
        const next = typeof s === 'function' ? s(one) : s;
        return next === one && prev.length <= 1 ? prev : next ? [next] : [];
      }),
    [],
  );
  return { selection, setSelection, selected, setSelected };
}
export type SelectionState = ReturnType<typeof useSelection>;

interface Props {
  state: SelectionState;
  drawing: Drawing;
  editor: React.RefObject<EditorHandle | null>;
  /** Selecting shows the properties. */
  showInspector(): void;
}

/** Selecting from the drawing, the YAML and the keys, and the YAML path of what is selected. */
export function useSelect({ state, drawing, editor, showInspector }: Props) {
  const { selection, setSelection, setSelected } = state;
  const { result, drawn, entries, current } = drawing;
  const pathOf = useCallback(
    (s: Selection | undefined): Path | undefined => {
      const g = result?.graph ?? drawn?.graph;
      if (!s || !g) return undefined;
      return (s.kind === 'node' ? g.nodes.find((n) => n.id === s.id) : s.kind === 'group' ? g.groups.find((x) => x.id === s.id) : g.edges.find((e) => e.id === s.id))?.path;
    },
    [result?.graph, drawn?.graph],
  );
  const select = (s: Selection | undefined, reveal = true) => {
    setSelected(s);
    if (s) showInspector();
    const e = s && current && entries.find((x) => x.kind === s.kind && x.id === s.id);
    if (e && reveal) editor.current?.reveal(e.from, e.to);
  };
  /** Shift-click: in or out of the selection. */
  const toggle = (s: Selection) => {
    showInspector();
    setSelection((prev) => (prev.some((x) => x.kind === s.kind && x.id === s.id) ? prev.filter((x) => x.kind !== s.kind || x.id !== s.id) : [...prev, s]));
  };
  const selectMany = (list: Selection[], add: boolean) => {
    showInspector();
    setSelection((prev) => (add ? [...prev, ...list.filter((s) => !prev.some((x) => x.kind === s.kind && x.id === s.id))] : list));
  };
  const onCursor = (pos: number) => {
    if (!current) return;
    // A selection made in the drawing stays when a builder edit moves the cursor; typing takes over.
    if (selection.length > 1 && !document.activeElement?.closest('.cm-editor')) return;
    const e = entryAt(entries, pos);
    setSelected((s) => (e ? (s?.kind === e.kind && s.id === e.id ? s : { kind: e.kind, id: e.id }) : undefined));
  };
  return { pathOf, select, toggle, selectMany, onCursor };
}
export type Select = ReturnType<typeof useSelect>;
