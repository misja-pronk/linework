// Back and forward through the drawings looked at (⌘[ and ⌘]), as in a browser: every file or view
// opened is a step, whichever way it was opened (a click in the file list, a drill-down, a search).
import { useCallback, useEffect, useRef, useState } from 'react';
import { samePlace, type Place } from './use-workspace.ts';

const LIMIT = 100;

/** `ready`: the drawing on screen is of the place (right after opening a file it is still the last one). */
export function useHistory(here: Place | undefined, go: (p: Place) => void, ready = true) {
  const [state, setState] = useState<{ list: Place[]; at: number }>({ list: [], at: -1 });
  /** Set while going back or forward: arriving there is no new step. */
  const travelling = useRef<Place>(undefined);

  useEffect(() => {
    if (!here || !ready) return;
    if (travelling.current) {
      if (samePlace(travelling.current, here)) travelling.current = undefined;
      return;
    }
    setState((s) => {
      if (samePlace(s.list[s.at], here)) return s;
      const list = [...s.list.slice(0, s.at + 1), here].slice(-LIMIT);
      return { list, at: list.length - 1 };
    });
  }, [here?.file, here?.view, ready]);

  /** The selection goes with the step it was made in, so going back selects it again. */
  useEffect(() => {
    if (!here?.node) return;
    setState((s) => (samePlace(s.list[s.at], here) && s.list[s.at]!.node !== here.node ? { ...s, list: s.list.map((p, i) => (i === s.at ? { ...p, node: here.node } : p)) } : s));
  }, [here?.node]);

  const move = useCallback(
    (by: -1 | 1) => {
      const to = state.list[state.at + by];
      if (!to) return false;
      travelling.current = to;
      setState((s) => ({ ...s, at: s.at + by }));
      go(to);
      return true;
    },
    [state, go],
  );

  return {
    back: () => move(-1),
    forward: () => move(1),
    canBack: state.at > 0,
    canForward: state.at < state.list.length - 1,
    previous: state.list[state.at - 1],
    next: state.list[state.at + 1],
  };
}
