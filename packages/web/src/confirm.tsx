// Asking before something is lost, in the app's own dialog (not the browser's confirm(), which looks
// like another program and stops everything): a question, the safe choice, and the one that goes on.
import { useCallback, useState } from 'react';
import { useModal } from './menu.tsx';

export interface Ask {
  title: string;
  text: string;
  /** The button that goes on (and loses something): "Discard", "Overwrite". */
  ok: string;
  /** The button that keeps things as they are. */
  cancel?: string;
}

/** `ask(…)` resolves true when the person chose to go on; `dialog` is rendered where the app's dialogs go. */
export function useConfirm() {
  const [open, setOpen] = useState<Ask & { done(ok: boolean): void }>();
  const ask = useCallback((a: Ask) => new Promise<boolean>((resolve) => setOpen({ ...a, done: (ok) => (setOpen(undefined), resolve(ok)) })), []);
  const dialog = open ? <ConfirmDialog {...open} /> : null;
  return { ask, dialog };
}

function ConfirmDialog(p: Ask & { done(ok: boolean): void }) {
  const modal = useModal();
  return (
    <div className="overlay" onMouseDown={() => p.done(false)}>
      <div
        className="palette confirm-dialog"
        role="alertdialog"
        ref={modal}
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-text"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') (e.preventDefault(), p.done(false));
        }}
      >
        <h2 id="confirm-title">{p.title}</h2>
        <p id="confirm-text">{p.text}</p>
        <div className="confirm-actions">
          <button className="button ghost" autoFocus onClick={() => p.done(false)}>
            {p.cancel ?? 'Cancel'}
          </button>
          <button className="button primary danger" onClick={() => p.done(true)}>
            {p.ok}
          </button>
        </div>
      </div>
    </div>
  );
}
