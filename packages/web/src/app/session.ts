// Session mode: drawing live on a shared screen with a customer watching. Only the sheet shows, on the
// light theme (it survives video compression; a preference opts out), with one strip of actions. The
// diagram is kept as it was when the session started, so at the end "What changed" can show the delta.
import { useState, useSyncExternalStore } from 'react';
import type { LayoutSidecar } from '@linework/core';
import { store } from '../store.ts';

/** How many sessions show the sketch hint under the selection before it has done its job. */
export const HINT_SESSIONS = 3;

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

/** Sessions draw on the light theme unless this is switched off (in the settings menu). */
export const sessionLight = () => store.get<boolean>('session-light') !== false;
export function setSessionLight(on: boolean) {
  store.set('session-light', on);
  changed();
}
export const useSessionLight = () => useSyncExternalStore(subscribe, sessionLight);

/** The diagram as it was when a session started. */
export interface SessionStart {
  text: string;
  pins?: LayoutSidecar;
  at: number;
}

interface Props {
  textNow(): string;
  pins: LayoutSidecar | undefined;
}

export function useSession({ textNow, pins }: Props) {
  const [start, setStart] = useState<SessionStart>();
  /** The session that just ended, for "What changed". */
  const [ended, setEnded] = useState<SessionStart & { text2: string; pins2?: LayoutSidecar }>();
  const light = useSessionLight();
  /** After the session: its delta shown on the drawing, still with only the sheet on screen. */
  const [review, setReview] = useState(false);
  /** Sessions started so far: the sketch hint shows in the first few. */
  const [count, setCount] = useState(() => store.get<number>('sessions') ?? 0);
  const begin = () => {
    if (start) return;
    setEnded(undefined);
    setReview(false);
    setStart({ text: textNow(), ...(pins ? { pins } : {}), at: Date.now() });
    const n = count + 1;
    setCount(n);
    store.set('sessions', n);
  };
  const end = () => {
    if (!start) return;
    const now = textNow();
    setStart(undefined);
    // Nothing changed: nothing to show.
    if (now !== start.text) setEnded({ ...start, text2: now, ...(pins ? { pins2: pins } : {}) });
  };
  return {
    on: !!start,
    /** What the people watching see is the sheet alone: in a session, and while its end is shown. */
    sheetOnly: !!start || !!ended || review,
    start,
    begin,
    end,
    toggle: () => (start ? end() : begin()),
    ended,
    dismiss: () => setEnded(undefined),
    review,
    setReview,
    light,
    hint: count <= HINT_SESSIONS,
  };
}
export type Session = ReturnType<typeof useSession>;
