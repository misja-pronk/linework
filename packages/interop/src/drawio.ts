// A scene written as a draw.io (diagrams.net) file: uncompressed mxGraph XML, one page per scene.
// Every node is one shape with its label and icon, every group a container that carries its
// contents, every line a connector bound to the two cells it joins. What each cell stands for is
// kept as data on the cell (draw.io: Edit Data), so the importer reads its own files back exactly.
import type { Box, Marker, Point } from '@cartography/core';
import { DECISION_TIP } from '@cartography/render';
import { base64, r2, xmlAttr, xmlText } from './text.ts';
import type { ArrowStyle, Connector, Element, Label, Loose, Paint, Part, Picture, Rect, Run, Scene, Stroke, Text } from './scene.ts';

type Style = Record<string, string | number | undefined>;

/** `key=value;` pairs, the way mxGraph writes a style. Bare names (a shape, `html`) come first. */
function style(names: string[], pairs: Style): string {
  const out = names.map((n) => `${n};`);
  for (const [k, v] of Object.entries(pairs)) if (v !== undefined && v !== '') out.push(`${k}=${typeof v === 'number' ? r2(v) : v};`);
  return out.join('');
}

/** An SVG as the image of a style: draw.io wants the base64 without the usual ";base64" (a semicolon ends a style entry). */
const imageUri = (svg: string) => `data:image/svg+xml,${base64(svg)}`;

const DASH = { dashed: '6 4', dotted: '1.5 3.5' };

function paintStyle(p: Paint): Style {
  return {
    fillColor: p.fill ?? 'none',
    fillOpacity: p.fill && p.fillOpacity !== undefined ? Math.round(p.fillOpacity * 100) : undefined,
    strokeColor: p.stroke ?? 'none',
    strokeWidth: p.stroke ? (p.strokeWidth ?? 1) : undefined,
    strokeOpacity: p.stroke && p.strokeOpacity !== undefined ? Math.round(p.strokeOpacity * 100) : undefined,
    dashed: p.stroke && p.dash ? 1 : undefined,
    dashPattern: p.stroke && p.dash ? DASH[p.dash] : undefined,
    fixDash: p.stroke && p.dash ? 1 : undefined,
  };
}

function outlineStyle(r: Rect): { names: string[]; pairs: Style } {
  if (r.outline === 'ellipse') return { names: ['ellipse'], pairs: {} };
  if (r.outline === 'diamond') return { names: ['rhombus'], pairs: {} };
  const round: Style = r.radius > 0 ? { rounded: 1, absoluteArcSize: 1, arcSize: 2 * r.radius } : { rounded: 0 };
  if (r.outline === 'hexagon') return { names: [], pairs: { shape: 'hexagon', perimeter: 'hexagonPerimeter2', fixedSize: 1, size: DECISION_TIP, ...round } };
  return { names: [], pairs: round };
}

const ARROW: Record<ArrowStyle, string> = { filled: 'block', slim: 'blockThin', open: 'open' };
const ER: Partial<Record<Marker, string>> = { one: 'ERmandOne', zeroOrOne: 'ERzeroToOne', many: 'ERmany', oneOrMany: 'ERoneToMany', zeroOrMany: 'ERzeroToMany', slash: 'dash' };

/** The end of a line: a plain arrowhead in the theme's style, or draw.io's crow's-foot for a cardinality. */
function markerStyle(side: 'start' | 'end', m: Marker, arrow: ArrowStyle): Style {
  if (m === 'none') return { [`${side}Arrow`]: 'none' };
  if (m === 'arrow') return { [`${side}Arrow`]: ARROW[arrow], [`${side}Fill`]: arrow === 'open' ? 0 : 1, [`${side}Size`]: arrow === 'open' ? 7 : 6 };
  // UML ends: draw.io's own block (hollow: generalization), diamonds and open arrow.
  if (m === 'triangle') return { [`${side}Arrow`]: 'block', [`${side}Fill`]: 0, [`${side}Size`]: 12 };
  if (m === 'diamond' || m === 'filledDiamond') return { [`${side}Arrow`]: 'diamond', [`${side}Fill`]: m === 'filledDiamond' ? 1 : 0, [`${side}Size`]: 14 };
  if (m === 'open') return { [`${side}Arrow`]: 'open', [`${side}Fill`]: 0, [`${side}Size`]: 8 };
  return { [`${side}Arrow`]: ER[m] ?? 'none', [`${side}Fill`]: 0, [`${side}Size`]: 10 };
}

function partBox(p: Part): Box {
  if (p.t !== 'line') return p.box;
  const xs = p.points.map((q) => q.x);
  const ys = p.points.map((q) => q.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function bounds(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
}

/** The point halfway along a line, by length: where draw.io hangs an edge's label. */
function midpoint(points: Point[]): Point {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  let left = lengths.reduce((a, b) => a + b, 0) / 2;
  for (const [i, len] of lengths.entries()) {
    if (left <= len && len > 0) {
      const a = points[i]!;
      const b = points[i + 1]!;
      return { x: a.x + ((b.x - a.x) * left) / len, y: a.y + ((b.y - a.y) * left) / len };
    }
    left -= len;
  }
  return points[0] ?? { x: 0, y: 0 };
}

/** Scenes as one draw.io file: a page each, named after the view. */
export function toDrawio(scenes: Scene[]): string {
  const names = new Set<string>();
  const pages = scenes.map((s, i) => {
    let name = s.name || `Page ${i + 1}`;
    for (let k = 2; names.has(name); k++) name = `${s.name} ${k}`;
    names.add(name);
    return new PageWriter(s).write(name, `page-${i + 1}`);
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="Cartography" agent="Cartography" version="24.7.17" pages="${pages.length}">\n${pages.join('\n')}\n</mxfile>\n`;
}

class PageWriter {
  private out: string[] = [];
  /** Top-left of every cell that holds others, in page pixels: a child's geometry is relative to it. */
  private origins = new Map<string, Point>([['1', { x: 0, y: 0 }]]);
  private byId = new Map<string, Element>();
  private sans: string;
  private mono: string;

  constructor(private scene: Scene) {
    this.sans = `${scene.fonts.sans},Helvetica,Arial,sans-serif`;
    this.mono = `${scene.fonts.mono},Menlo,Consolas,monospace`;
    for (const e of scene.elements) this.byId.set(e.id, e);
  }

  write(name: string, id: string): string {
    const s = this.scene;
    const page = { carto: 'page', type: s.type, ...(s.title ? { title: s.title } : {}), ...(s.subtitle ? { subtitle: s.subtitle } : {}), ...(s.direction ? { direction: s.direction } : {}) };
    this.out.push(`<object label=""${this.dataAttrs(page)} id="0"><mxCell/></object>`, `<mxCell id="1" parent="0"/>`);
    if (s.picture) this.part('picture', s.picture, '1');
    else {
      // Bottom to top, as the SVG paints: grounds, groups, lines, nodes, then title and legend.
      for (const l of s.back) this.looseParts(l);
      for (const e of s.elements) if (e.role === 'group') this.element(e);
      for (const c of s.connectors) this.connector(c);
      for (const e of s.elements) if (e.role !== 'group') this.element(e);
      for (const l of s.loose) this.looseParts(l);
    }
    const w = Math.ceil(s.width);
    const h = Math.ceil(s.height);
    return [
      `<diagram name="${xmlAttr(name)}" id="${id}">`,
      `<mxGraphModel dx="${w}" dy="${h}" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="${w}" pageHeight="${h}" math="0" shadow="0" background="${s.background}">`,
      '<root>',
      ...this.out,
      '</root>',
      '</mxGraphModel>',
      '</diagram>',
    ].join('\n');
  }

  // ------------------------------------------------------------ cells

  private dataAttrs(data?: Record<string, string>): string {
    if (!data) return '';
    return Object.entries(data)
      .map(([k, v]) => ` ${k === 'carto' ? 'carto' : `carto${k[0]!.toUpperCase()}${k.slice(1)}`}="${xmlAttr(v)}"`)
      .join('');
  }

  /** One mxCell; with data it is wrapped in an <object>, which is where draw.io keeps a shape's properties. */
  private cell(id: string, value: string, attrs: string, geometry: string, data?: Record<string, string>) {
    if (data) this.out.push(`<object label="${xmlAttr(value)}"${this.dataAttrs(data)} id="${xmlAttr(id)}"><mxCell ${attrs}>${geometry}</mxCell></object>`);
    else this.out.push(`<mxCell id="${xmlAttr(id)}" value="${xmlAttr(value)}" ${attrs}>${geometry}</mxCell>`);
  }

  private vertex(id: string, value: string, st: string, box: Box, parent: string, data?: Record<string, string>) {
    const o = this.origins.get(parent) ?? { x: 0, y: 0 };
    this.origins.set(id, { x: box.x, y: box.y });
    this.cell(id, value, `style="${xmlAttr(st)}" vertex="1" parent="${xmlAttr(parent)}"`, `<mxGeometry x="${r2(box.x - o.x)}" y="${r2(box.y - o.y)}" width="${r2(box.width)}" height="${r2(box.height)}" as="geometry"/>`, data);
  }

  private family = (mono?: boolean) => (mono ? this.mono : this.sans);

  /** A run as HTML: plain text where it looks like the cell's own font, a span where it differs. */
  private runHtml(r: Run, base: Run): string {
    const text = xmlText(r.text).replace(/^ +/, (m) => '&nbsp;'.repeat(m.length));
    const css: string[] = [];
    if (r.size !== base.size) css.push(`font-size:${r2(r.size)}px`);
    if (r.color !== base.color) css.push(`color:${r.color}`);
    if (r.weight >= 600 !== base.weight >= 600) css.push(`font-weight:${r.weight >= 600 ? 'bold' : 'normal'}`);
    if (!!r.mono !== !!base.mono) css.push(`font-family:${this.family(r.mono)}`);
    if (r.tracking) css.push(`letter-spacing:${r2(r.tracking)}px`);
    return css.length ? `<span style="${css.join(';')}">${text}</span>` : text;
  }

  private linesHtml(lines: Run[][]): string {
    const base = lines[0]?.[0];
    return base ? lines.map((l) => l.map((r) => this.runHtml(r, base)).join('')).join('<br>') : '';
  }

  private fontStyle(base: Run | undefined): Style {
    if (!base) return {};
    return { fontFamily: this.family(base.mono), fontSize: base.size, fontColor: base.color, fontStyle: base.weight >= 600 ? 1 : 0 };
  }

  /** Where a label sits in its shape. `spacing` is draw.io's all-round spacing, already spent on placing an image. */
  private labelStyle(l: Label | undefined, spacing = 0): Style {
    if (!l) return {};
    return {
      html: 1,
      whiteSpace: 'wrap',
      ...this.fontStyle(l.lines[0]?.[0]),
      align: l.align,
      verticalAlign: l.valign,
      spacing,
      spacingLeft: l.inset.left - spacing,
      spacingRight: l.inset.right - spacing,
      spacingTop: l.inset.top - spacing,
      spacingBottom: l.inset.bottom - spacing,
    };
  }

  // ------------------------------------------------------------ elements

  private element(e: Element) {
    if (e.role === 'table') return this.table(e);
    if (e.role === 'row') return this.row(e);
    let parent = e.parent ?? '1';
    // A stacked pair: both cards in one group, so they move as one.
    if (e.under.length) {
      const pair = `${e.id}/pair`;
      this.vertex(pair, '', 'group;connectable=0;', bounds([e.body.box, ...e.under.map(partBox)]), parent);
      for (const [i, p] of e.under.entries()) this.part(`${e.id}/under${i}`, p, pair);
      parent = pair;
    }
    const b = e.body;
    const shape = outlineStyle(b);
    const names = [...shape.names];
    let pairs: Style = { ...shape.pairs, ...paintStyle(b) };
    let icon = e.icon;
    if (e.role === 'group') pairs = { ...pairs, container: 1, collapsible: 0, recursiveResize: 0, ...this.labelStyle(b.label) };
    else {
      // The icon sits left and centred, as on a card: draw.io's label shape holds text and image in one cell.
      const dx = icon ? icon.box.x - b.box.x : 0;
      const centred = icon && Math.abs(icon.box.y + icon.box.height / 2 - (b.box.y + b.box.height / 2)) < 0.5;
      if (icon && centred && dx >= 5 && b.outline === 'rect') {
        pairs = { shape: 'label', ...pairs, image: imageUri(icon.svg), imageWidth: icon.box.width, imageHeight: icon.box.height, imageAlign: 'left', imageVerticalAlign: 'middle', ...this.labelStyle(b.label, dx - 5) };
        icon = undefined;
      } else pairs = { ...pairs, ...this.labelStyle(b.label) };
    }
    this.vertex(e.id, b.label ? this.linesHtml(b.label.lines) : '', style(names, pairs), b.box, parent, e.data);
    if (icon) this.part(`${e.id}/icon`, icon, e.id);
    for (const [i, p] of e.parts.entries()) this.part(`${e.id}/part${i}`, p, e.id);
  }

  /**
   * A table is draw.io's own: a swimlane that stacks its rows, so a row can be added, moved or
   * renamed and the table follows. The icon is part of the header's text.
   */
  private table(e: Element) {
    const b = e.body;
    const l = b.label!;
    const head = b.box.height - l.inset.bottom;
    const img = e.icon ? `<img src="data:image/svg+xml;base64,${base64(e.icon.svg)}" width="${e.icon.box.width}" height="${e.icon.box.height}" style="vertical-align:middle;margin-right:8px">` : '';
    const st = style(['swimlane'], {
      childLayout: 'stackLayout',
      horizontal: 1,
      startSize: head,
      horizontalStack: 0,
      resizeParent: 1,
      resizeParentMax: 0,
      resizeLast: 0,
      collapsible: 0,
      marginBottom: 0,
      ...outlineStyle(b).pairs,
      ...paintStyle({ ...b, fill: b.data?.headFill ?? b.fill }),
      swimlaneFillColor: b.fill,
      html: 1,
      whiteSpace: 'wrap',
      ...this.fontStyle(l.lines[0]?.[0]),
      align: 'left',
      verticalAlign: 'middle',
      spacingLeft: e.icon ? e.icon.box.x - b.box.x : l.inset.left,
      spacingRight: l.inset.right,
    });
    this.vertex(e.id, img + this.linesHtml(l.lines), st, b.box, e.parent ?? '1', e.data);
  }

  /** One row of a table: its marks (PK, FK), the name, and the type at the right, in one cell. */
  private row(e: Element) {
    const b = e.body;
    const l = b.label!;
    const base = l.lines[0]?.[0];
    const type = e.parts.find((p): p is Text => p.t === 'text' && p.name === 'Type')?.lines[0]?.[0];
    const faint = type?.color ?? base?.color ?? '#64748b';
    const marks = (e.data.marks ?? '').split(' ').filter(Boolean);
    // One span for the type, floated right: its own font goes in the same style.
    const run = type && base ? this.runHtml(type, base) : '';
    const right = !run ? '' : run.startsWith('<span style="') ? run.replace('<span style="', '<span style="float:right;') : `<span style="float:right">${run}</span>`;
    // The marks keep the width the icons had, so the names of all rows line up.
    const room = l.inset.left - l.inset.right;
    const left = room > 0 ? `<span style="display:inline-block;width:${r2(room)}px;font-size:9px;font-weight:bold;color:${faint}">${xmlText(marks.map((m) => m.toUpperCase()).join(' '))}</span>` : '';
    const ruled = e.parts.some((p) => p.t === 'line');
    const rule = e.parts.find((p): p is Stroke => p.t === 'line');
    const st = style(ruled ? [] : ['text'], {
      ...(ruled ? { shape: 'partialRectangle', top: 1, left: 0, right: 0, bottom: 0, strokeColor: rule?.color, strokeOpacity: rule?.opacity !== undefined ? Math.round(rule.opacity * 100) : undefined } : { strokeColor: 'none' }),
      fillColor: 'none',
      html: 1,
      whiteSpace: 'wrap',
      ...this.fontStyle(base),
      align: 'left',
      verticalAlign: 'middle',
      spacing: 0,
      spacingLeft: l.inset.left - Math.max(0, room),
      spacingRight: l.inset.right,
      spacingTop: l.inset.top,
      overflow: 'hidden',
      rotatable: 0,
      points: '[[0,0.5],[1,0.5]]',
      portConstraint: 'eastwest',
    });
    this.vertex(e.id, right + left + this.linesHtml(l.lines), st, b.box, e.parent ?? '1', e.data);
  }

  // ------------------------------------------------------------ parts

  private part(id: string, p: Part, parent: string) {
    if (p.t === 'rect') {
      const shape = outlineStyle(p);
      this.vertex(id, p.label ? this.linesHtml(p.label.lines) : '', style(shape.names, { ...shape.pairs, ...paintStyle(p), ...this.labelStyle(p.label), connectable: 0 }), p.box, parent, p.data);
    } else if (p.t === 'text') this.text(id, p, parent);
    else if (p.t === 'image') this.image(id, p, parent);
    else this.stroke(id, p, parent);
  }

  /** Loose words: a text cell around the measured text, anchored on the side that stays put. */
  private text(id: string, p: Text, parent: string) {
    const many = p.lines.length > 1;
    const lh = p.box.height / Math.max(1, p.lines.length);
    const html = many ? `<div style="line-height:${r2(lh)}px">${this.linesHtml(p.lines)}</div>` : this.linesHtml(p.lines);
    const st = style(['text'], {
      html: 1,
      strokeColor: 'none',
      fillColor: 'none',
      ...this.fontStyle(p.lines[0]?.[0]),
      align: p.anchor === 'start' ? 'left' : p.anchor === 'middle' ? 'center' : 'right',
      verticalAlign: many ? 'top' : 'middle',
      spacing: 0,
      connectable: 0,
    });
    this.vertex(id, html, st, p.box, parent);
  }

  private image(id: string, p: Picture, parent: string) {
    // part=1: a click on the icon selects the shape it belongs to.
    const st = style([], { shape: 'image', imageAspect: 0, aspect: 'fixed', image: imageUri(p.svg), connectable: 0, part: parent === '1' ? undefined : 1 });
    this.vertex(id, '', st, p.box, parent);
  }

  private lineStyle(l: { color: string; opacity?: number; width: number; dash?: 'dashed' | 'dotted' }): Style {
    return { strokeColor: l.color, strokeWidth: l.width, opacity: l.opacity !== undefined ? Math.round(l.opacity * 100) : undefined, dashed: l.dash ? 1 : undefined, dashPattern: l.dash ? DASH[l.dash] : undefined, fixDash: l.dash ? 1 : undefined };
  }

  private points(points: Point[], o: Point, as?: string[]): string {
    return points.map((p, i) => `<mxPoint x="${r2(p.x - o.x)}" y="${r2(p.y - o.y)}"${as?.[i] ? ` as="${as[i]}"` : ''}/>`).join('');
  }

  /** A line that joins nothing: an edge cell between two fixed points. */
  private stroke(id: string, p: Stroke, parent: string) {
    const o = this.origins.get(parent) ?? { x: 0, y: 0 };
    const st = style([], { html: 1, rounded: 0, ...this.lineStyle(p), ...markerStyle('start', p.start, 'filled'), ...markerStyle('end', p.end, 'filled'), connectable: 0 });
    const ends = this.points([p.points[0]!, p.points.at(-1)!], o, ['sourcePoint', 'targetPoint']);
    const mid = p.points.length > 2 ? `<Array as="points">${this.points(p.points.slice(1, -1), o)}</Array>` : '';
    this.cell(id, '', `style="${xmlAttr(st)}" edge="1" parent="${xmlAttr(parent)}"`, `<mxGeometry relative="1" as="geometry">${ends}${mid}</mxGeometry>`);
  }

  /** Title and decor lie on the page; a legend is one group, so it moves as one. */
  private looseParts(l: Loose) {
    let parent = '1';
    if (l.role === 'legend' && l.parts.length > 1) {
      this.vertex(l.id, '', 'group;connectable=0;', bounds(l.parts.map(partBox)), '1');
      parent = l.id;
    }
    for (const [i, p] of l.parts.entries()) this.part(l.parts.length > 1 ? `${l.id}/${i}` : l.id, p, parent);
  }

  // ------------------------------------------------------------ connectors

  /** The groups an element lies in, innermost first. */
  private groupsAround(id: string | undefined): string[] {
    const out: string[] = [];
    for (let e = id ? this.byId.get(id) : undefined; e?.parent; e = this.byId.get(e.parent)) if (this.byId.get(e.parent)?.role === 'group') out.push(e.parent);
    return out;
  }

  /** Where a point lies on a cell, as fractions of its box: draw.io's fixed connection point. */
  private port(side: 'exit' | 'entry', p: Point, id: string): Style {
    const b = this.byId.get(id)!.body.box;
    // As text: a style number is rounded to two places, too coarse for a fraction of a wide card.
    const f = (v: number) => String(Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000);
    return { [`${side}X`]: f((p.x - b.x) / b.width), [`${side}Y`]: f((p.y - b.y) / b.height), [`${side}Dx`]: 0, [`${side}Dy`]: 0, [`${side}Perimeter`]: 0 };
  }

  private connector(c: Connector) {
    const first = c.points[0]!;
    const last = c.points.at(-1)!;
    // In the innermost group around both ends, so the line moves with that group.
    const around = this.groupsAround(c.to);
    const parent = (c.from && c.to ? this.groupsAround(c.from).find((g) => around.includes(g)) : undefined) ?? '1';
    const o = this.origins.get(parent) ?? { x: 0, y: 0 };
    // Square routes are draw.io's orthogonal connector, which follows the bends given; anything else is straight pieces.
    const square = c.points.every((p, i) => i === 0 || Math.abs(p.x - c.points[i - 1]!.x) < 0.01 || Math.abs(p.y - c.points[i - 1]!.y) < 0.01);
    const lab = c.label?.label;
    const st = style([], {
      edgeStyle: square ? 'orthogonalEdgeStyle' : 'none',
      html: 1,
      rounded: c.corner > 0 ? 1 : 0,
      arcSize: c.corner > 0 ? 2 * c.corner : undefined,
      jettySize: 'auto',
      orthogonalLoop: 1,
      ...this.lineStyle(c),
      ...markerStyle('start', c.start, c.arrow),
      ...markerStyle('end', c.end, c.arrow),
      ...(c.from ? this.port('exit', first, c.from) : {}),
      ...(c.to ? this.port('entry', last, c.to) : {}),
      ...(lab ? { ...this.fontStyle(lab.lines[0]?.[0]), labelBackgroundColor: c.label!.fill ?? 'none', labelBorderColor: c.label!.stroke } : {}),
    });
    const ends = `${c.from ? '' : this.points([first], o, ['sourcePoint'])}${c.to ? '' : this.points([last], o, ['targetPoint'])}`;
    const mid = c.points.length > 2 ? `<Array as="points">${this.points(c.points.slice(1, -1), o)}</Array>` : '';
    let offset = '';
    if (c.label) {
      const m = midpoint(c.points);
      const b = c.label.box;
      offset = `<mxPoint x="${r2(b.x + b.width / 2 - m.x)}" y="${r2(b.y + b.height / 2 - m.y)}" as="offset"/>`;
    }
    const attrs = `style="${xmlAttr(st)}" edge="1" parent="${xmlAttr(parent)}"${c.from ? ` source="${xmlAttr(c.from)}"` : ''}${c.to ? ` target="${xmlAttr(c.to)}"` : ''}`;
    this.cell(c.id, lab ? this.linesHtml(lab.lines) : '', attrs, `<mxGeometry relative="1" as="geometry">${ends}${mid}${offset}</mxGeometry>`, c.data);
  }
}
