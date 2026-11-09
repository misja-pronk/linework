// Sequence shape: participant cards on top, thin dotted lifelines, one row per message, frames as
// tinted bands with a small tab. Text is measured first, then the lanes engine spaces the lifelines
// (each gap as wide as its widest label) and stacks the rows, so labels never collide: every message
// owns its row, and a row is as tall as its wrapped label.
import type { Box, SequenceEvent, SequenceParticipant, SequenceShape, Tone } from '@cartography/core';
import { deepest, nesting, spread, stack, tracks, type Apart, type Band, type Row, type Span } from '@cartography/lanes';
import { baselineOffset, fitText, measureText, type Theme } from '@cartography/theme';
import { icon } from '@cartography/icons';

const K = {
  gap: 28,
  head: { padX: 10, tile: 30, gap: 10, min: 116, max: 236, plain: 44, captioned: 54 },
  label: { size: 12, line: 16, max: 260 },
  note: { size: 11.5, line: 15, max: 200, padX: 10, padY: 8 },
  bar: 10,
  barStep: 6,
  loop: 30,
  number: 9,
  box: { pad: 14, head: 32, foot: 12 },
  frame: { tab: 20, head: 34, foot: 12, pad: 16, step: 10, branch: 30 },
  divider: 40,
  ref: 46,
};

const FRAME_TONES: Record<string, Tone> = { alt: 'amber', opt: 'sky', loop: 'teal', par: 'violet', break: 'rose', critical: 'orange', group: 'slate' };
const BRANCH_WORD: Record<string, string> = { alt: 'else', par: 'and' };

type Ev<K extends SequenceEvent['kind']> = Extract<SequenceEvent, { kind: K }>;

interface Header {
  p: SequenceParticipant;
  x: number;
  width: number;
}

interface Message {
  ev: Ev<'message'>;
  y: number;
  x1: number;
  x2: number;
  /** Centre of the label. */
  mid: number;
  lines: string[];
  /** Self-call: out to the right and back, `h` lower, onto the nested bar at `back`. */
  self?: { h: number; back: number };
}

interface Frame {
  ev: Ev<'frame'>;
  box: Box;
  tone: Tone;
  branches: { y: number; label?: string }[];
}

export interface SequenceGeometry {
  width: number;
  height: number;
  headers: Header[];
  headerHeight: number;
  headerY: number;
  footerY?: number;
  lifeline: [number, number];
  boxes: { box: Box; label: string; tone: Tone }[];
  messages: Message[];
  bars: { box: Box; tone: Tone }[];
  frames: Frame[];
  notes: { box: Box; lines: string[]; centred: boolean }[];
  refs: { box: Box; label: string; link?: string }[];
  dividers: { y: number; label: string }[];
}

/** Words into lines of at most `max` wide; a word longer than that is cut with an ellipsis. */
export function wrapText(text: string, size: number, weight: 400 | 500 | 600, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (!line || measureText(next, size, weight) <= max) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line || !lines.length) lines.push(line);
  return lines.map((l) => fitText(l, size, weight, max));
}

const widest = (lines: string[], size: number, weight: 400 | 500 | 600) => Math.max(0, ...lines.map((l) => measureText(l, size, weight)));

const cache = new WeakMap<SequenceShape, Map<Theme, SequenceGeometry>>();

export function sequenceGeometry(shape: SequenceShape, theme: Theme): SequenceGeometry {
  let byTheme = cache.get(shape);
  if (!byTheme) cache.set(shape, (byTheme = new Map()));
  let g = byTheme.get(theme);
  if (!g) byTheme.set(theme, (g = place(shape, theme)));
  return g;
}

function headerWidth(p: SequenceParticipant, theme: Theme): number {
  const h = K.head;
  const text = Math.max(measureText(p.label, theme.size.label, 600), p.caption ? measureText(p.caption, theme.size.caption, 400) : 0);
  const inner = (p.icon ? h.tile + h.gap : 0) + text;
  return Math.round(Math.min(h.max, Math.max(h.min, inner + 2 * h.padX + 6)));
}

function place(shape: SequenceShape, theme: Theme): SequenceGeometry {
  const lanes = shape.participants;
  const lane = new Map(lanes.map((p, i) => [p.id, i]));
  const widths = lanes.map((p) => headerWidth(p, theme));
  const headerHeight = lanes.some((p) => p.caption) ? K.head.captioned : K.head.plain;
  const L = K.label;

  // 1. Rows: one per message, note, divider, ref, branch; frames become bands around their rows.
  interface RowMeta extends Row {
    ev?: SequenceEvent;
    lines?: string[];
    note?: { lines: string[]; width: number; height: number };
  }
  const rows: RowMeta[] = [];
  const bands: (Band & { ev: Ev<'frame'>; branches: { row: number; label?: string }[] })[] = [];
  // Bands are listed in the order frames open, so an outer frame comes before the frames it holds.
  const open: { index: number; first: number; branches: { row: number; label?: string }[] }[] = [];
  for (const ev of shape.events) {
    if (ev.kind === 'message') {
      const lines = ev.label ? wrapText(ev.label, L.size, 500, L.max) : [];
      const text = lines.length * L.line;
      if (ev.from === ev.to) {
        const h = Math.max(22, text);
        rows.push({ ev, lines, size: 10 + h + 14, anchor: 10 });
      } else rows.push({ ev, lines, size: 8 + text + (lines.length ? 6 : 0) + 14, anchor: 8 + text + (lines.length ? 6 : 0) });
    } else if (ev.kind === 'note') {
      const N = K.note;
      const lines = wrapText(ev.text, N.size, 400, N.max);
      const width = Math.ceil(widest(lines, N.size, 400) + 2 * N.padX);
      const height = lines.length * N.line + 2 * N.padY;
      rows.push({ ev, note: { lines, width, height }, size: height + 16 });
    } else if (ev.kind === 'divider') rows.push({ ev, size: K.divider });
    else if (ev.kind === 'ref') rows.push({ ev, size: K.ref + 16 });
    else if (ev.kind === 'activate' || ev.kind === 'deactivate') rows.push({ ev, size: 0, anchor: 0 });
    else if (ev.kind === 'frame') {
      open.push({ index: bands.length, first: rows.length, branches: [] });
      bands.push({ ev, from: rows.length, to: rows.length, head: K.frame.head, foot: K.frame.foot, branches: [] });
    } else if (ev.kind === 'branch') {
      open.at(-1)?.branches.push({ row: rows.length, label: ev.label });
      rows.push({ ev, size: K.frame.branch, anchor: 0 });
    } else if (ev.kind === 'end') {
      const f = open.pop();
      if (!f) continue;
      if (rows.length === f.first) rows.push({ size: 16 });
      Object.assign(bands[f.index]!, { to: rows.length - 1, branches: f.branches });
    }
  }

  // 2. Activations: a call opens one on the callee, its reply (or deactivate:) closes the innermost.
  // One left open ends where its lane last takes part. A self-call nests a bar for its own row.
  const spans: (Span & { self?: boolean })[] = [];
  const openSpans = new Map<number, number[]>();
  const last = new Map<number, number>();
  const selfSpan = new Map<number, number>();
  for (const [r, row] of rows.entries()) {
    const ev = row.ev;
    if (!ev) continue;
    if (ev.kind === 'message') {
      const a = lane.get(ev.from)!;
      const b = lane.get(ev.to)!;
      last.set(a, r);
      last.set(b, r);
      if (ev.closes) {
        const s = openSpans.get(a)?.pop();
        if (s !== undefined) spans[s]!.to = r;
      }
      if (ev.opens && a === b) {
        selfSpan.set(r, spans.length);
        spans.push({ lane: a, from: r, to: r, self: true });
      } else if (ev.opens) {
        (openSpans.get(b) ?? openSpans.set(b, []).get(b)!).push(spans.length);
        spans.push({ lane: b, from: r, to: -1 });
      }
    } else if (ev.kind === 'activate' || ev.kind === 'deactivate') {
      // activate:/deactivate: right after a message belong to that message's line.
      const at = r > 0 && rows[r - 1]!.ev?.kind === 'message' ? r - 1 : r;
      const b = lane.get(ev.lane)!;
      if (ev.kind === 'activate') {
        (openSpans.get(b) ?? openSpans.set(b, []).get(b)!).push(spans.length);
        spans.push({ lane: b, from: at, to: -1 });
      } else {
        const s = openSpans.get(b)?.pop();
        if (s !== undefined) spans[s]!.to = at;
      }
    }
  }
  for (const s of spans) if (s.to < 0) s.to = Math.max(s.from, last.get(s.lane) ?? s.from);
  const track = tracks(spans);
  // Where a message leaves or meets a lane at a row: the edge of its deepest bar, facing the other end.
  const without = (skip?: number) => (skip === undefined ? spans : spans.map((s, i) => (i === skip ? { ...s, lane: -1 } : s)));
  const edgeOffset = (l: number, r: number, side: 1 | -1, skip?: number) => {
    const d = deepest(without(skip), track, l, r);
    return d < 0 ? 0 : d * K.barStep + (side * K.bar) / 2;
  };

  // 3. Across: lifelines spaced by what has to fit between them.
  const aparts: Apart[] = [];
  const reachAfter = new Map<number, number>();
  const reachBefore = new Map<number, number>();
  const want = (m: Map<number, number>, l: number, v: number) => m.set(l, Math.max(m.get(l) ?? 0, v));
  for (let k = 0; k + 1 < lanes.length; k++)
    if ((lanes[k]!.box || lanes[k + 1]!.box) && lanes[k]!.box !== lanes[k + 1]!.box)
      aparts.push({ a: k, b: k + 1, min: (widths[k]! + widths[k + 1]!) / 2 + K.gap + 2 * K.box.pad });
  const numberRoom = (ev: Ev<'message'>) => (ev.number !== undefined ? 2 * K.number + 6 : 0);
  for (const [r, row] of rows.entries()) {
    const ev = row.ev;
    if (ev?.kind === 'message') {
      const a = lane.get(ev.from)!;
      const b = lane.get(ev.to)!;
      const text = widest(row.lines!, L.size, 500);
      if (a !== b) {
        const bars = Math.abs(edgeOffset(a, r, 1)) + Math.abs(edgeOffset(b, r, 1));
        aparts.push({ a, b, min: text + 32 + numberRoom(ev) + bars });
      } else {
        const need = edgeOffset(a, r, 1) + K.loop + 10 + text + 16 + numberRoom(ev);
        if (a + 1 < lanes.length) aparts.push({ a, b: a + 1, min: need });
        want(reachAfter, a, need);
      }
    } else if (ev?.kind === 'note' && ev.side !== 'over') {
      const a = lane.get(ev.over[0]!)!;
      const need = K.bar / 2 + 10 + row.note!.width + 14;
      if (ev.side === 'right' && a + 1 < lanes.length) aparts.push({ a, b: a + 1, min: need });
      if (ev.side === 'left' && a > 0) aparts.push({ a: a - 1, b: a, min: need });
    }
  }
  const { centres } = spread(widths, K.gap, aparts);
  const cx = (l: number) => centres[l]!;

  // Labels were wrapped narrow to ask for room; where a gap turned out wider (another label asked
  // for more), use it: fewer lines, shorter rows. Notes over several lifelines wrap to their width.
  for (const [r, row] of rows.entries()) {
    const ev = row.ev;
    if (ev?.kind === 'message' && ev.from !== ev.to && ev.label) {
      const a = lane.get(ev.from)!;
      const b = lane.get(ev.to)!;
      const room = Math.abs(cx(b) - cx(a)) - 32 - numberRoom(ev) - Math.abs(edgeOffset(a, r, 1)) - Math.abs(edgeOffset(b, r, 1));
      if (room <= L.max) continue;
      row.lines = wrapText(ev.label, L.size, 500, Math.min(room, 2 * L.max));
      const text = row.lines.length * L.line + 6;
      row.size = 8 + text + 14;
      row.anchor = 8 + text;
    } else if (ev?.kind === 'note' && ev.side === 'over' && ev.over.length > 1) {
      const ls = ev.over.map((id) => lane.get(id)!);
      const span = cx(Math.max(...ls)) - cx(Math.min(...ls)) + 2 * 26;
      const N = K.note;
      const lines = wrapText(ev.text, N.size, 400, Math.max(N.max, Math.min(span, 2 * N.max + 80) - 2 * N.padX));
      const height = lines.length * N.line + 2 * N.padY;
      row.note = { lines, width: Math.ceil(widest(lines, N.size, 400) + 2 * N.padX), height };
      row.size = height + 16;
    }
  }

  // 4. Along: rows and frames stacked; then everything gets its box.
  const headerY = shape.boxes.length && lanes.some((p) => p.box) ? K.box.head : 0;
  const top = headerY + headerHeight + 18;
  const stacked = stack(rows, bands);
  const at = (r: number) => top + stacked.rows[r]!.at;
  const rowTop = (r: number) => top + stacked.rows[r]!.start;
  const bottom = top + stacked.size + 18;

  const messages: Message[] = [];
  const notes: SequenceGeometry['notes'] = [];
  const refs: SequenceGeometry['refs'] = [];
  const dividers: SequenceGeometry['dividers'] = [];
  const extent: ([number, number] | undefined)[] = rows.map(() => undefined);
  for (const [r, row] of rows.entries()) {
    const ev = row.ev;
    if (ev?.kind === 'message') {
      const a = lane.get(ev.from)!;
      const b = lane.get(ev.to)!;
      const lines = row.lines!;
      if (a === b) {
        const s = selfSpan.get(r);
        const x1 = cx(a) + edgeOffset(a, r, 1, s);
        const back = cx(a) + (s !== undefined ? track[s]! * K.barStep + K.bar / 2 : edgeOffset(a, r, 1));
        const h = Math.max(22, lines.length * L.line);
        messages.push({ ev, y: at(r), x1, x2: x1 + K.loop, mid: 0, lines, self: { h, back } });
        extent[r] = [cx(a) - Math.abs(edgeOffset(a, r, -1)) - K.bar, x1 + K.loop + 10 + numberRoom(ev) + widest(lines, L.size, 500)];
      } else {
        const dir = b > a ? 1 : -1;
        const x1 = cx(a) + edgeOffset(a, r, dir as 1 | -1);
        const x2 = cx(b) + edgeOffset(b, r, -dir as 1 | -1);
        const half = widest(lines, L.size, 500) / 2;
        // A label across several lifelines sits in the first gap from the sender that holds it, so it
        // does not lie on a lifeline or bar in between; centred over the whole line otherwise.
        const start = x1 + dir * numberRoom(ev);
        let mid = (start + x2) / 2;
        for (let k = a; k !== b; k += dir) {
          const from = k === a ? start : cx(k) + dir * (Math.abs(edgeOffset(k, r, 1)) + K.bar);
          const to = k + dir === b ? x2 : cx(k + dir) - dir * (Math.abs(edgeOffset(k + dir, r, 1)) + K.bar);
          if (Math.abs(to - from) - 24 >= 2 * half) {
            mid = (from + to) / 2;
            break;
          }
        }
        messages.push({ ev, y: at(r), x1, x2, mid, lines });
        // Frames hug the lifelines with room for the bars on them, not just the line ends.
        const reach = (l: number) => Math.abs(edgeOffset(l, r, 1)) + K.bar;
        extent[r] = [Math.min(cx(Math.min(a, b)) - reach(Math.min(a, b)), mid - half), Math.max(cx(Math.max(a, b)) + reach(Math.max(a, b)), mid + half)];
      }
    } else if (ev?.kind === 'note') {
      const n = row.note!;
      const ls = ev.over.map((id) => lane.get(id)!);
      const lo = Math.min(...ls);
      const hi = Math.max(...ls);
      let x: number;
      let w = n.width;
      if (ev.side === 'right') x = cx(lo) + K.bar / 2 + 10;
      else if (ev.side === 'left') x = cx(lo) - K.bar / 2 - 10 - w;
      else {
        w = Math.max(w, lo === hi ? 0 : cx(hi) - cx(lo) + 2 * 26);
        x = (cx(lo) + cx(hi)) / 2 - w / 2;
      }
      const box = { x, y: rowTop(r) + 8, width: w, height: n.height };
      notes.push({ box, lines: n.lines, centred: ev.side === 'over' });
      extent[r] = [x, x + w];
    } else if (ev?.kind === 'ref') {
      const ls = ev.over.map((id) => lane.get(id)!);
      const lo = Math.min(...ls);
      const hi = Math.max(...ls);
      const need = measureText(ev.label, theme.size.label, 600) + 2 * 56 + (ev.link ? 24 : 0);
      const w = Math.max(need, cx(hi) - cx(lo) + 2 * 30);
      const box = { x: (cx(lo) + cx(hi)) / 2 - w / 2, y: rowTop(r) + 8, width: w, height: K.ref };
      refs.push({ box, label: ev.label, link: ev.link });
      extent[r] = [box.x, box.x + w];
    } else if (ev?.kind === 'divider') dividers.push({ y: rowTop(r) + row.size / 2, label: ev.label });
  }

  // Frames hug what they hold, with insets that grow with the frames inside, and fit their tab.
  const level = nesting(bands);
  const order = bands.map((_, i) => i).sort((p, q) => level[p]! - level[q]! || p - q);
  const frameBox = new Map<number, Box>();
  for (const i of order) {
    const band = bands[i]!;
    let lo = Infinity;
    let hi = -Infinity;
    for (let r = band.from; r <= band.to; r++) {
      const e = extent[r];
      if (e) (lo = Math.min(lo, e[0])), (hi = Math.max(hi, e[1]));
    }
    for (const [j, b] of frameBox) if (j !== i && bands[j]!.from >= band.from && bands[j]!.to <= band.to) (lo = Math.min(lo, b.x)), (hi = Math.max(hi, b.x + b.width));
    if (lo > hi) (lo = cx(0)), (hi = cx(lanes.length - 1));
    const pad = K.frame.pad + level[i]! * K.frame.step;
    const x = lo - pad;
    const width = Math.max(hi + pad - x, tabWidth(band.ev, theme) + 24, ...band.branches.map((b) => branchWidth(band.ev.frame, b.label, theme) + 24));
    const s = stacked.bands[i]!;
    frameBox.set(i, { x, y: top + s.start, width, height: s.end - s.start });
  }
  const frames: Frame[] = bands.map((band, i) => ({
    ev: band.ev,
    box: frameBox.get(i)!,
    tone: band.ev.tone ?? FRAME_TONES[band.ev.frame] ?? 'slate',
    branches: band.branches.map((b) => ({ y: rowTop(b.row), label: b.label })),
  }));

  const bars = spans.map((s, i) => {
    const x = cx(s.lane) - K.bar / 2 + track[i]! * K.barStep;
    if (s.self) {
      const h = Math.max(22, (rows[s.from]!.lines?.length ?? 0) * L.line);
      return { box: { x, y: at(s.from) + h - 6, width: K.bar, height: 18 }, tone: lanes[s.lane]!.tone };
    }
    const y1 = at(s.from);
    const y2 = Math.max(at(s.to), y1 + 18);
    return { box: { x, y: y1, width: K.bar, height: y2 - y1 }, tone: lanes[s.lane]!.tone };
  });

  // Boxes around participants that belong together, from the top to the bottom of the drawing.
  const footerY = shape.footers ? bottom : undefined;
  const height0 = (footerY ?? bottom - headerHeight) + headerHeight + (headerY ? K.box.foot : 0);
  const boxes = shape.boxes.flatMap((b) => {
    const members = lanes.map((p, i) => (p.box === b.id ? i : -1)).filter((i) => i >= 0);
    if (!members.length) return [];
    const x = Math.min(...members.map((i) => cx(i) - widths[i]! / 2)) - K.box.pad;
    const x2 = Math.max(...members.map((i) => cx(i) + widths[i]! / 2)) + K.box.pad;
    return [{ box: { x, y: 0, width: x2 - x, height: height0 }, label: b.label, tone: b.tone }];
  });

  // Shift so the leftmost thing drawn sits at 0.
  const xs: [number, number][] = [
    ...lanes.map((_, i) => [cx(i) - widths[i]! / 2, cx(i) + widths[i]! / 2] as [number, number]),
    ...boxes.map((b) => [b.box.x, b.box.x + b.box.width] as [number, number]),
    ...frames.map((f) => [f.box.x, f.box.x + f.box.width] as [number, number]),
    ...(extent.filter(Boolean) as [number, number][]),
    ...[...reachAfter].map(([l, v]) => [cx(l), cx(l) + v] as [number, number]),
    ...[...reachBefore].map(([l, v]) => [cx(l) - v, cx(l)] as [number, number]),
  ];
  const lo = Math.min(...xs.map((e) => e[0]));
  const hi = Math.max(...xs.map((e) => e[1]));
  const dx = -lo;
  const move = (b: Box) => ({ ...b, x: b.x + dx });
  return {
    width: Math.ceil(hi - lo),
    height: Math.ceil(height0),
    headers: lanes.map((p, i) => ({ p, x: cx(i) + dx, width: widths[i]! })),
    headerHeight,
    headerY,
    footerY,
    lifeline: [headerY + headerHeight, footerY ?? bottom],
    boxes: boxes.map((b) => ({ ...b, box: move(b.box) })),
    messages: messages.map((m) => ({ ...m, x1: m.x1 + dx, x2: m.x2 + dx, mid: m.mid + dx, ...(m.self ? { self: { ...m.self, back: m.self.back + dx } } : {}) })),
    bars: bars.map((b) => ({ ...b, box: move(b.box) })),
    frames: frames.map((f) => ({ ...f, box: move(f.box) })),
    notes: notes.map((n) => ({ ...n, box: move(n.box) })),
    refs: refs.map((r) => ({ ...r, box: move(r.box) })),
    dividers,
  };
}

const TAB = { size: 10, padX: 8, labelGap: 8 };

function tabWidth(ev: Ev<'frame'>, theme: Theme): number {
  const word = measureText(ev.frame.toUpperCase(), TAB.size, 600) + 2 * TAB.padX;
  return word + (ev.label ? TAB.labelGap + measureText(ev.label, theme.size.caption, 500) : 0);
}

function branchWidth(frame: string, label: string | undefined, theme: Theme): number {
  return measureText((BRANCH_WORD[frame] ?? 'else').toUpperCase(), TAB.size, 600) + (label ? TAB.labelGap + measureText(label, theme.size.caption, 500) : 0) + 12;
}

// ---------------------------------------------------------------- drawing

const r1 = (n: number) => Math.round(n * 10) / 10;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function text(x: number, cy: number, s: string, size: number, weight: number, fill: string, anchor?: 'middle' | 'end', extra = '') {
  const a = anchor ? ` text-anchor="${anchor}"` : '';
  return `<text x="${r1(x)}" y="${r1(cy + baselineOffset(size))}" font-size="${size}" font-weight="${weight}" fill="${fill}"${a}${extra}>${esc(s)}</text>`;
}

function glyph(name: string, x: number, y: number, size: number, color: string, stroke = 1.75) {
  const markup = icon(name);
  if (!markup) return '';
  const s = size / 24;
  return `<g transform="translate(${r1(x)} ${r1(y)}) scale(${s})" fill="none" stroke="${color}" stroke-width="${r1(stroke / s)}" stroke-linecap="round" stroke-linejoin="round">${markup}</g>`;
}

function rect(b: Box, rx: number, attrs: string) {
  return `<rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.width)}" height="${r1(b.height)}" rx="${rx}" ${attrs}/>`;
}

export function drawSequence(shape: SequenceShape, at: Box, theme: Theme, shadowId: string): string {
  const g = sequenceGeometry(shape, theme);
  const out: string[] = [`<g transform="translate(${r1(at.x)} ${r1(at.y)})">`];
  const tone = (t: Tone) => theme.tones[t];

  for (const b of g.boxes) {
    const t = tone(b.tone);
    out.push(rect(b.box, theme.radius.group, `fill="${t.wash}" stroke="${t.line}" stroke-width="${theme.stroke.group}"`));
    out.push(text(b.box.x + 14, b.box.y + K.box.head / 2 + 1, fitText(b.label, theme.size.group, 600, b.box.width - 28), theme.size.group, 600, theme.text));
  }

  for (const f of g.frames) out.push(drawFrameBack(f, theme));

  const [y1, y2] = g.lifeline;
  for (const h of g.headers)
    out.push(`<path d="M${r1(h.x)} ${r1(y1)}V${r1(y2)}" stroke="${theme.edge}" stroke-opacity="0.75" stroke-width="1.2" stroke-dasharray="1.5 4" stroke-linecap="round"/>`);

  for (const d of g.dividers) out.push(drawDivider(d, g.width, theme));

  for (const b of g.bars) {
    const t = tone(b.tone);
    out.push(rect(b.box, 3, `fill="${t.bg}" stroke="${t.fg}" stroke-opacity="0.55" stroke-width="1"`));
  }

  for (const f of g.frames) out.push(drawFrame(f, theme));
  for (const m of g.messages) out.push(drawMessage(m, theme));
  for (const n of g.notes) out.push(drawNote(n.box, n.lines, n.centred, theme));
  for (const r of g.refs) out.push(drawRef(r, theme));

  for (const h of g.headers) {
    out.push(drawHeader(h, g.headerY, g.headerHeight, theme, shadowId));
    if (g.footerY !== undefined) out.push(drawHeader(h, g.footerY, g.headerHeight, theme, shadowId));
  }
  out.push('</g>');
  return out.join('');
}

function drawHeader(h: Header, y: number, height: number, theme: Theme, shadowId: string): string {
  const H = K.head;
  const p = h.p;
  const t = theme.tones[p.tone];
  const b = { x: h.x - h.width / 2, y, width: h.width, height };
  let s = rect(b, theme.radius.card, `fill="${theme.surface}" stroke="${theme.border}" stroke-width="${theme.stroke.card}" filter="url(#${shadowId})"`);
  const cy = y + height / 2;
  const textW = Math.max(measureText(p.label, theme.size.label, 600), p.caption ? measureText(p.caption, theme.size.caption, 400) : 0);
  const room = h.width - 2 * H.padX - (p.icon ? H.tile + H.gap : 0);
  // Tile and text centred as one, so a header reads as the top of its lifeline.
  const content = (p.icon ? H.tile + H.gap : 0) + Math.min(room, textW);
  let x = h.x - content / 2;
  if (p.icon && icon(p.icon)) {
    s += rect({ x, y: cy - H.tile / 2, width: H.tile, height: H.tile }, 8, `fill="${t.bg}"`);
    s += glyph(p.icon, x + (H.tile - 16) / 2, cy - 8, 16, t.fg, theme.stroke.icon);
    x += H.tile + H.gap;
  }
  if (p.caption) {
    s += text(x, cy - 8, fitText(p.label, theme.size.label, 600, room), theme.size.label, 600, theme.text);
    s += text(x, cy + 9, fitText(p.caption, theme.size.caption, 400, room), theme.size.caption, 400, theme.textMuted);
  } else s += text(x, cy, fitText(p.label, theme.size.label, 600, room), theme.size.label, 600, theme.text);
  return s;
}

/** The band and its branch lines, under the lifelines. */
function drawFrameBack(f: Frame, theme: Theme): string {
  const t = theme.tones[f.tone];
  const b = f.box;
  let s = rect(b, 10, `fill="${t.wash}" fill-opacity="0.7" stroke="${t.line}" stroke-width="1.2"`);
  for (const br of f.branches) s += `<path d="M${r1(b.x)} ${r1(br.y + 6)}H${r1(b.x + b.width)}" stroke="${t.line}" stroke-width="1.2" stroke-dasharray="5 4"/>`;
  return s;
}

/** Tab and branch labels, over the lifelines and bars so nothing crosses the words. */
function drawFrame(f: Frame, theme: Theme): string {
  const t = theme.tones[f.tone];
  const b = f.box;
  let s = '';
  // The tab: the operator in small capitals on a tinted corner, the condition beside it.
  const word = f.ev.frame.toUpperCase();
  const ww = measureText(word, TAB.size, 600) + 2 * TAB.padX;
  const th = K.frame.tab;
  const r = 10;
  s += `<path d="M${r1(b.x)} ${r1(b.y + th)}V${r1(b.y + r)}Q${r1(b.x)} ${r1(b.y)} ${r1(b.x + r)} ${r1(b.y)}H${r1(b.x + ww)}V${r1(b.y + th - 6)}Q${r1(b.x + ww)} ${r1(b.y + th)} ${r1(b.x + ww - 6)} ${r1(b.y + th)}Z" fill="${t.bg}"/>`;
  s += text(b.x + TAB.padX, b.y + th / 2, word, TAB.size, 600, t.fg, undefined, ' letter-spacing="0.4"');
  // Words sit on a patch of the frame's own tint, so a lifeline or bar never runs through them.
  const patch = (x: number, cy: number, w: number) => rect({ x: x - 4, y: cy - 8, width: w + 8, height: 16 }, 4, `fill="${t.wash}"`);
  if (f.ev.label) {
    const label = fitText(f.ev.label, theme.size.caption, 500, b.width - ww - 2 * TAB.labelGap);
    s += patch(b.x + ww + TAB.labelGap, b.y + th / 2, measureText(label, theme.size.caption, 500));
    s += text(b.x + ww + TAB.labelGap, b.y + th / 2, label, theme.size.caption, 500, theme.text);
  }
  for (const br of f.branches) {
    const y = br.y + 6;
    const w = (BRANCH_WORD[f.ev.frame] ?? 'else').toUpperCase();
    const label = br.label ? fitText(br.label, theme.size.caption, 500, b.width - 60) : '';
    const lx = b.x + TAB.padX + measureText(w, TAB.size, 600) + TAB.labelGap;
    s += patch(b.x + TAB.padX, y + 13, lx - b.x - TAB.padX + (label ? measureText(label, theme.size.caption, 500) : -TAB.labelGap));
    s += text(b.x + TAB.padX, y + 13, w, TAB.size, 600, t.fg, undefined, ' letter-spacing="0.4"');
    if (label) s += text(lx, y + 13, label, theme.size.caption, 500, theme.text);
  }
  return s;
}

function drawDivider(d: { y: number; label: string }, width: number, theme: Theme): string {
  const w = measureText(d.label, theme.size.caption, 600) + 28;
  const cx = width / 2;
  return (
    `<path d="M0 ${r1(d.y)}H${r1(width)}" stroke="${theme.border}" stroke-width="1.2"/>` +
    rect({ x: cx - w / 2, y: d.y - 11, width: w, height: 22 }, 11, `fill="${theme.canvas}" stroke="${theme.border}" stroke-width="1"`) +
    text(cx, d.y, d.label, theme.size.caption, 600, theme.textMuted, 'middle')
  );
}

function drawNote(b: Box, lines: string[], centred: boolean, theme: Theme): string {
  const t = theme.tones.amber;
  const N = K.note;
  let s = rect(b, 8, `fill="${t.bg}" fill-opacity="0.8" stroke="${t.line}" stroke-width="1"`);
  const x = centred ? b.x + b.width / 2 : b.x + N.padX;
  for (const [i, l] of lines.entries()) s += text(x, b.y + N.padY + N.line * i + N.line / 2, l, N.size, 400, theme.text, centred ? 'middle' : undefined);
  return s;
}

function drawRef(r: { box: Box; label: string; link?: string }, theme: Theme): string {
  const t = theme.tones.slate;
  const b = r.box;
  const ww = measureText('REF', TAB.size, 600) + 2 * TAB.padX;
  const th = K.frame.tab;
  let s = rect(b, 10, `fill="${theme.surface}" stroke="${t.line}" stroke-width="1.2"`);
  s += `<path d="M${r1(b.x)} ${r1(b.y + th)}V${r1(b.y + 10)}Q${r1(b.x)} ${r1(b.y)} ${r1(b.x + 10)} ${r1(b.y)}H${r1(b.x + ww)}V${r1(b.y + th - 6)}Q${r1(b.x + ww)} ${r1(b.y + th)} ${r1(b.x + ww - 6)} ${r1(b.y + th)}Z" fill="${t.bg}"/>`;
  s += text(b.x + TAB.padX, b.y + th / 2, 'REF', TAB.size, 600, t.fg, undefined, ' letter-spacing="0.4"');
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2 + 3;
  const lw = measureText(r.label, theme.size.label, 600);
  if (r.link) {
    const x = cx - (lw + 22) / 2;
    s += text(x, cy, r.label, theme.size.label, 600, theme.tones.blue.fg);
    s += glyph('link', x + lw + 8, cy - 7, 14, theme.tones.blue.fg);
    return `<a href="${esc(r.link)}">${s}</a>`;
  }
  return s + text(cx, cy, r.label, theme.size.label, 600, theme.text, 'middle');
}

function drawMessage(m: Message, theme: Theme): string {
  const ev = m.ev;
  const L = K.label;
  const color = ev.arrow === 'async' ? theme.tones.violet.fg : ev.arrow === 'reply' ? theme.edge : theme.textMuted;
  const dash = ev.arrow === 'reply' ? ' stroke-dasharray="5 4"' : '';
  const stroke = `stroke="${color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  const halo = ` stroke="${theme.canvas}" stroke-width="4" stroke-linejoin="round" paint-order="stroke"`;
  let s = '';
  const num = ev.number !== undefined;
  if (m.self) {
    const { h, back } = m.self;
    const out = m.x2;
    const y = m.y;
    s += `<path d="M${r1(m.x1)} ${r1(y)}H${r1(out - 8)}Q${r1(out)} ${r1(y)} ${r1(out)} ${r1(y + 8)}V${r1(y + h - 8)}Q${r1(out)} ${r1(y + h)} ${r1(out - 8)} ${r1(y + h)}H${r1(back + 6)}" ${stroke}${dash}/>`;
    s += head(ev.arrow, { x: back, y: y + h }, -1, color, theme);
    let tx = out + 10;
    if (num) {
      s += numberBadge(ev.number!, tx + K.number, y + h / 2, theme);
      tx += 2 * K.number + 6;
    }
    const top = y + h / 2 - (m.lines.length * L.line) / 2;
    for (const [i, l] of m.lines.entries()) s += text(tx, top + L.line * i + L.line / 2, l, L.size, 500, theme.text, undefined, halo);
    return s;
  }
  const dir = m.x2 > m.x1 ? 1 : -1;
  const tip = ev.arrow === 'lost' ? m.x2 - dir * 4 : m.x2;
  const end = ev.arrow === 'sync' ? tip - dir * 6 : tip - dir * (ev.arrow === 'lost' ? 4 : 1);
  s += `<path d="M${r1(m.x1)} ${r1(m.y)}H${r1(end)}" ${stroke}${dash}/>`;
  s += head(ev.arrow, { x: tip, y: m.y }, dir, color, theme);
  if (num) s += numberBadge(ev.number!, m.x1 + dir * (K.number + 2), m.y, theme);
  const mid = m.mid;
  const base = m.y - 6 - m.lines.length * L.line;
  for (const [i, l] of m.lines.entries()) s += text(mid, base + L.line * i + L.line / 2, l, L.size, 500, theme.text, 'middle', halo);
  return s;
}

function numberBadge(n: number, cx: number, cy: number, theme: Theme): string {
  const t = theme.tones.slate;
  return `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${K.number}" fill="${t.fg}"/>` + text(cx, cy, String(n), 10, 600, theme.surface, 'middle');
}

/** Arrowheads at `tip`, pointing along `dir` (1 right, -1 left): filled for a call, open otherwise, a cross when lost. */
function head(kind: Ev<'message'>['arrow'], tip: { x: number; y: number }, dir: number, color: string, theme: Theme): string {
  const P = (dx: number, dy: number) => `${r1(tip.x - dir * dx)} ${r1(tip.y + dy)}`;
  if (kind === 'sync') return `<path d="M${P(9, -4.5)}L${P(0, 0)}L${P(9, 4.5)}Q${P(7, 0)} ${P(9, -4.5)}Z" fill="${color}" stroke="${color}" stroke-width="1" stroke-linejoin="round"/>`;
  if (kind === 'lost')
    return `<path d="M${P(4, -4)}L${P(-4, 4)}M${P(4, 4)}L${P(-4, -4)}" stroke="${theme.tones.rose.fg}" stroke-width="1.6" stroke-linecap="round" fill="none"/>`;
  return `<path d="M${P(8, -4.5)}L${P(0, 0)}L${P(8, 4.5)}" stroke="${color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
}
