// A scene written as an Excalidraw file (.excalidraw JSON). A node is a rectangle with its label
// bound to it, a line an arrow bound to the two shapes it joins, an outer group a frame that
// carries its contents, an icon an embedded image file. What each shape stands for is kept in its
// customData, which Excalidraw saves along, so the importer reads its own files back exactly.
//
// Excalidraw draws one size and colour per text, has no frames inside frames and no letter-spacing:
// a caption is a second text grouped with its card, and an inner group is a plain rectangle.
import type { Box, Marker, Point } from '@cartography/core';
import { measureText, withTextFonts } from '@cartography/theme';
import { base64 } from './text.ts';
import type { ArrowStyle, Connector, Element, Label, Loose, Part, Picture, Rect, Run, Scene, Stroke, Text } from './scene.ts';

/** One element of the file; the fields every kind shares are filled in by `add`. */
type Shape = Record<string, unknown> & { id: string; type: string; boundElements: { id: string; type: 'text' | 'arrow' }[] | null };

/** Excalidraw's line height for text, as a factor of the font size. */
const LINE = 1.25;
/** The room one line of a label takes, as the engine spaces a label and its caption. */
const ROW = 1.3;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** A colour with its opacity as #RRGGBBAA; Excalidraw has one opacity per element, a shape here has two. */
function tint(color: string | undefined, opacity: number | undefined): string {
  if (!color || color === 'none') return 'transparent';
  if (opacity === undefined || opacity >= 1 || !/^#[0-9a-f]{6}$/i.test(color)) return color;
  return `${color}${Math.round(Math.max(0, opacity) * 255).toString(16).padStart(2, '0')}`;
}

/** A short stable id for an embedded file: the same picture is stored once. */
function hash(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    a = Math.imul(a ^ s.charCodeAt(i), 0x01000193);
    b = Math.imul(b + s.charCodeAt(i), 0x85ebca6b) ^ (b >>> 13);
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`.repeat(3).slice(0, 40);
}

const HEAD: Record<ArrowStyle, string> = { filled: 'triangle', slim: 'triangle', open: 'arrow' };
/** Excalidraw's crow's feet know one, many and one-or-many; the "zero or" ring is lost. */
const FOOT: Partial<Record<Marker, string>> = { one: 'crowfoot_one', zeroOrOne: 'crowfoot_one', many: 'crowfoot_many', zeroOrMany: 'crowfoot_many', oneOrMany: 'crowfoot_one_or_many' };
const head = (m: Marker, arrow: ArrowStyle): string | null => (m === 'none' ? null : m === 'arrow' ? HEAD[arrow] : (FOOT[m] ?? null));

const sameLook = (a: Run, b: Run) => a.size === b.size && a.color === b.color && !!a.mono === !!b.mono;

/** A scene as one Excalidraw file. Excalidraw has no pages: each view is a file of its own. */
export function toExcalidraw(scene: Scene): string {
  return withTextFonts(scene.measure, () => new Writer(scene).write());
}

class Writer {
  private out: Shape[] = [];
  private files: Record<string, { mimeType: string; id: string; dataURL: string; created: number; lastRetrieved: number }> = {};
  private byId = new Map<string, Element>();
  private shapes = new Map<string, Shape>();
  private ends: [shape: string, arrow: string][] = [];
  private n = 0;
  private page: Record<string, string>;

  constructor(private scene: Scene) {
    for (const e of scene.elements) this.byId.set(e.id, e);
    this.page = { type: scene.type, ...(scene.title ? { title: scene.title } : {}), ...(scene.subtitle ? { subtitle: scene.subtitle } : {}), ...(scene.direction ? { direction: scene.direction } : {}) };
  }

  write(): string {
    const s = this.scene;
    if (s.picture) this.picture(s.picture, 'picture', [], null);
    else {
      // Bottom to top, as the SVG paints. What lies in a frame comes right before its frame.
      for (const l of s.back) this.loose(l);
      const tops = s.elements.filter((e) => e.role === 'group' && !e.parent);
      for (const top of tops) {
        const frame = `${top.id}/frame`;
        for (const e of s.elements) if (e.role === 'group' && this.frameOf(e.id) === frame) this.element(e);
        for (const c of s.connectors) if (this.frameOfLine(c) === frame) this.connector(c);
        for (const e of s.elements) if (e.role !== 'group' && this.frameOf(e.id) === frame) this.element(e);
        const b = top.body.box;
        this.add('frame', frame, b, [], null, { name: top.data.label ?? '', strokeColor: '#bbb', customData: { carto: 'frame', id: top.data.id ?? '' } });
      }
      for (const c of s.connectors) if (!this.frameOfLine(c)) this.connector(c);
      for (const e of s.elements) if (e.role !== 'group' && !this.frameOf(e.id)) this.element(e);
      for (const l of s.loose) this.loose(l);
      for (const [shape, arrow] of this.ends) this.bind(this.shapes.get(shape), arrow, 'arrow');
    }
    const file = {
      type: 'excalidraw',
      version: 2,
      source: 'https://github.com/misja-pronk/cartography',
      elements: this.out,
      appState: { gridSize: null, viewBackgroundColor: s.background },
      files: this.files,
    };
    return `${JSON.stringify(file, null, 2)}\n`;
  }

  // ------------------------------------------------------------ the file's elements

  private add(type: string, id: string, box: Box, groups: string[], frame: string | null, more: Record<string, unknown>): Shape {
    this.n++;
    const shape: Shape = {
      id,
      type,
      x: r2(box.x),
      y: r2(box.y),
      width: r2(box.width),
      height: r2(box.height),
      angle: 0,
      strokeColor: 'transparent',
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 0,
      opacity: 100,
      groupIds: groups,
      frameId: frame,
      roundness: null,
      // The same file every time: a seed from the element's place in it, not from a clock or a die.
      seed: 1000 + this.n,
      version: 1,
      versionNonce: 5000 + this.n,
      isDeleted: false,
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
      ...more,
    };
    this.out.push(shape);
    this.shapes.set(id, shape);
    return shape;
  }

  private bind(to: Shape | undefined, id: string, type: 'text' | 'arrow') {
    if (to) to.boundElements = [...(to.boundElements ?? []), { id, type }];
  }

  /** The frame an element lies in: the one of its outermost group. */
  private frameOf(id: string | undefined): string | null {
    let top: Element | undefined;
    for (let e = id ? this.byId.get(id) : undefined; e; e = e.parent ? this.byId.get(e.parent) : undefined) if (e.role === 'group') top = e;
    return top ? `${top.id}/frame` : null;
  }

  /** A line lies in a frame when both its ends do; between frames it lies on the page. */
  private frameOfLine(c: Connector): string | null {
    const a = this.frameOf(c.from);
    return a && a === this.frameOf(c.to) ? a : null;
  }

  private text(id: string, runs: Run[], x: number, cy: number, groups: string[], frame: string | null, more: Record<string, unknown> = {}): Shape {
    const first = runs[0]!;
    const lines = runs.map((r) => r.text);
    const width = Math.max(...runs.map((r) => measureText(r.text, r.size, r.weight, r.mono ? 'mono' : 'sans', r.tracking ?? 0)));
    const height = lines.length * first.size * LINE;
    return this.add('text', id, { x, y: cy - height / 2, width, height }, groups, frame, {
      strokeColor: first.color,
      text: lines.join('\n'),
      originalText: lines.join('\n'),
      fontSize: r2(first.size),
      // 2 is Excalidraw's plain sans (Helvetica), 3 its monospace.
      fontFamily: first.mono ? 3 : 2,
      textAlign: 'left',
      verticalAlign: 'top',
      containerId: null,
      lineHeight: LINE,
      autoResize: true,
      ...more,
    });
  }

  /**
   * The words of a label, placed as the engine placed them. The first words are bound to `owner`
   * (double-click the shape to edit them); what has another size or colour is a text of its own.
   */
  private label(id: string, l: Label, box: Box, groups: string[], frame: string | null, owner?: Shape) {
    const room = { x: box.x + l.inset.left, y: box.y + l.inset.top, width: box.width - l.inset.left - l.inset.right, height: box.height - l.inset.top - l.inset.bottom };
    const heights = l.lines.map((line) => Math.max(...line.map((r) => r.size), 0) * ROW);
    const block = heights.reduce((a, b) => a + b, 0);
    let y = l.valign === 'middle' ? room.y + (room.height - block) / 2 : room.y;
    const width = (r: Run) => measureText(r.text, r.size, r.weight, r.mono ? 'mono' : 'sans', r.tracking ?? 0);
    // Lines that look like the first one are one text: a label wrapped over two lines stays one label.
    const base = l.lines[0]?.[0];
    const same = base ? l.lines.findIndex((line) => line.length !== 1 || !sameLook(line[0]!, base)) : 0;
    const joined = same < 0 ? l.lines.length : same;
    let k = 0;
    for (const [i, line] of l.lines.entries()) {
      const total = line.reduce((a, r) => a + width(r), 0);
      let x = l.align === 'left' ? room.x : l.align === 'center' ? room.x + (room.width - total) / 2 : room.x + room.width - total;
      const cy = y + heights[i]! / 2;
      y += heights[i]!;
      if (i > 0 && i < joined) continue;
      for (const [j, run] of line.entries()) {
        const lead = /^ */.exec(run.text)![0];
        const start = x + (lead ? measureText(lead, run.size, run.weight, run.mono ? 'mono' : 'sans') : 0);
        x += width(run);
        const text = run.text.trim();
        if (!text) continue;
        const first = i === 0 && j === 0;
        const runs = first && joined > 1 ? l.lines.slice(0, joined).map((ln) => ({ ...ln[0]!, text: ln[0]!.text.trim() })) : [{ ...run, text }];
        const at = first && joined > 1 ? cy + (heights.slice(1, joined).reduce((a, b) => a + b, 0)) / 2 : cy;
        // Several lines are one text as wide as the longest: it sits where the label's alignment puts it.
        const wide = Math.max(...runs.map(width));
        const left = !(first && joined > 1) ? start : l.align === 'left' ? room.x : l.align === 'center' ? room.x + (room.width - wide) / 2 : room.x + room.width - wide;
        const bound = first && owner;
        const tid = `${id}/text${k++ || ''}`;
        this.text(tid, runs, left, at, groups, frame, bound ? { containerId: owner.id, textAlign: l.align, verticalAlign: l.valign } : {});
        if (bound) this.bind(owner, tid, 'text');
      }
    }
  }

  private rect(p: Rect, id: string, groups: string[], frame: string | null, data?: Record<string, unknown>): Shape {
    const shape = this.add(p.outline === 'ellipse' ? 'ellipse' : p.outline === 'diamond' ? 'diamond' : 'rectangle', id, p.box, groups, frame, {
      strokeColor: tint(p.stroke, p.strokeOpacity),
      backgroundColor: tint(p.fill, p.fillOpacity),
      strokeWidth: p.stroke ? r2(p.strokeWidth ?? 1) : 1,
      strokeStyle: p.dash ?? 'solid',
      // A fixed corner radius: Excalidraw keeps it for any box at least four times as large.
      roundness: p.radius > 0 && p.outline !== 'ellipse' && p.outline !== 'diamond' ? { type: 3, value: r2(p.radius) } : null,
      ...(data ? { customData: data } : {}),
    });
    if (p.label) this.label(id, p.label, p.box, groups, frame, shape);
    return shape;
  }

  private picture(p: Picture, id: string, groups: string[], frame: string | null) {
    const fileId = hash(p.svg);
    this.files[fileId] ??= { mimeType: 'image/svg+xml', id: fileId, dataURL: `data:image/svg+xml;base64,${base64(p.svg)}`, created: 1, lastRetrieved: 1 };
    this.add('image', id, p.box, groups, frame, { fileId, status: 'saved', scale: [1, 1], crop: null });
  }

  /** A line or arrow through points, as Excalidraw keeps one: its first point, the rest relative to it. */
  private line(type: 'line' | 'arrow', id: string, points: Point[], l: { color: string; opacity?: number; width: number; dash?: 'dashed' | 'dotted' }, groups: string[], frame: string | null, more: Record<string, unknown>): Shape {
    const o = points[0]!;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const box = { x: o.x, y: o.y, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    return this.add(type, id, box, groups, frame, {
      strokeColor: l.color,
      strokeWidth: r2(l.width),
      strokeStyle: l.dash ?? 'solid',
      opacity: l.opacity !== undefined ? Math.round(l.opacity * 100) : 100,
      points: points.map((p) => [r2(p.x - o.x), r2(p.y - o.y)]),
      lastCommittedPoint: null,
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: null,
      ...more,
    });
  }

  private stroke(p: Stroke, id: string, groups: string[], frame: string | null) {
    const plain = p.start === 'none' && p.end === 'none';
    this.line(plain ? 'line' : 'arrow', id, p.points, p, groups, frame, plain ? {} : { startArrowhead: head(p.start, 'filled'), endArrowhead: head(p.end, 'filled'), elbowed: false });
  }

  private part(p: Part, id: string, groups: string[], frame: string | null) {
    if (p.t === 'rect') this.rect(p, id, groups, frame, p.data);
    else if (p.t === 'image') this.picture(p, id, groups, frame);
    else if (p.t === 'line') this.stroke(p, id, groups, frame);
    else this.words(p, id, groups, frame);
  }

  /** Loose words: a text per run, where the engine measured them. */
  private words(p: Text, id: string, groups: string[], frame: string | null) {
    const lh = p.box.height / Math.max(1, p.lines.length);
    let k = 0;
    for (const [i, line] of p.lines.entries()) {
      const width = (r: Run) => measureText(r.text, r.size, r.weight, r.mono ? 'mono' : 'sans', r.tracking ?? 0);
      const total = line.reduce((a, r) => a + width(r), 0);
      let x = p.anchor === 'start' ? p.box.x : p.anchor === 'middle' ? p.box.x + (p.box.width - total) / 2 : p.box.x + p.box.width - total;
      for (const run of line) {
        const lead = /^ */.exec(run.text)![0];
        const start = x + (lead ? measureText(lead, run.size, run.weight, run.mono ? 'mono' : 'sans') : 0);
        x += width(run);
        if (run.text.trim()) this.text(`${id}${k++ ? `/${k}` : ''}`, [{ ...run, text: run.text.trim() }], start, p.box.y + lh * (i + 0.5), groups, frame, { textAlign: p.anchor === 'start' ? 'left' : p.anchor === 'middle' ? 'center' : 'right' });
      }
    }
  }

  // ------------------------------------------------------------ the scene's pieces

  private element(e: Element) {
    const frame = this.frameOf(e.id);
    // Everything of one element is one Excalidraw group; the rows of a table are in the table's.
    const owner = e.role === 'row' && e.parent ? e.parent : e.id;
    const single = e.role !== 'row' && e.role !== 'table' && !e.icon && !e.under.length && !e.parts.length && (e.body.label?.lines.length ?? 0) <= 1 && (e.body.label?.lines[0]?.length ?? 0) <= 1;
    const groups = single ? [] : [`${owner}/group`];
    for (const [i, p] of e.under.entries()) this.part(p, `${e.id}/under${i}`, groups, frame);
    const parent = e.parent?.replace(/^(group|node):/, '');
    const data = { ...e.data, ...(parent ? { in: parent } : {}), ...(e.role === 'row' ? {} : { page: this.page }) };
    const b = e.body;
    if (e.role === 'table' && b.data?.headFill && b.label) {
      // The header band of a table is a second rectangle: Excalidraw fills a shape with one colour.
      this.rect({ ...b, label: undefined }, e.id, groups, frame, data);
      const band = b.box.height - b.label.inset.bottom;
      this.add('rectangle', `${e.id}/head`, { ...b.box, height: band }, groups, frame, { backgroundColor: b.data.headFill, roundness: b.radius > 0 ? { type: 3, value: r2(b.radius) } : null });
      this.label(e.id, b.label, b.box, groups, frame, this.shapes.get(e.id));
    } else this.rect(b, e.id, groups, frame, data);
    if (e.icon) this.picture(e.icon, `${e.id}/icon`, groups, frame);
    for (const [i, p] of e.parts.entries()) this.part(p, `${e.id}/part${i}`, groups, frame);
  }

  private loose(l: Loose) {
    const groups = l.role === 'legend' && l.parts.length > 1 ? [`${l.id}/group`] : [];
    for (const [i, p] of l.parts.entries()) this.part(p, l.parts.length > 1 ? `${l.id}/${i}` : l.id, groups, null);
  }

  /** Where a point lies on a shape, as fractions of its box: what an elbow arrow holds on to. */
  private binding(id: string | undefined, p: Point, square: boolean): Record<string, unknown> | null {
    const e = id ? this.byId.get(id) : undefined;
    if (!e) return null;
    const b = e.body.box;
    // Never exactly the middle: Excalidraw nudges 0.5 itself and would report the file as changed.
    const f = (v: number) => {
      const c = Math.round(v * 10000) / 10000;
      return c === 0.5 ? 0.5001 : c;
    };
    return { elementId: e.id, focus: 0, gap: 1, fixedPoint: square ? [f((p.x - b.x) / b.width), f((p.y - b.y) / b.height)] : null };
  }

  private connector(c: Connector) {
    const square = c.points.length > 1 && c.points.every((p, i) => i === 0 || Math.abs(p.x - c.points[i - 1]!.x) < 0.01 || Math.abs(p.y - c.points[i - 1]!.y) < 0.01);
    const start = this.binding(c.from, c.points[0]!, square);
    const end = this.binding(c.to, c.points.at(-1)!, square);
    // An elbow arrow keeps square corners when a shape moves; it needs both ends on a shape.
    const elbow = square && !!start && !!end && c.points.length > 2;
    const arrow = this.line('arrow', c.id, c.points, c, [], this.frameOfLine(c), {
      startBinding: start && { ...start, fixedPoint: elbow ? start.fixedPoint : null },
      endBinding: end && { ...end, fixedPoint: elbow ? end.fixedPoint : null },
      startArrowhead: head(c.start, c.arrow),
      endArrowhead: head(c.end, c.arrow),
      elbowed: elbow,
      ...(elbow ? { fixedSegments: null, startIsSpecial: null, endIsSpecial: null } : {}),
      roundness: !elbow && c.corner > 0 && c.points.length > 2 ? { type: 2 } : null,
      customData: c.data,
    });
    // A line is written before the shapes that lie over its ends: they learn of it at the end.
    if (c.from) this.ends.push([c.from, c.id]);
    if (c.to && c.to !== c.from) this.ends.push([c.to, c.id]);
    const lab = c.label?.label;
    const runs = lab?.lines.map((line) => ({ ...line[0]!, text: line.map((r) => r.text).join('').trim() })).filter((r) => r.text);
    if (c.label && runs?.length) {
      const b = c.label.box;
      const width = Math.max(...runs.map((r) => measureText(r.text, r.size, r.weight, r.mono ? 'mono' : 'sans', r.tracking ?? 0)));
      const tid = `${c.id}/text`;
      const centre = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      if (offPath(centre, c.points) <= 4) {
        // A label on its line is bound to it. Excalidraw keeps such a label at the middle of the
        // line and breaks the line there, so that is where it is written.
        const mid = middle(c.points);
        this.text(tid, runs, mid.x - width / 2, mid.y, [], this.frameOfLine(c), { containerId: c.id, textAlign: 'center', verticalAlign: 'middle' });
        this.bind(arrow, tid, 'text');
      } else {
        // A label beside its line (a message in a sequence) stays where it is, grouped with the line.
        arrow.groupIds = [`${c.id}/group`];
        this.text(tid, runs, centre.x - width / 2, centre.y, [`${c.id}/group`], this.frameOfLine(c), { textAlign: 'center' });
      }
    }
  }
}

/** The middle of a line as Excalidraw takes it: its middle point, or halfway along its middle piece. */
function middle(points: Point[]): Point {
  const n = points.length;
  if (n % 2) return points[(n - 1) / 2]!;
  const a = points[n / 2 - 1]!;
  const b = points[n / 2]!;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** How far a point lies from a line through points. */
function offPath(p: Point, points: Point[]): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = len ? Math.min(1, Math.max(0, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y))));
  }
  return best;
}
