// The git flow shape: a whole branching diagram as one node, like the sequence. The gitflow type
// resolves the YAML (and its preset) into branches and commits in time order; render places them on
// the lanes engine: branches as rows, commits as columns of one shared time axis.
import type { Path, Tone } from './model.ts';

export type BranchFamily = 'main' | 'develop' | 'release' | 'hotfix' | 'feature' | 'other';

export interface GitBranch {
  name: string;
  /** Shown instead of the name in the lane. */
  label?: string;
  family: BranchFamily;
  tone: Tone;
  /** Long-lived: its line runs to the end of the drawing (main, develop). */
  keep: boolean;
  path: Path;
}

export interface GitCommit {
  id: string;
  branch: string;
  label?: string;
  tags: string[];
  notes: string[];
  /** A collapsed run: "12 commits" in one pill. */
  count?: number;
  /** The commit this one branched from: the first commit on a branch. */
  fork?: string;
  /** The commit merged in: this is a merge commit. */
  merge?: string;
  /** The commit cherry-picked onto this one. */
  pick?: string;
  /** Environments this commit is deployed to. */
  deploy: string[];
  path: Path;
}

export interface GitStage {
  id: string;
  label: string;
  icon: string;
  tone: Tone;
}

/** One branch (or family) through the pipeline: the stages it reaches, in order, gates before some. */
export interface GitPipeline {
  label: string;
  tone: Tone;
  steps: { stage: string; label: string; gate?: string }[];
  path: Path;
}

export interface GitflowShape {
  kind: 'gitflow';
  view: 'branches' | 'delivery';
  branches: GitBranch[];
  commits: GitCommit[];
  environments: { id: string; label: string; tone: Tone }[];
  stages: GitStage[];
  pipelines: GitPipeline[];
}
