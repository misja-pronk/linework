// ⌘P (or ⇧⌘F): everything in the folder by a few letters. Elements by id, name, technology, owner,
// tag or description; views; files; the entries of the other diagrams. Each element says where it is
// drawn; ← and → pick one of those, Enter opens it with the element in focus (⌥Enter: only selected).
import { useEffect, useMemo, useRef, useState } from 'react';
import { searchWorkspace, type WorkspaceIndex, type WsHit } from '@cartography/core';
import { Icon } from '../icon.tsx';
import { useModal } from '../menu.tsx';
import type { Place } from './use-workspace.ts';
import { t } from '../i18n/index.ts';

const ICON: Record<WsHit['kind'], string> = { element: 'box', view: 'layers', file: 'file-code', entry: 'map-pin' };

/** "containers.yaml › api", as a place reads. */
export const placeName = (p: { file: string; view?: string }) => (p.view ? `${p.file.replace(/\.ya?ml$/i, '')} › ${p.view}` : p.file);

export function WorkspaceSearch({ index, scope, onOpen, onClose }: { index: WorkspaceIndex; scope: string; onOpen(p: Place, focus: boolean): void; onClose(): void }) {
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  /** Which of the drawings of the active element Enter opens. */
  const [where, setWhere] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const modal = useModal();
  const hits = useMemo(() => searchWorkspace(index, query, 60), [index, query]);
  useEffect(() => (setAt(0), setWhere(0)), [query]);
  useEffect(() => setWhere(0), [at]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [at]);

  const placeOf = (h: WsHit, w = 0): Place => {
    const d = h.where?.[w];
    return d ? { file: d.file, view: d.view, node: d.node } : { file: h.file, view: h.view, node: h.node, line: h.line };
  };
  const open = (h: WsHit | undefined, w: number, focus: boolean) => {
    if (!h) return;
    onClose();
    onOpen(placeOf(h, w), focus && (h.kind === 'element' || h.kind === 'entry'));
  };

  const counts = useMemo(() => ({ elements: index.elements.size, files: index.files.size }), [index]);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette ws-search" role="dialog" aria-modal="true" ref={modal} aria-label={t('Search the folder')} onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Icon name="search" />
          <input
            autoFocus
            value={query}
            placeholder={t('Search {scope}: elements, views, files, technology, owners…', { scope })}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              const h = hits[at];
              const n = h?.where?.length ?? 0;
              if (e.key === 'ArrowDown') setAt((i) => Math.min(i + 1, hits.length - 1));
              else if (e.key === 'ArrowUp') setAt((i) => Math.max(i - 1, 0));
              else if (e.key === 'ArrowRight' && n > 1 && e.currentTarget.selectionStart === query.length) setWhere((w) => (w + 1) % n);
              else if (e.key === 'ArrowLeft' && n > 1 && e.currentTarget.selectionStart === query.length && where > 0) setWhere((w) => w - 1);
              else if (e.key === 'Enter') open(h, where, !e.altKey);
              else if (e.key === 'Escape') onClose();
              else return;
              e.preventDefault();
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="ws-search-list"
            aria-activedescendant={hits[at] ? `ws-hit-${at}` : undefined}
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list" id="ws-search-list" role="listbox" ref={list}>
          {!query && (
            <div className="palette-empty">
              {t('{elements} in {diagrams}. Type a name, an id, a technology or an owner.', { elements: t('{count} element|{count} elements', { count: counts.elements }), diagrams: t('{count} diagram|{count} diagrams', { count: counts.files }) })}
              <br />
              <kbd>↵</kbd> {t('opens it in focus,')} <kbd>⌥↵</kbd> {t('only selects it,')} <kbd>←</kbd> <kbd>→</kbd> {t('pick where.')}
            </div>
          )}
          {query && !hits.length && <div className="palette-empty">{t('Nothing in {scope} matches “{query}”', { scope, query })}</div>}
          {hits.map((h, i) => (
            <div
              key={`${h.kind}:${h.file}:${h.id}`}
              id={`ws-hit-${i}`}
              className="palette-item ws-hit"
              role="option"
              aria-selected={i === at}
              onMouseMove={() => i !== at && setAt(i)}
              onClick={(e) => open(h, 0, !e.altKey)}
            >
              <Icon name={ICON[h.kind]} />
              <div className="ws-hit-text">
                <div className="ws-hit-head">
                  <span className="palette-label">{h.title}</span>
                  {h.detail && <span className="palette-hint">{h.detail}</span>}
                </div>
                {!!h.where?.length && (
                  <div className="ws-where">
                    {h.where.slice(0, 6).map((w, j) => (
                      <button
                        key={`${w.file}#${w.view ?? ''}`}
                        className={i === at && j === where ? 'ws-chip active' : 'ws-chip'}
                        tabIndex={-1}
                        title={t('Open {file}', { file: placeName(w) })}
                        onClick={(e) => {
                          e.stopPropagation();
                          open(h, j, !e.altKey);
                        }}
                      >
                        {placeName(w)}
                      </button>
                    ))}
                    {h.where.length > 6 && <span className="ws-more">+{h.where.length - 6}</span>}
                  </div>
                )}
                {h.kind === 'element' && !h.where?.length && <div className="ws-where ws-none">{t('in no drawing yet: opens where it is written')}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
