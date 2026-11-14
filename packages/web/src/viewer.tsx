// The read-only viewer of a share link: the diagram comes out of the link's #fragment, which the
// browser never sends to a server. Pan and zoom, views, presenting and exports work as in the
// editor; "Open in editor" makes it a new document of this browser's own.
import './app/topbar.css';
import './viewer.css';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { decodeShare, type SharedDiagram } from '@linework/core';
import { useRender } from './use-render.ts';
import { Present } from './present.tsx';
import { Icon } from './icon.tsx';
import { t } from './i18n/index.ts';
import { showBuiltin } from './brand.ts';
import { pickedView, viewChoices } from './view-picker.tsx';
import { baseName, download, exportPdf, exportPng, exportPptx, exportSvg, yamlName, type ExportInput } from './export.ts';

/** The hash that opens a shared diagram in the editor as a document of its own. */
export const OPEN_KEY = 'open';

function useSystemDark() {
  const q = useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), []);
  const [dark, setDark] = useState(q.matches);
  useEffect(() => {
    const on = () => setDark(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, [q]);
  return dark;
}

export function Viewer({ value }: { value: string }) {
  const [shared, setShared] = useState<SharedDiagram | null>();
  useEffect(() => {
    void decodeShare(value).then((d) => {
      // The theme the sender picked, for this page only: the reader's own editor choice stays as it is.
      if (d?.theme) showBuiltin(d.theme);
      setShared(d ?? null);
    });
  }, [value]);
  const theme = useSystemDark() ? 'dark' : 'light';
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  if (shared === undefined) return <div className="viewer-empty">{t('Opening the shared diagram…')}</div>;
  if (shared === null)
    return (
      <div className="viewer-empty">
        <p>{t('This link does not hold a diagram: it may have been cut short when it was copied.')}</p>
        <a className="button primary" href={location.pathname}>
          {t('Open the editor')}
        </a>
      </div>
    );
  return <Shared doc={shared} value={value} theme={theme} />;
}

function Shared({ doc, value, theme }: { doc: SharedDiagram; value: string; theme: 'light' | 'dark' }) {
  const [view, setView] = useState<string>();
  const [presenting, setPresenting] = useState(false);
  const [message, setMessage] = useState<string>();
  const name = doc.name ?? 'shared.yaml';
  const { rendered } = useRender(doc.yaml, theme, doc.layout, undefined, 0, view, name);
  const result = rendered?.drawn ?? rendered?.result;
  const errors = rendered?.result.diagnostics.filter((d) => d.severity === 'error') ?? [];
  const title = result?.graph?.title ?? baseName(name);
  // The views as the editor's picker offers them: a type's own view as written is named, not "As written".
  const choices = viewChoices(result);
  useEffect(() => {
    document.title = `${title} · Linework`;
  }, [title]);

  // Pan and zoom: the drawing fits at first; the wheel zooms at the pointer, a drag moves it.
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ x: 0, y: 0, k: 1 });
  const fit = () => {
    const el = box.current;
    if (!el || !result?.width || !result.height) return;
    const k = Math.min(1.5, (el.clientWidth - 48) / result.width, (el.clientHeight - 48) / result.height);
    setAt({ k, x: (el.clientWidth - result.width * k) / 2, y: (el.clientHeight - result.height * k) / 2 });
  };
  useEffect(fit, [result?.width, result?.height]);
  const zoom = (f: number, cx?: number, cy?: number) =>
    setAt((a) => {
      const el = box.current;
      const x = cx ?? (el ? el.clientWidth / 2 : 0);
      const y = cy ?? (el ? el.clientHeight / 2 : 0);
      const k = Math.min(8, Math.max(0.1, a.k * f));
      return { k, x: x - ((x - a.x) * k) / a.k, y: y - ((y - a.y) * k) / a.k };
    });
  const onWheel = (e: ReactWheelEvent) => {
    const r = box.current!.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) zoom(Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top);
  };
  const drag = useRef<{ x: number; y: number } | undefined>(undefined);
  const onDown = (e: ReactPointerEvent) => {
    drag.current = { x: e.clientX - at.x, y: e.clientY - at.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => drag.current && setAt((a) => ({ ...a, x: e.clientX - drag.current!.x, y: e.clientY - drag.current!.y }));
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (presenting || (e.target as Element).closest?.('select')) return;
      if (e.key === '+' || e.key === '=') zoom(1.25);
      else if (e.key === '-') zoom(0.8);
      else if (e.key === '0') fit();
      else if (e.key === 'p' || e.key === 'P') setPresenting(true);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const input = (): ExportInput => ({ text: doc.yaml, theme, sidecar: doc.layout, view: result?.view ?? view, file: name });
  const attempt = (run: () => Promise<void>) => () => void run().catch((e: unknown) => setMessage(t('Export failed: {error}', { error: e instanceof Error ? e.message : String(e) })));
  const base = baseName(name);
  // A document of this browser's own: the editor opens it from the same link data, with an undo.
  const openInEditor = () => {
    location.href = `${location.pathname}#${OPEN_KEY}=${value}`;
    location.reload();
  };

  return (
    <div className="viewer">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          Linework
        </div>
        <div className="doc-name">
          <Icon name="eye" />
          <span>{title}</span>
          <span className="type-pill">{t('Read-only')}</span>
        </div>
        <div className="actions">
          {choices && choices.views.length > 1 && (
            <select className="viewer-views" aria-label={t('View')} value={choices.value} onChange={(e) => setView(pickedView(e.target.value, choices.written, choices.canvas))}>
              {choices.asWritten && <option value="">{t('Whole diagram')}</option>}
              {choices.views.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.title ?? v.name}
                </option>
              ))}
            </select>
          )}
          <button className="button ghost" onClick={() => setPresenting(true)} title={t('Present, step by step (P)')}>
            <Icon name="play" /> {t('Present')}
          </button>
          <button className="button ghost" onClick={attempt(async () => download(`${base}.svg`, await exportSvg(input()), 'image/svg+xml'))}>
            SVG
          </button>
          <button className="button ghost" onClick={attempt(async () => download(`${base}.png`, await exportPng(input(), 2)))}>
            PNG
          </button>
          <button className="button ghost" onClick={attempt(async () => download(`${base}.pptx`, (await exportPptx(input(), yamlName(name))).blob))}>
            PowerPoint
          </button>
          <button className="button ghost" onClick={attempt(async () => download(`${base}.pdf`, await exportPdf(input(), yamlName(name))))}>
            PDF
          </button>
          <button className="button ghost" onClick={() => download(yamlName(name), doc.yaml, 'text/yaml')}>
            YAML
          </button>
          <button className="button primary" onClick={openInEditor} title={t('Copy it into a new document in this browser, to change it')}>
            <Icon name="file-plus" /> {t('Open in editor')}
          </button>
        </div>
      </header>
      <p className="viewer-note">
        <Icon name="shield-check" size={14} /> {t('The diagram is inside this link, after the #. Browsers never send that part to a server: nothing was uploaded, and nothing is stored until you open it in the editor.')}
      </p>
      {message && (
        <p className="viewer-note error" role="alert">
          {message}
        </p>
      )}
      <div className="viewer-stage" ref={box} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = undefined)} data-testid="viewer-stage">
        {result?.svg ? (
          <div className="viewer-drawing" style={{ transform: `translate(${at.x}px, ${at.y}px) scale(${at.k})` }} dangerouslySetInnerHTML={{ __html: result.svg }} />
        ) : rendered ? (
          <div className="viewer-empty">
            <p>{t('The diagram in this link has problems:')}</p>
            <ul>
              {errors.slice(0, 5).map((d, i) => (
                <li key={i}>
                  {t('line {line}: {message}', { line: d.line ?? '', message: d.message })}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="viewer-zoom">
          <button className="icon-button" onClick={() => zoom(0.8)} aria-label={t('Zoom out')} title={t('Zoom out (-)')}>
            <Icon name="minus" />
          </button>
          <button className="icon-button" onClick={fit} aria-label={t('Fit')} title={t('Fit (0)')}>
            <Icon name="maximize" />
          </button>
          <button className="icon-button" onClick={() => zoom(1.25)} aria-label={t('Zoom in')} title={t('Zoom in (+)')}>
            <Icon name="plus" />
          </button>
        </div>
      </div>
      {presenting && <Present doc={{ text: doc.yaml, file: name, sidecar: doc.layout }} theme={theme} view={result?.view} onClose={() => setPresenting(false)} />}
    </div>
  );
}
