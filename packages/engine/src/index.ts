// The whole pipeline in one call, shared by the CLI and the web app:
// YAML → validate → type.build → measure → layout → pins → SVG.
import { parseSource, validate, withoutBadges, type Diagnostic, type DiagramType, type Graph, type LayoutSidecar, type Placed, type Source } from '@cartography/core';
import { layout, type Tuning } from '@cartography/layout';
import { drawSvg, size, type SvgOptions } from '@cartography/render';
import { resolveTheme, themes, withTextScale, type FontFace, type Theme } from '@cartography/theme';
import { resolveIcons, type IconPackFile } from './icons.ts';
import { systems } from '@cartography/systems';
import { azure } from '@cartography/azure';
import { kubernetes } from '@cartography/kubernetes';
import { erd } from '@cartography/erd';
import { access } from '@cartography/access';
import { github } from '@cartography/github';
import { dataProducts } from '@cartography/data-products';

// Systems first: the generic type people reach for, and what imports produce.
export const types: DiagramType[] = [systems, azure, kubernetes, erd, access, github, dataProducts];

export function findType(id: unknown): DiagramType | undefined {
  return types.find((t) => t.id === id);
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
  /** Reads files the diagram refers to, relative to the diagram (contracts). Leave out where there are no files. */
  load?: (file: string) => string;
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
  /** The theme it was drawn with (PNG export needs its font files). */
  theme?: Theme;
}

export async function render(text: string, opts: RenderOptions = {}): Promise<RenderResult> {
  const source = parseSource(text);
  const diagnostics = [...source.diagnostics];
  if (source.data === undefined) return { diagnostics };

  const data = source.data as Record<string, unknown> | null;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { diagnostics: [...diagnostics, source.at([], 'A diagram starts with "type:"')] };
  const type = findType(data.type);
  if (!type) {
    const known = types.map((t) => t.id).join(', ');
    const message = data.type == null ? `Add "type:" at the top, one of: ${known}` : `Unknown type "${String(data.type)}", use one of: ${known}`;
    return { diagnostics: [...diagnostics, source.at(data.type == null ? [] : ['type'], message)] };
  }

  // Theme and icons are about the look, shared by every type: they never reach the type's schema.
  const { theme: themeRef, icons: iconsRef, ...rest } = data;
  const own: Source = { ...source, data: rest };
  const invalid = validate(own, type.schema);
  if (invalid.length) return { type, diagnostics: [...diagnostics, ...invalid] };

  const graph = type.build(rest, {
    error: (path, message) => diagnostics.push(source.at(path, message)),
    warn: (path, message) => diagnostics.push(source.at(path, message, 'warning')),
    load: opts.load,
  });

  const theme = pickTheme(opts, themeRef, source, diagnostics);
  const scale = theme.font.scale ?? (theme.font.faces?.length ? opts.fontScale?.(theme.font.faces) : undefined);
  // Cards are sized with their badge chips; layout and routing never see the badged edges.
  const measured = withTextScale(scale, () => size(graph, theme));
  const sized = { ...measured, graph: withoutBadges(graph) };
  const spacing = { nodeGap: theme.space.nodeGap, layerGap: theme.space.layerGap, groupPad: theme.space.group.pad };
  const placed = type.layout ? await type.layout(sized, opts.sidecar) : await layout(sized, spacing, opts.sidecar, { autoDirection: data.direction == null, ...opts.tuning });
  // Layout may turn a very wide drawing top-down when the source did not say which way.
  if (placed.direction) graph.direction = placed.direction;
  const images = resolveIcons(graph, rest, iconsRef, opts, (path, message) => diagnostics.push(source.at(path, message, 'warning')));
  const out = withTextScale(scale, () => drawSvg(graph, placed, theme, { ...opts, images: images ?? opts.images }));
  return { svg: out.svg, width: out.width, height: out.height, origin: out.origin, diagnostics, type, graph, placed, theme };
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
