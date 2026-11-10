// Blocks: the boxes of the tree engine (packages/tree). A capability map is blocks inside blocks,
// an org chart is person blocks on a tidy tree, a Team Topologies view is team blocks with
// interaction zones between them. Each block is a node of its own, so it can be picked, linked
// and focused; the engine places containers around what they hold.
import type { Tone } from './model.ts';

export type BlockForm =
  // A capability map, level 1 to 3: an area (a column or band), a capability box, a chip.
  | 'area'
  | 'capability'
  | 'chip'
  // An org chart.
  | 'person'
  // Team Topologies: the four team types, the three interaction modes, the flow of change.
  | 'stream'
  | 'platform'
  | 'enabling'
  | 'subsystem'
  | 'collaboration'
  | 'service'
  | 'facilitating'
  | 'flow'
  // A mind map: a topic, its `level` from the centre (0) out.
  | 'topic';

/**
 * Where a block falls on a heatmap. The colour is the theme's (render resolves it); what the value
 * is always shows in words too (a number, a label), and a category may add a pattern.
 */
export interface BlockHeat {
  /** sequential: one hue from faint to strong; diverging: rose through amber to green; categorical: a tone per value. */
  scale: 'sequential' | 'diverging' | 'categorical';
  /** 0–1 along a sequential or diverging scale. */
  at?: number;
  /** The hue of a sequential scale, or the tone of a category. */
  tone: Tone;
  /** What it says: 3, Invest, €1.2M. */
  text: string;
  pattern?: 'hatch' | 'dots';
}

export interface BlockShape {
  kind: 'block';
  form: BlockForm;
  label: string;
  caption?: string;
  tone: Tone;
  heat?: BlockHeat;
  /** On a heatmap, has no value: drawn as the key's "No value" at every depth. */
  blank?: boolean;
  /** Holds other blocks, placed inside it: its label is a header, its own heat a tag beside it. */
  container?: boolean;
  /** The block it stands in (a capability's parent, by node id): the tree engine places it there. */
  inside?: string;
  /** Short lines under the label: the systems that support a capability. */
  lines?: string[];
  /** A person's initials, in the disc. */
  initials?: string;
  /** A role nobody fills yet: drawn dashed, without initials. */
  vacant?: boolean;
  /** Small text in a corner: a team's size. */
  badge?: string;
  /** A mind map topic: how far from the centre (0 the central topic, 1 a branch, 2 and on its topics). */
  level?: number;
  /** An icon before the label (a mind map topic). */
  icon?: string;
  /** An interaction zone: the two teams it joins. A focus keeps it when both of them stay. */
  between?: [string, string];
}

