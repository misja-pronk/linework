// "Focused on Orders": what the drawing is cut down to, how far it reaches, and the way back to the whole.
import type { RenderResult } from '@cartography/engine';
import { Icon } from './icon.tsx';

export type Focus = NonNullable<RenderResult['focus']>;

/** The widest a focus set by keys reaches before it is everything connected. */
export const MAX_HOPS = 6;

/** One hop more or fewer; past the widest it is everything connected, and back from there. */
export const hopsBy = (hops: number, by: 1 | -1): number => (hops === Infinity ? (by < 0 ? MAX_HOPS : Infinity) : hops + by > MAX_HOPS ? Infinity : Math.max(0, hops + by));

const NEXT = { both: 'upstream', upstream: 'downstream', downstream: 'both' } as const;
export const nextDirection = (d: Focus['direction']): Focus['direction'] => NEXT[d];

const WAYS = { both: 'Both ways', upstream: 'Upstream', downstream: 'Downstream' };

export interface FocusChipProps {
  /** The focus drawn, if any. */
  focus?: Focus;
  /** The YAML has a focus of its own, and everything is shown instead. */
  off: boolean;
  onHops(by: 1 | -1): void;
  onDirection(): void;
  /** Back: to the whole drawing, or to the focus the YAML has. */
  onLeave(): void;
}

export function FocusChip({ focus, off, onHops, onDirection, onLeave }: FocusChipProps) {
  if (!focus && !off) return null;
  if (!focus)
    return (
      <div className="focus-chip" role="status" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        <Icon name="focus" size={14} />
        <span>Everything shown</span>
        <button className="tool" onClick={onLeave} title="Back to the focus written in the YAML (Esc)">
          Back to the focus <kbd>Esc</kbd>
        </button>
      </div>
    );
  const hops = focus.hops === Infinity ? 'All hops' : `${focus.hops} ${focus.hops === 1 ? 'hop' : 'hops'}`;
  return (
    <div className="focus-chip" role="status" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
      <Icon name="focus" size={14} />
      <span className="focus-chip-name" title={`${focus.kept} of ${focus.total} elements are drawn${focus.written ? '; this focus is written in the YAML' : ''}`}>
        Focused on <strong>{focus.names.join(', ') || focus.on.join(', ')}</strong>
      </span>
      <span className="focus-chip-count">
        {focus.kept} of {focus.total}
      </span>
      <button className="tool" onClick={() => onHops(-1)} disabled={focus.hops === 0} title="One hop fewer (−)" aria-label="One hop fewer">
        <Icon name="minus" size={14} />
      </button>
      <span className="focus-chip-hops" aria-live="polite">
        {hops}
      </span>
      <button className="tool" onClick={() => onHops(1)} disabled={focus.hops === Infinity} title="One hop more (+)" aria-label="One hop more">
        <Icon name="plus" size={14} />
      </button>
      <button className="tool" onClick={onDirection} title="Both ways, upstream (what feeds it) or downstream (what it feeds): D">
        <Icon name="arrow-left-right" size={14} /> {WAYS[focus.direction]} <kbd>D</kbd>
      </button>
      <button className="tool" onClick={onLeave} title={focus.written ? 'Show everything (Esc)' : 'Leave the focus (Esc)'} aria-label={focus.written ? 'Show everything' : 'Leave the focus'}>
        <Icon name="x" size={14} /> <kbd>Esc</kbd>
      </button>
    </div>
  );
}
