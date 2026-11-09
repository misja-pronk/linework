// "?": every shortcut on one sheet, so nothing has to be remembered from a manual.
import { useEffect } from 'react';
import { Icon } from './icon.tsx';
import { useRestoreFocus } from './menu.tsx';

const groups: [string, [string, string][]][] = [
  [
    'Anywhere',
    [
      ['⌘K', 'Commands, elements, templates'],
      ['⌘S', 'Save'],
      ['⌘O', 'Open a file'],
      ['⌘E / ⇧⌘E', 'Export SVG / PNG'],
      ['?', 'This sheet'],
    ],
  ],
  [
    'Drawing',
    [
      ['A', 'Add a shape'],
      ['C', 'Connect the selected element to…'],
      ['Tab / ⇧Tab', 'Next / previous element'],
      ['← ↑ → ↓', 'Nudge (⇧ for bigger steps)'],
      ['⌫', 'Delete'],
      ['⌘D', 'Duplicate'],
      ['Enter', 'Edit the selected element'],
      ['Esc', 'Deselect, or cancel a drag'],
      ['⌘Z / ⇧⌘Z', 'Undo / redo (text, edits and moves)'],
      ['⌘0 / ⌘+ / ⌘−', 'Fit / zoom in / zoom out'],
    ],
  ],
  [
    'Mouse and trackpad',
    [
      ['Drag an element', 'Move it (pins it); drop into a group to nest'],
      ['Drag a group header', 'Move the group with everything in it'],
      ['Drag the dot on an element', 'Connect it to another'],
      ['Drag the background', 'Pan; pinch or ⌘ scroll to zoom'],
    ],
  ],
  [
    'Editor',
    [
      ['Ctrl Space', 'Suggestions from the schema'],
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
