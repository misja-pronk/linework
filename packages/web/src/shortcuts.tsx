// "?": every shortcut on one sheet, so nothing has to be remembered from a manual. The rows come
// from keys.ts, the same table the key handlers read; a search narrows them.
import { useEffect, useMemo, useState } from 'react';
import { Icon } from './icon.tsx';
import { useModal } from './menu.tsx';
import { sheetKeys, SHORTCUTS, type KeyContext } from './keys.ts';
import { say, t, useUiLang } from './i18n/index.ts';

/** The sheet's sections in reading order, each with where its keys work. */
const GROUPS: [string, string][] = [
  ['Anywhere', 'also while typing, for the keys with ⌘; ? and P not in a text field'],
  ['Drawing', 'when the drawing has focus: click it, or F6'],
  ['Focus', ''],
  ['Layers', 'the panel keys work while it is open'],
  ['Arrange', 'the selected shapes'],
  ['Steps', ''],
  ['Review notes', ''],
  ['Decisions', 'architecture decisions of the folder'],
  ['Architecture review', 'well-architected rules on the drawing'],
  ['Presenting', 'full screen'],
  ['Comparing versions', ''],
  ['Folder (one model)', 'with a folder open'],
  ['Blocks', ''],
  ['YAML editor', 'when the YAML has focus'],
  ['Mouse and trackpad', ''],
];

const WHERE: Partial<Record<KeyContext, string>> = { 'step-chip': 'on its chip', note: 'in a note', focus: 'in a focus', compare: 'comparing', 'layers-panel': 'in the panel' };

export function Shortcuts({ onClose }: { onClose(): void }) {
  const modal = useModal();
  const lang = useUiLang();
  const [query, setQuery] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === '?' && !(e.target as HTMLElement | null)?.closest?.('input')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const sections = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return GROUPS.map(([title, note]) => {
      const rows = SHORTCUTS.filter((s) => s.group === title)
        .map((s) => ({ id: s.id, keys: sheetKeys({ ...s, show: s.show && say(s.show) }), what: WHERE[s.context] ? `${say(s.what)} (${say(WHERE[s.context]!)})` : say(s.what) }))
        .filter((r) => words.every((w) => `${r.keys} ${r.what} ${say(title)} ${title}`.toLowerCase().includes(w)));
      return { title: say(title), note: note && say(note), rows };
    }).filter((g) => g.rows.length);
  }, [query, lang]);
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="shortcuts" role="dialog" aria-modal="true" ref={modal} aria-label={t('Keyboard shortcuts')} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>
            <Icon name="keyboard" /> {t('Shortcuts')}
          </h2>
          <input className="shortcuts-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Find a key or what it does…')} aria-label={t('Find a shortcut')} autoFocus />
          <button className="icon-button" onClick={onClose} aria-label={t('Close')}>
            <Icon name="x" />
          </button>
        </header>
        <div className="shortcut-grid">
          {sections.map(({ title, note, rows }) => (
            <section key={title}>
              <h3>
                {title}
                {note && <span className="shortcut-where"> · {note}</span>}
              </h3>
              <dl>
                {rows.map((r) => (
                  <div key={r.id}>
                    <dt>
                      <kbd>{r.keys}</kbd>
                    </dt>
                    <dd>{r.what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          {!sections.length && <p className="shortcuts-none">{t('No shortcut for “{query}”. The command palette (⌘K) has every command.', { query })}</p>}
        </div>
      </div>
    </div>
  );
}
