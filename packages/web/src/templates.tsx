// Start from a template or an example: a grid of live thumbnails, filtered by type.
import { useEffect, useMemo, useState } from 'react';
import { render } from '@cartography/engine';
import { exampleLoader, starters, typeName, type Starter } from './library.ts';
import { Icon } from './icon.tsx';
import { useRestoreFocus } from './menu.tsx';

const thumbs = new Map<string, string>();
let thumbIds = 0;

export function Templates({ theme, onPick, onClose }: { theme: 'light' | 'dark'; onPick(s: Starter): void; onClose(): void }) {
  const typeIds = useMemo(() => [...new Set(starters.map((s) => s.type))], []);
  const [filter, setFilter] = useState<string>('all');
  const [, redraw] = useState(0);
  useRestoreFocus();
  const shown = starters.filter((s) => filter === 'all' || s.type === filter);

  // Thumbnails one by one, so the dialog opens at once and fills in.
  useEffect(() => {
    let stop = false;
    (async () => {
      for (const s of shown) {
        const key = `${theme}:${s.id}`;
        if (stop) return;
        if (thumbs.has(key)) continue;
        const r = await render(s.text, { theme, fonts: 'none', idPrefix: `t${thumbIds++}`, load: exampleLoader(s.id) });
        thumbs.set(key, r.svg ?? '');
        if (!stop) redraw((n) => n + 1);
      }
    })();
    return () => {
      stop = true;
    };
  }, [filter, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="templates" role="dialog" aria-label="Start from a template" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>Start a diagram</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <nav className="chips">
          {['all', ...typeIds].map((t) => (
            <button key={t} className={filter === t ? 'chip active' : 'chip'} onClick={() => setFilter(t)}>
              {t === 'all' ? 'All' : typeName(t)}
            </button>
          ))}
        </nav>
        <div className="template-grid">
          {shown.map((s) => {
            const svg = thumbs.get(`${theme}:${s.id}`);
            return (
              <button key={s.id} className="template-card" onClick={() => onPick(s)} autoFocus={s === shown[0]}>
                <div className="thumb">{svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="thumb-wait" />}</div>
                <div className="template-meta">
                  <span className="template-title">{s.title}</span>
                  <span className="template-sub">
                    {s.kind === 'template' ? 'Template' : s.kind === 'empty' ? 'Empty' : 'Example'} · {typeName(s.type)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
