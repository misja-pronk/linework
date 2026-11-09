// The sequence shape: a whole sequence diagram as one node, like the matrix. The sequence type
// resolves the YAML into this flat list of events (activations decided, steps numbered); render
// measures and places it on the lanes engine.
import type { Path, Tone } from './model.ts';

export interface SequenceShape {
  kind: 'sequence';
  participants: SequenceParticipant[];
  /** Participants drawn together in one box ("Shop system"), in participant order. */
  boxes: { id: string; label: string; tone: Tone }[];
  events: SequenceEvent[];
  /** Repeat the participant headers under the lifelines. */
  footers?: boolean;
}

export interface SequenceParticipant {
  id: string;
  label: string;
  caption?: string;
  icon?: string;
  tone: Tone;
  box?: string;
  path: Path;
}

/** sync: filled head; async: open head; reply: dashed, open head; lost: ends in a cross. */
export type SequenceArrow = 'sync' | 'async' | 'reply' | 'lost';

export type FrameKind = 'alt' | 'opt' | 'loop' | 'par' | 'break' | 'critical' | 'group';

export type SequenceEvent =
  | {
      kind: 'message';
      from: string;
      to: string;
      label?: string;
      arrow: SequenceArrow;
      number?: number;
      /** Opens an activation on `to` (a call). */
      opens?: boolean;
      /** Closes the innermost activation of `from` (its reply). */
      closes?: boolean;
      path: Path;
    }
  | { kind: 'note'; text: string; over: string[]; side: 'over' | 'left' | 'right'; path: Path }
  | { kind: 'divider'; label: string; path: Path }
  | { kind: 'ref'; label: string; over: string[]; link?: string; path: Path }
  | { kind: 'activate' | 'deactivate'; lane: string; path: Path }
  | { kind: 'frame'; frame: FrameKind; label?: string; tone?: Tone; path: Path }
  /** The next branch of the open frame: "else" of an alt, "and" of a par. */
  | { kind: 'branch'; label?: string; path: Path }
  | { kind: 'end'; path: Path };
