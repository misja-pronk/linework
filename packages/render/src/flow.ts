// Process and state-machine shapes: tasks, events, gateways, states, pseudo-states, documents
// and notes, and the lanes they stand in.
//
// What a shape is shows in its outline and its mark, never in its colour alone: a start event is
// a thin ring, an end event a heavy one, a parallel gateway carries a plus. Everything is laid out
// as plain marks first (the journey's kind), so the slide writer places the same marks as native,
// editable shapes.
import type { Box, FlowShape, GraphGroup, NodeSize, Point } from '@cartography/core';
import { baselineOffset, groupFill, groupLabel, groupLabelInk, groupLine, look, measureText, type Theme } from '@cartography/theme';
import { icon } from '@cartography/icons';
import type { JourneyMark, JourneySeg } from './journey.ts';
import { cardStroke } from './paint.ts';
import { wrapText } from './size.ts';

export const FLOW = {
  task: { min: 112, max: 148, padX: 14, line: 17, icon: 16, iconGap: 7 },
  event: 36,
  gateway: 44,
  state: { min: 96, max: 176, padX: 16, head: 40, line: 16 },
  pseudo: { initial: 18, final: 22, choice: 30, history: 26 },
  document: { width: 34, height: 42, fold: 10 },
  note: { max: 168, line: 15 },
  /** A name beside its shape: an event's, a gateway's, a document's. */
  label: { max: 108, line: 14, lines: 3 },
  lane: { min: 56, max: 148, padX: 14, line: 16 },
} as const;

const r1 = (n: number) => Math.round(n * 10) / 10;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const widest = (lines: string[], size: number, weight: 400 | 500 | 600) => Math.max(0, ...lines.map((l) => measureText(l, size, weight)));
const even = (n: number) => 2 * Math.ceil(n / 2);

/** Named beside the shape rather than inside it. */
export const namedOutside = (shape: FlowShape) => shape.form === 'event' || shape.form === 'gateway' || shape.form === 'document' || shape.form === 'pseudo';

const taskLines = (shape: FlowShape, theme: Theme) => wrapText(shape.label, theme.size.label, 600, FLOW.task.max - 2 * FLOW.task.padX, 3);
const taskCaption = (shape: FlowShape, theme: Theme) => (shape.caption ? wrapText(shape.caption, theme.size.caption, 400, FLOW.task.max - 2 * FLOW.task.padX, 2) : []);
const stateName = (shape: FlowShape, theme: Theme) => wrapText(shape.label, theme.size.label, 600, FLOW.state.max - 2 * FLOW.state.padX, 2);
const noteLines = (shape: FlowShape, theme: Theme) => wrapText(shape.label, theme.size.caption, 400, FLOW.note.max, 5);
const outsideLines = (shape: FlowShape, theme: Theme) => (shape.label ? wrapText(shape.label, theme.size.caption, 500, FLOW.label.max, FLOW.label.lines) : []);

export function flowSize(shape: FlowShape, theme: Theme): NodeSize {
  const beside = () => {
    const lines = outsideLines(shape, theme);
    return lines.length ? { label: { width: Math.ceil(widest(lines, theme.size.caption, 500)) + 2, height: lines.length * FLOW.label.line } } : {};
  };
  switch (shape.form) {
    case 'task':
    case 'subprocess': {
      const t = FLOW.task;
      const lines = taskLines(shape, theme);
      const caption = taskCaption(shape, theme);
      const lead = shape.icon ? t.icon + t.iconGap : 0;
      const width = Math.min(t.max + lead, Math.max(t.min, even(Math.max(widest(lines, theme.size.label, 600), widest(caption, theme.size.caption, 400)) + 2 * t.padX + lead)));
      const text = lines.length * t.line + caption.length * 15 + (caption.length ? 1 : 0);
      const height = Math.max(theme.space.card.height, even(text + 24 + (shape.form === 'subprocess' ? 12 : 0)));
      return { width, height };
    }
    case 'state': {
      const s = FLOW.state;
      const name = stateName(shape, theme);
      const inner = Math.max(widest(name, theme.size.label, 600), ...(shape.lines ?? []).map((l) => Math.min(measureText(l, theme.size.caption, 400), s.max + 40 - 2 * s.padX)));
      const width = Math.max(s.min, even(inner + 2 * s.padX));
      const head = Math.max(s.head, name.length * 17 + 20);
      return { width, height: shape.lines?.length ? head + 6 + shape.lines.length * s.line + 8 : head + 4 };
    }
    case 'event':
      return { width: FLOW.event, height: FLOW.event, ...beside() };
    case 'gateway':
      return { width: FLOW.gateway, height: FLOW.gateway, ...beside() };
    case 'pseudo': {
      const d = FLOW.pseudo[shape.mark === 'final' || shape.mark === 'choice' || shape.mark === 'history' ? shape.mark : 'initial'];
      return { width: d, height: d, ...beside() };
    }
    case 'document':
      return { width: FLOW.document.width, height: FLOW.document.height, ...beside() };
    case 'note': {
      const lines = noteLines(shape, theme);
      return { width: Math.ceil(widest(lines, theme.size.caption, 400)) + 14, height: lines.length * FLOW.note.line + 8 };
    }
  }
}

/** A lane's name as the theme writes group names (capitals, tracking), wrapped to a width. */
function laneName(label: string, theme: Theme, width: number, max: number) {
  const lab = groupLabel(theme, label);
  // Tracking widens every letter; a line of a lane name has about a dozen.
  const lines = wrapText(lab.text, lab.size, 600, width - lab.tracking * 12, max);
  return { ...lab, lines, wide: Math.max(0, ...lines.map((l) => measureText(l, lab.size, 600, 'sans', lab.tracking))) };
}

/** The width of a lane's header: its name, wrapped, with room around it. */
export function laneHeader(label: string, theme: Theme): number {
  const l = FLOW.lane;
  return Math.min(l.max, Math.max(l.min, even(laneName(label, theme, l.max - 2 * l.padX, 3).wide + 2 * l.padX)));
}

const poly = (pts: [number, number][]): JourneySeg[] => [...pts.map(([x, y], i) => [i ? 'L' : 'M', x, y] as JourneySeg), ['Z']];

/**
 * The marks of one shape in its box; `beside` is where its name goes when that is drawn outside
 * (under the shape when the layout did not say).
 */
export function flowMarks(shape: FlowShape, b: Box, theme: Theme, beside?: Box): JourneyMark[] {
  const m: JourneyMark[] = [];
  const tone = theme.tones[shape.tone];
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const card = { fill: theme.surface, stroke: cardStroke(theme, tone), sw: theme.stroke.card, shadow: true };
  const diamond = (r: number) => poly([[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]]);
  const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, sw: number) => m.push({ t: 'path', d: [['M', x1, y1], ['L', x2, y2]], stroke, sw });

  if (shape.form === 'task' || shape.form === 'subprocess') {
    const t = FLOW.task;
    const lines = taskLines(shape, theme);
    const sub = shape.form === 'subprocess' ? 12 : 0;
    const caption = taskCaption(shape, theme);
    const text = lines.length * t.line + caption.length * 15 + (caption.length ? 1 : 0);
    const top = b.y + (b.height - sub - text) / 2;
    // The icon of its kind stands before the name, the two centred together; a caption runs under both.
    const lead = shape.icon ? t.icon + t.iconGap : 0;
    const wide = widest(lines, theme.size.label, 600);
    m.push({ t: 'rect', x: b.x, y: b.y, w: b.width, h: b.height, r: theme.radius.card, ...card, name: shape.label });
    if (shape.icon) m.push({ t: 'icon', name: shape.icon, x: cx - (wide + lead) / 2, y: top + (lines.length * t.line - t.icon) / 2, size: t.icon, color: tone.fg, sw: theme.stroke.icon });
    m.push({ t: 'text', x: b.x + 4 + lead, y: top, w: b.width - 8 - lead, lines, size: theme.size.label, weight: 600, fill: theme.text, align: 'c', lh: t.line });
    if (caption.length) m.push({ t: 'text', x: b.x + 4, y: top + lines.length * t.line + 1, w: b.width - 8, lines: caption, size: theme.size.caption, weight: 400, fill: theme.textMuted, align: 'c', lh: 15 });
    if (sub) {
      // Collapsed: there is more inside.
      const y = b.y + b.height - 17;
      m.push({ t: 'rect', x: cx - 6, y, w: 12, h: 12, r: 2.5, fill: theme.surface, stroke: theme.textMuted, sw: 1.1 });
      line(cx - 3, y + 6, cx + 3, y + 6, theme.textMuted, 1.2);
      line(cx, y + 3, cx, y + 9, theme.textMuted, 1.2);
    }
  } else if (shape.form === 'state') {
    const s = FLOW.state;
    const name = stateName(shape, theme);
    const head = shape.lines?.length ? Math.max(s.head, name.length * 17 + 20) : b.height;
    m.push({ t: 'rect', x: b.x, y: b.y, w: b.width, h: b.height, r: Math.min(theme.radius.card + 4, 18), ...card, name: shape.label });
    m.push({ t: 'text', x: b.x + 4, y: b.y + (head - name.length * 17) / 2, w: b.width - 8, lines: name, size: theme.size.label, weight: 600, fill: theme.text, align: 'c', lh: 17 });
    if (shape.lines?.length) {
      line(b.x + 1, b.y + head, b.x + b.width - 1, b.y + head, theme.border, 1);
      for (const [i, l] of shape.lines.entries())
        m.push({ t: 'text', x: b.x + s.padX, y: b.y + head + 6 + i * s.line, w: b.width - 2 * s.padX, lines: wrapText(l, theme.size.caption, 400, b.width - 2 * s.padX, 1), size: theme.size.caption, weight: 400, fill: theme.textMuted, align: 'l', lh: s.line });
    }
  } else if (shape.form === 'event') {
    const r = b.width / 2;
    if (shape.mark === 'end') m.push({ t: 'circle', cx, cy, r: r - 1.6, fill: tone.bg, stroke: tone.fg, sw: 3.2 });
    else {
      m.push({ t: 'circle', cx, cy, r: r - 0.8, fill: tone.bg, stroke: tone.fg, sw: 1.5 });
      // Something that happens on the way: a double ring.
      if (shape.mark === 'mid') m.push({ t: 'circle', cx, cy, r: r - 4, stroke: tone.fg, sw: 1.2 });
    }
    if (shape.icon) m.push({ t: 'icon', name: shape.icon, x: cx - 8, y: cy - 8, size: 16, color: tone.fg, sw: shape.mark === 'end' ? 2 : theme.stroke.icon });
  } else if (shape.form === 'gateway' || (shape.form === 'pseudo' && shape.mark === 'choice')) {
    const r = b.width / 2;
    m.push({ t: 'path', d: diamond(r - 0.8), fill: tone.bg, stroke: tone.fg, sw: 1.5, name: shape.label || 'Gateway' });
    if (shape.mark === 'and') {
      line(cx - 8, cy, cx + 8, cy, tone.fg, 2.4);
      line(cx, cy - 8, cx, cy + 8, tone.fg, 2.4);
    } else if (shape.mark === 'or') m.push({ t: 'circle', cx, cy, r: 7, stroke: tone.fg, sw: 2.2 });
    else if (shape.mark === 'event') {
      // Whatever happens first decides: a double ring around a pentagon.
      m.push({ t: 'circle', cx, cy, r: 10, stroke: tone.fg, sw: 1.1 }, { t: 'circle', cx, cy, r: 7.5, stroke: tone.fg, sw: 1.1 });
      m.push({ t: 'path', d: poly([0, 1, 2, 3, 4].map((i) => [cx + 4.4 * Math.sin((i * 2 * Math.PI) / 5), cy - 4.4 * Math.cos((i * 2 * Math.PI) / 5)])), stroke: tone.fg, sw: 1.1 });
    }
  } else if (shape.form === 'pseudo') {
    const r = b.width / 2;
    if (shape.mark === 'final') {
      m.push({ t: 'circle', cx, cy, r: r - 0.8, fill: theme.surface, stroke: theme.text, sw: 1.5 });
      m.push({ t: 'circle', cx, cy, r: r - 5, fill: theme.text });
    } else if (shape.mark === 'history') {
      m.push({ t: 'circle', cx, cy, r: r - 0.8, fill: theme.surface, stroke: theme.textMuted, sw: 1.4 });
      m.push({ t: 'text', x: b.x, y: cy - 8, w: b.width, lines: ['H'], size: 12, weight: 600, fill: theme.textMuted, align: 'c', lh: 16 });
    } else m.push({ t: 'circle', cx, cy, r, fill: theme.text });
  } else if (shape.form === 'document') {
    const f = FLOW.document.fold;
    const x1 = b.x + b.width;
    const y1 = b.y + b.height;
    m.push({ t: 'path', d: poly([[b.x, b.y], [x1 - f, b.y], [x1, b.y + f], [x1, y1], [b.x, y1]]), fill: theme.surface, stroke: tone.fg, sw: 1.3, name: shape.label || 'Document' });
    m.push({ t: 'path', d: [['M', x1 - f, b.y], ['L', x1 - f, b.y + f], ['L', x1, b.y + f]], stroke: tone.fg, sw: 1.3 });
    for (const y of [b.y + 19, b.y + 25, b.y + 31]) line(b.x + 7, y, x1 - 7, y, tone.line, 1.3);
  } else {
    // An annotation: an open bracket and plain words.
    const lines = noteLines(shape, theme);
    m.push({ t: 'path', d: [['M', b.x + 7, b.y], ['L', b.x + 1, b.y], ['L', b.x + 1, b.y + b.height], ['L', b.x + 7, b.y + b.height]], stroke: theme.textFaint, sw: 1.4 });
    m.push({ t: 'text', x: b.x + 10, y: b.y + 4, w: b.width - 10, lines, size: theme.size.caption, weight: 400, fill: theme.textMuted, align: 'l', lh: FLOW.note.line });
  }

  if (namedOutside(shape)) {
    const lines = outsideLines(shape, theme);
    if (lines.length) {
      const h = lines.length * FLOW.label.line;
      const at = beside ?? { x: cx - FLOW.label.max / 2, y: b.y + b.height + 5, width: FLOW.label.max, height: h };
      // Its place is given as a box; the lines lean towards the shape.
      const off = at.x + at.width / 2 - cx;
      const align = off < -4 ? 'r' : off > 4 ? 'l' : 'c';
      m.push({ t: 'text', x: at.x, y: at.y, w: at.width, lines, size: theme.size.caption, weight: 500, fill: theme.text, align, lh: FLOW.label.line });
    }
  }
  return m;
}

/** A lane: a band with its name in a header at the start (left when the flow runs right, top when it runs down). */
export function laneMarks(g: GraphGroup, b: Box, theme: Theme, across: boolean, header: number): JourneyMark[] {
  const tone = theme.tones[g.tone];
  const l = FLOW.lane;
  // A lane is ground like any group: the theme's fill for the outermost level, its one outline, its way with names.
  const edge = groupLine(theme, tone);
  const rule = edge ?? theme.border;
  const ink = groupLabelInk(theme, tone);
  const m: JourneyMark[] = [{ t: 'rect', x: b.x, y: b.y, w: b.width, h: b.height, r: Math.min(theme.radius.group, 12), fill: groupFill(theme, 0, tone), ...(edge ? { stroke: edge, sw: theme.stroke.group } : {}), dash: g.border === 'dashed', name: g.label }];
  if (across) {
    const name = laneName(g.label, theme, l.max - 2 * l.padX, Math.max(1, Math.min(3, Math.floor((b.height - 8) / l.line))));
    m.push({ t: 'path', d: [['M', b.x + header, b.y + 1], ['L', b.x + header, b.y + b.height - 1]], stroke: rule, sw: theme.stroke.group });
    m.push({ t: 'text', x: b.x + l.padX, y: b.y + (b.height - name.lines.length * l.line) / 2, w: header - 2 * l.padX, lines: name.lines, size: name.size, weight: 600, fill: ink, align: 'c', lh: l.line, tracking: name.tracking });
  } else {
    const name = laneName(g.label, theme, b.width - 16, 1);
    m.push({ t: 'path', d: [['M', b.x + 1, b.y + header], ['L', b.x + b.width - 1, b.y + header]], stroke: rule, sw: theme.stroke.group });
    m.push({ t: 'text', x: b.x + 8, y: b.y + (header - l.line) / 2, w: b.width - 16, lines: name.lines, size: name.size, weight: 600, fill: ink, align: 'c', lh: l.line, tracking: name.tracking });
  }
  return m;
}

const paint = (m: { fill?: string; stroke?: string; sw?: number; dash?: boolean }) =>
  `fill="${m.fill ?? 'none'}"${m.stroke ? ` stroke="${m.stroke}" stroke-width="${r1(m.sw ?? 1)}" stroke-linecap="round" stroke-linejoin="round"` : ''}`;

const pathOf = (d: JourneySeg[]) => d.map((c) => (c[0] === 'Z' ? 'Z' : `${c[0]}${c.slice(1).map((n) => r1(n as number)).join(' ')}`)).join('');

/** Marks as SVG, attributes only. */
export function drawMarks(marks: JourneyMark[], theme: Theme, shadow: string): string {
  let s = '';
  for (const m of marks) {
    const dash = m.t !== 'rect' && m.t !== 'path' ? '' : m.dash && m.stroke ? ` stroke-dasharray="${look(theme).group.dash}"` : '';
    if (m.t === 'rect') s += `<rect x="${r1(m.x)}" y="${r1(m.y)}" width="${r1(m.w)}" height="${r1(m.h)}"${m.r ? ` rx="${r1(Math.min(m.r, m.w / 2, m.h / 2))}"` : ''} ${paint(m)}${dash}${m.shadow && theme.shadow.opacity > 0 ? ` filter="url(#${shadow})"` : ''}/>`;
    else if (m.t === 'circle') s += `<circle cx="${r1(m.cx)}" cy="${r1(m.cy)}" r="${r1(m.r)}" ${paint(m)}/>`;
    else if (m.t === 'path') s += `<path d="${pathOf(m.d)}" ${paint(m)}${dash}/>`;
    else if (m.t === 'icon') {
      const k = m.size / 24;
      s += `<g transform="translate(${r1(m.x)} ${r1(m.y)}) scale(${r1(k * 1000) / 1000})" fill="none" stroke="${m.color}" stroke-width="${r1(m.sw / k)}" stroke-linecap="round" stroke-linejoin="round">${icon(m.name) ?? ''}</g>`;
    } else {
      const x = m.align === 'c' ? m.x + m.w / 2 : m.align === 'r' ? m.x + m.w : m.x;
      const anchor = m.align === 'c' ? ' text-anchor="middle"' : m.align === 'r' ? ' text-anchor="end"' : '';
      for (const [i, l] of m.lines.entries())
        s += `<text x="${r1(x)}" y="${r1(m.y + m.lh * i + m.lh / 2 + baselineOffset(m.size))}" font-size="${m.size}" font-weight="${m.weight}" fill="${m.fill}"${anchor}${m.tracking ? ` letter-spacing="${m.tracking}"` : ''}>${esc(l)}</text>`;
    }
  }
  return s;
}

export const drawFlow = (shape: FlowShape, b: Box, theme: Theme, shadow: string, beside?: Box) => drawMarks(flowMarks(shape, b, theme, beside), theme, shadow);

/**
 * Where a line that ends on the box of a circle or a diamond meets the outline itself: the end
 * is carried on along the line's own direction, so nothing stops short in the air.
 */
export function flowOutline(shape: FlowShape, b: Box, end: Point, towards: Point): Point {
  const round = shape.form === 'event' || (shape.form === 'pseudo' && shape.mark !== 'choice');
  if (!round && shape.form !== 'gateway' && shape.form !== 'pseudo') return end;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const rx = b.width / 2;
  const ry = b.height / 2;
  const level = Math.abs(end.y - towards.y) < 0.5;
  // How far off the centre line it arrives, and how far the outline has drawn back there.
  const off = Math.min(1, Math.abs(level ? end.y - cy : end.x - cx) / (level ? ry : rx));
  const reach = round ? Math.sqrt(1 - off * off) : 1 - off;
  if (level) return Math.abs(end.x - b.x) < 0.5 ? { x: cx - rx * reach, y: end.y } : Math.abs(end.x - b.x - b.width) < 0.5 ? { x: cx + rx * reach, y: end.y } : end;
  return Math.abs(end.y - b.y) < 0.5 ? { x: end.x, y: cy - ry * reach } : Math.abs(end.y - b.y - b.height) < 0.5 ? { x: end.x, y: cy + ry * reach } : end;
}
