// Every keyboard shortcut, once: the "?" sheet, the hints in the palette and on buttons, and the key
// handlers all read this table, and a test (test/keys.test.ts) checks that no two shortcuts that are
// live at the same time share a key.
//
// A combo is written "mod+shift+d": mod is ⌘ on a Mac and Ctrl elsewhere. Letters match the letter
// typed whatever Caps Lock says (Shift is read from the Shift key, not from the case), except with ⌥,
// where a Mac types another character and the key's place counts. Keys that only make sense while the
// drawing has focus (⌘D, ⌘0, ⇧⌘D…) live in the drawing's context: elsewhere they stay the browser's.

export type KeyContext =
  /** Anywhere in the editor, also while typing in a field: only keys with ⌘ or a function key. */
  | 'anywhere'
  /** Anywhere but a text field (the YAML, a name, the Ask box). */
  | 'not-typing'
  /** A folder is open: the folder as one model (not while typing). */
  | 'folder'
  /** A folder is open, also while typing: search and rename everywhere. */
  | 'folder-anywhere'
  /** The drawing has focus (or, for zoom keys, the pointer). */
  | 'drawing'
  /** The drawing is in a focus (F). */
  | 'focus'
  /** The YAML editor has focus. */
  | 'editor'
  /** Writing a review note. */
  | 'note'
  /** A step's chip under the drawing has focus. */
  | 'step-chip'
  /** Presenting full screen: these keys and no others. */
  | 'present'
  /** Comparing versions: these keys before the editor's. */
  | 'compare'
  /** Mouse and trackpad: on the sheet, no key to press. */
  | 'mouse';

export interface Shortcut {
  id: string;
  /** What to press; the first one is shown. Empty for gestures and sequences (they have `show`). */
  keys: string[];
  /** On Windows and Linux, when the Mac's key is the browser's there (Ctrl+J opens the downloads). */
  pc?: string[];
  /** How the sheet writes it, when the keys alone do not say it ("Space drag"). */
  show?: string;
  what: string;
  context: KeyContext;
  /** The heading on the sheet. */
  group: string;
}

export const SHORTCUTS: Shortcut[] = [
  // ------------------------------------------------------------ anywhere
  { id: 'palette', keys: ['mod+k'], what: 'Commands, elements, templates', context: 'anywhere', group: 'Anywhere' },
  { id: 'ask', keys: ['mod+j'], pc: ['ctrl+i'], what: 'Ask Claude: a change or a question (↵ accepts a change, Esc rejects it)', context: 'anywhere', group: 'Anywhere' },
  { id: 'save', keys: ['mod+s'], what: 'Save', context: 'anywhere', group: 'Anywhere' },
  { id: 'open', keys: ['mod+o'], what: 'Open a file', context: 'anywhere', group: 'Anywhere' },
  { id: 'export-svg', keys: ['mod+e'], what: 'Export SVG', context: 'anywhere', group: 'Anywhere' },
  { id: 'export-png', keys: ['mod+shift+e'], what: 'Export PNG', context: 'anywhere', group: 'Anywhere' },
  { id: 'switch-view', keys: ['mod+\\'], what: 'Build visually ↔ YAML and drawing', context: 'anywhere', group: 'Anywhere' },
  { id: 'next-pane', keys: ['f6', 'shift+f6'], what: 'Next / previous pane: YAML, drawing, properties', context: 'anywhere', group: 'Anywhere' },
  { id: 'sheet', keys: ['?'], what: 'This sheet', context: 'not-typing', group: 'Anywhere' },
  { id: 'present', keys: ['p', 'mod+enter'], what: 'Present full screen (not while typing)', context: 'not-typing', group: 'Anywhere' },

  // ------------------------------------------------------------ the drawing
  { id: 'add', keys: ['a'], what: 'Add a shape', context: 'drawing', group: 'Drawing' },
  { id: 'connect', keys: ['c'], what: 'Connect the selected element to…', context: 'drawing', group: 'Drawing' },
  { id: 'cycle', keys: ['tab', 'shift+tab'], what: 'Next / previous element', context: 'drawing', group: 'Drawing' },
  { id: 'nearest', keys: ['alt+arrowleft', 'alt+arrowup', 'alt+arrowright', 'alt+arrowdown'], show: '⌥ ← ↑ → ↓', what: 'Nearest element in that direction', context: 'drawing', group: 'Drawing' },
  { id: 'nudge', keys: ['arrowleft', 'arrowup', 'arrowright', 'arrowdown', 'shift+arrowleft', 'shift+arrowup', 'shift+arrowright', 'shift+arrowdown'], show: '← ↑ → ↓', what: 'Nudge 8 px (⇧ for 40 px); it stays there, pinned (groups carry what they hold)', context: 'drawing', group: 'Drawing' },
  { id: 'delete', keys: ['backspace', 'delete'], what: 'Delete', context: 'drawing', group: 'Drawing' },
  { id: 'duplicate', keys: ['mod+d'], what: 'Duplicate', context: 'drawing', group: 'Drawing' },
  { id: 'copy', keys: ['mod+c'], what: 'Copy', context: 'drawing', group: 'Drawing' },
  { id: 'paste', keys: ['mod+v'], what: 'Paste', context: 'drawing', group: 'Drawing' },
  { id: 'select-all', keys: ['mod+a'], what: 'Select every shape', context: 'drawing', group: 'Drawing' },
  { id: 'edit', keys: ['enter', 'f2'], show: '↵ / F2 / double-click', what: 'Edit the selected element (↵ saves, Esc returns)', context: 'drawing', group: 'Drawing' },
  { id: 'escape', keys: ['escape'], what: 'Deselect; with nothing selected, leave the focus; cancel a drag', context: 'drawing', group: 'Drawing' },
  { id: 'undo', keys: ['mod+z'], what: 'Undo (text, edits and moves)', context: 'drawing', group: 'Drawing' },
  { id: 'redo', keys: ['mod+shift+z', 'mod+y'], what: 'Redo', context: 'drawing', group: 'Drawing' },
  { id: 'zoom', keys: ['mod+0', 'mod+=', 'mod++', 'mod+-'], show: '⌘0 / ⌘+ / ⌘−', what: 'Fit / zoom in / zoom out (with the pointer or focus on the drawing; elsewhere the browser zooms)', context: 'drawing', group: 'Drawing' },
  { id: 'fit', keys: ['shift+digit1'], what: 'Zoom to fit', context: 'drawing', group: 'Drawing' },
  { id: 'zoom-selection', keys: ['shift+digit2'], what: 'Zoom to the selection', context: 'drawing', group: 'Drawing' },
  { id: 'pan', keys: [], show: 'Space drag', what: 'Pan, from anywhere on the drawing', context: 'mouse', group: 'Mouse and trackpad' },
  { id: 'next-view', keys: ['v'], what: 'Next view (overview, detailed…); the YAML stays as it is', context: 'drawing', group: 'Drawing' },

  // ------------------------------------------------------------ focus
  { id: 'focus', keys: ['f'], what: 'Focus: only the selection and what is around it', context: 'drawing', group: 'Focus' },
  { id: 'focus-hops', keys: ['+', '=', '-'], show: '+ / −', what: 'One hop more / fewer', context: 'focus', group: 'Focus' },
  { id: 'focus-direction', keys: ['d'], what: 'Both ways, upstream, downstream', context: 'focus', group: 'Focus' },
  { id: 'focus-walk', keys: [], show: 'Tab, then F', what: 'Walk on to a neighbour', context: 'focus', group: 'Focus' },

  // ------------------------------------------------------------ arrange and layout
  { id: 'align-left', keys: ['alt+a'], what: 'Align left', context: 'drawing', group: 'Arrange' },
  { id: 'align-centre', keys: ['alt+h'], what: 'Align centre', context: 'drawing', group: 'Arrange' },
  { id: 'align-right', keys: ['alt+d'], what: 'Align right', context: 'drawing', group: 'Arrange' },
  { id: 'align-top', keys: ['alt+w'], what: 'Align top', context: 'drawing', group: 'Arrange' },
  { id: 'align-middle', keys: ['alt+v'], what: 'Align middle', context: 'drawing', group: 'Arrange' },
  { id: 'align-bottom', keys: ['alt+s'], what: 'Align bottom', context: 'drawing', group: 'Arrange' },
  { id: 'distribute-x', keys: ['alt+shift+h'], what: 'Distribute horizontally', context: 'drawing', group: 'Arrange' },
  { id: 'distribute-y', keys: ['alt+shift+v'], what: 'Distribute vertically', context: 'drawing', group: 'Arrange' },
  { id: 'pin', keys: ['shift+l'], what: 'Pin or unpin: unpinned, the layout places it', context: 'drawing', group: 'Arrange' },
  { id: 'lock', keys: ['mod+shift+l'], what: 'Lock or unlock in place', context: 'drawing', group: 'Arrange' },
  { id: 'tidy', keys: ['t'], what: 'Tidy: lay out again what is not pinned (Tidy all, which unpins everything, is in ⌘K)', context: 'drawing', group: 'Arrange' },
  { id: 'grid', keys: ['shift+g'], what: 'Snap to the 8 px grid', context: 'drawing', group: 'Arrange' },
  { id: 'minimap', keys: ['shift+m'], what: 'Minimap', context: 'drawing', group: 'Arrange' },
  { id: 'page', keys: ['shift+p'], what: 'The page (16:9 unless aspect: says), and text too small on it', context: 'drawing', group: 'Arrange' },
  { id: 'no-snap', keys: [], show: '⌥ while dragging', what: 'No snapping to guides or grid', context: 'mouse', group: 'Mouse and trackpad' },

  // ------------------------------------------------------------ notes
  { id: 'note', keys: ['n'], what: 'Add a note on the selection (nothing selected: in the middle of the view)', context: 'drawing', group: 'Review notes' },
  { id: 'notes', keys: ['shift+n'], what: 'Notes panel', context: 'drawing', group: 'Review notes' },
  { id: 'review', keys: ['shift+r'], what: 'Review mode: only the notes stand out', context: 'drawing', group: 'Review notes' },
  { id: 'note-send', keys: ['mod+enter'], what: 'Send the note', context: 'note', group: 'Review notes' },
  { id: 'note-cancel', keys: ['escape'], what: 'Cancel the note', context: 'note', group: 'Review notes' },
  { id: 'note-here', keys: [], show: 'Right-click', what: 'Add a note on an element, a line or a spot', context: 'mouse', group: 'Mouse and trackpad' },

  // ------------------------------------------------------------ steps
  { id: 'step', keys: ['s'], what: 'Add a step: the selection stands out in it', context: 'drawing', group: 'Steps' },
  { id: 'step-by', keys: ['[', ']'], show: '[ / ]', what: 'Previous / next step in the drawing', context: 'drawing', group: 'Steps' },
  { id: 'step-name', keys: ['f2'], what: 'Name the step', context: 'step-chip', group: 'Steps' },
  { id: 'step-move', keys: ['alt+arrowleft', 'alt+arrowright'], show: '⌥← / ⌥→', what: 'Move the step earlier / later', context: 'step-chip', group: 'Steps' },
  { id: 'step-remove', keys: ['backspace', 'delete'], what: 'Remove the step', context: 'step-chip', group: 'Steps' },

  // ------------------------------------------------------------ presenting
  { id: 'present-next', keys: ['arrowright', 'arrowdown', 'pagedown', 'space', 'enter'], show: '→ / Space', what: 'Next', context: 'present', group: 'Presenting' },
  { id: 'present-previous', keys: ['arrowleft', 'arrowup', 'pageup', 'shift+space'], show: '←', what: 'Previous', context: 'present', group: 'Presenting' },
  { id: 'present-ends', keys: ['home', 'end'], show: 'Home / End', what: 'First / last', context: 'present', group: 'Presenting' },
  { id: 'present-jump', keys: ['digit'], show: '3 ↵', what: 'Jump to a number', context: 'present', group: 'Presenting' },
  { id: 'present-blank', keys: ['b', '.'], show: 'B or .', what: 'Blank the screen', context: 'present', group: 'Presenting' },
  { id: 'present-whole', keys: ['a'], what: 'Everything, or the focus set with F', context: 'present', group: 'Presenting' },
  { id: 'present-full', keys: ['f'], what: 'Full screen on or off', context: 'present', group: 'Presenting' },
  { id: 'present-links', keys: ['tab', 'shift+tab'], show: 'Tab ↵ / ⌘-click', what: 'Follow a link (⌫ comes back)', context: 'present', group: 'Presenting' },
  { id: 'present-back', keys: ['backspace'], what: 'Back from a link', context: 'present', group: 'Presenting' },
  { id: 'present-stop', keys: ['escape'], what: 'Stop', context: 'present', group: 'Presenting' },

  // ------------------------------------------------------------ comparing
  { id: 'compare', keys: ['mod+shift+d'], what: 'Compare with last saved, a snapshot, another file or a commit', context: 'drawing', group: 'Comparing versions' },
  { id: 'snapshot', keys: ['mod+shift+s'], what: 'Take a snapshot to compare with later', context: 'drawing', group: 'Comparing versions' },
  { id: 'compare-next', keys: [']', 'j'], show: '] / J', what: 'Next change', context: 'compare', group: 'Comparing versions' },
  { id: 'compare-previous', keys: ['[', 'k'], show: '[ / K', what: 'Previous change', context: 'compare', group: 'Comparing versions' },
  { id: 'compare-edit', keys: ['enter'], what: 'Edit the change in focus', context: 'compare', group: 'Comparing versions' },
  { id: 'compare-mode', keys: ['m'], what: 'Overlay or side by side', context: 'compare', group: 'Comparing versions' },
  { id: 'compare-zoom', keys: ['0', '+', '=', '-'], show: '0 / + / −', what: 'Fit / zoom in / zoom out', context: 'compare', group: 'Comparing versions' },
  { id: 'compare-exit', keys: ['escape'], what: 'Back to editing', context: 'compare', group: 'Comparing versions' },

  // ------------------------------------------------------------ folder
  { id: 'search', keys: ['mod+p', 'mod+shift+f'], what: 'Search every diagram in the folder (↵ opens in focus, ⌥↵ only selects); without a folder ⌘P prints', context: 'folder-anywhere', group: 'Folder (one model)' },
  { id: 'drill', keys: ['mod+arrowdown'], show: '⌘↓ / double-click', what: 'Down into the selection: a system to its containers, an instance to its model', context: 'folder', group: 'Folder (one model)' },
  { id: 'up', keys: ['mod+arrowup'], what: 'Up a level', context: 'folder', group: 'Folder (one model)' },
  { id: 'back', keys: ['mod+['], what: 'Back (not in the YAML: there it outdents)', context: 'folder', group: 'Folder (one model)' },
  { id: 'forward', keys: ['mod+]'], what: 'Forward (not in the YAML: there it indents)', context: 'folder', group: 'Folder (one model)' },
  { id: 'rename-everywhere', keys: ['shift+f2'], what: 'Rename the selected element in every file', context: 'folder-anywhere', group: 'Folder (one model)' },

  // ------------------------------------------------------------ mouse and trackpad
  { id: 'drag', keys: [], show: 'Drag an element', what: 'Move it (pins it), snapping to guides; drop into a group to nest', context: 'mouse', group: 'Mouse and trackpad' },
  { id: 'drag-line', keys: [], show: 'Drag a selected line', what: 'Move that part of it (bends are kept)', context: 'mouse', group: 'Mouse and trackpad' },
  { id: 'unbend', keys: [], show: 'Double-click a bend', what: 'Take that bend out of the line', context: 'mouse', group: 'Mouse and trackpad' },
  { id: 'drag-group', keys: [], show: 'Drag a group header', what: 'Move the group with everything in it', context: 'mouse', group: 'Mouse and trackpad' },
  { id: 'drag-dot', keys: [], show: 'Drag the dot on an element', what: 'Connect it to another', context: 'mouse', group: 'Mouse and trackpad' },
  { id: 'drag-background', keys: [], show: 'Drag the background', what: 'Pan; pinch or ⌘ scroll to zoom', context: 'mouse', group: 'Mouse and trackpad' },
  { id: 'shift-click', keys: [], show: '⇧-click', what: 'Add to the selection, or take out of it', context: 'mouse', group: 'Mouse and trackpad' },

  // ------------------------------------------------------------ the YAML editor
  { id: 'complete', keys: ['ctrl+space'], what: 'Suggestions from the schema', context: 'editor', group: 'YAML editor' },
  { id: 'indent', keys: ['tab', 'shift+tab'], what: 'Indent two spaces (never a tab) / outdent', context: 'editor', group: 'YAML editor' },
  { id: 'indent-lines', keys: ['mod+]', 'mod+['], show: '⌘] / ⌘[', what: 'Indent / outdent the lines', context: 'editor', group: 'YAML editor' },
  { id: 'leave', keys: [], show: 'Esc, then Tab · F6', what: 'Leave the YAML for the next pane', context: 'editor', group: 'YAML editor' },
  { id: 'find', keys: ['mod+f'], what: 'Find', context: 'editor', group: 'YAML editor' },
  { id: 'comment', keys: ['mod+/'], what: 'Comment the line', context: 'editor', group: 'YAML editor' },
];

const byId = new Map(SHORTCUTS.map((s) => [s.id, s]));

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** The keys of a shortcut on this computer. */
export const keysOf = (s: Shortcut, mac = isMac) => (!mac && s.pc ? s.pc : s.keys);

const SYMBOL: Record<string, string> = {
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  enter: '↵',
  escape: 'Esc',
  backspace: '⌫',
  delete: '⌦',
  space: 'Space',
  tab: 'Tab',
  pagedown: 'PgDn',
  pageup: 'PgUp',
  home: 'Home',
  end: 'End',
  '-': '−',
};

/** "mod+shift+d" as people read it: ⇧⌘D on a Mac, Ctrl+Shift+D elsewhere. */
export function comboLabel(combo: string, mac = isMac): string {
  const parts = combo.split(/\+(?!$)/);
  const key = parts.pop()!;
  const name = SYMBOL[key] ?? (key.startsWith('digit') ? key.slice(5) : /^f\d+$/.test(key) ? key.toUpperCase() : key.length === 1 ? key.toUpperCase() : key);
  if (mac) {
    const order = ['ctrl', 'alt', 'shift', 'mod'];
    const sign: Record<string, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', mod: '⌘' };
    return order.filter((m) => parts.includes(m)).map((m) => sign[m]).join('') + name;
  }
  const word: Record<string, string> = { mod: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };
  return [...['mod', 'ctrl', 'alt', 'shift'].filter((m) => parts.includes(m)).map((m) => word[m]), name].join('+');
}

/** A shortcut's first key as a hint ("⌘K"), for buttons, tooltips and the palette. */
export function keyHint(id: string, mac = isMac): string {
  const s = byId.get(id);
  if (!s) throw new Error(`No shortcut ${id}`);
  const keys = keysOf(s, mac);
  return keys.length ? comboLabel(keys[0]!, mac) : (s.show ?? '');
}

/** How the sheet writes a shortcut: its own wording, or its keys (a pair joined by a slash). */
export function sheetKeys(s: Shortcut, mac = isMac): string {
  if (s.show && (mac || !s.pc)) return mac ? s.show : s.show.replace(/⌘/g, 'Ctrl+').replace(/⇧/g, 'Shift+').replace(/⌥/g, 'Alt+');
  const keys = keysOf(s, mac);
  return [...new Set(keys.slice(0, 2).map((k) => comboLabel(k, mac)))].join(' / ');
}

interface KeyEventLike {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Whether a key press is this combo. */
export function matches(e: KeyEventLike, combo: string, mac = isMac): boolean {
  const parts = combo.split(/\+(?!$)/);
  const key = parts.pop()!;
  const want = { mod: parts.includes('mod'), ctrl: parts.includes('ctrl'), alt: parts.includes('alt'), shift: parts.includes('shift') };
  // ⌘ on a Mac, Ctrl elsewhere; on a Mac, Ctrl stays the editor's (Emacs-style line keys) unless asked for.
  if (mac ? e.metaKey !== want.mod || e.ctrlKey !== want.ctrl : e.metaKey || e.ctrlKey !== (want.mod || want.ctrl)) return false;
  if (e.altKey !== want.alt) return false;
  // Shifted symbols (?, +) are typed with Shift: the symbol says it all.
  if (key.length === 1 && !/[a-z0-9]/.test(key)) return e.key === key && (want.shift || !e.shiftKey || /[?+!:{}|<>_~"]/.test(key));
  if (e.shiftKey !== want.shift) return false;
  if (key.startsWith('digit')) return e.code === `Digit${key.slice(5)}`;
  if (/^[a-z]$/.test(key)) return want.alt ? e.code === `Key${key.toUpperCase()}` : e.key.toLowerCase() === key || (e.key.length !== 1 && e.code === `Key${key.toUpperCase()}`);
  if (/^[0-9]$/.test(key)) return e.key === key;
  if (key === 'space') return e.key === ' ';
  return e.key.toLowerCase() === key;
}

/** The shortcut of these contexts a key press is, if any. */
export function shortcutFor(e: KeyEventLike, contexts: KeyContext[], mac = isMac): string | undefined {
  for (const s of SHORTCUTS) if (contexts.includes(s.context) && keysOf(s, mac).some((k) => k !== 'digit' && matches(e, k, mac))) return s.id;
  return undefined;
}

/** Whether a key press is the shortcut with this id. */
export const is = (e: KeyEventLike, id: string, mac = isMac) => keysOf(byId.get(id)!, mac).some((k) => matches(e, k, mac));

/**
 * The contexts live at the same time, by where the keys go: a test checks that none of them gives one
 * key two meanings. Typing (a field or the YAML) takes only "anywhere" keys, and the editor's own.
 */
export const TOGETHER: Record<string, KeyContext[]> = {
  drawing: ['anywhere', 'not-typing', 'drawing', 'folder', 'folder-anywhere'],
  'drawing in a focus': ['anywhere', 'not-typing', 'drawing', 'focus', 'folder', 'folder-anywhere'],
  yaml: ['anywhere', 'editor', 'folder-anywhere'],
  note: ['anywhere', 'note', 'folder-anywhere'],
  'step chip': ['anywhere', 'not-typing', 'step-chip', 'folder', 'folder-anywhere'],
  present: ['present'],
  compare: ['anywhere', 'compare'],
};
