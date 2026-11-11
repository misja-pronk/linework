// A small dropdown: focus moves in, arrows move between items, Escape or a click outside closes it.
import './menu.css';
import { useEffect, useRef, useState } from 'react';

/** An item a narrow layout hides (display: none) is skipped by the arrows. */
const shown = (x: HTMLElement) => x.getClientRects().length > 0;

export function Menu({ onClose, children }: { onClose(): void; children: React.ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    [...(el.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].find(shown)?.focus();
    const outside = (e: PointerEvent) => {
      if (!el.current?.parentElement?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('pointerdown', outside);
      before?.focus?.();
    };
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = [...(el.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])].filter(shown);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus();
    else if (e.key === 'Tab') onClose();
    else return;
    if (e.key !== 'Tab') e.preventDefault();
  };

  return (
    <div className="menu" role="menu" ref={el} onKeyDown={onKeyDown} onClick={onClose}>
      {children}
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
/** The open modals, the newest last: only that one keeps Tab. */
const modals: HTMLElement[] = [];
/** Where each open modal gives focus back to. */
const openers = new WeakMap<HTMLElement, HTMLElement>();

/** Puts focus back where it was when a dialog closes. */
export function useRestoreFocus(box?: React.RefObject<HTMLElement | null>) {
  // Read while rendering: by the time an effect runs, an autoFocus field inside has taken focus.
  const [before] = useState(() => document.activeElement as HTMLElement | null);
  // Opened from another modal that closes with it (a palette): back to what opened that one.
  const [chain] = useState(() => {
    const from = modals.find((m) => m.contains(before));
    return from && openers.get(from);
  });
  // Kept across a second run of the effect (strict mode), when focus is inside already.
  const back = useRef<HTMLElement | null>(null);
  useEffect(() => {
    // Opened from a menu item: the item is gone by now and its menu has put focus on the menu's button.
    const now = document.activeElement as HTMLElement | null;
    back.current ??= [before, chain, now].find((x) => x?.isConnected && x !== document.body && !box?.current?.contains(x)) ?? null;
    if (box?.current && back.current) openers.set(box.current, back.current);
    return () => {
      // Only when nothing else took focus meanwhile (a command may have focused the drawing).
      requestAnimationFrame(() => {
        const now = document.activeElement;
        if ((!now || now === document.body) && back.current?.isConnected) back.current.focus?.();
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * A modal dialog: focus moves in (to what has autoFocus, else the first control, else the dialog), Tab and
 * ⇧Tab go round inside it, and focus goes back to the opener on close. Each dialog keeps its own Escape.
 * Put the returned ref, and aria-modal="true", on the element with role="dialog".
 */
export function useModal<T extends HTMLElement = HTMLDivElement>(given?: React.RefObject<T | null>) {
  const own = useRef<T>(null);
  const ref = given ?? own;
  useRestoreFocus(ref);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    modals.push(box);
    const inside = () => [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(shown);
    if (!box.contains(document.activeElement)) {
      const first = inside()[0];
      if (first) first.focus();
      else {
        if (!box.hasAttribute('tabindex')) box.tabIndex = -1;
        box.focus();
      }
    }
    const tab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || modals.at(-1) !== box) return;
      const all = inside();
      const at = document.activeElement;
      let to: HTMLElement | undefined;
      if (!all.length) to = box;
      else if (!box.contains(at)) to = e.shiftKey ? all.at(-1) : all[0];
      else if (e.shiftKey && (at === all[0] || at === box)) to = all.at(-1);
      else if (!e.shiftKey && at === all.at(-1)) to = all[0];
      if (to) (e.preventDefault(), to.focus());
    };
    document.addEventListener('keydown', tab, true);
    return () => {
      document.removeEventListener('keydown', tab, true);
      modals.splice(modals.indexOf(box), 1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}
