// Roadmap shape: a time axis on top (two tiers: quarter or year over month, week or quarter), lanes
// below it, items as bars in tracks. Time maps to x linearly; the lanes engine does the rest: tracks
// keep overlapping items (and labels that do not fit inside their bar) apart on a lane, stack places
// the lanes. Phases are bands behind everything, the today line runs over everything.
import type { Box, RoadmapItem, RoadmapShape, RoadmapStatus, Tone } from '@cartography/core';
import { stack, tracks, type Span } from '@cartography/lanes';
import { baselineOffset, fitText, look, measureText, paperTint, type Theme } from '@cartography/theme';
import { icon } from '@cartography/icons';
import { arrowHead, tagRadius } from './paint.ts';
import { term, tr } from '@cartography/i18n/drawing';

const K = {
  gutter: { padX: 14, min: 120, max: 220, gap: 16 },
  tier: 24,
  phase: 28,
  axisMarks: 26,
  bar: 28,
  track: 8,
  lanePad: 12,
  label: { size: 12, padX: 10, out: 8 },
  diamond: 9,
  period: { min: 150, pad: 24 },
  legend: 34,
};

export const STATUS: Record<RoadmapStatus, { tone: Tone; label: string; icon?: string }> = {
  planned: { tone: 'slate', label: 'Planned' },
  active: { tone: 'blue', label: 'Active' },
  done: { tone: 'green', label: 'Done', icon: 'check' },
  'at-risk': { tone: 'amber', label: 'At risk', icon: 'circle-exclamation-point' },
  late: { tone: 'rose', label: 'Late', icon: 'timer' },
};

export interface RoadmapBar {
  it: RoadmapItem;
  box: Box;
  tone: Tone;
  /** Label inside the bar, or right of it (or of the diamond) when it does not fit. */
  inside: boolean;
  label: string;
  labelX: number;
  /** No status where others have one: drawn as planned, in its lane's colour, so it never passes for done. */
  unstated?: boolean;
}

export interface RoadmapGeometry {
  width: number;
  height: number;
  gutter: number;
  x: (t: number) => number;
  axis: { tiers: { y: number; h: number; cells: { x1: number; x2: number; label: string }[] }[]; bottom: number };
  phases: { box: Box; label: string; tone: Tone; labelY: number }[];
  lanes: { label: string; caption?: string; tone: Tone; top: number; bottom: number }[];
  bars: RoadmapBar[];
  /** Milestones on the axis (no lane): a diamond in the marks row and a dashed line down. */
  marks: { x: number; y: number; label: string; tone: Tone }[];
  arrows: { d: string; tip: { x: number; y: number; dx: number; dy: number } }[];
  today?: { x: number; label: string; top: number };
  grid: { x: number; strong: boolean }[];
  legend: { y: number; items: RoadmapStatus[] };
  bottom: number;
}

const cache = new WeakMap<RoadmapShape, Map<Theme, RoadmapGeometry>>();

export function roadmapGeometry(shape: RoadmapShape, theme: Theme): RoadmapGeometry {
  let byTheme = cache.get(shape);
  if (!byTheme) cache.set(shape, (byTheme = new Map()));
  let g = byTheme.get(theme);
  if (!g) byTheme.set(theme, (g = place(shape, theme)));
  return g;
}

const textW = (s: string, weight: 400 | 500 | 600 = 600) => measureText(s, K.label.size, weight);

function place(shape: RoadmapShape, theme: Theme): RoadmapGeometry {
  // Lanes' names on the left, as wide as the longest (within bounds; longer ones are cut).
  const named = shape.lanes.some((l) => l.label);
  const gutter = named
    ? Math.round(Math.min(K.gutter.max, Math.max(K.gutter.min, ...shape.lanes.map((l) => Math.max(measureText(l.label, theme.size.label, 600), l.caption ? measureText(l.caption, theme.size.caption, 400) : 0) + 2 * K.gutter.padX))) + K.gutter.gap)
    : 0;
  // Named periods are columns as wide as their widest name; dates are linear.
  const scale = shape.scale || Math.max(K.period.min, ...shape.ticks.map((t) => measureText(t.label, theme.size.label, 600) + 2 * K.period.pad));
  const x = (t: number) => gutter + (Math.max(shape.start, Math.min(shape.end, t)) - shape.start) * scale;
  const right = x(shape.end);

  // 1. The axis: the group tier (quarters, years) over the tick tier; named periods have one tier.
  const tiers: RoadmapGeometry['axis']['tiers'] = [];
  let y = 0;
  const groups: { x1: number; x2: number; label: string }[] = [];
  for (const t of shape.ticks)
    if (t.group !== undefined) {
      const g = groups.at(-1);
      if (g && g.label === t.group) g.x2 = x(t.end);
      else groups.push({ x1: x(t.start), x2: x(t.end), label: t.group });
    }
  if (groups.length) tiers.push({ y: (y += 0), h: K.tier, cells: groups }), (y += K.tier);
  tiers.push({ y, h: K.tier + (groups.length ? 0 : 6), cells: shape.ticks.map((t) => ({ x1: x(t.start), x2: x(t.end), label: t.label })) });
  y += K.tier + (groups.length ? 0 : 6);
  const axisBottom = y;
  const grid = shape.ticks.map((t, i) => ({ x: x(t.start), strong: i === 0 || t.group !== shape.ticks[i - 1]!.group }));
  grid.push({ x: right, strong: true });

  // 2. Rows above the lanes: phase labels, then milestones that belong to no lane.
  const phaseY = y + 6;
  if (shape.phases.length) y += K.phase + 6;
  const loose = shape.items.filter((i) => i.milestone && i.lane == null);
  const marksY = y + K.axisMarks / 2 + 4;
  if (loose.length) y += K.axisMarks + 8;
  const lanesTop = y + 8;

  // 3. Each lane's items in tracks; an item's extent includes its label when that sits outside.
  const laneIndex = new Map(shape.lanes.map((l, i) => [l.id, i]));
  const placed = shape.items.filter((i) => i.lane != null && laneIndex.has(i.lane));
  const bars = placed.map((it) => {
    // Bars keep a hair's gap at both ends, so one that ends where the next starts still reads as two.
    const x1 = it.milestone ? x(it.start) : x(it.start) + 1.5;
    const x2 = it.milestone ? x1 : Math.max(x(it.end) - 1.5, x1 + 6);
    const lw = textW(it.label);
    // Inside when it fits (with its status icon if that fits too; drawBar drops the icon otherwise).
    const inside = !it.milestone && x2 - x1 - 2 * K.label.padX >= lw;
    const reach = it.milestone ? x1 + K.diamond + K.label.out + lw : inside ? x2 : x2 + K.label.out + lw;
    return { it, x1: it.milestone ? x1 - K.diamond : x1, x2, inside, reach: Math.min(reach, Math.max(right, reach)) };
  });
  const spans: Span[] = bars.map((b) => ({ lane: laneIndex.get(b.it.lane!)!, from: b.x1, to: b.reach + 6 }));
  const track = tracks(spans);
  const depth = shape.lanes.map((_, l) => Math.max(0, ...track.filter((_, i) => spans[i]!.lane === l).map((t) => t + 1)));
  const stacked = stack(shape.lanes.map((_, l) => ({ size: 2 * K.lanePad + Math.max(1, depth[l]!) * (K.bar + K.track) - K.track })), [], 0);
  const lanes = shape.lanes.map((l, i) => ({ label: l.label, ...(l.caption ? { caption: l.caption } : {}), tone: l.tone, top: lanesTop + stacked.rows[i]!.start, bottom: lanesTop + stacked.rows[i]!.start + stacked.rows[i]!.size }));
  const laneBottom = lanesTop + stacked.size;

  const out: RoadmapBar[] = bars.map((b, i) => {
    const l = laneIndex.get(b.it.lane!)!;
    const top = lanes[l]!.top + K.lanePad + track[i]! * (K.bar + K.track);
    const tone = b.it.status ? STATUS[b.it.status].tone : (b.it.tone ?? shape.lanes[l]!.tone);
    const box = b.it.milestone ? { x: b.x1, y: top + K.bar / 2 - K.diamond, width: 2 * K.diamond, height: 2 * K.diamond } : { x: b.x1, y: top, width: b.x2 - b.x1, height: K.bar };
    const labelX = b.it.milestone ? b.x1 + 2 * K.diamond + K.label.out : b.inside ? b.x1 + K.label.padX : b.x2 + K.label.out;
    const room = b.inside ? b.x2 - b.x1 - 2 * K.label.padX : Math.max(40, Math.max(right, b.reach) - labelX) + 2;
    return { it: b.it, box, tone: b.it.milestone && !b.it.status ? (b.it.tone ?? 'rose') : tone, inside: b.inside, label: fitText(b.it.label, K.label.size, 600, room), labelX };
  });

  // 4. Dependencies: out of the end of one item, into the start of the next, elbows in the gap.
  const byId = new Map(out.map((b) => [b.it.id, b]));
  const arrows: RoadmapGeometry['arrows'] = [];
  for (const b of out)
    for (const d of b.it.after) {
      const a = byId.get(d);
      if (!a) continue;
      let sx = a.box.x + a.box.width;
      let sy = a.box.y + a.box.height / 2;
      const ex = b.box.x - 2;
      const ey = b.box.y + b.box.height / 2;
      const dir = ey > sy ? 1 : -1;
      // A vertical at x between y1 and y2 that cuts no other bar.
      const clear = (x: number, y1: number, y2: number) =>
        !out.some((o) => o !== a && o !== b && x > o.box.x - 4 && x < o.box.x + o.box.width + 4 && o.box.y < Math.max(y1, y2) && o.box.y + o.box.height > Math.min(y1, y2));
      if ((!a.inside || a.it.milestone) && Math.abs(sy - ey) >= 1) {
        // Its label sits right of it: leave from the bottom (or top) edge near the end instead.
        sx = a.it.milestone ? a.box.x + a.box.width / 2 : a.box.x + a.box.width - Math.min(10, a.box.width / 2);
        sy = dir > 0 ? a.box.y + a.box.height : a.box.y;
        const r = Math.min(8, Math.abs(ey - sy) / 2);
        if (ex - sx >= r + 8) {
          arrows.push({ d: `M${r1(sx)} ${r1(sy)}V${r1(ey - dir * r)}Q${r1(sx)} ${r1(ey)} ${r1(sx + r)} ${r1(ey)}H${r1(ex - 6)}`, tip: { x: ex, y: ey, dx: 1, dy: 0 } });
          continue;
        }
        const ty = dir > 0 ? b.box.y - 2 : b.box.y + b.box.height + 2;
        if (sx >= b.box.x + 6 && sx <= b.box.x + b.box.width - 6) {
          arrows.push({ d: `M${r1(sx)} ${r1(sy)}V${r1(ty - dir * 6)}`, tip: { x: sx, y: ty, dx: 0, dy: dir } });
          continue;
        }
        // The next one starts just after it: down into the gap above it, along, and in from the top.
        const tx = b.box.x + Math.min(14, b.box.width / 2);
        const gy = ty - dir * (K.track / 2 - 2);
        arrows.push({ d: `M${r1(sx)} ${r1(sy)}V${r1(gy)}H${r1(tx)}V${r1(ty - dir * 6)}`, tip: { x: tx, y: ty, dx: 0, dy: dir } });
        continue;
      }
      if (Math.abs(sy - ey) < 1) {
        arrows.push({ d: `M${r1(sx)} ${r1(sy)}H${r1(ex - 6)}`, tip: { x: ex, y: ey, dx: 1, dy: 0 } });
        continue;
      }
      const r = Math.min(8, Math.abs(ey - sy) / 2);
      const into = b.box.x + Math.min(14, b.box.width / 2);
      // The elbow sits close to the item that waits, so it reads "this starts when that ends";
      // further back when a bar in between would hide it.
      let mx: number | undefined;
      for (let x = ex - 12 - r; x >= sx + r + 2; x -= 2)
        if (clear(x, sy, ey)) {
          mx = x;
          break;
        }
      // No clear gap: into the top of the waiting item, past whatever is in between.
      if (mx === undefined && ex - sx >= 2 * r + 24) {
        let tx: number | undefined;
        const ty = dir > 0 ? b.box.y - 2 : b.box.y + b.box.height + 2;
        for (let x = b.box.x + 8; x <= b.box.x + b.box.width - 8; x += 2)
          if (clear(x, sy, ty)) {
            tx = x;
            break;
          }
        if (tx !== undefined) {
          arrows.push({ d: `M${r1(sx)} ${r1(sy)}H${r1(tx - r)}Q${r1(tx)} ${r1(sy)} ${r1(tx)} ${r1(sy + dir * r)}V${r1(ty - dir * 6)}`, tip: { x: tx, y: ty, dx: 0, dy: dir } });
          continue;
        }
      }
      if (ex - sx >= 2 * r + 24) {
        mx ??= Math.max(sx + r + 2, ex - 12 - r);
        arrows.push({ d: `M${r1(sx)} ${r1(sy)}H${r1(mx - r)}Q${r1(mx)} ${r1(sy)} ${r1(mx)} ${r1(sy + dir * r)}V${r1(ey - dir * r)}Q${r1(mx)} ${r1(ey)} ${r1(mx + r)} ${r1(ey)}H${r1(ex - 6)}`, tip: { x: ex, y: ey, dx: 1, dy: 0 } });
      } else if (Math.max(sx + 10, into) <= b.box.x + b.box.width - 6) {
        // Starts right when (or before) the other ends: out of its end and down into the top (or up into the bottom).
        const mx = Math.max(sx + 10, into);
        const ty = dir > 0 ? b.box.y - 2 : b.box.y + b.box.height + 2;
        const rr = Math.min(8, mx - sx, Math.abs(ty - sy) / 2);
        arrows.push({ d: `M${r1(sx)} ${r1(sy)}H${r1(mx - rr)}Q${r1(mx)} ${r1(sy)} ${r1(mx)} ${r1(sy + dir * rr)}V${r1(ty - dir * 6)}`, tip: { x: mx, y: ty, dx: 0, dy: dir } });
      } else {
        // Overlaps it entirely: out to the right, along the gap between the tracks, back, and in.
        const gy = dir > 0 ? b.box.y - K.track / 2 : b.box.y + b.box.height + K.track / 2;
        arrows.push({ d: `M${r1(sx)} ${r1(sy)}H${r1(sx + 10)}V${r1(gy)}H${r1(ex - 14)}V${r1(ey)}H${r1(ex - 6)}`, tip: { x: ex, y: ey, dx: 1, dy: 0 } });
      }
    }

  const marks = loose.map((it) => ({ x: x(it.start), y: marksY, label: it.label, tone: it.tone ?? (it.status ? STATUS[it.status].tone : 'rose') }));
  const phases = shape.phases.map((p) => ({ box: { x: x(p.start), y: phaseY, width: x(p.end) - x(p.start), height: laneBottom - phaseY }, label: p.label, tone: p.tone, labelY: phaseY + K.phase / 2 }));
  const used = [...new Set(shape.items.map((i) => i.status).filter((s): s is RoadmapStatus => !!s))];
  // Once some items say how they stand, one that says nothing is still to come: planned, in the key too.
  const unstated = used.length > 0 && shape.items.some((i) => !i.status && !i.milestone);
  if (unstated) {
    for (const b of out) if (!b.it.status && !b.it.milestone) b.unstated = true;
    if (!used.includes('planned')) used.push('planned');
  }
  const legendItems = (Object.keys(STATUS) as RoadmapStatus[]).filter((s) => used.includes(s));
  const hasToday = !!shape.today && shape.today.at >= shape.start && shape.today.at <= shape.end;
  const legendY = laneBottom + (hasToday ? 46 : 24);
  const bottom = legendItems.length ? legendY + 14 : laneBottom + (hasToday ? 28 : 4);
  // Milestone labels and outside labels may run past the axis end.
  const width = Math.ceil(Math.max(right, ...out.map((b) => (b.inside ? b.box.x + b.box.width : b.labelX + textW(b.label))), ...marks.map((m) => m.x + 14 + textW(m.label))) + 6);
  return {
    width,
    height: Math.ceil(bottom),
    gutter,
    x,
    axis: { tiers, bottom: axisBottom },
    phases,
    lanes,
    bars: out,
    marks,
    arrows,
    ...(hasToday ? { today: { x: x(shape.today!.at), label: shape.today!.label, top: 0 } } : {}),
    grid,
    legend: { y: legendY, items: legendItems },
    bottom: laneBottom,
  };
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
  return `<rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(Math.max(0, b.width))}" height="${r1(b.height)}" rx="${rx}" ${attrs}/>`;
}

const diamond = (cx: number, cy: number, r: number, attrs: string) => `<path d="M${r1(cx)} ${r1(cy - r)}L${r1(cx + r)} ${r1(cy)}L${r1(cx)} ${r1(cy + r)}L${r1(cx - r)} ${r1(cy)}Z" stroke-linejoin="round" ${attrs}/>`;

export function drawRoadmap(shape: RoadmapShape, at: Box, theme: Theme): string {
  const g = roadmapGeometry(shape, theme);
  const tone = (t: Tone) => theme.tones[t];
  const out: string[] = [`<g transform="translate(${r1(at.x)} ${r1(at.y)})">`];
  const right = g.x(shape.end);
  const lanesTop = g.lanes[0]?.top ?? g.axis.bottom;

  // Lane stripes: every other lane barely tinted, so a long row is easy to follow.
  for (const [i, l] of g.lanes.entries()) if (i % 2) out.push(rect({ x: 0, y: l.top, width: right, height: l.bottom - l.top }, 0, `fill="${paperTint(theme, 0) ?? theme.tones.slate.wash}"`));
  for (const p of g.phases) {
    const t = tone(p.tone);
    // A phase is a band of its own tone on every look: the tone is what tells the phases apart.
    out.push(rect(p.box, Math.min(10, theme.radius.group), `fill="${t.wash}" fill-opacity="0.9" stroke="${t.line}" stroke-width="1"`));
  }
  for (const gl of g.grid) out.push(`<path d="M${r1(gl.x)} ${r1(gl.strong ? 0 : g.axis.tiers.at(-1)!.y)}V${r1(g.bottom)}" stroke="${theme.border}" stroke-width="1"${gl.strong ? '' : ' stroke-dasharray="2 4"'}/>`);
  for (const l of g.lanes) out.push(`<path d="M0 ${r1(l.bottom)}H${r1(right)}" stroke="${theme.border}" stroke-width="1"/>`);
  out.push(`<path d="M0 ${r1(lanesTop)}H${r1(right)}" stroke="${theme.border}" stroke-width="1"/>`);

  // The axis: group tier in small capitals, ticks under it.
  for (const [k, tier] of g.axis.tiers.entries()) {
    const last = k === g.axis.tiers.length - 1;
    for (const c of tier.cells) {
      const w = c.x2 - c.x1;
      const size = last ? theme.size.caption : 10.5;
      const label = fitText(c.label, size, 600, w - 8);
      if (!label) continue;
      if (last && g.axis.tiers.length > 1) out.push(text(c.x1 + w / 2, tier.y + tier.h / 2, label, size, 500, theme.textMuted, 'middle'));
      else if (last) out.push(text(c.x1 + w / 2, tier.y + tier.h / 2, label, theme.size.label, 600, theme.text, 'middle'));
      else out.push(text(c.x1 + 8, tier.y + tier.h / 2, label.toUpperCase(), size, 600, theme.textFaint, undefined, ' letter-spacing="0.6"'));
    }
  }
  out.push(`<path d="M${r1(g.gutter)} ${r1(g.axis.bottom)}H${r1(right)}" stroke="${theme.border}" stroke-width="1.2"/>`);

  for (const p of g.phases) {
    const t = tone(p.tone);
    const label = fitText(p.label, theme.size.caption, 600, p.box.width - 20);
    if (!label) continue;
    const w = measureText(label, theme.size.caption, 600) + 20;
    out.push(rect({ x: p.box.x + 8, y: p.labelY - 10, width: w, height: 20 }, tagRadius(theme, 20), `fill="${t.bg}"`));
    out.push(text(p.box.x + 18, p.labelY, label, theme.size.caption, 600, t.fg));
  }

  // Lane names.
  for (const l of g.lanes) {
    if (!l.label) continue;
    const cy = (l.top + l.bottom) / 2;
    const t = tone(l.tone);
    const room = g.gutter - K.gutter.gap - K.gutter.padX - 6;
    out.push(rect({ x: 0, y: l.top + 8, width: 4, height: l.bottom - l.top - 16 }, 2, `fill="${t.fg}"`));
    if (l.caption) {
      out.push(text(K.gutter.padX, cy - 8, fitText(l.label, theme.size.label, 600, room), theme.size.label, 600, theme.text));
      out.push(text(K.gutter.padX, cy + 9, fitText(l.caption, theme.size.caption, 400, room), theme.size.caption, 400, theme.textMuted));
    } else out.push(text(K.gutter.padX, cy, fitText(l.label, theme.size.label, 600, room), theme.size.label, 600, theme.text));
  }

  // Axis milestones: a dashed line down through every lane.
  for (const m of g.marks) {
    const t = tone(m.tone);
    out.push(`<path d="M${r1(m.x)} ${r1(m.y + K.diamond)}V${r1(g.bottom)}" stroke="${t.fg}" stroke-width="1.3" stroke-dasharray="4 4" stroke-opacity="0.7"/>`);
  }

  // Today runs under the bars, so it never crosses a label.
  if (g.today) out.push(`<path d="M${r1(g.today.x)} ${r1(g.axis.bottom)}V${r1(g.bottom + 6)}" stroke="${theme.tones.rose.fg}" stroke-width="1.6"/>`);

  for (const a of g.arrows) {
    const { x, y, dx, dy } = a.tip;
    out.push(`<path d="${a.d}" fill="none" stroke="${theme.edge}" stroke-width="${theme.stroke.edge}" stroke-linecap="round" stroke-linejoin="round"/>`);
    if (look(theme).line.arrow !== 'filled') out.push(arrowHead({ x, y }, { x: x - dx, y: y - dy }, theme.edge, theme));
    else out.push(`<path d="M${r1(x - dx * 7 - dy * 4)} ${r1(y - dy * 7 + dx * 4)}L${r1(x)} ${r1(y)}L${r1(x - dx * 7 + dy * 4)} ${r1(y - dy * 7 - dx * 4)}Z" fill="${theme.edge}" stroke="${theme.edge}" stroke-width="1" stroke-linejoin="round"/>`);
  }

  for (const b of g.bars) out.push(drawBar(b, theme));

  for (const m of g.marks) {
    const t = tone(m.tone);
    out.push(diamond(m.x, m.y, K.diamond, `fill="${t.fg}" stroke="${theme.canvas}" stroke-width="2"`));
    // Its name after the diamond, or before it where it would run past the end of the timeline.
    const past = m.x + K.diamond + 6 + measureText(m.label, K.label.size, 600) > right;
    out.push(text(past ? m.x - K.diamond - 6 : m.x + K.diamond + 6, m.y, m.label, K.label.size, 600, theme.text, past ? 'end' : undefined, ` stroke="${theme.canvas}" stroke-width="4" paint-order="stroke"`));
  }

  if (g.today) {
    // Its pill hangs under the lanes, where it covers no tick or phase.
    const t = theme.tones.rose;
    const w = measureText(g.today.label, 10.5, 600) + 14;
    const y = g.bottom + 6;
    out.push(rect({ x: g.today.x - w / 2, y, width: w, height: 18 }, tagRadius(theme, 18), `fill="${t.fg}"`));
    out.push(text(g.today.x, y + 9, g.today.label, 10.5, 600, theme.canvas, 'middle'));
  }

  // Legend of the statuses in use, in the bars' own style.
  let lx = g.gutter;
  if (g.legend.items.length && g.gutter >= 60 && look(theme).legend === 'key') out.push(text(0, g.legend.y, tr(theme.lang, 'KEY'), 9.5, 600, theme.textFaint, undefined, ' letter-spacing="1.2" data-aside=""'));
  for (const s of g.legend.items) {
    const st = STATUS[s];
    out.push(drawBar({ it: { id: '', label: '', start: 0, end: 0, milestone: false, status: s, after: [], path: [] }, box: { x: lx, y: g.legend.y - 8, width: 26, height: 16 }, tone: st.tone, inside: true, label: '', labelX: 0 }, theme, true));
    const said = term(theme.lang, st.label);
    out.push(text(lx + 34, g.legend.y, said, theme.size.caption, 500, theme.textMuted));
    lx += 34 + measureText(said, theme.size.caption, 500) + 22;
  }
  out.push('</g>');
  return out.join('');
}

/** A bar by status: planned is an outline, active solid, done soft with a check, at risk and late warn. */
function drawBar(b: RoadmapBar, theme: Theme, sample = false): string {
  const t = theme.tones[b.tone];
  const box = b.box;
  const it = b.it;
  const cy = box.y + box.height / 2;
  let s = '';
  if (it.milestone) {
    s += diamond(box.x + K.diamond, cy, K.diamond, `fill="${t.fg}" stroke="${theme.canvas}" stroke-width="2"`);
    return s + text(b.labelX, cy, b.label, K.label.size, 600, theme.text);
  }
  const rx = Math.min(8, box.height / 2, theme.radius.card);
  const active = it.status === 'active';
  const planned = it.status === 'planned' || !!b.unstated;
  // Planned: an outline of what is to come (in its lane's colour when it has no status of its own); active: solid; the rest soft in their tone.
  const fill = planned ? theme.surface : active ? t.fg : t.bg;
  const stroke = b.unstated ? t.fg : planned ? theme.edge : active ? t.fg : t.line;
  s += rect(box, rx, `fill="${fill}" stroke="${stroke}" stroke-width="${planned ? 1.2 : 1}"${planned ? ' stroke-dasharray="4 3"' : ''}`);
  if (it.progress !== undefined && it.progress > 0 && !sample) {
    // Done part: a darker band along the bottom edge, so the label stays readable.
    const w = Math.max(rx, box.width * it.progress);
    s += `<path d="M${r1(box.x)} ${r1(box.y + box.height - 4)}H${r1(box.x + w)}" stroke="${it.status === 'active' ? theme.canvas : t.fg}" stroke-opacity="0.75" stroke-width="3" stroke-linecap="round"/>`;
  }
  if (sample) return s;
  const st = it.status ? STATUS[it.status] : undefined;
  const onBar = it.status === 'active' ? theme.canvas : it.status ? theme.text : theme.text;
  if (b.inside) {
    let x = b.labelX;
    if (st?.icon && box.width - 2 * K.label.padX - 18 >= measureText(b.label, K.label.size, 600)) {
      s += glyph(st.icon, x - 2, cy - 7, 14, t.fg, 2);
      x += 16;
    }
    s += text(x, cy, b.label, K.label.size, 600, onBar);
  } else {
    if (st?.icon) s += glyph(st.icon, box.x + box.width / 2 - 7, cy - 7, 14, it.status === 'active' ? theme.canvas : t.fg, 2);
    s += text(b.labelX, cy, b.label, K.label.size, 600, theme.text);
  }
  return s;
}
