// The plugin contract: a diagram type turns its own YAML into the shared Graph.
import type { CardForm, Graph, LayoutSidecar, Path, Placed, Sized, Tone } from './model.ts';
import type { ModelContext } from './catalogue.ts';

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
  /**
   * How the builder connects two drawn elements: append `value` to the list at `path`, or a message
   * saying why these two cannot be connected. Without it, connections go to `edges` as "a -> b".
   */
  connect?(source: Source, from: string, to: string): Connection | string;
  /** Every place the YAML names another entry, so renames and deletes follow references and nothing else. */
  references?(source: Source): Reference[];
  /** Own layout for types that are not node-and-edge graphs (git flow, journeys). Defaults to dot placement plus the router. */
  layout?(sized: Sized, sidecar?: LayoutSidecar): Promise<Placed>;
}

export interface Connection {
  /** A list in the YAML (created when missing), e.g. ['products', 'revenue', 'inputs']; or a map when `key` is set. */
  path: Path;
  /** Set this key in the map at `path` instead of appending to a list, e.g. a foreign-key column. */
  key?: string;
  value: unknown;
}

/** One id written somewhere in the YAML. */
export interface Reference {
  /** The scalar that holds the id, or the map whose single key holds it when `key` is set ("a -> b": …). */
  path: Path;
  key?: boolean;
  id: string;
  /** Where the id starts inside that string ("a -> b" holds two). */
  start: number;
  /** The collection of the entry it names, e.g. 'groups'. */
  collection: string;
  /**
   * What deleting the named entry does here: drop the list item it sits in (default when the path
   * holds a list index), drop the map key (default otherwise), or cut `cut` out of the string.
   */
  onDelete?: 'item' | 'key' | 'cut';
  /** Characters to cut on delete, e.g. "fk orders.id" out of a column spec. */
  cut?: [number, number];
}

export interface BuildContext {
  error(path: Path, message: string): void;
  warn(path: Path, message: string): void;
  /** Reads a file the diagram refers to (relative to the diagram), e.g. a data contract. Throws when it cannot. Absent where there are no files. */
  load?(file: string): string;
  /**
   * The shared model and the view to draw, set when the diagram includes a model, defines elements or
   * has views. Types built on buildGraph resolve refs and views with it and set `used`; the engine
   * filters other types' graphs by id afterwards.
   */
  model?: ModelContext;
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

/**
 * Look-up table of kinds for a type: label shown as caption, icon and tone. `quiet` kinds are never
 * named in a caption (a neutral group, a flow step); `form` gives a card a flow-chart outline.
 */
export type KindTable = Record<string, { label: string; icon: string; tone: Tone; keywords?: string[]; quiet?: boolean; form?: CardForm }>;
