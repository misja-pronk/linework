// Blocks: capability maps, org charts and Team Topologies views (core/block.ts, packages/tree).
//
// What a block means shows in its words and its outline, never in colour alone: a heatmap value is
// written in a tag beside the name, a category may add a pattern, a vacancy is dashed, a team type
// has its own outline (a wide bar, an upright bar, an octagon) and an interaction its own fill
// (cross-hatched, dotted, bracketed). Everything is laid out as plain marks, so the slide writer
// places the same marks as native, editable shapes.
import type { BlockForm, BlockHeat, BlockShape, Box, NodeSize, Tone } from '@cartography/core';
import { contrast, groupLabel, groupLine, measureText, mix, paperTint, type Theme } from '@cartography/theme';
import type { JourneyMark, JourneySeg } from './journey.ts';
import { wrapText } from './size.ts';
import { term } from '@cartography/i18n/drawing';

export const BLOCK = {
  area: { max: 260, padX: 12, top: 11, bottom: 9, line: 14 },
  capability: { min: 136, max: 216, padX: 10, top: 8, bottom: 8, line: 16 },
  chip: { min: 96, max: 176, padX: 8, padY: 6, line: 14, size: 11 },
  /** The systems listed under a capability. */
  system: { line: 13, size: 9.5, most: 4 },
  person: { width: 200, padX: 12, disc: 30, gap: 10, name: 16, role: 14, caption: 13, padY: 11 },
  team: { min: 150, max: 300, padX: 14, line: 17, caption: 14 },
  tag: { height: 16, padX: 5, size: 9.5, gap: 6 },
} as const;

/**
 * A mind map topic by its level: the centre is the heaviest, each level out a step lighter, from
 * a filled block through a tinted and an outlined box to words on their own.
 */
export const TOPIC = [
  { size: 16, weight: 600, line: 21, padX: 20, padY: 14, max: 230, icon: 18, note: 12 },
  { size: 13.5, weight: 600, line: 18, padX: 14, padY: 9, max: 210, icon: 15, note: 11 },
  { size: 12.5, weight: 500, line: 16, padX: 11, padY: 7, max: 200, icon: 14, note: 10.5 },
  { size: 12, weight: 400, line: 16, padX: 3, padY: 4, max: 190, icon: 13, note: 10.5 },
] as const;
const topicStyle = (s: BlockShape) => TOPIC[Math.max(0, Math.min(3, s.level ?? 1))]!;

/** A topic's words, note and room around them. */
function topicText(s: BlockShape) {
  const t = topicStyle(s);
  const iconRoom = s.icon ? t.icon + 7 : 0;
  const badgeRoom = s.badge ? measureText(s.badge, 10, 600) + 12 : 0;
  const room = t.max - 2 * t.padX - iconRoom - badgeRoom;
  const name = wrapText(s.label, t.size, t.weight as 400 | 500 | 600, room, 3);
  const note = s.caption ? wrapText(s.caption, t.note, 400, Math.max(room, 120), 2) : [];
  const noteLine = Math.round(t.note * 1.35);
  const w = Math.max(widest(name, t.size, t.weight as 400 | 500 | 600), widest(note, t.note, 400)) + iconRoom + badgeRoom;
  return { t, iconRoom, badgeRoom, name, note, noteLine, width: Math.ceil(w + 2 * t.padX), height: Math.ceil(2 * t.padY + name.length * t.line + note.length * noteLine + (note.length ? 2 : 0)) };
}

/** Team Topologies colours, after the book: stream-aligned yellow, platform blue, enabling purple, complicated-subsystem red. */
export const TEAM_TONES: Partial<Record<BlockForm, Tone>> = {
  stream: 'amber',
  platform: 'sky',
  enabling: 'violet',
  subsystem: 'orange',
  collaboration: 'indigo',
  service: 'slate',
  facilitating: 'green',
  flow: 'slate',
};

const widest = (lines: string[], size: number, weight: 400 | 500 | 600, mono = false) => Math.max(0, ...lines.map((l) => measureText(l, size, weight, mono ? 'mono' : 'sans')));
const even = (n: number) => 2 * Math.ceil(n / 2);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const isTeam = (f: BlockForm) => f === 'stream' || f === 'platform' || f === 'enabling' || f === 'subsystem';
export const isZone = (f: BlockForm) => f === 'collaboration' || f === 'service' || f === 'facilitating';

// ---------------------------------------------------------------- heat

/** Diverging scales run from bad to good through these. */
const DIVERGING: Tone[] = ['rose', 'orange', 'amber', 'teal', 'green'];

export interface HeatColors {
  fill: string;
  /** Text on the fill. */
  ink: string;
  /** The tag that says the value, and its text. */
  tag: string;
  tagInk: string;
  /** Pattern lines and dots. */
  line: string;
}

/** The theme's colours for a place on a heatmap: a fill that deepens with the value, a tag in the full colour. */
export function heatColors(theme: Theme, heat: BlockHeat): HeatColors {
  const at = clamp(heat.at ?? 0.5, 0, 1);
  const tone = heat.scale === 'diverging' ? DIVERGING[Math.round(at * (DIVERGING.length - 1))]! : heat.tone;
  const fg = theme.tones[tone].fg;
  const dark = theme.mode === 'dark';
  // A sequential scale runs from a wash to most of the colour, so neighbouring steps stay apart.
  const k = heat.scale === 'sequential' ? 0.08 + 0.72 * at : heat.scale === 'diverging' ? 0.2 + 0.3 * Math.abs(2 * at - 1) : 0.3;
  const fill = mix(fg, theme.surface, dark ? k * 0.85 : k);
  const ink = contrast(theme.text, fill) >= contrast(theme.canvas, fill) ? theme.text : theme.canvas;
  const tagInk = contrast(theme.surface, fg) >= contrast(theme.text, fg) ? theme.surface : theme.text;
  // On a fill that is most of the colour already, the tag turns round: the page's colour with the value in the tone.
  if (k > 0.55) return { fill, ink, tag: theme.surface, tagInk: fg, line: mix(fg, fill, 0.55) };
  return { fill, ink, tag: fg, tagInk, line: mix(fg, fill, 0.55) };
}

const tagWidth = (text: string) => Math.max(BLOCK.tag.height, Math.ceil(measureText(text, BLOCK.tag.size, 600, 'mono')) + 2 * BLOCK.tag.padX);

/** Room the value tag takes beside a name, gap included. */
const tagRoom = (s: BlockShape) => (s.heat ? tagWidth(s.heat.text) + BLOCK.tag.gap : 0);

// ---------------------------------------------------------------- sizes

/** An area's name in the theme's group capitals, wrapped with its letter-spacing counted. */
const areaName = (s: BlockShape, theme: Theme, width: number) => {
  const g = groupLabel(theme, s.label);
  const fits = (t: string) => measureText(t, g.size, 600, 'sans', g.tracking) <= width;
  const lines: string[] = [];
  let line = '';
  for (const w of g.text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${w}` : w;
    if (!line || fits(next)) line = next;
    else lines.push(line), (line = w);
  }
  if (line) lines.push(line);
  return { ...g, lines };
};
const trackedWidth = (lines: string[], size: number, tracking: number) => Math.max(0, ...lines.map((l) => measureText(l, size, 600, 'sans', tracking)));
const capName = (s: BlockShape, theme: Theme, width: number) => wrapText(s.label, theme.size.label - 1, 600, width, 3);
const chipName = (s: BlockShape, width: number) => wrapText(s.label, BLOCK.chip.size, 500, width, 3);
const systemLines = (s: BlockShape) => {
  const l = s.lines ?? [];
  return l.length > BLOCK.system.most ? [...l.slice(0, BLOCK.system.most - 1), `+${l.length - BLOCK.system.most + 1} more`] : l;
};

/** What a block needs: a leaf its whole box, a container the width and height of its header. */
export function blockSize(s: BlockShape, theme: Theme): NodeSize {
  const sys = systemLines(s);
  const sysW = widest(sys, BLOCK.system.size, 400, true);
  const sysH = sys.length * BLOCK.system.line + (sys.length ? 4 : 0);
  switch (s.form) {
    case 'area': {
      const a = BLOCK.area;
      const name = areaName(s, theme, a.max - 2 * a.padX - tagRoom(s));
      const w = trackedWidth(name.lines, name.size, name.tracking) + 2 * a.padX + tagRoom(s);
      const text = name.lines.length * a.line;
      return { width: even(clamp(w + 2, 120, a.max)), height: even(a.top + text + (s.container ? a.bottom : a.top) + (s.container ? 0 : sysH)) };
    }
    case 'capability': {
      const c = BLOCK.capability;
      const room = c.max - 2 * c.padX - tagRoom(s);
      const lines = capName(s, theme, room);
      const w = Math.max(widest(lines, theme.size.label - 1, 600) + tagRoom(s), sysW) + 2 * c.padX;
      const h = c.top + lines.length * c.line + c.bottom + (s.container ? 0 : sysH);
      return { width: even(clamp(w + 2, c.min, c.max)), height: even(Math.max(s.container ? 0 : 36, h)) };
    }
    case 'chip': {
      const c = BLOCK.chip;
      const lines = chipName(s, c.max - 2 * c.padX - tagRoom(s));
      const w = Math.max(widest(lines, c.size, 500) + tagRoom(s), sysW) + 2 * c.padX;
      return { width: even(clamp(w + 2, c.min, c.max)), height: even(Math.max(28, lines.length * c.line + 2 * c.padY + sysH)) };
    }
    case 'person': {
      const p = BLOCK.person;
      const room = p.width - 2 * p.padX - p.disc - p.gap;
      const name = wrapText(s.label, theme.size.label - 1, 600, room, 2);
      const role = s.caption ? wrapText(s.caption, theme.size.caption - 0.5, 400, room, 2) : [];
      const extra = s.lines?.length ? 1 : 0;
      return { width: p.width, height: even(Math.max(60, 2 * p.padY + name.length * p.name + role.length * p.role + extra * p.caption)) };
    }
    case 'stream':
    case 'platform':
    case 'enabling':
    case 'subsystem': {
      const t = BLOCK.team;
      const narrow = s.form === 'enabling';
      const room = (narrow ? 132 : t.max) - 2 * t.padX;
      const name = wrapText(s.label, theme.size.label, 600, room, 3);
      const cap = s.caption ? wrapText(s.caption, theme.size.caption - 0.5, 400, room, 2) : [];
      const w = Math.max(widest(name, theme.size.label, 600), widest(cap, theme.size.caption - 0.5, 400)) + 2 * t.padX + (s.badge && !narrow ? measureText(s.badge, 9.5, 500, 'mono') + 12 : 0);
      const h = 2 * 12 + name.length * t.line + cap.length * t.caption + (narrow && s.badge ? t.caption : 0);
      return { width: even(clamp(w + 2, narrow ? 112 : t.min, narrow ? 132 : t.max + 60)), height: even(Math.max(58, h)) };
    }
    case 'topic': {
      const x = topicText(s);
      return { width: even(Math.max(x.width, (s.level ?? 1) === 0 ? 120 : (s.level ?? 1) < 3 ? 64 : 24)), height: even(x.height) };
    }
    default:
      return { width: 0, height: 0 };
  }
}

// ---------------------------------------------------------------- marks

/** Where text on a light or dark fill reads best. */
const inkOn = (theme: Theme, fill: string) => (contrast(theme.text, fill) >= 4.5 ? theme.text : contrast(theme.canvas, fill) > contrast(theme.text, fill) ? theme.canvas : theme.text);

export function blockMarks(s: BlockShape, b: Box, theme: Theme): JourneyMark[] {
  const m: JourneyMark[] = [];
  const heat = s.heat ? heatColors(theme, s.heat) : undefined;
  const tag = (right: number, cy: number) => {
    if (!s.heat || !heat) return;
    const w = tagWidth(s.heat.text);
    const h = BLOCK.tag.height;
    m.push({ t: 'rect', x: right - w, y: cy - h / 2, w, h, r: Math.min(4, theme.radius.chip), fill: heat.tag, name: `Value: ${s.heat.text}` });
    m.push({ t: 'text', x: right - w, y: cy - h / 2, w, lines: [s.heat.text], size: BLOCK.tag.size, weight: 600, fill: heat.tagInk, align: 'c', lh: h, mono: true });
  };
  const systems = (x: number, y: number, w: number, ink: string) => {
    const sys = systemLines(s);
    if (sys.length) m.push({ t: 'text', x, y: y + 2, w, lines: sys, size: BLOCK.system.size, weight: 400, fill: ink, align: 'l', lh: BLOCK.system.line, mono: true });
  };
  const pattern = (x: number, y: number, w: number, h: number, kind: 'hatch' | 'cross' | 'dots', color: string, r = 0) => m.push(...patternMarks(x, y, w, h, kind, color, r));

  switch (s.form) {
    case 'area': {
      const a = BLOCK.area;
      const tint = paperTint(theme, 0) ?? theme.tones.slate.wash;
      const line = groupLine(theme, theme.tones.slate) ?? theme.border;
      const fill = !s.container && heat ? heat.fill : tint;
      m.push({ t: 'rect', x: b.x, y: b.y, w: b.width, h: b.height, r: theme.radius.group, fill, stroke: line, sw: theme.stroke.group, name: s.label });
      if (!s.container && heat && s.heat?.pattern) pattern(b.x, b.y, b.width, b.height, s.heat.pattern, heat.line, theme.radius.group);
      const name = areaName(s, theme, b.width - 2 * a.padX - tagRoom(s));
      m.push({ t: 'text', x: b.x + a.padX, y: b.y + a.top, w: b.width - 2 * a.padX - tagRoom(s), lines: name.lines, size: name.size, weight: 600, fill: !s.container && heat ? heat.ink : theme.text, align: 'l', lh: a.line, tracking: name.tracking });
      tag(b.x + b.width - a.padX, b.y + a.top + a.line / 2);
      if (!s.container) systems(b.x + a.padX, b.y + a.top + name.lines.length * a.line, b.width - 2 * a.padX, theme.textMuted);
      break;
    }
    case 'capability': {
      const c = BLOCK.capability;
      const leafHeat = !s.container && heat;
      // Without a value on a heatmap: the paper tint of the key's "No value", as a chip without one.
      const fill = leafHeat ? heat.fill : s.blank ? (paperTint(theme, 1) ?? theme.tones.slate.bg) : theme.surface;
      m.push({ t: 'rect', x: b.x, y: b.y, w: b.width, h: b.height, r: theme.radius.card, fill, stroke: leafHeat ? mix(heat.tag, heat.fill, 0.45) : theme.border, sw: theme.stroke.card, name: s.label });
      if (leafHeat && s.heat?.pattern) pattern(b.x, b.y, b.width, b.height, s.heat.pattern, heat.line, theme.radius.card);
      const room = b.width - 2 * c.padX - tagRoom(s);
      const lines = capName(s, theme, room);
      const ink = leafHeat ? heat.ink : theme.text;
      // A capability on its own sits in the middle of its box; one that holds chips names them from the top.
      const textH = lines.length * c.line + (s.container ? 0 : systemLines(s).length * BLOCK.system.line + (s.lines?.length ? 4 : 0));
      const y = s.container ? b.y + c.top : b.y + Math.max(c.top, (b.height - textH) / 2);
      m.push({ t: 'text', x: b.x + c.padX, y, w: room, lines, size: theme.size.label - 1, weight: 600, fill: ink, align: 'l', lh: c.line });
      tag(b.x + b.width - c.padX, y + c.line / 2);
      if (!s.container) systems(b.x + c.padX, y + lines.length * c.line, b.width - 2 * c.padX, leafHeat ? ink : theme.textMuted);
      break;
    }
    case 'chip': {
      const c = BLOCK.chip;
      const fill = heat ? heat.fill : (paperTint(theme, 1) ?? theme.tones.slate.bg);
      const r = Math.min(theme.radius.card, 5);
      m.push({ t: 'rect', x: b.x, y: b.y, w: b.width, h: b.height, r, fill, ...(heat ? { stroke: mix(heat.tag, heat.fill, 0.35), sw: 0.8 } : {}), name: s.label });
      if (heat && s.heat?.pattern) pattern(b.x, b.y, b.width, b.height, s.heat.pattern, heat.line, r);
      const room = b.width - 2 * c.padX - tagRoom(s);
      const lines = chipName(s, room);
      const sys = systemLines(s);
      const textH = lines.length * c.line + (sys.length ? sys.length * BLOCK.system.line + 4 : 0);
      const y = b.y + Math.max(c.padY, (b.height - textH) / 2);
      m.push({ t: 'text', x: b.x + c.padX, y, w: room, lines, size: c.size, weight: 500, fill: heat ? heat.ink : theme.text, align: 'l', lh: c.line });
      tag(b.x + b.width - c.padX + 3, y + c.line / 2);
      systems(b.x + c.padX, y + lines.length * c.line, b.width - 2 * c.padX, heat ? heat.ink : theme.textMuted);
      break;
    }
    case 'person':
      m.push(...personMarks(s, b, theme));
      break;
    case 'stream':
    case 'platform':
    case 'enabling':
    case 'subsystem':
      m.push(...teamMarks(s, b, theme));
      break;
    case 'collaboration':
    case 'service':
    case 'facilitating':
      m.push(...zoneMarks(s, b, theme));
      break;
    case 'topic':
      m.push(...topicMarks(s, b, theme));
      break;
    case 'flow': {
      // The flow of change: a long arrow, its name in it.
      const fg = theme.tones.slate.fg;
      const fill = mix(fg, theme.surface, theme.mode === 'dark' ? 0.22 : 0.1);
      const h = b.height;
      const head = Math.min(h * 0.9, 18);
      const x1 = b.x + b.width;
      m.push({ t: 'path', d: [['M', b.x, b.y], ['L', x1 - head, b.y], ['L', x1, b.y + h / 2], ['L', x1 - head, b.y + h], ['L', b.x, b.y + h], ['Z']], fill, stroke: mix(fg, theme.surface, 0.5), sw: 0.8, name: s.label });
      const g = groupLabel(theme, s.label);
      m.push({ t: 'text', x: b.x + 10, y: b.y, w: b.width - head - 20, lines: [g.text], size: g.size - 1, weight: 600, fill: theme.textMuted, align: 'l', lh: h, tracking: g.tracking });
      break;
    }
  }
  return m;
}

function topicMarks(s: BlockShape, b: Box, theme: Theme): JourneyMark[] {
  const m: JourneyMark[] = [];
  const level = s.level ?? 1;
  const tone = theme.tones[s.tone];
  const x = topicText(s);
  const t = x.t;
  const dark = theme.mode === 'dark';
  // The centre in ink, a branch in its colour's tint, a topic outlined in it, deeper ones as words.
  const fill = level === 0 ? theme.text : level === 1 ? mix(tone.fg, theme.surface, dark ? 0.26 : 0.14) : level === 2 ? theme.surface : undefined;
  const stroke = level === 1 ? mix(tone.fg, theme.surface, dark ? 0.7 : 0.5) : level === 2 ? mix(tone.fg, theme.surface, dark ? 0.55 : 0.4) : undefined;
  if (fill) m.push({ t: 'rect', x: b.x, y: b.y, w: b.width, h: b.height, r: level === 0 ? Math.max(theme.radius.card, 10) : theme.radius.card, fill, ...(stroke ? { stroke, sw: level === 1 ? 1.2 : 1 } : {}), shadow: level === 0, name: s.label });
  else m.push({ t: 'rect', x: b.x, y: b.y, w: b.width, h: b.height, name: s.label });
  const ink = level === 0 ? theme.canvas : theme.text;
  const textH = x.name.length * t.line + x.note.length * x.noteLine + (x.note.length ? 2 : 0);
  let y = b.y + (b.height - textH) / 2;
  const left = b.x + t.padX + x.iconRoom;
  const room = b.width - 2 * t.padX - x.iconRoom - x.badgeRoom;
  if (s.icon) m.push({ t: 'icon', name: s.icon, x: b.x + t.padX, y: y + (t.line - t.icon) / 2, size: t.icon, color: level === 0 ? theme.canvas : tone.fg, sw: 1.75 });
  m.push({ t: 'text', x: left, y, w: room, lines: x.name, size: t.size, weight: t.weight as 400 | 500 | 600, fill: ink, align: 'l', lh: t.line });
  if (s.badge) m.push({ t: 'text', x: b.x + b.width - t.padX - x.badgeRoom + 6, y, w: x.badgeRoom - 6, lines: [s.badge], size: 10, weight: 600, fill: level === 0 ? mix(theme.canvas, theme.text, 0.7) : tone.fg, align: 'r', lh: t.line });
  y += x.name.length * t.line + 2;
  if (x.note.length) m.push({ t: 'text', x: left, y, w: Math.max(room, b.width - 2 * t.padX - x.iconRoom), lines: x.note, size: t.note, weight: 400, fill: level === 0 ? mix(theme.canvas, theme.text, 0.75) : theme.textMuted, align: 'l', lh: x.noteLine });
  return m;
}

function personMarks(s: BlockShape, b: Box, theme: Theme): JourneyMark[] {
  const p = BLOCK.person;
  const m: JourneyMark[] = [];
  const tone = theme.tones[s.tone];
  m.push({ t: 'rect', x: b.x, y: b.y, w: b.width, h: b.height, r: theme.radius.card, fill: s.vacant ? theme.canvas : theme.surface, stroke: s.vacant ? theme.textFaint : theme.border, sw: theme.stroke.card, dash: !!s.vacant, shadow: !s.vacant, name: s.label });
  // A thin rule in the department's colour along the top: who belongs where, at a glance and in print.
  if (!s.vacant) m.push({ t: 'rect', x: b.x + theme.radius.card / 2, y: b.y, w: b.width - theme.radius.card, h: 2.5, fill: tone.fg, name: 'Department' });
  const room = b.width - 2 * p.padX - p.disc - p.gap;
  const name = wrapText(s.label, theme.size.label - 1, 600, room, 2);
  const role = s.caption ? wrapText(s.caption, theme.size.caption - 0.5, 400, room, 2) : [];
  const extra = s.lines?.length ? [s.lines.join(' · ')] : [];
  const textH = name.length * p.name + role.length * p.role + extra.length * p.caption;
  const cx = b.x + p.padX + p.disc / 2;
  const cy = b.y + b.height / 2;
  if (s.vacant) m.push({ t: 'circle', cx, cy, r: p.disc / 2 - 0.5, stroke: theme.textFaint, sw: 1, fill: theme.canvas }, { t: 'icon', name: 'user', x: cx - 8, y: cy - 8, size: 16, color: theme.textFaint, sw: 1.5 });
  else {
    m.push({ t: 'circle', cx, cy, r: p.disc / 2, fill: tone.bg, stroke: mix(tone.fg, tone.bg, 0.35), sw: 1 });
    m.push({ t: 'text', x: cx - p.disc / 2, y: cy - 8, w: p.disc, lines: [s.initials ?? ''], size: 11, weight: 600, fill: tone.fg, align: 'c', lh: 16 });
  }
  const x = b.x + p.padX + p.disc + p.gap;
  let y = b.y + (b.height - textH) / 2;
  m.push({ t: 'text', x, y, w: room, lines: name, size: theme.size.label - 1, weight: 600, fill: s.vacant ? theme.textMuted : theme.text, align: 'l', lh: p.name });
  y += name.length * p.name;
  if (role.length) m.push({ t: 'text', x, y, w: room, lines: role, size: theme.size.caption - 0.5, weight: 400, fill: theme.textMuted, align: 'l', lh: p.role });
  y += role.length * p.role;
  if (extra.length) m.push({ t: 'text', x, y, w: room, lines: [fitTo(extra[0]!, 9.5, room)], size: 9.5, weight: 400, fill: theme.textFaint, align: 'l', lh: p.caption, mono: true });
  return m;
}

const fitTo = (text: string, size: number, width: number) => {
  if (measureText(text, size, 400, 'mono') <= width) return text;
  let t = text;
  while (t.length > 1 && measureText(`${t}…`, size, 400, 'mono') > width) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
};

/** A team's colours: a clear tint of the book's colour, its outline in the colour itself. */
export function teamColors(theme: Theme, form: BlockForm) {
  const fg = theme.tones[TEAM_TONES[form] ?? 'slate'].fg;
  const dark = theme.mode === 'dark';
  return { fill: mix(fg, theme.surface, dark ? 0.24 : 0.17), line: mix(fg, theme.surface, dark ? 0.75 : 0.62), fg };
}

/** The outline of a team type. */
export function teamOutline(form: BlockForm, x: number, y: number, w: number, h: number): JourneySeg[] | { r: number } {
  if (form === 'subsystem') {
    const c = Math.min(14, h / 3.2, w / 4);
    return [['M', x + c, y], ['L', x + w - c, y], ['L', x + w, y + c], ['L', x + w, y + h - c], ['L', x + w - c, y + h], ['L', x + c, y + h], ['L', x, y + h - c], ['L', x, y + c], ['Z']];
  }
  if (form === 'platform') return { r: Math.min(4, h / 4) };
  if (form === 'enabling') return { r: Math.min(w / 4, 18) };
  return { r: Math.min(h / 3.5, 16) };
}

function teamMarks(s: BlockShape, b: Box, theme: Theme): JourneyMark[] {
  const t = BLOCK.team;
  const m: JourneyMark[] = [];
  const c = teamColors(theme, s.form);
  const outline = teamOutline(s.form, b.x, b.y, b.width, b.height);
  if (Array.isArray(outline)) m.push({ t: 'path', d: outline, fill: c.fill, stroke: c.line, sw: 1.4, name: s.label });
  else m.push({ t: 'rect', x: b.x, y: b.y, w: b.width, h: b.height, r: outline.r, fill: c.fill, stroke: c.line, sw: 1.4, name: s.label });
  const ink = inkOn(theme, c.fill);
  const narrow = s.form === 'enabling';
  const badgeW = s.badge && !narrow ? measureText(s.badge, 9.5, 500, 'mono') + 12 : 0;
  const room = b.width - 2 * t.padX - badgeW;
  const name = wrapText(s.label, theme.size.label, 600, room, 3);
  const cap = s.caption ? wrapText(s.caption, theme.size.caption - 0.5, 400, room, 2) : [];
  const textH = name.length * t.line + cap.length * t.caption;
  // A wide bar reads from its left; an upright one from its top.
  let y = narrow ? b.y + 14 : b.y + (b.height - textH) / 2;
  m.push({ t: 'text', x: b.x + t.padX, y, w: room, lines: name, size: theme.size.label, weight: 600, fill: ink, align: narrow ? 'c' : 'l', lh: t.line });
  y += name.length * t.line;
  if (cap.length) m.push({ t: 'text', x: b.x + t.padX, y, w: room, lines: cap, size: theme.size.caption - 0.5, weight: 400, fill: mix(ink, c.fill, 0.78), align: narrow ? 'c' : 'l', lh: t.caption });
  if (s.badge) {
    if (narrow) m.push({ t: 'text', x: b.x + 6, y: b.y + b.height - 12 - t.caption, w: b.width - 12, lines: [s.badge], size: 9.5, weight: 500, fill: mix(ink, c.fill, 0.7), align: 'c', lh: t.caption, mono: true });
    else m.push({ t: 'text', x: b.x + b.width - t.padX - badgeW, y: b.y + 8, w: badgeW, lines: [s.badge], size: 9.5, weight: 500, fill: mix(ink, c.fill, 0.7), align: 'r', lh: t.caption, mono: true });
  }
  return m;
}

/** How each interaction mode is filled, after the book: collaboration cross-hatched, facilitating dotted, X-as-a-Service bracketed. */
export const ZONE_NAMES: Record<'collaboration' | 'service' | 'facilitating', string> = { collaboration: 'Collaboration', service: 'X-as-a-Service', facilitating: 'Facilitating' };

function zoneMarks(s: BlockShape, b: Box, theme: Theme): JourneyMark[] {
  const m: JourneyMark[] = [];
  const fg = theme.tones[TEAM_TONES[s.form]!].fg;
  const dark = theme.mode === 'dark';
  const fill = mix(fg, theme.surface, dark ? 0.2 : 0.11);
  const ink = mix(fg, theme.surface, dark ? 0.8 : 0.7);
  const across = b.width >= b.height;
  if (s.form === 'service') {
    m.push({ t: 'rect', x: b.x, y: b.y, w: b.width, h: b.height, fill, name: s.label });
    // Brackets at both ends: one team's service, the other's to use.
    const k = Math.min(6, (across ? b.height : b.width) / 3);
    const sw = 2;
    if (across) {
      m.push({ t: 'path', d: [['M', b.x + k, b.y + 1], ['L', b.x + 1, b.y + 1], ['L', b.x + 1, b.y + b.height - 1], ['L', b.x + k, b.y + b.height - 1]], stroke: fg, sw });
      m.push({ t: 'path', d: [['M', b.x + b.width - k, b.y + 1], ['L', b.x + b.width - 1, b.y + 1], ['L', b.x + b.width - 1, b.y + b.height - 1], ['L', b.x + b.width - k, b.y + b.height - 1]], stroke: fg, sw });
    } else {
      m.push({ t: 'path', d: [['M', b.x + 1, b.y + k], ['L', b.x + 1, b.y + 1], ['L', b.x + b.width - 1, b.y + 1], ['L', b.x + b.width - 1, b.y + k]], stroke: fg, sw });
      m.push({ t: 'path', d: [['M', b.x + 1, b.y + b.height - k], ['L', b.x + 1, b.y + b.height - 1], ['L', b.x + b.width - 1, b.y + b.height - 1], ['L', b.x + b.width - 1, b.y + b.height - k]], stroke: fg, sw });
    }
  } else {
    m.push({ t: 'rect', x: b.x, y: b.y, w: b.width, h: b.height, r: 3, fill, stroke: mix(fg, theme.surface, 0.55), sw: 0.8, name: s.label });
    m.push(...patternMarks(b.x, b.y, b.width, b.height, s.form === 'collaboration' ? 'cross' : 'dots', mix(fg, fill, s.form === 'collaboration' ? 0.4 : 0.6), 3));
  }
  // The mode in words where it fits along the zone, on a plate so the pattern does not cut it.
  const words = (s.label || term(theme.lang, ZONE_NAMES[s.form as keyof typeof ZONE_NAMES])).toUpperCase();
  const tw = measureText(words, 8.5, 600, 'mono', 0.6) + 10;
  if (across && b.width >= tw + 16 && b.height >= 13) {
    const h = 13;
    m.push({ t: 'rect', x: b.x + (b.width - tw) / 2, y: b.y + (b.height - h) / 2, w: tw, h, r: 2, fill: theme.surface });
    m.push({ t: 'text', x: b.x + (b.width - tw) / 2, y: b.y + (b.height - h) / 2, w: tw, lines: [words], size: 8.5, weight: 600, fill: ink, align: 'c', lh: h, tracking: 0.6, mono: true });
  }
  return m;
}

/**
 * Lines or dots inside a box, as plain marks (so a slide gets them as shapes too): a hatch leans
 * one way, a cross both ways. Corners of a rounded box are kept clear by `r`.
 */
export function patternMarks(x: number, y: number, w: number, h: number, kind: 'hatch' | 'cross' | 'dots', color: string, r = 0): JourneyMark[] {
  const m: JourneyMark[] = [];
  const inset = Math.min(r * 0.3, 3);
  const x0 = x + inset;
  const y0 = y + inset;
  const x1 = x + w - inset;
  const y1 = y + h - inset;
  if (kind === 'dots') {
    const step = 7;
    for (let yy = y0 + step / 2, row = 0; yy < y1; yy += step, row++)
      for (let xx = x0 + step / 2 + (row % 2 ? step / 2 : 0); xx < x1; xx += step) m.push({ t: 'circle', cx: xx, cy: yy, r: 1.2, fill: color });
    return m;
  }
  const step = kind === 'cross' ? 9 : 7;
  const d: JourneySeg[] = [];
  // Lines x - y = c (falling) and x + y = c (rising), clipped to the box.
  const clip = (rising: boolean) => {
    const span = x1 - x0 + (y1 - y0);
    for (let c = step / 2; c < span; c += step) {
      // Parameterise along the box: start on the left or top edge, end on the bottom or right.
      const pts: [number, number][] = [];
      if (rising) {
        // x + y = x0 + y0 + c
        const k = x0 + y0 + c;
        const a: [number, number] = k - x0 <= y1 ? [x0, k - x0] : [k - y1, y1];
        const b: [number, number] = k - y0 <= x1 ? [k - y0, y0] : [x1, k - x1];
        pts.push(a, b);
      } else {
        // x - y = x0 - y1 + c
        const k = x0 - y1 + c;
        const a: [number, number] = x0 - k >= y0 ? [x0, x0 - k] : [k + y0, y0];
        const b: [number, number] = x1 - k <= y1 ? [x1, x1 - k] : [k + y1, y1];
        pts.push(a, b);
      }
      d.push(['M', pts[0]![0], pts[0]![1]], ['L', pts[1]![0], pts[1]![1]]);
    }
  };
  clip(true);
  if (kind === 'cross') clip(false);
  m.push({ t: 'path', d, stroke: color, sw: 0.8 });
  return m;
}

/** A legend sample of a block, 20 by 14 around (x0, cy). */
export function blockSample(form: BlockForm, theme: Theme, x0: number, cy: number, heat?: BlockHeat): JourneyMark[] {
  if (heat) {
    const c = heatColors(theme, heat);
    const m: JourneyMark[] = [{ t: 'rect', x: x0, y: cy - 7, w: 20, h: 14, r: 3, fill: c.fill, stroke: c.tag, sw: 0.8 }];
    if (heat.pattern) m.push(...patternMarks(x0, cy - 7, 20, 14, heat.pattern, c.line, 3));
    return m;
  }
  if (isZone(form)) return zoneMarks({ kind: 'block', form, label: ' ', tone: 'slate' }, { x: x0, y: cy - 7, width: 20, height: 14 }, theme);
  if (isTeam(form)) {
    const box = form === 'enabling' ? { x: x0 + 5, y: cy - 9, width: 10, height: 18 } : form === 'subsystem' ? { x: x0 + 1, y: cy - 8, width: 18, height: 16 } : form === 'platform' ? { x: x0, y: cy - 5, width: 22, height: 10 } : { x: x0, y: cy - 6, width: 22, height: 12 };
    const c = teamColors(theme, form);
    const outline = teamOutline(form, box.x, box.y, box.width, box.height);
    return [Array.isArray(outline) ? { t: 'path', d: outline, fill: c.fill, stroke: c.line, sw: 1.2 } : { t: 'rect', x: box.x, y: box.y, w: box.width, h: box.height, r: Math.min(outline.r, 5), fill: c.fill, stroke: c.line, sw: 1.2 }];
  }
  if (form === 'person') return [{ t: 'rect', x: x0, y: cy - 7, w: 20, h: 14, r: 3, fill: theme.canvas, stroke: theme.textFaint, sw: 1, dash: true }];
  return [{ t: 'rect', x: x0, y: cy - 7, w: 20, h: 14, r: 3, fill: paperTint(theme, 1) ?? theme.tones.slate.bg }];
}
