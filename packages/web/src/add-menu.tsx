// The type's palette (requirement B2): search with the keyboard, click to add, or drag onto the canvas.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PaletteItem } from '@cartography/core';
import { Icon } from './icon.tsx';
import { score } from './palette.tsx';
import { t } from './i18n/index.ts';

export const PALETTE_MIME = 'application/x-cartography-palette';

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');

/** `inline`: the always-open shapes panel of the builder view, instead of the popup over the drawing. */
export function AddMenu({ items, onAdd, onClose, inline }: { items: PaletteItem[]; onAdd(item: PaletteItem): void; onClose(): void; inline?: boolean }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    const scored = items.map((item, i) => ({ item, i, s: score(query, `${item.label} ${item.kind} ${item.collection} ${(item.keywords ?? []).join(' ')}`) }));
    const hits = scored.filter((x) => x.s > 0);
    if (query) hits.sort((a, b) => b.s - a.s);
    return hits;
  }, [items, query]);
  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  return (
    <div className={inline ? 'add-menu inline' : 'add-menu'} role={inline ? undefined : 'dialog'} aria-label={t('Add to diagram')} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
      <div className="palette-input">
        <Icon name="search" />
        <input
          autoFocus={!inline}
          placeholder={inline ? t('Search shapes…') : t('Add a shape…')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, shown.length - 1));
            else if (e.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0));
            else if (e.key === 'Enter' && shown[index]) onAdd(shown[index].item);
            else if (e.key === 'Escape') onClose();
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
          aria-controls="add-list"
          aria-activedescendant={shown[index] ? `add-${shown[index].i}` : undefined}
        />
      </div>
      <div className="add-list" id="add-list" role="listbox" ref={list}>
        {shown.length === 0 && <div className="palette-empty">{t('Nothing matches “{query}”', { query })}</div>}
        {shown.map(({ item, i }, n) => (
          <div key={i}>
            {!query && (n === 0 || shown[n - 1]!.item.collection !== item.collection) && <div className="palette-group">{titleCase(item.collection)}</div>}
            <div
              id={`add-${i}`}
              role="option"
              aria-selected={!inline && n === index}
              className="add-item"
              draggable
              data-palette={i}
              onDragStart={(e) => {
                e.dataTransfer.setData(PALETTE_MIME, String(i));
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onMouseMove={() => setIndex(n)}
              onClick={() => onAdd(item)}
              title={t('Click to add, or drag onto the drawing')}
            >
              <span className={`tile tone-${item.tone}`}>
                <Icon name={item.icon} size={15} />
              </span>
              {item.label}
              <Icon name="grip-vertical" size={14} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
