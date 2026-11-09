// Draws a placed graph as a standalone SVG. Attributes only (no CSS classes), so browsers,
// resvg and slide tools all render it the same.
import type { Box, CardShape, Graph, GraphEdge, GraphGroup, Marker, Placed, Point, TableShape } from '@cartography/core';
import { baselineOffset, embeddedFonts, fitText, measureText, type Theme } from '@cartography/theme';
import { icon } from '@cartography/icons';
import { cardCaption, groupLabelWidth, MARK_WIDTH, tableHeader } from './size.ts';
import { drawMatrix } from './matrix.ts';

export interface SvgOptions {
  /** Embed the Inter font (latin subset) so the SVG looks the same everywhere. */
  fonts?: 'embed' | 'none';
  /** Prefix for ids inside the SVG, so several diagrams can sit on one page. */
  idPrefix?: string;
  /** Add data-* attributes that the editor uses to find elements. */
  interactive?: boolean;
}

export interface SvgResult {
  svg: string;
  width: number;
  height: number;
  /** Where the diagram's layout origin sits in the SVG (title and padding come before it). */
  origin: Point;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n: number) => Math.round(n * 10) / 10;

export function drawSvg(graph: Graph, placed: Placed, theme: Theme, opts: SvgOptions = {}): SvgResult {
  const pad = theme.space.pad;
  const id = opts.idPrefix ?? 'carto';
  const header = graph.title ? (graph.subtitle ? 64 : 44) : 0;
  const legend = graph.legend?.length ? 40 : 0;
  const width = Math.ceil(Math.max(placed.width, titleWidth(graph, theme), legendWidth(graph, theme)) + 2 * pad);
  const height = Math.ceil(placed.height + header + legend + 2 * pad);
  const origin = { x: pad, y: pad + header };
  const data = (kind: string, key: string) => (opts.interactive ? ` data-${kind}="${esc(key)}"` : '');

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${esc(theme.font.family)}" text-rendering="geometricPrecision">`,
  );
  out.push('<defs>');
  if (opts.fonts !== 'none') out.push(`<style>${fontFaces()}</style>`);
  out.push(
    `<filter id="${id}-shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="${theme.shadow.color}" flood-opacity="${theme.shadow.opacity * 1.2}"/><feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="${theme.shadow.color}" flood-opacity="${theme.shadow.opacity}"/></filter>`,
  );
  out.push('</defs>');
  out.push(`<rect width="${width}" height="${height}" fill="${theme.canvas}"/>`);

  if (graph.title) {
    out.push(text(pad, pad + 16, graph.title, theme.size.title, 600, theme.text));
    if (graph.subtitle) out.push(text(pad, pad + 40, graph.subtitle, theme.size.subtitle, 400, theme.textMuted));
  }

  out.push(`<g transform="translate(${origin.x} ${origin.y})">`);
  for (const g of byDepth(graph.groups)) {
    const box = placed.groups.get(g.id);
    if (box) out.push(`<g${data('group', g.id)}>${drawGroup(g, box, theme)}</g>`);
  }
  for (const e of graph.edges) {
    const pe = placed.edges.get(e.id);
    if (pe && pe.points.length > 1) out.push(`<g${data('edge', e.id)}>${drawEdge(e, pe.points, theme)}</g>`);
  }
  for (const n of graph.nodes) {
    const box = placed.nodes.get(n.id);
    if (!box) continue;
    const shape = n.shape;
    const body =
      shape.kind === 'card' ? drawCard(shape, box, theme, id)
      : shape.kind === 'table' ? drawTable(shape, box, theme, id)
      : drawMatrix(shape, box, theme, `${id}-shadow`);
    out.push(`<g${data('node', n.id)}>${body}</g>`);
  }
  // Labels last, so lines never cross them.
  for (const e of graph.edges) {
    const label = placed.edges.get(e.id)?.label;
    if (e.label && label) out.push(drawEdgeLabel(e.label, label, theme));
  }
  out.push('</g>');

  if (legend) out.push(drawLegend(graph, theme, pad, height - pad - 14));
  out.push('</svg>');
  return { svg: out.join(''), width, height, origin };
}

function fontFaces(): string {
  return Object.entries(embeddedFonts)
    .map(([w, b64]) => `@font-face{font-family:Inter;font-style:normal;font-weight:${w};src:url(data:font/woff2;base64,${b64}) format('woff2')}`)
    .join('');
}

function text(x: number, y: number, s: string, size: number, weight: number, fill: string, anchor?: 'end' | 'middle'): string {
  const a = anchor ? ` text-anchor="${anchor}"` : '';
  return `<text x="${r1(x)}" y="${r1(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}"${a}>${esc(s)}</text>`;
}

/** Text vertically centred on cy. */
function textMid(x: number, cy: number, s: string, size: number, weight: number, fill: string, anchor?: 'end' | 'middle') {
  return text(x, cy + baselineOffset(size), s, size, weight, fill, anchor);
}

function drawIcon(name: string | undefined, x: number, y: number, size: number, color: string, stroke: number): string {
  const markup = name ? icon(name) : undefined;
  if (!markup) return '';
  const s = size / 24;
  // Keep the visual stroke width constant whatever the icon size.
  return `<g transform="translate(${r1(x)} ${r1(y)}) scale(${s})" fill="none" stroke="${color}" stroke-width="${r1(stroke / s)}" stroke-linecap="round" stroke-linejoin="round">${markup}</g>`;
}

function byDepth(groups: GraphGroup[]): GraphGroup[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const depth = (g: GraphGroup): number => (g.parent && byId.get(g.parent) ? 1 + depth(byId.get(g.parent)!) : 0);
  return [...groups].sort((a, b) => depth(a) - depth(b));
}

function drawGroup(g: GraphGroup, b: Box, theme: Theme): string {
  const tone = theme.tones[g.tone];
  const dash = g.border === 'dashed' ? ' stroke-dasharray="5 4"' : '';
  const cy = b.y + 22;
  const x = b.x + 16;
  const labelW = measureText(g.label, theme.size.group, 600);
  const maxLabel = b.width - 56;
  const label = fitText(g.label, theme.size.group, 600, maxLabel);
  let s = `<rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.width)}" height="${r1(b.height)}" rx="${theme.radius.group}" fill="${tone.wash}" stroke="${tone.line}" stroke-width="${theme.stroke.group}"${dash}/>`;
  s += drawIcon(g.icon, x, cy - 8, 16, tone.fg, 1.75);
  s += textMid(x + 24, cy, label, theme.size.group, 600, theme.text);
  if (g.caption && groupLabelWidth(g.label, g.caption, theme) + 32 <= b.width)
    s += textMid(x + 24 + labelW + 8, cy, g.caption, theme.size.caption, 400, theme.textFaint);
  return s;
}

function drawCard(shape: CardShape, b: Box, theme: Theme, id: string): string {
  const c = theme.space.card;
  const tone = theme.tones[shape.tone];
  const tileY = b.y + (b.height - c.tile) / 2;
  const tx = b.x + c.padX + c.tile + c.gap;
  const room = b.width - (tx - b.x) - c.padX;
  const caption = cardCaption(shape);
  const cy = b.y + b.height / 2;
  let s = `<rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.width)}" height="${r1(b.height)}" rx="${theme.radius.card}" fill="${theme.surface}" stroke="${theme.border}" stroke-width="${theme.stroke.card}" filter="url(#${id}-shadow)"/>`;
  s += `<rect x="${r1(b.x + c.padX)}" y="${r1(tileY)}" width="${c.tile}" height="${c.tile}" rx="${theme.radius.tile}" fill="${tone.bg}"/>`;
  s += drawIcon(shape.icon, b.x + c.padX + (c.tile - 18) / 2, tileY + (c.tile - 18) / 2, 18, tone.fg, theme.stroke.icon);
  const label = fitText(shape.label, theme.size.label, 600, room);
  if (caption) {
    s += textMid(tx, cy - 8, label, theme.size.label, 600, theme.text);
    s += textMid(tx, cy + 9.5, fitText(caption, theme.size.caption, 400, room), theme.size.caption, 400, theme.textMuted);
  } else s += textMid(tx, cy, label, theme.size.label, 600, theme.text);
  return s;
}

function drawTable(shape: TableShape, b: Box, theme: Theme, id: string): string {
  const t = theme.space.table;
  const tone = theme.tones[shape.tone];
  const head = tableHeader(shape, theme);
  const rad = theme.radius.card;
  let s = `<rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.width)}" height="${r1(b.height)}" rx="${rad}" fill="${theme.surface}" stroke="${theme.border}" stroke-width="${theme.stroke.card}" filter="url(#${id}-shadow)"/>`;
  // Header with only the top corners rounded, inset by the border.
  const x0 = b.x + 0.5;
  const x1 = b.x + b.width - 0.5;
  const y0 = b.y + 0.5;
  const yh = b.y + head;
  const r = rad - 0.5;
  s += `<path d="M${r1(x0)} ${r1(yh)}V${r1(y0 + r)}A${r} ${r} 0 0 1 ${r1(x0 + r)} ${r1(y0)}H${r1(x1 - r)}A${r} ${r} 0 0 1 ${r1(x1)} ${r1(y0 + r)}V${r1(yh)}Z" fill="${tone.bg}"/>`;
  s += `<line x1="${r1(b.x)}" y1="${r1(yh)}" x2="${r1(b.x + b.width)}" y2="${r1(yh)}" stroke="${theme.border}" stroke-width="1"/>`;
  const titleY = shape.caption ? b.y + head / 2 - 7 : b.y + head / 2;
  s += drawIcon(shape.icon, b.x + t.padX, titleY - 8, 16, tone.fg, 1.75);
  s += textMid(b.x + t.padX + 24, titleY, fitText(shape.title, theme.size.label, 600, b.width - 2 * t.padX - 24), theme.size.label, 600, theme.text);
  if (shape.caption)
    s += textMid(b.x + t.padX, titleY + 17, fitText(shape.caption, theme.size.caption, 400, b.width - 2 * t.padX), theme.size.caption, 400, theme.textMuted);

  let y = b.y + head;
  for (const [i, row] of shape.rows.entries()) {
    if (row.kind === 'section') {
      s += textMid(b.x + t.padX, y + t.section / 2 + 2, row.label.toUpperCase(), 10, 600, theme.textFaint);
      y += t.section;
      continue;
    }
    const cy = y + t.row / 2;
    if (i > 0 && shape.rows[i - 1]?.kind === 'row')
      s += `<line x1="${r1(b.x + t.padX)}" y1="${r1(y)}" x2="${r1(b.x + b.width - t.padX)}" y2="${r1(y)}" stroke="${theme.border}" stroke-opacity="0.6" stroke-width="1"/>`;
    const marks = row.marks ?? [];
    // A row's own icon (port kind, check) wins; otherwise the strongest mark shows.
    const markIcon = row.icon ?? (marks.includes('pk') ? 'key-round' : marks.includes('fk') ? 'link' : marks.includes('pii') ? 'eye' : undefined);
    const markTone = row.icon ? theme.tones[row.tone ?? 'slate'].fg
      : marks.includes('pk') ? theme.tones.amber.fg : marks.includes('fk') ? theme.tones.blue.fg : theme.tones.rose.fg;
    s += drawIcon(markIcon, b.x + t.padX, cy - 6.5, 13, markTone, 1.75);
    const [name, type] = row.cells;
    if (name) s += textMid(b.x + t.padX + MARK_WIDTH, cy, name.text, theme.size.cell, name.strong ? 600 : 400, theme.text);
    if (type?.text) s += textMid(b.x + b.width - t.padX, cy, type.text, theme.size.cell, 400, theme.textMuted, 'end');
    y += t.row;
  }
  return s;
}

function edgeColor(e: GraphEdge, theme: Theme): string {
  return e.tone ? theme.tones[e.tone].fg : theme.edge;
}

function drawEdge(e: GraphEdge, points: Point[], theme: Theme): string {
  const color = edgeColor(e, theme);
  const pts = points.map((p) => ({ ...p }));
  // Pull the line back where an arrowhead sits, so it does not poke through the tip.
  if (e.end === 'arrow') shorten(pts, pts.length - 1, pts.length - 2, 5);
  if (e.start === 'arrow') shorten(pts, 0, 1, 5);
  const dash = e.line === 'dashed' ? ' stroke-dasharray="6 4"' : e.line === 'dotted' ? ' stroke-dasharray="1.5 3.5"' : '';
  const opacity = e.tone ? ' stroke-opacity="0.9"' : '';
  let s = `<path d="${roundedPath(pts, theme.radius.corner)}" fill="none" stroke="${color}" stroke-width="${theme.stroke.edge}" stroke-linecap="round" stroke-linejoin="round"${dash}${opacity}/>`;
  s += marker(e.end, points[points.length - 1]!, points[points.length - 2]!, color, theme);
  s += marker(e.start, points[0]!, points[1]!, color, theme);
  return s;
}

function shorten(pts: Point[], end: number, prev: number, by: number) {
  const a = pts[end]!;
  const b = pts[prev]!;
  const len = Math.hypot(a.x - b.x, a.y - b.y);
  if (len <= by) return;
  a.x -= ((a.x - b.x) / len) * by;
  a.y -= ((a.y - b.y) / len) * by;
}

/** Orthogonal polyline with rounded corners. */
export function roundedPath(pts: Point[], radius: number): string {
  if (pts.length < 2) return '';
  let d = `M${r1(pts[0]!.x)} ${r1(pts[0]!.y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1]!;
    const c = pts[i]!;
    const n = pts[i + 1]!;
    const l1 = Math.hypot(c.x - p.x, c.y - p.y);
    const l2 = Math.hypot(n.x - c.x, n.y - c.y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    if (r < 0.5) {
      d += `L${r1(c.x)} ${r1(c.y)}`;
      continue;
    }
    const a = { x: c.x - ((c.x - p.x) / l1) * r, y: c.y - ((c.y - p.y) / l1) * r };
    const b = { x: c.x + ((n.x - c.x) / l2) * r, y: c.y + ((n.y - c.y) / l2) * r };
    d += `L${r1(a.x)} ${r1(a.y)}Q${r1(c.x)} ${r1(c.y)} ${r1(b.x)} ${r1(b.y)}`;
  }
  const last = pts[pts.length - 1]!;
  return d + `L${r1(last.x)} ${r1(last.y)}`;
}

/** Arrowheads and crow's-foot ends, drawn at `tip` pointing away from `from`. */
function marker(kind: Marker, tip: Point, from: Point, color: string, theme: Theme): string {
  if (kind === 'none') return '';
  const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const d = { x: (tip.x - from.x) / len, y: (tip.y - from.y) / len };
  const n = { x: -d.y, y: d.x };
  const at = (back: number, side = 0) => ({ x: tip.x - d.x * back + n.x * side, y: tip.y - d.y * back + n.y * side });
  const P = (p: Point) => `${r1(p.x)} ${r1(p.y)}`;
  const line = (a: Point, b: Point) =>
    `<path d="M${P(a)}L${P(b)}" stroke="${color}" stroke-width="${theme.stroke.edge}" stroke-linecap="round" fill="none"/>`;
  const bar = (back: number) => line(at(back, -6), at(back, 6));
  const circle = (back: number) => {
    const c = at(back);
    return `<circle cx="${r1(c.x)}" cy="${r1(c.y)}" r="4" fill="${theme.surface}" stroke="${color}" stroke-width="${theme.stroke.edge}"/>`;
  };
  const crow = () => line(at(12), at(0, -7)) + line(at(12), at(0, 7)) + line(at(12), at(0));

  switch (kind) {
    case 'arrow':
      return `<path d="M${P(at(9, -4.5))}L${P(tip)}L${P(at(9, 4.5))}Q${P(at(7))} ${P(at(9, -4.5))}Z" fill="${color}" stroke="${color}" stroke-width="1" stroke-linejoin="round"/>`;
    case 'one':
      return bar(8) + bar(13);
    case 'zeroOrOne':
      return bar(8) + circle(17);
    case 'many':
      return crow();
    case 'oneOrMany':
      return crow() + bar(16);
    case 'zeroOrMany':
      return crow() + circle(20);
  }
}

function drawEdgeLabel(label: string, b: Box, theme: Theme): string {
  const h = 20;
  const y = b.y + (b.height - h) / 2;
  return (
    `<rect x="${r1(b.x)}" y="${r1(y)}" width="${r1(b.width)}" height="${h}" rx="${h / 2}" fill="${theme.surface}" stroke="${theme.border}" stroke-width="1"/>` +
    textMid(b.x + b.width / 2, y + h / 2, label, theme.size.edgeLabel, 500, theme.textMuted, 'middle')
  );
}

function titleWidth(g: Graph, theme: Theme): number {
  return Math.max(g.title ? measureText(g.title, theme.size.title, 600) : 0, g.subtitle ? measureText(g.subtitle, theme.size.subtitle, 400) : 0);
}

function legendItems(g: Graph, theme: Theme) {
  let x = 0;
  return (g.legend ?? []).map((item) => {
    const at = x;
    x += 28 + measureText(item.label, theme.size.caption, 500) + 24;
    return { item, x: at, end: x - 24 };
  });
}

function legendWidth(g: Graph, theme: Theme): number {
  return legendItems(g, theme).at(-1)?.end ?? 0;
}

function drawLegend(g: Graph, theme: Theme, x0: number, cy: number): string {
  return legendItems(g, theme)
    .map(({ item, x }) => {
      const color = item.tone ? theme.tones[item.tone].fg : theme.edge;
      const label = textMid(x0 + x + 28, cy, item.label, theme.size.caption, 500, theme.textMuted);
      if (item.swatch === 'fill')
        return `<rect x="${x0 + x}" y="${cy - 7}" width="20" height="14" rx="7" fill="${theme.tones[item.tone ?? 'blue'].bg}"/>` + label;
      if (item.swatch === 'outline')
        return `<rect x="${x0 + x + 0.5}" y="${cy - 6.5}" width="19" height="13" rx="6.5" fill="none" stroke="${color}" stroke-opacity="0.7" stroke-dasharray="3 2"/>` + label;
      const dash = item.line === 'dashed' ? ' stroke-dasharray="6 4"' : item.line === 'dotted' ? ' stroke-dasharray="1.5 3.5"' : '';
      return `<path d="M${x0 + x} ${cy}H${x0 + x + 20}" stroke="${color}" stroke-width="${theme.stroke.edge + 0.4}" stroke-linecap="round"${dash}/>` + label;
    })
    .join('');
}
