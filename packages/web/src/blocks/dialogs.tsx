// The three dialogs of blocks: its parameters before an insert, "Save as block…", and "Update instances".
import { useMemo, useState } from 'react';
import { lineDiff, type DiagramType } from '@cartography/core';
import { blockText, checkValues, idPrefix, labelChoices, slug, BLOCK_NAME, type Block, type Instance, type LabelChoice, type Selected, type Updated } from '@cartography/blocks';
import { Icon } from '../icon.tsx';
import { useRestoreFocus } from '../menu.tsx';

/** Its parameters, defaults filled in; ↵ inserts. */
export function InsertDialog(p: { block: Block; thumb?: string; where: string; onInsert(values: Record<string, string>): void; onClose(): void }) {
  useRestoreFocus();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(p.block.params.map((x) => [x.name, x.default])));
  const bad = checkValues(p.block, values);
  const ok = !Object.keys(bad).length;
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && ok) (e.preventDefault(), p.onInsert(values));
    else if (e.key === 'Escape') (e.preventDefault(), p.onClose());
  };
  return (
    <div className="overlay" onMouseDown={p.onClose}>
      <div className="palette block-dialog" role="dialog" aria-label={`Insert ${p.block.title}`} onMouseDown={(e) => e.stopPropagation()} onKeyDown={keys}>
        <header className="rename-head">
          <Icon name="boxes" />
          <strong>{p.block.title}</strong>
          <kbd>esc</kbd>
        </header>
        {p.thumb && <div className="block-dialog-thumb" aria-hidden="true" dangerouslySetInnerHTML={{ __html: p.thumb }} />}
        {p.block.description && <p className="block-dialog-text">{p.block.description}</p>}
        <div className="block-fields">
          {p.block.params.map((x, i) => (
            <label key={x.name}>
              <span>
                {x.label ?? x.name} <code>{'${' + x.name + '}'}</code>
              </span>
              <input autoFocus={i === 0} value={values[x.name] ?? ''} onChange={(e) => setValues({ ...values, [x.name]: e.target.value })} onFocus={(e) => e.currentTarget.select()} spellCheck={false} aria-invalid={!!bad[x.name]} aria-label={x.label ?? x.name} />
              {bad[x.name] && <span className="rename-problem">{bad[x.name]}</span>}
            </label>
          ))}
        </div>
        <footer className="rename-actions">
          <span className="block-where">{p.where}</span>
          <button className="button ghost" onClick={p.onClose}>
            Cancel
          </button>
          <button className="button primary" autoFocus={!p.block.params.length} disabled={!ok} onClick={() => p.onInsert(values)}>
            Insert <kbd>↵</kbd>
          </button>
        </footer>
      </div>
    </div>
  );
}

export interface SaveRequest {
  name: string;
  text: string;
  where: 'folder' | 'library';
}

/** "Save as block…": a name, what it is, which labels become parameters (suggested ones ticked), where it goes. */
export function SaveDialog(p: {
  type: DiagramType;
  selected: Selected;
  positions: { nodes: Record<string, { x: number; y: number }>; groups: Record<string, { x: number; y: number }> };
  inFolder: boolean;
  exists(name: string, where: 'folder' | 'library'): boolean;
  onSave(r: SaveRequest): void;
  onClose(): void;
}) {
  useRestoreFocus();
  const prefix = useMemo(() => idPrefix(p.selected.entries.map((e) => e.id)), [p.selected]);
  const choices = useMemo(() => labelChoices(p.selected, prefix), [p.selected, prefix]);
  const first = p.selected.entries.find((e) => e.collection === 'groups') ?? p.selected.entries[0];
  const [title, setTitle] = useState(() => (first && typeof (first.value as { label?: unknown })?.label === 'string' ? String((first.value as { label: string }).label) : (prefix ?? 'My block')));
  const [name, setName] = useState<string>();
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [usePrefix, setUsePrefix] = useState(!!prefix);
  const [picked, setPicked] = useState(() => new Set(choices.filter((c) => c.suggested && !(prefix && c.label.toLowerCase().includes(prefix.toLowerCase()))).map((c) => `${c.collection}\0${c.id}`)));
  const [where, setWhere] = useState<'folder' | 'library'>(p.inFolder ? 'folder' : 'library');
  const fileName = name ?? slug(title);
  const labels: LabelChoice[] = choices.filter((c) => picked.has(`${c.collection}\0${c.id}`));
  const out = useMemo(
    () => blockText(p.type, p.selected, { name: fileName, title: title.trim() || fileName, ...(description.trim() ? { description: description.trim() } : {}), tags: tags.split(',').map((t) => t.trim()).filter(Boolean), ...(usePrefix && prefix ? { prefix } : {}), labels, positions: p.positions }),
    [p.type, p.selected, fileName, title, description, tags, usePrefix, prefix, labels.map((l) => l.id).join()], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const nameOk = BLOCK_NAME.test(fileName);
  const replacing = nameOk && p.exists(fileName, where);
  const save = () => nameOk && p.onSave({ name: fileName, text: out.text, where });
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || (e.target as HTMLElement).tagName === 'INPUT') && (e.target as HTMLInputElement).type !== 'checkbox') (e.preventDefault(), save());
    else if (e.key === 'Escape') (e.preventDefault(), p.onClose());
  };
  const counts = `${p.selected.entries.length} ${p.selected.entries.length === 1 ? 'entry' : 'entries'}, ${p.selected.items.length} ${p.selected.items.length === 1 ? 'line' : 'lines'}`;
  return (
    <div className="overlay" onMouseDown={p.onClose}>
      <div className="palette block-dialog save" role="dialog" aria-label="Save as block" onMouseDown={(e) => e.stopPropagation()} onKeyDown={keys}>
        <header className="rename-head">
          <Icon name="package" />
          <strong>Save as block</strong>
          <span className="block-where">{counts}</span>
          <kbd>esc</kbd>
        </header>
        <div className="block-fields two">
          <label>
            <span>Title</span>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onFocus={(e) => e.currentTarget.select()} aria-label="Title" />
          </label>
          <label>
            <span>File name</span>
            <span className="rename-id">
              <input value={fileName} onChange={(e) => setName(e.target.value)} spellCheck={false} aria-label="File name" aria-invalid={!nameOk} />
              <code>.block.yaml</code>
            </span>
          </label>
          <label className="wide">
            <span>Description</span>
            <input value={description} placeholder="What it is and when to use it" onChange={(e) => setDescription(e.target.value)} aria-label="Description" />
          </label>
          <label className="wide">
            <span>Tags</span>
            <input value={tags} placeholder="network, hub" onChange={(e) => setTags(e.target.value)} aria-label="Tags" />
          </label>
        </div>
        <fieldset className="block-params">
          <legend>Parameters: asked for on every insert</legend>
          {prefix && (
            <label className="check">
              <input type="checkbox" checked={usePrefix} onChange={(e) => setUsePrefix(e.target.checked)} />
              <span>
                Ids start with <code>{prefix}</code>: make it <code>{'${name}'}</code>
              </span>
              <span className="block-suggested">suggested</span>
            </label>
          )}
          {choices.map((c) => {
            const k = `${c.collection}\0${c.id}`;
            return (
              <label key={k} className="check">
                <input type="checkbox" checked={picked.has(k)} onChange={(e) => setPicked((s) => (e.target.checked ? new Set([...s, k]) : new Set([...s].filter((x) => x !== k))))} />
                <span>
                  {c.label} <code>{'${' + c.param + '}'}</code>
                </span>
                {c.suggested && <span className="block-suggested">suggested</span>}
              </label>
            );
          })}
          {!prefix && !choices.length && <p className="block-dialog-text">No labels to ask for: the block goes in as it is.</p>}
        </fieldset>
        {p.selected.cut.length > 0 && <p className="block-dialog-text">Left out, it points outside the block: {p.selected.cut.join(', ')}</p>}
        <footer className="rename-actions">
          {p.inFolder ? (
            <div className="segmented" role="radiogroup" aria-label="Where">
              <button role="radio" aria-checked={where === 'folder'} className={where === 'folder' ? 'active' : ''} onClick={() => setWhere('folder')}>
                This folder (blocks/)
              </button>
              <button role="radio" aria-checked={where === 'library'} className={where === 'library' ? 'active' : ''} onClick={() => setWhere('library')}>
                My library
              </button>
            </div>
          ) : (
            <span className="block-where">Into your library in this browser (open a folder to keep blocks with a project)</span>
          )}
          <button className="button ghost" onClick={p.onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={!nameOk} onClick={save}>
            {replacing ? 'Replace' : 'Save'} <kbd>↵</kbd>
          </button>
        </footer>
      </div>
    </div>
  );
}

export interface UpdatePlan {
  instance: Instance;
  block: Block;
  result: Updated | { error: string };
  before: string;
}

/** Each instance older than its block, with what updating it would change; ↵ updates the ticked ones. */
export function UpdateDialog(p: { plans: UpdatePlan[]; onApply(picked: UpdatePlan[]): void; onClose(): void }) {
  useRestoreFocus();
  const [picked, setPicked] = useState(() => new Set(p.plans.filter((x) => !('error' in x.result)).map((x) => `${x.instance.block}#${x.instance.no}`)));
  const chosen = p.plans.filter((x) => picked.has(`${x.instance.block}#${x.instance.no}`));
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && chosen.length && (e.target as HTMLInputElement).type !== 'checkbox') (e.preventDefault(), p.onApply(chosen));
    else if (e.key === 'Escape') (e.preventDefault(), p.onClose());
  };
  return (
    <div className="overlay" onMouseDown={p.onClose}>
      <div className="palette block-dialog update" role="dialog" aria-label="Update instances" onMouseDown={(e) => e.stopPropagation()} onKeyDown={keys} tabIndex={-1}>
        <header className="rename-head">
          <Icon name="refresh-cw" />
          <strong>Update instances</strong>
          <span className="block-where">Their entries become the block's, with the same parameters; lines you drew to them stay</span>
          <kbd>esc</kbd>
        </header>
        <div className="rename-diff">
          {p.plans.map((x) => {
            const k = `${x.instance.block}#${x.instance.no}`;
            const r = x.result;
            return (
              <section key={k} className="rename-file block-instance">
                <h4>
                  <input type="checkbox" disabled={'error' in r} checked={picked.has(k)} onChange={(e) => setPicked((s) => (e.target.checked ? new Set([...s, k]) : new Set([...s].filter((y) => y !== k))))} aria-label={`Update ${x.block.title} #${x.instance.no}`} />
                  {x.block.title} #{x.instance.no}
                  <span>
                    {Object.entries(x.instance.params).map(([a, b]) => `${a}=${b}`).join(' ')} · {x.instance.hash} → {x.block.hash}
                  </span>
                </h4>
                {'error' in r ? (
                  <p className="rename-problem">{r.error}</p>
                ) : (
                  <>
                    {(r.added.length > 0 || r.removed.length > 0 || r.dangling > 0) && (
                      <p className="block-dialog-text">
                        {r.added.length > 0 && <>New: {r.added.join(', ')}. </>}
                        {r.removed.length > 0 && <>Gone: {r.removed.join(', ')}. </>}
                        {r.dangling > 0 && <>{r.dangling} {r.dangling === 1 ? 'line of yours points' : 'lines of yours point'} at what goes: mend {r.dangling === 1 ? 'it' : 'them'} after.</>}
                      </p>
                    )}
                    {lineDiff(x.before, r.text).map((hunk, i) => (
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
                  </>
                )}
              </section>
            );
          })}
        </div>
        <footer className="rename-actions">
          <button className="button ghost" onClick={p.onClose}>
            Cancel
          </button>
          <button className="button primary" autoFocus disabled={!chosen.length} onClick={() => p.onApply(chosen)}>
            Update {chosen.length} <kbd>↵</kbd>
          </button>
        </footer>
      </div>
    </div>
  );
}

