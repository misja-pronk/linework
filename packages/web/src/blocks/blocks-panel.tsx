// The Blocks section of the shapes panel: this type's blocks with a preview, searchable; click or ↵
// to insert (into the selected group), or drag one onto the drawing or into a group.
import { useMemo, useState } from 'react';
import type { Block, Listed } from '@cartography/blocks';
import { Icon } from '../icon.tsx';
import { score } from '../palette.tsx';
import { say, t } from '../i18n/index.ts';

export const BLOCK_MIME = 'application/x-cartography-block';
const OPEN_KEY = 'cartography:blocks-open';

const SOURCE = { folder: 'blocks/', library: 'mine', starter: 'starter' } as const;

export const blockSearch = (b: Block) => `${b.title} ${b.name} ${b.tags.join(' ')} ${b.description ?? ''}`;

export function BlocksPanel(p: {
  listed: Listed[];
  typeId: string;
  thumb(b: Block): string | undefined;
  onPick(b: Block): void;
  /** Instances in this diagram older than their block. */
  outdated: number;
  onReview(): void;
  hint: string;
}) {
  const [query, setQuery] = useState('');
  const mine = p.listed.filter((l) => l.block?.type === p.typeId);
  // Open once chosen open (remembered), and by itself when there are blocks of your own: the starters
  // alone do not take the room of the shapes until asked for.
  const [chosen, setChosen] = useState<boolean | undefined>(() => {
    try {
      const v = localStorage.getItem(OPEN_KEY);
      return v == null ? undefined : v === 'true';
    } catch {
      return undefined;
    }
  });
  const open = chosen ?? (mine.some((l) => l.source !== 'starter') || p.outdated > 0);
  const setOpen = (v: boolean) => {
    setChosen(v);
    try {
      localStorage.setItem(OPEN_KEY, String(v));
    } catch {
      /* private window: not remembered */
    }
  };
  const shown = useMemo(() => {
    const hits = mine.map((l) => ({ l, s: score(query, blockSearch(l.block!)) })).filter((x) => x.s > 0);
    if (query) hits.sort((a, b) => b.s - a.s);
    return hits.map((x) => x.l);
  }, [mine, query]);

  return (
    <section className={open ? 'blocks-panel open' : 'blocks-panel'} aria-label={t('Blocks')}>
      <header>
        <button className="blocks-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon name="chevron-down" size={14} /> {t('Blocks')} <span className="blocks-count">{mine.length}</span>
        </button>
        <kbd title={t('Insert a block from the keyboard')}>{p.hint}</kbd>
      </header>
      {open && (
        <>
          {p.outdated > 0 && (
            <button className="blocks-outdated" onClick={p.onReview}>
              <Icon name="refresh-cw" size={13} /> {t('{count} instance is older than its block · Review…|{count} instances are older than its block · Review…', { count: p.outdated })}
            </button>
          )}
          {mine.length > 3 && (
            <div className="palette-input blocks-search">
              <Icon name="search" />
              <input
                placeholder={t('Search blocks…')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && shown[0]?.block) (e.preventDefault(), p.onPick(shown[0].block));
                  else if (e.key === 'Escape') setQuery('');
                }}
                aria-label={t('Search blocks')}
              />
            </div>
          )}
          <div className="blocks-list" role="list">
            {!mine.length && <p className="blocks-empty">{t('No blocks for this type yet. Select shapes and choose Save as block… to make one.')}</p>}
            {mine.length > 0 && !shown.length && <p className="blocks-empty">{t('Nothing matches “{query}”', { query })}</p>}
            {shown.map((l) => {
              const b = l.block!;
              const svg = p.thumb(b);
              const errors = l.problems.filter((x) => x.severity === 'error');
              return (
                <button
                  key={l.name}
                  role="listitem"
                  className="block-card"
                  draggable
                  data-block={l.name}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(BLOCK_MIME, l.name);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => p.onPick(b)}
                  title={`${b.description ?? b.title}\n\n${t('Click or ↵ to insert (into the selected group), or drag onto the drawing')}`}
                >
                  <span className="block-thumb" aria-hidden="true" dangerouslySetInnerHTML={svg ? { __html: svg } : undefined} />
                  <span className="block-title">{b.title}</span>
                  <span className="block-meta">
                    <span className={`block-source ${l.source}`}>{say(SOURCE[l.source])}</span>
                    {b.params.length > 0 && <span>{b.params.map((x) => x.name).join(', ')}</span>}
                    {errors.length > 0 && (
                      <span className="block-problem" title={errors.map((x) => x.message).join('\n')}>
                        <Icon name="triangle-exclamation-point" size={12} /> {errors.length}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
