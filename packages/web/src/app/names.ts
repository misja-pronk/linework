// How the app names what is drawn: an element's label and icon, a kind from its YAML path, the counts
// in the status bar.
import type { GraphNode, Path } from '@linework/core';
import { t, type Message } from '../i18n/index.ts';

export const count = (n: number, what: Message) => t(what, { count: n });

/** What the status bar's title block counts: what the type draws, as [name, number] cells. One shape
 * drawn whole (a sequence, a roadmap) is counted by its parts; everything else by its elements, lines
 * and groups. */
export function drawnFields(graph: { nodes: GraphNode[]; edges: unknown[]; groups: unknown[] }): [string, number][] {
  const s = graph.nodes.length === 1 ? graph.nodes[0]!.shape : undefined;
  if (s?.kind === 'sequence') return [[t('Participants'), s.participants.length], [t('Messages'), s.events.filter((e) => e.kind === 'message').length]];
  if (s?.kind === 'gitflow') return [[t('Branches'), s.branches.length], [t('Commits'), s.commits.length]];
  if (s?.kind === 'roadmap') return [[t('Lanes'), s.lanes.length], [t('Items'), s.items.length]];
  if (s?.kind === 'journey') return [[t('Phases'), s.phases.length], [t('Steps'), s.steps.length]];
  if (s?.kind === 'matrix') return [[t('Rows'), s.rows.length], [t('Columns'), s.columns.length]];
  return [[t('Elements'), graph.nodes.length], [t('Lines'), graph.edges.length], ...(graph.groups.length ? [[t('Groups'), graph.groups.length] as [string, number]] : [])];
}
export const label = (n: GraphNode) => (n.shape.kind === 'card' || n.shape.kind === 'journey-part' || n.shape.kind === 'block' ? n.shape.label || n.id : n.shape.kind === 'flow' ? n.shape.label || n.id : n.shape.kind === 'table' ? n.shape.title : n.id);
export const iconOf = (n: GraphNode) => (n.shape.kind === 'card' || n.shape.kind === 'table' || n.shape.kind === 'journey-part' ? n.shape.icon : n.shape.kind === 'flow' ? 'workflow' : n.shape.kind === 'block' ? (n.shape.form === 'person' ? 'user' : n.shape.form === 'topic' ? 'brain' : n.shape.form === 'area' || n.shape.form === 'capability' || n.shape.form === 'chip' ? 'layout-grid' : 'users') : 'table');
/** The kind of an entry from its collection: "nodes" → "node", "policies" → "policy". */
export const kindLabel = (path: Path | undefined) => (path ? String(path[0]).replace(/ies$/, 'y').replace(/(ss)es$/, '$1').replace(/(?<!s)s$/, '').replace(/-/g, ' ') : '');

/** An empty label field says what is drawn instead ("Users", from the kind) as its placeholder: empty is not "no name". */
export function withDrawnName<F extends { key: string; kind: string; value?: unknown; note?: string }>(fields: F[], drawn: string | undefined): F[] {
  if (!drawn) return fields;
  return fields.map((f) => (f.kind === 'text' && ['label', 'name', 'title'].includes(f.key) && f.value === '' ? { ...f, note: `${drawn} (as drawn; type to change it)` } : f));
}
