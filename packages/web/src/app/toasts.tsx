// Messages after an action: one at a time, gone after a few seconds, with an action to take (Undo).
import './toasts.css';
import { useCallback, useEffect, useState } from 'react';
import { t } from '../i18n/index.ts';

export interface ToastAction {
  label: string;
  run(): void;
}
export interface ToastMessage {
  message: string;
  tone?: 'error';
  action?: ToastAction;
  more?: ToastAction;
}
export type Notify = (message: string, opts?: Omit<ToastMessage, 'message'>) => void;

export function useToasts() {
  const [toast, setToast] = useState<ToastMessage>();
  const notify = useCallback<Notify>((message, opts = {}) => setToast({ message, ...opts }), []);
  useEffect(() => {
    if (!toast) return;
    // Gone within five seconds; one with an action to take waits a little longer for it.
    const t = setTimeout(() => setToast(undefined), toast.action ? 8000 : toast.tone ? 5000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);
  const clear = () => setToast(undefined);
  /** The "undo open" offer ends with the first edit or move: undoing the open would throw that away. */
  const endUndoOffer = () => setToast((ts) => (ts?.action?.label === t('Undo') ? undefined : ts));
  return { toast, notify, clear, endUndoOffer };
}

/**
 * Puts a toast at the top left of the drawing, under its chips and notes: clear of the toolbar, the
 * zoom and the hint along the bottom, a panel or an open popover. In a session (nothing at the top but
 * the title) it sits over the toolbar and its keys, centred. Without a drawing on screen (a phone on the
 * YAML tab) it stays at the bottom of the window.
 */
function dockToast(el: HTMLDivElement | null) {
  if (!el) return;
  const pane = document.querySelector('.canvas-pane')?.getBoundingClientRect();
  if (!pane?.width) return el.classList.remove('docked');
  if (document.querySelector('.app.in-session')) {
    el.classList.remove('docked');
    el.style.top = el.style.left = '';
    const tops = [...document.querySelectorAll('.canvas-tools, .session-keys')].map((x) => x.getBoundingClientRect()).filter((r) => r.height).map((r) => r.top);
    el.style.bottom = `${window.innerHeight - Math.min(window.innerHeight - 44, ...tops) + 8}px`;
    return;
  }
  const top = [...document.querySelectorAll('.canvas-top > *')].filter((x) => (x as HTMLElement).offsetParent);
  el.classList.add('docked');
  el.style.bottom = '';
  el.style.top = `${Math.max(pane.top + 16, ...top.map((x) => x.getBoundingClientRect().bottom + 8))}px`;
  el.style.left = `${pane.left + 16}px`;
  el.style.maxWidth = `${pane.width - 32}px`;
}

export function Toast({ toast, onDone }: { toast: ToastMessage; onDone(): void }) {
  return (
    <div className={toast.tone === 'error' ? 'toast error' : 'toast'} role={toast.tone === 'error' ? 'alert' : 'status'} ref={dockToast}>
      {toast.message}
      {toast.action && (
        <button
          onClick={() => {
            toast.action!.run();
            onDone();
          }}
        >
          {toast.action.label}
        </button>
      )}
      {toast.more && (
        <button
          onClick={() => {
            toast.more!.run();
            onDone();
          }}
        >
          {toast.more.label}
        </button>
      )}
    </div>
  );
}
