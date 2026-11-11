// How the window is shared between the file list, the YAML (or the shapes), the drawing and the side
// panel. The drawing comes first: it keeps at least MIN_CANVAS, and what is around it gives way in a
// fixed order — the file list folds to a rail, the YAML narrows, and only then does the YAML fold too.
// With the side panel and a folder, a YAML that would be too narrow to read folds before the drawing
// gives way (review 3: at 1512 the YAML wrapped every line and the drawing had half the window).
// The decisions reserve room for the side panel whether or not it is open, so selecting something
// never reshuffles the left of the window: only the drawing narrows for the panel.

/** The least the drawing gets, unless somebody opens a folded pane on purpose. */
export const MIN_CANVAS = 640;
export const FILES = 208;
export const RAIL = 40;
export const SHAPES = 248;
export const MIN_EDITOR = 280;
/** Narrower than this, next to the side panel in a folder, the YAML wraps nearly every line: it folds instead. */
export const READABLE_EDITOR = 400;
export const SIDE = 300;
const SPLITTER = 1;

export interface PaneWants {
  /** The window's width. */
  width: number;
  /** A folder is open: there is a file list. */
  folder: boolean;
  /** The file list as people left it: open, or folded to a rail. */
  files: 'list' | 'rail';
  /** Building visually (shapes on the left) or writing YAML. */
  view: 'visual' | 'code';
  /** The YAML as people left it: its width, and whether they folded it. */
  editor: { width: number; folded: boolean };
  /** The YAML was opened from its rail on purpose: it stays open, even when the drawing gets less. */
  forceEditor?: boolean;
  /** Room is kept for the side panel (properties, Ask). */
  side: boolean;
}

export interface Panes {
  files: number;
  filesMode: 'none' | 'list' | 'rail';
  shapes: number;
  editor: number;
  /** The YAML is folded to a rail: by choice, or because there is no room for it. */
  editorMode: 'none' | 'open' | 'rail';
  /** Folded because there was no room, not by choice. */
  editorSqueezed: boolean;
  side: number;
  canvas: number;
}

export function paneLayout(w: PaneWants): Panes {
  const side = w.side ? SIDE : 0;
  const code = w.view === 'code';
  const shapes = code ? 0 : SHAPES;
  // What is left for the file list and the YAML once the drawing and the side panel have theirs.
  const room = (filesW: number) => w.width - side - shapes - filesW - MIN_CANVAS;
  let filesMode: Panes['filesMode'] = !w.folder ? 'none' : w.files;
  const filesW = () => (filesMode === 'list' ? FILES : filesMode === 'rail' ? RAIL : 0);
  const wantsEditor = code && !w.editor.folded;
  // The file list folds first: when the YAML (or the shapes) would not keep its least next to it.
  // Unless the YAML folds anyway (too narrow to read next to the side panel): then the list keeps its place.
  const yamlFolds = wantsEditor && !w.forceEditor && w.side && w.folder && room(RAIL) - SPLITTER < READABLE_EDITOR;
  if (filesMode === 'list' && room(FILES) - (yamlFolds ? RAIL : wantsEditor ? MIN_EDITOR + SPLITTER : 0) < 0) filesMode = 'rail';
  let editorMode: Panes['editorMode'] = !code ? 'none' : w.editor.folded && !w.forceEditor ? 'rail' : 'open';
  let editor = 0;
  let squeezed = false;
  if (editorMode === 'open') {
    const max = room(filesW()) - SPLITTER;
    const tooNarrow = max < MIN_EDITOR || (w.side && w.folder && max < READABLE_EDITOR && w.editor.width > max);
    if (tooNarrow && !w.forceEditor) {
      editorMode = 'rail';
      squeezed = true;
    } else editor = Math.round(Math.max(MIN_EDITOR, Math.min(w.editor.width, max)));
  }
  const used = side + shapes + filesW() + (editorMode === 'open' ? editor + SPLITTER : editorMode === 'rail' ? RAIL : 0);
  return { files: filesW(), filesMode, shapes, editor, editorMode, editorSqueezed: squeezed, side, canvas: w.width - used };
}

/** The grid's columns for a layout, in the order the panes stand in the markup. */
export function paneColumns(p: Panes, sideOpen: boolean): string {
  return [
    p.files ? `${p.files}px` : '',
    p.shapes ? `${p.shapes}px` : '',
    p.editorMode === 'open' ? `${p.editor}px ${SPLITTER}px` : p.editorMode === 'rail' ? `${RAIL}px` : '',
    'minmax(0, 1fr)',
    sideOpen ? `${p.side || SIDE}px` : '',
  ]
    .filter(Boolean)
    .join(' ');
}
