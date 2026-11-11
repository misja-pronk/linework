// The YAML: the editor (or its rail when folded) and the splitter between it and the drawing.
import './editor-pane.css';
import type { Diagnostic, LayoutSidecar } from '@cartography/core';
import { t } from '../i18n/index.ts';
import { Icon } from '../icon.tsx';
import { Editor, type EditorHandle } from '../editor.tsx';
import type { Panes } from '../pane-layout.ts';
import type { View } from '../start.tsx';
import type { Entry } from '../ranges.ts';

interface Props {
  editor: React.RefObject<EditorHandle | null>;
  panes: Panes;
  view: View;
  initial: string;
  initialPins: LayoutSidecar | undefined;
  diagnostics: Diagnostic[];
  source: string | undefined;
  mark: Entry | undefined;
  onChange(text: string): void;
  onCursor(pos: number): void;
  onPins(p: LayoutSidecar | undefined): void;
  split: number;
  setSplit(f: (s: number) => number): void;
  setYamlFolded(v: boolean): void;
  setForceYaml(v: boolean): void;
  /** The builder: the shapes to drag onto the drawing, in place of the YAML's strip. */
  onShapes(): void;
}

export function EditorPane(p: Props) {
  const { panes } = p;
  // Splitter between editor and drawing, by pointer or arrow keys.
  const dragSplit = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    // The YAML's wanted width, from its left edge (the file list is beside it in a folder).
    const left = el.parentElement!.getBoundingClientRect().left + panes.files;
    const move = (ev: PointerEvent) => p.setSplit(() => Math.min(0.7, Math.max(0.15, (ev.clientX - left) / window.innerWidth)));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return (
    <>
      {/* The YAML out of sight: a strip at the left edge with its name on it, and the builder's shapes. */}
      {panes.editorMode === 'rail' && (
        <div className="rail yaml-strip">
          <button
            className="rail-button yaml-rail"
            onClick={() => (panes.editorSqueezed ? p.setForceYaml(true) : (p.setYamlFolded(false), p.setForceYaml(true)))}
            title={panes.editorSqueezed ? t('Show the YAML (the window is narrow: the drawing gets less room)') : t('Show the YAML')}
            aria-label={t('Show the YAML')}
          >
            <Icon name="code" size={16} />
            <span className="rail-label">YAML</span>
          </button>
          <button className="rail-icon" onClick={p.onShapes} title={`${t('Builder: the drawing and the shapes to drag onto it')} (⌘\\)`} aria-label={t('Shapes')}>
            <Icon name="square-plus" size={16} />
          </button>
        </div>
      )}
      <section className="pane editor-pane" aria-label="YAML" hidden={panes.editorMode === 'rail'}>
        {p.view === 'code' && (
          <button className="icon-button small fold-yaml" onClick={() => p.setYamlFolded(true)} title={t('Fold the YAML to the side: more room for the drawing')} aria-label={t('Fold the YAML')}>
            <Icon name="panel-left-close" size={14} />
          </button>
        )}
        <Editor ref={p.editor} initial={p.initial} initialPins={p.initialPins} diagnostics={p.diagnostics} source={p.source} mark={p.mark} onChange={p.onChange} onCursor={p.onCursor} onPins={p.onPins} />
      </section>
      <div
        className="splitter"
        hidden={panes.editorMode === 'rail'}
        onPointerDown={dragSplit}
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={t('Resize editor')}
        aria-valuemin={20}
        aria-valuemax={70}
        aria-valuenow={Math.round(p.split * 100)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') p.setSplit((s) => Math.max(0.2, s - 0.02));
          else if (e.key === 'ArrowRight') p.setSplit((s) => Math.min(0.7, s + 0.02));
        }}
      />
    </>
  );
}
