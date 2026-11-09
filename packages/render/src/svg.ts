// Draws a placed graph as a standalone SVG. Attributes only (no CSS classes), so browsers,
// resvg and slide tools all render it the same.
import { chips, linkHref, type Box, type Link, type CardShape, type Chip, type Graph, type GraphEdge, type GraphGroup, type LegendItem, type Marker, type Placed, type Point, type TableShape } from '@cartography/core';
import { baselineOffset, embeddedFonts, fitText, measureText, type Theme, type ToneColors } from '@cartography/theme';
import { icon } from '@cartography/icons';
import { BODY, bodyLines, cardCaption, cardInsets, CHIP, chipRows, DECISION_TIP, groupLabelWidth, LABEL_ICON, LINK_ROOM, markWidth, rowMarks, STACK, STEP_ROOM, tableHeader } from './size.ts';
import { drawMatrix } from './matrix.ts';
import { drawSequence } from './sequence.ts';
import { drawGitflow } from './gitflow.ts';
import { drawRoadmap } from './roadmap.ts';
import { drawJourney } from './journey.ts';
import { captionBlock, drawNote, noteMargins, placeNotes, quietTheme, strongTheme, type StepView } from './steps.ts';

export interface SvgOptions {
  /** Embed the Inter font (latin subset) so the SVG looks the same everywhere. */
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

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n: number) => Math.round(n * 10) / 10;

export function drawSvg(graph: Graph, placed: Placed, theme: Theme, opts: SvgOptions = {}): SvgResult {
  const pad = theme.space.pad;
  const id = opts.idPrefix ?? 'carto';
  const block = theme.titleBlock && Object.keys(theme.titleBlock).length ? theme.titleBlock : undefined;
  const brand = block ? brandHeader(graph, theme, block) : undefined;
  const header = brand ? brand.height : graph.title ? (graph.subtitle ? 64 : 44) : 0;
  const where = graph.legend?.length ? (theme.legend ?? 'bottom') : 'none';
  const legend = where === 'bottom' || where === 'top' ? 40 : 0;
  const side = where === 'right' ? 40 + legendColumnWidth(graph, theme) : 0;
  const footer = block?.footer || block?.classification ? 44 : 0;
  // One step of a presentation: its caption says what the numbered list would, and callouts get room that is the same at every step.
  const view = opts.stepView?.states[opts.stepView.index] ? opts.stepView : undefined;
  const state = view?.states[view.index];
  const quiet = state ? quietTheme(theme) : theme;
  const themeOf = (e: string | undefined) => (e === 'dim' ? quiet : theme);
  const room = view ? noteMargins(view, placed) : { left: 0, top: 0, right: 0, bottom: 0 };
  const list = view ? { width: 0, height: 0, draw: () => '' } : stepList(graph, theme);
  const width = Math.ceil(Math.max(placed.width + room.left + room.right + side, brand ? brand.width : titleWidth(graph, theme), legend ? legendWidth(graph, theme) : 0, list.width) + 2 * pad);
  const caption = view && view.caption !== false ? captionBlock(view, theme, width - 2 * pad) : undefined;
  const height = Math.ceil(Math.max(placed.height + room.top + room.bottom + list.height + (caption?.height ?? 0), side ? legendColumnHeight(graph) : 0) + header + legend + footer + 2 * pad);
  const origin = { x: pad + room.left, y: pad + header + (where === 'top' ? legend : 0) + room.top };
  const data = (kind: string, key: string) => (opts.interactive || opts.marks ? ` data-${kind}="${esc(key)}"` : '');
  const nodeImages = opts.images?.nodes;
  const groupImages = opts.images?.groups;

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${esc(theme.font.family)}" text-rendering="geometricPrecision">`,
  );
  out.push('<defs>');
  if (opts.fonts !== 'none') out.push(`<style>${fontFaces(theme)}</style>`);
  out.push(
    `<filter id="${id}-shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="${theme.shadow.color}" flood-opacity="${theme.shadow.opacity * 1.2}"/><feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="${theme.shadow.color}" flood-opacity="${theme.shadow.opacity}"/></filter>`,
  );
  out.push('</defs>');
  out.push(`<rect width="${width}" height="${height}" fill="${theme.canvas}"/>`);

  if (brand) out.push(brand.draw(pad, width));
  else if (graph.title) {
    out.push(text(pad, pad + 16, graph.title, theme.size.title, 600, theme.text));
    if (graph.subtitle) out.push(text(pad, pad + 40, graph.subtitle, theme.size.subtitle, 400, theme.textMuted));
  }
  if (where === 'top') out.push(drawLegend(graph, theme, pad, pad + header + 6));

  out.push(`<g transform="translate(${origin.x} ${origin.y})">`);
  const filled = new Set([...graph.nodes.map((n) => n.parent), ...graph.groups.map((g) => g.parent)].filter(Boolean));
  for (const g of byDepth(graph.groups)) {
    const box = placed.groups.get(g.id);
    if (!box || state?.groups[g.id] === 'hidden') continue;
    const theme = themeOf(state?.groups[g.id]);
    // In the editor an empty group says what it is for; exports stay clean.
    const hint = opts.interactive && opts.hints !== false && !filled.has(g.id) ? textMid(box.x + box.width / 2, box.y + (box.height + theme.space.group.header) / 2, 'Drop shapes here', theme.size.caption, 500, theme.textFaint, 'middle') : '';
    const mark = g.links?.length ? linkMark(box.x + box.width - 16 - 12, box.y + 22 - 6, theme) : '';
    out.push(linked(g.links, `<g${data('group', g.id)}>${tip(g.description)}${drawGroup(g, box, theme, !!mark, groupImages?.get(g.id))}${hint}${mark}</g>`, opts));
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
    const halo = em === 'focus' ? `<path d="${roundedPath(pts, theme.radius.corner)}" fill="none" stroke="${e.tone ? theme.tones[e.tone].fg : (theme.accent ?? theme.tones.blue.fg)}" stroke-opacity="0.22" stroke-width="${r1(theme.stroke.edge * 1.8 + 8)}" stroke-linecap="round" stroke-linejoin="round"/>` : '';
    out.push(`<g${data('edge', e.id)}>${halo}${drawEdge(e, pts, em === 'focus' ? strongTheme(theme) : themeOf(em))}</g>`);
  }
  if (state) {
    out.push(junctions({ ...graph, edges: graph.edges.filter((e) => state.edges[e.id] === 'dim') }, placed, quiet));
    out.push(junctions({ ...graph, edges: graph.edges.filter((e) => !state.edges[e.id] || state.edges[e.id] === 'focus') }, placed, theme));
  } else out.push(junctions(graph, placed, theme));
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
      : shape.kind === 'sequence' ? drawSequence(shape, box, theme, `${id}-shadow`, state?.message ? { message: state.message, quiet } : undefined)
      : shape.kind === 'gitflow' ? drawGitflow(shape, box, theme, `${id}-shadow`)
      : shape.kind === 'roadmap' ? drawRoadmap(shape, box, theme)
      : shape.kind === 'journey' ? drawJourney(shape, box, theme, `${id}-shadow`, state?.journey)
      // Drawn by the journey itself: this is where a click on a step lands.
      : shape.kind === 'journey-part' ? `<rect x="${r1(box.x)}" y="${r1(box.y)}" width="${r1(box.width)}" height="${r1(box.height)}" rx="10" fill="transparent"/>`
      : drawMatrix(shape, box, theme, `${id}-shadow`);
    // What stands back lies flat: no shadow, and an official icon fades with it.
    const body = dim ? drawn.replaceAll(` filter="url(#${id}-shadow)"`, '').replaceAll('<image ', '<image opacity="0.35" ') : drawn;
    const mark = link && shape.kind !== 'matrix' ? linkMark(box.x + box.width - 12 - 9, box.y + 8, theme) : '';
    out.push(linked(n.links, `<g${data('node', n.id)}>${tip(n.description)}${body}${mark}</g>`, opts));
  }
  // Labels last, so lines never cross them.
  for (const e of graph.edges) {
    const em = state?.edges[e.id];
    if (badged.has(e.id) || em === 'hidden') continue;
    const pe = placed.edges.get(e.id);
    if ((e.label || e.step) && pe?.label) out.push(drawEdgeLabel(e.label ?? '', besideShortLine(pe.points, pe.label, placed), em === 'focus' ? strongTheme(theme) : themeOf(em), e.step, e.icon, e.tone));
  }
  if (state) for (const n of placeNotes(state, placed)) out.push(drawNote(n, theme));
  out.push('</g>');
  if (list.height) out.push(list.draw(origin.x, origin.y + placed.height));
  // The caption closes the drawing: under the legend, above the footer.
  const said = caption?.height ?? 0;
  if (caption) out.push(caption.draw(pad, height - pad - footer - said));

  if (where === 'bottom') out.push(drawLegend(graph, theme, pad, height - pad - footer - said - 14));
  if (where === 'right') out.push(drawLegendColumn(graph, theme, origin.x + placed.width + room.right + 40, origin.y));
  if (footer) out.push(drawFooter(block!, theme, pad, width, height - pad));
  out.push('</svg>');
  return { svg: out.join(''), width, height, origin };
}

/** A subtle link icon: this element leads somewhere (a URL, its detailed diagram). */
function linkMark(x: number, y: number, theme: Theme): string {
  return drawIcon('link', x, y, 12, theme.textFaint, 1.6);
}

const tip = (description?: string) => (description ? `<title>${esc(description)}</title>` : '');

/** Exports carry real links (diagrams point at the SVG next to them); in the editor a click selects. */
function linked(links: Link[] | undefined, body: string, opts: SvgOptions): string {
  const first = links?.[0];
  const href = first && !opts.interactive ? linkHref(first, opts.file) : undefined;
  return href ? `<a href="${esc(href)}"${first!.kind === 'url' ? ' target="_blank"' : ''}>${body}</a>` : body;
}

function fontFaces(theme: Theme): string {
  const inter = Object.entries(embeddedFonts)
    .map(([w, b64]) => `@font-face{font-family:Inter;font-style:normal;font-weight:${w};src:url(data:font/woff2;base64,${b64}) format('woff2')}`)
    .join('');
  // A brand font comes first; Inter stays as the fallback for glyphs the brand font lacks.
  const mime = { woff2: 'font/woff2', woff: 'font/woff', truetype: 'font/ttf', opentype: 'font/otf' };
  const brand = (theme.font.faces ?? [])
    .map((f) => `@font-face{font-family:'${f.family.replace(/'/g, '')}';font-style:${f.style};font-weight:${f.weight};src:url(data:${mime[f.format]};base64,${f.data}) format('${f.format}')}`)
    .join('');
  return brand + inter;
}

/** An image from a BYO pack or a logo, scaled into the box without stretching. */
function image(href: string, x: number, y: number, w: number, h: number): string {
  return `<image href="${href}" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" preserveAspectRatio="xMidYMid meet"/>`;
}

/** Behind official icons: a neutral tile, never the tone, because their colours are the vendor's. */
const neutralTile = (theme: Theme) => (theme.mode === 'dark' ? '#E9ECF1' : '#F3F5F8');

/** Header of a brand title block: logo, title and subtitle on the left, client and version on the right, a rule below. */
function brandHeader(graph: Graph, theme: Theme, block: NonNullable<Theme['titleBlock']>) {
  const LOGO = 32;
  const logo = block.logo;
  const logoW = logo ? Math.min(180, (LOGO * logo.width) / Math.max(1, logo.height)) : 0;
  const titleX = logoW ? logoW + 16 : 0;
  const meta = [block.project, block.version, block.date].filter(Boolean).join('  ·  ');
  const rightW = Math.max(block.client ? measureText(block.client, theme.size.subtitle, 600) : 0, meta ? measureText(meta, theme.size.caption, 400) : 0);
  const content = Math.max(logo ? LOGO : 0, graph.subtitle ? 44 : graph.title ? 24 : 0, meta && block.client ? 36 : 18);
  const height = content + 40;
  const width = titleX + titleWidth(graph, theme) + (rightW ? rightW + 48 : 0);
  const draw = (pad: number, total: number) => {
    let s = '';
    const top = pad;
    if (logo) s += image(logo.href, pad, top + (content - LOGO) / 2, logoW, LOGO);
    const tx = pad + titleX;
    // Title and subtitle centred as a pair on the logo.
    const ty = graph.subtitle ? top + content / 2 - 6 : top + content / 2 + baselineOffset(theme.size.title);
    if (graph.title) s += text(tx, ty, graph.title, theme.size.title, 600, theme.text);
    if (graph.subtitle) s += text(tx, ty + 22, graph.subtitle, theme.size.subtitle, 400, theme.textMuted);
    const rx = total - pad;
    if (block.client && meta) {
      s += text(rx, top + content / 2 - 4, block.client, theme.size.subtitle, 600, theme.text, 'end');
      s += text(rx, top + content / 2 + 14, meta, theme.size.caption, 400, theme.textMuted, 'end');
    } else if (block.client || meta)
      s += textMid(rx, top + content / 2, block.client ?? meta, block.client ? theme.size.subtitle : theme.size.caption, block.client ? 600 : 400, block.client ? theme.text : theme.textMuted, 'end');
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

function text(x: number, y: number, s: string, size: number, weight: number, fill: string, anchor?: 'end' | 'middle'): string {
  const a = anchor ? ` text-anchor="${anchor}"` : '';
  return `<text x="${r1(x)}" y="${r1(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}"${a}>${esc(s)}</text>`;
}

/** Text vertically centred on cy. */
function textMid(x: number, cy: number, s: string, size: number, weight: number, fill: string, anchor?: 'end' | 'middle') {
  return text(x, cy + baselineOffset(size), s, size, weight, fill, anchor);
}

function drawIcon(name: string | undefined, x: number, y: number, size: number, color: string, stroke: number): string {
  const markup = name ? icon(name) : undefined;
  if (!markup) return '';
  const s = size / 24;
  // Keep the visual stroke width constant whatever the icon size.
  return `<g transform="translate(${r1(x)} ${r1(y)}) scale(${s})" fill="none" stroke="${color}" stroke-width="${r1(stroke / s)}" stroke-linecap="round" stroke-linejoin="round">${markup}</g>`;
}

export function byDepth(groups: GraphGroup[]): GraphGroup[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const depth = (g: GraphGroup): number => (g.parent && byId.get(g.parent) ? 1 + depth(byId.get(g.parent)!) : 0);
  return [...groups].sort((a, b) => depth(a) - depth(b));
}

function drawGroup(g: GraphGroup, b: Box, theme: Theme, link = false, img?: string): string {
  const tone = theme.tones[g.tone];
  const dash = g.border === 'dashed' ? ' stroke-dasharray="5 4"' : '';
  const cy = b.y + 22;
  const x = b.x + 16;
  const labelW = measureText(g.label, theme.size.group, 600);
  const maxLabel = b.width - 56 - (link ? LINK_ROOM : 0);
  const label = fitText(g.label, theme.size.group, 600, maxLabel);
  let s = `<rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.width)}" height="${r1(b.height)}" rx="${theme.radius.group}" fill="${tone.wash}" stroke="${tone.line}" stroke-width="${theme.stroke.group}"${dash}/>`;
  s += img ? image(img, x - 1, cy - 9, 18, 18) : drawIcon(g.icon, x, cy - 8, 16, tone.fg, 1.75);
  s += textMid(x + 24, cy, label, theme.size.group, 600, theme.text);
  if (g.caption && groupLabelWidth(g.label, g.caption, theme) + 32 + (link ? LINK_ROOM + 12 : 0) <= b.width)
    s += textMid(x + 24 + labelW + 8, cy, g.caption, theme.size.caption, 400, theme.textFaint);
  return s;
}

function drawCard(shape: CardShape, b: Box, theme: Theme, id: string, badges: Chip[] = [], data: (edge: string) => string = () => '', link = false, img?: string): string {
  // A stacked pair: the second card peeks out below and to the right, the first is drawn as usual.
  let plate = '';
  if (shape.stack) {
    plate = `<rect x="${r1(b.x + STACK)}" y="${r1(b.y + STACK)}" width="${r1(b.width - STACK)}" height="${r1(b.height - STACK)}" rx="${theme.radius.card}" fill="${theme.surface}" stroke="${theme.textFaint}" stroke-opacity="0.45" stroke-width="${theme.stroke.card}" filter="url(#${id}-shadow)"/>`;
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
    : `fill="${theme.surface}" stroke="${theme.border}" stroke-width="${theme.stroke.card}" filter="url(#${id}-shadow)"`;
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
    s = `<path d="${roundedPolygon(pts, theme.radius.card - 4)}" fill="${theme.surface}" stroke="${tone.fg}" stroke-opacity="0.45" stroke-width="${theme.stroke.card + 0.2}" filter="url(#${id}-shadow)"/>`;
    // The tile turned on its point: a diamond, the flow-chart sign for a decision.
    const tcx = b.x + t + 23;
    const side = 26;
    s += `<rect x="${r1(tcx - side / 2)}" y="${r1(cy - side / 2)}" width="${side}" height="${side}" rx="6" fill="${tone.bg}" transform="rotate(45 ${r1(tcx)} ${r1(cy)})"/>`;
    s += drawIcon(shape.icon, tcx - 8, cy - 8, 16, tone.fg, theme.stroke.icon);
  } else {
    // A terminal is a pill, its tile a circle in the round end.
    const pill = shape.form === 'terminal';
    s = `<rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.width)}" height="${r1(b.height)}" rx="${pill ? r1(b.height / 2) : theme.radius.card}" ${frame}/>`;
    if (theme.cardBar && !pill) s += leftBar(b, theme.radius.card, tone.fg);
    const tileX = b.x + c.padX;
    const tileY = b.y + (top - c.tile) / 2;
    const rx = pill || shape.form === 'person' ? c.tile / 2 : theme.radius.tile;
    if (img && shape.form !== 'plain') {
      s += `<rect x="${r1(tileX)}" y="${r1(tileY)}" width="${c.tile}" height="${c.tile}" rx="${rx}" fill="${neutralTile(theme)}"/>`;
      s += image(img, tileX + 5, tileY + 5, c.tile - 10, c.tile - 10);
    } else if (shape.icon) {
      // Solid tiles carry the tone with a light icon; outline tiles print well; soft is the default tint.
      const style = theme.tile ?? 'soft';
      const fill = muted ? theme.surface : style === 'solid' ? tone.fg : style === 'outline' ? theme.surface : tone.bg;
      const stroke = style === 'outline' ? ` stroke="${tone.line}" stroke-width="1"` : '';
      const inset = style === 'outline' ? 0.5 : 0;
      s += `<rect x="${r1(tileX + inset)}" y="${r1(tileY + inset)}" width="${c.tile - 2 * inset}" height="${c.tile - 2 * inset}" rx="${rx}" fill="${fill}"${stroke}/>`;
      s += drawIcon(shape.icon, tileX + (c.tile - 18) / 2, tileY + (c.tile - 18) / 2, 18, style === 'solid' && !muted ? theme.surface : tone.fg, theme.stroke.icon);
    }
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
  let s = `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${h}" rx="${theme.radius.chip}" fill="${t.bg}"/>`;
  if (ix) s += drawIcon(ch.icon, x + CHIP.padX, y + (h - CHIP.icon) / 2, CHIP.icon, t.fg, 1.6);
  const label = fitText(ch.label, theme.size.edgeLabel, 500, w - 2 * CHIP.padX - ix);
  return s + textMid(x + CHIP.padX + ix, y + h / 2, label, theme.size.edgeLabel, 500, t.fg);
}

/** Legend sample of a badge: a small chip with an arrow, in the style's colour. */
function chipSwatch(x: number, cy: number, tone: ToneColors): string {
  return (
    `<rect x="${x}" y="${cy - 7}" width="20" height="14" rx="4" fill="${tone.bg}"/>` +
    `<path d="M${x + 6} ${cy}h8m-3-3l3 3-3 3" fill="none" stroke="${tone.fg}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

function drawTable(shape: TableShape, b: Box, theme: Theme, id: string, img?: string): string {
  const t = theme.space.table;
  const tone = theme.tones[shape.tone];
  const head = tableHeader(shape, theme);
  const rad = theme.radius.card;
  let s = `<rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.width)}" height="${r1(b.height)}" rx="${rad}" fill="${theme.surface}" stroke="${theme.border}" stroke-width="${theme.stroke.card}" filter="url(#${id}-shadow)"/>`;
  // Header with only the top corners rounded, inset by the border.
  const x0 = b.x + 0.5;
  const x1 = b.x + b.width - 0.5;
  const y0 = b.y + 0.5;
  const yh = b.y + head;
  const r = rad - 0.5;
  s += `<path d="M${r1(x0)} ${r1(yh)}V${r1(y0 + r)}A${r} ${r} 0 0 1 ${r1(x0 + r)} ${r1(y0)}H${r1(x1 - r)}A${r} ${r} 0 0 1 ${r1(x1)} ${r1(y0 + r)}V${r1(yh)}Z" fill="${tone.bg}"/>`;
  s += `<line x1="${r1(b.x)}" y1="${r1(yh)}" x2="${r1(b.x + b.width)}" y2="${r1(yh)}" stroke="${theme.border}" stroke-width="1"/>`;
  const titleY = shape.caption ? b.y + head / 2 - 7 : b.y + head / 2;
  s += img ? image(img, b.x + t.padX - 1, titleY - 9, 18, 18) : drawIcon(shape.icon, b.x + t.padX, titleY - 8, 16, tone.fg, 1.75);
  s += textMid(b.x + t.padX + 24, titleY, fitText(shape.title, theme.size.label, 600, b.width - 2 * t.padX - 24), theme.size.label, 600, theme.text);
  if (shape.caption)
    s += textMid(b.x + t.padX, titleY + 17, fitText(shape.caption, theme.size.caption, 400, b.width - 2 * t.padX), theme.size.caption, 400, theme.textMuted);

  let y = b.y + head;
  const marks = markWidth(shape);
  for (const [i, row] of shape.rows.entries()) {
    if (row.kind === 'section') {
      s += textMid(b.x + t.padX, y + t.section / 2 + 2, row.label.toUpperCase(), 10, 600, theme.textFaint);
      y += t.section;
      continue;
    }
    const cy = y + t.row / 2;
    if (i > 0 && shape.rows[i - 1]?.kind === 'row')
      s += `<line x1="${r1(b.x + t.padX)}" y1="${r1(y)}" x2="${r1(b.x + b.width - t.padX)}" y2="${r1(y)}" stroke="${theme.border}" stroke-opacity="0.6" stroke-width="1"/>`;
    for (const [k, m] of rowMarks(row).entries()) s += drawIcon(m.icon, b.x + t.padX + k * 15, cy - 6.5, 13, theme.tones[m.tone].fg, 1.75);
    const [name, type] = row.cells;
    if (name) s += textMid(b.x + t.padX + marks, cy, name.text, theme.size.cell, name.strong ? 600 : 400, theme.text);
    if (type?.text) s += textMid(b.x + b.width - t.padX, cy, type.text, theme.size.cell, 400, theme.textMuted, 'end');
    y += t.row;
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
  if (e.end === 'arrow') shorten(pts, pts.length - 1, pts.length - 2, 5);
  if (e.start === 'arrow') shorten(pts, 0, 1, 5);
  const dash = e.line === 'dashed' ? ' stroke-dasharray="6 4"' : e.line === 'dotted' ? ' stroke-dasharray="1.5 3.5"' : '';
  const opacity = e.tone ? ' stroke-opacity="0.9"' : '';
  const width = theme.stroke.edge * (e.width ?? 1);
  let s = `<path d="${roundedPath(pts, theme.radius.corner)}" fill="none" stroke="${color}" stroke-width="${r1(width)}" stroke-linecap="round" stroke-linejoin="round"${dash}${opacity}/>`;
  s += marker(e.end, points[points.length - 1]!, points[points.length - 2]!, color, theme);
  s += marker(e.start, points[0]!, points[1]!, color, theme);
  return s;
}

/**
 * A dot where a shared trunk splits: lines drawn alike that start (or end) at the same point and
 * run on top of each other, then part. Without it a branch looks like a line that just bends.
 */
function junctions(graph: Graph, placed: Placed, theme: Theme): string {
  const dots = new Map<string, string>();
  const edges = graph.edges.filter((e) => (placed.edges.get(e.id)?.points.length ?? 0) > 1);
  for (const [i, a] of edges.entries())
    for (const b of edges.slice(i + 1)) {
      if (a.line !== b.line || a.tone !== b.tone) continue;
      const pa = placed.edges.get(a.id)!.points;
      const pb = placed.edges.get(b.id)!.points;
      const at = a.from.node === b.from.node ? split(pa, pb) : a.to.node === b.to.node ? split([...pa].reverse(), [...pb].reverse()) : undefined;
      if (at) dots.set(`${r1(at.x)},${r1(at.y)}`, `<circle cx="${r1(at.x)}" cy="${r1(at.y)}" r="3" fill="${edgeColor(a, theme)}"/>`);
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
export function roundedPath(pts: Point[], radius: number): string {
  if (pts.length < 2) return '';
  let d = `M${r1(pts[0]!.x)} ${r1(pts[0]!.y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1]!;
    const c = pts[i]!;
    const n = pts[i + 1]!;
    const l1 = Math.hypot(c.x - p.x, c.y - p.y);
    const l2 = Math.hypot(n.x - c.x, n.y - c.y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    if (r < 0.5) {
      d += `L${r1(c.x)} ${r1(c.y)}`;
      continue;
    }
    const a = { x: c.x - ((c.x - p.x) / l1) * r, y: c.y - ((c.y - p.y) / l1) * r };
    const b = { x: c.x + ((n.x - c.x) / l2) * r, y: c.y + ((n.y - c.y) / l2) * r };
    d += `L${r1(a.x)} ${r1(a.y)}Q${r1(c.x)} ${r1(c.y)} ${r1(b.x)} ${r1(b.y)}`;
  }
  const last = pts[pts.length - 1]!;
  return d + `L${r1(last.x)} ${r1(last.y)}`;
}

/** Arrowheads and crow's-foot ends, drawn at `tip` pointing away from `from`. */
function marker(kind: Marker, tip: Point, from: Point, color: string, theme: Theme): string {
  if (kind === 'none') return '';
  const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const d = { x: (tip.x - from.x) / len, y: (tip.y - from.y) / len };
  const n = { x: -d.y, y: d.x };
  const at = (back: number, side = 0) => ({ x: tip.x - d.x * back + n.x * side, y: tip.y - d.y * back + n.y * side });
  const P = (p: Point) => `${r1(p.x)} ${r1(p.y)}`;
  const line = (a: Point, b: Point) =>
    `<path d="M${P(a)}L${P(b)}" stroke="${color}" stroke-width="${theme.stroke.edge}" stroke-linecap="round" fill="none"/>`;
  const bar = (back: number) => line(at(back, -6), at(back, 6));
  const circle = (back: number) => {
    const c = at(back);
    return `<circle cx="${r1(c.x)}" cy="${r1(c.y)}" r="4" fill="${theme.surface}" stroke="${color}" stroke-width="${theme.stroke.edge}"/>`;
  };
  const crow = () => line(at(12), at(0, -7)) + line(at(12), at(0, 7)) + line(at(12), at(0));

  switch (kind) {
    case 'arrow':
      return `<path d="M${P(at(9, -4.5))}L${P(tip)}L${P(at(9, 4.5))}Q${P(at(7))} ${P(at(9, -4.5))}Z" fill="${color}" stroke="${color}" stroke-width="1" stroke-linejoin="round"/>`;
    case 'one':
      return bar(8) + bar(13);
    case 'zeroOrOne':
      return bar(8) + circle(17);
    case 'many':
      return crow();
    case 'oneOrMany':
      return crow() + bar(16);
    case 'zeroOrMany':
      return crow() + circle(20);
  }
}

/**
 * A label on a line that is hardly longer than the label would hide the line, its colour and its
 * dashes: move it just beside the piece it sits on (above a level one, right of an upright one).
 */
export function besideShortLine(points: Point[], b: Box, placed?: Placed): Box {
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
  const moved = level ? { ...b, y: p.y - b.height / 2 - 14 } : { ...b, x: p.x + 5 };
  // Never onto a card: covering a short line is the lesser evil.
  const hit = (n: Box) => moved.x < n.x + n.width && n.x < moved.x + moved.width && moved.y < n.y + n.height && n.y < moved.y + moved.height;
  return placed && [...placed.nodes.values()].some(hit) ? b : moved;
}

function drawEdgeLabel(label: string, b: Box, theme: Theme, step?: number, iconName?: string, tone?: GraphEdge['tone']): string {
  const h = 20;
  const y = b.y + (b.height - h) / 2;
  const n = step ? stepMark(b.x + 10, y + h / 2, step, theme) : '';
  if (!label) return n;
  const room = step ? STEP_ROOM : 0;
  // An icon (a tunnel's lock) leads the text, in the line's colour; the text stays centred in what is left.
  const ix = iconName && icon(iconName) ? LABEL_ICON : 0;
  const glyph = ix ? drawIcon(iconName, b.x + room + 8, y + h / 2 - 5.5, 11, tone ? theme.tones[tone].fg : theme.textMuted, 1.8) : '';
  // A [technology] is quieter than what the line does.
  const body = /^\[[^\]]*\]$/.test(label) ? esc(label) : esc(label).replace(/\[[^\]]*\]/g, (t) => `<tspan fill="${theme.textFaint}" font-weight="400">${t}</tspan>`);
  const cx = b.x + room + ix + (b.width - room - ix) / 2;
  return (
    `<rect x="${r1(b.x)}" y="${r1(y)}" width="${r1(b.width)}" height="${h}" rx="${h / 2}" fill="${theme.surface}" stroke="${theme.border}" stroke-width="1"/>` +
    n +
    glyph +
    `<text x="${r1(cx)}" y="${r1(y + h / 2 + baselineOffset(theme.size.edgeLabel))}" font-size="${theme.size.edgeLabel}" font-weight="500" fill="${theme.textMuted}" text-anchor="middle">${body}</text>`
  );
}

/** A step number: a small filled circle, the same on the line and in the step list. */
function stepMark(cx: number, cy: number, n: number, theme: Theme): string {
  const r = 9;
  const fill = theme.accent ?? theme.tones.blue.fg;
  return `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r}" fill="${fill}"/>` + textMid(cx, cy, String(n), 10.5, 600, theme.surface, 'middle');
}

const STEP_ROW = 24;

/** The steps of a dynamic view as a numbered list under the drawing: who does what, in order. */
function stepList(graph: Graph, theme: Theme) {
  const steps = graph.steps ?? [];
  if (!steps.length) return { width: 0, height: 0, draw: () => '' };
  const names = new Map<string, string>([...graph.groups.map((g) => [g.id, g.label] as const), ...graph.nodes.map((n) => [n.id, n.shape.kind === 'card' ? n.shape.label : n.shape.kind === 'table' ? n.shape.title : n.id] as const)]);
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
  return Math.max(g.title ? measureText(g.title, theme.size.title, 600) : 0, g.subtitle ? measureText(g.subtitle, theme.size.subtitle, 400) : 0);
}

export function legendItems(g: Graph, theme: Theme) {
  let x = 0;
  return (g.legend ?? []).map((item) => {
    const at = x;
    x += 28 + measureText(item.label, theme.size.caption, 500) + 24;
    return { item, x: at, end: x - 24 };
  });
}

export function legendWidth(g: Graph, theme: Theme): number {
  return legendItems(g, theme).at(-1)?.end ?? 0;
}

function drawLegend(g: Graph, theme: Theme, x0: number, cy: number): string {
  return legendItems(g, theme)
    .map(({ item, x }) => legendItem(item, theme, x0 + x, cy))
    .join('');
}

const LEGEND_ROW = 26;

function legendColumnWidth(g: Graph, theme: Theme): number {
  return Math.max(0, ...(g.legend ?? []).map((item) => 28 + measureText(item.label, theme.size.caption, 500)));
}

const legendColumnHeight = (g: Graph) => (g.legend?.length ?? 0) * LEGEND_ROW + 32;

/** The legend as a column beside the drawing, under a small heading. */
function drawLegendColumn(g: Graph, theme: Theme, x: number, y: number): string {
  let s = `<text x="${r1(x)}" y="${r1(y + 10)}" font-size="10" font-weight="600" letter-spacing="0.8" fill="${theme.textFaint}">LEGEND</text>`;
  for (const [i, item] of (g.legend ?? []).entries()) s += legendItem(item, theme, x, y + 36 + i * LEGEND_ROW);
  return s;
}

/** One legend sample and its label, starting at x0. */
function legendItem(item: LegendItem, theme: Theme, x0: number, cy: number): string {
  const color = item.tone ? theme.tones[item.tone].fg : theme.edge;
  const label = textMid(x0 + 28, cy, item.label, theme.size.caption, 500, theme.textMuted);
  if (item.swatch === 'badge') return chipSwatch(x0, cy, theme.tones[item.tone ?? 'slate']) + label;
  if (item.swatch === 'tile') {
    // A small icon tile, as on the cards: what a kind of element looks like.
    const t = theme.tones[item.tone ?? 'slate'];
    const fill = item.muted ? theme.tones.slate.bg : t.bg;
    const edge = item.muted ? ` stroke="${theme.tones.slate.line}" stroke-width="1"` : '';
    return `<rect x="${x0 + 0.5}" y="${cy - 9.5}" width="19" height="19" rx="5.5" fill="${fill}"${edge}/>` + drawIcon(item.icon, x0 + 3.5, cy - 6.5, 13, t.fg, 1.6) + label;
  }
  if (item.swatch === 'boundary')
    return `<rect x="${x0 + 0.5}" y="${cy - 7.5}" width="19" height="15" rx="4" fill="none" stroke="${theme.textFaint}" stroke-width="1.2" stroke-dasharray="3 2.5"/>` + label;
  if (item.swatch === 'fill')
    return `<rect x="${x0}" y="${cy - 7}" width="20" height="14" rx="7" fill="${theme.tones[item.tone ?? 'blue'].bg}"/>` + label;
  if (item.swatch === 'check' || item.swatch === 'check-outline') {
    // The same filled or dashed check circle as the matrix cells.
    const t = theme.tones[item.tone ?? 'blue'];
    const cx = x0 + 10;
    const circle =
      item.swatch === 'check'
        ? `<circle cx="${cx}" cy="${cy}" r="8" fill="${t.fg}"/>`
        : `<circle cx="${cx}" cy="${cy}" r="7.5" fill="none" stroke="${t.fg}" stroke-width="1.2" stroke-dasharray="2.5 2"/>`;
    const tick = `<path d="M${cx - 3.5} ${cy}l2.4 2.4 4.6-4.8" fill="none" stroke="${item.swatch === 'check' ? theme.surface : t.fg}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
    return circle + tick + label;
  }
  if (item.swatch === 'outline')
    return `<rect x="${x0 + 0.5}" y="${cy - 6.5}" width="19" height="13" rx="6.5" fill="none" stroke="${color}" stroke-opacity="0.7" stroke-dasharray="3 2"/>` + label;
  const dash = item.line === 'dashed' ? ' stroke-dasharray="6 4"' : item.line === 'dotted' ? ' stroke-dasharray="1.5 3.5"' : '';
  return `<path d="M${x0} ${cy}H${x0 + 20}" stroke="${color}" stroke-width="${theme.stroke.edge * (item.width ?? 1) + 0.4}" stroke-linecap="round"${dash}/>` + label;
}
