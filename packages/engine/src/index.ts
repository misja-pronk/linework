// The whole pipeline in one call, shared by the CLI and the web app:
// YAML → validate → type.build → measure → layout → pins → SVG.
import {
  compose,
  filterGraph,
  impliedSteps,
  modelKeys,
  modelProperties,
  modelSchema,
  parseSource,
  resolveSteps,
  stepsSchema,
  validate,
  viewPins,
  withoutBadges,
  type Diagnostic,
  type DiagramType,
  type Graph,
  type LayoutSidecar,
  type ModelContext,
  type Path,
  type Placed,
  type Source,
  type StepState,
} from '@cartography/core';
import { layout, type Tuning } from '@cartography/layout';
import { drawSvg, size, type SvgOptions } from '@cartography/render';
import { resolveTheme, themes, withTextScale, type FontFace, type Theme } from '@cartography/theme';
import { resolveIcons, type IconPackFile } from './icons.ts';
import { c4, systems } from '@cartography/systems';
import { azure } from '@cartography/azure';
import { kubernetes } from '@cartography/kubernetes';
import { network } from '@cartography/network';
import { erd } from '@cartography/erd';
import { access } from '@cartography/access';
import { github } from '@cartography/github';
import { dataProducts } from '@cartography/data-products';
import { sequence } from '@cartography/sequence';
import { gitflow } from '@cartography/gitflow';
import { roadmap } from '@cartography/roadmap';

// Systems first: the generic type people reach for, and what imports produce.
export const types: DiagramType[] = [systems, c4, network, azure, kubernetes, erd, access, github, dataProducts, sequence, gitflow, roadmap];

export function findType(id: unknown): DiagramType | undefined {
  return types.find((t) => t.id === id);
}

/** A type's schema with what every diagram takes on top of its own keys: `steps:` for presenting. Editors complete from this. */
export function schemaOf(type: DiagramType): Record<string, unknown> {
  const schema = type.schema as { properties?: Record<string, unknown> };
  return 'steps' in (schema.properties ?? {}) ? schema : { ...schema, properties: { ...schema.properties, steps: stepsSchema } };
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
  sidecar?: LayoutSidecar;
  /** Layout overrides, for experiments. */
  tuning?: Tuning;
  /** Reads files the diagram refers to, relative to the diagram (contracts, includes). Leave out where there are no files. */
  load?: (file: string) => string;
  /** One of the diagram's `views:`; without it the diagram as written (or its first view when it only has views). */
  view?: string;
  /** Draw the diagram at this step (1-based) of its `steps:`; without it, the whole diagram at full strength. */
  step?: number;
  /** Leave the step's title, caption and "3 / 7" out of the drawing (a presenter shows them itself). */
  stepCaption?: boolean;
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
}

/** Keys that are not something drawn, to tell a diagram that only has views. */
const META = new Set(['type', 'title', 'subtitle', 'direction', 'badges']);
/** Model keys checked for types whose schema does not list them (ERD, access, …). */
const stepsOnly = { type: 'object', properties: { steps: stepsSchema } };
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
  const { theme: themeRef, icons: iconsRef, ...rest } = data;
  const props = (type.schema as { properties?: Record<string, unknown> }).properties ?? {};
  // Steps are about presenting, shared by every type as well (unless a type has steps of its own).
  const stepsRef = 'steps' in props ? undefined : rest.steps;
  if (!('steps' in props)) delete rest.steps;
  const own: Source = { ...source, data: rest };
  const listed = 'views' in props;
  const keys = modelKeys.filter((k) => listed || !(k in props));
  const isModelKey = (k: string) => (keys as string[]).includes(k);
  const plain = Object.fromEntries(Object.entries(rest).filter(([k]) => !isModelKey(k)));
  const invalid = isModel ? validate(own, modelSchema) : listed ? validate(own, type.schema) : [...validate({ ...source, data: plain }, type.schema), ...validate(own, modelOnly(keys))];
  if (stepsRef !== undefined) invalid.push(...validate({ ...source, data: { steps: stepsRef } }, stepsOnly));
  if (invalid.length) return { type, diagnostics: [...diagnostics, ...invalid] };

  const report = (path: Path, message: string, severity: Diagnostic['severity'] = 'error') => diagnostics.push(source.at(path, message, severity));
  let model: ModelContext | undefined;
  let built: Record<string, unknown> = rest;
  let origin: ((path: Path) => { at: Path; file: string } | undefined) | undefined;
  let includes: string[] | undefined;
  let onlyViews = false;
  if (Object.keys(rest).some(isModelKey)) {
    const composed = compose(rest, { keys, load: opts.load, schemaOf: (t) => (t === 'model' ? modelSchema : type.schema), report, self: opts.file, text });
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
  } else if (opts.view) report([], `There is no view "${opts.view}": this diagram has no views`);

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
  const scale = theme.font.scale ?? (theme.font.faces?.length ? opts.fontScale?.(theme.font.faces) : undefined);
  // Cards are sized with their badge chips; layout and routing never see the badged edges.
  const measured = withTextScale(scale, () => size(graph, theme));
  const sized = { ...measured, graph: withoutBadges(graph) };
  const spacing = { nodeGap: theme.space.nodeGap, layerGap: theme.space.layerGap, groupPad: theme.space.group.pad };
  // Each view keeps its own pins; the top level of the sidecar belongs to the diagram without one.
  const pins = viewPins(opts.sidecar, model?.view?.name);
  const autoDirection = (model?.view?.direction ?? data.direction) == null;
  const placed = type.layout ? await type.layout(sized, pins) : await layout(sized, spacing, pins, { autoDirection, ...type.tuning, ...opts.tuning });
  // Layout may turn a very wide drawing top-down when the source did not say which way.
  if (placed.direction) graph.direction = placed.direction;
  // Steps come after the layout, so nothing moves between them: they only change what shows and what stands out.
  const told = model?.view ? model.view.present : (stepsRef as unknown[] | undefined);
  if (stepsRef !== undefined && onlyViews) report(['steps'], 'These steps are for the diagram as written, and this file only has views: put steps inside a view', 'warning');
  // Without written steps a sequence diagram is told message by message, a dynamic view line by line.
  const steps = told ? resolveSteps(told, graph, model?.view ? ['views', model.view.name, 'steps'] : ['steps'], report) : impliedSteps(graph);
  const step = opts.step != null && steps.length ? Math.min(steps.length, Math.max(1, Math.round(opts.step))) : undefined;
  const images = resolveIcons(graph, rest, iconsRef, opts, (path, message) => diagnostics.push(source.at(path, message, 'warning')));
  const out = withTextScale(scale, () => drawSvg(graph, placed, theme, { ...opts, images: images ?? opts.images, stepView: step ? { index: step - 1, states: steps, caption: opts.stepCaption } : undefined }));
  const views = model?.views.size ? [...model.views.values()].map((v) => ({ name: v.name, ...(v.title ? { title: v.title } : {}) })) : undefined;
  return {
    svg: out.svg,
    width: out.width,
    height: out.height,
    origin: out.origin,
    diagnostics,
    type,
    graph,
    placed,
    theme,
    ...(views ? { views } : {}),
    ...(model?.view ? { view: model.view.name } : {}),
    ...(onlyViews ? { onlyViews } : {}),
    ...(includes?.length ? { includes } : {}),
    ...(steps.length ? { steps } : {}),
    ...(steps.length && !told ? { stepsImplied: true } : {}),
    ...(step ? { step } : {}),
  };
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
export type { IconPackFile };
