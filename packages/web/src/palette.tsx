// ⌘K: every action and every element of the diagram, found by typing a few letters.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icon.tsx';
import { useRestoreFocus } from './menu.tsx';

export interface Command {
  id: string;
  label: string;
  group: string;
  icon?: string;
  hint?: string;
  shortcut?: string;
  run(): void;
}

/** Letters in order, with a bonus for word starts and runs: "exp png" finds "Export PNG". */
export function score(query: string, text: string): number {
  const q = query.toLowerCase().replace(/\s+/g, '');
  const t = text.toLowerCase();
  if (!q) return 1;
  let s = 0;
  let at = -1;
  let run = 0;
  for (const ch of q) {
    const i = t.indexOf(ch, at + 1);
    if (i < 0) return 0;
    run = i === at + 1 ? run + 1 : 0;
    s += 1 + run * 2 + (i === 0 || /[\s/·._-]/.test(t[i - 1]!) ? 3 : 0);
    at = i;
  }
  return s - t.length * 0.01;
}

export function Palette({ commands, onClose, placeholder = 'Type a command or an element…' }: { commands: Command[]; onClose(): void; placeholder?: string }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  useRestoreFocus();
  const shown = useMemo(() => {
    const scored = commands.map((c) => ({ c, s: score(query, `${c.group} ${c.label} ${c.hint ?? ''}`) })).filter((x) => x.s > 0);
    if (query) scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, 60).map((x) => x.c);
  }, [commands, query]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Icon name="search" />
          <input
            autoFocus
            value={query}
            placeholder={placeholder}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, shown.length - 1));
              else if (e.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0));
              else if (e.key === 'Enter') run(shown[index]);
              else if (e.key === 'Escape') onClose();
              else return;
              e.preventDefault();
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={shown[index] ? `cmd-${index}` : undefined}
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={list}>
          {shown.length === 0 && <div className="palette-empty">{query ? `Nothing matches “${query}”` : commands.length ? 'Nothing here' : placeholder}</div>}
          {shown.map((c, i) => (
            <div key={c.id}>
              {(i === 0 || shown[i - 1]!.group !== c.group) && !query && <div className="palette-group">{c.group}</div>}
              <div
                id={`cmd-${i}`}
                className="palette-item"
                role="option"
                aria-selected={i === index}
                onMouseMove={() => setIndex(i)}
                onClick={() => run(c)}
              >
                <Icon name={c.icon ?? 'command'} />
                <span className="palette-label" title={c.label}>{c.label}</span>
                {c.hint && <span className="palette-hint">{c.hint}</span>}
                {c.shortcut && <kbd>{c.shortcut}</kbd>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
