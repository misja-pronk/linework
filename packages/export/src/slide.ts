// One diagram as native PowerPoint shapes: the same geometry render/svg.ts draws, but as rounded
// rectangles with their text inside, pictures for icons and connectors bound to the shapes they
// join, so the slide stays editable. Coordinates are layout px, mapped to EMU by `k`.
import { chips, type BlockShape, type Box, type CardShape, type Chip, type FlowShape, type Graph, type GraphEdge, type GraphGroup, type GraphNode, type JourneyShape, type LegendItem, type Marker, type MatrixCell, type MatrixShape, type Placed, type Point, type StepState, type TableShape } from '@cartography/core';
import {  besideShortLine, blockMarks, blockSample, BODY, bodyLines, byDepth, cardCaption, cardInsets, cardStroke, CHIP, chipRows, DECISION_TIP, flowMarks, groundOf, groupIconRoom, journeyScene, keyLayout, labelInk, labelString, laneHeader, laneMarks, LEGEND, legendItems, legendWidth, markWidth, MATRIX, matrixGeometry, noteMargins, placeNotes, quietTheme, rowMarks, split, STACK, strongTheme, tableHeader, tagRadius, toOutline, type Ground, type JourneyMark, type PlacedNote, type StepView , endsRoom, endStyle, endTagAt, joinDot, umlEnd, rowHeight, sectionHeight, headerGroups, sampleExtra, TAG, tagBoxes, tagColors, tagsWidth, type TagStyle } from '@cartography/render';
import { chipText, fitText, groupCaptionInk, groupLabel, groupLabelInk, groupLine, look, measureText, mix, monoCell, paperTint, type Theme, type ToneColors, type Weight } from '@cartography/theme';
import { connector, group, picture, shape, table, type TableSpec, type End, type Fill, type Frame, type Geometry, type Line, type Para, type PathCmd, type Run, type ShapeSpec, type TextBody } from './shapes.ts';

/** EMU per CSS pixel at 96 dpi. */
export const PX = 9525;

export interface IconRef {
  png?: string;
  svg: string;
}

/** Hands out relationship ids for icon pictures; the deck turns them into media parts. */
export type IconSink = (name: string, color: string, size: number, stroke: number) => IconRef | undefined;

export interface Placement {
  /** EMU per layout px. */
  k: number;
  x: number;
  y: number;
}

interface Item {
  xml: string;
  box: Frame;
}

/** The deck's two typefaces: text, and the theme's monospace face for the text it sets in it. */
export interface SlideFonts {
  sans: string;
  mono: string;
}

/** How a text is set, besides size, weight and colour. */
interface Style {
  mono?: boolean;
  /** Letter-spacing in layout px. */
  tracking?: number;
}

/** The legend under the drawing: one row of samples, or the KEY of a paper look, wrapped to the drawing's width. */
function legendLayout(graph: Graph, placed: Placed, theme: Theme) {
  const items = graph.legend ?? [];
  if (!items.length) return { key: false, rows: [] as { item: LegendItem; x: number }[][], width: 0, height: 0 };
  if (look(theme).legend !== 'key') return { key: false, rows: [legendItems(graph, theme).map(({ item, x }) => ({ item, x }))], width: legendWidth(graph, theme), height: 40 };
  const lay = keyLayout(items, theme, placed.width);
  return { key: true, rows: lay.rows, width: Math.max(...lay.ends), height: 54 + (lay.rows.length - 1) * LEGEND.ROW };
}

/** Content size in layout px: the drawing plus the legend under it, and the room callouts of any step need around it (left, top: where the drawing starts). */
export function contentSize(graph: Graph, placed: Placed, theme: Theme, view?: StepView) {
  const legend = legendLayout(graph, placed, theme);
  const room = view ? noteMargins(view, placed) : { left: 0, top: 0, right: 0, bottom: 0 };
  return { width: Math.max(placed.width + room.left + room.right, legend.width), height: placed.height + room.top + room.bottom + legend.height, left: room.left, top: room.top };
}

/** `view`: one step of the drawing. Shapes keep their place and name on every step's slide. */
/** Official icons (BYO packs) as SVG data URIs by node and group id, as render() hands them to the SVG. */
export type SlideImages = { nodes?: Map<string, string>; groups?: Map<string, string> };

export function drawDiagram(graph: Graph, placed: Placed, theme: Theme, at: Placement, fonts: SlideFonts, icons: IconSink, ids: () => number, view?: StepView, images?: SlideImages): string {
  return new SlideDrawing(graph, placed, theme, at, fonts, icons, ids, view, images).draw();
}

class SlideDrawing {
  private frameIds = new Map<string, number>();
  private chipsByNode: Map<string, Chip[]>;
  /** What lies under a point: the depth tint of the group there, or the page. */
  private ground: Ground;

  constructor(
    private graph: Graph,
    private placed: Placed,
    private theme: Theme,
    private at: Placement,
    private fonts: SlideFonts,
    private icons: IconSink,
    private next: () => number,
    private view?: StepView,
    private images?: SlideImages,
  ) {
    this.chipsByNode = chips(graph);
    this.ground = groundOf(graph, placed, theme);
    this.state = view?.states[view.index];
    // A badge of a line that is not there yet is not there either.
    const state = this.state;
    if (state) for (const [id, list] of this.chipsByNode) this.chipsByNode.set(id, list.filter((c) => state.edges[c.edge] !== 'hidden'));
  }

  private state?: StepState;

  private X = (px: number) => this.at.x + px * this.at.k;
  private Y = (px: number) => this.at.y + px * this.at.k;
  private L = (px: number) => px * this.at.k;
  /** Text size in points for a size in layout px. */
  private pt = (px: number) => (px * this.at.k) / 12700;
  private frame = (x: number, y: number, w: number, h: number, rot?: number): Frame => ({ x: this.X(x), y: this.Y(y), w: this.L(w), h: this.L(h), rot });

  /** Frame ids are handed out on first use, so a connector drawn before its shape can bind to it. */
  private idFor(key: string): number {
    let id = this.frameIds.get(key);
    if (id === undefined) this.frameIds.set(key, (id = this.next()));
    return id;
  }

  private sp(s: Omit<ShapeSpec, 'id'> & { id?: number }): Item {
    return { xml: shape({ ...s, id: s.id ?? this.next() }, this.fonts.sans), box: s.frame };
  }

  private run(text: string, size: number, weight: Weight, color: string, style: Style = {}): Run {
    return { text, size: this.pt(size), bold: weight >= 600, color, ...(style.mono ? { font: this.fonts.mono, mono: true } : {}), ...(style.tracking ? { spacing: this.pt(style.tracking) } : {}) };
  }

  /** Nothing on a theme without shadows, so flat looks stay flat on the slide too. */
  private shadow() {
    const s = this.theme.shadow;
    return s.opacity > 0 ? { color: s.color, alpha: Math.min(0.3, s.opacity * 1.6), blur: this.L(8), dist: this.L(2) } : undefined;
  }

  /** One line of text, vertically centred on cy, anchored like SVG text-anchor. */
  private text(x: number, cy: number, s: string, size: number, weight: Weight, color: string, anchor: 'start' | 'middle' | 'end' = 'start', name = 'Text', style: Style = {}): Item {
    const w = measureText(s, size, weight, style.mono ? 'mono' : 'sans', style.tracking ?? 0) * 1.12 + 6;
    const h = size * 1.6;
    const x0 = anchor === 'start' ? x : anchor === 'middle' ? x - w / 2 : x - w;
    const align = anchor === 'start' ? 'l' : anchor === 'middle' ? 'ctr' : 'r';
    return this.sp({ name, frame: this.frame(x0, cy - h / 2, w, h), geom: { prst: 'rect' }, fill: null, line: null, textBox: true, text: { paras: [{ align, runs: [this.run(s, size, weight, color, style)] }] } });
  }

  /**
   * An icon in its slot, in the theme's tile style (the shapes of render's iconTile): on a soft tint,
   * a solid tone or an outlined square; bare; or on a filled roundel or in a ring.
   */
  private tile(x: number, y: number, slot: number, tone: ToneColors, name: string | undefined, o: { round?: boolean; muted?: boolean; rx?: number; iconSize?: number; image?: string } = {}): (Item | undefined)[] {
    const t = this.theme;
    const lk = look(t);
    const style = lk.tile;
    // A vendor's icon as it is: bare on a light page, else on a neutral tile (render's iconTile).
    if (o.image) {
      if (style === 'bare' && t.mode === 'light') return [this.icon(o.image, x + 3, y + 3, slot - 6, '', 0)];
      const back = this.sp({ name: 'Tile', frame: this.frame(x, y, slot, slot), geom: o.round || style === 'disc' || style === 'ring' ? { prst: 'ellipse' } : this.roundRect({ x: 0, y: 0, width: slot, height: slot }, o.rx ?? t.radius.tile), fill: { color: t.mode === 'dark' ? '#E9ECF1' : '#F3F5F8' }, line: null });
      return [back, this.icon(o.image, x + 5, y + 5, slot - 10, '', 0)];
    }
    if (!name) return [];
    const size = o.iconSize ?? Math.round((lk.iconSize * slot) / 34);
    const at = (color: string) => this.icon(name, x + (slot - size) / 2, y + (slot - size) / 2, size, color, t.stroke.icon);
    if (style === 'bare') return [at(tone.fg)];
    const circle = o.round || style === 'disc' || style === 'ring';
    const geom: Geometry = circle ? { prst: 'ellipse' } : this.roundRect({ x: 0, y: 0, width: slot, height: slot }, o.rx ?? t.radius.tile);
    const back = (fill: string, line?: Line) => this.sp({ name: 'Tile', frame: this.frame(x, y, slot, slot), geom, fill: { color: fill }, line: line ?? null });
    if (style === 'disc' && !o.muted) return [back(tone.fg), at(t.surface)];
    if (style === 'disc' || style === 'ring') return [back(t.surface, { color: tone.fg, width: this.L(1.5) }), at(tone.fg)];
    if (style === 'outline') return [back(t.surface, { color: tone.line, width: this.L(1) }), at(tone.fg)];
    const solid = style === 'solid' && !o.muted;
    return [back(o.muted ? t.surface : solid ? tone.fg : tone.bg), at(solid ? t.surface : tone.fg)];
  }

  /** A chip or tag: filled with the tone's tint, or outlined where the theme's chips are. */
  private chipLook(tone: ToneColors): { fill: Fill; line: Line | null } {
    const t = this.theme;
    return look(t).chip === 'outline' ? { fill: { color: t.surface }, line: { color: mix(tone.fg, t.surface, 0.45), width: this.L(1) } } : { fill: { color: tone.bg }, line: null };
  }

  private icon(name: string | undefined, x: number, y: number, size: number, color: string, stroke: number): Item | undefined {
    const ref = name ? this.icons(name, color, size, stroke) : undefined;
    if (!ref || !name) return undefined;
    const f = this.frame(x, y, size, size);
    const label = name.startsWith('data:') ? 'Official icon' : name;
    return { xml: picture({ id: this.next(), name: `Icon ${label}`, descr: label, frame: f, ...ref }), box: f };
  }

  private group(name: string, items: (Item | undefined)[]): Item {
    const list = items.filter((x): x is Item => !!x);
    if (list.length === 1) return list[0]!;
    const x0 = Math.min(...list.map((i) => i.box.x));
    const y0 = Math.min(...list.map((i) => i.box.y));
    const x1 = Math.max(...list.map((i) => i.box.x + i.box.w));
    const y1 = Math.max(...list.map((i) => i.box.y + i.box.h));
    const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    // Keynote and Quick Look lose freeforms inside a group (they shrink to a dot): keep those flat.
    if (list.some((i) => i.xml.includes('<a:custGeom>'))) return { xml: list.map((i) => i.xml).join(''), box };
    return { xml: group(this.next(), name, box, list.map((i) => i.xml)), box };
  }

  private roundRect(b: Box, radius: number): Geometry {
    return { prst: 'roundRect', adj: { adj: Math.min(50000, (radius / Math.max(1, Math.min(b.width, b.height))) * 100000) } };
  }

  draw(): string {
    const { graph, placed, state } = this;
    const out: string[] = [];
    // In a step, what stands back is drawn with the quiet theme and the route in focus with heavier lines; hidden things are left out.
    const full = this.theme;
    const quiet = state ? quietTheme(full) : full;
    const strong = state ? strongTheme(full) : full;
    const as = (em: string | undefined) => (this.theme = em === 'dim' ? quiet : full);
    // Lanes share one header size, as in the SVG.
    const across = (placed.direction ?? graph.direction) === 'right';
    const laneHead = across ? Math.max(0, ...graph.groups.filter((g) => g.lane).map((g) => laneHeader(g.label, full))) : full.space.group.header;
    for (const g of byDepth(graph.groups)) {
      const box = placed.groups.get(g.id);
      if (!box || state?.groups[g.id] === 'hidden') continue;
      as(state?.groups[g.id]);
      out.push((g.lane ? this.group(`Lane: ${g.label}`, this.marks(laneMarks(g, box, this.theme, across, laneHead), { x: 0, y: 0 }, this.idFor(`group:${g.id}`))) : this.drawGroup(g, box)).xml);
    }
    const badged = new Set([...chips(graph).values()].flat().map((c) => c.edge));
    const weight = (e: GraphEdge) => (state?.edges[e.id] === 'dim' ? 0 : state?.edges[e.id] === 'focus' ? 2 : 1);
    const edges = graph.edges.filter((e) => !badged.has(e.id) && (placed.edges.get(e.id)?.points.length ?? 0) > 1 && state?.edges[e.id] !== 'hidden');
    if (state) edges.sort((a, b) => weight(a) - weight(b));
    for (const e of edges) {
      this.theme = state?.edges[e.id] === 'focus' ? strong : as(state?.edges[e.id]);
      out.push(this.drawEdge(e, toOutline(placed.edges.get(e.id)!.points, graph, placed, e.from.node, e.to.node)).xml);
    }
    if (state) {
      this.theme = quiet;
      out.push(...this.junctions(edges.filter((e) => state.edges[e.id] === 'dim')).map((i) => i.xml));
      this.theme = full;
      out.push(...this.junctions(edges.filter((e) => state.edges[e.id] !== 'dim')).map((i) => i.xml));
    } else out.push(...this.junctions(edges).map((i) => i.xml));
    for (const n of graph.nodes) {
      const box = placed.nodes.get(n.id);
      if (!box || state?.nodes[n.id] === 'hidden') continue;
      const s = n.shape;
      // Sequence, git flow and roadmap diagrams have no native slide drawing yet.
      if (s.kind === 'sequence' || s.kind === 'gitflow' || s.kind === 'roadmap' || s.kind === 'journey-part') continue;
      if (s.kind === 'journey') {
        // The journey resolves its own colours per step, from the full theme.
        this.theme = full;
        out.push(this.drawJourney(s, box));
        continue;
      }
      as(state?.nodes[n.id]);
      if (s.kind === 'block') {
        out.push(this.drawBlock(n, s, box).xml);
        continue;
      }
      out.push((s.kind === 'card' ? this.drawCard(n, s, box) : s.kind === 'table' ? this.drawTable(n, s, box) : s.kind === 'flow' ? this.drawFlow(n, s, box) : this.drawMatrix(n, s, box)).xml);
      // Threat numbers on the top edge, as in the SVG.
      if (n.marks?.length && s.kind !== 'matrix') out.push(...this.tags(n.marks, box.x + box.width - 10 - tagsWidth(n.marks), box.y, 'threat').map((i) => i.xml));
    }
    for (const g of graph.groups) {
      const box = placed.groups.get(g.id);
      if (g.marks?.length && box && state?.groups[g.id] !== 'hidden') out.push(...this.tags(g.marks, box.x + box.width - 16 - tagsWidth(g.marks), box.y, 'threat').map((i) => i.xml));
    }
    for (const e of edges) {
      const pe = placed.edges.get(e.id)!;
      this.theme = state?.edges[e.id] === 'focus' ? strong : as(state?.edges[e.id]);
      if (!pe.label) continue;
      // The room kept for a context map's end tags is not the label's; threat numbers end the label.
      const room = endsRoom(e.ends);
      let lb = besideShortLine(pe.points, room ? { ...pe.label, x: pe.label.x + room, width: pe.label.width - 2 * room } : pe.label, placed);
      if (e.marks?.length) {
        const w = tagsWidth(e.marks);
        out.push(...this.tags(e.marks, lb.x + lb.width - w, lb.y + lb.height / 2, 'threat').map((i) => i.xml));
        lb = { ...lb, width: lb.width - w - TAG.GAP };
      }
      if (e.label) out.push(this.edgeLabel(e, e.label, lb).xml);
    }
    const taken: Box[] = [];
    for (const e of edges) {
      if (!e.ends) continue;
      const pts = toOutline(placed.edges.get(e.id)!.points, graph, placed, e.from.node, e.to.node);
      for (const [list, tip, from, marker] of [[e.ends.from, pts[0]!, pts[1]!, e.start], [e.ends.to, pts.at(-1)!, pts.at(-2)!, e.end]] as const) {
        if (!list?.length) continue;
        const at = endTagAt(list, tip, from, taken, marker);
        if (at) out.push(...this.tags(list, at.x, at.cy, endStyle).map((i) => i.xml));
      }
    }
    this.theme = full;
    if (state) for (const n of placeNotes(state, placed)) out.push(this.note(n).xml);
    if (graph.legend?.length) out.push(this.drawLegend(placed.height + (this.view ? noteMargins(this.view, placed).bottom : 0)).xml);
    return out.join('');
  }

  /** A callout of a step: a filled bubble next to its element, its text editable. */
  private note(n: PlacedNote): Item {
    const t = this.theme;
    return this.sp({
      name: `Note: ${n.lines.join(' ')}`,
      frame: this.frame(n.box.x, n.box.y, n.box.width, n.box.height),
      geom: this.roundRect(n.box, 8),
      fill: { color: t.text },
      line: { color: t.canvas, width: this.L(2) },
      text: { anchor: 'ctr', inset: { l: this.L(10), r: this.L(10) }, paras: n.lines.map((l) => ({ runs: [this.run(l, 12.5, 500, t.canvas)] })) },
    });
  }

  // ------------------------------------------------------------ groups and cards

  private drawGroup(g: GraphGroup, b: Box): Item {
    const t = this.theme;
    const lk = look(t).group;
    const tone = t.tones[g.tone];
    // As drawn in the SVG: capitals with tracking where the theme asks, the depth tint as fill, one contour colour.
    const lab = groupLabel(t, g.label);
    const iconRoom = groupIconRoom(t);
    const max = b.width - 32 - iconRoom;
    const label = fitText(lab.text, lab.size, 600, max, 'sans', lab.tracking);
    const runs = [this.run(label, lab.size, 600, groupLabelInk(t, tone), { tracking: lab.tracking })];
    const room = max - measureText(label, lab.size, 600, 'sans', lab.tracking) - 8;
    if (g.caption && measureText(g.caption, t.size.caption, 400) <= room) runs.push(this.run(`  ${g.caption}`, t.size.caption, 400, groupCaptionInk(t)));
    // Where a theme draws no outline, a dashed boundary still gets one.
    const outline = g.trust ? t.tones.rose.fg : (groupLine(t, tone) ?? (g.border === 'dashed' ? t.border : undefined));
    // The label sits in the frame's own text, so renaming the group in PowerPoint is a double-click.
    const lineH = lab.size * 1.21;
    const frame = this.sp({
      id: this.idFor(`group:${g.id}`),
      name: `Group: ${g.label}`,
      descr: [g.label, g.caption].filter(Boolean).join(' — '),
      frame: this.frame(b.x, b.y, b.width, b.height),
      geom: this.roundRect(b, t.radius.group),
      fill: { color: this.ground.fill(g) },
      line: outline ? { color: outline, width: this.L(g.trust ? Math.max(1.6, t.stroke.group + 0.6) : t.stroke.group), dash: g.border === 'dashed' || g.trust ? 'dashed' : 'solid' } : null,
      text: { anchor: 't', inset: { l: this.L(16 + iconRoom), t: this.L(22 - lineH / 2), r: this.L(16) }, paras: [{ runs }] },
    });
    const official = this.images?.groups?.get(g.id);
    return this.group(`Group: ${g.label}`, [frame, lk.icon ? this.icon(official ?? g.icon, b.x + 16, b.y + 22 - lk.icon / 2, lk.icon, tone.fg, 1.75) : undefined]);
  }

  private drawCard(n: GraphNode, s: CardShape, b: Box): Item {
    const t = this.theme;
    const c = t.space.card;
    const tone = t.tones[s.tone];
    const badges = this.chipsByNode.get(n.id) ?? [];
    const items: (Item | undefined)[] = [];
    // A stacked pair: the second card peeks out below and to the right.
    if (s.stack) {
      const back = { x: b.x + STACK, y: b.y + STACK, width: b.width - STACK, height: b.height - STACK };
      items.push(this.sp({ name: 'Second of a pair', frame: this.frame(back.x, back.y, back.width, back.height), geom: this.roundRect(back, t.radius.card), fill: { color: t.surface }, line: { color: t.textFaint, alpha: 0.45, width: this.L(t.stroke.card) }, shadow: this.shadow() }));
      b = { ...b, width: b.width - STACK, height: b.height - STACK };
    }
    const body = s.body && !badges.length ? bodyLines(s.body, b.width, t) : [];
    const top = badges.length || body.length ? c.height : b.height;
    const muted = !!s.muted;
    const inset = cardInsets(s, t);
    const centred = inset.centred && !badges.length;
    const room = b.width - inset.left - inset.right;
    const caption = cardCaption(s);
    const cy = b.y + top / 2;
    const paras: Para[] = [{ align: centred ? 'ctr' : 'l', runs: [this.run(fitText(s.label, t.size.label, 600, room), t.size.label, 600, muted ? t.textMuted : t.text)] }];
    // Label and caption centres sit 17.5 px apart in the SVG; 100% line spacing gives ~15, add the rest above.
    if (caption) paras.push({ align: centred ? 'ctr' : 'l', before: this.pt(2.4), runs: [this.run(fitText(caption, t.size.caption, 400, room), t.size.caption, 400, muted ? t.textFaint : t.textMuted)] });
    const text: TextBody = { anchor: 'ctr', inset: { l: this.L(inset.left), r: this.L(inset.right), b: this.L(b.height - top) }, paras };
    // Out of scope (an external system): a flat grey card, so what is in scope stands out.
    const base = { id: this.idFor(`node:${n.id}`), name: s.label, descr: [s.label, caption].filter(Boolean).join(' — '), frame: this.frame(b.x, b.y, b.width, b.height), fill: { color: muted ? t.tones.slate.bg : t.surface }, shadow: muted ? undefined : this.shadow(), text };
    if (s.form === 'decision') {
      items.push(this.sp({ ...base, geom: this.decisionPath(b), line: { color: tone.fg, alpha: 0.45, width: this.L(t.stroke.card + 0.2) } }));
      items.push(...this.diamond(tone, b.x + DECISION_TIP + 23, cy, s.icon));
    } else {
      const pill = s.form === 'terminal';
      items.push(this.sp({ ...base, geom: pill ? { prst: 'roundRect', adj: { adj: 50000 } } : this.roundRect(b, t.radius.card), line: { color: muted ? t.tones.slate.line : cardStroke(t, tone), width: this.L(t.stroke.card) } }));
      items.push(...this.tile(b.x + c.padX, b.y + (top - c.tile) / 2, c.tile, tone, s.icon, { round: pill || s.form === 'person', muted, image: this.images?.nodes?.get(n.id) }));
    }
    for (const [i, line] of body.entries()) items.push(this.text(b.x + c.padX + 1, b.y + c.height + BODY.top + BODY.line * (i + 0.5), line, t.size.caption, 400, muted ? t.textFaint : t.textMuted, 'start', 'Description'));
    for (const p of chipRows(badges, room, t).placed) items.push(this.chip(p.chip, b.x + inset.left + p.x, b.y + CHIP.top + p.y, p.width));
    return this.group(`Card: ${s.label}`, items);
  }

  /** The tile of a decision: a square on its point, in the theme's tile style. */
  private diamond(tone: ToneColors, cx: number, cy: number, name: string | undefined): (Item | undefined)[] {
    const t = this.theme;
    const style = look(t).tile;
    const side = 26;
    const box = (fill: string, line?: Line) => this.sp({ name: 'Tile', frame: this.frame(cx - side / 2, cy - side / 2, side, side, 45), geom: this.roundRect({ x: 0, y: 0, width: side, height: side }, Math.min(6, t.radius.tile)), fill: { color: fill }, line: line ?? null });
    const at = (color: string) => this.icon(name, cx - 8, cy - 8, 16, color, t.stroke.icon);
    if (style === 'solid' || style === 'disc') return [box(tone.fg), at(t.surface)];
    if (style === 'soft') return [box(tone.bg), at(tone.fg)];
    // Bare, ring and outline tiles: the diamond is a thin line around the icon.
    return [box(t.surface, style === 'outline' ? { color: tone.line, width: this.L(1.2) } : { color: tone.fg, alpha: 0.55, width: this.L(1.2) }), at(tone.fg)];
  }

  /** The decision outline: pointed ends with rounded corners, sites placed like a rectangle's. */
  private decisionPath(b: Box): Geometry {
    const T = DECISION_TIP;
    const pts = [
      { x: 0, y: b.height / 2 },
      { x: T, y: 0 },
      { x: b.width - T, y: 0 },
      { x: b.width, y: b.height / 2 },
      { x: b.width - T, y: b.height },
      { x: T, y: b.height },
    ].map((p) => ({ x: this.L(p.x), y: this.L(p.y) }));
    return { path: roundedPolygon(pts, this.L(this.theme.radius.card - 4)), closed: true, sites: true };
  }

  private chip(ch: Chip, x: number, y: number, w: number): Item {
    const t = this.theme;
    const tone = t.tones[ch.tone ?? 'slate'];
    const ix = ch.icon && this.icons(ch.icon, tone.fg, CHIP.icon, 1.6) ? CHIP.icon + CHIP.iconGap : 0;
    const size = chipText(t);
    const label = fitText(ch.label, size, 500, w - 2 * CHIP.padX - ix);
    const box = { x, y, width: w, height: CHIP.height };
    const frame = this.sp({
      name: `Badge: ${ch.label}`,
      descr: ch.title,
      frame: this.frame(x, y, w, CHIP.height),
      geom: this.roundRect(box, t.radius.chip),
      ...this.chipLook(tone),
      text: { anchor: 'ctr', inset: { l: this.L(CHIP.padX + ix) }, paras: [{ runs: [this.run(label, size, 500, tone.fg)] }] },
    });
    return this.group(`Badge: ${ch.label}`, [frame, ix ? this.icon(ch.icon, x + CHIP.padX, y + (CHIP.height - CHIP.icon) / 2, CHIP.icon, tone.fg, 1.6) : undefined]);
  }

  // ------------------------------------------------------------ tables and matrices

  private hline(x0: number, x1: number, y: number, color: string, alpha?: number): Item {
    return this.sp({ name: 'Rule', frame: this.frame(x0, y, x1 - x0, 0), geom: { prst: 'line' }, fill: null, line: { color, alpha, width: this.L(1) } });
  }

  private vline(x: number, y0: number, y1: number, color: string, alpha?: number): Item {
    return this.sp({ name: 'Rule', frame: this.frame(x, y0, 0, y1 - y0), geom: { prst: 'line' }, fill: null, line: { color, alpha, width: this.L(1) } });
  }

  private drawTable(n: GraphNode, s: TableShape, b: Box): Item {
    const t = this.theme;
    const ts = t.space.table;
    const tone = t.tones[s.tone];
    const head = tableHeader(s, t);
    const lk = look(t);
    // The header in the tone, in paper with the contour under it, or left plain.
    const headFill = lk.tableHead === 'tone' ? tone.bg : lk.tableHead === 'paper' ? (paperTint(t, 1) ?? tone.bg) : undefined;
    const rule = lk.tableHead === 'paper' ? (groupLine(t, tone) ?? t.border) : t.border;
    const items: (Item | undefined)[] = [];
    items.push(this.sp({ id: this.idFor(`node:${n.id}`), name: s.title, descr: [s.title, s.caption].filter(Boolean).join(' — '), frame: this.frame(b.x, b.y, b.width, b.height), geom: this.roundRect(b, t.radius.card), fill: { color: t.surface }, line: { color: t.border, width: this.L(t.stroke.card) }, shadow: this.shadow() }));
    const titleY = s.caption ? head / 2 - 7 : head / 2;
    const r = t.radius.card - 0.5;
    items.push(
      this.sp({
        name: 'Header',
        frame: this.frame(b.x + 0.5, b.y + 0.5, b.width - 1, head - 0.5),
        geom: { prst: 'round2SameRect', adj: { adj1: (Math.max(0, r) / Math.min(b.width - 1, head - 0.5)) * 100000, adj2: 0 } },
        fill: headFill ? { color: headFill } : null,
        line: null,
        // Centre the title on titleY: trim the bottom of the text area by twice the offset.
        text: { anchor: 'ctr', inset: { l: this.L(ts.padX + 24 - 0.5), b: this.L(Math.max(0, head - 2 * titleY)) }, paras: [{ runs: [this.run(fitText(s.title, t.size.label, 600, b.width - 2 * ts.padX - 24), t.size.label, 600, t.text)] }] },
      }),
    );
    items.push(this.hline(b.x, b.x + b.width, b.y + head, rule));
    items.push(this.icon(s.icon, b.x + ts.padX, b.y + titleY - 8, 16, tone.fg, 1.75));
    if (s.caption) items.push(this.text(b.x + ts.padX, b.y + titleY + 17, fitText(s.caption, t.size.caption, 400, b.width - 2 * ts.padX), t.size.caption, 400, t.textMuted));
    let y = b.y + head;
    const marks = markWidth(s);
    const rh = rowHeight(s, t);
    for (const [i, row] of s.rows.entries()) {
      if (row.kind === 'section') {
        const sh = sectionHeight(row, t);
        // Without a label: the rule between a class's attributes and its operations.
        items.push(row.label ? this.text(b.x + ts.padX, y + sh / 2 + 2, row.label.toUpperCase(), 10, 600, t.textFaint) : this.hline(b.x, b.x + b.width, y + sh / 2, t.border));
        y += sh;
        continue;
      }
      const cy = y + rh / 2;
      if (i > 0 && s.rows[i - 1]?.kind === 'row' && s.form !== 'class') items.push(this.hline(b.x + ts.padX, b.x + b.width - ts.padX, y, t.border, 0.6));
      for (const [k, m] of rowMarks(row).entries()) items.push(this.icon(m.icon, b.x + ts.padX + k * 15, cy - 6.5, 13, t.tones[m.tone].fg, 1.75));
      if (row.sign) items.push(this.text(b.x + ts.padX, cy, row.sign, monoCell(t), 500, t.textMuted, undefined, 'Visibility', { mono: true }));
      const [name, type] = row.cells;
      // The name sits in a box as wide as the table: its left and right sites are where row-bound
      // lines attach. The type is a box of its own, right-aligned (Keynote ignores tab stops).
      items.push(
        this.sp({
          id: this.idFor(`row:${n.id}:${row.id}`),
          name: `Row: ${name?.text ?? row.id}`,
          frame: this.frame(b.x, y, b.width, rh),
          geom: { prst: 'rect' },
          fill: null,
          line: null,
          text: { anchor: 'ctr', inset: { l: this.L(ts.padX + marks), r: this.L(ts.padX) }, paras: [{ runs: [this.run(name?.text ?? '', t.size.cell, name?.strong ? 600 : 400, t.text)] }] },
        }),
      );
      // The type column is set in the monospace face where the theme asks, a step smaller.
      if (type?.text) items.push(lk.mono.type ? this.text(b.x + b.width - ts.padX, cy, type.text, monoCell(t), 400, t.textMuted, 'end', 'Type', { mono: true }) : this.text(b.x + b.width - ts.padX, cy, type.text, t.size.cell, 400, t.textMuted, 'end'));
      y += rh;
    }
    return this.group(`Table: ${s.title}`, items);
  }

  /**
   * A matrix that is a table (a threat table, a RACI or CRUD chart) as a real PowerPoint table: the
   * same columns, header and sections, with each value in its tone as bold text, so it can be edited.
   */
  private matrixTable(n: GraphNode, m: MatrixShape, b: Box): Item {
    const t = this.theme;
    const { PAD } = MATRIX;
    const g = matrixGeometry(m, t);
    const rule: Line = { color: t.border, width: this.L(1) };
    const soft: Line = { color: mix(t.border, t.surface, 0.4), width: this.L(1) };
    const head = look(t).tableHead === 'paper' ? (paperTint(t, 0) ?? t.surface) : t.surface;
    const band = paperTint(t, 1) ?? t.tones.slate.bg;
    const inset = { l: this.L(PAD), r: this.L(PAD / 2), t: this.L(6), b: this.L(6) };
    const widths = [g.rowHeader, ...g.columns];
    const cols = widths.length;
    const para = (runs: Run[], align: Para['align'] = 'l'): Para => ({ align, runs });
    const center = !m.plain;
    const valueRuns = (c: MatrixCell | undefined): Run[] => {
      if (!c || (!c.text && !c.check && !c.parts?.length)) return [this.run(m.plain ? '–' : '–', t.size.cell, 400, t.textFaint)];
      if (c.parts?.length) return c.parts.flatMap((p, k) => [...(k ? [this.run(' ', t.size.cell, 400, t.text)] : []), this.run(p.text, t.size.cell, 600, t.tones[p.tone ?? 'blue'].fg)]);
      if (c.check) return [this.run('✓', t.size.cell, 600, t.tones[c.tone ?? 'blue'].fg)];
      return [this.run(c.text!, t.size.cell, c.strong || c.tone ? 600 : 400, c.tone ? t.tones[c.tone].fg : t.text)];
    };
    const rows: TableSpec['rows'] = [];
    // Grouped columns: a row of their names over them.
    if (g.bands.length) {
      const cells: TableSpec['rows'][number]['cells'] = [{ paras: [para([])], fill: { color: head }, inset }];
      const groups = headerGroups(m.columns);
      for (let j = 0; j < m.columns.length; ) {
        const grp = groups.find(([, first]) => first === j);
        const span = grp ? grp[2] : 1;
        cells.push({ paras: [para(grp ? [this.run(grp[0].toUpperCase(), 10, 600, t.textMuted, { tracking: 0.6 })] : [], 'ctr')], fill: { color: head }, span, inset, bottom: grp ? soft : null });
        for (let k = 1; k < span; k++) cells.push({ paras: [para([])], merged: true, fill: { color: head } });
        j += span;
      }
      rows.push({ height: this.L(g.band), cells });
    }
    rows.push({
      height: this.L(MATRIX.HEAD),
      cells: [
        { paras: [para(m.corner ? [m.plain ? this.run(m.corner, t.size.cell, 600, t.text) : this.run(m.corner, t.size.caption, 500, t.textFaint)] : [])], fill: { color: head }, inset, bottom: rule },
        ...m.columns.map((c) => ({
          paras: [para([this.run(c.label, t.size.cell, 600, t.text)], center ? 'ctr' : 'l'), ...(c.caption ? [para([this.run(c.caption, t.size.caption, 400, t.textFaint)], center ? 'ctr' : 'l')] : [])],
          fill: { color: head },
          inset,
          bottom: rule,
        })),
      ],
    });
    for (const [i, r] of m.rows.entries()) {
      const sec = g.sections.find((x) => x.y + MATRIX.SECTION === g.rows[i]!.y);
      if (sec)
        rows.push({
          height: this.L(MATRIX.SECTION),
          cells: [{ paras: [para([this.run(sec.label.toUpperCase(), 10, 600, t.textMuted, { tracking: 0.6 })])], fill: { color: band }, span: cols, inset, bottom: soft }, ...Array.from({ length: cols - 1 }, () => ({ paras: [para([])], merged: true }))],
        });
      rows.push({
        height: this.L(g.rows[i]!.height),
        cells: [
          { paras: [para([this.run(r.label, t.size.cell, 600, t.text)]), ...(r.caption ? [para([this.run(r.caption, t.size.caption, 400, t.textMuted)])] : [])], fill: { color: t.surface }, inset, anchor: g.rows[i]!.height > g.rowHeight ? 't' : 'ctr', bottom: soft },
          ...m.columns.map((_, j) => ({ paras: [para(valueRuns(m.cells[i]?.[j]), center ? 'ctr' : 'l')], fill: { color: t.surface }, inset, anchor: (g.rows[i]!.height > g.rowHeight ? 't' : 'ctr') as 't' | 'ctr', bottom: soft })),
        ],
      });
    }
    const f = this.frame(b.x, b.y, b.width, b.height);
    return { xml: table({ id: this.idFor(`node:${n.id}`), name: m.corner ? `Table: ${m.corner}` : 'Table', frame: f, columns: widths.map((w) => this.L(w)), rows }, this.fonts.sans), box: f };
  }

  /** Tags on the drawing as small framed text boxes: threat numbers, a context map's U, D, ACL. */
  private tags(list: string[], x: number, cy: number, style: TagStyle | ((tag: string) => TagStyle)): Item[] {
    return tagBoxes(list, x, cy).map((b) => {
      const c = tagColors(this.theme, typeof style === 'function' ? style(b.text) : style);
      return this.sp({
        name: `Tag: ${b.text}`,
        frame: this.frame(b.x, b.y, b.width, b.height),
        geom: this.roundRect(b, 3.5),
        fill: { color: c.fill },
        line: { color: c.stroke, width: this.L(1.2) },
        text: { anchor: 'ctr', paras: [{ align: 'ctr', runs: [this.run(b.text, TAG.SIZE, 600, c.ink)] }] },
      });
    });
  }

  private drawMatrix(n: GraphNode, m: MatrixShape, b: Box): Item {
    if (m.table) return this.matrixTable(n, m, b);
    const t = this.theme;
    const { PAD, HEAD, COL_ICON, ROW_ICON } = MATRIX;
    const g = matrixGeometry(m, t);
    const tone = (x?: MatrixShape['rows'][number]['tone']) => t.tones[x ?? 'slate'];
    const items: (Item | undefined)[] = [];
    items.push(this.sp({ id: this.idFor(`node:${n.id}`), name: m.corner ?? 'Matrix', frame: this.frame(b.x, b.y, b.width, b.height), geom: this.roundRect(b, t.radius.card), fill: { color: t.surface }, line: { color: t.border, width: this.L(t.stroke.card) }, shadow: this.shadow() }));
    // Header band: on a paper look it lies on the paper tint, with the contour under it, like a table's header.
    const paper = look(t).tableHead === 'paper' ? paperTint(t, 0) : undefined;
    const pr = Math.max(0, t.radius.card - 0.5);
    if (paper) items.push(this.sp({ name: 'Header', frame: this.frame(b.x + 0.5, b.y + 0.5, b.width - 1, HEAD - 0.5), geom: { prst: 'round2SameRect', adj: { adj1: (pr / Math.min(b.width - 1, HEAD - 0.5)) * 100000, adj2: 0 } }, fill: { color: paper }, line: null }));
    items.push(this.hline(b.x, b.x + b.width, b.y + HEAD, paper ? (groupLine(t, t.tones.slate) ?? t.border) : t.border));
    if (m.corner) items.push(m.plain ? this.text(b.x + PAD, b.y + HEAD / 2, m.corner, t.size.cell, 600, t.text) : this.text(b.x + PAD, b.y + HEAD / 2, m.corner, t.size.caption, 500, t.textFaint));
    let x = b.x + g.rowHeader;
    for (const [j, col] of m.columns.entries()) {
      const w = g.columns[j]!;
      const cx = x + w / 2;
      const iconW = col.icon ? COL_ICON : 0;
      const label = fitText(col.label, t.size.cell, 600, w - 2 * PAD - iconW);
      const labelW = Math.min(w - 2 * PAD - iconW, measureText(col.label, t.size.cell, 600));
      // A plain table reads like a spreadsheet: everything flush left.
      const start = m.plain ? x + PAD : cx - (labelW + iconW) / 2;
      const cy = col.caption ? b.y + HEAD / 2 - 7 : b.y + HEAD / 2;
      items.push(this.icon(col.icon, start, cy - 7, 14, tone(col.tone).fg, 1.75));
      items.push(this.text(start + iconW, cy, label, t.size.cell, 600, t.text));
      if (col.caption) items.push(this.text(cx, cy + 16, fitText(col.caption, t.size.caption, 400, w - 2 * PAD), t.size.caption, 400, t.textFaint, 'middle'));
      items.push(this.vline(x, b.y + 10, b.y + b.height - 10, t.border, 0.5));
      x += w;
    }
    let y = b.y + HEAD;
    for (const [i, row] of m.rows.entries()) {
      const cy = y + g.rowHeight / 2;
      // A row without a label continues the one above: the rule skips its header.
      if (i > 0) items.push(this.hline(m.plain && !row.label ? b.x + g.rowHeader : b.x, b.x + b.width, y, t.border, 0.6));
      const rt = tone(row.tone);
      let tx = b.x + PAD;
      if (row.icon) {
        const style = look(t).tile;
        items.push(...this.tile(tx, cy - 11, 22, rt, row.icon, { rx: Math.min(6, t.radius.tile), iconSize: style === 'bare' ? 17 : style === 'disc' || style === 'ring' ? 12 : 14 }));
        tx += ROW_ICON;
      }
      const room = g.rowHeader - (tx - b.x) - PAD;
      if (row.caption) {
        items.push(this.text(tx, cy - 7, fitText(row.label, t.size.cell, 600, room), t.size.cell, 600, t.text));
        items.push(this.text(tx, cy + 8, fitText(row.caption, t.size.caption, 400, room), t.size.caption, 400, t.textMuted));
      } else items.push(this.text(tx, cy, fitText(row.label, t.size.cell, 600, room), t.size.cell, 600, t.text));
      let cx = b.x + g.rowHeader;
      for (const [j] of m.columns.entries()) {
        const w = g.columns[j]!;
        const c = m.cells[i]?.[j];
        if (m.plain) items.push(this.text(cx + PAD, cy, fitText(c?.text ?? '–', t.size.cell, c?.strong ? 600 : 400, w - 2 * PAD), t.size.cell, c?.strong ? 600 : 400, c?.text ? t.text : t.textFaint));
        else items.push(...this.cell(c, cx + w / 2, cy, w - 2 * PAD));
        cx += w;
      }
      y += g.rowHeight;
    }
    return this.group(`Matrix: ${m.corner ?? n.id}`, items);
  }

  private cell(c: MatrixCell | undefined, cx: number, cy: number, room: number): (Item | undefined)[] {
    const t = this.theme;
    const { PILL_H, PILL_X, NOTE, CHECK } = MATRIX;
    if (!c || (!c.text && !c.check)) return [this.text(cx, cy, '–', t.size.cell, 400, t.textFaint, 'middle')];
    const tone = t.tones[c.tone ?? 'blue'];
    const py = c.note ? cy - 8 : cy;
    const out: (Item | undefined)[] = [];
    const outline: Line = { color: tone.fg, alpha: 0.7, width: this.L(1), dash: 'dashed' };
    if (c.check) {
      const r = CHECK / 2;
      out.push(this.sp({ name: c.inherited ? 'Inherited' : 'Granted', frame: this.frame(cx - r, py - r, CHECK, CHECK), geom: { prst: 'ellipse' }, fill: { color: c.inherited ? t.surface : tone.fg }, line: c.inherited ? outline : null }));
      out.push(this.icon('check', cx - 6, py - 6, 12, c.inherited ? tone.fg : t.surface, 2.4));
    } else if (c.text) {
      const size = chipText(t);
      const label = fitText(c.text, size, 500, room - 2 * PILL_X);
      const w = measureText(label, size, 500) + 2 * PILL_X;
      // Direct: a filled tag (outlined where the theme's chips are). Inherited: always a dashed outline.
      out.push(
        this.sp({
          name: `Cell: ${c.text}`,
          frame: this.frame(cx - w / 2, py - PILL_H / 2, w, PILL_H),
          geom: this.roundRect({ x: 0, y: 0, width: w, height: PILL_H }, tagRadius(t, PILL_H)),
          ...(c.inherited ? { fill: { color: t.surface }, line: outline } : this.chipLook(tone)),
          text: { anchor: 'ctr', paras: [{ align: 'ctr', runs: [this.run(label, size, 500, tone.fg)] }] },
        }),
      );
    }
    if (c.note) out.push(this.text(cx, cy + 13, fitText(c.note, NOTE, 400, room), NOTE, 400, t.textMuted, 'middle'));
    return out;
  }

  // ------------------------------------------------------------ lines

  private edgeLine(e: GraphEdge): Line {
    // The theme's arrowhead: filled, slim, or two open strokes.
    const style = look(this.theme).line.arrow;
    const arrow: End = style === 'open' ? 'open' : style === 'slim' ? 'slim' : 'triangle';
    return {
      color: e.tone ? this.theme.tones[e.tone].fg : this.theme.edge,
      alpha: e.tone ? 0.9 : undefined,
      width: this.L(this.theme.stroke.edge * (e.width ?? 1)),
      dash: e.line,
      head: e.start === 'arrow' ? arrow : 'none',
      tail: e.end === 'arrow' ? arrow : 'none',
    };
  }

  /** Where a line end touches a shape: its frame id and connection site (top, left, bottom, right). */
  private site(p: Point, node: string, row?: string): { id: number; idx: number } | undefined {
    const shape = this.graph.nodes.find((n) => n.id === node)?.shape;
    let box = this.placed.nodes.get(node);
    let key = `node:${node}`;
    if (row && shape?.kind === 'table') {
      const y = shape.rows.reduce<{ at?: number; y: number }>((acc, r) => (r.kind === 'row' && r.id === row ? { at: acc.y, y: acc.y } : { ...acc, y: acc.y + (r.kind === 'row' ? rowHeight(shape, this.theme) : sectionHeight(r, this.theme)) }), { y: tableHeader(shape, this.theme) }).at;
      if (box && y !== undefined) {
        box = { ...box, y: box.y + y, height: rowHeight(shape, this.theme) };
        key = `row:${node}:${row}`;
      }
    }
    if (!box) {
      box = this.placed.groups.get(node);
      key = `group:${node}`;
    }
    if (!box) return undefined;
    // Only bind where the line really ends on a site (the middle of a side): PowerPoint keeps the
    // drawn geometry until a shape moves, but LibreOffice snaps bound ends to the site on open,
    // which would pull fanned-out lines together.
    const near = (a: number, b: number) => Math.abs(a - b) < 1.5;
    const midX = near(p.x, box.x + box.width / 2);
    const midY = near(p.y, box.y + box.height / 2);
    // A decision's pointed ends: a line ending on one meets the left or right site.
    const decision = shape?.kind === 'card' && shape.form === 'decision';
    if (shape?.kind === 'flow') {
      // A circle has eight sites, the four sides being the even ones; a diamond and a task count like a rectangle. Other shapes stay unbound.
      const round = shape.form === 'event' || (shape.form === 'pseudo' && shape.mark !== 'choice');
      if (shape.form === 'document' || shape.form === 'note') return undefined;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const side = midX && p.y < cy ? 0 : midY && p.x < cx ? 1 : midX && p.y > cy ? 2 : midY && p.x > cx ? 3 : -1;
      return side < 0 ? undefined : { id: this.idFor(key), idx: round ? side * 2 : side };
    }
    const idx = midY && (near(p.x, box.x) || (decision && p.x < box.x + box.width / 2)) ? 1 : midY && (near(p.x, box.x + box.width) || decision) ? 3 : midX && near(p.y, box.y) ? 0 : midX && near(p.y, box.y + box.height) ? 2 : -1;
    return idx < 0 ? undefined : { id: this.idFor(key), idx };
  }

  private drawEdge(e: GraphEdge, raw: Point[]): Item {
    const pts = clean(raw);
    const name = `Line: ${e.from.node} → ${e.to.node}${e.label ? ` (${e.label})` : ''}`;
    const line = this.edgeLine(e);
    const plain = (m: Marker) => m === 'none' || m === 'arrow';
    if (plain(e.start) && plain(e.end)) {
      const fit = fitConnector(pts.map((p) => ({ x: this.X(p.x), y: this.Y(p.y) })), 0.6 * PX);
      if (fit) {
        const xml = connector({ id: this.next(), name, frame: fit.frame, prst: fit.prst, adj: fit.adj, line, start: this.site(pts[0]!, e.from.node, e.from.row), end: this.site(pts.at(-1)!, e.to.node, e.to.row) });
        return { xml, box: fit.frame };
      }
    }
    // Long routed paths stay as drawn: a freeform with the same bends as the SVG (round, cut or square).
    const path = this.freeform(name, bentPath(pts, this.theme.radius.corner, look(this.theme).line.corner), line);
    if (plain(e.start) && plain(e.end)) return path;
    return this.group(name, [path, ...this.marker(e.end, raw.at(-1)!, raw.at(-2)!, line.color), ...this.marker(e.start, raw[0]!, raw[1]!, line.color)]);
  }

  /** An open path in layout px, written as a custom shape whose frame is the path's bounds. */
  private freeform(name: string, cmds: PxCmd[], line: Line): Item {
    const xs = cmds.flatMap((c) => c.pts.map((p) => p.x));
    const ys = cmds.flatMap((c) => c.pts.map((p) => p.y));
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const f = this.frame(x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0);
    const L = (p: Point): [number, number] => [this.L(p.x - x0), this.L(p.y - y0)];
    const path: PathCmd[] = cmds.map((c) => (c.op === 'm' ? { m: L(c.pts[0]!) } : c.op === 'l' ? { l: L(c.pts[0]!) } : { q: [...L(c.pts[0]!), ...L(c.pts[1]!)] }));
    return this.sp({ name, frame: f, geom: { path }, fill: null, line });
  }

  /** Crow's-foot and bar ends: the same strokes as the SVG markers. */
  private marker(kind: Marker, tip: Point, from: Point, color: string): Item[] {
    if (kind === 'none' || kind === 'arrow') return [];
    const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
    const d = { x: (tip.x - from.x) / len, y: (tip.y - from.y) / len };
    const nrm = { x: -d.y, y: d.x };
    const at = (back: number, side = 0) => ({ x: tip.x - d.x * back + nrm.x * side, y: tip.y - d.y * back + nrm.y * side });
    if (kind === 'triangle' || kind === 'diamond' || kind === 'filledDiamond' || kind === 'open') {
      // UML ends: the outline the SVG draws, closed and filled where it is a triangle or a diamond.
      const u = umlEnd(kind);
      const pts = u.points.map(([back, side]) => at(back, side));
      const line: Line = { color, width: this.L(this.theme.stroke.edge) };
      if (!u.closed) return [this.freeform('End', pts.map((p, i) => ({ op: i ? 'l' : 'm', pts: [p] }) as PxCmd), line)];
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      const L = (p: Point): [number, number] => [this.L(p.x - x0), this.L(p.y - y0)];
      const path: PathCmd[] = pts.map((p, i) => (i ? { l: L(p) } : { m: L(p) }));
      return [this.sp({ name: 'End', frame: this.frame(x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0), geom: { path, closed: true }, fill: { color: u.filled ? color : this.theme.surface }, line })];
    }
    const segs: [Point, Point][] = [];
    const circles: Point[] = [];
    const bar = (back: number) => segs.push([at(back, -6), at(back, 6)]);
    const crow = () => segs.push([at(12), at(0, -7)], [at(12), at(0, 7)], [at(12), at(0)]);
    if (kind === 'one') bar(8), bar(13);
    if (kind === 'zeroOrOne') bar(8), circles.push(at(17));
    if (kind === 'many') crow();
    if (kind === 'oneOrMany') crow(), bar(16);
    if (kind === 'zeroOrMany') crow(), circles.push(at(20));
    if (kind === 'slash') segs.push([at(12, -5), at(6, 5)]);
    const line: Line = { color, width: this.L(this.theme.stroke.edge) };
    const out = [this.freeform('End', segs.flatMap(([a, b]) => [{ op: 'm', pts: [a] }, { op: 'l', pts: [b] }] as PxCmd[]), line)];
    for (const c of circles) out.push(this.sp({ name: 'End', frame: this.frame(c.x - 4, c.y - 4, 8, 8), geom: { prst: 'ellipse' }, fill: { color: this.theme.surface }, line }));
    return out;
  }

  /**
   * A task, an event, a gateway or a state: its outline is one native shape that lines stay bound
   * to, grouped with its mark and its name. A task or a plain state carries its name inside, so
   * typing over it keeps it centred.
   */
  private drawFlow(n: GraphNode, s: FlowShape, b: Box): Item {
    const t = this.theme;
    const marks = flowMarks(s, b, t, this.placed.labels?.get(n.id));
    const id = this.idFor(`node:${n.id}`);
    const name = s.label || n.kind || s.form;
    const first = marks[0];
    if (first?.t === 'rect' && !s.lines?.length) {
      const texts = marks.filter((m) => m.t === 'text');
      const paras: Para[] = texts.map((m, i) => ({ align: 'ctr', before: i ? this.pt(2) : 0, runs: [this.run(m.lines.join(' '), m.size, m.weight, m.fill)] }));
      const body = this.sp({ id, name, descr: [s.label, s.caption].filter(Boolean).join(' — '), frame: this.frame(b.x, b.y, b.width, b.height), geom: this.roundRect(b, first.r ?? 0), fill: { color: t.surface }, line: { color: t.border, width: this.L(t.stroke.card) }, shadow: this.shadow(), text: { anchor: 'ctr', inset: { l: this.L(s.icon ? 31 : 8), r: this.L(8), b: this.L(s.form === 'subprocess' ? 12 : 0) }, paras } });
      return this.group(name, [body, ...this.marks(marks.slice(1).filter((m) => m.t !== 'text'), { x: 0, y: 0 })]);
    }
    return this.group(name, this.marks(marks, { x: 0, y: 0 }, id));
  }

  /** A block (a capability, a person, a team) as the marks render/block.ts lays out; its outline takes the node's id, so connectors bind to it. */
  private drawBlock(n: GraphNode, s: BlockShape, b: Box): Item {
    const name = s.label || n.kind || s.form;
    return this.group(name, this.marks(blockMarks(s, b, this.theme), { x: 0, y: 0 }, this.idFor(`node:${n.id}`)));
  }

  /** A journey as flat native shapes: the marks render/journey.ts lays out, one shape, text box or picture each. */
  private drawJourney(s: JourneyShape, b: Box): string {
    return this.marks(journeyScene(s, this.theme, this.state?.journey).marks, b).map((i) => i.xml).join('');
  }

  /** Marks as native shapes, moved by `b`; the first outline takes `id`, so connectors can bind to it. */
  private marks(marks: JourneyMark[], b: Point, id?: number): Item[] {
    const out: Item[] = [];
    const paint = (m: { fill?: string; stroke?: string; sw?: number; dash?: boolean }) => ({
      fill: m.fill && m.fill !== 'none' ? { color: m.fill } : null,
      line: m.stroke ? ({ color: m.stroke, width: this.L(m.sw ?? 1), dash: m.dash ? 'dashed' : 'solid' } as Line) : null,
    });
    const own = () => {
      const mine = id;
      id = undefined;
      return mine;
    };
    for (const m of marks) {
      if (m.t === 'rect') {
        const box = { x: b.x + m.x, y: b.y + m.y, width: m.w, height: m.h };
        out.push(this.sp({ id: own(), name: m.name ?? 'Box', frame: this.frame(box.x, box.y, m.w, m.h), geom: m.r ? this.roundRect(box, Math.min(m.r, m.w / 2, m.h / 2)) : { prst: 'rect' }, ...paint(m), shadow: m.shadow ? this.shadow() : undefined }));
      } else if (m.t === 'circle') {
        out.push(this.sp({ id: own(), name: 'Dot', frame: this.frame(b.x + m.cx - m.r, b.y + m.cy - m.r, 2 * m.r, 2 * m.r), geom: { prst: 'ellipse' }, ...paint(m) }));
      } else if (m.t === 'icon') {
        const item = this.icon(m.name, b.x + m.x, b.y + m.y, m.size, m.color, m.sw);
        if (item) out.push(item);
      } else if (m.t === 'text') {
        const gap = Math.max(0, this.pt(m.lh - 1.21 * m.size));
        const paras: Para[] = m.lines.map((l, i) => ({ align: m.align === 'c' ? 'ctr' : m.align, before: i ? gap : 0, runs: [this.run(l, m.size, m.weight, m.fill, { tracking: m.tracking, mono: m.mono })] }));
        out.push(this.sp({ name: m.lines.join(' ').slice(0, 60), frame: this.frame(b.x + m.x, b.y + m.y, m.w, m.lines.length * m.lh), geom: { prst: 'rect' }, fill: null, line: null, textBox: true, text: { paras, anchor: 'ctr' } }));
      } else {
        const pts = m.d.flatMap((c) => (c[0] === 'Z' ? [] : c[0] === 'C' ? [[c[1], c[2]], [c[3], c[4]], [c[5], c[6]]] : [[c[1], c[2]]])) as [number, number][];
        if (!pts.length) continue;
        const x0 = Math.min(...pts.map((p) => p[0]));
        const y0 = Math.min(...pts.map((p) => p[1]));
        const x1 = Math.max(...pts.map((p) => p[0]));
        const y1 = Math.max(...pts.map((p) => p[1]));
        const frame = this.frame(b.x + x0, b.y + y0, x1 - x0, y1 - y0);
        const closed = m.d.some((c) => c[0] === 'Z') || !!m.fill;
        if (m.d.length === 2 && m.d[1]![0] === 'L' && !m.fill) {
          // A straight stroke is a line shape, which every app draws and lets you drag by its ends.
          const [a, z] = pts as [[number, number], [number, number]];
          out.push(this.sp({ name: m.name ?? 'Line', frame: { ...frame, flipV: (z[0] - a[0]) * (z[1] - a[1]) < 0 }, geom: { prst: 'line' }, ...paint(m), fill: null }));
          continue;
        }
        if (pts.length === 4 && closed && m.d.every((c) => c[0] !== 'C') && pts[0]![0] === pts[2]![0] && pts[1]![1] === pts[3]![1]) {
          // A square on its point is the preset diamond, with a site on each corner.
          out.push(this.sp({ id: own(), name: m.name ?? 'Diamond', frame, geom: { prst: 'diamond' }, ...paint(m) }));
          continue;
        }
        const path: PathCmd[] = [];
        const X = (x: number) => this.L(x - x0);
        const Y = (y: number) => this.L(y - y0);
        for (const c of m.d) {
          if (c[0] === 'M') path.push({ m: [X(c[1]), Y(c[2])] });
          else if (c[0] === 'L') path.push({ l: [X(c[1]), Y(c[2])] });
          else if (c[0] === 'C') path.push({ c: [X(c[1]), Y(c[2]), X(c[3]), Y(c[4]), X(c[5]), Y(c[6])] });
        }
        out.push(this.sp({ id: own(), name: m.name ?? (closed ? 'Shape' : 'Curve'), frame, geom: { path, closed }, ...paint(m) }));
      }
    }
    return out;
  }

  private junctions(edges: GraphEdge[]): Item[] {
    const dots = new Map<string, Item>();
    for (const [i, a] of edges.entries())
      for (const b of edges.slice(i + 1)) {
        if (a.line !== b.line || a.tone !== b.tone || !joinDot(a) || !joinDot(b)) continue;
        const pa = this.placed.edges.get(a.id)!.points;
        const pb = this.placed.edges.get(b.id)!.points;
        const at = a.from.node === b.from.node ? split(pa, pb) : a.to.node === b.to.node ? split([...pa].reverse(), [...pb].reverse()) : undefined;
        if (!at) continue;
        // A filled dot, or a ring with the card colour inside.
        const l = look(this.theme).line;
        const r = l.junctionSize;
        const color = this.edgeLine(a).color;
        const mark = l.junction === 'ring' ? { fill: { color: this.theme.surface }, line: { color, width: this.L(this.theme.stroke.edge) } } : { fill: { color }, line: null };
        dots.set(`${Math.round(at.x)},${Math.round(at.y)}`, this.sp({ name: 'Junction', frame: this.frame(at.x - r, at.y - r, 2 * r, 2 * r), geom: { prst: 'ellipse' }, ...mark }));
      }
    return [...dots.values()];
  }

  /**
   * A label on a line: in a pill, on a bordered plate, or (halo) on a borderless patch in the colour
   * of the ground it lies on, so the words sit in a gap in the line.
   */
  private edgeLabel(e: GraphEdge, label: string, b: Box): Item {
    const t = this.theme;
    const lk = look(t).edgeLabel;
    const h = 20;
    const y = b.y + (b.height - h) / 2;
    const box = lk.style === 'halo' ? { x: b.x + 2, y: y + 2, width: b.width - 4, height: h - 4 } : lk.style === 'plate' ? { x: b.x, y: y + 1, width: b.width, height: h - 2 } : { x: b.x, y, width: b.width, height: h };
    const border: Line = { color: t.border, width: this.L(1) };
    const back =
      lk.style === 'halo' ? { geom: this.roundRect(box, 2), fill: { color: this.ground.under(b) }, line: null }
      : lk.style === 'plate' ? { geom: this.roundRect(box, t.radius.chip), fill: { color: t.surface }, line: border }
      : { geom: { prst: 'roundRect', adj: { adj: 50000 } } as Geometry, fill: { color: t.surface }, line: border };
    return this.sp({
      name: `Label: ${label}`,
      frame: this.frame(box.x, box.y, box.width, box.height),
      ...back,
      text: { anchor: 'ctr', paras: [{ align: 'ctr', runs: [this.run(labelString(t, label), t.size.edgeLabel, 500, labelInk(t, this.edgeLine(e).color), { mono: lk.mono, tracking: lk.tracking })] }] },
    });
  }

  // ------------------------------------------------------------ legend

  private drawLegend(top: number): Item {
    const t = this.theme;
    const lay = legendLayout(this.graph, this.placed, t);
    const items: (Item | undefined)[] = [];
    // The KEY of a paper look: a rule across, the word KEY, then the samples; else one plain row.
    const first = lay.key ? top + 40 : top + 26;
    if (lay.key) {
      items.push(this.hline(0, Math.max(this.placed.width, lay.width), top + 16, t.border));
      items.push(this.text(0, first, 'KEY', 9.5, 600, t.textFaint, 'start', 'Legend', { tracking: 1.2 }));
    }
    for (const [i, row] of lay.rows.entries())
      for (const { item, x } of row) {
        const cy = first + i * LEGEND.ROW;
        items.push(...this.swatch(item, x, cy));
        items.push(this.text(x + 28 + sampleExtra(item), cy, item.label, t.size.caption, 500, t.textMuted, 'start', `Legend: ${item.label}`));
      }
    return this.group('Legend', items);
  }

  /** One legend sample, as render's legendItem draws it. */
  private swatch(item: LegendItem, x: number, cy: number): (Item | undefined)[] {
    const t = this.theme;
    const lk = look(t);
    const color = item.tone ? t.tones[item.tone].fg : t.edge;
    const tone = t.tones[item.tone ?? (item.swatch === 'badge' || item.swatch === 'tile' ? 'slate' : 'blue')];
    const box = (w: number, h: number, rx: number, fill: Fill | null, line: Line | null, dx = 0) => this.sp({ name: 'Swatch', frame: this.frame(x + dx, cy - h / 2, w, h), geom: this.roundRect({ x: 0, y: 0, width: w, height: h }, rx), fill, line });
    if (item.swatch === 'block' && item.block) return this.marks(blockSample(item.block.form, t, x, cy, item.block.heat), { x: 0, y: 0 });
    if (item.swatch === 'badge') {
      const arrow = this.freeform('Swatch', [{ op: 'm', pts: [{ x: x + 6, y: cy }] }, { op: 'l', pts: [{ x: x + 14, y: cy }] }, { op: 'm', pts: [{ x: x + 11, y: cy - 3 }] }, { op: 'l', pts: [{ x: x + 14, y: cy }] }, { op: 'l', pts: [{ x: x + 11, y: cy + 3 }] }], { color: tone.fg, width: this.L(1.4) });
      const back = lk.chip === 'outline' ? box(19, 13, Math.min(4, t.radius.chip), { color: t.surface }, { color: tone.fg, alpha: 0.55, width: this.L(1) }, 0.5) : box(20, 14, Math.min(4, t.radius.chip), { color: tone.bg }, null);
      return [back, item.icon ? this.icon(item.icon, x + 4, cy - 6, 12, tone.fg, 1.6) : arrow];
    }
    if ((item.swatch === 'tile' || item.swatch === 'fill') && item.icon && lk.legend === 'key') {
      // A kind of element: its own icon, treated as on the cards. Shape tells the kinds apart, colour only helps.
      const kind = t.tones[item.tone ?? 'slate'];
      return this.tile(x, cy - 10, 20, kind, item.icon, { muted: item.muted, rx: Math.min(5.5, t.radius.tile), iconSize: lk.tile === 'bare' ? 16 : lk.tile === 'disc' || lk.tile === 'ring' ? 11 : 13 });
    }
    if (item.swatch === 'tile') {
      const slate = t.tones.slate;
      return [box(19, 19, 5.5, { color: item.muted ? slate.bg : tone.bg }, item.muted ? { color: slate.line, width: this.L(1) } : null, 0.5), this.icon(item.icon, x + 3.5, cy - 6.5, 13, tone.fg, 1.6)];
    }
    if (item.swatch === 'boundary') {
      // A boundary is a group: on a paper look its sample is the tint inside the contour.
      const paper = paperTint(t, 0);
      const line: Line = { color: paper ? (groupLine(t, t.tones.slate) ?? t.textFaint) : t.textFaint, width: this.L(1.2), dash: 'dashed' };
      return [box(19, 15, Math.min(4, t.radius.group), paper ? { color: paper } : null, line, 0.5)];
    }
    if (item.swatch === 'glyph') return [this.icon(item.icon, x + 3, cy - 7, 14, tone.fg, 1.75)];
    if (item.swatch === 'trust') return [this.sp({ name: 'Swatch', frame: this.frame(x, cy, 20, 0), geom: { prst: 'line' }, fill: null, line: { color: t.tones.rose.fg, width: this.L(1.8), dash: 'dashed' } })];
    if (item.swatch === 'mark' && item.tag && item.tone) {
      const w = Math.max(20, measureText(item.tag, chipText(t), 600) + 12);
      return [this.sp({ name: 'Swatch', frame: this.frame(x, cy - 9, w, 18), geom: this.roundRect({ x: 0, y: 0, width: w, height: 18 }, tagRadius(t, 18)), ...this.chipLook(tone), text: { anchor: 'ctr', paras: [{ align: 'ctr', runs: [this.run(item.tag, chipText(t), 600, tone.fg)] }] } })];
    }
    if (item.swatch === 'mark') return this.tags([item.tag ?? 'T1'], x, cy, item.tag ? endStyle(item.tag) : 'threat');
    if (item.swatch === 'fill') return [box(20, 14, Math.min(7, t.radius.chip + 3), { color: tone.bg }, null)];
    if (item.swatch === 'outline') return [box(19, 13, Math.min(6.5, t.radius.chip + 2.5), null, { color, alpha: 0.7, width: this.L(1), dash: 'dashed' }, 0.5)];
    if (item.swatch === 'check' || item.swatch === 'check-outline') {
      const filled = item.swatch === 'check';
      return [
        this.sp({ name: 'Swatch', frame: this.frame(x + 2, cy - 8, 16, 16), geom: { prst: 'ellipse' }, fill: filled ? { color: tone.fg } : null, line: filled ? null : { color: tone.fg, width: this.L(1.2), dash: 'dashed' } }),
        this.icon('check', x + 5, cy - 5, 10, filled ? t.surface : tone.fg, 2),
      ];
    }
    return [this.sp({ name: 'Swatch', frame: this.frame(x, cy, 20, 0), geom: { prst: 'line' }, fill: null, line: { color, width: this.L(t.stroke.edge * (item.width ?? 1) + 0.4), dash: item.line ?? 'solid' } })];
  }
}

// ------------------------------------------------------------ geometry helpers

interface PxCmd {
  op: 'm' | 'l' | 'q';
  pts: Point[];
}

/** Drop repeated points and the middle of straight runs: connectors count bends. */
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

/** An orthogonal line whose bends are rounded, cut at 45 degrees, or square. */
function bentPath(pts: Point[], radius: number, corner: 'round' | 'chamfer' | 'square'): PxCmd[] {
  const out: PxCmd[] = [{ op: 'm', pts: [pts[0]!] }];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1]!;
    const c = pts[i]!;
    const n = pts[i + 1]!;
    const l1 = Math.hypot(c.x - p.x, c.y - p.y);
    const l2 = Math.hypot(n.x - c.x, n.y - c.y);
    const r = corner === 'square' ? 0 : Math.min(radius, l1 / 2, l2 / 2);
    if (r < 0.5) {
      out.push({ op: 'l', pts: [c] });
      continue;
    }
    const after = { x: c.x + ((n.x - c.x) / l2) * r, y: c.y + ((n.y - c.y) / l2) * r };
    out.push({ op: 'l', pts: [{ x: c.x - ((c.x - p.x) / l1) * r, y: c.y - ((c.y - p.y) / l1) * r }] });
    out.push(corner === 'chamfer' ? { op: 'l', pts: [after] } : { op: 'q', pts: [c, after] });
  }
  out.push({ op: 'l', pts: [pts.at(-1)!] });
  return out;
}

function roundedPolygon(pts: Point[], radius: number): PathCmd[] {
  const n = pts.length;
  const out: PathCmd[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n]!;
    const c = pts[i]!;
    const q = pts[(i + 1) % n]!;
    const l1 = Math.hypot(c.x - p.x, c.y - p.y);
    const l2 = Math.hypot(q.x - c.x, q.y - c.y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    const a: [number, number] = [c.x - ((c.x - p.x) / l1) * r, c.y - ((c.y - p.y) / l1) * r];
    out.push(i ? { l: a } : { m: a });
    out.push({ q: [c.x, c.y, c.x + ((q.x - c.x) / l2) * r, c.y + ((q.y - c.y) / l2) * r] });
  }
  return out;
}

export interface ConnectorFit {
  prst: string;
  frame: Frame;
  adj?: number[];
}

/**
 * A preset connector that draws exactly these points (EMU), if there is one: straight, or an
 * elbow with one to three bends. Tries every rotation and flip; DrawingML flips inside the box,
 * then rotates about its centre. Undefined when the path needs a freeform.
 */
export function fitConnector(pts: Point[], tol: number): ConnectorFit | undefined {
  const n = pts.length;
  if (n < 2 || n > 5) return undefined;
  if (n > 2 && !pts.slice(1).every((p, i) => Math.abs(p.x - pts[i]!.x) < 1 || Math.abs(p.y - pts[i]!.y) < 1)) return undefined;
  const S = pts[0]!;
  const E = pts[n - 1]!;
  const prst = n === 2 ? 'straightConnector1' : `bentConnector${n - 1}`;
  const near = (a: Point, b: Point) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
  for (const rot of [0, 90, 180, 270])
    for (const flipH of [false, true])
      for (const flipV of [false, true]) {
        const swap = rot % 180 !== 0;
        const w = Math.abs(swap ? E.y - S.y : E.x - S.x);
        const h = Math.abs(swap ? E.x - S.x : E.y - S.y);
        const cx = (S.x + E.x) / 2;
        const cy = (S.y + E.y) / 2;
        const c = Math.round(Math.cos((rot * Math.PI) / 180));
        const s = Math.round(Math.sin((rot * Math.PI) / 180));
        const fwd = (p: Point) => {
          const x = (flipH ? w - p.x : p.x) - w / 2;
          const y = (flipV ? h - p.y : p.y) - h / 2;
          return { x: cx + x * c - y * s, y: cy + x * s + y * c };
        };
        const inv = (p: Point) => {
          const dx = p.x - cx;
          const dy = p.y - cy;
          const x = dx * c + dy * s + w / 2;
          const y = -dx * s + dy * c + h / 2;
          return { x: flipH ? w - x : x, y: flipV ? h - y : y };
        };
        let local: Point[];
        let adj: number[] | undefined;
        if (n === 2) local = [{ x: 0, y: 0 }, { x: w, y: h }];
        else if (n === 3) local = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }];
        else if (n === 4) {
          if (w < 1) continue;
          const a = inv(pts[1]!).x;
          local = [{ x: 0, y: 0 }, { x: a, y: 0 }, { x: a, y: h }, { x: w, y: h }];
          adj = [(a / w) * 100000];
        } else {
          if (w < 1 || h < 1) continue;
          const a = inv(pts[1]!).x;
          const b = inv(pts[2]!).y;
          local = [{ x: 0, y: 0 }, { x: a, y: 0 }, { x: a, y: b }, { x: w, y: b }, { x: w, y: h }];
          adj = [(a / w) * 100000, (b / h) * 100000];
        }
        if (local.every((p, j) => near(fwd(p), pts[j]!))) return { prst, frame: { x: cx - w / 2, y: cy - h / 2, w, h, rot, flipH, flipV }, adj };
      }
  return undefined;
}


