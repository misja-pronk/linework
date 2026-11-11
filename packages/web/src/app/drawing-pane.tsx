// The drawing's pane: the canvas (select, drag, connect, label in place), what floats over it (the
// toolbar, the focus and layers chips, notes, the hint, the empty state, the add popup), the
// comparison over it, and the steps strip under it.
import { useMemo } from 'react';
import { t } from '../i18n/index.ts';
import { Icon } from '../icon.tsx';
import { AddMenu } from '../add-menu.tsx';
import { FocusChip } from '../focus-chip.tsx';
import { Preview, type PreviewControl, type Selection } from '../preview.tsx';
import { StepsStrip } from '../steps-strip.tsx';
import { deleteStep, moveStep, renameStep, stepsPath } from '../steps-edit.ts';
import { parentKey } from '../builder.ts';
import type { useCraftPrefs } from '../craft-actions.tsx';
import type { View } from '../start.tsx';
import type { Drawing } from './drawing.ts';
import type { Edits } from './edits.ts';
import type { Navigation } from './navigation.ts';
import type { Pins } from './pins.ts';
import type { Select } from './selection.ts';
import type { Notify } from './toasts.tsx';

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
  /** The toolbar (canvas-tools.tsx). */
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
}

export function DrawingPane(p: Props) {
  const { drawing, edits, pinning, nav, craft, adding } = p;
  const { rendered, result, drawn, type, current } = drawing;
  const { stepList } = nav;
  const { pathOf, select, toggle } = p.select;
  /** A diagram with nothing in it yet: the canvas says how to start. */
  const empty = !!result?.graph && current && !result.graph.nodes.length && !result.graph.groups.length;
  const quick = useMemo(() => {
    const items = type?.palette ?? [];
    // Shapes first (not containers), then whatever there is.
    return [...items.filter((i) => i.collection !== 'groups'), ...items.filter((i) => i.collection === 'groups')].slice(0, 4);
  }, [type]);
  return (
    <section className={`pane canvas-pane${stepList.length ? ' with-steps' : ''}`} aria-label={t('Drawing')}>
      <Preview
        result={drawn}
        stale={!!rendered && drawn !== result}
        selection={p.selection}
        docKey={`${rendered?.docKey ?? -1}:${drawn?.view ?? ''}:${drawn?.focus ? `${drawn.focus.on.join(' ')} ${drawn.focus.hops} ${drawn.focus.direction}` : ''}`}
        onSelect={(s, add) => (add && s ? toggle(s) : select(s))}
        onSelectMany={p.select.selectMany}
        labelOf={edits.labelOf}
        onLabel={edits.onLabel}
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
        minimap={craft.minimap}
        page={craft.page}
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
      >
        <div className="canvas-top">
          {p.tools}
          {!adding && <FocusChip focus={drawn?.focus} off={p.focusOff} onHops={nav.focusHops} onDirection={nav.focusDirection} onLeave={nav.leaveFocus} />}
          {!adding && p.layersChip}
          {/* Notes about the drawing go on a row of their own under the tools, never under them. */}
          {!!rendered && !!drawn?.svg && drawn !== result && (
            <div className="canvas-note">
              <div className="stale-note" role="status">
                <Icon name="circle-exclamation-point" size={14} /> {t('Showing the last version that worked: fix the problems in the editor')}
              </div>
            </div>
          )}
        </div>
        {p.hint && !adding && !p.modalOpen && (
          <div className="hint" role="note">
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
          </div>
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
            onAdd={(item) => edits.add(item)}
            onClose={() => {
              p.closeAdding();
              (document.querySelector('.preview') as HTMLElement | null)?.focus();
            }}
          />
        )}
      </Preview>
      {p.compareView}
      {stepList.length > 0 && (
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
