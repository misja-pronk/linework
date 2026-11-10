// What the page carries, as the viewer reads it: every drawing pre-rendered (light and dark, whole
// and per step), what each drawn shape stands for, and the elements of the model with where they
// appear. Shared by the packer (Node or the editor) and the viewer script in the page.

export interface Payload {
  v: 1;
  title: string;
  subtitle?: string;
  /** A folder export: the page opens on a contents page, with an index of elements. */
  site: boolean;
  /** The day it was made, YYYY-MM-DD. */
  made: string;
  files: PFile[];
  drawings: PDrawing[];
  elements: PElement[];
  /** Pictures that repeat (official icons), referred to from the SVGs as data-carto-icon="n". */
  icons: string[];
  /** Review notes are drawn and listed. */
  notes: boolean;
}

export interface PFile {
  path: string;
  title: string;
  /** The diagram type, as written. */
  type: string;
  /** Indices into drawings, in order. */
  drawings: number[];
}

/** One SVG in both looks; dark is left out when the drawing has a look of its own (a brand theme). */
export interface Picture {
  w: number;
  h: number;
  light: string;
  dark?: string;
}

export interface PStep extends Picture {
  title?: string;
  caption?: string;
}

export interface PDrawing extends Picture {
  /** "file.yaml" or "file.yaml#view": what links and the address bar name it by. */
  key: string;
  file: string;
  view?: string;
  title: string;
  /** What kind of drawing: "container view", "azure diagram". */
  kind: string;
  steps?: PStep[];
  /** Drawn shape ("n:id" or "g:id") → element index. */
  shapes: Record<string, number>;
  /** Drawn shape → the drawing it opens (a link, or the view a level down). */
  drill: Record<string, number>;
  /** The levels above, for breadcrumbs: the element and the drawing about it. */
  trail?: { label: string; to?: number }[];
  notes?: PNote[];
}

export interface PElement {
  id: string;
  label: string;
  kind?: string;
  description?: string;
  technology?: string;
  owner?: string;
  tags?: string[];
  /** Other fields as written, in order. */
  props?: [string, string][];
  /** Web addresses and files that are not drawings here; drawings are in `opens`. */
  links?: { label: string; href?: string }[];
  /** The element it is part of, by index. */
  parent?: number;
  /** Where it is drawn: drawing index and the shape it is drawn as. */
  where: [number, string][];
}

export interface PNote {
  n: number;
  about: string;
  /** The shape it hangs on, when it is drawn. */
  shape?: string;
  author: string;
  date: string;
  text: string;
  replies: { author: string; date: string; text: string }[];
}
