// The plugin contract: a diagram type turns its own YAML into the shared Graph.
import type { Graph, LayoutSidecar, Path, Placed, Sized, Tone } from './model.ts';

export interface DiagramType<Source = any> {
  /** The value of `type:` in the YAML. */
  id: string;
  name: string;
  description: string;
  /** JSON Schema of the YAML; drives validation, editor autocomplete and the builder. */
  schema: object;
  /** Starter YAML for `carto new` and the builder's template picker. */
  template: string;
  /** Shapes the builder offers, in palette order. */
  palette: PaletteItem[];
  build(source: Source, ctx: BuildContext): Graph;
  /** Own layout for types that are not node-and-edge graphs (git flow, journeys). Defaults to ELK. */
  layout?(sized: Sized, sidecar?: LayoutSidecar): Promise<Placed>;
}

export interface BuildContext {
  error(path: Path, message: string): void;
  warn(path: Path, message: string): void;
}

export interface PaletteItem {
  /** Which collection the builder adds to, e.g. 'nodes', 'groups', 'tables'. */
  collection: string;
  kind: string;
  label: string;
  icon: string;
  tone: Tone;
  /** Short words for palette search. */
  keywords?: string[];
}

export const idPattern = '^[A-Za-z0-9_-]+$';

/** Look-up table of kinds for a type: label shown as caption, icon and tone. */
export type KindTable = Record<string, { label: string; icon: string; tone: Tone; keywords?: string[] }>;
