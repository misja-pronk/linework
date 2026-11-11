// The form for the selected element, generated from the type's schema (requirement B3/B6).
// Text commits on Enter or leaving the field, so each change is one undo step.
import { useEffect, useState } from 'react';
import type { Field } from './builder.ts';
import { Icon } from './icon.tsx';
import { LinkList } from './link-list.tsx';
import { TagChips } from './tag-chips.tsx';
import { store } from './store.ts';
import { say, t } from './i18n/index.ts';
import type { Link } from '@cartography/core';

export interface InspectorProps {
  /** Which selection this panel shows ("node:web"), so a caller can wait for it before moving the cursor in. */
  selection?: string;
  id: string;
  /** What the drawing shows for it. */
  title: string;
  icon?: string;
  kindLabel: string;
  fields: Field[];
  /** Entries in a map can be renamed; list items (edges) cannot. */
  renamable: boolean;
  /** The id is a name as a reader says it (a process step, a state): spaces are fine. */
  freeName?: boolean;
  pinned: boolean;
  /** Nodes and groups: whether it is locked in place (undefined for lines). */
  locked?: boolean;
  onLock?(): void;
  /** A line bent by hand: back to the automatic route. */
  onResetLine?(): void;
  onField(key: string, value: unknown): void;
  onRename(id: string): boolean;
  onReveal(): void;
  onDuplicate?(): void;
  /** Entries drawn in the order written (journey steps): one place earlier or later; undefined at the end. */
  onMove?: { earlier?(): void; later?(): void };
  onDelete(): void;
  onUnpin(): void;
  onClose(): void;
  /** Lines to and from a node, to select or remove one without hunting for it in the drawing. */
  connections?: { id: string; out: boolean; other: string; label?: string }[];
  onSelectEdge?(id: string): void;
  onDeleteEdge?(id: string): void;
  /** Where the element links to (URLs, other diagrams, views), to follow from here. */
  links?: Link[];
  onFollowLink?(link: Link): void;
  /** Tags written in the file, to complete `tags:` from. */
  tags?: string[];
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** "Service", not "Service (service)": the id is shown only when the name does not already say it. */
const optionText = (id: string, name?: string) => (!name || name === id ? id : squash(name).includes(squash(id)) ? name : `${name} (${id})`);

/** Back to the drawing, so the next drawing shortcut (A, C, Tab…) works right away. */
const toDrawing = () => (document.querySelector('.preview') as HTMLElement | null)?.focus({ preventScroll: true });

function TextInput({ value, onCommit, ...rest }: { value: string; onCommit(v: string): void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value'>) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft);
  return (
    <input
      {...rest}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        // Enter keeps the change, Esc drops it; both go back to the drawing.
        if (e.key === 'Enter') {
          commit();
          toDrawing();
        } else if (e.key === 'Escape') {
          setDraft(value);
          toDrawing();
        } else return;
        e.preventDefault();
      }}
    />
  );
}

export function Inspector(p: InspectorProps) {
  const [idError, setIdError] = useState(false);
  useEffect(() => setIdError(false), [p.id]);
  /** "More" stays as people left it, for every element. */
  const [more, setMore] = useState(() => store.get<boolean>('inspectorMore') ?? false);
  const primary = p.fields.filter((f) => f.primary !== false);
  const rest = p.fields.filter((f) => f.primary === false);
  /** The id as written: under "More" (a name people read, as in a process, leads instead). */
  const idField = p.renamable && (
        <label className={idError ? 'field invalid' : 'field'}>
          <span>{p.freeName ? t('Name') : t('ID')}</span>
          <TextInput
            className={p.freeName ? undefined : 'mono'}
            value={p.id}
            spellCheck={false}
            onCommit={(v) => setIdError(!p.onRename(v.trim()))}
            aria-invalid={idError}
          />
          {idError && <small className="field-error">{p.freeName ? t('Plain words, without : > # or quotes, and not used yet') : t('Letters, digits, - and _ only, and not used yet')}</small>}
        </label>
  );
  const moreCount = rest.length + (p.renamable && !p.freeName ? 1 : 0);
  const field = (f: Field) => (
    <label key={f.key} className={f.kind === 'toggle' ? 'field toggle' : 'field'} title={`${t('{key}: in the YAML', { key: f.key })}${f.hint ? ` · ${f.hint}` : ''}`} data-key={f.key}>
      <span>{say(f.label)}</span>
      {f.kind === 'text' || f.kind === 'number' ? (
        <TextInput
          value={f.value}
          inputMode={f.kind === 'number' ? 'numeric' : undefined}
          placeholder={f.note ?? f.hint}
          onCommit={(v) => p.onField(f.key, (f.kind === 'number' || f.numeric) && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : v.trim())}
        />
      ) : f.kind === 'select' ? (
        <select value={f.value} onChange={(e) => p.onField(f.key, e.target.value || undefined)}>
          {f.allowEmpty && <option value="">—</option>}
          {f.value && !f.options.includes(f.value) && <option value={f.value}>{f.value}</option>}
          {f.options.map((o) => (
            <option key={o} value={o}>
              {optionText(o, f.labels?.[o])}
            </option>
          ))}
        </select>
      ) : f.kind === 'toggle' ? (
        <input type="checkbox" role="switch" checked={f.value} onChange={(e) => p.onField(f.key, e.target.checked || undefined)} />
      ) : f.kind === 'list' && f.key === 'tags' ? (
        <TagChips value={f.value} known={p.tags ?? []} onChange={(v) => p.onField(f.key, v.length ? v : undefined)} />
      ) : f.kind === 'list' ? (
        <TextInput
          // Items with a comma in them (sentences) are kept whole: the list is then split on semicolons.
          value={f.value.join(f.semi || f.value.some((x) => x.includes(',')) ? '; ' : ', ')}
          placeholder={f.semi ? 'a; b; c' : f.note ? `${f.note} (a, b, c)` : 'a, b, c'}
          onCommit={(v) => {
            const items = v
              .split(f.semi || v.includes(';') ? ';' : ',')
              .map((x) => x.trim())
              .filter(Boolean);
            p.onField(f.key, f.one && items.length === 1 ? items[0] : items);
          }}
        />
      ) : (
        <button type="button" className="field-yaml" onClick={p.onReveal}>
          <span>{f.summary}</span> <Icon name="file-code" size={14} /> {t('Edit in YAML')}
        </button>
      )}
      {/* Text fields say it as a placeholder; the others under the field. */}
      {f.note && (f.kind === 'toggle' || f.kind === 'select' || f.kind === 'yaml') && <small className="field-note">{f.note}</small>}
    </label>
  );

  return (
    <aside
      className="inspector"
      data-selection={p.selection}
      aria-label={t('Properties')}
      onKeyDown={(e) => {
        // Esc anywhere in the panel (selects, buttons) also returns to the drawing. Other keys pass on,
        // so ⌘K, ⌘S and F6 work from here too; drawing shortcuts only listen on the drawing itself.
        if (e.key === 'Escape') toDrawing();
      }}
    >
      <header>
        <span className="inspector-icon">
          <Icon name={p.icon ?? 'box'} />
        </span>
        <div className="inspector-title">
          <strong>{p.title}</strong>
          <span>{p.kindLabel}</span>
        </div>
        <button className="icon-button" onClick={p.onClose} aria-label={t('Close properties')} title={t('Close (Esc)')}>
          <Icon name="x" />
        </button>
      </header>

      <div className="inspector-body">
        {p.freeName && idField}
        {primary.map(field)}
        {moreCount > 0 && (
        <details
          className="inspector-more"
          open={more}
          onToggle={(e) => {
            const open = (e.currentTarget as HTMLDetailsElement).open;
            setMore(open);
            store.set('inspectorMore', open);
          }}
        >
          <summary>
            {t('More')} <span className="count">{moreCount}</span>
          </summary>
          <div className="more-body">
            {!p.freeName && idField}
            {rest.map(field)}
          </div>
        </details>
        )}
        {p.onFollowLink && <LinkList links={p.links} onFollow={p.onFollowLink} />}
        {p.connections && p.connections.length > 0 && (
          <div className="field">
            <span>{t('Connections')}</span>
            <ul className="connections">
              {p.connections.map((c) => (
                <li key={c.id}>
                  <button type="button" className="connection" onClick={() => p.onSelectEdge?.(c.id)} title={t('Select this line')}>
                    <Icon name={c.out ? 'arrow-right-from-line' : 'arrow-right-to-line'} size={14} />
                    <span>{c.other}</span>
                    {c.label && <em>{c.label}</em>}
                  </button>
                  <button type="button" className="icon-button small" onClick={() => p.onDeleteEdge?.(c.id)} aria-label={t('Remove line to {other}', { other: c.other })} title={t('Remove this line')}>
                    <Icon name="x" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <footer>
        {p.onResetLine && (
          <button className="button ghost" onClick={p.onResetLine} title={t('Route this line automatically again')}>
            <Icon name="route" /> {t('Reset line')}
          </button>
        )}
        {p.locked != null && p.onLock && (
          <button className="button ghost" onClick={p.onLock} title={`${p.locked ? t('Unlock') : t('Lock it where it is, so it cannot be dragged by accident')} (⇧⌘L)`} aria-pressed={p.locked}>
            <Icon name={p.locked ? 'lock-open' : 'lock'} /> {p.locked ? t('Unlock') : t('Lock')}
          </button>
        )}
        {p.pinned && !p.locked && (
          <button className="button ghost" onClick={p.onUnpin} title={t('Let the layout place it again')}>
            <Icon name="pin-off" /> {t('Unpin')}
          </button>
        )}
        {p.onMove && (
          <>
            <button className="button ghost" onClick={p.onMove.earlier} disabled={!p.onMove.earlier} title={t('Move one place earlier')}>
              <Icon name="arrow-left" /> {t('Earlier')}
            </button>
            <button className="button ghost" onClick={p.onMove.later} disabled={!p.onMove.later} title={t('Move one place later')}>
              <Icon name="arrow-right" /> {t('Later')}
            </button>
          </>
        )}
        {p.onDuplicate && (
          <button className="button ghost" onClick={p.onDuplicate} title={t('Duplicate (⌘D)')}>
            <Icon name="copy" /> {t('Duplicate')}
          </button>
        )}
        <button className="button ghost danger" onClick={p.onDelete} title={t('Delete (⌫)')}>
          <Icon name="trash" /> {t('Delete')}
        </button>
      </footer>
    </aside>
  );
}
