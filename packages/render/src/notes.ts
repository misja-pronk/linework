// Review notes on paper: a numbered marker where each thread hangs, and the threads as an appendix
// under the drawing. Only drawn when an export asks for it (`carto render --notes`, "with review
// notes" in the editor); the drawing itself never carries notes.
import { anchorLabel, noteNumbers, notePlain, notesInView, resolveAnchor, type Graph, type NoteThread, type NotesFile, type Placed, type Point } from '@cartography/core';
import { baselineOffset, measureText, type Theme } from '@cartography/theme';
import { esc, r1 } from './paint.ts';
import { wrapText } from './size.ts';

/** Where a thread's marker points, in layout coordinates (add the drawing's origin for SVG ones). */
export interface NoteSpot {
  thread: NoteThread;
  n: number;
  at: Point;
  /** What it is about, as drawn ("Orders", "Web → Orders"). */
  about: string;
}

/** Room one marker takes along an element's top edge. */
const STEP = 22;

/**
 * The spots of the threads a drawing shows: on the top-left corner of an element or group (more
 * than one in a row), the middle of a line, or the point written. Orphaned threads have no spot.
 */
export function noteSpots(notes: NotesFile, graph: Graph, placed: Placed, view: string | undefined, opts: { resolved?: boolean } = {}): NoteSpot[] {
  const numbers = noteNumbers(notes);
  const shift = placed.shift ?? { x: 0, y: 0 };
  const taken = new Map<string, number>();
  const out: NoteSpot[] = [];
  const list = notesInView(notes, view)
    .filter((t) => opts.resolved || t.status === 'open')
    .sort((a, b) => numbers.get(a.id)! - numbers.get(b.id)!);
  for (const t of list) {
    const r = resolveAnchor(t.anchor, graph);
    if (r.state === 'orphaned') continue;
    let at: Point | undefined;
    if (r.state === 'point') at = { x: r.at.x - shift.x, y: r.at.y - shift.y };
    else if (r.kind === 'edge') {
      const e = placed.edges.get(r.id);
      if (e?.points.length) at = midpoint(e.points);
    } else {
      const b = r.kind === 'node' ? placed.nodes.get(r.id) : placed.groups.get(r.id);
      if (b) {
        const i = taken.get(r.id) ?? 0;
        taken.set(r.id, i + 1);
        at = { x: b.x + 6 + i * STEP, y: b.y };
      }
    }
    if (at) out.push({ thread: t, n: numbers.get(t.id)!, at, about: anchorLabel(r.state === 'attached' ? r.anchor : t.anchor, graph) });
  }
  return out;
}

/** Halfway along a polyline, by length. */
function midpoint(pts: Point[]): Point {
  const len = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += len(pts[i - 1]!, pts[i]!);
  let left = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const d = len(pts[i - 1]!, pts[i]!);
    if (d >= left && d > 0) {
      const f = left / d;
      return { x: pts[i - 1]!.x + (pts[i]!.x - pts[i - 1]!.x) * f, y: pts[i - 1]!.y + (pts[i]!.y - pts[i - 1]!.y) * f };
    }
    left -= d;
  }
  return pts[0]!;
}

/** The marker colour: amber, apart from the accent that step numbers use. */
export const noteInk = (theme: Theme) => theme.tones.amber.fg;

/**
 * A speech bubble with the thread's number whose tail points at (x, y): told from a step number by
 * its shape and its number, not by colour. A resolved thread's bubble is an outline.
 */
export function noteMarker(theme: Theme, x: number, y: number, n: number, resolved = false): string {
  const label = String(n);
  const w = Math.max(18, measureText(label, 10.5, 600) + 10);
  const h = 16;
  const left = x - 3;
  const top = y - h - 5;
  const ink = noteInk(theme);
  const fill = resolved ? theme.surface : ink;
  const d = `M${r1(left + 3)} ${r1(top)}h${r1(w - 6)}a3 3 0 0 1 3 3v${h - 6}a3 3 0 0 1-3 3H${r1(left + 9)}L${r1(x)} ${r1(y)}L${r1(left + 4)} ${r1(top + h)}H${r1(left + 3)}a3 3 0 0 1-3-3v${-(h - 6)}a3 3 0 0 1 3-3z`;
  return (
    `<g data-note="${n}"><path d="${d}" fill="${fill}" stroke="${resolved ? ink : theme.surface}" stroke-width="${resolved ? 1.2 : 1.5}" stroke-linejoin="round"/>` +
    `<text x="${r1(left + w / 2)}" y="${r1(top + h / 2 + baselineOffset(10.5))}" font-size="10.5" font-weight="600" fill="${resolved ? ink : theme.surface}" text-anchor="middle">${esc(label)}</text></g>`
  );
}

const day = (iso: string) => iso.slice(0, 10);

/**
 * The drawing with numbered markers and, under it, the threads written out: what an export "with
 * review notes" is. `count` says how many threads were drawn; with none the SVG comes back as it was.
 */
export function withReviewNotes(
  drawn: { svg: string; width: number; height: number; origin?: Point },
  graph: Graph,
  placed: Placed,
  notes: NotesFile,
  theme: Theme,
  opts: { view?: string; resolved?: boolean } = {},
): { svg: string; width: number; height: number; count: number } {
  const spots = noteSpots(notes, graph, placed, opts.view, opts);
  const numbers = noteNumbers(notes);
  // Orphaned threads have no marker, but are still listed.
  const listed = notesInView(notes, opts.view)
    .filter((t) => opts.resolved || t.status === 'open')
    .sort((a, b) => numbers.get(a.id)! - numbers.get(b.id)!);
  if (!listed.length) return { ...drawn, count: 0 };
  const o = drawn.origin ?? { x: 0, y: 0 };
  const marks = spots.map((s) => noteMarker(theme, s.at.x + o.x, s.at.y + o.y, s.n, s.thread.status === 'resolved')).join('');
  // The appendix: under the drawing, as wide as it (at least a readable column).
  const pad = 32;
  const width = Math.max(drawn.width, 420);
  const textWidth = width - 2 * pad - 30;
  const rows: string[] = [];
  let y = drawn.height + 8;
  rows.push(`<line x1="${pad}" x2="${r1(width - pad)}" y1="${r1(y)}" y2="${r1(y)}" stroke="${theme.border}" stroke-width="1"/>`);
  y += 30;
  rows.push(`<text x="${pad}" y="${r1(y)}" font-size="14" font-weight="600" fill="${theme.text}">Review notes</text>`);
  y += 14;
  const text = (s: string, x: number, size: number, weight: 400 | 500 | 600, fill: string) => `<text x="${r1(x)}" y="${r1(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(s)}</text>`;
  const spotOf = new Map(spots.map((s) => [s.thread.id, s]));
  for (const t of listed) {
    y += 18;
    const n = numbers.get(t.id)!;
    const r = resolveAnchor(t.anchor, graph);
    const about = spotOf.get(t.id)?.about ?? (r.state === 'orphaned' ? `${r.was} (no longer in the diagram)` : anchorLabel(t.anchor, graph));
    rows.push(noteMarker(theme, pad + 3, y + 4, n, t.status === 'resolved'));
    rows.push(text(`${about}${t.status === 'resolved' ? ' (resolved)' : ''}`, pad + 30, 12, 600, theme.text));
    y += 15;
    rows.push(text(`${t.author || 'someone'} · ${day(t.created)}`, pad + 30, 10.5, 400, theme.textFaint));
    const say = (body: string, indent: number) => {
      for (const para of notePlain(body))
        for (const line of wrapText(para, 11.5, 400, textWidth - indent, 12)) {
          y += 16;
          rows.push(text(line, pad + 30 + indent, 11.5, 400, theme.textMuted));
        }
    };
    say(t.text, 0);
    for (const reply of t.replies ?? []) {
      y += 18;
      rows.push(text(`${reply.author || 'someone'} · ${day(reply.created)}`, pad + 44, 10.5, 400, theme.textFaint));
      say(reply.text, 14);
    }
    y += 6;
  }
  const height = Math.ceil(y + pad);
  // The root grows; the canvas behind the appendix is the drawing's own.
  const svg = drawn.svg
    .replace(/<svg\b([^>]*)>/, (_, attrs: string) => `<svg${attrs.replace(/\swidth="[^"]*"/, ` width="${width}"`).replace(/\sheight="[^"]*"/, ` height="${height}"`).replace(/\sviewBox="[^"]*"/, ` viewBox="0 0 ${width} ${height}"`)}>`)
    .replace(/<\/svg>\s*$/, `<g data-notes=""><rect x="0" y="${drawn.height}" width="${width}" height="${height - drawn.height}" fill="${theme.canvas}"/>${drawn.width < width ? `<rect x="${drawn.width}" y="0" width="${width - drawn.width}" height="${drawn.height}" fill="${theme.canvas}"/>` : ''}${marks}${rows.join('')}</g></svg>`);
  return { svg, width, height, count: listed.length };
}
