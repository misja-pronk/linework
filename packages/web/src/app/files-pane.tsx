// The diagrams of the open folder: a list beside the YAML, or folded to a rail (and opened over the
// drawing when there is no room beside it).
import './files-pane.css';
import { useState } from 'react';
import { t } from '../i18n/index.ts';
import { Icon } from '../icon.tsx';
import { diagrams, type Workspace } from '../files.ts';
import type { Panes } from '../pane-layout.ts';

interface Props {
  ws: Workspace | undefined;
  mode: Panes['filesMode'];
  /** Whether the list would fit beside the YAML if it were unfolded. */
  listFits(): boolean;
  setFilesPref(v: 'list' | 'rail'): void;
  openPath?: string;
  dirty: boolean;
  open(path: string): void;
}

export function FilesPane({ ws, mode, listFits, setFilesPref, openPath, dirty, open }: Props) {
  /** The file list over the drawing, opened from its rail when there is no room for it beside. */
  const [filesOver, setFilesOver] = useState(false);
  if (!ws) return null;
  return (
    <>
      {mode === 'rail' && (
        <nav className="rail files-rail" aria-label={t('Diagrams in {folder}', { folder: ws.name })}>
          <button
            className="rail-button"
            onClick={() => (listFits() ? setFilesPref('list') : setFilesOver((o) => !o))}
            aria-expanded={filesOver}
            title={t('The diagrams in {folder}', { folder: ws.name })}
            aria-label={t('Files: {count} diagrams in {folder}', { count: diagrams(ws).length, folder: ws.name })}
          >
            <Icon name="file-code" size={16} />
            <span className="rail-label">Files · {diagrams(ws).length}</span>
          </button>
        </nav>
      )}
      {(mode === 'list' || filesOver) && (
        <nav className={mode === 'list' ? 'files' : 'files over'} aria-label={t('Diagrams in {folder}', { folder: ws.name })} onKeyDown={(e) => e.key === 'Escape' && filesOver && (setFilesOver(false), e.stopPropagation())}>
          <header>
            <Icon name="folder-open" size={14} /> <span className="files-name">{ws.name}</span>
            <button className="icon-button small" onClick={() => (filesOver ? setFilesOver(false) : setFilesPref('rail'))} title={filesOver ? t('Close the file list') : t('Fold the file list to the side')} aria-label={t('Fold the file list')}>
              <Icon name="panel-left-close" size={14} />
            </button>
          </header>
          {diagrams(ws).map((p) => (
            <button key={p} className={openPath === p ? 'file active' : 'file'} onClick={() => (setFilesOver(false), open(p))} title={p} aria-current={openPath === p}>
              <Icon name="file-code" size={14} />
              <span>{p}</span>
              {openPath === p && dirty && <span className="dirty" />}
            </button>
          ))}
          {diagrams(ws).length === 0 && <p className="files-empty">{t('No diagrams yet. Start from a template, then save.')}</p>}
        </nav>
      )}
    </>
  );
}
