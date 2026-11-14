// The drawing's pane: the canvas (select, drag, connect, label in place), what floats over it (the
// focus and layers chips and notes at the top, the toolbar at the bottom, the hint, the empty state, the
// add popup), the comparison over it, and the steps strip under it.
import './drawing-pane.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n/index.ts';
import { Icon } from '../icon.tsx';
import { keyHint } from '../keys.ts';
import { parseLink } from '@linework/core';
import { BIG_CANVAS } from '@linework/engine';
import { AddMenu } from '../add-menu.tsx';
import { FocusChip } from '../focus-chip.tsx';
import { Preview, type DeckTemplate, type PreviewControl, type Selection } from '../preview.tsx';
import { StepsStrip } from '../steps-strip.tsx';
import { deleteStep, moveStep, renameStep, stepsPath } from '../steps-edit.ts';
import { parentKey } from '../builder.ts';
import { drawnFields } from './names.ts';
import type { useCraftPrefs } from '../craft-actions.tsx';
import type { View } from '../start.tsx';
import type { Drawing } from './drawing.ts';
import type { Busy } from '../use-render.ts';
import type { Edits } from './edits.ts';
import type { Navigation } from './navigation.ts';
import type { Pins } from './pins.ts';
import type { Select } from './selection.ts';
import type { Notify } from './toasts.tsx';
import type { Sketching } from './sketching.ts';
import { SelectionFloats, SessionHeader, SketchKeys } from '../session.tsx';

interface Props {
  drawing: Drawing;
  selection: Selection[];
  select: Select;
  edits: Edits;
  pinning: Pins;
  nav: Navigation;
  craft: ReturnType<typeof useCraftPrefs>;
  control: React.RefObject<PreviewControl | null>;
  onKeyDown(e: React.KeyboardEvent): void;
  /** What a screen reader hears for the focused element. */
  describe(s: Selection): string;
  /** The toolbar (canvas-tools.tsx), at the bottom in the editor and in a session alike. */
  tools: React.ReactNode;
  layersChip: React.ReactNode;
  /** A focus of the YAML switched off here. */
  focusOff: boolean;
  view: View;
  hint: boolean;
  dismissHint(): void;
  modalOpen: boolean;
  adding: boolean;
  closeAdding(): void;
  /** The comparison over the drawing (compare/). */
  compareView: React.ReactNode;
  textNow(): string;
  naming: number | undefined;
  onNamed(): void;
  notify: Notify;
  sketching: Sketching;
  /** The PowerPoint template decks are made in: the page frame measures its room. */
  deckTemplate?: DeckTemplate;
  /** Only the sheet on screen (a session, or its end): no page frame, no minimap. */
  sheetOnly: boolean;
  /** In a session: only the sheet, the toolbar, and a menu over the selection. */
  session?: {
    title: string;
    /** The sketch keys over the toolbar (the first few sessions). */
    hint: boolean;
    connect(): void;
  };
}

export function DrawingPane(p: Props) {
  const { drawing, edits, pinning, nav, craft, adding } = p;
  const { rendered, result, drawn, type, current } = drawing;
  const { stepList } = nav;
  // A diagram with views keeps the strip in every view, steps or none: switching views never moves
  // the toolbar up and down under the pointer.
  const strip = stepList.length > 0 || !!drawn?.views?.length;
  const { pathOf, select, toggle } = p.select;
  /** A diagram with nothing in it yet: the canvas says how to start. */
  // Counted as the status bar counts it: a sequence with no participants is empty too, though drawn as one shape.
  const empty = !!result?.graph && current && drawnFields(result.graph).every(([, n]) => !n);
  const quick = useMemo(() => {
    const items = type?.palette ?? [];
    // Shapes first (not containers), then whatever there is.
    return [...items.filter((i) => i.collection !== 'groups'), ...items.filter((i) => i.collection === 'groups')].slice(0, 4);
  }, [type]);
  return (
    <section className={`pane canvas-pane${strip ? ' with-steps' : ''}`} aria-label={t('Drawing')}>
      <Preview
        result={drawn}
        stale={!!rendered && drawn !== result}
        catchingUp={!current}
        onHint={(m) => p.notify(m)}
        selection={p.selection}
        // Another document, view, focus or set of layers drawn alone is another drawing: the view fits it.
        docKey={`${rendered?.docKey ?? -1}:${drawn?.view ?? ''}:${drawn?.focus ? `${drawn.focus.on.join(' ')} ${drawn.focus.hops} ${drawn.focus.direction}` : ''}:${drawn?.layers?.mode === 'only' ? drawn.layers.active.join('+') : ''}`}
        onSelect={(s, add) => (add && s ? toggle(s) : select(s))}
        onSelectMany={p.select.selectMany}
        labelOf={edits.labelOf}
        onLabel={edits.onLabel}
        onLabelDone={p.sketching.named}
        kindsFor={p.sketching.kindsFor}
        overlay={(rect, renaming) => {
          const s = p.session;
          const g = result?.graph;
          if (!s || !g || !type) return null;
          const nodes = p.selection.filter((x) => x.kind === 'node');
          const one = p.selection.length === 1 ? p.selection[0] : undefined;
          const node = one?.kind === 'node' ? g.nodes.find((n) => n.id === one.id) : undefined;
          // Groups a selected box can go in (by what its type says), not the one it is in.
          const collection = node ? String(node.path[0]) : nodes.length ? String(g.nodes.find((n) => n.id === nodes[0]!.id)?.path[0] ?? '') : '';
          const groups = g.groups.filter((x) => x.path.length === 2 && x.id !== node?.parent && !!parentKey(type, collection, String(x.path[0])));
          const showMenu = !!rect && !renaming && !drawing.draft && (one?.kind === 'node' || nodes.length > 1);
          return (
            <>
              {/* The keys, in one quiet line over the toolbar: the first few sessions only. */}
              {s.hint && <SketchKeys naming={renaming} selected={!!p.selection.length} />}
              {showMenu && rect && (
                <SelectionFloats
                  key={p.selection.map((x) => x.id).join(' ')}
                  rect={rect}
                  menu={{
                    single: !!node,
                    kinds: node ? (p.sketching.kindsFor(one!) ?? []) : [],
                    kind: node?.kind,
                    groups,
                    canGroup: nodes.length > 0,
                    onKind: (item) => p.sketching.kindTo(item),
                    onGroup: (into) => p.sketching.group(into),
                    onConnect: s.connect,
                    onDelete: () => (p.selection.length > 1 ? edits.removeAll() : edits.remove()),
                  }}
                />
              )}
            </>
          );
        }}
        onMove={edits.move}
        onConnect={edits.connect}
        onMoveGroup={(id, at, done) => {
          if (!done) return drawing.setDraft({ groups: { [id]: at } });
          drawing.setDraft(undefined);
          pinning.pinTo(pinning.moveGroupPins(id, at));
        }}
        onDragCancel={() => drawing.setDraft(undefined)}
        canConnect={(id) => {
          const path = pathOf({ kind: 'node', id });
          // A type that writes its own lines says what can be joined (a start dot has no entry of its own).
          const entry = !!path && (type?.lines ? true : path.length === 2 && typeof path[1] === 'string');
          return !!type && !type.unconnected && entry && (!!type.connect || !!(type.schema as { properties?: { edges?: unknown } }).properties?.edges);
        }}
        canDrop={(group, what) => {
          const g = result?.graph?.groups.find((x) => x.id === group);
          if (!type || !g || g.path.length !== 2) return false;
          const collection = what.palette != null ? type.palette[what.palette]?.collection : String(pathOf({ kind: 'node', id: what.node! })?.[0] ?? '');
          return !!collection && !!parentKey(type, collection, String(g.path[0]));
        }}
        onPaletteDrop={(i, at, group, refused) => {
          const item = type?.palette[i];
          if (!item) return;
          edits.add(item, group, at);
          if (refused) p.notify(t('{item} cannot go in {group}: placed outside it', { item: item.label, group: result?.graph?.groups.find((g) => g.id === refused)?.label ?? refused }));
        }}
        onKeyDown={p.onKeyDown}
        locked={drawing.locked}
        bent={drawing.bent}
        grid={craft.grid}
        minimap={craft.minimap && !p.sheetOnly}
        page={craft.page && !p.sheetOnly}
        deckTemplate={p.deckTemplate}
        clearBottom={p.session ? 88 : undefined}
        pinned={drawing.pinnedIds}
        onToggle={craft.toggle}
        control={p.control}
        describe={p.describe}
        onBend={(id, via, done) => {
          const e = result?.graph?.edges.find((x) => x.id === id);
          if (!done) return drawing.setDraft({ edges: { [id]: { via, from: e?.from.node, to: e?.to.node } } });
          drawing.setDraft(undefined);
          pinning.pinTo(pinning.withEdge(id, via));
        }}
        onFollow={(s) => {
          const g = drawn?.graph;
          const links = s.kind === 'node' ? g?.nodes.find((n) => n.id === s.id)?.links : s.kind === 'group' ? g?.groups.find((x) => x.id === s.id)?.links : undefined;
          if (!links?.length) return false;
          nav.follow(links[0]!);
          return true;
        }}
        onFollowLink={(target) => {
          const link = parseLink(target);
          if (!link) return false;
          nav.follow(link);
          return true;
        }}
      >
        <div className="canvas-top">
          {/* A link followed: the way back to where it was followed from, in the view it showed. */}
          {!adding && !p.session && nav.backTo && (
            <button className="focus-chip back-chip" onClick={nav.back} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} title={t('Back to where the link was followed from (⌘[)')}>
              <Icon name="arrow-left" size={14} />
              <span className="focus-chip-name">
                {t('Back to')} <strong>{nav.backTo.name}</strong>
              </span>
              <kbd>{keyHint('back')}</kbd>
            </button>
          )}
          {!adding && <FocusChip focus={drawn?.focus} off={p.focusOff} onHops={nav.focusHops} onDirection={nav.focusDirection} onLeave={nav.leaveFocus} />}
          {!adding && p.layersChip}
          {/* Notes about the drawing go on a row of their own under the chips. */}
          {drawing.busy && (
            <BusyNote
              busy={drawing.busy}
              whole={drawing.busy.view === '' && !!drawn?.canvas}
              onStop={() => {
                const asked = drawing.busy!.view;
                drawing.busy!.stop();
                // A view picked that would not draw in time: back to the one on screen.
                if (asked !== undefined && asked !== drawn?.view) nav.showView(drawn?.canvas && drawn.view === drawn.views?.[0]?.name ? undefined : drawn?.view);
              }}
            />
          )}
          {!!rendered && !!drawn?.svg && drawn !== result && (
            <div className="canvas-note">
              <div className="stale-note" role="status">
                <Icon name="circle-exclamation-point" size={14} /> {t('Showing the last version that worked: fix the problems in the editor')}
              </div>
            </div>
          )}
        </div>
        {/* The toolbar, centred along the bottom; the zoom keeps its corner (the empty cell on the right is its room). */}
        <div className="canvas-bottom">
          {p.tools}
          <span className="zoom-room" aria-hidden="true" />
        </div>
        {p.hint && !adding && !p.modalOpen && (
          <Hint>
            <span>
              {p.view === 'visual' ? (
                <>
                  {t('Drag shapes onto the drawing or into a group, drag the dot on a shape to connect it, double-click to rename.')} <kbd>?</kbd> {t('shows all keys.')}
                </>
              ) : (
                <>
                  {t('Edit the YAML (')}<kbd>Tab</kbd> {t('indents two spaces;')} <kbd>Esc</kbd> <kbd>Tab</kbd> {t('or')} <kbd>F6</kbd> {t('leaves it), or build here:')} <kbd>A</kbd> {t('adds a shape, drag the dot on a shape to connect it,')} <kbd>?</kbd> {t('shows all keys.')}
                </>
              )}
            </span>
            <button className="icon-button small" onClick={p.dismissHint} aria-label={t('Dismiss hint')}>
              <Icon name="x" size={14} />
            </button>
          </Hint>
        )}
        {empty && type && !adding && (
          <div className="canvas-empty">
            <p>
              <strong>{t('Drag a shape here')}</strong> {t('or press')} <kbd>A</kbd>
            </p>
            <div className="chips inline">
              {quick.map((item) => (
                <button key={item.collection + item.kind} className="chip" onClick={() => edits.add(item)}>
                  <Icon name={item.icon} size={14} /> {item.label}
                </button>
              ))}
            </div>
            <p className="fine">{t('Double-click the title to name the diagram.')}</p>
          </div>
        )}
        {adding && type && (
          <AddMenu
            items={type.palette}
            into={p.selection.length === 1 && p.selection[0]!.kind === 'group' ? (result?.graph?.groups.find((g) => g.id === p.selection[0]!.id)?.label ?? p.selection[0]!.id) : undefined}
            onAdd={(item) => edits.add(item)}
            onClose={() => {
              p.closeAdding();
              (document.querySelector('.preview') as HTMLElement | null)?.focus();
            }}
          />
        )}
      </Preview>
      {p.session && <SessionHeader title={p.session.title} />}
      {p.compareView}
      {strip && (
        <StepsStrip
          steps={stepList}
          implied={drawn?.stepsImplied}
          value={drawn?.step}
          selected={p.selection.length}
          naming={current ? p.naming : undefined}
          onNamed={p.onNamed}
          onPick={nav.pickStep}
          onAdd={nav.addStepFromSelection}
          onRename={(n, title) => nav.editSteps(renameStep(p.textNow(), stepsPath(drawn?.view), n, title))}
          onMove={(n, to) => nav.editSteps(moveStep(p.textNow(), stepsPath(drawn?.view), n, to), drawn?.step === n ? to : drawn?.step === to ? n : undefined)}
          onDelete={(n) => nav.editSteps(deleteStep(p.textNow(), stepsPath(drawn?.view), n))}
        />
      )}
    </section>
  );
}

/** A drawing that is taking a while: how long so far, and a way to give it up. The editor goes on meanwhile. */
function BusyNote({ busy, whole, onStop }: { busy: Busy; whole: boolean; onStop(): void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, []);
  const s = Math.max(1, Math.round((Date.now() - busy.since) / 1000));
  const a = busy.about;
  return (
    <div className="canvas-note">
      <div className="busy-note" role="status" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        <span className="busy-spinner" aria-hidden="true" />
        <span>
          {whole
            ? a && a.nodes > BIG_CANVAS
              ? t('Laying out the whole canvas, {nodes} elements and {edges} lines: {s} s. Every view at once can take minutes; its views draw in seconds.', { nodes: a.nodes, edges: a.edges, s })
              : t('Laying out the whole canvas: {s} s. It holds every view at once and can take a minute.', { s })
            : a
              ? t('Laying out the drawing, {nodes} elements and {edges} lines: {s} s', { nodes: a.nodes, edges: a.edges, s })
              : t('Laying out the drawing: {s} s', { s })}
        </span>
        <button onClick={onStop}>
          {t('Stop')}
        </button>
      </div>
    </div>
  );
}

/**
 * The first-visit hint, only where it is clear of the drawing (its step caption is in it, and the page
 * when that is shown): over the drawing it would hide what it explains, so then it is not shown.
 */
function Hint({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [clear, setClear] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    const pane = el?.parentElement;
    if (!el || !pane) return;
    const check = () => {
      const h = el.getBoundingClientRect();
      const over = [...pane.querySelectorAll('.drawing svg, .page-frame')].some((x) => {
        const r = x.getBoundingClientRect();
        return r.width > 0 && r.left < h.right && r.right > h.left && r.top < h.bottom && r.bottom > h.top;
      });
      setClear(!over);
    };
    check();
    // Again whenever the drawing moves under it: a new drawing, a pan or zoom (and its glide), the pane.
    const ro = new ResizeObserver(check);
    ro.observe(pane);
    const mo = new MutationObserver(check);
    mo.observe(pane, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
    pane.addEventListener('transitionend', check);
    return () => (ro.disconnect(), mo.disconnect(), pane.removeEventListener('transitionend', check));
  }, []);
  return (
    <div className="hint" role="note" ref={ref} style={clear ? undefined : { visibility: 'hidden' }}>
      {children}
    </div>
  );
}
