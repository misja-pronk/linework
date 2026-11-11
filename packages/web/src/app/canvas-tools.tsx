// The drawing's toolbar: add, undo and redo, tidy, view, layers, focus, step, present, Your AI, and ⋯.
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
      <button className="tool" onClick={p.tidyLayout} title={t('Tidy: lay out again what is not pinned, pins stay (T)')} aria-label={t('Tidy')}>
        <Icon name="layout-grid" />
      </button>
      {p.canTidyAll && (
        <button className="tool tool-more" onClick={p.tidyAll} title={t('Tidy all: unpin everything and lay it out afresh (⌘Z undoes it)')} aria-label={t('Tidy all')}>
          <Icon name="pin-off" />
        </button>
      )}
      <ViewPicker views={drawn?.views} value={drawn?.view} asWritten={!drawn?.onlyViews} onChange={p.pickView} />
      {p.layersButton}
      <button className={drawn?.focus ? 'tool tool-more active' : 'tool tool-more'} onClick={p.focusOnSelection} title={t('Focus: only what is selected and what is around it (F)')} aria-label={t('Focus')} disabled={!p.hasSelection && !p.focusOn}>
        <Icon name="focus" /> <span className="tool-label">{t('Focus')}</span> <kbd>F</kbd>
      </button>
      {!p.hasSteps && (
        <button className="tool tool-more" onClick={p.addStep} title={t('A step to present: what is selected stands out in it (S)')} aria-label={t('Add a step')} disabled={!p.hasType}>
          <Icon name="layers" /> <span className="tool-label">{t('Step')}</span> <kbd>S</kbd>
        </button>
      )}
      <button className="tool" onClick={p.present} title={t('Present full screen, step by step (P or ⌘↩)')} aria-label={t('Present')} disabled={!drawn?.svg}>
        <Icon name="play" /> <span className="tool-label">{t('Present')}</span> <kbd>P</kbd>
      </button>
      <button className={p.asking ? 'tool active' : 'tool'} onClick={p.toggleAsk} title={t('Proposals from your own AI ({key})', { key: keyHint('ask') })} aria-label={t('Your AI')} aria-expanded={p.asking} disabled={!p.hasType}>
        <Icon name="sparkles" /> <span className="tool-label">{t('AI')}</span> <kbd>{keyHint('ask')}</kbd>{p.proposal && <span className="tool-count unread">1</span>}
      </button>
      {/* Compare and the view's switches, at every width (several items, so ⋯ never holds just one); in a narrow drawing also the tools that fold away, in the same order. */}
      <div className="menu-anchor tool-overflow">
        <button className={toolsMore ? 'tool active' : 'tool'} onClick={() => setToolsMore((m) => !m)} aria-expanded={toolsMore} aria-haspopup="menu" aria-label={t('More tools')} title={t('More: compare with an earlier version, zoom to the selection, grid, minimap')}>
          <span className="more-dots" aria-hidden="true">⋯</span>
        </button>
        {toolsMore && (
          <Menu onClose={() => setToolsMore(false)}>
            {p.canTidyAll && (
              <button role="menuitem" className="tool-folded" onClick={() => (setToolsMore(false), p.tidyAll())}>
                <Icon name="pin-off" /> {t('Tidy all')}
              </button>
            )}
            <button role="menuitem" className="tool-folded" onClick={() => (setToolsMore(false), p.focusOnSelection())} disabled={!p.hasSelection && !p.focusOn}>
              <Icon name="focus" /> {t('Focus')} <kbd>F</kbd>
            </button>
            {!p.hasSteps && (
              <button role="menuitem" className="tool-folded" onClick={() => (setToolsMore(false), p.addStep())} disabled={!p.hasType}>
                <Icon name="layers" /> {t('Add a step')} <kbd>S</kbd>
              </button>
            )}
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
