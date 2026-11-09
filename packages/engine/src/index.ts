// The whole pipeline in one call, shared by the CLI and the web app:
// YAML → validate → type.build → measure → layout → pins → SVG.
import { parseSource, validate, type Diagnostic, type DiagramType, type Graph, type LayoutSidecar, type Placed } from '@cartography/core';
import { applyPins, layoutElk } from '@cartography/layout';
import { drawSvg, size, type SvgOptions } from '@cartography/render';
import { themes, type Theme } from '@cartography/theme';
import { azure } from '@cartography/azure';
import { erd } from '@cartography/erd';

export const types: DiagramType[] = [azure, erd];

export function findType(id: unknown): DiagramType | undefined {
  return types.find((t) => t.id === id);
}

export interface RenderOptions extends SvgOptions {
  theme?: 'light' | 'dark' | Theme;
  sidecar?: LayoutSidecar;
}

export interface RenderResult {
  svg?: string;
  width?: number;
  height?: number;
  diagnostics: Diagnostic[];
  type?: DiagramType;
  graph?: Graph;
  /** Layout before pins, in layout coordinates; the editor uses it to drag from. */
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
  });

  const theme = typeof opts.theme === 'object' ? opts.theme : themes[opts.theme ?? 'light'];
  const sized = size(graph, theme);
  const placed = type.layout
    ? await type.layout(sized, opts.sidecar)
    : await layoutElk(sized, { nodeGap: theme.space.nodeGap, layerGap: theme.space.layerGap, groupPad: theme.space.group.pad });
  const pinned = applyPins(placed, sized, opts.sidecar, theme.space.group.pad);
  const out = drawSvg(graph, pinned, theme, opts);
  return { svg: out.svg, width: out.width, height: out.height, origin: out.origin, diagnostics, type, graph, placed: pinned };
}

export { themes };
