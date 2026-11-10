// Reads a PowerPoint template (.potx, or any .pptx used as one): slide size, theme colours and
// fonts, the masters and layouts with their placeholders, and what is drawn on them (a title
// bar, a logo) so a diagram can keep clear of it. Nothing is changed here; write.ts builds the
// deck from the same parts.
import { strFromU8, unzipSync } from 'fflate';
import { child, children, find, parseXml, type XmlNode } from './xml.ts';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TemplatePlaceholder {
  /** title, ctrTitle, subTitle, body, obj, pic, dt, ftr, sldNum… (obj when the template leaves it out). */
  type: string;
  idx?: number;
  name: string;
  /** Its own frame, or the one it inherits from the master. */
  frame?: Rect;
  /** The p:sp as the layout has it, for footers copied onto each slide. */
  xml: string;
}

/** Something drawn on a master or layout that a diagram should not cover: a bar, a logo, a rule. */
export interface Decoration extends Rect {
  name: string;
}

export interface TemplateMaster {
  path: string;
  placeholders: TemplatePlaceholder[];
  decorations: Decoration[];
  background?: Background;
  /** bg1 → lt1, tx1 → dk1 and so on. */
  clrMap: Record<string, string>;
  theme: string;
  /** Which of the header and footer placeholders show (p:hf); all when the master does not say. */
  hf: { sldNum: boolean; ftr: boolean; dt: boolean };
  /** Text styles of the title and body placeholders: size (hundredths of a point) and colour of level 1. */
  titleStyle: XmlNode | undefined;
  bodyStyle: XmlNode | undefined;
}

export interface TemplateLayout {
  path: string;
  name: string;
  type?: string;
  master: string;
  placeholders: TemplatePlaceholder[];
  decorations: Decoration[];
  /** False when the layout hides the master's own shapes (showMasterSp="0"). */
  showMasterSp: boolean;
  background?: Background;
}

export type Background = { color: string } | { image: string; color?: string };

export type SchemeColor = 'dk1' | 'lt1' | 'dk2' | 'lt2' | 'accent1' | 'accent2' | 'accent3' | 'accent4' | 'accent5' | 'accent6' | 'hlink' | 'folHlink';

export interface PptxTemplate {
  files: Record<string, Uint8Array>;
  /** Slide size in EMU. */
  width: number;
  height: number;
  /** The theme of the first master; colours as #RRGGBB. */
  colors: Record<SchemeColor, string>;
  fonts: { major: string; minor: string };
  themeName?: string;
  masters: TemplateMaster[];
  layouts: TemplateLayout[];
  /** The template's own slides, in order: removed from the deck unless kept. */
  slides: string[];
  notesMaster?: { path: string; bodyIdx?: number };
  /** A .potx: its main part has the template content type. */
  isTemplate: boolean;
}

const SCHEME: SchemeColor[] = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
const PRESET: Record<string, string> = { black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000', blue: '#0000FF', yellow: '#FFFF00', gray: '#808080', grey: '#808080' };

export const text = (files: Record<string, Uint8Array>, path: string) => {
  const f = files[path];
  if (!f) throw new Error(`The template has no ${path}`);
  return strFromU8(f);
};

/** A part's own directory: ppt/slides/slide1.xml → ppt/slides/. */
const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

/** A relationship target resolved against the part that names it. */
export function resolveTarget(from: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const out = dirOf(from).split('/').filter(Boolean);
  for (const seg of target.split('/')) {
    if (seg === '..') out.pop();
    else if (seg && seg !== '.') out.push(seg);
  }
  return out.join('/');
}

export const relsPath = (part: string) => `${dirOf(part)}_rels/${part.slice(dirOf(part).length)}.rels`;

export interface PartRel {
  id: string;
  type: string;
  target: string;
  /** Resolved to a part path; undefined for an external link. */
  part?: string;
}

/** The relationships of a part, with their targets resolved. */
export function relsOf(files: Record<string, Uint8Array>, part: string): PartRel[] {
  const path = part === '' ? '_rels/.rels' : relsPath(part);
  if (!files[path]) return [];
  return children(child(parseXml(strFromU8(files[path]!)), 'Relationships'), 'Relationship').map((r) => ({
    id: r.attrs.Id!,
    type: r.attrs.Type!,
    target: r.attrs.Target!,
    ...(r.attrs.TargetMode === 'External' ? {} : { part: resolveTarget(part, r.attrs.Target!) }),
  }));
}

const ofType = (rels: PartRel[], kind: string) => rels.filter((r) => r.type.endsWith(`/${kind}`));

// Colour arithmetic as DrawingML does it, in HSL for lumMod/lumOff and towards white or black for tint/shade.
function hsl([r, g, b]: number[]): [number, number, number] {
  const [x, y, z] = [r! / 255, g! / 255, b! / 255];
  const max = Math.max(x, y, z);
  const min = Math.min(x, y, z);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === x ? (y - z) / d + (y < z ? 6 : 0) : max === y ? (z - x) / d + 2 : (x - y) / d + 4;
  return [h / 6, s, l];
}

function rgbOf(h: number, s: number, l: number): number[] {
  if (!s) return [l, l, l].map((v) => v * 255);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => v * 255);
}

const toHex = (c: number[]) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const fromHex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function modified(base: string, mods: XmlNode[]): string {
  let c = fromHex(base);
  for (const m of mods) {
    const v = Number(m.attrs.val) / 100000;
    if (!Number.isFinite(v)) continue;
    if (m.name === 'a:lumMod' || m.name === 'a:lumOff') {
      const [h, s, l] = hsl(c);
      c = rgbOf(h, s, Math.max(0, Math.min(1, m.name === 'a:lumMod' ? l * v : l + v)));
    } else if (m.name === 'a:tint') c = c.map((x) => x + (255 - x) * (1 - v));
    else if (m.name === 'a:shade') c = c.map((x) => x * v);
  }
  return toHex(c);
}

/** A colour element (a:srgbClr, a:schemeClr…) as #RRGGBB, scheme names through the master's colour map. */
export function colorOf(node: XmlNode | undefined, scheme: Record<string, string>, clrMap: Record<string, string> = {}): string | undefined {
  if (!node) return undefined;
  const v = node.attrs.val ?? '';
  let base: string | undefined;
  if (node.name === 'a:srgbClr') base = /^[0-9a-f]{6}$/i.test(v) ? `#${v.toUpperCase()}` : undefined;
  else if (node.name === 'a:sysClr') base = node.attrs.lastClr ? `#${node.attrs.lastClr.toUpperCase()}` : v === 'window' ? '#FFFFFF' : '#000000';
  else if (node.name === 'a:schemeClr') base = scheme[clrMap[v] ?? v] ?? scheme[{ bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' }[v] ?? v];
  else if (node.name === 'a:prstClr') base = PRESET[v];
  if (!base) return undefined;
  return modified(base, node.children);
}

const COLOR_TAGS = ['a:srgbClr', 'a:schemeClr', 'a:sysClr', 'a:prstClr'];
/** The colour inside a fill (a:solidFill), or the first stop of a gradient. */
export function fillColor(fill: XmlNode | undefined, scheme: Record<string, string>, clrMap?: Record<string, string>): string | undefined {
  if (!fill) return undefined;
  if (fill.name === 'a:gradFill') return colorOf(find(fill, 'a:gs')?.children.find((c) => COLOR_TAGS.includes(c.name)), scheme, clrMap);
  return colorOf(fill.children.find((c) => COLOR_TAGS.includes(c.name)), scheme, clrMap);
}

function frameOf(node: XmlNode): Rect | undefined {
  const x = child(node, 'p:spPr/a:xfrm') ?? child(node, 'p:grpSpPr/a:xfrm') ?? child(node, 'p:xfrm');
  const off = child(x, 'a:off');
  const ext = child(x, 'a:ext');
  if (!off || !ext) return undefined;
  return { x: Number(off.attrs.x), y: Number(off.attrs.y), w: Number(ext.attrs.cx), h: Number(ext.attrs.cy) };
}

const nvPrOf = (node: XmlNode) => node.children.find((c) => /^p:nv\w+Pr$/.test(c.name));
const nameOf = (node: XmlNode) => child(nvPrOf(node), 'p:cNvPr')?.attrs.name ?? '';
const phOf = (node: XmlNode) => child(nvPrOf(node), 'p:nvPr/p:ph');

function spTree(xml: string, source: string) {
  const tree = child(parseXml(xml), `${source}/p:cSld/p:spTree`);
  const placeholders: TemplatePlaceholder[] = [];
  const decorations: Decoration[] = [];
  for (const node of tree?.children ?? []) {
    if (!['p:sp', 'p:pic', 'p:grpSp', 'p:cxnSp', 'p:graphicFrame'].includes(node.name)) continue;
    const ph = phOf(node);
    const frame = frameOf(node);
    if (ph) {
      placeholders.push({ type: ph.attrs.type ?? 'obj', ...(ph.attrs.idx !== undefined ? { idx: Number(ph.attrs.idx) } : {}), name: nameOf(node), ...(frame ? { frame } : {}), xml: xml.slice(node.start, node.end) });
    } else if (frame && frame.w > 0 && frame.h > 0) decorations.push({ ...frame, name: nameOf(node) });
  }
  return { placeholders, decorations };
}

function background(root: XmlNode, source: string, files: Record<string, Uint8Array>, part: string, scheme: Record<string, string>, clrMap: Record<string, string>): Background | undefined {
  const bg = child(root, `${source}/p:cSld/p:bg`);
  if (!bg) return undefined;
  const pr = child(bg, 'p:bgPr');
  if (pr) {
    const blip = find(pr, 'a:blip');
    if (blip) {
      const rel = relsOf(files, part).find((r) => r.id === blip.attrs['r:embed']);
      return rel?.part ? { image: rel.part } : undefined;
    }
    const c = fillColor(pr.children.find((x) => x.name.endsWith('Fill') && x.name !== 'a:noFill'), scheme, clrMap);
    return c ? { color: c } : undefined;
  }
  const ref = child(bg, 'p:bgRef');
  const c = colorOf(ref?.children.find((x) => COLOR_TAGS.includes(x.name)), scheme, clrMap);
  return c ? { color: c } : undefined;
}

/** Placeholder types a layout's placeholder takes its frame from on the master. */
const MASTER_TYPE: Record<string, string> = { ctrTitle: 'title', subTitle: 'body', obj: 'body', pic: 'body', tbl: 'body', chart: 'body', media: 'body', clipArt: 'body', dgm: 'body' };

export function readTemplate(bytes: Uint8Array): PptxTemplate {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('Not a PowerPoint file: it is not a zip archive (.potx or .pptx)');
  }
  const main = relsOf(files, '').find((r) => r.type.endsWith('/officeDocument'))?.part;
  if (!main || !files[main]) throw new Error('Not a PowerPoint file: no presentation part (.potx or .pptx)');
  const types = files['[Content_Types].xml'] ? strFromU8(files['[Content_Types].xml']) : '';
  const pres = parseXml(text(files, main));
  const p = child(pres, 'p:presentation');
  if (!p) throw new Error('Not a PowerPoint file: the main part is not a presentation (a Word or Excel template?)');
  const size = child(p, 'p:sldSz');
  const presRels = relsOf(files, main);
  const byId = new Map(presRels.map((r) => [r.id, r]));

  const masterPaths = children(child(p, 'p:sldMasterIdLst'), 'p:sldMasterId').map((m) => byId.get(m.attrs['r:id']!)?.part).filter((x): x is string => !!x && !!files[x]);
  if (!masterPaths.length) throw new Error('The template has no slide master');
  const masters: TemplateMaster[] = [];
  const layouts: TemplateLayout[] = [];
  let colors: Record<SchemeColor, string> | undefined;
  let fonts = { major: 'Calibri', minor: 'Calibri' };
  let themeName: string | undefined;
  for (const path of masterPaths) {
    const xml = text(files, path);
    const root = parseXml(xml);
    const rels = relsOf(files, path);
    const themePath = ofType(rels, 'theme')[0]?.part ?? '';
    const theme = files[themePath] ? parseXml(text(files, themePath)) : undefined;
    const scheme: Record<string, string> = {};
    for (const c of child(theme, 'a:theme/a:themeElements/a:clrScheme')?.children ?? []) {
      const v = colorOf(c.children[0], {});
      if (v) scheme[c.name.replace(/^a:/, '')] = v;
    }
    const clrMap = { ...child(root, 'p:sldMaster/p:clrMap')?.attrs };
    if (!colors) {
      colors = Object.fromEntries(SCHEME.map((k) => [k, scheme[k] ?? (k.startsWith('dk') ? '#000000' : k.startsWith('lt') ? '#FFFFFF' : '#4472C4')])) as Record<SchemeColor, string>;
      const fs = child(theme, 'a:theme/a:themeElements/a:fontScheme');
      fonts = { major: child(fs, 'a:majorFont/a:latin')?.attrs.typeface || fonts.major, minor: child(fs, 'a:minorFont/a:latin')?.attrs.typeface || fonts.minor };
      themeName = child(theme, 'a:theme')?.attrs.name;
    }
    const hf = child(root, 'p:sldMaster/p:hf');
    const { placeholders, decorations } = spTree(xml, 'p:sldMaster');
    masters.push({
      path,
      placeholders,
      decorations,
      background: background(root, 'p:sldMaster', files, path, scheme, clrMap),
      clrMap,
      theme: themePath,
      hf: { sldNum: hf?.attrs.sldNum !== '0', ftr: hf?.attrs.ftr !== '0', dt: hf?.attrs.dt !== '0' },
      titleStyle: child(root, 'p:sldMaster/p:txStyles/p:titleStyle'),
      bodyStyle: child(root, 'p:sldMaster/p:txStyles/p:bodyStyle'),
    });
    // Layouts in the master's order, which is the order PowerPoint lists them in.
    const layoutIds = children(child(root, 'p:sldMaster/p:sldLayoutIdLst'), 'p:sldLayoutId').map((l) => l.attrs['r:id']);
    for (const id of layoutIds) {
      const lp = rels.find((r) => r.id === id)?.part;
      if (!lp || !files[lp]) continue;
      const lxml = text(files, lp);
      const lroot = parseXml(lxml);
      const l = child(lroot, 'p:sldLayout');
      const own = spTree(lxml, 'p:sldLayout');
      // A placeholder without a frame of its own sits where the master's of its kind does.
      for (const ph of own.placeholders) {
        if (ph.frame) continue;
        const kind = MASTER_TYPE[ph.type] ?? ph.type;
        const m = placeholders.find((x) => x.type === kind) ?? placeholders.find((x) => (MASTER_TYPE[x.type] ?? x.type) === kind);
        if (m?.frame) ph.frame = m.frame;
      }
      layouts.push({
        path: lp,
        name: child(l, 'p:cSld')?.attrs.name ?? lp.split('/').pop()!,
        ...(l?.attrs.type ? { type: l.attrs.type } : {}),
        master: path,
        placeholders: own.placeholders,
        decorations: own.decorations,
        showMasterSp: l?.attrs.showMasterSp !== '0',
        background: background(lroot, 'p:sldLayout', files, lp, scheme, clrMap),
      });
    }
  }
  const slides = children(child(p, 'p:sldIdLst'), 'p:sldId').map((s) => byId.get(s.attrs['r:id']!)?.part).filter((x): x is string => !!x);
  const nm = children(child(p, 'p:notesMasterIdLst'), 'p:notesMasterId').map((n) => byId.get(n.attrs['r:id']!)?.part).find((x) => x && files[x]);
  let notesMaster: PptxTemplate['notesMaster'];
  if (nm) {
    const body = spTree(text(files, nm), 'p:notesMaster').placeholders.find((x) => x.type === 'body');
    notesMaster = { path: nm, ...(body?.idx !== undefined ? { bodyIdx: body.idx } : {}) };
  }
  return {
    files,
    width: Number(size?.attrs.cx) || 12192000,
    height: Number(size?.attrs.cy) || 6858000,
    colors: colors!,
    fonts,
    ...(themeName ? { themeName } : {}),
    masters,
    layouts,
    slides,
    ...(notesMaster ? { notesMaster } : {}),
    isTemplate: /presentationml\.template\.main\+xml/.test(types),
  };
}

// Layout names PowerPoint gives in its own languages, for templates that leave out the type.
const NAMES = {
  titleOnly: /title only|alleen titel|nur titel|titre seul|solo titolo|s[oó]lo (el )?t[ií]tulo|(somente|apenas) t[ií]tulo|endast rubrik|kun titel|bare tittel/i,
  obj: /title (and|&) content|titel en (object|inhoud)|titel und inhalt|titre et contenu|titolo e contenuto|t[ií]tulo y objetos|t[ií]tulo e conte[uú]do|rubrik och inneh[aå]ll/i,
  title: /^title slide$|titeldia|titelfolie|diapositive de titre|diapositiva (titolo|de t[ií]tulo)|slide de t[ií]tulo|rubrikbild/i,
  blank: /^(blank|leeg|leer|vide|vuota|en blanco|em branco|tom)$/i,
};

const has = (l: TemplateLayout, ...types: string[]) => l.placeholders.some((p) => types.includes(p.type));

/**
 * The layout for diagram slides (or the title slide): `wanted` by name (exact, then in part), else
 * Title Only, Title and Content, any title-only layout, Blank. Throws with the names when `wanted` is not there.
 */
export function chooseLayout(t: PptxTemplate, purpose: 'diagram' | 'title', wanted?: string): TemplateLayout {
  if (wanted) {
    const w = wanted.trim().toLowerCase();
    const hit = t.layouts.find((l) => l.name.toLowerCase() === w) ?? t.layouts.find((l) => l.name.toLowerCase().includes(w));
    if (hit) return hit;
    throw new Error(`The template has no layout "${wanted}"; it has: ${t.layouts.map((l) => `"${l.name}"`).join(', ')}`);
  }
  const by = (type: keyof typeof NAMES) => t.layouts.find((l) => l.type === type) ?? t.layouts.find((l) => NAMES[type].test(l.name));
  if (purpose === 'title') {
    const l = by('title') ?? t.layouts.find((x) => has(x, 'ctrTitle'));
    if (l) return l;
  }
  const footers = ['dt', 'ftr', 'sldNum'];
  return (
    by('titleOnly') ??
    by('obj') ??
    t.layouts.find((l) => has(l, 'title') && l.placeholders.every((p) => p.type === 'title' || footers.includes(p.type))) ??
    by('blank') ??
    t.layouts[0]!
  );
}
