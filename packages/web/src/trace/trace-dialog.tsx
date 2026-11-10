// The trace preview: the routes found on the left (↑↓ or 1–9 picks one), the sequence diagram of the
// one picked on the right, and what to do with it: open it as a new diagram (↵), add it to the model
// as a dynamic view (⌥↵), or copy its YAML. The preview is fitted; a click or Z shows it at its own size.
import { useEffect, useMemo, useRef, useState } from 'react';
import { render } from '@cartography/engine';
import { dynamicView, sequenceYaml, traceAsk, type DynamicView, type TraceAsk, type Traceable, type Traced, type TraceMeta } from '@cartography/trace';
import { Icon } from '../icon.tsx';
import { useRestoreFocus } from '../menu.tsx';

let ids = 0;

export function TraceDialog({
  traceable: t,
  ask,
  theme,
  meta,
  onOpen,
  onAddView,
  onClose,
}: {
  traceable: Traceable;
  ask: TraceAsk;
  theme: 'light' | 'dark';
  meta(r: Traced, n: number): TraceMeta;
  onOpen(yaml: string, r: Traced): void;
  /** Only for a model: its ids make a dynamic view. */
  onAddView?(d: DynamicView): void;
  onClose(): void;
}) {
  useRestoreFocus();
  const r = useMemo(() => traceAsk(t, { ...ask, limit: 9 }), [t, ask]);
  const [n, setN] = useState(0);
  const option = r.options[n];
  const m = option ? meta(r, n) : undefined;
  const yaml = useMemo(() => (option && m ? sequenceYaml(t.graph, option, m) : ''), [option, t, r, n]);
  const dynamic = useMemo(() => (option && m && onAddView ? dynamicView(t.graph, option, m) : undefined), [option, t, r, n, !!onAddView]);
  const [svg, setSvg] = useState<string>();
  const [copied, setCopied] = useState(false);
  /** The preview fitted whole, or at its own size to read (a click or Z switches). */
  const [actual, setActual] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void render(yaml, { theme, fonts: 'none', idPrefix: `trace${ids++}` })
      .then((x) => live && setSvg(x.svg))
      .catch(() => live && setSvg(undefined));
    return () => {
      live = false;
    };
  }, [yaml, theme]);
  useEffect(() => box.current?.focus(), []);

  const what = r.mode === 'between' ? 'routes' : r.mode === 'until' ? 'until it ends' : 'along the steps';
  const keys = (e: React.KeyboardEvent) => {
    const go = (i: number) => (e.preventDefault(), setN(Math.max(0, Math.min(r.options.length - 1, i))));
    if (e.key === 'Escape') (e.preventDefault(), onClose());
    else if (e.key === 'ArrowDown') go(n + 1);
    else if (e.key === 'ArrowUp') go(n - 1);
    else if (/^[1-9]$/.test(e.key) && Number(e.key) <= r.options.length) go(Number(e.key) - 1);
    else if (e.key.toLowerCase() === 'z' && !e.metaKey && !e.ctrlKey) (e.preventDefault(), setActual((a) => !a));
    else if (e.key === 'Enter' && e.altKey && dynamic && onAddView) (e.preventDefault(), onAddView(dynamic));
    else if (e.key === 'Enter' && option) (e.preventDefault(), onOpen(yaml, r));
  };
  const copy = async () => {
    await navigator.clipboard?.writeText(yaml).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette trace-dialog" role="dialog" aria-label="Trace a request" tabIndex={-1} ref={box} onKeyDown={keys} onMouseDown={(e) => e.stopPropagation()}>
        <header className="trace-head">
          <Icon name="arrow-left-right" />
          <strong>Trace a request</strong>
          <span className="trace-what">{what}</span>
          <kbd>esc</kbd>
        </header>
        <div className="trace-body">
          <ol className="trace-routes" role="listbox" aria-label="Routes">
            {r.options.map((o, i) => (
              <li key={i} role="option" aria-selected={i === n} className={i === n ? 'active' : ''} onClick={() => setN(i)} onDoubleClick={() => onOpen(sequenceYaml(t.graph, o, meta(r, i)), r)}>
                <span className="trace-n">{i + 1}</span>
                <span className="trace-summary">{o.summary}</span>
                <span className="trace-count">
                  {o.calls.length} call{o.calls.length === 1 ? '' : 's'}
                </span>
              </li>
            ))}
            {option?.notes.map((note, i) => (
              <li key={`n${i}`} className="trace-note" role="presentation">
                <Icon name="info" size={13} /> {note}
              </li>
            ))}
          </ol>
          <div
            className={actual ? 'trace-preview actual' : 'trace-preview'}
            aria-label={`Preview of the sequence diagram, ${actual ? 'at its own size' : 'fitted'}: click or Z to switch`}
            title={actual ? 'Fit the preview (Z)' : 'At its own size (Z)'}
            onClick={() => setActual((a) => !a)}
            dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
          />
        </div>
        <footer className="trace-actions">
          <button className="button ghost" onClick={copy}>
            <Icon name="copy" size={14} /> {copied ? 'Copied' : 'Copy YAML'}
          </button>
          {onAddView && (
            <button className="button ghost" disabled={!dynamic} onClick={() => dynamic && onAddView(dynamic)} title="Add these calls to the model's views: as a C4 dynamic view">
              Add as a dynamic view <kbd>⌥↵</kbd>
            </button>
          )}
          <button className="button primary" disabled={!option} onClick={() => onOpen(yaml, r)}>
            Open as a new diagram <kbd>↵</kbd>
          </button>
        </footer>
      </div>
    </div>
  );
}
