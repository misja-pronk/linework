// Draws a placed graph as a standalone SVG. Attributes only (no CSS classes), so browsers,
// resvg and slide tools all render it the same.
import { chips, linkHref, withBadgeIcons, type Box, type Link, type CardShape, type Chip, type Graph, type GraphEdge, type GraphGroup, type Marker, type Placed, type Point, type TableShape } from '@linework/core';
import { baselineOffset, bundledFont, chipText, fitText, groupCaptionInk, groupFill, groupLabel, groupLabelInk, groupLine, look, measureText, monoCell, paperTint, type Face, type Theme } from '@linework/theme';
import { icon } from '@linework/icons';
import { arrowBack, endMarker as marker, patternOver, patternWidth, cardStroke, chipBack, dashAttr, diamondTile, esc, glyph as drawIcon, iconTile, image, junctionMark, labelAttrs, labelBack, labelInk, labelString, linePath, monoAttr, numberMark, r1, shadowAttr, themedPath } from './paint.ts';
import { groundOf } from './ground.ts';
import { bridges } from './bridges.ts';
import { dotGrid, drawSheet, sheetPad } from './sheet.ts';
import { legendBlock, legendColumn } from './legend.ts';
import { BODY, bodyLines, cardCaption, cardInsets, CHIP, chipRows, DECISION_TIP, groupIconRoom, groupLabelWidth, LABEL_ICON, labelPad, LINK_ROOM, rowMarks, SECTION_PX, STACK, STEP_ROOM, tableGrid, tableHeader } from './size.ts';
import { drawMatrix } from './matrix.ts';
import { drawSequence } from './sequence.ts';
import { drawGitflow } from './gitflow.ts';
import { drawRoadmap } from './roadmap.ts';
import { drawJourney } from './journey.ts';
import { drawFlow, drawMarks, flowOutline, laneHeadDown, laneHeader, laneMarks } from './flow.ts';
import { drawTags, endsRoom, endStyle, endTagAt, tagsWidth, TAG } from './tags.ts';
import { blockMarks } from './block.ts';
import { captionBlock, drawNote, noteMargins, placeNotes, quietTheme, strongTheme, type StepView } from './steps.ts';
import { sketchSvg } from './sketch.ts';
import { tr } from '@linework/i18n/drawing';

export { legendItems, legendWidth } from './legend.ts';

export interface SvgOptions {
  /** Embed the theme's fonts (latin subsets) so the SVG looks the same everywhere. */
  fonts?: 'embed' | 'none';
  /** Prefix for ids inside the SVG, so several diagrams can sit on one page. */
  idPrefix?: string;
  /** Add data-* attributes that the editor uses to find elements. */
  interactive?: boolean;
  /** With `interactive`: the editor's "Drop shapes here" in empty groups. Off for a drawing that is only looked at. */
  hints?: boolean;
  /** Only the data-* attributes, without the editor's hints and with real links: the presenter finds linked elements by them. */
  marks?: boolean;
  /** The diagram's own file name, so a "#view" link can point at that view's SVG. */
  file?: string;
  /** Official icons (BYO packs) as data URIs, by node and group id: drawn as-is instead of the line icon. */
  images?: { nodes?: Map<string, string>; groups?: Map<string, string> };
  /** Draw one step of the diagram's steps: hidden things leave their space empty, the rest stands back behind what is in focus. */
  stepView?: StepView;
}

export interface SvgResult {
  svg: string;
  width: number;
  height: number;
  /** Where the diagram's layout origin sits in the SVG (title and padding come before it). */
  origin: Point;
}

export function drawSvg(source: Graph, placed: Placed, theme: Theme, opts: SvgOptions = {}): SvgResult {
  const graph = withBadgeIcons(source);
  // A framed sheet keeps the title and the drawing clear of its frame.
  const pad = theme.space.pad + sheetPad(theme);
  const id = opts.idPrefix ?? 'linework';
  const block = theme.titleBlock && Object.keys(theme.titleBlock).length ? theme.titleBlock : undefined;
  // With an imprint, client, version and date are one small line beside the legend; the header is then only for a logo.
  const brand = block && (!block.imprint || block.logo) ? brandHeader(graph, theme, block) : undefined;
  const header = brand ? brand.height : graph.title ? (graph.subtitle ? 64 : 44) : 0;
  const where = graph.legend?.length ? (theme.legend ?? 'bottom') : 'none';
  const column = where === 'right' ? legendColumn(graph, theme) : undefined;
  const side = column ? 40 + column.width : 0;
  const footer = block?.footer || (block?.classification && !block.imprint) ? 44 : 0;
  // One step of a presentation: its caption says what the numbered list would, and callouts get room that is the same at every step.
  const view = opts.stepView?.states[opts.stepView.index] ? opts.stepView : undefined;
  const state = view?.states[view.index];
  const quiet = state ? quietTheme(theme) : theme;
  const themeOf = (e: string | undefined) => (e === 'dim' ? quiet : theme);
  /** A line as its step draws it: quiet where it stands back, heavier on the route in focus. */
  const lineTheme = (e: GraphEdge) => (state?.edges[e.id] === 'focus' ? strongTheme(theme) : themeOf(state?.edges[e.id]));
  // The whole drawing of a story passes its steps as `room` without a state of its own: it keeps their callouts' room.
  const margin = view || opts.stepView?.room ? noteMargins(view ?? opts.stepView!, placed) : { left: 0, top: 0, right: 0, bottom: 0 };
  const list = view ? { width: 0, height: 0, draw: () => '' } : stepList(graph, theme);
  // What the page is wide anyway; a legend that is a key wraps to it.
  const room = Math.max(placed.width + margin.left + margin.right + side, brand ? brand.width : titleWidth(graph, theme), list.width);
  const above = legendBlock(where === 'top' ? graph.legend! : [], theme, 'top', room);
  const below = legendBlock(where === 'bottom' ? graph.legend! : [], theme, 'bottom', room);
  const width = Math.ceil(Math.max(room, above.width, below.width) + 2 * pad);
  const caption = view && view.caption !== false ? captionBlock(view, theme, width - 2 * pad) : undefined;
  const height = Math.ceil(Math.max(placed.height + margin.top + margin.bottom + list.height + (caption?.height ?? 0), column ? column.height : 0) + header + above.height + below.height + footer + 2 * pad);
  const origin = { x: pad + margin.left, y: pad + header + above.height + margin.top };
  const ground = groundOf(graph, placed, theme);
  const dots = dotGrid(width, height, theme, id);
  const data = (kind: string, key: string) => (opts.interactive || opts.marks ? ` data-${kind}="${esc(key)}"` : '');
  const nodeImages = opts.images?.nodes;
  const groupImages = opts.images?.groups;

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${esc(theme.font.family)}" text-rendering="geometricPrecision">`,
  );
  out.push('<defs>');
  if (opts.fonts !== 'none') out.push(`<style>${fontFaces(theme)}</style>`);
  if (theme.shadow.opacity > 0)
    out.push(
      `<filter id="${id}-shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="${theme.shadow.color}" flood-opacity="${theme.shadow.opacity * 1.2}"/><feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="${theme.shadow.color}" flood-opacity="${theme.shadow.opacity}"/></filter>`,
    );
  out.push(dots.defs);
  out.push('</defs>');
  out.push(`<rect width="${width}" height="${height}" fill="${theme.canvas}"/>`);
  out.push(dots.body);
  out.push(drawSheet(width, height, theme));

  if (brand) out.push(brand.draw(pad, width));
  else if (graph.title) {
    out.push(drawTitle(pad, pad + 16, graph.title, theme));
    if (graph.subtitle) out.push(text(pad, pad + 40, graph.subtitle, theme.size.subtitle, 400, theme.textMuted));
  }
  out.push(above.draw(pad, pad + header, width - 2 * pad));

  out.push(`<g transform="translate(${origin.x} ${origin.y})">`);
  const filled = new Set([...graph.nodes.map((n) => n.parent), ...graph.groups.map((g) => g.parent)].filter(Boolean));
  // Lanes share one header size, so their names line up.
  const across = (placed.direction ?? graph.direction) === 'right';
  const laneHead = across ? Math.max(0, ...graph.groups.filter((g) => g.lane).map((g) => laneHeader(g, theme))) : laneHeadDown(graph.groups, theme);
  for (const g of byDepth(graph.groups)) {
    const box = placed.groups.get(g.id);
    if (!box || state?.groups[g.id] === 'hidden') continue;
    const theme = themeOf(state?.groups[g.id]);
    if (g.lane) {
      out.push(linked(g.links, `<g${data('group', g.id)}>${tip(g.description)}${drawMarks(laneMarks(g, box, theme, across, laneHead), theme, `${id}-shadow`)}</g>`, opts));
      continue;
    }
    // In the editor an empty group says what it is for; exports stay clean.
    const hint = opts.interactive && opts.hints !== false && !filled.has(g.id) ? textMid(box.x + box.width / 2, box.y + (box.height + theme.space.group.header) / 2, tr(theme.lang, 'Drop shapes here'), theme.size.caption, 500, theme.textFaint, 'middle') : '';
    const mark = g.links?.length ? linkMark(box.x + box.width - 16 - 12, box.y + 22 - 6, theme) : '';
    // Tags sit on the top edge, at the end, where they never cover the name.
    const tags = g.marks?.length ? drawTags(theme, g.marks, box.x + box.width - 16 - tagsWidth(g.marks) - (mark ? 24 : 0), box.y, 'pattern') : '';
    out.push(linked(g.links, `<g${data('group', g.id)}>${tip(g.description)}${g.focused ? focusRing(box, theme.radius.group, theme) : ''}${drawGroup(g, box, theme, ground.depth(g.id), !!mark, groupImages?.get(g.id))}${hint}${mark}${tags}</g>`, opts));
  }
  const badges = chips(graph);
  const badged = new Set([...badges.values()].flat().map((c) => c.edge));
  // In a step, quiet lines go under the others and the route in focus on top, heavier and with a soft halo.
  const weight = (e: GraphEdge) => (state?.edges[e.id] === 'dim' ? 0 : state?.edges[e.id] === 'focus' ? 2 : 1);
  for (const e of state ? [...graph.edges].sort((a, b) => weight(a) - weight(b)) : graph.edges) {
    const pe = placed.edges.get(e.id);
    const em = state?.edges[e.id];
    if (!pe || pe.points.length < 2 || badged.has(e.id) || em === 'hidden') continue;
    const pts = toOutline(pe.points, graph, placed, e.from.node, e.to.node);
    // One halo for every line in focus, in no colour of its own: a line's colour keeps saying what kind
    // of line it is (the key), and a warm or toned glow would read as a warning or as a second meaning.
    const halo = em === 'focus' ? `<path d="${roundedPath(pts, theme.radius.corner)}" fill="none" stroke="${theme.text}" stroke-opacity="${FOCUS_HALO}" stroke-width="${r1(theme.stroke.edge * 1.8 + 8)}" stroke-linecap="round" stroke-linejoin="round" data-halo=""/>` : '';
    out.push(`<g${data('edge', e.id)}>${halo}${drawEdge(e, pts, lineTheme(e))}</g>`);
  }
  // Where two lines cross, one hops over the other, so a crossing never reads as a junction.
  if (state) {
    const shown = { ...graph, edges: graph.edges.filter((e) => state.edges[e.id] !== 'hidden') };
    out.push(bridges(shown, placed, theme, ground, (e) => edgeColor(e, lineTheme(e)), badged, { rank: weight, scale: (e) => lineTheme(e).stroke.edge / theme.stroke.edge }));
    out.push(junctions({ ...graph, edges: graph.edges.filter((e) => state.edges[e.id] === 'dim') }, placed, quiet));
    out.push(junctions({ ...graph, edges: graph.edges.filter((e) => !state.edges[e.id] || state.edges[e.id] === 'focus') }, placed, theme));
  } else {
    out.push(bridges(graph, placed, theme, ground, (e) => edgeColor(e, theme), badged));
    out.push(junctions(graph, placed, theme));
  }
  for (const n of graph.nodes) {
    const box = placed.nodes.get(n.id);
    if (!box || state?.nodes[n.id] === 'hidden') continue;
    const dim = state?.nodes[n.id] === 'dim';
    const theme = themeOf(state?.nodes[n.id]);
    const shape = n.shape;
    const link = !!n.links?.length;
    const cardChips = state ? badges.get(n.id)?.filter((c) => state.edges[c.edge] !== 'hidden') : badges.get(n.id);
    const drawn =
      shape.kind === 'card' ? drawCard(shape, box, theme, id, cardChips, (edge) => data('edge', edge), link, nodeImages?.get(n.id))
      : shape.kind === 'table' ? drawTable(shape, box, theme, id, nodeImages?.get(n.id))
      : shape.kind === 'sequence' ? drawSequence(shape, box, theme, `${id}-shadow`, state?.message ? { message: state.message, quiet } : undefined, { interactive: opts.interactive, marks: opts.marks, file: opts.file })
      : shape.kind === 'gitflow' ? drawGitflow(shape, box, theme, `${id}-shadow`)
      : shape.kind === 'roadmap' ? drawRoadmap(shape, box, theme)
      : shape.kind === 'journey' ? drawJourney(shape, box, theme, `${id}-shadow`, state?.journey)
      // Drawn by the journey itself: this is where a click on a step lands.
      : shape.kind === 'journey-part' ? `<rect x="${r1(box.x)}" y="${r1(box.y)}" width="${r1(box.width)}" height="${r1(box.height)}" rx="10" fill="transparent"/>`
      : shape.kind === 'flow' ? drawFlow(shape, box, theme, `${id}-shadow`, placed.labels?.get(n.id))
      : shape.kind === 'block' ? drawMarks(blockMarks(shape, box, theme), theme, `${id}-shadow`)
      : drawMatrix(shape, box, theme, `${id}-shadow`);
    // What stands back lies flat: no shadow, and an official icon fades with it.
    const body = dim ? drawn.replaceAll(` filter="url(#${id}-shadow)"`, '').replaceAll('<image ', '<image opacity="0.35" ') : drawn;
    const boxed = shape.kind !== 'flow' || shape.form === 'task' || shape.form === 'subprocess' || shape.form === 'state';
    const mark = link && shape.kind !== 'matrix' && boxed ? linkMark(box.x + box.width - 12 - 9, box.y + 8, theme) : '';
    // Tags on the top edge, at the end: on the card, never over its name.
    const tags = n.marks?.length && shape.kind !== 'matrix' ? drawTags(theme, n.marks, box.x + box.width - 10 - tagsWidth(n.marks), box.y, 'pattern') : '';
    // Marked as standing back in words too: a look without shadows shows it only in its colours.
    out.push(linked(n.links, `<g${data('node', n.id)}${dim ? data('dim', '') : ''}>${tip(n.description)}${n.focused ? focusRing(box, theme.radius.card, theme) : ''}${body}${mark}${tags}</g>`, opts));
  }
  // Labels last, so lines never cross them.
  for (const e of graph.edges) {
    const em = state?.edges[e.id];
    if (badged.has(e.id) || em === 'hidden') continue;
    const pe = placed.edges.get(e.id);
    if (!(e.label || e.step || e.marks?.length) || !pe?.label) continue;
    // The room kept for a context map's end tags is not the label's.
    const room = endsRoom(e.ends);
    const box = besideShortLine(pe.points, room ? { ...pe.label, x: pe.label.x + room, width: pe.label.width - 2 * room } : pe.label, placed);
    const lt = lineTheme(e);
    out.push(drawEdgeLabel(e.label ?? '', box, lt, ground.under(box), edgeColor(e, lt), e.step, e.icon, e.tone, e.marks));
  }
  // The ends of a context map's relationships: U and D, and the patterns on each side.
  const taken: Box[] = [];
  const segs = [...placed.edges].flatMap(([id, pe]) => pe.points.slice(1).map((v, i) => ({ id, box: { x: Math.min(v.x, pe.points[i]!.x), y: Math.min(v.y, pe.points[i]!.y), width: Math.abs(v.x - pe.points[i]!.x), height: Math.abs(v.y - pe.points[i]!.y) } })));
  for (const e of graph.edges) {
    const pe = placed.edges.get(e.id);
    if (!e.ends || badged.has(e.id) || state?.edges[e.id] === 'hidden' || !pe || pe.points.length < 2) continue;
    const pts = toOutline(pe.points, graph, placed, e.from.node, e.to.node);
    out.push(drawEnds(e, pts, lineTheme(e), taken, segs.filter((g) => g.id !== e.id).map((g) => g.box)));
  }
  if (state) for (const n of placeNotes(state, placed)) out.push(drawNote(n, theme));
  out.push('</g>');
  if (list.height) out.push(list.draw(origin.x, origin.y + placed.height));
  // The caption closes the drawing: under the legend, above the footer.
  const said = caption?.height ?? 0;
  if (caption) out.push(caption.draw(pad, height - pad - footer - said));

  out.push(below.draw(pad, height - pad - footer - said - below.height, width - 2 * pad));
  if (column) out.push(column.draw(origin.x + placed.width + margin.right + 40, origin.y));
  if (footer) out.push(drawFooter(block!, theme, pad, width, height - pad));
  out.push('</svg>');
  // The sketch look redraws the finished drawing by hand; every other look is drawn as it is.
  const hand = look(theme).sketch;
  return { svg: hand ? sketchSvg(out.join(''), theme, hand) : out.join(''), width, height, origin };
}

/** A subtle link icon: this element leads somewhere (a URL, its detailed diagram). */
function linkMark(x: number, y: number, theme: Theme): string {
  return drawIcon('link', x, y, 12, theme.textFaint, 1.6);
}

/** How strongly the halo under a line in focus shows: a soft shade, not a colour. */
export const FOCUS_HALO = 0.13;

const tip = (description?: string) => (description ? `<title>${esc(description)}</title>` : '');

/** Exports carry real links (diagrams point at the SVG next to them); in the editor a click selects. */
function linked(links: Link[] | undefined, body: string, opts: SvgOptions): string {
  const first = links?.[0];
  const href = first && !opts.interactive ? linkHref(first, opts.file) : undefined;
  return href ? `<a href="${esc(href)}"${first!.kind === 'url' ? ' target="_blank"' : ''}>${body}</a>` : body;
}

/** The @font-face rules of the faces a theme is set in: its bundled sans and mono families, and a brand's own files. */
function fontFaces(theme: Theme): string {
  const bundled = (family: string | undefined) => {
    const f = bundledFont(family);
    const name = f && /\s/.test(f.family) ? `'${f.family}'` : f?.family;
    return f ? Object.entries(f.woff2).map(([w, b64]) => `@font-face{font-family:${name};font-style:normal;font-weight:${w};src:url(data:font/woff2;base64,${b64}) format('woff2')}`).join('') : '';
  };
  // A brand font comes first; Inter stays as the fallback for glyphs the brand font lacks.
  const mime = { woff2: 'font/woff2', woff: 'font/woff', truetype: 'font/ttf', opentype: 'font/otf' };
  const brand = (theme.font.faces ?? [])
    .map((f) => `@font-face{font-family:'${f.family.replace(/'/g, '')}';font-style:${f.style};font-weight:${f.weight};src:url(data:${mime[f.format]};base64,${f.data}) format('${f.format}')}`)
    .join('');
  return brand + bundled(theme.font.sans ?? 'Inter') + bundled(theme.font.monoFace);
}

/** Header of a brand title block: logo, title and subtitle on the left, client and version on the right, a rule below. */
function brandHeader(graph: Graph, theme: Theme, block: NonNullable<Theme['titleBlock']>) {
  const LOGO = 32;
  const logo = block.logo;
  const logoW = logo ? Math.min(180, (LOGO * logo.width) / Math.max(1, logo.height)) : 0;
  const titleX = logoW ? logoW + 16 : 0;
  // The imprint carries these when it is on; they are never said twice.
  const client = block.imprint ? undefined : block.client;
  const meta = block.imprint ? '' : [block.project, block.version, block.date].filter(Boolean).join('  ·  ');
  const rightW = Math.max(client ? measureText(client, theme.size.subtitle, 600) : 0, meta ? measureText(meta, theme.size.caption, 400) : 0);
  const content = Math.max(logo ? LOGO : 0, graph.subtitle ? 44 : graph.title ? 24 : 0, meta && client ? 36 : 18);
  const height = content + 40;
  const width = titleX + titleWidth(graph, theme) + (rightW ? rightW + 48 : 0);
  const draw = (pad: number, total: number) => {
    let s = '';
    const top = pad;
    if (logo) s += image(logo.href, pad, top + (content - LOGO) / 2, logoW, LOGO);
    const tx = pad + titleX;
    // Title and subtitle centred as a pair on the logo.
    const ty = graph.subtitle ? top + content / 2 - 6 : top + content / 2 + baselineOffset(theme.size.title);
    if (graph.title) s += drawTitle(tx, ty, graph.title, theme);
    if (graph.subtitle) s += text(tx, ty + 22, graph.subtitle, theme.size.subtitle, 400, theme.textMuted);
    const rx = total - pad;
    if (client && meta) {
      s += text(rx, top + content / 2 - 4, client, theme.size.subtitle, 600, theme.text, 'end');
      s += text(rx, top + content / 2 + 14, meta, theme.size.caption, 400, theme.textMuted, 'end');
    } else if (client || meta)
      s += textMid(rx, top + content / 2, client ?? meta, client ? theme.size.subtitle : theme.size.caption, client ? 600 : 400, client ? theme.text : theme.textMuted, 'end');
    // A hairline across with a short accent segment: the brand mark of the frame.
    const ry = top + content + 16;
    s += `<rect x="${pad}" y="${r1(ry)}" width="${r1(total - 2 * pad)}" height="1" fill="${theme.border}"/>`;
    s += `<rect x="${pad}" y="${r1(ry - 1)}" width="64" height="3" rx="1.5" fill="${theme.accent ?? theme.tones.blue.fg}"/>`;
    return s;
  };
  return { height, width, draw };
}

function drawFooter(block: NonNullable<Theme['titleBlock']>, theme: Theme, pad: number, width: number, bottom: number): string {
  const y = bottom - 28;
  let s = `<rect x="${pad}" y="${r1(y)}" width="${r1(width - 2 * pad)}" height="1" fill="${theme.border}"/>`;
  const cy = bottom - 8;
  if (block.footer) s += textMid(pad, cy, fitText(block.footer, theme.size.caption, 400, width - 2 * pad - 160), theme.size.caption, 400, theme.textFaint);
  if (block.classification) {
    const label = block.classification.toUpperCase();
    s += `<text x="${r1(width - pad)}" y="${r1(cy + baselineOffset(10.5))}" font-size="10.5" font-weight="600" letter-spacing="0.9" fill="${theme.accent ?? theme.textMuted}" text-anchor="end">${esc(label)}</text>`;
  }
  return s;
}

function text(x: number, y: number, s: string, size: number, weight: number, fill: string, anchor?: 'end' | 'middle', extra = ''): string {
  const a = anchor ? ` text-anchor="${anchor}"` : '';
  return `<text x="${r1(x)}" y="${r1(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}"${a}${extra}>${esc(s)}</text>`;
}

/** Text vertically centred on cy. */
function textMid(x: number, cy: number, s: string, size: number, weight: number, fill: string, anchor?: 'end' | 'middle', extra = '', face: Face = 'sans') {
  return text(x, cy + baselineOffset(size, face), s, size, weight, fill, anchor, extra);
}

/**
 * Italics (an abstract class or member) as a slant about the baseline at y: no italic face is
 * bundled, and the PNG and PDF renderers draw `font-style="italic"` upright where the face has none.
 */
const slant = (y: number) => ` transform="matrix(1 0 -0.2 1 ${r1(0.2 * y)} 0)"`;

/** The title as the theme sets it: its size and weight, in capitals or the monospace face where asked. */
function drawTitle(x: number, y: number, title: string, theme: Theme): string {
  const t = look(theme).title;
  return text(x, y, t.caps ? title.toUpperCase() : title, t.size, t.weight, theme.text, undefined, (t.mono ? monoAttr(theme) : '') + (t.tracking ? ` letter-spacing="${t.tracking}"` : ''));
}

export function byDepth(groups: GraphGroup[]): GraphGroup[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const depth = (g: GraphGroup): number => (g.parent && byId.get(g.parent) ? 1 + depth(byId.get(g.parent)!) : 0);
  return [...groups].sort((a, b) => depth(a) - depth(b));
}

/** What a focus view is about: a ring in the accent colour just outside the shape, with a soft glow under it. */
function focusRing(b: Box, radius: number, theme: Theme): string {
  const colour = theme.accent ?? theme.tones.blue.fg;
  const at = (d: number) => `x="${r1(b.x - d)}" y="${r1(b.y - d)}" width="${r1(b.width + 2 * d)}" height="${r1(b.height + 2 * d)}" rx="${r1(radius + d)}" fill="none" stroke="${colour}"`;
  return `<rect ${at(4)} stroke-opacity="0.2" stroke-width="7"/><rect ${at(4)} stroke-width="2"/>`;
}

function drawGroup(g: GraphGroup, b: Box, theme: Theme, depth = 0, link = false, img?: string): string {
  const lk = look(theme).group;
  const tone = theme.tones[g.tone];
  // Depth tints tell nesting; where a theme draws no outline, a dashed boundary still gets one.
  // A trust boundary is a heavier line with longer dashes, in rose.
  const line = g.trust ? theme.tones.rose.fg : (groupLine(theme, tone) ?? (g.border === 'dashed' ? theme.border : undefined));
  const dash = g.trust ? ' stroke-dasharray="8 4"' : g.border === 'dashed' ? ` stroke-dasharray="${lk.dash}"` : '';
  const weight = g.trust ? Math.max(1.6, theme.stroke.group + 0.6) : theme.stroke.group;
  const cy = b.y + 22;
  const x = b.x + 16;
  const lab = groupLabel(theme, g.label);
  const spacing = lab.tracking ? ` letter-spacing="${lab.tracking}"` : '';
  const iconRoom = groupIconRoom(theme, !!img);
  const labelW = measureText(lab.text, lab.size, 600, 'sans', lab.tracking);
  const maxLabel = b.width - 32 - iconRoom - (link ? LINK_ROOM : 0);
  const label = fitText(lab.text, lab.size, 600, maxLabel, 'sans', lab.tracking);
  let s = `<rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.width)}" height="${r1(b.height)}" rx="${theme.radius.group}" fill="${groupFill(theme, depth, tone)}"${line ? ` stroke="${line}" stroke-width="${weight}"${dash}` : ''}/>`;
  if (img) s += image(img, x - 1, cy - 9, 18, 18);
  else if (lk.icon) s += drawIcon(g.icon, x, cy - lk.icon / 2, lk.icon, tone.fg, 1.75);
  s += textMid(x + iconRoom, cy, label, lab.size, 600, groupLabelInk(theme, tone), undefined, spacing);
  if (g.caption && groupLabelWidth(g.label, g.caption, theme) + 32 + (link ? LINK_ROOM + 12 : 0) <= b.width)
    s += textMid(x + iconRoom + labelW + 8, cy, g.caption, theme.size.caption, 400, groupCaptionInk(theme));
  return s;
}

function drawCard(shape: CardShape, b: Box, theme: Theme, id: string, badges: Chip[] = [], data: (edge: string) => string = () => '', link = false, img?: string): string {
  // A stacked pair: the second card peeks out below and to the right, the first is drawn as usual.
  let plate = '';
  if (shape.stack) {
    plate = `<rect x="${r1(b.x + STACK)}" y="${r1(b.y + STACK)}" width="${r1(b.width - STACK)}" height="${r1(b.height - STACK)}" rx="${theme.radius.card}" fill="${theme.surface}" stroke="${theme.textFaint}" stroke-opacity="0.45" stroke-width="${theme.stroke.card}"${shadowAttr(theme, `${id}-shadow`)}/>`;
    b = { ...b, width: b.width - STACK, height: b.height - STACK };
  }
  return plate + drawOneCard(shape, b, theme, id, badges, data, link, img);
}

function drawOneCard(shape: CardShape, b: Box, theme: Theme, id: string, badges: Chip[], data: (edge: string) => string, link: boolean, img?: string): string {
  const c = theme.space.card;
  const tone = theme.tones[shape.tone];
  // With badges or a description the tile and text keep the top of the card, and those fill the rest.
  const body = shape.body && !badges.length ? bodyLines(shape.body, b.width, theme) : [];
  const top = badges.length || body.length ? c.height : b.height;
  const muted = !!shape.muted;
  const inset = cardInsets(shape, theme, link);
  const centred = inset.centred && !badges.length;
  const tx = b.x + inset.left;
  const room = b.width - inset.left - inset.right;
  const caption = cardCaption(shape);
  const cy = b.y + top / 2;
  // Out of scope (an external system): a flat grey card, so what is in scope stands out.
  const frame = muted
    ? `fill="${theme.tones.slate.bg}" stroke="${theme.tones.slate.line}" stroke-width="${theme.stroke.card}"`
    : `fill="${theme.surface}" stroke="${cardStroke(theme, tone)}" stroke-width="${theme.stroke.card}"${shadowAttr(theme, `${id}-shadow`)}`;
  let s: string;
  if (shape.form === 'decision') {
    // Pointed ends and an accent outline: a question, at a glance, without a diamond's wasted space.
    const t = DECISION_TIP;
    const pts = [
      { x: b.x, y: b.y + b.height / 2 },
      { x: b.x + t, y: b.y },
      { x: b.x + b.width - t, y: b.y },
      { x: b.x + b.width, y: b.y + b.height / 2 },
      { x: b.x + b.width - t, y: b.y + b.height },
      { x: b.x + t, y: b.y + b.height },
    ];
    s = `<path d="${roundedPolygon(pts, theme.radius.card - 4)}" fill="${theme.surface}" stroke="${tone.fg}" stroke-opacity="0.45" stroke-width="${theme.stroke.card + 0.2}"${shadowAttr(theme, `${id}-shadow`)}/>`;
    // The tile turned on its point: a diamond, the flow-chart sign for a decision.
    s += diamondTile(theme, tone, b.x + t + 23, cy, shape.icon);
  } else {
    // A terminal is a pill, its tile a circle in the round end.
    const pill = shape.form === 'terminal';
    s = `<rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.width)}" height="${r1(b.height)}" rx="${pill ? r1(b.height / 2) : theme.radius.card}" ${frame}/>`;
    if (theme.cardBar && !pill) s += leftBar(b, theme.radius.card, tone.fg);
    const tileX = b.x + c.padX;
    const tileY = b.y + (top - c.tile) / 2;
    const official = shape.form !== 'plain' ? img : undefined;
    if (official || shape.icon) s += iconTile(theme, { x: tileX, y: tileY, slot: c.tile, tone, icon: shape.icon, round: pill || shape.form === 'person', muted, image: official });
  }
  const x = centred ? b.x + b.width / 2 : tx;
  const anchor = centred ? 'middle' : undefined;
  const label = fitText(shape.label, theme.size.label, 600, room);
  const ink = muted ? theme.textMuted : theme.text;
  if (caption) {
    s += textMid(x, cy - 8, label, theme.size.label, 600, ink, anchor);
    s += textMid(x, cy + 9.5, fitText(caption, theme.size.caption, 400, room), theme.size.caption, 400, muted ? theme.textFaint : theme.textMuted, anchor);
  } else s += textMid(x, cy, label, theme.size.label, 600, ink, anchor);
  for (const [i, line] of body.entries())
    s += textMid(b.x + c.padX + 1, b.y + c.height + BODY.top + BODY.line * (i + 0.5), line, theme.size.caption, 400, muted ? theme.textFaint : theme.textMuted);
  for (const p of chipRows(badges, room, theme).placed)
    s += `<g${data(p.chip.edge)}><title>${esc(p.chip.title)}</title>${drawChip(p.chip, tx + p.x, b.y + CHIP.top + p.y, p.width, theme)}</g>`;
  return s;
}

/** A tone strip on the card's left edge that follows its rounded corners. */
function leftBar(b: Box, r: number, color: string): string {
  const w = 3;
  if (r <= w) return `<rect x="${r1(b.x)}" y="${r1(b.y)}" width="${w}" height="${r1(b.height)}" fill="${color}"/>`;
  const dy = Math.sqrt(r * r - (r - w) * (r - w));
  const x = b.x;
  const y0 = b.y;
  const y1 = b.y + b.height;
  return `<path d="M${r1(x + w)} ${r1(y0 + r - dy)}A${r} ${r} 0 0 0 ${r1(x)} ${r1(y0 + r)}V${r1(y1 - r)}A${r} ${r} 0 0 0 ${r1(x + w)} ${r1(y1 - r + dy)}Z" fill="${color}"/>`;
}

/** A closed polygon with rounded corners. */
function roundedPolygon(pts: Point[], radius: number): string {
  const n = pts.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n]!;
    const c = pts[i]!;
    const q = pts[(i + 1) % n]!;
    const l1 = Math.hypot(c.x - p.x, c.y - p.y);
    const l2 = Math.hypot(q.x - c.x, q.y - c.y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    const a = { x: c.x - ((c.x - p.x) / l1) * r, y: c.y - ((c.y - p.y) / l1) * r };
    const e = { x: c.x + ((q.x - c.x) / l2) * r, y: c.y + ((q.y - c.y) / l2) * r };
    d += `${i ? 'L' : 'M'}${r1(a.x)} ${r1(a.y)}Q${r1(c.x)} ${r1(c.y)} ${r1(e.x)} ${r1(e.y)}`;
  }
  return d + 'Z';
}

/**
 * Lines meet a decision's side where the box is, but its pointed ends slant inwards: carry the
 * line's end on to the outline, so nothing stops short in the air.
 */
export function toOutline(points: Point[], graph: Graph, placed: Placed, from: string, to: string): Point[] {
  const decision = (id: string) => {
    const n = graph.nodes.find((x) => x.id === id);
    return n?.shape.kind === 'card' && n.shape.form === 'decision' ? placed.nodes.get(id) : undefined;
  };
  const pts = points.map((p) => ({ ...p }));
  for (const [i, j, id] of [[0, 1, from], [pts.length - 1, pts.length - 2, to]] as const) {
    // A circle or a diamond of a process: the same, along the line's own direction.
    const n = graph.nodes.find((x) => x.id === id);
    const box = placed.nodes.get(id);
    if (n?.shape.kind === 'flow' && box && pts.length > 1) {
      pts[i] = flowOutline(n.shape, box, pts[i]!, pts[j]!);
      continue;
    }
    const b = decision(id);
    const p = pts[i]!;
    if (!b || Math.abs(p.y - pts[j]!.y) > 0.5) continue;
    const half = b.height / 2;
    const dy = Math.min(half, Math.abs(p.y - (b.y + half)));
    if (Math.abs(p.x - b.x) < 0.5) p.x = b.x + (DECISION_TIP * dy) / half;
    else if (Math.abs(p.x - b.x - b.width) < 0.5) p.x = b.x + b.width - (DECISION_TIP * dy) / half;
  }
  return pts;
}

/** A badge: the target's icon and name on a soft tile in the colour of the edge style. */
function drawChip(ch: Chip, x: number, y: number, w: number, theme: Theme): string {
  const t = theme.tones[ch.tone ?? 'slate'];
  const h = CHIP.height;
  const ix = ch.icon && icon(ch.icon) ? CHIP.icon + CHIP.iconGap : 0;
  let s = chipBack(theme, x, y, w, h, t);
  if (ix) s += drawIcon(ch.icon, x + CHIP.padX, y + (h - CHIP.icon) / 2, CHIP.icon, t.fg, 1.6);
  const label = fitText(ch.label, chipText(theme), 500, w - 2 * CHIP.padX - ix);
  return s + textMid(x + CHIP.padX + ix, y + h / 2, label, chipText(theme), 500, t.fg);
}

function drawTable(shape: TableShape, b: Box, theme: Theme, id: string, img?: string): string {
  const t = theme.space.table;
  const tone = theme.tones[shape.tone];
  const head = tableHeader(shape, theme);
  const rad = theme.radius.card;
  const lk = look(theme);
  let s = `<rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.width)}" height="${r1(b.height)}" rx="${rad}" fill="${theme.surface}" stroke="${theme.border}" stroke-width="${theme.stroke.card}"${shadowAttr(theme, `${id}-shadow`)}/>`;
  // Header with only the top corners rounded, inset by the border: in the tone, in paper, or left plain.
  const headFill = lk.tableHead === 'tone' ? tone.bg : lk.tableHead === 'paper' ? (paperTint(theme, 1) ?? tone.bg) : undefined;
  const rule = lk.tableHead === 'paper' ? (groupLine(theme, tone) ?? theme.border) : theme.border;
  const x0 = b.x + 0.5;
  const x1 = b.x + b.width - 0.5;
  const y0 = b.y + 0.5;
  const yh = b.y + head;
  const r = Math.max(0, rad - 0.5);
  if (headFill) s += `<path d="M${r1(x0)} ${r1(yh)}V${r1(y0 + r)}A${r} ${r} 0 0 1 ${r1(x0 + r)} ${r1(y0)}H${r1(x1 - r)}A${r} ${r} 0 0 1 ${r1(x1)} ${r1(y0 + r)}V${r1(yh)}Z" fill="${headFill}"/>`;
  s += `<line x1="${r1(b.x)}" y1="${r1(yh)}" x2="${r1(b.x + b.width)}" y2="${r1(yh)}" stroke="${rule}" stroke-width="1"/>`;
  const titleY = shape.caption ? b.y + head / 2 - 7 : b.y + head / 2;
  s += img ? image(img, b.x + t.padX - 1, titleY - 9, 18, 18) : drawIcon(shape.icon, b.x + t.padX, titleY - 8, 16, tone.fg, 1.75);
  s += textMid(b.x + t.padX + 24, titleY, fitText(shape.title, theme.size.label, 600, b.width - 2 * t.padX - 24), theme.size.label, 600, theme.text, undefined, shape.italic ? slant(titleY + baselineOffset(theme.size.label)) : '');
  // A table as wide as its caption was rounded to whole pixels: half a pixel short is not a reason to cut it.
  if (shape.caption)
    s += textMid(b.x + t.padX, titleY + 17, fitText(shape.caption, theme.size.caption, 400, b.width - 2 * t.padX + 1), theme.size.caption, 400, theme.textMuted);

  const grid = tableGrid(shape, theme);
  // A second column of rows (a contract's guarantees beside its schema) stands behind a rule.
  for (const c of grid.columns.slice(1)) s += `<line x1="${r1(b.x + c.x)}" y1="${r1(yh)}" x2="${r1(b.x + c.x)}" y2="${r1(b.y + b.height)}" stroke="${theme.border}" stroke-width="1"/>`;
  for (const [i, row] of shape.rows.entries()) {
    const at = grid.rows[i]!;
    const col = grid.columns[at.column]!;
    const marks = col.marks;
    // The last column reaches the table's right edge (a table may be drawn wider than measured).
    const cx = b.x + col.x;
    const cw = at.column === grid.columns.length - 1 ? b.width - col.x : col.width;
    const y = b.y + at.y;
    if (row.kind === 'section') {
      const sh = at.height;
      if (row.label) s += textMid(cx + t.padX, y + sh / 2 + 2, row.label.toUpperCase(), SECTION_PX, 600, theme.textFaint);
      else s += `<line x1="${r1(cx)}" y1="${r1(y + sh / 2)}" x2="${r1(cx + cw)}" y2="${r1(y + sh / 2)}" stroke="${theme.border}" stroke-width="1"/>`;
      continue;
    }
    const cy = y + at.height / 2;
    if (i > 0 && shape.rows[i - 1]?.kind === 'row' && grid.rows[i - 1]!.column === at.column && shape.form !== 'class')
      s += `<line x1="${r1(cx + t.padX)}" y1="${r1(y)}" x2="${r1(cx + cw - t.padX)}" y2="${r1(y)}" stroke="${theme.border}" stroke-opacity="0.6" stroke-width="1"/>`;
    for (const [k, m] of rowMarks(row).entries()) s += drawIcon(m.icon, cx + t.padX + k * 15, cy - 6.5, 13, theme.tones[m.tone].fg, 1.75);
    if (row.sign) s += textMid(cx + t.padX, cy, row.sign, monoCell(theme), 500, theme.textMuted, undefined, monoAttr(theme), 'mono');
    const [name, type] = row.cells;
    const style = (c: { italic?: boolean; underline?: boolean }) => (c.italic ? slant(cy + baselineOffset(theme.size.cell)) : '') + (c.underline ? ' text-decoration="underline"' : '');
    if (name) s += textMid(cx + t.padX + marks, cy, name.text, theme.size.cell, name.strong ? 600 : 400, theme.text, undefined, style(name));
    if (type?.text)
      s += lk.mono.type
        ? textMid(cx + cw - t.padX, cy, type.text, monoCell(theme), 400, theme.textMuted, 'end', monoAttr(theme), 'mono')
        : textMid(cx + cw - t.padX, cy, type.text, theme.size.cell, 400, theme.textMuted, 'end');
  }
  return s;
}

function edgeColor(e: GraphEdge, theme: Theme): string {
  return e.tone ? theme.tones[e.tone].fg : theme.edge;
}

function drawEdge(e: GraphEdge, points: Point[], theme: Theme): string {
  const color = edgeColor(e, theme);
  const pts = points.map((p) => ({ ...p }));
  // Pull the line back where an arrowhead sits, so it does not poke through the tip.
  const back = arrowBack(theme);
  if (back && e.end === 'arrow') shorten(pts, pts.length - 1, pts.length - 2, back);
  if (back && e.start === 'arrow') shorten(pts, 0, 1, back);
  const opacity = e.tone ? ' stroke-opacity="0.9"' : '';
  const width = patternWidth(e.pattern, theme.stroke.edge * (e.width ?? 1));
  const dash = dashAttr(e.line, width, theme);
  // Square and cut corners are drawn with square joins; a dotted line keeps round dots.
  const round = look(theme).line.corner === 'round';
  const ends = `stroke-linecap="${round || e.line === 'dotted' ? 'round' : 'butt'}" stroke-linejoin="${round ? 'round' : 'miter'}"`;
  const d = themedPath(pts, theme);
  let s = `<path d="${d}" fill="none" stroke="${color}" stroke-width="${r1(width)}" ${ends}${dash}${opacity}/>`;
  s += patternOver(e.pattern, d, color, width, theme, dash);
  s += marker(e.end, points[points.length - 1]!, points[points.length - 2]!, color, theme);
  s += marker(e.start, points[0]!, points[1]!, color, theme);
  return s;
}

/**
 * Whether a split in a line gets a junction dot: not the branches of a mind map, nor a UML hierarchy,
 * whose trunks read as one line by convention (one triangle for all the children).
 */
export const joinDot = (e: GraphEdge) => e.kind !== 'branch' && e.kind !== 'generalization' && e.kind !== 'realization';

const COUNTED = new Set<Marker>(['one', 'zeroOrOne', 'many', 'oneOrMany', 'zeroOrMany']);

/**
 * A dot where a shared trunk splits: lines drawn alike that start (or end) at the same point and
 * run on top of each other, then part. Without it a branch looks like a line that just bends.
 */
function junctions(graph: Graph, placed: Placed, theme: Theme): string {
  const dots = new Map<string, string>();
  const edges = graph.edges.filter((e) => (placed.edges.get(e.id)?.points.length ?? 0) > 1);
  for (const [i, a] of edges.entries())
    for (const b of edges.slice(i + 1)) {
      if (a.line !== b.line || a.tone !== b.tone || !joinDot(a) || !joinDot(b)) continue;
      const pa = placed.edges.get(a.id)!.points;
      const pb = placed.edges.get(b.id)!.points;
      // Lines into one key row of a table come in as one with no dot: a ring there would read as one more end mark.
      if (a.to.node === b.to.node && a.to.row && COUNTED.has(a.end)) continue;
      const at = a.from.node === b.from.node ? split(pa, pb) : a.to.node === b.to.node ? split([...pa].reverse(), [...pb].reverse()) : undefined;
      if (at) dots.set(`${r1(at.x)},${r1(at.y)}`, junctionMark(at, edgeColor(a, theme), theme));
    }
  return [...dots.values()].join('');
}

/** Where two lines from the same start stop running on top of each other (undefined if they never shared). */
export function split(a: Point[], b: Point[]): Point | undefined {
  const same = (p: Point, q: Point) => Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5;
  if (!same(a[0]!, b[0]!)) return undefined;
  let at = a[0]!;
  let i = 1;
  let j = 1;
  while (i < a.length && j < b.length) {
    const da = [Math.sign(a[i]!.x - at.x), Math.sign(a[i]!.y - at.y)];
    const db = [Math.sign(b[j]!.x - at.x), Math.sign(b[j]!.y - at.y)];
    if (da[0] !== db[0] || da[1] !== db[1]) break;
    const la = Math.abs(a[i]!.x - at.x) + Math.abs(a[i]!.y - at.y);
    const lb = Math.abs(b[j]!.x - at.x) + Math.abs(b[j]!.y - at.y);
    if (Math.abs(la - lb) < 0.5) (at = a[i]!), i++, j++;
    else if (la < lb) (at = a[i]!), i++;
    else (at = b[j]!), j++;
  }
  // One line ends on the other (no split), or they part right at the start.
  if (i >= a.length || j >= b.length) return undefined;
  return Math.abs(at.x - a[0]!.x) + Math.abs(at.y - a[0]!.y) >= 8 ? at : undefined;
}

function shorten(pts: Point[], end: number, prev: number, by: number) {
  const a = pts[end]!;
  const b = pts[prev]!;
  const len = Math.hypot(a.x - b.x, a.y - b.y);
  if (len <= by) return;
  a.x -= ((a.x - b.x) / len) * by;
  a.y -= ((a.y - b.y) / len) * by;
}

/** Orthogonal polyline with rounded corners. */
export const roundedPath = (pts: Point[], radius: number): string => linePath(pts, radius, 'round');

/** A label lying over the arrowhead is slid back along its line until the head shows. */
function offHead(points: Point[], b: Box): Box {
  const q = points.at(-1);
  const p = points.at(-2);
  if (!p || !q) return b;
  // The head is 9 to 12 px long; the rest is air.
  const room = 20;
  const upright = Math.abs(p.x - q.x) < 0.5;
  if (!upright && Math.abs(p.y - q.y) >= 0.5) return b;
  const [lo, size, end, from] = upright ? [b.y, b.height, q.y, p.y] : [b.x, b.width, q.x, p.x];
  const across = upright ? b.x < q.x && q.x < b.x + b.width : b.y < q.y && q.y < b.y + b.height;
  const dir = Math.sign(end - from);
  const gap = dir > 0 ? end - (lo + size) : lo - end;
  if (!across || gap >= room || gap <= -size || Math.abs(end - from) < size + room + 4) return b;
  const by = -dir * (room - gap);
  return upright ? { ...b, y: b.y + by } : { ...b, x: b.x + by };
}
/**
 * A label on a line that is hardly longer than the label would hide the line, its colour and its
 * dashes: move it just beside the piece it sits on (above a level one, right of an upright one).
 */
export function besideShortLine(points: Point[], at: Box, placed?: Placed): Box {
  const b = offHead(points, at);
  const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  let total = 0;
  let under: [Point, Point] | undefined;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1]!;
    const q = points[i]!;
    total += Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
    const level = Math.abs(p.y - q.y) < 0.5;
    if (!under && (level ? Math.abs(p.y - c.y) < 2 && c.x >= Math.min(p.x, q.x) && c.x <= Math.max(p.x, q.x) : Math.abs(p.x - c.x) < 2 && c.y >= Math.min(p.y, q.y) && c.y <= Math.max(p.y, q.y)))
      under = [p, q];
  }
  if (!under) return b;
  const [p, q] = under;
  const level = Math.abs(p.y - q.y) < 0.5;
  const hidden = Math.min(level ? Math.abs(q.x - p.x) : Math.abs(q.y - p.y), level ? b.width : 20);
  if (total - hidden >= 40) return b;
  // The other side when the first lies on another line: a label without a pill would break that line.
  const sides = level ? [{ ...b, y: p.y - b.height / 2 - 14 }, { ...b, y: p.y - b.height / 2 + 14 }] : [{ ...b, x: p.x + 5 }, { ...b, x: p.x - 5 - b.width }];
  if (!placed) return sides[0]!;
  const hit = (m: Box, n: Box) => m.x < n.x + n.width && n.x < m.x + m.width && m.y < n.y + n.height && n.y < m.y + m.height;
  const onCard = (m: Box) => [...placed.nodes.values()].some((n) => hit(m, n));
  const others: Box[] = [];
  for (const e of placed.edges.values()) {
    if (e.points === points) continue;
    for (let i = 1; i < e.points.length; i++) {
      const u = e.points[i - 1]!;
      const v = e.points[i]!;
      others.push({ x: Math.min(u.x, v.x) - 1, y: Math.min(u.y, v.y) - 1, width: Math.abs(v.x - u.x) + 2, height: Math.abs(v.y - u.y) + 2 });
    }
    if (e.label) others.push(e.label);
  }
  const free = sides.filter((m) => !onCard(m));
  // Never onto a card: covering a short line is the lesser evil.
  return free.find((m) => !others.some((o) => hit(m, o))) ?? free[0] ?? b;
}

function drawEnds(e: GraphEdge, pts: Point[], theme: Theme, taken: Box[], lines: Box[]): string {
  let s = '';
  for (const [tags, tip, from, marker] of [[e.ends?.from, pts[0]!, pts[1]!, e.start], [e.ends?.to, pts.at(-1)!, pts.at(-2)!, e.end]] as const) {
    if (!tags?.length) continue;
    const at = endTagAt(tags, tip, from, taken, marker, lines);
    if (at) s += drawTags(theme, tags, at.x, at.cy, endStyle);
  }
  return s;
}

function drawEdgeLabel(label: string, b: Box, theme: Theme, ground: string, lineColor: string, step?: number, iconName?: string, tone?: GraphEdge['tone'], marks?: string[]): string {
  const h = 20;
  const y = b.y + (b.height - h) / 2;
  const n = step ? stepMark(b.x + 10, y + h / 2, step, theme) : '';
  // Tags end the label, after its text; a line without a label shows only them.
  const tagW = marks?.length ? tagsWidth(marks) : 0;
  const tags = tagW ? drawTags(theme, marks!, b.x + b.width - tagW, y + h / 2) : '';
  if (tagW) b = { ...b, width: b.width - tagW - TAG.GAP };
  if (!label) return n + tags;
  const lk = look(theme).edgeLabel;
  const room = step ? STEP_ROOM : 0;
  // An icon (a tunnel's lock) leads the text, in the line's colour; the text stays centred in what is left.
  const ix = iconName && icon(iconName) ? LABEL_ICON : 0;
  const glyph = ix ? drawIcon(iconName, b.x + room + labelPad(theme) / 2, y + h / 2 - 5.5, 11, tone ? theme.tones[tone].fg : theme.textMuted, 1.8) : '';
  // A [technology] is quieter than what the line does.
  const shown = esc(labelString(theme, label));
  const body = /^\[[^\]]*\]$/.test(label) ? shown : shown.replace(/\[[^\]]*\]/g, (t) => `<tspan fill="${theme.textFaint}" font-weight="400">${t}</tspan>`);
  const cx = b.x + room + ix + (b.width - room - ix) / 2;
  return (
    labelBack(theme, { x: b.x, y, width: b.width, height: h }, ground) +
    n +
    glyph +
    `<text x="${r1(cx)}" y="${r1(y + h / 2 + baselineOffset(theme.size.edgeLabel, lk.mono ? 'mono' : 'sans'))}" font-size="${theme.size.edgeLabel}" font-weight="500" fill="${labelInk(theme, lineColor)}" text-anchor="middle"${labelAttrs(theme)}>${body}</text>` +
    tags
  );
}

/** A step number: the same on the line and in the step list. */
const stepMark = (cx: number, cy: number, n: number, theme: Theme) => numberMark(theme, cx, cy, n);

const STEP_ROW = 24;

/** The steps of a dynamic view as a numbered list under the drawing: who does what, in order. */
function stepList(graph: Graph, theme: Theme) {
  const steps = graph.steps ?? [];
  if (!steps.length) return { width: 0, height: 0, draw: () => '' };
  const names = new Map<string, string>([...graph.groups.map((g) => [g.id, g.label] as const), ...graph.nodes.map((n) => [n.id, n.shape.kind === 'card' || n.shape.kind === 'block' ? n.shape.label : n.shape.kind === 'table' ? n.shape.title : n.id] as const)]);
  const rows = steps.map((s) => ({ n: s.n, who: `${names.get(s.from) ?? s.from} → ${names.get(s.to) ?? s.to}`, what: s.label ?? '' }));
  const whoW = Math.max(...rows.map((r) => measureText(r.who, theme.size.caption, 600)));
  const width = 28 + whoW + 16 + Math.max(...rows.map((r) => measureText(r.what, theme.size.caption, 400)));
  const draw = (x: number, y0: number) => {
    let s = '';
    for (const [i, r] of rows.entries()) {
      const cy = y0 + 40 + i * STEP_ROW;
      s += stepMark(x + 9, cy, r.n, theme);
      s += textMid(x + 28, cy, r.who, theme.size.caption, 600, theme.text);
      s += textMid(x + 28 + whoW + 16, cy, r.what, theme.size.caption, 400, theme.textMuted);
    }
    return s;
  };
  return { width, height: 28 + rows.length * STEP_ROW, draw };
}

function titleWidth(g: Graph, theme: Theme): number {
  const t = look(theme).title;
  const title = g.title ? measureText(t.caps ? g.title.toUpperCase() : g.title, t.size, t.weight, t.mono ? 'mono' : 'sans', t.tracking) : 0;
  return Math.max(title, g.subtitle ? measureText(g.subtitle, theme.size.subtitle, 400) : 0);
}
