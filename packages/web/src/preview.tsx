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
  /** A group dragged by its header to a new top-left (pin coordinates). */
  onMoveGroup(id: string, pin: Point, done: boolean): void;
  /** A palette item dropped at a point (pin coordinates), inside a group or not. */
  onPaletteDrop(index: number, at: Point, group: string | null): void;
  onKeyDown(e: React.KeyboardEvent): void;
  /** Dragged from one element's handle onto another. */
  onConnect(from: string, to: string): void;
  /** A drag that ends without a change (Escape, pointer lost). */
  onDragCancel(): void;
  /** Whether a node can start a connection (derived cards, matrices and contracts cannot). */
  canConnect(id: string): boolean;
  /** Whether a group can take a dragged node or a palette item. */
  canDrop(group: string, what: { node?: string; palette?: number }): boolean;
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
  mode: 'pan' | 'node' | 'connect' | 'group';
  moved: boolean;
  /** The group being moved, in group mode. */
  group?: string;
  vx: number;
  vy: number;
  node?: string;
  box?: Box;
  shift?: Point;
  /** Group outlines when the drag started, in pin space: the node's own group grows while it moves,
   * and the layout's origin can shift. */
  groups?: Map<string, Box>;
  parent?: string;
}

const MIN = 0.1;
const MAX = 4;
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v));
const BAR = 64;
/** Height of a group's label strip, which is where a group is picked up. */
const HEADER = 40;

const toPinSpace = (groups: Map<string, Box>, s: Point = { x: 0, y: 0 }) =>
  new Map([...groups].map(([id, b]) => [id, { ...b, x: b.x + s.x, y: b.y + s.y }]));

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
  const [dragging, setDragging] = useState<'pan' | 'node' | 'connect' | 'group'>();
  /** The node under the pointer, for its connect handle. */
  const [hover, setHover] = useState<string>();
  /** While connecting: where the pointer is (SVG coordinates) and the node it is over. */
  const [link, setLink] = useState<{ x: number; y: number; target?: string }>();
  const [dropTarget, setDropTarget] = useState<string | null>();
  const drag = useRef<Drag>(null);
  const fitted = useRef<number>(-1);
  const anchor = useRef<{ doc: number; x: number; y: number }>(null);
  const frameReq = useRef(0);
  /** The palette item being dragged in (dataTransfer cannot be read during dragover). */
  const paletteDrag = useRef<number>(undefined);
  useEffect(() => {
    const start = (e: DragEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-palette]') as HTMLElement | null;
      paletteDrag.current = el ? Number(el.dataset.palette) : undefined;
    };
    window.addEventListener('dragstart', start);
    return () => window.removeEventListener('dragstart', start);
  }, []);
  const hovered = useRef(false);

  /** The pane size the view was last placed for (see the resize observer below). */
  const paneSize = useRef({ w: 0, h: 0 });
  const fit = useCallback(() => {
    const f = frame.current;
    if (!f || !result?.width || !result.height) return;
    paneSize.current = { w: f.clientWidth, h: f.clientHeight };
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
    paneSize.current = { w: f.clientWidth, h: f.clientHeight };
    const ro = new ResizeObserver(() => {
      const dw = f.clientWidth - paneSize.current.w;
      const dh = f.clientHeight - paneSize.current.h;
      paneSize.current = { w: f.clientWidth, h: f.clientHeight };
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
    const handle = (e.target as Element).closest('[data-handle]') as HTMLElement | null;
    if (handle && !stale) {
      drag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, mode: 'connect', moved: true, vx: view.x, vy: view.y, node: handle.dataset.handle };
      setDragging('connect');
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    const hit = e.button === 0 ? ((e.target as Element).closest('[data-node]') as HTMLElement | null) : null;
    const id = hit?.dataset.node;
    const box = id ? result?.placed?.nodes.get(id) : undefined;
    // A group's header (its label strip) moves the whole group; the rest of it pans the canvas.
    const header = !id && e.button === 0 && !stale ? headerAt(toLayout(e.clientX, e.clientY)) : undefined;
    if (header) {
      drag.current = {
        pointer: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        mode: 'group',
        moved: false,
        vx: view.x,
        vy: view.y,
        group: header,
        box: result!.placed!.groups.get(header),
        shift: result?.placed?.shift ?? { x: 0, y: 0 },
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
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
      groups: result?.placed ? toPinSpace(result.placed.groups, result.placed.shift) : undefined,
      parent: id ? result?.graph?.nodes.find((n) => n.id === id)?.parent : undefined,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) {
      const over = ((e.target as Element).closest('[data-node],[data-handle]') as HTMLElement | null);
      const id = over?.dataset.node ?? over?.dataset.handle;
      if (id !== hover) setHover(id);
      return;
    }
    if (d.pointer !== e.pointerId) return;
    if (d.mode === 'connect') {
      const at = toLayout(e.clientX, e.clientY);
      const o = result?.origin ?? { x: 0, y: 0 };
      const under = (document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-node]') as HTMLElement | null)?.dataset.node;
      setLink({ x: at.x + o.x, y: at.y + o.y, target: under !== d.node ? under : undefined });
      return;
    }
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      // Selecting happens on release: opening the inspector now would shift the drawing under the pointer.
      setDragging(d.mode);
    }
    if (d.mode === 'pan') return setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
    if (d.mode === 'group') {
      const pin = { x: Math.round(d.box!.x + d.shift!.x + dx / view.scale), y: Math.round(d.box!.y + d.shift!.y + dy / view.scale) };
      cancelAnimationFrame(frameReq.current);
      frameReq.current = requestAnimationFrame(() => p.onMoveGroup(d.group!, pin, false));
      return;
    }
    const pin = { x: Math.round(d.box!.x + d.shift!.x + dx / view.scale), y: Math.round(d.box!.y + d.shift!.y + dy / view.scale) };
    cancelAnimationFrame(frameReq.current);
    frameReq.current = requestAnimationFrame(() => p.onMove(d.node!, pin, false));
    const target = dropGroup(d, e.clientX, e.clientY);
    setDropTarget(target !== (d.parent ?? null) ? target : undefined);
  };

  /** The innermost group whose header strip is under a layout point. */
  const headerAt = (q: Point): string | undefined => {
    let best: [string, number] | undefined;
    for (const [id, b] of result?.placed?.groups ?? [])
      if (q.x >= b.x && q.x <= b.x + b.width && q.y >= b.y && q.y <= b.y + HEADER && (!best || b.width * b.height < best[1])) best = [id, b.width * b.height];
    return best?.[0];
  };

  /** The group under the pointer that can take the dragged node (pin space, so shifts do not matter). */
  const dropGroup = (d: Drag, cx: number, cy: number): string | null => {
    const s = result?.placed?.shift ?? { x: 0, y: 0 };
    const at = toLayout(cx, cy);
    const g = groupAt(d.groups!, { x: at.x + s.x, y: at.y + s.y });
    if (g && g !== d.parent && !p.canDrop(g, { node: d.node })) return d.parent ?? null;
    return g;
  };

  const cancel = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    cancelAnimationFrame(frameReq.current);
    setDragging(undefined);
    setDropTarget(undefined);
    setLink(undefined);
    if ((d.mode === 'node' || d.mode === 'group') && d.moved) p.onDragCancel();
  };

  const end = (e: React.PointerEvent, cancelled: boolean) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    setDragging(undefined);
    setDropTarget(undefined);
    cancelAnimationFrame(frameReq.current);
    if (cancelled) {
      drag.current = d;
      return cancel();
    }
    if (d.mode === 'connect') {
      const target = link?.target;
      setLink(undefined);
      if (!cancelled && target) p.onConnect(d.node!, target);
      return;
    }
    if (cancelled) return;
    if (d.moved && d.mode === 'group') {
      const pin = { x: Math.round(d.box!.x + d.shift!.x + (e.clientX - d.x) / view.scale), y: Math.round(d.box!.y + d.shift!.y + (e.clientY - d.y) / view.scale) };
      p.onMoveGroup(d.group!, pin, true);
      p.onSelect({ kind: 'group', id: d.group! });
      return;
    }
    if (d.mode === 'group') {
      // A click on a header selects the group.
      p.onSelect({ kind: 'group', id: d.group! });
      return;
    }
    if (d.moved) {
      if (d.mode === 'node') {
        const pin = { x: Math.round(d.box!.x + d.shift!.x + (e.clientX - d.x) / view.scale), y: Math.round(d.box!.y + d.shift!.y + (e.clientY - d.y) / view.scale) };
        const target = dropGroup(d, e.clientX, e.clientY);
        p.onMove(d.node!, pin, true, target !== (d.parent ?? null) ? target : undefined);
        p.onSelect({ kind: 'node', id: d.node! });
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
    const g = groupAt(result.placed.groups, toLayout(e.clientX, e.clientY));
    setDropTarget(g && p.canDrop(g, { palette: paletteDrag.current }) ? g : undefined);
  };
  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(PALETTE_MIME);
    setDropTarget(undefined);
    if (!raw || !result?.placed) return;
    e.preventDefault();
    const at = toLayout(e.clientX, e.clientY);
    // Centre a card on the drop point; its exact size is known only after the next render.
    const g = groupAt(result.placed.groups, at);
    p.onPaletteDrop(Number(raw), toPin({ x: at.x - 90, y: at.y - 29 }), g && p.canDrop(g, { palette: Number(raw) }) ? g : null);
  };

  const box = selectedBox(result, selected);

  // A selection made elsewhere (editor, Tab, ⌘K, a new element) is brought into view when it is off screen.
  useEffect(() => {
    const f = frame.current;
    if (!f || !box || drag.current) return;
    const m = 40;
    const x0 = view.x + box.x * view.scale;
    const y0 = view.y + box.y * view.scale;
    const x1 = x0 + box.width * view.scale;
    const y1 = y0 + box.height * view.scale;
    const dx = x0 < m ? m - x0 : x1 > f.clientWidth - m ? Math.max(m - x0, f.clientWidth - m - x1) : 0;
    const dy = y0 < m + 50 ? m + 50 - y0 : y1 > f.clientHeight - m - 50 ? Math.max(m + 50 - y0, f.clientHeight - m - 50 - y1) : 0;
    if (dx || dy) setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    // Only when the selection changes, not on every view change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.kind, selected?.id, result]);
  const hoverBox = !dragging && hover && !stale && p.canConnect(hover) ? result?.placed?.nodes.get(hover) : undefined;
  const from = dragging === 'connect' && drag.current?.node ? result?.placed?.nodes.get(drag.current.node) : undefined;
  const linkTarget = link?.target ? result?.placed?.nodes.get(link.target) : undefined;
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
      onDoubleClick={(e) => {
        // Double-click: straight into the label field.
        const hit = (e.target as Element).closest('[data-node],[data-group]') as HTMLElement | null;
        if (!hit) return;
        p.onSelect(hit.dataset.node != null ? { kind: 'node', id: hit.dataset.node } : { kind: 'group', id: hit.dataset.group! });
        requestAnimationFrame(() => requestAnimationFrame(() => (document.querySelector('.inspector .field:nth-child(2) input') as HTMLInputElement | null)?.select()));
      }}
      onKeyDown={(e) => {
        if (drag.current && e.key === 'Escape') {
          e.preventDefault();
          return cancel();
        }
        p.onKeyDown(e);
      }}
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
          {from && link && (
            <svg className="link-line" width={result!.width} height={result!.height}>
              <line x1={from.x + from.width + o.x} y1={from.y + from.height / 2 + o.y} x2={link.x} y2={link.y} strokeWidth={2 / view.scale} />
            </svg>
          )}
          {linkTarget && (
            <div className="drop-ring" style={{ left: linkTarget.x + o.x - 5, top: linkTarget.y + o.y - 5, width: linkTarget.width + 10, height: linkTarget.height + 10, borderWidth: 2 / view.scale }} />
          )}
          {hoverBox && (
            <button
              className="connect-handle"
              data-handle={hover}
              title="Drag to another element to connect"
              aria-label={`Connect ${hover}`}
              tabIndex={-1}
              style={{ left: hoverBox.x + hoverBox.width + o.x, top: hoverBox.y + hoverBox.height / 2 + o.y, transform: `translate(-50%, -50%) scale(${1 / view.scale})` }}
            />
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
