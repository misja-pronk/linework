// The Blocks section of the shapes panel: this type's blocks with a preview, searchable; click or ↵
// to insert (into the selected group), or drag one onto the drawing or into a group.
import { useMemo, useState } from 'react';
import type { Block, Listed } from '@cartography/blocks';
import { Icon } from '../icon.tsx';
import { score } from '../palette.tsx';

export const BLOCK_MIME = 'application/x-cartography-block';

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
  const [open, setOpen] = useState(true);
  const mine = p.listed.filter((l) => l.block?.type === p.typeId);
  const shown = useMemo(() => {
    const hits = mine.map((l) => ({ l, s: score(query, blockSearch(l.block!)) })).filter((x) => x.s > 0);
    if (query) hits.sort((a, b) => b.s - a.s);
    return hits.map((x) => x.l);
  }, [mine, query]);

  return (
    <section className={open ? 'blocks-panel open' : 'blocks-panel'} aria-label="Blocks">
      <header>
        <button className="blocks-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon name="chevron-down" size={14} /> Blocks <span className="blocks-count">{mine.length}</span>
        </button>
        <kbd title="Insert a block from the keyboard">{p.hint}</kbd>
      </header>
      {open && (
        <>
          {p.outdated > 0 && (
            <button className="blocks-outdated" onClick={p.onReview}>
              <Icon name="refresh-cw" size={13} /> {p.outdated === 1 ? '1 instance is' : `${p.outdated} instances are`} older than its block · Review…
            </button>
          )}
          {mine.length > 3 && (
            <div className="palette-input blocks-search">
              <Icon name="search" />
              <input
                placeholder="Search blocks…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && shown[0]?.block) (e.preventDefault(), p.onPick(shown[0].block));
                  else if (e.key === 'Escape') setQuery('');
                }}
                aria-label="Search blocks"
              />
            </div>
          )}
          <div className="blocks-list" role="list">
            {!mine.length && <p className="blocks-empty">No blocks for this type yet. Select shapes and choose Save as block… to make one.</p>}
            {mine.length > 0 && !shown.length && <p className="blocks-empty">Nothing matches “{query}”</p>}
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
                  title={`${b.description ?? b.title}\n\nClick or ↵ to insert (into the selected group), or drag onto the drawing`}
                >
                  <span className="block-thumb" aria-hidden="true" dangerouslySetInnerHTML={svg ? { __html: svg } : undefined} />
                  <span className="block-title">{b.title}</span>
                  <span className="block-meta">
                    <span className={`block-source ${l.source}`}>{SOURCE[l.source]}</span>
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
