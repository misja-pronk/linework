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

export type PathCmd = { m: [number, number] } | { l: [number, number] } | { q: [number, number, number, number] };

const hex = (c: string) => c.replace('#', '').toUpperCase().slice(0, 6);
const i = Math.round;

export function color(c: string, alpha?: number): string {
  return alpha !== undefined && alpha < 1 ? `<a:srgbClr val="${hex(c)}"><a:alpha val="${i(alpha * 100000)}"/></a:srgbClr>` : `<a:srgbClr val="${hex(c)}"/>`;
}

const fill = (f?: Fill | null) => (f ? `<a:solidFill>${color(f.color, f.alpha)}</a:solidFill>` : '<a:noFill/>');

function line(l?: Line | null): string {
  if (!l) return '<a:ln><a:noFill/></a:ln>';
  const dash = l.dash === 'dashed' ? '<a:prstDash val="dash"/>' : l.dash === 'dotted' ? '<a:prstDash val="sysDot"/>' : '<a:prstDash val="solid"/>';
  const end = (tag: string, e?: End) => (e && e !== 'none' ? `<a:${tag} type="${e === 'open' ? 'arrow' : 'triangle'}" w="med" len="${e === 'slim' ? 'lg' : 'med'}"/>` : '');
  return `<a:ln w="${i(l.width)}" cap="${l.dash === 'dotted' ? 'rnd' : 'flat'}">${fill(l)}${dash}<a:round/>${end('headEnd', l.head)}${end('tailEnd', l.tail)}</a:ln>`;
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
    else {
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
  const props = `lang="en-US" sz="${Math.max(100, i(r.size * 100))}" b="${r.bold ? 1 : 0}"${r.spacing ? ` spc="${i(r.spacing * 100)}"` : ''} dirty="0"`;
  // Where the face is not installed, apps pick a substitute from these hints: a proportional sans
  // (pitchFamily 34, Arial's PANOSE) or a fixed-pitch face (pitchFamily 49, Consolas's), never Times.
  const name = esc(r.font ?? font);
  const hint = r.mono ? 'panose="020B0609020204030204" pitchFamily="49"' : 'panose="020B0604020202020204" pitchFamily="34"';
  const face = `<a:latin typeface="${name}" ${hint} charset="0"/><a:cs typeface="${name}" ${hint} charset="0"/>`;
  return r.text ? `<a:r><a:rPr ${props}>${fill(r)}${face}</a:rPr><a:t>${esc(r.text)}</a:t></a:r>` : '';
}

export function textBody(t: TextBody, font: string): string {
  const ins = t.inset ?? {};
  const body = `<a:bodyPr wrap="none" lIns="${i(ins.l ?? 0)}" tIns="${i(ins.t ?? 0)}" rIns="${i(ins.r ?? 0)}" bIns="${i(ins.b ?? 0)}" anchor="${t.anchor ?? 'ctr'}" rtlCol="0"><a:noAutofit/></a:bodyPr>`;
  const paras = t.paras
    .map((p) => {
      // The empty paragraph end gets the text's size too, or a default 18 pt would set the line height.
      const size = p.runs[0]?.size ?? 10;
      return `<a:p><a:pPr algn="${p.align ?? 'l'}"><a:lnSpc><a:spcPct val="100000"/></a:lnSpc><a:spcBef><a:spcPts val="${i((p.before ?? 0) * 100)}"/></a:spcBef><a:buNone/></a:pPr>${p.runs.map((r) => runXml(r, font)).join('')}<a:endParaRPr lang="en-US" sz="${Math.max(100, i(size * 100))}" dirty="0"/></a:p>`;
    })
    .join('');
  return `<p:txBody>${body}<a:lstStyle/>${paras || '<a:p><a:endParaRPr lang="en-US"/></a:p>'}</p:txBody>`;
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
export function group(id: number, name: string, box: Frame, children: string[]): string {
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>${xfrm(box, true)}</p:grpSpPr>${children.join('')}</p:grpSp>`;
}
