// Architecture review findings on paper (packages/review): a marker on each element, group and line
// a finding is about, and, under the drawing, the findings written out with a key. Only drawn when
// asked (`carto review -o`, the editor's Review tab).
//
// Four markers stand apart without colour: a review note is a speech bubble at the top-left corner,
// a threat a T-tag on the top edge, a decision a folded page at the bottom-right corner, and a review
// finding a flag at the bottom-left corner that starts with its severity's shape: an octagon for an
// error, a triangle for a warning, a circle for information. An error's flag is filled.
import { nodeLabel, type Graph, type Placed, type Point } from '@cartography/core';
import { baselineOffset, measureText, type Theme } from '@cartography/theme';
import { esc, r1 } from './paint.ts';
import { wrapText } from './size.ts';
import type { Lang } from '@cartography/i18n';
import { tr, type DrawingMessage } from '@cartography/i18n/drawing';

export type FindingSeverity = 'error' | 'warn' | 'info';

/** What a marker needs of a finding (packages/review's Finding has all of it). */
export interface ReviewMark {
  /** R1, R2…; findings set aside have none and are not drawn. */
  id: string;
  severity: FindingSeverity;
  on: { kind: 'node' | 'group' | 'edge'; id: string } | { kind: 'diagram' };
  message: string;
  about?: string;
  rule?: { id: string; title: string; category?: string; fix?: string };
  /** The edge's ends, for a line drawn as a badge (no line to put the marker on). */
  ends?: { from: string; to: string };
}

export interface ReviewSpot {
  /** The findings on one target, worst first. */
  marks: ReviewMark[];
  /** The marker's left end, on its middle line, in layout coordinates (add the drawing's origin for SVG); a diagram's in SVG coordinates. */
  at: Point;
  diagram: boolean;
}

const RANK: Record<FindingSeverity, number> = { error: 3, warn: 2, info: 1 };
const H = 17;
const GLYPH = 10;
const SIZE = 9.5;

/** The marker colour: orange, apart from the amber of notes, the rose of threats and the violet of decisions; the shape says the rest. */
export const reviewInk = (theme: Theme) => theme.tones.orange.fg;

/** The ids a marker shows: two, then "+3". */
const shown = (marks: ReviewMark[]) => (marks.length <= 2 ? marks.map((m) => m.id) : [marks[0]!.id, `+${marks.length - 1}`]);
const label = (marks: ReviewMark[]) => shown(marks).join(' ');

export const reviewMarkerWidth = (text: string) => 4 + GLYPH + 4 + (text ? measureText(text, SIZE, 600) + 6 : 0);

/** The severity's shape, centred on (cx, cy): an octagon, a triangle or a circle, with ! or i inside. */
export function severityGlyph(severity: FindingSeverity, cx: number, cy: number, fill: string, ink: string): string {
  const r = GLYPH / 2;
  let shape: string;
  if (severity === 'error') {
    const k = r * 0.414;
    shape = `<path d="M${r1(cx - k)} ${r1(cy - r)}H${r1(cx + k)}L${r1(cx + r)} ${r1(cy - k)}V${r1(cy + k)}L${r1(cx + k)} ${r1(cy + r)}H${r1(cx - k)}L${r1(cx - r)} ${r1(cy + k)}V${r1(cy - k)}Z" fill="${fill}"/>`;
  } else if (severity === 'warn') shape = `<path d="M${r1(cx)} ${r1(cy - r - 0.6)}L${r1(cx + r + 0.8)} ${r1(cy + r)}H${r1(cx - r - 0.8)}Z" fill="${fill}" stroke-linejoin="round"/>`;
  else shape = `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="${fill}"/>`;
  const mark = severity === 'info' ? 'i' : '!';
  return `${shape}<text x="${r1(cx)}" y="${r1(cy + (severity === 'warn' ? 1.4 : 0) + baselineOffset(7.5))}" font-size="7.5" font-weight="600" fill="${ink}" text-anchor="middle">${mark}</text>`;
}

/** A flag with the severity's shape and the finding numbers, its left end at (x, cy). */
export function reviewMarker(theme: Theme, x: number, cy: number, marks: ReviewMark[], title?: string): string {
  const worst = [...marks].sort((a, b) => RANK[b.severity] - RANK[a.severity])[0]!;
  const text = label(marks);
  const w = reviewMarkerWidth(text);
  const ink = reviewInk(theme);
  const filled = worst.severity === 'error';
  const top = cy - H / 2;
  // A flag: square at its pole, a notch at its tail.
  const d = `M${r1(x)} ${r1(top)}H${r1(x + w)}L${r1(x + w - 4)} ${r1(cy)}L${r1(x + w)} ${r1(top + H)}H${r1(x)}Z`;
  return (
    `<g data-review="${esc(marks.map((m) => m.id).join(' '))}" data-severity="${worst.severity}">${title ? `<title>${esc(title)}</title>` : ''}` +
    `<path d="${d}" fill="none" stroke="${theme.surface}" stroke-width="4" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="${filled ? ink : theme.surface}" stroke="${ink}" stroke-width="1.3" stroke-linejoin="round"/>` +
    severityGlyph(worst.severity, x + 4 + GLYPH / 2, cy, filled ? theme.surface : ink, filled ? ink : theme.surface) +
    (text ? `<text x="${r1(x + 4 + GLYPH + 4)}" y="${r1(cy + baselineOffset(SIZE))}" font-size="${SIZE}" font-weight="600" fill="${filled ? theme.surface : ink}">${esc(text)}</text>` : '') +
    `</g>`
  );
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

/**
 * Where the markers go: the bottom-left corner of an element or group, just before a line's label
 * (or beside its middle), and the top-right of the drawing for the diagram as a whole. A line drawn
 * as a badge is marked on the element it starts at. Findings set aside are not drawn.
 */
export function reviewSpots(marks: ReviewMark[], placed: Placed, size?: { width: number }): ReviewSpot[] {
  const by = new Map<string, ReviewMark[]>();
  for (const m of marks) {
    if (!m.id) continue;
    let key = m.on.kind === 'diagram' ? 'diagram' : `${m.on.kind}:${m.on.id}`;
    if (m.on.kind === 'edge' && !placed.edges.get(m.on.id)?.points.length && m.ends) key = placed.nodes.has(m.ends.from) ? `node:${m.ends.from}` : `group:${m.ends.from}`;
    by.set(key, [...(by.get(key) ?? []), m]);
  }
  const out: ReviewSpot[] = [];
  for (const [key, list] of by) {
    const sorted = [...list].sort((a, b) => RANK[b.severity] - RANK[a.severity] || Number(a.id.slice(1)) - Number(b.id.slice(1)));
    const [kind, ...rest] = key.split(':');
    const id = rest.join(':');
    let at: Point | undefined;
    if (kind === 'diagram') at = size ? { x: size.width - 16 - reviewMarkerWidth(label(sorted)), y: 56 } : undefined;
    else if (kind === 'edge') {
      const e = placed.edges.get(id);
      // Over the start of the line's label: beside it, it would run into the card the line leaves.
      if (e?.label) at = { x: e.label.x, y: e.label.y - H / 2 - 3 };
      else if (e?.points.length) {
        const p = midpoint(e.points);
        at = { x: p.x - 10 - reviewMarkerWidth(label(sorted)), y: p.y };
      }
    } else {
      const b = kind === 'node' ? placed.nodes.get(id) : placed.groups.get(id);
      if (b) at = { x: b.x + 8, y: b.y + b.height };
    }
    if (at) out.push({ marks: sorted, at, diagram: kind === 'diagram' });
  }
  return out;
}

const SAID = { error: 'Error', warn: 'Warning', info: 'Info' } as const satisfies Record<FindingSeverity, DrawingMessage>;
const said = (s: FindingSeverity, lang?: Lang) => tr(lang, SAID[s]);
const PILLAR: Record<string, DrawingMessage> = { security: 'Security', reliability: 'Reliability', operations: 'Operational excellence', performance: 'Performance efficiency', cost: 'Cost optimisation' };

/** A finding's one-line tooltip: "R3 Warning: Orders has no private endpoint (Data stores … private endpoint)". */
export const reviewTitle = (m: ReviewMark, lang?: Lang) => `${m.id} ${said(m.severity, lang)}: ${m.message}${m.rule ? ` (${m.rule.title})` : ''}`;

/**
 * The drawing with review markers and, under it, a key and the findings written out (what a review
 * report's picture is). `count` says how many findings were drawn; with none the SVG comes back as it was.
 */
export function withReview(
  drawn: { svg: string; width: number; height: number; origin?: Point },
  graph: Graph,
  placed: Placed,
  marks: ReviewMark[],
  theme: Theme,
  /** `appendix: false`: the markers only (a picture in a report that lists the findings itself). */
  opts: { appendix?: boolean } = {},
): { svg: string; width: number; height: number; count: number; spots: ReviewSpot[] } {
  const spots = reviewSpots(marks, placed, drawn);
  const live = marks.filter((m) => m.id);
  if (!live.length) return { ...drawn, count: 0, spots };
  const o = drawn.origin ?? { x: 0, y: 0 };
  const shift = (s: ReviewSpot) => (s.diagram ? s.at : { x: s.at.x + o.x, y: s.at.y + o.y });
  const lang = theme.lang;
  const drawnMarks = spots.map((s) => reviewMarker(theme, shift(s).x, shift(s).y, s.marks, s.marks.map((m) => reviewTitle(m, lang)).join('\n'))).join('');
  if (opts.appendix === false) return { svg: drawn.svg.replace(/<\/svg>\s*$/, `<g data-review-marks="">${drawnMarks}</g></svg>`), width: drawn.width, height: drawn.height, count: live.length, spots };

  const pad = 32;
  const width = Math.max(drawn.width, 520);
  const textWidth = width - 2 * pad - 60;
  const rows: string[] = [];
  let y = drawn.height + 8;
  const text = (s: string, x: number, size: number, weight: 400 | 500 | 600, fill: string) => `<text x="${r1(x)}" y="${r1(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(s)}</text>`;
  rows.push(`<line x1="${pad}" x2="${r1(width - pad)}" y1="${r1(y)}" y2="${r1(y)}" stroke="${theme.border}" stroke-width="1"/>`);
  y += 30;
  rows.push(text(tr(lang, 'Review'), pad, 14, 600, theme.text));
  let kx = pad + measureText(tr(lang, 'Review'), 14, 600) + 28;
  for (const s of ['error', 'warn', 'info'] as const) {
    if (!live.some((m) => m.severity === s)) continue;
    rows.push(reviewMarker(theme, kx, y - 4, [{ id: '', severity: s, on: { kind: 'diagram' }, message: '' }]));
    rows.push(text(said(s, lang), kx + reviewMarkerWidth('') + 6, 11, 500, theme.textMuted));
    kx += reviewMarkerWidth('') + 6 + measureText(said(s, lang), 11, 500) + 20;
  }
  y += 8;
  const name = (id: string) => {
    const n = graph.nodes.find((x) => x.id === id);
    return n ? nodeLabel(n) : (graph.groups.find((g) => g.id === id)?.label ?? id);
  };
  for (const m of live) {
    y += 24;
    rows.push(reviewMarker(theme, pad, y - 4, [m]));
    const x = pad + reviewMarkerWidth(m.id) + 10;
    rows.push(text(m.rule?.title ?? m.message, x, 12, 600, theme.text));
    y += 15;
    const about = m.about ?? (m.on.kind === 'diagram' ? tr(lang, 'the diagram') : m.on.kind === 'edge' ? (m.ends ? `${name(m.ends.from)} → ${name(m.ends.to)}` : m.on.id) : name(m.on.id));
    rows.push(text([said(m.severity, lang), m.rule?.category && (PILLAR[m.rule.category] ? tr(lang, PILLAR[m.rule.category]!) : m.rule.category), tr(lang, 'about {about}', { about }), m.rule?.id].filter(Boolean).join(' · '), x, 10.5, 400, theme.textFaint));
    for (const line of wrapText(m.message, 11.5, 400, textWidth, 2)) {
      y += 16;
      rows.push(text(line, x, 11.5, 400, theme.textMuted));
    }
    if (m.rule?.fix)
      for (const [i, line] of wrapText(tr(lang, 'Fix: {fix}', { fix: m.rule.fix }), 11, 400, textWidth, 3).entries()) {
        y += i ? 14 : 16;
        rows.push(text(line, x, 11, 400, theme.textFaint));
      }
  }
  const height = Math.ceil(y + pad);
  const svg = drawn.svg
    .replace(/<svg\b([^>]*)>/, (_, attrs: string) => `<svg${attrs.replace(/\swidth="[^"]*"/, ` width="${width}"`).replace(/\sheight="[^"]*"/, ` height="${height}"`).replace(/\sviewBox="[^"]*"/, ` viewBox="0 0 ${width} ${height}"`)}>`)
    .replace(
      /<\/svg>\s*$/,
      `<g data-review-marks=""><rect x="0" y="${drawn.height}" width="${width}" height="${height - drawn.height}" fill="${theme.canvas}"/>${drawn.width < width ? `<rect x="${drawn.width}" y="0" width="${width - drawn.width}" height="${drawn.height}" fill="${theme.canvas}"/>` : ''}${drawnMarks}${rows.join('')}</g></svg>`,
    );
  return { svg, width, height, count: live.length, spots };
}
