// The drawing: the engine's SVG with pan and zoom, hover, and click to select an element.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Box } from '@cartography/core';
import type { RenderResult } from '@cartography/engine';
import { Icon } from './icon.tsx';

export interface Selection {
  kind: 'node' | 'group' | 'edge';
  id: string;
}

interface Props {
  result?: RenderResult;
  /** The drawing is from an earlier, valid version of the text. */
  stale?: boolean;
  selected?: Selection;
  onSelect(s: Selection | undefined): void;
  /** Changes when a different document is loaded: the view fits again. */
  docKey: string;
}

interface View {
  x: number;
  y: number;
  scale: number;
}

const MIN = 0.1;
const MAX = 4;
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v));

export function Preview({ result, stale, selected, onSelect, docKey }: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const fitted = useRef<string>('');
  const pan = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean }>(null);

  const fit = useCallback(() => {
    const f = frame.current;
    if (!f || !result?.width || !result.height) return;
    const pad = 40;
    const scale = clamp(Math.min((f.clientWidth - 2 * pad) / result.width, (f.clientHeight - 2 * pad - 40) / result.height, 1.25));
    setView({ scale, x: (f.clientWidth - result.width * scale) / 2, y: Math.max(pad, (f.clientHeight - 40 - result.height * scale) / 2) });
  }, [result?.width, result?.height]);

  // Fit once per document; later edits keep the view where you left it.
  useLayoutEffect(() => {
    if (result?.svg && fitted.current !== docKey) {
      fitted.current = docKey;
      fit();
    }
  }, [result?.svg, docKey, fit]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const f = frame.current!;
    const px = cx ?? f.clientWidth / 2;
    const py = cy ?? f.clientHeight / 2;
    setView((v) => {
      const scale = clamp(v.scale * factor);
      const k = scale / v.scale;
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  }, []);

  // Wheel: pinch (ctrl) zooms around the pointer, two-finger scroll pans. Not passive, to stop page zoom.
  useEffect(() => {
    const f = frame.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = f.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    f.addEventListener('wheel', onWheel, { passive: false });
    return () => f.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key === '0') fit();
      else if (e.key === '=' || e.key === '+') zoomAt(1.2);
      else if (e.key === '-') zoomAt(1 / 1.2);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fit, zoomAt]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    pan.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = pan.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < 4) return;
    p.moved = true;
    setView((v) => ({ ...v, x: p.vx + dx, y: p.vy + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const p = pan.current;
    pan.current = null;
    if (p?.moved) return;
    // A click: the innermost element with an id under the pointer.
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-node],[data-edge],[data-group]') as HTMLElement | null;
    if (!hit) return onSelect(undefined);
    const kind = hit.dataset.node != null ? 'node' : hit.dataset.edge != null ? 'edge' : 'group';
    onSelect({ kind, id: hit.dataset[kind]! });
  };

  const box = selectedBox(result, selected);
  const empty = !result?.svg;

  return (
    <div className={`preview${pan.current?.moved ? ' panning' : ''}`} ref={frame} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      {empty ? (
        <div className="preview-empty">
          <Icon name="triangle-exclamation-point" size={20} />
          <p>Nothing to draw yet. Fix the problems in the editor, or start from a template.</p>
        </div>
      ) : (
        <div className={stale ? 'stage stale' : 'stage'} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
          <div className="drawing" dangerouslySetInnerHTML={{ __html: result!.svg! }} />
          {box && (
            <div
              className="selection-ring"
              style={{ left: box.x - 5, top: box.y - 5, width: box.width + 10, height: box.height + 10, borderWidth: 2 / view.scale }}
            />
          )}
        </div>
      )}
      {stale && !empty && (
        <div className="stale-note" role="status">
          <Icon name="circle-exclamation-point" size={14} /> Showing the last version that worked: fix the problems in the editor
        </div>
      )}
      <div className="zoom" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        <button onClick={() => zoomAt(1 / 1.2)} title="Zoom out (⌘−)" aria-label="Zoom out">
          <Icon name="minus" />
        </button>
        <button className="zoom-level" onClick={() => setView((v) => ({ ...v, scale: 1 }))} title="Actual size">
          {Math.round(view.scale * 100)}%
        </button>
        <button onClick={() => zoomAt(1.2)} title="Zoom in (⌘+)" aria-label="Zoom in">
          <Icon name="plus" />
        </button>
        <button onClick={fit} title="Fit to screen (⌘0)" aria-label="Fit to screen">
          <Icon name="maximize" />
        </button>
      </div>
    </div>
  );
}

/** The selected element's box in SVG coordinates. */
function selectedBox(result: RenderResult | undefined, s: Selection | undefined): Box | undefined {
  if (!result?.placed || !result.origin || !s) return undefined;
  const o = result.origin;
  let b: Box | undefined;
  if (s.kind === 'node') b = result.placed.nodes.get(s.id);
  else if (s.kind === 'group') b = result.placed.groups.get(s.id);
  else {
    const e = result.placed.edges.get(s.id);
    if (e?.points.length) {
      const xs = e.points.map((p) => p.x);
      const ys = e.points.map((p) => p.y);
      b = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }
  }
  return b && { x: b.x + o.x, y: b.y + o.y, width: b.width, height: b.height };
}
