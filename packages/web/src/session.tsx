// What a session shows besides the sheet: a line top left (what this is), one strip at the
// bottom (with the keys over it in the first few sessions), a small menu at the selection, and at the end
// "What changed".
import './session.css';
import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GraphGroup, PaletteItem } from '@cartography/core';
import type { LayoutSidecar } from '@cartography/core';
import { compare, explain, explainText, type Comparison, type Explained } from '@cartography/diff';
import { Icon } from './icon.tsx';
import { BrandMark } from './brand-mark.tsx';
import { useModal } from './menu.tsx';
import { t } from './i18n/index.ts';
import { matchKinds } from './sketch.ts';
import { comboLabel } from './keys.ts';
import type { ScreenRect } from './preview.tsx';

/** "Session · Web shop" along the top. The way out is End session in the strip: Esc never leaves, it only lets go. */
export function SessionHeader({ title }: { title: string }) {
  return (
    <div className="session-head" aria-live="polite">
      <BrandMark size="sm" />
      <span className="session-title">
        <span className="session-caps">{t('Session')}</span>
        <span className="session-sep" aria-hidden="true">
          {' · '}
        </span>
        <span className="session-name">{title}</span>
      </span>
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

/** The one strip at the bottom: add, group, the steps, undo, end; ruled apart like a plate's legend. */
export function SessionStrip(p: StripProps) {
  const keep = (e: React.PointerEvent) => e.stopPropagation();
  return (
    <div className="session-strip" role="toolbar" aria-label={t('Session')} onPointerDown={keep} onPointerUp={keep}>
      <button onClick={p.onAdd} title={t('Add a box (Tab adds one connected to the selection)')}>
        <Icon name="plus" size={15} /> {t('Add')} <kbd>Tab</kbd>
      </button>
      <i className="session-rule" />
      <button onClick={p.onGroup} disabled={!p.canGroup} title={t('Put the selected boxes in a group (⌘G)')}>
        <Icon name="square-dashed" size={15} /> {t('Group')} <kbd>{comboLabel('mod+g')}</kbd>
      </button>
      {p.steps > 0 && (
        <>
          <i className="session-rule" />
          <span className="session-steps">
            <button onClick={() => p.onStep(-1)} aria-label={t('Previous step')}>
              <Icon name="arrow-left" size={15} />
            </button>
            <span className="session-step-no" aria-live="polite">
              {p.step ? t('Step {n}/{m}', { n: p.step, m: p.steps }) : t('All steps')}
            </span>
            <button onClick={() => p.onStep(1)} aria-label={t('Next step')}>
              <Icon name="arrow-right" size={15} />
            </button>
          </span>
        </>
      )}
      <i className="session-rule" />
      <button onClick={p.onUndo} aria-label={t('Undo')} title={t('Undo (⌘Z)')}>
        <Icon name="undo-2" size={15} />
      </button>
      <i className="session-rule" />
      <button
        className="session-end"
        onClick={p.onEnd}
        title={t('Back to the editor, with what changed')}
        onKeyDown={(e) => e.key === 'Escape' && (document.querySelector('.preview') as HTMLElement | null)?.focus({ preventScroll: true })}
      >
        {t('End session')}
      </button>
    </div>
  );
}

interface MenuProps {
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

/** A small menu at the selection: what it is, into a group, connect, delete. Placed by SelectionFloats. */
const SelectionMenu = forwardRef<HTMLDivElement, MenuProps>(function SelectionMenu(p, ref) {
  const [open, setOpen] = useState<'kind' | 'group'>();
  const keep = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();
  const current = p.kinds.find((k) => k.kind === p.kind);
  return (
    <div
      className="sel-menu"
      role="toolbar"
      aria-label={t('Selection')}
      ref={ref}
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
        <button className="sel-kind" aria-expanded={open === 'kind'} aria-haspopup="listbox" onClick={() => setOpen((o) => (o === 'kind' ? undefined : 'kind'))}>
          {current ? <Icon name={current.icon} size={15} /> : null} {current?.label ?? t('Kind')} <Icon name="chevron-down" size={12} />
        </button>
      )}
      {p.canGroup && (
        <button aria-expanded={open === 'group'} aria-haspopup="menu" onClick={() => setOpen((o) => (o === 'group' ? undefined : 'group'))}>
          {t('Group into…')}
        </button>
      )}
      {p.single && <button onClick={p.onConnect}>{t('Connect')}</button>}
      <button onClick={p.onDelete} aria-label={t('Delete')}>
        <Icon name="trash" size={15} />
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
});

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

/** Over the strip while sketching, the first few sessions only: the keys, each with what it does. */
export function SketchKeys({ naming, selected }: { naming: boolean; selected: boolean }) {
  return (
    <p className="session-keys" role="note">
      {naming ? (
        <>
          <span>
            <kbd>↵</kbd> {t('keeps the name')}
          </span>
          <span>
            <kbd>Tab</kbd> {t('adds a connected box')}
          </span>
          <span>
            <kbd>fw:</kbd> {t('picks a kind')}
          </span>
          <span>
            <kbd>Esc</kbd> {t('cancels')}
          </span>
        </>
      ) : selected ? (
        <>
          <span>
            <kbd>Tab</kbd> {t('adds a connected box')}
          </span>
          <span>
            <kbd>↵</kbd> {t('adds a sibling')}
          </span>
          <span>{t('type to rename')}</span>
          <span>
            <kbd>Esc</kbd> {t('deselects')}
          </span>
        </>
      ) : (
        <>
          <span>{t('type to add a box')}</span>
          <span>
            <kbd>Tab</kbd> {t('adds a box')}
          </span>
          <span>{t('click a box to select it')}</span>
        </>
      )}
    </p>
  );
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
const MARGIN = 8;
/** Room between the selection's box and what floats at it: clear of the ring and its callout. */
const GAP = 16;

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));

/** What is on screen that a floating thing should not cover, in client pixels. */
interface Obstacles {
  /** Boxes and labels of the drawing, the session's own chrome, the name being typed; with how much hiding each wholly costs. */
  boxes: { b: Box; w: number }[];
  /** Points along the lines, every few pixels: a line is thin, its box would say little. */
  points: { x: number; y: number }[];
}

function obstacles(own: Element[]): Obstacles {
  const box = (r: DOMRect): Box => ({ left: r.left, top: r.top, width: r.width, height: r.height });
  const boxes: Obstacles['boxes'] = [];
  for (const el of document.querySelectorAll('.drawing [data-node]')) boxes.push({ b: box(el.getBoundingClientRect()), w: 4 });
  // Every word on the sheet: line labels, group headers, the title, the key.
  for (const el of document.querySelectorAll('.drawing svg text')) if (!el.closest('[data-node]')) boxes.push({ b: box(el.getBoundingClientRect()), w: 3 });
  for (const el of document.querySelectorAll('.session-strip, .session-keys, .session-head > *, .label-editor, .kind-list')) if (!own.some((o) => o.contains(el))) boxes.push({ b: box(el.getBoundingClientRect()), w: 8 });
  const points: Obstacles['points'] = [];
  for (const g of document.querySelectorAll('.drawing [data-edge]')) {
    const path = g.querySelector('path');
    const m = path?.getScreenCTM();
    if (!path || !m) continue;
    const len = path.getTotalLength();
    const step = Math.max(2, 6 / Math.max(0.05, Math.hypot(m.a, m.b)));
    for (let d = 0; d <= len; d += step) {
      const q = path.getPointAtLength(d);
      points.push({ x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f });
    }
  }
  return { boxes, points };
}

/** How much a box on screen (client pixels) would hide: of each shape and label, the part it covers (a label half hidden is half as bad as one wholly hidden, however small it is); a few tenths for a line across it. */
function crowding(b: Box, o: Obstacles): number {
  const area = b.width * b.height;
  let sum = 0;
  for (const x of o.boxes) {
    const own = x.b.width * x.b.height;
    if (own > 0) sum += (x.w * overlap(b, x.b)) / own;
  }
  // A margin round the box: a line just past its edge reads as running into it.
  let hits = 0;
  for (const q of o.points) if (q.x > b.left - 4 && q.x < b.left + b.width + 4 && q.y > b.top - 4 && q.y < b.top + b.height + 4) hits++;
  sum += hits * 0.08;
  // Out of the window: as bad as over a shape.
  const inView = overlap(b, { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
  return sum + (8 * (area - inView)) / area;
}


interface FloatsProps {
  /** The selection's box, in pixels from the pane's top left. */
  rect: ScreenRect;
  menu: MenuProps;
}

type Side = 'above' | 'below' | 'right' | 'left';

/**
 * The menu at the selection, on the side where it hides the least of the drawing: above it by
 * preference, else below, right or left of it. It stays inside the pane and the window, moved along its
 * side rather than off it, and keeps its side while the view moves unless another is clearly better.
 */
export function SelectionFloats({ rect, menu }: FloatsProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  /** The side last chosen: kept unless another is clearly better, so the menu does not flicker. */
  const was = useRef<Side>(undefined);
  useLayoutEffect(() => {
    const m = menuRef.current;
    const pane = m?.offsetParent as HTMLElement | null;
    if (!m || !pane) return;
    const o = pane.getBoundingClientRect();
    // The room: the pane, inside the window.
    const minX = Math.max(0, -o.left) + MARGIN;
    const maxX = Math.min(pane.clientWidth, window.innerWidth - o.left) - MARGIN;
    const minY = Math.max(0, -o.top) + MARGIN;
    const maxY = Math.min(pane.clientHeight, window.innerHeight - o.top) - MARGIN;
    const clampX = (left: number, w: number) => Math.max(minX, Math.min(left, maxX - w));
    const clampY = (top: number, ht: number) => Math.max(minY, Math.min(top, maxY - ht));
    const around = obstacles([m]);
    const sel: Box = rect;
    const w = m.offsetWidth;
    const ht = m.offsetHeight;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const at = (side: Side): Box => {
      if (side === 'above' || side === 'below') return { left: clampX(cx - w / 2, w), top: clampY(side === 'above' ? rect.top - GAP - ht : rect.top + rect.height + GAP, ht), width: w, height: ht };
      return { left: clampX(side === 'right' ? rect.left + rect.width + GAP : rect.left - GAP - w, w), top: clampY(cy - ht / 2, ht), width: w, height: ht };
    };
    const score = (b: Box, side: Side) =>
      crowding({ ...b, left: b.left + o.left, top: b.top + o.top }, around) +
      // Over the selection itself is worst: that is what everyone is looking at.
      (8 * overlap(b, sel)) / (b.width * b.height) +
      (side === 'above' ? 0 : side === 'below' ? 0.15 : 0.3) -
      (side === was.current ? 0.1 : 0);
    let best: { v: number; side: Side; b: Box } | undefined;
    for (const side of ['above', 'below', 'right', 'left'] as const) {
      const b = at(side);
      const v = score(b, side);
      if (!best || v < best.v) best = { v, side, b };
    }
    if (!best) return;
    was.current = best.side;
    m.style.left = `${best.b.left}px`;
    m.style.top = `${best.b.top}px`;
    m.dataset.side = best.side;
    // The pointer stays at the selection's middle when the menu is moved along to stay in view.
    if (best.side === 'above' || best.side === 'below') m.style.setProperty('--point', `${Math.max(12, Math.min(best.b.width - 12, cx - best.b.left))}px`);
    else m.style.setProperty('--point', `${Math.max(12, Math.min(best.b.height - 12, cy - best.b.top))}px`);
  });
  return <SelectionMenu ref={menuRef} {...menu} />;
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
        <header className="session-end-head">
          <span className="session-end-kicker">{t('Session')}</span>
          <h2 id="session-end-title">{t('What changed')}</h2>
          <p className="session-end-sub">{t('In this session, on {title}', { title: p.title })}</p>
        </header>
        {!cmp && !failed && <p className="session-end-wait">{t('Comparing…')}</p>}
        {failed && <p className="session-end-wait">{t('The two versions could not be compared')}</p>}
        {cmp && (
          <ol className="session-changes">
            {told.length ? (
              told.map((x, i) => (
                <li key={i} className={x.item ? `is-${x.item.status}` : undefined}>
                  <span className="session-change-mark" aria-hidden="true">
                    {x.item?.status === 'added' ? '+' : x.item?.status === 'removed' ? '−' : x.item ? '~' : '·'}
                  </span>
                  {x.text}
                </li>
              ))
            ) : (
              <li>
                <span className="session-change-mark" aria-hidden="true">
                  ·
                </span>
                {t('Nothing that shows in the drawing changed')}
              </li>
            )}
          </ol>
        )}
        <div className="session-end-row">
          <button className="button ghost" onClick={() => void copy()} disabled={!cmp}>
            <Icon name="copy" size={15} /> {t('Copy as text')}
          </button>
          <span className="session-gap" />
          <button className="button" onClick={p.onClose}>
            {t('Close')}
          </button>
          <button ref={show} className="button primary" onClick={p.onShow} disabled={!cmp}>
            {t('Show on the drawing')}
          </button>
        </div>
      </div>
    </div>
  );
}
