// Review notes in the editor: the Notes panel (threads, filters, replies, resolve) and the numbered
// markers on the drawing. A marker is a speech bubble with a number, so it reads without colour; an
// unread one also carries a dot and says so to a screen reader.
import { useEffect, useRef, useState } from 'react';
import { anchorLabel, noteBlocks, noteNumbers, notesInView, resolveAnchor, type Graph, type NoteAnchor, type NoteThread } from '@cartography/core';
import { noteSpots, type NoteSpot, type RenderResult } from '@cartography/engine';
import { Icon } from './icon.tsx';
import type { Review } from './notes-state.ts';
import { t as tr } from './i18n/index.ts';

export type NoteFilter = 'open' | 'resolved' | 'all';

/** What a thread is about in this drawing, and whether it is still there. */
export function aboutOf(t: NoteThread, graph: Graph | undefined, view?: string): { text: string; orphaned: boolean; elsewhere?: boolean; target?: { kind: 'node' | 'group' | 'edge'; id: string } } {
  if (!graph) return { text: anchorLabel(t.anchor), orphaned: false };
  const r = resolveAnchor(t.anchor, graph);
  // In a view, an element that is not drawn may well be in the diagram: only the view leaves it out.
  if (r.state === 'orphaned') return { text: r.was, orphaned: true, elsewhere: !!view && !t.view };
  if (r.state === 'point') return { text: tr('A point on the canvas'), orphaned: false };
  return { text: anchorLabel(r.anchor, graph), orphaned: false, target: { kind: r.kind, id: r.id } };
}

/** The simple markdown of a note: paragraphs, list items, bold, italic, code and links. */
export function NoteText({ text }: { text: string }) {
  const blocks = noteBlocks(text);
  const out: React.ReactNode[] = [];
  let list: React.ReactNode[] = [];
  const flush = () => {
    if (list.length) out.push(<ul key={`l${out.length}`}>{list}</ul>);
    list = [];
  };
  for (const [i, b] of blocks.entries()) {
    const parts = b.parts.map((p, j) => {
      const inner = p.code ? <code key={j}>{p.text}</code> : p.bold ? <strong key={j}>{p.text}</strong> : p.italic ? <em key={j}>{p.text}</em> : <span key={j}>{p.text}</span>;
      return p.href ? (
        <a key={j} href={p.href} target="_blank" rel="noreferrer noopener">
          {inner}
        </a>
      ) : (
        inner
      );
    });
    if (b.list) list.push(<li key={i}>{parts}</li>);
    else {
      flush();
      out.push(<p key={i}>{parts}</p>);
    }
  }
  flush();
  return <div className="note-text">{out}</div>;
}

const when = (iso: string) => {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (Number.isNaN(mins)) return '';
  if (mins < 1) return tr('just now');
  if (mins < 60) return tr('{count} min ago', { count: mins });
  if (mins < 60 * 24) return tr('{count} h ago', { count: Math.round(mins / 60) });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
};

/** A text box that sends with ⌘↩ (or Ctrl↩) and cancels with Esc; no key reaches the drawing. */
function Composer(p: { label: string; initial?: string; placeholder: string; send: string; autoFocus?: boolean; onSend(text: string): void; onCancel?(): void }) {
  const [text, setText] = useState(p.initial ?? '');
  const go = () => text.trim() && (p.onSend(text), setText(''));
  return (
    <div className="note-composer">
      <textarea
        aria-label={p.label}
        placeholder={p.placeholder}
        value={text}
        autoFocus={p.autoFocus}
        rows={Math.min(8, Math.max(2, text.split('\n').length))}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            go();
          } else if (e.key === 'Escape' && p.onCancel) {
            e.preventDefault();
            p.onCancel();
          }
        }}
      />
      <div className="note-composer-actions">
        <span className="fine">{tr('**bold**, *italic*, `code`, - lists')}</span>
        {p.onCancel && (
          <button className="button ghost small" onClick={p.onCancel}>
            {tr('Cancel')}
          </button>
        )}
        <button className="button primary small" onClick={go} disabled={!text.trim()} title={`${p.send} (⌘↩)`}>
          {p.send}
        </button>
      </div>
    </div>
  );
}

export interface NotesPanelProps {
  review: Review;
  graph?: Graph;
  view?: string;
  filter: NoteFilter;
  onFilter(f: NoteFilter): void;
  mine: boolean;
  onMine(on: boolean): void;
  reviewMode: boolean;
  onReviewMode(on: boolean): void;
  withExports: boolean;
  onWithExports(on: boolean): void;
  /** A note being written, on this anchor. */
  draft?: { anchor: NoteAnchor; about: string };
  onDraftDone(): void;
  /** The thread opened from a marker: scrolled to and outlined. */
  active?: string;
  onActive(id: string | undefined): void;
  /** Selects what a thread is about and brings it into view. */
  onGo(target: { kind: 'node' | 'group' | 'edge'; id: string } | { point: { x: number; y: number } }): void;
  /** The selection, to hang an orphaned thread on (undefined: nothing selected). */
  selectionAnchor?: { anchor: NoteAnchor; about: string };
  onClose(): void;
}

export function NotesPanel(p: NotesPanelProps) {
  const { review } = p;
  const numbers = noteNumbers(review.notes);
  const inView = notesInView(review.notes, p.view);
  const shown = inView
    .filter((t) => (p.filter === 'all' ? true : t.status === p.filter))
    .filter((t) => !p.mine || t.author === review.author || t.replies?.some((r) => r.author === review.author))
    .sort((a, b) => numbers.get(a.id)! - numbers.get(b.id)!);
  const open = inView.filter((t) => t.status === 'open').length;
  const unread = inView.filter((t) => review.unread(t)).length;
  const [name, setName] = useState('');
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!p.active) return;
    list.current?.querySelector(`[data-thread="${p.active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [p.active]);

  return (
    <aside className="inspector notes-panel" aria-label={tr('Notes')}>
      <header>
        <span className="inspector-icon">
          <Icon name="message-square" />
        </span>
        <div className="inspector-title">
          <strong>{tr('Notes')}</strong>
          <span>
            {tr('{count} open', { count: open })}{inView.length - open ? tr(', {count} resolved', { count: inView.length - open }) : ''}
            {unread ? tr(', {count} unread', { count: unread }) : ''}
          </span>
        </div>
        <button className="icon-button" onClick={p.onClose} aria-label={tr('Close notes')} title={tr('Close (⇧N)')}>
          <Icon name="x" />
        </button>
      </header>
      <div className="notes-tools">
        <div className="segmented" role="radiogroup" aria-label={tr('Show')}>
          {(['open', 'resolved', 'all'] as const).map((f) => (
            <button key={f} role="radio" aria-checked={p.filter === f} className={p.filter === f ? 'active' : ''} onClick={() => p.onFilter(f)}>
              {f === 'open' ? tr('Open@state') : f === 'resolved' ? tr('Resolved') : tr('All')}
            </button>
          ))}
        </div>
        <button className={p.mine ? 'chip active' : 'chip'} aria-pressed={p.mine} onClick={() => p.onMine(!p.mine)} title={tr('Only threads I wrote or replied to')}>
          <Icon name="user" size={13} /> {tr('Mine')}
        </button>
        <button className={p.reviewMode ? 'chip active' : 'chip'} aria-pressed={p.reviewMode} onClick={() => p.onReviewMode(!p.reviewMode)} title={tr('Review mode: only the notes stand out (⇧R)')}>
          <Icon name="eye" size={13} /> {tr('Review')}
        </button>
      </div>
      <div className="notes-body" ref={list}>
        {!review.author && (
          <form
            className="note-name"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) review.setAuthor(name);
            }}
          >
            <label htmlFor="note-author">{tr('Your name, shown on your notes')}</label>
            <div>
              <input id="note-author" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={tr('e.g. Misja')} autoFocus={!!p.draft} />
              <button className="button primary small" disabled={!name.trim()}>
                {tr('Set')}
              </button>
            </div>
          </form>
        )}
        {p.draft && review.author && (
          <div className="note-thread drafting">
            <div className="note-about">
              <Icon name="map-pin" size={13} /> {p.draft.about}
            </div>
            <Composer
              label={tr('Note on {about}', { about: p.draft.about })}
              placeholder={tr('Write a note…')}
              send={tr('Add note')}
              autoFocus
              onSend={(text) => {
                const t = review.add(p.draft!.anchor, text, p.draft!.anchor.kind === 'point' ? p.view : undefined);
                p.onDraftDone();
                p.onActive(t.id);
              }}
              onCancel={p.onDraftDone}
            />
          </div>
        )}
        {!shown.length && !p.draft && (
          <p className="notes-empty">
            {inView.length ? tr('Nothing here with this filter.') : tr('No notes yet. Select an element or a line and press N, or right-click the drawing.')}
          </p>
        )}
        {shown.map((t) => (
          <Thread key={t.id} {...p} t={t} n={numbers.get(t.id)!} />
        ))}
      </div>
      <footer className="notes-footer">
        <label>
          <input type="checkbox" checked={p.withExports} onChange={(e) => p.onWithExports(e.target.checked)} /> {tr('Exports include review notes')}
        </label>
      </footer>
    </aside>
  );
}

function Thread(p: NotesPanelProps & { t: NoteThread; n: number }) {
  const { review, t } = p;
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState<string | true>();
  const about = aboutOf(t, p.graph, p.view);
  const unread = review.unread(t);
  const mine = (author: string) => !!review.author && author === review.author;
  const open = () => {
    p.onActive(t.id);
    if (unread) review.seen([t.id]);
  };
  const go = () => {
    open();
    if (about.target) p.onGo(about.target);
    else if (t.anchor.kind === 'point') p.onGo({ point: { x: t.anchor.x, y: t.anchor.y } });
  };
  return (
    <article
      className={`note-thread${p.active === t.id ? ' active' : ''}${t.status === 'resolved' ? ' resolved' : ''}${unread ? ' unread' : ''}`}
      data-thread={t.id}
      aria-label={tr('Note {n}{state}, on {about}', { n: p.n, state: `${unread ? tr(', unread') : ''}${t.status === 'resolved' ? tr(', resolved') : ''}`, about: about.text })}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('button, a, textarea, input')) go();
      }}
    >
      <div className="note-about">
        <span className={`note-bubble${t.status === 'resolved' ? ' hollow' : ''}`} aria-hidden="true">
          {p.n}
        </span>
        <button className="note-go" onClick={go} title={about.elsewhere ? tr('Not drawn in this view') : about.orphaned ? tr('No longer in the diagram') : tr('Select it in the drawing')} disabled={about.orphaned}>
          {about.text}
        </button>
        {about.orphaned && <span className="note-tag">{about.elsewhere ? tr('not in this view') : tr('gone')}</span>}
        {t.status === 'resolved' && <span className="note-tag">{tr('resolved')}</span>}
        {unread && <span className="note-unread" title={tr('New since you last opened it')} aria-label={tr('unread')} />}
      </div>
      {[t, ...(t.replies ?? [])].map((c, i) => (
        <div className={i ? 'note-entry reply' : 'note-entry'} key={c.id}>
          <div className="note-meta">
            <strong>{c.author || tr('someone')}</strong> <span title={c.created}>{when(c.created)}</span>
            {c.edited && <span> · {tr('edited')}</span>}
            {mine(c.author) && editing !== (i ? c.id : true) && (
              <span className="note-own">
                <button onClick={() => setEditing(i ? c.id : true)}>{tr('Edit')}</button>
                {(i || !t.replies?.length) && (
                  <button onClick={() => (i ? review.remove(t.id, c.id) : window.confirm(tr('Delete this note?')) && review.remove(t.id))} aria-label={i ? tr('Delete reply') : tr('Delete note')}>
                    {tr('Delete')}
                  </button>
                )}
              </span>
            )}
          </div>
          {editing === (i ? c.id : true) ? (
            <Composer
              label={tr('Edit note')}
              placeholder=""
              initial={c.text}
              send={tr('Save')}
              autoFocus
              onSend={(text) => {
                review.edit(t.id, text, i ? c.id : undefined);
                setEditing(undefined);
              }}
              onCancel={() => setEditing(undefined)}
            />
          ) : (
            <NoteText text={c.text} />
          )}
        </div>
      ))}
      {replying && review.author ? (
        <Composer
          label={tr('Reply to note {n}', { n: p.n })}
          placeholder={tr('Reply…')}
          send={tr('Reply')}
          autoFocus
          onSend={(text) => {
            review.reply(t.id, text);
            review.seen([t.id]);
            setReplying(false);
          }}
          onCancel={() => setReplying(false)}
        />
      ) : (
        <div className="note-actions">
          <button className="button ghost small" onClick={() => (open(), setReplying(true))} disabled={!review.author} title={review.author ? undefined : tr('Set your name first')}>
            {tr('Reply')}
          </button>
          {t.status === 'open' ? (
            <button className="button ghost small" onClick={() => (review.setStatus(t.id, 'resolved'), review.seen([t.id]))}>
              <Icon name="check" size={14} /> {tr('Resolve')}
            </button>
          ) : (
            <button className="button ghost small" onClick={() => review.setStatus(t.id, 'open')}>
              <Icon name="undo-2" size={14} /> {tr('Reopen')}
            </button>
          )}
          {about.orphaned && !about.elsewhere && p.selectionAnchor && (
            <button className="button ghost small" onClick={() => review.reattach(t.id, p.selectionAnchor!.anchor)} title={tr('Hang it on {about}', { about: p.selectionAnchor.about })}>
              <Icon name="map-pin" size={14} /> {tr('Attach to {about}', { about: p.selectionAnchor.about })}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

/** The markers on the drawing, in stage coordinates; they keep their size whatever the zoom. */
export function NoteMarkers(p: { result?: RenderResult; review: Review; filter: NoteFilter; scale: number; active?: string; onOpen(id: string): void }) {
  const r = p.result;
  if (!r?.graph || !r.placed) return null;
  const o = r.origin ?? { x: 0, y: 0 };
  const spots: NoteSpot[] = noteSpots(p.review.notes, r.graph, r.placed, r.view, { resolved: p.filter !== 'open' }).filter((s) => p.filter === 'all' || s.thread.status === (p.filter === 'resolved' ? 'resolved' : 'open'));
  return (
    <>
      {spots.map((s) => {
        const unread = p.review.unread(s.thread);
        const resolved = s.thread.status === 'resolved';
        return (
          <button
            key={s.thread.id}
            className={`note-marker${resolved ? ' hollow' : ''}${unread ? ' unread' : ''}${p.active === s.thread.id ? ' active' : ''}`}
            data-note={s.n}
            style={{ left: s.at.x + o.x, top: s.at.y + o.y, transform: `scale(${1 / p.scale})` }}
            aria-label={tr('Note {n} on {about}{state}', { n: s.n, about: s.about, state: `${unread ? tr(', unread') : ''}${resolved ? tr(', resolved') : ''}` })}
            title={`${s.n}. ${s.about}: ${s.thread.text.slice(0, 80)}`}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              p.onOpen(s.thread.id);
            }}
          >
            {s.n}
          </button>
        );
      })}
    </>
  );
}
