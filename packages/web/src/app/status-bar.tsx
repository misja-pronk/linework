// The status bar, drawn as a map's title block: the sheet, its type and what is on it, problems, pins,
// where a dragged element is while it moves, the selection, the keys, and light or dark to switch.
import './status-bar.css';
import type { GraphNode } from '@cartography/core';
import { t } from '../i18n/index.ts';
import { Icon } from '../icon.tsx';
import type { Selection } from '../preview.tsx';
import { useReadout } from '../readout.ts';
import { drawnFields } from './names.ts';

interface Props {
  errors: number;
  warnings: number;
  ms: number | undefined;
  graph: { title?: string; nodes: GraphNode[]; edges: unknown[]; groups: unknown[] } | undefined;
  pinCount: number;
  selection: Selection[];
  selected: Selection | undefined;
  theme: 'light' | 'dark';
  /** Light or dark, switched from the bar. */
  onTheme(): void;
  onProblems(): void;
  onShortcuts(): void;
}

/** One cell of the title block: a small-capital name and its value, both text (the capitals are the
 * font's small capitals, so the name reads and copies as written). */
function Cell({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <span className={className ? `status-cell ${className}` : 'status-cell'}>
      <span className="status-label">{label}</span> {children}
    </span>
  );
}

export function StatusBar({ errors, warnings, ms, graph, pinCount, selection, selected, theme, onTheme, onProblems, onShortcuts }: Props) {
  const readout = useReadout();
  return (
    <footer className="statusbar">
      {graph?.title && (
        <Cell label={t('Sheet')} className="status-sheet">
          {graph.title}
        </Cell>
      )}
      {graph &&
        drawnFields(graph).map(([label, n]) => (
          <Cell key={label} label={label} className="status-count">
            {n}
          </Cell>
        ))}
      <button className={`status-problems${errors ? ' has-errors' : warnings ? ' has-warnings' : ''}`} onClick={onProblems} title={ms !== undefined ? t('Drawn in {ms} ms', { ms }) : undefined}>
        <Icon name={errors || warnings ? 'circle-exclamation-point' : 'check'} size={14} />
        {errors || warnings ? `${t('{count} error|{count} errors', { count: errors })}${warnings ? `, ${t('{count} warning|{count} warnings', { count: warnings })}` : ''}` : t('No problems')}
      </button>
      {pinCount > 0 && (
        <span className="status-selected">
          <Icon name="pin" size={13} /> {t('{count} pinned', { count: pinCount })}
        </span>
      )}
      <span className="spacer" />
      {/* While something is dragged: where it stands and how big it is, in drawing pixels. */}
      {readout && (
        <span className="status-readout" aria-hidden="true">
          <Cell label="X">{readout.x}</Cell>
          <Cell label="Y">{readout.y}</Cell>
          <Cell label={t('Size')}>
            {readout.width} × {readout.height}
          </Cell>
        </span>
      )}
      {selection.length > 0 && (
        <span className="status-selected">
          <Icon name="mouse-pointer-2" size={13} /> {selected ? selected.id : t('{count} selected', { count: selection.length })}
        </span>
      )}
      <button className="status-link" onClick={onShortcuts} title={t('Keyboard shortcuts')}>
        <Icon name="keyboard" size={13} /> ?
      </button>
      <button className="status-link status-theme" onClick={onTheme} title={theme === 'dark' ? t('Light theme') : t('Dark theme')} aria-label={theme === 'dark' ? t('Light theme') : t('Dark theme')}>
        <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={13} /> {theme === 'dark' ? t('Dark') : t('Light')}
      </button>
    </footer>
  );
}
