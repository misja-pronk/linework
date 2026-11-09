// The diff as a picture. Nothing here draws a diagram: it takes drawings as the renderer made them and
// lays marks over them. What a mark means never rests on its colour alone: each kind has its own sign
// (+ ~ −), its own outline (solid, dashed, dotted) and is named in the key.
import type { Box, Graph, Placed, Point } from '@cartography/core';
import { baselineOffset, fitText, measureText, type Theme } from '@cartography/theme';
import type { GraphDiff, Status } from './structure.ts';

/** A rendered diagram: what `render` of the engine returns, as far as the overlay needs it. */
export interface Drawing {
  svg: string;
  width: number;
  height: number;
  /** Where the layout's 0,0 sits in the SVG. */
  origin: Point;
  graph: Graph;
  placed: Placed;
  theme: Theme;
}

export interface Picture {
  svg: string;
  width: number;
  height: number;
}

/** What to mark in one drawing, by node id, group id and the graph's edge id. */
export interface Marks {
  nodes: Map<string, Status>;
  groups: Map<string, Status>;
  edges: Map<string, Status>;
}

export interface OverlayOptions {
  /** What the drawing is compared with, named in the key: "main", "HEAD~1", a file name. */
  against?: string;
  /** Names above the two halves of a side-by-side picture. */
  labels?: { before?: string; after?: string };
  /** Side by side: next to each other, under each other, or whichever keeps the picture closest to a page (default). */
  arrange?: 'auto' | 'row' | 'column';
}

const SIGN: Record<Status, string> = { added: '+', changed: '~', removed: '−' };
/** Outlines differ in pattern, not only in colour. */
const DASH: Record<Status, string> = { added: '', changed: '7 5', removed: '1.5 5' };
const TAG = 18;
const KEY = 44;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n: number) => Math.round(n * 10) / 10;
const dash = (s: Status) => (DASH[s] ? ` stroke-dasharray="${DASH[s]}" stroke-linecap="round"` : '');

/** Theme tokens only: added in the green tone, changed in amber, removed in rose. */
function colour(theme: Theme, s: Status): string {
  return theme.tones[s === 'added' ? 'green' : s === 'changed' ? 'amber' : 'rose'].fg;
}

/** The marks of one side: the newer drawing shows what was added and changed, the older what was removed and changed. */
export function marksFor(diff: GraphDiff, side: 'before' | 'after'): Marks {
  const skip: Status = side === 'after' ? 'removed' : 'added';
  const marks: Marks = { nodes: new Map(), groups: new Map(), edges: new Map() };
  for (const n of diff.nodes) if (n.status !== skip) marks.nodes.set(n.id, n.status);
  for (const g of diff.groups) if (g.status !== skip) marks.groups.set(g.id, g.status);
  for (const e of diff.edges) {
    const id = e.edge?.[side];
    if (id && e.status !== skip) marks.edges.set(id, e.status);
  }
  return marks;
}

function textAt(x: number, cy: number, s: string, size: number, weight: number, fill: string, extra = ''): string {
  return `<text x="${r1(x)}" y="${r1(cy + baselineOffset(size))}" font-size="${size}" font-weight="${weight}" fill="${fill}"${extra}>${esc(s)}</text>`;
}

/** The sign and the word in a pill, e.g. "+ added"; left edge at x, centred on cy. */
function tag(theme: Theme, s: Status, x: number, cy: number, word: string = s): { svg: string; width: number } {
  const label = word ? `${SIGN[s]} ${word}` : SIGN[s];
  const width = Math.ceil(measureText(label, 11, 600)) + 14;
  const svg =
    `<rect x="${r1(x)}" y="${r1(cy - TAG / 2)}" width="${width}" height="${TAG}" rx="${TAG / 2}" fill="${colour(theme, s)}" stroke="${theme.canvas}" stroke-width="1.5"/>` +
    textAt(x + 7, cy, label, 11, 600, theme.canvas);
  return { svg, width };
}

const tagWidth = (s: Status) => Math.ceil(measureText(`${SIGN[s]} ${s}`, 11, 600)) + 14;

/** An outline around a box with its tag on the top right corner. */
function outline(theme: Theme, s: Status, b: Box, radius: number, id: string, kind: 'node' | 'group'): string {
  const o = kind === 'group' ? 0 : 5;
  const rect = `<rect x="${r1(b.x - o)}" y="${r1(b.y - o)}" width="${r1(b.width + 2 * o)}" height="${r1(b.height + 2 * o)}" rx="${radius + o}" fill="none" stroke="${colour(theme, s)}" stroke-width="2.5"${dash(s)}/>`;
  const t = tag(theme, s, b.x + b.width + o - 10 - tagWidth(s), b.y - o);
  return `<g data-diff="${s}" data-${kind}="${esc(id)}">${rect}${t.svg}</g>`;
}

const polyline = (pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${r1(p.x)} ${r1(p.y)}`).join(' ');

/** The point a share of the way along a line. */
function along(pts: Point[], share: number): Point {
  const lengths = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y));
  let left = lengths.reduce((a, b) => a + b, 0) * share;
  for (const [i, l] of lengths.entries()) {
    if (left <= l && l > 0) {
      const [a, b] = [pts[i]!, pts[i + 1]!];
      return { x: a.x + ((b.x - a.x) * left) / l, y: a.y + ((b.y - a.y) * left) / l };
    }
    left -= l;
  }
  return pts[pts.length - 1]!;
}

/**
 * A line's mark: a wide band along it (or the line itself, for one that is gone) and its sign in a dot
 * on the line, at the first spot that covers nothing in `avoid` (the line's own label, cards, ghosts).
 */
function edgeMark(theme: Theme, s: Status, pts: Point[], id: string, avoid: Box[], ghost = false, label?: Box): string {
  if (pts.length < 2) return '';
  const c = colour(theme, s);
  const spots = [0.5, 0.3, 0.7, 0.2, 0.8, 0.12, 0.88].map((share) => along(pts, share));
  // A short line is all label: the sign then hangs on the corner of the label, like a badge, clear of its text.
  const at = spots.find((p) => !avoid.some((b) => hit({ x: p.x - 9, y: p.y - 9, width: 18, height: 18 }, b, 2))) ?? (label ? { x: label.x + label.width + 3, y: label.y - 3 } : spots[0]!);
  const band = ghost
    ? `<path d="${polyline(pts)}" fill="none" stroke="${c}" stroke-width="2"${dash(s)}/>`
    : `<path d="${polyline(pts)}" fill="none" stroke="${c}" stroke-width="7" stroke-opacity="0.3" stroke-linejoin="round"${dash(s) || ' stroke-linecap="round"'}/>`;
  const dot = `<circle cx="${r1(at.x)}" cy="${r1(at.y)}" r="9" fill="${c}" stroke="${theme.canvas}" stroke-width="1.5"/>${textAt(at.x, at.y, SIGN[s], 12, 600, theme.canvas, ' text-anchor="middle"')}`;
  return `<g data-diff="${s}" data-edge="${esc(id)}">${band}${dot}</g>`;
}

const grown = (b: Box, by: number): Box => ({ x: b.x - by, y: b.y - by, width: b.width + 2 * by, height: b.height + 2 * by });

/** The marks over one drawing, in its layout coordinates; `also` are boxes a line's sign keeps clear of (ghosts). */
function marksSvg(d: Drawing, marks: Marks, also: Box[] = []): string {
  const { theme, graph, placed } = d;
  const out: string[] = [];
  const nodes = new Map(marks.nodes);
  for (const e of graph.edges) {
    const s = marks.edges.get(e.id);
    if (!s) continue;
    const route = placed.edges.get(e.id);
    // A line drawn as a badge on its card has no route: its card is what changed.
    if (e.badge || !route || route.points.length < 2) {
      if (!nodes.has(e.from.node)) nodes.set(e.from.node, 'changed');
    } else out.push(edgeMark(theme, s, route.points, e.id, [...(route.label ? [grown(route.label, 8)] : []), ...placed.nodes.values(), ...also], false, route.label));
  }
  for (const g of graph.groups) {
    const [s, b] = [marks.groups.get(g.id), placed.groups.get(g.id)];
    if (s && b) out.unshift(outline(theme, s, b, theme.radius.group, g.id, 'group'));
  }
  for (const n of graph.nodes) {
    const [s, b] = [nodes.get(n.id), placed.nodes.get(n.id)];
    if (s && b) out.push(outline(theme, s, b, theme.radius.card, n.id, 'node'));
  }
  return out.join('');
}

interface Ghost {
  id: string;
  label: string;
  box: Box;
}

const hit = (a: Box, b: Box, room = 0) => a.x < b.x + b.width + room && b.x < a.x + a.width + room && a.y < b.y + b.height + room && b.y < a.y + a.height + room;
const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
const centre = (b: Box): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** Where the line from the middle of a box towards a point leaves the box. */
function leave(b: Box, to: Point): Point {
  const c = centre(b);
  const [dx, dy] = [to.x - c.x, to.y - c.y];
  if (!dx && !dy) return c;
  const t = Math.min(dx ? b.width / 2 / Math.abs(dx) : Infinity, dy ? b.height / 2 / Math.abs(dy) : Infinity, 1);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/**
 * What is gone, drawn where it used to be. The older drawing is laid over the newer one by what both
 * still have; a removed card whose place has been taken stands in a row under the drawing instead.
 */
function ghosts(before: Drawing, after: Drawing, diff: GraphDiff): { svg: string; bounds: Box | undefined; row: Ghost[]; boxes: Box[] } {
  const theme = after.theme;
  const both = [...after.placed.nodes].filter(([id]) => before.placed.nodes.has(id));
  const shift = both.length
    ? { x: median(both.map(([id, b]) => b.x - before.placed.nodes.get(id)!.x)), y: median(both.map(([id, b]) => b.y - before.placed.nodes.get(id)!.y)) }
    : undefined;
  const moved = (b: Box): Box => ({ ...b, x: b.x + shift!.x, y: b.y + shift!.y });
  const label = (id: string) => diff.nodes.find((n) => n.id === id)?.label ?? diff.groups.find((g) => g.id === id)?.label ?? id;

  const out: string[] = [];
  const placedGhosts = new Map<string, Box>();
  const row: Ghost[] = [];
  let bounds: Box | undefined;
  const grow = (b: Box) => {
    const x0 = Math.min(bounds?.x ?? b.x, b.x);
    const y0 = Math.min(bounds?.y ?? b.y, b.y);
    bounds = { x: x0, y: y0, width: Math.max(bounds ? bounds.x + bounds.width : -Infinity, b.x + b.width) - x0, height: Math.max(bounds ? bounds.y + bounds.height : -Infinity, b.y + b.height) - y0 };
  };

  for (const g of diff.groups) {
    const was = before.placed.groups.get(g.id);
    if (g.status !== 'removed' || !was || !shift) continue;
    const b = moved(was);
    grow(b);
    out.push(
      `<g data-diff="removed" data-group="${esc(g.id)}"><rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.width)}" height="${r1(b.height)}" rx="${theme.radius.group}" fill="none" stroke="${colour(theme, 'removed')}" stroke-width="2"${dash('removed')}/>` +
        textAt(b.x + 14, b.y + 16, fitText(label(g.id), theme.size.group, 500, b.width - 28 - tagWidth('removed')), theme.size.group, 500, theme.textMuted, ' text-decoration="line-through"') +
        tag(theme, 'removed', b.x + b.width - 10 - tagWidth('removed'), b.y).svg +
        '</g>',
    );
  }
  for (const n of diff.nodes) {
    const was = before.placed.nodes.get(n.id);
    if (n.status !== 'removed' || !was) continue;
    const b = shift ? moved(was) : undefined;
    const free = b && ![...after.placed.nodes.values(), ...placedGhosts.values()].some((o) => hit(b, o, 6));
    if (b && free) {
      placedGhosts.set(n.id, b);
      grow({ x: b.x - 5, y: b.y - 5 - TAG / 2, width: b.width + 10, height: b.height + 10 + TAG / 2 });
      out.push(ghostCard(theme, n.id, label(n.id), b));
    } else row.push({ id: n.id, label: label(n.id), box: was });
  }
  // Lines that are gone: along their old route when both ends still stand where they stood.
  for (const e of diff.edges) {
    if (e.status !== 'removed' || !e.edge?.before || !shift) continue;
    const old = before.graph.edges.find((x) => x.id === e.edge!.before);
    const route = before.placed.edges.get(e.edge.before);
    if (!old || old.badge) continue;
    const end = (id: string): { box: Box; still: boolean } | undefined => {
      const ghost = placedGhosts.get(id);
      if (ghost) return { box: ghost, still: true };
      const [now, was] = [after.placed.nodes.get(id), before.placed.nodes.get(id)];
      if (!now || !was) return undefined;
      return { box: now, still: Math.abs(now.x - was.x - shift.x) < 2 && Math.abs(now.y - was.y - shift.y) < 2 };
    };
    const [a, b] = [end(old.from.node), end(old.to.node)];
    if (!a || !b) continue;
    const pts = a.still && b.still && route && route.points.length > 1 ? route.points.map((p) => ({ x: p.x + shift.x, y: p.y + shift.y })) : [leave(a.box, centre(b.box)), leave(b.box, centre(a.box))];
    out.unshift(edgeMark(theme, 'removed', pts, e.id, [...after.placed.nodes.values(), ...placedGhosts.values()], true));
  }
  return { svg: out.join(''), bounds, row, boxes: [...placedGhosts.values()] };
}

function ghostCard(theme: Theme, id: string, label: string, b: Box): string {
  const c = colour(theme, 'removed');
  const room = b.width - 24;
  return (
    `<g data-diff="removed" data-node="${esc(id)}"><rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.width)}" height="${r1(b.height)}" rx="${theme.radius.card}" fill="${theme.canvas}" fill-opacity="0.85" stroke="${c}" stroke-width="2"${dash('removed')}/>` +
    textAt(b.x + b.width / 2, b.y + b.height / 2, fitText(label, theme.size.label, 500, room), theme.size.label, 500, theme.textMuted, ' text-anchor="middle" text-decoration="line-through"') +
    tag(theme, 'removed', b.x + b.width - 5 - tagWidth('removed'), b.y - 5).svg +
    '</g>'
  );
}

/** The key: each mark as it is drawn, with how many there are. */
function key(theme: Theme, diff: GraphDiff, x: number, cy: number, against?: string): { svg: string; width: number } {
  const out: string[] = [];
  let at = x;
  if (diff.same) {
    const words = `No changes${against ? ` against ${against}` : ''}`;
    return { svg: `<g data-diff-key="">${textAt(x, cy, words, theme.size.caption, 500, theme.textMuted)}</g>`, width: measureText(words, theme.size.caption, 500) };
  }
  for (const s of ['added', 'changed', 'removed'] as const) {
    const t = tag(theme, s, at, cy);
    const count = String(diff.counts[s]);
    out.push(t.svg, textAt(at + t.width + 6, cy, count, theme.size.caption, 500, theme.textMuted));
    at += t.width + 6 + measureText(count, theme.size.caption, 500) + 20;
  }
  if (against) {
    const words = `against ${against}`;
    out.push(textAt(at, cy, words, theme.size.caption, 400, theme.textFaint));
    at += measureText(words, theme.size.caption, 400) + 20;
  }
  return { svg: `<g data-diff-key="">${out.join('')}</g>`, width: at - 20 - x };
}

const keyWidth = (theme: Theme, diff: GraphDiff, against?: string) => key(theme, diff, 0, 0, against).width;

/** A drawing's SVG without its root element, to place it inside another. */
function inner(svg: string): string {
  return svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>'));
}

function root(svg: string, width: number, height: number, theme: Theme, body: string): string {
  const open = svg.slice(0, svg.indexOf('>') + 1);
  const attrs = open.replace(/\s(width|height|viewBox)="[^"]*"/g, '').replace(/>$/, ` width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  return `${attrs}<rect width="${width}" height="${height}" fill="${theme.canvas}"/>${body}</svg>`;
}

/**
 * One picture of the change: the newer drawing with what was added and changed marked, what was
 * removed drawn as dotted ghosts where it used to be, and a key. A drawing that is gone altogether
 * is the older one with everything marked removed.
 */
export function drawDiff(before: Drawing | undefined, after: Drawing | undefined, diff: GraphDiff, opts: OverlayOptions = {}): Picture {
  const base = after ?? before;
  if (!base) throw new Error('Nothing to draw: neither drawing rendered');
  const { theme, origin } = base;
  const pad = theme.space.pad;
  const gone = before && after ? ghosts(before, after, diff) : { svg: '', bounds: undefined, row: [] as Ghost[], boxes: [] as Box[] };
  const over = marksSvg(base, marksFor(diff, after ? 'after' : 'before'), gone.boxes);

  // Ghosts may stand outside the newer drawing: the canvas grows to hold them.
  const gb = gone.bounds;
  const left = Math.max(0, gb ? pad - (origin.x + gb.x) : 0);
  const top = Math.max(0, gb ? pad - (origin.y + gb.y) : 0);
  const right = Math.max(base.width, gb ? origin.x + gb.x + gb.width + pad : 0);
  const bottom = Math.max(base.height, gb ? origin.y + gb.y + gb.height + pad : 0);

  // Removed cards whose place is taken: a row under the drawing.
  const rows: string[] = [];
  let rowHeight = 0;
  let rowWidth = 0;
  if (gone.row.length) {
    const wrap = Math.max(right + left - 2 * pad, 480);
    let [x, y, line] = [0, 26 + TAG / 2, 0];
    rows.push(textAt(0, 8, 'No longer in the drawing', theme.size.caption, 500, theme.textMuted));
    for (const g of gone.row) {
      if (x && x + g.box.width > wrap) [x, y, line] = [0, y + line + 20 + TAG / 2, 0];
      rows.push(ghostCard(theme, g.id, g.label, { ...g.box, x: x + 5, y }));
      x += g.box.width + 26;
      line = Math.max(line, g.box.height);
      rowWidth = Math.max(rowWidth, x);
    }
    rowHeight = y + line + 16;
  }

  const width = Math.ceil(Math.max(left + right, rowWidth + 2 * pad, keyWidth(theme, diff, opts.against) + 2 * pad));
  const height = Math.ceil(top + bottom + rowHeight + KEY);
  const body =
    `<g transform="translate(${r1(left)} ${r1(top)})">${inner(base.svg)}<g data-diff-overlay="" transform="translate(${origin.x} ${origin.y})">${gone.svg}${over}</g></g>` +
    (rows.length ? `<g transform="translate(${pad} ${r1(top + bottom)})">${rows.join('')}</g>` : '') +
    `<line x1="${pad}" x2="${width - pad}" y1="${r1(height - KEY)}" y2="${r1(height - KEY)}" stroke="${theme.border}"/>` +
    key(theme, diff, pad, height - KEY / 2, opts.against).svg;
  return { svg: root(base.svg, width, height, theme, body), width, height };
}

/**
 * Before and after as two drawings in one picture: the older one marks what was removed and changed,
 * the newer one what was added and changed, with one key under both.
 */
export function sideBySide(before: Drawing | undefined, after: Drawing | undefined, diff: GraphDiff, opts: OverlayOptions = {}): Picture {
  const base = after ?? before;
  if (!base) throw new Error('Nothing to draw: neither drawing rendered');
  const theme = base.theme;
  const pad = theme.space.pad;
  const HEAD = 34;
  const panel = (d: Drawing | undefined, side: 'before' | 'after') => ({
    width: d?.width ?? 320,
    height: d?.height ?? 120,
    name: opts.labels?.[side] ?? (side === 'before' ? 'Before' : 'After'),
    body: d
      ? `${inner(d.svg)}<g data-diff-overlay="${side}" transform="translate(${d.origin.x} ${d.origin.y})">${marksSvg(d, marksFor(diff, side))}</g>`
      : textAt(pad, 60, side === 'before' ? 'Not there before' : 'Removed', theme.size.label, 500, theme.textMuted),
  });
  const [a, b] = [panel(before, 'before'), panel(after, 'after')];
  // Wide drawings go under each other: next to each other they would be too small to read in a comment.
  const row = opts.arrange === 'row' || (opts.arrange !== 'column' && Math.max(a.width, b.width) <= 1.2 * Math.max(a.height, b.height));
  const [bx, by] = row ? [a.width, 0] : [0, a.height + HEAD];
  const width = Math.ceil(Math.max(row ? a.width + b.width : Math.max(a.width, b.width), keyWidth(theme, diff, opts.against) + 2 * pad));
  const height = Math.ceil((row ? Math.max(a.height, b.height) + HEAD : a.height + b.height + 2 * HEAD) + KEY);
  const head = (p: { name: string }, x: number, y: number) => textAt(x + pad, y + HEAD / 2 + 6, p.name, theme.size.subtitle, 600, theme.textMuted);
  const rule = row
    ? `<line x1="${a.width}" x2="${a.width}" y1="${pad / 2}" y2="${height - KEY}" stroke="${theme.border}"/>`
    : `<line x1="${pad}" x2="${width - pad}" y1="${a.height + HEAD}" y2="${a.height + HEAD}" stroke="${theme.border}"/>`;
  const body =
    head(a, 0, 0) +
    `<g data-diff-panel="before" transform="translate(0 ${HEAD})">${a.body}</g>` +
    rule +
    head(b, bx, by) +
    `<g data-diff-panel="after" transform="translate(${bx} ${by + HEAD})">${b.body}</g>` +
    `<line x1="${pad}" x2="${width - pad}" y1="${height - KEY}" y2="${height - KEY}" stroke="${theme.border}"/>` +
    key(theme, diff, pad, height - KEY / 2, opts.against).svg;
  return { svg: root(base.svg, width, height, theme, body), width, height };
}
