// The form for the selected element, generated from the type's schema (requirement B3/B6).
// Text commits on Enter or leaving the field, so each change is one undo step.
import { useEffect, useState } from 'react';
import type { Field } from './builder.ts';
import { Icon } from './icon.tsx';

export interface InspectorProps {
  id: string;
  /** What the drawing shows for it. */
  title: string;
  icon?: string;
  kindLabel: string;
  fields: Field[];
  /** Entries in a map can be renamed; list items (edges) cannot. */
  renamable: boolean;
  pinned: boolean;
  onField(key: string, value: unknown): void;
  onRename(id: string): boolean;
  onReveal(): void;
  onDuplicate?(): void;
  onDelete(): void;
  onUnpin(): void;
  onClose(): void;
  /** Lines to and from a node, to select or remove one without hunting for it in the drawing. */
  connections?: { id: string; out: boolean; other: string; label?: string }[];
  onSelectEdge?(id: string): void;
  onDeleteEdge?(id: string): void;
}

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

  return (
    <aside
      className="inspector"
      aria-label="Properties"
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
        <button className="icon-button" onClick={p.onClose} aria-label="Close properties" title="Close (Esc)">
          <Icon name="x" />
        </button>
      </header>

      <div className="inspector-body">
        {p.renamable && (
          <label className={idError ? 'field invalid' : 'field'}>
            <span>ID</span>
            <TextInput
              className="mono"
              value={p.id}
              spellCheck={false}
              onCommit={(v) => setIdError(!p.onRename(v.trim()))}
              aria-invalid={idError}
            />
            {idError && <small className="field-error">Letters, digits, - and _ only, and not used yet</small>}
          </label>
        )}
        {p.fields.map((f) => (
          <label key={f.key} className="field" title={f.hint}>
            <span>{f.label}</span>
            {f.kind === 'text' || f.kind === 'number' ? (
              <TextInput
                value={f.value}
                inputMode={f.kind === 'number' ? 'numeric' : undefined}
                placeholder={f.hint}
                onCommit={(v) => p.onField(f.key, f.kind === 'number' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : v.trim())}
              />
            ) : f.kind === 'select' ? (
              <select value={f.value} onChange={(e) => p.onField(f.key, e.target.value || undefined)}>
                {f.allowEmpty && <option value="">—</option>}
                {f.value && !f.options.includes(f.value) && <option value={f.value}>{f.value}</option>}
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {f.labels?.[o] && f.labels[o] !== o ? `${f.labels[o]} (${o})` : o}
                  </option>
                ))}
              </select>
            ) : f.kind === 'toggle' ? (
              <input type="checkbox" role="switch" checked={f.value} onChange={(e) => p.onField(f.key, e.target.checked || undefined)} />
            ) : f.kind === 'list' ? (
              <TextInput
                value={f.value.join(', ')}
                placeholder="a, b, c"
                onCommit={(v) =>
                  p.onField(
                    f.key,
                    v
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean),
                  )
                }
              />
            ) : (
              <button type="button" className="field-yaml" onClick={p.onReveal}>
                <span>{f.summary}</span> <Icon name="file-code" size={14} /> Edit in YAML
              </button>
            )}
          </label>
        ))}
        {p.connections && p.connections.length > 0 && (
          <div className="field">
            <span>Connections</span>
            <ul className="connections">
              {p.connections.map((c) => (
                <li key={c.id}>
                  <button type="button" className="connection" onClick={() => p.onSelectEdge?.(c.id)} title="Select this line">
                    <Icon name={c.out ? 'arrow-right-from-line' : 'arrow-right-to-line'} size={14} />
                    <span>{c.other}</span>
                    {c.label && <em>{c.label}</em>}
                  </button>
                  <button type="button" className="icon-button small" onClick={() => p.onDeleteEdge?.(c.id)} aria-label={`Remove line to ${c.other}`} title="Remove this line">
                    <Icon name="x" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <footer>
        {p.pinned && (
          <button className="button ghost" onClick={p.onUnpin} title="Let the layout place it again">
            <Icon name="pin-off" /> Unpin
          </button>
        )}
        {p.onDuplicate && (
          <button className="button ghost" onClick={p.onDuplicate} title="Duplicate (⌘D)">
            <Icon name="copy" /> Duplicate
          </button>
        )}
        <button className="button ghost danger" onClick={p.onDelete} title="Delete (⌫)">
          <Icon name="trash" /> Delete
        </button>
      </footer>
    </aside>
  );
}
