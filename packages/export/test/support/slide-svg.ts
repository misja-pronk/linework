// A slide of a .pptx drawn as SVG, without PowerPoint: background, the master's and the layout's
// own shapes, placeholders with their inherited frames and text styles, shapes, groups, pictures
// and connectors. Good enough to see where things land and whether they look like the template;
// not a full DrawingML renderer (no autofit, effects, gradients beyond their first stop, tables as boxes).
import { strFromU8, unzipSync } from 'fflate';
import { child, children, find, parseXml, type XmlNode } from '../../src/template/xml.ts';
import { colorOf, fillColor, relsOf } from '../../src/template/read.ts';

const PX = 9525;
const COLOR = ['a:srgbClr', 'a:schemeClr', 'a:sysClr', 'a:prstClr'];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: string | undefined, d = 0) => (v === undefined || v === '' ? d : Number(v));

interface Part {
  path: string;
  root: XmlNode;
}

interface Ctx {
  files: Record<string, Uint8Array>;
  scheme: Record<string, string>;
  clrMap: Record<string, string>;
  fonts: { major: string; minor: string };
  slideNo: number;
  slide: Part;
  layout: Part;
  master: Part;
  ids: { n: number };
}

const load = (files: Record<string, Uint8Array>, path: string): Part => ({ path, root: parseXml(strFromU8(files[path]!)) });
const tree = (p: Part) => find(p.root, 'p:spTree');
const nvPr = (node: XmlNode) => node.children.find((c) => /^p:nv\w+Pr$/.test(c.name));
const phOf = (node: XmlNode) => child(nvPr(node), 'p:nvPr/p:ph');

function color(ctx: Ctx, node: XmlNode | undefined): { c: string; a: number } | undefined {
  const el = node?.children.find((c) => COLOR.includes(c.name));
  const c = colorOf(el, ctx.scheme, ctx.clrMap);
  if (!c) return undefined;
  const alpha = el?.children.find((x) => x.name === 'a:alpha');
  return { c, a: alpha ? n(alpha.attrs.val) / 100000 : 1 };
}

function image(ctx: Ctx, part: Part, rid: string | undefined): string | undefined {
  const rel = relsOf(ctx.files, part.path).find((r) => r.id === rid);
  const data = rel?.part ? ctx.files[rel.part] : undefined;
  if (!data) return undefined;
  const mime = rel!.part!.endsWith('.svg') ? 'image/svg+xml' : rel!.part!.endsWith('.jpeg') || rel!.part!.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${Buffer.from(data).toString('base64')}`;
}

/** The placeholder a slide's (or layout's) placeholder inherits from: same idx, else same type. */
function inherited(from: Part, ph: XmlNode): XmlNode | undefined {
  const type = ph.attrs.type ?? 'obj';
  const kinds: Record<string, string> = { ctrTitle: 'title', subTitle: 'body', obj: 'body', pic: 'body' };
  const all = (tree(from)?.children ?? []).filter((c) => phOf(c));
  return (
    (ph.attrs.idx !== undefined ? all.find((c) => phOf(c)!.attrs.idx === ph.attrs.idx && (phOf(c)!.attrs.type ?? 'obj') === type) : undefined) ??
    all.find((c) => (phOf(c)!.attrs.type ?? 'obj') === type) ??
    (ph.attrs.idx !== undefined ? all.find((c) => phOf(c)!.attrs.idx === ph.attrs.idx) : undefined) ??
    all.find((c) => (phOf(c)!.attrs.type ?? 'obj') === (kinds[type] ?? type))
  );
}

/** The chain a placeholder takes its frame and text style from: itself, the layout's, the master's. */
function chain(ctx: Ctx, node: XmlNode, own: Part): XmlNode[] {
  const ph = phOf(node);
  if (!ph) return [node];
  const out = [node];
  if (own === ctx.slide) {
    const l = inherited(ctx.layout, ph);
    if (l) out.push(l);
    const m = inherited(ctx.master, phOf(l ?? node)!);
    if (m) out.push(m);
  } else if (own === ctx.layout) {
    const m = inherited(ctx.master, ph);
    if (m) out.push(m);
  }
  return out;
}

function frame(nodes: XmlNode[]) {
  for (const node of nodes) {
    const x = child(node, 'p:spPr/a:xfrm') ?? child(node, 'p:grpSpPr/a:xfrm') ?? child(node, 'p:xfrm');
    const off = child(x, 'a:off');
    const ext = child(x, 'a:ext');
    if (off && ext) return { x: n(off.attrs.x) / PX, y: n(off.attrs.y) / PX, w: n(ext.attrs.cx) / PX, h: n(ext.attrs.cy) / PX, rot: n(x!.attrs.rot) / 60000, flipH: x!.attrs.flipH === '1', flipV: x!.attrs.flipV === '1' };
  }
  return undefined;
}

function rotate(f: { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean }) {
  const cx = f.x + f.w / 2;
  const cy = f.y + f.h / 2;
  if (!f.rot && !f.flipH && !f.flipV) return '';
  return ` transform="translate(${cx} ${cy}) rotate(${f.rot}) scale(${f.flipH ? -1 : 1} ${f.flipV ? -1 : 1}) translate(${-cx} ${-cy})"`;
}

function geometry(spPr: XmlNode | undefined, w: number, h: number): string {
  const prst = child(spPr, 'a:prstGeom');
  const adj = (i: number, d: number) => {
    const gd = children(child(prst, 'a:avLst'), 'a:gd').find((g) => g.attrs.name === `adj${i === 1 ? '' : i}` || g.attrs.name === `adj${i}`);
    return gd ? n(gd.attrs.fmla?.replace('val ', '')) : d;
  };
  if (prst) {
    const kind = prst.attrs.prst;
    const s = Math.min(w, h);
    if (kind === 'ellipse') return `M${w / 2} 0 A${w / 2} ${h / 2} 0 1 1 ${w / 2 - 0.01} 0 Z`;
    if (kind === 'roundRect') {
      const r = (s * adj(1, 16667)) / 100000;
      return `M${r} 0 H${w - r} A${r} ${r} 0 0 1 ${w} ${r} V${h - r} A${r} ${r} 0 0 1 ${w - r} ${h} H${r} A${r} ${r} 0 0 1 0 ${h - r} V${r} A${r} ${r} 0 0 1 ${r} 0 Z`;
    }
    if (kind === 'round2SameRect') {
      const r = (s * adj(1, 16667)) / 100000;
      return `M${r} 0 H${w - r} A${r} ${r} 0 0 1 ${w} ${r} V${h} H0 V${r} A${r} ${r} 0 0 1 ${r} 0 Z`;
    }
    if (kind === 'diamond') return `M${w / 2} 0 L${w} ${h / 2} L${w / 2} ${h} L0 ${h / 2} Z`;
    if (kind === 'line' || kind === 'straightConnector1') return `M0 0 L${w} ${h}`;
    if (kind === 'bentConnector2') return `M0 0 H${w} V${h}`;
    if (kind === 'bentConnector3') {
      const a = (w * adj(1, 50000)) / 100000;
      return `M0 0 H${a} V${h} H${w}`;
    }
    if (kind === 'bentConnector4') {
      const a = (w * adj(1, 50000)) / 100000;
      const b = (h * adj(2, 50000)) / 100000;
      return `M0 0 H${a} V${b} H${w} V${h}`;
    }
    return `M0 0 H${w} V${h} H0 Z`;
  }
  const cust = child(spPr, 'a:custGeom');
  let d = '';
  for (const path of children(child(cust, 'a:pathLst'), 'a:path')) {
    const sx = w / Math.max(1, n(path.attrs.w, w * PX));
    const sy = h / Math.max(1, n(path.attrs.h, h * PX));
    const pt = (p: XmlNode) => `${n(p.attrs.x) * sx} ${n(p.attrs.y) * sy}`;
    for (const c of path.children) {
      const pts = children(c, 'a:pt');
      if (c.name === 'a:moveTo') d += `M${pt(pts[0]!)} `;
      else if (c.name === 'a:lnTo') d += `L${pt(pts[0]!)} `;
      else if (c.name === 'a:cubicBezTo') d += `C${pts.map(pt).join(' ')} `;
      else if (c.name === 'a:quadBezTo') d += `Q${pts.map(pt).join(' ')} `;
      else if (c.name === 'a:close') d += 'Z ';
    }
  }
  return d;
}

/** A text property along the inheritance chain: the run, the paragraph's level style, the placeholders' list styles, the master's text styles. */
function textStyle(ctx: Ctx, nodes: XmlNode[], kind: 'title' | 'body' | 'other') {
  const levels: XmlNode[] = [];
  for (const node of nodes) {
    const l = child(node, 'p:txBody/a:lstStyle/a:lvl1pPr');
    if (l) levels.push(l);
  }
  const ms = child(ctx.master.root, `p:sldMaster/p:txStyles/p:${kind}Style/a:lvl1pPr`);
  if (ms) levels.push(ms);
  return levels;
}

function runs(ctx: Ctx, para: XmlNode, levels: XmlNode[]) {
  const pPr = child(para, 'a:pPr');
  const algn = pPr?.attrs.algn ?? levels.map((l) => l.attrs.algn).find(Boolean) ?? 'l';
  const bullet = !child(pPr, 'a:buNone') && !!levels.find((l) => child(l, 'a:buChar')) && !levels.slice(0, levels.findIndex((l) => child(l, 'a:buChar'))).some((l) => child(l, 'a:buNone'));
  const out: { text: string; size: number; bold: boolean; color: string; font: string }[] = [];
  const end = child(para, 'a:endParaRPr');
  for (const r of para.children.filter((c) => c.name === 'a:r' || c.name === 'a:fld')) {
    const rPr = child(r, 'a:rPr');
    const defs = [rPr, ...levels.map((l) => child(l, 'a:defRPr'))].filter((x): x is XmlNode => !!x);
    const size = n(defs.map((d) => d.attrs.sz).find(Boolean), 1800) / 100;
    const bold = (defs.map((d) => d.attrs.b).find((b) => b !== undefined) ?? '0') === '1';
    const fill = defs.map((d) => color(ctx, child(d, 'a:solidFill'))).find(Boolean);
    let face = defs.map((d) => child(d, 'a:latin')?.attrs.typeface).find(Boolean) ?? '+mn-lt';
    face = face === '+mj-lt' ? ctx.fonts.major : face === '+mn-lt' ? ctx.fonts.minor : face;
    const t = r.name === 'a:fld' && r.attrs.type === 'slidenum' ? String(ctx.slideNo) : (child(r, 'a:t')?.text ?? '');
    out.push({ text: t, size, bold, color: fill?.c ?? ctx.scheme[ctx.clrMap.tx1 ?? 'dk1'] ?? '#000000', font: face });
  }
  const endSize = n(end?.attrs.sz ?? levels.map((l) => child(l, 'a:defRPr')?.attrs.sz).find(Boolean), 1800) / 100;
  return { algn, bullet, runs: out, endSize };
}

function textXml(ctx: Ctx, nodes: XmlNode[], w: number, h: number, kind: 'title' | 'body' | 'other'): string {
  const body = nodes.map((x) => child(x, 'p:txBody')).find(Boolean);
  if (!body) return '';
  const bodyPrs = nodes.map((x) => child(x, 'p:txBody/a:bodyPr')).filter((x): x is XmlNode => !!x);
  const pick = (k: string) => bodyPrs.map((b) => b.attrs[k]).find((v) => v !== undefined);
  const ins = { l: n(pick('lIns'), 91440) / PX, t: n(pick('tIns'), 45720) / PX, r: n(pick('rIns'), 91440) / PX, b: n(pick('bIns'), 45720) / PX };
  const anchor = pick('anchor') ?? (kind === 'title' ? 'ctr' : 't');
  const wrap = pick('wrap') !== 'none';
  const levels = textStyle(ctx, nodes, kind);
  const lines: { text: string; size: number; bold: boolean; color: string; font: string; algn: string; x: number }[][] = [];
  const room = w - ins.l - ins.r;
  for (const p of children(body, 'a:p')) {
    const para = runs(ctx, p, levels);
    if (!para.runs.length || para.runs.every((r) => !r.text)) {
      lines.push([{ text: '', size: para.endSize, bold: false, color: '#000', font: '', algn: para.algn, x: 0 }]);
      continue;
    }
    // Words fill a line until it is full; a run's width is estimated from its size.
    let line: (typeof lines)[number] = [];
    let used = 0;
    for (const r of para.runs) {
      const words = wrap ? r.text.split(/(?<= )/) : [r.text];
      for (const word of words) {
        const wpx = word.length * r.size * (96 / 72) * (r.bold ? 0.56 : 0.52);
        if (wrap && used + wpx > room && line.length) {
          lines.push(line);
          line = [];
          used = 0;
        }
        const last = line.at(-1);
        if (last && last.size === r.size && last.color === r.color && last.bold === r.bold && last.font === r.font) last.text += word;
        else line.push({ ...r, text: (para.bullet && !lines.length && !line.length ? '• ' : '') + word, algn: para.algn, x: used });
        used += wpx;
      }
    }
    lines.push(line);
  }
  const lh = (l: (typeof lines)[number]) => Math.max(...l.map((r) => r.size)) * (96 / 72) * 1.2;
  const total = lines.reduce((s, l) => s + lh(l), 0);
  let y = anchor === 'ctr' ? ins.t + (h - ins.t - ins.b - total) / 2 : anchor === 'b' ? h - ins.b - total : ins.t;
  let out = '';
  for (const l of lines) {
    const height = lh(l);
    y += height * 0.8;
    const algn = l[0]?.algn ?? 'l';
    const x = algn === 'ctr' ? w / 2 : algn === 'r' ? w - ins.r : ins.l;
    const spans = l.filter((r) => r.text).map((r) => `<tspan font-family="${esc(r.font)}, Arial, sans-serif" font-size="${r.size * (96 / 72)}" font-weight="${r.bold ? 700 : 400}" fill="${r.color}">${esc(r.text)}</tspan>`).join('');
    if (spans) out += `<text x="${x}" y="${y}" text-anchor="${algn === 'ctr' ? 'middle' : algn === 'r' ? 'end' : 'start'}" xml:space="preserve">${spans}</text>`;
    y += height * 0.2;
  }
  return out;
}

function arrow(id: string, c: string, start: boolean): string {
  return `<marker id="${id}" viewBox="0 0 10 10" refX="${start ? 1 : 9}" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M0 0 L10 5 L0 10 z" fill="${c}"/></marker>`;
}

function shapeXml(ctx: Ctx, node: XmlNode, part: Part): string {
  if (node.name === 'p:grpSp') {
    const x = child(node, 'p:grpSpPr/a:xfrm');
    const off = child(x, 'a:off');
    const ext = child(x, 'a:ext');
    const chOff = child(x, 'a:chOff');
    const chExt = child(x, 'a:chExt');
    const sx = n(chExt?.attrs.cx) ? n(ext?.attrs.cx) / n(chExt!.attrs.cx) : 1;
    const sy = n(chExt?.attrs.cy) ? n(ext?.attrs.cy) / n(chExt!.attrs.cy) : 1;
    const t = `translate(${n(off?.attrs.x) / PX} ${n(off?.attrs.y) / PX}) scale(${sx} ${sy}) translate(${-n(chOff?.attrs.x) / PX} ${-n(chOff?.attrs.y) / PX})`;
    return `<g transform="${t}">${node.children.map((c) => shapeXml(ctx, c, part)).join('')}</g>`;
  }
  if (!['p:sp', 'p:pic', 'p:cxnSp', 'p:graphicFrame'].includes(node.name)) return '';
  const nodes = chain(ctx, node, part);
  const f = frame(nodes);
  if (!f) return '';
  if (node.name === 'p:pic') {
    const href = image(ctx, part, find(node, 'a:blip')?.attrs['r:embed']);
    return href ? `<g${rotate(f)}><image x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" href="${href}" preserveAspectRatio="none"/></g>` : '';
  }
  if (node.name === 'p:graphicFrame') {
    return `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" fill="none" stroke="#888" stroke-dasharray="4 3"/>`;
  }
  const spPr = child(node, 'p:spPr');
  const fillNode = spPr?.children.find((c) => c.name === 'a:solidFill' || c.name === 'a:gradFill' || c.name === 'a:noFill');
  const fill = fillNode && fillNode.name !== 'a:noFill' ? { c: fillColor(fillNode, ctx.scheme, ctx.clrMap)!, a: color(ctx, fillNode)?.a ?? 1 } : undefined;
  const ln = child(spPr, 'a:ln');
  const stroke = ln && !child(ln, 'a:noFill') ? color(ctx, child(ln, 'a:solidFill')) : undefined;
  const sw = ln ? n(ln.attrs.w, 9525) / PX : 0;
  const dash = child(ln, 'a:prstDash')?.attrs.val;
  const id = `m${ctx.ids.n++}`;
  const head = child(ln, 'a:headEnd');
  const tail = child(ln, 'a:tailEnd');
  const defs = stroke ? `${head && head.attrs.type !== 'none' ? arrow(`${id}h`, stroke.c, true) : ''}${tail && tail.attrs.type !== 'none' ? arrow(`${id}t`, stroke.c, false) : ''}` : '';
  const d = geometry(spPr, f.w, f.h);
  // Footers, dates and slide numbers take the master's other style, not the bulleted body style.
  const type = phOf(node)?.attrs.type;
  const kind = type === 'title' || type === 'ctrTitle' ? 'title' : phOf(node) && !['dt', 'ftr', 'sldNum', 'hdr'].includes(type ?? '') ? 'body' : 'other';
  const shape = d
    ? `<path d="${d}" transform="translate(${f.x} ${f.y})" fill="${fill ? fill.c : 'none'}"${fill && fill.a < 1 ? ` fill-opacity="${fill.a}"` : ''} stroke="${stroke ? stroke.c : 'none'}"${stroke && stroke.a < 1 ? ` stroke-opacity="${stroke.a}"` : ''} stroke-width="${sw}"${dash === 'dash' ? ` stroke-dasharray="${sw * 4} ${sw * 3}"` : dash === 'sysDot' ? ` stroke-dasharray="${sw} ${sw * 2}"` : ''}${defs.includes(`${id}h`) ? ` marker-start="url(#${id}h)"` : ''}${defs.includes(`${id}t`) ? ` marker-end="url(#${id}t)"` : ''}/>`
    : '';
  const text = node.name === 'p:sp' ? textXml(ctx, nodes, f.w, f.h, kind) : '';
  return `<g${rotate(f)}>${defs ? `<defs>${defs}</defs>` : ''}${shape}${text ? `<g transform="translate(${f.x} ${f.y})">${text}</g>` : ''}</g>`;
}

function backgroundXml(ctx: Ctx, w: number, h: number): string {
  for (const part of [ctx.slide, ctx.layout, ctx.master]) {
    const bg = find(part.root, 'p:bg');
    if (!bg) continue;
    const blip = find(bg, 'a:blip');
    if (blip) {
      const href = image(ctx, part, blip.attrs['r:embed']);
      if (href) return `<image width="${w}" height="${h}" href="${href}" preserveAspectRatio="none"/>`;
    }
    const pr = child(bg, 'p:bgPr');
    const c = pr ? fillColor(pr.children.find((x) => x.name.endsWith('Fill')), ctx.scheme, ctx.clrMap) : color(ctx, child(bg, 'p:bgRef'))?.c;
    if (c) return `<rect width="${w}" height="${h}" fill="${c}"/>`;
  }
  return `<rect width="${w}" height="${h}" fill="#FFFFFF"/>`;
}

export interface DeckSvg {
  width: number;
  height: number;
  slides: string[];
}

/** Every slide of a deck as an SVG, in the deck's order. */
export function deckToSvg(bytes: Uint8Array): DeckSvg {
  const files = unzipSync(bytes);
  const main = relsOf(files, '').find((r) => r.type.endsWith('/officeDocument'))!.part!;
  const pres = parseXml(strFromU8(files[main]!));
  const size = find(pres, 'p:sldSz')!;
  const W = n(size.attrs.cx) / PX;
  const H = n(size.attrs.cy) / PX;
  const rels = relsOf(files, main);
  const order = children(find(pres, 'p:sldIdLst'), 'p:sldId').map((s) => rels.find((r) => r.id === s.attrs['r:id'])!.part!);
  const slides = order.map((path, i) => {
    const slide = load(files, path);
    const layoutPath = relsOf(files, path).find((r) => r.type.endsWith('/slideLayout'))!.part!;
    const layout = load(files, layoutPath);
    const masterPath = relsOf(files, layoutPath).find((r) => r.type.endsWith('/slideMaster'))!.part!;
    const master = load(files, masterPath);
    const themePath = relsOf(files, masterPath).find((r) => r.type.endsWith('/theme'))!.part!;
    const theme = parseXml(strFromU8(files[themePath]!));
    const scheme: Record<string, string> = {};
    for (const c of find(theme, 'a:clrScheme')?.children ?? []) scheme[c.name.slice(2)] = colorOf(c.children[0], {}) ?? '#000000';
    const fs = find(theme, 'a:fontScheme');
    const fonts = { major: child(fs, 'a:majorFont/a:latin')?.attrs.typeface ?? 'Calibri', minor: child(fs, 'a:minorFont/a:latin')?.attrs.typeface ?? 'Calibri' };
    const ctx: Ctx = { files, scheme, clrMap: { ...find(master.root, 'p:clrMap')?.attrs }, fonts, slideNo: i + 1, slide, layout, master, ids: { n: 0 } };
    const deco = (p: Part) => (tree(p)?.children ?? []).filter((c) => !phOf(c)).map((c) => shapeXml(ctx, c, p)).join('');
    const showMaster = child(layout.root, 'p:sldLayout')?.attrs.showMasterSp !== '0' && child(slide.root, 'p:sld')?.attrs.showMasterSp !== '0';
    const body = (showMaster ? deco(master) : '') + deco(layout) + (tree(slide)?.children ?? []).map((c) => shapeXml(ctx, c, slide)).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${backgroundXml(ctx, W, H)}${body}</svg>`;
  });
  return { width: W, height: H, slides };
}
