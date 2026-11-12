// Align, distribute, lock and the craft toggles (grid, minimap): their keys, palette entries and buttons, kept
// out of app.tsx so the app only wires them to the selection.
import './craft-actions.css';
import { useCallback, useState } from 'react';
import type { ArrangeOp } from './craft.ts';
import type { Command } from './palette.tsx';
import { Icon } from './icon.tsx';
import { store } from './store.ts';
import { keyHint } from './keys.ts';
import { t, say } from './i18n/index.ts';


/** The six aligns and two distributes, with Figma's keys (⌥ and a letter, ⇧⌥ to distribute). */
export const ARRANGE: { op: ArrangeOp; label: string; icon: string; code: string; shift?: boolean }[] = [
  { op: 'left', label: 'Align left', icon: 'align-start-vertical', code: 'KeyA' },
  { op: 'centre', label: 'Align centre', icon: 'align-center-vertical', code: 'KeyH' },
  { op: 'right', label: 'Align right', icon: 'align-end-vertical', code: 'KeyD' },
  { op: 'top', label: 'Align top', icon: 'align-start-horizontal', code: 'KeyW' },
  { op: 'middle', label: 'Align middle', icon: 'align-center-horizontal', code: 'KeyV' },
  { op: 'bottom', label: 'Align bottom', icon: 'align-end-horizontal', code: 'KeyS' },
  { op: 'distribute-x', label: 'Distribute horizontally', icon: 'align-horizontal-distribute-center', code: 'KeyH', shift: true },
  { op: 'distribute-y', label: 'Distribute vertically', icon: 'align-vertical-distribute-center', code: 'KeyV', shift: true },
];

const keyName = (a: (typeof ARRANGE)[number]) => keyHint(a.op.startsWith('distribute') ? a.op : `align-${a.op}`);

/** The arrange op of a key press (⌥ letters go by key code: on a Mac ⌥ turns the letter into another character). */
export function arrangeKey(e: { altKey: boolean; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; code: string }): ArrangeOp | undefined {
  if (!e.altKey || e.metaKey || e.ctrlKey) return undefined;
  return ARRANGE.find((a) => a.code === e.code && !!a.shift === e.shiftKey)?.op;
}

export function arrangeCommands(run: (op: ArrangeOp) => void): Command[] {
  return ARRANGE.map((a) => ({ id: `arrange:${a.op}`, group: t('Arrange'), label: say(a.label), hint: t('selected shapes'), icon: a.icon, shortcut: keyName(a), run: () => run(a.op) }));
}

/** Snapping to the grid, the minimap and the page frame, kept per browser. The page frame is off until
 * asked for (⇧P, the canvas tools, the command): on the sheet it read as noise. */
export function useCraftPrefs() {
  const [grid, setGrid] = useState(() => store.get<boolean>('grid') ?? false);
  const [minimap, setMinimap] = useState(() => store.get<boolean>('minimap') ?? true);
  const [page, setPage] = useState(() => store.get<boolean>('page') ?? false);
  const toggle = useCallback((what: 'grid' | 'minimap' | 'page') => {
    const set = what === 'grid' ? setGrid : what === 'minimap' ? setMinimap : setPage;
    set((v) => {
      store.set(what, !v);
      return !v;
    });
  }, []);
  return { grid, minimap, page, toggle };
}

/** The align and distribute buttons of the multi-selection panel. */
export function ArrangeBar({ shapes, onArrange }: { shapes: number; onArrange(op: ArrangeOp): void }) {
  return (
    <div className="field">
      <span>{t('Arrange')}</span>
      <div className="arrange-bar" role="toolbar" aria-label={t('Align and distribute')}>
        {ARRANGE.map((a) => (
          <button
            key={a.op}
            type="button"
            className="icon-button"
            onClick={() => onArrange(a.op)}
            disabled={shapes < (a.op.startsWith('distribute') ? 3 : 2)}
            title={`${say(a.label)} (${keyName(a)})`}
            aria-label={say(a.label)}
          >
            <Icon name={a.icon} />
          </button>
        ))}
      </div>
    </div>
  );
}
