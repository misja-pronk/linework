// Align, distribute, lock and the craft toggles (grid, minimap): their keys, palette entries and buttons, kept
// out of app.tsx so the app only wires them to the selection.
import { useCallback, useState } from 'react';
import type { ArrangeOp } from './craft.ts';
import type { Command } from './palette.tsx';
import { Icon } from './icon.tsx';
import { store } from './store.ts';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

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

const keyName = (a: (typeof ARRANGE)[number]) => `${a.shift ? '⇧' : ''}⌥${a.code.slice(3)}`;

/** The arrange op of a key press (⌥ letters go by key code: on a Mac ⌥ turns the letter into another character). */
export function arrangeKey(e: { altKey: boolean; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; code: string }): ArrangeOp | undefined {
  if (!e.altKey || e.metaKey || e.ctrlKey) return undefined;
  return ARRANGE.find((a) => a.code === e.code && !!a.shift === e.shiftKey)?.op;
}

/** ⇧⌘L locks, ⇧G snaps to the grid, ⇧M shows the minimap. */
export function craftKey(e: { altKey: boolean; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; code: string }): 'lock' | 'grid' | 'minimap' | undefined {
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!e.shiftKey || e.altKey) return undefined;
  if (mod && e.code === 'KeyL') return 'lock';
  if (mod || e.metaKey || e.ctrlKey) return undefined;
  return e.code === 'KeyG' ? 'grid' : e.code === 'KeyM' ? 'minimap' : undefined;
}

export function arrangeCommands(run: (op: ArrangeOp) => void): Command[] {
  return ARRANGE.map((a) => ({ id: `arrange:${a.op}`, group: 'Arrange', label: a.label, hint: 'selected shapes', icon: a.icon, shortcut: keyName(a), run: () => run(a.op) }));
}

/** Snapping to the grid and the minimap, kept per browser. */
export function useCraftPrefs() {
  const [grid, setGrid] = useState(() => store.get<boolean>('grid') ?? false);
  const [minimap, setMinimap] = useState(() => store.get<boolean>('minimap') ?? true);
  const toggle = useCallback((what: 'grid' | 'minimap') => {
    const [set, key] = what === 'grid' ? [setGrid, 'grid'] : [setMinimap, 'minimap'];
    set((v) => {
      store.set(key, !v);
      return !v;
    });
  }, []);
  return { grid, minimap, toggle };
}

/** The align and distribute buttons of the multi-selection panel. */
export function ArrangeBar({ shapes, onArrange }: { shapes: number; onArrange(op: ArrangeOp): void }) {
  return (
    <div className="field">
      <span>Arrange</span>
      <div className="arrange-bar" role="toolbar" aria-label="Align and distribute">
        {ARRANGE.map((a) => (
          <button
            key={a.op}
            type="button"
            className="icon-button"
            onClick={() => onArrange(a.op)}
            disabled={shapes < (a.op.startsWith('distribute') ? 3 : 2)}
            title={`${a.label} (${keyName(a)})`}
            aria-label={a.label}
          >
            <Icon name={a.icon} />
          </button>
        ))}
      </div>
    </div>
  );
}
