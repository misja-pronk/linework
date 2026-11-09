// The type-agnostic graph every diagram type builds. Render and layout only know this model,
// which is what keeps all diagram types looking like one tool.

/** Where something came from in the YAML source, e.g. ['nodes', 'web', 'label']. */
export type Path = (string | number)[];

export type Tone = 'blue' | 'sky' | 'indigo' | 'violet' | 'teal' | 'green' | 'amber' | 'orange' | 'rose' | 'slate';
export const tones: Tone[] = ['blue', 'sky', 'indigo', 'violet', 'teal', 'green', 'amber', 'orange', 'rose', 'slate'];

export type Direction = 'right' | 'down';

export interface Graph {
  title?: string;
  subtitle?: string;
  direction: Direction;
  groups: GraphGroup[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  legend?: LegendItem[];
  /** Numbered interactions of a dynamic view, in order: drawn as numbers on their lines, and what a step-through shows one by one. */
  steps?: GraphStep[];
}

export interface GraphStep {
  /** 1, 2, 3, … as drawn on the line. */
  n: number;
  /** The edge that draws it. */
  edge: string;
  from: string;
  to: string;
  label?: string;
  path: Path;
}

export interface GraphGroup {
  id: string;
  parent?: string;
  label: string;
  caption?: string;
  icon?: string;
  tone: Tone;
  /** solid: a real boundary (subscription); dashed: a logical one (subnet, schema). */
  border: 'solid' | 'dashed';
  /** Where it points to: a URL, another diagram, a view. Drawn as a link icon; real links in exports. */
  links?: Link[];
  description?: string;
  path: Path;
}

export interface GraphNode {
  id: string;
  parent?: string;
  shape: CardShape | TableShape | MatrixShape;
  links?: Link[];
  /** Longer text, shown as a tooltip and read by screen readers. */
  description?: string;
  path: Path;
  /** Shown only as the badges that name it (a ConfigMap on the workload using it), never as a card of its own. */
  folded?: boolean;
}

/** A link on an element: a URL, a diagram file (relative to this one), or a view of one ("containers.yaml#containers", "#context"). */
export interface Link {
  kind: 'url' | 'file' | 'view';
  /** As written. */
  target: string;
  /** For file and view links: the file, '' for this diagram. */
  file?: string;
  view?: string;
  label?: string;
}

/** Icon tile + label + caption: resources, services, devices, principals. */
export interface CardShape {
  kind: 'card';
  label: string;
  caption?: string;
  icon?: string;
  tone: Tone;
  badges?: string[];
  /** Flow-chart outlines: a decision (pointed ends), a terminal (pill) or a plain step (no icon tile); a person has a round tile. */
  form?: CardForm;
  /** A short description written in the card under the caption (C4 style), wrapped to at most three lines. */
  body?: string;
  /** Outside the scope of the drawing (an external system): drawn greyed. */
  muted?: boolean;
}

export type CardForm = 'decision' | 'terminal' | 'plain' | 'person';

/** Header + rows, with a connection point per row: tables, data products in detail. */
export interface TableShape {
  kind: 'table';
  title: string;
  caption?: string;
  icon?: string;
  tone: Tone;
  rows: TableRow[];
}

/** A grid with row and column headers: access matrices, role × permission tables. */
export interface MatrixShape {
  kind: 'matrix';
  /** Text above the row headers, e.g. "Who \\ where". */
  corner?: string;
  columns: MatrixHeader[];
  rows: MatrixHeader[];
  /** cells[row][column]; undefined is an empty cell. */
  cells: (MatrixCell | undefined)[][];
}

export interface MatrixHeader {
  label: string;
  caption?: string;
  icon?: string;
  tone?: Tone;
}

export interface MatrixCell {
  /** A pill with text (a role name), or a check mark when `check` is set. */
  text?: string;
  check?: boolean;
  /** Comes from elsewhere (group, parent scope, parent role): drawn outlined. */
  inherited?: boolean;
  /** Small text under the pill, e.g. "via Developers". */
  note?: string;
  tone?: Tone;
}

export type TableRow =
  | { kind: 'section'; label: string }
  | { kind: 'row'; id: string; cells: Cell[]; marks?: RowMark[]; icon?: string; tone?: Tone };

export type RowMark = 'pk' | 'fk' | 'unique' | 'null' | 'pii';

export interface Cell {
  text: string;
  muted?: boolean;
  mono?: boolean;
  strong?: boolean;
}

export type Marker = 'none' | 'arrow' | 'one' | 'zeroOrOne' | 'many' | 'oneOrMany' | 'zeroOrMany';

export interface Endpoint {
  node: string;
  /** A row id of a table shape; the line attaches to that row. */
  row?: string;
}

export interface GraphEdge {
  id: string;
  from: Endpoint;
  to: Endpoint;
  label?: string;
  line: 'solid' | 'dashed' | 'dotted';
  tone?: Tone;
  start: Marker;
  end: Marker;
  /** Drawn as a chip on the source card instead of a line: for cross-cutting links (secrets, telemetry) that would cross the whole drawing. */
  badge?: boolean;
  /** What the line means, e.g. "Identity": names the link in a badge's tooltip. */
  kind?: string;
  /** Its number in a dynamic view, drawn in a small circle on the line. */
  step?: number;
  path: Path;
}

export interface LegendItem {
  label: string;
  /** A line sample (default), or a pill sample: filled or outlined like matrix cells. */
  line?: GraphEdge['line'];
  /** Pill samples (matrix text cells) or check samples (matrix check cells), filled or outlined; or a badge chip. */
  swatch?: 'fill' | 'outline' | 'check' | 'check-outline' | 'badge' | 'tile' | 'boundary';
  tone?: Tone;
  /** The icon of a tile sample (an element type). */
  icon?: string;
  /** A greyed sample: external elements. */
  muted?: boolean;
}

// Geometry, filled in by layout.

export interface Point {
  x: number;
  y: number;
}

export interface Box extends Point {
  width: number;
  height: number;
}

export interface Placed {
  nodes: Map<string, Box>;
  groups: Map<string, Box>;
  edges: Map<string, PlacedEdge>;
  width: number;
  height: number;
  /** What was subtracted to move the drawing to 0,0. Pins live in the unshifted space: pin = box + shift. */
  shift?: Point;
  /** The direction drawn, when layout chose one other than the graph's (the source left it open). */
  direction?: Direction;
}

export interface PlacedEdge {
  points: Point[];
  label?: Box;
}

/** Sizes measured by render before layout, so layout can reserve the right space. */
export interface Sized {
  graph: Graph;
  nodes: Map<string, NodeSize>;
  edgeLabels: Map<string, { width: number; height: number }>;
  /** Space above a group's children for its label. */
  groupHeader: number;
  /** Width a group needs at least to show its label. */
  groupMinWidth: Map<string, number>;
}

export interface NodeSize {
  width: number;
  height: number;
  /** Vertical centre of each table row, relative to the node's top. */
  rowY?: Record<string, number>;
}

/** Manual tweaks stored next to the diagram as <name>.layout.json. */
export interface LayoutSidecar {
  version: 1;
  nodes?: Record<string, Point>;
  /** Groups moved as a whole: their top-left; what is inside moves along unless pinned itself. */
  groups?: Record<string, Point>;
  /** Pins per named view; the top level holds the pins of the diagram without a view. */
  views?: Record<string, { nodes?: Record<string, Point>; groups?: Record<string, Point> }>;
}
