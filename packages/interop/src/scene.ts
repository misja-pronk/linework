// A drawing as plain positioned pieces, in page pixels: what the draw.io and Excalidraw files are
// written from. The geometry is the one render/svg.ts draws (and export/slide.ts repeats for
// PowerPoint): the same boxes, insets and colours, so the file opens looking like the picture.
// An element is one thing a person moves: its body (the editable shape), the picture and small
// parts that go with it. A connector is a line bound to the elements it joins.
import { chips, type BlockShape, type Box, type CardShape, type FlowShape, type Chip, type Graph, type GraphEdge, type GraphGroup, type GraphNode, type JourneyShape, type LegendItem, type Marker, type MatrixCell, type MatrixShape, type Placed, type Point, type SequenceShape, type TableShape } from '@cartography/core';
import { icon } from '@cartography/icons';
import { kinds as sequenceKinds } from '@cartography/sequence';
import { besideShortLine, blockMarks, joinDot, BODY, bodyLines, byDepth, cardCaption, cardInsets, cardStroke, CHIP, chipRows, DECISION_TIP, flowMarks, groundOf, groupIconRoom, journeyScene, keyLayout, labelInk, labelString, laneHeader, laneMarks, LEGEND, legendItems, markWidth, MATRIX, matrixGeometry, rowMarks, sequenceGeometry, sheetPad, split, STACK, tableHeader, tagRadius, toOutline, type Ground, type JourneyMark } from '@cartography/render';
import { chipText, fitText, groupCaptionInk, groupFill, groupLabel, groupLabelInk, groupLine, look, measureText, mix, monoCell, paperTint, themeTextFonts, withTextFonts, type TextFonts, type Theme, type ToneColors } from '@cartography/theme';

/** What the engine's `render` returns; only what is drawn from is asked for. */
export interface Drawn {
  svg?: string;
  width?: number;
  height?: number;
  origin?: Point;
  graph?: Graph;
  placed?: Placed;
  theme?: Theme;
  type?: { id: string };
  view?: string;
}

export interface Run {
  text: string;
  size: number;
  weight: 400 | 500 | 600;
  color: string;
  mono?: boolean;
  /** Letter-spacing in px. */
  tracking?: number;
}

/** Text inside a shape: lines of runs, and where they sit in the box. */
export interface Label {
  lines: Run[][];
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle';
  inset: { left: number; right: number; top: number; bottom: number };
}

export interface Paint {
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  strokeOpacity?: number;
  strokeWidth?: number;
  dash?: 'dashed' | 'dotted';
}

/** A box: a rounded rectangle, an ellipse, a hexagon with pointed ends (a decision) or a square on its point. */
export interface Rect extends Paint {
  t: 'rect';
  name: string;
  box: Box;
  radius: number;
  outline: 'rect' | 'ellipse' | 'hexagon' | 'diamond';
  label?: Label;
  /** What it stands for, read back by the importer (a badge is a connection). */
  data?: Record<string, string>;
}

/** Loose words: `box` is the measured text, `anchor` the side that stays put when the words change. */
export interface Text {
  t: 'text';
  name: string;
  box: Box;
  lines: Run[][];
  anchor: 'start' | 'middle' | 'end';
}

export interface Picture {
  t: 'image';
  name: string;
  box: Box;
  /** A whole SVG document. */
  svg: string;
}

/** A line that joins nothing: a rule, a lifeline, a legend sample. */
export interface Stroke {
  t: 'line';
  name: string;
  points: Point[];
  color: string;
  opacity?: number;
  width: number;
  dash?: 'dashed' | 'dotted';
  start: Marker;
  end: Marker;
}

export type Part = Rect | Text | Picture | Stroke;

export interface Element {
  /** Unique in the scene: node:web, group:prod, row:orders:id. */
  id: string;
  role: 'group' | 'node' | 'table' | 'row' | 'block';
  /** The element it lies in and moves with: a group, or the table of a row. */
  parent?: string;
  body: Rect;
  /** The icon in its tile, as one picture inside the body. */
  icon?: Picture;
  /** Drawn behind the body (the second card of a stacked pair). */
  under: Part[];
  /** Drawn on the body and moving with it: chips, marks, rules. */
  parts: Part[];
  /** What it is in the diagram, for the way back in. */
  data: Record<string, string>;
}

export type ArrowStyle = 'filled' | 'slim' | 'open';

export interface Connector {
  id: string;
  /** Element ids of the two ends; absent for a line that joins nothing (a sequence message). */
  from?: string;
  to?: string;
  points: Point[];
  color: string;
  opacity?: number;
  width: number;
  dash?: 'dashed' | 'dotted';
  start: Marker;
  end: Marker;
  arrow: ArrowStyle;
  /** Radius of the bends. */
  corner: number;
  /** The words on the line, in the box the engine gave them. */
  label?: Rect;
  data: Record<string, string>;
}

/** Things on the page that belong to no element: the title, the key, junction dots. */
export interface Loose {
  id: string;
  role: 'title' | 'subtitle' | 'legend' | 'decor';
  parts: Part[];
}

export interface Scene {
  /** The page's name: the view, or the title. */
  name: string;
  type: string;
  title?: string;
  subtitle?: string;
  direction?: string;
  width: number;
  height: number;
  background: string;
  fonts: { sans: string; mono: string };
  /** The faces the text was measured in; a writer that measures again does it in these. */
  measure: TextFonts;
  elements: Element[];
  connectors: Connector[];
  /** Under the elements: lifelines, frames of a sequence. */
  back: Loose[];
  /** Over everything: title, legend, junctions. */
  loose: Loose[];
  /** The whole page as one picture, where the type has no editable mapping. */
  picture?: Picture;
  warnings: string[];
}

/** Drop repeated points and the middle of straight runs: what is left are the bends. */
export function clean(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    const prev = out.at(-2);
    if (prev && last && Math.abs((last.x - prev.x) * (p.y - last.y) - (last.y - prev.y) * (p.x - last.x)) < 0.01) out.pop();
    out.push(p);
  }
  return out;
}

/**
 * The engine lets a line's end sit a pixel beside its last bend, where the outline curves. Editors
 * with square connectors want square pieces: the end moves onto the bend's line.
 */
export function squared(points: Point[]): Point[] {
  const p = points.map((q) => ({ ...q }));
  const fix = (end: Point | undefined, next: Point | undefined) => {
    if (!end || !next) return;
    const dx = Math.abs(end.x - next.x);
    const dy = Math.abs(end.y - next.y);
    if (dx > 0 && dx < 2.5 && dy > dx) end.x = next.x;
    else if (dy > 0 && dy < 2.5 && dx > dy) end.y = next.y;
  };
  fix(p[0], p[1]);
  fix(p.at(-1), p.at(-2));
  return p;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A line icon as a standalone SVG, `size` px square. */
function iconMarkup(name: string, color: string, size: number, stroke: number, x = 0, y = 0): string {
  const markup = icon(name);
  if (!markup) return '';
  const s = size / 24;
  return `<g transform="translate(${r2(x)} ${r2(y)}) scale(${r2(s)})" fill="none" stroke="${color}" stroke-width="${r2(stroke / s)}" stroke-linecap="round" stroke-linejoin="round">${markup}</g>`;
}

const svgDoc = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${r2(w)}" height="${r2(h)}" viewBox="0 0 ${r2(w)} ${r2(h)}">${body}</svg>`;

/** Sequence, git flow, roadmap and journey are one node that draws a whole diagram. */
const WHOLE = new Set(['sequence', 'gitflow', 'roadmap', 'journey']);

/** The scene of one drawing. Types without an editable mapping come back as one picture, with a warning that says so. */
export function toScene(d: Drawn): Scene {
  if (!d.graph || !d.placed || !d.theme || !d.origin || d.width === undefined || d.height === undefined) throw new Error('Nothing drawn: the diagram has errors');
  const { graph, placed, theme, origin, width, height } = d;
  // Measured in the theme's own faces, as the engine did: the chips and wrapped lines come out the same.
  return withTextFonts(themeTextFonts(theme), () => new SceneBuilder(graph, placed, theme, origin, width, height, d).build());
}

class SceneBuilder {
  private chipsByNode: Map<string, Chip[]>;
  private ground: Ground;
  private elements: Element[] = [];
  private connectors: Connector[] = [];
  private back: Loose[] = [];
  private loose: Loose[] = [];
  private warnings: string[] = [];

  constructor(
    private graph: Graph,
    private placed: Placed,
    private theme: Theme,
    private origin: Point,
    private width: number,
    private height: number,
    private drawn: Drawn,
  ) {
    this.chipsByNode = chips(graph);
    this.ground = groundOf(graph, placed, theme);
  }

  /** Layout coordinates to page coordinates. */
  private at = (b: Box): Box => ({ x: b.x + this.origin.x, y: b.y + this.origin.y, width: b.width, height: b.height });
  private pt = (p: Point): Point => ({ x: p.x + this.origin.x, y: p.y + this.origin.y });

  build(): Scene {
    const { graph, placed, theme } = this;
    const type = this.drawn.type?.id ?? 'systems';
    const scene: Scene = {
      name: this.drawn.view ?? graph.title ?? 'Diagram',
      type,
      title: graph.title,
      subtitle: graph.subtitle,
      direction: graph.direction,
      width: this.width,
      height: this.height,
      background: theme.canvas,
      fonts: { sans: theme.font.sans ?? 'Inter', mono: theme.font.monoFace ?? firstFamily(theme.font.mono) ?? 'Courier New' },
      measure: themeTextFonts(theme),
      elements: this.elements,
      connectors: this.connectors,
      back: this.back,
      loose: this.loose,
      warnings: this.warnings,
    };
    // Git flow and roadmap have no shapes to map to: the page goes in as one picture.
    const whole = graph.nodes.find((n) => n.shape.kind === 'gitflow' || n.shape.kind === 'roadmap');
    if (whole) {
      const what = whole.shape.kind === 'gitflow' ? 'A git flow' : 'A roadmap';
      this.warnings.push(`${what} has no editable shapes in this format: exported as one picture`);
      scene.picture = { t: 'image', name: graph.title ?? what, box: { x: 0, y: 0, width: this.width, height: this.height }, svg: this.drawn.svg ?? '' };
      return scene;
    }

    for (const g of byDepth(graph.groups)) {
      const box = placed.groups.get(g.id);
      if (box) this.elements.push(g.lane ? this.lane(g, this.at(box)) : this.group(g, this.at(box)));
    }
    const badged = new Set([...this.chipsByNode.values()].flat().map((c) => c.edge));
    const edges = graph.edges.filter((e) => !badged.has(e.id) && (placed.edges.get(e.id)?.points.length ?? 0) > 1);
    for (const e of edges) this.connectors.push(this.edge(e));
    const dots = this.junctions(edges);
    if (dots.length) this.loose.push({ id: 'junctions', role: 'decor', parts: dots });

    for (const n of graph.nodes) {
      const box = placed.nodes.get(n.id);
      if (!box) continue;
      const s = n.shape;
      if (s.kind === 'card') this.elements.push(this.card(n, s, this.at(box)));
      else if (s.kind === 'table') this.table(n, s, this.at(box));
      else if (s.kind === 'matrix') this.elements.push(this.matrix(n, s, this.at(box)));
      else if (s.kind === 'sequence') this.sequence(s, this.at(box));
      else if (s.kind === 'journey') this.journey(s, this.at(box));
      else if (s.kind === 'flow') this.elements.push(this.flow(n, s, this.at(box)));
      else if (s.kind === 'block') this.elements.push(this.block(n, s, this.at(box)));
      // journey-part: drawn by the journey itself.
    }
    if (this.flowCurves) this.warnings.push(`Small drawings on process shapes (${this.flowCurves}: a document's fold, a note's bracket) are pictures: they move with the shape`);
    if (graph.steps?.length && !graph.nodes.some((n) => WHOLE.has(n.shape.kind))) this.warnings.push('The numbered list of steps under the drawing is left out');
    if (theme.titleBlock && Object.keys(theme.titleBlock).length) this.warnings.push('The brand header and footer of the theme are left out');
    this.titles();
    this.legend();
    return scene;
  }

  // ------------------------------------------------------------ small pieces

  private run(text: string, size: number, weight: 400 | 500 | 600, color: string, style: { mono?: boolean; tracking?: number } = {}): Run {
    return { text, size, weight, color, ...(style.mono ? { mono: true } : {}), ...(style.tracking ? { tracking: style.tracking } : {}) };
  }

  /** One line of text, vertically centred on cy, anchored like SVG text-anchor. */
  private text(name: string, x: number, cy: number, s: string, size: number, weight: 400 | 500 | 600, color: string, anchor: Text['anchor'] = 'start', style: { mono?: boolean; tracking?: number } = {}): Text {
    const w = measureText(s, size, weight, style.mono ? 'mono' : 'sans', style.tracking ?? 0);
    const h = Math.round(size * 1.4);
    const x0 = anchor === 'start' ? x : anchor === 'middle' ? x - w / 2 : x - w;
    return { t: 'text', name, box: { x: x0, y: cy - h / 2, width: w, height: h }, lines: [[this.run(s, size, weight, color, style)]], anchor };
  }

  private rect(name: string, box: Box, radius: number, paint: Paint, extra: Partial<Rect> = {}): Rect {
    return { t: 'rect', name, box, radius: Math.min(radius, box.width / 2, box.height / 2), outline: 'rect', ...paint, ...extra };
  }

  private line(name: string, points: Point[], color: string, width: number, extra: Partial<Stroke> = {}): Stroke {
    return { t: 'line', name, points, color, width, start: 'none', end: 'none', ...extra };
  }

  private picture(name: string, x: number, y: number, size: number, color: string, stroke: number): Picture | undefined {
    const body = iconMarkup(name, color, size, stroke);
    return body ? { t: 'image', name: `Icon ${name}`, box: { x, y, width: size, height: size }, svg: svgDoc(size, size, body) } : undefined;
  }

  /**
   * An icon in its slot, in the theme's tile style (render's iconTile), as one picture: on a soft
   * tint, a solid tone or an outlined square; bare; or on a filled roundel or in a ring.
   */
  private tile(x: number, y: number, slot: number, tone: ToneColors, name: string | undefined, o: { round?: boolean; muted?: boolean; rx?: number; iconSize?: number } = {}): Picture | undefined {
    if (!name || !icon(name)) return undefined;
    const t = this.theme;
    const lk = look(t);
    const style = lk.tile;
    const size = o.iconSize ?? Math.round((lk.iconSize * slot) / 34);
    const glyph = (color: string) => iconMarkup(name, color, size, t.stroke.icon, (slot - size) / 2, (slot - size) / 2);
    const circle = o.round || style === 'disc' || style === 'ring';
    const rx = circle ? slot / 2 : (o.rx ?? t.radius.tile);
    let body: string;
    if (style === 'bare') body = glyph(tone.fg);
    else if (style === 'disc' && !o.muted) body = `<circle cx="${slot / 2}" cy="${slot / 2}" r="${slot / 2}" fill="${tone.fg}"/>` + glyph(t.surface);
    else if (style === 'disc' || style === 'ring') body = `<circle cx="${slot / 2}" cy="${slot / 2}" r="${slot / 2 - 0.75}" fill="${t.surface}" stroke="${tone.fg}" stroke-width="1.5"/>` + glyph(tone.fg);
    else {
      const fill = o.muted ? t.surface : style === 'solid' ? tone.fg : style === 'outline' ? t.surface : tone.bg;
      const stroke = style === 'outline' ? ` stroke="${tone.line}" stroke-width="1"` : '';
      const inset = style === 'outline' ? 0.5 : 0;
      body = `<rect x="${inset}" y="${inset}" width="${slot - 2 * inset}" height="${slot - 2 * inset}" rx="${r2(rx)}" fill="${fill}"${stroke}/>` + glyph(style === 'solid' && !o.muted ? t.surface : tone.fg);
    }
    return { t: 'image', name: `Icon ${name}`, box: { x, y, width: slot, height: slot }, svg: svgDoc(slot, slot, body) };
  }

  /** The tile of a decision: a square on its point around the icon, as one picture. */
  private diamond(tone: ToneColors, cx: number, cy: number, name: string | undefined): Picture {
    const t = this.theme;
    const style = look(t).tile;
    const side = 26;
    const room = 38;
    const box = (attrs: string) => `<rect x="${(room - side) / 2}" y="${(room - side) / 2}" width="${side}" height="${side}" rx="${Math.min(6, t.radius.tile)}" ${attrs} transform="rotate(45 ${room / 2} ${room / 2})"/>`;
    const glyph = (color: string) => (name ? iconMarkup(name, color, 16, t.stroke.icon, room / 2 - 8, room / 2 - 8) : '');
    const body =
      style === 'solid' || style === 'disc' ? box(`fill="${tone.fg}"`) + glyph(t.surface)
      : style === 'soft' ? box(`fill="${tone.bg}"`) + glyph(tone.fg)
      : box(`fill="${t.surface}" stroke="${style === 'outline' ? tone.line : tone.fg}" stroke-opacity="${style === 'outline' ? 1 : 0.55}" stroke-width="1.2"`) + glyph(tone.fg);
    return { t: 'image', name: `Icon ${name ?? 'decision'}`, box: { x: cx - room / 2, y: cy - room / 2, width: room, height: room }, svg: svgDoc(room, room, body) };
  }

  /** A chip or tag: filled with the tone's tint, or outlined where the theme's chips are. */
  private chipLook(tone: ToneColors): Paint {
    const t = this.theme;
    return look(t).chip === 'outline' ? { fill: t.surface, stroke: mix(tone.fg, t.surface, 0.45), strokeWidth: 1 } : { fill: tone.bg };
  }

  // ------------------------------------------------------------ groups and cards

  private group(g: GraphGroup, b: Box): Element {
    const t = this.theme;
    const lk = look(t).group;
    const tone = t.tones[g.tone];
    const lab = groupLabel(t, g.label);
    const iconRoom = groupIconRoom(t);
    const max = b.width - 32 - iconRoom;
    const runs = [this.run(lab.text, lab.size, 600, groupLabelInk(t, tone), { tracking: lab.tracking })];
    const room = max - measureText(lab.text, lab.size, 600, 'sans', lab.tracking) - 8;
    if (g.caption && measureText(g.caption, t.size.caption, 400) <= room) runs.push(this.run(`  ${g.caption}`, t.size.caption, 400, groupCaptionInk(t)));
    // Where a theme draws no outline, a dashed boundary still gets one.
    const outline = groupLine(t, tone) ?? (g.border === 'dashed' ? t.border : undefined);
    const lineH = lab.size * 1.2;
    const body = this.rect(`Group: ${g.label}`, b, t.radius.group, { fill: this.ground.fill(g), ...(outline ? { stroke: outline, strokeWidth: t.stroke.group, ...(g.border === 'dashed' ? { dash: 'dashed' as const } : {}) } : {}) }, {
      label: { lines: [runs], align: 'left', valign: 'top', inset: { left: 16 + iconRoom, top: 22 - lineH / 2, right: 16, bottom: 0 } },
    });
    const pic = lk.icon && g.icon ? this.picture(g.icon, b.x + 16, b.y + 22 - lk.icon / 2, lk.icon, tone.fg, 1.75) : undefined;
    return {
      id: `group:${g.id}`,
      role: 'group',
      parent: g.parent && this.placed.groups.has(g.parent) ? `group:${g.parent}` : undefined,
      body,
      under: [],
      parts: pic ? [pic] : [],
      data: { carto: 'group', id: g.id, label: g.label, ...(g.kind ? { kind: g.kind } : {}), ...(g.caption ? { caption: g.caption } : {}), ...(g.tone ? { tone: g.tone } : {}) },
    };
  }

  private parentOf(n: GraphNode): string | undefined {
    return n.parent && this.placed.groups.has(n.parent) ? `group:${n.parent}` : undefined;
  }

  private card(n: GraphNode, s: CardShape, b: Box): Element {
    const t = this.theme;
    const c = t.space.card;
    const tone = t.tones[s.tone];
    const badges = this.chipsByNode.get(n.id) ?? [];
    const under: Part[] = [];
    const parts: Part[] = [];
    // A stacked pair: the second card peeks out below and to the right.
    if (s.stack) {
      const back = { x: b.x + STACK, y: b.y + STACK, width: b.width - STACK, height: b.height - STACK };
      under.push(this.rect('Second of a pair', back, t.radius.card, { fill: t.surface, stroke: t.textFaint, strokeOpacity: 0.45, strokeWidth: t.stroke.card }));
      b = { ...b, width: b.width - STACK, height: b.height - STACK };
    }
    const body = s.body && !badges.length ? bodyLines(s.body, b.width, t) : [];
    const top = badges.length || body.length ? c.height : b.height;
    const muted = !!s.muted;
    const inset = cardInsets(s, t);
    const centred = inset.centred && !badges.length;
    const room = b.width - inset.left - inset.right;
    const caption = cardCaption(s);
    // Cut to the card's room as on the picture; the whole label stays in the data.
    const lines: Run[][] = [[this.run(fitText(s.label, t.size.label, 600, room), t.size.label, 600, muted ? t.textMuted : t.text)]];
    if (caption) lines.push([this.run(fitText(caption, t.size.caption, 400, room), t.size.caption, 400, muted ? t.textFaint : t.textMuted)]);
    const label: Label = { lines, align: centred ? 'center' : 'left', valign: 'middle', inset: { left: inset.left, right: inset.right, top: 0, bottom: b.height - top } };
    const data = { carto: 'node', id: n.id, label: s.label, ...(n.kind ? { kind: n.kind } : {}), ...(s.caption ? { caption: s.caption } : {}) };
    let main: Rect;
    let pic: Picture | undefined;
    if (s.form === 'decision') {
      main = { t: 'rect', name: s.label, box: b, radius: Math.max(0, t.radius.card - 4), outline: 'hexagon', fill: muted ? t.tones.slate.bg : t.surface, stroke: tone.fg, strokeOpacity: 0.45, strokeWidth: t.stroke.card + 0.2, label };
      pic = this.diamond(tone, b.x + DECISION_TIP + 23, b.y + top / 2, s.icon);
    } else {
      const pill = s.form === 'terminal';
      main = this.rect(s.label, b, pill ? b.height / 2 : t.radius.card, { fill: muted ? t.tones.slate.bg : t.surface, stroke: muted ? t.tones.slate.line : cardStroke(t, tone), strokeWidth: t.stroke.card }, { label });
      pic = this.tile(b.x + c.padX, b.y + (top - c.tile) / 2, c.tile, tone, s.icon, { round: pill || s.form === 'person', muted });
      // A brand theme's tone strip on the left edge, following the rounded corners: a small picture.
      if (t.cardBar && !pill) {
        const r = t.radius.card;
        const dy = r > 3 ? Math.sqrt(r * r - (r - 3) * (r - 3)) : 0;
        const d = r > 3 ? `M3 ${r2(r - dy)}A${r} ${r} 0 0 0 0 ${r}V${r2(b.height - r)}A${r} ${r} 0 0 0 3 ${r2(b.height - r + dy)}Z` : `M0 0H3V${r2(b.height)}H0Z`;
        parts.push({ t: 'image', name: 'Tone strip', box: { x: b.x, y: b.y, width: 3, height: b.height }, svg: svgDoc(3, b.height, `<path d="${d}" fill="${tone.fg}"/>`) });
      }
    }
    for (const [i, line] of body.entries()) parts.push(this.text('Description', b.x + c.padX + 1, b.y + c.height + BODY.top + BODY.line * (i + 0.5), line, t.size.caption, 400, muted ? t.textFaint : t.textMuted));
    for (const p of chipRows(badges, room, t).placed) parts.push(...this.chip(p.chip, b.x + inset.left + p.x, b.y + CHIP.top + p.y, p.width, n.id));
    return { id: `node:${n.id}`, role: 'node', parent: this.parentOf(n), body: main, icon: pic, under, parts, data };
  }

  /** A badge: a connection shown as a tag on the card it starts from. */
  private chip(ch: Chip, x: number, y: number, w: number, node: string): Part[] {
    const t = this.theme;
    const tone = t.tones[ch.tone ?? 'slate'];
    const pic = ch.icon ? this.picture(ch.icon, x + CHIP.padX, y + (CHIP.height - CHIP.icon) / 2, CHIP.icon, tone.fg, 1.6) : undefined;
    const ix = pic ? CHIP.icon + CHIP.iconGap : 0;
    const size = chipText(t);
    const e = this.graph.edges.find((x) => x.id === ch.edge);
    const box = { x, y, width: w, height: CHIP.height };
    // A node that is only ever a badge has no card: the badge carries what it is.
    const to = this.graph.nodes.find((n) => n.id === e?.to.node && n.folded);
    const card = to?.shape.kind === 'card' ? to.shape : undefined;
    const folded = to ? { ...(to.kind ? { toKind: to.kind } : {}), ...(card ? { toLabel: card.label } : {}), ...(card?.caption ? { toCaption: card.caption } : {}), ...(to.parent ? { toIn: to.parent } : {}) } : {};
    const back = this.rect(`Badge: ${ch.label}`, box, t.radius.chip, this.chipLook(tone), {
      label: { lines: [[this.run(fitText(ch.label, size, 500, w - 2 * CHIP.padX - ix), size, 500, tone.fg)]], align: 'left', valign: 'middle', inset: { left: CHIP.padX + ix, right: 0, top: 0, bottom: 0 } },
      data: { carto: 'badge', from: node, to: e?.to.node ?? '', ...(e?.kind ? { style: e.kind } : {}), ...(e?.label ? { label: e.label } : {}), line: e?.line ?? 'solid', ...(e?.tone ? { tone: e.tone } : {}), ...folded },
    });
    return pic ? [back, pic] : [back];
  }

  // ------------------------------------------------------------ tables and matrices

  /** A table is its frame and one element per row, so rows stay rows and lines can end on them. */
  private table(n: GraphNode, s: TableShape, b: Box) {
    const t = this.theme;
    const ts = t.space.table;
    const tone = t.tones[s.tone];
    const head = tableHeader(s, t);
    const lk = look(t);
    const headFill = lk.tableHead === 'tone' ? tone.bg : lk.tableHead === 'paper' ? (paperTint(t, 1) ?? tone.bg) : undefined;
    const lines: Run[][] = [[this.run(s.title, t.size.label, 600, t.text)]];
    if (s.caption) lines.push([this.run(s.caption, t.size.caption, 400, t.textMuted)]);
    const id = `node:${n.id}`;
    const pic = s.icon ? this.picture(s.icon, b.x + ts.padX, b.y + (s.caption ? head / 2 - 7 : head / 2) - 8, 16, tone.fg, 1.75) : undefined;
    this.elements.push({
      id,
      role: 'table',
      parent: this.parentOf(n),
      body: this.rect(s.title, b, t.radius.card, { fill: t.surface, stroke: t.border, strokeWidth: t.stroke.card }, {
        // The header: its height is the label's bottom inset from the top, its fill the table's tone.
        label: { lines, align: 'left', valign: 'middle', inset: { left: ts.padX + (pic ? 24 : 0), right: ts.padX, top: 0, bottom: b.height - head } },
        data: headFill ? { headFill } : undefined,
      }),
      icon: pic,
      under: [],
      parts: [],
      data: { carto: 'node', id: n.id, label: s.title, ...(n.kind ? { kind: n.kind } : {}), ...(s.caption ? { caption: s.caption } : {}) },
    });
    let y = b.y + head;
    const marks = markWidth(s);
    for (const [i, row] of s.rows.entries()) {
      if (row.kind === 'section') {
        const box = { x: b.x, y, width: b.width, height: ts.section };
        this.elements.push({
          id: `section:${n.id}:${i}`,
          role: 'row',
          parent: id,
          body: this.rect(`Section: ${row.label}`, box, 0, {}, { label: { lines: [[this.run(row.label.toUpperCase(), 10, 600, t.textFaint)]], align: 'left', valign: 'middle', inset: { left: ts.padX, right: ts.padX, top: 4, bottom: 0 } } }),
          under: [],
          parts: [],
          data: { carto: 'section' },
        });
        y += ts.section;
        continue;
      }
      const box = { x: b.x, y, width: b.width, height: ts.row };
      const cy = y + ts.row / 2;
      const [name, type] = row.cells;
      const parts: Part[] = [];
      if (i > 0 && s.rows[i - 1]?.kind === 'row') parts.push(this.line('Rule', [{ x: b.x + ts.padX, y }, { x: b.x + b.width - ts.padX, y }], t.border, 1, { opacity: 0.6 }));
      for (const [k, m] of rowMarks(row).entries()) {
        const p = this.picture(m.icon, b.x + ts.padX + k * 15, cy - 6.5, 13, t.tones[m.tone].fg, 1.75);
        if (p) parts.push(p);
      }
      // The type column is set in the monospace face where the theme asks, a step smaller.
      if (type?.text) parts.push(lk.mono.type ? this.text('Type', b.x + b.width - ts.padX, cy, type.text, monoCell(t), 400, t.textMuted, 'end', { mono: true }) : this.text('Type', b.x + b.width - ts.padX, cy, type.text, t.size.cell, 400, t.textMuted, 'end'));
      this.elements.push({
        id: `row:${n.id}:${row.id}`,
        role: 'row',
        parent: id,
        body: this.rect(`Row: ${name?.text ?? row.id}`, box, 0, {}, { label: { lines: [[this.run(name?.text ?? '', t.size.cell, name?.strong ? 600 : 400, t.text)]], align: 'left', valign: 'middle', inset: { left: ts.padX + marks, right: ts.padX, top: 0, bottom: 0 } } }),
        under: [],
        parts,
        data: { carto: 'row', id: row.id, marks: (row.marks ?? []).join(' '), ...(type?.text ? { type: type.text } : {}) },
      });
      y += ts.row;
    }
  }

  private matrix(n: GraphNode, m: MatrixShape, b: Box): Element {
    const t = this.theme;
    const { PAD, HEAD, COL_ICON, ROW_ICON } = MATRIX;
    const g = matrixGeometry(m, t);
    const tone = (x?: MatrixShape['rows'][number]['tone']) => t.tones[x ?? 'slate'];
    const parts: (Part | undefined)[] = [];
    const hline = (x0: number, x1: number, y: number, color: string, opacity?: number) => this.line('Rule', [{ x: x0, y }, { x: x1, y }], color, 1, opacity ? { opacity } : {});
    const paper = look(t).tableHead === 'paper' ? paperTint(t, 0) : undefined;
    if (paper) parts.push(this.rect('Header', { x: b.x + 0.5, y: b.y + 0.5, width: b.width - 1, height: g.head - 0.5 }, Math.max(0, t.radius.card - 0.5), { fill: paper }));
    parts.push(hline(b.x, b.x + b.width, b.y + g.head, paper ? (groupLine(t, t.tones.slate) ?? t.border) : t.border));
    // Grouped columns and rows: their names over the columns and between the rows.
    for (const band of g.bands) parts.push(this.text(`Group: ${band.label}`, b.x + band.x + band.width / 2, b.y + g.band / 2 + 4, band.label.toUpperCase(), 10, 600, t.textMuted, 'middle'));
    for (const sec of g.sections) parts.push(this.text(`Group: ${sec.label}`, b.x + PAD, b.y + sec.y + MATRIX.SECTION / 2, sec.label.toUpperCase(), 10, 600, t.textMuted));
    if (m.corner) parts.push(m.plain ? this.text('Corner', b.x + PAD, b.y + g.band + HEAD / 2, m.corner, t.size.cell, 600, t.text) : this.text('Corner', b.x + PAD, b.y + g.band + HEAD / 2, m.corner, t.size.caption, 500, t.textFaint));
    let x = b.x + g.rowHeader;
    for (const [j, col] of m.columns.entries()) {
      const w = g.columns[j]!;
      const cx = x + w / 2;
      const iconW = col.icon ? COL_ICON : 0;
      const label = fitText(col.label, t.size.cell, 600, w - 2 * PAD - iconW);
      const labelW = Math.min(w - 2 * PAD - iconW, measureText(col.label, t.size.cell, 600));
      // A plain table reads like a spreadsheet: everything flush left.
      const start = m.plain ? x + PAD : cx - (labelW + iconW) / 2;
      const cy = (col.caption ? b.y + HEAD / 2 - 7 : b.y + HEAD / 2) + g.band;
      if (col.icon) parts.push(this.picture(col.icon, start, cy - 7, 14, tone(col.tone).fg, 1.75));
      parts.push(this.text(`Column: ${col.label}`, start + iconW, cy, label, t.size.cell, 600, t.text));
      if (col.caption) parts.push(this.text('Caption', cx, cy + 16, fitText(col.caption, t.size.caption, 400, w - 2 * PAD), t.size.caption, 400, t.textFaint, 'middle'));
      parts.push(this.line('Rule', [{ x, y: b.y + 10 }, { x, y: b.y + b.height - 10 }], t.border, 1, { opacity: 0.5 }));
      x += w;
    }
    for (const [i, row] of m.rows.entries()) {
      const y = b.y + g.rows[i]!.y;
      const tall = g.rows[i]!.height > g.rowHeight;
      const cy = tall ? y + 10 + MATRIX.LINE / 2 : y + g.rowHeight / 2;
      // A row without a label continues the one above: the rule skips its header.
      if (i > 0) parts.push(hline(m.plain && !row.label ? b.x + g.rowHeader : b.x, b.x + b.width, y, t.border, 0.6));
      const rt = tone(row.tone);
      let tx = b.x + PAD;
      if (row.icon) {
        const style = look(t).tile;
        parts.push(this.tile(tx, cy - 11, 22, rt, row.icon, { rx: Math.min(6, t.radius.tile), iconSize: style === 'bare' ? 17 : style === 'disc' || style === 'ring' ? 12 : 14 }));
        tx += ROW_ICON;
      }
      const room = g.rowHeader - (tx - b.x) - PAD;
      if (row.caption) {
        parts.push(this.text(`Row: ${row.label}`, tx, cy - 7, fitText(row.label, t.size.cell, 600, room), t.size.cell, 600, t.text));
        parts.push(this.text('Caption', tx, cy + 8, fitText(row.caption, t.size.caption, 400, room), t.size.caption, 400, t.textMuted));
      } else parts.push(this.text(`Row: ${row.label}`, tx, cy, fitText(row.label, t.size.cell, 600, room), t.size.cell, 600, t.text));
      let cx = b.x + g.rowHeader;
      for (const [j] of m.columns.entries()) {
        const w = g.columns[j]!;
        const c = m.cells[i]?.[j];
        const lines = g.lines[i]?.[j];
        if (lines) lines.forEach((l, k) => parts.push(this.text('Cell', cx + PAD, y + 10 + MATRIX.LINE * (k + 0.5), l, t.size.cell, c?.strong ? 600 : 400, t.text)));
        else if (m.plain) parts.push(this.text('Cell', cx + PAD, cy, fitText(c?.text ?? '–', t.size.cell, c?.strong ? 600 : 400, w - 2 * PAD), t.size.cell, c?.strong ? 600 : 400, c?.text ? t.text : t.textFaint));
        else parts.push(...this.cell(c, cx + w / 2, cy, w - 2 * PAD));
        cx += w;
      }
    }
    return {
      id: `node:${n.id}`,
      role: 'block',
      parent: this.parentOf(n),
      body: this.rect(m.corner ?? 'Matrix', b, t.radius.card, { fill: t.surface, stroke: t.border, strokeWidth: t.stroke.card }),
      under: [],
      parts: parts.filter((p): p is Part => !!p),
      data: { carto: 'matrix', id: n.id },
    };
  }

  private cell(c: MatrixCell | undefined, cx: number, cy: number, room: number): (Part | undefined)[] {
    const t = this.theme;
    const { PILL_H, PILL_X, NOTE, CHECK } = MATRIX;
    if (!c || (!c.text && !c.check)) return [this.text('Cell', cx, cy, '–', t.size.cell, 400, t.textFaint, 'middle')];
    const tone = t.tones[c.tone ?? 'blue'];
    const py = c.note ? cy - 8 : cy;
    const out: (Part | undefined)[] = [];
    const dashed: Paint = { stroke: tone.fg, strokeOpacity: 0.7, strokeWidth: 1, dash: 'dashed' };
    if (c.check) {
      const r = CHECK / 2;
      out.push({ ...this.rect(c.inherited ? 'Inherited' : 'Granted', { x: cx - r, y: py - r, width: CHECK, height: CHECK }, r, c.inherited ? { fill: t.surface, ...dashed } : { fill: tone.fg }), outline: 'ellipse' });
      out.push(this.picture('check', cx - 6, py - 6, 12, c.inherited ? tone.fg : t.surface, 2.4));
    } else if (c.text) {
      const size = chipText(t);
      const label = fitText(c.text, size, 500, room - 2 * PILL_X);
      const w = measureText(label, size, 500) + 2 * PILL_X;
      // Direct: a filled tag (outlined where the theme's chips are). Inherited: always a dashed outline.
      out.push(
        this.rect(`Cell: ${c.text}`, { x: cx - w / 2, y: py - PILL_H / 2, width: w, height: PILL_H }, tagRadius(t, PILL_H), c.inherited ? { fill: t.surface, ...dashed } : this.chipLook(tone), {
          label: { lines: [[this.run(label, size, 500, tone.fg)]], align: 'center', valign: 'middle', inset: { left: 0, right: 0, top: 0, bottom: 0 } },
        }),
      );
    }
    if (c.note) out.push(this.text('Note', cx, cy + 13, fitText(c.note, NOTE, 400, room), NOTE, 400, t.textMuted, 'middle'));
    return out;
  }

  // ------------------------------------------------------------ lines

  private edgeColor = (e: GraphEdge) => (e.tone ? this.theme.tones[e.tone].fg : this.theme.edge);

  /** The element a line end is bound to: a table's row, a node, or a group. */
  private endOf(end: { node: string; row?: string }): string | undefined {
    const n = this.graph.nodes.find((x) => x.id === end.node);
    if (n && this.placed.nodes.has(n.id)) {
      if (end.row && n.shape.kind === 'table' && n.shape.rows.some((r) => r.kind === 'row' && r.id === end.row)) return `row:${n.id}:${end.row}`;
      return `node:${n.id}`;
    }
    return this.placed.groups.has(end.node) ? `group:${end.node}` : undefined;
  }

  private edge(e: GraphEdge): Connector {
    const t = this.theme;
    const lk = look(t);
    const pe = this.placed.edges.get(e.id)!;
    const points = squared(clean(toOutline(pe.points, this.graph, this.placed, e.from.node, e.to.node))).map(this.pt);
    const color = this.edgeColor(e);
    let label: Rect | undefined;
    if (e.label && pe.label) {
      const b = this.at(besideShortLine(pe.points, pe.label, this.placed));
      const el = lk.edgeLabel;
      const h = 20;
      const y = b.y + (b.height - h) / 2;
      const box = el.style === 'halo' ? { x: b.x + 2, y: y + 2, width: b.width - 4, height: h - 4 } : el.style === 'plate' ? { x: b.x, y: y + 1, width: b.width, height: h - 2 } : { x: b.x, y, width: b.width, height: h };
      const under = this.ground.under(besideShortLine(pe.points, pe.label, this.placed));
      const paint: Paint = el.style === 'halo' ? { fill: under } : { fill: t.surface, stroke: t.border, strokeWidth: 1 };
      label = this.rect(`Label: ${e.label}`, box, el.style === 'halo' ? 2 : el.style === 'plate' ? t.radius.chip : h / 2, paint, {
        label: { lines: [[this.run(labelString(t, e.label), t.size.edgeLabel, 500, labelInk(t, color), { mono: el.mono, tracking: el.tracking })]], align: 'center', valign: 'middle', inset: { left: 0, right: 0, top: 0, bottom: 0 } },
      });
    }
    return {
      id: `edge:${e.id}`,
      from: this.endOf(e.from),
      to: this.endOf(e.to),
      points,
      color,
      ...(e.tone ? { opacity: 0.9 } : {}),
      width: t.stroke.edge * (e.width ?? 1),
      ...(e.line !== 'solid' ? { dash: e.line } : {}),
      start: e.start,
      end: e.end,
      arrow: lk.line.arrow === 'open' ? 'open' : lk.line.arrow === 'slim' ? 'slim' : 'filled',
      corner: lk.line.corner === 'square' ? 0 : t.radius.corner,
      label,
      data: {
        carto: 'edge',
        from: e.from.row ? `${e.from.node}.${e.from.row}` : e.from.node,
        to: e.to.row ? `${e.to.node}.${e.to.row}` : e.to.node,
        line: e.line,
        start: e.start,
        end: e.end,
        ...(e.label ? { label: e.label } : {}),
        ...(e.kind ? { style: e.kind } : {}),
        ...(e.tone ? { tone: e.tone } : {}),
      },
    };
  }

  /** Where lines of one kind part ways: a dot, or a ring with the card colour inside. */
  private junctions(edges: GraphEdge[]): Part[] {
    const dots = new Map<string, Part>();
    const l = look(this.theme).line;
    for (const [i, a] of edges.entries())
      for (const b of edges.slice(i + 1)) {
        if (a.line !== b.line || a.tone !== b.tone || !joinDot(a) || !joinDot(b)) continue;
        const pa = this.placed.edges.get(a.id)!.points;
        const pb = this.placed.edges.get(b.id)!.points;
        const at = a.from.node === b.from.node ? split(pa, pb) : a.to.node === b.to.node ? split([...pa].reverse(), [...pb].reverse()) : undefined;
        if (!at) continue;
        const r = l.junctionSize;
        const color = this.edgeColor(a);
        const p = this.pt(at);
        dots.set(`${Math.round(at.x)},${Math.round(at.y)}`, { ...this.rect('Junction', { x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r }, r, l.junction === 'ring' ? { fill: this.theme.surface, stroke: color, strokeWidth: this.theme.stroke.edge } : { fill: color }), outline: 'ellipse' });
      }
    return [...dots.values()];
  }

  // ------------------------------------------------------------ sequence and journey

  /** A sequence as shapes: a card per participant, its lifeline, and every message a line with its words. */
  private sequence(s: SequenceShape, b: Box) {
    const t = this.theme;
    const g = sequenceGeometry(s, t);
    const X = (x: number) => b.x + x;
    const Y = (y: number) => b.y + y;
    const at = (box: Box): Box => ({ x: X(box.x), y: Y(box.y), width: box.width, height: box.height });
    const back: Part[] = [];
    for (const bx of g.boxes) {
      const tone = t.tones[bx.tone];
      const line = groupLine(t, tone);
      const lab = groupLabel(t, bx.label);
      back.push(
        this.rect(`Box: ${bx.label}`, at(bx.box), t.radius.group, { fill: groupFill(t, 0, tone), ...(line ? { stroke: line, strokeWidth: t.stroke.group } : {}) }, {
          label: { lines: [[this.run(lab.text, lab.size, 600, groupLabelInk(t, tone), { tracking: lab.tracking })]], align: 'left', valign: 'top', inset: { left: 14, right: 14, top: 16 + 1 - lab.size * 0.6, bottom: 0 } },
        }),
      );
    }
    const TAB = { size: 10 as const, padX: 8, labelGap: 8, height: 20 };
    for (const f of g.frames) {
      const tone = t.tones[f.tone];
      const tint = paperTint(t, 1);
      const fb = at(f.box);
      back.push(this.rect(`Frame: ${f.ev.frame}`, fb, Math.min(10, t.radius.group), tint ? { fill: tint, stroke: groupLine(t, tone) ?? t.border, strokeWidth: 1.2 } : { fill: tone.wash, fillOpacity: 0.7, stroke: tone.line, strokeWidth: 1.2 }));
      const word = f.ev.frame.toUpperCase();
      const ww = measureText(word, TAB.size, 600) + 2 * TAB.padX;
      back.push(this.rect('Tab', { x: fb.x, y: fb.y, width: ww, height: TAB.height }, Math.min(6, t.radius.group), { fill: tone.bg }, { label: { lines: [[this.run(word, TAB.size, 600, tone.fg, { tracking: 0.4 })]], align: 'center', valign: 'middle', inset: { left: 0, right: 0, top: 0, bottom: 0 } } }));
      if (f.ev.label) back.push(this.text('Condition', fb.x + ww + TAB.labelGap, fb.y + TAB.height / 2, fitText(f.ev.label, t.size.caption, 500, fb.width - ww - 2 * TAB.labelGap), t.size.caption, 500, t.text));
      for (const br of f.branches) {
        const y = Y(br.y) + 6;
        back.push(this.line('Branch', [{ x: fb.x, y }, { x: fb.x + fb.width, y }], tint ? (groupLine(t, tone) ?? t.border) : tone.line, 1.2, { dash: 'dashed' }));
        const w = (f.ev.frame === 'par' ? 'and' : 'else').toUpperCase();
        back.push(this.text('Branch', fb.x + TAB.padX, y + 13, w, TAB.size, 600, tone.fg, 'start', { tracking: 0.4 }));
        if (br.label) back.push(this.text('Condition', fb.x + TAB.padX + measureText(w, TAB.size, 600) + TAB.labelGap, y + 13, fitText(br.label, t.size.caption, 500, fb.width - 60), t.size.caption, 500, t.text));
      }
    }
    const [y1, y2] = g.lifeline;
    for (const h of g.headers) back.push(this.line(`Lifeline: ${h.p.label}`, [{ x: X(h.x), y: Y(y1) }, { x: X(h.x), y: Y(y2) }], t.edge, 1.2, { opacity: 0.75, dash: 'dotted' }));
    for (const d of g.dividers) {
      back.push(this.line('Divider', [{ x: X(0), y: Y(d.y) }, { x: X(g.width), y: Y(d.y) }], t.border, 1.2));
      const w = measureText(d.label, t.size.caption, 600) + 28;
      back.push(this.rect(`Divider: ${d.label}`, { x: X(g.width / 2) - w / 2, y: Y(d.y) - 11, width: w, height: 22 }, look(t).edgeLabel.style === 'plate' ? t.radius.chip : 11, { fill: t.canvas, stroke: t.border, strokeWidth: 1 }, { label: { lines: [[this.run(d.label, t.size.caption, 600, t.textMuted)]], align: 'center', valign: 'middle', inset: { left: 0, right: 0, top: 0, bottom: 0 } } }));
    }
    for (const bar of g.bars) {
      const tone = t.tones[bar.tone];
      back.push(this.rect('Activation', at(bar.box), 3, { fill: tone.bg, stroke: tone.fg, strokeOpacity: 0.55, strokeWidth: 1 }));
    }
    this.back.push({ id: 'sequence', role: 'decor', parts: back });

    // Messages: a line with its arrowhead, and the words above it as text of their own.
    const L = { size: 12 as const, line: 16 };
    const words: Part[] = [];
    for (const [i, m] of g.messages.entries()) {
      const ev = m.ev;
      const color = ev.arrow === 'async' ? t.tones.violet.fg : ev.arrow === 'reply' ? t.edge : t.textMuted;
      const y = Y(m.y);
      const points = m.self ? [{ x: X(m.x1), y }, { x: X(m.x2), y }, { x: X(m.x2), y: y + m.self.h }, { x: X(m.self.back), y: y + m.self.h }] : [{ x: X(m.x1), y }, { x: X(m.x2), y }];
      this.connectors.push({
        id: `message:${i}`,
        points,
        color: ev.arrow === 'lost' ? t.tones.rose.fg : color,
        width: t.stroke.edge,
        ...(ev.arrow === 'reply' ? { dash: 'dashed' as const } : {}),
        start: 'none',
        end: 'arrow',
        arrow: ev.arrow === 'sync' ? (look(t).line.arrow === 'slim' ? 'slim' : 'filled') : 'open',
        corner: 8,
        data: { carto: 'message', from: ev.from, to: ev.to, arrow: ev.arrow, ...(ev.label ? { label: ev.label } : {}) },
      });
      const lines = ev.number !== undefined && m.lines.length ? [`${ev.number}. ${m.lines[0]}`, ...m.lines.slice(1)] : m.lines;
      if (m.self) {
        const top = y + m.self.h / 2 - (lines.length * L.line) / 2;
        for (const [k, l] of lines.entries()) words.push(this.text(`Message: ${l}`, X(m.x2) + 10, top + L.line * k + L.line / 2, l, L.size, 500, t.text));
      } else {
        const base = y - 6 - lines.length * L.line;
        for (const [k, l] of lines.entries()) words.push(this.text(`Message: ${l}`, X(m.mid), base + L.line * k + L.line / 2, l, L.size, 500, t.text, 'middle'));
      }
    }
    const N = { size: 11.5 as const, line: 15, padX: 10, padY: 8 };
    for (const n of g.notes) {
      const tone = t.tones.amber;
      words.push(
        this.rect(`Note: ${n.lines.join(' ')}`, at(n.box), Math.min(8, t.radius.card), { fill: tone.bg, fillOpacity: 0.8, stroke: tone.line, strokeWidth: 1 }, {
          label: { lines: n.lines.map((l) => [this.run(l, 11.5, 400, t.text)]), align: n.centred ? 'center' : 'left', valign: 'top', inset: { left: n.centred ? 0 : N.padX, right: n.centred ? 0 : N.padX, top: N.padY - 1, bottom: 0 } },
        }),
      );
    }
    for (const r of g.refs) {
      const tone = t.tones.slate;
      words.push(
        this.rect(`Ref: ${r.label}`, at(r.box), Math.min(10, t.radius.group), { fill: t.surface, stroke: groupLine(t, tone) ?? tone.line, strokeWidth: 1.2 }, {
          label: { lines: [[this.run(r.label, t.size.label, 600, r.link ? t.tones.blue.fg : t.text)]], align: 'center', valign: 'middle', inset: { left: 0, right: 0, top: 6, bottom: 0 } },
        }),
      );
      words.push(this.text('Ref', at(r.box).x + TAB.padX, at(r.box).y + TAB.height / 2, 'REF', TAB.size, 600, tone.fg, 'start', { tracking: 0.4 }));
    }
    this.loose.push({ id: 'sequence-words', role: 'decor', parts: words });

    // Participants last, as cards: on top of their lifelines.
    const H = { padX: 10, tile: 30, gap: 10 };
    // The model keeps the icon and tone, not the kind they came from.
    const kindOf = (p: { icon?: string; tone: string }) => Object.entries(sequenceKinds).find(([, k]) => k.icon === p.icon && k.tone === p.tone)?.[0];
    const header = (h: (typeof g.headers)[number], y: number, foot: boolean): Element => {
      const p = h.p;
      const tone = t.tones[p.tone];
      const box = { x: X(h.x - h.width / 2), y: Y(y), width: h.width, height: g.headerHeight };
      const has = !!p.icon && !!icon(p.icon);
      const textW = Math.max(measureText(p.label, t.size.label, 600), p.caption ? measureText(p.caption, t.size.caption, 400) : 0);
      const room = h.width - 2 * H.padX - (has ? H.tile + H.gap : 0);
      // Tile and text centred as one, so a header reads as the top of its lifeline.
      const content = (has ? H.tile + H.gap : 0) + Math.min(room, textW);
      const x = box.x + box.width / 2 - content / 2;
      const lines: Run[][] = [[this.run(p.label, t.size.label, 600, t.text)]];
      if (p.caption) lines.push([this.run(p.caption, t.size.caption, 400, t.textMuted)]);
      return {
        id: `${foot ? 'foot' : 'node'}:${p.id}`,
        role: 'node',
        body: this.rect(p.label, box, t.radius.card, { fill: t.surface, stroke: cardStroke(t, tone), strokeWidth: t.stroke.card }, { label: { lines, align: 'left', valign: 'middle', inset: { left: x - box.x + (has ? H.tile + H.gap : 0), right: 4, top: 0, bottom: 0 } } }),
        icon: has ? this.tile(x, box.y + box.height / 2 - H.tile / 2, H.tile, tone, p.icon, { rx: Math.min(8, t.radius.tile), iconSize: look(t).tile === 'bare' ? 20 : 16 }) : undefined,
        under: [],
        parts: [],
        data: { carto: 'participant', id: p.id, label: p.label, ...(kindOf(p) ? { kind: kindOf(p)! } : {}), ...(p.caption ? { caption: p.caption } : {}) },
      };
    };
    for (const h of g.headers) {
      this.elements.push(header(h, g.headerY, false));
      if (g.footerY !== undefined) this.elements.push(header(h, g.footerY, true));
    }
  }

  /** A journey as flat shapes: the marks render/journey.ts lays out, one box, text or picture each; curves go in as small pictures. */
  private journey(s: JourneyShape, b: Box) {
    const { parts, curves } = this.markParts(journeyScene(s, this.theme).marks, b);
    if (curves) this.warnings.push(`A journey's curves and drawn faces (${curves}) are small pictures: they move and scale, their points cannot be edited`);
    this.loose.push({ id: 'journey', role: 'decor', parts });
  }

  /** Marks laid out by the renderer (a journey's, a process shape's) as parts, moved by `b`; a curve is a small picture. */
  private markParts(marks: JourneyMark[], b: Point): { parts: Part[]; curves: number } {
    const parts: Part[] = [];
    let curves = 0;
    for (const m of marks) {
      const paint: Paint = 'fill' in m && m.t !== 'text' ? { ...(m.fill && m.fill !== 'none' ? { fill: m.fill } : {}), ...(m.stroke ? { stroke: m.stroke, strokeWidth: m.sw ?? 1, ...('dash' in m && m.dash ? { dash: 'dashed' as const } : {}) } : {}) } : {};
      if (m.t === 'rect') parts.push(this.rect(m.name ?? 'Box', { x: b.x + m.x, y: b.y + m.y, width: m.w, height: m.h }, m.r ?? 0, paint));
      else if (m.t === 'circle') parts.push({ ...this.rect('Dot', { x: b.x + m.cx - m.r, y: b.y + m.cy - m.r, width: 2 * m.r, height: 2 * m.r }, m.r, paint), outline: 'ellipse' });
      else if (m.t === 'icon') {
        const p = this.picture(m.name, b.x + m.x, b.y + m.y, m.size, m.color, m.sw);
        if (p) parts.push(p);
      } else if (m.t === 'text') {
        const anchor = m.align === 'c' ? 'middle' : m.align === 'r' ? 'end' : 'start';
        parts.push({ t: 'text', name: m.lines.join(' ').slice(0, 60), box: { x: b.x + m.x, y: b.y + m.y, width: m.w, height: m.lines.length * m.lh }, lines: m.lines.map((l) => [this.run(l, m.size, m.weight as 400 | 500 | 600, m.fill)]), anchor });
      } else {
        const pts = m.d.flatMap((c) => (c[0] === 'Z' ? [] : c[0] === 'C' ? [[c[1], c[2]], [c[3], c[4]], [c[5], c[6]]] : [[c[1], c[2]]])) as [number, number][];
        if (!pts.length) continue;
        if (m.d.length === 2 && m.d[1]![0] === 'L' && !m.fill && m.stroke) {
          // A straight stroke is a line of its own, dragged by its ends.
          parts.push(this.line(m.name ?? 'Line', pts.map(([x, y]) => ({ x: b.x + x, y: b.y + y })), m.stroke, m.sw ?? 1, m.dash ? { dash: 'dashed' } : {}));
          continue;
        }
        const sw = m.sw ?? 1;
        const x0 = Math.min(...pts.map((p) => p[0])) - sw;
        const y0 = Math.min(...pts.map((p) => p[1])) - sw;
        const x1 = Math.max(...pts.map((p) => p[0])) + sw;
        const y1 = Math.max(...pts.map((p) => p[1])) + sw;
        const d = m.d.map((c) => (c[0] === 'Z' ? 'Z' : c[0] + (c.slice(1) as number[]).map((v, i) => r2(v - (i % 2 ? y0 : x0))).join(' '))).join('');
        const attrs = `fill="${m.fill && m.fill !== 'none' ? m.fill : 'none'}"${m.stroke ? ` stroke="${m.stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${m.dash ? ' stroke-dasharray="5 4"' : ''}` : ''}`;
        parts.push({ t: 'image', name: m.name ?? 'Curve', box: { x: b.x + x0, y: b.y + y0, width: x1 - x0, height: y1 - y0 }, svg: svgDoc(x1 - x0, y1 - y0, `<path d="${esc(d)}" ${attrs}/>`) });
        curves++;
      }
    }
    return { parts, curves };
  }

  /**
   * A task, event, gateway, state or document: its outline is the shape lines attach to, with its
   * mark and its name moving along. A task or a plain state carries its name inside, as a card does.
   */
  private flow(n: GraphNode, s: FlowShape, b: Box): Element {
    const t = this.theme;
    const label = this.placed.labels?.get(n.id);
    const marks = flowMarks(s, b, t, label ? this.at(label) : undefined);
    const first = marks[0];
    const data = { carto: 'node', id: n.id, label: s.label, ...(n.kind ? { kind: n.kind } : {}), ...(s.caption ? { caption: s.caption } : {}) };
    const paintOf = (m: { fill?: string; stroke?: string; sw?: number; dash?: boolean }): Paint => ({ ...(m.fill && m.fill !== 'none' ? { fill: m.fill } : {}), ...(m.stroke ? { stroke: m.stroke, strokeWidth: m.sw ?? 1, ...(m.dash ? { dash: 'dashed' as const } : {}) } : {}) });
    let body: Rect;
    let rest = marks.slice(1);
    if (first?.t === 'rect') {
      // Words inside a box without entry/exit lines become its own label, so typing over them keeps them centred.
      const inside = (s.form === 'task' || s.form === 'subprocess' || s.form === 'state') && !s.lines?.length && !s.icon;
      const texts = inside ? rest.filter((m): m is Extract<JourneyMark, { t: 'text' }> => m.t === 'text') : [];
      const lines = texts.flatMap((m) => m.lines.map((l) => [this.run(l, m.size, m.weight as 400 | 500 | 600, m.fill)]));
      body = this.rect(s.label || s.form, b, first.r ?? 0, paintOf(first), lines.length ? { label: { lines, align: 'center', valign: 'middle', inset: { left: 4, right: 4, top: 0, bottom: s.form === 'subprocess' ? 12 : 0 } } } : {});
      if (texts.length) rest = rest.filter((m) => m.t !== 'text');
    } else if (first?.t === 'circle') {
      body = { ...this.rect(s.label || s.form, { x: first.cx - first.r, y: first.cy - first.r, width: 2 * first.r, height: 2 * first.r }, first.r, paintOf(first)), outline: 'ellipse' };
    } else if (first?.t === 'path' && (s.form === 'gateway' || s.mark === 'choice')) {
      body = { ...this.rect(s.label || 'Gateway', b, 0, paintOf(first)), outline: 'diamond' };
    } else {
      // A document or a note: an empty box to hold on to, the drawing on it.
      body = this.rect(s.label || s.form, b, 0, {});
      rest = marks;
    }
    const { parts, curves } = this.markParts(rest, { x: 0, y: 0 });
    if (curves) this.flowCurves += curves;
    return { id: `node:${n.id}`, role: 'node', parent: this.parentOf(n), body, under: [], parts, data };
  }
  private flowCurves = 0;

  /** A capability, a person or a team (render/block.ts): its outline as the body, its words and tags on it. */
  private block(n: GraphNode, s: BlockShape, b: Box): Element {
    const marks = blockMarks(s, b, this.theme);
    const first = marks[0];
    const paint = first?.t === 'rect' ? { ...(first.fill && first.fill !== 'none' ? { fill: first.fill } : {}), ...(first.stroke ? { stroke: first.stroke, strokeWidth: first.sw ?? 1, ...(first.dash ? { dash: 'dashed' as const } : {}) } : {}) } : {};
    const body = this.rect(s.label || s.form, b, first?.t === 'rect' ? (first.r ?? 0) : 0, first?.t === 'rect' ? paint : {});
    const { parts, curves } = this.markParts(first?.t === 'rect' ? marks.slice(1) : marks, { x: 0, y: 0 });
    if (curves) this.flowCurves += curves;
    return { id: `node:${n.id}`, role: 'node', parent: this.parentOf(n), body, under: [], parts, data: { carto: 'node', id: n.id, label: s.label, ...(n.kind ? { kind: n.kind } : {}), ...(s.caption ? { caption: s.caption } : {}) } };
  }

  /** A lane: a group whose name stands in a header band at its start. */
  private lane(g: GraphGroup, b: Box): Element {
    const across = (this.placed.direction ?? this.graph.direction) === 'right';
    const head = across ? Math.max(0, ...this.graph.groups.filter((x) => x.lane).map((x) => laneHeader(x.label, this.theme))) : this.theme.space.group.header;
    const [ground, ...rest] = laneMarks(g, b, this.theme, across, head);
    const r = ground as Extract<JourneyMark, { t: 'rect' }>;
    const body = this.rect(`Lane: ${g.label}`, b, r.r ?? 0, { ...(r.fill ? { fill: r.fill } : {}), ...(r.stroke ? { stroke: r.stroke, strokeWidth: r.sw ?? 1, ...(r.dash ? { dash: 'dashed' as const } : {}) } : {}) });
    return {
      id: `group:${g.id}`,
      role: 'group',
      parent: g.parent && this.placed.groups.has(g.parent) ? `group:${g.parent}` : undefined,
      body,
      under: [],
      parts: this.markParts(rest, { x: 0, y: 0 }).parts,
      data: { carto: 'group', id: g.id, label: g.label, ...(g.kind ? { kind: g.kind } : {}), lane: 'true', ...(g.tone ? { tone: g.tone } : {}) },
    };
  }

  // ------------------------------------------------------------ title and legend

  private titles() {
    const { graph, theme: t } = this;
    if (!graph.title || (t.titleBlock && Object.keys(t.titleBlock).length)) return;
    const pad = t.space.pad + sheetPad(t);
    const tl = look(t).title;
    this.loose.push({ id: 'title', role: 'title', parts: [this.text('Title', pad, pad + 16, tl.caps ? graph.title.toUpperCase() : graph.title, tl.size, tl.weight as 400 | 500 | 600, t.text, 'start', { mono: tl.mono, tracking: tl.tracking })] });
    if (graph.subtitle) this.loose.push({ id: 'subtitle', role: 'subtitle', parts: [this.text('Subtitle', pad, pad + 40, graph.subtitle, t.size.subtitle, 400, t.textMuted)] });
  }

  /** The legend where the SVG has it: a row or the KEY of a paper look under (or above) the drawing, or a column beside it. */
  private legend() {
    const { graph, placed, theme: t } = this;
    const items = graph.legend ?? [];
    if (!items.length) return;
    const pad = t.space.pad + sheetPad(t);
    const where = t.legend ?? 'bottom';
    const key = look(t).legend === 'key';
    const parts: Part[] = [];
    const sample = (item: LegendItem, x: number, cy: number) => {
      parts.push(...this.swatch(item, x, cy));
      parts.push(this.text(`Legend: ${item.label}`, x + 28, cy, item.label, t.size.caption, 500, t.textMuted));
    };
    if (where === 'right') {
      const x = this.origin.x + placed.width + 40;
      parts.push(this.text('Legend', x, this.origin.y + 10, key ? 'KEY' : 'Legend', key ? 9.5 : t.size.caption, 600, t.textFaint, 'start', key ? { tracking: 1.2 } : {}));
      for (const [i, item] of items.entries()) sample(item, x, this.origin.y + 36 + i * 26);
    } else {
      const room = this.width - 2 * pad;
      const rows = key ? keyLayout(items, t, room).rows : [legendItems(graph, t).map(({ item, x }) => ({ item, x }))];
      const height = key ? (where === 'bottom' ? 54 : 44) + (rows.length - 1) * LEGEND.ROW : 40;
      // Under the drawing the block ends at the page's padding; above it, it starts under the title.
      const y0 = where === 'top' ? this.origin.y - height : this.height - pad - height;
      const first = key ? (where === 'top' ? y0 + 8 : y0 + 40) : where === 'top' ? y0 + 6 : y0 + 26;
      if (key) {
        if (where === 'bottom') parts.push(this.line('Rule', [{ x: pad, y: y0 + 16 }, { x: pad + room, y: y0 + 16 }], t.border, 1));
        parts.push(this.text('Legend', pad, first, 'KEY', 9.5, 600, t.textFaint, 'start', { tracking: 1.2 }));
      }
      for (const [i, row] of rows.entries()) for (const { item, x } of row) sample(item, pad + x, first + i * LEGEND.ROW);
    }
    this.loose.push({ id: 'legend', role: 'legend', parts });
  }

  /** One legend sample, as render's legendItem draws it. */
  private swatch(item: LegendItem, x: number, cy: number): Part[] {
    const t = this.theme;
    const lk = look(t);
    const color = item.tone ? t.tones[item.tone].fg : t.edge;
    const tone = t.tones[item.tone ?? (item.swatch === 'badge' || item.swatch === 'tile' ? 'slate' : 'blue')];
    const box = (w: number, h: number, rx: number, paint: Paint, dx = 0) => this.rect('Swatch', { x: x + dx, y: cy - h / 2, width: w, height: h }, rx, paint);
    const some = (...p: (Part | undefined)[]) => p.filter((q): q is Part => !!q);
    if (item.swatch === 'badge') {
      const back = lk.chip === 'outline' ? box(19, 13, Math.min(4, t.radius.chip), { fill: t.surface, stroke: tone.fg, strokeOpacity: 0.55, strokeWidth: 1 }, 0.5) : box(20, 14, Math.min(4, t.radius.chip), { fill: tone.bg });
      const mark = item.icon ? this.picture(item.icon, x + 4, cy - 6, 12, tone.fg, 1.6) : undefined;
      return some(back, mark ?? this.line('Swatch', [{ x: x + 6, y: cy }, { x: x + 14, y: cy }], tone.fg, 1.4, { end: 'arrow' }));
    }
    if ((item.swatch === 'tile' || item.swatch === 'fill') && item.icon && lk.legend === 'key') {
      // A kind of element: its own icon, treated as on the cards.
      return some(this.tile(x, cy - 10, 20, t.tones[item.tone ?? 'slate'], item.icon, { muted: item.muted, rx: Math.min(5.5, t.radius.tile), iconSize: lk.tile === 'bare' ? 16 : lk.tile === 'disc' || lk.tile === 'ring' ? 11 : 13 }));
    }
    if (item.swatch === 'tile') {
      const slate = t.tones.slate;
      return some(box(19, 19, 5.5, item.muted ? { fill: slate.bg, stroke: slate.line, strokeWidth: 1 } : { fill: tone.bg }, 0.5), item.icon ? this.picture(item.icon, x + 3.5, cy - 6.5, 13, tone.fg, 1.6) : undefined);
    }
    if (item.swatch === 'boundary') {
      const paper = paperTint(t, 0);
      return [box(19, 15, Math.min(4, t.radius.group), { ...(paper ? { fill: paper } : {}), stroke: paper ? (groupLine(t, t.tones.slate) ?? t.textFaint) : t.textFaint, strokeWidth: 1.2, dash: 'dashed' }, 0.5)];
    }
    if (item.swatch === 'glyph') return some(item.icon ? this.picture(item.icon, x + 3, cy - 7, 14, tone.fg, 1.75) : undefined);
    if (item.swatch === 'fill') return [box(20, 14, Math.min(7, t.radius.chip + 3), { fill: tone.bg })];
    if (item.swatch === 'outline') return [box(19, 13, Math.min(6.5, t.radius.chip + 2.5), { stroke: color, strokeOpacity: 0.7, strokeWidth: 1, dash: 'dashed' }, 0.5)];
    if (item.swatch === 'check' || item.swatch === 'check-outline') {
      const filled = item.swatch === 'check';
      return some({ ...this.rect('Swatch', { x: x + 2, y: cy - 8, width: 16, height: 16 }, 8, filled ? { fill: tone.fg } : { stroke: tone.fg, strokeWidth: 1.2, dash: 'dashed' }), outline: 'ellipse' }, this.picture('check', x + 5, cy - 5, 10, filled ? t.surface : tone.fg, 2));
    }
    return [this.line('Swatch', [{ x, y: cy }, { x: x + 20, y: cy }], color, t.stroke.edge * (item.width ?? 1) + 0.4, item.line && item.line !== 'solid' ? { dash: item.line } : {})];
  }
}

/** The first name of a CSS font stack. */
const firstFamily = (stack: string | undefined) => stack?.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '') || undefined;
