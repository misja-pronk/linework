// Rename everywhere (⇧F2): a new id (and, if wanted, a new label) for an element, in every file of the
// folder that names it. The change of every file is shown before anything is written; Enter applies it.
import { useMemo, useState } from 'react';
import { lineDiff, planRename, type RenameOptions, type RenamePlan, type WorkspaceIndex } from '@cartography/core';
import { Icon } from '../icon.tsx';
import { useModal } from '../menu.tsx';
import { t } from '../i18n/index.ts';

export function RenameEverywhere({
  index,
  element,
  references,
  pinsFollow,
  onApply,
  onClose,
}: {
  index: WorkspaceIndex;
  element: string;
  references: RenameOptions['references'];
  /** Layout and notes files that change with the plan. */
  pinsFollow(plan: RenamePlan): string[];
  onApply(plan: RenamePlan): void;
  onClose(): void;
}) {
  const modal = useModal();
  const el = index.elements.get(element)?.[0];
  const [id, setId] = useState(el?.name ?? element);
  const [label, setLabel] = useState('');
  const plan = useMemo(() => planRename(index, element, id, { references, ...(label.trim() ? { label } : {}) }), [index, element, id, label, references]);
  const same = plan.to === element && !label.trim();
  const ready = !plan.problem && !same && plan.files.length > 0;
  const places = plan.files.reduce((n, f) => n + f.count, 0);
  const pins = useMemo(() => (ready ? pinsFollow(plan) : []), [plan, ready]);
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && ready) (e.preventDefault(), onApply(plan));
    else if (e.key === 'Escape') (e.preventDefault(), onClose());
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette rename-everywhere" role="dialog" aria-modal="true" ref={modal} aria-label={t('Rename {id} everywhere', { id: element })} onMouseDown={(e) => e.stopPropagation()}>
        <header className="rename-head">
          <Icon name="tag" />
          <strong>{t('Rename everywhere')}</strong>
          <code>{element}</code>
          <kbd>esc</kbd>
        </header>
        <div className="rename-fields">
          <label>
            <span>{t('New id')}</span>
            <span className="rename-id">
              {el?.parent && <code>{el.parent}.</code>}
              <input autoFocus value={id} onChange={(e) => setId(e.target.value)} onKeyDown={keys} spellCheck={false} aria-label={t('New id')} onFocus={(e) => e.currentTarget.select()} />
            </span>
          </label>
          <label>
            <span>{t('New label')}</span>
            <input value={label} placeholder={t('{label} (unchanged)', { label: el?.label ?? element })} onChange={(e) => setLabel(e.target.value)} onKeyDown={keys} aria-label={t('New label (optional)')} />
          </label>
        </div>
        <div className="rename-summary" role="status">
          {plan.problem ? (
            <span className="rename-problem">
              <Icon name="circle-exclamation-point" size={14} /> {plan.problem}
            </span>
          ) : same ? (
            t('Type the new id; the change in every file shows here first.')
          ) : (
            <>
              {t('{places} in {files}{pins}. One undo per file, and “Undo rename” for all of it.', { places: t('{count} place|{count} places', { count: places }), files: t('{count} file|{count} files', { count: plan.files.length }),
              pins: pins.length ? t('; pins and notes follow in {list}', { list: pins.join(', ') }) : '' })}
            </>
          )}
        </div>
        <div className="rename-diff" aria-label={t('Preview')}>
          {ready &&
            plan.files.map((f) => (
              <section key={f.file} className="rename-file">
                <h4>
                  <Icon name="file-code" size={13} /> {f.file} <span>{t('{count} change|{count} changes', { count: f.count })}</span>
                </h4>
                {lineDiff(f.before, f.after).map((hunk, i) => (
                  <pre key={i} className="diff-hunk">
                    {hunk.map((l, j) => (
                      <div key={j} className={l.kind === '-' ? 'del' : l.kind === '+' ? 'ins' : ''}>
                        <span className="ln">{l.line}</span>
                        <span className="sign">{l.kind}</span>
                        {l.text}
                      </div>
                    ))}
                  </pre>
                ))}
              </section>
            ))}
        </div>
        <footer className="rename-actions">
          <button className="button ghost" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="button primary" disabled={!ready} onClick={() => onApply(plan)}>
            {t('Rename in {count} file|Rename in {count} files', { count: plan.files.length || '' })} <kbd>↵</kbd>
          </button>
        </footer>
      </div>
    </div>
  );
}
