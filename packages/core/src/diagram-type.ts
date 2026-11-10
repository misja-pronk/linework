// The plugin contract: a diagram type turns its own YAML into the shared Graph.
import type { CardForm, Graph, LayoutMemory, LayoutSidecar, Path, Placed, Sized, Tone } from './model.ts';
import type { ModelContext } from './catalogue.ts';

export interface DiagramType<Source = any> {
  /** The value of `type:` in the YAML. */
  id: string;
  name: string;
  description: string;
  // Guidance for picking a type: the start dialog, `carto types`, the editor's type pill and docs/types.md.
  // All optional, so a new type works without it; keep every string short.
  /** Lucide icon for the type card. */
  icon?: string;
  /** One line: what you draw with it. */
  tagline?: string;
  /** Two to four concrete situations. */
  useWhen?: string[];
  /** Look-alike jobs this type is the wrong pick for; `use` is the id of the better type. */
  notFor?: { text: string; use?: string }[];
  /** Words people type when they mean this type ("pods", "who has access"); see `matchTypes`. */
  keywords?: string[];
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
  /** No lines between entries at all (a journey): the builder offers no connect handle. */
  unconnected?: true;
  /** Every place the YAML names another entry, so renames and deletes follow references and nothing else. */
  references?(source: Source): Reference[];
  /** Layout hints for the shared graph layout, e.g. room for long labels. */
  tuning?: { labelRoom?: 'fit'; autoDirection?: false };
  /** Own layout for types that are not node-and-edge graphs (git flow, journeys). Defaults to dot placement plus the router. */
  layout?(sized: Sized, sidecar?: LayoutSidecar, previous?: LayoutMemory, options?: { aspect?: number | 'auto' }): Promise<Placed>;
  /**
   * Ways the type itself draws the same source (a journey as map, storyboard or blueprint). `--view`
   * and the editor's view picker choose one; build gets it as the source's `view`. `table`: the view is
   * not elements and lines, so a focus asked for is drawn in the first view instead.
   */
  views?(source: Source): { name: string; title?: string; table?: boolean }[];
  /** An entry written short, as the map the builder edits: a journey step `4` is `{ feel: 4 }`. Default: the kind or the label. */
  shorthand?(collection: string, value: unknown): Record<string, unknown> | undefined;
  /** Fields that name an entry of another collection, for the builder's pickers, where the usual ones do not fit: { in: ['phases'] }. */
  refKeys?: Record<string, string[]>;
  /**
   * Collections drawn in the order written (journey steps), so the builder offers to move an entry
   * earlier or later. A string names the field an entry without it takes from the entry above ("in").
   */
  ordered?: Record<string, true | string>;
  /** Entries are named as a reader says them (a process step, a state): a new name may hold spaces. */
  freeNames?: true;
  /**
   * For types whose list items hold more than one line ("a -> b -> c" in a process): how the builder
   * changes one drawn line. Each gives what the list item becomes, or nothing for a line that is
   * not written as one (a note's line).
   */
  lines?: {
    /** What a label looks like, under the builder's field: "event [guard] / action". */
    hint?: string;
    /** The line gets this label; '' takes it away. */
    label(source: Source, edge: string, label: string): Rewrite | undefined;
    /** The line goes: a chain is cut in two where it was. */
    remove(source: Source, edge: string): Rewrite | undefined;
  };
}

/** A list item written anew: the item at `path` becomes `items` (none: it goes, two: it is split). */
export interface Rewrite {
  path: Path;
  items: unknown[];
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
  /** With `cut`: how many ids the string holds ("a -> b -> c": 3). Cut down to fewer than two, the whole list item goes. */
  among?: number;
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
  /** The vendor a kind belongs to (aws, gcp, azure): which icon pack draws it. */
  provider?: string;
  /** What the vendor's own icon files call it, e.g. "simple storage service" for s3: matched when icons are imported. */
  names?: string[];
}

export const idPattern = '^[A-Za-z0-9_-]+$';

/**
 * Look-up table of kinds for a type: label shown as caption, icon and tone. `quiet` kinds are never
 * named in a caption (a neutral group, a flow step); `form` gives a card a flow-chart outline.
 */
export type KindTable = Record<string, { label: string; icon: string; tone: Tone; keywords?: string[]; quiet?: boolean; form?: CardForm }>;
