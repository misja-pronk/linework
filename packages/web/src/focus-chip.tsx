// "Focused on Orders": what the drawing is cut down to, how far it reaches, and the way back to the whole.
import './focus-chip.css';
import type { RenderResult } from '@linework/engine';
import { Icon } from './icon.tsx';
import { t, say } from './i18n/index.ts';

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
        <span>{t('Everything shown')}</span>
        <button className="tool" onClick={onLeave} title={t('Back to the focus written in the YAML (Esc)')}>
          {t('Back to the focus')} <kbd>Esc</kbd>
        </button>
      </div>
    );
  const hops = focus.hops === Infinity ? t('All hops') : t('{count} hop|{count} hops', { count: focus.hops });
  return (
    <div className="focus-chip" role="status" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
      <Icon name="focus" size={14} />
      <span className="focus-chip-name" title={focus.written ? t('{kept} of {total} elements are drawn; this focus is written in the YAML', { kept: focus.kept, total: focus.total }) : t('{kept} of {total} elements are drawn', { kept: focus.kept, total: focus.total })}>
        {t('Focused on')} <strong>{focus.names.join(', ') || focus.on.join(', ')}</strong>
      </span>
      <span className="focus-chip-count">
        {t('{kept} of {total} shown', { kept: focus.kept, total: focus.total })}
      </span>
      <button className="tool" onClick={() => onHops(-1)} disabled={focus.hops === 0} title={t('One hop fewer (−)')} aria-label={t('One hop fewer')}>
        <Icon name="minus" size={14} />
      </button>
      <span className="focus-chip-hops" aria-live="polite">
        {hops}
      </span>
      <button className="tool" onClick={() => onHops(1)} disabled={focus.hops === Infinity} title={t('One hop more (+)')} aria-label={t('One hop more')}>
        <Icon name="plus" size={14} />
      </button>
      <button className="tool" onClick={onDirection} title={t('Both ways, upstream (what feeds it) or downstream (what it feeds): D')}>
        <Icon name="arrow-left-right" size={14} /> {say(WAYS[focus.direction])} <kbd>D</kbd>
      </button>
      <button className="tool" onClick={onLeave} title={focus.written ? t('Show everything (Esc)') : t('Leave the focus (Esc)')} aria-label={focus.written ? t('Show everything') : t('Leave the focus')}>
        <Icon name="x" size={14} /> <kbd>Esc</kbd>
      </button>
    </div>
  );
}
