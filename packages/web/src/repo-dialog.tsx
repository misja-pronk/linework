// Diagrams from the code: what a repository holds (Compose, Helm, manifests, Bicep, OpenAPI, AsyncAPI,
// workflows), offered as one diagram each with what it holds, as `carto import <repo>` makes them.
// In an open folder they are written into diagrams/ (and imported over what is there, hand edits
// kept); dropped, one opens. Keys: ↑↓ move, Space picks, O opens the one at hand, Enter does the main
// thing, A picks all or none, Escape closes. Nothing leaves the browser.
import { useEffect, useRef, useState } from 'react';
import type { RepoDiagram, RepoKind, RepoScan } from '@cartography/import';
import { Icon } from './icon.tsx';
import { useModal } from './menu.tsx';
import { t, say } from './i18n/index.ts';
import './repo.css';

const KIND: Record<RepoKind, { icon: string; what: string }> = {
  compose: { icon: 'container', what: 'Compose' },
  helm: { icon: 'ship-wheel', what: 'Helm chart' },
  kubernetes: { icon: 'boxes', what: 'Kubernetes' },
  bicep: { icon: 'cloud', what: 'Bicep' },
  arm: { icon: 'cloud', what: 'ARM template' },
  terraform: { icon: 'cloud', what: 'Terraform' },
  openapi: { icon: 'webhook', what: 'OpenAPI' },
  callbacks: { icon: 'arrow-left-right', what: 'Callbacks' },
  asyncapi: { icon: 'radio-tower', what: 'AsyncAPI' },
  workflow: { icon: 'workflow', what: 'Workflow' },
};

export interface RepoOffer {
  scan: RepoScan;
  /** The folder's name; with `write`, the diagrams go into it. */
  name: string;
  write: boolean;
}

export function RepoDialog({ offer, onWrite, onOpen, onClose }: { offer: RepoOffer; onWrite(chosen: RepoDiagram[]): void; onOpen(d: RepoDiagram): void; onClose(): void }) {
  const modal = useModal();
  const { diagrams, hints } = offer.scan;
  const [picked, setPicked] = useState(() => new Set(diagrams.map((d) => d.file)));
  const [at, setAt] = useState(0);
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const chosen = diagrams.filter((d) => picked.has(d.file));
  const folder = diagrams[0]?.file.includes('/') ? diagrams[0].file.slice(0, diagrams[0].file.lastIndexOf('/') + 1) : '';
  const toggle = (file: string) => setPicked((p) => (p.has(file) ? new Set([...p].filter((x) => x !== file)) : new Set([...p, file])));
  const main = () => (offer.write ? chosen.length && onWrite(chosen) : (chosen[0] ?? diagrams[at]) && onOpen(chosen[0] ?? diagrams[at]!));

  useEffect(() => rows.current[at]?.focus(), [at]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowDown' || e.key === 'j') (e.preventDefault(), setAt((i) => Math.min(diagrams.length - 1, i + 1)));
      else if (e.key === 'ArrowUp' || e.key === 'k') (e.preventDefault(), setAt((i) => Math.max(0, i - 1)));
      else if (e.key === ' ' && document.activeElement?.tagName !== 'BUTTON') (e.preventDefault(), toggle(diagrams[at]!.file));
      else if (e.key === 'o' || e.key === 'O') (e.preventDefault(), onOpen(diagrams[at]!));
      else if (e.key === 'a' || e.key === 'A') (e.preventDefault(), setPicked((p) => (p.size === diagrams.length ? new Set() : new Set(diagrams.map((d) => d.file)))));
      else if (e.key === 'Enter' && document.activeElement?.tagName !== 'BUTTON') (e.preventDefault(), main());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="shortcuts repo-dialog" role="dialog" aria-modal="true" ref={modal} aria-label={t('Diagrams from the code')} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>
            <Icon name="folder-git-2" /> {t('Diagrams from the code in {name}', { name: offer.name })}
          </h2>
          <button className="icon-button" onClick={onClose} aria-label={t('Close')}>
            <Icon name="x" />
          </button>
        </header>
        <p className="repo-intro">
          {t('{count} found: one diagram for each source.', { count: diagrams.length })}{' '}
          {offer.write ? (folder ? t('Picked ones are written to {folder}; importing again keeps what you changed by hand.', { folder }) : t('Picked ones are written to the folder; importing again keeps what you changed by hand.')) : t('Open one to look at it; open the folder to write them all.')}
        </p>
        <ul className="repo-list" role="listbox" aria-label={t('Diagrams')} aria-multiselectable="true">
          {diagrams.map((d, i) => (
            <li
              key={d.file}
              ref={(el) => void (rows.current[i] = el)}
              role="option"
              aria-selected={picked.has(d.file)}
              tabIndex={i === at ? 0 : -1}
              className={`repo-row${i === at ? ' at' : ''}`}
              onClick={() => (setAt(i), toggle(d.file))}
              data-file={d.file}
            >
              <input type="checkbox" checked={picked.has(d.file)} readOnly tabIndex={-1} aria-hidden="true" />
              <Icon name={KIND[d.kind].icon} />
              <span className="repo-what">
                <strong>{d.file.split('/').pop()}</strong>
                <span className="repo-kind">{say(KIND[d.kind].what)}</span>
                <span className="repo-source">{d.sources.join(', ')}</span>
                <span className="repo-summary">
                  {d.summary}
                  {d.kept ? ` · ${t('your edits kept')}` : ''}
                  {d.warnings.length ? ` · ${t('{count} note|{count} notes', { count: d.warnings.length })}` : ''}
                </span>
              </span>
              <button className="button ghost repo-open" onClick={(e) => (e.stopPropagation(), onOpen(d))} title={t('Open this one (O)')}>
                {t('Open')}
              </button>
            </li>
          ))}
        </ul>
        {hints.length > 0 && (
          <details className="repo-hints">
            <summary>{t('Also found, not drawn ({count})', { count: hints.length })}</summary>
            <ul>
              {hints.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </details>
        )}
        <footer className="describe-footer">
          <span className="animate-hint">
            <kbd>Space</kbd> {t('picks@hint')} · <kbd>O</kbd> {t('opens@hint')} · <kbd>A</kbd> {t('all@hint')}
          </span>
          <div className="describe-actions">
            {offer.write ? (
              <button className="button primary" onClick={() => main()} disabled={!chosen.length}>
                <Icon name="save" /> {folder ? t('Write {count} diagram to {folder}|Write {count} diagrams to {folder}', { count: chosen.length, folder }) : t('Write {count} diagram|Write {count} diagrams', { count: chosen.length })}
                {' '}<kbd>↵</kbd>
              </button>
            ) : (
              <button className="button primary" onClick={() => main()}>
                <Icon name="folder-open" /> {t('Open {name}', { name: (chosen[0] ?? diagrams[at])?.file.split('/').pop() ?? '' })} <kbd>↵</kbd>
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
