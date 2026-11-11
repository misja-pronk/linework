// The status bar: problems, what is drawn, pins and the selection, the keys, the theme.
import './status-bar.css';
import type { GraphNode } from '@cartography/core';
import { t } from '../i18n/index.ts';
import { Icon } from '../icon.tsx';
import type { Selection } from '../preview.tsx';
import { drawnCount } from './names.ts';

interface Props {
  errors: number;
  warnings: number;
  ms: number | undefined;
  graph: { nodes: GraphNode[]; edges: unknown[] } | undefined;
  pinCount: number;
  selection: Selection[];
  selected: Selection | undefined;
  theme: 'light' | 'dark';
  onProblems(): void;
  onShortcuts(): void;
}

export function StatusBar({ errors, warnings, ms, graph, pinCount, selection, selected, theme, onProblems, onShortcuts }: Props) {
  return (
    <footer className="statusbar">
      <button className={`status-problems${errors ? ' has-errors' : warnings ? ' has-warnings' : ''}`} onClick={onProblems} title={ms !== undefined ? `Drawn in ${ms} ms` : undefined}>
        <Icon name={errors || warnings ? 'circle-exclamation-point' : 'check'} size={14} />
        {errors || warnings ? `${t('{count} error|{count} errors', { count: errors })}${warnings ? `, ${t('{count} warning|{count} warnings', { count: warnings })}` : ''}` : t('No problems')}
      </button>
      {graph && <span>{drawnCount(graph)}</span>}
      {pinCount > 0 && (
        <span className="status-selected">
          <Icon name="pin" size={13} /> {t('{count} pinned', { count: pinCount })}
        </span>
      )}
      {selection.length > 0 && (
        <span className="status-selected">
          <Icon name="mouse-pointer-2" size={13} /> {selected ? selected.id : t('{count} selected', { count: selection.length })}
        </span>
      )}
      <span className="spacer" />
      <button className="status-link" onClick={onShortcuts} title={t('Keyboard shortcuts')}>
        <Icon name="keyboard" size={13} /> ?
      </button>
      <span>{theme === 'dark' ? t('Dark') : t('Light')}</span>
    </footer>
  );
}
