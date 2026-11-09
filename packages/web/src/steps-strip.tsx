// The steps of the drawing as a strip under the canvas: click one to see the drawing at that step,
// and make, name, order and remove steps without typing YAML.
import { useEffect, useRef, useState } from 'react';
import type { StepState } from '@cartography/core';
import { Icon } from './icon.tsx';

export interface StepsStripProps {
  steps: StepState[];
  /** Steps nobody wrote (a sequence's messages, a dynamic view's numbered lines): to look at, not to edit. */
  implied?: boolean;
  /** The step drawn now (1-based); none is the whole drawing. */
  value?: number;
  /** How many elements are selected: they become the focus of a new step. */
  selected: number;
  /** A step that was just added, to name right away. */
  naming?: number;
  onNamed(): void;
  onPick(step: number | undefined): void;
  onAdd(): void;
  onRename(step: number, title: string): void;
  onMove(step: number, to: number): void;
  onDelete(step: number): void;
}

const short = (s: string, max = 28) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

export function StepsStrip(p: StepsStripProps) {
  const row = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<{ step: number; text: string }>();
  /** What had the keyboard before a name was typed: it gets it back. */
  const back = useRef<HTMLElement | null>(null);
  /** The chip that takes the keyboard after an edit moved or removed the one that had it. */
  const want = useRef<number>(undefined);
  const count = p.steps.length;
  const chip = (n: number) => row.current?.querySelector<HTMLElement>(`[data-step="${n}"]`);

  useEffect(() => {
    if (want.current == null) return;
    chip(Math.min(want.current, count))?.focus();
    want.current = undefined;
  }, [p.steps, count]);
  useEffect(() => {
    if (p.naming == null || p.naming > count || p.implied) return;
    name(p.naming);
    p.onNamed();
  }, [p.naming, count]);
  useEffect(() => {
    if (p.value) chip(p.value)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [p.value]);

  function name(step: number) {
    back.current = (document.activeElement as HTMLElement | null) ?? document.body;
    setEditing({ step, text: p.steps[step - 1]?.title ?? '' });
  }
  const done = (keep: boolean) => {
    // Enter closes the field, and the blur that follows must not save twice.
    const el = back.current;
    if (!editing || !el) return;
    back.current = null;
    const before = p.steps[editing.step - 1]?.title ?? '';
    const text = editing.text.trim();
    if (keep && text && text !== before) p.onRename(editing.step, text);
    setEditing(undefined);
    requestAnimationFrame(() => (el.isConnected && el !== document.body ? el : chip(editing.step))?.focus());
  };

  const onKey = (e: React.KeyboardEvent, n: number) => {
    if (e.metaKey || e.ctrlKey) return;
    const go = (to: number) => chip(Math.min(count, Math.max(0, to)))?.focus();
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const to = n + (e.key === 'ArrowLeft' ? -1 : 1);
      if (p.implied || n < 1 || to < 1 || to > count) return;
      p.onMove(n, to);
      chip(to)?.focus();
    } else if (e.key === 'ArrowLeft') go(n - 1);
    else if (e.key === 'ArrowRight') go(n + 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(count);
    else if (e.key === 'F2' && n > 0 && !p.implied) name(n);
    else if ((e.key === 'Backspace' || e.key === 'Delete') && n > 0 && !p.implied) {
      want.current = n > 1 ? n - 1 : 1;
      p.onDelete(n);
    } else return;
    e.preventDefault();
  };

  return (
    <div className="steps-strip" role="toolbar" aria-label="Steps">
      <span className="steps-title">
        <Icon name="layers" size={14} /> Steps
      </span>
      <div className="steps-row" ref={row}>
        <button className={p.value ? 'step-chip' : 'step-chip active'} data-step={0} onClick={() => p.onPick(undefined)} onKeyDown={(e) => onKey(e, 0)} aria-pressed={!p.value} title="The whole drawing, nothing standing back">
          All
        </button>
        {p.steps.map((s, i) => {
          const n = i + 1;
          const label = s.title ?? s.caption ?? '';
          if (editing?.step === n)
            return (
              <span key={n} className="step-chip editing">
                <b>{n}</b>
                <input
                  autoFocus
                  value={editing.text}
                  placeholder="Name this step"
                  aria-label={`Name of step ${n}`}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setEditing({ step: n, text: e.target.value })}
                  onBlur={() => done(true)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') done(true);
                    else if (e.key === 'Escape') done(false);
                  }}
                />
              </span>
            );
          return (
            <button
              key={n}
              className={p.value === n ? 'step-chip active' : 'step-chip'}
              data-step={n}
              onClick={() => p.onPick(n)}
              onDoubleClick={() => !p.implied && name(n)}
              onKeyDown={(e) => onKey(e, n)}
              aria-pressed={p.value === n}
              aria-label={`Step ${n}${label ? `: ${label}` : ''}`}
              title={[s.title, s.caption].filter(Boolean).join(' — ') || `Step ${n}`}
            >
              <b>{n}</b>
              {label && <span>{short(label)}</span>}
            </button>
          );
        })}
        {!p.implied && (
          <button className="step-chip add" onClick={p.onAdd} title={p.selected ? 'A new step with the selection in focus (S)' : 'A new step; select elements first to put them in focus (S)'}>
            <Icon name="plus" size={14} /> Step <kbd>S</kbd>
          </button>
        )}
      </div>
      <span className="steps-keys" aria-hidden="true">
        <kbd>[</kbd> <kbd>]</kbd> step
        {!p.implied && (
          <>
            {' · '}
            <kbd>F2</kbd> name · <kbd>⌥←→</kbd> move · <kbd>⌫</kbd> remove
          </>
        )}
      </span>
    </div>
  );
}
