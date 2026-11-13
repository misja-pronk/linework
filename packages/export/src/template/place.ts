// Where a diagram goes on a slide of a template layout: in its content or picture placeholder, or
// else in the room under the title down to the footers, and never over what the master or the
// layout draws there (a logo, a rule, a stripe down the side).
import type { PptxTemplate, Rect, TemplateLayout, TemplatePlaceholder } from './read.ts';

const IN = 914400;
const GAP = 0.15 * IN;
/** The left and right inset PowerPoint gives a text placeholder unless it says otherwise. */
const INSET = 91440;
const FOOTERS = ['dt', 'ftr', 'sldNum'];
const CONTENT = ['pic', 'obj', 'body', 'tbl', 'chart', 'dgm', 'media', 'clipArt'];

export interface SlidePlan {
  /** The title placeholder; absent on a layout without one (Blank). */
  title?: TemplatePlaceholder;
  /** The placeholder the diagram takes the place of, when the layout has one. */
  content?: TemplatePlaceholder;
  /** A text placeholder besides the content, for a step's caption or the subtitle. */
  caption?: TemplatePlaceholder;
  /** What the diagram (with any subtitle and caption of its own) is fitted into. */
  area: Rect;
  /** Footer, slide number and date as the layout has them, shown where the master says so. */
  footers: TemplatePlaceholder[];
}

const size = (r: Rect) => r.w * r.h;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The largest part of `area` that keeps clear of `block`: above, below, left or right of it. */
function clear(area: Rect, block: Rect): Rect {
  const g = GAP / 2;
  const right = area.x + area.w;
  const bottom = area.y + area.h;
  const options: Rect[] = [
    { x: area.x, y: area.y, w: area.w, h: block.y - g - area.y },
    { x: area.x, y: block.y + block.h + g, w: area.w, h: bottom - block.y - block.h - g },
    { x: area.x, y: area.y, w: block.x - g - area.x, h: area.h },
    { x: block.x + block.w + g, y: area.y, w: right - block.x - block.w - g, h: area.h },
  ].filter((r) => r.w > 0 && r.h > 0);
  return options.sort((a, b) => size(b) - size(a))[0] ?? area;
}

export function planSlide(t: PptxTemplate, layout: TemplateLayout): SlidePlan {
  const master = t.masters.find((m) => m.path === layout.master);
  const phs = layout.placeholders;
  const title = phs.find((p) => p.type === 'title') ?? phs.find((p) => p.type === 'ctrTitle');
  const slideArea = t.width * t.height;
  // The content placeholder: a picture one first, then the largest object or body placeholder.
  const candidates = phs.filter((p) => CONTENT.includes(p.type) && p.frame && size(p.frame) > slideArea * 0.15);
  const content = candidates.find((p) => p.type === 'pic') ?? candidates.sort((a, b) => size(b.frame!) - size(a.frame!))[0];
  const caption = phs.filter((p) => p !== content && (p.type === 'body' || p.type === 'subTitle') && p.frame).sort((a, b) => size(b.frame!) - size(a.frame!))[0];
  const hf = master?.hf ?? { sldNum: true, ftr: true, dt: true };
  const footers = phs.filter((p) => FOOTERS.includes(p.type) && hf[p.type as 'dt'] !== false);
  // Footers drawn on the slide, or on the master when the layout has none of its own.
  const footerFrames = [...phs, ...(master?.placeholders ?? [])].filter((p) => FOOTERS.includes(p.type) && p.frame && p.frame.y > t.height / 2).map((p) => p.frame!);

  let area: Rect;
  if (content?.frame) area = { ...content.frame };
  else {
    // Left and right as the master's text area (a title may stop short of a logo); top under the title.
    const body = master?.placeholders.find((p) => p.type === 'body')?.frame;
    const side = body ?? title?.frame ?? { x: 0.5 * IN, y: 0.4 * IN, w: t.width - IN, h: 0 };
    const top = title?.frame ? title.frame.y + title.frame.h + GAP : side.y;
    const floor = footerFrames.length ? Math.min(...footerFrames.map((f) => f.y)) - GAP : t.height - side.x;
    area = { x: side.x, y: top, w: side.w, h: floor - top };
  }
  // A caption placeholder under the content keeps its own room.
  if (caption?.frame && overlaps(area, caption.frame)) area = clear(area, caption.frame);
  // Keep clear of what the layout and the master draw, but not of a picture that is the background.
  const drawn = [...layout.decorations, ...(layout.showMasterSp && master ? master.decorations : [])].filter((d) => size(d) < slideArea * 0.5);
  for (const d of drawn) if (overlaps(area, d)) area = clear(area, d);
  // In by a text placeholder's own inset, so the drawing lines up with the title's first letter.
  area = { x: area.x + INSET, y: area.y, w: area.w - 2 * INSET, h: area.h };
  return { ...(title ? { title } : {}), ...(content ? { content } : {}), ...(caption ? { caption } : {}), area, footers };
}

const escape = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A slide's own copy of a layout placeholder with text in it: no frame and no run formatting, so
 * position, face, size and colour all come from the template. `plain` drops the bullets a body
 * placeholder would put in front of a caption.
 */
export function filled(id: number, ph: TemplatePlaceholder, lines: { text: string; bold?: boolean }[], plain = false): string {
  const attrs = `${ph.type !== 'obj' ? ` type="${ph.type}"` : ''}${ph.idx !== undefined ? ` idx="${ph.idx}"` : ''}`;
  const pPr = plain ? '<a:pPr marL="0" indent="0"><a:buNone/></a:pPr>' : '';
  const paras = lines.map((l) => `<a:p>${pPr}<a:r><a:rPr lang="en-US"${l.bold ? ' b="1"' : ''} dirty="0"/><a:t>${escape(l.text)}</a:t></a:r></a:p>`).join('');
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escape(ph.name || ph.type)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph${attrs}/></p:nvPr></p:nvSpPr>` +
    `<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras || '<a:p><a:endParaRPr lang="en-US"/></a:p>'}</p:txBody></p:sp>`
  );
}

/**
 * A footer, date or slide number placeholder as the layout has it (its text, its slide number field), with an id of this slide.
 * A slide number field says `number`, as PowerPoint writes it: the layout's ‹#› is what an app that does not count
 * the slides itself shows (Quick Look, Mail, a phone's preview).
 */
export const footer = (id: number, ph: TemplatePlaceholder, number?: number) => {
  const xml = ph.xml.replace(/(<p:cNvPr\b[^>]*?\bid=")\d+"/, `$1${id}"`);
  return number === undefined ? xml : xml.replace(/(<a:fld\b[^>]*\btype="slidenum"[^>]*>[\s\S]*?<a:t>)[^<]*(<\/a:t>)/g, `$1${number}$2`);
};
