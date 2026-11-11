// The compare view over the drawing pane: the diagram as it is now against an earlier version, live
// while the YAML is edited. Overlay (the current drawing with what was added and changed marked, what
// is gone as ghosts where it stood) or side by side (before | after, panned and zoomed together).
// A list of the changes in plain words; ] and [ step through them, each focused in the drawing.
// Marks never rest on colour alone: a sign (+ ~ −), an outline pattern and the word in the list.
import { shortcutFor } from '../keys.ts';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LayoutSidecar } from '@cartography/core';
import { render, type RenderResult } from '@cartography/engine';
import { compare, countTold, explain, type Comparison, type Explained, type ItemDiff, type Picture } from '@cartography/diff';
import { useBrand } from '../brand.ts';
import { useIconOptions } from '../icon-packs.ts';
import { registerThemeFonts } from '../fonts.ts';
import { Icon } from '../icon.tsx';
import { Menu } from '../menu.tsx';
import { say, t as tr } from '../i18n/index.ts';
import type { Baseline } from './versions.ts';
import { compareExports, type CompareExports } from './compare-export.ts';
import './compare.css';

/** The diagram as it is in the editor. */
export interface CompareNow {
  text: string;
  sidecar?: LayoutSidecar;
  load?: (file: string) => string;
  file?: string;
  view?: string;
}

export type CompareMode = 'overlay' | 'side';

interface Props {
  baseline: Baseline;
  now: CompareNow;
  theme: 'light' | 'dark';
  /** The document's name, for headings and file names. */
  name: string;
  mode: CompareMode;
  onMode(m: CompareMode): void;
  onExit(): void;
  /** Choose another version to compare with. */
  onPick(): void;
  /** Leave the comparison with this element selected in the editor. */
  onEdit(item: ItemDiff): void;
  notify(message: string, opts?: { tone?: 'error' }): void;
  /** The view's actions, for the command palette. */
  actions?: React.RefObject<CompareActions | null>;
}

export interface CompareActions extends CompareExports {
  next(): void;
  previous(): void;
}

interface T {
  x: number;
  y: number;
  k: number;
}

const SIGN = { added: '+', changed: '~', removed: '−' } as const;
const DEBOUNCE = 250;

/** What a change's mark is in one picture: the overlay, or one side of side-by-side. */
function selectors(item: ItemDiff, where: 'overlay' | 'before' | 'after'): string[] {
  const attr = (k: string, v: string) => `[data-diff][data-${k}="${CSS.escape(v)}"]`;
  if (item.kind !== 'edge') return [attr(item.kind, item.id), `[data-${item.kind}="${CSS.escape(item.id)}"]`];
  const graphId = where === 'before' ? item.edge?.before : where === 'after' ? item.edge?.after : item.status === 'removed' ? item.id : item.edge?.after;
  const from = item.id.split(' -> ')[0]!.split('.')[0]!;
  // A line drawn as a badge has no route: its card carries the mark.
  return [...(graphId ? [attr('edge', graphId)] : []), attr('node', from)];
}

/** The panes a change shows in: removed only before, added only after, changed in both. */
const panesOf = (item: ItemDiff, mode: CompareMode): ('overlay' | 'before' | 'after')[] =>
  mode === 'overlay' ? ['overlay'] : item.status === 'added' ? ['after'] : item.status === 'removed' ? ['before'] : ['after', 'before'];

export function CompareView(p: Props) {
  const { theme: themeOverride } = useBrand();
  const icons = useIconOptions();
  const { baseline, now, theme, mode } = p;
  const options = useCallback(
    (side: { sidecar?: LayoutSidecar; load?: (f: string) => string }) => ({ theme, themeOverride, ...icons, sidecar: side.sidecar, load: side.load ?? now.load, file: now.file, fonts: 'none' as const }),
    [theme, themeOverride, icons, now.load, now.file],
  );

  // The older version is drawn once per version, theme and view; the newer one on every (debounced) edit.
  const [before, setBefore] = useState<{ key: string; r?: RenderResult }>();
  const beforeKey = `${baseline.id}|${theme}|${themeOverride ?? ''}|${now.view ?? ''}`;
  useEffect(() => {
    let live = true;
    if (baseline.text === undefined) return setBefore({ key: beforeKey });
    void render(baseline.text, { ...options(baseline), ...(now.view ? { view: now.view } : {}) })
      .then(async (r) => {
        await registerThemeFonts(r.theme);
        if (live) setBefore({ key: beforeKey, r });
      })
      .catch(() => live && setBefore({ key: beforeKey }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beforeKey, baseline.text, options]);

  const [text, setText] = useState(now.text);
  useEffect(() => {
    const t = setTimeout(() => setText(now.text), DEBOUNCE);
    return () => clearTimeout(t);
  }, [now.text]);

  const [c, setC] = useState<{ key: string; c: Comparison; pictures: { overlay?: Picture; before?: Picture; after?: Picture } }>();
  const [failed, setFailed] = useState<string>();
  useEffect(() => {
    if (!before || before.key !== beforeKey) return;
    let live = true;
    void compare(baseline.text, text, { before: options(baseline), after: options(now), ...(now.view ? { view: now.view } : {}), ...(before.r ? { drawnBefore: before.r } : {}) })
      .then(async (cmp) => {
        await registerThemeFonts(cmp.after?.theme ?? cmp.before?.theme);
        if (!live) return;
        setFailed(cmp.failed && !cmp.after?.svg ? cmp.diagnostics.find((d) => d.severity === 'error')?.message : undefined);
        if (cmp.failed && !cmp.after?.svg) return;
        setC({ key: beforeKey, c: cmp, pictures: { overlay: cmp.picture({ against: baseline.name }), before: cmp.side('before'), after: cmp.side('after') } });
      })
      .catch((e: unknown) => live && setFailed(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- now is new every render: its sidecar and view are what this reads of it (load and file come through options)
  }, [before, beforeKey, baseline, text, options, now.sidecar, now.view]);

  const cmp = c?.key === beforeKey ? c : undefined;
  const sentences = useMemo<Explained[]>(() => (cmp ? explain(cmp.c.diff, cmp.c.before?.graph, cmp.c.after?.graph) : []), [cmp]);
  const steps = useMemo(() => sentences.filter((s) => s.item), [sentences]);
  const [at, setAt] = useState<number>();
  const current = at !== undefined ? steps[at] : undefined;
  // Counted as the list says them: a line removed with its node is part of that node's sentence, not a change of its own.
  const counts = useMemo(() => (cmp ? countTold(sentences) : undefined), [cmp, sentences]);

  // ------------------------------------------------------------ pan and zoom, one for both panes

  const [t, setT] = useState<T>({ x: 0, y: 0, k: 1 });
  const [gliding, setGliding] = useState(false);
  const panes = useRef<Record<string, HTMLDivElement | null>>({});
  const stages = useRef<Record<string, HTMLDivElement | null>>({});
  const firstPane = () => panes.current[mode === 'overlay' ? 'overlay' : 'after'] ?? panes.current.before;
  const shown = mode === 'overlay' ? [cmp?.pictures.overlay] : [cmp?.pictures.before, cmp?.pictures.after];
  const size = { width: Math.max(1, ...shown.map((x) => x?.width ?? 0)), height: Math.max(1, ...shown.map((x) => x?.height ?? 0)) };
  const fitT = useCallback((): T => {
    const el = firstPane();
    if (!el) return { x: 0, y: 0, k: 1 };
    const [w, h] = [el.clientWidth, el.clientHeight];
    const k = Math.min(1.5, Math.max(0.05, Math.min((w - 48) / size.width, (h - 48) / size.height)));
    return { x: (w - size.width * k) / 2, y: (h - size.height * k) / 2, k };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, size.width, size.height]);
  const glide = (next: T) => {
    setGliding(true);
    setT(next);
    setTimeout(() => setGliding(false), 260);
  };
  const fit = () => glide(fitT());
  // A new version or mode is fitted; an edit keeps the view where it is.
  const fitted = useRef('');
  useLayoutEffect(() => {
    const key = `${beforeKey}|${mode}`;
    if (!cmp || fitted.current === key) return;
    fitted.current = key;
    setT(fitT());
  }, [cmp, beforeKey, mode, fitT]);

  const zoomBy = (f: number, cx?: number, cy?: number) =>
    setT((o) => {
      const el = firstPane();
      const [x, y] = [cx ?? (el?.clientWidth ?? 0) / 2, cy ?? (el?.clientHeight ?? 0) / 2];
      const k = Math.min(4, Math.max(0.05, o.k * f));
      return { k, x: x - ((x - o.x) * k) / o.k, y: y - ((y - o.y) * k) / o.k };
    });
  const onWheel = (e: React.WheelEvent) => {
    // Pinch (ctrl) or ⌘ scroll zooms; two fingers pan, as in the drawing.
    const r = e.currentTarget.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    else setT((o) => ({ ...o, x: o.x - e.deltaX, y: o.y - e.deltaY }));
  };
  useEffect(() => {
    // React's wheel listener is passive: the page would zoom too.
    const stop = (e: WheelEvent) => (e.target as Element | null)?.closest?.('.cmp-pane') && e.preventDefault();
    window.addEventListener('wheel', stop, { passive: false });
    return () => window.removeEventListener('wheel', stop);
  }, []);
  const drag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const [sx, sy, o] = [e.clientX, e.clientY, t];
    let moved = false;
    const move = (ev: PointerEvent) => {
      moved ||= Math.hypot(ev.clientX - sx, ev.clientY - sy) > 3;
      if (moved) setT({ ...o, x: o.x + ev.clientX - sx, y: o.y + ev.clientY - sy });
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      // A click on a mark picks that change.
      if (!moved) {
        const mark = (ev.target as Element | null)?.closest?.('[data-diff]');
        const id = mark?.getAttribute('data-node') ?? mark?.getAttribute('data-group') ?? mark?.getAttribute('data-edge');
        const i = id ? steps.findIndex((s) => s.item!.id === id || s.item!.edge?.after === id || s.item!.edge?.before === id) : -1;
        if (i >= 0) setAt(i);
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  // ------------------------------------------------------------ the change in focus

  const marked = (item: ItemDiff) =>
    panesOf(item, mode).flatMap((where) => {
      const root = stages.current[where];
      for (const sel of selectors(item, where)) {
        const el = root?.querySelector(sel);
        if (el) return [{ where, el }];
      }
      return [];
    });
  // The mark of the change in focus; a new pick also moves the view to it (a new mode is fitted whole instead).
  useEffect(() => {
    for (const root of Object.values(stages.current)) root?.querySelectorAll('[data-current]').forEach((e) => e.removeAttribute('data-current'));
    if (current?.item) for (const f of marked(current.item)) f.el.setAttribute('data-current', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, mode, cmp]);
  useEffect(() => {
    for (const root of Object.values(stages.current)) root?.querySelectorAll('[data-current]').forEach((e) => e.removeAttribute('data-current'));
    if (!current?.item) return;
    const found = marked(current.item);
    for (const f of found) f.el.setAttribute('data-current', '');
    const first = found[0];
    const pane = first && panes.current[first.where];
    const stage = first && stages.current[first.where];
    if (!first || !pane || !stage) return;
    // Where the mark is in the drawing's own units, then the view centred on it.
    // The scale as drawn now (the state may be a render ahead of the page after a change of mode).
    const [r, s] = [first.el.getBoundingClientRect(), stage.getBoundingClientRect()];
    const scale = stage.offsetWidth ? s.width / stage.offsetWidth : t.k;
    const box = { x: (r.left - s.left) / scale, y: (r.top - s.top) / scale, w: r.width / scale, h: r.height / scale };
    const [w, h] = [pane.clientWidth, pane.clientHeight];
    // Close enough to read (100 %), unless the change is too big for that; never further out than now.
    const k = Math.min(2, Math.max(scale, Math.min(1, (w * 0.6) / Math.max(box.w, 1), (h * 0.6) / Math.max(box.h, 1))));
    glide({ k, x: w / 2 - (box.x + box.w / 2) * k, y: h / 2 - (box.y + box.h / 2) * k });
    document.querySelector(`.cmp-list [data-step="${at}"]`)?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  // A list that changes under an edit keeps the step in range.
  useEffect(() => {
    if (at !== undefined && at >= steps.length) setAt(steps.length ? steps.length - 1 : undefined);
  }, [at, steps.length]);

  const step = (by: number) => {
    if (!steps.length) return;
    setAt((i) => (i === undefined ? (by > 0 ? 0 : steps.length - 1) : (i + by + steps.length) % steps.length));
  };

  // ------------------------------------------------------------ exports and keys

  const exports = useMemo(
    () => compareExports({ baseline, now: { ...now, text }, name: p.name, mode, options, sentences: () => sentences, diff: () => cmp?.c, notify: p.notify }),
    [baseline, now, text, p.name, mode, options, sentences, cmp, p.notify],
  );
  if (p.actions) p.actions.current = { ...exports, next: () => step(1), previous: () => step(-1) };
  const [menu, setMenu] = useState(false);

  const root = useRef<HTMLDivElement>(null);
  useEffect(() => root.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select, .cm-content, [role="dialog"], .palette');
      if (typing || e.altKey || e.metaKey || e.ctrlKey || document.querySelector('.palette, .modal-backdrop')) return;
      // The keys of keys.ts: ] and [ walk the changes as they walk the steps in the drawing.
      const id = shortcutFor(e, ['compare']);
      if (id === 'compare-next') step(1);
      else if (id === 'compare-previous') step(-1);
      else if (id === 'compare-exit') {
        if (menu) setMenu(false);
        else p.onExit();
      } else if (id === 'compare-edit' && current?.item) p.onEdit(current.item);
      else if (id === 'compare-mode') p.onMode(mode === 'overlay' ? 'side' : 'overlay');
      else if (id === 'compare-zoom') e.key === '0' ? fit() : zoomBy(e.key === '-' ? 0.8 : 1.25);
      else {
        // The drawing's own keys (P presents, N adds a note, ⌫ deletes) wait under the comparison.
        if (e.key.length === 1 || /^(Backspace|Delete|Arrow|Tab$)/.test(e.key)) e.stopImmediatePropagation();
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    // Before the editor's own keys (P presents, Esc deselects): while comparing, these are the comparison's.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const pane = (where: 'overlay' | 'before' | 'after', pic: Picture | undefined, title?: string) => (
    <div className="cmp-pane" data-pane={where} ref={(el) => void (panes.current[where] = el)} onWheel={onWheel} onPointerDown={drag}>
      {title && <div className="cmp-pane-title">{title}</div>}
      <div
        className={gliding ? 'cmp-stage gliding' : 'cmp-stage'}
        ref={(el) => void (stages.current[where] = el)}
        style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})`, width: pic?.width, height: pic?.height }}
        dangerouslySetInnerHTML={{ __html: pic?.svg ?? '' }}
      />
      {!pic && cmp && <div className="cmp-empty">{where === 'before' ? tr('Not there in {name}', { name: baseline.name }) : tr('Nothing to draw')}</div>}
    </div>
  );

  return (
    <div className={`compare mode-${mode}`} ref={root} tabIndex={-1} role="region" aria-label={tr('Compared with {name}', { name: baseline.name })}>
      <div className="cmp-bar" role="toolbar" aria-label={tr('Compare')}>
        <button className="tool cmp-against" onClick={p.onPick} title={tr('Compare with another version (⇧⌘D)')}>
          <Icon name="clock" /> <span>{tr('Against')} <strong>{baseline.name}</strong></span> <Icon name="chevron-down" size={14} />
        </button>
        <div className="segmented cmp-mode" role="radiogroup" aria-label={tr('Show')}>
          <button role="radio" aria-checked={mode === 'overlay'} className={mode === 'overlay' ? 'active' : ''} onClick={() => p.onMode('overlay')} title={tr('One drawing, the changes marked (M)')}>
            <Icon name="layers" /> {tr('Overlay')}
          </button>
          <button role="radio" aria-checked={mode === 'side'} className={mode === 'side' ? 'active' : ''} onClick={() => p.onMode('side')} title={tr('Before and after next to each other (M)')}>
            <Icon name="split" /> {tr('Side by side')}
          </button>
        </div>
        <div className="cmp-counts" aria-live="polite">
          {counts ? (
            cmp!.c.diff.same ? (
              <span>{tr('No changes')}</span>
            ) : (
              (['added', 'changed', 'removed'] as const).map((s) => (
                <span key={s} className={`cmp-count ${s}`} data-count={s}>
                  <b aria-hidden="true">{SIGN[s]}</b> {counts[s]} {say(s)}
                </span>
              ))
            )
          ) : (
            <span className="cmp-busy">{tr('Comparing…')}</span>
          )}
        </div>
        <button className="tool" onClick={() => void exports.copySummary()} title={tr('Copy the changes as Markdown, for a change advisory board')} disabled={!cmp}>
          <Icon name="copy" /> {tr('Copy summary')}
        </button>
        <div className="menu-anchor">
          <button className="tool" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu" disabled={!cmp}>
            <Icon name="download" /> {tr('Export')}
          </button>
          {menu && (
            <Menu onClose={() => setMenu(false)}>
              <button role="menuitem" onClick={() => void exports.saveSummary()}>
                <Icon name="file-text" /> {tr('Summary (.md)')}
              </button>
              <button role="menuitem" onClick={() => void exports.savePptx()}>
                <Icon name="layout-template" /> {tr('Before and after (.pptx)')}
              </button>
              <button role="menuitem" onClick={() => void exports.savePng()}>
                <Icon name="image" /> {tr('{mode} as PNG', { mode: mode === 'overlay' ? tr('Overlay') : tr('Side by side') })}
              </button>
              <button role="menuitem" onClick={() => void exports.saveSvg()}>
                <Icon name="download" /> {tr('{mode} as SVG', { mode: mode === 'overlay' ? tr('Overlay') : tr('Side by side') })}
              </button>
            </Menu>
          )}
        </div>
        <button className="tool cmp-done" onClick={p.onExit} title={tr('Back to editing (Esc)')}>
          <Icon name="x" /> {tr('Done')} <kbd>Esc</kbd>
        </button>
      </div>
      <div className="cmp-body">
        {/* Wide drawings go under each other: next to each other they would be too small to read. */}
        <div className={mode === 'side' && size.width > 1.2 * size.height ? 'cmp-panes stacked' : 'cmp-panes'}>
          {mode === 'overlay' ? pane('overlay', cmp?.pictures.overlay) : (
            <>
              {pane('before', cmp?.pictures.before, tr('Before · {name}', { name: baseline.name }))}
              {pane('after', cmp?.pictures.after, tr('After · now'))}
            </>
          )}
          {failed && (
            <div className="cmp-note" role="status">
              <Icon name="circle-exclamation-point" size={14} /> {failed}
            </div>
          )}
          <div className="cmp-zoom">
            <button className="tool" onClick={() => zoomBy(0.8)} aria-label={tr('Zoom out')} title={tr('Zoom out (−)')}>
              <Icon name="minus" />
            </button>
            <button className="tool" onClick={fit} title={tr('Fit (0)')}>
              <Icon name="maximize" />
            </button>
            <button className="tool" onClick={() => zoomBy(1.25)} aria-label={tr('Zoom in')} title={tr('Zoom in (+)')}>
              <Icon name="plus" />
            </button>
          </div>
        </div>
        <aside className="cmp-list" aria-label={tr('Changes')}>
          <header>
            <strong>{tr('Changes')}</strong>
            <span className="cmp-keys">
              <kbd>]</kbd> <kbd>[</kbd> {tr('step')} · <kbd>↵</kbd> {tr('edit')}
            </span>
          </header>
          {cmp && !sentences.length && <p className="cmp-none">{tr('Nothing drawn differs from {name}.', { name: baseline.name })}</p>}
          <ol>
            {sentences.map((s, i) => {
              const n = s.item ? steps.indexOf(s) : -1;
              const status = s.item?.status ?? 'changed';
              return (
                <li key={i}>
                  <button
                    className={n === at && n >= 0 ? 'cmp-item current' : 'cmp-item'}
                    data-step={n >= 0 ? n : undefined}
                    data-status={status}
                    aria-current={n === at && n >= 0 ? 'true' : undefined}
                    onClick={() => (n >= 0 ? setAt(n) : undefined)}
                    onDoubleClick={() => s.item && p.onEdit(s.item)}
                    title={s.item ? tr('{what} {id} · double-click or ↵ to edit it', { what: say(s.item.kind === 'edge' ? 'line' : s.item.kind), id: s.item.id }) : undefined}
                  >
                    <span className={`cmp-sign ${status}`} aria-label={say(status)}>
                      {SIGN[status]}
                    </span>
                    <span className="cmp-text">{s.text}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>
    </div>
  );
}
