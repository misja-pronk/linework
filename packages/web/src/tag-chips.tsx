// Tags in the properties panel: a chip each, and a field that completes from the tags already in the
// file, so "security" is not written three ways. Enter or a comma adds, Backspace in an empty field
// takes the last one off, ↓ ↑ walk the suggestions; each change is one undo step.
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './icon.tsx';
import './layers.css';

export interface TagChipsProps {
  value: string[];
  /** Tags written anywhere in the file (and the layers' tags), to complete from. */
  known: string[];
  onChange(tags: string[]): void;
}

const clean = (s: string) => s.trim().replace(/\s+/g, '-');

/** A tag was just added or removed by keyboard: the panel is drawn again for the new YAML, and the field keeps the keyboard. */
let typing = false;

export function TagChips({ value, known, onChange }: TagChipsProps) {
  const [draft, setDraft] = useState('');
  const [at, setAt] = useState(0);
  const list = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (typing) input.current?.focus();
    typing = false;
  }, [value.join(',')]);
  const q = draft.trim().toLowerCase();
  const suggestions = known.filter((t) => !value.includes(t) && (!q || t.toLowerCase().includes(q))).slice(0, 8);
  const add = (t: string) => {
    const tag = clean(t);
    setDraft('');
    setAt(0);
    if (tag && !value.includes(tag)) ((typing = document.activeElement === input.current), onChange([...value, tag]));
  };
  const remove = (t: string) => onChange(value.filter((x) => x !== t));
  return (
    <div className="tag-chips" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
      {value.map((t) => (
        <span key={t} className="tag-chip">
          {t}
          <button type="button" onClick={() => remove(t)} aria-label={`Remove tag ${t}`} title={`Remove ${t}`}>
            <Icon name="x" size={12} />
          </button>
        </span>
      ))}
      <input
        ref={input}
        value={draft}
        placeholder={value.length ? '' : known.length ? `e.g. ${known.slice(0, 2).join(', ')}` : 'security, data, phase-2'}
        aria-label="Add a tag"
        aria-autocomplete="list"
        aria-controls={list}
        aria-activedescendant={draft && suggestions[at] ? `${list}-${at}` : undefined}
        spellCheck={false}
        onChange={(e) => (setDraft(e.target.value.replace(',', '')), setAt(0), e.target.value.includes(',') && add(e.target.value.replace(',', '')))}
        onBlur={() => draft.trim() && add(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') draft.trim() ? add(q && suggestions[at] ? suggestions[at]! : draft) : (document.querySelector('.preview') as HTMLElement | null)?.focus();
          else if (e.key === 'Tab' && q && suggestions[at]) add(suggestions[at]!);
          else if (e.key === 'ArrowDown' && suggestions.length) setAt((i) => (i + 1) % suggestions.length);
          else if (e.key === 'ArrowUp' && suggestions.length) setAt((i) => (i - 1 + suggestions.length) % suggestions.length);
          else if (e.key === 'Backspace' && !draft && value.length) ((typing = true), remove(value.at(-1)!));
          else if (e.key === 'Escape' && draft) setDraft('');
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      />
      {suggestions.length > 0 && (
        <ul className="tag-suggestions" id={list} role="listbox" aria-label="Tags in this file">
          {suggestions.map((t, i) => (
            <li key={t} id={`${list}-${i}`} role="option" aria-selected={!!q && i === at}>
              <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => add(t)}>
                {t}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
