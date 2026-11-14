// The top bar: the document and its type, the way of working, Session, Commands, ⋯ (new, folders, the
// theme, light or dark), Export.
import './topbar.css';
import { useState } from 'react';
import type { DiagramType } from '@linework/core';
import { t } from '../i18n/index.ts';
import { Icon } from '../icon.tsx';
import { Menu } from '../menu.tsx';
import { BrandMenu, BrandMenuItem } from '../brand-menu.tsx';
import { BrandMark } from '../brand-mark.tsx';
import { canUseFolders, type Workspace } from '../files.ts';
import type { Doc } from './document.ts';
import { ExportMenu, type ExportMenuProps } from './export-menu.tsx';
import { keyHint } from '../keys.ts';

interface Props {
  ws: Workspace | undefined;
  remembered: FileSystemDirectoryHandle | undefined;
  doc: Doc;
  dirty: boolean;
  type: DiagramType | undefined;
  /** The type's name for what this diagram holds (Unity Catalog access), where it is not the type's own. */
  typeName?: string;
  /** The YAML is open beside the drawing (the YAML tab), or out of sight (the Drawing tab). */
  yamlOpen: boolean;
  showYaml(): void;
  showDrawing(): void;
  theme: 'light' | 'dark';
  toggleTheme(): void;
  openFolder(dir?: FileSystemDirectoryHandle): void;
  /** The type pill's "Which type do I need?": the start dialog, marking this type. */
  onTypeGuide(): void;
  onNew(): void;
  onCommands(): void;
  /** Session mode (⇧S): only the sheet, to draw live with people watching. */
  session: boolean;
  toggleSession(): void;
  notify(message: string, opts?: { tone?: 'error' }): void;
  exportMenu: ExportMenuProps;
  /** The file: save it (⌘S), download its YAML, and its layout when something is pinned. */
  file: { save(): void; download(): void; saveLayout?(): void };
}

export function Topbar(p: Props) {
  const { ws, doc, type, theme } = p;
  const [more, setMore] = useState(false);
  /** The diagram's theme, icons and the editor's language: a menu opened from ⋯, in its place. */
  const [look, setLook] = useState(false);
  /** The type pill's card: what this type is for, and the way to the type guide. */
  const [typeCard, setTypeCard] = useState(false);
  return (
    <header className="topbar">
      <div className="brand">
        <BrandMark />
        Linework
      </div>
      <div className="doc-name">
        <span className="doc-file">{ws && doc.path ? `${ws.name}/${doc.path}` : doc.name}</span>
        {type && (
          <div className="menu-anchor type-anchor">
            <button className="type-pill" onClick={() => setTypeCard((o) => !o)} title={`${t('{name}, written type: {id}', { name: p.typeName ?? type.name, id: type.id })}${type.tagline ? ` · ${type.tagline}` : ''}`} aria-expanded={typeCard} aria-haspopup="menu">
              {p.typeName ?? type.name}
            </button>
            {typeCard && (
              <Menu onClose={() => setTypeCard(false)}>
                <div className="type-card-pop">
                  <strong>
                    <Icon name={type.icon ?? 'layout-template'} size={15} /> {type.name}
                  </strong>
                  <code className="type-yaml" title={t('What the YAML says')}>type: {type.id}</code>
                  {type.tagline && <p>{type.tagline}</p>}
                </div>
                <button role="menuitem" onClick={() => (setTypeCard(false), p.onTypeGuide())}>
                  <Icon name="circle-question-mark" /> {t('Which type do I need?')}
                </button>
                <p className="type-card-fine">{t('Also in docs/types.md and')} <code>linework types</code></p>
              </Menu>
            )}
          </div>
        )}
        {p.dirty && (
          <span className="dirty" title={t('Unsaved changes (⌘S saves)')} aria-label={t('Unsaved changes')}>
            <span aria-hidden="true">{t('edited')}</span>
          </span>
        )}
      </div>
      {/* The two ways to look at a diagram: the drawing alone, or its YAML beside it. */}
      <div className="view-switch" role="radiogroup" aria-label={t('Way of working')}>
        <button role="radio" aria-checked={!p.yamlOpen} className={!p.yamlOpen ? 'active' : ''} onClick={p.showDrawing} title={t('The drawing: the YAML folds away to the side')}>
          {t('Drawing')}
        </button>
        <button role="radio" aria-checked={p.yamlOpen} className={p.yamlOpen ? 'active' : ''} onClick={p.showYaml} title={`${t('YAML and drawing side by side')} (⌘\\\\)`}>
          YAML
        </button>
      </div>
      <div className="actions">
        <button className="button ghost session-toggle" onClick={p.toggleSession} aria-pressed={p.session} title={t('Session: only the sheet, to draw live with people watching ({key})', { key: keyHint('session') })}>
          <Icon name="users" /> <span className="wide-only">{t('Session')}</span>
        </button>
        <button className="icon-button" onClick={p.onCommands} title={t('Commands, elements and templates (⌘K)')} aria-label={t('Commands')}>
          <Icon name="search" />
        </button>
        {/* Everything the top bar does less often: files, the diagram's look, the editor's light or dark. */}
        <div className="menu-anchor">
          <button className="icon-button" onClick={() => (setLook(false), setMore((m) => !m))} aria-expanded={more || look} aria-haspopup="menu" aria-label={t('More actions')} title={t('More: new, open, save, theme, light or dark')}>
            <span className="more-dots" aria-hidden="true">⋯</span>
          </button>
          {more && (
            <Menu onClose={() => setMore(false)}>
              <button role="menuitem" onClick={() => (setMore(false), p.onNew())}>
                <Icon name="file-plus" /> {t('New diagram')}
              </button>
              {canUseFolders && (
                <button role="menuitem" onClick={() => (setMore(false), p.openFolder())} title={t('Open a folder with diagrams')}>
                  <Icon name="folder-open" /> {ws ? t('Open another folder') : t('Open folder')}
                </button>
              )}
              {canUseFolders && !ws && p.remembered && (
                <button role="menuitem" onClick={() => (setMore(false), p.openFolder(p.remembered))} title={t('Open the last folder again')}>
                  <Icon name="folder-open" /> {p.remembered.name}
                </button>
              )}
              <hr />
              <button role="menuitem" onClick={() => (setMore(false), p.file.save())}>
                <Icon name="save" /> {t('Save')} <kbd>{keyHint('save')}</kbd>
              </button>
              <button role="menuitem" onClick={() => (setMore(false), p.file.download())}>
                <Icon name="download" /> {t('Download YAML')}
              </button>
              {p.file.saveLayout && (
                <button role="menuitem" onClick={() => (setMore(false), p.file.saveLayout!())}>
                  <Icon name="pin" /> {t('Save layout')}
                </button>
              )}
              <hr />
              <button role="menuitem" onClick={() => (setMore(false), p.onCommands())}>
                <Icon name="search" /> {t('Commands')} <kbd>⌘K</kbd>
              </button>
              <hr />
              <BrandMenuItem onOpen={() => (setMore(false), setLook(true))} />
              <button role="menuitem" onClick={() => (setMore(false), p.toggleTheme())}>
                <Icon name={theme === 'dark' ? 'sun' : 'moon'} /> {theme === 'dark' ? t('Light theme') : t('Dark theme')}
              </button>
            </Menu>
          )}
          <BrandMenu ws={ws} open={look} setOpen={setLook} onError={(m) => p.notify(m, { tone: 'error' })} onNotice={(m) => p.notify(m)} />
        </div>
        <ExportMenu {...p.exportMenu} />
      </div>
    </header>
  );
}


