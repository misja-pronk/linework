// What a session shows besides the sheet: a line top left (what this is, how to leave), one strip at the
// bottom, a small menu over the selection, the sketch hint under it, and at the end "What changed".
import './session.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphGroup, PaletteItem } from '@cartography/core';
import type { LayoutSidecar } from '@cartography/core';
import { compare, explain, explainText, type Comparison, type Explained } from '@cartography/diff';
import { Icon } from './icon.tsx';
import { useModal } from './menu.tsx';
import { t } from './i18n/index.ts';
import { matchKinds } from './sketch.ts';
import type { ScreenRect } from './preview.tsx';

/** "Session · Web shop", and how to leave, top left. */
export function SessionHeader({ title }: { title: string }) {
  return (
    <div className="session-head" aria-live="polite">
      <span className="session-title">
        {t('Session')} · <strong>{title}</strong>
      </span>
      <span className="session-leave">{t('esc leaves session')}</span>
    </div>
  );
}

interface StripProps {
  onAdd(): void;
  canGroup: boolean;
  onGroup(): void;
  steps: number;
  step: number | undefined;
  onStep(dir: 1 | -1): void;
  onUndo(): void;
  onEnd(): void;
}

/** The one strip at the bottom: add, group, the steps, undo, end. */
export function SessionStrip(p: StripProps) {
  const keep = (e: React.PointerEvent) => e.stopPropagation();
  return (
    <div className="session-strip" role="toolbar" aria-label={t('Session')} onPointerDown={keep} onPointerUp={keep}>
      <button onClick={p.onAdd} title={t('Add a box (Tab adds one connected to the selection)')}>
        <Icon name="plus" size={14} /> {t('Add')} <kbd>Tab</kbd>
      </button>
      <button onClick={p.onGroup} disabled={!p.canGroup} title={t('Put the selected boxes in a group (⌘G)')}>
        <Icon name="square-dashed" size={14} /> {t('Group')}
      </button>
      {p.steps > 0 && (
        <span className="session-steps">
          <button onClick={() => p.onStep(-1)} aria-label={t('Previous step')}>
            <Icon name="arrow-left" size={14} />
          </button>
          <span className="session-step-no" aria-live="polite">
            {p.step ? t('Step {n}/{m}', { n: p.step, m: p.steps }) : t('All steps')}
          </span>
          <button onClick={() => p.onStep(1)} aria-label={t('Next step')}>
            <Icon name="arrow-right" size={14} />
          </button>
        </span>
      )}
      <span className="session-gap" />
      <button onClick={p.onUndo} aria-label={t('Undo')} title={t('Undo (⌘Z)')}>
        <Icon name="undo-2" size={14} />
      </button>
      <button className="session-end" onClick={p.onEnd}>
        {t('End session')}
      </button>
    </div>
  );
}

interface MenuProps {
  rect: ScreenRect;
  /** One box selected (kind and connect are for one); otherwise only group and delete. */
  single: boolean;
  kinds: readonly PaletteItem[];
  kind?: string;
  groups: GraphGroup[];
  canGroup: boolean;
  onKind(item: PaletteItem): void;
  onGroup(into?: string): void;
  onConnect(): void;
  onDelete(): void;
}

/** A small menu over the selection: what it is, into a group, connect, delete. */
export function SelectionMenu(p: MenuProps) {
  const [open, setOpen] = useState<'kind' | 'group'>();
  const keep = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();
  const current = p.kinds.find((k) => k.kind === p.kind);
  return (
    <div
      className="sel-menu"
      role="toolbar"
      aria-label={t('Selection')}
      style={{ left: p.rect.left + p.rect.width / 2, top: Math.max(8, p.rect.top - 10) }}
      onPointerDown={keep}
      onPointerUp={keep}
      onDoubleClick={keep}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          setOpen(undefined);
          (document.querySelector('.preview') as HTMLElement | null)?.focus();
        }
      }}
    >
      {p.single && p.kinds.length > 0 && (
        <button aria-expanded={open === 'kind'} aria-haspopup="listbox" onClick={() => setOpen((o) => (o === 'kind' ? undefined : 'kind'))}>
          {current ? <Icon name={current.icon} size={14} /> : null} {current?.label ?? t('Kind')} <Icon name="chevron-down" size={12} />
        </button>
      )}
      {p.canGroup && (
        <button aria-expanded={open === 'group'} aria-haspopup="menu" onClick={() => setOpen((o) => (o === 'group' ? undefined : 'group'))}>
          {t('Group into…')}
        </button>
      )}
      {p.single && <button onClick={p.onConnect}>{t('Connect')}</button>}
      <button onClick={p.onDelete} aria-label={t('Delete')}>
        <Icon name="trash" size={14} />
      </button>
      {open === 'kind' && <KindPicker kinds={p.kinds} onPick={(k) => (setOpen(undefined), p.onKind(k))} onClose={() => setOpen(undefined)} />}
      {open === 'group' && (
        <div className="sel-pop" role="menu">
          <button role="menuitem" autoFocus onClick={() => (setOpen(undefined), p.onGroup())}>
            <Icon name="plus" size={14} /> {t('New group')}
          </button>
          {p.groups.map((g) => (
            <button role="menuitem" key={g.id} onClick={() => (setOpen(undefined), p.onGroup(g.id))}>
              {g.label || g.id}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Kinds to pick from, narrowed by typing. */
function KindPicker({ kinds, onPick, onClose }: { kinds: readonly PaletteItem[]; onPick(k: PaletteItem): void; onClose(): void }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const list = useMemo(() => (q.trim() ? matchKinds(q, kinds, 12) : kinds.slice(0, 40)), [q, kinds]);
  return (
    <div className="sel-pop kind-pop">
      <input
        autoFocus
        value={q}
        placeholder={t('Kind…')}
        aria-label={t('Kind')}
        onChange={(e) => (setQ(e.target.value), setI(0))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setI((n) => Math.min(list.length - 1, n + 1));
          else if (e.key === 'ArrowUp') setI((n) => Math.max(0, n - 1));
          else if (e.key === 'Enter' && list[i]) onPick(list[i]);
          else if (e.key === 'Escape') onClose();
          else return;
          e.preventDefault();
        }}
      />
      <ul role="listbox" aria-label={t('Kind')}>
        {list.map((k, n) => (
          <li key={k.collection + k.kind} role="option" aria-selected={n === i} onPointerDown={(e) => (e.preventDefault(), onPick(k))}>
            <Icon name={k.icon} size={14} /> {k.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Under the selection while sketching, the first few sessions only. */
export function SketchHint({ rect, naming }: { rect: ScreenRect; naming: boolean }) {
  // Under the selection, or over it when the strip at the bottom would cover it (over the menu when that is there).
  const below = rect.top + rect.height + (naming ? 44 : 12);
  const top = below + 120 > window.innerHeight ? rect.top - (naming ? 34 : 76) : below;
  return (
    <div className="sketch-hint" role="note" style={{ left: rect.left + rect.width / 2, top }}>
      {naming ? (
        <>
          <kbd>↵</kbd> {t('keeps the name')} · <kbd>Tab</kbd> {t('adds a connected box')} · <kbd>fw:</kbd> {t('picks a kind')} · <kbd>Esc</kbd> {t('undo')}
        </>
      ) : (
        <>
          <kbd>Tab</kbd> {t('adds a connected box')} · <kbd>↵</kbd> {t('adds a sibling')} · {t('type to rename')} · <kbd>Esc</kbd> {t('undo')}
        </>
      )}
    </div>
  );
}

interface EndProps {
  before: { text: string; pins?: LayoutSidecar };
  after: { text: string; pins?: LayoutSidecar };
  load?: (file: string) => string;
  title: string;
  onShow(): void;
  onClose(): void;
  notify(message: string): void;
}

/** "What changed" in this session, in plain sentences, with the way to the marked-up drawing. */
export function SessionEnd(p: EndProps) {
  const modal = useModal();
  const [cmp, setCmp] = useState<Comparison>();
  const [failed, setFailed] = useState(false);
  const show = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let live = true;
    const load = p.load ? { load: p.load } : {};
    compare(p.before.text, p.after.text, { before: { ...load, ...(p.before.pins ? { sidecar: p.before.pins } : {}) }, after: { ...load, ...(p.after.pins ? { sidecar: p.after.pins } : {}) } })
      .then((c) => live && setCmp(c))
      .catch(() => live && setFailed(true));
    return () => void (live = false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the two versions of this dialog, once
  }, []);
  const told = useMemo<Explained[]>(() => (cmp ? explain(cmp.diff, cmp.before?.graph, cmp.after?.graph) : []), [cmp]);
  useEffect(() => {
    if (cmp) show.current?.focus();
  }, [cmp]);
  const copy = async () => {
    if (!cmp) return;
    await navigator.clipboard.writeText(`${t('What changed in {title}', { title: p.title })}\n\n${explainText(cmp.diff, cmp.before?.graph, cmp.after?.graph)}\n`);
    p.notify(t('Copied what changed'));
  };
  return (
    <div className="session-end-back" onPointerDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="session-end-dialog" role="dialog" aria-modal="true" aria-labelledby="session-end-title" ref={modal} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), p.onClose())}>
        <h2 id="session-end-title">{t('What changed')}</h2>
        <p className="session-end-sub">{t('In this session, on {title}', { title: p.title })}</p>
        {!cmp && !failed && <p className="session-end-wait">{t('Comparing…')}</p>}
        {failed && <p>{t('The two versions could not be compared')}</p>}
        {cmp && (
          <ol className="session-changes">
            {told.length ? told.map((x, i) => <li key={i} className={x.item ? `is-${x.item.status}` : undefined}>{x.text}</li>) : <li>{t('Nothing that shows in the drawing changed')}</li>}
          </ol>
        )}
        <div className="session-end-row">
          <button className="session-quiet" onClick={() => void copy()} disabled={!cmp}>
            {t('Copy as text')}
          </button>
          <span className="session-gap" />
          <button className="session-quiet" onClick={p.onClose}>
            {t('Close')}
          </button>
          <button ref={show} className="session-primary" onClick={p.onShow} disabled={!cmp}>
            {t('Show on the drawing')}
          </button>
        </div>
      </div>
    </div>
  );
}
