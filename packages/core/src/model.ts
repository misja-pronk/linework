// The type-agnostic graph every diagram type builds. Render and layout only know this model,
// which is what keeps all diagram types looking like one tool.
import type { SequenceArrow, SequenceShape } from './sequence.ts';
import type { GitflowShape } from './gitflow.ts';
import type { RoadmapShape } from './roadmap.ts';
import type { JourneyPartShape, JourneyShape } from './journey.ts';
import type { ThreatRow } from './threats.ts';
import type { BlockShape } from './block.ts';

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
  /** The main line of a process, one beat per stop: laid out straight, and what a step-through walks when no steps are written. */
  walk?: GraphBeat[];
  /** The threat overlay's rows (see threats.ts): what the threat table and `carto threats` list. */
  threats?: ThreatRow[];
  /** How a type's own layout is asked to arrange the drawing, as the source says (a capability map in bands, four areas to a row). */
  arrange?: Record<string, string | number | boolean>;
  /** The drawing is a tree along its solid lines (an org chart): a focus on one element keeps its whole branch and the line up to the top. */
  tree?: boolean;
}

export interface GraphBeat {
  title: string;
  caption?: string;
  /** The stop and the line that leads to it. */
  nodes: string[];
  edges: string[];
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
  /** A swimlane: a band across the whole drawing with its name in a header at the start, instead of a box around its children. */
  lane?: boolean;
  /** Where it points to: a URL, another diagram, a view. Drawn as a link icon; real links in exports. */
  links?: Link[];
  description?: string;
  /** Whose icon set to look in first (aws, gcp, azure) when a diagram mixes vendors. */
  pack?: string;
  /** Kind and tags as written, for rules like "kind:database" and "tag:external" in steps. */
  kind?: string;
  tags?: string[];
  /** What a focus view is about (see focus.ts): drawn with a ring. */
  focused?: boolean;
  /** A trust boundary of a threat model: drawn as a heavier dashed line in the threat colour. */
  trust?: boolean;
  /** Short tags drawn on it, such as threat numbers (T1, T2): they say it in text, never in colour alone. */
  marks?: string[];
  path: Path;
}

export interface GraphNode {
  id: string;
  parent?: string;
  shape: CardShape | TableShape | MatrixShape | SequenceShape | GitflowShape | RoadmapShape | JourneyShape | JourneyPartShape | FlowShape | BlockShape;
  links?: Link[];
  /** Longer text, shown as a tooltip and read by screen readers. */
  description?: string;
  /** Kind and tags as written, for rules like "kind:database" and "tag:external" in steps. */
  kind?: string;
  tags?: string[];
  path: Path;
  /** Shown only as the badges that name it (a ConfigMap on the workload using it), never as a card of its own. */
  folded?: boolean;
  /** Layer hint: nodes with the same rank line up across groups (network tiers: edge, core, access). */
  rank?: number;
  /** What a focus view is about (see focus.ts): drawn with a ring. */
  focused?: boolean;
  /** Whose icon set to look in first (aws, gcp, azure) when a diagram mixes vendors. */
  pack?: string;
  /** Short tags drawn on its top edge, such as threat numbers (T1, T2). */
  marks?: string[];
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
  /** Two cards stacked: a redundant pair (HA firewalls, a switch stack). */
  stack?: boolean;
  /** A short description written in the card under the caption (C4 style), wrapped to at most three lines. */
  body?: string;
  /** Outside the scope of the drawing (an external system): drawn greyed. */
  muted?: boolean;
}

export type CardForm = 'decision' | 'terminal' | 'plain' | 'person';

/**
 * An element of a process or a state machine, told apart by its outline rather than its colour:
 * a task or state is a rounded box, an event a circle, a gateway a diamond.
 */
export interface FlowShape {
  kind: 'flow';
  form: FlowForm;
  /** Inside a task or state; beside an event, gateway or document. */
  label: string;
  caption?: string;
  /** A task's kind (user, service…) in its corner, an event's trigger in its circle. */
  icon?: string;
  tone: Tone;
  /**
   * What the outline says. Event: start (thin ring), end (heavy ring) or mid (double ring).
   * Gateway: xor (plain), and (+), or (o) or event. Pseudo-state: initial, final, choice or history.
   */
  mark?: 'start' | 'end' | 'mid' | 'xor' | 'and' | 'or' | 'event' | 'initial' | 'final' | 'choice' | 'history';
  /** A state's entry / exit / do lines, under its name. */
  lines?: string[];
}

export type FlowForm = 'task' | 'subprocess' | 'event' | 'gateway' | 'state' | 'pseudo' | 'document' | 'note';

/** Header + rows, with a connection point per row: tables, data products in detail. */
export interface TableShape {
  kind: 'table';
  /** A UML class box: rows close together without rules between them, an empty section a rule between compartments. */
  form?: 'class';
  title: string;
  /** The title set in italics: an abstract class. */
  italic?: boolean;
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
  /** A plain table: cells are left-aligned text, no pills (an IP plan). A row with an empty label continues the one above. */
  plain?: boolean;
  /** A comparison with an earlier state: cells carry a `change`, and those without one are drawn quietly. */
  compare?: boolean;
  /** A plain table whose text wraps at this width instead of widening its column (a threat table). */
  wrap?: number;
  /** Exported to slides as a real table, with cells to type in, instead of drawn shapes. */
  table?: boolean;
}

export interface MatrixHeader {
  label: string;
  caption?: string;
  icon?: string;
  tone?: Tone;
  /** In a comparison: new here, or gone (the label is struck through). */
  change?: 'added' | 'removed';
  /** Headers with the same group in a row are drawn under one name: a band over columns, a section line between rows. */
  group?: string;
  /** Where the header points to (the element of the model it names). */
  link?: Link;
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
  /** Bold text, in a plain table. In a plain table a cell with a tone is a pill (a status). */
  strong?: boolean;
  /** Several values in one cell (C, R, U): a small pill each, in the order written. */
  parts?: { text: string; tone?: Tone }[];
  /** In a comparison: gained, lost (struck through) or another value than before. Drawn with a ring; the sign is part of the text. */
  change?: 'added' | 'removed' | 'changed';
}

/** A section with an empty label is a rule across the box: the line between a class's attributes and its operations. A row's `sign` stands in the mark column in the monospace face: a member's visibility (+ - # ~). */
export type TableRow =
  | { kind: 'section'; label: string }
  | { kind: 'row'; id: string; cells: Cell[]; marks?: RowMark[]; icon?: string; tone?: Tone; sign?: string };

export type RowMark = 'pk' | 'fk' | 'unique' | 'null' | 'pii';

export interface Cell {
  text: string;
  muted?: boolean;
  mono?: boolean;
  strong?: boolean;
  /** Abstract (UML): in italics. */
  italic?: boolean;
  /** Static (UML): underlined. */
  underline?: boolean;
}

/** `slash` is a process's default flow: a stroke across the line where it leaves the gateway. */
export type Marker = 'none' | 'arrow' | 'one' | 'zeroOrOne' | 'many' | 'oneOrMany' | 'zeroOrMany' | 'slash' | UmlMarker;

/** UML ends: a hollow triangle (generalization, realization), a hollow or a filled diamond (aggregation, composition), an open arrowhead (navigability, dependency) whatever the theme's arrows look like. */
export type UmlMarker = 'triangle' | 'diamond' | 'filledDiamond' | 'open';

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
  /** A second mark on the line besides its colour, so two styles never differ in colour alone: ticks across it, beads on it, or a cased double line. */
  pattern?: LinePattern;
  tone?: Tone;
  start: Marker;
  end: Marker;
  /** Drawn as a chip on the source card instead of a line: for cross-cutting links (secrets, telemetry) that would cross the whole drawing. */
  badge?: boolean;
  /** What the line means, e.g. "Identity": names the link in a badge's tooltip. */
  kind?: string;
  /** Line weight relative to a normal line: trunks and aggregated links draw thicker. */
  width?: number;
  /** Icon in the label pill, e.g. a lock on a VPN tunnel. */
  icon?: string;
  /** Its number in a dynamic view, drawn in a small circle on the line. */
  step?: number;
  /** Says nothing about what comes before what (a key between two contracts): the layout does not rank by it. */
  loose?: boolean;
  /** Short tags drawn after its label, such as threat numbers (T1). */
  marks?: string[];
  /** Tags at the ends of the line, drawn on it next to the element: a context map's U and D, ACL, OHS. */
  ends?: { from?: string[]; to?: string[] };
  path: Path;
}

/** See GraphEdge.pattern. */
export type LinePattern = 'ticks' | 'beads' | 'double';

export interface LegendItem {
  label: string;
  /** A line sample (default), or a pill sample: filled or outlined like matrix cells. */
  line?: GraphEdge['line'];
  pattern?: LinePattern;
  /** A line sample's end, for a key of crow's feet; a glyph sample ('glyph') is its icon alone, in its tone, as in a table row. */
  end?: Marker;
  /** Pill samples (matrix text cells) or check samples (matrix check cells), filled or outlined; or a badge chip. */
  swatch?: 'fill' | 'outline' | 'check' | 'check-outline' | 'badge' | 'tile' | 'boundary' | 'trust' | 'mark' | 'block' | 'glyph' | 'message';
  /** The arrow of a message sample ('message'), drawn as the sequence draws it. */
  arrow?: SequenceArrow;
  /** A block sample (swatch 'block'): a team type, an interaction mode, a place on a heatmap. */
  block?: { form: BlockShape['form']; heat?: BlockShape['heat'] };
  tone?: Tone;
  /** Weight of the line sample, as GraphEdge.width. */
  width?: number;
  /** The icon of a tile sample (an element type). */
  icon?: string;
  /** A greyed sample: external elements. */
  muted?: boolean;
  /** The text of a tag sample ('mark'): T1, U, ACL. */
  tag?: string;
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
  /** Where a name sits that is drawn beside its shape (an event's, a gateway's), by node id. */
  labels?: Map<string, Box>;
  /** What to remember of this drawing so the next one stays close to it: how it was made and where things are, before pins. */
  memory?: LayoutMemory;
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
  /** Pairs that belong together without a line between them (a relation shown as a badge). */
  near?: [string, string][];
}

export interface NodeSize {
  width: number;
  height: number;
  /** Vertical centre of each table row, relative to the node's top. */
  rowY?: Record<string, number>;
  /** Boxes of the parts a shape draws itself and that are nodes of their own (a journey's steps), relative to its top-left. */
  parts?: Record<string, Box>;
  /** Room for a name drawn beside the shape instead of inside it. */
  label?: { width: number; height: number };
}

/** A line drawn by hand: the router runs it through these bend points (pin space), kept orthogonal. */
export interface EdgeOverride {
  via: Point[];
  /** The nodes it joined when bent: line ids are positions in a list, so a bend whose ends no longer match is ignored. */
  from?: string;
  to?: string;
}

/** The tweaks of one view: what the sidecar holds at its top level and per named view. */
export interface ViewPins {
  nodes?: Record<string, Point>;
  /** Groups moved as a whole: their top-left; what is inside moves along unless pinned itself. */
  groups?: Record<string, Point>;
  /** Lines with bends set by hand, by edge id. */
  edges?: Record<string, EdgeOverride>;
  /** Pinned nodes and groups that cannot be dragged by accident (the editor's concern; the layout ignores it). */
  locked?: string[];
  /** What the drawing looked like when this was written, so the next drawing stays close to it. */
  layout?: LayoutNote;
}

/** The previous drawing of a view, as kept in the sidecar. */
export interface LayoutNote {
  /** How the placement was made: direction / way of asking dot / compact and align, e.g. "down/out/ca". */
  variant?: string;
  /**
   * Where nodes and groups were, in one line so a change is one line in a diff:
   * "id@x,y;…;#group@x,y,w,h" (centres of nodes, boxes of groups, pin space). Only written when asked for.
   */
  at?: string;
}

/** The previous drawing of a view, as the layout uses it. */
export interface LayoutMemory {
  variant?: string;
  /** Boxes were kept where the drawing before had them, so the variant alone does not give this placement back. */
  held?: boolean;
  /** Node centres in pin space. */
  nodes?: Map<string, Point>;
  /** Group boxes in pin space. */
  groups?: Map<string, Box>;
  /** How many pairs of groups stood against the order they were written in (not kept in the sidecar). */
  disorder?: number;
}

/** Manual tweaks stored next to the diagram as <name>.layout.json. */
export interface LayoutSidecar extends ViewPins {
  version: 1;
  /** Pins per named view; the top level holds the pins of the diagram without a view. */
  views?: Record<string, ViewPins>;
}
