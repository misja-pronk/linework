// Architecture decisions on paper: a numbered page marker on each element, group and line a decision
// is about, and the decisions written out under the drawing with a key. Only drawn when asked
// (`carto render --decisions`, "Exports include decisions" in the editor).
//
// Three markers stand apart from the rest without colour: a review note is a speech bubble at the
// top-left corner, a threat a T-tag on the top edge, a decision a page with a folded corner on the
// bottom-right corner. Its status is in its outline: accepted filled, proposed dashed, superseded
// (and deprecated, rejected) struck through.
import { decisionsOnDrawing, decisionSummary, nodeLabel, statusSaid, type ConcernTarget, type Decision, type DecisionStatus, type Graph, type Placed, type Point } from '@cartography/core';
import { baselineOffset, measureText, type Theme } from '@cartography/theme';
import { esc, r1 } from './paint.ts';
import { wrapText } from './size.ts';

export interface DecisionSpot {
  decision: Decision;
  /** Where its marker's bottom-right corner sits, in layout coordinates (add the drawing's origin for SVG ones); a view's in SVG coordinates. */
  at: Point;
  target: ConcernTarget;
  /** What it is about here, as drawn ("Customer store", "Web → API", "this view"). */
  about: string;
}

/** Room one marker takes along an element's bottom edge. */
const STEP = 24;

/** How a status is drawn: filled, dashed, or struck through. */
export const decisionLook = (s: DecisionStatus): 'filled' | 'dashed' | 'struck' => (s === 'accepted' ? 'filled' : s === 'proposed' ? 'dashed' : 'struck');

/** The marker colour: violet, apart from the amber of notes, the rose of threats and the accent of steps. */
export const decisionInk = (theme: Theme) => theme.tones.violet.fg;

export interface DrawingAt {
  file?: string;
  view?: string;
  /** A model id → the id it is drawn under in this drawing (a workspace's mapping). */
  drawnAs?: (id: string) => string | undefined;
}

/** What a target is called in this drawing. */
export function targetName(t: ConcernTarget, graph: Graph): string {
  if (t.kind === 'view') return 'this view';
  const name = (id: string) => {
    const n = graph.nodes.find((x) => x.id === id);
    return n ? nodeLabel(n) : (graph.groups.find((g) => g.id === id)?.label ?? id);
  };
  if (t.kind === 'edge') {
    const e = graph.edges.find((x) => x.id === t.id);
    return e ? `${name(e.from.node)} → ${name(e.to.node)}` : t.id;
  }
  return name(t.id);
}

/**
 * The markers of a drawing: on the bottom-right corner of each element or group (more than one in a
 * row, right to left), beside the middle of a line, at the top-right of the drawing for a view.
 */
export function decisionSpots(decisions: Decision[], graph: Graph, placed: Placed, at: DrawingAt = {}, size?: { width: number }): DecisionSpot[] {
  const taken = new Map<string, number>();
  const out: DecisionSpot[] = [];
  for (const { decision, target } of decisionsOnDrawing(decisions, graph, at)) {
    let p: Point | undefined;
    const key = target.kind === 'view' ? 'view' : `${target.kind}:${target.id}`;
    const i = taken.get(key) ?? 0;
    taken.set(key, i + 1);
    if (target.kind === 'view') {
      if (size) p = { x: size.width - 16 - i * STEP, y: 30 };
    } else if (target.kind === 'edge') {
      const e = placed.edges.get(target.id);
      // Just after the line's label, on its baseline; a line without one: beside its middle.
      if (e?.label) p = { x: e.label.x + e.label.width + 4 + decisionMarkerWidth(decision.number) + i * STEP, y: e.label.y + e.label.height / 2 + H / 2 };
      else if (e?.points.length) {
        const m = midpoint(e.points);
        p = { x: m.x + 26 + i * STEP, y: m.y + H / 2 };
      }
    } else {
      const b = target.kind === 'node' ? placed.nodes.get(target.id) : placed.groups.get(target.id);
      if (b) p = { x: b.x + b.width - 8 - i * STEP, y: b.y + b.height + 7 };
    }
    if (p) out.push({ decision, at: p, target, about: targetName(target, graph) });
  }
  return out;
}

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

/** Width of the marker of a number. */
export const decisionMarkerWidth = (n: number | string) => Math.max(17, measureText(String(n), 10, 600) + 10);
const H = 19;
const FOLD = 5;

/**
 * A page with a folded top-right corner and the decision's number, its bottom-right corner at (x, y):
 * filled when accepted, dashed when proposed, struck through when superseded, deprecated or rejected.
 */
export function decisionMarker(theme: Theme, x: number, y: number, n: number | string, status: DecisionStatus, title?: string): string {
  const w = decisionMarkerWidth(n);
  const left = x - w;
  const top = y - H;
  const ink = decisionInk(theme);
  const look = decisionLook(status);
  const page = `M${r1(left)} ${r1(top)}H${r1(x - FOLD)}L${r1(x)} ${r1(top + FOLD)}V${r1(y)}H${r1(left)}Z`;
  const fold = `M${r1(x - FOLD)} ${r1(top)}V${r1(top + FOLD)}H${r1(x)}`;
  const fill = look === 'filled' ? ink : theme.surface;
  const line = look === 'struck' ? theme.textMuted : ink;
  const text = look === 'filled' ? theme.surface : line;
  const dash = look === 'dashed' ? ' stroke-dasharray="2.6 1.8"' : '';
  return (
    `<g data-decision="${n}" data-status="${status}">${title ? `<title>${esc(title)}</title>` : ''}` +
    // A halo in the surface colour, so the marker reads on a line or a card's edge.
    `<path d="${page}" fill="none" stroke="${theme.surface}" stroke-width="4" stroke-linejoin="round"/>` +
    `<path d="${page}" fill="${fill}" stroke="${line}" stroke-width="1.3" stroke-linejoin="round"${dash}/>` +
    `<path d="${fold}" fill="none" stroke="${look === 'filled' ? theme.surface : line}" stroke-width="1.1" stroke-linejoin="round"/>` +
    `<text x="${r1(left + (w - 2) / 2)}" y="${r1(top + H / 2 + 1 + baselineOffset(10))}" font-size="10" font-weight="600" fill="${text}" text-anchor="middle">${esc(String(n))}</text>` +
    (look === 'struck' ? `<path d="M${r1(left - 1.5)} ${r1(y - 3)}L${r1(x + 1.5)} ${r1(top + 3)}" stroke="${line}" stroke-width="1.1" stroke-linecap="round"/>` : '') +
    `</g>`
  );
}

const day = (s?: string) => (s ? s.slice(0, 10) : '');

/**
 * The drawing with decision markers and, under it, a key and the decisions it shows written out.
 * `count` says how many decisions are on it; with none the SVG comes back as it was.
 */
export function withDecisions(
  drawn: { svg: string; width: number; height: number; origin?: Point },
  graph: Graph,
  placed: Placed,
  decisions: Decision[],
  theme: Theme,
  /** `appendix: false`: the markers only (a live preview, where the decisions are listed elsewhere). */
  opts: DrawingAt & { appendix?: boolean } = {},
): { svg: string; width: number; height: number; count: number; spots: DecisionSpot[] } {
  const spots = decisionSpots(decisions, graph, placed, opts, drawn);
  if (!spots.length) return { ...drawn, count: 0, spots };
  const o = drawn.origin ?? { x: 0, y: 0 };
  const shift = (s: DecisionSpot) => (s.target.kind === 'view' ? s.at : { x: s.at.x + o.x, y: s.at.y + o.y });
  const marks = spots.map((s) => decisionMarker(theme, shift(s).x, shift(s).y, s.decision.number, s.decision.status, `${s.decision.number}. ${s.decision.title} (${statusSaid(s.decision)}) — about ${s.about}`)).join('');
  const shown = [...new Map(spots.map((s) => [s.decision.number, s.decision])).values()].sort((a, b) => a.number - b.number);
  if (opts.appendix === false) return { svg: drawn.svg.replace(/<\/svg>\s*$/, `<g data-decisions="">${marks}</g></svg>`), width: drawn.width, height: drawn.height, count: shown.length, spots };

  const pad = 32;
  const width = Math.max(drawn.width, 460);
  const textWidth = width - 2 * pad - 32;
  const rows: string[] = [];
  let y = drawn.height + 8;
  const text = (s: string, x: number, size: number, weight: 400 | 500 | 600, fill: string) => `<text x="${r1(x)}" y="${r1(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(s)}</text>`;
  rows.push(`<line x1="${pad}" x2="${r1(width - pad)}" y1="${r1(y)}" y2="${r1(y)}" stroke="${theme.border}" stroke-width="1"/>`);
  y += 30;
  rows.push(text('Decisions', pad, 14, 600, theme.text));
  // The key: what each marker says, in shape and outline.
  let kx = pad + measureText('Decisions', 14, 600) + 28;
  for (const [status, label] of [
    ['accepted', 'Accepted'],
    ['proposed', 'Proposed'],
    ['superseded', 'Superseded, deprecated or rejected'],
  ] as const) {
    // A blank page: the key is about the outline, not a number.
    rows.push(decisionMarker(theme, kx + 17, y + 5, '', status));
    rows.push(text(label, kx + 24, 11, 500, theme.textMuted));
    kx += 24 + measureText(label, 11, 500) + 22;
  }
  y += 10;
  const about = new Map<number, string[]>();
  for (const s of spots) about.set(s.decision.number, [...(about.get(s.decision.number) ?? []), s.about]);
  for (const d of shown) {
    y += 22;
    rows.push(decisionMarker(theme, pad + 18, y + 5, d.number, d.status));
    rows.push(text(`${d.number}. ${d.title}`, pad + 32, 12, 600, theme.text));
    y += 15;
    rows.push(text([statusSaid(d), day(d.date), `about ${about.get(d.number)!.join(', ')}`].filter(Boolean).join(' · '), pad + 32, 10.5, 400, theme.textFaint));
    const summary = decisionSummary(d, 280);
    if (summary)
      for (const line of wrapText(summary, 11.5, 400, textWidth, 3)) {
        y += 16;
        rows.push(text(line, pad + 32, 11.5, 400, theme.textMuted));
      }
    y += 4;
  }
  const height = Math.ceil(y + pad);
  const svg = drawn.svg
    .replace(/<svg\b([^>]*)>/, (_, attrs: string) => `<svg${attrs.replace(/\swidth="[^"]*"/, ` width="${width}"`).replace(/\sheight="[^"]*"/, ` height="${height}"`).replace(/\sviewBox="[^"]*"/, ` viewBox="0 0 ${width} ${height}"`)}>`)
    .replace(
      /<\/svg>\s*$/,
      `<g data-decisions=""><rect x="0" y="${drawn.height}" width="${width}" height="${height - drawn.height}" fill="${theme.canvas}"/>${drawn.width < width ? `<rect x="${drawn.width}" y="0" width="${width - drawn.width}" height="${drawn.height}" fill="${theme.canvas}"/>` : ''}${marks}${rows.join('')}</g></svg>`,
    );
  return { svg, width, height, count: shown.length, spots };
}

/** The decisions a drawing shows, as plain lines ("3. Title (Accepted) — about Orders"): PowerPoint's speaker notes. */
export function decisionLines(spots: DecisionSpot[]): string[] {
  const by = new Map<number, { d: Decision; about: string[] }>();
  for (const s of spots) {
    const e = by.get(s.decision.number) ?? { d: s.decision, about: [] };
    e.about.push(s.about);
    by.set(s.decision.number, e);
  }
  return [...by.values()].sort((a, b) => a.d.number - b.d.number).map(({ d, about }) => `Decision ${d.number}. ${d.title} (${statusSaid(d)}) — about ${about.join(', ')}${decisionSummary(d) ? `: ${decisionSummary(d)}` : ''}`);
}
