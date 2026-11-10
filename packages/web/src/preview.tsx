// The drawing: the engine's SVG with pan and zoom, click to select, drag to move (pins), drop into a
// group to nest, and drops from the add palette.
import { is } from './keys.ts';
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { Box, Point } from '@cartography/core';
import { readableArea, SLIDE_MIN_PT, slideTextPt, type RenderResult } from '@cartography/engine';
import { Icon } from './icon.tsx';
import { PALETTE_MIME } from './add-menu.tsx';
import { BLOCK_MIME } from './blocks/blocks-panel.tsx';
import { bendAt, bendsOf, dragSegment, isHorizontal, nearestSegment, removeBend, snapBox, union, viewFor, type Snap } from './craft.ts';
import { BendHandles, Guides, LockBadges, Minimap, PageFrame, PinBadges } from './craft-overlays.tsx';

export interface Selection {
  kind: 'node' | 'group' | 'edge';
  id: string;
}

/** Zoom commands the app's palette can run. */
export interface PreviewControl {
  fit(): void;
  zoomToSelection(): void;
  /** The middle of what is in view, in pin space (where a note without an element goes). */
  centre(): Point | undefined;
  /** Fit once the next drawing is in (after a tidy: it may land anywhere). */
  fitNext(): void;
  /** Whether the whole drawing is in view now. */
  wholly(): boolean;
  /** After the next drawing: one that was wholly in view (`was`) and no longer is (a long drag) fits again. */
  keepInView(was: boolean): void;
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
  /** A palette item dropped at a point (its card's top-left, pin coordinates), into a group or into
   * free space: it stays there, pinned. Without a point the layout places it; `refused` is the group
   * it was dropped on that cannot take it. */
  onPaletteDrop(index: number, at: Point | undefined, group: string | null, refused?: string): void;
  /** A block (blocks/) dropped at a point (its top-left, pin coordinates), into the group under it if any. */
  onBlockDrop?(name: string, at: Point | undefined, group: string | null): void;
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
  /** Double-click: down into what it stands for (a C4 system to its containers); false edits its label instead. */
  onDrill?(s: Selection): boolean;
  /** Elements that cannot be dragged by accident: dragging them pans instead. */
  locked?: Set<string>;
  /** Lines with bends set by hand. */
  bent?: Set<string>;
  /** Snap to the 8px grid where no guide is near. */
  grid?: boolean;
  /** Show the overview when the drawing does not fit. */
  minimap?: boolean;
  /** Show the page the drawing is for, and flag what makes its text too small. */
  page?: boolean;
  /** Elements placed by hand (pinned): a small pin shows on each that is not locked. */
  pinned?: Set<string>;
  onToggle?(what: 'grid' | 'minimap' | 'page'): void;
  /** A segment of the selected line dragged: the line's new bends (pin space); `done` on release. */
  onBend?(id: string, via: Point[], done: boolean): void;
  /** What a screen reader hears for the focused element. */
  describe?(s: Selection): string;
  control?: React.Ref<PreviewControl>;
  /** Drawn on the stage, over the drawing, at the zoom given (review note markers). */
  overlay?(scale: number): React.ReactNode;
  /** Right-click (or a two-finger click): what is under the pointer, and the point in pin space. */
  onContextMenu?(s: Selection | undefined, at: Point, client: { x: number; y: number }): void;
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
  /** A process stands where its flow puts it, a capability map or an org chart where the tree engine does: picked, not dragged. */
  const flowed = !!result?.type?.layout && !!result.graph?.nodes.some((n) => n.shape.kind === 'flow' || n.shape.kind === 'block');
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
  /** While a palette item is dragged over the drawing: where its card would land (layout space), and
   * the group under it that cannot take it. */
  const [ghost, setGhost] = useState<{ card: Box; refused?: string }>();
  /** Guides and gaps of the drag in progress. */
  const [snap, setSnap] = useState<Snap>();
  /** Keys moved the focus last (not the pointer): the focused element gets a visible ring. */
  const [kb, setKb] = useState(false);
  const drag = useRef<Drag>(null);
  const fitted = useRef<number | string>(-1);
  const anchor = useRef<{ doc: number | string; x: number; y: number }>(null);
  /** A shape dropped from the palette: its pin and where on screen its card was let go, until drawn. */
  const dropAnchor = useRef<{ pin: Point; x: number; y: number; svg?: string }>(null);
  const frameReq = useRef(0);
  /** The palette item being dragged in (dataTransfer cannot be read during dragover). */
  const paletteDrag = useRef<number>(undefined);
  useEffect(() => {
    const start = (e: DragEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-palette]') as HTMLElement | null;
      paletteDrag.current = el ? Number(el.dataset.palette) : undefined;
    };
    // Cancelled (Esc) or dropped elsewhere: the ring and the card outline go.
    const end = () => {
      setDropTarget(undefined);
      setGhost(undefined);
    };
    window.addEventListener('dragstart', start);
    window.addEventListener('dragend', end);
    return () => {
      window.removeEventListener('dragstart', start);
      window.removeEventListener('dragend', end);
    };
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
  /** The view as fit() last placed it, carried along by moves that keep it so (the layout's origin
   * moving, the pane changing size); null once people pan or zoom themselves. */
  const fittedView = useRef<View | null>(null);
  /** The pane size fit() last fitted to. */
  const fittedPane = useRef({ w: 0, h: 0 });
  const [easing, setEasing] = useState(false);
  const fit = useCallback((ease = false) => {
    const f = frame.current;
    if (!f || !result?.width || !result.height) return;
    paneSize.current = { w: f.clientWidth, h: f.clientHeight };
    fittedPane.current = { ...paneSize.current };
    const pad = 32;
    const top = Math.max(pad, floatingTop(f));
    const w = f.clientWidth - 2 * pad;
    const h = f.clientHeight - top - BAR;
    // With the page shown, the page (and its label) is what fits and is centred: it is wider or taller
    // than the drawing. Where it stands is read off the screen and taken back into drawing units with
    // the stage's transform at this very moment (a glide may be under way).
    const fr = p.page ? f.querySelector<HTMLElement>('.page-frame') : null;
    const stageEl = f.querySelector<HTMLElement>('.stage');
    let [x0, y0, x1, y1] = [0, 0, result.width, result.height];
    if (fr?.offsetWidth && stageEl) {
      const m = new DOMMatrix(getComputedStyle(stageEl).transform);
      const pr = f.getBoundingClientRect();
      const r = fr.getBoundingClientRect();
      const svg = f.querySelector('.drawing svg')?.getBoundingClientRect();
      // The drawing's top left on screen is the origin of drawing units.
      const ox = svg ? svg.left : pr.left + m.e;
      const oy = svg ? svg.top : pr.top + m.f;
      const k = m.a || 1;
      const fx = (r.left - ox) / k;
      const fy = (r.top - oy) / k;
      [x0, y0, x1, y1] = [Math.min(x0, fx), Math.min(y0, fy), Math.max(x1, fx + r.width / k), Math.max(y1, fy + r.height / k)];
    }
    const label = fr?.offsetWidth ? 22 : 0;
    const scale = clamp(Math.min(w / (x1 - x0), (h - label) / (y1 - y0), 1.25));
    const next = { scale, x: (f.clientWidth - (x1 - x0) * scale) / 2 - x0 * scale, y: top + Math.max(0, (h - label - (y1 - y0) * scale) / 2) - y0 * scale };
    fittedView.current = next;
    setEasing(ease);
    setView(next);
  }, [result?.width, result?.height, p.page]);
  /** A view change that keeps a fitted view fitted (it follows the drawing or the pane, not people). */
  const carry = (v: View, next: View) => {
    if (v === fittedView.current) fittedView.current = next;
    return next;
  };

  // Fit once per document; afterwards keep what is on screen still. When the layout's origin moves
  // (a node dragged past the edge, a title added), shift the view so the drawing does not jump.
  useLayoutEffect(() => {
    if (!result?.svg || !result.origin) return;
    const shift = result.placed?.shift ?? { x: 0, y: 0 };
    const zero = { x: result.origin.x - shift.x, y: result.origin.y - shift.y };
    const dropped = dropAnchor.current;
    if (fitted.current !== docKey) {
      fitted.current = docKey;
      fit();
    } else if (dropped && dropped.svg !== result.svg) {
      // A shape just dropped: it stays under the pointer, whatever else the layout moved, and the view
      // is no longer a fitted one that glides to the centre when the inspector opens for it.
      dropAnchor.current = null;
      fittedView.current = null;
      const o = result.origin;
      setView((v) => ({ ...v, x: dropped.x - (dropped.pin.x - shift.x + o.x) * v.scale, y: dropped.y - (dropped.pin.y - shift.y + o.y) * v.scale }));
    } else if (anchor.current?.doc === docKey) {
      const dx = zero.x - anchor.current.x;
      const dy = zero.y - anchor.current.y;
      if (dx || dy) setView((v) => carry(v, { ...v, x: v.x - dx * v.scale, y: v.y - dy * v.scale }));
    }
    anchor.current = { doc: docKey, ...zero };
  }, [result, docKey, fit]);

  // A drawing that was fitted and that nobody has panned or zoomed since fits again when the pane
  // changed size (the inspector, the YAML pane), or when it grew past the pane's edges. Not under a
  // click in progress: a first click that opens the inspector must leave the second of a double-click
  // on the same element, so it waits until the pointer has been still for a moment.
  const lastDown = useRef(0);
  const settle = useRef(0);
  const settleState = useRef({ view, editing: !!editing, fit });
  settleState.current = { view, editing: !!editing, fit };
  useEffect(() => {
    const f = frame.current;
    if (!f || !result?.width || !result.height || view !== fittedView.current) return;
    const paneMoved = f.clientWidth !== fittedPane.current.w || f.clientHeight !== fittedPane.current.h;
    const fits = view.x >= 0 && view.y >= 0 && view.x + result.width * view.scale <= f.clientWidth && view.y + result.height * view.scale <= f.clientHeight - BAR / 2;
    if (!paneMoved && fits) return;
    const run = () => {
      const st = settleState.current;
      if (st.view !== fittedView.current) return;
      const wait = lastDown.current + 550 - performance.now();
      if (wait > 0 || drag.current || st.editing) return void (settle.current = window.setTimeout(run, Math.max(wait, 200)));
      st.fit(true);
    };
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(run, 0);
    return () => window.clearTimeout(settle.current);
  }, [view, result?.width, result?.height]);
  useEffect(() => {
    if (!easing) return;
    const t = window.setTimeout(() => setEasing(false), 260);
    return () => window.clearTimeout(t);
  }, [easing, view]);

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
    // Clear of the tools as fit() is: viewFor keeps its own 48 px on top of `top`.
    setView(viewFor(union(boxes), { w: f.clientWidth, h: f.clientHeight }, { top: Math.max(0, floatingTop(f) - 48), bottom: BAR, max: 2, min: MIN }));
  };
  /** A point of the pane (client pixels) in pin space. */
  const pinAt = (cx: number, cy: number): Point | undefined => {
    const f = frame.current;
    if (!f || !result?.origin) return undefined;
    const r = f.getBoundingClientRect();
    const sh = result.placed?.shift ?? { x: 0, y: 0 };
    return { x: (cx - r.left - view.x) / view.scale - result.origin.x + sh.x, y: (cy - r.top - view.y) / view.scale - result.origin.y + sh.y };
  };
  const wholly = () => {
    const f = frame.current;
    if (!f || !result?.width || !result.height) return false;
    return view.x >= -1 && view.y >= -1 && view.x + result.width * view.scale <= f.clientWidth + 1 && view.y + result.height * view.scale <= f.clientHeight - BAR / 2 + 1;
  };
  /** How far (px) the drawing runs past the pane's edges, at the most. */
  const outOfView = () => {
    const f = frame.current;
    if (!f || !result?.width || !result.height) return 0;
    return Math.max(0, -view.x, -view.y, view.x + result.width * view.scale - f.clientWidth, view.y + result.height * view.scale - (f.clientHeight - BAR / 2));
  };
  const refit = useRef<{ always: boolean; was: boolean } | null>(null);
  useEffect(() => {
    const r = refit.current;
    if (!r || !result?.svg) return;
    refit.current = null;
    // A drag that took a real part of it out of sight (not a few pixels past the edge: that would
    // make the drawing jump under a careful placement).
    if (r.always || (r.was && outOfView() > 48)) requestAnimationFrame(() => fit(true));
  }, [result]);
  useImperativeHandle(p.control, () => ({
    fit,
    zoomToSelection,
    fitNext: () => void (refit.current = { always: true, was: true }),
    wholly,
    keepInView: (was: boolean) => void (refit.current = { always: false, was }),
    centre: () => {
      const r = frame.current?.getBoundingClientRect();
      return r && pinAt(r.left + r.width / 2, r.top + (r.height - BAR) / 2);
    },
  }));

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
      if (!whole || (dw >= 0 && dh >= 0)) return setView((v) => carry(v, { ...v, x: v.x + dw / 2, y: v.y + dh / 2 }));
      // Shrinking around a drawing that was wholly in view: move it only as far as needed to keep it in
      // view (what is under the pointer stays put for a double-click), and fit when it no longer fits.
      const m = 16;
      const x = Math.min(v.x, f.clientWidth - m - width * v.scale);
      const y = Math.min(v.y, f.clientHeight - BAR - height * v.scale);
      if (x < m / 2 || y < 0) refit();
      else setView(carry(v, { ...v, x, y }));
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
      if (e.defaultPrevented || !is(e, 'zoom')) return;
      if (!hovered.current && !f?.contains(document.activeElement)) return;
      if (e.key === '0') fit();
      else if (e.key === '-') zoomAt(1 / 1.2);
      else zoomAt(1.2);
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
    lastDown.current = performance.now();
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
    lastClick.current = { s: { kind, id: hit.dataset[kind]! }, at: Date.now(), x: e.clientX, y: e.clientY };
    p.onSelect({ kind, id: hit.dataset[kind]! }, e.shiftKey);
  };
  /** The first click of a double-click: the inspector it opens can move the drawing before the second. */
  const lastClick = useRef<{ s: Selection; at: number; x: number; y: number }>(null);
  /** Double-click on an element: edit its label right there, or the inspector's field when that cannot be. */
  const editSelected = (s: Selection) => {
    p.onSelect(s);
    if (editLabel(s)) return;
    requestAnimationFrame(() => requestAnimationFrame(() => (document.querySelector('.inspector .field:nth-child(2) input') as HTMLInputElement | null)?.select()));
  };
  const editRef = useRef(editSelected);
  editRef.current = editSelected;
  // The inspector the first click opens can cover the spot of the second one: a press on the inspector
  // right where (and right after) an element was clicked is that double-click's second click, not a
  // press on whatever field or button now sits there.
  useEffect(() => {
    const swallow = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const down = (e: PointerEvent) => {
      const c = lastClick.current;
      if (!c || e.button !== 0 || Date.now() - c.at > 500 || Math.hypot(e.clientX - c.x, e.clientY - c.y) > 8) return;
      if (!(e.target as Element | null)?.closest?.('.inspector')) return;
      lastClick.current = null;
      swallow(e);
      // The rest of this press (focus, click, the browser's own double-click) goes nowhere.
      const types = ['mousedown', 'mouseup', 'click', 'dblclick'] as const;
      for (const t of types) window.addEventListener(t, swallow, true);
      const done = () => setTimeout(() => types.forEach((t) => window.removeEventListener(t, swallow, true)), 0);
      window.addEventListener('pointerup', done, { capture: true, once: true });
      editRef.current(c.s);
    };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, []);

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

  /** Where a palette item dropped at a point lands: the group under it that takes it (and the one that
   * does not), and its card, centred on the point and moved clear of every group it would not be in. */
  const dropPlace = (at: Point, index: number | undefined) => {
    const placed = result!.placed!;
    const g = groupAt(placed.groups, at);
    const into = g && index != null && p.canDrop(g, { palette: index }) ? g : null;
    // A card is centred on the point; its exact size is known only after the next render.
    let card: Box = { x: at.x - 90, y: at.y - 29, width: 180, height: 58 };
    const holders = new Set<string>();
    for (let id: string | undefined = into ?? undefined; id; id = result?.graph?.groups.find((x) => x.id === id)?.parent) holders.add(id);
    // Over a group it is not in (a nested one, or a border it straddles), it would look as if it were;
    // over a shape it would hide it: it moves out by the shortest way, a few times over for things
    // side by side. What is already there stays where it is.
    // Clear of shapes by more than the layout keeps between a pinned shape and the rest, or it would
    // push them aside.
    const obstacles = [...[...placed.groups].filter(([id]) => !holders.has(id)).map(([, b]) => ({ b, m: 16 })), ...[...placed.nodes.values()].map((b) => ({ b, m: 30 }))];
    for (let round = 0; round < 8; round++) {
      const hit = obstacles.find(({ b, m }) => card.x < b.x + b.width + m && card.x + card.width > b.x - m && card.y < b.y + b.height + m && card.y + card.height > b.y - m);
      if (!hit) break;
      const { b, m } = hit;
      const ways = [
        { dx: b.x - m - (card.x + card.width), dy: 0 },
        { dx: b.x + b.width + m - card.x, dy: 0 },
        { dx: 0, dy: b.y - m - (card.y + card.height) },
        { dx: 0, dy: b.y + b.height + m - card.y },
      ];
      const w = ways.reduce((a, c) => (Math.abs(c.dx) + Math.abs(c.dy) < Math.abs(a.dx) + Math.abs(a.dy) ? c : a));
      card = { ...card, x: card.x + w.dx, y: card.y + w.dy };
    }
    return { into, refused: g && !into ? g : undefined, card };
  };
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(BLOCK_MIME) && result?.placed && p.onBlockDrop) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDropTarget(groupAt(result.placed.groups, toLayout(e.clientX, e.clientY)) ?? undefined);
      return;
    }
    if (!e.dataTransfer.types.includes(PALETTE_MIME) || !result?.placed) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const d = dropPlace(toLayout(e.clientX, e.clientY), paletteDrag.current);
    setDropTarget(d.into ?? undefined);
    setGhost({ card: d.card, refused: d.refused });
  };
  const onDrop = (e: React.DragEvent) => {
    const block = e.dataTransfer.getData(BLOCK_MIME);
    if (block && result?.placed && p.onBlockDrop) {
      e.preventDefault();
      setDropTarget(undefined);
      const at = toLayout(e.clientX, e.clientY);
      // On an empty drawing there is nothing to keep it in line with: the layout places it.
      const empty = !result.placed.nodes.size && !result.placed.groups.size;
      return p.onBlockDrop(block, empty ? undefined : toPin(at), groupAt(result.placed.groups, at));
    }
    const raw = e.dataTransfer.getData(PALETTE_MIME);
    setDropTarget(undefined);
    setGhost(undefined);
    if (!raw || !result?.placed) return;
    e.preventDefault();
    const d = dropPlace(toLayout(e.clientX, e.clientY), Number(raw));
    // On a group that cannot take it: the layout finds it a place outside, and the app says why.
    if (d.refused) return p.onPaletteDrop(Number(raw), undefined, null, d.refused);
    // It stays where it was dropped (pinned, as a drag does), in the group under it if any; on an empty
    // drawing there is nothing to keep it in line with, and the layout places it.
    const empty = !result.placed.nodes.size && !result.placed.groups.size;
    if (!empty) dropAnchor.current = { pin: toPin(d.card), x: view.x + (d.card.x + o.x) * view.scale, y: view.y + (d.card.y + o.y) * view.scale, svg: result.svg };
    p.onPaletteDrop(Number(raw), empty ? undefined : toPin(d.card), d.into);
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
  const refusedBox = ghost?.refused ? result?.placed?.groups.get(ghost.refused) : undefined;
  const groupName = (id: string) => result?.graph?.groups.find((g) => g.id === id)?.label || id;
  const o = result?.origin ?? { x: 0, y: 0 };
  const empty = !result?.svg;
  const shiftNow = result?.placed?.shift ?? { x: 0, y: 0 };
  const pinToStage = (q: Point): Point => ({ x: q.x - shiftNow.x + o.x, y: q.y - shiftNow.y + o.y });
  const line = selected?.kind === 'edge' && bendable && !dragging ? result?.placed?.edges.get(selected.id) : undefined;
  const lockedBoxes = [...(p.locked ?? [])].map((id) => selectedBox(result, { kind: result?.placed?.nodes.has(id) ? 'node' : 'group', id })).filter((b): b is Box => !!b);
  const pinnedBoxes = [...(p.pinned ?? [])].filter((id) => !p.locked?.has(id)).map((id) => selectedBox(result, { kind: result?.placed?.nodes.has(id) ? 'node' : 'group', id })).filter((b): b is Box => !!b);
  // The page: how small the smallest text comes out on it, and the part where it would still be readable.
  const pageInfo = p.page && result?.page && result.svg && result.width && result.height ? { pt: slideTextPt(result.svg, result.width, result.height, result.page), readable: readableArea(result.svg, result.page) } : undefined;
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
      // The pane pans by its transform, never by scrolling: a browser that scrolls it to bring a focused
      // link into view (after an edit, a click on a linked element did) would shift everything off its place.
      onScroll={(e) => {
        e.currentTarget.scrollTop = 0;
        e.currentTarget.scrollLeft = 0;
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => end(e, false)}
      onPointerCancel={(e) => end(e, true)}
      onPointerEnter={() => (hovered.current = true)}
      onPointerLeave={() => (hovered.current = false)}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
        setDropTarget(undefined);
        setGhost(undefined);
      }}
      onDrop={onDrop}
      onContextMenu={(e) => {
        if (!p.onContextMenu || stale || !result?.svg) return;
        const t = (document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element)) as Element;
        if (!t.closest('.stage')) return;
        const at = pinAt(e.clientX, e.clientY);
        if (!at) return;
        e.preventDefault();
        const hit = t.closest('[data-node],[data-group],[data-edge]') as HTMLElement | null;
        const s: Selection | undefined = !hit ? undefined : hit.dataset.node != null ? { kind: 'node', id: hit.dataset.node } : hit.dataset.group != null ? { kind: 'group', id: hit.dataset.group } : { kind: 'edge', id: hit.dataset.edge! };
        p.onContextMenu(s, at, { x: e.clientX, y: e.clientY });
      }}
      onDoubleClick={(e) => {
        if (stale) return;
        // The title and subtitle are the drawing's first texts, before the layout's group.
        // What is under the pointer: with pointer capture the event's own target is the frame.
        const t = document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element);
        if (t.closest('.label-editor')) return;
        // Double-click a bend of the selected line: that bend comes out (with its partner, so the line stays orthogonal).
        const sel = selected?.kind === 'edge' && bendable ? result?.placed?.edges.get(selected.id) : undefined;
        if (sel && p.onBend) {
          const s = result!.placed!.shift ?? { x: 0, y: 0 };
          const pts = sel.points.map((q) => ({ x: q.x + s.x, y: q.y + s.y }));
          const at = toLayout(e.clientX, e.clientY);
          const j = bendAt(pts, { x: at.x + s.x, y: at.y + s.y }, 10 / view.scale);
          const out = j != null ? removeBend(pts, j) : undefined;
          if (out) return p.onBend(selected!.id, bendsOf(out), true);
        }
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
        if (s && p.onDrill?.(s)) return;
        if (s) editSelected(s);
      }}
      onKeyDown={(e) => {
        if (drag.current && e.key === 'Escape') {
          e.preventDefault();
          return cancel();
        }
        if (e.target === e.currentTarget && ['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) setKb(true);
        // ⇧1 fits everything, ⇧2 the selection (as in Figma); by key code, since ⇧ changes the character.
        if (e.target === e.currentTarget && (is(e, 'fit') || is(e, 'zoom-selection'))) {
          e.preventDefault();
          return is(e, 'fit') ? fit() : zoomToSelection();
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
        <div className={`stage${stale ? ' stale' : ''}${easing ? ' easing' : ''}`} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
          <div className="drawing" ref={drawingEl} dangerouslySetInnerHTML={{ __html: result!.svg! }} />
          {target && (
            <div className="drop-ring" style={{ left: target.x + o.x, top: target.y + o.y, width: target.width, height: target.height, borderWidth: 2 / view.scale }}>
              {ghost && <span style={{ fontSize: 12 / view.scale, padding: `${2 / view.scale}px ${6 / view.scale}px` }}>Into {groupName(dropTarget!)}</span>}
            </div>
          )}
          {refusedBox && (
            <div className="drop-ring refused" style={{ left: refusedBox.x + o.x, top: refusedBox.y + o.y, width: refusedBox.width, height: refusedBox.height, borderWidth: 2 / view.scale }}>
              <span style={{ fontSize: 12 / view.scale, padding: `${2 / view.scale}px ${6 / view.scale}px` }}>Cannot go in {groupName(ghost!.refused!)}</span>
            </div>
          )}
          {ghost && !ghost.refused && (
            <div className="drop-ghost" style={{ left: ghost.card.x + o.x, top: ghost.card.y + o.y, width: ghost.card.width, height: ghost.card.height, borderWidth: 2 / view.scale }} />
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
          {pageInfo?.pt != null && (
            <PageFrame
              width={result!.width!}
              height={result!.height!}
              page={result!.page!}
              pt={pageInfo.pt}
              minPt={SLIDE_MIN_PT}
              readable={pageInfo.readable}
              boxes={[...(result!.placed?.nodes.values() ?? [])].map((b) => ({ ...b, x: b.x + o.x, y: b.y + o.y }))}
              scale={view.scale}
            />
          )}
          {lockedBoxes.length > 0 && <LockBadges boxes={lockedBoxes} scale={view.scale} />}
          {pinnedBoxes.length > 0 && <PinBadges boxes={pinnedBoxes} scale={view.scale} />}
          {line && <BendHandles points={line.points.map((q) => ({ x: q.x + o.x, y: q.y + o.y }))} scale={view.scale} bent={!!p.bent?.has(selected!.id)} />}
          {snap && <Guides snap={snap} at={pinToStage} scale={view.scale} />}
          {p.overlay?.(view.scale)}
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
        <button onClick={() => fit()} title="Fit to screen (⇧1 or ⌘0)" aria-label="Fit to screen">
          <Icon name="maximize" />
        </button>
        {/* Zoom to selection (⇧2), snap to grid (⇧G) and the minimap (⇧M) are in the toolbar's ⋯: fewer controls at first sight. */}
        <span className="zoom-sep" />
        <button className={p.page ? 'on' : ''} onClick={() => p.onToggle?.('page')} title={`The page it is for${result?.page ? `, a ${result.page.name}` : ''}, and text too small on it (⇧P)`} aria-label="Page" aria-pressed={!!p.page}>
          <Icon name="monitor" />
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
/** Where the drawing may start, below what floats over the top of the pane: the breadcrumbs, the tools and the focus chip (16 px under them). */
function floatingTop(f: HTMLElement): number {
  const tools = f.querySelector('.canvas-top');
  return tools ? tools.getBoundingClientRect().bottom - f.getBoundingClientRect().top + 16 : 0;
}

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
