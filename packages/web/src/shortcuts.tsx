// "?": every shortcut on one sheet, so nothing has to be remembered from a manual.
import { useEffect } from 'react';
import { Icon } from './icon.tsx';
import { useRestoreFocus } from './menu.tsx';

const groups: [string, [string, string][]][] = [
  [
    'Anywhere',
    [
      ['⌘K', 'Commands, elements, templates'],
      ['⌘J', 'Ask Claude: a change or a question (⏎ accepts a change, Esc rejects it)'],
      ['⌘S', 'Save'],
      ['⌘O', 'Open a file'],
      ['⌘E / ⇧⌘E', 'Export SVG / PNG'],
      ['F6', 'Next pane: YAML, drawing, properties'],
      ['?', 'This sheet'],
    ],
  ],
  [
    'Drawing',
    [
      ['A', 'Add a shape'],
      ['C', 'Connect the selected element to…'],
      ['Tab / ⇧Tab', 'Next / previous element'],
      ['⌥ ← ↑ → ↓', 'Nearest element in that direction'],
      ['← ↑ → ↓', 'Nudge 8px (⇧ for 40px)'],
      ['⌫', 'Delete'],
      ['⌘D', 'Duplicate'],
      ['Enter / F2 / double-click', 'Edit the selected element (Enter saves, Esc returns)'],
      ['Esc', 'Deselect, or cancel a drag'],
      ['⌘Z / ⇧⌘Z', 'Undo / redo (text, edits and moves)'],
      ['⌘0 / ⌘+ / ⌘−', 'Fit / zoom in / zoom out'],
      ['⇧1 / ⇧2', 'Zoom to fit / to the selection'],
      ['V', 'Next view (overview, detailed…); the YAML stays as it is'],
    ],
  ],
  [
    'Folder (one model)',
    [
      ['⌘P / ⇧⌘F', 'Search every diagram: elements, views, files (↵ opens in focus, ⌥↵ only selects)'],
      ['⌘↓ / double-click', 'Down into the selection: a system to its containers, an instance to its model'],
      ['⌘↑', 'Up a level'],
      ['⌘[ / ⌘]', 'Back / forward'],
      ['⇧F2', 'Rename the selected element in every file'],
    ],
  ],
  [
    'Focus',
    [
      ['F', 'Only the selection and what is around it'],
      ['+ / −', 'One hop more / fewer'],
      ['D', 'Both ways, upstream, downstream'],
      ['Tab, then F', 'Walk on to a neighbour'],
      ['Esc', 'Back to the whole drawing'],
    ],
  ],
  [
    'Trace a request',
    [
      ['⇧Q', 'Two selected: a request from the first to the second; one: until it ends'],
      ['↑ ↓ or 1–9', 'Pick a route; Z shows the preview at its own size'],
      ['↵ / ⌥↵', 'Open as a new sequence diagram / add to the model as a dynamic view'],
    ],
  ],
  [
    'Arrange',
    [
      ['⌥A / ⌥H / ⌥D', 'Align left / centre / right'],
      ['⌥W / ⌥V / ⌥S', 'Align top / middle / bottom'],
      ['⇧⌥H / ⇧⌥V', 'Distribute horizontally / vertically'],
      ['↑ ↓ ← → / ⇧ arrows', 'Nudge the selection 8px / 40px (groups carry what they hold); it stays there, pinned'],
      ['⇧L', 'Pin or unpin: unpinned, the layout places it'],
      ['⇧⌘L', 'Lock or unlock in place'],
      ['T', 'Tidy: lay out again what is not pinned'],
      ['⇧T', 'Tidy all: unpin everything and lay out afresh'],
      ['⇧G', 'Snap to the 8px grid'],
      ['⇧M', 'Minimap'],
      ['⇧P', 'The page (16:9 slide unless aspect: says), and text too small on it'],
      ['⌥ while dragging', 'No snapping to guides or grid'],
    ],
  ],
  [
    'Review notes',
    [
      ['N', 'Add a note on the selection (nothing selected: in the middle of the view)'],
      ['⇧N', 'Notes panel'],
      ['⇧R', 'Review mode: only the notes stand out'],
      ['⌘↩ / Esc', 'In a note: send / cancel'],
      ['Right-click', 'Add a note on an element, a line or a spot'],
    ],
  ],
  [
    'Steps and presenting',
    [
      ['P / ⌘↩', 'Present full screen'],
      ['S', 'Add a step: the selection stands out in it'],
      ['[ / ]', 'Previous / next step in the drawing'],
      ['F2', 'Name the step (on its chip)'],
      ['⌥← / ⌥→', 'Move the step earlier / later (on its chip)'],
      ['⌫', 'Remove the step (on its chip)'],
      ['→ Space / ←', 'Presenting: next / previous'],
      ['Home / End', 'Presenting: first / last'],
      ['3 ↵', 'Presenting: jump to a number'],
      ['B or .', 'Presenting: blank the screen'],
      ['A', 'Presenting: everything, or the focus set with F'],
      ['Tab ↵ / ⌘-click', 'Presenting: follow a link, ⌫ comes back'],
      ['Esc', 'Presenting: stop'],
    ],
  ],
  [
    'Comparing versions',
    [
      ['⇧⌘D', 'Compare with last saved, a snapshot, another file or a commit'],
      ['⇧⌘S', 'Take a snapshot to compare with later'],
      ['N / P', 'Comparing: next / previous change'],
      ['↵', 'Comparing: edit the change in focus'],
      ['M', 'Comparing: overlay or side by side'],
      ['0 / + / −', 'Comparing: fit / zoom in / zoom out'],
      ['Esc', 'Comparing: back to editing'],
    ],
  ],
  [
    'Mouse and trackpad',
    [
      ['Drag an element', 'Move it (pins it), snapping to guides; drop into a group to nest'],
      ['Drag a selected line', 'Move that part of it (bends are kept)'],
      ['Double-click a bend', 'Take that bend out of the line'],
      ['Drag a group header', 'Move the group with everything in it'],
      ['Drag the dot on an element', 'Connect it to another'],
      ['Drag the background', 'Pan; pinch or ⌘ scroll to zoom'],
    ],
  ],
  [
    'Editor',
    [
      ['Ctrl Space', 'Suggestions from the schema'],
      ['Tab / ⇧Tab', 'Indent two spaces (never a tab) / outdent'],
      ['Esc, then Tab · F6', 'Leave the YAML for the next pane'],
      ['⌘F', 'Find'],
      ['⌘/', 'Comment line'],
    ],
  ],
];

export function Shortcuts({ onClose }: { onClose(): void }) {
  useRestoreFocus();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => (e.key === 'Escape' || e.key === '?') && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="shortcuts" role="dialog" aria-label="Keyboard shortcuts" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>
            <Icon name="keyboard" /> Shortcuts
          </h2>
          <button className="icon-button" onClick={onClose} aria-label="Close" autoFocus>
            <Icon name="x" />
          </button>
        </header>
        <div className="shortcut-grid">
          {groups.map(([title, rows]) => (
            <section key={title}>
              <h3>{title}</h3>
              <dl>
                {rows.map(([k, v]) => (
                  <div key={k}>
                    <dt>
                      <kbd>{k}</kbd>
                    </dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
