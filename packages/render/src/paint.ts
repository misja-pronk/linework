// The pieces every drawer shares, drawn the way the theme asks: icon tiles, step numbers, line
// corners, dashes and arrowheads, the ground behind a label, chips. One place, so the graph renderer,
// sequence, git, roadmap and matrix drawings all follow the same look.
import type { LinePattern, Marker, Point } from '@cartography/core';
import { icon } from '@cartography/icons';
import { baselineOffset, look, mix, type Theme, type ToneColors } from '@cartography/theme';

/** Text and double-quoted attributes of a drawing (every drawer's one escape). An apostrophe stays as it is: no attribute here is single-quoted, and font stacks keep reading as written. */
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const r1 = (n: number) => Math.round(n * 10) / 10;

/** The attribute that sets a text in the theme's monospace face. */
export const monoAttr = (theme: Theme) => ` font-family="${esc(theme.font.mono)}"`;

/** A line icon at x, y in the given size and colour; the stroke keeps its visual weight whatever the size. */
export function glyph(name: string | undefined, x: number, y: number, size: number, color: string, stroke: number): string {
  const markup = name ? icon(name) : undefined;
  if (!markup) return '';
  const s = size / 24;
  return `<g transform="translate(${r1(x)} ${r1(y)}) scale(${s})" fill="none" stroke="${color}" stroke-width="${r1(stroke / s)}" stroke-linecap="round" stroke-linejoin="round">${markup}</g>`;
}

/** An image from a BYO pack or a logo, scaled into the box without stretching. */
export function image(href: string, x: number, y: number, w: number, h: number): string {
  return `<image href="${esc(href)}" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" preserveAspectRatio="xMidYMid meet"/>`;
}

/** Behind official icons: a neutral tile, never the tone, because their colours are the vendor's. */
export const neutralTile = (theme: Theme) => (theme.mode === 'dark' ? '#E9ECF1' : '#F3F5F8');

export interface TileSpec {
  /** Top-left of the square slot the tile sits in. */
  x: number;
  y: number;
  slot: number;
  tone: ToneColors;
  icon?: string;
  /** Corner radius of a square tile; the theme's by default. */
  rx?: number;
  /** A round tile (people, terminals), whatever the theme's corners. */
  round?: boolean;
  /** A greyed element: the tile steps back. */
  muted?: boolean;
  /** An official icon as a data URI, drawn instead of the line icon. */
  image?: string;
  /** Icon size, when the slot is not a card's. */
  iconSize?: number;
}

/**
 * An icon in its slot, in the theme's tile style: on a soft tint, a solid tone or an outlined
 * square; bare; or on a filled roundel or in a ring.
 */
export function iconTile(theme: Theme, t: TileSpec): string {
  const lk = look(theme);
  const style = lk.tile;
  const cx = t.x + t.slot / 2;
  const cy = t.y + t.slot / 2;
  const circle = t.round || style === 'disc' || style === 'ring';
  const rx = circle ? t.slot / 2 : (t.rx ?? theme.radius.tile);
  if (t.image) {
    // Vendor icons keep their colours. On white paper they need no tile; elsewhere a neutral one keeps them readable.
    if (style === 'bare' && theme.mode === 'light') return image(t.image, t.x + 3, t.y + 3, t.slot - 6, t.slot - 6);
    return `<rect x="${r1(t.x)}" y="${r1(t.y)}" width="${t.slot}" height="${t.slot}" rx="${r1(rx)}" fill="${neutralTile(theme)}"/>` + image(t.image, t.x + 5, t.y + 5, t.slot - 10, t.slot - 10);
  }
  if (!t.icon) return '';
  const size = t.iconSize ?? Math.round((lk.iconSize * t.slot) / 34);
  const at = (color: string) => glyph(t.icon, cx - size / 2, cy - size / 2, size, color, theme.stroke.icon);
  if (style === 'bare') return at(t.tone.fg);
  if (style === 'disc' && !t.muted) return `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(t.slot / 2)}" fill="${t.tone.fg}"/>` + at(theme.surface);
  if (style === 'disc' || style === 'ring') return `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(t.slot / 2 - 0.75)}" fill="${theme.surface}" stroke="${t.tone.fg}" stroke-width="1.5"/>` + at(t.tone.fg);
  // Solid tiles carry the tone with a light icon; outline tiles print well; soft is a tint.
  const fill = t.muted ? theme.surface : style === 'solid' ? t.tone.fg : style === 'outline' ? theme.surface : t.tone.bg;
  const stroke = style === 'outline' ? ` stroke="${t.tone.line}" stroke-width="1"` : '';
  const inset = style === 'outline' ? 0.5 : 0;
  return `<rect x="${r1(t.x + inset)}" y="${r1(t.y + inset)}" width="${t.slot - 2 * inset}" height="${t.slot - 2 * inset}" rx="${r1(rx)}" fill="${fill}"${stroke}/>` + at(style === 'solid' && !t.muted ? theme.surface : t.tone.fg);
}

/** The tile of a decision: a square on its point, the flow-chart sign for a question, in the theme's tile style. */
export function diamondTile(theme: Theme, tone: ToneColors, cx: number, cy: number, name: string | undefined, side = 26): string {
  const style = look(theme).tile;
  const box = (attrs: string) => `<rect x="${r1(cx - side / 2)}" y="${r1(cy - side / 2)}" width="${side}" height="${side}" rx="${Math.min(6, theme.radius.tile)}" ${attrs} transform="rotate(45 ${r1(cx)} ${r1(cy)})"/>`;
  const at = (color: string) => glyph(name, cx - 8, cy - 8, 16, color, theme.stroke.icon);
  if (style === 'solid' || style === 'disc') return box(`fill="${tone.fg}"`) + at(theme.surface);
  if (style === 'soft') return box(`fill="${tone.bg}"`) + at(tone.fg);
  // Bare, ring and outline tiles: the diamond is a thin line around the icon.
  return box(`fill="${theme.surface}" stroke="${style === 'outline' ? tone.line : tone.fg}" stroke-opacity="${style === 'outline' ? 1 : 0.55}" stroke-width="1.2"`) + at(tone.fg);
}

/** A step number: solid in the accent (or the given tone), solid in ink, or a ring. The same on a line and in a list. */
export function numberMark(theme: Theme, cx: number, cy: number, n: number | string, r = 9, tone?: string, size = 10.5): string {
  const style = look(theme).number;
  const label = (fill: string) => `<text x="${r1(cx)}" y="${r1(cy + baselineOffset(size))}" font-size="${size}" font-weight="600" fill="${fill}" text-anchor="middle">${esc(String(n))}</text>`;
  if (style === 'ring') return `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r - 0.6)}" fill="${theme.surface}" stroke="${theme.text}" stroke-width="1.2"/>` + label(theme.text);
  if (style === 'ink') return `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r}" fill="${theme.text}"/>` + label(theme.canvas);
  return `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r}" fill="${tone ?? theme.accent ?? theme.tones.blue.fg}"/>` + label(theme.surface);
}

/** Orthogonal polyline whose bends are rounded, cut at 45 degrees, or square. */
export function linePath(pts: Point[], radius: number, corner: 'round' | 'chamfer' | 'square' = 'round'): string {
  if (pts.length < 2) return '';
  let d = `M${r1(pts[0]!.x)} ${r1(pts[0]!.y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1]!;
    const c = pts[i]!;
    const n = pts[i + 1]!;
    const l1 = Math.hypot(c.x - p.x, c.y - p.y);
    const l2 = Math.hypot(n.x - c.x, n.y - c.y);
    const r = corner === 'square' ? 0 : Math.min(radius, l1 / 2, l2 / 2);
    if (r < 0.5) {
      d += `L${r1(c.x)} ${r1(c.y)}`;
      continue;
    }
    const a = { x: c.x - ((c.x - p.x) / l1) * r, y: c.y - ((c.y - p.y) / l1) * r };
    const b = { x: c.x + ((n.x - c.x) / l2) * r, y: c.y + ((n.y - c.y) / l2) * r };
    d += corner === 'chamfer' ? `L${r1(a.x)} ${r1(a.y)}L${r1(b.x)} ${r1(b.y)}` : `L${r1(a.x)} ${r1(a.y)}Q${r1(c.x)} ${r1(c.y)} ${r1(b.x)} ${r1(b.y)}`;
  }
  const last = pts[pts.length - 1]!;
  return d + `L${r1(last.x)} ${r1(last.y)}`;
}

/** A line's path with the theme's bends. */
export const themedPath = (pts: Point[], theme: Theme) => linePath(pts, theme.radius.corner, look(theme).line.corner);

/** The stroke-dasharray attribute of a dashed or dotted line; where the theme asks, dashes grow with the weight. */
export function dashAttr(line: 'solid' | 'dashed' | 'dotted' | undefined, width: number, theme: Theme): string {
  if (line !== 'dashed' && line !== 'dotted') return '';
  const k = look(theme).line.dashScale ? Math.max(1, width / 1.4) : 1;
  // Round caps add the line's width to every dash: a dot stays a dot by shrinking its dash as the line thickens.
  return line === 'dashed' ? ` stroke-dasharray="${r1(6 * k)} ${r1(4 * k)}"` : ` stroke-dasharray="${r1(k > 1 ? Math.max(0.1, 1.5 * k - width) : 1.5)} ${r1(3.5 * k)}"`;
}

/**
 * The second mark of a line style over its stroke `d`: short ticks across it, beads on it, or a
 * double line (a light core in a wider stroke). Drawn on top of the line, in its colour. Ticks and
 * beads are small and sparse: enough to tell two lines apart in grey, never louder than the line.
 */
export function patternOver(pattern: LinePattern | undefined, d: string, color: string, width: number, theme: Theme, dash = ''): string {
  if (!pattern) return '';
  if (pattern === 'ticks') return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${r1(width + 3.2)}" stroke-dasharray="1.1 15" stroke-dashoffset="-7"/>`;
  if (pattern === 'beads') return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${r1(width + 2)}" stroke-dasharray="0.01 16" stroke-dashoffset="-7" stroke-linecap="round"/>`;
  return `<path d="${d}" fill="none" stroke="${theme.surface}" stroke-width="${r1(Math.max(1, width * 0.4))}" stroke-linejoin="round"${dash}/>`;
}

/** A double line is drawn wider, so its light core leaves a line of colour on each side. */
export const patternWidth = (pattern: LinePattern | undefined, width: number) => (pattern === 'double' ? Math.max(width * 2.4, 3.2) : width);

/** How far a line stops short of its arrowhead's tip, so it does not poke through. */
export function arrowBack(theme: Theme): number {
  const l = look(theme).line;
  return l.arrow === 'open' ? 0 : 5 * l.arrowScale;
}

/** An arrowhead at `tip`, pointing away from `from`: filled with a concave back, a slim triangle, or two open strokes. */
export function arrowHead(tip: Point, from: Point, color: string, theme: Theme, strokeWidth = theme.stroke.edge): string {
  const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const d = { x: (tip.x - from.x) / len, y: (tip.y - from.y) / len };
  const n = { x: -d.y, y: d.x };
  const l = look(theme).line;
  const k = l.arrowScale;
  const P = (back: number, side = 0) => `${r1(tip.x - d.x * back * k + n.x * side * k)} ${r1(tip.y - d.y * back * k + n.y * side * k)}`;
  if (l.arrow === 'open') return `<path d="M${P(8, -4.2)}L${P(0)}L${P(8, 4.2)}" fill="none" stroke="${color}" stroke-width="${r1(strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (l.arrow === 'slim') return `<path d="M${P(11, -3.4)}L${P(0)}L${P(11, 3.4)}Z" fill="${color}"/>`;
  return `<path d="M${P(9, -4.5)}L${P(0)}L${P(9, 4.5)}Q${P(7)} ${P(9, -4.5)}Z" fill="${color}" stroke="${color}" stroke-width="1" stroke-linejoin="round"/>`;
}

/** Where lines join: a filled dot, or a ring with the card colour inside. */
export function junctionMark(at: Point, color: string, theme: Theme): string {
  const l = look(theme).line;
  return l.junction === 'ring'
    ? `<circle cx="${r1(at.x)}" cy="${r1(at.y)}" r="${l.junctionSize}" fill="${theme.surface}" stroke="${color}" stroke-width="${theme.stroke.edge}"/>`
    : `<circle cx="${r1(at.x)}" cy="${r1(at.y)}" r="${l.junctionSize}" fill="${color}"/>`;
}

/**
 * What sits behind a label on a line: a pill, a bordered plate, or (halo) a borderless patch in the
 * colour of the ground the label lies on, so the words sit in a gap in the line.
 */
export function labelBack(theme: Theme, b: { x: number; y: number; width: number; height: number }, ground: string): string {
  const style = look(theme).edgeLabel.style;
  if (style === 'halo') return `<rect x="${r1(b.x + 2)}" y="${r1(b.y + 2)}" width="${r1(b.width - 4)}" height="${r1(b.height - 4)}" rx="2" fill="${ground}"/>`;
  if (style === 'plate') return `<rect x="${r1(b.x)}" y="${r1(b.y + 1)}" width="${r1(b.width)}" height="${r1(b.height - 2)}" rx="${theme.radius.chip}" fill="${theme.surface}" stroke="${theme.border}" stroke-width="1"/>`;
  return `<rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.width)}" height="${r1(b.height)}" rx="${r1(b.height / 2)}" fill="${theme.surface}" stroke="${theme.border}" stroke-width="1"/>`;
}

/** Ink of a label on a line: muted, text, or the line's own colour. */
export function labelInk(theme: Theme, lineColor?: string): string {
  const ink = look(theme).edgeLabel.ink;
  return ink === 'text' ? theme.text : ink === 'line' && lineColor ? lineColor : theme.textMuted;
}

/** Extra attributes of a label on a line: the monospace face and the tracking of capitals. */
export function labelAttrs(theme: Theme): string {
  const l = look(theme).edgeLabel;
  return (l.mono ? monoAttr(theme) : '') + (l.tracking ? ` letter-spacing="${l.tracking}"` : '');
}

/** A label on a line as written, or in capitals. */
export const labelString = (theme: Theme, s: string) => (look(theme).edgeLabel.caps ? s.toUpperCase() : s);

/** The box of a chip: filled with the tone's tint, or outlined. */
export function chipBack(theme: Theme, x: number, y: number, w: number, h: number, tone: ToneColors, rx = theme.radius.chip): string {
  return look(theme).chip === 'outline'
    ? `<rect x="${r1(x + 0.5)}" y="${r1(y + 0.5)}" width="${r1(w - 1)}" height="${r1(h - 1)}" rx="${rx}" fill="${theme.surface}" stroke="${mix(tone.fg, theme.surface, 0.45)}" stroke-width="1"/>`
    : `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${rx}" fill="${tone.bg}"/>`;
}

/** Rounding of a small filled tag (a status, a role, a lane name): fully round where the theme's labels are pills, else like a chip. */
export const tagRadius = (theme: Theme, height: number) => (look(theme).edgeLabel.style === 'pill' ? height / 2 : Math.min(height / 2, theme.radius.chip + 1));

/** A filled band whose top corners follow a card's rounding: the header of a table or a matrix. */
export function topBand(x: number, y: number, w: number, h: number, r: number, fill: string): string {
  return `<path d="M${r1(x)} ${r1(y + h)}V${r1(y + r)}Q${r1(x)} ${r1(y)} ${r1(x + r)} ${r1(y)}H${r1(x + w - r)}Q${r1(x + w)} ${r1(y)} ${r1(x + w)} ${r1(y + r)}V${r1(y + h)}Z" fill="${fill}"/>`;
}

/** Outline colour of a card: the border, or a soft version of its tone. */
export const cardStroke = (theme: Theme, tone: ToneColors) => (look(theme).cardLine === 'tone' ? mix(tone.fg, theme.surface, 0.55) : theme.border);

/** The shadow filter attribute; nothing on a theme without shadows, so flat looks stay crisp in every renderer. */
export const shadowAttr = (theme: Theme, filterId: string) => (theme.shadow.opacity > 0 ? ` filter="url(#${filterId})"` : '');

/** Arrowheads and crow's-foot ends, drawn at `tip` pointing away from `from`. */
export function endMarker(kind: Marker, tip: Point, from: Point, color: string, theme: Theme): string {
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
      return arrowHead(tip, from, color, theme);
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
    case 'slash':
      // A default flow: a short stroke across the line, just past where it leaves.
      return `<path d="M${P(at(12, -5))}L${P(at(6, 5))}" stroke="${color}" stroke-width="${r1(theme.stroke.edge * 1.2)}" stroke-linecap="round" fill="none"/>`;
    default: {
      // UML ends: filled with the card colour so the line under them does not show through.
      const u = umlEnd(kind);
      const pts = u.points.map(([back, side]) => P(at(back, side)));
      const fill = u.filled ? color : u.closed ? theme.surface : 'none';
      return `<path d="M${pts.join('L')}${u.closed ? 'Z' : ''}" fill="${fill}" stroke="${color}" stroke-width="${r1(theme.stroke.edge)}" stroke-linejoin="${u.closed ? 'miter' : 'round'}" stroke-linecap="round"/>`;
    }
  }
}

/**
 * The outline of a UML end as [back from the tip, aside] pairs: a hollow triangle (generalization),
 * a diamond (hollow: aggregation, filled: composition), an open arrowhead (navigability). Shared by
 * the SVG and the slide writer, so both draw the same marks.
 */
export function umlEnd(kind: 'triangle' | 'diamond' | 'filledDiamond' | 'open'): { points: [number, number][]; closed: boolean; filled: boolean } {
  if (kind === 'triangle') return { points: [[0, 0], [13, -7.5], [13, 7.5]], closed: true, filled: false };
  if (kind === 'open') return { points: [[10, -6], [0, 0], [10, 6]], closed: false, filled: false };
  return { points: [[0, 0], [8, -5.5], [16, 0], [8, 5.5]], closed: true, filled: kind === 'filledDiamond' };
}
