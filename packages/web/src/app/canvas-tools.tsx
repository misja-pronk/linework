// The drawing's toolbar: add, undo and redo, the view, layers, present, and ⋯ for the rest (tidy, focus, a
// step, Your AI, compare, the grid and the minimap).
import './canvas-tools.css';
import { useState } from 'react';
import { t } from '../i18n/index.ts';
import { Icon } from '../icon.tsx';
import { Menu } from '../menu.tsx';
import { keyHint } from '../keys.ts';
import { ViewPicker } from '../view-picker.tsx';
import type { useCraftPrefs } from '../craft-actions.tsx';
import type { RenderResult } from '@cartography/engine';

interface Props {
  drawn: RenderResult | undefined;
  hasType: boolean;
  adding: boolean;
  addShape(): void;
  undo(): void;
  redo(): void;
  tidyLayout(): void;
  /** Pins or a kept drawing: Tidy all is offered. */
  canTidyAll: boolean;
  tidyAll(): void;
  pickView(name: string | undefined): void;
  layersButton: React.ReactNode;
  hasSelection: boolean;
  focusOn: boolean;
  focusOnSelection(): void;
  hasSteps: boolean;
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

export function CanvasTools(p: Props) {
  const { drawn, craft } = p;
  /** The drawing's tools that fold into ⋯ when the pane is narrow. */
  const [toolsMore, setToolsMore] = useState(false);
  return (
    <div className="canvas-tools" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
      <button className={p.adding ? 'tool active' : 'tool'} onClick={p.addShape} title={t('Add a shape (A)')} aria-label={t('Add a shape')} aria-expanded={p.adding} disabled={!p.hasType}>
        <Icon name="plus" /> <span className="tool-label">{t('Add')}</span> <kbd>A</kbd>
      </button>
      <button className="tool" onClick={p.undo} title={t('Undo (⌘Z)')} aria-label={t('Undo')}>
        <Icon name="undo-2" />
      </button>
      <button className="tool" onClick={p.redo} title={t('Redo (⇧⌘Z)')} aria-label={t('Redo')}>
        <Icon name="redo-2" />
      </button>
      <span className="tool-sep" aria-hidden="true" />
      <ViewPicker views={drawn?.views} value={drawn?.view} asWritten={!drawn?.onlyViews} onChange={p.pickView} />
      {p.layersButton}
      <span className="tool-sep" aria-hidden="true" />
      <button className="tool" onClick={p.present} title={t('Present full screen, step by step (P or ⌘↩)')} aria-label={t('Present')} disabled={!drawn?.svg}>
        <Icon name="play" /> <span className="tool-label">{t('Present')}</span> <kbd>P</kbd>
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
            {!p.hasSteps && (
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
              <Icon name="focus" /> Zoom to the selection <kbd>{keyHint('zoom-selection')}</kbd>
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
    </div>
  );
}
