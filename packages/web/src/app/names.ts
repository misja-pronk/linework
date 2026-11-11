// How the app names what is drawn: an element's label and icon, a kind from its YAML path, the counts
// in the status bar.
import type { GraphNode, Path } from '@cartography/core';
import { t, type Message } from '../i18n/index.ts';

export const count = (n: number, what: Message) => t(what, { count: n });

/** What the status bar counts: what the type draws. One shape drawn whole (a sequence, a roadmap) is
 * counted by its parts; everything else by its elements and connections. */
export function drawnCount(graph: { nodes: GraphNode[]; edges: unknown[] }): string {
  const s = graph.nodes.length === 1 ? graph.nodes[0]!.shape : undefined;
  if (s?.kind === 'sequence') return `${count(s.participants.length, '{count} participant|{count} participants')} · ${count(s.events.filter((e) => e.kind === 'message').length, '{count} message|{count} messages')}`;
  if (s?.kind === 'gitflow') return `${count(s.branches.length, '{count} branch|{count} branches')} · ${count(s.commits.length, '{count} commit|{count} commits')}`;
  if (s?.kind === 'roadmap') return `${count(s.lanes.length, '{count} lane|{count} lanes')} · ${count(s.items.length, '{count} item|{count} items')}`;
  if (s?.kind === 'journey') return `${count(s.phases.length, '{count} phase|{count} phases')} · ${count(s.steps.length, '{count} step|{count} steps')}`;
  if (s?.kind === 'matrix') return `${count(s.rows.length, '{count} row|{count} rows')} · ${count(s.columns.length, '{count} column|{count} columns')}`;
  return `${count(graph.nodes.length, '{count} element|{count} elements')} · ${count(graph.edges.length, '{count} connection|{count} connections')}`;
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
