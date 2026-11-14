// The drawing: the engine's SVG with pan and zoom, click to select, drag to move (pins), drop into a
// group to nest, and drops from the add palette.
import './preview.css';
import { is } from './keys.ts';
import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Box, PaletteItem, Point } from '@linework/core';
import { readableArea, SLIDE_MIN_PT, slideTextPt, textPtAt, type RenderResult } from '@linework/engine';
import type { PptxTemplate, SlideText } from '@linework/export';
import { Icon } from './icon.tsx';
import { setReadout } from './readout.ts';
import { t } from './i18n/index.ts';
import { PALETTE_MIME } from './add-menu.tsx';
import { describeResult } from './describe.ts';
import { presentedBy } from './export.ts';
import { bendAt, bendsOf, dragSegment, isHorizontal, nearestSegment, removeBend, snapBox, union, viewFor, type Snap } from './craft.ts';
import { BendHandles, Guides, LockBadges, Minimap, PageFrame, PinBadges } from './craft-overlays.tsx';
import { matchKinds } from './sketch.ts';

export interface Selection {
  kind: 'node' | 'group' | 'edge';
  id: string;
}

/** The template the Export menu makes decks in (its name and bytes), or `read` for the one a theme names (pptx:). */
export interface DeckTemplate {
  name?: string;
  bytes?: Uint8Array;
  keepLook?: boolean;
  read?(path: string): Promise<Uint8Array | undefined>;
}

/** A template read once per file: the page frame measures in it on every drawing. */
const readTemplates = new WeakMap<Uint8Array, PptxTemplate>();

/**
 * How large the drawing comes out on its slide in a PowerPoint template, asked of the PowerPoint export
 * itself as linework validate --template does: the smallest text (pt), the scale (pt per drawing px) and
 * the template's slide (px). Undefined without a template.
 */
async function inTemplate(r: RenderResult, d: DeckTemplate | undefined): Promise<{ pt: number; k: number; page: { name: string; width: number; height: number } } | undefined> {
  const named = r.theme?.pptx;
  const bytes = d?.bytes ?? (named && d?.read ? await d.read(named.template) : undefined);
  if (!bytes) return undefined;
  const { toPptx, readTemplate } = await import('@linework/export');
  let tpl = readTemplates.get(bytes);
  if (!tpl) readTemplates.set(bytes, (tpl = readTemplate(bytes)));
  const keepLook = d?.bytes ? !!d.keepLook : !!named?.keepLook;
  let first: SlideText | undefined;
  await toPptx({ ...r, name: '' }, { ...(r.theme ? { theme: r.theme } : {}), template: tpl, keepLook, ...(!d?.bytes && named?.layout ? { layout: named.layout } : {}), steps: false, onSlide: (s) => (first ??= s), onWarning: () => {} });
  const name = (d?.bytes ? d.name : named?.template)?.split('/').pop() ?? 'template';
  return first && { pt: first.smallestPt, k: first.scale, page: { name, width: tpl.width / 9525, height: tpl.height / 9525 } };
}

/** Zoom commands the app's palette can run. */
export interface PreviewControl {
  fit(): void;
  zoomToSelection(): void;
  /** Fit once the next drawing is in (after a tidy: it may land anywhere). */
  fitNext(): void;
  /** Opens the name editor over an element, starting with `initial` when given (typed over it), else
   * its name selected; `fresh`: just made by a sketch key. False when it cannot be named in place. */
  rename(s: Selection, opts?: { initial?: string; fresh?: boolean }): boolean;
  /** A name editor is open. */
  renaming(): boolean;
}

/** How a name typed in place was left: Enter, Tab (and on to a new connected box), Escape, or elsewhere. */
export type LabelExit = 'enter' | 'tab' | 'escape' | 'blur';

/** Where the selection is on screen, in pixels from the pane's top left. */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What a label editor can be opened on: an element, or the diagram's title and subtitle. */
export type LabelTarget = Selection | { kind: 'title' | 'subtitle'; id: '' };

interface Props {
  result?: RenderResult;
  /** The drawing is from an earlier, valid version of the text. */
  stale?: boolean;
  /** The text changed a moment ago and its drawing is on the way: a name cannot be typed in place yet. */
  catchingUp?: boolean;
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
  /** Takes over a name typed on an element (not the title): every exit, changed or not, with the kind
   * picked from the list while naming; `fresh` when a sketch key had just made it. */
  onLabelDone?(t: Selection, text: string | undefined, how: LabelExit, opts: { kind?: PaletteItem; fresh: boolean; was: string }): void;
  /** The kinds a name can start with ("fw: …"), for the list under the name editor. */
  kindsFor?(t: Selection): readonly PaletteItem[] | undefined;
  /** Drawn over the drawing at the selection (a menu, a hint): its screen box, and whether a name is being typed. */
  overlay?(rect: ScreenRect | undefined, renaming: boolean): React.ReactNode;
  /** A node dragged to a new top-left, in pin coordinates; `done` on release, with the group it was
   * dropped into when that changed (null: out of all groups). */
  onMove(id: string, pin: Point, done: boolean, group?: string | null): void;
  /** A group dragged by its header to a new top-left (pin coordinates). */
  onMoveGroup(id: string, pin: Point, done: boolean): void;
  /** A palette item dropped at a point (its card's top-left, pin coordinates), into a group or into
   * free space: it stays there, pinned. Without a point the layout places it; `refused` is the group
   * it was dropped on that cannot take it. */
  onPaletteDrop(index: number, at: Point | undefined, group: string | null, refused?: string): void;
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
  /** ⌘-click on a link drawn inside a shape (a sequence's ref box: data-link): follow it; true when it could. */
  onFollowLink?(target: string): boolean;
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
  /** The PowerPoint template decks are made in: on a slide the page is that template's slide, measured in its room. */
  deckTemplate?: DeckTemplate;
  /** Elements placed by hand (pinned): a small pin shows on each that is not locked. */
  pinned?: Set<string>;
  onToggle?(what: 'grid' | 'minimap' | 'page'): void;
  /** A segment of the selected line dragged: the line's new bends (pin space); `done` on release. */
  onBend?(id: string, via: Point[], done: boolean): void;
  /** What a screen reader hears for the focused element. */
  describe?(s: Selection): string;
  control?: React.Ref<PreviewControl>;
  children?: React.ReactNode;
  /** A word for people about how the drawing works (said once, where it helps). */
  onHint?(message: string): void;
  /** Pixels at the bottom a fit keeps clear (a session: the toolbar and the keys over it); outgrowing the rest fits it again. */
  clearBottom?: number;
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
  /** What a dragged node or group may go no further than (pin space): the drawing as it was, and a margin round it. */
  bounds?: Box;
}

/** How to move the view has been said this visit. */
let panSaid = false;

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

/** The drawing's extent in pin space (the sidecar's coordinates, which stay put when the layout's origin moves). */
function pinExtent(r: RenderResult | undefined): Box | undefined {
  if (!r?.width || !r.height || !r.origin) return undefined;
  const s = r.placed?.shift ?? { x: 0, y: 0 };
  return { x: s.x - r.origin.x, y: s.y - r.origin.y, width: r.width, height: r.height };
}

/** How far past the drawing a card or group can be dragged (drawing px): a drop far out of it stays near it. */
const REACH = 160;

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
  // With the page shown and the page a slide: how large the drawing comes out on the slide the
  // PowerPoint export makes (points per drawing px), for the drawing it was measured on. Loaded on first use.
  // In a template, its slide and the room its layout leaves, with the smallest text the deck reports.
  const [slideK, setSlideK] = useState<{ svg: string; k: number; pt?: number; page?: { name: string; width: number; height: number } }>();
  const deck = p.deckTemplate;
  useEffect(() => {
    const r = result;
    if (!p.page || !r?.svg || !r.theme || !r.page?.name.endsWith('slide')) return;
    let live = true;
    void inTemplate(r, deck)
      .then(async (tpl) => {
        if (tpl) return { svg: r.svg!, ...tpl };
        const { slideScale } = await import('@linework/export/fit');
        const k = await slideScale(r, r.theme!, r.page!.name.startsWith('4:3') ? '4:3' : '16:9');
        return k ? { svg: r.svg!, k } : undefined;
      })
      .then((s) => live && setSlideK(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [p.page, result, deck]);
  const [dragging, setDragging] = useState<Drag['mode']>();
  /** The marquee while it is dragged, in pixels relative to the frame. */
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number }>();
  /** The label being edited in place. */
  const [editing, setEditing] = useState<{ target: LabelTarget; text: string; el?: Element; initial?: string; fresh?: boolean }>();
  const editingNow = useRef(false);
  editingNow.current = !!editing;
  /** Space held: dragging pans, like in drawing apps. */
  const [spacePan, setSpacePan] = useState(false);
  /** The node under the pointer, for its connect handle. */
  const [hover, setHover] = useState<string>();
  /** What a click would select where the pointer is (the hover outline, and a box's lines). */
  const [pointed, setPointed] = useState<Selection>();
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

  // What still moves after an edit (the layout keeps what was there where it was, stay.ts) glides
  // there in 240 ms, so people watching can follow where a box went; lines that changed fade in.
  // Positions are compared in pin space: the view already makes up for the drawing's origin moving.
  const lastPlaced = useRef<{ doc: number | string; nodes: Map<string, Point>; groups: Map<string, Point>; edges: Map<string, string> }>(null);
  useLayoutEffect(() => {
    const placed = result?.placed;
    const root = drawingEl.current;
    if (!placed || !root || stale) return;
    const s = placed.shift ?? { x: 0, y: 0 };
    const at = (m: Map<string, Box>) => new Map([...m].map(([id, b]) => [id, { x: b.x + s.x, y: b.y + s.y }]));
    const now = { doc: docKey, nodes: at(placed.nodes), groups: at(placed.groups), edges: new Map([...placed.edges].map(([id, e]) => [id, e.points.map((q) => `${Math.round(q.x + s.x)},${Math.round(q.y + s.y)}`).join(' ')])) };
    const was = lastPlaced.current;
    lastPlaced.current = now;
    if (!was || was.doc !== docKey || drag.current || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const moving: [Element, number, number][] = [];
    const glide = (attr: string, before: Map<string, Point>, after: Map<string, Point>) => {
      for (const [id, q] of after) {
        const b = before.get(id);
        if (!b || Math.hypot(b.x - q.x, b.y - q.y) < 0.5) continue;
        const el = root.querySelector(`[${attr}="${CSS.escape(id)}"]`);
        if (el) moving.push([el, b.x - q.x, b.y - q.y]);
      }
    };
    glide('data-node', was.nodes, now.nodes);
    glide('data-group', was.groups, now.groups);
    const fading = [...root.querySelectorAll<SVGElement>('[data-edge]')].filter((el) => {
      const id = el.getAttribute('data-edge')!;
      return was.edges.has(id) && was.edges.get(id) !== now.edges.get(id) && moving.length > 0;
    });
    if (!moving.length) return;
    for (const [el, dx, dy] of moving) {
      const st = (el as SVGElement).style;
      st.transition = 'none';
      st.transform = `translate(${dx}px, ${dy}px)`;
    }
    for (const el of fading) {
      el.style.transition = 'none';
      el.style.opacity = '0';
    }
    // Read once so the start is painted before the transition to the new place begins.
    void root.getBoundingClientRect();
    for (const [el] of moving) {
      const st = (el as SVGElement).style;
      st.transition = 'transform 240ms cubic-bezier(0.2, 0, 0, 1)';
      st.transform = '';
    }
    for (const el of fading) {
      el.style.transition = 'opacity 240ms ease-out';
      el.style.opacity = '';
    }
  }, [result?.svg]); // eslint-disable-line react-hooks/exhaustive-deps -- once per drawing

  /** The pane size the view was last placed for (see the resize observer below). */
  const paneSize = useRef({ w: 0, h: 0 });
  /** The view is as fit() placed it, or as moves that keep it so carried it (the layout's origin
   * moving, the pane changing size, a selection brought into view); false once people pan or zoom. */
  const fittedView = useRef(false);
  /** The pane size fit() last fitted to. */
  const fittedPane = useRef({ w: 0, h: 0 });
  const [easing, setEasing] = useState(false);
  /** Counts the pans and zooms people make (wheel, drag, keys, buttons): a view they moved is theirs. */
  const touched = useRef(0);
  const byHand = (set: React.SetStateAction<View>) => {
    touched.current++;
    fittedView.current = false;
    setView(set);
  };
  /** The view that fits the drawing (and the page, when shown) in the pane, clear of the tools. */
  const fitView = useCallback((): View | undefined => {
    const f = frame.current;
    if (!f || !result?.width || !result.height) return undefined;
    const pad = 32;
    const top = Math.max(pad, floatingTop(f));
    const w = f.clientWidth - 2 * pad;
    const h = f.clientHeight - top - (p.clearBottom ?? BAR);
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
    return { scale, x: (f.clientWidth - (x1 - x0) * scale) / 2 - x0 * scale, y: top + Math.max(0, (h - label - (y1 - y0) * scale) / 2) - y0 * scale };
  }, [result?.width, result?.height, p.page, p.clearBottom]);
  const fit = useCallback(
    (ease = false) => {
      const f = frame.current;
      const next = fitView();
      if (!f || !next) return;
      paneSize.current = { w: f.clientWidth, h: f.clientHeight };
      fittedPane.current = { ...paneSize.current };
      fittedView.current = true;
      setEasing(ease);
      setView(next);
    },
    [fitView],
  );

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
      fittedView.current = false;
      const o = result.origin;
      setView((v) => ({ ...v, x: dropped.x - (dropped.pin.x - shift.x + o.x) * v.scale, y: dropped.y - (dropped.pin.y - shift.y + o.y) * v.scale }));
    } else if (anchor.current?.doc === docKey) {
      const dx = zero.x - anchor.current.x;
      const dy = zero.y - anchor.current.y;
      if (dx || dy) setView((v) => ({ ...v, x: v.x - dx * v.scale, y: v.y - dy * v.scale }));
    }
    anchor.current = { doc: docKey, ...zero };
  }, [result, docKey, fit]);

  // A drawing that was fitted and that nobody has panned or zoomed since fits again when the pane
  // changed size (the YAML pane, the window). In the editor not when the drawing grows past the edges:
  // the zoom only changes when asked (a new box is brought into view by panning, below), or when a
  // drop pushed a drawing that was wholly in view past an edge (keepInView, below). With a band to
  // keep clear (a session, `clearBottom`) it does: the sheet never runs under the toolbar there. Not
  // under a click in progress: a first click must leave the second of a double-click on the same
  // element, so it waits until the pointer has been still for a moment.
  const lastDown = useRef(0);
  const settle = useRef(0);
  const settleState = useRef({ view, editing: !!editing, fit });
  settleState.current = { view, editing: !!editing, fit };
  useEffect(() => {
    const f = frame.current;
    if (!f || !result?.width || !result.height || !fittedView.current) return;
    const paneMoved = f.clientWidth !== fittedPane.current.w || f.clientHeight !== fittedPane.current.h;
    const outgrown = p.clearBottom != null && !(view.x >= 0 && view.y >= 0 && view.x + result.width * view.scale <= f.clientWidth && view.y + result.height * view.scale <= f.clientHeight - p.clearBottom);
    if (!paneMoved && !outgrown) return;
    const run = () => {
      const st = settleState.current;
      if (!fittedView.current) return;
      const wait = lastDown.current + 550 - performance.now();
      if (wait > 0 || drag.current || st.editing) return void (settle.current = window.setTimeout(run, Math.max(wait, 200)));
      st.fit(true);
    };
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(run, 0);
    return () => window.clearTimeout(settle.current);
  }, [view, result?.width, result?.height, p.clearBottom]);
  useEffect(() => {
    if (!easing) return;
    const t = window.setTimeout(() => setEasing(false), 260);
    return () => window.clearTimeout(t);
  }, [easing, view]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const f = frame.current!;
    const px = cx ?? f.clientWidth / 2;
    const py = cy ?? f.clientHeight / 2;
    byHand((v) => {
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
    byHand(viewFor(union(boxes), { w: f.clientWidth, h: f.clientHeight }, { top: Math.max(0, floatingTop(f) - 48), bottom: BAR, max: 2, min: MIN }));
  };
  /** A tidy asked for a fit once its drawing is in. */
  const refit = useRef(false);
  useEffect(() => {
    if (!refit.current || !result?.svg) return;
    refit.current = false;
    requestAnimationFrame(() => fit(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per drawing: the refit asked for before it
  }, [result]);
  useImperativeHandle(p.control, () => ({
    fit,
    zoomToSelection,
    fitNext: () => void (refit.current = true),
    rename: (s, opts) => editLabel(s, undefined, opts),
    renaming: () => editingNow.current,
  }));

  // When the pane changes size (inspector opens, splitter moves): a drawing that was wholly in view
  // fits again, so opening the inspector never crops it; otherwise the centre stays where it was.
  const latest = useRef({ view, result, width: result?.width ?? 0, height: result?.height ?? 0, fit, fitView });
  latest.current = { view, result, width: result?.width ?? 0, height: result?.height ?? 0, fit, fitView };

  // A new drawing keeps the view, with two exceptions, so a drop, an undo, a node added in the YAML or
  // a layer shown alone never leaves the drawing half out of sight:
  // - a view fit() placed and nobody has panned or zoomed since fits again when the drawing no longer
  //   fits it, or when it would come out clearly larger or smaller (an undo after a far drop);
  // - a drawing that was wholly in view and now runs past an edge fits again, unless people zoomed in.
  // Checked on every drawing and on every drop, never during a drag (nothing jumps under the pointer)
  // and not right after a press: a double-click's second click stays on what the first one hit (a
  // name being typed follows the view). "Was wholly in view" is as last checked, and only while people have not
  // panned or zoomed since: the app's own moves (a selection brought into view) do not count.
  const lastSeen = useRef<{ doc: number | string; whole: boolean; touched: number } | null>(null);
  const followT = useRef(0);
  const keepInView = () => {
    window.clearTimeout(followT.current);
    const wait = lastDown.current + 550 - performance.now();
    if (wait > 0 || drag.current) return void (followT.current = window.setTimeout(keepInView, Math.max(wait, 120)));
    const f = frame.current;
    const { view: v, result: r, fit: refit, fitView: fitted } = latest.current;
    if (!f || !r?.origin || !r.width || !r.height) return;
    const inView = v.x >= -1 && v.y >= -1 && v.x + r.width * v.scale <= f.clientWidth + 1 && v.y + r.height * v.scale <= f.clientHeight - (p.clearBottom ?? BAR) + 1;
    const last = lastSeen.current?.doc === docKey ? lastSeen.current : undefined;
    const next = fitted();
    let again = false;
    if (last && next) {
      const untouched = fittedView.current;
      again = untouched ? !inView || Math.abs(next.scale / v.scale - 1) > 0.15 : last.whole && last.touched === touched.current && !inView;
    }
    if (again) refit(true);
    lastSeen.current = { doc: docKey, whole: again || inView, touched: touched.current };
  };
  useEffect(() => {
    if (!result?.svg) return;
    // After this drawing's own view changes (the origin carried, a drop anchored) are in.
    const r = requestAnimationFrame(keepInView);
    return () => (cancelAnimationFrame(r), window.clearTimeout(followT.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- each drawing
  }, [result]);
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
      else setView(({ ...v, x, y }));
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
      // A pinch sends small steps and zooms as the fingers go; a mouse wheel's notch (100 or more) is
      // one gentle step of about 20%, not ×2.7.
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY) * 0.01, 0.2)), e.clientX - r.left, e.clientY - r.top);
      else byHand((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
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
  /** What a click at this point selects: the element under it, or else the smallest box whose bounds hold the
   *  point, so the gap between a small event's circle and its name below still picks the event. */
  const hitAt = (el: Element | null | undefined, clientX: number, clientY: number): Selection | undefined => {
    const h = hitOf(el);
    if (h?.kind === 'node' || h?.kind === 'edge' || !result?.placed) return h;
    const q = toLayout(clientX, clientY);
    let best: { id: string; area: number } | undefined;
    for (const [id, b] of result.placed.nodes) {
      const area = b.width * b.height;
      if (q.x >= b.x && q.x <= b.x + b.width && q.y >= b.y && q.y <= b.y + b.height && (!best || area < best.area)) best = { id, area };
    }
    return best ? { kind: 'node', id: best.id } : h;
  };
  const toPin = (q: Point): Point => {
    const s = result?.placed?.shift ?? { x: 0, y: 0 };
    return { x: Math.round(q.x + s.x), y: Math.round(q.y + s.y) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    if ((e.target as Element).closest('.label-editor, .canvas-empty button')) return;
    lastDown.current = performance.now();
    // Only a field of the panels beside the drawing (properties, outline, YAML): not a name typed in a session.
    if ((document.activeElement as HTMLElement | null)?.closest?.('.side input, .side textarea, .side select, .shapes input, .editor-pane [contenteditable="true"]')) leftField.current = lastDown.current;
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
        bounds: reach(),
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
      bounds: reach(),
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  /** Where a drag may take what it moves: the drawing now and REACH round it (pin space). */
  const reach = (): Box | undefined => {
    const e = pinExtent(result);
    return e && { x: e.x - REACH, y: e.y - REACH, width: e.width + 2 * REACH, height: e.height + 2 * REACH };
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
    // Not far out of the drawing: a card let go well past it stays near its edge, so the sheet does
    // not grow to hold it and the zoom does not drop to keep it in view.
    if (d.bounds && d.moving) {
      const ox = d.moving.x - (d.box!.x + d.shift!.x);
      const oy = d.moving.y - (d.box!.y + d.shift!.y);
      x = Math.min(Math.max(x + ox, d.bounds.x), d.bounds.x + d.bounds.width - d.moving.width) - ox;
      y = Math.min(Math.max(y + oy, d.bounds.y), d.bounds.y + d.bounds.height - d.moving.height) - oy;
    }
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
      // What a click here would select, outlined (not on touch: a finger has no hover). The connect
      // handle belongs to the box it sits on.
      const under = e.pointerType === 'touch' ? undefined : over?.dataset.handle ? { kind: 'node' as const, id: over.dataset.handle } : hitAt(e.target as Element, e.clientX, e.clientY);
      const id = over?.dataset.node ?? over?.dataset.handle ?? (under?.kind === 'node' ? under.id : undefined);
      if (id !== hover) setHover(id);
      if (under?.kind !== pointed?.kind || under?.id !== pointed?.id) setPointed(under);
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
    if (d.mode === 'pan') return byHand((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
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
    setReadout({ x: pin.x, y: pin.y, width: Math.round(d.box!.width), height: Math.round(d.box!.height) });
    if (d.mode === 'group') {
      cancelAnimationFrame(frameReq.current);
      frameReq.current = requestAnimationFrame(() => p.onMoveGroup(d.group!, pin, false));
      return;
    }
    cancelAnimationFrame(frameReq.current);
    frameReq.current = requestAnimationFrame(() => p.onMove(d.node!, pin, false));
    if (d.many) return;
    const target = dropGroup(d, e.clientX, e.clientY, pin);
    setDropTarget(target !== (d.parent ?? null) ? target : undefined);
  };

  /** The innermost group whose header strip is under a layout point. */
  const headerAt = (q: Point): string | undefined => {
    let best: [string, number] | undefined;
    for (const [id, b] of result?.placed?.groups ?? [])
      if (q.x >= b.x && q.x <= b.x + b.width && q.y >= b.y && q.y <= b.y + HEADER && (!best || b.width * b.height < best[1])) best = [id, b.width * b.height];
    return best?.[0];
  };

  /**
   * The group under the pointer that can take the dragged node (pin space, so shifts do not matter).
   * Out of its own group (the pointer over a group around it, or over none) only once the card at `pin`
   * is clear of that group: a short drag, or one just over its border, keeps it in. Onto another group
   * it goes as soon as the pointer is over it.
   */
  const dropGroup = (d: Drag, cx: number, cy: number, pin: Point): string | null => {
    const s = result?.placed?.shift ?? { x: 0, y: 0 };
    const at = toLayout(cx, cy);
    const g = groupAt(d.groups!, { x: at.x + s.x, y: at.y + s.y });
    if (g && g !== d.parent && !p.canDrop(g, { node: d.node })) return d.parent ?? null;
    const home = d.parent ? d.groups!.get(d.parent) : undefined;
    if (home && g !== d.parent) {
      const around = new Set<string>();
      for (let id = result?.graph?.groups.find((x) => x.id === d.parent)?.parent; id; id = result?.graph?.groups.find((x) => x.id === id)?.parent) around.add(id);
      const { width, height } = d.box!;
      const over = pin.x < home.x + home.width && pin.x + width > home.x && pin.y < home.y + home.height && pin.y + height > home.y;
      if ((g === null || around.has(g)) && over) return d.parent!;
    }
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
    setReadout(undefined);
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
    setReadout(undefined);
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
      requestAnimationFrame(keepInView);
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
        const target = d.many ? (d.parent ?? null) : dropGroup(d, e.clientX, e.clientY, pin);
        p.onMove(d.node!, pin, true, target !== (d.parent ?? null) ? target : undefined);
        // A moved selection stays selected; a single node becomes the selection.
        if (!d.many) p.onSelect({ kind: 'node', id: d.node! });
        requestAnimationFrame(keepInView);
      }
      if (d.mode === 'marquee') {
        const got = inMarquee(d.x, d.y, e.clientX, e.clientY);
        p.onSelectMany(got, !!d.shiftKey || e.shiftKey);
        // A drag over empty canvas that caught nothing was most likely meant to move the view: say how, once.
        if (!got.length && !panSaid) {
          panSaid = true;
          p.onHint?.(t('To move the view: hold Space and drag, or scroll. Dragging over empty canvas selects.'));
        }
      }
      return;
    }
    if (e.button !== 0) return;
    // A click: the innermost element with an id under the pointer; ⌘ on a link drawn inside it follows that.
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const linked = under?.closest('[data-link]')?.getAttribute('data-link');
    if (linked && (navigator.platform.startsWith('Mac') ? e.metaKey : e.ctrlKey) && p.onFollowLink?.(linked)) return;
    const hit = hitAt(under, e.clientX, e.clientY);
    lastClick.current = null;
    if (!hit) return e.shiftKey ? undefined : p.onSelect(undefined);
    if (follow(hit)) return;
    lastClick.current = { s: hit, at: Date.now(), x: e.clientX, y: e.clientY };
    p.onSelect(hit, e.shiftKey);
  };
  /** The first click of a double-click: the inspector it opens can move the drawing before the second. */
  const lastClick = useRef<{ s: Selection; at: number; x: number; y: number }>(null);
  /** Double-click on an element: edit its label right there, or the inspector's field when that cannot be. */
  const editSelected = (s: Selection) => {
    p.onSelect(s);
    // A field just left by this click: its change is being drawn. The name opens once it is, with
    // whatever was typed in the meantime.
    if (p.catchingUp) return void (pendingRename.current = { s, typed: '' });
    if (editLabel(s)) return;
    requestAnimationFrame(() => requestAnimationFrame(() => (document.querySelector('.inspector .field:nth-child(2) input') as HTMLInputElement | null)?.select()));
  };
  /** A double-click's name editor waiting for the drawing to catch up, and the keys typed meanwhile. */
  const pendingRename = useRef<{ s: Selection; typed: string } | null>(null);
  useEffect(() => {
    const w = pendingRename.current;
    if (!w || p.catchingUp) return;
    pendingRename.current = null;
    if (editLabel(w.s, undefined, w.typed ? { initial: w.typed } : {})) return;
    requestAnimationFrame(() => (document.querySelector('.inspector .field:nth-child(2) input') as HTMLInputElement | null)?.select());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when the drawing has caught up
  }, [p.catchingUp, result]);
  /** When a click on the drawing last took the keyboard from a text field (an inspector field, the YAML). */
  const leftField = useRef(-Infinity);
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
  const editLabel = (target: LabelTarget, el?: Element, opts: { initial?: string; fresh?: boolean } = {}): boolean => {
    const text = p.labelOf(target);
    if (text == null || (!el && !selectedBox(result, target as Selection))) return false;
    editingNow.current = true;
    setEditing({ target, text, el, ...opts });
    return true;
  };
  /** Where the label editor sits, from the current view, so it follows a view that moves. */
  const editorRect = (t: LabelTarget, el?: Element): EditorRect | undefined => {
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
    // A box: the name is typed where its name is drawn, inside it, so the box itself (outline, icon,
    // kind) and the selection ring round it stay in sight while it is named.
    const spot = t.kind === 'node' ? labelSpot(drawingEl.current, t.id, b) : undefined;
    if (spot) {
      const s = view.scale;
      return { left: view.x + spot.x * s, top: view.y + spot.y * s, width: spot.width * s, height: spot.height * s, size: spot.size * s, inShape: true, align: spot.align, font: spot.font };
    }
    const height = 36;
    // A group: its name is typed where it is written, at the left of its header, in a field the size
    // of a name, not one as wide as the group over the boxes in it.
    if (t.kind === 'group') return { left: view.x + b.x * view.scale + 4, top: view.y + (b.y + 22) * view.scale - height / 2, width: Math.min(Math.max(b.width * view.scale - 8, 180), 280), height, size: 14 };
    const width = Math.max(b.width * view.scale, 180);
    const cx = view.x + (b.x + b.width / 2) * view.scale;
    // Nodes and lines: over their middle.
    const cy = view.y + (b.y + b.height / 2) * view.scale;
    return { left: cx - width / 2, top: cy - height / 2, width, height, size: 14 };
  };

  /** The selection's box on screen (one element, or all of a multiple selection), for what floats over it. */
  const overlayRect = (): ScreenRect | undefined => {
    const boxes = selection.map((s) => selectedBox(result, s)).filter((b): b is Box => !!b);
    if (!boxes.length || dragging) return undefined;
    const u = union(boxes);
    return { left: view.x + u.x * view.scale, top: view.y + u.y * view.scale, width: u.width * view.scale, height: u.height * view.scale };
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
    if (!e.dataTransfer.types.includes(PALETTE_MIME) || !result?.placed) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const d = dropPlace(toLayout(e.clientX, e.clientY), paletteDrag.current);
    setDropTarget(d.into ?? undefined);
    setGhost({ card: d.card, refused: d.refused });
  };
  const onDrop = (e: React.DragEvent) => {
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
    // The app moved it, not people: a fitted view stays one, so it fits again when the pane changes size.
    if (dx || dy) setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    // Only when the selection changes, not on every view change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.kind, selected?.id, result]);
  const hoverBox = !dragging && hover && !stale && p.canConnect(hover) ? result?.placed?.nodes.get(hover) : undefined;
  // The hover outline: on what a click would select, never while something is dragged, connected,
  // dropped or named, and not over what is selected already (its rust ring says it).
  const still = !dragging && !editing && !ghost && !stale && !spacePan;
  const outlined = still && pointed && pointed.kind !== 'edge' && !selection.some((s) => s.kind === pointed.kind && s.id === pointed.id) ? selectedBox(result, pointed) : undefined;
  // A line under the pointer, and the lines of a box under it, are drawn in ink: "this talks to that".
  // Only the live drawing is marked; exports draw from the text.
  useLayoutEffect(() => {
    const root = drawingEl.current;
    if (!root) return;
    for (const el of root.querySelectorAll<SVGElement>('.lit-stroke, .lit-fill')) {
      el.classList.remove('lit-stroke', 'lit-fill');
      el.style.removeProperty('--lit-width');
    }
    if (!still || !pointed || pointed.kind === 'group') return;
    const ids = pointed.kind === 'edge' ? [pointed.id] : (result?.graph?.edges ?? []).filter((e) => e.from.node === pointed.id || e.to.node === pointed.id).map((e) => e.id);
    for (const id of ids)
      for (const g of root.querySelectorAll(`[data-edge="${CSS.escape(id)}"]`)) {
        // What is drawn in the line's own colour (the line, its ends): not a double line's light core, nor a focus halo.
        const color = g.querySelector(':scope > path[fill="none"]:not([stroke="transparent"]):not([data-halo])')?.getAttribute('stroke');
        if (!color) continue;
        for (const el of g.children) {
          // A little heavier too: on a shared screen a change of colour alone is easily missed.
          if (el.getAttribute('stroke') === color) {
            el.classList.add('lit-stroke');
            (el as SVGElement).style.setProperty('--lit-width', String(Number(el.getAttribute('stroke-width') ?? 1) * 1.6));
          }
          if (el.getAttribute('fill') === color) el.classList.add('lit-fill');
        }
      }
  }, [pointed?.kind, pointed?.id, still, result?.svg]); // eslint-disable-line react-hooks/exhaustive-deps -- the graph comes with the svg
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
  // On a slide that is the slide the PowerPoint export makes (its margins and title row: slideScale),
  // as linework validate measures it; on a sheet of paper the drawing fitted onto it. Until the slide's
  // scale is known (a moment, the first time), the drawing fitted onto the page.
  const measured = slideK && slideK.svg === result?.svg ? slideK : undefined;
  const onSlide = measured?.k;
  const page = measured?.page ?? result?.page;
  const pageInfo =
    p.page && page && result?.svg && result.width && result.height
      ? {
          page,
          pt: measured?.pt ?? (onSlide ? textPtAt(result.svg, onSlide) : slideTextPt(result.svg, result.width, result.height, page)),
          readable: readableArea(result.svg, page, onSlide ? { width: result.width, height: result.height, ptPerPx: onSlide } : undefined),
          presentedBy: presentedBy(result).map((v) => v.title ?? v.name),
        }
      : undefined;
  // The overview only earns its place when the drawing does not fit the pane.
  const f = frame.current;
  const overflows = !!f && !!result?.width && (result.width * view.scale > f.clientWidth + 1 || result.height! * view.scale > f.clientHeight - BAR + 1);
  const announce = selected ? (p.describe?.(selected) ?? selected.id) : selection.length > 1 ? t('{count} selected', { count: selection.length }) : '';
  // The drawing in plain words (the summary Describe shows), read after the pane's name.
  const wordsId = useId();
  const words = useMemo(() => describeResult(result)?.summary, [result]);

  return (
    <div
      className={`preview${dragging ? ` dragging-${dragging}` : ''}${spacePan ? ' space-pan' : ''}${kb ? ' kb' : ''}`}
      ref={frame}
      tabIndex={0}
      role="application"
      aria-roledescription="drawing"
      aria-activedescendant={selected && box ? 'canvas-focus' : undefined}
      aria-label={t('Drawing. Tab moves between elements, ⌥ arrows to the nearest one, arrows nudge, Delete removes, F6 goes on to the toolbar.')}
      aria-describedby={words ? wordsId : undefined}
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
      onPointerLeave={() => {
        hovered.current = false;
        setPointed(undefined);
        setHover(undefined);
      }}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
        setDropTarget(undefined);
        setGhost(undefined);
      }}
      onDrop={onDrop}
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
        if (s) editSelected(s);
      }}
      onKeyDown={(e) => {
        if (drag.current && e.key === 'Escape') {
          e.preventDefault();
          return cancel();
        }
        if (e.target === e.currentTarget && ['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) setKb(true);
        // Letters typed right after a click took the keyboard from a text field are typing, not
        // shortcuts: into the name editor a double-click is opening, or nowhere while the drawing catches up.
        const printable = e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey;
        if (printable && e.target === e.currentTarget && (pendingRename.current || (p.catchingUp && performance.now() - leftField.current < 2000))) {
          if (pendingRename.current) pendingRename.current.typed += e.key;
          e.preventDefault();
          return;
        }
        p.onKeyDown(e);
        // ⇧1 fits everything, ⇧2 the selection (as in Figma); by key code, since ⇧ changes the character.
        // After the app's keys: a name being typed (in a session) keeps its "!" and "@".
        if (!e.defaultPrevented && e.target === e.currentTarget && (is(e, 'fit') || is(e, 'zoom-selection'))) {
          e.preventDefault();
          return is(e, 'fit') ? fit() : zoomToSelection();
        }
      }}
    >
      {empty ? (
        <div className="preview-empty">
          <Icon name="triangle-exclamation-point" size={20} />
          <p>{t('Nothing to draw yet. Fix the problems in the editor, or start from a template.')}</p>
        </div>
      ) : (
        <div className={`stage${stale ? ' stale' : ''}${easing ? ' easing' : ''}`} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, ['--inv' as string]: 1 / view.scale, ['--drawn-ink' as string]: result?.theme?.text }}>
          <div className="drawing" ref={drawingEl} dangerouslySetInnerHTML={{ __html: result!.svg! }} />
          {target && (
            <div className="drop-ring" style={{ left: target.x + o.x, top: target.y + o.y, width: target.width, height: target.height, borderWidth: 2 / view.scale }}>
              {ghost && <span style={{ fontSize: 12 / view.scale, padding: `${2 / view.scale}px ${6 / view.scale}px` }}>{t('Into {group}', { group: groupName(dropTarget!) })}</span>}
            </div>
          )}
          {refusedBox && (
            <div className="drop-ring refused" style={{ left: refusedBox.x + o.x, top: refusedBox.y + o.y, width: refusedBox.width, height: refusedBox.height, borderWidth: 2 / view.scale }}>
              <span style={{ fontSize: 12 / view.scale, padding: `${2 / view.scale}px ${6 / view.scale}px` }}>{t('Cannot go in {group}', { group: groupName(ghost!.refused!) })}</span>
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
              title={t('Drag to another element to connect')}
              aria-label={t('Connect {id}', { id: hover! })}
              tabIndex={-1}
              style={{ left: hoverBox.x + hoverBox.width + o.x, top: hoverBox.y + hoverBox.height / 2 + o.y, transform: `translate(-50%, -50%) scale(${1 / view.scale})` }}
            />
          )}
          {outlined && <div className="hover-ring" style={{ left: outlined.x - 3, top: outlined.y - 3, width: outlined.width + 6, height: outlined.height + 6 }} />}
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
                >
                  {/* Square corner handles, and over the one selected element its id and kind, like a surveyor's callout. */}
                  <i className="sel-handle tl" />
                  <i className="sel-handle tr" />
                  <i className="sel-handle bl" />
                  <i className="sel-handle br" />
                  {s === selected && !dragging && <span className="sel-callout" aria-hidden="true">{calloutOf(result, s)}</span>}
                </div>
              )
            );
          })}
          {pageInfo?.pt != null && (
            <PageFrame
              width={result!.width!}
              height={result!.height!}
              page={pageInfo.page}
              pt={pageInfo.pt}
              minPt={SLIDE_MIN_PT}
              readable={pageInfo.readable}
              presentedBy={pageInfo.presentedBy}
              boxes={[...(result!.placed?.nodes.values() ?? [])].map((b) => ({ ...b, x: b.x + o.x, y: b.y + o.y }))}
              scale={view.scale}
            />
          )}
          {lockedBoxes.length > 0 && <LockBadges boxes={lockedBoxes} scale={view.scale} />}
          {pinnedBoxes.length > 0 && <PinBadges boxes={pinnedBoxes} scale={view.scale} />}
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
      {p.overlay?.(overlayRect(), !!editing)}
      {editing && editorRect(editing.target, editing.el)?.inShape && (
        // The box's own drawn name gives way to the one being typed in its place.
        <style>{`.drawing [data-node="${CSS.escape(editing.target.id)}"] > text:first-of-type { visibility: hidden; }`}</style>
      )}
      {editing && editorRect(editing.target, editing.el) && (
        <LabelEditor
          key={`${editing.target.kind}:${editing.target.id}:${editing.fresh ? 'fresh' : ''}`}
          text={editing.initial ?? editing.text}
          caret={editing.initial != null}
          kinds={editing.target.kind === 'node' || editing.target.kind === 'group' ? p.kindsFor?.(editing.target) : undefined}
          {...editorRect(editing.target, editing.el)!}
          onDone={(text, how, kind) => {
            const { target, fresh } = editing;
            editingNow.current = false;
            setEditing(undefined);
            frame.current?.focus({ preventScroll: true });
            if (p.onLabelDone && (target.kind === 'node' || target.kind === 'group')) return p.onLabelDone(target, text, how, { kind, fresh: !!fresh, was: editing.text });
            if (text != null && text !== editing.text) p.onLabel(target, text);
          }}
        />
      )}
      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
      <p id={wordsId} hidden>
        {words}
      </p>
      {p.children}
      {p.minimap && overflows && result?.placed && !empty && (
        <Minimap
          placed={result.placed}
          origin={o}
          width={result.width!}
          height={result.height!}
          view={view}
          pane={{ w: f!.clientWidth, h: f!.clientHeight }}
          onCentre={(x, y) => byHand((v) => ({ ...v, x: f!.clientWidth / 2 - x * v.scale, y: (f!.clientHeight - BAR) / 2 - y * v.scale }))}
        />
      )}
      <div className="zoom" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        <button onClick={() => zoomAt(1 / 1.2)} title={t('Zoom out (⌘−)')} aria-label={t('Zoom out')}>
          <Icon name="minus" />
        </button>
        <button className="zoom-level" onClick={() => byHand((v) => ({ ...v, scale: 1 }))} title={t('Actual size')} aria-label={t('Zoom {percent}%, click for actual size', { percent: Math.round(view.scale * 100) })}>
          {Math.round(view.scale * 100)}%
        </button>
        <button onClick={() => zoomAt(1.2)} title={t('Zoom in (⌘+)')} aria-label={t('Zoom in')}>
          <Icon name="plus" />
        </button>
        <button onClick={() => fit()} title={t('Fit to screen (⇧1 or ⌘0)')} aria-label={t('Fit to screen')}>
          <Icon name="maximize" />
        </button>
        {/* Zoom to selection (⇧2), snap to grid (⇧G) and the minimap (⇧M) are in the toolbar's ⋯: fewer controls at first sight. */}
        <span className="zoom-sep" />
        <button className={p.page ? 'on' : ''} onClick={() => p.onToggle?.('page')} title={result?.page ? t('Show the {page} it goes on, and any text too small to read there (⇧P)', { page: result.page.name }) : t('Show the page it goes on, and any text too small to read there (⇧P)')} aria-label={t('Page')} aria-pressed={!!p.page}>
          <Icon name="monitor" />
        </button>
      </div>
    </div>
  );
}

/** A label typed in place: Enter keeps it, Esc drops it, and no key reaches the drawing's shortcuts.
 * Tab keeps it too (the app goes on to a new connected box). With kinds, "fw:" lists the kinds that
 * word names, and ↑ ↓ pick one. */
function LabelEditor(p: EditorRect & { text: string; caret?: boolean; kinds?: readonly PaletteItem[]; onDone(text: string | undefined, how: LabelExit, kind?: PaletteItem): void }) {
  const [text, setText] = useState(p.text);
  const [pick, setPick] = useState(0);
  const done = useRef(false);
  const listId = useId();
  const word = p.kinds ? /^\s*([A-Za-z][A-Za-z0-9-]{0,23})\s*:(?!\/\/)/.exec(text)?.[1] : undefined;
  const options = useMemo(() => (word && p.kinds ? matchKinds(word, p.kinds, 5) : []), [word, p.kinds]);
  const chosen = options.length ? options[Math.min(pick, options.length - 1)] : undefined;
  const finish = (value: string | undefined, how: LabelExit) => {
    if (done.current) return;
    done.current = true;
    p.onDone(value, how, value == null ? undefined : chosen);
  };
  return (
    <>
      <input
        className={p.inShape ? 'label-editor in-shape' : 'label-editor'}
        aria-label={t('Label')}
        autoFocus
        onFocus={(e) => (p.caret ? e.currentTarget.setSelectionRange(text.length, text.length) : e.currentTarget.select())}
        value={text}
        spellCheck={false}
        autoComplete="off"
        role={p.kinds ? 'combobox' : undefined}
        aria-expanded={p.kinds ? options.length > 0 : undefined}
        aria-controls={options.length ? listId : undefined}
        aria-activedescendant={chosen ? `${listId}-${options.indexOf(chosen)}` : undefined}
        aria-autocomplete={p.kinds ? 'list' : undefined}
        style={{ left: p.left, top: p.top, width: p.width, height: p.height, fontSize: p.size, ...(p.align ? { textAlign: p.align } : {}), ...(p.font ? { fontFamily: p.font.family, fontWeight: p.font.weight, color: p.font.color } : {}) }}
        onChange={(e) => {
          setText(e.target.value);
          setPick(0);
        }}
        onBlur={() => finish(text.trim() || undefined, 'blur')}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') finish(text.trim() || undefined, 'enter');
          else if (e.key === 'Tab' && !e.shiftKey) finish(text.trim() || undefined, 'tab');
          else if (e.key === 'Escape') finish(undefined, 'escape');
          else if (options.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) setPick((i) => (i + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
          else return;
          e.preventDefault();
        }}
      />
      {options.length > 0 && (
        <ul className="kind-list" id={listId} role="listbox" aria-label={t('Kind')} style={{ left: p.left, top: p.top + p.height + 4, minWidth: Math.min(p.width, 260) }}>
          {options.map((o, i) => (
            <li
              key={o.collection + o.kind}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o === chosen}
              onPointerDown={(e) => {
                // Picked with the pointer: the name editor keeps the focus.
                e.preventDefault();
                e.stopPropagation();
                setPick(i);
              }}
            >
              <Icon name={o.icon} size={14} /> <span>{o.label}</span> <code>{o.kind}</code>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** The selected element's callout: its id and the kind it is written as ("afw-hub · firewall"). */
function calloutOf(result: RenderResult | undefined, s: Selection): string {
  const g = result?.graph;
  const kind = s.kind === 'node' ? g?.nodes.find((n) => n.id === s.id)?.kind : s.kind === 'group' ? g?.groups.find((x) => x.id === s.id)?.kind : t('line');
  return kind && kind !== s.id ? `${s.id} · ${kind}` : s.id;
}

/** Where the label editor goes (pane pixels), and for a box, that it sits in it, over its drawn name. */
interface EditorRect {
  left: number;
  top: number;
  width: number;
  height: number;
  size: number;
  inShape?: boolean;
  align?: 'left' | 'center' | 'right';
  /** The drawn name's own type, so the name typed reads as the one it becomes. */
  font?: { family: string; weight: string; color: string };
}

/**
 * Where a box's name is drawn, in SVG coordinates (as `b`, its box): the line its name is typed on,
 * from where the name starts to the box's inner edge, at the size the name is drawn. Undefined when the
 * box draws no name of its own (the editor then goes over its middle).
 */
function labelSpot(drawing: Element | null, id: string, b: Box): (Box & { size: number; align: 'left' | 'center' | 'right'; font: NonNullable<EditorRect['font']> }) | undefined {
  const g = drawing?.querySelector(`[data-node="${CSS.escape(id)}"]`);
  // The name is the box's first text; the kind and badges come after it.
  const text = g ? [...g.children].find((c): c is SVGTextElement => c.tagName.toLowerCase() === 'text') : undefined;
  if (!text) return undefined;
  // The drawing's own coordinates can sit off the layout's (a sheet margin, a viewBox): the name is
  // measured against the box's shape, its first element, and carried onto `b` from there.
  const shape = g!.firstElementChild as SVGGraphicsElement | null;
  const sb = shape && shape !== text ? shape.getBBox() : undefined;
  const raw = text.getBBox();
  if (!sb?.width || (!raw.width && !raw.height)) return undefined;
  const k = b.width / sb.width;
  const tb = { x: b.x + (raw.x - sb.x) * k, y: b.y + (raw.y - sb.y) * k, width: raw.width * k, height: raw.height * k };
  const size = (parseFloat(text.getAttribute('font-size') ?? '') || raw.height / 1.25 || 13.5) * k;
  const anchor = getComputedStyle(text).textAnchor;
  const pad = 8;
  // A name drawn inside the box can run to its edge; one drawn beside or under it gets room of its own.
  const inside = tb.x >= b.x - 1 && tb.x + tb.width <= b.x + b.width + 1 && tb.y >= b.y - 1 && tb.y + tb.height <= b.y + b.height + 1;
  const room = Math.max(tb.width, size * 9);
  let x: number;
  let right: number;
  let align: 'left' | 'center' | 'right' = 'left';
  if (anchor === 'middle') {
    const c = tb.x + tb.width / 2;
    const half = inside ? Math.min(c - b.x, b.x + b.width - c) - pad : room / 2;
    x = c - half;
    right = c + half;
    align = 'center';
  } else if (anchor === 'end') {
    right = tb.x + tb.width;
    x = inside ? b.x + pad : right - room;
    align = 'right';
  } else {
    x = tb.x;
    right = inside ? b.x + b.width - pad : x + room;
  }
  const height = size * 1.45;
  const cs = getComputedStyle(text);
  return { x, y: tb.y + tb.height / 2 - height / 2, width: Math.max(right - x, size * 4), height, size, align, font: { family: cs.fontFamily, weight: cs.fontWeight, color: cs.fill } };
}

/** Where the drawing may start, below what floats over the top of the pane: the breadcrumbs, the tools and the focus chip (16 px under them). */
function floatingTop(f: HTMLElement): number {
  const tools = f.querySelector('.canvas-top');
  return tools ? tools.getBoundingClientRect().bottom - f.getBoundingClientRect().top + 16 : 0;
}

/** What a click on this element selects: the innermost element with an id (a box over its group, a line). */
function hitOf(el: Element | null | undefined): Selection | undefined {
  const hit = el?.closest?.('[data-node],[data-edge],[data-group]') as HTMLElement | null | undefined;
  if (!hit) return undefined;
  const kind = hit.dataset.node != null ? 'node' : hit.dataset.edge != null ? 'edge' : 'group';
  return { kind, id: hit.dataset[kind]! };
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
