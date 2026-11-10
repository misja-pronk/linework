// The whole pipeline in one call, shared by the CLI and the web app:
// YAML → validate → type.build → measure → layout → pins → SVG.
import {
  compose,
  filterGraph,
  focusGraph,
  focusReach,
  focusSchema,
  impliedSteps,
  modelKeys,
  modelProperties,
  modelSchema,
  parseSource,
  readFocus,
  resolveSteps,
  stepsSchema,
  unpackLayout,
  validate,
  viewPins,
  withBadgeIcons,
  withoutBadges,
  badgePairs,
  type Diagnostic,
  type DiagramType,
  type FocusSpec,
  type Graph,
  type LayoutMemory,
  type LegendItem,
  type LinePattern,
  type LayoutSidecar,
  type ModelContext,
  type Path,
  type Placed,
  type Source,
  type StepState,
} from '@cartography/core';
import { layout, type Tuning } from '@cartography/layout';
import { drawSvg, size, type SvgOptions } from '@cartography/render';
import { loadFonts, resolveTheme, themes, themeTextFonts, withTextFonts, type FontFace, type Theme } from '@cartography/theme';
import { resolveIcons, type IconMode, type IconPackFile } from './icons.ts';
import { vendors as iconVendors, type KindInfo } from '@cartography/icons';

const typesOfVendor = (vendor: string) => (iconVendors as Record<string, { types: string[] }>)[vendor]?.types ?? [];
import { c4, contextMap, systems } from '@cartography/systems';
import { azure } from '@cartography/azure';
import { cloud } from '@cartography/cloud';
import { kubernetes } from '@cartography/kubernetes';
import { network } from '@cartography/network';
import { erd } from '@cartography/erd';
import { access } from '@cartography/access';
import { github } from '@cartography/github';
import { dataProducts } from '@cartography/data-products';
import { sequence } from '@cartography/sequence';
import { gitflow } from '@cartography/gitflow';
import { roadmap } from '@cartography/roadmap';
import { journey } from '@cartography/journey';
import { process } from '@cartography/process';
import { states } from '@cartography/states';
import { matrix } from '@cartography/matrix';
import { capabilities } from '@cartography/capabilities';
import { teams } from '@cartography/teams';
import { classDiagram } from '@cartography/class';
import { mindmap } from '@cartography/mindmap';

// Systems first: the generic type people reach for, and what imports produce.
export const types: DiagramType[] = [systems, c4, network, azure, cloud, kubernetes, erd, access, github, dataProducts, sequence, gitflow, roadmap, journey, process, states, contextMap, matrix, capabilities, teams, classDiagram, mindmap];

/**
 * The kinds an icon pack is matched against: the type of the same name (azure, kubernetes), or for a
 * vendor pack (aws, gcp) the kinds that say they are that vendor's, then every type's general kinds.
 * Kinds of another vendor are left out: BigQuery has no AWS icon.
 */
export function iconKinds(pack: string): KindInfo[] {
  const own = types.find((t) => t.id === pack);
  const seen = new Map<string, KindInfo>();
  // With official names at hand the search words (category, vendor) would only add false matches.
  const add = (p: DiagramType['palette'][number]) => void (seen.has(p.kind) || seen.set(p.kind, { kind: p.kind, label: p.label, keywords: p.names ? undefined : p.keywords, names: p.names }));
  for (const t of types) for (const p of t.palette) if (p.provider === pack) add(p);
  for (const t of own ? [own] : types) for (const p of t.palette) if (!p.provider || p.provider === pack) add(p);
  return [...seen.values()];
}

/** The kinds a vendor's set is for, to count its coverage: the kinds of the types that use it, less those of other vendors. */
export function vendorKinds(vendor: string): KindInfo[] {
  const typeIds = typesOfVendor(vendor);
  const seen = new Map<string, KindInfo>();
  for (const t of types.filter((x) => typeIds.includes(x.id) || x.id === vendor))
    for (const p of t.palette) if ((!p.provider || p.provider === vendor) && !seen.has(p.kind)) seen.set(p.kind, { kind: p.kind, label: p.label });
  return [...seen.values()];
}

export function findType(id: unknown): DiagramType | undefined {
  return types.find((t) => t.id === id);
}

/** A type's schema with what every diagram takes on top of its own keys: `steps:` for presenting, `focus:` for a neighbourhood. Editors complete from this. */
export function schemaOf(type: DiagramType): Record<string, unknown> {
  const schema = type.schema as { properties?: Record<string, unknown> };
  const shared = { steps: stepsSchema, focus: focusSchema };
  return { ...schema, properties: { ...shared, ...schema.properties } };
}

export interface RenderOptions extends SvgOptions {
  /** Used when the diagram names no `theme:` of its own: light, dark, a built-in brand theme, or a Theme. */
  theme?: string | Theme;
  /** Wins over the diagram's `theme:` (a --theme flag, the editor's theme picker). */
  themeOverride?: string | Theme;
  /** Bytes of a file next to the diagram (brand fonts, PNG logos). Without it fonts are not embedded. */
  assets?: (file: string) => Uint8Array | undefined;
  /** Width of a brand font against Inter (see SCALE_SAMPLE), when the theme does not say. */
  fontScale?: (faces: FontFace[]) => number | undefined;
  /** BYO icons already read, kind → SVG markup (the editor's icon folder). */
  icons?: Record<string, string>;
  /** Icon packs to use besides the diagram's `icons:` (--pack). */
  packs?: string[];
  /** Finds a named pack (the CLI looks in the user's config dir). */
  pack?: (name: string) => IconPackFile | undefined;
  /** Packs already read, name → kind → SVG markup (the editor keeps its imported sets in the browser). */
  iconPacks?: Record<string, Record<string, string>>;
  /** Wins over the diagram's `icons:` official or lucide (--icons, the editor's toggle). */
  iconsOverride?: IconMode;
  sidecar?: LayoutSidecar;
  /** Layout overrides, for experiments. */
  tuning?: Tuning;
  /**
   * The drawing before this one (a result's `placed.memory`): what was there keeps its place unless
   * another placement is clearly better. Without it the sidecar's `layout` note is used; null forgets both.
   */
  previous?: LayoutMemory | null;
  /** Reads files the diagram refers to, relative to the diagram (contracts, includes). Leave out where there are no files. */
  load?: (file: string) => string;
  /** One of the diagram's `views:`; without it the diagram as written (or its first view when it only has views). */
  view?: string;
  /** Draw the diagram at this step (1-based) of its `steps:`; without it, the whole diagram at full strength. */
  step?: number;
  /** Leave the step's title, caption and "3 / 7" out of the drawing (a presenter shows them itself). */
  stepCaption?: boolean;
  /**
   * Draw only an element and its neighbourhood: a selector, a list of them, or { on, hops, direction }
   * as `focus:` in a diagram takes it (--focus, the editor's "Focus on this"). It wins over the
   * diagram's own focus and says so in the subtitle; null draws everything, whatever the diagram says.
   */
  focus?: unknown;
}

export interface RenderResult {
  svg?: string;
  width?: number;
  height?: number;
  diagnostics: Diagnostic[];
  type?: DiagramType;
  graph?: Graph;
  /** Positions in layout coordinates (after pins); the editor drags from these. */
  placed?: Placed;
  origin?: { x: number; y: number };
  /** The page the drawing is meant for (aspect: in the YAML, a 16:9 slide by default); none with aspect: auto. */
  page?: Page;
  /** The views the diagram (and what it includes) defines, and the one drawn. */
  views?: { name: string; title?: string }[];
  view?: string;
  /** The diagram has nothing drawn as written, only views: without a view it draws its first. */
  onlyViews?: boolean;
  /** Files read through `include:`, relative to the diagram. */
  includes?: string[];
  /** The steps the drawing can be told in (written, or the numbered lines of a dynamic view, or a sequence's messages), and the one drawn. */
  steps?: StepState[];
  step?: number;
  /** Nobody wrote these steps: export keeps such a drawing on one slide unless asked. */
  stepsImplied?: boolean;
  /** The theme it was drawn with (PNG export needs its font files). */
  theme?: Theme;
  /** Official icons drawn (BYO packs), as data URIs by node and group id: exports that draw for themselves (slides) use them. */
  images?: { nodes?: Map<string, string>; groups?: Map<string, string> };
  /** The focus drawn: what it is about (as labelled), how far it reaches, and how much of the diagram that left. */
  focus?: FocusSpec & { names: string[]; kept: number; total: number; written: boolean };
  /** The diagram (or the view drawn) has a `focus:` of its own, whether or not it was drawn. */
  focusWritten?: boolean;
}

/** Keys that are not something drawn, to tell a diagram that only has views. */
const META = new Set(['type', 'title', 'subtitle', 'direction', 'badges', 'aspect']);
/** Model keys checked for types whose schema does not list them (ERD, access, …). */
const stepsOnly = { type: 'object', properties: { steps: stepsSchema } };
const focusOnly = { type: 'object', properties: { focus: focusSchema } };
const modelOnly = (keys: readonly string[]) => ({ type: 'object', properties: Object.fromEntries(keys.map((k) => [k, modelProperties[k as keyof typeof modelProperties]])) });

export async function render(text: string, opts: RenderOptions = {}): Promise<RenderResult> {
  const source = parseSource(text);
  const diagnostics = [...source.diagnostics];
  if (source.data === undefined) return { diagnostics };

  const data = source.data as Record<string, unknown> | null;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { diagnostics: [...diagnostics, source.at([], 'A diagram starts with "type:"')] };
  // A model file draws as an architecture diagram of its elements; in C4 notation when its views are C4 views.
  const isModel = data.type === 'model';
  const c4Views = isModel && !!data.views && typeof data.views === 'object' && Object.values(data.views).some((v) => !!v && typeof v === 'object' && 'kind' in v);
  const type = isModel ? (c4Views ? c4 : systems) : findType(data.type);
  if (!type) {
    const known = types.map((t) => t.id).join(', ');
    const message = data.type == null ? `Add "type:" at the top, one of: ${known} (or model)` : `Unknown type "${String(data.type)}", use one of: ${known} (or model)`;
    return { diagnostics: [...diagnostics, source.at(data.type == null ? [] : ['type'], message)] };
  }

  // Types that do not list the model keys are checked without them, and the keys on their own. A key
  // such a type defines itself (an ERD's relations) stays the type's.
  // Theme and icons are about the look, shared by every type: they never reach the type's schema.
  // So is the shape the drawing aims for (aspect: 16:9, 4:3, 1.5 or auto).
  const { theme: themeRef, icons: iconsRef, aspect: aspectRef, ...rest } = data;
  const props = (type.schema as { properties?: Record<string, unknown> }).properties ?? {};
  // Steps are about presenting, shared by every type as well (unless a type has steps of its own).
  const stepsRef = 'steps' in props ? undefined : rest.steps;
  if (!('steps' in props)) delete rest.steps;
  // So is a focus: any diagram of elements and lines can be cut down to a neighbourhood.
  const focusRef = 'focus' in props ? undefined : rest.focus;
  if (!('focus' in props)) delete rest.focus;
  const own: Source = { ...source, data: rest };
  const listed = 'views' in props;
  const keys = modelKeys.filter((k) => listed || !(k in props));
  const isModelKey = (k: string) => (keys as string[]).includes(k);
  const plain = Object.fromEntries(Object.entries(rest).filter(([k]) => !isModelKey(k)));
  const invalid = isModel ? validate(own, modelSchema) : listed ? validate(own, type.schema) : [...validate({ ...source, data: plain }, type.schema), ...validate(own, modelOnly(keys))];
  if (stepsRef !== undefined) invalid.push(...validate({ ...source, data: { steps: stepsRef } }, stepsOnly));
  if (focusRef !== undefined) invalid.push(...validate({ ...source, data: { focus: focusRef } }, focusOnly));
  if (invalid.length) return { type, diagnostics: [...diagnostics, ...invalid] };

  const report = (path: Path, message: string, severity: Diagnostic['severity'] = 'error') => diagnostics.push(source.at(path, message, severity));
  // An included diagram of this type may have what this one may: the model keys, and a focus and steps of its own (only read past here).
  const included = { ...type.schema, properties: { focus: focusSchema, steps: stepsSchema, ...modelOnly(keys).properties, ...props } };
  let model: ModelContext | undefined;
  let built: Record<string, unknown> = rest;
  let origin: ((path: Path) => { at: Path; file: string } | undefined) | undefined;
  let includes: string[] | undefined;
  let onlyViews = false;
  // A type that draws its source in several ways (a journey as map or storyboard) takes the view asked for itself.
  const ownViews = type.views?.(rest);
  const ownView = opts.view && ownViews?.some((v) => v.name === opts.view) ? opts.view : undefined;
  if (ownView) opts = { ...opts, view: undefined };
  if (Object.keys(rest).some(isModelKey)) {
    const composed = compose(rest, { keys, load: opts.load, schemaOf: (t) => (t === 'model' ? modelSchema : included), report, self: opts.file, text });
    built = isModel ? { ...composed.data, type: type.id } : composed.data;
    origin = composed.origin;
    includes = composed.files;
    model = { ...composed.catalogue };
    const names = [...model.views.keys()];
    onlyViews = names.length > 0 && !Object.entries(built).some(([k, v]) => !META.has(k) && v && typeof v === 'object' && Object.keys(v).length);
    if (opts.view) {
      model.view = model.views.get(opts.view);
      if (!model.view) report([], `There is no view "${opts.view}"${names.length ? `; views: ${names.join(', ')}` : ''}`);
    } else if (onlyViews)
      // Only views, nothing drawn as written: the first view is the diagram.
      model.view = model.views.get(names[0]!);
  } else if (opts.view) report([], `There is no view "${opts.view}": ${ownViews?.length ? `views: ${ownViews.map((v) => v.name).join(', ')}` : 'this diagram has no views'}`);
  if (ownView) built = { ...built, view: ownView };
  // A focus asked for is about elements and lines: a diagram that opens as one of its tables (view: access) is focused in the type's first view, its graph.
  else if (opts.focus != null && ownViews?.some((v) => v.table && v.name === built.view)) built = { ...built, view: ownViews[0]!.name };

  // Problems in entries that came from another file point at its include entry.
  const where = (path: Path, message: string): [Path, string] => {
    const o = origin?.(path);
    return o ? [o.at, `${o.file}: ${message}`] : [path, message];
  };
  let graph = type.build(built, {
    error: (path, message) => report(...where(path, message)),
    warn: (path, message) => report(...where(path, message), 'warning'),
    load: opts.load,
    model,
  });
  if (model?.view && !model.used) graph = filterGraph(graph, model.view, (path, message) => report(path, message, 'warning'));
  // A focus cuts what is left down to a neighbourhood: asked for from outside, else the view's own, else the diagram's.
  const focusAt: Path = model?.view ? ['views', model.view.name, 'focus'] : ['focus'];
  const focusOwn = model?.view ? model.view.focus : focusRef;
  const asked = opts.focus !== undefined;
  const focusSpec = opts.focus === null ? undefined : readFocus(asked ? opts.focus : focusOwn);
  if (asked && opts.focus !== null && !focusSpec) report([], 'Focus needs something to focus on: an id, a group, tag:x or kind:x');
  const focused = focusSpec ? focusGraph(graph, focusSpec, (message, severity) => report(asked ? [] : focusAt, asked && !message.startsWith('Focus') ? `Focus: ${message}` : message, severity)) : undefined;
  if (focused) {
    graph = focused.graph;
    // Asked for from outside, the picture itself says it is a part: nobody takes an export for the whole landscape.
    if (asked && graph.title) graph.subtitle = [graph.subtitle, `Focus on ${focused.names.join(', ')}${graph.tree ? ' and their branch' : `, ${focusReach(focusSpec!)}`}`].filter(Boolean).join(' · ');
  }
  // The key shows each badge style as its chips look on the cards.
  graph = withBadgeIcons(graph);
  graph = apartInMoreThanColour(graph);
  // A ring in the accent colour is a mark like any other: the key says what it means.
  if (graph.nodes.some((n) => n.focused) || graph.groups.some((g) => g.focused)) graph = { ...graph, legend: [...(graph.legend ?? []), { label: 'In focus', swatch: 'focus' }] };
  if (origin) {
    // Entries from other files are edited there: the editor sees their include entry and file
    // (['include', 0, 'model.yaml']), never a path it could take for one of this file's entries.
    const fix = <T extends { path: Path }>(x: T) => {
      const o = origin!(x.path);
      if (o) x.path = [...o.at, o.file];
    };
    graph.nodes.forEach(fix);
    graph.groups.forEach(fix);
    graph.edges.forEach(fix);
  }

  const theme = pickTheme(opts, themeRef, source, diagnostics);
  // Text is measured in the theme's own faces: a bundled family by its advance widths, a brand font as Inter times its width.
  const brandFaces = theme.font.faces?.filter((f) => !f.mono);
  const fonts = themeTextFonts(theme, brandFaces?.length ? opts.fontScale?.(brandFaces) : undefined);
  await loadFonts([fonts.sans, fonts.mono]);
  // Cards are sized with their badge chips; layout and routing never see the badged edges.
  const measured = withTextFonts(fonts, () => size(graph, theme));
  const sized = { ...measured, graph: withoutBadges(graph), near: badgePairs(graph) };
  const spacing = { nodeGap: theme.space.nodeGap, layerGap: theme.space.layerGap, groupPad: theme.space.group.pad };
  // Each view keeps its own pins; the top level of the sidecar belongs to the diagram without one.
  const pins = viewPins(opts.sidecar, model?.view?.name);
  const autoDirection = (model?.view?.direction ?? data.direction) == null;
  const aspect = readAspect(aspectRef, (message) => report(['aspect'], message, 'warning'));
  // Views of one diagram are drawn alike where their content allows: a view drawn fresh (nothing
  // before it, nothing pinned) that shows mostly what the first view shows is drawn the way that one
  // was (direction, columns, rows), as if it were the drawing before it.
  const firstView = model?.views.size ? [...model.views.keys()][0] : ownViews?.length ? ownViews[0]!.name : undefined;
  const thisView = model?.view?.name ?? ownView ?? (model ? undefined : firstView);
  const seedKey = firstView ? `${hashText(text)}|${typeof opts.theme === 'string' ? opts.theme : ''}|${aspect ?? ''}` : '';
  let seed: LayoutMemory | undefined;
  // A table (an access matrix) is not laid out: nothing to share.
  const table = (name: string | undefined) => !!ownViews?.find((v) => v.name === name)?.table;
  if (firstView && thisView && thisView !== firstView && !table(thisView) && !table(firstView) && opts.previous === undefined && !pins?.layout && !opts.tuning) {
    if (!seeds.has(seedKey)) {
      const first = await render(text, { ...opts, view: firstView, fonts: 'none', step: undefined, focus: undefined });
      seeds.set(seedKey, { variant: first.placed?.memory?.variant, nodes: new Set(first.graph?.nodes.map((n) => n.id)) });
    }
    const s = seeds.get(seedKey)!;
    const shared = graph.nodes.filter((n) => s.nodes.has(n.id)).length;
    if (s.variant && shared >= SAME_VIEW * Math.max(graph.nodes.length, s.nodes.size)) seed = { variant: s.variant };
  }
  const previous = opts.previous !== undefined ? opts.previous : seed;
  // A type that places things itself gets the drawing before this one as well, to keep what it can.
  const placed = type.layout ? await type.layout(sized, pins, previous === null ? undefined : (previous ?? unpackLayout(pins?.layout)), aspect != null ? { aspect } : {}) : await layout(sized, spacing, pins, { autoDirection, ...(aspect != null ? { aspect } : {}), ...type.tuning, ...(previous !== undefined ? { previous } : {}), ...opts.tuning });
  if (firstView && thisView === firstView && opts.previous === undefined && !opts.tuning && !opts.focus) {
    if (seeds.size > 64) seeds.clear();
    seeds.set(seedKey, { variant: placed.memory?.variant, nodes: new Set(graph.nodes.map((n) => n.id)) });
  }
  // Layout may turn a very wide drawing top-down when the source did not say which way.
  if (placed.direction) graph.direction = placed.direction;
  // Two things pinned on top of each other: the newer one was moved clear, and that is said.
  const named = (id: string) => graph.groups.find((g) => g.id === id)?.label ?? id;
  for (const id of placed.nudged ?? []) diagnostics.push({ severity: 'warning', message: `${named(id)} was pinned on top of another pinned element: it is drawn beside it. Drag it where it should go, or Tidy` });
  // Steps come after the layout, so nothing moves between them: they only change what shows and what stands out.
  const told = model?.view ? model.view.present : (stepsRef as unknown[] | undefined);
  if (stepsRef !== undefined && onlyViews) report(['steps'], 'These steps are for the diagram as written, and this file only has views: put steps inside a view', 'warning');
  if (focusRef !== undefined && onlyViews) report(['focus'], 'This focus is for the diagram as written, and this file only has views: put focus inside a view', 'warning');
  // Without written steps a sequence diagram is told message by message, a dynamic view line by line.
  const steps = told ? resolveSteps(told, graph, model?.view ? ['views', model.view.name, 'steps'] : ['steps'], report) : impliedSteps(graph);
  const step = opts.step != null && steps.length ? Math.min(steps.length, Math.max(1, Math.round(opts.step))) : undefined;
  const images = resolveIcons(graph, rest, iconsRef, opts, (path, message) => diagnostics.push(source.at(path, message, 'warning')), type.id);
  const out = withTextFonts(fonts, () => drawSvg(graph, placed, theme, { ...opts, images: images ?? opts.images, stepView: step ? { index: step - 1, states: steps, caption: opts.stepCaption } : undefined }));
  // A model's views, and what the type draws besides (a threat table of the view): its first own view is the drawing itself.
  const typeViews = ownViews?.map(({ name, title }) => ({ name, ...(title ? { title } : {}) }));
  const views = model?.views.size ? [...[...model.views.values()].map((v) => ({ name: v.name, ...(v.title ? { title: v.title } : {}) })), ...(typeViews?.slice(1) ?? [])] : typeViews?.length ? typeViews : undefined;
  return {
    svg: out.svg,
    width: out.width,
    height: out.height,
    origin: out.origin,
    ...(pageFor(aspect) ? { page: pageFor(aspect) } : {}),
    diagnostics,
    type,
    graph,
    placed,
    theme,
    ...(images ? { images } : {}),
    ...(views ? { views } : {}),
    ...(model?.view ? { view: model.view.name } : ownView ? { view: ownView } : {}),
    ...(onlyViews ? { onlyViews } : {}),
    ...(includes?.length ? { includes } : {}),
    ...(steps.length ? { steps } : {}),
    ...(steps.length && !told ? { stepsImplied: true } : {}),
    ...(step ? { step } : {}),
    ...(focused ? { focus: { ...focusSpec!, names: focused.names, kept: focused.kept, total: focused.total, written: !asked } } : {}),
    ...(focusOwn != null ? { focusWritten: true } : {}),
  };
}

/** The second marks a line can carry besides its colour, in the order they are handed out. */
const PATTERNS: LinePattern[] = ['ticks', 'beads', 'double'];

/**
 * Kinds of line in the key that differ in colour alone (solid grey Connection and solid blue
 * Request, Ethernet and Fibre) get a second mark, so they read apart without colour (printed in
 * grey, or for a reader who cannot tell the two colours apart): the most used kind stays plain, the
 * others get a pattern no kind of that line uses yet, on their lines and in the key alike.
 */
export function apartInMoreThanColour(graph: Graph): Graph {
  const items = (graph.legend ?? []).filter((l) => !l.swatch && !l.end);
  if (items.length < 2) return graph;
  const like = (a: { line?: string; pattern?: string; tone?: string }, b: { line?: string; pattern?: string; tone?: string }) => (a.line ?? 'solid') === (b.line ?? 'solid') && (a.pattern ?? '') === (b.pattern ?? '') && (a.tone ?? '') === (b.tone ?? '');
  const used = (item: LegendItem) => graph.edges.filter((e) => !e.badge && like(e, item)).length;
  const set = new Map<LegendItem, LinePattern>();
  const groups = new Map<string, LegendItem[]>();
  for (const item of items) {
    const k = `${item.line ?? 'solid'}|${item.pattern ?? ''}`;
    if (!groups.get(k)?.some((o) => (o.tone ?? '') === (item.tone ?? ''))) groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const line = list[0]!.line ?? 'solid';
    const free = PATTERNS.filter((p) => !items.some((i) => (i.line ?? 'solid') === line && i.pattern === p));
    const [, ...rest] = [...list].sort((a, b) => used(b) - used(a));
    for (const item of rest) {
      const p = free.shift();
      if (p) set.set(item, p);
    }
  }
  if (!set.size) return graph;
  const edges = graph.edges.map((e) => {
    for (const [item, p] of set) if (!e.badge && like(e, item)) return { ...e, pattern: p };
    return e;
  });
  return { ...graph, edges, legend: graph.legend!.map((l) => (set.has(l) ? { ...l, pattern: set.get(l)! } : l)) };
}

/** The way each model's first view was drawn (LayoutMemory.variant), by source: the other views start from it. */
const seeds = new Map<string, { variant?: string; nodes: Set<string> }>();
/** A view that shares this share of its cards with the first view (of the two, the larger) is drawn its way. */
const SAME_VIEW = 0.6;

/** FNV-1a over a source text, 32 bits. */
function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36) + text.length;
}

/** A 16:9 slide, 13.33 by 7.5 inches, in CSS pixels (96 to the inch). */
const SLIDE = { width: 1280, height: 720 };
/**
 * The words a reader needs (card names, line labels: the text slideTextPt measures) smaller than
 * this (points) on a slide are hard to read from the back of a room. Line labels are drawn at 10 px,
 * 7.5 pt at full size: under 6 pt the drawing is shrunk to less than four fifths, too much for one page.
 */
export const SLIDE_MIN_PT = 6;
/** Text smaller than this (px) is detail (a tag, a count, a badge): it may get small before the drawing is too big for a page. */
const DETAIL_PX = 10;

/** A page a drawing is meant for, in CSS pixels (96 to the inch). */
export interface Page {
  /** As said to a person: "16:9 slide", "A4 landscape". */
  name: string;
  width: number;
  height: number;
}

/** Named shapes `aspect:` takes besides a ratio: the sheets and slides people draw for. */
const NAMED: Record<string, number> = { slide: 16 / 9, a4: 297 / 210, 'a4-landscape': 297 / 210, 'a4-portrait': 210 / 297, a3: 420 / 297, 'a3-landscape': 420 / 297, 'a3-portrait': 297 / 420 };
const near = (a: number, b: number) => Math.abs(a / b - 1) < 0.01;

/** The page for an aspect: a 16:9 or 4:3 slide (7.5 inches high), an A4 sheet, or a 7.5-inch-high page of that shape; none for auto. */
export function pageFor(aspect: number | 'auto' | undefined): Page | undefined {
  if (aspect === 'auto') return undefined;
  const a = aspect ?? 16 / 9;
  if (near(a, 16 / 9)) return { name: '16:9 slide', ...SLIDE };
  if (near(a, 4 / 3)) return { name: '4:3 slide', width: 960, height: 720 };
  if (near(a, 297 / 210)) return { name: 'A4 landscape', width: 1123, height: 794 };
  if (near(a, 210 / 297)) return { name: 'A4 portrait', width: 794, height: 1123 };
  if (near(a, 420 / 297)) return { name: 'A3 landscape', width: 1587, height: 1123 };
  if (near(a, 297 / 420)) return { name: 'A3 portrait', width: 1123, height: 1587 };
  return { name: `${Math.round(a * 100) / 100}:1 page`, width: Math.round(720 * a), height: 720 };
}

/**
 * The smallest size (px) of the text a reader needs in a drawing's SVG: the words on cards, lines and
 * groups, not the asides (the word KEY, the imprint, a map sheet's grid letters, marked data-aside)
 * nor the details under DETAIL_PX (tags, counts, badges).
 * Undefined when it has no such text.
 */
export function smallestTextPx(svg: string): number | undefined {
  const sizes = [...svg.matchAll(/<text\b[^>]*>/g)]
    .filter((m) => !m[0].includes('data-aside'))
    .map((m) => Number(/font-size="([\d.]+)"/.exec(m[0])?.[1]))
    .filter((n) => n >= DETAIL_PX);
  return sizes.length ? Math.min(...sizes) : undefined;
}

/**
 * The smallest text of a drawing, in points, when it is fitted onto a page (a 16:9 slide, 13.33
 * inches wide, unless another is given): what `carto validate` warns about below SLIDE_MIN_PT.
 * Undefined when it has no text.
 */
export function slideTextPt(svg: string, width: number, height: number, page: { width: number; height: number } = SLIDE): number | undefined {
  const px = smallestTextPx(svg);
  if (px == null || !width || !height) return undefined;
  const scale = Math.min(page.width / width, page.height / height);
  // A pixel is three quarters of a point; said to a tenth, and compared as said.
  return Math.round(px * scale * 0.75 * 10) / 10;
}

/**
 * The part of the page the drawing can fill with its smallest text still SLIDE_MIN_PT: the page
 * shrunk (in drawing px) to where the text would be just readable. What lies outside it is too much
 * for one page: on the canvas it is marked.
 */
export function readableArea(svg: string, page: { width: number; height: number }): { width: number; height: number } | undefined {
  const px = smallestTextPx(svg);
  if (px == null) return undefined;
  // At scale s text is px * s * 0.75 pt: readable while s >= SLIDE_MIN_PT / (px * 0.75).
  const s = SLIDE_MIN_PT / (px * 0.75);
  return { width: page.width / s, height: page.height / s };
}

/** `aspect:` as written: "16:9", "4:3", a4, a4-portrait (and the like), a number (width / height) or "auto". */
export function readAspect(v: unknown, warn: (message: string) => void): number | 'auto' | undefined {
  if (v == null) return undefined;
  if (v === 'auto') return 'auto';
  const key = typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, '-') : '';
  if (NAMED[key]) return NAMED[key];
  const m = typeof v === 'string' ? /^\s*(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)\s*$/.exec(v) : undefined;
  const n = typeof v === 'number' ? v : m ? Number(m[1]) / Number(m[2]) : NaN;
  if (Number.isFinite(n) && n >= 0.2 && n <= 5) return n;
  warn('aspect is the shape to aim for: 16:9, 4:3, a4, a4-portrait, a number such as 1.5 (width / height), or auto');
  return undefined;
}

function named(t: string | Theme | undefined): Theme | undefined {
  return typeof t === 'object' ? t : t ? themes[t] : undefined;
}

/** Override, then the diagram's own `theme:`, then the caller's default. */
function pickTheme(opts: RenderOptions, ref: unknown, source: Source, diagnostics: Diagnostic[]): Theme {
  const fallback = named(opts.theme) ?? themes.light;
  const forced = named(opts.themeOverride);
  if (forced) return forced;
  if (ref == null) return fallback;
  const r = resolveTheme(ref, { load: opts.load, assets: opts.assets }, fallback);
  for (const w of r.warnings) diagnostics.push(source.at(['theme', ...(typeof ref === 'object' ? w.path : [])], w.message, 'warning'));
  return r.theme;
}

export { themes };
export { drift, type DriftItem, type DriftResult } from './drift.ts';
export type { IconPackFile, IconMode };
/** Review notes drawn on an export ("with review notes"); see packages/core/src/notes.ts. */
export { noteMarker, noteSpots, withReviewNotes, type NoteSpot } from '@cartography/render';
