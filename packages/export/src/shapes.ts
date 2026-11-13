// DrawingML writers: shapes, text, pictures, connectors and freeforms, in EMU. Only what the
// slide export needs, each element written in the schema's child order (PowerPoint is strict).
import { esc } from './ooxml.ts';

export interface Fill {
  color: string;
  /** 0–1 */
  alpha?: number;
}

export interface Line extends Fill {
  width: number;
  dash?: 'solid' | 'dashed' | 'dotted';
  head?: End;
  tail?: End;
  /** Line ends: flat (round when dotted) unless said; round where pieces of one stroke meet, as the SVG's round joins. */
  cap?: 'flat' | 'rnd';
  /**
   * The small arrowheads, for a line drawn wider than its weight (a double line): an app sizes ends
   * by the line's width. (Apple's importer draws neither a compound line nor a custom dash as
   * PowerPoint does, so a line's second mark is drawn as shapes of its own, not as either.)
   */
  smallEnds?: boolean;
}

/** Line ends: a filled triangle, two open strokes, or a long slim triangle. */
export type End = 'none' | 'triangle' | 'open' | 'slim';

export interface Run {
  text: string;
  size: number;
  bold?: boolean;
  color: string;
  /** Typeface of this run, when it is not the deck's (the theme's monospace face). */
  font?: string;
  mono?: boolean;
  /** Letter-spacing in points. */
  spacing?: number;
  /** UML: an abstract name in italics, a static member underlined. */
  italic?: boolean;
  underline?: boolean;
}

export interface Para {
  runs: Run[];
  align?: 'l' | 'ctr' | 'r';
  /** Space above, in points. */
  before?: number;
}

export interface TextBody {
  paras: Para[];
  anchor?: 't' | 'ctr' | 'b';
  inset?: { l?: number; t?: number; r?: number; b?: number };
  /** Wrapped at the box's width, as a step's caption is planned; else each paragraph is one line. */
  wrap?: boolean;
}

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number;
  flipH?: boolean;
  flipV?: boolean;
}

export type Geometry =
  | { prst: string; adj?: Record<string, number> }
  /** A custom path in the frame's own EMU space. */
  | { path: PathCmd[]; closed?: boolean; sites?: boolean };

export type PathCmd = { m: [number, number] } | { l: [number, number] } | { q: [number, number, number, number] } | { c: [number, number, number, number, number, number] };

const hex = (c: string) => c.replace('#', '').toUpperCase().slice(0, 6);
const i = Math.round;

export function color(c: string, alpha?: number): string {
  return alpha !== undefined && alpha < 1 ? `<a:srgbClr val="${hex(c)}"><a:alpha val="${i(alpha * 100000)}"/></a:srgbClr>` : `<a:srgbClr val="${hex(c)}"/>`;
}

const fill = (f?: Fill | null) => (f ? `<a:solidFill>${color(f.color, f.alpha)}</a:solidFill>` : '<a:noFill/>');

function line(l?: Line | null): string {
  if (!l) return '<a:ln><a:noFill/></a:ln>';
  const dash = l.dash === 'dashed' ? '<a:prstDash val="dash"/>' : l.dash === 'dotted' ? '<a:prstDash val="sysDot"/>' : '<a:prstDash val="solid"/>';
  // An end grows with the line's width: on a line drawn wider than its weight it is the small one.
  const size = l.smallEnds ? 'sm' : 'med';
  const end = (tag: string, e?: End) => (e && e !== 'none' ? `<a:${tag} type="${e === 'open' ? 'arrow' : 'triangle'}" w="${size}" len="${e === 'slim' ? 'lg' : size}"/>` : '');
  return `<a:ln w="${i(l.width)}" cap="${l.cap ?? (l.dash === 'dotted' ? 'rnd' : 'flat')}">${fill(l)}${dash}<a:round/>${end('headEnd', l.head)}${end('tailEnd', l.tail)}</a:ln>`;
}

function xfrm(f: Frame, group = false): string {
  const attrs = `${f.rot ? ` rot="${i(f.rot * 60000)}"` : ''}${f.flipH ? ' flipH="1"' : ''}${f.flipV ? ' flipV="1"' : ''}`;
  const box = `<a:off x="${i(f.x)}" y="${i(f.y)}"/><a:ext cx="${Math.max(0, i(f.w))}" cy="${Math.max(0, i(f.h))}"/>`;
  return group ? `<a:xfrm${attrs}>${box}<a:chOff x="${i(f.x)}" y="${i(f.y)}"/><a:chExt cx="${Math.max(0, i(f.w))}" cy="${Math.max(0, i(f.h))}"/></a:xfrm>` : `<a:xfrm${attrs}>${box}</a:xfrm>`;
}

function geometry(g: Geometry, f: Frame): string {
  if ('prst' in g) {
    const gd = Object.entries(g.adj ?? {}).map(([k, v]) => `<a:gd name="${k}" fmla="val ${i(v)}"/>`).join('');
    return `<a:prstGeom prst="${g.prst}"><a:avLst>${gd}</a:avLst></a:prstGeom>`;
  }
  const P = (x: number, y: number) => `<a:pt x="${i(x)}" y="${i(y)}"/>`;
  // Apple's renderer (Keynote, Quick Look) skips quadratic curves and all but the first subpath:
  // write curves as cubic and each subpath as a path of its own, as PowerPoint does itself.
  const paths: string[] = [];
  let cur: [number, number] = [0, 0];
  for (const c of g.path) {
    if ('m' in c) paths.push(`<a:moveTo>${P(...c.m)}</a:moveTo>`), (cur = c.m);
    else if ('l' in c) (paths[paths.length - 1] += `<a:lnTo>${P(...c.l)}</a:lnTo>`), (cur = c.l);
    else if ('c' in c) {
      const [x1, y1, x2, y2, x, y] = c.c;
      paths[paths.length - 1] += `<a:cubicBezTo>${P(x1, y1)}${P(x2, y2)}${P(x, y)}</a:cubicBezTo>`;
      cur = [x, y];
    } else {
      const [qx, qy, x, y] = c.q;
      const c1 = P(cur[0] + ((qx - cur[0]) * 2) / 3, cur[1] + ((qy - cur[1]) * 2) / 3);
      const c2 = P(x + ((qx - x) * 2) / 3, y + ((qy - y) * 2) / 3);
      paths[paths.length - 1] += `<a:cubicBezTo>${c1}${c2}${P(x, y)}</a:cubicBezTo>`;
      cur = [x, y];
    }
  }
  const path = (d: string) => `<a:path w="${Math.max(1, i(f.w))}" h="${Math.max(1, i(f.h))}"${g.closed ? '' : ' fill="none"'}>${d}${g.closed ? '<a:close/>' : ''}</a:path>`;
  // Sites in the same order as a rectangle's (top, left, bottom, right), so connectors bind alike.
  const sites = g.sites ? '<a:cxn ang="16200000"><a:pos x="hc" y="t"/></a:cxn><a:cxn ang="10800000"><a:pos x="l" y="vc"/></a:cxn><a:cxn ang="5400000"><a:pos x="hc" y="b"/></a:cxn><a:cxn ang="0"><a:pos x="r" y="vc"/></a:cxn>' : '';
  return (
    `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst>${sites}</a:cxnLst><a:rect l="l" t="t" r="r" b="b"/>` +
    `<a:pathLst>${paths.map(path).join('')}</a:pathLst></a:custGeom>`
  );
}

export interface Shadow {
  color: string;
  alpha: number;
  blur: number;
  dist: number;
}

const effects = (s?: Shadow) =>
  s ? `<a:effectLst><a:outerShdw blurRad="${i(s.blur)}" dist="${i(s.dist)}" dir="5400000" algn="t" rotWithShape="0">${color(s.color, s.alpha)}</a:outerShdw></a:effectLst>` : '';

function runXml(r: Run, font: string): string {
  const props = `lang="en-US" sz="${Math.max(100, i(r.size * 100))}" b="${r.bold ? 1 : 0}"${r.italic ? ' i="1"' : ''}${r.underline ? ' u="sng"' : ''}${r.spacing ? ` spc="${i(r.spacing * 100)}"` : ''} dirty="0"`;
  // Where the face is not installed, apps pick a substitute from these hints: a proportional sans
  // (pitchFamily 34, Arial's PANOSE) or a fixed-pitch face (pitchFamily 49, Consolas's), never Times.
  const name = esc(r.font ?? font);
  const hint = r.mono ? 'panose="020B0609020204030204" pitchFamily="49"' : 'panose="020B0604020202020204" pitchFamily="34"';
  const face = `<a:latin typeface="${name}" ${hint} charset="0"/><a:cs typeface="${name}" ${hint} charset="0"/>`;
  return r.text ? `<a:r><a:rPr ${props}>${fill(r)}${face}</a:rPr><a:t>${esc(r.text)}</a:t></a:r>` : '';
}

function parasXml(list: Para[], font: string): string {
  return list
    .map((p) => {
      // The empty paragraph end gets the text's size too, or a default 18 pt would set the line height.
      // No indent either: a template's text style may hang a wrapped line under a bullet that is not there.
      const size = p.runs[0]?.size ?? 10;
      return `<a:p><a:pPr marL="0" indent="0" algn="${p.align ?? 'l'}"><a:lnSpc><a:spcPct val="100000"/></a:lnSpc><a:spcBef><a:spcPts val="${i((p.before ?? 0) * 100)}"/></a:spcBef><a:buNone/></a:pPr>${p.runs.map((r) => runXml(r, font)).join('')}<a:endParaRPr lang="en-US" sz="${Math.max(100, i(size * 100))}" dirty="0"/></a:p>`;
    })
    .join('');
}

/** Line height of 100% spacing, in font sizes: what PowerPoint sets Inter's lines in (its ascent and descent). */
const LINE = 1.21;

/**
 * The text of a shape as Apple's importer (Quick Look, Mail, an iPhone) sets it where PowerPoint
 * does: Apple leaves out the bottom inset and moves centred text that does not wrap by the left one.
 * So text centred over a band of the shape is set from the top, its top inset worked out from its
 * lines; centred text loses its side insets, and where those differ (or a paragraph is not centred)
 * it moves to a text box of its own over the room the insets leave (`apart`), set without them.
 */
export function settle(t: TextBody, f: Frame): { text: TextBody; apart?: Frame } {
  if (t.wrap) return { text: t };
  const ins = { l: 0, t: 0, r: 0, b: 0, ...t.inset };
  let apart: Frame | undefined;
  const centred = t.paras.filter((p) => p.align === 'ctr').length;
  if (centred && (ins.l || ins.r)) {
    if ((centred < t.paras.length || Math.abs(ins.l - ins.r) > 1) && !f.rot) apart = { x: f.x + ins.l, y: f.y, w: Math.max(0, f.w - ins.l - ins.r), h: f.h };
    if (apart || centred === t.paras.length) ins.l = ins.r = 0;
  }
  let anchor = t.anchor ?? 'ctr';
  if (anchor !== 't' && (ins.t || ins.b)) {
    const high = t.paras.reduce((h, p, k) => h + (k ? (p.before ?? 0) : 0) + LINE * Math.max(p.runs[0]?.size ?? 10, ...p.runs.map((r) => r.size)), 0) * 12700;
    const room = f.h - ins.t - ins.b - high;
    ins.t = Math.max(0, ins.t + (anchor === 'ctr' ? room / 2 : room));
    ins.b = 0;
    anchor = 't';
  }
  return { text: { ...t, anchor, inset: ins }, apart };
}

export function textBody(t: TextBody, font: string): string {
  const ins = t.inset ?? {};
  const body = `<a:bodyPr wrap="${t.wrap ? 'square' : 'none'}" lIns="${i(ins.l ?? 0)}" tIns="${i(ins.t ?? 0)}" rIns="${i(ins.r ?? 0)}" bIns="${i(ins.b ?? 0)}" anchor="${t.anchor ?? 'ctr'}" rtlCol="0"><a:noAutofit/></a:bodyPr>`;
  const paras = parasXml(t.paras, font);
  return `<p:txBody>${body}<a:lstStyle/>${paras || '<a:p><a:endParaRPr lang="en-US"/></a:p>'}</p:txBody>`;
}

export interface TableCell {
  paras: Para[];
  fill?: Fill | null;
  /** Spans this many columns; the cells it covers follow as `merged`. */
  span?: number;
  merged?: boolean;
  anchor?: 't' | 'ctr' | 'b';
  /** Margins in EMU. */
  inset?: { l: number; t: number; r: number; b: number };
  /** The rule under the cell and the one on its right; none where left out. */
  bottom?: Line | null;
  right?: Line | null;
}

export interface TableSpec {
  id: number;
  name: string;
  frame: Frame;
  /** Column widths in EMU. */
  columns: number[];
  rows: { height: number; cells: TableCell[] }[];
}

/** A real table (a:tbl): cells you can type in, rows that grow with their text. */
export function table(t: TableSpec, font: string): string {
  const edge = (tag: string, l?: Line | null) => (l ? `<a:${tag} w="${i(l.width)}" cap="flat" cmpd="sng">${fill(l)}<a:prstDash val="solid"/></a:${tag}>` : `<a:${tag} w="0"><a:noFill/></a:${tag}>`);
  const cell = (c: TableCell) => {
    const m = c.inset ?? { l: 0, t: 0, r: 0, b: 0 };
    const attrs = c.span && c.span > 1 ? ` gridSpan="${c.span}"` : c.merged ? ' hMerge="1"' : '';
    const pr = `<a:tcPr marL="${i(m.l)}" marR="${i(m.r)}" marT="${i(m.t)}" marB="${i(m.b)}" anchor="${c.anchor ?? 'ctr'}">${edge('lnL', null)}${edge('lnR', c.right)}${edge('lnT', null)}${edge('lnB', c.bottom)}${fill(c.fill)}</a:tcPr>`;
    return `<a:tc${attrs}><a:txBody><a:bodyPr/><a:lstStyle/>${parasXml(c.paras, font) || '<a:p><a:endParaRPr lang="en-US"/></a:p>'}</a:txBody>${pr}</a:tc>`;
  };
  const grid = t.columns.map((w) => `<a:gridCol w="${i(w)}"/>`).join('');
  const rows = t.rows.map((r) => `<a:tr h="${i(r.height)}">${r.cells.map(cell).join('')}</a:tr>`).join('');
  return (
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${t.id}" name="${esc(t.name)}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="${i(t.frame.x)}" y="${i(t.frame.y)}"/><a:ext cx="${i(t.frame.w)}" cy="${i(t.frame.h)}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/><a:tblGrid>${grid}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
  );
}

export interface ShapeSpec {
  id: number;
  name: string;
  descr?: string;
  frame: Frame;
  geom: Geometry;
  fill?: Fill | null;
  line?: Line | null;
  shadow?: Shadow;
  text?: TextBody;
  /** A text box rather than a drawn shape: PowerPoint treats it as such when edited. */
  textBox?: boolean;
  /** Placeholder type, e.g. 'title', so the slide title shows in outlines and screen readers. */
  ph?: string;
}

export function shape(s: ShapeSpec, font: string): string {
  const nv = `<p:cNvPr id="${s.id}" name="${esc(s.name)}"${s.descr ? ` descr="${esc(s.descr)}"` : ''}/>`;
  const cnv = s.ph ? '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' : s.textBox ? '<p:cNvSpPr txBox="1"/>' : '<p:cNvSpPr/>';
  const nvPr = s.ph ? `<p:nvPr><p:ph type="${s.ph}"/></p:nvPr>` : '<p:nvPr/>';
  const sp = `<p:spPr>${xfrm(s.frame)}${geometry(s.geom, s.frame)}${fill(s.fill)}${line(s.line)}${effects(s.shadow)}</p:spPr>`;
  const text = s.text ? textBody(s.text, font) : '';
  return `<p:sp><p:nvSpPr>${nv}${cnv}${nvPr}</p:nvSpPr>${sp}${text}</p:sp>`;
}

export interface PictureSpec {
  id: number;
  name: string;
  descr?: string;
  frame: Frame;
  /** Raster (always shown by Keynote and LibreOffice) and the SVG PowerPoint prefers. */
  png?: string;
  svg: string;
}

export function picture(p: PictureSpec): string {
  const svgExt = p.png
    ? `<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${p.svg}"/></a:ext></a:extLst>`
    : '';
  return (
    `<p:pic><p:nvPicPr><p:cNvPr id="${p.id}" name="${esc(p.name)}"${p.descr ? ` descr="${esc(p.descr)}"` : ''}/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${p.png ?? p.svg}">${svgExt}</a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr>${xfrm(p.frame)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  );
}

export interface ConnectorSpec {
  id: number;
  name: string;
  frame: Frame;
  prst: string;
  adj?: number[];
  line: Line;
  start?: { id: number; idx: number };
  end?: { id: number; idx: number };
}

export function connector(c: ConnectorSpec): string {
  const bind = (tag: string, b?: { id: number; idx: number }) => (b ? `<a:${tag} id="${b.id}" idx="${b.idx}"/>` : '');
  const adj = Object.fromEntries((c.adj ?? []).map((v, k) => [`adj${k + 1}`, v]));
  return (
    `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${c.id}" name="${esc(c.name)}"/><p:cNvCxnSpPr>${bind('stCxn', c.start)}${bind('endCxn', c.end)}</p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr>` +
    `<p:spPr>${xfrm(c.frame)}${geometry({ prst: c.prst, adj }, c.frame)}<a:noFill/>${line(c.line)}</p:spPr></p:cxnSp>`
  );
}

/** Several shapes that move as one; the group's box is the union of its children's. */
export function group(id: number, name: string, box: Frame, children: string[], descr?: string): string {
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="${esc(name)}"${descr ? ` descr="${esc(descr)}"` : ''}/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>${xfrm(box, true)}</p:grpSpPr>${children.join('')}</p:grpSp>`;
}
