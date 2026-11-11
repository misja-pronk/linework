// Describe: the diagram in plain words (docs/describe.md), as a screen reader hears it and as a handout
// says it, to read here and to copy as text, as Markdown, or with the picture for Confluence and Notion.
// T, M and C copy; Escape closes. The words come from the drawing on screen: its view, step and focus.
import { useEffect, useState } from 'react';
import type { Description, Item } from '@cartography/describe';
import { Icon } from './icon.tsx';
import { useModal } from './menu.tsx';
import { t } from './i18n/index.ts';
import { asMarkdown, asText, copyRich } from './describe.ts';
import type { ExportInput } from './export.ts';
import './describe.css';

function List({ items, ordered }: { items: Item[]; ordered?: boolean }) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag>
      {items.map((it, i) => (
        <li key={i}>
          {it.text}
          {it.items?.length ? <List items={it.items} /> : null}
        </li>
      ))}
    </Tag>
  );
}

export function DescribeDialog({ description: d, input, onClose, onDone }: { description: Description; input: () => ExportInput; onClose(): void; onDone(message: string, tone?: 'error'): void }) {
  const modal = useModal();
  const [busy, setBusy] = useState(false);
  const copy = async (what: 'text' | 'markdown' | 'rich') => {
    if (busy) return;
    setBusy(true);
    try {
      if (what === 'rich') await copyRich(input(), d);
      else await navigator.clipboard.writeText(what === 'text' ? asText(d) : asMarkdown(d));
      onDone(what === 'rich' ? t('Picture and description copied: paste into Confluence, Notion or Google Docs') : what === 'text' ? t('Description copied as text') : t('Description copied as Markdown'));
    } catch (e) {
      onDone(t('Copy failed: {error}', { error: e instanceof Error ? e.message : String(e) }), 'error');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 't' || e.key === 'T') (e.preventDefault(), void copy('text'));
      else if (e.key === 'm' || e.key === 'M') (e.preventDefault(), void copy('markdown'));
      else if (e.key === 'c' || e.key === 'C') (e.preventDefault(), void copy('rich'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="shortcuts describe-dialog" role="dialog" aria-modal="true" ref={modal} aria-label={t('Describe')} aria-describedby="describe-summary" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>
            <Icon name="scroll-text" /> {d.title}
          </h2>
          <button className="icon-button" onClick={onClose} aria-label={t('Close')}>
            <Icon name="x" />
          </button>
        </header>
        <article className="describe-body" tabIndex={0} aria-label={t('Description')}>
          <p id="describe-summary" className="describe-summary">
            {d.summary}
          </p>
          {d.sections.map((s, i) => (
            <section key={i}>
              <h3>{s.heading}</h3>
              {s.text && <p>{s.text}</p>}
              {s.items?.length ? <List items={s.items} ordered={s.ordered} /> : null}
            </section>
          ))}
        </article>
        <footer className="describe-footer">
          <span className="animate-hint">{t('The same words are in every exported SVG, PNG, PDF and slide.')}</span>
          <div className="describe-actions">
            <button className="button" onClick={() => void copy('text')} disabled={busy}>
              <Icon name="copy" /> {t('Copy text')} <kbd>T</kbd>
            </button>
            <button className="button" onClick={() => void copy('markdown')} disabled={busy}>
              <Icon name="file-code" /> {t('Copy Markdown')} <kbd>M</kbd>
            </button>
            <button className="button primary" onClick={() => void copy('rich')} disabled={busy} autoFocus title={t('The picture and the words as rich text, for Confluence, Notion or Google Docs')}>
              <Icon name="book-open" /> {t('Copy for Confluence / Notion')} <kbd>C</kbd>
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
