// The whole pipeline in one call, shared by the CLI and the web app:
// YAML → validate → type.build → measure → layout → pins → SVG.
import { parseSource, validate, withoutBadges, type Diagnostic, type DiagramType, type Graph, type LayoutSidecar, type Placed } from '@cartography/core';
import { layout, type Tuning } from '@cartography/layout';
import { drawSvg, size, type SvgOptions } from '@cartography/render';
import { themes, type Theme } from '@cartography/theme';
import { azure } from '@cartography/azure';
import { erd } from '@cartography/erd';
import { access } from '@cartography/access';
import { github } from '@cartography/github';
import { dataProducts } from '@cartography/data-products';

export const types: DiagramType[] = [azure, erd, access, github, dataProducts];

export function findType(id: unknown): DiagramType | undefined {
  return types.find((t) => t.id === id);
}

export interface RenderOptions extends SvgOptions {
  theme?: 'light' | 'dark' | Theme;
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

  const invalid = validate(source, type.schema);
  if (invalid.length) return { type, diagnostics: [...diagnostics, ...invalid] };

  const graph = type.build(data, {
    error: (path, message) => diagnostics.push(source.at(path, message)),
    warn: (path, message) => diagnostics.push(source.at(path, message, 'warning')),
    load: opts.load,
  });

  const theme = typeof opts.theme === 'object' ? opts.theme : themes[opts.theme ?? 'light'];
  // Cards are sized with their badge chips; layout and routing never see the badged edges.
  const measured = size(graph, theme);
  const sized = { ...measured, graph: withoutBadges(graph) };
  const spacing = { nodeGap: theme.space.nodeGap, layerGap: theme.space.layerGap, groupPad: theme.space.group.pad };
  const placed = type.layout ? await type.layout(sized, opts.sidecar) : await layout(sized, spacing, opts.sidecar, opts.tuning);
  const out = drawSvg(graph, placed, theme, opts);
  return { svg: out.svg, width: out.width, height: out.height, origin: out.origin, diagnostics, type, graph, placed };
}

export { themes };
