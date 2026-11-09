// The roadmap shape: workstreams as lanes along a time axis, as one node. The roadmap type resolves
// dates, durations and dependencies into numbers on one axis (days, or period indexes for an axis of
// named periods); render places items in tracks on the lanes engine.
import type { Path, Tone } from './model.ts';

export type RoadmapStatus = 'planned' | 'active' | 'done' | 'at-risk' | 'late';

/** One tick of the axis: [start, end) in axis units, with its label and the label of the tier above. */
export interface RoadmapTick {
  start: number;
  end: number;
  label: string;
  /** The group it belongs to (year, quarter): a new group starts where this changes. */
  group?: string;
}

export interface RoadmapItem {
  id: string;
  lane?: string;
  label: string;
  start: number;
  /** End, exclusive; equal to start for a milestone. */
  end: number;
  milestone: boolean;
  status?: RoadmapStatus;
  /** 0–1: how much is done, drawn as a filled part of the bar. */
  progress?: number;
  tone?: Tone;
  /** Ids of items this one waits for: drawn as arrows. */
  after: string[];
  path: Path;
}

export interface RoadmapShape {
  kind: 'roadmap';
  /** Axis range [start, end) and its ticks. */
  start: number;
  end: number;
  ticks: RoadmapTick[];
  /** Pixels per axis unit: wider for weeks than for quarters. */
  scale: number;
  lanes: { id: string; label: string; caption?: string; tone: Tone; path: Path }[];
  items: RoadmapItem[];
  phases: { label: string; start: number; end: number; tone: Tone; path: Path }[];
  today?: { at: number; label: string };
}
