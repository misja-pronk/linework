// Stages in the pipeline: which one is drawn, the drawing of it on the placement of everything, the
// timeline under it, and the roadmap the stages make. See packages/core/src/stages.ts for the YAML.
import { overviewGraph, stageGraph, stageIndex, withChanges, type BuildContext, type DiagramType, type Graph, type GraphEdge, type GraphGroup, type GraphNode, type Path, type Placed, type StagePlan, type StepState } from '@cartography/core';
import { stageNote, type StageStrip } from '@cartography/render';

/** What `stage` asks for: a stage (from 0), the overview of all of them, or everything unmarked (to animate through). */
export type StageAt = number | 'overview' | 'union';

/**
 * The stage to draw: the one asked for (id, number or title; "overview" for all of them), else the
 * to-be, as a file with steps is drawn where its story ends. The editor opens on the overview, where
 * everything can be picked.
 */
export function pickStage(plan: StagePlan, asked: string | number | undefined, interactive: boolean, report: (message: string) => void): StageAt {
  if (asked === undefined) return interactive ? 'overview' : plan.stages.length - 1;
  if (asked === 'overview' || asked === 'all') return 'overview';
  if (asked === 'union') return 'union';
  const k = stageIndex(plan, asked);
  if (k != null) return k;
  report(`There is no stage "${asked}"; stages: ${plan.stages.map((s) => s.id).join(', ')}, or overview`);
  return plan.stages.length - 1;
}

/** The drawing of a stage: on the placement of everything, with the stage's own changes built in. */
export function drawStage(at: StageAt, plan: StagePlan, union: Graph, placed: Placed, type: DiagramType, built: Record<string, unknown>, ctx: Omit<BuildContext, 'error' | 'warn'>): { graph: Graph; placed: Placed } {
  if (at === 'overview') return { graph: overviewGraph(union, plan), placed };
  if (at === 'union') return { graph: union, placed };
  const changes = plan.changes[at]!;
  let rebuilt: { nodes: Map<string, GraphNode>; groups: Map<string, GraphGroup>; edges: Map<string, GraphEdge> } | undefined;
  if (changes.size) {
    // Problems in what a change writes are the change's: reported at the stage when it is checked, not twice here.
    const quiet = { ...ctx, error: () => {}, warn: () => {} };
    const g = type.build(withChanges(built, changes, union), quiet);
    rebuilt = { nodes: new Map(g.nodes.map((n) => [n.id, n])), groups: new Map(g.groups.map((x) => [x.id, x])), edges: new Map(g.edges.map((e) => [e.id, e])) };
  }
  return stageGraph(union, placed, plan, at, rebuilt);
}

/** The timeline under the drawing: every stage, the one drawn marked, and what it says. */
export function stageStrip(plan: StagePlan, at: StageAt, span?: [number, number]): StageStrip {
  const stops = plan.stages.map((s, k) => ({ title: s.title, ...(s.when ? { when: s.when } : {}), ...(k && stageNote(s) ? { note: stageNote(s) } : {}), ...(s.description ? { description: s.description } : {}) }));
  if (span) {
    const [a, b] = [plan.stages[span[0]]!, plan.stages[span[1]]!];
    return { stops, span, heading: `From ${a.title} to ${b.title}`, caption: 'What changes: + added, ~ changed, − removed, and what replaces what.' };
  }
  if (typeof at !== 'number') {
    const first = plan.stages[0]!.title;
    const last = plan.stages.at(-1)!.title;
    return { stops, heading: 'Migration overview', caption: `Everything from ${first} to ${last}. On each element: + the stage it is added in, − the stage it is gone in, ~ the stage it changes in; moves: to another group, drawn there too.` };
  }
  return { stops, at };
}

/** Each stage as a step of the drawing of everything: what is not there then is hidden in its place (an animation fades between them). */
export function stageStates(plan: StagePlan, union: Graph): StepState[] {
  return plan.stages.map((s, k) => {
    const p = plan.present[k]!;
    const hide = <T extends { id: string }>(list: T[], has: Set<string>) => Object.fromEntries(list.filter((x) => !has.has(x.id)).map((x) => [x.id, 'hidden' as const]));
    return { title: s.when ? `${s.title} · ${s.when}` : s.title, ...(s.description ? { caption: s.description } : {}), nodes: hide(union.nodes, p.nodes), groups: hide(union.groups, p.groups), edges: hide(union.edges, p.edges), notes: [] };
  });
}

export const stageTitle = (plan: StagePlan, at: StageAt) => (at === 'overview' || at === 'union' ? 'migration overview' : `stage ${at + 1} of ${plan.stages.length}: ${plan.stages[at]!.title}`);

/** Where a stage's problems point in the YAML. */
export const stagePath = (plan: StagePlan, at: StageAt): Path => (typeof at === 'number' ? ['stages', at] : ['stages']);
