// Where the thing being dragged is, while it is dragged: the drawing (preview.tsx) writes it, the status
// bar's title block shows it. A tiny store of its own, so a drag does not re-render the whole editor.
import { useSyncExternalStore } from 'react';

export interface Readout {
  x: number;
  y: number;
  width: number;
  height: number;
}

let value: Readout | undefined;
const listeners = new Set<() => void>();

export function setReadout(next: Readout | undefined) {
  if (next === value || (next && value && next.x === value.x && next.y === value.y && next.width === value.width && next.height === value.height)) return;
  value = next;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const useReadout = () => useSyncExternalStore(subscribe, () => value);
