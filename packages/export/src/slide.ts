// One diagram as native PowerPoint shapes: the same geometry render/svg.ts draws, but as rounded
// rectangles with their text inside, pictures for icons and connectors bound to the shapes they
// join, so the slide stays editable. Coordinates are layout px, mapped to EMU by `k`.
import { chips, type Box, type CardShape, type Chip, type Graph, type GraphEdge, type GraphGroup, type GraphNode, type Marker, type MatrixCell, type MatrixShape, type Placed, type Point, type TableShape } from '@cartography/core';
import { besideShortLine, byDepth, cardCaption, cardInsets, CHIP, chipRows, DECISION_TIP, legendItems, legendWidth, markWidth, MATRIX, matrixGeometry, rowMarks, split, tableHeader, toOutline } from '@cartography/render';
import { fitText, measureText, type Theme, type Weight } from '@cartography/theme';
import { connector, group, picture, shape, type Frame, type Geometry, type Line, type Para, type PathCmd, type Run, type ShapeSpec, type TextBody } from './shapes.ts';

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

/** Content size in layout px: the drawing plus the legend row under it. */
export function contentSize(graph: Graph, placed: Placed, theme: Theme) {
  const legend = graph.legend?.length ? 40 : 0;
  return { width: Math.max(placed.width, legendWidth(graph, theme)), height: placed.height + legend };
}

export function drawDiagram(graph: Graph, placed: Placed, theme: Theme, at: Placement, font: string, icons: IconSink, ids: () => number): string {
  return new SlideDrawing(graph, placed, theme, at, font, icons, ids).draw();
}

class SlideDrawing {
  private frameIds = new Map<string, number>();
  private chipsByNode: Map<string, Chip[]>;

  constructor(
    private graph: Graph,
    private placed: Placed,
    private theme: Theme,
    private at: Placement,
    private font: string,
    private icons: IconSink,
    private next: () => number,
  ) {
    this.chipsByNode = chips(graph);
  }

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
    return { xml: shape({ ...s, id: s.id ?? this.next() }, this.font), box: s.frame };
  }

  private run(text: string, size: number, weight: Weight, color: string): Run {
    return { text, size: this.pt(size), bold: weight >= 600, color };
  }

  private shadow() {
    return { color: this.theme.shadow.color, alpha: Math.min(0.3, this.theme.shadow.opacity * 1.6), blur: this.L(8), dist: this.L(2) };
  }

  /** One line of text, vertically centred on cy, anchored like SVG text-anchor. */
  private text(x: number, cy: number, s: string, size: number, weight: Weight, color: string, anchor: 'start' | 'middle' | 'end' = 'start', name = 'Text'): Item {
    const w = measureText(s, size, weight) * 1.12 + 6;
    const h = size * 1.6;
    const x0 = anchor === 'start' ? x : anchor === 'middle' ? x - w / 2 : x - w;
    const align = anchor === 'start' ? 'l' : anchor === 'middle' ? 'ctr' : 'r';
    return this.sp({ name, frame: this.frame(x0, cy - h / 2, w, h), geom: { prst: 'rect' }, fill: null, line: null, textBox: true, text: { paras: [{ align, runs: [this.run(s, size, weight, color)] }] } });
  }

  private icon(name: string | undefined, x: number, y: number, size: number, color: string, stroke: number): Item | undefined {
    const ref = name ? this.icons(name, color, size, stroke) : undefined;
    if (!ref || !name) return undefined;
    const f = this.frame(x, y, size, size);
    return { xml: picture({ id: this.next(), name: `Icon ${name}`, descr: name, frame: f, ...ref }), box: f };
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
    const { graph, placed } = this;
    const out: string[] = [];
    for (const g of byDepth(graph.groups)) {
      const box = placed.groups.get(g.id);
      if (box) out.push(this.drawGroup(g, box).xml);
    }
    const badged = new Set([...this.chipsByNode.values()].flat().map((c) => c.edge));
    const edges = graph.edges.filter((e) => !badged.has(e.id) && (placed.edges.get(e.id)?.points.length ?? 0) > 1);
    for (const e of edges) out.push(this.drawEdge(e, toOutline(placed.edges.get(e.id)!.points, graph, placed, e.from.node, e.to.node)).xml);
    out.push(...this.junctions(edges).map((i) => i.xml));
    for (const n of graph.nodes) {
      const box = placed.nodes.get(n.id);
      if (!box) continue;
      const s = n.shape;
      // Sequence, git flow and roadmap diagrams have no native slide drawing yet.
      if (s.kind === 'sequence' || s.kind === 'gitflow' || s.kind === 'roadmap') continue;
      out.push((s.kind === 'card' ? this.drawCard(n, s, box) : s.kind === 'table' ? this.drawTable(n, s, box) : this.drawMatrix(n, s, box)).xml);
    }
    for (const e of edges) {
      const pe = placed.edges.get(e.id)!;
      if (e.label && pe.label) out.push(this.edgeLabel(e.label, besideShortLine(pe.points, pe.label)).xml);
    }
    if (graph.legend?.length) out.push(this.drawLegend(placed.height + 26).xml);
    return out.join('');
  }

  // ------------------------------------------------------------ groups and cards

  private drawGroup(g: GraphGroup, b: Box): Item {
    const t = this.theme;
    const tone = t.tones[g.tone];
    const label = fitText(g.label, t.size.group, 600, b.width - 56);
    const runs = [this.run(label, t.size.group, 600, t.text)];
    const room = b.width - 56 - measureText(label, t.size.group, 600) - 8;
    if (g.caption && measureText(g.caption, t.size.caption, 400) <= room) runs.push(this.run(`  ${g.caption}`, t.size.caption, 400, t.textFaint));
    // The label sits in the frame's own text, so renaming the group in PowerPoint is a double-click.
    const lineH = t.size.group * 1.21;
    const frame = this.sp({
      id: this.idFor(`group:${g.id}`),
      name: `Group: ${g.label}`,
      descr: [g.label, g.caption].filter(Boolean).join(' — '),
      frame: this.frame(b.x, b.y, b.width, b.height),
      geom: this.roundRect(b, t.radius.group),
      fill: { color: tone.wash },
      line: { color: tone.line, width: this.L(t.stroke.group), dash: g.border === 'dashed' ? 'dashed' : 'solid' },
      text: { anchor: 't', inset: { l: this.L(40), t: this.L(22 - lineH / 2), r: this.L(16) }, paras: [{ runs }] },
    });
    return this.group(`Group: ${g.label}`, [frame, this.icon(g.icon, b.x + 16, b.y + 14, 16, tone.fg, 1.75)]);
  }

  private drawCard(n: GraphNode, s: CardShape, b: Box): Item {
    const t = this.theme;
    const c = t.space.card;
    const tone = t.tones[s.tone];
    const badges = this.chipsByNode.get(n.id) ?? [];
    const top = badges.length ? c.height : b.height;
    const inset = cardInsets(s, t);
    const centred = inset.centred && !badges.length;
    const room = b.width - inset.left - inset.right;
    const caption = cardCaption(s);
    const cy = b.y + top / 2;
    const paras: Para[] = [{ align: centred ? 'ctr' : 'l', runs: [this.run(fitText(s.label, t.size.label, 600, room), t.size.label, 600, t.text)] }];
    // Label and caption centres sit 17.5 px apart in the SVG; 100% line spacing gives ~15, add the rest above.
    if (caption) paras.push({ align: centred ? 'ctr' : 'l', before: this.pt(2.4), runs: [this.run(fitText(caption, t.size.caption, 400, room), t.size.caption, 400, t.textMuted)] });
    const text: TextBody = { anchor: 'ctr', inset: { l: this.L(inset.left), r: this.L(inset.right), b: this.L(b.height - top) }, paras };
    const items: (Item | undefined)[] = [];
    const base = { id: this.idFor(`node:${n.id}`), name: s.label, descr: [s.label, caption].filter(Boolean).join(' — '), frame: this.frame(b.x, b.y, b.width, b.height), fill: { color: t.surface }, shadow: this.shadow(), text };
    if (s.form === 'decision') {
      items.push(this.sp({ ...base, geom: this.decisionPath(b), line: { color: tone.fg, alpha: 0.45, width: this.L(t.stroke.card + 0.2) } }));
      const tcx = b.x + DECISION_TIP + 23;
      const side = 26;
      items.push(this.sp({ name: 'Tile', frame: this.frame(tcx - side / 2, cy - side / 2, side, side, 45), geom: this.roundRect({ x: 0, y: 0, width: side, height: side }, 6), fill: { color: tone.bg }, line: null }));
      items.push(this.icon(s.icon, tcx - 8, cy - 8, 16, tone.fg, t.stroke.icon));
    } else {
      const pill = s.form === 'terminal';
      items.push(this.sp({ ...base, geom: pill ? { prst: 'roundRect', adj: { adj: 50000 } } : this.roundRect(b, t.radius.card), line: { color: t.border, width: this.L(t.stroke.card) } }));
      if (s.icon) {
        const tileY = b.y + (top - c.tile) / 2;
        const tile = { x: b.x + c.padX, y: tileY, width: c.tile, height: c.tile };
        items.push(this.sp({ name: 'Tile', frame: this.frame(tile.x, tile.y, c.tile, c.tile), geom: pill ? { prst: 'ellipse' } : this.roundRect(tile, t.radius.tile), fill: { color: tone.bg }, line: null }));
        items.push(this.icon(s.icon, tile.x + (c.tile - 18) / 2, tileY + (c.tile - 18) / 2, 18, tone.fg, t.stroke.icon));
      }
    }
    for (const p of chipRows(badges, room, t).placed) items.push(this.chip(p.chip, b.x + inset.left + p.x, b.y + CHIP.top + p.y, p.width));
    return this.group(`Card: ${s.label}`, items);
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
    const label = fitText(ch.label, t.size.edgeLabel, 500, w - 2 * CHIP.padX - ix);
    const box = { x, y, width: w, height: CHIP.height };
    const frame = this.sp({
      name: `Badge: ${ch.label}`,
      descr: ch.title,
      frame: this.frame(x, y, w, CHIP.height),
      geom: this.roundRect(box, t.radius.chip),
      fill: { color: tone.bg },
      line: null,
      text: { anchor: 'ctr', inset: { l: this.L(CHIP.padX + ix) }, paras: [{ runs: [this.run(label, t.size.edgeLabel, 500, tone.fg)] }] },
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
    const items: (Item | undefined)[] = [];
    items.push(this.sp({ id: this.idFor(`node:${n.id}`), name: s.title, descr: [s.title, s.caption].filter(Boolean).join(' — '), frame: this.frame(b.x, b.y, b.width, b.height), geom: this.roundRect(b, t.radius.card), fill: { color: t.surface }, line: { color: t.border, width: this.L(t.stroke.card) }, shadow: this.shadow() }));
    const titleY = s.caption ? head / 2 - 7 : head / 2;
    const r = t.radius.card - 0.5;
    items.push(
      this.sp({
        name: 'Header',
        frame: this.frame(b.x + 0.5, b.y + 0.5, b.width - 1, head - 0.5),
        geom: { prst: 'round2SameRect', adj: { adj1: (r / Math.min(b.width - 1, head - 0.5)) * 100000, adj2: 0 } },
        fill: { color: tone.bg },
        line: null,
        // Centre the title on titleY: trim the bottom of the text area by twice the offset.
        text: { anchor: 'ctr', inset: { l: this.L(ts.padX + 24 - 0.5), b: this.L(Math.max(0, head - 2 * titleY)) }, paras: [{ runs: [this.run(fitText(s.title, t.size.label, 600, b.width - 2 * ts.padX - 24), t.size.label, 600, t.text)] }] },
      }),
    );
    items.push(this.hline(b.x, b.x + b.width, b.y + head, t.border));
    items.push(this.icon(s.icon, b.x + ts.padX, b.y + titleY - 8, 16, tone.fg, 1.75));
    if (s.caption) items.push(this.text(b.x + ts.padX, b.y + titleY + 17, fitText(s.caption, t.size.caption, 400, b.width - 2 * ts.padX), t.size.caption, 400, t.textMuted));
    let y = b.y + head;
    const marks = markWidth(s);
    for (const [i, row] of s.rows.entries()) {
      if (row.kind === 'section') {
        items.push(this.text(b.x + ts.padX, y + ts.section / 2 + 2, row.label.toUpperCase(), 10, 600, t.textFaint));
        y += ts.section;
        continue;
      }
      const cy = y + ts.row / 2;
      if (i > 0 && s.rows[i - 1]?.kind === 'row') items.push(this.hline(b.x + ts.padX, b.x + b.width - ts.padX, y, t.border, 0.6));
      for (const [k, m] of rowMarks(row).entries()) items.push(this.icon(m.icon, b.x + ts.padX + k * 15, cy - 6.5, 13, t.tones[m.tone].fg, 1.75));
      const [name, type] = row.cells;
      // The name sits in a box as wide as the table: its left and right sites are where row-bound
      // lines attach. The type is a box of its own, right-aligned (Keynote ignores tab stops).
      items.push(
        this.sp({
          id: this.idFor(`row:${n.id}:${row.id}`),
          name: `Row: ${name?.text ?? row.id}`,
          frame: this.frame(b.x, y, b.width, ts.row),
          geom: { prst: 'rect' },
          fill: null,
          line: null,
          text: { anchor: 'ctr', inset: { l: this.L(ts.padX + marks), r: this.L(ts.padX) }, paras: [{ runs: [this.run(name?.text ?? '', t.size.cell, name?.strong ? 600 : 400, t.text)] }] },
        }),
      );
      if (type?.text) items.push(this.text(b.x + b.width - ts.padX, cy, type.text, t.size.cell, 400, t.textMuted, 'end'));
      y += ts.row;
    }
    return this.group(`Table: ${s.title}`, items);
  }

  private drawMatrix(n: GraphNode, m: MatrixShape, b: Box): Item {
    const t = this.theme;
    const { PAD, HEAD, COL_ICON, ROW_ICON } = MATRIX;
    const g = matrixGeometry(m, t);
    const tone = (x?: MatrixShape['rows'][number]['tone']) => t.tones[x ?? 'slate'];
    const items: (Item | undefined)[] = [];
    items.push(this.sp({ id: this.idFor(`node:${n.id}`), name: m.corner ?? 'Matrix', frame: this.frame(b.x, b.y, b.width, b.height), geom: this.roundRect(b, t.radius.card), fill: { color: t.surface }, line: { color: t.border, width: this.L(1) }, shadow: this.shadow() }));
    items.push(this.hline(b.x, b.x + b.width, b.y + HEAD, t.border));
    if (m.corner) items.push(this.text(b.x + PAD, b.y + HEAD / 2, m.corner, t.size.caption, 500, t.textFaint));
    let x = b.x + g.rowHeader;
    for (const [j, col] of m.columns.entries()) {
      const w = g.columns[j]!;
      const cx = x + w / 2;
      const iconW = col.icon ? COL_ICON : 0;
      const label = fitText(col.label, t.size.cell, 600, w - 2 * PAD - iconW);
      const labelW = Math.min(w - 2 * PAD - iconW, measureText(col.label, t.size.cell, 600));
      const start = cx - (labelW + iconW) / 2;
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
      if (i > 0) items.push(this.hline(b.x + PAD, b.x + b.width - PAD, y, t.border, 0.6));
      const rt = tone(row.tone);
      let tx = b.x + PAD;
      if (row.icon) {
        items.push(this.sp({ name: 'Tile', frame: this.frame(tx, cy - 11, 22, 22), geom: this.roundRect({ x: 0, y: 0, width: 22, height: 22 }, 6), fill: { color: rt.bg }, line: null }));
        items.push(this.icon(row.icon, tx + 4, cy - 7, 14, rt.fg, 1.75));
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
        items.push(...this.cell(m.cells[i]?.[j], cx + w / 2, cy, w - 2 * PAD));
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
      const label = fitText(c.text, t.size.edgeLabel, 500, room - 2 * PILL_X);
      const w = measureText(label, t.size.edgeLabel, 500) + 2 * PILL_X;
      out.push(
        this.sp({
          name: `Cell: ${c.text}`,
          frame: this.frame(cx - w / 2, py - PILL_H / 2, w, PILL_H),
          geom: { prst: 'roundRect', adj: { adj: 50000 } },
          fill: { color: c.inherited ? t.surface : tone.bg },
          line: c.inherited ? outline : null,
          text: { anchor: 'ctr', paras: [{ align: 'ctr', runs: [this.run(label, t.size.edgeLabel, 500, tone.fg)] }] },
        }),
      );
    }
    if (c.note) out.push(this.text(cx, cy + 13, fitText(c.note, NOTE, 400, room), NOTE, 400, t.textMuted, 'middle'));
    return out;
  }

  // ------------------------------------------------------------ lines

  private edgeLine(e: GraphEdge): Line {
    return {
      color: e.tone ? this.theme.tones[e.tone].fg : this.theme.edge,
      alpha: e.tone ? 0.9 : undefined,
      width: this.L(this.theme.stroke.edge),
      dash: e.line,
      head: e.start === 'arrow' ? 'triangle' : 'none',
      tail: e.end === 'arrow' ? 'triangle' : 'none',
    };
  }

  /** Where a line end touches a shape: its frame id and connection site (top, left, bottom, right). */
  private site(p: Point, node: string, row?: string): { id: number; idx: number } | undefined {
    const shape = this.graph.nodes.find((n) => n.id === node)?.shape;
    let box = this.placed.nodes.get(node);
    let key = `node:${node}`;
    if (row && shape?.kind === 'table') {
      const y = shape.rows.reduce<{ at?: number; y: number }>((acc, r) => (r.kind === 'row' && r.id === row ? { at: acc.y, y: acc.y } : { ...acc, y: acc.y + (r.kind === 'row' ? this.theme.space.table.row : this.theme.space.table.section) }), { y: tableHeader(shape, this.theme) }).at;
      if (box && y !== undefined) {
        box = { ...box, y: box.y + y, height: this.theme.space.table.row };
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
    // Long routed paths stay as drawn: a freeform with the same rounded bends as the SVG.
    const path = this.freeform(name, roundedPath(pts, this.theme.radius.corner), line);
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
    const segs: [Point, Point][] = [];
    const circles: Point[] = [];
    const bar = (back: number) => segs.push([at(back, -6), at(back, 6)]);
    const crow = () => segs.push([at(12), at(0, -7)], [at(12), at(0, 7)], [at(12), at(0)]);
    if (kind === 'one') bar(8), bar(13);
    if (kind === 'zeroOrOne') bar(8), circles.push(at(17));
    if (kind === 'many') crow();
    if (kind === 'oneOrMany') crow(), bar(16);
    if (kind === 'zeroOrMany') crow(), circles.push(at(20));
    const line: Line = { color, width: this.L(this.theme.stroke.edge) };
    const out = [this.freeform('End', segs.flatMap(([a, b]) => [{ op: 'm', pts: [a] }, { op: 'l', pts: [b] }] as PxCmd[]), line)];
    for (const c of circles) out.push(this.sp({ name: 'End', frame: this.frame(c.x - 4, c.y - 4, 8, 8), geom: { prst: 'ellipse' }, fill: { color: this.theme.surface }, line }));
    return out;
  }

  private junctions(edges: GraphEdge[]): Item[] {
    const dots = new Map<string, Item>();
    for (const [i, a] of edges.entries())
      for (const b of edges.slice(i + 1)) {
        if (a.line !== b.line || a.tone !== b.tone) continue;
        const pa = this.placed.edges.get(a.id)!.points;
        const pb = this.placed.edges.get(b.id)!.points;
        const at = a.from.node === b.from.node ? split(pa, pb) : a.to.node === b.to.node ? split([...pa].reverse(), [...pb].reverse()) : undefined;
        if (at) dots.set(`${Math.round(at.x)},${Math.round(at.y)}`, this.sp({ name: 'Junction', frame: this.frame(at.x - 3, at.y - 3, 6, 6), geom: { prst: 'ellipse' }, fill: { color: this.edgeLine(a).color }, line: null }));
      }
    return [...dots.values()];
  }

  private edgeLabel(label: string, b: Box): Item {
    const t = this.theme;
    const h = 20;
    return this.sp({
      name: `Label: ${label}`,
      frame: this.frame(b.x, b.y + (b.height - h) / 2, b.width, h),
      geom: { prst: 'roundRect', adj: { adj: 50000 } },
      fill: { color: t.surface },
      line: { color: t.border, width: this.L(1) },
      text: { anchor: 'ctr', paras: [{ align: 'ctr', runs: [this.run(label, t.size.edgeLabel, 500, t.textMuted)] }] },
    });
  }

  // ------------------------------------------------------------ legend

  private drawLegend(cy: number): Item {
    const t = this.theme;
    const items: (Item | undefined)[] = [];
    for (const { item, x } of legendItems(this.graph, t)) {
      const color = item.tone ? t.tones[item.tone].fg : t.edge;
      const tone = t.tones[item.tone ?? (item.swatch === 'badge' ? 'slate' : 'blue')];
      if (item.swatch === 'badge') {
        items.push(this.sp({ name: 'Swatch', frame: this.frame(x, cy - 7, 20, 14), geom: this.roundRect({ x: 0, y: 0, width: 20, height: 14 }, 4), fill: { color: tone.bg }, line: null }));
        items.push(this.freeform('Swatch', [{ op: 'm', pts: [{ x: x + 6, y: cy }] }, { op: 'l', pts: [{ x: x + 14, y: cy }] }, { op: 'm', pts: [{ x: x + 11, y: cy - 3 }] }, { op: 'l', pts: [{ x: x + 14, y: cy }] }, { op: 'l', pts: [{ x: x + 11, y: cy + 3 }] }], { color: tone.fg, width: this.L(1.4) }));
      } else if (item.swatch === 'fill') items.push(this.sp({ name: 'Swatch', frame: this.frame(x, cy - 7, 20, 14), geom: { prst: 'roundRect', adj: { adj: 50000 } }, fill: { color: tone.bg }, line: null }));
      else if (item.swatch === 'outline') items.push(this.sp({ name: 'Swatch', frame: this.frame(x + 0.5, cy - 6.5, 19, 13), geom: { prst: 'roundRect', adj: { adj: 50000 } }, fill: null, line: { color, alpha: 0.7, width: this.L(1), dash: 'dashed' } }));
      else if (item.swatch === 'check' || item.swatch === 'check-outline') {
        const filled = item.swatch === 'check';
        items.push(this.sp({ name: 'Swatch', frame: this.frame(x + 2, cy - 8, 16, 16), geom: { prst: 'ellipse' }, fill: filled ? { color: tone.fg } : null, line: filled ? null : { color: tone.fg, width: this.L(1.2), dash: 'dashed' } }));
        items.push(this.icon('check', x + 5, cy - 5, 10, filled ? t.surface : tone.fg, 2));
      } else items.push(this.sp({ name: 'Swatch', frame: this.frame(x, cy, 20, 0), geom: { prst: 'line' }, fill: null, line: { color, width: this.L(t.stroke.edge + 0.4), dash: item.line ?? 'solid' } }));
      items.push(this.text(x + 28, cy, item.label, t.size.caption, 500, t.textMuted, 'start', `Legend: ${item.label}`));
    }
    return this.group('Legend', items);
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

function roundedPath(pts: Point[], radius: number): PxCmd[] {
  const out: PxCmd[] = [{ op: 'm', pts: [pts[0]!] }];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1]!;
    const c = pts[i]!;
    const n = pts[i + 1]!;
    const l1 = Math.hypot(c.x - p.x, c.y - p.y);
    const l2 = Math.hypot(n.x - c.x, n.y - c.y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    if (r < 0.5) {
      out.push({ op: 'l', pts: [c] });
      continue;
    }
    out.push({ op: 'l', pts: [{ x: c.x - ((c.x - p.x) / l1) * r, y: c.y - ((c.y - p.y) / l1) * r }] });
    out.push({ op: 'q', pts: [c, { x: c.x + ((n.x - c.x) / l2) * r, y: c.y + ((n.y - c.y) / l2) * r }] });
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


