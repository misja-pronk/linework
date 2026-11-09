// The drawing: the engine's SVG with pan and zoom, click to select, drag to move (pins), drop into a
// group to nest, and drops from the add palette.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Box, Point } from '@cartography/core';
import type { RenderResult } from '@cartography/engine';
import { Icon } from './icon.tsx';
import { PALETTE_MIME } from './add-menu.tsx';

export interface Selection {
  kind: 'node' | 'group' | 'edge';
  id: string;
}

interface Props {
  result?: RenderResult;
  /** The drawing is from an earlier, valid version of the text. */
  stale?: boolean;
  selected?: Selection;
  /** Changes when another document is shown: the view fits again. */
  docKey: number;
  onSelect(s: Selection | undefined): void;
  /** A node dragged to a new top-left, in pin coordinates; `done` on release, with the group it was
   * dropped into when that changed (null: out of all groups). */
  onMove(id: string, pin: Point, done: boolean, group?: string | null): void;
  /** A palette item dropped at a point (pin coordinates), inside a group or not. */
  onPaletteDrop(index: number, at: Point, group: string | null): void;
  onKeyDown(e: React.KeyboardEvent): void;
  children?: React.ReactNode;
}

interface View {
  x: number;
  y: number;
  scale: number;
}

interface Drag {
  pointer: number;
  x: number;
  y: number;
  mode: 'pan' | 'node';
  moved: boolean;
  vx: number;
  vy: number;
  node?: string;
  box?: Box;
  shift?: Point;
  /** Group outlines when the drag started: the node's own group grows while it moves. */
  groups?: Map<string, Box>;
  parent?: string;
}

const MIN = 0.1;
const MAX = 4;
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v));
const BAR = 64;

/** Smallest group box that holds a point. */
function groupAt(groups: Map<string, Box>, p: Point): string | null {
  let best: [string, number] | null = null;
  for (const [id, b] of groups)
    if (p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height && (!best || b.width * b.height < best[1])) best = [id, b.width * b.height];
  return best?.[0] ?? null;
}

export function Preview(p: Props) {
  const { result, stale, selected, docKey } = p;
  const frame = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState<'pan' | 'node'>();
  const [dropTarget, setDropTarget] = useState<string | null>();
  const drag = useRef<Drag>(null);
  const fitted = useRef<number>(-1);
  const anchor = useRef<{ doc: number; x: number; y: number }>(null);
  const frameReq = useRef(0);
  const hovered = useRef(false);

  const fit = useCallback(() => {
    const f = frame.current;
    if (!f || !result?.width || !result.height) return;
    const pad = 32;
    const w = f.clientWidth - 2 * pad;
    const h = f.clientHeight - pad - BAR;
    const scale = clamp(Math.min(w / result.width, h / result.height, 1.25));
    setView({ scale, x: (f.clientWidth - result.width * scale) / 2, y: pad + Math.max(0, (h - result.height * scale) / 2) });
  }, [result?.width, result?.height]);

  // Fit once per document; afterwards keep what is on screen still. When the layout's origin moves
  // (a node dragged past the edge, a title added), shift the view so the drawing does not jump.
  useLayoutEffect(() => {
    if (!result?.svg || !result.origin) return;
    const shift = result.placed?.shift ?? { x: 0, y: 0 };
    const zero = { x: result.origin.x - shift.x, y: result.origin.y - shift.y };
    if (fitted.current !== docKey) {
      fitted.current = docKey;
      fit();
    } else if (anchor.current?.doc === docKey) {
      const dx = zero.x - anchor.current.x;
      const dy = zero.y - anchor.current.y;
      if (dx || dy) setView((v) => ({ ...v, x: v.x - dx * v.scale, y: v.y - dy * v.scale }));
    }
    anchor.current = { doc: docKey, ...zero };
  }, [result, docKey, fit]);

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

  // When the pane changes size (inspector opens, splitter moves), keep the centre where it was.
  useEffect(() => {
    const f = frame.current!;
    let size = { w: f.clientWidth, h: f.clientHeight };
    const ro = new ResizeObserver(() => {
      const dw = f.clientWidth - size.w;
      const dh = f.clientHeight - size.h;
      size = { w: f.clientWidth, h: f.clientHeight };
      if (dw || dh) setView((v) => ({ ...v, x: v.x + dw / 2, y: v.y + dh / 2 }));
    });
    ro.observe(f);
    return () => ro.disconnect();
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

  // Zoom keys only while the drawing has focus or the pointer: elsewhere they stay the browser's.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const f = frame.current;
      if (e.defaultPrevented || e.altKey || !(navigator.platform.startsWith('Mac') ? e.metaKey : e.ctrlKey)) return;
      if (!hovered.current && !f?.contains(document.activeElement)) return;
      if (e.key === '0') fit();
      else if (e.key === '=' || e.key === '+') zoomAt(1.2);
      else if (e.key === '-') zoomAt(1 / 1.2);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fit, zoomAt]);

  /** Screen point → layout point (what boxes use) and pin point (what the sidecar stores). */
  const toLayout = (clientX: number, clientY: number): Point => {
    const r = frame.current!.getBoundingClientRect();
    const o = result?.origin ?? { x: 0, y: 0 };
    return { x: (clientX - r.left - view.x) / view.scale - o.x, y: (clientY - r.top - view.y) / view.scale - o.y };
  };
  const toPin = (q: Point): Point => {
    const s = result?.placed?.shift ?? { x: 0, y: 0 };
    return { x: Math.round(q.x + s.x), y: Math.round(q.y + s.y) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    frame.current?.focus({ preventScroll: true });
    const hit = e.button === 0 ? ((e.target as Element).closest('[data-node]') as HTMLElement | null) : null;
    const id = hit?.dataset.node;
    const box = id ? result?.placed?.nodes.get(id) : undefined;
    drag.current = {
      pointer: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      mode: id && box && !stale ? 'node' : 'pan',
      moved: false,
      vx: view.x,
      vy: view.y,
      node: id,
      box,
      shift: result?.placed?.shift ?? { x: 0, y: 0 },
      groups: result?.placed ? new Map(result.placed.groups) : undefined,
      parent: id ? result?.graph?.nodes.find((n) => n.id === id)?.parent : undefined,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(d.mode);
      if (d.mode === 'node') p.onSelect({ kind: 'node', id: d.node! });
    }
    if (d.mode === 'pan') return setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
    const pin = { x: Math.round(d.box!.x + d.shift!.x + dx / view.scale), y: Math.round(d.box!.y + d.shift!.y + dy / view.scale) };
    cancelAnimationFrame(frameReq.current);
    frameReq.current = requestAnimationFrame(() => p.onMove(d.node!, pin, false));
    const target = groupAt(d.groups!, toLayout(e.clientX, e.clientY));
    setDropTarget(target !== (d.parent ?? null) ? target : undefined);
  };

  const end = (e: React.PointerEvent, cancelled: boolean) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    setDragging(undefined);
    setDropTarget(undefined);
    cancelAnimationFrame(frameReq.current);
    if (cancelled) return;
    if (d.moved) {
      if (d.mode === 'node') {
        const pin = { x: Math.round(d.box!.x + d.shift!.x + (e.clientX - d.x) / view.scale), y: Math.round(d.box!.y + d.shift!.y + (e.clientY - d.y) / view.scale) };
        const target = groupAt(d.groups!, toLayout(e.clientX, e.clientY));
        p.onMove(d.node!, pin, true, target !== (d.parent ?? null) ? target : undefined);
      }
      return;
    }
    if (e.button !== 0) return;
    // A click: the innermost element with an id under the pointer.
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-node],[data-edge],[data-group]') as HTMLElement | null;
    if (!hit) return p.onSelect(undefined);
    const kind = hit.dataset.node != null ? 'node' : hit.dataset.edge != null ? 'edge' : 'group';
    p.onSelect({ kind, id: hit.dataset[kind]! });
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(PALETTE_MIME) || !result?.placed) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropTarget(groupAt(result.placed.groups, toLayout(e.clientX, e.clientY)));
  };
  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(PALETTE_MIME);
    setDropTarget(undefined);
    if (!raw || !result?.placed) return;
    e.preventDefault();
    const at = toLayout(e.clientX, e.clientY);
    // Centre a card on the drop point; its exact size is known only after the next render.
    p.onPaletteDrop(Number(raw), toPin({ x: at.x - 90, y: at.y - 29 }), groupAt(result.placed.groups, at));
  };

  const box = selectedBox(result, selected);
  const target = dropTarget && result?.placed?.groups.get(dropTarget);
  const o = result?.origin ?? { x: 0, y: 0 };
  const empty = !result?.svg;

  return (
    <div
      className={`preview${dragging ? ` dragging-${dragging}` : ''}`}
      ref={frame}
      tabIndex={0}
      aria-label="Drawing. Tab moves between elements, arrows nudge, Delete removes."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => end(e, false)}
      onPointerCancel={(e) => end(e, true)}
      onPointerEnter={() => (hovered.current = true)}
      onPointerLeave={() => (hovered.current = false)}
      onDragOver={onDragOver}
      onDragLeave={() => setDropTarget(undefined)}
      onDrop={onDrop}
      onKeyDown={p.onKeyDown}
    >
      {empty ? (
        <div className="preview-empty">
          <Icon name="triangle-exclamation-point" size={20} />
          <p>Nothing to draw yet. Fix the problems in the editor, or start from a template.</p>
        </div>
      ) : (
        <div className={stale ? 'stage stale' : 'stage'} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
          <div className="drawing" dangerouslySetInnerHTML={{ __html: result!.svg! }} />
          {target && (
            <div className="drop-ring" style={{ left: target.x + o.x, top: target.y + o.y, width: target.width, height: target.height, borderWidth: 2 / view.scale }} />
          )}
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
      {p.children}
      <div className="zoom" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        <button onClick={() => zoomAt(1 / 1.2)} title="Zoom out (⌘−)" aria-label="Zoom out">
          <Icon name="minus" />
        </button>
        <button className="zoom-level" onClick={() => setView((v) => ({ ...v, scale: 1 }))} title="Actual size" aria-label={`Zoom ${Math.round(view.scale * 100)}%, click for actual size`}>
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
      const xs = e.points.map((q) => q.x);
      const ys = e.points.map((q) => q.y);
      b = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }
  }
  return b && { x: b.x + o.x, y: b.y + o.y, width: b.width, height: b.height };
}
