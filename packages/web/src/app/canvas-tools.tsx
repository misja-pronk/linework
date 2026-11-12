// The drawing's toolbar, centred at the bottom of the canvas: the same bar in the editor and in a session,
// so what is practised in one is what is used in the other. Add, group, undo and redo, the steps (in a
// session; the editor has the steps strip under the drawing); then in
// the editor the view, layers, present and ⋯ for the rest (tidy, focus, a step, Your AI, compare, the
// grid and the minimap), and in a session End session. Every tooltip says its key.
import './canvas-tools.css';
import { useState } from 'react';
import { t } from '../i18n/index.ts';
import { Icon } from '../icon.tsx';
import { Menu } from '../menu.tsx';
import { keyHint } from '../keys.ts';
import { ViewPicker } from '../view-picker.tsx';
import type { useCraftPrefs } from '../craft-actions.tsx';
import type { RenderResult } from '@cartography/engine';

/** What the bar has in both modes. */
interface Common {
  hasType: boolean;
  addShape(): void;
  canGroup: boolean;
  group(): void;
  undo(): void;
  redo(): void;
  /** How many steps the drawing has (none: no steps in the bar), and the one shown. */
  steps: number;
  step: number | undefined;
  stepBy(dir: 1 | -1): void;
}

/** The editor's own: the add popup, the view, layers, present and ⋯. */
interface Editor {
  drawn: RenderResult | undefined;
  adding: boolean;
  tidyLayout(): void;
  /** Pins or a kept drawing: Tidy all is offered. */
  canTidyAll: boolean;
  tidyAll(): void;
  pickView(name: string | undefined): void;
  layersButton: React.ReactNode;
  hasSelection: boolean;
  focusOn: boolean;
  focusOnSelection(): void;
  addStep(): void;
  present(): void;
  asking: boolean;
  toggleAsk(): void;
  proposal: boolean;
  comparing: boolean;
  toggleCompare(): void;
  zoomToSelection(): void;
  craft: ReturnType<typeof useCraftPrefs>;
}

type Props = Common & ({ session: { end(): void } } | ({ session?: undefined } & Editor));

/** What a tool does and its key ("Undo (⌘Z)" without the quotes), as a tooltip. */
const tip = (what: string, key: string) => (key ? `${what} (${key})` : what);

export function CanvasTools(p: Props) {
  const keep = (e: React.PointerEvent) => e.stopPropagation();
  const session = !!p.session;
  return (
    <div className="canvas-tools" role="toolbar" aria-label={session ? t('Session') : t('Drawing tools')} onPointerDown={keep} onPointerUp={keep}>
      {/* In the editor A opens the shapes to add; in a session Tab adds a box (connected from the selected one). */}
      {p.session ? (
        <button className="tool" onClick={p.addShape} title={tip(t('Add a box'), keyHint('session-tab'))} aria-label={t('Add a box')} disabled={!p.hasType}>
          <Icon name="plus" /> <span className="tool-label">{t('Add')}</span> <kbd>{keyHint('session-tab')}</kbd>
        </button>
      ) : (
        <button className={p.adding ? 'tool active' : 'tool'} onClick={p.addShape} title={tip(t('Add a shape'), keyHint('add'))} aria-label={t('Add a shape')} aria-expanded={p.adding} disabled={!p.hasType}>
          <Icon name="plus" /> <span className="tool-label">{t('Add')}</span> <kbd>{keyHint('add')}</kbd>
        </button>
      )}
      <button className="tool" onClick={p.group} disabled={!p.canGroup} title={tip(t('Put the selected boxes in a new group'), keyHint('group'))} aria-label={t('Group')}>
        <Icon name="square-dashed" /> <span className="tool-label">{t('Group')}</span> <kbd>{keyHint('group')}</kbd>
      </button>
      <span className="tool-sep" aria-hidden="true" />
      <button className="tool" onClick={p.undo} title={tip(t('Undo'), keyHint('undo'))} aria-label={t('Undo')}>
        <Icon name="undo-2" />
      </button>
      <button className="tool" onClick={p.redo} title={tip(t('Redo'), keyHint('redo'))} aria-label={t('Redo')}>
        <Icon name="redo-2" />
      </button>
      {session && p.steps > 0 && (
        <>
          <span className="tool-sep" aria-hidden="true" />
          {/* In a session [ and ] would start a name, so the arrows are clicked. */}
          <span className="tool-steps">
            <button className="tool" onClick={() => p.stepBy(-1)} title={t('Previous step')} aria-label={t('Previous step')}>
              <Icon name="arrow-left" />
            </button>
            <span className="tool-step-no" aria-live="polite">
              {p.step ? t('Step {n}/{m}', { n: p.step, m: p.steps }) : t('All steps')}
            </span>
            <button className="tool" onClick={() => p.stepBy(1)} title={t('Next step')} aria-label={t('Next step')}>
              <Icon name="arrow-right" />
            </button>
          </span>
        </>
      )}
      <span className="tool-sep" aria-hidden="true" />
      {p.session ? (
        <button
          className="tool session-end"
          onClick={p.session.end}
          title={t('Back to the editor, with what changed')}
          onKeyDown={(e) => e.key === 'Escape' && (document.querySelector('.preview') as HTMLElement | null)?.focus({ preventScroll: true })}
        >
          {t('End session')}
        </button>
      ) : (
        <EditorTools {...p} />
      )}
    </div>
  );
}

/** The editor's end of the bar: the view (when the diagram has views), layers, present and ⋯. */
function EditorTools(p: Common & Editor) {
  const { drawn, craft } = p;
  const [toolsMore, setToolsMore] = useState(false);
  return (
    <>
      <ViewPicker views={drawn?.views} value={drawn?.view} asWritten={!drawn?.onlyViews} written={drawn?.asWritten} onChange={p.pickView} />
      {p.layersButton}
      <button className="tool" onClick={p.present} title={t('Present full screen, step by step (P or ⌘↩)')} aria-label={t('Present')} disabled={!drawn?.svg}>
        <Icon name="play" /> <span className="tool-label">{t('Present')}</span> <kbd>{keyHint('present')}</kbd>
      </button>
      {/* Everything else, at every width: arranging, focus, a step, Your AI, comparing and the view's switches. */}
      <div className="menu-anchor tool-overflow">
        <button className={toolsMore ? 'tool active' : 'tool'} onClick={() => setToolsMore((m) => !m)} aria-expanded={toolsMore} aria-haspopup="menu" aria-label={t('More tools')} title={t('More: tidy, focus, a step, your AI, compare, grid, minimap')}>
          <span className="more-dots" aria-hidden="true">⋯</span>
          {p.proposal && !p.asking && <span className="tool-count unread">1</span>}
        </button>
        {toolsMore && (
          <Menu onClose={() => setToolsMore(false)}>
            <button role="menuitem" onClick={() => (setToolsMore(false), p.tidyLayout())}>
              <Icon name="layout-grid" /> {t('Tidy')} <kbd>{keyHint('tidy')}</kbd>
            </button>
            {p.canTidyAll && (
              <button role="menuitem" onClick={() => (setToolsMore(false), p.tidyAll())}>
                <Icon name="pin-off" /> {t('Tidy all')}
              </button>
            )}
            <button role="menuitem" onClick={() => (setToolsMore(false), p.focusOnSelection())} disabled={!p.hasSelection && !p.focusOn}>
              <Icon name="focus" /> {t('Focus')} <kbd>{keyHint('focus')}</kbd>
            </button>
            {!p.steps && (
              <button role="menuitem" onClick={() => (setToolsMore(false), p.addStep())} disabled={!p.hasType}>
                <Icon name="layers" /> {t('Add a step')} <kbd>{keyHint('step')}</kbd>
              </button>
            )}
            <hr />
            {/* The one way to Your AI on the drawing (besides ⌘K): no AI is built in, it copies to and takes proposals from the user's own. */}
            <button role="menuitem" onClick={() => (setToolsMore(false), p.toggleAsk())} disabled={!p.hasType}>
              <Icon name="sparkles" /> {p.asking ? t('Close Your AI') : t('Your AI…')} <kbd>{keyHint('ask')}</kbd>
            </button>
            <button role="menuitem" onClick={() => (setToolsMore(false), p.toggleCompare())}>
              <Icon name="clock" /> {p.comparing ? t('Stop comparing') : t('Compare with an earlier version')} <kbd>{keyHint('compare')}</kbd>
            </button>
            <hr />
            <button role="menuitem" onClick={() => (setToolsMore(false), p.zoomToSelection())} disabled={!p.hasSelection}>
              <Icon name="focus" /> {t('Zoom to the selection')} <kbd>{keyHint('zoom-selection')}</kbd>
            </button>
            <button role="menuitemcheckbox" aria-checked={!!craft.grid} onClick={() => (setToolsMore(false), craft.toggle('grid'))}>
              <Icon name="grid-3x3" /> Snap to grid {craft.grid && <Icon name="check" size={14} />} <kbd>{keyHint('grid')}</kbd>
            </button>
            <button role="menuitemcheckbox" aria-checked={!!craft.minimap} onClick={() => (setToolsMore(false), craft.toggle('minimap'))}>
              <Icon name="map" /> Minimap {craft.minimap && <Icon name="check" size={14} />} <kbd>{keyHint('minimap')}</kbd>
            </button>
          </Menu>
        )}
      </div>
    </>
  );
}
