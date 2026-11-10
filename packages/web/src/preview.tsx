// The drawing: the engine's SVG with pan and zoom, click to select, drag to move (pins), drop into a
// group to nest, and drops from the add palette.
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { Box, Point } from '@cartography/core';
import type { RenderResult } from '@cartography/engine';
import { Icon } from './icon.tsx';
import { PALETTE_MIME } from './add-menu.tsx';
import { bendsOf, dragSegment, isHorizontal, nearestSegment, snapBox, union, viewFor, type Snap } from './craft.ts';
import { BendHandles, Guides, LockBadges, Minimap } from './craft-overlays.tsx';

export interface Selection {
  kind: 'node' | 'group' | 'edge';
  id: string;
}

/** Zoom commands the app's palette can run. */
export interface PreviewControl {
  fit(): void;
  zoomToSelection(): void;
}

/** What a label editor can be opened on: an element, or the diagram's title and subtitle. */
export type LabelTarget = Selection | { kind: 'title' | 'subtitle'; id: '' };

interface Props {
  result?: RenderResult;
  /** The drawing is from an earlier, valid version of the text. */
  stale?: boolean;
  /** Everything selected; one element for a plain selection. */
  selection: Selection[];
  /** Changes when another document (or another of its views) is shown: the view fits again. */
  docKey: number | string;
  /** `toggle`: shift-click adds or removes it instead of replacing the selection. */
  onSelect(s: Selection | undefined, toggle?: boolean): void;
  /** A marquee dragged over empty canvas: what is wholly inside it (`add`: shift held). */
  onSelectMany(list: Selection[], add: boolean): void;
  /** The text a label editor starts with, or undefined when it cannot be edited in place. */
  labelOf(t: LabelTarget): string | undefined;
  onLabel(t: LabelTarget, text: string): void;
  /** A node dragged to a new top-left, in pin coordinates; `done` on release, with the group it was
   * dropped into when that changed (null: out of all groups). */
  onMove(id: string, pin: Point, done: boolean, group?: string | null): void;
  /** A group dragged by its header to a new top-left (pin coordinates). */
  onMoveGroup(id: string, pin: Point, done: boolean): void;
  /** A palette item dropped into a group, or into free space at a point (pin coordinates). Without
   * a point the layout places it. */
  onPaletteDrop(index: number, at: Point | undefined, group: string | null): void;
  onKeyDown(e: React.KeyboardEvent): void;
  /** Dragged from one element's handle onto another. */
  onConnect(from: string, to: string): void;
  /** A drag that ends without a change (Escape, pointer lost). */
  onDragCancel(): void;
  /** Whether a node can start a connection (derived cards, matrices and contracts cannot). */
  canConnect(id: string): boolean;
  /** Whether a group can take a dragged node or a palette item. */
  canDrop(group: string, what: { node?: string; palette?: number }): boolean;
  /** ⌘-click (Ctrl elsewhere): follow the element's link instead of selecting it; true when it had one. */
  onFollow?(s: Selection): boolean;
  /** Elements that cannot be dragged by accident: dragging them pans instead. */
  locked?: Set<string>;
  /** Lines with bends set by hand. */
  bent?: Set<string>;
  /** Snap to the 8px grid where no guide is near. */
  grid?: boolean;
  /** Show the overview when the drawing does not fit. */
  minimap?: boolean;
  onToggle?(what: 'grid' | 'minimap'): void;
  /** A segment of the selected line dragged: the line's new bends (pin space); `done` on release. */
  onBend?(id: string, via: Point[], done: boolean): void;
  /** What a screen reader hears for the focused element. */
  describe?(s: Selection): string;
  control?: React.Ref<PreviewControl>;
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
  mode: 'pan' | 'node' | 'connect' | 'group' | 'marquee' | 'bend';
  moved: boolean;
  /** Moving several selected nodes at once: no regrouping on drop. */
  many?: boolean;
  shiftKey?: boolean;
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
  /** What moves, as one box (pin space, as at the start), and the ids that move with it. */
  moving?: Box;
  movingIds?: string[];
  /** Bend mode: the line, its points (pin space) and the segment being moved. */
  edge?: string;
  pts?: Point[];
  seg?: number;
}

/** Screen pixels within which a drag snaps to a guide. */
const SNAP = 6;
const GRID = 8;

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
  const { result, stale, selection, docKey } = p;
  const selected = selection.length === 1 ? selection[0] : undefined;
  /** Types with their own layout (sequence) draw lines themselves: no hand-made bends there. */
  const bendable = !stale && !!p.onBend && !result?.type?.layout;
  /** A process stands where its flow puts it: its steps and lanes are picked, not dragged. */
  const flowed = !!result?.type?.layout && !!result.graph?.nodes.some((n) => n.shape.kind === 'flow');
  const frame = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState<Drag['mode']>();
  /** The marquee while it is dragged, in pixels relative to the frame. */
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number }>();
  /** The label being edited in place. */
  const [editing, setEditing] = useState<{ target: LabelTarget; text: string; el?: Element }>();
  /** Space held: dragging pans, like in drawing apps. */
  const [spacePan, setSpacePan] = useState(false);
  /** The node under the pointer, for its connect handle. */
  const [hover, setHover] = useState<string>();
  /** While connecting: where the pointer is (SVG coordinates) and the node it is over. */
  const [link, setLink] = useState<{ x: number; y: number; target?: string }>();
  const [dropTarget, setDropTarget] = useState<string | null>();
  /** Guides and gaps of the drag in progress. */
  const [snap, setSnap] = useState<Snap>();
  /** Keys moved the focus last (not the pointer): the focused element gets a visible ring. */
  const [kb, setKb] = useState(false);
  const drag = useRef<Drag>(null);
  const fitted = useRef<number | string>(-1);
  const anchor = useRef<{ doc: number | string; x: number; y: number }>(null);
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
  useEffect(() => {
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement | null)?.closest?.('input, textarea, select, .cm-content');
    const down = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.repeat || typing(e) || !(hovered.current || frame.current?.contains(document.activeElement))) return;
      e.preventDefault();
      setSpacePan(true);
    };
    const up = (e: KeyboardEvent) => e.key === ' ' && setSpacePan(false);
    const blur = () => setSpacePan(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Lines are thin: a wide invisible copy under each one makes them easy to click.
  const drawingEl = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    for (const path of drawingEl.current?.querySelectorAll<SVGPathElement>('[data-edge] > path[fill="none"]') ?? []) {
      const hit = path.cloneNode() as SVGPathElement;
      hit.removeAttribute('stroke-dasharray');
      hit.setAttribute('stroke', 'transparent');
      hit.setAttribute('stroke-width', '14');
      hit.setAttribute('pointer-events', 'stroke');
      path.before(hit);
    }
  }, [result?.svg]);

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

  /** ⇧2: the selection fills the pane (not closer than 200%); nothing selected fits everything. */
  const zoomToSelection = () => {
    const f = frame.current;
    const boxes = selection.map((s) => selectedBox(result, s)).filter((b): b is Box => !!b);
    if (!f || !boxes.length) return fit();
    setView(viewFor(union(boxes), { w: f.clientWidth, h: f.clientHeight }, { bottom: BAR, max: 2, min: MIN }));
  };
  useImperativeHandle(p.control, () => ({ fit, zoomToSelection }));

  // When the pane changes size (inspector opens, splitter moves): a drawing that was wholly in view
  // fits again, so opening the inspector never crops it; otherwise the centre stays where it was.
  const latest = useRef({ view, width: result?.width ?? 0, height: result?.height ?? 0, fit });
  latest.current = { view, width: result?.width ?? 0, height: result?.height ?? 0, fit };
  useEffect(() => {
    const f = frame.current!;
    paneSize.current = { w: f.clientWidth, h: f.clientHeight };
    const ro = new ResizeObserver(() => {
      const { w, h } = paneSize.current;
      const dw = f.clientWidth - w;
      const dh = f.clientHeight - h;
      if (!dw && !dh) return;
      paneSize.current = { w: f.clientWidth, h: f.clientHeight };
      const { view: v, width, height, fit: refit } = latest.current;
      const whole = width > 0 && w > 0 && v.x >= -1 && v.y >= -1 && v.x + width * v.scale <= w + 1 && v.y + height * v.scale <= h + 1;
      if (!whole || (dw >= 0 && dh >= 0)) return setView((v) => ({ ...v, x: v.x + dw / 2, y: v.y + dh / 2 }));
      // Shrinking around a drawing that was wholly in view: move it only as far as needed to keep it in
      // view (what is under the pointer stays put for a double-click), and fit when it no longer fits.
      const m = 16;
      const x = Math.min(v.x, f.clientWidth - m - width * v.scale);
      const y = Math.min(v.y, f.clientHeight - BAR - height * v.scale);
      if (x < m / 2 || y < 0) refit();
      else setView({ ...v, x, y });
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
    if ((e.target as Element).closest('.label-editor, .canvas-empty button')) return;
    frame.current?.focus({ preventScroll: true });
    setKb(false);
    // Space-drag and the middle button pan; a plain drag on empty canvas draws a marquee.
    if (spacePan || e.button === 1) {
      e.preventDefault();
      drag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, mode: 'pan', moved: false, vx: view.x, vy: view.y };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    const handle = (e.target as Element).closest('[data-handle]') as HTMLElement | null;
    if (handle && !stale) {
      drag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, mode: 'connect', moved: true, vx: view.x, vy: view.y, node: handle.dataset.handle };
      setDragging('connect');
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    // The selected line: a grip, or the line itself, moves the segment under the pointer.
    const line = selected?.kind === 'edge' && bendable && e.button === 0 ? result?.placed?.edges.get(selected.id) : undefined;
    const grip = (e.target as Element).closest('[data-bend]') as HTMLElement | null;
    const onLine = ((e.target as Element).closest('[data-edge]') as HTMLElement | null)?.dataset.edge === selected?.id;
    if (line && line.points.length > 1 && (grip || onLine)) {
      const s = result!.placed!.shift ?? { x: 0, y: 0 };
      const pts = line.points.map((q) => ({ x: q.x + s.x, y: q.y + s.y }));
      const at = toLayout(e.clientX, e.clientY);
      const seg = grip ? Number(grip.dataset.bend) : nearestSegment(pts, { x: at.x + s.x, y: at.y + s.y });
      drag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, mode: 'bend', moved: false, vx: view.x, vy: view.y, edge: selected!.id, pts, seg };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    const hit = e.button === 0 ? ((e.target as Element).closest('[data-node]') as HTMLElement | null) : null;
    // A locked element is picked like the background: it can be selected, not moved.
    const id = hit?.dataset.node;
    // So is a part of a journey: steps stand in the order written, there is nowhere to drag them to.
    const fixed = !!id && (flowed || !!result?.graph?.nodes.find((n) => n.id === id)?.shape.kind.startsWith('journey'));
    const box = id && !p.locked?.has(id) && !fixed ? result?.placed?.nodes.get(id) : undefined;
    // A group's header (its label strip) moves the whole group; the rest of it pans the canvas.
    const headerHit = !id && e.button === 0 && !stale && !flowed ? headerAt(toLayout(e.clientX, e.clientY)) : undefined;
    const header = headerHit && !p.locked?.has(headerHit) ? headerHit : undefined;
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
        moving: pinBox(result!.placed!.groups.get(header)!),
        movingIds: [header],
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    const many = !!id && selection.length > 1 && selection.some((x) => x.kind === 'node' && x.id === id);
    drag.current = {
      pointer: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      // A finger has no space bar: on touch, empty canvas still pans.
      mode: id && box && !stale ? 'node' : (id && !box) || headerHit || e.pointerType === 'touch' || !result?.placed ? 'pan' : 'marquee',
      many,
      shiftKey: e.shiftKey,
      moved: false,
      vx: view.x,
      vy: view.y,
      node: id,
      box,
      shift: result?.placed?.shift ?? { x: 0, y: 0 },
      groups: result?.placed ? toPinSpace(result.placed.groups, result.placed.shift) : undefined,
      parent: id ? result?.graph?.nodes.find((n) => n.id === id)?.parent : undefined,
      ...(box ? movingOf(many ? selection.filter((x) => x.kind === 'node' && !p.locked?.has(x.id)).map((x) => x.id) : [id!]) : {}),
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const pinBox = (b: Box): Box => {
    const s = result?.placed?.shift ?? { x: 0, y: 0 };
    return { ...b, x: b.x + s.x, y: b.y + s.y };
  };
  /** At the start of a node drag: the selected nodes that move, as one box. */
  const movingOf = (ids: string[]) => ({ moving: pinBox(union(ids.map((i) => result!.placed!.nodes.get(i)).filter((b): b is Box => !!b))), movingIds: ids });
  /**
   * The boxes a drag can line up with, as drawn now (pin space): the first pin can redraw the rest, so not as at the start.
   * Not what moves, nor the groups around it (they grow with it), nor what is inside a moved group.
   */
  const snapOthers = (d: Drag): Box[] => {
    const pl = result?.placed;
    if (!pl) return [];
    const ids = new Set(d.movingIds);
    const mine = d.mode === 'group' ? pl.groups.get(d.group!) : union([...ids].map((i) => pl.nodes.get(i)).filter((b): b is Box => !!b));
    if (!mine) return [];
    const within = (b: Box, o: Box) => b.x >= o.x - 0.5 && b.y >= o.y - 0.5 && b.x + b.width <= o.x + o.width + 0.5 && b.y + b.height <= o.y + o.height + 0.5;
    const group = d.mode === 'group';
    return [
      ...[...pl.nodes].filter(([id, b]) => !ids.has(id) && !(group && within(b, mine))).map(([, b]) => b),
      ...[...pl.groups].filter(([id, b]) => !ids.has(id) && !within(mine, b) && !(group && within(b, mine))).map(([, b]) => b),
    ].map(pinBox);
  };

  /** Where a dragged node or group goes: under the pointer, snapped to guides or the grid unless ⌥ is held. */
  const dragPin = (d: Drag, e: { clientX: number; clientY: number; altKey: boolean }): Point => {
    const dx = (e.clientX - d.x) / view.scale;
    const dy = (e.clientY - d.y) / view.scale;
    let x = d.box!.x + d.shift!.x + dx;
    let y = d.box!.y + d.shift!.y + dy;
    if (d.moving && !e.altKey) {
      const sn = snapBox({ ...d.moving, x: d.moving.x + dx, y: d.moving.y + dy }, snapOthers(d), SNAP / view.scale, p.grid ? GRID : undefined);
      x += sn.dx;
      y += sn.dy;
      setSnap(sn.guides.length || sn.gaps.length ? sn : undefined);
    } else setSnap(undefined);
    return { x: Math.round(x), y: Math.round(y) };
  };

  /** The selected line's bends with the dragged segment moved; it snaps straight with the rest of the line or to the grid. */
  const bendVia = (d: Drag, e: { clientX: number; clientY: number; altKey: boolean }): Point[] => {
    const pts = d.pts!;
    const i = d.seg!;
    const h = isHorizontal(pts, i);
    const was = h ? pts[i]!.y : pts[i]!.x;
    let to = was + (h ? e.clientY - d.y : e.clientX - d.x) / view.scale;
    if (!e.altKey) {
      const near = pts.filter((_, j) => j !== i && j !== i + 1).map((q) => (h ? q.y : q.x)).filter((v) => Math.abs(v - to) <= SNAP / view.scale);
      if (near.length) to = near.reduce((a, b) => (Math.abs(b - to) < Math.abs(a - to) ? b : a));
      else if (p.grid) to = Math.round(to / GRID) * GRID;
    }
    return bendsOf(dragSegment(pts, i, Math.round(to - was)));
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
    if (d.mode === 'marquee') {
      const r = frame.current!.getBoundingClientRect();
      return setMarquee({ x0: d.x - r.left, y0: d.y - r.top, x1: e.clientX - r.left, y1: e.clientY - r.top });
    }
    if (d.mode === 'bend') {
      const via = bendVia(d, e);
      cancelAnimationFrame(frameReq.current);
      frameReq.current = requestAnimationFrame(() => p.onBend?.(d.edge!, via, false));
      return;
    }
    const pin = dragPin(d, e);
    if (d.mode === 'group') {
      cancelAnimationFrame(frameReq.current);
      frameReq.current = requestAnimationFrame(() => p.onMoveGroup(d.group!, pin, false));
      return;
    }
    cancelAnimationFrame(frameReq.current);
    frameReq.current = requestAnimationFrame(() => p.onMove(d.node!, pin, false));
    if (d.many) return;
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
    setMarquee(undefined);
    setSnap(undefined);
    if ((d.mode === 'node' || d.mode === 'group' || d.mode === 'bend') && d.moved) p.onDragCancel();
  };

  const end = (e: React.PointerEvent, cancelled: boolean) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    setDragging(undefined);
    setDropTarget(undefined);
    setMarquee(undefined);
    setSnap(undefined);
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
    if (d.moved && d.mode === 'bend') return p.onBend?.(d.edge!, bendVia(d, e), true);
    if (d.moved && d.mode === 'group') {
      const pin = dragPin(d, e);
      setSnap(undefined);
      p.onMoveGroup(d.group!, pin, true);
      p.onSelect({ kind: 'group', id: d.group! });
      return;
    }
    const follow = (s: Selection) => (navigator.platform.startsWith('Mac') ? e.metaKey : e.ctrlKey) && !!p.onFollow?.(s);
    if (d.mode === 'group') {
      if (follow({ kind: 'group', id: d.group! })) return;
      // A click on a header selects the group.
      p.onSelect({ kind: 'group', id: d.group! }, e.shiftKey);
      return;
    }
    if (d.moved) {
      if (d.mode === 'node') {
        const pin = dragPin(d, e);
        setSnap(undefined);
        const target = d.many ? (d.parent ?? null) : dropGroup(d, e.clientX, e.clientY);
        p.onMove(d.node!, pin, true, target !== (d.parent ?? null) ? target : undefined);
        // A moved selection stays selected; a single node becomes the selection.
        if (!d.many) p.onSelect({ kind: 'node', id: d.node! });
      }
      if (d.mode === 'marquee') p.onSelectMany(inMarquee(d.x, d.y, e.clientX, e.clientY), !!d.shiftKey || e.shiftKey);
      return;
    }
    if (e.button !== 0) return;
    // A click: the innermost element with an id under the pointer.
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-node],[data-edge],[data-group]') as HTMLElement | null;
    lastClick.current = null;
    if (!hit) return e.shiftKey ? undefined : p.onSelect(undefined);
    const kind = hit.dataset.node != null ? 'node' : hit.dataset.edge != null ? 'edge' : 'group';
    if (follow({ kind, id: hit.dataset[kind]! })) return;
    lastClick.current = { s: { kind, id: hit.dataset[kind]! }, at: Date.now() };
    p.onSelect({ kind, id: hit.dataset[kind]! }, e.shiftKey);
  };
  /** The first click of a double-click: the inspector it opens can move the drawing before the second. */
  const lastClick = useRef<{ s: Selection; at: number }>(null);

  /** Nodes and groups wholly inside a marquee (screen points). */
  const inMarquee = (ax: number, ay: number, bx: number, by: number): Selection[] => {
    const a = toLayout(Math.min(ax, bx), Math.min(ay, by));
    const b = toLayout(Math.max(ax, bx), Math.max(ay, by));
    const inside = (q: Box) => q.x >= a.x && q.y >= a.y && q.x + q.width <= b.x && q.y + q.height <= b.y;
    const placed = result?.placed;
    if (!placed) return [];
    return [
      ...[...placed.nodes].filter(([, q]) => inside(q)).map(([id]) => ({ kind: 'node' as const, id })),
      ...[...placed.groups].filter(([, q]) => inside(q)).map(([id]) => ({ kind: 'group' as const, id })),
    ];
  };

  /** Opens the label editor over an element, the title or the subtitle; false when it cannot be edited in place. */
  const editLabel = (target: LabelTarget, el?: Element): boolean => {
    const text = p.labelOf(target);
    if (text == null || (!el && !selectedBox(result, target as Selection))) return false;
    setEditing({ target, text, el });
    return true;
  };
  /** Where the label editor sits, from the current view, so it follows a view that moves. */
  const editorRect = (t: LabelTarget, el?: Element) => {
    const f = frame.current;
    if (!f) return undefined;
    if (el) {
      const fr = f.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const size = t.kind === 'title' ? 20 : 14;
      return { left: r.left - fr.left - 8, top: r.top - fr.top - 6, width: Math.max(r.width + 60, 240), height: Math.max(r.height + 12, size + 18), size };
    }
    const b = selectedBox(result, t as Selection);
    if (!b) return undefined;
    const width = Math.max(b.width * view.scale, 180);
    const height = 36;
    const cx = view.x + (b.x + b.width / 2) * view.scale;
    // Nodes and lines: over their middle; groups: over the header strip where the label sits.
    const cy = t.kind === 'group' ? view.y + (b.y + 22) * view.scale : view.y + (b.y + b.height / 2) * view.scale;
    return { left: cx - width / 2, top: cy - height / 2, width, height, size: 14 };
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
    const g = groupAt(result.placed.groups, at);
    // Into a group that takes it: it joins, and the layout gives it a place inside.
    if (g && p.canDrop(g, { palette: Number(raw) })) return p.onPaletteDrop(Number(raw), undefined, g);
    // Elsewhere it is pinned where it was dropped, but only in free space: a pin over a group it is
    // not in, or over another shape, would draw it where it does not belong. Then the layout places it.
    // A card is centred on the point; its exact size is known only after the next render.
    const card = { x: at.x - 90, y: at.y - 29, width: 180, height: 58 };
    const m = 24;
    const hits = (b: Box) => card.x < b.x + b.width + m && card.x + card.width > b.x - m && card.y < b.y + b.height + m && card.y + card.height > b.y - m;
    const free = result.placed.nodes.size > 0 && ![...result.placed.groups.values(), ...result.placed.nodes.values()].some(hits);
    p.onPaletteDrop(Number(raw), free ? toPin(card) : undefined, null);
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
  const shiftNow = result?.placed?.shift ?? { x: 0, y: 0 };
  const pinToStage = (q: Point): Point => ({ x: q.x - shiftNow.x + o.x, y: q.y - shiftNow.y + o.y });
  const line = selected?.kind === 'edge' && bendable && !dragging ? result?.placed?.edges.get(selected.id) : undefined;
  const lockedBoxes = [...(p.locked ?? [])].map((id) => selectedBox(result, { kind: result?.placed?.nodes.has(id) ? 'node' : 'group', id })).filter((b): b is Box => !!b);
  // The overview only earns its place when the drawing does not fit the pane.
  const f = frame.current;
  const overflows = !!f && !!result?.width && (result.width * view.scale > f.clientWidth + 1 || result.height! * view.scale > f.clientHeight - BAR + 1);
  const announce = selected ? (p.describe?.(selected) ?? selected.id) : selection.length > 1 ? `${selection.length} selected` : '';

  return (
    <div
      className={`preview${dragging ? ` dragging-${dragging}` : ''}${spacePan ? ' space-pan' : ''}${kb ? ' kb' : ''}`}
      ref={frame}
      tabIndex={0}
      role="application"
      aria-roledescription="drawing"
      aria-activedescendant={selected && box ? 'canvas-focus' : undefined}
      aria-label="Drawing. Tab moves between elements, ⌥ arrows to the nearest one, arrows nudge, Delete removes."
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
        if (stale) return;
        // The title and subtitle are the drawing's first texts, before the layout's group.
        // What is under the pointer: with pointer capture the event's own target is the frame.
        const t = document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element);
        if (t.closest('.label-editor')) return;
        const svg = t.closest('svg');
        if (svg && t.tagName === 'text' && t.parentNode === svg) {
          const firstG = [...svg.children].findIndex((c) => c.tagName === 'g' && !c.hasAttribute('data-sheet'));
          const heads = [...svg.children].filter((c, i) => c.tagName === 'text' && (firstG < 0 || i < firstG));
          const i = heads.indexOf(t);
          if (i >= 0 && editLabel({ kind: i === 0 ? 'title' : 'subtitle', id: '' }, t)) return;
        }
        // Double-click an element: edit its label right there, or the inspector's field when that cannot be.
        const hit = t.closest('[data-node],[data-group],[data-edge]') as HTMLElement | null;
        const recent = lastClick.current && Date.now() - lastClick.current.at < 700 ? lastClick.current.s : undefined;
        const s: Selection | undefined =
          recent ??
          (!hit ? undefined
          : hit.dataset.node != null ? { kind: 'node', id: hit.dataset.node }
          : hit.dataset.group != null ? { kind: 'group', id: hit.dataset.group }
          : { kind: 'edge', id: hit.dataset.edge! });
        if (!s) return;
        p.onSelect(s);
        if (editLabel(s)) return;
        requestAnimationFrame(() => requestAnimationFrame(() => (document.querySelector('.inspector .field:nth-child(2) input') as HTMLInputElement | null)?.select()));
      }}
      onKeyDown={(e) => {
        if (drag.current && e.key === 'Escape') {
          e.preventDefault();
          return cancel();
        }
        if (e.target === e.currentTarget && ['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) setKb(true);
        // ⇧1 fits everything, ⇧2 the selection (as in Figma); by key code, since ⇧ changes the character.
        if (e.target === e.currentTarget && e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey && (e.code === 'Digit1' || e.code === 'Digit2')) {
          e.preventDefault();
          return e.code === 'Digit1' ? fit() : zoomToSelection();
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
          <div className="drawing" ref={drawingEl} dangerouslySetInnerHTML={{ __html: result!.svg! }} />
          {target && (
            <div className="drop-ring" style={{ left: target.x + o.x, top: target.y + o.y, width: target.width, height: target.height, borderWidth: 2 / view.scale }} />
          )}
          {from && link && (
            <svg className="link-line" width={result!.width} height={result!.height}>
              <defs>
                <marker id="link-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                  <path d="M0 0L10 5L0 10z" />
                </marker>
              </defs>
              <line x1={from.x + from.width + o.x} y1={from.y + from.height / 2 + o.y} x2={link.x} y2={link.y} strokeWidth={2 / view.scale} markerEnd="url(#link-arrow)" />
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
          {selection.map((s) => {
            const b = selectedBox(result, s);
            return (
              b && (
                <div
                  key={`${s.kind}:${s.id}`}
                  id={s === selected ? 'canvas-focus' : undefined}
                  role={s === selected ? 'img' : undefined}
                  aria-label={s === selected ? announce : undefined}
                  className={s === selected && kb ? 'selection-ring focus' : 'selection-ring'}
                  style={{ left: b.x - 5, top: b.y - 5, width: b.width + 10, height: b.height + 10, borderWidth: 2 / view.scale }}
                />
              )
            );
          })}
          {lockedBoxes.length > 0 && <LockBadges boxes={lockedBoxes} scale={view.scale} />}
          {line && <BendHandles points={line.points.map((q) => ({ x: q.x + o.x, y: q.y + o.y }))} scale={view.scale} bent={!!p.bent?.has(selected!.id)} />}
          {snap && <Guides snap={snap} at={pinToStage} scale={view.scale} />}
        </div>
      )}
      {marquee && (
        <div
          className="marquee"
          style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }}
        />
      )}
      {editing && editorRect(editing.target, editing.el) && (
        <LabelEditor
          text={editing.text}
          {...editorRect(editing.target, editing.el)!}
          onDone={(text) => {
            setEditing(undefined);
            if (text != null && text !== editing.text) p.onLabel(editing.target, text);
            frame.current?.focus({ preventScroll: true });
          }}
        />
      )}
      {stale && !empty && (
        <div className="stale-note" role="status">
          <Icon name="circle-exclamation-point" size={14} /> Showing the last version that worked: fix the problems in the editor
        </div>
      )}
      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
      {p.children}
      {p.minimap && overflows && result?.placed && !empty && (
        <Minimap
          placed={result.placed}
          origin={o}
          width={result.width!}
          height={result.height!}
          view={view}
          pane={{ w: f!.clientWidth, h: f!.clientHeight }}
          onCentre={(x, y) => setView((v) => ({ ...v, x: f!.clientWidth / 2 - x * v.scale, y: (f!.clientHeight - BAR) / 2 - y * v.scale }))}
        />
      )}
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
        <button onClick={fit} title="Fit to screen (⇧1 or ⌘0)" aria-label="Fit to screen">
          <Icon name="maximize" />
        </button>
        <button onClick={zoomToSelection} title="Zoom to selection (⇧2)" aria-label="Zoom to selection" disabled={!selection.length}>
          <Icon name="focus" />
        </button>
        <span className="zoom-sep" />
        <button className={p.grid ? 'on' : ''} onClick={() => p.onToggle?.('grid')} title="Snap to the 8px grid (⇧G)" aria-label="Snap to grid" aria-pressed={!!p.grid}>
          <Icon name="grid-3x3" />
        </button>
        <button className={p.minimap ? 'on' : ''} onClick={() => p.onToggle?.('minimap')} title="Overview when the drawing does not fit (⇧M)" aria-label="Minimap" aria-pressed={!!p.minimap}>
          <Icon name="map" />
        </button>
      </div>
    </div>
  );
}

/** A label typed in place: Enter keeps it, Esc drops it, and no key reaches the drawing's shortcuts. */
function LabelEditor(p: { text: string; left: number; top: number; width: number; height: number; size: number; onDone(text: string | undefined): void }) {
  const [text, setText] = useState(p.text);
  const done = useRef(false);
  const finish = (t: string | undefined) => {
    if (done.current) return;
    done.current = true;
    p.onDone(t);
  };
  return (
    <input
      className="label-editor"
      aria-label="Label"
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      value={text}
      spellCheck={false}
      style={{ left: p.left, top: p.top, width: p.width, height: p.height, fontSize: p.size }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(text.trim() || undefined)}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(text.trim() || undefined);
        else if (e.key === 'Escape') finish(undefined);
        else return;
        e.preventDefault();
      }}
    />
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
