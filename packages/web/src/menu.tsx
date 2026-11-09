// A small dropdown: focus moves in, arrows move between items, Escape or a click outside closes it.
import { useEffect, useRef } from 'react';

export function Menu({ onClose, children }: { onClose(): void; children: React.ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    el.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
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
    const items = [...(el.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
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

/** Puts focus back where it was when a dialog closes. */
export function useRestoreFocus() {
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => {
      requestAnimationFrame(() => before?.isConnected && before.focus?.());
    };
  }, []);
}
